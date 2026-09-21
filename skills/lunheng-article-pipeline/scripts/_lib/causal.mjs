// 因果强度口径（v18.2.9 方案「G 体系机械下沉」）
//
// 三档因果词表，供 apply-diff 做「causal 守恒」——改稿时因果强度不静默升级。
// 边界（论衡铁律「机械只做守恒、不做强度判定」）：
//   本模块只回答「这段文本命中的最强因果档位」，用于对比编辑前后强度是否漂移；
//   「这篇论文的因果主张是否过强」是语义判断，归 G3 逻辑（LLM），本模块不碰。
//
// 词表刻意排除宽泛情态动词（may/might/could）与多义中文词（决定/必然）——它们
// 在大量语境里不是因果，纳入会制造误报。故三档只收**明确**的因果/相关性动词。
// 设计：`CAUSAL_WORDS` 是**单一真源**（词数组），正则由它生成——测试可逐词注入（删词即红）。

/** 三档词表（单一真源；英文按词边界匹配、中文直接子串）。 */
export const CAUSAL_WORDS = {
  strong: {
    en: ['causes', 'caused', 'leads to', 'led to', 'demonstrates', 'demonstrate', 'proves', 'prove', 'proved', 'establishes', 'establish'],
    zh: ['导致', '引起', '证明', '证实'],
  },
  suggestive: {
    en: ['associated with', 'correlated', 'correlation', 'correlate', 'suggests', 'suggest', 'contributes to', 'contribute to'],
    zh: ['相关', '提示', '有助于'],
  },
  null: {
    en: ['no significant', 'no association', 'did not', 'failed to'],
    zh: ['未发现显著', '无显著', '无关'],
  },
}

/** 词表 → 正则：英文加 `\b` 词边界（防 "because" 误命中 "caused"）、空白转 `\s+`；中文直接子串。 */
const reOf = (en, zh) => [
  ...en.map((w) => new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`, 'i')),
  ...zh.map((w) => new RegExp(w)),
]

export const CAUSAL_STRONG = reOf(CAUSAL_WORDS.strong.en, CAUSAL_WORDS.strong.zh)
export const CAUSAL_SUGGESTIVE = reOf(CAUSAL_WORDS.suggestive.en, CAUSAL_WORDS.suggestive.zh)
export const CAUSAL_NULL = reOf(CAUSAL_WORDS.null.en, CAUSAL_WORDS.null.zh)

/** 返回文本命中的**最强**档位：'strong' | 'suggestive' | 'null' | null（无命中）。 */
export const causalStrength = (text) => {
  const s = String(text ?? '')
  if (CAUSAL_STRONG.some((re) => re.test(s))) return 'strong'
  if (CAUSAL_SUGGESTIVE.some((re) => re.test(s))) return 'suggestive'
  if (CAUSAL_NULL.some((re) => re.test(s))) return 'null'
  return null
}

/** 档位序（用于判断「升级」：rank 变大即强度升级）。null 档 rank 最低（无因果词）。 */
export const CAUSAL_RANK = { null: 0, suggestive: 1, strong: 2 }
