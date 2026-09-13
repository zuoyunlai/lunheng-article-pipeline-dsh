// 论衡 M 门机械化预检脚本（v2.5.2-dsh 补丁 + v2.5.2-dsh.5 重大增强 + v2.5.2-dsh.16 加图件闭环 + v2.5.2-dsh.17 加 4 项）
//   v2.5.2-dsh:   M-Form-1/3/5/7 + M-Exist-2 纯正则/哈希判定
//   v2.5.2-dsh.5: M 门全脚本化（T8 仅复核 M-Form-8 承重墙质量 + M-Integrity 跨文件判断）
//   v2.5.2-dsh.16: 新增 M-Form-9 图件闭环（[图N] ↔ final/图件/ ↔ 图上数字）
//   v17.0.0（端到端测试反哺）: 正文引用扫描前**剥离代码块/行内反引号**（论文里「被讨论的编号与占位符字面量」
  //                  不再被当作真实引用）；M-Form-8 承重墙锚点收紧；M-Exist-8/9/10 三处窄口径放宽
  //   v2.5.2-dsh.17: 新增 M-Form-10 索引段完整性 / M-Form-11 素材按需加载闭环 /
//                  M-Exist-4 审计条目闭环 / M-Exist-5 阶段闸门记录表 /
//                  M-Exist-6 审稿报告与期刊匹配 / M-Exist-7 交付说明字段齐备 /
//                  M-Exist-8 批判报告覆盖（C1-C7）/ M-Exist-9 审计报告 G 项覆盖；
//                  M-Form-8 增补「承重墙超载」机检 → M 门 22 项（脚本 21 项 + M-Integrity-2 主控）
// 用法: node m-gate-check.mjs <final/定稿.md> <final/证据包目录> [--summary] [--fig-dir <图件目录>] [--report <path>]
//   --summary：仅输出聚合统计（total/pass/p0/p1/p2/soft/skips）+ 硬失败项；省略通过项 details[]（省 ~80% 输出字节，机器可读友好）
//   --fig-dir：图件目录（缺省自动推 <定稿目录>/图件）
// 配套：M-Gate-Algorithm.md「机械化脚本化」段
// 严重度评级（v2.5.2-dsh.5 引入）：gate fail 时按 P0/P1/P2 分级；单子项失败子项数 ≤2 → P2 可放行
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refsOf, dataCardIds } from './_lib/refs.mjs';                 // 引用编号口径真源
import { TRUST_COMPLIANT_RE, TRUST_LOOSE_RE } from './_lib/trust.mjs'; // 信任级别口径真源
import { splitCard } from './_lib/cards.mjs';                          // 卡片切块口径真源
import { analyzeSvg, svgTextNumbers, figureNoOf, figurePlaceholders } from './_lib/svg.mjs'; // SVG 图件口径真源
import { installExitGuard, requireExistingFile, requireExistingDir } from './_lib/exit-guard.mjs'; // 退出码硬化（v18.0.5）
installExitGuard();   // 必须在任何 readFileSync 之前：fs 类异常 → 10，其余内部错误 → 70（避免与「1 = P1 内容失败」撞义）

// 本脚本自身所在目录（用于读取技能包内的真源，如闸门记录模板 / 期刊数据库；v2.5.2-dsh.17）
const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(scriptDir, '..');

const args = process.argv.slice(2);
const wantSummary = args.includes('--summary');
// --fig-dir <dir>：图件目录（缺省从定稿路径推 final/图件，v2.5.2-dsh.16 新增）
const figDirIdx = args.indexOf('--fig-dir');
const figDirArg = figDirIdx >= 0 && args[figDirIdx + 1] ? args[figDirIdx + 1] : null;
if (figDirIdx >= 0 && !figDirArg) { console.error('--fig-dir 缺少值'); process.exit(10); }
// --report <path>：把结构化报告落盘（供 build-evidence-bundle / T8 审计视图读取，v2.5.2-dsh.13 新增）
const reportIdx = args.indexOf('--report');
const reportPath = reportIdx >= 0 && args[reportIdx + 1] ? args[reportIdx + 1] : null;
// 只有当 --report 真出现时才排除它的取值（v2.5.2-dsh.13 修复：reportIdx=-1 时 reportIdx+1=0
// 会把第一个位置参数「定稿路径」也排除掉 → 不带 --report 时必然报用法错误；
// 而 final-check.mjs 正是不带 --report 调用本脚本）
const flagValueIdx = new Set([
  ...(reportIdx >= 0 ? [reportIdx + 1] : []),
  ...(figDirIdx >= 0 ? [figDirIdx + 1] : []),
]);
const positional = args.filter((a, i) => !a.startsWith('--') && !flagValueIdx.has(i));
const draftPath = positional[0];
const evDir = positional[1];
if (!draftPath || !evDir) {
  console.error('用法: node m-gate-check.mjs <定稿.md> <证据包目录> [--summary] [--report <path>]');
  process.exit(10);   // 10 = 参数/路径错误（与「1 = P1 内容失败」区分，v2.5.2-dsh.13）
}
if (!existsSync(draftPath)) {
  console.error(`定稿不存在: ${draftPath} —— 请先产出 final/定稿.md 再跑 M 门预检`);
  process.exit(10);   // v18.0.2 修：路径错误一律 10（旧版 1 与「P1 内容失败」撞码 → final-check 会误渲染成「存在 P1 残留，可触发 T5 修订」）
}
if (!existsSync(evDir)) {
  console.error(`证据包目录不存在: ${evDir} —— 请先收集证据包再跑 M 门预检`);
  process.exit(10);   // v18.0.2 修：同上
}
// v18.0.5 修（第三方审计 P1-1）：旧的 `existsSync` 只判「存在」——传目录/传错类型的路径会走到
//   `readFileSync` 才炸（EISDIR/ENOTDIR），未捕获异常 = exit 1 = 被读成「P1 内容失败」。现在前置判类型。
requireExistingFile(draftPath, '定稿');
requireExistingDir(evDir, '证据包目录');

// === 项目定位共用助手（v18.0.2：从 M-Integrity-1 段提到模块级，供 M-Form-9 复用）===
// 从给定目录向上查找首个含 `01-任务简报.md` 的目录——兼容 `final/定稿.md` 与 `drafts/初稿-vN.md`
//   两种被审场景。旧实现用 `draftPath.replace(/final[\\/]定稿\.md$/, …)`，对 drafts/ 不命中
//   → 把被审正文当简报读（M-Integrity-1 于 v18.0.0 已修，M-Form-9 的第二份拷贝于 v18.0.2 修）。
const findBriefUpward = (startDir) => {
  let d = startDir;
  for (let i = 0; i < 8; i++) {
    const p = join(d, '01-任务简报.md');
    if (existsSync(p)) return p;
    const parent = dirname(d);
    if (parent === d) break; // 已到文件系统根
    d = parent;
  }
  return null;
};
// === 证据包完整性前置提示（v18.0.0 新增；发布前修订为「告警不中止」）===
// 实战教训：主控首跑误传 `analysis/`（非证据包目录）→ 脚本继续执行并产出 **8 个假 P0**
//   （「数据卡.md 不在证据包」/「文献卡无对应条目」…），主控需逐项读 detail 文字推断哪些是路径造成的。
// ⚠️ 但**不能因此中止**（v18.0.0 发布前据随包回归用例修正）：
//   ① 本包契约是「缺卡记 N/A、0 条场景合法」（见 M-Form-10 用例「三张卡都没有 → N/A」）；
//   ② 证据包在 `build-evidence-bundle.mjs` 跑之前本就可能是空目录——中止会把「顺序没到」误报成「路径传错」；
//   ③ 中止（exit 10）会让调用方拿不到任何 JSON，`final-check.mjs` 与回归用例随之整体失效。
// 故改为：缺关键文件 → **stderr 显著告警 + 给出正确用法，然后继续正常出报告**；路径不存在才中止。
const EV_REQUIRED = ['数据卡.md', '文献卡.md'];
const evMissing = EV_REQUIRED.filter((f) => !existsSync(join(evDir, f)));
if (evMissing.length > 0) {
  console.error(
    `\n⚠ 证据包不完整：${evDir}\n` +
      `  缺少：${evMissing.join(' / ')}\n` +
      `  · 若这是**路径传错**（如误传 analysis/）→ 请改用 <final/证据包>；\n` +
      `  · 若证据包尚未生成 → 先跑 node scripts/build-evidence-bundle.mjs <run/项目名> --summary。\n` +
      `  （缺卡本身按契约记 N/A、不判失败，故本提示不中止；但引用类检查会因此报「无对应条目」，先确认路径再读结论）\n`,
  );
}

const text = readFileSync(draftPath, 'utf8');
// 被审正文指纹（v18.0.5 新增，第三方审计 P0-1）：T8 裁定必须**绑定它所审的那一版正文**，
//   否则旧裁定会在正文被改动后继续放行（实测：正文追加一段后机械 exit=2，落盘 exit 仍为 0，
//   审计视图同屏显示「P0: 2 ｜ exit: 0」，而该视图被 8 个角色当闸门真源读）。
//   指纹用**内容哈希 + 字节数**（不含 mtime：证据包会复制/重写文件，mtime 不可靠）。
const draftSha256 = createHash('sha256').update(readFileSync(draftPath)).digest('hex');
const draftBytes = readFileSync(draftPath).length;
const results = [];

// === 定位与解析共用助手（v18.0.5 去重：同一推导此前在脚本内各写 2-9 份）===
//   来源：`audits/论衡冗余审计-v1.md` §二.2（「同脚本内多份重复实现」）。**行为与去重前逐字等价**——
//   重构前后由 `run/_mgate-baseline.mjs`（37 组真实项目调用，比对 exit + stdout 哈希 + `--report` JSON 哈希）对账。
// ① 项目根：`<项目>/final/定稿.md` 与 `<项目>/drafts/初稿-vN.md` 都向上两级得到 `<项目>`
const projectRoot = dirname(dirname(draftPath));
// ② 报告目录：先 `<项目>/audits`，再 `<被审文件目录>/audits`，最后（仅 M-Exist-4 需要）证据包目录
const auditsDirOf = ({ withEv = false } = {}) =>
  [join(projectRoot, 'audits'), join(dirname(draftPath), 'audits'), ...(withEv ? [evDir] : [])]
    .find((d) => existsSync(d)) || null;
// ③ 最新版本化报告：`<前缀>-vN.md` 取 N 最大（N 真源 = 文件名版本号，与 M-Gate-Algorithm §M-Integrity-2 同口径）
const latestReport = (dir, prefix) => {
  if (!dir || !existsSync(dir)) return null;   // 目录可能在也可能不在（如 analysis/ 尚未创建）→ 一律记 null，不抛
  const cands = readdirSync(dir)
    .map((f) => ({ f, m: f.match(new RegExp(`^${prefix}-v(\\d+)\\.md$`)) }))
    .filter((x) => x.m).map((x) => ({ f: x.f, n: Number(x.m[1]) }))
    .sort((a, b) => b.n - a.n);
  return cands.length ? { path: join(dir, cands[0].f), n: cands[0].n, name: cands[0].f } : null;
};
// ④ markdown 表格行切单元格。`protect: true` 先保护「转义竖线 `\|`」与「行内代码块内的竖线」——
//    v18.0.0 修复（冲突⑩）：验收标准里写正则 `a|b|c` 会被裸 split 切错列 → 误读「关闭状态」。
const PROTECT_CH = '\u0001';
const tableCells = (line, { protect = false } = {}) => {
  const src = protect
    ? line.replace(/\\\|/g, PROTECT_CH).replace(/`[^`]*`/g, (mm) => mm.replace(/\|/g, PROTECT_CH))
    : line;
  return src.split('|').slice(1, -1).map((c) => c.trim().replace(new RegExp(PROTECT_CH, 'g'), '|'));
};
const isSeparatorRow = (cells) => cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '');
// ⑤ 段体范围：返回标题行之后的段体（`body`），边界为下一个标题（默认 `^##`，可调为 `^#{2,4}`）
const sectionRange = (lines, start, boundary = /^##\s/) => {
  let end = lines.findIndex((l, i) => i > start && boundary.test(l));
  if (end === -1) end = lines.length;
  return { start, end, body: lines.slice(start + 1, end) };
};
// ⑥ 「## 📇 索引段」段体（无该标题 → null）
const indexSection = (lines) => {
  const start = lines.findIndex((l) => /^##\s*📇\s*索引段/.test(l));
  return start === -1 ? null : sectionRange(lines, start);
};
// ⑦ 素材卡定位：证据包根扁平名 → 证据包子目录（旧版 build-evidence-bundle 的按相对路径拷贝形态）
//    → 项目内规范相对路径；都不在 → null（0 条场景合法，调用方记 N/A）
//    v18.0.5（第三方审计 P1-2）：加第二档——实测 `test-paper-01` 的证据包是 `证据包/{data,literature,…}/卡.md`
//    的嵌套形态，旧 resolver 看不到它，而「只认扁平名」的门（M-Form-6/M-Exist-2/3）报「卡不在证据包」、
//    「有 projectRoot 回退」的门（M-Form-10/11）报「已查 N 张卡」——同一次运行互相矛盾。
const findCard = (name, rel) => {
  const flat = join(evDir, name);
  if (existsSync(flat)) return flat;
  const sub = rel.includes('/') ? join(evDir, rel) : null;   // 证据包内的相对路径形态
  if (sub && existsSync(sub)) return sub;
  const alt = join(projectRoot, rel);
  return existsSync(alt) ? alt : null;
};
// ⑧ 卡片正文条目编号（`### [L01] 主题` 形态）。三张卡 + 先行者清单的路径口径同 `CARD_SPECS`
const CARD_SPECS = [
  ['文献卡.md', 'literature/文献卡.md'],
  ['数据卡.md', 'data/数据卡.md'],
  ['案例卡.md', 'cases/案例卡.md'],
  ['先行者清单.md', 'literature/先行者清单.md'],
];
const ENTRY_ID_RE = /^#{2,4}\s*\[([LDC])(\d+)\]/gm;
const entryIds = (cardText) => new Set([...cardText.matchAll(ENTRY_ID_RE)].map((m) => `[${m[1]}${m[2]}]`));
// ⑨ 同 ⑧ 但编号形态可配（M-Form-11 需纳入基线 `[D-基-x-NN]` 与先行者 `[先NN]`，v18.0.0 修「漏计 10 条」）
const idsByToken = (cardText, token) =>
  new Set([...cardText.matchAll(new RegExp(`^#{2,4}\\s*\\[(${token})\\]`, 'gm'))].map((m) => `[${m[1]}]`));
// ⑩ 证据包布局体检（v18.0.5 新增，第三方审计 P1-2）
//   契约：`build-evidence-bundle.mjs` 把素材卡**扁平拷进** `final/证据包/`。若证据包是按子目录组织的
//   （如 `证据包/data/数据卡.md`），旧脚本里「只认扁平名」的门（M-Form-6 / M-Exist-2 / M-Exist-3）
//   会报「卡不在证据包」，而「有 projectRoot 回退」的门（M-Form-10/11）却报「已查 3 张卡」——
//   同一次运行给出互相矛盾的 P0。现在：所有门统一走 `findCard()`；布局异常**单独**成一条 finding。
const NESTED_HINTS = ['analysis', 'audits', 'cases', 'data', 'literature'];
const evidenceLayout = (() => {
  let top = [];
  try { top = readdirSync(evDir).filter((f) => f.endsWith('.md')); } catch { return { flat: 0, nestedDirs: [], anomaly: null }; }
  let nestedDirs = [];
  try { nestedDirs = readdirSync(evDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch {}
  const nestedDirsWithMd = nestedDirs.filter((d) => NESTED_HINTS.includes(d))
  const anomaly = top.length === 0 && nestedDirsWithMd.length > 0
    ? `证据包顶层无 .md，仅子目录 ${nestedDirsWithMd.join('/')}——契约要求素材卡扁平位于证据包根（build-evidence-bundle 的产出形态）`
    : null;
  return { flat: top.length, nestedDirs: nestedDirsWithMd, anomaly };
})();
const layoutAnomaly = evidenceLayout.anomaly;
// 递归列出证据包内的 .md（供 M-Exist-2 统计；布局异常另有独立 finding，不再重复计 P0）
const walkMd = (dir) => {
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

// === v2.5.2-dsh.5 修订：白名单 5 节 + AI 使用声明（M-Form-2 / M-Form-7 一致）===
const WHITELIST = ['参考文献', '数据来源', '案例来源', '先行者文献', 'AI 使用声明'];

// 引用编号正则：支持 [Lxx]/[Dxx]/[Cxx]/[C-主xx]/[先xx]，可带版本后缀
const refRe = /\[(L|D|C-主|C|先)\d+(?:(?:-v| v)\d+)?\]/g;
const norm = (r) => r.replace(/(?:-v| v)\d+\]/, ']');

// 解析所有 ## 标题及其位置
const h2Matches = [...text.matchAll(/^##\s+(.+)$/gm)];
const h2s = h2Matches.map((m) => m[1].trim());
const firstIdx = h2s.findIndex((t) => WHITELIST.some((w) => t === w || t.startsWith(w)));
const firstEnd = firstIdx >= 0 ? h2Matches[firstIdx].index : -1;

// === M-Form-2 文末 5 节存在性（v2.5.2-dsh.5 修订：与 M-Form-7 一致）===
const missingSections = WHITELIST.filter((s) => !h2s.some((h) => h === s || h.startsWith(s)));
results.push({
  gate: 'M-Form-2 文末四节存在性',
  pass: missingSections.length === 0,
  detail: missingSections.length ? `缺失: ${missingSections.join(',')}` : '5 节齐全',
  severity: missingSections.length > 0 ? 'P0' : '通过',
});

// === M-Form-7 文末节白名单纯净 + 顺序（v18.0.0 加顺序断言，冲突⑧）===
let mform7Violations = [];
if (firstIdx === -1) mform7Violations = ['文末无任何白名单节'];
else mform7Violations = h2s.slice(firstIdx).filter((t) => !WHITELIST.some((w) => t === w || t.startsWith(w)));
// v18.0.0 修复（冲突⑧）：旧版只核**成员资格**、不核 `deliverables.md` 行 32-40 规定的**顺序固定**。
//   实战：v1 文末顺序为 数据来源→案例来源→参考文献→先行者文献→AI 使用声明（参考文献错位），
//   M-Form-7 判「全白名单」通过，由 T7 独立扫出（P1-1）。属教训 #139「规范从文档层到执行层断链」同型。
const mform7OrderViolations = [];
if (firstIdx !== -1 && mform7Violations.length === 0) {
  const seq = h2s.slice(firstIdx)
    .map((t) => WHITELIST.findIndex((w) => t === w || t.startsWith(w)))
    .filter((i) => i !== -1);
  const sorted = [...seq].sort((a, b) => a - b);
  if (seq.join(',') !== sorted.join(',')) {
    const actual = seq.map((i) => WHITELIST[i]).join(' → ');
    mform7OrderViolations.push(
      `文末五节顺序违规：实际「${actual}」；规定「${WHITELIST.join(' → ')}」`,
    );
  }
}
results.push({
  gate: 'M-Form-7 文末白名单',
  pass: mform7Violations.length === 0 && mform7OrderViolations.length === 0,
  detail: mform7Violations.length
    ? `违规节: ${mform7Violations.join(',')}`
    : mform7OrderViolations.length
      ? mform7OrderViolations[0]
      : '全白名单且顺序正确',
  severity: mform7Violations.length > 0 ? 'P0' : mform7OrderViolations.length > 0 ? 'P1' : '通过',
});

// 计算正文和文末区段
const body = firstEnd >= 0 ? text.slice(0, firstEnd) : text;
const endnote = firstEnd >= 0 ? text.slice(firstEnd) : '';

// === 代码 / 字面量剥离（v17.0.0 新增；端到端测试发现）===
// 端到端测试（论衡M门自省项目）暴露一类假阳性：**正文里「被讨论的编号 / 占位符字面量」被当成真实引用**——
//   例：技术稿引用「`[待补]` 这种占位符」、代码块里的 `??`（nullish 运算符）、说明「排除合法形态 `[C-主01]`」。
//   围栏代码块（```…```）与行内反引号（`…`）里的内容属于**字面量引用**，不参与引用闭环 / 占位符 / 三角验证机检。
// **不剥离**的项（有意保留）：M-Form-4 元数据泄露 —— 代码块里写 `scripts/`、`m-gate-check.mjs` 同样是泄露。
const stripCodeSpans = (s) => String(s ?? '')
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/`[^`\n]*`/g, ' ');
const bodyProse = stripCodeSpans(body);   // 引用闭环 / 三角验证 / 占位符用（不带字面量）
const textProse = stripCodeSpans(text);   // 占位符残留用（全文，含文末）

// === M-Form-1 引用标注完整性（v2.5.2-dsh.5 修订：阈值提升 L≥3）===
const bodyRefs = bodyProse.match(refRe) || [];
const L_count = refsOf(bodyProse, 'L').length;
const min_L = 3;
let mform1Pass, mform1Detail, mform1Severity;
if (bodyRefs.length === 0) {
  mform1Pass = false;
  mform1Detail = '正文无任何引用标注';
  mform1Severity = 'P0';
} else if (L_count === 0) {
  mform1Pass = false;
  mform1Detail = `学术深度论文文献 [Lxx] = 0（实测 ${bodyRefs.length} 引用全无 L，旧算法阈值过低放过——v2.3.7 §四 P4 L=0 漏检根因）`;
  mform1Severity = 'P0';
} else if (L_count < min_L) {
  mform1Pass = false;
  mform1Detail = `学术深度论文文献 [Lxx] < ${min_L}（实测 L=${L_count}），需补检索加固`;
  mform1Severity = 'P0';
} else {
  mform1Pass = true;
  mform1Detail = `正文引用 ${bodyRefs.length} 处（L ${L_count}，阈值 ≥${min_L}）`;
  mform1Severity = '通过';
}
results.push({ gate: 'M-Form-1 引用标注完整性', pass: mform1Pass, detail: mform1Detail, severity: mform1Severity });

// === M-Form-3 临时编号 / 占位符残留（v2.5.2-dsh.17 重写：消除与 M-Exist-1 的重复计）===
// 自省审计发现：旧实现算的是「正文有、文末无」的编号（orphan = bodyRefs − endRefs），与
//   M-Exist-1 的 leaked **是同一个计算**（同一组变量、同一套阈值档位）→ 两项恒同判，属重复门。
//   「正文 ↔ 文末双向闭环」本就归 M-Exist-1，本项不再重复报。
// 本项回归名字本身：「临时编号残留」= 定稿里残留的**占位符 / 临时标记**——这是此前的**真实空档**：
//   `[待补]` 出现在定稿里不会被任何一项抓到（M-Form-4 的禁止清单里没有它）。
// 边界：编号**位数**不由本项管（`_lib/refs.mjs` 明确允许任意位数，不强制补零）。
const TEMP_MARKERS = [
  [/\[(?:待补|待定|待查|待核|待回查|临时|占位|TBD|TODO|PLACEHOLDER)\]/gi, '临时/占位方括号'],
  // 临时编号本体（errors.md 记的原始形态）：`[L_TBD-1]` / `[D_占位]` / `[L-新1]`
  // —— 排除合法形态：
  //   ① `[C-主01]`（主人洞察）
  //   ② `[D-基-{类别}-{序号}]`（glossary §三 v2.3.7 正式基线编号格式，必须保留）
  //   ③ `[C-空]`（0 条空卡协议规定标记）
  //   ④ 纯数字后缀（`[L01-2]` 版本后缀是允许的）
  // v18.0.0 修复（P0-1，实战：本项目 12 处命中全为 ②③，真占位符 = 0 → 假 P0 使 M 门永不可能 exit 0）
  [/\[[LDC](?:_|-)(?!主\d)(?!基-)(?!空\])[A-Za-z\u4e00-\u9fff][^\]]*\]/g, '临时编号（如 [L_TBD-1]）'],
  [/【(?:待补|待定|待查|待核|临时)】/g, '中文方头括号占位'],
  [/（(?:待补|待定|待查|待核|临时)）/g, '圆括号占位'],
  [/_{3,}/g, '下划线占位'],
  [/[？?]{2,}/g, '连续问号占位'],
];
{
  const tempCount = TEMP_MARKERS.reduce((a, [re]) => a + ((textProse.match(re) || []).length), 0);
  const tempHits = TEMP_MARKERS
    .map(([re, label]) => [label, (textProse.match(re) || []).length])
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label}×${n}`);
  results.push({
    gate: 'M-Form-3 临时编号残留',
    pass: tempCount === 0,
    detail: tempCount
      ? `命中: ${tempHits.join(',')}（定稿不得留占位符 / 临时标记）`
      : '零占位符残留（正文↔文末编号闭环由 M-Exist-1 负责，本项不重复计）',
    severity: tempCount >= 3 ? 'P0' : (tempCount > 0 ? 'P1' : '通过'),
  });
}

// === M-Form-5 过程语言残留（v2.5.2-dsh.5 扩禁词清单：弱 AI 痕；v2.5.2-dsh.9 扩内部流程词；
//     v2.5.2-dsh.17 补严重度分级——自省审计发现旧版最高只到 P1，**P0 分支不可达**，
//     与同族的 M-Form-4（元数据泄露）/ M-Form-9 不一致：过程语言成规模 = 读者看到流水线内部 = 交付级缺陷）===
// v18.0.0 修复（冲突⑨）：旧表列「承重墙 / 承重案例」**全词** → 正文写「承重证据」即漏网
//   （实战：本文 §5.3 末段「承重证据之脆弱环」判「零命中」，由 T7 独立扫出）。
//   现改为「承重」**前缀词整体入表**，并补 05 卡内部术语（一处两用 / 段级条目 / 素材卡类名）。
const bannedBanned = /v\d+ 稿|初稿|草稿|修订说明|上一版|下一版|(?<!板)卡级|修卡|承重|批注|待回查|审计环节|流水线|将在[^，。\n]{0,8}订正|一处两用|段级条目|索引段|素材加载清单|素材卡|案例卡|数据卡|文献卡/g;
const estRe = /据行业经验估算/g;
const weakAITrend = /据可靠来源|据悉|据了解|研究显示|专家表示/g;
const hits = (body.match(bannedBanned) || []);
const estHits = [...body.matchAll(estRe)].filter((m) => !body.slice(Math.max(0, m.index - 60), m.index + m[0].length).includes('[行业估算'));
for (const e of estHits) hits.push(e[0]);
// 弱 AI 痕仅在上下文 200 字符内无 [Lxx]/[Dxx]/[Cxx] 时算违规
const weakAIHits = [];
for (const m of body.matchAll(weakAITrend)) {
  const start = Math.max(0, m.index - 200);
  const ctx = body.slice(start, m.index + m[0].length);
  if (!/\[(?:L|D|C)\d+\]/.test(ctx)) weakAIHits.push(m[0]);
}
for (const h of weakAIHits) hits.push(h);
results.push({
  gate: 'M-Form-5 过程语言残留',
  pass: hits.length === 0,
  detail: hits.length ? `命中: ${[...new Set(hits)].join(',')}` : '零命中',
  // v2.5.2-dsh.17：补 P0 档（旧版最高 P1 → P0 分支不可达，与 M-Form-4/M-Form-9 同族不一致）
  severity: hits.length > 10 ? 'P0' : (hits.length > 5 ? 'P1' : (hits.length > 0 ? 'P2' : '通过')),
});

// === M-Form-4 元数据泄露（v2.5.2-dsh.5 重大修订：黑名单转白名单）===
const forPatternText = (() => {
  let t = body;
  const whitelists = [
    /\[(?:L|D|C-主|C|先)\d+\]/g,
    /\d{4}年|\d{1,2}月\d{1,2}日/g,
    /\d+\.?\d*%|\d+\.?\d*\s*(?:万|亿|个|条|项|位|倍|元|倍|成)/g,
    /[\u4e00-\u9fff]+(?:大学|学院|研究院|政府|机构|组织|部|委|局|司|办)/g,
    /AI Act|标识办法|GPT-?\d*|OpenAI|Claude/g,
  ];
  for (const pat of whitelists) t = t.replace(pat, '');
  return t;
})();
const forbiddenPatterns = [
  /T[0-9] (主控|文献|数据|分析|写手|审计|案例|批判|审稿)/g,
  /((?<!自)主控|文献检索员|数据检索员|分析员|写手|批判伙伴|审计员|审稿人|案例检索员)/g,
  // v18.0.0 修复（冲突⑥）：旧式「论衡 + 空格 + 枚举词」会漏掉「论衡 AI 写作流水线」
  //   → 改为「论衡」与枚举词**同句共现**（≤12 字间隔），是否合规披露段交由 LLM 判断
  /论衡[^\n。；]{0,12}(?:agent|流水线|技能|测试轮)/g,
  /角色卡|任务书|六要素|交接报告|反哺报告|教训 #?\d+|Phase [0-9.]+/g,
  /批 v?\d+ 稿|初稿|草稿|定稿/g,
  /输入材料|输出材料|任务简报第 ?\d+ ?行|修订说明-?v?\d+|scripts\//g,
  /m-gate-check\.mjs|consistency-check\.mjs|count-chars\.mjs/g,
  /\bsubagent\b|\bforeground\b|\bbackground\b|\bsubagent_fork\b/g,
];
const leakHits = [];
for (const pat of forbiddenPatterns) {
  const m = forPatternText.match(pat);
  if (m) leakHits.push(...m);
}

// === M-Form-4 补充：文末节二级扫描（v18.0.0 新增，P0-4）===
// 实战教训：M-Form-4 只扫正文区 `body`（文末节被整体剥离），文末 `## 案例来源` 遂成「免责区」——
//   本轮该节含「案例检索员」+「spawn + 立即 Done」+「任务简报 §五 第 55–56 行」+「主人 Phase 0」，
//   脚本判通过，由 T7 逐行人工扫出（判 P0-1）。而 deliverables.md 明确要求定稿文末亦不得含内部流水线信息。
// 现规则：白名单 5 节 **只豁免书目条目行**（以 [Lxx]/[Dxx]/[Cxx]/[先xx] **数字编号**开头者，
//   含基线编号 [D-基-x-NN]）；其余说明性文字与正文同口径扫描。
// ⚠️ [C-空] 标记行**不豁免**（0 条空卡场景下，该行的说明文字正是本轮泄露点）。
const ENDNOTE_FORBIDDEN = [
  /((?<!自)主控|文献检索员|数据检索员|分析员|写手|批判伙伴|审计员|审稿人|案例检索员)/g,
  /\bspawn\b|\bsubagent\b|立即\s*Done|foreground|background/g,
  /空卡协议|交接报告|六要素|角色卡|任务简报|反哺报告|修订说明|教训\s*#?\d+/g,
  /\bPhase\s*[0-9.]+/g,
  /v\d+\.\d+\.\d+/g, // 版本注记（如「（v2.2.2 新增）」）
  /论衡[^\n。；]{0,12}(?:agent|流水线|技能|测试轮)/g,
  // v18.0.0：补「读者面内部术语」——实战本轮文末「数据来源」节出现「数据卡 [D02] 未记页码」
  //   （行 147，由 T7 独立发现、M-Form-5 因 body 不含文末节而漏检）
  /承重|素材卡|案例卡|数据卡|文献卡|索引段|素材加载清单|一处两用|段级条目|卡级|修卡/g,
];
// v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
//   **「AI 使用声明」节整体豁免二级扫描**。该节的唯一职责就是披露 AI 参与，其措辞由
//   `references/templates/AI-使用声明-template.md` 规定（模板本身要求写「分析框架由 AI 协助拟定」等披露语），
//   与「文末不得含内部流水线信息」的立法目的不冲突。
//   实测：定稿在声明节写「…均配 [Lxx]+[Dxx]+[Cxx] 三档**承重**证据」→ 命中禁止词「承重」→ **假 P0**
//   （M 门 exit 2 的一项，T8 只能写 Acknowledged Limitations）。
//   v18.0.0 新增二级扫描的动因是 `## 案例来源` 泄露「案例检索员 + spawn」——**那类节仍照扫**，
//   故本豁免只针对「AI 使用声明」，不放宽其余四节。
const ENDNOTE_SCAN_EXEMPT = ['AI 使用声明'];
const endnoteScanText = (() => {
  const secs = [];
  let cur = null;
  for (const l of endnote.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(l);
    if (m) { cur = { title: m[1], lines: [] }; secs.push(cur); continue; }
    if (cur) cur.lines.push(l);
  }
  if (secs.length === 0) return endnote;   // 无二级标题（异常布局）→ 不豁免，照旧全扫
  const kept = secs.filter((s) => !ENDNOTE_SCAN_EXEMPT.some((w) => s.title === w || s.title.startsWith(w)));
  if (kept.length === secs.length) return endnote;
  // 豁免后仍保留节标题，便于 detail 里的「文末节」定位信息不失真
  return kept.map((s) => `## ${s.title}\n${s.lines.join('\n')}`).join('\n');
})();
const endnoteNonBiblio = endnoteScanText
  .split('\n')
  .filter((l) => !/^\s*[-*]?\s*\[(?:L|D|C|先)(?:\d|-基-)/.test(l)) // 仅豁免数字/基线编号书目行
  .join('\n');
const endnoteLeakHits = [];
for (const pat of ENDNOTE_FORBIDDEN) {
  const m = stripCodeSpans(endnoteNonBiblio).match(pat);
  if (m) endnoteLeakHits.push(...m);
}
if (endnoteLeakHits.length > 0) {
  const secNames = [...endnote.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  const secTag = secNames.length ? `（文末节: ${secNames.join(' / ')}）` : '';
  leakHits.push(...[...new Set(endnoteLeakHits)].map((h) => `文末节泄露「${h}」${secTag}`));
}

results.push({
  gate: 'M-Form-4 元数据泄露',
  pass: leakHits.length === 0,
  detail: leakHits.length
    ? `命中: ${[...new Set(leakHits)].slice(0, 5).join(',')}`
    : '正文 + 文末节均无内部代码（白名单剥离后 + 文末二级扫描）',
  // v2.5.2-dsh.17：与文档口径对齐——**任一处泄露即 P0**（文档：M-Form-4 是 P0 优先级，
  // 读者看到论衡内部代码 = 失去学术严肃性；旧版 1-5 处只给 P1，与 M-Form-7「一处违规即 P0」不一致）
  severity: leakHits.length > 0 ? 'P0' : '通过',
});

// === M-Form-6 信任级别（v2.5.2-dsh.5 扩字段：双格式 + 描述字段交叉验证）===
let dataCard = '';
// v18.0.5 修（第三方审计 P1-2）：改用统一 resolver `findCard()`（evDir 扁平 → 项目内规范相对路径），
//   与 M-Form-10/11 同口径。旧版只认 `join(evDir,'数据卡.md')`，在「证据包按子目录组织」的项目上
//   会与 M-Form-10「已查 3 张卡」互相矛盾（实测 test-paper-01：同一次运行同时报
//   「数据卡.md 不在证据包」与「已查 3 张卡」）。
const dataCardPath6 = findCard('数据卡.md', 'data/数据卡.md');
try { if (dataCardPath6) dataCard = readFileSync(dataCardPath6, 'utf8'); } catch {}
if (dataCard) {
  const uniqueDataIds = dataCardIds(text);
  const trustLevelMiss = [];
  const trustLevelDescOnly = [];
  for (const id of uniqueDataIds) {
    // v3 实际格式：### [Dxx] 标题（三级标题）| 数据卡.md 一级 # + [Dxx] 行内（v3 头部）
    const card = splitCard(dataCard, id);
    if (!card) { trustLevelMiss.push(`D${id}(整段缺失)`); continue; }
    const section = card.body;
    const hasStdTrust = TRUST_COMPLIANT_RE.test(section);
    const hasDescTrust = TRUST_LOOSE_RE.test(section);
    if (!hasStdTrust) {
      if (hasDescTrust) {
        trustLevelDescOnly.push(`D${id}`);
      } else {
        trustLevelMiss.push(`D${id}`);
      }
    }
  }
  let mform6Pass, mform6Detail, mform6Severity;
  if (trustLevelMiss.length === 0 && trustLevelDescOnly.length === 0) {
    mform6Pass = true;
    mform6Detail = `${uniqueDataIds.length} 条数据卡均标独立信任级别段`;
    mform6Severity = '通过';
  } else if (trustLevelMiss.length > 0) {
    mform6Pass = false;
    mform6Detail = `独立段缺失: ${trustLevelMiss.slice(0, 5).join(',')}${trustLevelDescOnly.length ? `; 描述字段仅有: ${trustLevelDescOnly.slice(0, 3).join(',')}` : ''}`;
    mform6Severity = trustLevelMiss.length > 5 ? 'P0' : (trustLevelMiss.length > 2 ? 'P1' : 'P2');
  } else {
    mform6Pass = false;
    mform6Detail = `独立段缺失（描述字段仅提及）: ${trustLevelDescOnly.slice(0, 5).join(',')}（P2：建议统一迁移到独立段，防描述改写后失锚）`;
    mform6Severity = 'P2';
  }
  results.push({ gate: 'M-Form-6 信任级别', pass: mform6Pass, detail: mform6Detail, severity: mform6Severity });
} else {
  results.push({
    gate: 'M-Form-6 信任级别',
    pass: false,
    detail: layoutAnomaly
      ? `数据卡.md 定位失败（证据包布局异常：${layoutAnomaly}）`
      : '数据卡.md 不在证据包（也不在项目 data/ 目录）',
    severity: 'P0',
  });
}

// === M-Form-8 三角验证（v2.5.2-dsh.5 修订：每论点强制含 L + coverage ≥ 2）===
let mform8Findings = { L_missing: 0, weak: 0, total: 0, details: [] };
try {
  // v2.5.2-dsh.5 修复：排除前置/收尾非论点段（摘要/关键词/引言/结语）——摘要与引言天然不引 [Lxx]
  // （引言以 [先xx] 声明原创性差异点，属论衡原创性机制而非论点论证），之前把「摘要」当正文段查 [Lxx] 导致恒 P0 误报。
  const FRONT_BACK = ['摘要', '关键词', '引言', '结语', '结论', '展望'];
  const sections = body.split(/^##\s+/m).filter((s) => s.trim().length > 0);
  for (const sec of sections.slice(0, 20)) {
    if (sec.length < 100) continue;
    const secTitle = sec.split('\n')[0].trim();
    const titleNorm = secTitle.replace(/^[0-9一二三四五六七八九十]+\s*[、.．:：\s]+/u, '').replace(/[：:].*$/u, '').trim();
    if (FRONT_BACK.some((t) => titleNorm === t || titleNorm.startsWith(t) || titleNorm.includes(t))) continue;
    mform8Findings.total++;
    const secProse = stripCodeSpans(sec);          // 剥掉代码/反引号里的字面量编号
    const hasL = /\[L\d+\]/.test(secProse);
    const hasD = /\[D\d+\]/.test(secProse);
    const hasC = /\[C\d+\]/.test(secProse);
    const cov = (hasL ? 1 : 0) + (hasD ? 1 : 0) + (hasC ? 1 : 0);
    if (!hasL) { mform8Findings.L_missing++; mform8Findings.details.push(`段缺[Lxx]: ${sec.split('\n')[0].slice(0, 30)}`); }
    if (cov < 2) mform8Findings.weak++;
  }
  // ---- 承重墙超载机检（v2.5.2-dsh.17 新增）----
  // 承重墙 = 支撑力最强的单条证据，T4 在大纲「承重墙清单」里逐论点标 top1；论衡定的规则是
  // **同一证据被 ≥3 个论点标为承重墙 = 超载**（教训：善行实战祁东案一个案例承重四个论点，
  // 被击穿则整链塌）。此前该规则只有 T6 的专项批判 + T7 的 LLM 复核，**没有任何机械计数**。
  // 判定方式与格式无关：清单区内每个论点最多贡献一次 top1 标注，故同一编号出现 ≥3 次即 ≥3 个论点。
  const wall8 = { checked: false, rows: 0, overload: [], ghost: [], claims: 0, notes: [] };
  try {
    const projDir8 = dirname(dirname(draftPath));
    const outlinePath8 = [join(projDir8, 'analysis', '分析大纲.md'), join(evDir, '分析大纲.md')]
      .find((p) => existsSync(p));
    if (outlinePath8) {
      const ol = readFileSync(outlinePath8, 'utf8').split('\n');
      // **锚点必须是「结构信号」**（v17.0.0 修复，端到端测试反哺）：
      //   旧实现用 /承重墙/ 全行匹配 → 命中**散文里的「承重墙」三字**（例：禁做项列表写「不出现…承重墙…」）
      //   → 该行非标题 → 走「猜后续 60 行」兜底 → 把论点-论据映射表也当承重墙清单 → 同一编号 ×3 → **误报超载**。
      //   现只认：① 标题行（##/### … 承重墙…）；② 含「承重证据 top1」标记的行。
      // v18.2.1 再收紧（本轮 v18.2.0 短测试实测踩到，属旧修复未覆盖的同类形态）：
      //   旧式 `/承重墙|承重证据/` 对**标题行做全行匹配**，会命中
      //   「### 论点-论据映射表（写手版；**M-Form-8 承重墙清单**）」——括号里**提及**了承重墙，
      //   于是把论据映射表当承重墙清单读（该表一行含多个编号）→ 同一编号计 3 次 → 误报「承重墙超载」。
      //   故标题行锚点改为**必须以关键词开头**；行内式锚点（非标题）仍只认「承重证据 top1」。
      // v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
      //   **新增「表格表头锚点」并置其优先级最高**。T4 的常见做法是把承重墙做成**三角验证表的一列**
      //   （表头 `| 论点 | 论点简述 | … | 承重 top1 | 子问题 |`），而非独立小节；旧实现只认
      //   ① 以「承重墙/承重证据/承重清单」开头的标题行、② 行内式「承重证据 top1」——
      //   于是 ② 命中的是**三角验证表上方的纪律说明引用块行**
      //   （`> **承重墙纪律（v18.0.0）**：每条核心论点标"承重证据 top1"…`），
      //   该锚点非标题 → 走「紧随其后的连续表格/列表行」→ 下一行是**空行** → block 只有 1 行
      //   → structRows=0 → **假报「承重墙清单无结构性条目」P1**（真值：表内 10 行 top1 标注齐全、无超载）。
      //   三处修正：① 表头锚点优先；② 收块时**容忍空行间隔**；③ 锚点搜索跳过围栏代码块。
      const isFenceLine = (l) => /^\s*```/.test(l);
      const wallHeadAnchor = (l) => /^\s*\|[^\n]*承重[^\n]*\|\s*$/.test(l);
      const wallTextAnchor = (l) => /^#{2,4}\s/.test(l)
        ? /^#{2,4}\s*(承重墙|承重证据|承重清单)/.test(l)
        : /承重证据\s*top\s*1/i.test(l);
      let fenceOn = false;
      let headIdx = -1;
      let textIdx = -1;
      for (let i = 0; i < ol.length; i++) {
        if (isFenceLine(ol[i])) { fenceOn = !fenceOn; continue; }
        if (fenceOn) continue;
        if (headIdx === -1 && wallHeadAnchor(ol[i])) headIdx = i;
        if (textIdx === -1 && wallTextAnchor(ol[i])) textIdx = i;
      }
      const sIdx = headIdx !== -1 ? headIdx : textIdx;
      if (sIdx !== -1) {
        wall8.checked = true;
        const head = /^(#{1,6})\s/.exec(ol[sIdx]);
        let eIdx = ol.length;
        if (head) {
          const re = new RegExp(`^#{1,${head[1].length}}\\s`);
          for (let i = sIdx + 1; i < ol.length; i++) { if (re.test(ol[i])) { eIdx = i; break; } }
        } else {
          // 行内式 / 表头式锚点（无标题）：收**表格行**（表头锚点）或**表格/列表行**（行内锚点），
          //   并**容忍 ≤3 行空行间隔**（v18.2.2：旧实现在空行处即停 → 表头与表体被空行分开时只收到表头）。
          //   ⚠️ v18.2.2 **二修**——首次修订引入的回归，由回归验证子代理实测发现（2026-09-12）：
          //   旧续行谓词 `/^\s*[|*-]/` 会把**加粗散文行**当结构性行（`**三角验证覆盖率自检**：…[L02]…`
          //   行首 `*` 命中字符类 `*`）→ 该段的方括号编号被计入承重频次 → **假报**
          //   「承重墙超载：[L02]×3论点,[L03]×3论点,[D03]×3论点」。
          //   真值：表内 10 行 top1 = L02×2 / L03×2 / D03×1，**无超载**（大纲自检段亦明示不超载）。
          //   故收紧为：**表头锚点只收表格行** `^\s*\|`；行内锚点的列表项也要求 `[-*]` 后**跟空白**
          //   （`^\s*[-*]\s`）——不再用裸字符类 `[|*-]`。
          const contRe = wallHeadAnchor(ol[sIdx]) ? /^\s*\|/ : /^\s*(\||[-*]\s)/;
          let gap = 0;
          for (let i = sIdx + 1; i < ol.length; i++) {
            if (/^\s*$/.test(ol[i])) { if (++gap > 3) { eIdx = i; break; } continue; }
            if (!contRe.test(ol[i])) { eIdx = i; break; }
            gap = 0;
          }
        }
        const block = ol.slice(sIdx, eIdx);
        // 只认「结构性行」：表格行 / 列表项 / 含论点标记的行（防把散文里的编号算成承重墙标注）
        // 结构性行要求**同时**：① 行内有编号；② 行内带「论点N」标记（承重墙清单是「每论点一条 top1」的语义）
        //   —— 只认「含论点标记」的行，防止把「论点-论据映射表」（一行可含多个编号）算成承重墙标注
        const structRows = block.filter((l) => /\[[LDC]\d+\]/.test(l) && /论点\s*[0-9一二三四五六七八九十]/.test(l));
        wall8.rows = structRows.length;
        const freq = new Map();
        for (const l of structRows) for (const m of l.matchAll(/\[([LDC])(\d+)\]/g)) {
          const id = `[${m[1]}${m[2]}]`;
          freq.set(id, (freq.get(id) || 0) + 1);
        }
        wall8.claims = new Set([...block.join('\n').matchAll(/论点\s*([0-9一二三四五六七八九十]+)/g)].map((m) => m[1])).size;
        wall8.overload = [...freq.entries()].filter(([, n]) => n >= 3).map(([id, n]) => `${id}×${n}论点`);
        if (wall8.rows === 0) wall8.notes.push('承重墙清单无结构性条目（每个论点须标一条「承重证据 top1」）');
        else if (wall8.claims > wall8.rows) wall8.notes.push(`${wall8.claims} 个论点但只标了 ${wall8.rows} 条承重墙——有论点未标 top1`);
        // 幽灵编号：承重墙标了卡片里不存在的编号
        const cardIds8 = new Set();
        // v18.0.0：纳入 **先行者清单** —— `[先NN]` 编号不在三张素材卡内（存在 `literature/先行者清单.md`），
  //   否则 ghost 判定会把清单里的 [先01]-[先07] 误判为「清单编造」（假 P0）。
  for (const [name, rel] of CARD_SPECS) {
          const p = findCard(name, rel);
          if (!p) continue;
          for (const id of entryIds(readFileSync(p, 'utf8'))) cardIds8.add(id);
        }
        if (cardIds8.size > 0) wall8.ghost = [...freq.keys()].filter((id) => !cardIds8.has(id));
      } else {
        wall8.notes.push('大纲未见承重墙清单（T4 未标 top1 → 本项无从核，T6/T7 按清单专项检查失效）');
      }
    }
  } catch { /* 承重墙是增强项：解析失败不拖垮 M-Form-8 原有覆盖率判定 */ }

  const wallHard = wall8.overload.length > 0 || wall8.ghost.length > 0;
  let mform8Pass = (mform8Findings.L_missing === 0 && mform8Findings.weak === 0 && !wallHard);
  let mform8Severity = mform8Findings.L_missing > 0 ? 'P0'
    : (wallHard || mform8Findings.weak > 0 ? 'P1' : '通过');
  const wallBit = wall8.checked
    ? (wall8.overload.length
      ? `承重墙超载：${wall8.overload.join(',')}（同一证据被 ≥3 论点承重 → 降级为辅助证据或补检索）`
      : (wall8.rows > 0 ? `承重墙 ${wall8.rows} 条标注、无超载` : (wall8.notes[0] || '承重墙清单为空')))
    : '';
  let wallBit2 = '';
  if (wall8.ghost.length) wallBit2 = `承重墙含卡片中不存在的编号：${wall8.ghost.slice(0, 5).join(',')}`;
  results.push({
    gate: 'M-Form-8 三角验证',
    pass: mform8Pass,
    detail: [
      `${mform8Findings.total} 段：${mform8Findings.L_missing} 段缺 L，${mform8Findings.weak} 段覆盖 <2 类${mform8Findings.details.length ? `（${mform8Findings.details.slice(0, 3).join('; ')}）` : ''}`,
      wallBit,
      wallBit2,
      (wall8.checked && wall8.rows > 0 && !wall8.overload.length && wall8.notes.length) ? `备注：${wall8.notes[0]}` : '',
    ].filter(Boolean).join(' ｜ '),
    severity: mform8Severity,
  });
} catch (e) {
  results.push({ gate: 'M-Form-8 三角验证', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Form-9 图件闭环（v2.5.2-dsh.16 新增）：[图N] 图位 ↔ final/图件/ ↔ 图上数字 三方对账 ===
// 背景（第三方 SVG 链路审计）：T5 卡宣称「T7 跑 M-Gate 算法检查 [图N] 出现次数 ≥ 拍板图位数量 → P0 拦截」，
// 但 M 门 16 项里**没有任何图项**、T7 速查表 0 处提及「图」、证据包不收图件 → 该条文无落地路径。
// 本项即该条文的机械落地：缺图/图位不足 → 硬失败；孤儿图件/数字对不上 → 软提示（数字对账为启发式）。
// 未启用配图（无图位且无图件目录）→ 记 N/A 且 pass=true（不得因「没配图」把 M 门判失败——配图默认关闭）。
try {
  const figDirDefault = join(dirname(draftPath), '图件');
  const figDir = figDirArg && existsSync(figDirArg) ? figDirArg : (existsSync(figDirDefault) ? figDirDefault : null);
  const figNos = figurePlaceholders(text);
  const files = figDir ? readdirSync(figDir).filter((f) => f.toLowerCase().endsWith('.svg')) : [];
  const fileNos = new Map();
  for (const f of files) { const n = figureNoOf(f); if (n !== null && !fileNos.has(n)) fileNos.set(n, f); }
  // 图位数量对账（拍板数取自任务简报，best-effort 解析；解析不到则不判，避免误 P0）
  let pledged = 0, pledgedFrom = '';
  try {
    // v18.0.2 修（D1，静默失效）：旧实现 `draftPath.replace(/final[\/]定稿\.md$/, …)` 只对 `final/定稿.md`
    //   生效；被审对象为 `drafts/初稿-vN.md` 时替换不命中 → briefPath 退回正文自身 → pledged 解析不到 → 0
    //   → **「图位不足」比对在 Phase 4 场景静默不判**（同文件的 M-Integrity-1 曾因同一 bug 失效，其修法即
    //   findBriefUpward，本处为第二份拷贝）。现统一改用模块级 findBriefUpward。
    const briefPath = findBriefUpward(dirname(draftPath));
    if (briefPath && briefPath !== draftPath && existsSync(briefPath)) {
      const b = readFileSync(briefPath, 'utf8');
      const m1 = b.match(/(?:图位|图表)数量\s*[:：]\s*(\d+)/);
      const m2 = b.match(/拍板[^\n。]{0,20}?(\d+)\s*(?:张|个|幅)图/);
      pledged = Number((m1 && m1[1]) || (m2 && m2[1]) || 0);
      if (pledged) pledgedFrom = m1 ? '简报「图位数量」' : '简报「拍板 N 张图」';
    }
  } catch { /* 简报缺失或不可读 → 不判 */ }

  if (figNos.size === 0 && fileNos.size === 0) {
    results.push({
      gate: 'M-Form-9 图件闭环',
      pass: true,
      detail: 'N/A：未启用配图（正文无 [图N] 图位、final/图件/ 不存在）——本项不适用，不算通过也不判失败',
      severity: '通过',
    });
  } else {
    const problems = [];
    const softNotes = [];
    // ① 缺图：正文有图位但无对应图件
    const missingFigs = [...figNos].filter((n) => !fileNos.has(n));
    // ② 图位不足：拍板数 > 正文图位数
    const shortage = pledged > 0 && figNos.size < pledged;
    // ③ 孤儿图件
    const orphanFigs = [...fileNos.keys()].filter((n) => !figNos.has(n));
    // ④ SVG 良构 / 安全
    if (figDir) {
      for (const [n, f] of fileNos) {
        const a = analyzeSvg(readFileSync(join(figDir, f), 'utf8'));
        if (!a.ok) problems.push(`图${n}(${f}) 结构不合格: ${a.problems.join('；')}`);
        if (a.warnings.length) softNotes.push(`图${n}(${f}) 告警: ${a.warnings.join('；')}`);
      }
      // ⑤ 图上数字 ⊆ 数据卡 ∪ 正文（启发式：仅查 <text>/<tspan>/<title> 文本节点，跳过单字符刻度）
      const unionRaw = dataCard + '\n' + text;
      const union = unionRaw + '\n' + unionRaw.replace(/(\d),(?=\d{3}\b)/g, '$1');
      for (const [n, f] of fileNos) {
        const nums = svgTextNumbers(readFileSync(join(figDir, f), 'utf8'));
        const unmatched = [...nums.keys()].filter((t) => t.length >= 2 && !union.includes(t));
        if (unmatched.length) {
          softNotes.push(`图${n} 图上数字 ${unmatched.slice(0, 5).join(',')}${unmatched.length > 5 ? ` 等 ${unmatched.length} 个` : ''} 在数据卡/正文中找不到出处（启发式：可能为刻度或坐标，请人工确认）`);
        }
      }
    }
    if (missingFigs.length) problems.push(`缺图：正文标了图位但 final/图件/ 无对应文件 → 图${missingFigs.join('、图')}（期望 图N_标题.svg）`);
    if (shortage) problems.push(`图位不足：${pledgedFrom} 记为 ${pledged} 张，正文仅 ${figNos.size} 个 [图N]（T5 卡「≥ 拍板数量」不满足）`);
    if (orphanFigs.length) softNotes.push(`孤儿图件：图${orphanFigs.join('、图')} 未被正文引用`);

    const hard = problems.length > 0;
    // 严重度：**图件全缺（有图位但一个图件都没有/目录不存在）**或缺失总数 >2 → P0；其余缺图 → P1
    const severity = !hard ? (softNotes.length ? 'P2' : '通过')
      : ((missingFigs.length > 0 && fileNos.size === 0) || missingFigs.length + (shortage ? 1 : 0) > 2 ? 'P0' : 'P1');
    results.push({
      gate: 'M-Form-9 图件闭环',
      pass: hard ? false : (softNotes.length ? false : true),
      detail: [
        `图位 ${figNos.size} 个 / 图件 ${fileNos.size} 个${figDir ? '' : '（无 final/图件/ 目录）'}`,
        problems.length ? `硬问题: ${problems.join('；')}` : '无缺图',
        softNotes.length ? `软提示: ${softNotes.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity,
    });
  }
} catch (e) {
  results.push({ gate: 'M-Form-9 图件闭环', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-1 文末四节双向对比（v2.5.2-dsh.5 脚本化 + 严重度评级）===
if (firstIdx === -1) {
  results.push({ gate: 'M-Exist-1 引用双向对比', pass: 'SKIP', detail: '文末缺失，M-Form-2 失败优先', severity: 'SKIP' });
} else {
  const intext = new Set((bodyProse.match(refRe) || []).map(norm));
  const endRefs2 = new Set((endnote.match(refRe) || []).map(norm));
  const leaked = [...intext].filter((r) => !endRefs2.has(r));
  const orphan2 = [...endRefs2].filter((r) => !intext.has(r));
  // v18.2.2（主人授权修订；依据 2026-09-12 全量测试反哺）：**诊断增强**——
  //   最高频的漏引根因不是「缺条目」，而是**「参考文献」节误用 GB/T 7714 的数字标签 `[1]..[n]`**：
  //   `refRe` 要求**字母前缀**（`[Lxx]`/`[Dxx]`/`[Cxx]`/`[先NN]`），故 `[1]` 一条都扫不到
  //   → 文末的字母编号集为空 → **正文全部 [Lxx] 被判「漏引」**。这正是本仓库 v18.2.1
  //   `规范-机械门对照表.md` 记过的断链（「首版无 [Lxx] → 漏引 17」）。
  //   旧 detail 只报「漏引 N」，主控与写手极易误判为「缺条目」而去补条目（治标不治本、白绕一圈）。
  //   现检测该形态并在 detail 前置可操作提示。**只改提示文字，判定逻辑与严重度完全不变。**
  const mExist1Hint = (() => {
    if (leaked.length === 0) return '';
    if (!leaked.some((r) => /^\[L/.test(r))) return '';   // 只在涉及 [Lxx] 时给该提示
    const sec = /^##\s*参考文献\s*$/m.exec(endnote);
    if (!sec) return '';
    const rest = endnote.slice(sec.index + sec[0].length);
    const nxt = /^##\s+/m.exec(rest);
    const refSec = nxt ? rest.slice(0, nxt.index) : rest;
    const numericLabels = (refSec.match(/^\s*\[\d+\]/gm) || []).length;
    const letterLabels = (refSec.match(/^\s*\[(?:L|D|C|先)\d+\]/gm) || []).length;
    if (numericLabels >= 3 && letterLabels === 0) {
      return `诊断：「参考文献」节有 ${numericLabels} 条数字标签 [N]，但正文用 [Lxx]——`
        + `本门要求文末条目**沿用论衡编号 [Lxx]**（GB/T 7714 只约束**著录格式**，不约束编号形态）。`
        + `修法：把 [N] 逐条改为 [Lxx]（按现有顺序一一对应，**禁止重排顺序**），不要另加重复行。`;
    }
    return '';
  })();
  const mExist1Sev = leaked.length + orphan2.length > 10 ? 'P0' : (leaked.length + orphan2.length > 3 ? 'P1' : 'P2');
  results.push({
    gate: 'M-Exist-1 引用双向对比',
    pass: leaked.length === 0 && orphan2.length === 0,
    detail: (mExist1Hint ? `${mExist1Hint} ｜ ` : '') + `漏引 ${leaked.length} / 孤儿 ${orphan2.length}`,
    severity: (leaked.length === 0 && orphan2.length === 0) ? '通过' : mExist1Sev,
  });
}

// === M-Form-10 索引段完整性（v2.5.2-dsh.17 新增）===
// 依据：三张卡模板都写着「索引段编号必须与正文条目一一对应（**一致性自检可加**『索引编号 = 实际编号』校验）」，
//   而下游 T4/T5 的 token 优化恰恰依赖「先读索引段、按编号定位」——**索引缺条 = 静默漏卡**，
//   最终以「漏引 / 孤儿」（M-Form-3 / M-Exist-1）的形式在审计阶段才爆出来，返工代价最高。
// 本项即是模板自己邀请的那条校验：索引段 ↔ 正文条目 ↔ 头部声明条数 三者对账。
try {
  const CARDS = [
    ['文献卡.md', 'literature/文献卡.md'],
    ['数据卡.md', 'data/数据卡.md'],
    ['案例卡.md', 'cases/案例卡.md'],
  ];
  const findings = [];
  const softFindings = [];
  const notes = [];       // 仅备注，**不影响通过/严重度**（如 0 条场景导致的卡片缺失，是合法的）
  let checked = 0;
  for (const [name, rel] of CARDS) {
    const p = findCard(name, rel);
    if (!p) { notes.push(`${name} 未找到（0 条场景或尚未进入检索阶段）`); continue; }
    checked++;
    const cardText = readFileSync(p, 'utf8');
    const lines = cardText.split('\n');
    const idx = indexSection(lines);
    if (!idx) { findings.push(`${name}: 缺「## 📇 索引段」标题`); continue; }
    const indexBlock = idx.body.join('\n');
    const idxIds = new Set([...indexBlock.matchAll(/\[([LDC])(\d+)\]/g)].map((m) => m[1] + m[2]));
    const bodyIds = new Set([...entryIds(cardText)].map((id) => id.slice(1, -1)));   // `[L01]` → `L01`（本段口径无方括号）
    const missing = [...bodyIds].filter((x) => !idxIds.has(x));       // 索引缺条 → 下游漏卡（硬）
    const extra = [...idxIds].filter((x) => !bodyIds.has(x));         // 索引悬空（软）
    const thin = indexBlock.split('\n').filter((l) => {
      if (!/\[([LDC])\d+\]/.test(l)) return false;
      return l.replace(/\[([LDC])\d+\]/, '').replace(/[｜|\s\-—–:：·]/g, '').length < 6;  // 编号后信息量不足
    });
    if (missing.length) findings.push(`${name}: 索引段缺 ${missing.length} 条（${missing.slice(0, 5).join(',')}）→ 下游按索引定位会漏卡`);
    if (extra.length) softFindings.push(`${name}: 索引段有 ${extra.length} 个编号在正文无对应条目（${extra.slice(0, 5).join(',')}）`);
    if (thin.length) softFindings.push(`${name}: ${thin.length} 行索引信息量不足（需 编号 + 主题 + 支撑论点）`);
    const headN = cardText.match(/(?:总条数|合计)[^\d]{0,10}(\d+)\s*条/);
    if (headN && bodyIds.size && Number(headN[1]) !== bodyIds.size) {
      findings.push(`${name}: 头部声明 ${headN[1]} 条 ≠ 正文条目 ${bodyIds.size} 条（best-effort 解析头部声明）`);
    }
  }
  if (checked === 0) {
    results.push({ gate: 'M-Form-10 索引段完整性', pass: true, detail: `N/A：三张卡均未找到（${notes[0] || '尚未进入检索阶段'}）`, severity: '通过' });
  } else {
    const hard = findings.length > 0;
    results.push({
      gate: 'M-Form-10 索引段完整性',
      pass: !hard && softFindings.length === 0,
      detail: [
        `已查 ${checked} 张卡`,
        hard ? `硬问题：${findings.slice(0, 3).join('；')}` : '索引与正文编号一一对应',
        softFindings.length ? `软提示：${softFindings.slice(0, 2).join('；')}` : '',
        notes.length ? `备注：${notes.join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard ? (findings.length > 2 ? 'P0' : 'P1') : (softFindings.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Form-10 索引段完整性', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Form-11 素材按需加载闭环（v2.5.2-dsh.17 新增）===
// 依据：05 卡要求 T5「先读各卡索引段 → 按大纲映射表**只读相关条目、不读全文**」，这条 token 优化的
//   收益此前**完全靠写手自述**——「按需加载」与「整卡通读」在产物上完全同形，无从核对（整卡通读
//   正是 T5 cacheRead 占子代理总量 76% 的成因）。本项用一份便宜留痕（`analysis/素材加载清单.md`）
//   把「到底加载了哪些编号」变成事实，三层判定：
//     ① 定稿正文引用的编号必须都在「## 已加载」集 → 否则「引了没读 = 引用不可信」（硬）
//     ② 「已加载」的编号必须在卡片正文条目里有对应 → 否则「幽灵编号 = 清单编造」（硬）
//     ③ 软提示：「读了不用」的编号（浪费上下文）/ 加载率 >90%（选择性不足，疑似整卡通读）
try {
  const projDir11 = dirname(dirname(draftPath));
  const listPath11 = [
    join(projDir11, 'analysis', '素材加载清单.md'),
    join(evDir, '素材加载清单.md'),
  ].find((p) => existsSync(p)) || null;
  // v18.0.0 修复（冲突⑦）：统一「素材编号全形态」正则，纳入基线编号 `[D-基-x-NN]` 与先行者 `[先NN]`。
  //   旧实现用 refsOf(body,'L'|'D'|'C') 三类编号 → 基线编号与先行者全部漏计（实战：本项目实际 40 条 vs 脚本计 30 条），
  //   导致「已加载 ⊆ 卡片」的核对面少 10 条（虽然 >90% 软提示结论巧合一致）。
  const REF_TOKEN = '[LDC]\\d+|D-基-[A-Z]-\\d+|先\\d+';
  const refRe11 = new RegExp('\\[(' + REF_TOKEN + ')\\]', 'g');
  const cited11 = new Set([...body.matchAll(refRe11)].map((m) => '[' + m[1] + ']'));
  // 卡片侧真源：正文条目编号（幽灵判定）+ 索引段编号（选择性判定）
  const cardEntryIds = new Set();
  const cardIndexIds = new Set();
  // v18.0.0：纳入 **先行者清单** —— `[先NN]` 编号不在三张素材卡内（存在 `literature/先行者清单.md`），
  //   否则 ghost 判定会把清单里的 [先01]-[先07] 误判为「清单编造」（假 P0）。
  for (const [name, rel] of CARD_SPECS) {
    const p = findCard(name, rel);
    if (!p) continue;
    const t = readFileSync(p, 'utf8');
    for (const id of idsByToken(t, REF_TOKEN)) cardEntryIds.add(id);
    const idx = indexSection(t.split('\n'));
    if (idx) {
      for (const m of idx.body.join('\n').matchAll(new RegExp('\\[(' + REF_TOKEN + ')\\]', 'g'))) cardIndexIds.add('[' + m[1] + ']');
    }
  }
  const findings11 = [];
  const soft11 = [];
  if (!listPath11) {
    if (cited11.size === 0) {
      results.push({ gate: 'M-Form-11 素材按需加载闭环', pass: true, detail: 'N/A：正文无素材引用且无加载清单（尚未进入写作阶段）', severity: '通过' });
    } else {
      findings11.push(`正文引用 ${cited11.size} 个素材编号，却无 analysis/素材加载清单.md——「按需加载」无留痕，无法区分「按需」与「整卡通读」`);
      results.push({
        gate: 'M-Form-11 素材按需加载闭环',
        pass: false,
        detail: findings11.join('；'),
        severity: 'P1',
      });
    }
  } else {
    const lt = readFileSync(listPath11, 'utf8');
    const ls2 = lt.split('\n');
    // 只取「## 已加载」段内的编号（「已跳过」等其它段不计入加载集，允许写编号解释为何不读）
    const hIdx11 = ls2.findIndex((l) => /^#{2,4}\s*已加载/.test(l));
    let loadedSeg;
    if (hIdx11 === -1) {
      findings11.push('加载清单缺「## 已加载」段标题（机检无从定位加载集）');
      loadedSeg = lt;
    } else {
      let e11 = sectionRange(ls2, hIdx11, /^#{2,4}\s/).end;
      loadedSeg = ls2.slice(hIdx11 + 1, e11).join('\n');
    }
    // v18.2.1：**支持范围写法** `[D01]-[D08]`（本轮实测踩到）——旧实现只按单编号全量匹配，
    //   范围写法只命中首尾两项，中间的 D02–D07 被判「引了没读 = 引用不可信」（假 P0）。
    //   范围展开在**同一字母**内进行；起止倒序或跨度 > 30 视为笔误，不展开（如实计入 findings）。
    const expandRanges = (seg) => {
      const extra = new Set();
      const bad = [];
      for (const m of seg.matchAll(/\[([LDC])(\d+)\]\s*[-–—~至]\s*\[([LDC])(\d+)\]/g)) {
        const [, a, n1, b, n2] = m
        if (a !== b) { bad.push(m[0]); continue }
        const lo = Number(n1), hi = Number(n2)
        if (hi < lo || hi - lo > 30) { bad.push(m[0]); continue }
        for (let i = lo; i <= hi; i++) extra.add(`[${a}${String(i).padStart(n1.length, '0')}]`)
      }
      return { extra, bad }
    }
    const { extra: rangeIds, bad: badRanges } = expandRanges(loadedSeg)
    const loaded11 = new Set([
      ...[...loadedSeg.matchAll(new RegExp('\\[(' + REF_TOKEN + ')\\]', 'g'))].map((m) => '[' + m[1] + ']'),
      ...rangeIds,
    ])
    if (badRanges.length) soft11.push(`加载清单含无法展开的范围写法：${badRanges.slice(0, 3).join(' ')}（请改为逐项列出）`)
    const notLoaded = [...cited11].filter((x) => !loaded11.has(x));
    const ghost = [...loaded11].filter((x) => cardEntryIds.size > 0 && !cardEntryIds.has(x));
    // v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
    //   **「白读」软提示排除「清单中已声明跳过」的编号**。清单契约允许另设 `## 已跳过` 段解释
    //   「为什么读了索引段却不引用某条」（§八）；写手常把「读过的索引段编号」与「实际未读的条目」
    //   混记在 `## 已加载` 里 → 旧实现对这些编号一律报「白读即为上下文浪费」= 噪声。
    //   实测 4 条命中里 [D12]/[D14] 即属此类（T5 v3 清单已把它们标为「已跳过」）。
    const skippedSeg11 = (() => {
      const h = ls2.findIndex((l) => /^#{2,4}\s*已跳过/.test(l));
      if (h === -1) return '';
      return ls2.slice(h + 1, sectionRange(ls2, h, /^#{2,4}\s/).end).join('\n');
    })();
    const skippedIds11 = new Set(
      [...skippedSeg11.matchAll(new RegExp('\\[(' + REF_TOKEN + ')\\]', 'g'))].map((m) => '[' + m[1] + ']'),
    );
    const unused = [...loaded11].filter((x) => !cited11.has(x) && !skippedIds11.has(x));
    if (notLoaded.length) findings11.push(`正文引用但清单未记「已加载」：${notLoaded.slice(0, 6).join(',')}（引了没读 = 引用不可信）`);
    if (ghost.length) findings11.push(`清单里的编号在卡片中无对应条目：${ghost.slice(0, 6).join(',')}（清单与素材卡不一致）`);
    if (unused.length) soft11.push(`${unused.length} 个编号「读了但正文未引用」（${unused.slice(0, 5).join(',')}）——白读即为上下文浪费`);
    //   v18.2.1（本轮实测反哺）：原阈值「卡池 ≥20 且加载率 >90%」在**短文 + 小卡池**场景必然误报——
    //   短测试卡池 20 条、正文引用 18 条（=90%）即触发「疑似整卡通读」，但短文本来就要用到大部分素材，
    //   这不是选择性不足。改为双条件：卡池 ≥30（有选择空间）**且** 正文 ≥3000 汉字（长文才有整卡通读的
    //   token 代价）才提示；否则如实跳过（不静默——下方 note 里写明因何未启用该软提示）。
    const bodyHan11 = (body.match(/[\u4e00-\u9fff]/g) || []).length
    // v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
    //   **比率对账先取交集**——「已加载」集可含**不在索引段**的编号（先行者清单条目、基线编号
    //   `[D-基-x-NN]` 等）。实测出现过 `已加载 54 / 索引 52`（**分子 > 分母**）→ 比率 >100%
    //   仍被当成「>90% 整卡通读」，属分母口径错误、结论不可复算。
    //   现改为：分子 = |已加载 ∩ 索引|；越出索引的部分另记一条软提示（不参与比率，避免污染结论）。
    const loadedInIndex11 = [...loaded11].filter((x) => cardIndexIds.has(x));
    const loadedBeyondIndex11 = [...loaded11].filter((x) => !cardIndexIds.has(x));
    const ratioCheckOn = cardIndexIds.size >= 30 && bodyHan11 >= 3000
    if (ratioCheckOn && loadedInIndex11.length / cardIndexIds.size > 0.9) {
      soft11.push(`已加载 ${loadedInIndex11.length} / 索引 ${cardIndexIds.size} 条（>90%）——选择性不足，疑似整卡通读（该条优化即为此设）`);
    }
    if (loadedBeyondIndex11.length) {
      soft11.push(`${loadedBeyondIndex11.length} 个已加载编号不在索引段内（${loadedBeyondIndex11.slice(0, 5).join(',')}）——已从比率对账中排除，请确认是否属先行者清单 / 基线编号`);
    }
    const ver11 = lt.match(/对应(?:正文)?版本[：:]\s*v?(\d+)/);
    if (ver11) {
      try {
        const draftsDir = join(projDir11, 'drafts');
        const newestDraft = existsSync(draftsDir)
          ? Math.max(0, ...readdirSync(draftsDir).map((f) => Number((f.match(/^初稿-v(\d+)\.md$/) || [])[1]) || 0))
          : 0;
        if (newestDraft && Number(ver11[1]) < newestDraft) {
          soft11.push(`清单标注「对应正文版本 v${ver11[1]}」落后于最新初稿 v${newestDraft}——留痕未随修订轮刷新`);
        }
      } catch { /* best-effort */ }
    }
    const hard11 = findings11.length > 0;
    results.push({
      gate: 'M-Form-11 素材按需加载闭环',
      pass: !hard11 && soft11.length === 0,
      detail: [
        `已加载 ${loaded11.size} 条 / 正文引用 ${cited11.size} 个`,
        hard11 ? `硬问题：${findings11.slice(0, 3).join('；')}` : '引用 ⊆ 已加载，加载集有卡片支撑',
        soft11.length ? `软提示：${soft11.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard11 ? (notLoaded.length + ghost.length > 3 ? 'P0' : 'P1') : (soft11.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Form-11 素材按需加载闭环', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-4 审计条目闭环（v2.5.2-dsh.17 新增）===
// 依据：07 卡早已规定「打回修订必须附结构化修订任务书（编号/严重度/位置/动作/验收标准/关闭状态）」，
//   但**没有任何脚本校验**；且 dsh.17 引入复核报告后出现「关闭状态」**双真源**（审计报告表列 ↔ 复核报告）。
// 本项把该契约变成机检：结构完整 + 编号唯一 + 编号在审计↔复核之间双向闭环 + 初轮不得预填「已关闭」。
try {
  const projectDir2 = dirname(dirname(draftPath));
  const auditsDir = auditsDirOf({ withEv: true });
  const audit = latestReport(auditsDir, '审计报告');
  const review = latestReport(auditsDir, '复核报告');
  const revNotes = existsSync(join(projectDir2, 'drafts'))
    ? readdirSync(join(projectDir2, 'drafts')).filter((f) => /^修订说明-.*\.md$/.test(f)) : [];

  if (!audit) {
    results.push({ gate: 'M-Exist-4 审计条目闭环', pass: true, detail: 'N/A：尚无审计报告（未进入 Phase 4）', severity: '通过' });
  } else {
    const text = readFileSync(audit.path, 'utf8');
    const isReject = /打回|必须修改清单|未通过/.test(text);
    const lines = text.split('\n');
    const hIdx = lines.findIndex((l) => /^#{2,4}\s*修订任务书/.test(l));
    const rows = [];
    let header = null;
    if (hIdx !== -1) {
      for (let i = hIdx + 1; i < lines.length; i++) {
        const l = lines[i];
        if (/^#{2,4}\s/.test(l)) break;
        if (!/^\s*\|/.test(l)) continue;
        // 单元格切列：`protect: true` 保护**转义竖线 `\|`** 与**行内代码块内的竖线**（验收标准可能写正则 `a|b|c`）
        const cells = tableCells(l, { protect: true });
        if (isSeparatorRow(cells)) continue;   // 分隔行
        if (!header && cells.some((c) => c.includes('编号'))) { header = cells; continue; }
        if (header) rows.push(cells);
      }
    }
    const colOf = (kw) => (header || []).findIndex((h) => kw.test(h));
    const iId = colOf(/编号/), iSev = colOf(/严重度/), iLoc = colOf(/改哪里|位置/), iAct = colOf(/怎么改|动作/), iAcc = colOf(/验收/), iStat = colOf(/关闭状态|状态/);
    const findings = [];
    const soft = [];
    if (isReject) {
      if (hIdx === -1 || !header) findings.push('结论为「打回修订」但缺「## 修订任务书」段或表格表头');
      else if ([iId, iSev, iLoc, iAct, iAcc, iStat].some((x) => x === -1)) {
        findings.push(`修订任务书缺必需列（现表头：${header.join(' / ')}）——需含 编号/严重度/改哪里/怎么改/验收标准/关闭状态`);
      } else {
        const ids = [];
        for (const r of rows) {
          if (!r[iId] || /^\.+$/.test(r[iId])) continue;
          const id = r[iId].replace(/[`*]/g, '').trim();
          ids.push(id);
          if (!/^P[012][-\u2011]?[0-9A-Da-d]+/.test(id)) soft.push(`编号「${id}」不符合 P0-n / P1-n 约定`);
          for (const [idx, label] of [[iLoc, '改哪里'], [iAct, '怎么改'], [iAcc, '验收标准']]) {
            if ((r[idx] || '').replace(/[\s.。…-]/g, '').length < 4) findings.push(`${id} 的「${label}」列空缺或过于笼统`);
          }
          const st = (r[iStat] || '').trim();
          if (!/已关闭|未关闭|待复核/.test(st)) soft.push(`${id} 的关闭状态「${st}」非固定词（应为 已关闭/未关闭/待复核）`);
          if (!review && /已关闭/.test(st)) findings.push(`${id} 在**尚无复核报告**时即标「已关闭」——关闭状态真源是复核报告，初轮只能填「待复核」`);
        }
        const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
        if (dup.length) findings.push(`编号重复：${[...new Set(dup)].join(',')}——同报告内编号必须唯一（跨轮新增须续号，不得复用）`);
        if (ids.length === 0) soft.push('修订任务书表格无有效条目行');
        if (review) {
          const rid = new Set([...readFileSync(review.path, 'utf8').matchAll(/P[012][-\u2011]?[0-9A-Da-d]+/g)].map((m) => m[0].replace(/\u2011/g, '-')));
          const miss = [...new Set(ids)].filter((x) => !rid.has(x.replace(/\u2011/g, '-')));
          if (miss.length) findings.push(`复核报告 ${review.name} 未覆盖 ${miss.length} 个审计编号：${miss.slice(0, 5).join(',')}`);
        } else if (revNotes.length) {
          findings.push(`已有修订说明（${revNotes.length} 份）但缺同号复核报告——修订复核必须落盘 audits/复核报告-v${audit.n}.md`);
        }
      }
    }
    const hard = findings.length > 0;
    results.push({
      gate: 'M-Exist-4 审计条目闭环',
      pass: !hard && soft.length === 0,
      detail: [
        `审计报告 ${audit.name}${review ? ` ↔ 复核报告 ${review.name}` : '（无复核报告）'}`,
        isReject ? (header ? `任务书 ${rows.length} 行` : '结论为打回') : '结论非打回（无需任务书）',
        hard ? `硬问题：${findings.slice(0, 3).join('；')}` : '条目契约与闭环成立',
        soft.length ? `软提示：${soft.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard ? (findings.length > 2 ? 'P0' : 'P1') : (soft.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-4 审计条目闭环', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-5 阶段闸门记录表（v2.5.2-dsh.17 新增）===
// 依据：两道主控闸门（T2.5 / T7.5）此前只有「主控 LLM 兜底执行」的伪代码，**没有任何落盘表单**——
//   闸门过没过、依据是什么，只留在会话里；M-Integrity-2 的 8 步判定也没有可核对的输入。
//   本项把闸门变成结构化记录（`audits/闸门记录-T2.5.md` / `audits/闸门记录-T7.5.md`，
//   真源 = `references/templates/闸门记录-template.md`，本节要求的检查项**从模板派生**，不写死）：
//     · 每道闸门的模板检查项都必须有对应行（漏项 = 闸门形同虚设）
//     · 「实据」列必须是**路径 / exit code / 命令**，不接受「已检查」这类自述（闸门留机械证据）
//     · 结论词固定（✓ / ✗ / N/A）；判 ✗ 的行必须写失败原因
//     · T7.5 另与 final/M-Gate-Report.json 对账：全 ✓ 却报告 exit≠0 = 自相矛盾（P0）
// 触发条件：项目已进入 Phase 4（audits/审计报告-*.md 存在）→ 两表单必须有；否则 N/A。
try {
  const projDir5 = dirname(dirname(draftPath));
  const auditsDir5 = auditsDirOf();
  const hasAudit5 = !!latestReport(auditsDir5, '审计报告');
  const tplPath5 = join(skillRoot, 'references', 'templates', '闸门记录-template.md');
  if (!hasAudit5) {
    results.push({ gate: 'M-Exist-5 阶段闸门记录表', pass: true, detail: 'N/A：尚无审计报告（未进入 Phase 4，闸门记录留待 T7.5）', severity: '通过' });
  } else if (!auditsDir5) {
    results.push({ gate: 'M-Exist-5 阶段闸门记录表', pass: false, detail: '找不到 audits/ 目录，无法定位闸门记录', severity: 'P1' });
  } else {
    const tplItems = { 'T2.5': [], 'T7.5': [] };
    const normLabel = (s) => String(s).replace(/[\s*`（）()【】\[\]：:、，,。.／/\-—_|]/g, '');
    // 模板表格首列 = 必需检查项（真源在模板；表格之外的行不计入 —— 防图例/说明表被当成检查项）
    if (existsSync(tplPath5)) {
      const tl = readFileSync(tplPath5, 'utf8').split('\n');
      let cur5 = null;
      let inTable5 = false;
      for (const l of tl) {
        const h = l.match(/^#{2,4}\s*(T2\.5|T7\.5)\b/);
        if (h) { cur5 = h[1]; inTable5 = false; continue; }
        if (/^#{2,4}\s/.test(l)) { cur5 = null; inTable5 = false; continue; }   // 进入下一节 → 停止收集
        if (!cur5) continue;
        if (!/^\s*\|/.test(l)) { if (inTable5) break; continue; }               // 表格结束后不再收集
        inTable5 = true;
        const c = tableCells(l);
        if (!c.length || isSeparatorRow(c)) continue;
        if (/检查项|^检查$/.test(c[0])) continue;                               // 表头
        if (c[0]) tplItems[cur5].push(c[0]);
      }
    }
    const findings5 = [];
    const soft5 = [];
    const detailBits = [];
    let contradict5 = false;   // 闸门结论 ↔ M 门报告自相矛盾 = 单独定为 P0（不随条数降级）
    for (const gateId of ['T2.5', 'T7.5']) {
      const fp = join(auditsDir5, `闸门记录-${gateId}.md`);
      if (!existsSync(fp)) {
        findings5.push(`缺 audits/闸门记录-${gateId}.md（${gateId === 'T2.5' ? 'T2 数据检索 → T4 前' : 'T7 审计 → T8 终检前'}的闸门无落盘留痕）`);
        continue;
      }
      const ls5 = readFileSync(fp, 'utf8').split('\n');
      const hIdx5 = ls5.findIndex((l) => /^\s*\|/.test(l) && /检查项/.test(l));
      if (hIdx5 === -1) { findings5.push(`闸门记录-${gateId}.md 缺「检查项」表格（表头须含 检查项 / 实据 / 结论）`); continue; }
      const header5 = tableCells(ls5[hIdx5]);
      const ci5 = (kw) => header5.findIndex((h) => kw.test(h));
      const iItem = ci5(/检查项/), iEv = ci5(/实据|证据|依据/), iRes = ci5(/结论|判定/), iWhy = ci5(/失败原因|原因|备注/);
      if (iEv === -1 || iRes === -1) { findings5.push(`闸门记录-${gateId}.md 表头须含「实据」「结论」列（现有：${header5.join(' / ')}）`); continue; }
      const rows5 = [];
      for (let i = hIdx5 + 1; i < ls5.length; i++) {
        const l = ls5[i];
        if (/^#{2,4}\s/.test(l)) break;
        if (!/^\s*\|/.test(l)) continue;
        const c = tableCells(l);
        if (isSeparatorRow(c)) continue;
        rows5.push(c);
      }
      const seen = rows5.map((r) => normLabel(r[iItem] || ''));
      for (const need of tplItems[gateId]) {
        const nn = normLabel(need);
        const hit = seen.some((s) => s && (s.includes(nn) || nn.includes(s)));
        if (!hit) findings5.push(`${gateId} 检查项缺「${need}」（模板为真源，逐项都要有行）`);
      }
      let resPass = 0;
      for (const r of rows5) {
        const item = (r[iItem] || '').trim();
        if (!item) continue;
        const ev = (r[iEv] || '').replace(/<[^>]*>/g, '').trim();   // 去掉 <…> 模板占位符：未填 = 不是证据
        const res = (r[iRes] || '').trim();
        // 实据必须是机械证据：路径 / exit code / 命令 / 哈希；纯自述不接受
        //   v18.0.5 修（第三方审计 P1-5）：删掉原先的裸 `\d`——它让「已检查 1 次」这类自述通过，
        //   与文档「不接受『已检查』这类自述」直接冲突。现在数字必须带量词/单位或与路径/命令/哈希同现。
        const evLooksReal =
          /[\\/]|exit\s*[=:：]?\s*\d|node\s+\S+\.mjs|m-gate|sha256|\.json|\.md|\.svg|\d+\s*(?:条|个|处|项|篇|例|%|倍|字|轮|步|节|章|页|行|次|份|组|种|点)/.test(ev) &&
          !/^(已|未)?(检查|核对|确认|自查)(完)?(毕|过)?$/.test(ev.replace(/\s/g, ''));
        if (ev.replace(/[\s.。…-]/g, '').length < 3 || !evLooksReal) {
          findings5.push(`${gateId}「${item}」的实据列不是机械证据（须写路径 / exit code / 命令，而非「已检查」自述）：现为「${ev.slice(0, 24)}」`);
        }
        if (!/^(✓|✅|通过|✗|❌|失败|不通过|N\/A|N／A|-)$/.test(res)) {
          soft5.push(`${gateId}「${item}」结论词「${res.slice(0, 12)}」非固定词（应为 ✓ / ✗ / N/A）`);
        } else if (/^(✓|✅|通过)$/.test(res)) {
          resPass++;
        } else if (/^(✗|❌|失败|不通过)$/.test(res)) {
          if (iWhy === -1 || (r[iWhy] || '').trim().length < 4) findings5.push(`${gateId}「${item}」判 ✗ 但未写失败原因`);
        }
      }
      if (rows5.length === 0) findings5.push(`闸门记录-${gateId}.md 表格无有效行`);
      detailBits.push(`${gateId} ${rows5.length} 行（✓ ${resPass}）`);
      // T7.5 ↔ M-Gate-Report.json 对账（自相矛盾即 P0）
      if (gateId === 'T7.5' && rows5.length > 0 && resPass === rows5.length) {
        const repPath5 = [join(dirname(draftPath), 'M-Gate-Report.json'), join(projDir5, 'final', 'M-Gate-Report.json')].find((p) => existsSync(p));
        if (repPath5) {
          try {
            const rj = JSON.parse(readFileSync(repPath5, 'utf8'));
            // v18.0.0 修复（自引用循环）：脚本报告的 `exit` 是**脚本机械值**，会随每次重跑变化；
            //   而 T7.5 闸门记录是**人工/主控当场写**的结论。若直接比对「闸门全 ✓ vs exit ≠ 0」，
            //   会遇到两重问题：① 脚本重跑（含 final-check 串联）会覆写报告，把 T8 裁定段冲掉；
            //   ② 判定依赖上一次跑分 → 形成「跑分低→判 P0→闸门不过→再跑分……」的自引用循环。
            // 现规则：**优先采信 T8 裁定段**（`_t8_conclusion`）——存在且 `true_p0 === 0` / `true_p1 === 0`
            //   时，闸门与报告视为一致（放行）；仅在无 T8 裁定段时才回退比对脚本 exit。
            // v18.0.5 加（第三方审计 P0-1）：T8 裁定**只在绑定同一版正文时**才算数——报告带
            //   `verdict_stale === true`（正文指纹与裁定时不符）时，回退比对 `script_exit_raw`，
            //   避免「旧裁定永久放行」使本分支永不可达。
            const t8 = rj._t8_conclusion;
            const t8Clean = t8 && Number(t8.true_p0) === 0 && Number(t8.true_p1) === 0 && rj.verdict_stale !== true;
            const mechanicalExit = typeof rj.script_exit_raw === 'number' ? rj.script_exit_raw : rj.exit;
            if (t8Clean) {
              soft5.push(
                `闸门 ↔ 报告对账：已按 T8 裁定段放行（true_p0=0 / true_p1=0；脚本 script_exit_raw=${rj.script_exit_raw ?? rj.exit}）`,
              );
            } else if (t8 && rj.verdict_stale === true) {
              contradict5 = true;
              findings5.push(
                `闸门记录-T7.5 全判 ✓，但 M-Gate-Report.json 的 T8 裁定段**已过期**（verdict_stale=true：${rj.verdict_stale_reason || '正文指纹不符'}）且本次机械值 script_exit_raw = ${mechanicalExit}——须 T8 就**本版正文**重新裁定（P0）`,
              );
            } else if (typeof rj.exit === 'number' && rj.exit !== 0) {
              contradict5 = true;
              findings5.push(
                `闸门记录-T7.5 全判 ✓，但 M-Gate-Report.json 的 exit = ${rj.exit}（非 0）且**无 T8 裁定段**——闸门结论与 M 门报告自相矛盾（P0）`,
              );
            }
          } catch { soft5.push('M-Gate-Report.json 无法解析，未做闸门↔报告对账'); }
        }
      }
    }
    if (!existsSync(tplPath5)) soft5.push('未找到 references/templates/闸门记录-template.md（检查项清单降级为仅结构校验）');
    const hard5 = findings5.length > 0;
    results.push({
      gate: 'M-Exist-5 阶段闸门记录表',
      pass: !hard5 && soft5.length === 0,
      detail: [
        detailBits.join(' / ') || '两表单均缺失',
        hard5 ? `硬问题：${findings5.slice(0, 3).join('；')}` : '闸门记录齐备且实据为机械证据',
        soft5.length ? `软提示：${soft5.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard5 ? (contradict5 || findings5.length > 3 ? 'P0' : 'P1') : (soft5.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-5 阶段闸门记录表', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-6 审稿报告与期刊匹配（v2.5.2-dsh.17 新增）===
// 依据：T9 审稿报告的 6 维度评分 + 建议词 + 期刊匹配表此前**零机械校验**——总评分可以是 6 个维度
//   凑不出来的数，期刊推荐可以是《期刊数据库》里根本不存在的刊名，综合匹配度可以不由公式得出。
//   本项做三件事：① 总分 == 6 维之和（算术自洽）；② 建议词与总分区间一致；③ 期刊匹配表**可复算**
//   （综合 = 0.5×主题 + 0.3×风格 + 0.2×归一化，容差 ±1.5）且刊名出自 `期刊数据库.md`。
// 触发条件：存在 audits/审稿报告-vN.md（T9 可选，未启用 → N/A）。
try {
  const projDir6 = dirname(dirname(draftPath));
  const auditsDir6 = auditsDirOf();
  const latest6 = latestReport(auditsDir6, '审稿报告');
  if (!latest6) {
    results.push({ gate: 'M-Exist-6 审稿报告与期刊匹配', pass: true, detail: 'N/A：无审稿报告（T9 未启用或未到 Phase 4.5）', severity: '通过' });
  } else {
    const rt = readFileSync(latest6.path, 'utf8');
    const findings6 = [];
    const soft6 = [];
    const DIMS = ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范'];
    const dimScores = [];
    for (const d of DIMS) {
      const m = rt.match(new RegExp(`${d}[^\\n]*?(\\d)\\s*/\\s*5`)) || rt.match(new RegExp(`${d}\\s*\\|\\s*(\\d)\\s*/\\s*5`));
      if (!m) soft6.push(`未找到「${d}」的 x/5 评分（模板 6 维须齐全）`);
      else dimScores.push(Number(m[1]));
    }
    const total6 = rt.match(/总评分[^\d]{0,8}(\d{1,2})\s*\/\s*30/) || rt.match(/总分[^\d]{0,12}(\d{1,2})\s*\/\s*30/);
    const declaredTotal = total6 ? Number(total6[1]) : null;
    if (declaredTotal === null) findings6.push('审稿报告缺「总评分 XX/30」');
    else if (dimScores.length === 6) {
      const sum = dimScores.reduce((a, b) => a + b, 0);
      if (sum !== declaredTotal) findings6.push(`总评分 ${declaredTotal}/30 ≠ 6 维之和 ${sum}（${DIMS.map((d, i) => `${d}${dimScores[i]}`).join('+')}）——评分表与总分自相矛盾`);
    }
    if (declaredTotal !== null) {
      const expect = declaredTotal >= 26 ? /accept/i : declaredTotal >= 21 ? /minor/i : declaredTotal >= 16 ? /major/i : /reject/i;
      if (!expect.test(rt)) soft6.push(`总分 ${declaredTotal} 对应的建议词（${expect.source.replace(/[/i]/g, '')}）在报告中未出现——建议与区间可能不一致`);
    }
    // 期刊匹配表
    const jLines = rt.split('\n');
    const jHead = jLines.findIndex((l) => /^\s*\|/.test(l) && /综合匹配度/.test(l));
    let jRows = [];
    if (jHead !== -1) {
      for (let i = jHead + 1; i < jLines.length; i++) {
        const l = jLines[i];
        if (!/^\s*\|/.test(l)) break;
        const c = tableCells(l);
        if (isSeparatorRow(c)) continue;
        jRows.push(c);
      }
    }
    const wantJournal = /启用期刊匹配|期刊匹配助手/.test(rt) || (() => {
      try { return /启用期刊匹配/.test(readFileSync(join(projDir6, '01-任务简报.md'), 'utf8')); } catch { return false; }
    })();
    if (jHead === -1) {
      if (wantJournal) findings6.push('任务简报已启用期刊匹配，但审稿报告无「综合匹配度」表（Top 3 缺失）');
    } else {
      if (jRows.length !== 3) soft6.push(`期刊匹配表 ${jRows.length} 行（应为 Top 3）`);
      if (jRows.length === 0) findings6.push('期刊匹配表存在表头但无数据行');
      const head6 = tableCells(jLines[jHead]);
      const col6 = (kw) => head6.findIndex((h) => kw.test(h));
      const iComp = col6(/综合/), iTheme = col6(/主题/), iStyle = col6(/风格/), iCycle = col6(/审稿周期/), iWhy2 = col6(/推荐理由|理由/);
      let dbText = '';
      try { dbText = readFileSync(join(skillRoot, 'references', '_shared', '期刊数据库.md'), 'utf8'); } catch { /* 降级 */ }
      const pct = (s) => { const m = String(s || '').match(/(\d+(?:\.\d+)?)\s*%/); return m ? Number(m[1]) : null; };
      for (const r of jRows) {
        const name = (r[0] || '').replace(/[*《》\s]/g, '');
        if (!name) { findings6.push('期刊匹配表有行缺刊名'); continue; }
        if (dbText && !dbText.includes(name.slice(0, Math.max(2, name.length - 1)))) {
          soft6.push(`「${r[0]}」在 期刊数据库.md 中查不到（疑似杜撰刊名，须以数据库为准）`);
        }
        const comp = pct(r[iComp]), theme = pct(r[iTheme]), style = pct(r[iStyle]);
        if (comp === null || theme === null || style === null) {
          findings6.push(`「${r[0]}」匹配度列缺百分比（综合/主题/风格都要有）`);
        } else if (declaredTotal !== null) {
          const normScore = Math.max(0, Math.min(1, (declaredTotal - 16) / 14));
          const expectComp = 0.5 * theme + 0.3 * style + 0.2 * normScore * 100;
          if (Math.abs(comp - expectComp) > 1.5) {
            findings6.push(`「${r[0]}」综合匹配度 ${comp}% ≠ 复算值 ${expectComp.toFixed(1)}%（=0.5×${theme} + 0.3×${style} + 0.2×${(normScore * 100).toFixed(1)}）——数字不可复算`);
          }
        }
        if (iCycle !== -1 && !/[0-9]/.test(r[iCycle] || '')) soft6.push(`「${r[0]}」审稿周期为空或无数值`);
        if (iWhy2 !== -1 && (r[iWhy2] || '').replace(/[\s.。…-]/g, '').length < 6) soft6.push(`「${r[0]}」推荐理由过短（须含主题契合 + 风格契合 + 周期依据）`);
      }
    }
    // ---- 审稿建议的「可消费 + 落地追踪」（v2.5.2-dsh.17 增补）----
    // 依据：审稿报告的「给作者的具体修改建议（按优先级）」是 T5/主控据以做「目标期刊适配修订」的
    //   唯一输入；若建议只写「建议加强论证」这类无定位、无动作的句子，下游无法消费，
    //   而报告表面完全正常。本项核：建议段存在 + 条目带定位（§/段落/章/行 或素材编号）+ 编号连续，
    //   并在发生修订轮时核「审稿建议是否进了修订回执」（防「建议提了没人接」）。
    const sugIdx = jLines.findIndex((l) => /^#{2,4}\s/.test(l) && /修改建议|建议（按优先级）|给作者/.test(l));
    if (sugIdx === -1) soft6.push('未见「给作者的具体修改建议」段（T5/主控无据以做期刊适配修订）');
    else {
      let sugEnd = jLines.length;
      for (let k = sugIdx + 1; k < jLines.length; k++) { if (/^#{2,4}\s/.test(jLines[k])) { sugEnd = k; break; } }
      const sugLines = jLines.slice(sugIdx + 1, sugEnd);
      const sugItems = sugLines.filter((l) => /^\s*(?:\d+[.、)]|[-*]\s)/.test(l) && l.replace(/[\s\-*\d.、)]/g, '').length > 6);
      if (sugItems.length === 0) soft6.push('「修改建议」段无有效条目（须按优先级逐条列）');
      else {
        const noLoc = sugItems.filter((l) => !/[§第]\s*[一二三四五六七八九十\d]+|段落|行\s*\d|章|\[(?:L|D|C)\d+\]/.test(l));
        if (noLoc.length) soft6.push(`${noLoc.length}/${sugItems.length} 条建议无定位（须写 §章节/段落/行号 或素材编号，否则 T5 无法照做）`);
      }
    }
    // 落地追踪：已有修订说明（说明发生过修订轮）时，修订回执应提到审稿意见
    try {
      const drafts10 = join(projDir6, 'drafts');
      if (existsSync(drafts10)) {
        const revNotes6 = readdirSync(drafts10).filter((f) => /^修订说明-.*\.md$/.test(f)).sort();
        if (revNotes6.length) {
          const lastNote = readFileSync(join(drafts10, revNotes6[revNotes6.length - 1]), 'utf8');
          if (!/审稿|期刊|T9|同行评审/.test(lastNote)) {
            soft6.push(`修订说明（${revNotes6[revNotes6.length - 1]}）未提及审稿意见——审稿建议未进修订回执（「建议提了没人接」）`);
          }
        }
      }
    } catch { /* 落地追踪为增强项，读不到就跳过 */ }
    const hard6 = findings6.length > 0;
    results.push({
      gate: 'M-Exist-6 审稿报告与期刊匹配',
      pass: !hard6 && soft6.length === 0,
      detail: [
        `${latest6.name}｜6 维 ${dimScores.length}/6｜总评分 ${declaredTotal ?? '缺失'}${jHead !== -1 ? `｜期刊表 ${jRows.length} 行` : ''}`,
        hard6 ? `硬问题：${findings6.slice(0, 3).join('；')}` : '评分自洽、期刊匹配可复算',
        soft6.length ? `软提示：${soft6.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard6 ? (findings6.length > 2 ? 'P0' : 'P1') : (soft6.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-6 审稿报告与期刊匹配', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-7 交付说明字段齐备（v2.5.2-dsh.17 新增；v18.0.5 更正字段数为 12）===
// 依据：`deliverables.md` 定义了 `final/交付说明.md` 的 **12 个固定字段**（T8 终检时机械填充；
//   dsh.17 由 11 显式化为 12——「证据包指纹」升为第 9 个、「终检结论」补两道闸门结论行；
//   v18.0.5 修第三方审计 P2-5：本节注释与模板头当时仍写 11，与模板实际 12 节自相矛盾），
//   但既无模板也无机检——每个项目的交付说明字段名与齐备程度全凭主控临场发挥，主人复核时
//   缺项不可发现（「固定字段」名不副实）。本项逐字段核验：存在 + 非空 + 证据包指纹占位符 +
//   主人决策记录覆盖四门（缺回填须显式标注「未留痕」，不得静默省略）。
// 触发条件：final/交付说明.md 存在（T8 已开始交付）；不存在 → N/A。
try {
  const ddPath = join(dirname(draftPath), '交付说明.md');
  const FIELD_KEYWORDS = [
    ['路径', /路径/], ['图件清单', /图件清单/], ['遗留风险', /遗留风险/],
    ['人工核验项', /人工核验/], ['数据溯源', /数据溯源/], ['成本指标', /成本指标/],
    ['反哺清单', /反哺清单|待 merge|待merge/], ['AI 使用披露', /AI 使用披露/],
    ['终检结论', /终检结论/], ['投稿就绪', /投稿就绪/], ['主人决策记录', /主人决策记录/],
  ];
  if (!existsSync(ddPath)) {
    results.push({ gate: 'M-Exist-7 交付说明字段齐备', pass: true, detail: 'N/A：尚无 final/交付说明.md（T8 尚未开始交付）', severity: '通过' });
  } else {
    const dt = readFileSync(ddPath, 'utf8');
    const dl = dt.split('\n');
    const findings7 = [];
    const soft7 = [];
    for (const [label, re] of FIELD_KEYWORDS) {
      const i = dl.findIndex((l) => /^#{1,6}\s|^\s*\*\*|^\s*\|/.test(l) && re.test(l));
      if (i === -1) { findings7.push(`缺固定字段「${label}」（deliverables.md 定为必填）`); continue; }
      // 字段正文 = 到下一个标题/表头行为止
      let j = dl.length;
      for (let k = i + 1; k < dl.length; k++) { if (/^#{1,6}\s/.test(dl[k])) { j = k; break; } }
      const raw7 = dl.slice(i + 1, j).join('\n');
      const bodyTxt = raw7.replace(/<[^>]*>/g, '').replace(/[|\s\-—–:：]/g, '');
      // ① 仍含 <…> 模板占位符 → 该字段没填（模板明确要求不得留占位符）
      // ② 去掉占位符后为空 → 阈值 1（允许「无」「未启用」这类**合法的一句话答复**）
      if (/<[^>]{1,60}>/.test(raw7)) findings7.push(`字段「${label}」仍含模板占位符（<…> 未填）`);
      else if (bodyTxt.length < 1) findings7.push(`字段「${label}」为空（仅标题无内容）`);
    }
    if (!/\[哈希校验待主人回填\]|sha256\s*[:：]?\s*[0-9a-f]{16,}/i.test(dt)) {
      findings7.push('缺「证据包指纹」段或 sha256 占位符 `[哈希校验待主人回填]`（M-Integrity-2 步骤 4 的输入）');
    }
    const dec = dl.findIndex((l) => /主人决策记录/.test(l));
    if (dec !== -1) {
      let dj = dl.length;
      for (let k = dec + 1; k < dl.length; k++) { if (/^#{1,6}\s/.test(dl[k])) { dj = k; break; } }
      const decTxt = dl.slice(dec, dj).join('\n');
      const missingGate = ['Phase 0', '2.5', '3.5', 'Phase 5'].filter((g) => !decTxt.includes(g));
      if (missingGate.length) findings7.push(`主人决策记录未覆盖：${missingGate.join(' / ')}（缺回填的门须显式标注「未留痕」，不得省略）`);
      else if (!/未留痕|通过|驳回/.test(decTxt)) soft7.push('主人决策记录既无决策词也无「未留痕」标注');
    }
    const hard7 = findings7.length > 0;
    results.push({
      gate: 'M-Exist-7 交付说明字段齐备',
      pass: !hard7 && soft7.length === 0,
      detail: [
        `12 固定字段（11 关键词字段 + 证据包指纹）实到 ${FIELD_KEYWORDS.length - findings7.filter((x) => x.startsWith('缺固定字段')).length}/${FIELD_KEYWORDS.length}${/\[哈希校验待主人回填\]|sha256\s*[:：]?\s*[0-9a-f]{16,}/i.test(dt) ? ' + 证据包指纹✓' : ' + 证据包指纹✗'}`,
        hard7 ? `硬问题：${findings7.slice(0, 3).join('；')}` : '固定字段齐备且有内容',
        soft7.length ? `软提示：${soft7.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard7 ? (findings7.length > 3 ? 'P0' : 'P1') : (soft7.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-7 交付说明字段齐备', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-8 批判报告覆盖（C1-C7；v2.5.2-dsh.17 新增）===
// 依据：06 卡明确要求「C1-C7 逐条执行」且每条按统一结构化清单写（论点定位/反方观点/你的论据/
//   攻击强度/建议），并声明「T7 审计员 + T5 写手可机械消费」——**但没有任何脚本核过它**。
//   实测风险：批判报告漏掉 C3（理论假设）或 C7（一处两用）时，从报告表面完全看不出来，
//   而 T7 的「T6 条目关闭复核」与 T5 的段级 diff 都以这些条目为输入。
// 本项机检：七节齐备（缺 → P1；>2 缺 → P0）、节体非空（软）、段级清单编号合法且唯一（P1/P2）、
//   每条清单至少含 3 项要素（软）。
// 触发条件：存在 analysis/批判报告-vN.md；无 → N/A（轻量档可跳，不算失败）。
try {
  const projDir8c = dirname(dirname(draftPath));
  const revDirs = [join(projDir8c, 'analysis'), join(projDir8c, 'audits'), dirname(draftPath)];
  const latestRevPath = revDirs.map((d) => latestReport(d, '批判报告')).find(Boolean) || null;
  if (!latestRevPath) {
    results.push({ gate: 'M-Exist-8 批判报告覆盖', pass: true, detail: 'N/A：无批判报告（轻量档跳过 Phase 3.6 或尚未到该阶段）', severity: '通过' });
  } else {
    const rt8 = readFileSync(latestRevPath.path, 'utf8');
    const rl8 = rt8.split('\n');
    const CIDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
    // 认标题 / 加粗标签 / 列表项 / 表格行四种写法（避免因格式差异误判「漏节」）
    const cLine = (c) => new RegExp(`^(?:#{1,6}\\s*|[-*]\\s*|\\|\\s*)?\\*{0,2}${c}(?![0-9])\\b`);
    const headLine = (c) => new RegExp(`^#{2,4}\\s*\\*{0,2}${c}(?![0-9])\\b`);
    const missing8 = CIDS.filter((c) => !rl8.some((l) => cLine(c).test(l)));
    const thin8 = [];
    for (const c of CIDS) {
      const hi = rl8.findIndex((l) => headLine(c).test(l));
      if (hi === -1) continue;                      // 非标题写法 → 跳过非空判定（避免误伤）
      const secBody = sectionRange(rl8, hi, /^#{2,4}\s/).body.join('\n').replace(/[\s|*`\-—–:：]/g, '');
      if (secBody.length < 40) thin8.push(c);
    }
    // **只统计「条目定义行」（行首即编号）**：06 卡模板要求「批判总结」里再逐条列一次「关闭状态」，
    //   若按全文出现次数判唯一性，会把**模板要求的重述**误判成「编号重复」（端到端测试反哺）。
    // 定义行 = 行首即编号，且**不是「关闭状态」清单行**（关闭状态行形如 `- [P0-C1-1] ✓已关闭（…）`）。
    // 06 卡模板要求「批判总结」里逐条列一次关闭状态 —— 那是**引用**，不该判成「同编号第二次定义」（端到端测试反哺）。
    // v18.0.0 修复（冲突②）：06 卡允许**标题式**写法 `### [P0-C1-1] …`，而旧正则只认「行首即编号」
    //   → T6 报告的 19 条段级条目被计为 **0 条**（假阴性），下游若以该计数为准会误判 T6 未完成。
    //   现放宽为「行首编号」∪「列表项」∪「二~四级标题后接编号」（保留「关闭状态」行排除逻辑于下方）。
    const entryLineRe = /^\s*(?:[-*]\s*|#{2,4}\s*)?\[(P[012])-(C\d+)-(\d+)\]/;
    const closeStateRe = /已关闭|未关闭|待复核/;
    const entries8 = rt8.split('\n')
      .filter((l) => !closeStateRe.test(l))
      .map((l) => entryLineRe.exec(l))
      .filter(Boolean)
      .map((m) => ({ id: `[${m[1]}-${m[2]}-${m[3]}]`, cat: m[2] }));
    const badCat8 = [...new Set(entries8.filter((e) => !CIDS.includes(e.cat)).map((e) => e.id))];
    const dup8 = (() => { const seen = new Set(), dup = new Set(); for (const e of entries8) { if (seen.has(e.id)) dup.add(e.id); seen.add(e.id); } return [...dup]; })();
    const ELEMS8 = [/论点定位/, /反方观点|攻击方式/, /论据|\[(?:L|D|C)\d+\]/, /攻击强度|严重度|强度/, /建议|处置/];
    const thinEntries8 = [];
    for (const e of entries8) {
      const i = rt8.indexOf(e.id);
      const seg = rt8.slice(i, i + 700);
      if (ELEMS8.filter((re) => re.test(seg)).length < 3) thinEntries8.push(e.id);
    }
    const findings8 = [];
    const soft8 = [];
    if (missing8.length) findings8.push(`批判维度缺 ${missing8.length} 节：${missing8.join(',')}（C1-C7 须逐条执行）`);
    if (dup8.length) findings8.push(`段级清单编号重复：${dup8.slice(0, 5).join(',')}——同报告内编号必须唯一`);
    if (thin8.length) soft8.push(`节体过短（内容不足）：${thin8.join(',')}`);
    if (badCat8.length) soft8.push(`清单编号类别非法（须 C1-C7）：${badCat8.slice(0, 5).join(',')}`);
    if (thinEntries8.length) soft8.push(`${thinEntries8.length} 条清单要素不足 3 项（须含 论点定位/反方观点/论据/攻击强度/建议）：${thinEntries8.slice(0, 4).join(',')}`);
    const hard8 = findings8.length > 0;
    results.push({
      gate: 'M-Exist-8 批判报告覆盖',
      pass: !hard8 && soft8.length === 0,
      detail: [
        `${latestRevPath.name}｜C1-C7 实到 ${CIDS.length - missing8.length}/7｜段级条目 ${entries8.length} 条`,
        hard8 ? `硬问题：${findings8.slice(0, 2).join('；')}` : '七维齐备且条目编号合法',
        soft8.length ? `软提示：${soft8.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard8 ? (missing8.length > 2 ? 'P0' : 'P1') : (soft8.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-8 批判报告覆盖', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-9 审计报告 G 项覆盖（v2.5.2-dsh.17 新增）===
// 依据：07 卡把「审计报告里的 G0-G14 检查项是否全覆盖」列为**验收标准**，quickref 要求
//   「必查项逐条执行，缺一不可」——**但没有任何脚本核过覆盖**。实测风险：审计报告只写了
//   G1-G7，G11（时效）/G12（信任级别）/G14（中文 AI 痕迹）整段缺席，报告读起来仍像「全项检查」。
// 本项机检：G0-G14 十五个主项都要出现**且邻域内有结论词**（缺项 → P1；>3 缺 → P0；有提及无结论 → P2）；
//   **且结论必须带实据**（v2.5.2-dsh.17 增补：同行/次行要有素材编号、文件路径、§ 或带量词的数字——
//   只写「通过」不给依据 = 自称通过 → P2）；G0.5 / G2.5 / G4-2 子项缺失 → P2。
// 触发条件：存在 audits/审计报告-vN.md；无 → N/A。
try {
  const auditsDir9 = auditsDirOf();
  const latest9 = latestReport(auditsDir9, '审计报告');
  if (!latest9) {
    results.push({ gate: 'M-Exist-9 审计报告 G 项覆盖', pass: true, detail: 'N/A：尚无审计报告（未进入 Phase 4）', severity: '通过' });
  } else {
    const at9 = readFileSync(latest9.path, 'utf8');
    const G_MAIN = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14'];
    const G_SUB9 = ['G0.5', 'G2.5', 'G4-2'];
    // 结论词（v17.0.0 补 ✓/✗：端到端测试发现审计报告惯用「**通过** ✓」与「✓（论据）」，旧表漏 ✓ 导致 G1 误判无结论）
    const VERDICT9 = /通过|不通过|合规|违规|达标|未达标|PASS|FAIL|⚠|✅|❌|✓|✗|N\/A|部分|已核|未核|无问题|有问题/;
    const at9Lines = at9.split('\n');
    // 实据标记：素材编号 / 文件路径 / § / exit code / **带量词的数字**（裸数字不算——G 编号自带的数字已剥掉）
    // 实据标记（v17.0.0 扩容：端到端测试发现「≤1 周」「8 条」类量词不在原表内 → 误判「无实据」）
    const EVID9 = /\[(?:L|D|C|先)\d+\]|\.md\b|\.json\b|\.svg\b|\/|§|exit\s*\d|\d+\s*(?:条|个|处|项|篇|例|%|倍|字|周|月|年|天|次|段|行|份|名|位|张|轮|步|节|章|页|则|组|种|点|\/)/;
    const absent9 = [];
    const noVerdict9 = [];
    const noEvidence9 = [];
    for (const id of G_MAIN) {
      const esc9 = id.replace(/[.-]/g, (c) => `\\${c}`);
      const re9 = new RegExp(`(?<![A-Za-z0-9])${esc9}(?![0-9.])`);
      const hitLines = [];
      at9Lines.forEach((l, i) => { if (re9.test(l)) hitLines.push(i); });
      if (hitLines.length === 0) { absent9.push(id); continue; }
      // 结论词须在**同一行或紧接着的下一行**（覆盖「- **G7**：通过」「| G7 | 通过 |」「### G7 \n 结论：通过」三种写法）
      // 结论词 / 实据各自判定（v17.0.0 修复，端到端测试反哺）：
      //   报告里 G0 会出现两次 —— ① 节标题 `## G0 覆盖度`（行 5）；② 条目行 `- **G0**：… **通过** ✓。`（行 7）。
      //   旧实现「取第一个命中行 + 三行窗口」→ 窗口落在标题上 → 结论在窗口内成立，但**实据在标题行上必然为空**
      //   → 14 项被误报「结论无实据」。现改为：**逐命中行各取三行窗口，结论与实据分别在任一窗口中成立即可**。
      let verdictOk = false, evidOk = false;
      for (const i of hitLines) {
        const win = at9Lines.slice(i, i + 3).join('\n').replace(new RegExp(esc9, 'g'), '');
        if (VERDICT9.test(win)) verdictOk = true;
        if (EVID9.test(win)) evidOk = true;
      }
      if (!verdictOk) noVerdict9.push(id);
      else if (!evidOk) noEvidence9.push(id);
    }
    const absentSub9 = G_SUB9.filter((id) => {
      const esc9 = id.replace(/[.-]/g, (c) => `\\${c}`);
      return !new RegExp(`(?<![A-Za-z0-9])${esc9}(?![0-9.])`).test(at9);
    });
    const findings9 = [];
    const soft9 = [];
    if (absent9.length) findings9.push(`G 项未覆盖 ${absent9.length} 个：${absent9.join(',')}（quickref 要求逐条执行、缺一不可）`);
    if (noVerdict9.length) soft9.push(`${noVerdict9.join(',')} 有提及但邻域无结论词（须写 通过/不通过/N/A + 证据）`);
    if (noEvidence9.length) soft9.push(`${noEvidence9.join(',')} 的结论无实据（须给素材编号 / 文件路径 / § / 带量词的数字，不能只写「通过」）`);
    if (absentSub9.length) soft9.push(`子项未覆盖：${absentSub9.join(',')}`);
    const hard9 = findings9.length > 0;
    results.push({
      gate: 'M-Exist-9 审计报告 G 项覆盖',
      pass: !hard9 && soft9.length === 0,
      detail: [
        `${latest9.name}｜G0-G14 实到 ${G_MAIN.length - absent9.length}/15${noEvidence9.length ? `（${noEvidence9.length} 项结论无实据）` : ''}`,
        hard9 ? `硬问题：${findings9[0]}` : (noEvidence9.length ? '十五项已覆盖且各有结论，部分结论缺实据' : '十五项全覆盖、各有结论与实据'),
        soft9.length ? `软提示：${soft9.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard9 ? (absent9.length > 3 ? 'P0' : 'P1') : (soft9.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-9 审计报告 G 项覆盖', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-10 大纲 §11 精简段完整性（v2.5.2-dsh.17 新增）===
// 依据：04/05 卡定案「T5 只读 `analysis/分析大纲.md` 末尾 §11 写手版精简段（≈60 行），完整大纲按需」
//   —— 这条是**T5 上下文 50K 大头的根治手段**，但 §11 自身是否真的含齐六个要素（论证主线 /
//   论点-论据映射表 / 反方规划要点 / 字数预算 / 禁做项 / 承重墙清单）**从来没被核过**。
//   实测风险：§11 缺要素时 T5 只能**回退整读大纲**——省 token 的机制静默失效，而产物上看不出来。
// 本项机检：段落存在（缺 → P2，未启用精简段的老项目不判死）、六要素齐备（缺 ≥3 → P0，缺 1-2 → P1）、
//   段落非空（<5 行 → P1）、段落不在文件末尾（其后还有 >20 行的实质章节 → P2，与「末尾段」口径冲突）、
//   段落过长（>120 行 → P2，失去「精简」意义）。
try {
  const projDir10 = dirname(dirname(draftPath));
  const outline10 = [join(projDir10, 'analysis', '分析大纲.md'), join(evDir, '分析大纲.md')]
    .find((p) => existsSync(p)) || null;
  if (!outline10) {
    results.push({ gate: 'M-Exist-10 大纲 §11 精简段', pass: true, detail: 'N/A：未找到分析大纲（尚未进入 Phase 2）', severity: '通过' });
  } else {
    const ol10 = readFileSync(outline10, 'utf8').split('\n');
    const hIdx10 = ol10.findIndex((l) => /^#{2,4}\s/.test(l) && /写手版|精简段/.test(l));
    if (hIdx10 === -1) {
      results.push({
        gate: 'M-Exist-10 大纲 §11 精简段',
        pass: false,
        detail: '大纲缺「写手版精简段」标题（T5 按 §11 定位会找不到 → 回退整读大纲，token 优化失效）',
        severity: 'P2',
      });
    } else {
      const lvl10 = (/^(#{1,6})/.exec(ol10[hIdx10]) || [])[1].length;
      let eIdx10 = ol10.length;
      const re10 = new RegExp(`^#{1,${lvl10}}\\s`);
      let nextHeading10 = -1;
      // v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
      //   **寻找「下一标题」时必须跳过围栏代码块**——精简段正文常整体包在 ```markdown 围栏里，
      //   而围栏内的 `# T5 写手 v1 精简段（≤60 行）` 这类**一级标题**会被 `^#{1,lvl}\s` 命中
      //   → 段落在第 2 行即被截断 → 实测「精简段 2 行 / 六要素实到 0/6」**假 P0**
      //   （真值：围栏内 48 行、六要素齐备，T5 按 `## §11` 定位读取完全正常）。
      //   围栏开合用**行首 ``` **计数（奇数个即处于围栏内）。
      let inFence10 = false;
      for (let i = hIdx10 + 1; i < ol10.length; i++) {
        if (/^\s*```/.test(ol10[i])) { inFence10 = !inFence10; continue; }
        if (!inFence10 && re10.test(ol10[i])) { nextHeading10 = i; break; }
      }
      if (nextHeading10 !== -1) eIdx10 = nextHeading10;
      const seg10 = ol10.slice(hIdx10 + 1, eIdx10);
      const segText10 = seg10.join('\n');
      const rows10 = seg10.filter((l) => l.trim()).length;
      const ELEMS10 = [
        ['论证主线', /主线/],
        ['论点-论据映射表', /映射/],
        ['反方规划要点', /反方/],
        ['字数预算', /字数/],
        ['禁做项', /禁做|禁止/],
        ['承重墙清单', /承重墙/],
      ];
      const missing10 = ELEMS10.filter(([, re]) => !re.test(segText10)).map(([n]) => n);
      // 映射表要有真表格（表头含论点 + 至少一行含素材编号）
      const hasTable10 = /\|[^\n]*论点[^\n]*\|/.test(segText10) && /\[(?:L|D|C)\d+\]/.test(segText10);
      // 字数预算要有数字
      // 允许「### 字数预算」标题换行后才是数字（端到端测试发现：原正则要求同行，标题式写法被误判「未见数字」）
      const budgetNumeric = /字数[\s\S]{0,40}?\d/.test(segText10);
      const findings10 = [];
      const soft10 = [];
      const notes10 = []; // v18.0.0：备注（不计失败）——用于「两条规范自相矛盾」类项
      if (rows10 < 5) findings10.push(`精简段仅 ${rows10} 行实质内容（须 ≈60 行且含六要素）`);
      if (missing10.length >= 3) findings10.push(`缺 ${missing10.length} 个要素：${missing10.join(',')}（六要素：论证主线 / 论点-论据映射表 / 反方规划要点 / 字数预算 / 禁做项 / 承重墙清单）`);
      else if (missing10.length) findings10.push(`缺要素：${missing10.join(',')}`);
      if (!hasTable10) soft10.push('未见「论点-论据映射表」真表格（表头含论点 + 行内含素材编号）');
      if (!budgetNumeric) soft10.push('字数预算未见数字');
      if (rows10 > 120) soft10.push(`精简段 ${rows10} 行过长（≈60 行为准，过长则失去「只读精简段」的意义）`);
      if (nextHeading10 !== -1 && ol10.slice(nextHeading10).filter((l) => l.trim()).length > 20) {
        // v18.0.0 修复（冲突③）：本项**不再判 P2**，改为**备注**（notes10）。
        //   原因：04 卡模板本身要求 §11 之后还有 F3 早期框架锁定检查（必填段），
        //   「§11 位于文件末尾」与「F3 检查为必填」两条规范**自相矛盾**——每篇论文都会稳定产生一条无法关闭的 P2。
        //   T5 是按「## §11 标题」定位读取的，不依赖「文件末尾」这一位置属性，故位置偏差不构成质量缺陷。
        notes10.push(
          '备注（不计失败）：精简段之后还有 >20 行实质章节——与「末尾 §11」口径冲突，但 04 卡模板要求 F3 检查为必填段，故本项仅作备注；T5 按「## §11」标题定位读取不受影响',
        );
      }
      const hard10 = findings10.length > 0;
      results.push({
        gate: 'M-Exist-10 大纲 §11 精简段',
        pass: !hard10 && soft10.length === 0,
        detail: [
          `${outline10.split(/[\\/]/).pop()}｜精简段 ${rows10} 行｜六要素实到 ${ELEMS10.length - missing10.length}/6`,
          hard10 ? `硬问题：${findings10.slice(0, 2).join('；')}` : '六要素齐备',
          soft10.length ? `软提示：${soft10.slice(0, 2).join('；')}` : '',
          notes10.length ? notes10[0] : '',
        ].filter(Boolean).join(' ｜ '),
        severity: hard10 ? (missing10.length >= 3 ? 'P0' : 'P1') : (soft10.length ? 'P2' : '通过'),
        ...(notes10.length ? { notes: notes10 } : {}),
      });
    }
  }
} catch (e) {
  results.push({ gate: 'M-Exist-10 大纲 §11 精简段', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Exist-2 证据包完整性（v18.0.5：递归统计 + 布局异常单列；v18.2.2：阶段感知）===
const files = walkMd(evDir);
const empty = files.filter((f) => { try { return statSync(f).size === 0; } catch { return false } });
const relOf = (f) => f.slice(evDir.length + 1).replaceAll('\\', '/');
// v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
//   **阶段感知——被审对象在 `drafts/` 阶段时，空证据包记 N/A 而非 P0**。
//   证据包由 **T8 终检阶段** 的 `build-evidence-bundle.mjs` 生成；而 T7 审计的对象是
//   `drafts/初稿-vN.md`，此时 `final/证据包/` 本就**还未生成**——旧实现一律判
//   「0 个 .md 文件 → P0」，于是该 P0 从 Phase 4 起就挂在报告里，T5 修订轮**无法关闭**
//   （它不属于稿件缺陷，而属于「顺序没到」），最终只能写进 Acknowledged Limitations。
//   本项与 `[报告后激活]` 同族，只是方向相反：**「产物尚未到期的门」不应在早期阶段判死**。
//   同文件开头的「证据包完整性前置提示」（EV_REQUIRED 段）已定过同一原则：
//   「证据包在 build-evidence-bundle.mjs 跑之前本就可能是空目录——中止会把『顺序没到』误报成『路径传错』」。
//   故：被审正文在 `drafts/` 且证据包为空 → N/A（pass=true）；其余情况维持原判（P0/P1）。
const isDraftStageAudit = /[\\/]drafts[\\/]/.test(draftPath);
if (files.length === 0 && isDraftStageAudit) {
  results.push({
    gate: 'M-Exist-2 证据包完整性',
    pass: true,
    detail: 'N/A：证据包为空且被审对象位于 drafts/（Phase ≤4 审计场景）——证据包由 T8 终检的 build-evidence-bundle.mjs 生成，届时重跑本项自动转实检',
    severity: '通过',
  });
} else {
  results.push({
    gate: 'M-Exist-2 证据包完整性',
    pass: files.length > 0 && empty.length === 0 && !layoutAnomaly,
    detail:
      `${files.length} 个 .md 文件` +
      (empty.length ? `，空文件: ${empty.map(relOf).join(',')}` : '，无空文件') +
      (layoutAnomaly ? ` ｜ 布局异常（P1）：${layoutAnomaly}` : ''),
    severity: (files.length === 0 || empty.length > 0) ? 'P0' : (layoutAnomaly ? 'P1' : '通过'),
  });
}

// === M-Exist-3 [Dxx] 正文↔数据卡 引用闭环（v2.5.2-dsh.5 加严重度评级；v18.0.3 更名对齐实装）===
// 命名说明（v18.0.3）：本项旧名「信任级别一致性」，但它**只做引用闭环**（正文 [Dxx] ↔ 数据卡条目），
//   信任级别由 M-Form-6（独立信任级别段）+ G12（审计层）承担。文档已同步更名（M-Gate-Algorithm.md）。
if (dataCard) {
  const intextD = new Set(refsOf(bodyProse, 'D').map((s) => s.match(/\d+/)[0]));
  const cardD = new Set(dataCardIds(dataCard));   // v18.0.3：改用 _lib/refs.mjs 真源（旧版在此处重写正则）
  const missing = [...intextD].filter((d) => !cardD.has(d));
  const mExist3Sev = missing.length > 5 ? 'P0' : (missing.length > 2 ? 'P1' : (missing.length > 0 ? 'P2' : '通过'));
  results.push({
    gate: 'M-Exist-3 引用闭环',
    pass: missing.length === 0,
    detail: missing.length ? `正文引 [Dxx] ${missing.length} 条在数据卡中无对应条目` : '全部 [Dxx] 在数据卡有对应',
    severity: mExist3Sev,
  });
} else {
  results.push({
    gate: 'M-Exist-3 引用闭环',
    pass: false,
    detail: layoutAnomaly ? `数据卡定位失败（证据包布局异常：${layoutAnomaly}）` : '数据卡不存在（证据包与项目 data/ 均无）',
    severity: 'P0',
  });
}

// === M-Integrity-1 T2.5 完整性门（脚本佐证；v2.5.2-dsh.17 补两次关键对账）===
// 自省审计发现：旧版只核「任务简报存在且有子问题」，严重度恒为 'LLM 兜底' → **永不 P0/P1**；
//   而 M-Gate-Algorithm 的 M-Integrity-1 明写「单子项失败 P0（信任级别缺失 / 数据条目不足）」——
//   文档承诺的 P0 在脚本里不可达，「佐证」等于什么也没佐证。现补两次对账（文档步骤 2-6 口径）：
//     ① 数据条目数（[Dxx] 编号并集 ∪ 表格 `| 1.x |` 行）≥ 任务简报「需找数据点」之和 → 不足 P0
//     ② 数据卡缺失 → P0；数据卡存在但 M-Form-6（独立信任级别段）未过 → P0
//   仍保留「最终由主控 L4 跨文件判断」的定位：脚本只判这两项可机械化的对账。
let briefData = { hasBrief: false, subclaims: 0, minDataPoints: 0, placeholder: 0 };
try {
  // v18.0.0 修复（P0-3）：旧实现 `draftPath.replace(/final[\\/]定稿\.md$/, '01-任务简报.md')`
  //   **只对 `final/定稿.md` 生效**；被审对象为 `drafts/初稿-vN.md` 时替换不命中 → briefPath 退回初稿自身路径
  //   → 把初稿当简报读 → ① 常驻误报「研究问题段缺失」；② needsT2=0 使「数据条目 ≥ 需求」比较短路
  //   → **该门在 Phase 4 场景事实上静默失效**（实战：本轮审计 drafts/初稿-v1.md 时即如此，因数据远超需求而侥幸无损失）。
  // v18.0.2：实现提到模块级（findBriefUpward），供 M-Form-9 复用——同一 bug 的第二份拷贝已一并修掉。
  const briefPath = findBriefUpward(dirname(draftPath));
  // 自检：解析结果不得与被审正文同路径（同路径 = 「把正文当简报读」）→ 直接报参数/解析错误，禁止静默降级
  if (briefPath && briefPath === draftPath) {
    console.error(
      `M-Integrity-1 解析错误：任务简报路径与被审正文相同（${briefPath}）\n` +
        `  —— 说明未能在项目目录中找到 01-任务简报.md，请检查项目目录结构（应为 run/<项目名>/01-任务简报.md）`,
    );
    process.exit(10);
  }
  if (briefPath && existsSync(briefPath)) {
    briefData.hasBrief = true;
    briefData.briefPath = briefPath; // 留痕：供报告与复核追溯简报真源
    const briefText = readFileSync(briefPath, 'utf8');
    // 子问题编号兼容：「子问题 A/B/C」（v2.5.2-dsh.5 模板规范）∪「S1/S2」（v2.5.2-dsh.4 表格旧格式）
    const letterSub = [...briefText.matchAll(/子问题\s*([A-Z一二三四五六七八九十\d]+)/g)].map((m) => m[1]);
    const sSub = [...briefText.matchAll(/^[\s|]*S(\d+)\s/gm)].map((m) => `S${m[1]}`);
    briefData.subclaims = new Set([...letterSub, ...sSub]).size;
    // 需找数据点：已填数字「≥N」求和；占位符「≥____」单列计数（模板未填时如实提示，而非误报 0）
    // v18.2.1：**容忍「需找数据点：≥ 3」这类带冒号/破折号的写法**——模板给的是无冒号形态，
    //   但主控手写简报时极易补一个冒号，旧正则 `需找数据点\s*[≥>]` 在「…点：≥」上直接失配
    //   → 需求总数记 0 → M-Integrity-1 假报「任务简报未见数据需求」（本轮实测踩到）。
    // v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
    //   **修「同一需求写两处 → 双重计数」假 P0**——`任务简报-template.md` **自身规定**「需找数据点 ≥N」写两处：
    //     ① 研究问题段：逐子问题各一条（模板 4-5 条）；
    //     ② 数据/文献/案例需求段：写总量一条（模板「**数据**（需找数据点 ≥N）」）。
    //   旧实现把两处的匹配**一律求和** → 实测 3+6+8（子问题）+ 25（总量）= **42**，
    //   而作者声明的真实需求是 **25** → 数据卡 32 条被判「32 < 42 条」→ T2.5 步骤 4 触发
    //   「数据不完整 → 触发 T2 重检索」**假 P0**（M 门 exit 2 永不可解，T8 只能写 Acknowledged Limitations）。
    //   现规则：**按「行归属」分组，取两组之和的较大者**——
    //     ① `agg`    = 不在「子问题」行上的需求量之和（= 需求段声明的总量）；
    //     ② `scoped` = 在「子问题」行上的需求量之和（= 逐子问题的分配量）；
    //     需求 = max(agg, scoped)；两组皆空 → 0（如实报「未见数据需求」，不臆造）。
    //   取 max 而非「总量优先」的理由：作者把分配量写得比声明总量更大时，按更严的一方对账
    //   ——宁可要求偏严，也不产生「假通过」。
    const NEED_RE = /需找数据点[^\d≥>]{0,4}[≥>]\s*(\d+)/g;
    const needSum = (lines) => lines
      .flatMap((l) => [...l.matchAll(NEED_RE)])
      .map((m) => parseInt(m[1], 10)).reduce((a, b) => a + b, 0);
    const briefLines = briefText.split('\n');
    const aggNeed = needSum(briefLines.filter((l) => !/子问题/.test(l)));
    const scopedNeed = needSum(briefLines.filter((l) => /子问题/.test(l)));
    briefData.minDataPoints = Math.max(aggNeed, scopedNeed);
    briefData.needAgg = aggNeed;        // 留痕：需求段声明的总量
    briefData.needScoped = scopedNeed;  // 留痕：逐子问题分配量之和
    briefData.needSource = aggNeed === 0 && scopedNeed === 0
      ? '未声明'
      : (aggNeed >= scopedNeed ? '需求段总量' : '逐子问题分配量之和');
    briefData.placeholder = (briefText.match(/需找数据点[^\d≥>]{0,4}[≥>]\s*_+/g) || []).length;
  }
} catch {}
{
  // ① 数据条目数（双格式并集；与 M-Gate-Algorithm M-Integrity-1 步骤 2 同口径）
  let dataEntries = 0;
  if (dataCard) {
    const idSet = new Set(dataCardIds(dataCard));
    const tableRows = (dataCard.match(/^\|\s*\d+\.\d+\s*\|/gm) || []).length;
    dataEntries = idSet.size + tableRows;
  }
  const needsT2 = briefData.minDataPoints;
  const mForm6 = results.find((r) => r.gate.startsWith('M-Form-6'));
  const mForm6Bad = !!mForm6 && mForm6.pass !== true;
  const hardWhy = [];
  if (!briefData.hasBrief) hardWhy.push('任务简报缺失（无「需找数据点」可比对）');
  else if (briefData.subclaims === 0) hardWhy.push('任务简报未见子问题（研究问题段缺失）');
  if (dataCard && needsT2 > 0 && dataEntries < needsT2) {
    hardWhy.push(`数据条目 ${dataEntries} 条 < 简报需求 ${needsT2} 条（T2.5 步骤 4：数据不完整 → 触发 T2 重检索）`);
  }
  if (!dataCard) hardWhy.push('数据卡不存在（T2.5 步骤 1）');
  if (mForm6Bad) hardWhy.push('信任级别不完整（M-Form-6 未过 → T2.5 步骤 5）');
  // 「简报缺失 / 缺研究问题段」属差序输入，只记 LLM 兜底；数据侧三项 = 文档承诺的 P0
  const hardHits = hardWhy.filter((w) => !/任务简报缺失|未见子问题/.test(w)).length;
  results.push({
    gate: 'M-Integrity-1 T2.5 完整性',
    pass: hardWhy.length === 0,
    detail: briefData.hasBrief
      ? `任务简报 ${briefData.subclaims} 子问题 / 需找数据点 ${needsT2} 条${briefData.placeholder ? `（${briefData.placeholder} 处占位未填）` : ''}｜数据卡 ${dataEntries} 条`
        + (hardWhy.length ? ` ｜ 硬问题：${hardWhy.slice(0, 2).join('；')}` : ' ｜ 条目数与信任级别对账通过（脚本佐证，主控 L4 跨文件判断）')
      : '任务简报不存在（脚本佐证，主控 L4 跨文件判断）',
    severity: hardHits > 0 ? 'P0' : 'LLM 兜底',
  });
}

// === 总判定：exit code + 严重度统计（soft=LLM 兜底不 gate，单独 bucket；total=pass+p0+p1+p2+soft+skips）===
const skips = results.filter((r) => r.pass === 'SKIP').length;
const pass = results.filter((r) => r.pass === true).length;
const fail = results.filter((r) => r.pass === false);
const soft = fail.filter((r) => r.severity === 'LLM 兜底').length;
const hard = fail.filter((r) => r.severity !== 'LLM 兜底');

// === 激活时序标记（v18.0.0 新增，冲突⑪）===
// 实战教训：M-Exist-4/5/6/9 的前提均为「报告文件已落盘」（审计报告 / 审稿报告等）——
//   主控在 Phase 4 预跑时四项全 N/A；**报告一落盘，重跑同一命令立刻变化**
//   （实战本轮：T7 报告落盘 → M-Exist-9 转通过、M-Exist-4 进入实检、**M-Exist-5 由 N/A 直接转 P0**）。
//   后果：① 任何时刻的 M 门结果都不是稳定量；② 下游易误读为「T7 落盘 = 新增了 P0」。
// 现规则：凡「因报告落盘而由 N/A 转为实检」的项，在 detail 前置 `[报告后激活]` 标记，
//   便于区分「稿件缺陷」与「履历性新增」。**主控取闸门口径时须在相关报告落盘后重跑一次。**
const REPORT_ACTIVATED = ['M-Exist-4', 'M-Exist-5', 'M-Exist-6', 'M-Exist-9'];
for (const r of results) {
  if (REPORT_ACTIVATED.some((g) => r.gate.startsWith(g)) && !/^N\/A/.test(r.detail) && !/^\[报告后激活\]/.test(r.detail)) {
    r.detail = '[报告后激活] ' + r.detail;
  }
}

const p0 = hard.filter((r) => r.severity === 'P0').length;
const p1 = hard.filter((r) => r.severity === 'P1').length;
const p2 = hard.filter((r) => r.severity === 'P2').length;
// 退出码语义（v2.5.2-dsh.13 修订，回应审计 P1「exit 0 与『任何一项不过都不得标记完成』矛盾」）：
//   0 = 全项通过（无失败、无 SKIP）｜1 = 存在 P1 失败｜2 = 存在 P0 失败
//   3 = 仅 P2 / LLM 兜底 / SKIP —— 需 LLM 复核，**不得**当作「通过」（旧版一律 exit 0）｜10 = 参数/路径错误
const anyFail = results.some((r) => r.pass === false);
const exitCode = p0 > 0 ? 2 : (p1 > 0 ? 1 : (anyFail || skips > 0 ? 3 : 0));
const report = {
  draft: draftPath,
  date: new Date().toISOString().slice(0, 10),
  total: results.length,
  pass, p0, p1, p2, soft, skips,
  results: wantSummary ? results.filter((r) => !r.pass && r.severity !== 'LLM 兜底') : results,  // --summary 仅保留硬失败项，省 token
  exit: exitCode,
  // 被审正文指纹（v18.0.5）：T8 裁定段据此判断「是否仍适用于本版正文」
  verdict_scope: { draft_sha256: draftSha256, draft_bytes: draftBytes },
};
console.log(JSON.stringify(report, null, 2));
if (reportPath) {
  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    // === T8 裁定段保留 + 指纹绑定（v18.0.0 新增；v18.0.5 加指纹，修第三方审计 P0-1）===
    // 背景：`final-check.mjs` 会串联调用本脚本并 `--report final/M-Gate-Report.json`，
    //   旧实现直接覆写 → **冲掉 T8 手写的 `_t8_llm_review` / `_t8_conclusion`** →
    //   M-Exist-5 的「闸门 ↔ 报告」对账失去 T8 裁定依据（并因脚本 exit ≠ 0 而误报 P0）。
    // 规则：写入前读取既有报告，保留 T8 裁定两段 + 脚本值另存 `script_exit_raw`；
    //   **仅当既有报告的 `verdict_scope.draft_sha256` 与本次正文指纹一致时**才保留 T8 的 `exit` 裁定值。
    //   v18.0.5 修（P0-1）：旧版不看指纹 → 正文改动后旧裁定继续放行，落盘 `exit` 恒为 0，
    //   审计视图出现「P0: 2 ｜ exit: 0」；现改为指纹不符即 `verdict_stale: true` + 落盘改用机械值。
    let out = { ...report, script_exit_raw: report.exit }; // 脚本机械值始终另存（v18.0.0）
    if (existsSync(reportPath)) {
      try {
        const prev = JSON.parse(readFileSync(reportPath, 'utf8'));
        const keep = {};
        for (const k of ['_t8_llm_review', '_t8_conclusion']) if (prev[k]) keep[k] = prev[k];
        if (Object.keys(keep).length > 0) {
          out = { ...report, ...keep, script_exit_raw: report.exit };
          const prevSha = prev.verdict_scope?.draft_sha256;
          const sameDraft = typeof prevSha === 'string' && prevSha === draftSha256;
          if (sameDraft) {
            if (typeof prev.exit === 'number') out.exit = prev.exit; // 保留 T8 裁定值（正文未变，裁定仍有效）
            out.verdict_stale = false;
            console.error(`· 已保留既有 T8 裁定段（exit=${out.exit}，本次脚本值 script_exit_raw=${report.exit}；正文指纹一致）`);
          } else {
            // 正文已变（或旧报告无指纹）→ 旧裁定不再适用于本版正文：保留裁定原文供追溯，但落盘用**机械值**
            out.verdict_stale = true;
            out.verdict_stale_reason = prevSha
              ? `被审正文已变更（旧 sha256=${prevSha.slice(0, 12)}…，本次=${draftSha256.slice(0, 12)}…）→ 旧 T8 裁定不适用于本版正文`
              : '既有报告无 verdict_scope 指纹（v18.0.5 之前写入）→ 无法证明裁定适用于本版正文';
            console.error(
              `⚠️ T8 裁定已过期：${out.verdict_stale_reason}\n` +
                `   落盘 exit 改用本次机械值 ${report.exit}（旧裁定值 ${prev.exit ?? 'n/a'} 仅在 _t8_conclusion 中保留供追溯）；` +
                `请 T8 重新裁定后写入新的 _t8_conclusion。`,
            );
          }
          if (typeof prev.script_exit_raw === 'number' && prev.script_exit_raw !== report.exit) {
            out.script_exit_raw_prev = prev.script_exit_raw; // 留痕：上一次脚本原值
          }
        }
      } catch {}
    }
    writeFileSync(reportPath, JSON.stringify(out, null, 2), 'utf8');
    console.error(`📄 M-Gate 报告已落盘: ${reportPath}`);
  } catch (e) {
    console.error(`⚠️ M-Gate 报告落盘失败: ${e.message}`);
  }
}
process.exit(exitCode);
