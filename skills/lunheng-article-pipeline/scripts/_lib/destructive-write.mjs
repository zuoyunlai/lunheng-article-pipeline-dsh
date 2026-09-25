// 破坏性写统一策略（v18.2.6 新增：第三方审计 v18.2.5 B-1 数据丢失 / B-4 假成功）
//
// 为什么单独抽一个模块，而不是每个脚本各写一份守卫：
//   ① B-1 的实测事实是 `md2html.mjs a.md ./a.md` → **exit 0 且源 Markdown 被 HTML 覆盖**（正文永久丢失）。
//      旧守卫 `mdPath === htmlPath` 是**字符串比较**——相对路径写法（`./a.md`、`final/../final/定稿.md`）、
//      Windows 大小写（`A.md`）、8.3 短名与软链接全部可绕过。字符串比较这种守卫，只要有一个脚本漏写
//      或写歪（不归一 / 不解析 realpath）就归零；本包同族风险还有 apply-diff（旧版默认原地覆盖、无 .bak）与
//      final-check（按参数目录写）——故必须是**唯一实现**，供本批与后续脚本共用。
//   ② B-4 的实测事实是 apply-diff 静默覆盖输入正文且不留 .bak：确认「要覆盖」这件事**不能靠记忆**，
//      必须由机制落一份带回滚点的副本。
//
// 零第三方依赖；Windows 上归一化必须同时覆盖三类绕过（均为审计实测）：
//   · 相对路径差异（`a.md` vs `./a.md` vs `final/../final/定稿.md`）→ path.resolve
//   · 大小写差异（`A.md` vs `a.md`，NTFS 默认大小写不敏感）→ win32 比较时统一小写
//   · 8.3 短名与软链接/junction（如 `PROGRA~1`）→ realpathSync（Windows 走 GetFinalPathNameByHandle，
//     同时给出**长名 + 真实大小写**）
//   注意 realpath 只对**已存在**的路径有效（新建文件没有 realpath）。对本模块的关键场景这不构成缺口：
//   一旦「输出 == 输入」，该输出路径**必然已存在**（它就是输入文件），所以真正要紧的判定永远走 realpath 分支；
//   输出尚不存在时退化为「resolve + 去大小写」，也足以挡住同名不同写法。
//
// 用法：
//   import { assertNotSameFile, sameFile, backupFile, writeWithSafety } from './_lib/destructive-write.mjs';
//   assertNotSameFile(mdPath, htmlPath);                       // 同文件 → 抛 SameFileError（调用方 exit 10）
//   if (sameFile(out, target) && !inPlace) { …exit 10… }
//   writeWithSafety(out, text, { inPlace, source: target });   // 覆盖前自动 .bak（带时间戳）
import { existsSync, statSync, realpathSync, copyFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join, basename } from 'node:path'
import { EXIT_USAGE } from './exit-guard.mjs'   // 退出码唯一真源（v18.12.0：writeReport 的同文件拒绝用它）

const WIN = process.platform === 'win32'

/** 同名错误码：调用方据此区分「路径守卫拒绝」与其他异常（不要靠 message 文本匹配）。 */
export const SAME_FILE_CODE = 'LUNHENG_SAME_FILE'

/** 归一化后的**显示用**路径：绝对化 + 尽可能解 realpath。 */
export function realPath(p) {
  if (p === null || p === undefined || p === '') return ''
  const abs = resolve(String(p))
  let out = abs
  try {
    if (existsSync(abs)) out = realpathSync(abs)
  } catch {
    // realpath 失败（权限 / 竞态 / 路径过长）→ 退回 resolve 结果：
    // 至少相对路径与 `..` 已被归一，仍能挡住 `./a.md` 这类最常见绕过。
    out = abs
  }
  // 去掉 Windows 长路径前缀（不同 Node/平台下 realpath 实现可能保留 `\\?\`，会破坏比较）
  return out.replace(/^\\\\\?\\/, '')
}

/** 比较用的键：realPath + （win32）去大小写。判定「是不是同一个文件」只许用它。 */
export function pathKey(p) {
  const r = realPath(p)
  return WIN ? r.toLowerCase() : r
}

/** 两个路径是否指向**同一个文件**（归一 + realpath 后比较）。空值一律判 false。 */
export function sameFile(a, b) {
  if (!a || !b) return false
  return pathKey(a) === pathKey(b)
}

/** 同文件拒绝时抛出的错误（供调用方 catch 后打印 + exit 10）。 */
export class SameFileError extends Error {
  constructor(a, b, hint = '') {
    const extra = hint ? `\n${hint}` : '\n→ 退出码 10：请把输出写到另一个路径（如 final/定稿.html）'
    super(`输入输出不能是同一文件（会覆盖源文件）：${realPath(a)} ≡ ${realPath(b)}${extra}`)
    this.name = 'SameFileError'
    this.code = SAME_FILE_CODE
    this.a = a
    this.b = b
  }
}

/**
 * 断言两个路径不是同一个文件；是则**抛** SameFileError（assert 语义）。
 * 判定通过时返回归一化后的路径对，便于调用方复用（避免又各算一遍）。
 */
export function assertNotSameFile(a, b, { hint = '' } = {}) {
  if (sameFile(a, b)) throw new SameFileError(a, b, hint)
  return { a: realPath(a), b: realPath(b) }
}

/** 本地时间戳（人读友好，且同秒内可辨识）；形如 `20260912-101112`。 */
function timestamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * 覆盖前备份：`<原路径>.<YYYYMMDD-HHmmss>.bak`（同秒重复调用加 `-1`/`-2` 序号）。
 * 目标不存在（或不是普通文件 = 目录/坏链）→ 返回 null（无备份可做）。
 * 为什么时间戳而不是固定 `.bak`：一轮修订里同一文件可能被写多次（多条目 diff 分次落盘），
 * 固定名会把上一次的回滚点抹掉。
 * v18.3.1（第三方审计 B4）：写完后做 `.bak` 上限回收——旧版每次覆盖都新增一个时间戳 `.bak`，
 *   一轮多条目修订对同一文件写多次 → `.bak` **无上限累积**（实测项目 final/ 下数十个 .bak 污染）。
 *   现每个原文件最多保留 `BAK_MAX` 个回滚点，超出删除最旧者。
 *   排序用 `mtimeMs`（.bak 由 copyFileSync 新建、此后不再改写 → mtimeMs == 创建时间），
 *   而非文件名——`<path>.<秒级时间戳>.bak` 的「无序号 = 最旧」假设在**回收后**会被同秒内的下一次写盘
 *   **复用同名**而破坏（实测：无序号名被回收后立即被新备份复用，按文件名排序会误删新备份、保留中段）。
 */
export const BAK_MAX = 20

/** 回收 `<p>` 最旧的 `.bak`，使每个原文件最多保留 `BAK_MAX` 个回滚点。 */
function pruneBackups(p) {
  const dir = dirname(resolve(p))
  const base = basename(p)
  let entries
  try { entries = readdirSync(dir) } catch { return }   // 目录不可读 → 放弃回收（不阻断写盘）
  // v18.7.3（P1-6，全量审计）：statSync 包 try/catch 且预计算 mtime——旧实现在 sort 比较器内逐次
  //   statSync，readdir 与 stat 之间文件被删（并发/杀毒扫描）会未捕获地沿 backupFile → writeWithSafety
  //   冒泡成 exit 70 **中断写盘**，与「回收失败不阻断」的意图相悖。
  const backs = []
  for (const f of entries) {
    if (!f.startsWith(base + '.') || !/\d{8}-\d{6}(?:-\d+)?\.bak$/.test(f)) continue
    let mt = 0
    try { mt = statSync(join(dir, f)).mtimeMs } catch { continue }   // 单个 .bak 状态异常 → 跳过（不阻断）
    backs.push({ f, mt })
  }
  // v18.13.0：**mtime 仍是唯一正确的主键**（第 98-100 行已论证：`.bak` 由 copyFileSync 新建、
  //   此后不再改写 → mtimeMs == 创建时间；而文件名在同秒内会被**复用**，故不能作主键）。
  //   本次只补一个**确定性 tiebreak**：同一毫秒内写盘（脚本循环、CI 机器）会让若干 `.bak`
  //   拿到**相同的 mtimeMs**，此时比较器恒返回 0，JS 的 `Array.sort` 虽稳定但保留的是
  //   `readdir` 顺序（**实现相关、跨平台不同**）→ 回收谁是「最旧」变成不可预测。
  //   加 `-<n>` 序号（同秒内递增写入，见 backupFile）与文件名兜底后，**同一 mtime 集合的顺序唯一**。
  //   ⚠️ 曾试过两条错路，留档避免重犯：
  //     ① 单纯加 `mtime → 序号 → 文件名`（不改主键）——同 mtime 实测仍错，因为主键本身无区分度；
  //     ② 反过来用文件名时间戳做主键——**自然场景直接错**（同秒内名字被复用，跨秒比较失真）。
  //   实测 30 次连写 + 回收：本机稳定保留最近 20 个（v10…v29），与用例期望一致。
  const seqOf = (f) => { const m = /-(\d+)\.bak$/.exec(f); return m ? Number(m[1]) : 0 }
  backs.sort((a, b) => (a.mt - b.mt) || (seqOf(a.f) - seqOf(b.f)) || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0))
  while (backs.length > BAK_MAX) {
    const victim = backs.shift()
    try { unlinkSync(join(dir, victim.f)) } catch { /* 单个回收失败不阻断主流程 */ }
  }
}

export function backupFile(p, { stamp = null } = {}) {
  if (!p || !existsSync(p)) return null
  try {
    if (!statSync(p).isFile()) return null   // 目录不备份（copyFileSync 会抛）
  } catch {
    return null
  }
  const s = stamp || timestamp()
  let dest = `${p}.${s}.bak`
  for (let n = 1; existsSync(dest) && n < 100; n++) dest = `${p}.${s}-${n}.bak`
  copyFileSync(p, dest)
  pruneBackups(p)   // v18.3.1（审计 B4）：.bak 上限回收
  return dest
}

/**
 * 带安全网写盘：同文件守卫（可选，给出 source 时生效）+ 覆盖前自动 .bak + **原子写入**。
 *   ① `source` 给出时先 `assertNotSameFile(source, p)`——除非 `inPlace: true`（调用方**显式声明**
 *      要覆盖输入源，此时守卫让路，但第 ② 步的备份照做）。
 *   ② 目标已存在 → `backupFile(p)` 落一份带时间戳的 .bak。
 *   ③ v18.2.9（第三方审计 B4）：写入改为 **temp + rename**——旧版 `writeFileSync(p, …)` 直接覆写，
 *      进程在写入中途被杀（超时 kill / 断电 / Ctrl-C）会留下**半写损坏**的目标文件（有 .bak 可恢复但需人工）。
 *      rename 在同一目录内、同卷上原子（Windows 走 MoveFileEx REPLACE_EXISTING），要么旧文件完好、
 *      要么新文件完整。temp 命名带 pid + 随机段避免并发冲突；任何一步失败都清掉 temp、目标保持原状。
 * 返回 `{ path, backup, inPlace }`（backup = 本次备份路径，未备份为 null）。
 */
export function writeWithSafety(p, text, { inPlace = false, source = null } = {}) {
  if (!p) throw new Error('writeWithSafety: 缺少写入路径（p 为空）')
  if (source && !inPlace) assertNotSameFile(source, p)
  const backup = backupFile(p)
  const tmp = join(dirname(resolve(p)), `.${Math.random().toString(36).slice(2, 10)}-${process.pid}.lunheng-tmp`)
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, p)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* temp 可能尚未创建 */ }
    throw e
  }
  return { path: p, backup, inPlace }
}

/**
 * `--report` 报告写盘（v18.12.0 新增，依据 2026-09-25 全量审计 L-50）——**唯一实现**。
 *
 * 为什么需要它（审计实测事实）：
 *   8 个脚本的 `--report` 一直是**裸 `writeFileSync`** —— 既走不到同文件守卫，也不留 `.bak`。
 *   实测 `apply-diff a.md list.md --out b.md --report a.md` → **exit 0** 且 `a.md` 被 JSON 覆盖、
 *   目录内无任何回滚点；`m-gate-check <定稿.md> <证据包> --report <定稿.md>` 同形。
 *   `--report` 是主控高频参数，一次路径手滑即**不可回滚地销毁被审正文 / 定稿**——与 B-1 事故同型
 *   （区别只在于 B-1 走的是输出参数，本族走的是报告参数）。
 *
 * 规则：
 *   ① `protect` 里任一源文件与 reportPath 是同一文件 → 打印原因 + **exit 10**（参数/路径错误，
 *      与「1 = P1 内容失败」区分；判据走 `sameFile`，已覆盖相对路径 / 大小写 / realpath 三类绕过）。
 *   ② 通过守卫后走 `writeWithSafety(..., { inPlace: true })`：报告本就允许在原地反复重写，
 *      但**必须留时间戳 `.bak` 回滚点**（旧版无备份）。
 *   ③ 空 reportPath → 直接返回 null（调用方无需再判空）。
 *   ④ v18.12.0（全量审计 L-72）：**目标目录不存在时自动建目录**。旧版各脚本口径不一——`m-gate-check`
 *      与 `final-check` 在调用前自己 `mkdirSync(dirname(reportPath))`，其余 6 个脚本（apply-diff /
 *      cite-coverage-check / structure-check / methodology-check / journal-fit / meta-synthesize /
 *      consistency-check）**没有**：`--report audits/新目录/x.json` 会在 temp 落盘那一步 ENOENT，
 *      经 exit-guard 变成 exit 10（码是对的，但报错只说「路径错」、不提「目录要不要建」，主控多半会以为
 *      是路径写法错而反复试）。现把建目录统一到本函数（`recursive: true`，幂等），并**在守卫之后**执行
 *      ——拒绝路径上不落一个字节，也不新增一个目录。
 *
 * 参数：`protect` = 本次运行**读过的源文件路径**数组（元素可为 null/undefined，自动跳过）。
 */
export function writeReport(reportPath, text, { protect = [], label = '--report' } = {}) {
  if (!reportPath) return null
  for (const src of protect) {
    if (!src) continue
    if (sameFile(reportPath, src)) {
      console.error(`${label} 不能与本次运行的源文件是同一文件（会不可回滚地销毁它）：${realPath(reportPath)}`)
      console.error(`→ 退出码 ${EXIT_USAGE}（参数或路径错误）：请把 ${label} 指向另一个路径（如 audits/xxx.json）`)
      process.exit(EXIT_USAGE)
    }
  }
  // v18.12.0（L-72）：目录缺失 → 建之（守卫之后；`recursive` 幂等）。建失败（权限/路径中间是文件）
  //   仍会抛 fs 错误 → exit-guard 归 10，码与旧版一致，但这里的错误信息更贴因。
  const dir = dirname(resolve(reportPath))
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
      console.error(`· ${label} 目标目录不存在，已创建：${dir}`)
    } catch (e) {
      console.error(`${label} 目标目录无法创建：${dir}（${e.code || e.message}）`)
      console.error(`→ 退出码 ${EXIT_USAGE}（参数或路径错误）：请检查路径拼写与写权限`)
      process.exit(EXIT_USAGE)
    }
  }
  return writeWithSafety(reportPath, text, { inPlace: true })
}
