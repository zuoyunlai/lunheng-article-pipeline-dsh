// 宿主契约门（repo-hygiene-check ⑮）回归网（v18.62.1 全量审计 P2-2）
//
// 为什么需要：v18.61.0 的 H2 监听器写成 4 参 `(tool, args, result, next)`、宿主是 3 参 waterfall，
//   但 600 个用例全绿——因为**自建桩测试照着实现写**（把 4 个实参喂给 4 参函数），桩与实现共错。
//   本文件测的是 `_lib/host-contract.mjs`（静态解析 + 契约比对），用**反事实源码**证明：
//   门能真的报出 P0-1（形参多）/ P1-2（形参少）/ P1-1（事件名不在宿主），而不是恒绿。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  HOST_CONTRACT,
  parseCtxOnRegistrations,
  reconcileHostContract,
} from '../scripts/_lib/host-contract.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REAL_SRC = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')

const GOOD_SRC = `
ctx.on('tools/post-execute', async (exec, result, next) => { return next() })
ctx.on('agent/request', (request, next) => { return next() })
ctx.on('system-prompt/assemble', async (assembly, _context, next) => { return next() })
`

test('契约表：三个宿主事件的真源与实参个数', () => {
  assert.deepEqual(HOST_CONTRACT['tools/post-execute'].params, ['exec', 'result', 'next'])
  assert.equal(HOST_CONTRACT['tools/post-execute'].arity, 3)
  assert.deepEqual(HOST_CONTRACT['system-prompt/assemble'].params, ['assembly', 'context', 'next'])
  assert.equal(HOST_CONTRACT['system-prompt/assemble'].arity, 3)
  assert.deepEqual(HOST_CONTRACT['agent/request'].params, ['payload', 'next'])
  assert.equal(HOST_CONTRACT['agent/request'].arity, 2)
})

test('解析：正确提取事件名 + 形参个数', () => {
  const { regs, totalCtxOn } = parseCtxOnRegistrations(GOOD_SRC)
  assert.equal(totalCtxOn, 3)
  assert.equal(regs.length, 3)
  assert.deepEqual(regs.map((r) => [r.event, r.arity]), [
    ['tools/post-execute', 3],
    ['agent/request', 2],
    ['system-prompt/assemble', 3],
  ])
})

test('真实 lib/index.js：门对当前实现判 0 错误（回归基线 · v18.76.0）', () => {
  const { regs, errors } = reconcileHostContract(REAL_SRC)
  assert.deepEqual(errors, [], `当前 lib/index.js 应通过宿主契约门：${errors.join(' | ')}`)
  // v18.76.0：H7 `agent/request` 监听器已按 v18.75.1 全量架构审计 R2 移除 → 本仓当前应注册 2 个监听器（H2 + H4）。
  assert.equal(regs.length, 2, `当前应注册 2 个监听器（H2 + H4）；如本仓再次添加 H7，需同步在 host-contract 表里保留其行：${regs.map((r) => r.event).join(', ')}`)
})

test('契约表 v18.76.0 完备性：每条都带 `since`（semver）与 `host`（非空），`agent/request` 还带 `payloadKeys`', () => {
  // v18.75.1 审计 R3：缺 `since` 即门红——它防的是「落在 peer 区间下限的用户遇到事件根本没有派发方而
  //   静默死监听」这一类；没有 `since` 就无法判断「这个事件在用户的宿主版本上是否存在」。
  // `payloadKeys` 是 agent/request 派发形态的**机械事实**，本仓不再注册该监听器但契约记录保留——
  //   `host-contract-probe` 用它持续守「payload 键集合」。
  const SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[0-9A-Za-z][0-9A-Za-z.]*)?$/
  for (const [event, c] of Object.entries(HOST_CONTRACT)) {
    assert.ok(typeof c.since === 'string' && SEMVER.test(c.since), `${event} 缺合法 since（应为 semver）：${String(c.since)}`)
    assert.ok(typeof c.host === 'string' && c.host.length > 0, `${event} 缺 host 字段（无从回查真源）`)
  }
  assert.deepEqual(HOST_CONTRACT['agent/request'].payloadKeys, ['turn', 'step', 'signal'], '`agent/request` 的 payload 键集合必须 == [turn, step, signal]（与 host-contract-probe 一致）')
})

test('HOST_DISPATCH 子串与 `agent/request` 的 payloadKeys 同步（v18.76.0 一处事实）', async () => {
  // 防止「表项的 payloadKeys 与 HOST_DISPATCH 子串两边各写一份、改了一边忘另一边」——
  // 任何一边漂移都立即红。
  const { HOST_DISPATCH } = await import('../scripts/_lib/host-contract.mjs')
  const normalized = String(HOST_DISPATCH['agent/request']).replace(/\s+/g, ' ')
  const keys = HOST_CONTRACT['agent/request'].payloadKeys
  for (const k of keys) {
    assert.ok(normalized.includes(`{ ${k}`) || normalized.includes(`${k},`) || normalized.includes(`${k} `) || normalized.includes(`${k}`),
      `HOST_DISPATCH['agent/request'] 子串里必须含 payloadKey 「${k}」——payload 键集合必须派生自同一事实：${HOST_DISPATCH['agent/request']}`)
  }
})

test('反事实 P0-1：tools/post-execute 写成 4 参 → 门必须报错', () => {
  const bad = `
ctx.on('tools/post-execute', async (tool, args, result, next) => { return next() })
ctx.on('agent/request', (request, next) => { return next() })
ctx.on('system-prompt/assemble', async (assembly, _context, next) => { return next() })
`
  const { errors } = reconcileHostContract(bad)
  assert.ok(errors.some((e) => e.includes('tools/post-execute') && e.includes('形参 4 个')), `应报 4 参错位，实际 ${errors.join(' | ')}`)
})

test('反事实 P1-2：system-prompt/assemble 写成 2 参 → 门必须报错', () => {
  const bad = `
ctx.on('tools/post-execute', async (exec, result, next) => { return next() })
ctx.on('agent/request', (request, next) => { return next() })
ctx.on('system-prompt/assemble', (assembly, next) => { return next() })
`
  const { errors } = reconcileHostContract(bad)
  assert.ok(errors.some((e) => e.includes('system-prompt/assemble') && e.includes('形参 2 个')), `应报 2 参错位，实际 ${errors.join(' | ')}`)
})

test('反事实 P1-1：注册宿主不存在的死事件 → 门必须报错', () => {
  const bad = `
ctx.on('tools/post-execute', async (exec, result, next) => { return next() })
ctx.on('agent/request', (request, next) => { return next() })
ctx.on('system-prompt/assemble', async (assembly, _context, next) => { return next() })
ctx.on('file-watcher:change', (changedPath) => {})
`
  const { errors } = reconcileHostContract(bad)
  assert.ok(errors.some((e) => e.includes('file-watcher:change') && e.includes('不在宿主契约表')), `应报死事件，实际 ${errors.join(' | ')}`)
})

test('退化防线：非箭头函数监听器 → 门必须报解析退化（fail-closed）', () => {
  const bad = `
ctx.on('tools/post-execute', function (exec, result, next) { return next() })
`
  const { errors } = reconcileHostContract(bad)
  assert.ok(errors.some((e) => e.includes('解析退化')), `非箭头函数应触发退化防线，实际 ${errors.join(' | ')}`)
})

test('退化防线：零监听器 → 门必须报空跑（fail-closed）', () => {
  const { errors } = reconcileHostContract('// 没有任何 ctx.on 注册\n')
  assert.ok(errors.some((e) => e.includes('未解析出任何')), `零监听器应报空跑，实际 ${errors.join(' | ')}`)
})
