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
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refsOf, dataCardIds } from './_lib/refs.mjs';                 // 引用编号口径真源
import { countHan } from './_lib/han.mjs';                              // 汉字口径真源（v18.3.0 方案：M-Form-8 裸断言段）
import { TRUST_COMPLIANT_RE, TRUST_LOOSE_RE } from './_lib/trust.mjs'; // 信任级别口径真源
import { splitCard } from './_lib/cards.mjs';                          // 卡片切块口径真源
import { ENDNOTE_SECTIONS, h2Headings, firstEndnoteIndex, sectionBody } from './_lib/sections.mjs'; // 文末节/正文区边界真源（v18.2.6：与 count-chars 同源）
import { analyzeSvg, svgTextNumbers, figureNoOf, figurePlaceholders } from './_lib/svg.mjs'; // SVG 图件口径真源
import { installExitGuard, requireExistingFile, requireExistingDir } from './_lib/exit-guard.mjs'; // 退出码硬化（v18.0.5）
import { writeReport } from './_lib/destructive-write.mjs';   // 报告写盘守卫（v18.12.0，全量审计 L-50）
import { parseArgs as parseCliArgs, USAGE_CODE as CLI_USAGE_CODE } from './_lib/cli-args.mjs';      // 参数解析唯一实现（v18.2.9，审计 A7）
import { escapeRegExp, latestReport, PROTECT_CH, tableCells, isSeparatorRow, sectionRange, indexSection, CARD_SPECS, ENTRY_ID_RE, entryIds, idsByToken, walkMd } from './_lib/mgate-helpers.mjs';
import { mExist1, mExist2, mExist3, mExist4, mExist5, mExist6, mExist7, mExist8, mExist9, mExist10 } from './_lib/mgate-gates/mexist-gates.mjs';  // M-Exist 门族（v18.3.1 审计 B2 阶段 1）
import { mIntegrity1 } from './_lib/mgate-gates/mintegrity-gate.mjs';
import { mForm1, mForm2, mForm3, mForm4, mForm5, mForm6, mForm7, mForm8, mForm9, mForm10, mForm11 } from './_lib/mgate-gates/mform-gates.mjs';  // M-Form 门族（v18.3.1 审计 B2 阶段 2）  // M-Integrity-1（v18.3.1 审计 B2 阶段 1）   // 定位与解析纯函数（v18.2.9，审计 B2 抽离）
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
const MGATE_USAGE = '用法: node m-gate-check.mjs <定稿.md> <证据包目录> [--summary] [--fig-dir <dir>] [--report <path>] [--adjudicate <T8裁定.json>]';
let wantSummary, figDirArg, reportPath, adjudicatePath, positional;
try {
  const parsed = parseCliArgs(args, {
    flags: ['--summary'],
    values: { '--fig-dir': 'final/图件', '--report': 'final/M-Gate-Report.json', '--adjudicate': 'audits/t8-conclusion.json' },
    minPositionals: 2,
    maxPositionals: 2,
    positionalHint: '<定稿.md> <证据包目录>',
  });
  wantSummary = parsed.flags.has('--summary');
  figDirArg = parsed.opts['--fig-dir'];
  reportPath = parsed.opts['--report'];
  adjudicatePath = parsed.opts['--adjudicate'];
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
// v18.12.2（L-06）：被审正文的**项目相对路径**（`drafts/<name>` 或 `final/定稿.md`）——与上面两项
//   一起构成「这份报告审的是哪一版」的完整、可机读记录。相对路径而非绝对：报告会被复制进证据包、
//   跨机器 review，绝对路径没有意义。解析失败（路径不在项目内）时退化为 basename，并在值里保留线索。
const relativeBase = (() => {
  const norm = draftPath.replaceAll('\\', '/');
  const m = norm.match(/(?:^|\/)(drafts\/[^/]+|final\/定稿\.md)$/);
  return m ? m[1] : basename(draftPath);
})();
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
  exist1ClosureP0: 10,                                  // M-Exist-1 漏引+孤儿 >N → P0（v18.3.1 审计 B9 防降档守卫：漏引 >10 条必须 P0）
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

// v18.3.1（审计 B2 阶段 2）：M-Form 门族亦抽离（_lib/mgate-gates/mform-gates.mjs）。ctx 承载全部
//   门共享态：只读派生量（text/h2s/firstIdx/refRe/…）+ 可变态（dataCard / dataCardReadError 由
//   mForm6 回写，mForm9 / M-Exist-3 / M-Integrity-1 在其后读，时序与抽离前一致）。body/endnote/
//   prose 依赖文末节边界，在 mForm7 之后由主文件计算并挂 ctx。行为逐字等价——run/ 49 组 baseline 对账。
const ctx = {
  results, THRESHOLDS, text,
  draftPath, evDir, projectRoot, skillRoot,
  h2s, firstIdx, firstEnd, refRe, norm,
  figDirArg, findCard, auditsDirOf, findBriefUpward, layoutAnomaly,
  dataCard: '', dataCardReadError: null,
};
mForm2(ctx);
mForm7(ctx);

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


ctx.stripCodeSpans = stripCodeSpans;   // 定义于上方 body 计算区，此处挂 ctx（避免 ctx 字面量前向引用的 TDZ）
ctx.body = body; ctx.endnote = endnote; ctx.bodyProse = bodyProse; ctx.textProse = textProse;
mForm1(ctx);
mForm3(ctx);
mForm5(ctx);
mForm4(ctx);
mForm6(ctx);
mForm8(ctx);
mForm9(ctx);

mExist1(ctx);

mForm10(ctx);

mForm11(ctx);

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
//
// v18.11.0 F-1 反哺修订——硬 P0 红线（**不允许** T8 LLM 兜底覆盖）：
//   以下 4 类是结构性硬缺陷，**必须真修复**后才能 exit≠2。理由：覆盖盲区/格式软提示/严格度过高可 LLM 兜底，
//   但"结构缺失/编号缺失/数据不完整"是论文可用性的硬约束——LLM 标记为假阳性会掩盖真问题。
//   红线 4 类：
//     1. M-Form-2 文末节缺失（缺少 5 节中任一）
//     2. M-Form-7 文末白名单顺序错误（顺序颠倒或缺失）
//     3. M-Exist-1 漏引 > 0（正文有但文末无）
//     4. M-Integrity-1 T2.5 数据条目数 < 需求总数（数据完整性）
//   实装（v18.12.0，全量审计 L-44）：以下硬 P0 红线在 `exit` 判定与**落盘**时强制重审。
//     ⚠️ 本块此前**只有注释、没有实现**（审计实测：声明「强制重审」，而紧随其后的 `exitCode` 表达式里
//     一行红线判定都没有）→ 四条最关键的缺陷仍可被一纸 `_t8_conclusion` 放行。
//     现落到两处：① 本处收集 `hard_red_line_hits` 写进报告；② 落盘时**拒绝采纳**既有 T8 裁定值
//     （见下方 `if (sameDraft && redLineHits.length === 0)`），M-Exist-5 侧另以该字段拒绝放行。
const HARD_RED_LINE_RE = /M-Form-2|M-Form-7|M-Exist-1|M-Integrity-1/;
const hardRedLineHits = results
  .filter((r) => r.pass === false && HARD_RED_LINE_RE.test(String(r.gate || '')))
  .map((r) => `${String(r.gate).split(' ')[0]}(${r.severity})`);
const anyFail = results.some((r) => r.pass === false);
const exitCode = p0 > 0 ? 2 : (p1 > 0 ? 1 : (anyFail || skips > 0 ? 3 : 0));
// v18.12.0（L-05）：进程退出码默认 = 机械值；`--adjudicate` 成功写入裁定时改为**裁定值**
//   （否则会重演「报告 exit=0 而进程 exit=2」——审计把这称作「产物说放行、退出码说 P0」）。
let finalExit = exitCode;
const report = {
  draft: draftPath,
  date: new Date().toISOString().slice(0, 10),
  total: results.length,
  pass, p0, p1, p2, soft, skips,
  hard_red_line_hits: hardRedLineHits,   // v18.12.0（L-44）：非空 ⇒ 不接受 T8 LLM 兜底（T8/门侧共同强制）
  results: wantSummary ? results.filter((r) => !r.pass && r.severity !== 'LLM 兜底') : results,  // --summary 仅保留硬失败项，省 token
  exit: exitCode,
  // 被审正文指纹（v18.0.5）：T8 裁定段据此判断「是否仍适用于本版正文」
  // v18.12.2（L-06）：补 `draft_name` —— 主人 2026-09-25 定案「产物 `-vN` 的 N 跟审计轮次」，
  //   于是**正文轮次与报告轮次解耦**：不再靠「审计报告-vN 必须等于初稿-vN」表达「审的是哪一版」，
  //   改由本字段**逐字记下被审正文档名**（如 `drafts/初稿-v3.md`）+ sha256 组成可机读的审定对象。
  //   为什么两件都给：`draft_name` 供人读与路径核对，`draft_sha256` 供内容核对（防「按名字审的
  //   其实是改过的稿」）。`handoff-check` 的 A4c 与未来的一致性规则都读这两个字段。
  verdict_scope: { draft_name: relativeBase, draft_sha256: draftSha256, draft_bytes: draftBytes },
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
          if (sameDraft && hardRedLineHits.length === 0) {
            if (typeof prev.exit === 'number') out.exit = prev.exit; // 保留 T8 裁定值（正文未变，裁定仍有效）
            out.verdict_stale = false;
            console.error(`· 已保留既有 T8 裁定段（exit=${out.exit}，本次脚本值 script_exit_raw=${report.exit}；正文指纹一致）`);
          } else if (sameDraft) {
            // v18.12.0（L-44）：指纹一致但**本次机械运行命中硬 P0 红线** → 红线不可被 LLM 兜底。
            //   旧版在此直接采纳 prev.exit，等于让红线随裁定一起被冲掉（审计实测：删掉 `## 案例来源`
            //   的稿子机械 exit=2，写一段 `_t8_conclusion` 后落盘报告即变成 exit=0）。
            out.verdict_stale = true;
            out.verdict_stale_reason =
              `本次机械运行命中硬 P0 红线（${hardRedLineHits.join(' / ')}）——红线项不允许 T8 LLM 兜底，`
              + `落盘 exit 改用机械值 ${report.exit}；请真修复红线项后重跑`;
            console.error(
              `⛔ 硬 P0 红线命中（${hardRedLineHits.join(' / ')}）——拒绝采纳既有 T8 裁定值，落盘 exit=${report.exit}；`
              + `红线 4 类不可 LLM 兜底（v18.11.0 F-1 契约，v18.12.0 L-44 实装）`,
            );
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
    // === v18.12.0（全量审计 L-05 落地）：T8 裁定的**正式入口** `--adjudicate <json>` ===
    // 为什么需要它：此前「重跑后重新裁定」**没有正式通道**——脚本只在正文指纹未变时才保留既有裁定，
    //   而指纹一变就把 `exit` 打回机械值；T8 要保留裁定只能**手写**报告（实战项目为此自建
    //   `tools/merge-m-gate-report.js`，直接 `rj.exit = 0`，并产出 `exit=0` + `verdict_stale=true`
    //   这种自相矛盾的交付物）。本通道把它变成**脚本自己做的事**，并带上四道校验：
    //   ① `--adjudicate` 必须与 `--report` 同用（否则无处落盘）；裁定文件缺失/非 JSON → exit 10；
    //   ② 裁定必须给出 `true_p0` / `true_p1`（兼容实战写法 `true_p0_count` / `true_p1_count`）；
    //   ③ **硬 P0 红线不可兜底**（L-44）：本次机械运行命中红线 → **拒绝采纳**，落盘机械值并 exit 30；
    //   ④ **改机械值须给证伪证据**（L-03）：裁定值 ≠ 机械值时，`llm_review` 必须含「证伪四件套」的
    //      至少三项（逐条枚举 / 真阳性扫描 / 规范冲突说明 / 独立复核来源），否则 exit 30。
    //   落盘后：`exit` = 裁定值、`script_exit_raw` = 机械值（禁改）、`verdict_stale: false`、
    //   `_t8_adjudicated_at/_by` 留痕 —— 且**进程退出码 = 裁定值**（避免重演「产物说放行、退出码说 P0」）。
    if (adjudicatePath) {
      if (!reportPath) { console.error('--adjudicate 必须与 --report 同用（裁定要写进报告）'); console.error(MGATE_USAGE); process.exit(10); }
      let adj = null;
      try {
        adj = JSON.parse(readFileSync(adjudicatePath, 'utf8'));
      } catch (e) {
        console.error(`裁定文件读取/解析失败: ${adjudicatePath}（${e.message}）`);
        console.error('  期望 JSON：{"true_p0":0,"true_p1":0,"verdict":"…","llm_review":"① 逐条枚举… ② 真阳性扫描… ③ 规范冲突说明… ④ 独立复核来源…"}');
        process.exit(10);
      }
      const aP0 = adj.true_p0 ?? adj.true_p0_count;
      const aP1 = adj.true_p1 ?? adj.true_p1_count;
      if (aP0 === undefined || aP1 === undefined) {
        console.error('裁定文件缺 `true_p0` / `true_p1`（可写 `true_p0_count` / `true_p1_count`）——无法判定裁定值');
        process.exit(30);
      }
      const adjExit = Number(aP0) > 0 ? 2 : (Number(aP1) > 0 ? 1 : 0);
      const reviewText = typeof adj.llm_review === 'string' ? adj.llm_review : JSON.stringify(adj.llm_review ?? '');
      const FOUR = [/逐条/, /真阳性/, /规范/, /复核|独立/];
      const fourHits = FOUR.filter((re) => re.test(reviewText)).length;
      if (hardRedLineHits.length > 0) {
        console.error(
          `⛔ 拒绝裁定：本次机械运行命中**硬 P0 红线**（${hardRedLineHits.join(' / ')}）——红线项不允许 LLM 兜底`
          + `（v18.11.0 F-1 契约，v18.12.0 L-44 实装）。已落盘机械值 exit=${report.exit}；请真修复红线项后重跑。`,
        );
        console.error(`→ 退出码 30（裁定被拒：裁定无效，报告已落盘机械值）`);
        process.exit(30);
      }
      if (adjExit !== report.exit && fourHits < 3) {
        console.error(
          `⛔ 拒绝裁定：裁定值 ${adjExit} ≠ 本次机械值 ${report.exit}，但 \`llm_review\` 未含「证伪证据四件套」的至少三项`
          + `（当前命中 ${fourHits}/4：逐条枚举 / 真阳性扫描 / 规范冲突说明 / 独立复核来源）。`
          + `\n   —— 四件套是「把机械失败人工修正为通过」的**必填代价**（M-Gate-Algorithm §_t8_llm_review）；`
          + `机械值本就是 ${report.exit} 时无需裁定。已落盘机械值。`,
        );
        console.error(`→ 退出码 30（裁定被拒：裁定段不完整，报告已落盘机械值）`);
        process.exit(30);
      }
      out = {
        ...report,
        script_exit_raw: report.exit,             // 机械原值（禁改）
        exit: adjExit,                            // T8 裁定值
        _t8_conclusion: {
          true_p0: Number(aP0), true_p1: Number(aP1),
          ...(adj.verdict !== undefined ? { verdict: adj.verdict } : {}),
          ...(adj.note !== undefined ? { note: adj.note } : {}),
        },
        _t8_llm_review: adj.llm_review ?? '',
        _t8_adjudicated_at: new Date().toISOString().slice(0, 10),
        _t8_adjudicated_by: 'T8（主控亲执行；经 --adjudicate 正式通道写入）',
        verdict_stale: false,
      };
      finalExit = adjExit;
      console.error(`✅ 已写入 T8 裁定：exit=${adjExit}（script_exit_raw=${report.exit}，证伪四件套 ${fourHits}/4，正文指纹 ${String(draftSha256).slice(0, 12)}…）`);
    }
    // v18.12.0（全量审计 L-50）：`--report` 旧版是裸 writeFileSync —— 路径敲成被审正文即销毁它。
    //   现走 writeReport：与 draftPath 同文件 → exit 10；并留时间戳 .bak（旧版无回滚点）。
    writeReport(reportPath, JSON.stringify(out, null, 2), { protect: [draftPath] });
    console.error(`📄 M-Gate 报告已落盘: ${reportPath}`);
  } catch (e) {
    // v18.2.9（第三方审计 B14）：落盘失败不再吞掉。AGENTS.md 铁律「闸门必须留机械证据（exit code + 产物路径）」
    //   ——报告写不出来时 exit 0/1/2 会让主控以为证据链完整（磁盘满/权限错时实际拿不到报告）。
    //   归为 70（内部错误）：stdout 的机械值仍可读，但主控必须先解决落盘问题才能引用本次判定。
    console.error(`⚠️ M-Gate 报告落盘失败（${e.message}）——闸门机械证据缺失，本次退出码改为 70（内部错误）；请检查磁盘/权限后重跑`);
    process.exit(70);
  }
}
process.exit(finalExit);
