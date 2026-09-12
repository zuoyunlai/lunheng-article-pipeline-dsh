// 论衡终检 token 成本汇总脚本（v2.5.2-dsh 补丁）：Phase 5 终检显示全流程总 token 成本
// 用法：
//   node token-cost.mjs --sessions <主会话ID>,<子代理ID1>,<子代理ID2>...   # 项目精确统计（主控传本项目派发的全部会话）
//   node token-cost.mjs --project run/<项目名>                             # 从项目日志自动提取会话 ID（v18.0.0 新增）
//   node token-cost.mjs --tree <主会话ID>                                  # 整会话委托树统计（含历史项目）
//   node token-cost.mjs [--dsh-home <path>] [--price-in N --price-cache N --price-out N]
//   node token-cost.mjs --top N                  # 追加 cacheRead/成本 Top N 会话排名（与 --sessions/--tree 连用，用于优化决策）
// 数据源：DSH 会话投影缓存 $DSH_HOME/storages/session_projcache.json（每会话 tokenUsage.totals）
// 说明：主会话运行中时总量为「截至运行时刻」；成本为估算（默认 DeepSeek 价，--price-* 可覆盖）。
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { installExitGuard } from './_lib/exit-guard.mjs';   // 退出码硬化（v18.0.5）：fs 类异常 → 10，内部错误 → 70
installExitGuard();

const args = process.argv.slice(2);
const opt = { dshHome: process.env.DSH_HOME || join(os.homedir(), '.dsh'), prices: { in: 0.28, cache: 0.028, out: 0.42 }, ids: null, tree: null, top: 0, project: null };
// 用法/帮助：v2.5.2-dsh.17 补（此前 `--help` 会被「未知参数」拦下，只报错不给用法）
const USAGE = `用法: node token-cost.mjs --sessions <id1,id2,...> 或 --project <run/项目名> 或 --tree <主会话ID> [--top N]
  --sessions <ids>   项目精确统计（主控传本项目派发的全部会话 id，逗号分隔）
  --project <dir>    从项目日志（agents-log.md / status.md）自动提取其中的会话 ID 再统计（v18.0.0 新增；
                     适合主控在会话内拿不到 session id 的场景——交接报告里的 session-<uuid> 会被自动提取）
  --tree <id>        整会话委托树统计（含历史项目；需 Node ≥ 22.15）
  --top N            追加 cacheRead/成本 Top N 排名（优化决策用）
  --dsh-home <path>  指定 DSH_HOME（默认 $DSH_HOME 或 ~/.dsh）
  --price-in/--price-cache/--price-out <N>  覆盖默认单价（美元/百万 token）
  -h, --help         显示本帮助`;
if (args.includes('-h') || args.includes('--help')) { console.log(USAGE); process.exit(0); }
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
  else if (a === '--project') opt.project = next();
  else if (a === '--tree') opt.tree = next();
  // --top N：Top N 成本排名（v2.5.2-dsh.15 实现——旧版头注释与 CHANGELOG 已宣传该参数，代码里却是死变量 `topMode=false`）
  else if (a === '--top') {
    const v = Number(next());
    if (!Number.isInteger(v) || v <= 0) { console.error(`--top 需为正整数，收到: ${args[i]}`); process.exit(1); }
    opt.top = v;
  }
  else { console.error(`未知参数: ${a}\n\n${USAGE}`); process.exit(1); }
}

// 数据源兼容两种布局（v2.5.2-dsh.10+ 适配）：
//   旧版单文件  $DSH_HOME/storages/session_projcache.json  { tables.sessions: { id: { rows: {...} } } }
//   新版目录式  $DSH_HOME/storages/session_projcache/sessions/<id>.json（每会话一个投影缓存，含 record.rows）
// v18.0.5（第三方审计 P2-11）：**判序改为「目录优先」并与 `token-budget.mjs` 统一**——旧版这里
//   单文件优先、token-budget 目录优先，同一台机器上两份报表取的数据源不同（实测夹具：一读 legacy
//   一读目录，数字互不可比且都 exit 0 无告警）。另加「两种布局并存」显式告警。
const projDir = join(opt.dshHome, 'storages', 'session_projcache');
const legacyFile = join(opt.dshHome, 'storages', 'session_projcache.json');
const sessions = {};
let cacheDesc = '';
const hasDirLayout = existsSync(join(projDir, 'sessions')) && statSync(join(projDir, 'sessions')).isDirectory();
const hasLegacy = existsSync(legacyFile);
if (hasDirLayout && hasLegacy) {
  console.error(`⚠️ 检测到两种会话投影布局并存：${join(projDir, 'sessions')}（优先）与 ${legacyFile}（忽略）——升级残留会让不同脚本读到不同快照，本脚本一律以**目录式**为准`);
}
if (hasDirLayout) {
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
} else if (hasLegacy) {
  const cache = JSON.parse(readFileSync(legacyFile, 'utf8'));
  Object.assign(sessions, cache.tables?.sessions || {});
  cacheDesc = legacyFile;
} else {
  console.error('找不到会话投影缓存（已尝试目录式与单文件两种布局）: ' + projDir); process.exit(1);
}

// === --project 模式（v18.0.0 新增，P2-1）===
// 背景：交付说明的「成本指标」字段此前**结构性填不上** —— `--sessions` 需要精确 session id，
//   而主控在会话内**拿不到**（subagent 返回的是 agent id，不是 session id）。
// 现规则：从项目日志（agents-log.md / status.md / 01-任务简报.md / audits/审计视图-v0.md）
//   用 UUID 正则提取所有会话 ID，与 `--sessions` 传入者合并去重。
//   子代理交接报告里常见的 `session-<uuid>` 形态会被自动提取。
if (opt.project) {
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const cand = ['agents-log.md', 'status.md', '01-任务简报.md', join('audits', '审计视图-v0.md')].map((f) =>
    join(opt.project, f),
  );
  const found = new Set(opt.ids || []);
  const srcFiles = [];
  for (const p of cand) {
    if (!existsSync(p)) continue;
    srcFiles.push(p);
    for (const m of readFileSync(p, 'utf8').matchAll(UUID_RE)) found.add(m[0]);
  }
  if (srcFiles.length === 0) {
    console.error(`--project 未找到任何项目日志（已试: ${cand.join(' / ')}）`);
    process.exit(1);
  }
  opt.ids = [...found];
  if (opt.ids.length === 0) {
    console.error(
      `--project 在 ${srcFiles.join(' / ')} 中未提取到会话 ID（UUID 形态）。\n` +
        `  —— 请让主控在派发时把子代理 session id 记入 agents-log.md，或改用 --sessions 手工传入。`,
    );
    process.exit(1);
  }
  console.error(`· --project ${opt.project}：从 ${srcFiles.length} 个日志文件提取到 ${opt.ids.length} 个会话 ID`);
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
  // 健全性断言：树模式至少应包含主会话自身（v2.5.2-dsh.3 审计修复：防静默缩成 1 个）
  if (opt.ids.length === 1) {
    console.error(`tree 模式警告：主会话 ${opt.tree} 未找到任何子代理会话（parentSession 链为空）——统计仅含主会话自身，结果可能不完整`);
  }
} else if (!opt.ids) {
  console.error(USAGE);
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

// 单会话成本（与总量同口径：uncachedInput + cacheWrite 按未命中价，cacheRead 按命中价，output 按输出价）
const sessionCost = (t) =>
  (t.uncachedInputTokens / 1e6) * opt.prices.in +
  (t.cacheReadTokens / 1e6) * opt.prices.cache +
  (t.cacheWriteTokens / 1e6) * opt.prices.in +
  (t.outputTokens / 1e6) * opt.prices.out;

const out = {
  mode: opt.tree ? 'tree' : 'explicit',
  sessionCount: opt.ids.length,
  tokens: { uncachedInput: totals.uncachedInputTokens, cacheRead: totals.cacheReadTokens, cacheWrite: totals.cacheWriteTokens, output: totals.outputTokens, total: totalTokens },
  costEstimateUsd: Number(costUsd.toFixed(2)),
  pricesPerMillion: opt.prices,
  note: '成本为估算（默认 DeepSeek 价，--price-* 可覆盖）；uncachedInput 与 cacheWrite 按未命中价计，cacheRead 按命中价计（缓存写=miss 语义）；主会话为运行中会话，总量为截至运行时刻。',
  rows
};

// --top N（v2.5.2-dsh.15 实现）：按 cacheRead 降序的 Top N 会话 —— 回答「哪一步最贵 / 优化有没有用」。
// 这是后续一切 token 优化的量尺：没有排名，优化只能凭感觉（旧版该参数只有注释、无实现）。
if (opt.top > 0) {
  const scored = rows
    .filter((r) => r.tokens)
    .map((r) => ({
      session: r.session,
      label: r.label,
      cacheRead: r.tokens.cacheReadTokens || 0,
      uncachedInput: r.tokens.uncachedInputTokens || 0,
      output: r.tokens.outputTokens || 0,
      total: (r.tokens.uncachedInputTokens || 0) + (r.tokens.cacheReadTokens || 0) + (r.tokens.cacheWriteTokens || 0) + (r.tokens.outputTokens || 0),
      costEstimateUsd: Number(sessionCost(r.tokens).toFixed(4)),
      cacheReadShareOfTotalPct: totals.cacheReadTokens > 0
        ? Number((((r.tokens.cacheReadTokens || 0) / totals.cacheReadTokens) * 100).toFixed(1))
        : 0,
    }))
    .sort((a, b) => b.cacheRead - a.cacheRead || b.costEstimateUsd - a.costEstimateUsd);
  out.topByCacheRead = scored.slice(0, opt.top);
  out.topNote = `按 cacheRead 降序 Top ${Math.min(opt.top, scored.length)}（共 ${scored.length} 个有用量记录的会话；share 为占总量 cacheRead 的百分比）。优化动作应优先针对排名靠前者。`;
  if (scored.length === 0) out.topNote = '没有任何会话带 tokenUsage 记录（先确认会话 id 是否正确）。';
}

console.log(JSON.stringify(out, null, 2));
