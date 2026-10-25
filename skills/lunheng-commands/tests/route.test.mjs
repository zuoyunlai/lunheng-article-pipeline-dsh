// route.test.mjs — 路由解析单测 + **CLI 端到端**（v18.62.4 新增后半）
// 版本：v1.0.3

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeCommand, listCommands } from '../scripts/route-command.mjs';

// 有效命令：-draft
test('valid command -draft without args', () => {
  const result = routeCommand(['node', '-lunheng', '-draft']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'full');
  assert.deepEqual(result.args, []);
});

test('valid command -draft with task', () => {
  const result = routeCommand(['node', '-lunheng', '-draft', '写一篇 5000 字论文']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'full');
  assert.deepEqual(result.args, ['写一篇 5000 字论文']);
});

// -resume
test('valid command -resume', () => {
  const result = routeCommand(['node', '-lunheng', '-resume', 'phase-25-outline']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'resume');
  assert.deepEqual(result.args, ['phase-25-outline']);
});

// -cite 三种模式
test('valid command -cite default mode', () => {
  const result = routeCommand(['node', '-lunheng', '-cite', '段落文本']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'cite');
  assert.deepEqual(result.args, ['段落文本']);
});

test('valid command -cite -auto', () => {
  const result = routeCommand(['node', '-lunheng', '-cite', '-auto']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'cite-auto');
  assert.deepEqual(result.args, []);
});

test('valid command -cite -manual', () => {
  const result = routeCommand(['node', '-lunheng', '-cite', '-manual', '[CITE]']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'cite-manual');
  assert.deepEqual(result.args, ['[CITE]']);
});

// -audit
test('valid command -audit', () => {
  const result = routeCommand(['node', '-lunheng', '-audit']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'audit');
});

// -journal
test('valid command -journal', () => {
  const result = routeCommand(['node', '-lunheng', '-journal', 'Nature']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'journal');
  assert.deepEqual(result.args, ['Nature']);
});

// -ppt
test('valid command -ppt', () => {
  const result = routeCommand(['node', '-lunheng', '-ppt']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'ppt');
});

// -history
test('valid command -history', () => {
  const result = routeCommand(['node', '-lunheng', '-history']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'history');
});

// -rollback（v19.27.5 · 审计 P1-4：**声明存在但无实现** → 路由层必须显式拒绝，不得返回假绿）
test('-rollback 无论带不带 --confirm 都显式报「未实现」，并给替代路径', () => {
  for (const extra of [[], ['--confirm']]) {
    const result = routeCommand(['node', '-lunheng', '-rollback', 'phase-25-outline', ...extra]);
    assert.equal(result.ok, undefined, '-rollback 不得返回 ok（本仓无 checkpoint 机制）');
    assert.match(result.error, /没有实现/);
    assert.match(result.error, /drafts\/初稿-vN\.md/, '必须给出正文回退的真实路径');
    assert.match(result.error, /git checkout/, '必须给出文件级回退的真实路径');
  }
});

// -status
test('valid command -status', () => {
  const result = routeCommand(['node', '-lunheng', '-status']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'status');
});

test('valid command -status with id', () => {
  const result = routeCommand(['node', '-lunheng', '-status', 'my-project']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'status');
  assert.deepEqual(result.args, ['my-project']);
});

test('valid command -stats', () => {
  const result = routeCommand(['node', '-lunheng', '-stats']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'stats');
});

test('valid command -stats with --run-dir', () => {
  const result = routeCommand(['node', '-lunheng', '-stats', '--run-dir', '/tmp/run']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'stats');
  assert.deepEqual(result.args, ['--run-dir', '/tmp/run']);
});

// -help
test('valid command -help', () => {
  const result = routeCommand(['node', '-lunheng', '-help']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'help');
});

test('valid command -h alias', () => {
  const result = routeCommand(['node', '-lunheng', '-h']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'help');
});

// 错误处理
test('unknown command fails', () => {
  const result = routeCommand(['node', '-lunheng', '-unknown-cmd']);
  assert.ok(result.error.includes('未知命令'));
  assert.ok(result.error.includes('-unknown-cmd'));
});

test('missing -lunheng prefix fails', () => {
  const result = routeCommand(['node', '-draft']);
  assert.ok(result.error.includes('用法'));
});

test('missing command fails', () => {
  const result = routeCommand(['node', '-lunheng']);
  assert.equal(result.action, 'help');
  assert.equal(result.ok, true);
});

// listCommands 函数
test('listCommands returns 13 commands (filtered out -h alias)', () => {
  const cmds = listCommands();
  // v19.27.8（审计 P2-2）：11 → 13，新增主人侧入口 `-gate` / `-abort`（机械实现 = owner-cli.mjs）
  assert.equal(cmds.length, 13);
  assert.ok(cmds.find(c => c.cmd === '-draft'));
  assert.ok(cmds.find(c => c.cmd === '-cite'));
  assert.ok(cmds.find(c => c.cmd === '-rollback'));
  assert.ok(cmds.find(c => c.cmd === '-stats'));
  assert.ok(cmds.find(c => c.cmd === '-gate'));
  assert.ok(cmds.find(c => c.cmd === '-abort'));
});

// v19.27.8（审计 P2-2）：主人侧两个入口的**参数形状**判据。
//   `--approve` 与 `--reject` 同时给 / 都不给必须被路由层拒绝——这是最容易手滑的两种写法，
//   放过去了 `owner-cli` 也只能二选一猜，等于替主人做决定。
test('-gate：缺 --approve/--reject 或两者同时给 → 用法错（不返回 ok）', () => {
  const bare = routeCommand(['node', '-lunheng', '-gate', '某项目', 'Phase0']);
  assert.ok(bare.error, '两个都没给必须报错');
  const both = routeCommand(['node', '-lunheng', '-gate', '某项目', 'Phase0', '--approve', '--reject']);
  assert.ok(both.error, '两个都给必须报错');
});

test('-gate：合法形态转交 owner-cli，并带 decision', () => {
  const ok = routeCommand(['node', '-lunheng', '-gate', '某项目', 'Phase2.5', '--approve', '--note', '可以']);
  assert.equal(ok.ok, true);
  assert.equal(ok.action, 'gate');
  assert.equal(ok.agent, 'owner-cli');
  assert.equal(ok.decision, 'approve');
  assert.deepEqual(ok.args, ['某项目', 'Phase2.5', '--approve', '--note', '可以']);
});

test('-abort：转交 owner-cli（args 原样透传）', () => {
  const r = routeCommand(['node', '-lunheng', '-abort', '某项目', '--reason', '换题']);
  assert.equal(r.ok, true);
  assert.equal(r.action, 'abort');
  assert.equal(r.agent, 'owner-cli');
  assert.deepEqual(r.args, ['某项目', '--reason', '换题']);
});

// ─────────────────────────────────────────────────────────────────────────────
// CLI 端到端（v18.62.4 新增 · 全量审计-v18.62.3 P1-4）
//
// **为什么必须补这一组**：上面的 22 条用例全部传**合成 argv** `['node','-lunheng',…]`，
//   而真实调用下 `process.argv` 是 `[node, <脚本绝对路径>, …]` —— 旧入口直接把它交给
//   `routeCommand`，于是 `argv[1] !== '-lunheng'` **恒真** → 命令行调用**永远** exit 1 + 用法错，
//   JSON 与 help 输出**在任何真实调用下都不可达**。单测全绿却完全测不到，故这一组**真的 spawn 进程**。
// ─────────────────────────────────────────────────────────────────────────────

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'route-command.mjs');

/** 跑真实 CLI：返回 { code, stdout, stderr }（非 0 退出不抛，照常返回）。 */
function cli(...args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? -1, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

test('CLI E2E：真实调用 `-draft <任务>` → JSON + exit 0（P1-4 回归钉）', () => {
  const r = cli('-draft', '写一篇 5000 字论文');
  assert.equal(r.code, 0, `真实 CLI 必须可用（旧版一律 exit 1）：stderr=${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.action, 'full');
  assert.deepEqual(j.args, ['写一篇 5000 字论文']);
});

test('CLI E2E：`-status --pending` → status-pending（v1.0.2 头号特性，此前无任何路由级用例）', () => {
  const r = cli('-status', '--pending');
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.action, 'status-pending');
  assert.deepEqual(j.args, []);
});

test('CLI E2E：`-help` / `-h` / 无参 → 命令表 + exit 0', () => {
  for (const args of [['-help'], ['-h'], []]) {
    const r = cli(...args);
    assert.equal(r.code, 0, `args=${JSON.stringify(args)} stderr=${r.stderr}`);
    assert.match(r.stdout, /可用命令/);
    assert.match(r.stdout, /-draft/);
    assert.match(r.stdout, /-stats/);
  }
});

test('CLI E2E：未知命令 → exit 1 且回「未知命令」并列出可用命令', () => {
  const r = cli('-unknown-cmd');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /未知命令/);
  assert.match(r.stderr, /-draft/);
});

test('CLI E2E：`-rollback` → exit 1 且 stderr 明确「没有实现」（不返回 ok 假绿）', () => {
  for (const extra of [[], ['--confirm']]) {
    const r = cli('-rollback', 'phase-25-outline', ...extra);
    assert.equal(r.code, 1, '无实现的命令必须以失败退出，不能被当成成功交给主控');
    assert.match(r.stderr, /没有实现/);
  }
});

test('CLI E2E：**源码级回归钉**——入口必须剥掉 argv 前两位（防再次把 process.argv 直接交给 routeCommand）', () => {
  // ⚠️ 必须先**剥掉注释**再断言：本文件的修复说明里**正当引用**了旧写法
  //   （`routeCommand(process.argv)` 作为反面例子），不剥注释会把这个引用判成违规（首版即踩）。
  const raw = readFileSync(SCRIPT, 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(
    !/routeCommand\(\s*process\.argv\s*\)/.test(src),
    '入口不得把 `process.argv` 直接交给 routeCommand：argv[1] 恒为脚本路径 → 必然走 usage 分支（P1-4）',
  );
  assert.ok(
    /routeCommand\(\s*\[\s*['"]node['"]\s*,\s*['"]-lunheng['"]\s*,\s*\.\.\.process\.argv\.slice\(2\)\s*\]/.test(src),
    '入口须以「合成 argv + slice(2)」调用（与 routeCommand 的 argv 契约一致）',
  );
});