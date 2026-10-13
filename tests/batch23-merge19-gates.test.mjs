// 批 23（v19.5.0）：`run/xingbie/audits/merge清单-合并版-19条.md` 的**门禁与账本面**落地回归。
//
// 本批落地 6 节（逐条对应清单小节号；**按标题定位，不按总表序号**）：
//   §一.1  M-Exist-4 的编号空间不相交 → 门侧归一（甲案）：字面比 → 语义对账（≥70%）→ 降软；
//   §一.3  A/B 轨复核指纹「追溯不可满足」→ 账本「复核报告」列的**显式豁免**降 soft，
//          「声明了报告但指纹不符」**仍硬 21**；
//   §一.4  T8 终检四件套无机械核 → 交付物**最小清单五件**（缺一 hard 20，`--require-gates` 下判）；
//   §二.7  `[G]` 族缺口与真实来源混编 → M-Exist-1 **区分「来源条目」与「缺口条目」**（脚本侧）；
//   §二.8  一处良构错误作废整份账本解析 → `parseLedger` **逐行降级**；
//   §三.11 「五要素」实为六要素 → 逐段核验六段（缺「状态机更新」仍硬 21）。
//
// ⚠️ 每条**都带反向用例**（防把真阳性放过）：编号不相交里「确实未覆盖」仍须报；豁免之外的
//   「指纹不符」仍硬；T8 五件缺一即 20；缺口族「正文引了却查无条目」仍报；坏行只跳过自己。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCRIPTS, run, parseJson, tmp, mkProject } from './_fixtures.mjs'

const MEXIST = pathToFileURL(join(SCRIPTS, '_lib', 'mgate-gates', 'mexist-gates.mjs')).href
const LEDGER = pathToFileURL(join(SCRIPTS, '_lib', 'round-ledger.mjs')).href
const H = () => join(SCRIPTS, 'handoff-check.mjs')

// ════════════════════════════════════════════════════════════════════════════
// §一.1 M-Exist-4：两侧编号体系不一致（R 号 vs P 号）→ 不得报硬；真未覆盖仍须报
// ════════════════════════════════════════════════════════════════════════════
const H6 = '| 编号 | 严重度 | 改哪里 | 怎么改 | 验收标准 | 关闭状态 |\n|---|---|---|---|---|---|\n'

/**
 * 造一个 M-Exist-4 直调夹具。
 * `rows`   = 任务书行（`|` 分隔的数据行，编号自定——本组的关键变量）
 * `review` = 复核报告全文
 */
const mkE4 = ({ rows, review }) => {
  const { d, proj, fin, aud, ev } = mkProject({ audits: true, drafts: true })
  const draftPath = join(fin, '定稿.md')
  writeFileSync(draftPath, '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(aud, '审计报告-v1.md'),
    `# 审计报告 v1\n\n## 结论\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${H6}${rows.join('\n')}\n`)
  // ⚠️ 复核报告必须含 `## 结论` + 结论位「通过」——否则 M-Exist-4 的 isReject 分支仍走任务书校验，
  //   但「配对候选」会取到它；其存在只为「有复核报告」。
  writeFileSync(join(aud, '复核报告-v1.md'), review)
  return { d, draftPath, aud, ev }
}
const runE4 = async (f) => {
  const { mExist4 } = await import(MEXIST)
  const results = []
  mExist4({ draftPath: f.draftPath, evDir: f.ev, auditsDirOf: () => f.aud, results })
  const r = results.at(-1)
  assert.ok(r, 'mExist4 必须推一条结果')
  // ⚠️ `detail` 里的软提示只印**前两条**（`soft.slice(0, 2)`）——本组用例要断言的软项常排在
  //   第三位（前两条是「编号不符合 P0-n 约定」），故把完整软项列表一并带回，断言走它。
  return { detail: String(r.detail), severity: r.severity, pass: r.pass, soft: r.soft ? [...r.soft] : [] }
}

// 任务书用 R 号（本项目实测形态：派发话术给成 R1…R10），复核报告用 P 号。
const R_ROWS = [
  '| R1 | 打回修订 | §3.3 首段 | 补 [D05] 的独立统计来源并说明口径 | 该段含 [D05] 且写明口径边界 | 待复核 |',
  '| R2 | 打回修订 | §4.2 末段 | 恢复「观念面与行为面方向不一致」的方向判据句 | 该段出现「方向不一致」并列出反向事实 | 待复核 |',
  '| R3 | 打回修订 | §5.2 第 2 段 | 按四项点对点回应并补「不替代结构研究」声明 | 该段 ≥500 字且四项齐全 | 待复核 |',
]
const P_REVIEW = (body) => [
  '# 复核报告 v1',
  '',
  '## 结论',
  '',
  '结论：复核通过（本轮 3 项均已处置）',
  '',
  '## 逐条判定',
  '',
  '| 原条目编号 | 判定 | 依据 |',
  '|---|---|---|',
  '| P0-1 | ✓已关闭 | 修订说明 §3.3 |',
  '',
  body,
  '',
].join('\n')

test('§一.1-①：任务书用 R 号、复核报告用 P 号（**语义已覆盖**）→ 不得报硬，且须写明「编号体系不一致，已按语义对账」', async () => {
  // 复核报告正文**逐条复述**任务书「改哪里 / 怎么改 / 验收标准」三列的关键词——这是人工读表时
  //   判定「这份报告确实覆盖了这 3 条」的同一条取材面（行级关键词覆盖率 ≥70%，见门侧注释）。
  const f = mkE4({
    rows: R_ROWS,
    review: P_REVIEW([
      '本轮逐条落实（行级关键词与任务书对应）：',
      '① §3.3 首段：已补 [D05] 的独立统计来源并说明口径，该段含 [D05] 且写明口径边界。',
      '② §4.2 末段：已恢复「方向不一致」的方向判据句并列出反向事实，该段出现方向不一致的完整表述。',
      '③ §5.2 第 2 段：已按四项点对点回应并补「不替代结构研究」声明，该段 500 字以上、字且四项齐全。',
    ].join('\n')),
  })
  try {
    const r = await runE4(f)
    // ⚠️ `pass` 在门里 = 「**无硬问题且无软提示**」（`!hard && soft.length === 0`）；任务书用 R 号本身
    //   仍进一条软提示（「编号不符合 P0-n 约定」）→ 故**语义对账成立**时 `pass=false / severity='P2'`。
    //   本用例要钉的是「**不得报硬**」——即不得出现「未覆盖 N 个审计编号」。
    assert.equal(r.severity, 'P2', '语义对账成立时应为「仅软提示」档：' + JSON.stringify(r))
    assert.doesNotMatch(r.detail, /未覆盖/, '不得报「未覆盖」：' + r.detail)
    assert.match(r.detail, /编号体系不一致/, 'detail 必须写明已按语义对账：' + r.detail)
    assert.match(r.detail, /语义对账/, 'detail 必须点名对账方式：' + r.detail)
    assert.match(r.detail, /闭环成立/, 'detail 须写明闭环成立：' + r.detail)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('§一.1-②【反向】复核报告确实**未覆盖任一缺陷** → 仍须报（防把真阳性放过）', async () => {
  // 复核报告用另一体系且内容与任务书**毫无关键词交集**（模拟「这份报告验证的是别的对象」）。
  const f = mkE4({
    rows: R_ROWS,
    review: P_REVIEW('本轮验证对象 = `analysis/批判报告-v2.md` §3.4 的关闭条件，与审计任务书无关；未逐条对位。'),
  })
  try {
    const r = await runE4(f)
    assert.equal(r.pass, false, '真缺口必须仍判失败：' + r.detail)
    assert.match(r.detail, /未覆盖 3 个审计编号/, '真缺口不得被语义对账放宽带走：' + r.detail)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('§一.1-③：两侧编号体系**部分相交** → 不得启用语义对账，缺号照报（降级只针对「前缀完全不相交」）', async () => {
  // 反例：不能因为「有一个号对上了」就把没对上的号静默放过。
  const f = mkE4({
    rows: [
      '| P0-1 | 打回修订 | §3.3 | 补 [D05] 的来源 | 该段含 [D05] | 待复核 |',
      '| P1-1 | 打回修订 | §4.2 | 恢复方向判据句 | 该段出现方向不一致 | 待复核 |',
    ],
    review: P_REVIEW('| P0-1 | ✓已关闭 | 修订说明 §3.3 |'),
  })
  try {
    const r = await runE4(f)
    assert.equal(r.pass, false, '部分相交时缺号必须照报：' + r.detail)
    assert.match(r.detail, /未覆盖 1 个审计编号/, r.detail)
    assert.doesNotMatch(r.detail, /语义对账/, '不得启用只针对「前缀完全不相交」的降级：' + r.detail)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('§一.1-④：两侧编号体系不一致、语义只对上**一小部分**（<70%/行）→ 降软（不判硬），但写明「不得读成已覆盖」', async () => {
  // 形态：复核报告**确实在处理这份任务书里的条目**（R1 逐字对上、R4 有词命中），
  //   但**没有逐条全覆盖**（R2/R3 关键词重叠不足）→ 属「疑似编号体系不一致 + 对账不完整」，
  //   判**软 22**（不判硬），并必须在提示里写明这不是「已覆盖」。
  const f = mkE4({
    rows: [
      '| R1 | 打回修订 | §3.3 首段 | 补 [D05] 的独立统计来源并说明口径 | 该段含 [D05] 且写明口径边界 | 待复核 |',
      '| R2 | 打回修订 | §4.2 末段 | 恢复「观念面与行为面方向不一致」的方向判据句 | 该段出现「方向不一致」并列出反向事实 | 待复核 |',
      '| R3 | 打回修订 | §5.2 第 2 段 | 按四项点对点回应并补「不替代结构研究」声明 | 该段 ≥500 字且四项齐全 | 待复核 |',
      '| R4 | 打回修订 | §6 结语 | 补一段与引言呼应的结论句 | 结语出现与引言呼应的收束句 | 待复核 |',
    ],
    review: P_REVIEW([
      '本轮逐条落实：',
      '① §3.3 首段：已补 [D05] 的独立统计来源并说明口径，该段含 [D05] 且写明口径边界。',
      '② §6 结语：已补一段与引言呼应的结论句。',
    ].join('\n')),
  })
  try {
    const r = await runE4(f)
    // ⚠️ `detail` 只印**前两条**软提示（`soft.slice(0, 2)`），本形态的关键软项排在第三位 →
    //   断言走结果里的 `soft` 全量列表（v19.5.0 起 M-Exist-4 随结果返回 `soft`，与 M-Exist-5 同形）。
    const softTxt = r.soft.join(' ｜ ')
    assert.notEqual(r.severity, 'P1', '对账不完整属**软档**（不得判硬 21）：' + JSON.stringify(r))
    assert.notEqual(r.severity, 'P0', '对账不完整不得判 P0：' + JSON.stringify(r))
    assert.match(softTxt, /疑似编号体系不一致/, '须给出可操作提示：' + softTxt)
    assert.match(softTxt, /不得\*\*读成「已覆盖」|不得读成/, '须写明这不是「已覆盖」：' + softTxt)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

// ════════════════════════════════════════════════════════════════════════════
// §一.3 A/B 轨复核指纹：豁免降 soft、指纹不符仍硬 21
// ════════════════════════════════════════════════════════════════════════════
const DRAFT = '# 标题\n\n## 摘要\n\n摘要正文。\n\n## 一、导论\n\n' + '正文段落。'.repeat(30) + '\n'
const shaOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const REVIEW_REPORT = (fp) => [
  '# 复核报告',
  '',
  '## 已读范围',
  '',
  '- **被审正文**：drafts/初稿-v1.md 的 §1、§2',
  `- **被审正文 sha256**：\`${fp}\``,
  '',
].join('\n')

/** 造一个「账本 A 轨一行」的项目；`reviewCell` 逐字进「复核报告」列。 */
const mkLedgerProj = ({ reviewCell, withReport = true, fp = null }) => {
  const d = tmp('lunheng-b23-ledger-')
  mkdirSync(join(d, 'drafts'), { recursive: true })
  writeFileSync(join(d, 'drafts', '初稿-v1.md'), DRAFT)
  const real = shaOf(join(d, 'drafts', '初稿-v1.md'))
  if (withReport) {
    mkdirSync(join(d, 'audits'), { recursive: true })
    writeFileSync(join(d, 'audits', '复核报告-v1.md'), REVIEW_REPORT(fp === null ? real : fp))
  }
  writeFileSync(join(d, 'drafts', '轮次账本.md'),
    '# 轮次账本\n\n| 轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间 |\n|---|---|---|---|---|---|\n'
    + `| A | 1/2 | drafts/初稿-v1.md | audits/审计报告-v1.md | ${reviewCell} | 2026-10-13 |\n`)
  return d
}
const a9 = (j) => [...j.hard, ...(j.soft || [])].filter((x) => x.check === 'A9')

test('§一.3-①：A 轨有独立复核报告且**指纹相符** → pass（不报 A9）', () => {
  const d = mkLedgerProj({ reviewCell: 'audits/复核报告-v1.md' })
  try {
    const j = parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', '--summary']))
    assert.equal(a9(j).length, 0, '指纹相符不得报 A9：' + JSON.stringify(a9(j)))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('§一.3-②：A 轨声明**豁免理由**（`—（同轮无独立复核：…）`）→ soft 22，且理由须出现在 detail 里', () => {
  const d = mkLedgerProj({ reviewCell: '—（同轮无独立复核：本轮为 Phase 3.6 常规压缩轮，无独立审计对象）', withReport: false })
  try {
    const j = parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', '--summary']))
    const hard9 = j.hard.filter((x) => x.check === 'A9')
    assert.equal(hard9.length, 0, '声明豁免后不得再判 A9 硬项：' + JSON.stringify(j.hard))
    const soft9 = (j.soft || []).filter((x) => x.check === 'A9')
    assert.equal(soft9.length, 1, '须有一条 A9 软提示（可见、不阻塞）：' + JSON.stringify(j.soft))
    assert.match(soft9[0].detail, /同轮无独立复核/, soft9[0].detail)
    assert.match(soft9[0].detail, /Phase 3\.6 常规压缩轮/, '理由须原样带出：' + soft9[0].detail)
    assert.match(soft9[0].detail, /不是「已复核」|这不是「已复核」/, '不得被读成已复核：' + soft9[0].detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('§一.3-③【反向】声明了报告但**指纹不符** → 仍硬 21', () => {
  const d = mkLedgerProj({ reviewCell: 'audits/复核报告-v1.md', fp: 'deadbeef'.repeat(8) })
  try {
    const j = parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', '--summary']))
    const hard9 = j.hard.filter((x) => x.check === 'A9')
    assert.equal(hard9.length, 1, '指纹不符必须判硬：' + JSON.stringify(j.hard))
    assert.match(hard9[0].detail, /不符/, hard9[0].detail)
    // ⚠️ 不断言 `j.exit === 21`：本夹具缺 `final/定稿.md`，A1 的 20 号档**优先**（同一文件已注明的
    //   「20 压 21」语义）。本用例要钉的是「指纹不符仍进 A9 硬项」——那是 21 的原触发行。
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('§一.3-④【反向】「复核报告」列**留空** ≠ 豁免 → 仍硬 21', () => {
  const d = mkLedgerProj({ reviewCell: '', withReport: false })
  try {
    const j = parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', '--summary']))
    const hard9 = j.hard.filter((x) => x.check === 'A9')
    assert.equal(hard9.length, 1, '留空是缺口、必须判硬：' + JSON.stringify(j.hard))
    assert.match(hard9[0].detail, /缺「复核报告」列/, hard9[0].detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ════════════════════════════════════════════════════════════════════════════
// §一.4 T8 交付物最小清单（五件，缺一 hard 20）
// ════════════════════════════════════════════════════════════════════════════
const T8_FILES = ['定稿.md', '交付说明.md', '局限性.md', 'AI-使用声明.md', '运行报告.html']
/** 造一个 T8 交付夹具；`omit` 里的文件不写（= 缺件）。 */
const mkT8 = (omit = []) => {
  const d = tmp('lunheng-b23-t8-')
  mkdirSync(join(d, 'final'), { recursive: true })
  for (const f of T8_FILES) {
    if (omit.includes(f)) continue
    writeFileSync(join(d, 'final', f), `# ${f}\n\n内容。\n`)
  }
  return d
}
const runT8 = (d) => parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', '--summary']))
const t8Hard = (j) => j.hard.filter((x) => x.subject === 'T8 交付物最小清单')

test('§一.4-①：五件交付物齐 → 不得报「T8 交付物最小清单」硬项', () => {
  const d = mkT8()
  try {
    const j = runT8(d)
    assert.equal(t8Hard(j).length, 0, '五件齐备不得报缺：' + JSON.stringify(j.hard))
    assert.match((j.notes || []).join('\n'), /五件齐备/, '须留痕说明已核：' + JSON.stringify(j.notes))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('§一.4-②：删任一交付物 → hard 20（逐件核，五件各跑一次）', () => {
  for (const f of T8_FILES) {
    const d = mkT8([f])
    try {
      const j = runT8(d)
      const hits = t8Hard(j)
      assert.equal(hits.length, 1, `缺 ${f} 必须报且只报一条：` + JSON.stringify(j.hard))
      // ⚠️ `exitClass` 不出现在 JSON 里（出口处 `hard.map(({ exitClass, ...rest }) => rest)` 刻意剥掉），
      //   故「档位 20」只能由**进程退出码**核（`addHard(…, 20)` 唯一支配 exit 20）；条数与点名为阴性/阳性两侧。
      assert.match(hits[0].detail, new RegExp(f.replace('.', '\\.')), `须点名缺的是 ${f}：` + hits[0].detail)
      assert.match(hits[0].detail, /hard 20/, `文案须点明档位：` + hits[0].detail)
      assert.equal(j.exit, 20, `缺 ${f} 时进程退出码须为 20：` + j.exit)
    } finally { rmSync(d, { recursive: true, force: true }) }
  }
})

test('§一.4-③【边界】`final/` 尚无正文层产物（Phase 5 未开始）→ 本项**不判**，且不得静默', () => {
  const d = tmp('lunheng-b23-t8-empty-')
  mkdirSync(join(d, 'final', '证据包'), { recursive: true })
  try {
    const j = runT8(d)
    assert.equal(t8Hard(j).length, 0, '时点没到时不得假红：' + JSON.stringify(j.hard))
    assert.match((j.notes || []).join('\n'), /尚无正文层产物|本项未判/, '必须说明「未判」而不是沉默：' + JSON.stringify(j.notes))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('§一.4-④【边界】空文件 = 缺件（0 字节不得当已交付）', () => {
  const d = mkT8()
  try {
    writeFileSync(join(d, 'final', '局限性.md'), '')
    const j = runT8(d)
    assert.equal(t8Hard(j).length, 1, '0 字节须判缺件：' + JSON.stringify(j.hard))
    assert.match(t8Hard(j)[0].detail, /局限性\.md/, t8Hard(j)[0].detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ════════════════════════════════════════════════════════════════════════════
// §二.7 M-Exist-1：区分「来源条目」与「缺口条目」
// ════════════════════════════════════════════════════════════════════════════
const m1Draft = (bodyCite, endnotes) => [
  '# 标题',
  '',
  '## 摘要',
  '',
  `正文引用 ${bodyCite}。`,
  '',
  '## 一、导论',
  '',
  '论证段落。'.repeat(20),
  '',
  '## 参考文献',
  '',
  '[L01] 甲. 题名[J]. 刊, 2024.',
  '',
  '## 数据来源',
  '',
  endnotes,
  '',
  '## 案例来源',
  '',
  '## 先行者文献',
  '',
  '## AI 使用声明',
  '',
  'AI。',
  '',
].join('\n')
const runM1 = ({ bodyCite, endnotes }) => {
  const { d, proj, fin, ev } = mkProject()
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, m1Draft(bodyCite, endnotes))
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev])
  const it = parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-1'))
  rmSync(d, { recursive: true, force: true })
  return { detail: String(it.detail), severity: it.severity, pass: it.pass }
}

test('§二.7-①：正文引 [G05] 且缺口节内含 G05 → 不得报漏引（缺口族独立闭环）', () => {
  const r = runM1({ bodyCite: '[L01] [G05]', endnotes: '[D01] 机构数据。\n\n[G05] 「性别对立」案由无独立统计（口径性缺口）。' })
  assert.doesNotMatch(r.detail, /缺口条目 \[G05\] 在正文被引用/, '缺口已登记，不得报漏引：' + r.detail)
  assert.match(r.detail, /缺口条目已闭环/, '须留痕说明缺口族已闭环：' + r.detail)
})

test('§二.7-②【反向】正文引 [G05] 而缺口节**无 G05** → 仍报（真漏引不得被来源族口径带走）', () => {
  const r = runM1({ bodyCite: '[L01] [G05]', endnotes: '[D01] 机构数据。\n\n[G04] 另一项缺口。' })
  assert.equal(r.pass, false, '正文引了却查无条目必须判失败：' + r.detail)
  assert.match(r.detail, /缺口条目 \[G05\] 在正文被引用/, r.detail)
  assert.equal(r.severity, 'P1', '须与漏引同档（P1）：' + r.severity)
})

test('§二.7-③【边界】缺口族**不判孤儿**：文末登记 G06 而正文未引 → 合法（先登记后引用）', () => {
  const r = runM1({ bodyCite: '[L01] [D01]', endnotes: '[D01] 机构数据。\n\n[G06] 未公开的年度统计。' })
  assert.doesNotMatch(r.detail, /缺口条目 \[G06\] 在正文被引用/, '缺口孤儿不得按漏引判：' + r.detail)
  assert.notEqual(r.severity, 'P0', '缺口孤儿不得拉 P0：' + r.severity)
  assert.notEqual(r.severity, 'P1', '缺口孤儿不得拉 P1：' + r.severity)
  assert.match(r.detail, /缺口条目已闭环/, '须留痕说明缺口族已闭环：' + r.detail)
})

// ════════════════════════════════════════════════════════════════════════════
// §二.8 账本**逐行降级**（一行坏 + 两行好）
// ════════════════════════════════════════════════════════════════════════════
test('§二.8-①：一行坏 + 两行好 → 好行照判、坏行进 malformed（不得整表作废）', async () => {
  const { parseLedger } = await import(LEDGER)
  const d = tmp('lunheng-b23-degrade-')
  mkdirSync(join(d, 'drafts'), { recursive: true })
  writeFileSync(join(d, 'drafts', '轮次账本.md'),
    '# 轮次账本\n\n| 轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间 |\n|---|---|---|---|---|---|\n'
    // 坏行：`轮次` 列写成 `1`（本项目实测形态）
    + '| A | 1 | drafts/初稿-v1.md | x | y | 2026-10-13 |\n'
    + '| B | 1/1 | drafts/初稿-v2.md | x | y | 2026-10-13 |\n'
    + '| G | 1/2 | drafts/初稿-v9.md | x | y | 2026-10-13 |\n')
  try {
    const info = parseLedger(d)
    assert.equal(info.rows.length, 2, '两行好的必须照判：' + JSON.stringify(info.rows))
    assert.equal(info.rows[0].track, 'B', 'B 行不得被坏行牵连：' + JSON.stringify(info.rows))
    assert.equal(info.rows[1].track, 'G', 'G 行不得被坏行牵连：' + JSON.stringify(info.rows))
    assert.equal(info.counts.B, 1)
    assert.equal(info.counts.G, 1)
    assert.equal(info.counts.A, 0, '坏行不得计入 A 轨累计（不计入 ≠ 作废）')
    assert.equal(info.malformed.length, 1, '坏行必须进 malformed 且只此一条：' + JSON.stringify(info.malformed))
    assert.match(info.malformed[0], /轮次.*不是.*n\/m/, info.malformed[0])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('§二.8-②：`n/m` 分母写错 → **推断 m 并照判该行**（记 capInferred，不牵连整表）', async () => {
  const { parseLedger } = await import(LEDGER)
  const d = tmp('lunheng-b23-infer-')
  mkdirSync(join(d, 'drafts'), { recursive: true })
  writeFileSync(join(d, 'drafts', '轮次账本.md'),
    '# 轮次账本\n\n| 轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间 |\n|---|---|---|---|---|---|\n'
    + '| A | 1/5 | drafts/初稿-v1.md | x | y | 2026-10-13 |\n')
  try {
    const info = parseLedger(d)
    assert.equal(info.rows.length, 1, '该行须被照判（不得整表作废）：' + JSON.stringify(info.rows))
    assert.equal(info.rows[0].capInferred, true, '须标记分母是推断值：' + JSON.stringify(info.rows[0]))
    assert.equal(info.rows[0].declared, 2, '推断源 = 生效额度 2（ROUND_CAPS）：' + JSON.stringify(info.rows[0]))
    assert.equal(info.over.length, 0, '第 1 轮不越额：' + JSON.stringify(info.over))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('§二.8-③：`reviewExemption` 只认「有理由」的豁免；空理由不构成声明', async () => {
  const { reviewExemption } = await import(LEDGER)
  assert.equal(reviewExemption('—（同轮无独立复核：本轮为压缩轮，无独立审计对象）'), '本轮为压缩轮，无独立审计对象')
  assert.equal(reviewExemption('-（同轮无独立复核：同轮无独立复核对象）'), '同轮无独立复核对象')
  assert.equal(reviewExemption('—（同轮无独立复核：无）'), null, '理由过短不算声明（宁拒不猜）')
  assert.equal(reviewExemption(''), null, '空单元格 ≠ 豁免')
  assert.equal(reviewExemption('audits/复核报告-v1.md'), null, '报告路径不是豁免')
})

// ════════════════════════════════════════════════════════════════════════════
// §三.11 六要素（缺「状态机更新」→ 仍硬 21）
// ════════════════════════════════════════════════════════════════════════════
const SIX = ['做了什么', '产物在哪', '怎么验证', '已知问题', '下一步', '状态机更新']
const reportOf = (secs) => secs.map((s, i) => `## ${i + 1}. ${s}\n\n- 内容。\n`).join('\n')

/** 造一个「T4 收报」夹具：产物齐 + 回报按参数给；返回 handoff-check 的 JSON。 */
const runT4 = (sections) => {
  const { d, proj } = mkProject({ analysis: true })
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), '# 分析大纲\n\n## 一、主线\n\n内容。\n')
  writeFileSync(join(proj, 'analysis', '素材加载清单.md'), '# 素材加载清单\n\n## 已加载\n\n- [L01]\n')
  const rep = join(d, 'report.md')
  writeFileSync(rep, reportOf(sections))
  const j = parseJson(run([H(), '--project', proj, '--role', 'T4', '--report-file', rep, '--summary']))
  rmSync(d, { recursive: true, force: true })
  return j
}
const b1 = (j) => j.hard.filter((x) => x.check === 'B1')

test('§三.11-①：只缺「状态机更新」→ **仍判 hard**（旧文写「五要素」正是漏数这一项）', () => {
  const j = runT4(SIX.filter((s) => s !== '状态机更新'))
  const hits = b1(j)
  assert.equal(hits.length, 1, '缺段必须判硬：' + JSON.stringify(j.hard))
  assert.match(hits[0].detail, /状态机更新/, '须点名缺的是「状态机更新」：' + hits[0].detail)
  assert.equal(j.exit, 21, '须 exit 21：' + j.exit)
})

test('§三.11-②：六要素齐 → 不得报 B1', () => {
  const j = runT4(SIX)
  assert.equal(b1(j).length, 0, '六段齐备不得报缺段：' + JSON.stringify(j.hard))
})

test('§三.11-③【边界】写「状态更新」（少一个「机」字）不算命中 —— 六段名是逐字契约', () => {
  const j = runT4([...SIX.filter((s) => s !== '状态机更新'), '状态更新'])
  assert.equal(b1(j).length, 1, '近似词不得顶替段名：' + JSON.stringify(j.hard))
  assert.match(b1(j)[0].detail, /状态机更新/, b1(j)[0].detail)
})
