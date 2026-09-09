#!/usr/bin/env node
// normalize-trust-level.mjs — 数据卡「信任级别」独立行规范化（v2.5.2-dsh.11+）
// 用法: node scripts/normalize-trust-level.mjs <数据卡.md> [<数据卡2.md> ...]
// 与 m-gate M-Form-6 同款切块（cardRe），为每条 [Dxx] 追加独立行：
//   `信任级别：<已发布|主人投喂|二手转引>（<备注>）`
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) { console.error('用法: node normalize-trust-level.mjs <数据卡.md> ...'); process.exit(1); }
const TOKENS = ['主人投喂', '二手转引', '已发布'];
const COMPLIANT = /信任级别\**[:：]\s*(已发布|主人投喂|二手转引)/;

for (const file of files) {
  if (!existsSync(file)) { console.error(`跳过（不存在）: ${file}`); continue; }
  let text = readFileSync(file, 'utf8');
  const ids = [...new Set([...text.matchAll(/\[D(\d+)\]/g)].map((m) => m[1]))];
  let changed = 0;
  for (const id of ids) {
    const cardRe = new RegExp(`(?:#{2,4}\\s*\\[D${id}\\]|\\n\\[D${id}\\][^\\n]*\\n)([\\s\\S]*?)(?=\\n#{1,4}\\s|\\n\\[D\\d+\\]|$)`);
    const match = text.match(cardRe);
    if (!match) continue;
    const block = match[0];
    if (COMPLIANT.test(block)) continue;
    const token = TOKENS.find((t) => block.includes(t)) || '已发布';
    const im = block.match(/信任级别\**[:：]\s*([^\n（）()|，,;；]*)/);
    const detail = im && im[1].trim() ? `（${im[1].trim().replace(/[🟢🟡🔴]/g, '').trim()}）` : '';
    const nl = block.indexOf('\n');
    const pos = match.index + (nl === -1 ? block.length : nl);
    text = text.slice(0, pos) + `\n信任级别：${token}${detail}` + text.slice(pos);
    changed++;
  }
  writeFileSync(file, text);
  console.log(`${file}: ${changed} 条已规范化`);
}
