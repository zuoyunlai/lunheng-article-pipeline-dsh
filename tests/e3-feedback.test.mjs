// E3 受控 A/B 反哺回归（v18.97.0）——三条由**四臂实测**驱动的 M 门假阳性修复。
//
// 依据：`run/E3-共锁-A` / `run/E3-共锁-B` / `run/E3-ai-content-farm-A` / `run/E3-ai-content-farm-B`
//   四臂实测 + 各自的 T7 独立复核裁定（4 项假阳性 + 1 项范式冲突）。对比分析见
//   `run/E3-对比分析/E3-四臂对比报告.md` §七。
//
// 本文件钉住**三条已修**的判据（另两条如实驳回，见该报告 §七 与 CHANGELOG）：
//   ① M-Integrity-1：案例集**内嵌于数据卡**的布局须计入（两臂各报一次假 P0）
//   ② M-Exist-8：**内联括号编号**（`（P1，C1+C7）`）须算该维度已执行（一臂报假 P0）
//   ③ M-Form-4：**域歧义角色**（写手 / 审稿人 / 分析员）与 `定稿` 的口径收窄（两臂各报一次假 P0）
//
// ⚠️ 三条修复都**只增加「已出现」的识别方式或收窄「域歧义词」**，**不改变真缺陷的判定**——
//   每个用例组都配了「反向控制」（真缺陷形态必须仍报）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, mkProject } from './_fixtures.mjs'

const BRIEF = (n) => '# 简报\n\n## 研究问题（主控拆解，3-5 个子问题）\n\n1. 一？\n2. 二？\n3. 三？\n\n## 数据需求\n\n- 需找数据点：≥' + n + ' 条\n'
const DRAFT = (bodyTail = '') => '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、导论\n\n'
  + '段落。'.repeat(20) + bodyTail
  + '\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'

// 数据卡：`macro` 条宏观号 + `cases` 条 [D-CASExx]，条目标题用三级标题（与实测布局一致）
const dataCard = ({ macro = 8, cases = 30 }) => '# 数据卡\n\n'
  + Array.from({ length: macro }, (_, i) => `### [D${String(i + 1).padStart(2, '0')}]\n\n- **数值**：x\n- **信任级别**：已发布\n`).join('\n')
  + Array.from({ length: cases }, (_, i) => `### [D-CASE${String(i + 1).padStart(2, '0')}]\n\n- **期刊/平台**：J（P）\n- **撤稿年份**：2024\n- **信任级别**：已发布\n`).join('\n')

// ── ① M-Integrity-1：案例集内嵌于数据卡 ───────────────────────────────────────
test('E3 反哺①：M-Integrity-1 须计入「内嵌于数据卡」的案例集（E3 两臂各报一次假 P0）', () => {
  const { d, proj, fin, ev } = mkProject({ extra: ['data'] })
  writeFileSync(join(proj, '01-任务简报.md'), BRIEF(38))
  writeFileSync(join(fin, '定稿.md'), DRAFT())
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Integrity-1'))
  }
  // ① 内嵌布局：8 宏观 + 30 案例 = 38 ≥ 38 → **不得**再报「数据条目不足」
  writeFileSync(join(proj, 'data', '数据卡.md'), dataCard({ macro: 8, cases: 30 }))
  let it = item()
  assert.doesNotMatch(it.detail, /数据条目 \d+ 条 < 简报需求/, '内嵌案例集须计入：' + it.detail)
  assert.match(it.detail, /案例集 30/, '案例集计数须为 30（取自数据卡内嵌 [D-CASE]）：' + it.detail)

  // ② 反向控制：**真的不足**（只有 8 宏观 + 0 案例）→ 仍须报硬问题（修复不得掩盖真缺陷）
  writeFileSync(join(proj, 'data', '数据卡.md'), dataCard({ macro: 8, cases: 0 }))
  it = item()
  assert.match(it.detail, /数据条目 8 条 < 简报需求 38 条/, '真不足仍须报：' + it.detail)

  // ③ 反向控制：独立案例集文件布局（v18.5.1 既有行为）不得被本次改动破坏
  writeFileSync(join(proj, 'data', '数据卡.md'), dataCard({ macro: 8, cases: 0 }))
  writeFileSync(join(proj, 'data', '撤稿案例数据集.md'), Array.from({ length: 30 }, (_, i) => `[D-CASE${String(i + 1).padStart(2, '0')}] x`).join('\n'))
  it = item()
  assert.doesNotMatch(it.detail, /数据条目 \d+ 条 < 简报需求/, '独立文件布局须照旧成立：' + it.detail)
})

// ── ② M-Exist-8：内联括号编号 ────────────────────────────────────────────────
test('E3 反哺②：M-Exist-8 须识别「内联括号」编号写法（E3 farm-B 报「缺 7 节」假 P0）', () => {
  const { d, proj, fin, ev } = mkProject({ analysis: true })
  writeFileSync(join(fin, '定稿.md'), DRAFT())
  const REV = join(proj, 'analysis', '批判报告-v1.md')
  // E3 farm-B 实测写法：**无一行以 C 编号开头**，七维以「论点 N（P1，Cx+Cy）」内联承载
  const INLINE = '# 批判报告 v1\n\n## 一、论点封顶\n\n'
    + '- 论点 1（P1，C1+C7）：数据口径两版不一致。论点定位 §1.1；反方观点 可重复性失稳；'
    + '你的论据 [L01] 两版数值；攻击强度 高；建议 统一口径。\n'
    + '- 论点 2（P1，C5+C6）：反方段密度失衡。论点定位 §6.4；反方观点 密度不均；'
    + '你的论据 [D01] 字数；攻击强度 中；建议 补足。\n'
    + '- 论点 3（P2，C3+C4）：越界感与表缺说明。论点定位 §4.5；反方观点 越界；'
    + '你的论据 [C01] 限度声明；攻击强度 低；建议 改写。\n'
    + '\n## 二、维度覆盖\n\n本报告触达 C1、C2、C3、C4、C5、C6、C7 七维（C2 并入论点 1）。\n'
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-8'))
  }
  writeFileSync(REV, INLINE)
  let it = item()
  assert.match(it.detail, /C1-C7 实到 7\/7/, '内联括号写法须识别为七维齐备：' + it.detail)
  assert.doesNotMatch(it.detail, /批判维度缺/, '不得再报缺节：' + it.detail)

  // 反向控制：把 C3 从**所有形态**删掉（内联与列举皆无）→ 仍须报缺 1 节
  writeFileSync(REV, INLINE.replace('C3+C4', 'C4').replace('C1、C2、C3、C4、C5、C6、C7', 'C1、C2、C4、C5、C6、C7'))
  it = item()
  assert.match(it.detail, /缺 1 节：C3/, '编号真缺席仍须报：' + it.detail)
})

// ── ③ M-Form-4：域歧义角色 + 「定稿」收窄 ────────────────────────────────────
test('E3 反哺③：M-Form-4 域歧义角色须按语境判定（E3 两臂各报一次假 P0）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(proj, '01-任务简报.md'), BRIEF(1))
  const item = (tail) => {
    writeFileSync(join(fin, '定稿.md'), DRAFT(tail))
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Form-4'))
  }
  // ① E3 实测的三类**专业域**用法（研究代写与同行评议的稿件必然出现）→ 不得判泄露
  let it = item('\n后者以人力写手为核心产能；该刊承认一位审稿人曾对图件提出合理关切；标题尚未定稿。')
  assert.equal(it.pass, true, '专业域角色/定稿用法不得判泄露：' + it.detail)
  it = item('\n合著者把修订阶段的引用插入描述为回应审稿人意见时的无意识后果；部分条目标题尚待定稿。')
  assert.equal(it.pass, true, '专业域用法（审稿人意见 / 尚待定稿）不得判泄露：' + it.detail)

  // ② 反向控制：**真泄露形态**必须仍判 P0
  it = item('\n本段由 T5 写手完成。')
  assert.equal(it.pass, false, '带 T 编号的流水线角色仍须报：' + it.detail)
  assert.equal(it.severity, 'P0')
  it = item('\n正文以定稿版本为准。')
  assert.equal(it.pass, false, '「定稿版本」是 farm-A 实测的真缺陷，收窄后仍须报：' + it.detail)
  it = item('\n初稿 与 草稿 为契约锁定的无歧义词。')
  assert.equal(it.pass, false, '初稿/草稿 契约词仍须无条件命中：' + it.detail)
})
