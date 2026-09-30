// H3 + H4 + H7 集成测试（v18.61.0 反哺 v4，主人授权落地）
//
// 验证 lib/index.js 的三个新增 ctx.on 监听器：
//   · H3 `assistant/chunk` G14 启发式预筛（命中模板词 → 追加 g14PreScreen 元数据）
//   · H4 `system-prompt/assemble` 钩子（**只追加不覆盖** — 安全模式）
//   · H7 `agent/request` waterfall 模型路由（按 LUNHENG_* env 覆盖 provider/model）
//
// 做法沿用 tests/h2-h5-listeners.test.mjs 同款：直接 import apply + 真 fire。
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

test('H3 G14 启发式预筛：assistant/chunk 含模板词 → g14PreScreen 元数据', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['assistant/chunk'] || []
  assert.ok(handlers.length >= 1, 'H3 监听器未注册到 ctx.on(assistant/chunk)')

  // 模拟模型流式输出（含模板词）
  const chunk = { text: '综上所述，本研究具有重要的理论与现实意义。', content: '' }
  await fire(ctx, listeners, 'assistant/chunk', chunk, () => {})
  assert.ok(chunk.g14PreScreen, `未注入 g14PreScreen，chunk = ${JSON.stringify(chunk)}`)
  assert.ok(chunk.g14PreScreen.hits.length >= 1, `至少 1 个模板词命中，实际 ${chunk.g14PreScreen.hits.length}`)
  const kinds = chunk.g14PreScreen.hits.map((h) => h.kind)
  assert.ok(kinds.includes('g14-A-template'), `应命中 g14-A-template，实际 kinds = ${kinds}`)
})

test('H3 启发式预筛：句式同质化（连续首先...其次...最后）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const chunk = { text: '首先我们看到 A 趋势。其次我们看到 B 影响。最后我们看到 C 结果。' }
  await fire(ctx, listeners, 'assistant/chunk', chunk, () => {})
  assert.ok(chunk.g14PreScreen, '句式同质化应被命中')
  const kinds = chunk.g14PreScreen.hits.map((h) => h.kind)
  assert.ok(kinds.includes('g14-B-consecutive'), `应命中 g14-B-consecutive，实际 kinds = ${kinds}`)
})

test('H3 启发式预筛：干净文本不命中（不误报）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const chunk = { text: '这是一段普通的论述，没有任何模板词。' }
  await fire(ctx, listeners, 'assistant/chunk', chunk, () => {})
  assert.equal(chunk.g14PreScreen, undefined, '干净文本不应误报')
})

test('H3 启发式预筛：不修改 chunk.text 内容（只追加元数据）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const originalText = '综上所述，本研究...'
  const chunk = { text: originalText }
  await fire(ctx, listeners, 'assistant/chunk', chunk, () => {})
  assert.equal(chunk.text, originalText, `chunk.text 必须保持原样，实际 = ${chunk.text}`)
  assert.ok(chunk.g14PreScreen, '元数据 g14PreScreen 已注入')
})

test('H4 system-prompt 钩子：只追加不覆盖（安全模式）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['system-prompt/assemble'] || []
  assert.ok(handlers.length >= 1, 'H4 监听器未注册到 ctx.on(system-prompt/assemble)')

  // 模拟 dsh 默认 prompt
  const dshDefault = '你是一个 AI 助手...'
  const result = handlers[0](dshDefault, () => {})
  // 监听器返回字符串（base + tail）
  assert.ok(typeof result === 'string', 'listener 应返回字符串（追加模式）')
  assert.ok(result.startsWith(dshDefault), '原 dsh 默认 prompt 必须**前置**（不覆盖）')
  assert.ok(result.includes('lunheng-article-pipeline'), '应包含论衡技能提示段')
  assert.ok(result.includes('v18.61.0'), '应包含版本号 v18.61.0')
  assert.ok(result.includes('论衡'), '应包含"论衡"提示')
})

test('H4 system-prompt 钩子：对象 prompt 也支持', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const result = listeners['system-prompt/assemble'][0](
    { text: '你是一个 AI 助手...', other: 'metadata' },
    () => {}
  )
  assert.ok(result && typeof result === 'object', '对象 prompt → listener 应返回对象')
  assert.equal(result.other, 'metadata', '原 metadata 必须保留')
  assert.ok(result.text.includes('lunheng-article-pipeline'), 'text 字段应追加论衡提示')
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

test('基线契约：ctx.on 注册三个监听器（H3/H4/H7）+ H2/H5 共 5 个', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  // v18.61.0 反哺 v4 之后，lib/index.js 应注册：
  //   · tools/post-execute（H2）
  //   · file-watcher:change（H5）
  //   · agent/request（H7）
  //   · assistant/chunk（H3）
  //   · system-prompt/assemble（H4）
  // 共 5 个监听器（agent/request 和 file-watcher:change 可能因宿主事件能力缺失而注册失败，
  // 但 tools/post-execute / assistant/chunk / system-prompt/assemble 应**必然注册成功**）。
  assert.ok((listeners['tools/post-execute'] || []).length >= 1, 'H2 应注册')
  assert.ok((listeners['assistant/chunk'] || []).length >= 1, 'H3 应注册')
  assert.ok((listeners['system-prompt/assemble'] || []).length >= 1, 'H4 应注册')
  // 监听器数 >= 3 是硬契约
  const totalCount = (listeners['tools/post-execute'] || []).length +
                    (listeners['assistant/chunk'] || []).length +
                    (listeners['system-prompt/assemble'] || []).length
  assert.ok(totalCount >= 3, `三个核心监听器（tools/post-execute / assistant/chunk / system-prompt/assemble）合计应 ≥ 3，实际 ${totalCount}`)
})