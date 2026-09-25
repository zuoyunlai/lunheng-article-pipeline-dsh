// v18.12.0（2026-09-25 全量审计 L-51）：`_lib/sections.mjs` 的**围栏代码块感知**回归。
//
// 教训（审计实测）：正文里被引用的 `## 参考文献`（格式示例 / 规范片段 / 模板片段，写在 ``` 围栏内）
//   会被当成**真文末节起点** → `count-chars` 的 body 纯汉字（`glossary.md` 明定的**唯一字数验收口径**）
//   静默偏小（实测 15 vs 手算 31）、**exit 0、stderr 空、无 degraded**；M 门的 body/endnote 分界
//   同源同错 → 两个消费者一起错、互不发现。偏小即可能把「超目标篇幅」判成「在区间内」（G5 错误放行）。
//
// 修法：解析层遮罩（`maskFences`）——`h2Headings` / `h3Headings` 的下游全部自动获得围栏感知。
// 本文件锁三件事：① 遮罩**逐字节保长**（index 可回原文切片，全部既有调用方无需改动）；
//   ② 围栏内的 `##` 不算标题、不终止正文区；③ `count-chars` 端到端不再截断。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const SECTIONS = pathToFileURL(join(SCRIPTS, '_lib', 'sections.mjs')).href
const { maskFences, h2Headings, firstEndnoteIndex } = await import(SECTIONS)

/** 独立于被测模块的汉字计数（防「用被测实现的中间量当期望值」）。 */
const han = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length

const DOC = [
  '# 题名', '',
  '## 摘要', '', '摘要正文甲乙丙。', '',
  '## 一、正文', '', '正文句子一。', '',
  '```markdown', '## 参考文献', '- [L01] 这是格式示例，不是真文末节', '```', '',
  '正文句子二。', '',
  '## 参考文献', '', '- [L01] 真条目', '',
].join('\n')

test('maskFences：逐字节保长（偏移与行结构不变 → index 可回原文切片）', () => {
  const masked = maskFences(DOC)
  assert.equal(masked.length, DOC.length, '遮罩后长度必须不变')
  assert.equal((masked.match(/\n/g) || []).length, (DOC.match(/\n/g) || []).length, '换行数必须不变')
  // 未进入围栏的行必须原样保留
  assert.ok(masked.includes('## 摘要'), '围栏外的标题不得被遮罩')
})

test('maskFences：非字符串 / 空输入不抛（口径与既有导出一致）', () => {
  assert.equal(maskFences(null), '')
  assert.equal(maskFences(undefined), '')
  assert.equal(maskFences(''), '')
  assert.equal(maskFences('## 摘要\n\n正文。\n'), '## 摘要\n\n正文。\n')
})

test('h2Headings：围栏内的 ## 不算标题', () => {
  const titles = h2Headings(DOC).map((h) => h.title)
  assert.deepEqual(titles, ['摘要', '一、正文', '参考文献'], '围栏内的 `## 参考文献` 不得出现在标题列表里')
})

test('firstEndnoteIndex：跳过围栏内的伪文末节，命中真文末节', () => {
  const fe = firstEndnoteIndex(DOC)
  const fencedAt = DOC.indexOf('```markdown')
  const realAt = DOC.lastIndexOf('## 参考文献')
  assert.ok(fencedAt !== -1 && realAt !== -1, '夹具自身应同时含围栏内与真文末节')
  assert.equal(fe, realAt, '文末节起点必须是**真**那一处')
  assert.ok(fe > fencedAt, '围栏内的伪文末节偏移必须被跳过')
})

test('未闭合围栏 → 遮罩到文末（与 CommonMark 一致）', () => {
  const bad = '## 摘要\n\n正文。\n\n```\n## 参考文献\n'
  const titles = h2Headings(bad).map((h) => h.title)
  assert.deepEqual(titles, ['摘要'], '未闭合围栏之后的 ## 也不得被当标题')
  assert.equal(firstEndnoteIndex(bad), -1)
})

test('波浪围栏（~~~）与反引号围栏同口径', () => {
  const tilde = '## 摘要\n\n正文。\n\n~~~\n## 参考文献\n~~~\n\n## 参考文献\n'
  assert.equal(firstEndnoteIndex(tilde), tilde.lastIndexOf('## 参考文献'))
})

test('长围栏被短围栏行内容不提前关闭（``` 起、```` 止）', () => {
  const doc = '## 摘要\n\n正文。\n\n````\n```\n## 参考文献\n````\n\n## 参考文献\n'
  assert.equal(firstEndnoteIndex(doc), doc.lastIndexOf('## 参考文献'))
})

test('count-chars 端到端：围栏内的 `## 参考文献` 不再截断正文区（L-51 主回归）', () => {
  const dir = tmp('lunheng-fence-')
  const f = join(dir, '定稿.md')
  writeFileSync(f, DOC)
  try {
    const r = run([join(SCRIPTS, 'count-chars.mjs'), f])
    assert.equal(r.code, 0, 'count-chars 应成功：' + r.out)
    const j = parseJson(r)
    // 期望值**独立**算（用 lastIndexOf 定真文末节，不借助被测模块的 firstEndnoteIndex）
    const bodyStart = DOC.indexOf('\n', DOC.indexOf('## 摘要')) + 1
    const expected = han(DOC.slice(bodyStart, DOC.lastIndexOf('## 参考文献')))
    assert.ok(expected > 0, '夹具自身应含正文字数')
    assert.equal(j.hanChars, expected, `正文区纯汉字应为 ${expected}（含围栏内文字），实际 ${j.hanChars}`)
    assert.notEqual(j.degraded, true, '有摘要的正常稿件不得标 degraded')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('count-chars 端到端：无围栏的同内容稿件与有围栏稿件差值为围栏内文字（对照）', () => {
  const dir = tmp('lunheng-fence-')
  const withFence = join(dir, 'fence.md')
  const noFence = join(dir, 'plain.md')
  const removed = '```markdown\n## 参考文献\n- [L01] 这是格式示例，不是真文末节\n```\n'
  const plain = DOC.replace(removed, '')
  writeFileSync(withFence, DOC)
  writeFileSync(noFence, plain)
  try {
    const a = parseJson(run([join(SCRIPTS, 'count-chars.mjs'), withFence]))
    const b = parseJson(run([join(SCRIPTS, 'count-chars.mjs'), noFence]))
    assert.equal(a.hanChars - b.hanChars, han(removed), '差值应恰为被删掉那段围栏文字的汉字数')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
