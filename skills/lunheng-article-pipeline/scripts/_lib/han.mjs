// 汉字口径（全流水线唯一真源）
//
// 口径：纯中文字符数 = Unicode 汉字 U+4E00–U+9FFF，不含标点/数字/英文/引用编号。
// 历史教训：`count-chars.mjs` 用 `[\u4e00-\u9fff]`、`build-evidence-bundle.mjs` 曾用
// `[一-龥]`（= U+4E00–U+9FA5，少 89 个码位）、`05-写作-writer.md` 曾称 `\p{Han}`
// —— 三处口径互不相同，导致同一稿件「定稿结构字数」与「正文区字数」可对不上。
// 现统一到本文件；文档只描述本口径。

/** 汉字正则（**无 `g` 标志**）。
 *  v18.2.6 修（第三方审计 P2）：旧版导出**模块级共享的 `/[\u4e00-\u9fff]/g`**——带 `g` 的正则对象自带
 *  `lastIndex` 状态，任何调用方用 `.test()`/`.exec()` 复用同一个对象都会**跨调用互相污染**
 *  （实测连续三次 `HAN_RE.test()` 得 `true, true, false`：`lastIndex` 停在末尾后再次 test 从末尾起搜）。
 *  本模块内部只用 `.match()`（会重置 `lastIndex`）故侥幸无事，但导出 `g` 正则等于把陷阱递给所有调用方
 *  （`count-chars.mjs` 曾把它作为 `HAN` 导入——实为**死导入**，已随之删除）。
 *  现导出**无状态**版本：口径不变（U+4E00–U+9FFF），`.test()`/`.exec()` 语义可预期。 */
export const HAN_RE = /[\u4e00-\u9fff]/

/** 计数用正则：**每次调用新建**（`match` 需要 `g` 才返回全部匹配；就地新建即无状态污染）。 */
const countRe = () => /[\u4e00-\u9fff]/g

/** 返回文本中的纯汉字数（非字符串输入按空处理）。 */
export const countHan = (text) => (String(text ?? '').match(countRe()) || []).length
