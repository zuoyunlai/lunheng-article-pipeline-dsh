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

  // 材料类工具 read：默认行为（v18.62.5 全量审计-性能与安全 P0-2 修订）= 「只标记不改写」——
  //   注入 ethicsSanitized + reviewFlags 元数据，**不动 result.content**（避免误伤时间戳/订单 ID 等
  //   被硬模式误判的合法文本）。改写 result.content 需 `Config.hookRewriteContent: true`（opt-in）。
  const exec = { name: 'read', arguments: { path: 'a.md' }, agent: {} }
  const result = makeResult('受访者张三的手机是13800138000，他在北京市朝阳区生活。')
  await fire(ctx, listeners, 'tools/post-execute', exec, result, HOST_NEXT)

  assert.ok(result.ethicsSanitized, '材料类工具 read 应注入 ethicsSanitized')
  assert.equal(result.ethicsSanitized.mode, 'basic', '应使用 basic 模式')
  assert.equal(result.ethicsSanitized.rewriteApplied, false, '默认 hookRewriteContent=false：不应改写 result.content')
  assert.ok(result.ethicsSanitized.counts.phone >= 1, `手机号应被识别，实际 counts = ${JSON.stringify(result.ethicsSanitized.counts)}`)
  assert.ok(result.ethicsSanitized.replacements >= 1, '至少有 1 处替换')
  // P0-2 默认行为：result.content 保持原文；下游从 reviewFlags 看到「此处有命中待复核」
  const text = result.content.map((b) => b.text).join('')
  assert.ok(/13800138000/.test(text), `默认不重写时原文应保留，text = ${text}`)
  assert.ok(Array.isArray(result.reviewFlags) && result.reviewFlags.length >= 1, `手机号应进 reviewFlags 待复核，实际 reviewFlags = ${JSON.stringify(result.reviewFlags)}`)
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

test('H2 opt-in：Config.hookRewriteContent=true → 改写 result.content（旧默认行为）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, { hookRewriteContent: true })
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['tools/post-execute'] || []
  assert.ok(handlers.length >= 1, 'H2 监听器未注册')

  const exec = { name: 'read', arguments: { path: 'a.md' }, agent: {} }
  const result = makeResult('受访者张三的手机是13800138000')
  await fire(ctx, listeners, 'tools/post-execute', exec, result, HOST_NEXT)

  assert.ok(result.ethicsSanitized, '材料类工具 read 应注入 ethicsSanitized')
  assert.equal(result.ethicsSanitized.rewriteApplied, true, 'opt-in=true：应改写 result.content')
  const text = result.content.map((b) => b.text).join('')
  assert.ok(!/13800138000/.test(text), `opt-in=true 时手机号应被替换，text = ${text}`)
})

test('H2 P0-1 行为回归：150 000 字符 read 结果不缩短 + truncated 正确报告（v18.62.4 全量审计 §P2-4 推荐）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['tools/post-execute'] || []
  assert.ok(handlers.length >= 1, 'H2 监听器未注册')

  // 150 000 字符；为了规避 ethics-sanitize 在大块 'A' 输入上邮箱正则的回退爆炸（实测 ~10s），
  //   这里用多种**已知无命中**字符（汉字混合）填充——文本中存在真实命中项（手机号）以便元数据断言。
  const filler = '论衡流水线材料 '.repeat(22000)        // 22000 * 7 = 154 000 字符
  const longText = filler + '手机13800138000' + '结尾标记-END-OF-FILE'
  assert.ok(longText.length >= 150000, `构造文本应 >= 150 000 字符，实际 ${longText.length}`)

  const exec = { name: 'read', arguments: { path: 'large.md' }, agent: {} }
  const result = makeResult(longText)
  await fire(ctx, listeners, 'tools/post-execute', exec, result, HOST_NEXT)

  // ① 文本不被截断：默认不重写 → text 长度与原文一致；尾标记保留
  const outText = result.content[0].text
  assert.equal(outText.length, longText.length, `text 长度应与原文一致，实际 ${outText.length}/${longText.length}`)
  assert.ok(outText.endsWith('结尾标记-END-OF-FILE'), '尾标记应保留（旧 v18.62.4 会因 maxChars=60000 默认值丢失尾部）')

  // ② 元数据：counts.phone >= 1，truncated 字段存在
  assert.ok(result.ethicsSanitized, 'ethicsSanitized 必须注入')
  assert.ok(result.ethicsSanitized.counts.phone >= 1, `手机号应被识别，实际 counts = ${JSON.stringify(result.ethicsSanitized.counts)}`)
  assert.equal(result.ethicsSanitized.truncated, false, '150 000 字符 < MAX_SAFE_INTEGER，truncated 应为 false')
})

test('H2 P2-2 体积上限：单 text 块超 hookMaxBlockChars → 跳过改写（u16 其余）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  // 设低上限以触发
  mod.apply(ctx, { hookMaxBlockChars: 1024, hookRewriteContent: true })
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['tools/post-execute'] || []
  assert.ok(handlers.length >= 1, 'H2 监听器未注册')

  const bigText = '手机13800138000' + 'C'.repeat(5000)
  const exec = { name: 'read', arguments: { path: 'huge.md' }, agent: {} }
  const result = makeResult(bigText)
  await fire(ctx, listeners, 'tools/post-execute', exec, result, HOST_NEXT)

  assert.ok(result.ethicsSanitized, '应注入 ethicsSanitized')
  assert.ok(result.ethicsSanitized.skippedTooLarge >= 1, `超限块应被跳过，实际 skippedTooLarge = ${result.ethicsSanitized.skippedTooLarge}`)
  assert.equal(result.ethicsSanitized.hookMaxBlockChars, 1024, '上限值应如实暴露')
  // 跳过改写 → 即使 opt-in=true，text 也不变
  assert.equal(result.content[0].text, bigText, '跳过改写时 text 不变')
  assert.ok((result.reviewFlags || []).some((f) => f.kind === 'too-large-for-hook'), 'reviewFlags 应含 too-large-for-hook')
})

test('基线：ctx.on 注册的工具监听器**至少**包含 tools/post-execute（契约钉住）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const postHandlers = listeners['tools/post-execute'] || []
  assert.ok(postHandlers.length >= 1, `ctx.on('tools/post-execute') 必须至少 1 个监听器——H2 注册入口；当前 ${postHandlers.length}（请检查 lib/index.js 的 ctx.on('tools/post-execute', ...) 是否还在）`)
})
