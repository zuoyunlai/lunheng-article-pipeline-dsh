// route.test.mjs — 路由解析单测
// 版本：v1.0.0

import { test } from 'node:test';
import assert from 'node:assert/strict';
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

// -rollback 二次确认
test('-rollback without --confirm fails', () => {
  const result = routeCommand(['node', '-lunheng', '-rollback', 'phase-25-outline']);
  assert.equal(result.ok, undefined);
  assert.ok(result.error.includes('--confirm'));
});

test('-rollback with --confirm succeeds', () => {
  const result = routeCommand(['node', '-lunheng', '-rollback', 'phase-25-outline', '--confirm']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'rollback');
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
test('listCommands returns 11 commands (filtered out -h alias)', () => {
  const cmds = listCommands();
  assert.equal(cmds.length, 11);
  assert.ok(cmds.find(c => c.cmd === '-draft'));
  assert.ok(cmds.find(c => c.cmd === '-cite'));
  assert.ok(cmds.find(c => c.cmd === '-rollback'));
  assert.ok(cmds.find(c => c.cmd === '-stats'));
});