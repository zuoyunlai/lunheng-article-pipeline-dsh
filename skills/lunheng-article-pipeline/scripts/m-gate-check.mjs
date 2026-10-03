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
//                  M-Form-8 增补「承重墙超载」机检 → 本脚本机检 **24 项**（M-Form 11 + M-Exist 11 + M-Integrity-1 + M-Fact-1 佐证）
// v18.25.0（QLT-2）: 新增 M-Fact-1 跨节事实一致性（数字跨节 + 术语近形）。
// v18.27.0（QLT-4）: 新增 M-Exist-11 反方论证闭合（论点—证据—反方表）。
// v18.61.1 口径收口（文档体检反哺）：M 门**总项数 25 项 = 机检 24 项 + 人工 1 项（M-Integrity-2 跨文件判断，T8 亲做）**。
//   旧头注释写「机检 22 项 / 总 23 项」——**与本脚本自己输出的 `total` 矛盾**
//   （实测 `total = 24`：机检 24 项就是 M-Form 11 + M-Exist 11 + M-Integrity-1 + M-Fact-1，没有第 25 个机械项）。
//   真源口径见 `AGENTS.md`「M 门」节与 `references/_shared/M-Gate-Algorithm.md`：25 项中 24 项已脚本化。
//   本脚本报告里的 `total` = **本次实际入账的机检项数（满配 24）**，人工项 M-Integrity-2 不由本脚本产出。
// 用法: node m-gate-check.mjs <final/定稿.md> <final/证据包目录> [--summary] [--fig-dir <图件目录>] [--report <path>]
//   --summary：仅输出聚合统计（total/pass/p0/p1/p2/soft/skips）+ 硬失败项；省略通过项 details[]（省 ~80% 输出字节，机器可读友好）
//   --fig-dir：图件目录（缺省自动推 <定稿目录>/图件 或 <项目根>/final/图件）
//              ⚠️ v18.2.6：**给了值但路径不存在 → exit 10**（旧版静默丢弃该参数并回退猜测目录，
//              于是「路径敲错」得到的结论比「正确传参」更宽松，与下方定稿/证据包的 10 处理自相矛盾）
// 配套：M-Gate-Algorithm.md「机械化脚本化」段
// 严重度评级（v2.5.2-dsh.5 引入）：gate fail 时按 P0/P1/P2 分级；单子项失败子项数 ≤2 → P2 可放行
//   **exit 70（v18.62.4，全量审计-v18.62.3 P1-3）**：门内**解析/读取失败**（`severity: 'ERROR'`）单独成类
//   → `exit 70`（内部/环境缺陷，**未对内容下结论**）。旧版把这些记 `severity: 'P1'`，于是
//   `final-check.mjs` 会读成「存在 P1 残留，可触发 T5 修订一轮」→ **脚本缺陷把未被修改的稿件送进付费修订轮**，
//   且违反本仓契约「内部错 = 70，绝非 1」（`_lib/exit-guard.mjs`）。`errors` 计入 `hard`（便于人读），
//   但**不计入 p0/p1/p2 桶**、也不进软桶——它的专属出口是 70。
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
import { mExist1, mExist2, mExist3, mExist4, mExist5, mExist6, mExist7, mExist8, mExist9, mExist10, mExist11 } from './_lib/mgate-gates/mexist-gates.mjs';  // M-Exist 门族（v18.3.1 审计 B2 阶段 1）
import { mIntegrity1 } from './_lib/mgate-gates/mintegrity-gate.mjs';
import { mFact1 } from './_lib/mgate-gates/mfact-gate.mjs';   // v18.25.0 QLT-2：M-Fact 族（跨节事实一致性）
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
// v18.62.4（全量审计-v18.62.3 §8.3 #41）：**短路前先做严格校验**。
//   病灶：本分支在**参数解析之前**用 `process.argv.includes` 判定并直接 exit 0 —— 于是
//   `m-gate-check --dump-thresholds --typo`、或 `--typo --dump-thresholds` 里的**拼错旗标被静默忽略**，
//   用户以为自己的参数生效了。这与本仓的**严格解析政策**（见本文件 `:56-59` 与 `_lib/cli-args.mjs`）
//   正面冲突：**同一个脚本里，一种旗标走严格解析、另一种旗标绕过解析**。
//   修法：保留短路（该模式**确实**不接受 `<定稿.md> <证据包目录>`），但**只允许 argv 里出现它自己**——
//   任何多余 token（含空格形式的 `--dump-thresholds=1`）一律 exit 10。位置参数与其它旗标都无意义。
if (process.argv.includes('--dump-thresholds')) {
  const stray = process.argv.slice(2).filter((a) => a !== '--dump-thresholds');
  if (stray.length > 0) {
    console.error(`--dump-thresholds 不接受任何其它参数（收到：${stray.join(' ')}）`);
    console.error('用法: node m-gate-check.mjs --dump-thresholds');
    process.exit(10);   // 参数错一律 10（与「1 = P1 内容失败」区分）
  }
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
const MGATE_USAGE = '用法: node m-gate-check.mjs <定稿.md> <证据包目录> [--summary] [--fig-dir <dir>] [--report <path>] [--adjudicate <T8裁定.json>] [--overwrite-adjudicated]'
  + '（`--overwrite-adjudicated` 与 `--adjudicate` 同给时本旗标无效：裁定通道优先）';
// v18.64.0（反哺报告-v5 §v5.0-1）：新增 `--overwrite-adjudicated` —— **阶段边界显式化**旗标。
//   为什么要有它：目标报告已存在且含 T8 裁定时，普通 `--report` 复跑**默认拒绝覆盖**（exit 3），
//   因为「谁有权写哪个阶段的产物」在工具层原本没有任何校验（实测事故：G14 终闸子代理用 `--report`
//   覆盖了 T8 的裁定报告，14 278 B → 9 609 B；阶段边界被**静默**破坏，只在 `.bak` 时序里看得见）。
//   但 T8 自己的**换稿重裁**是正当的，且它与越界覆盖在工具层**无法凭身份区分**（身份只能自报，
//   自报不可信）→ 故判据不挂在「你是谁」，而挂在「**是否显式声明**」：要跨越阶段边界，必须显式带旗标。
//   判据一句话：**防的是静默越界，不是禁止越界**（同 `对照表` 的「不设防同改清单，防的是静默」）。
let wantSummary, figDirArg, reportPath, adjudicatePath, overwriteAdjudicated, positional;
try {
  const parsed = parseCliArgs(args, {
    flags: ['--summary', '--overwrite-adjudicated'],
    values: { '--fig-dir': 'final/图件', '--report': 'final/M-Gate-Report.json', '--adjudicate': 'audits/t8-conclusion.json' },
    minPositionals: 2,
    maxPositionals: 2,
    positionalHint: '<定稿.md> <证据包目录>',
  });
  wantSummary = parsed.flags.has('--summary');
  figDirArg = parsed.opts['--fig-dir'];
  reportPath = parsed.opts['--report'];
  adjudicatePath = parsed.opts['--adjudicate'];
  overwriteAdjudicated = parsed.flags.has('--overwrite-adjudicated');
  positional = parsed.positionals;
} catch (e) {
  if (e && e.code === CLI_USAGE_CODE) { console.error(e.message); console.error(MGATE_USAGE); process.exit(10); }
  throw e;
}
const draftPath = positional[0];
const evDir = positional[1];
// v18.62.4（全量审计-v18.62.3 §8.3 #42）：**此处原有 `if (!draftPath || !evDir)` 守卫是不可达的** ——
//   上方 `parseCliArgs({ minPositionals: 2, maxPositionals: 2 })` **已保证**恰好两个位置参数；
//   不足或超出都会在那里以 `UsageError` → exit 10 收场。留着它读起来像一道「活的保险」，
//   实则是**永不执行的死代码**（本仓对「写了却不生效的门」有明确态度：删掉或让它真生效）。
//   故删除。**若将来把 `minPositionals` 放松**，必须同批把这条守卫恢复回来——已在
//   `tests/scripts/m-gate-check.test.mjs` 的「m-gate-check 缺参 → exit 10」用例（v18.68.0 拆分归位）里间接钉住该行为。
if (!existsSync(draftPath)) {
  console.error(`定稿不存在: ${draftPath} —— 请先产出 final/定稿.md 再跑 M 门预检`);
  process.exit(10);   // v18.0.2 修：路径错误一律 10（旧版 1 与「P1 内容失败」撞码 → final-check 会误渲染成「存在 P1 残留，可触发 T5 修订」）
}
if (!existsSync(evDir)) {
  console.error(`证据包目录不存在: ${evDir} —— 请先收集证据包再跑 M 门预检`);
  process.exit(10);   // v18.0.2 修：同上
}
// v18.16.0（A-4 反哺 · 守卫上提）：原 `--adjudicate` 必须与 `--report` 同用的判定嵌在 `if (reportPath)`
//   块（:478）内 → 缺 `--report` 时该守卫永不执行，T8 裁定通道在错配时**静默失效**。
//   现提前到参数解析后立即判；与 `if (existsSync(...))` 系列守卫同层。
if (adjudicatePath && !reportPath) {
  console.error('--adjudicate 必须与 --report 同用（裁定要写进报告）');
  console.error(MGATE_USAGE);
  process.exit(10);
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
      // v18.62.4（全量审计-v18.62.3 §8.1 #11）：**旧文案在劝人别管 P0**。
      //   旧句：「缺卡本身按契约记 N/A、不判失败」——**只在「三张卡都没有」时成立**
      //   （`mform-gates.mjs:946` 的 M-Form-10 是唯一记 N/A 的缺卡分支）。而**缺 `数据卡.md`**
      //   会让多个门报 **P0**：M-Form-6 信任级别、M-Exist-2 证据包完整性、M-Exist-3 引用闭环
      //   （实测：空证据包 → 报告里 **5 个 P0**，其中 3 个由缺卡派生）。于是主控读到「不判失败」
      //   就会**不去看那 3 个 P0**——提示与门的实际行为相反，这正是本仓最忌讳的「文档劝人忽略门」。
      //   修法：把「N/A 的适用面」写窄，并**显式点出缺卡会带来的 P0 门名**。
      `  · **缺卡的实际后果（判据按门而异，勿一概而论）**：\n`
      + `      - 记 **N/A**：仅限「三张卡都未找到」那类整体不适用（M-Form-10 索引段完整性 / M-Form-11 素材按需加载）。\n`
      + `      - 报 **P0**：**缺 \`数据卡.md\` 会让 M-Form-6 信任级别、M-Exist-2 证据包完整性、M-Exist-3 引用闭环直接 P0**。\n`
      + `      → 故本提示不中止（②③ 见脚本注释），但**报告里若出现上述 P0，必须当作真失败处理**——\n`
      + `        先确认是「路径传错 / 证据包未生成」，**再**决定是补卡还是改调用；不要因为「缺卡」就跳过 P0。\n`
  );
}

const text = readFileSync(draftPath, 'utf8');
// 被审正文指纹（v18.0.5 新增，第三方审计 P0-1）：T8 裁定必须**绑定它所审的那一版正文**，
//   否则旧裁定会在正文被改动后继续放行（实测：正文追加一段后机械 exit=2，落盘 exit 仍为 0，
//   审计视图同屏显示「P0: 2 ｜ exit: 0」，而该视图被 8 个角色当闸门真源读）。
//   指纹用**内容哈希 + 字节数**（不含 mtime：证据包会复制/重写文件，mtime 不可靠）。
const draftSha256 = createHash('sha256').update(readFileSync(draftPath)).digest('hex');
const draftBytes = readFileSync(draftPath).length;
// v18.13.0（L-06）：被审正文的**项目相对路径**（`drafts/<name>` 或 `final/定稿.md`）——与上面两项
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
  // v18.25.0（QLT-2）：新增 M-Fact 族（跨节事实一致性）。三键语义见下表同行注释（阈值表由本对象单向生成）。
  mfact1Tolerance: 0.02, mfact1MinKeyHan: 4, mfact1AliasMinHits: 2,   // M-Fact-1 跨节事实一致性：数值容差 / 键最短汉字数 / 术语近形对各自最少出现次数
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

mFact1(ctx);   // v18.25.0 QLT-2：M-Fact 族 —— 跨节事实一致性（数字跨节 + 术语近形）

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
mExist11(ctx);   // v18.27.0 QLT-4：反方论证闭合（论点—证据—反方表）


mExist2(ctx);

mExist3(ctx);

mIntegrity1(ctx);

// === 总判定：exit code + 严重度统计（soft=LLM 兜底不 gate，单独 bucket；total=pass+p0+p1+p2+soft+skips）===
const skips = results.filter((r) => r.pass === 'SKIP').length;
const pass = results.filter((r) => r.pass === true).length;
const fail = results.filter((r) => r.pass === false);
const soft = fail.filter((r) => r.severity === 'LLM 兜底').length;
const hard = fail.filter((r) => r.severity !== 'LLM 兜底');
// v18.62.4（P1-3）：门内**解析/读取失败**单独成类 → exit 70（见头部注释与下方 exitCode）
const errors = hard.filter((r) => r.severity === 'ERROR').length;
// v18.62.4（P1-6）：**子检查未执行**的显式清单（门自己用 `unchecked: [原因…]` 声明）。
//   与 SKIP 的区别：SKIP 表示「本门整体未检」（→ exit 3）；`unchecked` 表示「本门主体检了，
//   但其中某个子项因缺输入没跑」——**如实列出、不改退出码**，让机器侧也能看见人读 detail 才看得到的信息。
const unchecked = results.flatMap((r) => (Array.isArray(r.unchecked) ? r.unchecked.map((u) => `${(r.gate || '').split(' ')[0]}：${u}`) : []));

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
//   70 = **门内解析/读取失败**（`severity: 'ERROR'`，v18.62.4 P1-3）——内部/环境缺陷，**未对内容下结论**；
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
// v18.62.4（P1-3）：ERROR 优先级最高 —— 门自己没跑通时，p0/p1 的计数没有意义（可能漏检），
//   故一律 70，让下游 `final-check.mjs` 读成「脚本/环境缺陷，勿触发修订轮」而不是「内容有 P1」。
const exitCode = errors > 0 ? 70 : (p0 > 0 ? 2 : (p1 > 0 ? 1 : (anyFail || skips > 0 ? 3 : 0)));

// === v18.52.0（反哺 F-BB）：换稿重裁的**中间态**识别 —— 报告曾忠实记录「只存在几秒」的状态 ===
// 实测缺陷：主控**先改** `audits/闸门记录-T7.5.md` 的指纹互锁值、**后重写** `final/M-Gate-Report.json`，
//   紧接着那次 `--adjudicate` 运行正好落在中间态（闸门记录已指向新稿 `f267d06a…`，而磁盘上的报告仍绑定
//   旧稿 `193993010373`）→ M-Exist-5 的「闸门 ↔ 报告」指纹互锁**短暂判 P0** → **该瞬时值被"如实"写进交付
//   报告**（`script_exit_raw = 2 / P0 1 / P2 2`）；**重跑一次**后真值 = `3 / P0 0 / P1 0 / P2 3`。
//   即：交付件的机械面本应是**稳定态**，却记录了一个中间态。
// 判据（本块）：**闸门记录已指向本稿** 且 **磁盘上既有报告仍绑定旧稿** ⇒ 本次运行落在「换稿重裁窗口」，
//   M-Exist-5 的互锁是对着**旧报告**判的，其 P0/P1 可能在下一次运行消失。
// 边界（刻意）：**不改判定、不改退出码**——把中间态洗白比记录它更坏；本块只**如实标注**，并把「取稳定态」
//   交给消费侧（T8/主控，见 `agents/08-终检-finalizer.md`）：`transient: true` 的报告其机械值**不构成权威**。
const sha12 = (s) => String(s || '').toLowerCase().slice(0, 12);
const transientInfo = (() => {
  if (!reportPath) return null;                      // 未落盘（stdout 模式）→ 无「上一次写入」可言
  let prev = null;
  try { if (existsSync(reportPath)) prev = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { prev = null; }
  const prevRun = prev ? (Number.isInteger(prev.write_run) ? prev.write_run : 1) : 0;
  const writeRun = prevRun + 1;
  if (!prev) return { write_run: writeRun, transient: false, prevHadVerdict: false, prevSha: null };
  const prevSha = prev.verdict_scope?.draft_sha256;
  // 闸门记录里的「实据 sha256」——取法与 M-Exist-5 的互锁**同源**（同一正则，免得两处口径分叉）
  const projDirT = dirname(dirname(draftPath));
  let recSha = null, recWhich = null;
  for (const gid of ['T7.5', 'T2.5']) {
    try {
      const m = readFileSync(join(projDirT, 'audits', `闸门记录-${gid}.md`), 'utf8').match(/sha256[^\da-f]{0,6}([0-9a-f]{12,64})/i);
      if (m) { recSha = m[1]; recWhich = gid; break; }
    } catch { /* 记录不存在或不含指纹 → 不构成中间态判据（本块不因此判负） */ }
  }
  const draftChanged = typeof prevSha === 'string' && prevSha !== draftSha256;
  const recPointsHere = !!recSha && sha12(recSha) === sha12(draftSha256);
  if (draftChanged && recPointsHere) {
    return {
      write_run: writeRun,
      transient: true,
      // v18.64.2（自审）：把「阶段边界」要用到的两个事实一并带出——避免写盘块与预告块**两处各算一遍**
      //   （同一事实两处实现 = 本仓最反感的形态）。
      prevHadVerdict: !!(prev._t8_conclusion || prev._t8_llm_review),
      prevSha: typeof prevSha === 'string' ? prevSha : null,
      transient_reason:
        `换稿重裁窗口：闸门记录-${recWhich} 已指向本稿（sha256 ${sha12(draftSha256)}…），`
        + `而磁盘上既有报告仍绑定旧稿（sha256 ${sha12(prevSha)}…）→ 本次 M-Exist-5 的指纹互锁是对着**旧报告**判的，`
        + `其 P0/P1 可能在下次运行消失。**本次机械值不构成权威**：请确认闸门记录与报告都已更新后再跑一次取稳定态（v18.52.0 F-BB）`,
    };
  }
  return {
    write_run: writeRun,
    transient: false,
    prevHadVerdict: !!(prev._t8_conclusion || prev._t8_llm_review),
    prevSha: typeof prevSha === 'string' ? prevSha : null,
  };
})();
// v18.64.2（自审 + 独立审计 A-P0-①）：**「本次是否因阶段边界拒绝写盘」必须在打印报告之前算出来**，
//   并作为字段写进 stdout 的 JSON。为什么：消费侧（`final-check.mjs`）只能从 `steps[].exit` 判断那一步
//   成不成功，而「m-gate 非零」**既有可能是没写盘（拒绝覆盖），也有可能是写了盘但机械值非零**
//   （同稿复跑就是后者：进程码 = 本次机械值 1，报告照写且保留裁定）——两者**不能靠退出码区分**。
//   判据：**让工具自己说**（一个字段比两处推断可靠）。实测教训：本判据第一版按「那一步非零」推断，
//   当场被 `tests/scripts/cross-script.test.mjs` 的 A5 用例（机械 1 / 裁定 0 的同稿复跑）红掉（v18.68.0 拆分归位）。
const refuseOverwrite = !!(reportPath && !adjudicatePath && !overwriteAdjudicated
  && transientInfo?.prevHadVerdict && transientInfo.prevSha && transientInfo.prevSha !== draftSha256);
// v18.67.0（全量审计-v18.66.0 P1 修复）：「报告不存在但同目录留有带裁定的 .bak 回滚点」的判据
//   **前移到报告构造之前**，并把 `write_refused` 字段写进 stdout JSON。
//   旧版该判据在 stdout 打印（下文 console.log(JSON.stringify(report))）**之后**才跑 → 走这条
//   exit 3 路径时 stdout **没有** `write_refused` 字段 → `final-check.mjs` 的 `mGateRefusedWrite=false`
//   → 磁盘报告不存在 → recommendation 落入「仅 P2 / LLM 兜底 / SKIP 残留」——与真实原因
//   （拒绝写盘、须人工处置）**语义相反**，T8 会走错处置方向。判据与退出码完全不变，只让工具自己说。
const bakRefuse = (() => {
  if (!reportPath || adjudicatePath || overwriteAdjudicated || existsSync(reportPath)) return null;
  const bakDir = dirname(reportPath); const bakBase = basename(reportPath);
  let baks = [];
  try { baks = readdirSync(bakDir).filter((f) => f.startsWith(bakBase + '.') && f.endsWith('.bak')); } catch { return null; }
  let newestBak = null; let newestT = -1;
  for (const f of baks) {
    try { const st = statSync(join(bakDir, f)); if (st.mtimeMs > newestT) { newestT = st.mtimeMs; newestBak = join(bakDir, f); } } catch { /* 跳过读不动的 */ }
  }
  if (!newestBak) return null;
  try { return /"_t8_(?:conclusion|llm_review)"/.test(readFileSync(newestBak, 'utf8')) ? newestBak : null; } catch { return null; }
})();
if (transientInfo?.transient) {
  console.error(`⚠️ 本次运行处于**换稿重裁中间态**（v18.52.0 F-BB）：${transientInfo.transient_reason}`);
}
// v18.12.0（L-05）：进程退出码默认 = 机械值；`--adjudicate` 成功写入裁定时改为**裁定值**
//   （否则会重演「报告 exit=0 而进程 exit=2」——审计把这称作「产物说放行、退出码说 P0」）。
let finalExit = exitCode;
const report = {
  draft: draftPath,
  date: new Date().toISOString().slice(0, 10),
  total: results.length,
  pass, p0, p1, p2, soft, skips,
  // v18.62.4（P1-6）：**子检查未执行**的显式清单（门用 `unchecked: [...]` 声明）。
  //   为什么单列而不是并进 skips：skips 会把整门记为「未检」并推到 exit 3；而这里描述的是
  //   「本门主体检了、某个子项没跑」——**不改退出码**，但让机器侧看得见（旧版只有 detail 字符串里有人读的信息）。
  ...(unchecked.length ? { unchecked } : {}),
  hard_red_line_hits: hardRedLineHits,   // v18.12.0（L-44）：非空 ⇒ 不接受 T8 LLM 兜底（T8/门侧共同强制）
  results: wantSummary ? results.filter((r) => !r.pass && r.severity !== 'LLM 兜底') : results,  // --summary 仅保留硬失败项，省 token
  exit: exitCode,
  // 被审正文指纹（v18.0.5）：T8 裁定段据此判断「是否仍适用于本版正文」
  // v18.13.0（L-06）：补 `draft_name` —— 主人 2026-09-25 定案「产物 `-vN` 的 N 跟审计轮次」，
  //   于是**正文轮次与报告轮次解耦**：不再靠「审计报告-vN 必须等于初稿-vN」表达「审的是哪一版」，
  //   改由本字段**逐字记下被审正文档名**（如 `drafts/初稿-v3.md`）+ sha256 组成可机读的审定对象。
  //   为什么两件都给：`draft_name` 供人读与路径核对，`draft_sha256` 供内容核对（防「按名字审的
  //   其实是改过的稿」）。`handoff-check` 的 A4c 与未来的一致性规则都读这两个字段。
  verdict_scope: { draft_name: relativeBase, draft_sha256: draftSha256, draft_bytes: draftBytes },
  // v18.52.0（反哺 F-BB）：写入次序留痕 + 中间态标注（判据见上方 transientInfo 块）
  ...(transientInfo
    ? {
      write_run: transientInfo.write_run,
      transient: transientInfo.transient,
      ...(transientInfo.transient_reason ? { transient_reason: transientInfo.transient_reason } : {}),
    }
    : {}),
  // v18.64.2（自审 + 独立审计 A-P0-①）：**本次是否因阶段边界拒绝写盘**——让工具自己说。
  //   消费侧（`final-check.mjs` 的 `summary.mGate`）据此把「磁盘旧报告」标成非本次产物；
  //   没有这个字段时，它只能按「那一步非零」猜，而同稿复跑的进程码非零但**写了盘**（A5 用例实测红）。
  ...(refuseOverwrite ? { write_refused: 'existing_t8_verdict_on_changed_draft' } : {}),
  // v18.67.0（全量审计 P1 修复续）：第二条拒绝写盘路径（.bak 回滚点仍在）同样自报——见上方 bakRefuse。
  ...(bakRefuse ? { write_refused: 'orphan_bak_with_t8_verdict' } : {}),
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
        // v18.54.0（反哺 F-BF②）：`_t8_adjudicated_at` / `_t8_adjudicated_by` 并入 keep 列表。
        //   实测缺陷：裁定当次落盘含这两个键，**随后一次不带 `--adjudicate` 的复跑即静默丢弃**
        //   （顶层只剩 `_t8_llm_review` / `_t8_conclusion` / `script_exit_raw` / `verdict_stale`）
        //   → 报告不再自证「**谁在何时裁定**」，只剩裁定 JSON 本体与闸门记录可查。
        //   判据：随裁定一起写入的**留痕键**，其寿命必须与 `_t8_conclusion` 同步（同寿原则）。
        for (const k of ['_t8_llm_review', '_t8_conclusion', '_t8_adjudicated_at', '_t8_adjudicated_by']) if (prev[k]) keep[k] = prev[k];
        if (Object.keys(keep).length > 0) {
          out = { ...report, ...keep, script_exit_raw: report.exit };
          const prevSha = prev.verdict_scope?.draft_sha256;
          // ── v18.48.0（反哺 F-AV）：陈旧旗标**单调化** + 裁定段按**其自述指纹**判有效性 ──
          // 实测缺陷：`verdict_stale` **不在 keep 列表**、每次重算，判据又只是
          //   「`prev.verdict_scope.draft_sha256` 是否等于本次指纹」→ 于是**同一正文上第二次运行**
          //   必然把上一轮置的 `true` **重置为 false**（第一次运行把 verdict_scope 写成了新指纹，
          //   第二次运行读到「一致」即放行）→ 一度出现「报告自称 `verdict_stale: false` 且绑定新稿指纹，
          //   而 `_t8_conclusion.note` 自述绑定**旧稿**」的三方互斥状态 ——
          //   **绑定旧正文的 T8 裁定，被挂在新正文的报告上、且自称"未过期"**（有 `.bak` 快照序列机械作证）。
          // 两条修正：① `verdict_stale` 一旦为 `true` **不得**被非裁定路径重置（单调；只有 `--adjudicate` 可清）；
          //          ② 裁定段的有效性**按它自己声明的指纹**判（note 内写有 `sha256 <hex>`），
          //             而不是由「上一次输出恰好也指向新稿」来推定。
          const prevStale = prev.verdict_stale === true;
          const declaredRaw = String(prev._t8_conclusion?.note || '').match(/sha256\s*[:：]?\s*([0-9a-fA-F]{12,64})/);
          const declaredSha = declaredRaw ? declaredRaw[1].toLowerCase() : null;
          const declaredOk = !declaredSha || draftSha256.toLowerCase().startsWith(declaredSha.slice(0, 12));
          const sameDraft = typeof prevSha === 'string' && prevSha === draftSha256 && declaredOk;
          if (sameDraft && hardRedLineHits.length === 0 && !prevStale) {
            if (typeof prev.exit === 'number') out.exit = prev.exit; // 保留 T8 裁定值（正文未变，裁定仍有效）
            out.verdict_stale = false;
            console.error(`· 已保留既有 T8 裁定段（exit=${out.exit}，本次脚本值 script_exit_raw=${report.exit}；正文指纹一致）`);
          } else if (sameDraft && hardRedLineHits.length === 0) {
            // 正文与裁定段都指向本稿，但**上一轮已判为陈旧** → 旗标单调，不撤销（须走 `--adjudicate` 才能清）
            if (typeof prev.exit === 'number') out.exit = prev.exit;
            out.verdict_stale = true;
            out.verdict_stale_reason = prev.verdict_stale_reason
              || '既有报告的 `verdict_stale` 已为 true → **单调保留**（v18.48.0 F-AV①）；须经 `--adjudicate` 写入新裁定方可清除';
            console.error('⚠️ 既有报告的 verdict_stale 已是 true → **单调保留**（旧版会把它重置为 false）；如需放行，请 T8 重新裁定后经 `--adjudicate` 写入。');
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
          } else if (refuseOverwrite) {
            // === v18.64.0（反哺报告-v5 §v5.0-1）：阶段边界**硬判据** —— 拒绝**静默**覆盖带 T8 裁定的报告 ===
            // 触发条件（四个同时成立）：① 目标报告已存在且**含 T8 裁定**；② **被审正文真的换了**
            //   （`prev.verdict_scope.draft_sha256 !== 本次`，即旧裁定绑定的正文已不是本稿）；
            //   ③ **不是** `--adjudicate` 正式通道（那条通道有自己的四道校验 + exit 30，且「拒绝裁定时
            //   落盘机械值」是它刻意的行为，见上方 `rejectAdjudication`）；④ 调用方**没有**显式声明
            //   `--overwrite-adjudicated`。
            // ⚠️ 判据刻意**收窄到「正文真换了」**（而不是笼统的 `!sameDraft`）：`sameDraft` 还包含
            //   「`verdict_scope` 指向本稿、但裁定段自述指纹写错」这一种**同一稿内的自相矛盾**（F-AV②）——
            //   那种情形没有跨阶段，应当照旧「标 verdict_stale + 落盘本次机械值」把它**改对**，
            //   拦下来反而会锁死一份内部矛盾的报告（实测：按 `!sameDraft` 写会让 F-AV② 用例红）。
            //   同理 `prevSha` 缺失（v18.0.5 之前写入的报告）**不拦**——无法证明裁决绑的是哪一稿，
            //   旧行为（覆盖 + 标过期 + 在 reason 里写明「无指纹」）才是诚实的兜底。
            // 为什么拒绝而不是照旧覆盖：旧行为（分支 D）是「覆盖 + 标 `verdict_stale`」——内容上旧裁定仍被
            //   `keep` 保留，但**产物边界**被静默跨过（实测事故：G14 子代理覆盖 T8 报告，文件 14 278 → 9 609 B），
            //   且只在 `.bak` 时间序列里可查。判据：**跨阶段写盘必须是显式动作**。
            // 为什么复用 exit 3（不新开码）：3 的既有语义 = 「仅 P2·soft·SKIP，**需人工复核**，不得当通过」
            //   （`m-gate-check.mjs` 的取值分支 + `final-check.mjs:175` 同义复用都如此），本场景正是
            //   「脚本拒绝替你判断，交人看一眼」；退出码配额（12 个）已满，新开码要动三处契约而不增信息量。
            console.error(
              '⛔ **拒绝覆盖**：目标报告已存在且含 T8 裁定，而被审正文指纹已变更 —— 本次**不写盘**。\n'
              + `   既有报告绑定正文：${String(prevSha).slice(0, 12)}… ｜ 本次正文：${draftSha256.slice(0, 12)}…\n`
              + `   既有裁定值 exit=${typeof prev.exit === 'number' ? prev.exit : 'n/a'}；报告**原样保留**在磁盘（${reportPath}）。\n`
              + '   两条出路：① 这确是 T8 的**换稿重裁** → 显式加 `--overwrite-adjudicated` 重跑'
              + '（旧裁定原文保留、`verdict_stale` 标 true）；② 要写**新裁定** → 走正式通道 `--adjudicate <T8裁定.json>`。\n'
              + '   判据：**防的是静默越界，不是禁止越界**——阶段边界的跨越必须显式（v18.64.0 反哺报告-v5 §v5.0-1）。',
            );
            console.error('→ 退出码 3（需人工复核，不得当作通过）');
            process.exit(3);
          } else {
            // 正文已变（或旧报告无指纹）→ 旧裁定不再适用于本版正文：保留裁定原文供追溯，但落盘用**机械值**
            out.verdict_stale = true;
            out.verdict_stale_reason = !declaredOk
              ? `T8 裁定段**自述绑定的指纹**（${String(declaredSha).slice(0, 12)}…）与本版正文（${draftSha256.slice(0, 12)}…）不符 → 旧裁定不适用于本版正文（v18.48.0 F-AV②）`
              : (prevSha
                ? `被审正文已变更（旧 sha256=${prevSha.slice(0, 12)}…，本次=${draftSha256.slice(0, 12)}…）→ 旧 T8 裁定不适用于本版正文`
                : '既有报告无 verdict_scope 指纹（v18.0.5 之前写入）→ 无法证明裁定适用于本版正文');
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
        // v18.62.4（全量审计-v18.62.3 P2-5）：**这行提示曾逐字印出「证伪四件套」的四个关键词**，
        //   而紧随其后的校验（下方 `FOUR`）正是靠**关键词命中**判定（≥3 项）。于是「把本提示原文
        //   粘进 `llm_review`」即可让关键词校验满分 —— 校验退化为「格式检查」，声称的「证据」其实没被看。
        //   故：提示**保留形状**（告诉调用方要哪些字段），但**不再给出可复制的关键词**。
        //   判据：**模板不得包含校验所依赖的字面量**（否则校验等于在考自己出的题）。
        console.error('  期望 JSON：{"true_p0":0,"true_p1":0,"verdict":"…","llm_review":"<证伪证据四件套，逐项写明；具体要件见 SKILL.md/审计报告，本处不再印出关键词>"}');
        process.exit(10);
      }
      const aP0 = adj.true_p0 ?? adj.true_p0_count;
      const aP1 = adj.true_p1 ?? adj.true_p1_count;
      if (aP0 === undefined || aP1 === undefined) {
        console.error('裁定文件缺 `true_p0` / `true_p1`（可写 `true_p0_count` / `true_p1_count`）——无法判定裁定值');
        process.exit(30);
      }
      // v18.67.0（全量审计-v18.66.0 P1 修复）：true_p0/true_p1 必须是**可整数值**。
      //   旧版只挡 `undefined`：`Number("2条")`/`Number("一")` = NaN，`NaN > 0` = false → adjExit 静默
      //   按 0 计；若本次机械值恰为 0，`adjExit === report.exit` 绕过证伪四件套校验，且 NaN 经
      //   JSON.stringify 落盘变 null（非合法 JSON number）。裁定通道是放行权威入口，宁拒勿猜。
      if (!Number.isInteger(Number(aP0)) || !Number.isInteger(Number(aP1)) || Number(aP0) < 0 || Number(aP1) < 0) {
        console.error(`裁定文件的 true_p0 / true_p1 必须是非负整数（收到 true_p0=${JSON.stringify(aP0)}, true_p1=${JSON.stringify(aP1)}）——拒绝裁定`);
        process.exit(30);
      }
      const adjExit = Number(aP0) > 0 ? 2 : (Number(aP1) > 0 ? 1 : 0);
      const reviewText = typeof adj.llm_review === 'string' ? adj.llm_review : JSON.stringify(adj.llm_review ?? '');
      const FOUR = [/逐条/, /真阳性/, /规范/, /复核|独立/];
      const fourHits = FOUR.filter((re) => re.test(reviewText)).length;
      const rejectAdjudication = (reason, detail) => {
        const rejected = {
          ...report,
          script_exit_raw: report.exit,
          verdict_stale: true,
          verdict_stale_reason: reason,
        };
        // The rejected verdict must not leave an older passing report on disk.
        writeReport(reportPath, JSON.stringify(rejected, null, 2), { protect: [draftPath] });
        console.error(`⛔ 拒绝裁定：${detail}；本次机械值 exit=${report.exit} 已写入 ${reportPath}。`);
        console.error('→ 退出码 30（裁定被拒；磁盘报告已更新为本次机械值）');
        process.exit(30);
      };
      if (hardRedLineHits.length > 0) {
        rejectAdjudication(
          `本次机械运行命中硬 P0 红线（${hardRedLineHits.join(' / ')}）`,
          `本次机械运行命中**硬 P0 红线**（${hardRedLineHits.join(' / ')}）——红线项不允许 LLM 兜底（v18.11.0 F-1 契约，v18.12.0 L-44 实装）`,
        );
      }
      if (adjExit !== report.exit && fourHits < 3) {
        rejectAdjudication(
          `裁定值 ${adjExit} 与机械值 ${report.exit} 不同，但证伪四件套仅命中 ${fourHits}/4`,
          `裁定值 ${adjExit} ≠ 本次机械值 ${report.exit}，但证伪证据四件套仅命中 ${fourHits}/4（至少需要 3 项）`,
        );
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
    // === v18.64.2（自审 · 独立审计 A-P0-②）：**删掉报告再跑**不得静默丢掉裁定 ===
    // 停靠点：上面的「拒绝覆盖」只在「目标报告**存在**且含裁定」时生效；把报告 `rm` 掉再跑就绕过了它
    //   （实测：rm → 换稿 → 普通 `--report` → 新报告落盘、`_t8_conclusion` 整段消失），而 `rm` 恰好是
    //   「想重跑却看到旧报告」的**恢复动作**——即：事故的恢复路径 = 本判据的绕过路径。
    // 判据（刻意窄）：目标**不存在**、但同目录留有 `writeReport` 写下的**带裁定的回滚点**
    //   （`<名>.<时间戳>.bak`）→ 视为「有人删掉了带裁定的报告」，按同一套语义拒绝（exit 3），
    //   除非调用方显式声明 `--overwrite-adjudicated`。
    // 边界（如实）：它挡不住「连 `.bak` 一起删」——那已是有意毁灭证据，超出「防**静默**越界」的范围
    //   （同 ADR-0004 的 Consequences/Negative）。
    // v18.67.0（全量审计 P1 修复）：判据已**前移**到报告构造前（`bakRefuse`），stdout JSON 现已带
    //   `write_refused: 'orphan_bak_with_t8_verdict'` 字段——final-check 不再把它误读成「仅 P2 残留」。
    if (bakRefuse) {
      console.error('⛔ **拒绝写盘（回滚点仍在）**：目标报告不存在，但同目录留有**带 T8 裁定的回滚点**：');
      console.error(`   ${basename(bakRefuse)}`);
      console.error('   判读：**有人删掉了带裁定的报告**（`rm` 是「重跑」的恢复动作，也是本判据唯一能看到的痕迹）。');
      console.error('   两条出路：① 确认要弃掉旧裁定重来 → 显式加 `--overwrite-adjudicated` 重跑；② 要写/更新裁定 → 走正式通道 `--adjudicate <T8裁定.json>`。');
      console.error('   判据：**防的是静默越界**——删报告再重跑会让旧裁定整段消失而不留痕（v18.64.2 反哺报告-v5 §v5.0-1 收口）。');
      console.error('→ 退出码 3（需人工复核，不得当作通过）');
      process.exit(3);
    }
    // v18.12.0（全量审计 L-50）：`--report` 旧版是裸 writeFileSync —— 路径敲成被审正文即销毁它。
    //   现走 writeReport：与 draftPath 同文件 → exit 10；并留时间戳 .bak（旧版无回滚点）。
    writeReport(reportPath, JSON.stringify(out, null, 2), { protect: [draftPath] });
    console.error(`📄 M-Gate 报告已落盘: ${reportPath}`);
    // v18.54.0（反哺 F-BF①）：**非裁定复跑**时把「进程码 / 报告裁定值」两个数同时说清。
    //   实测缺陷：`--adjudicate` 成功当次进程码 = 裁定值（0）；**其后任一次普通复跑**的进程码
    //   回到**本次机械值**（实测 1），而落盘报告的 `exit` 仍是已采纳的裁定值 0 → **两个数不同**。
    //   后果：只看 shell 的 `$LASTEXITCODE` 会把「已裁定放行」误读为「有 P1 未放行」；只看报告则相反。
    //   判据：**同一个事实有两个权威读数时，工具必须把两个都打出来，并指明谁是本次的进程码**——
    //   这与 F-BF② 同属「别让消费者去猜」，也是 v18.12.0 L-05「产物说放行、退出码说 P0」的续修。
    if (!adjudicatePath && typeof out.exit === 'number' && out.exit !== report.exit) {
      console.error(
        `ℹ️ 本次为**非裁定复跑**：进程退出码 = 本次机械值 ${report.exit}，`
        + `而报告中保留的**有效裁定值** = ${out.exit}（script_exit_raw=${report.exit} 已另存；`
        + `既有 T8 裁定未过期${out.verdict_stale ? '（⚠️ 但 verdict_stale=true，见上）' : ''}）。`
        + `\n   读法：**判定放行与否以报告的 exit 字段为准**；进程码在本模式下只表示「本次机械面有几级」。`,
      );
    }
  } catch (e) {
    // v18.2.9（第三方审计 B14）：落盘失败不再吞掉。AGENTS.md 铁律「闸门必须留机械证据（exit code + 产物路径）」
    //   ——报告写不出来时 exit 0/1/2 会让主控以为证据链完整（磁盘满/权限错时实际拿不到报告）。
    //   归为 70（内部错误）：stdout 的机械值仍可读，但主控必须先解决落盘问题才能引用本次判定。
    console.error(`⚠️ M-Gate 报告落盘失败（${e.message}）——闸门机械证据缺失，本次退出码改为 70（内部错误）；请检查磁盘/权限后重跑`);
    process.exit(70);
  }
}
process.exit(finalExit);
