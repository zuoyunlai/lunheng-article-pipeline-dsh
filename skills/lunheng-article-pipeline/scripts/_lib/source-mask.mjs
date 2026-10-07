// 源码「非代码面」剥离器（v18.78.2 · 全量审计-v18.78.1 B7/B8 修复）
//
// ── 为什么需要 ────────────────────────────────────────────────────────────
// 两条规则此前都拿**整份源码正文**当判据，于是注释与字符串字面量能冒充代码：
//   · ⑧ 的退出码静态解析（`_lib/exit-resolution.mjs`）：一段只写着
//     `// 历史上本脚本用 process.exit(2) 表示 P0` 的注释，会让解析器产出码 2；
//     字符串 `"process.exit(7) 只是文档示例"` 同理 —— **假红与假绿两个方向都成立**
//     （既能把注释里的码当真实退出码，也能让「声明码在场」这条检查被一句注释满足）。
//   · ⑪ 的行号引用扫描（`_lib/hygiene/r11-lib-line-refs.mjs`）：只扫 `.md`/`.html`，
//     `.mjs`/`.js` **注释里**的互指行号（`scripts/link-check.mjs` 的 SUSPECT 注释自陈实测 9 处）
//     落在所有门之外 —— 需要「只取注释、不取代码」的另一个视图。
// 两个视图（屏蔽 vs 只取注释）由**同一个扫描器**产出，避免「同一事实两处实现、谁先漂都不知道」。
//
// ── 口径与取舍（如实声明，这一段比实现重要）──────────────────────────────
//   ① **宁可漏剥，不可把真代码剥掉**。漏剥的代价是「注释里的码偶尔仍被当代码」（假红偏向），
//      误剥的代价是「真代码里的 `process.exit(5)` 被屏蔽掉」（假绿・漏检）——后者更贵，故本实现
//      在每一个「拿不准」的分支都选择**按代码处理**。
//   ② 字符串按 **必须同行闭合** 处理：`'` / `"` 在同一行内找不到未转义的闭合引号时，**不剥离**
//      （把整段还原为代码）。真实 JS 单双引号字符串不跨行（除非续行反斜杠），而正则字面量里
//      出现的引号是最容易把「字符串」误判出来的形态 —— 这条规则把最贵的误剥形态挡在外面。
//   ③ 模板字面量按**真语法**处理：字面量文本被剥离，但 `${…}` 内的表达式**仍按代码扫描**
//      （那里可以有真的 `process.exit(N)`，剥掉就是漏检）。花括号深度用栈跟踪。
//   ④ 注释：`//` 到行尾、`/* */` 到闭合（JS 注释不嵌套，不做嵌套启发）。
//   ⑤ 正则字面量用**标准启发式**判定（`/` 前一个有意义字符 ∈ `(,=:[!&|?{};+-*%~^<>` 或
//      行首/文件首 ⇒ 正则），并按 `[...]` 字符类感知找闭合 `/`。启发式必然有例外
//      （如 `return /x/` 之后紧跟的 `/`）：例外方向是**少屏蔽一点**（按代码处理），符合 ①。
//   ⑥ 只做词法层剥离，**不做 AST 解析**（零依赖是本仓仓库级脚本的硬约束）。
//
// **边界（如实）**：本模块不能保证「剥掉的每一段都确实是注释/字符串」（启发式），但能保证
//   **不会把合法的 `process.exit(...)` 调用整体剥掉**这一级别（调用点在代码位置，字符串/注释
//   只可能通过误判进入 —— 而误判方向的取舍见 ①②③⑤）。调用方应使用 `verifyMaskConsistency()`
//   对自己关心的探针做实测自证，而不是相信这段自述。
//
// 导出：
//   · maskNonCode(text)     → 与原文**等长**的文本，注释与字符串内容被空格替换（换行保留）。
//                             等长是刻意的：调用方拿到的行号/偏移仍可直接映射回原文件。
//   · extractComments(text) → 仅注释文本（行注释 + 块注释，按出现顺序以换行连接）。
//   · verifyMaskConsistency(text, probe) → 剥离前后 `probe` 命中数对照（调用方自证用）。

/** 能够「紧接在正则字面量之前」的有意义字符（除行首/文件首之外）。 */
const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>'])

/**
 * 词法扫描。
 * @param {string} text 源码
 * @returns {{masked:string, comments:string}} 等长屏蔽文本 + 注释文本
 */
function scanSource(text) {
  const n = text.length
  const out = new Array(n)
  const comments = []
  let cbuf = ''
  let i = 0
  let prevSig = ''
  // 上下文栈：code / tmpl / tmplExpr / str / block（block.line = 行注释，到换行结束）
  const stack = [{ kind: 'code' }]
  const top = () => stack[stack.length - 1]

  while (i < n) {
    const ctx = top()
    const c = text[i]
    const c2 = text[i + 1]

    if (ctx.kind === 'block') {
      if (ctx.line) {
        if (c === '\n') { if (cbuf) comments.push(cbuf); cbuf = ''; stack.pop(); out[i] = '\n'; prevSig = ''; i++; continue }
        cbuf += c; out[i] = ' '; i++; continue
      }
      if (c === '*' && c2 === '/') { if (cbuf) comments.push(cbuf); cbuf = ''; out[i] = ' '; out[i + 1] = ' '; i += 2; stack.pop(); continue }
      cbuf += c
      out[i] = c === '\n' ? '\n' : ' '
      i++
      continue
    }

    if (ctx.kind === 'str') {
      if (c === '\\') { out[i] = ' '; out[i + 1] = text[i + 1] === '\n' ? '\n' : ' '; i += 2; continue }
      if (c === '\n' || i >= n) {
        // 口径②：未在同一行闭合 → 整段还原为代码（保守）
        for (let k = ctx.start; k < i; k++) out[k] = text[k]
        stack.pop()
        out[i] = '\n'; prevSig = ''; i++
        continue
      }
      if (c === ctx.quote) { out[i] = ' '; i++; stack.pop(); prevSig = ctx.quote; continue }
      out[i] = ' '
      i++
      continue
    }

    if (ctx.kind === 'tmpl') {
      if (c === '\\') { out[i] = ' '; out[i + 1] = text[i + 1] === '\n' ? '\n' : ' '; i += 2; continue }
      if (c === '`') { out[i] = ' '; i++; stack.pop(); prevSig = '`'; continue }
      if (c === '$' && c2 === '{') { out[i] = ' '; out[i + 1] = ' '; i += 2; stack.push({ kind: 'tmplExpr', brace: 0 }); prevSig = '{'; continue }
      out[i] = c === '\n' ? '\n' : ' '
      i++
      continue
    }

    // ── code / tmplExpr：逐字符判定 ───────────────────────────────────────
    if (c === '/' && c2 === '/') { out[i] = ' '; out[i + 1] = ' '; i += 2; stack.push({ kind: 'block', line: true }); continue }
    if (c === '/' && c2 === '*') { out[i] = ' '; out[i + 1] = ' '; i += 2; stack.push({ kind: 'block', line: false }); continue }
    if (c === "'" || c === '"') { out[i] = c; stack.push({ kind: 'str', quote: c, start: i }); i++; continue }
    if (c === '`') { out[i] = ' '; i++; stack.push({ kind: 'tmpl' }); continue }
    if (c === '/' && (prevSig === '' || REGEX_PREV.has(prevSig))) {
      let j = i + 1, inClass = false, closed = -1
      while (j < n) {
        const d = text[j]
        if (d === '\\') { j += 2; continue }
        if (d === '\n') break
        if (d === '[') inClass = true
        else if (d === ']') inClass = false
        else if (d === '/' && !inClass) { closed = j; break }
        j++
      }
      if (closed > 0) {
        for (let k = i; k <= closed; k++) out[k] = ' '
        let k = closed + 1
        while (k < n && /[a-z]/i.test(text[k])) { out[k] = ' '; k++ }
        i = k
        prevSig = '/'
        continue
      }
    }
    if (ctx.kind === 'tmplExpr') {
      if (c === '{') ctx.brace++
      else if (c === '}') {
        if (ctx.brace === 0) { out[i] = '}'; i++; stack.pop(); prevSig = '}'; continue }
        ctx.brace--
      }
    }
    out[i] = c
    prevSig = /\s/.test(c) ? (c === '\n' ? '' : prevSig) : c
    i++
  }
  // 未闭合的字符串/模板（文件尾）：同样按口径②还原为代码（保守）
  while (stack.length > 1) {
    const ctx = stack.pop()
    if (ctx.kind === 'str') for (let k = ctx.start; k < n; k++) out[k] = text[k]
  }
  if (cbuf) comments.push(cbuf)
  for (let k = 0; k < n; k++) if (out[k] === undefined) out[k] = text[k]
  return { masked: out.join(''), comments: comments.join('\n') }
}

/**
 * 屏蔽注释与字符串字面量内容（**等长**替换为空格，换行保留）。
 * @param {string} text 源码
 * @returns {string}
 */
export function maskNonCode(text) {
  return scanSource(text).masked
}

/**
 * 仅取注释文本（行注释 + 块注释）。用于「只扫注释、不扫代码」的规则（⑪ 的 `.mjs/.js` 面）。
 * @param {string} text 源码
 * @returns {string}
 */
export function extractComments(text) {
  return scanSource(text).comments
}

/**
 * 剥离一致性自证：对同一探针正则，剥离前后的命中数。
 * 调用方据此判断「剥离器是否把真代码剥掉了」——`raw > masked` 即存在被剥掉的命中，
 * 此时**必须**在输出里如实标注（本模块不替调用方决定回退策略）。
 * @param {string} text
 * @param {RegExp} probe 全局正则
 */
export function verifyMaskConsistency(text, probe) {
  const count = (s) => (s.match(probe) ?? []).length
  return { raw: count(text), masked: count(maskNonCode(text)) }
}
