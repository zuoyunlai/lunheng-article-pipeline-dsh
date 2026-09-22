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

test('V2③ strict：报告版本 ≠ 被审正文 → exit 21（A4 禁 v{N-1}）', () => {
  const d = makeProject({ 'drafts/初稿-v2.md': '# 初稿 v2\n## 摘要\n正文。\n' })
  const r = run([SCRIPT, '--project', d, '--role', 'T7', '--level', 'strict'])
  assert.equal(r.code, 21, r.out.slice(0, 300))
  assert.ok(parseJson(r).hard.some((h) => h.check === 'A4'))
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
