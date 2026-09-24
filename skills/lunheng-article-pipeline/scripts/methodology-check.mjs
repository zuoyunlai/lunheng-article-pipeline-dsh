#!/usr/bin/env node
// 论衡方法论可复现性门（v18.10.0 战略反哺新增 / P0-1 / scripts 白名单 18→19）
// 用法：node methodology-check.mjs <文件.md> [--report <path>]
//   --report <p>   = JSON 结果写入 <p>（默认 stdout）
//
// 退出码（与 M 门语义同源）：
//   0  = 三项检查全过
//   1  = P1 问题（参数缺失 / 数据-方法不匹配 / 结果-方法不可回链）
//   3  = 仅 P2 软提示
//   10 = 参数或路径错误
//   70 = 内部错误
//
// 3 项检查（与 P0-5 四声明节档位机检联合）：
//   M-Form-12    = 方法节参数完整性（样本量 / 抽样方式 / 变量定义 / 统计模型 / 超参数 / 随机种子 / 软硬件环境 — 至少 4 项）
//   M-Exist-11   = 统计-数据匹配度（参数/非参数 / 独立/配对 / 单尾/双尾 / 效应量与置信区间报告）
//   M-Exist-12   = 结果-方法闭环（每个结果叙述能否回链到方法节具体步骤）

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
    console.error(`未知参数: ${a}\n用法: node methodology-check.mjs <文件.md> [--report <path>]`);
    process.exit(10);
  } else if (file === null) file = a;
  else {
    console.error(`多次传入文件参数: ${a}`);
    process.exit(10);
  }
}
if (!file) { console.error('用法: node methodology-check.mjs <文件.md> [--report <path>]'); process.exit(10); }
if (!existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(10); }
requireExistingFile(file, '待检查论文');

// --- 编码体检（与 count-chars.mjs / structure-check.mjs 同源） ---
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

// --- 取方法节 + 结果节 + 讨论节 ---
const methodBody = sectionBody(text, '方法') || sectionBody(text, '研究方法') || sectionBody(text, 'Method') || '';
const resultsBody = sectionBody(text, '结果') || '';
const discussionBody = sectionBody(text, '讨论') || '';

// === M-Form-12 方法节参数完整性 ===
const METHOD_PARAM_KEYWORDS = {
  '样本量': ['样本量', 'n =', 'n=', 'N =', 'N=', '样本数', '受访者', '调查对象', 'participants', 'sample size', 'N=' ],
  '抽样方式': ['抽样', '随机', '分层', '聚类', '便利抽样', '目的抽样', '滚雪球', 'sampling', 'stratified', 'cluster'],
  '变量定义': ['变量', '因变量', '自变量', '协变量', '中介变量', '调节变量', '操作性定义', 'variable', 'covariate'],
  '统计模型': ['回归', 'OLS', 'logit', 'probit', '中介', '调节', '结构方程', 'SEM', 'PLS', '倾向得分', 'PSM', 'DID', 'RDD', '工具变量', 'IV', 'regression'],
  '超参数': ['学习率', 'lr', 'epoch', 'batch size', 'batch_size', '正则化', '正则', 'dropout', '超参数', 'hyperparameter', 'λ', 'alpha'],
  '随机种子': ['random seed', 'seed', '种子', '随机数', 'rng'],
  '软硬件环境': ['GPU', 'CPU', '内存', 'RAM', 'Python', 'R', 'Stata', 'SPSS', 'TensorFlow', 'PyTorch', 'sklearn', '硬件', '软件', 'environment'],
};
const methodFound = [];
const methodMissing = [];
for (const [param, keywords] of Object.entries(METHOD_PARAM_KEYWORDS)) {
  if (keywords.some((k) => methodBody.includes(k))) methodFound.push(param);
  else methodMissing.push(param);
}
// 至少 4 项才合规
const mForm12Pass = methodFound.length >= 4;
const mForm12Severity = methodFound.length >= 4 ? 'PASS' : (methodFound.length >= 2 ? 'P1' : 'P0');

// === M-Exist-11 统计-数据匹配 ===
// 检测方法节是否声明：参数/非参数 + 效应量 + 置信区间 / p 值
const STAT_KEYWORDS = {
  '检验类型声明': ['t 检验', 't检验', 'F 检验', 'F检验', '卡方', 'χ²', 'χ2', 'chi-square', 'ANOVA', '方差分析', 'Mann-Whitney', 'Wilcoxon', 'Kruskal', '非参数', '参数检验'],
  '效应量': ['效应量', 'effect size', "Cohen's d", "Cohen's d", 'd =', 'd=', 'r =', 'r=', 'η²', 'eta squared', 'ω²', 'OR =', 'OR=', 'odds ratio', 'RR =', 'RR=', 'β =', 'β=', 'β 系数'],
  '置信区间/p 值': ['95% CI', '95%CI', '置信区间', 'p <', 'p<', 'p =', 'p=', 'P <', 'P<', 'P =', 'P=', 'p-value', 'p值', 'significance'],
};
const statFound = [];
const statMissing = [];
for (const [item, keywords] of Object.entries(STAT_KEYWORDS)) {
  if (keywords.some((k) => methodBody.includes(k))) statFound.push(item);
  else statMissing.push(item);
}
// 三项齐全才算合规；缺任一项 = P1（最常见问题是不报效应量）
const mExist11Pass = statMissing.length === 0;
const mExist11Severity = statMissing.length === 0 ? 'PASS' : 'P1';

// === M-Exist-12 结果-方法闭环 ===
// 每个结果叙述（以 ### / ## 开头或含 [Dxx] 引用）能否在方法节找到对应方法步骤
// 简化版：检测结果节是否引用了方法节中出现的关键方法名（如「OLS / PSM / DID / 中介效应 / 倾向得分匹配」）
const METHOD_NAME_PATTERNS = [
  /OLS[^a-zA-Z]/,
  /倾向得分匹配/,
  /PSM[^a-zA-Z]/,
  /DID[^a-zA-Z]/,
  /双重差分/,
  /RDD[^a-zA-Z]/,
  /断点回归/,
  /中介效应/,
  /中介(?!变量)/,
  /调节效应/,
  /SEM[^a-zA-Z]/,
  /结构方程/,
  /工具变量/,
  /IV[^a-zA-Z]/,
  /logit/i,
  /probit/i,
];
const methodNamesInMethod = METHOD_NAME_PATTERNS.filter((re) => re.test(methodBody)).map((re) => re.source);
const resultsRefsMethod = methodNamesInMethod.length === 0 || methodNamesInMethod.some((name) => new RegExp(name).test(resultsBody));
const mExist12Pass = resultsRefsMethod;
const mExist12Severity = resultsRefsMethod ? 'PASS' : 'P1';

// --- 汇总 ---
const allPass = mForm12Pass && mExist11Pass && mExist12Pass;
const allSeverities = [mForm12Severity, mExist11Severity, mExist12Severity];
const hasP1 = allSeverities.includes('P1');
const hasP0 = allSeverities.includes('P0');
const exitCode = allPass ? 0 : (hasP0 ? 2 : (hasP1 ? 1 : 3));

const result = {
  file,
  version: 'v18.11.0',
  checks: {
    'M-Form-12': {
      name: '方法节参数完整性',
      pass: mForm12Pass,
      severity: mForm12Severity,
      required: 4,
      found: methodFound,
      foundCount: methodFound.length,
      missing: methodMissing,
      note: '至少 4 项：样本量 / 抽样方式 / 变量定义 / 统计模型 / 超参数 / 随机种子 / 软硬件环境',
    },
    'M-Exist-11': {
      name: '统计-数据匹配',
      pass: mExist11Pass,
      severity: mExist11Severity,
      found: statFound,
      missing: statMissing,
      note: '三项齐全：检验类型声明 / 效应量 / 置信区间或 p 值',
    },
    'M-Exist-12': {
      name: '结果-方法闭环',
      pass: mExist12Pass,
      severity: mExist12Severity,
      methodNamesFound: methodNamesInMethod,
      note: '每个结果叙述能否回链到方法节具体步骤（简化版：方法节中的关键方法名是否在结果节被引用）',
    },
  },
  overall: { pass: allPass, exitCode },
  meta: {
    timestamp: new Date().toISOString(),
    description: '论衡方法论可复现性门 / v18.10.0 战略反哺 P0-1 / scripts 白名单 18→19',
    notes: '本脚本为机检骨架 + 关键词扫描；阈值与判定逻辑与 m-gate-check.mjs 的 M-Form-12 / M-Exist-11 / M-Exist-12 函数同源维护',
  },
};

const output = JSON.stringify(result, null, 2);
if (reportPath) writeFileSync(reportPath, output, 'utf8');
else console.log(output);

process.exit(exitCode);