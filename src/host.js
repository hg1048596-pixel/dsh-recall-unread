/*
 * dsh-recall-unread —— Host 半端
 *
 * 用法：在 DeepSeek Harness 的 Cordis 插件开发流程中（cordis_define），
 * 把本文件内容整体作为 code.host 传入。该函数体返回一个 Cordis Plugin。
 *
 * 职责：接收 Client 发来的「撤回」请求（包内私有 RPC 'recall'），
 * 直接操作 Agent 的 inbox，移除仍未读取（仍处于 pending）的消息。
 * 与官方 session.updateQueue 中 kind: 'remove' 的内部实现一致。
 */
return {
  apply(ctx) {
    harness.handle('recall', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : ''
      const itemId = args && typeof args.itemId === 'string' ? args.itemId : ''
      if (sessionId === '' || itemId === '') {
        return { ok: false, code: 'bad-args', message: 'sessionId and itemId are required' }
      }
      const agents = ctx.get('agents')
      if (agents === undefined) {
        return { ok: false, code: 'unavailable', message: 'agents service unavailable' }
      }
      const agent = agents.get(sessionId)
      if (agent === undefined) {
        return { ok: false, code: 'session-not-found', message: 'session is not attached' }
      }
      const removed = agent.inbox.remove(itemId)
      if (!removed) {
        return { ok: false, code: 'already-claimed', message: 'message is no longer pending (already read)' }
      }
      return { ok: true }
    })
  },
}
