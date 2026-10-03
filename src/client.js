/*
 * dsh-recall-unread —— Client 半端
 *
 * 用法：在 DeepSeek Harness 的 Cordis 插件开发流程中（cordis_define），
 * 把本文件内容整体作为 code.client 传入。该函数体返回一个 Cordis Plugin。
 *
 * 职责：在 conversation.input.dock 插槽注册一条「未读消息」条带，列出所有仍处于
 * pending（模型尚未读取）的插话消息，每条提供「撤回」按钮；撤回通过包内私有 RPC
 * host.call('recall', …) 交给 Host 处理。
 *
 * 数据源（兼容两代运行时）：
 *   - DSH 0.2.x：useProjection('inbox')['next-step'] 中 source.kind === 'user' 的行
 *     （SessionSnapshot.queue 已被官方移除）。
 *   - DSH 0.1.x：会话快照 session.queue 中 placement === 'steering' 的行。
 */
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(`
      .recall-dock{display:flex;justify-content:center;padding:0 var(--dsh-composer-side-clearance) 8px}
      .recall-panel{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:8px 12px}
      .recall-head{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
      .recall-head b{color:var(--dsw-alias-label-primary);font-weight:600}
      .recall-spacer{flex:1}
      .recall-status{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px;margin-top:4px}
      .recall-status-error{color:var(--dsw-alias-state-error-primary)}
      .recall-list{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
      .recall-row{display:flex;align-items:center;gap:10px;min-width:0}
      .recall-preview{flex:1;min-width:0;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .recall-btn{flex:none;border:none;border-radius:8px;padding:2px 10px;font-size:12px;line-height:20px;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
      .recall-btn:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}
      .recall-btn:disabled{opacity:.5;cursor:default}
      .recall-btn-ghost{background:transparent;color:var(--dsw-alias-label-secondary)}
    `)

    // ---- 预览文本（0.2.x 的 inbox 行只有 content 块，没有 preview 字段）----
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

    const RecallDock = (props) => {
      // 0.2.x：inbox 投影里 next-step 的用户插话；0.1.x：session.queue 里 placement === 'steering' 的行
      const inbox = props.useProjection !== undefined ? props.useProjection('inbox') : undefined
      let steering
      if (inbox !== undefined && inbox !== null) {
        const nextStep = Array.isArray(inbox['next-step']) ? inbox['next-step'] : []
        steering = nextStep.filter((row) => row && row.source && row.source.kind === 'user')
      } else {
        const queue = (props.session && props.session.queue) || []
        steering = queue.filter((row) => row.placement === 'steering')
      }
      const [busy, setBusy] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const sessionId = props.sessionId

      React.useEffect(() => {
        if (status === null) return
        return ctx.timeout(() => setStatus(null), 2500)
      }, [status])

      if (steering.length === 0 || sessionId === undefined) return null

      const doRecall = async (row) => {
        if (busy !== null) return
        setBusy(row.id)
        try {
          const result = await host.call('recall', { sessionId, itemId: row.id })
          if (result && result.ok === true) {
            setStatus({ kind: 'info', text: '已撤回一条消息' })
          } else {
            const code = result && result.code
            const alreadySending = code === 'already-claimed' || code === 'queue-item-not-found' || code === 'session/queue-item-not-found' || code === 'session/steer-unavailable'
            setStatus({ kind: 'error', text: alreadySending ? '该消息已开始发送，无法撤回' : '撤回失败，请重试' })
          }
        } catch (error) {
          setStatus({ kind: 'error', text: '撤回失败，请重试' })
          console.error('recall failed', error)
        } finally {
          setBusy((current) => (current === row.id ? null : current))
        }
      }

      const doRecallAll = async () => {
        if (busy !== null) return
        setBusy('__all__')
        try {
          for (const row of steering) {
            const result = await host.call('recall', { sessionId, itemId: row.id })
            if (!(result && result.ok === true)) throw new Error('recall rejected')
          }
          setStatus({ kind: 'info', text: '已撤回全部未读消息' })
        } catch (error) {
          setStatus({ kind: 'error', text: '部分消息撤回失败，可能已开始发送' })
          console.error('recall-all failed', error)
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
  },
}
