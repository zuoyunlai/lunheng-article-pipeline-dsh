#!/usr/bin/env node
// 论衡字数统计脚本（v2.5.2-dsh.5 新增，v2.5.2-dsh.7 加 --summary）
// 用法：node count-chars.mjs <文件.md> [--full | --summary]
//   --full    = 统计全文纯汉字（含题名/摘要/文末五节）；默认只统计正文区（## 摘要 之后、## 参考文献 之前）
//   --summary = 关键节点分段字数 + 全文配比（T7/T8 一眼可见结构，省 LLM 读全文）
// 口径：纯中文字符数（Unicode 汉字 \u4e00-\u9fff），不含标点/数字/英文/引用编号
// 用途：写手写完即跑（替代 LLM 推理估算）；T7 G8 字数核验；T8 终检权威回填
import { readFileSync, existsSync } from 'node:fs';
import { HAN_RE as HAN } from './_lib/han.mjs';   // 汉字口径唯一真源（v2.5.2-dsh.13 抽 _lib）

const [, , file, flag] = process.argv;
if (!file) { console.error('用法: node count-chars.mjs <文件.md> [--full | --summary]'); process.exit(1); }
if (!existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(1); }

const text = readFileSync(file, 'utf8');

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
      sections[s] = (text.slice(start, end).match(HAN) || []).length;
    } else {
      sections[s] = 0;
    }
  }
  // 正文区 = 摘要之后到第一个文末节之前
  const bodyStart = text.indexOf('## 摘要');
  const bodyFrom = bodyStart >= 0 ? bodyStart + '## 摘要'.length : 0;
  // 找最近的文末节作为 body 终点
  let bodyEnd = text.length;
  for (const s of segs) {
    const i = text.indexOf(`## ${s}`, bodyFrom);
    if (i >= 0 && i < bodyEnd) bodyEnd = i;
  }
  const bodyCount = (text.slice(bodyFrom, bodyEnd).match(HAN) || []).length;
  const totalCount = (text.match(HAN) || []).length;
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
    const han = (text.slice(start, end).match(HAN) || []).length;
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
      avgPerSection: headingCounts.length > 0 ? Math.round(bodyCount / headingCounts.filter((s) => s.level === '##').length) : 0,
    },
  }, null, 2));
  process.exit(0);
}

let target = text;
let degraded = false;
if (flag !== '--full') {
  // 正文区：## 摘要 之后 到 ## 参考文献（或文末）之前
  // v2.5.2-dsh.13 修订（第三方审计 P1）：无「## 摘要」时旧版静默把起点退化为文件开头（口径前移、
  // 若文末节标记也缺失则等于全文），却仍自称 body(正文区) → 双口径坍缩、字数分级系统性偏大。
  // 现在：显式置 degraded 标记并在 stderr 告警，让 T7/T8 可机械识别。
  const start = text.indexOf('## 摘要');
  const from = start >= 0 ? start + '## 摘要'.length : 0;
  if (start < 0) {
    degraded = true;
    console.error(`⚠️ ${file}：未找到「## 摘要」，正文区起点退化为文件开头（口径已失真）——请补写摘要，或改用 --full 明确按全文统计`);
  }
  const endMarkers = ['## 参考文献', '## 数据来源', '## 案例来源', '## 先行者文献', '## AI 使用声明'];
  let to = text.length;
  for (const m of endMarkers) {
    const i = text.indexOf(m, from);
    if (i >= 0 && i < to) to = i;
  }
  target = text.slice(from, to);
}

const count = (target.match(HAN) || []).length;
console.log(JSON.stringify({
  file,
  scope: flag === '--full' ? 'full(全文纯汉字)' : 'body(正文区纯汉字: 摘要后~文末节前)',
  hanChars: count,
  ...(degraded ? { degraded: true, degradedReason: '缺「## 摘要」→ 正文区起点退化为文件开头' } : {}),
}, null, 2));
process.exit(0);
