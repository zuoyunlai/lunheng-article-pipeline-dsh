// phase-registry.test.mjs — **四门 / §6 五字段单一登记表**的守护（v19.6.0 · 架构与机制反哺批 §3.2）
//
// 为什么需要它（本仓纪律：**新增登记表必须同时新增双向对账**，否则「登记表」会退化成又一份手写副本）：
//   真源 = `skills/lunheng-article-pipeline/scripts/_lib/cc-rules/phase-registry.mjs`
//   消费者 = `handoff-check.mjs` / `pending-cli.mjs` / `flow-metrics.mjs` / `run-report.mjs`
//   派生对账 = 规则 ㊵（`content-rules.mjs`；**代码面无第二份数组字面量**）
//   本文件补的是另一条独立判据：**模板散文 ↔ 登记表**（㊵ 不读模板）。
// 隔离策略（刻意）：本文件**只 import 纯常量模块**（`_lib/` 与两个带 `isMain` 守卫的 CLI），
//   不 import 任何「执行即产副作用」的脚本（`handoff-check` / `run-report` 的行为由既有
//   `tests/gate-receipts.test.mjs` / `tests/scripts/run-report.test.mjs` 经子进程在**端到端**层面覆盖）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './_fixtures.mjs'
import { PHASES, PHASE_IDS, PHASE_FILES, PHASE_DOCS, GATE_FIELDS, phaseById, confirmFileOf } from '../skills/lunheng-article-pipeline/scripts/_lib/cc-rules/phase-registry.mjs'
import { GATES as PENDING_GATES, SECTION6_FIELDS } from '../skills/lunheng-commands/scripts/pending-cli.mjs'
import { GATES as FLOW_GATES, GATE_FILES as FLOW_FILES } from '../scripts/flow-metrics.mjs'

const REGISTRY_REL = 'skills/lunheng-article-pipeline/scripts/_lib/cc-rules/phase-registry.mjs'
const TEMPLATE_REL = 'skills/lunheng-article-pipeline/references/templates/主人确认-template.md'
const EXPECTED_IDS = ['Phase0', 'Phase2.5', 'Phase3.5', 'Phase5']

test('R1：登记表形状——四门齐备、字段非空、id 唯一且逐字为约定四值', () => {
  assert.equal(PHASES.length, 4, '四门必须恰好 4 条')
  for (const p of PHASES) {
    for (const k of ['id', 'label', 'shortLabel', 'confirmFile']) {
      assert.ok(typeof p[k] === 'string' && p[k].trim(), `${p.id} 的 ${k} 必须是非空字符串`)
    }
    assert.match(p.confirmFile, /^阶段确认-Phase[\d.]+\.md$/, `${p.id} 的 confirmFile 形态不对：${p.confirmFile}`)
  }
  assert.deepEqual([...PHASE_IDS], EXPECTED_IDS, '门序是约定值（run-report / pending-cli 依赖顺序）')
  assert.deepEqual([...PHASE_FILES], EXPECTED_IDS.map((id) => `阶段确认-${id}.md`), 'confirmFile 必须与 id 一一对应')
  assert.equal(new Set(PHASE_IDS).size, 4, 'id 不得重复')
  assert.equal(new Set(PHASE_FILES).size, 4, 'confirmFile 不得重复')
})

test('R2：三口径各自唯一（label / shortLabel / confirmFile 各自 4 个互异值）', () => {
  for (const field of ['label', 'shortLabel', 'confirmFile']) {
    const vals = PHASES.map((p) => p[field])
    assert.equal(new Set(vals).size, 4, `${field} 出现重复：${vals.join(' / ')}`)
  }
  // 短标签是**给列头用的**，与长标签不同集合是有意保留（统一会改存量报告列名）
  assert.notDeepEqual(PHASES.map((p) => p.label), PHASES.map((p) => p.shortLabel),
    'label 与 shortLabel 是两套口径，不得合并（合并会改用户可见文案）')
})

test('R3：§6 五字段——逐字与顺序（机检按名字匹配，改字即改契约）', () => {
  assert.deepEqual([...GATE_FIELDS], ['主人原话', '回复时间', '提问方式', '主控落盘结论', '轮次计数'])
  assert.equal(GATE_FIELDS.length, 5, '「五字段」是机制口径（缺一即未留痕）')
})

test('R4：派生三元组 PHASE_DOCS == [confirmFile, label, id]（handoff-check 的解构顺序）', () => {
  assert.deepEqual(PHASE_DOCS, PHASES.map((p) => [p.confirmFile, p.label, p.id]))
})

test('R5：模板散文 ↔ 登记表——四条产出物命名必须逐字相符（㊵ 不读模板，本用例补这一半）', () => {
  const tpl = readFileSync(join(ROOT, TEMPLATE_REL), 'utf8')
  const named = [...tpl.matchAll(/`(阶段确认-Phase[\d.]+\.md)`/g)].map((m) => m[1])
  const uniq = [...new Set(named)]
  assert.equal(uniq.length, 4, `模板 §命名真源 应列出 4 个文件名，实得 ${uniq.length}：${uniq.join(' / ')}`)
  assert.deepEqual([...uniq].sort(), [...PHASE_FILES].sort(),
    '模板列出的产出物命名必须与登记表 confirmFile 逐字一致（两侧任一处改名即必须同批改另一处）')
  // §6 五字段：模板 §6 段内必须逐个出现（真源是模板的行文，登记表持「给程序匹配的名字」）
  for (const f of GATE_FIELDS) {
    assert.ok(new RegExp(`\\*\\*${f}\\*\\*`).test(tpl), `模板缺 §6 字段：${f}（登记表与模板已发散）`)
  }
})

test('R6：消费者派生一致——pending-cli 与 flow-metrics 必须等于登记表（不得各自硬编码）', () => {
  assert.deepEqual([...PENDING_GATES], [...PHASE_IDS], 'pending-cli 的 GATES 必须派生自登记表')
  assert.deepEqual([...SECTION6_FIELDS], [...GATE_FIELDS], 'pending-cli 的 SECTION6_FIELDS 必须派生自登记表')
  assert.deepEqual(FLOW_GATES.map((g) => g.id), [...PHASE_IDS], 'flow-metrics 的 GATES.id 必须派生自登记表')
  assert.deepEqual(FLOW_GATES.map((g) => g.label), PHASES.map((p) => p.shortLabel),
    'flow-metrics 的 GATES.label 必须 = 登记表的 shortLabel（存量列名口径）')
  assert.deepEqual([...FLOW_FILES], [...PHASE_FILES], 'flow-metrics 的 GATE_FILES 必须派生自登记表')
})

test('R7：查表函数——命中返回登记项，未命中返回 null（不抛、不静默给错值）', () => {
  assert.equal(phaseById('Phase2.5').label, 'Phase 2.5 大纲确认')
  assert.equal(phaseById('Phase9'), null)
  assert.equal(confirmFileOf('Phase5'), '阶段确认-Phase5.md')
  assert.equal(confirmFileOf('PhaseX'), null)
})

test('R8：代码面无第二份——四门文件名不得以「数组字面量」形态出现在登记表之外', () => {
  // 本用例是**独立于规则 ㊵** 的第二条核验（㊵ 跑在一致性门里，本用例让它在单测层面也可见）：
  //   刻意用「剥注释后再扫」的口径，避免把引述形态（注释/文档）误判为第二份实现。
  const scanned = [
    'skills/lunheng-article-pipeline/scripts/handoff-check.mjs',
    'skills/lunheng-article-pipeline/scripts/run-report.mjs',
    'skills/lunheng-commands/scripts/pending-cli.mjs',
    'scripts/flow-metrics.mjs',
  ]
  const ARRAY_LITERAL_RE = /\[\s*['"]阶段确认-Phase/
  for (const rel of scanned) {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    assert.ok(!ARRAY_LITERAL_RE.test(code),
      `${rel} 出现「数组字面量含 阶段确认-Phase」——四门只有一处真源（${REGISTRY_REL}），此处须派生`)
  }
})

test('R9【注入实证】：登记表被改动后，规则 ㊵ 的判据面必须真的报警（不是恒真的摆设）', () => {
  // 本仓惯例：新增门必须配注入实证，证明它**能红**。这里在**副本**上跑 ㊵ 的核心判据，
  //   不改动真源文件（避免测试污染仓库）。判据 = 与 content-rules.mjs ㊵ 同口径的最小复算。
  const abs = join(ROOT, REGISTRY_REL)
  const backup = readFileSync(abs, 'utf8')
  const tmpAbs = abs + '.inject-probe'
  try {
    // 注入 1：删掉一个 id → 真源可用性判据（㊵ 的 ⓪）必须命中
    writeFileSync(tmpAbs, backup.replace("id: 'Phase3.5'", "id: 'BROKEN'"))
    const broken = readFileSync(tmpAbs, 'utf8')
    const missing = EXPECTED_IDS.filter((id) => !new RegExp(`id:\\s*'${id.replace('.', '\\.')}'`).test(broken))
    assert.deepEqual(missing, ['Phase3.5'], '注入后必须报出缺失的 id（派生退化探测有效）')

    // 注入 2：加一条重复 confirmFile → 三口径唯一性判据（㊵ 的 ①）必须命中
    writeFileSync(tmpAbs, backup.replace(
      "confirmFile: '阶段确认-Phase5.md'",
      "confirmFile: '阶段确认-Phase0.md'"))
    const dupSrc = readFileSync(tmpAbs, 'utf8')
    const vals = [...dupSrc.matchAll(/confirmFile:\s*'([^']+)'/g)].map((m) => m[1])
    const dup = vals.filter((v, i) => vals.indexOf(v) !== i)
    assert.ok(dup.length > 0, '注入重复值后必须报重复（唯一性判据有效）')
  } finally {
    rmSync(tmpAbs, { force: true })
    assert.equal(readFileSync(abs, 'utf8'), backup, '真源文件必须逐字未被本用例改动')
  }
})
