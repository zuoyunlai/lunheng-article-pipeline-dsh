#!/usr/bin/env node
// 论衡证据素材池 · 查池脚本（v18.96.0 新增）
//
// 用法：
//   node scripts/pool-query.mjs <工作区根> [关键词...]
//
// 功能：Phase 0 定题后、Phase 1 检索前，主控按主题关键词查跨项目素材池
//   <工作区根>/evidence-pool/。**池不存在 → 惰性创建空骨架 → 返回「空池无命中」**——
//   用户不预设任何素材也能生效：第一个项目 Phase 5 回写沉淀、第二个项目 Phase 0.5 查池命中。
//   命中条目由主控注入 T1/T2/T3 派发话术（复用不绕过三角验证 / G8 / G7）。
//
// 退出码：0 = 成功（含「空池无命中」）｜ 10 = 参数/路径错 ｜ 70 = 内部错误
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { installExitGuard, requireExistingDir, EXIT_USAGE } from './_lib/exit-guard.mjs'
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs'

installExitGuard()

const USAGE = '用法: node scripts/pool-query.mjs <工作区根> [关键词...]'
let positionals
try {
  ({ positionals } = parseArgs(process.argv.slice(2), {
    flags: ['--help'],
    minPositionals: 1, maxPositionals: Infinity,
    positionalHint: '<工作区根> [关键词...]',
  }))
} catch (e) {
  if (e && e.code === USAGE_CODE) { console.error(`${e.message}\n${USAGE}`); process.exit(EXIT_USAGE) }
  throw e
}

const workspaceRoot = requireExistingDir(positionals[0], '工作区根')
const poolDir = join(workspaceRoot, 'evidence-pool')
const keywords = positionals.slice(1)
const POOL_FILES = { L: 'literature.json', D: 'data.json', C: 'cases.json', DB: 'databases.json' }
const today = new Date().toISOString().slice(0, 10)
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))

// ── 惰性创建空骨架（能力/数据分离：数据目录首次使用时才建）──────────
function ensureSkeleton() {
  if (existsSync(join(poolDir, 'manifest.json'))) return false
  const dirs = ['raw/books', 'raw/datasets', 'raw/papers', 'raw/misc', 'transcripts']
  for (const d of dirs) mkdirSync(join(poolDir, d), { recursive: true })
  for (const f of Object.values(POOL_FILES)) {
    const p = join(poolDir, f)
    if (!existsSync(p)) writeFileSync(p, JSON.stringify({ version: 1, entries: [] }, null, 2) + '\n', 'utf8')
  }
  const mf = join(poolDir, 'manifest.json')
  if (!existsSync(mf)) {
    writeFileSync(mf, JSON.stringify({
      createdAt: today, totalEntries: 0,
      byType: { L: 0, D: 0, C: 0, DB: 0 },
      byChannel: { '主人预设': 0, '项目沉淀': 0 },
      reuseCountTotal: 0, lastUpdated: today,
    }, null, 2) + '\n', 'utf8')
  }
  return true
}

function readAll() {
  const all = []
  for (const key of Object.keys(POOL_FILES)) {
    const p = join(poolDir, POOL_FILES[key])
    if (!existsSync(p)) continue
    try { all.push(...(readJson(p).entries || [])) } catch { /* 忽略坏文件 */ }
  }
  return all
}

function main() {
  const created = ensureSkeleton()
  const all = readAll()

  if (created) console.log(`✅ 已创建空素材池骨架: ${poolDir}（0 条）`)
  if (all.length === 0) { console.log('查池结果: 空池，无命中'); return }

  const hits = keywords.length === 0
    ? all
    : all.filter((e) => {
        const hay = [e.title, e.source, e.claim, e.abstract, ...(e.topics || [])].join(' ')
        return keywords.some((k) => hay.includes(k))
      })

  if (hits.length === 0) { console.log(`查池结果: 池内 ${all.length} 条，关键词 ${JSON.stringify(keywords)} 无命中`); return }

  console.log(`查池结果: 命中 ${hits.length}/${all.length} 条（关键词 ${JSON.stringify(keywords)}）`)
  for (const h of hits) {
    const cnt = (h.reuseCount || 0) > 0 ? ` 复用${h.reuseCount}次` : ''
    console.log(`  [${h.type}] ${h.title}`)
    console.log(`      来源: ${h.source || '—'} | ${h.year || '—'} | ${h.trustLevel || '—'} ${h.timeliness || ''}${cnt}`)
    if (h.url && h.url[0]) console.log(`      URL: ${h.url[0]}`)
  }
}

try { main() } catch (err) { throw err }
