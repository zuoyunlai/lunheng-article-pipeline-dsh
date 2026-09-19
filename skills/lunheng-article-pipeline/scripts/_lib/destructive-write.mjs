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
import { existsSync, statSync, realpathSync, copyFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
 */
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
  return dest
}

/**
 * 带安全网写盘：同文件守卫（可选，给出 source 时生效）+ 覆盖前自动 .bak + 写入。
 *   ① `source` 给出时先 `assertNotSameFile(source, p)`——除非 `inPlace: true`（调用方**显式声明**
 *      要覆盖输入源，此时守卫让路，但第 ② 步的备份照做）。
 *   ② 目标已存在 → `backupFile(p)` 落一份带时间戳的 .bak。
 * 返回 `{ path, backup, inPlace }`（backup = 本次备份路径，未备份为 null）。
 */
export function writeWithSafety(p, text, { inPlace = false, source = null } = {}) {
  if (!p) throw new Error('writeWithSafety: 缺少写入路径（p 为空）')
  if (source && !inPlace) assertNotSameFile(source, p)
  const backup = backupFile(p)
  writeFileSync(p, text, 'utf8')
  return { path: p, backup, inPlace }
}
