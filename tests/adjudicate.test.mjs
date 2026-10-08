// v18.12.0（2026-09-25 全量审计 L-05 落地）：**T8 裁定正式通道** `--adjudicate` 回归。
//
// 教训：此前「重跑后重新裁定」没有正式通道 —— 脚本只在正文指纹未变时保留既有裁定，指纹一变就把
//   `exit` 打回机械值；T8 想保留裁定只能**手写报告**（实战项目为此自建 `tools/merge-m-gate-report.js`
//   直接 `rj.exit = 0`，产出 `exit=0` + `verdict_stale=true` 这种自相矛盾的交付物）。
// 现在这条通道自带四道校验：① 须与 --report 同用；② 裁定须给 true_p0/true_p1；
//   ③ **硬 P0 红线不可兜底**（L-44）；④ **改机械值须给证伪四件套**（L-03）。
//   且**进程退出码 = 裁定值**（避免「产物说放行、退出码说 P0」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'

const M = () => join(SCRIPTS, 'm-gate-check.mjs')
const FOUR = '① 逐条枚举：M-Form-11 属格式严格度；② 真阳性扫描：全稿无对应硬缺陷；③ 规范冲突说明：与机检契约不冲突；④ 独立复核来源：T7 审计报告-v2 复核'

/** v18.80.4（全量审计 P1-10）：裁定值 ≠ 机械值时须给 `refutations` 一条对一条覆盖全部硬失败项——
 *   本助手从**机械报告**派生（与脚本判据同源：排除 LLM 兜底 / ERROR 档）。 */
const refutationsOf = (j) => (j.results || [])
  .filter((x) => x.pass === false && x.severity !== 'LLM 兜底' && x.severity !== 'ERROR')
  .map((x) => ({ gate: String(x.gate || '').split(' ')[0], basis: `T8 复核：${String(x.gate || '').split(' ')[0]} 为假阳性，逐项依据见 audits/复核报告（测试夹具）` }))

/** 造一个「无红线」项目：机械 exit=1（仅 M-Form-11 P1），red=[] —— 已实测 */
const mkClean = () => {
  const dir = tmp('lunheng-adj-')
  const fin = join(dir, 'final'); const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(dir, '01-任务简报.md'), '# 任务简报\n\n## 研究问题（主控拆解，3-5 个子问题）\n\n1. 子问题一？\n2. 子问题二？\n3. 子问题三？\n\n## 数据需求\n\n- 需找数据点：≥1 条\n')
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n摘要正文 [L01] [L02] [L03] [D01]。\n\n## 一、论证\n\n正文论述 [L01] [L02] [L03] [D01] [C01] [先01]。\n\n## 参考文献\n\n- [L01] 作者甲. 题名[J]. 刊, 2024.\n- [L02] 作者乙. 题名[J]. 刊, 2023.\n- [L03] 作者丙. 题名[J]. 刊, 2022.\n\n## 数据来源\n\n- [D01] 机构 2024\n\n## 案例来源\n\n- [C01] 案例\n\n## 先行者文献\n\n- [先01] 甲. 题名[M]. 2023.（完整著录详见参考文献 [L01]）\n\n## AI 使用声明\n\n- AI。\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [D01] | 值 | 论点1 |\n\n[D01] y | 机构 | 2024 | url\n      ├ 信任级别：已发布\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n> 总条数 3 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [L01] | 综述 | 论点1 |\n| [L02] | 机制 | 论点1 |\n| [L03] | 数据 | 论点1 |\n\n[L01] 作者甲. 题名[J]. 刊, 2024.\n      ├ 信任级别：已发布\n\n[L02] 作者乙. 题名[J]. 刊, 2023.\n      ├ 信任级别：已发布\n\n[L03] 作者丙. 题名[J]. 刊, 2022.\n      ├ 信任级别：已发布\n')
  writeFileSync(join(ev, '案例卡.md'), '# 案例卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [C01] | 案例 | 论点1 |\n\n[C01] 某案例\n      ├ 信任级别：已发布\n')
  return { dir, draft: join(fin, '定稿.md'), ev, report: join(fin, 'M-Gate-Report.json') }
}

const readReport = (p) => JSON.parse(readFileSync(p, 'utf8'))
const adjFile = (dir, obj) => { const p = join(dir, 't8.json'); writeFileSync(p, JSON.stringify(obj, null, 2)); return p }

test('先确认夹具的机械值（无红线、非 0）——裁定通道的前提', () => {
  const f = mkClean()
  try {
    const r = run([M(), f.draft, f.ev, '--report', f.report])
    const j = readReport(f.report)
    assert.equal(r.code, j.exit, '进程码应等于机械值')
    assert.deepEqual(j.hard_red_line_hits, [], '本夹具不应命中红线：' + JSON.stringify(j.hard_red_line_hits))
    assert.notEqual(j.exit, 0, '机械值须非 0，才能验证「改值须给四件套」')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('成功路径：机械 1 → 裁定 0（含证伪四件套）→ 写入并**进程码 = 裁定值**', () => {
  const f = mkClean()
  try {
    run([M(), f.draft, f.ev, '--report', f.report])                       // 先落机械值
    const adj = adjFile(f.dir, { true_p0: 0, true_p1: 0, verdict: 'Pass（T8 裁定）', llm_review: FOUR, refutations: refutationsOf(readReport(f.report)) })
    const r = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
    assert.equal(r.code, 0, '裁定后进程码应为裁定值 0：' + r.out + r.err)
    const j = readReport(f.report)
    assert.equal(j.exit, 0, '报告 exit 应为裁定值')
    assert.equal(j.script_exit_raw, 1, '机械原值必须保留（禁改）')
    assert.equal(j.verdict_stale, false, '裁定应绑定本版正文（verdict_stale=false）')
    assert.equal(j._t8_conclusion.true_p0, 0)
    assert.match(String(j._t8_adjudicated_by), /--adjudicate/)
    assert.ok(j.verdict_scope?.draft_sha256, '报告须带正文指纹')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('拒绝①：改机械值但**没有证伪四件套** → exit 30，报告保持机械值', () => {
  const f = mkClean()
  try {
    run([M(), f.draft, f.ev, '--report', f.report])
    const adj = adjFile(f.dir, { true_p0: 0, true_p1: 0, verdict: 'Pass', llm_review: '看起来是假阳性' })
    const r = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
    assert.equal(r.code, 30, '裁定无效应 exit 30：' + r.out + r.err)
    assert.match(String(r.err || r.out), /四件套|拒绝裁定/)
    assert.equal(readReport(f.report).exit, 1, '被拒时报告必须保持机械值')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('P2-5 回归：**错误提示不得印出校验所依赖的关键词**（否则粘贴提示即可通过四件套校验）', () => {
  const f = mkClean()
  try {
    run([M(), f.draft, f.ev, '--report', f.report])
    // 造一个「非法 JSON」的裁定文件 → 走 :583 的解析失败分支（那里打印「期望 JSON」模板）
    const bad = join(f.dir, 'bad-adjudicate.json')
    writeFileSync(bad, '{ not json ')
    const r = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', bad])
    assert.equal(r.code, 10, '裁定文件非 JSON 应 exit 10：' + r.out + r.err)
    const all = String(r.out || '') + String(r.err || '')
    const expectLine = all.split('\n').find((l) => l.includes('期望 JSON')) || ''
    assert.ok(expectLine, '应给出期望 JSON 形状的提示')
    // 与 m-gate-check.mjs 的 `FOUR = [/逐条/, /真阳性/, /规范/, /复核|独立/]` 一致：
    //   提示行里**不得**出现这些字面量——否则把提示原文粘进 `llm_review` 即可满足校验。
    //   ⚠️ 只断言**这一行**：拒绝分支的「理由」文本会正当引用关键词（那条路径 exit 30 不写盘，
    //   不构成漏洞）——本用例第一版对全输出断言，被自己的诊断纠正（实测输出 §P2-5 那次 9/10 红）。
    for (const kw of ['逐条', '真阳性', '规范', '复核', '独立']) {
      assert.ok(
        !expectLine.includes(kw),
        `「期望 JSON」提示行里出现了校验关键词「${kw}」→ 粘贴提示即可通过四件套校验（P2-5 病灶）。该行：${expectLine.slice(0, 300)}`,
      )
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('P1-10（v18.80.4）：证伪四件套关键词齐但**无 refutations** → exit 30（词语命中不构成证据）', () => {
  const f = mkClean()
  try {
    run([M(), f.draft, f.ev, '--report', f.report])
    const adj = adjFile(f.dir, { true_p0: 0, true_p1: 0, verdict: 'Pass', llm_review: FOUR })   // 故意不给 refutations
    const r = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
    assert.equal(r.code, 30, '关键词齐但无逐条覆盖 → 必须拒：' + r.out + r.err)
    assert.match(String(r.err || r.out), /refutations/, '拒绝理由须点名 refutations')
    assert.equal(readReport(f.report).exit, 1, '被拒时报告保持机械值')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('P1-4（v18.80.4）：门内 ERROR（机械 exit 70）→ 裁定一律拒绝（exit 30）——门没跑通时无可裁定对象', () => {
  const f = mkClean()
  try {
    // 构造 ERROR：① 放一份审计报告（M-Exist-5 的激活前提：hasAudit5）② 闸门记录-T7.5.md 做成目录
    //   → 门 existsSync 通过后 readFileSync 抛 EISDIR → severity ERROR → 机械 exit 70
    mkdirSync(join(f.dir, 'audits'), { recursive: true })
    writeFileSync(join(f.dir, 'audits', '审计报告-v1.md'), '# 审计报告\n\nG 项检查。\n')
    mkdirSync(join(f.dir, 'audits', '闸门记录-T7.5.md'))
    const adj = adjFile(f.dir, { true_p0: 0, true_p1: 0, verdict: 'Pass', llm_review: FOUR, refutations: [{ gate: 'M-Exist-5', basis: '环境读取错误非内容缺陷（测试夹具）' }] })
    const r = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
    const after = readReport(f.report)
    assert.equal(after.exit, 70, `夹具前提：机械值应为 70（实测 ${after.exit}——若非 70，夹具构造失效须调整）`)
    assert.equal(r.code, 30, 'ERROR 存在时裁定必须被拒（旧版会写成裁定 0）：' + r.out + r.err)
    assert.match(String(r.err || r.out), /ERROR/)
    assert.equal(after.verdict_stale, true)
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('拒绝②：裁定文件缺 true_p0/true_p1 → exit 30', () => {
  const f = mkClean()
  try {
    run([M(), f.draft, f.ev, '--report', f.report])
    const adj = adjFile(f.dir, { verdict: 'Pass' })
    const r = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
    assert.equal(r.code, 30, '缺字段应 exit 30：' + r.out + r.err)
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('参数错：裁定文件不存在 → exit 10（不得当成内容失败）', () => {
  const f = mkClean()
  try {
    const r = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', join(f.dir, 'nope.json')])
    assert.equal(r.code, 10, '缺文件应 exit 10：' + r.out + r.err)
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('拒绝③（L-44）：新正文命中硬 P0 时拒绝裁定并覆盖旧放行报告为本次机械值', () => {
  const f = mkClean()
  try {
    // 先让旧正文报告呈现为已裁定放行，再改正文触发 M-Form-2 红线。
    run([M(), f.draft, f.ev, '--report', f.report])
    const prior = readReport(f.report)
    prior.exit = 0
    prior._t8_conclusion = { true_p0: 0, true_p1: 0, note: '旧正文 sha256: 000000000000' }
    writeFileSync(f.report, JSON.stringify(prior, null, 2))
    const t = readFileSync(f.draft, 'utf8').replace('## 案例来源\n\n- [C01] 案例\n\n', '')
    writeFileSync(f.draft, t)
    const adj = adjFile(f.dir, { true_p0: 0, true_p1: 0, verdict: 'Pass', llm_review: FOUR })
    const r = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
    assert.equal(r.code, 30, '红线命中时裁定应被拒：' + r.out + r.err)
    assert.match(String(r.err || r.out), /硬 P0 红线/)
    const after = readReport(f.report)
    assert.equal(after.exit, after.script_exit_raw, '拒绝后磁盘报告 exit 必须是本次机械值')
    assert.equal(after.exit, 2, '夹具的硬红线应机械落为 P0/exit 2')
    assert.equal(after.verdict_stale, true, '旧裁定不得继续伪装成适用于新正文')
    assert.equal(after.verdict_scope?.draft_sha256, createHash('sha256').update(readFileSync(f.draft)).digest('hex'), '落盘指纹必须对应本次正文')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('裁定值 == 机械值时无需四件套（仅作形式化裁定）', () => {
  const f = mkClean()
  try {
    run([M(), f.draft, f.ev, '--report', f.report])
    const adj = adjFile(f.dir, { true_p0: 0, true_p1: 1, verdict: 'Minor' })
    const r = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
    assert.equal(r.code, 1, '裁定值 1 = 机械值 1 → 进程码 1：' + r.out + r.err)
    const j = readReport(f.report)
    assert.equal(j.exit, 1)
    assert.equal(j.script_exit_raw, 1)
    assert.equal(j.verdict_stale, false)
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

// ── v18.48.0（反哺 F-AV）：陈旧旗标**单调性** + 裁定段按**自述指纹**判有效性 ──
// 实测缺陷（题1 臂 B 的 `.bak` 快照序列作证）：
//   ① `verdict_stale` 不在 keep 列表、每次重算，判据只是「`prev.verdict_scope.draft_sha256` == 本次指纹」
//      → **同一正文上第二次运行**必然把上一轮置的 `true` **重置为 false**；
//   ② 裁定段的有效性由「上一次输出恰好也指向新稿」**推定**，而不是看它**自己声明**绑定哪一版
//      → 一度出现「报告自称 `verdict_stale: false` 且绑定新稿，而 `_t8_conclusion.note` 自述绑定旧稿」。
test('m-gate-check（F-AV①）：verdict_stale 为 true 的报告 → 再次运行**不得**被重置为 false（单调）', () => {
  const f = mkClean()
  try {
    run([M(), f.draft, f.ev, '--report', f.report])                                  // 落机械值
    const adj = adjFile(f.dir, { true_p0: 0, true_p1: 0, verdict: 'x', llm_review: FOUR, refutations: refutationsOf(readReport(f.report)) })
    run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adj])             // 写成裁定态
    const base = readReport(f.report)
    assert.equal(base.verdict_stale, false, '前提：裁定后应为未过期')
    // 造出「已过期」的历史态（正文与指纹都不变，只有旗标为 true）——这正是旧版会被"洗白"的形态
    base.verdict_stale = true
    base.verdict_stale_reason = '（测试构造）先前判定为陈旧'
    writeFileSync(f.report, JSON.stringify(base, null, 2))
    run([M(), f.draft, f.ev, '--report', f.report])                                  // 同稿再跑
    const after = readReport(f.report)
    assert.equal(after.verdict_stale, true, '单调：旧版会重置为 false，那正是 F-AV 的实测缺陷')
    assert.match(String(after.verdict_stale_reason || ''), /单调|陈旧|true/, '应保留/说明陈旧原因')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('m-gate-check（F-AV②）：裁定段自述绑定的指纹与正文不符 → 必须判为过期（不得只信 verdict_scope）', () => {
  const f = mkClean()
  try {
    run([M(), f.draft, f.ev, '--report', f.report])
    const adj = adjFile(f.dir, { true_p0: 0, true_p1: 0, verdict: 'x', llm_review: FOUR, refutations: refutationsOf(readReport(f.report)) })
    run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
    const base = readReport(f.report)
    assert.equal(base.verdict_stale, false, '前提：裁定后应为未过期')
    // 关键构造：`verdict_scope` 仍指向**本稿**（旧版据此放行），但裁定段 **note 自述绑定的是另一版**
    base._t8_conclusion.note = '本裁定就 final/定稿.md（sha256 ' + 'a'.repeat(64) + '）作出。'
    writeFileSync(f.report, JSON.stringify(base, null, 2))
    run([M(), f.draft, f.ev, '--report', f.report])
    const after = readReport(f.report)
    assert.equal(after.verdict_stale, true,
      '裁定段自述绑定别的正文 → 必须判过期（旧版只看 verdict_scope，会误判为有效）')
    assert.match(String(after.verdict_stale_reason || ''), /自述绑定|不符/, '过期原因须点名"自述绑定的指纹"')
    assert.notEqual(after.exit, 0, '过期后不得继续沿用旧裁定值')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})