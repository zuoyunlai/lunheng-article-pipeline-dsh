// v18.12.0（2026-09-25 全量审计 L-17）：**文末九节**（必需五节 + 学术四声明）不得被判 P0。
//
// 教训（审计实测）：v18.10.0 起 `05-写作-writer.md` 与 `交付说明-template.md` 已要求写手写「文末九节」
//   （CRediT / COI / 数据可用性 / 伦理审批 四声明排在 AI 使用声明前），而机检白名单仍是五节 →
//   按规范写 → M-Form-7 判「违规节: CRediT 声明,COI 声明,数据可用性声明,伦理审批声明」**P0、exit=2**；
//   而 M-Form-7 又属「不可 LLM 兜底的红线」→ 学术论文**无出口**。
// 修法（两层，避免「一切稿件都被要求写四声明」这个反向错误）：
//   · 必需五节（ENDNOTE_SECTIONS）→ 仍是 M-Form-2 的存在性判据；
//   · 九节合规顺序（ENDNOTE_ORDER）→ M-Form-7 的成员资格与顺序判据（四声明可选、但在位时顺序固定）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const { ENDNOTE_SECTIONS, ENDNOTE_SECTIONS_OPTIONAL, ENDNOTE_ORDER } = await import(
  pathToFileURL(join(SCRIPTS, '_lib', 'sections.mjs')).href
)

const DECLS = [
  '## CRediT 作者贡献声明\n\n- 角色：全部 / 14\n',
  '## COI 利益冲突声明\n\n- 总声明：不存在\n',
  '## 数据可用性声明\n\n- 档位：可索取\n',
  '## 伦理审批声明\n\n- 档位：不适用\n',
]

/** 造一份「可被 M 门解析」的最小项目：draft + 证据包（数据卡/文献卡） */
const mkFixture = (dir, sections) => {
  const ev = join(dir, 'final', '证据包')
  mkdirSync(ev, { recursive: true })
  const draft = join(dir, 'final', '定稿.md')
  writeFileSync(draft, [
    '# 题名', '',
    '## 摘要', '', `摘要正文 [L01] [D01]。`, '',
    '## 一、导论', '', `正文论述 [L01] [D01] [C01]。`, '',
    ...sections,
  ].join('\n'))
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n```\n[D01] 数值 ｜ 主题 ｜ 论点1\n```\n\n[D01] 数值 | 机构 | 2024 | url\n      ├ 信任级别：已发布\n      └ 口径说明\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n```\n[L01] 综述 ｜ 论点1\n```\n\n[L01] 作者. 题名[J]. 刊, 2024.\n      ├ 信任级别：已发布\n      └ 时效评级：🟢\n')
  return draft
}

const REQUIRED_5 = [
  '## 参考文献\n\n- [L01] 作者. 题名[J]. 刊, 2024.\n',
  '## 数据来源\n\n- [D01] 机构 2024\n',
  '## 案例来源\n\n- [C01] 案例\n',
  '## 先行者文献\n\n- [先01] 甲. 题名[M]. 2023.（完整著录详见参考文献 [L01]）\n',
  '## AI 使用声明\n\n- 工具：论衡\n',
]
/** 九节 = 前四必需 → 四声明 → AI 使用声明（与 ENDNOTE_ORDER 同序） */
const NINE = [REQUIRED_5[0], REQUIRED_5[1], REQUIRED_5[2], REQUIRED_5[3], ...DECLS, REQUIRED_5[4]]

const gateOf = (r, prefix) => parseJson(r).results.find((x) => x.gate.startsWith(prefix))

test('sections：九节口径自洽（必需五节 ⊂ 九节顺序，四声明在 AI 使用声明之前）', () => {
  assert.equal(ENDNOTE_ORDER.length, 9)
  assert.equal(ENDNOTE_SECTIONS_OPTIONAL.length, 4)
  const idx = (m) => ENDNOTE_ORDER.findIndex((w) => w === m)
  for (const s of ENDNOTE_SECTIONS) assert.ok(idx(s) !== -1, `必需节 ${s} 必须在九节顺序内`)
  for (const s of ENDNOTE_SECTIONS_OPTIONAL) {
    assert.ok(idx(s) > idx('先行者文献') && idx(s) < idx('AI 使用声明'), `${s} 必须排在先行者文献与 AI 使用声明之间`)
  }
  const requiredIdx = ENDNOTE_SECTIONS.map(idx)
  assert.deepEqual(requiredIdx, [...requiredIdx].sort((a, b) => a - b), '必需五节的相对顺序不得被九节口径打乱')
})

test('m-gate-check：文末**九节**（含四声明）→ M-Form-2 与 M-Form-7 都必须通过（L-17 主回归）', () => {
  const dir = tmp('lunheng-nine-')
  try {
    const draft = mkFixture(dir, NINE)
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, join(dir, 'final', '证据包')])
    const m2 = gateOf(r, 'M-Form-2')
    const m7 = gateOf(r, 'M-Form-7')
    assert.equal(m2.pass, true, '必需五节齐全 → M-Form-2 应通过：' + JSON.stringify(m2))
    assert.equal(m7.pass, true, '九节且顺序正确 → M-Form-7 应通过（旧版在此判 P0）：' + JSON.stringify(m7))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('m-gate-check：仍只写必需五节 → 也通过（非学术稿不得被强制要求四声明）', () => {
  const dir = tmp('lunheng-five-')
  try {
    const draft = mkFixture(dir, REQUIRED_5)
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, join(dir, 'final', '证据包')])
    assert.equal(gateOf(r, 'M-Form-2').pass, true)
    assert.equal(gateOf(r, 'M-Form-7').pass, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('m-gate-check：四声明**错序**（排到 AI 使用声明之后）→ M-Form-7 仍必须报（顺序断言不得被放宽）', () => {
  const dir = tmp('lunheng-badorder-')
  try {
    const bad = [REQUIRED_5[0], REQUIRED_5[1], REQUIRED_5[2], REQUIRED_5[3], REQUIRED_5[4], ...DECLS]
    const draft = mkFixture(dir, bad)
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, join(dir, 'final', '证据包')])
    const m7 = gateOf(r, 'M-Form-7')
    assert.equal(m7.pass, false, '错序必须报：' + JSON.stringify(m7))
    assert.match(String(m7.detail), /顺序违规/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('m-gate-check：白名单外的文末节（操作员报告类）仍必须判 P0（不得因扩面而放行）', () => {
  const dir = tmp('lunheng-notwhite-')
  try {
    const draft = mkFixture(dir, [...REQUIRED_5, '## 合规报告\n\n- 泄漏内容\n'])
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, join(dir, 'final', '证据包')])
    const m7 = gateOf(r, 'M-Form-7')
    assert.equal(m7.pass, false, '非白名单节必须报：' + JSON.stringify(m7))
    assert.equal(m7.severity, 'P0')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
