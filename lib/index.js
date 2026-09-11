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
}
