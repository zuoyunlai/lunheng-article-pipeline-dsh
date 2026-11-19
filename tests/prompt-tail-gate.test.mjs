// promptTail 常驻注入门控回归测试（v19.27.21 · 第三方全量审计-2026-11-19 §P2-1）
//
// 为什么要这一条：H4 钩子原本**每次** system-prompt/assemble 都无条件追加约 400–600 B 的段，
//   而本包的价值只在「真的要写长文」时兑现——第三方审计的那一轮会话从未用过论衡，却整轮挂着它。
//   加了开关之后，**门控本身**必须有测试：否则「auto 永不注入」与「auto 永远注入」两种退化
//   在 h3-h4-h7 那组（已显式传 always 测内容）里都看不出来。
//
// 四个状态穷举：never / always / auto-无项目 / auto-有项目。缺一个就有一角未验。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const INDEX_MOD = join(ROOT, 'lib', 'index.js')

/** 与 tests/h3-h4-h7-listeners.test.mjs 同款的极简 ctx（只收监听器）。 */
function makeCtx() {
  const listeners = {}
  const ctx = {
    get: (n) => (n === 'tools' ? { register: () => () => {}, guard: () => () => {} } : undefined),
    on: (event, listener) => { (listeners[event] ??= []).push(listener); return () => {} },
    effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : () => {} },
    commands: { register: () => () => {} },
    skills: { register: () => () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }
  return { ctx, listeners }
}

/** 跑一次 assemble，返回追加段文本（没有追加则空串）。 */
async function tailFor(config, context) {
  const { ctx, listeners } = makeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, config)
  await new Promise((r) => setTimeout(r, 60))
  const h = (listeners['system-prompt/assemble'] || [])[0]
  assert.ok(h, 'H4 监听器未注册')
  const assembly = { sections: [], contexts: [], tools: [], variables: { model: 'x' } }
  const out = await h(assembly, context, async () => assembly)
  assert.deepEqual(out.variables, assembly.variables, '无论是否注入，下游装配结果都不得被改动')
  return (out.sections || []).filter((s) => s.name === 'lunheng').map((s) => s.text).join('')
}

/** 造一个「有在跑的论衡项目」的工作区。 */
function makeWorkspaceWithProject() {
  const dir = mkdtempSync(join(tmpdir(), 'lunheng-tail-'))
  mkdirSync(join(dir, 'run', 'demo'), { recursive: true })
  writeFileSync(join(dir, 'run', 'demo', 'status.md'), '# status\n\n| Phase 1 | 🔄 |\n', 'utf8')
  return dir
}

test('never：完全不注入（连版本自证行都没有）', async () => {
  const dir = makeWorkspaceWithProject()
  try {
    const tail = await tailFor({ promptTail: 'never' }, { agent: { session: { header: { cwd: dir } } } })
    assert.equal(tail, '', `never 下不得注入任何段，实际：${tail.slice(0, 120)}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('always：无条件注入（旧行为，给「任何会话都看版本」的部署）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lunheng-tail-'))
  try {
    // 注意：这个目录**没有** run/ 项目——always 仍须注入
    const tail = await tailFor({ promptTail: 'always' }, { agent: { session: { header: { cwd: dir } } } })
    assert.ok(tail.includes('按需追加'), `always 下必须注入，实际：${tail.slice(0, 120)}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('auto（默认）：工作区无 run/ 项目时不注入', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lunheng-tail-'))
  try {
    const tail = await tailFor({}, { agent: { session: { header: { cwd: dir } } } })
    assert.equal(tail, '', `auto 且无项目时不得注入，实际：${tail.slice(0, 120)}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('auto（默认）：工作区有 run/<项目>/status.md 时注入', async () => {
  const dir = makeWorkspaceWithProject()
  try {
    const tail = await tailFor({}, { agent: { session: { header: { cwd: dir } } } })
    assert.ok(tail.includes('按需追加'), `auto 且有项目时必须注入，实际：${tail.slice(0, 120)}`)
    // 注入内容仍须带版本自证（该段的核心职责之一）
    assert.match(tail, /v\d+\.\d+\.\d+/, '注入段仍须带版本号')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('水fall 纪律：不注入时也必须先调用 next()（不得截断下游）', async () => {
  const { ctx, listeners } = makeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, { promptTail: 'never' })
  await new Promise((r) => setTimeout(r, 60))
  const h = (listeners['system-prompt/assemble'] || [])[0]
  let called = 0
  const assembly = { sections: [{ name: 'persona', text: 'x' }], variables: { model: 'm' } }
  const out = await h(assembly, { agent: {} }, async () => { called++; return assembly })
  assert.equal(called, 1, 'never 分支也必须调用 next() 恰好一次——否则会截断模型选择等下游监听器')
  assert.deepEqual(out.variables, assembly.variables)
})
