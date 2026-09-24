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

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs';
import { sectionBody } from './_lib/sections.mjs';
installExitGuard();

// --- CLI 参数解析 ---
const argv = process.argv.slice(2);
let file = null;
let reportPath = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--report') { reportPath = argv[++i]; }
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
const L_REGEX = /\[L(\d{2,3})\]/g;
const L_IN_TEXT = new Set();
for (const m of text.matchAll(L_REGEX)) L_IN_TEXT.add(m[1]);
const referencesBody = sectionBody(text, '参考文献') || '';
const refsInList = new Set();
const refsListRegex = /\[L(\d{2,3})\]/g;
for (const m of referencesBody.matchAll(refsListRegex)) refsInList.add(m[1]);
// 装饰性 = 仅在文末列表，未在正文出现
const decorative = [...refsInList].filter((r) => !L_IN_TEXT.has(r));
// 在正文出现 1 次 = 弱；2 次 = 中；≥3 次 = 强
const L_COUNT = {};
for (const m of text.matchAll(L_REGEX)) {
  L_COUNT[m[1]] = (L_COUNT[m[1]] || 0) + 1;
}
const strength = { 强: [], 中: [], 弱: [], 装饰性: decorative };
for (const [lid, count] of Object.entries(L_COUNT)) {
  if (count >= 3) strength['强'].push({ id: `L${lid}`, count });
  else if (count === 2) strength['中'].push({ id: `L${lid}`, count });
  else strength['弱'].push({ id: `L${lid}`, count });
}
const totalRefs = L_IN_TEXT.size;
const decorativeRatio = totalRefs > 0 ? decorative.length / refsInList.size : 0;
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
  version: 'v18.10.0',
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
if (reportPath) writeFileSync(reportPath, output, 'utf8');
else console.log(output);

process.exit(exitCode);