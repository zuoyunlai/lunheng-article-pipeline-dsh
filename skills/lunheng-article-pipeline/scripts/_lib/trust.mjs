// 数据信任级别口径（全流水线唯一真源）
//
// 三档（顺序即优先级）：主人投喂 > 二手转引 > 已发布。
// 语义：M-Form-6 / M-Exist-3 要求每条 [Dxx] 有**独立**「信任级别：<档>」行。
// 历史教训：`normalize-trust-level.mjs` 旧版在卡内无 token 时**默认填「已发布」**（最高档），
// 让 M-Form-6 机械判过 —— 证据链污染。现该脚本改为**拒绝推断**（见其头部注释）。

/** 三档取值（顺序即优先级）。 */
export const TRUST_TOKENS = ['主人投喂', '二手转引', '已发布']

/** 合规独立行：`信任级别：<档>（备注）`（markdown 强调星号容错）。 */
export const TRUST_COMPLIANT_RE = /信任级别\**[:：]\s*(已发布|主人投喂|二手转引)/

/** 宽松判定（M-Form-6 双格式：描述字段里含信任级别字样或档位词即可）。 */
export const TRUST_LOOSE_RE = /信任级别\**[:：]|\b已发布\b|\b主人投喂\b|\b二手转引\b/

/** 从卡片切块里挑出档位 token；**无 token 返回 undefined**（调用方必须自己决定如何处理，
 *  不得默认填最高档）。 */
export const pickTrustToken = (block) => TRUST_TOKENS.find((t) => String(block ?? '').includes(t))
