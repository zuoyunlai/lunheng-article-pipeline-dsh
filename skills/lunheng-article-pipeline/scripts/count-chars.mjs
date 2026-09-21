#!/usr/bin/env node
// 论衡字数统计脚本（v2.5.2-dsh.5 新增，v2.5.2-dsh.7 加 --summary，v18.2.3 修 --summary body 终点）
// 用法：node count-chars.mjs <文件.md> [--full | --summary]
//   --full    = 统计全文纯汉字（含题名/摘要/文末五节）；默认只统计正文区（## 摘要 之后、## 参考文献 之前）
//   --summary = 关键节点分段字数 + 全文配比（T7/T8 一眼可见结构，省 LLM 读全文）
//               ⚠️ 其 `body.hanChars` **与默认口径同源**（v18.2.3 修：此前误用含「关键词」的列表求终点 → 只剩摘要正文，差 21 倍）
// 口径：纯中文字符数（Unicode 汉字 \u4e00-\u9fff），不含标点/数字/英文/引用编号
//   正文区 = `## 摘要` 标题之后 → 第一个文末节之前；**含摘要正文与关键词段**，不含题名/文末五节/脚注
// v18.2.6 修（第三方审计 §4.2）：正文区**边界解析**改走 `_lib/sections.mjs`（与 m-gate-check 同一真源）——
//   旧版用精确字面量 `text.indexOf('## 参考文献')`，标题写成 `##  参考文献`（两空格）即失配
//   → 正文区终点退化为文件末尾 → `hanChars` 实测 503 → **1707**（虚高 3.4 倍）且不置 degraded。
// 用途：写手写完即跑（替代 LLM 推理估算）；T7 G8 字数核验；T8 终检权威回填
import { readFileSync, existsSync } from 'node:fs';
import { countHan } from './_lib/han.mjs';   // 汉字口径唯一真源（v2.5.2-dsh.13 抽 _lib；v18.0.3 计数改走 countHan）
// v18.2.6：`HAN_RE` 曾是**死导入**（v18.0.3 计数改走 countHan 后无人引用）——连带把 `_lib/han.mjs`
//   的模块级 `g` 正则状态问题遮住（见该文件注释）。现删除死导入，边界口径改走 sections。
import { ENDNOTE_SECTIONS, bodyStartAfterAbstract, firstEndnoteIndex, sectionBody } from './_lib/sections.mjs';
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs'; // 退出码硬化（v18.0.5）
installExitGuard();   // 传目录/权限错 → exit 10（旧版未捕获 EISDIR → exit 1 = 被读成「P1 内容失败」）

const [, , file, flag] = process.argv;
if (!file) { console.error('用法: node count-chars.mjs <文件.md> [--full | --summary]'); process.exit(10); } // v18.0.2：参数/路径错统一 10
if (!existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(10); } // v18.0.2：同上
requireExistingFile(file, '待统计文件');   // v18.0.5：必须是文件（目录 → 10，不再等到 readFileSync 炸）
// 未知 flag（如 `--ful` 拼错）静默降级会走错口径 —— v18.0.5 改为显式拒绝（第三方审计 P3）
if (flag !== undefined && !['--full', '--summary'].includes(flag)) {
  console.error(`未知参数: ${flag}\n用法: node count-chars.mjs <文件.md> [--full | --summary]`);
  process.exit(10);
}

// 编码体检（v18.0.5 引入；v18.2.6 审计修复 P2：注释与实现对齐）
//   v18.0.5 的注释写「非 UTF-8 一律响亮失败」，**实现只覆盖 UTF-16 BOM**——实测 GBK 文件既不报错也不
//   命中该分支，`readFileSync(file,'utf8')` 产出满篇 U+FFFD → `hanChars: 0`，只是**侥幸**被「缺 ## 摘要」
//   的 degraded 兜住（exit 0），原因提示还指向「摘要缺失」而非「编码不对」= 误导。现补真实体检：
//   解码后出现替换字符 U+FFFD → 判定非 UTF-8（或含非法字节），**响亮失败 exit 10**，与注释一致。
{
  const probe = readFileSync(file);
  if (probe.length >= 2 && ((probe[0] === 0xff && probe[1] === 0xfe) || (probe[0] === 0xfe && probe[1] === 0xff))) {
    console.error(`${file}: 检测到 UTF-16 BOM —— 本脚本只接受 UTF-8（契约见 .gitattributes）。请转码后重跑。`);
    process.exit(10);
  }
  if (probe.length > 0 && probe[0] === 0xef && probe[1] === 0xbb && probe[2] === 0xbf) {
    console.error(`⚠️ ${file}: 含 UTF-8 BOM（机检硬格式要求无 BOM），本次按 UTF-8 正常统计`);
  }
  // 非 UTF-8（GBK/GB18030/Big5…）用 utf8 解码**必然**产生 U+FFFD；反过来，合法 UTF-8 文本里
  // 出现 U+FFFD 只可能是作者手写该字符（本包场景不存在）——故以替换字符为判据足够稳。
  if (probe.toString('utf8').includes('\uFFFD')) {
    const badIdx = probe.toString('utf8').indexOf('\uFFFD');   // v18.2.9（审计轻微）：附首个替换字符位置，帮助定位粘贴/编码坏点
    console.error(
      `${file}: 解码出现替换字符 U+FFFD（首个出现在解码后第 ${badIdx} 字符处）—— 该文件不是合法 UTF-8（常见为 GBK/GB18030 保存，或从网页粘贴带入非法字节）。\n` +
        `  本脚本只接受 UTF-8（契约见 .gitattributes）；请转码后重跑（旧版此处会静默给出 hanChars 0）。`,
    );
    process.exit(10);
  }
}

const text = readFileSync(file, 'utf8');

// 正文区起点（缺「## 摘要」）的标记计算（v18.0.5：从默认分支**提到 summary 之前**——旧版
//   `--summary` 在标记逻辑之前就 process.exit(0)，导致该模式口径失真却**不带 degraded 标记**，
//   正是 v2.5.2-dsh.13 专门要消灭的静默退化；第三方审计 P1-3）。
// v18.2.6：起点解析改走 `_lib/sections.mjs`（标题按「行首 ## + 任意空白」解析，不再依赖 `'## 摘要'` 字面量）。
const abstractStart = bodyStartAfterAbstract(text);
const bodyStartIdx = abstractStart.index;
const degraded = !abstractStart.found;
if (degraded && flag !== '--full') {
  console.error(`⚠️ ${file}：未找到「## 摘要」，正文区起点退化为文件开头（口径已失真）——请补写摘要，或改用 --full 明确按全文统计`);
}
const degradedFields = degraded && flag !== '--full'
  ? { degraded: true, degradedReason: '缺「## 摘要」→ 正文区起点退化为文件开头' }
  : {};   // `--full` 不受正文区起点影响，故不标 degraded（v18.0.5：与既有契约一致）

// === 文末五节标记 + 正文区终点（v18.2.3：单一真源，默认口径与 --summary **共用**）===
// v18.2.2 缺陷（主人授权修订；依据 2026-09-12 全量测试后主人反问「字数限定仅指正文吗」的取证）：
//   `--summary` 分支此前用**含「摘要/关键词」的 segs** 求 body 终点 → 命中 `## 关键词` 即截断
//   → `body.hanChars` 只剩摘要正文（**实测 243**），而默认口径是 **5112**（差 **21 倍**）；
//   派生字段 `bodyRatio`(4.1%) / `avgPerSection`(16) 亦随之失真。
//   ⚠️ 危害在于脚本头注释写「--summary = …（**T7/T8 一眼可见结构**，省 LLM 读全文）」
//   —— T7/T8 若照注释取用该 body 值，**会把一篇 5112 字的论文判成「仅 4% 篇幅」**，
//   进而下达完全错误的「P0 立即精简」指令。默认分支用的是正确的 5 元素列表，
//   **同一脚本两条路径各写一份**即根因；现抽为共用助手，从结构上杜绝再次发散。
// v18.2.6 修（第三方审计 §4.2）：本处旧实现 `text.indexOf('## 参考文献')` 是**精确字面量**匹配，
//   标题带额外空白（`##  参考文献`）即失配 → 正文区终点退化为文件末尾（实测量 503 → 1707）。
//   现改用 `_lib/sections.mjs` 的 `firstEndnoteIndex`（行首 `##` + 任意空白解析），**与 m-gate-check 同源**。
const bodyEndOf = (from) => {
  const i = firstEndnoteIndex(text, from);
  return i === -1 ? text.length : i;
};

if (flag === '--summary') {
  // 分段：标题/摘要/关键词/正文/参考文献/数据来源/案例来源/先行者文献/AI 使用声明
  const segs = ['摘要', '关键词', ...ENDNOTE_SECTIONS];
  const sections = {};
  for (const s of segs) {
    // v18.2.3：不计**节标题自身的汉字**（实测 `关键词` 21 vs 标题式口径 18，差 3 = 「关键词」三字），
    //   与下方 `sectionsByHeading` 的口径一致。
    // v18.2.6：定位改走 `_lib/sections.mjs` 的 `sectionBody`（旧版 `indexOf('## ' + s)` 同样怕多余空白）
    const bodyText = sectionBody(text, s);
    sections[s] = bodyText === null ? 0 : countHan(bodyText);   // v18.0.3：改用 _lib/han.mjs 的 countHan（旧版在此内联 match）
  }
  // 正文区 = 摘要之后到第一个文末节之前（v18.2.3：改走共用助手 bodyEndOf，
  //   不再用含「摘要/关键词」的 segs 求终点 —— 那正是 21 倍失真的根因）
  const bodyFrom = bodyStartIdx;
  const bodyEnd = bodyEndOf(bodyFrom);
  const bodyCount = countHan(text.slice(bodyFrom, bodyEnd));   // v18.0.3：走 _lib 真源
  const totalCount = countHan(text);                            // v18.0.3：同上
  // 各章节 H2/H3 标题 + 字数（top 10 节）
  const headingRe = /^(#{2,3})\s+(.+)$/gm;
  const headingCounts = [];
  for (const m of text.matchAll(headingRe)) {
    const title = m[2].trim();
    // 找该标题到下一个同级/上级标题之间的内容
    const start = m.index + m[0].length;
    const level = m[1].length;
    const nextRe = new RegExp(`^#{1,${level}}\\s+`, 'gm');
    nextRe.lastIndex = start;
    const next = nextRe.exec(text);
    const end = next ? next.index : text.length;
    const han = countHan(text.slice(start, end));   // v18.0.3：走 _lib 真源
    headingCounts.push({ level: m[1], title, hanChars: han });
  }
  console.log(JSON.stringify({
    file,
    mode: 'summary',
    total: { hanChars: totalCount },
    body: { hanChars: bodyCount, scope: '摘要后~文末节前' },
    endnotes: sections,
    sectionsByHeading: headingCounts.slice(0, 15),
    density: {
      bodyRatio: totalCount > 0 ? +(bodyCount / totalCount * 100).toFixed(1) : 0,
      // v18.0.5：分母为 0 时给 0（旧版 Infinity → JSON.stringify 变 null，看着像「缺失」）——第三方审计 P3
      avgPerSection: (() => {
        const h2 = headingCounts.filter((s) => s.level === '##').length;
        return h2 > 0 ? Math.round(bodyCount / h2) : 0;
      })(),
    },
    ...degradedFields,   // v18.0.5：--summary 也必须带 degraded 标记（旧版在标记前就 exit 0）
  }, null, 2));
  process.exit(0);
}

let target = text;
if (flag !== '--full') {
  // 正文区：## 摘要 之后 到 ## 参考文献（或文末）之前
  // v2.5.2-dsh.13 修订（第三方审计 P1）：无「## 摘要」时旧版静默把起点退化为文件开头（口径前移、
  // 若文末节标记也缺失则等于全文），却仍自称 body(正文区) → 双口径坍缩、字数分级系统性偏大。
  // 现在：显式置 degraded 标记并在 stderr 告警（计算已提到 summary 之前，两模式共用）。
  const from = bodyStartIdx;
  // v18.2.3：终点改走与 --summary 共用的 bodyEndOf（消除「两条路径各写一份 → 发散」）
  target = text.slice(from, bodyEndOf(from));
}

const count = countHan(target);   // v18.0.3：走 _lib/han.mjs 真源（旧版在此内联 match）
console.log(JSON.stringify({
  file,
  scope: flag === '--full' ? 'full(全文纯汉字)' : 'body(正文区纯汉字: 摘要后~文末节前)',
  hanChars: count,
  ...degradedFields,
}, null, 2));
process.exit(0);
