#!/usr/bin/env node
// 论衡证据素材池 · 抽取回写脚本（v18.96.0 新增）
//
// 用法：
//   node scripts/pool-extract.mjs <项目目录> <工作区根>
//
// 功能：Phase 5 终检交付时，主控把「本项目证据卡中被采纳的条目」抽取进跨项目素材池
//   <工作区根>/evidence-pool/（惰性创建）。抽取对象 = literature/文献卡.md · data/数据卡.md ·
//   cases/案例卡.md 的 [L]/[D]/[C] 条目（**证据层，非检索层**——绝不沉淀 sources/*.jsonl）。
//
// 去重键（单一真源 = references/_shared/素材池.md §去重）：
//   文献 DOI→URL；数据「来源机构+年份+指标」→URL（**URL 不优先**——同一 URL 可拆多个数据点，
//   实测 D05/D06 同引 Pew 一页、D10/D17/D23 同引一篇新华网报道，URL 优先会误合并）；案例 标题(事件名)。
//   命中既有条目 → 首次由**本项目**复用时 reuseCount+1 并追加 reusedBy，不新增；未命中 → 新增条目，
//   channel=项目沉淀。**幂等**（v19.6.1 审计 P1-1）：计数与 `reusedBy` 同判据——见 `main()` 内注释。
//
// 信任级别归一化（三档真源 _lib/trust.mjs）：已发布 / 主人投喂 / 二手转引。
//   旧格式可信度 A/B → 已发布（含预印本）；C → 二手转引（含媒体转引）。
//
// 退出码：0 = 成功 ｜ 10 = 参数/路径错 ｜ 70 = 内部错误
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { installExitGuard, requireExistingDir, EXIT_USAGE } from './_lib/exit-guard.mjs'
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs'
import { POOL_FILES, readJsonTolerant, writeManifest } from './_lib/pool-store.mjs'
import { writeWithSafety } from './_lib/destructive-write.mjs'   // v19.6.1（审计 P1-3）：池产物走统一写盘安全网

installExitGuard()

const USAGE = '用法: node scripts/pool-extract.mjs <项目目录> <工作区根>'
let argv
try {
  ({ positionals: argv } = parseArgs(process.argv.slice(2), {
    flags: ['--help'],
    minPositionals: 2, maxPositionals: 2,
    positionalHint: '<项目目录> <工作区根>',
  }))
} catch (e) {
  if (e && e.code === USAGE_CODE) { console.error(`${e.message}\n${USAGE}`); process.exit(EXIT_USAGE) }
  throw e
}

const projDir = requireExistingDir(argv[0], '项目目录')
const workspaceRoot = requireExistingDir(argv[1], '工作区根')
const poolDir = join(workspaceRoot, 'evidence-pool')
const projectName = basename(projDir)

const CARD_FILES = [
  { type: 'L', path: join(projDir, 'literature', '文献卡.md') },
  { type: 'D', path: join(projDir, 'data', '数据卡.md') },
  { type: 'C', path: join(projDir, 'cases', '案例卡.md') },
]

const hash = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12)
const today = new Date().toISOString().slice(0, 10)
// 读 JSON 容忍 BOM 的口径统一在 `_lib/pool-store.mjs`（v19.6.1：旧版两脚本各写一份）
const readJson = readJsonTolerant

// ── 条目切分：识别条目起始行 ─────────────────────────────────────────
// 标题形式  ### [L01] 标题  |  加粗形式  **[D01]** 标题  |  行首形式  [D01] 指标|机构|年份|URL
function parseEntries(text) {
  const lines = text.split(/\r?\n/)
  const entries = []
  let cur = null
  for (const ln of lines) {
    if (/^\s*\|/.test(ln)) continue // 索引表格行 | [Xxx] | ... 排除
    const m = ln.match(/^#{1,6}\s*\[([LDC])(\d+)\]\s*(.*)$/)
           || ln.match(/^\*\*\s*\[([LDC])(\d+)\]\s*\*\*\s*(.*)$/)
           || ln.match(/^\[([LDC])(\d+)\]\s*(.+)$/)
    if (m) {
      if (cur) entries.push(cur)
      cur = { type: m[1], num: m[2], title: (m[3] || '').trim(), rawLines: [ln] }
      continue
    }
    if (cur) cur.rawLines.push(ln)
  }
  if (cur) entries.push(cur)
  return entries
}

// ── 字段提取（启发式，兼容三种格式变体）─────────────────────────────
function extractFields(e) {
  const raw = e.rawLines.join('\n')
  const grab = (re) => { const m = raw.match(re); return m ? m[1].trim() : '' }

  // 行内格式：[D01] 指标 | 机构 | 年份 | URL → title 含 '|'，拆分
  let title = e.title
  let inlineSource = ''
  let inlineUrl = ''
  const pipeParts = title.split('|').map((s) => s.trim())
  if (pipeParts.length >= 2) {
    title = pipeParts[0]
    inlineSource = pipeParts[1] || ''
    for (const p of pipeParts) if (/^https?:\/\//.test(p)) inlineUrl = p
  }

  const URL_RE = /https?:\/\/[^\s；;，。、（）()【】\[\]'"<>]+/g
  const urls = [...raw.matchAll(URL_RE)].map((x) => x[0])
  if (!urls.length && inlineUrl) urls.push(inlineUrl)
  const dois = [...raw.matchAll(/\b10\.\d{4,9}\/[^\s；;，。、（）()]+/g)].map((x) => x[0])
  const yearM = raw.match(/\b20\d{2}\b/)

  const trustRaw = grab(/(?:信任级别|可信度)\**\s*[：:]\s*([^\n（(]{0,24})/)
  let source = grab(/(?:来源机构|作者\/机构|来源|作者)\**\s*[：:]\s*([^\n（(]{0,90})/)
  if (!source && inlineSource) source = inlineSource
  const claim = grab(/(?:与本文的关联|关联|口径说明)\**\s*[：:]\s*([^\n]{0,200})/)

  return {
    type: e.type, num: e.num,
    title: title || grab(/数据指标[：:]\s*([^\n]{0,80})/) || '',
    source, year: yearM ? parseInt(yearM[0], 10) : null,
    url: urls, doi: dois, trustRaw,
    trustLevel: normalizeTrust(trustRaw),
    timeliness: (raw.match(/🟢|🟡|🔴/) || [''])[0],
    claim: claim.replace(/\n/g, ' ').slice(0, 200),
    abstract: raw.slice(0, 600),
  }
}

// ── 信任级别归一化（已确认映射）──────────────────────────────────────
function normalizeTrust(raw) {
  const s = (raw || '').replace(/\*\*/g, '').trim()
  if (/主人投喂/.test(s)) return '主人投喂'
  if (/二手转引/.test(s)) return '二手转引'
  if (/已发布/.test(s)) return '已发布'
  const grade = s.match(/^([ABC])/)
  if (grade) return grade[1] === 'C' ? '二手转引' : '已发布'
  if (/预印本/.test(s)) return '已发布'
  if (/转引|媒体/.test(s)) return '二手转引'
  return '已发布'
}

// ── 去重键 ──────────────────────────────────────────────────────────
function dedupKey(f) {
  if (f.type === 'L') return f.doi[0] || f.url[0] || null
  if (f.type === 'D') return (f.source && f.year)
    ? `${f.source}|${f.year}|${(f.title || '').slice(0, 40)}`
    : (f.url[0] || null)
  if (f.type === 'C') return f.title || null
  return null
}

function main() {
  let added = 0, reused = 0, skipped = 0
  const perType = { L: 0, D: 0, C: 0 }

  for (const card of CARD_FILES) {
    if (!existsSync(card.path)) { console.log(`[跳过] ${card.type} 卡不存在: ${card.path}`); continue }
    const text = readFileSync(card.path, 'utf8')
    const entries = parseEntries(text)
    console.log(`[解析] ${card.type} 卡 → ${entries.length} 条`)

    const poolFile = join(poolDir, POOL_FILES[card.type])
    const pool = existsSync(poolFile) ? readJson(poolFile) : { version: 1, entries: [] }
    const index = new Map()
    for (const ex of pool.entries) if (ex.dedupKey) index.set(ex.dedupKey, ex)

    for (const e of entries) {
      const f = extractFields(e)
      const k = dedupKey(f)
      if (!k) { skipped++; console.log(`  [无去重键,跳过] ${f.type}${f.num}`); continue }
      if (index.has(k)) {
        // v19.6.1（审计 2026-10-15 全量批 **P1-1**）：计数必须与 `reusedBy` **同判据**。
        //   旧实现 `reuseCount + 1` 无条件递增，而 `reusedBy` 用 `includes()` 去重 → 两者判据不一致，
        //   同一项目重复抽取（Phase 5 之后的 T5 修订轮 / 重跑交付都会再跑一次本脚本）线性虚增：
        //   实测「同一项目、卡片一字未改连跑 3 次」得 `reuseCount: 2` 而 `reusedBy: ["proj"]`（1 项），
        //   并经 manifest 汇总（`_lib/pool-store.mjs` 的 `reuseCountTotal`）把计数一并放大——
        //   持久化的统计量失真且**不可自愈**（`reusedBy` 无法反推正确计数）。
        //   现把递增绑定到「**首次由本项目复用**」这一唯一事实：算一次、记一次，重复执行结果不变。
        const hit = index.get(k)
        hit.reusedBy = hit.reusedBy || []
        if (!hit.reusedBy.includes(projectName)) {
          hit.reusedBy.push(projectName)
          hit.reuseCount = (hit.reuseCount || 0) + 1
        }
        reused++
      } else {
        pool.entries.push({
          poolId: `${f.type}-${hash(k)}`, dedupKey: k, type: f.type,
          title: f.title || `(${f.type}${f.num} 无标题)`, source: f.source, year: f.year,
          url: f.url, doi: f.doi, trustLevel: f.trustLevel, timeliness: f.timeliness,
          claim: f.claim, abstract: f.abstract, topics: [],
          channel: '项目沉淀', originProject: projectName, firstRetrievedAt: today,
          reuseCount: 0, reusedBy: [], sourcePath: '', sourceSha: '',
        })
        index.set(k, pool.entries[pool.entries.length - 1])
        added++; perType[f.type]++
      }
    }

    mkdirSync(poolDir, { recursive: true })
    // v19.6.1（审计 P1-3）：池文件是持久化状态产物 → 走 `writeWithSafety`（temp→rename 原子写 + 时间戳
    //   `.bak` 回滚点）。旧版裸 `writeFileSync`：写入中途被 kill 会留半写文件且无任何回滚点。
    writeWithSafety(poolFile, JSON.stringify(pool, null, 2) + '\n', { inPlace: true })
  }

  // v19.6.1（审计 P1-2）：manifest 的派生量**一律重算**——真源 = `_lib/pool-store.mjs`（与 `pool-query` 同一实现）
  writeManifest(poolDir)
  console.log(`\n完成: 新增 ${added} 条 / 复用 ${reused} 条 / 跳过 ${skipped} 条`)
  console.log(`分类型新增: L=${perType.L} D=${perType.D} C=${perType.C}`)
  console.log(`池位置: ${poolDir}`)
  process.exit(0)
}

try { main() } catch (err) { throw err }
