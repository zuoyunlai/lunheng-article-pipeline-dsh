// H4 + H7 集成测试（v18.61.0 反哺 v4 落地；v18.62.1 全量审计 P1-2 修复 H4 + P1-1 移除 H3）
//
// 验证 lib/index.js 的两个新增 ctx.on 监听器：
//   · H4 `system-prompt/assemble` 钩子（**只追加不覆盖** — 3 参 waterfall）
//   · H7 `agent/request` waterfall 模型路由（按 LUNHENG_* env 覆盖 provider/model）
//   H3 `assistant/chunk` 监听器已按 v18.62.1 全量审计 P1-1 移除（session 日志事件、无 ctx 派发方），不再测。
//
// 做法沿用 tests/h2-h5-listeners.test.mjs 同款：直接 import apply + 真 fire。
// H4 关键差异（v18.62.1 修复前 vs 后）：修复前 2 参 `(prompt, next)` 不调 next()，把下游链（含模型选择）静默
//   截断；修复后 3 参 `(assembly, context, next)`，`await next()` 拿到装配结果再向 sections 追加论衡段。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const INDEX_MOD = join(PACKAGE_ROOT, 'lib', 'index.js')

function makeCordaxLikeCtx() {
  const listeners = Object.create(null)
  const effectDisposers = []
  const ctx = {
    get: (n) => ({
      tools: { register: () => [], guard: () => undefined },
      commands: { register: () => () => {} },
      skills: { register: () => () => {} },
    })[n],
    on: (event, listener) => {
      ;(listeners[event] ??= []).push(listener)
      return () => {}
    },
    effect: (fn) => {
      const result = fn()
      if (result && typeof result.then === 'function') {
        result.then((d) => effectDisposers.push(d)).catch(() => {})
      } else if (typeof result === 'function') {
        effectDisposers.push(result)
      }
      return () => {}
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }
  return { ctx, listeners }
}

async function fire(ctx, listeners, event, ...args) {
  const arr = listeners[event] || []
  const results = []
  for (const fn of arr) {
    try {
      const r = await fn(...args)
      results.push(r)
    } catch (e) { results.push({ __err: String(e?.message || e) }) }
  }
  return results
}

test('H4 契约：listener 形参个数 = 3（assembly, context, next）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['system-prompt/assemble'] || []
  assert.ok(handlers.length >= 1, 'H4 监听器未注册到 ctx.on(system-prompt/assemble)')
  assert.equal(
    handlers[0].length,
    3,
    'H4 监听器必须是 3 参 (assembly, context, next)——2 参会参数错位并截断下游链（含模型选择）',
  )
})

test('H4 system-prompt 钩子：await next() 后向 sections 追加论衡段，不覆盖下游', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['system-prompt/assemble'] || []
  assert.ok(handlers.length >= 1, 'H4 监听器未注册')

  // 宿主真实装配结果形状（dsh-system-prompt assemble 返回）：sections/contexts/tools/variables
  const assembly = {
    sections: [{ name: 'persona', text: '你是一个 AI 助手...' }],
    contexts: [],
    tools: [],
    variables: { provider: 'deepseek', model: 'deepseek-chat' },
  }
  let downstreamRan = false
  const next = async () => {
    downstreamRan = true
    return assembly
  }

  const result = await handlers[0](assembly, { agent: {} }, next)

  assert.ok(downstreamRan, 'H4 必须调用 next() 驱动下游链——不调会截断模型选择等下游监听器')
  assert.ok(result && typeof result === 'object', 'H4 应返回装配结果对象')
  assert.ok(Array.isArray(result.sections), 'result.sections 必须是数组')
  assert.equal(result.sections.length, assembly.sections.length + 1, '应在原有 sections 基础上追加 1 段')
  assert.equal(result.sections[0].text, '你是一个 AI 助手...', '原有 persona 段必须保留（不覆盖）')
  assert.equal(result.sections[1].name, 'lunheng', '追加段的 name 应为 lunheng')
  assert.ok(result.sections[1].text.includes('lunheng-article-pipeline'), '追加段应包含论衡技能提示')
  // 下游写入的其它字段（如 variables 里的模型选择）必须保留
  assert.deepEqual(result.variables, assembly.variables, '下游写入的 variables（模型选择）必须原样保留')
})

test('H4 system-prompt 钩子：next() 返回无 sections 的对象也安全追加', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['system-prompt/assemble'] || []
  const result = await handlers[0](
    { variables: {} },
    {},
    async () => ({ variables: { model: 'x' } }),
  )
  assert.ok(Array.isArray(result.sections), '无 sections 时也应得到数组')
  assert.equal(result.sections.length, 1, '应追加 1 段论衡段')
  assert.equal(result.sections[0].name, 'lunheng', '追加段 name = lunheng')
  assert.deepEqual(result.variables, { model: 'x' }, '下游字段保留')
})

test('H7 agent.request waterfall：subagent_retrieval + LUNHENG_RETRIEVAL_MODEL → 覆盖', async () => {
  // **必须清理**两个 env 变量：测试用例不清理的话，listener 会读真实 process.env（如主人工作时的
  // LUNHENG_RETRIEVAL_PROVIDER=minimax-cn-openai），导致断言失败。这是测试卫生，不是 listener bug。
  const ORIG_P = process.env.LUNHENG_RETRIEVAL_PROVIDER
  const ORIG_M = process.env.LUNHENG_RETRIEVAL_MODEL
  delete process.env.LUNHENG_RETRIEVAL_PROVIDER
  process.env.LUNHENG_RETRIEVAL_MODEL = 'test-model-retrieval'
  try {
    const { ctx, listeners } = makeCordaxLikeCtx()
    const mod = await import(pathToFileURL(INDEX_MOD).href)
    mod.apply(ctx, {})
    await new Promise((r) => setTimeout(r, 50))

    const handlers = listeners['agent/request'] || []
    assert.ok(handlers.length >= 1, 'H7 监听器未注册到 ctx.on(agent/request)')

    const request = { toolName: 'subagent_retrieval', provider: 'original-provider', model: 'original-model' }
    const result = handlers[0](request, () => {})
    assert.ok(result && result.model === 'test-model-retrieval', `model 应被 env 覆盖，实际 ${JSON.stringify(result)}`)
    assert.equal(result.provider, 'original-provider', '未设 provider env → 保留原值')
  } finally {
    if (ORIG_P !== undefined) process.env.LUNHENG_RETRIEVAL_PROVIDER = ORIG_P
    if (ORIG_M !== undefined) process.env.LUNHENG_RETRIEVAL_MODEL = ORIG_M
  }
})

test('H7 agent.request waterfall：非论衡三档 → 委托', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const request = { toolName: 'some_other_tool', provider: 'p', model: 'm' }
  const nextReturn = Symbol('next')
  const result = listeners['agent/request'][0](request, () => nextReturn)
  assert.equal(result, nextReturn, '非论衡三档 → 应调用 next() 返回原值')
})

test('H7 agent.request waterfall：未设 env → 委托', async () => {
  const ORIG_P = process.env.LUNHENG_STRONG_PROVIDER
  const ORIG_M = process.env.LUNHENG_STRONG_MODEL
  delete process.env.LUNHENG_STRONG_PROVIDER
  delete process.env.LUNHENG_STRONG_MODEL
  try {
    const { ctx, listeners } = makeCordaxLikeCtx()
    const mod = await import(pathToFileURL(INDEX_MOD).href)
    mod.apply(ctx, {})
    await new Promise((r) => setTimeout(r, 50))

    const request = { toolName: 'subagent_strong', provider: 'p', model: 'm' }
    const nextReturn = Symbol('next')
    const result = listeners['agent/request'][0](request, () => nextReturn)
    assert.equal(result, nextReturn, '未设 env → 不覆盖，委托给 next()')
  } finally {
    if (ORIG_P !== undefined) process.env.LUNHENG_STRONG_PROVIDER = ORIG_P
    if (ORIG_M !== undefined) process.env.LUNHENG_STRONG_MODEL = ORIG_M
  }
})

test('基线契约：ctx.on 注册三个监听器（H2/H4/H7），H3/H5 已移除', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  // v18.62.1 全量审计 P1-1 之后，lib/index.js 应注册 3 个监听器（全部有真实宿主派发方）：
  //   · tools/post-execute（H2）
  //   · agent/request（H7）
  //   · system-prompt/assemble（H4）
  // H3（assistant/chunk）与 H5（file-watcher:change）已移除（宿主无派发方）。
  assert.ok((listeners['tools/post-execute'] || []).length >= 1, 'H2 应注册')
  assert.ok((listeners['agent/request'] || []).length >= 1, 'H7 应注册')
  assert.ok((listeners['system-prompt/assemble'] || []).length >= 1, 'H4 应注册')
  assert.equal((listeners['assistant/chunk'] || []).length, 0, 'H3 应已移除（无派发方）')
  assert.equal((listeners['file-watcher:change'] || []).length, 0, 'H5 应已移除（无派发方）')
})
