// 收口批固定动作（差集 + 反向核验）的回归：`scripts/closeout-verify.mjs`
//
// 为什么需要这个文件：本门是**唯一**能机械反驳「修订已全部完成」这类断言的手段——
//   18.12.2 的假陈述由「差集」抓到，18.12.3 的假安心（差集为空 = 完成）由「反向核验」抓到。
//   而写它的过程里我**自己踩了两个「门在此却不生效」的坑**（都被真数据反证后修掉），
//   故必须有负向用例锁住这两个形态，否则它会静默退化成永远报 ✓ 的空转门。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { run, tmp, ROOT } from './_fixtures.mjs'

// 仓库级脚本（与 skills/.../scripts 不同层——本门刻意不随包）
const CV = join(ROOT, 'scripts', 'closeout-verify.mjs')

/** 造一个最小「审计报告 + 若干梯队记录」的仓 */
const mk = (auditBody, tiers) => {
  const d = tmp('lh-closeout-')
  const dir = join(d, 'audits')
  mkdirSync(dir, { recursive: true })
  const audit = join(dir, 'audit.md')
  writeFileSync(audit, auditBody)
  for (const [name, body] of tiers) writeFileSync(join(dir, `机制文件修订记录-${name}.md`), body)
  return { d, dir, audit }
}
const runCv = (a, dir, repo) => run([CV, '--audit', a, '--records', dir, '--repo', repo])

// ── 正向：两步都干净时 exit 0 ────────────────────────────────────────────────────────────
test('收口核验·正向：差集为空 + 无陈旧未做登记 → exit 0', () => {
  const { d, dir, audit } = mk(
    '| L-01 | P1 | 甲 |\n| L-02 | P1 | 乙 |\n',
    [
      ['2026-01-01-第一梯队', '## 一、（做了）\n\n本批已修 L-01。\n'],
      ['2026-01-02-第二梯队', '## 一、（做了）\n\n本批已修 L-02。\n'],
    ],
  )
  try {
    const r = runCv(audit, dir, d)
    assert.equal(r.code, 0, `期望 exit 0，实得 ${r.code}\n${r.stdout}${r.stderr}`)
    assert.match(r.stdout, /从未被任何记录提及 = 0/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 负向 1：差集——审计里有 ID 任何记录都没提 ─────────────────────────────────────────────
test('收口核验·第 1 步差集：审计里的 ID 从未被提及 → exit 1 且点名', () => {
  const { d, dir, audit } = mk(
    '| L-01 | P1 | 甲 |\n| L-99 | P1 | 乙 |\n',                       // L-99 无人提
    [['2026-01-01-第一梯队', '## 一\n\n已修 L-01。\n']],
  )
  try {
    const r = runCv(audit, dir, d)
    assert.equal(r.code, 1, `期望 exit 1，实得 ${r.code}`)
    assert.match(r.stderr, /L-99/, '必须点名漏掉的 ID')
    assert.match(r.stderr, /差集/, '必须标明是哪一步抓到的')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 负向 2：反向核验——「未做」登记是**加粗行**（真记录的形态），其后无人回标 ────────────────
// 这条锁住坑①：首版只认 `##` 小节标题，而真实记录里标记是 `**仍未做（如实）**：`，
//   于是整块被静默忽略、对真仓报 0 项——门看着在、其实不生效。
test('收口核验·第 2 步反向核验：加粗「**仍未做**」块内的登记若无人回标 → exit 1 且点名梯队', () => {
  const { d, dir, audit } = mk(
    '| L-07 | P1 | 甲 |\n| L-08 | P1 | 乙 |\n',
    [
      ['2026-01-01-第一梯队', '## 一、（做了）\n\n已修 L-08。\n\n**仍未做（如实）**：\n\n| L-07 | 需另开一批 |\n'],
      ['2026-01-02-第二梯队', '## 一、（做了）\n\n本批只处理别的。\n'],      // 未回标 L-07
    ],
  )
  try {
    const r = runCv(audit, dir, d)
    assert.equal(r.code, 1, `期望 exit 1，实得 ${r.code}\n${r.stdout}${r.stderr}`)
    assert.match(r.stderr, /L-07/, '必须点名陈旧登记')
    assert.match(r.stderr, /第一梯队/, '必须指明登记于哪一梯队（方便回标）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('收口核验·反向核验对照：同一项在后续梯队被回标 → exit 0（不误伤）', () => {
  const { d, dir, audit } = mk(
    '| L-07 | P1 | 甲 |\n',
    [
      ['2026-01-01-第一梯队', '**仍未做（如实）**：\n\n- L-07 下一批处理\n'],
      ['2026-01-02-第二梯队', '## 一\n\nL-07 已在本批结清（实测无此冲突）。\n'],
    ],
  )
  try {
    const r = runCv(audit, dir, d)
    assert.equal(r.code, 0, `期望 exit 0，实得 ${r.code}\n${r.stderr}`)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 负向 3：非梯队记录不得作为「后续已处理」的证据 ───────────────────────────────────────
// 这条锁住坑②：首版把「无第N梯队序数」的专项/版本段记录排到最后，于是任何 ID 只要在
//   任意一份非梯队记录里出现过就被当成「已处理」→ 门同样失效。
test('收口核验·判定收紧：只有带「第N梯队」序数的记录才构成「后续处理」证据', () => {
  const { d, dir, audit } = mk(
    '| L-07 | P1 | 甲 |\n',
    [
      ['2026-01-01-第一梯队', '**仍未做（如实）**：\n\n- L-07 下一批\n'],
      // 非梯队记录（无「第N梯队」）提到了 L-07 —— 不得据此判「已回标」
      ['2026-01-02-v18.13.0-收口', '## 一\n\n本次顺便提到 L-07 这个名字而已。\n'],
    ],
  )
  try {
    const r = runCv(audit, dir, d)
    assert.equal(r.code, 1, `非梯队记录不应消除陈旧判定；期望 exit 1，实得 ${r.code}\n${r.stderr}`)
    assert.match(r.stderr, /L-07/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 负向 4：没有任何修订记录时**拒绝**判「已收口」 ─────────────────────────────────────────
test('收口核验·无记录必须拒绝：不得在无记录的情况下报「已收口」→ exit 10', () => {
  const { d, dir, audit } = mk('| L-01 | P1 | 甲 |\n', [])
  try {
    const r = runCv(audit, dir, d)
    assert.equal(r.code, 10, `期望 exit 10（拒绝判定），实得 ${r.code}`)
    assert.match(r.stderr, /拒绝|未在/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 参数契约 ────────────────────────────────────────────────────────────────────────────
test('收口核验·参数错：未知参数 / 路径不存在 一律 exit 10', () => {
  const r1 = run([CV, '--nope'])
  assert.equal(r1.code, 10, `未知参数应 exit 10，实得 ${r1.code}`)
  const r2 = run([CV, '--audit', join(ROOT, 'no-such-audit.md')])
  assert.equal(r2.code, 10, `审计报告不存在应 exit 10，实得 ${r2.code}`)
})

// ── 真实仓自检：本门对**当前真源仓**必须通过（否则说明记录又陈旧了）────────────────────────
test('收口核验·真源仓实跑：当前仓库两步均无发现（记录不陈旧）', () => {
  const r = run([CV])
  assert.equal(r.code, 0,
    `真源仓未通过收口核验 —— 说明有 ID 没被记录、或有「未做」登记其后无人回标：\n${r.stdout}${r.stderr}`)
})
