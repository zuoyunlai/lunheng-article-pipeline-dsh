// 汉字口径（全流水线唯一真源）
//
// 口径：纯中文字符数 = Unicode 汉字 U+4E00–U+9FFF，不含标点/数字/英文/引用编号。
// 历史教训：`count-chars.mjs` 用 `[\u4e00-\u9fff]`、`build-evidence-bundle.mjs` 曾用
// `[一-龥]`（= U+4E00–U+9FA5，少 89 个码位）、`05-写作-writer.md` 曾称 `\p{Han}`
// —— 三处口径互不相同，导致同一稿件「定稿结构字数」与「正文区字数」可对不上。
// 现统一到本文件；文档只描述本口径。

/** 汉字正则（全局）。注意：与 `.match()` 搭配安全（String.match 会重置 lastIndex）。 */
export const HAN_RE = /[\u4e00-\u9fff]/g

/** 返回文本中的纯汉字数（非字符串输入按空处理）。 */
export const countHan = (text) => (String(text ?? '').match(HAN_RE) || []).length
