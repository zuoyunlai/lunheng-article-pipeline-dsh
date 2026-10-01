// M-Exist-11 反方论证闭合（v18.27.0 QLT-4）回归测试
//
// 锁四条口径：
//   · 表缺失 / 大纲缺失 → `pass: true` + `severity: 'P2'` + 「N/A 且**未检**」（**不得读成通过**，也不判死老项目）
//   · 缺反方/回应锚点 → P1；锚点在**被审正文标题**里找不到 → P1
//   · 表存在但无数据行 → P1（形态上有表、实质为零）
//   · 锚点只认**标题**级定位（不认正文任意句子）——这是「指向存在的段落」与「这句话出现过」的分界
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, mkProject } from './_fixtures.mjs'

const M = join(SCRIPTS, 'm-gate-check.mjs')
const DRAFT = '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、导论\n\n正文 [L01]。\n\n## 五、反驳与回应\n\n反方观点与回应。\n'
  + '\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'

/** 造项目：可选写大纲（内容自定）。返回 `{ proj, fin, ev }`。 */
const mk = (outline) => {
  const { proj, fin, ev } = mkProject({ analysis: true })
  writeFileSync(join(fin, '定稿.md'), DRAFT)
  if (outline !== null) {
    mkdirSync(join(proj, 'analysis'), { recursive: true })
    writeFileSync(join(proj, 'analysis', '分析大纲.md'), outline)
  }
  return { proj, fin, ev }
}
const item = ({ proj, fin, ev }) => {
  const rep = join(proj, 'r.json')
  run([M, join(fin, '定稿.md'), ev, '--report', rep])
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  return (j.results || []).find((r) => /M-Exist-11/.test(r.gate))
}

const TABLE_OK = '## §11 写手版精简段\n\n### 论点—证据—反方\n\n'
  + '| 论点 | 承重证据 | 反方段锚点 | 回应段锚点 |\n|---|---|---|---|\n'
  + '| 机制成立 | [L01] | 五、反驳与回应 | 五、反驳与回应 |\n'

test('M-Exist-11：无分析大纲 → **pass=SKIP + 「N/A 且未检」**（不得读成通过，也不判死老项目）', () => {
  const it = item(mk(null))
  assert.ok(it, 'M-Exist-11 必须在场')
  // v18.62.4（全量审计-v18.62.3 P1-5）：由 `pass: true + severity: 'P2'` 改为 `pass: 'SKIP' + severity: 'SKIP'`。
  //   为什么：旧形态下「未检」只写在 detail 字符串里，**退出码侧完全看不见**（`pass: true` 既不进
  //   `fail` 也不进 `skips`）→ 移走 `analysis/分析大纲.md` 即可让本门静默变成 exit 0。
  //   同仓既有样板 = `mexist-gates.mjs:15`（等价情形用 `pass: 'SKIP'` → exit 3）。判据未变：**不判死老项目**。
  assert.equal(it.pass, 'SKIP', '缺输入不得判失败，但必须记「未检」（SKIP）而非「通过」：' + it.detail)
  assert.equal(it.severity, 'SKIP', '以 SKIP 标记未检（旧版记 P2 会被读成「软提示，可放行」）')
  assert.match(it.detail, /N\/A 且\*\*未检\*\*/)
  assert.match(it.detail, /不得读成通过/)
})

test('M-Exist-11：大纲里没有该表 → 同样 N/A 且未检（SKIP）', () => {
  const it = item(mk('## 一、分析\n\n普通大纲，没有论点表。\n'))
  assert.equal(it.pass, 'SKIP')   // v18.62.4（P1-5）：同上一用例
  assert.equal(it.severity, 'SKIP')
  assert.match(it.detail, /未找到「论点—证据—反方」四列表/)
})

test('M-Exist-11：表齐备且锚点能定位到正文标题 → 通过', () => {
  const it = item(mk(TABLE_OK))
  assert.equal(it.pass, true, '合规表不得报：' + it.detail)
  assert.equal(it.severity, '通过')
  assert.match(it.detail, /核心论点是否收全.*归 T6\/T7/)
})

test('M-Exist-11：缺反方锚点 / 回应锚点 → P1（逐行给行号）', () => {
  const bad = TABLE_OK.replace('| 机制成立 | [L01] | 五、反驳与回应 | 五、反驳与回应 |', '| 机制成立 | [L01] |  | — |')
  const it = item(mk(bad))
  assert.equal(it.pass, false, '缺锚点必须报')
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /缺反方锚点/)
  assert.match(it.detail, /缺回应锚点/)
  assert.ok(it.anchorIssues.length >= 2, '两处都要给出：' + JSON.stringify(it.anchorIssues))
})

test('M-Exist-11：锚点指向**不存在的段落** → P1（这是本项的核心判据）', () => {
  const bad = TABLE_OK.replace('| 机制成立 | [L01] | 五、反驳与回应 | 五、反驳与回应 |', '| 机制成立 | [L01] | 七、从未写过的章节 | §9.9 |')
  const it = item(mk(bad))
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /在被审正文的标题里找不到对应段落/)
  rm0()
})
function rm0() { /* 清理交给进程退出；夹具目录在 tmp 下 */ }

test('M-Exist-11：表存在但无数据行 → P1（形态上有表、实质为零）', () => {
  const empty = '## §11 精简段\n\n| 论点 | 承重证据 | 反方段锚点 | 回应段锚点 |\n|---|---|---|---|\n'
  const it = item(mk(empty))
  assert.equal(it.pass, false, '空表必须报')
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /没有任何数据行/)
})
