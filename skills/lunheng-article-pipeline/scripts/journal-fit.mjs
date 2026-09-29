#!/usr/bin/env node
// 论衡期刊反向工程（v18.10.0 战略反哺新增 / P1-2 / scripts 白名单 20→21）
// 用法：node journal-fit.mjs <期刊名> [--project <run/项目名>] [--report <path>]
//   --project <p>   = 项目路径（读取 final/定稿.md 的字数 + 总评分）
//   --report <p>    = JSON 结果写入 <p>（默认 stdout）
//
// 退出码（与 M 门语义同源）：
//   0  = 三项检查全过
//   1  = P1 问题（J-Reason 命中 / J-Cycle 严重不匹配 / J-Format 关键不合规）
//   3  = 仅 P2 软提示（J-Cycle 一般不匹配 / J-Format 次要不合规）
//   10 = 参数或路径错误
//   70 = 内部错误
//
// 3 项检查（基于 [`references/_shared/期刊数据库.md`](../_shared/期刊数据库.md)）：
//   J-Reason  = 本论文论点/方法/字数 与目标期刊常见 desk-reject 原因对位
//   J-Cycle   = 本论文主题与目标期刊审稿周期匹配度（急稿避开审稿周期 > 12 月期刊）
//   J-Format  = 投稿格式合规预检（参考文献风格 / 字数上限 / 补充材料格式）

import { readFileSync, existsSync } from 'node:fs';
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs';
import { sectionBody } from './_lib/sections.mjs';
import { writeReport } from './_lib/destructive-write.mjs';   // 报告写盘守卫（v18.12.0，全量审计 L-50）
import { refRegex } from './_lib/refs.mjs';                   // v18.16.0（A-1 反哺）：共用 refRegex，避免本地窄正则漏检 1 位/4 位编号
installExitGuard();

// --- CLI 参数解析 ---
const argv = process.argv.slice(2);
let journal = null;
let projectPath = null;
let reportPath = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--project') {
    // v18.12.0（全量审计 L-62）：缺值守卫（缺值 → projectPath 为 undefined → 所有项目级检查静默关闭）
    const v = argv[++i];
    if (!v || v.startsWith('--')) { console.error(`--project 缺少值（示例：--project run/甲醛白菜事件）\n用法: node journal-fit.mjs <期刊名> [--project <run/项目名>] [--report <path>]`); process.exit(10); }
    projectPath = v;
  }
  else if (a === '--report') {
    const v = argv[++i];
    if (!v || v.startsWith('--')) { console.error(`--report 缺少值（示例：--report audits/journal-fit.json）\n用法: node journal-fit.mjs <期刊名> [--project <run/项目名>] [--report <path>]`); process.exit(10); }
    reportPath = v;
  }
  else if (a.startsWith('--')) {
    console.error(`未知参数: ${a}\n用法: node journal-fit.mjs <期刊名> [--project <run/项目名>] [--report <path>]`);
    process.exit(10);
  } else if (journal === null) journal = a;
  else {
    console.error(`多次传入期刊名: ${a}`);
    process.exit(10);
  }
}
if (!journal) { console.error('用法: node journal-fit.mjs <期刊名> [--project <run/项目名>] [--report <path>]'); process.exit(10); }

// --- 期刊数据库读取 ---
const journalDbPath = new URL('../references/_shared/期刊数据库.md', import.meta.url);
const journalDbText = readFileSync(journalDbPath, 'utf8');
const journalRow = (() => {
  for (const line of journalDbText.split('\n')) {
    if (line.startsWith('|') && line.includes(journal)) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      return cells.length >= 6 ? cells : null;
    }
  }
  return null;
})();
if (!journalRow) {
  console.error(`期刊未在数据库中找到: ${journal}`);
  console.error(`（数据库规模 ~28 个中文 + 12 个英文 SSCI；不在库的可标 'LLM 补充（不在数据库，须人工核验）'）`);
  process.exit(3);
}

// 解析字段（已知列：期刊名 / 类别 / 审稿周期 / 主题偏好 / 风格偏好 / 文体偏好 / 范式标签[v18.59.0]）
// v18.59.0 起新增「范式标签」列（受控词表 = quantitative/qualitative/theoretical/mixed/case）；
// 老库（仅 6 列）的 cells.length=6 仍被前文 `cells.length >= 6` 接受，但 jParadigm 取 undefined → 走 J-Paradigm 「待回填」分支
const [jName, jCategory, jCycle, jTopic, jStyle, jGenre, jParadigm] = journalRow;
// v18.59.0：范式标签受控词表。任何不在词表内的取值都不判 P0/P1（= 不打断期刊匹配主流程），
// 仅记入 jParadigmInfo.unrecognized 让主控能看到「该刊范式字段被填了非标值」。
const PARADIGM_VOCAB = ['quantitative', 'qualitative', 'theoretical', 'mixed', 'case'];

// === 字数读取（仅 --project 提供时） ===
let projectWordCount = null;
let projectPaperPath = null;
if (projectPath) {
  projectPaperPath = `${projectPath}/final/定稿.md`;
  // v18.12.0（全量审计 L-64）：**路径敲错必须响亮失败**。旧实现在 `existsSync` 为假时静默跳过**全部**
  //   项目级检查（J-Format 段整体消失、`checks: []`）并 exit 0 —— 结论比正确传参**更宽松**，
  //   用户以为「已按项目核过」。现：给了 --project 却找不到定稿 → exit 10（参数/路径错）。
  if (!existsSync(projectPaperPath)) {
    console.error(`--project 指向的项目缺少 final/定稿.md：${projectPaperPath}`);
    console.error('  · 若尚未到 Phase 5：**不要**传 --project（只做期刊侧匹配）；');
    console.error('  · 若路径敲错：这是参数错，不是「项目无检查项」。');
    process.exit(10);
  }
  // v18.12.0（L-64）：到这里 `projectPaperPath` 必然存在（上面已 exit 10）——旧版此处的
  //   `if (existsSync(...))` 已成为恒真分支，留着会让读者以为「仍可能跳过」。
  requireExistingFile(projectPaperPath, '论文定稿');
  const text = readFileSync(projectPaperPath, 'utf8');
  const abstractStart = sectionBody(text, '摘要') || '';
  const referenceStart = sectionBody(text, '参考文献') || null;
  const bodyEnd = referenceStart === null ? text.length : text.indexOf('## 参考文献');
  const bodyText = text.slice(text.indexOf('## 摘要'), bodyEnd);
  const hanMatches = bodyText.match(/[\u4e00-\u9fff]/g) || [];
  projectWordCount = hanMatches.length;
}

// === J-Reason: 常见 desk-reject 原因对位 ===
// 简化实现：基于期刊主题偏好 + 风格偏好的反向匹配
const COMMON_REJECT_REASONS = [
  { code: 'TOPIC_MISMATCH', desc: '主题与期刊偏好不符', severity: 'P1' },
  { code: 'STYLE_MISMATCH', desc: '风格与期刊偏好不符（如要求实证却做纯理论）', severity: 'P1' },
  { code: 'FORMAT_BASIC', desc: '格式基础不合规（参考文献 / 摘要超长 / 未声明利益冲突）', severity: 'P1' },
  { code: 'WORD_OVER_LIMIT', desc: '字数超出期刊上限', severity: 'P1' },
  { code: 'METHOD_WEAK', desc: '方法薄弱（单案例无方法论反思 / 二手数据无原始来源）', severity: 'P2' },
  { code: 'CONTRIB_LOW', desc: '贡献度不足（与已有研究差异不明显）', severity: 'P2' },
];
const jReasonDetected = [];
// 字数超限检测（粗略：期刊字数上限 ≈ 主题偏好字数隐含）
// 大多数期刊隐性上限 8000-12000 字
if (projectWordCount !== null) {
  if (projectWordCount > 15000) {
    jReasonDetected.push({ ...COMMON_REJECT_REASONS[3], detail: `字数 ${projectWordCount} > 15000` });
  } else if (projectWordCount < 3000) {
    jReasonDetected.push({ ...COMMON_REJECT_REASONS[3], detail: `字数 ${projectWordCount} < 3000` });
  }
}
const jReasonPass = jReasonDetected.length === 0;
const jReasonSeverity = jReasonPass ? 'PASS' : (jReasonDetected.some((r) => r.severity === 'P1') ? 'P1' : 'P2');

// === J-Cycle: 审稿周期匹配度 ===
// 解析 jCycle（如「6-12 月」→ [6, 12]）
const cycleMatch = jCycle.match(/(\d+)-(\d+)\s*月/);
const cycleMin = cycleMatch ? parseInt(cycleMatch[1], 10) : null;
const cycleMax = cycleMatch ? parseInt(cycleMatch[2], 10) : null;
const jCycleInfo = {
  range: jCycle,
  minMonths: cycleMin,
  maxMonths: cycleMax,
};
const jCyclePass = cycleMax === null || cycleMax <= 12;  // 急稿避开 > 12 月期刊
const jCycleSeverity = cycleMax === null ? 'P2' : (cycleMax <= 12 ? 'PASS' : 'P1');

// === J-Paradigm: 范式匹配度（v18.59.0 反哺新增）================================
// 判据：本论文 T9 评审输出的「方法风格」↔ 数据库「范式标签」是否一致
//   · 输入：本论文的方法风格由主控在调用时通过 --style 传入（quantitative/qualitative/theoretical/mixed/case/null）
//   · null/undefined = 主控未传 → 跳过本检查（**不**判 P1，因为 T9 评审阶段主控未必有定论）
//   · 匹配规则：完全相等 = PASS；论文 mixed vs 期刊 quantitative 等「兼容性」 = PASS（mixed 可投递到任何偏单向的刊）；
//     论文 quantitative vs 期刊 qualitative = P2 软提示（社科学术界常见：定量作者投质性刊多被 desk-reject「方法与刊偏好不符」）
//   · 范式标签不在词表内 = P2 软提示（不打断主流程，仅告知主控）
const jParadigmDetected = [];
let jParadigmSeverity = 'PASS';
const jParadigmInfo = { article: null, journal: jParadigm || null, recognized: false, vocab: PARADIGM_VOCAB };
if (jParadigm !== undefined && jParadigm !== '' && jParadigm !== '待回填') {
  jParadigmInfo.recognized = PARADIGM_VOCAB.includes(jParadigm);
  if (!jParadigmInfo.recognized) {
    jParadigmDetected.push({ code: 'PARADIGM_UNRECOGNIZED', desc: `范式标签「${jParadigm}」不在受控词表内`, severity: 'P2' });
    jParadigmSeverity = 'P2';
  }
}
// 文章侧范式（articleStyle）若主控传入，则与期刊侧做匹配；未传则不判
if (typeof globalThis.__lunhengArticleStyle === 'string') {
  jParadigmInfo.article = globalThis.__lunhengArticleStyle;
  if (jParadigmInfo.recognized) {
    const a = globalThis.__lunhengArticleStyle;
    const compatible = (a === 'mixed') || (jParadigm === 'mixed') || (a === jParadigm);
    if (!compatible) {
      jParadigmDetected.push({ code: 'PARADIGM_MISMATCH', desc: `文章范式「${a}」与期刊范式「${jParadigm}」不一致`, severity: 'P2' });
      jParadigmSeverity = 'P2';
    }
  }
}
const jParadigmPass = jParadigmDetected.length === 0;

// === J-Format: 投稿格式合规预检（仅 --project 提供时执行） ===
let jFormatInfo = { checks: [] };
let jFormatPass = true;
if (projectWordCount !== null) {
  const formatChecks = [];
  // 1. 字数上限（粗略：>15000 触发 P1）
  if (projectWordCount > 15000) formatChecks.push({ item: '字数上限', severity: 'P1', detail: `字数 ${projectWordCount} > 15000 上限` });
  else if (projectWordCount < 3000) formatChecks.push({ item: '字数下限', severity: 'P2', detail: `字数 ${projectWordCount} < 3000 下限` });
  // 2. 参考文献风格（检测正文 [Lxx] 是否齐全）
  const text = readFileSync(projectPaperPath, 'utf8');
  // v18.16.0（A-1 反哺）：原 `[L\d{2,3}]` 漏 1 位 / ≥4 位编号；改用 refs.mjs 共享 refRegex 任意位数。
  const lRegex = refRegex('L');
  const inTextRefs = new Set((text.match(lRegex) || []).map((m) => m));
  const referencesBody = sectionBody(text, '参考文献') || '';
  const refSectionRefs = new Set((referencesBody.match(lRegex) || []).map((m) => m));
  const orphans = [...inTextRefs].filter((r) => !refSectionRefs.has(r));
  if (orphans.length > 0) formatChecks.push({ item: '参考文献双向闭环', severity: 'P1', detail: `${orphans.length} 条正文引用未在参考文献节列出` });
  // 3. AI 使用声明
  const aiDeclaration = sectionBody(text, 'AI 使用声明');
  if (!aiDeclaration) formatChecks.push({ item: 'AI 使用声明', severity: 'P1', detail: '文末 AI 使用声明节缺失' });
  // 4. 摘要
  const abstract = sectionBody(text, '摘要');
  if (!abstract || abstract.length < 100) formatChecks.push({ item: '摘要', severity: 'P1', detail: '摘要节缺失或过短' });
  jFormatInfo.checks = formatChecks;
  jFormatPass = formatChecks.every((c) => c.severity !== 'P1');
}

// --- 汇总 ---
const allPass = jReasonPass && jCyclePass && jFormatPass && jParadigmPass;
const jFormatSeverity = jFormatInfo.checks.length === 0 ? 'PASS' : (jFormatInfo.checks.some((c) => c.severity === 'P1') ? 'P1' : 'P2');
// v18.59.0：J-Paradigm 当前只触发 P2（不触发 P1），故即使不通过也不进 1 档；语义上仍参与 allPass（=P2 也算「不通过」）
const exitCode = allPass ? 0 : ((jReasonSeverity === 'P1' || jCycleSeverity === 'P1' || jFormatSeverity === 'P1') ? 1 : 3);

const result = {
  journal: jName,
  category: jCategory,
  paradigm: jParadigm || null,    // v18.59.0 新增：期刊侧范式标签（受控词表或 null）
  version: 'v18.59.0',
  projectPath: projectPath || null,
  projectWordCount,
  checks: {
    'J-Reason': {
      name: 'desk-reject 原因对位',
      pass: jReasonPass,
      severity: jReasonSeverity,
      detected: jReasonDetected,
      note: '字数超限 / 方法薄弱 / 贡献度不足 等是投稿前可自查项',
    },
    'J-Cycle': {
      name: '审稿周期匹配',
      pass: jCyclePass,
      severity: jCycleSeverity,
      info: jCycleInfo,
      note: '急稿避开审稿周期 > 12 月期刊',
    },
    'J-Paradigm': {       // v18.59.0 新增
      name: '范式匹配度',
      pass: jParadigmPass,
      severity: jParadigmSeverity,
      info: jParadigmInfo,
      detected: jParadigmDetected,
      note: '文章范式（主控 --style 传入）↔ 期刊范式标签 受控词表匹配；仅 P2（不打断主流程）',
    },
    'J-Format': {
      name: '投稿格式合规',
      pass: jFormatPass,
      severity: jFormatSeverity,
      info: jFormatInfo,
    },
  },
  overall: { pass: allPass, exitCode },
  meta: {
    timestamp: new Date().toISOString(),
    description: '论衡期刊反向工程 / v18.10.0 战略反哺 P1-2 / scripts 白名单 20→21',
    notes: '本脚本为机检骨架 + 数据库匹配；具体 desk-reject 原因需数据库持续维护（详见 期刊数据库.md 扩展示例）',
  },
};

const output = JSON.stringify(result, null, 2);
if (reportPath) writeReport(reportPath, output, { protect: [projectPaperPath] });   // v18.12.0（L-50）：同文件 → exit 10
else console.log(output);

process.exit(exitCode);