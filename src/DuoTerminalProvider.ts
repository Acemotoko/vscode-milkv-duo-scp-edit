import * as vscode from 'vscode';
import { ClientChannel } from 'ssh2';
import { ConnectionManager } from './ConnectionManager';

export class DuoTerminalProvider implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<number>();
  readonly onDidClose?: vscode.Event<number> = this.closeEmitter.event;

  private shellStream: ClientChannel | null = null;
  private isOpen = false;

  constructor(private connectionManager: ConnectionManager) {}

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    this.isOpen = true;

    // 打开 shell
    this.connectionManager.openShell()
      .then(stream => {
        if (!this.isOpen) {
          stream.end();
          return;
        }

        this.shellStream = stream;

        // 设置初始终端大小
        if (initialDimensions) {
          this.setTerminalSize(stream, initialDimensions);
        }

        // 从 ssh 接收输出并发送到终端
        stream.on('data', (data: Buffer | string) => {
          this.writeEmitter.fire(data.toString());
        });

        stream.stderr.on('data', (data: Buffer | string) => {
          this.writeEmitter.fire(data.toString());
        });

        stream.on('close', () => {
          this.closeEmitter.fire(0);
          this.cleanup();
        });

        stream.on('error', (err: Error) => {
          this.writeEmitter.fire(`\r\n\x1b[31mError: ${err.message}\x1b[0m\r\n`);
          this.closeEmitter.fire(1);
          this.cleanup();
        });
      })
      .catch((err: Error) => {
        this.writeEmitter.fire(`\r\n\x1b[31mFailed to open shell: ${err.message}\x1b[0m\r\n`);
        this.closeEmitter.fire(1);
        this.cleanup();
      });
  }

  close(): void {
    this.cleanup();
  }

  handleInput(data: string): void {
    if (this.shellStream && this.isOpen) {
      this.shellStream.write(data);
    }
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    if (this.shellStream) {
      this.setTerminalSize(this.shellStream, dimensions);
    }
  }

  private setTerminalSize(stream: ClientChannel, dimensions: vscode.TerminalDimensions): void {
    stream.setWindow(
      dimensions.rows,
      dimensions.columns,
      dimensions.rows * dimensions.columns,
      dimensions.rows * dimensions.columns
    );
  }

  private cleanup(): void {
    this.isOpen = false;
    if (this.shellStream) {
      try {
        this.shellStream.end();
      } catch {
        // ignore
      }
      this.shellStream = null;
    }
  }
}
