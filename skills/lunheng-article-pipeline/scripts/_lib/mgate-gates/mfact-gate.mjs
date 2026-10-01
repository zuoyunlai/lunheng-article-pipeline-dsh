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

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { h2Headings } from '../sections.mjs';

/** 数字 + 单位/量级的抽取（与 `g-audit-check.mjs` 的 QUANT_RE 同族；**刻意不抓裸年份**）。 */
const NUM_RE = /(\d[\d,]*(?:\.\d+)?)\s*(%|个百分点|倍|万亿|千亿|百亿|亿元|亿美元|万亿元|亿吨|万辆|万台|万人|亿人|千瓦时|GW|MW|kW|kWh|吨|万家|人)/g;

// === v18.54.0（反哺 F-BG）：正文 ↔ 素材 的**字段级**一致性（M-Fact-1 第三项） ===
//
// 为什么并入 M-Fact-1 而不是新开 `M-Fact-2`：前者是**同族、同消费方**（T7/T8 读「跨节事实一致性」一条），
//   新开门项会改动 `total` 与全仓「M 门 24 项」口径（文档 + 用例 + 对照表大面积连带），
//   而本项的**判定归属**与 M-Fact-1 完全一致（都是「正文里的数字/字段与真源不符」）→ 并入更诚实。
//
// 实测现场（本反哺的由来）：臂 B `§4.4 论点 2` 原写「观测[D-CASE27]为 2019 年」，
//   而两臂共用的冻结数据集里 `[D-CASE27]` 的**行发表年与详情标题均为 2023**（DOI 亦含 `-023-`）。
//   **四道门 + M 门 24 项全部未报**：既有 M-Fact-1 只比「正文 ↔ 正文」（两处都错得自洽时它不报），
//   M-Exist-3 只查 `[Dxx]` **编号是否存在**、不核**字段值**。
//
// ⚠️ **防误报口径（三条，照 M-Fact-1 主体与 F-BG 的「宁漏不误」）**：
//   ① 只在**同一句内**同时出现「素材编号 + 四位年份」时才判——跨句不配（否则会把不同句的年份错配到编号上）；
//   ② 素材侧取**年份集合**（表格行发表年 ∪ 详情四位年份 ∪ DOI 年份片段），**命中任一即不报**——
//      故 `[D-CASE28]` 这类「行内错误」（行 2023 / 详情 2019）**两边都不报**（正确：两个值在素材里都有依据）；
//   ③ 素材文件缺失 / 该编号不在素材内 → **跳过并留痕**（不猜、不报），与 M-Form-8 的 `degraded` 同纪律。
//
// **覆盖边界（如实声明，不得夸大）**：只做**年份**这一种字段；**计数/编号对应**（如「N 例」与数据集行数）
//   与**跨句断言**（年份写在另一句）**均未覆盖** → 本项是「零假阳性、低召回」的核对，不构成「字段面已核完」。
const CASE_ID_RE = /\[D-CASE(\d{2,3})\]/g;
const FOUR_DIGIT_YEAR_RE = /(?<!\d)((?:19|20)\d{2})(?!\d)/g;

/** 从素材文件抽 `id -> Set<年份>`（表格行取发表年 + URL 年份片段；非表格行取该行四位年份）。 */
function caseYearsFrom(materialText) {
  const map = new Map();
  for (const line of materialText.split('\n')) {
    const ids = [...line.matchAll(CASE_ID_RE)].map((m) => m[0]);
    if (ids.length === 0) continue;
    const years = new Set();
    if (line.trim().startsWith('|')) {
      const cells = line.split('|').map((s) => s.trim());
      // cells[1]=编号 cells[2]=期刊 cells[3]=出版商 cells[4]=学科 cells[5]=发表年 …
      for (const y of (cells[5] || '').matchAll(FOUR_DIGIT_YEAR_RE)) years.add(y[1]);
      const urlCell = cells.find((c) => /https?:\/\//.test(c)) || '';
      for (const m of urlCell.matchAll(/-(19|20)(\d{2})(?=[-_/.])/g)) years.add(`${m[1]}${m[2]}`);
    } else {
      for (const y of line.matchAll(FOUR_DIGIT_YEAR_RE)) years.add(y[1]);
    }
    for (const id of ids) {
      if (!map.has(id)) map.set(id, new Set());
      for (const y of years) map.get(id).add(y);
    }
  }
  return map;
}

/** 正文里「同一句内 素材编号 + 四位年份」的字段级断言。 */
function caseYearAssertions(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (!/\[D-CASE\d{2,3}\]/.test(line)) return;
    for (const sent of line.split(/(?<=[。；;！？])/)) {
      const ids = [...new Set([...sent.matchAll(CASE_ID_RE)].map((m) => m[0]))];
      if (ids.length === 0) continue;
      const years = [...new Set([...sent.matchAll(FOUR_DIGIT_YEAR_RE)].map((m) => m[1]))];
      if (years.length === 0) continue;
      out.push({ line: i + 1, ids, years, sentence: sent.trim() });
    }
  });
  return out;
}

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

  // ---- 正文 ↔ 素材 字段级一致性（v18.54.0 反哺 F-BG）----
  const materialChecked = { files: [], skipped: '', conflicts: [] };
  {
    const roots = [ctx.projectRoot, ctx.evDir].filter(Boolean);
    const candidates = ['data/撤稿案例数据集.md', 'data/数据卡.md', 'data/数据卡-lite.md'];
    const files = [];
    for (const r of roots) for (const rel of candidates) {
      const p = join(r, rel);
      if (existsSync(p) && !files.includes(p)) files.push(p);
    }
    materialChecked.files = files;
    if (files.length === 0) {
      // 与 M-Form-8 `degraded8` 同纪律：**未执行必须可见**，不能与「核过且无问题」同形。
      materialChecked.skipped = '素材文件未找到（data/撤稿案例数据集.md 或 data/数据卡.md）→ 正文↔素材字段核对**未执行**，不是「通过」';
    } else {
      const yearsById = new Map();
      for (const p of files) {
        for (const [id, set] of caseYearsFrom(readFileSync(p, 'utf8'))) {
          if (!yearsById.has(id)) yearsById.set(id, new Set());
          for (const y of set) yearsById.get(id).add(y);
        }
      }
      for (const a of caseYearAssertions(text)) {
        const bad = [];
        for (const id of a.ids) {
          const allowed = yearsById.get(id);
          if (!allowed || allowed.size === 0) continue;    // 编号不在素材内 → 交给 M-Exist-3，不在此重复报
          if (!a.years.some((y) => allowed.has(y))) bad.push(`${id}(素材: ${[...allowed].sort().join('/')})`);
        }
        if (bad.length) {
          const core = /摘要|结论|结语/.test(sectionOf(text.indexOf(a.sentence.slice(0, 12))));
          materialChecked.conflicts.push({
            line: a.line, ids: a.ids, years: a.years, bad, severity: core ? 'P0' : 'P1',
            sentence: a.sentence.slice(0, 80),
          });
        }
      }
    }
  }

  // ---- 汇总为一条 gate（M-Fact-1）----
  const materialP0 = materialChecked.conflicts.some((c) => c.severity === 'P0');
  // v18.62.4（全量审计-v18.62.3 P1-6）——**本条最终只做「显式计数」，不改 pass/severity**。如实留痕两次尝试：
  //   ① 第一版：素材未核对时把整条 M-Fact-1 记 `SKIP`。**错**——`tests/batch16` 7 条用例全红：
  //      那些用例里数字跨节/术语项**真的跑了也真的没发现问题**，此时把整条记为「未检」等于
  //      用「某个子检查没跑」抵消「其他子检查的干净结论」。
  //   ② 第二版：收窄为「整条记录无任何发现时才 SKIP」。仍错——实测 `tests/mfact-gate.test.mjs` 的
  //      夹具沿用 `mkCase`（只造 `data/撤稿案例数据集.md`，即**素材本该存在**），而素材核对只认
  //      `项目根/data|证据包/data` 三候选；`projectRoot` 在真实项目里正是项目根，故「未找到」在
  //      真实项目里本就是**素材缺失信号**，把它当「本项不适用」会掩盖它。
  //   → 正确的口径（本版）：`正文↔素材年份核对` 是 M-Fact-1 的**子检查**，它没跑时**如实计入 `unchecked`
  //      顶层数组**（见 `m-gate-check.mjs` 的 `unchecked` 统计），**不改变** M-Fact-1 既有的
  //      P0/P1/P2/通过 判定。这样：detail 早已写明「未执行，不是「通过」」（人读可见），
  //      而 `report.unchecked[]` 让**退出码侧/机器侧也看得见**（新增字段，不改既有语义）。
  const materialUnchecked = materialChecked.files.length === 0 && !!materialChecked.skipped;
  const worst = conflicts.some((c) => c.severity === 'P0') || materialP0 ? 'P0'
    : (conflicts.length > 0 || materialChecked.conflicts.length > 0 ? 'P1'
      : (aliasPairs.length > 0 ? 'P2' : '通过'));
  const parts = [];
  if (conflicts.length) parts.push(`数字跨节不一致 ${conflicts.length} 组：` + conflicts.slice(0, 3).map((c) => `「${c.key}」=${c.values.join(' / ')}`).join('；'));
  if (materialChecked.conflicts.length) {
    parts.push(`正文↔素材年份不符 ${materialChecked.conflicts.length} 处：`
      + materialChecked.conflicts.slice(0, 3).map((c) => `L${c.line} ${c.years.join(',')} vs ${c.bad.join(' ')}`).join('；'));
  }
  if (materialChecked.skipped) parts.push(`⚠️ ${materialChecked.skipped}`);
  if (aliasPairs.length) parts.push(`术语近形混用候选 ${aliasPairs.length} 组：` + aliasPairs.slice(0, 3).map((p) => `「${p.a}」(${p.aCount}) / 「${p.b}」(${p.bCount})`).join('；'));
  results.push({
    gate: 'M-Fact-1 跨节事实一致性',
    // v18.62.4（全量审计-v18.62.3 P2-7）：**P2-only 发现不再把整门判 fail**。
    //   病灶（实测）：旧式 `pass: worst === '通过'` 让 `worst === 'P2'` 时 `pass: false` → 该门进 `hard` 桶
    //   → `m-gate-check` 的 `anyFail` 为真 → **exit 3**。而 P2 的语义（本仓多处明文）是「**软提示，需人复核，
    //   不触发返工**」：文风/术语一致性这类判断力项的失败不该把整份定稿卡在非 0 上
    //   （对照：M-Form-8 的裸断言/长句两个 P2 项是 push 进 `soft` 的，从不改 `pass`）。
    //   实测触发面很常见：中文里**正常的「的」插入**（「经济增长」/「经济的增长」）即命中近形对
    //   → 一份干净终稿拿不到 exit 0，只能走 T8 裁定。
    //   现：`worst === 'P2'` 时 `pass: true`（与 P0/P1 一致地「相对档位」），P2 仍如实出现在
    //   `severity`、`p2` 桶与 `aliasPairs` 里 → 人读可见、机器可见，但**不再冒充硬失败**。
    pass: worst === '通过' || worst === 'P2',
    detail: parts.length
      ? parts.join(' ｜ ') + `（容差 ${tol * 100}%；**术语项为 P2 软提示，判级归 T7，不阻断交付**；正文↔素材核对仅覆盖**年份**字段，计数/编号对应与跨句断言未覆盖）`
      : `未发现跨节数字冲突、近形术语混用或正文↔素材年份不符（容差 ${tol * 100}%；素材文件 ${materialChecked.files.length} 个；正文↔素材核对仅覆盖**年份**字段）`,
    severity: worst,
    ...(conflicts.length ? { conflicts } : {}),
    ...(materialChecked.conflicts.length ? { materialConflicts: materialChecked.conflicts } : {}),
    ...(materialChecked.skipped ? { materialSkipped: materialChecked.skipped } : {}),
    // v18.62.4（P1-6）：子检查未执行 → **显式机器可见**（不改变本项 pass/severity，见上方注释）
    ...(materialUnchecked ? { unchecked: ['正文↔素材年份核对（素材文件未找到）'] } : {}),
    ...(aliasPairs.length ? { aliasPairs } : {}),
  });
}
