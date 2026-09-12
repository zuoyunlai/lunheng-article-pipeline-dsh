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
//   ⚠️ 退出码命名空间（v18.0.2 澄清）：本脚本**不是流水线闸门**，`1` 在本脚本里表示「有未决条目/用法错」，
//      与 M 门约定（`1`=P1 内容失败 / `10`=参数路径错）**不共用语义**；但「参数/路径错」仍统一用 `10` 以降低误读。
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dataCardIds } from './_lib/refs.mjs';              // 引用编号口径真源
import { TRUST_COMPLIANT_RE, pickTrustToken } from './_lib/trust.mjs';   // 信任级别口径真源
import { splitCard } from './_lib/cards.mjs';               // 卡片切块口径真源

const rawArgs = process.argv.slice(2);
const write = rawArgs.includes('--write');
const files = rawArgs.filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('用法: node normalize-trust-level.mjs <数据卡.md> ... [--write]（默认 dry-run，不落盘）');
  process.exit(10); // v18.0.2：参数错统一 10（下方「有未决条目」仍为 1，属本脚本自有语义）
}
// 信任级别口径已上收到 _lib/trust.mjs（TOKENS / COMPLIANT → TRUST_COMPLIANT_RE / pickTrustToken）
const unresolved = [];

for (const file of files) {
  if (!existsSync(file)) { console.error(`跳过（不存在）: ${file}`); continue; }
  let text = readFileSync(file, 'utf8');
  const ids = dataCardIds(text);
  let changed = 0;
  for (const id of ids) {
    const card = splitCard(text, id);
    if (!card) continue;
    const block = card.block;
    if (TRUST_COMPLIANT_RE.test(block)) continue;
    const token = pickTrustToken(block);
    if (!token) { unresolved.push(`${file} [D${id}]`); continue; }   // 绝不推断
    const im = block.match(/信任级别\**[:：]\s*([^\n（）()|，,;；]*)/);
    const detail = im && im[1].trim() ? `（${im[1].trim().replace(/[🟢🟡🔴]/g, '').trim()}）` : '';
    const nl = block.indexOf('\n');
    const pos = card.index + (nl === -1 ? block.length : nl);
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
