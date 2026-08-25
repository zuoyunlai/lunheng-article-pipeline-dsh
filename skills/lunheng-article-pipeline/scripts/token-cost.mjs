// 论衡终检 token 成本汇总脚本（v2.5.2-dsh 补丁）：Phase 5 终检显示全流程总 token 成本
// 用法：
//   node token-cost.mjs --sessions <主会话ID>,<子代理ID1>,<子代理ID2>...   # 项目精确统计（主控传本项目派发的全部会话）
//   node token-cost.mjs --tree <主会话ID>                                  # 整会话委托树统计（含历史项目）
//   node token-cost.mjs [--dsh-home <path>] [--price-in N --price-cache N --price-out N]
// 数据源：DSH 会话投影缓存 $DSH_HOME/storages/session_projcache.json（每会话 tokenUsage.totals）
// 说明：主会话运行中时总量为「截至运行时刻」；成本为估算（默认 DeepSeek 价，--price-* 可覆盖）。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const opt = { dshHome: process.env.DSH_HOME || join(os.homedir(), '.dsh'), prices: { in: 0.28, cache: 0.028, out: 0.42 }, ids: null, tree: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dsh-home') opt.dshHome = args[++i];
  else if (a === '--price-in') opt.prices.in = Number(args[++i]);
  else if (a === '--price-cache') opt.prices.cache = Number(args[++i]);
  else if (a === '--price-out') opt.prices.out = Number(args[++i]);
  else if (a === '--sessions') opt.ids = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--tree') opt.tree = args[++i];
}

const cachePath = join(opt.dshHome, 'storages', 'session_projcache.json');
if (!existsSync(cachePath)) { console.error('找不到会话投影缓存: ' + cachePath); process.exit(1); }
const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
const sessions = cache.tables?.sessions || {};

// 树模式：扫描会话头 parentSession 建委托树
if (opt.tree && !opt.ids) {
  const { zstdDecompressSync } = await import('node:zlib');
  const { readdirSync, statSync } = await import('node:fs');
  const headers = {};
  const scan = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const sdir = join(dir, d.name);
      if (d.name.startsWith('--')) { scan(sdir); continue; }
      const z = join(sdir, 'session.jsonl.zstd');
      if (!existsSync(z)) continue;
      try {
        const h = JSON.parse(zstdDecompressSync(readFileSync(z)).toString('utf8').split('\n')[0]);
        headers[h.id] = { id: h.id, parentSession: h.parentSession || null, mtime: statSync(z).mtimeMs };
      } catch {}
    }
  };
  scan(join(opt.dshHome, 'sessions'));
  const ids = new Set([opt.tree]);
  const collect = (pid) => {
    for (const h of Object.values(headers)) if (h.parentSession === pid && !ids.has(h.id)) { ids.add(h.id); collect(h.id); }
  };
  collect(opt.tree);
  opt.ids = [...ids];
} else if (!opt.ids) {
  console.error('用法: node token-cost.mjs --sessions <id1,id2,...> 或 --tree <主会话ID>');
  process.exit(1);
}

const totals = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
const rows = [];
for (const id of opt.ids) {
  const rec = sessions[id] || sessions[id.replace(/^session-/, '')] || sessions[`session-${id}`];
  const usage = rec?.rows?.tokenUsage?.val?.totals;
  if (!usage) { rows.push({ session: id, label: '无用量记录', tokens: null }); continue; }
  for (const k of Object.keys(totals)) totals[k] += usage[k] || 0;
  rows.push({ session: id, label: (id === opt.ids[0] ? '主控' : '子代理'), tokens: { ...usage } });
}

const totalTokens = totals.uncachedInputTokens + totals.cacheReadTokens + totals.cacheWriteTokens + totals.outputTokens;
const costUsd =
  (totals.uncachedInputTokens / 1e6) * opt.prices.in +
  (totals.cacheReadTokens / 1e6) * opt.prices.cache +
  (totals.cacheWriteTokens / 1e6) * opt.prices.cache +
  (totals.outputTokens / 1e6) * opt.prices.out;

console.log(JSON.stringify({
  mode: opt.tree ? 'tree' : 'explicit',
  sessionCount: opt.ids.length,
  tokens: { uncachedInput: totals.uncachedInputTokens, cacheRead: totals.cacheReadTokens, cacheWrite: totals.cacheWriteTokens, output: totals.outputTokens, total: totalTokens },
  costEstimateUsd: Number(costUsd.toFixed(2)),
  pricesPerMillion: opt.prices,
  note: '成本为估算（默认 DeepSeek 价，--price-* 可覆盖）；cacheRead = 上下文缓存命中读取，单价低于 uncached；主会话为运行中会话，总量为截至运行时刻。',
  rows
}, null, 2));
