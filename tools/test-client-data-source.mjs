// 验证 plugin/client.js 的数据源与撤回调用（不依赖真实 DSH）：
//   0.2.x → useProjection('inbox')['next-step'] 里的用户插话；
//   0.1.x → 回退到 session.queue 里 placement === 'steering' 的行。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'plugin', 'client.js'), 'utf8')

// ---- 最小桩件：ModuleLoader / React / DOM ----
let definition = null
const window = { __ModuleLoader__: { load: (def) => { definition = def } } }
const document = { createElement: () => ({ dataset: {}, textContent: '', remove() {} }), head: { appendChild() {} } }
const React = {
  useState: (init) => [init, () => {}],
  useEffect: () => {},
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
}
const requireShim = (id) => { if (id === 'react') return React; throw new Error('unexpected require: ' + id) }
new Function('window', 'document', 'require', source)(window, document, requireShim)
if (definition === null) { console.error('FAIL: plugin/client.js 未注册模块'); process.exit(2) }

const calls = []
let registered = null
const slots = { inject: (name, fn) => fn(), register: (opts, comp) => { registered = { opts, comp } } }
const sessions = { binding: (id) => ({ session: { updateQueue: async (itemId, action) => { calls.push({ id, itemId, action }); return { ok: true, value: { accepted: true } } } } }) }
const ctx = {
  get: (name) => (name === 'slots' ? slots : name === 'sessions' ? sessions : undefined),
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  timeout: () => () => {},
}
const plugin = definition.factory(requireShim)
plugin.apply(ctx)
if (registered === null) { console.error('FAIL: RecallDock 未注册到 conversation.input.dock'); process.exit(2) }

// ---- 遍历渲染树 ----
const walk = (node, visit) => {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return }
  visit(node)
  if (node.props && node.props.children) for (const c of node.props.children) walk(c, visit)
}
const texts = (tree) => { const out = []; walk(tree, (n) => { if (typeof n === 'string' || typeof n === 'number') out.push(String(n)) }); return out.join(' | ') }
const buttons = (tree) => { const out = []; walk(tree, (n) => { if (n.type === 'button') out.push(n) }); return out }
const label = (b) => (Array.isArray(b.props.children) ? b.props.children.join('') : String(b.props.children === undefined ? '' : b.props.children))

const results = []
const check = (name, ok) => { results.push([name, ok]); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name) }

// ---- 0.2.x：inbox 投影 ----
const inbox = {
  'next-turn': [{ id: 'q1', source: { kind: 'user' }, content: [{ type: 'text', text: '排队消息' }] }],
  'next-step': [
    { id: 's1', source: { kind: 'user' }, content: [{ type: 'text', text: '第一条插话' }] },
    { id: 's2', source: { kind: 'tool' }, content: [{ type: 'text', text: '工具注入' }] },
    { id: 's3', source: { kind: 'user' }, content: [{ type: 'text', text: '第二条插话' }] },
  ],
}
const view02 = registered.comp({ useProjection: (key) => (key === 'inbox' ? inbox : undefined), sessionId: 'sess-1' })
const flat02 = texts(view02)
console.log('0.2.x 渲染文本: ' + flat02)
check('0.2.x 只列 next-step 的用户插话（2 条，且不含排队/工具行）', flat02.includes('2 条已发送插话') && flat02.includes('第一条插话') && flat02.includes('第二条插话') && !flat02.includes('排队消息') && !flat02.includes('工具注入'))
const allBtn = buttons(view02).find((b) => label(b) === '全部撤回')
check('多条时提供「全部撤回」', allBtn !== undefined)
const recallBtn = buttons(view02).find((b) => label(b) === '撤回')
await recallBtn.props.onClick()
check('点击撤回调用官方 updateQueue(id, {kind:remove})', calls.length === 1 && calls[0].id === 'sess-1' && calls[0].itemId === 's1' && calls[0].action.kind === 'remove')
if (allBtn !== undefined) { await allBtn.props.onClick(); check('全部撤回逐条调用（共 3 次）', calls.length === 3) }

// ---- 0.1.x：回退会话快照 ----
const legacy = registered.comp({ session: { queue: [
  { id: 'l1', placement: 'steering', preview: '插话A' },
  { id: 'l2', placement: 'queued', preview: '排队B' },
] }, sessionId: 'sess-2' })
const flatLegacy = texts(legacy)
console.log('0.1.x 渲染文本: ' + flatLegacy)
check('0.1.x 回退只列 steering 行并使用 preview', flatLegacy.includes('插话A') && !flatLegacy.includes('排队B'))

// ---- 无未读 ----
const empty = registered.comp({ useProjection: () => ({ 'next-step': [] }), sessionId: 'sess-3' })
check('无未读插话时返回 null（不渲染条带）', empty === null)

const failed = results.filter(([, ok]) => !ok).length
console.log(failed === 0 ? 'ALL PASS' : 'SOME FAIL')
process.exit(failed === 0 ? 0 : 1)
