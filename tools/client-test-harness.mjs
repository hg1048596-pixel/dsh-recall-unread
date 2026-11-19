// Minimal hook runner: state/refs persist, event handlers see their render's
// snapshot, effects run after commit, and changed effects/unmount run cleanup.
// Rendering remains explicit so tests can inspect an RPC while it is pending.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sameDeps = (a, b) => a !== undefined && b !== undefined
  && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))

function createHooks() {
  const cells = []
  let cursor = 0
  let previousCount
  let effects = []
  let dirty = false
  const cell = (kind, initial) => {
    const index = cursor++
    if (!cells[index]) cells[index] = { kind, ...initial() }
    assert.equal(cells[index].kind, kind, 'hook order changed')
    return cells[index]
  }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const state = cell('state', () => ({ value: typeof initial === 'function' ? initial() : initial }))
      return [state.value, (next) => {
        const value = typeof next === 'function' ? next(state.value) : next
        if (!Object.is(value, state.value)) { state.value = value; dirty = true }
      }]
    },
    useRef(initial) { return cell('ref', () => ({ value: { current: initial } })).value },
    useMemo(factory, deps) {
      const memo = cell('memo', () => ({ value: undefined, deps: undefined }))
      if (!sameDeps(memo.deps, deps)) { memo.value = factory(); memo.deps = deps }
      return memo.value
    },
    useCallback(callback, deps) { return React.useMemo(() => callback, deps) },
    useEffect(callback, deps) {
      const effect = cell('effect', () => ({ deps: undefined, cleanup: undefined }))
      if (!sameDeps(effect.deps, deps)) {
        effects.push(() => { effect.cleanup?.(); effect.cleanup = callback(); effect.deps = deps })
      }
    },
  }
  return {
    React,
    get dirty() { return dirty },
    render(component, props) {
      let tree
      let attempts = 0
      do {
        assert.ok(attempts++ < 20, 'component did not settle after effects')
        dirty = false
        cursor = 0
        effects = []
        tree = component(props)
        if (previousCount !== undefined) assert.equal(cursor, previousCount, 'hook count changed')
        previousCount = cursor
        for (const effect of effects) effect()
      } while (dirty)
      return tree
    },
    unmount() {
      for (const item of cells) if (item.kind === 'effect') { item.cleanup?.(); item.cleanup = undefined }
    },
  }
}

// Public locale service fixture: dictionaries and subscriptions have explicit owners.
export function createLocale(active = 'en') {
  let snapshot = { active, revision: 0 }
  const dictionaries = new Map()
  const listeners = new Set()
  const publish = () => {
    snapshot = { ...snapshot, revision: snapshot.revision + 1 }
    for (const listener of [...listeners]) listener()
  }
  return {
    dictionaries, listeners,
    getSnapshot() { return snapshot },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    register(namespace, dicts) {
      assert.equal(dictionaries.has(namespace), false, 'duplicate dictionary owner')
      dictionaries.set(namespace, dicts)
      publish()
      return () => { dictionaries.delete(namespace); publish() }
    },
    bind(namespace) {
      return (key, params = {}) => {
        const dicts = dictionaries.get(namespace)
        // Baseline locales and French's declared English fallback; the host
        // resolves browser regional tags before selecting these locale IDs.
        const language = snapshot.active.toLowerCase()
        const template = dicts?.[language]?.[key] ?? dicts?.en?.[key] ?? key
        return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match)
      }
    },
    setLocale(active) { snapshot = { ...snapshot, active }; publish() },
  }
}

export function createClient(variant, options = {}) {
  const hooks = createHooks()
  const calls = []
  const transports = []
  const errors = []
  const timers = new Set()
  const disposers = []
  const styleTags = []
  const services = { ...options.services }
  const injections = new Set()
  const browserListeners = new Set()
  const navigator = options.navigator
  const window = {
    addEventListener(name, callback) { assert.equal(name, 'languagechange'); browserListeners.add(callback) },
    removeEventListener(name, callback) { assert.equal(name, 'languagechange'); browserListeners.delete(callback) },
  }
  let disposed = false
  let registered
  let responder = async () => ({ ok: true, value: { accepted: true } })
  const invoke = async (sessionId, itemId, action, transport) => {
    const call = { sessionId, itemId, action }
    calls.push(call)
    transports.push(transport)
    return responder(call)
  }
  const sessions = {
    binding: (sessionId) => options.noBinding ? undefined : {
      session: { updateQueue: (itemId, action) => invoke(sessionId, itemId, action, 'official-rpc') },
    },
  }
  const slots = {
    inject(name, callback) {
      assert.equal(name, 'conversation.input.dock')
      return callback()
    },
    register(opts, component) {
      assert.equal(opts.name, 'conversation.input.dock')
      assert.equal(opts.id, 'recall-sent')
      registered = { opts, component }
      return () => {}
    },
  }
  const ctx = {
    get(name) {
      if (name === 'slots') return options.noSlots ? undefined : slots
      if (name === 'sessions') return options.noSessions ? undefined : sessions
      return services[name]
    },
    inject(names, callback) {
      assert.deepEqual(names, ['locale'])
      const injection = { cleanups: [], start() {
        if (!services.locale) return
        const child = { get: ctx.get, effect(effect) {
          const cleanup = effect()
          if (typeof cleanup === 'function') injection.cleanups.push(cleanup)
          return cleanup
        } }
        callback(child)
      }, stop() { for (const cleanup of injection.cleanups.splice(0).reverse()) cleanup() } }
      injections.add(injection)
      injection.start()
      disposers.push(() => { injection.stop(); injections.delete(injection) })
    },
    effect(callback) {
      const cleanup = callback()
      if (typeof cleanup === 'function') disposers.push(cleanup)
      return cleanup
    },
    timeout(callback, delay) {
      assert.equal(delay, 2500)
      timers.add(callback)
      return () => timers.delete(callback)
    },
  }
  const document = {
    createElement(type) {
      assert.equal(type, 'style')
      return { dataset: {}, textContent: '', remove() { this.removed = true } }
    },
    head: { appendChild(tag) { styleTags.push(tag) } },
  }
  const source = readFileSync(join(root, variant === 'static' ? 'plugin/client.js' : 'src/client.js'), 'utf8')
  const consoleShim = { error: (...args) => errors.push(args) }
  let plugin
  if (variant === 'static') {
    let definition
    window.__ModuleLoader__ = { load(value) { definition = value } }
    new Function('window', 'document', 'console', 'navigator', source)(window, document, consoleShim, navigator)
    assert.equal(definition?.id, 'dsh-recall-unread')
    plugin = definition.factory((id) => {
      assert.equal(id, 'react')
      return hooks.React
    })
  } else {
    const host = { call(name, args) {
      assert.equal(name, 'recall')
      return invoke(args.sessionId, args.itemId, { kind: 'remove' }, 'private-host')
    } }
    const styles = { insert(css) { styleTags.push({ textContent: css }) } }
    plugin = new Function('React', 'host', 'styles', 'console', 'navigator', 'window', source)(hooks.React, host, styles, consoleShim, navigator, window)
  }
  plugin.apply(ctx)
  if (!options.noSlots) assert.ok(registered, 'RecallDock was not registered')

  let currentProps
  let tree
  return {
    calls, transports, errors, timers, styleTags, plugin, browserListeners, React: hooks.React,
    setLocaleService(service) {
      if (disposed) return
      for (const injection of injections) injection.stop()
      services.locale = service
      for (const injection of injections) injection.start()
    },
    languageChanged() { for (const listener of browserListeners) listener() },
    get registration() { return registered },
    get tree() { return tree },
    respond(callback) { responder = callback },
    render(props = currentProps) {
      currentProps = props
      tree = hooks.render(registered.component, props)
      return tree
    },
    flush() { return hooks.dirty ? this.render() : tree },
    expireStatus() {
      for (const callback of [...timers]) { timers.delete(callback); callback() }
      return this.render()
    },
    dispose() {
      if (disposed) return
      disposed = true
      hooks.unmount()
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

export function walk(node, visit) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return }
  visit(node)
  if (node.props) walk(node.props.children, visit)
}

export function texts(tree) {
  const values = []
  walk(tree, (node) => { if (typeof node === 'string' || typeof node === 'number') values.push(String(node)) })
  return values.join(' | ')
}

export function buttons(tree) {
  const values = []
  walk(tree, (node) => { if (node.type === 'button') values.push(node) })
  return values
}

export function button(tree, label) {
  const found = buttons(tree).find((node) => texts(node) === label)
  assert.ok(found, `missing button: ${label}`)
  return found
}

export function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
