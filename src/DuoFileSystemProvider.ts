import * as vscode from 'vscode';
import * as fs from 'fs';
import { file } from 'tmp-promise';
import { ConnectionManager } from './ConnectionManager';

interface CacheEntry {
  entries: [string, vscode.FileType][];
  timestamp: number;
}

interface StatCacheEntry {
  type: vscode.FileType;
  size: number;
  mtime: number;
  ctime: number;
  timestamp: number;
}

export class DuoFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

  private directoryCache = new Map<string, CacheEntry>();
  private statCache = new Map<string, StatCacheEntry>();
  private readonly CACHE_TTL = 2000; // 2 seconds
  private readonly STAT_CACHE_TTL = 5000; // 5 seconds
  private readonly MAX_CACHE_SIZE = 500; // 鏈€澶х紦瀛樻潯鐩暟

  private get connectionManager(): ConnectionManager {
    return ConnectionManager.instance;
  }

  /**
   * 纭繚宸茶繛鎺ュ埌璁惧锛屽鏋滄湭杩炴帴鍒欑瓑寰呭悗閲嶈瘯
   */
  private async ensureConnected(): Promise<void> {
    if (!this.connectionManager.isConnected) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (!this.connectionManager.isConnected) {
        throw vscode.FileSystemError.Unavailable('Not connected to Duo device');
      }
    }
  }

  watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  /**
   * 娓呯悊杩囧ぇ鐨勭紦瀛橈紝纭繚涓嶈秴杩囨渶澶ч檺鍒?   */
  private trimCache(): void {
    const totalSize = this.directoryCache.size + this.statCache.size;
    if (totalSize > this.MAX_CACHE_SIZE) {
      // 娓呯悊鎵€鏈夌紦瀛橈紙绠€鍗曠瓥鐣ワ級
      this.directoryCache.clear();
      this.statCache.clear();
    }
  }

  /**
   * 娓呴櫎鎸囧畾璺緞鐨勭紦瀛橈紙鍖呮嫭瀛愯矾寰勶級
   */
  private invalidateCache(path: string): void {
    // 娓呴櫎璇ヨ矾寰勭殑鐖剁洰褰曠紦瀛?    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
    this.directoryCache.delete(parentPath);

    // 娓呴櫎鎵€鏈変互璇ヨ矾寰勫紑澶寸殑缂撳瓨锛堝瓙鐩綍锛?    for (const key of this.directoryCache.keys()) {
      if (key.startsWith(path)) {
        this.directoryCache.delete(key);
      }
    }

    // 娓呴櫎 statCache 涓浉鍏崇殑鏉＄洰
    for (const key of this.statCache.keys()) {
      if (key.startsWith(path)) {
        this.statCache.delete(key);
      }
    }
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    await this.ensureConnected();

    const remotePath = uri.path || '/';
    const now = Date.now();

    // 浼樺厛鏌?statCache
    const cachedStat = this.statCache.get(remotePath);
    if (cachedStat && (now - cachedStat.timestamp) < this.STAT_CACHE_TTL) {
      // 缂撳瓨鍛戒腑锛岃繑鍥炵湡瀹炵殑鏂囦欢淇℃伅
      return {
        type: cachedStat.type,
        ctime: cachedStat.ctime,
        mtime: cachedStat.mtime,
        size: cachedStat.size
      };
    }

    // 缂撳瓨鏈懡涓紝璋冪敤 SSH stat
    const statInfo = await this.connectionManager.statPath(remotePath);

    if (!statInfo.exists) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    // 瀛樺叆 statCache
    const fileType = statInfo.isDirectory ? vscode.FileType.Directory : vscode.FileType.File;
    this.statCache.set(remotePath, {
      type: fileType,
      size: statInfo.size,
      mtime: statInfo.mtime,
      ctime: statInfo.mtime,
      timestamp: now
    });

    return {
      type: fileType,
      ctime: statInfo.mtime,
      mtime: statInfo.mtime,
      size: statInfo.size
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    await this.ensureConnected();

    const remotePath = uri.path || '/';
    const now = Date.now();

    // 妫€鏌ョ紦瀛樻槸鍚﹀懡涓笖鏈繃鏈?    const cached = this.directoryCache.get(remotePath);
    if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
      return cached.entries;
    }

    const output = await this.connectionManager.listDirectory(remotePath);

    // 缂撳瓨鍙兘宸叉弧锛屽厛娓呯悊
    this.trimCache();

    const entries: [string, vscode.FileType][] = [];
    const lines = output.split('\n').filter(line => line.trim() !== '');

    for (const line of lines) {
      const name = line.trim();

      if (name === '.' || name === '..') {
        continue;
      }

      if (name.endsWith('/')) {
        const dirName = name.slice(0, -1);
        const fileType = vscode.FileType.Directory;
        entries.push([dirName, fileType]);
        // 鍚屾椂濉厖 statCache
        const fullPath = remotePath === '/' ? `/${dirName}` : `${remotePath}/${dirName}`;
        this.statCache.set(fullPath, {
          type: fileType,
          size: 0,
          mtime: now,
          ctime: now,
          timestamp: now
        });
      } else {
        const fileType = vscode.FileType.File;
        entries.push([name, fileType]);
        // 鍚屾椂濉厖 statCache
        const fullPath = remotePath === '/' ? `/${name}` : `${remotePath}/${name}`;
        this.statCache.set(fullPath, {
          type: fileType,
          size: 0,
          mtime: now,
          ctime: now,
          timestamp: now
        });
      }
    }

    // 瀛樺叆缂撳瓨
    this.directoryCache.set(remotePath, { entries, timestamp: now });

    return entries;
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    await this.ensureConnected();

    const remotePath = uri.path;
    await this.connectionManager.createDirectory(remotePath);
    this.invalidateCache(remotePath);
    this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    await this.ensureConnected();

    const remotePath = uri.path;
    const tmp = await file();

    try {
      const fileName = remotePath.split('/').pop() || remotePath;
      let fileSize = 0;

      try {
        const statInfo = await this.connectionManager.statPath(remotePath);
        if (statInfo.exists && !statInfo.isDirectory) {
          fileSize = statInfo.size;
        }
      } catch {
        // Best effort: we can still download without known total size.
      }

      const content = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Downloading ${fileName}...`,
        cancellable: false
      }, async (progress) => {
        let downloaded = 0;
        let lastPercent = 0;
        let lastReportedBytes = 0;

        await this.connectionManager.downloadFile(remotePath, tmp.path, (chunkBytes) => {
          downloaded += chunkBytes;

          if (fileSize > 0) {
            const percent = Math.min(100, Math.floor((downloaded / fileSize) * 100));
            if (percent > lastPercent) {
              progress.report({ increment: percent - lastPercent, message: `${percent}%` });
              lastPercent = percent;
            }
          } else if (downloaded - lastReportedBytes >= 256 * 1024) {
            const kb = Math.round(downloaded / 1024);
            progress.report({ message: `${kb} KB downloaded` });
            lastReportedBytes = downloaded;
          }
        });

        if (fileSize > 0 && lastPercent < 100) {
          progress.report({ increment: 100 - lastPercent, message: '100%' });
        }

        return fs.promises.readFile(tmp.path);
      });

      vscode.window.showInformationMessage(`Download completed: ${fileName}`);
      return content;
    } finally {
      tmp.cleanup();
    }
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
    await this.ensureConnected();

    const remotePath = uri.path;
    const tmp = await file();

    try {
      await fs.promises.writeFile(tmp.path, content);
      await this.connectionManager.uploadFile(tmp.path, remotePath);
      this.invalidateCache(remotePath);
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } finally {
      tmp.cleanup();
    }
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean; }): Promise<void> {
    await this.ensureConnected();

    const remotePath = uri.path;
    await this.connectionManager.deletePath(remotePath, options.recursive);
    this.invalidateCache(remotePath);
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): Promise<void> {
    await this.ensureConnected();

    const oldPath = oldUri.path;
    const newPath = newUri.path;
    await this.connectionManager.renamePath(oldPath, newPath, options.overwrite);
    this.invalidateCache(oldPath);
    this.invalidateCache(newPath);
    this._emitter.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri }
    ]);
  }

  async copy(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean; }): Promise<void> {
    await this.ensureConnected();

    const srcPath = source.path;
    const destPath = destination.path;
    await this.connectionManager.copyPath(srcPath, destPath, options.overwrite);
    this.invalidateCache(destPath);
    this._emitter.fire([{ type: vscode.FileChangeType.Created, uri: destination }]);
  }
}


