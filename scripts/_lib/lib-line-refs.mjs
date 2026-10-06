// `lib/**:LINE` 裸行号引用检测（C-9 机械化 · v18.18.9）——供 repo-hygiene 使用，可单测。
//
// ── 为什么需要 ────────────────────────────────────────────────────────
// 审计 C-9 的实测：`SECURITY.md` 引 `lib/tools.js:18,24,133,191`，而实际 `:18` 是
// `import { spawn }`、`:24` 是缓冲注释、真实 `spawn` 调用在 `:31`。**行号引用会随任何改动漂移**，
// 而它读起来却像一个可核验的事实——比没有引用更有害。
//
// 该处当时已改为符号引用，`SECURITY.md` 甚至就地写下了政策：「行号随改动漂移故**按符号引用**，
// **不写绝对行号**」。**但政策没有门** ——v18.18.9 复核发现同一文件隔壁那行仍写着
// `lib/guard.js:177`，而该行实际是 `const cwd = process.cwd()`；真正的守卫安装点是
// `installMechanismGuard()` 内的 `tools.guard(...)`。**同一份文档里，一行宣布了政策、下一行违反了它。**
// 这就是本门的存在理由：政策要靠门落，不能靠同一页上的另一句话。
//
// ── 口径 ─────────────────────────────────────────────────────────────
//   · **只认「本仓的 lib/」**：路径前一个字符若是 `/`（如 `dsh-app-boot/lib/index.js:1112`，
//     那是**上游包**的路径），不算本仓引用——否则会把对上游代码的引用误判成我们的。
//   · **历史记录豁免**：`CHANGELOG.md` / `audits/**` / `docs/审计与修订记录/**` 是**当时状态**的
//     留痕，拿今天的代码去核它们反而是错的。豁免是**按目录**声明的，不是「凡是引用都放过」。
//   · 只判**存在性**（有没有裸行号），不判对错——对错无法静态判（正因如此才要求改成符号引用）。

/** 本仓 `lib/**.js:LINE` 的裸行号引用。`(?<![\w./-])` 排掉上游包的 `pkg/lib/...` 形态。 */
const LIB_LINE_REF = /(?<![\w./-])lib\/[\w.-]+\.js:(\d+)/g

/** 找出文本里所有裸行号引用。 */
export function findLibLineRefs(text) {
  const out = []
  for (const m of text.matchAll(LIB_LINE_REF)) {
    out.push({ raw: m[0], line: Number(m[1]) })
  }
  return out
}

/** 历史留痕文件（记录的是「当时」的状态，不拿今天的代码去核）。
 *
 *  v18.62.6 增补 `^\.workbuddy\//`：该目录是**外部 agent 工具的记忆存储**（本仓实测只有
 *    `.workbuddy/memory/YYYY-MM-DD.md`），其中内容是**成文当日的观测记录**，且常**引用第三方原文**——
 *    实例：`2026-10-02.md` 引用 GitHub issue 作者的原话 `lib/index.js:329 以 4 参挂载 tools/post-execute…`。
 *    该引用里的行号是**引文的组成部分**，改它等于篡改引文；而不改则门永远红（与下方 `audits/` 同一两难）。
 *    另一层理由：该目录**不随包发布**（不在 `package.json` 的 `files` 白名单），也不是本仓文档。
 *    本模块的职责是「管本仓自己的文档」，故按目录豁免是**收口扫描语义**，不是放宽判据。
 *
 *  ⚠️ 该豁免是**两处调用点的单一真源**：`tests/lib-line-refs.test.mjs`（CI 侧）与
 *    `scripts/repo-hygiene-check.mjs` 规则⑪（仓库门侧）都读本函数。改这里 = 两处同时生效——
 *    v18.62.6 之前两侧各自实现 `walk()`/`scanSet()` 过滤，导致同一事实两处口径（本批实测踩到）。 */
export const HISTORICAL_DOC_PATTERNS = [
  /^CHANGELOG\.md$/,
  // v18.68.0 拆档：CHANGELOG 的历史归档（内容从主档逐字移入，同为「当时状态」留痕）
  /^changelog\/archive\//,
  /^audits\//,
  /^docs\/审计与修订记录\//,
  /^\.workbuddy\//,
]

/** 该路径是否为历史留痕文件。 */
export function isHistoricalDoc(rel) {
  return HISTORICAL_DOC_PATTERNS.some((re) => re.test(rel))
}

// ── v18.78.2（全量审计-v18.78.1 B8）：`.mjs`/`.js` **注释文本**里的同类行号引用 ────────────────
//   病灶（审计 B8）：本模块只被 ⑪ 用在 `.md`/`.html` 上。`scripts/link-check.mjs` 的 SUSPECT 注释
//   **自陈**：「规则 ⑪ 只禁 `lib/**.js:LINE` 形态的**发布面**引用，管不到仓库脚本注释里的互指。
//   实测全库同类引用共 9 处，这条是唯一已确认腐烂的」—— 即「看起来可核验、实际随改动漂移」的行号
//   引用在**脚本注释里**成片存在，而它们一条门都没有。
//   修法：把 `.mjs`/`.js` 的**注释文本**纳入扫描面。两个判据合成一条：
//     · `findLibLineRefs`（既有）——注释里引 `lib/**.js:LINE`；
//     · `findScriptLineRefs`（本次新增）——注释里引 `<任意名>.mjs|.js:LINE`。
//     **只扫注释**由 `_lib/source-mask.mjs` 的 `extractComments()` 保证：代码里的正则/字符串
//     （例如本模块自己的 `LIB_LINE_REF`、用例里的正负例字符串）不会被误判成引用。
//   **口径（与 `.md` 面刻意不同，理由如下）**：
//     · `.md` 面是**硬零**（有则判失败）——文档里的行号引用没有任何正当理由。
//     · `.mjs/.js` 注释面是**棘轮**（`SCRIPT_COMMENT_REF_BASELINE` 逐文件登记上限）。
//       为什么不能硬零：实测 20 处里，多数是**规则的自我描述与夹具**（如本模块头注释引
//       `lib/tools.js:18` 作为「反面教材原文」——改它等于篡改引文），其余落在本批**不可改**的
//       `lib/**` 与跨簇在改的 `tests/**`／`skills/**` 上。硬零会让门**永久红**，而永久红的门等于没有门
//       （判据同 ⑦b 对本机绝对路径的两档强度）。
//     · 棘轮的作用是**拦住新增**：新写一行会漂的注释引用当即被判失败；已登记的 20 处逐文件可见、
//       并随其自然消亡而被要求下调（note 里点名「基线内已无命中」的文件）。
//   **边界（如实）**：① 只认 `<name>.mjs|.js:LINE` 与 `lib/**.js:LINE` 两种形态——`lib/**.mjs:LINE`
//     不在其中（本仓 `lib/` 只有 `.js`；若将来出现 `.mjs`，需在此加一条形态并重跑门）；
//     ② 只判存在性，不判对错（对错无法静态判——正因如此政策才要求符号引用）；
//     ③ 引用是否「真腐烂」由人工裁决，门只负责**不新增**与**可见**（同 r07b 的棘轮语义）。
/** `.mjs|.js:LINE` 形态的裸行号引用（与 `LIB_LINE_REF` 同一条 lookbehind：排掉上游包路径）。 */
const SCRIPT_LINE_REF = /(?<![\w./-])([\w.-]+\.(?:mjs|js)):(\d+)/g

/** 找出文本里所有 `<脚本名>.mjs|.js:LINE` 形态的引用。 */
export function findScriptLineRefs(text) {
  const out = []
  for (const m of text.matchAll(SCRIPT_LINE_REF)) {
    out.push({ raw: m[0], file: m[1], line: Number(m[2]) })
  }
  return out
}

/** `.mjs/.js` 注释面里**允许**存在的登记上限（棘轮，按文件计；口径见上方 B8 段）。
 *
 *  三类命中（2026-10-06 扩面时实测，**全库 16 个文件 / 20 处**）：
 *    · **规则自我描述**（豁免，见 `SCRIPT_COMMENT_REF_EXEMPT`）：实现本体与夹具里的反面教材；
 *    · **本批不可改的 lib/**：`lib/guard.js` / `lib/index.js` / `lib/tools.js` 各 1 处（互指）；
 *    · **跨目录的真引用**：`scripts/**`（4 处，本批范围**可修**——改成符号引用即可，
 *      但其中 2 个文件正被并发修订簇占用，故本批**只登记不改**，清单见交付回报）、
 *      `skills/**`（6 处）、`tests/**`（4 处）——这些引用**当前都还指得准**，所以它们是**漂移风险**，
 *      不是「已腐烂」。棘轮拦的是它们**继续增加**或**指错而不改**。 */
export const SCRIPT_COMMENT_REF_BASELINE = new Map([
  ['lib/guard.js', 1],                                              // lib/index.js:192
  ['lib/index.js', 1],                                              // lib/guard.js:265
  ['lib/tools.js', 1],                                              // lib/ethics-sanitize.js:269
  ['scripts/_lib/exit-namespace.mjs', 1],                            // model-routing.mjs:20
  ['scripts/_lib/hygiene/r08d-headers.mjs', 1],                      // model-routing.mjs:20
  ['scripts/bump-version.mjs', 2],                                   // content-rules.mjs:395 / :401
  ['skills/lunheng-article-pipeline/scripts/_lib/mgate-gates/mexist-gates.mjs', 2], // handoff-check.mjs:537 / mexist-gates.mjs:15
  ['skills/lunheng-article-pipeline/scripts/_lib/sections.mjs', 2],  // count-chars.mjs:63 / m-gate-check.mjs:215
  ['skills/lunheng-article-pipeline/scripts/_lib/trust.mjs', 1],     // m-gate-check.mjs:480
  ['skills/lunheng-article-pipeline/scripts/build-evidence-bundle.mjs', 1], // m-gate-check.mjs:57
  ['skills/lunheng-article-pipeline/scripts/final-check.mjs', 1],    // lib/tools.js:199
  ['skills/lunheng-article-pipeline/scripts/m-gate-check.mjs', 2],   // final-check.mjs:175 / mform-gates.mjs:946
  ['tests/docs-facts.test.mjs', 1],                                  // lib/index.js:40
  ['tests/ethics-render.test.mjs', 1],                               // lib/tools.js:388
  ['tests/mexist11-argument.test.mjs', 1],                           // mexist-gates.mjs:15
  ['tests/scripts/token-budget.test.mjs', 1],                        // token-budget.mjs:167
])

/** 扫描器**自身的定义与夹具**必然写着示例引用——那不是「会漂移的引用」，而是引文。
 *  与 ⑦b 的 `LOCAL_PATH_EXEMPT` 同判据（`_lib/local-path-scan.mjs` / `tests/local-path-scan.test.mjs`）。
 *  **边界（如实）**：这三个文件里若真写了一条指向别处的行号引用，本规则会漏（缓解：它们**都不随包**，
 *  体积小、用途单一，且 ⑪ 的 `.md` 面仍覆盖文档）。 */
export const SCRIPT_COMMENT_REF_EXEMPT = new Set([
  'scripts/_lib/lib-line-refs.mjs',
  'scripts/_lib/hygiene/r11-lib-line-refs.mjs',
  'tests/lib-line-refs.test.mjs',
])
