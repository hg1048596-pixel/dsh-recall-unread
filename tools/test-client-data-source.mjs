// Offline behavior tests for both distributed client forms. Run with:
//   node tools/test-client-data-source.mjs
// RC source-contract verification is separate; these tests exercise component
// behavior with stateful hooks, projection changes and delayed RPC responses.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { button, buttons, createClient, deferred, texts, walk } from './client-test-harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const userRow = (id, text = id) => ({ id, source: { kind: 'user' }, content: [{ type: 'text', text }] })
const projectionProps = (inbox, extra = {}) => ({
  sessionId: 'session-1',
  useProjection(key) { assert.equal(key, 'inbox'); return inbox },
  useSession: (selector) => selector({ subagent: null }),
  ...extra,
})
const failure = (variant, code) => variant === 'static'
  ? { ok: false, error: { code } }
  : { ok: false, code }

for (const variant of ['static', 'dynamic']) {
  const setup = (t, options) => {
    const client = createClient(variant, options)
    t.after(() => client.dispose())
    return client
  }

  test(`${variant}: registers an additive dock and keeps timer injection`, (t) => {
    const client = setup(t)
    assert.equal(client.registration.opts.order, 30)
    assert.ok(client.plugin.inject.includes('slots'))
    assert.ok(client.plugin.inject.includes('timer'))
    assert.ok(client.styleTags[0].textContent.includes('.recall-dock'))
  })

  test(`${variant}: projection lists only next-step human messages`, (t) => {
    const client = setup(t)
    const view = client.render(projectionProps({
      'next-turn': [userRow('queued', '排队消息')],
      'next-step': [
        userRow('s1', '第一条插话'),
        { id: 'tool', source: { kind: 'tool' }, content: [{ type: 'text', text: '工具注入' }] },
        null,
        userRow('s2', '第二条插话'),
      ],
    }))
    const flat = texts(view)
    assert.match(flat, /2 条/)
    assert.match(flat, /第一条插话/)
    assert.match(flat, /第二条插话/)
    assert.doesNotMatch(flat, /排队消息|工具注入/)
    assert.equal(buttons(view).length, 3)
  })

  test(`${variant}: projection remains authoritative while loading or empty`, (t) => {
    const client = setup(t)
    const stale = { queue: [{ id: 'stale', placement: 'steering', preview: '过期快照' }] }
    for (const inbox of [undefined, null, {}, { 'next-step': [] }]) {
      assert.equal(client.render(projectionProps(inbox, {
        session: stale,
        useSession: (selector) => selector({ ...stale, subagent: null }),
      })), null)
    }
  })

  test(`${variant}: legacy session prop filters queued messages`, (t) => {
    const client = setup(t)
    const view = client.render({ sessionId: 'legacy', session: { queue: [
      { id: 'l1', placement: 'steering', preview: '历史插话' },
      { id: 'l2', placement: 'queued', preview: '历史排队' },
    ] } })
    assert.match(texts(view), /历史插话/)
    assert.doesNotMatch(texts(view), /历史排队/)
    assert.equal(buttons(view).length, 1)
  })

  test(`${variant}: legacy selector hook works without props.session`, (t) => {
    const client = setup(t)
    const snapshot = { subagent: null, queue: [{ id: 'l1', placement: 'steering', preview: '快照钩子' }] }
    assert.match(texts(client.render({
      sessionId: 'legacy-hook', useSession: (selector) => selector(snapshot),
    })), /快照钩子/)
  })

  test(`${variant}: empty data or absent session ID renders nothing`, (t) => {
    const client = setup(t)
    assert.equal(client.render(projectionProps({ 'next-step': [] })), null)
    assert.equal(client.render(projectionProps({ 'next-step': [userRow('s1')] }, { sessionId: undefined })), null)
  })

  test(`${variant}: content preview skips attachments and truncates Unicode safely`, (t) => {
    const client = setup(t)
    const row = userRow('s1')
    row.content = [{ type: 'image' }, { type: 'file' }, { type: 'text', text: '😀'.repeat(81) }]
    const view = client.render(projectionProps({ 'next-step': [row] }))
    let preview
    walk(view, (node) => { if (node.props?.className === 'recall-preview') preview = node })
    assert.equal(preview.props.title, '😀'.repeat(80) + '…')
    assert.equal(texts(preview), preview.props.title)
  })

  test(`${variant}: single recall uses the addressed session and official remove action`, async (t) => {
    const client = setup(t)
    const inbox = { 'next-step': [userRow('s1')] }
    await button(client.render(projectionProps(inbox)), '撤回').props.onClick()
    assert.deepEqual(client.calls, [{ sessionId: 'session-1', itemId: 's1', action: { kind: 'remove' } }])
    assert.match(texts(client.render()), /已撤回一条消息/)
    assert.equal(client.timers.size, 1)
    inbox['next-step'] = []
    assert.match(texts(client.render()), /已撤回一条消息/)
    let notice
    walk(client.tree, (node) => { if (node.props?.role === 'status') notice = node })
    assert.ok(notice, 'success feedback needs a live status region')
    assert.equal(client.expireStatus(), null)
    assert.equal(client.timers.size, 0)
  })

  test(`${variant}: same-tick duplicate clicks issue only one request`, async (t) => {
    const client = setup(t)
    const pending = deferred()
    client.respond(() => pending.promise)
    const recall = button(client.render(projectionProps({ 'next-step': [userRow('s1')] })), '撤回')
    const first = recall.props.onClick()
    const duplicate = recall.props.onClick()
    assert.equal(client.calls.length, 1)
    assert.ok(buttons(client.render()).every((item) => item.props.disabled))
    pending.resolve({ ok: true, value: { accepted: true } })
    await Promise.all([first, duplicate])
    assert.ok(buttons(client.render()).every((item) => !item.props.disabled))
  })

  for (const code of variant === 'static'
    ? ['queue-item-not-found', 'session/queue-item-not-found', 'session/steer-unavailable']
    : ['already-claimed', 'queue-item-not-found', 'session/queue-item-not-found', 'session/steer-unavailable']) {
    test(`${variant}: ${code} is reported as already being read`, async (t) => {
      const client = setup(t)
      client.respond(async () => failure(variant, code))
      await button(client.render(projectionProps({ 'next-step': [userRow('s1')] })), '撤回').props.onClick()
      assert.match(texts(client.render()), /该消息已开始发送，无法撤回/)
      let alert
      walk(client.tree, (node) => { if (node.props?.role === 'alert') alert = node })
      assert.ok(alert, 'failure feedback needs an alert region')
    })
  }

  test(`${variant}: accepted:false is not displayed as a successful recall`, async (t) => {
    const client = setup(t)
    client.respond(async () => ({ ok: true, value: { accepted: false } }))
    await button(client.render(projectionProps({ 'next-step': [userRow('s1')] })), '撤回').props.onClick()
    assert.match(texts(client.render()), /撤回失败/)
    assert.doesNotMatch(texts(client.tree), /已撤回一条消息/)
  })

  test(`${variant}: transport errors release busy state and allow retry`, async (t) => {
    const client = setup(t)
    client.respond(async () => { throw new Error('transport unavailable') })
    await button(client.render(projectionProps({ 'next-step': [userRow('s1')] })), '撤回').props.onClick()
    assert.match(texts(client.render()), /撤回失败/)
    assert.ok(buttons(client.tree).every((item) => !item.props.disabled))
    client.respond(async () => ({ ok: true }))
    await button(client.tree, '撤回').props.onClick()
    assert.equal(client.calls.length, 2)
    assert.match(texts(client.render()), /已撤回一条消息/)
  })

  test(`${variant}: bulk recall removes each human row in order`, async (t) => {
    const client = setup(t)
    await button(client.render(projectionProps({ 'next-step': [userRow('s1'), userRow('s2')] })), '全部撤回').props.onClick()
    assert.deepEqual(client.calls.map((call) => call.itemId), ['s1', 's2'])
    assert.match(texts(client.render()), /已撤回全部未读消息/)
  })

  test(`${variant}: bulk recall continues after rejection and transport failure`, async (t) => {
    const client = setup(t)
    client.respond(async ({ itemId }) => {
      if (itemId === 's1') return failure(variant, 'session/queue-item-not-found')
      if (itemId === 's2') throw new Error('transport unavailable')
      return { ok: true, value: { accepted: true } }
    })
    await button(client.render(projectionProps({
      'next-step': [userRow('s1'), userRow('s2'), userRow('s3')],
    })), '全部撤回').props.onClick()
    assert.deepEqual(client.calls.map((call) => call.itemId), ['s1', 's2', 's3'])
    assert.match(texts(client.render()), /已撤回 1 条，另有 2 条撤回失败/)
    assert.doesNotMatch(texts(client.tree), /已撤回全部未读消息/)
  })

  test(`${variant}: bulk recall also blocks same-tick duplicate requests`, async (t) => {
    const client = setup(t)
    const pending = deferred()
    client.respond(() => pending.promise)
    const view = client.render(projectionProps({ 'next-step': [userRow('s1'), userRow('s2')] }))
    const first = button(view, '全部撤回').props.onClick()
    const duplicate = button(view, '撤回').props.onClick()
    assert.equal(client.calls.length, 1)
    pending.resolve({ ok: true })
    await Promise.all([first, duplicate])
    assert.deepEqual(client.calls.map((call) => call.itemId), ['s1', 's2'])
  })

  test(`${variant}: ordinary and continuable sessions allow recall`, async (t) => {
    const client = setup(t)
    for (const subagent of [null, undefined, { address: { mode: 'continuable' } }]) {
      const view = client.render(projectionProps({ 'next-step': [userRow('s1')] }, {
        useSession: (selector) => selector({ subagent }),
      }))
      assert.equal(button(view, '撤回').props.disabled, false)
      await button(view, '撤回').props.onClick()
    }
    assert.equal(client.calls.length, 3)
  })

  test(`${variant}: autonomous subagents do not expose an active recall action`, (t) => {
    const client = setup(t)
    const view = client.render(projectionProps({ 'next-step': [userRow('s1'), userRow('s2')] }, {
      useSession: (selector) => selector({ subagent: { address: { mode: 'oneshot' } } }),
    }))
    assert.ok(buttons(view).every((item) => item.props.disabled))
    assert.equal(client.calls.length, 0)
  })

  test(`${variant}: remote-access permission uses the namespaced endpoint`, async (t) => {
    const client = setup(t)
    const endpoints = []
    const view = client.render(projectionProps({ 'next-step': [userRow('s1')] }, {
      useAccess(endpoint) { endpoints.push(endpoint); return true },
    }))
    assert.deepEqual(endpoints, ['session/updateQueue'])
    await button(view, '撤回').props.onClick()
    assert.equal(client.calls.length, 1)
  })

  test(`${variant}: denied or unresolved remote access never enables recall`, (t) => {
    const client = setup(t)
    for (const access of [false, undefined]) {
      const view = client.render(projectionProps({ 'next-step': [userRow('s1'), userRow('s2')] }, {
        useAccess(endpoint) { assert.equal(endpoint, 'session/updateQueue'); return access },
      }))
      assert.ok(buttons(view).every((item) => item.props.disabled))
    }
    assert.equal(client.calls.length, 0)
  })

  test(`${variant}: permission hook order is stable across empty and live projections`, (t) => {
    const client = setup(t)
    const inbox = { 'next-step': [] }
    let access = true
    const props = projectionProps(inbox, {
      useAccess(endpoint) {
        assert.equal(endpoint, 'session/updateQueue')
        client.React.useRef(null)
        return access
      },
    })
    assert.equal(client.render(props), null)
    inbox['next-step'] = [userRow('s1')]
    assert.equal(button(client.render(props), '撤回').props.disabled, false)
    access = false
    assert.ok(buttons(client.render(props)).every((item) => item.props.disabled))
    inbox['next-step'] = []
    assert.equal(client.render(props), null)
  })

  test(`${variant}: status timers are cancelled on unmount`, async (t) => {
    const client = setup(t)
    await button(client.render(projectionProps({ 'next-step': [userRow('s1')] })), '撤回').props.onClick()
    client.render()
    assert.equal(client.timers.size, 1)
    client.dispose()
    assert.equal(client.timers.size, 0)
  })
}

test('static: safe to evaluate before ModuleLoader exists', () => {
  const source = readFileSync(join(root, 'plugin/client.js'), 'utf8')
  assert.doesNotThrow(() => new Function('window', source)({}))
})

test('static: style tag is removed when the plugin is disposed', () => {
  const client = createClient('static')
  assert.equal(client.styleTags.length, 1)
  client.dispose()
  assert.equal(client.styleTags[0].removed, true)
})

test('static: absent sessions or binding is handled without uncaught rejection', async (t) => {
  for (const options of [{ noSessions: true }, { noBinding: true }]) {
    const client = createClient('static', options)
    t.after(() => client.dispose())
    await button(client.render(projectionProps({ 'next-step': [userRow('s1')] })), '撤回').props.onClick()
    assert.match(texts(client.render()), /撤回失败/)
    assert.equal(client.calls.length, 0)
  }
})

test('dynamic: uses official RPC when sessions is available', async (t) => {
  const client = createClient('dynamic')
  t.after(() => client.dispose())
  await button(client.render(projectionProps({ 'next-step': [userRow('s1')] })), '撤回').props.onClick()
  assert.deepEqual(client.transports, ['official-rpc'])
})

test('dynamic: retains private-host fallback only for legacy without sessions', async (t) => {
  const client = createClient('dynamic', { noSessions: true })
  t.after(() => client.dispose())
  client.respond(async () => ({ ok: true }))
  await button(client.render({
    sessionId: 'legacy',
    session: { queue: [{ id: 's1', placement: 'steering', preview: '历史插话' }] },
  }), '撤回').props.onClick()
  assert.deepEqual(client.transports, ['private-host'])
  assert.match(texts(client.render()), /已撤回一条消息/)
})

test('dynamic: RC projection sessions never fall back around unavailable official RPC', async (t) => {
  const client = createClient('dynamic', { noSessions: true })
  t.after(() => client.dispose())
  await button(client.render(projectionProps({ 'next-step': [userRow('s1')] })), '撤回').props.onClick()
  assert.deepEqual(client.transports, [])
  assert.match(texts(client.render()), /撤回失败/)
})

test('dynamic: missing binding never falls back around the official RPC', async (t) => {
  const client = createClient('dynamic', { noBinding: true })
  t.after(() => client.dispose())
  await button(client.render(projectionProps({ 'next-step': [userRow('s1')] })), '撤回').props.onClick()
  assert.deepEqual(client.transports, [])
  assert.match(texts(client.render()), /撤回失败/)
})
