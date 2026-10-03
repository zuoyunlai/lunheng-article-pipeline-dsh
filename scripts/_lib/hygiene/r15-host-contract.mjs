// ⑮ 宿主契约门（v18.62.1 全量审计 P2-2）
//   真教训：v18.61.0 把 H2 监听器写成 4 参 `(tool, args, result, next)`，而宿主 `tools/post-execute` 是
//   3 参 waterfall——入参错位后真实宿主**每次工具调用**抛 `next is not a function`、被静默改写成 isError，
//   却因「自建桩测试照着实现写」而 600 用例全绿。H4 同族（2 参且不调 next() → 截断下游模型选择）。
//   本门静态解析 lib/index.js 的 `ctx.on(...)`，对每条断言「事件名存在于宿主契约表 + 形参个数逐位一致」。
//   契约表真源与更新口径见 `_lib/host-contract.mjs` 头注释（宿主 0.2.0-rc.2 三个派发点）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { reconcileHostContract } from '../host-contract.mjs' // ⑮：lib/index.js 监听器签名 + 事件名 vs 宿主 waterfall 契约

export function run(ctx) {
  const { fail, note, ROOT } = ctx
  try {
    const libIndexSrc = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
    const { regs, errors } = reconcileHostContract(libIndexSrc)
    for (const e of errors) fail('host-contract', `⑮ 宿主契约：${e}`)
    if (!errors.length) {
      note(`⑮ 宿主契约：${regs.length} 个 ctx.on 监听器（${regs.map((r) => r.event).join(' / ')}）签名与宿主 waterfall 契约逐位一致`)
    }
  } catch (e) {
    fail('host-contract', `⑮ 宿主契约对账无法执行：${e.message}`)
  }
}
