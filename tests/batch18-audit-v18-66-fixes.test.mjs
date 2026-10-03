// v18.67.0（全量审计-v18.66.0 批 1 止血批）回归钉
// 运行：node --test tests/batch18-audit-v18-66-fixes.test.mjs
//
// 覆盖三处：
//   ① m-gate `--adjudicate` 的 true_p0/true_p1 类型校验（旧版 NaN 静默按 0 计、可绕证伪四件套）
//   ② m-gate `.bak` 回滚点拒绝路径（exit 3）必须在 **stdout JSON 里自报 `write_refused`**
//      （旧版该路径发生在 stdout 打印之后 → final-check 把它误读成「仅 P2 残留」，语义相反）
//   ③ lib/guard writtenPaths 数组分支的深度哨兵传播（旧版嵌套数组超深被吞 → B-5 失效）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const MG = () => join(SCRIPTS, 'm-gate-check.mjs')

/** 最小可跑项目：m-gate 只需 draft + evidence 目录（门值不必全过，本组用例不依赖机械值）。 */
const mk = () => {
  const d = tmp('lunheng-b18-')
  const proj = join(d, 'proj')
  const fin = join(proj, 'final')
  const ev = join(proj, 'evidence')
  mkdirSync(fin, { recursive: true })
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n'
    + '## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] c\n\n## 先行者文献\n\n[先01] p\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 📇 索引段\n\n'
    + '| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [L01] | 甲 | 论点1 |\n\n## 正文\n\n### [L01] 条目\n信任级别：已发布\n')
  return { d, proj, fin, ev, draft: join(fin, '定稿.md') }
}

test('B18-①：--adjudicate 的 true_p0/true_p1 非整数（NaN 形态）→ 拒绝裁定 exit 30，不得静默按 0 计', () => {
  const { d, fin, ev, draft } = mk()
  try {
    const adj = join(d, 'adj.json')
    // 旧版病灶：Number("2条")=NaN → NaN>0=false → adjExit=0；若机械值恰为 0 则绕过证伪四件套
    writeFileSync(adj, JSON.stringify({ true_p0: '2条', true_p1: '一', verdict: 'x', llm_review: '逐条 真阳性 规范 复核 独立' }))
    const r = run([MG(), draft, ev, '--adjudicate', adj, '--report', join(fin, 'M-Gate-Report.json')])
    assert.equal(r.code, 30, 'NaN 形态的裁定值必须被拒绝（exit 30），不得采纳：' + (r.out || '').slice(-200) + (r.stderr || '').slice(-200))
    assert.match(r.out + r.stderr, /非负整数/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B18-②：报告被删但 .bak 回滚点仍带裁定 → exit 3 且 stdout JSON 自报 write_refused=orphan_bak_with_t8_verdict', () => {
  const { d, fin, ev, draft } = mk()
  try {
    const reportPath = join(fin, 'M-Gate-Report.json')
    // 手工伪造「带裁定的回滚点」：名形 = <报告名>.<时间戳>.bak，内容含 _t8_conclusion
    const t = Date.now()
    writeFileSync(`${reportPath}.${t}.bak`, JSON.stringify({ exit: 0, _t8_conclusion: { true_p0: 0, true_p1: 0 } }))
    const r = run([MG(), draft, ev, '--report', reportPath])
    assert.equal(r.code, 3, '回滚点仍在的删除-重跑必须拒绝写盘（exit 3）：' + (r.out || '').slice(-200) + (r.stderr || '').slice(-200))
    const j = parseJson(r)
    assert.equal(j.write_refused, 'orphan_bak_with_t8_verdict',
      'stdout JSON 必须自报 write_refused（旧版缺字段 → final-check 误读成「仅 P2 残留」）：' + JSON.stringify(j).slice(0, 200))
    assert.match(r.out + r.stderr, /回滚点仍在/)
    // 对照：--overwrite-adjudicated 显式声明 → 不拒绝（判据可显式越界）
    const r2 = run([MG(), draft, ev, '--report', reportPath, '--overwrite-adjudicated'])
    assert.notEqual(r2.code, 3, '显式 --overwrite-adjudicated 不得再按回滚点拒绝')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('B18-③：guard 数组分支——嵌套数组超深必须拒绝（哨兵不被吞）', async () => {
  // 经由导出的 installMechanismGuard 驱动：fake ctx.tools.guard 直接把回调交还我们，
  //   用第 8 层嵌套数组（> MAX_DEPTH=6）藏一个机制路径候选。
  //   旧版病灶：数组分支丢弃递归返回值 → 哨兵被吞 → 按「部分候选」放行甚至漏判；
  //   修复后必须整体拒绝（B-5「超深→拒绝」对数组形态同样生效）。
  const { installMechanismGuard } = await import(pathToFileURL(join(ROOT, 'lib', 'guard.js')).href)
  let cb = null
  const ctx = { get: (k) => (k === 'tools' ? { guard: (fn) => { cb = fn; return () => {} } } : undefined) }
  const un = installMechanismGuard(ctx, {
    mechanismRoots: [join(ROOT, 'skills', 'lunheng-article-pipeline')],
    skillName: 'lunheng-article-pipeline',
  })
  assert.equal(typeof un, 'function', 'guard 应安装成功（fake ctx 提供 tools.guard）')
  assert.equal(typeof cb, 'function')
  const mechPath = join(ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md')
  let deep = [mechPath]
  for (let i = 0; i < 8; i++) deep = [deep]
  const verdict = cb({ name: 'write', arguments: deep, agent: { session: { header: { cwd: ROOT } } } })
  assert.ok(typeof verdict === 'string' && /嵌套深度超过|拒绝/.test(verdict),
    '超深嵌套数组参数必须被拒绝（不得按部分候选放行）：' + String(verdict).slice(0, 120))
})
