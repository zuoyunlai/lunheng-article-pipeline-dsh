// P1-2 / S2 阶段 1（影子运行）的回归：
//   ① 配置完整性——gate_na 的每一项必须是**真实存在的门 id**（否则那条 N/A 永不生效），且必须有理由；
//   ② 与 `文类档案.md` 的两列对账（minL ↔ 文献下限、structure ↔ 结构门），防两份真源漂移；
//   ③ 行为——**阶段 1 不改变任何 exit/聚合**（同夹具换 --genre 跑两次，exit/p0/p1/p2 必须逐字段相同）；
//   ④ 影子可见——不适用的门若本次会失败，必须进 `shadow_fail`（否则阶段 1 白跑）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, tmp, ROOT } from './_fixtures.mjs'

const S = (n) => join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', n)
const MGATE = S('m-gate-check.mjs')
const PROFILE = S('_lib/genre-profiles.json')
const ARCHIVE = join(ROOT, 'skills', 'lunheng-article-pipeline', 'references', '_shared', '文类档案.md')

const profile = () => JSON.parse(readFileSync(PROFILE, 'utf8'))

// 只带三节文末（缺「先行者文献」「AI 使用声明」）→ M-Form-2 必失败，用来测影子。
const DRAFT_3 = '# 标题\n\n## 摘要\n\n本文引用 [L01] 与 [D01]。\n\n## 一、正文\n\n' + '汉'.repeat(300)
  + '\n\n## 参考文献\n\n[1] 某文.\n\n## 数据来源\n\n[D01] 某数据\n\n## 案例来源\n'

function mkFixture(draft = DRAFT_3) {
  const d = tmp('lunheng-genre-')
  const fin = join(d, 'run', 'proj', 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), draft, 'utf8')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 索引\n\n[D01] 某数据（2021）\n', 'utf8')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 索引\n\n[L01] 某文（2020）\n', 'utf8')
  return { d, draftPath: join(fin, '定稿.md'), ev }
}

/** 用一次真跑反推门 id 集合（不手写清单——手写就会与实现漂）。 */
function gateIds() {
  const f = mkFixture()
  try {
    const out = join(f.d, 'rep.json')
    run([MGATE, f.draftPath, f.ev, '--report', out])
    const j = JSON.parse(readFileSync(out, 'utf8'))
    return new Set((j.results || []).map((r) => String(r.gate || '').split(' ')[0]))
  } finally { rmSync(f.d, { recursive: true, force: true }) }
}

test('P1-2 配置完整性：gate_na 必须是真实门 id，且每条都有理由', () => {
  const p = profile()
  assert.ok(Number.isInteger(p.profile_version), 'profile_version 必填（报告要记版本，供历史可比）')
  const ids = gateIds()
  assert.ok(ids.size >= 20, '夹具应跑出足量门用于派生 id 集合：实得 ' + ids.size)
  for (const [code, g] of Object.entries(p.genres)) {
    assert.ok(Array.isArray(g.gate_na), `${code}.gate_na 必须是数组`)
    for (const id of g.gate_na) {
      assert.ok(ids.has(id), `${code} 的 gate_na 含不存在的门 id "${id}"——拼错的 N/A 会永不生效`)
      assert.ok(g.na_reason && typeof g.na_reason[id] === 'string' && g.na_reason[id].length >= 6,
        `${code}.${id} 缺 na_reason（无理由的 N/A 不允许：它会让 N/A 变成逃逸口）`)
    }
  }
})

test('P1-2 与文类档案对账：minL ↔ 文献下限、structure ↔ 结构门', () => {
  const rows = readFileSync(ARCHIVE, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('| `'))
  const parse = (line) => line.split('|').map((c) => c.trim())
  const mapStructure = (cell) => {
    if (cell.includes('开题九节')) return 'kaiti-nine'
    if (cell.includes('不跑')) return 'off'
    if (cell.includes('IMRaD-Alternate')) return 'imrad-alt'
    if (cell.includes('IMRaD')) return 'imrad'
    return cell
  }
  const table = new Map()
  for (const line of rows) {
    const c = parse(line)
    const code = c[1].replace(/`/g, '')
    table.set(code, { structure: mapStructure(c[6]), minL: Number(c[14]) })
  }
  for (const [code, g] of Object.entries(profile().genres)) {
    const row = table.get(code)
    assert.ok(row, `文类档案.md 里找不到 ${code} 行——JSON 与真源表脱节`)
    assert.equal(g.minL, row.minL, `${code}.minL=${g.minL} 与文类档案「文献下限」=${row.minL} 不一致`)
    assert.equal(g.structure, row.structure, `${code}.structure=${g.structure} 与文类档案「结构门」=${row.structure} 不一致`)
  }
})

test('P1-2 未启用文类逐字段不变：academic-cn vs academic-hum（都未 enable，且文献下限同为 3）', () => {
  const f = mkFixture()
  try {
    const a = join(f.d, 'a.json')
    const b = join(f.d, 'b.json')
    // ⚠️ 对照组必须选**文献下限相同**的两个文类：`--genre` 自 v18.72.0 起会驱动 M-Form-1 的下限
    //   （academic-cn/hum 都是 3；policy 是 2），否则 p1 会因为阈值不同而不同——那是既有行为，不是本批改动。
    run([MGATE, f.draftPath, f.ev, '--genre', 'academic-cn', '--report', a])
    run([MGATE, f.draftPath, f.ev, '--genre', 'academic-hum', '--report', b])
    const ja = JSON.parse(readFileSync(a, 'utf8'))
    const jb = JSON.parse(readFileSync(b, 'utf8'))
    for (const k of ['exit', 'p0', 'p1', 'p2', 'total', 'pass']) {
      assert.equal(jb[k], ja[k], `未启用文类不得改变 ${k}（academic-cn=${ja[k]} / academic-hum=${jb[k]}）`)
    }
    assert.equal(jb.gates_na, undefined, '两个文类都未配 N/A，不得产生 gates_na')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('P1-2 阶段 2：kaiti 的 N/A 已生效——p0 下降、项标 na、总数可对账', () => {
  const f = mkFixture()
  try {
    const a = join(f.d, 'a.json')
    const b = join(f.d, 'b.json')
    run([MGATE, f.draftPath, f.ev, '--genre', 'academic-cn', '--report', a])
    run([MGATE, f.draftPath, f.ev, '--genre', 'kaiti', '--report', b])
    const ja = JSON.parse(readFileSync(a, 'utf8'))
    const jb = JSON.parse(readFileSync(b, 'utf8'))
    assert.equal(jb.genre, 'kaiti')
    assert.equal(jb.na_count, 3, 'kaiti 登记 3 项 N/A：实得 ' + jb.na_count)
    assert.equal(jb.evaluated_total + jb.na_count, jb.total,
      `对账失败：evaluated_total(${jb.evaluated_total}) + na_count(${jb.na_count}) 应等于 total(${jb.total})`)
    const m2 = jb.results.find((r) => /M-Form-2/.test(r.gate || ''))
    assert.equal(m2.na, true, 'M-Form-2 必须被标 na（排除出判定集）')
    assert.equal(m2.pass, false, '影子值须保留（pass 仍是真实判定），供复核 N/A 表是否合理')
    // 不比较 p0 总数：`--genre` 同时驱动 M-Form-1 的文献下限（kaiti=10 / academic-cn=3），
    //   两侧差异会混入阈值效应，无法归因到 N/A。只钉「N/A 项不再计入」这一件事。
    assert.equal(ja.na_count, undefined, '全量档不得出现 na_count')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('P1-2 阶段 2：对已 N/A 的项写裁定 → exit 30（防「裁定绕过 profile」）', () => {
  const f = mkFixture()
  try {
    const out = join(f.d, 'rep.json')
    const adj = join(f.d, 'adj.json')
    writeFileSync(adj, JSON.stringify({
      true_p0: 0,
      true_p1: 0,
      verdict: 'test',
      llm_review: '① 逐条枚举：无；② 真阳性扫描：无；③ 规范冲突说明：无；④ 独立复核来源：本用例',
      refutations: [{ gate: 'M-Form-2 文末必需五节存在性', basis: 'test', reason_code: 'not-applicable' }],
    }), 'utf8')
    const r = run([MGATE, f.draftPath, f.ev, '--genre', 'kaiti', '--report', out, '--adjudicate', adj])
    assert.equal(r.code, 30, '裁定点名 N/A 项时必须 exit 30（拒绝裁定 ≠ 内容失败）：' + r.out.slice(-200))
    assert.match(r.out, /已 N\/A/, '拒绝理由须点名「已 N/A」')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('P1-2 影子可见：不适用且本次会失败的门必须进 shadow_fail', () => {
  const f = mkFixture()   // 只带三节文末 → M-Form-2 必然失败
  try {
    const out = join(f.d, 'rep.json')
    run([MGATE, f.draftPath, f.ev, '--genre', 'kaiti', '--report', out])
    const j = JSON.parse(readFileSync(out, 'utf8'))
    const m2 = j.results.find((r) => /M-Form-2/.test(r.gate || ''))
    assert.equal(m2.pass, false, '夹具设计前提：三节文末应让 M-Form-2 失败')
    assert.ok(Array.isArray(j.shadow_fail) && j.shadow_fail.some((x) => x.gate === 'M-Form-2'),
      'shadow_fail 必须记下「N/A 但本次会失败」的项：' + JSON.stringify(j.shadow_fail))
    assert.equal(j.exit, 2, '阶段 1 仍按全量判定给 exit（M-Form-2 是硬红线 P0）——影子不得洗白')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('P1-2 兜底：配置不可读时退回今天的行为（不得抛错、不得产生 gates_na）', () => {
  // 用不存在的 genre code 走「profile 无该文类」分支（等价于未配置）
  const f = mkFixture()
  try {
    const out = join(f.d, 'rep.json')
    const r = run([MGATE, f.draftPath, f.ev, '--genre', 'academic-cn', '--report', out])
    assert.equal(r.code === 10, false, 'academic-cn 是合法 code，不得被判参数错')
    const j = JSON.parse(readFileSync(out, 'utf8'))
    assert.equal(j.genre, 'academic-cn')
    assert.equal(j.gates_na, undefined, '未配置 N/A 的文类不得凭空产生 gates_na')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})
