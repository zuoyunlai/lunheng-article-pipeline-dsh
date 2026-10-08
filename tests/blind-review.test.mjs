// 盲评件契约回归（v18.81.0 · 独立审计批 1.4）
//
// **为什么需要**：审计 P0-4 实测「唯一存在的质量量尺分辨不出读者能看见的差距」（T9 给更弱的
//   一篇 22/30、更紧的一篇 19/30，QLT-6 双 21.4）。盲评是它的落点，而盲评的**全部效力**建立在
//   「读的是什么」可核对之上 —— 故契约必须机械化，否则「盲评」会退化成又一次自述。
//
// 两层（对应 09 卡 §🕶 的两条边界）：
//   · **契约层**（自述面）：六维名逐字 / 每维 x/5 / 总评分 = 六维之和 / 首节「已读范围」非空 / 禁忌面自述。
//   · **独立层**（宿主日志面）：给了 `--session-log` 时，核对会话**真的碰过**哪些路径——
//     这一层主控改不了，正是把批 1.1 的「账本由主控写」边界实质收掉的那一层。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const H = () => join(SCRIPTS, 'handoff-check.mjs')

const ART = ({ dims = ['4', '3', '3', '4', '3', '4'], total = null, readBody = '- audits/盲评稿-01.md（全文）', extraHead = '' } = {}) => {
  const names = ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范']
  const sum = dims.reduce((a, b) => a + Number(b), 0)
  return [
    '# 盲评 01', '',
    '> 本稿为匿名送审稿，未接触任何生产中间产物。', ...(extraHead ? [extraHead] : []), '',
    '## 已读范围', readBody, '',
    '## 评审维度',
    ...names.map((n, i) => `#### ${i + 1}. ${n}（${dims[i]}/5）`),
    '## 总评', `- **总评分**：${total ?? sum}/30`, '',
  ].join('\n')
}

/** 造一个「读过某路径」的会话夹具（形态逐字对齐实测 v4 会话日志的 tool/call） */
const SESSION = (paths) => paths.map((p, i) => JSON.stringify({
  type: 'tool/call', seq: i + 1, time: 1791000000000 + i,
  data: { turn: 1, step: 1, callId: `call_${i}`, name: 'read', arguments: JSON.stringify({ file_path: p }) },
})).join('\n')

const mk = ({ art = ART(), session = null } = {}) => {
  const d = tmp('lunheng-blind-')
  mkdirSync(join(d, 'audits'), { recursive: true })
  writeFileSync(join(d, 'audits', '盲评-01-v4.md'), art)
  if (session) writeFileSync(join(d, 'sess.jsonl'), session + '\n')
  return d
}
const runB = (file, extra = []) => run([H(), '--blind-review', file, ...extra])
const art = (d) => join(d, 'audits', '盲评-01-v4.md')

test('B1：合格盲评件 → exit 0（六维齐、总分=和、已读范围非空、有匿名声明）', () => {
  const d = mk()
  try {
    const r = runB(art(d))
    assert.equal(r.code, 0, '合格件应放行：' + r.out)
    const j = parseJson(r)
    assert.equal(j.mode, 'blind-review')
    assert.equal(j.hardCount, 0)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B2：缺某一维（六维名是机检契约）→ 硬 21，且点名缺哪个维度', () => {
  const d = mk({ art: ART({ dims: ['4', '3', '3', '4', '3', '4'] }).replace('#### 5. 写作质量（3/5）\n', '') })
  try {
    const r = runB(art(d))
    assert.equal(r.code, 21, '缺维度必须判硬：' + r.out)
    assert.ok(parseJson(r).hard.some((x) => /写作质量/.test(x.detail)), '须点名缺的维度')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B3：总评分 ≠ 六维之和 → 硬 21，且给出算式（防「分数随手写」）', () => {
  const d = mk({ art: ART({ total: 28 }) })
  try {
    const r = runB(art(d))
    assert.equal(r.code, 21)
    const hit = parseJson(r).hard.find((x) => x.check === 'BR-A3')
    assert.match(hit.detail, /4\+3\+3\+4\+3\+4 = 21/, '须把算式写出来：' + hit.detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B4：缺首节「已读范围」→ 硬 21（空节会被读成「已核对过」）', () => {
  const d = mk({ art: ART().replace(/## 已读范围\n- audits[^\n]*\n/, '') })
  try {
    const r = runB(art(d))
    assert.equal(r.code, 21)
    assert.ok(parseJson(r).hard.some((x) => x.check === 'BR-A4'), parseJson(r).hard.map((x) => x.check).join(','))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B5：已读范围含**禁忌面**（自述层）→ 硬 21', () => {
  const d = mk({ art: ART({ readBody: '- analysis/分析大纲.md\n- data/数据卡.md' }) })
  try {
    const r = runB(art(d))
    assert.equal(r.code, 21)
    const hit = parseJson(r).hard.find((x) => x.check === 'BR-A5')
    assert.match(hit.detail, /分析大纲/, '须列出命中的禁忌项：' + hit.detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B6【独立层】：**会话日志显示真的读过禁忌面** → 硬 21（宿主记录，主控改不了）', () => {
  const d = mk({ session: SESSION(['run/p/analysis/分析大纲.md', 'run/p/final/定稿.md']) })
  try {
    const r = runB(art(d), ['--session-log', join(d, 'sess.jsonl')])
    assert.equal(r.code, 21, '越界读必须判硬：' + r.out)
    const hit = parseJson(r).hard.find((x) => x.check === 'BR-B1')
    assert.ok(hit, '须报 BR-B1：' + JSON.stringify(parseJson(r).hard))
    assert.match(hit.detail, /分析大纲/, '须把命中路径摆出来')
    assert.match(hit.detail, /宿主记录/, '须说明这一层不可由改产物消除')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B7【独立层】：会话未碰禁忌面 → 不报；且 notes 报告核对结论（不得静默通过）', () => {
  const d = mk({ session: SESSION(['run/p/final/定稿.md', 'run/p/final/图件/图1.svg']) })
  try {
    const r = runB(art(d), ['--session-log', join(d, 'sess.jsonl')])
    assert.equal(r.code, 0, '未越界应放行：' + r.out)
    const j = parseJson(r)
    assert.ok(!j.hard.some((x) => x.check === 'BR-B1'))
    assert.match((j.notes || []).join('\n'), /盲评独立核对/, '必须报告核对已执行：' + JSON.stringify(j.notes))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B8：盲评件不存在 → exit 20（产物缺失，与交接门同码）', () => {
  const d = mk()
  try {
    const r = runB(join(d, 'audits', '不存在.md'))
    assert.equal(r.code, 20, '产物缺失须用 20：' + r.out)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 盲评一致性统计（批 2 收尾；**度量不是闸门**）────────────────────────────────
// 为什么需要：审计实测「唯一存在的质量量尺分辨不出读者能看见的差距」（T9 给更弱的一篇 22/30、
//   更紧的一篇 19/30，QLT-6 双 21.4）。让这类问题可见的第一步 = 把**来源盲的盲评**与**非盲 T9**
//   的打分并排落盘。**它不改 score、不参与 exit**；分歧本身不是缺陷（挂闸门会催生"为过线而调分"）。
const QA = () => join(SCRIPTS, 'quality-score.mjs')
const mkQ = ({ t9 = null, blinds = [] } = {}) => {
  const d = tmp('lunheng-agree-')
  mkdirSync(join(d, 'final'), { recursive: true })
  mkdirSync(join(d, 'audits'), { recursive: true })
  writeFileSync(join(d, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  if (t9 !== null) writeFileSync(join(d, 'audits', '审稿报告-v4.md'), `# 审稿报告\n\n- **总评分**：${t9}/30\n`)
  blinds.forEach((b, i) => writeFileSync(join(d, 'audits', `盲评-0${i + 1}-v4.md`), `# 盲评\n\n- **总评分**：${b}/30\n`))
  return d
}
const ra = (d) => {
  const r = run([QA(), d])
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
  return { j, code: r.code }
}

test('Q1：无盲评件 → **不给数字**，如实写「样本不足」（不得用 0 或不给字段冒充）', () => {
  const d = mkQ({ t9: 19 })
  try {
    const { j } = ra(d)
    assert.ok(j.reviewAgreement, '必须有该独立块')
    assert.equal(j.reviewAgreement.spread, null, '无盲评时差值须为 null')
    assert.equal(j.reviewAgreement.bandAgreement, null, '无盲评时一致率须为 null（不得给 0）')
    assert.match(String(j.reviewAgreement.note), /样本不足/, j.reviewAgreement.note)
    assert.match(String(j.reviewAgreement.notScope), /不参与 exit/, '须自陈它不是闸门')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('Q2：n=1 → 只报差值，**不给一致率**（n=1 的一致率恒为 100%，是噪声不是结论）', () => {
  const d = mkQ({ t9: 19, blinds: [22] })
  try {
    const { j } = ra(d)
    assert.equal(j.reviewAgreement.spread, null, 'n=1 不得给极差')
    assert.equal(j.reviewAgreement.bandAgreement, null, 'n=1 不得给一致率')
    assert.match(String(j.reviewAgreement.note), /n=1/, j.reviewAgreement.note)
    assert.match(String(j.reviewAgreement.note), /Δ=3/, '须报差值：' + j.reviewAgreement.note)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('Q3：n=2 → 给出极差与档位一致率；且**分数与退出码不受其影响**', () => {
  const d = mkQ({ t9: 19, blinds: [22, 20] })
  try {
    const { j, code } = ra(d)
    assert.equal(j.reviewAgreement.spread, 2, '极差应为 2：' + JSON.stringify(j.reviewAgreement))
    // T9 19 → major(16-20)；盲评 22 → minor、20 → major ⇒ 1/2 一致
    assert.equal(j.reviewAgreement.bandAgreement, 0.5, '档位一致率应为 1/2：' + JSON.stringify(j.reviewAgreement))
    assert.equal(j.reviewAgreement.t9.band, 'major')
    assert.equal(code, 0, '该块**不得**影响退出码（度量不是闸门）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
