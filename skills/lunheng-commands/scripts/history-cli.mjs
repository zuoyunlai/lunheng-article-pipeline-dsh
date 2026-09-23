#!/usr/bin/env node
// history-cli.mjs — 读 run/<id>/history.jsonl + 输出 --diff
// 版本：v1.0.0

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

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
  const historyPath = join(RUN_DIR, projectId, 'history.jsonl');
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
  const dir1 = join(RUN_DIR, id1);
  const dir2 = join(RUN_DIR, id2);
  if (!existsSync(dir1) || !existsSync(dir2)) {
    return { error: `项目目录不存在：${!existsSync(dir1) ? dir1 : dir2}` };
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

// CLI 调用入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const subCmd = process.argv[2];
  if (subCmd === 'list' || !subCmd) {
    const result = listProjects();
    if (result.error) { console.error(result.error); process.exit(1); }
    console.log('run/* 项目列表：');
    for (const p of result) {
      console.log(`  ${p.name.padEnd(40)} ${p.lastModified.toISOString()}${p.hasHistory ? ' [有 history]' : ''}`);
    }
  } else if (subCmd === 'read') {
    const result = readHistory(process.argv[3]);
    if (result.error) { console.error(result.error); process.exit(1); }
    console.log(JSON.stringify(result, null, 2));
  } else if (subCmd === 'diff') {
    const result = diffProjects(process.argv[3], process.argv[4]);
    if (result.error) { console.error(result.error); process.exit(1); }
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(`未知子命令：${subCmd}。可用：list / read <id> / diff <id1> <id2>`);
    process.exit(1);
  }
}