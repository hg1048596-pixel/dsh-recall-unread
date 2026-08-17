/*
 * dsh-recall-unread — Host half（静态 web profile 版）
 *
 * 通过 Amadeus 提供的 Host 服务 amadeus-skins.register() 把「撤回插件」
 * 注册进 Amadeus 🧩 插件启动器菜单（启动/停止由菜单按钮触发）。
 * 菜单点击「启动/停止」→ amadeus 调用本插件的 onStart/onStop 并翻转 active；
 * Client 端轮询 amadeus /amadeus/rpc?m=getStatus 读取 active 来启停条带。
 */
export const inject = ['timer']

export function apply(ctx) {
  let registered = false

  const register = () => {
    if (registered) return
    const skins = ctx.get('amadeus-skins')
    if (skins === undefined || typeof skins.register !== 'function') return
    registered = true
    ctx.effect(() => skins.register({
      id: 'recall-unread',
      name: '撤回插件',
      desc: '启动/停止「已发送未读取消息」撤回条带',
      active: true,
      onStart: () => {
        console.log('[dsh-recall-unread] 已通过插件启动器启动')
      },
      onStop: () => {
        console.log('[dsh-recall-unread] 已通过插件启动器停止')
      },
    }))
  }

  register()
  if (!registered) {
    // amadeus 尚未提供服务时，每秒重试（最多 30 秒），避免与 amadeus 的加载顺序竞争
    const timer = ctx.get('timer')
    if (timer === undefined) return
    let tries = 0
    const stop = timer.interval(() => {
      tries += 1
      register()
      if (registered || tries >= 30) stop()
    }, 1000)
  }
}
