// handoff-check 交接门回归测试（v18.6.0 新增）
// 覆盖：A1 存在 / A2 0 字节 / A4 版本对齐（strict）/ A5 成对 / B1 回报六要素 / 参数错误 10 / 合格项目不误伤 0
// 规格真源：docs/审计与修订记录/交接门-handoff-check-规格-v1.md §9 验收判据（V2 证伪用例 + V3 不误伤）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const SCRIPT = join(SCRIPTS, 'handoff-check.mjs')

// 最小合格项目：九角色必需产物齐备（初稿 v1）
function makeProject(extra = {}) {
  const d = tmp('handoff-')
  const mk = (rel) => mkdirSync(join(d, rel), { recursive: true })
  ;['literature', 'data', 'cases', 'analysis', 'drafts', 'audits'].forEach(mk)
  const w = (rel, content = '# 内容\n') => writeFileSync(join(d, rel), content)
  w('literature/文献卡.md', '## 📇 索引段\n[L01] 主题 ｜ 论点\n### [L01] 主题\n正文。\n')
  w('literature/先行者清单.md', '# 先行者清单\n[先01] 短标识\n')
  w('data/数据卡.md', '## 📇 索引段\n[D01] 主题 ｜ 论点\n### [D01] 主题\n正文。\n')
  w('cases/案例卡.md', '## 📇 索引段\n[C01] 主题 ｜ 论点\n### [C01] 主题\n正文。\n')
  w('analysis/分析大纲.md', '# 分析大纲\n## 核心论点\n正文。\n')
  w('analysis/素材加载清单.md', '# 素材加载清单\n## 已加载\n[D01]\n')
  w('drafts/初稿-v1.md', '# 初稿\n## 摘要\n正文。\n')
  w('analysis/批判报告-v1.md', '# 批判报告\n## C1\n正文。\n')
  w('audits/审计报告-v1.md', '# 审计报告\n## 结论\n通过。\n')
  w('audits/反哺报告-v1.md', '# 反哺报告\n## 问题\n正文。\n')
  w('audits/审稿报告-v1.md', '# 审稿报告\n## 总评分\n24/30。\n')
  w('audits/G14-检测报告-v1.md', '# G14 检测报告\n## 判定\n0 类。\n')
  w('agents-log.md', '### T1 执行记录\n开始\n### T1 执行记录\n结束\n')
  for (const [rel, content] of Object.entries(extra)) w(rel, content)
  return d
}

test('审计修订 P2：B 组必须按 4 个检查项入分母（旧版整组算 1 个单位）', () => {
  const d = makeProject()
  // 回报刻意缺 B1 六要素段与 B4 路径提及 → 两条硬失败
  const r = run([SCRIPT, '--project', d, '--role', 'T1', '--report', '本次检索已结束，结果稍后整理。'])
  const j = parseJson(r)
  const bFails = j.hard.filter((h) => /^B/.test(h.check))
  assert.ok(bFails.length >= 1, '夹具应至少命中一条 B 组失败：' + JSON.stringify(j.hard))
  // 分母侧：B 组贡献 4 项（旧版只贡献 1）——用「total − A 组产物数」反推 B 组贡献
  assert.equal(j.total, j.artifacts.length + 4,
    `B 组须按 4 个检查项入分母（B1 六要素/B2 披露/B3 行数/B4 路径）：total=${j.total} artifacts=${j.artifacts.length}`)
  // 分子侧同尺度：pass + 失败条数 == total
  assert.equal(j.pass + j.hardCount + j.softCount, j.total,
    `pass 与 total 必须同尺度：pass=${j.pass} hard=${j.hardCount} soft=${j.softCount} total=${j.total}`)
  assert.equal(typeof j.countingNote, 'string', '必须给出分母口径说明（免去猜 pass 的含义）')
  rmSync(d, { recursive: true, force: true })
})

test('V3 不误伤：T1 合格项目 → exit 0，产物逐项 exists', () => {
  const d = makeProject()
  const r = run([SCRIPT, '--project', d, '--role', 'T1'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const j = parseJson(r)
  assert.equal(j.exit, 0)
  assert.equal(j.hard.length, 0)
  assert.equal(j.artifacts.length, 2)
  assert.ok(j.artifacts.every((a) => a.exists))
  rmSync(d, { recursive: true, force: true })
})

test('V2① 产物 0 字节 → exit 20（A2 写盘前失败）', () => {
  const d = makeProject({ 'data/数据卡.md': '' })
  const r = run([SCRIPT, '--project', d, '--role', 'T2'])
  assert.equal(r.code, 20, r.out.slice(0, 300))
  assert.ok(parseJson(r).hard.some((h) => h.check === 'A2'))
  rmSync(d, { recursive: true, force: true })
})

test('V2② T7 缺反哺报告 → exit 20（A1 成对缺失）', () => {
  const d = makeProject()
  rmSync(join(d, 'audits/反哺报告-v1.md'))
  const r = run([SCRIPT, '--project', d, '--role', 'T7'])
  assert.equal(r.code, 20, r.out.slice(0, 300))
  assert.ok(parseJson(r).hard.some((h) => h.subject === '反哺报告'))
  rmSync(d, { recursive: true, force: true })
})

// v18.13.0（L-06，主人定案「N 跟审计轮次」）：本条**语义已翻转**——旧版这里断言「审计报告 v1 配初稿 v2 → exit 21」，
//   而新口径下 `审计报告-vN` 的 N = **T7 审计轮次**，与初稿的正文轮次**刻意解耦**（实测 22 个真实项目里
//   `审计报告-vN` 的 N 无一例外等于该项目的审计轮次，而它与初稿 N 的对应并不稳定：共锁审计 4 份而初稿缺 v3、
//   guannian 审计 1 份而初稿 3 份）。故本条改为**正向**断言：不再误报；并把「别拿上一版交差」交给 A4c 的指纹断言。
test('L-06 语义翻转：审计报告 v1 + 初稿 v2 → **不再**误报 A4（N 跟审计轮次）', () => {
  const d = makeProject({ 'drafts/初稿-v2.md': '# 初稿 v2\n## 摘要\n正文。\n' })
  const r = run([SCRIPT, '--project', d, '--role', 'T7', '--level', 'strict'])
  const j = parseJson(r)
  assert.ok(!j.hard.some((h) => h.check === 'A4'), 'A4 不得再因「报告版本≠初稿版本」报硬失败：' + JSON.stringify(j.hard))
  rmSync(d, { recursive: true, force: true })
})

test('L-06 A4b：审计 v2 与复核 v1 不同轮 → exit 21（同轮配对是硬要求）', () => {
  const d = makeProject({
    'audits/审计报告-v2.md': '# 审计报告\n被审正文：`drafts/初稿-v1.md`\n## 结论\n通过。\n',
    'audits/复核报告-v1.md': '# 复核报告\n## 逐条判定\n| 编号 | 判定 |\n|---|---|\n| P0-1 | 已关闭 |\n',
  })
  const r = run([SCRIPT, '--project', d, '--role', 'T7', '--level', 'strict'])
  assert.equal(r.code, 21, r.out.slice(0, 300))
  const h = parseJson(r).hard.find((x) => x.check === 'A4b')
  assert.ok(h, '应报 A4b 不同轮：' + r.out.slice(0, 400))
  assert.match(h.detail, /不同轮/)
  rmSync(d, { recursive: true, force: true })
})

test('L-06 A4b 对照：审计 v2 与复核 v2 同轮 → 不报 A4b', () => {
  const d = makeProject({
    'audits/审计报告-v2.md': '# 审计报告\n被审正文：`drafts/初稿-v1.md`\n## 结论\n通过。\n',
    'audits/复核报告-v2.md': '# 复核报告\n## 逐条判定\n| 编号 | 判定 |\n|---|---|\n| P0-1 | 已关闭 |\n',
  })
  const j = parseJson(run([SCRIPT, '--project', d, '--role', 'T7', '--level', 'strict']))
  assert.ok(!j.hard.some((x) => x.check === 'A4b'), '同轮不得报 A4b：' + JSON.stringify(j.hard))
  rmSync(d, { recursive: true, force: true })
})

test('L-06 A4c：审计报告缺「被审正文」声明 → **硬 21**（v18.36.0 主人裁定转硬；代价 = 22 份历史项目重跑会红，知情接受）', () => {
  const d = makeProject()
  const r = run([SCRIPT, '--project', d, '--role', 'T7', '--level', 'strict'])
  const j = parseJson(r)
  const h = j.hard.find((x) => x.check === 'A4c' && /被审正文/.test(x.detail))
  assert.ok(h, '缺声明必须判硬：' + JSON.stringify({ hard: j.hard, soft: j.soft }))
  assert.match(h.detail, /被审正文/)
  assert.match(h.detail, /审计报告-template\.md/, '硬失败必须指出闭合路径（照模板产出 / 补一行声明）')
  assert.equal(r.code, 21, 'A4c ② 转硬后必须走 21（结构不合 → 续接补交）')
  assert.ok(!j.soft.some((x) => x.check === 'A4c'), '同一档不得既硬又软（会把「补交」读成「可放行」）')
  rmSync(d, { recursive: true, force: true })
})

// ── L-08 人在环四门（--require-gates）─────────────────────────────────────────
const GATE_6 = '### 6. 主人回复（必填）\n\n'
  + '- **主人原话**：同意\n- **回复时间**：2026-09-25\n- **提问方式**：ask_user_question\n'
  + '- **主控落盘结论**：通过，进入下一阶段\n- **轮次计数**：首轮\n'
const FOUR_GATES = () => ({
  '阶段确认-Phase0.md': `# 确认单\n\n${GATE_6}`,
  '阶段确认-Phase2.5.md': `# 确认单\n\n${GATE_6}`,
  '阶段确认-Phase3.5.md': `# 确认单\n\n${GATE_6}`,
  '阶段确认-Phase5.md': `# 确认单\n\n${GATE_6}`,
})

test('L-08：不加 --require-gates → 不判四门（向后兼容中期角色收报）', () => {
  const d = makeProject()
  const j = parseJson(run([SCRIPT, '--project', d, '--role', 'T8']))
  assert.ok(!j.hard.some((x) => x.check === 'A7'), '默认不得判四门：' + JSON.stringify(j.hard))
  rmSync(d, { recursive: true, force: true })
})

test('L-08：--require-gates 且四门齐备 + §6 已回填 → 无 A7 硬项', () => {
  const d = makeProject(FOUR_GATES())
  const j = parseJson(run([SCRIPT, '--project', d, '--role', 'T8', '--require-gates']))
  assert.ok(!j.hard.some((x) => x.check === 'A7'), '四门齐备不得报 A7：' + JSON.stringify(j.hard))
  rmSync(d, { recursive: true, force: true })
})

test('L-08：缺门 → exit 20 且点名缺哪几份', () => {
  const g = FOUR_GATES(); delete g['阶段确认-Phase3.5.md']; delete g['阶段确认-Phase5.md']
  const d = makeProject(g)
  const r = run([SCRIPT, '--project', d, '--role', 'T8', '--require-gates'])
  assert.equal(r.code, 20, r.out.slice(0, 300))
  const h = parseJson(r).hard.find((x) => x.check === 'A7' && x.subject === '人在环四门')
  assert.ok(h, '应报四门不全：' + r.out.slice(0, 400))
  assert.match(h.detail, /Phase3\.5/)
  assert.match(h.detail, /Phase5/)
  rmSync(d, { recursive: true, force: true })
})

test('L-08：§6 未回填（空模板 + 占位符）→ exit 21 且点名缺字段', () => {
  const g = FOUR_GATES()
  g['阶段确认-Phase2.5.md'] = '# 确认单\n\n### 6. 主人回复\n\n- **主人原话**：<待回填>\n'
  const d = makeProject(g)
  const r = run([SCRIPT, '--project', d, '--role', 'T8', '--require-gates'])
  assert.equal(r.code, 21, r.out.slice(0, 300))
  const hs = parseJson(r).hard.filter((x) => x.check === 'A7' && x.subject === '阶段确认-Phase2.5.md')
  assert.ok(hs.some((x) => /回填不全/.test(x.detail)), '应点名字段缺失：' + JSON.stringify(hs))
  assert.ok(hs.some((x) => /占位符/.test(x.detail)), '应报占位符残留：' + JSON.stringify(hs))
  rmSync(d, { recursive: true, force: true })
})

test('L-08：缺 §6 段整段 → exit 21', () => {
  const g = FOUR_GATES()
  g['阶段确认-Phase0.md'] = '# 确认单\n\n### 5. 主人决策\n\n- [x] 同意\n'
  const d = makeProject(g)
  const r = run([SCRIPT, '--project', d, '--role', 'T8', '--require-gates'])
  assert.equal(r.code, 21, r.out.slice(0, 300))
  assert.ok(parseJson(r).hard.some((x) => x.check === 'A7' && /缺「### 6\. 主人回复」段/.test(x.detail)))
  rmSync(d, { recursive: true, force: true })
})

test('V2④ 回报缺「已知问题」段 → exit 21（B1 六要素）', () => {
  const d = makeProject()
  const report = '做了什么：检索文献。\n产物在哪：literature/文献卡.md、literature/先行者清单.md\n怎么验证：grep 计数。\n下一步：无。\n状态机更新：Done。'
  const r = run([SCRIPT, '--project', d, '--role', 'T1', '--report', report])
  assert.equal(r.code, 21, r.out.slice(0, 300))
  const j = parseJson(r)
  assert.ok(j.report.sectionsMissing.includes('已知问题'))
  assert.ok(j.hard.some((h) => h.check === 'B1'))
  rmSync(d, { recursive: true, force: true })
})

test('B4：回报未提及实际落盘产物 → exit 21（路径不匹配）', () => {
  const d = makeProject()
  const report = '做了什么：检索文献。\n产物在哪：literature/文献卡.md\n怎么验证：grep。\n已知问题：无。\n下一步：无。\n状态机更新：Done。'
  const r = run([SCRIPT, '--project', d, '--role', 'T1', '--report', report])
  assert.equal(r.code, 21, r.out.slice(0, 300))
  assert.ok(parseJson(r).report.pathMismatch.length > 0, '回报漏了先行者清单.md 路径')
  rmSync(d, { recursive: true, force: true })
})

test('参数错误：缺 --role / 非法 --role / 项目不存在 → exit 10', () => {
  const d = makeProject()
  assert.equal(run([SCRIPT, '--project', d]).code, 10)
  assert.equal(run([SCRIPT, '--project', d, '--role', 'T99']).code, 10)
  assert.equal(run([SCRIPT, '--project', join(d, '不存在'), '--role', 'T1']).code, 10)
  assert.equal(run([SCRIPT, '--project', d, '--role', 'T1', '--level', 'bogus']).code, 10)
  rmSync(d, { recursive: true, force: true })
})

// ── v18.22.3 EFF-3：A8 复核报告「已读范围」声明（**v18.39.0 两档全硬**）──────────────────────
// 分档沿革：v18.22.3 先判软（存量 6 份全缺该节）→ v18.33.0 **半收**（「有节但空」转硬：实测存量
//   0/6 落此档、收紧零牵连）+ 把「完全缺节」档的触发条件写死、并补 `templates/复核报告-template.md`
//   让条件可达 → **v18.39.0 主人裁定「A8」，直接转硬**（不等那个可观测事件）。
//   **已知代价（有意）**：`run/**` 下 6 份历史项目重跑本门会红——主人知情并接受；闭合极轻（补一节）。
test('A8 缺「已读范围」→ **硬 21**（v18.39.0 主人裁定转硬；代价 = 6 份历史项目重跑会红）', () => {
  // ⚠️ fixture 必须自带 A4c 的 `被审正文:` 声明——否则 A4c ②（v18.36.0 起判硬）会一起报，
  //   断言就分不清是哪条门红的。判据：**测一条规则的行为时，fixture 要让相邻规则保持安静**。
  const d = makeProject({
    'audits/审计报告-v1.md': '# 审计报告\n\n> 被审正文：`drafts/初稿-v1.md`\n\n## 逐条判定\n| 编号 | 判定 |\n|---|---|\n| P0-1 | 已关闭 |\n',
    'audits/复核报告-v1.md': '# 复核报告\n## 逐条判定\n| 编号 | 判定 |\n|---|---|\n| P0-1 | 已关闭 |\n',
  })
  const r = run([SCRIPT, '--project', d, '--role', 'T7', '--level', 'strict'])
  const j = parseJson(r)
  const h = j.hard.find((x) => x.check === 'A8')
  assert.ok(h, '缺「已读范围」必须判硬：' + JSON.stringify({ hard: j.hard, soft: j.soft }))
  assert.match(h.detail, /已读范围/)
  assert.match(h.detail, /复核报告-template\.md/, '硬失败必须指出闭合路径（照模板产出 / 补一节）')
  assert.equal(r.code, 21, 'A8 全硬后必须走 21')
  assert.ok(!j.soft.some((x) => x.check === 'A8'), '同一档不得既硬又软')
  assert.ok(!j.hard.some((x) => x.check === 'A4c'), 'fixture 应让 A4c 保持安静：' + JSON.stringify(j.hard))
  rmSync(d, { recursive: true, force: true })
})

test('A8 有「已读范围」+ 内容 → 不报', () => {
  const d = makeProject({
    'audits/复核报告-v1.md': '# 复核报告\n## 已读范围\n- `drafts/修订说明-v1.md`；被审正文 §3.2、§5.1；未读其他节。\n\n## 逐条判定\n| 编号 | 判定 |\n|---|---|\n| P0-1 | 已关闭 |\n',
  })
  const j = parseJson(run([SCRIPT, '--project', d, '--role', 'T7', '--level', 'strict']))
  assert.ok(!j.soft.some((x) => x.check === 'A8'), '有声明不得再报 A8：' + JSON.stringify(j.soft))
  assert.ok(!j.hard.some((x) => x.check === 'A8'))
  rmSync(d, { recursive: true, force: true })
})

test('A8 只有标签没有内容 → 判硬 21（v18.33.0：本档由软转硬）', () => {
  const d = makeProject({
    'audits/复核报告-v1.md': '# 复核报告\n## 已读范围\n\n## 逐条判定\n| 编号 | 判定 |\n|---|---|\n| P0-1 | 已关闭 |\n',
  })
  const r = run([SCRIPT, '--project', d, '--role', 'T7', '--level', 'strict'])
  const j = parseJson(r)
  const a8 = j.hard.find((x) => x.check === 'A8')
  assert.ok(a8, '空声明必须判硬：' + JSON.stringify({ hard: j.hard, soft: j.soft }))
  assert.match(a8.detail, /为空/)
  assert.equal(r.code, 21, '空声明这一档必须走 21（结构不合 → 续接补交）')
  assert.ok(!j.soft.some((x) => x.check === 'A8'), '同一档不得既硬又软（会把「补交」读成「可放行」）')
  rmSync(d, { recursive: true, force: true })
})

// v18.33.0 断链回归：A8 的锚点由「散文约定」变成「模板产物」后，**模板与门必须始终同源**——
//   模板改了节标题（比如写成「## 读取范围」）而门还认「已读范围」，结果是**照模板填也过不了门**，
//   且这个断裂在文档里看不出来（两边各自都「对」）。本用例把三处钉在一起：
//   ① 模板里必须有门认的锚点；② 07 卡与派发话术都要指向模板；③ **把模板原样当复核报告喂给门 → A8 不得报**。
test('A8 断链回归：模板含门认的锚点、两份文档指向它，且模板自身必须过 A8', () => {
  const SKILL = join(SCRIPTS, '..')
  const TPL = join(SKILL, 'references', 'templates', '复核报告-template.md')
  const tpl = readFileSync(TPL, 'utf8')

  // ① 锚点在场（与 handoff-check.mjs 的正则逐字同形）
  assert.match(tpl, /(?:^#{2,4}\s*已读范围)|(?:^\s*[-*]?\s*\*\*已读范围\*\*)/m, '模板缺少 A8 认的「已读范围」节标题')
  for (const f of ['references/agents/07-审计-auditor.md', 'references/pipeline-readme.md']) {
    const t = readFileSync(join(SKILL, f), 'utf8')
    assert.match(t, /复核报告-template\.md/, `${f} 必须指向复核报告模板（否则模板存在也没人用）`)
  }

  // ② 端到端：模板原样当复核报告 → A8 不得报（「照模板填即满足机检」这句话必须是真的）
  const d = makeProject({ 'audits/复核报告-v1.md': tpl })
  const r = run([SCRIPT, '--project', d, '--role', 'T7', '--level', 'strict'])
  const j = parseJson(r)
  assert.ok(!j.soft.some((x) => x.check === 'A8'), '模板自身不该触发 A8 软提示：' + JSON.stringify(j.soft))
  assert.ok(!j.hard.some((x) => x.check === 'A8'), '模板自身不该触发 A8 硬失败：' + JSON.stringify(j.hard))
  rmSync(d, { recursive: true, force: true })
})

// ── v18.34.0 起：A4c ②「被审正文:」—— **v18.36.0 按主人裁定由软转硬** ─────────────────────
// 沿革：v18.12.2 判软（存量 22/22 无该字段）→ v18.34.0 写死触发条件 + 补模板让条件可达 →
//   **v18.36.0 主人直接裁定转硬**（原话「4c ② 拦」），不等那个可观测事件；代价 = `run/**` 下
//   22 份历史项目重跑本门会红，**主人知情并接受**。判据：该字段自 v18.12.2 起即规范要求，
//   缺声明 = 报告不合规；且修复极轻（补一行声明）。
// 两条分支都判硬：① 缺声明；② 声明指向的文件不在盘（后者存量 0 份，更无牵连）。
test('A4c ② 两条分支都判硬：缺声明 / 声明指向不在盘 → 均 exit 21', () => {
  // ① 缺声明
  const d1 = makeProject({ 'audits/审计报告-v1.md': '# 审计报告\n## 结论\n通过。\n' })
  let r = run([SCRIPT, '--project', d1, '--role', 'T7', '--level', 'strict'])
  assert.ok(parseJson(r).hard.some((x) => x.check === 'A4c' && /被审正文/.test(x.detail)), '缺声明应判硬')
  assert.equal(r.code, 21, '缺声明 → 21')
  rmSync(d1, { recursive: true, force: true })

  // ② 有声明但指向的文件不在盘（声明与实际不符 → 更硬的信号）
  const d2 = makeProject({ 'audits/审计报告-v1.md': '# 审计报告\n\n> 被审正文：`drafts/初稿-v9.md`\n\n## 结论\n通过。\n' })
  r = run([SCRIPT, '--project', d2, '--role', 'T7', '--level', 'strict'])
  const h2 = parseJson(r).hard.find((x) => x.check === 'A4c' && /不在盘/.test(x.detail))
  assert.ok(h2, '声明指向不在盘应判硬：' + r.out.slice(0, 400))
  assert.equal(r.code, 21, '指向不在盘 → 21')
  rmSync(d2, { recursive: true, force: true })
})

test('A4c ② 断链回归：模板含门认的锚点形状、两份文档指向它，且**照模板填**后门不报', () => {
  const SKILL = join(SCRIPTS, '..')
  const TPL = join(SKILL, 'references', 'templates', '审计报告-template.md')
  const tpl = readFileSync(TPL, 'utf8')

  // ① 模板的声明行必须是**门能认的形状**（否则填了真路径也匹配不上）。
  //    ⚠️ 必须与门的正则逐字同形——模板第一版写的是加粗 `**被审正文**：`，而门当时的正则要求冒号紧跟词后
  //    → **照模板填也匹配不上**。这正是本用例要挡的断裂（同规则 ⑫ 在 v18.2.4 修过的形态）。
  assert.match(tpl, /\*{0,2}被审正文\*{0,2}\s*[：:]\s*`?[^\s`|，。]*\.md/, '模板缺少 A4c 认的「被审正文: …md」声明行')
  // ② 模板必须带 G0-G14 十五行骨架（M-Exist-9 的锚点）
  const gRows = [...tpl.matchAll(/^\|\s*G\d+(?:\.\d+|-\d)?\s*\|/gm)].map((m) => m[0])
  assert.ok(gRows.length >= 15, `模板 G 骨架不足 15 行（实测 ${gRows.length}）——照模板填会漏项`)
  for (const f of ['references/agents/07-审计-auditor.md', 'references/pipeline-readme.md']) {
    assert.match(readFileSync(join(SKILL, f), 'utf8'), /审计报告-template\.md/, `${f} 必须指向审计报告模板`)
  }

  // ③ 「照模板填」= 把声明行的槽位换成真实路径 → 门不得再报 A4c 的声明缺项
  const filled = tpl.replace(/被审正文\*\*：[^\n]*/, '被审正文**：`drafts/初稿-v1.md`　｜　**审计时间**：2026-09-27')
  const d = makeProject({ 'audits/审计报告-v1.md': filled })
  const j = parseJson(run([SCRIPT, '--project', d, '--role', 'T7', '--level', 'strict']))
  assert.ok(
    !j.soft.some((x) => x.check === 'A4c' && /被审正文/.test(x.detail)),
    '照模板填了真实路径后不该再报 A4c ②：' + JSON.stringify(j.soft),
  )
  rmSync(d, { recursive: true, force: true })
})
