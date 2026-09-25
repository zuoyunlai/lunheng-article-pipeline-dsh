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

// v18.12.0 修复（**假阳性阻塞门**，依据 2026-09-25 全量审计 L-52；实测三变体对照）：
//   模板 `数据卡-template.md:37-41` 的「## 📇 索引段」是**围栏代码块内的行首裸编号**，且位置在正文条目**之前**；
//   而 `:59-64` 的条目形态恰恰也是「行首 `[Dxx] …`」。于是标题式不命中（条目无 `###`）、回退行内式时
//   **索引段行先命中** → 切出的块是索引行 → 块内当然没有「信任级别」行 →
//   **一张完全照模板写的卡被判 M-Form-6「独立段缺失」P0**（条目 ≥6 条时必触发，`mform6P0=5`），
//   并派生 M-Integrity-1 P0。即「照规范做必失败」。
//   现两道防线：① 匹配前用 `maskFences` 遮罩围栏（模板形态的索引段直接不参与匹配）；
//   ② 行内式有多个候选时，**优先挑「看起来像真条目」的那个**（含 `信任级别` 或 `├/└/│` 引导符），
//      都没有才退回第一个（保持对「条目真的没写信任级别」的既有判定——那本就该报 P0）。
//   遮罩逐字节保长，故 `index` 仍可直接用于**原文**切片。
import { maskFences } from './sections.mjs'

/** 条目正文的尾部锚（下一个标题 / 下一条 [Dxx] / 文件末）。 */
const BODY_TAIL = '([\\s\\S]*?)(?=\\n#{1,4}\\s|\\n\\[D\\d+\\]|$)'

/** 标题式条目：`### [Dxx] 标题` 起（**首选**——索引段行不会命中它）。 */
export const cardHeadingPattern = (id) => new RegExp(`#{2,4}\\s*\\[D${id}\\][^\\n]*\\n${BODY_TAIL}`)

/** 行内式条目：行首 `[Dxx] …`（v3 头部格式，无标题时回退用）。 */
export const cardLinePattern = (id) => new RegExp(`\\n\\[D${id}\\][^\\n]*\\n${BODY_TAIL}`)

/** 块「看起来像真条目」：含信任级别字样或模板的树形引导符（索引段行两者皆无）。 */
const looksLikeEntry = (block) => /信任级别/.test(block) || /[├└│]/.test(block)

// v18.0.3 删除：`cardPattern`（合并形态）为死代码——全库（含本文件）零引用，且自带 @deprecated。

/**
 * 切出某条 [Dxx] 的卡片块。
 * **优先标题式**（`### [Dxx]`），找不到才回退行内式（`[Dxx] …` 行）——防索引段行抢先命中。
 * 行内式多命中时优先「像真条目」的那个（见文件头 v18.12.0 说明）。
 * @returns {{ block: string, index: number, body: string, form: 'heading'|'line' } | null} 未匹配返回 null
 */
export const splitCard = (text, id) => {
  const t = String(text ?? '')
  const masked = maskFences(t)
  for (const [form, re] of [['heading', cardHeadingPattern(id)], ['line', cardLinePattern(id)]]) {
    const hits = [...masked.matchAll(new RegExp(re.source, 'g'))]
    if (hits.length === 0) continue
    const at = (m) => ({ index: m.index, block: t.slice(m.index, m.index + m[0].length), bodyLen: m[1] === undefined ? 0 : m[1].length })
    const pick = hits.map(at).find((c) => looksLikeEntry(c.block)) ?? at(hits[0])
    return { block: pick.block, index: pick.index, body: pick.block.slice(pick.block.length - pick.bodyLen), form }
  }
  return null
}
