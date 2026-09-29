// 可读性剖面（v18.26.0 QLT-3 新增）——**分布式指标**，不是单点禁词表
//
// 为什么需要（报告 §三.4 QLT-3 实测证据）：现有 AI 痕迹链路是**禁用式**（`gates/14-中文AI痕迹-gate.md` +
//   `checkers/中文AI痕迹-checker.md`：禁词/禁式），**没有分布式指标**——于是「**为过门而写得机械**」
//   不可检测（把句子都写成同一长度、把术语堆到每段都在定义新词，都能过禁词表）。
//
// 四个指标（口径全部可复算，定义真源 = [`references/checkers/可读性-checker.md`]）：
//   ① `sentenceLenStd`  句长标准差（按句汉字数）——过低 = 句式同质化（机械感的最强信号）
//   ② `longSentenceRatio` >60 汉字的句子占比——过高 = 长句堆叠难读
//   ③ `termRatePer300`  每 300 汉字的新术语数——过高 = 生造术语/定义轰炸
//   ④ `passiveRatio`    含被动标记的句子占比——过高 = 翻译腔/官方腔
//
// ⚠️ **阈值是本机 golden 项目标定的，不是拍脑袋**（标定记录见 checker 文档；n 与分布写在那里）。
//   `evaluate()` 返回**逐指标档位 + 是否触发**，并**同时**返回全部原始值——判级口径：
//   · 「机械感」由 ① 单独触发（std 过低 = 主动判机械，与文风偏好无关）；
//   · ②③④ 只在**超上界**时触发（长句/术语/被动过多），下界不判（写得短、术语少不是缺陷）。
//   **刻意不做总分**：分布式指标的意义在于「看剖面形状」，压成一个分数会掩盖是哪一个维度走形。
//
// === 标定样本登记 + 一处**未决**的口径问题（v18.54.0 反哺 F-BD 的第二半）===
//
// **当前四阈值的标定集 = 21 份常规交付定稿**（标定记录与分布 n 见 `references/checkers/可读性-checker.md`）。
// **第 22 号数据点（已实测、已登记、尚未动用）**：`run/AB-ai-content-farm-B/final/定稿.md`
//   （描述性研究 / 机制说明密集型）实测 `longSentenceRatio = 30.2% > 25%` → **触发上界**。
//   该稿是 **QLT-5 受控 A/B 的实验产物**（分档模型 + 主人授权多轮修订 + 字数压缩轮），
//   故 `tests/readability.test.mjs` 以**具名枚举**把它与其余三份实验稿一起排除在「真实稿不误报」用例之外
//   （排除的是**样本**、**阈值一个数都没动**，理由见该用例注释）。
//
// **⚠️ 未决项（须主人裁定，本包不擅自动阈值）**：这 22 号点既可读作
//   ① **标定集代表性不足**——21 份样本未覆盖「机制说明密集型」体例（该稿在 B 轨轮中按 T6 批判条件
//      补了大量机制说明段，句长自然上升）→ 正解是**把该样本纳入标定集重算四阈值分布**，
//      并考虑**按体例分档**（概念论证型 vs 实证型）；
//   ② 也可读作 **真阳性**——该稿确实偏冗长。
// **两条都能自圆其说，故不能靠调参"解决"**：在拿到地面真值（人工判定该稿是否真的难读）之前改阈值，
//   **等于为了让一个用例变绿而移动量尺**——这正是本仓反复登记的反模式。
// **判据（可迁移）**：**「量尺报警」与「量尺本身要改」之间的那一步，是先去取地面真值**；
//   没有地面真值的阈值调整，无论方向都只是把争议藏起来。

/** 句切分（与 `cite-coverage` / `mfact` 同族口径）：`。；！？` 与换行，丢弃空句。 */
export const splitSentences = (text) => String(text ?? '')
  .split(/(?<=[。；！？])|\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const countHan = (s) => (String(s ?? '').match(/[\u4e00-\u9fff]/g) || []).length;

/** 被动标记（中文被动式的常见标志；**刻意只收明确标志**，避免把「被」字名词误判——如「被子」）。 */
const PASSIVE_RE = /被(?!子|动|告|捕|褥|单|试|害人)|受到|遭到|遭受|为[^，。；]{0,8}所|得以|给予|获评|被评为/;

/**
 * 计算单篇正文的可读性剖面。
 * @param {string} body 正文区文本（`## 摘要` 之后 → 首个文末节之前，与 count-chars 同源）
 * @returns {{ sentences:number, hanChars:number, sentenceLenStd:number, longSentenceRatio:number,
 *            termRatePer300:number, passiveRatio:number, termSamples:string[], longSentenceSamples:string[] }}
 */
export const profile = (body) => {
  const text = String(body ?? '');
  const sents = splitSentences(text);
  const lens = sents.map(countHan);
  const n = lens.length || 1;
  const hanChars = countHan(text);
  const mean = lens.reduce((a, b) => a + b, 0) / n;
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const longSentences = sents.filter((s) => countHan(s) > 60);
  // 新术语代理：**4–6 汉字连续片段中「全篇只出现一次」的那些**（首现即 hapax ≈ 新引入的术语/生造词）。
  //   边界如实声明：这是**代理**，不是词典判定——普通名词缩写、外国人名音译也会被计入；
  //   故它只用来发现「术语密度异常」，不能用来断言「这些不是术语」。
  const tokens = new Map();
  for (const m of text.matchAll(/[\u4e00-\u9fff]{4,6}/g)) tokens.set(m[0], (tokens.get(m[0]) || 0) + 1);
  const hapax = [...tokens.entries()].filter(([, c]) => c === 1).map(([t]) => t);
  const passive = sents.filter((s) => PASSIVE_RE.test(s));
  return {
    sentences: sents.length,
    hanChars,
    sentenceLenStd: +Math.sqrt(variance).toFixed(2),
    longSentenceRatio: +(longSentences.length / n).toFixed(4),
    termRatePer300: +(hapax.length / (hanChars / 300 || 1)).toFixed(2),
    passiveRatio: +(passive.length / n).toFixed(4),
    termSamples: hapax.slice(0, 8),
    longSentenceSamples: longSentences.slice(0, 3).map((s) => s.slice(0, 60)),
  };
};

/** golden 标定出的阈值（2026-09-27，**n=21 份真实定稿**；分布与分位见 checker 文档的标定表）。
 *  **标定原则**：阈值取「**明显异常**」上界（略高于真实稿的极值），而不是中位数——
 *    分布式指标若按中位数划线，会把一半合格稿子判为异常（同批 C-Redundancy 的教训）。
 *    实测极值：std ∈ [14.56, 28.54] / 长句占比 ∈ [2.6%, 22.3%] / 术语率 ∈ [31.6, 44.4] / 被动占比 ∈ [0.8%, 18.7%]。
 *    故四个界分别取 13 / 25% / 50 / 22% —— **全部 21 份真实稿都在界内**（这是「不误报」的实测依据），
 *    而合成机械文本（等长句 + 全 80 字 + 术语轰炸）会同时撞多个界。 */
export const THRESHOLDS = {
  stdMin: 13,            // 句长标准差低于此值 → 句式同质化（机械感）——真实稿最低 14.56
  longRatioMax: 0.25,    // >60 字长句占比上限——真实稿最高 22.3%
  termRateMax: 50,       // 每 300 汉字新术语数上限——真实稿最高 44.4
  passiveRatioMax: 0.22, // 被动句占比上限——真实稿最高 18.7%
};

/**
 * 按标定阈值判定。
 * @returns {{ pass:boolean, severity:'PASS'|'P2', hits:string[], metrics:object }}
 *   **绝不判 P0/P1**：可读性是**文风维度**，不是正确性——把文风挂成硬失败会立刻产生「为过门而写」
 *   的反向激励（本模块存在的理由就是检测那种激励的后果）。故最高只到 P2 软提示。
 */
export const evaluate = (body, th = THRESHOLDS) => {
  const m = profile(body);
  const hits = [];
  if (m.sentences >= 20 && m.sentenceLenStd < th.stdMin) hits.push(`句长标准差 ${m.sentenceLenStd} < ${th.stdMin}（句式同质化）`);
  if (m.longSentenceRatio > th.longRatioMax) hits.push(`>60 字长句占比 ${(m.longSentenceRatio * 100).toFixed(1)}% > ${(th.longRatioMax * 100).toFixed(0)}%`);
  if (m.termRatePer300 > th.termRateMax) hits.push(`每 300 字新术语 ${m.termRatePer300} > ${th.termRateMax}`);
  if (m.passiveRatio > th.passiveRatioMax) hits.push(`被动句占比 ${(m.passiveRatio * 100).toFixed(1)}% > ${(th.passiveRatioMax * 100).toFixed(0)}%`);
  return { pass: hits.length === 0, severity: hits.length === 0 ? 'PASS' : 'P2', hits, metrics: m };
};
