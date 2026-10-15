// 素材池查池脚本 `pool-query.mjs` 回归网（v19.6.1 · 审计 P1-2 / P2-6）
//
// **为什么需要**：本脚本是**主人侧读面**（`references/_shared/素材池.md` §七 的 Phase 0.5 标准动作），
//   却零测试覆盖。审计 P1-2 实测：删掉 `manifest.json` 后查池，同一进程内先打印
//   「✅ 已创建空素材池骨架（0 条）」再打印「命中 1/1 条」——**自相矛盾**，且写入的 `totalEntries`
//   恒为 0、与四个池文件的实际内容无关，在下次跑 `pool-extract` 前**不自愈**。
//
// 本文件钉两条：
//   · **惰性建骨架**：池不存在 → 建目录与空池文件 + 空 manifest，且报「空池无命中」；
//   · **manifest 是派生量**：只读入口（本脚本）在池有数据而 manifest 缺失时，必须给出**与池一致**的
//     计数（重算），不得恒写 0。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from '../_fixtures.mjs'

const QUERY = () => join(SCRIPTS, 'pool-query.mjs')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
const poolOf = (ws) => join(ws, 'evidence-pool')

const ENTRY = {
  poolId: 'L-deadbeef0001', dedupKey: '10.1234/abcd', type: 'L',
  title: '某文献标题', source: '某机构', year: 2024,
  url: [], doi: ['10.1234/abcd'], trustLevel: '已发布', timeliness: '',
  claim: '', abstract: '', topics: [], channel: '项目沉淀', originProject: 'proj',
  firstRetrievedAt: '2026-10-15', reuseCount: 2, reusedBy: ['proj'], sourcePath: '', sourceSha: '',
}

/** 造一个「池文件有数据、manifest 缺失」的工作区（P1-2 的触发形态）。 */
const mkPoolNoManifest = () => {
  const ws = tmp('lunheng-pool-q-')
  mkdirSync(poolOf(ws), { recursive: true })
  writeFileSync(join(poolOf(ws), 'literature.json'), JSON.stringify({ version: 1, entries: [ENTRY] }, null, 2) + '\n')
  return ws
}

test('P1-2：**池有数据而 manifest 缺失** → 查池必须重算并落盘一致计数（旧版恒写 0）', () => {
  const ws = mkPoolNoManifest()
  try {
    const r = run([QUERY(), ws])
    assert.equal(r.code, 0, '查池应 exit 0：' + r.out)
    const mf = join(poolOf(ws), 'manifest.json')
    assert.ok(existsSync(mf), '查池应落 manifest.json（惰性建骨架）')
    const m = readJson(mf)
    assert.equal(m.totalEntries, 1, '`totalEntries` 是派生量：池里 1 条就必须写 1（旧版写 0，与池自相矛盾）')
    assert.equal(m.byType.L, 1, '`byType` 同样必须由池文件重算：' + JSON.stringify(m.byType))
    assert.equal(m.byChannel['项目沉淀'], 1, '`byChannel` 必须由池文件重算：' + JSON.stringify(m.byChannel))
    assert.equal(m.reuseCountTotal, 2, '`reuseCountTotal` 必须由池文件重算：' + JSON.stringify(m))
    // 同一进程内不得自相矛盾（旧版：先报「（0 条）」再报「命中 1/1 条」）
    assert.match(r.out, /命中 1\/1 条/, r.out)
    assert.ok(!/（0 条）/.test(r.out), '池内实有 1 条时不得报「（0 条）」：' + r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('P1-2 配套：池**真为空**时才报「空池无命中」，且 manifest 为 0', () => {
  const ws = tmp('lunheng-pool-q-')
  try {
    const r = run([QUERY(), ws])
    assert.equal(r.code, 0, '空池不是错误（exit 0）：' + r.out)
    assert.match(r.out, /空池，无命中/, r.out)
    const m = readJson(join(poolOf(ws), 'manifest.json'))
    assert.equal(m.totalEntries, 0)
    assert.equal(m.byType.L, 0)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('P2-6④：池文件带 BOM 仍可解析（不得崩成 exit 70）', () => {
  const ws = mkPoolNoManifest()
  try {
    writeFileSync(join(poolOf(ws), 'literature.json'),
      '\uFEFF' + readFileSync(join(poolOf(ws), 'literature.json'), 'utf8'), 'utf8')
    const r = run([QUERY(), ws, '某文献'])
    assert.equal(r.code, 0, 'BOM 输入不得让脚本崩：' + r.out)
    assert.match(r.out, /命中 1\/1 条/, 'BOM 池文件应被正常解析：' + r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('关键词过滤：命中 0 条时如实报「池内 N 条，关键词无命中」（不得与空池同形）', () => {
  const ws = mkPoolNoManifest()
  try {
    const r = run([QUERY(), ws, '不存在的关键词'])
    assert.equal(r.code, 0)
    assert.match(r.out, /池内 1 条/, r.out)
    assert.match(r.out, /无命中/, r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('防空转：查池必须真建出四个空池文件（池不存在时的惰性创建面）', () => {
  const ws = tmp('lunheng-pool-q-')
  try {
    run([QUERY(), ws])
    for (const f of ['literature.json', 'data.json', 'cases.json', 'databases.json']) {
      assert.ok(existsSync(join(poolOf(ws), f)), `惰性建骨架应落 ${f}`)
    }
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

// ── v19.6.6（素材池可见性批）：**每轮显形**是本次新增的行为契约，必须有用例钉住 ─────────────
// 反向自证：旧实现在「非空池 + manifest 一致 + 命中」时**全程静默**（只在新建骨架时报一次路径），
//   主人侧的读面因此看不到池在哪、有多少——本用例对**三种形态**都要求出现「· 素材池: <路径>（现有 N 条）」。
test('v19.6.6 可见性：任何形态都必须显形「池路径 + 现有条数」（旧版非空池命中时全程静默）', () => {
  const cases = [
    { label: '池不存在（惰性建骨架）', setup: () => tmp('lunheng-pool-q-'), hit: true },
    { label: '池有数据 + manifest 缺失', setup: () => mkPoolNoManifest(), hit: true },
    { label: '池有数据但关键词无命中', setup: () => mkPoolNoManifest(), hit: false },
  ]
  for (const c of cases) {
    const dir = c.setup()
    try {
      const r = run(c.hit ? [QUERY(), dir] : [QUERY(), dir, '不存在的关键词zzz'])
      assert.equal(r.code, 0, `${c.label} 应 exit 0：` + r.out)
      assert.match(r.out, /· 素材池: .+（现有 \d+ 条）/, `${c.label} 必须显形池路径与现有条数：` + r.out)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})

test('v19.6.6 可见性：**空池**时须把「档 B 此刻不可用」摆到主人面前（真源 = 素材池.md §11.5 第 4 条）', () => {
  const ws = tmp('lunheng-pool-q-')
  try {
    const r = run([QUERY(), ws])
    assert.match(r.out, /池内 0 条/, r.out)
    assert.match(r.out, /仅本地素材/, '空池必须提示档 B 无来源：' + r.out)
    assert.match(r.out, /§11\.5/, '提示须指向机制真源（否则主控只能临场约定）：' + r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})
