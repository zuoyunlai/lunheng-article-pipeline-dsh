// 退出码硬化（v18.0.5 新增：第三方审计 P1-1 / P1-5）
//
// 背景：v18.0.2 统一了**显式分支**里的退出码（路径错 = 10），但**未捕获异常**仍然走 Node 默认的 exit 1，
//   而 1 的语义是「P1 内容失败」——于是 `count-chars <目录>`、`m-gate-check <目录> <目录>` 这类
//   传参/路径错误会被主控读成「正文有 P1 残留，可触发 T5 修订一轮」（实测 final-check 甚至输出该建议）。
//   本模块把异常路径收敛到两个**语义明确**的码：
//     · 文件系统类错误（EISDIR/ENOTDIR/ENOENT/EACCES/EPERM/…）→ 10（参数或路径错误，同显式分支）
//     · 其余内部错误（脚本缺陷）→ 70（EX_SOFTWARE，与任何内容判定码都不撞）
//   两者都不与 0/1/2/3 的 M 门语义混用；`docs/troubleshooting.md §8` 与 `AGENTS.md` 同步登记。
//
// 用法（每个读盘的随包脚本顶部）：
//   import { installExitGuard, requireExistingFile, requireExistingDir } from './_lib/exit-guard.mjs';
//   installExitGuard();          // 必须在任何 readFileSync 之前
//   requireExistingFile(p, '正文');  // 存在 + 是文件，否则 exit 10（含友好提示）
import { existsSync, statSync } from 'node:fs'

export const EXIT_USAGE = 10
export const EXIT_INTERNAL = 70

const FS_CODES = new Set(['EISDIR', 'ENOTDIR', 'ENOENT', 'EACCES', 'EPERM', 'EMFILE', 'ENFILE', 'ENAMETOOLONG', 'ELOOP', 'EBUSY'])

/** 安装异常兜底：fs 类 → 10；其余 → 70。幂等（重复调用只装一次）。 */
export function installExitGuard() {
  if (globalThis.__lunhengExitGuard) return
  globalThis.__lunhengExitGuard = true
  process.on('uncaughtException', (err) => {
    const code = err && typeof err.code === 'string' ? err.code : ''
    if (FS_CODES.has(code)) {
      console.error(`参数/路径错误（${code}）：${err.message}`)
      console.error(`→ 退出码 ${EXIT_USAGE}（参数或路径错误，与「1 = P1 内容失败」区分；见 docs/troubleshooting.md §8）`)
      process.exit(EXIT_USAGE)
    }
    console.error(`内部错误（脚本缺陷，非内容判定）：${err && err.stack ? err.stack : err}`)
    console.error(`→ 退出码 ${EXIT_INTERNAL}（EX_SOFTWARE）——请连同上面的栈与命令回报 issue`)
    process.exit(EXIT_INTERNAL)
  })
}

/** 路径必须是**已存在的文件**（目录/软链到目录都算错），否则 exit 10。返回规范化后的路径。 */
export function requireExistingFile(p, label = '文件') {
  if (!existsSync(p)) {
    console.error(`${label}不存在: ${p}`)
    process.exit(EXIT_USAGE)
  }
  let st
  try {
    st = statSync(p)
  } catch (e) {
    console.error(`${label}无法访问: ${p}（${e.code || e.message}）`)
    process.exit(EXIT_USAGE)
  }
  if (!st.isFile()) {
    console.error(`${label}不是文件（可能是目录）: ${p}`)
    console.error('→ 退出码 10：请传具体文件路径（如 final/定稿.md），不要传目录')
    process.exit(EXIT_USAGE)
  }
  return p
}

/** 路径必须是**已存在的目录**，否则 exit 10。 */
export function requireExistingDir(p, label = '目录') {
  if (!existsSync(p)) {
    console.error(`${label}不存在: ${p}`)
    process.exit(EXIT_USAGE)
  }
  let st
  try {
    st = statSync(p)
  } catch (e) {
    console.error(`${label}无法访问: ${p}（${e.code || e.message}）`)
    process.exit(EXIT_USAGE)
  }
  if (!st.isDirectory()) {
    console.error(`${label}不是目录: ${p}`)
    console.error('→ 退出码 10：请传目录路径（如 final/证据包）')
    process.exit(EXIT_USAGE)
  }
  return p
}
