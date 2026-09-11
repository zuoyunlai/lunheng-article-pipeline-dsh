#!/usr/bin/env node
// normalize-trust-level.mjs — 数据卡「信任级别」独立行规范化
//
// 用法: node scripts/normalize-trust-level.mjs <数据卡.md> [<数据卡2.md> ...] [--write]
//   默认 **dry-run**：只打印将为每条 [Dxx] 追加的行，不落盘。
//   --write：落盘，且先写同名 `.bak` 备份（符合 AGENTS.md 文件修改安全流程）。
//
// 与 m-gate M-Form-6 同款切块（cardRe），为每条 [Dxx] 追加独立行：
//   `信任级别：<已发布|主人投喂|二手转引>（<备注>）`
//
// ⚠️ **绝不推断**（v2.5.2-dsh.13 修订，第三方审计 P0）：
//   旧版在卡内完全无信任级别 token 时默认填「已发布」——等于用**最高信任档**掩盖未核验数据，
//   且会让 M-Form-6 的判定正则机械判过（证据链污染，比误删更隐蔽）。
//   现在：无 token → 该条**不写**、列入未决清单，脚本以 exit 1 收尾，由 T2/人工显式判定后重跑。
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const rawArgs = process.argv.slice(2);
const write = rawArgs.includes('--write');
const files = rawArgs.filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('用法: node normalize-trust-level.mjs <数据卡.md> ... [--write]（默认 dry-run，不落盘）');
  process.exit(1);
}
const TOKENS = ['主人投喂', '二手转引', '已发布'];
const COMPLIANT = /信任级别\**[:：]\s*(已发布|主人投喂|二手转引)/;
const unresolved = [];

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
    const token = TOKENS.find((t) => block.includes(t));
    if (!token) { unresolved.push(`${file} [D${id}]`); continue; }   // 绝不推断
    const im = block.match(/信任级别\**[:：]\s*([^\n（）()|，,;；]*)/);
    const detail = im && im[1].trim() ? `（${im[1].trim().replace(/[🟢🟡🔴]/g, '').trim()}）` : '';
    const nl = block.indexOf('\n');
    const pos = match.index + (nl === -1 ? block.length : nl);
    const inserted = `\n信任级别：${token}${detail}`;
    text = text.slice(0, pos) + inserted + text.slice(pos);
    changed++;
    if (!write) console.log(`  · ${file} [D${id}] → ${inserted.trim()}`);
  }
  if (write && changed > 0) {
    copyFileSync(file, file + '.bak');
    writeFileSync(file, text, 'utf8');
    console.log(`✓ ${file}: ${changed} 条已规范化（备份 ${file}.bak）`);
  } else if (!write) {
    console.log(`· ${file}: 将规范化 ${changed} 条（dry-run 未落盘；加 --write 生效）`);
  } else {
    console.log(`· ${file}: 无需改动`);
  }
}

if (unresolved.length > 0) {
  console.error(`\n✗ ${unresolved.length} 条素材卡缺少信任级别依据，**拒绝推断**（旧版会默认填「已发布」，让 M-Form-6 误判通过）：`);
  for (const u of unresolved) console.error('  - ' + u);
  console.error('请由 T2/人工判定其信任级别（已发布 / 主人投喂 / 二手转引）后再重跑本脚本。');
  process.exit(1);
}
