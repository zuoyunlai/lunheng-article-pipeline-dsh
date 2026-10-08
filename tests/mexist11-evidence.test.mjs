// M-Exist-11 证据列回归（v18.81.0 · 独立审计批 2 · 2.4d）
//
// **为什么需要**：审计实测「反方论证**零证据编号**」能一路通过——因为 M-Exist-11 此前只校验
//   `反方`/`回应` 两列，**`证据` 列只被用来确认表头存在**（`readArgumentTable` 连它的列下标都没取）。
//   于是「表头有『证据』列、每行该列空着或写着散文」在机检层与合规**同形**。
// 本组用例钉住四态：**有编号 → 过** ／ **空白 → P1** ／ **散文无编号 → P1** ／ **显式声明「无证据」→ 过**。
// 最后一条是刻意的边界：离线/常识性反方确实可能无素材，但那样写是**可见的声明**，不是留白。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const DRAFT = '# 标题\n\n## 摘要\n\n摘要正文 [L01]。\n\n## 一、论证\n\n正文 [L01] [D01] [C01]。\n'
  + '\n## 参考文献\n\n[L01] 甲. 题名[J]. 刊, 2024.\n\n## 数据来源\n\n[D01] 机构 2024\n\n## 案例来源\n\n[C01] 案例\n'
  + '\n## 先行者文献\n\n[先01] 甲. 题名[M]. 2023.\n\n## AI 使用声明\n\nAI。\n'

const outline = (evCell) => [
  '# 分析大纲', '', '## 三、论点—证据—反方—回应', '',
  '| 论点 | 证据 | 反方 | 回应 |', '|---|---|---|---|',
  `| 论点一 | ${evCell} | [先01]的质疑 | 承认一半 |`, '',
].join('\n')

const mk = (evCell) => {
  const d = tmp('lunheng-me11-')
  mkdirSync(join(d, 'final', '证据包'), { recursive: true })
  mkdirSync(join(d, 'analysis'), { recursive: true })
  writeFileSync(join(d, 'final', '定稿.md'), DRAFT)
  writeFileSync(join(d, 'analysis', '分析大纲.md'), outline(evCell))
  return d
}
const runMe11 = (d) => {
  const j = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(d, 'final', '定稿.md'), join(d, 'final', '证据包')]))
  return j.results.find((x) => x.gate.startsWith('M-Exist-11'))
}

test('N1：证据列含素材编号 → 该行不报', () => {
  const d = mk('[L01] [D01]')
  try {
    const it = runMe11(d)
    assert.ok(it, '应能取到 M-Exist-11')
    assert.ok(!/证据列/.test(String(it.detail)), '有编号不得报证据列问题：' + it.detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('N2【核心】：证据列**空白** → P1（反方论证无任何素材为据）', () => {
  const d = mk('—')
  try {
    const it = runMe11(d)
    assert.equal(it.pass, false, '证据列空白必须判失败：' + JSON.stringify(it))
    assert.match(String(it.detail), /证据列空白/, '须点名「空白」而不是笼统失败：' + it.detail)
    assert.equal(it.severity, 'P1', '判级应为 P1（证据底座缺失，不是文风问题）：' + it.severity)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('N3：证据列写散文但**无任何编号** → P1，且提示须显式写「无证据」', () => {
  const d = mk('据业内普遍观察，该路径已被证明失效')
  try {
    const it = runMe11(d)
    assert.equal(it.pass, false, '散文无编号必须判失败：' + JSON.stringify(it))
    assert.match(String(it.detail), /未含任何素材编号/, it.detail)
    assert.match(String(it.detail), /无证据/, '须给出合法出口（显式声明）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('N4【边界】：证据列**显式声明「无证据」** → 不报（声明可见 ≠ 留白）', () => {
  const d = mk('无证据（属业内常识，无对应素材）')
  try {
    const it = runMe11(d)
    assert.ok(!/证据列/.test(String(it.detail)), '显式声明不得被判缺失：' + it.detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
