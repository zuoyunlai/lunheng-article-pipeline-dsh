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
 * @param text - raw SKILL.md content.
 * @returns parsed routing fields (present keys only) and the instruction body.
 */
function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) return { fields: {}, body: text }
  const end = text.indexOf('\n---', 4)
  if (end < 0) return { fields: {}, body: text }
  const meta = text.slice(4, end)
  const body = text.slice(end + 4).replace(/^\n+/, '')
  const read = (key) => {
    const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(meta)
    return match?.[1]?.trim().replace(/^["']|["']$/g, '')
  }
  return {
    fields: { description: read('description'), whenToUse: read('whenToUse') },
    body,
  }
}

/**
 * Register the pipeline skill. Registration is an effect: the disposer
 * returned by `ctx.skills.register()` removes the contribution on unload.
 * @param ctx - Cordis context with the injected `skills` service.
 */
export function apply(ctx) {
  const skillPath = join(skillDir, 'SKILL.md')
  const { fields, body } = splitFrontmatter(readFileSync(skillPath, 'utf8'))
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
        const d = await installLunhengTools(ctx, { skillRoot: skillDir })
        if (!alive) { for (const x of d) try { x?.() } catch { /* 已卸载 */ } return }
        disposers.push(...d)
        if (d.length) console.error(`· 论衡原生工具已注册：${d.length} 个（lunheng_m_gate / lunheng_char_count，均只读）`)
      } catch (e) {
        console.error(`· 论衡原生工具安装失败（不影响技能与流水线）：${String(e?.message || e).slice(0, 120)}`)
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
          console.error(
            '· 论衡机制文件写保护已启用（write/edit 类工具对技能包内路径一律否决；主人授权时设 LUNHENG_ALLOW_MECH_EDIT=1）',
          )
        }
      } catch (e) {
        console.error(`· 论衡机制写保护安装失败（不影响技能）：${String(e?.message || e).slice(0, 120)}`)
      }
      try {
        const { installStatusCommand } = await import('./commands.js')
        const d = installStatusCommand(ctx, { cwd: process.cwd() })
        if (!alive) { try { d?.() } catch { /* 已卸载 */ } return }
        if (d) {
          disposers.push(d)
          console.error('· 论衡人类命令已注册：/lunheng-status（不产生模型消息）')
        }
      } catch (e) {
        console.error(`· 论衡人类命令安装失败（不影响技能）：${String(e?.message || e).slice(0, 120)}`)
      }
    })()
    return () => {
      alive = false
      for (const d of disposers) { try { d?.() } catch { /* 卸载期失败不抛 */ } }
    }
  })
}
