// `/lunheng-stats` 与 `pickProject` 回归网（v18.18.0 新增 · 审计 F-4 覆盖缺口）
//
// 为什么必须有这一条：
//   · `installStatsCommand` 在 v18.18.0 之前**零测试覆盖**（`grep -rn 'installStatsCommand' tests/` = 0）——
//     而它是**唯一**一条「跑在宿主进程、有完整 spawn 权限」的代码路径（见 SECURITY.md §信任边界）。
//   · v18.18.0（C-6）把它改成参数白名单（只放行 `--json`），这条改动同样没有用例钉住。
//   · `pickProject` 的**无参 mtime 分支**（不给项目名 → 取 `status.md` 最近修改的项目）此前也没被断言过。
//
// 做法：不跑真入口（那条路径见 entry.test.mjs），而是**直接 import lib/commands.js 的两个注册函数**，
//   喂一个最小 `ctx.commands.register` 桩，拿到 handler 后真调它——测的就是这两个函数的真实行为。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const COMMANDS_MOD = join(PACKAGE_ROOT, 'lib', 'commands.js')
const SKILL_DIR = join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline')

/** 拿一个「注册即记录」的 commands 桩 + 真调 `installXxx(ctx, opts)`，返回被注册的定义对象。 */
async function grabRegistration(installFn, opts) {
  const mod = await import(pathToFileURL(COMMANDS_MOD).href)
  let captured
  const ctx = {
    get: (n) => (n === 'commands' ? { register: (d) => { captured = d; return () => {} } } : undefined),
  }
  installFn(mod, ctx, opts)
  assert.ok(captured, '未注册任何命令（ctx.commands 桩未被调用）')
  return captured
}

const mkProject = (name) => {
  const d = mkdtempSync(join(tmpdir(), `lh-cmd-${name}-`))
  const runDir = join(d, 'run', name)
  mkdirSync(runDir, { recursive: true })
  return { d, runDir }
}

test('C-6 /lunheng-stats：参数白名单——仅 `--json` 放行，其它 token 一律拒绝且不派生子进程', async () => {
  const { d } = mkProject('白名单')
  const captured = await grabRegistration(
    (mod, ctx, o) => mod.installStatsCommand(ctx, o),
    { cwd: d, skillRoot: SKILL_DIR, scriptTimeoutMs: 20000 },
  )

  // ① 未授权参数 → error，且**不得**走到 spawnSync
  for (const bad of ['--run-dir', '/etc', '--bogus', 'run/其它项目', '--json --run-dir=/tmp']) {
    const r = await captured.handler({ rawInput: bad, agent: { session: { header: { cwd: d } } } })
    assert.equal(r.kind, 'error', `未授权输入 "${bad}" 必须被拒绝，实得 kind=${r.kind}`)
    assert.match(r.text, /白名单|未授权/, `拒绝理由须点明白名单，实得：${r.text}`)
    assert.ok(!r.text.includes('run 遥测看板'), '被拒时不得产出看板正文（说明已执行脚本）')
  }
  rmSync(d, { recursive: true, force: true })
})

test('C-6 /lunheng-stats：`--json` 放行（合法路径真跑到脚本）', async () => {
  const { d } = mkProject('放行')
  const captured = await grabRegistration(
    (mod, ctx, o) => mod.installStatsCommand(ctx, o),
    { cwd: d, skillRoot: SKILL_DIR, scriptTimeoutMs: 30000 },
  )
  const r = await captured.handler({ rawInput: '--json', agent: { session: { header: { cwd: d } } } })
  assert.notEqual(r.kind, 'error', `\`--json\` 是白名单内旗标，不得被参数校验拒绝（实得：${r.text}）`)
  rmSync(d, { recursive: true, force: true })
})

test('F-4 pickProject 无参 mtime 分支：不给项目名时取 status.md **最近修改**的项目', async () => {
  const { d } = mkProject('mtime')
  const runDir = join(d, 'run')
  // 三个项目，显式设置 status.md 的 mtime（不靠写盘顺序——同毫秒会退化，见 v18.14.0 教训）
  const names = ['甲项目', '乙项目', '丙项目']
  const base = Date.now() / 1000 - 86400
  names.forEach((n, i) => {
    const p = join(runDir, n)
    mkdirSync(p, { recursive: true })
    const s = join(p, 'status.md')
    writeFileSync(s, `# ${n}\n`)
    const t = base + i * 3600          // 甲最旧 → 丙最新
    utimesSync(s, t, t)
  })
  const captured = await grabRegistration((mod, ctx, o) => mod.installStatusCommand(ctx, o), { cwd: d })
  const r = await captured.handler({ rawInput: '', agent: { session: { header: { cwd: d } } } })
  assert.equal(r.kind, 'success')
  assert.match(r.text, /丙项目/, `必须选中 status.md 最近修改的项目（丙项目），实得：\n${r.text}`)
  assert.doesNotMatch(r.text, /论衡项目：甲项目/, '不得选中最旧项目')
  rmSync(d, { recursive: true, force: true })
})

test('F-4 /lunheng-status：run/ 不存在时返回可读提示（含「目录为空或不存在」语义），不抛异常', async () => {
  const d = mkdtempSync(join(tmpdir(), 'lh-cmd-empty-'))   // 故意不建 run/
  const captured = await grabRegistration((mod, ctx, o) => mod.installStatusCommand(ctx, o), { cwd: d })
  const r = await captured.handler({ rawInput: '', agent: { session: { header: { cwd: d } } } })
  assert.equal(r.kind, 'success', '项目未找到属正常态（不是 error），便于主人一眼看到')
  assert.match(r.text, /未找到项目/)
  assert.match(r.text, /run\/ 目录为空或不存在|现有项目/)
  rmSync(d, { recursive: true, force: true })
})
