// v18.64.0（反哺报告-v5 §v5.0-1）：**阶段边界显式化**回归 —— 普通 `--report` 不得静默覆盖带 T8 裁定的报告。
//
// 病灶（实测事故）：`m-gate-check.mjs --report <path>` 对**任何调用者一视同仁**——工具层没有阶段身份校验。
//   题2 的 G14 终闸子代理用 `--report final/M-Gate-Report.json` 覆盖了 T8 阶段的裁定报告
//   （14 278 B → 9 609 B），**阶段边界被静默破坏**，且只在 `.bak` 时间序列里才看得出来。
// 修法（判据）：**不挂在「你是谁」**（身份只能自报，自报不可信），而挂在「**是否显式声明**」——
//   要跨越阶段边界，必须显式带 `--overwrite-adjudicated`；不带则拒绝写盘 + exit 3（需人工复核）。
//   判据一句话：**防的是静默越界，不是禁止越界**（同 `对照表` 的「不设防同改清单，防的是静默」）。
//
// 五条钉子：①**反向钉**：无裁定的报告照旧可覆盖（判据不得扩大）；② 含裁定 + 换稿 → 拒绝 + 报告字节不变；
//   ③ 显式旗标 → 放行且旧裁定段保留；④ `--adjudicate` 正式通道不被新判据拦；⑤ 源码钉 + 用法串在场。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'

const M = () => join(SCRIPTS, 'm-gate-check.mjs')
const FOUR = '① 逐条枚举：M-Form-11 属格式严格度；② 真阳性扫描：全稿无对应硬缺陷；③ 规范冲突说明：与机检契约不冲突；④ 独立复核来源：T7 审计报告-v2 复核'
const DRAFT = (marker) => '# 标题\n\n## 摘要\n\n摘要正文 [L01] [L02] [L03] [D01]。\n\n## 一、论证\n\n'
  + `${marker} 论述 [L01] [L02] [L03] [D01] [C01] [先01]。\n\n## 参考文献\n\n- [L01] 作者甲. 题名[J]. 刊, 2024.\n`
  + '- [L02] 作者乙. 题名[J]. 刊, 2023.\n- [L03] 作者丙. 题名[J]. 刊, 2022.\n\n## 数据来源\n\n- [D01] 机构 2024\n\n'
  + '## 案例来源\n\n- [C01] 案例\n\n## 先行者文献\n\n- [先01] 甲. 题名[M]. 2023.（完整著录详见参考文献 [L01]）\n\n## AI 使用声明\n\n- AI。\n'

/** 无红线项目（机械值 = 1，仅 M-Form-11 P1；与 adjudicate 夹具同形，已实测） */
const mkClean = () => {
  const dir = tmp('lunheng-own-')
  const fin = join(dir, 'final'); const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(dir, '01-任务简报.md'), '# 任务简报\n\n## 研究问题（主控拆解，3-5 个子问题）\n\n1. 子问题一？\n2. 子问题二？\n3. 子问题三？\n\n## 数据需求\n\n- 需找数据点：≥1 条\n')
  writeFileSync(join(fin, '定稿.md'), DRAFT('初稿'))
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [D01] | 值 | 论点1 |\n\n[D01] y | 机构 | 2024 | url\n      ├ 信任级别：已发布\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n> 总条数 3 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [L01] | 综述 | 论点1 |\n| [L02] | 机制 | 论点1 |\n| [L03] | 数据 | 论点1 |\n\n[L01] 作者甲. 题名[J]. 刊, 2024.\n      ├ 信任级别：已发布\n\n[L02] 作者乙. 题名[J]. 刊, 2023.\n      ├ 信任级别：已发布\n\n[L03] 作者丙. 题名[J]. 刊, 2022.\n      ├ 信任级别：已发布\n')
  writeFileSync(join(ev, '案例卡.md'), '# 案例卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [C01] | 案例 | 论点1 |\n\n[C01] 某案例\n      ├ 信任级别：已发布\n')
  return { dir, fin, draft: join(fin, '定稿.md'), ev, report: join(fin, 'M-Gate-Report.json') }
}

const readReport = (p) => JSON.parse(readFileSync(p, 'utf8'))
const bytes = (p) => readFileSync(p)

/** 落一份「含 T8 裁定」的报告：先跑机械值，再走 --adjudicate 正式通道。返回 { adj, mech } */
const withVerdict = (f) => {
  const r0 = run([M(), f.draft, f.ev, '--report', f.report])
  const j0 = readReport(f.report)
  assert.equal(r0.code, j0.exit, '进程码应等于机械值：' + r0.out + r0.err)
  assert.notEqual(j0.exit, 0, '夹具机械值须非 0（否则「需要裁定」的前提不成立）')
  assert.deepEqual(j0.hard_red_line_hits, [], '夹具不得命中硬 P0 红线（否则裁定通道会被拒）：' + JSON.stringify(j0.hard_red_line_hits))
  const adj = join(f.dir, 't8.json')
  // v18.80.4（全量审计 P1-10）：裁定值 0 ≠ 机械值 → 须给 refutations 一条对一条覆盖全部硬失败项
  const refutations = (j0.results || [])
    .filter((x) => x.pass === false && x.severity !== 'LLM 兜底' && x.severity !== 'ERROR')
    .map((x) => ({ gate: String(x.gate || '').split(' ')[0], basis: `T8 复核：${String(x.gate || '').split(' ')[0]} 为假阳性，依据见复核报告（测试夹具）` }))
  writeFileSync(adj, JSON.stringify({ true_p0: 0, true_p1: 0, verdict: 'Pass（T8 裁定）', llm_review: FOUR, refutations }))
  const r1 = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
  assert.equal(r1.code, 0, '裁定应被接受（进程码 = 裁定值 0）：' + r1.out + r1.err)
  assert.equal(readReport(f.report).exit, 0)
  return { adj, mech: j0.exit }
}

test('① 反向钉：**无裁定**的报告在换稿后照旧可被普通 --report 覆盖（判据不得扩大）', () => {
  const f = mkClean()
  try {
    const r0 = run([M(), f.draft, f.ev, '--report', f.report])   // 只落机械值，无 T8 裁定
    const mech = readReport(f.report).exit
    assert.equal(readReport(f.report)._t8_conclusion, undefined)
    writeFileSync(f.draft, DRAFT('第二稿'))                       // 换稿
    const r = run([M(), f.draft, f.ev, '--report', f.report])
    const j = readReport(f.report)
    assert.equal(r.code, j.exit, '无裁定时不得触发拒绝（应照旧落盘本次机械值）：' + r.out + r.err)
    assert.equal(j.exit, j.script_exit_raw, '落盘 exit 应等于本次机械值（未被拒）')
    assert.equal(j._t8_conclusion, undefined, '本就无裁定段')
    assert.notEqual(r0.code, 3, '夹具首跑不该是 3')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('② 含 T8 裁定 + 换稿 + 普通 --report → **拒绝覆盖**（exit 3、报告字节不变、给出两条出路）', () => {
  const f = mkClean()
  try {
    withVerdict(f)
    const before = bytes(f.report)
    writeFileSync(f.draft, DRAFT('第二稿'))                   // 换稿 → 旧裁定绑定的正文已不是本稿
    const r = run([M(), f.draft, f.ev, '--report', f.report])
    assert.equal(r.code, 3, '应拒绝覆盖并以 exit 3（需人工复核）收场：' + r.out + r.err)
    const all = String(r.out || '') + String(r.err || '')
    assert.match(all, /拒绝覆盖/)
    assert.match(all, /--overwrite-adjudicated/, '必须告知出路①（显式旗标）')
    assert.match(all, /--adjudicate/, '必须告知出路②（正式裁定通道）')
    assert.ok(before.equals(bytes(f.report)), '磁盘报告必须**逐字节不变**（拒绝 = 不写盘）')
    assert.equal(readReport(f.report).exit, 0, '既有裁定值原样保留')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('③ 显式 --overwrite-adjudicated → 放行；旧裁定段保留、verdict_stale 标 true', () => {
  const f = mkClean()
  try {
    const { mech } = withVerdict(f)
    writeFileSync(f.draft, DRAFT('第二稿'))
    const r = run([M(), f.draft, f.ev, '--report', f.report, '--overwrite-adjudicated'])
    const j = readReport(f.report)
    assert.notEqual(r.code, 3, '显式旗标下不得再拒绝：' + r.out + r.err)
    assert.equal(j.exit, j.script_exit_raw, '落盘 exit 应改用本次机械值（而非旧裁定值）')
    assert.notEqual(j.exit, 0, `落盘 exit 不该还是旧裁定值 0（旧机械值 ${mech}）：` + r.out + r.err)
    assert.equal(r.code, j.exit, '进程码应等于本次机械值')
    assert.equal(j.verdict_stale, true, '旧裁定须标为过期')
    assert.ok(j._t8_conclusion, '旧裁定段原文仍保留供追溯（keep 列表）')
    assert.ok(j.verdict_scope?.draft_sha256, '报告须绑定本版正文指纹')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('④ --adjudicate 正式通道不被新判据拦（换稿后重裁照常走）', () => {
  const f = mkClean()
  try {
    const { adj } = withVerdict(f)
    writeFileSync(f.draft, DRAFT('第二稿'))
    const r = run([M(), f.draft, f.ev, '--report', f.report, '--adjudicate', adj])
    assert.equal(r.code, 0, '裁定通道不得被阶段边界判据拦下：' + r.out + r.err)
    assert.equal(readReport(f.report).verdict_stale, false, '新裁定应绑定本版正文')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('⑦ 回滚点守卫（v18.64.2 · 独立审计 A-P0-②）：带裁定的回滚点仍在时，**删报告再跑**必被拒', () => {
  const f = mkClean()
  try {
    withVerdict(f)
    // 关键前置：裁定之后再发生**一次写盘**（同稿复跑即可）——`writeReport` 会把**带裁定的报告**备份成
    // `<名>.<时间戳>.bak`，这才是「有人删掉了带裁定的报告」唯一能留下的痕迹。
    const rp = run([M(), f.draft, f.ev, '--report', f.report])
    // 同稿复跑：**进程码 = 本次机械值**（F-BF① 的既定语义），而**报告里保留的裁定值仍是 0**——
    //   故这里钉的是「没被拒 + 裁定仍在」，不是「进程码 0」。
    assert.notEqual(rp.code, 3, '同稿复跑应放行（判据不扩大）：' + rp.out + rp.err)
    assert.equal(readReport(f.report).exit, 0, '同稿复跑应保留 T8 裁定值 0')
    assert.ok(readReadBackups(f.report).some((b) => /"_t8_conclusion"/.test(readFileSync(b, 'utf8'))),
      '前置不成立：没有带裁定的 .bak，本用例失去意义')
    rmSync(f.report)                                   // 「重跑」的恢复动作 = 绕过路径
    writeFileSync(f.draft, DRAFT('第二稿'))
    const r = run([M(), f.draft, f.ev, '--report', f.report])
    assert.equal(r.code, 3, '删报告后重跑应被拒：' + r.out + r.err)
    assert.match(String(r.err || r.out), /回滚点仍在/)
    assert.equal(existsSync(f.report), false, '拒绝 = 不写盘（目标仍不存在）')
    const r2 = run([M(), f.draft, f.ev, '--report', f.report, '--overwrite-adjudicated'])
    assert.notEqual(r2.code, 3, '显式旗标下应放行：' + r2.out + r2.err)
    assert.ok(existsSync(f.report), '放行后报告应落盘')
    const j = readReport(f.report)
    assert.equal(j.exit, j.script_exit_raw, '落盘为本机械值')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('⑦b **如实登记的边界**：裁定报告「最后一次写盘就是它自己」时，删掉后 .bak 无裁定痕迹 → 本守卫不触发', () => {
  // 为什么把这条**钉进测试**而不是留白：本守卫只覆盖「.bak 里还留着裁定」的那条链；对「写完裁定就被删」
  //   的短链它看不到任何痕迹。**明删不在「防静默越界」的范围内**（同 ADR-0004 的 Negative：它挡不住有意
  //   毁灭证据的调用方）——所以这里**如实登记**该残余，并把期望行为钉住：将来若有人给 m-gate 加了墓碑
  //   （tombstone）之类的更强判据，这条用例会红，提醒他同步更新 ADR 与文档。
  const f = mkClean()
  try {
    withVerdict(f)
    rmSync(f.report)
    writeFileSync(f.draft, DRAFT('第二稿'))
    const r = run([M(), f.draft, f.ev, '--report', f.report])
    assert.notEqual(r.code, 3, '短链（裁定后无再次写盘）本守卫看不到痕迹 → 不拦（已知边界）')
    const j = readReport(f.report)
    assert.equal(j.exit, j.script_exit_raw, '落盘为本次机械值')
    assert.equal(j._t8_conclusion, undefined, '旧裁定确实丢失——这就是那条边界的代价（已在 ADR-0004 认赔）')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

const readReadBackups = (reportPath) => {
  const dir = join(reportPath, '..')
  const base = reportPath.split(/[\\/]/).pop()
  try {
    return readdirSync(dir).filter((f) => f.startsWith(base + '.') && f.endsWith('.bak')).map((f) => join(dir, f))
  } catch { return [] }
}

test('⑥ 端到端（v18.64.2 自审修正）：经 `final-check` 这条 T8 主管道，拒绝指引**必须真的送达**操作者', () => {
  const f = mkClean()
  try {
    withVerdict(f)
    const before = bytes(f.report)
    writeFileSync(f.draft, DRAFT('第二稿'))
    const FC = join(SCRIPTS, 'final-check.mjs')
    // ① 人类路径（不带 --json）：旧版只打印「非零退出 3」，而两条出路只在 m-gate 的 stderr 上
    //    → 操作者看不到该怎么办。本用例把那句话钉住。
    const r = run([FC, f.dir])
    assert.equal(r.code, 3, 'final-check 应透传 3：' + r.out + r.err)
    const all = String(r.out || '') + String(r.err || '')
    assert.match(all, /拒绝覆盖/, 'final-check 必须把该步 stderr 转出来（否则操作者只看到 exit 3）')
    assert.match(all, /--overwrite-adjudicated/, '两条出路必须可见')
    assert.ok(before.equals(bytes(f.report)), '磁盘报告仍必须逐字节不变')
    // ② 机器路径（--json）：`outputs['m-gate']` 是该步 **stdout** 的值 → 必须带「未落盘」标注，
    //    否则只读 JSON 的消费者会以为报告已被更新（与 F-BF① 同型的「产物说 A、退出码说 B」）。
    const fcJson = join(f.fin, 'fc-probe.json')
    const r2 = run([FC, f.dir, '--json', '--report', fcJson])
    assert.equal(r2.code, 3)
    const fc = JSON.parse(readFileSync(fcJson, 'utf8'))
    assert.equal(fc.exit, 3, 'final-check 顶层 exit 应等于失败步的退出码')
    assert.equal(fc.outputs['m-gate']._stdoutOnly, true, '失败步的 stdout 值必须被标注为「落盘未确认」')
    assert.equal(fc.outputs['m-gate'].write_refused, 'existing_t8_verdict_on_changed_draft',
      'm-gate 必须在 stdout 上自陈「拒写」——final-check 的摘要块据此判断磁盘报告是不是本次产物')
    assert.equal(fc.summary.mGate.stableExit, null, '拒写时稳定态必须置 null（不得给出会被误读成「通过」的 0）')
    assert.equal(fc.summary.mGate.reportIsStale, true, '摘要块必须标明读到的是磁盘旧报告')
    assert.match(String(fc.summary.recommendation), /拒绝写盘|拒绝覆盖/, '推荐语必须点明拒写，不得说「以 T8 裁定值放行」')
    const gmStep = fc.steps.find((s) => s.step === 'm-gate-check.mjs')
    assert.equal(gmStep.exit, 3)
    assert.match(String(gmStep.stderrTail || ''), /拒绝覆盖/, 'steps[] 里必须带该步 stderr 尾部')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('⑤ 源码钉：判据**只有一处实现**（`refuseOverwrite`），且四个条件齐备、拒绝分支消费它', () => {
  const src = readFileSync(M(), 'utf8')
  // v18.64.2 起判据上提为 `const refuseOverwrite = …`（既供 stdout 的 `write_refused` 字段用，
  //   也供拒绝分支用）——源码钉因此改为钉**那个定义**，并额外钉「分支消费同一变量」
  //   （防后人把条件复制回分支里 → 重新变成同一事实两处实现）。
  const at = src.indexOf('const refuseOverwrite')
  assert.ok(at > 0, '未找到 `const refuseOverwrite` 定义（源码钉失效）')
  const decl = src.slice(at, at + 500)
  for (const need of ['!adjudicatePath', '!overwriteAdjudicated', 'prevHadVerdict', 'prevSha !== draftSha256']) {
    assert.ok(decl.includes(need), `拒写判据缺 ${need}（要么锁死裁定通道，要么判据扩大）`)
  }
  assert.match(src, /else if \(refuseOverwrite\)/, '拒绝分支必须**消费**同一判据变量，不得再抄一份条件')
  // 用法串必须印出新旗标——否则用户看到 exit 3 却不知道出路（旗标存在但不可发现）
  assert.match(src, /用法: node m-gate-check\.mjs [^\n]*--overwrite-adjudicated/, '用法串必须含 --overwrite-adjudicated')
  assert.match(src, /同给时本旗标无效/, '用法串必须写明与 --adjudicate 同给时的语义')
  // 唯一串联方必须能透传，否则 T8 的正当换稿重裁会在这层被硬挡
  const fc = readFileSync(join(SCRIPTS, 'final-check.mjs'), 'utf8')
  assert.ok(fc.includes("'--overwrite-adjudicated'"), 'final-check.mjs 必须支持该旗标的透传')
})
