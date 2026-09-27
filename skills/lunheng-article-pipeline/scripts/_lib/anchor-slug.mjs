// 标题 → GitHub 锚点 slug 的唯一实现 + 锚点 → 字节区间解析（v18.22.2 CTX-3 抽为共享库）
//
// ── 为什么抽出来 ──────────────────────────────────────────────────────
// 同一件事此前有两处需求：
//   · **规则 ㉗（全库锚点覆盖）**要「把 .md 的锚点集转成 slug 集」再与链接里的锚点比；
//   · **`ref-get.mjs`（v18.22.2 CTX-3 新增）**要「按锚点定位到某一节的字节区间」。
// 两者若各写一份 slugify，就会出现本仓最反感的那类缺陷——**同一事实两处实现，谁也不知道谁先漂**。
// 故把 slugify + 锚点扫描 + 区间解析抽到这里，两处 `import` 同一份。
//
// ── slug 口径（与 GitHub 实测校准一致；不要「顺手优化」）────────────────
// 本机两个真实仓库交叉验证过：`## ☁️ Installation` ↔ `#-installation`；
// `## Usage & Billing` ↔ `#usage--billing`。三条规则：
//   ① 小写；
//   ② **只保留** 字母 / 数字 / 组合符 / 空格 / `-` / `_`（其余一律删，含 `.` `→` `（）—，`）；
//   ③ **每个空格转一个 `-`**（**不折叠、不裁剪**）——故 emoji 标题会得到**前导** `-`，
//      被删标点两侧的两个空格会得到 `--`。
// ⚠️ 第 ③ 条最容易被「看起来更干净」的写法改掉（把 `--` 折叠成 `-`、或 trim 掉前导 `-`）——
//   那会让 ㉗ 对真实文档产生**成批假红**，也让 ref-get 找不到真实存在的锚点。
//
// ── 两类锚点（**都必须支持，缺一即漏**）──────────────────────────────
//   · `via: 'heading'` —— ATX 标题的 slug（会自动变化：改标题就换锚点）；
//   · `via: 'explicit'` —— 显式 `<a id="…"></a>`（本仓**稳定锚点**机制，标题可自由改而不换锚点）。
// 实测教训（v18.22.2 落 CTX-3 时踩到）：`SKILL.md` 让读者读 `_shared/M-Gate-Algorithm.md#mgate`，
//   而 `#mgate` **不是任何标题的 slug**——它是该文件第 19 行的 `<a id="mgate"></a>`。
//   首版只扫标题 ⇒ ref-get 对文档里**正在使用的**锚点报「未命中」。故显式锚点是一等公民。

/** 标题文本 → GitHub 锚点 slug（见文件头三条口径）。 */
export function slugify(heading) {
  return String(heading).toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/ /g, '-');
}

/**
 * 扫出文档里全部锚点（ATX 标题的 slug + 显式 `<a id="…">`）——规则 ㉗ 用。
 * @param {string} text markdown 原文
 * @returns {Set<string>}
 */
export function anchorSlugsOf(text) {
  const slugs = new Set();
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) slugs.add(slugify(m[1]));
  for (const m of text.matchAll(/<a\s+id="([^"]+)"/g)) slugs.add(m[1]);
  return slugs;
}

/** 内部：扫标题行（含层级），供下方两处共用。 */
function headingLines(lines) {
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (m) heads.push({ level: m[1].length, heading: m[2], line: i });
  }
  return heads;
}

/**
 * 列出文档里全部**带字节区间**的锚点（标题锚点 + 显式锚点，按出现顺序）。
 *
 * 区间语义（两类统一）：从锚点行起，到**下一个同级或更高级的标题**前一行止；
 *   · 标题锚点：同级/更高级 = 相对该标题的 `level`（常规 markdown 嵌套）；
 *   · 显式锚点：取其**其后第一个标题**的层级为准（`<a id>` 通常贴在节首，故与「该节」同界）。
 * 字节数用 `Buffer.byteLength`（UTF-8 真字节）——本库的用途是「告诉模型这一节有多大」。
 * @param {string} text
 * @returns {Array<{slug: string, via: 'heading'|'explicit', level: number|null, heading: string,
 *   startLine: number, endLine: number, bytes: number, text: string}>}
 */
export function anchorsWithRanges(text) {
  const lines = text.split('\n');
  const heads = headingLines(lines);
  const slice = (a, b) => lines.slice(a, b + 1).join('\n');
  const out = [];

  // ① 标题锚点
  for (let k = 0; k < heads.length; k++) {
    const h = heads[k];
    let endLine = lines.length - 1;
    for (let j = k + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) { endLine = heads[j].line - 1; break; }
    }
    const chunk = slice(h.line, endLine);
    out.push({
      slug: slugify(h.heading), via: 'heading', level: h.level, heading: h.heading,
      startLine: h.line + 1, endLine: endLine + 1, bytes: Buffer.byteLength(chunk, 'utf8'), text: chunk,
    });
  }

  // ② 显式锚点
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/<a\s+id="([^"]+)"/g)) {
      const id = m[1];
      const nextIdx = heads.findIndex((h) => h.line >= i);
      let endLine = lines.length - 1;
      if (nextIdx >= 0) {
        const lvl = heads[nextIdx].level;
        for (let j = nextIdx + 1; j < heads.length; j++) {
          if (heads[j].level <= lvl) { endLine = heads[j].line - 1; break; }
        }
      }
      const chunk = slice(i, endLine);
      out.push({
        slug: id, via: 'explicit', level: null,
        heading: `（显式锚点 <a id="${id}">）`,
        startLine: i + 1, endLine: endLine + 1, bytes: Buffer.byteLength(chunk, 'utf8'), text: chunk,
      });
    }
  }
  return out.sort((a, b) => a.startLine - b.startLine || (a.via === 'heading' ? -1 : 1));
}

/**
 * 按锚点解析到**唯一**一个区间。
 * 命中顺序：① slug 精确相等（标题锚点优先于显式锚点——两者同名时以标题为准）；
 *   ② 若精确未命中且「slug 包含该串」的命中**唯一**，返回它（`via: 'contains'`）。
 * 未命中返回 `null`（调用方须**响亮失败**，绝不返回空节——空节会被读成「已读过」）。
 * @param {string} text
 * @param {string} anchor 允许带或不带前导 `#`
 */
export function resolveAnchor(text, anchor) {
  const want = String(anchor).replace(/^#/, '');
  const all = anchorsWithRanges(text);
  const exact = all.find((a) => a.slug === want && a.via === 'heading') || all.find((a) => a.slug === want);
  if (exact) return { ...exact, via: exact.via === 'heading' ? 'exact' : 'exact-explicit', total: all.length };
  const fuzzy = all.filter((a) => a.slug.includes(want));
  if (fuzzy.length === 1) return { ...fuzzy[0], via: 'contains', total: all.length };
  return null;
}
