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
 * @param opts.cwd - 解析 `run/<项目>` 的基准目录（宿主会话 cwd）。
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
        const arg = String(invocation?.rawInput || '').trim().split(/\s+/)[0] || ''
        const project = pickProject(cwd, arg)
        if (!project) {
          const runDir = join(cwd, 'run')
          const names = existsSync(runDir)
            ? readdirSync(runDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).slice(0, 12)
            : []
          return {
            kind: 'success',
            text:
              `论衡：未找到项目${arg ? `「${arg}」` : ''}（在 ${resolve(runDir)} 下找 status.md）。` +
              (names.length ? `\n现有项目：${names.join(' / ')}` : '\n（run/ 目录为空或不存在——Phase 0 定题后才会创建）'),
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
