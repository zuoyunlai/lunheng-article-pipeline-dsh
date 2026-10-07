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

// ── 负向 3：非梯队 / 非版本式记录不得作为「后续已处理」的证据 ────────────────────────────────
// 这条锁住坑②：首版把「无第N梯队序数」的专项/方案稿记录排到最后，于是任何 ID 只要在
//   任意一份非梯队记录里出现过就被当成「已处理」→ 门同样失效。
//   ⚠️ v18.80.0 口径更正（全量审计-v18.79.1 §七·补④）：本仓自 v18.6x 起把收口批记录改为
//   `机制文件修订记录-<日期>-<批次名>-v<版本>.md`（**无「第N梯队」**，实测真仓 12 份记录里 3 份是这种）。
//   这类**版本式记录**必须进「被提及」面（否则 `handledByRecords` 恒 0、差集形同虚设）。
//   本用例的夹具因此改为**明确非法定名**（`…-方案稿-收口.md`：既无「第N梯队」，也不以 `v<数字>.<数字>` 结尾），
//   以保住它真正要守的那件事——**「提到名字」不等于「回标」**。
test('收口核验·判定收紧：非梯队记录（方案稿）不得作为「后续处理」证据', () => {
  const { d, dir, audit } = mk(
    '| L-07 | P1 | 甲 |\n',
    [
      ['2026-01-01-第一梯队', '**仍未做（如实）**：\n\n- L-07 下一批\n'],
      // 非法定名记录（既非「第N梯队」也非 `<日期>-…-v<版本>`）提到了 L-07 —— 不得据此判「已回标」
      ['2026-01-02-方案稿-收口', '## 一\n\n本次顺便提到 L-07 这个名字而已。\n'],
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

// ══════════════════════════════════════════════════════════════════════════════════════════
// v18.80.0（全量审计-v18.79.1 §七·补）：**本门自己就是一处「规则失效即静默放行」**
//
// 病灶（本批收口时实测发现）：
//   ① 默认目标写死 `audits/全量审计报告-v18.11.0.md`（151 个 L-NN），而**最近两轮**全量审计报告
//      （v18.78.0 / v18.78.1）的 L-NN 是 **0 处** → 默认跑法检的是一份过期旧报告，还报 ✓ (exit 0)；
//   ② ID 提取器只认 `L-NN` → v18.7x 起改用 `P1-1` 形态的报告**整个失明**；
//   ③ 提取不到 ID 时旧行为是**照旧输出「两步均无发现」**（只有「一份都没有」才 exit 10，
//      而只要目录里放着那份旧报告就永远提得到）。
//   ④ 记录面 `tierRank` 只认文件名含「第N梯队」→ 本仓自 v18.6x 起改口径为
//      `机制文件修订记录-<日期>-<批次名>.md`（无梯队标记）→ 这类记录被**整份排除**，
//      实测修复前 `handledByRecords` 恒为 0、全部 ID 落 `changelogOnly`（差集形同虚设）。
//
// 下面四条锁住这四处。**它们都是「门在此却不生效」的形态**——本门存在的唯一理由就是反驳
// 「修订已全部完成」这类断言，故它自身失效必须被锁死。
// ══════════════════════════════════════════════════════════════════════════════════════════

/** 造一个带 audits/ 的临时仓；`audits` 项 = [文件名, 内容] */
const mkRepo2 = (audits) => {
  const d = tmp('lh-closeout2-')
  const dir = join(d, 'audits')
  mkdirSync(dir, { recursive: true })
  for (const [name, body] of audits) writeFileSync(join(dir, name), body)
  return { d, dir }
}

test('收口核验·默认目标取**最新**全量审计报告（不得写死过期那份；v18.80.0 §七·补①）', () => {
  const { d, dir } = mkRepo2([
    // 旧报告：只有它才有 L-99 这条 ID。若默认取到它 → 输出会点名 L-99 并判红。
    ['全量审计报告-v18.11.0.md', '| L-99 | P1 | 只有旧报告才有这条 |\n'],
    // 新报告：P 形态 ID，已被记录提及
    ['全量审计报告-v18.80.0-2026-10-07.md', '| **P1-1** | 新报告 |\n'],
    ['机制文件修订记录-2026-10-07-收口批-v18.80.0.md', '本批已处理 P1-1。\n'],
  ])
  try {
    // ⚠️ 判据刻意**不**去 match 输出里的文件名（默认模式不打印文件名，那是本脚本的既有输出契约）。
    //   改用更本质的两条：① 检到的 ID 集属于**新**报告；② 旧报告独有的 ID 不得出现。
    const r = run([CV, '--records', dir, '--repo', d, '--json'])
    assert.equal(r.code, 0, `期望 exit 0（新报告 1 个 ID 已被提及），实得 ${r.code}\n${r.stdout}${r.stderr}`)
    const rep = JSON.parse(r.stdout)
    assert.match(rep.auditFile, /v18\.80\.0/, `默认目标必须是版本最新的那份报告，实得 ${rep.auditFile}`)
    assert.equal(rep.auditIdCount, 1, `应只检到新报告的 1 个 ID，实得 ${rep.auditIdCount}`)
    assert.deepEqual(rep.step1_neverMentioned, [], `新报告里的 P1-1 已被记录提及，不该有差集；实得 ${JSON.stringify(rep.step1_neverMentioned)}`)
    assert.doesNotMatch(JSON.stringify(rep), /L-99/, '不得再去检 v18.11.0 那份旧报告（默认目标写死正是本批修的病灶）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('收口核验·ID 形态：`P<n>-<n>` 必须被识别（v18.80.0 §七·补②）', () => {
  const { d, dir } = mkRepo2([
    ['全量审计报告-v18.90.0-2026-11-01.md', '| **P1-1** | 甲 |\n| **P3-7** | 乙 |\n'],
    ['机制文件修订记录-2026-11-01-收口批-v18.90.0.md', '本批处理 P1-1。\n'],   // P3-7 无人提
  ])
  try {
    const r = run([CV, '--records', dir, '--repo', d])
    assert.equal(r.code, 1, `P3-7 从未被提及应 exit 1，实得 ${r.code}\n${r.stdout}${r.stderr}`)
    assert.match(r.stderr, /P3-7/, '必须按 P 形态点名漏掉的 ID')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('收口核验·提不到任何 ID 必须**响亮失败**，不得报「两步均无发现」（v18.80.0 §七·补③）', () => {
  const { d, dir } = mkRepo2([
    ['全量审计报告-v19.0.0-2027-01-01.md', '这份报告没有编号化 ID，只有散文描述。\n'],
    ['机制文件修订记录-2027-01-01-收口批-v19.0.0.md', '本批做了些事。\n'],
  ])
  try {
    const r = run([CV, '--records', dir, '--repo', d])
    assert.equal(r.code, 10, `提不到 ID 应 exit 10（拒绝判定），实得 ${r.code}\n${r.stdout}${r.stderr}`)
    assert.doesNotMatch(r.stdout, /两步均无发现/, '绝不能在这种情况下输出「无发现」')
    assert.match(r.stderr, /没找到任何可识别的 ID/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('收口核验·版本式修订记录必须进记录面（v18.80.0 §七·补④）', () => {
  // 该记录**不含「第N梯队」**（本仓 v18.6x 起的真实命名口径）。旧实现把它整份排除 →
  //   `handledByRecords` 恒 0、ID 全落 `changelogOnly`（差集形同虚设）。
  const { d, dir } = mkRepo2([
    ['全量审计报告-v18.90.0-2026-11-01.md', '| **P1-1** | 甲 |\n'],
    ['机制文件修订记录-2026-11-01-全量审计-v18.90.0修订批.md', '本批处理 P1-1。\n'],
  ])
  try {
    const r = run([CV, '--records', dir, '--repo', d, '--json'])
    assert.equal(r.code, 0, `期望 exit 0，实得 ${r.code}\n${r.stdout}${r.stderr}`)
    const rep = JSON.parse(r.stdout)
    assert.equal(rep.recordFiles, 1, '版本式记录必须被当作修订记录收入（否则记录面为空）')
    assert.equal(rep.step1_split.handledByRecords, 1,
      `版本式记录必须算「被修订记录处理」；实得 handledByRecords=${rep.step1_split.handledByRecords}` +
      `、changelogOnly=${JSON.stringify(rep.step1_split.changelogOnlyIds)}——后者的形态就是本批修复前的病灶`)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
