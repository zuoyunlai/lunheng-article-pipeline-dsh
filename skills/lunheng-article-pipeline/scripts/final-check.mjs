#!/usr/bin/env node
// 论衡一键终检脚本（v2.5.2-dsh.7 新增 + v2.5.2-dsh.7 增强 JSON 输出）
// 用法: node scripts/final-check.mjs <run/项目名> [--no-summary] [--json] [--report <path>]
//   --no-summary : 跳过 build-evidence-bundle --summary 步骤
//   --json       : 静默子脚本输出，只输出终检 JSON 总报告（机器可读）
//   --report PATH: 同时把总报告写入 PATH（默认 audits/final-check-v0.json）
// 等价于依次执行：
//   1. scripts/count-chars.mjs <项目>/final/定稿.md --full
//   2. scripts/m-gate-check.mjs   <项目>/final/定稿.md <项目>/final/证据包
//   3. scripts/build-evidence-bundle.mjs <项目> --summary    (默认开；--no-summary 关)
// 节省主控 T8 三次手动调用 + 上下文切换，节省 5-8 分钟 / 项目。
// v2.5.2-dsh.7 增强：解析 m-gate-check 的 JSON 输出与 count-chars 的 JSON 输出，汇总到 final-check.json，T8 终检可一次拿全报告不用 re-read 三个脚本输出
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const noSummary = args.includes('--no-summary');
const reportIdx = args.indexOf('--report');
const reportPath = reportIdx >= 0 && args[reportIdx + 1] ? args[reportIdx + 1] : null;
// project = 第一个不以 -- 开头的参数；--report 后跟路径值，需排除
const project = args.find((a, i) => !a.startsWith('--') && (reportIdx < 0 || i !== reportIdx + 1));

if (!project || !existsSync(project)) {
  console.error('用法: node scripts/final-check.mjs <run/项目名> [--no-summary] [--json] [--report <path>]');
  process.exit(2);
}

const final = join(project, 'final', '定稿.md');
const evDir = join(project, 'final', '证据包');
// scripts/ 绝对路径：必须用 fileURLToPath（URL.pathname 是 percent-encoded，
// 安装路径含空格/中文时子脚本全部找不到 → 误报「M 门未过」，v2.5.2-dsh.13 修复）
const scriptDir = dirname(fileURLToPath(import.meta.url));

const steps = [
  // 字数口径：全流水线锁定「正文区纯汉字」（与任务简报-template 同口径）；
  // 旧版传 --full（全文）却被称为「字数权威值」→ 与目标区间比对会系统性偏大（v2.5.2-dsh.13 修复）
  { name: 'count-chars.mjs', cmd: 'node', args: [join(scriptDir, 'count-chars.mjs'), final], opt: true, parse: 'count-chars' },
  { name: 'm-gate-check.mjs', cmd: 'node', args: [join(scriptDir, 'm-gate-check.mjs'), final, evDir], opt: false, parse: 'm-gate' },
];
if (!noSummary) steps.push({ name: 'build-evidence-bundle.mjs --summary', cmd: 'node', args: [join(scriptDir, 'build-evidence-bundle.mjs'), project, '--summary'], opt: true, parse: null });

if (!wantJson) {
  console.log(`# final-check: ${project}`);
  console.log(`# 串联 ${steps.length} 步：${steps.map((s) => s.name).join(' → ')}\n`);
}

const t0 = Date.now();
let exitCode = 0;
const summary = [];
const parsedOutputs = {};
for (const step of steps) {
  if (!wantJson) console.log(`\n========== [${step.name}] ==========`);
  const r = spawnSync(step.cmd, step.args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, encoding: 'utf8' });
  const ok = r.status === 0;
  summary.push({ step: step.name, exit: r.status, ok });
  // 解析子脚本的 JSON 输出（捕获整段 stdout，从头找第一个 { 到末尾找最后一个 }）
  if (step.parse) {
    const stdout = (r.stdout || '').trim();
    if (stdout) {
      try {
        // 直接尝试解析整段 stdout（子脚本输出只有 JSON）
        parsedOutputs[step.parse] = JSON.parse(stdout);
      } catch (e1) {
        // 回退：找首个 { 到最后一个 } 的子串
        const start = stdout.indexOf('{');
        const end = stdout.lastIndexOf('}');
        if (start >= 0 && end > start) {
          try {
            parsedOutputs[step.parse] = JSON.parse(stdout.slice(start, end + 1));
          } catch (e2) {
            parsedOutputs[step.parse] = { _parseError: e2.message, _stdoutHead: stdout.slice(0, 200) };
          }
        } else {
          parsedOutputs[step.parse] = { _parseError: e1.message, _stdoutHead: stdout.slice(0, 200) };
        }
      }
    }
  }
  if (!ok && !step.opt) {
    if (!wantJson) console.error(`\n❌ [${step.name}] 非零退出 ${r.status}（硬依赖，主控必须修复）`);
    exitCode = r.status || 1;
    break;
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
// 总报告（机器可读 JSON）
const report = {
  project,
  date: new Date().toISOString(),
  elapsedSec: parseFloat(elapsed),
  exit: exitCode,
  steps: summary,
  outputs: parsedOutputs,
  // 友好摘要（人类快速判断）
  summary: {
    hanChars: parsedOutputs['count-chars']?.hanChars ?? null,
    charScope: parsedOutputs['count-chars']?.scope ?? null,
    mGate: parsedOutputs['m-gate'] && parsedOutputs['m-gate'].exit !== undefined ? {
      total: parsedOutputs['m-gate'].total,
      pass: parsedOutputs['m-gate'].pass,
      p0: parsedOutputs['m-gate'].p0 || 0,
      p1: parsedOutputs['m-gate'].p1 || 0,
      p2: parsedOutputs['m-gate'].p2 || 0,
      soft: parsedOutputs['m-gate'].soft || 0,
      skips: parsedOutputs['m-gate'].skips || 0,
      hardExit: parsedOutputs['m-gate'].exit,
    } : null,
    recommendation: exitCode === 0
      ? '✅ 终检通过，可交付主人终审'
      : exitCode === 1
      ? '⚠️ 终检存在 P1 残留，主控可触发 T5 修订一轮'
      : '❌ 终检存在 P0 致命问题，禁止标记终检完成',
  },
};

if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n========== final-check 完成（${elapsed}s） ==========`);
  console.log(JSON.stringify(report, null, 2));
}

// 写报告到默认 / 指定路径
const finalReportPath = reportPath || join(project, 'audits', 'final-check-v0.json');
const reportDir = dirname(finalReportPath);   // 旧版硬编码反斜杠 → POSIX 与正斜杠 --report 都会崩（v2.5.2-dsh.13 修复）
if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
writeFileSync(finalReportPath, JSON.stringify(report, null, 2), 'utf8');
if (!wantJson) console.log(`\n📄 总报告: ${finalReportPath}`);

process.exit(exitCode);
