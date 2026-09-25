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

  if (!/<svg[\s>]/i.test(raw)) problems.push('未找到 <svg> 根元素');
  if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(raw)) {
    warnings.push('缺少标准 xmlns="http://www.w3.org/2000/svg"（部分渲染器会拒绝渲染）');
  }
  const hasViewBox = /viewBox\s*=/i.test(raw);
  const hasWH = /\bwidth\s*=/i.test(raw) && /\bheight\s*=/i.test(raw);
  if (!hasViewBox && !hasWH) problems.push('既无 viewBox 也无 width/height → 缩放不可控（PDF 易溢出/塌陷）');
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
