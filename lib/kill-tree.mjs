// 终止子进程树（v19.27.16 · 全量静态审计 R-05）。
//
// 病灶：`lib/tools.js` 的超时/取消只对**直接子进程**发 SIGTERM/SIGKILL。Windows 的
//   `TerminateProcess` 不会级联到孙子进程；脚本内部再 `spawn` 的 node/git 会在超时后残留。
// 判据（跨平台，尽力而为、绝不抛错）：
//   · win32：`taskkill /PID <pid> /T /F` —— /T 递归终止整棵树（系统内建，无新增依赖）；
//   · 其它：先按进程组 `kill(-pid)`（**仅当宿主以 detached 启动子进程时有效**），再对直接子进程兜底。
// 边界（如实）：本函数是 best-effort；进程已退出、权限不足、pid 复用等情形都只做静默忽略。
import { spawn } from 'node:child_process'

/**
 * @param child - `node:child_process` 的 ChildProcess（至少有 `pid` / `kill`）。
 * @param signal - POSIX 信号名（win32 忽略，恒用 /F）。
 */
export function killTree(child, signal = 'SIGTERM') {
  if (!child || typeof child.pid !== 'number' || child.pid <= 0) return
  if (process.platform === 'win32') {
    try {
      const p = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      p.on('error', () => {})
      if (typeof p.unref === 'function') p.unref()
    } catch { /* 已退出 / 无权限：忽略 */ }
    return
  }
  try { process.kill(-child.pid, signal) } catch { /* 非进程组组长 / 已退出 */ }
  try { child.kill(signal) } catch { /* 已退出 */ }
}
