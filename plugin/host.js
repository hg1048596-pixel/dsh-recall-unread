/*
 * dsh-recall-unread — Host half（静态 web profile 版）
 *
 * 不再依赖 Amadeus 启动器：撤回条带由插件市场（dsh-market）或插件管理页的
 * 「启用 / 停用」开关控制（禁用 = 不加载；启用 = 加载并显示条带）。
 * 撤回动作由客户端直接调用官方会话 RPC session.updateQueue 完成，
 * Host 半端保留为空实现（loader 需要可导入的插件入口）。
 */
export const inject = []

export function apply() {
  // 无 Host 逻辑
}
