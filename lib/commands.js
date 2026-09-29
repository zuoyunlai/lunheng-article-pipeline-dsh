// 人类命令 `/lunheng-status`（C 组 · v18.1.0）：主人在 1-3 小时长跑中**随时自查进展**，
// 且**不产生模型消息**（官方 `docs/subsystems/commands.md:5`：interactive adapters 用它直接执行命令）。
//
// 官方依据：`commands.md` — `register(definition: CommandDefinition): () => void`；定义字段
//   `{ name, description, input?, recordInput?, handler }`；handler 返回
//   `{ kind:'success', text? }` 或 `{ kind:'error', text }`；`invocation.rawInput` 是命令名之后的原文。
//
// 与工具化的区别（为什么用命令而不是工具）：命令**不进模型上下文**、不占一轮对话，适合「只看一眼」；
// 而「让主控据此改写产物」才需要工具（那由 `lunheng_m_gate` / `lunheng_char_count` 承担）。
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const clip = (s, n) => String(s ?? '').replace(/\s+$/g, '').slice(0, n)

// ── v18.57.x（审计修订 P2）：项目名必须是 `run/` 下的**直接子目录名** ─────────────────────
// 为什么必须收：旧版 `pickProject` 直接 `join(runDir, arg)`，于是
//   `/lunheng-status ..` → 解析到 `<cwd>/run/..` = `<cwd>`，再去读 `<cwd>/status.md` 与
//   `<cwd>/进展-主人版.md`——**读到了 run/ 之外的同名文件**（实测可复现）。
//   危害有限（只读、文件名固定、命令不产生模型消息、调用者是主人本人），但命令的作用域应当
//   与它声明的「读 run/<项目>/」一致，不能因为参数带 `..` 就滑出工作区。
// 收口方式（三层，缺一不可）：
//   ① 词法层：拒绝对路径 / 路径分隔符 / `.` / `..` / 空段；
//   ② 结构层：解析结果必须是 runDir 的**直接子目录**（不允许再下一层）；
//   ③ 物理层：用 realpath 解析后**再判一次**——防 `run/<软链接>` 指到工作区之外。
const isSafeProjectArg = (arg) => {
  const s = String(arg ?? '').trim()
  if (!s || s === '.' || s === '..') return false
  if (isAbsolute(s)) return false
  if (/[\\/]/.test(s)) return false
  return true
}

/** 取 realpath（路径已确认存在；失败则退回 resolve，与 guard.js 的 realpathBest 同旨）。 */
const realOrResolve = (p) => {
  try { return realpathSync.native(p) } catch { return resolve(p) }
}

/** 解析后的项目目录是否仍是 runDir 的直接子目录（realpath + 平台大小写归一后再判）。 */
const isDirectChildOf = (runDir, projectPath) => {
  const norm = (s) => (process.platform === 'win32' ? s.toLowerCase() : s)
  const rel = relative(norm(realOrResolve(runDir)), norm(realOrResolve(projectPath)))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
  return !/[\\/]/.test(rel)   // 直接子目录：相对路径里不得再有分隔符
}

/** 在 `<cwd>/run/` 下挑项目：有参数用参数；否则取 status.md 最近修改的那个。
 *  参数无效或越出 `run/`（含软链接绕过）→ 返回 null（调用方报「未找到项目」）。 */
function pickProject(cwd, arg) {
  const runDir = join(cwd, 'run')
  if (arg) {
    if (!isSafeProjectArg(arg)) return null
    const p = join(runDir, String(arg).trim())
    if (!existsSync(p)) return null
    if (!isDirectChildOf(runDir, p)) return null   // 软链接 / junction 指向 run/ 之外
    return p
  }
  if (!existsSync(runDir)) return null
  const cands = readdirSync(runDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(runDir, e.name))
    .map((p) => {
      const s = join(p, 'status.md')
      return existsSync(s) ? { p, m: statSync(s).mtimeMs } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.m - a.m)
  return cands.length ? cands[0].p : null
}

function firstLines(text, n, { skipHeadings = true } = {}) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !(skipHeadings && /^#{1,2}\s/.test(l)))
    .slice(0, n)
}

/**
 * 注册 `/lunheng-status`。返回 disposer（未安装时 undefined）。
 * @param ctx - 插件 ctx。
 * @param opts.cwd - 兜底基准目录（v18.2.6：**优先用会话工作区**，见 handler 内注释）。
 */
export function installStatusCommand(ctx, { cwd }) {
  const commands = ctx.get('commands')
  if (!commands?.register) return undefined
  return commands.register({
    name: 'lunheng-status',
    description: '查看论衡项目进展（读 run/<项目>/status.md 与 进展-主人版.md；不产生模型消息）',
    input: { hint: '项目名（省略 = run/ 下 status.md 最近修改的项目）' },
    recordInput: true,
    handler: (invocation) => {
      try {
        // v18.2.6 修复（审计 P1-4）：`run/<项目>` 必须按**会话工作区**解析，而不是宿主进程启动目录。
        //   旧实现用入口在 apply 期捕获的 `process.cwd()`（= 宿主启动目录，DSH Desktop / `dsh web` 下
        //   通常不是用户的工作区）→ `/lunheng-status` 会在错误目录里找 `run/`，永远报「未找到项目」。
        //   官方的会话工作区在 `invocation.agent.session.header.cwd`（与 fs 工具同源，
        //   见 `dsh-tool-fs/lib/index.js:225-242`），命令回调**同步就能拿到**，故优先用它，配置只作兜底。
        const sessionCwd = invocation?.agent?.session?.header?.cwd
        const base = typeof sessionCwd === 'string' && sessionCwd.trim() ? sessionCwd.trim() : cwd
        const arg = String(invocation?.rawInput || '').trim().split(/\s+/)[0] || ''
        const project = pickProject(base, arg)
        if (!project) {
          const runDir = join(base, 'run')
          const names = existsSync(runDir)
            ? readdirSync(runDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).slice(0, 12)
            : []
          return {
            kind: 'success',
            text:
              `论衡：未找到项目${arg ? `「${arg}」` : ''}（在 ${resolve(runDir)} 下找 status.md）。` +
              (names.length ? `\n现有项目：${names.join(' / ')}` : '\n（run/ 目录为空或不存在——Phase 0 定题后才会创建）') +
              (sessionCwd ? '' : `\n（提示：本次未能取到会话工作区，已回落到宿主启动目录 ${cwd}）`),
          }
        }
        const statusPath = join(project, 'status.md')
        const progressPath = join(project, '进展-主人版.md')
        const parts = [`论衡项目：${project.replace(/\\/g, '/').split('/').pop()}`]
        if (existsSync(progressPath)) {
          parts.push('— 主人版进展（最新在文件未尾）—', ...firstLines(readFileSync(progressPath, 'utf8'), 12, { skipHeadings: false }))
        }
        if (existsSync(statusPath)) {
          parts.push('— 状态机（status.md 前几行）—', ...firstLines(readFileSync(statusPath, 'utf8'), 10))
        }
        if (!existsSync(progressPath) && !existsSync(statusPath)) parts.push('（该项目目录下既无 进展-主人版.md 也无 status.md）')
        parts.push(`— 路径 —\n${statusPath.replace(/\\/g, '/')}`)
        return { kind: 'success', text: clip(parts.join('\n'), 4000) }
      } catch (e) {
        return { kind: 'error', text: `读取论衡进展失败：${String(e?.message || e).slice(0, 200)}` }
      }
    },
  })
}

/**
 * 注册 `/lunheng-stats`（C 组 · v18.5.0）：聚合 run/ 全部项目的遥测看板（M 门证据覆盖率 /
 *   修订轮数 / 门拦截频率 / 字数 / 审稿），**只读、不产生模型消息**。
 *
 * 与 `/lunheng-status`（读单个项目 status.md）的差别：本命令跨项目聚合，直接复用
 *   `scripts/lunheng-stats.mjs`（CLI 与命令同源，避免两处维护）。命令跑在**宿主进程**（非 agent 沙箱），
 *   故用 `spawnSync` 同步执行脚本——与 tools.js 的异步 `spawn`（跑在沙箱）不同，宿主有完整 spawn 权限。
 * @param ctx - 插件 ctx。
 * @param opts.cwd - 兜底基准目录（同 /lunheng-status，优先会话工作区）。
 * @param opts.skillRoot - 随包技能目录（脚本相对它解析）。
 * @param opts.scriptTimeoutMs - 脚本超时（来自 Config）。
 */
export function installStatsCommand(ctx, { cwd, skillRoot, scriptTimeoutMs }) {
  const commands = ctx.get('commands')
  if (!commands?.register) return undefined
  return commands.register({
    name: 'lunheng-stats',
    description: '聚合 run/ 全部项目的遥测看板（M 门证据覆盖率 / 修订轮数 / 门拦截频率 / 字数 / 审稿评分）；只读，不产生模型消息',
    input: { hint: '（可选）--json；省略 = 全量人读表格' },
    recordInput: true,
    handler: (invocation) => {
      try {
        const sessionCwd = invocation?.agent?.session?.header?.cwd
        const base = typeof sessionCwd === 'string' && sessionCwd.trim() ? sessionCwd.trim() : cwd
        const runDir = join(base, 'run')
        const raw = String(invocation?.rawInput || '').trim()
        // v18.16.0（C-6 反哺 · 岔口 #4 白名单化）：原写法 `raw.split(/\s+/)` 把用户原文整段拼到 argv 末尾，
        //   等于把宿主进程的 spawn 权限交给用户的键盘输入——危险面（详见 SECURITY.md §信任边界）。
        //   现改为只放行 `--json` 一个旗标；其它任何 token 一律拒绝。脚本本身也只读 `run/<项目>`。
        const tokens = raw ? raw.split(/\s+/) : []
        const allowed = tokens.filter((t) => t === '--json')
        const rejected = tokens.filter((t) => t !== '--json')
        if (rejected.length) {
          return {
            kind: 'error',
            text: `/lunheng-stats 仅接受白名单旗标 \`--json\`；收到未授权参数：${rejected.join(' ')}（详见 SECURITY.md 信任边界）`,
          }
        }
        const script = join(skillRoot, 'scripts', 'lunheng-stats.mjs')
        const r = spawnSync(process.execPath, [script, '--run-dir', runDir, ...allowed], {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
          timeout: Number.isFinite(scriptTimeoutMs) && scriptTimeoutMs > 0 ? scriptTimeoutMs : 120000,
        })
        if (r.error) {
          return { kind: 'error', text: `执行 /lunheng-stats 失败（${r.error.code || '子进程未启动'}）：${String(r.error.message || '').slice(0, 160)}` }
        }
        const out = String(r.stdout || '')
        const err = String(r.stderr || '')
        if (r.status !== 0 && !out) {
          return { kind: 'error', text: `/lunheng-stats 脚本退出 ${r.status}：${clip(err, 300)}` }
        }
        return { kind: 'success', text: clip(out + (err ? '\n（stderr）' + err : ''), 8000) }
      } catch (e) {
        return { kind: 'error', text: `/lunheng-stats 失败：${String(e?.message || e).slice(0, 200)}` }
      }
    },
  })
}
