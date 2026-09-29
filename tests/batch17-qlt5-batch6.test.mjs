// v18.54.0（QLT-5 实测反哺批次 6）**对账与自指**回归：F-BF / F-BG / F-BH / F-BI（+ 随批 EXEC-1 的锚点）
//
// 本批的主题是**「让消费者不必猜」**——前几批修的是读数（批次 1）、判据（批次 2/2b）、约定落点（批次 3）、
//   量具与配对键（批次 4）、尺与语义（批次 5）；本批修的是**呈现层与核对层的自洽**：
//     · F-BF①：裁定后**普通复跑**的进程码（机械值）≠ 报告里的裁定值 → 两个权威读数必须**都打出来**；
//     · F-BF②：随裁定写入的 `_t8_adjudicated_*` 留痕键**寿命须与 `_t8_conclusion` 同步**（旧版复跑即丢）；
//     · F-BG：**正文 ↔ 素材 的字段级一致性**此前无门覆盖（M-Fact-1 只比正文↔正文、M-Exist-3 只查编号是否存在）
//             → 并入 M-Fact-1（**不新增门项**，故 `total` 仍为 24）；
//     · F-BH：M-Form-8 的 detail 把「备注」与 severity 并排输出却不标谁是因 → 读者（含 LLM 主控）会就近归因；
//     · F-BI：EXEC-1 只改了硬检查、没改 detail 摘要标记 → 同一行同时输出「指纹✓」与「缺实值」（自相矛盾）。
//
// **每组都配反向控制组**（旧行为不得被放宽带走）：
//   · F-BG：正确年份**不得**报；素材里两说并存的编号（行内错误）**不得**报；素材缺失须**留痕**而非静默「通过」；
//   · F-BH：detail 变了，**severity 一个档都没动**；
//   · F-BI：有实值时必须仍判 ✓（不得因收紧而误杀合规稿）。
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'

const M = join(SCRIPTS, 'm-gate-check.mjs')
const END = '\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'

// 素材数据集：一行一条，`[D-CASE27]` 行与详情均为 2023；`[D-CASE28]` 行 2023 / 详情 2019（**行内错误**）
const DATASET = [
  '# 撤稿案例数据集',
  '',
  '| 编号 | 期刊 | 出版商 | 学科 | 发表年 | 撤稿年 | 延迟(月) | 撤稿原因 | AI 涉入 | URL |',
  '|---|---|---|---|---|---|---|---|---|---|',
  '| [D-CASE27] | ESPR | Springer Nature | 工程/环境 | 2023 | 2024 | 12 | 术语污染 | 未明确 | https://doi.org/10.1007/s11356-023-27703-w |',
  '| [D-CASE28] | ESPR | Springer Nature | 工程/环境 | 2023 | 2024 | 12 | 术语污染 | 未明确 | https://doi.org/10.1007/s11356-019-04752-8 |',
  '',
  '### [D-CASE27] NH3-SCR NOx 综述（ESPR, 2023）',
  '',
  '### [D-CASE28] 巴基斯坦道路交通事故（ESPR, 2019）',
  '',
].join('\n')

/** 造最小 project：**必须放在 `<d>/final/` 下**，否则 `ctx.projectRoot = dirname(dirname(draft))` 解析错，
 *  F-BG 就找不到 `data/…`（首版即踩此坑，见用例注释）。`withData` 为真时写入 `data/撤稿案例数据集.md`。 */
const mkCase = (abstractBody, bodySection, { withData = true } = {}) => {
  const d = tmp()
  const ev = join(d, 'final', '证据包')
  mkdirSync(ev, { recursive: true })
  if (withData) {
    mkdirSync(join(d, 'data'), { recursive: true })
    writeFileSync(join(d, 'data', '撤稿案例数据集.md'), DATASET)
  }
  const draft = join(d, 'final', '定稿.md')
  writeFileSync(draft, `# 标题\n\n## 摘要\n\n${abstractBody}\n\n## 一、正文\n\n${bodySection}\n` + END)
  return { d, draft, ev }
}
const factOf = ({ d, draft, ev }) => {
  const rep = join(d, 'r.json')
  run([M, draft, ev, '--report', rep])
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  return { item: (j.results || []).find((r) => /M-Fact-1/.test(r.gate)), total: j.total }
}

// ── F-BG：正文 ↔ 素材 字段级一致性（并入 M-Fact-1） ──────────────────────────────

test('F-BG：正文年份与素材不符 → M-Fact-1 报（P1）；**正确年份与「素材两说并存」都不得报**', () => {
  // ① 正向：`[D-CASE27]` 素材三处均指 2023，正文写 2019 → 必报
  let c = mkCase('本文样本取自公开撤稿记录，共 30 例。', '该论文 2019 年发表 [D-CASE27]，后因术语污染被撤。')
  let { item, total } = factOf(c)
  assert.ok(item, 'M-Fact-1 必须出现在结果里')
  assert.equal(item.pass, false, '正文年份与素材不符必须报：' + item.detail)
  assert.equal(item.severity, 'P1', '非摘要/结论节 → P1')
  assert.ok(item.materialConflicts && item.materialConflicts.length === 1, '须给出 materialConflicts 供 T7 读：' + JSON.stringify(item.materialConflicts))
  // ⚠️ **不钉死行号**：行号取决于夹具的换行布局（首版写死 7 → 实测 9）。要钉的是「给了行号 + 给了句子」。
  assert.ok(Number.isInteger(item.materialConflicts[0].line) && item.materialConflicts[0].line > 0, '须给出正整数的正文行号')
  assert.match(item.materialConflicts[0].sentence, /\[D-CASE27\]/, '须回引原句，供人核对')
  assert.match(item.materialConflicts[0].bad.join(' '), /2023/, '须给出素材侧的允许值')
  assert.equal(total, 24, `并入 M-Fact-1 而非新增门项 → total 仍为 24：实测 ${total}`)
  rmSync(c.d, { recursive: true, force: true })

  // ② 反向控制：正确年份 → 不得报
  c = mkCase('本文样本取自公开撤稿记录，共 30 例。', '该论文 2023 年发表 [D-CASE27]，后因术语污染被撤。')
  assert.equal(factOf(c).item.pass, true, '[D-CASE27]=2023 与素材一致，不得报')
  rmSync(c.d, { recursive: true, force: true })

  // ③ 反向控制：素材里两说并存的编号（行 2023 / 详情 2019）→ 两边都不报（两个值在素材里都有依据）
  c = mkCase('本文样本取自公开撤稿记录，共 30 例。', '该论文 2019 年发表 [D-CASE28]，后因术语污染被撤。')
  assert.equal(factOf(c).item.pass, true, '2019 在 [D-CASE28] 的素材年份集合内（详情口径），不得报')
  rmSync(c.d, { recursive: true, force: true })
})

test('F-BG：素材缺失 → **留痕**而非静默「通过」（未执行必须可见）', () => {
  const c = mkCase('本文样本取自公开撤稿记录，共 30 例。', '该论文 2019 年发表 [D-CASE27]，后因术语污染被撤。', { withData: false })
  const { item } = factOf(c)
  assert.ok(item, 'M-Fact-1 必须在场')
  assert.equal(item.pass, true, '无素材文件时不判失败（不猜）')
  assert.ok(item.materialSkipped, '必须带 materialSkipped 留痕：' + item.detail)
  assert.match(item.detail, /未执行/, 'detail 须写明「未执行」——与「核过且无问题」不可同形')
  rmSync(c.d, { recursive: true, force: true })
})

test('F-BG：跨句不配（同一句才判）——年份写在另一句不得误报', () => {
  const c = mkCase('本文样本取自公开撤稿记录，共 30 例。', '该论文发表于 2019 年。素材编号为 [D-CASE27]。')
  assert.equal(factOf(c).item.pass, true, '编号与年份不同句 → 不配（防错配到别的编号上）')
  rmSync(c.d, { recursive: true, force: true })
})

// ── F-BH：M-Form-8 的 detail 必须自证「谁是档位依据」 ──────────────────────────────

test('F-BH：M-Form-8 detail 含「档位依据」，且**severity 不受影响**', () => {
  const c = mkCase('摘要在此，仅一句。', '正文一段没有任何引用标记的长段落，用于触发三段判定。')
  const rep = join(c.d, 'r.json')
  run([M, c.draft, c.ev, '--report', rep])
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  const it = (j.results || []).find((r) => /M-Form-8/.test(r.gate))
  assert.ok(it, 'M-Form-8 必须在场')
  assert.match(it.detail, /档位依据：/, 'detail 必须显式标出档位依据：' + it.detail)
  assert.match(it.detail, /只有本项决定档位/, '须明写其余观察不参与档位判定')
  assert.ok(['P0', 'P1', 'P2', '通过'].includes(it.severity), 'severity 仍是既有四值之一（本项只改文案）')
  rmSync(c.d, { recursive: true, force: true })
})

// ── F-BF②：随裁定写入的留痕键必须与 `_t8_conclusion` 同寿 ─────────────────────────

/** 「无红线」夹具（**逐字沿用 `adjudicate.test.mjs` 的 `mkClean` 形态**，已实测机械 exit=1 且 red=[]）。
 *  ⚠️ 不能自己造「最小稿」：那会命中硬红线（M-Exist-1 / M-Integrity-1）→ 裁定被**正当拒绝**（exit 30），
 *  F-BF 的两条都验不到（首版即踩此坑）。 */
const mkClean = () => {
  const dir = tmp('lunheng-b6-')
  const fin = join(dir, 'final'); const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(dir, '01-任务简报.md'), '# 任务简报\n\n## 研究问题（主控拆解，3-5 个子问题）\n\n1. 子问题一？\n2. 子问题二？\n3. 子问题三？\n\n## 数据需求\n\n- 需找数据点：≥1 条\n')
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n摘要正文 [L01] [L02] [L03] [D01]。\n\n## 一、论证\n\n正文论述 [L01] [L02] [L03] [D01] [C01] [先01]。\n\n## 参考文献\n\n- [L01] 作者甲. 题名[J]. 刊, 2024.\n- [L02] 作者乙. 题名[J]. 刊, 2023.\n- [L03] 作者丙. 题名[J]. 刊, 2022.\n\n## 数据来源\n\n- [D01] 机构 2024\n\n## 案例来源\n\n- [C01] 案例\n\n## 先行者文献\n\n- [先01] 甲. 题名[M]. 2023.（完整著录详见参考文献 [L01]）\n\n## AI 使用声明\n\n- AI。\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [D01] | 值 | 论点1 |\n\n[D01] y | 机构 | 2024 | url\n      ├ 信任级别：已发布\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n> 总条数 3 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [L01] | 综述 | 论点1 |\n| [L02] | 机制 | 论点1 |\n| [L03] | 数据 | 论点1 |\n\n[L01] 作者甲. 题名[J]. 刊, 2024.\n      ├ 信任级别：已发布\n\n[L02] 作者乙. 题名[J]. 刊, 2023.\n      ├ 信任级别：已发布\n\n[L03] 作者丙. 题名[J]. 刊, 2022.\n      ├ 信任级别：已发布\n')
  writeFileSync(join(ev, '案例卡.md'), '# 案例卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [C01] | 案例 | 论点1 |\n\n[C01] 某案例\n      ├ 信任级别：已发布\n')
  return { dir, draft: join(fin, '定稿.md'), ev, report: join(fin, 'M-Gate-Report.json') }
}
const FOUR = '① 逐条枚举：M-Form-11 属格式严格度；② 真阳性扫描：全稿无对应硬缺陷；③ 规范冲突说明：与机检契约不冲突；④ 独立复核来源：T7 审计复核'

test('F-BF②：裁定写入的 `_t8_adjudicated_*` 在**普通复跑后仍保留**（旧版复跑即丢）', () => {
  const f = mkClean()
  try {
    run([M, f.draft, f.ev, '--report', f.report])
    const adj = join(f.dir, 't8.json')
    writeFileSync(adj, JSON.stringify({ true_p0: 0, true_p1: 0, verdict: 'Pass（T8 裁定）', llm_review: FOUR }, null, 2))
    const ra = run([M, f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
    assert.equal(ra.code, 0, '裁定后进程码应为裁定值 0：' + ra.out + ra.err)
    const after1 = JSON.parse(readFileSync(f.report, 'utf8'))
    assert.ok(after1._t8_adjudicated_at, '裁定当次须写 _t8_adjudicated_at')
    assert.ok(after1._t8_adjudicated_by, '裁定当次须写 _t8_adjudicated_by')
    assert.equal(after1.exit, 0, '裁定值应被采纳')
    assert.equal(after1.script_exit_raw, 1, '机械原值须另存')

    // **普通复跑**（不带 --adjudicate）
    run([M, f.draft, f.ev, '--report', f.report])
    const after2 = JSON.parse(readFileSync(f.report, 'utf8'))
    assert.ok(after2._t8_adjudicated_at, 'F-BF② 回归锚点：普通复跑**不得**丢弃 _t8_adjudicated_at（与 _t8_conclusion 同寿）')
    assert.ok(after2._t8_adjudicated_by, 'F-BF② 回归锚点：普通复跑**不得**丢弃 _t8_adjudicated_by')
    assert.equal(after2.exit, 0, '同一正文上既有裁定仍有效')
    assert.equal(after2.verdict_stale, false, '既有裁定未过期')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

// ── F-BF①：非裁定复跑时，「进程码 / 报告裁定值」两个数都要打出来 ────────────────────

test('F-BF①：非裁定复跑且两值不同时，stderr 须同时给出机械值与裁定值', () => {
  const f = mkClean()
  try {
    run([M, f.draft, f.ev, '--report', f.report])
    const adj = join(f.dir, 't8.json')
    writeFileSync(adj, JSON.stringify({ true_p0: 0, true_p1: 0, verdict: 'Pass（T8 裁定）', llm_review: FOUR }, null, 2))
    run([M, f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
    const r2 = run([M, f.draft, f.ev, '--report', f.report])
    const report = JSON.parse(readFileSync(f.report, 'utf8'))
    // 夹具实测：机械值 1 / 裁定值 0 → 两值不同，二义必然存在
    assert.notEqual(report.exit, report.script_exit_raw, '夹具应构成「裁定值 ≠ 机械值」')
    assert.equal(r2.code, report.script_exit_raw, '非裁定复跑的**进程码** = 本次机械值（这是要披露的那个数）')
    assert.match(r2.stderr, /非裁定复跑/, 'stderr 须标明本次是「非裁定复跑」：' + r2.stderr.slice(0, 400))
    assert.match(r2.stderr, /进程退出码/, 'stderr 须给出本次进程码')
    assert.match(r2.stderr, /有效裁定值/, 'stderr 须给出报告中的有效裁定值')
    assert.match(r2.stderr, /报告/, 'stderr 须指明「判定放行与否以报告为准」')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

// ── F-BI：EXEC-1 的判据必须只有一个出口（不得「摘要说✓、结论说缺」） ────────────────

test('F-BI：交付说明指纹段只有旧占位符 → M-Exist-7 detail **不得**同时出现「指纹✓」与「缺实值」', () => {
  const d = tmp()
  const ev = join(d, '证据包')
  mkdirSync(ev, { recursive: true })
  const hashes = Array.from({ length: 12 }, (_, i) => `${'a'.repeat(8)}${String(i).padStart(4, '0')}`)
  writeFileSync(join(ev, 'manifest.json'), JSON.stringify({ files: hashes.map((h) => ({ sha256: h })) }))
  const draft = join(d, '定稿.md')
  writeFileSync(draft, `# 标题\n\n## 摘要\n\n摘要一句。\n\n## 一、正文\n\n正文一段。\n` + END)
  // 交付说明：12 固定字段齐备，但 §9 只有**旧占位符**
  const SECTIONS = [
    '## 1. 路径', '## 2. 图件清单', '## 3. 遗留风险', '## 4. 人工核验项',
    '## 5. 数据溯源 check-list', '## 6. 成本指标', '## 7. 建议 merge 的反哺清单',
    '## 8. AI 使用披露（完整版）', '## 9. 证据包指纹', '## 10. 投稿就绪检查表',
    '## 11. 主人决策记录', '## 12. 终检结论',
  ]
  const body = SECTIONS.map((s) => {
    if (s.includes('9.')) return `${s}\n\n- **sha256**：\`[哈希校验待主人回填]\``
    if (s.includes('6.')) return `${s}\n\n- token：~5M`
    return `${s}\n\n- 内容`
  }).join('\n\n')
  writeFileSync(join(d, '交付说明.md'), `# 交付说明\n\n${body}\n`)
  const rep = join(d, 'r.json')
  run([M, draft, ev, '--report', rep])
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  const it = (j.results || []).find((r) => /M-Exist-7/.test(r.gate))
  assert.ok(it, 'M-Exist-7 必须在场')
  assert.equal(it.pass, false, '占位符已废止 → 须报硬问题：' + it.detail)
  assert.match(it.detail, /实值/, '硬问题文案须点明「实值」')
  assert.ok(!/证据包指纹✓/.test(it.detail), 'F-BI 回归锚点：只有占位符时**不得**同时输出「证据包指纹✓」（旧版自相矛盾）：' + it.detail)
  assert.match(it.detail, /证据包指纹✗/, '摘要标记须与硬检查同口径（✗）')
  rmSync(d, { recursive: true, force: true })
})
