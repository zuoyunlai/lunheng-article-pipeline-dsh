// g-audit-check（G 项机检门）回归测试（v18.23.0 EFF-1 新增）
//
// 本套用例的每一组都对应一次**实测校准**（21 个真实项目横扫暴露的假阳性/假阴性），
// 目的就是让这些校准**不能再被无声改回去**：
//   · G8 只判候选、绝不自行判级（判级归 T7；2026-09-29 裁定后**超限侧**无 P0 档（不足 >10% 仍判 P0）；实测有项目简报 16k / 定稿 40k + 交付说明记「主人已确认字数不作硬规定」）
//   · G11 的「有理由」按**形式**判（实测旧口径把 15 条已带括注理由的红级数据全判 P1）
//   · G2.5 数**来源条目**而非 URL 数（实测 C05 有 11 条来源却只有 1 个 URL）
//   · 素材卡**索引段**的行首 `[Cxx]` 不得被当成案例条目（实测 18 个「条目」里 6 个是索引行）
//   · 卡级整体缺字段 = **一条聚合 P2**，不当逐条 P1（实测「分析示例型」案例卡被误判 9 条 P1）
//   · 缺输入 = SKIP + exit 3（**SKIP ≠ 通过**）
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const G = join(SCRIPTS, 'g-audit-check.mjs')

/** 造一个最小项目：定稿正文 + 三张素材卡 + 任务简报。返回路径集合。
 *  ⚠️ 正文默认 ~480 汉字、简报默认「500 字」——**刻意落在 G8 候选区间内**，
 *     否则「全项合规」用例会被字数项判成 P2（首版夹具正文只有 20 字，实测就是因此红的）。 */
const mkFixture = (opts = {}) => {
  const d = tmp()
  const cards = join(d, '证据包')
  mkdirSync(cards, { recursive: true })
  const draft = join(d, '定稿.md')
  const brief = join(d, '01-任务简报.md')
  writeFileSync(draft, opts.draft ?? '# 标题\n\n## 摘要\n\n摘要文字。\n\n## 一、正文\n\n' + '汉字内容填充。'.repeat(80) + '[L01] [D01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n[D01] y\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(brief, opts.brief ?? '- **篇幅**：**500 字**（学术档）\n')
  if (opts.文献卡 !== null) writeFileSync(join(cards, '文献卡.md'), opts.文献卡 ?? '# 文献卡\n\n### [L01] 甲\n- 标题：甲\n')
  if (opts.数据卡 !== null) writeFileSync(join(cards, '数据卡.md'), opts.数据卡 ?? '# 数据卡\n\n> **截止**：2026-09-19\n\n### [D01] 甲\n- **时效评级**：🟢 ≤2 年\n')
  if (opts.案例卡 !== null) writeFileSync(join(cards, '案例卡.md'), opts.案例卡 ?? '# 案例卡\n\n### [C01] 甲\n- **时间窗口**：2024-01-01 ~ 2024-02-01\n- **检索截止**：2026-09-19\n- **来源谱系（≥2 独立来源）**：\n  - 来源甲：<https://a.example/1>\n  - 来源乙：<https://b.example/2>\n')
  return { d, draft, brief, cards }
}
const g8 = (j) => j.checks['G8-CharCount']
const g11 = (j) => j.checks['G11-Timeliness']
const g25 = (j) => j.checks['G2.5-CaseCheck']
const g05 = (j) => j.checks['G0.5-FirstPerson']

test('g-audit-check：全项合规 → exit 0，且 G2 与 G0.5 判 PASS', () => {
  const { d, draft, brief, cards } = mkFixture()
  const r = run([G, draft, '--cards', cards, '--brief', brief])
  const j = parseJson(r)
  assert.equal(g05(j).pass, true, '无第一人称经历 → PASS：' + JSON.stringify(g05(j)))
  assert.equal(j.checks['G2-DataProv'].pass, true, '正文数字 [D01] 在卡内 → PASS')
  assert.equal(r.code, 0, '全绿应 exit 0：' + r.out.slice(-300))
  rmSync(d, { recursive: true, force: true })
})

test('g-audit-check G8：自由文本否定/引用不得豁免；仅 WAIVER=on 生效', () => {
  const draft = '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、正文\n\n' + '汉字内容填充。'.repeat(400) + '\n\n## 参考文献\n\n[L01] x\n'
  const runBrief = (brief) => {
    const f = mkFixture({ brief, draft })
    const j = parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))
    rmSync(f.d, { recursive: true, force: true })
    return g8(j)
  }
  assert.notEqual(runBrief('- **篇幅**：**5000 字**\\n> 本项目不允许字数不作硬规定。').severity, 'SKIP')
  assert.notEqual(runBrief('- **篇幅**：**5000 字**\\n> 引用旧项目「字数豁免」记录。').severity, 'SKIP')
  assert.equal(runBrief('- **篇幅**：**5000 字**\\n- WAIVER=off').severity, 'P2')
  assert.equal(runBrief('- **篇幅**：**5000 字**\\n- WAIVER=on').severity, 'SKIP')
})

test('g-audit-check G8：**越限只判候选 P2，判级归 T7（绝不自行判 P1/P0）**（实测有项目已获主人字数豁免）', () => {
  const { d, draft, brief, cards } = mkFixture({
    brief: '- **篇幅**：**5000 字**\n',
    draft: '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、正文\n\n' + '汉字内容填充。'.repeat(400) + '\n\n## 参考文献\n\n[L01] x\n',
  })
  const r = run([G, draft, '--cards', cards, '--brief', brief])
  const j = parseJson(r)
  assert.equal(g8(j).checked, true)
  assert.equal(g8(j).severity, 'P2', '超限必须是 P2 候选（判级归 T7）：' + JSON.stringify(g8(j)))
  assert.equal(j.overall.p0, 0, '本门**永不**产出 P0（P0 判定依赖人类豁免信息）')
  assert.match(g8(j).evidence.note, /判级归 T7/)
  rmSync(d, { recursive: true, force: true })
})

test('g-audit-check G8：例外通道标记（BUF=）只浮出事实、不改 severity；三态各自可辨', () => {
  // 正文 80×「汉字内容填充。」≈ 480+ 汉字。目标 300 → 超上界 1.6×，**不在** +5%~+9% 容忍带内。
  const LONG_DRAFT = '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、正文\n\n' + '汉字内容填充。'.repeat(80) + '\n\n## 参考文献\n\n[L01] x\n'
  const T300 = '- **篇幅**：**300 字**\n'
  // ① 未标 → bufMarker = null（**「没标」与「标了 off」必须可辨**）
  let f = mkFixture({ brief: T300, draft: LONG_DRAFT })
  let j = parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))
  assert.equal(g8(j).evidence.bufMarker, null)
  assert.equal(g8(j).evidence.bufferBand, false)
  assert.equal(g8(j).severity, 'P2', '本门永远不因该标记改变 severity：' + JSON.stringify(g8(j).evidence))
  rmSync(f.d, { recursive: true, force: true })
  // ② 标 off → 明示回主判
  f = mkFixture({ brief: T300 + '- BUF=off\n', draft: LONG_DRAFT })
  j = parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))
  assert.equal(g8(j).evidence.bufMarker, 'off')
  assert.equal(g8(j).evidence.bufferBand, false)
  assert.match(g8(j).detail, /BUF=off/, '标了 off 必须出现在 detail 里（不静默）')
  rmSync(f.d, { recursive: true, force: true })
  // ③ 标 on 但**不在**容忍带（超 60%）→ 通道不适用，detail 说明原因
  f = mkFixture({ brief: T300 + '- BUF=on\n', draft: LONG_DRAFT })
  j = parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))
  assert.equal(g8(j).evidence.bufMarker, 'on')
  assert.equal(g8(j).evidence.inBufferBand, false)
  assert.equal(g8(j).evidence.bufferBand, false, '标记 + 不在带内 ⇒ 通道不成立')
  assert.match(g8(j).detail, /不在/, '不适用时必须说明原因')
  rmSync(f.d, { recursive: true, force: true })
  // ④ 标 on 且**落在**容忍带 → bufferBand = true。目标**自校准**（按实测汉字数 ÷1.07 反推），
  //    避免对「一个短语 = 几个汉字」做脆弱假设——这正是本套用例其余各组踩过的教训。
  f = mkFixture({ brief: T300, draft: LONG_DRAFT })
  const han = g8(parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))).evidence.hanChars
  rmSync(f.d, { recursive: true, force: true })
  const target = Math.round(han / 1.07)   // 目标 ≈ 实测 ÷1.07 ⇒ 超限 ≈ +7%
  f = mkFixture({ brief: `- **篇幅**：**${target} 字**\n- BUF=on\n`, draft: LONG_DRAFT })
  j = parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))
  assert.equal(g8(j).evidence.bufMarker, 'on')
  assert.equal(g8(j).evidence.inBufferBand, true, `正文 ${han} 汉字 / 目标 ${target} 应落 +5%~+9%：` + JSON.stringify(g8(j).evidence))
  assert.equal(g8(j).evidence.bufferBand, true)
  assert.match(g8(j).evidence.note, /不含第 ③ 条/, '必须写明脚本不核第 ③ 条（估算标注不在其输入内）')
  assert.equal(g8(j).severity, 'P2', '通道成立也只是 P2 候选——判级归 T7，脚本不代判')
  rmSync(f.d, { recursive: true, force: true })
})

test('g-audit-check G8：缺 --brief → SKIP 且 exit 3（**SKIP ≠ 通过**）', () => {
  const { d, draft, cards } = mkFixture()
  const r = run([G, draft, '--cards', cards])
  const j = parseJson(r)
  assert.equal(g8(j).checked, false)
  assert.equal(g8(j).severity, 'SKIP')
  assert.match(g8(j).skipReason, /未传 --brief/)
  assert.equal(r.code, 3, 'SKIP 必须 exit 3（不得当通过）：' + r.out.slice(-200))
  rmSync(d, { recursive: true, force: true })
})

test('g-audit-check G11：🔴 **带括注理由** → PASS；**完全无理由** → P1（实测旧口径 15 条假 P1）', () => {
  const build = (rating) => `# 数据卡\n\n> **截止**：2026-09-19\n\n### [D01] 甲\n- **时效评级**：${rating}\n`
  const withReason = (rating) => mkFixture({ 数据卡: build(rating) })

  let f = withReason('🔴 >5 年（面积不变）')
  let j = parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))
  assert.equal(g11(j).severity, 'PASS', '带括注理由的红级数据不得判 P1（实测假阳性）：' + JSON.stringify(g11(j).evidence))
  rmSync(f.d, { recursive: true, force: true })

  f = withReason('🔴 >5 年（1903 文本，但作为案例锚点）')
  j = parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))
  assert.equal(g11(j).severity, 'PASS', '括注式理由同样算有理由')
  rmSync(f.d, { recursive: true, force: true })

  f = withReason('🔴 >5 年')
  j = parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))
  assert.equal(g11(j).severity, 'P1', '🔴 完全无理由必须报 P1：' + JSON.stringify(g11(j).evidence))
  assert.equal(g11(j).evidence.p1[0].id, 'D01')
  rmSync(f.d, { recursive: true, force: true })
})

test('g-audit-check G11：**整卡**无时效评级 → 一条聚合 P2（不按条判 P1）', () => {
  const f = mkFixture({ 数据卡: '# 数据卡\n\n> **截止**：2026-09-19\n\n### [D01] 甲\n- 数值：1\n\n### [D02] 乙\n- 数值：2\n' })
  const j = parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))
  assert.equal(g11(j).severity, 'P2', '整卡缺字段是聚合 P2：' + JSON.stringify(g11(j).evidence.p2))
  assert.equal(g11(j).evidence.p2.length, 2, '每条各一条「未标时效评级」提示')
  assert.equal(g11(j).evidence.p1.length, 0, '不得升 P1（字段压根不存在 ≠ 红级缺理由）')
  rmSync(f.d, { recursive: true, force: true })
})

test('g-audit-check G2.5：来源段**恰好 1 条** → P1；两条以上 → PASS（URL 数不是判据）', () => {
  const one = mkFixture({ 案例卡: '# 案例卡\n\n### [C01] 甲\n- **时间窗口**：2024-01-01 ~ 2024-02-01\n- **检索截止**：2026-09-19\n- **来源谱系（≥2 独立来源）**：\n  - 仅此一条：<https://a.example/1>\n' })
  let j = parseJson(run([G, one.draft, '--cards', one.cards, '--brief', one.brief]))
  assert.equal(g25(j).severity, 'P1', '恰 1 条来源必须报 P1：' + JSON.stringify(g25(j).evidence.issues))
  rmSync(one.d, { recursive: true, force: true })

  // 11 条来源但**只有 1 个 URL**（实测 C05 形态）→ 必须 PASS，不得按 URL 数误判单源
  const many = mkFixture({ 案例卡: '# 案例卡\n\n### [C01] 甲\n- **时间窗口**：2024-01-01 ~ 2024-02-01\n- **检索截止**：2026-09-19\n- **来源谱系（≥2 独立来源）**：\n  - ① 官方自源：<https://a.example/1>\n  - ② 媒体甲：某报（2024-01-01）\n  - ② 媒体乙：某网（2024-01-02）\n  - ③ 学术：某刊论文\n' })
  j = parseJson(run([G, many.draft, '--cards', many.cards, '--brief', many.brief]))
  assert.equal(g25(j).severity, 'PASS', '来源条目数 ≥2 即通过（URL 数不是判据）：' + JSON.stringify(g25(j).evidence.issues))
  rmSync(many.d, { recursive: true, force: true })
})

test('g-audit-check G2.5：**缩进加粗子项**形态的来源条目必须被数出（反哺-v18.78.2 §二 F-b 假阴性）', () => {
  // 病灶：段结束判据旧为 `/^\s*[-*]\s+\*\*/`（允许前导空白）→ 紧跟 `- **来源谱系**：` 之后的第一行
  //   `  - **① 独立媒体（自采）** — …` 直接 break → `countSources` **恒为 0**。
  //   实测 test-v18-78-2-县中塌陷：7/7 张卡全为 0，G2.5 只报 7 条 P2「未能数出条目」，
  //   而**本门唯一的 P1 判据（来源段内恰好 1 条）永不触发** → 真正的单源卡一张都抓不到。
  // 两侧都钉：① ≥2 条 → PASS；② **恰 1 条** → 必须 P1（这是旧实现永远到不了的判据）。
  const two = mkFixture({ 案例卡: '# 案例卡\n\n### [C01] 甲\n- **时间窗口**：2024-01-01 ~ 2024-02-01\n- **检索截止**：2026-09-19\n- **来源谱系**（独立来源计数 **2**）:\n  - **① 独立媒体（自采）** — `[媒]` 某报：<https://a.example/1>\n  - **② 独立媒体（党报）** — `[媒]` 某网：<https://b.example/2>\n- **多方说法**:\n  - 甲说：…\n' })
  let j = parseJson(run([G, two.draft, '--cards', two.cards, '--brief', two.brief]))
  assert.equal(g25(j).severity, 'PASS',
    '缩进加粗子项 ≥2 条须数得出（旧实现 break 在第一行 → count=0 → P2）：' + JSON.stringify(g25(j).evidence.issues))
  assert.deepEqual(g25(j).evidence.issues, [], '不得残留「未能数出条目」P2（零缩进字段行才是段结束）')
  rmSync(two.d, { recursive: true, force: true })

  const one = mkFixture({ 案例卡: '# 案例卡\n\n### [C01] 甲\n- **时间窗口**：2024-01-01 ~ 2024-02-01\n- **检索截止**：2026-09-19\n- **来源谱系**（独立来源计数 **1**）:\n  - **① 独立媒体（自采）** — `[媒]` 某报：<https://a.example/1>\n- **多方说法**:\n  - 甲说：…\n' })
  j = parseJson(run([G, one.draft, '--cards', one.cards, '--brief', one.brief]))
  assert.equal(g25(j).severity, 'P1',
    '缩进加粗子项**恰好 1 条**必须判 P1——这正是旧实现永不触发的判据（假阴性）：' + JSON.stringify(g25(j).evidence.issues))
  rmSync(one.d, { recursive: true, force: true })
})

test('g-audit-check G2.5：素材卡**索引段**的行首 [Cxx] 不得被当成条目（围栏掩码）', () => {
  const card = '# 案例卡\n\n## 📇 索引段\n\n```\n[C01] 甲 ｜ 支撑 S1 ｜ 🟢已落地\n[C02] 乙 ｜ 支撑 S2 ｜ 🟢已落地\n```\n\n### [C01] 甲\n- **时间窗口**：2024-01-01 ~ 2024-02-01\n- **检索截止**：2026-09-19\n- **来源谱系**：\n  - 甲源 <https://a.example/1>\n  - 乙源 <https://b.example/2>\n'
  const f = mkFixture({ 案例卡: card })
  const j = parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))
  assert.equal(g25(j).evidence.entries, 1, '索引段两行不得计入条目（实测旧口径 18 个「条目」里 6 个是索引行）：' + JSON.stringify(g25(j).evidence))
  assert.equal(g25(j).severity, 'PASS', '索引行不再产出「缺字段」假 P1')
  rmSync(f.d, { recursive: true, force: true })
})

test('g-audit-check G2.5：卡内**不一致**（他条有、本条无）→ P1；**整卡**都无 → 聚合 P2', () => {
  const inconsistent = '# 案例卡\n\n### [C01] 甲\n- **时间窗口**：2024-01-01 ~ 2024-02-01\n- **检索截止**：2026-09-19\n- **来源谱系**：\n  - 甲 <https://a.example/1>\n  - 乙 <https://b.example/2>\n\n### [C02] 乙\n- **来源谱系**：\n  - 甲 <https://c.example/1>\n  - 乙 <https://d.example/2>\n'
  let f = mkFixture({ 案例卡: inconsistent })
  let j = parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))
  const p1 = g25(j).evidence.issues.filter((x) => x.severity === 'P1')
  assert.ok(p1.some((x) => x.id === 'C02' && /卡内不一致|时间字段/.test(x.reason)), 'C02 缺时间字段而 C01 有 → 卡内不一致 P1：' + JSON.stringify(g25(j).evidence.issues))
  rmSync(f.d, { recursive: true, force: true })

  // 整卡都无（非标准/分析示例型卡）→ 不得逐条 P1，只出一条卡级 P2
  const allMissing = '# 案例卡\n\n### [C01] 甲\n- 场景说明：分析示例\n- 代表性来源：\n  - 甲\n  - 乙\n\n### [C02] 乙\n- 场景说明：分析示例\n- 代表性来源：\n  - 甲\n  - 乙\n'
  f = mkFixture({ 案例卡: allMissing })
  j = parseJson(run([G, f.draft, '--cards', f.cards, '--brief', f.brief]))
  assert.equal(g25(j).severity, 'P2', '整卡缺字段 → 聚合 P2（实测误判 9 条 P1）:' + JSON.stringify(g25(j).evidence.issues))
  const cardLevel = g25(j).evidence.issues.filter((x) => x.id === '(卡级)')
  assert.ok(cardLevel.length >= 1, '须有卡级聚合项（让 T7 一次定性）')
  rmSync(f.d, { recursive: true, force: true })
})

test('g-audit-check G0.5：第一人称具体经历命中 → P1 并给行号；裸「我」不命中', () => {
  const hit = mkFixture({ draft: '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、正文\n\n我曾在该机构工作三年，亲眼见过。\n\n## 参考文献\n\n[L01] x\n' })
  let j = parseJson(run([G, hit.draft, '--cards', hit.cards, '--brief', hit.brief]))
  assert.equal(g05(j).severity, 'P1', '第一人称具体经历必须报 P1：' + JSON.stringify(g05(j)))
  assert.ok(g05(j).evidence.hits[0].line > 0, '须给行号')
  rmSync(hit.d, { recursive: true, force: true })

  const ok = mkFixture({ draft: '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、正文\n\n我国政策框架与我国学术界均认为。\n\n## 参考文献\n\n[L01] x\n' })
  j = parseJson(run([G, ok.draft, '--cards', ok.cards, '--brief', ok.brief]))
  assert.equal(g05(j).severity, 'PASS', '裸「我」（我国）不得命中（词表刻意收窄）：' + JSON.stringify(g05(j)))
  rmSync(ok.d, { recursive: true, force: true })
})

test('g-audit-check：缺 --cards 时卡类三项 SKIP，且 exit 3（不得静默通过）', () => {
  const { d, draft, brief } = mkFixture()
  const r = run([G, draft, '--brief', brief])
  const j = parseJson(r)
  assert.equal(g11(j).checked, false)
  assert.equal(g25(j).checked, false)
  assert.equal(j.overall.skipped, 3, 'G2 / G11 / G2.5 三项应 SKIP：' + JSON.stringify(j.overall))
  assert.equal(r.code, 3)
  rmSync(d, { recursive: true, force: true })
})

test('g-audit-check：参数错（未知参数 / 带值旗标缺值 / 文件不存在 / 目录当文件传）→ exit 10', () => {
  const { d, draft, cards } = mkFixture()
  for (const args of [[draft, '--nope'], [draft, '--brief'], ['C:/__nope__/x.md'], [d]]) {
    const r = run([G, ...args])
    assert.equal(r.code, 10, `参数错须 exit 10：${args.join(' ')} → ${r.code}\n${r.out.slice(-200)}`)
  }
  rmSync(d, { recursive: true, force: true })
})

test('cite-coverage-check C-Redundancy：同句 ≥4 篇引用且无差异词 → **必须报**（v18.23.0 假绿修复；v18.24.0 判级收窄为 P2 候选）', () => {
  const d = tmp()
  const refs = ['[L01] a', '[L02] b', '[L03] c', '[L04] d', '[L05] e'].join('\n')
  const build = (body) => {
    const f = join(d, `p${Math.abs(body.length)}.md`)
    writeFileSync(f, `# 标题\n\n## 摘要\n\n摘要还引了 [L01][L02][L03][L04]（摘要罗列不算）。\n\n## 一、导论\n\n${body}\n\n## 参考文献\n\n${refs}\n`)
    return f
  }
  const cc = join(SCRIPTS, 'cite-coverage-check.mjs')

  // 假绿复现点：`refRegex` 无捕获组，旧代码 `L${x[1]}` 恒为 "Lundefined" → uniqueRefs 恒 1 → 永不触发
  const bad = parseJson(run([cc, build('有学者认为甲。[L01][L02][L03][L04][L05]')]))
  assert.equal(bad.checks['C-Redundancy'].pass, false, '同句 5 篇不同引用且无差异词必须报（修复前恒 pass=true）')
  assert.equal(bad.checks['C-Redundancy'].severity, 'P2', 'v18.24.0 判级收窄为 **P2 候选**（是否属「同质堆砌」是语义判断，判级归 T7）')
  assert.equal(bad.checks['C-Redundancy'].violations[0].refsCount, 5, '引用计数必须是 5（而非 1）：' + JSON.stringify(bad.checks['C-Redundancy'].violations))
  assert.ok(bad.checks['C-Redundancy'].violations[0].sentence.includes('[L01]'), '须给出命中句原文，供 T7 直接判读（免回查全文）')

  // 摘要里的并列引用**不算**（那是罗列证据基础，不是论点句）
  const onlyAbstract = parseJson(run([cc, build('本节不含并列引用。')]))
  assert.equal(onlyAbstract.checks['C-Redundancy'].pass, true, '摘要/关键词里的并列引用不得计入（实测某项目摘要 8 篇被误判）')

  // 指明了差异 → 不报（判据的否定侧）
  const ok = parseJson(run([cc, build('甲认为 A。[L01][L02][L03][L04] 与之不同，乙认为 B。')]))
  assert.equal(ok.checks['C-Redundancy'].pass, true, '带差异关键词时不得报：' + JSON.stringify(ok.checks['C-Redundancy'].violations))

  // 只引 3 篇 → 不达阈值
  const three = parseJson(run([cc, build('甲认为 A。[L01][L02][L03]')]))
  assert.equal(three.checks['C-Redundancy'].pass, true, '3 篇未达阈值 4')
  rmSync(d, { recursive: true, force: true })
})

test('parseTargetCandidates：粗体字段形态与「篇幅」标题抢先命中都不再漏解析（v18.23.0 连带修复）', async () => {
  const { parseTargetCandidates, parseTargetChars } = await import(pathToFileURL(join(SCRIPTS, '_lib', 'target-chars.mjs')).href)
  const c = (t) => parseTargetCandidates(t).candidates

  // ① 粗体形态（实测 run/海外驻军-主权分离/01-任务简报.md:17 即此形）——旧 LINE_RE 要求字段名紧跟冒号 → null
  assert.equal(parseTargetChars('- **篇幅**：**16000 字**（≥5000 全量流水线档）').value, 16000, '粗体「**篇幅**：」必须能解析（旧版返回 null → 字数硬阈静默跳过）')
  assert.deepEqual(c('- **篇幅**：**16000 字**（≥5000 全量流水线档）'), [5000, 16000], '档位下限 5000 与目标 16000 **都进候选**（判据是「落在候选区间内」，故 5000–16000 之间都算合规）')

  // ② 「篇幅与结构」标题抢先命中 → 旧版只取首个命中 → 假 SKIP
  assert.deepEqual(c('## 三、篇幅与结构\n\n- **总字数**：6000 字（±5%，容差 5700-6300）'), [5700, 6000, 6300], '须跳过没有数字的标题命中，取真正字段行（候选按升序）')

  // ③ 区间 / 表格形态
  assert.deepEqual(c('- **篇幅**：3000-5000 字（标准档）'), [3000, 5000])
  assert.deepEqual(c('| 篇幅 | 约 8000 字（中文） |'), [8000], '表格形态（无冒号）也要能解析')

  // ④ 单值版行为不变（G8 字数硬阈依赖它）
  assert.equal(parseTargetChars('- **篇幅**：1.2 万 字').value, 12000, '数量级单位照旧')
})

// ─────────────────────────────────────────────────────────────────────────────
// v18.41.0 G15-VolIssue：把「卷期页码完整率」从**幻影门**变成真门
//
// 立项：`01 卡` 曾宣称「机检判别（`M-Form-2 v2 分支`）：文献卡缺卷期页码必填字段 → P1」，而该门从未实装
//   （v18.40.0 实测）。本批实装。要件真源 = `01 卡` §卷期页码双写契约。
// 本组用例钉住的是**测出来的六件事**（每一件都对应一次真实校准，不是设计偏好）：
//   ① 模式开关是**显式旗标**，不从简报字面推断（首版按标签放行 → 对「默认关闭」的项目产出 6 组假阳性）；
//   ② 模式未启用 = **N/A**（不适用），不是 SKIP——否则 N/A 会把 24/25 个项目推成 exit 3，exit 0 不可达；
//   ③ 四种真实排版都要认（标题即著录串 / `**GB/T 7714**：` 体例行 / 字段分行 / 合并标签）；
//   ④ **合并标签 `出版XX/期刊` 类型不可判 → 不判罚**（左边界不设防会把相邻标签读成自己，同 ㉙ 反例）；
//   ⑤ 缺字段只判 **P2 候选**，且**刻意不给完整率阈值**；
//   ⑥ 用**历史上真实出现过的缺字段写法**撞门（[M] 只写 ISBN 无 DOI = v18.9.0 实战那 6 条；中文译著两缺）。
const g15 = (j) => j.checks['G15-VolIssue']

test('g-audit-check G15：模式未启用 → **N/A（不适用，不推高退出码）**；与 SKIP（适用但缺输入）刻意分开', () => {
  const { d, draft, brief, cards } = mkFixture()
  const r = run([G, draft, '--cards', cards, '--brief', brief])
  const j = parseJson(r)
  assert.equal(g15(j).checked, false)
  assert.equal(g15(j).severity, 'N/A', '模式未启用 = 不适用：' + JSON.stringify(g15(j)))
  assert.equal(g15(j).applicable, false)
  assert.equal(j.overall.na, 1, 'N/A 须单独计数')
  assert.equal(j.overall.skipped, 0, 'N/A **不得**计入 skipped——否则每个项目都被推成 exit 3')
  assert.equal(r.code, 0, '模式未启用时本项不该影响退出码：' + r.out.slice(-200))
  rmSync(d, { recursive: true, force: true })
})

test('g-audit-check G15：**假阳性回归**——简报写「默认关闭」时，即使传了 --brief 也不得判级', () => {
  // 实测原型：`数字社交-关系重构` 的简报写「☐ **APA 优先输出 + 卷期页码完整性**：**默认关闭**（…）；
  //   若启用须主人二次确认」——方框未勾选、明写默认关闭。首版按 `/卷期页码完整/` 字面放行 → 6 组假 P2。
  //   判据：**匹配到标签 ≠ 匹配到启用状态**。
  const 卡 = '# 文献卡\n\n### [L01] X. T[J]. AJS, 1973, 78(6): 1360-1380.\n'   // 缺 DOI
  const { d, draft, brief, cards } = mkFixture({
    文献卡: 卡,
    brief: '- ☐ **APA 优先输出 + 卷期页码完整性**：默认关闭（保留 GB/T 7714-2015 为唯一引用格式）；若启用须主人二次确认\n- **篇幅**：**500 字**\n',
  })
  const r = run([G, draft, '--cards', cards, '--brief', brief])
  const j = parseJson(r)
  assert.equal(g15(j).severity, 'N/A', '简报里出现标签 ≠ 模式已启用：' + JSON.stringify(g15(j)))
  assert.equal(g15(j).evidence.issues, undefined, 'N/A 时不得产出任何候选清单')
  assert.notEqual(r.code, 3, '模式未启用不得把项目推成 exit 3')
  rmSync(d, { recursive: true, force: true })
})

test('g-audit-check G15：传 --qlt 才真跑；缺字段判 P2 候选，齐备判 PASS', () => {
  const 卡 = [
    '# 文献卡',
    '',
    '### [L01] Granovetter M S. The strength of weak ties[J]. AJS, 1973, 78(6): 1360-1380. DOI: 10.1086/225469.',
    '',
    '### [L02] 缺 DOI 的期刊条目[J]. 中国社会科学, 2009(03): 69-86.',
    '',
    '### [L03] Tilly C. Stories[M]. Lanham: Rowman & Littlefield, 2002. ISBN: 9780847697496.',
    '',
  ].join('\n')
  const { d, draft, brief, cards } = mkFixture({ 文献卡: 卡 })
  const r = run([G, draft, '--cards', cards, '--brief', brief, '--qlt'])
  const j = parseJson(r)
  assert.equal(g15(j).checked, true, '传了 --qlt 必须真跑：' + JSON.stringify(g15(j)))
  assert.equal(g15(j).severity, 'P2', '有缺字段 → P2 候选（判级归 T7）')
  assert.equal(g15(j).evidence.counts.J, 2, 'L01/L02 应判为期刊')
  assert.equal(g15(j).evidence.counts.M, 1, 'L03 应判为专著')
  const ids = g15(j).evidence.issues.map((x) => x.id)
  assert.deepEqual(ids.sort(), ['L02', 'L03'], 'L02 缺 DOI、L03 缺 DOI（专著双写）应被标，L01 齐备不标')
  assert.match(g15(j).evidence.note, /刻意不设完整率阈值/, '阈值口径须写死在证据里')
  // 完整率**只作信息**：要能算（G15 报告要写「卷期页码完整率」），但分母只含类型可判的条目，
  //   且它绝不参与判级（整体严重度仍由「有没有 issue」决定）。
  assert.deepEqual(g15(j).evidence.rate, { complete: 1, typed: 3, ratio: 0.333, note: '仅信息；本项不设阈值' },
    '完整率须可算且只含类型可判条目（3 条里 1 条齐备）：' + JSON.stringify(g15(j).evidence.rate))
  assert.equal(j.overall.p0, 0, '本项**永不**产出 P0/P1——新分布式指标只到候选')
  assert.equal(j.overall.p1, 0)
  rmSync(d, { recursive: true, force: true })
})

test('g-audit-check G15：四种真实排版都要认（否则合规卡会被判红）', () => {
  const 卡 = [
    '# 文献卡',
    '',
    '### [L01] Granovetter M S. The strength of weak ties[J]. AJS, 1973, 78(6): 1360-1380. DOI: 10.1086/225469.',
    '### [L02] 未成年人网络保护条例（国务院令第 766 号）',
    '- **GB/T 7714**：国务院. 未成年人网络保护条例: 国务院令第766号[EB/OL]. (2023-10-16)[2026-08-17]. https://www.gov.cn/x.html.',
    '### [L03] 栏目型条目（字段分行，实测 `中国新能源车出口` 项目形态）',
    '- **期刊**：Academic Journal of Business & Management',
    '- **卷/期/页码**：vol. 6, no. 11, pp. 20-28',
    '- **DOI**：10.25236/AJBM.2024.061120',
    '### [L04] 合并标签条目（实测 `共锁` 项目：期刊与专著同用 `出版社/期刊`）',
    '- **出版社/期刊**: Harvard University Press',
    '- **年份**: 1997',
    '',
  ].join('\n')
  const { d, draft, brief, cards } = mkFixture({ 文献卡: 卡 })
  const r = run([G, draft, '--cards', cards, '--brief', brief, '--qlt'])
  const j = parseJson(r)
  const ev = g15(j).evidence
  assert.equal(g15(j).pass, true, '四条都实质合规（L02 走体例行 / L03 走字段分行 / L04 类型不可判）→ 不得判红：' + JSON.stringify(ev.issues))
  assert.deepEqual(ev.counts, { J: 2, M: 0, E: 1 }, 'L01 [J] / L02 [EB/OL] / L03 由 `期刊` 字段推为 [J]')
  assert.deepEqual(ev.untyped, ['L04'], '合并标签 `出版XX/期刊` 类型不可判 → 不计入判罚，但须如实暴露在 untyped 里')
  rmSync(d, { recursive: true, force: true })
})

test('g-audit-check G15：用**历史上真实出现的缺字段写法**撞门 + 传了 --qlt 却无卡 → SKIP（exit 3）', () => {
  const 卡 = [
    '# 文献卡',
    '',
    '### [L01] Krasner S D. Sovereignty: Organized Hypocrisy[M]. Princeton: Princeton University Press, 1999. DOI: 10.1515/9781400823260',
    '### [L02] 伯纳德·鲍桑葵. 美学史[M]. 张今, 译. 北京: 商务印书馆, 1985.',
    '',
  ].join('\n')
  const { d, draft, brief, cards } = mkFixture({ 文献卡: 卡 })
  const r = run([G, draft, '--cards', cards, '--brief', brief, '--qlt'])
  const j = parseJson(r)
  const byId = Object.fromEntries(g15(j).evidence.issues.map((x) => [x.id, x.missing]))
  assert.deepEqual(byId.L01, ['ISBN'], '实测形态：英文专著有 DOI 无 ISBN（v18.9.0 双写契约要求二者都有）')
  assert.deepEqual(byId.L02, ['ISBN', 'DOI'], '实测形态：中文译著两缺（1985 年商务印书馆译本确实无 DOI）')

  // 传了 --qlt 但没有文献卡 → 这是**适用但缺输入** → SKIP（计入 skipped → exit 3），不是 N/A
  const noCard = mkFixture({ 文献卡: null })
  const r2 = run([G, noCard.draft, '--cards', noCard.cards, '--brief', noCard.brief, '--qlt'])
  const j2 = parseJson(r2)
  assert.equal(g15(j2).severity, 'SKIP', '缺输入 = SKIP（不算核过）：' + JSON.stringify(g15(j2)))
  assert.equal(g15(j2).applicable, undefined, 'SKIP 不得带 applicable:false（那是 N/A 的语义）')
  assert.equal(r2.code, 3, 'SKIP 必须 exit 3')
  rmSync(d, { recursive: true, force: true })
  rmSync(noCard.d, { recursive: true, force: true })
})

// v18.43.0（主人「继续」→ 接口债 D）：G15-VolIssue 的模式判定此前**只**靠调用方旗标，而「简报启用了该模式」
//   这件事没有任何机器可读的表达 → 项目**可以静默不跑**本项（判 N/A 而无人注意）。本批补上：
//     · 简报侧：模板新增**唯一依据**的显式标记 `QLT=on` / `QLT=off`；
//     · 脚本侧：读标记，**只读标记**（不按散文标签推断——v18.41.0 实测过那条路会产生成组假阳性）；
//     · 不一致可见：标 `on` 却没传旗标 → 仍判 N/A，但**在 skipReason 里点名**（不静默）；
//                  标 `off` 却传了旗标 → **旗标优先**照跑，并注明「按调用方要求核对」。
test('g-audit-check G15：标记 `QLT=on` 但未传 `--qlt` → 仍 N/A，**但必须点名这处不一致**（不许静默不跑）', () => {
  const { d, draft, cards } = mkFixture({
    文献卡: '# 文献卡\n\n### [L01] X. T[J]. AJS, 1973, 78(6): 1360-1380. DOI: 10.1086/225469.\n',
    brief: '- **启用标记**：`QLT=on`\n- **篇幅**：**500 字**\n',
  })
  const r = run([G, draft, '--cards', cards, '--brief', join(d, '01-任务简报.md')])
  const j = parseJson(r)
  assert.equal(g15(j).severity, 'N/A', '没传旗标仍是 N/A（模式开关只在调用方）：' + JSON.stringify(g15(j)))
  assert.equal(g15(j).evidence.qltMarker, 'on')
  assert.equal(g15(j).evidence.qltMarkerMismatch, true, '标记与旗标不一致须显式记录')
  assert.match(String(g15(j).skipReason), /QLT=on/, '须点名简报标了 on')
  assert.match(String(g15(j).skipReason), /没有被核对/, '须写明「本项没有被核对」——否则读者会当成「已核通过」')
  assert.equal(j.overall.na, 1)
  assert.equal(j.overall.skipped, 0, 'N/A 仍不得推高退出码')
  rmSync(d, { recursive: true, force: true })
})

test('g-audit-check G15：标记 `QLT=off` 但传了 `--qlt` → **旗标优先**照跑，并注明依据是调用方', () => {
  const { d, draft, brief, cards } = mkFixture({
    文献卡: '# 文献卡\n\n### [L01] X. T[J]. AJS, 1973, 78(6): 1360-1380. DOI: 10.1086/225469.\n',
    brief: '- **启用标记**：`QLT=off`\n- **篇幅**：**500 字**\n',
  })
  const r = run([G, draft, '--cards', cards, '--brief', brief, '--qlt'])
  const j = parseJson(r)
  assert.equal(g15(j).checked, true, '旗标是调用方的显式声明，优先于标记：' + JSON.stringify(g15(j)))
  assert.equal(g15(j).evidence.qltMarker, 'off')
  assert.match(String(g15(j).evidence.markerNote), /QLT=off/, '须注明「简报标 off，本项按调用方要求核对」')
  rmSync(d, { recursive: true, force: true })
})

test('g-audit-check G15：**标记不是散文标签**——简报写「卷期页码完整性：默认关闭」也不得被读成启用', () => {
  // 这条钉住 v18.41.0 那次实测（成组假阳性）在**标记层**的复现路径：标记必须逐字是 `QLT=on|off`。
  const { d, draft, brief, cards } = mkFixture({
    文献卡: '# 文献卡\n\n### [L01] X. T[J]. AJS, 1973, 78(6): 1360-1380.\n',
    brief: '- ☐ **APA 优先输出 + 卷期页码完整性**：默认关闭（保留 GB/T 7714-2015 为唯一引用格式）\n- **篇幅**：**500 字**\n',
  })
  const r = run([G, draft, '--cards', cards, '--brief', brief])
  const j = parseJson(r)
  assert.equal(g15(j).severity, 'N/A')
  assert.equal(g15(j).evidence.qltMarker, null, '散文标签不得被读成标记（这是 v18.41.0 的假阳性来源）')
  assert.equal(g15(j).evidence.qltMarkerMismatch, false, '无标记 → 不得产生「不一致」噪音（老简报不受影响）')
  assert.doesNotMatch(String(g15(j).skipReason), /QLT=/, '无标记时不得在文案里塞标记相关的话')
  rmSync(d, { recursive: true, force: true })
})
