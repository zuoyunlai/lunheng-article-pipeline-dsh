// 人门口**回执账本**回归（v18.81.0 · 独立审计批 1.1）
//
// **为什么需要**（实测病灶）：45 份真实 `阶段确认-*.md` 中「主控落盘结论」含驳回/打回的实例 = **0**，
//   而「主人原话」栏**系统性填的是主控自己的选项标签**——`cn-llm-inference-cost-econ/阶段确认-Phase2.5.md:47`
//   与 `-Phase5.md:53` 把「推荐:…」原文抄进该栏；45 份里只有 1 份是逐字原话。
//   即：§6 五字段只能证明「有人填过」，不能证明「主人真的这么答过」。
// 本组用例钉住三态：**无账本（只写 notes、不改退出码）／有账本且相容（放行）／有账本但不一致（硬 21）**，
//   其中 R5 是现实缺陷的正面回归——**主控抄自己的选项标签**必须被判红。
//
// 边界（如实）：账本仍由**主控**写入，本组用例证明的是「账本与 §6 的一致性被判了」，
//   **不是**「防伪」。独立核对源（会话日志 `tool/call` + `tool/result`）本版未实装。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const H = () => join(SCRIPTS, 'handoff-check.mjs')

const GATES = ['Phase0', 'Phase2.5', 'Phase3.5', 'Phase5']

/** §6 段（五固定字段 + 可选「回执 id」）——字段名真源 = 主人确认-template.md §6 */
const GATE6 = ({ answer = '同意', when = '2026-10-01 10:00', receiptId = null } = {}) => [
  '### 6. 主人回复（必填）', '',
  `- **主人原话**：${answer}`,
  `- **回复时间**：${when}`,
  ...(receiptId ? [`- **回执 id**：${receiptId}`] : []),
  '- **提问方式**：ask_user_question',
  '- **主控落盘结论**：进入下一阶段',
  '- **轮次计数**：否 / A 轨 0/2',
].join('\n')

/** 一条合法回执行 */
const RECEIPT = (gate, round, rawAnswer, when, extra = {}) => JSON.stringify({
  gate, round, askedAt: when, answeredAt: when, question: `${gate}：是否按建议推进？`,
  options: [rawAnswer, '其他（我会补充说明）'], chosenIndex: 0, chosenLabel: rawAnswer,
  rawAnswer, tool: 'ask_user_question', caller: 'T0', ...extra,
})

const mkProj = ({ receiptIds = null, receipts = null, answers = {} } = {}) => {
  const d = tmp('lunheng-receipt-')
  mkdirSync(join(d, 'audits'), { recursive: true })
  for (const g of GATES) {
    const id = receiptIds ? receiptIds(g) : null
    writeFileSync(join(d, `阶段确认-${g}.md`), `# 确认单\n\n${GATE6({ receiptId: id, ...(answers[g] || {}) })}\n`)
  }
  if (receipts) writeFileSync(join(d, 'audits', 'gate-receipts.jsonl'), receipts.join('\n') + '\n')
  return d
}

const runH = (d, extraArgs = []) => parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', ...extraArgs]))
const a7 = (j) => j.hard.filter((x) => x.check === 'A7')
const notesOf = (j) => (j.notes || []).join('\n')

test('R1：**无账本**（存量形态）→ 只在 notes 里可见，**不改退出码**、不判 A7 硬项', () => {
  const d = mkProj()
  try {
    const j = runH(d)
    assert.equal(a7(j).length, 0, '无账本不得产生 A7 硬项：' + JSON.stringify(j.hard))
    assert.match(notesOf(j), /未发现/, '必须显式告知「门留痕仅为人工自述」')
    assert.match(notesOf(j), /gate-receipts\.jsonl/, 'notes 须给出账本路径')
    assert.equal(j.exit, 22, '本形态应仍是「仅 A0 软提示」= exit 22（挂软项会把合规项目从 0 压到 22，属反向惩罚）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('R2：有账本 + §6 引用正确且**相容** → 放行（无 A7 硬项）', () => {
  const d = mkProj({
    receiptIds: (g) => `${g}#1`,
    receipts: GATES.map((g) => RECEIPT(g, 1, '同意', '2026-10-01 10:00')),
  })
  try {
    const j = runH(d)
    assert.equal(a7(j).length, 0, '相容形态不得报 A7 硬项：' + JSON.stringify(j.hard))
    assert.equal(j.exit, 22)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('R8（v18.80.4 · 全量审计 P1-7）：Phase 0 预授权门 → 回执 id 指向 Phase0 回执即可（不再逐门要求现场回执）', () => {
  const d = tmp('lunheng-receipt-preauth-')
  mkdirSync(join(d, 'audits'), { recursive: true })
  const gateDoc = (askMode, receiptId) => `# 确认单\n\n### 6. 主人回复（必填）\n\n- **主人原话**：同意\n- **回复时间**：2026-10-01 10:00\n- **回执 id**：${receiptId}\n- **提问方式**：${askMode}\n- **主控落盘结论**：进入下一阶段（预授权三条件：建议=通过 ✅ / P0 数=0 ✅ / 未做项=无 ✅）\n- **轮次计数**：否 / A 轨 0/2\n`
  writeFileSync(join(d, '阶段确认-Phase0.md'), gateDoc('ask_user_question', 'Phase0#1'))
  for (const g of ['Phase2.5', 'Phase3.5', 'Phase5']) {
    writeFileSync(join(d, `阶段确认-${g}.md`), gateDoc('Phase 0 预授权', 'Phase0#1'))
  }
  writeFileSync(join(d, 'audits', 'gate-receipts.jsonl'), RECEIPT('Phase0', 1, '同意', '2026-10-01 10:00') + '\n')
  try {
    const j = runH(d)
    assert.equal(j.exit, 22, '合法预授权不得硬 21（旧版 wrongGate 判定会拦，与模板 §0-d 承诺互斥）：' + JSON.stringify(j.hard))
    assert.ok(!a7(j).some((x) => /gate 与本文档不一致/.test(x.detail)), '预授权门不得再报 wrongGate')
    assert.ok((j.soft || []).some((x) => /Phase 0 预授权/.test(x.detail) || /预授权/.test(x.detail)), '应给三条件人工核 soft 提示')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('R3：账本在盘但 §6 **缺「回执 id」** → A7 硬 21（动作 = 回填）', () => {
  const d = mkProj({ receipts: GATES.map((g) => RECEIPT(g, 1, '同意', '2026-10-01 10:00')) })
  try {
    const j = runH(d)
    assert.equal(j.exit, 21, '账本在盘而未被引用 → 21：' + JSON.stringify(j.hard))
    assert.ok(a7(j).some((x) => /回执 id/.test(x.detail)), '须点名缺哪个字段')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('R4：§6 的「回执 id」在账本中**解析不到** → A7 硬 21（且给出可用 id 提示）', () => {
  const d = mkProj({
    receiptIds: (g) => `${g}#9`,
    receipts: GATES.map((g) => RECEIPT(g, 1, '同意', '2026-10-01 10:00')),
  })
  try {
    const j = runH(d)
    assert.equal(j.exit, 21)
    const hit = a7(j).find((x) => /找不到/.test(x.detail))
    assert.ok(hit, '须报「找不到」：' + JSON.stringify(a7(j)))
    assert.match(hit.detail, /Phase0#1|Phase0#9/, '须给出可用 id 形态，否则操作者无从下手')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('R5【现实缺陷正面回归】：主人原话栏填的是**主控自己的选项标签**、与账本 rawAnswer 不相容 → 硬 21', () => {
  // 复刻实测形态：账本记录主人真答「同意」，而 §6 写「推荐:按 T4 大纲推进 spawn T5 写手 v1（推荐）」
  const d = mkProj({
    receiptIds: (g) => `${g}#1`,
    receipts: GATES.map((g) => RECEIPT(g, 1, '同意', '2026-10-01 10:00')),
    answers: {},
  })
  try {
    // 逐门把「主人原话」换成主控的选项标签，时间也换成主控自己的口径
    for (const g of GATES) {
      writeFileSync(join(d, `阶段确认-${g}.md`),
        `# 确认单\n\n${GATE6({ answer: '推荐:按 T4 大纲推进 spawn T5 写手 v1（推荐）', when: '本会话', receiptId: `${g}#1` })}\n`)
    }
    const j = runH(d)
    assert.equal(j.exit, 21, '§6 与账本不相容必须判硬：' + JSON.stringify(j.hard))
    assert.ok(a7(j).some((x) => /不相容/.test(x.detail)), '须点名「不相容」而不是笼统「格式不合」')
    assert.ok(a7(j).some((x) => /不得替换为主控的选项标签/.test(x.detail)), '须写明这条铁律的理由')
    assert.ok(a7(j).some((x) => /回复时间.*answeredAt/.test(x.detail)), '时间不相容须单独报出')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('R6：账本行**自身不自洽**（chosenLabel ≠ options[chosenIndex]）→ 硬 21，且不得当通过', () => {
  const d = mkProj({
    receiptIds: (g) => `${g}#1`,
    receipts: [RECEIPT('Phase0', 1, '同意', '2026-10-01 10:00', { chosenLabel: '通过（推荐）' })],
  })
  try {
    const j = runH(d)
    assert.equal(j.exit, 21, '账本不自洽必须判硬：' + JSON.stringify(j.hard))
    assert.ok(a7(j).some((x) => /chosenLabel/.test(x.detail)), '须点名具体哪个字段不自洽')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('R7：账本存在但**0 条有效回执** → 与「没记」同形，禁止静默（进 notes）', () => {
  const d = mkProj({ receipts: ['', '   '] })
  try {
    const j = runH(d)
    assert.match(notesOf(j), /0 条有效回执|无效|缺 gate/, '空账本必须被点名：' + notesOf(j))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('R8：账本文件**不存在时**不得凭空要求「回执 id」（防误伤存量）', () => {
  const d = mkProj()
  try {
    assert.ok(existsSync(join(d, 'audits')), '夹具应有 audits/ 目录（账本只是没写文件）')
    const j = runH(d)
    assert.equal(a7(j).length, 0, '账本不在盘时 §6 无「回执 id」不得判硬：' + JSON.stringify(j.hard))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 批 1.4：**会话日志独立核对**（`--session-log`）────────────────────────────────
// 夹具形态**逐字对齐实测的 v4 会话日志**（不是自造一个方便的形状）：
//   call   : { type:'tool/call',   data:{ callId, name:'ask_user_question', arguments:'{"questions":[…]' } }
//   result : { type:'tool/result', data:{ message:{ toolCallId, content:[{type:'text',text:'{"answers":[…]'}] } } } }
// 另：`.jsonl`（非 zstd）走直读路径——测试不依赖压缩实现（口径见 `_lib/session-log.mjs` 头注释）。
const SESSION_JSONL = (pairs) => pairs.map(([cid, selected, when]) => [
  JSON.stringify({
    type: 'tool/call', seq: 1, time: when,
    data: { turn: 1, step: 1, callId: cid, name: 'ask_user_question', arguments: JSON.stringify({ questions: [{ id: 'g', question: '是否按建议推进？', options: [{ label: selected }] }] }) },
  }),
  JSON.stringify({
    type: 'tool/result', seq: 2, time: when + 1000,
    data: { turn: 1, step: 1, message: { toolCallId: cid, content: [{ type: 'text', text: JSON.stringify({ answers: [{ id: 'g', selected: [selected] }] }) }] } },
  }),
]).map((x) => x.join('\n')).join('\n')

const mkProjWithSession = ({ receipts, sessionPairs, answers = {} }) => {
  const d = mkProj({ receiptIds: (g) => `${g}#1`, receipts, answers })
  writeFileSync(join(d, 'sess.jsonl'), SESSION_JSONL(sessionPairs) + '\n')
  return d
}
const runS = (d, extraArgs = []) => parseJson(run([H(), '--project', d, '--role', 'T8', '--require-gates', '--session-log', join(d, 'sess.jsonl'), ...extraArgs]))
const ledger = (gate, selected, when, extra = {}) => RECEIPT(gate, 1, selected, when, { callId: `call_${gate}`, ...extra })

test('S1【批 1.4】：账本 callId 与宿主日志一致且答复逐字相同 → 无 A7 硬项，且 notes 报告配对结果', () => {
  const when = 1791177754593
  const d = mkProjWithSession({
    receipts: GATES.map((g) => ledger(g, '同意', '2026-10-01 10:00')),
    sessionPairs: GATES.map((g) => [`call_${g}`, '同意', when]),
  })
  try {
    const j = runS(d)
    assert.equal(a7(j).length, 0, '一致形态不得报硬项：' + JSON.stringify(a7(j)))
    assert.match(notesOf(j), /独立核对/, '须报告独立核对结果')
    assert.match(notesOf(j), /配对到 4 次/, '须给出配对到的问答次数：' + notesOf(j))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S2【批 1.4 · 本批最有价值的一条】：账本写「同意」而**宿主日志记的是另一个答复** → 硬 21，且提示改账本消不掉', () => {
  const when = 1791177754593
  const d = mkProjWithSession({
    receipts: GATES.map((g) => ledger(g, '同意', '2026-10-01 10:00')),
    // 主人真实答的是「驳回：重做大纲」，账本却写成「同意」
    sessionPairs: GATES.map((g) => [`call_${g}`, '驳回：重做大纲', when]),
  })
  try {
    const j = runS(d)
    assert.equal(j.exit, 21, '与宿主日志不一致必须判硬：' + JSON.stringify(a7(j)))
    const hit = a7(j).find((x) => /会话日志.*不一致/.test(x.detail))
    assert.ok(hit, '须点名「与会话日志不一致」而不是笼统格式错：' + JSON.stringify(a7(j)))
    assert.match(hit.detail, /驳回：重做大纲/, '须把宿主记录的答复原样摆出来')
    assert.match(hit.detail, /不可由改账本消除/, '须说明这一层的性质（否则读者仍会以为是格式问题）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S3【批 1.4】：账本的 callId 在日志中**根本不存在** → 硬 21', () => {
  const d = mkProjWithSession({
    receipts: GATES.map((g) => ledger(g, '同意', '2026-10-01 10:00', { callId: 'call_不存在' })),
    sessionPairs: GATES.map((g) => [`call_${g}`, '同意', 1791177754593]),
  })
  try {
    const j = runS(d)
    assert.equal(j.exit, 21)
    assert.ok(a7(j).some((x) => /找不到/.test(x.detail)), JSON.stringify(a7(j)))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S4【批 1.4】：开启 --session-log 而账本缺 `callId` → 硬 21（该字段由「可选」升为「必填」）', () => {
  const d = mkProjWithSession({
    receipts: GATES.map((g) => RECEIPT(g, 1, '同意', '2026-10-01 10:00')),   // 无 callId
    sessionPairs: GATES.map((g) => [`call_${g}`, '同意', 1791177754593]),
  })
  try {
    const j = runS(d)
    assert.equal(j.exit, 21, '缺 callId 时独立核对无从落地，必须判硬：' + JSON.stringify(a7(j)))
    assert.ok(a7(j).some((x) => /缺 `callId`/.test(x.detail)), JSON.stringify(a7(j)))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S5【批 1.4】：**不开** --session-log → 缺 callId 不判（默认关，避免依赖宿主日志形态）', () => {
  const d = mkProjWithSession({
    receipts: GATES.map((g) => RECEIPT(g, 1, '同意', '2026-10-01 10:00')),
    sessionPairs: GATES.map((g) => [`call_${g}`, '同意', 1791177754593]),
  })
  try {
    const j = runH(d)   // 不带 --session-log
    assert.equal(a7(j).length, 0, '默认关时不得因缺 callId 判硬：' + JSON.stringify(a7(j)))
    assert.equal(j.exit, 22)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 批 1.3：交付路径（final-check）的人在环门 ────────────────────────────────────
const FC = () => join(SCRIPTS, 'final-check.mjs')

/** final-check 夹具：最小可跑项目（定稿 + 证据包 [+ 账本]） */
const mkFinalProj = ({ withLedger = false } = {}) => {
  const d = tmp('lunheng-fcgate-')
  mkdirSync(join(d, 'final', '证据包'), { recursive: true })
  mkdirSync(join(d, 'audits'), { recursive: true })
  writeFileSync(join(d, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  if (withLedger) writeFileSync(join(d, 'audits', 'gate-receipts.jsonl'), RECEIPT('Phase0', 1, '同意', '2026-10-01 10:00') + '\n')
  return d
}

test('R9【批 1.3】：采用回执契约（账本在盘）但四门缺失 → final-check **在第 1 步硬阻塞 exit 20**', () => {
  const d = mkFinalProj({ withLedger: true })
  try {
    const r = run([FC(), d, '--json'])
    assert.equal(r.code, 20, '交付管道必须真的被门挡住（20）：' + r.out.slice(0, 400))
    const j = parseJson(r)
    assert.equal(j.exit, 20)
    assert.equal(j.steps[0].step.includes('handoff-check'), true,
      '人在环门必须是第 1 步——排在常态非零的 M 门之后会**永远轮不到**（本批自证踩过）：' + JSON.stringify(j.steps.map((s) => s.step)))
    assert.match(String(j.summary.recommendation), /人在环门未过（exit 20/, '须给出「补开那一门」的动作，而不是笼统「不在 M 门契约内」')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('R10【批 1.3】：未采用回执契约（无账本）→ 不接硬步，但必须在 notes 里说明「本轮未判四门」', () => {
  const d = mkFinalProj({ withLedger: false })
  try {
    const r = run([FC(), d, '--json'])
    const j = parseJson(r)
    assert.notEqual(j.exit, 20, '存量形态不得因「没有四门单据」被追溯判红')
    assert.ok(!j.steps.some((s) => String(s.step).includes('handoff-check')), '无账本时不得接该硬步')
    assert.match((j.summary.notes || []).join('\n'), /人在环门未判/, '必须显式说明本步未判（不得静默）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
