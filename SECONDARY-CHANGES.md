# 二次修改说明 / Secondary changes

本仓库是 [darrenprx/lolPing](https://github.com/darrenprx/lolPing) 的**二次修改版本**，维护在
[jiantiankeji/lolPing](https://github.com/jiantiankeji/lolPing)。

原项目作者与版权：Copyright (c) 2026 Danrui Meng，MIT 许可（`LICENSE` 未做任何改动）。
二次修改部分同样以 MIT 许可发布；`assets/` 里的图标、动画与音效来自 Riot Games，不包含在 MIT 许可内。

This repository is a modified fork of [darrenprx/lolPing](https://github.com/darrenprx/lolPing), kept at
[jiantiankeji/lolPing](https://github.com/jiantiankeji/lolPing). The upstream project is MIT-licensed
(Copyright (c) 2026 Danrui Meng); the license file is unchanged, and the changes below are released under the
same MIT terms. Game assets under `assets/` are Riot Games' and not covered by it.

## 与上游的关系

| | |
| --- | --- |
| 上游 | <https://github.com/darrenprx/lolPing> |
| 本仓库 | <https://github.com/jiantiankeji/lolPing> |
| 同步上游 | `git fetch upstream && git merge upstream/main` |

本地已把上游配置为 `upstream` 远程、本仓库为 `origin`：

```bash
git remote -v
# origin    https://github.com/jiantiankeji/lolPing.git (fetch/push)
# upstream  https://github.com/darrenprx/lolPing.git (fetch/push)
```

上游的提交历史完整保留，二次修改的提交叠在其上，没有改写任何上游提交。

## 新增功能

### 1. AI 分析：`?` 信号与 All In

- `?` 信号：截取该显示器的一张截图，发给 DeepSeek（`deepseek-flash`），回答显示在信号位置。
- **All In**：同一张截图，但先深度思考（`thinking: enabled`，16 000 token 预算）。
  按住 **Shift** 拖动 All In，会弹出输入框问你自己写的问题。
- **回答卡片**：整段回答完整呈现，按 markdown 渲染（标题、列表、引用、代码块、行内代码/粗体/斜体/链接），
  标题栏可拖动，**展开全部 / 收起**、**✕ 关闭** 常驻。
- **记录**：每次问答保存在 `%APPDATA%\lolPing\ai-history.json`（最近 30 条），卡片底部 `‹ 1 / 7 ›` 翻看。
- **追问**：带着屏幕上这条回答作为上下文继续问，重新截一张图，沿用上一轮的思考模式。
- 设置 → AI 分析里填 DeepSeek API Key，默认开启；没有 Key 时不会发送任何内容。
- 隐私：截图只发往 `api.deepseek.com`；截图不落盘；历史文件不上传，只有追问时把上一轮问答文本发给模型。

### 2. 危险信号 → 关机倒计时（仅 Windows）

- 发出危险信号后**立即**出现 5 秒倒计时卡片，结束后执行关机。
- 四种取消方式：卡片上的按钮、再发一次危险信号、`Ctrl+Alt+P`、`Esc`。
- 5 秒由 lolPing 自己数，不使用 `shutdown /s /t 5`；退出 lolPing 会取消倒计时。

### 3. 请求集合（Assist Me）

- 发出请求协助信号，打开一组预先配置的软件 / 文件 / 文件夹 / 网址，按顺序打开。
- 支持多套「方案」，可新建、重命名、删除。
- 文件与文件夹可以指定程序打开（VS Code、IDEA 等），支持启动参数（`{path}` 替换为目标路径）与**工作目录**。
- 「VS Code 项目」类型：打开项目文件夹，生成一个带 `runOn: folderOpen` 任务的 `.code-workspace`，
  在 VS Code 的集成终端里自动执行命令（默认 `npm run dev`）。
- 配置保存在 `%APPDATA%\lolPing\launch.json`。

### 4. 传文件（原 Push 扇区）

- 轮盘上的 **Push** 扇区改为**传文件**：不再发送 Push 信号。
- 拖到该扇区后，房间面板里选择收件人，再选文件；一次一个，单个上限 200 MB。
- **只走局域网**（不经公网中继）：分块 720 字节、累积确认、丢块重传；每块按自己的位置写入，乱序到达也收，
  所以丢一个包只需重传那一块，不会把整个窗口卡住。
- 接收方会看到卡片（谁、什么文件、多大），**先选保存位置再接受**，也可以拒绝。
- 两端都有进度条与取消；落地前用 sha256 校验，半截文件不会以真实文件名留在硬盘上。

### 5. 轮盘中心

- 中心不再是常驻的图标与 "PING" 文案，改为**悬停预览**：显示指针所在扇区的图标和名称，
  指针在死区或轮盘关闭时清空（联盟的做法）。
- 说明文案（"BACK"）已进 i18n，中文界面显示「返回」。

## 与上游行为不一致的地方（从上游更新时注意）

- **Push 扇区不再放置 Push 信号**，改为传文件。
- **轮盘中心不再显示固定图标与 "PING"**。
- 新增本地文件：`ai-history.json`、`launch.json`、`workspaces/`（都在 `%APPDATA%\lolPing\` 下）。
- 房间协议**新增**文件传输消息（`offer` / `accept` / `part` / `ack` / `seal` / `finish` / `abort`）：
  老版本会当作未知类型忽略，不会崩溃，只是收不到文件。`PROTOCOL_VERSION` 未变。

## 构建与测试

```bash
npm install
npm run dev            # 开发运行（输入相关功能只有真机能验证）
npm run typecheck
npm run test:helper    # 原生 helper 的 C++ 测试
npm test
npm run dist           # 打包（Windows）
```

打包时 Electron 运行时从 GitHub 下载；国内网络可设置镜像：

```bash
# 用户级 ~/.npmrc 或环境变量
electron_mirror=https://npmmirror.com/mirrors/electron/
```

## 尚未验证的部分

如实说明，避免误以为全部验证过：

- **传文件**只做了单元测试（分块、确认、重传、乱序、校验、超时、取消），**未在两台真机之间实测**。
- **AI 分析**与**关机倒计时**需要真实环境和 API Key 才能端到端验证。
- 轮盘中心的悬停预览没有在真机上检查过字号与居中效果。

## 发版与更新检查

`package.json` 里的 `build.publish` 仍然指向**上游仓库** `darrenprx/lolPing`。这意味着：

- 用 `npm run dist` 打出来的安装包，其 `app-update.yml` 会写上游仓库，安装后会去**上游**检查更新。
- 如果要发布自己的安装包并让更新检查指向本仓库，需要把 `build.publish` 的 `owner` / `repo`
  改成 `jiantiankeji` / `lolPing`（本次二次修改没有改动它，以免悄悄改变更新来源）。

## 许可与素材

- 代码：MIT，与原项目相同，`LICENSE` 保持原样。
- `assets/textures`、`assets/sounds`、`assets/emotes` 中的图标、动画与音效 © Riot Games，不包含在 MIT 许可内。
- 本项目不代表 Riot Games，也不反映其观点。Riot Games 及相关名称是其商标。

---

# Secondary changes (English summary)

- **AI:** the `?` ping sends a screenshot to DeepSeek and shows the answer in a card; **All In** thinks first and
  (with **Shift**) asks your own question. The card renders markdown, can be dragged, expands to the whole answer,
  keeps the last 30 answers in `ai-history.json`, pages through them, and can follow up with the answer on screen
  as context.
- **Danger → shutdown (Windows only):** a 5-second countdown appears at once and can be called off four ways
  (card button, another Danger ping, `Ctrl+Alt+P`, `Esc`).
- **Request gather (Assist Me):** opens a configured workspace of programs, files, folders and URLs, with plans,
  arguments, a working directory, and a "VS Code project" type that runs a command in the integrated terminal.
- **Send a file (the old Push slice):** files go to one member over the local network only — point to point,
  720-byte parts, cumulative acknowledgements, retransmission, ordered writes, sha256 before the file is renamed
  into place. The receiver chooses where it lands and accepts or declines. Up to 200 MB, one at a time.
- **Wheel centre:** a hover preview (the slice's icon and name, in the language in force) instead of a fixed
  icon and "PING".

Known gaps: file transfer is unit-tested only, not proven between two machines; `build.publish` still points at
the upstream repository.
