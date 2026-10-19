// v19.19.3（反哺报告-2026-10-19 M4b/M4c）回归网：`token-cost.mjs` 的**三条成本证据纪律**
//   ① 交付快照回落（live 全灭时读 `final/token-cost.json`，并标 `source: delivery-snapshot`，exit 0）；
//   ② 无快照仍 exit 10（v18.2.6 的「查不到 ≠ 0」不被回落吞掉）；
//   ③ **历史快照不得被部分读数覆盖**（偏差 >20% 或命中不全 → 写 `.new` 旁路并拒绝覆盖）；
//   ④ `--top` 对单会话 >20M 打尾部预警（M4c，「一篇的成本被一两个离群轮定义」）。
// 为什么必须有这套网（实测代价）：2026-10-19 本批自查时，一条「看看成本」的 `--project` 命令把
//   `run/中国古典学的学科划界/final/token-cost.json` 从 10.90M 覆盖成 2.14M（live 只命中 2/3 会话），
//   而 `session_projcache` 轮转后该快照是**唯一历史证据**——已从 `.bak` 恢复并补上本门。
// 运行：node --test tests/token-cost.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { run } from './_fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'skills', 'lunheng-article-pipeline', 'scripts', 'token-cost.mjs')
const UUID = '11111111-2222-4333-8444-555555555555'

/** 只造 `storages/session_projcache/sessions/`（空目录）——脚本要求该布局存在，否则 exit 10（那是参数错，不是本套要测的）。 */
function mkHome() {
  const home = mkdtempSync(join(tmpdir(), 'lh-tc-home-'))
  mkdirSync(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
  return home
}
function mkProj(snapshot) {
  const d = mkdtempSync(join(tmpdir(), 'lh-tc-proj-'))
  writeFileSync(join(d, 'status.md'), `# status\n\n| 角色 | agent id |\n|---|---|\n| T1 | ${UUID} |\n`)
  if (snapshot) {
    mkdirSync(join(d, 'final'), { recursive: true })
    writeFileSync(join(d, 'final', 'token-cost.json'), JSON.stringify(snapshot, null, 2))
  }
  return d
}
/** 造一份与脚本输出同形的快照；`sessions` = 每个会话的总 token（第 1 个被标「主控」）。 */
function snap(sessionTotals) {
  const rows = sessionTotals.map((t, i) => ({
    session: `${UUID.slice(0, 24)}${String(i).padStart(4, '0')}`,
    label: i === 0 ? '主控' : '子代理',
    tokens: { uncachedInputTokens: 1000, cacheReadTokens: t - 2000, cacheWriteTokens: 500, outputTokens: 500 },
  }))
  const total = sessionTotals.reduce((a, b) => a + b, 0)
  return {
    mode: 'explicit', sessionCount: rows.length, matchedSessionCount: rows.length, matchedFromLiveStore: 0,
    tokens: { uncachedInput: 1000 * rows.length, cacheRead: total - 2000 * rows.length, cacheWrite: 500 * rows.length, output: 500 * rows.length, total },
    costEstimateUsd: 9.99, pricesPerMillion: { in: 0.28, cache: 0.028, out: 0.42 }, note: '交付时快照', rows,
  }
}
const env = (home) => ({ ...process.env, DSH_HOME: home })

test('token-cost M4b：live 全灭 + 快照在盘 → 回落读快照并标 delivery-snapshot（exit 0）', () => {
  const home = mkHome()
  const proj = mkProj(snap([5_000_000]))
  const r = run([SCRIPT, '--project', proj], { env: env(home) })
  assert.equal(r.code, 0, '回落必须 exit 0（不是 10）：' + r.out.slice(-400))
  const j = JSON.parse(r.stdout)
  assert.equal(j.source, 'delivery-snapshot', '必须显式标 source，防把快照当 live 复算')
  assert.equal(j.tokens.total, 5_000_000, '快照总量必须原样给出')
  assert.equal(j.liveMatchedSessionCount, 0, '必须同时暴露「live 一个都没命中」')
  assert.match(j.note, /回落/, 'note 必须说明这是回落读数')
  rmSync(home, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true })
})

test('token-cost M4b：live 全灭且无快照 → 仍必须 exit 10（「查不到 ≠ 0」不被回落吞掉）', () => {
  const home = mkHome()
  const proj = mkProj(null)
  const r = run([SCRIPT, '--project', proj], { env: env(home) })
  assert.equal(r.code, 10, '无快照时必须仍然 exit 10：' + r.out.slice(-400))
  assert.match(r.stderr, /未在 .* 找到任何用量记录/, '必须保留 v18.2.6 的报错文案')
  rmSync(home, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true })
})

test('token-cost M4c：回落读数也能排名，且单会话 >20M 必须打尾部预警', () => {
  const home = mkHome()
  const proj = mkProj(snap([56_500_000, 6_500_000]))
  const r = run([SCRIPT, '--project', proj, '--top', '3'], { env: env(home) })
  assert.equal(r.code, 0, r.out.slice(-400))
  const j = JSON.parse(r.stdout)
  assert.equal((j.topByCacheRead || []).length, 2, '回落路径也必须产出 Top 排名（否则历史项目的离群轮永远看不见）')
  assert.equal((j.topWarnings || []).length, 1, '56.5M 那个会话必须进 topWarnings')
  assert.match(j.topWarnings[0], /56\.5M token/, '预警文案必须给出量级')
  rmSync(home, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true })
})

// 这一条需要**造活会话存储**（多帧 zstd 支持随 Node 版本走）：缺 zstd 压缩能力时跳过，不假绿。
test('token-cost M4b：live 与历史快照偏差 >20% → 拒绝覆盖，改写 .new 旁路', { skip: typeof zlib.zstdCompressSync !== 'function' ? '本机 Node 无 zlib.zstdCompressSync（<22.15），跳过活存储构造' : false }, () => {
  const home = mkHome()
  // 活存储：一个会话、200 万 token
  const sessDir = join(home, 'sessions', '--ws--', UUID)
  mkdirSync(sessDir, { recursive: true })
  const usage = { type: 'assistant/message', data: { usage: { inputTokens: 1000, cacheReadTokens: 2_000_000, cacheWriteTokens: 0, outputTokens: 500 } } }
  writeFileSync(join(sessDir, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(JSON.stringify(usage) + '\n')))
  // 历史快照：1000 万（与 live 差 ~80%）
  const proj = mkProj(snap([10_000_000]))
  const snapPath = join(proj, 'final', 'token-cost.json')
  const before = readFileSync(snapPath, 'utf8')

  const r = run([SCRIPT, '--project', proj], { env: env(home) })
  assert.equal(r.code, 0, r.out.slice(-400))
  assert.match(r.stderr, /已拒绝覆盖/, '偏差过大时必须拒绝覆盖历史快照：' + r.stderr.slice(-400))
  assert.equal(readFileSync(snapPath, 'utf8'), before, '历史快照必须一字未改（session_projcache 轮转后它是唯一证据）')
  assert.ok(existsSync(snapPath + '.new'), '本次结果必须落到 .new 旁路，供人工比对')
  rmSync(home, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true })
})
