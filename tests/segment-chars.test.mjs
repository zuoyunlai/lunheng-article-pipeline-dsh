// segment-chars 分段字数实测脚本回归测试（v18.2.8 发版前审计补：此前该脚本零专属覆盖）
// 覆盖：--list 结构 / --section 单节与多节求和 / 选择器前缀匹配 / 纯汉字口径 / 退出码（0 与 10）。
// 运行：node --test tests/segment-chars.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const SCRIPT = join(SCRIPTS, 'segment-chars.mjs')

// 最小夹具：两个 H2，各带一句不含标题汉字的正文
const TWO_H2 = '## 甲节\n内容一二三。\n## 乙节\n内容四五六七。\n'

test('segment-chars --list：列出 H2 标题与各节汉字数，节体不计入节标题自身', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, TWO_H2)
  const r = run([SCRIPT, f, '--list'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const j = parseJson(r)
  assert.equal(j.mode, 'list')
  // total 计全文汉字（含两个节标题「甲节」「乙节」各 2 字）
  assert.equal(j.total.hanChars, 15, '全文汉字 = 甲节2 + 正文5 + 乙节2 + 正文6')
  assert.equal(j.headingCount, 2)
  assert.equal(j.headings.length, 2)
  assert.equal(j.headings[0].title, '甲节')
  assert.equal(j.headings[0].level, 2)
  assert.equal(j.headings[0].hanChars, 5, '甲节节体只计「内容一二三」5 字，不含标题')
  assert.equal(j.headings[1].title, '乙节')
  assert.equal(j.headings[1].hanChars, 6)
  rmSync(d, { recursive: true, force: true })
})

test('segment-chars --section：单节与多节命中，sum 等于各节之和', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, TWO_H2)
  const one = parseJson(run([SCRIPT, f, '--section', '甲节']))
  assert.equal(one.mode, 'sections')
  assert.equal(one.sections.length, 1)
  assert.equal(one.sections[0].title, '甲节')
  assert.equal(one.sections[0].hanChars, 5)
  assert.equal(one.sum.hanChars, 5)
  const two = parseJson(run([SCRIPT, f, '--section', '甲节', '--section', '乙节']))
  assert.equal(two.sections.length, 2)
  assert.equal(two.sum.hanChars, 11, '5 + 6')
  rmSync(d, { recursive: true, force: true })
})

test('segment-chars：选择器前缀匹配（"3.6" 命中 "3.6 反方论证"，支持派发话术的短选择器）', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, '## 3.6 反方论证\n反驳甲。\n## 3.7 补强\n补强乙。\n')
  const r = run([SCRIPT, f, '--section', '3.6'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const j = parseJson(r)
  assert.equal(j.sections.length, 1)
  assert.equal(j.sections[0].title, '3.6 反方论证')
  assert.equal(j.sections[0].hanChars, 3, '「反驳甲」3 字')
  rmSync(d, { recursive: true, force: true })
})

test('segment-chars：纯汉字口径——标点/数字/ASCII 一律不计入', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, '## 甲节\n正文，共 100 字。ABC 123。\n')
  const j = parseJson(run([SCRIPT, f, '--section', '甲节']))
  assert.equal(j.sections[0].hanChars, 4, '「正文共字」4 字，标点/100/ABC/123 全排除')
  rmSync(d, { recursive: true, force: true })
})

test('segment-chars：参数/路径错误一律 exit 10（与 0=成功、70=内部错误区分）', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, TWO_H2)
  assert.equal(run([SCRIPT]).code, 10, '缺文件参数 → 10')
  assert.equal(run([SCRIPT, f]).code, 10, '既无 --list 也无 --section → 10')
  assert.equal(run([SCRIPT, join(d, '不存在.md')]).code, 10, '文件不存在 → 10')
  assert.equal(run([SCRIPT, f, '--section']).code, 10, '--section 缺选择器值 → 10')
  rmSync(d, { recursive: true, force: true })
})

test('segment-chars：选择器未命中 exit 10，并给出可用标题清单辅助改参', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, TWO_H2)
  const r = run([SCRIPT, f, '--section', '不存在节'])
  assert.equal(r.code, 10)
  assert.match(r.out, /未命中/, '必须明确报「未命中」而非静默空结果')
  assert.match(r.out, /甲节/, '必须列出可用标题帮助改参')
  rmSync(d, { recursive: true, force: true })
})

// ── v18.82.0（LongWriter 借鉴批 LW-2）：--budget 模式与 Sl 观测分 ─────────────────────────
//   覆盖三判据：软区间内满分 / 缺节 Sl=0 且进 missing / 大纲无「字数预算」节 exit 10。
//   Sl 不改 exit 语义（成功一律 0）——这是本模式的契约底线。
test('segment-chars --budget：软区间内（dev≤10%）Sl 满分 5，输出不参与判级声明', () => {
  const d = tmp()
  const f = join(d, 'draft.md')
  // 草稿：甲节 198 字（预算 200，dev=1%）；乙节 275 字（预算 250，dev=10%——边界含等号）
  writeFileSync(f, '## 甲节\n' + '汉'.repeat(198) + '\n## 乙节\n' + '汉'.repeat(275) + '\n')
  const o = join(d, '分析大纲.md')
  writeFileSync(o, '# 大纲\n### 字数预算\n| 节 | 要点 | 预算 |\n|---|---|---|\n| 甲节 | A | 200字 |\n| 乙节 | B | 250字 |\n')
  const r = run([SCRIPT, f, '--budget', o])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const j = parseJson(r)
  assert.equal(j.mode, 'budget')
  assert.equal(j.rows.length, 2)
  assert.equal(j.rows[0].sl, 5, 'dev=1% → 满分')
  assert.equal(j.rows[1].sl, 5, 'dev=10% → 仍在软区间内，满分（边界含等号）')
  assert.equal(j.weightedSl, 5)
  assert.equal(j.missing.length, 0)
  assert.match(j.metric, /不参与.*判级|观测/, '输出必须自带「不判级」声明')
  rmSync(d, { recursive: true, force: true })
})

test('segment-chars --budget：缺节进 missing 计 Sl=0，超软区间线性衰减，均不改 exit', () => {
  const d = tmp()
  const f = join(d, 'draft.md')
  // 甲节预算 100 实测 160（dev=60% → Sl = 5 − 4×0.5/0.9 ≈ 2.778）；丙节缺 → missing
  writeFileSync(f, '## 甲节\n' + '汉'.repeat(160) + '\n## 乙节\n' + '汉'.repeat(100) + '\n')
  const o = join(d, '分析大纲.md')
  writeFileSync(o, '# 大纲\n### 字数预算\n| 节 | 预算 |\n|---|---|\n| 甲节 | 100字 |\n| 丙节 | 300字 |\n')
  const r = run([SCRIPT, f, '--budget', o])
  assert.equal(r.code, 0, 'Sl 低不改变 exit（观测不是闸门）')
  const j = parseJson(r)
  assert.equal(j.rows.length, 1, '丙节未命中不进 rows')
  assert.deepEqual(j.missing, ['丙节'])
  assert.ok(Math.abs(j.rows[0].sl - (5 - 4 * 0.5 / 0.9)) < 0.01, '线性衰减公式')
  assert.ok(j.weightedSl < 5, '含缺失时加权分 < 满分（missing 不进加权但 rows 已衰减）')
  rmSync(d, { recursive: true, force: true })
})

test('segment-chars --budget：大纲无「字数预算」节 / 预算行全为噪声 → exit 10（参数错误族，非新码）', () => {
  const d = tmp()
  const f = join(d, 'draft.md')
  writeFileSync(f, '## 甲节\n' + '汉'.repeat(100) + '\n')
  const noSec = join(d, '大纲-无节.md')
  writeFileSync(noSec, '# 大纲\n只有正文，没有预算节。\n')
  assert.equal(run([SCRIPT, f, '--budget', noSec]).code, 10, '无「字数预算」标题 → 10')
  const noRows = join(d, '大纲-无行.md')
  writeFileSync(noRows, '# 大纲\n### 字数预算\n| 节 | 备注 |\n|---|---|\n| 甲节 | 无数字 |\n')
  assert.equal(run([SCRIPT, f, '--budget', noRows]).code, 10, '预算节内无可解析行 → 10')
  assert.equal(run([SCRIPT, f, '--budget', join(d, '不存在.md')]).code, 10, '预算文件不存在 → 10')
  assert.equal(run([SCRIPT, f, '--budget', noSec, '--list']).code, 10, '--budget 与 --list 互斥 → 10')
  rmSync(d, { recursive: true, force: true })
})
