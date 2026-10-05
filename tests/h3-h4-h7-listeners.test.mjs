// H4 集成测试（v18.61.0 反哺 v4 落地；v18.62.1 全量审计 P1-2 修复 H4 + P1-1 移除 H3/H5）
//
// v18.76.0（v18.75.1 全量架构审计 R2 · P1 修复）：H7 `agent/request` waterfall 监听器**已移除**。
//   该事件 payload 只有 `{turn, step, signal}`（宿主 `dsh-agent-loop` 派发点；本仓 `host-contract.mjs`
//   的表注早已写明这三键），监听器读的 `request.toolName` 恒 `undefined` → 「派发方存在但判别键缺失」
//   的死监听器。删后行为与删前**完全等价**（删除前该监听器对任何请求都空转返回 `next()` 的结果）。
//   原 H7 的 3 个 case 由本批「agent/request 0 监听器 + 契约表带 since / payloadKeys」覆盖；
//   `tests/host-contract.test.mjs` 进一步以契约表断言 `since`/`payloadKeys` 的存在与形态。
//   H3 `assistant/chunk` / H5 `file-watcher:change` 已按 v18.62.1 全量审计 P1-1 移除（宿主无派发方），
//   维持原口径。
//
// H4 关键差异（v18.62.1 修复前 vs 后）：修复前 2 参 `(prompt, next)` 不调 next()，把下游链（含模型选择）
//   静默截断；修复后 3 参 `(assembly, context, next)`，`await next()` 拿到装配结果再向 sections 追加论衡段。
// H4 S7 修复：版本号改为每次 assemble 现读 `package.json`（不再用 apply 期快照）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

test('H4 版本自证（S7 修复）：尾注里出现的版本号必须**只有**当前包版本（不得留任何字面量）', async () => {
  // 为什么需要（v18.62.6；v18.76.0 S7 修复升级）：这段尾注**每个会话都进模型上下文**，是「装错了要看得见」的
  //   唯一载体。历史三次踩到：① v18.61.0 时整串硬编码；② v18.62.4 只改一半（标题仍字面量）；
  //   ③ v18.62.6 标题也改后，**apply 期一次性快照**让原地升级看不到真实版本。
  // S7 改后：版本改为每次 assemble 现读 `package.json`（`buildPromptTail()`），原地升级也能看到真实版本。
  // 断言口径：**只看运行时渲染出的字符串**（注释/历史注记天然不参与），因此零假阳性。
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const pkgVersion = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version

  const handlers = listeners['system-prompt/assemble'] || []
  const assembly = { sections: [], contexts: [], tools: [], variables: {} }
  const result = await handlers[0](assembly, { agent: {} }, async () => assembly)

  const text = result.sections.map((s) => s.text).join('\n')
  assert.ok(text.includes(`v${pkgVersion}`), `尾注应带当前包版本 v${pkgVersion}`)

  // 尾注里**所有** `vX.Y.Z` 形态都必须等于当前版本——派生一旦被改回字面量，这条立刻红。
  const found = [...new Set([...text.matchAll(/v(\d{1,3}\.\d{1,3}\.\d{1,3})/g)].map((m) => m[1]))]
  const stale = found.filter((v) => v !== pkgVersion)
  assert.deepEqual(
    stale,
    [],
    `尾注含非当前版本号 ${stale.join(', ')}（当前 = ${pkgVersion}）——` +
      '该串每会话进模型上下文，旧版本号会直接抵消版本自证行；真源 = lib/index.js 的 buildPromptTail()（应全部走 readPackageVersion() 派生）',
  )
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

test('基线契约：ctx.on 注册两个监听器（H2 + H4）；H3/H5/H7 已移除（v18.62.1 + v18.76.0）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  // v18.76.0：lib/index.js 应注册 2 个监听器（全部有真实宿主派发方）：
  //   · tools/post-execute（H2）
  //   · system-prompt/assemble（H4）
  // H3（assistant/chunk）/ H5（file-watcher:change）/ H7（agent/request）均已移除——
  //   H3/H5 = 宿主无派发方（v18.62.1 P1-1），H7 = 派发方存在但判别键缺失（v18.75.1 审计 R2）。
  // 契约表里 `agent/request` 的条目保留（它是宿主事实 + 由 host-contract-probe 持续守 payload 键集合），
  // 但本仓**不再注册**该事件监听器——所以这里 listeners 里 `agent/request` 应为空数组。
  assert.ok((listeners['tools/post-execute'] || []).length >= 1, 'H2 应注册')
  assert.equal((listeners['agent/request'] || []).length, 0, 'H7 应已移除（payload 无判别键，死监听器）；契约表保留但本仓不注册')
  assert.ok((listeners['system-prompt/assemble'] || []).length >= 1, 'H4 应注册')
  assert.equal((listeners['assistant/chunk'] || []).length, 0, 'H3 应已移除（无派发方）')
  assert.equal((listeners['file-watcher:change'] || []).length, 0, 'H5 应已移除（无派发方）')
})
