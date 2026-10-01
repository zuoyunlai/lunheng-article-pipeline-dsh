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

test('真实 lib/index.js：门对当前实现判 0 错误（回归基线）', () => {
  const { regs, errors } = reconcileHostContract(REAL_SRC)
  assert.deepEqual(errors, [], `当前 lib/index.js 应通过宿主契约门：${errors.join(' | ')}`)
  assert.equal(regs.length, 3, '当前应注册 3 个监听器（H2/H4/H7）')
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
