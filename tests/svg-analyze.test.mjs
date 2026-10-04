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
import { analyzeSvg, checkGrid } from '../skills/lunheng-article-pipeline/scripts/_lib/svg.mjs'

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

// ─────────────────────────────────────────────────────────────────────────────
// v18.73.0（反哺报告-v7 F-17）：**声明式网格自检** `checkGrid`
//
// 立法理由（实测病灶）：本项目图 3（矩阵图）有 **6 个标记不落列中心 + 1 个多余标记**，
//   而它**通过了当时的全部机检**（`M-Form-9` 只核图位/图件/图上数字），是主控借 PNG 目视才发现的。
//
// ⚠️ **本项刻意"可选"**：**未声明 `data-grid` 一律返回 `null`、一律不检**。第 4 个用例就是守这条——
//   概念图/流程图本无网格，强制检会大面积误报，**而一个会误报的新门比没有门更糟**（同批 F-9 的教训）。
// ─────────────────────────────────────────────────────────────────────────────
const __gridHdr = (r, c) => `<svg viewBox="0 0 640 400" data-grid="rows=${r};cols=${c}">`
function __gridSvg(rows, cols, { extra = 0, misplace = [] } = {}) {
  const colX = (c) => 100 + c * 60
  const rowY = (r) => 80 + r * 50
  let s = __gridHdr(rows, cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const bad = misplace.some(([rr, cc]) => rr === r && cc === c)
      s += `<text x="${colX(c) + (bad ? 34 : 0)}" y="${rowY(r)}">●</text>`
    }
  }
  for (let i = 0; i < extra; i++) s += `<text x="${colX(0) + 34}" y="${rowY(0)}">○</text>`
  return s + '</svg>'
}

test('checkGrid：规整矩阵**不报**（不误报是它能被启用的前提）', () => {
  const r = checkGrid(__gridSvg(5, 7))
  assert.notEqual(r, null, '声明了 data-grid 就必须执行检查')
  assert.deepEqual(r.problems, [], `规整 5×7 全标记不应报任何问题：${JSON.stringify(r.problems)}`)
  assert.equal(r.markers, 35, '标记数应 = rows×cols')
  assert.equal(r.rows, 5); assert.equal(r.cols, 7)
})

test('checkGrid：**标记不落列中心**必须报（本项目图 3 的病灶之一）', () => {
  const r = checkGrid(__gridSvg(5, 7, { misplace: [[0, 0], [1, 0]] }))
  assert.ok(r.problems.length > 0, '2 个标记被挪到列边界（x +34）→ 必须报')
  assert.ok(r.problems.some((p) => /x 坐标.*离散值.*> cols/.test(p)),
    `应点名「x 离散值超出 cols」：${JSON.stringify(r.problems)}`)
})

test('checkGrid：**标记数 ≠ rows×cols** 必须报（本项目图 3 的病灶之二）', () => {
  const r = checkGrid(__gridSvg(5, 7, { extra: 1 }))
  assert.ok(r.problems.some((p) => /标记数 36 ≠ rows×cols/.test(p)),
    `多 1 个标记必须点名计数不符：${JSON.stringify(r.problems)}`)
})

test('checkGrid：**未声明 data-grid → 返回 null（完全不检）**——这一刻意设计不得被"顺手启用"', () => {
  // 概念图 / 流程图：有标记字符但**没有网格语义**
  const concept = '<svg viewBox="0 0 640 400"><text x="10" y="20">●</text><text x="90" y="300">○</text></svg>'
  assert.equal(checkGrid(concept), null,
    '未声明 data-grid 必须返回 null（调用方据此跳过）——否则本项会对概念图大面积误报')
  assert.equal(checkGrid('<svg viewBox="0 0 1 1"></svg>'), null, '空 SVG 同样为 null')
  assert.equal(checkGrid(''), null, '空串同样为 null')
})

test('checkGrid：声明了但**找不到标记元素** → 不判错，只记 note（无从核验 ≠ 不合格）', () => {
  const r = checkGrid(__gridHdr(2, 2) + '<text x="10" y="20">反应性</text></svg>')
  assert.deepEqual(r.problems, [], '无标记元素时不得判错——"核不了"不等于"不合格"')
  assert.ok(r.notes.some((n) => /未找到标记元素/.test(n)), '必须留 note 说明为何未核')
  assert.equal(r.markers, 0)
})
