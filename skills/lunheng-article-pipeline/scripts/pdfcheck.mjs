// 论衡 PDF 校验脚本（v2.5.2-dsh 补丁）：验证导出 PDF 有效（页/中文字体/图像嵌入）
// 用法：node pdfcheck.mjs <定稿.pdf>
// 配套：format-export.md「三-b 无 pandoc 环境降级路径」；原始字节直查 + FlateDecode 流解压双检
// 退出码（v18.0.5 拆开，第三方审计 P3）：0 有效｜1 结构异常（页数/字体/CIDFont 不足，**内容判定**）｜10 参数/路径错
//   —— 旧版参数错与结构异常同用 1，调用方无法区分「你没给对文件」与「PDF 本身不合格」。
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs';
installExitGuard();

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('用法: node pdfcheck.mjs <pdf>'); process.exit(10); }
// v18.12.0（全量审计 L-62）：**多余参数此前被静默忽略**（`pdfcheck a.pdf b.pdf --xyz` 全被丢掉）。
//   本脚本只接受 1 个位置参数，多余的与任何旗标一律报参数错（与全库「参数/路径错 = 10」同口径）。
const extra = process.argv.slice(3).filter((a) => a !== '');
if (extra.length) {
  console.error(`多余的参数: ${extra.join(' ')}（本脚本只接受 1 个位置参数：<pdf>）`);
  console.error('用法: node pdfcheck.mjs <pdf>');
  process.exit(10);
}
requireExistingFile(pdfPath, 'PDF 文件');   // 不存在/是目录/无权限 → 10
const buf = readFileSync(pdfPath);
const latin = buf.toString('latin1');

const counts = {
  // v18.16.0（A-3 反哺）：原 `/\/Page(?!s)/g` 仍会误匹配 `/PageMode`、`/PageLayout`、`/PageLabels` 等
  //   catalog 字典里的属性键（这些键的词法是 `/Page` 后跟非 `s` 字符，负向断言无法区分）。
  //   按 PDF spec：真实页对象必须声明 `/Type /Page`，故改为同时要求 `/Type` 前缀（与下方
  //   decompressedPageObjects 同源口径）。
  Page: (latin.match(/\/Type\s*\/Page(?!s)/g) || []).length,
  Font: (latin.match(/\/Font(?!s)/g) || []).length,
  ToUnicode: (latin.match(/ToUnicode/g) || []).length,
  CIDFont: (latin.match(/CIDFont/g) || []).length,
  Image: (latin.match(/\/Image/g) || []).length,
};
const eof = latin.trimEnd().endsWith('%%EOF');
const header = latin.slice(0, 8);

let streams = 0, inflated = 0, dec = '';
const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
let m;
while ((m = re.exec(latin)) !== null) {
  streams++;
  try { dec += inflateSync(Buffer.from(m[1], 'latin1')).toString('utf8'); inflated++; } catch {}
}
const decompressedPageObjects = (dec.match(/\/Type\s*\/Page[^s]/g) || []).length;

// ok 判定：多页 + 字体 + CIDFont（中文字体嵌入的核心证据）。
// ToUnicode/Image 仅统计展示，不参与判定（v2.5.2-dsh.3 审计修订：verdict 只声称实际校验的项）
const ok = header.startsWith('%PDF-') && eof && counts.Page >= 5 && counts.Font >= 1 && counts.CIDFont >= 1;
console.log(JSON.stringify({
  pdf: pdfPath,
  header, eof,
  rawCounts: counts,
  streams, inflated, decompressedPageObjects,
  verdict: ok ? `OK：有效 PDF（多页 ${counts.Page} + 中文字体嵌入 CIDFont ${counts.CIDFont}；ToUnicode ${counts.ToUnicode}、图像 ${counts.Image} 仅统计不判定）` : 'CHECK：结构异常（页数/字体/图像缺失）'
}, null, 2));
process.exit(ok ? 0 : 1);
