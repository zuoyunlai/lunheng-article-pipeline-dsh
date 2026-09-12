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
requireExistingFile(pdfPath, 'PDF 文件');   // 不存在/是目录/无权限 → 10
const buf = readFileSync(pdfPath);
const latin = buf.toString('latin1');

const counts = {
  Page: (latin.match(/\/Page/g) || []).length,
  Font: (latin.match(/\/Font/g) || []).length,
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
