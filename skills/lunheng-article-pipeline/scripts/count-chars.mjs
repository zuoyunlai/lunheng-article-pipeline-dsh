#!/usr/bin/env node
// 论衡字数统计脚本（v2.5.2-dsh.5 新增，v2.5.2-dsh.7 加 --summary）
// 用法：node count-chars.mjs <文件.md> [--full | --summary]
//   --full    = 统计全文纯汉字（含题名/摘要/文末五节）；默认只统计正文区（## 摘要 之后、## 参考文献 之前）
//   --summary = 关键节点分段字数 + 全文配比（T7/T8 一眼可见结构，省 LLM 读全文）
// 口径：纯中文字符数（Unicode 汉字 \u4e00-\u9fff），不含标点/数字/英文/引用编号
// 用途：写手写完即跑（替代 LLM 推理估算）；T7 G8 字数核验；T8 终检权威回填
import { readFileSync, existsSync } from 'node:fs';
import { countHan, HAN_RE as HAN } from './_lib/han.mjs';   // 汉字口径唯一真源（v2.5.2-dsh.13 抽 _lib；v18.0.3 计数改走 countHan）
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

// 编码体检（v18.0.5，第三方审计 P2）：UTF-16 文件用 utf8 读会得到大量替换字符 → 汉字数静默为 0
//   （实测 UTF-16 文案「正文。」→ hanChars 0 且无任何告警）。契约是 UTF-8（.gitattributes / 卫生门），
//   非 UTF-8 一律响亮失败，不要给一个看起来正常但错误的数字。
{
  const probe = readFileSync(file);
  if (probe.length >= 2 && ((probe[0] === 0xff && probe[1] === 0xfe) || (probe[0] === 0xfe && probe[1] === 0xff))) {
    console.error(`${file}: 检测到 UTF-16 BOM —— 本脚本只接受 UTF-8（契约见 .gitattributes）。请转码后重跑。`);
    process.exit(10);
  }
  if (probe.length > 0 && probe[0] === 0xef && probe[1] === 0xbb && probe[2] === 0xbf) {
    console.error(`⚠️ ${file}: 含 UTF-8 BOM（机检硬格式要求无 BOM），本次按 UTF-8 正常统计`);
  }
}

const text = readFileSync(file, 'utf8');

// 正文区起点退化（缺「## 摘要」）的标记计算（v18.0.5：从默认分支**提到 summary 之前**——旧版
//   `--summary` 在标记逻辑之前就 process.exit(0)，导致该模式口径失真却**不带 degraded 标记**，
//   正是 v2.5.2-dsh.13 专门要消灭的静默退化；第三方审计 P1-3）。
const abstractStart = text.indexOf('## 摘要');
const bodyStartIdx = abstractStart >= 0 ? abstractStart + '## 摘要'.length : 0;
const degraded = abstractStart < 0;
if (degraded && flag !== '--full') {
  console.error(`⚠️ ${file}：未找到「## 摘要」，正文区起点退化为文件开头（口径已失真）——请补写摘要，或改用 --full 明确按全文统计`);
}
const degradedFields = degraded && flag !== '--full'
  ? { degraded: true, degradedReason: '缺「## 摘要」→ 正文区起点退化为文件开头' }
  : {};   // `--full` 不受正文区起点影响，故不标 degraded（v18.0.5：与既有契约一致）

if (flag === '--summary') {
  // 分段：标题/摘要/关键词/正文/参考文献/数据来源/案例来源/先行者文献/AI 使用声明
  const segs = ['摘要', '关键词', '参考文献', '数据来源', '案例来源', '先行者文献', 'AI 使用声明'];
  const sections = {};
  for (const s of segs) {
    const start = text.indexOf(`## ${s}`);
    let end = text.length;
    if (start >= 0) {
      // 找下一个 ## 标记
      const after = start + `## ${s}`.length;
      const next = text.indexOf('\n## ', after);
      if (next >= 0) end = next;
      sections[s] = countHan(text.slice(start, end));   // v18.0.3：改用 _lib/han.mjs 的 countHan（旧版在此内联 match）
    } else {
      sections[s] = 0;
    }
  }
  // 正文区 = 摘要之后到第一个文末节之前
  const bodyFrom = bodyStartIdx;
  // 找最近的文末节作为 body 终点
  let bodyEnd = text.length;
  for (const s of segs) {
    const i = text.indexOf(`## ${s}`, bodyFrom);
    if (i >= 0 && i < bodyEnd) bodyEnd = i;
  }
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
  const endMarkers = ['## 参考文献', '## 数据来源', '## 案例来源', '## 先行者文献', '## AI 使用声明'];
  let to = text.length;
  for (const m of endMarkers) {
    const i = text.indexOf(m, from);
    if (i >= 0 && i < to) to = i;
  }
  target = text.slice(from, to);
}

const count = countHan(target);   // v18.0.3：走 _lib/han.mjs 真源（旧版在此内联 match）
console.log(JSON.stringify({
  file,
  scope: flag === '--full' ? 'full(全文纯汉字)' : 'body(正文区纯汉字: 摘要后~文末节前)',
  hanChars: count,
  ...degradedFields,
}, null, 2));
process.exit(0);
