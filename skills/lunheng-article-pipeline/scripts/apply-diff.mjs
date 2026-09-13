#!/usr/bin/env node
// 论衡段级 diff 应用脚本（v18.2.5 新增，主控实战反哺 P2）
// 用法：node apply-diff.mjs <目标正文.md> <段级diff清单.md> [--out <输出.md>] [--dry-run] [--report <path>]
//   --out      = 输出路径（推荐显式给下一版路径，如 drafts/初稿-v4.md）；缺省 = 原地覆盖目标（谨慎）
//   --dry-run  = 只试算、不写盘（**建议先跑一次核对抽取结果**）
//   --report   = 落 JSON 报告
// 口径：汉字计数走 `_lib/han.mjs`（与 count-chars.mjs 同源）——delta 由脚本**实测**，不由清单自报
// 退出码：0 = 全部应用 / 1 = 部分跳过（需人工处理）/ 10 = 参数或路径错误
//
// 为什么需要本脚本（主控实战反哺 P2）：
//   段级 diff 模式（v2.5.2-dsh.7）为省 token 让 T5 只出清单、由主控逐条 edit——实测单项目
//   4 轮修订共 **83 条 diff**、主控 ≈82 次 edit 调用，且清单的「估算字数」与 `count-chars.mjs`
//   口径不一致（标点/编号被算进"字"）导致每轮多耗一次返工（本项目 v3：清单预估 8452、
//   实测 8863）。本脚本把「机械应用 + 汉字 delta 实测」两件事交给代码，主控只做核对与仲裁。
//
// 解析策略（best-effort，容错多形态）：
//   ① 条目分隔：行首 `[Diff …]` / `[P0-n …]` / `[P1-n …]` / `[C-n]` 等**方括号编号行**；
//   ② 每条取「现况」行与「修改」（或「增补」）行——允许 `- **现况**：` / `  现况：` 等多种前缀；
//   ③ old/new 抽取用**最小差异法**（最长公共前缀 + 最长公共后缀），而非只取引号内内容——
//      后者对「引号内相同、差异在引号外」的条目（如给括号内补一个编号）会抽空。
//      最小差异法同时覆盖 替换 / 插入 / 删除 三类，且不要求 T5 用某种固定引号。
//   ④ 剥离「修改」行尾的元注记（`（按 G14 报告 C-01）` 等），避免把注记写进正文。
// 安全约束：old 在目标文件内**必须唯一**——多处匹配一律跳过并报告（交主控按行号人工处理）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { countHan } from './_lib/han.mjs';
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs';
installExitGuard();

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const optVal = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const [targetPath, listPath] = positional;

if (!targetPath || !listPath) {
  console.error('用法: node apply-diff.mjs <目标正文.md> <段级diff清单.md> [--out <输出.md>] [--dry-run] [--report <path>]');
  process.exit(10);
}
for (const [p, what] of [[targetPath, '目标正文'], [listPath, 'diff 清单']]) {
  if (!existsSync(p)) { console.error(`${what}不存在: ${p}`); process.exit(10); }
  requireExistingFile(p, what);
}
const dryRun = flag('--dry-run');
const outPath = optVal('--out') || targetPath;
const reportPath = optVal('--report');

// ---- 元注记剥离（防「（按 XX 报告 NN）」写进正文）----
const META_TAIL = /\s*[（(](?:按|参|依据|参见|详见|对应|v\d)[^）)]{0,60}[）)]\s*$/u;
const stripMeta = (s) => s.replace(META_TAIL, '').trim();

// ---- 最小差异法：返回 {oldPart, newPart, at, prefixLen, suffixLen} ----
const extractDelta = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return {
    oldPart: a.slice(i, a.length - j),
    newPart: b.slice(i, b.length - j),
    at: i,
    prefixLen: i,
    suffixLen: j,
  };
};

// ---- 带上下文的定位（v18.2.5 修：纯插入场景的关键）----
//   只拿 oldPart 去目标文件里找是**不够**的：当差异是「纯插入」时（如给 `[L10]` 后补
//   `（辅助证据）`），oldPart 往往退化成 1 个空格甚至空串 → 「出现 2117 次」→ 只能跳过。
//   改用「公共前缀尾 + oldPart + 公共后缀头」构造定位串，并**自适应扩大上下文**直到唯一。
const locateAndReplace = (text, oldPart, newPart, a, i, j) => {
  for (const CTX of [8, 16, 32, 64]) {
    const L = Math.min(i, CTX);
    const R = Math.min(j, CTX);
    const from = i - L;
    const to = a.length - j + R;
    const locateStr = a.slice(from, to);
    if (!locateStr) continue;
    const n = occurrences(text, locateStr);
    if (n !== 1) continue;
    const head = locateStr.slice(0, L);
    const tail = locateStr.slice(L - from + oldPart.length);
    return { ok: true, text: text.replace(locateStr, head + newPart + tail), ctx: CTX, locateStr };
  }
  return { ok: false };
};

// ---- 解析清单 ----
const stripMd = (s) => s
  .replace(/^\s*[-*]\s*/, '')            // 列表符
  .replace(/^\s*\*\*[^*]*\*\*\s*[:：]?\s*/, '')  // `**现况**：` / `**修改**：`
  .replace(/^\s*(?:现况|修改|增补|定位|估算|估算字数|依据|验收|说明|优先级)\s*[:：]\s*/u, '')
  .trim();

const listLines = readFileSync(listPath, 'utf8').split('\n');
const HEAD_RE = /^\s*(?:#{1,6}\s*)?\[(?:Diff\s+)?([A-Za-z]?\d+[-\w.]*)[^\]]*\]/;
const items = [];
let cur = null;
for (let n = 0; n < listLines.length; n++) {
  const line = listLines[n];
  const m = HEAD_RE.exec(line);
  if (m) {
    if (cur) items.push(cur);
    cur = { id: m[1], line: n + 1, cur: null, new: null, loc: '', rawLoc: '' };
    continue;
  }
  if (!cur) continue;
  if (/^\s*(?:[-*]\s*)?(?:\*\*)?定位(?:\*\*)?\s*[:：]/u.test(line)) { cur.loc = stripMd(line); cur.rawLoc = line.trim(); continue; }
  // 「现况」可能写成 `- **现况**：` / `  现况：` / `现况：「…」`
  if (/^\s*(?:[-*]\s*)?(?:\*\*)?现况(?:\*\*)?\s*[:：]/u.test(line)) { cur.cur = stripMd(line); continue; }
  if (/^\s*(?:[-*]\s*)?(?:\*\*)?(?:修改|增补|改为)(?:\*\*)?\s*[:：]/u.test(line)) { cur.new = stripMd(line); continue; }
}
if (cur) items.push(cur);

const parsed = items.filter((it) => it.cur && it.new);
const unparsed = items.filter((it) => !it.cur || !it.new);

// ---- 逐条试算 ----
let text = readFileSync(targetPath, 'utf8');
const beforeHan = countHan(text);
const applied = [];
const skipped = [];
const occurrences = (haystack, needle) => {
  if (!needle) return 0;
  let c = 0, idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) { c++; idx += needle.length; }
  return c;
};

for (const it of parsed) {
  const curTxt = stripMeta(it.cur);
  const newTxt = stripMeta(it.new);
  const { oldPart, newPart, prefixLen, suffixLen } = extractDelta(curTxt, newTxt);
  if (!oldPart && !newPart) { skipped.push({ id: it.id, line: it.line, reason: '现况与修改无差异（抽取为空）' }); continue; }
  const r = locateAndReplace(text, oldPart, newPart, curTxt, prefixLen, suffixLen);
  if (!r.ok) {
    skipped.push({
      id: it.id,
      line: it.line,
      reason: `定位串在目标文件中不唯一或不存在（差异片段「${oldPart.slice(0, 24)}${oldPart.length > 24 ? '…' : ''}」→「${newPart.slice(0, 24)}${newPart.length > 24 ? '…' : ''}」），须主控按「定位」列行号人工处理`,
    });
    continue;
  }
  text = r.text;
  applied.push({
    id: it.id, line: it.line,
    kind: oldPart === '' ? '插入' : (newPart === '' ? '删除' : '替换'),
    oldPart, newPart, ctx: r.ctx, loc: it.loc,
  });
}

const afterHan = countHan(text);
const delta = afterHan - beforeHan;

// ---- 输出 ----
const summary = {
  target: targetPath,
  list: listPath,
  out: outPath,
  dry_run: dryRun,
  list_items: items.length,
  parsed: parsed.length,
  unparsed: unparsed.length,
  applied: applied.length,
  skipped: skipped.length,
  han: { before: beforeHan, after: afterHan, delta },
  applied_items: applied,
  skipped_items: skipped,
  unparsed_items: unparsed.map((u) => ({ id: u.id, line: u.line, reason: !u.cur ? '缺「现况」行' : '缺「修改」行' })),
};

if (!dryRun) writeFileSync(outPath, text, 'utf8');
if (reportPath) writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf8');

console.log(JSON.stringify({
  ok: skipped.length === 0 && unparsed.length === 0,
  target: targetPath, out: outPath, dry_run: dryRun,
  applied: applied.length, skipped: skipped.length, unparsed: unparsed.length,
  han_before: beforeHan, han_after: afterHan, han_delta: delta,
  skipped_detail: skipped.slice(0, 8),
  unparsed_detail: summary.unparsed_items.slice(0, 8),
  hint: skipped.length || unparsed.length
    ? '存在跳过/未解析条目：请用 --report 看全量明细，按 `loc` 行号人工处理剩余条目'
    : '全部条目已机械应用；delta 为脚本实测（可直接写入修订说明，替代清单自报的估算值）',
}, null, 2));

process.exit(skipped.length === 0 && unparsed.length === 0 ? 0 : 1);
