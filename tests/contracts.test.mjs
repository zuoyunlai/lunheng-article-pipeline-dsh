// 契约一致性（v19.8.0 · 反哺报告 v9 D6-a）回归测试
//
// 锁三条：
//   · 真包上 verifyContracts 零 issue（contracts.json ↔ 脚本字面量 ↔ SKILL.md 六要素/三要素）
//   · 篡改夹具：改掉某脚本源码里的退出码字面量 → 必须报「契约漂移」（验收判据 ①）
//   · contracts.json 缺键 / 缺文件 → 报漂移而非静默通过
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyContracts } from '../skills/lunheng-article-pipeline/scripts/_lib/contract-verify.mjs'
import { SCRIPTS } from './_fixtures.mjs'

const SKILL_ROOT = dirname(SCRIPTS)

test('D6-a：真包契约对账零 issue（contracts.json 为单一真源）', () => {
  const { issues } = verifyContracts(SCRIPTS, join(SKILL_ROOT, 'SKILL.md'), join(SKILL_ROOT, 'AGENTS.md'))
  assert.deepEqual(issues, [], '真包不得有契约漂移：' + issues.join('；'))
})

test('D6-a 验收判据①：篡改脚本的退出码字面量 → self-check 侧必报「契约漂移」', () => {
  const d = join(tmpdir(), 'lunheng-contracts-tamper-' + Date.now())
  mkdirSync(join(d, 'scripts', '_lib'), { recursive: true })
  mkdirSync(join(d, 'skill'), { recursive: true })
  // 契约真源照抄真包
  writeFileSync(join(d, 'scripts', '_lib', 'contracts.json'), readFileSync(join(SCRIPTS, '_lib', 'contracts.json')))
  // 篡改夹具：handoff-check 源码里把 21 全部改成 25（模拟「常量被改」）
  const hc = readFileSync(join(SCRIPTS, 'handoff-check.mjs'), 'utf8').replace(/(?<![\d.])21(?![\d.])/g, '25')
  writeFileSync(join(d, 'scripts', 'handoff-check.mjs'), hc)
  writeFileSync(join(d, 'scripts', 'm-gate-check.mjs'), readFileSync(join(SCRIPTS, 'm-gate-check.mjs')))
  writeFileSync(join(d, 'scripts', 'model-routing.mjs'), readFileSync(join(SCRIPTS, 'model-routing.mjs')))
  writeFileSync(join(d, 'skill', 'SKILL.md'), readFileSync(join(SKILL_ROOT, 'SKILL.md')))
  writeFileSync(join(d, 'skill', 'AGENTS.md'), readFileSync(join(SKILL_ROOT, 'AGENTS.md')))
  const { issues } = verifyContracts(join(d, 'scripts'), join(d, 'skill', 'SKILL.md'), join(d, 'skill', 'AGENTS.md'))
  assert.ok(issues.some((s) => /handoff-check\.mjs.*21.*契约漂移/.test(s)), '必须点名 handoff-check 的 21 漂移：' + issues.join('；'))
  rmSync(d, { recursive: true, force: true })
})

test('D6-a：contracts.json 缺失 → 报漂移而非静默通过', () => {
  const d = join(tmpdir(), 'lunheng-contracts-missing-' + Date.now())
  mkdirSync(join(d, '_lib'), { recursive: true })
  const { issues } = verifyContracts(d, join(d, 'SKILL.md'))
  assert.ok(issues.length === 1 && /contracts\.json 缺失或不可解析/.test(issues[0]), issues.join('；'))
  rmSync(d, { recursive: true, force: true })
})
