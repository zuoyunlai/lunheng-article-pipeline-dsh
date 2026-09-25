#!/usr/bin/env node
// 论衡学术结构合规门（v18.10.0 战略反哺新增 / P0-4 / scripts 白名单 17→18）
// 用法：node structure-check.mjs <文件.md> [--humanities] [--report <path>]
//   --humanities   = 人文学科豁免 Methods，改检 IMRaD-Alternate（Introduction / Discussion / Conclusion）
//   --report <p>   = JSON 结果写入 <p>（默认 stdout）
//
// 退出码（与 M 门语义同源）：
//   0  = 三项检查全过
//   1  = P1 问题（IMRaD 节缺 / 漏斗结构缺 / 讨论要素缺）
//   3  = 仅 P2 软提示（如启发式词命中过多）
//   10 = 参数或路径错误（与 M 门 10 同语义）
//   70 = 内部错误
//
// 3 项检查：
//   S-IMRaD        = Introduction / Methods / Results / Discussion / Conclusion 五节是否齐备
//                    （--humanities 改检 IMRaD-Alternate：Introduction / Discussion / Conclusion 三节）
//   S-Intro-Funnel = 引言是否含「领域重要性」+「知识缺口」+「本文贡献」三要素（关键词扫描）
//   S-Discussion-4 = Discussion 是否含「主要发现重述」+「与既有研究比较」+「机制解释」+「局限性与未来方向」四要素

import { readFileSync, existsSync } from 'node:fs';
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs';
import { sectionBody } from './_lib/sections.mjs';
import { writeReport } from './_lib/destructive-write.mjs';   // 报告写盘守卫（v18.12.0，全量审计 L-50）
installExitGuard();

// --- CLI 参数解析 ---
const argv = process.argv.slice(2);
let file = null;
let humanities = false;
let reportPath = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--humanities') humanities = true;
  else if (a === '--report') {
    // v18.12.0（全量审计 L-62）：缺值守卫（旧版静默不落盘却 exit 0）
    const v = argv[++i];
    if (!v || v.startsWith('--')) { console.error(`--report 缺少值（示例：--report audits/structure.json）\n用法: node structure-check.mjs <文件.md> [--humanities] [--report <path>]`); process.exit(10); }
    reportPath = v;
  }
  else if (a.startsWith('--')) {
    console.error(`未知参数: ${a}\n用法: node structure-check.mjs <文件.md> [--humanities] [--report <path>]`);
    process.exit(10);
  } else if (file === null) file = a;
  else {
    console.error(`多次传入文件参数: ${a}`);
    process.exit(10);
  }
}
if (!file) { console.error('用法: node structure-check.mjs <文件.md> [--humanities] [--report <path>]'); process.exit(10); }
if (!existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(10); }
requireExistingFile(file, '待检查论文');

// --- 编码体检（与 count-chars.mjs 同源，v18.2.6 契约） ---
{
  const probe = readFileSync(file);
  if (probe.length >= 2 && ((probe[0] === 0xff && probe[1] === 0xfe) || (probe[0] === 0xfe && probe[1] === 0xff))) {
    console.error(`${file}: 检测到 UTF-16 BOM —— 本脚本只接受 UTF-8（契约见 .gitattributes）。请转码后重跑。`);
    process.exit(10);
  }
  if (probe.toString('utf8').includes('\uFFFD')) {
    console.error(`${file}: 解码出现替换字符 U+FFFD —— 该文件不是合法 UTF-8（GBK/GB18030 等）。请转码后重跑。`);
    process.exit(10);
  }
}

const text = readFileSync(file, 'utf8');

// --- S-IMRaD 检查 ---
// IMRaD 5 节（自然科学/实证论文）；人文学科用 IMRaD-Alternate 3 节
const IMRAD_SECTIONS = ['引言', '方法', '结果', '讨论', '结论'];
const IMRAD_ALT_SECTIONS = ['引言', '讨论', '结论'];
const imradList = humanities ? IMRAD_ALT_SECTIONS : IMRAD_SECTIONS;
const imradFound = [];
const imradMissing = [];
for (const sec of imradList) {
  const body = sectionBody(text, sec);
  if (body !== null && body.trim().length > 0) imradFound.push(sec);
  else imradMissing.push(sec);
}
const sImradPass = imradMissing.length === 0;
const sImradSeverity = imradMissing.length >= 2 ? 'P1' : imradMissing.length === 1 ? 'P1' : 'PASS';

// --- S-Intro-Funnel 检查 ---
// 引言漏斗：领域重要性 → 知识缺口 → 本文贡献
// 关键词扫描（接受变体形式）
const introBody = sectionBody(text, '引言');
const introText = introBody || '';
const FIELD_IMPORTANCE_KEYWORDS = ['重要性', '意义', '背景', '现状', '领域', '关注', '已成为', '近年来', '在全球', '在我国', '在 XX'];
const KNOWLEDGE_GAP_KEYWORDS = ['不足', '缺乏', '尚未', '未充分', '鲜有', '缺少', '有待', '仍未', '还不清楚', '有待进一步', '尚未形成'];
const CONTRIBUTION_KEYWORDS = ['本文', '本研究', '本课题', '我们', '笔者', '尝试', '旨在', '提出', '拟', '目标', '目的', '主要贡献', '边际贡献', '创新点', '推进'];
function hasKeyword(text, keywords) {
  return keywords.some((k) => text.includes(k));
}
const introHasImportance = hasKeyword(introText, FIELD_IMPORTANCE_KEYWORDS);
const introHasGap = hasKeyword(introText, KNOWLEDGE_GAP_KEYWORDS);
const introHasContribution = hasKeyword(introText, CONTRIBUTION_KEYWORDS);
const introMissing = [];
if (!introHasImportance) introMissing.push('领域重要性');
if (!introHasGap) introMissing.push('知识缺口');
if (!introHasContribution) introMissing.push('本文贡献');
const sIntroFunnelPass = introMissing.length === 0;
const sIntroFunnelSeverity = introMissing.length === 0 ? 'PASS' : 'P1';

// --- S-Discussion-4 检查 ---
// Discussion 四要素：主要发现重述 + 与既有研究比较 + 机制解释 + 局限性与未来方向
const discussionBody = sectionBody(text, '讨论');
const discussionText = discussionBody || '';
const DISC_FINDING_KEYWORDS = ['本文', '本研究', '我们发现', '结果表明', '结果显示', '本研究发现', '上述', '主要发现'];
const DISC_COMPARISON_KEYWORDS = ['与既有', '与已有', '与现有', '相比', '不同于', '类似', '一致', '相符', '不符', '相悖', '前人', '已有研究', '既有研究', 'L01', 'L02', 'L03', 'L04', 'L05', '[L'];
const DISC_MECHANISM_KEYWORDS = ['机制', '机理', '可能的原因是', '可以解释', '解释为', '这意味着', '揭示了', '反映了', '表明', '说明', '由于'];
const DISC_LIMITATION_KEYWORDS = ['局限', '限制', '不足', '本文未', '本研究未', '未来', '进一步', '展望', '后续研究', '有待探索'];
const discHasFinding = hasKeyword(discussionText, DISC_FINDING_KEYWORDS);
const discHasComparison = hasKeyword(discussionText, DISC_COMPARISON_KEYWORDS);
const discHasMechanism = hasKeyword(discussionText, DISC_MECHANISM_KEYWORDS);
const discHasLimitation = hasKeyword(discussionText, DISC_LIMITATION_KEYWORDS);
const discMissing = [];
if (!discHasFinding) discMissing.push('主要发现重述');
if (!discHasComparison) discMissing.push('与既有研究比较');
if (!discHasMechanism) discMissing.push('机制解释');
if (!discHasLimitation) discMissing.push('局限性与未来方向');
const sDiscussionPass = discMissing.length === 0;
const sDiscussionSeverity = discMissing.length === 0 ? 'PASS' : 'P1';

// --- 汇总与退出 ---
const allPass = sImradPass && sIntroFunnelPass && sDiscussionPass;
const allSeverities = [sImradSeverity, sIntroFunnelSeverity, sDiscussionSeverity];
const hasP1 = allSeverities.includes('P1');
const exitCode = allPass ? 0 : (hasP1 ? 1 : 3);

const result = {
  file,
  mode: humanities ? 'IMRaD-Alternate (人文)' : 'IMRaD (实证)',
  version: 'v18.11.0',
  checks: {
    'S-IMRaD': {
      pass: sImradPass,
      severity: sImradSeverity,
      found: imradFound,
      missing: imradMissing,
    },
    'S-Intro-Funnel': {
      pass: sIntroFunnelPass,
      severity: sIntroFunnelSeverity,
      missing: introMissing,
    },
    'S-Discussion-4': {
      pass: sDiscussionPass,
      severity: sDiscussionSeverity,
      missing: discMissing,
    },
  },
  overall: { pass: allPass, exitCode },
  meta: {
    timestamp: new Date().toISOString(),
    description: '论衡学术结构合规门 / v18.10.0 战略反哺 P0-4 / scripts 白名单 17→18',
    notes: '本脚本为机检骨架，主控与 T7 须依据 missing 字段补查或修改；非致命项仅提示',
  },
};

const output = JSON.stringify(result, null, 2);
if (reportPath) writeReport(reportPath, output, { protect: [file] });   // v18.12.0（L-50）：同文件 → exit 10
else console.log(output);

process.exit(exitCode);