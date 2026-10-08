#!/usr/bin/env node
// 沿革外移的机械验收器（v18.80.4 · 审计优化方向 6 专批；v2 口径）
//
// ── 为什么需要 ────────────────────────────────────────────────────────────────────────────────
//   「沿革外移」最贵的失效形态是**顺手把判据一起搬走/删掉**——文档照样自洽、门照样绿，直到某天门
//   失效才被发现（本仓吃过同类：瘦身删掉规格句，而 `consistency-check` 只抓字符串级漂移）。
//   故把这件事的验收做成**可复算的三条**：
//     **R1 判据不丢**：原文件的**每一行**，必须在「新文件」**或**「外移档」里逐字找到（外移 = 搬运，不是删除）；
//     **R2 标题不动**：所有标题行（`#{1,6}` 与显式 `<a id>` 锚）必须仍在**新文件**里——规则 ㉗ 的锚点由标题派生，标题一搬就断链；
//     **R3 复核清单**：被搬走的行里，凡**不像沿革**（无版本/沿革标记，或含判据关键词）的，逐条列出来供人工复核
//       ——**不判失败**，因为口径是启发式（实测反例：本次搬走的「修订 14 项清单」含 `P0/P1` 与门编号，会被误判成判据）。
//
// ── 边界（如实，不许读成「已证明搬对了」）────────────────────────────────────────────────────
//   · R1/R2 是**硬判据**；R3 是**可见性**（人/模型必须逐条看，机器判不了语义）。
//   · 只做**行级逐字**核对（忽略首尾空白），不做段序/格式校验。
//   · 结构性分隔行（空行 / `>` / `---` / 纯符号行）不算承载判据，允许消失（若被搬走也不计数）。
//
// 用法：
//   node scripts/history-externalize-check.mjs --before <原文件> --after <新文件> [--moved <外移档>] [--json]
// 退出码：0 = R1/R2 通过｜1 = R1 或 R2 失败｜10 = 参数/路径错｜70 = 内部错误
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
let before = null, after = null, moved = null, json = false
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--before') before = argv[++i]
  else if (argv[i] === '--after') after = argv[++i]
  else if (argv[i] === '--moved') moved = argv[++i]
  else if (argv[i] === '--json') json = true
  else { console.error(`未知参数：${argv[i]}`); process.exit(10) }
}
if (!before || !after) { console.error('用法：node scripts/history-externalize-check.mjs --before <原文件> --after <新文件> [--moved <外移档>] [--json]'); process.exit(10) }
for (const p of [before, after, moved].filter(Boolean)) if (!existsSync(p)) { console.error(`路径不存在：${p}`); process.exit(10) }

/** 沿革标记 / 判据关键词（口径真源 = 本器，与 `audits/沿革外移-*.md` 各档说明一致）。 */
const HIST = /（v\d|\(v\d|v\d+\.\d+\.\d+|旧版|此前|历史|沿革|实测|教训|曾|更正|回滚|复现|病灶|成因|已外移|外移/
const JUDGE = /必须|不得|判据|阈值|严重度|字段|正则|exit|证据|边界|强制|红线|该门|本门|主控|等级/
const HEADING = /^(#{1,6}\s|<a\s+id=)/
const SEP = /^[>\-*_|\s]*$/
const isTrivial = (s) => s.trim().length < 12 || SEP.test(s)
const norm = (text) => new Set(String(text).split('\n').map((l) => l.trim()).filter(Boolean))

try {
  const beforeText = readFileSync(before, 'utf8')
  const afterText = readFileSync(after, 'utf8')
  const movedText = moved ? readFileSync(moved, 'utf8') : ''
  const beforeSet = norm(beforeText)
  const afterSet = norm(afterText)
  const movedSet = norm(movedText)

  // R1：原文件每行必须在 after ∪ moved
  const lost = [...beforeSet].filter((l) => !afterSet.has(l) && !movedSet.has(l))
  // R2：标题/锚点行必须仍在 after
  const headingMoved = [...beforeSet].filter((l) => HEADING.test(l) && !afterSet.has(l))
  // R3：被搬走的行里「不像沿革」的（可见性清单，不判失败）
  const movedLines = [...beforeSet].filter((l) => !afterSet.has(l) && !isTrivial(l))
  const needsReview = movedLines.filter((l) => !(HIST.test(l) && !JUDGE.test(l)))

  const out = {
    before: resolve(before), after: resolve(after), moved: moved ? resolve(moved) : null,
    beforeBytes: Buffer.byteLength(beforeText), afterBytes: Buffer.byteLength(afterText),
    deltaBytes: Buffer.byteLength(afterText) - Buffer.byteLength(beforeText),
    beforeLines: beforeSet.size, afterLines: afterSet.size,
    movedLines: movedLines.length, needsReviewLines: needsReview.length, lostLines: lost.length, headingMovedLines: headingMoved.length,
    verdict: (lost.length === 0 && headingMoved.length === 0) ? 'pass' : 'fail',
  }
  if (json) console.log(JSON.stringify({ ...out, lost: lost.slice(0, 20), headingMoved: headingMoved.slice(0, 20), needsReview: needsReview.slice(0, 30) }, null, 2))
  else {
    console.log(`沿革外移机械验收（v2 口径）：${out.verdict === 'pass' ? '✓ R1 判据不丢 + R2 标题不动 通过' : '✗ 有硬违规'}`)
    console.log(`  字节 ${out.beforeBytes} → ${out.afterBytes}（Δ ${out.deltaBytes}）｜行 ${out.beforeLines} → ${out.afterLines}｜搬走 ${out.movedLines} 行`)
    if (lost.length) {
      console.log(`\n✗ **R1 失败：${lost.length} 行在原文件里有、在「新文件 ∪ 外移档」里都找不到**（= 真丢了）：`)
      for (const l of lost.slice(0, 20)) console.log(`  - ${l.slice(0, 150)}`)
    }
    if (headingMoved.length) {
      console.log(`\n✗ **R2 失败：${headingMoved.length} 个标题/锚点行被搬走或改动**（规则 ㉗ 会断链）：`)
      for (const l of headingMoved.slice(0, 20)) console.log(`  - ${l.slice(0, 150)}`)
    }
    if (!lost.length && !headingMoved.length) {
      console.log('\n✓ R3 人工复核清单（口径为启发式，机器不判语义；下列行已搬走但"不像沿革"，必须逐条看过）：')
      if (!needsReview.length) console.log('  （无——搬走的每一行都带沿革标记且不含判据关键词）')
      for (const l of needsReview.slice(0, 30)) console.log(`  ? ${l.slice(0, 150)}`)
    }
  }
  process.exit(out.verdict === 'pass' ? 0 : 1)
} catch (e) {
  console.error(`内部错误：${e.message}`)
  process.exit(70)
}
