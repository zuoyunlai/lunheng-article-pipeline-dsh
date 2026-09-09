// 论衡终检 token 成本汇总脚本（v2.5.2-dsh 补丁）：Phase 5 终检显示全流程总 token 成本
// 用法：
//   node token-cost.mjs --sessions <主会话ID>,<子代理ID1>,<子代理ID2>...   # 项目精确统计（主控传本项目派发的全部会话）
//   node token-cost.mjs --tree <主会话ID>                                  # 整会话委托树统计（含历史项目）
//   node token-cost.mjs [--dsh-home <path>] [--price-in N --price-cache N --price-out N]
//   node token-cost.mjs --top N                  # 显示 cacheRead Top N 会话（用于优化决策）
// 数据源：DSH 会话投影缓存 $DSH_HOME/storages/session_projcache.json（每会话 tokenUsage.totals）
// 说明：主会话运行中时总量为「截至运行时刻」；成本为估算（默认 DeepSeek 价，--price-* 可覆盖）。
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const opt = { dshHome: process.env.DSH_HOME || join(os.homedir(), '.dsh'), prices: { in: 0.28, cache: 0.028, out: 0.42 }, ids: null, tree: null };
// 参数解析：尾随无值/非数字 → 明确报错而非静默 NaN（v2.5.2-dsh.3 审计修复）
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => {
    const v = args[++i];
    if (v === undefined) { console.error(`参数 ${a} 缺少值`); process.exit(1); }
    return v;
  };
  if (a === '--dsh-home') opt.dshHome = next();
  else if (a === '--price-in') { const v = Number(next()); if (!Number.isFinite(v)) { console.error(`--price-in 需为数字，收到: ${args[i]}`); process.exit(1); } opt.prices.in = v; }
  else if (a === '--price-cache') { const v = Number(next()); if (!Number.isFinite(v)) { console.error(`--price-cache 需为数字，收到: ${args[i]}`); process.exit(1); } opt.prices.cache = v; }
  else if (a === '--price-out') { const v = Number(next()); if (!Number.isFinite(v)) { console.error(`--price-out 需为数字，收到: ${args[i]}`); process.exit(1); } opt.prices.out = v; }
  else if (a === '--sessions') opt.ids = next().split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--tree') opt.tree = next();
}

// 数据源兼容两种布局（v2.5.2-dsh.10+ 适配）：
//   旧版单文件  $DSH_HOME/storages/session_projcache.json  { tables.sessions: { id: { rows: {...} } } }
//   新版目录式  $DSH_HOME/storages/session_projcache/sessions/<id>.json（每会话一个投影缓存，含 record.rows）
const projDir = join(opt.dshHome, 'storages', 'session_projcache');
const legacyFile = join(opt.dshHome, 'storages', 'session_projcache.json');
const sessions = {};
let cacheDesc = '';
if (existsSync(legacyFile)) {
  const cache = JSON.parse(readFileSync(legacyFile, 'utf8'));
  Object.assign(sessions, cache.tables?.sessions || {});
  cacheDesc = legacyFile;
} else if (existsSync(join(projDir, 'sessions')) && statSync(join(projDir, 'sessions')).isDirectory()) {
  const sdir = join(projDir, 'sessions');
  cacheDesc = sdir;
  for (const f of readdirSync(sdir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(readFileSync(join(sdir, f), 'utf8'));
      const key = f.slice(0, -'.json'.length); // 保留原名（含/不含 session- 前缀均可被查找）
      sessions[key] = rec.record || rec;
    } catch {}
  }
} else {
  console.error('找不到会话投影缓存（已尝试单文件与目录式布局）: ' + projDir); process.exit(1);
}

// 树模式：扫描会话头 parentSession 建委托树
if (opt.tree && !opt.ids) {
  let zstdDecompressSync;
  try {
    ({ zstdDecompressSync } = await import('node:zlib'));
  } catch {}
  if (typeof zstdDecompressSync !== 'function') {
    console.error('tree 模式需要 Node.js >= 22.15（node:zlib.zstdDecompressSync 缺失）——当前环境不支持，请改用 --sessions 显式列表，或升级 Node');
    process.exit(1);
  }
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
  // 前缀归一化：parentSession 可能带/不带 session- 前缀，统一去前缀比对（v2.5.2-dsh.3 审计修复）
  const strip = (id) => (id || '').replace(/^session-/, '');
  const root = strip(opt.tree);
  const ids = new Set([root]);
  const collect = (pid) => {
    for (const h of Object.values(headers)) {
      if (strip(h.parentSession) === pid && !ids.has(strip(h.id))) { ids.add(strip(h.id)); collect(strip(h.id)); }
    }
  };
  collect(root);
  opt.ids = [...ids];
const topMode = false;
  // 健全性断言：树模式至少应包含主会话自身（v2.5.2-dsh.3 审计修复：防静默缩成 1 个）
  if (opt.ids.length === 1) {
    console.error(`tree 模式警告：主会话 ${opt.tree} 未找到任何子代理会话（parentSession 链为空）——统计仅含主会话自身，结果可能不完整`);
  }
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
// cacheWriteTokens = 写入上下文缓存（cache miss 语义）→ 按未命中价（in）计；cacheReadTokens = 命中读取 → 按低价计（v2.5.2-dsh.3 审计修正）

const costUsd =
  (totals.uncachedInputTokens / 1e6) * opt.prices.in +
  (totals.cacheReadTokens / 1e6) * opt.prices.cache +
  (totals.cacheWriteTokens / 1e6) * opt.prices.in +
  (totals.outputTokens / 1e6) * opt.prices.out;

console.log(JSON.stringify({
  mode: opt.tree ? 'tree' : 'explicit',
  sessionCount: opt.ids.length,
  tokens: { uncachedInput: totals.uncachedInputTokens, cacheRead: totals.cacheReadTokens, cacheWrite: totals.cacheWriteTokens, output: totals.outputTokens, total: totalTokens },
  costEstimateUsd: Number(costUsd.toFixed(2)),
  pricesPerMillion: opt.prices,
  note: '成本为估算（默认 DeepSeek 价，--price-* 可覆盖）；uncachedInput 与 cacheWrite 按未命中价计，cacheRead 按命中价计（缓存写=miss 语义）；主会话为运行中会话，总量为截至运行时刻。',
  rows
}, null, 2));
