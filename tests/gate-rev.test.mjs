// 门版本指纹 gate_rev 回归（v18.81.0 · 独立审计批 1.2）
//
// **为什么需要**（实测病灶，不是假想）：`final/M-Gate-Report.json` 只绑定**被审正文指纹**，
//   不绑定**门版本**。实测 `run/夫妻收入差异家庭权力` 的同一份 `final/定稿.md`
//   （sha256 `01b89282…`，逐字节未变）在 2026-09-30 的报告里是 `p0=0 / p1=0 / p2=5 / script_exit_raw=3`，
//   用当前脚本复跑得 `exit=2 / p0=2 / p1=1` —— 而报告的 `verdict_stale` 仍是 `false`
//   （判据只看正文指纹）。于是「按旧门交的」与「漏跑了」在**所有字段上同形**。
//   本组用例钉住三态：**缺 rev（legacy 容忍）／rev 漂移（判陈旧）／rev 一致（保留裁定）**。
//
// 边界（如实）：`gate_rev` 是**内容哈希**，注释改动也会抬 rev；本组用例不判「改动是否重要」
//   （语义不下沉），只判「漂移被看见」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCRIPTS, run, parseJson, tmp, mkProject } from './_fixtures.mjs'
import { DRAFT_OK, setupCards } from './_scripts-shared.mjs'

const M = () => join(SCRIPTS, 'm-gate-check.mjs')
const FOUR = '① 逐条枚举：该项属格式严格度；② 真阳性扫描：全稿无对应硬缺陷；③ 规范冲突说明：与机检契约不冲突；④ 独立复核来源：T7 审计报告-v2 复核'
const readReport = (p) => JSON.parse(readFileSync(p, 'utf8'))

/** 无红线夹具：与 `tests/adjudicate.test.mjs` 的 mkClean 同构（三卡 + 五节文末 + 编号闭环）。 */
const mkClean = () => {
  const { d, proj, fin, ev } = mkProject({})
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), DRAFT_OK)
  setupCards(ev)
  return { d, proj, fin, ev, draft: join(fin, '定稿.md'), report: join(fin, 'M-Gate-Report.json') }
}

// ── 单元：computeGateRev 的稳定性与敏感性 ──────────────────────────────────────
test('gate-rev U1：同内容同 rev、改一个字节即变、新增嵌套文件即变（且不发散）', async () => {
  const { computeGateRev } = await import(pathToFileURL(join(SCRIPTS, '_lib', 'gate-rev.mjs')).href)
  const dir = tmp('lunheng-gaterev-')
  try {
    mkdirSync(join(dir, '_lib', 'mgate-gates'), { recursive: true })
    writeFileSync(join(dir, 'a.mjs'), 'export const a = 1\n')
    writeFileSync(join(dir, '_lib', 'b.mjs'), 'export const b = 2\n')
    writeFileSync(join(dir, '_lib', 'mgate-gates', 'c.mjs'), 'export const c = 3\n')
    const r1 = computeGateRev(dir)
    const r2 = computeGateRev(dir)
    assert.equal(r1.rev, r2.rev, '同内容必须同 rev（可复现）')
    assert.equal(r1.rev.length, 12, 'rev 为 12 位十六进制')
    assert.match(r1.rev, /^[0-9a-f]{12}$/)
    assert.equal(r1.fileCount, 3, '递归收集 .mjs（含 _lib 与门族子目录）')

    writeFileSync(join(dir, '_lib', 'b.mjs'), 'export const b = 2 // touched\n')
    const r3 = computeGateRev(dir)
    assert.notEqual(r3.rev, r1.rev, '**内容变了 rev 必须变**（否则漂移不可见）')

    writeFileSync(join(dir, '_lib', 'mgate-gates', 'd.mjs'), 'export const d = 4\n')
    const r4 = computeGateRev(dir)
    assert.notEqual(r4.rev, r3.rev, '新增嵌套门文件必须抬 rev（只哈希入口会漏掉绝大多数真改动）')
    assert.equal(r4.fileCount, 4)

    // 空目录 / 不存在目录：不抛异常（报告缺 rev 会让整条链读不到版本）
    const empty = join(dir, 'nope')
    assert.doesNotThrow(() => computeGateRev(empty))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── 集成：报告必带 gate_rev ────────────────────────────────────────────────────
test('gate-rev I1：新报告必须带 gate_rev（无 prev 的首次运行）', () => {
  const f = mkClean()
  try {
    const r = run([M(), f.draft, f.ev, '--report', f.report])
    assert.ok(existsSync(f.report), '报告应落盘：' + r.out)
    const j = readReport(f.report)
    assert.match(String(j.gate_rev), /^[0-9a-f]{12}$/, '报告须带 gate_rev：' + JSON.stringify(Object.keys(j)))
    assert.ok(Number(j.gate_rev_files) > 30, 'gate_rev_files 应反映真实文件数（实测本包 61）')
    assert.match(String(j.read_rule), /gate_rev/, 'read_rule 必须把跨版本读法写给消费者')
    assert.deepEqual(j.hard_red_line_hits, [], '夹具不应命中红线（漂移分支以 red=0 为前提）')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

// ── 集成：三态 ────────────────────────────────────────────────────────────────
test('gate-rev I2：legacy（既有报告无 gate_rev）→ 标 gate_rev_absent，**不翻** verdict_stale', () => {
  const f = mkClean()
  try {
    run([M(), f.draft, f.ev, '--report', f.report])
    const prev = readReport(f.report)
    delete prev.gate_rev; delete prev.gate_rev_files
    writeFileSync(f.report, JSON.stringify(prev, null, 2))
    run([M(), f.draft, f.ev, '--report', f.report])
    const j = readReport(f.report)
    assert.equal(j.gate_rev_absent, true, '旧报告缺 rev → 须显式标 absent（不得静默）')
    assert.match(String(j.gate_rev_note), /无法判断/, 'note 必须说明「无法判断是否可比」，而不是断言陈旧')
    assert.notEqual(j.verdict_stale, true,
      '**缺 rev 不得翻 stale**——无法证明不可比时不说它不可比（与 M-Exist-2 的 N/A 口径同族）')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('gate-rev I3：门版本漂移（正文未变，无裁定）→ gate_rev_drift=true 且原因可归因到 rev 对', () => {
  const f = mkClean()
  try {
    run([M(), f.draft, f.ev, '--report', f.report])
    const prev = readReport(f.report)
    const real = prev.gate_rev
    writeFileSync(f.report, JSON.stringify({ ...prev, gate_rev: 'deadbeef0000' }, null, 2))
    run([M(), f.draft, f.ev, '--report', f.report])
    const j = readReport(f.report)
    assert.equal(j.gate_rev_drift, true, '门版本变了 → 必须显式标漂移（**与是否存在裁定无关**——首版曾把它误置于裁定分支内）')
    assert.match(String(j.gate_rev_drift_reason), /门版本已变更/, '原因须点明是门版本漂移')
    assert.ok(String(j.gate_rev_drift_reason).includes('deadbeef0000') && String(j.gate_rev_drift_reason).includes(real),
      '原因须给出**两个 rev**（否则读者仍无法归因）：' + j.gate_rev_drift_reason)
    assert.notEqual(j.verdict_stale, true,
      '**无裁定可陈旧**时不得翻 verdict_stale——该旗标的语义是「保留的裁定不再适用」，没有裁定就没有它')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('gate-rev I4：rev 一致 → 不标漂移、不标陈旧（不得误伤同版本复跑）', () => {
  const f = mkClean()
  try {
    run([M(), f.draft, f.ev, '--report', f.report])
    const prev = readReport(f.report)
    writeFileSync(f.report, JSON.stringify({ ...prev, verdict_stale: false }, null, 2))
    run([M(), f.draft, f.ev, '--report', f.report])
    const j = readReport(f.report)
    assert.notEqual(j.gate_rev_drift, true, '同版本不得标漂移：' + JSON.stringify(j.gate_rev_drift_reason))
    assert.notEqual(j.verdict_stale, true, '同版本复跑不得标陈旧：' + JSON.stringify(j.verdict_stale_reason))
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('gate-rev I5：裁定后 rev 一致 → 裁定被保留（exit=裁定值）；rev 漂移 → 裁定不再沿用', () => {
  const f = mkClean()
  try {
    const r0 = run([M(), f.draft, f.ev, '--report', f.report])
    const mech = readReport(f.report).exit
    assert.notEqual(mech, 0, '夹具机械值须非 0 才能验证裁定通道')
    const adjPath = join(f.d, 't8.json')
    writeFileSync(adjPath, JSON.stringify({ true_p0: 0, true_p1: 0, verdict: 'Pass（T8 裁定）', llm_review: FOUR }, null, 2))
    const r1 = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adjPath])
    assert.equal(r1.code, 0, '裁定成功应 exit 0：' + r1.out + r1.err)
    const j1 = readReport(f.report)
    assert.equal(j1.exit, 0, '报告 exit = 裁定值')
    assert.equal(j1.verdict_stale, false, '同版本裁定应有效')

    // 同 rev 复跑 → 裁定保留
    const r2 = run([M(), f.draft, f.ev, '--report', f.report])
    const j2 = readReport(f.report)
    assert.equal(j2.exit, 0, '同 rev 复跑必须保留裁定（否则 T8 的裁定会被日常复跑冲掉）：' + r2.out)
    assert.equal(j2.verdict_stale, false)

    // 模拟「门升级」：把 prev 的 rev 改掉 → 裁定必须不再沿用（落盘用机械值 + 标陈旧）
    writeFileSync(f.report, JSON.stringify({ ...j2, gate_rev: '0badc0de0000' }, null, 2))
    run([M(), f.draft, f.ev, '--report', f.report])
    const j3 = readReport(f.report)
    assert.equal(j3.verdict_stale, true, '门版本漂移后旧裁定不得继续放行')
    assert.equal(typeof j3.exit, 'number', 'exit 仍须是数字（落盘用机械值）')
    assert.ok(j3._t8_conclusion, '旧裁定原文须保留供追溯（不销毁证据）')
    void r0
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})
