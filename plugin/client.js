/*
 * dsh-recall-unread — Client half（静态 web profile 版，启用即生效）
 *
 * 通过 window.__ModuleLoader__ 注册到 DSH 网页运行时。
 *
 * ⚠️ 修改警告：__ModuleLoader__.load 的 factory 只注入 require，不注入 module/exports！
 *    factory 的【返回值】就是模块导出（{ inject, apply }），
 *    任何地方都不要引用 module / exports / module.exports ——
 *    那会抛 ReferenceError: module is not defined，导致启动时
 *    "Failed to load plugins / failed to import loader entry (dsh-recall-unread)"。
 *
 * 功能：在 conversation.input.dock 插槽注册「未读消息」条带，列出已发送但模型尚未读取的插话
 * （steering）消息，每条提供「撤回」按钮；撤回调用官方会话 RPC
 * sessions.binding(sessionId).session.updateQueue(itemId, { kind: 'remove' })。
 *
 * 数据源（同时兼容两代运行时）：
 *   - DSH 0.2.x（含 desktop profile）：useProjection('inbox')['next-step'] 中 source.kind === 'user' 的行。
 *     插话被接纳后进入 agent inbox 的 next-step，模型下一步读取前都可以撤回；官方队列条带只覆盖
 *     next-turn，这一格由本插件补齐。
 *   - DSH 0.1.x：回退到会话快照 session.queue 里 placement === 'steering' 的行。
 *
 * 启用/停用由插件市场（dsh-market）或插件管理页的开关控制：禁用 = 不加载。
 */
window.__ModuleLoader__?.load({ id: 'dsh-recall-unread', factory: (require) => {
  const React = require('react')
  // 必需的 UI 服务 + timer（状态提示自动清除用 ctx.timeout）。
  // ⚠️ 不要去掉 'timer'：Cordis 的 ctx 是 Proxy，访问未 inject 的服务属性会直接抛
  //    "cannot get property \"timer\" without inject"，导致 apply 阶段加载失败。
  // 'sessions' 故意不放进 inject：0.1.x 的组合里没有这个客户端服务，放进去插件会永不激活；
  // 改为点击「撤回」时用 ctx.get('sessions') 取一次。
  const inject = ['slots', 'timer']

  function apply(ctx) {
    const slots = ctx.get('slots')
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

    // ---- 预览文本 ----
    // 0.2.x 的 inbox 行只有 content 块（没有 preview 字段），这里按官方 QueueDock 的同一口径折叠成一行。
    const PREVIEW_CHARS = 80
    function previewOfContent(content) {
      if (!Array.isArray(content)) return ''
      const flat = content
        .filter((block) => block && block.type !== 'image' && block.type !== 'file')
        .map((block) => (block.type === 'text' ? block.text : '[' + String(block.type) + ']'))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      const chars = Array.from(flat)
      return chars.length > PREVIEW_CHARS ? chars.slice(0, PREVIEW_CHARS).join('') + '…' : flat
    }

    // ---- 「未读消息」条带（插件启用即生效）----
    const RecallDock = (props) => {
      // props.useProjection 只在 0.2.x 出现；对同一组件实例恒定，可安全按运行时分支调用。
      const inbox = props.useProjection !== undefined ? props.useProjection('inbox') : undefined
      let rows
      if (inbox !== undefined && inbox !== null) {
        const nextStep = Array.isArray(inbox['next-step']) ? inbox['next-step'] : []
        rows = nextStep.filter((row) => row && row.source && row.source.kind === 'user')
      } else {
        const legacyQueue = (props.session && props.session.queue) || []
        rows = legacyQueue.filter((row) => row.placement === 'steering')
      }

      const [busy, setBusy] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const sessionId = props.sessionId

      React.useEffect(() => {
        if (status === null) return
        return ctx.timeout(() => setStatus(null), 2500)
      }, [status])

      if (rows.length === 0 || sessionId === undefined) return null

      // 0.1.x 的 code 是 queue-item-not-found，0.2.x 带命名空间前缀
      const alreadySending = (code) => code === 'queue-item-not-found' || code === 'session/queue-item-not-found' || code === 'session/steer-unavailable'

      const recall = async (row) => {
        const sessions = ctx.get('sessions')
        if (sessions === undefined) throw new Error('sessions service unavailable')
        const binding = sessions.binding(sessionId)
        if (binding === undefined) throw new Error('session binding unavailable')
        return binding.session.updateQueue(row.id, { kind: 'remove' })
      }

      const doRecall = async (row) => {
        if (busy !== null) return
        setBusy(row.id)
        try {
          const result = await recall(row)
          if (result && result.ok === true) {
            setStatus({ kind: 'info', text: '已撤回一条消息' })
          } else {
            const code = result && result.error && result.error.code
            setStatus({ kind: 'error', text: alreadySending(code) ? '该消息已开始发送，无法撤回' : '撤回失败，请重试' })
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
          for (const row of rows) {
            const result = await recall(row)
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
            React.createElement('span', null, rows.length + ' 条已发送插话，模型尚未读取'),
            React.createElement('span', { className: 'recall-spacer' }),
            rows.length > 1 ? React.createElement('button', {
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
            rows.map((row) => React.createElement('li', { key: row.id, className: 'recall-row' },
              React.createElement('span', { className: 'recall-preview', title: row.preview !== undefined ? row.preview : previewOfContent(row.content) },
                row.preview !== undefined ? row.preview : previewOfContent(row.content)),
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
