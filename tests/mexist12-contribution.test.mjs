// M-Exist-12 贡献陈述（v19.8.0 · 反哺报告 v9 D3）回归测试
//
// 锁五条口径：
//   · 非学术文类 / 未传 --genre → `pass: 'SKIP'` + 「N/A 且**未检**」（不得读成通过；不拿学术规范打非学术稿件）
//   · 学术文类 + 缺失贡献锚点 → P1（学术编辑第一眼看的就是这个）
//   · 命中锚点但非结构化形态（<2 条列表条目）→ P1（一句话带过不是贡献陈述）
//   · 条目未锚定（无 [n] / § / 见第X节）→ P1（不锚定的贡献是自说自话）
//   · 结构化 + 全锚定 → 通过（「贡献是否成立」归 T7/G16 语义判断）
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, mkProject } from './_fixtures.mjs'

const M = join(SCRIPTS, 'm-gate-check.mjs')
// 正文前 40% 须含锚点；正文含文末五节（与其他夹具同构）
const BASE = '# 标题\n\n## 摘要\n\n摘要 [L01]。\n\n## 一、导论\n\n正文 [L01]。\n\n## 五、结论\n\n结论。\n'
  + '\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
const WITH_CONTRIB = BASE.replace('## 一、导论\n\n正文 [L01]。',
  '## 一、导论\n\n正文 [L01]。本文的贡献如下：\n\n- 提出了 X 机制 [L01]，见第二节；\n- 验证了 Y 假设 [L01]；\n')

const mk = (draft) => {
  const { proj, fin, ev } = mkProject({})
  writeFileSync(join(fin, '定稿.md'), draft)
  return { proj, fin, ev }
}
const item = ({ proj, fin, ev }, genre) => {
  const rep = join(proj, 'r.json')
  const args = genre ? [M, join(fin, '定稿.md'), ev, '--genre', genre, '--report', rep]
    : [M, join(fin, '定稿.md'), ev, '--report', rep]
  run(args)
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  return { it: (j.results || []).find((r) => /M-Exist-12/.test(r.gate)), total: j.total }
}

test('M-Exist-12：未传 --genre → SKIP + 「N/A 且未检」（缺文类信息时不实检，防窄口径误伤老项目）', () => {
  const { it } = item(mk(BASE))
  assert.ok(it, 'M-Exist-12 必须在场')
  assert.equal(it.pass, 'SKIP', it.detail)
  assert.equal(it.severity, 'SKIP')
  assert.match(it.detail, /N\/A 且\*\*未检\*\*/)
  assert.match(it.detail, /不得读成通过/)
})

test('M-Exist-12：非学术文类（wechat）→ SKIP（不写 contribution statement 是正当的）', () => {
  const { it } = item(mk(BASE), 'wechat')
  assert.equal(it.pass, 'SKIP')
  assert.equal(it.severity, 'SKIP')
  assert.match(it.detail, /非学术稿件/)
})

test('M-Exist-12：学术文类（academic-hum）+ 缺失贡献锚点 → P1', () => {
  const { it } = item(mk(BASE), 'academic-hum')
  assert.equal(it.pass, false, '缺失贡献陈述必须报：' + it.detail)
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /缺失贡献陈述/)
})

test('M-Exist-12：命中锚点但一句话带过（无列表结构）→ P1（非结构化形态）', () => {
  const oneLiner = BASE.replace('## 一、导论\n\n正文 [L01]。',
    '## 一、导论\n\n正文 [L01]。本文的创新点是提出了 X 机制 [L01]。')
  const { it } = item(mk(oneLiner), 'academic-hum')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /非结构化形态/)
})

test('M-Exist-12：结构化条目但未锚定（无 [n]/§/见第X节）→ P1', () => {
  const unanchored = BASE.replace('## 一、导论\n\n正文 [L01]。',
    '## 一、导论\n\n正文 [L01]。本文的贡献如下：\n\n- 提出了 X 机制；\n- 验证了 Y 假设；\n')
  const { it } = item(mk(unanchored), 'academic-cn')
  assert.equal(it.pass, false, '未锚定的贡献必须报：' + it.detail)
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /未锚定/)
})

test('M-Exist-12：结构化 + 全锚定 → 通过（贡献是否成立归 T7/G16 语义判断）', () => {
  const { it, total } = item(mk(WITH_CONTRIB), 'academic-hum')
  assert.equal(it.pass, true, '合规贡献陈述不得报：' + it.detail)
  assert.equal(it.severity, '通过')
  assert.match(it.detail, /归 T7\/G16/)
  assert.equal(total, 25, 'v19.8.0 加 M-Exist-12 后机械项 = 25')
})
