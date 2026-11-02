# dsh-recall-unread

> DeepSeek Harness (DSH) 插件：撤回「已发送但尚未被模型读取」的文字消息。

在模型运行中发送文字（插话发送）时，消息会以“待处理”气泡的形式出现在对话尾部——在模型认领（读取）之前，你可以一键撤回，避免把还没想好的话发给模型。

当前版本 **v1.2.1**，兼容 **DSH 0.2.1-rc.1 至 0.2.1-rc.5**（desktop / web profile），并保留 0.1.x / 0.2.x 数据接口兼容。验证范围见[兼容说明](docs/compatibility.md)。

---

## ✨ 功能特性

- **启用即生效**：在插件市场（dsh-market）或插件管理页启用本插件后，「未读消息」条带立即生效；停用即整体不加载。不依赖任何启动器菜单。
- **未读消息条带**：在输入框上方（`conversation.input.dock` 插槽）列出所有已发送但模型尚未读取的插话消息（0.2.x 取 `inbox['next-step']` 的用户插话，0.1.x 取 `placement === 'steering'`）。
- **单条撤回**：每条消息显示预览文本 + 「撤回」按钮，点击后消息从对话中移除，并提示“已撤回一条消息”。
- **全部撤回**：存在多条未读消息时提供「全部撤回」一键操作；某条被模型抢先读取后，仍继续处理其他消息，并显示成功与失败条数。
- **只读语义**：消息一旦被模型认领（开始读取）会自动离开条带，此时无法撤回——严格符合“仅未读取可撤回”。
- **优雅降级**：撤回失败（消息已开始发送）时给出明确提示，不会破坏会话。

## 🔍 工作原理

DSH 中“已发送但未读取”的消息 = 仍停留在 Agent **inbox**（待处理队列）中的消息：0.2.x 是 `inbox['next-turn']` / `inbox['next-step']` 里的 pending 项，0.1.x 是会话快照 `ConversationSnapshot.queue`。它有两种 placement：

| placement | 含义 | 官方界面现状 |
| --- | --- | --- |
| `queued` | 运行中排队等待下一轮 | 官方队列坞已有「删除」按钮 |
| `steering` | 运行中插话发送，显示为对话尾部待处理气泡 | **没有任何撤回入口** ← 本插件补上 |

撤回实现分两个版本：

- **静态版（推荐）**：Client 直接调用官方会话 RPC `session.updateQueue(itemId, { kind: 'remove' })`（与官方队列坞的「删除」同一实现）。
- **动态版**：优先调用同一官方会话 RPC；仅在旧运行时没有 `sessions` 服务时，通过包内私有 RPC 回退：

```
Client  (撤回按钮)
   │  host.call('recall', { sessionId, itemId })
   ▼
Host    harness.handle('recall')
   │  agents.get(sessionId).inbox.remove(itemId)
   ▼
效果   消息从 inbox 移除 → inbox 投影更新 → 气泡与条带同步消失
```

### 🧩 运行时兼容

| 运行时 | 「未读插话」数据源 | 撤回调用 |
| --- | --- | --- |
| **0.2.1-rc.1 ～ rc.5**（desktop / web） | `useProjection('inbox')['next-step']` 中 `source.kind === 'user'` 的行 | 官方 `sessions.binding(sessionId).session.updateQueue(id, { kind: 'remove' })` |
| **0.2.x**（含 desktop profile） | `useProjection('inbox')['next-step']` 中 `source.kind === 'user'` 的行 | `sessions.binding(sessionId).session.updateQueue(id, { kind: 'remove' })`（失败码带命名空间：`session/queue-item-not-found`） |
| **0.1.x** | `useSession` / `session` 会话快照的 `queue` 中 `placement === 'steering'` 的行 | 同上（失败码 `queue-item-not-found`） |

- 0.2.x 的 `SessionSnapshot` 已移除 `queue` 字段，本地回显改到 `pendingSubmissions`；插话被接纳后进入 `inbox['next-step']`，在模型下一步读取前仍可撤回。
- 官方队列坞只覆盖 `next-turn`（排队消息，已有删除按钮），`next-step`（插话）这一格由本插件补齐。
- 投影接口存在但尚未就绪时，不回退到旧快照，以免显示已被模型读取的陈旧消息。
- 与 RC 系列官方队列坞一致，只读子代理会话不显示撤回操作；可继续的子代理会话仍可操作。
- RC1–RC5 已逐个官方 tag 核对相关源码契约，并用测试桩覆盖静态、动态客户端；尚未逐版本完成真实界面验收。详见[兼容说明](docs/compatibility.md)。

旧版 Host 回退直接调用 `agent.inbox.remove`；RC 系列使用官方 RPC，以保留会话检查和附件清理。

## 📁 目录结构

```
dsh-recall-unread/
├── README.md                  # 本文件
├── LICENSE                    # MIT 许可证
├── .gitignore                 # Git 忽略规则
├── package.json               # npm 安装清单、项目元数据与测试命令
├── plugin.json                # 插件清单（名称 / ID 前缀 / 代码来源）
├── src/
│   ├── host.js                # Host 半端源码（动态版，可直接作为 code.host）
│   └── client.js              # Client 半端源码（动态版，可直接作为 code.client）
├── plugin/                    # desktop / web 静态插件（安装后随 DSH 加载，推荐）
│   ├── package.json           # 安装包元数据（含 dsh.client 声明）
│   ├── host.js                # Host 半端（空实现占位，撤回走客户端官方 RPC）
│   └── client.js              # Client bundle（__ModuleLoader__ 注册）
└── docs/compatibility.md       # 兼容契约、验证范围与验收步骤
```

## 🚀 安装与激活

### 方式一：静态安装（推荐，随 DSH 加载，重启不丢失）

桌面版使用应用内的「插件 → 添加插件」安装或更新，填写包名 `dsh-recall-unread`。
网页版可使用 DSH 官方插件命令：

```sh
# 网页版
dsh plugin --profile web add dsh-recall-unread
```

完全退出并重新启动对应的 DSH 应用。可在插件市场或插件管理页停用、启用插件。

上述包名命令安装的是 npm 当前已发布版本。GitHub 源码版本与 npm 发布进度可能不同；需要安装本次 **v1.2.1** 更新时，可克隆对应 tag：

```sh
git clone --branch v1.2.1 https://github.com/hg1048596-pixel/dsh-recall-unread.git
```

桌面版在应用内添加克隆目录的绝对路径；网页版将包名替换为该路径：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-recall-unread
```

插件没有构建步骤。普通 npm 安装的 `dsh` CLI 会拒绝管理保留的 `desktop` profile；
只有桌面版配套的管理入口可使用 `dsh plugin --profile desktop …`，桌面用户优先使用应用内安装。

> `dsh.client.platform: web` 表示使用浏览器客户端运行时；桌面版也使用这一客户端声明，无需改成 `desktop`。

#### 手工安装（可选）

无法使用插件命令时，可将 `plugin/` 目录部署到所用 profile。以下以 `web` 为例；桌面版使用 `desktop`：

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

本插件**零配置、开箱即用**，无需任何设置。静态安装修改 `plugin/client.js` 后重新部署并重启；动态版修改 `src/client.js` 后重新定义（`cordis_define`）。两处客户端逻辑应同步维护，常用可调项：

| 项 | 位置 | 说明 |
| --- | --- | --- |
| 条带排序 | `slots.register(…, order: 30)` | 数字越大越靠后，可调整与输入框的贴近程度 |
| 提示停留时长 | `ctx.timeout(() => setStatus(null), 2500)` | 撤回结果提示自动消失的时间（毫秒） |

## 📖 使用说明

1. 确保插件已启用（安装后默认启用；可在插件市场/管理页开关）。
2. 模型正在运行（如深度思考、长工具调用）时，用**插话发送**（默认快捷键：运行中发送即进入 steering）发出一条文字。
3. 消息出现在对话尾部（带“待处理”标记），同时输入框上方出现「未读消息」条带。
4. 点击该消息右侧的「撤回」——消息从 inbox 移除后，气泡与列表同步更新，提示“已撤回一条消息”。最后一条撤回后，结果提示仍保留约 2.5 秒。
5. 有多条未读时，可点「全部撤回」。若部分消息已被读取，会继续撤回剩余消息并报告结果。请求执行中会阻止重复点击。

## ⚠️ 限制与已知问题

- 仅能撤回 **尚未被模型读取**（仍在 inbox）的消息；一旦被认领即不可撤回。
- 排队消息（`queued`）官方队列坞已提供删除，本插件不重复覆盖。
- 只读子代理会话仅显示未读消息，不提供撤回按钮。
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
> 静态 Host 半端为空实现，不依赖 timer。

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
脚本默认处理 `web` profile；桌面版应在 `~/.dsh/profiles/desktop/cordis.patch.yml` 中对同名条目设置 `disabled: true` 后重启。

> 修改 `plugin/client.js` 后记得重新部署到
> `~/.dsh/profiles/web/node_modules/dsh-recall-unread/` 并重启 DSH。

## 📦 版本历史

- **v1.2.1**（2026-11）核对并适配 DSH 0.2.1-rc.1 至 rc.5：同步静态、动态客户端；投影未就绪时避免旧快照回退，遵守只读子代理限制；批量撤回遇单条失败继续处理其余消息，保留最后一条撤回的结果提示，并防止同时重复提交；补充兼容回归测试。
- **v1.2.0**（2026-10）适配 DSH 0.2.x（含 desktop profile）：未读插话改从
  `useProjection('inbox')['next-step']` 读取（`SessionSnapshot.queue` 已被官方移除），
  保留 0.1.x 的 `session.queue` 回退；预览文本按官方队列坞口径从 content 块折叠；
  失败码兼容 `session/queue-item-not-found`。
- **v1.1.0**（2026-08）移除 Amadeus 启动器依赖：删除 🧩 菜单入口与客户端
  amadeus 轮询，改为启用即生效（插件市场/管理页的启用·停用开关控制加载）。
- **v1.0.1**（2026-08）防锁死固化：bundle 彻底移除 `module`/`exports` 引用
  （factory 直接 return 导出）；`?.load` 注册守卫；`inject` 保留
  `['slots','timer']` 并加 Proxy 访问警告；新增 git 钩子校验与一键急救开关脚本。
- **v1.0.0**（2026-08）首个可运行版本：Host RPC 撤回 + Client 未读消息条带。

## 📄 许可证

[MIT](LICENSE)
