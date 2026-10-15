// 素材池统计脚本 `pool-report.mjs` 回归网（v19.6.1 · 审计 P1-3 / P2-6）
//
// **为什么需要**：本脚本生成主人侧可读视图 `evidence-pool/index.md`，却零测试覆盖；且其写盘
//   旧版为裸 `writeFileSync`（审计 P1-3：无原子写、无 `.bak` 回滚点）。
//
// 本文件钉两条：
//   · **读面口径**：`pool-report` 取的是**池文件的真源**（不采信 `manifest.json` 这份冗余副本）——
//     故它与 `pool-query` 对同一池必须给出同一个「总条目」；
//   · **写面安全**：`index.md` 覆盖前留下时间戳 `.bak`。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from '../_fixtures.mjs'

const REPORT = () => join(SCRIPTS, 'pool-report.mjs')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
const poolOf = (ws) => join(ws, 'evidence-pool')

const mkPool = ({ entries = [] } = {}) => {
  const ws = tmp('lunheng-pool-r-')
  mkdirSync(poolOf(ws), { recursive: true })
  writeFileSync(join(poolOf(ws), 'literature.json'), JSON.stringify({ version: 1, entries }, null, 2) + '\n')
  return ws
}
const entry = (n, reuse = 0, by = []) => ({
  poolId: `L-${n}`, dedupKey: `10.1234/${n}`, type: 'L', title: `文献${n}`, source: '某机构', year: 2024,
  url: [], doi: [], trustLevel: '已发布', timeliness: '🟢', claim: '', abstract: '', topics: [],
  channel: '项目沉淀', originProject: 'proj', firstRetrievedAt: '2026-10-15',
  reuseCount: reuse, reusedBy: by, sourcePath: '', sourceSha: '',
})

test('读面：总条目 / 分布 / 累计复用取自池文件真源，并落盘 index.md', () => {
  const ws = mkPool({ entries: [entry('a', 2, ['p1', 'p2']), entry('b', 0, [])] })
  try {
    const r = run([REPORT(), ws])
    assert.equal(r.code, 0, '统计应 exit 0：' + r.out)
    assert.match(r.out, /总条目: 2 \(L=2 D=0 C=0 DB=0\)/, r.out)
    assert.match(r.out, /累计复用 2 次/, r.out)
    assert.match(r.out, /最高复用「文献a」×2/, r.out)
    const idx = join(poolOf(ws), 'index.md')
    assert.ok(existsSync(idx), 'index.md 必须落盘')
    const md = readFileSync(idx, 'utf8')
    assert.match(md, /总条目 2/, 'index.md 的计数须与 stdout 同源')
    assert.ok(md.includes('文献a') && md.includes('文献b'), '条目清单须列出两条')
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('读面：manifest 与池文件矛盾时**以池文件为准**（manifest 是冗余副本，不是真源）', () => {
  const ws = mkPool({ entries: [entry('a')] })
  try {
    // 人为写一份「自称 0 条」的 manifest（P1-2 的失真形态）
    writeFileSync(join(poolOf(ws), 'manifest.json'), JSON.stringify({
      createdAt: '2026-10-15', totalEntries: 0, byType: { L: 0, D: 0, C: 0, DB: 0 },
      byChannel: { '主人预设': 0, '项目沉淀': 0 }, reuseCountTotal: 0, lastUpdated: '2026-10-15',
    }, null, 2) + '\n')
    const r = run([REPORT(), ws])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /总条目: 1/, '统计必须信池文件（1 条），不得被错误的 manifest 带偏：' + r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('P1-3：index.md 覆盖写留时间戳 `.bak`（旧版裸 writeFileSync → 无回滚点）', () => {
  const ws = mkPool({ entries: [entry('a')] })
  try {
    assert.equal(run([REPORT(), ws]).code, 0)
    assert.equal(readdirSync(poolOf(ws)).filter((x) => /^index\.md\..*\.bak$/.test(x)).length, 0,
      '首次写盘目标不存在 → 无备份可做（如实）')
    assert.equal(run([REPORT(), ws]).code, 0)
    assert.ok(readdirSync(poolOf(ws)).some((x) => /^index\.md\..*\.bak$/.test(x)),
      '第二次写 index.md 应留时间戳 .bak：' + readdirSync(poolOf(ws)).join(','))
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('P2-6④：池文件带 BOM 仍可解析（不得崩成 exit 70）', () => {
  const ws = mkPool({ entries: [entry('a')] })
  try {
    const p = join(poolOf(ws), 'literature.json')
    writeFileSync(p, '\uFEFF' + readFileSync(p, 'utf8'), 'utf8')
    const r = run([REPORT(), ws])
    assert.equal(r.code, 0, 'BOM 输入不得让脚本崩：' + r.out)
    assert.match(r.out, /总条目: 1/, r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('防空转：池文件确实被读到（否则上面的断言会因 0 条而恒假）', () => {
  const ws = mkPool({ entries: [entry('a')] })
  try {
    const j = readJson(join(poolOf(ws), 'literature.json'))
    assert.equal(j.entries.length, 1, '夹具自身必须真有 1 条')
  } finally { rmSync(ws, { recursive: true, force: true }) }
})
