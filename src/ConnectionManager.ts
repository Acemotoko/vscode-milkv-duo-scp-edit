import { Client as SSHClient, ClientChannel } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface RecentConnection {
  host: string;
  port: number;
  username: string;
  lastConnected: number;
}

/**
 * Shell 杞箟 - 瀹夊叏鍦拌浆涔夊瓧绗︿覆鐢ㄤ簬 shell 鍛戒护
 */
export function shellEscape(str: string): string {
  // 浣跨敤鍗曞紩鍙峰寘瑁癸紝骞跺皢鍐呴儴鐨勫崟寮曞彿鏇挎崲涓?'\''
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * 纭繚 Promise 鍙 resolve/reject 涓€娆＄殑鍖呰鍣? */
class PromiseGuard<T> {
  private settled = false;
  private resolveFn: ((value: T | PromiseLike<T>) => void) | null = null;
  private rejectFn: ((reason?: any) => void) | null = null;

  constructor(resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) {
    this.resolveFn = resolve;
    this.rejectFn = reject;
  }

  resolve(value: T | PromiseLike<T>): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveFn?.(value);
      this.resolveFn = null;
      this.rejectFn = null;
    }
  }

  reject(reason?: any): void {
    if (!this.settled) {
      this.settled = true;
      this.rejectFn?.(reason);
      this.resolveFn = null;
      this.rejectFn = null;
    }
  }
}

export class ConnectionManager {
  private static _instance: ConnectionManager | null = null;
  private _sshClient: SSHClient | null = null;
  private _config: ConnectionConfig | null = null;
  private _isConnected: boolean = false;
  private _onDidChangeConnectionStatus = new vscode.EventEmitter<boolean>();
  public readonly onDidChangeConnectionStatus = this._onDidChangeConnectionStatus.event;

  private _secrets: vscode.SecretStorage | null = null;
  private _globalState: vscode.Memento | null = null;
  private _autoConnectInProgress: boolean = false;

  private static readonly KEY_LAST_CONFIG = 'duo_last_config';
  private static readonly KEY_PASSWORD_PREFIX = 'duo_password_';
  private static readonly KEY_RECENT_CONNECTIONS = 'duo_recent_connections';
  private static readonly MAX_RECENT_CONNECTIONS = 5;

  public static get instance(): ConnectionManager {
    if (!ConnectionManager._instance) {
      ConnectionManager._instance = new ConnectionManager();
    }
    return ConnectionManager._instance;
  }

  private constructor() {}

  public get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Initialize with extension context (called from activate)
   */
  public initialize(context: vscode.ExtensionContext): void {
    this._secrets = context.secrets;
    this._globalState = context.globalState;
  }

  /**
   * Check if we have stored credentials available
   */
  public hasStoredCredentials(): boolean {
    if (!this._globalState) {
      return false;
    }
    const lastConfig = this._globalState.get(ConnectionManager.KEY_LAST_CONFIG);
    return !!lastConfig;
  }

  /**
   * 鑾峰彇瀛樺偍鐨勫瘑鐮?   */
  public async getStoredPassword(host: string): Promise<string | undefined> {
    if (!this._secrets) {
      return undefined;
    }
    return this._secrets.get(ConnectionManager.KEY_PASSWORD_PREFIX + host);
  }

  /**
   * Get list of recent connections (sorted by most recent first)
   */
  public getRecentConnections(): RecentConnection[] {
    if (!this._globalState) {
      return [];
    }
    const connections = this._globalState.get<RecentConnection[]>(ConnectionManager.KEY_RECENT_CONNECTIONS, []);
    // Sort by lastConnected descending (most recent first)
    return connections.sort((a, b) => b.lastConnected - a.lastConnected);
  }

  /**
   * Add a connection to recent history (or update if already exists)
   */
  public async addRecentConnection(config: Omit<ConnectionConfig, 'password'>): Promise<void> {
    if (!this._globalState) {
      return;
    }

    let connections = this._globalState.get<RecentConnection[]>(ConnectionManager.KEY_RECENT_CONNECTIONS, []);

    // Remove existing entry for the same host
    connections = connections.filter(c => c.host !== config.host);

    // Add new entry at the beginning
    const newConnection: RecentConnection = {
      host: config.host,
      port: config.port,
      username: config.username,
      lastConnected: Date.now()
    };
    connections.unshift(newConnection);

    // Keep only the most recent MAX_RECENT_CONNECTIONS
    if (connections.length > ConnectionManager.MAX_RECENT_CONNECTIONS) {
      connections = connections.slice(0, ConnectionManager.MAX_RECENT_CONNECTIONS);
    }

    await this._globalState.update(ConnectionManager.KEY_RECENT_CONNECTIONS, connections);
  }

  /**
   * Attempt to auto-connect using stored credentials
   */
  public async autoConnect(): Promise<void> {
    if (this._autoConnectInProgress) {
      // Wait for existing auto-connect to complete
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (!this._autoConnectInProgress) {
            clearInterval(checkInterval);
            if (this._isConnected) {
              resolve();
            } else {
              reject(new Error('Auto-connect failed'));
            }
          }
        }, 100);
      });
    }

    if (!this._globalState || !this._secrets) {
      throw new Error('ConnectionManager not initialized with context');
    }

    const lastConfig = this._globalState.get<Omit<ConnectionConfig, 'password'>>(
      ConnectionManager.KEY_LAST_CONFIG
    );

    if (!lastConfig) {
      throw new Error('No stored connection configuration');
    }

    this._autoConnectInProgress = true;

    try {
      // Try to retrieve password from secrets
      const passwordKey = ConnectionManager.KEY_PASSWORD_PREFIX + lastConfig.host;
      const storedPassword = await this._secrets.get(passwordKey);

      if (!storedPassword) {
        throw new Error('No password stored');
      }

      await this.connect({
        ...lastConfig,
        password: storedPassword
      });
    } finally {
      this._autoConnectInProgress = false;
    }
  }

  public get sshClient(): SSHClient {
    if (!this._sshClient) {
      throw new Error('Not connected. Call connect() first.');
    }
    return this._sshClient;
  }

  public async connect(config: ConnectionConfig): Promise<void> {
    if (this._isConnected) {
      await this.disconnect();
    }

    this._config = config;
    this._sshClient = new SSHClient();

    await new Promise<void>((resolve, reject) => {
      const guard = new PromiseGuard<void>(resolve, reject);

      this._sshClient!.on('ready', async () => {
        this._isConnected = true;
        this._onDidChangeConnectionStatus.fire(true);

        // Save config and password on successful connect
        if (this._globalState && this._secrets) {
          // Save config without password to globalState
          const configToStore: Omit<ConnectionConfig, 'password'> = {
            host: config.host,
            port: config.port,
            username: config.username
          };
          await this._globalState.update(ConnectionManager.KEY_LAST_CONFIG, configToStore);

          // Save password to secrets
          const passwordKey = ConnectionManager.KEY_PASSWORD_PREFIX + config.host;
          await this._secrets.store(passwordKey, config.password);

          // Add to recent connections
          await this.addRecentConnection(configToStore);
        }

        guard.resolve();
      }).on('error', (err) => {
        this._isConnected = false;
        guard.reject(err);
      }).on('end', () => {
        // 鍏抽敭淇锛氫笉鍦ㄨ繖閲岃缃?isConnected = false
        // end/close 浜嬩欢鍙兘鍦ㄥ崟涓?channel 鍏抽棴鏃惰瑙﹀彂
      }).on('close', () => {
      }).connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
      });
    });
  }

  public async disconnect(): Promise<void> {
    if (this._sshClient) {
      this._sshClient.end();
      this._sshClient = null;
    }
    const wasConnected = this._isConnected;
    this._isConnected = false;
    if (wasConnected) {
      this._onDidChangeConnectionStatus.fire(false);
    }
  }

  /**
   * 鎵ц shell 鍛戒护
   * @param command 瑕佹墽琛岀殑鍛戒护锛堜細鑷姩杩涜 shell 杞箟锛?   */
  public async execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const guard = new PromiseGuard<string>(resolve, reject);

      this.sshClient.exec(command, (err, stream) => {
        if (err) {
          guard.reject(err);
          return;
        }

        let output = '';
        let errorOutput = '';

        stream.on('data', (data: string | Buffer) => {
          output += data.toString();
        });

        stream.stderr.on('data', (data: string | Buffer) => {
          errorOutput += data.toString();
        });

        stream.on('close', (code: number | undefined) => {
          if (code !== undefined && code !== 0) {
            const fullError = errorOutput ? `${errorOutput}` : `Command exited with code ${code}`;
            guard.reject(new Error(fullError));
          } else {
            guard.resolve(output);
          }
        });

        stream.on('error', (streamErr: Error) => {
          guard.reject(streamErr);
        });
      });
    });
  }

  public async downloadFile(
    remotePath: string,
    localPath: string,
    onProgress?: (chunkBytes: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const guard = new PromiseGuard<void>(resolve, reject);

      const escapedPath = shellEscape(remotePath);
      this.sshClient.exec(`cat ${escapedPath}`, (err, stream) => {
        if (err) {
          guard.reject(err);
          return;
        }

        const writeStream = fs.createWriteStream(localPath);
        let streamClosed = false;

        const cleanup = () => {
          if (!streamClosed) {
            streamClosed = true;
            writeStream.end();
          }
        };

        stream.on('data', (data: string | Buffer) => {
          if (!streamClosed) {
            const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
            writeStream.write(chunk);
            onProgress?.(chunk.length);
          }
        });

        stream.stderr.on('data', (data: string | Buffer) => {
          cleanup();
          guard.reject(new Error(data.toString()));
        });

        stream.on('close', (code: number | undefined) => {
          cleanup();
          if (code !== undefined && code !== 0) {
            guard.reject(new Error(`Download failed with code ${code}`));
          } else {
            guard.resolve();
          }
        });

        stream.on('error', (streamErr: Error) => {
          cleanup();
          guard.reject(streamErr);
        });

        writeStream.on('error', (writeErr) => {
          cleanup();
          guard.reject(writeErr);
        });

        writeStream.on('finish', () => {
          // Stream finished successfully
        });
      });
    });
  }

  public async uploadFile(localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const guard = new PromiseGuard<void>(resolve, reject);

      const escapedPath = shellEscape(remotePath);
      this.sshClient.exec(`cat > ${escapedPath}`, (err, stream) => {
        if (err) {
          guard.reject(err);
          return;
        }

        const readStream = fs.createReadStream(localPath);
        let streamEnded = false;

        const cleanup = () => {
          if (!streamEnded) {
            streamEnded = true;
            stream.end();
          }
        };

        readStream.on('data', (data: string | Buffer) => {
          if (!streamEnded) {
            stream.write(data);
          }
        });

        readStream.on('end', () => {
          if (!streamEnded) {
            stream.end();
          }
        });

        readStream.on('error', (readErr) => {
          cleanup();
          guard.reject(readErr);
        });

        stream.stderr.on('data', (data: string | Buffer) => {
          cleanup();
          guard.reject(new Error(data.toString()));
        });

        stream.on('exit', (code: number | undefined) => {
          streamEnded = true;
          if (code !== undefined && code !== 0) {
            guard.reject(new Error(`Upload failed with code ${code}`));
          } else {
            guard.resolve();
          }
        });

        stream.on('close', (code: number | undefined) => {
          streamEnded = true;
          if (code !== undefined && code !== 0) {
            guard.reject(new Error(`Upload failed with code ${code}`));
          } else {
            guard.resolve();
          }
        });

        stream.on('error', (streamErr: Error) => {
          cleanup();
          guard.reject(streamErr);
        });
      });
    });
  }

  /**
   * 涓婁紶鏈湴璺緞锛堟枃浠舵垨鏂囦欢澶癸級鍒拌繙绋嬭澶?   * @param localPath 鏈湴鏂囦欢鎴栨枃浠跺す璺緞
   * @param remotePath 杩滅▼鐩爣璺緞
   */
  public async uploadPath(localPath: string, remotePath: string): Promise<void> {
    const stat = fs.statSync(localPath);
    if (stat.isDirectory()) {
      await this.uploadDirectory(localPath, remotePath);
    } else {
      await this.uploadFile(localPath, remotePath);
    }
  }

  /**
   * 閫掑綊涓婁紶鏂囦欢澶瑰埌杩滅▼璁惧
   * @param localDir 鏈湴鏂囦欢澶硅矾寰?   * @param remoteDir 杩滅▼鐩爣璺緞
   */
  private async uploadDirectory(localDir: string, remoteDir: string): Promise<void> {
    await this.createDirectory(remoteDir);

    // 璇诲彇鏈湴鐩綍鍐呭
    const entries = fs.readdirSync(localDir, { withFileTypes: true });

    for (const entry of entries) {
      const localEntryPath = path.join(localDir, entry.name);
      const remoteEntryPath = path.posix.join(remoteDir, entry.name);

      if (entry.isDirectory()) {
        await this.uploadDirectory(localEntryPath, remoteEntryPath);
      } else if (entry.isFile()) {
        await this.uploadFile(localEntryPath, remoteEntryPath);
      }
    }
  }

  /**
   * 妫€鏌ヨ矾寰勬槸鍚﹀瓨鍦ㄥ苟鑾峰彇鐘舵€?   */
  public async statPath(remotePath: string): Promise<{ exists: boolean; isDirectory: boolean; size: number; mtime: number }> {
    const escapedPath = shellEscape(remotePath);
    try {
      // 浣跨敤 stat 鍛戒护鑾峰彇淇℃伅
      const statOutput = await this.execCommand(`stat -c '%F:%s:%Y' ${escapedPath} 2>/dev/null || echo 'NOT_FOUND'`);
      const trimmed = statOutput.trim();

      if (trimmed === 'NOT_FOUND') {
        return { exists: false, isDirectory: false, size: 0, mtime: Date.now() };
      }

      const parts = trimmed.split(':');
      const type = parts[0];
      const size = parseInt(parts[1] || '0', 10);
      const mtime = parseInt(parts[2] || '0', 10) * 1000;

      return {
        exists: true,
        isDirectory: type === 'directory',
        size: isNaN(size) ? 0 : size,
        mtime: isNaN(mtime) ? Date.now() : mtime
      };
    } catch {
      // 濡傛灉 stat 澶辫触锛屽皾璇曠敤 ls 鍒ゆ柇
      try {
        const escapedPath = shellEscape(remotePath);
        await this.execCommand(`ls -ld ${escapedPath} >/dev/null 2>&1`);
        return { exists: true, isDirectory: false, size: 0, mtime: Date.now() };
      } catch {
        return { exists: false, isDirectory: false, size: 0, mtime: Date.now() };
      }
    }
  }

  /**
   * 鍒涘缓鐩綍
   */
  public async createDirectory(remotePath: string): Promise<void> {
    const escapedPath = shellEscape(remotePath);
    await this.execCommand(`mkdir -p ${escapedPath}`);
  }

  /**
   * 鍒犻櫎鏂囦欢鎴栫洰褰?   */
  public async deletePath(remotePath: string, recursive: boolean = false): Promise<void> {
    const escapedPath = shellEscape(remotePath);
    const flag = recursive ? '-rf' : '-f';
    await this.execCommand(`rm ${flag} ${escapedPath}`);
  }

  /**
   * 閲嶅懡鍚嶆垨绉诲姩鏂囦欢
   */
  public async renamePath(oldPath: string, newPath: string, overwrite: boolean = false): Promise<void> {
    const escapedOldPath = shellEscape(oldPath);
    const escapedNewPath = shellEscape(newPath);
    const force = overwrite ? '-f' : '';
    await this.execCommand(`mv ${force} ${escapedOldPath} ${escapedNewPath}`);
  }

  /**
   * 澶嶅埗鏂囦欢鎴栫洰褰?   */
  public async copyPath(sourcePath: string, destPath: string, overwrite: boolean = false): Promise<void> {
    const escapedSrc = shellEscape(sourcePath);
    const escapedDest = shellEscape(destPath);
    const force = overwrite ? '-f' : '';
    await this.execCommand(`cp -r ${force} ${escapedSrc} ${escapedDest}`);
  }

  /**
   * 鍒楀嚭鐩綍鍐呭
   */
  public async listDirectory(remotePath: string): Promise<string> {
    const escapedPath = shellEscape(remotePath);
    return await this.execCommand(`ls -1Ap ${escapedPath}`);
  }

  /**
   * 鎵撳紑浜や簰寮?shell
   */
  public openShell(): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      this.sshClient.shell((err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stream);
      });
    });
  }
}


