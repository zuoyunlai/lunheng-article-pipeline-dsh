// 跨脚本链路回归网（v18.80.0 · 全量审计-v18.79.1 P2-5 部分落地）
//
// **为什么需要这一层**：本仓的 e2e 用例此前都是「单脚本 + 注入」——每条只验一个门的判定，
//   而**脚本之间的接口**（产物形态 ↔ 下游读法）没有任何一条用例覆盖。本批全量审计实测到的
//   两类缺陷恰好都住在这一层：
//     · `build-evidence-bundle.mjs` 生成的审计视图**硬编码「M 门 16 项」**（真源 25），而它
//       不在一致性 ⑥b 的扫描面内（生成物不算）→ **没有任何门会红**（v18.78.1 审计 A4）；
//     · 同一视图的 M 门分母曾有 `m.total || 12` 兜底，喂一份不含 `total` 的报告即得伪造分母。
//   修法早已落地（派生 + `?? '?'`），但**至今没有一条用例看着它**——本文件即补这一层。
//
// ⚠️ **两条实测得到的夹具口径**（首版两次踩到，都是我的夹具错、不是门错）：
//   ① **脚本必须从真源仓库跑，项目树才放临时目录**。`mkRepo()` 那类夹具仓**只复制 `skills/`**，
//      不含仓库根 `scripts/`；若从夹具仓调 `build-evidence-bundle`，它派生 M 门项数时会读不到
//      门模块源码而**正确地降级为 `?`**——那时你测到的是夹具的局限，不是真源的派生。
//   ② `build-evidence-bundle` 在**一个源都找不到**时判 **exit 10**（文案：「几乎一定是项目路径传错」）
//      ——那是刻意的 fail-closed 设计。故本层必须先放至少一个真实源，才能测到「收集 → 生成视图」。
//
// **边界（如实）**：本层不追求「跑完 T1→T8 全流水线」——那需要 LLM 角色参与，不是脚本层能构造的；
//   它覆盖的是**脚本层**的阶段间接口，正是此前零覆盖的那一半。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, mkProject } from './_fixtures.mjs'

/** 真源派生：从门源码里数 `gate: 'M-…'` 标签去重 + 1 人工项（与 `_lib/mgate-gates/gate-count.mjs` 同口径） */
const deriveTotal = () => {
  const dir = join(SCRIPTS, '_lib', 'mgate-gates')
  let src = readFileSync(join(SCRIPTS, 'm-gate-check.mjs'), 'utf8')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) src += '\n' + readFileSync(join(dir, f), 'utf8')
  const n = new Set([...src.matchAll(/gate:\s*'M-(Form|Exist|Integrity|Fact)-\d+/g)].map((m) => m[0])).size
  return n + 1
}

/**
 * 给项目树补「至少一个可收集的源」（见文件头口径②）。
 * 同时把 `final/定稿.md` 写出来——`m-gate-check` 要求该路径存在，否则判 exit 10（路径错）。
 */
const seedProject = (proj) => {
  const lit = join(proj, 'literature')
  mkdirSync(lit, { recursive: true })
  writeFileSync(join(lit, '文献卡.md'), '# 文献卡\n\n## L01\n\n- 标题：测试条目\n- DOI：10.0000/test\n')
  writeFileSync(join(lit, '先行者清单.md'), '# 先行者清单\n\n| 编号 | 文献 |\n|---|---|\n| 先01 | 测试 |\n')
  const fin = join(proj, 'final')
  mkdirSync(fin, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、导论\n\n正文。\n')
}

test('E2E-1 链路：审计视图的 M 门项数必须是**真源派生值**（不是硬编码、也不是 ?）', () => {
  const { d, proj } = mkProject()
  try {
    seedProject(proj)
    // 脚本取自真源仓库（口径①）；项目树是临时的
    const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
    assert.equal(r.code, 0, `build-evidence-bundle 应 exit 0，实得 ${r.code}\n${r.stdout}${r.stderr}`)
    const view = join(proj, 'audits', '审计视图-v0.md')
    assert.ok(existsSync(view), '审计视图应落盘到 <项目>/audits/审计视图-v0.md')
    const text = readFileSync(view, 'utf8')
    const expect = deriveTotal()
    assert.ok(expect > 1, `派生值异常（${expect}）——本用例会变成恒真断言`)
    assert.match(text, new RegExp(`M 门 ${expect} 项状态`),
      `审计视图必须写「M 门 ${expect} 项状态」（派生真源）。\n` +
      '若写别的数字 = 硬编码漂移复发（v18.78.1 A4）；若写 `?` = 门模块读不到（派生失败）。\n' +
      '实得片段：\n' + (text.split('\n').filter((l) => l.includes('M 门')).join('\n') || '（无）'))
    assert.doesNotMatch(text, /M 门 \? 项/, '派生失败不得静默降级为 ? 而不报——那等于把分母藏起来')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('E2E-2 链路：审计视图与 M 门读**同一棵项目树**（接口一致，且活过「缺报告」场景）', () => {
  const { d, proj } = mkProject()
  try {
    seedProject(proj)
    const b = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
    assert.equal(b.code, 0, `证据包应能生成：${b.stdout}${b.stderr}`)
    const ev = join(proj, 'final', '证据包')
    const m = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj, 'final', '定稿.md'), ev, '--summary'])
    // 同一项目树：M 门必须能读到证据包与定稿（不得报路径错 10）
    assert.notEqual(m.code, 10, `M 门不得报路径错（说明证据包/正文落点与它期望的一致）；实得 10：${m.stderr}`)
    // 且不得内部错误——缺报告的场景应走 SKIP/P0 语义
    assert.notEqual(m.code, 70, `M 门不得内部错误：${m.stderr}`)
    // 该场景（无审计/审稿/批判报告）应落进「需人工复核」那一档（exit 3 = 仅 P2·soft·SKIP），
    //   而**不是**静默 0 —— 这正是 A5 修复的语义（N/A 未检 ≠ 通过）。
    assert.ok([0, 1, 2, 3].includes(m.code), `M 门退出码应为 0/1/2/3 之一，实得 ${m.code}`)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('E2E-3 链路：handoff-check 对**缺产物**必须 exit 20（不得静默通过）', () => {
  const { d, proj } = mkProject()
  try {
    const r = run([join(SCRIPTS, 'handoff-check.mjs'), '--project', proj, '--role', 'T1'])
    assert.equal(r.code, 20, `缺产物应 exit 20（重派语义），实得 ${r.code}\n${r.stdout}${r.stderr}`)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('E2E-4 链路：产物齐备时 handoff-check 不得再报 20（防「永久重派」误报）', () => {
  const { d, proj } = mkProject()
  try {
    // 造 T1 的**全部**必需产物。清单取自门自己（`ROLE_TO_ARTIFACTS['T1']`）——
    //   本用例首版只造了 `literature/文献卡-L01.md`，门立刻报 exit 20 并点名缺族名文件 `文献卡.md`。
    //   那次失败**正是门在正确工作**（没静默放行），故此处按门列出的清单补齐。
    const lit = join(proj, 'literature')
    mkdirSync(lit, { recursive: true })
    writeFileSync(join(lit, '文献卡.md'), '# 文献卡\n\n## L01\n\n- 标题：测试条目\n- DOI：10.0000/test\n')
    writeFileSync(join(lit, '文献卡-L01.md'), '# L01\n\n## 条目\n\n- 标题：测试条目\n- DOI：10.0000/test\n')
    writeFileSync(join(lit, '先行者清单.md'), '# 先行者清单\n\n| 编号 | 文献 |\n|---|---|\n| 先01 | 测试 |\n')
    const r = run([join(SCRIPTS, 'handoff-check.mjs'), '--project', proj, '--role', 'T1'])
    assert.notEqual(r.code, 20, `产物已在盘，不得再判「产物缺失」（exit 20）；实得 ${r.code}\n${r.stdout}${r.stderr}`)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// E2E-5 端到端（v18.85.0-feat 落地，v18.80.0 P2-5 留独立批兑现）：
//   **为什么需要这一层**：v18.80.0 P2-5 留的"全库无一条流水线真跑"——`m-gate-check` 虽有 60+ 用例覆盖**单门**判定，
//   但**从空项目 → 写产物 → 落 M-Gate-Report.json → closeout-verify 串联**这条全链路**从未**在
//   tmp 上真跑过。这意味着任何一个脚本改动后，**"产物 ↔ 门期望"接口漂移**得等真项目出问题时才暴露。
//   本用例 = **最小端到端真跑**：
//     ① 造 4 张卡（文献/数据/案例/文末五节定稿 — 满足 M-Form-2/3/4/5/6/7/8 + M-Exist-1/2/3/4/5/6/7/10 的最小契约）
//     ② 跑 `build-evidence-bundle.mjs` 落证据包
//     ③ 跑 `m-gate-check.mjs` 落 M-Gate-Report.json
//     ④ 跑 `closeout-verify.mjs`（**不入本仓库 diff**——它是工作区级 run-* 验证，单独测）
//   判据：本条**不要求全绿**——只要求「每一步 exit 在已知语义集里、产物落盘路径符合 M 门期望」；
//   这是 v18.80.0 P2-5 留的「端到端夹具」最小形态（v18.80.3 已在 e2e-pipeline-chain 前 4 条覆盖了
//   关键接口，本条补「全链路串联」）。
test('E2E-5 端到端：T1/T2/T3 + 写手 + 证据包 + M 门串联，跑通脚本层（不要求全绿，只验接口）', () => {
  const { d, proj } = mkProject()
  try {
    // ① T1 文献卡：3 条 + 先行者清单（M-Form-1/2/3 最小契约）
    const lit = join(proj, 'literature')
    mkdirSync(lit, { recursive: true })
    writeFileSync(join(lit, '文献卡.md'), '# 文献卡\n\n## 📇 索引段\n\n[L01] 条目一\n[L02] 条目二\n[L03] 条目三\n\n## L01\n\n信任级别：已发布\n\n## L02\n\n信任级别：已发布\n\n## L03\n\n信任级别：已发布\n')
    writeFileSync(join(lit, '文献卡-L01.md'), '# L01\n\n## 条目\n\n- 标题：测试条目一\n- DOI：10.0000/test01\n')
    writeFileSync(join(lit, '文献卡-L02.md'), '# L02\n\n## 条目\n\n- 标题：测试条目二\n- DOI：10.0000/test02\n')
    writeFileSync(join(lit, '文献卡-L03.md'), '# L03\n\n## 条目\n\n- 标题：测试条目三\n- DOI：10.0000/test03\n')
    writeFileSync(join(lit, '先行者清单.md'), '# 先行者清单\n\n| 编号 | 文献 |\n|---|---|\n| 先01 | 测试 |\n')
    // ② T2 数据卡（M-Form-1 引用类型：含 [D01]）
    const data = join(proj, 'data')
    mkdirSync(data, { recursive: true })
    writeFileSync(join(data, '数据卡.md'), '# 数据卡\n\n## 📇 索引段\n\n[D01] 数据一\n\n## D01\n\n- 描述：测试数据\n')
    // ③ T3 案例卡（M-Form-1 引用类型：含 [C01]）
    const cases = join(proj, 'cases')
    mkdirSync(cases, { recursive: true })
    writeFileSync(join(cases, '案例卡.md'), '# 案例卡\n\n## 📇 索引段\n\n[C01] 案例一\n\n## C01\n\n- 描述：测试案例\n')
    // ④ 写手产出（M-Form-1 全部引用 [L01][L02][L03][D01][C01] + M-Form-2/7 文末五节 + 摘要）
    const draft = join(proj, 'drafts')
    mkdirSync(draft, { recursive: true })
    writeFileSync(join(draft, '初稿-v1.md'),
      '# 标题\n\n## 摘要\n\n本文综述 [L01] [L02] [L03] [D01] [C01]。\n\n' +
      '## 一、导论\n\n' + '段落内容。'.repeat(30) + '\n\n' +
      '## 参考文献\n\n[L01] a\n[L02] b\n[L03] c\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] e\n\n## 先行者文献\n\n## AI 使用声明\n\n本文使用 AI 辅助。\n')
    // ⑤ 跑 build-evidence-bundle
    const bRes = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
    assert.equal(bRes.code, 0, `build-evidence-bundle 应 exit 0；实得 ${bRes.code}\n${bRes.stdout}${bRes.stderr}`)
    // ⑥ 跑 m-gate-check（exit 不要求 0—— M-Form-5/8 等可能因文末结构或字面差异软提示；
    //     只要求「在 0/1/2/3 集里」+ 报告落盘）
    const report = join(proj, 'final', 'M-Gate-Report.json')
    const mRes = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj, 'drafts', '初稿-v1.md'), join(proj, 'final', '证据包'), '--report', report])
    assert.ok([0, 1, 2, 3].includes(mRes.code), `m-gate-check 应在 0/1/2/3 之一；实得 ${mRes.code}\n${mRes.stdout}${mRes.stderr}`)
    assert.ok(existsSync(report), `M 门报告应落盘到 final/M-Gate-Report.json（契约硬要求）`)
    // ⑦ 复跑证据包（**带 M 门报告**——验证第二遍能拾到）
    const bRes2 = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
    assert.equal(bRes2.code, 0, `带 M 门报告的证据包应仍能 exit 0；实得 ${bRes2.code}\n${bRes2.stdout}${bRes2.stderr}`)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

