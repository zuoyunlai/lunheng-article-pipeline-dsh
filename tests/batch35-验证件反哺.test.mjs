// 批次 35（v19.27.0 · 验证件反哺批）：把「行政国家理念跨国流动」验证件暴露的 8 条问题做成契约。
//
// 每条都有反向用例（防把真阳性放过）：
//   C3 M-Exist-4「改哪里」允许纯定位形态（行 71 / §5.2 / 第 3 章 / L 编号）——但「改一下」这类空洞词仍须报；
//   C8 承重墙计数回归钉（同稿 6 条必须数 6，防旧版低报 4 条那种退化）；
//   C1/C2/C4/C5/C7 文档契约：P1→P2 更正、跨卡同源择一、methodology 带 --genre、G14 报告 N=轮次、
//   §11 预算 vs 反方字数、T9 派发带字数余量。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, mkProject } from './_fixtures.mjs'

const MEXIST = pathToFileURL(join(SCRIPTS, '_lib', 'mgate-gates', 'mexist-gates.mjs')).href
const SK = join(ROOT, 'skills', 'lunheng-article-pipeline')
const H6 = '| 编号 | 严重度 | 改哪里 | 怎么改 | 验收标准 | 关闭状态 |\n|---|---|---|---|---|---|\n'

const mkE4 = (rows) => {
  const { proj, fin, aud, ev } = mkProject({ audits: true, drafts: true })
  const draftPath = join(fin, '定稿.md')
  writeFileSync(draftPath, '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(aud, '审计报告-v1.md'),
    `# 审计报告 v1\n\n## 结论\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${H6}${rows.join('\n')}\n`)
  writeFileSync(join(aud, '复核报告-v1.md'), '# 复核报告 v1\n\n## 结论\n\n结论：复核通过\n')
  return { proj, draftPath, aud, ev }
}
const runE4 = async (rows) => {
  const { mExist4 } = await import(MEXIST)
  const f = mkE4(rows)
  const results = []
  mExist4({ draftPath: f.draftPath, evDir: f.ev, auditsDirOf: () => f.aud, results })
  const r = results.at(-1)
  return String(r.detail) + ' ' + (r.soft ? r.soft.join(' ') : '')
}

test('C3 ①「改哪里」填「行 71」= 纯定位，不得判「空缺或过于笼统」', async () => {
  const d = await runE4(['| P1-8 | P1 | 行 71 | 删该因果句，改「制度变革先于系统表述」 | grep 「而不是相反」= 0 | 待复核 |'])
  assert.ok(!/空缺或过于笼统/.test(d), '纯定位形态被误判为笼统：' + d.slice(0, 120))
})

test('C3 ②「改哪里」填「改一下」= 空洞词，必须报（反向用例）', async () => {
  const d = await runE4(['| P1-9 | P1 | 改一下 | 删该句子 | 该段无该句 | 待复核 |'])
  assert.match(d, /空缺或过于笼统/, '空洞定位必须仍被报出')
})

test('C3 ③ 其余两列仍用 4 字阈值（「怎么改」填「改」必须报）', async () => {
  const d = await runE4(['| P1-9 | P1 | §5.2 | 改 | 该段无该句 | 待复核 |'])
  assert.match(d, /「怎么改」列空缺或过于笼统/)
})

test('C8 承重墙计数：同稿 6 条 top1 必须数出 6（防旧版低报 4 条）', async () => {
  const { mForm8 } = await import(pathToFileURL(join(SCRIPTS, '_lib', 'mgate-gates', 'mform-gates.mjs')).href)
  const { proj, fin, ev } = mkProject({ drafts: true })
  const wall = `### 承重墙清单（top1；每行带「论点N」）

| 论点 | 承重证据 top1 | 落章 | 负载 | 超载 |
|---|---|---|---|---|
| 论点1 | [L01] | 一 | 1 | 否 |
| 论点2 | [L02] | 一 | 1 | 否 |
| 论点3 | [L01] | 一 | 2 | 否 |
| 论点4 | [L02] | 二 | 2 | 否 |
| 论点5 | [L01] | 二 | 3 | 否 |
| 论点6 | [L02] | 二 | 3 | 否 |
`
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), '# 大纲\n\n## §11\n\n' + wall, 'utf8')
  const draft = `# 题

## 摘要

摘要 [L01]。

## 一、甲

甲段论证 [L01][D01]。

## 二、乙

乙段 [L02][D02]。

### 承重墙清单（top1；每行带「论点N」）

| 论点 | 承重证据 top1 | 落章 | 负载 | 超载 |
|---|---|---|---|---|
| 论点1 | [L01] | 一 | 1 | 否 |
| 论点2 | [L02] | 一 | 1 | 否 |
| 论点3 | [L01] | 一 | 2 | 否 |
| 论点4 | [L02] | 二 | 2 | 否 |
| 论点5 | [L01] | 二 | 3 | 否 |
| 论点6 | [L02] | 二 | 3 | 否 |

## 参考文献

[L01] a

[L02] b

## 数据来源

### 数据卡

[D01] x

[D02] y

## 案例来源

## 先行者文献

## AI 使用声明

AI。
`
  const dp = join(fin, '定稿.md')
  writeFileSync(dp, draft, 'utf8')
  const results = []
  mForm8({ draftPath: dp, evDir: ev, results })
  const r = results.at(-1)
  const d = String(r.detail)
  assert.match(d, /承重墙 6 条/, '应数出 6 条承重墙：' + d.slice(0, 160))
})

test('C1/C2/C4/C5/C7 文档契约：六处新增判据必须在场且含关键措辞', () => {
  const hard = readFileSync(join(SK, 'references', '_shared', '机检硬格式.md'), 'utf8')
  assert.match(hard, /实现判 \*\*P2\*\*（「有证据但缺/, 'C1 须更正纯 S 段档位为 P2')
  assert.match(hard, /正文承重只引最贴切的一个编号/, 'C1 须有跨卡同源择一规则')
  const card07 = readFileSync(join(SK, 'references', 'agents', '07-审计-auditor.md'), 'utf8')
  assert.match(card07, /methodology-check[^\n]*--genre/, 'C2 T7 卡须要求 methodology-check 带 --genre')
  const card08 = readFileSync(join(SK, 'references', 'agents', '08-终检-finalizer.md'), 'utf8')
  assert.match(card08, /③′.*战略门三脚本也带/, 'C2 T8 卡须有 ③′ 战略门带 --genre')
  const dc = readFileSync(join(SK, 'references', 'dispatch-cards.md'), 'utf8')
  assert.match(dc, /N = 被审正文轮次，严禁固定/, 'C4 派发卡须写明 G14 报告 N=轮次')
  assert.match(dc, /把字数余量写进任务/, 'C7 派发卡须要求 T9 带字数余量')
  const card04 = readFileSync(join(SK, 'references', 'agents', '04-分析-analyst.md'), 'utf8')
  assert.match(card04, /反方段字数下限之和/, 'C5 04 卡须含预算-反方自洽约束')
})
