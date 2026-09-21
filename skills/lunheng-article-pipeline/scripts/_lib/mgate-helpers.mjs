// m-gate-check 定位与解析共用助手（v18.3.0 抽离，第三方审计 B2 部分）
//
// 这些是**纯函数 / 常量**（无共享状态、无副作用），从 2270 行的 m-gate-check.mjs 巨石里抽到本文件，
// 减少单文件体积、便于复用。**行为逐字等价**：重构前后由 `run/_mgate-baseline.mjs`（真实项目
// exit + stdout 哈希 + --report JSON 哈希）对账。
//
// 依赖共享状态（projectRoot / auditsDirOf / findCard / evidenceLayout）的函数**仍留在 m-gate-check**——
// 它们读 draftPath/evDir 等模块级 let，抽出会破坏其作用域，留待「按门拆模块」专项一起收敛。
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** 正则元字符转义：prefix 含 `.`/`(` 等时入正则不失配（v18.2.9 审计 C 项）。 */
export const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 最新版本化报告：`<前缀>-vN.md` 取 N 最大（N 真源 = 文件名版本号，与 M-Gate-Algorithm §M-Integrity-2 同口径）。 */
export const latestReport = (dir, prefix) => {
  if (!dir || !existsSync(dir)) return null;   // 目录可能在也可能不在（如 analysis/ 尚未创建）→ 一律记 null，不抛
  const cands = readdirSync(dir)
    .map((f) => ({ f, m: f.match(new RegExp(`^${escapeRegExp(prefix)}-v(\\d+)\\.md$`)) }))
    .filter((x) => x.m).map((x) => ({ f: x.f, n: Number(x.m[1]) }))
    .sort((a, b) => b.n - a.n);
  return cands.length ? { path: join(dir, cands[0].f), n: cands[0].n, name: cands[0].f } : null;
};

/** markdown 表格保护符（保护「转义竖线 \|」与「行内代码块内的竖线」不被裸 split 切错）。 */
export const PROTECT_CH = '\u0001'

/** markdown 表格行切单元格。`protect: true` 先保护竖线；行尾无 `|` 时不丢末列（v18.2.6 修）。 */
export const tableCells = (line, { protect = false } = {}) => {
  // v18.2.9（审计轻微）：输入行本身含 U+0001 时，保护符会与真实字符撞车 → 退化为不保护切分，防列错乱/竖线注入
  const effectiveProtect = protect && !line.includes(PROTECT_CH);
  const src = effectiveProtect
    ? line.replace(/\\\|/g, PROTECT_CH).replace(/`[^`]*`/g, (mm) => mm.replace(/\|/g, PROTECT_CH))
    : line;
  const trimmed = src.replace(/\s+$/, '');
  const hasTrailingPipe = trimmed.endsWith('|');
  const cells = trimmed.split('|');
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (hasTrailingPipe && cells.length > 0) cells.pop();
  return cells.map((c) => c.trim().replace(new RegExp(PROTECT_CH, 'g'), '|'));
};

/** markdown 表格分隔行（`|---|` / `|:---:|`）。 */
export const isSeparatorRow = (cells) => cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '');

/** 段体范围：标题行之后的段体，边界为下一个标题（默认 `^##`）。 */
export const sectionRange = (lines, start, boundary = /^##\s/) => {
  let end = lines.findIndex((l, i) => i > start && boundary.test(l));
  if (end === -1) end = lines.length;
  return { start, end, body: lines.slice(start + 1, end) };
};

/** 「## 📇 索引段」段体（无该标题 → null）。 */
export const indexSection = (lines) => {
  const start = lines.findIndex((l) => /^##\s*📇\s*索引段/.test(l));
  return start === -1 ? null : sectionRange(lines, start);
};

/** 卡片路径规格（扁平名 → 项目内相对路径），三张卡 + 先行者清单。 */
export const CARD_SPECS = [
  ['文献卡.md', 'literature/文献卡.md'],
  ['数据卡.md', 'data/数据卡.md'],
  ['案例卡.md', 'cases/案例卡.md'],
  ['先行者清单.md', 'literature/先行者清单.md'],
];

/** 卡片正文条目编号（`### [L01] 主题` 形态）。 */
export const ENTRY_ID_RE = /^#{2,4}\s*\[([LDC])(\d+)\]/gm
export const entryIds = (cardText) => new Set([...cardText.matchAll(ENTRY_ID_RE)].map((m) => `[${m[1]}${m[2]}]`));

/** 同 entryIds 但编号形态可配（M-Form-11 需纳入基线 `[D-基-x-NN]` 与先行者 `[先NN]`）。 */
export const idsByToken = (cardText, token) =>
  new Set([...cardText.matchAll(new RegExp(`^#{2,4}\\s*\\[(${token})\\]`, 'gm'))].map((m) => `[${m[1]}]`));

/** 递归列出目录内 .md（供 M-Exist-2 统计证据包）。 */
export const walkMd = (dir) => {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
};
