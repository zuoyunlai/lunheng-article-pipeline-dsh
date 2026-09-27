// M-Fact 事实一致性门族（v18.25.0 QLT-2 新增）
//
// 为什么单独一族、不用 `M-Form-12`：`05-写作-writer.md` 的 v18.12.0 注记明确记载「机检 **M-Form-12** 子门」
//   是**历史假绿编号**——M 门体系内**不存在**该门（M-Form 止于 11）。故跨节事实一致性取新前缀 `M-Fact-`。
//
// 定位（QLT-2 实测证据）：现有 M-Form-9 只做**图件**闭环（[图N] ↔ 图件 ↔ 图上数字）；
//   摘要 / 正文 / 表格 / 图注 / 结论之间的**数字与术语一致性**此前无任何机械检查——而这是长文最常见的硬伤。
//
// 两项检查：
//   · **数字跨节一致性**（M-Fact-1 主体）：抽「**同一表述 + 数字**」，若同一表述在不同节给出**不同数值** → P1；
//     其中任一出现落在**摘要 / 结论**节 → **P0**（核心结论口径不一致，规格如此）。
//   · **术语别名混用**（M-Fact-1 子项）：同一概念写成两个仅差一个中缀（型/性/化/式/的）的表述且各自 ≥2 次 → **P2 候选**。
//
// ⚠️ **两条防误报口径（照 C-Redundancy 的教训写死在实现里）**：
//   ① **键必须是「具体表述」**：≥4 汉字、不含通用词（增长/占比/比例/以上/以下/超过/约…）、且**逐字重复**才成组——
//      否则「增长」这类通用词会把两处无关的百分比凑成一组 = 假阳性（实测句尺度误报的成因同源）。
//   ② **容差 2%**：`约 68%` 与 `68.1%` 视为一致（与 SKILL.md「主人软接受档 ±2%」同口径）；
//      且剥离 约/近/逾/超过/达/为/是/共/左右/大约 等修饰词后再比键。

import { h2Headings } from '../sections.mjs';

/** 数字 + 单位/量级的抽取（与 `g-audit-check.mjs` 的 QUANT_RE 同族；**刻意不抓裸年份**）。 */
const NUM_RE = /(\d[\d,]*(?:\.\d+)?)\s*(%|个百分点|倍|万亿|千亿|百亿|亿元|亿美元|万亿元|亿吨|万辆|万台|万人|亿人|千瓦时|GW|MW|kW|kWh|吨|万家|人)/g;

/** 键归一化：剥离程度/估计类修饰词与标点空白，便于「同一表述」逐字对齐。 */
const MODIFIERS = /(大约|约|近|逾|超过|多达|高达|约为|达到|达|为|是|共|左右|以上|以下|超过|逾|近|约)/g;

export function mFact1(ctx) {
  const { text, results, THRESHOLDS } = ctx;
  const tol = THRESHOLDS.mfact1Tolerance;
  const minKey = THRESHOLDS.mfact1MinKeyHan;
  const aliasMin = THRESHOLDS.mfact1AliasMinHits;
  // 通用词：出现在键里则该键**不成组**（它们描述的是「趋势/比例」而非某个具体事实）
  const GENERIC = /^(增长|下降|上升|占比|比例|幅度|速度|增速|规模|数量|水平|以上|以下|左右|平均|合计)/;
  // **键必须是「事实标签」而不是从句片段**（v18.25.0 实测校准，防假阳性的第二道闸）：
  //   实测某真实项目出现两处假阳性——键「可能的反驳」（55.8 / 88 / 84）与「年调查中」（85 / 97 / 90）：
  //   它们都是**从句碎片**，后面的百分比各指不同的调查项，根本不是「同一事实的两次出现」。
  //   两道约束：① 含从句标记词（的可能说明表明显示认为指出例如其中此外并且在有与和及或）→ 不成组；
  //   ② 以从句式结尾（中上后前者来时的下）→ 不成组。**代价如实声明**：会漏掉「…中」这类键（如含「中」的事实名），
  //   属**宁漏不误**——本门是硬门（P0/P1），假阳性的代价远高于漏检。
  const CLAUSE_MARK = /(的|可能|说明|表明|显示|认为|指出|例如|其中|此外|并且|在|有|与|和|及|或)/;
  const CLAUSE_TAIL = /[中上后前者来时的下]$/;

  // ⚠️ `ctx.h2s` 是**标题字符串数组**（`mForm2` 用 `h.startsWith(s)` 消费），**没有位置信息**——
  //    首版据此算「节归属」得 `undefined <= idx` 恒假 → 所有命中都归到空节 → `sections.size === 1`
  //    → 「跨节」永不成立 → **注入用例（摘要 86% / 正文 68%）实测不报**（假阴性）。
  //    现自己用共享 `h2Headings(text)` 取**带 index 的标题**（与 count-chars / g-audit 同源）。
  const heads = h2Headings(text);
  /** 取某个下标所在的 H2 节标题（无则 ''）。 */
  const sectionOf = (idx) => {
    let cur = '';
    for (const h of heads) { if (h.index <= idx) cur = h.title; else break; }
    return cur;
  };
  /** 取数字前的键：向左最多 12 字，遇标点/数字/引用编号/换行停。 */
  const keyBefore = (idx) => {
    const win = text.slice(Math.max(0, idx - 12), idx);
    const cut = win.split(/[，。；：、\n|｜\]\[（）()\s]/).filter(Boolean).pop() || '';
    return cut.replace(MODIFIERS, '').trim();
  };

  // ---- 数字跨节一致性 ----
  const groups = new Map();   // key -> [{value, unit, idx, section}]
  for (const m of text.matchAll(NUM_RE)) {
    const key = keyBefore(m.index);
    if ([...key].length < minKey) continue;          // 键太短 → 不是「具体表述」
    if (GENERIC.test(key)) continue;                 // 通用词 → 不成组
    if (CLAUSE_MARK.test(key) || CLAUSE_TAIL.test(key)) continue;   // 从句片段 → 不成组（实测假阳性来源）
    const value = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ value, unit: m[2], idx: m.index, section: sectionOf(m.index), raw: m[0].trim() });
  }
  const conflicts = [];
  for (const [key, hits] of groups) {
    const sections = new Set(hits.map((h) => h.section));
    if (sections.size < 2) continue;                 // 「跨节」才判——同节内重复表述不查
    const vals = hits.map((h) => h.value);
    const max = Math.max(...vals), min = Math.min(...vals);
    if (max === 0) continue;
    if ((max - min) / max <= tol) continue;          // 容差内视为一致（约 68% vs 68.1%）
    const units = new Set(hits.map((h) => h.unit));
    if (units.size > 1) continue;                    // 单位不同（万 vs 亿）→ 数值天然不同，不判（避免换算假阳性）
    const core = hits.some((h) => /摘要|结论|结语/.test(h.section));
    conflicts.push({
      key, values: vals, units: [...units][0],
      sections: [...sections],
      hits: hits.map((h) => ({ section: h.section, raw: h.raw, value: h.value })),
      severity: core ? 'P0' : 'P1',
    });
  }

  // ---- 术语别名混用（P2 候选）----
  // 只找「A」与「A + 一个中缀」这类近形对（型/性/化/式/的），且两者都 ≥ aliasMin 次。
  // **⚠️ 召回边界（如实声明）**：取词用 `[\u4e00-\u9fff]{4,6}`，故只在词**被标点/空白/换行切出**时可见——
  //   嵌在长句里的术语（如「认为续约频率是核心变量」）不会被单独取出。这是**刻意**的：改成滑窗全量取词会把
  //   任意 4-6 字片段都当候选，假阳性爆炸。故本子项是**零假阳性、低召回**的候选生成器（判级归 T7）。
  //   实测（2026-09-27）：21 个真实项目中 1 例命中（`海外驻军-主权分离` 的「续约频率」(16) /「续约的频率」(2)）。
  const aliasPairs = [];
  {
    const INFIX = /(型|性|化|式|的)/g;
    const counts = new Map();
    for (const m of text.matchAll(/[\u4e00-\u9fff]{4,6}/g)) {
      counts.set(m[0], (counts.get(m[0]) || 0) + 1);
    }
    const seen = new Set();
    for (const [term, n] of counts) {
      if (n < aliasMin || seen.has(term)) continue;
      for (const inf of ['型', '性', '化', '式', '的']) {
        for (let i = 1; i < term.length - 1; i++) {
          if (term[i] !== inf) continue;
          const short = term.slice(0, i) + term.slice(i + 1);
          const cn = counts.get(short) || 0;
          if (cn >= aliasMin) {
            const pairKey = [short, term].sort().join('|');
            if (seen.has(pairKey)) continue;
            seen.add(pairKey); seen.add(term); seen.add(short);
            aliasPairs.push({ a: short, aCount: cn, b: term, bCount: n });
          }
        }
      }
    }
    void INFIX;
  }

  // ---- 汇总为一条 gate（M-Fact-1）----
  const worst = conflicts.some((c) => c.severity === 'P0') ? 'P0'
    : (conflicts.length > 0 ? 'P1' : (aliasPairs.length > 0 ? 'P2' : '通过'));
  const parts = [];
  if (conflicts.length) parts.push(`数字跨节不一致 ${conflicts.length} 组：` + conflicts.slice(0, 3).map((c) => `「${c.key}」=${c.values.join(' / ')}`).join('；'));
  if (aliasPairs.length) parts.push(`术语近形混用候选 ${aliasPairs.length} 组：` + aliasPairs.slice(0, 3).map((p) => `「${p.a}」(${p.aCount}) / 「${p.b}」(${p.bCount})`).join('；'));
  results.push({
    gate: 'M-Fact-1 跨节事实一致性',
    pass: worst === '通过',
    detail: parts.length ? parts.join(' ｜ ') + `（容差 ${tol * 100}%；术语项为 P2 候选，判级归 T7）` : `未发现跨节数字冲突或近形术语混用（容差 ${tol * 100}%）`,
    severity: worst,
    ...(conflicts.length ? { conflicts } : {}),
    ...(aliasPairs.length ? { aliasPairs } : {}),
  });
}
