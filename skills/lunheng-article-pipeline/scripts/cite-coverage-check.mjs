#!/usr/bin/env node
// 论衡引用实质相关性度量（v18.10.0 战略反哺新增 / P1-1 / scripts 白名单 19→20）
// 用法：node cite-coverage-check.mjs <文件.md> [--report <path>]
//   --report <p>   = JSON 结果写入 <p>（默认 stdout）
//
// 退出码（与 M 门语义同源）：
//   0  = 三项检查全过
//   1  = P1 问题（同论点冗余 / 弱相关引用过多 / 年代分布不健康）
//   3  = 仅 P2 软提示
//   10 = 参数或路径错误
//   70 = 内部错误
//
// 3 项检查：
//   C-Strength    = 引用关联强度分布（强/中/弱/装饰性 — 基于素材卡字段）
//   C-Redundancy  = 同论点同时引 ≥4 篇且未在文中指明差异
//   C-Distribution = 引用年代分布健康度（近 3 年 + 5+ 年前经典 + 中间年代三层比例）

import { readFileSync, existsSync } from 'node:fs';
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs';
import { sectionBody, firstEndnoteIndex, bodyStartAfterAbstract, maskFences } from './_lib/sections.mjs';
import { writeReport } from './_lib/destructive-write.mjs';   // 报告写盘守卫（v18.12.0，全量审计 L-50）
import { refRegex } from './_lib/refs.mjs';                   // v18.16.0（A-2 反哺）：任意位数 L 编号，与 m-gate-check 同源
import { packageVersionTag } from './_lib/pkg-version.mjs';   // §8.3 #39：产物 version 单一真源
installExitGuard();

// --- CLI 参数解析 ---
const argv = process.argv.slice(2);
let file = null;
let reportPath = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--report') {
    // v18.12.0（全量审计 L-62）：**带值旗标缺值**此前静默 —— `--report` 是最后一个 token 时
    //   `reportPath` 变 undefined → 末尾 `if (reportPath)` 直接跳过 → **不落盘却 exit 0**
    //   （用户以为报告已生成）。现与 `_lib/cli-args.mjs` 同口径：缺值 → exit 10。
    const v = argv[++i];
    if (!v || v.startsWith('--')) { console.error(`--report 缺少值（示例：--report audits/cite-coverage.json）\n用法: node cite-coverage-check.mjs <文件.md> [--report <path>]`); process.exit(10); }
    reportPath = v;
  }
  else if (a.startsWith('--')) {
    console.error(`未知参数: ${a}\n用法: node cite-coverage-check.mjs <文件.md> [--report <path>]`);
    process.exit(10);
  } else if (file === null) file = a;
  else {
    console.error(`多次传入文件参数: ${a}`);
    process.exit(10);
  }
}
if (!file) { console.error('用法: node cite-coverage-check.mjs <文件.md> [--report <path>]'); process.exit(10); }
if (!existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(10); }
requireExistingFile(file, '待检查论文');

// --- 编码体检 ---
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

// === C-Strength: 引用关联强度分布 ===
// 简化实现：每条引用 [Lxx] 在正文出现的次数作为「强 / 中 / 弱 / 装饰性」分类依据
//   - 强（≥3 次）：核心论点反复引用
//   - 中（2 次）：支撑型引用
//   - 弱（1 次）：辅助型引用
//   - 装饰性（仅出现在参考文献节无正文引用）：幽灵引用
// v18.16.0（A-2 反哺）：原 `[L\d{2,3}]` 漏 1 位 / ≥4 位编号（与 journal-fit 同源），
//   改用 refs.mjs 共享 refRegex，与 m-gate-check 同源、行为一致。
const L_REGEX = refRegex('L');
// v18.12.0（全量审计 L-63）：**扫描面必须是正文区**。旧版 `L_IN_TEXT` / `L_COUNT` 都扫整篇，而参考文献节里
//   的条目行本身含 `[Lxx]` → 每条引用都被「自己」计一次 → `decorative` **恒为空集**、`decorativeRatio`
//   恒 0（**幽灵引用检查永远不触发**，07 卡的「装饰性 >20% → P1」机械不可达），且强度分档整体上移一档
//   （正文只引 1 次的被算成 2 次 = 中）。现用 `firstEndnoteIndex` 切出正文区（与 count-chars / m-gate-check 同源）。
const bodyEndIdx = (() => { const i = firstEndnoteIndex(text); return i === -1 ? text.length : i; })();
// v18.23.0（EFF-1 第三层）：**摘要/关键词也不属于论点区**——C-Redundancy 的判定单位是「同一论点
//   同时引 4+ 篇」，而摘要天然逐条罗列证据基础（实测某项目摘要挂 8 篇被误判）。故与 count-chars
//   的正文区同源取起点：`## 摘要` 之后（无摘要节则从 0 起）。
const bodyStartIdx = (() => {
  // 摘要节标题三形态都试（实测有论文用 `## Abstract` / `## Keywords` 英文标题 → 只试「摘要」会当找不到，
  //   bodyStartIdx 退化成 0 → 摘要又进了扫描面，于是「Keywords(7)」这类命中再次出现）。
  for (const marker of ['摘要', 'Abstract', 'ABSTRACT']) {
    const a = bodyStartAfterAbstract(text, marker);
    if (a.found) return a.index;
  }
  return 0;
})();
const bodyText = text.slice(0, bodyEndIdx);
const L_IN_TEXT = new Set();
// v18.16.0（A-2 反哺 · 收尾）：refs.mjs 的 refRegex 不带捕获组（`m[1]` 是 undefined），
//   旧消费点用 `m[1]` 取序号 → 现状下每条引用都变成 `"Lundefined"`。现从 `m[0]`（完整匹配）剥前缀/后缀。
const stripL = (s) => s.replace(/^\[L/, '').replace(/\]$/, '');
for (const m of bodyText.matchAll(L_REGEX)) L_IN_TEXT.add(stripL(m[0]));
const referencesBody = sectionBody(text, '参考文献') || '';
const refsInList = new Set();
const refsListRegex = refRegex('L');  // v18.16.0（A-2 反哺）：与 L_REGEX 同步
// v18.16.0（A-2 反哺 · 收尾）：refs.mjs 的 refRegex 不带捕获组（`m[1]` 是 undefined），
//   旧消费点用 `m[1]` 取序号 → 现状下每条引用都变成 `"Lundefined"`。现从 `m[0]`（完整匹配）剥前缀/后缀。
for (const m of referencesBody.matchAll(refsListRegex)) refsInList.add(stripL(m[0]));
// 装饰性 = 仅在文末列表，未在正文出现
const decorative = [...refsInList].filter((r) => !L_IN_TEXT.has(r));
// 在正文出现 1 次 = 弱；2 次 = 中；≥3 次 = 强
const L_COUNT = {};
for (const m of bodyText.matchAll(L_REGEX)) {
  const id = stripL(m[0]);
  L_COUNT[id] = (L_COUNT[id] || 0) + 1;
}
const strength = { 强: [], 中: [], 弱: [], 装饰性: decorative };
for (const [lid, count] of Object.entries(L_COUNT)) {
  if (count >= 3) strength['强'].push({ id: `L${lid}`, count });
  else if (count === 2) strength['中'].push({ id: `L${lid}`, count });
  else strength['弱'].push({ id: `L${lid}`, count });
}
const totalRefs = L_IN_TEXT.size;
// v18.12.0（全量审计 L-63 续）：**装饰性比率的分母是「文末清单条数」，不是「正文引用条数」**。
//   旧版 `totalRefs = L_IN_TEXT.size` 且 `decorativeRatio = totalRefs > 0 ? decorative.length / refsInList.size : 0`
//   —— 当正文**一条 [Lxx] 都没有**（纯幽灵稿：清单列了 5 条、正文零引用）时 `totalRefs === 0` → 比率被短路成 `0`
//   → `cStrengthPass = true` → 「装饰性 >20% → P1」在这类**最该报警**的稿子上恰好静默通过。
//   现分母固定为清单条数（清单为空才是真正无引用可言，此时比率记 0）。
const decorativeRatio = refsInList.size > 0 ? decorative.length / refsInList.size : 0;
const weakRatio = totalRefs > 0 ? strength['弱'].length / totalRefs : 0;
// 装饰性 >20% → P1（说明文献卡未经筛选）；弱（仅 1 次）>50% → P2 软提示
const cStrengthPass = decorativeRatio <= 0.20 && weakRatio <= 0.50;
const cStrengthSeverity = decorativeRatio > 0.20 ? 'P1' : (weakRatio > 0.50 ? 'P2' : 'PASS');

// === C-Redundancy: 同论点同时引 ≥4 篇且未在文中指明差异 ===
// v18.23.0 EFF-1（**第三层校准，由第二层修复暴露**）：判定单位由「**段**」收到「**句**」。
//   证据（2026-09-27，21 个真实项目横扫）：段尺度下 **18/21 个项目命中**，且命中的是
//   `二、文献综述…(11)` / `三、文献综述与边际贡献(9)` / `摘要(8)` / `第 4 章 描述性结果(7)` 这类**正常写法**——
//   综述节同时引十来篇、摘要罗列证据基础都是**体例要求**，不是「堆砌」。照此判 P1 等于「几乎每篇合格
//   论文都被判 P1」（T7 必跑本门 → 每轮都触发一次修订回环）。
//   而规格的**本意**是「同一论点**同时**引 5 篇同质研究但不指明区别」（07 卡 §📚 背景段原话）——
//   「同一论点同时引」在文本上的对应单位是**句**（一口气并列挂 4+ 篇引用的那句话），不是整节。
//   故：① 扫描面 = **正文区 ∩ 非摘要区**；② 判定单位 = **句**；③ 判定仍按规格：
//   句内 ≥4 篇不同引用且句内无差异关键词 → **P1**（**规格未变，收窄的只是「同时」的尺度**）。
const REDUNDANCY_THRESHOLD = 4;
const redundancyViolations = [];
// v18.62.4（全量审计-v18.62.3 §8.2 #23）：**本章此前自建标题正则、未过 `maskFences`**。
//   病灶：围栏代码块里的 `### 示例`（格式示例 / 模板片段）被当作真段落扫描——若该示例句里
//   引了 ≥4 条 `[Lxx]` 且没有差异关键词，就会在**正确内容**上产生 P2 → 把整门推到 exit 3。
//   本仓的围栏语义有**唯一实现**（`_lib/sections.mjs` 的 `maskFences`，保长保行结构），
//   故此处改为「**用遮罩文本定位标题、用原文取段落正文**」——偏移一致，语义与其余消费者对齐。
const paragraphRe = /^(#{2,4})\s+(.+)$/gm;
const paragraphs = [];
const DIFFERENCE_KEYWORDS = ['不同', '差异', '相比', '区别', '与之相比', '有别于', '不同于'];
const maskedForScan = maskFences(text);
for (const m of maskedForScan.matchAll(paragraphRe)) {
  const start = m.index;
  const level = m[1].length;
  const nextRe = new RegExp(`^#{1,${level}}\\s+`, 'gm');
  nextRe.lastIndex = start + m[0].length;
  const next = nextRe.exec(maskedForScan);
  const end = next ? next.index : text.length;
  const ptitle = m[2].trim();
  const pbody = text.slice(start, end);   // 正文仍取**原文**（遮罩保长，偏移可直接复用）
  // v18.23.0 EFF-1 第二层修复（**由第一层修复暴露**）：扫描面必须是**正文区**。
  //   第一层修掉 `L${x[1]}` → `Lundefined` 的假绿后，本规则**第一次真的会触发**，于是当场暴露：
  //   `## 参考文献` 节自身列了 N 条 `[Lxx]`，天然满足「同段 ≥4 篇且无差异关键词」→ **每一篇合格论文
  //   都会被判 P1**（这就是它此前「从不触发」的另一半原因：真触发的话没人会接受）。
  //   第三层进一步把**摘要/关键词**也排除，故起止两端都与 count-chars 的正文区同源。
  if (start < bodyStartIdx || start >= bodyEndIdx) continue;   // 摘要/关键词 + 文末节 都不参与
  if (/^(摘要|Abstract|ABSTRACT|关键词|Keywords|Key\s?words)\b/i.test(ptitle)) continue;   // 前言的罗列节一律不参与
  // v18.23.0 EFF-1 修复（**假绿**：C-Redundancy 自实装起恒 pass）：`refRegex` 工厂产出的正则**没有捕获组**
  //   （`\[L\d+\]`），而本行旧写 `L${x[1]}` → 每条引用都变成字面量 `"Lundefined"` → `uniqueRefs` 恒为长度 1
  //   → 永远 < 阈值 4 → 「同段引 ≥4 篇且未指明差异 → P1」**从未触发过**。
  //   实测（2026-09-27）：一段引 5 条不同 [Lxx] 且无差异关键词 → 旧版报 `pass: true / violations: []`。
  //   同文件上方两处消费点（`L_IN_TEXT` / `L_COUNT`）在 v18.16.0 已改用 `stripL(m[0])`，本行是漏网的一处。
  for (const sent of maskedForScan.slice(start, end).split(/(?<=[。；！？])|\n/)) {
    const refsInS = [...sent.matchAll(L_REGEX)].map((x) => `L${stripL(x[0])}`);
    const uniqueRefs = [...new Set(refsInS)];
    if (uniqueRefs.length < REDUNDANCY_THRESHOLD) continue;
    if (DIFFERENCE_KEYWORDS.some((k) => sent.includes(k))) continue;
    redundancyViolations.push({
      section: ptitle, refsCount: uniqueRefs.length, refs: uniqueRefs,
      sentence: sent.trim().slice(0, 140),
    });
  }
}
const cRedundancyPass = redundancyViolations.length === 0;
// v18.23.0 EFF-1（第四层，判级）：**P1 → P2 候选**。
//   实测两面夹击的结论：段尺度 18/21 项目命中（综述/摘要等正常写法），收到句尺度后**仍 11/21**
//   （命中面变成「结论/结语/Keywords/引言」里「多项研究支持该结论[L01][L02][L03][L04]」式句子）——
//   而在结论里并列引用多条支撑文献**本身是正常写法**：它是否构成「同质堆砌」，取决于**被引文献之间
//   是否同质、其差别是否需要点明**，这是要**读文献关系**才能判的**语义问题**，机械只能挑出来、判不了级。
//   故按本仓既有原则（`apply-diff` 的 `numeric_drift` / `g-audit` 的 G2：「机械只挑，判级归 T7」）
//   降为 **P2 软提示**，并同时输出 `sentence` 原文供 T7 直接判读（省一次全文回查）。
//   ⚠️ 这是对 `07-审计-auditor.md` §📚「C-Redundancy … P1」字面的**收窄**，依据是本批横扫实测；
//   同批已更新该卡，并在 `audits/机制文件修订记录-2026-09-27-QLT1-质量分.md` 登记供主人复核。
const cRedundancySeverity = redundancyViolations.length === 0 ? 'PASS' : 'P2';

// === C-Distribution: 引用年代分布健康度 ===
// 简化实现：从参考文献节抽取年份字段，统计
//   - 近 3 年（当前年 - 2 至 当前年）
//   - 5+ 年前（当前年 - 5+）
//   - 中间年代（近 4-5 年）
// 理想比例：近 3 年 ≥30% + 5+ 年前 ≥20% + 中间 ≥20%（即三层都有覆盖）
// v18.62.4（全量审计-v18.62.3 §8.2 #22）：**「四位数字」不等于「出版年」**。
//   病灶：旧实现直接在参考文献全文上跑 `/(?:19|20)(\d{2})/g`，于是一串常见形态会把**页码/卷期/标识号**
//   当年份：`2018, 12(3): 2015-2030.` 会额外产出 **2015 与 2030** 两个「年份」；`doi:10.1000/2019.123`
//   同理。后果是**年份分布失真** → 干净的稿子也可能被推到 exit 3（`cDistributionSeverity`）。
//   修法：先**剥掉「明显不是年份」的数字区**，再在剩下的文本上抽年份。剥除顺序与形态都来自真实
//   参考文献条目（括号卷期 → 页码区间 → URL/DOI → 标识号），且每步只剥数字与紧邻标点，不碰汉字。
const refsForYears = String(referencesBody)
  .replace(/\(\s*\d{1,4}\s*\)/g, ' ')                       // 卷/期：`12(3)`
  .replace(/\b\d{1,5}\s*[-–—~]\s*\d{1,5}\b/g, ' ')          // 页码区间：`2015-2030`
  .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')                // URL
  .replace(/\b(?:doi|DOI)\s*[:：]?\s*\S+/g, ' ')            // DOI
  .replace(/\b(?:ISBN|ISSN)\b[^\s]*/gi, ' ');               // 标识号
const YEAR_REGEX = /(?:19|20)(\d{2})/g;
const yearCount = {};
for (const m of refsForYears.matchAll(YEAR_REGEX)) {
  const year = parseInt(m[0], 10);
  if (year >= 1990 && year <= 2030) {
    yearCount[year] = (yearCount[year] || 0) + 1;
  }
}
const totalYears = Object.values(yearCount).reduce((a, b) => a + b, 0);
const currentYear = new Date().getFullYear();
const recent3Years = Object.entries(yearCount).filter(([y]) => parseInt(y, 10) >= currentYear - 2).reduce((a, b) => a + b[1], 0);
const oldYears = Object.entries(yearCount).filter(([y]) => parseInt(y, 10) <= currentYear - 5).reduce((a, b) => a + b[1], 0);
const midYears = totalYears - recent3Years - oldYears;
const recentRatio = totalYears > 0 ? recent3Years / totalYears : 0;
const oldRatio = totalYears > 0 ? oldYears / totalYears : 0;
const midRatio = totalYears > 0 ? midYears / totalYears : 0;
const cDistributionHealthy = recentRatio >= 0.30 && oldRatio >= 0.20 && midRatio >= 0.20;
// v18.62.4（全量审计-v18.62.3 §8.2 #22 暴露）：**样本不足时不得出现 `pass:false` + `severity:'PASS'`**。
//   旧式 `!healthy && totalYears > 5 ? 'P2' : 'PASS'` 在 `totalYears ≤ 5` 时给出
//   `pass: false` 而 `severity: 'PASS'` —— **同一记录自相矛盾**，读者无法判断该不该处置。
//   现按本仓既有语义收口为三态：样本不足以判分布 → **SKIP（未检，不计入 pass）**。
const cDistributionEnough = totalYears > 5;
const cDistributionPass = cDistributionEnough ? cDistributionHealthy : 'SKIP';
const cDistributionSeverity = !cDistributionEnough ? 'SKIP' : (cDistributionHealthy ? 'PASS' : 'P2');

// --- 汇总 ---
// v18.62.4：`SKIP` **不计入 pass**（`=== true`），且**不产出干净的 exit 0**（未检 ≠ 通过）。
const allPass = cStrengthPass === true && cRedundancyPass === true && cDistributionPass === true;
const allSeverities = [cStrengthSeverity, cRedundancySeverity, cDistributionSeverity];
const hasP1 = allSeverities.includes('P1');
const exitCode = allPass ? 0 : (hasP1 ? 1 : 3);

const result = {
  file,
  version: packageVersionTag(),
  checks: {
    'C-Strength': {
      name: '引用关联强度分布',
      pass: cStrengthPass,
      severity: cStrengthSeverity,
      totalRefs,
      strength,
      decorativeRatio: +(decorativeRatio.toFixed(2)),
      weakRatio: +(weakRatio.toFixed(2)),
      note: '装饰性 >20% → P1（说明文献卡未经筛选）；弱（仅 1 次）>50% → P2',
    },
    'C-Redundancy': {
      name: '同论点冗余引用',
      pass: cRedundancyPass,
      severity: cRedundancySeverity,
      violations: redundancyViolations,
      threshold: REDUNDANCY_THRESHOLD,
      note: '同**句**同时引 ≥4 篇且未指明差异 → P1（v18.23.0：判定单位由「段」收到「句」、扫描面限正文区∩非摘要区）',
    },
    'C-Distribution': {
      name: '引用年代分布',
      pass: cDistributionPass,
      severity: cDistributionSeverity,
      distribution: {
        recent3Years: { count: recent3Years, ratio: +(recentRatio.toFixed(2)) },
        midYears: { count: midYears, ratio: +(midRatio.toFixed(2)) },
        oldYears: { count: oldYears, ratio: +(oldRatio.toFixed(2)) },
      },
      note: '理想：近 3 年 ≥30% + 5+ 年前 ≥20% + 中间 ≥20%',
    },
  },
  overall: { pass: allPass, exitCode },
  meta: {
    timestamp: new Date().toISOString(),
    description: '论衡引用实质相关性度量 / v18.10.0 战略反哺 P1-1 / scripts 白名单 19→20',
    notes: '本脚本为机检骨架 + 启发式判定；阈值与判定逻辑与 07-审计 §引用实质相关性段 同源维护',
  },
};

const output = JSON.stringify(result, null, 2);
if (reportPath) writeReport(reportPath, output, { protect: [file] });   // v18.12.0（L-50）：同文件 → exit 10
else console.log(output);

process.exit(exitCode);