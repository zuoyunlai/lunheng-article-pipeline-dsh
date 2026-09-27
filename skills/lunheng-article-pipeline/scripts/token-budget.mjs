#!/usr/bin/env node
// 论衡 token 预算实测脚本（v2.5.2-dsh.17 新增）——把「省 token」机制换算成**可复现数字**
//
// 为什么需要它：论衡文档里散落着「T5 占 76%」「省 ~12K token」「50K 上下文大头」这类量化断言。
// 规则 ⑰ 只保证它们**有**算式/出处，不保证它们**还准**——实测发现「76%」是**单项目**（test-paper-02）
// 的实测值被写成了通用值，本机 47 会话语料聚合实测是 63.6%。本脚本让这类数字**随时可重跑**。
//
// 用法：
//   node token-budget.mjs --project <run/项目>            # 静态：读目标「整读 vs 按需读」对账
//   node token-budget.mjs --roles                        # 真实：按角色聚合会话投影的 token
//   node token-budget.mjs --project <项目> --roles        # 两者都跑
//   node token-budget.mjs --roles --dsh-home <path>       # 指定 DSH_HOME
//   node token-budget.mjs --project <项目> --json         # 机器可读
// 退出码（v18.12.0，L-67 收口）：
//   0  = 成功
//   10 = **参数 / 路径错**（未知参数、缺值、多余位置参数、未给任何模式、`--project` 路径不存在）
//        ——与全仓「10 = 参数或路径错误」一致；旧版把用法错记为 1，会被主控按 M 门语义读成
//        「**P1 内容失败**」并误触发 T5 修订轮（这正是 exit-guard 要消灭的撞码，本文件当时漏改）。
//   70 = 内部错误（EX_SOFTWARE，见 _lib/exit-guard.mjs）
//
// ⚠️ token 口径（**估算区间，非计费值**）：
//   汉字 ≈ 0.6~1.0 token/字（BPE 对中文的常见区间）；ASCII ≈ 1 token / 4 字符。
//   精确值请用 `token-cost.mjs` 读会话投影里的**真实 tokenUsage**（本脚本 `--roles` 即读它）。
//
// ⚠️ v18.22.0 MEA-1（口径修复）：
//   旧版只按 ROLE 正则匹配 `label` / `title` —— 不过滤主会话，导致 3 条主会话
//   （cacheRead 359.9M = 分母 55.2%）被错算进 T7 桶，读出"T7 占 69.1%"假象。
//   实测复算：真 T7 ≈76.0M（11.7%）；真 T5 ≈99.5M（15.3%）；二者同量级。
//   现加四条：① `--include-main` 开关（默认 false：主会话不计入角色桶）；
//            ② label 优先 / title fallback，并打印 fallback 命中数；
//            ③ 未归类会话数 + 未归类 cacheRead 占比（防分母悄悄缩水）；
//            ④ 输出头加"口径三要素"（分母定义 / 日期 / 样本数），跨日期对比前必对口径。
//   与 MEA-2 配套：成本断言必须在文档里带 口径 / 日期 / 样本数（见 content-rules.mjs ⑰ 扩面）。
//
//   回滚：删除 `includeMain` / fallbackHits / unmatched / 三要素头 共四处。
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { countHan } from './_lib/han.mjs';   // 汉字口径唯一真源（v18.0.3 起）
import { installExitGuard } from './_lib/exit-guard.mjs';   // 退出码硬化（v18.0.5）：fs 类异常 → 10，内部错误 → 70
import { parseArgs as parseCliArgs, USAGE_CODE as CLI_USAGE_CODE } from './_lib/cli-args.mjs';  // 参数解析唯一实现（v18.2.9，审计 A7）
installExitGuard();

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(`用法: node token-budget.mjs [--project <run/项目>] [--roles] [--json] [--include-main] [--dsh-home <path>]

--project <路径>   静态测量该项目的「读目标」：整读规模 vs 按需读规模（大纲 vs §11 / 三卡 vs 索引段 / 证据包 vs 审计视图 / 定稿+证据包 vs M 门 JSON）
--roles            读 $DSH_HOME/storages/session_projcache/sessions/*.json，按论衡角色聚合真实 token（cacheRead / output / 步数 / 占比）。**v18.22.0 起默认不计入主会话**（--include-main 显式放开，兼容旧读数 + 便于调试主会话污染）
--include-main     **v18.22.0**：把主会话一起纳入角色桶。默认 false（主会话 label 通常空，启发式容易误归类——先打未归类桶再人工判定）
--by-model         **v18.28.0 QLT-5**：附带「按模型 / 按角色×模型」聚合（cacheRead / 步数 / **M/步**）——分档模型的「质量—成本」实测面。**只给结构性观测**：同角色跨模型的 M/步 差异主要来自「每步读进来多少」，不是「模型更聪明」；受控 A/B 需真跑（见 references/_shared/模型路由.md §四）
--dsh-home <path>  指定 DSH_HOME（默认 $DSH_HOME 或 ~/.dsh）
--json             输出 JSON（机器可读）
-h, --help         本帮助
退出码：0 成功｜10 参数或路径错（用法错 / 未知参数 / 缺值 / 项目路径不存在；v18.12.0 起用法错由 1 改 10）｜70 内部错误
⚠️ token 为**估算区间**（汉字 0.6~1.0 token/字，ASCII 1/4 字符）；真实值见 --roles 读的 tokenUsage。`);
  process.exit(0);
}
// v18.2.9（第三方审计 A7）：参数解析迁移到 `_lib/cli-args.mjs` 唯一实现
// v18.12.0（L-67）：用法错由 exit 1 改 exit 10——1 是 M 门的「P1 内容失败」，用法错被读成内容失败
//   会让主控误触发 T5 修订轮（同族事故见 v18.0.5 exit-guard 的引入说明）。
let wantJson, projArg, wantRoles, includeMain, wantByModel, dshHome;
try {
  const parsed = parseCliArgs(args, {
    flags: ['--json', '--roles', '--include-main', '--by-model'],
    values: { '--project': 'run/项目', '--dsh-home': '~/.dsh' },
    maxPositionals: 0,
  });
  wantJson = parsed.flags.has('--json');
  projArg = parsed.opts['--project'];
  wantRoles = parsed.flags.has('--roles');
  includeMain = parsed.flags.has('--include-main');   // v18.22.0 MEA-1：默认 false
  wantByModel = parsed.flags.has('--by-model');   // v18.28.0 QLT-5：附带「按模型 / 角色×模型」聚合（质量—成本对照的实测面）
  dshHome = parsed.opts['--dsh-home'] || process.env.DSH_HOME || join(homedir(), '.dsh');
} catch (e) {
  if (e && e.code === CLI_USAGE_CODE) {
    console.error(`${e.message}\n用法: node token-budget.mjs [--project <run/项目>] [--roles] [--json] [--dsh-home <path>]`);
    process.exit(10);
  }
  throw e;
}
if (!projArg && !wantRoles && !wantByModel) {
  console.error('需至少给一个模式：--project <run/项目> 或 --roles\n用法: node token-budget.mjs [--project <run/项目>] [--roles] [--json]');
  process.exit(10);
}
if (projArg && !existsSync(projArg)) {
  console.error(`项目路径不存在: ${projArg}`);
  process.exit(10);   // v18.2.9：旧版 exit 2 与 M 门「2 = P0」撞义，改 10（参数/路径错误）
}

// ---- token 估算（口径见头注释）----
// v18.0.3：汉字口径改走 _lib/han.mjs 真源（旧版在此重写 /[\u4e00-\u9fff]/g）
const hanCount = countHan;
const asciiCount = (s) => (s.match(/[\x00-\x7F]/g) || []).length;
const estTokens = (s) => {
  const han = hanCount(s), ascii = asciiCount(s);
  return [Math.round(han * 0.6 + ascii / 4), Math.round(han * 1.0 + ascii / 4)];
};
const readIf = (p) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null);
const sizeIf = (p) => (existsSync(p) && statSync(p).isFile() ? statSync(p).size : 0);

// §11 精简段 / 索引段的提取（与 M-Exist-10 / M-Form-10 同口径）
const sectionOf = (text, re) => {
  if (!text) return null;
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^#{2,4}\s/.test(l) && re.test(l));
  if (i === -1) return null;
  const lvl = (/^(#{1,6})/.exec(lines[i]) || [])[1].length;
  const stop = new RegExp(`^#{1,${lvl}}\\s`);
  let j = lines.length;
  for (let k = i + 1; k < lines.length; k++) if (stop.test(lines[k])) { j = k; break; }
  return lines.slice(i, j).join('\n');
};
const indexBlockOf = (text) => sectionOf(text, /📇|索引段/);

const report = { project: projArg || null, date: new Date().toISOString().slice(0, 10), static: null, roles: null };

// ================= 静态：读目标对账 =================
if (projArg) {
  const fin = join(projArg, 'final');
  const ev = join(fin, '证据包');
  const rows = [];
  const add = (who, what, fullText, leanText, note) => {
    const full = fullText || '';
    const lean = leanText || '';
    const ft = estTokens(full), lt = estTokens(lean);
    const leanMissing = !lean.trim();
    rows.push({
      who, what, note: note || '',
      fullBytes: full.length, fullHan: hanCount(full), fullTokens: ft,
      leanBytes: lean.length, leanHan: hanCount(lean), leanTokens: lt,
      // 按需读目标缺失时**不给省比**（否则会显示 100% 的假节省）
      savePct: (!leanMissing && ft[0] > 0) ? Math.round((1 - lt[0] / ft[0]) * 100) : null,
      leanSource: leanMissing ? 'missing' : (note && note.includes('est') ? 'est' : 'measured'),
    });
  };
  // ① T5：大纲全文 vs §11
  const outline = readIf(join(projArg, 'analysis', '分析大纲.md')) || readIf(join(ev, '分析大纲.md')) || '';
  if (outline) {
    const s11 = sectionOf(outline, /写手版|精简段/);
    add('T5 写作', '分析大纲：全文 → §11 精简段', outline, s11 === null ? ('字'.repeat(60 * 40)) : s11,   // v18.2.9（审计轻微）：估缺失 §11 用中文填充（旧 'x'.repeat 用 ASCII 密度 1/4，低估中文 0.6-1.0/字的真实 token）
      s11 === null ? '大纲未含 §11（未启用）——按模板规格 ≈60 行×40 字 est' : '');
  }
  // ② T4/T5：三卡全文 vs 索引段
  let cardsFull = '', cardsLean = '';
  for (const [name, dir] of [['文献卡.md', 'literature'], ['数据卡.md', 'data'], ['案例卡.md', 'cases']]) {
    const t = readIf(join(ev, name)) || readIf(join(projArg, dir, name));
    if (!t) continue;
    cardsFull += t;
    const idx = indexBlockOf(t);
    if (idx) cardsLean += idx + '\n';
  }
  if (cardsFull) {
    add('T4/T5 读素材', '三张卡：全文 → 索引段', cardsFull, cardsLean,
      cardsLean ? '' : '三卡均无索引段（未启用）→ 无节省');
  }
  // ③ T6/T7/T9：证据包全文 vs 审计视图
  let evFull = '';
  if (existsSync(ev)) for (const f of readdirSync(ev)) {
    if (!f.endsWith('.md')) continue;
    const t = readIf(join(ev, f));
    if (t) evFull += t;
  }
  const view = readIf(join(projArg, 'audits', '审计视图-v0.md'));
  if (evFull) add('T6/T7/T9 审稿', '证据包：全文 → 审计视图', evFull, view || '', view ? '' : '无审计视图（未生成）→ 无节省');
  // ④ T8：定稿 + 证据包 vs M 门 JSON 报告
  const draft = readIf(join(fin, '定稿.md')) || '';
  const gateJson = readIf(join(fin, 'M-Gate-Report.json')) || '';
  if (draft || evFull) {
    add('T8 终检', '定稿 + 证据包 → M 门 JSON 报告', draft + evFull, gateJson,
      gateJson ? '' : '无 M-Gate-Report.json（未跑）→ 无节省');
  }
  report.static = { project: projArg, rows };
}

// ================= 真实：按角色聚合会话投影 =================
const ROLE = [
  ['T1 文献检索', /文献检索|T1/], ['T2 数据检索', /数据检索|T2/], ['T3 案例检索', /案例检索|案例补检|T3/],
  ['T4 分析', /分析员|T4/], ['T5 写作', /写手|写作|T5/], ['T6 批判', /批判|T6/],
  ['T7 审计', /审计|T7/], ['T8 终检', /终检|T8/], ['T9 审稿', /审稿|同行评审|T9/],
  ['G14 检测', /G14|AI ?痕迹/],
];
if (wantRoles) {
  const sdir = join(dshHome, 'storages', 'session_projcache', 'sessions');
  const legacy = join(dshHome, 'storages', 'session_projcache.json');
  const sessions = [];
  // v18.0.5（第三方审计 P2-11）：与 token-cost.mjs 统一为「目录式优先」并显式告警两布局并存——
  //   旧版此处目录优先、token-cost 单文件优先，同机两份报表取不同快照且都静默 exit 0。
  if (existsSync(sdir) && existsSync(legacy)) {
    console.error(`⚠️ 检测到两种会话投影布局并存：${sdir}（优先）与 ${legacy}（忽略）——本脚本一律以目录式为准（与 token-cost.mjs 同判序）`);
  }
  if (existsSync(sdir)) {
    for (const f of readdirSync(sdir).filter((x) => x.endsWith('.json'))) {
      try {
        const c = JSON.parse(readFileSync(join(sdir, f), 'utf8')).record || {};
        const s = c.rows || {};
        const t = s.tokenUsage?.val?.totals;
        if (!t) continue;
        sessions.push({
          id: f.replace('.json', '').slice(0, 8),
          label: String(s.subagent?.val?.identity?.label || ''),
          prompt: String(s.title?.val || '').slice(0, 80),
          steps: s.sessionStats?.val?.steps ?? null,
          cacheRead: t.cacheReadTokens || 0, uncached: t.uncachedInputTokens || 0, output: t.outputTokens || 0,
          // v18.28.0 QLT-5：把该会话实际用的模型带出来（投影缓存的 modelSelection.lastUsed）——
          //   「分档该不该配」此前只有成本定位的信念、无实测；带上模型后才可能做质量—成本对照。
          model: String(s.modelSelection?.val?.lastUsed?.model || ''),
          provider: String(s.modelSelection?.val?.lastUsed?.provider || ''),
        });
      } catch { /* 跳过坏文件 */ }
    }
  } else if (existsSync(legacy)) {
    const cache = JSON.parse(readFileSync(legacy, 'utf8'));
    for (const [id, c] of Object.entries(cache.tables?.sessions || {})) {
      const t = (c.rows || c).tokenUsage?.val?.totals;
      if (t) sessions.push({ id: id.slice(0, 8), label: '', prompt: '', steps: null, cacheRead: t.cacheReadTokens || 0, uncached: t.uncachedInputTokens || 0, output: t.outputTokens || 0, model: '', provider: '' });
    }
  }
  // v18.22.0 MEA-1：role 标注时记录匹配路径（'label' / 'title' / null），便于后续统计 fallback 命中数。
  const classified = sessions.map((s) => {
    const byLabel = ROLE.find(([, re]) => re.test(s.label));
    const byTitle = byLabel ? null : ROLE.find(([, re]) => re.test(s.prompt));
    const hit = byLabel || byTitle || [null];
    return { ...s, role: hit[0], roleBy: byLabel ? 'label' : (byTitle ? 'title' : null) };
  });
  // v18.22.0 MEA-1：子代理过滤（默认）/ 主会话放开（--include-main）
  //   「子代理」判定：subagent.identity.label 非空。空 label 的会话**可能是主会话也可能是没 label 的子代理**——
  //   默认保守，按主会话处理（不计入角色桶，进「未归类」）。
  const isSubagent = (s) => typeof s.label === 'string' && s.label.length > 0;
  const scoped = includeMain ? classified : classified.filter(isSubagent);
  const sub = scoped.filter((s) => s.role);
  const fallbackHits = sub.filter((s) => s.roleBy === 'title').length;
  // v18.22.0 MEA-1：未归类桶（防分母悄悄缩水）
  const unmatched = scoped.filter((s) => !s.role);
  const total = sub.reduce((a, s) => a + s.cacheRead, 0);
  const unmatchedTotal = unmatched.reduce((a, s) => a + s.cacheRead, 0);
  const byRole = new Map();
  for (const s of sub) {
    if (!byRole.has(s.role)) byRole.set(s.role, { n: 0, cacheRead: 0, uncached: 0, output: 0, steps: 0 });
    const a = byRole.get(s.role);
    a.n++; a.cacheRead += s.cacheRead; a.uncached += s.uncached; a.output += s.output; a.steps += s.steps || 0;
  }
  // v18.22.0 MEA-1：未归类聚合（同名结构 byRole，便于统一输出）
  const unmatchedBucket = unmatched.length > 0 ? [{
    role: '未归类',
    n: unmatched.length,
    cacheRead: unmatchedTotal,
    uncached: 0,
    output: 0,
    steps: unmatched.reduce((a, s) => a + (s.steps || 0), 0),
    sharePct: total ? Number(((unmatchedTotal / total) * 100).toFixed(1)) : 0,
  }] : [];
// v18.28.0 QLT-5（--by-model）：按模型 / 角色×模型聚合——分档「质量—成本」的**实测面**。
//   **口径如实声明**：这是**观测性**数据（会话来自不同项目/篇幅/轮次），**不是受控 A/B**；
//   同角色跨模型的 M/步 差异主要反映「每步读进来多少」而非「模型更聪明」。受控 A/B 见 模型路由.md §四。
if (wantByModel) {
  const aggBy = (keyFn) => {
    const m = new Map();
    for (const s of classified) {
      if (!s.model) continue;
      const k = keyFn(s);
      if (!m.has(k)) m.set(k, { n: 0, cacheRead: 0, steps: 0, output: 0 });
      const a = m.get(k); a.n++; a.cacheRead += s.cacheRead; a.steps += (s.steps || 0); a.output += s.output;
    }
    return [...m.entries()].sort((a, b) => b[1].cacheRead - a[1].cacheRead);
  };
  const MM = (n) => (n / 1e6).toFixed(1) + "M";
  const byModelRows = aggBy((s) => s.model);
  const byRoleModelRows = aggBy((s) => s.role + "|" + s.model).filter(([k]) => !k.startsWith("未归类"));
  console.log("\n## 四、按模型（--by-model；观测性，非受控 A/B）");
  console.log("  模型".padEnd(34) + "会话" + "cacheRead".padStart(11) + "步数".padStart(7) + "M/步".padStart(8));
  for (const [k, a] of byModelRows) console.log("  " + k.padEnd(32) + String(a.n).padStart(4) + MM(a.cacheRead).padStart(11) + String(a.steps).padStart(7) + (a.steps ? (a.cacheRead / a.steps / 1e6).toFixed(2) : "-").padStart(8));
  console.log("\n## 五、按角色 × 模型（同一角色跨模型才有可比性）");
  console.log("  角色".padEnd(8) + "模型".padEnd(32) + "会话" + "cacheRead".padStart(11) + "步数".padStart(7) + "M/步".padStart(8));
  for (const [k, a] of byRoleModelRows) {
    const [role, mdl] = k.split("|");
    console.log("  " + role.padEnd(6) + mdl.padEnd(32) + String(a.n).padStart(4) + MM(a.cacheRead).padStart(11) + String(a.steps).padStart(7) + (a.steps ? (a.cacheRead / a.steps / 1e6).toFixed(2) : "-").padStart(8));
  }
  report.byModel = byModelRows.map(([k, a]) => ({ model: k, ...a, perStep: a.steps ? +(a.cacheRead / a.steps).toFixed(0) : null }));
  report.byRoleModel = byRoleModelRows.map(([k, a]) => ({ role: k.split("|")[0], model: k.split("|")[1], ...a, perStep: a.steps ? +(a.cacheRead / a.steps).toFixed(0) : null }));
}

  report.roles = {
    dshHome,
    sessionsTotal: sessions.length,
    sessionsInScope: scoped.length,       // v18.22.0 MEA-1：纳入分析的范围
    sessionsClassified: sub.length,
    sessionsUnmatched: unmatched.length,  // v18.22.0 MEA-1：未归类数
    fallbackHits,                        // v18.22.0 MEA-1：title fallback 命中数
    includeMain,                         // v18.22.0 MEA-1：当前口径开关
    subagentCacheRead: total,
    byRole: [...byRole.entries()]
      .map(([role, a]) => ({ role, ...a, sharePct: total ? Number(((a.cacheRead / total) * 100).toFixed(1)) : 0 }))
      .sort((x, y) => y.cacheRead - x.cacheRead),
    unmatched: unmatchedBucket,           // v18.22.0 MEA-1：未归类桶
  };
}

// ================= 输出 =================
const M = (n) => (n / 1e6).toFixed(2) + 'M';
// 终端显示宽度：CJK 记 2 列（否则中文列会对不齐）
const dispW = (s) => [...String(s)].reduce((a, c) => a + (/[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(c) ? 2 : 1), 0);
const padW = (s, w) => String(s) + ' '.repeat(Math.max(0, w - dispW(s)));

if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`# token 预算实测（${report.date}）\n`);
  if (report.static) {
    console.log(`## 一、读目标对账（静态实测：${report.static.project}）\n`);
    console.log('  ' + padW('读者', 14) + padW('读目标', 36) + padW('整读（汉字/估 token）', 24) + padW('按需读', 22) + '估算省');
    console.log('  ' + '-'.repeat(96));
    for (const r of report.static.rows) {
      console.log('  ' + padW(r.who, 12) + padW(r.what, 34)
        + padW(`${r.fullHan} / ${r.fullTokens[0]}~${r.fullTokens[1]}`, 22)
        + padW(r.leanSource === 'missing' ? '（缺失）' : `${r.leanHan} / ${r.leanTokens[0]}~${r.leanTokens[1]}`, 20)
        + (r.savePct === null ? 'n/a' : r.savePct + '%') + (r.note ? `  ⚠ ${r.note}` : ''));
    }
    console.log('\n  ⚠ token 为估算区间（汉字 0.6~1.0 token/字，ASCII 1/4 字符）；「估算省」= 1 − 按需读低值 / 整读低值。');
    console.log('  ⚠ 「按需读」缺失时不给省比（记 n/a）——避免显示 100% 的假节省。');
  }
  if (report.roles) {
    console.log(`\n## 二、真实 token 分布（会话投影聚合：${report.roles.dshHome}）\n`);
    // v18.22.0 MEA-1：输出头加**口径三要素**（分母 / 日期 / 样本数），跨日期对比前必对口径。
    console.log(`# token 预算实测（${report.date}）`);
    console.log(`# 口径（v18.22.0）：${report.roles.includeMain ? '**主会话计入**（--include-main）' : '**仅子代理**（默认：subagent.identity.label 非空才纳入；主会话进未归类桶）'}`);
    console.log(`# 样本：${report.roles.sessionsTotal} 个会话 → 纳入分析 ${report.roles.sessionsInScope} 个 → 归类 ${report.roles.sessionsClassified} 个 → 未归类 ${report.roles.sessionsUnmatched} 个｜title fallback 命中 ${report.roles.fallbackHits} 次`);
    console.log(`# 分母 = 子代理 cacheRead 合计 ${M(report.roles.subagentCacheRead)}\n`);
    console.log('  ' + padW('角色', 16) + padW('会话', 6) + padW('cacheRead', 12) + padW('占比', 9) + padW('output', 10) + '步数');
    console.log('  ' + '-'.repeat(64));
    for (const r of report.roles.byRole) {
      console.log('  ' + padW(r.role, 14) + padW(r.n, 6) + padW(M(r.cacheRead), 12)
        + padW(r.sharePct + '%', 9) + padW((r.output / 1e3).toFixed(0) + 'K', 10) + r.steps);
    }
    // v18.22.0 MEA-1：未归类桶（如有才打）
    if (report.roles.unmatched && report.roles.unmatched.length > 0) {
      for (const r of report.roles.unmatched) {
        console.log('  ' + padW(r.role, 14) + padW(r.n, 6) + padW(M(r.cacheRead), 12)
          + padW(r.sharePct + '%', 9) + padW((r.output / 1e3).toFixed(0) + 'K', 10) + r.steps);
      }
    }
    // v18.22.0 MEA-1：fallback 命中率提示（让启发式承认为启发式）
    console.log(`\n  注：占比分母 = 可识别为论衡角色的子代理 cacheRead（主控与其它插件的子代理不计入）——`);
    console.log(`      这与「单项目实测」口径不同，跨项目聚合会因各项目 T5 轮数不同而低于单项目峰值。`);
    if (report.roles.fallbackHits > 0) {
      console.log(`  注：${report.roles.fallbackHits} 个会话用 title fallback 匹配（label 不命中 → title 命中）——视为启发式归类，主人 review 时请重点检查这 ${report.roles.fallbackHits} 个。`);
    }
    if (report.roles.sessionsUnmatched > 0) {
      const unmatchShare = report.roles.subagentCacheRead ? ((report.roles.unmatched[0].cacheRead / report.roles.subagentCacheRead) * 100).toFixed(1) : 0;
      console.log(`  注：未归类 ${report.roles.sessionsUnmatched} 个会话（cacheRead 占比 ${unmatchShare}%）——本次读数受 ${unmatchShare}% 污染；若该值偏高，请检查 ROLE 正则。`);
    }
  }
}
