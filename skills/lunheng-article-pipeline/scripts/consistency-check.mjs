// 论衡插件一致性自检脚本（DSH）— 发布/commit 前运行
// 用法：node scripts/consistency-check.mjs
// 覆盖 23 类主规则 + 5 个子规则（编号规则见下；子规则 = ④b 占位符残留 / ⑥b M 门项数 /
//   ⑥c 非 DSH 工具名 / ⑩b 脚本计数 / ⑩c 分档映射）——演进：.5 为 9 类，.13 加 ⑩-⑭，
//   .15 加 ⑮-⑰，.16 加 ⑱，.17 加 ④b + ⑲ + ⑳，18.0.2 加 ⑩b，18.0.3 加 ⑩c，18.2.6 加 ㉒，18.3.1 加 ㉓。
//   **本处两个数字（23 类 / 5 个子规则）不做机械门**——改规则时**手工同步**即可：
//   边界如实声明：脚本无法可靠地从自身文本里数「规则数」（正文里到处是「①-㉑」的引用），
//   所以这里只做**人工同步 + 注释留痕**，不做派生（v18.2.6 审计修复：旧文写「21 类 + 4 个子规则」，
//   实测子规则是 5 个——⑥c 从未被列入清单，属「清单漏项」而非规则缺失）。
//   ① 跨文件版本一致性（package.json ↔ SKILL.md frontmatter ↔ 版本头行 ↔ 仓库级文档）
//   ② 双头版本行 / M-Gate-Report 文件名漂移
//   ③ 悬空引用（版本一致性检查旧名 / scripts/*.mjs 悬空 / 角色卡索引缺失）
//   ④ 裸「（检查）」占位符残留
//   ⑤ 8 分钟硬卡残留 / 硬编码 fallback 链
//   ⑥ 已知口径残留（M-Form 6 项 / M-Gate-Report-v2.2.x / G 项数错标等）
//   ⑦ 全量版本头一致性（防单文件版本头漏 bump）
//   ⑧ cordis.patch.yml + examples/ 版本引用（防安装文档指向未发布版本）
//   ⑨ .dsh 双写同步 + 污染校验（本地，CI 无该目录自动跳过）
//   ⑩ 随包脚本白名单集合一致性（防白名单出现 7/8/9 三种口径）
//   ⑩b 脚本计数全库对账（**结构派生**：句子里列出 ≥3 个 `*.mjs` 名 或「脚本/白名单」+数字 → 该数字 == 磁盘真值）
//   ⑩c 分档工具 ↔ 角色映射全库对账（真源 = model-routing.mjs 的 tool→roles）
//   ⑪ CHANGELOG 当前版本段存在性（防 bump 提交漏写 CHANGELOG）
//   ⑫ 版本点位全量扫描（版本头 / 列表项 / 标题内嵌）
//   ⑬ docs/ 版本点位（安装 pin / 「当前版本」声明；历史章节跳过）
//   ⑭ cordis.patch.yml 执行面红线（!!js 只允许 env / baseUrl / 全局 URL 级取值）
//   ⑮ 派发卡行数上限（每卡 ≤12 行——派发 prompt 最小化的 token 契约）
//   ⑯ 审计视图三方一致（pipeline-readme 声称 ↔ 角色卡 ↔ 生成脚本，防「已投入未兑现」）
//   ⑰ 定量节省断言必须有算式/实测出处（防「省 N%」无出处自我繁殖）
//   ⑱ 图件链路口径（图件路径唯一 + 宣称的图件机械门必须存在 + 图位独占一行规范）
//   ④b 占位符残留（「命令已剥离·DSH 用 read 推理」零容忍）
//   ⑲ 交接契约表（每个声明产出的产物须被产出者声明 + 被下游读清单/证据包引用；版本化报告不得写死 -v1.md）
//   ⑳ M 门文档自洽（M-Gate-Algorithm.md 节头括注项数 == 节内 ### 子节数 == 脚本 gate 标签数；子节编号连续）
//   ㉑ 五语 README 结构镜像（切换器行 + 表格行数 + ## 标题数，五份必须一致）
//   ㉒ 按需查节锚点存在性（SKILL.md 启动清单里 `文件#锚点` 指向的锚点必须真实存在——「按需查节」的机械可定位性）
//   ㉓ 阈值总表自洽（M-Gate-Algorithm.md 阈值总表 == m-gate-check.mjs THRESHOLDS，防阈值双维护漂移）
// 退出码 0 = 通过；1 = 有漂移（列在 stderr）
// (重写用法：node scripts/consistency-check.mjs [--fix]
//   --fix：自动修复可逆的简单漂移（P2 级，如「（检查）」占位符替换）
const fixMode = process.argv.includes('--fix');

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installExitGuard } from './_lib/exit-guard.mjs';
import { runScriptRules } from './_lib/cc-rules/script-rules.mjs';
import { runDocsVersionRules } from './_lib/cc-rules/docs-version-rules.mjs';
import { runContentRules } from './_lib/cc-rules/content-rules.mjs';
import { runMgateDocRules } from './_lib/cc-rules/mgate-doc-rules.mjs';
import { runRepoSurfaceRules } from './_lib/cc-rules/repo-surface-rules.mjs';  // 规则族模块（v18.3.1 审计 B2 阶段 3）   // 退出码硬化（v18.0.5）
installExitGuard();
// v18.0.5（第三方审计 P2）：未知参数此前被静默忽略（`--nope` → exit 0「自检通过」），
//   拼错 `--fix` 会静默走**只读模式**（想自动修却没修，且无提示）。现在显式拒绝。
for (const a of process.argv.slice(2)) {
  if (a !== '--fix') {
    console.error(`未知参数: ${a}\n用法: node scripts/consistency-check.mjs [--fix]`);
    process.exit(1);
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..'); // 技能根（两种布局下均正确）
// REPO_ROOT 探测（v18.0.0 修复）：本包有两种部署布局，旧实现**硬编码「向上两级」**，
//   在「技能即包根」布局下会指向错误目录（实测：本机 `.dsh/skills/<name>/` 部署时，
//   REPO_ROOT 解析成 `~/.dsh`，读 `~/.dsh/package.json` → ENOENT 而整个脚本不可用）。
//   ① 仓库布局：`<repo>/package.json` + `<repo>/skills/lunheng-article-pipeline/`（向上两级）
//   ② 技能即包根：`<skillRoot>/package.json`（本机部署；REPO_ROOT = ROOT）
const REPO_ROOT = existsSync(join(ROOT, 'package.json')) ? ROOT : join(ROOT, '..', '..');

// ① 版本真源 = package.json；版本头行任意 semver（v2.5.2-dsh.3 修订：不再硬编码 v2.5.2，防 bump 后失效）
// **版本号形态真源（v17.0.0 起迁移为纯 semver：迭代号进 major，如 17.0.0 / 18.0.0 / 修补 17.0.1）**：
//   ① 必须同时兼容历史形态 `2.5.2-dsh.N`——CHANGELOG 历史段、旧注解、旧安装 pin 里都还有；
//   ② 每段限 `\d{1,3}`，用于**排除 `2026.09.11` 这类日期串**被误当版本号；
//   ③ prerelease 段可选（`-dsh.17` / `-rc.1`），因为方案迁移前后两种都要认。
const SEMVER = String.raw`\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[0-9A-Za-z][0-9A-Za-z.]*)?`;
const VER_HEADER_RE = new RegExp('^> 版本：v' + SEMVER + '（DSH');
const VER_ANY_RE = new RegExp('v' + SEMVER);
// 上游论衡「**规约版本线**」——与 lunheng-article-pipeline 的**包版本**是两条不同的版本线
// （例：`references/pipeline-readme.md` 标题的 v2.2.14 是规约自身的演进号，随规约改而不随发版改）。
// 旧规则靠 `-dsh.N` 后缀天然把两者分开；v17.0.0 起包版本迁移为**纯 semver**，形态上不再可分，
// 故在此**显式登记**规约版本线（**新增该类标题时须登记一行**），仅供规则 ⑫「标题内嵌版本」豁免。
const UPSTREAM_SPEC_VERSIONS = new Set(['2.2.14']);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    // v18.2.6 审计修复（追加 A）：跳过 .git / node_modules——旧实现**不跳**（而同文件的 walkAny 跳），
    //   于是 `walk(REPO_ROOT)` 会去扫 `node_modules/**/*.md`：既套用「脚本计数」等文本规则
    //   → **假 P1**，又把每次自检拖慢到分钟级（一旦装过依赖）。两处行为现统一为跳过这两类目录。
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

const files = walk(ROOT);
// 排除历史归档 / 旧版协议参考文件（v2.5.2-dsh.10 独立性重构后已移出仓库，规则保留兜底）
const isArchive = (f) => f.includes(join('references', '_shared', 'archive'));
const isLegacyProtocol = (f) => f.endsWith('执行韧化协议-v2.1.0.md');
const active = files.filter((f) => !isArchive(f) && !isLegacyProtocol(f));

// M 门口径派生真源（v2.5.2-dsh.16）：规则 ⑥b 的数字全部从 m-gate-check.mjs 的 gate 标签算出，规则自身不会过期
//   v18.3.1（审计 B2 阶段 1）：M-Exist 门族 + M-Integrity-1 已抽离到 `_lib/mgate-gates/`——
//   派生源改为「主脚本 + 门模块」拼接（缺目录的 P0 在文末规则区报，此处仅记标志）。
const gateModDir = join(ROOT, 'scripts', '_lib', 'mgate-gates');
const gateModMissing = !existsSync(gateModDir);
let gateSrc = readFileSync(join(ROOT, 'scripts', 'm-gate-check.mjs'), 'utf8');
if (!gateModMissing) {
  for (const f of readdirSync(gateModDir).filter((x) => x.endsWith('.mjs'))) {
    gateSrc += '\n' + readFileSync(join(gateModDir, f), 'utf8');
  }
}
const GATE_DERIVED = (() => {
  const grab = (pre) => new Set([...gateSrc.matchAll(new RegExp(`gate:\\s*'(M-${pre}-\\d+)`, 'g'))].map((m) => m[1])).size;
  const form = grab('Form'), exist = grab('Exist'), integ = grab('Integrity');
  return { form, exist, integ, mech: form + exist + integ, total: form + exist + integ + 1 };  // + M-Integrity-2（主控 T7.5 人工门）
})();
// ⑥b 的口径检查（skills/** 与 docs/** 共用；由调用方传 rel 以便定位）
function checkGateCounts(text, rel) {
  const { form, exist, integ, mech, total } = GATE_DERIVED;
  const check = (re, idx, expected, label) => {
    const m = text.match(re);
    if (m && Number(m[idx]) !== expected) {
      errors.push(`[P1 口径残留 M 门${label}] ${rel} 写 ${m[idx]}，脚本派生值应为 ${expected}（M-Form ${form} + M-Exist ${exist} + M-Integrity ${integ}）`);
    }
  };
  check(/M\s*门\s*(\d+)\s*项机械化/, 1, mech, '机械化项数');
  check(/M\s*门\s*(\d+)\s*项(?!机械化)/, 1, total, '总项数');
  check(/M-Form\s*(\d+)\s*项/, 1, form, ' M-Form 项数');
  // 中文括注写法（v2.5.2-dsh.17 加：如「M-Form 形式合规门（10 项）」——旧规则只认紧邻数字，漏检过 T7 速查表）
  //   dsh.17 二次收紧：首版正则要求「项」紧跟右括号，于是「（9 项，含 v2.2.1.2 + …）」这类**带说明的括注
  //   依旧静默漏检**——实测漏掉了 M-Gate-Algorithm.md 的两个节头（M-Form 写 9 项、M-Exist 写 3 项，
  //   现允许「项」后接 [，、；] + 同行任意说明（说明可能很长：实测节头括注达 120+ 字，故不再设长度上限）
  const parenCount = (pre) => new RegExp(`${pre}[^\\n（]{0,18}（(\\d+)\\s*项(?:[，、；][^）\\n]*)?）`);
  check(parenCount('M-Form'), 1, form, ' M-Form 括注项数');
  check(parenCount('M-Exist'), 1, exist, ' M-Exist 括注项数');
  check(parenCount('M-Integrity'), 1, integ + 1, ' M-Integrity 括注项数');   // + M-Integrity-2（主控 T7.5 人工门，未脚本化）
  // dsh.17 三次收紧：又两种写法此前漏检过（实测 AGENTS.md「M 门 20 项中 14 项已脚本化」与 08 卡「**15 项**：M-Form 1-…」）
  check(/M\s*门\s*(\d+)\s*项中\s*(\d+)\s*项已脚本化/, 1, total, '总项数（「N 项中 M 项已脚本化」写法）');
  check(/M\s*门\s*(\d+)\s*项中\s*(\d+)\s*项已脚本化/, 2, mech, '已脚本化项数');
  check(/\*\*(\d+)\s*项\*\*：M-Form\s*1-/, 1, mech, '机械化项数（「**N 项**：M-Form 1-」写法）');
  check(/M-Form\s*(\d+)\s*\/\s*M-Exist\s*(\d+)\s*\/\s*M-Integrity\s*(\d+)/, 1, form, ' 分工（Form）');
  check(/M-Form\s*(\d+)\s*\/\s*M-Exist\s*(\d+)\s*\/\s*M-Integrity\s*(\d+)/, 2, exist, ' 分工（Exist）');
  check(/M-Form\s*(\d+)\s*项\s*\+\s*M-Exist\s*(\d+)\s*项/, 1, form, ' 分项（Form）');
  check(/M-Form\s*(\d+)\s*项\s*\+\s*M-Exist\s*(\d+)\s*项/, 2, exist, ' 分项（Exist）');

  // ❸ M 门项数：**主语 + 限定词两问**（v18.2.6 审计修复 / 断言 A）。
  //  教训（第三方全量审计）：规范侧早已写「一事实一处」，但**「数字一致」没做进任何机械门**，
  //    于是同一事实在多文档间长期漂移。实测旧规则的 6 种紧邻写法**漏掉全部真实漂移点**：
  //      · deliverables.md「M-Form 形式合规门（v2.5.2-dsh.4 口径统一 = 8 项…」+「= 3 项」→ 合 13 项
  //      · 08-终检卡「22 项：M-Form 1-11 + **M-Exist 1-7** + M-Integrity-1」→ 实列 19 项
  //      · 08-终检卡同段「M 门总 **20** 项」（同一段还写着「22 项机械化」，自相矛盾）
  //      · M-Gate-Algorithm「把 **13 项** M 门从…」（数字在「M 门」**之前**的语序）
  //  但「凡出现『N 项』就按 M 门总数校验」会**大面积误报**（实测一次跑出 8 处，逐行核对全为
  //    「主语不是 M 门总数」）。故判定必须是**两问**：① 主语是谁（谁被计数）② 限定词是哪个（哪种口径）。
  //  **反例清单（6 条，全部是从当前仓库实测到的误报——不许把口径改宽回去）**：
  //    1.「22 项 M 门中曾出现 **10 项（45%）需 LLM 人工修正**」→ 10 = 需修正项数（`M-Gate-Algorithm.md:74`、`07-审计-auditor.md:53`）
  //    2.「M 门仍 exit=2，**其中 4 项 P0** 归属上游」→ 4 = P0 条数（`00-主控-扩展职责.md:488`）
  //    3.「G 清单（G0-G14，v2.4.0 加 G14 = **15 项**）」→ G 清单项数，与 M 门无关（`audit-checklist-quickref.md:14`）
  //    4.「## M-Form 形式合规门（**11 项**，含 …）」/「**M-Exist 存在性合规门**（**10 项**）」→ **分项小计，本身正确**
  //    5.「`scripts/m-gate-check.mjs` **第 4 项**「…」」→ 脚本内序号，不是任何项数
  //    6.「…M-Integrity-1 佐证；另有 **1 项**主控人工门 M-Integrity-2」→ 门编号后缀 + 人工门计数
  //    （另有两条同族：`共 22 项` 的回指、`23 项 = 机械 22` 的等式右值 —— 见 ④ 与 ③ 的注释）
  //  **正例清单（6 条，必须报——审计 P1-1 的真实历史形态，即注入验证样本）**：
  //    (a)「M 门 20 项」旧总数        (b)「M 门 13 项」更旧口径
  //    (c)「**22 项**：M-Form 1-11 + M-Exist 1-7 + M-Integrity-1」  (d)「M-Form 形式合规门（8 项，含 …）」
  //    (e)「M-Exist 存在性合规门（3 项，含 …）」                     (f)「v2.5.2-dsh.17 起 19 项有脚本佐证」
  //  判定顺序（短路，先排除再归属）：
  //    ① **排除形态**（命中即跳过）：后文含「需人工/需 LLM/人工修正/需复核」→ 是「待修项数」；
  //       前缀含「其中/曾出现」→ 子集计数；前缀含「G0-G14/G 清单」→ G 项数。
  //    ② **显式总分标记**：前缀紧邻「共/总/合计/=」→ 期望 mech 或 total（**优先级高于分项归属**——
  //       「…M-Integrity-1（共 22 项）」的 22 是对前文的**回指合计**，不是 M-Integrity 的小计）。
  //    ③ **人工项数** / ④ **机械化项数**：前缀紧邻「人工/手动」/「机械/脚本」；或**后**紧邻
  //       「(有|由)?机械|脚本」→ 机械数（「19 项有脚本佐证」即此形）。**`=` 不算紧邻**，
  //       故「M 门总 23 项 = 机械 22 项」里的 23 不会被读成机械数。
  //    ⑤ **分项主语**：同行最近一个 M-Form/M-Exist/M-Integrity 关键词（≤40 字符）→ 期望该档派生值。
  //       **关键词一律用 `M-XXX(?!-\d)` 形态取位**——门编号 `M-Integrity-2` 的后缀数字不是项数。
  //    ⑥ **整体主语**：「M 门」在数字之前且其间 ≤40 字符无数字 → 期望 mech 或 total。
  //    ⑦ 都判不出 → **跳过**（不臆断主语）。
  //  另补 (a) 区间写法 `M-Form 1-N` / `M-Exist 1-N`（08 卡曾写 M-Exist 1-7）：**显式引用旧值的行豁免**
  //    （含「旧版/旧文/历史/废止」，见 HIST_QUOTE）——清仓注解必须能引用旧数字。
  //  负向用例（自测用，勿留在仓里）：① 把任一文档的「M-Exist 1-10」改成「M-Exist 1-7」；
  //    ② 把「共 22 项」改成「共 20 项」；③ 把 08 卡的「**22 项**：M-Form 1-」改成「**15 项**：M-Form 1-」
  //    → 三者都应报 `[P1 M 门项数不自洽]` 并使脚本 exit 1。
  const MANUAL = 1;   // 人工项只有 M-Integrity-2 一项（脚本 gate 标签之外）
  const badCount = (ln, got, want, label) => errors.push(
    `[P1 M 门项数不自洽] ${rel}:${ln} ${label}写 ${got} 项，真源应为 ${want}（真源 = m-gate-check.mjs 的 gate 标签：`
    + `M-Form ${form} + M-Exist ${exist} + M-Integrity ${integ} = 机械 ${mech}；总 ${total} = 机械 ${mech} + 人工 ${MANUAL}）`,
  );
  const FAMILY = [['M-Form', form], ['M-Exist', exist], ['M-Integrity', integ + 1]];
  const HIST_QUOTE = /旧版|旧文|历史|废止|旧口径/;          // 「显式引用旧值」的豁免标记
  const SUBSET_POST = /需人工|需 LLM|人工修正|需复核/;      // 后文出现 → 是「待修项数」，非任何档位计数
  // 「N 项」**后**紧邻机械/脚本 → 该数是机械项数（「19 项有脚本佐证」即此形）。
  //   注意**不放行**「23 项 = 机械 22」：等号说明前半是总数、后半才是机械数，故标记位不包含 `=`。
  const postMech = /^\s*[*）)、，,：:]{0,3}\s*(?:有|由|经)?\s*(?:机械|脚本|已脚本)/;
  // 「N 项」**后**紧邻「（主控）人工门」→ 该数是**人工门**计数（「另有 1 项主控人工门 M-Integrity-2」即此形）。
  //   没有这一支时，那个 1 会被 ⑤ 就近归给 30 字符外的 `M-Exist 1-10` → 误报「M-Exist 写 1 项」（docs 实测）。
  const postManual = /^\s*[*）)、，,：:]{0,3}\s*(?:主控)?\s*人工/;
  // 「共/总/合计/=」紧邻在数字**前** → 显式总分口径（可指机械 22 或总 23）。
  //   不带 `M 门` 前置要求：`白名单脚本机械判定：M-Form 1-11 + …（共 22 项）` 这类句子主语就是整体项数；
  //   G 清单计数已在上游被 `G0-G14/G 清单` 排除。
  const TOTAL_TAIL = /(?:合计|共|总|＝|=)\s*\*{0,2}\s*$/;
  text.split('\n').forEach((l, i) => {
    // 扫描面：M 门关键词 **∪ 机械门的脚本/佐证上下文**。
    //   后者是注入样本 (f)「v2.5.2-dsh.17 起 19 项有脚本佐证」的必要入口——该行可以
    //   **不出现任何 M 门关键词**，但「N 项（有）脚本佐证」在论衡语境里只可能指机械门
    //   （唯一跑 22 项机械判定的脚本就是 m-gate-check.mjs），故同样在断言面内。
    if (!/M\s*门|M-Form|M-Exist|M-Integrity|(?:有|由|经)\s*脚本|m-gate-check/.test(l)) return;
    const ln = i + 1;
    // 门编号 M-Form-11 / M-Exist-3 / M-Integrity-2 的**后缀数字**不是项数——把它当关键词会让
    //   「另有 1 项主控人工门 M-Integrity-2」被读成「M-Integrity 写 1 项」（实测误报）。
    //   故关键词一律用 `M-XXX(?!-\d)` 形态取位；下面的 keyNear 因此不再被门编号干扰。
    const kwPos = (k) => [...l.matchAll(new RegExp(`${k}(?![-\\d])`, 'g'))].map((x) => x.index);
    // (a) 区间写法 M-Form 1-N / M-Exist 1-N（显式引用旧值的行豁免）
    if (!HIST_QUOTE.test(l)) {
      for (const [pre, want] of FAMILY.slice(0, 2)) {
        const m = l.match(new RegExp(`${pre}\\s*1-(\\d+)`));
        if (m && Number(m[1]) !== want) badCount(ln, m[1], want, `「${pre} 1-N」区间的 N`);
      }
    }
    // (b) 每个「N 项」：先排除、再按限定词归属（顺序即优先级，短路）
    for (const m of l.matchAll(/(\d+)\s*项/g)) {
      const n = Number(m[1]);
      const pre = l.slice(0, m.index);
      const post = l.slice(m.index + m[0].length, m.index + m[0].length + 14);
      const tail = pre.replace(/[*：:\s]+$/, '');
      if (SUBSET_POST.test(post)) continue;                                  // ① 待修项数
      if (/其中|曾经|曾出现/.test(pre.slice(-6))) continue;                   // ① 子集计数
      if (/G0-G14|G 清单/.test(pre.slice(-30))) continue;                    // ① G 清单项数
      // ④ 显式总分标记（「共/总/合计/=」紧邻在数字前）优先级**高于**分项归属——
      //   「…M-Integrity-1（共 22 项）」里的 22 是对前文的**回指合计**，不是 M-Integrity 的小计（实测误报）。
      if (TOTAL_TAIL.test(pre)) {
        if (n !== mech && n !== total) badCount(ln, n, `${mech}（机械）或 ${total}（总）`, 'M 门总数');
        continue;
      }
      if (/(?:人工|手动)\s*[*：:]{0,2}$/.test(tail) || postManual.test(post)) {  // ② 人工项数
        if (n !== MANUAL) badCount(ln, n, MANUAL, '人工项数');
        continue;
      }
      if (/(?:机械|脚本|已脚本)\s*[*：:]{0,2}$/.test(tail) || postMech.test(post)) {
        if (n !== mech) badCount(ln, n, mech, '机械化项数');                  // ③ 机械化项数（含「N 项有脚本佐证」）
        continue;
      }
      let keyHit = null, keyDist = Infinity;
      for (const [k, want] of FAMILY) {
        const pos = kwPos(k).filter((x) => x <= m.index).pop();
        if (pos !== undefined && m.index - pos < keyDist) { keyDist = m.index - pos; keyHit = [k, want]; }
      }
      if (keyHit && keyDist <= 40) {                                          // ⑤ 分项主语（标题/速查表括注）
        if (n !== keyHit[1]) badCount(ln, n, keyHit[1], keyHit[0]);
        continue;
      }
      const gm = [...pre.matchAll(/M\s*门/g)].pop();                          // ⑥ 整体主语
      const gapTxt = gm ? pre.slice(gm.index + gm[0].length) : '';
      if (gm && !/\d/.test(gapTxt) && gapTxt.length <= 40 && n !== mech && n !== total) {
        badCount(ln, n, `${mech}（机械）或 ${total}（总）`, 'M 门总数');
      }
      // ⑦ 主语判不出 → 跳过（不臆断）
    }
    // (d) 历史口径黑名单（13/19/20/21）——**未显式标注为旧值**即报；标注行豁免
    if (!HIST_QUOTE.test(l)) {
      for (const m of l.matchAll(/(13|19|20|21)\s*项/g)) {
        badCount(ln, m[1], `${mech}（机械）或 ${total}（总）`, '历史口径');
      }
    }
  });
}

// --fix 模式：自动修复可逆的简单漂移（P2 级）
// v2.5.2-dsh.13 修订（第三方审计 P1）：
//   ① 旧版未导入 writeFileSync → 一执行即 ReferenceError（宣传的「一键修复」100% 不可用）；
//   ② 修复范围必须与检查器的**豁免集一致**：检查侧对 SKILL.md / glossary.md 的「（检查）」放行
//      （元文档说明），修复侧若照写就会改写合法内容 —— 因此此处显式跳过同一豁免集；
//   ③ 默认 dry-run：只打印将改动的位置与条数；`--fix --write` 才落盘，且落盘前写 `.bak-fix` 备份。
const FIX_EXEMPT = [/SKILL\.md$/, /glossary\.md$/];
if (fixMode) {
  const applyFix = process.argv.includes('--write');
  let fixFiles = 0, fixHits = 0;
  for (const f of walk(ROOT)) {
    const rel = relative(ROOT, f).replaceAll('\\', '/');
    if (rel.includes('archive')) continue;
    if (FIX_EXEMPT.some((re) => re.test(f))) continue;
    const text = readFileSync(f, 'utf8');
    const hits = text.split('（检查）').length - 1;
    if (hits === 0) continue;
    fixFiles++; fixHits += hits;
    if (applyFix) {
      copyFileSync(f, f + '.bak-fix');
      writeFileSync(f, text.replaceAll('（检查）', '（按主控 phase 0 协议）'), 'utf8');
      console.log(`  ✓ 已修复 ${rel}（${hits} 处，备份 ${rel}.bak-fix）`);
    } else {
      console.log(`  · 将修复 ${rel}（${hits} 处）`);
    }
  }
  console.log(applyFix
    ? `--fix --write 完成：${fixFiles} 个文件 / ${fixHits} 处`
    : `--fix dry-run：${fixFiles} 个文件 / ${fixHits} 处（加 --write 才落盘；SKILL.md / glossary.md 按检查器豁免集跳过）`);
}

const errors = [];

// 版本号归一化：去掉 v 前缀比较（v2.5.2-dsh.3 == 2.5.2-dsh.3；v17.0.0 == 17.0.0）
const normVer = (s) => (s || '').replace(/^v/, '');

// ① 跨文件版本一致性：package.json version 必须等于 SKILL.md frontmatter version + 仓库级文档版本头
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
const pkgVer = pkg.version;
const skillText = readFileSync(join(ROOT, 'SKILL.md'), 'utf8');
const fmVer = skillText.match(/^version:\s*"([^"]+)"/m)?.[1];
if (!fmVer) errors.push('[P0 版本一致性] SKILL.md frontmatter 缺 version 字段');
else if (normVer(fmVer) !== normVer(pkgVer)) errors.push(`[P0 版本一致性] SKILL.md frontmatter version=${fmVer} ≠ package.json=${pkgVer}`);
// SKILL.md 头部版本行（`> 版本：v...`）
const skillHeader = skillText.split('\n').find((l) => VER_HEADER_RE.test(l));
if (skillHeader && !skillHeader.includes(pkgVer)) {
  errors.push(`[P0 版本一致性] SKILL.md 版本头「${skillHeader.trim().slice(0, 30)}…」≠ package.json=${pkgVer}`);
}
// 仓库级文档版本头（v18.0.0：按部署布局分流）
//   ① 仓库布局（ROOT ≠ REPO_ROOT）：README.md / docs/introduction.md / skills/README.md 三处
//   ② 技能即包根（ROOT === REPO_ROOT，本机 `.dsh/skills/<name>/` 部署）：只有一处 README.md
//      ——旧实现硬编码三处，在布局②下 `README.md` 与 `skills/README.md` 指向**同一文件**（重复检查），
//      且 `docs/introduction.md` 根本不存在 → 产生 3 条假 P0，使脚本在本地部署下不可用。
const isRepoLayout = ROOT !== REPO_ROOT;
const repoTargets = isRepoLayout
  ? [
      ['README.md', join(REPO_ROOT, 'README.md')],
      ['docs/introduction.md', join(REPO_ROOT, 'docs', 'introduction.md')],
      ['skills/README.md', join(ROOT, 'README.md')],
    ]
  : [['README.md', join(ROOT, 'README.md')]];
for (const [rel, p] of repoTargets) {
  if (!existsSync(p)) { errors.push(`[P0 版本一致性] 缺文件 ${rel}`); continue; }
  const t = readFileSync(p, 'utf8');
  const m = t.match(new RegExp('v?' + SEMVER));
  if (!m) errors.push(`[P0 版本一致性] ${rel} 无版本号（期望「> 版本：vX.Y.Z」）`);
  else if (normVer(m[0]) !== normVer(pkgVer)) errors.push(`[P0 版本一致性] ${rel} 写 ${m[0]} ≠ package.json=${pkgVer}（需 bump）`);
}

// ①/⑦ 补面（v18.2.4 新增，第三方审计「门必须覆盖它声称覆盖的规范」；主人指令「修」）：
//   **内联发布示例 `git tag vX.Y.Z && git push origin vX.Y.Z` 此前不在任何门里**。
//   它既非 `版本：` 前缀、也非安装 pin，而版本扫描的其余规则全都跑在**技能目录**（`files = walk(ROOT)`）
//   —— 这 7 处却全在仓库根文件（`CONTRIBUTING.md` 2 处 + 5 语 README 各 1 处），故**四条版本规则全都扫不到**。
//   `CONTRIBUTING.md` §版本号约定 早就记了这个漏点，代价是「每次 bump 靠人工记得刷」（截至 v18.2.3 已刷四次）。
//   故在此**与规则①/⑦ 同址**补扫（同属「仓库级文件版本点位」这一件事，不新增规则号 → 门数表述无需连带改）。
//   只认 `git tag` / `git push origin` 两种形态，不碰散文里的历史注记（那些必须允许留旧号）。
const inlineTagTargets = isRepoLayout
  ? [
      ...['README.md', 'README.zh.md', 'README.es.md', 'README.pt.md', 'README.hi.md'].map((f) => [f, join(REPO_ROOT, f)]),
      ['CONTRIBUTING.md', join(REPO_ROOT, 'CONTRIBUTING.md')],
      ['SECURITY.md', join(REPO_ROOT, 'SECURITY.md')],
    ]
  : [];
for (const [rel, p] of inlineTagTargets) {
  // 缺文件不在此报（规则① 与 ㉑ 已各报一次）——此处只负责「文件在、但内联 tag 写旧版」这一件事
  if (!existsSync(p)) continue
  readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
    const m = l.match(new RegExp('git (?:tag|push origin) v?(' + SEMVER + ')'));
    if (m && normVer(m[1]) !== normVer(pkgVer)) {
      errors.push(`[P1 内联 tag 版本漂移] ${rel}:${i + 1} 写 ${m[1]} ≠ package.json=${pkgVer}（每次 bump 必手工刷新此处）`);
    }
  });
}

for (const f of files) {
  const rel = relative(ROOT, f).replaceAll('\\', '/');
  const text = readFileSync(f, 'utf8');

  // ②a 双头版本行（同一文件出现 ≥2 个版本头）
  const verCount = text.split('\n').filter((l) => VER_HEADER_RE.test(l)).length;
  if (verCount > 1) errors.push(`[P0-1d 双头版本行 x${verCount}] ${rel}`);

  // ②b M-Gate-Report 文件名/标识漂移（v2.5.2-dsh.3 审计：门 V 已明令无版本后缀，含 JSON "schema" 字段值）
  if (!isArchive(f) && /M-Gate-Report-v2\.2\.(4|12)(\.json|")/.test(text)) {
    errors.push(`[P1 M-Gate-Report 文件名/标识漂移（应为 M-Gate-Report.json）] ${rel}`);
  }

  // ③a 悬空引用：旧名「版本一致性检查-v2.3.0.md」残留（独立性重构后该旧机制已删除，发现即清理）
  if (text.includes('版本一致性检查-v2.3.0.md')) {
    errors.push(`[P0-1a 悬空引用「版本一致性检查-v2.3.0.md」] ${rel}`);
  }

  // ③b 裸「（检查）」占位符残留（净化剥离未标记；SKILL.md/glossary.md 为元文档说明，豁免）
  if (text.includes('（检查）') && !rel.endsWith('SKILL.md') && !rel.endsWith('glossary.md')) {
    errors.push(`[P2 裸「（检查）」占位符] ${rel}`);
  }

  // ③c scripts/ 引用完整性：文档引用的脚本文件必须存在
  const scriptRefs = [...text.matchAll(/scripts\/([a-z0-9\-]+\.mjs)/g)].map((mm) => mm[1]);
  for (const s of new Set(scriptRefs)) {
    if (!existsSync(join(ROOT, 'scripts', s))) {
      errors.push(`[P1 scripts 悬空引用 scripts/${s}] ${rel}`);
    }
  }

  // ③d 角色卡索引完整性：SKILL.md/README 声称的 10 张卡（00 主控 + 9 独立角色 01-09）必须全部存在
  if (rel === 'README.md') {
    for (const [label, fn] of [
      ['00-主控-coordinator', '00-主控-coordinator.md'],
      ['01-文献检索', '01-文献检索-literature-scout.md'],
      ['02-数据检索', '02-数据检索-data-scout.md'],
      ['03-案例检索', '03-案例检索-case-scout.md'],
      ['04-分析', '04-分析-analyst.md'],
      ['05-写作', '05-写作-writer.md'],
      ['06-批判', '06-批判-critical-companion.md'],
      ['07-审计', '07-审计-auditor.md'],
      ['08-终检', '08-终检-finalizer.md'],
      ['09-审稿', '09-审稿-peer-reviewer.md'],
    ]) {
      if (!existsSync(join(ROOT, 'references', 'agents', fn))) {
        errors.push(`[P1 角色卡缺失 references/agents/${fn}（${label}）] ${rel}`);
      }
    }
  }

  if (active.includes(f)) {
    // ④ 8 分钟硬卡残留（正向断言，不含「无 8 分钟硬卡」免责声明）
    if (/(>8 分钟|超时硬卡 8 分钟|8 分钟内未出产物|静默 >8 分钟)/.test(text)) {
      errors.push(`[P0-1b 8分钟硬卡残留] ${rel}`);
    }
    // ⑤ 硬编码 fallback 链（应抽象为「能力档 + 候选池」）
    if (/claude-opus-5\s*→\s*fallback\s*链/.test(text)) {
      errors.push(`[P0-1c 硬编码 fallback 链] ${rel}`);
    }
    // ⑥ 已知口径残留（v2.5.2-dsh.3 审计新增：防已修问题复发）
    //   v18.2.6 审计修复：提示语里的「现为 10 项」是**自己写死的数字**（真源已是 11）——
    //   门自己的报错文案过期，比被它拦的东西更讽刺。现改为从 GATE_DERIVED 派生。
    if (/M-Form 形式合规门（6 项）/.test(text) || /M-Form 形式合规门（v2\.2\.0 5 项/.test(text)) {
      errors.push(`[P1 口径残留 M-Form 6 项（现为 ${GATE_DERIVED.form} 项）] ${rel}`);
    }
    if (/G0-G14 十四项/.test(text)) {
      errors.push(`[P1 口径残留 G 清单「十四项」（应为 15 项）] ${rel}`);
    }
    // ⑥b M 门项数与分工口径（v2.5.2-dsh.13 新增；v2.5.2-dsh.16 改为**从脚本派生**——写死数字的规则自己也会过期）
    checkGateCounts(text, rel);
    // ⑥c 非 DSH 工具名黑名单（v2.5.2-dsh.13 新增：文档不得把不存在的工具声明为可用）
    //     负向表述（不存在/不得调用/已废止/历史/旧版/误声明/教训）豁免，避免误伤纠错说明
    {
      const BANNED = ['read_page', 'read_url', 'fetch_page', 'gm_search', 'gm_record', 'session-kill'];
      text.split('\n').forEach((l, i) => {
        for (const b of BANNED) {
          if (l.includes(b) && !/不存在|不得调用|已废止|历史|旧版|误声明|教训|残骸/.test(l)) {
            errors.push(`[P1 非 DSH 工具名「${b}」] ${rel}:${i + 1}`);
          }
        }
      });
    }
    // ④b 占位符残留（v2.5.2-dsh.17 新增）：DSH 迁移把 shell 片段扫成「（命令已剥离·DSH 用 read 推理）」后
    //    有 19 处语义被剥空（含交接报告「位置」、errors.md 整张对照表的「友好版」、一条禁令的主语）。
    //    这类残留让规则失去主语、模板失去路径 → 视为 P1 硬问题，禁止再出现。
    if (/命令已剥离/.test(text)) {
      const lines = text.split('\n');
      lines.forEach((l, i) => {
        if (l.includes('命令已剥离')) errors.push(`[P1 占位符残留] ${rel}:${i + 1} 含「命令已剥离」占位符——必须换回有意义的路径/文案（v2.5.2-dsh.17 已全量清理，勿再引入）`);
      });
    }
    // ⑦ 全量版本头一致性（v2.5.2-dsh.5 审计新增：防单个文件版本头漏 bump）
    const headerLine = text.split('\n').find((l) => l.startsWith('> 版本：v'));
    const headerVer = headerLine?.match(new RegExp('v(' + SEMVER + ')'))?.[1];
    if (headerVer && normVer(headerVer) !== normVer(pkgVer)) {
      errors.push(`[P0 版本头漂移] ${rel} 版本头 v${headerVer} ≠ package.json=${pkgVer}`);
    }
  }
}

// v18.3.1（审计 B2 阶段 3）：规则族抽离为 _lib/cc-rules/ 门模块（5 族，行为逐字等价）。
//   ctx 承载族间共享态：errors / 文件清单（files/active）/ 版本真源（pkgVer/normVer/SEMVER…）/
//   M 门派生源（gateSrc/GATE_DERIVED/checkGateCounts/gateModMissing）/ 共享助手 walk。
const ctx = {
  ROOT, REPO_ROOT, files, active, skillText, gateSrc, GATE_DERIVED, gateModMissing,
  checkGateCounts, SEMVER, normVer, pkgVer, inlineTagTargets, isArchive, UPSTREAM_SPEC_VERSIONS, walk, errors,
};
runScriptRules(ctx);
runDocsVersionRules(ctx);
runContentRules(ctx);
runMgateDocRules(ctx);
runRepoSurfaceRules(ctx);

if (errors.length) {
  console.error(`一致性自检未通过，共 ${errors.length} 处：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`一致性自检通过：${files.length} 个 .md 文件 + cordis.patch.yml/examples/.dsh 同步，0 处漂移。`);
