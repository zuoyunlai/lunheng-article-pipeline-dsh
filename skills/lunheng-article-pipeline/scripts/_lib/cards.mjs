// 素材卡切块口径（全流水线唯一真源）
//
// 与 M 门 M-Form-6 同款切块：从 `## [Dxx] 标题`（或行首 `[Dxx] …` 行）切到下一个标题/下一张卡之前。
// 历史教训：`m-gate-check.mjs` 与 `normalize-trust-level.mjs` 各持一份**逐字符相同**的正则字面量，
// 规范一改就要同步两处（已发生过漏同步）。现统一到本文件。
//
// v2.5.2-dsh.17 修复（**假阳性阻塞门**，实测）：
//   旧版把两种形态写在**同一个正则**里（`#{2,4}\s*\[Dxx\]` | `\n\[Dxx\][^\n]*\n`），
//   而卡片的「## 📇 索引段」行形如 `[D01] 甲 ｜ 主题 ｜ 论点1`，在文档里**出现在正文条目前面**——
//   正则按位置从左到右扫描，于是**索引行先命中**，切出来的 body 是「索引段剩余部分」而非条目正文。
//   后果：一张**条目全部合规**的 8 条数据卡 → M-Form-6 判「独立段缺失」8 条 → **P0 → 阻塞交付**；
//   条目越多的卡越必然踩中（>5 条即 P0）。现改为**优先标题式、回退行内式**两段匹配。

/** 条目正文的尾部锚（下一个标题 / 下一条 [Dxx] / 文件末）。 */
const BODY_TAIL = '([\\s\\S]*?)(?=\\n#{1,4}\\s|\\n\\[D\\d+\\]|$)'

/** 标题式条目：`### [Dxx] 标题` 起（**首选**——索引段行不会命中它）。 */
export const cardHeadingPattern = (id) => new RegExp(`#{2,4}\\s*\\[D${id}\\][^\\n]*\\n${BODY_TAIL}`)

/** 行内式条目：行首 `[Dxx] …`（v3 头部格式，无标题时回退用）。 */
export const cardLinePattern = (id) => new RegExp(`\\n\\[D${id}\\][^\\n]*\\n${BODY_TAIL}`)

// v18.0.3 删除：`cardPattern`（合并形态）为死代码——全库（含本文件）零引用，且自带 @deprecated。

/**
 * 切出某条 [Dxx] 的卡片块。
 * **优先标题式**（`### [Dxx]`），找不到才回退行内式（`[Dxx] …` 行）——防索引段行抢先命中。
 * @returns {{ block: string, index: number, body: string, form: 'heading'|'line' } | null} 未匹配返回 null
 */
export const splitCard = (text, id) => {
  const t = String(text ?? '')
  for (const [form, re] of [['heading', cardHeadingPattern(id)], ['line', cardLinePattern(id)]]) {
    const m = t.match(re)
    if (m) return { block: m[0], index: m.index, body: m[1] ?? '', form }
  }
  return null
}
