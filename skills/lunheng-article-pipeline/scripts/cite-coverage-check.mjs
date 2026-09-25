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
import { sectionBody, firstEndnoteIndex } from './_lib/sections.mjs';
import { writeReport } from './_lib/destructive-write.mjs';   // 报告写盘守卫（v18.12.0，全量审计 L-50）
import { refRegex } from './_lib/refs.mjs';                   // v18.16.0（A-2 反哺）：任意位数 L 编号，与 m-gate-check 同源
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
// 简化实现：检测每个段落（## / ### 段），统计每段引用的 [Lxx] 数量
// 若某段引用 ≥4 个 [Lxx]，且没有出现「与...不同」「相比...」「不同于」「差异」等关键词 → P1
const REDUNDANCY_THRESHOLD = 4;
const redundancyViolations = [];
const paragraphRe = /^(#{2,4})\s+(.+)$/gm;
const paragraphs = [];
for (const m of text.matchAll(paragraphRe)) {
  const start = m.index;
  const level = m[1].length;
  const nextRe = new RegExp(`^#{1,${level}}\\s+`, 'gm');
  nextRe.lastIndex = start + m[0].length;
  const next = nextRe.exec(text);
  const end = next ? next.index : text.length;
  const ptitle = m[2].trim();
  const pbody = text.slice(start, end);
  const refsInP = [...pbody.matchAll(L_REGEX)].map((x) => `L${x[1]}`);
  const uniqueRefs = [...new Set(refsInP)];
  if (uniqueRefs.length >= REDUNDANCY_THRESHOLD) {
    const differenceKeywords = ['不同于', '相比', '与...不同', '差异', '与之不同', '差别', '不同点'];
    const hasDifference = differenceKeywords.some((k) => pbody.includes(k));
    if (!hasDifference) {
      redundancyViolations.push({ section: ptitle, refsCount: uniqueRefs.length, refs: uniqueRefs });
    }
  }
}
const cRedundancyPass = redundancyViolations.length === 0;
const cRedundancySeverity = redundancyViolations.length === 0 ? 'PASS' : 'P1';

// === C-Distribution: 引用年代分布健康度 ===
// 简化实现：从参考文献节抽取年份字段，统计
//   - 近 3 年（当前年 - 2 至 当前年）
//   - 5+ 年前（当前年 - 5+）
//   - 中间年代（近 4-5 年）
// 理想比例：近 3 年 ≥30% + 5+ 年前 ≥20% + 中间 ≥20%（即三层都有覆盖）
const YEAR_REGEX = /(?:19|20)(\d{2})/g;
const yearCount = {};
for (const m of referencesBody.matchAll(YEAR_REGEX)) {
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
const cDistributionPass = cDistributionHealthy;
const cDistributionSeverity = !cDistributionHealthy && totalYears > 5 ? 'P2' : 'PASS';

// --- 汇总 ---
const allPass = cStrengthPass && cRedundancyPass && cDistributionPass;
const allSeverities = [cStrengthSeverity, cRedundancySeverity, cDistributionSeverity];
const hasP1 = allSeverities.includes('P1');
const exitCode = allPass ? 0 : (hasP1 ? 1 : 3);

const result = {
  file,
  version: 'v18.11.0',
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
      note: '某段引用 ≥4 篇且未指明差异 → P1',
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