#!/usr/bin/env node
// build-evidence-bundle.mjs — T8 终检：自动生成 final/证据包/
// 用法: node scripts/build-evidence-bundle.mjs <run/项目名> [--project <名>]
// 例:   node scripts/build-evidence-bundle.mjs E:\HERNESS\run\platform-gig-social-insurance
// 行为: 收集 文献卡/数据卡/案例卡/先行者清单/分析大纲/批判报告/审计报告/复核报告/反哺报告/修订说明*/status/01-任务简报 到 <项目>/final/证据包/
import { readdirSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const project = process.argv[2];
if (!project || !existsSync(project)) {
  console.error('用法: node build-evidence-bundle.mjs <run/项目名>');
  process.exit(2);
}

// 收集规则：源相对路径 → 目标文件名（找不到就跳过并记录）
const RULES = [
  ['literature/文献卡.md', '文献卡.md'],
  ['literature/先行者清单.md', '先行者清单.md'],
  ['data/数据卡.md', '数据卡.md'],
  ['cases/案例卡.md', '案例卡.md'],
  ['analysis/分析大纲.md', '分析大纲.md'],
  ['analysis/批判报告-v1.md', '批判报告-v1.md'],
  ['audits/审计报告-v1.md', '审计报告-v1.md'],
  ['audits/复核报告-v1.md', '复核报告-v1.md'],
  ['audits/反哺报告-v1.md', '反哺报告-v1.md'],
  ['audits/审稿报告-v1.md', '审稿报告-v1.md'],
  ['01-任务简报.md', '01-任务简报.md'],
  ['status.md', 'status.md'],
];

const destDir = join(project, 'final', '证据包');
if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

let copied = 0, missing = 0;
for (const [rel, name] of RULES) {
  const src = join(project, rel);
  if (existsSync(src)) {
    copyFileSync(src, join(destDir, name));
    copied++;
    console.log(`✓ ${rel} -> 证据包/${name}`);
  } else {
    missing++;
    console.log(`· 跳过(不存在): ${rel}`);
  }
}

// 修订说明 *：drafts/ 下所有 修订说明-*.md
const draftsDir = join(project, 'drafts');
if (existsSync(draftsDir)) {
  for (const f of readdirSync(draftsDir)) {
    if (/^修订说明-.*\.md$/.test(f)) {
      copyFileSync(join(draftsDir, f), join(destDir, f));
      copied++;
      console.log(`✓ drafts/${f} -> 证据包/${f}`);
    }
  }
}

console.log(`\n证据包生成完成: 复制 ${copied} 个文件, 跳过 ${missing} 个缺失源.`);
console.log(`目录: ${destDir}`);
