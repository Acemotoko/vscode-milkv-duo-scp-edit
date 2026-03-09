# Duo SCP Edit

VSCode 扩展，用于在 Milk-V Duo (RISC-V) 设备上直接编辑文件，通过纯 SSH/SCP 协议（无需 SFTP）。

---

## ✅ 已完成功能

### 核心功能

| 功能 | 状态 | 说明 |
|------|------|------|
| SSH 连接管理 | ✅ | 单例模式管理连接，支持断线状态监听 |
| **原生资源管理器集成** | ✅ | **第一阶段新功能！** 直接在 VSCode 左侧管理文件 |
| **SSH 终端集成** | ✅ | **第二阶段新功能！** 直接在 VSCode 终端运行命令 |
| 文件浏览 (QuickPick) | ✅ | 使用 `Duo: Browse Files` 命令交互式浏览文件 |
| 文件系统提供者 | ✅ | 实现 `duo://` 协议，可通过 VSCode API 访问 |
| 读取文件 | ✅ | 使用 `cat` 命令通过 SSH 流下载 |
| 写入文件 | ✅ | 使用 `cat >` 命令通过 SSH 流上传 |
| 创建目录 | ✅ | `mkdir -p` 递归创建 |
| 删除文件/目录 | ✅ | `rm -rf` 支持递归删除 |
| 重命名/移动 | ✅ | `mv` 命令支持覆盖选项 |
| 复制文件/目录 | ✅ | `cp -r` 递归复制 |
| 状态查询 (stat) | ✅ | 使用 `stat` 命令获取真实文件大小和时间 |
| **目录缓存** | ✅ | 2 秒 TTL 缓存，减少 SSH 调用 |
| **最近连接列表** | ✅ | **第三阶段新功能！** 快速选择最近连接过的设备 |
| **密码安全存储** | ✅ | **第三阶段新功能！** 使用 SecretStorage 加密存储密码 |
| **自动重连** | ✅ | **第三阶段新功能！** Extension Host 重启后自动恢复连接 |
| **Remote Explorer** | ✅ | **第四阶段新功能！** 左侧活动栏可视化设备管理器 |
| **状态指示灯** | ✅ | **第四阶段新功能！** 绿色/灰色/红色圆点显示连接状态 |
| **右键菜单** | ✅ | **第四阶段新功能！** Open Terminal / Mount / Reboot |

### 技术特性

- **PromiseGuard**: 确保 Promise 只被 resolve/reject 一次，避免竞态条件
- **SecretStorage**: 使用 VSCode 安全存储 API 加密保存密码
- **Auto-Reconnect**: Extension Host 重启后自动检测并恢复连接

---

## 🐛 已修复的 Bug

### Bug 1: Add to Workspace 静默失败
**问题**: 连接成功后点击 "Add to Workspace"，界面无反应。

**原因**: `updateWorkspaceFolders()` 会触发 Extension Host 重启，内存中的连接丢失。

**解决方案**:
- 使用 `context.globalState` 保存连接配置
- 使用 `context.secrets` 安全存储密码
- `activate()` 时检测 `duo://` 工作区文件夹并自动重连

### Bug 2: Open Terminal 后连接"断开"
**问题**: 打开终端后，后续操作提示 "Not connected"。

**原因**: SSH channel 的 `end`/`close` 事件被误判为整个连接断开。

**解决方案**:
- 不在单个 channel 的 `end`/`close` 事件中设置 `_isConnected = false`
- 保持更稳健的连接状态管理

---
- **ShellEscape**: 安全的 shell 转义，防止命令注入
- **Cleanup**: 正确的流关闭和资源清理
- **错误处理**: 完善的错误捕获和用户提示
- **DirectoryCache**: 智能目录列表缓存
- **Pseudoterminal**: VSCode 终端与 SSH shell 的桥接

---

## 📖 使用方法

### 1. 方式 A: Remote Explorer（推荐）⭐⭐⭐

点击左侧活动栏的 **"Remote Explorer"** 图标：

1. **添加设备**：
   - 点击视图顶部的 ➕ 按钮
   - 输入设备名称（如 "My Milk-V Duo"）
   - 输入 IP 地址、端口、用户名、密码

2. **连接设备**：
   - 点击设备旁的 🔌 按钮，或右键选择 "Connect"
   - 状态指示灯：
     - 🟢 绿色圆点：已连接
     - ⚪ 灰色圆点：未连接
     - 🔴 红色圆点：连接错误
     - 🔄 旋转图标：连接中

3. **右键菜单操作**（已连接设备）：
   - **Open Terminal** - 打开 SSH 终端
   - **Mount to Workspace** - 在资源管理器显示文件
   - **Reboot Device** - 重启设备

4. **编辑设备**：
   - 点击设备旁的 ✏️ 按钮修改配置

---

### 2. 方式 B: 命令面板

1. 按 `Ctrl+Shift+P` 打开命令面板
2. 输入并选择 **`Duo: Connect to Device`**
3. 如果之前连接过，会显示**最近连接列表**：
   - 选择列表中的设备直接快速重连（密码已安全存储）
   - 或选择 `+ 输入新连接...` 手动输入
4. 按提示输入（如选择新连接）：
   - IP 地址 (默认: `192.168.31.63`)
   - 用户名 (默认: `root`)
   - 密码
5. 连接成功后，选择下一步操作：
   - **Add to Workspace** - 在左侧资源管理器显示文件
   - **Open Terminal** - 打开 SSH 终端（推荐开发用）
   - **Browse Files** - QuickPick 浏览
   - **Later** - 稍后再说

> **提示**：密码会自动加密存储在系统钥匙串中，Add to Workspace 后 Extension Host 重启会自动重连！

### 2. 浏览和编辑文件

连接成功后，有三种方式访问文件：

#### 方式 A: 原生资源管理器（强烈推荐）⭐

连接成功后选择 **"Add to Workspace"**，或手动运行：
1. 按 `Ctrl+Shift+P` 打开命令面板
2. 输入并选择 **`Duo: Add to Workspace`**

**效果**：左侧资源管理器直接显示 "Milk-V Duo" 文件树，支持：
- 双击打开文件
- 右键菜单新建文件/文件夹
- F2 重命名
- Delete 删除
- 拖拽移动
- 等等所有 VSCode 原生文件操作！

#### 方式 B: SSH 终端（开发必备）⭐⭐

连接成功后选择 **"Open Terminal"**，或手动运行：
1. 按 `Ctrl+Shift+P` 打开命令面板
2. 输入并选择 **`Duo: Open Terminal`**

**效果**：VSCode 下方出现 "Milk-V Duo" 终端，支持：
- 直接在终端运行 `ls`, `pwd`, `make`, `gcc` 等命令
- 复用现有 SSH 连接，无需重新认证
- 支持方向键、退格键、Ctrl+C 等基本交互
- 终端 resize 自动同步到远程

#### 方式 C: QuickPick 浏览器

1. 按 `Ctrl+Shift+P` 打开命令面板
2. 输入并选择 **`Duo: Browse Files`**
3. 使用 QuickPick 界面导航目录：
   - 选择目录进入
   - 选择 `..` 返回上级
   - 选择文件直接在编辑器中打开

#### 方式 D: 通过 VSCode API (高级)

```typescript
// 在其他扩展中使用
const uri = vscode.Uri.parse('duo:///etc/hostname');
const doc = await vscode.workspace.openTextDocument(uri);
await vscode.window.showTextDocument(doc);
```

### 3. 配置默认值

在 VSCode 设置中搜索 `Duo SCP Edit`，可配置：

- `duo.host`: 默认 IP 地址
- `duo.username`: 默认用户名
- `duo.password`: 默认密码
- `duo.port`: SSH 端口 (默认 22)

---

## 🔧 实现效果

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      VSCode Extension                         │
├─────────────────────────────────────────────────────────────┤
│  extension.ts              - 命令注册、激活事件              │
│  DeviceTreeDataProvider    - TreeView 设备列表              │
│  DeviceTreeItem            - 树节点 UI                       │
│  DeviceManager             - 设备配置持久化、状态管理        │
│  DuoFileSystemProvider     - VSCode FileSystemProvider 实现  │
│                           └─ DirectoryCache (2s TTL)         │
│  DuoTerminalProvider       - VSCode Pseudoterminal 实现      │
│  ConnectionManager         - SSH 连接 + SCP 文件传输         │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ SSH (ssh2 库)
                              │
                              ▼
                    ┌─────────────────┐
                    │   Milk-V Duo    │
                    │  (Dropbear SSH) │
                    └─────────────────┘
```

### 文件传输实现（纯 SSH，无 SFTP）

**下载文件 (`downloadFile`)**:
```typescript
// 使用 `cat` 命令通过 stdout 流式传输
sshClient.exec(`cat '${remotePath}'`, (err, stream) => {
  stream.pipe(fs.createWriteStream(localPath));
});
```

**上传文件 (`uploadFile`)**:
```typescript
// 使用 `cat >` 命令通过 stdin 流式传输
sshClient.exec(`cat > '${remotePath}'`, (err, stream) => {
  fs.createReadStream(localPath).pipe(stream);
});
```

### SSH 终端实现

```typescript
// DuoTerminalProvider 实现 vscode.Pseudoterminal
export class DuoTerminalProvider implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  open(): void {
    // 调用 connectionManager.openShell()
    // 将 ssh stream 的 stdout/stderr pipe 到 writeEmitter
  }

  handleInput(data: string): void {
    // 将终端输入发送到 ssh stream
  }
}
```

### 目录缓存机制

```typescript
// 2 秒内重复请求同一目录直接返回缓存
private directoryCache = new Map<string, CacheEntry>();
private readonly CACHE_TTL = 2000;
```

文件修改后自动清除相关路径的缓存。

---

## 三阶段路线图

### ✅ 第一阶段：原生资源管理器集成（已完成）
- [x] `Duo: Add to Workspace` 命令
- [x] 连接成功后智能提示
- [x] 目录列表缓存 (2s TTL)
- [x] 完整原生文件操作支持

### ✅ 第二阶段：集成 SSH 终端（已完成）
- [x] `Duo: Open Terminal` 命令
- [x] Pseudoterminal 集成
- [x] 复用现有 SSH 连接
- [x] 终端 resize 支持

### ✅ 第三阶段：连接体验优化（已完成）
- [x] 最近连接列表 - 快速选择最近连接过的设备（最多5个）
- [x] SecretStorage 密码安全存储 - 密码加密存储在系统钥匙串
- [x] Extension Host 自动重连 - Add to Workspace 后自动恢复连接

### ✅ 第四阶段：可视化连接管理器（已完成）
- [x] Remote Explorer 视图 - 左侧活动栏设备列表
- [x] 状态指示灯 - 绿色/灰色/红色圆点显示连接状态
- [x] 内联按钮 - Connect/Edit 快速操作
- [x] 右键菜单 - Open Terminal / Mount / Reboot
- [x] 设备配置持久化 - 支持保存多个命名设备
- [x] 从 recent connections 自动导入

---

## ⚠️ 注意事项

- 目标设备需要启用 SSH 服务（Milk-V Duo 默认启用）
- 仅支持密码认证（暂不支持密钥）
- 大文件传输可能较慢（流式但无分块）
- 路径中包含特殊字符会自动转义
- SSH 终端支持基本交互，复杂 TUI 应用可能有问题

---

## 开发

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 监听模式编译
npm run watch

# 调试: 按 F5 在 VSCode 扩展开发主机中运行
```

## 技术栈

- **TypeScript 5.3** - 类型安全
- **ssh2** - SSH 客户端
- **tmp-promise** - 临时文件管理
- **VSCode API** - 扩展开发
