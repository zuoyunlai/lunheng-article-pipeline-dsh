// v18.69.0（批 6-A · lib P2 十项）回归钉
// 运行：node --test tests/batch19-lib-p2.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('validateConfig：0 < v < 1（如 0.5）必须被拒（旧版 floor 后静默归零 = 解除限流）', async () => {
  const { resolveConfig } = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  assert.throws(() => resolveConfig({ scriptTimeoutMs: 0.5 }), /正整数/)
  assert.throws(() => resolveConfig({ scriptMaxOutputBytes: 0.001 }), /正整数/)
  // 边界：≥1 通过且向下取整
  const ok = resolveConfig({ scriptTimeoutMs: 2.9 })
  assert.equal(ok.scriptTimeoutMs, 2, '≥1 合法值向下取整')
  const one = resolveConfig({ scriptTimeoutMs: 1 })
  assert.equal(one.scriptTimeoutMs, 1)
})

test('ethics PUA 哨兵：原文自带 \\uE000<n>\\uE000 序列 → 不吞字 + sentinel-collision-input 留痕（v18.80.4 P2-1：输入侧隔离取代还原侧兜底）', async () => {
  const { sanitize, loadDicts } = await import(pathToFileURL(join(ROOT, 'lib', 'ethics-sanitize.js')).href)
  const dicts = loadDicts(join(ROOT, 'skills', 'lunheng-article-pipeline'))
  const marker = '\uE000999\uE000'
  // strict 模式才启用「地名 → 哨兵 → 还原」链路（sentMap 非空，还原 replace 才会运行）
  const out = sanitize(`原文含哨兵形序列 ${marker}，另有地名 杭州。`, { mode: 'strict', dicts })
  assert.ok(out.text.includes(marker), '哨兵同形序列不得被静默吞字（应保留原串）：' + JSON.stringify(out.text))
  // v18.80.4（P2-1）：哨兵序列现在**地名轮之前**就被输入侧隔离（防「编号命中本轮 sentMap」的静默改写），
  //   标记 kind 由还原侧的 sentinel-collision 升级为 sentinel-collision-input（语义更准：输入自带）。
  assert.ok(out.reviewFlags.some((f) => f.kind === 'sentinel-collision-input'), '必须记 sentinel-collision-input 供人工核：' + JSON.stringify(out.reviewFlags))
})

test('ethics 词表缓存：同 skillRoot 二次 loadDicts 返回同一引用（mtime 指纹不变则不重读）', async () => {
  const { loadDicts } = await import(pathToFileURL(join(ROOT, 'lib', 'ethics-sanitize.js')).href)
  const skillRoot = join(ROOT, 'skills', 'lunheng-article-pipeline')
  const a = loadDicts(skillRoot)
  const b = loadDicts(skillRoot)
  assert.equal(a, b, '相同指纹应命中缓存（同一对象引用）')
})

test('guard JSON 字符串参数：序列化 arguments 仍能被识别出候选路径并否决机制写入', async () => {
  const { installMechanismGuard } = await import(pathToFileURL(join(ROOT, 'lib', 'guard.js')).href)
  let cb = null
  const ctx = { get: (k) => (k === 'tools' ? { guard: (fn) => { cb = fn; return () => {} } } : undefined) }
  installMechanismGuard(ctx, {
    mechanismRoots: [join(ROOT, 'skills', 'lunheng-article-pipeline')],
    skillName: 'lunheng-article-pipeline',
    mirrorSkillNames: ['lunheng-commands'],
  })
  assert.equal(typeof cb, 'function')
  const mechPath = join(ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md')
  const jsonArgs = JSON.stringify({ file_path: mechPath })
  const verdict = cb({ name: 'write', arguments: jsonArgs, agent: { session: { header: { cwd: ROOT } } } })
  assert.ok(typeof verdict === 'string' && /写保护|受保护/.test(verdict),
    'JSON 字符串参数必须被解析并否决机制写入：' + String(verdict).slice(0, 120))
})

test('guard 镜像覆盖子技能：lunheng-commands 项目级副本写入被否决', async () => {
  const { installMechanismGuard } = await import(pathToFileURL(join(ROOT, 'lib', 'guard.js')).href)
  let cb = null
  const ctx = { get: (k) => (k === 'tools' ? { guard: (fn) => { cb = fn; return () => {} } } : undefined) }
  installMechanismGuard(ctx, {
    mechanismRoots: [join(ROOT, 'skills', 'lunheng-article-pipeline')],
    skillName: 'lunheng-article-pipeline',
    mirrorSkillNames: ['lunheng-commands'],
  })
  const cwd = join(ROOT, '..', '__fake_session__')   // 会话工作区任意，只测「镜像名含子技能」
  const subSkillMirror = join(cwd, '.dsh', 'skills', 'lunheng-commands', 'SKILL.md')
  const verdict = cb({ name: 'edit', arguments: { file_path: subSkillMirror }, agent: { session: { header: { cwd } } } })
  // 注：该路径不实际存在，canonicalPath realpath 会失败回落原路径，仍需命中镜像根（.dsh/skills/lunheng-commands）
  assert.ok(typeof verdict === 'string' && /写保护|受保护/.test(verdict),
    '子技能镜像副本写入必须被否决：' + String(verdict).slice(0, 160))
})
