#!/usr/bin/env node
// 论衡元分析协议生成器（v18.10.0 战略反哺新增 / P2-1 / scripts 白名单 21→22）
// 用法：node meta-synthesize.mjs <run/项目名> [--trigger N] [--report <path>]
//   <项目名>     = 项目目录路径（含 data/数据卡.md）
//   --trigger N  = 同质数据卡阈值（默认 10；≥ N 触发元分析协议生成）
//   --report <p> = JSON 结果写入 <p>（默认 stdout）
//
// 退出码：
//   0  = 同质数据卡 ≥ N，协议已生成
//   3  = 同质数据卡 < N，提示「未触发元分析」（P2 软提示）
//   10 = 参数或路径错误
//   70 = 内部错误
//
// ⚠️ 本脚本定位：「提示层」而非「自动化元分析」——元分析的方法学要求太高，
//   主控不应假装能做出来；脚本输出 PRISMA 协议骨架 + 效应量识别 + 异质性诊断提示，
//   供主控 + T4 据此触发人工元分析或外接 R / Python / Stata 工具。

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs';
installExitGuard();

// --- CLI 参数解析 ---
const argv = process.argv.slice(2);
let projectPath = null;
let trigger = 10;
let reportPath = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--trigger') { trigger = parseInt(argv[++i], 10); if (Number.isNaN(trigger)) { console.error('--trigger 须为整数'); process.exit(10); } }
  else if (a === '--report') { reportPath = argv[++i]; }
  else if (a.startsWith('--')) {
    console.error(`未知参数: ${a}\n用法: node meta-synthesize.mjs <run/项目名> [--trigger N] [--report <path>]`);
    process.exit(10);
  } else if (projectPath === null) projectPath = a;
  else {
    console.error(`多次传入项目路径: ${a}`);
    process.exit(10);
  }
}
if (!projectPath) { console.error('用法: node meta-synthesize.mjs <run/项目名> [--trigger N] [--report <path>]'); process.exit(10); }

// --- 数据卡读取 ---
const dataCardPath = `${projectPath}/data/数据卡.md`;
if (!existsSync(dataCardPath)) {
  console.error(`数据卡不存在: ${dataCardPath}`);
  process.exit(10);
}
requireExistingFile(dataCardPath, '数据卡');
const text = readFileSync(dataCardPath, 'utf8');

// === 解析数据卡（识别 [Dxx] 条目，兼容索引行 + ### 段两种格式） ===
const dataCards = [];
// 1. 优先识别 ### [Dxx] 段（每段含完整字段）
const SECTION_REGEX = /^### \[D(\d{2,3})\]\s+(.+)$/gm;
for (const m of text.matchAll(SECTION_REGEX)) {
  const id = parseInt(m[1], 10);
  const topic = m[2].trim();
  const startIdx = m.index + m[0].length;
  const nextRe = /^###\s+/gm;
  nextRe.lastIndex = startIdx;
  const next = nextRe.exec(text);
  const endIdx = next ? next.index : text.length;
  const body = text.slice(startIdx, endIdx);
  const yearMatch = body.match(/年份[：:]\s*(\d{4})/);
  const sizeMatch = body.match(/(?:样本量|n|N)[：:=]\s*(\d+)/);
  const typeMatch = body.match(/(RCT|队列研究|横断面|case-control|meta-analysis|experiment|survey|interview)/i);
  dataCards.push({
    id, topic,
    year: yearMatch ? parseInt(yearMatch[1], 10) : null,
    sampleSize: sizeMatch ? parseInt(sizeMatch[1], 10) : null,
    studyType: typeMatch ? typeMatch[1].toLowerCase() : null,
  });
}
// 2. 兜底：索引段表格行 `| [Dxx] | 主题 | 数值/口径 | 来源/年份 |` — 只取 id + 主题
if (dataCards.length === 0) {
  const INDEX_REGEX = /^\|\s*\[D(\d{2,3})\]\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+?)\s*\|/gm;
  for (const m of text.matchAll(INDEX_REGEX)) {
    const id = parseInt(m[1], 10);
    const topic = m[2].trim();
    const valueCell = m[3].trim();
    const sourceCell = m[4].trim();
    // 从 sourceCell 提取年份（末 4 位数字）
    const yearMatch = sourceCell.match(/(\d{4})/g);
    const year = yearMatch ? parseInt(yearMatch[yearMatch.length - 1], 10) : null;
    // 从 valueCell 提取样本量
    const sizeMatch = valueCell.match(/(\d+(?:\.\d+)?)\s*(亿|万|M|K)/);
    dataCards.push({ id, topic, year, sampleSize: null, studyType: null });
  }
}

const totalCards = dataCards.length;

// === 触发判定 ===
if (totalCards < trigger) {
  console.error(`同质数据卡数 ${totalCards} < 阈值 ${trigger}：未触发元分析协议生成（仅提示元分析可能性）。`);
  console.error(`如确需元分析，把 --trigger 调小至 ${totalCards} 重跑，或 T4 在 analysis/分析大纲.md 显式声明「无元分析需求」。`);
  process.exit(3);
}

// === PRISMA 流程骨架生成（4 阶段） ===
// 识别阶段：所有数据卡视作「识别」（Identification）；筛选阶段需人工过滤；
// 纳入阶段：所有触发阈值的卡；综合阶段：输出 meta-synthesize 协议
const prismaFlow = {
  identification: { identified: totalCards, note: '所有触发阈值的数据卡' },
  screening: { screened: totalCards, excluded: 0, note: '筛选标准 = 同质研究设计 / 同质变量 / 同质测量工具 — 由 T4 + 主控裁定' },
  eligibility: { eligible: totalCards, excluded: 0, note: '纳入标准 = 数据完整 + 报告效应量或可计算原始数据 + 发表语言无偏 — 由 T4 + 主控裁定' },
  included: { included: totalCards, analysisNote: '合成方法（固定效应 / 随机效应 / 混合）由 T4 选 R / Python / Stata 实施' },
};

// === 效应量识别 ===
// 自动标注每张卡的「可计算效应量」候选（基于数据类型）
const effectSizeCandidates = dataCards.map((card) => {
  const candidates = [];
  // 二分类结局：OR / RR / RD
  // 连续结局：MD / SMD (Cohen's d) / β
  // 关联研究：r / β
  // 检验统计：t / F / χ² → 可换算
  if (card.studyType === 'rct' || card.studyType === '队列研究' || card.studyType === 'case-control') {
    candidates.push('OR / RR（需原始 2×2 表）');
    candidates.push('RD（需暴露 / 非暴露结局率）');
  } else {
    candidates.push('MD（需均值 + 标准差 + 样本量）');
    candidates.push("SMD / Cohen's d（需两臂均值差 + 合并 SD）");
    candidates.push('r（需相关系数 + n）');
  }
  return { id: card.id, topic: card.topic, studyType: card.studyType, candidates };
});

// === 异质性诊断提示（I² / τ² 计算位置） ===
const heterogeneityHints = [
  { step: 1, action: '计算 Q 统计量（χ² 检验，自由度 = k-1）', formula: 'Q = Σ wᵢ (θᵢ - θ̂)²', note: 'wᵢ = 1/vᵢ（效应量方差倒数）' },
  { step: 2, action: '计算 I² 指数（异质性比例）', formula: 'I² = max(0, (Q - df) / Q) × 100%', note: 'I² < 25% 低 / 25-75% 中 / > 75% 高' },
  { step: 3, action: '计算 τ²（效应量方差估计，DerSimonian-Laird 法）', formula: 'τ² = max(0, (Q - df) / (Σwᵢ - Σwᵢ²/Σwᵢ))', note: 'τ² > 0 → 随机效应模型' },
  { step: 4, action: '异质性来源归类（Meta-regression / Subgroup）', formula: '按设计类型 / 人群 / 测量工具 / 发表年份 分组', note: '归类后用 meta-regression 量化异质性来源' },
];

// === 输出 ===
const result = {
  project: projectPath,
  version: 'v18.10.0',
  trigger: { threshold: trigger, actualCards: totalCards, triggered: true },
  prismaFlow,
  effectSizeCandidates,
  heterogeneityHints,
  meta: {
    timestamp: new Date().toISOString(),
    description: '论衡元分析协议生成器 / v18.10.0 战略反哺 P2-1 / scripts 白名单 21→22',
    notes: '本脚本仅生成协议骨架 + 效应量候选 + 异质性诊断提示；具体合成与计算须主控触发外部工具（R metafor / Python statsmodels / Stata metan）',
    positioning: '提示层（非自动化元分析）—元分析的方法学要求太高，主控不应假装能做出来',
  },
};

const output = JSON.stringify(result, null, 2);
if (reportPath) writeFileSync(reportPath, output, 'utf8');
else console.log(output);

process.exit(0);