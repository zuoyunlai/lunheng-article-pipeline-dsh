// g-audit-check G2 数据溯源回归网（v18.62.4 新增 · 全量审计-v18.62.3 §8.2 #16）
//
// **病灶**：G2 用**裸子串**比对正文定量数字与素材卡（`cardNorm.includes(digits)`）——
//   正文「占比 5%」会被卡里**任意一个 5** 满足（`2015` 年 / `[D05]` 编号 / `5000`），
//   于是 1–2 位数字的定量声明**永远不会进候选清单**，而那正是 T7 最该逐条定性的一类。
// 判据：**同一事实的两半必须一起匹配** —— 值 + 单位（`5%` ≠ `5`）且**带数字边界**（`5` 不命中 `2015`）。
//
// 本文件双向钉住：卡里**没有**该数据时必须报出候选；卡里**有**该数据时不得误报。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, tmp } from './_fixtures.mjs'

const G = join(SCRIPTS, 'g-audit-check.mjs')

/** 造夹具：给定正文与素材卡文本，跑 G2 并返回其检查项。 */
function g2Of({ body, card }) {
  const d = tmp('g2-')
  mkdirSync(join(d, 'cards'), { recursive: true })
  const draft = join(d, '正文.md')
  writeFileSync(draft, ['# 正文', '', '## 一、结果', '', body, '', '## 参考文献', '', '[L01] 甲', ''].join('\n'))
  writeFileSync(join(d, 'cards', '数据卡.md'), card)
  const rep = join(d, 'r.json')
  try { execFileSync(process.execPath, [G, draft, '--cards', join(d, 'cards'), '--report', rep], { encoding: 'utf8' }) }
  catch { /* exit 非 0 是正常的（有候选 → 3） */ }
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  const it = Object.entries(j.checks || {}).find(([k]) => /G2/.test(k))
  rmSync(d, { recursive: true, force: true })
  return it ? it[1] : null
}

const CARD_WITH_YEAR_AND_ID = [
  '# 数据卡', '',
  '## 📇 索引段', '',
  '| 编号 | 主题 | 支撑论点 |', '|---|---|---|', '| [D05] | 某条目 | 论点1 |', '',
  '## [D05] 某条目', '',
  '- **信任级别**：已发布',
  '- 数据年份：2015',
  '- 抽样规模：5000 人', '',
].join('\n')

test('#16：卡里只有 `2015` / `[D05]` / `5000` 时，正文的 `5%` 与 `18%` **必须**进候选（旧裸子串会漏）', () => {
  const g2 = g2Of({ body: '平台抽成占比 5%，较上年上升 18%。', card: CARD_WITH_YEAR_AND_ID })
  assert.ok(g2, 'G2 必须在场')
  const tokens = (g2.evidence.candidates || []).map((c) => c.token)
  assert.ok(
    tokens.includes('5%'),
    '`5%` 不得被卡里的 `2015`/`[D05]`/`5000` 里的那个 `5` 满足（裸子串比对会漏掉它）：' + JSON.stringify(g2.evidence),
  )
  assert.ok(tokens.includes('18%'), '`18%` 同样必须进候选：' + JSON.stringify(tokens))
  assert.equal(g2.severity, 'P2', '候选类一律 P2（判级归 T7）')
})

test('#16 真阳性侧：卡里**确实有** `5%` → 不得误报（收紧后仍要认得出真实命中）', () => {
  const card = CARD_WITH_YEAR_AND_ID + '- 平台抽成占比：5%\n'
  const g2 = g2Of({ body: '平台抽成占比 5%。', card })
  const tokens = (g2.evidence.candidates || []).map((c) => c.token)
  assert.ok(!tokens.includes('5%'), '卡里有 `5%` 时不得报为未命中：' + JSON.stringify(g2.evidence))
})

test('#16 边界：值相同但**单位不同**不得当作命中（`5` 人 ≠ `5%`）', () => {
  const card = CARD_WITH_YEAR_AND_ID + '- 样本量：5 人\n'
  const g2 = g2Of({ body: '平台抽成占比 5%。', card })
  const tokens = (g2.evidence.candidates || []).map((c) => c.token)
  assert.ok(
    tokens.includes('5%'),
    '卡里只有 `5 人` 时，正文的 `5%` 仍属**未命中**（同一事实的两半须一起匹配）：' + JSON.stringify(g2.evidence),
  )
})
