import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionManager } from './ConnectionManager';
import { DuoFileSystemProvider } from './DuoFileSystemProvider';
import { DuoTerminalProvider } from './DuoTerminalProvider';
import { DeviceManager } from './DeviceManager';
import { DeviceTreeDataProvider } from './DeviceTreeDataProvider';
import {
  DuoSearchContentProvider,
  DuoSearchLinkProvider,
  executeSearch,
  SEARCH_SCHEME
} from './searchManager';

export async function activate(context: vscode.ExtensionContext) {
  console.log('Duo-SCP-Edit is now active!');

  const connectionManager = ConnectionManager.instance;

  // Initialize with context for secrets/state storage
  connectionManager.initialize(context);

  const fileSystemProvider = new DuoFileSystemProvider();

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('duo', fileSystemProvider, {
      isCaseSensitive: true,
      isReadonly: false
    })
  );

  // Check for existing duo:// workspace folders and auto-reconnect
  const duoFolder = vscode.workspace.workspaceFolders?.find(f => f.uri.scheme === 'duo');
  if (duoFolder) {
    console.log('Found duo:// workspace folder, attempting auto-reconnect...');
    tryAutoReconnect(connectionManager);
  }

  // Add listener for workspace folder changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
      const addedDuoFolder = event.added.some(f => f.uri.scheme === 'duo');
      if (addedDuoFolder && !connectionManager.isConnected) {
        console.log('duo:// folder added, attempting auto-reconnect...');
        tryAutoReconnect(connectionManager);
      }
    })
  );

  const connectCommand = vscode.commands.registerCommand('duo.connect', async () => {
    const config = vscode.workspace.getConfiguration('duo');
    const recentConnections = connectionManager.getRecentConnections();

    // If there are recent connections, show them first
    if (recentConnections.length > 0) {
      const items: vscode.QuickPickItem[] = [
        { label: '$(plus) 杈撳叆鏂拌繛鎺?..', description: '', detail: '鎵嬪姩杈撳叆杩炴帴淇℃伅' }
      ];

      for (const conn of recentConnections) {
        const date = new Date(conn.lastConnected);
        const timeAgo = getTimeAgo(date);
        items.push({
          label: conn.host,
          description: `(${conn.username})`,
          detail: `涓婃杩炴帴: ${timeAgo}`
        });
      }

      const selected = await vscode.window.showQuickPick(items, {
        title: '閫夋嫨璁惧杩炴帴',
        placeHolder: '閫夋嫨鏈€杩戣繛鎺ョ殑璁惧鎴栬緭鍏ユ柊杩炴帴'
      });

      if (!selected) {
        return;
      }

      // If user selected "杈撳叆鏂拌繛鎺?, continue to manual input
      if (!selected.detail?.startsWith('涓婃杩炴帴:')) {
        await showManualConnectDialog(connectionManager, config);
        return;
      }

      // User selected a recent connection - try to connect with saved password
      const selectedConn = recentConnections.find(c => c.host === selected.label);
      if (selectedConn) {
        await connectWithRecent(connectionManager, selectedConn);
        return;
      }
    }

    // No recent connections or user wants manual input
    await showManualConnectDialog(connectionManager, config);
  });

  const browseCommand = vscode.commands.registerCommand('duo.browse', async () => {
    if (!connectionManager.isConnected) {
      vscode.window.showErrorMessage('Please select a file or folder in Explorer first.');
      return;
    }

    await browseDirectory('/');
  });

  const addToWorkspaceCommand = vscode.commands.registerCommand('duo.addToWorkspace', async () => {
    if (!connectionManager.isConnected) {
      const connectChoice = await vscode.window.showWarningMessage(
        'Not connected. Connect first?',
        'Connect',
        'Cancel'
      );
      if (connectChoice === 'Connect') {
        await vscode.commands.executeCommand('duo.connect');
      }
      if (!connectionManager.isConnected) {
        return;
      }
    }

    const uri = vscode.Uri.parse('duo:///');
    const workspaceFolders = vscode.workspace.workspaceFolders || [];

    const alreadyMounted = workspaceFolders.some(folder => folder.uri.scheme === 'duo');
    if (alreadyMounted) {
      vscode.window.showWarningMessage('Milk-V Duo is already in workspace');
      return;
    }

    // The Extension Host will restart, but credentials are saved
    const added = vscode.workspace.updateWorkspaceFolders(
      workspaceFolders.length,
      0,
      { uri: uri, name: 'Milk-V Duo' }
    );

    if (!added) {
      vscode.window.showErrorMessage('Please select a file or folder in Explorer first.');
    }
    // Don't show success message - Extension Host will restart anyway
  });

  const openTerminalCommand = vscode.commands.registerCommand('duo.openTerminal', async () => {
    if (!connectionManager.isConnected) {
      const choice = await vscode.window.showWarningMessage(
        'Not connected. Connect first?',
        'Connect',
        'Cancel'
      );
      if (choice === 'Connect') {
        await vscode.commands.executeCommand('duo.connect');
      }
      if (!connectionManager.isConnected) {
        return;
      }
    }

    const pty = new DuoTerminalProvider(connectionManager);
    const terminal = vscode.window.createTerminal({
      name: 'Milk-V Duo',
      pty
    });
    terminal.show();
  });

  // 娉ㄥ唽鎼滅储鍔熻兘
  const searchContentProvider = new DuoSearchContentProvider();
  const searchContentProviderRegistration = vscode.workspace.registerTextDocumentContentProvider(
    SEARCH_SCHEME,
    searchContentProvider
  );

  const searchLinkProviderRegistration = vscode.languages.registerDocumentLinkProvider(
    { scheme: SEARCH_SCHEME },
    new DuoSearchLinkProvider()
  );

  const findCommand = vscode.commands.registerCommand('duo.find', async () => {
    await executeSearch(connectionManager, searchContentProvider);
  });

  const uploadLocalFileCommand = vscode.commands.registerCommand('duo.uploadLocalFile', async (uri: vscode.Uri) => {
    if (!uri) {
      vscode.window.showErrorMessage('Please select a file or folder in Explorer first.');
      return;
    }

    const localPath = uri.fsPath;
    const fileName = path.basename(localPath);

    // 妫€鏌ヨ繛鎺ョ姸鎬?    if (!connectionManager.isConnected) {
      const connectChoice = await vscode.window.showWarningMessage(
        '鏈繛鎺ュ埌璁惧銆傝鍏堣繛鎺?Milk-V Duo 璁惧',
        '杩炴帴璁惧',
        '鍙栨秷'
      );
      if (connectChoice === '杩炴帴璁惧') {
        await vscode.commands.executeCommand('duo.connect');
      }
      return;
    }

    // 璇㈤棶杩滅▼鐩爣璺緞
    const remotePath = await vscode.window.showInputBox({
      prompt: '涓婁紶鍒拌繙绋嬭澶囩殑璺緞',
      value: `/root/${fileName}`,
      placeHolder: '渚嬪: /root/myfile.txt 鎴?/root/myfolder',
      ignoreFocusOut: true
    });

    if (!remotePath) {
      return;
    }

    // 鎵ц涓婁紶
    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `姝ｅ湪涓婁紶 ${fileName} 鍒?Milk-V Duo...`,
        cancellable: false
      }, async () => {
        await connectionManager.uploadPath(localPath, remotePath);
      });

      vscode.window.showInformationMessage(`涓婁紶鎴愬姛: ${fileName} 鈫?${remotePath}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`涓婁紶澶辫触: ${err.message}`);
    }
  });

  // 鐩戝惉鏂囨。鎵撳紑浜嬩欢锛屽鐞?URI fragment 涓殑琛屽彿璺宠浆
  const openEditorListener = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (!editor) {
      return;
    }
    const uri = editor.document.uri;
    if (uri.scheme !== 'duo') {
      return;
    }
    // 妫€鏌ユ槸鍚︽湁 #L123 鏍煎紡鐨?fragment
    const fragment = uri.fragment;
    const lineMatch = fragment.match(/^L(\d+)$/);
    if (lineMatch) {
      const lineNum = parseInt(lineMatch[1], 10) - 1; // 杞崲涓?0-based
      if (lineNum >= 0 && lineNum < editor.document.lineCount) {
        const position = new vscode.Position(lineNum, 0);
        const range = new vscode.Range(position, position);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      }
    }
  });

  context.subscriptions.push(connectCommand);
  context.subscriptions.push(browseCommand);
  context.subscriptions.push(addToWorkspaceCommand);
  context.subscriptions.push(openTerminalCommand);
  context.subscriptions.push(findCommand);
  context.subscriptions.push(uploadLocalFileCommand);
  context.subscriptions.push(searchContentProviderRegistration);
  context.subscriptions.push(searchLinkProviderRegistration);
  context.subscriptions.push(openEditorListener);

  // Initialize DeviceManager
  const deviceManager = DeviceManager.instance;
  deviceManager.initialize(context);

  // Import from recent connections
  await deviceManager.importFromRecentConnections();

  // Create TreeView
  const treeDataProvider = new DeviceTreeDataProvider(context, deviceManager);
  const treeView = vscode.window.createTreeView('duoDevices', {
    treeDataProvider,
    canSelectMany: false
  });

  // Register TreeView commands
  const treeCommands = [
    vscode.commands.registerCommand('duoDevices.addDevice', () => treeDataProvider.addDevice()),
    vscode.commands.registerCommand('duoDevices.refresh', () => treeDataProvider.refresh()),
    vscode.commands.registerCommand('duoDevices.connectDevice', (item) => treeDataProvider.connectDevice(item)),
    vscode.commands.registerCommand('duoDevices.disconnectDevice', (item) => treeDataProvider.disconnectDevice(item)),
    vscode.commands.registerCommand('duoDevices.editDevice', (item) => treeDataProvider.editDevice(item)),
    vscode.commands.registerCommand('duoDevices.deleteDevice', (item) => treeDataProvider.deleteDevice(item)),
    vscode.commands.registerCommand('duoDevices.openTerminal', (item) => treeDataProvider.openTerminal(item)),
    vscode.commands.registerCommand('duoDevices.mountWorkspace', (item) => treeDataProvider.mountWorkspace(item)),
    vscode.commands.registerCommand('duoDevices.rebootDevice', (item) => treeDataProvider.rebootDevice(item))
  ];

  context.subscriptions.push(treeView, ...treeCommands);
}

async function browseDirectory(path: string) {
  const connectionManager = ConnectionManager.instance;

  try {
    const entries = await connectionManager.listDirectory(path);
    const lines = entries.split('\n').filter(line => line.trim() !== '');

    const items: vscode.QuickPickItem[] = [];

    if (path !== '/') {
      items.push({ label: '..', description: 'Go back', kind: vscode.QuickPickItemKind.Separator });
    }

    for (const line of lines) {
      const name = line.trim();
      if (name === '.' || name === '..') {
        continue;
      }

      if (name.endsWith('/')) {
        items.push({
          label: name.slice(0, -1),
          description: 'Directory',
          detail: path + name
        });
      } else {
        items.push({
          label: name,
          description: 'File',
          detail: path + (path === '/' ? '' : '/') + name
        });
      }
    }

    const selected = await vscode.window.showQuickPick(items, {
      title: `Browse: ${path}`,
      placeHolder: 'Select a file or directory'
    });

    if (!selected) {
      return;
    }

    if (selected.label === '..') {
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
      await browseDirectory(parentPath);
      return;
    }

    const fullPath = selected.detail!;

    if (selected.description === 'Directory') {
      await browseDirectory(fullPath);
    } else {
      const uri = vscode.Uri.parse(`duo://${fullPath}`);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    }

  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to browse: ${err.message}`);
  }
}

/**
 * Helper to try auto-reconnect with proper error handling
 */
async function tryAutoReconnect(connectionManager: ConnectionManager): Promise<void> {
  try {
    if (connectionManager.hasStoredCredentials()) {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Reconnecting to Milk-V Duo...',
        cancellable: false
      }, async () => {
        await connectionManager.autoConnect();
        vscode.window.showInformationMessage('Reconnected to Milk-V Duo!');
      });
    }
  } catch (err: any) {
    console.error('Auto-reconnect failed:', err);
    // Don't show error message on auto-reconnect - fail silently
    // User can manually connect if needed
  }
}

/**
 * Helper to get human-readable time ago string
 */
function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} days ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hours ago`;
  } else if (diffMins > 0) {
    return `${diffMins} minutes ago`;
  } else {
    return 'Just now';
  }
}

/**
 * Show manual connection input dialog
 */
async function showManualConnectDialog(
  connectionManager: ConnectionManager,
  config: vscode.WorkspaceConfiguration
): Promise<void> {
  const host = await vscode.window.showInputBox({
    prompt: 'Enter Milk-V Duo IP Address',
    value: config.get<string>('host', '192.168.31.63')
  });

  if (!host) {
    return;
  }

  const username = await vscode.window.showInputBox({
    prompt: 'Enter SSH Username',
    value: config.get<string>('username', 'root')
  });

  if (!username) {
    return;
  }

  const password = await vscode.window.showInputBox({
    prompt: 'Enter SSH Password',
    value: config.get<string>('password', ''),
    password: true
  });

  if (password === undefined) {
    return;
  }

  const port = config.get<number>('port', 22);

  await doConnect(connectionManager, { host, port, username, password });
}

/**
 * Connect using a recent connection (load password from secrets)
 */
async function connectWithRecent(
  connectionManager: ConnectionManager,
  recentConn: { host: string; port: number; username: string }
): Promise<void> {
  // We need to get the password from secrets. Use autoConnect logic.
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Connecting to ${recentConn.host}...`,
    cancellable: false
  }, async () => {
    try {
      // Use the new getStoredPassword method instead of accessing private member
      const password = await connectionManager.getStoredPassword(recentConn.host);

      if (!password) {
        // No password stored, fall back to manual input
        const config = vscode.workspace.getConfiguration('duo');
        const newPassword = await vscode.window.showInputBox({
          prompt: `Enter password for ${recentConn.username}@${recentConn.host}`,
          password: true
        });
        if (newPassword === undefined) {
          return;
        }
        await doConnect(connectionManager, { ...recentConn, password: newPassword });
        return;
      }

      await doConnect(connectionManager, { ...recentConn, password });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Connection failed: ${err.message}`);
    }
  });
}

/**
 * Actually perform the connection and show post-connect options
 */
async function doConnect(
  connectionManager: ConnectionManager,
  connConfig: { host: string; port: number; username: string; password: string }
): Promise<void> {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Connecting to ${connConfig.host}...`,
    cancellable: false
  }, async () => {
    try {
      await connectionManager.connect(connConfig);

      const choice = await vscode.window.showInformationMessage(
        `Connected to ${connConfig.host} successfully!`,
        'Add to Workspace',
        'Open Terminal',
        'Browse Files',
        'Later'
      );

      if (choice === 'Add to Workspace') {
        await vscode.commands.executeCommand('duo.addToWorkspace');
      } else if (choice === 'Open Terminal') {
        await vscode.commands.executeCommand('duo.openTerminal');
      } else if (choice === 'Browse Files') {
        await browseDirectory('/');
      }

    } catch (err: any) {
      vscode.window.showErrorMessage(`Connection failed: ${err.message}`);
    }
  });
}

export function deactivate() {
  console.log('Duo-SCP-Edit is now deactivated.');
  ConnectionManager.instance.disconnect().catch(() => {});
}

