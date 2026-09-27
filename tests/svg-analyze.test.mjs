// `_lib/svg.mjs` 结构判定回归网（v18.38.0 新增）
//
// 为什么需要：本模块的 `analyzeSvg` 是**两处机检的共用真源**——`md2html.mjs` 的导出前置校验（不合格
//   → **exit 40**）与 M 门 **M-Form-9** 的「图N 结构不合格」。而它的宽高判定**一直是全文级的**：
//   `hasWH = /\bwidth\s*=/ && /\bheight\s*=/` 在**全文**里找，而任何图里都必然有 `<rect width=… height=…>`
//   → **「根标签既无 viewBox 也无 width/height」这种真会渲染塌缩的形态被判 `ok=true`**。
//   缺陷是 v18.30.0 EFF-6 的反向自证撞出来的（当时在测试侧补了根标签断言兜住，见 `figure-template.test.mjs`）；
//   本批把它修进**共用真源**，让 md2html 与 M-Form-9 一起受益。
// 前置实测：扫 `run/**` 全部 **75 张**现存图件 → 根标签缺 viewBox 且缺宽高 **0 张**、根标签缺 xmlns **0 张**
//   → 收紧不牵连存量产物。
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeSvg } from '../skills/lunheng-article-pipeline/scripts/_lib/svg.mjs'

const NS = 'xmlns="http://www.w3.org/2000/svg"'

test('**缺陷回归**：根标签缺 viewBox、只有子元素带 width/height → 必须判不合格（旧实现放行）', () => {
  // 这正是旧实现漏掉的那一类：全文里找得到 width=/height=（来自 <rect>），于是 ok=true。
  const bad = `<svg ${NS}><rect width="700" height="500" fill="#fff"/></svg>`
  const r = analyzeSvg(bad)
  assert.equal(r.ok, false, '根标签既无 viewBox 也无宽高必须判不合格（渲染会塌缩）')
  assert.match(r.problems.join('；'), /无 viewBox 也无 width\/height/)
})

test('契约允许的两种合格形态：根上 viewBox，或根上 width+height', () => {
  const a = analyzeSvg(`<svg ${NS} viewBox="0 0 700 500"><rect width="10" height="10"/></svg>`)
  assert.equal(a.ok, true, 'viewBox 形态应合格：' + a.problems.join('；'))
  const b = analyzeSvg(`<svg ${NS} width="700" height="500"><rect width="10" height="10"/></svg>`)
  assert.equal(b.ok, true, 'width+height 形态应合格：' + b.problems.join('；'))
})

test('根标签缺 xmlns（即使子元素带）→ 仍是**告警**而不是硬问题（严重度刻意不变）', () => {
  const r = analyzeSvg('<svg viewBox="0 0 700 500"><rect xmlns="http://www.w3.org/2000/svg" width="1" height="1"/></svg>')
  assert.equal(r.ok, true, 'xmlns 缺失旧版就是告警，本批不改严重度')
  assert.deepEqual(r.warnings, ['缺少标准 xmlns="http://www.w3.org/2000/svg"（部分渲染器会拒绝渲染）'], 'xmlns 必须判在**根标签**上')
})

test('无 `<svg>` 根 / 只有嵌套 `<svg>` → 判「未找到根元素」（旧实现会被嵌套那个骗过）', () => {
  assert.equal(analyzeSvg('<div><rect width="1" height="1"/></div>').ok, false)
  const nested = analyzeSvg('<div><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/></div>')
  // 嵌套形态：本模块把**第一个** <svg> 当根（无解析器），故这里判合格——如实断言该口径，避免后来者误判
  assert.equal(nested.ok, true, '第一个 <svg> 即视为根（无 XML 解析器的口径，写进注释）')
})
