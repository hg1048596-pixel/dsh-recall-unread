# dsh-recall-unread

> DeepSeek Harness (DSH) 插件：撤回「已发送但尚未被模型读取」的文字消息。

在模型运行中发送文字（插话发送）时，消息会以“待处理”气泡的形式出现在对话尾部——在模型认领（读取）之前，你可以一键撤回，避免把还没想好的话发给模型。

<!-- 截图（可选）：把实际效果截图保存为 docs/screenshot.png，然后取消下方注释即可显示 -->
<!-- ![screenshot](docs/screenshot.png) -->

> 截图占位：可将实际效果截图保存为 `docs/screenshot.png`，并取消上方 `![screenshot]` 的注释。

---

## ✨ 功能特性

- **启用即生效**：在插件市场（dsh-market）或插件管理页启用本插件后，「未读消息」条带立即生效；停用即整体不加载。不依赖任何启动器菜单。
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

撤回实现分两个版本：

- **静态版（推荐）**：Client 直接调用官方会话 RPC `session.updateQueue(itemId, { kind: 'remove' })`（与官方队列坞的「删除」同一实现）。
- **动态版**：通过包内私有 RPC 完成：

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
│   ├── host.js                # Host 半端源码（动态版，可直接作为 code.host）
│   └── client.js              # Client 半端源码（动态版，可直接作为 code.client）
├── plugin/                    # 静态 web profile 插件包（安装后随 DSH 加载，推荐）
│   ├── package.json           # 安装包元数据（含 dsh.client 声明）
│   ├── host.js                # Host 半端（空实现占位，撤回走客户端官方 RPC）
│   └── client.js              # Client bundle（__ModuleLoader__ 注册）
└── docs/                      # 截图等附加资源（可选）
```

## 🚀 安装与激活

### 方式一：静态安装（推荐，随 DSH 加载，重启不丢失）

把 `plugin/` 目录安装为 DSH web profile 的静态插件：

1. 将 `plugin/` 整个目录复制到 web profile 的 node_modules 下：
   ```
   ~/.dsh/profiles/web/node_modules/dsh-recall-unread/
   ```
2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加加载行：
   ```yaml
   - insert:
       - id: recall-unread
         name: dsh-recall-unread
   ```
3. 重启 DSH。插件启用后「未读消息」条带即生效；可在插件市场（dsh-market）或插件管理页随时停用/启用。

> 说明：静态版在 Client 端直接调用官方会话 RPC `session.updateQueue(itemId, { kind: 'remove' })`（与官方队列坞的「删除」同一实现），无需动态 RPC，与官方界面行为完全一致。插件不依赖 Amadeus。

### 方式二：动态插件（临时体验，重启后失效）

本项目也可作为 **DSH 动态 Cordis 插件**（进程级定义）临时体验：

1. 打开 DSH，在会话中进入 **Cordis 插件开发** 流程（`cordis_define`）。
2. 新建插件：
   - `idPrefix`：`recall`
   - `code.host`：粘贴 `src/host.js` 的完整内容
   - `code.client`：粘贴 `src/client.js` 的完整内容
   - `name`：`Recall Sent Unread Messages`
   - `purpose`：一句话说明用途
3. 用返回的 `pluginId` / `packageId` 调用 `cordis_run` 激活，并在界面批准运行。
4. 激活后在模型运行中发送一条插话消息，即可在输入框上方看到「未读消息」条带与「撤回」按钮。

> 注意：动态插件是进程级、临时的——DSH 重启后需要重新定义。长期使用请用**方式一**的静态安装。

## ⚙️ 配置

本插件**零配置、开箱即用**，无需任何设置。如需微调，修改 `src/client.js` 后重新定义（`cordis_define`）即可，常用可调项：

| 项 | 位置 | 说明 |
| --- | --- | --- |
| 条带排序 | `slots.register(…, order: 30)` | 数字越大越靠后，可调整与输入框的贴近程度 |
| 提示停留时长 | `ctx.timeout(() => setStatus(null), 2500)` | 撤回结果提示自动消失的时间（毫秒） |

## 📖 使用说明

1. 确保插件已启用（安装后默认启用；可在插件市场/管理页开关）。
2. 模型正在运行（如深度思考、长工具调用）时，用**插话发送**（默认快捷键：运行中发送即进入 steering）发出一条文字。
3. 消息出现在对话尾部（带“待处理”标记），同时输入框上方出现「未读消息」条带。
4. 点击该消息右侧的「撤回」——气泡与条带立即消失，提示“已撤回一条消息”。
5. 有多条未读时，可点「全部撤回」一次性清空。

## ⚠️ 限制与已知问题

- 仅能撤回 **尚未被模型读取**（仍在 inbox）的消息；一旦被认领即不可撤回。
- 排队消息（`queued`）官方队列坞已提供删除，本插件不重复覆盖。
- 受限于官方未提供“消息气泡级”插槽，撤回入口放在输入框上方的条带中，而非直接悬浮在气泡上。
- 动态插件不持久化；按「方式一」静态安装后随 DSH 启动自动加载，重启不丢失。

## 🔒 防锁死机制（重要）

DSH 网页启动是 **fail-loud** 的：任何一个插件加载失败都会整屏显示
`Failed to load plugins`，导致进不去 DSH。本插件曾因 bundle 里引用
`module.exports` 而触发 `ReferenceError: module is not defined` 锁死启动，
现从三层做了固化：

### 1. Bundle 结构性修复（已生效）

DSH 的 `window.__ModuleLoader__.load` 的 factory **只注入 `require`，不注入
`module` / `exports`**。`plugin/client.js` 现在完全不引用 `module` / `exports`，
factory 直接 `return { inject, apply }`（返回值就是模块导出）。无论怎么改、
怎么重新包装，都不会再出现 `module is not defined`。文件头有详细警告注释。

> ⚠️ **不要删掉 `inject` 里的 `'timer'`**：Cordis 的 `ctx` 是 Proxy，
> 未 inject 的服务属性被访问时会直接抛 `cannot get property "timer" without inject`，
> 导致 apply 阶段失败。客户端的 `timer` 服务由核心插件
> `@deepseek-ai/dsh-cordis-client-runner` 提供（`ctx.interval` / `ctx.timeout`
> 已 mixin 到 Context 原型，随 fiber 自动清理），轮询和提示自动消失都依赖它。
> 同理 Host 半端保留 `inject: ['timer']`（Host 端 timer 由
> `@deepseek-ai/cordis-plugin-timer` 保证，profile 启动时自动加载）。

### 2. Git 钩子：带病 bundle 不允许提交（安装一次即可）

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/install-hooks.ps1
```

安装后每次 `git commit` 自动运行 `tools/check-client-bundle.ps1`：

- `node --check` 校验 `plugin/client.js` / `plugin/host.js` 语法；
- 拦截任何非注释的 `module` / `exports` 引用（即会锁死 DSH 的写法）。

校验失败会**直接拒绝提交**，从源头杜绝回归。手动运行同样可以：
`pwsh -NoProfile -ExecutionPolicy Bypass -File tools/check-client-bundle.ps1`。

### 3. 急救开关：万一再出问题，一键进 DSH

如果插件又导致启动红屏，**不用改任何配置**，禁用它即可正常进入 DSH：

```powershell
# 禁用撤回插件（自动备份 cordis.patch.yml），然后重启 DSH
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/recall-killswitch.ps1

# 恢复撤回插件，然后重启 DSH
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/recall-killswitch.ps1 -Action enable
```

原理：在 `~/.dsh/profiles/web/cordis.patch.yml` 的 `recall-unread` 条目上加/删
`disabled: true`（loader 对 disabled 条目直接跳过，不导入该插件）。

> 修改 `plugin/client.js` 后记得重新部署到
> `~/.dsh/profiles/web/node_modules/dsh-recall-unread/` 并重启 DSH。

## 📦 版本历史

- **v1.1.0**（2026-08）移除 Amadeus 启动器依赖：删除 🧩 菜单入口与客户端
  amadeus 轮询，改为启用即生效（插件市场/管理页的启用·停用开关控制加载）。
- **v1.0.1**（2026-08）防锁死固化：bundle 彻底移除 `module`/`exports` 引用
  （factory 直接 return 导出）；`?.load` 注册守卫；`inject` 保留
  `['slots','timer']` 并加 Proxy 访问警告；新增 git 钩子校验与一键急救开关脚本。
- **v1.0.0**（2026-08）首个可运行版本：Host RPC 撤回 + Client 未读消息条带。

## 📄 许可证

[MIT](LICENSE)
