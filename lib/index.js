// lunheng-article-pipeline bundle entry point.
//
// Registers the packaged pipeline knowledge base as one on-demand agent skill
// named `lunheng-article-pipeline`. The skill body is the packaged SKILL.md;
// its relative references (`references/**`, `scripts/**`) resolve against the
// skill directory through the directory resourceBase, so role cards,
// templates, and gate scripts load only when a task needs them (progressive
// disclosure).
//
// The package imports nothing from the harness: it only consumes the `skills`
// service at apply time, so no cordis copy is brought in and the peer
// dependency on `@deepseek-ai/dsh` is metadata-only (optional).
//
// Layout note: this repository keeps the skill body under `skills/<name>/`
// (the bundle is the repository, the skill is one directory inside it). The
// entry therefore resolves the skill directory explicitly instead of assuming
// the package root is the skill root.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'lunheng-article-pipeline'
export const inject = ['skills']

// Package root: this file lives in `lib/`, so the root is one level up.
// (The entry MUST live in a directory listed in the package `files` whitelist —
// the packaging checks require a built-artifact directory. Moving this file
// without adjusting the relative path below makes `readFileSync` throw ENOENT
// at apply time, which no static check can catch: only a runtime smoke test can.
// That failure mode is covered by `tests/entry.test.mjs`.)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillDir = join(packageRoot, 'skills', 'lunheng-article-pipeline')

/**
 * Split the YAML frontmatter block from SKILL.md into routing fields and body.
 * A malformed or missing block falls back to the full text as the body and an
 * empty field map, so the registration still succeeds with its fallback copy.
 *
 * v18.2.4（审计 C.1）：行尾与 BOM 归一后再解析。此前用 `text.startsWith('---\n')`
 * 判定，而 `readFileSync(p, 'utf8')` **不做行尾归一**——SKILL.md 一旦是 CRLF 行尾
 * （Windows `core.autocrlf=true` 检出、或编辑器另存为 CRLF），首行是 `---\r\n`，
 * 判定为假 → frontmatter 整块**静默**退化成内置兜底描述，而 description/whenToUse
 * 恰是模型侧路由的唯一依据（`whenToUse` 丢失后连注册字段都会消失），静态门全绿也照样漏过。
 * @param text - raw SKILL.md content.
 * @returns parsed routing fields (present keys only), the instruction body, and
 *   whether the frontmatter block was actually recognized.
 */
function splitFrontmatter(text) {
  // 行尾归一（CRLF / 孤立 CR → LF）+ 去 BOM：两者都只影响解析，不影响正文语义。
  const norm = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  // 首行必须是 `---`，且必须有**成行**的闭合 `---`（缺闭合 = 未解析，不猜）。
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(norm)
  if (!match) return { fields: {}, body: norm, parsed: false }
  const meta = match[1]
  const body = norm.slice(match[0].length).replace(/^\n+/, '')
  const read = (key) => {
    const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(meta)
    return match?.[1]?.trim().replace(/^["']|["']$/g, '')
  }
  return {
    fields: { description: read('description'), whenToUse: read('whenToUse') },
    body,
    parsed: true,
  }
}

/**
 * Build the entry's status reporter (v18.2.4，审计 C.3).
 *
 * 宿主带 Cordis `logger` 时走正规日志面，否则退回 `console.error`。此前 3 条
 * 「已注册 / 已启用」状态行**无条件**写 stderr，宿主每次启动都刷屏，而这些信息本就
 * 只对宿主日志有用。口径：`info`（成功）可被 `LUNHENG_QUIET=1` 静音；`warn`（降级 / 失败）
 * **不静音**——「静默降级」正是 v18.0.0 事故的形态，必须始终可见。
 * @param ctx - the plugin context (minimal hosts may carry no logger).
 * @returns a `(level, message) => void` reporter bound to this context.
 */
function makeReporter(ctx) {
  const logger = ctx?.logger
  const quiet = process.env.LUNHENG_QUIET === '1' || process.env.LUNHENG_QUIET === 'true'
  return (level, message) => {
    if (level === 'info' && quiet) return
    if (logger && typeof logger[level] === 'function') logger[level](message)
    else console.error(message) // 宿主无日志面时不丢信息（宁可见勿静默）
  }
}

/**
 * Register the pipeline skill. Registration is an effect: the disposer
 * returned by `ctx.skills.register()` removes the contribution on unload.
 * @param ctx - Cordis context; the injected `skills` service is the hard
 *   dependency (its absence is a host-contract violation: it is reported and
 *   skipped, never a TypeError), while the C-group services stay optional.
 */
export function apply(ctx) {
  const say = makeReporter(ctx)
  const skillPath = join(skillDir, 'SKILL.md')
  const { fields, body, parsed } = splitFrontmatter(readFileSync(skillPath, 'utf8'))
  // 审计 C.2：解析失败此前**静默**退回兜底 description——模型侧路由字段丢了却没有任何信号。
  if (!parsed) {
    say(
      'warn',
      `· 论衡技能 frontmatter 未解析（SKILL.md 首行不是成行 \`---\` 或缺闭合行）：${skillPath}` +
        ' —— 已退回内置兜底 description，whenToUse 未注册；请检查该文件是否被 CRLF / 前置空行 / BOM 破坏。',
    )
  }
  // 审计 E.2（v18.2.4）：`skills` 是 `inject` 声明的**硬依赖**——合规宿主在 apply 前就已就绪，
  //   故这条不是「降级」分支而是「宿主违约」分支：响亮点名后**跳过注册**，但 C 组可选能力照常安装
  //   （入口不因缺一个服务就整体崩掉）。此前缺失时抛的是
  //   `Cannot read properties of undefined (reading 'register')`——一句话能说清的事不该以 TypeError 出现。
  if (ctx?.skills?.register) {
    ctx.effect(() =>
      ctx.skills.register({
        name: 'lunheng-article-pipeline',
        source: 'bundled',
        description:
          fields.description ??
          '论衡：多 Agent 深度长文流水线（学术论文 / 商业评论 / 行业分析 / 公众号）。',
        ...(fields.whenToUse ? { whenToUse: fields.whenToUse } : {}),
        content: body,
        resourceBase: { kind: 'directory', path: skillDir },
      }),
    )
  } else {
    say(
      'warn',
      '· 论衡技能未注册：宿主 ctx 缺 `skills` 服务（inject 声明的硬依赖未满足）——' +
        '原生工具 / 机制写保护 / 人类命令仍会尝试安装。',
    )
  }

  // ── C 组（v18.1.0）：原生工具 / 机制写保护 / 人类命令 ──────────────────────
  // 设计要点（官方依据见各模块头注释）：
  //   · 这些是**可选能力**：宿主缺 `tools` / `commands` 服务或缺 `@deepseek-ai/dsh-tools` 包时
  //     **只降级、不拖垮入口**（技能注册是第一职责；v18.0.0「入口 import 失败 → 技能不注册」的形态不可重演）；
  //   · 异步安装包在 `ctx.effect()` 里：任何一步失败都只打印一行提示，注册顺序与卸载语义不变。
  const allowMechEdit = () =>
    process.env.LUNHENG_ALLOW_MECH_EDIT === '1' || process.env.LUNHENG_ALLOW_MECH_EDIT === 'true'
  ctx.effect(() => {
    const disposers = []
    let alive = true
    ;(async () => {
      try {
        const { installLunhengTools } = await import('./tools.js')
        const d = await installLunhengTools(ctx, { skillRoot: skillDir, report: say })
        if (!alive) { for (const x of d) try { x?.() } catch { /* 已卸载 */ } return }
        disposers.push(...d)
        if (d.length) say('info', `· 论衡原生工具已注册：${d.length} 个（lunheng_m_gate / lunheng_char_count，均只读）`)
      } catch (e) {
        say('warn', `· 论衡原生工具安装失败（不影响技能与流水线）：${String(e?.message || e).slice(0, 120)}`)
      }
      try {
        const { installMechanismGuard } = await import('./guard.js')
        // 受保护根 = 审计定义的「机制文件」范围：技能体（SKILL.md / AGENTS.md / references/** / scripts/**）
        //   + 包级 `cordis.patch.yml` + 入口目录 `lib/` + 仓库级门 `scripts/`。
        //   **不含** docs / README / CHANGELOG（文档可自由改，不受机制否决）。
        const d = installMechanismGuard(ctx, {
          mechanismRoots: [skillDir, join(packageRoot, 'lib'), join(packageRoot, 'scripts'), join(packageRoot, 'cordis.patch.yml')],
          allowed: allowMechEdit,
        })
        if (!alive) { try { d?.() } catch { /* 已卸载 */ } return }
        if (d) {
          disposers.push(d)
          say(
            'info',
            '· 论衡机制文件写保护已启用（write/edit 类工具对技能包内路径一律否决；主人授权时设 LUNHENG_ALLOW_MECH_EDIT=1）',
          )
        }
      } catch (e) {
        say('warn', `· 论衡机制写保护安装失败（不影响技能）：${String(e?.message || e).slice(0, 120)}`)
      }
      try {
        const { installStatusCommand } = await import('./commands.js')
        const d = installStatusCommand(ctx, { cwd: process.cwd() })
        if (!alive) { try { d?.() } catch { /* 已卸载 */ } return }
        if (d) {
          disposers.push(d)
          say('info', '· 论衡人类命令已注册：/lunheng-status（不产生模型消息）')
        }
      } catch (e) {
        say('warn', `· 论衡人类命令安装失败（不影响技能）：${String(e?.message || e).slice(0, 120)}`)
      }
    })()
    return () => {
      alive = false
      for (const d of disposers) { try { d?.() } catch { /* 卸载期失败不抛 */ } }
    }
  })
}
