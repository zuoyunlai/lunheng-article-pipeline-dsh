// 入口回归测试（v18.0.0 新增）
//
// 为什么必须有这一条：包面静态检查（dsh-plugin-dev check / repo-hygiene-check）**不执行 `apply`**，
// 因此「入口能 import、但 apply 一跑就崩」这类缺陷静态门全绿也照样漏过。v18.0.0 发布前实测踩到过一次：
// 入口从包根移入 `lib/` 后未同步调整相对路径 → `readFileSync(<包根>/lib/SKILL.md)` ENOENT →
// 技能注册失败，而当时的两个静态门全绿（教训 #152）。
//
// 本测试用最小 ctx 真正执行 `apply`，把「入口 → SKILL.md → 技能目录」这条路径钉在 CI 里：
//   ① 入口导出的契约（name / inject / apply 形态）；
//   ② `apply` 确实调用 `ctx.effect`（注册即可逆，卸载自动清理）；
//   ③ 注册字段（name / source / description / whenToUse / content / resourceBase）齐备且指向真实目录；
//   ④ resourceBase 目录下 SKILL.md / references/ / scripts/ 真实存在（渐进披露的相对引用前提）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const ENTRY = join(PACKAGE_ROOT, 'lib', 'index.js')

/** 最小 ctx：只实现入口消费的两个能力（effect + skills.register）。 */
function makeCtx() {
  const captured = { registrations: [], disposers: 0, effects: 0 }
  const ctx = {
    effect(fn) {
      captured.effects += 1
      const disposer = fn()
      return () => {
        captured.disposers += 1
        if (typeof disposer === 'function') disposer()
      }
    },
    skills: {
      register(definition) {
        captured.registrations.push(definition)
        return () => {}
      },
    },
  }
  return { ctx, captured }
}

test('入口契约：name / inject / apply 形态符合 DSH 插件约定', async () => {
  const mod = await import(pathToFileURL(ENTRY).href)
  assert.equal(mod.name, 'lunheng-article-pipeline', 'entry must export the plugin name')
  assert.deepEqual(mod.inject, ['skills'], 'entry must declare the skills service as a dependency')
  assert.equal(typeof mod.apply, 'function', 'entry must export apply(ctx)')
  assert.ok(existsSync(ENTRY), `entry file must exist: ${ENTRY}`)
})

test('apply 注册技能：字段齐备 + resourceBase 指向真实技能目录', async () => {
  const mod = await import(pathToFileURL(ENTRY).href)
  const { ctx, captured } = makeCtx()
  mod.apply(ctx)

  assert.equal(captured.effects, 1, 'apply must register through ctx.effect (reversible registration)')
  assert.equal(captured.registrations.length, 1, 'apply must register exactly one skill')

  const reg = captured.registrations[0]
  assert.equal(reg.name, 'lunheng-article-pipeline')
  assert.equal(reg.source, 'bundled')
  assert.ok(typeof reg.description === 'string' && reg.description.length > 0, 'description is required for the model catalogue')
  assert.ok(typeof reg.whenToUse === 'string' && reg.whenToUse.length > 0, 'whenToUse carries the routing boundary')
  assert.ok(typeof reg.content === 'string' && reg.content.length > 1000, 'skill body must be the SKILL.md body')

  // 前端 matter 必须已被剥离：正文不得以 `---` 开头（否则 frontmatter 会作为指令正文污染技能）
  assert.ok(!reg.content.startsWith('---'), 'frontmatter must be stripped from the registered body')
  assert.ok(!/^name:\s*"lunheng-article-pipeline"/m.test(reg.content), 'frontmatter keys must not leak into the body')

  // resourceBase 必须是目录且真实存在——这是 references/** 与 scripts/** 相对引用的前提
  assert.deepEqual(reg.resourceBase?.kind, 'directory')
  const skillDir = reg.resourceBase?.path
  assert.ok(typeof skillDir === 'string' && skillDir.length > 0, 'resourceBase.path is required')
  assert.ok(skillDir.endsWith(join('skills', 'lunheng-article-pipeline')), `resourceBase must point at the packaged skill dir, got: ${skillDir}`)

  // 路径回归（教训 #152）：入口移动 / files 白名单变化后，这里会立刻红
  for (const rel of ['SKILL.md', 'references', 'scripts']) {
    assert.ok(existsSync(join(skillDir, rel)), `resourceBase 下缺 ${rel}：${join(skillDir, rel)}`)
  }

  // 注册正文应与 SKILL.md 的正文段一致（防止入口读到别的文件）
  const raw = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
  const body = raw.slice(raw.indexOf('\n---', 4) + 4).replace(/^\n+/, '')
  assert.equal(reg.content, body, 'registered content must equal the SKILL.md body')

  // 卸载可逆：disposer 可调用
  const disposer = ctx.effect(() => () => {})
  assert.equal(typeof disposer, 'function')
})
