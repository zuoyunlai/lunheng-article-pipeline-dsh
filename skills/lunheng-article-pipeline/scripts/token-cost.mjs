// 论衡终检 token 成本汇总脚本（v2.5.2-dsh 补丁）：Phase 5 终检显示全流程总 token 成本
// 用法：
//   node token-cost.mjs --sessions <主会话ID>,<子代理ID1>,<子代理ID2>...   # 项目精确统计（主控传本项目派发的全部会话）
//   node token-cost.mjs --project run/<项目名>                             # 从项目日志自动提取会话 ID（v18.0.0 新增）
//   node token-cost.mjs --tree <主会话ID>                                  # 整会话委托树统计（含历史项目）
//   node token-cost.mjs [--dsh-home <path>] [--price-in N --price-cache N --price-out N]
//   node token-cost.mjs --top N                  # 追加 cacheRead/成本 Top N 会话排名（与 --sessions/--tree 连用，用于优化决策）
// 数据源：DSH 会话投影缓存 $DSH_HOME/storages/session_projcache.json（每会话 tokenUsage.totals）
// 说明：主会话运行中时总量为「截至运行时刻」；成本为估算（默认 DeepSeek 价，--price-* 可覆盖）。
// 退出码（v18.12.0，L-67 收口）：
//   0  = 统计成功且**至少命中一个会话的用量记录**
//   10 = **参数 / 路径 / 环境不可用**（未知参数、`--top` 非法、数值旗标收到非数字、
//        未给任何模式、会话投影缓存不存在、`--project` 无日志或未提取到会话 ID、
//        `--tree` 所需 Node 版本不足）——与全仓「10 = 参数或路径错误」一致
//   70 = 内部错误（EX_SOFTWARE，见 _lib/exit-guard.mjs）
//   ⚠️ 本脚本**不再使用 exit 1**（v18.12.0 起）：旧版把「未知参数 / 数值非法 / 缓存缺失 / 未给模式」
//      一律记为 1，而主控统一按 M 门语义读码时会把 1 读成「**P1 内容失败**」→ 误触发 T5 修订轮。
//      这正是 v18.0.5 引入 exit-guard 要消灭的那类撞码（本文件当时漏改）。
//   ⚠️ 这里刻意**不**用 4（4 已在 AGENTS.md 登记为 model-routing 的「需人工决定」，不与他脚本共用语义）。
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { installExitGuard } from './_lib/exit-guard.mjs';   // 退出码硬化（v18.0.5）：fs 类异常 → 10，内部错误 → 70
import { parseArgs as parseCliArgs, USAGE_CODE as CLI_USAGE_CODE } from './_lib/cli-args.mjs';  // 参数解析唯一实现（v18.2.9，审计 A7）
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
// 参数解析：v18.2.9（第三方审计 A7）迁移到 `_lib/cli-args.mjs` 唯一实现；
//   数值校验（尾随无值/非数字 → 明确报错而非静默 NaN）保留在调用处（v2.5.2-dsh.3 审计修复的行为不变）。
try {
  const parsed = parseCliArgs(args, {
    flags: [],
    values: {
      '--dsh-home': '~/.dsh',
      '--sessions': '<id1,id2,...>',
      '--project': 'run/项目名',
      '--tree': '<主会话ID>',
      '--top': '10',
      '--price-in': '0.28', '--price-cache': '0.028', '--price-out': '0.42',
    },
    maxPositionals: 0,
  });
  if (parsed.opts['--dsh-home']) opt.dshHome = parsed.opts['--dsh-home'];
  if (parsed.opts['--sessions']) opt.ids = parsed.opts['--sessions'].split(',').map((s) => s.trim()).filter(Boolean);
  if (parsed.opts['--project']) opt.project = parsed.opts['--project'];
  if (parsed.opts['--tree']) opt.tree = parsed.opts['--tree'];
  const num = (flag, val, { integer = false } = {}) => {
    const v = Number(val);
    if (!Number.isFinite(v) || (integer && (!Number.isInteger(v) || v <= 0))) {
      console.error(`${flag} 需为${integer ? '正整数' : '数字'}，收到: ${val}`);
      process.exit(10);   // v18.12.0（L-67）：参数值错 = 参数错 → 10（旧版 1 与「P1 内容失败」撞义）
    }
    return v;
  };
  if (parsed.opts['--price-in']) opt.prices.in = num('--price-in', parsed.opts['--price-in']);
  if (parsed.opts['--price-cache']) opt.prices.cache = num('--price-cache', parsed.opts['--price-cache']);
  if (parsed.opts['--price-out']) opt.prices.out = num('--price-out', parsed.opts['--price-out']);
  if (parsed.opts['--top']) opt.top = num('--top', parsed.opts['--top'], { integer: true });
} catch (e) {
  if (e && e.code === CLI_USAGE_CODE) { console.error(`${e.message}\n\n${USAGE}`); process.exit(10); }   // v18.12.0（L-67）
  throw e;
}

// v18.2.9（第三方审计 B5）：未显式给 --price-* 时，默认价是 DeepSeek 单价——非 DeepSeek 模型
//   的成本会系统性失真、且会被误当作「实价」写进交付说明。现**响亮标注**（不静默）：引用前须覆盖。
if (!/--price-(in|cache|out)\b/.test(args.join(' '))) {
  console.error('⚠️ 未指定 --price-*，成本按默认 DeepSeek 单价估算（0.28/0.028/0.42 美元/百万 token）——非 DeepSeek 模型将失真，交付说明引用前请用 --price-in/--price-cache/--price-out 覆盖');
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
  console.error('找不到会话投影缓存（已尝试目录式与单文件两种布局）: ' + projDir); process.exit(10);   // v18.12.0（L-67）：路径错 → 10
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
    process.exit(10);   // v18.12.0（L-67）：路径错 → 10
  }
  opt.ids = [...found];
  if (opt.ids.length === 0) {
    console.error(
      `--project 在 ${srcFiles.join(' / ')} 中未提取到会话 ID（UUID 形态）。\n` +
        `  —— 请让主控在派发时把子代理 session id 记入 agents-log.md，或改用 --sessions 手工传入。`,
    );
    process.exit(10);   // v18.12.0（L-67）：参数不足（未给出可用会话 id）→ 10
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
    process.exit(10);   // v18.12.0（L-67）：环境/参数不可用 → 10
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
  process.exit(10);   // v18.12.0（L-67）：未给任何模式 = 用法错 → 10
}

const totals = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
const rows = [];
let matchedSessions = 0;   // v18.2.6：命中的会话数（区分「真的 0 用量」与「id 根本查不到」）
for (const id of opt.ids) {
  const rec = sessions[id] || sessions[id.replace(/^session-/, '')] || sessions[`session-${id}`];
  const usage = rec?.rows?.tokenUsage?.val?.totals;
  if (!usage) { rows.push({ session: id, label: '无用量记录', tokens: null }); continue; }
  matchedSessions++;
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
  // v18.2.6：把「命中数」显式给出来——0 就是「查不到」，不是「用量为 0」
  matchedSessionCount: matchedSessions,
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

// === v18.2.6 审计修复（第三方审计 P1-5）：全部会话未命中用量记录 → 非 0 退出 ===
// 旧行为（实测）：`--sessions <假 UUID>` → `sessionCount:1 / tokens 全 0 / costEstimateUsd:0` 且 **exit 0**，
//   唯一线索是 `rows[0].label:"无用量记录"` —— 而交付说明要求贴**实测成本**，主控会把这个 0
//   当成「本项目真的没花 token」写进交付说明（「查不到」被写成「实测 0」）。这是本包最反感的
//   「静默把缺失当数值」。现规则：**一个会话都没命中 → exit 10（参数或路径错）** + 明确报错文案。
//   注意判据是 `matchedSessions === 0` 而非 `totalTokens === 0`：后者在「会话存在但确实没用 token」时
//   也会为 0，那是合法的真实数据，不得误判为错误（故这里必须用命中数，不能看总量）。
if (matchedSessions === 0) {
  console.error(
    `✗ 给出的会话 id 未在 ${cacheDesc} 找到任何用量记录，请核对 id 或 --sessions 参数。\n` +
      `  共查 ${opt.ids.length} 个 id，全部未命中（仅前 5 个：${opt.ids.slice(0, 5).join(', ')}${opt.ids.length > 5 ? ' …' : ''}）。\n` +
      `  · 常见原因：id 写错 / 该会话未落投影缓存 / 用的是 agent id 而非 session id；\n` +
      `  · 若确实没有用量数据，请勿把上面的 0 当作「实测成本」（退出码 10 = 参数或路径错误）；\n` +
      `  · 可改用 --project <run/项目名>（从项目日志自动提取会话 id）或 --tree <主会话ID>。`,
  );
  process.exit(10);
}
