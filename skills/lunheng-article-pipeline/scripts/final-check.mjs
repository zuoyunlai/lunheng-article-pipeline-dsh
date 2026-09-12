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
import { installExitGuard, requireExistingDir, EXIT_USAGE, EXIT_INTERNAL } from './_lib/exit-guard.mjs'; // 退出码硬化（v18.0.5）
installExitGuard();   // fs 类异常 → 10；其余内部错误 → 70（不再让崩溃伪装成「1 = P1 内容残留」）

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const noSummary = args.includes('--no-summary');
const reportIdx = args.indexOf('--report');
const reportPath = reportIdx >= 0 && args[reportIdx + 1] ? args[reportIdx + 1] : null;
// project = 第一个不以 -- 开头的参数；--report 后跟路径值，需排除
const project = args.find((a, i) => !a.startsWith('--') && (reportIdx < 0 || i !== reportIdx + 1));

if (!project || !existsSync(project)) {
  console.error('用法: node scripts/final-check.mjs <run/项目名> [--no-summary] [--json] [--report <path>]');
  process.exit(10); // v18.0.2 修：参数/路径错误一律 10（旧版 2 与「P0 致命」撞码，且与下方推荐语声称的 else=exit 10 自相矛盾）
}
requireExistingDir(project, '项目目录');   // v18.0.5：传文件当项目 → 立即 10（旧版会走到 mkdirSync ENOTDIR 崩溃 → exit 1）

const final = join(project, 'final', '定稿.md');
const evDir = join(project, 'final', '证据包');
// scripts/ 绝对路径：必须用 fileURLToPath（URL.pathname 是 percent-encoded，
// 安装路径含空格/中文时子脚本全部找不到 → 误报「M 门未过」，v2.5.2-dsh.13 修复）
const scriptDir = dirname(fileURLToPath(import.meta.url));

const steps = [
  // 字数口径：全流水线锁定「正文区纯汉字」（与任务简报-template 同口径）；
  // 旧版传 --full（全文）却被称为「字数权威值」→ 与目标区间比对会系统性偏大（v2.5.2-dsh.13 修复）
  { name: 'count-chars.mjs', cmd: 'node', args: [join(scriptDir, 'count-chars.mjs'), final], opt: true, parse: 'count-chars' },
  // v17.0.0 顺序修复（端到端测试反哺）：**证据包刷新必须排在 M 门之前**。
  //   旧顺序是 count-chars → m-gate-check → build-evidence-bundle，于是 M 门读到的证据包是**上一次**收集的副本
  //   ——实测：文献卡在项目里已更新到 4 条，而证据包副本还是 2 条 → M-Form-10 报「头部 2 条 ≠ 正文 1 条」（误报）。
  //   改为：count-chars → build-evidence-bundle（先刷新）→ m-gate-check（再校验）。
];
if (!noSummary) steps.push({ name: 'build-evidence-bundle.mjs --summary', cmd: 'node', args: [join(scriptDir, 'build-evidence-bundle.mjs'), project, '--summary'], opt: true, parse: null });
// 一并落盘 M 门报告到真源路径（final/M-Gate-Report.json），供 build-evidence-bundle 的审计视图读取
steps.push({ name: 'm-gate-check.mjs', cmd: 'node', args: [join(scriptDir, 'm-gate-check.mjs'), final, evDir, '--report', join(project, 'final', 'M-Gate-Report.json')], opt: false, parse: 'm-gate' });

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
  // v18.0.5（第三方审计 P1-1）：`r.status === null` 表示**子进程根本没跑起来**（spawn 失败：node 不在 PATH、
  //   EACCES 等）。旧版把它记成 exit=1 → 报告说「⚠️ 存在 P1 残留，可触发 T5 修订一轮」——纯属误导。
  //   现在：spawn 失败记 `EXIT_INTERNAL`（70）并给出独立推荐语（属环境/脚本问题，不是内容问题）。
  const spawnFailed = r.status === null && (r.error || r.signal);
  const statusVal = spawnFailed ? EXIT_INTERNAL : r.status;
  const ok = statusVal === 0;
  summary.push({ step: step.name, exit: statusVal, ok, ...(spawnFailed ? { spawnError: String(r.error?.message || r.signal) } : {}) });
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
    if (!wantJson) console.error(`\n❌ [${step.name}] 非零退出 ${statusVal}（硬依赖，主控必须修复）`);
    exitCode = statusVal || 1;
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
      hardExit: parsedOutputs['m-gate'].exit, // 脚本机械 exit（= M-Gate-Report.json 的 script_exit_raw 语义）
    } : null,
    // v18.0.0 修复：旧版只处理 0/1，其余一律落 `else` → **exit 3（仅 P2，无 P0/P1）被误报「存在 P0 致命问题」**。
    //   现按 M-Gate-Algorithm.md 的 exit 语义分档（0/1/2/3/10）。
    recommendation: exitCode === 0
      ? '✅ 终检通过（无失败项），可交付主人终审'
      : exitCode === 1
      ? '⚠️ 终检存在 P1 残留，主控可触发 T5 修订一轮'
      : exitCode === 2
      ? '❌ 终检存在 P0 致命问题，禁止标记终检完成'
      : exitCode === 3
      ? '🔍 仅 P2 / LLM兜底 / SKIP 残留（无 P0/P1）——须 T8 逐项复核后以 T8 裁定值放行（不得当作失败，也不得无条件当作通过）'
      : exitCode === EXIT_INTERNAL
      ? '🛠️ 内部错误（EX_SOFTWARE 70）——子步骤未跑起来或脚本缺陷，**与正文内容无关**；核对上面的 spawnError/栈后重跑'
      : '⛔ 参数/路径错误（exit 10）——检查 m-gate-check 的证据包目录参数',
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
