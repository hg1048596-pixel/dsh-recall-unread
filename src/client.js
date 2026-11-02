/*
 * dsh-recall-unread —— Client 半端
 *
 * 用法：在 DeepSeek Harness 的 Cordis 插件开发流程中（cordis_define），
 * 把本文件内容整体作为 code.client 传入。该函数体返回一个 Cordis Plugin。
 *
 * 职责：在 conversation.input.dock 插槽注册一条「未读消息」条带，列出所有仍处于
 * pending（模型尚未读取）的插话消息，每条提供「撤回」按钮。撤回优先调用
 * 官方会话 RPC；旧运行时没有 sessions 服务时才使用包内私有 RPC。
 *
 * 数据源（兼容两代运行时）：
 *   - DSH 0.2.x：useProjection('inbox')['next-step'] 中 source.kind === 'user' 的行
 *     （SessionSnapshot.queue 已被官方移除）。
 *   - DSH 0.1.x：会话快照 session.queue 中 placement === 'steering' 的行。
 */
return {
  inject: ['slots', 'timer'],
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
      // props.useProjection 只在 0.2.x 出现；对同一组件实例恒定，可安全按运行时分支调用。
      const hasProjection = typeof props.useProjection === 'function'
      const inbox = hasProjection ? props.useProjection('inbox') : undefined
      const session = typeof props.useSession === 'function' ? props.useSession((value) => value) : props.session
      const canUpdate = typeof props.useAccess === 'function' ? props.useAccess('session/updateQueue') : true
      let rows
      if (hasProjection) {
        // 投影未就绪时也不能回退到旧快照，否则会显示已被读取的陈旧消息。
        const nextStep = inbox && Array.isArray(inbox['next-step']) ? inbox['next-step'] : []
        rows = nextStep.filter((row) => row && typeof row.id === 'string' && row.source && row.source.kind === 'user')
      } else {
        const legacyQueue = session && Array.isArray(session.queue) ? session.queue : []
        rows = legacyQueue.filter((row) => row && typeof row.id === 'string' && row.placement === 'steering')
      }

      const [busy, setBusy] = React.useState(null)
      const busyRef = React.useRef(false)
      const [status, setStatus] = React.useState(null)
      const sessionId = props.sessionId
      // RC 系列的只读 subagent 会话与官方 QueueDock 一样不提供修改操作。
      const subagent = session && session.subagent
      const queueMutable = canUpdate && (!subagent || (subagent.address && subagent.address.mode === 'continuable'))

      React.useEffect(() => {
        if (status === null) return
        return ctx.timeout(() => setStatus(null), 2500)
      }, [status])

      if ((rows.length === 0 && status === null) || sessionId === undefined) return null

      // 0.1.x 的 code 是 queue-item-not-found，0.2.x 带命名空间前缀
      const alreadySending = (code) => code === 'already-claimed' || code === 'queue-item-not-found' || code === 'session/queue-item-not-found' || code === 'session/steer-unavailable'
      const accepted = (result) => result && result.ok === true && (!result.value || result.value.accepted !== false)

      const recall = async (row) => {
        const sessions = ctx.get('sessions')
        // RC 系列走官方路径，保留权限检查和附件清理；仅旧运行时回退私有 RPC。
        if (sessions === undefined) {
          if (hasProjection) throw new Error('sessions service unavailable')
          return host.call('recall', { sessionId, itemId: row.id })
        }
        const binding = sessions.binding(sessionId)
        if (binding === undefined) throw new Error('session binding unavailable')
        return binding.session.updateQueue(row.id, { kind: 'remove' })
      }

      const doRecall = async (row) => {
        if (busyRef.current || !queueMutable) return
        busyRef.current = true
        setBusy(row.id)
        try {
          const result = await recall(row)
          if (accepted(result)) {
            setStatus({ kind: 'info', text: '已撤回一条消息' })
          } else {
            const code = result && (result.code || (result.error && result.error.code))
            setStatus({ kind: 'error', text: alreadySending(code) ? '该消息已开始发送，无法撤回' : '撤回失败，请重试' })
          }
        } catch (error) {
          setStatus({ kind: 'error', text: '撤回失败，请重试' })
          console.error('[dsh-recall-unread] recall failed', error)
        } finally {
          busyRef.current = false
          setBusy((current) => (current === row.id ? null : current))
        }
      }

      const doRecallAll = async () => {
        if (busyRef.current || !queueMutable) return
        busyRef.current = true
        setBusy('__all__')
        let failed = 0
        let succeeded = 0
        try {
          for (const row of rows) {
            // 某条被模型抢先读取，不影响继续撤回其余仍未读的消息。
            try {
              const result = await recall(row)
              if (accepted(result)) succeeded += 1
              else failed += 1
            } catch (error) {
              failed += 1
              console.error('[dsh-recall-unread] recall-all failed', error)
            }
          }
          setStatus(failed === 0
            ? { kind: 'info', text: '已撤回全部未读消息' }
            : { kind: 'error', text: '已撤回 ' + succeeded + ' 条，另有 ' + failed + ' 条撤回失败，可能已开始发送' })
        } finally {
          busyRef.current = false
          setBusy(null)
        }
      }

      return React.createElement('div', { className: 'recall-dock', 'data-recall-dock': '' },
        React.createElement('div', { className: 'recall-panel' },
          React.createElement('div', { className: 'recall-head' },
            React.createElement('b', null, '未读消息'),
            rows.length > 0 ? React.createElement('span', null, rows.length + ' 条已发送插话，模型尚未读取') : null,
            React.createElement('span', { className: 'recall-spacer' }),
            rows.length > 1 && queueMutable ? React.createElement('button', {
              type: 'button',
              className: 'recall-btn recall-btn-ghost',
              disabled: busy !== null,
              onClick: doRecallAll
            }, '全部撤回') : null
          ),
          status !== null ? React.createElement('div', {
            role: status.kind === 'error' ? 'alert' : 'status',
            className: status.kind === 'error' ? 'recall-status recall-status-error' : 'recall-status'
          }, status.text) : null,
          React.createElement('ul', { className: 'recall-list' },
            rows.map((row) => React.createElement('li', { key: row.id, className: 'recall-row' },
              React.createElement('span', { className: 'recall-preview', title: row.preview !== undefined ? row.preview : previewOfContent(row.content) },
                row.preview !== undefined ? row.preview : previewOfContent(row.content)),
              queueMutable ? React.createElement('button', {
                type: 'button',
                className: 'recall-btn',
                disabled: busy !== null,
                onClick: () => doRecall(row)
              }, busy === row.id ? '撤回中…' : '撤回') : null
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
