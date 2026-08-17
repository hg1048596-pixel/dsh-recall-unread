/*
 * dsh-recall-unread — Host half（占位）
 *
 * 撤回逻辑完全在 Client 端通过官方会话 RPC（session.updateQueue 的 remove）
 * 完成，Host 半端不需要任何逻辑。这里保留一个空插件，
 * 是为了让 web profile 的 cordis 组合能把这个包作为常规插件条目挂载
 * （与 amadeus-for-dsh、dsh-skin-market 等静态插件同构），
 * 从而让 dsh.client 扫描发现并注入浏览器端 bundle。
 */
export const inject = []
export function apply() {}
