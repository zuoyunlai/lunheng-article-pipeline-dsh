// 素材卡切块口径（全流水线唯一真源）
//
// 与 M 门 M-Form-6 同款切块：从 `## [Dxx] 标题`（或行首 `[Dxx] …` 行）切到下一个标题/下一张卡之前。
// 历史教训：`m-gate-check.mjs` 与 `normalize-trust-level.mjs` 各持一份**逐字符相同**的正则字面量，
// 规范一改就要同步两处（已发生过漏同步）。现统一到本文件。

/** 针对某个 [Dxx] 编号的切块正则（带捕获组 1 = 卡片正文）。 */
export const cardPattern = (id) => new RegExp(`(?:#{2,4}\\s*\\[D${id}\\]|\\n\\[D${id}\\][^\\n]*\\n)([\\s\\S]*?)(?=\\n#{1,4}\\s|\\n\\[D\\d+\\]|$)`)

/**
 * 切出某条 [Dxx] 的卡片块。
 * @returns {{ block: string, index: number, body: string } | null} 未匹配返回 null
 */
export const splitCard = (text, id) => {
  const m = String(text ?? '').match(cardPattern(id))
  if (!m) return null
  return { block: m[0], index: m.index, body: m[1] ?? '' }
}
