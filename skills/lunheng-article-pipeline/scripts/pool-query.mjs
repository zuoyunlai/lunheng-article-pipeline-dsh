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
// manifest 口径（v19.6.1 · 审计 2026-10-15 全量批 **P1-2**）：`manifest.json` 的计数全是**派生量**，
//   一律由池文件**重算**（真源 = `_lib/pool-store.mjs`）。旧版 `ensureSkeleton()` 的判据只看
//   「manifest.json 在不在」，写进去的计数**恒为 0** → 池内有数据时产出一份「自称 0 条」的 manifest，
//   实测同一进程内先打印「✅ 已创建空素材池骨架（0 条）」再打印「命中 1/1 条」；且在下次跑
//   `pool-extract` 之前**不自愈**——而主人侧读面正是本脚本与 `pool-report`。
//
// 退出码：0 = 成功（含「空池无命中」）｜ 10 = 参数/路径错 ｜ 70 = 内部错误
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { installExitGuard, requireExistingDir, EXIT_USAGE } from './_lib/exit-guard.mjs'
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs'
import { POOL_FILES, ensurePoolSkeleton, poolFilePath, readJsonTolerant, writeManifest } from './_lib/pool-store.mjs'

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

function main() {
  const created = ensurePoolSkeleton(poolDir)
  const all = readAll()
  // manifest 是派生量的副本：**每次查池都重算**，与盘上一致时不落盘（避免只读路径产生无意义的 `.bak` 噪声），
  // 不一致或缺失时**自愈**并如实报出（「不静的降级」——修复动作必须可见）。
  const mw = writeManifest(poolDir, { onlyIfStale: true })

  // v19.6.6（素材池可见性批）：**每轮都显形**——旧版只在新建骨架时报一次路径，非空池且无命中时全程静默，
  //   而本脚本是主人侧的**读面**（Phase 0 显形 / Phase 0.5 查池）：用户据此才知道池在哪、有多少、
  //   档 B「仅本地素材」是不是可用（池 0 条 + 无投喂 ⇒ 档 B 不适用，真源 = `素材池.md` §11.5 第 4 条）。
  console.log(`· 素材池: ${poolDir}（现有 ${all.length} 条）`)
  if (created) console.log('✅ 已创建素材池骨架——长期共享原件请放 raw/{books,datasets,papers,misc}/（A 轨）；本项目一次性材料走 run/<项目>/主人投喂清单.md（B 轨）')
  else if (mw.written) console.log('· manifest 与池文件不一致（派生量失真），已按池文件重算（池文件是唯一真源）')
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
