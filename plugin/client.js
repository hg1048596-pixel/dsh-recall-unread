/*
 * dsh-recall-unread — Client half（静态 web profile 版，启动入口在 Amadeus 插件启动器菜单内）
 *
 * 通过 window.__ModuleLoader__ 注册到 DSH 网页运行时。
 * ⚠️ 修改警告：__ModuleLoader__.load 的 factory 只注入 require，不注入 module/exports！
 *    factory 的【返回值】就是模块导出（{ inject, apply }），
 *    任何地方都不要引用 module / exports / module.exports ——
 *    那会抛 ReferenceError: module is not defined，导致启动时
 *    "Failed to load plugins / failed to import loader entry (dsh-recall-unread)"。
 *    （官方包的 CJS 写法 `var module = { exports: {} }` 也只是声明局部变量，
 *     本插件直接用 return 返回导出，彻底绕开这个坑。）
 * - 启动入口位于 Amadeus 🧩 插件启动器菜单（由 Host 半端通过 amadeus-skins.register 注册）；
 * - 本端轮询 amadeus /amadeus/rpc?m=getStatus，读取「撤回插件」条目的 active 状态；
 * - active 为 true 时，「未读消息」条带（conversation.input.dock）才显示——
 *   列出仍处于 pending（模型尚未读取）的插话消息（placement: 'steering'），
 *   每条提供「撤回」按钮，撤回调用官方会话 RPC
 *   sessions.binding(sessionId).session.updateQueue(itemId, { kind: 'remove' })。
 */
window.__ModuleLoader__?.load({ id: 'dsh-recall-unread', factory: (require) => {
  const React = require('react')
  // 声明必需的 UI 服务 + timer（轮询用 ctx.interval、条带状态自动清除用 ctx.timeout）。
  // ⚠️ 不要去掉 'timer'：Cordis 的 ctx 是 Proxy，访问未 inject 的服务属性会直接抛
  //    "cannot get property \"timer\" without inject"，导致 apply 阶段加载失败。
  const inject = ['slots', 'timer']

  // ---- 共享开关状态（轮询同步 + 条带订阅）----
  const listeners = new Set()
  let active = false
  function getActive() { return active }
  function setActive(value) {
    if (value === active) return
    active = value
    for (const fn of listeners) fn()
  }
  function subscribeStore(fn) {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }

  function apply(ctx) {
    const slots = ctx.get('slots')
    const sessions = ctx.get('sessions')
    if (slots === undefined) return

    // 样式（静态插件可直接操作 DOM；卸载时随 ctx.effect 清理）
    const css = [
      '.recall-dock{display:flex;justify-content:center;padding:0 var(--dsh-composer-side-clearance) 8px}',
      '.recall-panel{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:8px 12px}',
      '.recall-head{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.recall-head b{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.recall-spacer{flex:1}',
      '.recall-status{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px;margin-top:4px}',
      '.recall-status-error{color:var(--dsw-alias-state-error-primary)}',
      '.recall-list{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.recall-row{display:flex;align-items:center;gap:10px;min-width:0}',
      '.recall-preview{flex:1;min-width:0;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.recall-btn{flex:none;border:none;border-radius:8px;padding:2px 10px;font-size:12px;line-height:20px;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.recall-btn:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}',
      '.recall-btn:disabled{opacity:.5;cursor:default}',
      '.recall-btn-ghost{background:transparent;color:var(--dsw-alias-label-secondary)}'
    ].join('\n')
    const styleTag = document.createElement('style')
    styleTag.dataset.pluginCss = 'dsh-recall-unread'
    styleTag.textContent = css
    document.head.appendChild(styleTag)
    ctx.effect(() => () => {
      try { styleTag.remove() } catch (error) { /* ignore */ }
    })

    // ---- 轮询 Amadeus 启动器状态，同步「撤回插件」active ----
    ctx.effect(() => {
      const sync = async () => {
        try {
          const res = await fetch('/amadeus/rpc?m=getStatus&args=' + encodeURIComponent(JSON.stringify({})), { cache: 'no-store' })
          const data = await res.json()
          if (data && Array.isArray(data.skins)) {
            const mine = data.skins.find((e) => e.id === 'recall-unread')
            if (mine !== undefined) setActive(mine.active === true)
          }
        } catch (error) {
          // amadeus 不可用：保持关闭状态
        }
      }
      sync()
      // 防护：timer 服务缺失时绝不抛错/挂起（fallback 为单次同步）
      if (typeof ctx.interval !== 'function') return
      return ctx.interval(sync, 2000)
    })

    // ---- 「未读消息」条带（仅 amadeus 菜单启动后显示）----
    const RecallDock = (props) => {
      const [on, setOn] = React.useState(getActive())
      React.useEffect(() => subscribeStore(() => setOn(getActive())), [])
      if (!on) return null

      const queue = (props.session && props.session.queue) || []
      const steering = queue.filter((row) => row.placement === 'steering')
      const [busy, setBusy] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const sessionId = props.sessionId

      React.useEffect(() => {
        if (status === null) return
        return ctx.timeout(() => setStatus(null), 2500)
      }, [status])

      if (steering.length === 0 || sessionId === undefined || sessions === undefined) return null

      const doRecall = async (row) => {
        if (busy !== null) return
        setBusy(row.id)
        try {
          const binding = sessions.binding(sessionId)
          if (binding === undefined) throw new Error('session binding unavailable')
          const result = await binding.session.updateQueue(row.id, { kind: 'remove' })
          if (result && result.ok === true) {
            setStatus({ kind: 'info', text: '已撤回一条消息' })
          } else {
            const code = result && result.error && result.error.code
            setStatus({ kind: 'error', text: code === 'queue-item-not-found' ? '该消息已开始发送，无法撤回' : '撤回失败，请重试' })
          }
        } catch (error) {
          setStatus({ kind: 'error', text: '撤回失败，请重试' })
          console.error('[dsh-recall-unread] recall failed', error)
        } finally {
          setBusy((current) => (current === row.id ? null : current))
        }
      }

      const doRecallAll = async () => {
        if (busy !== null) return
        setBusy('__all__')
        try {
          const binding = sessions.binding(sessionId)
          if (binding === undefined) throw new Error('session binding unavailable')
          for (const row of steering) {
            const result = await binding.session.updateQueue(row.id, { kind: 'remove' })
            if (!(result && result.ok === true)) throw new Error('recall rejected')
          }
          setStatus({ kind: 'info', text: '已撤回全部未读消息' })
        } catch (error) {
          setStatus({ kind: 'error', text: '部分消息撤回失败，可能已开始发送' })
          console.error('[dsh-recall-unread] recall-all failed', error)
        } finally {
          setBusy(null)
        }
      }

      return React.createElement('div', { className: 'recall-dock', 'data-recall-dock': '' },
        React.createElement('div', { className: 'recall-panel' },
          React.createElement('div', { className: 'recall-head' },
            React.createElement('b', null, '未读消息'),
            React.createElement('span', null, steering.length + ' 条已发送文字，模型尚未读取'),
            React.createElement('span', { className: 'recall-spacer' }),
            steering.length > 1 ? React.createElement('button', {
              type: 'button',
              className: 'recall-btn recall-btn-ghost',
              disabled: busy !== null,
              onClick: doRecallAll
            }, '全部撤回') : null
          ),
          status !== null ? React.createElement('div', {
            className: status.kind === 'error' ? 'recall-status recall-status-error' : 'recall-status'
          }, status.text) : null,
          React.createElement('ul', { className: 'recall-list' },
            steering.map((row) => React.createElement('li', { key: row.id, className: 'recall-row' },
              React.createElement('span', { className: 'recall-preview', title: row.preview }, row.preview),
              React.createElement('button', {
                type: 'button',
                className: 'recall-btn',
                disabled: busy !== null,
                onClick: () => doRecall(row)
              }, busy === row.id ? '撤回中…' : '撤回')
            ))
          )
        )
      )
    }

    slots.inject('conversation.input.dock', () => slots.register(
      { name: 'conversation.input.dock', id: 'recall-sent', order: 30 },
      RecallDock
    ))
  }

  return { inject, apply }
} })
