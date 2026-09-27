#!/usr/bin/env node
// 论衡 G 项机检门（v18.23.0 EFF-1 新增 / scripts 白名单 24→25）
//
// 用法：node g-audit-check.mjs <正文.md> [--cards <目录>] [--brief <任务简报.md>] [--qlt] [--report <path>] [--json]
//   --cards <目录>  = 素材卡所在目录（`final/证据包/` 或项目根；脚本自行回退找 `literature/文献卡.md` 等）
//   --brief <文件>  = 任务简报（G8 字数判定需要「目标篇幅」；G15 另读其中的 `QLT=on|off` 标记）
//   --qlt           = 核对模式相关项 G15-VolIssue（**唯一开关**；依据 = 简报的 `QLT=on` 标记，不按散文标签推断）
//   --report <path> = JSON 结果写入 <path>（默认 stdout）
//   --json          = 兼容保留（JSON 本就是默认也是唯一输出形态）
//
// 退出码（与 M 门 / 其余战略门同源，**刻意不开新码**）：
//   0  = 已检项全过
//   1  = 有 P1
//   2  = 有 P0
//   3  = 仅 P2 软提示，**或任一项 SKIP**（缺输入未检 ≠ 通过，须人工复核；与 M 门 3 同语义）
//   10 = 参数或路径错误
//   70 = 内部错误
//
// ── 定位：**只机检 M 门与三个战略门都没有覆盖的 G 子项**（v18.23.0 EFF-1）────────────────────
//   T7 的步数成本 = 步数 × 每步上下文；把「有确定判据、零判断力」的 G 子项下沉到本脚本后，
//   T7 报告**直接引用本 JSON**，不再重新论证（07 卡 §G 项实据口径）。
//
//   **刻意不重复计入**（`audit-checklist-quickref.md` §同源 6 对规则明确要求「不要把同源两条当两条独立发现」）：
//     · G8① 元数据残留 / G9① 临时编号 / G9② 过程语言 / G12 信任级别 → 已在 `m-gate-check.mjs`
//       （M-Form-3 / M-Form-4 / M-Form-5 / M-Form-6），本脚本不重做；
//     · G4 结构与篇幅骨架 → `structure-check.mjs`（S-IMRaD / S-Intro-Funnel / S-Discussion-4）；
//     · G15 卷期页码完整率 → **本脚本的 `G15-VolIssue`**（v18.41.0 实装：模式相关，须 `--qlt`；
//       逐条列出缺字段的 [Lxx]，候选 P2、**不设阈值**）；闭环那一半归 `cite-coverage-check.mjs`。
//       （v18.40.0 前此处写「无门」——那是当时如实；`M-Form-2 v2` 那个号已作废，案卷见
//        `references/_shared/规范-机械门对照表.md` §二 末行。**v18.43.0 更正：本行曾是同批未传播到的陈旧断言之一**。）
//     · G1 引用真实性 / G3 逻辑 / G5 学术规范 / G6 论据自标 / G7 原创性 / G10 术语一致 / G14 AI 痕迹
//       → **判断力项**（须读语境），维持 LLM 判定，**不**下沉（刻意不加机检，理由同 09 卡 M3 先例）。
//
//   本脚本检 6 项（均有确定判据）：
//     · G8-CharCount    字数偏差（纯汉字 vs 任务简报目标篇幅；**只判候选 P2，不判 P0**——豁免权在主人）
//     · G2-DataProv     正文定量数字 ↔ 素材卡命中（**候选清单**，是否属推算/常识归 T7）
//     · G11-Timeliness  数据卡时效评级（🔴 必须给出理由）
//     · G2.5-CaseCheck  案例卡逐条（≥2 独立来源 / 时间窗口 / 检索截止）
//     · G0.5-FirstPerson 第一人称具体经历（破坏客观基调，词表固定）
//     · G15-VolIssue   文献卡卷期页码/双字段齐备（**模式相关**：简报启用「引用数量与质量控制」才适用；
//                      **候选清单，刻意不设完整率阈值**——理由见该段注释）
//
// ⚠️ **边界（如实声明）**：本脚本是**候选生成器 + 确定判据执行器**，不是「G 项全自动判定」。
//   G2 的命中项**必须由 T7 逐条定性**（M-Exist-9 的实据要求仍由审计报告承担）；
//   字数项与 G15-VolIssue 在缺 `--brief` 时判 SKIP，**绝不**拿默认目标假装核过。

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs';
import { writeReport } from './_lib/destructive-write.mjs';
import { countHan } from './_lib/han.mjs';                    // 汉字口径唯一真源
import { parseTargetCandidates } from './_lib/target-chars.mjs';   // 篇幅候选解析唯一真源（v18.23.0 扩展；G5 用单值版 parseTargetChars）
import { refsOf } from './_lib/refs.mjs';                     // 引用编号口径唯一真源
import { firstEndnoteIndex, bodyStartAfterAbstract, maskFences } from './_lib/sections.mjs';  // 正文区切分 / 围栏掩码（与 count-chars / m-gate-check 同源）
installExitGuard();

// --- CLI ---
const argv = process.argv.slice(2);
let file = null;
let cardsDir = null;
let briefPath = null;
let reportPath = null;
let qlt = false;   // G15-VolIssue 的模式开关（显式声明，见该段注释）
const USAGE = '用法: node g-audit-check.mjs <正文.md> [--cards <目录>] [--brief <任务简报.md>] [--qlt] [--report <path>] [--json]';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--cards' || a === '--brief' || a === '--report') {
    const v = argv[++i];
    if (!v || v.startsWith('--')) { console.error(`${a} 缺少值（示例：${a} <path>）\n${USAGE}`); process.exit(10); }
    if (a === '--cards') cardsDir = v;
    else if (a === '--brief') briefPath = v;
    else reportPath = v;
  } else if (a === '--qlt') {
    qlt = true;   // G15-VolIssue 的模式开关（见该段注释：模式相关的项**只能由调用方显式声明**，不从简报字面推断）
  } else if (a === '--json') {
    continue;   // JSON 是默认且唯一输出形态；本旗标为调用方兼容保留
  } else if (a.startsWith('--')) {
    console.error(`未知参数: ${a}\n${USAGE}`);
    process.exit(10);
  } else if (file === null) file = a;
  else { console.error(`多次传入文件参数: ${a}\n${USAGE}`); process.exit(10); }
}
if (!file) { console.error(USAGE); process.exit(10); }
if (!existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(10); }
requireExistingFile(file, '待检查正文');
if (briefPath !== null && !existsSync(briefPath)) { console.error(`任务简报不存在: ${briefPath}`); process.exit(10); }
if (cardsDir !== null && !existsSync(cardsDir)) { console.error(`素材卡目录不存在: ${cardsDir}`); process.exit(10); }

// --- 编码体检（与 cite-coverage / structure-check 同源：BOM 与 U+FFFD 一律 exit 10）---
{
  const probe = readFileSync(file);
  if (probe.length >= 2 && ((probe[0] === 0xff && probe[1] === 0xfe) || (probe[0] === 0xfe && probe[1] === 0xff))) {
    console.error(`${file}: 检测到 UTF-16 BOM —— 本脚本只接受 UTF-8。请转码后重跑。`);
    process.exit(10);
  }
  if (probe.toString('utf8').includes('\uFFFD')) {
    console.error(`${file}: 解码出现替换字符 U+FFFD —— 该文件不是合法 UTF-8。请转码后重跑。`);
    process.exit(10);
  }
}

const text = readFileSync(file, 'utf8');
// 正文区与 `count-chars.mjs` **同源同切法**（`## 摘要` 之后 → 第一个文末节之前）——
//   v18.23.0 EFF-1 校准：首版从文件头起算，实测同一份定稿比 count-chars 多 41 字（标题+摘要），
//   会让 T7 看到「两个正文字数」。字数类判据的**权威口径唯一 = count-chars**，本脚本只复用。
const bodyFrom = (() => { const a = bodyStartAfterAbstract(text); return a.found ? a.index : 0; })();
const bodyEnd = (() => { const i = firstEndnoteIndex(text); return i === -1 ? text.length : i; })();
const bodyText = bodyEnd > bodyFrom ? text.slice(bodyFrom, bodyEnd) : '';
/** 行号（1-based）：按字符下标数换行。 */
const lineOf = (idx) => text.slice(0, idx).split('\n').length;
/** 全角转半角 + 去千分位逗号与空白（数字比对用）。 */
const normDigits = (s) => String(s ?? '')
  .replace(/[\uff10-\uff19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  .replace(/[,\uff0c\s]/g, '');

// --- 素材卡定位：`--cards` 目录下直接找，找不到再回退 `<dir>/literature|data|cases/` ---
const CARD_SPECS = [
  { key: '文献卡', names: ['文献卡.md', join('literature', '文献卡.md')] },
  { key: '数据卡', names: ['数据卡.md', join('data', '数据卡.md')] },
  { key: '案例卡', names: ['案例卡.md', join('cases', '案例卡.md')] },
];
const cards = {};
if (cardsDir) {
  for (const spec of CARD_SPECS) {
    for (const n of spec.names) {
      const p = join(cardsDir, n);
      if (existsSync(p)) { cards[spec.key] = { path: p, text: readFileSync(p, 'utf8') }; break; }
    }
  }
}

/** 取条目块：**标题形**（`### [Dxx] …`）优先，无标题形时退回**行首形**（`[Dxx] …`）。
 *  **v18.23.0 EFF-1 实测校准（系统性假阳性）**：首版把「行首形」一并收进来 → 素材卡**索引段**里的
 *    `[C01] 标题 ｜ 支撑 S1 ｜ 🟢已落地` 每行都被当成一个「案例条目」（它们只有 1 行、自然没有字段）
 *    → 实测某真实项目 18 个「条目」里 6 个是索引行，直接产出 6 组「缺字段」假 P1。
 *  现用 `maskFences` 做**等长掩码**后匹配：索引段在代码围栏内 → 其行首形**不再**被当作条目；
 *    而条目正文（含其围栏内的字段）仍按**原文下标**切块（掩码只用于定位起点，不改内容）。 */
const entriesOf = (src, kind) => {
  const masked = maskFences(src);
  const headingRe = new RegExp(`^#{2,4}\\s*\\[${kind}(\\d+)[^\\]]*\\]`, 'gm');
  let starts = [...masked.matchAll(headingRe)];
  if (starts.length === 0) starts = [...masked.matchAll(new RegExp(`^\\[${kind}(\\d+)[^\\]]*\\]`, 'gm'))];
  return starts.map((m, i) => ({
    id: `${kind}${m[1]}`,
    start: m.index,
    text: src.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : src.length),
  }));
};

// 素材卡的字段在**实际卡里是粗体**（`- **时效评级**：🔴 >5 年`）——字段名与冒号之间夹着 `**`。
// v18.23.0 EFF-1 首版按 `时效评级[：:]` 匹配 → **实测把某真实项目 31 条中的 30 条误判为「未标时效评级」**
//   （假阳性：它不是「卡缺字段」，是「脚本读不到粗体」）。现统一走本函数：字段名 ↔ 冒号之间允许
//   至多 4 个 Markdown 强调符/空白，冒号之后同样容忍强调符再取值。
const fieldRe = (name, tail = '') => new RegExp(`${name}[\\s*_\`]{0,4}[:：][\\s*_\`]{0,4}${tail}`);
const hasField = (text, name) => fieldRe(name).test(text);

// === G8-CharCount：字数偏差（纯汉字 vs 简报目标篇幅）===
//   判据（`audit-checklist-quickref.md` G8② + v18.11.0 渐进式警告）：实测 / 目标
//     ≤1.05× 通过；1.05–1.09× 偏多；>1.09× 超限；<0.85× 不足（目标 11,000 字时即 11,550 / 12,000 两条线）。
//   ⚠️ **本项刻意只判 P2 候选，不判 P0**（v18.23.0 EFF-1，实测校准）：
//     ① 简报的「篇幅」字段可能是**已失效的早期值**——实测某真实项目简报写 16000 字，而定稿 40,008 字，
//        同一项目的 `status.md` / `交付说明.md` 明文记「**主人已确认字数不作硬规定**」→ 越限**已获授权**，
//        此时判 P0 是**假阳性**（且是最贵的那种：把已授权的交付判红）。
//     ② 因此「是否构成 P0」不是零判断力项——它取决于「主人是否豁免」。本脚本只给实测比值与档位，
//        判级归 T7（若简报自身已写豁免词，直接 SKIP 并说明）。
const WAIVER_RE = /字数不作硬规定|不作硬规定|字数不设限|不设字数|字数不限|字数豁免|不设上限|篇幅不限/;
const g8 = (() => {
  const hanChars = countHan(bodyText);
  if (!briefPath) {
    return { name: '字数偏差（正文纯汉字 vs 任务简报篇幅字段）', checked: false, pass: null, severity: 'SKIP',
      skipReason: '未传 --brief：无法取得目标篇幅（不拿默认目标假装核过）', evidence: { hanChars } };
  }
  const briefText = readFileSync(briefPath, 'utf8');
  if (WAIVER_RE.test(briefText)) {
    return { name: '字数偏差（正文纯汉字 vs 任务简报篇幅字段）', checked: false, pass: null, severity: 'SKIP',
      skipReason: '任务简报已声明字数豁免（不作硬规定）——本项不判级', evidence: { hanChars, brief: briefPath } };
  }
  const cand = parseTargetCandidates(briefText);
  if (cand.candidates.length === 0) {
    return { name: '字数偏差（正文纯汉字 vs 任务简报篇幅字段）', checked: false, pass: null, severity: 'SKIP',
      skipReason: `未解析到候选字数（${cand.reason}）`, evidence: { hanChars, briefField: cand.raw, brief: briefPath } };
  }
  // 判据：落在**候选区间**内（下界 ×0.85 ≤ 实测 ≤ 上界 ×1.05）即通过；否则 P2 候选。
  const lo = cand.candidates[0], hi = cand.candidates[cand.candidates.length - 1];
  const inBand = hanChars >= lo * 0.85 && hanChars <= hi * 1.05;
  const detail = inBand
    ? `在候选区间内：${hanChars} 字 vs 候选 ${lo}${hi !== lo ? `–${hi}` : ''} 字`
    : `${hanChars} 字 vs 简报候选 ${lo}${hi !== lo ? `–${hi}` : ''} 字 = ${(hanChars / hi).toFixed(3)}×（对上界）→ **候选，判级归 T7**：先核 status.md / 交付说明.md 是否已声明字数豁免或篇幅变更（实测存在「简报 16k / 定稿 40k + 交付说明记主人豁免」与「简报为 Phase 0 原始文档、后经 v4 增补扩篇」两类真实情形，均不构成 P0）`;
  return {
    name: '字数偏差（正文纯汉字 vs 任务简报篇幅字段）', checked: true, pass: inBand, severity: inBand ? 'PASS' : 'P2',
    detail, evidence: { hanChars, candidates: cand.candidates, briefField: cand.raw, ratioToUpper: +(hanChars / hi).toFixed(4), brief: briefPath,
      note: '只判「是否落在候选区间」；候选之外不自动升 P0——目标值本身可能是档位下限/过期值/已豁免，判级归 T7' },
  };
})();

// === G2-DataProv：正文定量数字 ↔ 素材卡命中（**候选清单**）===
//   判据：正文出现的**定量声明**（百分比 / 百分点 / 倍 / 带万·亿·万亿等量级单位的数值）逐个在素材卡全文里
//     找同数字串；找不到 → 收益为「候选」，**P2**（`apply-diff.mjs` numeric_drift 的同一原则：
//     机械只挑「卡里没有」，是否属常识/推算/衍生计算归 T7）。裸年份（2024 年）刻意不纳入（年份在卡里未必逐条登记）。
const QUANT_RE = /(?<![\d.])(\d[\d,\uff0c]*(?:\.\d+)?)\s*(%|个百分点|倍|万亿|千亿|百亿|亿元|亿美元|万亿元|亿吨|万辆|万台|万人|亿人|千瓦时|GW|MW|kW|kWh|吨|万家|亿美元)/g;
const g2 = (() => {
  const cardTexts = Object.values(cards);
  if (cardTexts.length === 0) {
    return { name: '数据溯源候选（正文定量数字 ↔ 素材卡命中）', checked: false, pass: null, severity: 'SKIP',
      skipReason: '未传 --cards 或目录内无素材卡：无法比对（不假装通过）', evidence: {} };
  }
  const cardNorm = normDigits(cardTexts.map((c) => c.text).join('\n'));
  const hits = [];
  for (const m of bodyText.matchAll(QUANT_RE)) {
    const digits = normDigits(m[1]);
    if (digits === '' || cardNorm.includes(digits)) continue;
    hits.push({ line: lineOf(m.index), token: m[0].trim(), digits, context: bodyText.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, ' ') });
  }
  const CAP = 40;
  return {
    name: '数据溯源候选（正文定量数字 ↔ 素材卡命中）', checked: true, pass: hits.length === 0,
    severity: hits.length === 0 ? 'PASS' : 'P2',
    detail: hits.length === 0
      ? `正文定量声明全部在素材卡命中（卡：${Object.keys(cards).join(' / ')}）`
      : `${hits.length} 处定量数字未在素材卡命中 → **候选清单，须 T7 逐条定性**（是否属常识/推算/衍生计算）`,
    evidence: { candidateCount: hits.length, candidates: hits.slice(0, CAP), truncated: hits.length > CAP, cardCount: cardTexts.length },
  };
})();

// === G15-VolIssue：文献卡卷期页码 / 双字段齐备（**模式相关**；候选清单，**不设完整率阈值**）===
// 立项（v18.41.0）：本条此前是一处**幻影门**——`01 卡` 声称「机检判别（`M-Form-2 v2 分支`）：文献卡缺
//   卷期页码必填字段 → P1」，而 `mform-gates.mjs` 的 `mForm2` 只核「文末必需五节存在性」，全脚本搜
//   `apa_priority`/`卷期`/`待补卷期` **零命中**（v18.40.0 实测）。v18.40.0 先把五处活引用改判为
//   「无门 + 人工责任点」，本批把它**实装成真门**——要件与阈值的定义见下两条。
//
// **要件（真源 = `01 卡` §卷期页码双写契约，v18.9.0 实战反哺）**，按类型三分：
//   · [J] 期刊：DOI + 卷(期): 起-止页
//   · [M] 专著：ISBN + DOI（**双写**；v18.9.0 实测 6 条 [Lxx] 只写 ISBN、无 DOI）
//   · [EB/OL] 等电子类：URL + 访问日期
//   ⚠️ **两处规范的要件不等价（本实现取 01 卡，理由写明）**：`M-Gate-Algorithm.md` §M-Form-2 的 v18.8.0
//     扩展段另有一句更宽的措辞「4 项中至少 3 项：作者 + 年份 + 期刊/出版者 + 卷期页码**或** DOI/URL」。
//     二者对期刊的要求不同（01 卡 = DOI 与卷期页码**都要**；协议段 = 二者**其一**即可）。取 01 卡，因为
//     它有实战依据（那 6 条缺 DOI 的条目正是它的立项来源），且本条立项正是指向它；该分歧已在
//     `07 卡` §G 项机检段与 `规范-机械门对照表.md` 该行写明。
//
// **四条如实边界（均为 v18.41.0 实测标定，不是设计偏好）**：
//   ① **刻意不设「完整率阈值」**：全库实测 27 份真源文献卡 / 314 条 [Lxx]，该比值同时受两个自变量影响——
//      **契约新旧**（卷期页码契约自 v18.9.0 才有）与**模式开关**（全库仅 1 份简报启用本模式）。任何固定
//      百分比都会是**凭直觉的数字**（旧文档写的「卷期页码完整率 ≥95% = Pass」从未标定，本批一并改判）。
//      故本项**只出候选清单**、不给比值判级。
//   ② **模式相关，且模式只能由调用方显式声明（`--qlt`）**——**不从简报字面推断**。这一条是实测逼出来的：
//      首版按「简报里出现 `引用数量与质量控制`/`卷期页码完整`」放行，实测 `数字社交-关系重构` 的简报写的是
//      「☐ **APA 优先输出 + 卷期页码完整性**：**默认关闭**（…）；若启用须主人二次确认」——**方框是未勾选的、
//      明写默认关闭**，而字面匹配照样放行 → 对一个从未启用该模式的项目产出 6 组 P2 候选（**假阳性**）。
//      判据：**匹配到标签 ≠ 匹配到启用状态**（与「任何按字面扫描的门都会把『引述被纠正内容』当成那内容本身」
//      同族；也与 `M-Exist-9` 刻意不判 G15 的理由一致——那道门看不到简报，判了就会对未启用的项目假阳性）。
//      故本项的模式开关是 CLI 旗标（同 `structure-check --humanities` / `handoff-check --require-gates` 的先例），
//      由读得到简报语义的调用方（主控/T7）显式传。未传 → SKIP（而 SKIP ≠ 通过，exit 3 仍须人工复核）。
//   ③ **类型判定要认四种真实排版**（否则合规卡会被判红）：标题即著录串 / 著录串在 `**GB/T 7714**：` 体例行 /
//      字段分行（`**卷/期/页码**`·`**DOI**`）/ 类型行（`**类型**: 期刊文章 [J]`）。类型**判不出就不判罚**
//      （计入 evidence 的 `untyped`，如实暴露覆盖面）；合并标签 `出版XX/期刊` 视为**类型不可判**（它在真实
//      卡里两种类型都用——实测 `共锁` 的期刊与专著同用该标签）。
//   ④ 严重度**只到 P2 候选**（新分布式指标 + 两处规范要件不等价）——判级归 T7。
const DOI_RE = /10\.\d{4,9}\/[^\s，。；)）]+/i;
const URL_RE = /https?:\/\/\S+/i;
const ISBN_RE = /ISBN[\s:：]*[\dXx][\dXx\-\s]{8,}/i;
const VOLISSUE_RE = /(?:vol\.?\s*\d+\s*,?\s*no\.?\s*\d+|\d+\s*\(\s*\d+\s*\)|\d{4}\s*[,，]\s*\d+\s*\(\s*\d+\s*\))/i;
const PAGES_RE = /\b\d{1,4}\s*[-–—]\s*\d{1,4}\b|pp?\.\s*\d+/i;
const ACCESS_RE = /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}|访问日期|引用日期|检索日期/;
// 字段标签**带左边界**（`(?<![\w/／])`）：防 `**出版社/期刊**：` 被 `期刊` 与 `出版社` 双双命中
//   （与规则 ㉙ 的 `G14 主项` 反例同族：标识符左边界不设防 = 把相邻标签读成自己）。
// ⚠️ **如实标注（v18.41.0 反向自证实测）**：对**真实存在的那一种**合并标签（`出版X/期刊`），真正拦住它的
//   是下面的 `LABEL_MIXED`——它在 `LABEL_J/LABEL_M` **之前** `return null`。故本条左边界是**纵深防御**
//   （覆盖 `LABEL_MIXED` 未列举的其它斜杠连写标签），**不是承重规则**：反向自证里「去掉左边界」那个变异
//   因此**不产生任何行为变化**（不可达变异），已用双变异（同时去掉 `LABEL_MIXED`）证明守卫确实在挡。
const LABEL_J = /(?<![\w/／])期刊[\s*_`]{0,4}[:：]/;
const LABEL_M = /(?<![\w/／])出版(?:社|者|地)[\s*_`]{0,4}[:：]/;
const LABEL_E = /(?<![\w/／])(?:URL|网址|链接)[\s*_`]{0,4}[:：]/i;
const LABEL_MIXED = /出版(?:社|者|地)\s*\/\s*期刊[\s*_`]{0,4}[:：]/;   // 合并标签 → 类型不可判（**承重**）
const g15 = (() => {
  const NAME = '文献卡卷期页码/双字段齐备（[J] DOI+卷期起止页 / [M] ISBN+DOI / [EB/OL] URL+访问日期）';
  // **模式标记（唯一依据，v18.43.0）**：任务简报里的显式 `QLT=on` / `QLT=off`。
  //   刻意**不**按散文标签推断——v18.41.0 实测：简报写「☐ APA 优先输出 + 卷期页码完整性：**默认关闭**」
  //   时，按标签字面放行会对**未启用**该模式的项目产出 6 组假 P2。**放行权只在旗标，依据只在标记**：
  //     · 旗标是调用方的显式声明（读得到简报语义的是人/主控/T7，不是脚本）；
  //     · 标记让「简报说启用了、却没人传旗标」这件事**可见**（不静默跳过）——这是 v18.43.0 补的接口债。
  const marker = (() => {
    if (!briefPath) return null;
    try {
      const m = /(?<![A-Za-z0-9_])QLT\s*=\s*(on|off)(?![A-Za-z0-9_])/i.exec(readFileSync(briefPath, 'utf8'));
      return m ? m[1].toLowerCase() : null;
    } catch { return null; }
  })();
  // 模式未启用 → **N/A（不适用）**，与 **SKIP（适用但缺输入）** 刻意分开：
  //   SKIP 计入 skipped → exit 3（「不算核过」）；N/A 不进 skipped → 不改变退出码。
  //   理由：本项在模式未启用时**本就不在核对范围内**，若也计 skipped，则全库 24/25 个项目
  //   都会被推成 exit 3「须人工复核」——那是一种噪声式假阳性，且会让 exit 0 事实上不可达。
  //   （同族先例：M 门的 `N/A：尚无审计报告` 也按「不适用」处理，不按失败处理。）
  if (!qlt) {
    const mismatch = marker === 'on';
    return { name: NAME, checked: false, applicable: false, pass: null, severity: 'N/A',
      skipReason: '模式未启用（未传 `--qlt`）→ 本项不适用；主办在简报启用「引用数量与质量控制」时传 `--qlt` 才核对'
        + (mismatch
          ? ' ⚠️ **但任务简报标了 `QLT=on`** —— 本项因此**没有被核对**（这正是本条要防的「静默不跑」）：补传 `--qlt` 即闭合。'
          : ''),
      evidence: { card: cards['文献卡'] ? cards['文献卡'].path : null, brief: briefPath, qltMarker: marker, qltMarkerMismatch: mismatch } };
  }
  const card = cards['文献卡'];
  if (!card) {
    return { name: NAME, checked: false, pass: null, severity: 'SKIP',
      skipReason: '已传 `--qlt` 但未传 `--cards` 或目录内无文献卡：无法比对（不假装通过）', evidence: {} };
  }
  const entries = entriesOf(card.text, 'L');
  if (entries.length === 0) {
    return { name: NAME, checked: false, pass: null, severity: 'SKIP',
      skipReason: '文献卡内未找到 [Lxx] 条目', evidence: { card: card.path } };
  }
  /** 类型判定：显式标记优先 → 单一字段标签 → 合并标签/无线索 = 不可判（null）。 */
  const typeOf = (t) => {
    if (/\[(?:EB\/OL|DB\/OL|R|N|D|Z|C)\]/.test(t)) return 'E';
    if (/\[J\]/.test(t)) return 'J';
    if (/\[M\]/.test(t)) return 'M';
    if (LABEL_MIXED.test(t)) return null;
    if (LABEL_J.test(t)) return 'J';
    if (LABEL_M.test(t)) return 'M';
    if (LABEL_E.test(t)) return 'E';
    return null;
  };
  const issues = [];
  const untyped = [];
  const counts = { J: 0, M: 0, E: 0 };
  for (const e of entries) {
    const t = e.text;
    const type = typeOf(t);
    if (!type) { untyped.push(e.id); continue; }
    counts[type] += 1;
    const hasDoi = DOI_RE.test(t), hasIsbn = ISBN_RE.test(t), hasUrl = URL_RE.test(t);
    const hasVol = VOLISSUE_RE.test(t), hasPages = PAGES_RE.test(t), hasAccess = ACCESS_RE.test(t);
    const miss = [];
    if (type === 'J') {
      if (!hasDoi) miss.push('DOI');
      if (!hasVol) miss.push('卷(期)');
      if (!hasPages) miss.push('起-止页');
    } else if (type === 'M') {
      if (!hasIsbn) miss.push('ISBN');
      if (!hasDoi) miss.push('DOI');
    } else {
      if (!hasUrl) miss.push('URL');
      if (!hasAccess) miss.push('访问日期');
    }
    if (miss.length > 0) {
      const label = type === 'J' ? '期刊' : (type === 'M' ? '专著' : '电子类');
      issues.push({ id: e.id, type, missing: miss, reason: `${label}缺 ${miss.join(' + ')}` });
    }
  }
  const CAP = 30;
  return {
    name: NAME, checked: true, pass: issues.length === 0, severity: issues.length === 0 ? 'PASS' : 'P2',
    detail: issues.length === 0
      ? `[J] ${counts.J} / [M] ${counts.M} / [电子类] ${counts.E} 条字段齐备`
        + (untyped.length > 0 ? `（另有 ${untyped.length} 条**类型判不出**，未计入判罚）` : '')
      : `${issues.length} 条未满足契约字段 → **候选清单，判级归 T7**（已判类型：[J] ${counts.J} / [M] ${counts.M}`
        + ` / [电子类] ${counts.E}；类型判不出 ${untyped.length} 条未计入）`,
    evidence: {
      entries: entries.length, counts, untypedCount: untyped.length, untyped: untyped.slice(0, CAP),
      issueCount: issues.length, issues: issues.slice(0, CAP), truncated: issues.length > CAP,
      // 完整率**只作信息呈现**（G15 报告要写「卷期页码完整率」时可用它），**不作判级依据**——
      //   分母刻意只用「类型可判」的条目（判不出的不该被算成不合格）。
      rate: (() => {
        const typed = counts.J + counts.M + counts.E;
        const complete = typed - issues.length;
        return { complete, typed, ratio: typed > 0 ? +(complete / typed).toFixed(3) : null, note: '仅信息；本项不设阈值' };
      })(),
      qltMarker: marker,
      qltMarkerMismatch: marker === 'off',
      markerNote: marker === 'off'
        ? '⚠️ 任务简报标了 `QLT=off`，而调用方仍显式传了 `--qlt` —— 本项**按调用方要求**核对（旗标优先）；若属误传，去掉旗标即可回到「不适用」'
        : (marker === null && briefPath ? '任务简报未写 `QLT=` 标记（本标记 v18.43.0 起才进模板）——本项按调用方旗标核对' : undefined),
      card: card.path, brief: briefPath,
      note: '本项**刻意不设完整率阈值**：实测该比值同时受「卷期页码契约自 v18.9.0 才有」与「模式开关（全库仅 1 份简报启用）」两个自变量影响，任何固定百分比都是凭直觉的数字（旧文档「≥90% / ≥95% = Pass」从未标定，v18.41.0 删除）。要件真源 = 01 卡 §卷期页码双写契约；协议层 §M-Form-2 的措辞更宽，二者不等价，已在 07 卡与对照表写明。',
    },
  };
})();

// === G11-Timeliness：数据卡时效评级 ===
//   判据（quickref G11）：🟢 ≤2 年 → 通过；🟡 2-5 年 → 通过但须有时间锚；🔴 >5 年 → 须给出理由。
//   **v18.23.0 EFF-1 实测校准（两处，都是防假阳性的口径）**：
//     · 🔴 的「**有理由**」按**形式**判：评级行带括注（`（面积不变）` / `（1903 文本，但作为案例锚点）`）或
//       含理由关键词即算有理由——**理由是否达「唯一可得 + 时效风险」的强度归 T7**。
//       首版要求字面命中「唯一可得/时效风险」，实测把某真实项目 15 条**已带括注理由**的红级数据全判 P1（假阳性）。
//     · 🟡 的时间锚**卡级继承**：卡头写 `**截止**：2026-09-19`（或「检索截止」）即视为全卡有时间锚，
//       不强制每条重复写「截至」——模板把截止日期放在卡头，逐条重复才是异常形态。
//   **边界**：本项只核**卡侧**评级与说明；「正文引用是否越级」是语义判断（quickref 归 G2），不在本项。
const g11 = (() => {
  const card = cards['数据卡'];
  if (!card) {
    return { name: '数据卡时效评级（🔴 必须给出理由）', checked: false, pass: null, severity: 'SKIP',
      skipReason: '未传 --cards 或目录内无数据卡', evidence: {} };
  }
  const entries = entriesOf(card.text, 'D');
  if (entries.length === 0) {
    return { name: '数据卡时效评级（🔴 必须给出理由）', checked: false, pass: null, severity: 'SKIP',
      skipReason: '数据卡内未解析到 [Dxx] 条目', evidence: { cards: card.path } };
  }
  const cardHasAnchor = fieldRe('截止', '\\**[^\\n]{0,12}')/*「**截止**：2026-09-19」或「检索截止：…」*/
    .test(card.text) || hasField(card.text, '检索截止');
  const p1 = [], p2 = [];
  for (const e of entries) {
    const m = e.text.match(fieldRe('时效评级', '([^\\n]*)'));
    if (!m) { p2.push({ id: e.id, reason: '未标时效评级（🟢/🟡/🔴 三档必填，模板 §数据卡格式）' }); continue; }
    const ratingLine = m[1] || '';
    const lvl = (ratingLine.match(/(🟢|🟡|🔴)/) || [])[1];
    if (!lvl) { p2.push({ id: e.id, reason: '时效评级行没有 🟢/🟡/🔴 档位标记' }); continue; }
    // 「有理由」= 评级行带 ≥4 字的括注，或含理由类关键词
    const hasReason = /[（(][^）)]{4,}[）)]/.test(ratingLine)
      || /截至|唯一可得|时效风险|重新检索|无法替换|不变|追溯|锚点|历史|原文|已过|趋势/.test(ratingLine);
    if (lvl === '🔴' && !hasReason) p1.push({ id: e.id, reason: '🔴 >5 年数据未给任何理由（须说明为何保留；强度须达「该数据为唯一可得 + 时效风险」——强度判定归 T7）' });
    else if (lvl === '🟡' && !/截至/.test(e.text) && !cardHasAnchor) p2.push({ id: e.id, reason: '🟡 2-5 年数据无时间锚（条目内无「截至」，卡头也无「截止」日期）' });
  }
  const severity = p1.length > 0 ? 'P1' : (p2.length > 0 ? 'P2' : 'PASS');
  return { name: '数据卡时效评级（🔴 必须给出理由）', checked: true, pass: severity === 'PASS', severity,
    detail: `数据卡 ${entries.length} 条：🔴 无理由 ${p1.length} 条 / 评级或时间锚不全 ${p2.length} 条${cardHasAnchor ? '（卡头有时间锚）' : ''}`,
    evidence: { entries: entries.length, p1, p2, cardHasAnchor, cards: card.path } };
})();

// === G2.5-CaseCheck：案例卡逐条（≥2 独立来源 / 时间窗口 / 检索截止）===
//   判据（quickref G2.5）：每条案例「**来源谱系 ≥2 个独立来源**」不达标 → P1；缺时间窗口 / 检索截止 → P1。
//   **v18.23.0 EFF-1 实测校准**：「来源条目数」**不等于 URL 数**——实测某真实项目 C05 列了 11 条来源
//     （① 官方自源 3 条 / ② 主流媒体 6 条 / ③ 第三方 2 条）却**只带 1 个 URL**（其余以「媒体名：标题（日期）」记名），
//     按 URL 计数会把它误判为「单源」= 假阳性。故改为**数来源条目**：`来源谱系` 段内的项目符号条数
//     减去 ①②③ 小组标题。段缺失 → P2（无法判定），**不**误报 P1。
//   **来源独立性**（官方自源 ≠ 独立第三方）仍是语义判断 → 只给计数，判归 T7。
const g25 = (() => {
  const card = cards['案例卡'];
  if (!card) {
    return { name: '案例卡逐条核验（≥2 独立来源 / 时间窗口 / 检索截止）', checked: false, pass: null, severity: 'SKIP',
      skipReason: '未传 --cards 或目录内无案例卡（0 条场景应走空卡协议）', evidence: {} };
  }
  const entries = entriesOf(card.text, 'C');
  if (entries.length === 0) {
    return { name: '案例卡逐条核验（≥2 独立来源 / 时间窗口 / 检索截止）', checked: false, pass: null, severity: 'SKIP',
      skipReason: /\[C-空\]/.test(card.text) ? '案例卡为空卡（[C-空]）——空卡协议，符合预期' : '案例卡内未解析到 [Cxx] 条目',
      evidence: { cards: card.path } };
  }
  /** 数「来源谱系」段内的**来源条目**。返回 null = 找不到该段。
   *  近似口径（实测**三代卡**的三种排版都要覆盖）：
   *    · 树形卡：`├ ① 当事人/官方：…` + `│  + 续行` → 数 `├`/`└` 项与 `+ ` 续行；
   *    · Markdown 卡：`  - ① 当事人/官方自源：` + `    - 普京官网…` → 数项目符号条；
   *    · 编号卡：`1. Retraction Watch, «…» URL: …` → 数编号条。
   *  段结束判据 = 下一个**加粗字段行**（`- **x**：` / `**x**：`）、标题、分隔线，或已知字段名（主体/时间窗口/…）。
   *  **边界**：这是「来源条目数」的近似值（同一条来源被拆成多行会多计、多条来源挤一行会少计）——
   *    阈值只用来抓「**只有一条来源**」这一确定形态；**来源独立性判定归 T7**。 */
  const FIELD_END = /^\s*(?:[│|]\s*)*(?:主体|时间窗口|时间锚点|检索截止|信任级别|事件状态|类别|事件结构|多方说法|关键数据点|来源分级|来源结构|与本文的关联)[：:]/;
  /** 取「来源段」起点行号：命中 `来源` 但**不是** `来源分级 / 来源独立性 / 来源说明 / 来源标注`。 */
  const sourceStart = (lines) => lines.findIndex((l) => /来源/.test(l) && !/来源分级|来源独立性|来源说明|来源标注|来源可信/.test(l));
  const countSources = (entryText) => {
    const lines = entryText.split('\n');
    const start = sourceStart(lines);
    if (start === -1) return null;
    let count = 0;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*[-*]\s+\*\*/.test(l)) break;              // 下一个顶层字段（`- **信任级别**：`）
      if (/^\*\*[^*\n]{2,20}\*\*/.test(l)) break;        // 加粗字段行（`**多方说法并列**`）
      if (/^#{1,6}\s/.test(l)) break;                    // 下一个条目/小节
      if (/^\s*---\s*$/.test(l)) break;
      if (FIELD_END.test(l)) break;
      if (/^\s*\d+[.、)]\s+\S/.test(l)) { count++; continue; }  // 编号条 `1. …`
      if (/[├└]/.test(l)) { count++; continue; }                // 树形项（含 ①②③ 分组行本身）
      if (/^[│\s]*\+\s+\S/.test(l)) { count++; continue; }      // 树形续行 `+ …`
      const b = l.match(/^\s*[-*]\s+(\S.*)$/);
      if (b) { count++; continue; }                             // Markdown 项目符号
    }
    return count;
  };
  // 字段**同义集**（实测三代卡的真实命名——按字面单一名字匹配会把合规卡判红）：
  //   · 来源：`来源谱系` / `来源（≥2 个独立来源）` / `独立来源`
  //   · 时间：`时间窗口` / `时间锚点`
  //   · 检索截止：`检索截止` / `检索截止日期` / **卡头级**（`> 检索截止：2026-08-25`，含「截至」内联写法）
  const ALIAS_SPAN = ['时间窗口', '时间锚点', '事件时间窗口', '时间范围'];
  const ALIAS_CUTOFF = ['检索截止', '检索截止日期', '截止日期'];
  // 卡头（第一个条目前）已声明检索截止 → 视为全卡有时间锚（与 G11 的卡级继承同一口径）
  const cardHead = card.text.slice(0, entries[0].start);
  const cardHasCutoff = ALIAS_CUTOFF.some((n) => hasField(cardHead, n)) || /(?:检索)?截止\s*[\[（(]?\s*(?:截至\s*)?\d{4}/.test(cardHead);
  const hasSpanOf = (t) => ALIAS_SPAN.some((n) => hasField(t, n))
    || /\[?\s*(?:19|20)\d{2}\s*[-–~至]\s*(?:(?:19|20)\d{2}|持续|今)/.test(t);
  const hasCutoffOf = (t) => ALIAS_CUTOFF.some((n) => hasField(t, n))
    || /检索截止\s*[\[（(]/.test(t) || /\[截至\s*\d{4}/.test(t) || cardHasCutoff;
  // **判级的关键校准（v18.23.0 EFF-1，实测三项目反例）**：P1 只留给两种**可确证**的形态——
  //   ① 来源段内**恰好 1 条**来源（确定单源）；② **卡内不一致**（同卡别的条目有这个字段、这条没有）。
  //   「整卡都没有某字段」不能按条判 P1：实测存在**非标准形态卡**（如「分析示例型」案例卡，字段是
  //     类型/场景说明/关键事实/用于论证/代表性来源——模板的 时间窗口/检索截止 本就不适用），
  //     按字面判 P1 = 一次 9 条假 P1。整卡缺失改为**一条聚合 P2**（须 T7 一次定性：确属漏填 or 该代卡排版不同）。
  const spanPresent = entries.filter((e) => hasSpanOf(e.text)).length;
  const cutoffPresent = entries.filter((e) => hasCutoffOf(e.text)).length;
  const issues = [];
  for (const e of entries) {
    const srcCount = countSources(e.text);
    if (srcCount === null) issues.push({ id: e.id, severity: 'P2', reason: '未找到来源段（`来源谱系`/`来源`/`独立来源` 三种命名都未命中）——无法判定来源数' });
    else if (srcCount === 0) issues.push({ id: e.id, severity: 'P2', reason: '**来源段存在但未能数出条目**（该卡的条目排版不在已覆盖的三种之内）——数出 0 ≠ 只有 1 条，故不判 P1，须 T7 目视' });
    else if (srcCount === 1) issues.push({ id: e.id, severity: 'P1', reason: '来源段内**恰好 1 条**来源（要求 ≥2 个独立来源；独立性判定归 T7）' });
    if (spanPresent > 0 && !hasSpanOf(e.text)) issues.push({ id: e.id, severity: 'P1', reason: '卡内其余条目有时间字段而本条没有（`时间窗口`/`时间锚点`/`YYYY-YYYY` 区间三种写法都未命中）——卡内不一致' });
    if (cutoffPresent > 0 && !hasCutoffOf(e.text)) issues.push({ id: e.id, severity: 'P1', reason: '卡内其余条目有检索截止而本条没有（`检索截止`/`检索截止日期`/`[截至 YYYY-MM-DD]` 三种写法与卡头级声明都未命中）' });
  }
  if (spanPresent === 0) issues.push({ id: '(卡级)', severity: 'P2', reason: `全卡 ${entries.length} 条**均无时间字段**（两种命名与区间写法都未命中）——须 T7 一次定性：确属漏填（应 P1）还是该代卡排版不用此字段（不适用）` });
  if (cutoffPresent === 0 && !cardHasCutoff) issues.push({ id: '(卡级)', severity: 'P2', reason: `全卡 ${entries.length} 条**均无检索截止**（条目内三种写法与卡头级声明都未命中）——须 T7 一次定性：确属漏填（应 P1）还是该代卡排版不用此字段（不适用）` });
  const p1 = issues.filter((x) => x.severity === 'P1');
  const severity = p1.length > 0 ? 'P1' : (issues.length > 0 ? 'P2' : 'PASS');
  return { name: '案例卡逐条核验（≥2 独立来源 / 时间窗口 / 检索截止）', checked: true, pass: severity === 'PASS', severity,
    detail: `案例卡 ${entries.length} 条：P1 ${p1.length} 处 / 无法判定 ${issues.length - p1.length} 处`,
    evidence: { entries: entries.length, issues, cards: card.path } };
})();

// === G0.5-FirstPerson：第一人称具体经历（破坏客观基调）===
//   判据（quickref G0.5）：出现「我接触过 / 我曾在 / 我当年 …」等**具体经历**表述 → P1。
//   词表**刻意收窄**到「第一人称 + 经历/见闻动词」组合：裸「我」（如「我国」「我方」）与
//     「本文认为」类学术表述**不**命中（否则假阳性会把正常稿子判红）。
const FP_RE = /(我|笔者|我们)(?:\s*)(接触过|曾在|当年|当时|亲历|亲眼|亲身|做过|参与过|见过|去过|经历过|在[^，。；\n]{0,12}(?:工作|任职|从业))/g;
const g05 = (() => {
  const hits = [];
  for (const m of bodyText.matchAll(FP_RE)) {
    hits.push({ line: lineOf(m.index), phrase: m[0], context: bodyText.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, ' ') });
  }
  return { name: '第一人称具体经历（客观基调）', checked: true, pass: hits.length === 0,
    severity: hits.length === 0 ? 'PASS' : 'P1',
    detail: hits.length === 0 ? '未命中第一人称具体经历词表' : `${hits.length} 处第一人称具体经历 → P1（改客观化表述：决策层普遍认为 / 业内观察 / 据行业经验估算）`,
    evidence: { hits } };
})();

// --- 汇总 ---
const checks = {
  'G8-CharCount': g8,
  'G2-DataProv': g2,
  'G11-Timeliness': g11,
  'G2.5-CaseCheck': g25,
  'G0.5-FirstPerson': g05,
  'G15-VolIssue': g15,
};
const vals = Object.values(checks);
const hasP0 = vals.some((c) => c.checked && c.severity === 'P0');
const hasP1 = vals.some((c) => c.checked && c.severity === 'P1');
const hasP2 = vals.some((c) => c.checked && c.severity === 'P2');
// `skipped` = **适用但缺输入**（不算核过 → exit 3）；`na` = **按模式不适用**（不进退出码，见 G15-VolIssue 段注释）
const skipped = vals.filter((c) => !c.checked && c.applicable !== false).length;
const na = vals.filter((c) => c.applicable === false).length;
const allPass = !hasP0 && !hasP1 && !hasP2 && skipped === 0;
const exitCode = hasP0 ? 2 : (hasP1 ? 1 : (hasP2 || skipped > 0 ? 3 : 0));

const result = {
  file,
  version: 'v18.41.0',
  inputs: { brief: briefPath, cardsDir, cardsFound: Object.fromEntries(Object.entries(cards).map(([k, v]) => [k, v.path])) },
  checks,
  overall: {
    pass: allPass, exitCode, skipped, na,
    p0: vals.filter((c) => c.severity === 'P0' && c.checked).length,
    p1: vals.filter((c) => c.severity === 'P1' && c.checked).length,
    p2: vals.filter((c) => c.severity === 'P2' && c.checked).length,
  },
  meta: {
    timestamp: new Date().toISOString(),
    description: '论衡 G 项机检门 / v18.41.0（EFF-1 起；本版新增 G15-VolIssue）/ scripts 白名单 24→25',
    notes: '只机检 M 门与三个战略门未覆盖的 6 个 G 子项；判断力项（G1/G3/G5/G6/G7/G10/G14）维持 LLM 判定。'
      + 'G2 与 G15-VolIssue 的命中项是**候选**，须 T7 逐条定性；SKIP ≠ 通过（exit 3 必须人工复核）。',
  },
};

const output = JSON.stringify(result, null, 2);
if (reportPath) writeReport(reportPath, output, { protect: [file] });
else console.log(output);

process.exit(exitCode);
