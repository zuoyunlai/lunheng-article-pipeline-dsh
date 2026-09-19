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
 *   ② **解析顺序**：技能根 → **引用所在文件的目录**（相对引用）→ 仓库根（`lib/`、`cordis.patch.yml`、
 *      `docs/…` 这类包级路径）→ 技能根的 `scripts/` 与 `references/`（本包文档大量省略这两个前缀）。
 *      任一命中即算「在盘」。
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
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
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
 *   · 含 `|` → 是**二选一写法**（如 `packages/AGENTS.md|README.md`，Windows 上也不可能是合法路径）。
 *   本包的路径约定里不含空格与这些字符（含空格的路径会让 `pwsh` 调用方式失效），故这几条排除不会误伤。
 */
const NOT_A_PATH_RE = /[\s<>{}*|]/

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
  ['skills/README.md', '`consistency-check.mjs` 的**内部登记名**（`:308-315` 的 repoTargets 把它解析为 `skills/lunheng-article-pipeline/README.md`，磁盘上确无 `skills/README.md`）；引用处用的是脚本标签，属命名口径不一致而非文件缺失。建议脚本与文档统一为真实路径'],
])

/** 走查技能目录下的所有 .md。 */
function walkMd(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkMd(p, out)
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p)
  }
  return out
}

/**
 * 穷举技能目录内 .md 的路径型引用并分类。
 * @returns {{files:number, refs:number, broken:Array, runtime:Array, crossSkill:Array, tomb:Array, suspect:Array, staleTomb:Array, staleCross:Array}}
 */
export function scan() {
  const files = walkMd(SKILL_ROOT)
  /** token → Set<引用它的文件（相对技能根）> */
  const refs = new Map()
  const add = (token, from) => {
    if (!refs.has(token)) refs.set(token, new Set())
    refs.get(token).add(from)
  }
  for (const abs of files) {
    const from = relative(SKILL_ROOT, abs).split(sep).join('/')
    const text = readFileSync(abs, 'utf8')
    // 反引号 code span（单行）：只取「像路径」的 token（含 `/` + 扩展名白名单 + 不是命令行/占位符/通配符）
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const t = m[1].trim()
      if (t.includes('/') && EXT_RE.test(t) && !NOT_A_PATH_RE.test(t)) add(t, from)
    }
    // markdown 链接目标
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const t = m[1].trim()
      if (/^(?:https?:|mailto:|#)/i.test(t)) continue
      if (!EXT_RE.test(t) || NOT_A_PATH_RE.test(t)) continue
      add(t, from)
    }
  }

  const broken = []
  const runtime = []
  const crossSkill = []
  const tomb = []
  const suspect = []
  const usedTomb = new Set()
  const usedCross = new Set()
  const usedSuspect = new Set()

  for (const [token, sources] of [...refs].sort((a, b) => a[0].localeCompare(b[0]))) {
    const from = [...sources][0]
    const raw = token.split('#')[0]
    if (!raw) continue
    const candidates = [
      resolve(SKILL_ROOT, raw),                        // ① 技能根
      resolve(dirname(join(SKILL_ROOT, from)), raw),    // ② 引用所在文件的目录（相对引用）
      resolve(REPO_ROOT, raw),                          // ③ 仓库根（包级路径）
      resolve(SKILL_ROOT, 'scripts', raw),              // ④ 省略 `scripts/` 前缀的写法
      resolve(SKILL_ROOT, 'references', raw),           // ⑤ 省略 `references/` 前缀的写法
    ]
    if (candidates.some((c) => existsSync(c))) continue

    const head = raw.split('/')[0]
    // 跨技能（前缀白名单）
    const crossPrefix = CROSS_SKILL_PREFIXES.find(([pre]) => raw.startsWith(pre))
    if (crossPrefix) { crossSkill.push([token, from, crossPrefix[1]]); usedCross.add(crossPrefix[0]); continue }
    if (CROSS_SKILL_EXACT.has(raw)) { crossSkill.push([token, from, CROSS_SKILL_EXACT.get(raw)]); usedCross.add(raw); continue }
    // 墓碑（整串或按文件名后缀匹配）
    const tombKey = [...TOMBSTONES.keys()].find((k) => raw === k || raw.endsWith('/' + k))
    if (tombKey) { tomb.push([token, from, TOMBSTONES.get(tombKey)]); usedTomb.add(tombKey); continue }
    // 存疑
    if (SUSPECT.has(raw)) { suspect.push([token, from, SUSPECT.get(raw)]); usedSuspect.add(raw); continue }
    // 运行期产物（首段命中，且**不是**以本包顶层目录名伪装的真实路径）
    if (RUNTIME_ROOTS.has(head)) { runtime.push([token, from]); continue }

    broken.push([token, from, candidates])
  }

  return {
    files: files.length,
    refs: refs.size,
    broken,
    runtime,
    crossSkill,
    tomb,
    suspect,
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
  console.log(`\n=== 技能目录断链穷举（link-check）· ${SKILL_ROOT} ===`)
  console.log(`扫描 ${r.files} 个 .md，提取到 ${r.refs} 条路径型引用\n`)
  console.log(`· 在盘（技能根/相对/仓库根/省略前缀四种解析）：${r.refs - r.broken.length - r.runtime.length - r.crossSkill.length - r.tomb.length - r.suspect.length} 条`)
  console.log(`· 运行期产物（run/ final/ drafts/ audits/ analysis/ literature/ data/ cases/ case-studies/ memory/）：${r.runtime.length} 条`)
  console.log(`· 跨技能资源引用（属主 = dsh-plugin-guide / DSH 官方仓库）：${r.crossSkill.length} 条`)
  for (const [t, from, why] of r.crossSkill) console.log(`    - ${t}  ← ${from}（${why}）`)
  console.log(`· 墓碑式引用（历史上被有意删除，文档已注明）：${r.tomb.length} 条`)
  for (const [t, from, why] of r.tomb) console.log(`    - ${t}  ← ${from}（${why}）`)
  console.log(`· 存疑条目（放行但需人工收口）：${r.suspect.length} 条`)
  for (const [t, from, why] of r.suspect) console.log(`    ⚠ ${t}  ← ${from}\n        ${why}`)
  if (r.staleTomb.length) console.log(`\n⚠ 墓碑白名单未触发（可清理）：${r.staleTomb.join(', ')}`)
  if (r.staleCross.length) console.log(`⚠ 跨技能白名单未触发（可清理）：${r.staleCross.join(', ')}`)
  if (r.staleSuspect.length) console.log(`⚠ 存疑白名单未触发（可清理）：${r.staleSuspect.join(', ')}`)
  if (r.staleRuntime.length) console.log(`⚠ 运行期根未被任何引用命中：${r.staleRuntime.join(', ')}`)

  if (wantJson) console.log('\n' + JSON.stringify({ files: r.files, refs: r.refs, broken: r.broken.map(([t, f]) => ({ token: t, from: f })) }, null, 2))

  if (r.broken.length) {
    console.log(`\n✗ 未归类断链：${r.broken.length} 条（既不在盘，也不属于运行期产物 / 跨技能资源 / 墓碑 / 存疑任一类）`)
    for (const [t, from, cands] of r.broken) {
      console.log(`  - ${from} 引用了 \`${t}\`，但以下位置均不存在：`)
      for (const c of cands) console.log(`      ${c}`)
    }
    console.log('\n修法三选一：① 改文档指向真实文件；② 若是有意删除，登记进本脚本的 TOMBSTONES 并写明版本与理由；③ 若是跨技能资源，登记进 CROSS_SKILL_* 并写明属主。')
    process.exit(1)
  }
  console.log(`\n✓ 无未归类断链（存疑 ${r.suspect.length} 条见上方 ⚠，均为已上报的既存问题，不阻塞）`)
}
