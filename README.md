# dsh-recall-unread

> DeepSeek Harness (DSH) 插件：撤回「已发送但尚未被模型读取」的文字消息。

在模型运行中发送文字（插话发送）时，消息会以“待处理”气泡的形式出现在对话尾部——在模型认领（读取）之前，你可以一键撤回，避免把还没想好的话发给模型。

![screenshot](docs/screenshot.png)

> 截图占位：可以把实际效果截图后替换 `docs/screenshot.png`。

---

## ✨ 功能特性

- **未读消息条带**：在输入框上方（`conversation.input.dock` 插槽）列出所有已发送但模型尚未读取的插话消息（`placement: 'steering'`）。
- **单条撤回**：每条消息显示预览文本 + 「撤回」按钮，点击后消息从对话中移除，并提示“已撤回一条消息”。
- **全部撤回**：存在多条未读消息时提供「全部撤回」一键操作。
- **只读语义**：消息一旦被模型认领（开始读取）会自动离开条带，此时无法撤回——严格符合“仅未读取可撤回”。
- **优雅降级**：撤回失败（消息已开始发送）时给出明确提示，不会破坏会话。

## 🔍 工作原理

DSH 中“已发送但未读取”的消息 = 仍停留在 Agent **inbox**（待处理队列）中的消息，即 `ConversationSnapshot.queue` 快照里的 pending 项。它有两种 placement：

| placement | 含义 | 官方界面现状 |
| --- | --- | --- |
| `queued` | 运行中排队等待下一轮 | 官方队列坞已有「删除」按钮 |
| `steering` | 运行中插话发送，显示为对话尾部待处理气泡 | **没有任何撤回入口** ← 本插件补上 |

撤回操作通过包内私有 RPC 完成：

```
Client  (撤回按钮)
   │  host.call('recall', { sessionId, itemId })
   ▼
Host    harness.handle('recall')
   │  agents.get(sessionId).inbox.remove(itemId)
   ▼
效果   消息从 inbox 移除 → session/queue 快照更新 → 气泡与条带同步消失
```

Host 端逻辑与官方 `session.updateQueue` 中 `kind: 'remove'` 的内部实现一致（`agent.inbox.remove`）。

## 📁 目录结构

```
dsh-recall-unread/
├── README.md                  # 本文件
├── LICENSE                    # MIT 许可证
├── .gitignore                 # Git 忽略规则
├── package.json               # 项目元数据（GitHub 展示用）
├── plugin.json                # 插件清单（名称 / ID 前缀 / 代码来源）
├── src/
│   ├── host.js                # Host 半端源码（可直接作为 code.host）
│   └── client.js              # Client 半端源码（可直接作为 code.client）
└── docs/
    └── github-upload-tutorial.md  # 上传 GitHub 的细致教程
```

## 🚀 安装与激活

本项目是 **DSH 动态 Cordis 插件**（进程级定义），激活方式与官方 Cordis 插件开发流程一致：

1. 打开 DSH，在会话中进入 **Cordis 插件开发** 流程（`cordis_define`）。
2. 新建插件：
   - `idPrefix`：`recall`
   - `code.host`：粘贴 `src/host.js` 的完整内容
   - `code.client`：粘贴 `src/client.js` 的完整内容
   - `name`：`Recall Sent Unread Messages`
   - `purpose`：一句话说明用途
3. 用返回的 `pluginId` / `packageId` 调用 `cordis_run` 激活，并在界面批准运行。
4. 激活后在模型运行中发送一条插话消息，即可在输入框上方看到「未读消息」条带与「撤回」按钮。

> 注意：动态插件是进程级、临时的——DSH 重启后需要重新定义（这是 DSH 动态插件机制本身的性质，非本插件缺陷）。如需常驻，可结合 DSH 的 agent preset / 静态插件机制部署。

## 📖 使用说明

1. 模型正在运行（如深度思考、长工具调用）时，用**插话发送**（默认快捷键：运行中发送即进入 steering）发出一条文字。
2. 消息出现在对话尾部（带“待处理”标记），同时输入框上方出现「未读消息」条带。
3. 点击该消息右侧的「撤回」——气泡与条带立即消失，提示“已撤回一条消息”。
4. 有多条未读时，可点「全部撤回」一次性清空。

## ⚠️ 限制与已知问题

- 仅能撤回 **尚未被模型读取**（仍在 inbox）的消息；一旦被认领即不可撤回。
- 排队消息（`queued`）官方队列坞已提供删除，本插件不重复覆盖。
- 受限于官方未提供“消息气泡级”插槽，撤回入口放在输入框上方的条带中，而非直接悬浮在气泡上。
- 动态插件不持久化；如需长期使用请按上述方式在重启后重新激活，或接入静态插件机制。

## 📦 版本历史

- **v1.0.0**（2026-08）首个可运行版本：Host RPC 撤回 + Client 未读消息条带。

## 📄 许可证

[MIT](LICENSE)
