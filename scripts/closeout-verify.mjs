#!/usr/bin/env node
// 收口批固定动作：**差集检查 + 反向核验（陈旧「未做」清单）**
//
// 用法：node scripts/closeout-verify.mjs [--audit <审计报告.md>] [--records <修订记录目录>] [--repo <仓库根>] [--json]
//
// 为什么有这个脚本（三次实战教训，全在同一轮 v18.12.x 收口里踩出）：
//   ① 18.12.2 交付时 agent 声称「三条定案都已落地」——**差集检查**（审计报告 ID ↔ 全部修订记录 + CHANGELOG）
//      证明它不完整：11 个 ID **从未被任何记录提及**（L-07/09/11/16/32/36/55/56/57/58/59）。
//      判据：对「已全部修订」这类断言，**唯一廉价的机械反驳手段就是 ID 差集**——逐条读记录会漏，
//      因为漏掉的 ID 恰恰是**没有任何记录可读**的那些。
//   ② 18.12.3 之后 agent 把「差集为空」当完成证据。**差集只能证明「被记录」，不能证明「被结清」**：
//      记录里有一份**跨梯队累积的陈旧「仍未做」清单**（第四梯队登记 L-13/L-14/L-24/… ，后续梯队早把
//      其中 27 项做完，但清单没回标）→ 反向核验才查出真缺口只剩 1 项（L-14）。
//   ③ 反向核验还**推翻了 5 处「记录说未做、实际早已落地」**（L-27/L-28/L-41/L-60/L-61）——
//      即陈旧清单不只是「漏报已修」，也会「误报未修」。两个方向都得查。
//
// 判据一句话：**差集查漏，反向核验查「记录陈旧」——两者缺一不可**。只跑差集会得到
//   「全部被记录」的假安心；只读记录会漏掉没有任何记录的那些。
//
// ⚠️ **本脚本只覆盖可机械化的那半，边界如实声明**：
//   · 能判：①某 ID 在任何记录里都不存在；②某 ID 在某梯队被登记为「未做/延后/保留代价」，
//     而**其后所有梯队都没再提到它**（= 清单陈旧，必须回标或补做）。
//   · **不能判**：某 ID 的后继提及究竟代表「真做完了」还是「只是提了一句」。**语义那半必须人工**——
//     正确动作是拿本脚本输出的清单，逐条**回到代码/产物实测**（v18.13.0 正是这么做才发现
//     L-27/L-28/L-41/L-60/L-61 其实是已修、而 L-14 是真未修）。
//   把「提到」当「做完」= 复现 18.12.3 的错误；本脚本刻意只报「需人工回核」而不报「已完成」。
//
// 退出码：0 = 两步均无发现；1 = 有发现（列在 stderr）；10 = 参数/路径错；70 = 内部错误。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const asJson = argv.includes('--json');
for (const a of argv) {
  if (a.startsWith('--') && !['--audit', '--records', '--repo', '--json'].includes(a)) {
    console.error(`未知参数: ${a}\n用法: node scripts/closeout-verify.mjs [--audit <报告>] [--records <目录>] [--repo <仓库根>] [--json]`);
    process.exit(10);
  }
}

// 仓库根：默认取脚本自身位置（`<repo>/scripts/` 的上一级），但**可被 `--repo` 覆盖**。
//   ⚠️ 为什么必须可覆盖（写本脚本时踩的第三个坑）：`--audit/--records` 指向夹具时，
//   CHANGELOG（「被提及」的证据源之一）仍会从**脚本所在真仓**读取 —— 真仓 CHANGELOG 含全部 ID，
//   于是夹具里的陈旧「未做」登记被凭空抹掉、门报 ✓。即「换了输入却没换证据源」= 假绿。
const repoRoot = resolve(opt('--repo', resolve(import.meta.dirname, '..')));
const auditPath = resolve(opt('--audit', join(repoRoot, 'audits', '全量审计报告-v18.11.0.md')));
const recordsDir = resolve(opt('--records', join(repoRoot, 'audits')));

for (const [label, p] of [['审计报告', auditPath], ['修订记录目录', recordsDir]]) {
  if (!existsSync(p)) { console.error(`${label}不存在: ${p}`); process.exit(10); }
}
if (!statSync(auditPath).isFile()) { console.error(`审计报告不是文件: ${auditPath}`); process.exit(10); }
if (!statSync(recordsDir).isDirectory()) { console.error(`修订记录路径不是目录: ${recordsDir}`); process.exit(10); }

// ── 梯队排序：从文件名取中文序数（第一…第十），取不到则按「承接链」与文件名字典序兜底 ────────────
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const tierRank = (name) => {
  const m = /第([一二三四五六七八九十])梯队/.exec(name);
  // 有「第N梯队」→ 用其序数（这是**唯一**可用于先后判定的序）；
  // 无该标记的专项记录（「L05裁定通道」「反哺v1v2落地」）与后续的**版本段记录**
  //   （如「v18.13.0 收口」）→ 返回 null：它们**不构成「后续处理」的证据**。
  //   ⚠️ 首版把它们排成 90，于是任何 ID 只要在**任意一份**非梯队记录里出现过，
  //   就被当成「后续有人处理了」→ 门虽在却不生效（写脚本时自己踩的第二个坑）。
  return m ? CN_NUM[m[1]] : null;
};

// ── 读取全部修订记录 + CHANGELOG（CHANGELOG 也算「被提及」的证据源）────────────────────────
const recFiles = readdirSync(recordsDir)
  .filter((f) => f.startsWith('机制文件修订记录-') && f.endsWith('.md'))
  .map((f) => ({ file: f, path: join(recordsDir, f), rank: tierRank(f) }))
  .filter((r) => r.rank !== null)
  .sort((a, b) => a.rank - b.rank || a.file.localeCompare(b.file));
if (!recFiles.length) {
  console.error(`未在 ${recordsDir} 找到任何「机制文件修订记录-*.md」——拒绝在无记录的情况下判「已收口」`);
  process.exit(10);
}
const chgPath = join(repoRoot, 'CHANGELOG.md');
const records = recFiles.map((r) => ({ ...r, text: readFileSync(r.path, 'utf8') }));
const changelogText = existsSync(chgPath) ? readFileSync(chgPath, 'utf8') : '';
const readmeText = existsSync(join(recordsDir, 'README.md')) ? readFileSync(join(recordsDir, 'README.md'), 'utf8') : '';
const allRecordText = [...records.map((r) => r.text), changelogText, readmeText].join('\n');

// ── 第 1 步：差集——审计报告里的 ID 必须至少被一处记录提及 ─────────────────────────────────
const auditText = readFileSync(auditPath, 'utf8');
const idsOf = (text) => [...new Set([...text.matchAll(/\bL-\d{2}\b/g)].map((m) => m[0]))].sort();
const auditIds = idsOf(auditText);
if (!auditIds.length) {
  console.error(`审计报告里没找到任何 L-NN 形式的 ID（${relative(repoRoot, auditPath)}）——请确认报告格式`);
  process.exit(10);
}
const mentioned = new Set(idsOf(allRecordText));
const neverMentioned = auditIds.filter((id) => !mentioned.has(id));

// ── 第 2 步：反向核验——某梯队登记的「未做」项，其后梯队必须再提到它（否则清单就是陈旧的）────
// 「未做」标记的识别：视为**块起点**，块延伸到「下一个标题」或「下一个同级加粗行」为止。
//   ⚠️ 实测教训（写本脚本时自己踩的）：真实记录里这个标记**不是小节标题**，而是加粗行
//   `**仍未做（如实）**：`（后面跟一张表或一串行）。首版只认 `##` 标题 → 第四梯队/第六梯队的
//   「仍未做」整块被**静默忽略**，脚本对真仓报「0 项」——这正是它要防的那种「门在此、却不生效」。
//   故此处同时接受两种形态：`#{2,4}` 标题 与 `**…**` 加粗行；块内追平级新标记时切换/结束。
const UNDONE_RE = /(仍未做|有意未做|本次不修|未做|暂不|延后|保留代价|刻意未加|不修)/;
/** 该行是否为「未做」标记行；是则返回其层级与整行文本 */
const undoneMarker = (line) => {
  const h = /^(#{2,4})\s+(.*)$/.exec(line);
  if (h && UNDONE_RE.test(h[2])) return { level: h[1].length, title: h[2] };
  const b = /^\*\*(.+?)\*\*/.exec(line.trim());
  if (b && UNDONE_RE.test(b[1])) return { level: 4, title: b[1], bold: true };
  return null;
};
/** 收集某份记录里「被登记为未做」的 ID：标记块内出现的全部 ID（含块内的行内标记） */
function undoneIds(text) {
  const lines = text.split('\n');
  const found = new Set();
  let open = false;
  let level = 0;
  let boldSeen = new Set();          // 同一块内已出现过的加粗行标题（用于结束块）
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    const b = /^\*\*(.+?)\*\*/.exec(line.trim());
    const marker = undoneMarker(line);
    if (open) {
      // 结束条件：更高或同级标题；或出现**新的**同级加粗行（新的一句话/表头，说明未做块已结束）
      if (h && h[1].length <= level) open = false;
      else if (b && !marker) {
        const key = b[1];
        if (boldSeen.has(key) || boldSeen.size >= 1) open = false;   // 第二个加粗行即视为块结束
        else boldSeen.add(key);
      }
    }
    if (marker) {
      open = true;
      level = marker.level === 4 && marker.bold ? 4 : marker.level;
      boldSeen = new Set(marker.bold ? [marker.title] : []);
      for (const m of line.matchAll(/\bL-\d{2}\b/g)) found.add(m[0]);
      continue;
    }
    if (open) for (const m of line.matchAll(/\bL-\d{2}\b/g)) found.add(m[0]);
  }
  return found;
}
const staleDeferrals = [];
for (const rec of records) {
  const undone = undoneIds(rec.text);
  if (!undone.size) continue;
  for (const id of undone) {
    // 其后（rank 更大，或同 rank 但文件名在后）的记录里是否再出现该 ID
    const laterText = records.filter((o) => o.rank > rec.rank).map((o) => o.text).join('\n') + '\n' + changelogText;
    if (!new RegExp(`\\b${id}\\b`).test(laterText)) {
      // 也查该记录自身后文是否「同一份里已结清」（如「本批未做」后又写「已补」）
      staleDeferrals.push({ id, tier: rec.file.replace(/^机制文件修订记录-/, '').replace(/\.md$/, '') });
    }
  }
}

// ── 输出 ────────────────────────────────────────────────────────────────────────────────
const report = {
  auditFile: relative(repoRoot, auditPath).replaceAll('\\', '/'),
  auditIdCount: auditIds.length,
  recordFiles: records.length,
  step1_neverMentioned: neverMentioned,
  step2_staleDeferrals: staleDeferrals,
  boundary: '本脚本只报「需人工回核」的项，**不判「已完成」**——语义那半必须逐条回代码/产物实测',
};
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(neverMentioned.length || staleDeferrals.length ? 1 : 0);
}

console.log(`收口批两步检查：审计 ${auditIds.length} 个 ID × ${records.length} 份修订记录`);
console.log(`  第 1 步 差集：从未被任何记录提及 = ${neverMentioned.length} 个`);
console.log(`  第 2 步 反向核验：登记为「未做」但其后无人再提 = ${staleDeferrals.length} 项`);

const problems = [];
if (neverMentioned.length) {
  problems.push(`[P1 差集] 以下 ID 在审计报告里存在，却**从未被任何修订记录/CHANGELOG 提及**（既不修也不登记）：\n` +
    neverMentioned.map((x) => `    · ${x}`).join('\n'));
}
if (staleDeferrals.length) {
  problems.push(`[P1 陈旧清单] 以下项在某梯队被登记为「未做/延后/保留代价」，但**其后所有梯队都没再提到**——` +
    `必须逐条回代码/产物实测，并回标为「已做(附证据)」或保留在最新一批的未做清单里：\n` +
    staleDeferrals.map((x) => `    · ${x.id}  （登记于：${x.tier}）`).join('\n'));
}
if (problems.length) {
  console.error('\n收口批两步检查未通过：');
  for (const p of problems) console.error('  - ' + p);
  console.error('\n⚠️ 语义那半仍需人工：拿上面的清单逐条**回代码/产物实测**——' +
    '「被提到」不等于「已做完」，把提到当做完正是 18.12.3 的错误。');
  process.exit(1);
}
console.log('\n✓ 两步均无发现（差集为空 + 无陈旧「未做」登记）。' +
  '\n  下一步（本脚本刻意不代劳）：把「已记录」项逐条回代码/产物实测——差集只能证明「被记录」。');
