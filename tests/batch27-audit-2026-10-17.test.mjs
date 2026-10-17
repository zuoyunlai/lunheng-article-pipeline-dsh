// 回放反哺 2026-10-17（全量审计九维）里**已复现**的三条静默失效：
//   P0-1 `count-chars --summary` 丢 `--report`
//   P0-3 `--lite-profile` 报告不自证（下游把 5 门当全量）
//   P1-1 仅软提示与真失败在报告里同形（pass=false）
// 本文件只钉「报告面 / 退出码面」的可观测事实，不重测既有门逻辑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { run, tmp, ROOT } from './_fixtures.mjs'

const S = (n) => join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', n)
const COUNT = S('count-chars.mjs')
const MGATE = S('m-gate-check.mjs')

const DRAFT = '# 标题\n\n## 摘要\n\n本文引用 [L01] 与 [D01]。\n\n## 一、正文\n\n' + '汉'.repeat(300)
  + '\n\n## 参考文献\n\n[1] 某文.\n\n## 数据来源\n\n[D01] 某数据\n\n## 案例来源\n\n'
  + '## 先行者文献\n\n## AI 使用声明\n\n本文由 AI 辅助。\n'

test('P0-1：`--summary --report` 必须真的落盘（旧版 exit 0 但文件不存在）', () => {
  const d = tmp('lunheng-p01-')
  try {
    const doc = join(d, 'a.md')
    writeFileSync(doc, DRAFT, 'utf8')
    const out = join(d, 'out.json')
    const r = run([COUNT, doc, '--summary', '--report', out])
    assert.equal(r.code, 0, '--summary 本身仍须 exit 0：' + r.out.slice(0, 300))
    assert.ok(existsSync(out), '`--summary --report` 必须产出报告文件——这正是 T7/T8 的标准调用方式')
    const j = JSON.parse(readFileSync(out, 'utf8'))
    assert.equal(j.mode, 'summary', '落盘内容须与 stdout 同源同形（mode=summary）')
    assert.equal(typeof j.body.hanChars, 'number', '报告须含正文区字数')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('P0-1 反向：`--report` 指向目录 → exit 70（证据缺失不得报成功）', () => {
  const d = tmp('lunheng-p01b-')
  try {
    const doc = join(d, 'a.md')
    writeFileSync(doc, DRAFT, 'utf8')
    const r = run([COUNT, doc, '--summary', '--report', d])   // d 是目录
    assert.equal(r.code, 70, '落盘失败属「闸门实据缺失」→ 70（与 m-gate-check 同码），实得 ' + r.code + '：' + r.out.slice(0, 300))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('P0-3：`--lite-profile` 报告必须自证是子集（lite_profile + gates_skipped）', () => {
  const d = tmp('lunheng-p03-')
  try {
    const fin = join(d, 'run', 'proj', 'final')
    const ev = join(fin, '证据包')
    mkdirSync(ev, { recursive: true })
    const doc = join(fin, '定稿.md')
    writeFileSync(doc, DRAFT, 'utf8')
    const out = join(d, 'rep.json')
    run([MGATE, doc, ev, '--lite-profile', '--report', out])
    assert.ok(existsSync(out), 'lite 模式同样要落报告')
    const j = JSON.parse(readFileSync(out, 'utf8'))
    assert.equal(j.total, 5, 'lite 只保留 5 门：实得 ' + j.total)
    assert.equal(j.lite_profile, true, '必须自证「这是快轨子集」——旧版报告与全量同形，下游会把 5 门当 26 门')
    assert.equal(j.gates_skipped, 25 - 5, '跳过门数须=全量门数−本次执行门数（不得写死常量外的假值）：实得 ' + j.gates_skipped)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('P1-1：仅软提示 → pass:true + soft_only:true（不得与真失败同形）', () => {
  const d = tmp('lunheng-p11-')
  try {
    const proj = join(d, 'run', 'proj')
    const fin = join(proj, 'final')
    const ev = join(fin, '证据包')
    mkdirSync(ev, { recursive: true })
    mkdirSync(join(proj, 'analysis'), { recursive: true })
    writeFileSync(join(fin, '定稿.md'), DRAFT, 'utf8')
    // 已加载 3 条：L01/D01 被正文引用，L02 读了未引 → 只触发**软提示**（无硬问题）
    writeFileSync(join(proj, 'analysis', '素材加载清单.md'),
      '# 素材加载清单\n\n## 已加载\n\n- [L01] 某文\n- [L02] 另一文\n- [D01] 某数据\n', 'utf8')
    writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 索引\n\n[L01] 某文（2020）\n[L02] 另一文（2021）\n', 'utf8')
    writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 索引\n\n[D01] 某数据（2021）\n', 'utf8')
    const out = join(d, 'rep.json')
    run([MGATE, join(fin, '定稿.md'), ev, '--report', out])
    const j = JSON.parse(readFileSync(out, 'utf8'))
    const r = j.results.find((x) => /M-Form-11/.test(x.gate || ''))
    assert.ok(r, '报告必须含 M-Form-11')
    assert.equal(r.pass, true, '仅有软提示时 pass 不得为 false（旧判据 `!hard && soft.length===0` 让提示与失败同形）')
    assert.equal(r.soft_only, true, '软提示须以 `soft_only` 显式留痕（否则「已复核」与「无提示」同形）')
    assert.equal(r.severity, 'P2', '软提示仍是 P2 档（不改严重度，只改 pass 语义）')
    assert.ok(j.soft_only_count >= 1, '报告须给出 soft_only 计数（exit 3 的依据之一）')
    // 本夹具还带着与 M-Form-11 无关的硬失败（缺任务简报 / 大纲 / 审计报告），故整门 exit 必为 2，
    //   无法在此断言「仅软提示 ⇒ exit 3」。这里只钉**软提示不得被读成通过**；exit 3 的分支由
    //   `m-gate-check.mjs` 的 `softOnlyCount > 0` 承担（其正确性靠 soft_only_count 与 pass 两个字段
    //   共同可观测——若将来有人删掉该分支，报告仍是 pass:true，但 soft_only_count 会让复核者追问）。
    assert.notEqual(j.exit, 0, '软提示不得被读成「全门通过」：实得 exit=' + j.exit)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// P0-4：信任级别「并列多档」不得被当成合规（v19.11.2 · 反哺 2026-10-17 §P0-4）
// ─────────────────────────────────────────────────────────────────────────────
// 病灶：模板把三档写成格式示例 `已发布 / 主人投喂 / 二手转引`，而 TRUST_COMPLIANT_RE 只取紧跟冒号的
//   首个档位 → 照抄模板即判「已发布」（最高档）且 M-Form-6 绿灯，证据分级分母同步失真、无门可报。
import { trustConflictTokens } from '../skills/lunheng-article-pipeline/scripts/_lib/trust.mjs'

test('P0-4 单元：并列多档 → 判歧义；括号内他档 / 分布统计行 → 不误判', () => {
  assert.deepEqual(
    trustConflictTokens('- 信任级别：已发布 / 主人投喂 / 二手转引'),
    ['已发布', '主人投喂', '二手转引'],
    '三档并列必须被识别为歧义',
  )
  assert.equal(
    trustConflictTokens('- 信任级别：已发布（备注：本文二手转引自某日报）'),
    null,
    '括号内出现的另一档位词不得判并列——v18.2.6 的「备注污染」修复不得回归',
  )
  assert.equal(
    trustConflictTokens('- 信任级别声明**：已发布 33 条 / 主人投喂 0 条'),
    null,
    '分布统计行（信任级别声明）不匹配前缀，不得误判为歧义',
  )
  assert.equal(trustConflictTokens('- 信任级别：主人投喂'), null, '单档必须放行')
})

test('P0-4 集成：数据卡并列多档 → M-Form-6 判歧义 P1（不得绿灯）', () => {
  const d = tmp('lunheng-p04-')
  try {
    const proj = join(d, 'run', 'proj')
    const fin = join(proj, 'final')
    const ev = join(fin, '证据包')
    mkdirSync(ev, { recursive: true })
    writeFileSync(join(fin, '定稿.md'), DRAFT, 'utf8')   // DRAFT 引用 [D01]
    writeFileSync(join(ev, '数据卡.md'), [
      '# 数据卡',
      '',
      '## 索引',
      '',
      '[D01] 某数据（2021）',
      '',
      '### [D01] 某数据',
      '',
      '- 信任级别：已发布 / 主人投喂 / 二手转引',
      '- 口径说明：演示',
      '',
    ].join('\n'), 'utf8')
    const out = join(d, 'rep.json')
    run([MGATE, join(fin, '定稿.md'), ev, '--report', out])
    const j = JSON.parse(readFileSync(out, 'utf8'))
    const r = j.results.find((x) => /M-Form-6/.test(x.gate || ''))
    assert.ok(r, '报告必须含 M-Form-6')
    assert.equal(r.pass, false, '并列多档不得判通过（否则照抄模板即静默标最高信任档）')
    assert.equal(r.severity, 'P1', '歧义属「填写形式错但后果是证据失真」→ P1：实得 ' + r.severity)
    assert.match(r.detail, /歧义/, 'detail 必须点名歧义：' + r.detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// P1-11：门报告 schema 版本化 + `--verify-report` 只读体检
// ─────────────────────────────────────────────────────────────────────────────
test('P1-11：新报告带 schema_version=2；--verify-report 能分出 当前/legacy/缺文件', () => {
  const d = tmp('lunheng-p111-')
  try {
    const fin = join(d, 'run', 'proj', 'final')
    const ev = join(fin, '证据包')
    mkdirSync(ev, { recursive: true })
    writeFileSync(join(fin, '定稿.md'), DRAFT, 'utf8')
    const out = join(d, 'rep.json')
    run([MGATE, join(fin, '定稿.md'), ev, '--report', out])

    const ok = run([MGATE, '--verify-report', out])
    assert.equal(ok.code, 0, '当前 schema 的报告须判 0：' + ok.out.slice(0, 300))
    const okJson = JSON.parse(ok.stdout.slice(ok.stdout.indexOf('{')))
    assert.equal(okJson.schema_version, 2, '新报告必须自带 schema_version=2')
    assert.equal(okJson.ok, true)

    const legacy = join(d, 'legacy.json')
    writeFileSync(legacy, JSON.stringify({ schema: 'x', 项目: 'p', 判定: '通过' }), 'utf8')
    const lg = run([MGATE, '--verify-report', legacy])
    assert.equal(lg.code, 1, '无 schema_version 的历史报告须判 1（需人工分诊）')
    assert.equal(JSON.parse(lg.stdout.slice(lg.stdout.indexOf('{'))).legacy, true)

    assert.equal(run([MGATE, '--verify-report', join(d, 'nope.json')]).code, 10, '缺文件须 10（参数/路径错）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
