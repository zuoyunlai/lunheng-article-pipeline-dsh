// 论衡运行时遥测看板（v18.5.0 新增，第三方审计 §五.1「lunheng-stats」落地）
//
// 用途：把 run/ 目录里真实项目散落的「闸门证据 / 修订轮数 / 字数 / 审稿」聚合成一张看板，
//   让「机制是否真的在拦问题」从轶事变成数据——这是审计点名的「当前最大结构性空白」。
//   纯只读聚合：不写盘、不改任何项目文件，也不参与 M 门判定（它只做**事后观测**，不是闸门）。
//
// 用法：node lunheng-stats.mjs [--run-dir <run目录>] [--json]
//
// 数据考古（如实声明，v18.5.0 探针实测）：run/ 横跨 4 个版本代际，M-Gate 报告位置与格式不一致：
//   · 位置：final/M-Gate-Report.json（新）→ audits/M-Gate-Report-vN.json（旧，取最大 N）→ audits/M-Gate-final.json
//   · 格式：① machine（有 `results[]` 数组，v18.x 机器报告，含/不含 exit、可能带 BOM、gate 总数 12 或 22）；
//     ② llm-legacy（v2.5.2-dsh.x 的 LLM 兜底，形态多样：`M-Form_形式合规门` 嵌套 / `m_checks` 键值 /
//       `exit_code`+`M-Form` 对象——共同点：无 `results[]` 数组）；③ 无报告。
//   本脚本只对 machine 格式做机械聚合；llm-legacy 与「无报告」单独计数，作为「闸门证据覆盖率」如实呈现。
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { countHan } from './_lib/han.mjs';   // 汉字口径真源（与 count-chars 同源）

// === 参数解析（最小手写，fail-closed）===
const argv = process.argv.slice(2);
let runDir = null, wantJson = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') wantJson = true;
  else if (a === '--run-dir') { runDir = argv[++i]; if (!runDir) { console.error('用法: node lunheng-stats.mjs [--run-dir <dir>] [--json]'); process.exit(10); } }
  else if (a === '-h' || a === '--help') { console.log('用法: node lunheng-stats.mjs [--run-dir <dir>] [--json]\n  缺省扫描 <cwd>/run，纯只读聚合。'); process.exit(0); }
  else { console.error(`未知参数: ${a}\n用法: node lunheng-stats.mjs [--run-dir <dir>] [--json]`); process.exit(10); }
}
const root = resolve(runDir || join(process.cwd(), 'run'));
if (!existsSync(root)) { console.error(`run 目录不存在: ${root}`); process.exit(10); }

// === 定位 M-Gate 报告（三位置回退）===
const latestVersioned = (dir, stem, ext = 'json') => {
  let best = null, bestN = -1;
  try { for (const f of readdirSync(dir)) { const m = f.match(new RegExp(`^${stem}-v(\\d+)\\.${ext}$`)); if (m && Number(m[1]) > bestN) { bestN = Number(m[1]); best = f; } } } catch {}
  return best;
};
const findMgateReport = (base) => {
  const cands = [];
  if (existsSync(join(base, 'final', 'M-Gate-Report.json'))) cands.push(join(base, 'final', 'M-Gate-Report.json'));
  const audits = join(base, 'audits');
  if (existsSync(audits)) {
    const v = latestVersioned(audits, 'M-Gate-Report');
    if (v) cands.push(join(audits, v));
    if (existsSync(join(audits, 'M-Gate-final.json'))) cands.push(join(audits, 'M-Gate-final.json'));
  }
  return cands[0] || null;
};
const stripBom = (s) => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);

// 报告分类：machine（有 results[]）→ 抽指标；llm-legacy（无 results[]）；unparseable
const classifyReport = (path) => {
  try {
    const j = JSON.parse(stripBom(readFileSync(path, 'utf8')));
    if (Array.isArray(j.results)) {
      const p0 = Number(j.p0 ?? 0), p1 = Number(j.p1 ?? 0), p2 = Number(j.p2 ?? 0);
      const exit = typeof j.exit === 'number' ? j.exit : (p0 > 0 ? 2 : (p1 > 0 ? 1 : ((p2 > 0 || Number(j.soft ?? 0) > 0 || Number(j.skips ?? 0) > 0) ? 3 : 0)));
      return { format: 'machine', exit, p0, p1, p2, total: Number(j.total ?? 0), results: j.results, bytes: Number(j.verdict_scope?.draft_bytes ?? 0) };
    }
    return { format: 'llm-legacy' };
  } catch { return { format: 'unparseable' }; }
};

// === 逐项目抽取 ===
const projects = [];
for (const name of readdirSync(root)) {
  if (name.startsWith('_')) continue;
  const base = join(root, name);
  if (!statSync(base).isDirectory()) continue;
  const hasBrief = existsSync(join(base, '01-任务简报.md'));
  const finDraft = join(base, 'final', '定稿.md');
  const draftsDir = join(base, 'drafts');

  let stage = 'empty';
  if (existsSync(finDraft)) stage = 'final';
  else if (existsSync(draftsDir) && readdirSync(draftsDir).some((f) => /^初稿-v\d+\.md$/.test(f))) stage = 'draft';
  else if (existsSync(join(base, 'analysis')) || hasBrief) stage = 'analysis';

  let rounds = 0;
  const collect = (dir) => { if (!existsSync(dir)) return; for (const f of readdirSync(dir)) { const m = f.match(/^初稿-v(\d+)\.md$/); if (m) rounds = Math.max(rounds, Number(m[1])); } };
  collect(draftsDir); collect(base);

  let han = 0, textPath = null;
  if (existsSync(finDraft)) textPath = finDraft;
  else if (rounds > 0) textPath = join(base, 'drafts', `初稿-v${rounds}.md`);
  if (textPath && existsSync(textPath)) han = countHan(readFileSync(textPath, 'utf8'));

  const rep = findMgateReport(base);
  let mgate = { format: 'none' };
  if (rep) mgate = { ...classifyReport(rep), path: rep.replace(root.replace(/\\/g, '/'), '').replace(/^\//, '') };

  let review = null;
  const auditsDir = join(base, 'audits');
  if (existsSync(auditsDir)) {
    const v = latestVersioned(auditsDir, '审稿报告', 'md');
    if (v) {
      const rt = readFileSync(join(auditsDir, v), 'utf8');
      let m = rt.match(/总评分[^\d]{0,8}(\d{1,2})\s*\/\s*30/);
      if (m) review = Number(m[1]);
      else { const dims = [...rt.matchAll(/\*\*(\d)\/5\*\*/g)].map((x) => Number(x[1])); if (dims.length >= 6) review = dims.slice(0, 6).reduce((a, b) => a + b, 0); }
    }
  }

  // token：交付说明 §6 成本指标是「~NNM cacheRead」表格，取最大（总计行）量级
  let cost = null;
  const dd = join(base, 'final', '交付说明.md');
  if (existsSync(dd)) {
    const matches = [...readFileSync(dd, 'utf8').matchAll(/~\s*(\d+(?:\.\d+)?)\s*([KMB])/g)];
    if (matches.length) { const best = matches.reduce((a, b) => (parseFloat(a[1]) >= parseFloat(b[1]) ? a : b)); cost = best[1] + best[2]; }
  }

  projects.push({ name, stage, rounds, han, mgate, review, cost });
}

// === 跨项目汇总 ===
const n = projects.length;
const byStage = {}; for (const p of projects) byStage[p.stage] = (byStage[p.stage] || 0) + 1;
const byFormat = { machine: 0, 'llm-legacy': 0, none: 0, unparseable: 0 };
const gateFreq = new Map();
let sumRounds = 0, nRounds = 0, sumP0 = 0, sumP1 = 0, sumP2 = 0, sumHan = 0;
for (const p of projects) {
  if (p.rounds > 0) { sumRounds += p.rounds; nRounds++; }
  if (p.han > 0) sumHan += p.han;
  const f = p.mgate.format;
  if (f === 'machine') {
    byFormat.machine++;
    sumP0 += p.mgate.p0; sumP1 += p.mgate.p1; sumP2 += p.mgate.p2;
    for (const r of p.mgate.results || []) {
      if (r.pass === false && r.severity && /^P[012]$/.test(r.severity)) {
        const key = (r.gate || '').replace(/^([A-Za-z]+-[A-Za-z]+-\d+).*/, '$1');
        if (!key) continue;
        const e = gateFreq.get(key) || { p0: 0, p1: 0, p2: 0 };
        e[r.severity.toLowerCase()]++;
        gateFreq.set(key, e);
      }
    }
  } else byFormat[f] = (byFormat[f] || 0) + 1;
}
const topGates = [...gateFreq.entries()].map(([g, e]) => ({ gate: g, ...e, total: e.p0 + e.p1 + e.p2 })).sort((a, b) => (b.p0 + b.p1) - (a.p0 + a.p1) || b.total - a.total);

const summary = {
  root, totalProjects: n, byStage,
  mGateEvidence: byFormat,
  avgRevisionRounds: nRounds ? Number((sumRounds / nRounds).toFixed(1)) : null,
  totalP0: sumP0, totalP1: sumP1, totalP2: sumP2, totalHanChars: sumHan,
  topFailingGates: topGates,
};

// === 输出 ===
if (wantJson) {
  console.log(JSON.stringify({ projects: projects.map((p) => ({ name: p.name, stage: p.stage, rounds: p.rounds, hanChars: p.han, mgate: p.mgate.format, exit: p.mgate.exit ?? null, p0: p.mgate.p0 ?? null, p1: p.mgate.p1 ?? null, p2: p.mgate.p2 ?? null, review: p.review, cost: p.cost })), summary }, null, 2));
} else {
  const fmt = (p) => p.mgate.format === 'machine' ? `exit=${p.mgate.exit}` : (p.mgate.format === 'llm-legacy' ? 'LLM兜底' : (p.mgate.format === 'none' ? '无证据' : `?${p.mgate.format}`));
  console.log(`run 遥测看板（${root}）\n`);
  console.log('项目 | 阶段 | 轮数 | M门 | P0/P1/P2 | 字数 | 审稿 | token');
  console.log('---|---|---|---|---|---|---|---');
  for (const p of projects) {
    const sev = p.mgate.format === 'machine' ? `${p.mgate.p0}/${p.mgate.p1}/${p.mgate.p2}` : '—';
    console.log(`${p.name} | ${p.stage} | ${p.rounds || '—'} | ${fmt(p)} | ${sev} | ${p.han || '—'} | ${p.review ?? '—'} | ${p.cost ?? '—'}`);
  }
  console.log(`\n== 汇总 ==`);
  console.log(`项目 ${n} 个：${Object.entries(byStage).map(([k, v]) => `${k} ${v}`).join(' / ')}`);
  console.log(`M 门证据：机器格式 ${byFormat.machine} / LLM 兜底 ${byFormat['llm-legacy']} / 无证据 ${byFormat.none} / 不可解析 ${byFormat.unparseable}`);
  console.log(`平均修订轮数 ${summary.avgRevisionRounds ?? '—'}｜累计 P0=${sumP0} P1=${sumP1} P2=${sumP2}｜累计字数 ${sumHan}（全文汉字，含文末节）`);
  console.log(`\n== 门拦截频率 TOP（仅机器报告，跨项目 P0/P1 合计）==`);
  if (topGates.length === 0) console.log('（无可解析的机器报告）');
  for (const g of topGates.slice(0, 12)) console.log(`  ${g.gate.padEnd(10)} P0×${g.p0}  P1×${g.p1}  P2×${g.p2}`);
}
