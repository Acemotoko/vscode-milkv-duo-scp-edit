# Duo SCP Edit

A VS Code extension for editing files on **Milk-V Duo** devices over pure **SSH/SCP-style streams** (no SFTP dependency).

[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.80-007ACC)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](#license)

## Overview

`Duo SCP Edit` is designed for constrained embedded Linux environments (such as Milk-V Duo with Dropbear SSH), where SFTP may be unavailable or unreliable.

The extension provides:
- Native `duo://` file system mounting in VS Code Explorer.
- Direct SSH terminal integration in VS Code.
- Remote device management in Activity Bar (`Remote Explorer`).
- File upload/download via shell streaming (`cat`, `cat >`) over SSH channels.
- Secure credential persistence via VS Code `SecretStorage`.

## Key Features

### Remote Connection & Session
- SSH connection management with reusable single active session.
- Recent connections list (max 5).
- Auto reconnect after Extension Host restart (when credentials exist).
- Connection status event propagation for UI refresh.

### File System Integration (`duo://`)
- Implements `vscode.FileSystemProvider`.
- Open/read/write files directly from remote device.
- Create/rename/copy/delete files and directories.
- Directory listing via `ls -1Ap`.
- Stat via `stat -c '%F:%s:%Y'` fallback strategy.
- Cache strategy:
  - Directory cache TTL: `2s`
  - Stat cache TTL: `5s`
  - Max cache entries: `500`

### Terminal Integration
- Implements `vscode.Pseudoterminal`.
- Opens interactive remote shell from existing SSH connection.
- Basic terminal resize and input forwarding.

### Device Explorer UI
- Activity Bar container: `Remote Explorer`.
- Device CRUD (add/edit/delete).
- Per-device connect/disconnect.
- Context actions:
  - Open Terminal
  - Mount to Workspace
  - Reboot Device

### Search & Navigation
- `Duo: Find in Files` performs filename search on remote using `find`.
- Results rendered in virtual document (`duo-search://`).
- Clickable links back to `duo://` files.

### File Transfer UX
- Upload local file/folder from Explorer context menu.
- Download (file open/read flow) includes:
  - Progress notification (percentage if size known)
  - Completion notification

## Architecture

```text
VS Code Extension Host
  ├─ extension.ts
  │   ├─ command registration
  │   ├─ provider registration
  │   └─ activation / auto-reconnect hooks
  ├─ ConnectionManager
  │   ├─ SSH lifecycle
  │   ├─ shell command execution
  │   ├─ file stream transfer (download/upload)
  │   └─ credentials + recent history persistence
  ├─ DuoFileSystemProvider (duo://)
  │   ├─ stat/readDirectory/readFile/writeFile
  │   └─ cache + file change events
  ├─ DuoTerminalProvider
  │   └─ pseudoterminal bridge for SSH shell
  ├─ DeviceManager
  │   └─ device config/state persistence
  └─ DeviceTreeDataProvider
      └─ Remote Explorer UI actions

Remote Device (Milk-V Duo)
  └─ SSH/Dropbear shell commands
```

## Installation

### Option A: Install VSIX
1. Build VSIX package.
2. In VS Code: `Extensions` -> `...` -> `Install from VSIX...`
3. Select `duo-scp-edit-<version>.vsix`

### Option B: Development Mode
```bash
npm install
npm run compile
```
Then press `F5` in VS Code to launch Extension Development Host.

## Usage

### 1) Connect Device
- Command Palette: `Duo: Connect to Device`
- Input host / username / password (or select recent connection)

### 2) Mount Remote File System
- Command: `Duo: Add to Workspace`
- Remote root appears as `duo:///` in Explorer

### 3) Open Remote Terminal
- Command: `Duo: Open Terminal`

### 4) Browse Files Quickly
- Command: `Duo: Browse Files`

### 5) Upload Local File/Folder
- In local Explorer, right-click file/folder -> `Upload to Milk-V Duo`

### 6) Search Remote Filenames
- Command: `Duo: Find in Files`

## Commands

| Command ID | Title |
|---|---|
| `duo.connect` | Duo: Connect to Device |
| `duo.browse` | Duo: Browse Files |
| `duo.addToWorkspace` | Duo: Add to Workspace |
| `duo.openTerminal` | Duo: Open Terminal |
| `duo.find` | Duo: Find in Files |
| `duo.uploadLocalFile` | Upload to Milk-V Duo |
| `duoDevices.addDevice` | Add Device |
| `duoDevices.connectDevice` | Connect |
| `duoDevices.disconnectDevice` | Disconnect |
| `duoDevices.editDevice` | Edit Device |
| `duoDevices.deleteDevice` | Delete Device |
| `duoDevices.openTerminal` | Open Terminal |
| `duoDevices.mountWorkspace` | Mount to Workspace |
| `duoDevices.rebootDevice` | Reboot Device |
| `duoDevices.refresh` | Refresh |

## Configuration

Settings namespace: `duo`

| Key | Type | Default | Description |
|---|---|---|---|
| `duo.host` | string | `192.168.31.63` | Default device host |
| `duo.username` | string | `root` | Default SSH username |
| `duo.password` | string | `""` | Default SSH password |
| `duo.port` | number | `22` | Default SSH port |

## Security Model

- Passwords are stored in VS Code `SecretStorage`.
- Non-secret connection metadata is stored in `globalState`.
- Shell arguments for paths are escaped to reduce injection risk.

## Compatibility Notes

- Target VS Code Engine: `^1.80.0`
- Protocol model: SSH shell + stream transfer (not SFTP)
- Assumes remote supports common shell utilities (`cat`, `ls`, `mv`, `cp`, `rm`, `stat`, `find`, `mkdir`)

## Known Limitations

- Current design keeps a single active SSH connection.
- Complex full-screen TUI apps may have terminal compatibility issues.
- Search cancellation currently stops local wait but does not forcibly kill remote `find` process.

## Development

### Scripts
```bash
npm run compile     # TypeScript build
npm run watch       # Watch mode build
npm run lint        # ESLint
```

### Project Structure

```text
src/
  ConnectionManager.ts
  DeviceManager.ts
  DeviceTreeDataProvider.ts
  DeviceTreeItem.ts
  DuoFileSystemProvider.ts
  DuoTerminalProvider.ts
  extension.ts
  searchManager.ts
resources/
  icons/
```

## Roadmap

- Better multi-device concurrent session support.
- Upload progress indicator parity with download progress.
- Optional key-based authentication workflow.
- Improved remote search process cancellation.

## Contributing

Issues and PRs are welcome.

Recommended PR checklist:
- Keep behavior backward compatible when possible.
- Update docs for command/config changes.
- Include reproducible test steps for bug fixes.

## License

MIT
