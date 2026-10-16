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
// v19.6.10（反哺批 B/A + 动议 E **丙案**）：查池**同时**打印「负知识提醒」——只读扫描
//   `<工作区根>/run/*/audits/disproofs.jsonl`（契约真源 = `_shared/负知识账本.md`）并按关键词提示命中条目。
//   **只提示、不判同、不去重、不合并、不写池、不计数**——正面回答该契约 §九.1 自己登记的「未做」理由
//   「聚合会引入新的口径问题（同名主张如何判同？）」：本层**不承担判同**，条目原文照印 + 带
//   `originProject` 回指，是否适用由主控读原文判断。退出码不变（0 / 10 / 70）。
//
// v19.7.2（**丁案 · 负知识复用计数**）：在丙案的**弱判据提示层**之外再加一层**强判据「同名」层**——
//   `--claim "<待检验主张>"` 与账本 `claim` 归一化后**逐字相等**即判「同名」，**只有同名计入复用计数**；
//   弱命中继续只提示、不计入（理由见 `normClaim` 上方注释：弱命中必然虚增）。命中时向**本项目自己的**
//   `audits/负知识复用.jsonl` append 一行（**给了 `--project` 才落痕**，绝不写别人的账本），
//   并按 `run/*/audits/负知识复用.jsonl` **只读聚合**出「已被 N 个项目复现」。
//   口径真源 = `_shared/负知识账本.md` §九.2。退出码不变（0 / 10 / 70）。
//
// manifest 口径（v19.6.1 · 审计 2026-10-15 全量批 **P1-2**）：`manifest.json` 的计数全是**派生量**，
//   一律由池文件**重算**（真源 = `_lib/pool-store.mjs`）。旧版 `ensureSkeleton()` 的判据只看
//   「manifest.json 在不在」，写进去的计数**恒为 0** → 池内有数据时产出一份「自称 0 条」的 manifest，
//   实测同一进程内先打印「✅ 已创建空素材池骨架（0 条）」再打印「命中 1/1 条」；且在下次跑
//   `pool-extract` 之前**不自愈**——而主人侧读面正是本脚本与 `pool-report`。
//
// 退出码：0 = 成功（含「空池无命中」）｜ 10 = 参数/路径错 ｜ 70 = 内部错误
import { existsSync, readFileSync, readdirSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { installExitGuard, requireExistingDir, EXIT_USAGE } from './_lib/exit-guard.mjs'
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs'
import { POOL_FILES, ensurePoolSkeleton, poolFilePath, readJsonTolerant, writeManifest } from './_lib/pool-store.mjs'

installExitGuard()

const USAGE = '用法: node scripts/pool-query.mjs <工作区根> [关键词...] [--claim "<待检验主张原文>"] [--project <本项目名>]'
let opts, positionals
try {
  ({ opts, positionals } = parseArgs(process.argv.slice(2), {
    flags: ['--help'],
    values: { '--claim': '"人工智能的伦理原则已足以指导实践"', '--project': 'ai-era-tech-ethics' },
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
// v19.7.2（**丁案 · 负知识复用计数**）：两个可选值参数——
//   `--claim`   = 本项目**待检验的主张原文**（强判据「同名」的输入；不给则只走弱判据提示层）。
//   `--project` = **查询方项目名**（= `<工作区根>/run/<项目名>`），**记录归属**用：
//                 **只往自己的 `audits/负知识复用.jsonl` 追加**——绝不写别的项目的账本（跨项目写是危险动作）。
const claimRaw = opts['--claim'] || null
const queryProject = opts['--project'] || null

// ── 惰性创建空骨架（能力/数据分离：数据目录首次使用时才建）──────────
// v19.6.1（审计 P1-2）：建骨架**只建目录与空池文件**（已存在的池文件不覆盖），manifest 由
// `writeManifest()` **重算**产生——两个动作拆开后，就不会再出现「一遍写 0、一遍报 N 条」的自相矛盾。
// 真源 = `_lib/pool-store.mjs` 的 `ensurePoolSkeleton()`（与 `pool-extract` 同一实现；
// 本仓判据：同一事实两处实现必然漂）。
function readAll() {
  const all = []
  for (const key of Object.keys(POOL_FILES)) {
    const p = poolFilePath(poolDir, key)
    if (!existsSync(p)) continue
    try { all.push(...(readJsonTolerant(p).entries || [])) } catch { /* 忽略坏文件 */ }
  }
  return all
}

// ── 丁案：**同名主张判同** + 复用留痕 + 只读聚合（v19.7.2）────────────────────────
// **口径（真源 = `_shared/负知识账本.md` §九.2）**：**两档，且只有强判据计入复用**——
//   · 档 1「**同名**」（**强**，计入）：两侧 `claim` 经 `normClaim()` 归一化后**逐字相等**。
//   · 档 2「**同域**」（**弱**，只提示、**不计入**）：关键词子串命中（= 本脚本原有的提示层）。
// **为什么不把弱命中计入**：同一关键词会命中**大量不同**主张 ⇒ 计数必然虚增，而**失真的统计量比
//   没有统计量更坏**（本仓 P1-1「`reuseCount` 非幂等」是同一类病的先例：持久化的假数字不可自愈）。
function normClaim(s) {
  return String(s || '')
    .normalize('NFKC')                 // 全角 → 半角（含全角标点）
    .replace(/\s+/g, '')               // 去全部空白
    .replace(/[\p{P}\p{S}]/gu, '')     // 去标点与符号
    .toLowerCase()                     // 英文大小写归一（中文不受影响）
}

/** **只读聚合**：扫 `<ws>/run/<项目>/audits/负知识复用.jsonl` → Map(`originProject|originId`) → Set(复现项目名)。
 *  ⚠️ 注释里**不得**出现星号加斜杠（会提前闭合块注释）——故此处不写通配路径字面量。 */
function readReuse() {
  const runDir = join(workspaceRoot, 'run')
  const agg = new Map()
  if (!existsSync(runDir)) return agg
  for (const e of readdirSync(runDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const f = join(runDir, e.name, 'audits', '负知识复用.jsonl')
    if (!existsSync(f)) continue
    let txt = ''
    try { txt = readFileSync(f, 'utf8') } catch { continue }
    for (const ln of txt.split(/\r?\n/)) {
      if (!ln.trim()) continue
      let r
      try { r = JSON.parse(ln) } catch { continue }   // 坏行**不在此报错**（同本脚本既有口径）
      const k = `${r.originProject}|${r.originId}`
      if (!agg.has(k)) agg.set(k, new Set())
      agg.get(k).add(r.queryingProject)
    }
  }
  return agg
}

/** 把「本项目复现了某条负知识」追加到**本项目自己的**账本（append-only；目录缺失则建）。
 *  **只写自己的项目**——跨项目写别人的账本是危险动作（本仓对跨面写有专门的教训）。 */
function appendReuse(originProject, originId, claimNorm) {
  if (!queryProject) return false
  const dir = join(workspaceRoot, 'run', queryProject, 'audits')
  if (!existsSync(dir)) { try { mkdirSync(dir, { recursive: true }) } catch { return false } }
  const row = JSON.stringify({
    at: new Date().toISOString(), queryingProject: queryProject,
    originProject, originId: originId || null, claimNorm,
  })
  try { appendFileSync(join(dir, '负知识复用.jsonl'), row + '\n'); return true } catch { return false }
}

// ── 负知识账本只读扫描（v19.6.10 · 反哺动议 E 丙案）────────────────────────
// 动机：Phase 0.5 查池只查正向素材，而 `run/<项目>/audits/disproofs.jsonl`（契约真源 =
//   `_shared/负知识账本.md`）是**项目内** append-only 账本、**不进池** ⇒ A 项目核实出的「某条数据并不
//   支持它被引用的主张」在 B 项目查池时不可见，B 会照样引进来。正面素材复用只省检索时间，
//   **证伪结论复用能直接避免一次踩坑**。
// 口径：**本层不做判同**（见文件头）；坏行**不在此报错**——那是 `disproofs-check.mjs` 的职责，
//   两处报同一缺陷会让「谁负责点名」失焦。
function readDisproofs(workspaceRoot) {
  const runDir = join(workspaceRoot, 'run')
  if (!existsSync(runDir)) return { files: 0, rows: [] }
  let projects = []
  try {
    projects = readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch { return { files: 0, rows: [] } }
  let files = 0
  const rows = []
  for (const proj of projects) {
    const p = join(runDir, proj, 'audits', 'disproofs.jsonl')
    if (!existsSync(p)) continue
    let text = ''
    try { text = readFileSync(p, 'utf8').replace(/^\uFEFF/, '') } catch { continue }
    files++
    for (const line of text.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const o = JSON.parse(s)
        if (o && typeof o === 'object') rows.push({ ...o, originProject: proj })
      } catch { /* 坏行留给 disproofs-check.mjs 点名 */ }
    }
  }
  return { files, rows }
}

function main() {
  // v19.6.11（验证记录 V5b 修复）：`created` 只表示「补建了缺失的池 JSON」，**不等于「池是新建的」**。
  //   故先判池文件此前是否存在，据此区分「新建池」与「补建缺失文件」——否则在**非空池**上会与同一行的
  //   「（现有 N 条）」并列输出「已创建素材池骨架」，两句互相打脸（审计 P1-2 同族形态：两条读数矛盾）。
  const poolExistedBefore = Object.keys(POOL_FILES).some((k) => existsSync(poolFilePath(poolDir, k)))
  const created = ensurePoolSkeleton(poolDir)
  const all = readAll()
  // manifest 是派生量的副本：**每次查池都重算**，与盘上一致时不落盘（避免只读路径产生无意义的 `.bak` 噪声），
  // 不一致或缺失时**自愈**并如实报出（「不静的降级」——修复动作必须可见）。
  const mw = writeManifest(poolDir, { onlyIfStale: true })

  // v19.6.6（素材池可见性批）：**每轮都显形**——旧版只在新建骨架时报一次路径，非空池且无命中时全程静默，
  //   而本脚本是主人侧的**读面**（Phase 0 显形 / Phase 0.5 查池）：用户据此才知道池在哪、有多少、
  //   档 B「仅本地素材」是不是可用（池 0 条 + 无投喂 ⇒ 档 B 不适用，真源 = `素材池.md` §11.5 第 4 条）。
  console.log(`· 素材池: ${poolDir}（现有 ${all.length} 条）`)
  if (created && !poolExistedBefore) console.log('✅ 已创建素材池骨架——长期共享原件请放 raw/{books,datasets,papers,misc}/（A 轨）；本项目一次性材料走 run/<项目>/主人投喂清单.md（B 轨）')
  else if (created) console.log('· 池结构此前不完整，已补齐缺失的池文件与目录（raw/ · transcripts/ · 空池 JSON）——既有条目未受影响')
  else if (mw.written) console.log('· manifest 与池文件不一致（派生量失真），已按池文件重算（池文件是唯一真源）')

  // ── 负知识提醒（v19.6.10 · 动议 E 丙案；v19.7.2 加**丁案**同名层）──────────────────
  // 为什么放在**空池早退之前**：池空 + 历史有证伪结论，正是本提示价值最大的场景（没有正面素材可复用，
  //   但有前人踩过的坑）。故它**不参与「池命中 N/M」的计数**，也不受池内条数影响。
  const dp = readDisproofs(workspaceRoot)
  if (dp.files > 0) {
    const dh = keywords.length === 0 ? dp.rows : dp.rows.filter((r) => {
      const hay = [r.claim, r.basis, r.reproduce, r.note, ...(Array.isArray(r.evidence) ? r.evidence : [])].join(' ')
      return keywords.some((k) => hay.includes(k))
    })
    console.log(`· 负知识账本: 扫描 ${dp.files} 个项目账本，命中 ${dh.length}/${dp.rows.length} 条（**弱判据**=关键词子串：只提示，**不计入复用**）`)
    for (const r of dh.slice(0, 8)) {
      console.log(`  [${r.verdict || '—'}] ${r.claim || '（无 claim）'}`)
      console.log(`      依据: ${r.basis || '—'} ｜ 记于: ${r.originProject}${r.id ? ' ' + r.id : ''}${r.round ? ' ' + r.round : ''}`)
      if (r.reproduce) console.log(`      复现: ${r.reproduce}`)
    }
    if (dh.length > 8) console.log(`  …另有 ${dh.length - 8} 条，逐条见各项目 audits/disproofs.jsonl`)

    // ── 丁案：**同名层**（强判据）——**只有它计入复用计数**（v19.7.2）──────────────────
    if (claimRaw) {
      const norm = normClaim(claimRaw)
      const same = norm ? dp.rows.filter((r) => r.claim && normClaim(r.claim) === norm) : []
      const agg = readReuse()
      console.log(`· 负知识**同名**复现: ${same.length} 条（**强判据** = claim 归一化后逐字相等；口径真源 = 负知识账本.md §九.2）`)
      for (const r of same) {
        const others = agg.get(`${r.originProject}|${r.id}`) || new Set()
        const willRecord = !!queryProject && !others.has(queryProject)
        const n = others.size + (willRecord ? 1 : 0)
        console.log(`  [${r.verdict || '—'}] ${r.claim}`)
        console.log(`      记于: ${r.originProject}${r.id ? ' ' + r.id : ''} ｜ 已被 ${n} 个项目复现` + (others.size ? `（${[...others].join('、')}）` : ''))
        if (appendReuse(r.originProject, r.id, norm)) {
          console.log(`      · 已在本项目 audits/负知识复用.jsonl 留痕（归属 = ${queryProject}）`)
        }
      }
      if (same.length === 0) console.log('      （同名 0 条 ⇒ 本项目这条主张**未见**历史证伪结论；上列弱命中**不算**复现）')
      if (!queryProject) console.log('      ⚠️ 未给 `--project` ⇒ **不落痕、不计入聚合**（无法归属到项目）')
    } else if (queryProject) {
      console.log('· 未给 `--claim` ⇒ 只走弱判据提示层，**不产生复用计数**（口径见 负知识账本.md §九.2）')
    }
  }

  if (all.length === 0) {
    console.log('查池结果: 空池，无命中')
    console.log('⚠️ 池内 0 条：此刻选「检索=仅本地素材」档 B 将无任何合法来源（除非另有主人投喂）——见 素材池.md §11.5 第 4 条，须三选一并留痕')
    return
  }

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
