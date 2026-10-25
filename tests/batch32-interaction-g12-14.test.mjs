// v19.27.10（人机交互补充批 G-12 / G-13）：两条新软判据的正反向回归。
//
// 为什么需要：这两条都是「纪律级、无机械消费者」的缺陷——
//   ① G-12：子代理确有「必须主人拍板」的事，此前只能混在「下一步」里，主控扫报告时容易漏传；
//   ② G-13：主人读的是 `进展-主人版.md`，它若早于 status.md，主人看到的就是上一版进展。
// 两条都**只记 soft**（不动硬的六要素 / 四门判据），因此必须钉住「该报时报、不该报时不报」两侧，
// 否则很容易退化成「永远在报」的噪音或「永远不报」的摆饰。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'

const HANDOFF = join(SCRIPTS, 'handoff-check.mjs')

const SIX = [
  '**做了什么**：检索 12 条并落盘文献卡',
  '**产物在哪**：sources/文献卡.md',
  '**怎么验证**：count-chars --summary 已核',
  '**已知问题**：两条来源仅二手',
  '**下一步**：等 T4 分析',
  '**状态机更新**：Phase 1 → ✅ Done',
].join('\n')

test('v19.27.10 B5：提到「需要主人决定」却无固定段 → soft；落了段 → 不报', () => {
  const dir = tmp('batch32-b5-')
  try {
    const keywordOnly = SIX.replace('**下一步**：等 T4 分析', '**下一步**：需要主人决定是否接受二手来源')
    const r1 = run([HANDOFF, '--project', dir, '--role', 'T5', '--report', keywordOnly])
    assert.match(r1.stdout, /B5/, `决策诉求混在正文里必须记 soft B5：\n${r1.stdout.slice(-800)}`)

    const withSection = keywordOnly + '\n## 7. 需要主人决定\n- 是否接受两条二手来源 → 建议接受并标注风险\n'
    const r2 = run([HANDOFF, '--project', dir, '--role', 'T5', '--report', withSection])
    assert.doesNotMatch(r2.stdout, /B5/, `已落到固定段就不该再报 B5：\n${r2.stdout.slice(-800)}`)

    // 完全没有决策诉求的老报告不得因本项多出一条噪音
    const r3 = run([HANDOFF, '--project', dir, '--role', 'T5', '--report', SIX])
    assert.doesNotMatch(r3.stdout, /B5/, `无决策诉求时不得报 B5：\n${r3.stdout.slice(-800)}`)
  } finally { /* tmp 留给系统清理 */ }
})

test('v19.27.10 A15：进展页早于 status.md → soft；刷新后 → 不报', () => {
  const dir = tmp('batch32-a15-')
  mkdirSync(join(dir, 'final'), { recursive: true })
  const status = join(dir, 'status.md')
  const prog = join(dir, '进展-主人版.md')
  writeFileSync(status, '# Status\n\n| 阶段 | 状态 |\n|---|---|\n| 3 写作 | 🔄 Running |\n')
  writeFileSync(prog, '# 进展\n\n现在在 Phase 1（检索）。\n')

  const now = Date.now() / 1000
  utimesSync(prog, now - 3600, now - 3600) // 进展页落后 1 小时
  utimesSync(status, now, now)
  const stale = run([HANDOFF, '--project', dir, '--role', 'T5', '--report', SIX])
  assert.match(stale.stdout, /A15/, `进展页早于 status.md 必须记 soft A15：\n${stale.stdout.slice(-800)}`)

  utimesSync(prog, now + 60, now + 60) // 刷新过
  const fresh = run([HANDOFF, '--project', dir, '--role', 'T5', '--report', SIX])
  assert.doesNotMatch(fresh.stdout, /A15/, `进展页已刷新就不该报 A15：\n${fresh.stdout.slice(-800)}`)
})
