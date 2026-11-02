# DSH 兼容说明

插件版本：**1.2.1**。核对日期：2026-11-03。

## 支持范围

| DSH 版本 | 客户端数据源 | 静态版撤回接口 |
| --- | --- | --- |
| 0.2.1-rc.1 | inbox 投影的 `next-step` 用户消息 | 官方 `session.updateQueue(id, { kind: 'remove' })` |
| 0.2.1-rc.2 | 同上 | 同上 |
| 0.2.1-rc.3 | 同上 | 同上 |
| 0.2.1-rc.4 | 同上 | 同上 |
| 0.2.1-rc.5 | 同上 | 同上 |
| 0.2.x 既有运行时 | 同上 | 同上 |
| 0.1.x 既有运行时 | 会话快照 `queue` 的 `placement === 'steering'` 项 | 同上，兼容旧失败码 |

desktop 与 web profile 共用浏览器客户端运行时，插件清单中的 `dsh.client.platform` 均为 `web`。安装时选择实际使用的 profile。

## 核对依据

逐个检查以下官方 tag 的相关源码，并比较相邻 RC 的变化：

| 官方 tag | Commit |
| --- | --- |
| [`dsh-v0.2.1-rc.1`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.1) | `1600d8a1e140dcde43a1a0941940a0480712c011` |
| [`dsh-v0.2.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2) | `687f282e8625c6b8d11ff58211a90524be2e4317` |
| [`dsh-v0.2.1-rc.3`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.3) | `1f81c047fc48fa190a683e469daa699857e9afe8` |
| [`dsh-v0.2.1-rc.4`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.4) | `504a01a9578abc2c6f1fb896b1dc322c9fe24f66` |
| [`dsh-v0.2.1-rc.5`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.5) | `b830ec950faba0a46dda564be3e2d854afed94f1` |

- `conversation.input.dock` 仍为 session 范围的 list 插槽，标准 props 提供 `sessionId`、`useSession`、`useProjection`，本插件无需额外注入这些 props。参见 [RC5 插槽目录](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/extensions/cordis-client-runner/src/client/slot-catalog.ts)。
- 用户插话仍位于 inbox 的 `next-step`，`next-turn` 排队消息由官方队列坞处理。参见 [RC5 官方 QueueDock](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/client/ui-conversation/src/client/queue/QueueDock.tsx)。
- `sessions.binding(sessionId)` 仍返回已保留会话的 binding，静态版通过它调用官方会话 RPC。参见 [RC5 Sessions 服务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/api/session-controller/src/client/sessions/service.ts)。

RC1 至 RC5 间未发现上述核心接口的破坏性变化。RC 的其他插槽、菜单和思考内容展示变更不要求本插件替换数据源。

## 本次兼容处理

- 按接口是否存在选择投影或旧快照；投影尚未到达时显示为空，避免误用旧的 queue。
- 使用 `useSession` 读取会话状态，同时兼容早期直接提供的 `session` props。
- 只读子代理会话不显示撤回操作，与官方队列坞的限制保持一致。
- 支持标准 `useAccess('session/updateQueue')` 权限钩子，无修改权限时不显示撤回操作。
- 批量撤回时逐条处理失败，继续尝试后续仍未读的消息；`accepted: false` 不作为成功处理。
- 请求执行中阻止重复提交；最后一条消息被移除后保留结果提示，约 2.5 秒后清除。
- 静态与动态客户端保持相同的数据筛选和交互逻辑，均优先使用官方会话 RPC；动态版仅在旧运行时没有 `sessions` 服务时回退到包内 Host RPC。

## 验证范围

自动回归使用轻量 React、插槽和 RPC 测试桩，覆盖静态 bundle 与动态客户端的数据源、单条撤回、批量部分失败、重复点击和结果提示等行为。它验证插件对已核对接口的处理，不代表五个完整 DSH 安装均已进行界面测试。

在仓库根目录执行：

```sh
npm test
node --check plugin/client.js
node --check plugin/host.js
```

Windows 另执行启动安全检查：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/check-client-bundle.ps1
```

逐 tag 契约记录位于 `tools/fixtures/dsh-rc-contracts.json`。取得相应官方源码后，可用离线检查脚本核验文件 hash 和关键片段（源码不随插件分发）：

```sh
node tools/check-dsh-rc-contracts.mjs --source-dir ../upstream-contracts
```

真实界面验收仍需在对应 DSH profile 中安装插件并重启，运行以下步骤：

1. 模型正在长思考或执行工具时，发送一条插话，确认输入框上方出现条带。
2. 模型读取前点击「撤回」，确认条带和待处理气泡同步更新，并显示结果提示。
3. 发送多条插话，点击「全部撤回」；若其中一条恰被读取，确认其余条目继续处理。
4. 确认已被读取的插话不再列出，官方 `next-turn` 排队消息不重复显示。
5. 在只读子代理会话中确认没有撤回操作，在可继续的子代理会话中确认可正常操作。
