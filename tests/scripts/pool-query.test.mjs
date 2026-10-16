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

// ── v19.6.10（反哺动议 E **丙案**）：负知识**跨项目只读提示**通道 ──────────────────────────────
// **为什么必须有用例**：本通道是**主人侧读面**的新增行为（`负知识账本.md` §九.1 此前登记为「未做」），
//   而它有一条**极易被重排掉**的时序约束——提示必须打印在「空池早退」**之前**（池空 + 有历史证伪，
//   正是该提示价值最大的场景）。没有用例时，任何人重排 `main()` 这两段都会**静默**让通道在空池下消失。
const mkDisproofs = (row = '{"id":"DP-001","claim":"生成式AI 提升了学术写作质量","verdict":"disproven","basis":"反向研究结论相反","evidence":["[L99] X（2023）"],"reproduce":"查文献卡 [L99] 条目","author":"T6","round":"v2"}') => {
  const ws = tmp('lunheng-pool-dp-')
  mkdirSync(join(ws, 'run', 'projA', 'audits'), { recursive: true })
  writeFileSync(join(ws, 'run', 'projA', 'audits', 'disproofs.jsonl'), row + '\n')
  return ws
}

test('E-丙案：**池 0 条**时负知识提示仍须出现（提示排在「空池早退」之前——反向后钉时序）', () => {
  const ws = mkDisproofs()
  try {
    const r = run([QUERY(), ws, '学术写作'])
    assert.equal(r.code, 0, '查池应 exit 0：' + r.out)
    assert.match(r.out, /空池，无命中/, '空池仍须如实报：' + r.out)
    assert.match(r.out, /负知识账本: 扫描 1 个项目账本，命中 1\/1 条/, '池 0 条不得吃掉负知识通道（时序约束）：' + r.out)
    assert.match(r.out, /生成式AI 提升了学术写作质量/, '命中条目须**原文照印**（本层不做判同）：' + r.out)
    assert.match(r.out, /projA/, '须带 `originProject` 回指：' + r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('E-丙案：关键词不命中 → 显形「命中 0/N」（不得与「没查」同形）', () => {
  const ws = mkDisproofs()
  try {
    const r = run([QUERY(), ws, '完全无关词zzz'])
    assert.equal(r.code, 0)
    assert.match(r.out, /负知识账本: 扫描 1 个项目账本，命中 0\/1 条/, '不命中也须显形，否则「无负知识」与「没查」同形：' + r.out)
    assert.ok(!/（0 条）/.test(r.out), '本文件既有负向断言的口径：任何形态都不得出现「（0 条）」：' + r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('E-丙案：无 `run/` 目录 → 不得打出负知识噪声（旧工作区零影响）', () => {
  const ws = tmp('lunheng-pool-q-')
  try {
    const r = run([QUERY(), ws])
    assert.equal(r.code, 0)
    assert.ok(!/负知识账本/.test(r.out), '无 run/ 时不得提示：' + r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('E-丙案：账本含坏行**不得让查池崩**（它读的是人写的 append-only 账本；点名归 `disproofs-check`）', () => {
  const ws = mkDisproofs('{"id":"DP-001","claim":"坏行')
  try {
    const r = run([QUERY(), ws, '学术写作'])
    assert.equal(r.code, 0, '坏行不得让读面崩成 exit 70：' + r.out)
    assert.match(r.out, /负知识账本: 扫描 1 个项目账本/, '坏行不影响「账本在场」这一事实被如实报出：' + r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

// ── v19.6.11（验证记录 V5b 修复 · **乙案**）：池**已存在但结构不完整**时不得声称「已创建骨架」 ─────
// **反向钉**：`mkPoolNoManifest()` 造的正是「池里有 1 条数据、但只落了一个池 JSON」——
//   即**旧版 `pool-extract` 的产物形态**。旧实现下 `ensurePoolSkeleton` 会补建缺失文件、
//   `created` 置 true，于是输出「✅ 已创建素材池骨架」，与同一行的「（现有 1 条）」**互相打脸**
//   （与审计 P1-2 同族：两条读数矛盾）。
//   本用例同时钉「改报补齐」与「补齐后结构完整」。
test('V5b-乙：池有数据但结构不完整 → 报「补齐缺失的池文件」，**不得**声称「已创建骨架」', () => {
  const ws = mkPoolNoManifest()
  try {
    const r = run([QUERY(), ws])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /现有 1 条/, '池内实有 1 条须如实报：' + r.out)
    assert.match(r.out, /池结构此前不完整，已补齐缺失的池文件/, '缺池文件时须如实报「补齐」：' + r.out)
    assert.ok(!/已创建素材池骨架/.test(r.out),
      '池本已存在（内有 1 条）时**不得**声称「已创建骨架」——与「（现有 1 条）」并列即自相矛盾：' + r.out)
    for (const f of ['literature.json', 'data.json', 'cases.json', 'databases.json']) {
      assert.ok(existsSync(join(poolOf(ws), f)), `补齐后结构应完整（缺 ${f}）`)
    }
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

// ── v19.7.2（**丁案 · 负知识复用计数**）：**同名主张判同**必须是**强判据**，且只有它计入 ────────
// **为什么需要**：丙案（v19.6.10）只做**关键词弱命中**提示，并把「同名主张如何判同」列为**未做**。
//   丁案补强判据（`claim` 归一化后逐字相等），并**只让强判据计入计数**——若把弱命中也计入，
//   同一关键词会命中大量**不同**主张 ⇒ 数字必然虚增，而**失真的统计量比没有统计量更坏**
//   （同仓 P1-1「`reuseCount` 非幂等」：持久化的假数字不可自愈）。
// 本组钉五件事：① 标点/空白/全角差异仍判同名；② 不同 claim 不得报数；③ 弱命中不得算复现；
//   ④ **幂等**（同项目重复查 → 计数不虚增）；⑤ **只写自己的项目**（不碰对方账本）。
const DP = (claim, id = 'DP-001', extra = {}) =>
  ({ claim, verdict: '证伪', basis: '实测：三份政策文本无对应执行条款', originProject: 'projA', id, ...extra })

/** 造「projA 有负知识账本 + projB 是查询方」的工作区。 */
const mkReuseWs = (rows) => {
  const ws = tmp('lunheng-pool-dp-')
  for (const p of ['projA', 'projB']) mkdirSync(join(ws, 'run', p, 'audits'), { recursive: true })
  writeFileSync(join(ws, 'run', 'projA', 'audits', 'disproofs.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return ws
}
const reusePath = (ws, proj) => join(ws, 'run', proj, 'audits', '负知识复用.jsonl')

const CLAIM = '人工智能的伦理原则已足以指导实践。'

test('丁案①：`--claim` 强判据——**标点 / 空白 / 全角差异仍判同名**，并落到查询方自己的账本', () => {
  const ws = mkReuseWs([DP(CLAIM)])
  try {
    // 全角逗号 + 不同空格（归一化后应相等）
    const r = run([QUERY(), ws, '伦理', '--claim', '人工智能的伦理原则，已足以指导实践', '--project', 'projB'])
    assert.equal(r.code, 0, r.out)
    assert.ok(r.out.includes('负知识**同名**复现: 1 条'), '归一化后相等必须判同名（标点/空白不算差异）：' + r.out)
    assert.match(r.out, /已被 1 个项目复现/, r.out)
    assert.ok(existsSync(reusePath(ws, 'projB')), '给了 --project 必须在本项目账本留痕')
    const rows = readFileSync(reusePath(ws, 'projB'), 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l))
    assert.equal(rows.length, 1, '一次命中原生一行：' + JSON.stringify(rows))
    assert.equal(rows[0].queryingProject, 'projB', '归属必须是查询方项目')
    assert.equal(rows[0].originProject, 'projA', '须回指来源项目')
    assert.equal(rows[0].originId, 'DP-001')
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('丁案② 反向自证：**不同的 claim 不得报数**（防「给了 --claim 就报 1 条」）', () => {
  const ws = mkReuseWs([DP(CLAIM)])
  try {
    const r = run([QUERY(), ws, '伦理', '--claim', '完全不同的另一条主张', '--project', 'projB'])
    assert.equal(r.code, 0, r.out)
    assert.ok(r.out.includes('负知识**同名**复现: 0 条'), '不相等必须报 0：' + r.out)
    assert.ok(!existsSync(reusePath(ws, 'projB')), '0 条时不得落痕（不留空账本）')
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('丁案③：**弱命中不计入同名**——关键词命中（提示层有行）但 claim 不同 → 同名仍报 0', () => {
  const ws = mkReuseWs([DP(CLAIM)])
  try {
    // 「政策文本」只在 basis 里（弱判据命中），不在 claim 里（同名判据不命中）
    const r = run([QUERY(), ws, '政策文本', '--claim', CLAIM, '--project', 'projB'])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /命中 1\/1 条/, '弱判据层应照旧命中：' + r.out)
    assert.ok(r.out.includes('负知识**同名**复现: 1 条'), 'claim 逐字相等（含句号）应判同名：' + r.out)
    // 反向：关键词命中而 claim 不同 → 同名必须 0，且明说弱命中不算复现
    const r2 = run([QUERY(), ws, '政策文本', '--claim', '换一条与账本不同的主张', '--project', 'projB'])
    assert.ok(r2.out.includes('负知识**同名**复现: 0 条'), r2.out)
    assert.match(r2.out, /上列弱命中\*\*不算\*\*复现/, '必须显式声明弱命中不计入：' + r2.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('丁案④ **幂等**：同一项目重复查 → 「已被 N 个项目复现」不虚增（N 按项目去重）', () => {
  const ws = mkReuseWs([DP(CLAIM)])
  try {
    for (const n of [1, 2, 3]) {
      const r = run([QUERY(), ws, '伦理', '--claim', CLAIM, '--project', 'projB'])
      assert.equal(r.code, 0, `第 ${n} 跑应 exit 0：` + r.out)
      assert.match(r.out, /已被 1 个项目复现/,
        `第 ${n} 跑：同一项目重复查不得把「已被 N 个项目复现」推高（旧病 = 持久化假数字不可自愈）：` + r.out)
    }
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('丁案⑤：**只写查询方自己的项目**——projA 的账本一字不动', () => {
  const ws = mkReuseWs([DP(CLAIM)])
  const aFile = join(ws, 'run', 'projA', 'audits', 'disproofs.jsonl')
  try {
    const before = readFileSync(aFile, 'utf8')
    const r = run([QUERY(), ws, '伦理', '--claim', CLAIM, '--project', 'projB'])
    assert.equal(r.code, 0, r.out)
    assert.equal(readFileSync(aFile, 'utf8'), before, '跨项目写别人的账本是危险动作——来源账本必须逐字未变')
    assert.ok(!existsSync(reusePath(ws, 'projA')), '不得往来源项目写复用记录')
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('丁案⑥：不给 `--claim` → 只走弱判据，**明确声明不产生计数**（不静默）', () => {
  const ws = mkReuseWs([DP(CLAIM)])
  try {
    const r = run([QUERY(), ws, '伦理', '--project', 'projB'])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /不产生复用计数/, '必须显式声明「未给 --claim ⇒ 不计数」：' + r.out)
    assert.ok(!existsSync(reusePath(ws, 'projB')), '未给 --claim 不得落痕')
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('丁案⑦ argv 严格性：`--claim` 缺值必须 exit 10（不得被当位置参数吃掉）', () => {
  const ws = mkReuseWs([DP(CLAIM)])
  try {
    const r = run([QUERY(), ws, '--claim'])
    assert.equal(r.code, 10, '`--claim` 缺值应 exit 10：' + r.out)
    assert.match(r.out, /缺少值/, '须点明是缺值：' + r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})
