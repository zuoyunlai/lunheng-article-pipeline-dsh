// 论衡字数统计脚本（v2.5.2-dsh.5 新增，测试轮反哺：T5 LLM 估算字数偏差 ~30%）
// 用法：node count-chars.mjs <文件.md> [--full]
//   --full  = 统计全文纯汉字（含题名/摘要/文末五节）；默认只统计正文区（## 摘要 之后、## 参考文献 之前）
// 口径：纯中文字符数（Unicode 汉字 \u4e00-\u9fff），不含标点/数字/英文/引用编号
// 用途：写手写完即跑（替代 LLM 推理估算）；T7 G8 字数核验；T8 终检权威回填
import { readFileSync, existsSync } from 'node:fs';

const [, , file, flag] = process.argv;
if (!file) { console.error('用法: node count-chars.mjs <文件.md> [--full]'); process.exit(1); }
if (!existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(1); }

const text = readFileSync(file, 'utf8');
const HAN = /[\u4e00-\u9fff]/g;

let target = text;
if (flag !== '--full') {
  // 正文区：## 摘要 之后 到 ## 参考文献（或文末）之前；无摘要则从首个 ## 标题开始
  const start = text.indexOf('## 摘要');
  const from = start >= 0 ? start + '## 摘要'.length : 0;
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
}, null, 2));
process.exit(0);
