// 退出码命名空间对账（C-11 机械化 · v18.18.5）——供 `repo-hygiene-check` 规则⑧ 使用，可单测。
//
// ── 为什么需要 ────────────────────────────────────────────────────────
// 本仓反复吃过「退出码撞义」的亏，每次代价都是**误触发 T5 修订轮**（把「参数写错」读成
// 「正文有 P1 残留」）。收口后的纪律是两处登记：
//   · `scripts/repo-hygiene-check.mjs` 的 `EXIT_CONTRACT`（每个脚本允许用哪些码）——**机器面**
//   · `docs/troubleshooting.md` §8「命名空间配额」（哪个码归哪一族语义）——**人读面**
// 但两处一直**只靠人工同步**：`EXIT_CONTRACT` 加了新码、§8 忘了写（或反之），没有任何门会发现。
// 审计 C-11 的原话是「§8 表格 vs `EXIT_CONTRACT` 逐行一致（新增断言）」。
//
// ── 与审计原文的偏差（如实）────────────────────────────────────────────
// 审计设想 §8 是一张**逐行表**，实测它不是——§8 是一段**命名空间配额**散文（哪些码归 M 门族、
// 哪些是「非 M 门语义另给码」）。故「逐行比对」无从谈起；本模块实现的是它的**等价不变量**：
//   **「代码里实际用到的码集合」== 「§8 声明的码集合」**
// 这比逐行更紧：它同时挡「加了码没登记」与「§8 写了码但已无人用」两个方向。
// **v18.20.4（二次复审 M-4）**：§8 的「声明」有两处载体（配额散文 + **表格**），本模块两处都解析
//   （`parseNamespaceQuota` / `parseExitTable`），两侧分别与 EXIT_CONTRACT 双向对账。
//
// ── 边界（如实）────────────────────────────────────────────────────
// · 只管**码的集合**，不管「码 ↔ 语义」的对应是否写对（那要人读）。
// · 解析依赖 §8 那行仍含「命名空间配额」字样、且码写在反引号里——形状变了会**响亮报错**
//   而不是静默通过（见下 `throw`），避免门悄悄失效。

/** 从 `repo-hygiene-check.mjs` 源码解析 `EXIT_CONTRACT`。 */
export function parseExitContract(src) {
  const start = src.indexOf('const EXIT_CONTRACT = {')
  const end = src.indexOf('\n}', start)
  if (start < 0 || end <= start) {
    throw new Error('未找到 `const EXIT_CONTRACT = {` … `\\n}` 块——退出码契约的表形变了，请同步本解析器')
  }
  const codes = new Set()
  let scripts = 0
  for (const m of src.slice(start, end).matchAll(/^\s{2}'([^']+)':\s*\[([^\]]*)\]/gm)) {
    scripts++
    for (const n of m[2].split(',').map((s) => s.trim()).filter(Boolean)) codes.add(Number(n))
  }
  if (scripts === 0) throw new Error('EXIT_CONTRACT 解析出 0 个脚本——正则与源码脱节，本门会静默失效')
  return { scripts, codes: [...codes].sort((a, b) => a - b) }
}

/** 从 `docs/troubleshooting.md` 解析 §8 声明的码集合。 */
export function parseNamespaceQuota(docText) {
  const lines = docText.split('\n')
  const idx = lines.findIndex((l) => l.includes('命名空间配额'))
  if (idx < 0) throw new Error('docs/troubleshooting.md 未找到「命名空间配额」段——§8 被改名/删除，请同步本解析器')
  const codes = new Set()
  for (const m of lines[idx].matchAll(/`([^`]+)`/g)) {
    const tok = m[1]
    if (!/^[\d/-]+$/.test(tok)) continue // `EXIT_CONTRACT` 这类非码 token 跳过
    for (const n of tok.split(/[/-]/).filter(Boolean)) codes.add(Number(n))
  }
  if (codes.size === 0) {
    throw new Error(`troubleshooting.md:${idx + 1} 的命名空间配额段解析出 0 个码——码不再写在反引号里？本门会静默失效`)
  }
  return { line: idx + 1, codes: [...codes].sort((a, b) => a - b) }
}

/**
 * 从 `docs/troubleshooting.md` 解析 §8 的**表格码列**（`| <码> | 含义 |`）——二次复审 M-4。
 *
 * 为什么需要：§8 里同一事实（退出码）有**两种呈现**——「命名空间配额」散文（上一函数管的）
 * 与**表格**（主控最常读的入口）。旧版只钉了散文，实测把表里 `| 2 |` 改成 `| 12 |` **全套门绿**。
 * 故补这一维：表行的码集合也必须 == `EXIT_CONTRACT` 的码集合。
 * 边界（如实）：只管**码集合**，不管「码 ↔ 语义」写得对不对（那要人读）。
 * @throws 找不到 §8 标题 / 解析出 0 行表 → 响亮报错（形状变了绝不静默通过）。
 */
export function parseExitTable(docText) {
  const lines = docText.split('\n')
  const idx = lines.findIndex((l) => /^##\s*8\./.test(l))
  if (idx < 0) throw new Error('docs/troubleshooting.md 未找到 §8 标题（`## 8.`）——§8 被改名/删除，请同步本解析器')
  const codes = new Set()
  let started = false
  let rows = 0
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith('|')) {
      started = true
      const m = /^\|\s*(\d{1,2})\s*\|/.exec(l)
      if (m) { rows++; codes.add(Number(m[1])) }
      continue
    }
    if (started) break // 首个非表行 = 表格结束
  }
  if (rows === 0) {
    throw new Error(`troubleshooting.md §8（第 ${idx + 1} 行起）未解析出任何「| <码> |」表行——表被改形态？本门会静默失效`)
  }
  return { line: idx + 1, codes: [...codes].sort((a, b) => a - b) }
}

/** 双向差集：返回只在一侧出现的码。 */
export function reconcile(actual, declared) {
  return {
    onlyInCode: actual.filter((c) => !declared.includes(c)),
    onlyInDoc: declared.filter((c) => !actual.includes(c)),
  }
}

// ── 脚本**自述**退出码 ↔ 自身契约行（⑧d · v18.18.12）────────────────────────────
//
// ── 为什么需要 ────────────────────────────────────────────────────────
// 随包脚本的头部注释会自述返回码（例：`// 返回码：0 = …；4 = …`）。它是**第三处**退出码登记
// ——除 `EXIT_CONTRACT`（机器面）与 `troubleshooting.md §8`（人读面）之外的**脚本自带面**，
// 而前两处已有 ⑧b 对账、这一处一直没有门。
// 实测教训（v18.18.12）：`model-routing.mjs:20` 自述「`1 = 读不到配置`」，而该脚本的
// `process.exit(1)` **个数为 0**、契约行是 `[0,4,10,70]`——那个 `1` 是 v18.12.0 收口前的
// 遗留声明。调用方按自述去接 `1`，永远等不到；维护者按自述去改，会以为 `1` 还被占着。
// 这正是 F-5 一类「文案与行为脱节」的形态，故把不变量机械化成门，而不是再补一条文本断言。
//
// ── 与「双向对账」的刻意偏差（如实）──────────────────────────────────
// 本函数是**单向**的：只报「自述了契约行外的码」（自述 ⊄ 契约），**不报**反方向。
// 理由：`0` 与 `70`（EXIT_SOFTWARE）对**每个**装了 guard 的脚本都可用，脚本自述常只写语义码
// 而省略它们——实测 `apply-diff.mjs` / `apply-revision-cycle.mjs` 都是「自述 [0,1,10] ⊂ 契约
// [0,1,10,70]」。若做双向，这两处会成**假红**，门就再也红不动真问题。
// 有害方向只有一个：**承诺了本脚本产不出的码**。故只挡这一面。

/** 脚本头部自述退出码的段首标记（段内码写作 `N = 语义`）。 */
const CODE_HEADER_RE = /(退出码|返回码)[：:]/
/** 码子句：`N =`，N 限定 1–2 位（退出码都在 0–99，避免把 `v18.12.0 L-60` 之类误吞）。 */
const CODE_CLAUSE_RE = /(?:^|[：:；;，,、\s(（])(\d{1,2})\s*=/g

/**
 * 解析单个脚本头部自述的退出码。
 * @returns `null` = 该脚本不自述（合法，跳过）；否则 `{ line, codes }`（line 为 1 基行号）。
 */
export function parseScriptHeaderCodes(text) {
  const lines = text.split('\n')
  // 只在头部注释区找（前 40 行）——正文里的 `返回码` 讨论不该被当成本脚本的自述
  let start = -1
  for (let i = 0; i < Math.min(40, lines.length); i++) {
    if (/^\s*\/\//.test(lines[i]) && CODE_HEADER_RE.test(lines[i])) { start = i; break }
  }
  if (start === -1) return null
  const block = []
  for (let i = start; i < lines.length; i++) {
    if (!/^\s*\/\//.test(lines[i])) break
    block.push(lines[i].replace(/^\s*\/\//, ''))
  }
  const codes = new Set()
  for (const m of block.join('\n').matchAll(CODE_CLAUSE_RE)) codes.add(Number(m[1]))
  if (codes.size === 0) {
    // 标记在、码却解析不出 ⇒ 形状变了。响亮报错，绝不静默放行（否则本门悄悄失效）。
    throw new Error(
      `${lines[start].trim().slice(0, 60)} … 第 ${start + 1} 行的「退出码/返回码」段解析出 0 个码——` +
        '码不再写作 `N = 语义`？请同步本解析器',
    )
  }
  return { line: start + 1, codes: [...codes].sort((a, b) => a - b) }
}

/**
 * 单向对账：每个自述了退出码的脚本，其自述码必须 ⊆ 自身契约行。
 * @param entries `[{ name, allowed: number[], text }]`
 * @returns `{ checked, violations: [{ name, line, extra, allowed }] }`
 */
export function reconcileScriptHeaders(entries) {
  const violations = []
  let checked = 0
  for (const { name, allowed, text } of entries) {
    const hdr = parseScriptHeaderCodes(text)
    if (!hdr) continue
    checked++
    const extra = hdr.codes.filter((c) => !allowed.includes(c))
    if (extra.length) violations.push({ name, line: hdr.line, extra, allowed })
  }
  if (checked === 0) {
    // 一个自述的脚本都没有 ⇒ 要么约定被删、要么解析器脱节。两种都必须响亮报错。
    throw new Error('没有任何随包脚本自述退出码——约定已删或解析器脱节，本门会静默失效')
  }
  return { checked, violations }
}
