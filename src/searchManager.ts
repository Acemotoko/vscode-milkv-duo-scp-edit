import * as vscode from 'vscode';
import { ConnectionManager, shellEscape } from './ConnectionManager';

export const SEARCH_SCHEME = 'duo-search';

/**
 * 鎼滅储缁撴灉鍐呭鎻愪緵鑰?- 鎻愪緵 duo-search:// 鍗忚鐨勬枃妗ｅ唴瀹? */
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
 * 鎼滅储缁撴灉閾炬帴鎻愪緵鑰?- 璁╂悳绱㈢粨鏋滀腑鐨勬枃浠惰矾寰勫彲鐐瑰嚮
 */
export class DuoSearchLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentLink[]> {
    const links: vscode.DocumentLink[] = [];
    const text = document.getText();

    // 姝ｅ垯鍖归厤: 鏂囦欢鍚嶈矾寰勶紙涓€琛屼竴涓紝浠?/ 寮€澶达級
    // 鏍煎紡: /path/to/file.txt
    const regex = /^(\/[^\s]+)$/gm;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (token.isCancellationRequested) {
        break;
      }

      const filePath = match[1];
      const fullMatch = match[0];

      if (fullMatch.includes('===') || fullMatch.includes('Step') || fullMatch.includes('Command') || fullMatch.includes('Starting')) {
        continue;
      }

      // 璁＄畻閾炬帴鑼冨洿
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + fullMatch.length);
      const range = new vscode.Range(startPos, endPos);

      // 鏋勫缓鐩爣 URI - duo:// 鍗忚
      const targetUri = vscode.Uri.parse(`duo://${filePath}`);

      const link = new vscode.DocumentLink(range, targetUri);
      link.tooltip = `Open ${filePath}`;
      links.push(link);
    }

    return links;
  }
}

/**
 * 鏋勫缓鍏ㄧ洏鏂囦欢鍚嶆悳绱㈠懡浠? */
function buildFileNameSearchCommand(term: string): string {
  // 瀹夊叏杞箟锛氫娇鐢ㄥ鍏ョ殑 shellEscape 鍑芥暟锛屼絾闇€瑕佸幓鎺夐灏惧崟寮曞彿
  const safeTerm = shellEscape(term).slice(1, -1);

  return `find / \\( -path /proc -o -path /sys -o -path /dev -o -path /run -o -path /tmp \\) -prune -o -iname '*${safeTerm}*' -print 2>/dev/null`;
}

/**
 * 鎵ц鎼滅储鍛戒护 - 鍙悳鏂囦欢鍚嶇増鏈? */
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

  const searchTerm = await vscode.window.showInputBox({
    prompt: 'Enter filename to search (wildcard * supported)',
    placeHolder: 'Search filename (e.g., config.json, *.c)',
    ignoreFocusOut: true
  });

  if (!searchTerm || !searchTerm.trim()) {
    return;
  }

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

      // ========== 绗竴姝ワ細娴嬭瘯杩炴帴 ==========
      addDebug('Step 1: Testing connection...');
      try {
        const pwdOutput = await connectionManager.execCommand('pwd');
        addDebug(`pwd success: ${pwdOutput.trim()}`);
      } catch (e) {
        addDebug(`pwd failed: ${e}`);
      }

      // ========== 绗簩姝ワ細鏋勫缓 find 鍛戒护锛堝彧鎼滄枃浠跺悕锛?=========
      addDebug('Step 2: Building find command...');

      const command = buildFileNameSearchCommand(searchTerm);
      addDebug(`Command: ${command}`);

      // ========== 绗笁姝ワ細鎵ц鎼滅储锛?0绉掕秴鏃讹級==========
      addDebug('Step 3: Executing find (timeout: 30s)...');

      const searchPromise = connectionManager.execCommand(command);
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('SEARCH_TIMEOUT')), 30000);
      });

      // 鐩戝惉鍙栨秷
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
          addDebug('鈴憋笍  Search timed out after 30 seconds');
        } else {
          addDebug(`Search error: ${err.message}`);
          throw err;
        }
      } finally {
        cancelDisposable?.dispose();
      }

      // ========== 绗洓姝ワ細鍑嗗鏄剧ず鍐呭 ==========
      addDebug('Step 4: Preparing results...');

      let displayContent = `=== Duo Filename Search ===\n`;
      displayContent += `${debugInfo}\n`;
      displayContent += `===========================\n\n`;

      if (timedOut) {
        displayContent += `Filename search for "${searchTerm}"\n\n`;
        displayContent += `鈴憋笍  Search timed out after 30 seconds.\n\n`;
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

      // ========== 绗簲姝ワ細鏄剧ず缁撴灉 ==========
      addDebug('Step 5: Displaying results...');

      const resultUri = vscode.Uri.parse(`${SEARCH_SCHEME}:/Filename%20Search?${encodeURIComponent(searchTerm)}`);
      contentProvider.update(resultUri, displayContent);

      const doc = await vscode.workspace.openTextDocument(resultUri);
      await vscode.window.showTextDocument(doc, { preview: false });

      addDebug('Done!');

    } catch (err: any) {
      const errorMsg = `Search failed: ${err.message}`;
      addDebug(errorMsg);

      const resultUri = vscode.Uri.parse(`${SEARCH_SCHEME}:/Filename%20Search?error`);
      const errorContent = `=== Duo Search Error ===\n\n${debugInfo}\n\nError: ${err.message}\n`;
      contentProvider.update(resultUri, errorContent);

      const doc = await vscode.workspace.openTextDocument(resultUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  });
}
