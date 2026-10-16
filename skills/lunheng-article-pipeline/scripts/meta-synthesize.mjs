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

import { readFileSync, existsSync } from 'node:fs';
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs';
import { writeReport } from './_lib/destructive-write.mjs';   // 报告写盘守卫（v18.12.0，全量审计 L-50）
import { packageVersionTag } from './_lib/pkg-version.mjs';   // §8.3 #39：产物 version 单一真源
installExitGuard();

// --- CLI 参数解析 ---
const argv = process.argv.slice(2);
let projectPath = null;
let trigger = 10;
let reportPath = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--trigger') {
    const v = argv[++i];
    // v18.12.0（全量审计 L-62）：缺值守卫（旧版缺值 → parseInt(undefined) → NaN 检查兜住；但缺值本身应报参数错）
    if (!v || v.startsWith('--')) { console.error(`--trigger 缺少值（示例：--trigger 10）\n用法: node meta-synthesize.mjs <run/项目名> [--trigger N] [--report <path>]`); process.exit(10); }
    trigger = parseInt(v, 10); if (Number.isNaN(trigger)) { console.error('--trigger 须为整数'); process.exit(10); } }
  else if (a === '--report') {
    const v = argv[++i];
    if (!v || v.startsWith('--')) { console.error(`--report 缺少值（示例：--report audits/meta-synthesis.json）\n用法: node meta-synthesize.mjs <run/项目名> [--trigger N] [--report <path>]`); process.exit(10); }
    reportPath = v;
  }
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
// v19.7.1（元分析输入面修复 · 缺陷②）：**单位如实声明**——PRISMA 的 identified/screened/eligible/included
//   在元分析里数的是「**研究**（records → studies → included studies）」，而本脚本的输入是
//   `<项目>/data/数据卡.md`，那是**数据点**、不是研究报告。实测（`run/xingbie`，56 张卡）：旧版把 56 个数据点
//   在四个阶段**一律报成 56**，读者会读成「56 项研究入选」——**流程看起来完整**，这比「输出为空」更危险。
//   而数据卡契约（`templates/数据卡-template.md`）**不含「研究标识」字段** ⇒ 脚本**无法**把数据点归并为研究。
//   故：① 数值字段**保留**（它们确实等于数据点数，不得凭空改小）② **显式声明单位**；
//   ③ 另给 `studyCount: null` + 理由——**禁止**把 records 数当研究数（不静默、不假装）。
const prismaFlow = {
  unit: 'records（= 数据卡 = 数据点）——**不是研究数**',
  identification: { identified: totalCards, note: '所有触发阈值的数据卡（**records**，非研究）' },
  screening: { screened: totalCards, excluded: 0, note: '筛选标准 = 同质研究设计 / 同质变量 / 同质测量工具 — 由 T4 + 主控裁定' },
  eligibility: { eligible: totalCards, excluded: 0, note: '纳入标准 = 数据完整 + 报告效应量或可计算原始数据 + 发表语言无偏 — 由 T4 + 主控裁定' },
  included: { included: totalCards, analysisNote: '合成方法（固定效应 / 随机效应 / 混合）由 T4 选 R / Python / Stata 实施' },
  studyCount: null,
  studyCountReason: '数据卡契约不含「研究标识」字段 ⇒ 无法把数据点归并为研究；**禁止**把上述 records 数当研究数（要真做 PRISMA 须先由 T2 在建卡时补研究标识，属输入面改造）',
};

// === 效应量识别 ===
// 自动标注每张卡的「可计算效应量」候选（基于数据类型）
// v19.7.1（元分析输入面修复 · 缺陷①）：**未知研究类型不再给通用候选**。旧版只有二分（RCT/队列/case-control
//   → OR/RR/RD；**其余一切** → MD/SMD/r），于是「**studyType 没识别出来**」与「**已知是横断面**」落进同一支
//   ⇒ 实测 `run/xingbie` **56/56 卡拿到同一组通用候选**、`studyType` 全为 null，下游会把那组候选误读成
//   「已识别出可算的效应量」。现拆三支，并对未识别者**显式标 degraded**（空候选 + 理由，不静默、不伪装）。
const effectSizeCandidates = dataCards.map((card) => {
  const candidates = [];
  // 二分类结局：OR / RR / RD
  // 连续结局：MD / SMD (Cohen's d) / β
  // 关联研究：r / β
  // 检验统计：t / F / χ² → 可换算
  if (card.studyType === 'rct' || card.studyType === '队列研究' || card.studyType === 'case-control') {
    candidates.push('OR / RR（需原始 2×2 表）');
    candidates.push('RD（需暴露 / 非暴露结局率）');
    return { id: card.id, topic: card.topic, studyType: card.studyType, candidates, degraded: false };
  }
  if (card.studyType) {
    // 已知类型但非上述三类（横断面 / meta-analysis / experiment / survey / interview）
    candidates.push('MD（需均值 + 标准差 + 样本量）');
    candidates.push("SMD / Cohen's d（需两臂均值差 + 合并 SD）");
    candidates.push('r（需相关系数 + n）');
    return { id: card.id, topic: card.topic, studyType: card.studyType, candidates, degraded: false };
  }
  // ⚠️ studyType 未识别 → **刻意不给通用候选**（给了 = 下游误读成「已识别」）
  return {
    id: card.id, topic: card.topic, studyType: null, candidates: [], degraded: true,
    degradedReason: '未识别出 studyType ⇒ 无法判定效应量形态（数据卡契约不含该字段，靠卡体正则提取）',
  };
});

// 退化聚合（v19.7.1）：把「多少张卡没识别出来」抬到**顶层可读**位置——单卡上的 degraded 容易被略过，
//   而「静默退化」正是缺陷① 的病根（脚本照常 exit 0）。T4/主控据此决定是否回退到输入面改造。
const effectSizeSummary = {
  total: effectSizeCandidates.length,
  identified: effectSizeCandidates.filter((c) => !c.degraded).length,
  degraded: effectSizeCandidates.filter((c) => c.degraded).length,
  note: 'degraded = studyType 未识别 ⇒ candidates 为空（**刻意不给通用候选**：给了会被下游误读成「已识别出可算效应量」）。degraded > 0 时须由 T4 回退到输入面（请 T2 补研究类型字段）或显式声明「无元分析需求」。',
};

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
  version: packageVersionTag(),
  trigger: { threshold: trigger, actualCards: totalCards, triggered: true },
  prismaFlow,
  effectSizeCandidates,
  effectSizeSummary,
  heterogeneityHints,
  meta: {
    timestamp: new Date().toISOString(),
    description: '论衡元分析协议生成器 / v18.10.0 战略反哺 P2-1 / scripts 白名单 21→22',
    notes: '本脚本仅生成协议骨架 + 效应量候选 + 异质性诊断提示；具体合成与计算须主控触发外部工具（R metafor / Python statsmodels / Stata metan）',
    positioning: '提示层（非自动化元分析）—元分析的方法学要求太高，主控不应假装能做出来',
    inputFaceCaveats: [
      '**输入面与元分析契约不匹配（v19.7.1 如实声明）**：本脚本只读 `<项目>/data/数据卡.md`，而**数据卡是数据点、不是研究报告**，其契约也不含 `studyType` / `sampleSize` / 「研究标识」字段——两个字段都靠**卡体正则**碰运气提取。',
      '后果一（效应量面）：`studyType` 提不出来时 `effectSizeCandidates` 会**整批 degraded**（candidates 为空）——见 `effectSizeSummary.degraded`。**不得**把它读成「已识别出可算效应量」。',
      '后果二（PRISMA 面）：`prismaFlow` 的四个计数等于**数据卡数（records）**，**不是研究数**（`studyCount` 刻意给 `null`）。要真做 PRISMA，须先由 T2 在建卡时补「研究标识 / 研究类型 / 样本量」，属**输入面改造**，不在本脚本能力内。',
      '责任点（T4 / 主控）：本脚本**触发后**须核对 `effectSizeSummary.degraded` 与 `prismaFlow.unit`，据实决定「回退输入面」或「显式声明无元分析需求」。',
    ],
  },
};

const output = JSON.stringify(result, null, 2);
if (reportPath) writeReport(reportPath, output, { protect: [dataCardPath] });   // v18.12.0（L-50）：同文件 → exit 10
else console.log(output);

process.exit(0);