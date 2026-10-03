// ⑧d 脚本**自述**退出码 ↔ 自身契约行（F-5 机械化 · v18.18.12）
//   动机：随包脚本头部会自述返回码（`// 返回码：0 = …；4 = …`），这是退出码的**第三处**登记
//   ——`EXIT_CONTRACT`（机器面，⑧ 管）与 `troubleshooting.md §8`（人读面，⑧b 管）之外的
//   **脚本自带面**，此前没有任何门看它。实测教训（本次审计 F-5 执行中发现）：
//   `model-routing.mjs:20` 自述「`1 = 读不到配置`」，而该脚本 `process.exit(1)` 个数为 **0**、
//   契约行是 `[0,4,10,70]`——那个 `1` 是 v18.12.0 收口前的遗留声明。调用方按自述去接 `1`
//   永远等不到；维护者按自述去改会以为 `1` 还被占着。此即 F-5 一类「文案与行为脱节」的形态，
//   故机械化成门（而不是再补一条只看字面的文本断言——那样连这次这个错都抓不到）。
//   不变量（**单向**）：脚本自述的码 ⊆ 自身契约行。反方向**刻意不报**（`0`/`70` 对每个装了
//   guard 的脚本都可用、自述常只写语义码而省略它们，实测 apply-diff / apply-revision-cycle
//   两处属此情形）——详见 `_lib/exit-namespace.mjs` 的偏差说明。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { reconcileScriptHeaders } from '../exit-namespace.mjs' // C-11：§8 配额 ↔ EXIT_CONTRACT 双向对账；v18.18.12 加 ⑧d 脚本自述码对账

export function run(ctx) {
  const { fail, note, ROOT, EXIT_CONTRACT, scriptDir } = ctx
  try {
    const entries = []
    for (const name of Object.keys(EXIT_CONTRACT)) {
      const p = join(scriptDir, name)
      if (existsSync(p)) entries.push({ name, allowed: EXIT_CONTRACT[name], text: readFileSync(p, 'utf8') })
    }
    const { checked, violations } = reconcileScriptHeaders(entries)
    for (const v of violations) {
      fail('exit-code', `${v.name}:${v.line} 头部自述的退出码 ${v.extra.join(', ')} **不在**自身契约行（${v.allowed.join('/')}）内——脚本承诺了它产不出的码，请改注释或改契约（两处必须同一次提交一起改）`)
    }
    // 只有**零违例**时才打这条「一致」的 note：本门自己犯过「一边 fail 一边打 ✓ 一致」的毛病
    //   （v18.18.12 反向自证时现场抓到），那会让读报告的人以为该项通过了。
    if (!violations.length) {
      note(`⑧d 脚本自述退出码：${checked} 个脚本的头部「退出码/返回码」段 ↔ EXIT_CONTRACT **单向**一致（自述码均 ⊆ 自身契约行）`)
    }
  } catch (e) {
    fail('exit-code', `⑧d 脚本自述退出码对账无法执行：${e.message}`)
  }
}
