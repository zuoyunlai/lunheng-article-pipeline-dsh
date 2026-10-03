// 三个 CLI 入口的端到端回归（v18.67.0 全量审计批 3-5 新增）
//
// **为什么必须补**：`route.test.mjs` 只覆盖 route-command.mjs；history-cli / stats-cli / pending-cli
//   的 `main()` 入口此前**零 CLI 测试**——而 CLI 入口恰是本子技能历史缺陷的高发区（isMain 判定、
//   Windows `file://` 拼接、argv 前缀三类同形 bug 都在 route-command 上修过，其余三个复发将无门可拦）。
// 全部**真 spawn 进程**（与 route.test.mjs 的 E2E 组同法），不喂合成 argv。
// 运行：node --test skills/lunheng-commands/tests/cli-e2e.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')
const HISTORY = join(SCRIPTS, 'history-cli.mjs')
const STATS = join(SCRIPTS, 'stats-cli.mjs')
const PENDING = join(SCRIPTS, 'pending-cli.mjs')

/** 真 spawn CLI：cwd 可指定；非 0 退出不抛，照常返回 { code, stdout, stderr }。 */
function cli(script, args, { cwd } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(cwd ? { cwd } : {}) })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    return { code: e.status ?? -1, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}

/** 最小项目骨架：run/<proj>/ + 01-任务简报.md + history.jsonl + 阶段确认单（§6 未回填）。 */
function mkWorkspace() {
  const d = mkdtempSync(join(tmpdir(), 'lh-cli-e2e-'))
  const proj = join(d, 'run', '甲项目')
  mkdirSync(proj, { recursive: true })
  // history-cli 的 listProjects 只收「含 01-任务简报.md」的直接子目录（实测：缺它 → 列表为空）
  writeFileSync(join(proj, '01-任务简报.md'), '# 任务简报\n\n## 目标篇幅\n\n5000 汉字\n')
  writeFileSync(join(proj, 'history.jsonl'), JSON.stringify({ ts: '2026-10-03T00:00:00Z', phase: 'Phase 0', note: '定题' }) + '\n')
  writeFileSync(join(proj, '阶段确认-Phase0.md'),
    '# 阶段确认 Phase 0\n\n## 6. 主人回复\n\n- **主人原话**：（待回复）\n- **回复时间**：\n- **提问方式**：\n- **主控落盘结论**：\n- **轮次计数**：\n')
  return { d, proj }
}

// ── history-cli ────────────────────────────────────────────────────────────────

test('history-cli E2E：list（cwd 含 run/ 项目）→ exit 0 且列出项目', () => {
  const { d } = mkWorkspace()
  try {
    const r = cli(HISTORY, ['list'], { cwd: d })
    assert.equal(r.code, 0, `stderr=${r.stderr}`)
    assert.match(r.stdout, /甲项目/)
    assert.match(r.stdout, /\[有 history\]/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('history-cli E2E：read <合法项目> → exit 0 + JSON 数组；read ../evil → 非零且拒绝（围栏）', () => {
  const { d } = mkWorkspace()
  try {
    const ok = cli(HISTORY, ['read', '甲项目'], { cwd: d })
    assert.equal(ok.code, 0, `stderr=${ok.stderr}`)
    // readHistory 直接返回条目数组（无 {entries} 包装）——按实现契约断言
    const j = JSON.parse(ok.stdout)
    assert.ok(Array.isArray(j) && j.length === 1, `应解析出 1 条历史记录，实得：${ok.stdout.slice(0, 120)}`)
    assert.equal(j[0].phase, 'Phase 0')

    const evil = cli(HISTORY, ['read', '../evil'], { cwd: d })
    assert.notEqual(evil.code, 0, '`../` 越界必须非零退出（resolveProjectDir 三层围栏）')
    assert.match(evil.stderr, /非法的 projectId/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('history-cli E2E：未知子命令 → 非零且列出可用子命令', () => {
  const r = cli(HISTORY, ['frobnicate'])
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /未知子命令/)
  assert.match(r.stderr, /list.*read.*diff|list \/ read \/ diff/)
})

// ── stats-cli ─────────────────────────────────────────────────────────────────

test('stats-cli E2E：合法 run 目录 → exit 0 且产出看板（定位到真源 lunheng-stats.mjs）', () => {
  const { d } = mkWorkspace()
  try {
    const r = cli(STATS, ['--run-dir', 'run'], { cwd: d })
    assert.equal(r.code, 0, `stderr=${r.stderr}`)
    assert.match(r.stdout, /甲项目|项目|run/, '看板应提及扫描到的项目')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('stats-cli E2E：`--run-dir ../escape` → 非零且拒绝（不得把 spawn 指向任意目录）', () => {
  const { d } = mkWorkspace()
  try {
    const r = cli(STATS, ['--run-dir', '../escape'], { cwd: d })
    assert.notEqual(r.code, 0, '越界 --run-dir 必须非零退出')
    assert.match(r.stderr, /超出|越界|范围/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── pending-cli ───────────────────────────────────────────────────────────────

test('pending-cli E2E：--json 扫描含未回填 §6 的项目 → exit 0 + JSON（字段可机读）', () => {
  const { d } = mkWorkspace()
  try {
    const r = cli(PENDING, ['--run-dir', 'run', '--json'], { cwd: d })
    assert.equal(r.code, 0, `stderr=${r.stderr}`)
    const j = JSON.parse(r.stdout)
    assert.ok(j.runDir, 'JSON 须含 runDir')
    assert.ok(j.active === undefined || Array.isArray(j.active), 'active 若在须为数组')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('pending-cli E2E：run 目录不存在 → exit 10（参数/路径错，非撞码语义）', () => {
  const d = mkdtempSync(join(tmpdir(), 'lh-cli-empty-'))
  try {
    const r = cli(PENDING, [], { cwd: d })
    assert.equal(r.code, 10, '缺 run/ 属路径错 → exit 10（本脚本头注释声明的契约）')
    assert.match(r.stderr, /run 目录不存在/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('pending-cli E2E：`--run-dir ../escape` → exit 10（词法层拒绝）', () => {
  const { d } = mkWorkspace()
  try {
    const r = cli(PENDING, ['--run-dir', '../escape'], { cwd: d })
    assert.equal(r.code, 10)
    assert.match(r.stderr, /超出|越界|范围/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('pending-cli E2E：run/ 内 junction 指向工作区外 → exit 10（物理层拒绝，v18.67.0 回归）', { skip: process.platform !== 'win32' && '非 Windows 无免权限 junction' }, () => {
  const { d } = mkWorkspace()
  try {
    const outside = mkdtempSync(join(tmpdir(), 'lh-cli-outside-'))
    const link = join(d, 'run', 'escape')
    const mk = spawnSync('cmd', ['/c', 'mklink', '/J', link, outside], { stdio: 'ignore' })
    if (mk.status !== 0) return // 环境不允许创建 junction → 本用例不判负
    const r = cli(PENDING, ['--run-dir', 'run\\escape'], { cwd: d })
    assert.equal(r.code, 10, 'junction 指向工作区外必须被物理层拒绝（isPathInsideRunDir）')
    rmSync(outside, { recursive: true, force: true })
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 入口判定回归钉（isMain 可移植性）─────────────────────────────────────────

test('源码级回归钉：三个 CLI 的入口判定必须用 pathToFileURL（Windows 下 file:// 拼接永不相等）', () => {
  // ⚠️ 先剥注释再断言（同 route.test.mjs 的教训）：pending-cli 头注释**正当引用**了旧写法
  //   `file://${process.argv[1]}` 作为反面例子，不剥注释会把这个引用判成违规。
  for (const f of [HISTORY, STATS, PENDING]) {
    const raw = readFileSync(f, 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    assert.match(src, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/,
      `${f} 的 isMain 判定必须走 pathToFileURL（v18.62.0 F6 教训）`)
    assert.ok(!/file:\/\/\$\{process\.argv\[1\]\}/.test(src), `${f} 不得回退到字符串拼接 file:// URL`)
  }
})
