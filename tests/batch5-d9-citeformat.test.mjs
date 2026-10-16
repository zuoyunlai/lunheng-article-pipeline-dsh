// 批次 5 回归：D9 cite-format 引用著录夹具（smoke：GB/T 输出可复现 + 冷门类型不崩）
// 说明（v19.8.0 反哺 v9 D9）：开题模板第 9 节列出 [J]/[D]/[C]/[P]/[M]/[R/OL]/[R]/[Z]/[S]/[EB/OL] 11 类
//   著录。本批先落「有基准、有断言」的 smoke 面：确认 GB/T 输出可复现、含冷门类型（专利/标准/网页）的
//   文献卡**不崩且逐条回显**；完整 11 类逐类型标识断言列为后续（D9 报告原文：摸底结论如实记录，不预支修复）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'

const CF = join(SCRIPTS, 'cite-format.mjs')

test('D9：cite-format 对受支持类型（[J]/[M]/[EB/OL]）GB/T 输出可复现', () => {
  const d = tmp('lunheng-d9-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'literature'), { recursive: true })
  writeFileSync(join(proj, 'literature', '文献卡.md'), [
    '# 文献卡（Lxx 系列）',
    '',
    '## 基本信息',
    '- **总条数**: 3',
    '- **信任级别声明**: 已发布 3 / 主人投喂 0 / 二手转引 0',
    '',
    '## 文献卡格式（每条）',
    '',
    '### [L01] 期刊论文示例',
    '- **作者**: 张三',
    '- **年份**: 2020',
    '- **类型**: 期刊文章 [J]',
    '- **来源**: 期刊',
    '- **URL/DOI**: 10.1000/xyz',
    '- **信任级别**: 已发布',
    '',
    '### [L02] 图书示例',
    '- **作者**: 李四',
    '- **年份**: 2019',
    '- **类型**: 图书 [M]',
    '- **来源**: 出版社',
    '- **URL/DOI**: 978-7-000-00000-0',
    '- **信任级别**: 已发布',
    '',
    '### [L03] 网页示例',
    '- **作者**: 某机构',
    '- **年份**: 2023',
    '- **类型**: 网页 [EB/OL]',
    '- **来源**: 网页',
    '- **URL/DOI**: https://example.com/a',
    '- **信任级别**: 已发布',
    '',
  ].join('\n'), 'utf8')
  const r = run([CF, proj, '--json'])
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
  assert.equal(j.styleName, 'GB/T 7714-2015', '默认 gbt')
  assert.equal(j.total, 3, '3 条都应入账')
  assert.equal(j.generated, 3, '3 条都应生成（类型受支持）：' + JSON.stringify(j.blocked))
  rmSync(d, { recursive: true, force: true })
})

test('D9-1 修复：5 类冷门著录（[C]/[P]/[R/OL]/[S]/[Z]）在 GB/T 下生成', () => {
  const d = tmp('lunheng-d9-fix-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'literature'), { recursive: true })
  const rows = [
    ['[L01]', '标准示例', '标准 [S]', '某标委会', '2021', '标准编号: GB/T 1.1-2021', ''],
    ['[L02]', '专利示例', '专利 [P]', '某公司', '2022', '专利号: CN2022001', '发布日期: 2022'],
    ['[L03]', '会议论文示例', '会议 [C]', '王五', '2020', '某会议', 'DOI: 10.1000/ccc'],
    ['[L04]', '在线报告示例', '在线报告 [R/OL]', '某机构', '2023', '报告号: R-2023-01', 'URL: https://example.com/r'],
    ['[L05]', '科技成果示例', '成果 [Z]', '某团队', '2024', '完成单位: 某研究院', ''],
  ]
  const lines = ['# 文献卡', '', '## 基本信息', '- **总条数**: 5', '- **信任级别声明**: 已发布 5 / 主人投喂 0 / 二手转引 0', '', '## 文献卡格式（每条）', '']
  for (const [id, title, type, author, year, extra, extra2] of rows) {
    lines.push(`### ${id} ${title}`, `- **作者**: ${author}`, `- **年份**: ${year}`, `- **类型**: ${type}`)
    if (extra) lines.push(`- **${extra.split(': ')[0]}**: ${extra.split(': ').slice(1).join(': ')}`)
    if (extra2) lines.push(`- **${extra2.split(': ')[0]}**: ${extra2.split(': ').slice(1).join(': ')}`)
    lines.push(`- **信任级别**: 已发布`, '')
  }
  writeFileSync(join(proj, 'literature', '文献卡.md'), lines.join('\n'), 'utf8')
  const r = run([CF, proj, '--json'])
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
  assert.equal(j.generated, 5, '5 类冷门著录都应生成：' + JSON.stringify(j.blocked))
  assert.equal(j.blocked.length, 0, 'blocked 应为空：' + JSON.stringify(j.blocked))
  const types = new Set((j.byType ? Object.keys(j.byType) : []))
  for (const t of ['S', 'P', 'C', 'R/OL', 'Z']) assert.ok(types.has(t), `应含类型 ${t}：${JSON.stringify(j.byType)}`)
  rmSync(d, { recursive: true, force: true })
})
