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
// 退出码：0 成功｜1 用法/未知参数｜2 项目路径不存在
//
// ⚠️ token 口径（**估算区间，非计费值**）：
//   汉字 ≈ 0.6~1.0 token/字（BPE 对中文的常见区间）；ASCII ≈ 1 token / 4 字符。
//   精确值请用 `token-cost.mjs` 读会话投影里的**真实 tokenUsage**（本脚本 `--roles` 即读它）。
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(`用法: node token-budget.mjs [--project <run/项目>] [--roles] [--json] [--dsh-home <path>]

--project <路径>   静态测量该项目的「读目标」：整读规模 vs 按需读规模（大纲 vs §11 / 三卡 vs 索引段 / 证据包 vs 审计视图 / 定稿+证据包 vs M 门 JSON）
--roles            读 $DSH_HOME/storages/session_projcache/sessions/*.json，按论衡角色聚合真实 token（cacheRead / output / 步数 / 占比）
--dsh-home <path>  指定 DSH_HOME（默认 $DSH_HOME 或 ~/.dsh）
--json             输出 JSON（机器可读）
-h, --help         本帮助
退出码：0 成功｜1 用法/未知参数｜2 项目路径不存在
⚠️ token 为**估算区间**（汉字 0.6~1.0 token/字，ASCII 1/4 字符）；真实值见 --roles 读的 tokenUsage。`);
  process.exit(0);
}
const KNOWN = new Set(['--project', '--roles', '--json', '--dsh-home']);
const valOf = (flag) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };
for (const a of args) if (a.startsWith('--') && !KNOWN.has(a)) {
  console.error(`未知参数: ${a}\n用法: node token-budget.mjs [--project <run/项目>] [--roles] [--json] [--dsh-home <path>]`);
  process.exit(1);
}
const wantJson = args.includes('--json');
const projArg = valOf('--project');
const wantRoles = args.includes('--roles');
const dshHome = valOf('--dsh-home') || process.env.DSH_HOME || join(homedir(), '.dsh');
if (!projArg && !wantRoles) {
  console.error('需至少给一个模式：--project <run/项目> 或 --roles\n用法: node token-budget.mjs [--project <run/项目>] [--roles] [--json]');
  process.exit(1);
}
if (projArg && !existsSync(projArg)) {
  console.error(`项目路径不存在: ${projArg}`);
  process.exit(2);
}

// ---- token 估算（口径见头注释）----
const hanCount = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;
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
    add('T5 写作', '分析大纲：全文 → §11 精简段', outline, s11 === null ? ('x'.repeat(60 * 40)) : s11,
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
        });
      } catch { /* 跳过坏文件 */ }
    }
  } else if (existsSync(legacy)) {
    const cache = JSON.parse(readFileSync(legacy, 'utf8'));
    for (const [id, c] of Object.entries(cache.tables?.sessions || {})) {
      const t = (c.rows || c).tokenUsage?.val?.totals;
      if (t) sessions.push({ id: id.slice(0, 8), label: '', prompt: '', steps: null, cacheRead: t.cacheReadTokens || 0, uncached: t.uncachedInputTokens || 0, output: t.outputTokens || 0 });
    }
  }
  const classified = sessions.map((s) => ({ ...s, role: (ROLE.find(([, re]) => re.test(s.label) || re.test(s.prompt)) || [null])[0] }));
  const sub = classified.filter((s) => s.role);
  const total = sub.reduce((a, s) => a + s.cacheRead, 0);
  const byRole = new Map();
  for (const s of sub) {
    if (!byRole.has(s.role)) byRole.set(s.role, { n: 0, cacheRead: 0, uncached: 0, output: 0, steps: 0 });
    const a = byRole.get(s.role);
    a.n++; a.cacheRead += s.cacheRead; a.uncached += s.uncached; a.output += s.output; a.steps += s.steps || 0;
  }
  report.roles = {
    dshHome,
    sessionsTotal: sessions.length,
    sessionsClassified: sub.length,
    subagentCacheRead: total,
    byRole: [...byRole.entries()]
      .map(([role, a]) => ({ role, ...a, sharePct: total ? Number(((a.cacheRead / total) * 100).toFixed(1)) : 0 }))
      .sort((x, y) => y.cacheRead - x.cacheRead),
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
    console.log(`  会话 ${report.roles.sessionsTotal} 个（可识别为论衡角色 ${report.roles.sessionsClassified} 个）｜子代理 cacheRead 合计 ${M(report.roles.subagentCacheRead)}\n`);
    console.log('  ' + padW('角色', 16) + padW('会话', 6) + padW('cacheRead', 12) + padW('占比', 9) + padW('output', 10) + '步数');
    console.log('  ' + '-'.repeat(64));
    for (const r of report.roles.byRole) {
      console.log('  ' + padW(r.role, 14) + padW(r.n, 6) + padW(M(r.cacheRead), 12)
        + padW(r.sharePct + '%', 9) + padW((r.output / 1e3).toFixed(0) + 'K', 10) + r.steps);
    }
    console.log('\n  注：占比分母 = 可识别为论衡角色的子代理 cacheRead（主控与其它插件的子代理不计入）——');
    console.log('      这与「单项目实测」口径不同，跨项目聚合会因各项目 T5 轮数不同而低于单项目峰值。');
  }
}
