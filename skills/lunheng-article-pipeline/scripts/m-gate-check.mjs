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
//                  M-Form-8 增补「承重墙超载」机检 → 本脚本机检 **22 项**（M-Form 11 + M-Exist 10 + M-Integrity-1 佐证）
// v18.2.6 审计修复：M 门**总项数 23 项 = 机检 22 项 + 人工 1 项（M-Integrity-2 跨文件判断，T8 亲做）**。
//   旧头注释写「M 门 22 项（脚本 21 项 + M-Integrity-2 主控）」——**与本脚本自己输出的 `total` 矛盾**
//   （实测真实项目回放 `total = 22`：机检 22 项就是 M-Form 11 + M-Exist 10 + M-Integrity-1，没有第 23 个机械项）。
//   真源口径见 `AGENTS.md`「M 门」节与 `references/_shared/M-Gate-Algorithm.md`：23 项中 22 项已脚本化。
//   本脚本报告里的 `total` = **本次实际入账的机检项数（满配 22）**，人工项 M-Integrity-2 不由本脚本产出。
// 用法: node m-gate-check.mjs <final/定稿.md> <final/证据包目录> [--summary] [--fig-dir <图件目录>] [--report <path>]
//   --summary：仅输出聚合统计（total/pass/p0/p1/p2/soft/skips）+ 硬失败项；省略通过项 details[]（省 ~80% 输出字节，机器可读友好）
//   --fig-dir：图件目录（缺省自动推 <定稿目录>/图件 或 <项目根>/final/图件）
//              ⚠️ v18.2.6：**给了值但路径不存在 → exit 10**（旧版静默丢弃该参数并回退猜测目录，
//              于是「路径敲错」得到的结论比「正确传参」更宽松，与下方定稿/证据包的 10 处理自相矛盾）
// 配套：M-Gate-Algorithm.md「机械化脚本化」段
// 严重度评级（v2.5.2-dsh.5 引入）：gate fail 时按 P0/P1/P2 分级；单子项失败子项数 ≤2 → P2 可放行
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refsOf, dataCardIds } from './_lib/refs.mjs';                 // 引用编号口径真源
import { countHan } from './_lib/han.mjs';                              // 汉字口径真源（v18.3.0 方案：M-Form-8 裸断言段）
import { TRUST_COMPLIANT_RE, TRUST_LOOSE_RE } from './_lib/trust.mjs'; // 信任级别口径真源
import { splitCard } from './_lib/cards.mjs';                          // 卡片切块口径真源
import { ENDNOTE_SECTIONS, h2Headings, firstEndnoteIndex, sectionBody } from './_lib/sections.mjs'; // 文末节/正文区边界真源（v18.2.6：与 count-chars 同源）
import { analyzeSvg, svgTextNumbers, figureNoOf, figurePlaceholders } from './_lib/svg.mjs'; // SVG 图件口径真源
import { installExitGuard, requireExistingFile, requireExistingDir } from './_lib/exit-guard.mjs'; // 退出码硬化（v18.0.5）
import { parseArgs as parseCliArgs, USAGE_CODE as CLI_USAGE_CODE } from './_lib/cli-args.mjs';      // 参数解析唯一实现（v18.2.9，审计 A7）
import { escapeRegExp, latestReport, PROTECT_CH, tableCells, isSeparatorRow, sectionRange, indexSection, CARD_SPECS, ENTRY_ID_RE, entryIds, idsByToken, walkMd } from './_lib/mgate-helpers.mjs';
import { mExist1, mExist2, mExist3, mExist4, mExist5, mExist6, mExist7, mExist8, mExist9, mExist10 } from './_lib/mgate-gates/mexist-gates.mjs';  // M-Exist 门族（v18.3.1 审计 B2 阶段 1）
import { mIntegrity1 } from './_lib/mgate-gates/mintegrity-gate.mjs';  // M-Integrity-1（v18.3.1 审计 B2 阶段 1）   // 定位与解析纯函数（v18.2.9，审计 B2 抽离）
installExitGuard();   // 必须在任何 readFileSync 之前：fs 类异常 → 10，其余内部错误 → 70（避免与「1 = P1 内容失败」撞义）

// 本脚本自身所在目录（用于读取技能包内的真源，如闸门记录模板 / 期刊数据库；v2.5.2-dsh.17）
const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(scriptDir, '..');

// v18.2.9（第三方审计 A7）：参数解析迁移到 `_lib/cli-args.mjs` 唯一实现。
//   旧手写 indexOf/filter 解析的两类静默降级（正是 cli-args 头注释描述的 B-4 形态）：
//     · 未知旗标（拼错的 `--sumary`）被 `filter(a => !a.startsWith('--'))` 静默丢弃 → 用户以为在出摘要，实际拿全量；
//     · 第 3 个位置参数静默忽略。
//   现一律 exit 10。原 v18.2.6 的两处防御（--fig-dir 取值不得以 -- 开头、缺值报错）由 cli-args 统一承担。
// v18.3.1（第三方审计 B3）：`--dump-thresholds` 打印「阈值总表」后退出——这是
//   `references/_shared/M-Gate-Algorithm.md` 里 THRESHOLDS-AUTO 生成块的**唯一生成源**。
//   阈值真源 = 下方 `THRESHOLDS` 对象；此处读自身源码解析（与 consistency-check ㉓ 的派生同法），
//   避免把 THRESHOLDS 定义搬到文件头（改动面更小）。必须在解析位置参数之前短路：
//   该旗标不接受 <定稿.md> <证据包目录>。
if (process.argv.includes('--dump-thresholds')) {
  const selfSrc = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const thBlock = selfSrc.match(/const THRESHOLDS = Object\.freeze\(\{([\s\S]*?)\n\}\)/);
  if (!thBlock) { console.error('无法解析 THRESHOLDS（Object.freeze 结构变化）'); process.exit(70); }
  const rows = [];
  for (const line of thBlock[1].split('\n')) {
    const label = (line.match(/\/\/\s*(.*)$/) || [])[1]?.trim() || '';
    for (const k of line.matchAll(/(\w+):\s*([0-9.]+),/g)) rows.push(`| \`${k[1]}\` | ${k[2]} | ${label} |`);
  }
  console.log('<!-- THRESHOLDS-AUTO-START (由 scripts/m-gate-check.mjs 的 THRESHOLDS 单向生成，勿手改) -->\n');
  console.log('## 阈值总表（唯一真源 = scripts/m-gate-check.mjs `THRESHOLDS` 对象）\n');
  console.log('| 阈值键 | 值 | 语义 |');
  console.log('|---|---|---|');
  console.log(rows.join('\n'));
  console.log('\n<!-- THRESHOLDS-AUTO-END -->');
  process.exit(0);
}

const args = process.argv.slice(2);
const MGATE_USAGE = '用法: node m-gate-check.mjs <定稿.md> <证据包目录> [--summary] [--fig-dir <dir>] [--report <path>]';
let wantSummary, figDirArg, reportPath, positional;
try {
  const parsed = parseCliArgs(args, {
    flags: ['--summary'],
    values: { '--fig-dir': 'final/图件', '--report': 'final/M-Gate-Report.json' },
    minPositionals: 2,
    maxPositionals: 2,
    positionalHint: '<定稿.md> <证据包目录>',
  });
  wantSummary = parsed.flags.has('--summary');
  figDirArg = parsed.opts['--fig-dir'];
  reportPath = parsed.opts['--report'];
  positional = parsed.positionals;
} catch (e) {
  if (e && e.code === CLI_USAGE_CODE) { console.error(e.message); console.error(MGATE_USAGE); process.exit(10); }
  throw e;
}
const draftPath = positional[0];
const evDir = positional[1];
if (!draftPath || !evDir) {
  console.error(MGATE_USAGE);
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
// v18.2.6 修（第三方审计 P1-1）：`--fig-dir` 给了值但路径不存在 → **exit 10**（复用 _lib/exit-guard 语义）。
//   旧实现 `:702 figDir = figDirArg && existsSync(figDirArg) ? figDirArg : (…按候选推导…)` 把**不存在的路径静默丢弃**
//   并回退到猜测目录，实测后果（审计 B 报告）：
//     · 不传 --fig-dir ‖ 传一个**不存在**的目录 → stdout **逐字节相同**（都判 M-Form-9 P1）；
//     · 传「存在但空」的目录 → 才是 P0 缺图。
//   即**路径敲错时结论比正确传参更宽松**——主控据此会认为「图件没问题」而漏掉真缺图，
//   与 `:55-66` 对定稿/证据包一律 10 的处理自相矛盾。现统一：路径类参数错一律 10。
if (figDirArg) {
  if (!existsSync(figDirArg)) {
    console.error(
      `图件目录不存在（--fig-dir）: ${figDirArg}\n` +
        `  —— 若本项目**未配图**，请不要传该参数（缺省会按 <定稿目录>/图件 与 <项目根>/final/图件 推导）；\n` +
        `  —— 若确已配图，请核对路径（规范位置是 <项目根>/final/图件）。`,
    );
    process.exit(10);
  }
  requireExistingDir(figDirArg, '图件目录（--fig-dir）');   // 存在但不是目录 → 同样 10
}

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

// v18.2.9（第三方审计 B3）：阈值集中为单一对象——旧版 20+ 处魔法数字散落全文，
//   调整任何阈值需全文 grep，且与 `references/_shared/M-Gate-Algorithm.md` 的文档数字双维护（两处必漂）。
//   **改阈值只改这里**；下一步由本对象单向生成文档数字表、彻底消除双维护。
const THRESHOLDS = Object.freeze({
  mform1MinL: 3,                                        // M-Form-1 学术文献 [Lxx] 下限
  mform3TempP0: 3,                                      // M-Form-3 占位符 ≥N 处 → P0
  mform5WeakAICtx: 200,                                 // M-Form-5 弱 AI 痕上下文窗口（字符）
  mform5P0: 10, mform5P1: 5,                            // M-Form-5 过程语言命中档位
  mform6P0: 5, mform6P1: 2,                             // M-Form-6 信任级别缺失档位
  mform8MaxSections: 20, mform8MinSecLen: 100,          // M-Form-8 节扫描上限 / 最短节长
  mform8WallOverload: 3,                                // M-Form-8 承重墙超载：同一证据被 ≥N 论点标承重
  mform8BareMinHan: 300,                                // M-Form-8 裸断言段：段内汉字 >N 且零引用 → P2 软提示（v18.3.0 方案）
  mform8LongSentenceHan: 120,                           // M-Form-8 异常长句：单句汉字 >N → P2 软提示（v18.3.0 阶段 3）
  exist1ClosureP0: 10,                                  // M-Exist-1 漏引+孤儿 >N → P0
  mform11MinIndexIds: 30, mform11MinBodyHan: 3000,      // M-Form-11 比率检查前置条件
  mform11LongHan: 6000, mform11MidHan: 3000,            // M-Form-11 字数分档边界
  mform11RatioLong: 0.98, mform11RatioMid: 0.94, mform11RatioShort: 0.9,   // 加载率阈值（按正文档位分档）
  exist10MissingP0: 3, exist10MaxRows: 120,             // M-Exist-10 精简段：缺要素 → P0 阈值 / 行数上限
  exist3P0: 5, exist3P1: 2,                             // M-Exist-3 引用闭环档位
})

// === 定位与解析共用助手（v18.0.5 去重：同一推导此前在脚本内各写 2-9 份）===
//   来源：`audits/论衡冗余审计-v1.md` §二.2（「同脚本内多份重复实现」）。**行为与去重前逐字等价**——
//   重构前后由 `run/_mgate-baseline.mjs`（37 组真实项目调用，比对 exit + stdout 哈希 + `--report` JSON 哈希）对账。
// ① 项目根：`<项目>/final/定稿.md` 与 `<项目>/drafts/初稿-vN.md` 都向上两级得到 `<项目>`
const projectRoot = dirname(dirname(draftPath));
// ② 报告目录：先 `<项目>/audits`，再 `<被审文件目录>/audits`，最后（仅 M-Exist-4 需要）证据包目录
const auditsDirOf = ({ withEv = false } = {}) =>
  [join(projectRoot, 'audits'), join(dirname(draftPath), 'audits'), ...(withEv ? [evDir] : [])]
    .find((d) => existsSync(d)) || null;
// ③ 最新版本化报告 / ④ 表格切列 / ⑤ 段体范围 / ⑥ 索引段 / ⑧⑨ 卡片编号 / ⑩ 递归列 .md
//   → 已抽离到 `_lib/mgate-helpers.mjs`（纯函数，v18.3.0 审计 B2）。行为逐字等价（baseline 对账）。
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
// ⑧ 卡片正文条目编号 / ⑨ 可配编号形态 → 已抽离到 `_lib/mgate-helpers.mjs`（entryIds / idsByToken / CARD_SPECS / ENTRY_ID_RE）。
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
// 递归列出证据包内的 .md（M-Exist-2 统计）→ 已抽离到 `_lib/mgate-helpers.mjs`（walkMd）。

// === v2.5.2-dsh.5 修订：白名单 5 节 + AI 使用声明（M-Form-2 / M-Form-7 一致）===
// v18.2.6：列表真源上收到 `_lib/sections.mjs`（`ENDNOTE_SECTIONS`）——同一份清单此前在
//   `count-chars.mjs` / `m-gate-check.mjs` 各写一份，口径发散过一次（正文区终点失配，见该模块头注释）。
const WHITELIST = ENDNOTE_SECTIONS;

// 引用编号正则：支持 [Lxx]/[Dxx]/[Cxx]/[C-主xx]/[先xx]，可带版本后缀
const refRe = /\[(L|D|C-主|C|先)\d+(?:(?:-v| v)\d+)?\]/g;
const norm = (r) => r.replace(/(?:-v| v)\d+\]/, ']');

// 解析所有 ## 标题及其位置
// v18.2.6 修（第三方审计 §4.2）：改走 `_lib/sections.mjs` 的 `h2Headings`（行首 `##` + 任意空白解析）——
//   与 count-chars 的正文区边界**同一真源**。旧式 `^##\s+(.+)$` 的 `\s` 含换行，
//   会把「`##` 空行 + 下一行文本」也读成二级标题；且 CRLF 文件会把 `\r` 带进标题。
const h2Matches = h2Headings(text);
const h2s = h2Matches.map((m) => m.title);
const firstIdx = h2s.findIndex((t) => WHITELIST.some((w) => t === w || t.startsWith(w)));
// v18.2.6：文末节起点改走共享 `firstEndnoteIndex`（与 WHITELIST 前缀口径一致；无文末节 → -1）
const firstEndnoteAt = firstEndnoteIndex(text);
const firstEnd = firstEndnoteAt >= 0 ? firstEndnoteAt : (firstIdx >= 0 ? h2Matches[firstIdx].index : -1);

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
const min_L = THRESHOLDS.mform1MinL;
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
    severity: tempCount >= THRESHOLDS.mform3TempP0 ? 'P0' : (tempCount > 0 ? 'P1' : '通过'),
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
  const start = Math.max(0, m.index - THRESHOLDS.mform5WeakAICtx);
  const ctx = body.slice(start, m.index + m[0].length);
  if (!/\[(?:L|D|C)\d+\]/.test(ctx)) weakAIHits.push(m[0]);
}
for (const h of weakAIHits) hits.push(h);
results.push({
  gate: 'M-Form-5 过程语言残留',
  pass: hits.length === 0,
  detail: hits.length ? `命中: ${[...new Set(hits)].join(',')}` : '零命中',
  // v2.5.2-dsh.17：补 P0 档（旧版最高 P1 → P0 分支不可达，与 M-Form-4/M-Form-9 同族不一致）
  severity: hits.length > THRESHOLDS.mform5P0 ? 'P0' : (hits.length > THRESHOLDS.mform5P1 ? 'P1' : (hits.length > 0 ? 'P2' : '通过')),
});

// === M-Form-4 元数据泄露（v2.5.2-dsh.5 重大修订：黑名单转白名单）===
const forPatternText = (() => {
  let t = body;
  // v18.2.6 审计修复（第三方审计 P1-3：白名单**贪婪吞前缀 → 掩盖真泄露**）：
  //   第 4 条白名单旧式为 `[\u4e00-\u9fff]+(?:大学|学院|研究院|政府|机构|组织|部|委|局|司|办)`——
  //   前缀用 `+`（无上限）且从**句首**起匹配，于是任何「…机构/组织/部…」结尾的中文句子会被**整句剥离**：
  //     实测「本报告由主控提交给评审机构。」→ 剥离后只剩「。」→ **「主控」这条 P0 级泄露扫不到**；
  //     反例「主控说了算。」（无机构后缀）才命中 → 同一门对两句话给出相反结论，且**恰好放过最像真泄露的写法**。
  //   修法：白名单只负责剥离**机构名本身**，故对每个白名单匹配加守卫——**匹配串里含角色/流程禁止词时不剥离**
  //   （保留原文交给下面真正的黑名单扫描）。这样「国家统计局」照旧被剥离，而「…主控…机构」不会被吞。
  const ROLE_IN_WHITELIST = /((?<!自)主控|文献检索员|数据检索员|分析员|写手|批判伙伴|审计员|审稿人|案例检索员|角色卡|交接报告|任务简报|反哺报告|修订说明)/;
  const whitelists = [
    /\[(?:L|D|C-主|C|先)\d+\]/g,
    /\d{4}年|\d{1,2}月\d{1,2}日/g,
    /\d+\.?\d*%|\d+\.?\d*\s*(?:万|亿|个|条|项|位|倍|元|倍|成)/g,
    /[\u4e00-\u9fff]+(?:大学|学院|研究院|政府|机构|组织|部|委|局|司|办)/g,
    /AI Act|标识办法|GPT-?\d*|OpenAI|Claude/g,
  ];
  for (const pat of whitelists) t = t.replace(pat, (m) => (ROLE_IN_WHITELIST.test(m) ? m : ''));
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
// v18.2.9 修（第三方审计 A8）：二级扫描的标题解析改走 `_lib/sections.mjs` 的 `h2Headings` 真源。
//   旧实现用 `/^##\s+(.+?)\s*$/`——`\s` 含换行、且不认全角空格（\u3000）作标题分隔：
//   「##　AI 使用声明」（全角空格标题）在此失配 → 豁免不生效 → 命中披露语禁止词 → **假 P0**。
//   全库其余处已于 v18.2.6 统一走 h2Headings，此处是漏网的双重实现。
const endnoteScanText = (() => {
  const heads = h2Headings(endnote);
  if (heads.length === 0) return endnote;   // 无二级标题（异常布局）→ 不豁免，照旧全扫
  const kept = [];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index;
    const end = i + 1 < heads.length ? heads[i + 1].index : endnote.length;
    if (!ENDNOTE_SCAN_EXEMPT.some((w) => heads[i].title === w || heads[i].title.startsWith(w))) {
      // 豁免后仍保留节标题行，便于 detail 里的「文末节」定位信息不失真
      kept.push(endnote.slice(start, end));
    }
  }
  if (kept.length === heads.length) return endnote;
  return kept.join('\n');
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
  const secNames = h2Headings(endnote).map((h) => h.title);   // v18.2.9：与 endnoteScanText 同源（旧式 \s 正则不认全角空格）
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
// v18.2.6 审计修复 P1-7：`catch {}` 会让「卡读不出来」与「卡不存在」在输出里**完全同形**——
//   实测权限错/编码错时 `dataCard` 静默留空 → detail 报「数据卡.md 不在证据包（也不在项目 data/ 目录）」
//   （判定 P0 但原因错，主控会去补检索而不是修文件）。现把读取异常如实带入 detail。
let dataCardReadError = null;
try { if (dataCardPath6) dataCard = readFileSync(dataCardPath6, 'utf8'); }
catch (e) { dataCardReadError = e; }
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
    mform6Severity = trustLevelMiss.length > THRESHOLDS.mform6P0 ? 'P0' : (trustLevelMiss.length > THRESHOLDS.mform6P1 ? 'P1' : 'P2');
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
    detail: dataCardReadError
      ? `数据卡.md 读取失败（**不是缺失**）：${dataCardPath6} —— ${dataCardReadError.message}（v18.2.6：读取异常不再与「卡不存在」同形）`
      : layoutAnomaly
        ? `数据卡.md 定位失败（证据包布局异常：${layoutAnomaly}）`
        : '数据卡.md 不在证据包（也不在项目 data/ 目录）',
    severity: 'P0',
  });
}

// === M-Form-8 三角验证（v2.5.2-dsh.5 修订：每论点强制含 L + coverage ≥ 2）===
let mform8Findings = { L_missing: 0, weak: 0, total: 0, details: [], soft: [] };
try {
  // v2.5.2-dsh.5 修复：排除前置/收尾非论点段（摘要/关键词/引言/结语）——摘要与引言天然不引 [Lxx]
  // （引言以 [先xx] 声明原创性差异点，属论衡原创性机制而非论点论证），之前把「摘要」当正文段查 [Lxx] 导致恒 P0 误报。
  const FRONT_BACK = ['摘要', '关键词', '引言', '结语', '结论', '展望'];
  const sections = body.split(/^##\s+/m).filter((s) => s.trim().length > 0);
  for (const sec of sections.slice(0, THRESHOLDS.mform8MaxSections)) {
    if (sec.length < THRESHOLDS.mform8MinSecLen) continue;
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
    // 裸断言段（v18.3.0 方案 G 下沉）：长段落零引用 → P2 软提示（机械只挑可疑，定罪归 G3/G6）
    const secHan = countHan(secProse);
    const secRefs = (secProse.match(refRe) || []).length;
    if (secHan > THRESHOLDS.mform8BareMinHan && secRefs === 0) {
      mform8Findings.soft.push(`「${secTitle.slice(0, 20)}」${secHan} 字零引用（疑似裸断言）`);
    }
    // 句长异常（v18.3.0 阶段 3）：正文异常长句（单句 >阈值汉字）→ P2 软提示（机械只挑长句，是否该拆归 G4/G14）
    const longSents = secProse.split(/[。！？；;!?]/).filter((s) => countHan(s) > THRESHOLDS.mform8LongSentenceHan);
    if (longSents.length) {
      mform8Findings.soft.push(`「${secTitle.slice(0, 20)}」${longSents.length} 个异常长句（>${THRESHOLDS.mform8LongSentenceHan} 字）`);
    }
  }
  // ---- 承重墙超载机检（v2.5.2-dsh.17 新增）----
  // 承重墙 = 支撑力最强的单条证据，T4 在大纲「承重墙清单」里逐论点标 top1；论衡定的规则是
  // **同一证据被 ≥3 个论点标为承重墙 = 超载**（教训：善行实战祁东案一个案例承重四个论点，
  // 被击穿则整链塌）。此前该规则只有 T6 的专项批判 + T7 的 LLM 复核，**没有任何机械计数**。
  // 判定方式与格式无关：清单区内每个论点最多贡献一次 top1 标注，故同一编号出现 ≥3 次即 ≥3 个论点。
  const wall8 = { checked: false, rows: 0, overload: [], ghost: [], claims: 0, notes: [], headRow: '' };
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
      // v18.2.5 修（主控实战反哺 P1）：表头锚点收紧为「**首列**必须是承重证据」。
      //   旧实现 /^\s*\|[^\n]*承重[^\n]*\|\s*$/ 允许「承重」出现在**任意列** → 会命中
      //   「论点-论据映射表」的表头（该表最后一列常写作「承重证据 top1」）→ 于是把**映射表**当承重墙清单读。
      //   映射表每行含多个编号（论据组合列），同一编号跨多个论点行重复出现 → **假报「承重墙超载」**。
      //   实测（本项目 ai-cad-cam-impact）：大纲有 4 个含「承重」的表头候选（行 91/114/319/368），
      //   脚本取**第一个** = 行 91「| 论点 | 章节 | 论据组合… | 承重证据 top1 | 字数预算 |」= 映射表，
      //   遂报「[L09]×4论点,[L11]×3论点,[C01]×3论点,[C02]×3论点,[L10]×4论点,[L12]×3论点」；
      //   而真值在大纲 §4.2（行 114）与 §11.6（行 368）的承重墙清单里：12 行 top1、负载 ≤2、**无超载**
      //   （T4 大纲自检亦明示「所有承重墙负载 ≤2」）。两者结论相反，根因即锚点选错表。
      //   修法：首列锚点 `^\s*\|\s*承重(证据|墙|清单)` —— 映射表首列是「论点」，不再命中。
      const wallHeadAnchor = (l) => /^\s*\|\s*承重(证据|墙|清单)/.test(l);
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
        // v18.2.5 新增：记录**实际选中的表头行**，让 detail 自带「锚点选对了哪张表」的证据——
        //   本次 bug 的教训是「选错表」在旧 detail 里完全不可见（只报超载结果，不报依据）。
        wall8.headRow = String(ol[sIdx] || '').trim();
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
        wall8.overload = [...freq.entries()].filter(([, n]) => n >= THRESHOLDS.mform8WallOverload).map(([id, n]) => `${id}×${n}论点`);
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
  } catch (e) {
    // v18.2.6 审计修复 P1-7：承重墙是**增强项**（解析失败不拖垮 M-Form-8 覆盖率判定），
    //   但旧写法 `catch {}` 让「增强项静默跳过」与「清单本来就没有」在输出里不可区分 →
    //   主控以为「已核过承重墙、无超载」。现按既有做法留痕：异常**单独**记 `parseError`，
    //   并在 detail 里无条件输出（`wall8.checked` 为 false 时 notes 分支不会执行，故不能只塞 notes）。
    wall8.parseError = `承重墙清单解析失败（本增强项已跳过，承重墙判定退化为 LLM 兜底）：${e.message}`;
    wall8.notes.push(wall8.parseError);
  }

  const wallHard = wall8.overload.length > 0 || wall8.ghost.length > 0;
  let mform8Pass = (mform8Findings.L_missing === 0 && mform8Findings.weak === 0 && !wallHard);
  let mform8Severity = mform8Findings.L_missing > 0 ? 'P0'
    : (wallHard || mform8Findings.weak > 0 ? 'P1' : '通过');
  // v18.2.5 新增：wallBit 附带**实际选中的清单表头**（让「锚点选错表」这类问题自带证据、可事后核对）。
  const wallHeadBit = wall8.checked && wall8.headRow
    ? `（清单锚点表头：${wall8.headRow.slice(0, 46)}${wall8.headRow.length > 46 ? '…' : ''}）`
    : '';
  const wallBit = wall8.checked
    ? (wall8.overload.length
      ? `承重墙超载：${wall8.overload.join(',')}（同一证据被 ≥3 论点承重 → 降级为辅助证据或补检索）`
      : (wall8.rows > 0 ? `承重墙 ${wall8.rows} 条标注、无超载` : (wall8.notes[0] || '承重墙清单为空'))) + wallHeadBit
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
      wall8.parseError || '',   // v18.2.6：解析异常**无条件**出现在 detail（不再无痕跳过）
      (wall8.checked && wall8.rows > 0 && !wall8.overload.length && wall8.notes.length) ? `备注：${wall8.notes[0]}` : '',
      mform8Findings.soft.length ? `P2 提示（裸断言段）：${mform8Findings.soft.slice(0, 2).join('；')}${mform8Findings.soft.length > 2 ? ` 等 ${mform8Findings.soft.length} 段` : ''}` : '',
    ].filter(Boolean).join(' ｜ '),
    severity: mform8Severity,
  });
} catch (e) {
  results.push({ gate: 'M-Form-8 三角验证', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

// === M-Form-9 图件闭环（v2.5.2-dsh.16 新增）：[图N] 图位 ↔ final/图件/ ↔ 图上数字 三方对账 ===
// 背景（第三方 SVG 链路审计）：T5 卡宣称「T7 跑 M-Gate 算法检查 [图N] 出现次数 ≥ 拍板图位数量 → P0 拦截」，
// 但**当时**的 M 门（16 项）里**没有任何图项**、T7 速查表 0 处提及「图」、证据包不收图件 → 该条文无落地路径。
// 本项即该条文的机械落地：缺图/图位不足 → 硬失败；孤儿图件/数字对不上 → 软提示（数字对账为启发式）。
// 未启用配图（无图位且无图件目录）→ 记 N/A 且 pass=true（不得因「没配图」把 M 门判失败——配图默认关闭）。
try {
  // v18.2.5 修（主控实战反哺 P0）：图件目录缺省推导口径与「被审对象位置」解耦。
  //   旧实现 `join(dirname(draftPath), '图件')` 隐含假定「被审对象在 final/ 下」（文件头注释写
  //   「缺省自动推 <定稿目录>/图件」）；但 Phase 4 的 T7 审计与 Phase 5 的 T8 终检实际被审对象是
  //   `drafts/初稿-vN.md` → 推出 `drafts/图件`（不存在）→ 恒报「图件 0 个」P0。
  //   实测后果：本项目三轮（v3/v4/v5）M-Gate 全 exit=2，**不论主控写多少张 SVG 都无法关闭该 P0**，
  //   使「M 门 exit 0 才返回」硬门禁在原子上失效，只能走 Acknowledged Limitations 交付。
  //   修法：项目根用与 M-Integrity-1 / 本项图位数量解析同一助手 findBriefUpward（向上找 01-任务简报.md），
  //   图件规范位置 = <项目根>/final/图件；同时保留旧候选以兼容「被审对象即 final/定稿.md」场景。
  const briefForFig = findBriefUpward(dirname(draftPath));
  const figProjectRoot = briefForFig ? dirname(briefForFig) : dirname(dirname(draftPath));
  const figDirCandidates = [
    join(dirname(draftPath), '图件'),        // 兼容旧口径：被审对象在 final/ 下 → <定稿目录>/图件
    join(figProjectRoot, 'final', '图件'),   // 规范口径：项目根/final/图件（drafts/ 被审场景）
  ];
  const figDirDefault = figDirCandidates.find((p) => existsSync(p)) || figDirCandidates[1];
  // v18.2.6：`figDirArg` 已在脚本头部经由 requireExistingDir 校验（不存在 → exit 10），故此处可直接采信
  const figDir = figDirArg || (existsSync(figDirDefault) ? figDirDefault : null);
  const figNos = figurePlaceholders(text);
  const files = figDir ? readdirSync(figDir).filter((f) => f.toLowerCase().endsWith('.svg')) : [];
  const fileNos = new Map();
  for (const f of files) { const n = figureNoOf(f); if (n !== null && !fileNos.has(n)) fileNos.set(n, f); }
  // 图位数量对账（拍板数取自任务简报，best-effort 解析；解析不到则不判，避免误 P0）
  let pledged = 0, pledgedFrom = '', pledgedNote = '';
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
    } else {
      pledgedNote = '未找到 01-任务简报.md → 「图位不足」对账已跳过（拍板图位数无从取得）';
    }
  } catch (e) {
    // v18.2.6 审计修复 P1-7：旧写法 `catch {}` 让「简报读不动」与「简报没写图位数」同形 →
    //   主控会把「对账被跳过」读成「对账通过」。现按既有做法留痕（随 detail 的软提示输出）。
    pledgedNote = `任务简报读取/解析失败 → 「图位不足」对账已跳过：${e.message}`;
  }

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
    // v18.2.6（P1-7）：对账被跳过（简报缺失/解析失败）必须**显式可见**，不得与「对账通过」同形
    if (pledgedNote) softNotes.push(pledgedNote);

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

// v18.3.1（审计 B2 阶段 1）：M-Exist 门族 + M-Integrity-1 抽离为 \`_lib/mgate-gates/\` 门模块。
//   共享变量收敛为显式上下文对象 ctx（dataCard 在 M-Form-6 定型后快照）；主脚本按原 results 顺序
//   调用各门，行为与抽离前逐字等价——run/ 49 组真实项目 baseline（exit + stdout/report sha256）对账。
const ctx = {
  results, THRESHOLDS,
  draftPath, evDir, skillRoot,
  bodyProse, endnote, firstIdx, refRe, norm,
  dataCard, dataCardReadError, layoutAnomaly,
  auditsDirOf, findBriefUpward,
};
mExist1(ctx);

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
    // v18.2.5 改（主控实战反哺 P2）：文案补**合规留痕豁免**说明。
    //   实测误伤（本项目）：[先06] 被 T7 第 1 轮判「与 [L11] 同篇重复、应从文末节删除」→
    //   主控按判从文末节删除，但 `素材加载清单.md` **保留**它是**正确行为**（它确实被读过）。
    //   旧文案把这条留痕一律读成「白读即为上下文浪费」——对「应删且已删」的条目是错判。
    if (unused.length) soft11.push(`${unused.length} 个编号「读了但正文未引用」（${unused.slice(0, 5).join(',')}）——`
      + `若该编号已在审计环节被判「应删且已删」（如与别条同篇重复），则保留在本清单属**合规留痕**、无需处理；`
      + `否则请补引用或从清单移除（白读即上下文浪费）`);
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
    const ratioCheckOn = cardIndexIds.size >= THRESHOLDS.mform11MinIndexIds && bodyHan11 >= THRESHOLDS.mform11MinBodyHan
    // v18.2.5 修（主控实战反哺 P2）：阈值**按正文档位自适应** + 给出**显式消歧路径**。
    //   实测误伤（本项目 ai-cad-cam-impact，8000 字学术综述）：已加载 59 / 索引 61 = **96.7%**
    //   → 触发「>90% 选择性不足，疑似整卡通读」。但长篇论文的合理形态**就是**高加载率——
    //   卡池本身已过 T1/T2/T3 的「反向淘汰自查」精简到刚够用（[Dxx] 封顶 30-50、T1 砍到 12 条），
    //   8000 字论文引用 58 条素材 / 卡池 61 条，是**正常**而非选择性不足。
    //   旧阈值 0.9 是对小论文校准的（上方注释自述「短文 + 小卡池必然误报」曾修过一次），对长篇仍偏紧。
    //   现改两处：
    //     ① **分档**：长篇（≥6000 汉字）用 0.98、中篇（3000-6000）用 0.94、短篇不启用（沿用前置条件）；
    //     ② **消歧路径**：文案明确「高加载率本身不是缺陷」——真正的缺陷是「未按索引段定位而整卡通读」，
    //        而后者只能由写手留痕声明；故清单头部注明「按需加载」即豁免本提示。
    const ratioThreshold = bodyHan11 >= THRESHOLDS.mform11LongHan ? THRESHOLDS.mform11RatioLong : (bodyHan11 >= THRESHOLDS.mform11MidHan ? THRESHOLDS.mform11RatioMid : THRESHOLDS.mform11RatioShort);
    const ratioDeclared = /按需加载/.test(lt);
    if (ratioCheckOn && !ratioDeclared && loadedInIndex11.length / cardIndexIds.size > ratioThreshold) {
      soft11.push(`已加载 ${loadedInIndex11.length} / 索引 ${cardIndexIds.size} 条（>${(ratioThreshold * 100).toFixed(0)}%）——加载率偏高、疑似整卡通读；`
        + `若确为「先读索引段、按编号定位」的按需加载，请在 analysis/素材加载清单.md 头部注明「按需加载」以消除本提示（该条优化即为此设）`);
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
      } catch (e) {
        // v18.2.6 审计修复 P1-7：版本留痕对账是增强项，但跳过必须可见（旧 `catch {}` 让
        //   「对账跳过」与「版本一致」同形）。按既有做法记入 soft11。
        soft11.push(`加载清单「对应版本」对账跳过（读 drafts/ 失败）：${e.message}`);
      }
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

mExist4(ctx);

mExist5(ctx);

mExist6(ctx);

mExist7(ctx);

mExist8(ctx);

mExist9(ctx);

mExist10(ctx);

mExist2(ctx);

mExist3(ctx);

mIntegrity1(ctx);

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
      } catch (e) {
        // v18.2.6 审计修复 P1-7（本脚本最后一处吞异常）：既有报告损坏/非 JSON 时旧写法静默继续，
        //   结果是**悄悄覆写**掉既有 T8 裁定段（`keep` 拿不到任何键 → 落盘即丢裁定），
        //   而调用方只会看到「报告已落盘」。现显式告警：裁定段未保留、落盘用本次机械值。
        console.error(
          `⚠️ 既有 M-Gate-Report.json 无法解析（${e.message}）——无法保留其中的 T8 裁定段，`
          + `本次落盘将使用脚本机械值 exit=${report.exit}；若该报告本应有 T8 裁定，请 T8 重新裁定后写入。`,
        );
      }
    }
    writeFileSync(reportPath, JSON.stringify(out, null, 2), 'utf8');
    console.error(`📄 M-Gate 报告已落盘: ${reportPath}`);
  } catch (e) {
    // v18.2.9（第三方审计 B14）：落盘失败不再吞掉。AGENTS.md 铁律「闸门必须留机械证据（exit code + 产物路径）」
    //   ——报告写不出来时 exit 0/1/2 会让主控以为证据链完整（磁盘满/权限错时实际拿不到报告）。
    //   归为 70（内部错误）：stdout 的机械值仍可读，但主控必须先解决落盘问题才能引用本次判定。
    console.error(`⚠️ M-Gate 报告落盘失败（${e.message}）——闸门机械证据缺失，本次退出码改为 70（内部错误）；请检查磁盘/权限后重跑`);
    process.exit(70);
  }
}
process.exit(exitCode);
