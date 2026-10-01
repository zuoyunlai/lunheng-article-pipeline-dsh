// anchor-slug 回归网（v18.62.4 新增 · 全量审计-v18.62.3 §8.2 #24）
//
// **为什么此前没有**：`anchor-slug.mjs` 被两个消费者共用（`ref-get.mjs` 与一致性规则 ㉗），
//   但**没有任何直接测试**（它们各自的行为由别的用例间接覆盖）。于是这个 bug 活了下来：
//   本模块扫标题时**不遮围栏** → 代码块里的 `## 示例：…` 被当成真锚点。
//   两处受害：① 规则 ㉗ 认为「围栏里那个锚点存在」（**假绿**，掩盖真悬空链接）；
//             ② `ref-get` 收到 `#示例` 时**自信地打印围栏内的示例节**——非空但错，
//                正是本模块自己禁止的形态（「不返回空节」的姊妹条款是「也不得返回**错**节」）。
//
// 本文件三条断言对应三件事：围栏内**不得**被收录、围栏内锚点**不得**被解析（须响亮失败）、
//   真实锚点（标题 + 显式 `<a id>`）**必须**仍可解析（防收紧到过严）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anchorSlugsOf, anchorsWithRanges, resolveAnchor, slugify } from '../skills/lunheng-article-pipeline/scripts/_lib/anchor-slug.mjs'

/** 含**围栏内标题/显式锚点** + 真实标题/显式锚点的文档。 */
const DOC = [
  '# 文档标题', '',
  '## 一、引言', '',
  '正文。', '',
  '```markdown',
  '## 示例：这个标题在围栏里，不是真锚点',
  '### 围栏内的子标题',
  '<a id="fenced-anchor"></a>',
  '```', '',
  '## 11 写手版精简段', '',
  '真正的 §11 内容。', '',
  '<a id="real-explicit"></a>', '',
  '## 二、方法', '',
  '正文。', '',
].join('\n')

test('#24：围栏内的标题与显式锚点**不得**进入锚点集（否则规则 ㉗ 假绿）', () => {
  const slugs = anchorSlugsOf(DOC)
  assert.ok(slugs.has(slugify('文档标题')), '真实标题必须在场')
  assert.ok(slugs.has('11-写手版精简段'), '真实标题必须在场')
  assert.ok(slugs.has('real-explicit'), '真实的显式锚点必须在场')
  assert.ok(
    !slugs.has(slugify('示例：这个标题在围栏里，不是真锚点')),
    '围栏内的标题不得被当成锚点：' + JSON.stringify([...slugs]),
  )
  assert.ok(!slugs.has('fenced-anchor'), '围栏内的 <a id> 不得被当成锚点：' + JSON.stringify([...slugs]))
})

test('#24：`resolveAnchor` 对「只在围栏内存在」的锚点必须**响亮失败**（null），不得返回示例节', () => {
  assert.equal(
    resolveAnchor(DOC, '#示例'),
    null,
    '围栏内的示例标题不得被解析成节——返回非空但**错**的节比返回 null 更危险（ref-get 会打印它）',
  )
  // 对照：真实锚点仍可解析
  const ok = resolveAnchor(DOC, '#11-写手版精简段')
  assert.ok(ok, '真实标题锚点必须可解析')
  assert.match(ok.text, /真正的 §11 内容/, '解析出的节体必须是该节的真实内容')
  const ex = resolveAnchor(DOC, '#real-explicit')
  assert.ok(ex && ex.via === 'exact-explicit', '真实显式锚点必须可解析且标 via=exact-explicit')
})

test('#24：`anchorsWithRanges` 的**区间与正文**不得被遮罩污染（遮罩只用于扫描）', () => {
  const all = anchorsWithRanges(DOC)
  const sl = all.find((a) => a.slug === '11-写手版精简段')
  assert.ok(sl, '真实锚点必须在区间表里')
  assert.match(sl.text, /真正的 §11 内容/, '节体必须取**原文**（遮罩若泄漏到切片，正文会变成空格）')
  // 行号须与原文一致（遮罩保行结构）——用**原文定位**而非硬编码，避免测试自己算错行号
  const expectLine = DOC.split('\n').findIndex((l) => l === '## 11 写手版精简段') + 1
  assert.equal(sl.startLine, expectLine, `行号须与原文一致（期望 ${expectLine}）：实测 ${sl.startLine}`)
  assert.ok(!all.some((a) => /示例/.test(a.heading)), '围栏内的标题不得出现在区间表里：' + JSON.stringify(all.map((a) => a.heading)))
})
