// 论衡多格式导出降级路径（无 pandoc/LaTeX 环境）：Markdown → HTML（内嵌 SVG + 中文打印 CSS）
// 用法：node md2html.mjs <定稿.md> <输出.html> [<SVG 文件路径，可选：替换正文 [图1] 图位>]
// 配合：Chrome/Edge headless --print-to-pdf 生成 PDF（见 _shared/format-export.md 三-b）
import { readFileSync, writeFileSync } from 'node:fs';

const [, , mdPath, htmlPath, svgFile] = process.argv;
if (!mdPath || !htmlPath) {
  console.error('用法: node md2html.mjs <md> <html> [svgFile]');
  process.exit(1);
}

const md = readFileSync(mdPath, 'utf8');
const svg = svgFile ? readFileSync(svgFile, 'utf8') : null;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

const FIG = /^\[图1[:：][^\]]*\]\s*$/;
const lines = md.split(/\r?\n/);
let html = '';
let inList = false;
const closeList = () => { if (inList) { html += '</ul>\n'; inList = false; } };

for (const raw of lines) {
  const line = raw.trimEnd();
  if (FIG.test(line.trim())) {
    closeList();
    if (svg) {
      html += `<div class="figure">\n${svg}\n<div class="figcaption">图1（主控手写 SVG 内嵌）</div>\n</div>\n`;
    } else {
      html += `<p class="fig-missing">[图1]（SVG 未提供，未嵌入）</p>\n`;
    }
    continue;
  }
  if (/^### /.test(line)) { closeList(); html += `<h3>${inline(line.slice(4))}</h3>\n`; continue; }
  if (/^## /.test(line)) { closeList(); html += `<h2>${inline(line.slice(3))}</h2>\n`; continue; }
  if (/^# /.test(line)) { closeList(); html += `<h1>${inline(line.slice(2))}</h1>\n`; continue; }
  if (/^- /.test(line)) {
    if (!inList) { html += '<ul>\n'; inList = true; }
    html += `<li>${inline(line.slice(2))}</li>\n`;
    continue;
  }
  if (line.trim() === '') { closeList(); continue; }
  closeList();
  html += `<p>${inline(line)}</p>\n`;
}
closeList();

const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>论衡导出</title>
<style>
@page { size: A4; margin: 2.2cm 2cm; }
body { font-family: 'Microsoft YaHei','SimSun',serif; font-size: 12pt; line-height: 1.75; color: #111; margin: 0; }
h1 { font-size: 18pt; text-align: center; line-height: 1.45; margin: 0.3em 0 0.6em; }
h2 { font-size: 15pt; margin: 1.1em 0 0.4em; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
h3 { font-size: 13pt; margin: 0.9em 0 0.3em; }
p { margin: 0.45em 0; text-align: justify; }
ul { margin: 0.45em 0; padding-left: 1.5em; }
li { margin: 0.15em 0; }
.figure { text-align: center; margin: 1.2em 0; page-break-inside: avoid; }
.figure svg { width: 100%; height: auto; }
.figcaption { font-size: 10.5pt; color: #555; margin-top: 0.3em; text-align: center; }
.fig-missing { color: #b00; font-size: 10pt; }
</style>
</head>
<body>
${html}
</body>
</html>`;

writeFileSync(htmlPath, page, 'utf8');
console.log('HTML written: ' + htmlPath + ' (' + page.length + ' bytes)');
