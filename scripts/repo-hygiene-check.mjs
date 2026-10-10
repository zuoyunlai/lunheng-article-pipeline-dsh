#!/usr/bin/env node
/**
 * repo-hygiene-check.mjs —— 仓库机械卫生门（CI 专用，零依赖，不随包分发）
 *
 * 批5-3 重构：每条规则抽到 `scripts/_lib/hygiene/rNN-*.mjs`，导出 `run(ctx)`；
 *   共享工具在 `_shared.mjs`；本文件只剩 ctx 构造 + 顺序调用 + 末尾汇总。
 *   规则清单与指针（**ADR-0003 源码钉：以下标题原文必须留在本文件**——tests/adr-anchors.test.mjs:105 钉）：
 *     ① syntax → r01-syntax.mjs
 *     ② json   → r02-json.mjs
 *     ③ yaml   → r03-yaml.mjs
 *     ④ eol    → r04-eol.mjs
 *     ⑤ utf8   → r05-utf8.mjs
 *     ⑥+⑥b    → r06-pack.mjs（含发布面与扫描集覆盖两段）
 *     ⑦       → r07-credentials.mjs
 *     ⑦b      → r07b-local-path.mjs
 *     ⑧       → r08-exit-codes.mjs
 *     ⑧b 退出码命名空间 → r08b-namespace.mjs
 *     ⑧c      → r08c-surface.mjs
 *     ⑧d 脚本自述退出码 → r08d-headers.mjs
 *     ⑨       → r09-doc-budget.mjs
 *     ⑩       → r10-ann-density.mjs
 *     ⑪       → r11-lib-line-refs.mjs
 *     ⑫       → r12-e-family.mjs
 *     ⑬       → r13-changelog.mjs
 *     ⑭       → r14-cli-pin.mjs
 *     ⑮       → r15-host-contract.mjs
 *
 * 为什么存在（v2.5.2-dsh.13 新增，回应第三方审计「CI 覆盖度」）：
 *   `consistency-check.mjs` 管文档漂移、`plugin-surface-check.mjs` 管打包面契约，
 *   但**语法/编码/行尾/发布内容**这些「零成本就能机械判定」的东西此前无人守：
 *   - 随包脚本多数从未被 CI 执行过（含承重的 m-gate-check）；**数量不在此处写死**（v18.2.6 更正：旧注释写
 *     「共 11 个」而脚本自己已改成从 SKILL.md 白名单派生、实测 12 个——注释与代码必须同源，否则下一个人
 *     会照着注释去核对错数字）；
 *   - `examples/preset/preset.yml` 从未被任何解析器校验；
 *   - 35 个文件工作区 CRLF、`.gitignore` 是 GBK——而 npm 打包读工作区。
 *
 *   ⚠️ 本清单**必须与实现同步**：v18.18.13 补 ⑩–⑬ 与 ⑦b/⑧b–d 时，本清单此前只列到 ⑨，
 *   即「门自己的头落后于门的实现」——与它守的「清单落后于代码」是同一病，故一并补齐。
 *
 * 退出码：0 = 全通过；1 = 有失败（fail-closed，CI 红灯）
 * 失败同时输出 GitHub annotation（::error::），无需下载日志即可定位。
 */
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isText } from './_lib/hygiene/_shared.mjs'

import * as r01 from './_lib/hygiene/r01-syntax.mjs'
import * as r02 from './_lib/hygiene/r02-json.mjs'
import * as r03 from './_lib/hygiene/r03-yaml.mjs'
import * as r04 from './_lib/hygiene/r04-eol.mjs'
import * as r05 from './_lib/hygiene/r05-utf8.mjs'
import * as r06 from './_lib/hygiene/r06-pack.mjs'
import * as r07 from './_lib/hygiene/r07-credentials.mjs'
import * as r07b from './_lib/hygiene/r07b-local-path.mjs'
import * as r08 from './_lib/hygiene/r08-exit-codes.mjs'
import * as r08b from './_lib/hygiene/r08b-namespace.mjs'
import * as r08c from './_lib/hygiene/r08c-surface.mjs'
import * as r08d from './_lib/hygiene/r08d-headers.mjs'
import * as r09 from './_lib/hygiene/r09-doc-budget.mjs'
import * as r10 from './_lib/hygiene/r10-ann-density.mjs'
import * as r11 from './_lib/hygiene/r11-lib-line-refs.mjs'
import * as r12 from './_lib/hygiene/r12-e-family.mjs'
import * as r13 from './_lib/hygiene/r13-changelog.mjs'
import * as r14 from './_lib/hygiene/r14-cli-pin.mjs'
import * as r15 from './_lib/hygiene/r15-host-contract.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const isCI = Boolean(process.env.GITHUB_ACTIONS)
const annotate = (level, msg) => { if (isCI) console.log(`::${level}::${String(msg).replace(/\r?\n/g, ' ').slice(0, 900)}`) }

const fails = []
const notes = []
const fail = (id, msg) => { fails.push(`[${id}] ${msg}`); annotate('error', `[${id}] ${msg}`) }
const note = (msg) => { notes.push(msg) }

const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const lsOut = git(['ls-files', '-z'])
if (lsOut.status !== 0) { console.error('git ls-files 失败：' + (lsOut.stderr || '')); process.exit(1) }
const tracked = lsOut.stdout.split('\0').filter(Boolean)

const lsUntracked = git(['ls-files', '-z', '--others', '--exclude-standard'])
const untracked = lsUntracked.status === 0 ? lsUntracked.stdout.split('\0').filter(Boolean) : []
const scanSet = [...new Set([...tracked, ...untracked])]

const SELF = 'scripts/repo-hygiene-check.mjs'

const scriptDir = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')
// v18.78.2（B6）：仓库根脚本目录 —— ⑧ 的第二个契约面（见 ROOT_EXIT_CONTRACT 的说明）。
//   注意 `readdirSync` 非递归：`scripts/_lib/**` 是**共享库**而非可执行门，本表按「可执行脚本」口径只收
//   根目录下的 `.mjs`（如实边界：`_lib/**` 里的库文件若自己 `process.exit`，本面看不见——由各调用方契约覆盖）。
const rootScriptDir = join(ROOT, 'scripts')

// ───── ⑧ 的契约表（机器面；与 troubleshooting.md §8 双向对账：⑧b 守）───
const EXIT_CONTRACT = {
  'm-gate-check.mjs': [0, 1, 2, 3, 10, 30, 70],   // v18.12.0（L-05）：30 = `--adjudicate` 裁定被拒（红线命中 / 四件套不全 / 缺 true_p0-p1）
  'final-check.mjs': [0, 1, 2, 3, 10, 70],
  'build-evidence-bundle.mjs': [0, 10, 70],
  'count-chars.mjs': [0, 10, 70],
  'normalize-trust-level.mjs': [0, 1, 10, 70],
  'model-routing.mjs': [0, 4, 10, 70],   // v18.12.0（L-67 同族收口）：删 1——用法/配置错改 10；4 保留为「需人工决定」自有码
  // v18.62.4（全量审计-v18.62.3 §8.1 #12）：加 **2 / 3** —— 本门旧版全库错误一律 exit 1，
  //   于是 `[P0 版本一致性]`（版本红线）与 `[P2 …]` 卫生项同码，而全仓语义是 2=P0 / 1=P1 / 3=仅 P2·软提示。
  //   现按已有标签分档（见 consistency-check.mjs 末尾注释）；CI 只判非 0，故不影响 CI 行为。
  'consistency-check.mjs': [0, 1, 2, 3, 10, 70],
  'token-budget.mjs': [0, 10, 70],   // v18.2.9：删 2——旧版「2 = 项目路径不存在」与 M 门「2 = P0」撞义，已改 10
  // v18.12.0（L-67）：删 1——用法/未知参数/未给模式由 1 改 10。旧版把用法错记为 1，而 1 是 M 门的
  //   「P1 内容失败」→ 主控会把「参数写错」读成「正文有 P1 残留」并误触发 T5 修订轮。
  'token-cost.mjs': [0, 10, 70],   // v18.12.0（L-67）：同上，删 1（未知参数 / 数值非法 / 缓存缺失 / 未给模式一律 10）
  // v18.12.0（L-72c）：`--strict` 校验失败 / 结构不合格拒绝导出 由 **2 改 40**。旧值 2 与 M 门「2 = P0」
  //   撞义——一次全量审计的第三方复核会把「md2html --strict 因缺图退出」读成「定稿有 P0」，两者补救动作
  //   完全不同（补图件 vs 改正文）。40 是 handoff-check(20/21/22) / model-routing(4) / --adjudicate(30)
  //   这一族「给非 M 门语义独立码」里的下一个空位。
  'md2html.mjs': [0, 10, 40, 70],
  'pdfcheck.mjs': [0, 1, 10, 70],
  // v18.2.6 补登（第三方审计 §4.2「`apply-diff.mjs` 未登记进 EXIT_CONTRACT」）：v18.2.5 新增的脚本
  //   装了 exit-guard 却**无门核其退出码**——即「有守卫、无契约」，新增的越界码不会被任何门拦下。
  //   口径取自该脚本头注释：0 = 全部条目应用成功 / 1 = 有跳过或未解析条目、或清单解析出 0 条 / 10 = 参数或路径错。
  'apply-diff.mjs': [0, 1, 10, 70],
  // v18.6.0 补登（交接门规格 §5「登记义务」）：handoff-check 的退出码与 M 门 1/2/3 刻意分离——
  //   20 = 产物缺失或 0 字节 / 21 = 结构·版本·成对·回报段不合 / 22 = 仅软提示；10/70 走 exit-guard 通用语义。
  // v18.12.0（L-05）：`m-gate-check --adjudicate` 的**裁定被拒**同理刻意分离 —— 用 **30**（区别于内容判定
  //   1/2/3，也区别于参数错 10）；理由与本仓记载的「exit 10 被读成 P1」事故同源：**拒绝裁定 ≠ 内容失败**。
  'handoff-check.mjs': [0, 20, 21, 22, 10, 70],
  // ── v18.12.0（L-68）：补齐**全部 23 个随包脚本**（v18.22.2 增补 ref-get 后为 **24 个**，v18.23.0 增补
  //   g-audit-check 后为 **25 个**）────────────────────────────────────────────────────────
  // **规则⑧ 的覆盖面不依赖这张表的长度**：凡 import `_lib/exit-guard.mjs` 的脚本**必须**在本表登记
  //   （`EXIT_GUARDED_EXEMPT` 为空即该不变量成立），故新增脚本漏登记会被门直接拦下。
  // 旧表只登记 13 个，其余 10 个「装了 exit-guard、却没有契约」——只要它们自己新增一个表外退出码，
  // 任何门都不会吭声（本规则的锋芒正是「表外退出码」）。下面这 10 条全部来自「脚本内字面量 + guard 的
  // 10/70」实测解析；`EXIT_GUARDED_EXEMPT` 为空即证明「装了 guard 必登记」这条不变量成立。
  'apply-compression-cycle.mjs': [0, 1, 10, 70],   // 0 阻塞线内 / 1 仍超阻塞线需 T5 修订轮
  'apply-revision-cycle.mjs': [0, 1, 10, 70],      // 0 循环完成 / 1 diff 解析 0 条或 apply-diff 失败（含部分跳过）
  'cite-coverage-check.mjs': [0, 1, 3, 10, 70],    // M 门同源代码：1 = P1，3 = 仅 P2 软提示
  'fix-gates.mjs': [0, 1, 10, 70],                 // 0 无待修项 / 1 有生成的修订建议（**非闸门**）
  'journal-fit.mjs': [0, 1, 3, 10, 70],            // 1 = P1 命中 / 3 = 仅 P2（期刊不在库等）
  'lunheng-stats.mjs': [0, 10, 70],
  'meta-synthesize.mjs': [0, 3, 10, 70],           // 3 = 仅 P2 软提示（表内曾误登 1，静态解析无此字面量）
  'methodology-check.mjs': [0, 1, 2, 3, 10, 70],   // v18.16.0（A-7 反哺）：补 2 = P0（方法节参数 <2 项）；**v18.18.11 再补 3**——A-7 当时只补了 2，而该脚本的 `exitCode = allPass ? 0 : (hasP0 ? 2 : (hasP1 ? 1 : 3))` 明确可达 3（仅 P2 软提示），属「修一半」
  'segment-chars.mjs': [0, 10, 70],
  // v18.22.2（CTX-3）：ref-get 是**只读抽取器**（非闸门），与 segment-chars 同形——
  //   0 = 成功 / 10 = 参数或路径错（**含锚点未命中**：会打印可用锚点清单帮你改参数）/ 70 = 内部错误。
  //   刻意**不给新码**：锚点写错就是「参数错」，与 M 门 1/2/3（内容判定）语义无关，
  //   复用 10 比再开一个码更符合「只要脚本不做内容判定，它的错就都是 10」这条既有判据。
  'ref-get.mjs': [0, 10, 70],
  // v18.24.0（QLT-1）：quality-score 是**度量工具**（不是闸门）——0 = 评分完成（**分数高低不影响退出码**，
  //   理由见脚本头「为什么不做闸门」：挂成闸门会立刻产生「为过门而刷分」的压力）/ 10 = 参数或路径错
  //   （缺 定稿 / 未知参数 / `--report` 缺值 / 基线文件不是合法 JSON）/ 70 = 内部错误。
  //   与 `fix-gates.mjs`（同样是「非闸门」）同族——**没有 1**：它不做内容判定。
  'quality-score.mjs': [0, 10, 70],
  // v18.29.0（EFF-5）：sources-index 是**索引工具**（不是闸门）——0 = 成功 / **1 = `--check` 发现不合法行**
  //   （它**确实做内容判定**：校验 JSONL 行 schema 与 url 形态，故 1 是正当语义、不是撞码）/ 10 = 参数或路径错 / 70 = 内部错误。
  'sources-index.mjs': [0, 1, 10, 70],
  // v18.60.1（主人授权反哺 v2 §2.6 / §7.1 #8）：终检期「正文指纹刷新」助手。
  //   1 = 已刷新（有替换）——「跑了且改了东西」与「无需改」必须可区分，否则主控无法从码判断是否要复跑 M 门；
  //   0 = 无需刷新（各交付件指纹已是当前值，或未找到已知形态指纹）——**不是错误**。
  'refresh-gates.mjs': [0, 1, 10, 70],
  'structure-check.mjs': [0, 1, 2, 3, 10, 70],  // v18.18.11（A-7③ 一层内联后暴露）：本脚本与 methodology-check 同形（`allPass ? 0 : (hasP0 ? 2 : (hasP1 ? 1 : 3))`），旧表只登记 0/1/10/70，**2 与 3 都漏了**
  // v18.23.0（EFF-1）：g-audit-check 是 **G 项机检门**——与 structure-check / methodology-check /
  //   cite-coverage-check 三个战略门**同形同语义**：0 = 已检项全过 / 1 = 有 P1 / 2 = 有 P0 /
  //   3 = 仅 P2 **或任一项 SKIP**（**缺输入未检 ≠ 通过**，与 M 门 3 同语义：须人工复核，不得当通过）/
  //   10 = 参数或路径错（缺 --brief / --cards 路径不存在 / 目录当文件传）/ 70 = 内部错误。
  //   **刻意不给新码**：它的判定语义就在 M 门那一族（P0/P1/P2），另开码只会让主控多学一套映射。
  'g-audit-check.mjs': [0, 1, 2, 3, 10, 70],
  // v18.63.0（反哺报告-v5-竞品驱动 §v5.2-1）：self-check 是**随包完整性自检**（给装完包的人；**非闸门**）
  //   ——0 = 本包完整 / **1 = ≥1 项 FAIL（包不完整 / 口径不一致）** / **3 = 无 FAIL 但有 SKIP
  //   （适用却缺输入 → 须人工复核，与 g-audit-check 的「`N/A ≠ SKIP`」同口径）** / 10 = 参数错 / 70 = 内部错。
  //   复用 1 的先例 = `fix-gates.mjs`（同为「非闸门、人手动跑」）；它**不做任何内容判定**（不读正文、不判 P0/P1），
  //   且不进任何自动化链，故不与「1 = P1 内容失败」在同一条判定链上相遇。
  'self-check.mjs': [0, 1, 3, 10, 70],
  // v18.66.0（引用格式批）：正向生成器——`3` = 文献卡不存在/0 条目（适用却缺输入，**绝不读成「无需格式」**）、
  //   `1` = 有占位 / 类型未识别 / 索引段对账不一致（候选清单，须人工）；不新造码。
  'cite-format.mjs': [0, 1, 3, 10, 70],
  // v18.64.0（反哺报告-v5 §v5.3-1 的 C1-b 半）：**负知识账本校验器**（只读、非闸门）
  //   ——0 = 账本合法 / **1 = 有非法行，或账本存在却 0 有效行**（空占位与「没记」同形，禁止）
  //   / **3 = 账本不存在**（适用却缺输入 → 须人工确认「确实无」还是「漏记」；与 g-audit-check 的
  //   「`N/A` ≠ `SKIP`」同口径，**不把「没账本」读成通过**）/ 10 / 70。
  //   复用 1/3 的先例 = `g-audit-check.mjs` 与 `self-check.mjs`（同族「非闸门、人手动跑」）；
  //   它**不做任何内容判定**（不判证伪得对不对），故不与「1 = P1 内容失败」在同一条判定链上相遇。
  'disproofs-check.mjs': [0, 1, 3, 10, 70],
}
// v18.12.0（L-68）：**「装了 guard 必登记」是判据，不是注释** —— 旧表靠人工维护，漏登记没有任何门会发现。
//   新脚本加 guard 却忘了登记，等于给自己开了一个「表外退出码随便用」的后门；故本规则改为
//   「凡是真 import `_lib/exit-guard.mjs` 的随包脚本，必须在 EXIT_CONTRACT 里有一行」。
//   豁免留一扇门（必须是**显式登记的理由**，不是静默跳过）：当前为空——v18.22.2 起 **24/24** 全覆盖。
const EXIT_GUARDED_EXEMPT = {}

// ───── ⑧（仓库根面）仓库级脚本退出码契约表 —— v18.78.2 B6 新增 ─────────────────────
//   为什么单列一张：上表的 31 条键**全是随包脚本**（`skills/lunheng-article-pipeline/scripts/*.mjs`），
//   而本仓还有 10 个**仓库级**脚本（发布链的 `pack-smoke.mjs` / `plugin-surface-check.mjs`、
//   固定动作的 `closeout-verify.mjs` / `no-write-check.mjs` …）——它们此前**无契约、无门**：
//     · 新增一个表外退出码 → 没有任何门会红；
//     · 删掉一个 `installExitGuard()` → 同样没有任何门会红（`pack-smoke.mjs` 真的装了它，
//       却因不在随包脚本目录而不被上表的「装了 guard 必登记」覆盖面覆盖）。
//   口径（与随包面**同源**，差异只有一处且是刻意的）：
//     · 同一份判据函数（`r08-exit-codes.mjs` 的 `checkOne`）、同一条解析器（`_lib/exit-resolution.mjs`）；
//     · **不强制装 guard**：仓库级脚本的异常路径由各自实现兜（如 `closeout-verify.mjs` 自包 try/catch
//       → `70`），要求它们一律装随包 guard 既做不到（不随包）也没必要；
//     · 「装了 guard 必登记」仍成立（`ROOT_EXIT_GUARDED_EXEMPT` 为空即该不变量成立）。
//   ⚠️ **每条的允许码都是实测的**（静态解析 `process.exit` / `process.exitCode` 全部取值 +
//     该脚本是否真 import `_lib/exit-guard.mjs` 的 10/70）：口径 = 脚本头自述 + 实解析，两处对不上即以实解析为准。
//     · `bump-version.mjs` 头注释只给用法；实解析只有 `process.exit(10)`，成功路径静默返回 → 0。
//     · `link-check.mjs` / `plugin-surface-check.mjs` / `repo-hygiene-check.mjs`：0 = 通过（无 exit 调用）／1 = 有发现。
//     · `pack-smoke.mjs` 装了 guard（真 import `installExitGuard`）→ 异常路径 10/70 可达。
// ──────────────────────────────────────────────────────────────────────────────
const ROOT_EXIT_CONTRACT = {
  'agents-log-check.mjs': [0, 10, 70],           // v18.86.0-prep（台海反哺 F-5）：头注释自述；**刻意没有 1**——ADR-0003「非内容判定脚本用 1 = 撞码」，与 flow-metrics.mjs 同判据（只报事实：发现项进 stdout/--json，不进退出码）
  'bump-version.mjs': [0, 10],                    // 0 = 已执行 bump / 10 = 用法错（未给 <old> <new>）
  'closeout-verify.mjs': [0, 1, 10, 70],          // 头注释 :28 自述；70 = 内部错误（v18.62.4 #5 起真可达）
  'dist-tag-check.mjs': [0, 1, 10, 70],           // 头注释 :25 自述（1 含 latest 落后；10 含 registry 不可达）
  'flow-metrics.mjs': [0, 10, 70],                // 头注释 :21 自述；**刻意没有 1**——它不是门（只报事实）
  'host-contract-probe.mjs': [0, 1],              // 头注释 :16 自述（1 = 任一断言失败 / --require-host 下产物缺失）
  'link-check.mjs': [0, 1],                       // 头注释 :30 自述（1 = 有未归类断链，fail-closed）
  'no-write-check.mjs': [0, 1, 10, 70],           // 头注释 :8-9 自述（1 = 有改写**或**有步骤没跑起来）
  'pack-smoke.mjs': [0, 1, 10, 70],               // 头注释 :15 自述 + 真 import installExitGuard → 70 可达
  'plugin-surface-check.mjs': [0, 1],             // 头注释 :24 自述（**B5 修复后**：未知 status 也进 1，见该脚本 blockingProblems）
  'repo-hygiene-check.mjs': [0, 1],               // 头注释 :40 自述（本文件；1 = 有失败，fail-closed）
}
// 仓库根面的 guard 豁免（与上表同理：豁免必须是**显式登记的理由**，不是静默跳过）。当前为空。
//   `pack-smoke.mjs` 是唯一 import guard 的仓库根脚本，已在表内 ⇒ 不变量成立。
const ROOT_EXIT_GUARDED_EXEMPT = {}


// ───── ⑨ 词预算表 ─────
// v18.80.1（全量审查修订批 · 报告 §C2）：**词预算登记表已外移**到 `./_lib/doc-budget-reasons.mjs`。
//   本文件此前把 48 条的「抬升理由」（≈87 KB、占本文件 42%）与判据混在一处；现只留判据 + 下面这行 import。
//   ⚠️ 规则 ㊲ 的读取面**已同批**改为指向新模块；若忘记同步，它会报 **P0 规则失效**（这是本批故意留的护栏，
//   不是可选项）——见 `_lib/cc-rules/repo-surface-rules.mjs` 规则 ㊲ 的真源存在性自证段。
import { DOC_BUDGET } from './_lib/doc-budget-reasons.mjs'

const ALWAYS_RESIDENT = [
  'skills/lunheng-article-pipeline/SKILL.md',
  'skills/lunheng-article-pipeline/AGENTS.md',
]
// v18.80.1+v（独立审计批 3 · 常驻面瘦身）**显式下调 72→56 KB**：SKILL.md §执行能力边界 的
//   **逐脚本详述与边界论证**（19,105 B = SKILL.md 的 36.8%）整体外移到技能根 `operations-capability.md`
//   （按需读），并消掉 SKILL.md × AGENTS.md 的逐字重叠（AGENTS.md 的流水线协议 fenced 块 + 四类已由
//   SKILL.md 拥有的规则体 → 改指针）。
//   **实测**：SKILL.md 51,865 → 38,898 B；AGENTS.md 21,088 → 17,319 B；**常驻集 72,953 → 56,217 B**。
//   按定案 ① 公式（实测 + 1.5 KB 向上取整到整 KB）= 56,217 + 1,536 = 57,753 → **57,344 B = 56 KB**。
//   **为什么这次是「下调」而不是「抬升」**：常驻集是**每会话固定开销**，此前长期贴墙（余量 775 B = 「等效
//   禁止再写」），而墙的成因是**复述与历史注解**，不是承重内容。判据：**棘轮的作用是锁住已得的减量，而不是
//   给增长发许可**——下调后任何新增都必须显式抬升并写明理由（v18.1.0 同一条原则）。
//   **长期目标 51,200 B 不变**（批 3 把差距从 21,753 B 收到 5,017 B）。
const ALWAYS_LIMIT = 55296  // **v18.88.0（多宿主收口批）「再显式下调 56→54 KB」** —— 依**主人 2026-10-10 裁定**（在「多宿主重复」的收口/保留之间选**收口**）：`AGENTS.md` §关键规则 中与 `SKILL.md` **同事实**的 7 组条目（角色编号 / 模型分配 / 阶段闸门 + 闸门留证 / 图件链路 / G14 / T9 / 写保护的授权五步）收为**指针**，五步流程逐字落 `references/maintainers.md` §十四。**实测**：`AGENTS.md` 15,971 → **14,469 B**；**常驻集 54,812 → 53,310 B（52.1 KB）**。按定案 ① 公式：53,310 + 1,536 = 54,846 → 向上取整到整 KB = **55,296 B（余量 1,986 B）**。⚠️ **长期目标 51,200 B 仍未达成（差 2,110 B）**：剩余内容是**唯一宿主承重**（子代理失败三段式 1,454 B / M 门行 924 B〔有机械消费者 `consistency-check` ⑥b + `docs-facts`〕/ 注解聚合策略 / 各条一句话判据）——**再压就要删承重，需主人另行裁定是否下调该目标**。 v18.86.0（常驻集真外移批） —— 常驻集是**每会话固定开销**，本次做了**真外移**而非抬上限：把 `AGENTS.md` §文件修改操作约束 第 6 条下的**七条维护期长说明**逐字迁入 `references/maintainers.md` §十四（判据 = 维护期才需要，按 v18.22.1 CTX-2 已确立的「维护者向 → maintainers.md」），原位只留**紧凑判据清单 + 指针**。**实测**：`AGENTS.md` 19,295 → 15,971 B；**常驻集 58,249 → 54,925 B**。按定案 ① 公式（实测 + 1.5 KB 向上取整到整 KB）= 54,925 + 1,536 = 56,461 → **57,344 B = 56 KB（余量 2,419 B）**。**为什么是下调**：棘轮的作用是**锁住已得的减量**，而不是给增长发许可（本仓 v18.80.1+v 同判据）。**长期目标 51,200 B 不变**——本次把差距从 7,049 B 收窄到 **3,725 B**，瘦身待办照旧（下一个候选：`SKILL.md` 的 §执行能力边界 与之重叠的段落）。 v18.77.0（文档与运行-审计 v1 批 · P-2 配 SKILL.md §执行能力边界 新增「主控亲跑路径」）显式抬升 69→72 KB（按定案 ① 同一公式：实测 70,940 B + 1.5 KB = 72,476 → 向上取整到整 KB = 73,728 B = 72 KB，余量 2,788 B）——常驻集 SKILL.md 50,060 B + AGENTS.md 20,880 B，抬升是 SKILL.md §执行能力边界 增「⚙️ 主控亲跑路径」一条的同批棘轮维护（v18.1.0「同一次提交显式抬升并写明理由」原则）。**瘦身待办不变**：长期目标仍为 51,200 B（v18.1.0 原始值）。  v18.61.0 反哺 v4（主人授权落地）：SKILL.md 增 11 行 H3/H4/H6/H7 段后常驻集合计 68,252 B（SKILL.md 48,589 B + AGENTS.md 19,663 B）；按 v18.1.0「同一次提交里显式抬升并写明理由」原则（旧 67,584 = 66 KB，超 668 B）抬到 70,656 B（= 69 KB，余量 2,404 B）。  **v18.85.0-prep（2026-10-09 retro C）抬升 56→60 KB（按定案 ① 同一公式）**：AGENTS.md §文件修改操作约束 末新增「**跑门验证前先清 staging 中间产物**」指针（+840 B，常驻集 57,344 → 58,249 B，超旧上限 905 B）→ 按公式 = 58,249 + 1,536 = 59,785 → 向上取整到整 KB = **61,440 B = 60 KB（余量 3,191 B）**。**抬升理由**：① 该指针属维护期工作纪律（与 v18.45.0「发版前必跑 no-write-check」同族，登记在 §6 验证步的同段 blockquote 内），不挪他处（运行期角色不读维护期纪律，但主控亲跑维护动作时必读）；② 长期目标 51,200 B 不变（与 v18.77.0 / v18.61.0 抬升的"瘦身待办不变"原则一致）。

// ───── ctx 构造：所有规则共享的运行期状态 ─────
const ctx = {
  fail, note, ROOT,
  scanSet, tracked, untracked,
  isText, SELF,
  scriptDir,
  rootScriptDir,
  EXIT_CONTRACT, EXIT_GUARDED_EXEMPT,
  ROOT_EXIT_CONTRACT, ROOT_EXIT_GUARDED_EXEMPT,
  DOC_BUDGET, ALWAYS_RESIDENT, ALWAYS_LIMIT,
  git,
  // ⑥ + ⑦b 共用：发布物清单（三态：string[] / null = UNKNOWN）
  packFiles: null,
}

// 按原顺序执行 15 条规则
r01.run(ctx)
r02.run(ctx)
r03.run(ctx)
r04.run(ctx)
r05.run(ctx)
r06.run(ctx)
// r06 写入 ctx.packFiles（⑥ 成功则非 null）；⑦b 据此判断发布物档
// （原文件中 r06 与 r07 顺序：⑥→⑦→⑦b；⑦b 需要 packFiles，故必须在 r06 之后）
r07.run(ctx)
r07b.run(ctx)
r08.run(ctx)
r08b.run(ctx)
r08c.run(ctx)
r08d.run(ctx)
r09.run(ctx)
r10.run(ctx)
r11.run(ctx)
r12.run(ctx)
r13.run(ctx)
r14.run(ctx)
r15.run(ctx)

// ───── 末尾汇总（逐字保留：notes 前缀「  ✓ 」、fails「✗ 未通过：N 项」+「  - 」、汇总「✓ 全部通过」、退出码 0/1）───
console.log('\n=== 仓库机械卫生门（repo-hygiene-check）===')
for (const n of notes) console.log('  ✓ ' + n)
if (fails.length) {
  console.log(`\n✗ 未通过：${fails.length} 项`)
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log('\n✓ 全部通过')
