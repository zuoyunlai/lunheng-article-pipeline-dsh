#!/usr/bin/env node
// stats-cli.mjs — /lunheng -stats 薄壳 wrapper
// 版本：v18.7.1（v18.7.0 bug fix：补注册原 v18.5.0 已有的论衡运行时遥测看板命令）
//
// 真实看板由论衡 v18.5.0 的 skills/lunheng-article-pipeline/scripts/lunheng-stats.mjs 实现
// 本脚本仅做：参数透传 + 工作目录定位 + 错误回传
//
// 用法：
//   /lunheng -stats                    # 扫描 <workspace>/run
//   /lunheng -stats --run-dir <path>    # 扫描指定目录
//   /lunheng -stats --json             # JSON 输出（程序化消费）

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 论衡 lunheng-stats.mjs 路径（v18.5.0 已存在的随包脚本）
// 定位策略：v18.7.1 后 lunheng-commands 已嵌入论衡 bundle 内（skills/lunheng-commands/scripts/），
// lunheng-stats.mjs 在 skills/lunheng-article-pipeline/scripts/，两者并列
const candidates = [
  // v18.7.1+ 嵌入布局（默认）：从 scripts/ 向上找到 skills/，再横向找到 lunheng-article-pipeline/scripts/
  resolve(__dirname, '..', '..', 'lunheng-article-pipeline', 'scripts', 'lunheng-stats.mjs'),
  // 兼容旧 monorepo 布局（lunheng-commands 与 lunheng-article-pipeline-dsh 并列）
  resolve(__dirname, '..', '..', 'lunheng-article-pipeline-dsh', 'skills', 'lunheng-article-pipeline', 'scripts', 'lunheng-stats.mjs'),
  // 兼容旧独立布局（lunheng-commands 包独立时）
  resolve(process.cwd(), 'lunheng-article-pipeline-dsh', 'skills', 'lunheng-article-pipeline', 'scripts', 'lunheng-stats.mjs'),
];

function findStatsScript() {
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * 调用 lunheng-stats.mjs 并透传参数。
 * @param {string[]} args - 透传给 lunheng-stats.mjs 的参数（不含 node）
 * @returns {object} {ok, exitCode, stdout, stderr}
 */
export async function runStats(args = []) {
  const scriptPath = findStatsScript();
  if (!scriptPath) {
    return {
      ok: false,
      error: '找不到论衡 lunheng-stats.mjs 脚本。请确认 lunheng-commands 与 lunheng-article-pipeline-dsh 仓库并列布局，或用 --run-dir 显式指定。',
      candidates_attempted: candidates,
    };
  }

  return new Promise((resolvePromise) => {
    const proc = spawn('node', [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LUNHENG_STATS_ROUTE: 'lunheng-commands' },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    proc.on('close', (exitCode) => {
      resolvePromise({
        ok: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        scriptPath,
      });
    });
    proc.on('error', (err) => {
      resolvePromise({
        ok: false,
        exitCode: -1,
        error: `spawn failed: ${err.message}`,
        scriptPath,
      });
    });
  });
}

// CLI 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const result = await runStats(args);
  if (!result.ok && result.error) {
    console.error(result.error);
    process.exit(1);
  }
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode || 0);
}