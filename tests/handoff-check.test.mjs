// handoff-check 交接门回归测试（v18.6.0 新增）
// 覆盖：A1 存在 / A2 0 字节 / A4 版本对齐（strict）/ A5 成对 / B1 回报六要素 / 参数错误 10 / 合格项目不误伤 0
// 规格真源：docs/审计与修订记录/交接门-handoff-check-规格-v1.md §9 验收判据（V2 证伪用例 + V3 不误伤）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
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

// v18.12.3（L-06，主人定案「N 跟审计轮次」）：本条**语义已翻转**——旧版这里断言「审计报告 v1 配初稿 v2 → exit 21」，
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

test('L-06 A4c 软：审计报告缺「被审正文」声明 → 软提示（不判硬，22 个既有项目都缺该字段）', () => {
  const d = makeProject()
  const j = parseJson(run([SCRIPT, '--project', d, '--role', 'T7', '--level', 'strict']))
  const s = j.soft.find((x) => x.check === 'A4c')
  assert.ok(s, '应给 A4c 软提示：' + JSON.stringify(j.soft))
  assert.match(s.detail, /被审正文/)
  assert.ok(!j.hard.some((x) => x.check === 'A4c'), 'A4c 缺声明不得判硬')
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
