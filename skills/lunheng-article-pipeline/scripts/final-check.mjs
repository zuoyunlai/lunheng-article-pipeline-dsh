#!/usr/bin/env node
// 论衡一键终检脚本（v2.5.2-dsh.7 新增，主控 T8 终检合并 3 脚本串联）
// 用法: node scripts/final-check.mjs <run/项目名>
//   或:  node scripts/final-check.mjs <run/项目名> --no-summary  (跳过 build-evidence-bundle --summary)
// 等价于依次执行：
//   1. scripts/count-chars.mjs <项目>/final/定稿.md --full
//   2. scripts/m-gate-check.mjs   <项目>/final/定稿.md <项目>/final/证据包
//   3. scripts/build-evidence-bundle.mjs <项目> --summary    (默认开；--no-summary 关)
// 节省主控 T8 三次手动调用 + 上下文切换，节省 5-8 分钟 / 项目。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const project = process.argv[2];
const noSummary = process.argv.includes('--no-summary');
if (!project || !existsSync(project)) {
  console.error('用法: node scripts/final-check.mjs <run/项目名> [--no-summary]');
  process.exit(2);
}

const final = join(project, 'final', '定稿.md');
const evDir = join(project, 'final', '证据包');
const scriptDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'); // scripts/ 绝对路径

const steps = [
  { name: 'count-chars.mjs', cmd: 'node', args: [join(scriptDir, 'count-chars.mjs'), final, '--full'], opt: true },
  { name: 'm-gate-check.mjs', cmd: 'node', args: [join(scriptDir, 'm-gate-check.mjs'), final, evDir], opt: false },
];
if (!noSummary) steps.push({ name: 'build-evidence-bundle.mjs --summary', cmd: 'node', args: [join(scriptDir, 'build-evidence-bundle.mjs'), project, '--summary'], opt: true });

console.log(`# final-check: ${project}`);
console.log(`# 串联 ${steps.length} 步：${steps.map((s) => s.name).join(' → ')}\n`);

const t0 = Date.now();
let exitCode = 0;
const summary = [];
for (const step of steps) {
  console.log(`\n========== [${step.name}] ==========`);
  const r = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: false });
  const ok = r.status === 0;
  summary.push({ step: step.name, exit: r.status, ok });
  if (!ok && !step.opt) {
    console.error(`\n❌ [${step.name}] 非零退出 ${r.status}（硬依赖，主控必须修复）`);
    exitCode = r.status || 1;
    break;
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n========== final-check 完成（${elapsed}s） ==========`);
console.log(JSON.stringify({ project, exit: exitCode, steps: summary }, null, 2));
process.exit(exitCode);
