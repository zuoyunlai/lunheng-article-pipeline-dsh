// 引用编号口径（全流水线唯一真源）
//
// 论衡的素材编号：[Lxx] 文献 / [Dxx] 数据 / [Cxx] 案例 / [C-主xx] 主人洞察 / [先xx] 先行者。
// 历史教训：`build-evidence-bundle.mjs` 曾用 `\[([LCFD])(\d{2,3})\]`（限 2-3 位）统计卡数，
// 而引用闭环用 `\[L\d+\]`（任意位）—— 1 位编号（[L1]）或补检索回填的 4 位编号会被漏计，
// 审计视图出现「素材卡 = 0，引用 = 5」的自相矛盾。现统一到本文件。
//
// ⚠️ 用法约定（避免 lastIndex 串味）：
//   - 需要 `exec` 循环或长期持有 → 用**工厂**每次新建（如 `refRegex('L')`）；
//   - 只做一次性 `String.match` / `matchAll` → 也可用工厂，语义等价。

/** 素材卡编号（种类字母 + 任意位数），带捕获组：m[1]=种类，m[2]=序号。 */
export const refCardPairRegex = () => /\[([LCFD])(\d+)\]/g

/** 单一类型编号（全局），用于统计引用条数。 */
export const refRegex = (kind) => new RegExp(`\\[${kind}\\d+\\]`, 'g')

/** 单一类型编号（非全局），用于 `line.match(re)` 取首个匹配并保留捕获组语义。 */
export const refRegexFirst = (kind) => new RegExp(`\\[${kind}\\d+\\]`)

/** 文本中出现的某类型编号数组（空安全）。 */
export const refsOf = (text, kind) => String(text ?? '').match(refRegex(kind)) || []

/** 数据卡编号集合（去重、按出现顺序）：用于 M-Form-6 / M-Exist-3 / 规范化脚本。 */
export const dataCardIds = (text) => [...new Set([...String(text ?? '').matchAll(/\[D(\d+)\]/g)].map((m) => m[1]))]

// ── v18.49.0（反哺 F-AG）：**范围写法展开**（本文件成为唯一真源） ──
// 为什么需要它：文末节把条目写成**区间**（`[D01]–[D12]`）时，**只按单编号正则匹配会只命中首尾两项**，
//   中间的 D02–D11 全被判「漏引 / 引了没读」——实测题1 的「漏引 13」中 **10 条**纯属区间写法所致；
//   而 detail 只报「漏引 N」，主控与写手极易误判成「缺条目」去补条目（治标不治本、白绕一圈）。
// 语义（与 M-Form-11 原有的局部实现一致，故此处**上提为同源**，两处不再各写一份）：
//   · 仅在同一字母内展开（`[L01]-[D08]` 属笔误，不展开）；
//   · 起止倒序、或跨度 > 30 视为笔误 → **不展开**并计入 `bad`（由调用方如实报出，不静默吞掉）；
//   · 展开时**按起始编号的位数补零**（`[D01]-[D12]` → `[D01]…[D12]`）。
/** 展开文本中的编号区间写法 → { extra: Set<string>, bad: string[] }。 */
export const expandRefRanges = (seg) => {
  const extra = new Set()
  const bad = []
  // ── v18.60.1（主人授权反哺 v2 §1.1）：**先切除 `## AI 使用声明` 节，再展开区间** ──
  //   为什么：该节的区间编号（如「本文 [L01]-[L15] 文献与 [D01]-[D30] 数据均经核验」）是
  //   **披露性描述**，不承担引用闭环义务；但展开后它们会进入「文末引用集」，与正文对账时
  //   被判为**假孤儿**。实测（论衡实测项目-夫妻收入差异家庭权力）：AI 声明两处区间展开出
  //   45 个编号，其中 4 个在正文无实质引用 → M-Exist-1 报「硬孤儿 4」——而该项目正文与
  //   文末五节双向 50/50 编号完全一致（`diag-orphan.mjs` 复算证实）。因 M-Exist-1 属
  //   v18.11.0 F-1 的 4 类「硬红线」（不可 LLM 兜底），该假阳性会**硬性阻断交付并拒绝
  //   T8 裁定**，故必须在源头切除。
  //   切除范围：从 `## AI 使用声明` 标题行起至文本末尾（该节固定为文末最后一节）。
  const src = String(seg ?? '').replace(/^##\s*AI\s*使用声明[\s\S]*$/m, '')
  for (const m of src.matchAll(/\[([LDC])(\d+)\]\s*[-–—~至]\s*\[([LDC])(\d+)\]/g)) {
    const [, a, n1, b, n2] = m
    if (a !== b) { bad.push(m[0]); continue }
    const lo = Number(n1), hi = Number(n2)
    if (hi < lo || hi - lo > 30) { bad.push(m[0]); continue }
    for (let i = lo; i <= hi; i++) extra.add(`[${a}${String(i).padStart(n1.length, '0')}]`)
  }
  return { extra, bad }
}

/** 某类型编号集合 —— **含区间写法展开**（替代裸 `new Set(text.match(refRegex(kind)))`）。 */
export const refsSetExpanded = (text, kind) => {
  const { extra } = expandRefRanges(text)
  const own = [...extra].filter((id) => id.startsWith(`[${kind}`))
  return new Set([...(String(text ?? '').match(refRegex(kind)) || []), ...own])
}
