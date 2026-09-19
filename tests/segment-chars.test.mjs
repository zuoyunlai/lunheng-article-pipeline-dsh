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
