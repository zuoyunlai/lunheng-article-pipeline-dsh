// run/ 路径围栏（v18.62.5 全量审计-性能与安全 §P2-6 修复共享工具）
//
// 为什么必须抽出来（v18.62.4 报告 §P2-6）：同族「读 run/」语义在三个入口里实现出三套安全强度——
//   · `lib/commands.js` 的 `pickProject`：三层收口（词法 → 结构 → 物理 realpath）
//   · `lunheng-stats.mjs` 的 `--run-dir`：白名单 + 包含关系
//   · `history-cli.mjs` 与 `pending-cli.mjs`：完全无围栏（`projectId` 直接 join，可 `../` 越界）
// 「同族收紧 ≠ 一致」原则在本仓 2 次出现（cli-args.mjs 头注释与本仓对应）。
//
// 三层缺一不可：
//   ① 词法层：拒绝对路径 / 路径分隔符 / `.` / `..` / 空段；
//   ② 结构层：解析结果必须是 runDir 的**直接子目录**（不允许再下一层）；
//   ③ 物理层：用 realpath 解析后**再判一次**——防 `run/<软链接>` 指到工作区之外。

import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative as relativePath, resolve, sep } from 'node:path'

/**
 * v18.80.4（矩阵测试实测抓出 · 本文件注释里「只 realpath 一侧」缺陷的**再次复现**）：
 * canonical 化一个**可能不存在**的路径——把**存在的最近祖先**做 realpath，再接回剩余段。
 *
 * 病根：`realOrResolve` 对**不存在的候选**退回**字面 resolve**，而另一侧（runDir）已 canonical
 *   → 两侧落在不同路径空间 → **合法路径被判越界**（fail-closed，但会拒绝正常操作）。
 *   实测触发面（CI 两平台红、本机 Windows 绿）：macOS 的 `os.tmpdir()` 是 `/var/folders/…`，
 *   而它是指向 `/private/var/folders/…` 的**软链接**；Windows 的 TEMP 亦可能是 junction / 8.3 短名。
 *   ⇒ 凡「runDir 与候选路径共享一个被链接的前缀，而候选**尚未创建**」的调用都会中招。
 * 判据：**「路径不存在」不是退回未规范化形式的理由**——祖先存在就足以把它归一到同一空间。
 * 边界（如实）：整条路径都不存在（连根都 realpath 不了）时退回字面 `resolve`，与旧行为一致。
 */
function canonicalBest(p) {
  const literal = resolve(String(p))
  let cur = literal
  const rest = []
  for (;;) {
    try {
      const rp = realpathSync.native(cur)
      return rest.length ? join(rp, ...rest.reverse()) : rp
    } catch { /* 该层不存在 → 上溯一层 */ }
    const parent = dirname(cur)
    if (parent === cur) return literal   // 已到根仍失败 → 退回字面形式（不劣于旧实现）
    rest.push(basename(cur))
    cur = parent
  }
}

/** 平台大小写归一（Windows 路径不敏感）。 */
const norm = (s) => (process.platform === 'win32' ? s.toLowerCase() : s)

/**
 * 词法层判据：项目名必须是 `run/` 下的直接子目录名（即单段，无绝对路径、无分隔符）。
 * @param {string} arg - 原始字符串
 * @returns {boolean}
 */
export function isSafeProjectArg(arg) {
  const s = String(arg ?? '').trim()
  if (!s || s === '.' || s === '..') return false
  if (isAbsolute(s)) return false
  if (/[\\/]/.test(s)) return false
  return true
}

/**
 * 结构层 + 物理层判据：解析后的项目目录是否仍是 runDir 的直接子目录。
 * @param {string} runDir - run/ 目录绝对路径（已规范化）
 * @param {string} projectPath - 待校验路径（绝对）
 * @returns {boolean}
 */
export function isDirectChildOf(runDir, projectPath) {
  const rel = relativePath(norm(canonicalBest(runDir)), norm(canonicalBest(projectPath)))
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return false
  return !/[\\/]/.test(rel)   // 直接子目录：相对路径里不得再有分隔符
}

/**
 * 路径级三层判据：`cand` 是否落在 `<runDir>` 之内（runDir 自身或其子孙）。
 *
 * 为什么需要它（v18.67.0 全量审计 P1 修复）：`--run-dir` 这类「传目录路径」语义此前有两套实现，
 *   且两套都**放弃物理层**——只做字符串规范化 + 大小写归一。后果：`<工作区>/run/` 内放一个
 *   junction / 软链接指向工作区外（如 `C:\敏感数据`），字符串包含判定通过 → 有宿主完整权限的脚本
 *   读取工作区外目录。与本文件「三层缺一不可」的教义直接冲突。
 * 假拒绝的真根因（v18.62.4 实测）：**只 realpath 一侧**，两侧落在不同路径空间 → relative() 假越界。
 *   两侧同 realpath 后同空间比较，合法路径不再误伤、junction 逃逸被拦。
 * 降级（如实）：realpath 失败（网络盘暂不可达等）退回字符串规范化，行为不劣于旧实现。
 *
 * @param {string} runDir - run/ 目录绝对路径
 * @param {string} cand - 待校验路径（绝对）
 * @returns {boolean}
 */
export function isPathInsideRunDir(runDir, cand) {
  if (!runDir || !cand) return false
  if (!isAbsolute(String(cand))) return false
  // ① 词法层：不得含 `..` 段（`.` 段由 resolve 吃掉，无害）
  const rel0 = relativePath(runDir, cand)
  if (rel0 === '..' || rel0.startsWith('..' + sep) || isAbsolute(rel0)) return false
  // ② 结构层 + ③ 物理层：两侧**同入 canonical 空间**后再判包含
  //    v18.80.4：改用 `canonicalBest`（存在则 realpath，**不存在则 canonical 化存在的最近祖先**）——
  //    此前候选不存在时退回字面 resolve，与已 canonical 的 runDir 不同空间 → 合法路径被误判越界
  //    （macOS `/var`→`/private/var`、Windows junction/短名实测触发；见该函数头注释）。
  const normPath = (p) => norm(String(p).replace(/[\\/]+$/, '').replace(/\//g, sep))
  const a = normPath(canonicalBest(runDir))
  const b = normPath(canonicalBest(cand))
  return b === a || b.startsWith(a + sep)
}

/**
 * 三层收口合一：把 `arg` 在 `runDir` 下挑出「直接子目录」的项目目录。
 * 任何一层不通过 → 返回 null（调用方报「未找到项目」或类似路径错）。
 *
 * @param {string} runDir - run/ 目录（绝对路径，调用方已 join）
 * @param {string} arg - 项目名（一个相对路径段）
 * @returns {string|null} 规范化后的项目目录绝对路径；不合法 → null
 */
export function resolveProjectDir(runDir, arg) {
  if (!arg) return null
  if (!isSafeProjectArg(arg)) return null
  const p = runDir.endsWith(sep) ? runDir + arg : runDir + sep + arg
  if (!existsSync(p)) return null
  if (!isDirectChildOf(runDir, p)) return null
  return p
}