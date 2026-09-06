// 论衡 M 门机械化预检脚本（v2.5.2-dsh 补丁 + v2.5.2-dsh.5 重大增强）
//   v2.5.2-dsh:   M-Form-1/3/5/7 + M-Exist-2 纯正则/哈希判定
//   v2.5.2-dsh.5: 13 项 M 门全脚本化（T8 仅复核 M-Form-8 承重墙质量 + M-Integrity 跨文件判断）
// 用法: node m-gate-check.mjs <final/定稿.md> <final/证据包目录>
// 配套：M-Gate-Algorithm.md「机械化脚本化」段
// 严重度评级（v2.5.2-dsh.5 引入）：gate fail 时按 P0/P1/P2 分级；单子项失败子项数 ≤2 → P2 可放行
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [, , draftPath, evDir] = process.argv;
if (!draftPath || !evDir) {
  console.error('用法: node m-gate-check.mjs <定稿.md> <证据包目录>');
  process.exit(1);
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
const L_count = (body.match(/\[L\d+\]/g) || []).length;
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

// === M-Form-5 过程语言残留（v2.5.2-dsh.5 扩禁词清单：弱 AI 痕）===
const bannedBanned = /v\d+ 稿|初稿|草稿|修订说明|上一版|下一版/g;
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
  /(主控|文献检索员|数据检索员|分析员|写手|批判伙伴|审计员|审稿人|案例检索员)/g,
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
  const dataIds = [...text.matchAll(/\[D(\d+)\]/g)].map((m) => m[1]);
  const uniqueDataIds = [...new Set(dataIds)];
  const trustLevelMiss = [];
  const trustLevelDescOnly = [];
  for (const id of uniqueDataIds) {
    // v3 实际格式：### [Dxx] 标题（三级标题）| 数据卡.md 一级 # + [Dxx] 行内（v3 头部）
    const cardRe = new RegExp(`(?:#{2,4}\\s*\\[D${id}\\]|\\n\\[D${id}\\][^\\n]*\\n)([\\s\\S]*?)(?=\\n#{1,4}\\s|\\n\\[D\\d+\\]|$)`);
    const match = dataCard.match(cardRe);
    if (!match) { trustLevelMiss.push(`D${id}(整段缺失)`); continue; }
    const section = match[1];
    const hasStdTrust = /信任级别\**[:：]\s*(已发布|主人投喂|二手转引)/.test(section);
    const hasDescTrust = /信任级别\**[:：]|\b已发布\b|\b主人投喂\b|\b二手转引\b/.test(section);
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
  const FRONT_BACK = ['摘要', '关键词', '引言', '结语'];
  const sections = body.split(/^##\s+/m).filter((s) => s.trim().length > 0);
  for (const sec of sections.slice(0, 20)) {
    if (sec.length < 100) continue;
    const secTitle = sec.split('\n')[0].trim();
    if (FRONT_BACK.some((t) => secTitle === t || secTitle.startsWith(t))) continue;
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
console.log(JSON.stringify({
  draft: draftPath,
  date: new Date().toISOString().slice(0, 10),
  total: results.length,
  pass, p0, p1, p2, soft, skips,
  results,
  exit: p0 > 0 ? 2 : (p1 > 0 ? 1 : 0),
}, null, 2));
process.exit(p0 > 0 ? 2 : (p1 > 0 ? 1 : 0));
