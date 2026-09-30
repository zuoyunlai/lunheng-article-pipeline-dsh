#!/usr/bin/env node
// flow-metrics.mjs — 流程只读仪器化（v18.62.0 F5）
// **仓库级脚本（不随包）**——与 closeout-verify / no-write-check 同类。
//
// 为什么存在：`references/case-studies.md` 实测给出**双峰分布**（17 个有效项目里 8 个跨度 ≥8 h、
//   另 8 个 ≤4 h），但**无归因**；`references/_shared/模型路由.md` 亦自陈「真实运行测量**未做**」。
//   双峰无法归因 = 后续任何「优化流程」都是**猜**。本脚本**不改流程**，只把既有产物里本就可导出的
//   四个可观测量汇总出来（**零新留痕义务**）。
//
// 四个观测量（全部派生自既有产物，不要求任何人多写一个字）：
//   ① 每门间隔时长   ← 四张 `阶段确认-*.md` §6「回复时间」之差
//   ② 返工轮次       ← `drafts/修订说明-vN.md` 与 `audits/审计报告-vN.md` 的最大 N
//   ③ 门首次通过率   ← §6「主控落盘结论」是否含「打回 / 驳回」
//   ④ 续接/重派痕迹  ← `agents-log.md` 的 `### Tn` 记录条数（> 角色数即发生过续接或重派）
//
// ⚠️ 判据（与其他仓库门一致）：**只报「需人工回核」的事实，不判结论**。本脚本**不是门**——
//   不设通过线、不参与 exit 2 语义（挂成门会立刻产生「为过门而刷时长」的压力，与 `quality-score.mjs` 同一判据）。
//
// 用法：
//   node scripts/flow-metrics.mjs [--run-dir <path>] [--json]
// 退出码：0 已输出（含「无项目」）/ 10 参数或路径错 / 70 内部错

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 四门固定文件名（真源 = 主人确认-template.md 的「命名真源」） */
export const GATES = [
  { id: 'Phase0', label: 'P0 定题' },
  { id: 'Phase2.5', label: 'P2.5 大纲' },
  { id: 'Phase3.5', label: 'P3.5 洞察' },
  { id: 'Phase5', label: 'P5 终稿' },
];

/** 从确认单 §6 抽取「回复时间」与「主控落盘结论」。 */
export function parseGateRecord(text) {
  const num = (label) => {
    const m = new RegExp(`\\*\\*${label}\\*\\*[：:]\\s*(.*)$`, 'm').exec(text);
    return m ? m[1].trim() : null;
  };
  const rawTime = num('回复时间');
  let at = null;
  if (rawTime) {
    const m = /(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/.exec(rawTime);
    if (m) at = Date.parse(`${m[1]}T${m[2].padStart(2, '0')}:${m[3]}:00`);
  }
  const conclusion = num('主控落盘结论') || '';
  const rejected = /打回|驳回/.test(conclusion);
  return { at: Number.isNaN(at) ? null : at, conclusion, rejected, rawTime };
}

/** 「返工轮次」= 修订说明 / 审计报告文件名里的最大 N。 */
export function maxRound(dir) {
  const scan = (sub, re) => {
    const d = join(dir, sub);
    if (!existsSync(d)) return 0;
    let mx = 0;
    for (const f of readdirSync(d)) {
      const m = re.exec(f);
      if (m) mx = Math.max(mx, Number(m[1]));
    }
    return mx;
  };
  return Math.max(scan('drafts', /^修订说明-v(\d+)\.md$/), scan('audits', /^审计报告-v(\d+)\.md$/));
}

/** 「续接/重派痕迹」= agents-log.md 的 `### Tn` 记录条数。 */
export function handoffCount(dir) {
  const p = join(dir, 'agents-log.md');
  if (!existsSync(p)) return 0;
  return [...readFileSync(p, 'utf8').matchAll(/^###\s*T\d+/gm)].length;
}

/**
 * 扫描 run 目录，产出每项目的四个观测量。
 * 项目判据 = 含 `01-任务简报.md`（与 pending-cli 同口径；run/ 下的基线/测试/归档目录跳过）。
 */
export function collectMetrics(runDir) {
  const projects = [];
  const nonProject = [];
  if (!existsSync(runDir)) return { projects, nonProject };
  for (const e of readdirSync(runDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = join(runDir, e.name);
    if (!existsSync(join(dir, '01-任务简报.md'))) { nonProject.push(e.name); continue; }
    const gates = [];
    for (const g of GATES) {
      const p = join(dir, `阶段确认-${g.id}.md`);
      gates.push({ id: g.id, label: g.label, present: existsSync(p), ...(existsSync(p) ? parseGateRecord(readFileSync(p, 'utf8')) : { at: null, conclusion: '', rejected: false, rawTime: null }) });
    }
    // 门间隔：相邻两门「回复时间」之差（小时）；只用两侧都有时间戳的相邻对
    const spans = [];
    for (let i = 1; i < gates.length; i++) {
      const a = gates[i - 1], b = gates[i];
      if (a.at && b.at && b.at >= a.at) spans.push({ from: a.id, to: b.id, hours: +( (b.at - a.at) / 3.6e6 ).toFixed(2) });
    }
    const delivered = existsSync(join(dir, 'final', '定稿.md'));
    const firstAt = gates.find((g) => g.at)?.at ?? null;
    const lastAt = [...gates].reverse().find((g) => g.at)?.at ?? null;
    projects.push({
      project: e.name,
      delivered,
      mtime: statSync(dir).mtime.toISOString().slice(0, 16).replace('T', ' '),
      gatesPresent: gates.filter((g) => g.present).length,
      gateTimes: gates.filter((g) => g.rawTime).map((g) => `${g.id}=${g.rawTime}`),
      spans,
      totalSpanHours: firstAt && lastAt && lastAt >= firstAt ? +((lastAt - firstAt) / 3.6e6).toFixed(2) : null,
      rejectedGates: gates.filter((g) => g.present && g.rejected).map((g) => g.id),
      rounds: maxRound(dir),
      handoffs: handoffCount(dir),
    });
  }
  projects.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return { projects, nonProject };
}

/** 汇总（只做算术，不做判定） */
export function summarize(projects) {
  const withSpan = projects.filter((p) => p.totalSpanHours !== null);
  const spans = withSpan.map((p) => p.totalSpanHours).sort((a, b) => a - b);
  const med = spans.length ? (spans.length % 2 ? spans[(spans.length - 1) / 2] : (spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2) : null;
  return {
    projects: projects.length,
    delivered: projects.filter((p) => p.delivered).length,
    withSpan: withSpan.length,
    spanMedianHours: med,
    spanMaxHours: spans.length ? spans[spans.length - 1] : null,
    spanMinHours: spans.length ? spans[0] : null,
    projectsWithRework: projects.filter((p) => p.rounds > 0).length,
    projectsWithRejectedGate: projects.filter((p) => p.rejectedGates.length > 0).length,
    projectsWithHandoffLog: projects.filter((p) => p.handoffs > 0).length,
  };
}

/** Markdown 渲染 */
export function render(projects, s, runDir) {
  const out = [];
  out.push(`# 流程读数（只读汇总，非门）`);
  out.push('');
  out.push(`> 扫描：\`${runDir}\`｜项目判据 = 含 \`01-任务简报.md\``);
  out.push('');
  out.push('| 项目 | 已交付 | 四门留痕 | 门跨度(h) | 返工轮 | 被驳门 | agents-log 条 |');
  out.push('|---|---|---|---|---|---|---|');
  for (const p of projects) {
    out.push(`| ${p.project} | ${p.delivered ? '✅' : '—'} | ${p.gatesPresent}/4 | ${p.totalSpanHours ?? '—'} | ${p.rounds} | ${p.rejectedGates.join(',') || '—'} | ${p.handoffs} |`);
  }
  out.push('');
  out.push('## 汇总（算术，非判定）');
  out.push('');
  out.push(`- 项目数：${s.projects}（已交付 ${s.delivered}）`);
  out.push(`- 有门时间戳的项目：${s.withSpan}｜门跨度 中位 ${s.spanMedianHours ?? '—'} h（min ${s.spanMinHours ?? '—'} / max ${s.spanMaxHours ?? '—'}）`);
  out.push(`- 有返工的项目：${s.projectsWithRework}`);
  out.push(`- 有「被驳门」的项目：${s.projectsWithRejectedGate}`);
  out.push(`- 有 agents-log 记录的项目：${s.projectsWithHandoffLog}`);
  out.push('');
  out.push('> **口径（与 closeout-verify 同判据）**：只报「需人工回核」的事实，**不判结论**——');
  out.push('> 「门跨度短」不等于流程好（也可能是草率过门），「返工多」不等于流程差（也可能是门在起作用）。');
  out.push('> 本脚本**不是门**：不设通过线、不参与 exit 2 语义。');
  return out.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const i = args.indexOf('--run-dir');
  let runDir = resolve(process.cwd(), 'run');
  if (i >= 0) {
    if (!args[i + 1]) { console.error('--run-dir 需要一个路径参数'); process.exit(10); }
    runDir = resolve(args[i + 1]);
  }
  if (!existsSync(runDir)) { console.error(`run 目录不存在：${runDir}`); process.exit(10); }
  try {
    const { projects, nonProject } = collectMetrics(runDir);
    const s = summarize(projects);
    if (json) console.log(JSON.stringify({ runDir, summary: s, projects, nonProject }, null, 2));
    else {
      console.log(render(projects, s, runDir));
      if (nonProject.length) console.log(`\n（跳过 ${nonProject.length} 个非项目目录：无 01-任务简报.md）`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`内部错误：${err && err.message}`);
    process.exit(70);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main(process.argv);
