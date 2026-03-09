import * as vscode from 'vscode';
import { ConnectionManager } from './ConnectionManager';

export interface DeviceConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  createdAt: number;
}

export enum DeviceConnectionStatus {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Error = 'error'
}

export interface DeviceState {
  config: DeviceConfig;
  status: DeviceConnectionStatus;
  errorMessage?: string;
}

export class DeviceManager {
  private static _instance: DeviceManager | null = null;
  private _globalState: vscode.Memento | null = null;
  private _secrets: vscode.SecretStorage | null = null;
  private _deviceStates: Map<string, DeviceState> = new Map();
  private _onDidChangeDevices = new vscode.EventEmitter<void>();

  private static readonly KEY_DEVICES = 'duo_devices';
  private static readonly KEY_PASSWORD_PREFIX = 'duo_device_password_';
  private static readonly KEY_ACTIVE_DEVICE = 'duo_active_device';

  public static get instance(): DeviceManager {
    if (!DeviceManager._instance) {
      DeviceManager._instance = new DeviceManager();
    }
    return DeviceManager._instance;
  }

  public readonly onDidChangeDevices = this._onDidChangeDevices.event;

  private constructor() {}

  public initialize(context: vscode.ExtensionContext): void {
    this._globalState = context.globalState;
    this._secrets = context.secrets;
    this.loadDevices();
    this.setupConnectionListener();
  }

  private setupConnectionListener(): void {
    const connectionManager = ConnectionManager.instance;
    if (connectionManager.onDidChangeConnectionStatus) {
      connectionManager.onDidChangeConnectionStatus((connected: boolean) => {
        const activeDevice = this.getActiveDevice();
        if (activeDevice) {
          if (connected) {
            this.updateDeviceStatus(activeDevice.config.id, DeviceConnectionStatus.Connected);
          } else {
            this.updateDeviceStatus(activeDevice.config.id, DeviceConnectionStatus.Disconnected);
          }
        }
      });
    }
  }

  private loadDevices(): void {
    if (!this._globalState) {
      return;
    }

    const devices = this._globalState.get<DeviceConfig[]>(DeviceManager.KEY_DEVICES, []);
    const activeDeviceId = this._globalState.get<string>(DeviceManager.KEY_ACTIVE_DEVICE);

    for (const config of devices) {
      const isActive = activeDeviceId === config.id;
      const status = isActive && ConnectionManager.instance.isConnected
        ? DeviceConnectionStatus.Connected
        : DeviceConnectionStatus.Disconnected;

      this._deviceStates.set(config.id, { config, status });
    }
  }

  public getDevices(): DeviceState[] {
    return Array.from(this._deviceStates.values()).sort((a, b) =>
      a.config.createdAt - b.config.createdAt
    );
  }

  public getDevice(id: string): DeviceState | undefined {
    return this._deviceStates.get(id);
  }

  public async addDevice(
    config: Omit<DeviceConfig, 'id' | 'createdAt'>,
    password: string
  ): Promise<DeviceConfig> {
    if (!this._globalState || !this._secrets) {
      throw new Error('DeviceManager not initialized');
    }

    const id = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const deviceConfig: DeviceConfig = {
      ...config,
      id,
      createdAt: Date.now()
    };

    const devices = this._globalState.get<DeviceConfig[]>(DeviceManager.KEY_DEVICES, []);
    devices.push(deviceConfig);
    await this._globalState.update(DeviceManager.KEY_DEVICES, devices);

    await this._secrets.store(DeviceManager.KEY_PASSWORD_PREFIX + id, password);

    const state: DeviceState = {
      config: deviceConfig,
      status: DeviceConnectionStatus.Disconnected
    };
    this._deviceStates.set(id, state);
    this._onDidChangeDevices.fire();

    return deviceConfig;
  }

  public async updateDevice(
    id: string,
    updates: Partial<Omit<DeviceConfig, 'id' | 'createdAt'>>,
    password?: string
  ): Promise<void> {
    if (!this._globalState || !this._secrets) {
      throw new Error('DeviceManager not initialized');
    }

    const state = this._deviceStates.get(id);
    if (!state) {
      return;
    }

    state.config = { ...state.config, ...updates };

    const devices = this._globalState.get<DeviceConfig[]>(DeviceManager.KEY_DEVICES, []);
    const idx = devices.findIndex(d => d.id === id);
    if (idx >= 0) {
      devices[idx] = state.config;
      await this._globalState.update(DeviceManager.KEY_DEVICES, devices);
    }

    if (password !== undefined) {
      await this._secrets.store(DeviceManager.KEY_PASSWORD_PREFIX + id, password);
    }

    this._onDidChangeDevices.fire();
  }

  public async deleteDevice(id: string): Promise<void> {
    if (!this._globalState || !this._secrets) {
      throw new Error('DeviceManager not initialized');
    }

    const activeDeviceId = this._globalState.get<string>(DeviceManager.KEY_ACTIVE_DEVICE);
    if (activeDeviceId === id) {
      await ConnectionManager.instance.disconnect();
      await this._globalState.update(DeviceManager.KEY_ACTIVE_DEVICE, undefined);
    }

    this._deviceStates.delete(id);

    const devices = this._globalState.get<DeviceConfig[]>(DeviceManager.KEY_DEVICES, []);
    const filtered = devices.filter(d => d.id !== id);
    await this._globalState.update(DeviceManager.KEY_DEVICES, filtered);

    try {
      await this._secrets.delete(DeviceManager.KEY_PASSWORD_PREFIX + id);
    } catch {
      // 忽略删除密码时的错误
    }

    this._onDidChangeDevices.fire();
  }

  public async getDevicePassword(id: string): Promise<string | undefined> {
    if (!this._secrets) {
      return undefined;
    }
    return this._secrets.get(DeviceManager.KEY_PASSWORD_PREFIX + id);
  }

  public updateDeviceStatus(
    id: string,
    status: DeviceConnectionStatus,
    errorMessage?: string
  ): void {
    const state = this._deviceStates.get(id);
    if (state) {
      state.status = status;
      state.errorMessage = errorMessage;
      this._onDidChangeDevices.fire();
    }
  }

  public async setActiveDevice(id: string | undefined): Promise<void> {
    if (!this._globalState) {
      return;
    }
    await this._globalState.update(DeviceManager.KEY_ACTIVE_DEVICE, id);
  }

  public getActiveDevice(): DeviceState | undefined {
    if (!this._globalState) {
      return undefined;
    }
    const activeId = this._globalState.get<string>(DeviceManager.KEY_ACTIVE_DEVICE);
    return activeId ? this._deviceStates.get(activeId) : undefined;
  }

  public async importFromRecentConnections(): Promise<void> {
    if (!this._globalState || !this._secrets) {
      return;
    }

    const recent = ConnectionManager.instance.getRecentConnections();
    for (const conn of recent) {
      const existing = Array.from(this._deviceStates.values()).find(
        d => d.config.host === conn.host && d.config.username === conn.username
      );
      if (!existing) {
        const password = await this._secrets.get('duo_password_' + conn.host);
        await this.addDevice(
          {
            name: conn.host,
            host: conn.host,
            port: conn.port,
            username: conn.username
          },
          password || ''
        );
      }
    }
  }
}
