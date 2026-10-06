#!/usr/bin/env node
// history-cli.mjs — 读 run/<id>/history.jsonl + 输出 --diff
// 版本：v1.0.3（论衡 v18.79.0；v18.67.0 全量审计批 2 起「引擎版本锚定」纳入规则 ㉖ 机检）｜v18.62.5 P2-6 引入 run-path-fence 三层收口

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveProjectDir } from '../../../lib/run-path-fence.mjs';

/**
 * run/ 目录路径解析
 * 默认相对当前工作目录，可通过 RUN_DIR 环境变量覆盖
 */
const RUN_DIR = resolve(process.env.RUN_DIR || './run');

/**
 * 列出 run/ 下所有项目
 * @returns {Array<{name: string, lastModified: Date, hasHistory: boolean}>}
 */
export function listProjects() {
  if (!existsSync(RUN_DIR)) {
    return { error: `run/ 目录不存在：${RUN_DIR}。请确认工作目录或在 RUN_DIR 环境变量指定项目根。` };
  }
  const entries = readdirSync(RUN_DIR, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectPath = join(RUN_DIR, entry.name);
    const briefPath = join(projectPath, '01-任务简报.md');
    if (!existsSync(briefPath)) continue;
    const historyPath = join(projectPath, 'history.jsonl');
    const stat = statSync(projectPath);
    projects.push({
      name: entry.name,
      lastModified: stat.mtime,
      hasHistory: existsSync(historyPath),
    });
  }
  return projects.sort((a, b) => b.lastModified - a.lastModified);
}

/**
 * 读 run/<id>/history.jsonl
 * @param {string} projectId
 * @returns {Array<object>|{error: string}}
 */
export function readHistory(projectId) {
  if (!projectId) return { error: '缺 projectId 参数。示例：-lunheng -history read <projectId>' };
  // v18.62.5 P2-6：三层围栏（词法 → 结构 → 物理 realpath）——与 lib/commands.js 的 pickProject 同源
  const projectDir = resolveProjectDir(RUN_DIR, projectId)
  if (!projectDir) {
    return { error: `非法的 projectId「${projectId}」：必须是 run/ 下的直接子目录名（不允许 ../ / 绝对路径 / 多级路径）。` };
  }
  const historyPath = join(projectDir, 'history.jsonl');
  if (!existsSync(historyPath)) {
    return { error: `history.jsonl 不存在：${historyPath}。该项目可能未启用 history.jsonl 写入（v18.7.0 落地后由论衡主控在状态变更时自动写入）。` };
  }
  const content = readFileSync(historyPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch (e) {
      entries.push({ _parseError: e.message, _rawLine: line });
    }
  }
  return entries;
}

/**
 * 对比两个项目（基于 sha256 + 文件级 read，简化实现）
 * @param {string} id1
 * @param {string} id2
 * @returns {object}
 */
export function diffProjects(id1, id2) {
  if (!id1 || !id2) return { error: '需两个项目 ID。示例：-lunheng -history diff <id1> <id2>' };
  // v18.62.5 P2-6：三层围栏同源
  const dir1 = resolveProjectDir(RUN_DIR, id1);
  const dir2 = resolveProjectDir(RUN_DIR, id2);
  if (!dir1 || !dir2) {
    const bad = !dir1 ? id1 : id2
    return { error: `非法的 projectId「${bad}」：必须是 run/ 下的直接子目录名（不允许 ../ / 绝对路径 / 多级路径）。` };
  }
  // 简化实现：列出每个项目的关键文件大小
  const files1 = ['01-任务简报.md', 'status.md', 'final/定稿.md'];
  const files2 = ['01-任务简报.md', 'status.md', 'final/定稿.md'];
  const result = { id1, id2, comparisons: [] };
  for (let i = 0; i < files1.length; i++) {
    const p1 = join(dir1, files1[i]);
    const p2 = join(dir2, files2[i]);
    const s1 = existsSync(p1) ? statSync(p1) : null;
    const s2 = existsSync(p2) ? statSync(p2) : null;
    result.comparisons.push({
      file: files1[i],
      project1: s1 ? { size: s1.size, mtime: s1.mtime } : null,
      project2: s2 ? { size: s2.size, mtime: s2.mtime } : null,
    });
  }
  return result;
}

// CLI 调用入口（v18.62.0 F6：可移植判定——`file://${argv[1]}` 在 Windows 下永不相等，入口静默不执行）
// v18.69.0（批 6-C · P2 修复）：本脚本是**非判定脚本**（读 history / 列项目，不判稿件内容质量），
//   按本仓判据「非判定脚本的 1 一律撞码」，所有 usage/路径错统一 exit 10（旧版 exit 1 会与
//   M 门族的「1 = P1 内容失败」撞义，调用方按 M 门习惯解读会误触发修订轮）。70 留给内部错（缺，故未用）。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const subCmd = process.argv[2];
  if (subCmd === 'list' || !subCmd) {
    const result = listProjects();
    if (result.error) { console.error(result.error); process.exit(10); }
    console.log('run/* 项目列表：');
    for (const p of result) {
      console.log(`  ${p.name.padEnd(40)} ${p.lastModified.toISOString()}${p.hasHistory ? ' [有 history]' : ''}`);
    }
  } else if (subCmd === 'read') {
    const result = readHistory(process.argv[3]);
    if (result.error) { console.error(result.error); process.exit(10); }
    console.log(JSON.stringify(result, null, 2));
  } else if (subCmd === 'diff') {
    const result = diffProjects(process.argv[3], process.argv[4]);
    if (result.error) { console.error(result.error); process.exit(10); }
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(`未知子命令：${subCmd}。可用：list / read <id> / diff <id1> <id2>`);
    process.exit(10);
  }
}