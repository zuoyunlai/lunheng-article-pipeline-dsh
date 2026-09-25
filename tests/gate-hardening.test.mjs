// v18.12.0（2026-09-25 全量审计第三梯队）：门自身可信度回归。
//
// 覆盖四项：
//   · **L-53** 部署镜像内 `REPO_ROOT` 自比（规则⑨ 恒真假绿 + 版本真源被换成别的包）→ 现须 **exit 10**；
//   · **L-46** `M-Form-8` 只扫前 20 段（第 21 段起静默不扫）→ 现须全量扫；
//   · **L-35** 空数据卡上的**空集真空通过**（M-Exist-3 / M-Form-6 输出「全部达标」）→ 现须如实记「未核」；
//   · **L-47** 正文指纹互锁（闸门记录里的 sha256 必须与报告的 `verdict_scope.draft_sha256` 一致）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, ROOT, run, parseJson, tmp } from './_fixtures.mjs'

const gateOf = (r, prefix) => parseJson(r).results.find((x) => x.gate.startsWith(prefix))

/** 造最小项目：draft + 证据包（可指定数据卡内容） */
const mk = ({ draft, dataCard, litCard } = {}) => {
  const dir = tmp('lunheng-hard-')
  const fin = join(dir, 'final'); const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  const d = join(fin, '定稿.md')
  writeFileSync(d, draft ?? '# 标题\n\n## 摘要\n\n正文 [L01] [D01]。\n\n## 一、论证\n\n正文 [L01] [D01]。\n')
  writeFileSync(join(ev, '数据卡.md'), dataCard ?? '# 数据卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n```\n[D01] 值 ｜ 主题 ｜ 论点1\n```\n\n[D01] 值 | 机构 | 2024 | url\n      ├ 信任级别：已发布\n')
  writeFileSync(join(ev, '文献卡.md'), litCard ?? '# 文献卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n```\n[L01] 综述 ｜ 论点1\n```\n\n[L01] 作者. 题名[J]. 刊, 2024.\n      ├ 信任级别：已发布\n')
  return { dir, draft: d, ev }
}

test('L-53 布局探测：只有 package.json、没有 skills/lunheng-article-pipeline/SKILL.md 的“伪根”必须 exit 10（不得静默用错根）', () => {
  // 复刻部署镜像的目录形状：<tmp>/.dsh/skills/lunheng-article-pipeline/{scripts,…} + <tmp>/.dsh/package.json
  const base = tmp('lunheng-layout-')
  const fakeSkill = join(base, '.dsh', 'skills', 'lunheng-article-pipeline')
  try {
    cpSync(SCRIPTS, join(fakeSkill, 'scripts'), { recursive: true })
    cpSync(join(SCRIPTS, '..', 'references'), join(fakeSkill, 'references'), { recursive: true })   // SCRIPTS 的父目录 = 技能根
    writeFileSync(join(base, '.dsh', 'package.json'), JSON.stringify({ name: 'lunheng-article-pipeline', version: '18.10.0' }, null, 2))
    const r = run([join(fakeSkill, 'scripts', 'consistency-check.mjs')])
    assert.equal(r.code, 10, '伪根下必须 exit 10（旧版会退到 .dsh 并把它当仓库根 → 规则⑨自比假绿）：' + r.out + r.err)
    assert.match(String(r.err || r.out), /布局探测失败|参数或路径错误|不要.*文档漂移/)
  } finally { rmSync(base, { recursive: true, force: true }) }
})

test('L-46：第 21 段之后的缺 [Lxx] 段必须被扫到（旧版 slice(0,20) 静默跳过）', () => {
  const secs = []
  for (let i = 1; i <= 21; i++) secs.push(`## 论点${i}\n\n${'论' + i + '述'.repeat(0)}${'内容'.repeat(80)} [L01]。\n`)
  secs.push(`## 论点22\n\n${'末尾'.repeat(80)}\n`)   // 第 22 段：>100 汉字且**无 [Lxx]** → 必须报
  const { dir, draft, ev } = mk({ draft: `# 标题\n\n## 摘要\n\n摘要正文 [L01] [D01]。\n\n${secs.join('\n')}` })
  try {
    const m8 = gateOf(run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev]), 'M-Form-8')
    assert.equal(m8.pass, false, '第 22 段缺 [Lxx] 必须被判（旧版扫不到）：' + JSON.stringify(m8))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-35：数据卡 0 条条目时，M-Exist-3 与 M-Form-6 必须如实记「未核」（不得输出「全部达标」）', () => {
  const emptyCard = '# 数据卡\n\n> 总条数 0 条\n\n## 📇 索引段\n\n无。\n'
  // 正文不引 [Dxx]（真空场景：卡空 + 正文零引用）
  const { dir, draft, ev } = mk({
    draft: '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、论证\n\n正文 [L01]。\n',
    dataCard: emptyCard,
  })
  try {
    const j = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev]))
    const e3 = j.results.find((x) => x.gate.startsWith('M-Exist-3'))
    const f6 = j.results.find((x) => x.gate.startsWith('M-Form-6'))
    assert.match(String(e3.detail), /未核/, 'M-Exist-3 必须显式记「未核」：' + JSON.stringify(e3))
    assert.doesNotMatch(String(e3.detail), /全部 \[Dxx\] 在数据卡有对应/, '不得输出「全部对应」这种假达标')
    assert.match(String(f6.detail), /未核/, 'M-Form-6 必须显式记「未核」：' + JSON.stringify(f6))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-47：闸门记录里的 sha256 与报告正文指纹不一致 → 报（指纹互锁）', () => {
  const dir = tmp('lunheng-sha-')
  const fin = join(dir, 'final'); const ev = join(fin, '证据包'); const au = join(dir, 'audits')
  mkdirSync(ev, { recursive: true }); mkdirSync(au, { recursive: true })
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文 [L01] [D01]。\n\n## 参考文献\n\n- [L01] x\n\n## 数据来源\n\n- [D01] y\n\n## 案例来源\n\n- [C01] z\n\n## 先行者文献\n\n- [先01] w\n\n## AI 使用声明\n\n- AI。\n')
  writeFileSync(join(au, '审计报告-v1.md'), '# 审计报告\n\n结论：通过\n')
  writeFileSync(join(fin, 'M-Gate-Report.json'), JSON.stringify({
    script_exit_raw: 0, exit: 0, verdict_stale: false,
    verdict_scope: { draft_sha256: 'a'.repeat(64) },
  }, null, 2))
  const rows = [
    ['审计报告最新版存在', 'audits/审计报告-v1.md', '✓'],
    ['P0/P1 清单已列', 'audits/审计报告-v1.md §修订任务书', '✓'],
    ['M 门全部 exit 0', 'm-gate-check.mjs → exit 0', '✓'],
    ['证据包指纹占位符', `final/证据包/数据卡.md（sha256=${'b'.repeat(64)}）`, '✓'],
    ['引用闭环（M-Exist-3：[Dxx] 正文 ↔ 数据卡条目）', 'final/证据包/数据卡.md', '✓'],
    ['论文交付物 vs 报告独立隔离', 'final/证据包/审计报告-v1.md', '✓'],
    ['修订轮由独立写手执行', 'audits/审计报告-v1.md', '✓'],
  ]
  writeFileSync(join(au, '闸门记录-T7.5.md'), ['# 闸门记录', '', '| 检查项 | 实据（路径 / exit code） | 结论 | 失败原因 |', '|---|---|---|---|', ...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | |`), ''].join('\n'))
  try {
    // 注意：不以 --report 指向项目内，避免覆盖夹具
    const it = gateOf(run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev]), 'M-Exist-5')
    assert.equal(it.pass, false, '指纹不一致必须报：' + JSON.stringify(it))
    assert.match(String(it.detail), /sha256|指纹/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
