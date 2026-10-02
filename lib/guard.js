// 机制文件写保护（C 组 · v18.1.0；v18.2.6 修 4 类绕过 + 基准错位）。
//
// 官方依据：`docs/subsystems/tools.md:313-324`
//   · `guard(guard: ToolGuard): () => void`；`ToolGuard = (execution) => string | undefined`；
//   · 返回值只会**收紧**权限（返回理由 = 否决，返回 undefined = 不改变），后面的监听器无法把它改回允许；
//   · 「A plain-context guard applies globally」——在插件（profile 级）ctx 上注册即全局生效。
//
// ⚠️ **边界（如实声明，不许夸大）**：
//   ① guard 只看**工具调用**。本包主流程里 `pwsh` 仍可以写文件（官方对子进程的围栏是部署级
//      `ctx.sandbox` 后端 / `sandbox/mode`，插件改不了别人的 profile）；官方也**没有** per-path 只读声明，
//      `fs/write-intent` 没有 deny 返回值。故本保护是「**比 prompt 强、比机制强制弱**」的部分强制。
//   ② 授权例外：主人显式授权修订机制文件时，在**宿主环境**设 `LUNHENG_ALLOW_MECH_EDIT=1`，或在本插件行的
//      `config` 里写 `allowMechanismEdit: true`（v18.2.6 起 Config 真的存在了——旧版 guard.js 注释声称
//      有这个「Config 同名开关」，而入口当时根本不接 config，属**文档承诺未实装**，本次一并修掉）。
//   ③ 只覆盖常见写工具名（不同版本的写工具名可能不同，故用集合匹配 + 参数键名匹配，宁松勿误伤）。
//
// ── v18.2.6 修复的四类绕过（均有可复现用例，见 tests/guard.test.mjs）────────────────
//   ① **相对路径基准错位（最严重）**：旧实现用 `resolve(raw)`，基准是**宿主进程的 `process.cwd()`**；
//      而真正的写工具（`write`/`edit`）把相对路径解析到**会话工作区** `exec.agent.session.header.cwd`
//      （官方 `dsh-tool-fs/lib/index.js:225-242,655,804`：注释原文「so each session's
//      `read`/`write`/`edit` act on its workspace, not the server's launch directory」）。
//      两者不等时（DSH Desktop / `dsh web` 的常态），`skills/<name>/SKILL.md` 这类相对路径在 guard 眼里
//      落到进程 cwd 下（不在受保护根内）→ **直接放行**，而实际写的正是受保护文件。
//      → 现改为：**对「会话工作区」与「进程 cwd」两个基准都判**（取并集 = 只收紧不放宽），
//        会话工作区从 `execution.agent.session.header.cwd` 取，与 fs 工具同源。
//   ② **路径拼写变体**：`e:/…`（小写盘符）、`\\?\E:\…`（长路径前缀）旧实现按字符串前缀比较 → 放行。
//      → 现统一 `canon()`：剥长路径前缀、盘符大写、`realpath` 解析软链接/junction、比较时忽略大小写。
//   ③ **参数形态漏检**：旧 `writtenPath()` 只对**数组**递归，不递归普通对象 → `{edits:{file:{file_path}}}`
//      这类二层嵌套放行；apply_patch 类工具的路径藏在**补丁文本**里，旧实现完全看不到。
//      → 现改为**深度遍历**（对象/数组，带深度上限）+ 从补丁/正文类字段里提取 `*** Update File:` /
//        `+++ b/…` / `--- a/…` 形态的路径。
//   ④ **受保护根取错对象**：旧实现保护的是**本包安装目录里的**技能副本，而本包文档反复强调
//      「项目级副本（rank 100）会静默顶替 bundle（rank 250）」——于是「装了 bundle 又留 .dsh/skills 副本」
//      的部署下，guard 保护的是没人读的那一份。→ 现由 `lib/index.js` 把 resourceBase 与**当前生效路径**
//      一并传入（见 `mechanismRoots` 的推导），并在装包布局下不再登记不存在的仓库根 `scripts/`。
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

// P1-1（v18.62.5 全量审计-性能与安全）：扩 `WRITE_TOOLS` 与 `PATH_KEYS` 收掉三类可复现绕过：
//   ① 数字键位参 `{"0":path}`（位置参数形态）——旧实现只按已知键名收，数字键位参既不命中
//      `PATH_KEYS`（无键名形态）又会被「`v` 是 string 时进 `PATH_KEYS.some(...)` 分支但 lower
//      比对必失败」分支略过 → 静默漏检。
//   ② 路径键名变体 `targetPath` / `pathToFile` / `absolute_path` 等常见命名 —— 未进 `PATH_KEYS`。
//   ③ 写工具名变体 `write_file` / `create_file` / `notebook_edit` / `fs_write` 等 —— 未进 `WRITE_TOOLS`。
// 当前 DSH 宿主的写工具名与参数键恰好落在集合内、**实际不可利用**；本次按报告建议做防御性加固。
const WRITE_TOOLS = new Set([
  // v18.4 / v18.16.0 / v18.18.0 已覆盖
  'write', 'edit', 'apply_patch', 'str_replace_editor', 'str-replace-editor', 'str_replace', 'multi_edit',
  // v18.62.5 新增（v18.62.4 全量审计-性能与安全 §P1-1 修复）
  'write_file', 'create_file', 'notebook_edit', 'fs_write', 'file_write', 'save_file',
])
const PATH_KEYS = [
  // v18.4 已覆盖
  'path', 'file_path', 'filePath', 'target', 'filename', 'file', 'target_file',
  // v18.62.5 新增
  'targetPath', 'target_path', 'pathToFile', 'path_to_file', 'absolute_path', 'absolutePath',
  'destination', 'dest', 'destPath', 'dest_path', 'outputPath', 'output_path',
  'resourcePath', 'resource_path', 'filepath',
]
/** 「内容类键」白名单——这些键的字符串值**不是路径**（旧实现误把它们当路径候选）。
 *  P1-1 修复：「数字键位参 + 绝对路径值」的兜底分支判定时，键名在此集合内的**不视为路径**。 */
const CONTENT_KEYS = new Set([
  'content', 'text', 'old_string', 'new_string', 'oldString', 'newString',
  'body', 'data', 'value', 'message', 'description', 'comment', 'comments',
  'prompt', 'system', 'assistant', 'user', 'role', 'name',
  'old_text', 'new_text', 'oldText', 'newText',
  'src', 'source', 'url', 'uri', 'href',  // 新 form: 视为内容/URL 而非文件路径
  'input', 'arguments', 'args', 'kwargs',
  'pattern', 'regex', 'glob', 'selector', 'query', 'filter', 'sort',
  'encoding', 'format', 'mode', 'level', 'tag', 'tags',
])
/** 需要从「文本载荷」里抽路径的键名（补丁/diff 类工具的路径藏在正文里）。 */
const PAYLOAD_KEYS = new Set(['patch', 'input', 'diff', 'difftext', 'patchtext', 'payload'])
/** 补丁文本里的路径形态：apply_patch（`*** Update File: x`）与 unified diff（`+++ b/x` / `--- a/x`）。 */
const PATCH_PATH_RES = [
  // v18.16.0（B-3 反哺）：原 `(?:Update|Add|Delete|Move to)\s+File:` 把 `*** Move to: x`（重命名语法）
  //   排除在外，而**重命名也是一种写**——攻击者可借此把受保护文件改名覆盖。现拆为两条：
  //   - `*** Update/Add/Delete File: x` 三种修改路径
  //   - `*** Move to: x` 单独捕获重命名路径
  /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+?)\s*$/gim,
  /^\*\*\*\s+Move to:\s*(.+?)\s*$/gim,
  /^(?:\+\+\+|---)\s+([ab]\/.+?)\s*$/gim,
]
/** 深度遍历上限：防畸形/深递归参数把 guard 拖死（v18.16.0 起 B-5 修：超限 → 拒绝）。 */
const MAX_DEPTH = 6
/** 超深度的哨兵值：与 `out: []` 区分，调用点据此识别「应拒绝」语义。 */
const SENTINEL_DEPTH_EXCEEDED = Symbol('depth_exceeded')
/** realpath 向上找「最近存在祖先」的层数上限。 */
const MAX_ANCESTOR_HOPS = 32

/** 取「最近存在的祖先」的真实路径，再把剩余段拼回去（路径本身可能还不存在）。 */
function realpathBest(p) {
  let cur = p
  const tail = []
  for (let i = 0; i < MAX_ANCESTOR_HOPS; i++) {
    if (existsSync(cur)) {
      let real = cur
      try { real = realpathSync.native(cur) } catch { /* 权限/竞态：退回原路径 */ }
      return tail.length ? join(real, ...tail.reverse()) : real
    }
    const up = dirname(cur)
    if (up === cur) break
    tail.push(cur.slice(up.length).replace(/^[\\/]+/, ''))
    cur = up
  }
  return p
}

/**
 * 把任意路径写法归一到「可比较」的绝对路径：
 * 剥 Windows 长路径前缀（`\\?\` / `\\?\UNC\`）→ 相对路径按 base 解析 → 盘符大写 →
 * realpath（解软链接/junction/8.3 短名）→ 统一分隔符 → 小写（Windows 路径大小写不敏感）。
 * @param raw - 原始路径字符串（可能是相对路径、含 `..`、含长路径前缀）。
 * @param base - 相对路径的解析基准（会话工作区或进程 cwd）。
 * @returns 归一后的比较键；无法解析（空串/非字符串）返回 null。
 */
export function canonicalPath(raw, base) {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null
  // 长路径前缀：UNC 形态必须先认（`\\?\UNC\server\share` → `\\server\share`）
  if (/^\\\\\?\\UNC\\/i.test(s)) s = `\\\\${s.slice(8)}`
  else if (s.startsWith('\\\\?\\')) s = s.slice(4)
  if (!isAbsolute(s)) s = resolve(base || process.cwd(), s)
  s = s.replace(/\//g, sep)
  s = s.replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`)
  s = realpathBest(s)
  s = s.replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`)
  return s.toLowerCase()
}

/** 收集「可能是被写路径」的字符串：先按已知键名取，再深度遍历兜底；补丁类字段另抽路径。 */
function writtenPaths(args, depth = 0, out = []) {
  // v18.16.0（B-5 反哺）：原 `depth > MAX_DEPTH` 静默返回空数组 → 7 层嵌套参数被当作「无路径」放行。
  //   现超限抛一个特殊对象，由调用点识别后**拒绝并返回理由**（符合 guard「只收紧」语义——
  //   「未知深度参数，无法判定路径 → 拒绝」）。`return out` 保留以兼容递归调用，但需 sentinel 同步。
  if (args === null || args === undefined) return out
  if (depth > MAX_DEPTH) return SENTINEL_DEPTH_EXCEEDED
  if (typeof args === 'string') { out.push(args); return out }
  if (Array.isArray(args)) {
    for (const item of args) writtenPaths(item, depth + 1, out)
    return out
  }
  if (typeof args !== 'object') return out
  for (const [k, v] of Object.entries(args)) {
    const lower = k.toLowerCase()
    if (typeof v === 'string' && v.trim()) {
      // P1-1（v18.62.5 全量审计-性能与安全）：三处加固——
      //   ① 数字键位参 / 顶层 string 值 + 键名不在「内容类键」白名单 + 形如绝对路径：
      //      一并纳入候选。旧实现仅按 `PATH_KEYS` 键名比对，数字键 / `targetPath` /
      //      `absolute_path` 等都绕开。
      //   ② `PATH_KEYS` 名单扩面：`targetPath` / `pathToFile` / `absolute_path` 等常见变体
      //      已上表（声明见上）。
      //   ③ 顶层 + 相对路径 → **不**走此分支（会被 resolve(base) 解析到任何工作区下，
      //      误伤合法相对路径参数如 `file: 'foo.md'` 当 read 入参）—— 相对路径走深度递归
      //      兜底（`writtenPaths` 进 `args` 字段的子对象 / 数组时被递归处理）。
      const isNumericKey = /^(0|[1-9]\d*)$/.test(k)
      const knownPathKey = PATH_KEYS.some((p) => p.toLowerCase() === lower)
      if (knownPathKey) {
        out.push(v.trim())
      } else if (isNumericKey && isAbsolute(v.trim())) {
        // 数字键位参：仅当值是**绝对路径**才视为路径候选。
        //   位置参数顺序约定：本包 `write` 类工具**位置参不存在**（一律键名），故数字键形态
        //   实为「第三方宿主传 args[0]=path」的非常规形态——宁严勿纵。
        out.push(v.trim())
      } else if (
        // v18.16.0（B-4 反哺）：原 `PAYLOAD_KEYS.has(lower)` 仅命中 6 个全名；常见变体如
        //   `patchContent` / `patch_text` / `patchText` / `diffText` 全部绕过。现改为「键名包含
        //   `patch` 或 `diff` 子串」即命中，并保留原 6 个全名作为强匹配集合（防误判其它无关键）。
        // v18.18.0（F-4 反哺 · 修 B-4 自身的缺陷）：首版写成 `/\b(patch|diff)\b/i` —— `\b` 是
        //   **词边界**，而 `patchContent` 里 `h`→`C` 两侧都是词字符、**不存在词边界**，于是这条
        //   恰好对该修复点名的 `patchContent` / `patchText` / `diffText` **全部失效**（只有
        //   `patch_text` 这类带分隔符的才命中）。现改纯 `includes` 子串判定——键名含 `patch`/`diff`
        //   本就是弱命名约定，宁松勿误伤（误判代价 = 多扫一遍补丁文本，无假否决）。
        PAYLOAD_KEYS.has(lower) || lower.includes('patch') || lower.includes('diff')
      ) {
        for (const re of PATCH_PATH_RES) {
          re.lastIndex = 0
          for (const m of v.matchAll(re)) {
            // unified diff 的 `b/x` / `a/x` 前缀只是 diff 惯例，不是真实目录名
            const raw = m[1].replace(/^[ab]\//, '')
            out.push(raw.trim())
          }
        }
      }
      // 顶层兜底：键名不在 PATH_KEYS、不是数字键、不是 patch/diff；值为绝对路径；
      //   且键名不在「内容类键」白名单 → 视为可疑路径候选（防御性收紧）。
      //   边界：「内容类键」白名单（CONTENT_KEYS）显式声明**不能**被判定为路径的键名集合，
      //   把 `content`/`text`/`old_string`/`new_string`/`url`/`source` 等常见内容键排除；
      //   防止「合法非路径字符串被误判为路径」造成假否决。
      else if (
        depth === 0
        && isAbsolute(v.trim())
        && !CONTENT_KEYS.has(k)
        && !CONTENT_KEYS.has(lower)
      ) {
        out.push(v.trim())
      }
    } else if (v && typeof v === 'object') {
      const r = writtenPaths(v, depth + 1, out)
      if (r === SENTINEL_DEPTH_EXCEEDED) return r
    }
  }
  return out
}

/**
 * 「同名技能的其它落点」——按官方 rank 表（`docs/subsystems/skills`）把**副本可能所在的位置**也算进受保护根。
 *
 * 为什么必须加（审计 B-6 后半）：本包文档反复强调「项目级副本（rank 100）会**静默顶替** bundle（rank 250）」。
 * 只保护包内那一份，等于保护了一份**没人读**的文件，而真正生效的副本没有任何机制保护。
 * 由于 guard 回调是**同步**的（ToolGuard 契约），这里不用 `skills.list()`，而是直接按官方 rank 表推导
 * 四个已知落点（100 / 200 / 400 / 500），零 await、零 IO（canonicalPath 内部按需 realpath）。
 * @param sessionCwd - 当前会话工作区（来自 `execution.agent.session.header.cwd`）。
 * @param skillName - 本技能名（目录名 = 技能名，官方 kebab-case 约定）。
 * @returns 候选根路径数组（未做存在性过滤，canonicalPath 会处理）。
 */
function mirrorRoots(sessionCwd, skillName) {
  if (!skillName || typeof sessionCwd !== 'string' || !sessionCwd.trim()) return []
  const root = sessionCwd.trim()
  const out = [
    join(root, '.dsh', 'skills', skillName),    // rank 100 project-dsh
    join(root, '.agents', 'skills', skillName), // rank 200 project-agents
  ]
  const dshHome = process.env.DSH_HOME
  if (typeof dshHome === 'string' && dshHome.trim()) out.push(join(dshHome.trim(), 'skills', skillName)) // rank 400
  const agentsHome = process.env.AGENTS_HOME
  if (typeof agentsHome === 'string' && agentsHome.trim()) out.push(join(agentsHome.trim(), 'skills', skillName)) // rank 500
  return out
}

/** 相对路径的候选解析基准：会话工作区（与 fs 工具同源）优先，进程 cwd 兜底；两者都判。 */
function resolutionBases(execution) {
  const bases = []
  const sessionCwd = execution?.agent?.session?.header?.cwd
  if (typeof sessionCwd === 'string' && sessionCwd.trim()) bases.push(sessionCwd.trim())
  const cwd = process.cwd()
  if (!bases.includes(cwd)) bases.push(cwd)
  return bases
}

const inside = (abs, root) => abs === root || abs.startsWith(root.endsWith(sep) ? root : root + sep)

/**
 * 安装机制文件写保护。返回 disposer（未安装时返回 undefined）。
 * @param ctx - 插件 ctx（profile 级 → 全局 guard）。
 * @param opts.mechanismRoots - 受保护路径（绝对）：技能目录（含**当前生效**的那一份）+ 包级 patch + 入口目录。
 * @param opts.skillName - 本技能名：用于把「同名技能的其它落点（rank 100/200/400/500）」动态纳入受保护根（v18.2.6）。
 * @param opts.allowed - () => boolean：主人授权时为 true（env 或插件 Config）。
 */
export function installMechanismGuard(ctx, { mechanismRoots, skillName, allowed, report } = {}) {
  // v18.57.x（审计修订 P2）：**降级必须可观察**。旧版两条提前返回都**静默**——宿主没提供
  //   `tools.guard` 时既不 warn 也不 info，部署者会以为机制写保护已生效（实测该分支零日志）。
  //   与 tools.js「取不到 defineTool 时打一行 warn」的口径对齐。
  const tools = ctx.get('tools')
  if (!tools?.guard) {
    report?.('warn', '· 论衡机制文件写保护**未安装**：宿主未提供 `tools.guard` 服务——write/edit 类工具不会被本插件否决（技能与流水线不受影响）');
    return undefined
  }
  const roots = [...new Set(mechanismRoots
    .filter(Boolean)
    .map((r) => canonicalPath(r, process.cwd()))
    .filter(Boolean))]
  if (roots.length === 0) {
    report?.('warn', '· 论衡机制文件写保护**未安装**：受保护根解析为空——无可保护的机制文件路径');
    return undefined
  }
  return tools.guard((execution) => {
    try {
      if (allowed?.()) return undefined
      // v18.16.0（B-2 反哺）：原 `WRITE_TOOLS.has(name)` 大小写敏感，宿主某些包装工具传
      //   `Write`/`EDIT`/`Apply_Patch` 等大写形态时绕过守卫。现统一 lower 后比对。
      const name = String(execution?.name || '').toLowerCase()
      if (!WRITE_TOOLS.has(name)) return undefined
      const cands = writtenPaths(execution?.arguments)
      // v18.16.0（B-5 反哺 · 收尾）：识别「超深度哨兵」→ 拒绝并返回理由，宁严勿纵。
      if (cands === SENTINEL_DEPTH_EXCEEDED) {
        return (
          `论衡机制文件写保护：参数嵌套深度超过 ${MAX_DEPTH} 层，无法判定被写路径——` +
          `按 guard「只收紧」语义拒绝本次调用。改进动议请写入 audits/反哺报告-vN.md。`
        )
      }
      if (cands.length === 0) {
        // P1-1（v18.62.5 全量审计-性能与安全）：写工具命中但**收不到任何候选路径** → 「静默不设防」形态。
        //   报告 §P1-1 建议改 warn 上报，避免安全控制静默失效。
        //   **降噪边界（实测驱动）**：仅当参数含**非内容类键**（即调用方明显**意图传路径**但守卫未识别
        //   出候选键）时才 warn。`{content:'xxx', mode:'w'}` 这类纯内容参数**不**让判「可疑绕过」——它们
        //   没有路径是因为**不需要**（如 `write` 走 `data:` 形式、或宿主在另一参数通道带路径）。
        //   判据：参数键中存在 ∉ `CONTENT_KEYS`（不区分大小写）即视为「有路径意图」。
        const args = execution?.arguments
        const allContent = args && typeof args === 'object' && Object.keys(args).length > 0
          && Object.keys(args).every((k) => CONTENT_KEYS.has(k) || CONTENT_KEYS.has(k.toLowerCase()))
        const hasArgs = args && (typeof args === 'object' ? Object.keys(args).length > 0 : true)
        if (hasArgs && !allContent) {
          try { report?.('warn', '· 论衡机制文件写保护：写工具 `' + name + '` 未识别出候选路径——可能为键名/工具名变体绕过（v18.62.5 §P1-1），按「无候选 → 不否决」放行。改进动议请写入 audits/反哺报告-vN.md，或在 lib/guard.js 的 WRITE_TOOLS/PATH_KEYS 加项。') } catch { /* report 不可用时不二次抛 */ }
        }
        return undefined
      }
      const bases = resolutionBases(execution)
      // 静态根（本包安装目录）+ 动态根（同名技能的其它落点，按会话工作区推导）
      const sessionCwd = execution?.agent?.session?.header?.cwd
      const activeRoots = [...roots, ...mirrorRoots(sessionCwd, skillName)
        .map((r) => canonicalPath(r, sessionCwd || process.cwd()))
        .filter(Boolean)]
      for (const base of bases) {
        for (const raw of cands) {
          const abs = canonicalPath(raw, base)
          if (!abs) continue
          const hit = activeRoots.find((r) => inside(abs, r))
          if (!hit) continue
          return (
            `论衡机制文件写保护（v18.1.0 起为机制级否决；v18.2.6 修基准错位与路径变体绕过）：` +
            `${raw} → ${abs} 位于技能包内（受保护根：${hit}），主控与子代理默认均不得写入。` +
            '改进动议请写入 audits/反哺报告-vN.md，由主人在 host shell 审阅后 apply；' +
            '若主人已显式授权本次修订，请在宿主环境设 LUNHENG_ALLOW_MECH_EDIT=1 或在本插件行 config 写 allowMechanismEdit: true 后重试。' +
            '（提示：本保护只覆盖 write/edit 类工具的**工具调用**，pwsh/子进程不经此门——见 SKILL.md §执行能力边界）'
          )
        }
      }
      return undefined
    } catch (e) {
      // P1-2（v18.62.5 全量审计-性能与安全）：旧版静默 fail-open（return undefined，无日志）
      //   ——「安全控制失效且无告警」是公认的高危形态。保留 fail-open（避免误伤合法调用），
      //   但必须留痕：catch 分支调用 `report?.('warn', …)` 输出「守卫判定异常，本次调用未被检查」，
      //   与 `lib/index.js:192-198` 已确立的「降级必须可观察」口径一致。
      try { report?.('warn', `· 论衡机制文件写保护：守卫判定异常（${String(e?.message || e).slice(0, 120)}）——本次调用未被检查，按 fail-open 放行。改进动议请写入 audits/反哺报告-vN.md。`) } catch { /* report 自身不可用时不二次抛 */ }
      return undefined // guard 自身异常不改变权限（宁松勿误伤）
    }
  })
}
