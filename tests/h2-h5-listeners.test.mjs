// H2 集成测试（v18.60.1 反哺 v3 落地；v18.62.1 全量审计 P0-1 修复 + P1-1 移除 H5）
//
// 验证 lib/index.js 的 `tools/post-execute` 伦理脱敏监听器（H2）。
//   H5 `file-watcher:change` 监听器已按 v18.62.1 全量审计 P1-1 移除（宿主全树 0 命中、无派发方），不再测。
//
// 做法（v18.18.0 commands.test.mjs 同款）：**不跑真入口**——直接 import lib/index.js 的 `apply()`，
//   喂一个最小 ctx（含 skills / tools / commands 服务 + effect + on），拿到 apply 注册的监听器后**真 fire**。
//   测的就是 lib/index.js 的真实行为，不是桩。
//
// 关键差异（v18.62.1 修复前 vs 后）：修复前监听器是 4 参 `(tool, args, result, next)`，与宿主 3 参
//   `(exec, result, next)` 契约错位——旧测试也照 4 参喂数据，于是「自建桩」与「实现」共同错、恒绿。
//   本文件改按**宿主真实 3 参形状** fire（`exec` 对象 + `result.content` 块数组 + `next`），并新增
//   **形参个数断言**（`listener.length === 3`），从契约层钉住签名，防止再次退化。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const INDEX_MOD = join(PACKAGE_ROOT, 'lib', 'index.js')

/** 贴近 Cordis 真实语义的 ctx：ctx.on 收集监听器，ctx.effect 同步跑 fn 拿 disposer。 */
function makeCordaxLikeCtx() {
  const listeners = Object.create(null)
  const effectDisposers = []
  const toolsRegistry = { register: () => [], guard: () => undefined }
  const skillsRegistry = { register: () => () => {} }
  const commandsRegistry = { register: () => () => {} }

  const ctx = {
    get: (n) => ({
      tools: toolsRegistry,
      commands: commandsRegistry,
      skills: skillsRegistry,
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
  // 补 skills 服务（inject 写死）
  ctx.skills = skillsRegistry
  return { ctx, listeners }
}

/** 按宿主 `ctx.waterfall(..., "tools/post-execute", exec, result, next)` 的 3 参形状 fire。 */
async function fire(ctx, listeners, event, ...args) {
  const arr = listeners[event] || []
  const results = []
  for (const fn of arr) {
    const r = await fn(...args)
    results.push(r)
  }
  return results
}

/** 宿主真实 result 形状：content 是 content 块数组（见 dsh-tools postExecute 的 `result.content`）。 */
function makeResult(text) {
  return { content: [{ type: 'text', text }], isError: false }
}

const HOST_NEXT = () => Promise.resolve({ kind: 'accept' })

test('H2 契约：listener 形参个数 = 3（exec, result, next）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['tools/post-execute'] || []
  assert.ok(handlers.length >= 1, 'H2 监听器未注册到 ctx.on(tools/post-execute)')
  assert.equal(
    handlers[0].length,
    3,
    'H2 监听器必须是 3 参 (exec, result, next)——4 参会在真实宿主每次工具调用抛 next is not a function',
  )
})

test('H2 契约：真实宿主形状 (exec, result, next) 驱动 → 不抛错且材料类工具脱敏', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['tools/post-execute'] || []
  assert.ok(handlers.length >= 1, 'H2 监听器未注册')

  // 修复前的致命伤：`read` 命中早期 `return next()`（next=undefined）→ 每次工具调用抛错。
  // 这里逐个真实工具名驱动，全部不得抛错。
  for (const name of ['read', 'write', 'web_search', 'subagent', 'subagent_retrieval']) {
    const exec = { name, arguments: {}, agent: {} }
    const result = makeResult('受访者张三的手机是13800138000')
    const decisions = await fire(ctx, listeners, 'tools/post-execute', exec, result, HOST_NEXT)
    assert.equal(decisions.length, 1, `${name} 应只有一个监听器`)
  }

  // 材料类工具 read：内容应被脱敏 + 注入元数据
  const exec = { name: 'read', arguments: { path: 'a.md' }, agent: {} }
  const result = makeResult('受访者张三的手机是13800138000，他在北京市朝阳区生活。')
  await fire(ctx, listeners, 'tools/post-execute', exec, result, HOST_NEXT)

  assert.ok(result.ethicsSanitized, '材料类工具 read 应注入 ethicsSanitized')
  assert.equal(result.ethicsSanitized.mode, 'basic', '应使用 basic 模式')
  assert.ok(result.ethicsSanitized.counts.phone >= 1, `手机号应被识别，实际 counts = ${JSON.stringify(result.ethicsSanitized.counts)}`)
  assert.ok(result.ethicsSanitized.replacements >= 1, '至少有 1 处替换')
  const text = result.content.map((b) => b.text).join('')
  assert.ok(!/13800138000/.test(text), `手机号应被替换，text = ${text}`)
})

test('H2 监听器：非材料类工具（write）不触发脱敏且不抛错', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['tools/post-execute'] || []
  assert.ok(handlers.length >= 1, 'H2 监听器未注册')

  const exec = { name: 'write', arguments: {}, agent: {} }
  const result = makeResult('受访者张三的手机是13800138000')
  await fire(ctx, listeners, 'tools/post-execute', exec, result, HOST_NEXT)

  assert.equal(result.ethicsSanitized, undefined, '非材料类工具（write）不应触发 H2')
  assert.equal(result.content[0].text, '受访者张三的手机是13800138000', 'text 应保持不变（无脱敏）')
})

test('H2 监听器：无 content 块数组 / 无文本块 → 静默放行不抛错', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['tools/post-execute'] || []
  assert.ok(handlers.length >= 1, 'H2 监听器未注册')

  // result 无 content 字段
  const noContent = { isError: false }
  await fire(ctx, listeners, 'tools/post-execute', { name: 'read', agent: {} }, noContent, HOST_NEXT)
  assert.equal(noContent.ethicsSanitized, undefined, '无 content → 不注入元数据')

  // content 只有非文本块（如图像）
  const imageOnly = { content: [{ type: 'image', source: {} }], isError: false }
  await fire(ctx, listeners, 'tools/post-execute', { name: 'read', agent: {} }, imageOnly, HOST_NEXT)
  assert.equal(imageOnly.ethicsSanitized, undefined, '无文本块 → 不注入元数据、不抛错')
})

test('基线：ctx.on 注册的工具监听器**至少**包含 tools/post-execute（契约钉住）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const postHandlers = listeners['tools/post-execute'] || []
  assert.ok(postHandlers.length >= 1, `ctx.on('tools/post-execute') 必须至少 1 个监听器——H2 注册入口；当前 ${postHandlers.length}（请检查 lib/index.js 的 ctx.on('tools/post-execute', ...) 是否还在）`)
})
