// g-audit-check（G 项机检门）回归测试（v18.23.0 EFF-1 新增）
//
// 本套用例的每一组都对应一次**实测校准**（21 个真实项目横扫暴露的假阳性/假阴性），
// 目的就是让这些校准**不能再被无声改回去**：
//   · G8 只判候选、绝不判 P0（实测有项目简报 16k / 定稿 40k + 交付说明记「主人已确认字数不作硬规定」）
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

test('g-audit-check G8：**越限只判候选 P2，绝不判 P0**（实测有项目已获主人字数豁免）', () => {
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

test('cite-coverage-check C-Redundancy：同段 ≥4 篇引用且无差异词 → **必须报 P1**（v18.23.0 假绿修复）', () => {
  const d = tmp()
  const refs = ['[L01] a', '[L02] b', '[L03] c', '[L04] d', '[L05] e'].join('\n')
  const build = (body) => {
    const f = join(d, `p${Math.abs(body.length)}.md`)
    writeFileSync(f, `# 标题\n\n## 摘要\n\n正文若干。\n\n## 一、导论\n\n${body}\n\n## 参考文献\n\n${refs}\n`)
    return f
  }
  const cc = join(SCRIPTS, 'cite-coverage-check.mjs')

  // 假绿复现点：`refRegex` 无捕获组，旧代码 `L${x[1]}` 恒为 "Lundefined" → uniqueRefs 恒 1 → 永不触发
  const bad = parseJson(run([cc, build('有学者认为甲。[L01][L02][L03][L04][L05]')]))
  assert.equal(bad.checks['C-Redundancy'].pass, false, '同段 5 篇不同引用且无差异词必须报（修复前恒 pass=true）')
  assert.equal(bad.checks['C-Redundancy'].severity, 'P1')
  assert.equal(bad.checks['C-Redundancy'].violations[0].refsCount, 5, '引用计数必须是 5（而非 1）：' + JSON.stringify(bad.checks['C-Redundancy'].violations))

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
  assert.equal(parseTargetChars('- **篇幅**：**16000 字**（≥5000 全量流水线档）').value, 16000, '粗体「**篇幅**：」必须能解析（旧版返回 null → G5 阻塞线静默跳过）')
  assert.deepEqual(c('- **篇幅**：**16000 字**（≥5000 全量流水线档）'), [5000, 16000], '档位下限 5000 与目标 16000 **都进候选**（判据是「落在候选区间内」，故 5000–16000 之间都算合规）')

  // ② 「篇幅与结构」标题抢先命中 → 旧版只取首个命中 → 假 SKIP
  assert.deepEqual(c('## 三、篇幅与结构\n\n- **总字数**：6000 字（±5%，容差 5700-6300）'), [5700, 6000, 6300], '须跳过没有数字的标题命中，取真正字段行（候选按升序）')

  // ③ 区间 / 表格形态
  assert.deepEqual(c('- **篇幅**：3000-5000 字（标准档）'), [3000, 5000])
  assert.deepEqual(c('| 篇幅 | 约 8000 字（中文） |'), [8000], '表格形态（无冒号）也要能解析')

  // ④ 单值版行为不变（G5 阻塞线依赖它）
  assert.equal(parseTargetChars('- **篇幅**：1.2 万 字').value, 12000, '数量级单位照旧')
})
