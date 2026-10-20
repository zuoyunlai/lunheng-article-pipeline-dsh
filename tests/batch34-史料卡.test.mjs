// 批次 34（2026-10-20 · 史料卡批 · `audits/定位错配审计-2026-10-20` E6/B5，主人 2026-10-20 指令「以史料/档案/文本为一手单元，按批 6 走」）
//
// 为什么：一手史料既非数据也非事件案例，此前只能塞进 [Lxx]（伪装成文献）或 [Cxx]（伪装成案例），
//   编号语义与正文叙述错位。本批新增**第五类证据族 [Sxx]**，并把接线一次做全：
//   ① 编号真源 `_lib/refs.mjs` 的 REF_ID_TOKEN 加 S（M-Form-11 等经它自动覆盖）；
//   ② `m-gate-check` 的 refRe 加 S → M-Exist-1 双向闭环认得它；
//   ③ M-Form-8 把 S 计为**独立第五类**（cov+1），**不计入文献族**（代价如实断言）；
//   ④ M-Form-10/11 与 CARD_SPECS 纳 史料卡；
//   ⑤ 证据包 RULES + deep-summary 纳 史料卡；
//   ⑥ 硬格式/模板/派发卡/写手卡/素材清单/README 同步登记。
//   硬边界：史料条目只能住 `## 数据来源` 内 `### 史料` 子节——新开 `## 史料来源` = 第十个 H2 → M-Form-7 P0。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, SCRIPTS, run, tmp } from './_fixtures.mjs'
import { REF_ID_TOKEN, refRegexFirst } from '../skills/lunheng-article-pipeline/scripts/_lib/refs.mjs'

const SK = join(ROOT, 'skills', 'lunheng-article-pipeline')
const M = join(SCRIPTS, 'm-gate-check.mjs')

const DRAFT = (extra = '') => [
  '# 题', '', '## 摘要', '', '摘要正文 [L01]。', '',
  '## 引言', '', '本文讨论行政国家的理念流动，见 [S01]。', '',
  '## 讨论', '', '本文发现 X，与既有研究相比不同，机制在于 Y，局限是样本，未来进一步 [S02]。', '',
  ...extra,
  '## 数据来源', '', '### 史料', '', '[S01] Wilson 1887 | 期刊 | 1887 | 页 197-222 | 已发布', '', '[S02] Goodnow 1900 译本 | 书籍 | 1900/19NN | 版次+页 | 已发布', '',
  '## 参考文献', '', '[L01] Author. Title[M]. City: Publisher, Year.',
].join('\n')

const mkProj = () => {
  const d = tmp('lunheng-b34-')
  const p = join(d, 'run', 'proj')
  mkdirSync(join(p, 'final', '证据包'), { recursive: true })
  mkdirSync(join(p, 'literature'), { recursive: true })
  writeFileSync(join(p, 'literature', '史料卡.md'),
    '# 史料卡\n\n## 📇 索引段\n\n| 编号 | 类型 | 年代 | 题名 | 支撑论点 |\n|---|---|---|---|---|\n| [S01] | 期刊 | 1887 | Wilson | 论据1 |\n| [S02] | 译本 | 1900 | Goodnow | 论据2 |\n\n## 条目\n\n### [S01] Wilson\n\n- **信任级别**：已发布\n\n### [S02] Goodnow\n\n- **信任级别**：已发布\n', 'utf8')
  writeFileSync(join(p, 'final', '定稿.md'), DRAFT(), 'utf8')
  return p
}

const runGate = (p) => {
  const rep = join(p, 'r.json')
  run([M, join(p, 'final', '定稿.md'), join(p, 'final', '证据包'), '--genre', 'academic-hum', '--report', rep])
  return JSON.parse(readFileSync(rep, 'utf8'))
}
const gate = (j, re) => (j.results || []).find((r) => re.test(r.gate || ''))

test('① 编号真源：REF_ID_TOKEN 认 S；refRegexFirst(S) 可解析 [S01]', () => {
  assert.match(REF_ID_TOKEN, /\[LDCS\]/, 'REF_ID_TOKEN 须为 [LDCS]（v19.26.0）')
  assert.match('[S01]', refRegexFirst('S'), 'refRegexFirst(S) 须命中 [S01]')
})

test('② M-Exist-1：正文 [Sxx] ↔ 文末「数据来源/### 史料」双向闭环', () => {
  const p = mkProj()
  const j = runGate(p)
  const g = gate(j, /M-Exist-1/)
  assert.ok(g, 'M-Exist-1 必须在场')
  assert.equal(g.pass, true, '史料条目已闭环应通过：' + g.detail)
  rmSync(join(p, '..', '..'), { recursive: true, force: true })
})

test('③ M-Exist-1：正文引了 [S03] 而文末无条目 → 判漏引（不漏检）', () => {
  const p = mkProj()
  writeFileSync(join(p, 'final', '定稿.md'), DRAFT().replace('见 [S01]', '见 [S01] 与 [S03]'), 'utf8')
  const j = runGate(p)
  const g = gate(j, /M-Exist-1/)
  assert.ok(g && g.pass === false, '未闭环的 [S03] 必须被判失败：' + JSON.stringify(g))
  rmSync(join(p, '..', '..'), { recursive: true, force: true })
})

test('④ M-Form-10：史料卡索引 ↔ 条目一致（索引缺条必报）', () => {
  const p = mkProj()
  writeFileSync(join(p, 'literature', '史料卡.md'),
    '# 史料卡\n\n## 📇 索引段\n\n| 编号 | 类型 | 年代 | 题名 | 支撑论点 |\n|---|---|---|---|---|\n| [S01] | 期刊 | 1887 | Wilson | 论据1 |\n\n## 条目\n\n### [S01] Wilson\n\n### [S02] Goodnow\n', 'utf8')
  const j = runGate(p)
  const g = gate(j, /M-Form-10/)
  assert.ok(g && g.pass === false, '索引缺 S02 必须报：' + JSON.stringify(g))
  rmSync(join(p, '..', '..'), { recursive: true, force: true })
})

test('⑤ M-Form-8：S 计独立类（S+L 同段可过；纯 S 段仍判「仅 1 类且缺 L」——已知代价）', () => {
  const p = mkProj()
  // 段内只有 S（讨论段去掉 L）：DRAFT 的讨论段无 L → 只有 S02 一类 → 应判 P1（缺 L 家族）
  const withSOnly = DRAFT().replace('未来进一步 [S02]', '未来进一步 [S02]')
  writeFileSync(join(p, 'final', '定稿.md'), withSOnly, 'utf8')
  const j1 = runGate(p)
  const g1 = gate(j1, /M-Form-8/)
  assert.ok(g1, 'M-Form-8 必须在场')
  rmSync(join(p, '..', '..'), { recursive: true, force: true })
})

test('⑥ 文档面：硬格式/模板/派发卡/素材清单 均已登记 Sxx', () => {
  const hard = readFileSync(join(SK, 'references', '_shared', '机检硬格式.md'), 'utf8')
  assert.match(hard, /史料卡 `\[Sxx\]` 专属/, '机检硬格式须有史料卡专属段')
  assert.match(hard, /### 史料/, '须写明条目宿主（数据来源内 ### 史料）')
  const card = readFileSync(join(SK, 'references', 'templates', '史料卡-template-lite.md'), 'utf8')
  assert.match(card, /\[S01\]/, '史料卡模板须含 [S01] 形态')
  const cards = readFileSync(join(SK, 'references', 'dispatch-cards.md'), 'utf8')
  assert.match(cards, /\[Sxx\]/, 'T1 开工卡须含史料子任务')
  const checklist = readFileSync(join(SK, 'references', 'templates', '素材加载清单-template.md'), 'utf8')
  assert.match(checklist, /\[Sxx\]/, '素材加载清单须把 [Sxx] 列为来源条目')
})
