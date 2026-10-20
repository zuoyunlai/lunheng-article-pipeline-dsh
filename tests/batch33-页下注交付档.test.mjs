// 批次 33（2026-10-20 · 页下注/著者-年份交付档批 · `audits/定位错配审计-2026-10-20` E4/B4，主人 2026-10-20 条件启动）
//
// 为什么：文史哲主流刊用页下注 + 著者-出版年制（批 0d：哲学研究投稿须知 + 已发表论文 ≈19 处注释式引注、
//   无编号文献表），而论衡只有「编号 / 内联」两交付形态、字数只读正文（不含注）——人文档的注释字数不可见。
// 本批只增**交付渲染第三档**与**展示读数**，判据一字不动：
//   ① 稿内仍 `[Lxx]`、M-Form-1 / M-Exist-1 不受影响；
//   ② `## 注释` **不得独立成节**（M-Form-7 九节白名单 → 第十个 H2 判 P0），注释必须挂在 `## 数据来源` 的 `### 注释` 子节；
//   ③ `count-chars --with-notes` 双读数只报告、不参与判级；默认输出逐字段不变。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT, SCRIPTS, run } from './_fixtures.mjs'

const SK = join(ROOT, 'skills', 'lunheng-article-pipeline')
const CC = join(SCRIPTS, 'count-chars.mjs')
const FIXTURE = [
  '# 题',
  '',
  '## 摘要',
  '',
  '摘要正文。',
  '',
  '## 引言',
  '',
  '正文汉字若干。',
  '',
  '## 讨论',
  '',
  '本文发现。',
  '',
  '## 数据来源',
  '',
  '### 注释',
  '',
  '① 王德威：《史诗时代的抒情声音》，北京：三联书店，2019年，第360页。',
  '',
  '### 脚注',
  '',
  '② 白先勇：《台北人》，桂林：广西师范大学出版社，2015年，第193页。',
  '',
  '### 数据卡',
  '',
  '[D01] x',
].join('\n')

const tmpMd = (body) => {
  const d = mkdtempSync(join(tmpdir(), 'lunheng-b33-'))
  const f = join(d, 'd.md')
  writeFileSync(f, body, 'utf8')
  return f
}

test('① 文档：文类档案登记「著者-年份」第三交付档 + P5 边界句；README 给渲染规则与「不得独立成节」', () => {
  const archive = readFileSync(join(SK, 'references', '_shared', '文类档案.md'), 'utf8')
  assert.match(archive, /著者-年份/, '文类档案须登记「著者-年份」交付档（引用模式列语义真源）')
  assert.match(archive, /交付渲染|不是新门/, '须写明它不是门而是渲染档')
  const readme = readFileSync(join(SK, 'README.md'), 'utf8')
  assert.match(readme, /著者-年份/, 'README §定稿引用规范 须给渲染规则（唯一可执行落点）')
  assert.match(readme, /### 注释/, '注释须落在「数据来源」内 ### 注释 子节（白名单约束）')
  assert.match(readme, /M-Form-7/, '须写明「不得独立成节」的理由（第十个 H2 撞白名单 P0）')
})

test('② --with-notes：正文读数不变、notes 只算 ### 注释/### 脚注、默认无 notes 字段', () => {
  const f = tmpMd(FIXTURE)
  const plain = JSON.parse(run([CC, f]).out)
  const dual = JSON.parse(run([CC, f, '--with-notes']).out)
  assert.equal(typeof plain.hanChars, 'number')
  assert.equal(dual.hanChars, plain.hanChars, '带旗标不得改变正文读数（判级仍用正文）')
  assert.ok(dual.notes && dual.notes.hanChars > 0, 'notes.hanChars 应 > 0：' + JSON.stringify(dual.notes))
  assert.equal(dual.bodyWithNotes.hanChars, dual.hanChars + dual.notes.hanChars, '双读数 = 正文 + 注')
  assert.equal('notes' in plain, false, '默认调用不得新增 notes 字段（旧契约逐字段不变）')
})

test('③ --full 下双读数无意义：notes.skipped 且不重复计数', () => {
  const f = tmpMd(FIXTURE)
  const j = JSON.parse(run([CC, f, '--full', '--with-notes']).out)
  assert.equal(j.notes.skipped, true, '--full 已含注释，须显式标 skipped 而非重复相加')
  assert.equal('bodyWithNotes' in j, false)
})
