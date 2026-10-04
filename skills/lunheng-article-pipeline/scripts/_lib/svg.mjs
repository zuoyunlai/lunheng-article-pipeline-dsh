// _lib/svg.mjs —— SVG 图件的结构校验 / 消毒 / 数字抽取（共享真源）
// 消费者（v2.5.2-dsh.16 起）：
//   · scripts/md2html.mjs      —— 导出前校验 + 消毒 + 按图号配图
//   · scripts/m-gate-check.mjs —— M-Form-9 图件闭环（良构 / 安全 / 图上数字 ⊆ 数据卡）
// 设计口径：**不引入任何 XML 依赖**（本包零依赖），用「标签栈配平 + 特征扫描」做结构判定；
//   判定宁松勿误伤——结构性缺失（未闭合/无根/无 viewBox）算 problem，可剥离去险的算 warning。
import { maskFences } from './sections.mjs'   // 围栏遮罩真源（v18.12.0 L-70：图位识别需围栏感知）

/** 可剥离去险的注入载体（消毒目标；与告警一一对应） */
const DANGEROUS = [
  [/<script[\s\S]*?<\/script>/gi, '含 <script> 块（已剥离）'],
  [/<script[^>]*\/?>/gi, '含 <script> 标签（已剥离）'],
  [/<foreignObject[\s\S]*?<\/foreignObject>/gi, '含 <foreignObject> 块（已剥离）'],
  [/<foreignObject[^>]*\/?>/gi, '含 <foreignObject> 标签（已剥离）'],
  [/<iframe[\s\S]*?<\/iframe>/gi, '含 <iframe> 块（已剥离）'],
  [/\son\w+\s*=\s*"[^"]*"/gi, '含事件属性 on*（已剥离）'],
  [/\son\w+\s*=\s*'[^']*'/gi, '含事件属性 on*（已剥离）'],
  // v18.0.5（第三方审计 P2-9）：**未加引号**的事件属性此前既不剥离也不告警——`onload=alert(1)`、
  //   `<rect onclick=alert(x)/>` 会被 md2html 原样写进导出 HTML（打开即执行），而文档声称 on* 一律剥离。
  //   必须放在有引号的两条**之后**，避免把 `onload="x"` 的引号内容截断。
  [/\son\w+\s*=\s*[^"'\s>]+/gi, '含事件属性 on*（未加引号，已剥离）'],
  [/javascript:/gi, '含 javascript: 协议（已剥离）'],
  // v18.12.0（L-72）：`<style>` 此前**不在** DANGEROUS 里 —— 于是 `<style>@import url(https://evil/x.css)</style>`
  //   能通过 sanitize 且**零告警**；导出 HTML 一旦被打开，样式表按 `@import` 外发（构成外发 + 离线渲染
  //   可能挂掉），而本包对「外部资源引用」的既有口径是「必须告警」（见 analyzeSvg 的 href 检查）。
  //   处置取**剥离 + 告警**（而非仅告警）：本仓图件由主控手写、样式一律走元素属性或 `<svg>` 内联
  //   属性，`<style>` 块不是本包支持的形态；剥离比放行安全，且留痕可见。
  [/<style[\s\S]*?<\/style>/gi, '含 <style> 块（可经 @import 外发样式表，已剥离）'],
  [/<style[^>]*\/?>/gi, '含 <style> 标签（已剥离）'],
];

/** 消毒：剥离注入载体（返回 { text, warnings }）——剥离动作必须留痕，不静默 */
export function sanitizeSvg(src) {
  let text = String(src || '');
  const warnings = [];
  for (const [re, msg] of DANGEROUS) {
    if (re.test(text)) {
      warnings.push(msg);
      re.lastIndex = 0;
      text = text.replace(re, '');
    }
    re.lastIndex = 0;
  }
  return { text, warnings };
}

/** 标签栈配平：返回未闭合 / 不匹配的标签清单（忽略注释、CDATA、PI、DOCTYPE） */
function tagBalance(src) {
  const problems = [];
  const skip = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/gi;
  const cleaned = String(src || '').replace(skip, ' ');
  const tagRe = /<\s*(\/?)\s*([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)\s*>/g;
  const stack = [];
  let m;
  while ((m = tagRe.exec(cleaned)) !== null) {
    const [, closing, name, , selfClose] = m;
    if (closing) {
      const top = stack.pop();
      if (top === undefined) problems.push(`多余的闭合标签 </${name}>`);
      else if (top.toLowerCase() !== name.toLowerCase()) problems.push(`标签未正确嵌套：<${top}> 被 </${name}> 关闭`);
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  if (stack.length) problems.push(`未闭合标签：<${stack.slice(-5).join('>, <')}>`);
  return problems;
}

/**
 * 结构 + 安全分析。
 * @returns {{ ok: boolean, problems: string[], warnings: string[], sanitized: string, bytes: number }}
 */
export function analyzeSvg(src) {
  const raw = String(src || '');
  const { text: sanitized, warnings } = sanitizeSvg(raw);
  const problems = [];

  // ── v18.38.0：三项结构判定收**根标签级**（此前是「全文级」）────────────────────────
  //   实测缺陷（v18.30.0 EFF-6 反向自证时撞到）：旧写法 `hasWH = /\bwidth\s*=/ && /\bheight\s*=/`
  //   是在**全文**里找 width=/height=，而任何图里都必然有 `<rect width=… height=…>` →
  //   「**根标签**既无 viewBox 也无 width/height」这种**真会渲染塌缩**的形态被判 `ok=true`。
  //   而本包**文档一直声称的就是根级**（`operations.md` §配图生成规范「必须含 `<svg xmlns=…>` 根 +
  //   `viewBox`（或 width/height）」、`audit-checklist-quickref.md` §图件核验、`format-export.md` 导出
  //   前置校验、`M-Gate-Algorithm.md` §M-Form-9 四处同口径）——即**代码落后于它自己的契约**，本批让代码追上。
  //   前置实测（2026-09-27 扫 `run/**` 全部 **75 张**现存图件）：根标签缺 viewBox 且缺宽高的 **0 张**、
  //   根标签缺 xmlns 的 **0 张** → 收紧**不牵连任何存量产物**。
  //   严重度**刻意不变**（viewBox/宽高 = problem、xmlns = warning），只是把判定对象从全文换成根标签。
  const rootTag = (raw.match(/<svg\b[^>]*>/i) || [])[0] || '';
  if (!rootTag) problems.push('未找到 <svg> 根元素');
  if (rootTag && !/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(rootTag)) {
    warnings.push('缺少标准 xmlns="http://www.w3.org/2000/svg"（部分渲染器会拒绝渲染）');
  }
  const hasViewBox = /viewBox\s*=/i.test(rootTag);
  const hasWH = /\bwidth\s*=/i.test(rootTag) && /\bheight\s*=/i.test(rootTag);
  if (rootTag && !hasViewBox && !hasWH) problems.push('既无 viewBox 也无 width/height → 缩放不可控（PDF 易溢出/塌陷）');
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(raw)) problems.push('含 DTD 内部子集 / ENTITY（XXE 风险，禁止）');
  if (/(?:xlink:href|href)\s*=\s*["']\s*(?:https?:)?\/\//i.test(raw)) {
    warnings.push('含外部资源引用（离线/PDF 渲染会失败，且构成外发）');
  }
  problems.push(...tagBalance(raw));

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    sanitized,
    bytes: Buffer.byteLength(raw, 'utf8'),
  };
}

/**
 * 抽取「可见文字」里的数字（<text>/<tspan>/<title> 文本节点）——用于与数据卡对账。
 * 不抽属性值（x/y/d/transform 都是坐标，会污染）。
 * @returns {Map<string, number>} 数字 token → 出现次数
 */
/**
 * v18.73.0（反哺报告-v7 F-17）：**声明式网格自检**。
 *
 * 只核「**标记数**」与「**坐标聚类数**」，**不需要知道中心坐标**——因为 `data-grid` 也只给行列数。
 *
 * **病灶（本项立法理由）**：本项目图 3（矩阵图）有 **6 个标记不落列中心 + 1 个多余标记**，
 *   而它**通过了当时的全部机检**（`M-Form-9` 只核图位/图件/图上数字），是主控借 PNG 目视才发现的。
 *
 * **为什么必须"可选"**：**不声明 `data-grid` 一律返回 `null`、一律不检**——概念图/流程图本无网格，
 *   强制检会大面积误报，**而一个会误报的新门比没有门更糟**（同批 F-9 的教训）。
 *
 * **判据**：矩阵图里，标记的 **x 坐标应恰好聚成 `cols` 个离散值**（每列一个中心），
 *   **y 聚成 `rows` 个**。多于该数即说明有标记**不落在行列中心**（错位）；
 *   标记总数 ≠ `rows×cols` 即说明**多标或少标**。
 *
 * @returns {null | { rows:number, cols:number, markers:number, problems:string[], notes:string[] }}
 *   未声明 `data-grid` → `null`（调用方据此**跳过**，不得当成通过或失败）。
 */
export function checkGrid(src) {
  const s = String(src || '');
  const m = /data-grid\s*=\s*["']\s*rows\s*=\s*(\d+)\s*[;,]\s*cols\s*=\s*(\d+)\s*["']/i.exec(s);
  if (!m) return null;
  const rows = Number(m[1]);
  const cols = Number(m[2]);
  const problems = [];
  const notes = [];
  // 标记 = 内容为**单个标记字符**的 <text>（● ○ ◎ ◉ △ ▲ ■ □ ★ ☆ × ✕）
  const MARK_CHARS = '●○◎◉△▲■□★☆×✕⊙◯';
  const xs = [];
  const ys = [];
  let count = 0;
  for (const t of s.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const body = t[2].replace(/<[^>]*>/g, '').trim();
    if (body.length !== 1 || !MARK_CHARS.includes(body)) continue;
    const x = /\bx\s*=\s*["']([-\d.]+)["']/.exec(t[1]);
    const y = /\by\s*=\s*["']([-\d.]+)["']/.exec(t[1]);
    if (!x || !y) continue;
    count += 1;
    xs.push(Number(x[1]));
    ys.push(Number(y[1]));
  }
  if (count === 0) {
    notes.push('已声明 data-grid，但未找到标记元素（内容为单个 ●/○/■ 等字符的 <text>）——本项无从核验');
    return { rows, cols, markers: 0, problems, notes };
  }
  const expect = rows * cols;
  if (count !== expect) {
    problems.push(`标记数 ${count} ≠ rows×cols = ${rows}×${cols} = ${expect}（多标或少标）`);
  }
  const distinct = (arr) => new Set(arr.map((v) => Math.round(v))).size;
  const cx = distinct(xs);
  const cy = distinct(ys);
  // 容差：允许 1 个离散值的偏差（图形可能有图例/边注标记）。超过则判错位。
  if (cx > cols) {
    problems.push(`标记的 x 坐标有 ${cx} 个离散值 > cols ${cols}——**有标记不落在列中心**（每列应只有一个中心 x）`);
  }
  if (cy > rows) {
    problems.push(`标记的 y 坐标有 ${cy} 个离散值 > rows ${rows}——**有标记不落在行中心**`);
  }
  if (cx < cols) notes.push(`标记的 x 只有 ${cx} 个离散值，少于 cols ${cols}——该列可能整列无标记（本项按软提示报出，不判错）`);
  if (cy < rows) notes.push(`标记的 y 只有 ${cy} 个离散值，少于 rows ${rows}——该行可能整行无标记（本项按软提示报出，不判错）`);
  return { rows, cols, markers: count, problems, notes };
}

export function svgTextNumbers(src) {
  const out = new Map();
  const blocks = String(src || '').matchAll(/<(?:text|tspan|title)\b[^>]*>([\s\S]*?)<\/(?:text|tspan|title)>/gi);
  for (const b of blocks) {
    const plain = b[1].replace(/<[^>]*>/g, ' ');
    for (const n of plain.matchAll(/\d+(?:[.,]\d+)*/g)) {
      const tok = n[0];
      out.set(tok, (out.get(tok) || 0) + 1);
    }
  }
  return out;
}

/** 图件文件名 → 图号（`图1_x.svg` / `图1-x.svg` / `图1.svg` 均可）；非图件返回 null */
export function figureNoOf(filename) {
  const m = String(filename).match(/^图\s*(\d+)\s*(?:[_\-.].*)?\.svg$/i);
  return m ? Number(m[1]) : null;
}

/** 正文中的图位号（`[图3：标题]`，全/半角冒号皆可；行内与独占一行都识别）
 *
 *  v18.12.0（L-70）：**围栏感知**——旧版扫全文，围栏内示例代码里的 `[图9：…]` 会被计入
 *  「正文引用的图号」。两处后果都是静默的：① `md2html --fig-dir` 会把图 9 当真实图位去配图
 *  （导出件里凭空多一张图、且示例代码被替换成图片）；② 反向地，示例里的图号会让真图件目录里
 *  对应的 `图9_x.svg` 不被判为孤儿图件——而 M-Form-9 的孤儿判定正是靠这个集合。
 *  遮罩用 `sections.mjs` 的 `maskFences`（**逐字节等长**：非换行字符换等长空格），故偏移不变、
 *  正则行为与原实现一致，只是围栏内的方括号不再匹配。 */
export function figurePlaceholders(text) {
  const nums = new Set();
  for (const m of maskFences(String(text || '')).matchAll(/\[图\s*(\d+)\s*[:：][^\]]*\]/g)) nums.add(Number(m[1]));
  return nums;
}
