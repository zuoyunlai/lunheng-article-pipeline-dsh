// --lite-profile 轻量快轨子集（v19.8.0 · 反哺报告 v9 D6-c）回归测试
//
// 锁两条：
//   · --lite-profile 只评估 M-Form-1/3/5/7 + M-Exist-2 五道，total = 5，exit 语义不变；
//   · 不带旗标时全量 25 项不变（快轨是独立入口，不替换全量档）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, mkProject } from './_fixtures.mjs'

const M = join(SCRIPTS, 'm-gate-check.mjs')
const DRAFT = '# 标题\n\n## 摘要\n\n摘要 [L01]。\n\n## 一、导论\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
const mk = () => {
  const { proj, fin, ev } = mkProject({})
  writeFileSync(join(fin, '定稿.md'), DRAFT)
  return { proj, fin, ev }
}
const runGate = (args) => {
  const rep = join(mk().proj, 'r.json')
  run([M, ...args, '--report', rep])
  return JSON.parse(readFileSync(rep, 'utf8'))
}

test('D6-c：--lite-profile 只评估 5 道快轨子集（total=5），gate 标签收窄', () => {
  const { proj, fin, ev } = mk()
  const rep = join(proj, 'r.json')
  run([M, join(fin, '定稿.md'), ev, '--lite-profile', '--report', rep])
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  assert.equal(j.total, 5, `快轨 total 应为 5，实测 ${j.total}`)
  const gates = (j.results || []).map((r) => (r.gate || '').split(' ')[0])
  assert.deepEqual(
    [...new Set(gates)].sort(),
    ['M-Exist-2', 'M-Form-1', 'M-Form-3', 'M-Form-5', 'M-Form-7'].sort(),
    '快轨 gate 集合应恰为五道',
  )
  assert.ok(!(j.results || []).some((r) => /M-Exist-12/.test(r.gate || '')), '快轨不含贡献陈述门')
})

test('D6-c：不带 --lite-profile 仍全量 25 项（快轨不替换全量档）', () => {
  const { proj, fin, ev } = mk()
  const rep = join(proj, 'r.json')
  run([M, join(fin, '定稿.md'), ev, '--report', rep])
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  assert.equal(j.total, 25, `全量档 total 仍为 25，实测 ${j.total}`)
})
