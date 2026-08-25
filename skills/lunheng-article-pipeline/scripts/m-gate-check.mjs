// 论衡 M-Form 机械化预检脚本（v2.5.2-dsh 补丁）：M-Form-1/3/5/7 + M-Exist-2 纯正则/哈希判定，零 LLM
// 用法：node m-gate-check.mjs <final/定稿.md> <final/证据包目录>
// 配套：M-Gate-Algorithm.md「机械化脚本化」段；T8 只判 M-Form-8（三角验证）+ 复核本脚本结果
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [, , draftPath, evDir] = process.argv;
if (!draftPath || !evDir) {
  console.error('用法: node m-gate-check.mjs <定稿.md> <证据包目录>');
  process.exit(1);
}

const text = readFileSync(draftPath, 'utf8');
const results = [];

// 文末四节标记（M-Form-2 顺带）
const ENDNOTE_MARKERS = ['## 参考文献', '## 数据来源', '## 案例来源', '## 先行者文献', '## AI 使用声明'];
const firstEnd = ENDNOTE_MARKERS.map((m) => text.indexOf(m)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
const body = firstEnd >= 0 ? text.slice(0, firstEnd) : text;
const endnote = firstEnd >= 0 ? text.slice(firstEnd) : '';

const refRe = /\[(L|D|C|先)\d+\]/g;

// M-Form-1 引用标注完整性
const bodyRefs = body.match(refRe) || [];
results.push({ gate: 'M-Form-1 引用标注完整性', pass: bodyRefs.length > 0, detail: `正文引用 ${bodyRefs.length} 处` });

// M-Form-3 临时编号残留（正文有但文末无 = 孤儿）
const endRefs = new Set(endnote.match(refRe) || []);
const orphan = [...new Set(bodyRefs)].filter((r) => !endRefs.has(r));
results.push({ gate: 'M-Form-3 临时编号残留', pass: orphan.length === 0, detail: orphan.length ? `孤儿编号: ${orphan.join(',')}` : '无孤儿' });

// M-Form-5 过程语言残留
const banned = /v\d+ 稿|初稿|草稿|修订说明|上一版|下一版|据行业经验估算/g;
const hits = body.match(banned) || [];
results.push({ gate: 'M-Form-5 过程语言残留', pass: hits.length === 0, detail: hits.length ? `命中: ${[...new Set(hits)].join(',')}` : '零命中' });

// M-Form-7 文末节标题白名单
const WHITELIST = ['参考文献', '数据来源', '案例来源', '先行者文献', 'AI 使用声明'];
const h2s = [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
const firstIdx = h2s.findIndex((t) => WHITELIST.some((w) => t === w || t.startsWith(w)));
let violations = [];
if (firstIdx === -1) violations = ['文末无任何白名单节'];
else violations = h2s.slice(firstIdx).filter((t) => !WHITELIST.some((w) => t === w || t.startsWith(w)));
results.push({ gate: 'M-Form-7 文末白名单', pass: violations.length === 0, detail: violations.length ? `违规节: ${violations.join(',')}` : '全白名单' });

// M-Exist-2 证据包完整性（文件存在 + 非空）
const files = readdirSync(evDir).filter((f) => f.endsWith('.md')).map((f) => join(evDir, f));
const empty = files.filter((f) => statSync(f).size === 0);
results.push({
  gate: 'M-Exist-2 证据包完整性',
  pass: files.length > 0 && empty.length === 0,
  detail: `${files.length} 个 .md 文件` + (empty.length ? `，空文件: ${empty.map((f) => f.split(/[\\/]/).pop()).join(',')}` : '，均非空'),
});

const fail = results.filter((r) => !r.pass);
console.log(JSON.stringify({ draft: draftPath, date: new Date().toISOString().slice(0, 10), results, exit: fail.length ? 1 : 0 }, null, 2));
process.exit(fail.length ? 1 : 0);
