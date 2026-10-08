// 修订轮次额度回归（v18.81.0 · 独立审计批 2 · 2.1）
//
// **为什么需要**：审计实测「审计打回 ≤2 轮」**零机械强制**——
//   `apply-revision-cycle.mjs` 对目标版本号只要求「≥2 的整数」（v9/v99 都放行）；
//   `轮次类别` 字段无消费者；`handoff-check` 对「轮次计数」**只判非空**（写「已用 5/2 轮」也放行）。
//   全库也没有一处「本约束为人工门、机械不判」的边界声明。
//
// ⚠️ **本组用例同时钉住一条设计判据**：额度**不得**按「草稿版本号 N」判——
//   实测 `县中塌陷` 的 v1..v5 里只有 **1** 个 A 轨轮（其余是首稿 / Phase 3.5 / Phase 3.6 / B 轨），
//   版本号与轮次**量纲不同**（这正是审计点名的仪器缺陷）。故额度按**独立账本**判。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const ARC = () => join(SCRIPTS, 'apply-revision-cycle.mjs')
const H = () => join(SCRIPTS, 'handoff-check.mjs')

const DRAFT = '# 标题\n\n## 摘要\n\n摘要正文。\n\n## 一、导论\n\n' + '正文段落。'.repeat(30) + '\n'

/** 项目夹具：drafts/初稿-v1.md（+ 可选账本） */
const mkProj = ({ ledgerRows = null, draftTo = 1 } = {}) => {
  const d = tmp('lunheng-round-')
  mkdirSync(join(d, 'drafts'), { recursive: true })
  for (let i = 1; i <= draftTo; i++) writeFileSync(join(d, 'drafts', `初稿-v${i}.md`), DRAFT)
  if (ledgerRows) {
    writeFileSync(join(d, 'drafts', '轮次账本.md'),
      '# 轮次账本\n\n| 轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间 |\n|---|---|---|---|---|---|\n'
      + ledgerRows.map((r) => `| ${r} |`).join('\n') + '\n')
  }
  return d
}
const GATES = ['Phase0', 'Phase2.5', 'Phase3.5', 'Phase5']
/** 四门夹具：§6 五字段齐 + 轮次计数按参数给 */
const mkGates = (d, roundText = '否 / A 轨 0/2') => {
  for (const g of GATES) {
    writeFileSync(join(d, `阶段确认-${g}.md`),
      `# 确认单\n\n### 6. 主人回复（必填）\n\n- **主人原话**：同意\n- **回复时间**：2026-10-01 10:00\n`
      + `- **提问方式**：ask_user_question\n- **主控落盘结论**：进入下一阶段\n- **轮次计数**：${roundText}\n`)
  }
}
const runArc = (d, extra = []) => run([ARC(), d, '2', '--skip-bundle', ...extra])

// ── apply-revision-cycle：开轮入口的闸门 ──────────────────────────────────────
test('L1：**无账本**（存量形态）→ 不阻塞，但输出必须如实标注 no-ledger', () => {
  const d = mkProj()
  try {
    const r = runArc(d)
    assert.notEqual(r.code, 10, '存量项目不得因缺账本被拒：' + r.out)
    const j = parseJson(r)
    assert.match(String(j.ledger), /no-ledger/, '必须如实标注本脚本未落账：' + JSON.stringify(j.ledger))
    assert.deepEqual(j.roundCaps, { A: 2, B: 1, G: 2 }, '额度真源须随报告输出（可复算）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('L2：**有账本但不声明轨别** → exit 10，且把当前记账摆出来（否则无从判额度）', () => {
  const d = mkProj({ ledgerRows: ['A | 1/2 | drafts/初稿-v1.md | x | y | 2026-10-07'] })
  try {
    const r = runArc(d)
    assert.equal(r.code, 10, '有账本时 --track 必填：' + r.out)
    assert.match(r.out, /必须显式声明本轮轨别/, '须给出动作')
    assert.match(r.out, /A 1\/2/, '须摆出当前记账：' + r.out.slice(0, 300))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('L3【核心】：A 轨已用满 2/2 → **拒绝再开一轮**（exit 10），并指明该走 Acknowledged Limitations', () => {
  const d = mkProj({ ledgerRows: ['A | 1/2 | drafts/初稿-v1.md | x | y | 2026-10-07', 'A | 2/2 | drafts/初稿-v2.md | x | y | 2026-10-07'] })
  try {
    const r = runArc(d, ['--track', 'A'])
    assert.equal(r.code, 10, '额度用满必须阻塞：' + r.out)
    assert.match(r.out, /额度已用满/, '须点明额度：' + r.out.slice(0, 300))
    assert.match(r.out, /Acknowledged Limitations/, '须指明升级路径（否则操作者只知道被拒、不知道怎么办）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('L4：A 轨用 1/2 → 放行，且**脚本自己落账**（新行 2/2），不靠手填', () => {
  const d = mkProj({ ledgerRows: ['A | 1/2 | drafts/初稿-v1.md | x | y | 2026-10-07'] })
  try {
    const r = runArc(d, ['--track', 'A'])
    assert.equal(r.code, 0, '未越额应放行：' + r.out)
    const j = parseJson(r)
    assert.match(String(j.ledger), /已追加一行/, '须报告已落账：' + JSON.stringify(j.ledger))
    const led = readFileSync(join(d, 'drafts', '轮次账本.md'), 'utf8')
    assert.ok(/\|\s*A\s*\|\s*2\/2\s*\|/.test(led), '账本应新增 A 2/2 行：\n' + led)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('L4b：账本**损坏**（轮次不是 n/m 形态）→ exit 10（额度不可判时不得当通过）', () => {
  const d = mkProj({ ledgerRows: ['A | 已用两轮 | drafts/初稿-v1.md | x | y | 2026-10-07'] })
  try {
    const r = runArc(d, ['--track', 'A'])
    assert.equal(r.code, 10, '损坏账本必须阻塞：' + r.out)
    assert.match(r.out, /不可解析|不是/, r.out.slice(0, 300))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── handoff-check：检测侧 ────────────────────────────────────────────────────
test('L5【核心】：§6 轮次计数写 **A 3/2**（越额）→ 硬 21（此前只判非空，写 5/2 也放行）', () => {
  const d = mkProj()
  try {
    mkGates(d, 'A 轨 3/2')
    const j = parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', '--summary']))
    assert.equal(j.exit, 21, '越额必须判硬：' + JSON.stringify(j.hard))
    assert.ok(j.hard.some((x) => /越额/.test(x.detail)), '须点名「越额」：' + JSON.stringify(j.hard))
    assert.ok(j.hard.some((x) => /Acknowledged Limitations/.test(x.detail)), '须给出升级路径')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('L6：§6 把额度分母写错（A 轨 1/5）→ 硬 21（分母是额度真源，不许自定）', () => {
  const d = mkProj()
  try {
    mkGates(d, 'A 轨 1/5')
    const j = parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', '--summary']))
    assert.equal(j.exit, 21)
    assert.ok(j.hard.some((x) => /分母写成 5/.test(x.detail)), JSON.stringify(j.hard))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('L7：账本存在但**损坏** → 硬 21（额度不可判 ≠ 通过）', () => {
  const d = mkProj({ ledgerRows: ['X | 1/2 | drafts/初稿-v1.md | x | y | 2026-10-07'] })
  try {
    mkGates(d, 'A 轨 1/2')
    const j = parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', '--summary']))
    assert.equal(j.exit, 21, '未知轨名须判硬：' + JSON.stringify(j.hard))
    assert.ok(j.hard.some((x) => /不可解析/.test(x.detail)))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('L8：账本累计与 Phase 5 的 §6 声明**不一致** → 硬 21（两处必须同源）', () => {
  const d = mkProj({ ledgerRows: ['A | 1/2 | drafts/初稿-v1.md | x | y | 2026-10-07'] })
  try {
    mkGates(d, 'A 轨 0/2')   // §6 说 A 用 0，账本记 1 → 不一致
    const j = parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', '--summary']))
    assert.equal(j.exit, 21, '不一致须判硬：' + JSON.stringify(j.hard))
    assert.ok(j.hard.some((x) => /不一致/.test(x.detail)), JSON.stringify(j.hard))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('L9：**无账本** → 只按 §6 数字判越额，并在 notes 里说明「无累计账本可比」（不得静默）', () => {
  const d = mkProj()
  try {
    mkGates(d, 'A 轨 1/2')
    const j = parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', '--summary']))
    assert.notEqual(j.exit, 21, '未越额不得判硬：' + JSON.stringify(j.hard))
    assert.match((j.notes || []).join('\n'), /未发现/, '须说明无账本：' + JSON.stringify(j.notes))
    assert.ok(existsSync(join(d, 'drafts')) || true)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 批 2.2：A9 轮次复核绑定（每一轮内容修订都要有指纹相符的复核报告）──────────────
const REVIEW = (fp) => `# 复核报告\n\n## 已读范围\n\n- **被审正文**：drafts/初稿-v1.md 的 §1、§2\n- **被审正文 sha256**：\`${fp}\`\n\n## 逐条判定\n\n| 原编号 | 判定 | 依据 | 说明 |\n|---|---|---|---|\n| P0-1 | ✓已关闭 | 修订说明第 1 条 | ok |\n`
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

const mkReviewProj = ({ track = 'A', round = '1/2', reviewCell, fp = null, withLedger = true }) => {
  const d = mkProj()
  writeFileSync(join(d, 'drafts', '初稿-v1.md'), DRAFT)
  const real = sha(join(d, 'drafts', '初稿-v1.md'))
  const cell = reviewCell === undefined ? 'audits/复核报告-v1.md' : reviewCell
  if (cell) {
    mkdirSync(join(d, 'audits'), { recursive: true })
    writeFileSync(join(d, 'audits', '复核报告-v1.md'), REVIEW(fp === null ? real : fp))
  }
  if (withLedger) {
    writeFileSync(join(d, 'drafts', '轮次账本.md'),
      '# 轮次账本\n\n| 轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间 |\n|---|---|---|---|---|---|\n'
      + `| ${track} | ${round} | drafts/初稿-v1.md | audits/审计报告-v1.md | ${cell || ''} | 2026-10-07 |\n`)
  }
  const saved = { real }
  return { d, saved }
}
const a9 = (j) => j.hard.filter((x) => x.check === 'A9')
const runGate = (d) => parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', '--summary']))

test('M1：账本 A 轨行 + 复核报告在盘且**指纹相符** → 不报 A9', () => {
  const { d } = mkReviewProj({})
  try {
    const j = runGate(d)
    assert.equal(a9(j).length, 0, '指纹相符不得报 A9：' + JSON.stringify(a9(j)))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('M2【复刻审计 P0-2】：**B 轨轮次无复核产物** → 硬 21（编号配对永远看不见这一种）', () => {
  const { d } = mkReviewProj({ track: 'B', round: '1/1', reviewCell: '' })
  try {
    const j = runGate(d)
    assert.equal(a9(j).length, 1, 'B 轨无复核必须判硬：' + JSON.stringify(j.hard))
    assert.match(a9(j)[0].detail, /无复核产物/, '须点明缺的是复核凭证')
    assert.match(a9(j)[0].detail, /没有审计报告可配对/, '须说明为何编号配对抓不到它（否则读者会问"为什么 A4b 没报"）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('M3：复核报告在盘但**缺「被审正文 sha256」** → 硬 21（无法证明复核的是这一版）', () => {
  const { d } = mkReviewProj({ reviewCell: 'audits/复核报告-v1.md' })
  try {
    // 覆盖成一份没有指纹字段的报告
    writeFileSync(join(d, 'audits', '复核报告-v1.md'), '# 复核报告\n\n## 已读范围\n\n- **被审正文**：drafts/初稿-v1.md\n')
    const j = runGate(d)
    assert.equal(a9(j).length, 1, '缺指纹须判硬：' + JSON.stringify(j.hard))
    assert.match(a9(j)[0].detail, /缺「\*\*被审正文 sha256\*\*」/, a9(j)[0].detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('M4：复核报告声明的指纹与账本正文**不符**（复核的是另一版）→ 硬 21', () => {
  const { d } = mkReviewProj({ fp: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' })
  try {
    const j = runGate(d)
    assert.equal(a9(j).length, 1, '指纹不符须判硬：' + JSON.stringify(j.hard))
    assert.match(a9(j)[0].detail, /不符/, a9(j)[0].detail)
    assert.match(a9(j)[0].detail, /另一版/, '须指明它审的是别的版本')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('M5：**无账本** → 不判 A9（存量项目不追溯适用），但须在 notes 里说明', () => {
  const { d } = mkReviewProj({ withLedger: false })
  try {
    const j = runGate(d)
    assert.equal(a9(j).length, 0, '无账本不得判 A9：' + JSON.stringify(j.hard))
    assert.match((j.notes || []).join('\n'), /未发现/, JSON.stringify(j.notes))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('M6：账本记了复核路径但**文件不在盘** → 硬 21', () => {
  const { d } = mkReviewProj({ reviewCell: 'audits/复核报告-v9.md' })
  try {
    const j = runGate(d)
    assert.equal(a9(j).length, 1, '路径不实须判硬：' + JSON.stringify(j.hard))
    assert.match(a9(j)[0].detail, /不在盘/, a9(j)[0].detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
