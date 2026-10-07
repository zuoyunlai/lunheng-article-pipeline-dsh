#!/usr/bin/env node
/**
 * link-check.mjs —— 技能目录内**断链穷举**（v18.2.6 新增，回应第三方审计「文档引用不可解析」一族问题）
 *
 * 为什么存在：
 *   本包的技能体是一棵 **66 个 .md 的相对引用树**（角色卡 / 模板 / 共享算法 / 闸门 / checker 互相引用），
 *   而此前**没有任何门**核过这些引用指向的文件是否真的在盘。`consistency-check` 只核「特定几类」引用
 *   （审计视图 / 图件路径 / 契约表），覆盖面是逐个写死的；本脚本补的是**穷举**那一层。
 *
 * 口径（三条，缺一不可；边界如实写在每一条里）：
 *   ① **只认「路径型」引用**：`<file>:<line>` 形态的代码引用、带目录分隔符（≥1 个 `/`）且扩展名在白名单
 *      （md / mjs / js / json / yml / yaml / svg / png / txt / csv）的反引号 code span，以及 markdown 链接目标
 *      （排除 `http(s):` / `mailto:` / `#锚点`）。
 *      **边界**：裸文件名（如 `` `m-gate-check.mjs` ``）**不解析**——它在文档里是「脚本名」而不是路径
 *      （本包的约定是 `node scripts/<名>.mjs`），强行解析只会制造假断链；目录引用（以 `/` 结尾）同理。
 *   ② **解析顺序分两条通道**（v18.78.2 · 全量审计 A3 修复——旧版对**所有**引用一律试五个候选根）：
 *      · **Markdown 链接 `[..](href)`**：**只按「引用所在文件的目录」解析**（CommonMark 口径——读者点它时
 *        由**渲染器**按该文件自身位置解析，GitHub / npm 页面同理）。旧版用五候选根放行了**实测 7 条真实 404**：
 *        `SKILL.md` 的 `_shared/DSH-集成方案.md`（链接文字写的是 `references/_shared/…`，href 少一层）、
 *        两个**任务简报模板**的 `_shared/文类档案.md`（模板会被**逐字复制进每份任务简报**）、
 *        `references/_shared/期刊数据库.md` 的 `../scripts/journal-fit.mjs`、`references/pipeline-readme.md`
 *        与 `references/_shared/DSH-集成方案.md` 的 `examples/workflow/…`、`SKILL.md` 的 `docs/usage.md`
 *        （后三者少一层目录）——门却打印「✓ 无未归类断链」。
 *      · **反引号 code span 里的裸路径**：技能根 → **引用所在文件的目录** → 仓库根（`lib/`、
 *        `cordis.patch.yml`、`docs/…` 这类包级路径）→ 技能根的 `scripts/` 与 `references/`
 *        （本包文档大量省略这两个前缀）——**这才是五候选根的真实用途**。任一命中即算「在盘」。
 *   ③ **未命中不等于断链**——必须再分类，只有**归类不了的**才算断链：
 *      · **运行期产物**（`final/ drafts/ audits/ analysis/ literature/ data/ cases/ case-studies/ memory/ run/`）：
 *        它们在**用户的项目目录** `run/<项目>/` 下生成，永不随包 → 放行；
 *      · **跨技能资源引用**（`guide/`、`references/official-docs/`、`official-docs/`、官方 `docs/**`、
 *        `packages/preset/agent-presets/`）：属主是 **`dsh-plugin-guide` 技能包**（含 215+ 篇官方文档副本）
 *        与 DSH 官方仓库，**不在本技能的资源根下** → 单列放行（识别规则 = 显式登记的**前缀/整串白名单**，
 *        不是模糊匹配；新增一条必须写明属主）；
 *      · **墓碑式引用**（历史上被有意删除、文档里**明写「已删除」**的文件）→ 单列放行并附理由；
 *      · **存疑条目**（归类拿不准、已上报维护者）→ 放行但**大声打印**，且不会静默变成永久豁免。
 *
 * 用法：
 *   node scripts/link-check.mjs          # 0 = 无未归类断链；1 = 有（fail-closed）
 *   node scripts/link-check.mjs --json   # 附带 JSON 汇总（供 CI/脚本消费）
 *
 * 边界（如实）：
 *   · 只扫**技能目录**（`skills/lunheng-article-pipeline/**` 的 `.md`）；仓库根 README / docs / CONTRIBUTING
 *     不在本脚本范围（它们的引用以包级路径为主，由 `repo-hygiene-check` 与 `consistency-check` 各自覆盖）。
 *   · 不做**锚点**校验（`file.md#小节` 只核文件是否在盘，不核锚点是否存在）——锚点校验需要 markdown 解析器
 *     与本仓「零依赖」相冲突，且本包锚点是中文标题派生的，误报率高。
 *   · 不解析代码块里的路径（```text 布局树里的示意路径是**举例**，不是引用）。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '..')
export const SKILL_ROOT = join(REPO_ROOT, 'skills', 'lunheng-article-pipeline')

/** 扩展名白名单（只有这些才算「路径型引用」）。 */
const EXT_RE = /\.(?:md|mjs|js|json|ya?ml|svg|png|txt|csv)$/i
/**
 * 「不是路径」的排除规则（v18.2.6 实测补；每条都对应真实出现过的形态，不是猜测）：
 *   · 含空白 → 是**命令行片段**（如 `` `--source drafts/初稿-v2.md` ``），不是路径；
 *   · 含 `<` `>` `{` `}` → 是**占位符模板**（如 `<项目>/阶段确认-<阶段>.md`、`<repo>/package.json`）；
 *   · 含 `*` → 是**通配符**（如 `references/official-docs/docs/subsystems/*.md`）；
 *   · 含 `|` → 是**二选一写法**（如 `packages/AGENTS.md|README.md`，Windows 上也不可能是合法路径）；
 *   · 含 `...` → 是**缩写记法**（v18.80.0 · 全量审计-v18.79.1 P2-1 扩面时实测：`docs/quick-facts.md`
 *     用 `skills/.../scripts/m-gate-check.mjs` 指代「技能目录下的某脚本」。它**不是可解析路径**
 *     （五个候选根全落空），此前因 `docs/` 不在扫面而不可见；现按「占位记法」排除，**不是**放行断链——
 *     真有断链仍会以别的 token 形态出现）；
 *   · `..`（单独一串）→ 同上（实测全库 0 处把它当引用，保留为同类防御）。
 *   本包的路径约定里不含空格与这些字符（含空格的路径会让 `pwsh` 调用方式失效），故这几条排除不会误伤。
 */
const NOT_A_PATH_RE = /[\s<>{}*|]|\.\.\./
/** 单独成串的 `..`（`../x` 是合法相对路径，**不在此列**）。 */
const DOTDOT_RE = /(?:^|[\\/])\.\.(?:$|[\\/])/

/** 运行期产物根：在 `run/<项目>/` 下由流水线生成，**永不随包** → 放行。 */
export const RUNTIME_ROOTS = new Set([
  'run', 'final', 'drafts', 'audits', 'analysis', 'literature', 'data', 'cases', 'case-studies', 'memory',
])

/** 跨技能资源引用：**属主不是本包**（本技能资源根下不存在这些路径）。新增一条必须写明属主。 */
export const CROSS_SKILL_PREFIXES = [
  ['guide/', 'dsh-plugin-guide 技能的 `guide/`（官方开发指南）'],
  ['references/official-docs/', 'dsh-plugin-guide 技能携带的官方文档副本（本包技能目录内**没有** official-docs/）'],
  ['official-docs/', '同上，未带属主技能前缀的写法（第三方审计判为 P2「路径未带属主前缀」）'],
  ['packages/preset/agent-presets/', 'DSH 官方仓库内路径'],
]
/** 官方文档正文路径的**整串白名单**（属主 = dsh-plugin-guide；本包 `docs/` 只含安装/使用/架构等用户文档）。 */
export const CROSS_SKILL_EXACT = new Map([
  ['docs/capability-seams.md', '官方文档（DSH 仓库 docs/）'],
  ['docs/cookbook/adding-a-tool.md', '官方文档'],
  ['docs/subsystems/tools.md', '官方子系统契约'],
  ['docs/subsystems/user-questions.md', '官方子系统契约'],
  ['docs/tool-catalog.md', '官方工具目录'],
  ['docs/tool-execution-pipeline.md', '官方工具执行管线'],
])

/** 墓碑式引用：历史上被**有意删除**的文件，文档里明写「已删除」→ 不是断链。 */
export const TOMBSTONES = new Map([
  ['templates/审稿报告-template.md', 'v18.0.3 删除的零入边旧副本（格式真源已内联进 09-审稿-peer-reviewer.md）；引用处明写「已删除」'],
  ['templates/先行者清单-template-lite.md', 'v18.0.3 删除的冗余 lite 版；引用处明写「v18.0.3 删除了冗余的…」'],
  ['references/templates/阶段确认-template.md', '文件名**别名**提示（该模板产出 `阶段确认-<阶段>.md`，文件名历史上叫 `主人确认-template.md`）；行内明写「按此名搜索搜不到」'],
  ['执行韧化协议-v2.1.0.md', '审计报告举例的历史删除文件；技能目录内**当前 0 处引用**（登记以备将来引用，未触发即提示可清理）'],
])

/**
 * 存疑条目（放行但**大声打印**）：归类拿不准、已上报维护者，不静默变成永久豁免。
 * 清理条件写在 reason 里——条目长期存疑就应升级为「修文档」或「修脚本」。
 */
export const SUSPECT = new Map([
  // v18.62.4（全量审计-v18.62.3 §8.3 #37）：**去掉会腐烂的 `:308-315` 行号**。
  //   病灶：该引用当年指 `consistency-check.mjs` 的 `repoTargets`，随后续批次插入内容已漂到 `:425`
  //   ——**注释在说谎**，且没有门会发现（规则 ⑪ 只禁 `lib/**.js:LINE` 形态的**发布面**引用，
  //   管不到仓库脚本注释里的互指）。**实测数（v18.78.2 · 全量审计 B8 复核）：全库同类引用 20 处 / 16 个文件**
  //   ——已由规则 ⑪' 的**脚本注释面棘轮**覆盖（数字真源 = `scripts/_lib/lib-line-refs.mjs` 的
  //   `SCRIPT_COMMENT_REF_BASELINE`；本行旧文写的「9 处」是当年的实测，现按「数字只写真源指针」收敛）。
  //   修法：**按符号名定位**（`repoTargets` 可直接 grep；改名时能连带发现），不再写行号——
  //   位置会漂，名字不会。
  ['skills/README.md', '`consistency-check.mjs` 的**内部登记名**（其 `repoTargets` 把它解析为 `skills/lunheng-article-pipeline/README.md`，磁盘上确无 `skills/README.md`）；引用处用的是脚本标签，属命名口径不一致而非文件缺失。建议脚本与文档统一为真实路径'],
])

/** 走查某根下的所有 .md。 */
function walkMd(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkMd(p, out)
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p)
  }
  return out
}

/**
 * 包级文档面（v18.80.0 · 全量审计-v18.79.1 **P1-1** 扩面）：
 *   病灶：本脚本此前只 `walkMd(SKILL_ROOT)`，仓库根 5 语 README 与 `docs/**` **不在扫面**；
 *   而 `docs/` 与根 README 的**相对链接**恰恰是「文档层指针」最外层的那一跳——实测 6 个文件里
 *   22 条 `../lunheng-article-pipeline-dsh/…`（指向一个**不存在的兄弟目录**）全部放行。
 *   同类缺陷在本仓已第三次出现（前两次：r09 文档预算只扫技能目录 / 一致性 ⑥b 只扫 active），
 *   故本次不再「逐条修链接」了事，而是把**扫面**补上。
 *   边界（如实）：`docs/审计与修订记录/**` 与 `docs/验证记录/**` 是**留痕**（不随包、语义为历史记录），
 *   其相对链接指向当时的工作区结构 → **排除**（与 r09 的 `DOCS_HISTORICAL` 同口径）。
 */
const DOCS_HISTORICAL_RE = [/^docs\/审计与修订记录\//, /^docs\/验证记录\//]
export const REPO_DOC_ROOTS = Object.freeze(['docs'])
export const REPO_DOC_FILES = Object.freeze([
  'README.md', 'README-zh.md', 'README-es.md', 'README-pt.md', 'README-hi.md',
  'CONTRIBUTING.md', 'SECURITY.md',
])

/**
 * 穷举技能目录内 .md 的路径型引用并分类。
 * @returns {{files:number, refs:number, broken:Array, runtime:Array, crossSkill:Array, tomb:Array, suspect:Array, staleTomb:Array, staleCross:Array}}
 */
export function scan() {
  // v18.80.0 P1-1：扫面 = 技能目录 + 包级文档面（根 README 等 + `docs/**`，留痕目录排除）。
  //   `from` 一律相对 `REPO_ROOT`（技能内文件形如 `skills/lunheng-article-pipeline/…`），
  //   故解析基准只认一个根 —— 避免「同一个 token 在两种布局下解析到两处」。
  const skillFiles = walkMd(SKILL_ROOT)
  const docFiles = []
  for (const r of REPO_DOC_ROOTS) {
    const abs = join(REPO_ROOT, r)
    if (existsSync(abs)) docFiles.push(...walkMd(abs))
  }
  for (const f of REPO_DOC_FILES) {
    const abs = join(REPO_ROOT, f)
    if (existsSync(abs)) docFiles.push(abs)
  }
  const files = [...skillFiles, ...docFiles]
  /** token → Map<`${from}\u0000${kind}`, {from, kind}>（同一 token 可能**既是 code span 又是 md 链接**，
   *  两者判定通道不同，故按「引用点」而不是按「token」记账）。 */
  const refs = new Map()
  const add = (token, from, kind) => {
    if (!refs.has(token)) refs.set(token, new Map())
    refs.get(token).set(from + '\u0000' + kind, { from, kind })
  }
  for (const abs of files) {
    const from = relative(REPO_ROOT, abs).split(sep).join('/')
    // 留痕目录（审计与修订记录 / 验证记录）**只做记录、不做链接判定** —— 其相对链接指向当时的工作区结构。
    const historical = DOCS_HISTORICAL_RE.some((re) => re.test(from))
    const text = readFileSync(abs, 'utf8')
    // 反引号 code span（单行）：只取「像路径」的 token（含 `/` + 扩展名白名单 + 不是命令行/占位符/通配符）
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const t = m[1].trim()
      if (t.includes('/') && EXT_RE.test(t) && !NOT_A_PATH_RE.test(t) && !DOTDOT_RE.test(t)) add(t, from, historical ? 'code-hist' : 'code')
    }
    // markdown 链接目标
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const t = m[1].trim()
      if (/^(?:https?:|mailto:|#)/i.test(t)) continue
      if (!EXT_RE.test(t) || NOT_A_PATH_RE.test(t)) continue
      add(t, from, historical ? 'md-hist' : 'md')
    }
  }

  const broken = []
  const runtime = []
  const crossSkill = []
  const tomb = []
  const suspect = []
  const historical = []
  const usedTomb = new Set()
  const usedCross = new Set()
  const usedSuspect = new Set()

  const clsSeen = new Set()
  const pushOnce = (arr, key, item) => {
    if (clsSeen.has(key)) return
    clsSeen.add(key)
    arr.push(item)
  }
  for (const [token, insts] of [...refs].sort((a, b) => a[0].localeCompare(b[0]))) {
    const raw = token.split('#')[0]
    if (!raw) continue
    for (const { from, kind } of insts.values()) {
      // ② 两条通道（v18.78.2 · 全量审计 A3；v18.80.0 · 全量审计-v18.79.1 P1-1 扩面到包级文档）：
      //   Markdown 链接只按**引用所在文件的目录**解析（渲染器口径）；反引号裸路径才试多个候选根
      //   （本包文档大量省略 `scripts/`、`references/` 前缀，那才是它的用途）。
      //   `from` 一律相对 `REPO_ROOT`，故「引用所在文件的目录」= `dirname(join(REPO_ROOT, from))`；
      //   技能内文件的相对引用因此仍落在 `SKILL_ROOT/**` 下（向后兼容）。
      const fromDir = dirname(join(REPO_ROOT, from))
      // v18.80.0（P1-1 扩面）第 ⑥ 候选：`REPO_ROOT` 下带 `/` 的裸路径按**仓库根**解析。
      //   立它是因为「包级文档面」纳入扫面后，`docs/**` 里的 `` `tests/x.test.mjs` `` 这类
      //   **仓库向路径**（共 34 处引用）此前无处可解析，会被误报成断链。
      //   **边界（防误放行）**：只认含 `/` 的 token（排除 `README.md` 这种裸文件名——
      //   它必须按引用文件自己的目录解析，否则 `docs/` 下的 `README.md` 会被错认成根 README）。
      const repoRel = raw.includes('/') ? [resolve(REPO_ROOT, raw)] : []
      const candidates = (kind === 'md' || kind === 'md-hist')
        ? [resolve(fromDir, raw)]
        : [
            resolve(SKILL_ROOT, raw),                         // ① 技能根
            resolve(fromDir, raw),                            // ② 引用所在文件的目录（相对引用）
            resolve(REPO_ROOT, raw),                          // ③ 仓库根（包级路径）
            resolve(SKILL_ROOT, 'scripts', raw),              // ④ 省略 `scripts/` 前缀的写法
            resolve(SKILL_ROOT, 'references', raw),           // ⑤ 省略 `references/` 前缀的写法
            ...repoRel,                                       // ⑥ 仓库根下属目录（tests/ 等）的裸路径
          ]
      const isHist = kind.endsWith('-hist')
      if (candidates.some((c) => existsSync(c))) continue
      const key = token + '\u0000' + from
      const head = raw.split('/')[0]
      // 留痕目录：只记账、不判定（v18.80.0 P1-1 扩面时新增 —— 其链接语义是「当时的工作区结构」）
      if (isHist) { pushOnce(historical, key, [token, from, candidates]); continue }
      // 跨技能（前缀白名单）
      const crossPrefix = CROSS_SKILL_PREFIXES.find(([pre]) => raw.startsWith(pre))
      if (crossPrefix) { pushOnce(crossSkill, key, [token, from, crossPrefix[1]]); usedCross.add(crossPrefix[0]); continue }
      if (CROSS_SKILL_EXACT.has(raw)) { pushOnce(crossSkill, key, [token, from, CROSS_SKILL_EXACT.get(raw)]); usedCross.add(raw); continue }
      // 墓碑（整串或按文件名后缀匹配）
      const tombKey = [...TOMBSTONES.keys()].find((k) => raw === k || raw.endsWith('/' + k))
      if (tombKey) { pushOnce(tomb, key, [token, from, TOMBSTONES.get(tombKey)]); usedTomb.add(tombKey); continue }
      // 存疑
      if (SUSPECT.has(raw)) { pushOnce(suspect, key, [token, from, SUSPECT.get(raw)]); usedSuspect.add(raw); continue }
      // 运行期产物（首段命中，且**不是**以本包顶层目录名伪装的真实路径）
      if (RUNTIME_ROOTS.has(head)) { pushOnce(runtime, key, [token, from]); continue }

      pushOnce(broken, key, [token, from, candidates, kind])
    }
  }

  return {
    files: files.length,
    refs: refs.size,
    instances: [...refs.values()].reduce((n, m) => n + m.size, 0),
    broken,
    runtime,
    crossSkill,
    tomb,
    suspect,
    historical,
    staleTomb: [...TOMBSTONES.keys()].filter((k) => !usedTomb.has(k)),
    staleCross: [...CROSS_SKILL_PREFIXES.map(([p]) => p), ...CROSS_SKILL_EXACT.keys()].filter((k) => !usedCross.has(k)),
    staleSuspect: [...SUSPECT.keys()].filter((k) => !usedSuspect.has(k)),
    staleRuntime: [...RUNTIME_ROOTS].filter((r) => !runtime.some(([t]) => t.split('/')[0] === r)),
  }
}

/** CLI 入口（被 import 时**不执行**——测试直接 import 上面的 scan()）。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wantJson = process.argv.includes('--json')
  const r = scan()
  console.log(`\n=== 断链穷举（link-check）· 扫面 = 技能目录 + 包级文档面 ===`)
  console.log(`扫描 ${r.files} 个 .md，提取到 ${r.refs} 个路径 token（${r.instances} 处引用点）\n`)
  console.log(`· 在盘（Markdown 链接按「文件目录」/ 反引号裸路径按五候选根）：${r.instances - r.broken.length - r.runtime.length - r.crossSkill.length - r.tomb.length - r.suspect.length - r.historical.length} 条`)
  console.log(`· 运行期产物（run/ final/ drafts/ audits/ analysis/ literature/ data/ cases/ case-studies/ memory/）：${r.runtime.length} 条`)
  console.log(`· 跨技能资源引用（属主 = dsh-plugin-guide / DSH 官方仓库）：${r.crossSkill.length} 条`)
  for (const [t, from, why] of r.crossSkill) console.log(`    - ${t}  ← ${from}（${why}）`)
  console.log(`· 留痕目录（docs/审计与修订记录、docs/验证记录 —— 只记账不判定）：${r.historical.length} 条`)
  console.log(`· 墓碑式引用（历史上被有意删除，文档已注明）：${r.tomb.length} 条`)
  for (const [t, from, why] of r.tomb) console.log(`    - ${t}  ← ${from}（${why}）`)
  console.log(`· 存疑条目（放行但需人工收口）：${r.suspect.length} 条`)
  for (const [t, from, why] of r.suspect) console.log(`    ⚠ ${t}  ← ${from}\n        ${why}`)
  if (r.staleTomb.length) console.log(`\n⚠ 墓碑白名单未触发（可清理）：${r.staleTomb.join(', ')}`)
  if (r.staleCross.length) console.log(`⚠ 跨技能白名单未触发（可清理）：${r.staleCross.join(', ')}`)
  if (r.staleSuspect.length) console.log(`⚠ 存疑白名单未触发（可清理）：${r.staleSuspect.join(', ')}`)
  if (r.staleRuntime.length) console.log(`⚠ 运行期根未被任何引用命中：${r.staleRuntime.join(', ')}`)

  if (wantJson) console.log('\n' + JSON.stringify({ files: r.files, refs: r.refs, instances: r.instances, broken: r.broken.map(([t, f, , k]) => ({ token: t, from: f, kind: k })) }, null, 2))

  if (r.broken.length) {
    console.log(`\n✗ 未归类断链：${r.broken.length} 条（既不在盘，也不属于运行期产物 / 跨技能资源 / 墓碑 / 存疑任一类）`)
    for (const [t, from, cands, kind] of r.broken) {
      console.log(`  - ${from} 引用了 \`${t}\`（${kind === 'md' ? 'Markdown 链接：只按文件目录解析' : '反引号裸路径：五候选根解析'}），但以下位置均不存在：`)
      for (const c of cands) console.log(`      ${c}`)
    }
    console.log('\n修法三选一：① 改文档指向真实文件；② 若是有意删除，登记进本脚本的 TOMBSTONES 并写明版本与理由；③ 若是跨技能资源，登记进 CROSS_SKILL_* 并写明属主。')
    process.exit(1)
  }
  console.log(`\n✓ 无未归类断链（存疑 ${r.suspect.length} 条见上方 ⚠，均为已上报的既存问题，不阻塞）`)
}
