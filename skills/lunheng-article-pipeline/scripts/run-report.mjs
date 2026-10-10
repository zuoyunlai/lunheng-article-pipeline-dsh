#!/usr/bin/env node
// run-report.mjs — 论衡单项目「运行与校验」报告生成器（v18.89.0 新增）
//
// 用途：把一个 `run/<项目>/` 里**本已存在**的产物（状态机 / 四门回执 / 轮次账本 / M 门报告 /
//   G 项机检 / 字数版本流 / 来源索引 / 证据包 manifest / 图件 SVG）聚合成**一张自包含 HTML 看板**
//   +（可选）一份机器可读 JSON 边车，让人一眼看清「这个项目跑到哪了、每道门给出了什么判定、
//   字数怎么演进、交付物齐不齐」。**纯只读聚合**：不新增任何留痕义务（与 `lunheng-stats` /
//   `scripts/flow-metrics.mjs` 同判据），也不参与任何门判定（它是**观测**，不是闸门）。
//
// 用法：
//   node scripts/run-report.mjs <项目目录> [--out <html>] [--json <文件>] [--no-score] [--quiet]
//     · <项目目录> 须落在 `<cwd>/run` 之内（三层围栏，与 `lunheng-stats.mjs` 同口径）
//     · --out  缺省 `<项目>/final/运行报告.html`（自包含：内联 SVG + CSS，零外部引用、零 CDN、零 JS 依赖）
//     · --json 可选边车（同一份采集结果，机器可读；GUI 面板/后续比对可直接消费）
//     · --no-score 跳过 spawn `quality-score.mjs`（无子进程环境 / 只要快照时用；分析面板如实标 N/A）
//
// 退出码（与 M 门的 1/2/3 刻意分离，同 `self-check.mjs` 一族）：
//   0  = 已产出（**面板允许有 N/A** —— 见下方「缺项分级」）
//   3  = **缺关键输入**：`status.md` 不存在（项目身份与状态机不可读）——仍会产出报告，但须人工核；
//        这是「须人工核」信号，**不是内容失败**，也不得被自动化链当作门结论消费
//   10 = 参数或路径错（未知参数 / 缺值 / 项目不在 <cwd>/run 内 / 目标与源文件同文件）
//   70 = 内部错误（渲染或落盘异常，经 `_lib/exit-guard.mjs` 归类）
//
// 缺项分级（为什么不是「缺任何东西都 exit 3」）：流水线**中段**项目天然缺下游产物——Phase 1 时
//   `final/M-Gate-Report.json` 尚未生成，T7 未跑时没有 `audits/*gaudit*.json`。若这些一律算失败，
//   报告在**最需要它的时候**（流水线正跑着）反而恒红，信号就被训练掉了。故分级为：
//   · **关键输入**（exit 3）：仅 `status.md` —— 它是唯一的项目身份 + 状态机真源；
//   · **面板缺口**（warn，不改退出码）：其余产物缺 → 面板标 N/A + HTML 与 stdout 逐条写明缺什么。
//
// 为什么口径不自己写一份（本仓最贵的一类缺陷）：
//   · 汉字数直接 import `_lib/han.mjs` + `_lib/sections.mjs`——与 `count-chars.mjs` 同源
//     （`## 摘要` 之后 → 首个文末节之前）。**不重实现**：历史上「两处口径必然发散」已被审计
//     反复抓到（见 `_lib/sections.mjs` 文件头 §背景）。
//   · 四门时序优先取 `audits/gate-receipts.jsonl` 的 `askedAt/answeredAt`（机器面），无回执时才
//     回退解析 `阶段确认-Phase*.md` §6「回复时间」（`scripts/flow-metrics.mjs` 同口径）。
//   · 合规分**不自算**——spawn `quality-score.mjs` 取其 JSON（唯一真源），并把该脚本自带的
//     `validity` 效度边界**原样转述**到面板上（它只是门计数代理，不支撑「论证质量」）。
//
// 边界（如实声明，不假装）：
//   · 门判定**只读既有报告**，本脚本不重跑门；面板上的 M 门/G 项数字 = 那些报告落盘时刻的快照
//     （HTML 每段都标了数据源路径）。
//   · `agents-log.md` 由子代理**写完才追加**——角色运行期间本脚本看不到中间产物（面板只能反映
//     已落盘的事实）。这是产物模型决定的，不是本脚本的限制。
//   · 报告写入**项目目录内**（缺省 `final/运行报告.html`）——若某项目对 `final/` 有额外洁癖，
//     用 `--out` 指到别处即可；写盘走 `_lib/destructive-write.mjs`（同文件守卫 + 时间戳 .bak）。
//   · 不做浏览器自动化、不自动打开页面（论衡执行边界的既有红线）。
import { readFileSync, existsSync, readdirSync, statSync, rmSync, realpathSync } from 'node:fs';
import { join, basename, dirname, resolve, sep, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { installExitGuard } from './_lib/exit-guard.mjs';
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs';
import { writeReport } from './_lib/destructive-write.mjs';
import { countHan } from './_lib/han.mjs';
import { bodyStartAfterAbstract, bodyBounds } from './_lib/sections.mjs';

installExitGuard();

const SCRIPT_DIR = import.meta.dirname;
const SCRIPT_NAME = 'run-report.mjs';
const USAGE = `用法: node scripts/${SCRIPT_NAME} <项目目录> [--out <html>] [--json <文件>] [--no-score] [--quiet]

  项目目录须落在 <cwd>/run 之内；缺省输出 <项目>/final/运行报告.html（自包含，零外部引用）。
  退出码: 0 已产出 / 3 缺 status.md（关键输入缺失，仍出报告）/ 10 参数或路径错 / 70 内部错误`;

// ── 参数（唯一实现 = _lib/cli-args.mjs，fail-closed）───────────────────────
let flags, opts, positionals;
try {
  ({ flags, opts, positionals } = parseArgs(process.argv.slice(2), {
    flags: ['--no-score', '--quiet', '-h', '--help'],
    values: { '--out': 'final/运行报告.html', '--json': 'final/运行报告.json' },
    minPositionals: 1,
    maxPositionals: 1,
    positionalHint: '<项目目录>',
  }));
} catch (e) {
  if (e && e.code === USAGE_CODE) { console.error(e.message); console.error(USAGE); process.exit(10); }
  throw e;
}
if (flags.has('-h') || flags.has('--help')) { console.log(USAGE); process.exit(0); }
const QUIET = flags.has('--quiet');
const WITH_SCORE = !flags.has('--no-score');
const projectDir = resolve(positionals[0]);
const projectName = basename(projectDir);
const outHtml = resolve(opts['--out'] || join(projectDir, 'final', '运行报告.html'));
const outJson = opts['--json'] ? resolve(opts['--json']) : null;

// ── 三层围栏：项目目录必须落在 <cwd>/run 之内（与 lunheng-stats.mjs 逐字同口径）────
// 为什么内联而不 import lib/run-path-fence.mjs：本脚本须在**镜像部署**（只复制 skills/ 目录、
//   无 lib/）下自足运行（scripts/_lib 自足原则，同 exit-guard / cli-args）；两侧同入 realpath
//   空间后判包含（防 junction 逃逸；realpath 失败降级字符串规范化，不劣于字符串比较）。
// 大小写归一只在 Windows 做（POSIX 大小写敏感，无条件 toLowerCase 会把 RUN/ 与 run/ 误判为同一处）。
const rpNorm = (p) => {
  let q = p;
  try { q = realpathSync.native(p); } catch { /* 不存在/不可达 → 用原路径（存在性另查） */ }
  const s = resolve(q).replace(/[\\/]+$/, '').replace(/\//g, sep);
  return process.platform === 'win32' ? s.toLowerCase() : s;
};
{
  const runBase = join(process.cwd(), 'run');
  const aBase = rpNorm(runBase), aRoot = rpNorm(projectDir);
  if (aRoot !== aBase && !aRoot.startsWith(aBase + sep)) {
    console.error(`项目目录超出 <工作区>/run 范围：${projectDir}（防止把只读读面指向任意目录）`);
    console.error('→ 退出码 10（参数或路径错误）：请把 <项目目录> 指到 run/ 之下');
    process.exit(10);
  }
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    console.error(`项目目录不存在或不是目录：${projectDir}`);
    process.exit(10);
  }
  if (samePath(outHtml, projectDir)) { console.error('--out 不能指向项目目录本身'); process.exit(10); }
  if (outJson && samePath(outJson, projectDir)) { console.error('--json 不能指向项目目录本身'); process.exit(10); }
}
function samePath(a, b) { return rpNorm(a) === rpNorm(b); }

// ── 读写工具 ────────────────────────────────────────────────────────────
const sources = [];        // 本次实际读过的源文件（同文件守卫用）
const notes = [];          // 数据源与 N/A 如实登记（缺什么写什么，绝不伪造数字）
function readText(p) {
  try { const t = readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); sources.push(p); return t; } catch { return null; }
}
function readJson(p) { const t = readText(p); if (t === null) return null; try { return JSON.parse(t); } catch { return null; } }
function listDir(p) { try { const d = readdirSync(p); return d; } catch { return []; } }
function sizeOf(p) { try { return statSync(p).size; } catch { return 0; } }
function fmtBytes(n) { return n >= 1024 * 1024 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'; }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function cut(s, n) { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
/** 表格/标题里的 markdown 残渣清理（**加粗**、`代码`、列表符）——只为可读，不改任何数字 */
function mdPlain(s) { return String(s ?? '').replace(/\*\*/g, '').replace(/`/g, '').replace(/^\s*[-*•]\s*/, '').replace(/\s+/g, ' ').trim(); }
function miss(what, detail) { notes.push({ level: 'miss', what, detail }); }
function warn(what, detail) { notes.push({ level: 'warn', what, detail }); }

// ── 采集 ①：status.md ───────────────────────────────────────────────────
const statusText = readText(join(projectDir, 'status.md'));
const st = { title: null, titleChars: null, genre: null, target: null, tolerance: null, hardRange: null, started: null, phaseLine: null, phaseRows: [], deliveryRows: [], loopBullets: [], pending: [], signedAt: null };
if (statusText === null) { miss('status.md', '缺 status.md —— 项目身份 / Phase 进度 / 交付清单无法采集（其余面板仍按现有产物尽力给出）'); }
else {
  const m = (re) => { const x = re.exec(statusText); return x ? x[1].trim() : null; };
  st.title = m(/\*\*题名\*\*[：:]\s*([^（(\n|]+)/);
  st.titleChars = m(/\*\*题名\*\*[：:][^\n]*?（(\d+)\s*字）/);
  st.genre = m(/\*\*文类\*\*[：:]\s*`?([^`｜|\n]+)/);
  st.target = m(/\*\*目标篇幅\*\*[：:]\s*([^｜|\n]+)/);
  st.tolerance = m(/纠偏线\s*([0-9–\-—~～]+)/);
  st.hardRange = m(/G8\s*硬阈\s*([0-9–\-—~～]+)/);
  st.started = m(/\*\*启动时间\*\*[：:]\s*([^\n]+)/);
  st.phaseLine = m(/-\s*(?:🔄|✅|⏸)\s*\*\*[^*]+\*\*\s*—\s*([^\n]+)/);
  st.signedAt = m(/主人\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?\s*\+08:00)\s*签收/);
  const phaseTable = /## Phase 进度[\s\S]*?\n((?:\|[^\n]*\n)+)/.exec(statusText);
  if (phaseTable) {
    st.phaseRows = phaseTable[1].split('\n').map((l) => l.trim())
      .filter((l) => l.startsWith('|') && !/^\|[\s\-:|]+\|$/.test(l))
      .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
      .filter((c) => c.length >= 3 && c[0] !== 'Phase')
      .map((c) => ({ phase: c[0], what: c[1], state: c[2] }));
  } else warn('status.md §Phase 进度', '未解析到 Phase 进度表（表形变了？）—— 流水线面板少一张表');
  // 交付物清单：**按「项」去重取后者**（status.md 实测存在同段重复两次的形态）
  const byItem = new Map();
  for (const mm of statusText.matchAll(/^\|\s*\*{0,2}([^|*]+?)\*{0,2}\s*\|\s*`([^`]+)`\s*\|\s*([^|]+)\|\s*([^|]+)\|/gm)) {
    byItem.set(mm[1].trim(), { item: mm[1].trim(), path: mm[2].trim(), bytes: mm[3].trim(), sha: mm[4].trim() });
  }
  st.deliveryRows = [...byItem.values()];
  const loop = /## 修订回环记录\n([\s\S]*?)(?=\n## )/.exec(statusText);
  if (loop) st.loopBullets = loop[1].split('\n').filter((l) => l.trim().startsWith('- ')).map((l) => l.trim().slice(2));
  const pend = /## 待主人决策（当前）\n([\s\S]*?)(?=\n## |$)/.exec(statusText);
  if (pend) st.pending = pend[1].split('\n').filter((l) => l.trim().startsWith('- ')).map((l) => l.trim().slice(2));
}

// ── 采集 ②：四门回执（机器面）→ 不足时回退阶段确认单 §6 ────────────────────
const GATE_ORDER = ['Phase0', 'Phase2.5', 'Phase3.5', 'Phase5'];
const gates = [];
const receiptsRaw = readText(join(projectDir, 'audits', 'gate-receipts.jsonl'));
if (receiptsRaw === null) warn('audits/gate-receipts.jsonl', '四门回执缺 —— 已回退解析 阶段确认-Phase*.md §6「回复时间」（等待时长会缺失）');
else {
  const bad = [];
  for (const line of receiptsRaw.split('\n')) {
    if (!line.trim()) continue;
    try { gates.push(JSON.parse(line)); } catch { bad.push(cut(line, 40)); }
  }
  if (bad.length) warn('audits/gate-receipts.jsonl', `${bad.length} 行非 JSON，已跳过（不猜测其内容）`);
}
if (!gates.length) {
  for (const g of GATE_ORDER) {
    const t = readText(join(projectDir, `阶段确认-${g}.md`));
    if (t === null) continue;
    const ans = /\*\*回复时间\*\*[：:]\s*([^\n]+)/.exec(t);
    const ts = ans ? /(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/.exec(ans[1]) : null;
    if (ts) gates.push({ gate: g, answeredAt: `${ts[1]}T${String(ts[2]).padStart(2, '0')}:${ts[3]}:00+08:00`, source: '阶段确认单 §6' });
  }
}
gates.sort((a, b) => GATE_ORDER.indexOf(a.gate) - GATE_ORDER.indexOf(b.gate));
const gateTimeline = gates.map((g) => {
  const a = g.askedAt ? Date.parse(g.askedAt) : NaN;
  const b = g.answeredAt ? Date.parse(g.answeredAt) : NaN;
  return {
    gate: g.gate, askedAt: g.askedAt || null, answeredAt: g.answeredAt || null,
    ms: Number.isFinite(b) ? b : null,
    waitMin: Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 60000) : null,
    round: g.round ?? null, chosen: g.chosenLabel || null,
    options: Array.isArray(g.options) ? g.options.length : null,
  };
});

// ── 采集 ③：M 门报告（位置三代际：final/ → audits/M-Gate-Report-vN.json（取最大 N）→ audits/M-Gate-final.json）
function pickMGate() {
  const cands = [join(projectDir, 'final', 'M-Gate-Report.json')];
  const audits = listDir(join(projectDir, 'audits'));
  audits.filter((f) => /^M-Gate-Report-v(\d+)\.json$/.test(f))
    .sort((x, y) => Number(/v(\d+)/.exec(y)[1]) - Number(/v(\d+)/.exec(x)[1]))
    .forEach((f) => cands.push(join(projectDir, 'audits', f)));
  if (audits.includes('M-Gate-final.json')) cands.push(join(projectDir, 'audits', 'M-Gate-final.json'));
  for (const c of cands) { if (!existsSync(c)) continue; const j = readJson(c); if (j) return { path: c, json: j }; }
  return null;
}
const mg = pickMGate();
if (mg === null) warn('final/M-Gate-Report.json', 'M 门报告缺 —— 校验面板无机械实据（不猜 M 门结论）');
else if (!Array.isArray(mg.json.results)) warn(relPath(mg.path), '无 results[] 数组（llm-legacy 或无报告格式）—— 只有汇总数字可呈现');

// ── 采集 ④：G 项机检 JSON（任意 *gaudit*.json）────────────────────────────
let ga = null;
for (const f of listDir(join(projectDir, 'audits'))) {
  if (!/gaudit/i.test(f) || !f.endsWith('.json')) continue;
  const p = join(projectDir, 'audits', f);
  const j = readJson(p);
  if (j && (j.checks || j.overall)) { ga = { path: p, json: j }; break; }
}
if (ga === null) warn('audits/*gaudit*.json', 'G 项机检 JSON 缺（可能未曾落盘）—— G 面板标 N/A');

// ── 采集 ⑤：字数演进（han + sections 口径，与 count-chars.mjs 同源）─────────
function hanOf(p) {
  const t = readText(p);
  if (t === null) return null;
  const start = bodyStartAfterAbstract(t);
  const { to, abstractFound, endnoteFound } = bodyBounds(t);
  return { bytes: sizeOf(p), han: countHan(t.slice(start.index, to)), degraded: !abstractFound || !endnoteFound };
}
const draftsDir = join(projectDir, 'drafts');
const versions = [];
for (const f of listDir(draftsDir)) {
  const m = /^初稿-v(\d+)\.md$/.exec(f);
  if (m) versions.push({ n: Number(m[1]), name: f, path: join(draftsDir, f), archived: false });
}
for (const f of listDir(join(draftsDir, 'archive'))) {
  const m = /^初稿-v(\d+)\.md$/.exec(f);
  if (m && !versions.some((v) => v.n === Number(m[1]))) versions.push({ n: Number(m[1]), name: f, path: join(draftsDir, 'archive', f), archived: true });
}
const prog = versions.sort((a, b) => a.n - b.n).map((v) => {
  const h = hanOf(v.path);
  return { label: `v${v.n}`, han: h ? h.han : null, archived: v.archived, degraded: h ? h.degraded : null, name: v.name };
});
{
  const h = hanOf(join(projectDir, 'final', '定稿.md'));
  if (h) prog.push({ label: '定稿', han: h.han, archived: false, degraded: h.degraded, name: 'final/定稿.md' });
  else warn('final/定稿.md', '定稿缺 —— 字数演进图少了终点（其余版本仍照实呈现）');
}
const target = st.target ? Number((/(\d[\d\s,]*)/.exec(st.target) || [])[1]?.replace(/[\s,]/g, '')) : null;

// ── 采集 ⑥：轮次账本 ────────────────────────────────────────────────────
const rounds = [];
const led = readText(join(projectDir, 'drafts', '轮次账本.md'));
if (led === null) warn('drafts/轮次账本.md', '轮次账本缺 —— 轮次面板仅能靠 status.md 文本推断');
else {
  for (const line of led.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const c = t.split('|').slice(1, -1).map((x) => x.trim());
    if (c.length < 6 || /^-+$/.test(c[0]) || c[0] === '轨') continue;
    rounds.push({ track: c[0], round: c[1], version: c[2], trigger: c[3], review: c[4], date: c[5] });
  }
}

// ── 采集 ⑦：来源索引 / agents-log / 证据包 / 图件 ─────────────────────────
const srcRows = [];
for (const f of listDir(join(projectDir, 'sources'))) {
  if (!f.endsWith('.jsonl')) continue;
  const t = readText(join(projectDir, 'sources', f)) || '';
  srcRows.push({ name: f.replace(/\.jsonl$/, ''), lines: t.split('\n').filter((l) => l.trim()).length });
}
const mergedSrc = readJson(join(projectDir, 'sources.json'));
const mergedCount = Array.isArray(mergedSrc) ? mergedSrc.length
  : (mergedSrc && Array.isArray(mergedSrc.sources) ? mergedSrc.sources.length : null);
const agentLog = readText(join(projectDir, 'agents-log.md'));
const roleCounts = new Map();
if (agentLog !== null) {
  for (const mm of agentLog.matchAll(/^###\s*(T\d+[^\n]*)$/gm)) {
    const k = (/T\d+/.exec(mm[1]) || ['?'])[0];
    roleCounts.set(k, (roleCounts.get(k) || 0) + 1);
  }
} else warn('agents-log.md', '角色执行记录缺 —— 角色面板为空（不是「零角色」，是没读到）');
const roleRows = [...roleCounts.entries()].map(([role, count]) => ({ role, count }));
const handoffCount = listDir(join(projectDir, 'audits')).filter((f) => /^交接报告-/.test(f)).length;
const manifest = readJson(join(projectDir, 'final', '证据包', 'manifest.json'));
if (manifest === null) warn('final/证据包/manifest.json', '证据包 manifest 缺 —— 证据包条目数标 N/A');
const figureNames = listDir(join(projectDir, 'final', '图件')).filter((f) => f.toLowerCase().endsWith('.svg'));
const finalFiles = [];
(function walkFinal(dir, rel) {
  for (const f of listDir(dir)) {
    const p = join(dir, f);
    let s; try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) { if (f !== '证据包') walkFinal(p, rel ? rel + '/' + f : f); }
    else finalFiles.push({ rel: rel ? rel + '/' + f : f, bytes: s.size, mtime: s.mtime.toISOString().slice(0, 16).replace('T', ' ') });
  }
})(join(projectDir, 'final'), '');
finalFiles.sort((a, b) => a.rel.localeCompare(b.rel, 'zh'));

// ── 采集 ⑧：合规分（spawn 既有脚本，唯一真源；`--no-score` 或失败即如实 N/A）──
let qs = null;
if (!WITH_SCORE) notes.push({ level: 'info', what: '--no-score', detail: '已跳过 quality-score.mjs —— 分析面板的合规分标 N/A（不是「没有分」）' });
else {
  const qsScript = join(SCRIPT_DIR, 'quality-score.mjs');
  if (!existsSync(qsScript)) warn('quality-score.mjs', '同目录未找到 —— 合规分面板 N/A');
  else {
    const tmpFile = join(tmpdir(), `lunheng-run-report-${process.pid}-${Date.now()}.json`);
    const r = spawnSync(process.execPath, [qsScript, projectDir, '--report', tmpFile], {
      cwd: resolve(projectDir, '..', '..'), stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000, encoding: 'utf8',
    });
    qs = readJson(tmpFile);
    try { rmSync(tmpFile, { force: true }); } catch { /* temp 清理失败不影响结果 */ }
    if (qs === null) warn('quality-score.mjs', `spawn ${r.status === null ? '超时/异常' : `退出码 ${r.status}`}：${cut(String(r.stderr || ''), 140) || '无 stderr'} —— 合规分面板 N/A（不猜分数）`);
  }
}

// ── 派生视图（HTML 与 JSON 边车共用）────────────────────────────────────
function relPath(p) { return p.startsWith(projectDir + sep) ? p.slice(projectDir.length + 1) : p; }
const mgItems = mg && Array.isArray(mg.json.results) ? mg.json.results.map((r, i) => {
  const id = (/^M-[A-Za-z]+-\d+/.exec(r.gate) || [`#${i + 1}`])[0];
  return { id, label: r.gate, severity: r.pass ? '通过' : (r.severity || 'SKIP'), detail: r.detail || '' };
}) : [];
const gaItems = ga ? Object.entries(ga.json.checks || {}).map(([k, v]) => ({
  id: (/^G[\d.]+/.exec(k) || [k])[0], label: v.name || k,
  severity: v.checked === false ? 'SKIP' : (v.pass ? '通过' : (v.severity || 'P2')), detail: v.detail || '',
})) : [];
const qsComp = qs && Array.isArray(qs.components) ? qs.components.map((c) => ({
  id: c.id, weight: c.weight, ratio: c.ratio, applicable: !!c.applicable, name: c.name,
  note: c.applicable ? '' : (c.naReason || '不适用'),
})) : [];

// ── SVG 构造器（全部内联，零外部引用）────────────────────────────────────
const FONT = '"Segoe UI","Microsoft YaHei",system-ui,sans-serif';
const SEV_COLOR = { 通过: '#12805c', PASS: '#12805c', P2: '#b7791f', P1: '#d97706', P0: '#c53030', SKIP: '#718096', 'N/A': '#a0aec0' };
function sevColor(s) { return SEV_COLOR[s] || '#4a5568'; }

function svgTimeline(items) {
  const W = 900, H = 44 * items.length + 64, padL = 118, padR = 150;
  const times = items.flatMap((i) => [i.askedMs, i.ms]).filter((t) => Number.isFinite(t));
  if (!times.length) return '';
  const t0 = Math.min(...times), t1 = Math.max(...times), span = Math.max(1, t1 - t0);
  const x = (t) => padL + ((t - t0) / span) * (W - padL - padR);
  const rows = items.map((it, idx) => {
    const y = 42 + idx * 44;
    const hasWait = Number.isFinite(it.askedMs) && Number.isFinite(it.ms);
    const bar = hasWait ? `<rect x="${x(it.askedMs).toFixed(1)}" y="${y - 11}" width="${Math.max(2, x(it.ms) - x(it.askedMs)).toFixed(1)}" height="22" rx="6" fill="#cfe3ff" stroke="#4a7fd4"/>` : '';
    const dot = Number.isFinite(it.ms) ? `<circle cx="${x(it.ms).toFixed(1)}" cy="${y}" r="5.5" fill="#1a56db"/>` : '';
    return `<g><text x="${padL - 12}" y="${y + 5}" text-anchor="end" font-size="13" fill="#1a202c">${esc(it.gate)}</text>${bar}${dot}
      <text x="${W - padR + 10}" y="${y + 5}" font-size="12" fill="#4a5568">${esc(it.label)}</text></g>`;
  }).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const t = t0 + f * span, d = new Date(t);
    const lbl = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `<g><line x1="${x(t).toFixed(1)}" y1="28" x2="${x(t).toFixed(1)}" y2="${H - 18}" stroke="#e2e8f0"/>
      <text x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#718096">${lbl}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" font-family='${FONT}'>${ticks}${rows}</svg>`;
}

function svgHeatmap(items, cols = 6) {
  const cw = 132, ch = 56, gap = 8, W = cols * (cw + gap) + gap;
  const rows = Math.ceil(items.length / cols), H = rows * (ch + gap) + gap + 26;
  const cells = items.map((it, i) => {
    const cx = gap + (i % cols) * (cw + gap), cy = gap + Math.floor(i / cols) * (ch + gap);
    const col = sevColor(it.severity);
    return `<g><rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="8" fill="${col}" opacity="0.13" stroke="${col}" stroke-width="1.2"/>
      <text x="${cx + 9}" y="${cy + 20}" font-size="11" fill="${col}" font-weight="600">${esc(it.id)}</text>
      <text x="${cx + 9}" y="${cy + 37}" font-size="10.5" fill="#2d3748">${esc(cut(it.label, 12))}</text>
      <text x="${cx + 9}" y="${cy + 50}" font-size="10" fill="${col}">${esc(it.severity)}</text></g>`;
  }).join('');
  const legend = Object.entries({ 通过: '#12805c', P2: '#b7791f', P1: '#d97706', P0: '#c53030', SKIP: '#718096' })
    .map(([k, v], i) => `<g><rect x="${gap + i * 92}" y="${H - 21}" width="11" height="11" rx="3" fill="${v}" opacity="0.35" stroke="${v}"/>
      <text x="${gap + i * 92 + 17}" y="${H - 11}" font-size="11" fill="#4a5568">${esc(k)}</text></g>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" font-family='${FONT}'>${cells}${legend}</svg>`;
}

function svgRadar(comps, size = 420) {
  const cx = size / 2, cy = size / 2 + 6, R = size / 2 - 78;
  const n = comps.length; if (!n) return '';
  const ang = (i) => (-Math.PI / 2) + (i * 2 * Math.PI) / n;
  const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];
  const rings = [0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${comps.map((_, i) => pt(i, R * f).map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#e2e8f0"/>`).join('');
  const spokes = comps.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0"/>`; }).join('');
  const poly = comps.map((c, i) => pt(i, c.applicable && Number.isFinite(c.ratio) ? R * Math.max(0, Math.min(1, c.ratio)) : 0).map((v) => v.toFixed(1)).join(',')).join(' ');
  const labels = comps.map((c, i) => {
    const [x, y] = pt(i, R + 26);
    const anchor = Math.abs(x - cx) < 12 ? 'middle' : (x > cx ? 'start' : 'end');
    const val = c.applicable && Number.isFinite(c.ratio) ? `${(c.ratio * 100).toFixed(0)}%` : 'N/A';
    return `<text x="${x.toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="#1a202c">${esc(c.id)}</text>
      <text x="${x.toFixed(1)}" y="${(y + 12).toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="#718096">w${c.weight} · ${val}</text>`;
  }).join('');
  const dots = comps.map((c, i) => {
    if (!(c.applicable && Number.isFinite(c.ratio))) return '';
    const [x, y] = pt(i, R * Math.max(0, Math.min(1, c.ratio)));
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#1a56db"/>`;
  }).join('');
  return `<svg viewBox="-46 0 ${size + 92} ${size}" width="100%" style="max-width:${size}px" role="img" font-family='${FONT}'>
    ${rings}${spokes}<polygon points="${poly}" fill="#1a56db" fill-opacity="0.18" stroke="#1a56db" stroke-width="2"/>${dots}${labels}</svg>`;
}

function svgLine(points, band) {
  const W = 900, H = 250, padL = 62, padR = 24, padT = 26, padB = 46;
  const vals = points.map((p) => p.han).filter((v) => Number.isFinite(v));
  if (!vals.length) return '';
  const lo0 = Math.min(...vals, band ? band.lo : Infinity), hi0 = Math.max(...vals, band ? band.hi : -Infinity);
  const pad = Math.max(120, (hi0 - lo0) * 0.25);
  const lo = lo0 - pad, hi = hi0 + pad;
  const x = (i) => padL + (points.length === 1 ? (W - padL - padR) / 2 : (i / (points.length - 1)) * (W - padL - padR));
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const bandRect = band ? `<rect x="${padL}" y="${y(band.hi).toFixed(1)}" width="${W - padL - padR}" height="${Math.max(1, y(band.lo) - y(band.hi)).toFixed(1)}" fill="#12805c" opacity="0.10"/>` : '';
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = lo + f * (hi - lo);
    return `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="#edf2f7"/>
      <text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#a0aec0">${Math.round(v)}</text>`;
  }).join('');
  const path = points.filter((p) => Number.isFinite(p.han)).map((p, i) => `${i ? 'L' : 'M'}${x(points.indexOf(p)).toFixed(1)},${y(p.han).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => Number.isFinite(p.han)
    ? `<g><circle cx="${x(i).toFixed(1)}" cy="${y(p.han).toFixed(1)}" r="4" fill="${p.label === '定稿' ? '#12805c' : '#1a56db'}"/>
       <text x="${x(i).toFixed(1)}" y="${(y(p.han) - 10).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="#2d3748">${p.han}</text>
       <text x="${x(i).toFixed(1)}" y="${H - 22}" text-anchor="middle" font-size="11" fill="#4a5568">${esc(p.label)}</text></g>` : '').join('');
  const bandLbl = band ? `<text x="${W - padR}" y="${(y(band.hi) - 6).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#12805c">目标带 ${band.lo}–${band.hi}</text>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" font-family='${FONT}'>${bandRect}${grid}<path d="${path}" fill="none" stroke="#1a56db" stroke-width="2"/>${dots}${bandLbl}</svg>`;
}

function svgBars(rows, padL = 118) {
  const W = 900, rowH = 34, padR = 96;
  if (!rows.length) return '';
  const H = rows.length * rowH + 18;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const inner = W - padL - padR;
  const bars = rows.map((r, i) => {
    const y = 12 + i * rowH, w = Math.max(2, (r.value / max) * inner);
    return `<g><text x="${padL - 10}" y="${y + 15}" text-anchor="end" font-size="12" fill="#2d3748">${esc(r.label)}</text>
      <rect x="${padL}" y="${y + 3}" width="${w.toFixed(1)}" height="17" rx="5" fill="${r.color || '#4a7fd4'}" opacity="0.85"/>
      <text x="${(padL + w + 8).toFixed(1)}" y="${y + 16}" font-size="11.5" fill="#4a5568">${esc(r.note ?? String(r.value))}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" font-family='${FONT}'>${bars}</svg>`;
}

// 内联图件：剥 XML 声明 / DTD / script，去掉固定宽高，交给卡片自适应
function inlineSvg(raw) {
  return String(raw).replace(/<\?xml[^>]*\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<svg\b([^>]*)>/i, (m, a) => `<svg${a.replace(/\s(width|height)="[^"]*"/gi, '')} width="100%" style="max-height:280px">`);
}

// ── HTML 渲染 ───────────────────────────────────────────────────────────
function render() {
  const kpi = [];
  const finalHan = prog.find((p) => p.label === '定稿');
  kpi.push({ k: '正文纯汉字（定稿）', v: finalHan ? finalHan.han.toLocaleString('zh-CN') : 'N/A', s: st.target ? `目标 ${st.target}` : '' });
  kpi.push({ k: '字数演进', v: `${prog.length} 个版本`, s: prog.map((p) => p.label).join(' → ') });
  kpi.push({
    k: 'M 门',
    v: mg ? `exit ${mg.json.exit ?? mg.json.exit_code ?? '?'} · ${mg.json.pass}/${mg.json.total} 通过` : 'N/A',
    s: mg ? `P0 ${mg.json.p0 ?? '?'} / P1 ${mg.json.p1 ?? '?'} / P2 ${mg.json.p2 ?? '?'}` : '无报告',
  });
  kpi.push({
    k: '合规分',
    v: qs ? `${qs.score} / 100` : 'N/A',
    s: qs ? `覆盖 ${(qs.coverage * 100).toFixed(0)}%（QLT-1，不是论证质量）` : (WITH_SCORE ? 'quality-score 未取到' : '--no-score 跳过了'),
  });
  kpi.push({ k: '四门', v: `${gateTimeline.length} / 4`, s: gateTimeline.map((g) => `${g.gate}${g.round ? `#${g.round}` : ''}`).join(' ') });
  kpi.push({ k: '轮次账本', v: `${rounds.length} 行`, s: ['A', 'B', 'G', '相位'].map((t) => `${t}=${rounds.filter((r) => r.track === t).length}`).join(' ') });

  const band = target ? { lo: Math.round(target * 0.98), hi: Math.round(target * 1.02) } : null;
  const gateTable = gateTimeline.map((g) => `<tr><td>${esc(g.gate)}</td><td>${g.round ?? '—'}</td>
    <td>${esc((g.askedAt || '—').replace('T', ' ').replace('+08:00', ''))}</td>
    <td>${esc((g.answeredAt || '—').replace('T', ' ').replace('+08:00', ''))}</td>
    <td>${g.waitMin === null ? '—' : g.waitMin + ' 分钟'}</td>
    <td>${g.options ?? '—'} 选 1</td><td class="mono">${esc(cut(mdPlain(g.chosen || '—'), 40))}</td></tr>`).join('');
  const roundTable = rounds.map((r) => `<tr><td><span class="tag t-${esc(mdPlain(r.track))}">${esc(mdPlain(r.track))}</span></td><td>${esc(mdPlain(r.round))}</td>
    <td class="mono">${esc(mdPlain(r.version))}</td><td>${esc(cut(mdPlain(r.trigger), 90))}</td><td class="mono">${esc(mdPlain(r.review))}</td><td>${esc(mdPlain(r.date))}</td></tr>`).join('');
  const bySev = (a, b) => (a.severity === '通过' ? 1 : 0) - (b.severity === '通过' ? 1 : 0);
  const mgTable = [...mgItems].sort(bySev).map((i) => `<tr><td class="mono">${esc(i.id)}</td><td><span class="sev" style="--c:${sevColor(i.severity)}">${esc(i.severity)}</span></td><td>${esc(i.label)}</td><td class="small">${esc(cut(i.detail, 150))}</td></tr>`).join('');
  const gaTable = [...gaItems].sort(bySev).map((i) => `<tr><td class="mono">${esc(i.id)}</td><td><span class="sev" style="--c:${sevColor(i.severity)}">${esc(i.severity)}</span></td><td>${esc(i.label)}</td><td class="small">${esc(cut(i.detail, 150))}</td></tr>`).join('');
  const filesTable = finalFiles.map((f) => `<tr><td class="mono">${esc(f.rel)}</td><td>${fmtBytes(f.bytes)}</td><td class="small">${esc(f.mtime)}</td></tr>`).join('');
  const figCards = figureNames.map((f) => {
    const raw = readText(join(projectDir, 'final', '图件', f));
    return raw ? `<figure class="fig"><div class="figbox">${inlineSvg(raw)}</div><figcaption>${esc(f)}</figcaption></figure>` : '';
  }).join('');
  const noteRows = notes.map((n) => `<li class="n-${n.level}"><b>${esc(n.what)}</b> — ${esc(n.detail)}</li>`).join('')
    || '<li class="ok">本报告所有面板均已取到数据源。</li>';

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>论衡运行报告 · ${esc(projectName)}</title>
<style>
  :root{--ink:#1a202c;--sub:#4a5568;--line:#e2e8f0;--bg:#f7fafc;--card:#fff;--brand:#1a56db}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 ${FONT}}
  header{background:linear-gradient(135deg,#12274d,#1a56db);color:#fff;padding:26px 30px 20px}
  header h1{margin:0 0 6px;font-size:21px}
  header .meta{font-size:12.5px;opacity:.9;line-height:1.9}
  nav{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:9px 30px;display:flex;gap:16px;flex-wrap:wrap}
  nav a{color:var(--sub);text-decoration:none;font-size:13px;padding:3px 2px;border-bottom:2px solid transparent}
  nav a:hover{color:var(--brand);border-color:var(--brand)}
  main{padding:22px 30px 60px;max-width:1180px;margin:0 auto}
  section{margin:0 0 30px}
  h2{font-size:16px;margin:26px 0 12px;padding-left:10px;border-left:4px solid var(--brand)}
  h3{font-size:14px;margin:18px 0 8px;color:var(--sub)}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:13px 15px}
  .card .k{font-size:12px;color:var(--sub)}
  .card .v{font-size:19px;font-weight:650;margin:3px 0 2px;font-variant-numeric:tabular-nums}
  .card .s{font-size:11.5px;color:#718096}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:0 0 14px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th,td{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top}
  th{background:#f1f5f9;font-weight:600;color:var(--sub)}
  .mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
  .small{font-size:11.5px;color:var(--sub)}
  .sev{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;color:var(--c);border:1px solid var(--c);background:#fff}
  .tag{display:inline-block;padding:1px 8px;border-radius:6px;font-size:11px;background:#eef2f7;border:1px solid var(--line)}
  .tag.t-A{background:#fff5f5;border-color:#feb2b2;color:#c53030}
  .tag.t-B{background:#fffaf0;border-color:#fbd38d;color:#b7791f}
  .tag.t-G{background:#f0fff4;border-color:#9ae6b4;color:#276749}
  .tag.t-相位{background:#ebf8ff;border-color:#90cdf4;color:#2b6cb0}
  ul.notes{margin:6px 0 0;padding-left:20px}
  ul.notes li{margin:3px 0;font-size:12.5px}
  .n-miss{color:#c53030}.n-warn{color:#b7791f}.n-info{color:#2b6cb0}.ok{color:#12805c}
  .figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
  .fig{margin:0;background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px}
  .figbox{height:200px;display:flex;align-items:center;justify-content:center;overflow:hidden}
  figcaption{font-size:11.5px;color:var(--sub);margin-top:6px;text-align:center}
  .split{display:grid;grid-template-columns:minmax(300px,420px) 1fr;gap:18px;align-items:start}
  @media (max-width:820px){.split{grid-template-columns:1fr}}
  footer{color:#718096;font-size:11.5px;padding:0 30px 40px;max-width:1180px;margin:0 auto}
  @media print{nav{display:none}body{background:#fff}.panel,.card{break-inside:avoid}}
</style></head>
<body>
<header>
  <h1>论衡 · 运行与校验报告</h1>
  <div class="meta">
    <div><b>${esc(projectName)}</b>${st.title ? ' ｜ ' + esc(st.title) + (st.titleChars ? `（${esc(st.titleChars)} 字）` : '') : ''}</div>
    <div>${st.genre ? '文类 ' + esc(st.genre) : '文类 —'} ｜ ${st.target ? esc(st.target) : '篇幅 —'}${st.tolerance ? ' ｜ 纠偏线 ' + esc(st.tolerance) : ''}${st.hardRange ? ' ｜ G8 硬阈 ' + esc(st.hardRange) : ''}</div>
    <div>${st.started ? '启动 ' + esc(st.started) : '启动 —'}${st.signedAt ? ' ｜ 签收 ' + esc(st.signedAt) : ''} ｜ 报告生成 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
    <div>${st.phaseLine ? '当前/末态：' + esc(cut(mdPlain(st.phaseLine), 120)) : ''}</div>
  </div>
</header>
<nav>
  <a href="#kpi">概览</a><a href="#pipeline">流水线</a><a href="#checks">校验</a>
  <a href="#insights">分析</a><a href="#artifacts">产物</a><a href="#provenance">口径与数据源</a>
</nav>
<main>
  <section id="kpi"><h2>概览</h2>
    <div class="cards">${kpi.map((c) => `<div class="card"><div class="k">${esc(c.k)}</div><div class="v">${esc(c.v)}</div><div class="s">${esc(c.s)}</div></div>`).join('')}</div>
    <div class="panel"><h3>字数演进（正文区纯汉字，口径 = 摘要后 → 首个文末节前，与 count-chars 同源）</h3>${svgLine(prog, band) || '<p class="small">无可统计的稿件版本</p>'}
      ${prog.some((p) => p.degraded) ? '<p class="small n-warn">⚠ 有版本缺 <code>## 摘要</code> 或文末节，正文区边界退化（degraded）——该点字数与 M 门口径不可比，已如实标出。</p>' : ''}</div>
    <div class="panel"><h3>修订回环（轮次账本；A ≤2 / B ≤1 / G ≤2，相位轮不占额度但必须可见）</h3>
      ${roundTable ? `<table><thead><tr><th>轨</th><th>轮次</th><th>正文版本</th><th>触发来源</th><th>复核报告</th><th>时间</th></tr></thead><tbody>${roundTable}</tbody></table>` : '<p class="small">无轮次账本</p>'}
      ${st.loopBullets.length ? `<h3>status.md §修订回环记录</h3><ul class="notes">${st.loopBullets.map((b) => `<li>${esc(cut(mdPlain(b), 190))}</li>`).join('')}</ul>` : ''}</div>
  </section>

  <section id="pipeline"><h2>流水线</h2>
    <div class="panel"><h3>四门时序（数据源 = ${receiptsRaw ? 'audits/gate-receipts.jsonl（含等待时长）' : '阶段确认单 §6 回退解析'}）</h3>
      ${svgTimeline(gateTimeline.map((g) => ({ ...g, askedMs: g.askedAt ? Date.parse(g.askedAt) : NaN, label: g.waitMin === null ? '' : `等待 ${g.waitMin} 分钟` }))) || '<p class="small">无门时间数据</p>'}
      <table><thead><tr><th>门</th><th>轮</th><th>提问</th><th>回复</th><th>等待</th><th>选项</th><th>主人所选</th></tr></thead><tbody>${gateTable || '<tr><td colspan="7" class="small">无</td></tr>'}</tbody></table></div>
    <div class="panel"><h3>Phase 进度（status.md）</h3>
      ${st.phaseRows.length ? `<table><thead><tr><th>Phase</th><th>内容</th><th>状态</th></tr></thead><tbody>${st.phaseRows.map((r) => `<tr><td>${esc(mdPlain(r.phase))}</td><td>${esc(cut(mdPlain(r.what), 130))}</td><td>${esc(cut(mdPlain(r.state), 120))}</td></tr>`).join('')}</tbody></table>` : '<p class="small">status.md 未解析到 Phase 进度表</p>'}</div>
    <div class="panel split"><div><h3>角色执行段（agents-log.md 的 <code>### Tn</code> 记录数）</h3>${svgBars(roleRows.map((r) => ({ label: r.role, value: r.count, note: `${r.count} 段`, color: '#7c9bd4' }))) || '<p class="small">无 agents-log.md</p>'}</div>
      <div><h3>交接与来源</h3><table><tbody>
      <tr><td>交接报告文件</td><td>${handoffCount} 份（audits/交接报告-*.md）</td></tr>
      <tr><td>来源分片</td><td>${srcRows.map((r) => `${esc(r.name)} ${r.lines}`).join(' ｜ ') || '—'}</td></tr>
      <tr><td>合并来源</td><td>${mergedCount ?? '—'} 条（sources.json）</td></tr>
      <tr><td>证据包条目</td><td>${manifest && (manifest.entries || manifest.files) ? (manifest.entries || manifest.files).length : '—'}${manifest && manifest.auditTargetSha256 ? ` ｜ auditTargetSha256 <span class="mono">${esc(String(manifest.auditTargetSha256).slice(0, 12))}…</span>` : ''}</td></tr>
      </tbody></table></div></div>
  </section>

  <section id="checks"><h2>校验</h2>
    <div class="panel"><h3>M 门 ${mg ? `${mg.json.total} 项机检（exit ${mg.json.exit ?? mg.json.exit_code}｜P0 ${mg.json.p0} / P1 ${mg.json.p1} / P2 ${mg.json.p2} / SKIP ${mg.json.skips ?? 0}）` : '（无报告）'} · 数据源 <span class="mono">${mg ? esc(relPath(mg.path)) : '—'}</span></h3>
      ${mgItems.length ? svgHeatmap(mgItems) : '<p class="small">无逐项结果（llm-legacy 或缺失格式）—— 不重跑门、不推测逐项结论</p>'}</div>
    <div class="panel"><h3>M 门逐项（失败项排前）</h3>
      ${mgTable ? `<table><thead><tr><th>项</th><th>判级</th><th>门</th><th>证据摘要</th></tr></thead><tbody>${mgTable}</tbody></table>` : '<p class="small">无</p>'}</div>
    <div class="panel"><h3>G 项机检 ${ga ? `（overall exit ${ga.json.overall?.exitCode}｜P0 ${ga.json.overall?.p0} / P1 ${ga.json.overall?.p1} / P2 ${ga.json.overall?.p2} / SKIP ${ga.json.overall?.skipped}）` : '（无 JSON）'} · 数据源 <span class="mono">${ga ? esc(relPath(ga.path)) : '—'}</span></h3>
      ${gaItems.length ? svgHeatmap(gaItems, 3) : '<p class="small">N/A —— 未取到 G 项机检 JSON</p>'}
      ${gaTable ? `<table><thead><tr><th>项</th><th>判级</th><th>检查</th><th>证据摘要</th></tr></thead><tbody>${gaTable}</tbody></table>` : ''}</div>
  </section>

  <section id="insights"><h2>分析</h2>
    <div class="panel split"><div><h3>合规分分量（权重 / 达成率）${qs ? `总 ${qs.score} / 100` : ''}</h3>${svgRadar(qsComp) || '<p class="small">N/A</p>'}</div>
      <div><h3>读法（勿越界）</h3>
        ${qs ? `<p class="small"><b>不是论证质量。</b>${esc(cut(qs.validity?.why || '', 260))}</p>
        <p class="small">效度边界：<b>${esc(qs.validity?.scope || '—')}</b> ／ 不支撑：${esc(qs.validity?.notScope || '—')}${qs.validity?.measured ? ' ｜ 实测反例：' + esc(cut(qs.validity.measured, 160)) : ''}</p>
        <table><thead><tr><th>分量</th><th>权重</th><th>达成</th><th>说明</th></tr></thead><tbody>
        ${qsComp.map((c) => `<tr><td class="mono">${esc(c.id)}</td><td>${c.weight}</td><td>${c.applicable ? (c.ratio === null ? '—' : (c.ratio * 100).toFixed(0) + '%') : 'N/A'}</td><td class="small">${esc(cut(c.name, 60))}${c.note ? ' ｜ ' + esc(cut(c.note, 70)) : ''}</td></tr>`).join('')}
        </tbody></table>
        ${qs.qlt6 ? `<p class="small" style="margin-top:10px"><b>QLT-6 论证强度</b>：${qs.qlt6.score ?? '—'}（覆盖 ${qs.qlt6.coverage !== undefined ? (qs.qlt6.coverage * 100).toFixed(0) + '%' : '—'}）${qs.qlt6.coverageWarning ? ' ｜ ⚠ ' + esc(cut(qs.qlt6.coverageWarning, 120)) : ''}　—— 与合规分<b>刻意不相加</b>。</p>` : ''}` : `<p class="small">N/A —— ${WITH_SCORE ? '未取到 quality-score.mjs 的输出' : '本次以 --no-score 运行'}，本面板不猜分数。</p>`}
      </div></div>
  </section>

  <section id="artifacts"><h2>产物</h2>
    <div class="panel"><h3>交付物清单（status.md 回填）</h3>
      ${st.deliveryRows.length ? `<table><thead><tr><th>项</th><th>路径</th><th>字节</th><th>sha / 校验</th></tr></thead><tbody>${st.deliveryRows.map((r) => `<tr><td>${esc(r.item)}</td><td class="mono">${esc(r.path)}</td><td>${esc(r.bytes)}</td><td class="small">${esc(r.sha)}</td></tr>`).join('')}</tbody></table>` : '<p class="small">status.md 未解析到交付物清单</p>'}</div>
    ${figureNames.length ? `<div class="panel"><h3>图件（内联 SVG，${figureNames.length} 张）</h3><div class="figs">${figCards}</div></div>` : ''}
    <div class="panel"><h3>final/ 实体文件（${finalFiles.length} 个，证据包子目录已折叠）</h3>
      <table><thead><tr><th>相对路径</th><th>大小</th><th>修改时间</th></tr></thead><tbody>${filesTable || '<tr><td colspan="3" class="small">final/ 不存在</td></tr>'}</tbody></table></div>
  </section>

  <section id="provenance"><h2>口径与数据源</h2>
    <div class="panel"><h3>数据源状态（缺什么就写什么，不静默补数）</h3><ul class="notes">${noteRows}</ul>
      <h3>口径声明</h3><ul class="notes">
        <li>正文区纯汉字 = <code>## 摘要</code> 之后 → 首个文末节之前（含摘要正文与关键词段，不含题名与文末节）——import <span class="mono">_lib/sections.mjs</span> + <span class="mono">_lib/han.mjs</span>，与 <code>count-chars.mjs</code> 同源。</li>
        <li>四门等待时长优先取 <code>audits/gate-receipts.jsonl</code> 的 askedAt→answeredAt；无回执时才回退解析阶段确认单 §6「回复时间」。</li>
        <li>M 门与 G 项判级<b>只读既有报告</b>，本报告不重跑门、不推测结论（数字 = 那些报告落盘时刻的快照，数据源路径逐段标注）。</li>
        <li>合规分由 <code>quality-score.mjs</code> 现场生成——它是<b>门计数代理</b>，只支撑合规与成本，不支撑论证质量。</li>
        <li>本脚本<b>只读</b>项目产物；唯一的写盘是 <code>--out</code> / <code>--json</code> 指定的报告文件（走同文件守卫 + 时间戳 .bak）。</li>
      </ul></div>
    ${st.pending.length ? `<div class="panel"><h3>待主人决策（status.md）</h3><ul class="notes">${st.pending.map((p) => `<li>${esc(mdPlain(p))}</li>`).join('')}</ul></div>` : ''}
  </section>
</main>
<footer>由 <span class="mono">scripts/${SCRIPT_NAME}</span> 生成 · 数据源 = <span class="mono">${esc(projectDir)}</span> · 本页零外部引用，可离线打开 / 打印为 PDF。</footer>
</body></html>`;
}

// ── 输出（唯一写盘出口 = _lib/destructive-write.mjs）────────────────────────
const html = render();
writeReport(outHtml, html, { protect: sources, label: '--out' });
if (outJson) {
  const sidecar = {
    schema: 'lunheng.run-report/1',
    generatedAt: new Date().toISOString(),
    generator: SCRIPT_NAME,
    project: { dir: projectDir, name: projectName, ...st },
    gates: gateTimeline,
    mGate: mg ? {
      path: relPath(mg.path),
      summary: { total: mg.json.total, pass: mg.json.pass, p0: mg.json.p0, p1: mg.json.p1, p2: mg.json.p2, skips: mg.json.skips, exit: mg.json.exit ?? mg.json.exit_code },
      results: mgItems.map((i) => ({ id: i.id, gate: i.label, severity: i.severity })),
    } : null,
    gAudit: ga ? { path: relPath(ga.path), overall: ga.json.overall || null, checks: gaItems.map((i) => ({ id: i.id, name: i.label, severity: i.severity })) } : null,
    words: { target, series: prog },
    rounds,
    sources: { shards: srcRows, mergedCount },
    roles: roleRows,
    artifacts: { finalFiles, figures: figureNames, evidenceEntries: manifest && (manifest.entries || manifest.files) ? (manifest.entries || manifest.files).length : null },
    scoring: qs ? { score: qs.score, coverage: qs.coverage, components: qsComp, qlt6: qs.qlt6 || null, validity: qs.validity || null } : null,
    dataSourceNotes: notes,
  };
  writeReport(outJson, JSON.stringify(sidecar, null, 2), { protect: sources, label: '--json' });
}

const missCount = notes.filter((n) => n.level === 'miss').length;
const gapCount = notes.filter((n) => n.level === 'warn').length;
if (!QUIET) {
  console.log(`HTML: ${outHtml}（${fmtBytes(sizeOf(outHtml))}）`);
  if (outJson) console.log(`JSON: ${outJson}（${fmtBytes(sizeOf(outJson))}）`);
  console.log(`关键输入缺失 ${missCount} 项（status.md）/ 面板缺口 ${gapCount} 项`);
  for (const n of notes) console.log(`  [${n.level}] ${n.what} — ${n.detail}`);
}
process.exit(missCount > 0 ? 3 : 0);
