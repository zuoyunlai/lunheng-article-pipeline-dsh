// figure-reconcile.mjs — 「图位 ↔ 图件」对账（**唯一实现**）
// 版本：v19.1.8（论衡 v19.1.8 · 解析与图件批）
//
// 为什么单独成库：同一件事有**两个消费者**——`run-report.mjs`（HTML 看板 + JSON 边车）与
//   `lib/panel.mjs`（运行面板「交付件与图件」卡）。若各写一份正则必然发散（本仓被审计反复
//   抓到的「同一事实两处维护」缺陷）。故**只有这一份**，两边都 import 它。
//
// 口径（全部读自既有产物，**不新增留痕义务**）：
//   · **图位** = `final/定稿.md` 正文声明的插图位。四种**实测存在**的写法都认：
//       ① 独占行     `[图N：标题]`
//       ② 图片语法   `![图N：标题](路径)`
//       ③ 全角括号行 `（图 N　标题…，图件见 …/图N-…svg）`
//       ④ 双写       ①②同现 → 按编号去重，只算一个图位（既有项目普遍双写）
//     `[图0：…]` 照常计数（既有项目用它标**主形象图**）。
//   · **图件** = `final/图件/` 下的 `.svg / .png / .jpg / .jpeg`。**PNG 是一等公民**：
//     本机 cairo 系统库缺失、SVG→PNG 渲染链路不可用（见 MEMORY「图件工具怪癖」），
//     Pillow 直出 PNG 是既定工作流——**只认 `.svg` 会把「图已生成」误报成「无图」**
//     （实测：`cn-llm-inference-cost-econ` 6 张 PNG 齐备却被误判为缺图）。
//   · **配对** = 图件文件名里的 `图N` ↔ 图位编号。无编号的（封面 / 附录）单列 `extras`，
//     **不计缺口**——它们不是正文插图。
//   · **无图理由** = `final/交付说明.md` 的「图件」行 / 段（其次 `status.md`）——复用既有产物，
//     **不新造约定文件**（既有项目已把理由写在交付说明里，如「本题体例 0 图，合规」）。
//
// 边界（如实声明，不假装）：
//   · 只做**文本与文件名的机械对账**，不判断图件内容是否正确、数值是否与正文一致
//     ——那是 M-Form-9 与人工复核的事。
//   · 图位识别靠正则，**召回率不是 100%**：未收录的写法会漏（漏 = 少算图位，方向是保守的）。
//   · 「无图理由」取到的是**项目自己的说法**，本库不核验该理由是否成立。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** 认作图件的扩展名（PNG 与 SVG 同权）。 */
const FIG_EXT = /\.(svg|png|jpe?g)$/i;
/** 「说明里写了没有图」的措辞特征（用于把「已登记理由」与「空着没说」分开）。 */
const NO_FIG_RE = /无|不存在|N\/A|N／A|0\s*图|未产图位|未设图位|未启用配图|未拍板|不需要|不适用/;
/** 「简报里定了要图」的措辞特征——要图却一张没落，是**真缺口**，不是「本就不需要」。 */
const WANT_FIG_RE = /要图|启用配图|刻意要图|至少\s*\d+\s*张|\d+\s*[-–~]\s*\d+\s*张|数据图表|概念关系图|封面视觉/;

function readText(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}
function listDir(p) {
  try { return readdirSync(p); } catch { return []; }
}
/** 把说明文字清成可展示的一句（去 markdown 装饰 / 去列表符号 / 压空白 / 截断）。 */
function clean(s) {
  return String(s || '')
    .replace(/[*`_>]/g, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * 解析正文图位（四种写法的唯一入口）。
 * @param markdown `final/定稿.md` 全文（可为 null）。
 * @returns `[{ n, title, style }]`，按 `n` 升序、同编号去重（保留标题更全的一条）。
 */
export function parseFigureSlots(markdown) {
  /** @type {Map<number, {n:number,title:string,style:string}>} */
  const slots = new Map();
  if (!markdown) return [];
  const add = (rawN, rawTitle, style) => {
    const n = Number(rawN);
    const title = String(rawTitle || '').trim();
    if (!Number.isFinite(n)) return;
    // **标题为空不算图位**：避免把正文里 `见[图3]的讨论` 这类**指代**误认成新图位
    if (!title) return;
    const cur = slots.get(n);
    if (!cur || title.length > cur.title.length) slots.set(n, { n, title, style });
  };

  for (const raw of String(markdown).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // ② 图片语法：![图N：标题](路径)
    for (const m of line.matchAll(/!\[图\s*(\d+)\s*[：:　]?\s*([^\]]*)\]\([^)]*\)/g)) add(m[1], m[2], 'image');
    // ① 独占行 / 清单项：[图N：标题]
    for (const m of line.matchAll(/\[图\s*(\d+)\s*[：:　]\s*([^\]]*)\]/g)) add(m[1], m[2], 'bracket');
    // ③ 全角括号独占行：（图 N　标题…，图件见 …/图N-…svg）
    //   **贪婪 + 只剥最外层括号**：标题里常嵌括号（「教师周工时对比（口径差异标注）」），
    //   非贪婪会在第一个 `）` 就截断，导致整行匹配失败（实测漏掉 3 个图位）。
    const p = /^[（(]\s*图\s*(\d+)\s*[：:　\s]\s*(.+)[）)]\s*$/.exec(line);
    if (p) add(p[1], p[2].split(/[，,]/)[0], 'paren');
  }
  return [...slots.values()].sort((a, b) => a.n - b.n);
}

/**
 * 列出 `final/图件/` 下的图件（SVG / PNG / JPG 同权），并解析文件名里的 `图N` 编号。
 * @returns `{ dir, dirExists, files }`
 */
export function listFigureFiles(projectDir) {
  const dir = join(projectDir, 'final', '图件');
  const dirExists = existsSync(dir);
  const files = [];
  for (const name of listDir(dir)) {
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (!st.isFile() || !FIG_EXT.test(name)) continue;
    const m = /图\s*(\d+)/.exec(name);
    files.push({
      name,
      rel: 'final/图件/' + name,
      bytes: st.size,
      kb: Math.round(st.size / 102.4) / 10,
      mtime: st.mtimeMs,
      ext: (FIG_EXT.exec(name) || ['.'])[0].slice(1).toLowerCase(),
      n: m ? Number(m[1]) : null,
    });
  }
  files.sort((a, b) => ((a.n ?? 9999) - (b.n ?? 9999)) || a.name.localeCompare(b.name));
  return { dir, dirExists, files };
}

/**
 * 读「图件」的说明文字（无图理由的唯一入口）。
 * 优先级：`final/交付说明.md` → `status.md` → **`01-任务简报.md`**（Phase 0 的「配图意向」决策）。
 * 形态：表格行 / 项目符号 / 「图件清单」节首句 / 简报的配图行。
 * @returns `{ text, source, statesNoFigure, wants } | null`
 *   `wants`：`true` 简报/说明里定了要图（那么「一张都没有」是真缺口）/ `false` 明确不配图 / `null` 未表态。
 */
export function readFigureReason(projectDir) {
  const cands = [
    ['final/交付说明.md', readText(join(projectDir, 'final', '交付说明.md'))],
    ['status.md', readText(join(projectDir, 'status.md'))],
  ];
  const classify = (t) => {
    // 先取**决策词**（「配图/配图意向/图件」后紧跟的那个词，如 `无` / `要图`），再判正负。
    //   整句正则判会踩坑：`未启用配图` 里含 `启用配图`、`配图：无（…数据图表…）` 里含 `数据图表`，
    //   按整句判就会把「明确不配图」读成「要图」（实测两例假阳性）。
    const m = /(?:配图(?:意向|需求)?|图件)\s*[：:=]?\s*\**\s*([^\s（(，。；;、）)]{1,14})/.exec(t);
    if (m) {
      if (/无|否|不|关闭|未/.test(m[1])) return false;
      if (WANT_FIG_RE.test(m[1])) return true;
    }
    // 决策词取不到 / 看不出 → 整句兜底，**否定优先**（「写了不要」比「提到图表词」更明确）
    if (NO_FIG_RE.test(t)) return false;
    return WANT_FIG_RE.test(t) ? true : null;
  };
  const hit = (text, source) => {
    const t = clean(text);
    return t ? { text: t, source, statesNoFigure: NO_FIG_RE.test(t), wants: classify(t) } : null;
  };
  for (const [source, text] of cands) {
    if (!text) continue;
    // 形态①：表格行 `| 图件 | … |`
    for (const m of text.matchAll(/^\|[\s　]*图件[\s　]*\|([^|\n]*)\|/gm)) {
      const r = hit(m[1], source); if (r) return r;
    }
    // 形态②：项目符号 `- **图件**：…` / `- 图件：…`
    for (const m of text.matchAll(/^[-*]\s*(?:\*\*)?图件(?:\*\*)?\s*[：:]\s*([^\n]*)/gm)) {
      const r = hit(m[1], source); if (r) return r;
    }
    // 形态③：「图件清单」节里的首句（既有项目把理由写在这里）
    const sec = /^#{2,4}[^\n]*图件[^\n]*\n+([\s\S]{0,400})/m.exec(text);
    if (sec) {
      for (const ln of sec[1].split(/\r?\n/)) {
        if (!ln.trim()) continue;
        const r = hit(ln, source); if (r) return r;
        break;   // 只取该节首个非空行，避免把清单里的图名当理由
      }
    }
  }
  // 形态④：`01-任务简报.md` 的 Phase 0「配图意向 / 配图需求 / 配图」决策行
  //   **这是权威来源**：它记录的是「本来该不该有图」，与「实际产没产」是两件事；
  //   两者不一致（定了要图却一张没落）才是主人真正想知道的缺口。
  const brief = readText(join(projectDir, '01-任务简报.md'));
  if (brief) {
    for (const line of brief.split(/\r?\n/)) {
      if (!/[配图图件]/.test(line)) continue;
      if (!NO_FIG_RE.test(line) && !WANT_FIG_RE.test(line)) continue;
      const t = clean(line.replace(/^[-*>#\s]+/, '').replace(/^[\d一二三四五六七八九十]+[、.．]\s*/, ''));
      if (t) return { text: t, source: '01-任务简报.md', statesNoFigure: NO_FIG_RE.test(t), wants: classify(t) };
    }
  }
  return null;
}

/**
 * 从「交付说明」里读**显式绑定**（`…/图件/<文件名>.svg` — [图N]）。
 *
 * 为什么需要它：图件命名并非总带 `图N` 前缀（实测 `善行的制度成本` 的图件叫
 *   `2006-2026事件时间线.svg`，正文图位是 `[图1：2006-2026 扶老人被讹事件时间线]`）——
 *   只按文件名编号配对会把**已经交付**的图判成缺失。交付说明里项目自己写了绑定关系，采信它。
 * @returns `Map<number, string>`（图号 → 文件名）。
 */
export function readExplicitBindings(projectDir) {
  const map = new Map();
  const text = readText(join(projectDir, 'final', '交付说明.md'));
  if (!text) return map;
  for (const line of text.split(/\r?\n/)) {
    const file = /图件[\\/]([^`\s）)|]+\.(?:svg|png|jpe?g))/i.exec(line);
    if (!file) continue;
    // 同一行里出现多个图号（「图1、图2」）时逐个绑定到该文件只可能是错的 → 只认单图号行
    const nums = [...line.matchAll(/图\s*(\d+)/g)].map((m) => Number(m[1]));
    const uniq = [...new Set(nums)];
    if (uniq.length !== 1) continue;
    if (!map.has(uniq[0])) map.set(uniq[0], file[1]);
  }
  return map;
}

/**
 * 图位 ↔ 图件 全量对账。
 * @param projectDir 项目绝对目录。
 * @returns 对账结果；`status` ∈
 *   `ok`（图位齐）/ `missing`（有图位缺图）/ `orphan-files`（有图无位）/
 *   `intent-gap`（说明里定了要图却一张没落 —— **真缺口**）/
 *   `none-reasoned`（无图且已登记理由）/ `none-unreasoned`（**已交付**但无图又没写理由）/
 *   `pending`（未交付、尚未到配图阶段——不算缺口）。
 */
export function reconcileFigures(projectDir) {
  const slots = parseFigureSlots(readText(join(projectDir, 'final', '定稿.md')));
  const { dir, dirExists, files } = listFigureFiles(projectDir);
  const numbered = files.filter((f) => f.n !== null);
  const extras = files.filter((f) => f.n === null).map((f) => f.name);
  const bindings = readExplicitBindings(projectDir);
  const byName = new Map(files.map((f) => [f.name, f]));

  const have = new Set(numbered.map((f) => f.n));
  const want = new Set(slots.map((s) => s.n));
  const missing = [];
  for (const s of slots) {
    if (have.has(s.n)) continue;
    // 文件名没带编号时，回退到交付说明的显式绑定
    const bound = bindings.get(s.n);
    const f = bound ? byName.get(bound) : null;
    if (f) { s.boundAnyway = f.name; continue; }
    missing.push({ n: s.n, title: s.title });
  }
  // 被显式绑定「救回」的图件不再算孤儿
  const rescued = new Set(slots.map((s) => s.boundAnyway).filter(Boolean));
  const orphans = numbered.filter((f) => !want.has(f.n) && !rescued.has(f.name)).map((f) => f.name);
  const reason = readFigureReason(projectDir);
  // 「未交付」与「已交付但没理由」必须分开：跑到一半的项目天然还没配图（Phase 4.5 才配），
  //   把它算成「缺理由」= 制造假告警（流水线中段恒红，信号会被训练掉——与 run-report 的缺项分级同判据）。
  const delivered = existsSync(join(projectDir, 'final', '定稿.md'));

  // 判定顺序（每一档都对应一个**真实且可动作**的情形）：
  //   ① 正文有图位 → 只看图齐不齐；② 有图位无图 → 缺图；
  //   ③ 有图无位 → 图件没跟正文对账；④ 说明里定了**要图**却没图 → 真缺口（intent-gap）；
  //   ⑤ 说明里写明不要图 → 有理由的合规缺省；⑥ 已交付却没图又没说 → 理由缺；
  //   ⑦ 未交付 → 还没到配图阶段（不算缺口）。
  let status;
  if (slots.length > 0) status = missing.length ? 'missing' : 'ok';
  else if (numbered.length > 0) status = 'orphan-files';
  else if (reason && reason.wants === true) status = 'intent-gap';
  else if (reason) status = 'none-reasoned';
  else status = delivered ? 'none-unreasoned' : 'pending';

  return {
    dir: 'final/图件',
    dirExists,
    status,
    delivered,
    slots,
    files,
    missing,
    orphans,
    extras,
    bindings: [...bindings.entries()].map(([n, name]) => ({ n, name })),
    reason,
    totals: { slots: slots.length, files: files.length, numbered: numbered.length, extras: extras.length },
  };
}

/**
 * 一行中文结论（面板与 HTML 看板共用同一句，防止两处措辞发散）。
 * @param rec `reconcileFigures()` 的返回值。
 * @returns 人类可读的一行。
 */
export function figureSummaryLine(rec) {
  if (!rec) return '—';
  const { totals, missing, orphans, extras, reason } = rec;
  const head = '图位 ' + totals.slots + ' / 图件 ' + totals.numbered;
  // 非编号图（封面 / 附录）单独提一句——它们不是正文插图，但「有图」这一事实不能丢
  const extraNote = extras.length ? '（另有非正文图 ' + extras.length + ' 张）' : '';
  const rescued = (rec.slots || []).filter((s) => s.boundAnyway).length;
  const bindNote = rescued ? '（其中 ' + rescued + ' 张按交付说明绑定，文件名未带图号）' : '';
  switch (rec.status) {
    case 'ok':
      return head + ' ✓ 齐' + bindNote + extraNote;
    case 'missing':
      return head + ' —— ⚠ 缺 ' + missing.length + ' 张：' + missing.map((m) => '图' + m.n).join('、')
        + '（正文已声明图位但 final/图件 无对应文件）'
        + (reason ? '｜项目说明：' + reason.text : '');
    case 'orphan-files':
      return '正文无图位，但 final/图件 有 ' + totals.numbered + ' 张已编号图件'
        + (orphans.length ? '（' + orphans.join('、') + '）' : '') + ' —— 图件未与正文对账' + extraNote;
    case 'none-reasoned':
      return '无正文图位、无编号图件' + extraNote + ' —— 已登记理由：' + (reason ? reason.text : '（空）');
    case 'intent-gap':
      return '⚠ 说明里定了**要图**（' + (reason ? reason.source + '：' + reason.text : '—') + '），'
        + '但正文无图位、final/图件 无文件 —— 配图未落图（真缺口：要么补图，要么改登记为「不配图」并说明）';
    case 'pending':
      return '尚未到配图阶段（无 final/定稿.md；Phase 4.5 才配图）' + extraNote;
    default:
      return '无正文图位、无编号图件' + extraNote + ' —— ⚠ 交付说明未登记理由（须补：为何本项不配图）';
  }
}
