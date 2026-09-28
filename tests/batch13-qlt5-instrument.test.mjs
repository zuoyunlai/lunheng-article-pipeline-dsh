// v18.48.0（QLT-5 实测反哺批次 1）**量具类**修复回归：F-R / F-AW
//
// 为什么单独立批文件：本批修的都是**"读数/证据"本身**的缺陷 —— 它们不改变任何门判内容，
//   但会让**下游拿到的证据失真**。故每条都直接锁「失真形态」，而不是锁某个输出字符串。
//   · **F-R**：证据包复制**不校验源**——实测某项目 `final/证据包/修订说明-v2.md` = 0 B，
//     而源完好（31 307 B）。成因 = 拷贝撞上写手正在写源文件（`copyFileSync` 不是原子的）。
//     最坏后果不是"少一个文件"，而是**manifest 照 0 字节副本记 sha256 → 内部自洽**，
//     于是 M-Exist-2「清单复算通过」**证明不了一份坏副本是坏的**。
//   · **F-AW**：`token-cost --project` 只读**投影缓存**（`storages/session_projcache/`）——
//     实测本机该缓存停在 09-21，而实验期跑了 500 个会话 → `matchedSessionCount: 0` / **exit 10**，
//     即"查不到"被当成"没有成本数据"。真源是 `$DSH_HOME/sessions/<ws>/<id>/session.v3.jsonl.zstd`（**多帧 zstd**）。
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { zstdCompressSync } from 'node:zlib'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'

const BUNDLE = join(SCRIPTS, 'build-evidence-bundle.mjs')
const TOKEN_COST = join(SCRIPTS, 'token-cost.mjs')

test('build-evidence-bundle（F-R）：0 字节源必须被拒绝——不落副本、点名、写进 manifest', () => {
  const d = tmp('lunheng-fr-')
  try {
    const proj = join(d, 'proj')
    const fin = join(proj, 'final')
    const ev = join(fin, '证据包')
    const drafts = join(proj, 'drafts')
    mkdirSync(ev, { recursive: true })
    mkdirSync(drafts, { recursive: true })
    writeFileSync(join(drafts, '修订说明-v8.md'), '# 修订说明 v8\n\n正常内容。\n')
    writeFileSync(join(drafts, '修订说明-v9.md'), '')   // ← 0 字节（并发写入窗口的形态）
    const r = run([BUNDLE, proj])
    assert.equal(existsSync(join(ev, '修订说明-v9.md')), false,
      '0 字节源**不得**被复制进证据包（否则 manifest 会照它记 sha256，把坏副本洗成合规）')
    assert.ok(existsSync(join(ev, '修订说明-v8.md')), '正常源照常复制（守卫不得误伤）')
    assert.match(r.out, /拒绝复制 0 字节源/, '必须显式点名被拒绝的源：' + r.out)
    const m = JSON.parse(readFileSync(join(ev, 'manifest.json'), 'utf8'))
    assert.deepEqual(m.zeroByteSrcs, ['drafts/修订说明-v9.md'],
      'manifest 必须留下**可复算的断言**，而不是靠"少一个文件"暗示')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('token-cost（F-AW）：投影缓存未命中 → 回落**活会话存储**（多帧 zstd），不得报 0 / exit 10', () => {
  const d = tmp('lunheng-faw-')
  try {
    const home = join(d, 'dshhome')
    const sid = '11111111-2222-3333-4444-555555555555'
    const wsDir = join(home, 'sessions', '--WS--', sid)
    mkdirSync(wsDir, { recursive: true })
    // 多帧 zstd：每帧一条事件（复现真实存储形态——单帧解压器只能读到第一帧，故该用例同时锁"逐帧解"）
    const frames = [
      JSON.stringify({ type: 'assistant/message', data: { usage: { inputTokens: 100, cacheReadTokens: 2000, outputTokens: 50 } } }),
      JSON.stringify({ type: 'assistant/message', data: { usage: { inputTokens: 10, cacheReadTokens: 300, outputTokens: 5 } } }),
    ].map((l) => zstdCompressSync(Buffer.from(l + '\n', 'utf8')))
    writeFileSync(join(wsDir, 'session.v3.jsonl.zstd'), Buffer.concat(frames))
    // 投影缓存目录**存在但没有该会话** ← 这就是 F-AW 的现场（缓存陈旧，不是"没有数据"）
    mkdirSync(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
    const proj = join(d, 'proj')
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, 'agents-log.md'), `### T5 写手\n- 会话 ${sid}\n`)
    const r = run([TOKEN_COST, '--project', proj, '--dsh-home', home])
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    assert.equal(r.code, 0, '回落到真源后不得再 exit 10：' + r.out + r.err)
    assert.equal(j.matchedSessionCount, 1, '缓存未命中必须回落活存储（旧版此处为 0 → exit 10）')
    assert.equal(j.matchedFromLiveStore, 1, '须如实标注该命中来自活存储，让读报表的人知道数据源')
    assert.equal(j.tokens.total, 2465, '两帧用量必须都累加（110 in + 2300 cacheRead + 55 out）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('token-cost（F-AW 反向控制组）：缓存命中时不得走回落（口径优先级不得被改）', () => {
  const d = tmp('lunheng-faw2-')
  try {
    const home = join(d, 'dshhome')
    const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const wsDir = join(home, 'sessions', '--WS--', sid)
    mkdirSync(wsDir, { recursive: true })
    writeFileSync(join(wsDir, 'session.v3.jsonl.zstd'), zstdCompressSync(Buffer.from(
      JSON.stringify({ type: 'assistant/message', data: { usage: { inputTokens: 999, cacheReadTokens: 0, outputTokens: 0 } } }) + '\n', 'utf8')))
    const cdir = join(home, 'storages', 'session_projcache', 'sessions')
    mkdirSync(cdir, { recursive: true })
    writeFileSync(join(cdir, `${sid}.json`), JSON.stringify({
      record: { rows: { tokenUsage: { val: { totals: {
        uncachedInputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } } } } },
    }))
    const proj = join(d, 'proj')
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, 'agents-log.md'), `- ${sid}\n`)
    const r = run([TOKEN_COST, '--project', proj, '--dsh-home', home])
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    assert.equal(j.tokens.uncachedInput, 7, '缓存命中时**必须用缓存值**（7），回落只作补充、不得夺权')
    assert.equal(j.matchedFromLiveStore, 0, '控制组：本次运行不应有任何会话来自回落')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
