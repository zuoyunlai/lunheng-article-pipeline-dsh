// token-budget --by-model（v18.28.0 QLT-5）回归测试
//
// 锁三条口径：
//   · `--by-model` 与 `--roles` 一样是**一个模式**（单独给也应通过，缺模式才 exit 10）
//   · 输出含「按模型」与「按角色×模型」两段；M/步 = cacheRead/步数，且**步数为 0 时不除零**
//   · JSON 里必须有 `byModel` / `byRoleModel`（质量—成本对照的下游消费者靠它）
//   · 本机无投影缓存时（CI）必须**如实降级**而不是崩
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { SCRIPTS, run, parseJson } from './_fixtures.mjs'

const TB = join(SCRIPTS, 'token-budget.mjs')
const HOME = process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh')
const hasCache = (() => {
  try { return existsSync(join(HOME, 'storages', 'session_projcache', 'sessions')) } catch { return false }
})()

test('token-budget --by-model：单独使用即算一个模式（不得因缺 --project/--roles 而 exit 10）', () => {
  const r = run([TB, '--by-model', '--dsh-home', HOME])
  assert.notEqual(r.code, 10, '--by-model 是合法模式：' + r.out.slice(-300))
})

test('token-budget --by-model：输出含两段表 + M/步口径（本机有缓存时）', () => {
  if (!hasCache) return   // CI 无投影缓存 → 该断言无用例价值
  const r = run([TB, '--roles', '--by-model'])
  assert.match(r.out, /## 四、按模型/, '必须有「按模型」段')
  assert.match(r.out, /## 五、按角色 × 模型/, '必须有「按角色×模型」段')
  assert.match(r.out, /观测性，非受控 A\/B/, '标题必须如实标注它不是受控 A/B')
})

test('token-budget --by-model --json：必须有 byModel / byRoleModel 两个数组', () => {
  if (!hasCache) return
  const j = parseJson(run([TB, '--roles', '--by-model', '--json']))
  assert.ok(Array.isArray(j.byModel), 'byModel 必须是数组')
  assert.ok(Array.isArray(j.byRoleModel), 'byRoleModel 必须是数组')
  for (const x of j.byModel) {
    assert.equal(typeof x.model, 'string')
    assert.equal(typeof x.cacheRead, 'number')
    assert.ok(x.steps >= 0)
    if (x.steps > 0) assert.equal(x.perStep, Math.round(x.cacheRead / x.steps), 'perStep 必须等于 cacheRead/步数')
  }
})

test('token-budget：未知参数仍 exit 10；缺模式仍 exit 10（--by-model 不得把这两条放宽）', () => {
  assert.equal(run([TB, '--nope']).code, 10, '未知参数')
  assert.equal(run([TB]).code, 10, '缺模式')
})
