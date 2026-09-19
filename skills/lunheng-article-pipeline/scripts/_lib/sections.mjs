// 文末节 / 正文区边界口径（全流水线唯一真源，v18.2.6 审计修复 §4.2）
//
// 背景（第三方审计 §4.2「count-chars 与 m-gate-check 对『正文区起点』两套口径」）：
//   两个脚本各写了一份「文末节起点」的实现，且实现方式不同——
//     · `count-chars.mjs:63,66-70` 用**精确字面量** `text.indexOf('## 参考文献')`（写死一个半角空格）；
//     · `m-gate-check.mjs:215-221` 用 `^##\s+(.+)$` 解析标题后 `startsWith` 比对。
//   实测把文末节标题写成 `##  参考文献`（**两个空格**，手写 markdown 极易发生）：
//     · count-chars 的 indexOf 失配 → 正文区终点退化为「文件末尾」→ 文末五节被整体计入正文区，
//       同一份稿件 `hanChars` 由 **503 → 1707**（虚高 3.4 倍）**且不置 degraded**（所有门全绿而字数是错的）；
//     · m-gate-check 归一化 `\s+` 后照常识别 → 同一次交付里两个脚本对「正文区」给出不同答案。
//   这正是本仓反复踩的「同一事实两处维护」形态（教训：两处口径必然发散）。现抽到本模块，
//   两个脚本共用一套解析：**标题一律按「行首 `##` + 至少一个空白（半角/制表/全角）+ 标题文本」解析**，
//   多余空白、尾随空白、CRLF 的 `\r` 都不再改变边界。
//
// 口径（与 `references/deliverables.md` / `任务简报-template.md` 一致）：
//   · 文末五节 = 参考文献 / 数据来源 / 案例来源 / 先行者文献 / AI 使用声明（**顺序固定**，见 M-Form-7）
//   · 正文区 = `## 摘要` 之后 → 第一个文末节之前（含摘要正文与关键词段；不含题名与文末五节）

/** 文末五节（顺序即 M-Form-7 规定顺序）。 */
export const ENDNOTE_SECTIONS = ['参考文献', '数据来源', '案例来源', '先行者文献', 'AI 使用声明']

/** 二级标题行：行首 `##` + **至少一个**空白（半角/制表/全角）+ 标题文本。
 *  与旧 `^##\s+(.+)$` 的两点差别（均为收紧，不是放宽）：
 *    ① `\s` 含换行 → 旧式会把「`##` 空行 + 下一行文本」也读成一个二级标题；本式不会；
 *    ② 标题尾随空白与 `\r` 不进标题（CRLF 文件不会把 `\r` 带进标题 → `startsWith` 比对不再被 CRLF 破坏）。
 *  `##标题`（无空白）**不予识别**——与 CommonMark 及本包其余门一致，避免把正文里的 `## 号` 当标题。 */
export const H2_LINE_RE = /^##[ \t\u3000]+(\S.*?)[ \t\u3000]*\r?$/gm

/** 解析全部二级标题：`[{ index, title }]`，index = 标题行首在原文中的偏移。 */
export const h2Headings = (text) =>
  [...String(text ?? '').matchAll(H2_LINE_RE)].map((m) => ({ index: m.index, title: m[1].trim() }))

/** 三级标题行：与 H2 **同一条规则**（行首 `###` + 至少一个空白 + 文本；尾随空白与 `\r` 不入标题）。
 *  v18.2.7 新增（依据 2026-09-20 全流程实战反哺 P0-1：`segment-chars.mjs` 需按任意 H2/H3 节取字数）。
 *  刻意与 `H2_LINE_RE` 共用同一字符类，避免「H2 认全角空格、H3 不认」这类两套口径发散。 */
export const H3_LINE_RE = /^###[ \t\u3000]+(\S.*?)[ \t\u3000]*\r?$/gm

/** 解析全部三级标题：`[{ index, title }]`。 */
export const h3Headings = (text) =>
  [...String(text ?? '').matchAll(H3_LINE_RE)].map((m) => ({ index: m.index, title: m[1].trim() }))

/** 全部标题（H2+H3，按出现顺序，带 `level`）——供按标题切片取字数的调用方使用。 */
export const allHeadings = (text) => {
  const out = [
    ...h2Headings(text).map((h) => ({ ...h, level: 2 })),
    ...h3Headings(text).map((h) => ({ ...h, level: 3 })),
  ]
  return out.sort((a, b) => a.index - b.index)
}

/** 标题行的**下一行**起点偏移（取节体用；导出给 `segment-chars.mjs` 复用，避免各写一份）。 */
export const bodyStartOfHeading = (text, headingIndex) => nextLineAfter(text, headingIndex)

/** 标题是否属于某节：**全等或前缀**（如「参考文献（共 12 条）」仍算参考文献节）——与既有门口径一致。 */
export const titleMatches = (title, marker) => title === marker || title.startsWith(marker)

/** 标题行末的下一行起点（用于「取标题之后的段体」）。 */
const nextLineAfter = (text, headingIndex) => {
  const nl = text.indexOf('\n', headingIndex)
  return nl === -1 ? text.length : nl + 1
}

/** 第一个文末节的标题行首偏移；无文末节 → -1。`from` 之前的不计（供「从正文区起点之后」搜索）。 */
export const firstEndnoteIndex = (text, from = 0) => {
  for (const h of h2Headings(text)) {
    if (h.index < from) continue
    if (ENDNOTE_SECTIONS.some((w) => titleMatches(h.title, w))) return h.index
  }
  return -1
}

/** 正文区起点 = `## 摘要` 标题行之后。
 *  `found=false` 表示无该节 → **调用方必须显式置 degraded 并告警**（禁止静默退化，v2.5.2-dsh.13 契约）。 */
export const bodyStartAfterAbstract = (text, marker = '摘要') => {
  const h = h2Headings(text).find((x) => titleMatches(x.title, marker))
  if (!h) return { index: 0, found: false }
  return { index: nextLineAfter(text, h.index), found: true }
}

/** 取某二级节的段体（标题行之后 → 下一个二级标题之前）；无该节 → 返回 null（区分「空节」与「无此节」）。 */
export const sectionBody = (text, marker) => {
  const hs = h2Headings(text)
  const i = hs.findIndex((h) => titleMatches(h.title, marker))
  if (i === -1) return null
  const from = nextLineAfter(text, hs[i].index)
  const to = i + 1 < hs.length ? hs[i + 1].index : text.length
  return to > from ? text.slice(from, to) : ''
}

/** 正文区范围 `{ from, to, abstractFound, endnoteFound }`——`to` 为第一个文末节起点（无则文末）。
 *  两个脚本的**起点**语义不同（count-chars 从 `## 摘要` 之后起算；m-gate-check 的 `body` 从文件头起算
 *  以便扫题名/摘要），故此处只提供共用的**边界解析**，切片由各自组装。 */
export const bodyBounds = (text) => {
  const { found: abstractFound } = bodyStartAfterAbstract(text)
  const e = firstEndnoteIndex(text)
  return { to: e === -1 ? String(text ?? '').length : e, abstractFound, endnoteFound: e !== -1 }
}
