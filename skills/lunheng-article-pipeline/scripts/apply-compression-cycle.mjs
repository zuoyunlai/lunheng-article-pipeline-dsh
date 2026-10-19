#!/usr/bin/env node
// 论衡字数压缩编排脚本（v18.9.x 实战反哺新增，2026.09.23）
// 用法：node apply-compression-cycle.mjs <run/项目名> [--target-N <N>] [--max-rounds <3>] [--skip-bundle] [--dry-run] [--outline <路径>] [--baseline <路径>]
// 一条命令串起实战项目收尾阶段的字数压缩循环：
//   ① 量测当前字数（body / full，与 count-chars.mjs 同源 _lib/han.mjs + _lib/sections.mjs）
//   ② 判 G8 字数硬阈（目标字数从 01-任务简报.md §目标篇幅 提取；阈 = −10% / +5%）
//   ③ 若超阻塞线 → 触发 T5 v(N+1) 段级 diff（自动生成微压缩清单，主控可批准应用）
//   ④ sha256 校验（所有 final/ 文件 — 与 _lib/destructive-write.mjs 的 sameFile 策略一致）
//   ⑤ 刷新一致性门（consistency-check.mjs）+ 证据包（build-evidence-bundle.mjs）+ 审计视图
//   ⑥ 输出压缩决策 JSON + 残留风险清单
// 退出码：0 = 阻塞线内通过 / 1 = 仍超阻塞线需 T5 修订轮（**或压缩轮不变量/分节硬指标对账不通过**） / 10 = 参数路径错 / 70 = 内部错误
// v18.12.0 L-66：删除 `writeFileSync` / `copyFileSync`——两者从未在本文件被调用（纯冗余导入）。
//
// v19.5.0（压缩/字数闭环批 · 生成期防 + 执行期守；反哺 merge清单-合并版-19条 §一·2 + §三·15）：
//   本条落在「执行期守」一侧，增补三件事（**全部在既有出口码集合 0/1/10/70 之内**,退出码契约
//   `repo-hygiene-check` 规则⑧ 登记不变）：
//     ⓐ **目标计算冲突规则（§一·2）**：「守各节下限」与「落回 ±2%（硬阈内）」**禁止同时要求**——
//        冲突时按「**先守硬阈**（目标 × 1.05）**，再谈分节下限**」取向，并把冲突逐条写进输出 `note`。
//     ⓑ **不变量增列两项（§三·15）**：「大纲各节最小硬指标不得跌破」「含判据/标准/口径关键词的
//        句子不得整句删除」（原有引用标记 / 图位编号两项不变量照旧）。
//     ⓒ **压缩后自动与大纲 §11 预算表对账**：跌破任一节最小硬指标 → 记 P1 且 **exit 1**。
//   真源口径（如实）：分节最小硬指标以大纲的**分节标题行**「（预算 ≥N 字）」为准
//   （每个 H2 一章一行、与正文结构一一对应）；§11 预算表的「本章最小硬指标」列**同样被解析**，
//   但**仅在与标题式真源不一致时记 note**，不参与判定——两处都算会得出两个不同的下限和。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installExitGuard, requireExistingDir, describeSpawn } from './_lib/exit-guard.mjs';
import { parseArgs } from './_lib/cli-args.mjs';
import { countHan } from './_lib/han.mjs';
import { parseTargetChars } from './_lib/target-chars.mjs';   // v18.12.3：目标字数解析唯一实现（3-5 位 / 千分位 / 万·千·k）
import { firstEndnoteIndex, maskFences, bodyStartAfterAbstract, h2Headings, h3Headings } from './_lib/sections.mjs';   // v18.12.3 L-56 同族：正文区口径与 count-chars 同源
import { writeReport } from './_lib/destructive-write.mjs';   // v19.19.3（M1）：候选清单落盘走同一条出口（同文件守卫 + 时间戳 .bak）

installExitGuard();

const argv = process.argv.slice(2);
const USAGE = '用法: node apply-compression-cycle.mjs <run/项目名> [--target-N <N>] [--max-rounds <3>] [--skip-bundle] [--dry-run] [--outline <路径>] [--baseline <路径>]';
const usageExit = (why) => { console.error(why); console.error(USAGE); process.exit(10); };

let flags, opts, positionals;
try {
  ({ flags, opts, positionals } = parseArgs(argv, {
    flags: ['--skip-bundle', '--dry-run'],
    // v19.5.0（§三·15）：`--outline` 指定大纲（默认 `<项目>/analysis/分析大纲.md`）；
    //   `--baseline` 指定「压缩前」版本（默认自动探测：目标同级 drafts 目录里版本号次高的 `初稿-vN.md`）。
    //   两者都给项目内相对/绝对路径；缺失时对账项记「未核」而**不改退出码**（见正文注释）。
    values: { '--target-N': 'final/定稿.md', '--max-rounds': '3', '--outline': '<项目>/analysis/分析大纲.md', '--baseline': '<项目>/drafts/初稿-v(N-1).md' },
    minPositionals: 1,
    maxPositionals: 1,
    positionalHint: '<run/项目名>',
  }));
} catch (e) { usageExit(e.message); }

const projRoot = requireExistingDir(positionals[0], '项目目录');
const targetPath = existsSync(opts['--target-N'])
  ? opts['--target-N']
  : join(projRoot, 'final/定稿.md');
if (!existsSync(targetPath)) usageExit(`目标文件不存在：${targetPath}`);
const maxRounds = Number(opts['--max-rounds']) || 3;
const dryRun = flags.has('--dry-run');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const nodeBin = process.execPath;

// ---- ① 量测字数 ----
// v18.13.0（L-56 同族收口）：body 口径与 `count-chars.mjs` 对齐 ——「**摘要后** ~ 文末节前」。
// v19.11.2（反哺 §P2-12）：**去掉 `maskFences`** —— `count-chars`（本仓字数权威）**不掩码**，
//   而两轮 cycle 此前掩码 → 同一段正文实测 31 vs 19 字（差 12 来自含汉字的 ```json 块），
//   修订说明写的「脚本实测」与闸门引用的 count-chars 对不上。现两侧同源：都按原文计。
const bodyOf = (text) => {
  const from = bodyStartAfterAbstract(text).index;
  const i = firstEndnoteIndex(text, from);
  return text.slice(from, i === -1 ? text.length : i);
};
const measure = (p) => {
  const text = readFileSync(p, 'utf8');
  return { body: countHan(bodyOf(text)), full: countHan(text) };
};
const m = measure(targetPath);

// ---- ② 目标字数 + G8 字数硬阈 ----
// v18.12.3：解析改走 `_lib/target-chars.mjs` 唯一实现（旧内联 `\d{4,5}` 在 `300 字` / `12,000 字` /
//   `1.2 万 字` 上全返回 null → `charBand = null` → **判定被静默跳过**）。解析不到必须说出来。
// 命名更正（2026-09-29，主人裁定）：字数归属 = **G8（成品度 + 字数偏差）**，机检项 = `G8-CharCount`；
//   旧称「G5 阻塞线」是误称（**G5 = 学术规范（查重 / AI 痕迹）**，与字数无关）。
const briefPath = join(projRoot, '01-任务简报.md');
const briefText = existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : null;
const tParse = briefText !== null
  ? parseTargetChars(briefText)
  : { value: null, raw: null, reason: '未找到 01-任务简报.md' };
// v19.12.0（L1 批）：不足侧硬 / 软由简报 `FLOOR=hard|soft` 决定（映射真源 = `文类档案.md` §`FLOOR` 档）。
//   **缺标记 = hard**（= 现行行为）；`soft` 只改不足侧的判级与退出码，超限侧一字不动。
const floorSoft = briefText !== null
  && /(?:^|[^A-Za-z0-9_])FLOOR\s*=\s*soft(?![A-Za-z0-9_])/i.test(briefText);
const target = tParse.value;
if (target === null) {
  console.error(`⚠️ 目标字数未解析到 → **G8 字数硬阈判定跳过**（这是「未核」，不是「已核」）：${tParse.reason}`);
  if (tParse.raw) console.error(`   · 简报里读到的是：「${tParse.raw}」——请核对 §目标篇幅 的写法（支持 3–5 位、千分位逗号、万/千/k 单位）`);
}
const charBand = target ? { floor: Math.round(target * 0.9), ceil: Math.round(target * 1.05) } : null;
// ⚠️ verdict 的**前缀**（`超阻塞线` / `低于阻塞线` / `✓ 阻塞线内`）在本文件下方被 `includes()` 当
//   控制信号消费（第 132-142 行：recommendation 与 `process.exit(1)`），**不得改字**。
const verdict = charBand ? (m.body > charBand.ceil ? `超阻塞线 +${m.body - charBand.ceil} 字（P1，须压缩）` : (m.body < charBand.floor ? `低于阻塞线 ${charBand.floor - m.body} 字（${floorSoft ? 'P2，不阻塞——FLOOR=soft' : 'P0，须扩写'}）` : '✓ 阻塞线内')) : '（未解析到目标字数）';

// v18.57.x（审计修订 P2）：缺口数字必须**结构化**取值，不得从 verdict 文本里按空格切。
//   旧写法 `verdict.split(' ')[2]` 对 `低于阻塞线 1710 字（P0，须扩写）` 取到的是
//   `字（P0，须扩写）`——于是 recommendation 输出 `需扩写 字（P0，须扩写） 字`，
//   消费方（主控/修订说明）**机器读不出缺多少字**。超限侧原本能用纯属巧合（`+N 字` 恰好切对）。
//   现：缺口数与方向各自成字段，文案从字段渲染。
const gapMatch = verdict.match(/(?:超阻塞线\s*\+|低于阻塞线\s*)(\d+)\s*字/);
const gapAmount = gapMatch ? Number(gapMatch[1]) : null;
const gapDirection = verdict.includes('超阻塞线') ? 'compress' : (verdict.includes('低于阻塞线') ? 'expand' : null);

// ---- ③ 残留风险清单（哪些内容可能需要压缩）----
// v18.12.3：正文区口径改走上面同一个 `bodyOf`（旧版在这里又写了一遍 `slice(0, firstEnd)`——
//   同一文件两处口径，正是「同族缺陷复发」的典型形态）。
// v19.8.0（反哺 v9 D5）：词表拆 **HARD / SOFT 两档**——「初稿/草稿/流水线/框架/审计环节/批判报告」
//   是**双义词**（既是流水线内部阶段名，也是方法论章节的合法学术词），此前一律按字面命中判「元数据
//   混入正文」→ 方法论章节被误伤。现 SOFT 走**上下文三规则**：① 位置排除（含文内引用 [n]/[Lxx] 的
//   正文段 = 合法使用）；② 路径伴随（同行含 `run/`/`drafts/`/`audits/` = 真泄漏）；③ 否则视为泄漏。
//   「框架」补入 SOFT（旧词表漏收，同类双义）。HARD（承重/一处两用/素材加载清单）是内部黑话，命中即泄漏。
const HARD_TERMS = ['承重', '一处两用', '素材加载清单'];
const SOFT_TERMS = ['初稿', '草稿', '修订说明', '审计环节', '流水线', '批判报告', '框架'];
const text = readFileSync(targetPath, 'utf8');
const body = bodyOf(text);
const bodyLines = body.split('\n');
const isBodyParaWithRef = (line) => /\[\d+\]|\[(?:L|D|C|先)\s*[\d-]+\]/.test(line);
const hasInternalPath = (line) => /(?:run\/|drafts\/|audits\/|\/drafts\/|\/audits\/)/.test(line);
// SOFT 判定：含文内引用且无内部路径 → 正文合法使用（记 note 不处置）；否则 = 真泄漏。
const softIsTrueLeak = (line) => hasInternalPath(line) || !isBodyParaWithRef(line);
const countTerm = (word) => bodyLines.reduce((n, l) => (l.includes(word) ? n + (l.match(new RegExp(word, 'g')) || []).length : n), 0);
const flowHits = [
  ...HARD_TERMS.map((w) => ({ word: w, count: countTerm(w), soft: false })).filter((x) => x.count > 0),
  ...SOFT_TERMS.map((w) => {
    const leak = bodyLines.filter((l) => l.includes(w) && softIsTrueLeak(l)).reduce((n, l) => n + (l.match(new RegExp(w, 'g')) || []).length, 0);
    const ok = bodyLines.filter((l) => l.includes(w) && !softIsTrueLeak(l)).reduce((n, l) => n + (l.match(new RegExp(w, 'g')) || []).length, 0);
    return { word: w, count: leak, soft: true, softNoteCount: ok };
  }).filter((x) => x.count > 0 || x.softNoteCount > 0),
];
// SOFT 合法使用（语境判定为正文术语，非元数据泄漏）——人读面单列，不处置、不判失败。
const flowSoftNotes = flowHits.filter((x) => x.soft && x.softNoteCount > 0)
  .map((x) => `「${x.word}」${x.softNoteCount} 处为正文合法使用（含文内引用且无内部路径）`);

// ---- ④ sha256 校验（所有 final/ 文件）----
const finalDir = dirname(targetPath);
const shaMap = {};
const hashOne = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
for (const f of readdirSync(finalDir).filter((x) => x.endsWith('.md'))) {
  shaMap[f] = { sha256: hashOne(join(finalDir, f)), bytes: readFileSync(join(finalDir, f)).length };
}

// ---- ④′ 压缩轮不变量 + 大纲 §11 预算表自动对账（v19.5.0 · 反哺 §三·15）----
// 为什么落在这里：本条反哺的病根是「压缩轮的不变量**只覆盖引用与数值**」——引用标记、
//   图位编号、分节字数三类事实在压缩轮里**各有一份独立真源**，而此前只有前两类被（人肉）看。
//   ③ 的三条新伤（P1-1 判据句被删 / P1-8 分节跌破 / P1-2 降级标注被吞）全是「真源在、无人比」。
// 口径（如实，两条边界都写死）：
//   · **分节最小硬指标真源 = 大纲的分节标题行**「（预算 ≥N 字）」——每个 H2 一章一行、与正文结构
//     一一对应；§11 预算表的「本章最小硬指标」列**同样被解析**，但**仅用于一致性提示**
//     （两处都算会得出两个不同的下限和，判据必须唯一）。
//   · **自动探测到的基线**（目标同级 `drafts/` 里版本号**次高**的 `初稿-vN.md`）在内容与目标
//     逐字节相同时**跳过不变量比对**——否则「复核一份未动的稿子」会被读成「引用多重集被改动」。
//     显式传 `--baseline` 时不做该豁免（调用方声明了「这确实是压缩前后的两版」）。
const CITATION_RE = /\[(?:L|D|C|先)\d{1,3}\]/g;   // 与三卡编号体例同源（含 [先NN]）
const FIGURE_RE = /\[图\s*(\d+)/g;                // 图位编号（[图1：说明] / [图1]）
// 判据/限定关键词面（§三·14 与 §三·15 的并集：15 条点名「判据/标准/口径」，14 条为「若/则/判据/
//   标准/口径/前提/限定」）——并集取**更宽**的一侧，宁可多抽句子交人判，不可漏抽。
const CRITERION_RE = /若|则|判据|标准|口径|前提|限定/;
/**
 * 正文分节：以大纲的分节标题为真源，逐节切当前正文的字符数。
 * 仅取 H2（`## N 标题`）——大纲的分节下限是**章级**指标；H3 子节的“预算 ≥N”不参与合计
 * （本轮实测：六章标题下限之和 = 8,000 = 总量上限；若把 H3 一并相加会得到 10,000+，
 *  于是「下限之和 ≤ 目标」永远不可满足 —— 正是本条反哺的病根形态）。
 */
const parseOutlineMinima = (outlineText) => {
  // ① 标题式真源：`## 1 引言（预算 ≥850 字）`。括号里除 `预算 ≥N 字` 外**允许追加说明**
  //    （实测：`## 5 讨论（预算 ≥1880 字）` 干净，而 `## 4 研究结果（预算 ≥2960 字；主体，占全篇最大权重）`
  //     在数字后还有分号+说明——旧式 `≥\s*(\d+)\s*字\s*）` 要求「字」后紧跟闭括号，会把 §4 整节漏掉、
  //     下限和从 8,260 掉到 5,040 ⇒ 「下限和已顶满」永不触发，正是本条反哺的病根在实现侧复现）。
  const heading = [];
  for (const h of h2Headings(outlineText)) {
    const m = /[（(]\s*预算\s*[≥>=]+\s*(\d+)\s*字[^（()）]{0,24}[）)]/.exec(h.title)
      || /[（(]\s*预算\s*[≥>=]+\s*(\d+)/.exec(h.title);
    if (m) heading.push({ title: h.title, min: Number(m[1]) });
  }
  // ② §11 预算表式真源：`| §1 引言 | 850 | ≥850 |`（仅取「章节」列不是合计/摘要的行）
  const table = [];
  for (const raw of outlineText.split('\n')) {
    const cells = raw.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
    if (cells.length < 3) continue;
    const sec = cells[0];
    if (!/^§\s*\d/.test(sec)) continue;                     // 合计 / 摘要 行不进真源
    const hard = /^[≥>=]+\s*(\d+)/.exec(cells[cells.length - 1]);
    if (!hard) continue;
    table.push({ section: sec, min: Number(hard[1]) });
  }
  return { heading, table };
};
const bodyCountsByHeading = (docText) => {
  const hs = h2Headings(docText);
  const masked = maskFences(docText);
  return hs.map((h, i) => {
    const from = docText.indexOf('\n', h.index) + 1;
    const to = i + 1 < hs.length ? hs[i + 1].index : masked.length;
    return { title: h.title, count: countHan(masked.slice(from, to)) };
  });
};
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const extractCitations = (t) => (maskFences(t).match(CITATION_RE) || []).slice().sort();
const extractFigures = (t) => [...new Set((maskFences(t).match(FIGURE_RE) || []).map((x) => x.replace(/\D/g, '')))].sort();
/** 含判据/标准/口径关键词的**整句**集合（分句符含中英文句读；整句归一化后比对，防排版差异假阳性）。 */
const criterionSentences = (t) => {
  const out = [];
  for (const para of maskFences(t).split(/\n{2,}/)) {
    const p = para.trim();
    if (!p || p.startsWith('#') || p.startsWith('|') || p.startsWith('>')) continue;   // 标题/表格/引用块不算「句」
    for (const s of p.split(/(?<=[。；！？!?])|\n/)) {
      const n = norm(s);
      if (n && CRITERION_RE.test(n)) out.push(n);
    }
  }
  return out;
};
const outlinePath = opts['--outline'] ? opts['--outline'] : join(projRoot, 'analysis', '分析大纲.md');
const outlineText = existsSync(outlinePath) ? readFileSync(outlinePath, 'utf8') : null;
const minima = outlineText ? parseOutlineMinima(outlineText) : { heading: [], table: [] };
const bodySections = bodyCountsByHeading(text);

// 基线（压缩前版本）：显式 `--baseline` 优先；否则在目标同级 `drafts/` 里取版本号**次高**的初稿。
const resolveBaseline = () => {
  if (opts['--baseline']) return { path: opts['--baseline'], explicit: true };
  const dir = join(projRoot, 'drafts');
  if (!existsSync(dir)) return { path: null, explicit: false };
  const ver = (n) => Number((n.match(/初稿-v(\d+)\.md$/) || [])[1] ?? NaN);
  const nowV = ver(basename(targetPath).endsWith('.md') ? basename(targetPath) : '');
  const cands = readdirSync(dir).map((n) => ({ n, v: ver(n) })).filter((x) => Number.isFinite(x.v));
  const lower = cands.filter((x) => (Number.isFinite(nowV) ? x.v < nowV : true)).sort((a, b) => b.v - a.v);
  return { path: lower.length ? join(dir, lower[0].n) : null, explicit: false };
};
const baseRef = resolveBaseline();
const baseText = baseRef.path && existsSync(baseRef.path) ? readFileSync(baseRef.path, 'utf8') : null;

/**
 * **多重集**差：按「元素 → 出现次数」逐项相减，返回 base 比 cur **多出的那几处**。
 * v19.5.0（本批实测修正）：旧式 `base.filter(x => !cur.includes(x))` 是**集合**判据（只看「在不在」），
 *   而本不变量自称的是**多重集**（`extractCitations` 的注释即写「多重集」、04/07 卡也写「两版完全一致」）。
 *   两者在**同一编号出现多次**的稿子上不等价：实测（`汉`×600 + `[L01][L02][D01]` → `[L01][D01]`）
 *   旧判据得 `lost=[] gained=[]` ⇒ **改动了引用却 exit 0**；而 B25-B2 用例正是照「多重集」写的，
 *   于是它红在实现侧而不是测试侧。判据一句话：**声明「多重集」就必须按计数比，按存在性比就是把门写虚**。
 *   本仓既有先例同一形态：图位侧用 `[...new Set(...)]` 去重后才比（那里 `Number` 去重语义正确），
 *   但引用侧去重会**吞掉「删掉重复引用的其中一处」**——正是压缩轮最常见的失效形态。
 */
const multisetLost = (base, cur) => {
  const pool = new Map();
  for (const x of cur) pool.set(x, (pool.get(x) || 0) + 1);
  const lost = [];
  for (const x of base) {
    const n = pool.get(x) || 0;
    if (n > 0) pool.set(x, n - 1);
    else lost.push(x);
  }
  return lost;
};

/** 不变量比对：引用标记多重集 / 图位编号集 / 判据句存活 三项。 */
const compareInvariants = (cur, base) => {
  const violations = [];
  const curCit = extractCitations(cur);
  const baseCit = extractCitations(base);
  const lostCit = multisetLost(baseCit, curCit);
  const gainedCit = multisetLost(curCit, baseCit);
  if (lostCit.length || gainedCit.length) {
    violations.push({
      id: 'inv-citations',
      level: 'P1',
      detail: `引用标记多重集被改动：压缩后少 ${lostCit.length} 处（${[...new Set(lostCit)].slice(0, 5).join(' ')}）、`
        + `多 ${gainedCit.length} 处（${[...new Set(gainedCit)].slice(0, 5).join(' ')}）`,
    });
  }
  const curFig = extractFigures(cur);
  const baseFig = extractFigures(base);
  const lostFig = baseFig.filter((x) => !curFig.includes(x));
  const gainedFig = curFig.filter((x) => !baseFig.includes(x));
  if (lostFig.length || gainedFig.length) {
    violations.push({
      id: 'inv-figures',
      level: 'P1',
      detail: `图位编号集被改动：少 [图${lostFig.join('] [图')}]、多 [图${gainedFig.join('] [图')}]`,
    });
  }
  const baseSent = criterionSentences(base);
  const curSent = new Set(criterionSentences(cur));
  const killed = [...new Set(baseSent.filter((s) => !curSent.has(s)))];
  if (killed.length) {
    violations.push({
      id: 'inv-criterion-sentences',
      level: 'P1',
      detail: `含判据/标准/口径关键词的句子被整句删除 ${killed.length} 句（压缩轮不变量 ②：不得整句删除，`
        + `须逐句判是否承重）｜例：${killed.slice(0, 3).map((s) => `「${s.slice(0, 40)}…」`).join('')}`,
      samples: killed.slice(0, 10),
    });
  }
  return violations;
};

let invariants = { checked: false, reason: null, violations: [] };
if (!baseText) {
  invariants.reason = `未找到压缩前基线（--baseline 未给且 ${join(projRoot, 'drafts')} 下无次高版本初稿）→ 不变量比对**未核**（不是已核）`;
} else if (norm(baseText) === norm(text) && !baseRef.explicit) {
  invariants.reason = `自动探测到的基线 ${basename(baseRef.path)} 与目标内容一致（本轮无改动）→ 跳过不变量比对`;
} else {
  invariants.checked = true;
  invariants.baseline = baseRef.path;
  invariants.violations = compareInvariants(text, baseText);
}

// 大纲对账：逐节实值 vs 该节最小硬指标（跌破 → P1 + exit 非 0）。
const outlineFindings = [];
if (!outlineText) {
  outlineFindings.push({ id: 'outline-missing', level: 'P2', detail: `未读到大纲（${outlinePath}）→ 分节硬指标对账**未核**（不是已核）` });
} else if (!minima.heading.length) {
  outlineFindings.push({ id: 'outline-minima-missing', level: 'P2', detail: '大纲里未解析到任何「（预算 ≥N 字）」分节标题 → 分节硬指标对账**未核**' });
} else {
  for (const s of minima.heading) {
    const key = s.title.replace(/^##\s*/, '').replace(/[（(].*$/, '').trim();
    const hit = bodySections.find((x) => x.title === s.title || x.title.startsWith(key) || key.startsWith(x.title.replace(/[（(].*$/, '').trim()));
    if (!hit) continue;
    if (hit.count < s.min) {
      outlineFindings.push({
        id: 'section-below-min', level: 'P1', section: s.title, min: s.min, actual: hit.count,
        detail: `「${s.title}」实测 ${hit.count} 字 < 本节最小硬指标 ${s.min} 字（跌破 ${s.min - hit.count} 字）`,
      });
    }
  }
}
const headingSum = minima.heading.reduce((a, x) => a + x.min, 0);
const tableSum = minima.table.reduce((a, x) => a + x.min, 0);
const outlineReconcile = {
  outlinePath: outlineText ? outlinePath : null,
  perSectionMinima: minima.heading.map((x) => `${x.title} ≥ ${x.min}`),
  minimaSum: headingSum || null,
  sectionActual: bodySections.map((x) => `${x.title} = ${x.count}`),
  findings: outlineFindings,
};

// 目标计算冲突规则（§一·2）：禁止同时要求「守各节下限」与「落回 ±2%」，冲突时**先守硬阈**。
//   · 硬阈 = 目标 × 1.05（本文件 `charBand.ceil`，即脚本的 G8 阻塞上界）；
//   · ±2% 带 = 目标 × 1.02（「落回 ±2%」里的上界）；
//   · 分节下限合计 = 大纲各节最小硬指标之和。
//   三者同时成立 ⇔ `下限和 ≤ 目标×1.02` **且** `下限和 ≤ 目标×1.05`（后者由前者蕴含，
//   但**仍逐条列出**，因为调用方读到的是原因，不是推论）。不成立即记 conflict + 取向。
const hardCeil = target ? Math.round(target * 1.05) : null;
const bandCeil2 = target ? Math.round(target * 1.02) : null;
const conflicts = [];
if (target && headingSum) {
  const over = [];
  if (bandCeil2 !== null && headingSum > bandCeil2) over.push(`±2% 带（≤ ${bandCeil2} 字）`);
  if (hardCeil !== null && headingSum > hardCeil) over.push(`硬阈（≤ ${hardCeil} 字）`);
  if (over.length) {
    conflicts.push(`各节下限之和 ${headingSum} 字已超出 ${over.join(' 与 ')}——`
      + `「守各节下限」与「落回 ±2%」**不可同时满足**；按取向**先守硬阈 ${hardCeil} 字，再谈分节下限**`
      + `（即在硬阈内尽量贴近各节下限，不得为一个分节下限而破硬阈）`);
  }
}
// §一·2 的 5% 弹性提示：下限和顶到目标 × 0.95 以上时，写作只要有两节略高于下限就必然超软上限。
if (target && headingSum) {
  const elasticCap = Math.round(target * 0.95);
  if (headingSum > elasticCap) {
    conflicts.push(`各节★下限之和 ${headingSum} 字已顶满目标 ${target} × 0.95（= ${elasticCap} 字）——`
      + `请留 5% 弹性：任两节略高于下限即超软上限。**★下限为软目标**（总和允许 ±5%），`
      + `须自减最低权重节的下限并在大纲里写明理由`);
  }
}

// 大纲 §11 表与分节标题**两处真源不一致**（判定以标题式为准，此处只作提示——两处都算会得出两个下限和）。
if (target && headingSum && tableSum && tableSum !== headingSum) {
  conflicts.push(`大纲分节标题式下限和 ${headingSum} ≠ §11 预算表式下限和 ${tableSum}——`
    + `判定以**分节标题行**（「（预算 ≥N 字）」）为准；请把 §11 表与本轮实际结构对齐（表是给写手读的，不得与标题真源相左）`);
}
const invariantViolations = invariants.violations.concat(outlineFindings.filter((f) => f.level === 'P1'));
const reconcileFailed = invariantViolations.length > 0;
// v19.5.0（§三·15 收口 · 本批实测修正）：旧式三元 `conflicts.length ? conflicts : …`
//   把 `note` **钉死在目标计算冲突一族**上——`conflicts` 一空（极常见：下限和未顶满弹性阈值、
//   两处真源恰好一致），note 即被强制置为 `[]`，**invariantViolations 一条也不进人读面**。
//   实测形态：夹具「少 1 处引用」→ `reconcileFailed=true` + `invariants.violations=[inv-citations]`
//   而 `note=[]`；调用方（T7/T8/主控）按 07 卡 §压缩轮专项 的说明「读 note / invariants」时，
//   读到的是「无异常」。判据一句话：**决定退出码的那份清单，必须与 note 里的清单一字不差**。
//   故此处把 reconcile 的不通过项逐条并入 `note`（前缀 `[对账]` 与目标冲突提示区分开）。
const note = conflicts.slice();
for (const v of invariantViolations) note.push(`[对账] ${v.detail}`);
if (!headingSum && !conflicts.length) note.push('大纲未提供分节下限 → 目标计算冲突规则未参与判定');

// ---- ⑤ 刷新一致性门 + 证据包 + 审计视图 ----
let ccResult = null;
let bundleResult = null;
if (!dryRun) {
  // 项目参数**原样透传**用户传入的 `<run/项目名>`（与 apply-revision-cycle.mjs 同源）；旧版把
  //   `basename(projRoot)` 传给下游 —— 那只是目录名（丢了 `run/` 前缀），下游按「相对 cwd
  //   的项目路径」解析即落空。
  const projArg = positionals[0];
  // 技能目录 = 脚本目录的上一级（`<skill>/scripts/` → `<skill>/`）。v18.12.0 L-61 修正：旧版此处
  //   写 `join(repoRoot, 'skills/lunheng-article-pipeline', 'scripts', …)`，**引用了本文件从未定义的
  //   变量** `repoRoot` → 非 dry-run 必然 ReferenceError → exit-guard 归为内部错误 exit 70 →
  //   决策 JSON 里一致性门与证据包恒为 `exit null`（收尾阶段主控据此误判门未跑）。
  const skillRoot = join(scriptDir, '..');
  const cc = spawnSync(nodeBin, [join(skillRoot, 'scripts', 'consistency-check.mjs')], { encoding: 'utf8' });
  ccResult = { status: describeSpawn(cc), tail: (cc.stdout || '').split('\n').slice(-3).join(' ') };
  if (!flags.has('--skip-bundle')) {
    // v18.12.0 L-66：`--skip-bundle` 此前只在 `parseArgs` 白名单里挂着、**从未被读取**——声明了却
    //   无效果的开关（主控以为跳过、实际照跑）。现与 apply-revision-cycle.mjs 同义：跳过**证据包**
    //   刷新；一致性门仍刷新（只读，不写项目产物）。
    const bb = spawnSync(nodeBin, [join(scriptDir, 'build-evidence-bundle.mjs'), projArg, '--summary'], { encoding: 'utf8' });
    bundleResult = { status: describeSpawn(bb), tail: (bb.stdout || '').split('\n').slice(-3).join(' ') };
  }
}

// ---- ⑤′ 候选压缩清单（v19.19.3 · 反哺报告-2026-10-19 M1）-------------------------------
// 病根（实测）：压缩轮是**最贵的机械轮**（xingbie 单篇 压实/收口/引用闭环/收尾修复四类 = 34.3M，
//   占该篇 23.1%），而轮次账本**按设计把这类轮排除在额度与计量之外**（无上限）。它之所以必须 spawn T5，
//   是因为本脚本 ③ 只产「残留风险清单」（哪些词/哪节可能超），**不产 apply-diff 可吃的四族条目** ⇒
//   清单只能由模型出，于是 T5 被 spawn 去「出清单 + 顺带重写」。
// 现规则：超阻塞线（compress 方向）时，本脚本直接产出**可机械应用**的候选清单 `drafts/段级diff-vN.md`：
//   · 只收**整句级**的「元话语/过渡句」（`本节/本章/下面/值得注意的?是/综上…` 开头）；
//   · **四不收**：带文内引用（`[n]`/`[Lxx]`）、带图位（`[图N`）、含判据词（`若/则/判据/标准/口径/前提/限定`）、
//     **含任何数字**（数值守恒）——这四类正是压缩轮不变量（④′）守的东西，**从生产端就不产出它们**；
//   · 全文**唯一出现**才收（apply-diff 按 `expect` 命中次数断言，重复句会让「删哪一处」有歧义）；
//   · 每条给 `[P1-n] / 定位 / 现况串 / 修改后串 / 两侧汉字`——apply-diff 直接可吃。
// 边界（如实，三条）：① **脚本只给「可机械删」的那一档**；论证删减、改写、补写**不进本清单**（须 T5）；
//   ② 默认**只写文件、不应用**——主控须逐条批准后自己跑 `apply-diff --in-place`；
//   ③ `--dry-run` 只打印不落盘（与全脚本 `dry-run 只影响写盘、不影响判定` 同一约定）。
const META_SENTENCE_RE = /^(?:本节|本章|本文|下面|接下来|首先|其次|再次|最后|综上|总的来说|总体来看|值得注意的?是|值得指出的?是|需要指出的是|必须指出的是|应当看到|不难发现|换言之|也就是说)[，,、：:]?/;
const buildCompressionCandidates = (bodyText) => {
  const found = [];
  bodyText.split('\n').forEach((line, idx) => {
    const trimmed = line.trim();
    // 只处理**普通正文段落行**：跳过标题/表格/引用块/列表/围栏
    if (!trimmed || /^[#|>\-```!]/.test(trimmed)) return;
    for (const raw of trimmed.split(/(?<=[。！？])/)) {
      const t = raw.trim();
      if (t.length < 8 || t.length > 120) continue;          // 太短删了没意义；太长多半承载信息
      if (!META_SENTENCE_RE.test(t)) continue;
      if (/\[\d+\]|\[(?:L|D|C|先)/.test(t)) continue;        // 引用标记 → 不删（不变量 ①）
      if (/\[图\s*\d+/.test(t)) continue;                     // 图位 → 不删（不变量 ②）
      if (CRITERION_RE.test(t)) continue;                     // 判据句 → 不删（不变量 ③）
      if (/\d/.test(t)) continue;                             // 数值 → 不删（守恒）
      if (bodyText.split(t).length - 1 !== 1) continue;       // 必须在全文唯一出现
      found.push({ line: idx + 1, old: t });
    }
  });
  return found;
};
const candidates = gapDirection === 'compress' ? buildCompressionCandidates(body) : [];
// 下一版号（清单与下一版正文对齐）：① `drafts/初稿-vN.md` 最大版 +1（正常形态）；
//   ② 无草稿（夹具/首轮直写）→ 取目标正文名里的数字 +1；③ 都没有 → 2（第一轮修订的默认号）。
const nextVer = (() => {
  let maxDraft = 0;
  try {
    for (const n of readdirSync(join(projRoot, 'drafts'))) {
      const mm = /^初稿-v(\d+)\.md$/.exec(n);
      if (mm) maxDraft = Math.max(maxDraft, Number(mm[1]));
    }
  } catch { /* 无 drafts/ 目录：走 ② ③ */ }
  if (maxDraft > 0) return maxDraft + 1;
  const tgt = Number(basename(targetPath).match(/\d+/)?.[0] || 0);
  return tgt > 0 ? tgt + 1 : 2;
})();
const listPath = join(projRoot, 'drafts', `段级diff-v${nextVer}.md`);
const renderCandidateList = () => [
  `# 段级 diff 候选清单（压缩轮 · 自动生成 · v${nextVer}）`,
  '',
  '> **来源**：`apply-compression-cycle.mjs` ⑤′（v19.19.3）。只收「元话语/过渡句」的**整句删除**，',
  '> 且**不含引用 / 图位 / 判据词 / 数字**、全文唯一出现——四类不变量从生产端就不产出。',
  '> **用法**：主控**逐条批准**后 `node scripts/apply-diff.mjs <被压正文> <本文件> --in-place`，',
  '> 再复跑 `apply-compression-cycle.mjs` 核四类不变量。不批准就删掉该条目（本文件不会自动应用）。',
  '> **边界**：论证删减/改写**不在本清单**（须 spawn T5）；本清单只是把「出清单」这一步机械化。',
  '> **格式契约**：只写 定位 / 现况 / 修改 三种行——`apply-diff` 把其余非空行记进 `dropped_lines` 并 exit 1',
  '> （v19.6.7 起按条目点名），故「估算字数」这类元注记**刻意不进本清单**（汉字数由应用器实测）。',
  '',
  ...candidates.map((c, k) => [
    `### [P1-${k + 1}]`,
    `- **定位**：第 ${c.line} 行（元话语整句，删 ${countHan(c.old)} 汉字）`,
    `- **现况**：${c.old}`,
    '- **修改**：',
    '',
  ].join('\n')),
].join('\n');
if (!dryRun && candidates.length) {
  writeReport(listPath, renderCandidateList(), { label: '--emit-candidates' });
}

// ---- ⑥ 输出压缩决策 JSON ----
const result = {
  project: positionals[0],
  targetPath,
  chars: { body: m.body, full: m.full },
  target, charBand, verdict,
  // v18.57.x（审计修订 P2）：缺口量与方向的结构化字段——文案仅供人读，机器请读这两个字段。
  charGap: gapAmount,
  gapDirection,
  // 旧字段名 `g5` 已随 2026-09-29 命名更正移除（字数归属 = G8，G5 = 学术规范），**刻意不留别名**。
  flowHits,
  // v19.8.0（反哺 v9 D5）：SOFT 双义词被语境判定为「正文合法使用」的清单——只作人读提示，不处置。
  flowSoftNotes,
  sha256: shaMap,
  consistencyCheck: ccResult ? ccResult.status : (dryRun ? 'dry-run' : 'skipped'),
  bundle: bundleResult ? bundleResult.status : (dryRun ? 'dry-run' : (flags.has('--skip-bundle') ? 'skipped(--skip-bundle)' : 'skipped')),
  // v19.5.0（压缩/字数闭环批 §一·2 + §三·15）：
  //   `note` = 目标计算冲突与弹性提示 + **对账不通过项**（决定 exit 码的那份清单，逐条同文入 note，前缀 `[对账]`）；
//   `targetConflict` / `reconcileFailed` 为机器字段。
  note,
  targetConflict: conflicts.length > 0,
  // v19.19.3（M1）：可机械应用的压缩候选清单（只在 compress 方向产出；dry-run 只打印不落盘）
  compressionCandidates: {
    count: candidates.length,
    file: candidates.length && !dryRun ? listPath : null,
    dryRun,
    note: candidates.length
      ? '已按 apply-diff 四族格式生成候选清单（仅「元话语整句」一档）；主控逐条批准后跑 apply-diff --in-place'
      : (gapDirection === 'compress' ? '未发现可机械删除的候选（论证删减类须 spawn T5，本清单刻意不收）' : '非压缩方向 → 不生成候选清单'),
  },
  outlineReconcile,
  invariants,
  reconcileFailed,
  recommendation: verdict.includes('超阻塞线')
    ? `需进入 v(${Number(basename(targetPath).match(/\d+/)?.[0] || '3') + 1}) 修订轮；压缩目标 ${gapAmount ?? '?'} 字（按 maxRounds=${maxRounds} 轮内）`
    : verdict.includes('低于阻塞线')
    ? `需扩写 ${gapAmount ?? '?'} 字（按 §12 补检索方向）`
    : (reconcileFailed ? '⚠ 阻塞线内，但压缩轮不变量/分节硬指标对账不通过（见 invariants / outlineReconcile）' : '✓ 无需修订'),
};
console.log(JSON.stringify(result, null, 2));
// v18.16.0（A-6 反哺）：原 `&& !dryRun` 让 dry-run 模式即便判定超阻塞线也 exit 0，
//   违反「dry-run 只影响写盘、不影响判定」约定（T7/T8 据 exit 决定是否触发 T5 修订）。
//   现去掉 `!dryRun` —— 无论是否 dry-run，超阻塞线统一 exit 1。
// v19.5.0（§三·15）：压缩后自动对账「不满足即 exit 非 0」——分节跌破最小硬指标、或任一不变量
//   被破坏，与「超阻塞线」同解（都指向「须再进一轮修订」），故**合用 exit 1**、不新开码
//   （`repo-hygiene-check` 规则⑧ 的登记集合 `[0,1,10,70]` 不变）。
// v19.11.2（反哺 2026-10-17 §P0-2）：**补上「低于阻塞线」**。旧版只匹配「超阻塞线」，而 :99 的
//   verdict 明写「低于阻塞线 N 字（**P0**，须扩写）」→ 越严重的 P0 反而 exit 0，P1 却 exit 1
//   （严重度判反，已复现：正文 8 字 / 目标 3000 → exit 0）。主控铁律是只认 exit code，故必须为 1。
// v19.12.0（L1 批）：v19.11.2 那条「不足也 exit 1」的修法**保留其本意**，但补 `FLOOR=` 分流——
//   简报标 `FLOOR=soft`（发布向文类）时，不足侧只报告、不阻塞（exit 0）；`hard` / 缺标记时行为不变。
//   **不改文案前缀**（`低于阻塞线` 仍被 `gapDirection` / `recommendation` 的 `includes()` 消费）。
if (verdict.includes('超阻塞线') || (!floorSoft && verdict.includes('低于阻塞线')) || reconcileFailed) process.exit(1);
process.exit(0);