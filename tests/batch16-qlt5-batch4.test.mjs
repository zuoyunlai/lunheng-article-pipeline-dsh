// v18.52.0（QLT-5 实测反哺批次 4）**量具与配对键**回归：F-BA / F-BB / F-BC
//
// 本批三条与前几批的分工：批次 1 改**读数**、批次 2 改**判据**、批次 3 改**约定落点**；
//   本批改的是**量具本身**：
//     · F-BA：M-Exist-4 的**配对键**（旧口径 latest×latest 硬配对 → B 轨轮次后「最新复核报告」的验证对象
//             可以不是审计任务书 → 字面成立、语义错位的 P1）；
//     · F-BB：**写入次序**（换稿重裁的中间态被"如实"写进交付报告的机械面）；
//     · F-BC：**效度**（QLT-1 的每个分量都是门计数代理 → 它测的是合规，不是质量；本实验 10 条实质论证
//             条件被关闭而分数**一个分量都没动**）。
//   三条各配一条**反向控制组**（旧行为不得被放宽带走）：
//     · F-BA：两份候选都不覆盖 → 仍须报「未覆盖」；
//     · F-BB：闸门记录指向**旧稿**时不得误标中间态；
//     · F-BC：读数（score / coverage / components）本身不得因正名而改变。
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCRIPTS, run, tmp, mkProject } from './_fixtures.mjs'

const M = join(SCRIPTS, 'm-gate-check.mjs')
const Q = join(SCRIPTS, 'quality-score.mjs')
const MEXIST = pathToFileURL(join(SCRIPTS, '_lib', 'mgate-gates', 'mexist-gates.mjs')).href
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

// ── F-BA：M-Exist-4 的配对键 = 编号 N（不是「最新」） ─────────────────────────────

/** 审计报告（结论=打回 + 任务书 4 项）。 */
const AUDIT = [
  '# 审计报告-v1',
  '',
  '## 结论',
  '',
  '结论：打回修订（P0 2 项 / P1 2 项）',
  '',
  '## 修订任务书',
  '',
  '| 编号 | 严重度 | 改哪里 | 怎么改 | 验收标准 | 关闭状态 |',
  '|---|---|---|---|---|---|',
  '| P0-1 | P0 | §2.1 论证段 | 补 [L12] 的回引与差异点声明 | 正文出现 [L12] 且给出差异点 | 已关闭 |',
  '| P0-2 | P0 | §3.4 机制段 | 把形式描述改成可观察机制 | 该段给出至少一条可证伪预测 | 已关闭 |',
  '| P1-1 | P1 | §4.2 数据段 | 补时效标注（截止 YYYY-MM） | 每个 [Dxx] 含截止月 | 已关闭 |',
  '| P1-2 | P1 | §5.1 结语段 | 压缩重复表述 | 该段字数下降且论点保留 | 已关闭 |',
  '',
].join('\n')

/** 复核报告：`ids` 为空数组即「不覆盖任何审计编号」（模拟验证对象不同）。 */
const REVIEW = (v, ids) => [
  `# 复核报告-v${v}`,
  '',
  '## 结论',
  '',
  ids.length ? '结论：复核通过（条目闭环成立）' : '结论：复核完成（本轮验证对象 = `analysis/批判报告-v2.md` §3.4 的关闭条件，非审计任务书）',
  '',
  ids.length ? `对位声明：覆盖 ${ids.join(' / ')}` : '本轮未核审计任务书编号（验证对象见上）。',
  '',
].join('\n')

/** 造一个 M-Exist-4 直调夹具；`reviews` = [{v, ids}]。 */
const mkPairing = (reviews) => {
  const { d, proj, fin, aud } = mkProject({ audits: true, drafts: true })
  mkdirSync(aud, { recursive: true })
  const draftPath = join(fin, '定稿.md')
  writeFileSync(draftPath, '# 标题\n\n## 摘要\n\n正文。\n')
  writeFileSync(join(aud, '审计报告-v1.md'), AUDIT)
  for (const r of reviews) writeFileSync(join(aud, `复核报告-v${r.v}.md`), REVIEW(r.v, r.ids))
  writeFileSync(join(proj, 'drafts', '修订说明-v1.md'), '# 修订说明 v1\n')
  return { d, draftPath, aud }
}
const runMExist4 = async (f) => {
  const { mExist4 } = await import(MEXIST)
  const results = []
  mExist4({ draftPath: f.draftPath, evDir: null, auditsDirOf: () => f.aud, results })
  const r = results.at(-1)
  assert.ok(r, 'mExist4 必须推一条结果')
  return { detail: String(r.detail), severity: r.severity, pass: r.pass }
}
const IDS4 = ['P0-1', 'P0-2', 'P1-1', 'P1-2']

test('mexist-gates（F-BA）：同号复核报告覆盖时**不得**因「最新复核报告不覆盖」判 P1', async () => {
  // 正是实测形态：复核报告-v1 关闭了 10 项，复核报告-v2 的验证对象不是审计任务书
  const f = mkPairing([{ v: 1, ids: IDS4 }, { v: 2, ids: [] }])
  try {
    const r = await runMExist4(f)
    assert.equal(/未覆盖/.test(r.detail), false, '同号 v1 已覆盖 → 不得报「未覆盖」：' + r.detail)
    assert.equal(r.pass, true, '不得判失败：' + r.detail)
    assert.match(r.detail, /同号配对 v1/, 'detail 必须写明配对依据（读者要能看出凭什么配对）：' + r.detail)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('mexist-gates（F-BA 反向控制组）：两份候选都不覆盖 → 仍须报「未覆盖 N 个审计编号」', async () => {
  const f = mkPairing([{ v: 1, ids: [] }, { v: 2, ids: [] }])
  try {
    const r = await runMExist4(f)
    assert.match(r.detail, /未覆盖 4 个审计编号/, '真缺口不得被配对放宽带走：' + r.detail)
    assert.equal(r.pass, false, '真缺口必须判失败：' + r.detail)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('mexist-gates（F-BA）：无同号时退回「最新复核报告」（旧形态不得被削弱）', async () => {
  const f = mkPairing([{ v: 3, ids: IDS4 }])   // 只有 v3，没有 v1
  try {
    const r = await runMExist4(f)
    assert.equal(/未覆盖/.test(r.detail), false, '最新复核报告覆盖 → 通过：' + r.detail)
    assert.match(r.detail, /退回最新/, 'detail 须写明是「无同号 → 退回最新」：' + r.detail)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

// ── F-BB：换稿重裁的中间态（`transient` / `write_run`） ──────────────────────────

/** 最小可过项项目（跑 M 门用）+ 可注入的既有报告 / 闸门记录。 */
const mkTransient = ({ prevSha, gateSha }) => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  mkdirSync(aud, { recursive: true })
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n摘要正文 [L01] [D01]。\n\n'
    + '## 一、论证\n\n' + '这一节承载描述性叙述，交代样本来源与口径边界。'.repeat(6) + ' [L01] [D01]。\n\n'
    + '## 参考文献\n\n- [L01] 甲. 题名[J]. 刊, 2024.\n\n## 数据来源\n\n- [D01] 机构 2024\n\n'
    + '## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\n- AI。\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [D01] | 值 | 论点1 |\n\n[D01] y | 机构 | 2024 | url\n      ├ 信任级别：已发布\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [L01] | 综述 | 论点1 |\n\n[L01] 甲. 题名[J]. 刊, 2024.\n      ├ 信任级别：已发布\n')
  writeFileSync(join(ev, '案例卡.md'), '# 案例卡\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n')
  const report = join(fin, 'M-Gate-Report.json')
  if (prevSha) {
    writeFileSync(report, JSON.stringify({
      draft: draft, date: '2026-01-01', total: 1, pass: 0, exit: 0,
      verdict_scope: { draft_name: 'drafts/初稿-v1.md', draft_sha256: prevSha, draft_bytes: 1 },
    }, null, 2))
  }
  if (gateSha) {
    writeFileSync(join(aud, '闸门记录-T7.5.md'), [
      '# 闸门记录 — T7.5', '',
      '| 检查项 | 实据 | 结论 |', '|---|---|---|',
      `| M 门全 exit 0 | \`final/M-Gate-Report.json\` 正文指纹 sha256 ${gateSha} | ✓ |`, '',
    ].join('\n'))
  }
  return { d, draft, ev, report }
}

test('m-gate-check（F-BB）：换稿重裁窗口内落盘须标 `transient: true` + `write_run` 递增；重跑取稳定态', () => {
  const OLD = 'a'.repeat(64)
  const f = mkTransient({ prevSha: OLD, gateSha: null })   // 先建项目（闸门记录指纹要按本稿填）
  try {
    writeFileSync(join(f.d, 'run', 'proj', 'audits', '闸门记录-T7.5.md'), [
      '# 闸门记录 — T7.5', '',
      '| 检查项 | 实据 | 结论 |', '|---|---|---|',
      `| M 门全 exit 0 | \`final/M-Gate-Report.json\` 正文指纹 sha256 ${sha(f.draft)} | ✓ |`, '',
    ].join('\n'))
    const r1 = run([M, f.draft, f.ev, '--report', f.report])
    assert.equal(r1.error, undefined, '子进程必须跑起来：' + r1.out.slice(-300))
    const j1 = JSON.parse(readFileSync(f.report, 'utf8'))
    assert.equal(j1.transient, true, '中间态必须被标注为 transient（旧版只会"如实"写进瞬时值）')
    assert.match(String(j1.transient_reason), /换稿重裁窗口/, '须给出判定依据：' + j1.transient_reason)
    assert.equal(j1.write_run, 2, '既有报告无 write_run → 本次应为第 2 次写入')

    const r2 = run([M, f.draft, f.ev, '--report', f.report])
    assert.equal(r2.error, undefined)
    const j2 = JSON.parse(readFileSync(f.report, 'utf8'))
    assert.equal(j2.transient, false, '第二次运行已是稳定态（报告与闸门记录都指向本稿）')
    assert.equal(j2.write_run, 3, '写入计数继续累加')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('m-gate-check（F-BB 反向控制组）：闸门记录指向**旧稿**时不得误标中间态', () => {
  const f = mkTransient({ prevSha: 'a'.repeat(64), gateSha: 'b'.repeat(64) })
  try {
    const r = run([M, f.draft, f.ev, '--report', f.report])
    assert.equal(r.error, undefined, '子进程必须跑起来：' + r.out.slice(-300))
    const j = JSON.parse(readFileSync(f.report, 'utf8'))
    assert.equal(j.transient, false, '「闸门记录也指向旧稿」不是中间态（两侧一致地指向旧稿）')
    assert.equal(j.write_run, 2, '计数仍须累加')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

// ── F-BC：QLT-1 = 合规分（效度边界落盘） ────────────────────────────────────────

test('quality-score（F-BC）：产出必须自报「合规分」+ 落盘效度边界（可支撑 / 不支撑）', () => {
  const { d, proj, fin } = mkProject()
  try {
    mkdirSync(fin, { recursive: true })
    writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n\n## 一、导论\n\n' + '汉字内容填充。'.repeat(60) + '\n')
    const r = run([Q, proj])
    assert.equal(r.code, 0, '度量门必须 exit 0：' + r.out.slice(-200))
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    assert.equal(j.metric, 'QLT-1')
    assert.equal(j.metricLabel, '合规分（compliance score）', 'QLT-1 的正名必须落进产出（防被读成质量分）')
    assert.equal(j.validity.scope, '合规与成本', '能支撑的结论面')
    assert.equal(j.validity.notScope, '论证质量', '明确**不能**支撑的面（F-BC 的核心）')
    assert.match(String(j.validity.why), /门计数代理/, '须写明根因：每个分量都是门计数代理')
    assert.match(String(j.validity.measured), /10 条实质论证条件/, '须带实测证据（关掉 10 条条件而分数未动）')
    assert.match(String(j.validity.downstream), /F-BC/, '须给下游告警口径')
    assert.equal(/质量回归评分/.test(String(j.meta.description)), false, 'description 不得再自称「质量回归评分」')
    assert.match(String(j.meta.description), /合规分/)
    // 读数本身不得因正名而改变（正名只加标签、不动量尺）
    assert.equal(typeof j.score, 'number')
    assert.equal(typeof j.coverage, 'number')
    assert.ok(Array.isArray(j.components) && j.components.length >= 8, '分量表必须照旧：' + j.components.length)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
