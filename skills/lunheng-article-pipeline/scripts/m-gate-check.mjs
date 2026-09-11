// 论衡 M 门机械化预检脚本（v2.5.2-dsh 补丁 + v2.5.2-dsh.5 重大增强 + v2.5.2-dsh.16 加图件闭环 + v2.5.2-dsh.17 加 4 项）
//   v2.5.2-dsh:   M-Form-1/3/5/7 + M-Exist-2 纯正则/哈希判定
//   v2.5.2-dsh.5: M 门全脚本化（T8 仅复核 M-Form-8 承重墙质量 + M-Integrity 跨文件判断）
//   v2.5.2-dsh.16: 新增 M-Form-9 图件闭环（[图N] ↔ final/图件/ ↔ 图上数字）
//   v2.5.2-dsh.17: 新增 M-Form-10 索引段完整性 / M-Form-11 素材按需加载闭环 /
//                  M-Exist-4 审计条目闭环 / M-Exist-5 阶段闸门记录表 /
//                  M-Exist-6 审稿报告与期刊匹配 / M-Exist-7 交付说明字段齐备 /
//                  M-Exist-8 批判报告覆盖（C1-C7）/ M-Exist-9 审计报告 G 项覆盖；
//                  M-Form-8 增补「承重墙超载」机检 → M 门 22 项（脚本 21 项 + M-Integrity-2 主控）
// 用法: node m-gate-check.mjs <final/定稿.md> <final/证据包目录> [--summary] [--fig-dir <图件目录>] [--report <path>]
//   --summary：仅输出聚合统计（total/pass/p0/p1/p2/soft/skips）+ 硬失败项；省略通过项 details[]（省 ~80% 输出字节，机器可读友好）
//   --fig-dir：图件目录（缺省自动推 <定稿目录>/图件）
// 配套：M-Gate-Algorithm.md「机械化脚本化」段
// 严重度评级（v2.5.2-dsh.5 引入）：gate fail 时按 P0/P1/P2 分级；单子项失败子项数 ≤2 → P2 可放行
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refsOf, dataCardIds } from './_lib/refs.mjs';                 // 引用编号口径真源
import { TRUST_COMPLIANT_RE, TRUST_LOOSE_RE } from './_lib/trust.mjs'; // 信任级别口径真源
import { splitCard } from './_lib/cards.mjs';                          // 卡片切块口径真源
import { analyzeSvg, svgTextNumbers, figureNoOf, figurePlaceholders } from './_lib/svg.mjs'; // SVG 图件口径真源

// 本脚本自身所在目录（用于读取技能包内的真源，如闸门记录模板 / 期刊数据库；v2.5.2-dsh.17）
const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(scriptDir, '..');

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
  // ---- 承重墙超载机检（v2.5.2-dsh.17 新增）----
  // 承重墙 = 支撑力最强的单条证据，T4 在大纲「承重墙清单」里逐论点标 top1；论衡定的规则是
  // **同一证据被 ≥3 个论点标为承重墙 = 超载**（教训：善行实战祁东案一个案例承重四个论点，
  // 被击穿则整链塌）。此前该规则只有 T6 的专项批判 + T7 的 LLM 复核，**没有任何机械计数**。
  // 判定方式与格式无关：清单区内每个论点最多贡献一次 top1 标注，故同一编号出现 ≥3 次即 ≥3 个论点。
  const wall8 = { checked: false, rows: 0, overload: [], ghost: [], claims: 0, notes: [] };
  try {
    const projDir8 = dirname(dirname(draftPath));
    const outlinePath8 = [join(projDir8, 'analysis', '分析大纲.md'), join(evDir, '分析大纲.md')]
      .find((p) => existsSync(p));
    if (outlinePath8) {
      const ol = readFileSync(outlinePath8, 'utf8').split('\n');
      const sIdx = ol.findIndex((l) => /承重墙/.test(l) || /承重证据\s*top\s*1/i.test(l));
      if (sIdx !== -1) {
        wall8.checked = true;
        const head = /^(#{1,6})\s/.exec(ol[sIdx]);
        let eIdx = Math.min(ol.length, sIdx + 61);
        if (head) {
          const re = new RegExp(`^#{1,${head[1].length}}\\s`);
          for (let i = sIdx + 1; i < ol.length; i++) { if (re.test(ol[i])) { eIdx = i; break; } }
          if (eIdx === Math.min(ol.length, sIdx + 61)) eIdx = ol.length;   // 未找到同级标题 → 到文件末
        }
        const block = ol.slice(sIdx, eIdx);
        // 只认「结构性行」：表格行 / 列表项 / 含论点标记的行（防把散文里的编号算成承重墙标注）
        const structRows = block.filter((l) => /\[[LDC]\d+\]/.test(l) && (/^\s*[|*-]/.test(l) || /论点\s*[0-9一二三四五六七八九十]/.test(l)));
        wall8.rows = structRows.length;
        const freq = new Map();
        for (const l of structRows) for (const m of l.matchAll(/\[([LDC])(\d+)\]/g)) {
          const id = `[${m[1]}${m[2]}]`;
          freq.set(id, (freq.get(id) || 0) + 1);
        }
        wall8.claims = new Set([...block.join('\n').matchAll(/论点\s*([0-9一二三四五六七八九十]+)/g)].map((m) => m[1])).size;
        wall8.overload = [...freq.entries()].filter(([, n]) => n >= 3).map(([id, n]) => `${id}×${n}论点`);
        if (wall8.rows === 0) wall8.notes.push('承重墙清单无结构性条目（每个论点须标一条「承重证据 top1」）');
        else if (wall8.claims > wall8.rows) wall8.notes.push(`${wall8.claims} 个论点但只标了 ${wall8.rows} 条承重墙——有论点未标 top1`);
        // 幽灵编号：承重墙标了卡片里不存在的编号
        const cardIds8 = new Set();
        for (const [name, rel] of [['文献卡.md', 'literature/文献卡.md'], ['数据卡.md', 'data/数据卡.md'], ['案例卡.md', 'cases/案例卡.md']]) {
          let p = join(evDir, name);
          if (!existsSync(p)) { const alt = join(projDir8, rel); p = existsSync(alt) ? alt : null; }
          if (!p) continue;
          for (const m of readFileSync(p, 'utf8').matchAll(/^#{2,4}\s*\[([LDC])(\d+)\]/gm)) cardIds8.add(`[${m[1]}${m[2]}]`);
        }
        if (cardIds8.size > 0) wall8.ghost = [...freq.keys()].filter((id) => !cardIds8.has(id));
      } else {
        wall8.notes.push('大纲未见承重墙清单（T4 未标 top1 → 本项无从核，T6/T7 按清单专项检查失效）');
      }
    }
  } catch { /* 承重墙是增强项：解析失败不拖垮 M-Form-8 原有覆盖率判定 */ }

  const wallHard = wall8.overload.length > 0 || wall8.ghost.length > 0;
  let mform8Pass = (mform8Findings.L_missing === 0 && mform8Findings.weak === 0 && !wallHard);
  let mform8Severity = mform8Findings.L_missing > 0 ? 'P0'
    : (wallHard || mform8Findings.weak > 0 ? 'P1' : '通过');
  const wallBit = wall8.checked
    ? (wall8.overload.length
      ? `承重墙超载：${wall8.overload.join(',')}（同一证据被 ≥3 论点承重 → 降级为辅助证据或补检索）`
      : (wall8.rows > 0 ? `承重墙 ${wall8.rows} 条标注、无超载` : (wall8.notes[0] || '承重墙清单为空')))
    : '';
  let wallBit2 = '';
  if (wall8.ghost.length) wallBit2 = `承重墙含卡片中不存在的编号：${wall8.ghost.slice(0, 5).join(',')}`;
  results.push({
    gate: 'M-Form-8 三角验证',
    pass: mform8Pass,
    detail: [
      `${mform8Findings.total} 段：${mform8Findings.L_missing} 段缺 L，${mform8Findings.weak} 段覆盖 <2 类${mform8Findings.details.length ? `（${mform8Findings.details.slice(0, 3).join('; ')}）` : ''}`,
      wallBit,
      wallBit2,
      (wall8.checked && wall8.rows > 0 && !wall8.overload.length && wall8.notes.length) ? `备注：${wall8.notes[0]}` : '',
    ].filter(Boolean).join(' ｜ '),
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

// === M-Form-11 素材按需加载闭环（v2.5.2-dsh.17 新增）===
// 依据：05 卡要求 T5「先读各卡索引段 → 按大纲映射表**只读相关条目、不读全文**」，这条 token 优化的
//   收益此前**完全靠写手自述**——「按需加载」与「整卡通读」在产物上完全同形，无从核对（整卡通读
//   正是 T5 cacheRead 占子代理总量 76% 的成因）。本项用一份便宜留痕（`analysis/素材加载清单.md`）
//   把「到底加载了哪些编号」变成事实，三层判定：
//     ① 定稿正文引用的编号必须都在「## 已加载」集 → 否则「引了没读 = 引用不可信」（硬）
//     ② 「已加载」的编号必须在卡片正文条目里有对应 → 否则「幽灵编号 = 清单编造」（硬）
//     ③ 软提示：「读了不用」的编号（浪费上下文）/ 加载率 >90%（选择性不足，疑似整卡通读）
try {
  const projDir11 = dirname(dirname(draftPath));
  const listPath11 = [
    join(projDir11, 'analysis', '素材加载清单.md'),
    join(evDir, '素材加载清单.md'),
  ].find((p) => existsSync(p)) || null;
  const cited11 = new Set(
    [...refsOf(body, 'L'), ...refsOf(body, 'D'), ...refsOf(body, 'C')].map(norm),
  );
  // 卡片侧真源：正文条目编号（幽灵判定）+ 索引段编号（选择性判定）
  const cardEntryIds = new Set();
  const cardIndexIds = new Set();
  for (const [name, rel] of [['文献卡.md', 'literature/文献卡.md'], ['数据卡.md', 'data/数据卡.md'], ['案例卡.md', 'cases/案例卡.md']]) {
    let p = join(evDir, name);
    if (!existsSync(p)) { const alt = join(projDir11, rel); p = existsSync(alt) ? alt : null; }
    if (!p) continue;
    const t = readFileSync(p, 'utf8');
    for (const m of t.matchAll(/^#{2,4}\s*\[([LDC])(\d+)\]/gm)) cardEntryIds.add(`[${m[1]}${m[2]}]`);
    const ls = t.split('\n');
    const si = ls.findIndex((l) => /^##\s*📇\s*索引段/.test(l));
    if (si !== -1) {
      let ei = ls.findIndex((l, i) => i > si && /^##\s/.test(l));
      if (ei === -1) ei = ls.length;
      for (const m of ls.slice(si + 1, ei).join('\n').matchAll(/\[([LDC])(\d+)\]/g)) cardIndexIds.add(`[${m[1]}${m[2]}]`);
    }
  }
  const findings11 = [];
  const soft11 = [];
  if (!listPath11) {
    if (cited11.size === 0) {
      results.push({ gate: 'M-Form-11 素材按需加载闭环', pass: true, detail: 'N/A：正文无素材引用且无加载清单（尚未进入写作阶段）', severity: '通过' });
    } else {
      findings11.push(`正文引用 ${cited11.size} 个素材编号，却无 analysis/素材加载清单.md——「按需加载」无留痕，无法区分「按需」与「整卡通读」`);
      results.push({
        gate: 'M-Form-11 素材按需加载闭环',
        pass: false,
        detail: findings11.join('；'),
        severity: 'P1',
      });
    }
  } else {
    const lt = readFileSync(listPath11, 'utf8');
    const ls2 = lt.split('\n');
    // 只取「## 已加载」段内的编号（「已跳过」等其它段不计入加载集，允许写编号解释为何不读）
    const hIdx11 = ls2.findIndex((l) => /^#{2,4}\s*已加载/.test(l));
    let loadedSeg;
    if (hIdx11 === -1) {
      findings11.push('加载清单缺「## 已加载」段标题（机检无从定位加载集）');
      loadedSeg = lt;
    } else {
      let e11 = ls2.findIndex((l, i) => i > hIdx11 && /^#{2,4}\s/.test(l));
      if (e11 === -1) e11 = ls2.length;
      loadedSeg = ls2.slice(hIdx11 + 1, e11).join('\n');
    }
    const loaded11 = new Set([...loadedSeg.matchAll(/\[([LDC])(\d+)\]/g)].map((m) => `[${m[1]}${m[2]}]`));
    const notLoaded = [...cited11].filter((x) => !loaded11.has(x));
    const ghost = [...loaded11].filter((x) => cardEntryIds.size > 0 && !cardEntryIds.has(x));
    const unused = [...loaded11].filter((x) => !cited11.has(x));
    if (notLoaded.length) findings11.push(`正文引用但清单未记「已加载」：${notLoaded.slice(0, 6).join(',')}（引了没读 = 引用不可信）`);
    if (ghost.length) findings11.push(`清单里的编号在卡片中无对应条目：${ghost.slice(0, 6).join(',')}（清单与素材卡不一致）`);
    if (unused.length) soft11.push(`${unused.length} 个编号「读了但正文未引用」（${unused.slice(0, 5).join(',')}）——白读即为上下文浪费`);
    if (cardIndexIds.size >= 20 && loaded11.size / cardIndexIds.size > 0.9) {
      soft11.push(`已加载 ${loaded11.size} / 索引 ${cardIndexIds.size} 条（>90%）——选择性不足，疑似整卡通读（该条优化即为此设）`);
    }
    const ver11 = lt.match(/对应(?:正文)?版本[：:]\s*v?(\d+)/);
    if (ver11) {
      try {
        const draftsDir = join(projDir11, 'drafts');
        const newestDraft = existsSync(draftsDir)
          ? Math.max(0, ...readdirSync(draftsDir).map((f) => Number((f.match(/^初稿-v(\d+)\.md$/) || [])[1]) || 0))
          : 0;
        if (newestDraft && Number(ver11[1]) < newestDraft) {
          soft11.push(`清单标注「对应正文版本 v${ver11[1]}」落后于最新初稿 v${newestDraft}——留痕未随修订轮刷新`);
        }
      } catch { /* best-effort */ }
    }
    const hard11 = findings11.length > 0;
    results.push({
      gate: 'M-Form-11 素材按需加载闭环',
      pass: !hard11 && soft11.length === 0,
      detail: [
        `已加载 ${loaded11.size} 条 / 正文引用 ${cited11.size} 个`,
        hard11 ? `硬问题：${findings11.slice(0, 3).join('；')}` : '引用 ⊆ 已加载，加载集有卡片支撑',
        soft11.length ? `软提示：${soft11.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard11 ? (notLoaded.length + ghost.length > 3 ? 'P0' : 'P1') : (soft11.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Form-11 素材按需加载闭环', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
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

// === M-Exist-5 阶段闸门记录表（v2.5.2-dsh.17 新增）===
// 依据：两道主控闸门（T2.5 / T7.5）此前只有「主控 LLM 兜底执行」的伪代码，**没有任何落盘表单**——
//   闸门过没过、依据是什么，只留在会话里；M-Integrity-2 的 8 步判定也没有可核对的输入。
//   本项把闸门变成结构化记录（`audits/闸门记录-T2.5.md` / `audits/闸门记录-T7.5.md`，
//   真源 = `references/templates/闸门记录-template.md`，本节要求的检查项**从模板派生**，不写死）：
//     · 每道闸门的模板检查项都必须有对应行（漏项 = 闸门形同虚设）
//     · 「实据」列必须是**路径 / exit code / 命令**，不接受「已检查」这类自述（闸门留机械证据）
//     · 结论词固定（✓ / ✗ / N/A）；判 ✗ 的行必须写失败原因
//     · T7.5 另与 final/M-Gate-Report.json 对账：全 ✓ 却报告 exit≠0 = 自相矛盾（P0）
// 触发条件：项目已进入 Phase 4（audits/审计报告-*.md 存在）→ 两表单必须有；否则 N/A。
try {
  const projDir5 = dirname(dirname(draftPath));
  const auditsDir5 = [join(projDir5, 'audits'), join(dirname(draftPath), 'audits')].find((d) => existsSync(d)) || null;
  const hasAudit5 = !!auditsDir5 && readdirSync(auditsDir5).some((f) => /^审计报告-v\d+\.md$/.test(f));
  const tplPath5 = join(skillRoot, 'references', 'templates', '闸门记录-template.md');
  if (!hasAudit5) {
    results.push({ gate: 'M-Exist-5 阶段闸门记录表', pass: true, detail: 'N/A：尚无审计报告（未进入 Phase 4，闸门记录留待 T7.5）', severity: '通过' });
  } else if (!auditsDir5) {
    results.push({ gate: 'M-Exist-5 阶段闸门记录表', pass: false, detail: '找不到 audits/ 目录，无法定位闸门记录', severity: 'P1' });
  } else {
    const tplItems = { 'T2.5': [], 'T7.5': [] };
    const normLabel = (s) => String(s).replace(/[\s*`（）()【】\[\]：:、，,。.／/\-—_|]/g, '');
    // 模板表格首列 = 必需检查项（真源在模板；表格之外的行不计入 —— 防图例/说明表被当成检查项）
    if (existsSync(tplPath5)) {
      const tl = readFileSync(tplPath5, 'utf8').split('\n');
      let cur5 = null;
      let inTable5 = false;
      for (const l of tl) {
        const h = l.match(/^#{2,4}\s*(T2\.5|T7\.5)\b/);
        if (h) { cur5 = h[1]; inTable5 = false; continue; }
        if (/^#{2,4}\s/.test(l)) { cur5 = null; inTable5 = false; continue; }   // 进入下一节 → 停止收集
        if (!cur5) continue;
        if (!/^\s*\|/.test(l)) { if (inTable5) break; continue; }               // 表格结束后不再收集
        inTable5 = true;
        const c = l.split('|').slice(1, -1).map((x) => x.trim());
        if (!c.length || c.every((x) => /^:?-{2,}:?$/.test(x) || x === '')) continue;
        if (/检查项|^检查$/.test(c[0])) continue;                               // 表头
        if (c[0]) tplItems[cur5].push(c[0]);
      }
    }
    const findings5 = [];
    const soft5 = [];
    const detailBits = [];
    let contradict5 = false;   // 闸门结论 ↔ M 门报告自相矛盾 = 单独定为 P0（不随条数降级）
    for (const gateId of ['T2.5', 'T7.5']) {
      const fp = join(auditsDir5, `闸门记录-${gateId}.md`);
      if (!existsSync(fp)) {
        findings5.push(`缺 audits/闸门记录-${gateId}.md（${gateId === 'T2.5' ? 'T2 数据检索 → T4 前' : 'T7 审计 → T8 终检前'}的闸门无落盘留痕）`);
        continue;
      }
      const ls5 = readFileSync(fp, 'utf8').split('\n');
      const hIdx5 = ls5.findIndex((l) => /^\s*\|/.test(l) && /检查项/.test(l));
      if (hIdx5 === -1) { findings5.push(`闸门记录-${gateId}.md 缺「检查项」表格（表头须含 检查项 / 实据 / 结论）`); continue; }
      const header5 = ls5[hIdx5].split('|').slice(1, -1).map((x) => x.trim());
      const ci5 = (kw) => header5.findIndex((h) => kw.test(h));
      const iItem = ci5(/检查项/), iEv = ci5(/实据|证据|依据/), iRes = ci5(/结论|判定/), iWhy = ci5(/失败原因|原因|备注/);
      if (iEv === -1 || iRes === -1) { findings5.push(`闸门记录-${gateId}.md 表头须含「实据」「结论」列（现有：${header5.join(' / ')}）`); continue; }
      const rows5 = [];
      for (let i = hIdx5 + 1; i < ls5.length; i++) {
        const l = ls5[i];
        if (/^#{2,4}\s/.test(l)) break;
        if (!/^\s*\|/.test(l)) continue;
        const c = l.split('|').slice(1, -1).map((x) => x.trim());
        if (c.every((x) => /^:?-{2,}:?$/.test(x) || x === '')) continue;
        rows5.push(c);
      }
      const seen = rows5.map((r) => normLabel(r[iItem] || ''));
      for (const need of tplItems[gateId]) {
        const nn = normLabel(need);
        const hit = seen.some((s) => s && (s.includes(nn) || nn.includes(s)));
        if (!hit) findings5.push(`${gateId} 检查项缺「${need}」（模板为真源，逐项都要有行）`);
      }
      let resPass = 0;
      for (const r of rows5) {
        const item = (r[iItem] || '').trim();
        if (!item) continue;
        const ev = (r[iEv] || '').replace(/<[^>]*>/g, '').trim();   // 去掉 <…> 模板占位符：未填 = 不是证据
        const res = (r[iRes] || '').trim();
        // 实据必须是机械证据：路径 / exit code / 命令 / 哈希；纯自述不接受
        const evLooksReal = /[\\/]|exit|node\s|m-gate|sha256|\.json|\.md|\.svg|\d/.test(ev) && !/^(已|未)?(检查|核对|确认|自查)(完)?(毕|过)?$/.test(ev.replace(/\s/g, ''));
        if (ev.replace(/[\s.。…-]/g, '').length < 3 || !evLooksReal) {
          findings5.push(`${gateId}「${item}」的实据列不是机械证据（须写路径 / exit code / 命令，而非「已检查」自述）：现为「${ev.slice(0, 24)}」`);
        }
        if (!/^(✓|✅|通过|✗|❌|失败|不通过|N\/A|N／A|-)$/.test(res)) {
          soft5.push(`${gateId}「${item}」结论词「${res.slice(0, 12)}」非固定词（应为 ✓ / ✗ / N/A）`);
        } else if (/^(✓|✅|通过)$/.test(res)) {
          resPass++;
        } else if (/^(✗|❌|失败|不通过)$/.test(res)) {
          if (iWhy === -1 || (r[iWhy] || '').trim().length < 4) findings5.push(`${gateId}「${item}」判 ✗ 但未写失败原因`);
        }
      }
      if (rows5.length === 0) findings5.push(`闸门记录-${gateId}.md 表格无有效行`);
      detailBits.push(`${gateId} ${rows5.length} 行（✓ ${resPass}）`);
      // T7.5 ↔ M-Gate-Report.json 对账（自相矛盾即 P0）
      if (gateId === 'T7.5' && rows5.length > 0 && resPass === rows5.length) {
        const repPath5 = [join(dirname(draftPath), 'M-Gate-Report.json'), join(projDir5, 'final', 'M-Gate-Report.json')].find((p) => existsSync(p));
        if (repPath5) {
          try {
            const rj = JSON.parse(readFileSync(repPath5, 'utf8'));
            if (typeof rj.exit === 'number' && rj.exit !== 0) {
              contradict5 = true;
              findings5.push(`闸门记录-T7.5 全判 ✓，但 M-Gate-Report.json 的 exit = ${rj.exit}（非 0）——闸门结论与 M 门报告自相矛盾（P0）`);
            }
          } catch { soft5.push('M-Gate-Report.json 无法解析，未做闸门↔报告对账'); }
        }
      }
    }
    if (!existsSync(tplPath5)) soft5.push('未找到 references/templates/闸门记录-template.md（检查项清单降级为仅结构校验）');
    const hard5 = findings5.length > 0;
    results.push({
      gate: 'M-Exist-5 阶段闸门记录表',
      pass: !hard5 && soft5.length === 0,
      detail: [
        detailBits.join(' / ') || '两表单均缺失',
        hard5 ? `硬问题：${findings5.slice(0, 3).join('；')}` : '闸门记录齐备且实据为机械证据',
        soft5.length ? `软提示：${soft5.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard5 ? (contradict5 || findings5.length > 3 ? 'P0' : 'P1') : (soft5.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-5 阶段闸门记录表', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-6 审稿报告与期刊匹配（v2.5.2-dsh.17 新增）===
// 依据：T9 审稿报告的 6 维度评分 + 建议词 + 期刊匹配表此前**零机械校验**——总评分可以是 6 个维度
//   凑不出来的数，期刊推荐可以是《期刊数据库》里根本不存在的刊名，综合匹配度可以不由公式得出。
//   本项做三件事：① 总分 == 6 维之和（算术自洽）；② 建议词与总分区间一致；③ 期刊匹配表**可复算**
//   （综合 = 0.5×主题 + 0.3×风格 + 0.2×归一化，容差 ±1.5）且刊名出自 `期刊数据库.md`。
// 触发条件：存在 audits/审稿报告-vN.md（T9 可选，未启用 → N/A）。
try {
  const projDir6 = dirname(dirname(draftPath));
  const auditsDir6 = [join(projDir6, 'audits'), join(dirname(draftPath), 'audits')].find((d) => existsSync(d)) || null;
  const latest6 = (() => {
    if (!auditsDir6) return null;
    const c = readdirSync(auditsDir6)
      .map((f) => ({ f, m: f.match(/^审稿报告-v(\d+)\.md$/) }))
      .filter((x) => x.m).map((x) => ({ f: x.f, n: Number(x.m[1]) }))
      .sort((a, b) => b.n - a.n);
    return c.length ? join(auditsDir6, c[0].f) : null;
  })();
  if (!latest6) {
    results.push({ gate: 'M-Exist-6 审稿报告与期刊匹配', pass: true, detail: 'N/A：无审稿报告（T9 未启用或未到 Phase 4.5）', severity: '通过' });
  } else {
    const rt = readFileSync(latest6, 'utf8');
    const findings6 = [];
    const soft6 = [];
    const DIMS = ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范'];
    const dimScores = [];
    for (const d of DIMS) {
      const m = rt.match(new RegExp(`${d}[^\\n]*?(\\d)\\s*/\\s*5`)) || rt.match(new RegExp(`${d}\\s*\\|\\s*(\\d)\\s*/\\s*5`));
      if (!m) soft6.push(`未找到「${d}」的 x/5 评分（模板 6 维须齐全）`);
      else dimScores.push(Number(m[1]));
    }
    const total6 = rt.match(/总评分[^\d]{0,8}(\d{1,2})\s*\/\s*30/) || rt.match(/总分[^\d]{0,12}(\d{1,2})\s*\/\s*30/);
    const declaredTotal = total6 ? Number(total6[1]) : null;
    if (declaredTotal === null) findings6.push('审稿报告缺「总评分 XX/30」');
    else if (dimScores.length === 6) {
      const sum = dimScores.reduce((a, b) => a + b, 0);
      if (sum !== declaredTotal) findings6.push(`总评分 ${declaredTotal}/30 ≠ 6 维之和 ${sum}（${DIMS.map((d, i) => `${d}${dimScores[i]}`).join('+')}）——评分表与总分自相矛盾`);
    }
    if (declaredTotal !== null) {
      const expect = declaredTotal >= 26 ? /accept/i : declaredTotal >= 21 ? /minor/i : declaredTotal >= 16 ? /major/i : /reject/i;
      if (!expect.test(rt)) soft6.push(`总分 ${declaredTotal} 对应的建议词（${expect.source.replace(/[/i]/g, '')}）在报告中未出现——建议与区间可能不一致`);
    }
    // 期刊匹配表
    const jLines = rt.split('\n');
    const jHead = jLines.findIndex((l) => /^\s*\|/.test(l) && /综合匹配度/.test(l));
    let jRows = [];
    if (jHead !== -1) {
      for (let i = jHead + 1; i < jLines.length; i++) {
        const l = jLines[i];
        if (!/^\s*\|/.test(l)) break;
        const c = l.split('|').slice(1, -1).map((x) => x.trim());
        if (c.every((x) => /^:?-{2,}:?$/.test(x) || x === '')) continue;
        jRows.push(c);
      }
    }
    const wantJournal = /启用期刊匹配|期刊匹配助手/.test(rt) || (() => {
      try { return /启用期刊匹配/.test(readFileSync(join(projDir6, '01-任务简报.md'), 'utf8')); } catch { return false; }
    })();
    if (jHead === -1) {
      if (wantJournal) findings6.push('任务简报已启用期刊匹配，但审稿报告无「综合匹配度」表（Top 3 缺失）');
    } else {
      if (jRows.length !== 3) soft6.push(`期刊匹配表 ${jRows.length} 行（应为 Top 3）`);
      if (jRows.length === 0) findings6.push('期刊匹配表存在表头但无数据行');
      const head6 = jLines[jHead].split('|').slice(1, -1).map((x) => x.trim());
      const col6 = (kw) => head6.findIndex((h) => kw.test(h));
      const iComp = col6(/综合/), iTheme = col6(/主题/), iStyle = col6(/风格/), iCycle = col6(/审稿周期/), iWhy2 = col6(/推荐理由|理由/);
      let dbText = '';
      try { dbText = readFileSync(join(skillRoot, 'references', '_shared', '期刊数据库.md'), 'utf8'); } catch { /* 降级 */ }
      const pct = (s) => { const m = String(s || '').match(/(\d+(?:\.\d+)?)\s*%/); return m ? Number(m[1]) : null; };
      for (const r of jRows) {
        const name = (r[0] || '').replace(/[*《》\s]/g, '');
        if (!name) { findings6.push('期刊匹配表有行缺刊名'); continue; }
        if (dbText && !dbText.includes(name.slice(0, Math.max(2, name.length - 1)))) {
          soft6.push(`「${r[0]}」在 期刊数据库.md 中查不到（疑似杜撰刊名，须以数据库为准）`);
        }
        const comp = pct(r[iComp]), theme = pct(r[iTheme]), style = pct(r[iStyle]);
        if (comp === null || theme === null || style === null) {
          findings6.push(`「${r[0]}」匹配度列缺百分比（综合/主题/风格都要有）`);
        } else if (declaredTotal !== null) {
          const normScore = Math.max(0, Math.min(1, (declaredTotal - 16) / 14));
          const expectComp = 0.5 * theme + 0.3 * style + 0.2 * normScore * 100;
          if (Math.abs(comp - expectComp) > 1.5) {
            findings6.push(`「${r[0]}」综合匹配度 ${comp}% ≠ 复算值 ${expectComp.toFixed(1)}%（=0.5×${theme} + 0.3×${style} + 0.2×${(normScore * 100).toFixed(1)}）——数字不可复算`);
          }
        }
        if (iCycle !== -1 && !/[0-9]/.test(r[iCycle] || '')) soft6.push(`「${r[0]}」审稿周期为空或无数值`);
        if (iWhy2 !== -1 && (r[iWhy2] || '').replace(/[\s.。…-]/g, '').length < 6) soft6.push(`「${r[0]}」推荐理由过短（须含主题契合 + 风格契合 + 周期依据）`);
      }
    }
    // ---- 审稿建议的「可消费 + 落地追踪」（v2.5.2-dsh.17 增补）----
    // 依据：审稿报告的「给作者的具体修改建议（按优先级）」是 T5/主控据以做「目标期刊适配修订」的
    //   唯一输入；若建议只写「建议加强论证」这类无定位、无动作的句子，下游无法消费，
    //   而报告表面完全正常。本项核：建议段存在 + 条目带定位（§/段落/章/行 或素材编号）+ 编号连续，
    //   并在发生修订轮时核「审稿建议是否进了修订回执」（防「建议提了没人接」）。
    const sugIdx = jLines.findIndex((l) => /^#{2,4}\s/.test(l) && /修改建议|建议（按优先级）|给作者/.test(l));
    if (sugIdx === -1) soft6.push('未见「给作者的具体修改建议」段（T5/主控无据以做期刊适配修订）');
    else {
      let sugEnd = jLines.length;
      for (let k = sugIdx + 1; k < jLines.length; k++) { if (/^#{2,4}\s/.test(jLines[k])) { sugEnd = k; break; } }
      const sugLines = jLines.slice(sugIdx + 1, sugEnd);
      const sugItems = sugLines.filter((l) => /^\s*(?:\d+[.、)]|[-*]\s)/.test(l) && l.replace(/[\s\-*\d.、)]/g, '').length > 6);
      if (sugItems.length === 0) soft6.push('「修改建议」段无有效条目（须按优先级逐条列）');
      else {
        const noLoc = sugItems.filter((l) => !/[§第]\s*[一二三四五六七八九十\d]+|段落|行\s*\d|章|\[(?:L|D|C)\d+\]/.test(l));
        if (noLoc.length) soft6.push(`${noLoc.length}/${sugItems.length} 条建议无定位（须写 §章节/段落/行号 或素材编号，否则 T5 无法照做）`);
      }
    }
    // 落地追踪：已有修订说明（说明发生过修订轮）时，修订回执应提到审稿意见
    try {
      const drafts10 = join(projDir6, 'drafts');
      if (existsSync(drafts10)) {
        const revNotes6 = readdirSync(drafts10).filter((f) => /^修订说明-.*\.md$/.test(f)).sort();
        if (revNotes6.length) {
          const lastNote = readFileSync(join(drafts10, revNotes6[revNotes6.length - 1]), 'utf8');
          if (!/审稿|期刊|T9|同行评审/.test(lastNote)) {
            soft6.push(`修订说明（${revNotes6[revNotes6.length - 1]}）未提及审稿意见——审稿建议未进修订回执（「建议提了没人接」）`);
          }
        }
      }
    } catch { /* 落地追踪为增强项，读不到就跳过 */ }
    const hard6 = findings6.length > 0;
    results.push({
      gate: 'M-Exist-6 审稿报告与期刊匹配',
      pass: !hard6 && soft6.length === 0,
      detail: [
        `${latest6.split(/[\\/]/).pop()}｜6 维 ${dimScores.length}/6｜总评分 ${declaredTotal ?? '缺失'}${jHead !== -1 ? `｜期刊表 ${jRows.length} 行` : ''}`,
        hard6 ? `硬问题：${findings6.slice(0, 3).join('；')}` : '评分自洽、期刊匹配可复算',
        soft6.length ? `软提示：${soft6.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard6 ? (findings6.length > 2 ? 'P0' : 'P1') : (soft6.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-6 审稿报告与期刊匹配', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-7 交付说明字段齐备（v2.5.2-dsh.17 新增）===
// 依据：`deliverables.md` 定义了 `final/交付说明.md` 的 **11 个固定字段**（T8 终检时机械填充），
//   但既无模板也无机检——每个项目的交付说明字段名与齐备程度全凭主控临场发挥，主人复核时
//   缺项不可发现（「固定字段」名不副实）。本项逐字段核验：存在 + 非空 + 证据包指纹占位符 +
//   主人决策记录覆盖四门（缺回填须显式标注「未留痕」，不得静默省略）。
// 触发条件：final/交付说明.md 存在（T8 已开始交付）；不存在 → N/A。
try {
  const ddPath = join(dirname(draftPath), '交付说明.md');
  const FIELD_KEYWORDS = [
    ['路径', /路径/], ['图件清单', /图件清单/], ['遗留风险', /遗留风险/],
    ['人工核验项', /人工核验/], ['数据溯源', /数据溯源/], ['成本指标', /成本指标/],
    ['反哺清单', /反哺清单|待 merge|待merge/], ['AI 使用披露', /AI 使用披露/],
    ['终检结论', /终检结论/], ['投稿就绪', /投稿就绪/], ['主人决策记录', /主人决策记录/],
  ];
  if (!existsSync(ddPath)) {
    results.push({ gate: 'M-Exist-7 交付说明字段齐备', pass: true, detail: 'N/A：尚无 final/交付说明.md（T8 尚未开始交付）', severity: '通过' });
  } else {
    const dt = readFileSync(ddPath, 'utf8');
    const dl = dt.split('\n');
    const findings7 = [];
    const soft7 = [];
    for (const [label, re] of FIELD_KEYWORDS) {
      const i = dl.findIndex((l) => /^#{1,6}\s|^\s*\*\*|^\s*\|/.test(l) && re.test(l));
      if (i === -1) { findings7.push(`缺固定字段「${label}」（deliverables.md 定为必填）`); continue; }
      // 字段正文 = 到下一个标题/表头行为止
      let j = dl.length;
      for (let k = i + 1; k < dl.length; k++) { if (/^#{1,6}\s/.test(dl[k])) { j = k; break; } }
      const raw7 = dl.slice(i + 1, j).join('\n');
      const bodyTxt = raw7.replace(/<[^>]*>/g, '').replace(/[|\s\-—–:：]/g, '');
      // ① 仍含 <…> 模板占位符 → 该字段没填（模板明确要求不得留占位符）
      // ② 去掉占位符后为空 → 阈值 1（允许「无」「未启用」这类**合法的一句话答复**）
      if (/<[^>]{1,60}>/.test(raw7)) findings7.push(`字段「${label}」仍含模板占位符（<…> 未填）`);
      else if (bodyTxt.length < 1) findings7.push(`字段「${label}」为空（仅标题无内容）`);
    }
    if (!/\[哈希校验待主人回填\]|sha256\s*[:：]?\s*[0-9a-f]{16,}/i.test(dt)) {
      findings7.push('缺「证据包指纹」段或 sha256 占位符 `[哈希校验待主人回填]`（M-Integrity-2 步骤 4 的输入）');
    }
    const dec = dl.findIndex((l) => /主人决策记录/.test(l));
    if (dec !== -1) {
      let dj = dl.length;
      for (let k = dec + 1; k < dl.length; k++) { if (/^#{1,6}\s/.test(dl[k])) { dj = k; break; } }
      const decTxt = dl.slice(dec, dj).join('\n');
      const missingGate = ['Phase 0', '2.5', '3.5', 'Phase 5'].filter((g) => !decTxt.includes(g));
      if (missingGate.length) findings7.push(`主人决策记录未覆盖：${missingGate.join(' / ')}（缺回填的门须显式标注「未留痕」，不得省略）`);
      else if (!/未留痕|通过|驳回/.test(decTxt)) soft7.push('主人决策记录既无决策词也无「未留痕」标注');
    }
    const hard7 = findings7.length > 0;
    results.push({
      gate: 'M-Exist-7 交付说明字段齐备',
      pass: !hard7 && soft7.length === 0,
      detail: [
        `12 固定字段（11 字段 + 证据包指纹）实到 ${FIELD_KEYWORDS.length - findings7.filter((x) => x.startsWith('缺固定字段')).length}/11${/\[哈希校验待主人回填\]|sha256\s*[:：]?\s*[0-9a-f]{16,}/i.test(dt) ? ' + 指纹✓' : ' + 指纹✗'}`,
        hard7 ? `硬问题：${findings7.slice(0, 3).join('；')}` : '固定字段齐备且有内容',
        soft7.length ? `软提示：${soft7.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard7 ? (findings7.length > 3 ? 'P0' : 'P1') : (soft7.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-7 交付说明字段齐备', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-8 批判报告覆盖（C1-C7；v2.5.2-dsh.17 新增）===
// 依据：06 卡明确要求「C1-C7 逐条执行」且每条按统一结构化清单写（论点定位/反方观点/你的论据/
//   攻击强度/建议），并声明「T7 审计员 + T5 写手可机械消费」——**但没有任何脚本核过它**。
//   实测风险：批判报告漏掉 C3（理论假设）或 C7（一处两用）时，从报告表面完全看不出来，
//   而 T7 的「T6 条目关闭复核」与 T5 的段级 diff 都以这些条目为输入。
// 本项机检：七节齐备（缺 → P1；>2 缺 → P0）、节体非空（软）、段级清单编号合法且唯一（P1/P2）、
//   每条清单至少含 3 项要素（软）。
// 触发条件：存在 analysis/批判报告-vN.md；无 → N/A（轻量档可跳，不算失败）。
try {
  const projDir8c = dirname(dirname(draftPath));
  const revDirs = [join(projDir8c, 'analysis'), join(projDir8c, 'audits'), dirname(draftPath)];
  const latestRevPath = (() => {
    for (const d of revDirs) {
      if (!existsSync(d)) continue;
      const c = readdirSync(d)
        .map((f) => ({ f, m: f.match(/^批判报告-v(\d+)\.md$/) }))
        .filter((x) => x.m).map((x) => ({ f: x.f, n: Number(x.m[1]) }))
        .sort((a, b) => b.n - a.n);
      if (c.length) return { path: join(d, c[0].f), name: c[0].f, n: c[0].n };
    }
    return null;
  })();
  if (!latestRevPath) {
    results.push({ gate: 'M-Exist-8 批判报告覆盖', pass: true, detail: 'N/A：无批判报告（轻量档跳过 Phase 3.6 或尚未到该阶段）', severity: '通过' });
  } else {
    const rt8 = readFileSync(latestRevPath.path, 'utf8');
    const rl8 = rt8.split('\n');
    const CIDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
    // 认标题 / 加粗标签 / 列表项 / 表格行四种写法（避免因格式差异误判「漏节」）
    const cLine = (c) => new RegExp(`^(?:#{1,6}\\s*|[-*]\\s*|\\|\\s*)?\\*{0,2}${c}(?![0-9])\\b`);
    const headLine = (c) => new RegExp(`^#{2,4}\\s*\\*{0,2}${c}(?![0-9])\\b`);
    const missing8 = CIDS.filter((c) => !rl8.some((l) => cLine(c).test(l)));
    const thin8 = [];
    for (const c of CIDS) {
      const hi = rl8.findIndex((l) => headLine(c).test(l));
      if (hi === -1) continue;                      // 非标题写法 → 跳过非空判定（避免误伤）
      let hj = rl8.findIndex((l, i) => i > hi && /^#{2,4}\s/.test(l));
      if (hj === -1) hj = rl8.length;
      const secBody = rl8.slice(hi + 1, hj).join('\n').replace(/[\s|*`\-—–:：]/g, '');
      if (secBody.length < 40) thin8.push(c);
    }
    const entries8 = [...rt8.matchAll(/\[(P[012])-(C\d+)-(\d+)\]/g)].map((m) => ({ id: m[0], cat: m[2] }));
    const badCat8 = [...new Set(entries8.filter((e) => !CIDS.includes(e.cat)).map((e) => e.id))];
    const dup8 = (() => { const seen = new Set(), dup = new Set(); for (const e of entries8) { if (seen.has(e.id)) dup.add(e.id); seen.add(e.id); } return [...dup]; })();
    const ELEMS8 = [/论点定位/, /反方观点|攻击方式/, /论据|\[(?:L|D|C)\d+\]/, /攻击强度|严重度|强度/, /建议|处置/];
    const thinEntries8 = [];
    for (const e of entries8) {
      const i = rt8.indexOf(e.id);
      const seg = rt8.slice(i, i + 700);
      if (ELEMS8.filter((re) => re.test(seg)).length < 3) thinEntries8.push(e.id);
    }
    const findings8 = [];
    const soft8 = [];
    if (missing8.length) findings8.push(`批判维度缺 ${missing8.length} 节：${missing8.join(',')}（C1-C7 须逐条执行）`);
    if (dup8.length) findings8.push(`段级清单编号重复：${dup8.slice(0, 5).join(',')}——同报告内编号必须唯一`);
    if (thin8.length) soft8.push(`节体过短（内容不足）：${thin8.join(',')}`);
    if (badCat8.length) soft8.push(`清单编号类别非法（须 C1-C7）：${badCat8.slice(0, 5).join(',')}`);
    if (thinEntries8.length) soft8.push(`${thinEntries8.length} 条清单要素不足 3 项（须含 论点定位/反方观点/论据/攻击强度/建议）：${thinEntries8.slice(0, 4).join(',')}`);
    const hard8 = findings8.length > 0;
    results.push({
      gate: 'M-Exist-8 批判报告覆盖',
      pass: !hard8 && soft8.length === 0,
      detail: [
        `${latestRevPath.name}｜C1-C7 实到 ${CIDS.length - missing8.length}/7｜段级条目 ${entries8.length} 条`,
        hard8 ? `硬问题：${findings8.slice(0, 2).join('；')}` : '七维齐备且条目编号合法',
        soft8.length ? `软提示：${soft8.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard8 ? (missing8.length > 2 ? 'P0' : 'P1') : (soft8.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-8 批判报告覆盖', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-9 审计报告 G 项覆盖（v2.5.2-dsh.17 新增）===
// 依据：07 卡把「审计报告里的 G0-G14 检查项是否全覆盖」列为**验收标准**，quickref 要求
//   「必查项逐条执行，缺一不可」——**但没有任何脚本核过覆盖**。实测风险：审计报告只写了
//   G1-G7，G11（时效）/G12（信任级别）/G14（中文 AI 痕迹）整段缺席，报告读起来仍像「全项检查」。
// 本项机检：G0-G14 十五个主项都要出现**且邻域内有结论词**（缺项 → P1；>3 缺 → P0；有提及无结论 → P2）；
//   **且结论必须带实据**（v2.5.2-dsh.17 增补：同行/次行要有素材编号、文件路径、§ 或带量词的数字——
//   只写「通过」不给依据 = 自称通过 → P2）；G0.5 / G2.5 / G4-2 子项缺失 → P2。
// 触发条件：存在 audits/审计报告-vN.md；无 → N/A。
try {
  const projDir9 = dirname(dirname(draftPath));
  const auditsDir9 = [join(projDir9, 'audits'), join(dirname(draftPath), 'audits')].find((d) => existsSync(d)) || null;
  const latest9 = (() => {
    if (!auditsDir9) return null;
    const c = readdirSync(auditsDir9)
      .map((f) => ({ f, m: f.match(/^审计报告-v(\d+)\.md$/) }))
      .filter((x) => x.m).map((x) => ({ f: x.f, n: Number(x.m[1]) }))
      .sort((a, b) => b.n - a.n);
    return c.length ? { path: join(auditsDir9, c[0].f), name: c[0].f } : null;
  })();
  if (!latest9) {
    results.push({ gate: 'M-Exist-9 审计报告 G 项覆盖', pass: true, detail: 'N/A：尚无审计报告（未进入 Phase 4）', severity: '通过' });
  } else {
    const at9 = readFileSync(latest9.path, 'utf8');
    const G_MAIN = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14'];
    const G_SUB9 = ['G0.5', 'G2.5', 'G4-2'];
    const VERDICT9 = /通过|不通过|合规|违规|达标|未达标|PASS|FAIL|⚠|✅|❌|N\/A|部分|已核|未核|无问题|有问题/;
    const at9Lines = at9.split('\n');
    // 实据标记：素材编号 / 文件路径 / § / exit code / **带量词的数字**（裸数字不算——G 编号自带的数字已剥掉）
    const EVID9 = /\[(?:L|D|C|先)\d+\]|\.md\b|\.json\b|\.svg\b|\/|§|exit\s*\d|\d+\s*(?:条|个|处|项|篇|例|%|倍|字|\/)/;
    const absent9 = [];
    const noVerdict9 = [];
    const noEvidence9 = [];
    for (const id of G_MAIN) {
      const esc9 = id.replace(/[.-]/g, (c) => `\\${c}`);
      const re9 = new RegExp(`(?<![A-Za-z0-9])${esc9}(?![0-9.])`);
      const hitLines = [];
      at9Lines.forEach((l, i) => { if (re9.test(l)) hitLines.push(i); });
      if (hitLines.length === 0) { absent9.push(id); continue; }
      // 结论词须在**同一行或紧接着的下一行**（覆盖「- **G7**：通过」「| G7 | 通过 |」「### G7 \n 结论：通过」三种写法）
      const okIdx = hitLines.find((i) => VERDICT9.test(at9Lines[i]) || (i + 1 < at9Lines.length && VERDICT9.test(at9Lines[i + 1])));
      if (okIdx === undefined) { noVerdict9.push(id); continue; }
      // 该结论附近还要有实据（剥掉 G 编号本身再判，防编号里的数字误当证据）
      const near = [at9Lines[okIdx], at9Lines[okIdx + 1] || ''].join('\n').replace(new RegExp(esc9, 'g'), '');
      if (!EVID9.test(near)) noEvidence9.push(id);
    }
    const absentSub9 = G_SUB9.filter((id) => {
      const esc9 = id.replace(/[.-]/g, (c) => `\\${c}`);
      return !new RegExp(`(?<![A-Za-z0-9])${esc9}(?![0-9.])`).test(at9);
    });
    const findings9 = [];
    const soft9 = [];
    if (absent9.length) findings9.push(`G 项未覆盖 ${absent9.length} 个：${absent9.join(',')}（quickref 要求逐条执行、缺一不可）`);
    if (noVerdict9.length) soft9.push(`${noVerdict9.join(',')} 有提及但邻域无结论词（须写 通过/不通过/N/A + 证据）`);
    if (noEvidence9.length) soft9.push(`${noEvidence9.join(',')} 的结论无实据（须给素材编号 / 文件路径 / § / 带量词的数字，不能只写「通过」）`);
    if (absentSub9.length) soft9.push(`子项未覆盖：${absentSub9.join(',')}`);
    const hard9 = findings9.length > 0;
    results.push({
      gate: 'M-Exist-9 审计报告 G 项覆盖',
      pass: !hard9 && soft9.length === 0,
      detail: [
        `${latest9.name}｜G0-G14 实到 ${G_MAIN.length - absent9.length}/15${noEvidence9.length ? `（${noEvidence9.length} 项结论无实据）` : ''}`,
        hard9 ? `硬问题：${findings9[0]}` : (noEvidence9.length ? '十五项已覆盖且各有结论，部分结论缺实据' : '十五项全覆盖、各有结论与实据'),
        soft9.length ? `软提示：${soft9.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard9 ? (absent9.length > 3 ? 'P0' : 'P1') : (soft9.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-9 审计报告 G 项覆盖', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-10 大纲 §11 精简段完整性（v2.5.2-dsh.17 新增）===
// 依据：04/05 卡定案「T5 只读 `analysis/分析大纲.md` 末尾 §11 写手版精简段（≈60 行），完整大纲按需」
//   —— 这条是**T5 上下文 50K 大头的根治手段**，但 §11 自身是否真的含齐六个要素（论证主线 /
//   论点-论据映射表 / 反方规划要点 / 字数预算 / 禁做项 / 承重墙清单）**从来没被核过**。
//   实测风险：§11 缺要素时 T5 只能**回退整读大纲**——省 token 的机制静默失效，而产物上看不出来。
// 本项机检：段落存在（缺 → P2，未启用精简段的老项目不判死）、六要素齐备（缺 ≥3 → P0，缺 1-2 → P1）、
//   段落非空（<5 行 → P1）、段落不在文件末尾（其后还有 >20 行的实质章节 → P2，与「末尾段」口径冲突）、
//   段落过长（>120 行 → P2，失去「精简」意义）。
try {
  const projDir10 = dirname(dirname(draftPath));
  const outline10 = [join(projDir10, 'analysis', '分析大纲.md'), join(evDir, '分析大纲.md')]
    .find((p) => existsSync(p)) || null;
  if (!outline10) {
    results.push({ gate: 'M-Exist-10 大纲 §11 精简段', pass: true, detail: 'N/A：未找到分析大纲（尚未进入 Phase 2）', severity: '通过' });
  } else {
    const ol10 = readFileSync(outline10, 'utf8').split('\n');
    const hIdx10 = ol10.findIndex((l) => /^#{2,4}\s/.test(l) && /写手版|精简段/.test(l));
    if (hIdx10 === -1) {
      results.push({
        gate: 'M-Exist-10 大纲 §11 精简段',
        pass: false,
        detail: '大纲缺「写手版精简段」标题（T5 按 §11 定位会找不到 → 回退整读大纲，token 优化失效）',
        severity: 'P2',
      });
    } else {
      const lvl10 = (/^(#{1,6})/.exec(ol10[hIdx10]) || [])[1].length;
      let eIdx10 = ol10.length;
      const re10 = new RegExp(`^#{1,${lvl10}}\\s`);
      let nextHeading10 = -1;
      for (let i = hIdx10 + 1; i < ol10.length; i++) { if (re10.test(ol10[i])) { nextHeading10 = i; break; } }
      if (nextHeading10 !== -1) eIdx10 = nextHeading10;
      const seg10 = ol10.slice(hIdx10 + 1, eIdx10);
      const segText10 = seg10.join('\n');
      const rows10 = seg10.filter((l) => l.trim()).length;
      const ELEMS10 = [
        ['论证主线', /主线/],
        ['论点-论据映射表', /映射/],
        ['反方规划要点', /反方/],
        ['字数预算', /字数/],
        ['禁做项', /禁做|禁止/],
        ['承重墙清单', /承重墙/],
      ];
      const missing10 = ELEMS10.filter(([, re]) => !re.test(segText10)).map(([n]) => n);
      // 映射表要有真表格（表头含论点 + 至少一行含素材编号）
      const hasTable10 = /\|[^\n]*论点[^\n]*\|/.test(segText10) && /\[(?:L|D|C)\d+\]/.test(segText10);
      // 字数预算要有数字
      const budgetNumeric = /字数[^\n]{0,30}\d/.test(segText10);
      const findings10 = [];
      const soft10 = [];
      if (rows10 < 5) findings10.push(`精简段仅 ${rows10} 行实质内容（须 ≈60 行且含六要素）`);
      if (missing10.length >= 3) findings10.push(`缺 ${missing10.length} 个要素：${missing10.join(',')}（六要素：论证主线 / 论点-论据映射表 / 反方规划要点 / 字数预算 / 禁做项 / 承重墙清单）`);
      else if (missing10.length) findings10.push(`缺要素：${missing10.join(',')}`);
      if (!hasTable10) soft10.push('未见「论点-论据映射表」真表格（表头含论点 + 行内含素材编号）');
      if (!budgetNumeric) soft10.push('字数预算未见数字');
      if (rows10 > 120) soft10.push(`精简段 ${rows10} 行过长（≈60 行为准，过长则失去「只读精简段」的意义）`);
      if (nextHeading10 !== -1 && ol10.slice(nextHeading10).filter((l) => l.trim()).length > 20) {
        soft10.push('精简段不在文件末尾（其后还有 >20 行实质章节）——与「末尾 §11」口径冲突，T5 按末尾段读会漏内容');
      }
      const hard10 = findings10.length > 0;
      results.push({
        gate: 'M-Exist-10 大纲 §11 精简段',
        pass: !hard10 && soft10.length === 0,
        detail: [
          `${outline10.split(/[\\/]/).pop()}｜精简段 ${rows10} 行｜六要素实到 ${ELEMS10.length - missing10.length}/6`,
          hard10 ? `硬问题：${findings10.slice(0, 2).join('；')}` : '六要素齐备',
          soft10.length ? `软提示：${soft10.slice(0, 2).join('；')}` : '',
        ].filter(Boolean).join(' ｜ '),
        severity: hard10 ? (missing10.length >= 3 ? 'P0' : 'P1') : (soft10.length ? 'P2' : '通过'),
      });
    }
  }
} catch (e) {
  results.push({ gate: 'M-Exist-10 大纲 §11 精简段', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
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
