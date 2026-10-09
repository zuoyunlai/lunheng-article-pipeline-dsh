// 论衡插件一致性自检脚本（DSH）— 发布/commit 前运行
// 用法：node scripts/consistency-check.mjs
// 覆盖的**主规则清单与条数 = 单一真源 `_lib/cc-rules/rule-registry.mjs` 的 `RULE_REGISTRY`**
//   （v18.78.2 · 全量审计-v18.78.1 **A2**：本处此前手写「N 类主规则 + M 个子规则」，在 v18.2.6 / v18.18.0 /
//    v18.22.1 / v18.78.0 **四次**被审计抓到数字互不相等；A2 的注入实证更狠——把 `glossary.md` 的
//    「31 类主规则」改成「99 类」，本脚本仍 exit 0。**现本处不再写任何数字**：不写就不会漂。
//    规则 **㉟** 机械保证「登记表 ↔ 各模块规则级标签」双向覆盖 + 编号唯一。）
//   编号规则见下；子规则 = ④b 占位符残留 / ⑥b M 门项数 /
//   ⑥c 非 DSH 工具名 / ⑩b 脚本计数 / ⑩c 分档映射 / ⑩d 产物 version）——演进：.5 为 9 类，.13 加 ⑩-⑭，
//   .15 加 ⑮-⑰，.16 加 ⑱，.17 加 ④b + ⑲ + ⑳，18.0.2 加 ⑩b，18.0.3 加 ⑩c，18.2.6 加 ㉒，18.3.1 加 ㉓，
//   18.12.3 加 ㉔，18.18.0 加 ㉕（由 ⑳ 改名——⑳ 原为同号两义，见下 ㉕），本次审计加 ㉖ + ㉕ 扩枚举对账，
//   **18.22.1 加 ㉘ + 回填 ㉗**（㉗ 自 18.12.0 实装起一直未进本清单；计数 26 → 28），
//   **18.34.0 加 ㉙**（G 项主清单口径；计数 28 → 29——㉙ 是 ⑥b **刻意豁免**掉的那块盲区）。
//   **18.78.0 加 ㉜**（CHANGELOG 新段位 ↔ introduction.md §实战验证段对账；计数 30 → 31——
//     v18.78.0 文档全量审计 §7.1 立项，动机为 introduction 实战段对账滞后）。
//   （v18.78.2 · A2 收口）旧版本此处写过「注：旧『24 类』本身少算 1…校正为 26」与
//   「**本处两个数字不做机械门**——改规则时手工同步即可」，并如实声明「脚本无法可靠地从自身文本里数规则数
//   （正文里到处是『①-㉕』的引用），故只做人工同步 + 注释留痕」。**这段自我豁免正是四次复发的机制**：
//   人工同步在「加规则」这个高频动作上必然漏。现处置为「**把规则清单上提为代码登记表**」
//   （`_lib/cc-rules/rule-registry.mjs`）+ 规则 ㉟ 双向对账 + 编号唯一——原来的两难（文本里数不准 vs
//   手工同步会漏）由「登记表 + 标签双向覆盖」同时解掉：数不准的问题变成「标签必须存在才登记得上」。
//   子规则的计数口径**不再声明**：实测带后缀的标签有十余个（②a-②c / ③a-③d / ④b / ⑥b / ⑥c / ⑩b-⑩d），
//   而本处曾声明「5 个子规则」——同一类手写漂移，故一并删除，只登记**无后缀主规则**。
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
//   ㉔ Phase 序列自洽（v18.12.3 落地审计 L-07：pipeline-readme **流水线全景**里出现的 Phase 编号
//      ⊆ `SKILL.md` §⚡ 启动速查表的 `- Phase：` 序列——该序列是主控排 `todo_write` 的唯一真源，
//      而流水线全景是各 Phase 的详述真源；两者不交叉比对时，新阶段会悄悄只存在于其中一侧，
//      主控的计划里就没有那一步——L-07 的 `Phase 1.5`/`Phase 4.2` 正是这样「消失」了整轮修订回环）
//   ㉕ 命令数口径（/lunheng 斜杠命令数唯一真源 = skills/lunheng-commands/scripts/route-command.mjs
//      的 COMMANDS 表；凡文档写「N 个 /lunheng 命令」且 N ≠ 真源数 → P1。
//      v18.18.0 由 ⑳ 改名——⑳ 原为同号两义（本规则 vs M-Gate 文档自洽），改名后全库编号唯一）
//   ㉖ 子技能版本一致性（lunheng-commands 三件套 SKILL.md / README.md / package.json 的 1.0.x 版本
//      交叉核对；主包规则① 只对账 18.x 主版本，子技能版本此前无门覆盖）
//   ㉗ 全库锚点覆盖（v18.12.0 落地审计 L-24；实装位置 = `_lib/cc-rules/content-rules.mjs` 末段）——
//      技能目录内 .md 的 `](#anchor)` 形内链，目标标题 slug 必须存在（GitHub slug 口径：小写 → 去 emoji 与标点 →
//      每空格转一个 `-`，不折叠不裁剪）。**v18.22.1 回填**：该规则自 v18.12.0 实装后**一直未进本清单**
//      （「加规则忘改清单」的同族）——本次随 ㉘ 一并补登，并把计数由 26 校正为 28。
//   ㉘ SKILL.md 正文禁历史叙事句（v18.22.1 CTX-1）——常驻体只留现行口径；标记词
//      「此前 / 曾经 / 旧版 / 已删 / 已移除 / 已作废 / 历史见 git log」命中即 P2；放行白名单 =
//      同时含 `CHANGELOG.md` 指针与「为什么 / 成因」的**外移指针行**。
//      为什么需要门：SKILL.md **每次技能激活都进上下文**，而版本增量/历史成因类叙述只对维护者有意义；
//      无门守护时它会随版本回涨（v18.22.0 报告 §二.4a 实测：拆分后 17 天 +115.9%）。
//      词表刻意收窄（不含「原值」= `script_exit_raw` 的技术术语 / 不含中性词「增量」/ 不含单字「曾」），
//      理由与实测反证写在实装处注释里。
//   ㉙ G 项主清单口径（v18.34.0；实装位置 = `_lib/cc-rules/content-rules.mjs` 末段）——真源 =
//      `_lib/mgate-gates/mexist-gates.mjs` 的 `G_MAIN`。① 任何「G0-G14 … N 项」计数必须 == G_MAIN.length；
//      ② T7 派发话术的 G 清单必须列全。**为什么它是独立规则**：M 门项数规则 ⑥b **刻意豁免**了
//      「G0-G14 / G 清单」前缀的行（防把 G 项数误读成 M 门项数，豁免本身正确），于是 G 项数成了**盲区**——
//      实测该盲区里同时漂了四处（三处计数写 14、派发话术漏列 G14），而照抄派发话术会直接产出
//      M-Exist-9 判 P1 的报告。㉙ 补的正是这块，**⑥b 的豁免一个字未动**。
//   ㉛ 派发话术格式硬约束 ⊆ `_shared/机检硬格式.md` 必填项（v18.77.0 · 文档与运行-审计 v1 批 P-12；
//      实装位置 = `_lib/cc-rules/script-rules.mjs` 末段）。派发话术是派发层唯一真源
//      （子代理照抄派发话术产出），其「格式硬约束」集合必须 ⊆ `_shared/机检硬格式.md` §一/§五 的必填项。
//      **为什么立这条**：v18.2.7 已写明「最小集 ↔ 真源不同步」的代价（最小集没把 `[Lxx]` 列进，
//      2026-09-20 全流程第三次踩到）；本次落地为唯一机械对账。
//   ㉚ `lib/**` 代码面禁当前版本字面量（v18.76.0 · v18.75.1 全量架构审计 R7-E5；
//      实装位置 = `_lib/cc-rules/script-rules.mjs` 末段）。本仓其余版本规则全部跑在**技能根 .md** 上，
//      `lib/**` 是唯一敞着的版本面——v18.62.4（尾注正文）/ v18.62.6（尾注**标题**）两次硬编码当前版本
//      都靠人工发现。判据：**剥注释后**再看代码里有没有 == `pkgVer` 的 semver（注释里引用当前版本号是
//      本仓惯例，不是漂移源；剥注释只可能造成假阴性，不会误报）。
//   ㉜ CHANGELOG 新段位 ↔ introduction.md 实战验证段对账（v18.78.0 文档全量审计 §7.1 立项；
//      实装位置 = `_lib/cc-rules/content-rules.mjs` 末段）。**动机**：introduction.md §实战验证是新人
//      首屏对账表（README Verification status 之外的详解入口）；README 表格由 commit 同步，但
//      introduction §实战验证段需主控人工 update——CHANGELOG 新段位的实测产物（含 audit-report §P-*）
//      经常遗漏（v18.78.0 实测 introduction 实战段仅含 v2.3.7-dsh.8 一例 v2.x 案例，README 已列 6 个 v18.x）。
//      **判据**：CHANGELOG.md 出现新段（`## X.Y.Z — YYYY-MM-DD` 形态）且段位号 > introduction.md
//      §实战验证段最新提及版本号 + 距离 ≥ 1 段 → **P1**（实战案例章节滞后）。
//      **边界**：① 仅新段位触发，不动子段；② 仅对 introduction.md §实战验证段对账，不动其他段；
//      ③ 段位号 ≤ introduction.md 最新提及版本号 → 不报；④ 主人 review 可加 `WAIVER=实战滞后` 跳过。
//      **为什么需要这条**：实战案例段与 README Verification status 表「事实互引」（v18.78.0 落地）
//      但 introduction 的更新速度经常落后——CI 必须兜住。
//   ⑩d 产物 `version` 不得写死（v18.62.4 · 全量审计-v18.62.3 §8.3 #39）——子规则，实装于 `script-rules.mjs`
//   ㉝ 脚本数次级数字外泄扫描（v18.9.0；**v18.78.2 由重号 ㉕ 改**——与「㉕ 命令数口径」撞号）
//   ㉞ 全仓库 .md BOM 检测（v18.9.0；**v18.78.2 由重号 ㉖ 改**——与「㉖ 子技能版本一致性」撞号）
//   ㊱ 模板示例 ↔ 机检契约对照（v18.60.1；**v18.78.2 由重号 ㉚ 改**——与「㉚ lib 禁版本字面量」撞号）
//   ㉟ 一致性规则登记表自洽（v18.78.2 · A2 新立）——真源 = `_lib/cc-rules/rule-registry.mjs`：
//      ① **编号唯一**（同号不得跨模块复用）；② **双向覆盖**（登记表 id ↔ 其声明模块里的规则级标签）。
//      **为什么立它**：本处「N 类主规则」四次被审计抓到不一致（加规则忘改数字），且 ㉟ 首次运行即抓出
//      三对实测重号（㉕/㉖/㉚）——人工同步的失效是系统性的。
//      **边界**：只认**无字母后缀**的规则级标签（「// 编号空格」形态，跳过模块第 1 行）；内层枚举若写成
//      同形会被当成标签（现库内两处已改为 `// · 编号`），详见 ㉟ 的实装注释。
// 退出码 0 = 通过；1 = 有漂移（列在 stderr）
// (重写用法：node scripts/consistency-check.mjs [--fix]
//   --fix：自动修复可逆的简单漂移（P2 级，如「（检查）」占位符替换）
const fixMode = process.argv.includes('--fix');

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { sep } from 'node:path';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installExitGuard } from './_lib/exit-guard.mjs';
import { writeWithSafety } from './_lib/destructive-write.mjs';   // v18.12.0（L-66）：--fix 落盘走原子写 + 时间戳 .bak
import { runScriptRules } from './_lib/cc-rules/script-rules.mjs';
import { runDocsVersionRules } from './_lib/cc-rules/docs-version-rules.mjs';
import { runContentRules } from './_lib/cc-rules/content-rules.mjs';
import { runMgateDocRules } from './_lib/cc-rules/mgate-doc-rules.mjs';
import { runRepoSurfaceRules } from './_lib/cc-rules/repo-surface-rules.mjs';  // 规则族模块（v18.3.1 审计 B2 阶段 3）   // 退出码硬化（v18.0.5）
import { loadGateSource, deriveGateCounts } from './_lib/mgate-gates/gate-count.mjs';  // M 门项数派生真源（v18.78.2 · 全量审计 A4：与审计视图共用同一实现）
import { requireTruthSource } from './_lib/cc-rules/truth-source.mjs';  // 真源缺失即 P0（v18.78.2 · 全量审计 A6）
installExitGuard();
// v18.0.5（第三方审计 P2）：未知参数此前被静默忽略（`--nope` → exit 0「自检通过」），
//   拼错 `--fix` 会静默走**只读模式**（想自动修却没修，且无提示）。现在显式拒绝。
//   v18.7.2（P0-2 修复，全量审计实证）：旧守卫只放行 `--fix`，`--write` 被拒 exit 1——
//   而 --fix 分支内 `applyFix = process.argv.includes('--write')` 与「--fix --write 完成」文案
//   均依赖该旗标 → 宣传的自动修复落盘 100% 不可达（只能 dry-run）。白名单加入 `--write`。
for (const a of process.argv.slice(2)) {
  if (a !== '--fix' && a !== '--write') {
    console.error(`未知参数: ${a}\n用法: node scripts/consistency-check.mjs [--fix] [--write]`);
    // v18.12.0（全量审计 L-62）：**参数错改 10**。旧版给 1 —— 而本仓 1 的语义是「存在 P1 内容失败」
    //   （闸门脚本）／「有未决条目」（normalize-trust-level）；`consistency-check` 的 1 同时用于
    //   「文档漂移」。于是「旗标拼错」与「文档真漂移」撞在同一个码上，主控无法区分该改命令还是改文档。
    //   AGENTS.md 已明令「参数或路径错误一律 10」，此处收口。
    process.exit(10);
  }
}
// v18.12.0（全量审计 L-66）：`--write` **单独给出**此前被白名单接受却**静默空转**（只读模式跑完 exit 0，
//   用户以为已修复）。二者必须成对，否则报参数错。
if (process.argv.includes('--write') && !process.argv.includes('--fix')) {
  console.error('--write 必须与 --fix 同用（--write 单独给出不会落盘）\n用法: node scripts/consistency-check.mjs --fix --write');
  process.exit(10);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..'); // 技能根（两种布局下均正确）
// REPO_ROOT 探测（v18.0.0 修复；v18.12.0 收紧，全量审计 L-53）：
//   ① 仓库布局：`<repo>/package.json` + `<repo>/skills/lunheng-article-pipeline/`（向上两级）
//   ② 技能即包根：`<skillRoot>/package.json`（本机部署；REPO_ROOT = ROOT）
//   **v18.12.0（L-53）为什么必须收紧**：旧实现只判「候选目录下有没有 package.json」。在**部署镜像**
//   `…/.dsh/skills/lunheng-article-pipeline` 里运行时，`ROOT` 下无 package.json（镜像不含它），于是
//   `REPO_ROOT = ROOT/../.. = …/.dsh` —— 而 `…/.dsh/package.json` **恰好存在**（是另一个包/残留），
//   后果有二：① 规则⑨ 的「镜像 ↔ 真源」两路径**归一后完全相同**（自比）→ **恒真假绿**；
//   ② 版本真源被换成那个 package.json（实测为 v18.10.0）→ 镜像内自检一次报出 171 处假红。
//   现判据改为「候选目录必须真的**是论衡仓库/包根**」——即含 `skills/lunheng-article-pipeline/SKILL.md`
//   （技能即包根布局亦满足：`<skillRoot>/skills/…` 不存在 → 由第二个候选 `ROOT` 兜底）。
//   两个候选都不命中 → **报 P0 并 exit 10**（不静默退到一个错误的根）。
const looksLikeLunhengRoot = (p) =>
  existsSync(join(p, 'package.json')) && existsSync(join(p, 'skills', 'lunheng-article-pipeline', 'SKILL.md'));
const REPO_ROOT = [ROOT, join(ROOT, '..', '..')].find(looksLikeLunhengRoot) ?? null;
if (!REPO_ROOT) {
  console.error(
    `[P0 布局探测失败] 未能从 ${ROOT} 定位论衡仓库根（两个候选都不含 package.json + skills/lunheng-article-pipeline/SKILL.md）。\n` +
    `  · 若在**部署镜像**（.dsh/skills/…）内运行：本门需要真源仓库才能做镜像↔真源对账，请到真源仓库跑。\n` +
    `  · 若在「技能即包根」布局：该目录须同时含 package.json 与 skills/lunheng-article-pipeline/。\n` +
    `  → 退出码 10（参数或路径错误）。**不要**把这次失败当成「文档漂移」。`,
  );
  process.exit(10);
}

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
// v18.47.0：repo 级 `docs/**` 的活跃文件清单（排除历史留痕）——⑰' 扩面用（见下方 ctx 注释）。
//   与 `files` 同源判据：`walk(REPO_ROOT/docs)` + `isArchive`；REPO_ROOT 缺失时给空数组（不影响既有行为）。
//   ⚠️ 另加**一类显式豁免**：`docs/审计与修订记录/**`（历史留痕）。
//     为什么必须显式写：① 本仓 `isArchive` 只覆盖技能内的 `references/_shared/archive`，**不覆盖**这个目录
//     ——若不写，历史记录会被内容规则扫（今天恰好 0 命中，属**运气**而非设计）；② 规则 ⑬ 对 `docs/`
//     已有先例——「历史章节（版本历史 / 演进 / 里程碑等）整体跳过」；③ 历史记录里**引述**当年的裸百分比
//     是正当文本（「引述被纠正内容」族的已知误报形态）。**判据：历史留痕按既有先例豁免，不靠「今天没命中」。**
const isHistoricalDocs = (f) => f.replaceAll('\\', '/').includes('docs/审计与修订记录');
const docsActive = (() => {
  if (!REPO_ROOT || !existsSync(join(REPO_ROOT, 'docs'))) return [];
  return walk(join(REPO_ROOT, 'docs')).filter((f) => f.endsWith('.md') && !isArchive(f) && !isHistoricalDocs(f));
})();

// M 门口径派生真源（v2.5.2-dsh.16）：规则 ⑥b 的数字全部从 m-gate-check.mjs 的 gate 标签算出，规则自身不会过期
//   v18.3.1（审计 B2 阶段 1）：M-Exist 门族 + M-Integrity-1 已抽离到 `_lib/mgate-gates/`——
//   派生源改为「主脚本 + 门模块」拼接（缺目录的 P0 在文末规则区报，此处仅记标志）。
//   v18.78.2（全量审计-v18.78.1 A4）：拼接与派生**抽到 `_lib/mgate-gates/gate-count.mjs`**，
//     因为审计视图 `build-evidence-bundle.mjs` 也在报「M 门 N 项」却**手写 16**（真源 25）——
//     同一数字两处实现必然漂移，故这里改为与视图共用一个派生（口径逐字未变）。
const { src: gateSrc, modMissing: gateModMissing } = loadGateSource(join(ROOT, 'scripts'));
const GATE_DERIVED = deriveGateCounts(gateSrc);
// ⑥b 的口径检查（skills/** 与 docs/** 共用；由调用方传 rel 以便定位）
function checkGateCounts(text, rel) {
  const { form, exist, integ, fact, mech, total } = GATE_DERIVED;
  const check = (re, idx, expected, label) => {
    const m = text.match(re);
    if (m && Number(m[idx]) !== expected) {
      errors.push(`[P1 口径残留 M 门${label}] ${rel} 写 ${m[idx]}，脚本派生值应为 ${expected}（M-Form ${form} + M-Exist ${exist} + M-Integrity ${integ} + M-Fact ${fact}）`);
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
  check(parenCount('M-Fact'), 1, fact, ' M-Fact 括注项数');                   // v18.25.0 QLT-2：新族（无人工门，故不 +1）
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
  // v18.61.1（文档体检反哺）：语族清单补 **M-Fact**。旧清单只有三族，于是行内出现「… / M-Fact 1 项」时，
  //   ⑤ 的分项归属会把它**就近归给前一个 FAMILY 关键词 M-Integrity** → 报「M-Integrity 写 1 项」假阳性
  //   （实测 `deliverables.md` 四族并列写法即此形）。派生值 `fact` 早在 v18.25.0 就已入 GATE_DERIVED，
  //   漏的只是这份归属表——与「M-Fact-1 落地时无人补登」是同一类漂移。
  const FAMILY = [['M-Form', form], ['M-Exist', exist], ['M-Integrity', integ + 1], ['M-Fact', fact]];
  // 「显式引用旧值」的豁免标记。
  //   v18.62.4（全量审计-v18.62.3 §8.2 #25）：**旧的五项措辞太窄**——实测「v18.3.1 **前口径**：M 门机械项 20 项」
  //   这样的**正当历史注解**被判 `[P1 M 门项数不自洽]`（因为 `前口径` 不在表里，而 `旧口径` 在）→
  //   一条纯说明性的历史注记会**堵住本仓自己的门**，而修改它的唯一办法是把措辞改成表内的那几种
  //   ——那是**让文档迁就门**，正是本仓反复批判的方向。
  //   判据：**凡显式声明「这是旧值/前值」的措辞都应豁免**，且豁免应覆盖常见的近义写法。
  //   边界：仍**不做**「凡含『项』就放过」这类宽豁免——那会让本规则失去意义（见下方 (a)-(c) 的正面判定）。
  const HIST_QUOTE = /旧版|旧文|旧值|旧口径|旧数|前口径|前值|先前|此前|原来|曾是|曾经|历史|废止|作废|已废弃|不再适用|沿革/;
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
    if (!/M\s*门|M-Form|M-Exist|M-Integrity|M-Fact|(?:有|由|经)\s*脚本|m-gate-check/.test(l)) return;
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
      if (/G0[-–]G14|G 清单/.test(pre.slice(-30))) continue;                 // ① G 清单项数
      //   v18.34.0：区间连接符补 **en dash**。本仓两种写法都在用（`pipeline-readme.md:300` 写 `G0–G14`），
      //   而旧式只认 ASCII 连字符 → 该写法一旦后面跟「N 项」就会被**误归给 M 门**（误报形态与
      //   反例清单 #3 同源，只是拼写不同）。**本次不靠它让自己变绿**：同批的 ㉙ 文案已先改成 ASCII 写法，
      //   这一处修的是 latent（en dash 形态此前恰好没跟过「N 项」）。
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
//   ③ 默认 dry-run：只打印将改动的位置与条数；`--fix --write` 才落盘，
//      落盘走 `_lib/destructive-write.mjs` 的 `writeWithSafety`（**时间戳 `.bak` + 原子写 + BAK_MAX 回收**）
//      ——v18.12.0（L-66）前的固定名 `.bak-fix` 会在连跑两次时抹掉上一次的回滚点。
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
      // v18.12.0（全量审计 L-66）：旧实现 `copyFileSync(f, f + '.bak-fix') + writeFileSync(f, …)` 有三缺陷：
      //   ① **固定名 `.bak-fix`** —— 连跑两次时，第一次的原始版本被第二次备份**同名覆盖**，回滚点丢失
      //      （`_lib/destructive-write.mjs` 头注释明文批判过这一形态）；
      //   ② **非原子写** —— 进程中途被杀会留下半写文件；
      //   ③ 无 `.bak` 上限回收。
      //   现统一走 `writeWithSafety(…, { inPlace: true })`：时间戳 `.bak`（同秒加序号，一轮内多次写不丢回滚点）
      //   + temp→rename 原子写 + BAK_MAX 回收。
      const r = writeWithSafety(f, text.replaceAll('（检查）', '（按主控 phase 0 协议）'), { inPlace: true });
      console.log(`  ✓ 已修复 ${rel}（${hits} 处；回滚点 ${r.backup ? relative(ROOT, r.backup).replaceAll('\\', '/') : '（原文件新建，无备份可做）'}）`);
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
// 仓库级文档版本头（v18.85.0 · CONTRIBUTING §26 扩面）：
//   旧实现硬编码 3 处（README.md / docs/introduction.md / skills/README.md），导致 SECURITY.md /
//   docs/troubleshooting.md / 5 语 README 等 v18.2.4+ 一直未进硬检——v18.2.5 C-3 抓到
//   SECURITY.md + troubleshooting.md 双双停 v18.2.4 → 一致性门报「0 漂移」= 假绿。
//   **扩面原则（v18.85.0）**：
//     ① **hard targets** = CONTRIBUTING §2 列出的 8 个「必同步」文件（4 语 README+SECURITY+docs/
//        introduction+docs/troubleshooting+skills/README+examples/preset/README）——必须严格匹配 pkgVer；
//     ② **soft targets** = 仓库根其他 .md + docs/ 其他 .md（**不**含 `docs/审计与修订记录/` 历史留痕）——
//        若含 `v\d+\.\d+` 字面量才检「与 pkgVer 不一致」则报 P1；不含则 pass（不强制加版本头，因为
//        AGENTS.md / IDEA.md / docs/agents/* / docs/architecture.md / docs/faq.md 等文件**本无**版本头约定，
//        一刀切硬检会误伤 + 制造大量 P0 阻塞 release 链）。
//   排除面：CHANGELOG.md（append-only）/ `docs/审计与修订记录/` / `node_modules/` / `.git/` / `audits/`。
const isRepoLayout = ROOT !== REPO_ROOT;
const HARD_VERSION_FILES = isRepoLayout
  ? [
      // 必同步：CONTRIBUTING §2 列出的 8 个（按文件路径相对 REPO_ROOT 排列）
      ['README.md', join(REPO_ROOT, 'README.md')],
      ['README-zh.md', join(REPO_ROOT, 'README-zh.md')],
      ['README-es.md', join(REPO_ROOT, 'README-es.md')],
      ['README-pt.md', join(REPO_ROOT, 'README-pt.md')],
      ['README-hi.md', join(REPO_ROOT, 'README-hi.md')],
      ['SECURITY.md', join(REPO_ROOT, 'SECURITY.md')],
      ['docs/introduction.md', join(REPO_ROOT, 'docs', 'introduction.md')],
      ['docs/troubleshooting.md', join(REPO_ROOT, 'docs', 'troubleshooting.md')],
      ['skills/lunheng-article-pipeline/README.md', join(ROOT, 'README.md')],
      ['examples/preset/README.md', join(REPO_ROOT, 'examples', 'preset', 'README.md')],
    ]
  : [['README.md', join(ROOT, 'README.md')]];
// hard: 必须有版本头且与 pkgVer 一致；缺文件 / 缺版本头 / 不一致 → 报 P0
const VER_HEADER = new RegExp('^>\\s*\\*{0,2}?\\s*版本\\s*[：:]\\s*v?' + SEMVER, 'm');
for (const [rel, p] of HARD_VERSION_FILES) {
  if (!existsSync(p)) { errors.push(`[P0 版本一致性] 缺文件 ${rel}（必同步文件）`); continue; }
  const t = readFileSync(p, 'utf8');
  // 优先匹配 `> 版本：vX.Y.Z` 头；无头则取全文第一个 semver 字面
  const m = t.match(VER_HEADER) || t.match(new RegExp('v?' + SEMVER));
  if (!m) errors.push(`[P0 版本一致性] ${rel} 无版本号（期望「> 版本：vX.Y.Z」）`);
  else if (normVer(m[0].match(/\d.*/)[0]) !== normVer(pkgVer)) errors.push(`[P0 版本一致性] ${rel} 写 ${m[0]} ≠ package.json=${pkgVer}（需 bump）`);
}
// soft: 仓库根其他 .md + docs/ 其他 .md（排除已 hard 的）—— 若含 v\d+\.\d+ 字面量，不一致则报 P1
const repoTopLevelMd = () => {
  if (!existsSync(REPO_ROOT)) return [];
  const out = [];
  for (const e of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    if (e.name === 'CHANGELOG.md') continue;
    if (HARD_VERSION_FILES.some(([rel]) => rel === e.name)) continue;   // 已 hard 检过
    out.push([e.name, join(REPO_ROOT, e.name)]);
  }
  return out;
};
const repoDocsMd = () => {
  if (!existsSync(join(REPO_ROOT, 'docs'))) return [];
  return walk(join(REPO_ROOT, 'docs'))
    .filter((f) => !isHistoricalDocs(f))
    .map((f) => [relative(REPO_ROOT, f).split(sep).join('/'), f])
    .filter(([rel]) => !HARD_VERSION_FILES.some(([h]) => h === rel));  // 已 hard 检过
};
const softTargets = isRepoLayout ? [...repoTopLevelMd(), ...repoDocsMd()] : repoTopLevelMd();
const softNotes = [];   // soft 不推 errors，结尾打印（**负向用例**保留：注入旧版本字面量必出现在该段里）
// v18.85.0 soft 重定义：**soft 不再扫全文**，**只扫「文件首部 5 行内的 `v?\d+\.\d+(\.\d+)?` 字面量」**：
//   本批扩面暴露的 7 处实测**全部是历史叙事/旧规约/宿主版本/旧实测**（CONTRIBUTING.md §1 / docs/faq.md
//   "v18.0.0 起" 叙述 / docs/installation.md "实测装到 18.15.0" / docs/token-optimization-plan.md `v2.5.2-dsh.15`
//   规约版本线 / docs/usage.md "v18.2.6 起" / 2 个验证记录 `@deepseek-ai/dsh@0.1.5-rc.2` 宿主包）——
//   改 = 改写历史。**只有「文件首部版本头与 pkgVer 不一致」才是 sync 债**（此即 hard 已覆盖 10 个文件的子集，
//   soft 仅为「本批扩面副作用的负向用例保留」）。
//
//   判据：
//     · 软目标只读每文件**前 5 行**；
//     · 命中形态豁免（`@scope/pkg@version` / `v\d+\.\d+\.\d+-dsh\.\d+`）→ 放行；
//     · 命中叙述豁免（前文 50 字符内出现「v\d+\.\d+ 起|后|以来|开始|实」/ `实测|装到|装入`）→ 放行；
//     · 命中本包版本线（`v?\d+\.\d+\.\d+` 无后缀）且与 pkgVer 不一致 → 入 softNotes（**负向用例**仍生效）。
const SOFT_EXEMPT_PATTERNS = [
  /@[\w./-]+@\d+\.\d+(\.\d+)?(-[0-9A-Za-z][0-9A-Za-z.]*)?/,      // 宿主包版本
  /v\d+\.\d+\.\d+-dsh\.\d+/,                                    // 旧规约版本线
];
const SOFT_NARRATIVE_CTX = /(?:v\d+\.\d+(\.\d+)?\s*(?:起|后|以来|开始)|实测[^。\n]{0,8}?\d+\.\d+|装到[^。\n]{0,8}?\d+\.\d+)/;
for (const [rel, p] of softTargets) {
  if (!existsSync(p)) continue;
  const t = readFileSync(p, 'utf8');
  // 仅扫前 5 行（文件首部）—— 替代全文扫描以消解历史叙事带来的噪音
  const head = t.split('\n').slice(0, 5).join('\n');
  if (SOFT_EXEMPT_PATTERNS.some((re) => re.test(head))) continue;
  if (SOFT_NARRATIVE_CTX.test(head)) continue;
  const m = head.match(/(^|[^0-9a-zA-Z])v?(\d{1,3}\.\d{1,3}\.\d{1,3})([^0-9a-zA-Z-]|$)/);
  if (m && normVer(m[2]) !== normVer(pkgVer)) {
    softNotes.push(`[P1 soft · 不阻塞] ${rel}（首部）含 ${m[2]} ≠ package.json=${pkgVer}（soft 检：仅扫文件首部 5 行；首部本包版本与 pkgVer 不一致时触发；旧规约/宿主包/叙述起始时点 等非本包线已豁免；负向用例保留：注入旧版本字面量到首部会出现在本段）`);
  }
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
      ...['README.md', 'README-zh.md', 'README-es.md', 'README-pt.md', 'README-hi.md'].map((f) => [f, join(REPO_ROOT, f)]),
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

  // ② 版本/报告名一致性（双头版本行 / M-Gate-Report 文件名与形状）——**规则级标签，勿删**
  //   子规则：②a 双头版本行 / ②b 文件名与标识漂移 / ②c 形状白名单（见下方各段）
  // ②a 双头版本行（同一文件出现 ≥2 个版本头）
  const verCount = text.split('\n').filter((l) => VER_HEADER_RE.test(l)).length;
  if (verCount > 1) errors.push(`[P0-1d 双头版本行 x${verCount}] ${rel}`);

  // ②b M-Gate-Report 文件名/标识漂移（v2.5.2-dsh.3 审计：门 V 已明令无版本后缀，含 JSON "schema" 字段值）
  if (!isArchive(f) && /M-Gate-Report-v2\.2\.(4|12)(\.json|")/.test(text)) {
    errors.push(`[P1 M-Gate-Report 文件名/标识漂移（应为 M-Gate-Report.json）] ${rel}`);
  }

  // ②c M-Gate-Report 文件的**形状规则**（v18.12.3 落地审计 L-09）——
  //   为什么 ②b 不够：它只拦 `-v2.2.4` / `-v2.2.12` **两个字面量**，而实测真实项目 final/ 下的变体是
  //   `-final.json` / `-rev.json` / `-verify.json` / `-full.json` / `-v18.2.2b.json`（**任一都绕过 ②b**），
  //   后果是交付目录里并存 `exit=0` 与 `exit=1` 两份 M 门报告、事后审计看到互相矛盾的结论。
  //   本规则改为**形状白名单**：文件名只允许 {`M-Gate-Report.json`, `M-Gate-Report-v<数字>.json`}。
  //   · 版本化形态（`-v<数字>`）**不得挂在 `final/` 下**——`final/` 是全项目**唯一**的送达口径
  //     （`m-gate-check.mjs --report` 的默认值与 `build-evidence-bundle.mjs` 的读取路径都写死这一份），
  //     历史轮次报告的正确位置是 `audits/`。
  //     ⚠️ 判据 = **被引用路径的前缀**，不是「写这句话的文件在哪」——首版按后者写，结果把
  //     `references/**` 里合法写「见 `audits/M-Gate-Report-v3.json`」的文档判成 P1（假阳性）。
  //     裸文件名（无目录前缀）**不判**：文档里无法确定其位置，臆断即假阳性。
  //   · 中间态命名（`-rev` / `-verify` / `-final` / `-full` / 带字母的 `-v18.2.2b`）**任何前缀都 P1**。
  //   反引号/引号/`*` 通配（`M-Gate-Report*.json`）与裸标识（`M-Gate-Report` 后不跟文件后缀）不算文件名。
  if (!isArchive(f)) {
    const reShape = /M-Gate-Report(?:-[\w.]+)?\.json/g;
    for (const m of text.matchAll(reShape)) {
      const name = m[0];
      if (name === 'M-Gate-Report.json') continue;                       // 唯一口径，放行
      // 取同行内、紧邻其前的目录前缀（`final/` / `audits/` / `…/final/` …）
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const pre = text.slice(lineStart, m.index);
      const dir = (/([A-Za-z0-9_.\-]+[\\/])+$/.exec(pre) || [])[0] || '';
      if (/^M-Gate-Report-v\d+\.json$/.test(name)) {                     // 合法版本形态
        if (/(^|[\\/])final[\\/]$/.test(dir)) {
          errors.push(`[P1 M-Gate-Report 版本化副本挂在 final/ 下（final/ 唯一口径 = M-Gate-Report.json；历史轮次请放 audits/）] ${rel}: ${name}`);
        }
        continue;
      }
      errors.push(`[P1 M-Gate-Report 文件名形状非法（只允许 M-Gate-Report.json，或 audits/ 下的 M-Gate-Report-v<数字>.json；中间态请移入 final/.work/）] ${rel}: ${name}`);
    }
  }

  // ③ 悬空引用（版本一致性检查旧名 / scripts/*.mjs 悬空 / 角色卡索引缺失）——**规则级标签，勿删**
  //   子规则：③a 旧机制名残留 / ③b scripts 悬空 / ③c 角色卡索引缺失 / ③d 见下方各段
  // ③a 悬空引用：旧名「版本一致性检查-v2.3.0.md」残留（独立性重构后该旧机制已删除，发现即清理）
  if (text.includes('版本一致性检查-v2.3.0.md')) {
    errors.push(`[P0-1a 悬空引用「版本一致性检查-v2.3.0.md」] ${rel}`);
  }

  // ③b 裸「（检查）」占位符残留（净化剥离未标记；SKILL.md/glossary.md 为元文档说明，豁免）
  if (text.includes('（检查）') && !rel.endsWith('SKILL.md') && !rel.endsWith('glossary.md')) {
    errors.push(`[P2 裸「（检查）」占位符] ${rel}`);
  }

  // ③c scripts/ 引用完整性：文档引用的脚本文件必须存在
  //   v18.45.0 修**作用域缺陷**（本批新增一份仓库级脚本时实测撞到）：`scripts/` 前缀在文档里同时指两类脚本——
  //     ① **随包脚本**（`<技能根>/scripts/`，如 `m-gate-check.mjs`）；
  //     ② **仓库级脚本**（`<仓库根>/scripts/`，**不随包**，如 `no-write-check.mjs` / `closeout-verify.mjs`）。
  //   旧实现只查 ①，于是「引用一个**确实存在**的仓库级脚本」被判「悬空」（本批 AGENTS.md 与 maintainers.md
  //   各报 1 处假 P1）。这与本仓「门在看错对象」同族：**它断言的是「引用的脚本不存在」，却只在半个盘上找**。
  //   ⚠️ **判据没有被放宽**：仍然报的只有**两个根都找不到**的真悬空（反向自证见
  //   `audits/机制文件修订记录-2026-09-27-发布前固定动作no-write-check.md`）。
  //   关联约定：随包文档引用仓库级脚本时**必须写明「不随包」**——否则装包用户按图索骥会扑空。
  const scriptRefs = [...text.matchAll(/scripts\/([a-z0-9\-]+\.mjs)/g)].map((mm) => mm[1]);
  for (const s of new Set(scriptRefs)) {
    const inPack = existsSync(join(ROOT, 'scripts', s));
    const inRepo = REPO_ROOT !== null && REPO_ROOT !== ROOT && existsSync(join(REPO_ROOT, 'scripts', s));
    if (!inPack && !inRepo) {
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
    //     ⚠️ v18.62.7（反哺-主控实测 §A19/§A23）：**`read_page` 从名单移除**——它**已不是幻影工具**：
    //       本机实测由 `@liustack/modsearch` 提供（会话工具面里在，报告 §9.1 的插件清单亦列明），
    //       与本批新登记的 `x_search` 同源。原名单立时（OpenClaw 时代）它确实不存在，**那是当时的判断**。
    //       为什么移除而不是继续豁免：本批给三卡与接入面加了「**工具面存在性优先**」的前置判据（§0）——
    //       **「这个工具在不在」由 Phase 0 探测回答**，不再由一张写死的黑名单回答。保留它反而会
    //       让「插件的工具被当成幻影」这一新型错位无人可查（本次实测的病灶正是「卡里点名的工具没装」）。
    {
      const BANNED = ['read_url', 'fetch_page', 'gm_search', 'gm_record', 'session-kill'];
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
  // v18.47.0：**repo 级 `docs/**`（排除历史留痕）**——供 ⑰'（口径三要素）扩面用。
  //   为什么只有 ⑰' 用它：`docs/` 是**随包发布**的面向用户文档（`docs/introduction.md` 由 bump-version 维护），
  //   而 ⑰' 防的正是「听起来像实测的百分比」——这两者撞在一起（实测：`docs/token-optimization-plan.md`
  //   有 4 处裸百分比）。**其余内容规则刻意不跟着扩**：它们是「脚本计数 / 阶段数 / 版本点位」等，
  //   对 `docs/` 的命中面**未标定**，凭一条规则的理由扩整族的扫描面 = 让别的规则去咬没量过的盘。
  docsActive,
};
runScriptRules(ctx);
runDocsVersionRules(ctx);
runContentRules(ctx);
runMgateDocRules(ctx);
runRepoSurfaceRules(ctx);

// ── ㉔ Phase 序列自洽（v18.12.3 落地审计 L-07）────────────────────────────────────────────────
// 真源分工：`SKILL.md §⚡ 启动速查表` 的 `- Phase：` 行 = 主控排 `todo_write` 的**唯一 Phase 真源**；
//   `references/pipeline-readme.md` 的**流水线全景**代码块 = 各 Phase 的**详述真源**（触发条件、产物、角色）。
// 为什么必须机械对账：L-07 实测 `Phase 1.5`（会真 spawn T1 的阶段）与 `Phase 4.2`（整轮修订回环）
//   只写在详述真源里、不在速查序列里 → 主控的计划里没有修订回环，真实项目被迫临时造
//   「Phase 4 修订」这种命名（`筛选竞赛/status.md:21`）。这是「同一事实两处维护」的必然漂移。
// 比对口径：只取**流水线全景代码块**内的 `Phase <编号>`（排除 `Gate T2.5` / `闸门 T7.5` 这类闸门行，
//   它们按设计不进 Phase 序列）；速查序列侧的编号直接从 `- Phase：` 行抽 `数字(点数字)?`。
(() => {
  const skillPath = join(ROOT, 'SKILL.md');
  const readmePath = join(ROOT, 'references', 'pipeline-readme.md');
  // v18.78.2（全量审计 A6）：旧实现 `if (!existsSync(...)) return` —— **静默返回**，真源缺失时 ㉔ 整条失效
  //   而退出码无任何信号（审计把 ㉔/㉕ 并列为「规则失效即静默放行」的同族）。现改 `[P0 规则失效]`。
  //   边界变更（如实声明）：旧注释的理由是「夹具仓可能只放其一 → 不臆断」。实测 `mkRepo()` 的**非 full**
  //   分支整目录复制 `skills/`，两文件都在；若将来出现只放其一的夹具，正确做法是**补齐夹具**，
  //   而不是把门恢复成静默——两文件在真源仓里是常驻体，缺任一都意味着部署被裁坏。
  if (!requireTruthSource([skillPath, readmePath], '㉔ Phase 序列自洽', errors, 'SKILL.md + references/pipeline-readme.md')) return;
  const skillText = readFileSync(skillPath, 'utf8');
  const seqLine = skillText.split('\n').find((l) => /^-\s*Phase：/.test(l.trim()));
  if (!seqLine) {
    errors.push('[P1 Phase 序列真源缺失] SKILL.md §⚡ 启动速查表里找不到 `- Phase：` 行（规则 ㉔ 无从对账）');
    return;
  }
  const seq = new Set([...seqLine.matchAll(/(\d+(?:\.\d+)?)\s*[^\d.]/g)].map((m) => m[1]));
  const readmeText = readFileSync(readmePath, 'utf8');
  const at = readmeText.indexOf('## 流水线全景');
  // ⚠️ 起点要**跳过紧跟标题的 `<a id="…">` 锚点行**（本文件在标题与围栏之间插了它），
  //    否则正则的第一个字符就失配 → 报「代码块缺失」的假 P1（首版即踩此坑）。
  const block = /```[a-z]*\r?\n([\s\S]*?)```/.exec(readmeText.slice(at + '## 流水线全景'.length));
  if (block === null) {
    errors.push('[P1 流水线全景代码块缺失] references/pipeline-readme.md §流水线全景 未找到围栏块（规则 ㉔ 无从对账）');
    return;
  }
  const seen = new Set();
  for (const line of block[1].split('\n')) {
    const m = /^Phase\s+(\d+(?:\.\d+)?)\s+\S/.exec(line.trim());
    if (m) seen.add(m[1]);
  }
  const orphan = [...seen].filter((n) => !seq.has(n)).sort((a, b) => a - b);
  if (orphan.length) {
    errors.push(
      `[P1 Phase 序列自洽] references/pipeline-readme.md 流水线全景里的 Phase ${orphan.join(' / ')} ` +
      `不在 SKILL.md §⚡ 启动速查表的 \`- Phase：\` 序列内（该序列是主控排 todo_write 的唯一真源；` +
      `新阶段只写详述真源 = 主控计划里没有这一步——审计 L-07 的成因）`,
    );
  }
})();

if (errors.length) {
  // v18.62.4（全量审计-v18.62.3 §8.1 #12）：**严重度必须进退出码**。
  //   病灶：旧版全库错误一律 `exit 1` —— 于是 `[P0 版本一致性]`（版本红线：frontmatter/版本头/
  //   必带文件与 package.json 不符）与 `[P2 …]` 卫生项**在同一码里**。而本仓别处（M 门 / 战略门）
  //   的语义是 `2 = P0 / 1 = P1 / 3 = 仅 P2·软提示`，人读与上层脚本都会**按那套语义解释本门的 1**
  //   → 版本红线被读成「一般 P1」。
  //   修法：按**已有标签**分档，并与全仓退出码语义对齐：有 `[P0 …]` → **2**；否则有 `[P1 …]` → **1**；
  //   否则（仅 `[P2 …]` 等）→ **3**。CI 只判非 0，故本改动不改变 CI 行为，只恢复码的语义。
  const p0 = errors.filter((e) => /\[P0[ \-\]]/.test(e)).length;
  const p1 = errors.filter((e) => /\[P1[ \-\]]/.test(e)).length;
  console.error(`一致性自检未通过，共 ${errors.length} 处（P0 ${p0} / P1 ${p1} / 其余 ${errors.length - p0 - p1}）：`);
  for (const e of errors) console.error('  - ' + e);
  const code = p0 > 0 ? 2 : (p1 > 0 ? 1 : 3);
  if (code === 2) console.error('→ 退出码 2（**含 P0：版本红线**，与 M 门 / 战略门同义——优先于 P1 处理）');
  else if (code === 3) console.error('→ 退出码 3（**仅 P2 / 软提示**：需复核，但不属版本红线或 P1）');
  if (softNotes.length) {
    console.error(`\nsoft 检（**v18.85.0 扩面副作用**——可见不阻塞，负向用例保留）：${softNotes.length} 处`);
    for (const s of softNotes) console.error('  - ' + s);
  }
  process.exit(code);
}
if (softNotes.length) {
  console.log(`一致性自检通过：${files.length} 个 .md 文件 + cordis.patch.yml/examples/.dsh 同步，0 处漂移。`);
  console.log(`\nsoft 检（**v18.85.0 扩面副作用**——可见不阻塞，负向用例保留）：${softNotes.length} 处`);
  for (const s of softNotes) console.log('  - ' + s);
} else {
  console.log(`一致性自检通过：${files.length} 个 .md 文件 + cordis.patch.yml/examples/.dsh 同步，0 处漂移。`);
}
