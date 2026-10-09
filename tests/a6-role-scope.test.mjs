// A6（agents-log 执行记录）的**角色范围**回归（v18.81.0 · 独立审计批 2 · 2.3）
//
// **为什么需要**：实测两项目对照暴露了一个**逆向激励**——
//   · `run/test-v18-78-2-县中塌陷`（agents-log 有 4 条角色记录）→ 缺 `### T8 执行记录`
//     → `others.size=4 ≥ 3` → **硬 21** → `quality-score` 的 handoff 分量 = **0**；
//   · `run/共锁-自愿性理论的第四象限`（**零条记录**）→ 软 → **22** → 分量 **0.5**。
//   即「记的越多越吃亏，不记反而拿 0.5」。
// **根因**：A6 的判据是「**派发话术**要求子代理追加 agents-log，走满 3 个角色后成既成约定」，
//   而 **T8 不 spawn 子代理**（`handoff-check.mjs` 头注释的「档位不对称」段自陈 T8 无收报产物；
//   `08-终检-finalizer.md` 写死「T8 不 spawn 子代理」）→ 把面向子代理的约定套到 T8 上是**范畴错误**。
// 本组用例钉住两条：
//   · T8 在 strict 下**不得**因缺记录被判硬（且必须留下 notes 说明为何不判）；
//   · T1-T7/T9/G14 的行为**一字未改**（否则就是拿"修 T8"当借口把整项废掉）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const H = () => join(SCRIPTS, 'handoff-check.mjs')

/** 造一个「已有 N 条角色记录」的项目（T8 是否被判硬只看这一项与本项新加的 T8 例外） */
const mkWithLog = (roles) => {
  const d = tmp('lunheng-a6-')
  mkdirSync(join(d, 'final'), { recursive: true })
  writeFileSync(join(d, 'agents-log.md'),
    '# agents-log\n\n' + roles.map((r) => `### ${r} 执行记录\n\n- 做了什么：x\n`).join('\n'))
  return d
}
const runH = (d, role) => parseJson(run([H(), '--project', d, '--role', role, '--level', 'strict', '--summary']))
const a6 = (j) => j.hard.filter((x) => x.check === 'A6')

test('A6-1：项目已有 4 条记录而缺 T8 记录 → **不判硬**（22），且必须说明"T8 不 spawn"这一理由', () => {
  const d = mkWithLog(['T1', 'T2', 'T3', 'T7'])
  try {
    const j = runH(d, 'T8')
    assert.equal(a6(j).length, 0, 'T8 不得被判 A6 硬项：' + JSON.stringify(a6(j)))
    assert.equal(j.exit, 22, '应回到「仅软提示」= 22（此前为 21，即那个逆向激励）')
    assert.match((j.notes || []).join('\n'), /不 spawn 子代理/, '必须留痕说明为何不判（不得静默跳过）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('A6-2：**T4** 在同样条件下仍报硬项 —— T8 的例外不得外溢到子代理角色', () => {
  const d = mkWithLog(['T1', 'T2', 'T3', 'T7'])
  try {
    const j = runH(d, 'T4')
    // 注意：本断言**只看 A6 项本身**，不看总 exit——夹具缺 T4 的分析大纲，A1 会以 20 压过 21。
    //   「A6 是否判硬」才是本批改动的对象；总码的优先级属既有语义，不在本批范围内。
    assert.ok(a6(j).some((x) => /缺「### T4 执行记录」/.test(x.detail)),
      'T4 缺记录且已有 ≥3 条他人记录 → 仍按既成约定判硬：' + JSON.stringify(j.hard))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('A6-3：角色记录**不足 3 条**时（约定尚未建立）T4 只报软提示 —— 旧阈值未被本批改动', () => {
  const d = mkWithLog(['T1', 'T2'])
  try {
    const j = runH(d, 'T4')
    assert.equal(a6(j).length, 0, '不足 3 条不得判硬：' + JSON.stringify(j.hard))
    assert.ok((j.soft || []).some((x) => x.check === 'A6' && /达 3 个后本项升硬/.test(x.detail)),
      '应给出软提示并说明升级条件：' + JSON.stringify(j.soft))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('A6-4：T9 与 T8 不同——它**是被 spawn 的角色**，缺记录仍按原判据判硬', () => {
  const d = mkWithLog(['T1', 'T2', 'T3', 'T7'])
  try {
    const j = runH(d, 'T9')
    assert.ok(a6(j).some((x) => /缺「### T9 执行记录」/.test(x.detail)),
      'T9 不得继承 T8 的例外：' + JSON.stringify(j.hard))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── v18.86.0-prep（台海反哺 F-10）：agents-log **按 Phase 拆分**后 A6 仍须生效 ────────────────
//   「拆分后是否仍算单一留痕」的裁定 = **是**（判据 = 文件名前缀 `agents-log`，同 sources 分片思路）。
//   两条钉子：① 记录散在**分片**里、`agents-log.md` 不存在时，A6 仍能数到「已有 ≥3 个角色」→ 判硬；
//             ② 只改文档不改脚本会让 A6 **静默退回**「项目无 agents-log 流水」软提示 —— 本钉防这一退。
/** 造一个「只有分片、没有 agents-log.md」的项目。 */
const mkWithSplitLog = (roles) => {
  const d = tmp('lunheng-a6-split-')
  mkdirSync(join(d, 'final'), { recursive: true })
  // 按 Phase 拆成两个分片（T1/T2 在 P1、T3/T7 在 P4）——单文件形态**不存在**
  writeFileSync(join(d, 'agents-log-P1.md'),
    '# agents-log（Phase 1）\n\n' + ['T1', 'T2'].map((r) => `### ${r} 执行记录\n\n- 做了什么：x\n`).join('\n'))
  writeFileSync(join(d, 'agents-log-P4.md'),
    '# agents-log（Phase 4）\n\n' + roles.map((r) => `### ${r} 执行记录\n\n- 做了什么：x\n`).join('\n'))
  return d
}

test('A6-5【F-10】：只有**分片**（无 `agents-log.md`）时，A6 仍按族读取并判硬（拆分不使留痕失效）', () => {
  const d = mkWithSplitLog(['T3', 'T7'])
  try {
    const j = runH(d, 'T4')   // 分片里已有 T1/T2/T3/T7 = 4 个角色 → 缺 T4 应判硬
    assert.ok(a6(j).some((x) => /缺「### T4 执行记录」/.test(x.detail)),
      '分片形态下 A6 必须仍判硬（判据按 `agents-log*.md` 族读取）：' + JSON.stringify(j.hard))
    assert.ok(a6(j).some((x) => /agents-log\*\.md（2 个分片）/.test(x.subject || '')),
      '硬项应标明读的是**分片族**（避免读者以为在读单文件）：' + JSON.stringify(a6(j)))
    assert.doesNotMatch((j.notes || []).join('\n'), /项目无 agents-log 流水/,
      '不得退回「无流水」软提示——那正是「拆分让 A6 静默失效」的形态')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('A6-6【F-10】：分片里**已有该角色**记录 → 不报 A6（正例，防「拆分后被误判缺记录」）', () => {
  const d = mkWithSplitLog(['T3', 'T7'])
  try {
    const j = runH(d, 'T3')   // T3 的记录在 P4 分片里
    assert.equal(a6(j).length, 0, 'T3 记录已在分片中，不得判缺：' + JSON.stringify(a6(j)))
  } finally { rmSync(d, { recursive: true, force: true }) }
})
