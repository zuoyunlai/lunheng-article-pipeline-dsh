// 批 29（v19.21.0）：实战反哺「插件级 v1」的机制面回归（2026-10-20）
//
// 逐条钉住本次修订的**判据本身**（不是复述实现）：
//   §1  markdown 装饰 / 排版前缀 → `stripMcDecor` 统一归一化（`§5 引言` / `## 6. 修订任务书` / `**sha256**`）；
//   §3  通知单门（P2.5/P3.5）与 A7 回执账本的结构性互斥 → 只核 §6 五字段，不核回执；
//   §4  编号正则支持双连字符（`P1-D-1`）→ 任务书 ↔ 复核报告不再结构性失配；
//   §6  正文内联 `[图3]`（引用）不再被当作图位声明；
//   §7  「≥5000」是档位下限，不是点目标（`parseTargetChars` 返回 null + 明示原因）；
//   §8  方法面 `--genre measure-calc` 对抽样统计向判据记 N/A（不再制造 P0 免责声明压力）；
//   §9  轮次账本按**表头列名**解析（7 列 + 反引号路径也能正确取到 正文版本 / 复核报告）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCRIPTS, run, parseJson, tmp, mkProject } from './_fixtures.mjs'

const imp = (rel) => import(pathToFileURL(join(SCRIPTS, rel)).href)
const { stripMcDecor, titleMatches } = await imp('_lib/sections.mjs')
const { parseLedger, appendLedgerRow } = await imp('_lib/round-ledger.mjs')
const { parseTargetChars, parseTargetCandidates } = await imp('_lib/target-chars.mjs')
const { mExist4, mExist7 } = await imp('_lib/mgate-gates/mexist-gates.mjs')
const { mExist5 } = await imp('_lib/mgate-gates/mexist-gates.mjs')

const H = () => join(SCRIPTS, 'handoff-check.mjs')
const METH = () => join(SCRIPTS, 'methodology-check.mjs')

// ─────────────────────────────────────────────────────────────────────────────
// §1 装饰归一化
// ─────────────────────────────────────────────────────────────────────────────
test('§1：`§5 引言` / `## 6. 修订任务书` / `**修订任务书**` 与裸标题等价', () => {
  assert.equal(titleMatches('§5 引言', '引言'), true, '§ 前缀必须可识别')
  assert.equal(titleMatches('5. 引言', '引言'), true, '数字序号必须可识别')
  assert.equal(titleMatches('五、引言', '引言'), true, '中文序号必须可识别')
  assert.equal(titleMatches('**修订任务书**', '修订任务书'), true, '加粗必须可识别')
  assert.equal(titleMatches('6. 修订任务书（打回主件）', '修订任务书'), true, '序号 + 括注必须可识别')
  // 防误伤：`第一作者声明` 不得被当成「作者声明」的序号前缀
  assert.equal(titleMatches('第一作者声明', '作者声明'), false)
  assert.equal(stripMcDecor('## 6. **修订任务书**：'), '修订任务书')
})

// ─────────────────────────────────────────────────────────────────────────────
// §3 通知单门不产生 ask_user_question 回执 → A7 不得判硬
// ─────────────────────────────────────────────────────────────────────────────
const mkGate = (proj, gate, { mode, answer, id, time = '2026-10-19 22:00' }) => writeFileSync(join(proj, `阶段确认-${gate}.md`),
  `# 确认单\n\n### 6. 主人回复\n\n- **主人原话**：${answer}\n- **回复时间**：${time}\n`
  + `- **回执 id**：${id}\n- **提问方式**：${mode}\n- **主控落盘结论**：进入下一阶段\n- **轮次计数**：A 轨 0/2\n`)

const mkT8Project = ({ notification = true } = {}) => {
  const { d, proj, fin, aud } = mkProject({ audits: true, drafts: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(fin, '交付说明.md'), '# 交付说明\n\n## 8. AI 使用披露\n\nAI 生成段。\n\n## 12. 终检结论\n\nM 门 exit 0。\n')
  writeFileSync(join(fin, '局限性.md'), '# 局限性\n\n无。\n')
  writeFileSync(join(fin, '运行报告.html'), '<html></html>\n')
  mkdirSync(join(fin, '证据包'), { recursive: true })
  const receipts = [
    { gate: 'Phase0', round: 1, askedAt: '2026-10-19 21:00', answeredAt: '2026-10-19 21:01', question: 'q', options: ['同意（推荐）', '驳回'], chosenIndex: 0, chosenLabel: '同意（推荐）', rawAnswer: '同意（推荐）', tool: 'ask_user_question', caller: 'T0', callId: 'c0' },
    { gate: 'Phase5', round: 1, askedAt: '2026-10-19 23:00', answeredAt: '2026-10-19 23:01', question: 'q', options: ['交付（推荐）', '驳回'], chosenIndex: 0, chosenLabel: '交付（推荐）', rawAnswer: '交付（推荐）', tool: 'ask_user_question', caller: 'T0', callId: 'c5' },
  ]
  writeFileSync(join(aud, 'gate-receipts.jsonl'), receipts.map((r) => JSON.stringify(r)).join('\n') + '\n')
  mkGate(proj, 'Phase0', { mode: 'ask_user_question', answer: '同意（推荐）', id: 'Phase0#1', time: '2026-10-19 21:01' })
  if (notification) {
    mkGate(proj, 'Phase2.5', { mode: 'ask_user_question（通知单模式：不等待答复）', answer: '（通知单 · 默认不阻塞：主控按建议自决）', id: '无（通知单自决，未产生 ask_user_question 回执）' })
    mkGate(proj, 'Phase3.5', { mode: 'ask_user_question（通知单模式，不等待答复）', answer: '（通知单 · 默认不阻塞：主控按建议自决）', id: '无（通知单自决，未产生 ask_user_question 回执）' })
  } else {
    mkGate(proj, 'Phase2.5', { mode: 'ask_user_question', answer: '同意（推荐）', id: 'Phase2.5#1' })
    mkGate(proj, 'Phase3.5', { mode: 'ask_user_question', answer: '同意（推荐）', id: 'Phase3.5#1' })
  }
  mkGate(proj, 'Phase5', { mode: 'ask_user_question', answer: '交付（推荐）', id: 'Phase5#1', time: '2026-10-19 23:01' })
  return { d, proj }
}

test('§3：P2.5/P3.5「通知单」无回执 → A7 不再判硬（门-A/门-B 仍严格）', () => {
  const { d, proj } = mkT8Project({ notification: true })
  try {
    const j = parseJson(run([H(), '--project', proj, '--role', 'T8', '--require-gates', '--summary']))
    const a7 = j.hard.filter((h) => h.check === 'A7')
    assert.deepEqual(a7, [], '通知单门不得因子虚乌有的回执判硬：' + JSON.stringify(a7))
    assert.ok(j.notes.some((n) => /通知单/.test(n)), '必须留痕说明该门走通知单、不核回执')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// §4 M-Exist-4：序号标题 + 段内子标题 + 双连字符编号
// ─────────────────────────────────────────────────────────────────────────────
test('§4：`## 6. 修订任务书` + `### 表头` + `P1-D-1` 闭环 → 不报缺段 / 不报未覆盖', async () => {
  const { d, proj, fin, aud, ev } = mkProject({ audits: true, drafts: true })
  try {
    const draftPath = join(fin, '定稿.md')
    writeFileSync(draftPath, '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
    const H6 = '| 编号 | 严重度 | 改哪里 | 怎么改 | 验收标准 | 关闭状态 |\n|---|---|---|---|---|---|\n'
    writeFileSync(join(aud, '审计报告-v1.md'),
      '# 审计报告 v1\n\n## 结论\n\n结论：打回修订 ❌\n\n## 6. 修订任务书（打回主件）\n\n### 表头：六列\n\n'
      + H6
      + '| P0-1 | P0 | §1 首段 | 补 [D01] 的独立来源并写明口径边界 | 该段含 [D01] 且写明口径 | 已关闭 |\n'
      + '| P1-D-1 | P1-D | §2 末段 | 恢复方向判据句并列出反向事实 | 该段出现「方向不一致」 | 已关闭 |\n')
    writeFileSync(join(aud, '复核报告-v1.md'),
      '# 复核报告 v1\n\n## 结论\n\n结论：复核通过\n\n## 逐条判定\n\n| 编号 | 判定 | 依据 |\n|---|---|---|\n'
      + '| P0-1 | 已关闭 | 修订说明 §1 |\n| P1-D-1 | 已关闭 | 修订说明 §2 |\n')
    const results = []
    mExist4({ draftPath, evDir: ev, auditsDirOf: () => aud, results })
    const r = results.at(-1)
    const detail = String(r.detail)
    assert.doesNotMatch(detail, /缺「## 修订任务书」段|缺「修订任务书」段/, '带序号的标题必须被识别：' + detail)
    assert.doesNotMatch(detail, /未覆盖/, 'P1-D-1 两侧必须能对上：' + detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// §1 M-Exist-7：`**sha256**` 加粗字段名后直接跟实值
// ─────────────────────────────────────────────────────────────────────────────
test('§1：`- **sha256**：<hex>`（加粗字段名 + 直接实值）→ 不再判「缺证据包指纹」', () => {
  const { d, fin } = mkProject()
  try {
    const draftPath = join(fin, '定稿.md')
    writeFileSync(draftPath, '# 标题\n\n## 摘要\n\n正文。\n')
    writeFileSync(join(fin, '交付说明.md'), [
      '# 交付说明', '', '## 1. 路径', '', '- final/定稿.md', '', '## 2. 图件清单', '', '- 无', '',
      '## 3. 遗留风险', '', '- 无', '', '## 4. 人工核验项', '', '- 无', '', '## 5. 数据溯源 check-list', '', '- 无', '',
      '## 6. 成本指标', '', '- ~5M', '', '## 7. 建议 merge 的反哺清单', '', '- 无', '', '## 8. AI 使用披露', '', '- AI 生成。',
      '', '## 9. 证据包指纹', '', '- **sha256**：9128b652add19963d4f77f21b59e2d218417cc0154e9fa14454c63ca76e72c06', '',
      '## 10. 投稿就绪检查表', '', '- 未启用', '', '## 11. 主人决策记录', '', '- Phase 0 09:12 通过｜Phase 2.5 10:05 通过｜Phase 3.5 10:40 通过｜Phase 5 11:20 通过',
      '', '## 12. 终检结论', '', '- M 门 exit 0', '',
    ].join('\n'))
    const results = []
    mExist7({ draftPath, results })
    const r = results.at(-1)
    const detail = String(r.detail)
    assert.doesNotMatch(detail, /缺「?证据包指纹/, '加粗字段名不得被当作「缺实值」：' + detail)
    assert.match(detail, /证据包指纹✓/, '加粗字段名 + 实值必须被认作「已填」：' + detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// §1 M-Exist-5：`exit **21**`（加粗）不再被判「未给出 exit」
// ─────────────────────────────────────────────────────────────────────────────
test('§1：闸门记录里 `exit **21**`（加粗）→ 不再判「未给出 exit」', async () => {
  const { createHash } = await import('node:crypto')
  const { d, proj, fin, aud } = mkProject({ audits: true, drafts: true })
  try {
    const draft = join(fin, '定稿.md')
    writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文。\n')
    const sha = createHash('sha256').update(readFileSync(draft)).digest('hex')
    writeFileSync(join(fin, 'M-Gate-Report.json'), JSON.stringify({ script_exit_raw: 0, exit: 0, verdict_scope: { draft_sha256: sha } }))
    writeFileSync(join(aud, '审计报告-v1.md'), '# 审计报告\n\n## 结论\n\n结论：复核通过\n')
    // 从模板**逐项派生**检查项（真源 = 模板；测试不另抄一份清单）
    const tpl = readFileSync(join(SCRIPTS, '..', 'references', 'templates', '闸门记录-template.md'), 'utf8')
    const itemsOf = (sec) => {
      const lines = tpl.split('\n')
      const start = lines.findIndex((l) => new RegExp('^## ' + sec.replace('.', '\\.')).test(l))
      const out = []
      let inTable = false
      for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i]
        if (/^## /.test(l)) break
        if (!/^\s*\|/.test(l)) { if (inTable) break; continue }
        inTable = true
        const cells = l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
        if (/^-+$/.test(cells[0]) || /检查项/.test(cells[0])) continue
        out.push(cells[0])
      }
      return out
    }
    for (const [sec, role] of [['T2.5', 'T2'], ['T7.5', 'T5']]) {
      const rows = itemsOf(sec).map((it) => {
        let ev = '`audits/审计报告-v1.md`（在盘）'
        if (/交接门/.test(it)) ev = `handoff-check --role ${role} → exit **21**`   // ← 本次要钉的形态
        if (/M\s*门/.test(it)) ev = '`final/M-Gate-Report.json`：exit 0（script_exit_raw）'
        if (/sha256/.test(it)) ev = '`' + sha + '`'
        return `| ${it} | ${ev} | ✓ |  |`
      })
      writeFileSync(join(aud, `闸门记录-${sec}.md`), `# 闸门记录 ${sec}\n\n| 检查项 | 实据 | 结论 | 失败原因 |\n|---|---|---|---|\n${rows.join('\n')}\n`)
    }
    const results = []
    mExist5({ draftPath: draft, auditsDirOf: () => aud, skillRoot: join(SCRIPTS, '..'), results })
    const detail = String(results.at(-1).detail)
    assert.doesNotMatch(detail, /未给出 exit/, '加粗不得破坏 exit 识别：' + detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// §6 A3：正文内联 `[图3]`（引用）不是图位声明
// ─────────────────────────────────────────────────────────────────────────────
test('§6：`与 [图3] 表`（内联引用）不计「图位未独占一行」；带冒号的声明才计', () => {
  const base = '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、导论\n\n与 [图3] 表一致。\n\n[图1：趋势]\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  {
    const { d, proj } = mkProject({ drafts: true })
    try {
      writeFileSync(join(proj, 'drafts', '初稿-v1.md'), base)
      const j = parseJson(run([H(), '--project', proj, '--role', 'T5', '--summary']))
      assert.ok(!(j.soft || []).some((s) => /图位未独占/.test(s.detail)), '内联引用不得误报：' + JSON.stringify(j.soft))
    } finally { rmSync(d, { recursive: true, force: true }) }
  }
  {
    const { d, proj } = mkProject({ drafts: true })
    try {
      writeFileSync(join(proj, 'drafts', '初稿-v1.md'), base.replace('与 [图3] 表一致。', '与 [图2：占比] 表一致。'))
      const j = parseJson(run([H(), '--project', proj, '--role', 'T5', '--summary']))
      assert.ok((j.soft || []).some((s) => /图位未独占/.test(s.detail)), '段落中的图位声明必须报：' + JSON.stringify(j.soft))
    } finally { rmSync(d, { recursive: true, force: true }) }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// §7 档位下限 ≠ 点目标
// ─────────────────────────────────────────────────────────────────────────────
test('§7：`≥5000 字（全量档）` 不再被当成点目标；`目标 8000` 优先', () => {
  const band = parseTargetCandidates('- **篇幅**：≥5000 字（全量档）')
  assert.deepEqual(band.pointValues, [], '档位下限不得进 pointValues')
  assert.deepEqual(band.bandValues, [5000])
  assert.equal(parseTargetChars('- **篇幅**：≥5000 字（全量档）').value, null, '档位下限不得当点目标')
  const both = parseTargetCandidates('- **篇幅**：≥5000（全量档）；目标 8000 字')
  assert.deepEqual(both.pointValues, [8000], '点目标必须可分离')
  assert.equal(parseTargetChars('- **篇幅**：≥5000（全量档）；目标 8000 字').value, 8000)
})

// ─────────────────────────────────────────────────────────────────────────────
// §8 methodology-check：measure-calc → N/A（不是 P0）
// ─────────────────────────────────────────────────────────────────────────────
test('§8：`--genre measure-calc` → M-Form-12 / M-Exist-11 记 N/A，不再 P0', () => {
  const d = tmp('lunheng-meth-')
  try {
    const f = join(d, '稿.md')
    writeFileSync(f, '# 标题\n\n## 摘要\n\n正文。\n\n## 方法\n\n本文以公开总量数据按口径定义做确定性算术，不抽样、不作统计推断。\n\n## 结果\n\n测算结果。\n\n## 讨论\n\n讨论。\n\n## 参考文献\n\n[L01] x\n')
    const r = run([METH(), f, '--genre', 'measure-calc'])
    const j = parseJson(r)
    assert.equal(j.checks['M-Form-12'].severity, 'N/A', '抽样统计向判据应记 N/A：' + JSON.stringify(j.checks['M-Form-12']))
    assert.equal(j.checks['M-Exist-11'].severity, 'N/A')
    assert.notEqual(r.code, 2, '不得再以 P0 退出：' + r.out)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// §9 轮次账本：按表头列名解析（7 列 + 反引号路径）
// ─────────────────────────────────────────────────────────────────────────────
test('§9：7 列账本按列名取值（反引号路径也要剥）；追加行跟随既有表头', () => {
  const d = tmp('lunheng-ledger-')
  try {
    mkdirSync(join(d, 'drafts'), { recursive: true })
    writeFileSync(join(d, 'drafts', '轮次账本.md'),
      '# 轮次账本\n\n| 轨 | 轮次 | 来源 | 正文版本 | 被审正文 sha256 | 复核报告 | 关闭状态 |\n|---|---|---|---|---|---|---|\n'
      + '| A | 1/2 | T7 审计打回 | `drafts/初稿-v5.md` → `drafts/初稿-v6.md` | 7013f19b | `audits/复核报告-v1.md` | 关闭 |\n')
    const r = parseLedger(d)
    assert.equal(r.rows.length, 1, JSON.stringify(r))
    assert.equal(r.rows[0].draft, 'drafts/初稿-v5.md → drafts/初稿-v6.md', '正文版本不得取成「来源」：' + JSON.stringify(r.rows[0]))
    assert.equal(r.rows[0].review, 'audits/复核报告-v1.md', '复核报告不得取成 sha：' + JSON.stringify(r.rows[0]))
    assert.equal(r.rows[0].sha256, '7013f19b')
    appendLedgerRow(d, { track: 'A', n: 2, draft: 'drafts/初稿-v6.md', source: 'T7 二轮' })
    const led = readFileSync(join(d, 'drafts', '轮次账本.md'), 'utf8')
    const last = led.trim().split('\n').at(-1)
    assert.equal(last.split('|').length - 2, 7, '追加行必须跟随 7 列表头：' + last)
    assert.match(last, /\|\s*drafts\/初稿-v6\.md\s*\|/, '正文版本必须落在「正文版本」列：' + last)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
