// 论衡多格式导出降级路径（无 pandoc/LaTeX 环境）：Markdown → HTML（内嵌 SVG + 中文打印 CSS）
// 用法：
//   node md2html.mjs <定稿.md> <输出.html> [--fig-dir <final/图件>] [<单个 SVG 文件>] [--strict]
//   · --fig-dir <dir>：**按图号配图**（`图N_标题.svg` / `图N-标题.svg` / `图N.svg`）——多图文章的推荐用法
//   · 位置参数 <svgFile>：单图模式，**同一份 SVG 会嵌入每一个 [图N]**（向后兼容；多图请用 --fig-dir，会显式告警）
//   · --strict：任何告警（消毒剥离 / 外部引用 / **图位缺图** / 行内图位 / 单图复用）都视为失败（exit 2）
//     —— 缺图于 v18.2.6 审计修复（追加项 1）纳入告警通道：旧版缺图不计告警，`--strict` 仍 exit 0，
//     与 M 门 M-Form-9「缺图 = P0/P1」自相矛盾（同一条事实两个口径）。
//   · 结构不合格的 SVG（未闭合 / 无 <svg> 根 / 无 viewBox 且无宽高 / 含 DTD·ENTITY）→ **exit 2 拒绝导出**
// v2.5.2-dsh.16 修订（第三方 SVG 链路审计）：
//   ① 旧版只接受一个 SVG，且把同一份图嵌进每个 [图N] → 多图文章导出 PDF 会得到 N 张一样的图（静默错误）；
//   ② 旧版只认**独占一行**的 [图N：…]，写在段落里的图位被当纯文本输出，既不替换也不报错；
//   ③ 旧版对 SVG 合法性零校验，坏 SVG（未闭合/坏属性）原样嵌入，浏览器整块不渲染而无任何提示。
// v18.2.6 审计修复（第三方审计 v18.2.5 B-1，数据丢失 P0）：
//   同文件守卫由**字符串比较**改为「resolve + realpath + win32 去大小写」的归一口径，统一实现见
//   `_lib/destructive-write.mjs`——旧写法实测可被 `./a.md`、`A.md`、`final/../final/定稿.md`、8.3 短名绕过，
//   一旦绕过就会把**源 Markdown 覆盖成 HTML**（正文永久丢失、无 .bak）。写盘同步改走 `writeWithSafety`：
//   输出路径是用户给的，若它已存在（包括「误指到另一份正文」），先落一份带时间戳的 .bak 再写。
// 配合：Chrome/Edge headless --print-to-pdf 生成 PDF（见 _shared/format-export.md 三-b）
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { analyzeSvg, figureNoOf, figurePlaceholders } from './_lib/svg.mjs';
import { installExitGuard, requireExistingFile, requireExistingDir } from './_lib/exit-guard.mjs'; // 退出码硬化（v18.0.5）
import { assertNotSameFile, writeWithSafety, SAME_FILE_CODE } from './_lib/destructive-write.mjs'; // 破坏性写策略（v18.2.6）
installExitGuard();

const argv = process.argv.slice(2);
const figDirIdx = argv.indexOf('--fig-dir');
const figDir = figDirIdx >= 0 && argv[figDirIdx + 1] ? argv[figDirIdx + 1] : null;
// v18.0.5（第三方审计 P1-1/口径统一）：**参数与路径错一律 10**（与全库契约一致；退出码 2 保留给
//   「结构/图件异常」这类内容判定）。旧版这里全用 1，与「1 = P1 内容失败」撞义。
if (figDirIdx >= 0 && !figDir) { console.error('--fig-dir 缺少值'); process.exit(10); }
const strict = argv.includes('--strict');
const positional = argv.filter((a, i) => !a.startsWith('--') && !(figDirIdx >= 0 && i === figDirIdx + 1));
const mdPath = positional[0];
const htmlPath = positional[1];
let svgFile = positional[2] || null;

if (!mdPath || !htmlPath) {
  console.error('用法: node md2html.mjs <md> <html> [--fig-dir <图件目录>] [<svgFile>] [--strict]');
  process.exit(10);
}
requireExistingFile(mdPath, 'Markdown');                                    // 10（含「传目录」）
// v18.2.6 审计修复（B-1 数据丢失 P0）：旧守卫 `mdPath === htmlPath` 是**字符串比较**，不归一化路径 ——
//   实测 `md2html.mjs a.md ./a.md` → 守卫放行 → 末尾 writeFileSync 把**源 Markdown 覆盖成 HTML**
//   （正文永久丢失且无 .bak）；`A.md`（Windows 大小写）、`final/../final/定稿.md`、8.3 短名/软链接同理。
//   现统一走 _lib/destructive-write.mjs（resolve + realpath + win32 去大小写，全库唯一实现）。
//   退出码仍为 10（参数/路径错），报错文案保持原句式，仅追加可操作提示。
try {
  assertNotSameFile(mdPath, htmlPath);
} catch (e) {
  if (e && e.code === SAME_FILE_CODE) { console.error(e.message); process.exit(10); }
  throw e;   // 其他异常交 installExitGuard 归类（fs 类 10 / 内部 70）
}
if (svgFile) requireExistingFile(svgFile, 'SVG 文件');
if (figDir) requireExistingDir(figDir, '图件目录');
if (figDir && svgFile) { console.error('--fig-dir 与位置参数 <svgFile> 不能同时使用（前者按图号配图）'); process.exit(10); }

// v18.2.6 审计修复（追加项 2 / P2，UTF-8 BOM）：pwsh `Set-Content -Encoding UTF8` **默认写 BOM**（Windows 上常见输入），
//   而 `\uFEFF` 顶在首行会让 `/^# /` 不匹配 → `<h1>` 降级成 `<p>`、`#` 与 BOM 字面进 PDF，且 exit 0（静默）。
//   读取后统一剥 BOM + 给一条可见提示；**不改退出码**（BOM 是编码卫生问题，不是内容失败——口径与 count-chars.mjs 一致）。
const rawMd = readFileSync(mdPath, 'utf8');
const hasBom = rawMd.charCodeAt(0) === 0xfeff;
if (hasBom) {
  console.error(`⚠️ ${basename(mdPath)}: 含 UTF-8 BOM（机检硬格式要求无 BOM），已剥离首字符后继续（不改退出码）`);
}
const md = hasBom ? rawMd.slice(1) : rawMd;

// ===== 图件库：按图号解析（--fig-dir）或单图复用（位置参数）=====
const warnings = [];
const svgCache = new Map();  // path -> analyzeSvg 结果
const loadSvg = (path) => {
  if (!svgCache.has(path)) {
    const a = analyzeSvg(readFileSync(path, 'utf8'));
    for (const w of a.warnings) warnings.push(`${basename(path)}: ${w}`);
    svgCache.set(path, a);
  }
  return svgCache.get(path);
};

const byNo = new Map();      // 图号 -> 文件路径
if (figDir) {
  for (const f of readdirSync(figDir).sort()) {
    const no = figureNoOf(f);
    if (no !== null && !byNo.has(no)) byNo.set(no, join(figDir, f));
  }
}

const placeholders = figurePlaceholders(md);
let reusedSingle = 0;
const svgFor = (no) => {
  if (figDir) return byNo.get(no) ? loadSvg(byNo.get(no)) : null;
  if (svgFile) { reusedSingle++; return loadSvg(svgFile); }
  return null;
};

// 结构不合格 → 拒绝导出（在渲染前一次性判定，避免产出半成品文件）
const structural = [];
if (figDir) {
  for (const [, p] of byNo) {
    const a = loadSvg(p);
    if (!a.ok) structural.push(`${basename(p)}: ${a.problems.join('；')}`);
  }
} else if (svgFile) {
  const a = loadSvg(svgFile);
  if (!a.ok) structural.push(`${basename(svgFile)}: ${a.problems.join('；')}`);
}
if (structural.length) {
  console.error('SVG 结构不合格，拒绝导出（exit 2）：');
  for (const s of structural) console.error('  - ' + s);
  console.error('  → 修好图件后重跑；结构判定口径见 scripts/_lib/svg.mjs（良构/根元素/viewBox/DTD）');
  process.exit(2);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const FIG_BLOCK = /^\[图(\d+)[:：][^\]]*\]\s*$/;
const FIG_INLINE = /\[图(\d+)[:：][^\]]*\]/g;
const FIG_INLINE_TEST = /\[图\d+[:：][^\]]*\]/;

const figureHtml = (svgText, no, caption) =>
  `<div class="figure">\n${svgText}\n${caption ? `<div class="figcaption">${caption}</div>\n` : ''}</div>\n`;
const expectedHint = (no) => figDir
  ? `（期望文件：${figDir.replace(/[\\/]$/, '')}/图${no}_标题.svg）`
  : '（未提供 SVG）';
const missingHtml = (no) => `<p class="fig-missing">[图${no}]${expectedHint(no)}</p>\n`;
const missingInlineHtml = (no) => `<span class="fig-missing">[图${no}]${expectedHint(no)}</span>`;

const lines = md.split(/\r?\n/);
let html = '';
let inList = false;
let inlineFigures = 0;
let embedded = 0;
let missing = 0;
const closeList = () => { if (inList) { html += '</ul>\n'; inList = false; } };

for (const raw of lines) {
  const line = raw.trimEnd();
  const blockMatch = line.trim().match(FIG_BLOCK);
  if (blockMatch) {
    closeList();
    const no = Number(blockMatch[1]);
    const a = svgFor(no);
    if (a) {
      embedded++;
      const srcName = figDir ? basename(byNo.get(no)) : basename(svgFile);
      html += figureHtml(a.sanitized, no, `图${no}（源：${srcName}）`);
    } else {
      missing++;
      html += missingHtml(no);
    }
    continue;
  }
  // 行内图位：段落里的 [图N：…] 也要替换（旧版当纯文本输出，静默丢图）
  // 注意：**只转义文本段**，插入的 SVG 必须原样输出（不能整体 esc，否则图变成代码文本）
  if (FIG_INLINE_TEST.test(line)) {
    let out = '';
    let last = 0;
    let m;
    FIG_INLINE.lastIndex = 0;
    while ((m = FIG_INLINE.exec(line)) !== null) {
      out += inline(line.slice(last, m.index));
      const no = Number(m[1]);
      const a = svgFor(no);
      inlineFigures++;
      if (!a) { missing++; out += missingInlineHtml(no); }
      else { embedded++; out += `<span class="figure-inline">${a.sanitized}</span>`; }
      last = m.index + m[0].length;
    }
    out += inline(line.slice(last));
    closeList();
    html += `<p>${out}</p>\n`;
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

if (inlineFigures > 0) warnings.push(`${inlineFigures} 处图位写在段落中（**行内图位**，已就地内联，无图注）——建议按规范独占一行（\`[图N：标题]\`），便于图注与分页控制`);
if (reusedSingle > 1) warnings.push(`单 SVG 模式：同一份 ${basename(svgFile)} 被嵌入 ${reusedSingle} 个图位（多图请用 --fig-dir <final/图件>，否则导出会是 N 张相同的图）`);
if (figDir && placeholders.size === 0) warnings.push('正文无 [图N] 图位，图件目录未被使用');
if (figDir && placeholders.size > 0) {
  const orphan = [...byNo.keys()].filter((n) => !placeholders.has(n));
  if (orphan.length) warnings.push(`图件目录中有未被正文引用的图号：${orphan.join(', ')}（孤儿图件）`);
}
// v18.2.6 审计修复（追加项 1 / P1-2）：**缺图此前不进告警通道** —— 实测「图位 1 ｜ 嵌入 0 ｜ 缺图 1 ｜ 告警 0」
//   的文档在 `--strict` 下仍 exit 0，HTML 里只留 `<p class="fig-missing">`；而本脚本头注释自称「任何告警
//   （消毒剥离 / 外部引用 / 行内图位 / 单图复用）都视为失败」，M 门 M-Form-9 又把缺图定为 P0/P1 —— 同一条事实
//   两个口径（同一份稿子：M 门判 P0/P1，导出器说"无告警"）。
//   现把缺图计入 warnings（占位元素保持不变，只是同时进告警通道）→ `--strict` 对缺图 exit 2；不加 --strict 时
//   仍 exit 0（只多一条可见告警），故图位齐全的正常路径行为**不变**。
if (missing > 0) {
  warnings.push(`${missing} 处 [图N] 图位缺图（已就地留占位 \`<p class="fig-missing">\`）——与 M 门 M-Form-9 口径对齐：缺图 = P0/P1，故按**告警级**上报（--strict 下即失败）`);
}
for (const w of warnings) console.error(`⚠️ ${w}`);
if (strict && warnings.length) {
  console.error(`--strict：存在 ${warnings.length} 条告警 → exit 2`);
  process.exit(2);
}

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
.figure-inline svg { max-width: 100%; height: auto; display: block; margin: 0.6em auto; }
.figcaption { font-size: 10.5pt; color: #555; margin-top: 0.3em; text-align: center; }
.fig-missing { color: #b00; font-size: 10pt; }
</style>
</head>
<body>
${html}
</body>
</html>`;

const out = Buffer.byteLength(page, 'utf8');
// v18.2.6：写盘走统一策略（_lib/destructive-write.mjs）——输出路径由调用方给出，可能误指到**另一个真实文件**
//   （如同目录的另一份正文）；只要目标已存在就先落带时间戳的 .bak 再覆盖，回滚点不靠记忆。
//   （同文件守卫已在参数段用 realpath 归一口径挡住，此处不再重复比较。）
const written = writeWithSafety(htmlPath, page);
console.log(`HTML written: ${htmlPath} (${out} bytes / 约 ${Math.round(out / 3)} 汉字)`);
if (written.backup) console.log(`⚠️ 目标已存在，已先备份: ${written.backup}`);
console.log(`图件：正文图位 ${placeholders.size} 个 ｜ 嵌入 ${embedded} ｜ 缺图 ${missing} ｜ 图件文件 ${byNo.size} 个 ｜ 告警 ${warnings.length}`);
