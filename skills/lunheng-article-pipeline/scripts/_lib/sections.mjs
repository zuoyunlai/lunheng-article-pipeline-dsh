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

/** 文末**必需**五节（顺序即 M-Form-7 规定顺序；M-Form-2 的存在性检查以本数组为准）。 */
export const ENDNOTE_SECTIONS = ['参考文献', '数据来源', '案例来源', '先行者文献', 'AI 使用声明']

/** 学术四声明（v18.12.0 新增，依据 2026-09-25 全量审计 L-17）——**可选**，不参与存在性检查。
 *
 * 背景：v18.10.0 起写手卡与交付说明模板已要求「文末九节」（四声明按学术伦理标准排在 AI 使用声明前），
 *   而机检白名单仍是五节 → **照规范写必被 M-Form-7 判 P0**，且该门属「不可 LLM 兜底的红线」→ 学术论文无出口
 *   （审计实测：按九节写 → `exit=2`，`违规节: CRediT 声明,COI 声明,数据可用性声明,伦理审批声明`）。
 *
 * 为什么不能直接把它们并进 `ENDNOTE_SECTIONS`：四声明是**学术论文专用**——
 *   商业评论 / 行业分析 / 公众号稿件不该被强制要求 CRediT 与伦理审批；并入会让一切稿件都必须写四声明。
 *
 * 现拆两层：**必需五节**（存在性）+ **可选四声明**（仅参与白名单成员资格与顺序）→
 *   学术稿写九节通过、非学术稿写五节也通过，两边都不再被迫绕门。
 *   标记文本取自四份声明模板的 `##` 标题真源（`templates/{CRediT,COI,数据可用性,伦理审批}*.md`）；
 *   比对走 `titleMatches`（全等或前缀），故「CRediT 作者贡献声明（14 角色）」这类变体同样命中。 */
export const ENDNOTE_SECTIONS_OPTIONAL = ['CRediT 作者贡献声明', 'COI 利益冲突声明', '数据可用性声明', '伦理审批声明']

/** 文末合规顺序（**九节**，M-Form-7 顺序断言的唯一真源）：必需五节 + 可选四声明。
 *  由 `ENDNOTE_SECTIONS` 派生（前四节 → 四声明 → 末节 AI 使用声明），避免两处各写一份清单又发散。 */
export const ENDNOTE_ORDER = [
  ...ENDNOTE_SECTIONS.slice(0, -1),
  ...ENDNOTE_SECTIONS_OPTIONAL,
  ENDNOTE_SECTIONS[ENDNOTE_SECTIONS.length - 1],
]

/** 围栏代码块感知（v18.12.0 新增，依据 2026-09-25 全量审计 L-51）——**本模块唯一实现**。
 *
 * 为什么必须在**解析层**做，而不是在某个调用方做：
 *   围栏内的 `## 参考文献`（正文里被引用的格式示例 / 规范片段 / 模板片段）此前会被当成**真文末节起点**。
 *   实测：一份正文含 ```` ```markdown ```` 示例、其内含 `## 参考文献` 行的稿件，
 *   `count-chars` 报 **15 汉字**（手算 31）、**exit 0、stderr 空、无 degraded**。
 *   而 `count-chars` 的 body 纯汉字是 `glossary.md` 明定的**唯一字数验收口径**——偏小即可能把
 *   「超目标篇幅」判成「在区间内」（G5 错误放行）；M 门的 body/endnote 分界同源同错，两个消费者
 *   一起错、互不发现。故修在解析层：`h2Headings` / `h3Headings` 的下游全部自动获得围栏感知
 *   （count-chars / m-gate-check / segment-chars / fix-gates / mform-gates / mintegrity-gate / cite-coverage-check …）。
 *
 * 语义（贴近 CommonMark 的最小实现，只做「遮罩」不做完整解析）：
 *   · 起栏 = 行首（允许 ≤3 个空格缩进）连续 ≥3 个 `` ` `` 或 `~`；
 *   · 止栏 = 之后第一行「同种字符且数量 ≥ 起栏」；**未闭合则遮罩到文末**（与 CommonMark 一致）；
 *   · 遮罩 = 把区间内**非换行**字符替换成等长空格 → 偏移与行结构**逐字节不变**，
 *     故所有既有「用 index 回原文切片」的调用方（`sectionBody` / `allHeadings` / …）无需改动。
 */
export const maskFences = (text) => {
  const s = String(text ?? '')
  const ch = s.split('')
  const blank = (a, b) => { for (let k = a; k < b; k++) ch[k] = ' ' }
  let i = 0
  while (i < s.length) {
    const nl = s.indexOf('\n', i)
    const lineEnd = nl === -1 ? s.length : nl
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(s.slice(i, lineEnd))
    if (!m) { i = nl === -1 ? s.length : nl + 1; continue }
    const mark = m[1]
    const closer = new RegExp('^ {0,3}' + (mark[0] === '`' ? '`' : '~') + '{' + mark.length + ',}')
    blank(i, lineEnd)                                  // 起栏行本身
    let j = nl === -1 ? s.length : nl + 1
    while (j < s.length) {
      const n2 = s.indexOf('\n', j)
      const e2 = n2 === -1 ? s.length : n2
      const isCloser = closer.test(s.slice(j, e2))
      blank(j, e2)
      j = n2 === -1 ? s.length : n2 + 1
      if (isCloser) break                              // 止栏行也遮罩，其后恢复正常解析
    }
    i = j
  }
  return ch.join('')
}

/** 二级标题行：行首 `##` + **至少一个**空白（半角/制表/全角）+ 标题文本。
 *  与旧 `^##\s+(.+)$` 的两点差别（均为收紧，不是放宽）：
 *    ① `\s` 含换行 → 旧式会把「`##` 空行 + 下一行文本」也读成一个二级标题；本式不会；
 *    ② 标题尾随空白与 `\r` 不进标题（CRLF 文件不会把 `\r` 带进标题 → `startsWith` 比对不再被 CRLF 破坏）。
 *  `##标题`（无空白）**不予识别**——与 CommonMark 及本包其余门一致，避免把正文里的 `## 号` 当标题。 */
export const H2_LINE_RE = /^##[ \t\u3000]+(\S.*?)[ \t\u3000]*\r?$/gm

/** 解析全部二级标题：`[{ index, title }]`，index = 标题行首在原文中的偏移。
 *  v18.12.0（L-51）：先在 `maskFences` 遮罩后的文本上匹配——围栏代码块内的 `## …` 不算标题；
 *  因遮罩逐字节保长，返回的 index 仍可直接用于**原文**切片。 */
export const h2Headings = (text) =>
  [...maskFences(text).matchAll(H2_LINE_RE)].map((m) => ({ index: m.index, title: m[1].trim() }))

/** 三级标题行：与 H2 **同一条规则**（行首 `###` + 至少一个空白 + 文本；尾随空白与 `\r` 不入标题）。
 *  v18.2.7 新增（依据 2026-09-20 全流程实战反哺 P0-1：`segment-chars.mjs` 需按任意 H2/H3 节取字数）。
 *  刻意与 `H2_LINE_RE` 共用同一字符类，避免「H2 认全角空格、H3 不认」这类两套口径发散。 */
export const H3_LINE_RE = /^###[ \t\u3000]+(\S.*?)[ \t\u3000]*\r?$/gm

/** 解析全部三级标题：`[{ index, title }]`（v18.12.0：与 H2 同走围栏遮罩）。 */
export const h3Headings = (text) =>
  [...maskFences(text).matchAll(H3_LINE_RE)].map((m) => ({ index: m.index, title: m[1].trim() }))

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
