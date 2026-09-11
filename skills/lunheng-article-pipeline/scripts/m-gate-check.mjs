// 论衡 M 门机械化预检脚本（v2.5.2-dsh 补丁 + v2.5.2-dsh.5 重大增强 + v2.5.2-dsh.16 加图件闭环）
//   v2.5.2-dsh:   M-Form-1/3/5/7 + M-Exist-2 纯正则/哈希判定
//   v2.5.2-dsh.5: M 门全脚本化（T8 仅复核 M-Form-8 承重墙质量 + M-Integrity 跨文件判断）
//   v2.5.2-dsh.16: 新增 M-Form-9 图件闭环（[图N] ↔ final/图件/ ↔ 图上数字）→ M 门 16 项（脚本 13 项 + M-Integrity-2 主控）
// 用法: node m-gate-check.mjs <final/定稿.md> <final/证据包目录> [--summary] [--fig-dir <图件目录>] [--report <path>]
//   --summary：仅输出聚合统计（total/pass/p0/p1/p2/soft/skips）+ 硬失败项；省略通过项 details[]（省 ~80% 输出字节，机器可读友好）
//   --fig-dir：图件目录（缺省自动推 <定稿目录>/图件）
// 配套：M-Gate-Algorithm.md「机械化脚本化」段
// 严重度评级（v2.5.2-dsh.5 引入）：gate fail 时按 P0/P1/P2 分级；单子项失败子项数 ≤2 → P2 可放行
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { refsOf, dataCardIds } from './_lib/refs.mjs';                 // 引用编号口径真源
import { TRUST_COMPLIANT_RE, TRUST_LOOSE_RE } from './_lib/trust.mjs'; // 信任级别口径真源
import { splitCard } from './_lib/cards.mjs';                          // 卡片切块口径真源
import { analyzeSvg, svgTextNumbers, figureNoOf, figurePlaceholders } from './_lib/svg.mjs'; // SVG 图件口径真源

const args = process.argv.slice(2);
const wantSummary = args.includes('--summary');
// --fig-dir <dir>：图件目录（缺省从定稿路径推 final/图件，v2.5.2-dsh.16 新增）
const figDirIdx = args.indexOf('--fig-dir');
const figDirArg = figDirIdx >= 0 && args[figDirIdx + 1] ? args[figDirIdx + 1] : null;
if (figDirIdx >= 0 && !figDirArg) { console.error('--fig-dir 缺少值'); process.exit(10); }
// --report <path>：把结构化报告落盘（供 build-evidence-bundle / T8 审计视图读取，v2.5.2-dsh.13 新增）
const reportIdx = args.indexOf('--report');
const reportPath = reportIdx >= 0 && args[reportIdx + 1] ? args[reportIdx + 1] : null;
// 只有当 --report 真出现时才排除它的取值（v2.5.2-dsh.13 修复：reportIdx=-1 时 reportIdx+1=0
// 会把第一个位置参数「定稿路径」也排除掉 → 不带 --report 时必然报用法错误；
// 而 final-check.mjs 正是不带 --report 调用本脚本）
const flagValueIdx = new Set([
  ...(reportIdx >= 0 ? [reportIdx + 1] : []),
  ...(figDirIdx >= 0 ? [figDirIdx + 1] : []),
]);
const positional = args.filter((a, i) => !a.startsWith('--') && !flagValueIdx.has(i));
const draftPath = positional[0];
const evDir = positional[1];
if (!draftPath || !evDir) {
  console.error('用法: node m-gate-check.mjs <定稿.md> <证据包目录> [--summary] [--report <path>]');
  process.exit(10);   // 10 = 参数/路径错误（与「1 = P1 内容失败」区分，v2.5.2-dsh.13）
}
if (!existsSync(draftPath)) {
  console.error(`定稿不存在: ${draftPath} —— 请先产出 final/定稿.md 再跑 M 门预检`);
  process.exit(1);
}
if (!existsSync(evDir)) {
  console.error(`证据包目录不存在: ${evDir} —— 请先收集证据包再跑 M 门预检`);
  process.exit(1);
}

const text = readFileSync(draftPath, 'utf8');
const results = [];

// === v2.5.2-dsh.5 修订：白名单 5 节 + AI 使用声明（M-Form-2 / M-Form-7 一致）===
const WHITELIST = ['参考文献', '数据来源', '案例来源', '先行者文献', 'AI 使用声明'];

// 引用编号正则：支持 [Lxx]/[Dxx]/[Cxx]/[C-主xx]/[先xx]，可带版本后缀
const refRe = /\[(L|D|C-主|C|先)\d+(?:(?:-v| v)\d+)?\]/g;
const norm = (r) => r.replace(/(?:-v| v)\d+\]/, ']');

// 解析所有 ## 标题及其位置
const h2Matches = [...text.matchAll(/^##\s+(.+)$/gm)];
const h2s = h2Matches.map((m) => m[1].trim());
const firstIdx = h2s.findIndex((t) => WHITELIST.some((w) => t === w || t.startsWith(w)));
const firstEnd = firstIdx >= 0 ? h2Matches[firstIdx].index : -1;

// === M-Form-2 文末 5 节存在性（v2.5.2-dsh.5 修订：与 M-Form-7 一致）===
const missingSections = WHITELIST.filter((s) => !h2s.some((h) => h === s || h.startsWith(s)));
results.push({
  gate: 'M-Form-2 文末四节存在性',
  pass: missingSections.length === 0,
  detail: missingSections.length ? `缺失: ${missingSections.join(',')}` : '5 节齐全',
  severity: missingSections.length > 0 ? 'P0' : '通过',
});

// === M-Form-7 文末节白名单纯净 ===
let mform7Violations = [];
if (firstIdx === -1) mform7Violations = ['文末无任何白名单节'];
else mform7Violations = h2s.slice(firstIdx).filter((t) => !WHITELIST.some((w) => t === w || t.startsWith(w)));
results.push({
  gate: 'M-Form-7 文末白名单',
  pass: mform7Violations.length === 0,
  detail: mform7Violations.length ? `违规节: ${mform7Violations.join(',')}` : '全白名单',
  severity: mform7Violations.length > 0 ? 'P0' : '通过',
});

// 计算正文和文末区段
const body = firstEnd >= 0 ? text.slice(0, firstEnd) : text;
const endnote = firstEnd >= 0 ? text.slice(firstEnd) : '';

// === M-Form-1 引用标注完整性（v2.5.2-dsh.5 修订：阈值提升 L≥3）===
const bodyRefs = body.match(refRe) || [];
const L_count = refsOf(body, 'L').length;
const min_L = 3;
let mform1Pass, mform1Detail, mform1Severity;
if (bodyRefs.length === 0) {
  mform1Pass = false;
  mform1Detail = '正文无任何引用标注';
  mform1Severity = 'P0';
} else if (L_count === 0) {
  mform1Pass = false;
  mform1Detail = `学术深度论文文献 [Lxx] = 0（实测 ${bodyRefs.length} 引用全无 L，旧算法阈值过低放过——v2.3.7 §四 P4 L=0 漏检根因）`;
  mform1Severity = 'P0';
} else if (L_count < min_L) {
  mform1Pass = false;
  mform1Detail = `学术深度论文文献 [Lxx] < ${min_L}（实测 L=${L_count}），需补检索加固`;
  mform1Severity = 'P0';
} else {
  mform1Pass = true;
  mform1Detail = `正文引用 ${bodyRefs.length} 处（L ${L_count}，阈值 ≥${min_L}）`;
  mform1Severity = '通过';
}
results.push({ gate: 'M-Form-1 引用标注完整性', pass: mform1Pass, detail: mform1Detail, severity: mform1Severity });

// === M-Form-3 临时编号残留（v2.5.2-dsh.5 修订：联动 M-Form-2 跳过）===
if (firstIdx === -1) {
  results.push({ gate: 'M-Form-3 临时编号残留', pass: 'SKIP', detail: '文末缺失，M-Form-2 失败优先；M-Form-3 跳过防误判', severity: 'SKIP' });
} else {
  const endRefs = new Set((endnote.match(refRe) || []).map(norm));
  const orphan = [...new Set(bodyRefs.map(norm))].filter((r) => !endRefs.has(r));
  results.push({
    gate: 'M-Form-3 临时编号残留',
    pass: orphan.length === 0,
    detail: orphan.length ? `孤儿编号: ${orphan.join(',')}` : '无孤儿',
    severity: orphan.length > 10 ? 'P0' : (orphan.length > 3 ? 'P1' : (orphan.length > 0 ? 'P2' : '通过')),
  });
}

// === M-Form-5 过程语言残留（v2.5.2-dsh.5 扩禁词清单：弱 AI 痕；v2.5.2-dsh.9 扩内部流程词）===
const bannedBanned = /v\d+ 稿|初稿|草稿|修订说明|上一版|下一版|(?<!板)卡级|修卡|承重墙|承重案例|批注|待回查|审计环节|流水线|将在[^，。\n]{0,8}订正/g;
const estRe = /据行业经验估算/g;
const weakAITrend = /据可靠来源|据悉|据了解|研究显示|专家表示/g;
const hits = (body.match(bannedBanned) || []);
const estHits = [...body.matchAll(estRe)].filter((m) => !body.slice(Math.max(0, m.index - 60), m.index + m[0].length).includes('[行业估算'));
for (const e of estHits) hits.push(e[0]);
// 弱 AI 痕仅在上下文 200 字符内无 [Lxx]/[Dxx]/[Cxx] 时算违规
const weakAIHits = [];
for (const m of body.matchAll(weakAITrend)) {
  const start = Math.max(0, m.index - 200);
  const ctx = body.slice(start, m.index + m[0].length);
  if (!/\[(?:L|D|C)\d+\]/.test(ctx)) weakAIHits.push(m[0]);
}
for (const h of weakAIHits) hits.push(h);
results.push({
  gate: 'M-Form-5 过程语言残留',
  pass: hits.length === 0,
  detail: hits.length ? `命中: ${[...new Set(hits)].join(',')}` : '零命中',
  severity: hits.length > 5 ? 'P1' : (hits.length > 0 ? 'P2' : '通过'),
});

// === M-Form-4 元数据泄露（v2.5.2-dsh.5 重大修订：黑名单转白名单）===
const forPatternText = (() => {
  let t = body;
  const whitelists = [
    /\[(?:L|D|C-主|C|先)\d+\]/g,
    /\d{4}年|\d{1,2}月\d{1,2}日/g,
    /\d+\.?\d*%|\d+\.?\d*\s*(?:万|亿|个|条|项|位|倍|元|倍|成)/g,
    /[\u4e00-\u9fff]+(?:大学|学院|研究院|政府|机构|组织|部|委|局|司|办)/g,
    /AI Act|标识办法|GPT-?\d*|OpenAI|Claude/g,
  ];
  for (const pat of whitelists) t = t.replace(pat, '');
  return t;
})();
const forbiddenPatterns = [
  /T[0-9] (主控|文献|数据|分析|写手|审计|案例|批判|审稿)/g,
  /((?<!自)主控|文献检索员|数据检索员|分析员|写手|批判伙伴|审计员|审稿人|案例检索员)/g,
  /论衡 (agent|流水线|技能|主控|测试轮)/g,
  /角色卡|任务书|六要素|交接报告|反哺报告|教训 #?\d+|Phase [0-9.]+/g,
  /批 v?\d+ 稿|初稿|草稿|定稿/g,
  /输入材料|输出材料|任务简报第 ?\d+ ?行|修订说明-?v?\d+|scripts\//g,
  /m-gate-check\.mjs|consistency-check\.mjs|count-chars\.mjs/g,
  /\bsubagent\b|\bforeground\b|\bbackground\b|\bsubagent_fork\b/g,
];
const leakHits = [];
for (const pat of forbiddenPatterns) {
  const m = forPatternText.match(pat);
  if (m) leakHits.push(...m);
}
results.push({
  gate: 'M-Form-4 元数据泄露',
  pass: leakHits.length === 0,
  detail: leakHits.length ? `命中: ${[...new Set(leakHits)].slice(0, 5).join(',')}` : '正文无内部代码（白名单剥离后）',
  severity: leakHits.length > 5 ? 'P0' : (leakHits.length > 0 ? 'P1' : '通过'),
});

// === M-Form-6 信任级别（v2.5.2-dsh.5 扩字段：双格式 + 描述字段交叉验证）===
let dataCard = '';
try { dataCard = readFileSync(join(evDir, '数据卡.md'), 'utf8'); } catch {}
if (dataCard) {
  const uniqueDataIds = dataCardIds(text);
  const trustLevelMiss = [];
  const trustLevelDescOnly = [];
  for (const id of uniqueDataIds) {
    // v3 实际格式：### [Dxx] 标题（三级标题）| 数据卡.md 一级 # + [Dxx] 行内（v3 头部）
    const card = splitCard(dataCard, id);
    if (!card) { trustLevelMiss.push(`D${id}(整段缺失)`); continue; }
    const section = card.body;
    const hasStdTrust = TRUST_COMPLIANT_RE.test(section);
    const hasDescTrust = TRUST_LOOSE_RE.test(section);
    if (!hasStdTrust) {
      if (hasDescTrust) {
        trustLevelDescOnly.push(`D${id}`);
      } else {
        trustLevelMiss.push(`D${id}`);
      }
    }
  }
  let mform6Pass, mform6Detail, mform6Severity;
  if (trustLevelMiss.length === 0 && trustLevelDescOnly.length === 0) {
    mform6Pass = true;
    mform6Detail = `${uniqueDataIds.length} 条数据卡均标独立信任级别段`;
    mform6Severity = '通过';
  } else if (trustLevelMiss.length > 0) {
    mform6Pass = false;
    mform6Detail = `独立段缺失: ${trustLevelMiss.slice(0, 5).join(',')}${trustLevelDescOnly.length ? `; 描述字段仅有: ${trustLevelDescOnly.slice(0, 3).join(',')}` : ''}`;
    mform6Severity = trustLevelMiss.length > 5 ? 'P0' : (trustLevelMiss.length > 2 ? 'P1' : 'P2');
  } else {
    mform6Pass = false;
    mform6Detail = `独立段缺失（描述字段仅提及）: ${trustLevelDescOnly.slice(0, 5).join(',')}（P2：建议统一迁移到独立段，防描述改写后失锚）`;
    mform6Severity = 'P2';
  }
  results.push({ gate: 'M-Form-6 信任级别', pass: mform6Pass, detail: mform6Detail, severity: mform6Severity });
} else {
  results.push({ gate: 'M-Form-6 信任级别', pass: false, detail: '数据卡.md 不在证据包', severity: 'P0' });
}

// === M-Form-8 三角验证（v2.5.2-dsh.5 修订：每论点强制含 L + coverage ≥ 2）===
let mform8Findings = { L_missing: 0, weak: 0, total: 0, details: [] };
try {
  // v2.5.2-dsh.5 修复：排除前置/收尾非论点段（摘要/关键词/引言/结语）——摘要与引言天然不引 [Lxx]
  // （引言以 [先xx] 声明原创性差异点，属论衡原创性机制而非论点论证），之前把「摘要」当正文段查 [Lxx] 导致恒 P0 误报。
  const FRONT_BACK = ['摘要', '关键词', '引言', '结语', '结论', '展望'];
  const sections = body.split(/^##\s+/m).filter((s) => s.trim().length > 0);
  for (const sec of sections.slice(0, 20)) {
    if (sec.length < 100) continue;
    const secTitle = sec.split('\n')[0].trim();
    const titleNorm = secTitle.replace(/^[0-9一二三四五六七八九十]+\s*[、.．:：\s]+/u, '').replace(/[：:].*$/u, '').trim();
    if (FRONT_BACK.some((t) => titleNorm === t || titleNorm.startsWith(t) || titleNorm.includes(t))) continue;
    mform8Findings.total++;
    const hasL = /\[L\d+\]/.test(sec);
    const hasD = /\[D\d+\]/.test(sec);
    const hasC = /\[C\d+\]/.test(sec);
    const cov = (hasL ? 1 : 0) + (hasD ? 1 : 0) + (hasC ? 1 : 0);
    if (!hasL) { mform8Findings.L_missing++; mform8Findings.details.push(`段缺[Lxx]: ${sec.split('\n')[0].slice(0, 30)}`); }
    if (cov < 2) mform8Findings.weak++;
  }
  let mform8Pass = (mform8Findings.L_missing === 0 && mform8Findings.weak === 0);
  let mform8Severity = mform8Pass ? '通过' : (mform8Findings.L_missing > 0 ? 'P0' : 'P1');
  results.push({
    gate: 'M-Form-8 三角验证',
    pass: mform8Pass,
    detail: `${mform8Findings.total} 段：${mform8Findings.L_missing} 段缺 L，${mform8Findings.weak} 段覆盖 <2 类${mform8Findings.details.length ? `（${mform8Findings.details.slice(0, 3).join('; ')}）` : ''}`,
    severity: mform8Severity,
  });
} catch (e) {
  results.push({ gate: 'M-Form-8 三角验证', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Form-9 图件闭环（v2.5.2-dsh.16 新增）：[图N] 图位 ↔ final/图件/ ↔ 图上数字 三方对账 ===
// 背景（第三方 SVG 链路审计）：T5 卡宣称「T7 跑 M-Gate 算法检查 [图N] 出现次数 ≥ 拍板图位数量 → P0 拦截」，
// 但 M 门 16 项里**没有任何图项**、T7 速查表 0 处提及「图」、证据包不收图件 → 该条文无落地路径。
// 本项即该条文的机械落地：缺图/图位不足 → 硬失败；孤儿图件/数字对不上 → 软提示（数字对账为启发式）。
// 未启用配图（无图位且无图件目录）→ 记 N/A 且 pass=true（不得因「没配图」把 M 门判失败——配图默认关闭）。
try {
  const figDirDefault = join(dirname(draftPath), '图件');
  const figDir = figDirArg && existsSync(figDirArg) ? figDirArg : (existsSync(figDirDefault) ? figDirDefault : null);
  const figNos = figurePlaceholders(text);
  const files = figDir ? readdirSync(figDir).filter((f) => f.toLowerCase().endsWith('.svg')) : [];
  const fileNos = new Map();
  for (const f of files) { const n = figureNoOf(f); if (n !== null && !fileNos.has(n)) fileNos.set(n, f); }
  // 图位数量对账（拍板数取自任务简报，best-effort 解析；解析不到则不判，避免误 P0）
  let pledged = 0, pledgedFrom = '';
  try {
    const briefPath = draftPath.replace(/final[\\/]定稿\.md$/, '01-任务简报.md');
    if (existsSync(briefPath)) {
      const b = readFileSync(briefPath, 'utf8');
      const m1 = b.match(/(?:图位|图表)数量\s*[:：]\s*(\d+)/);
      const m2 = b.match(/拍板[^\n。]{0,20}?(\d+)\s*(?:张|个|幅)图/);
      pledged = Number((m1 && m1[1]) || (m2 && m2[1]) || 0);
      if (pledged) pledgedFrom = m1 ? '简报「图位数量」' : '简报「拍板 N 张图」';
    }
  } catch { /* 简报缺失或不可读 → 不判 */ }

  if (figNos.size === 0 && fileNos.size === 0) {
    results.push({
      gate: 'M-Form-9 图件闭环',
      pass: true,
      detail: 'N/A：未启用配图（正文无 [图N] 图位、final/图件/ 不存在）——本项不适用，不算通过也不判失败',
      severity: '通过',
    });
  } else {
    const problems = [];
    const softNotes = [];
    // ① 缺图：正文有图位但无对应图件
    const missingFigs = [...figNos].filter((n) => !fileNos.has(n));
    // ② 图位不足：拍板数 > 正文图位数
    const shortage = pledged > 0 && figNos.size < pledged;
    // ③ 孤儿图件
    const orphanFigs = [...fileNos.keys()].filter((n) => !figNos.has(n));
    // ④ SVG 良构 / 安全
    if (figDir) {
      for (const [n, f] of fileNos) {
        const a = analyzeSvg(readFileSync(join(figDir, f), 'utf8'));
        if (!a.ok) problems.push(`图${n}(${f}) 结构不合格: ${a.problems.join('；')}`);
        if (a.warnings.length) softNotes.push(`图${n}(${f}) 告警: ${a.warnings.join('；')}`);
      }
      // ⑤ 图上数字 ⊆ 数据卡 ∪ 正文（启发式：仅查 <text>/<tspan>/<title> 文本节点，跳过单字符刻度）
      const unionRaw = dataCard + '\n' + text;
      const union = unionRaw + '\n' + unionRaw.replace(/(\d),(?=\d{3}\b)/g, '$1');
      for (const [n, f] of fileNos) {
        const nums = svgTextNumbers(readFileSync(join(figDir, f), 'utf8'));
        const unmatched = [...nums.keys()].filter((t) => t.length >= 2 && !union.includes(t));
        if (unmatched.length) {
          softNotes.push(`图${n} 图上数字 ${unmatched.slice(0, 5).join(',')}${unmatched.length > 5 ? ` 等 ${unmatched.length} 个` : ''} 在数据卡/正文中找不到出处（启发式：可能为刻度或坐标，请人工确认）`);
        }
      }
    }
    if (missingFigs.length) problems.push(`缺图：正文标了图位但 final/图件/ 无对应文件 → 图${missingFigs.join('、图')}（期望 图N_标题.svg）`);
    if (shortage) problems.push(`图位不足：${pledgedFrom} 记为 ${pledged} 张，正文仅 ${figNos.size} 个 [图N]（T5 卡「≥ 拍板数量」不满足）`);
    if (orphanFigs.length) softNotes.push(`孤儿图件：图${orphanFigs.join('、图')} 未被正文引用`);

    const hard = problems.length > 0;
    // 严重度：**图件全缺（有图位但一个图件都没有/目录不存在）**或缺失总数 >2 → P0；其余缺图 → P1
    const severity = !hard ? (softNotes.length ? 'P2' : '通过')
      : ((missingFigs.length > 0 && fileNos.size === 0) || missingFigs.length + (shortage ? 1 : 0) > 2 ? 'P0' : 'P1');
    results.push({
      gate: 'M-Form-9 图件闭环',
      pass: hard ? false : (softNotes.length ? false : true),
      detail: [
        `图位 ${figNos.size} 个 / 图件 ${fileNos.size} 个${figDir ? '' : '（无 final/图件/ 目录）'}`,
        problems.length ? `硬问题: ${problems.join('；')}` : '无缺图',
        softNotes.length ? `软提示: ${softNotes.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity,
    });
  }
} catch (e) {
  results.push({ gate: 'M-Form-9 图件闭环', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-1 文末四节双向对比（v2.5.2-dsh.5 脚本化 + 严重度评级）===
if (firstIdx === -1) {
  results.push({ gate: 'M-Exist-1 引用双向对比', pass: 'SKIP', detail: '文末缺失，M-Form-2 失败优先', severity: 'SKIP' });
} else {
  const intext = new Set((body.match(refRe) || []).map(norm));
  const endRefs2 = new Set((endnote.match(refRe) || []).map(norm));
  const leaked = [...intext].filter((r) => !endRefs2.has(r));
  const orphan2 = [...endRefs2].filter((r) => !intext.has(r));
  const mExist1Sev = leaked.length + orphan2.length > 10 ? 'P0' : (leaked.length + orphan2.length > 3 ? 'P1' : 'P2');
  results.push({
    gate: 'M-Exist-1 引用双向对比',
    pass: leaked.length === 0 && orphan2.length === 0,
    detail: `漏引 ${leaked.length} / 孤儿 ${orphan2.length}`,
    severity: (leaked.length === 0 && orphan2.length === 0) ? '通过' : mExist1Sev,
  });
}

// === M-Form-10 索引段完整性（v2.5.2-dsh.17 新增）===
// 依据：三张卡模板都写着「索引段编号必须与正文条目一一对应（**一致性自检可加**『索引编号 = 实际编号』校验）」，
//   而下游 T4/T5 的 token 优化恰恰依赖「先读索引段、按编号定位」——**索引缺条 = 静默漏卡**，
//   最终以「漏引 / 孤儿」（M-Form-3 / M-Exist-1）的形式在审计阶段才爆出来，返工代价最高。
// 本项即是模板自己邀请的那条校验：索引段 ↔ 正文条目 ↔ 头部声明条数 三者对账。
try {
  const projectDir = dirname(dirname(draftPath));   // <项目>/final/定稿.md → <项目>
  const CARDS = [
    ['文献卡.md', 'literature/文献卡.md'],
    ['数据卡.md', 'data/数据卡.md'],
    ['案例卡.md', 'cases/案例卡.md'],
  ];
  const findings = [];
  const softFindings = [];
  const notes = [];       // 仅备注，**不影响通过/严重度**（如 0 条场景导致的卡片缺失，是合法的）
  let checked = 0;
  for (const [name, rel] of CARDS) {
    let p = join(evDir, name);
    if (!existsSync(p)) {
      const alt = join(projectDir, rel);
      p = existsSync(alt) ? alt : null;
    }
    if (!p) { notes.push(`${name} 未找到（0 条场景或尚未进入检索阶段）`); continue; }
    checked++;
    const lines = readFileSync(p, 'utf8').split('\n');
    const s = lines.findIndex((l) => /^##\s*📇\s*索引段/.test(l));
    if (s === -1) { findings.push(`${name}: 缺「## 📇 索引段」标题`); continue; }
    let e = lines.findIndex((l, i) => i > s && /^##\s/.test(l));
    if (e === -1) e = lines.length;
    const indexBlock = lines.slice(s + 1, e).join('\n');
    const idxIds = new Set([...indexBlock.matchAll(/\[([LDC])(\d+)\]/g)].map((m) => m[1] + m[2]));
    const bodyIds = new Set();
    for (const l of lines) { const m = l.match(/^#{2,4}\s*\[([LDC])(\d+)\]/); if (m) bodyIds.add(m[1] + m[2]); }
    const missing = [...bodyIds].filter((x) => !idxIds.has(x));       // 索引缺条 → 下游漏卡（硬）
    const extra = [...idxIds].filter((x) => !bodyIds.has(x));         // 索引悬空（软）
    const thin = indexBlock.split('\n').filter((l) => {
      if (!/\[([LDC])\d+\]/.test(l)) return false;
      return l.replace(/\[([LDC])\d+\]/, '').replace(/[｜|\s\-—–:：·]/g, '').length < 6;  // 编号后信息量不足
    });
    if (missing.length) findings.push(`${name}: 索引段缺 ${missing.length} 条（${missing.slice(0, 5).join(',')}）→ 下游按索引定位会漏卡`);
    if (extra.length) softFindings.push(`${name}: 索引段有 ${extra.length} 个编号在正文无对应条目（${extra.slice(0, 5).join(',')}）`);
    if (thin.length) softFindings.push(`${name}: ${thin.length} 行索引信息量不足（需 编号 + 主题 + 支撑论点）`);
    const headN = readFileSync(p, 'utf8').match(/(?:总条数|合计)[^\d]{0,10}(\d+)\s*条/);
    if (headN && bodyIds.size && Number(headN[1]) !== bodyIds.size) {
      findings.push(`${name}: 头部声明 ${headN[1]} 条 ≠ 正文条目 ${bodyIds.size} 条（best-effort 解析头部声明）`);
    }
  }
  if (checked === 0) {
    results.push({ gate: 'M-Form-10 索引段完整性', pass: true, detail: `N/A：三张卡均未找到（${notes[0] || '尚未进入检索阶段'}）`, severity: '通过' });
  } else {
    const hard = findings.length > 0;
    results.push({
      gate: 'M-Form-10 索引段完整性',
      pass: !hard && softFindings.length === 0,
      detail: [
        `已查 ${checked} 张卡`,
        hard ? `硬问题：${findings.slice(0, 3).join('；')}` : '索引与正文编号一一对应',
        softFindings.length ? `软提示：${softFindings.slice(0, 2).join('；')}` : '',
        notes.length ? `备注：${notes.join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard ? (findings.length > 2 ? 'P0' : 'P1') : (softFindings.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Form-10 索引段完整性', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-4 审计条目闭环（v2.5.2-dsh.17 新增）===
// 依据：07 卡早已规定「打回修订必须附结构化修订任务书（编号/严重度/位置/动作/验收标准/关闭状态）」，
//   但**没有任何脚本校验**；且 dsh.17 引入复核报告后出现「关闭状态」**双真源**（审计报告表列 ↔ 复核报告）。
// 本项把该契约变成机检：结构完整 + 编号唯一 + 编号在审计↔复核之间双向闭环 + 初轮不得预填「已关闭」。
try {
  const projectDir2 = dirname(dirname(draftPath));
  const auditsDir = [join(projectDir2, 'audits'), join(dirname(draftPath), 'audits'), evDir].find((d) => existsSync(d)) || null;
  const latestOf = (prefix) => {
    if (!auditsDir) return null;
    const cands = readdirSync(auditsDir)
      .map((f) => ({ f, m: f.match(new RegExp(`^${prefix}-v(\\d+)\\.md$`)) }))
      .filter((x) => x.m).map((x) => ({ f: x.f, n: Number(x.m[1]) }))
      .sort((a, b) => b.n - a.n);
    return cands.length ? { path: join(auditsDir, cands[0].f), n: cands[0].n, name: cands[0].f } : null;
  };
  const audit = latestOf('审计报告');
  const review = latestOf('复核报告');
  const revNotes = existsSync(join(projectDir2, 'drafts'))
    ? readdirSync(join(projectDir2, 'drafts')).filter((f) => /^修订说明-.*\.md$/.test(f)) : [];

  if (!audit) {
    results.push({ gate: 'M-Exist-4 审计条目闭环', pass: true, detail: 'N/A：尚无审计报告（未进入 Phase 4）', severity: '通过' });
  } else {
    const text = readFileSync(audit.path, 'utf8');
    const isReject = /打回|必须修改清单|未通过/.test(text);
    const lines = text.split('\n');
    const hIdx = lines.findIndex((l) => /^#{2,4}\s*修订任务书/.test(l));
    const rows = [];
    let header = null;
    if (hIdx !== -1) {
      for (let i = hIdx + 1; i < lines.length; i++) {
        const l = lines[i];
        if (/^#{2,4}\s/.test(l)) break;
        if (!/^\s*\|/.test(l)) continue;
        const cells = l.split('|').slice(1, -1).map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue;   // 分隔行
        if (!header && cells.some((c) => c.includes('编号'))) { header = cells; continue; }
        if (header) rows.push(cells);
      }
    }
    const colOf = (kw) => (header || []).findIndex((h) => kw.test(h));
    const iId = colOf(/编号/), iSev = colOf(/严重度/), iLoc = colOf(/改哪里|位置/), iAct = colOf(/怎么改|动作/), iAcc = colOf(/验收/), iStat = colOf(/关闭状态|状态/);
    const findings = [];
    const soft = [];
    if (isReject) {
      if (hIdx === -1 || !header) findings.push('结论为「打回修订」但缺「## 修订任务书」段或表格表头');
      else if ([iId, iSev, iLoc, iAct, iAcc, iStat].some((x) => x === -1)) {
        findings.push(`修订任务书缺必需列（现表头：${header.join(' / ')}）——需含 编号/严重度/改哪里/怎么改/验收标准/关闭状态`);
      } else {
        const ids = [];
        for (const r of rows) {
          if (!r[iId] || /^\.+$/.test(r[iId])) continue;
          const id = r[iId].replace(/[`*]/g, '').trim();
          ids.push(id);
          if (!/^P[012][-\u2011]?[0-9A-Da-d]+/.test(id)) soft.push(`编号「${id}」不符合 P0-n / P1-n 约定`);
          for (const [idx, label] of [[iLoc, '改哪里'], [iAct, '怎么改'], [iAcc, '验收标准']]) {
            if ((r[idx] || '').replace(/[\s.。…-]/g, '').length < 4) findings.push(`${id} 的「${label}」列空缺或过于笼统`);
          }
          const st = (r[iStat] || '').trim();
          if (!/已关闭|未关闭|待复核/.test(st)) soft.push(`${id} 的关闭状态「${st}」非固定词（应为 已关闭/未关闭/待复核）`);
          if (!review && /已关闭/.test(st)) findings.push(`${id} 在**尚无复核报告**时即标「已关闭」——关闭状态真源是复核报告，初轮只能填「待复核」`);
        }
        const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
        if (dup.length) findings.push(`编号重复：${[...new Set(dup)].join(',')}——同报告内编号必须唯一（跨轮新增须续号，不得复用）`);
        if (ids.length === 0) soft.push('修订任务书表格无有效条目行');
        if (review) {
          const rid = new Set([...readFileSync(review.path, 'utf8').matchAll(/P[012][-\u2011]?[0-9A-Da-d]+/g)].map((m) => m[0].replace(/\u2011/g, '-')));
          const miss = [...new Set(ids)].filter((x) => !rid.has(x.replace(/\u2011/g, '-')));
          if (miss.length) findings.push(`复核报告 ${review.name} 未覆盖 ${miss.length} 个审计编号：${miss.slice(0, 5).join(',')}`);
        } else if (revNotes.length) {
          findings.push(`已有修订说明（${revNotes.length} 份）但缺同号复核报告——修订复核必须落盘 audits/复核报告-v${audit.n}.md`);
        }
      }
    }
    const hard = findings.length > 0;
    results.push({
      gate: 'M-Exist-4 审计条目闭环',
      pass: !hard && soft.length === 0,
      detail: [
        `审计报告 ${audit.name}${review ? ` ↔ 复核报告 ${review.name}` : '（无复核报告）'}`,
        isReject ? (header ? `任务书 ${rows.length} 行` : '结论为打回') : '结论非打回（无需任务书）',
        hard ? `硬问题：${findings.slice(0, 3).join('；')}` : '条目契约与闭环成立',
        soft.length ? `软提示：${soft.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard ? (findings.length > 2 ? 'P0' : 'P1') : (soft.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-4 审计条目闭环', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-2 证据包完整性 ===
const files = readdirSync(evDir).filter((f) => f.endsWith('.md')).map((f) => join(evDir, f));
const empty = files.filter((f) => statSync(f).size === 0);
results.push({
  gate: 'M-Exist-2 证据包完整性',
  pass: files.length > 0 && empty.length === 0,
  detail: `${files.length} 个 .md 文件` + (empty.length ? `，空文件: ${empty.map((f) => f.split(/[\\/]/).pop()).join(',')}` : '，均非空'),
  severity: (files.length === 0 || empty.length > 0) ? 'P0' : '通过',
});

// === M-Exist-3 信任级别一致性（v2.5.2-dsh.5 加严重度评级）===
let litCard = '', caseCard = '';
try { litCard = readFileSync(join(evDir, '文献卡.md'), 'utf8'); } catch {}
try { caseCard = readFileSync(join(evDir, '案例卡.md'), 'utf8'); } catch {}
if (dataCard) {
  const intextD = new Set((body.match(/\[D\d+\]/g) || []).map((s) => s.match(/\d+/)[0]));
  const cardD = new Set((dataCard.match(/\[D\d+\](?=[^\d])/g) || []).map((s) => s.match(/\d+/)[0]));
  const missing = [...intextD].filter((d) => !cardD.has(d));
  const mExist3Sev = missing.length > 5 ? 'P0' : (missing.length > 2 ? 'P1' : (missing.length > 0 ? 'P2' : '通过'));
  results.push({
    gate: 'M-Exist-3 信任级别一致性',
    pass: missing.length === 0,
    detail: missing.length ? `正文引 [Dxx] ${missing.length} 条在数据卡中无对应条目` : '全部 [Dxx] 在数据卡有对应',
    severity: mExist3Sev,
  });
} else {
  results.push({ gate: 'M-Exist-3 信任级别一致性', pass: false, detail: '数据卡不存在', severity: 'P0' });
}

// === M-Integrity-1 / M-Integrity-2 联动 ===
let briefData = { hasBrief: false, subclaims: 0, minDataPoints: 0, placeholder: 0 };
try {
  const briefPath = draftPath.replace(/final[\\/]定稿\.md$/, '01-任务简报.md');
  if (existsSync(briefPath)) {
    briefData.hasBrief = true;
    const briefText = readFileSync(briefPath, 'utf8');
    // 子问题编号兼容：「子问题 A/B/C」（v2.5.2-dsh.5 模板规范）∪「S1/S2」（v2.5.2-dsh.4 表格旧格式）
    const letterSub = [...briefText.matchAll(/子问题\s*([A-Z一二三四五六七八九十\d]+)/g)].map((m) => m[1]);
    const sSub = [...briefText.matchAll(/^[\s|]*S(\d+)\s/gm)].map((m) => `S${m[1]}`);
    briefData.subclaims = new Set([...letterSub, ...sSub]).size;
    // 需找数据点：已填数字「≥N」求和；占位符「≥____」单列计数（模板未填时如实提示，而非误报 0）
    briefData.minDataPoints = [...briefText.matchAll(/需找数据点\s*[≥>]\s*(\d+)/g)]
      .map((m) => parseInt(m[1], 10)).reduce((a, b) => a + b, 0);
    briefData.placeholder = (briefText.match(/需找数据点\s*[≥>]\s*_+/g) || []).length;
  }
} catch {}
results.push({
  gate: 'M-Integrity-1 T2.5 完整性',
  pass: briefData.hasBrief && briefData.subclaims > 0,
  detail: briefData.hasBrief
    ? `任务简报 ${briefData.subclaims} 子问题 / 需找数据点 ${briefData.minDataPoints} 条${briefData.placeholder ? `（${briefData.placeholder} 处占位未填）` : ''}（脚本佐证，主控 L4 跨文件判断）`
    : '任务简报不存在或缺研究问题段（脚本佐证，主控 L4 跨文件判断）',
  severity: 'LLM 兜底',
});

// === 总判定：exit code + 严重度统计（soft=LLM 兜底不 gate，单独 bucket；total=pass+p0+p1+p2+soft+skips）===
const skips = results.filter((r) => r.pass === 'SKIP').length;
const pass = results.filter((r) => r.pass === true).length;
const fail = results.filter((r) => r.pass === false);
const soft = fail.filter((r) => r.severity === 'LLM 兜底').length;
const hard = fail.filter((r) => r.severity !== 'LLM 兜底');
const p0 = hard.filter((r) => r.severity === 'P0').length;
const p1 = hard.filter((r) => r.severity === 'P1').length;
const p2 = hard.filter((r) => r.severity === 'P2').length;
// 退出码语义（v2.5.2-dsh.13 修订，回应审计 P1「exit 0 与『任何一项不过都不得标记完成』矛盾」）：
//   0 = 全项通过（无失败、无 SKIP）｜1 = 存在 P1 失败｜2 = 存在 P0 失败
//   3 = 仅 P2 / LLM 兜底 / SKIP —— 需 LLM 复核，**不得**当作「通过」（旧版一律 exit 0）｜10 = 参数/路径错误
const anyFail = results.some((r) => r.pass === false);
const exitCode = p0 > 0 ? 2 : (p1 > 0 ? 1 : (anyFail || skips > 0 ? 3 : 0));
const report = {
  draft: draftPath,
  date: new Date().toISOString().slice(0, 10),
  total: results.length,
  pass, p0, p1, p2, soft, skips,
  results: wantSummary ? results.filter((r) => !r.pass && r.severity !== 'LLM 兜底') : results,  // --summary 仅保留硬失败项，省 token
  exit: exitCode,
};
console.log(JSON.stringify(report, null, 2));
if (reportPath) {
  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.error(`📄 M-Gate 报告已落盘: ${reportPath}`);
  } catch (e) {
    console.error(`⚠️ M-Gate 报告落盘失败: ${e.message}`);
  }
}
process.exit(exitCode);
