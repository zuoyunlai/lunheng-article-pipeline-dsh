// 人类命令 `/lunheng-status`（C 组 · v18.1.0）：主人在 1-3 小时长跑中**随时自查进展**，
// 且**不产生模型消息**（官方 `docs/subsystems/commands.md:5`：interactive adapters 用它直接执行命令）。
//
// 官方依据：`commands.md` — `register(definition: CommandDefinition): () => void`；定义字段
//   `{ name, description, input?, recordInput?, handler }`；handler 返回
//   `{ kind:'success', text? }` 或 `{ kind:'error', text }`；`invocation.rawInput` 是命令名之后的原文。
//
// 与工具化的区别（为什么用命令而不是工具）：命令**不进模型上下文**、不占一轮对话，适合「只看一眼」；
// 而「让主控据此改写产物」才需要工具（那由 `lunheng_m_gate` / `lunheng_char_count` 承担）。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const clip = (s, n) => String(s ?? '').replace(/\s+$/g, '').slice(0, n)

/** 在 `<cwd>/run/` 下挑项目：有参数用参数；否则取 status.md 最近修改的那个。 */
function pickProject(cwd, arg) {
  const runDir = join(cwd, 'run')
  if (arg) {
    const p = join(runDir, arg)
    return existsSync(p) ? p : null
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
 * 注册 `/lunheng-stats`（C 组 · v18.4.1）：聚合 run/ 全部项目的遥测看板（M 门证据覆盖率 /
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
        const args = raw ? raw.split(/\s+/) : []
        const script = join(skillRoot, 'scripts', 'lunheng-stats.mjs')
        const r = spawnSync(process.execPath, [script, '--run-dir', runDir, ...args], {
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
