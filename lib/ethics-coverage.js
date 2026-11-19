// 伦理脱敏的「未覆盖形态」探测器（v19.27.21 · 第三方全量审计-2026-11-19 §P1-2 ①）
//
// 要解决的问题（真机实测，见 lib/ethics-sanitize.js 的 COVERAGE 头注释）：本工具对 IDN 邮箱 /
//   护照号 / 详细门牌 / 即时通讯账号 / 车牌 **一律原样返回、计数为 0**。而「计数为 0」与
//   「确实干净」在输出上**长得一样**——消费方无法区分「我扫过、也确实没有」与「我扫过、但
//   我没有这个能力」。这正是本仓最贵的一类缺陷的变体：**不是静默失败，而是静默的成功信号不足**。
//
// 判据：把「我没有能力」也变成一条**可核事实**。故本探测器**只登记、绝不改写**：
//   · 命中 → uncovered[kind] 计数，并向 reviewFlags 压**一条**该 kind 的说明（按 kind 去重，
//     不按命中数刷屏——与 dict-missing 的处置同构）；
//   · **不改正文**：这些形态的判定精度远低于硬模式（车牌正则能误伤物料编号、护照形态能与型号串
//     相撞），自动改写会造成本仓最贵的「静默损坏正文」。让它可见、由人处置。
//
// 为什么单独一个文件而不是塞进 ethics-sanitize.js：后者已 500+ 行且承载主流程；探测器是
//   **可独立测试**的纯函数（`tests/ethics-coverage.test.mjs` 直接 import 断言），拆开后可单独演进，
//   也避免主文件继续膨胀（审计 §P2-9 点名的复杂度债）。
//
// 边界（如实）：本探测是**启发式**，召回与精度都不保证——它只回答「像不像」，不回答「是不是」。
//   命中不代表一定有 PII（`E12345678` 可能是物料编码）；**未命中也不代表没有**。
//   它的价值不是「查全」，而是消灭「0 就是干净」这个错误等式。

const patterns = [
  // IDN 邮箱：ASCII local-part + 中文域名。**必须与 hard 模式的 email 相邻看**——后者只认 ASCII
  //   TLD，故 `张三@例子.中国` 在硬模式里结构不可达、必不命中；本条把它变成可见事实。
  {
    kind: 'idn-email',
    why: 'IDN（中文域名）邮箱——硬模式只认 ASCII 域名，本形态**未被改写**',
    // ⚠️ local-part 也必须允许中文：首次落盘只写了 ASCII（`[A-Za-z0-9._%+-]`），于是审计样本
    //   `张三@例子.中国`（**中文** local-part）反而不命中——测试当场抓到。两种 IDN 形态都要收：
    //   `ascii@中文域名` 与 `中文@中文域名`。
    re: new RegExp('[A-Za-z0-9._%+\\u4e00-\\u9fff-]{1,64}@[\\u4e00-\\u9fff][^\\s，。；：、]{1,40}', 'g'),
    required: '@',
  },
  // 护照 / 其它证件号：1-2 位拉丁字母 + 7-9 位数字。7 位起步是为了避开 `B2B` / `GPT4` 这类型号。
  {
    kind: 'passport-like',
    why: '护照/证件号形态（字母+7-9 位数字）——**未被改写**，须人工确认',
    re: new RegExp('\\b[A-Z]{1,2}\\d{7,9}\\b', 'g'),
  },
  // 详细门牌：街道以下的粒度。「号」单独不收（`5号线` 这类编号会大量误伤），
  //   只收带 楼/院/栋/单元/室/层 的组合。
  {
    kind: 'street-address',
    why: '详细地址门牌（街道以下）——地名词表只到区县，**街道与门牌未被改写**',
    re: new RegExp('\\d{1,4}(?:号楼|号院|栋|单元|室|层)', 'g'),
  },
  // 即时通讯账号：微信号 / wxid / QQ 号。`QQ 123456789` 与 `wxid_xxx` 是本机实测漏检的两种。
  {
    kind: 'im-account',
    why: '即时通讯账号（微信号 / QQ / 各类 ID）——**未被改写**（短纯数字与订单号无法区分）',
    re: new RegExp('(?:wxid_[A-Za-z0-9_-]{4,}|\\b[Qq]{2}\\s*[:：]?\\s*\\d{5,12}\\b|\\b(?:wechat|weixin|vx|v信)\\s*[:：]?\\s*[A-Za-z0-9_-]{4,})', 'g'),
  },
  // 车牌：省份简称 + 字母 + 5 位。误伤面（编号/型号）可控。
  {
    kind: 'plate',
    why: '车牌——**未被改写**（车牌判定依赖省份简称表，未纳入本工具）',
    re: new RegExp('[京津冀晋蒙辽吉黑沪苏浙皖闽赣鲁豫鄂湘粤桂琼渝川贵云藏陕甘青宁新][A-Z][·\\-]?[A-Z0-9]{5}', 'g'),
  },
]

/** 未覆盖形态的 kind 清单（H2 标记与工具面据此过滤，单点真源）。 */
export const UNCOVERED_KINDS = Object.freeze(patterns.map((p) => p.kind))

/** 各形态的人类可读说明（键 = kind），供标记与 render 拼文案，避免多处手抄。 */
export const UNCOVERED_WHY = Object.freeze(
  Object.fromEntries(patterns.map((p) => [p.kind, p.why])),
)

/**
 * 扫一遍原文，返回各未覆盖形态的命中计数（**不改写任何内容**）。
 * @param {string} src - **原文**（不是已替换的中间串——否则占位符会把形态遮住）。
 * @returns {{counts: Record<string, number>, hits: Array<{kind: string, why: string, count: number}>}}
 */
export function detectUncovered(src) {
  const counts = {}
  const hits = []
  if (typeof src !== 'string' || !src) return { counts, hits }
  for (const p of patterns) {
    if (p.required && !src.includes(p.required)) continue
    p.re.lastIndex = 0
    const n = (src.match(p.re) || []).length
    if (n > 0) {
      counts[p.kind] = n
      hits.push({ kind: p.kind, why: p.why, count: n })
    }
  }
  return { counts, hits }
}
