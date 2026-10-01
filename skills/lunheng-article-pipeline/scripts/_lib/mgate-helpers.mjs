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

/**
 * **按同号**取版本化报告（v18.52.0 反哺 F-BA）：`audits/审计报告-vN.md` ↔ `audits/复核报告-vN.md` 的
 *   **配对键是编号 N**，不是「最新」。
 *
 * 为什么需要它：旧口径把「最新复核报告」与「最新审计报告」**硬配对**，而 B 轨轮次之后「最新复核报告」的
 *   **验证对象**可能不是审计任务书——实测（QLT-5 题2 臂 B）：`复核报告-v2.md` 验证的是
 *   `analysis/批判报告-v2.md` §3.4 的关闭条件，于是 M-Exist-4 按字面判「复核报告 v2 未覆盖 10 个审计编号」
 *   = **判定字面成立、语义错位**（那 10 项的关闭真源是 `复核报告-v1.md`）。
 *
 * 边界：取不到同号时**不返回任何东西**（调用方退回 `latestReport`）——本函数只提供配对键，不做兜底选择，
 *   免得「同号优先」在实现里悄悄变成「同号或最新随便哪个」。
 */
export const reportByNumber = (dir, prefix, n) => {
  if (!dir || !existsSync(dir) || !Number.isInteger(n)) return null;
  const f = `${prefix}-v${n}.md`;
  return existsSync(join(dir, f)) ? { path: join(dir, f), n, name: f } : null;
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

/** 卡片正文条目编号（`### [L01] 主题` 形态）。
 *  v18.62.4（全量审计-v18.62.3 §8.3 #44）：**形态与本包其余消费点统一**（超集）。
 *    旧版只认 `[LDC]<n>` —— 于是 `[F01]`（文献卡 F 族）与 `[C-主01]`（主人洞察）在本入口**不被认得**，
 *    拿着它们去比「卡里有没有」就会被判**幽灵/孤儿**，而 `m-gate-check` 的同族正则**认**它们
 *    → **同一张卡在不同门里结论不同**。
 *    现 `[LDC]` / `F` / `C-主` / `先` / 基线 `D-基-<x>-<n>` / 可选 `-v<n>` 后缀一律纳入。
 *    为什么取**超集**而非收窄：这三个消费点的用途一致（枚举卡内条目编号），
 *    收窄会**新增假「孤儿/幽灵」**（把合法条目判成不存在），放宽只会少报幽灵。
 *    ⚠️ 捕获组语义保持 `m[1]`=标题标记、`m[2]`=种类、`m[3]`=序号
 *      （`[C-主01]` 归为 `C-主`+`01`，与旧行为对 `[C01]` 同形）。
 *    ⚠️ **标题式要求 `#{2,4}` 必须保留**（我第一版为顺带认 `[先NN]` 裸行而放宽成 `^(#{0,4})`，
 *      立刻被 M-Form-10 用例抓红：**索引段的列表行** `- [L03] …` 也被算成正文条目 →
 *      「头部声明 5 条 ≠ 正文条目 2 条」）。**裸行 `[先01] 标题 | …` 不归本函数管**——
 *      那是 `idsByToken` 的职责（其自己用 `#{0,4}` 且锚定行首，见下方注释）。**职责不混。** */
export const ENTRY_ID_RE = /^#{2,4}\s*\[(L|D|C|C-主|F|先)(\d+)(?:(?:-v| v)\d+)?\]/gm
//   ⚠️ 本正则**只有两个捕获组**（`#{2,4}` 不捕获）：`m[1]`=种类、`m[2]`=序号。
//   我第一版把捕获组序号写成了 `m[2]`/`m[3]` → 实测产出 `[01undefined]`（**全量套立刻红了两条**）。
//   判据：**改正则的捕获组个数时，必须同批改所有取 `m[i]` 的消费点**——`node --check` 查不出这个。
export const entryIds = (cardText) => new Set([...cardText.matchAll(ENTRY_ID_RE)].map((m) => `[${m[1]}${m[2]}]`));

/** 同 entryIds 但编号形态可配（M-Form-11 需纳入基线 `[D-基-x-NN]` 与先行者 `[先NN]`）。
 *  v18.8.x 反哺补丁（2026.09.22）：`#{2,4}` → `#{0,4}`——先行者清单的条目是**行首裸编号**
 *  `[先01] 标题 | 作者 | 年份 | URL`（模板即如此，非 `### [先01]` 标题形态），旧正则一条都
 *  扫不到 → M-Form-11 把清单里的 [先NN] 全判 ghost（假 P0）。锚定行首，表格行/句中引用不误伤。 */
export const idsByToken = (cardText, token) =>
  new Set([...cardText.matchAll(new RegExp(`^#{0,4}\\s*\\[(${token})\\]`, 'gm'))].map((m) => `[${m[1]}]`));

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
