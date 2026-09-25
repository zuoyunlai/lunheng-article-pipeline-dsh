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
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'

const M = () => join(SCRIPTS, 'm-gate-check.mjs')
const FOUR = '① 逐条枚举：M-Form-11 属格式严格度；② 真阳性扫描：全稿无对应硬缺陷；③ 规范冲突说明：与机检契约不冲突；④ 独立复核来源：T7 审计报告-v2 复核'

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
    const adj = adjFile(f.dir, { true_p0: 0, true_p1: 0, verdict: 'Pass（T8 裁定）', llm_review: FOUR })
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

test('拒绝③（L-44）：命中硬 P0 红线时裁定一律不采信 → exit 30，报告保持机械值', () => {
  const f = mkClean()
  try {
    // 删掉「案例来源」节 → M-Form-2 红线
    const t = readFileSync(f.draft, 'utf8').replace('## 案例来源\n\n- [C01] 案例\n\n', '')
    writeFileSync(f.draft, t)
    run([M(), f.draft, f.ev, '--report', f.report])
    const before = readReport(f.report)
    assert.ok(before.hard_red_line_hits.some((h) => /M-Form-2/.test(h)), '夹具应命中 M-Form-2 红线：' + JSON.stringify(before.hard_red_line_hits))
    const adj = adjFile(f.dir, { true_p0: 0, true_p1: 0, verdict: 'Pass', llm_review: FOUR })
    const r = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
    assert.equal(r.code, 30, '红线命中时裁定应被拒：' + r.out + r.err)
    assert.match(String(r.err || r.out), /硬 P0 红线/)
    assert.equal(readReport(f.report).exit, before.exit, '被拒时报告必须保持机械值')
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
