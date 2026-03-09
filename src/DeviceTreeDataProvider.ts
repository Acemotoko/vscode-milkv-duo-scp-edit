import * as vscode from 'vscode';
import { DeviceManager, DeviceState, DeviceConnectionStatus } from './DeviceManager';
import { DeviceTreeItem } from './DeviceTreeItem';
import { ConnectionManager } from './ConnectionManager';
import { DuoTerminalProvider } from './DuoTerminalProvider';

export class DeviceTreeDataProvider implements vscode.TreeDataProvider<DeviceTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DeviceTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private context: vscode.ExtensionContext,
    private deviceManager: DeviceManager
  ) {
    this.deviceManager.onDidChangeDevices(() => {
      this.refresh();
    });
  }

  private async promptDeviceInputs(
    defaults?: { name?: string; host?: string; port?: number; username?: string }
  ): Promise<{ name: string; host: string; port: number; username: string } | undefined> {
    const name = await vscode.window.showInputBox({
      prompt: 'Enter device name',
      placeHolder: 'e.g., My Milk-V Duo',
      value: defaults?.name
    });
    if (!name) {
      return undefined;
    }

    const host = await vscode.window.showInputBox({
      prompt: 'Enter IP address',
      placeHolder: '192.168.31.63',
      value: defaults?.host
    });
    if (!host) {
      return undefined;
    }

    const portStr = await vscode.window.showInputBox({
      prompt: 'Enter SSH port',
      placeHolder: '22',
      value: defaults?.port !== undefined ? String(defaults.port) : '22'
    });
    if (portStr === undefined) {
      return undefined;
    }
    const port = parseInt(portStr, 10) || 22;

    const username = await vscode.window.showInputBox({
      prompt: 'Enter SSH username',
      placeHolder: 'root',
      value: defaults?.username || 'root'
    });
    if (!username) {
      return undefined;
    }

    return { name, host, port, username };
  }

  private async ensureDeviceConnected(item: DeviceTreeItem): Promise<boolean> {
    const activeDevice = this.deviceManager.getActiveDevice();
    if (!activeDevice || activeDevice.config.id !== item.deviceState.config.id) {
      await this.connectDevice(item);
    }
    return ConnectionManager.instance.isConnected;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DeviceTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DeviceTreeItem): Thenable<DeviceTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const devices = this.deviceManager.getDevices();
    const items = devices.map(
      state => new DeviceTreeItem(state, vscode.TreeItemCollapsibleState.None)
    );
    return Promise.resolve(items);
  }

  async addDevice(): Promise<void> {
    const inputs = await this.promptDeviceInputs();
    if (!inputs) {
      return;
    }

    const password = await vscode.window.showInputBox({
      prompt: 'Enter SSH password',
      password: true
    });
    if (password === undefined) {
      return;
    }

    await this.deviceManager.addDevice(inputs, password);
    vscode.window.showInformationMessage(`Device "${inputs.name}" added successfully!`);
  }

  async connectDevice(item: DeviceTreeItem): Promise<void> {
    const { config } = item.deviceState;
    const password = await this.deviceManager.getDevicePassword(config.id);

    if (!password) {
      const pw = await vscode.window.showInputBox({
        prompt: `Enter password for ${config.username}@${config.host}`,
        password: true
      });
      if (pw === undefined) {
        return;
      }

      await this.deviceManager.updateDevice(config.id, {}, pw);
      await this.doConnect(config, pw, item.deviceState);
      return;
    }

    await this.doConnect(config, password, item.deviceState);
  }

  private async doConnect(
    config: DeviceState['config'],
    password: string,
    deviceState: DeviceState
  ): Promise<void> {
    this.deviceManager.updateDeviceStatus(
      deviceState.config.id,
      DeviceConnectionStatus.Connecting
    );

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Connecting to ${config.name}...`,
        cancellable: false
      }, async () => {
        await ConnectionManager.instance.connect({
          host: config.host,
          port: config.port,
          username: config.username,
          password
        });
      });

      await this.deviceManager.setActiveDevice(deviceState.config.id);
      this.deviceManager.updateDeviceStatus(
        deviceState.config.id,
        DeviceConnectionStatus.Connected
      );

      const choice = await vscode.window.showInformationMessage(
        `Connected to ${config.name} successfully!`,
        'Add to Workspace',
        'Open Terminal',
        'Browse Files',
        'Later'
      );

      if (choice === 'Add to Workspace') {
        await vscode.commands.executeCommand('duo.addToWorkspace');
      } else if (choice === 'Open Terminal') {
        await vscode.commands.executeCommand('duo.openTerminal');
      }

    } catch (err: any) {
      this.deviceManager.updateDeviceStatus(
        deviceState.config.id,
        DeviceConnectionStatus.Error,
        err.message
      );
      vscode.window.showErrorMessage(`Connection failed: ${err.message}`);
    }
  }

  async disconnectDevice(item: DeviceTreeItem): Promise<void> {
    await ConnectionManager.instance.disconnect();
    await this.deviceManager.setActiveDevice(undefined);
    this.deviceManager.updateDeviceStatus(
      item.deviceState.config.id,
      DeviceConnectionStatus.Disconnected
    );
    vscode.window.showInformationMessage(`Disconnected from ${item.deviceState.config.name}`);
  }

  async editDevice(item: DeviceTreeItem): Promise<void> {
    const { config } = item.deviceState;

    const inputs = await this.promptDeviceInputs({
      name: config.name,
      host: config.host,
      port: config.port,
      username: config.username
    });
    if (!inputs) {
      return;
    }

    const changePassword = await vscode.window.showQuickPick(['No', 'Yes'], {
      title: 'Change password?'
    });

    let password: string | undefined;
    if (changePassword === 'Yes') {
      password = await vscode.window.showInputBox({
        prompt: 'Enter new SSH password',
        password: true
      });
      if (password === undefined) {
        return;
      }
    }

    await this.deviceManager.updateDevice(
      config.id,
      inputs,
      password
    );
    vscode.window.showInformationMessage(`Device "${inputs.name}" updated!`);
  }

  async deleteDevice(item: DeviceTreeItem): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Delete device "${item.deviceState.config.name}"?`,
      { modal: true },
      'Delete'
    );
    if (confirm !== 'Delete') {
      return;
    }

    await this.deviceManager.deleteDevice(item.deviceState.config.id);
    vscode.window.showInformationMessage('Device deleted');
  }

  async openTerminal(item: DeviceTreeItem): Promise<void> {
    const connected = await this.ensureDeviceConnected(item);
    if (!connected) {
      return;
    }

    const pty = new DuoTerminalProvider(ConnectionManager.instance);
    const terminal = vscode.window.createTerminal({
      name: `Milk-V Duo - ${item.deviceState.config.name}`,
      pty
    });
    terminal.show();
  }

  async mountWorkspace(item: DeviceTreeItem): Promise<void> {
    const connected = await this.ensureDeviceConnected(item);
    if (!connected) {
      return;
    }

    const uri = vscode.Uri.parse('duo:///');
    const workspaceFolders = vscode.workspace.workspaceFolders || [];

    const alreadyMounted = workspaceFolders.some(folder => folder.uri.scheme === 'duo');
    if (alreadyMounted) {
      vscode.window.showWarningMessage('Device is already in workspace');
      return;
    }

    const added = vscode.workspace.updateWorkspaceFolders(
      workspaceFolders.length,
      0,
      { uri: uri, name: `Duo - ${item.deviceState.config.name}` }
    );

    if (!added) {
      vscode.window.showErrorMessage('Failed to mount workspace');
    }
  }

  async rebootDevice(item: DeviceTreeItem): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Reboot ${item.deviceState.config.name}?`,
      { modal: true },
      'Reboot'
    );
    if (confirm !== 'Reboot') {
      return;
    }

    try {
      await ConnectionManager.instance.execCommand('reboot &');

      this.deviceManager.updateDeviceStatus(
        item.deviceState.config.id,
        DeviceConnectionStatus.Disconnected
      );
      await this.deviceManager.setActiveDevice(undefined);
      await ConnectionManager.instance.disconnect();

      vscode.window.showInformationMessage('Rebooting device...');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to reboot: ${err.message}`);
    }
  }
}
