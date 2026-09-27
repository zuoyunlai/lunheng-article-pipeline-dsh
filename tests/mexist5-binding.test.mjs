// v18.12.0（2026-09-25 全量审计第二梯队）：**M-Exist-5 的绑定对账**回归。
//
// 教训（审计四路各自的实测，均在本机已交付项目上复现）：M-Exist-5 是两道主控闸门（T2.5/T7.5）
//   **唯一**的机械检查项，而它对 T7.5 的检查此前由五条互不重叠的空洞构成：
//     ① 模板项列表恒空（L-54：模板解析循环的 `break` 退出整个扫描 → T7.5 段永不解析）；
//     ② 实据列只做**语法匹配**（L-22：15 行全填伪造 `exit 0` 也判「实据为机械证据」）；
//     ③ 结论词不与实据**对账**（L-03：用 `exit=2` 的实据标 ✓ 照样过）；
//     ④ 对账被「**全行皆 ✓**」守卫（L-02：写一行 ✗ 或 N/A 即整段跳过——三个真实项目全部绕过）；
//     ⑤ 必写的交接门 exit 从不检查（L-10：规则写着「不写 = 判 P1」，20 个项目只有 1 个真跑过）。
//   本文件锁「修好之后门真的会红」——①③④⑤ 各一条负向用例，另加 L-04/L-44 的判定口径。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

/** 造一个「T7.5 已就绪」的最小项目：draft + 证据包 + audits 闸门记录 + final/M-Gate-Report.json */
const mkProject = ({ t75Rows, report = { script_exit_raw: 2, exit: 2 }, withT25 = true, handoff = true }) => {
  const dir = tmp('lunheng-mexist5-')
  const fin = join(dir, 'final'); const ev = join(fin, '证据包'); const au = join(dir, 'audits')
  mkdirSync(ev, { recursive: true }); mkdirSync(au, { recursive: true })
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文 [L01] [D01]。\n\n## 参考文献\n\n- [L01] x\n\n## 数据来源\n\n- [D01] y\n\n## 案例来源\n\n- [C01] z\n\n## 先行者文献\n\n- [先01] w\n\n## AI 使用声明\n\n- AI。\n')
  writeFileSync(join(au, '审计报告-v1.md'), '# 审计报告\n\n## 结论\n\n通过\n')
  writeFileSync(join(fin, 'M-Gate-Report.json'), JSON.stringify(report, null, 2))
  const handoffEv = handoff ? 'handoff-check --role T7 → exit 0' : 'exit 0'
  if (withT25) {
    // 模板 T2.5 段的全 8 项（缺项会被 L-54 修好的「模板为真源，逐项都要有行」判 P0）
    writeFileSync(join(au, '闸门记录-T2.5.md'), [
      '# 阶段闸门记录 — T2.5', '',
      '| 检查项 | 实据（路径 / exit code / 命令） | 结论 | 失败原因 |',
      '|---|---|---|---|',
      '| 数据卡文件存在 | data/数据卡.md | ✓ | |',
      `| 数据条目数（双格式并集去重） | ${handoffEv} | ✓ | |`,
      '| 任务简报数据需求总数 | 01-任务简报.md §研究问题 | ✓ | |',
      '| 数据条目数 ≥ 需求总数 | 35 ≥ 30 | ✓ | |',
      '| 信任级别完整性（M-Form-6） | m-gate-check.mjs → M-Form-6 通过 | ✓ | |',
      '| 引用闭环（M-Exist-3：[Dxx] 正文 ↔ 数据卡条目） | m-gate-check.mjs → M-Exist-3 通过 | ✓ | |',
      '| 数据卡头部声明 vs 实际计数 | data/数据卡.md 头部 35 == 实际 35 | ✓ | |',
      '| 证据包哈希占位符（可选验证） | final/交付说明.md 含占位符 | ✓ | |',
      '',
    ].join('\n'))
  }
  writeFileSync(join(au, '闸门记录-T7.5.md'), [
    '# 阶段闸门记录 — T7.5', '',
    '| 检查项 | 实据（路径 / exit code / 命令） | 结论 | 失败原因 |',
    '|---|---|---|---|',
    ...t75Rows.map((r) => `| ${r.item} | ${r.ev} | ${r.res} | ${r.why || ''} |`),
    '',
  ].join('\n'))
  return { dir, draft, ev }
}

const m5 = (dir, draft, ev) => {
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev])
  const it = parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-5'))
  return { r, it, j: parseJson(r) }
}

// 模板 T7.5 段的全 7 项（缺项即 P0 —— L-54 修好的「模板为真源，逐项都要有行」）
// v18.12.0（L-33）：另加一行**战略门留痕**——本批起 M-Exist-5 要求 T7.5 记录给出
//   `structure-check` / `methodology-check` / `cite-coverage` 三者的 exit（缺 → P1/P2）。
//   这一行不是模板项，而是该门的**独立判据**（见 mexist-gates.mjs 的 STRATEGY_GATES）。
const STRATEGY_ROW = { item: '战略门预检（T7 必跑三件）', ev: 'structure-check exit 0 / methodology-check exit 0 / cite-coverage exit 0', res: '✓' }
const FULL_T75 = (extra = []) => [
  { item: '审计报告最新版存在', ev: 'audits/审计报告-v1.md', res: '✓' },
  { item: 'P0/P1 清单已列', ev: 'audits/审计报告-v1.md §修订任务书', res: '✓' },
  { item: 'M 门全部 exit 0', ev: 'm-gate-check.mjs → exit 0', res: '✓' },
  { item: '证据包指纹占位符', ev: 'final/交付说明.md 含占位符', res: '✓' },
  { item: '引用闭环（M-Exist-3：[Dxx] 正文 ↔ 数据卡条目）', ev: 'm-gate-check.mjs → M-Exist-3 通过', res: '✓' },
  { item: '论文交付物 vs 报告独立隔离', ev: 'final/定稿.md 无交接报告混入', res: '✓' },
  { item: '修订轮由独立写手执行', ev: 'audits/审计报告-v1.md 记录 T5 子代理', res: '✓' },
  STRATEGY_ROW,
  ...extra,
]

// v18.12.0（L-33）回归：三个战略门脚本的留痕判据（零留痕 P1 / 部分 P2 / 无 exit P2）
//   注意：这几条用 `report.exit = 0`（默认夹具的 2 会额外触发两条 M 门对账 P0，把 severity 抬到 P0——
//   那两条是别的判据，会掩盖本判据的档位）。故本组断言看**判据文本**与计数，severity 另按需看。
test('L-33：T7.5 记录零留痕三个战略门脚本 → 判「完全未提」（P1 档）', () => {
  const rows = FULL_T75().filter((r) => r.item !== STRATEGY_ROW.item)
  const { dir, draft, ev } = mkProject({ t75Rows: rows, report: { script_exit_raw: 0, exit: 0 } })
  try {
    const { it } = m5(dir, draft, ev)
    assert.equal(it.pass, false, '零留痕不得判通过')
    assert.match(String(it.detail), /完全未提/, 'detail 须点名「完全未提」')
    assert.match(String(it.detail), /战略门留痕 0\/3/, 'detail 须给出 0/3 计数')
    assert.equal(it.severity, 'P1', '唯一硬问题时应正好是 P1：' + JSON.stringify(it))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-33：只提 1/3 个战略门脚本 → P2 软提示并点名缺谁', () => {
  const rows = FULL_T75().map((r) => (r.item === STRATEGY_ROW.item ? { ...r, ev: 'structure-check exit 0' } : r))
  const { dir, draft, ev } = mkProject({ t75Rows: rows, report: { script_exit_raw: 0, exit: 0 } })
  try {
    const { it } = m5(dir, draft, ev)
    assert.match(String(it.detail), /战略门留痕 1\/3/)
    assert.match(String(it.detail), /methodology-check/, '须点名缺哪两个')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-33：提了三个但不给 exit → P2（名字出现不算留痕，须紧跟 exit N）', () => {
  const rows = FULL_T75().map((r) => (r.item === STRATEGY_ROW.item
    ? { ...r, ev: 'structure-check / methodology-check / cite-coverage 已跑' } : r))
  const { dir, draft, ev } = mkProject({ t75Rows: rows, report: { script_exit_raw: 0, exit: 0 } })
  try {
    const { it } = m5(dir, draft, ev)
    assert.equal(it.pass, false, '缺 exit 不得判通过')
    assert.match(String(it.detail), /未给 exit/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-33 对照：三个齐全且各带 exit → 不再报（3/3）', () => {
  const { dir, draft, ev } = mkProject({ t75Rows: FULL_T75(), report: { script_exit_raw: 0, exit: 0 } })
  try {
    const { it } = m5(dir, draft, ev)
    assert.match(String(it.detail), /战略门留痕 3\/3/)
    assert.doesNotMatch(String(it.detail), /完全未提|未给 exit|只提到/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-54：T7.5 记录缺模板要求的检查项 → 必须报（旧版因模板解析被 break 中断而空转通过）', () => {
  const { dir, draft, ev } = mkProject({ t75Rows: [{ item: '自造项', ev: 'exit 0', res: '✓' }] })
  try {
    const { it } = m5(dir, draft, ev)
    assert.equal(it.pass, false, '检查项缺项必须判失败：' + JSON.stringify(it))
    assert.match(String(it.detail), /检查项缺/, 'detail 应指出缺哪些模板项')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-22：实据里的 exit 与报告机械值不符 → P0（旧版只看字符串像不像证据）', () => {
  const { dir, draft, ev } = mkProject({
    t75Rows: FULL_T75().map((r) => (r.item.startsWith('M 门') ? { ...r, ev: 'm-gate-check.mjs → exit 0' } : r)),
    report: { script_exit_raw: 2, exit: 2 },
  })
  try {
    const { it } = m5(dir, draft, ev)
    assert.equal(it.pass, false)
    assert.equal(it.severity, 'P0', '实据与产物不符应判 P0：' + JSON.stringify(it))
    assert.match(String(it.detail), /实据与产物不符|自相矛盾/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-02：记录里有 ✗ 行时，M 门行对账**仍须执行**（旧版「全行皆 ✓」守卫会整段跳过）', () => {
  const { dir, draft, ev } = mkProject({
    t75Rows: [
      ...FULL_T75().slice(0, 3),
      { item: '某软项', ev: 'exit 0', res: '✗', why: '已知缺口，走局限性' },
      { item: '证据包指纹占位符', ev: 'final/交付说明.md 含占位符', res: '✓' },
    ],
    report: { script_exit_raw: 2, exit: 2 },
  })
  try {
    const { it } = m5(dir, draft, ev)
    assert.equal(it.pass, false, '有 ✗ 行不构成「跳过对账」的理由：' + JSON.stringify(it))
    assert.equal(it.severity, 'P0')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-04：T8 裁定段写 true_p0_count/true_p1_count（实战字段名）也应被承认 → 不再误报矛盾', () => {
  // 实据如实写**机械值** exit=3，T8 就本版正文裁定为 0 → 门应承认裁定、不得判 P0
  const { dir, draft, ev } = mkProject({
    t75Rows: FULL_T75().map((r) => (r.item.startsWith('M 门') ? { ...r, ev: 'm-gate-check.mjs → exit 3（T8 裁定 0）' } : r)),
    report: {
      script_exit_raw: 3, exit: 0, verdict_stale: false,
      _t8_conclusion: { true_p0_count: 0, true_p1_count: 0, verdict: 'Pass' },
    },
  })
  try {
    const { it } = m5(dir, draft, ev)
    assert.notEqual(it.severity, 'P0', '干净裁定不得被判矛盾（P0）：' + JSON.stringify(it))
    assert.equal(it.pass, true, '干净裁定 + 模板项齐备 → 应放行：' + JSON.stringify(it))
    assert.match(String(it.detail), /已按 T8 裁定段放行/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-44：命中硬 P0 红线时 T8 裁定**不得**用于放行', () => {
  const { dir, draft, ev } = mkProject({
    t75Rows: FULL_T75(),
    report: {
      script_exit_raw: 2, exit: 0, verdict_stale: false,
      hard_red_line_hits: ['M-Form-2(P0)'],
      _t8_conclusion: { true_p0: 0, true_p1: 0, verdict: 'Pass' },
    },
  })
  try {
    const { it } = m5(dir, draft, ev)
    assert.equal(it.pass, false, '红线命中时裁定不生效：' + JSON.stringify(it))
    assert.equal(it.severity, 'P0')
    assert.match(String(it.detail), /红线|自相矛盾/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-10：两份闸门记录都没写 handoff-check 的 exit → 记**备注**（`noteBits`，**不改 pass**），且文案给出闭合动作', () => {
  // ⚠️ 夹具要让**相邻规则保持安静**：M 门行实据写 `exit 0` → 报告机械值必须也是 0，
  //    否则「实据与产物不符」那条 P0 会顶上来，把本条要测的 noteBits 静默性掩盖掉（首版即踩此坑）。
  const { dir, draft, ev } = mkProject({ t75Rows: FULL_T75(), handoff: false, report: { script_exit_raw: 0, exit: 0 } })
  try {
    const { it } = m5(dir, draft, ev)
    assert.match(String(it.detail), /handoff/, 'detail 应点名 handoff-check 缺失：' + JSON.stringify(it))
    // v18.42.0（主人裁定「B」= 路径 ②，保持软档）：把「软」这件事**钉住**——
    //   旧断言只查 `/handoff/` 出现（太弱：把 noteBits 改成 findings 也照样通过，等于静默转硬）。
    assert.equal(it.pass, true, 'noteBits **不得**改变 pass——它是可见性提示，不是判负：' + JSON.stringify(it))
    assert.equal(it.severity, '通过', 'noteBits 不得抬 severity（否则「保持软档」这句话就是假的）：' + it.severity)
    // 判据要精确到**段落标记**：detail 的硬问题段以「硬问题：」开头——若只查 `/硬问题/` 这个裸词，
    //   本条自己的文案里解释缘由时提到「硬问题」就会把断言逼成假的（首版即如此）。
    assert.doesNotMatch(String(it.detail), /硬问题：/, '本条不得出现在硬问题段（该段以「硬问题：」起）')
    // 软档的**闭合动作**必须写在文案里（路径 ② 的要求：把触发条件与闭合方式写进软提示）
    assert.match(String(it.detail), /闭合动作/, '软提示必须给出闭合动作，否则读者只知道「缺」而不知道怎么闭合')
    assert.match(String(it.detail), /handoff-check --role Tn → exit N/, '闭合动作须含**可照抄**的实据写法')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// v18.42.0：本批的核心结论是一个**结构性限制**，必须被测试钉住，否则后来者会「顺手把这一行加进模板」
//   而不知道那是静默收紧：
//     · M-Exist-5 的检查项清单**从模板表派生**（「模板为真源，逐项都要有行」）→ **给模板加一行 = 收紧**；
//     · 实测（2026-09-27，22 个项目）：加行会让 9/10 个项目新增「缺行」硬问题、1 个跨档（只加 T7.5 表仍有 7/10）。
//   故本条断言「模板的 T2.5/T7.5 **表行**里不得出现 handoff/交接门」——要加表行，必须先请主人裁定（代价已量清，
//   登记在 `maintainers.md` §九）。**注意**：模板**散文**（blockquote）里给出的示例行**不算**检查项，
//   那是本批「散文层可达化」的落点，下面一条用例单独守卫它。
test('v18.42.0 钉子：闸门记录模板的**检查项表**不得含 handoff 行（加表行 = 静默收紧存量）', () => {
  const tpl = readFileSync(join(SCRIPTS, '..', 'references', 'templates', '闸门记录-template.md'), 'utf8').split('\n')
  // 复刻 m-gate-check 的收集语义：按 `## T2.5` / `## T7.5` 分节；进入表后遇到非 `|` 行 → 本节收集结束
  const items = { 'T2.5': [], 'T7.5': [] }
  let cur = null; let inTable = false; let done = false
  for (const l of tpl) {
    const h = l.match(/^#{2,4}\s*(T2\.5|T7\.5)\b/)
    if (h) { cur = h[1]; inTable = false; done = false; continue }
    if (/^#{2,4}\s/.test(l)) { cur = null; inTable = false; done = false; continue }
    if (!cur || done) continue
    if (!/^\s*\|/.test(l)) { if (inTable) done = true; continue }
    inTable = true
    if (!/检查项|^检查$/.test(l)) items[cur].push(l)
  }
  for (const [sec, rows] of Object.entries(items)) {
    assert.ok(rows.length >= 5, `${sec} 段应能解析出模板检查项（实测 ${rows.length} 行）——解析口径断了，本钉子会真空通过`)
    assert.equal(
      rows.filter((r) => /handoff|交接门/i.test(r)).length,
      0,
      `${sec} 的检查项表里出现了 handoff 行。**加这一行 = 一次静默收紧**：M-Exist-5 按「模板为真源，逐项都要有行」对账，`
        + '实测（2026-09-27）会让 9/10 个项目新增「缺行」硬问题、1 个跨档（只加 T7.5 表仍有 7/10）。'
        + '若确要收，先请主人裁定（代价已量清，见 `references/maintainers.md` §九），再改本断言。'
        + '散文层已给出可照抄的示例行——那是零代价的可达化路径。',
    )
  }
})

test('v18.42.0：模板**散文**里的示例行不得被当成检查项（合规记录仍须通过）', () => {
  const tplPath = join(SCRIPTS, '..', 'references', 'templates', '闸门记录-template.md')
  const tpl = readFileSync(tplPath, 'utf8')
  assert.match(tpl, /交接门 handoff-check exit/, '模板散文应保留可照抄的示例行（散文层可达化的落点）')
  // 端到端复核：模板带这段散文时，一项不缺的合规记录**仍须通过**（若示例行被收成模板项，
  //   「逐项都要有行」会立刻报「检查项缺「交接门 handoff-check exit」」→ 该用例红）。
  const { dir, draft, ev } = mkProject({
    t75Rows: FULL_T75([{ item: '交接门 handoff-check exit', ev: 'handoff-check --role T7 → exit 0', res: '✓' }]),
    report: { script_exit_raw: 0, exit: 0 },
  })
  try {
    const { it } = m5(dir, draft, ev)
    assert.equal(it.pass, true, '合规记录（含 handoff 行）应通过：' + JSON.stringify(it))
    assert.doesNotMatch(String(it.detail), /检查项缺「交接门/, '模板散文里的示例行不得被收成检查项')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('正向：模板项齐备 + 实据真实 + 报告 exit 0 → M-Exist-5 通过', () => {
  const { dir, draft, ev } = mkProject({
    t75Rows: FULL_T75(),
    report: { script_exit_raw: 0, exit: 0 },
  })
  try {
    const { it } = m5(dir, draft, ev)
    assert.equal(it.pass, true, '合规闸门记录应通过：' + JSON.stringify(it))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-44：m-gate-check 报告新增 hard_red_line_hits 字段（非空即红线命中）', () => {
  const dir = tmp('lunheng-redline-')
  try {
    const fin = join(dir, 'final'); const ev = join(fin, '证据包')
    mkdirSync(ev, { recursive: true })
    const draft = join(fin, '定稿.md')
    // 缺「案例来源」→ M-Form-2 红线
    writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n- [L01] x\n\n## 数据来源\n\n- [D01] y\n\n## 先行者文献\n\n- [先01] w\n\n## AI 使用声明\n\n- AI。\n')
    writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n```\n[D01] y ｜ 主题 ｜ 论点1\n```\n\n[D01] y | 机构 | 2024 | url\n      ├ 信任级别：已发布\n')
    writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n```\n[L01] x ｜ 论点1\n```\n\n[L01] 作者. 题名[J]. 刊, 2024.\n      ├ 信任级别：已发布\n')
    const j = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev]))
    const hits = j.hard_red_line_hits
    assert.ok(Array.isArray(hits), 'report 必须含 hard_red_line_hits 数组')
    assert.ok(hits.length > 0, '缺「案例来源」应命中 M-Form-2 红线，实际：' + JSON.stringify(hits))
    assert.ok(hits.some((h) => /M-Form-2/.test(h)), '红线命中项应含 M-Form-2：' + JSON.stringify(hits))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
