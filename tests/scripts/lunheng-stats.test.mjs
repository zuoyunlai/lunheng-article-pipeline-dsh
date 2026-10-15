// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 lunheng-stats 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/lunheng-stats.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('lunheng-stats：聚合 run/ 各项目（机器/LLM兜底/无证据 三桶 + 门拦截频率 + 阶段 + 轮数）', () => {
  const d = tmp()
  const runDir = join(d, 'run')
  // 项目 A：机器格式报告 + 3 轮修订 + P0/P2 各一
  const a = join(runDir, 'proj-a')
  mkdirSync(join(a, 'final'), { recursive: true })
  mkdirSync(join(a, 'drafts'), { recursive: true })
  writeFileSync(join(a, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文若干字。\n')
  writeFileSync(join(a, 'drafts', '初稿-v3.md'), '# v3\n')
  writeFileSync(join(a, 'final', 'M-Gate-Report.json'), JSON.stringify({ exit: 2, p0: 1, p1: 0, p2: 1, total: 22, results: [{ gate: 'M-Form-1 引用标注完整性', pass: false, severity: 'P0' }, { gate: 'M-Exist-5 阶段闸门记录表', pass: false, severity: 'P2' }] }))
  // 项目 B：LLM 兜底格式（无 results 数组）
  const b = join(runDir, 'proj-b')
  mkdirSync(join(b, 'final'), { recursive: true })
  writeFileSync(join(b, 'final', '定稿.md'), '# 标题\n\n正文。\n')
  writeFileSync(join(b, 'final', 'M-Gate-Report.json'), JSON.stringify({ 'M-Form_形式合规门': { 'M-Form-1_引用标注完整性': { pass: true } } }))
  // 项目 C：无报告
  const c = join(runDir, 'proj-c')
  mkdirSync(join(c, 'final'), { recursive: true })
  writeFileSync(join(c, 'final', '定稿.md'), '# 标题\n\n正文。\n')
  // v18.67.0（批 3 围栏落地后）：--run-dir 须落在 <cwd>/run 之内（与 pending-cli 同口径）。
  //   故本用例以 tmp 为 cwd、相对路径调用——聚合逻辑的测试意图不变，只是调用形态过围栏。
  const r = run([join(SCRIPTS, 'lunheng-stats.mjs'), '--run-dir', 'run', '--json'], { cwd: d })
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const j = parseJson(r)
  assert.equal(j.projects.length, 3)
  const A = j.projects.find((x) => x.name === 'proj-a')
  assert.equal(A.stage, 'final', '有定稿应记 final')
  assert.equal(A.rounds, 3, '初稿-v3 应计 3 轮')
  assert.equal(A.mgate, 'machine')
  assert.equal(A.exit, 2)
  assert.equal(A.p0, 1)
  const B = j.projects.find((x) => x.name === 'proj-b')
  assert.equal(B.mgate, 'llm-legacy', '无 results 数组的历史格式应归 LLM 兜底')
  const C = j.projects.find((x) => x.name === 'proj-c')
  assert.equal(C.mgate, 'none')
  assert.equal(j.summary.mGateEvidence.machine, 1)
  assert.equal(j.summary.mGateEvidence['llm-legacy'], 1)
  assert.equal(j.summary.mGateEvidence.none, 1)
  assert.equal(j.summary.topFailingGates[0].gate, 'M-Form-1', '拦截频率应按 P0/P1 降序，M-Form-1 的 P0 排最前')
  assert.equal(j.summary.topFailingGates[0].p0, 1)
  rmSync(d, { recursive: true, force: true })
})

test('lunheng-stats：未知参数 / run 目录不存在 → exit 10（与 0=成功区分）', () => {
  const d = tmp()
  assert.equal(run([join(SCRIPTS, 'lunheng-stats.mjs'), '--nope']).code, 10, '未知参数应 exit 10')
  // v18.67.0：cwd 锚定在 d、指向 run/ 内不存在的子路径 → 命中「目录不存在」分支（越界分支由 cli-e2e 钉）
  assert.equal(run([join(SCRIPTS, 'lunheng-stats.mjs'), '--run-dir', 'run/no-such'], { cwd: d }).code, 10, 'run 目录不存在应 exit 10')
  rmSync(d, { recursive: true, force: true })
})

// ════════════════════════════════════════════════════════════════════════════════════════════
// v19.6.0（架构与机制反哺批 §3.3 · 主人授权「依次全部修订」）：**人工裁定侧聚合**
//
// 病灶：`refutations` 被逐条校验却不落盘 ⇒ 只能算「机械最常报哪些门项」，算不出
//   「哪些门项最常被人工推翻」——而后者才是「规则判据该不该改」的信号。
// 本组用例钉三件事：① 两侧**同一归一口径**（可 join）；② 分母为 0 记 null **不编 0**；
//   ③ 存量报告（无 `_t8_refutations`）一律按「未裁定」计，**不得**把「读不到」算成「没被推翻」。
// ════════════════════════════════════════════════════════════════════════════════════════════

test('v19.6.0：lunheng-stats 聚合「被裁次数 / 机械失败次数」——同一归一键，两侧可 join', () => {
  const d = tmp()
  const runDir = join(d, 'run')
  const mk = (name, report) => {
    const p = join(runDir, name)
    mkdirSync(join(p, 'final'), { recursive: true })
    writeFileSync(join(p, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文若干字。\n')
    writeFileSync(join(p, 'final', 'M-Gate-Report.json'), JSON.stringify(report))
    return p
  }
  // 项目 A：3 个机械失败项，其中 M-Form-1 被裁 1 次、M-Exist-5 被裁 1 次（带 reason_code）
  mk('proj-a', {
    exit: 0, script_exit_raw: 1, p0: 0, p1: 1, p2: 2, total: 22,
    results: [
      { gate: 'M-Form-1 引用标注完整性', pass: false, severity: 'P1' },
      { gate: 'M-Exist-5 阶段闸门记录表', pass: false, severity: 'P2' },
      { gate: 'M-Fact-1 佐证材料', pass: false, severity: 'P2' },
    ],
    _t8_conclusion: { true_p0: 0, true_p1: 0 },
    _t8_refutations: [
      { gate: 'M-Form-1', basis: '夹具：路径配置问题', reason_code: 'path-misconfig' },
      { gate: 'M-Exist-5', basis: '夹具：判据形态不匹配', reason_code: 'false-positive' },
    ],
  })
  // 项目 B：机械失败 1 项但**未裁定**（`_t8_refutations` 缺失 = 存量形态）
  mk('proj-b', {
    exit: 1, p0: 0, p1: 1, p2: 0, total: 22,
    results: [{ gate: 'M-Form-1 引用标注完整性', pass: false, severity: 'P1' }],
  })
  // 项目 C：**裁定但零裁据**（`exit == script_exit_raw` 的形式化裁定）→ 不得算成「推翻」
  mk('proj-c', {
    exit: 0, script_exit_raw: 0, p0: 0, p1: 0, p2: 0, total: 22, results: [],
    _t8_conclusion: { true_p0: 0, true_p1: 0 }, _t8_refutations: [],
  })
  const r = run([join(SCRIPTS, 'lunheng-stats.mjs'), '--run-dir', 'run', '--json'], { cwd: d })
  assert.equal(r.code, 0, r.out.slice(0, 400))
  const s = parseJson(r).summary
  assert.equal(s.adjudicatedProjects, 1, '只有 A 是「裁定值 ≠ 机械值」的真裁定项目（C 是形式化裁定）')
  assert.equal(s.totalRefutations, 2)
  const form1 = s.topAdjudicatedGates.find((g) => g.gate === 'M-Form-1')
  assert.ok(form1, 'M-Form-1 应出现在被裁榜：' + JSON.stringify(s.topAdjudicatedGates))
  // 归一化口径必须与机械侧一致 ⇒ 两侧可直接 join（A 的 1 次 + B 的 1 次 = 2 次机械失败）
  assert.equal(form1.mechanicalFailures, 2, '同一归一键须把 A/B 两项目的 M-Form-1 合并计数')
  assert.equal(form1.refuted, 1, '只统计**被裁**的那一次（B 未裁定 ⇒ 不计入被裁）')
  assert.equal(form1.refutedRatio, 0.5, '被裁率 = 1/2')
  const exist5 = s.topAdjudicatedGates.find((g) => g.gate === 'M-Exist-5')
  assert.equal(exist5.refutedRatio, 1, '该门项机械失败 1 次、被裁 1 次 ⇒ 100%（这正是「判据该改」的信号）')
  // 原因分布：次数相同则**不保证先后**（排序是稳定排序的副产品，不是契约）——故按集合断言
  assert.deepEqual(s.refutationReasons.map((x) => x.reason).sort(), ['false-positive', 'path-misconfig'], '原因分布须含两类')
  assert.deepEqual(s.refutationReasons.map((x) => x.count), [1, 1], '各 1 次')
  assert.match(String(s.adjudicationNote), /分母为 0 记 null/, '口径必须随产物走（消费方不必读源码）')
  rmSync(d, { recursive: true, force: true })
})

test('v19.6.0：无数据时**不编造**——0 裁定项目 + 空榜 + 不能把「读不到」算成「没被推翻」', () => {
  const d = tmp()
  const runDir = join(d, 'run')
  const p = join(runDir, 'proj-only-mech')
  mkdirSync(join(p, 'final'), { recursive: true })
  writeFileSync(join(p, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文若干字。\n')
  // 存量形态：有机械报告、**无** `_t8_refutations`
  writeFileSync(join(p, 'final', 'M-Gate-Report.json'), JSON.stringify({
    exit: 1, p0: 0, p1: 1, p2: 0, total: 22,
    results: [{ gate: 'M-Form-1 引用标注完整性', pass: false, severity: 'P1' }],
  }))
  const r = run([join(SCRIPTS, 'lunheng-stats.mjs'), '--run-dir', 'run', '--json'], { cwd: d })
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const s = parseJson(r).summary
  assert.equal(s.adjudicatedProjects, 0, '无裁定项目')
  assert.equal(s.totalRefutations, 0)
  assert.deepEqual(s.topAdjudicatedGates, [], '被裁榜为空数组（不是 undefined，也不是编造的 0 行）')
  assert.deepEqual(s.refutationReasons, [])
  // 反向断言：机械侧仍然照常统计（补齐裁定侧**不得**影响既有口径）
  assert.equal(s.topFailingGates[0].gate, 'M-Form-1')
  rmSync(d, { recursive: true, force: true })
})
