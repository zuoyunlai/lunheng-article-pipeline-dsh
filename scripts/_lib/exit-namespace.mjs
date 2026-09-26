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

/** 双向差集：返回只在一侧出现的码。 */
export function reconcile(actual, declared) {
  return {
    onlyInCode: actual.filter((c) => !declared.includes(c)),
    onlyInDoc: declared.filter((c) => !actual.includes(c)),
  }
}
