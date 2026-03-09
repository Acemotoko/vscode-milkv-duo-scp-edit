import * as vscode from 'vscode';
import { DeviceState, DeviceConnectionStatus } from './DeviceManager';

export class DeviceTreeItem extends vscode.TreeItem {
  constructor(
    public readonly deviceState: DeviceState,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(deviceState.config.name, collapsibleState);

    this.description = deviceState.config.host;
    this.tooltip = this.getTooltip();
    this.iconPath = this.getIconPath();
    this.contextValue = this.getContextValue();
  }

  private getTooltip(): string {
    const { config, status, errorMessage } = this.deviceState;
    let tooltip = `${config.name}\n${config.username}@${config.host}:${config.port}`;
    if (errorMessage) {
      tooltip += `\n\nError: ${errorMessage}`;
    }
    return tooltip;
  }

  private getIconPath(): vscode.ThemeIcon {
    const status = this.deviceState.status;
    switch (status) {
      case DeviceConnectionStatus.Connected:
        return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
      case DeviceConnectionStatus.Connecting:
        return new vscode.ThemeIcon('sync~spin');
      case DeviceConnectionStatus.Error:
        return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconFailed'));
      case DeviceConnectionStatus.Disconnected:
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }

  private getContextValue(): string {
    return this.deviceState.status === DeviceConnectionStatus.Connected
      ? 'connectedDevice'
      : 'disconnectedDevice';
  }
}
