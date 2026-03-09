import * as vscode from 'vscode';
import { ConnectionManager, shellEscape } from './ConnectionManager';

export const SEARCH_SCHEME = 'duo-search';

/**
 * 搜索结果内容提供者 - 提供 duo-search:// 协议的文档内容
 */
export class DuoSearchContentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly results = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.results.get(uri.toString()) || 'No search results.';
  }

  update(uri: vscode.Uri, content: string): void {
    this.results.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  clear(): void {
    this.results.clear();
  }
}

/**
 * 搜索结果链接提供者 - 让搜索结果中的文件路径可点击
 */
export class DuoSearchLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentLink[]> {
    const links: vscode.DocumentLink[] = [];
    const text = document.getText();

    // 正则匹配: 文件名路径（一行一个，以 / 开头）
    // 格式: /path/to/file.txt
    const regex = /^(\/[^\s]+)$/gm;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (token.isCancellationRequested) {
        break;
      }

      const filePath = match[1];
      const fullMatch = match[0];

      // 跳过调试信息行
      if (fullMatch.includes('===') || fullMatch.includes('Step') || fullMatch.includes('Command') || fullMatch.includes('Starting')) {
        continue;
      }

      // 计算链接范围
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + fullMatch.length);
      const range = new vscode.Range(startPos, endPos);

      // 构建目标 URI - duo:// 协议
      const targetUri = vscode.Uri.parse(`duo://${filePath}`);

      const link = new vscode.DocumentLink(range, targetUri);
      link.tooltip = `Open ${filePath}`;
      links.push(link);
    }

    return links;
  }
}

/**
 * 构建全盘文件名搜索命令
 */
function buildFileNameSearchCommand(term: string): string {
  // 安全转义：使用导入的 shellEscape 函数，但需要去掉首尾单引号
  // 因为 find 命令中需要用 * 通配符
  const safeTerm = shellEscape(term).slice(1, -1);

  // 构建命令：使用 -prune 排除危险目录，-iname 忽略大小写
  return `find / \\( -path /proc -o -path /sys -o -path /dev -o -path /run -o -path /tmp \\) -prune -o -iname '*${safeTerm}*' -print 2>/dev/null`;
}

/**
 * 执行搜索命令 - 只搜文件名版本
 */
export async function executeSearch(
  connectionManager: ConnectionManager,
  contentProvider: DuoSearchContentProvider
): Promise<void> {
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

  // 获取搜索词
  const searchTerm = await vscode.window.showInputBox({
    prompt: 'Enter filename to search (wildcard * supported)',
    placeHolder: 'Search filename (e.g., config.json, *.c)',
    ignoreFocusOut: true
  });

  if (!searchTerm || !searchTerm.trim()) {
    return;
  }

  // 执行搜索并显示进度
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Searching filename "${searchTerm}"...`,
    cancellable: true
  }, async (progress, token) => {
    let output = '';
    let timedOut = false;
    let debugInfo = '';

    const addDebug = (msg: string) => {
      debugInfo += msg + '\n';
      console.log(`[DuoSearch] ${msg}`);
    };

    try {
      addDebug(`Starting filename search for "${searchTerm}"`);

      // ========== 第一步：测试连接 ==========
      addDebug('Step 1: Testing connection...');
      try {
        const pwdOutput = await connectionManager.execCommand('pwd');
        addDebug(`pwd success: ${pwdOutput.trim()}`);
      } catch (e) {
        addDebug(`pwd failed: ${e}`);
      }

      // ========== 第二步：构建 find 命令（只搜文件名）==========
      addDebug('Step 2: Building find command...');

      const command = buildFileNameSearchCommand(searchTerm);
      addDebug(`Command: ${command}`);

      // ========== 第三步：执行搜索（30秒超时）==========
      addDebug('Step 3: Executing find (timeout: 30s)...');

      const searchPromise = connectionManager.execCommand(command);
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('SEARCH_TIMEOUT')), 30000);
      });

      // 监听取消
      let cancelDisposable: vscode.Disposable | undefined;
      cancelDisposable = token.onCancellationRequested(() => {
        addDebug('Search cancelled by user');
      });

      try {
        output = await Promise.race([searchPromise, timeoutPromise]);
        addDebug(`Search completed, output length: ${output.length}`);
      } catch (err: any) {
        if (err.message === 'SEARCH_TIMEOUT') {
          timedOut = true;
          addDebug('⏱️  Search timed out after 30 seconds');
        } else {
          addDebug(`Search error: ${err.message}`);
          throw err;
        }
      } finally {
        cancelDisposable?.dispose();
      }

      // ========== 第四步：准备显示内容 ==========
      addDebug('Step 4: Preparing results...');

      let displayContent = `=== Duo Filename Search ===\n`;
      displayContent += `${debugInfo}\n`;
      displayContent += `===========================\n\n`;

      if (timedOut) {
        displayContent += `Filename search for "${searchTerm}"\n\n`;
        displayContent += `⏱️  Search timed out after 30 seconds.\n\n`;
        if (output && output.trim()) {
          const lines = output.split('\n').filter(line => line.trim() !== '');
          displayContent += `Partial results (${lines.length} files):\n\n`;
          displayContent += output;
        }
      } else if (!output || output.trim() === '') {
        displayContent += `Filename search for "${searchTerm}"\n\n`;
        displayContent += `No matching files found.\n`;
      } else {
        const lines = output.split('\n').filter(line => line.trim() !== '');
        displayContent += `Filename search for "${searchTerm}" (${lines.length} files found)\n\n`;
        displayContent += output;
      }

      // ========== 第五步：显示结果 ==========
      addDebug('Step 5: Displaying results...');

      const resultUri = vscode.Uri.parse(`${SEARCH_SCHEME}:/Filename%20Search?${encodeURIComponent(searchTerm)}`);
      contentProvider.update(resultUri, displayContent);

      const doc = await vscode.workspace.openTextDocument(resultUri);
      await vscode.window.showTextDocument(doc, { preview: false });

      addDebug('Done!');

    } catch (err: any) {
      const errorMsg = `Search failed: ${err.message}`;
      addDebug(errorMsg);

      // 即使出错也显示调试信息
      const resultUri = vscode.Uri.parse(`${SEARCH_SCHEME}:/Filename%20Search?error`);
      const errorContent = `=== Duo Search Error ===\n\n${debugInfo}\n\nError: ${err.message}\n`;
      contentProvider.update(resultUri, errorContent);

      const doc = await vscode.workspace.openTextDocument(resultUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  });
}
