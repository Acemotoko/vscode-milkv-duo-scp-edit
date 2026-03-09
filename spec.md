```markdown
@Spec_Mode_Active

# 任务目标：开发 VSCode 插件 "Duo-SCP-Edit"

## 1. 核心约束 (Hard Constraints)
*   **目标设备**：Milk-V Duo (RISC-V, Buildroot, 256MB RAM)。
*   **网络环境**：SSH 正常 (Dropbear)，无 SFTP 子系统，但**支持 `scp` 命令**。
*   **开发模式**：Local Extension (插件运行在 PC 端)，通过 SSH 控制远程。
*   **禁止事项**：禁止使用 SFTP 协议，禁止依赖 `sftp-server`，禁止尝试安装 VSCode Server。

## 2. 技术栈选型 (Tech Stack)
*   **核心库 1**: `ssh2` (用于执行 Shell 命令，如列出目录)。
*   **核心库 2**: `node-scp` (用于文件传输，它底层封装了 ssh2 实现了纯 SCP 协议，不依赖 SFTP)。
*   **辅助库**: `tmp-promise` (用于处理 SCP 传输时的本地临时文件)。

## 3. 架构设计 (Architecture)
插件需注册 `FileSystemProvider` (scheme: `duo`)。

### 3.1 连接管理 (Connection)
*   维护一个 `ssh2.Client` 单例用于执行命令。
*   维护一个 `node-scp.Client` 单例用于传输文件。
*   **鉴权**：MVP 阶段硬编码或弹窗输入 IP/User/Pass (默认: 192.168.31.63/root)。

### 3.2 目录列表 (readDirectory) -> 使用 SSH Shell
由于 SCP 协议本身不具备高效的“列出目录”功能，必须回退到 Shell。
*   **指令**：`client.exec('ls -1Ap "' + path + '"')`
*   **解析规则**：
    *   输出按行分割。
    *   行尾有 `/` -> 识别为 `FileType.Directory`。
    *   其他 -> 识别为 `FileType.File`。
    *   忽略 `.` 和 `..`。
*   **Stat 伪造**：`stat` 方法中，如果文件存在，返回当前时间作为 mtime，大小设为 0（为了速度，且 ls -l 在嵌入式上格式不统一，解析容易挂）。

### 3.3 文件读取 (readFile) -> 使用 SCP 下载
VSCode 需要 `Uint8Array`，但 SCP 是基于文件的。
*   **流程**：
    1.  创建本地临时文件 `tmpFile`。
    2.  调用 `scpClient.downloadFile(remotePath, tmpFile)`。
    3.  使用 Node.js `fs.readFile(tmpFile)` 读取为 Buffer。
    4.  删除临时文件。
    5.  返回 Buffer。

### 3.4 文件写入 (writeFile) -> 使用 SCP 上传
*   **流程**：
    1.  将 VSCode 传入的 `content` (Uint8Array) 写入本地临时文件 `tmpFile`。
    2.  调用 `scpClient.uploadFile(tmpFile, remotePath)`。
    3.  删除临时文件。
    4.  **注意**：SCP 上传本质是覆盖，符合 VSCode 保存逻辑。

## 4. 详细开发步骤 (Step-by-Step)

### Step 1: 初始化与配置
*   `package.json` 注册指令 `duo.connect` 和 `workspace.registerFileSystemProvider`。
*   安装依赖：
    ```bash
    npm install ssh2 node-scp tmp-promise
    npm install --save-dev @types/ssh2
    ```

### Step 2: 实现 SSH/SCP 连接器
编写 `ConnectionManager` 类：
*   同时建立 `ssh2` 连接 (for shell) 和 `node-scp` 连接 (for file transfer)。
*   注意：`node-scp` 也是基于 ssh 的，确保复用认证信息。

### Step 3: 实现 readDirectory (关键路径)
*   **Code Spec**:
    ```typescript
    // 必须使用 -p 参数来区分目录
    stream = await sshClient.exec(`ls -1Ap "${remotePath}"`);
    // 解析 output，构建 [name, FileType] 数组
    ```

### Step 4: 实现 readFile/writeFile (SCP 核心)
*   **Code Spec (Read)**:
    ```typescript
    const tmp = await file(); // tmp-promise
    await scpClient.downloadFile(remoteUri.path, tmp.path);
    return await fs.promises.readFile(tmp.path);
    ```
*   **Code Spec (Write)**:
    ```typescript
    const tmp = await file();
    await fs.promises.writeFile(tmp.path, content);
    await scpClient.uploadFile(tmp.path, remoteUri.path);
    tmp.cleanup();
    ```

## 5. 验收标准 (Acceptance)
1.  **连接测试**：输入 IP 后不报错。
2.  **列表测试**：能看到 `/etc` 下的文件列表（证明 `ls -1Ap` 解析成功）。
3.  **读取测试**：双击打开 `/etc/hostname`，能看到 `milkv-duo`（证明 SCP 下载成功）。
4.  **写入测试**：新建/修改文件并保存，SSH 登录上去 `cat` 确认内容已变（证明 SCP 上传成功）。
5.  **鲁棒性**：针对 `node-scp` 可能抛出的 connection lost 做简单 try-catch 重连提示。

请立即开始生成扩展的主文件 `extension.ts` 代码。
```