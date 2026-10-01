// cite-coverage-check 回归网（v18.62.4 新增 · 全量审计-v18.62.3 §8.2 #22/#23）
//
// #23：本脚本**自建标题正则**（`/^(#{2,4})\s+(.+)$/gm`）扫全文、未过 `maskFences` →
//      围栏代码块里的 `### 示例` 被当作真段落；若该示例句引了 ≥4 条 `[Lxx]` 且无差异关键词，
//      就在**正确内容**上产生假 P2 → 把整门推到 exit 3。
// #22：年份抽取直接在参考文献全文跑 `/(?:19|20)(\d{2})/g` → **页码区间**（`2015-2030`）、
//      卷期（`12(3)`）、DOI 里的四位数字被当成出版年 → 年份分布失真。
//      连带暴露：样本不足（`totalYears ≤ 5`）时旧式给出 `pass:false` + `severity:'PASS'`
//      —— 同一记录自相矛盾；现记 **SKIP**（未检，不计入 pass）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, tmp } from './_fixtures.mjs'

const C = join(SCRIPTS, 'cite-coverage-check.mjs')

/** 造正文骨架（可注入一个中间节），参考文献固定含页码区间与卷期。 */
function mkDoc(middle = '## 二、方法\n\n正文。') {
  const d = tmp('cc-')
  const body = [
    '# 标题', '', '## 摘要', '', '摘要句 [L01][L02]。', '',
    '## 一、引言', '', '引言引用了若干文献 [L01][L02]，并说明了差异。', '',
    middle, '',
    '## 参考文献', '',
    '[L01] 张三. 研究一. 某刊, 2018, 12(3): 2015-2030.', '',
    '[L02] 李四. 研究二. 某刊, 2024, 5(1): 12-30.', '',
    '[L03] 王五. 研究三. 某刊, 1995, 2(2): 5-9.', '',
    '[L04] 赵六. 研究四. 某刊, 2025, 8(4): 100-120.', '',
    '## 数据来源', '', '无。', '', '## 案例来源', '', '无。', '',
    '## 先行者文献', '', '无。', '', '## AI 使用声明', '', 'AI。', '',
  ].join('\n')
  const p = join(d, '定稿.md')
  writeFileSync(p, body)
  const rep = join(d, 'r.json')
  let code = 0
  try { execFileSync(process.execPath, [C, p, '--report', rep], { encoding: 'utf8' }) }
  catch (e) { code = e.status ?? -1 }
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  rmSync(d, { recursive: true, force: true })
  return { code, j }
}

test('#23：**围栏内**的示例句引了 5 条 [Lxx] → 不得计入 C-Redundancy（旧版自建正则不过 `maskFences`）', () => {
  const fenced = ['## 二、方法', '', '正文。', '', '```markdown', '### 示例：一段引了多篇的写法', '', '该段引用了 [L01][L02][L03][L04][L05] 五篇文献。', '```'].join('\n')
  const { j } = mkDoc(fenced)
  const red = j.checks['C-Redundancy']
  assert.equal(red.pass, true, '围栏内的示例句不得触发冗余判定：' + JSON.stringify(red.violations))
  assert.deepEqual(red.violations, [], '不得有 violations：' + JSON.stringify(red.violations))
})

test('#23 真阳性侧：**正文里**同句引 5 条 [Lxx] 且无差异词 → 仍须报出（收紧后不得漏）', () => {
  const mid = ['## 二、方法', '', '多项研究支持该结论 [L01][L02][L03][L04][L05]。'].join('\n')
  const { j } = mkDoc(mid)
  const red = j.checks['C-Redundancy']
  assert.equal(red.pass, false, '正文里的同句多引必须报')
  assert.ok(red.violations.length >= 1, '须给出 violations：' + JSON.stringify(red))
  assert.match(red.violations[0].sentence, /多项研究支持该结论/, 'violations 须带原句供 T7 判读')
})

test('#22：页码区间 `2015-2030` 与卷期 `12(3)` **不得**被当成出版年（分布只数真实年）', () => {
  const { j } = mkDoc()
  const dist = j.checks['C-Distribution'].distribution
  // 真实出版年 = 2018 / 2024 / 1995 / 2025（各 1 条）→ 合计 4 年
  const total = dist.recent3Years.count + dist.midYears.count + dist.oldYears.count
  assert.equal(
    total, 4,
    '年份样本数应为 4（= 4 条文献各一个出版年）；若把页码 2015-2030 或卷期当年份，此数会偏大：'
      + JSON.stringify(dist),
  )
})

test('#22 自洽侧：样本不足（≤5 年）时不得出现 `pass:false` + `severity:PASS`（应记 SKIP）', () => {
  const { j } = mkDoc()
  const d = j.checks['C-Distribution']
  if (d.severity === 'PASS') {
    assert.equal(d.pass, true, 'severity 为 PASS 时 pass 必须为 true（否则同一记录自相矛盾）')
  } else {
    assert.equal(d.severity, 'SKIP', '样本不足应记 SKIP：' + JSON.stringify(d))
    assert.equal(d.pass, 'SKIP', 'SKIP 时 pass 亦为 SKIP（不得写成 true）')
  }
})
