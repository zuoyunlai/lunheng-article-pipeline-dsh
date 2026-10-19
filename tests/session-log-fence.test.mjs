// v19.19.1（架构审计 R1 · 反哺报告 §2.1）：**sessionLog / sessionRoot 的专用只读根**。
//
// 病灶（已实测）：`handoff-check` 传**会话 id** 时必须配 `--session-root`（脚本刻意不做
//   `DSH_HOME` 兜底），而工具面把 `sessionRoot` 交给 `resolveReadablePath`（只放行工作区 ∪ tmpdir）
//   → `$DSH_HOME/sessions` **必被拦**；id 形态又因缺 root 而 exit 10。两个形态都不可达。
// 修法：`sessionLogRoots()` 由 `DSH_HOME` 派生，**只对这两个参数**登记为额外只读根。
//
// 本文件钉三件事：① 默认围栏不放宽；② 登记后放行；③ handoff 的接线点逐字存在。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

import { resolveReadablePath, sessionLogRoots } from '../lib/tools.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')

// 刻意选一个**既不在仓库工作区、也不在 os.tmpdir()** 的祖先（家目录下的测试专用目录）。
// 它不需要存在——`isPathInsideRunDir` 会把「存在的最近祖先」canonical 化后再比较。
const FAKE_SESSIONS = join(homedir(), '.lunheng-session-fence-test', 'sessions')
const SAMPLE = join(FAKE_SESSIONS, '2026-10-19', 'abc123.jsonl')

test('默认围栏不放宽：家目录下的会话日志目录仍被拒（INVALID_ARGS）', () => {
  assert.throws(
    () => resolveReadablePath({}, SAMPLE, 'sessionLog'),
    /INVALID_ARGS/,
    '未登记 extraRoots 时，会话日志路径必须仍被工作区/tmpdir 围栏拒绝（否则等于取消围栏）',
  )
})

test('登记 extraRoots 后放行（复用同一套三层围栏，不另写判定）', () => {
  assert.equal(
    resolveReadablePath({}, SAMPLE, 'sessionLog', { extraRoots: [FAKE_SESSIONS] }),
    SAMPLE,
    '登记后的只读根内路径必须放行——这是 Phase 5 唯一独立核对层的可达性前提',
  )
  assert.throws(
    () => resolveReadablePath({}, join(homedir(), '.lunheng-session-fence-test', 'not-sessions', 'x.jsonl'), 'sessionLog', { extraRoots: [FAKE_SESSIONS] }),
    /INVALID_ARGS/,
    '登记根之外的路径必须仍然被拒（extraRoots 不能退化成「家目录全部可读」）',
  )
})

test('sessionLogRoots 随 DSH_HOME 派生；未设时回退 ~/.dsh/sessions', () => {
  const old = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = join(homedir(), '.lunheng-dsh-home-test')
    assert.deepEqual(sessionLogRoots(), [join(process.env.DSH_HOME, 'sessions')])
    delete process.env.DSH_HOME
    assert.deepEqual(sessionLogRoots(), [join(homedir(), '.dsh', 'sessions')])
  } finally {
    if (old !== undefined) process.env.DSH_HOME = old
    else delete process.env.DSH_HOME
  }
})

test('handoff 接线钉：sessionLog / sessionRoot 都传 extraRoots（不退回默认围栏）', () => {
  const src = read('lib', 'tools.js')
  assert.match(src, /const sessionExtra = sessionLogRoots\(\)/, '须在 execute 内取专用只读根')
  assert.match(src, /resolveReadablePath\(exec, v, 'sessionLog', \{ extraRoots: sessionExtra \}\)/,
    'sessionLog 路径形态必须走专用只读根')
  assert.match(src, /resolveReadablePath\(exec, String\(args\.sessionRoot\)\.trim\(\), 'sessionRoot', \{ extraRoots: sessionExtra \}\)/,
    'sessionRoot 必须走专用只读根（否则 id 形态仍 exit 10）')
})

// v19.19.1（验收复现批 A-2）：**文案与实现同源**。
//   病灶：`--help` 写「（默认 $DSH_HOME/sessions）」，而脚本 `:209-211` 无 root 即 exit 10、
//   `:202-204` 明说**刻意不做**兜底。这类句子没有机械消费者，所以能在两次修复里都活下来
//   （R1 只改了工具参数描述与 SKILL.md，没改脚本 --help）。此处给它一个消费者。
test('--help 不再承诺「默认 $DSH_HOME/sessions」：文案与实现同源', () => {
  const src = read('skills', 'lunheng-article-pipeline', 'scripts', 'handoff-check.mjs')
  assert.doesNotMatch(src, /默认 \$DSH_HOME\/sessions/,
    '脚本刻意不做 DSH_HOME 兜底（防跨宿主假红）——--help 不得再写「默认 …」')
  assert.match(src, /--session-root <目录>[^\n]*\*\*必给\*\*/,
    '--session-root 的文案须明写「必给」，与 :209-211 的 exit 10 对齐')
})
