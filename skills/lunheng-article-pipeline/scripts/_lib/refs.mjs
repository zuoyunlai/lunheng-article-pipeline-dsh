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
