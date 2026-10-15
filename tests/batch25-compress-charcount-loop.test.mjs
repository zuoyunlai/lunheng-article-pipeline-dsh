// 压缩 / 字数闭环批（batch25 · v19.5.0）
//
// **为什么需要**：反哺 merge清单-合并版-19条 里 §一·2（大纲各节★下限之和 = 总预算 → 字数不可满足）
//   ＋ §三·14（T7 卡缺「压缩轮专项复核」小节）＋ §三·15（压缩轮不变量清单不完整）**必须同批做**，
//   三节分别是「生成期防 / 复核期查 / 执行期守」：
//     · 生成期（04 卡）：各节★下限之和 ≤ 目标 × 0.95 的**校验式**（不满足即自减最低权重节下限）；
//     · 执行期（apply-compression-cycle.mjs）：不变量**增列两项**（分节最小硬指标不得跌破 /
//       含判据·标准·口径关键词的句子不得整句删除）＋ 压缩后自动与大纲 §11 预算表对账，不满足即 exit 非 0；
//     · 复核期（07 卡）：「压缩轮专项（被审正文为压缩产物时强制）」固定四项。
//
// 本文件的用例分三组，逐条对应该三节的**验收**条款：
//   A 组（§一·2）：真夹具 `run/<项目>/analysis/分析大纲.md`（其分节标题的下限和 = 8,000）
//     → 必须给出「下限和已顶满、请留 5% 弹性」；再造「下限和 < 目标 × 0.95」的正常夹具 → **不得**提示。
//   B 组（§三·15）：分节跌破硬指标 → P1 + exit 非 0；引用多重集 / 图位编号集被改动 → 须报；一切未动 → exit 0。
//   C 组（§三·14）：角色卡的机械断言（小节标题 + 四个固定项字面在场）＋ 以
//     `run/xingbie/drafts/初稿-v1.md` → `初稿-v2.md` 做一次「判据句差集」演示（四项都能被列出）。
//
// **边界（如实）**：夹具项目 `run/xingbie/**` 一律**只读**（本文件不写它一个字节）；A 组的预期数字
//   来自**实测**（分节标题式下限和 = 8,000 = 1,000×6 夹具；本轮大纲实测 = 8,260 = 850+1100+610+
//   **2960**+**1880**+600，§11 表式则为 7,960——两处不一致本身即 note 的一条，见 A.1' 的断言）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { run, parseJson, tmp, ROOT } from './_fixtures.mjs'

const S = (n) => join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', n)
const CYCLE = S('apply-compression-cycle.mjs')

// ── 只读真夹具根（v19.5.0 收口：**不写死本机绝对路径**）─────────────────────────────
// 为什么必须动态解析：本仓有一道门专扫「本机绝对路径」（`_lib/local-path-scan.mjs`，
//   机器指纹 `E:\<作者本机工作根>\…` 命中即 fail，非随包树走棘轮、未登记即红）。把夹具路径
//   **写进测试源码**，等于让「跑一次验收用例」和「过仓库卫生门」互相打架——而两者都必须绿。
// 解析顺序：`$LUNHENG_FIXTURE_ROOT`（显式指定）→ 仓库同级的 `run/` 下**按项目名确定性选取**
//   （本批夹具项目名 = `xingbie`；直接用「第一个含 `analysis/分析大纲.md` 的目录」是**不确定**的——
//     本机 `run/` 下有 38 个符合条件的项目，字母序第一个是 `AB-ai-content-farm-A`，
//     于是真夹具用例会对着**别的项目**断言，四条用例全红且红得毫无信息量。实测过。）
// 找不到 ≠ 失败：真夹具用例在本机/CI 上是否可跑是**环境事实**，故按本仓既有口径**带理由跳过**，
//   而不是把缺夹具读成回归。
//   ⚠️ v19.6.1（全量审计-2026-10-15 P2-9）：跳过出口由 `assert.ok(true, '…跳过…') + return`
//   **改为 `t.skip('…')`**——前者会被 node:test 记成 **PASS**（「缺夹具」与「真跑过」在报告里同形），
//   与本仓「**skip ≠ 通过**」的既定口径相反。同批修了本文件 4 处与 `batch24-*` 2 处。
const FIXTURE_PROJECT = 'xingbie'
const FIXTURE_ROOT = (() => {
  if (process.env.LUNHENG_FIXTURE_ROOT) return process.env.LUNHENG_FIXTURE_ROOT
  const base = join(ROOT, '..', 'run')
  if (!existsSync(base)) return null
  const hit = join(base, FIXTURE_PROJECT)
  return existsSync(join(hit, 'analysis', '分析大纲.md')) ? hit : null
})()
/** 真夹具项目目录（找不到时为 null，调用处据此跳过）。 */
const XINGBIE = FIXTURE_ROOT

// ── 夹具：大纲（分节标题式下限 + §11 预算表两处真源）────────────────────────────
/** 每节下限可控的大纲：`mins.length` 节，标题行带「（预算 ≥N 字）」、§11 表同步。 */
const mkOutline = (mins, { tableOverride = null } = {}) => {
  const heads = mins.map((n, i) => `## ${i + 1} 第${i + 1}节\n\n内容。\n`).join('\n')
  const titleLine = mins.map((n, i) => `## ${i + 1} 第${i + 1}节（预算 ≥${n} 字）\n\n本节内容。\n`).join('\n')
  const rows = (tableOverride || mins).map((n, i) => `| §${i + 1} 第${i + 1}节 | ${n} | ≥${n} |`)
  return `# 分析大纲\n\n${heads}\n## §11 写手版精简段（T5 只读本节）\n\n`
    + `**四、字数预算（口径 A：正文区纯汉字）**\n\n| 章节 | 正文分配 | 本章最小硬指标 |\n|---|---|---|\n`
    + rows.join('\n') + '\n\n' + titleLine
}
/** 初稿：`## 摘要` + 各节正文（`汉`×n 字），用于「分节实值 vs 下限」对账。 */
const mkDraft = (counts) => '# 标题\n\n## 摘要\n\n' + '摘'.repeat(20) + '\n\n'
  + counts.map((n, i) => `## ${i + 1} 第${i + 1}节\n\n` + '汉'.repeat(n) + '\n').join('\n')
  + '\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'

/** 造一个项目：`run/proj/{01-任务简报.md, analysis/分析大纲.md, final/定稿.md}`。 */
const mkProj = ({ mins, counts, target = 6000, outline = null, tableOverride = null }) => {
  const d = tmp('lunheng-b25-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  writeFileSync(join(proj, '01-任务简报.md'), `# 简报\n\n目标篇幅：${target} 字\n`, 'utf8')
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), outline ?? mkOutline(mins, { tableOverride }), 'utf8')
  writeFileSync(join(proj, 'final', '定稿.md'), mkDraft(counts), 'utf8')
  return { d, proj }
}

// ─────────────────────────────────────────────────────────────────────────────
// A 组：§一·2 —— 各节★下限之和的校验式（生成期防）
// ─────────────────────────────────────────────────────────────────────────────
test('B25-A1【核心】下限和已顶满（= 目标 × 0.95 以上）→ 必须给「请留 5% 弹性」提示', () => {
  // 夹具：目标 6,000，六节下限各 1,000 → 下限和 6,000 > 6,000 × 0.95 = 5,700。
  // 形态与本轮大纲同形（本轮：目标 8,000、下限和 8,000）。
  const { d, proj } = mkProj({ mins: [1000, 1000, 1000, 1000, 1000, 1000], counts: [1000, 300, 1500, 1000, 900, 900] })
  try {
    const r = run([CYCLE, proj, '--dry-run'])
    const j = parseJson(r)
    assert.equal(j.outlineReconcile.minimaSum, 6000, '分节标题式下限和须被解析出来：' + JSON.stringify(j.outlineReconcile.perSectionMinima))
    const notes = (j.note || []).join('\n')
    assert.match(notes, /下限之和 6000 字已顶满目标 6000 × 0\.95/, '须给「已顶满」提示，实得：' + notes)
    assert.match(notes, /请留 5% 弹性/, '须给「请留 5% 弹性」提示，实得：' + notes)
    assert.match(notes, /★下限为软目标/, '须点明「★下限为软目标」，实得：' + notes)
    assert.equal(j.targetConflict, true, 'targetConflict 是机器字段，须为 true')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B25-A1′：下限和超出 ±2% 带 → 须记「守各节下限 与 落回 ±2% 不可同时满足」并给定取向', () => {
  // 形态：下限和 5,980 ≤ 目标 6,000，但 > 目标 × 1.02 = 6,120？不——5,980 < 6,120 ⇒ 不冲突。
  //   故取目标 5,800（×1.02 = 5,916，×1.05 = 6,090）：下限和 5,980 落在「±2% 带外、硬阈内」——
  //   这正是反哺 §一·2 点名的形态：三者不可兼得，脚本必须**明确取向**（先守硬阈，再谈分节下限）。
  const { d, proj } = mkProj({ mins: [1000, 1000, 1000, 1000, 1000, 980], counts: [1000, 1000, 1000, 1000, 1000, 980], target: 5800 })
  try {
    const j = parseJson(run([CYCLE, proj, '--dry-run']))
    const notes = (j.note || []).join('\n')
    assert.match(notes, /不可同时满足/, '须显式记「不可同时满足」：' + notes)
    assert.match(notes, /先守硬阈 6090 字，再谈分节下限/, '须给出取向（先守硬阈）：' + notes)
    assert.equal(j.targetConflict, true)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B25-A2【反向】下限和 < 目标 × 0.95 → **不得**出现「已顶满 / 请留 5% 弹性」提示', () => {
  // 反向用例的分量：一个会误报的门比没有门更糟（它会训练人忽略它）。目标 6,000、下限和 5,400。
  const { d, proj } = mkProj({ mins: [900, 900, 900, 900, 900, 900], counts: [900, 900, 900, 900, 900, 900] })
  try {
    const r = run([CYCLE, proj, '--dry-run'])
    const j = parseJson(r)
    assert.equal(r.code, 0, '正常夹具须 exit 0，实得 ' + r.code + '：' + r.out.slice(0, 300))
    assert.equal(j.outlineReconcile.minimaSum, 5400)
    const notes = (j.note || []).join('\n')
    assert.doesNotMatch(notes, /已顶满/, '下限和 5,400 < 5,700，不得提示「已顶满」：' + notes)
    assert.doesNotMatch(notes, /请留 5% 弹性/, '不得给弹性提示：' + notes)
    assert.doesNotMatch(notes, /不可同时满足/, '不冲突时不得报冲突：' + notes)
    assert.equal(j.targetConflict, false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B25-A3【真夹具·只读】本轮大纲：分节标题式下限和 = 8000（= 目标），须触发「已顶满」提示', () => {
  // 真夹具 = `$LUNHENG_FIXTURE_ROOT`（或仓库同级 `run/` 下自动探测到的项目；**只读**：本用例只读它，不写它）。
  // 实测数字（2026-10-13 复算，含 §4 括号里「；主体…」追加说明的解析）：
  //   分节标题式 = 850+1100+610+2960+1880+600 = **8,000**；§11 预算表式 = 850+1100+610+3000+1800+600 = **7,960**
  //   （两处不一致本身即 note 的一条：表是给写手读的，判定以标题行为准）。
  const proj = XINGBIE
  if (!proj || !existsSync(join(proj, 'analysis', '分析大纲.md'))) {
    // v19.6.1（全量审计-2026-10-15 **P2-9**）：原为 `assert.ok(true, '…跳过…') + return`——它被
    //   node:test 记成 **PASS**（「缺夹具」与「真跑过」在报告里同形），与本仓「skip ≠ 通过」口径相反。
    //   现改用 `t.skip(理由)`，报告里如实显示为 skipped。
    t.skip('夹具项目不在本机 → 跳过（真夹具用例只在本机项目目录存在时有意义）')
    return
  }  const r = run([CYCLE, proj, '--dry-run'])
  const j = parseJson(r)
  assert.equal(j.outlineReconcile.minimaSum, 8000, '标题式下限和须为 8,000（§4 的括号里带「；主体…」追加说明也不得漏解析）')
  assert.equal(j.outlineReconcile.perSectionMinima.length, 6, '六章都要解析出来，实得：' + JSON.stringify(j.outlineReconcile.perSectionMinima))
  assert.deepEqual(j.charBand, { floor: 7200, ceil: 8400 }, '硬阈 = 目标 8,000 的 −10% / +5%（8,400 即反哺所称的硬阈）')
  const notes = (j.note || []).join('\n')
  // **这正是反哺点名的形态**：下限之和恰等于总预算 8,000 ⇒ 写作只要两节略高于下限即超软上限。
  assert.match(notes, /下限之和 8000 字已顶满目标 8000 × 0\.95/, '须触发「已顶满」：' + notes)
  assert.match(notes, /请留 5% 弹性/, '须给弹性提示：' + notes)
  // §11 表式与标题式**不一致**（7,960 vs 8,000）时须显式提示两处真源已分叉（判定以标题式为准）。
  assert.match(notes, /分节标题式下限和 8000 ≠ §11 预算表式下限和 7960/, '两处真源不一致须提示：' + notes)
})

// ─────────────────────────────────────────────────────────────────────────────
// B 组：§三·15 —— 压缩轮不变量增列两项 + 压缩后自动对账（执行期守）
// ─────────────────────────────────────────────────────────────────────────────
test('B25-B1【核心】压缩后某节跌到该节硬指标之下 → 报 P1 且 exit 非 0', () => {
  // 形态：六节下限各 1,000；压缩后 §1 = 686（< 1,000）——与反哺「§1 跌到 686 字」同形。
  const { d, proj } = mkProj({ mins: [1000, 1000, 1000, 1000, 1000, 1000], counts: [686, 1000, 1000, 1000, 1000, 1000] })
  try {
    const r = run([CYCLE, proj, '--dry-run'])
    const j = parseJson(r)
    assert.notEqual(r.code, 0, '跌破分节硬指标必须 exit 非 0（实得 ' + r.code + '）')
    assert.equal(r.code, 1, '出口码须落在既有契约集合内（1 = 须再进一轮修订）')
    assert.equal(j.reconcileFailed, true)
    const hit = j.outlineReconcile.findings.filter((x) => x.id === 'section-below-min')
    assert.equal(hit.length, 1, '应恰好报 1 条 section-below-min：' + JSON.stringify(j.outlineReconcile.findings))
    assert.equal(hit[0].level, 'P1')
    assert.equal(hit[0].actual, 686)
    assert.equal(hit[0].min, 1000)
    assert.match(hit[0].detail, /实测 686 字 < 本节最小硬指标 1000 字/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B25-B2【核心】引用标记多重集被改动 → 须报（inv-citations）', () => {
  const d = tmp('lunheng-b25-inv-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), mkOutline([500, 500, 500, 500, 500, 500]), 'utf8')
  // 基线：`汉`×600 **紧接**含判据词的句子（**不插换行**），故两版的判据句集合完全相同
  //   ⇒ 本条用例只应命中引用不变量（把「判据句被删」这条正交变量隔离掉，避免两个不变量互相掩盖）。
  // 目标：正文里删掉 [L02]（引用多重集少一处；文末著录两版都保留，故差异只来自正文）。
  const tail = '\n\n## 参考文献\n\n[L01] a\n[L02] b\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  writeFileSync(join(proj, 'final', '定稿.md'),
    '# 标题\n\n## 摘要\n\n正文 [L01][D01]。\n\n' + '汉'.repeat(600) + '若数据为当事方自源则不作独立事实认定。\n' + tail, 'utf8')
  writeFileSync(join(proj, 'baseline.md'),
    '# 标题\n\n## 摘要\n\n正文 [L01][L02][D01]。\n\n' + '汉'.repeat(600) + '若数据为当事方自源则不作独立事实认定。\n' + tail, 'utf8')
  try {
    const r = run([CYCLE, proj, '--dry-run', '--baseline', join(proj, 'baseline.md')])
    const j = parseJson(r)
    const ids = j.invariants.violations.map((x) => x.id)
    assert.ok(ids.includes('inv-citations'),
      '须报引用多重集改动，实得：' + JSON.stringify(ids) + ' / ' + j.invariants.reason
      + ' / 基线正文引用数=' + (readFileSync(join(proj, 'baseline.md'), 'utf8').match(/\[(?:L|D|C|先)\d{1,3}\]/g) || []).length)
    assert.ok(!ids.includes('inv-criterion-sentences'), '本夹具判据句两版一致 → 不得报判据句（否则两个不变量互相掩盖）')
    assert.match(j.invariants.violations.find((x) => x.id === 'inv-citations').detail, /少 1 处/)
    assert.equal(r.code, 1, '不变量被破坏须 exit 非 0')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B25-B3【核心】图位编号集被改动 → 须报（inv-figures）', () => {
  const d = tmp('lunheng-b25-fig-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), mkOutline([500, 500, 500, 500, 500, 500]), 'utf8')
  const tail = '\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  // 基线有两个图位（[图1]/[图2]），目标只剩 [图1] → 图位编号集被改动。
  writeFileSync(join(proj, 'final', '定稿.md'),
    '# 标题\n\n## 摘要\n\n正文。\n\n[图1：趋势]\n\n' + '汉'.repeat(600) + '\n' + tail, 'utf8')
  writeFileSync(join(proj, 'baseline.md'),
    '# 标题\n\n## 摘要\n\n正文。\n\n[图1：趋势]\n\n[图2：占比]\n\n' + '汉'.repeat(600) + '\n' + tail, 'utf8')
  try {
    const r = run([CYCLE, proj, '--dry-run', '--baseline', join(proj, 'baseline.md')])
    const j = parseJson(r)
    const v = j.invariants.violations.find((x) => x.id === 'inv-figures')
    assert.ok(v, '须报图位编号集改动，实得：' + JSON.stringify(j.invariants.violations.map((x) => x.id)))
    assert.match(v.detail, /少 \[图2\]/)
    assert.equal(r.code, 1)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B25-B4【核心】含判据/标准/口径关键词的句子被整句删除 → 须报（inv-criterion-sentences）', () => {
  const d = tmp('lunheng-b25-crit-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), mkOutline([500, 500, 500, 500, 500, 500]), 'utf8')
  const tail = '\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  // 基线含一句判据句（「若来源为当事方自源，则不作独立事实认定」的等价形态），目标里整句消失。
  writeFileSync(join(proj, 'final', '定稿.md'),
    '# 标题\n\n## 摘要\n\n正文论述。\n\n' + '汉'.repeat(600) + '\n' + tail, 'utf8')
  writeFileSync(join(proj, 'baseline.md'),
    '# 标题\n\n## 摘要\n\n正文论述。\n\n本口径下限定为：若数据为当事方自源，则不作独立事实认定。\n\n'
    + '汉'.repeat(600) + '\n' + tail, 'utf8')
  try {
    const r = run([CYCLE, proj, '--dry-run', '--baseline', join(proj, 'baseline.md')])
    const j = parseJson(r)
    const v = j.invariants.violations.find((x) => x.id === 'inv-criterion-sentences')
    assert.ok(v, '须报判据句整句删除，实得：' + JSON.stringify(j.invariants.violations.map((x) => x.id)))
    assert.match(v.detail, /不得整句删除/)
    assert.ok(v.samples.some((s) => /若数据为当事方自源/.test(s)), '样句须带上被删的判据句：' + JSON.stringify(v.samples))
    assert.equal(r.code, 1)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B25-B5【反向】一切未动 → exit 0 且不变量零违规（自动探测基线被跳过）', () => {
  // 形态：`final/定稿.md` 与 `drafts/初稿-v2.md` 逐字节相同，无 `--baseline`。
  // 若不跳过，脚本会把「复核一份未动的稿子」读成「引用多重集被改动」——假阳性。
  const d = tmp('lunheng-b25-clean-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), mkOutline([500, 500, 500, 500, 500, 500]), 'utf8')
  const doc = mkDraft([600, 600, 600, 600, 600, 600]).replace('## 摘要', '## 摘要')
  writeFileSync(join(proj, 'final', '定稿.md'), doc, 'utf8')
  writeFileSync(join(proj, 'drafts', '初稿-v2.md'), doc, 'utf8')   // 与目标逐字节相同
  try {
    const r = run([CYCLE, proj, '--dry-run'])
    assert.equal(r.code, 0, '未动即 exit 0，实得 ' + r.code + '：' + r.out.slice(0, 400))
    const j = parseJson(r)
    assert.equal(j.invariants.checked, false)
    assert.match(j.invariants.reason, /跳过不变量比对/)
    assert.deepEqual(j.invariants.violations, [])
    assert.equal(j.reconcileFailed, false)
    assert.deepEqual(j.outlineReconcile.findings, [])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B25-B6【反向】无大纲 → 分节对账记「未核」且**不改退出码**（不制造假 P1）', () => {
  const d = tmp('lunheng-b25-nool-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n目标篇幅：6000 字\n', 'utf8')
  writeFileSync(join(proj, 'final', '定稿.md'), mkDraft([1000, 1000, 1000, 1000, 1000, 1000]), 'utf8')
  try {
    const r = run([CYCLE, proj, '--dry-run'])
    assert.equal(r.code, 0, '无大纲时不得凭空报分节 P1：' + r.out.slice(0, 300))
    const j = parseJson(r)
    assert.equal(j.outlineReconcile.outlinePath, null)
    assert.equal(j.outlineReconcile.minimaSum, null)
    assert.equal(j.reconcileFailed, false)
    assert.ok(j.outlineReconcile.findings.some((f) => f.id === 'outline-missing' && f.level === 'P2'), '须记「未核」（P2，不是 P1）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// C 组：§三·14 —— T7 卡「压缩轮专项」小节（机械断言 + 判据句差集演示）
// ─────────────────────────────────────────────────────────────────────────────
const AUDITOR = join(ROOT, 'skills', 'lunheng-article-pipeline', 'references', 'agents', '07-审计-auditor.md')
const ANALYST = join(ROOT, 'skills', 'lunheng-article-pipeline', 'references', 'agents', '04-分析-analyst.md')

test('B25-C1 07 卡：小节标题在场且四固定项**逐字**在场（固定四项 = 反哺点名的四条）', () => {
  const src = readFileSync(AUDITOR, 'utf8')
  assert.match(src, /^## 压缩轮专项（被审正文为压缩产物时强制）$/m,
    '小节标题须逐字为「## 压缩轮专项（被审正文为压缩产物时强制）」')
  for (const item of ['**不变量复核**', '**判据句存活复核**', '**分节硬指标复核**', '**降级标注存活复核**']) {
    assert.ok(src.includes(item), `固定项在场断言失败：缺 ${item}`)
  }
  // 四项的判据内容（引用多重集 / 图位编号集 / 判据关键词面 / §11 逐节 / 二手转引限定）也要在场。
  for (const kw of ['引用标记多重集', '图位编号集', '若 / 则 / 判据 / 标准 / 口径 / 前提 / 限定',
    '§11 预算表', '（预算 ≥N 字）', '二手转引（🔴）', '等价限定']) {
    assert.ok(src.includes(kw), `判据内容在场断言失败：缺 ${kw}`)
  }
  // 目录项（机检 ㉗ 锚点覆盖：`](#anchor)` 必须能解析到该标题）。
  assert.ok(src.includes('- [压缩轮专项（被审正文为压缩产物时强制）](#压缩轮专项被审正文为压缩产物时强制)'),
    '目录须登记该小节（否则锚点覆盖门报悬空内链）')
})

test('B25-C2 04 卡：字数分配校验式在场（各节★下限之和 ≤ 目标 × 0.95 + 自减 + 软目标）', () => {
  const src = readFileSync(ANALYST, 'utf8')
  assert.ok(src.includes('各节 ★下限之和的校验式'), '校验式小节须在场')
  assert.ok(src.includes('`各节★下限之和 ≤ 目标字数 × 0.95`'), '校验式须逐字写出')
  assert.ok(src.includes('自减最低权重节的下限'), '不满足时的动作须是「自减最低权重节的下限」')
  assert.ok(src.includes('★下限是软目标'), '须明写「★下限是软目标」')
  assert.ok(src.includes('## N 章节名（预算 ≥N 字）'), '须给出压缩轮对账的解析锚点形态')
})

test('B25-C3【真夹具·只读】v1 → v2「判据句差集」演示：四项都能被列出（含 P1-1 判据句被删）', (t) => {
  const v1p = XINGBIE ? join(XINGBIE, 'drafts', '初稿-v1.md') : null
  const v2p = XINGBIE ? join(XINGBIE, 'drafts', '初稿-v2.md') : null
  if (!v1p || !existsSync(v1p) || !existsSync(v2p)) {
    t.skip('真夹具不在本机 → 跳过')   // v19.6.1（P2-9）：改记 SKIP，不再用 assert.ok(true) 冒充 PASS
    return
  }
  // 与角色卡第 2 项同形的最小实现：抽含关键词的句子集合 → 做差集。**只读**两份初稿。
  const KW = /若|则|判据|标准|口径|前提|限定/
  const sents = (p) => readFileSync(p, 'utf8').split(/\n{2,}/).flatMap((para) => {
    const t = para.trim()
    if (!t || t.startsWith('#') || t.startsWith('|') || t.startsWith('>')) return []
    return t.split(/(?<=[。；！？!?])|\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s && KW.test(s))
  })
  const a = sents(v1p)
  const b = new Set(sents(v2p))
  const killed = [...new Set(a.filter((s) => !b.has(s)))]
  // ① 不变量复核（引用标记多重集两版一致——本条夹具已知结论，用作「四项都列得出」的对照项）
  const cit = (t) => (t.match(/\[(?:L|D|C|先)\d{1,3}\]/g) || []).sort()
  assert.deepEqual(cit(readFileSync(v1p, 'utf8')), cit(readFileSync(v2p, 'utf8')),
    '① 引用标记多重集两版应一致（若本夹具变化，说明初稿已被改写——须复核夹具而非放宽断言）')
  // ② 判据句存活复核 → 差集非空（即点名的 P1-1：判据句被删）
  assert.ok(killed.length > 0, '② 判据句差集须非空（P1-1：判据句被删）——空集说明夹具已变或抽取口径已失效')
  // ③ 分节硬指标复核（钉住 v2 的 §1 跌到 850 之下这一实测事实）
  const sec1 = (() => {
    const t = readFileSync(v2p, 'utf8')
    const at = t.indexOf('## 1 引言')
    const to = t.indexOf('\n## ', at + 1)
    return (t.slice(at, to === -1 ? t.length : to).match(/[\u4e00-\u9fa5]/g) || []).length
  })()
  assert.ok(sec1 < 850, `③ §1 引言须低于硬指标 850（实测 ${sec1}）`)
  // ④ 降级标注存活复核（本夹具 v2 仍保留「当事方自源」类限定 → 该项**判通过**，与②形成对照）
  const v2txt = readFileSync(v2p, 'utf8')
  assert.match(v2txt, /当事方自源|未独立审计|转引/, '④ 降级限定须仍在场（本夹具判通过——四项里并非每项都报）')
})

test('B25-C4【真夹具·只读】脚本对同一对版本实测：criterion 违规 + 两条 section-below-min + exit 1', (t) => {
  const proj = XINGBIE
  const v1p = proj ? join(proj, 'drafts', '初稿-v1.md') : null
  const v2p = proj ? join(proj, 'drafts', '初稿-v2.md') : null
  if (!proj || !v1p || !existsSync(v1p) || !existsSync(v2p)) {
    t.skip('真夹具不在本机 → 跳过')   // v19.6.1（P2-9）：同 C3
    return
  }
  const r = run([CYCLE, proj, '--dry-run', '--target-N', v2p, '--baseline', v1p])
  const j = parseJson(r)
  assert.equal(r.code, 1, '不变量/分节对账不通过须 exit 1（不是 0）')
  assert.equal(j.reconcileFailed, true)
  assert.ok(j.invariants.violations.some((x) => x.id === 'inv-criterion-sentences'), '须报判据句整句删除')
  const below = j.outlineReconcile.findings.filter((x) => x.id === 'section-below-min').map((x) => `${x.section}:${x.actual}<${x.min}`)
  assert.ok(below.some((s) => s.startsWith('1 引言')), '须报 §1 引言跌破：' + JSON.stringify(below))
  assert.ok(below.some((s) => s.startsWith('5 讨论')), '须报 §5 讨论跌破：' + JSON.stringify(below))
})

// ─────────────────────────────────────────────────────────────────────────────
// D 组：§三·15 的**读数面**（v19.5.0 收口）：决定退出码的那份清单必须同文进 `note`
// ─────────────────────────────────────────────────────────────────────────────
// 病灶（并行工程师遗留，本批修正）：`note` 旧式三元
//   `conflicts.length ? conflicts : (headingSum ? [] : […])` **只装目标计算冲突一族**——
//   `conflicts` 一空（极常见：下限和未顶满弹性阈值、两处真源恰好一致），`note` 即被强制置 `[]`，
//   **invariantViolations 与 section-below-min 一条都读不到**。而 04 卡与 07 卡都把 `note` 写成
//   「机械复核的读数面」⇒ 按卡读的人看到的是「无异常」，与 `exit 1` 直接打架。
// 判据一句话：**决定退出码的清单，必须与 note 里的清单一字不差**（下面两条用例钉住这一点）。

test('B25-D1【核心】不变量被破坏 → 决定 exit 的清单须**同文进 note**（不得只躺在 invariants 字段里）', () => {
  const d = tmp('lunheng-b25-note-inv-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  // 大纲下限（500×6=3,000）刻意**不触发**任何目标冲突 → `conflicts` 为空，
  //   这正是旧实现把 note 打成 `[]` 的那个分支（若不修，本条用例必红）。
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), mkOutline([500, 500, 500, 500, 500, 500]), 'utf8')
  const tail = '\n\n## 参考文献\n\n[L01] a\n[L02] b\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  writeFileSync(join(proj, 'final', '定稿.md'),
    '# 标题\n\n## 摘要\n\n正文 [L01][D01]。\n\n' + '汉'.repeat(600) + '\n' + tail, 'utf8')
  writeFileSync(join(proj, 'baseline.md'),
    '# 标题\n\n## 摘要\n\n正文 [L01][L02][D01]。\n\n' + '汉'.repeat(600) + '\n' + tail, 'utf8')
  try {
    const r = run([CYCLE, proj, '--dry-run', '--baseline', join(proj, 'baseline.md')])
    const j = parseJson(r)
    assert.equal(j.targetConflict, false, '本夹具不得触发目标计算冲突（否则测不到「conflicts 为空」这条分支）')
    assert.equal(j.reconcileFailed, true, '不变量被破坏 → reconcileFailed 须为 true')
    const notes = (j.note || []).join('\n')
    assert.match(notes, /\[对账\].*引用标记多重集被改动/,
      '不变量违规须以 `[对账]` 前缀同文进 note（决定 exit 的清单必须出现在人读面）：' + JSON.stringify(j.note))
    assert.match(notes, /少 1 处/, 'note 里的读数须与 invariants.detail 同文（不得另写一套摘要）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B25-D2【核心】分节跌破硬指标 → 同文进 note；未动 → note 空（反向：不制造噪声）', () => {
  // ① 跌破侧：下限 1,000×6，§1 只有 686。
  const a = mkProj({ mins: [1000, 1000, 1000, 1000, 1000, 1000], counts: [686, 1000, 1000, 1000, 1000, 1000] })
  try {
    const j = parseJson(run([CYCLE, a.proj, '--dry-run']))
    assert.equal(j.reconcileFailed, true)
    const notes = (j.note || []).join('\n')
    assert.match(notes, /\[对账\].*实测 686 字 < 本节最小硬指标 1000 字/,
      '分节跌破须同文进 note：' + JSON.stringify(j.note))
  } finally { rmSync(a.d, { recursive: true, force: true }) }
  // ② 未动侧：目标抬到 10,000（> 下限和 6,000 ⇒ 两个分支都不触发）→ note 必须为空数组（不把「无冲突」写成噪声）。
  //   注：不能用「6,000 目标 + 下限和 6,000」当对照组——那恰好命中 `> target×0.95`（6,000 > 5,700）的
  //   「已顶满」分支（见 A1），note 非空是对的。对照组必须**两个分支都不触发**。
  const b = mkProj({ mins: [1000, 1000, 1000, 1000, 1000, 1000], counts: [1000, 1000, 1000, 1000, 1000, 1000], target: 10000 })
  try {
    const r = run([CYCLE, b.proj, '--dry-run'])
    const j = parseJson(r)
    assert.equal(j.reconcileFailed, false)
    assert.equal(j.targetConflict, false, '下限和 6,000 ≤ 10,000×1.05 ⇒ 不得记目标冲突')
    assert.equal(r.code, 0, '无违规须 exit 0，实得 ' + r.code + '：' + r.out.slice(0, 300))
    assert.deepEqual(j.note, [], '无冲突且无对账不通过时 note 须为空（旧实现此处为空是巧合，现在是判据）')
  } finally { rmSync(b.d, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// F 组：引用不变量必须是**多重集**（本批实测修正的实现侧缺陷）
// ─────────────────────────────────────────────────────────────────────────────
// 病灶：`extractCitations` 返回**逐处**（不去重）的数组、注释与 07 卡都写「多重集 / 两版完全一致」，
//   而比较端旧写 `baseCit.filter(x => !curCit.includes(x))` 是**集合**判据（只看「在不在」）。
//   两者在「同一编号出现多次」时不等价 → **删掉重复引用的其中一处**（压缩轮最常见的失效形态）
//   会被读成「未改动」。下面这条用例正是该形态：`[L02]` 在两版里**都还在**，只是少了一处。
test('B25-F1【反向】同一编号只剩一处（ID 未消失，只是少一处）→ 多重集判据须报；集合判据会放过', () => {
  const d = tmp('lunheng-b25-ms-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), mkOutline([500, 500, 500, 500, 500, 500]), 'utf8')
  const tail = '\n\n## 参考文献\n\n[L01] a\n[L02] b\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  // 目标：正文引 `[L01][D01]`；基线：正文引 `[L01][L02][D01]`。
  //   文末著录两版**都保留** `[L02]` ⇒ 两版引用**集合相等**（{L01,L02,D01}），只有**计数**差 1。
  writeFileSync(join(proj, 'final', '定稿.md'),
    '# 标题\n\n## 摘要\n\n正文 [L01][D01]。\n\n' + '汉'.repeat(600) + '\n' + tail, 'utf8')
  writeFileSync(join(proj, 'baseline.md'),
    '# 标题\n\n## 摘要\n\n正文 [L01][L02][D01]。\n\n' + '汉'.repeat(600) + '\n' + tail, 'utf8')
  try {
    // 先把「集合相等」这一前提钉死：否则本用例测的就不是多重集而是普通缺失。
    const cit = (p) => [...new Set((readFileSync(p, 'utf8').match(/\[(?:L|D|C|先)\d{1,3}\]/g) || []))].sort()
    assert.deepEqual(cit(join(proj, 'baseline.md')), cit(join(proj, 'final', '定稿.md')),
      '夹具前提：两版引用**集合**必须相等（只有计数不同），否则测不到多重集判据')
    const r = run([CYCLE, proj, '--dry-run', '--baseline', join(proj, 'baseline.md')])
    const j = parseJson(r)
    const v = j.invariants.violations.find((x) => x.id === 'inv-citations')
    assert.ok(v, '多重集判据须报「少 1 处」（集合判据在此为假绿——`[L02]` 两版都在）：'
      + JSON.stringify(j.invariants.violations.map((x) => x.id)))
    assert.match(v.detail, /少 1 处/, '计数差须为 1：' + v.detail)
    assert.match(v.detail, /\[L02\]/, '须点名是哪个编号少了一处：' + v.detail)
    assert.equal(r.code, 1, '多重集被改动须 exit 非 0')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// E 组：§一·2 的**算术**钉死（真实大纲的六章下限和）
// ─────────────────────────────────────────────────────────────────────────────
test('B25-E1 真夹具 §11 算术：850+1100+610+2960+1880+600 = 8000 = 目标（顶满 0.95 弹性线）', (t) => {
  const proj = XINGBIE
  const outline = proj ? join(proj, 'analysis', '分析大纲.md') : null
  if (!outline || !existsSync(outline)) {
    t.skip('真夹具不在本机 → 跳过')   // v19.6.1（P2-9）：同 C3
    return
  }
  // 逐字从大纲标题行取六章下限（不写死数字），再与「总和 = 8,000 = 目标」这一**实测事实**比对。
  const src = readFileSync(outline, 'utf8')
  const mins = [...src.matchAll(/^##\s*\d+\s*([^\n]*)$/gm)]
    .map((m) => /[（(]\s*预算\s*≥\s*(\d+)\s*字/.exec(m[1]))
    .filter(Boolean)
    .map((m) => Number(m[1]))
  assert.equal(mins.length, 6, '须解析出六章（H2 标题式真源），实得：' + JSON.stringify(mins))
  assert.equal(mins.reduce((s, n) => s + n, 0), 8000,
    '850+1100+610+2960+1880+600 = 8000（恰等于总目标 ⇒ 任两节略高于下限即超软上限）：' + JSON.stringify(mins))
  // 顶满判定：8,000 > 8,000 × 0.95 = 7,600（04 卡校验式的不满足侧）。
  assert.ok(8000 > Math.round(8000 * 0.95), '8,000 须顶满 0.95 弹性线（7,600）')
})
