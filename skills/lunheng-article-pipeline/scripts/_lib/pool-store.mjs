// 素材池共享读写（v19.6.1 · 审计 2026-10-15 全量批 P1-2 / P1-3 / P2-6）
//
// ── 为什么抽这一个模块（病灶不是「代码重复」，是「派生量被当成独立状态」）────────────────
// 三个 pool 脚本此前各自维护同一份事实（池文件清单 / 容忍 BOM 的 readJson / manifest 计数字段），
// 于是必然漂——审计实测两处可复现缺陷，根因同类：
//   · **P1-1**：`pool-extract` 里 `reuseCount` 的递增判据（每次命中去重键）与 `reusedBy` 的判据
//     （`includes()` 去重）不一致 → 同一项目重复抽取（Phase 5 之后的修订轮/重跑交付）线性虚增；
//   · **P1-2**：`pool-query.ensureSkeleton()` 的判据只看「`manifest.json` 在不在」，而写入的计数
//     **恒为 0** → 池里有数据时产出「自称 0 条」的 manifest，且下一次 `pool-extract` 之前**不自愈**；
//     实测同一进程内先打印「（0 条）」再打印「命中 1/1 条」。
//   共同根因：`totalEntries` / `byType` / `byChannel` / `reuseCountTotal` 这类**派生量**被当成了
//   独立持久状态。本模块把「**manifest 一律由池文件重算**」立为唯一口径，三个脚本全部走它。
//
// ── 写盘（P1-3）─────────────────────────────────────────────────────────────────────
// 池文件与 manifest 是**持久化的状态产物**，覆盖前一律经 `_lib/destructive-write.mjs` 的
//   `writeWithSafety`（temp→rename 原子写 + 时间戳 `.bak` 回滚点）。旧版是裸 `writeFileSync`——
//   写入中途被 kill（超时 / Ctrl-C / 断电）会留下半写文件且**无任何回滚点**。
//
// 边界（如实）：本模块**不做并发控制**。`pool-*` 三脚本是主控单进程顺序调用（Phase 0.5 查池 /
//   Phase 5 回写），当前不存在并发写同一池的调用路径；「读-改-写丢失更新」因此属**设计缺口**
//   而非已发生事故——原子化只消除「半写损坏」，不消除并发语义。
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeWithSafety } from './destructive-write.mjs'

/** 池文件清单（键 = 类型码）。**单一真源**——`pool-query` / `pool-extract` / `pool-report` 共用。
 *  真源口径见 `references/_shared/素材池.md` §二（目录结构）。 */
export const POOL_FILES = { L: 'literature.json', D: 'data.json', C: 'cases.json', DB: 'databases.json' }

/** manifest 里属于**派生量**的字段（必须每次重算，不得采信盘上的旧值）。 */
export const DERIVED_FIELDS = ['totalEntries', 'byType', 'byChannel', 'reuseCountTotal']

export const todayStr = () => new Date().toISOString().slice(0, 10)

/** 读 JSON 容忍 BOM（Windows PowerShell `Set-Content -Encoding UTF8` 会带 `\uFEFF`）。
 *  v18.96.0 起两个脚本各写了一份（审计 P2-6④ 的观察点：作者遇到过真实输入问题却没固化成用例）；
 *  现统一到本模块，回归用例见 `tests/scripts/pool-query.test.mjs` / `pool-report.test.mjs`。 */
export const readJsonTolerant = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))

export const poolFilePath = (poolDir, key) => join(poolDir, POOL_FILES[key])

/** 池目录的**空骨架**：目录树 + 四个池文件。
 *  · 已存在的池文件**不覆盖**（可能已有数据——这是 v18.96.0 就做对的一点，保留）；
 *  · **不写 manifest**：manifest 由 `writeManifest()` 重算产生（P1-2）。
 *  @returns `true` = 本次至少新建了一个池文件（供调用方决定是否报「已创建骨架」）。 */
export function ensurePoolSkeleton(poolDir) {
  const dirs = ['raw/books', 'raw/datasets', 'raw/papers', 'raw/misc', 'transcripts']
  for (const d of dirs) mkdirSync(join(poolDir, d), { recursive: true })
  let created = false
  for (const f of Object.values(POOL_FILES)) {
    const p = join(poolDir, f)
    if (existsSync(p)) continue
    writeWithSafety(p, JSON.stringify({ version: 1, entries: [] }, null, 2) + '\n', { inPlace: true })
    created = true
  }
  return created
}

/** 从四个池文件**现算**派生量（manifest 的唯一合法来源）。
 *  坏池文件按「空」计（与 `pool-query` 既有容错同口径），**不抛**——一个坏文件不得让整池读不出。 */
export function poolFacts(poolDir) {
  const byType = { L: 0, D: 0, C: 0, DB: 0 }
  const byChannel = { '主人预设': 0, '项目沉淀': 0 }
  let reuseCountTotal = 0
  let totalEntries = 0
  for (const key of Object.keys(POOL_FILES)) {
    const p = join(poolDir, POOL_FILES[key])
    if (!existsSync(p)) continue
    let entries = []
    try { entries = readJsonTolerant(p).entries || [] } catch { entries = [] }
    byType[key] = entries.length
    totalEntries += entries.length
    for (const en of entries) {
      byChannel[en.channel] = (byChannel[en.channel] || 0) + 1
      reuseCountTotal += (en.reuseCount || 0)
    }
  }
  return { totalEntries, byType, byChannel, reuseCountTotal }
}

/**
 * 重算并写盘 `manifest.json`（原子写 + 时间戳 `.bak`）。
 * @param {string} poolDir
 * @param {{ onlyIfStale?: boolean }} [opt] `onlyIfStale` = 四个派生字段与盘上一致时**不写**
 *   （供只读入口 `pool-query` 使用：既不产生无意义的 `.bak` 噪声，又能在 manifest 缺失/失真时自愈）。
 * @returns {{ manifest: object, written: boolean }}
 */
export function writeManifest(poolDir, { onlyIfStale = false } = {}) {
  mkdirSync(poolDir, { recursive: true })
  const mf = join(poolDir, 'manifest.json')
  const onDisk = existsSync(mf)
  let prev = {}
  if (onDisk) { try { prev = readJsonTolerant(mf) } catch { prev = {} } }
  const facts = poolFacts(poolDir)
  const m = {
    ...prev,                                   // 未知附加字段保留（与 v18.96.0 updateManifest 的就地改写同语义）
    createdAt: prev.createdAt || todayStr(),
    ...facts,                                  // 四个派生量**一律重算**，覆盖盘上旧值
  }
  m.lastUpdated = todayStr()
  if (onlyIfStale && onDisk && DERIVED_FIELDS.every((k) => JSON.stringify(prev[k]) === JSON.stringify(m[k]))) {
    return { manifest: m, written: false }
  }
  writeWithSafety(mf, JSON.stringify(m, null, 2) + '\n', { inPlace: true })
  return { manifest: m, written: true }
}
