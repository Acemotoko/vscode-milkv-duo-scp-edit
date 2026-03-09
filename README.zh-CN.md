# Duo SCP Edit

[English](./README.md) | 简体中文

一个为 **Milk-V Duo** 打造的 VS Code 扩展，通过纯 **SSH/SCP 流式方式** 编辑远程文件（不依赖 SFTP）。

[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.80-007ACC)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](#许可证)

## 概述

`Duo SCP Edit` 面向资源受限的嵌入式 Linux 场景（如使用 Dropbear SSH 的 Milk-V Duo），在 SFTP 不可用或不稳定时，仍可在 VS Code 中获得接近本地的远程编辑体验。

扩展提供：
- 原生 `duo://` 文件系统挂载到 VS Code Explorer
- VS Code 内嵌 SSH 终端
- Activity Bar 里的设备管理视图（Remote Explorer）
- 基于 `cat` / `cat >` 的文件流式下载与上传
- 使用 VS Code `SecretStorage` 安全保存密码

## 核心功能

### 连接与会话
- SSH 连接管理（当前为单活连接模型）
- 最近连接列表（最多 5 条）
- Extension Host 重启后的自动重连（有凭据时）
- 连接状态事件驱动 UI 刷新

### 文件系统集成（`duo://`）
- 实现 `vscode.FileSystemProvider`
- 远程文件读写、目录操作、重命名、复制、删除
- 使用 `ls -1Ap` 列目录
- 使用 `stat -c '%F:%s:%Y'` 获取文件信息（含回退策略）
- 缓存策略：
  - 目录缓存 TTL：`2s`
  - stat 缓存 TTL：`5s`
  - 最大缓存条目：`500`

### 终端集成
- 实现 `vscode.Pseudoterminal`
- 复用现有 SSH 连接打开交互式 shell
- 支持基础输入转发与终端尺寸同步

### 设备视图（Remote Explorer）
- 设备增删改
- 设备连接/断开
- 右键快捷操作：
  - Open Terminal
  - Mount to Workspace
  - Reboot Device

### 搜索与跳转
- `Duo: Find in Files` 在远程通过 `find` 做文件名搜索
- 结果展示在虚拟文档 `duo-search://`
- 结果中的路径可点击打开 `duo://` 文件

### 传输体验
- 支持本地文件/目录右键上传
- 下载（文件读取流程）支持：
  - 进度通知（可获取文件大小时显示百分比）
  - 下载完成提示

## 架构

```text
VS Code Extension Host
  ├─ extension.ts
  │   ├─ 命令注册
  │   ├─ Provider 注册
  │   └─ 激活与自动重连
  ├─ ConnectionManager
  │   ├─ SSH 生命周期
  │   ├─ shell 命令执行
  │   ├─ 文件流式传输（download/upload）
  │   └─ 凭据与最近连接持久化
  ├─ DuoFileSystemProvider (duo://)
  │   ├─ stat/readDirectory/readFile/writeFile
  │   └─ 缓存与文件变更事件
  ├─ DuoTerminalProvider
  │   └─ SSH shell 的伪终端桥接
  ├─ DeviceManager
  │   └─ 设备配置与状态持久化
  └─ DeviceTreeDataProvider
      └─ Remote Explorer 交互

Remote Device (Milk-V Duo)
  └─ SSH/Dropbear shell commands
```

## 安装

### 方式 A：安装 VSIX
1. 构建 VSIX 包
2. 在 VS Code 中打开 `Extensions` -> `...` -> `Install from VSIX...`
3. 选择 `duo-scp-edit-<version>.vsix`

### 方式 B：开发模式
```bash
npm install
npm run compile
```
然后在 VS Code 中按 `F5` 启动 Extension Development Host。

## 使用

### 1) 连接设备
- 命令面板执行：`Duo: Connect to Device`
- 输入 host / username / password（或从最近连接中选择）

### 2) 挂载远程文件系统
- 执行：`Duo: Add to Workspace`
- 远程根目录会以 `duo:///` 出现在 Explorer

### 3) 打开远程终端
- 执行：`Duo: Open Terminal`

### 4) 快速浏览远程文件
- 执行：`Duo: Browse Files`

### 5) 上传本地文件/目录
- 在本地 Explorer 右键 -> `Upload to Milk-V Duo`

### 6) 搜索远程文件名
- 执行：`Duo: Find in Files`

## 命令列表

| Command ID | 标题 |
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

## 配置项

设置命名空间：`duo`

| Key | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `duo.host` | string | `192.168.31.63` | 默认设备地址 |
| `duo.username` | string | `root` | 默认 SSH 用户名 |
| `duo.password` | string | `""` | 默认 SSH 密码 |
| `duo.port` | number | `22` | 默认 SSH 端口 |

## 安全模型

- 密码通过 VS Code `SecretStorage` 保存
- 非敏感连接元数据保存在 `globalState`
- 路径参数会做 shell 转义，降低命令注入风险

## 兼容性说明

- VS Code 版本要求：`^1.80.0`
- 协议模型：SSH shell + 流式传输（非 SFTP）
- 依赖远端常见命令：`cat`, `ls`, `mv`, `cp`, `rm`, `stat`, `find`, `mkdir`

## 已知限制

- 当前为单连接模型（非多设备并发会话）
- 复杂全屏 TUI 程序可能存在终端兼容性问题
- 搜索取消目前只终止本地等待，不会强制杀掉远端 `find` 进程

## 开发

### 脚本
```bash
npm run compile     # TypeScript 编译
npm run watch       # 监听编译
npm run lint        # ESLint
```

### 目录结构

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

## 路线图

- 多设备并发会话支持
- 上传进度条（与下载进度一致）
- 可选 SSH 密钥认证流程
- 完善远程搜索取消机制

## 贡献

欢迎提交 Issue 和 PR。

建议 PR 自检：
- 尽量保持向后兼容
- 命令/配置变更同步更新文档
- bug 修复附可复现步骤

## 许可证

MIT
