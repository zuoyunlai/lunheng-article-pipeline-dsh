// lunheng-article-pipeline bundle entry point.
//
// Registers the packaged pipeline knowledge base as one on-demand agent skill
// named `lunheng-article-pipeline`. The skill body is the packaged SKILL.md;
// its relative references (`references/**`, `scripts/**`) resolve against the
// skill directory through the directory resourceBase, so role cards,
// templates, and gate scripts load only when a task needs them (progressive
// disclosure).
//
// The package imports nothing from the harness: it only consumes the `skills`
// service at apply time, so no cordis copy is brought in and the peer
// dependency on `@deepseek-ai/dsh` is metadata-only (optional).
//
// Layout note: this repository keeps the skill body under `skills/<name>/`
// (the bundle is the repository, the skill is one directory inside it). The
// entry therefore resolves the skill directory explicitly instead of assuming
// the package root is the skill root.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'   // H2 标记消息的 `id`（v18.76.0 · R1 修复：宿主 inbox 以 id 判重）
import { registerPanel } from './panel.mjs'   // v18.90.0（B 批）：运行面板宿主半边（只读 HTTP 路由 + SSE）

export const name = 'lunheng-article-pipeline'
export const inject = ['skills']

/**
 * 插件配置（v18.2.6 新增）。
 *
 * 为什么之前没有（第三方审计 Blocker B-3/B-7）：入口只写了 `apply(ctx)`——但 Cordis 的
 * `resolveConfig()`（`@deepseek-ai/cordis/lib/index.js:955-961`）在插件**没有** `Config` 时会把原始 config
 * **原样传入**，`fiber` 也照传第二参数（同文件 `:1067/:1070`）。也就是说：用户在 profile 补丁里写
 * `config: {…}` 会被 loader 接受、却**被入口静默丢弃**——正是本包最反感的「静默失效」。
 * 同时官方红线「不得硬编码可调参数（判据：`cordis.yml` 能否改它）」与 `dsh-plugin-dev check` 的
 * `redline-no-hardcoded-tunables` 都要求声明 Config；没有它，那条门对本包只能 skip（等于永久失效）。
 *
 * 为什么**不用** `@deepseek-ai/schemastery`（与官方文档的字面写法不同，这是刻意的）：
 *   ① 本包的核心设计约束是「入口不 import 宿主包」——静态依赖会让裸仓库/最小宿主**入口 import 失败
 *      → 技能也不注册**（v18.0.0 缺陷形态，教训 #154）；
 *   ② **动态 import 也不行**：宿主用 **pnpm** 安装（`dsh plugin add` 走 pnpm），pnpm 只为**已声明**的依赖
 *      建私有 `node_modules` 链接，而 `@deepseek-ai/schemastery` 不在本包依赖表里 →
 *      `import('@deepseek-ai/schemastery')` 在 pnpm 布局下解析不到。**实测**：即便把包按 profile 布局
 *      放好（`node_modules/lunheng-article-pipeline` + `node_modules/@deepseek-ai/schemastery`），
 *      经 junction/symlink 后 Node 按 **realpath** 向上找依赖，仍然找不到 → Config 恒为 undefined。
 *   ③ Cordis 需要的其实只有 **standard-schema 接口**：`Config['~standard'].validate(config)` 返回
 *      `{value}` 或 `{issues:[{message,path}]}`（`cordis/lib/index.js:955-961`；issue 形态见
 *      `ValidationError`，同文件 `:932-945`）。自己实现这 20 行即可**零依赖**拿到
 *      「加载期校验 + 响亮失败 + `--dump-config` 可见」，且不引入任何宿主依赖。
 *
 * 环境变量与 Config 的关系：env 是**操作者开关**（主人授权、CI 静音），Config 是**部署开关**（profile 补丁）。
 * 两者并存时取「或」——host env 用来在不动 profile 的前提下临时放宽/静音。
 */
const CONFIG_SPEC = Object.freeze({
  allowMechanismEdit: { kind: 'boolean', def: false, why: '等价 LUNHENG_ALLOW_MECH_EDIT=1：放行机制文件写入（主人授权动作）' },
  quiet: { kind: 'boolean', def: false, why: '等价 LUNHENG_QUIET=1：静音 info 级状态行（warn 永不静音）' },
  scriptTimeoutMs: { kind: 'positive', def: 120000, why: '原生工具跑随包脚本的超时（此前**没有**超时，脚本挂起会占住工具调用）' },
  scriptMaxOutputBytes: { kind: 'positive', def: 4 * 1024 * 1024, why: '单次脚本 stdout/stderr 采集上限（此前无界缓冲）' },
  handoffLevel: { kind: 'enum', def: 'basic', values: ['basic', 'strict'], why: '交接门灰度开关（v18.6.0）：basic 只验 A1/A2/B1（存在/非空/回报六要素），strict 加结构/版本/成对/agents-log' },
  hookRewriteContent: { kind: 'boolean', def: false, why: 'H2 伦理脱敏监听器（v18.62.5 全量审计-性能与安全 P0-2 定默认值；本批修复改**载体**）：默认 false = 「只标记不改写」——标记经 `decision.additionalContexts`（宿主 `tools/post-execute` **唯一采纳**的插件副通道）作为一行摘要进下一轮上下文；true = 用脱敏后正文替换工具结果的 content（走 `decision.content`；v18.62.4 旧默认行为，会误伤时间戳/订单 ID 等普通文本，**不建议**）。**键名与语义保持不变，只改载体**——旧载体（写 `result.*`）在真宿主上必失效（result 深冻 + 白名单投影，见 lib/index.js 的 H2 监听器注释）。**版本细节见 CHANGELOG 与 `audits/核实报告-v18.75.1-全量架构审计-2026-10-04.md`。**' },
  hookMaxBlockChars: { kind: 'positive', def: 262144, why: 'H2 监听器对单个 text 块的脱敏上限（v18.62.5 全量审计-性能与安全 P2-2 修复）：默认 262144 = 256 KB。超此大小的块**跳过脱敏改写**（仅注入 skipped 元数据），避免在不可控体积上同步占用「原文 + 脱敏副本」两份内存。' },
  ethicsHook: { kind: 'boolean', def: true, why: 'H2 伦理脱敏监听器**总开关**（v18.80.0 新增）。默认 true。置 false = 本会话完全不扫、不注入伦理标记。**为什么必须给开关**：该监听器对材料类工具的**每个** text 块无条件跑 basic 模式，而实测它对技术文档的命中率是「**person 全部为低置信、无一是真人姓名**」（见 CHANGELOG 本版段的实测数字）——纯代码审计与文档工作流里它只产出噪声。默认 true 是因为伦理脱敏是**合规能力**，不能因噎废食；但操作者必须有办法关掉它。' },
  panel: { kind: 'boolean', def: false, why: '运行面板（v18.90.0 新增，B 批）：等价 LUNHENG_PANEL=1。**默认 false = 不注册任何 HTTP 路由**——面板在 `ctx.webServer` 上新增一个**只读读面**（`/lunheng-panel/*`，可读 `<工作区>/run/**` 已存在的运行产物：status.md / 门摘要 / 产物清单），随载体监听地址暴露给能访问该地址的人（本机默认回环 127.0.0.1）。按本仓既有口径（新增暴露面**默认关、配置即开**，同三档 subagent 工具的先例），要看得显式打开。' },
})

/** 默认值（文档与测试引用此处；改这里即改默认）。 */
export const CONFIG_DEFAULTS = Object.freeze(
  Object.fromEntries(Object.entries(CONFIG_SPEC).map(([k, v]) => [k, v.def])),
)

const ENV_TRUE = (v) => v === '1' || v === 'true'

/**
 * standard-schema v1 形态的校验：合法 → `{value}`（已填默认值）；非法 → `{issues}`（交给 Cordis 抛 ValidationError）。
 * 非法配置**响亮失败**，不静默回落默认值——静默降级正是本包反复记录的缺陷形态。
 * @param config - loader 传入的原始配置（可为 undefined）。
 * @returns `{value}` 或 `{issues}`（与 standard-schema 契约一致，**同步**）。
 */
function validateConfig(config) {
  if (config !== undefined && (typeof config !== 'object' || config === null || Array.isArray(config))) {
    return { issues: [{ message: `论衡插件 config 必须是对象，收到 ${Array.isArray(config) ? 'array' : typeof config}` }] }
  }
  const raw = config ?? {}
  const issues = []
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(CONFIG_SPEC, key)) {
      issues.push({ message: `不认识的配置键 "${key}"（可用：${Object.keys(CONFIG_SPEC).join(' / ')}）`, path: [key] })
    }
  }
  const value = { ...CONFIG_DEFAULTS }
  for (const [key, spec] of Object.entries(CONFIG_SPEC)) {
    if (!Object.hasOwn(raw, key)) continue
    const v = raw[key]
    if (spec.kind === 'boolean') {
      if (typeof v !== 'boolean') issues.push({ message: `config.${key} 必须是 boolean，收到 ${typeof v}`, path: [key] })
      else value[key] = v
    } else if (spec.kind === 'enum') {
      if (!spec.values.includes(v)) issues.push({ message: `config.${key} 必须是 ${spec.values.join(' / ')} 之一，收到 ${String(v)}`, path: [key] })
      else value[key] = v
    } else {
      // v18.69.0（批 6-A · P2 修复）：**先取整再判**。旧版先 `v <= 0` 再 `Math.floor`，
      //   0 < v < 1（如 0.5）通过检查后被静默规整为 0 → 下游 tools.js 把 0 视为
      //   「无超时/无上限」——配置者写的限流值被静默变成解除限流。
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.floor(v) < 1) issues.push({ message: `config.${key} 必须是正整数（≥1，向下取整后不得为 0），收到 ${String(v)}`, path: [key] })
      else value[key] = Math.floor(v)
    }
  }
  return issues.length ? { issues } : { value }
}

export const Config = Object.freeze({
  '~standard': Object.freeze({ version: 1, vendor: 'lunheng-article-pipeline', validate: validateConfig }),
})

/**
 * 供 `apply()` 与测试使用的规范化入口：与 `Config['~standard'].validate` 同源，非法即抛。
 * （宿主经 `ctx.plugin(entry, config)` 加载时 Cordis 已校验一次；这里再校验是为「直接调用 apply」的路径兜底。）
 * @param config - 原始配置。
 * @returns 规范化后的配置对象。
 * @throws 当配置项非法时（消息列出全部 issue）。
 */
export function resolveConfig(config) {
  const result = validateConfig(config)
  if (result.issues) {
    throw new TypeError('论衡插件 config 非法：\n' + result.issues.map((i) => `  - ${i.message}`).join('\n'))
  }
  return result.value
}

/** Package root: this file lives in `lib/`, so the root is one level up.
 * (The entry MUST live in a directory listed in the package `files` whitelist —
 * the packaging checks require a built-artifact directory. Moving this file
 * without adjusting the relative path below makes `readFileSync` throw ENOENT
 * at apply time, which no static check can catch: only a runtime smoke test can.
 * That failure mode is covered by `tests/entry.test.mjs`.)
 */
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillDir = join(packageRoot, 'skills', 'lunheng-article-pipeline')

/**
 * Split the YAML frontmatter block from SKILL.md into routing fields and body.
 * A malformed or missing block falls back to the full text as the body and an
 * empty field map, so the registration still succeeds with its fallback copy.
 *
 * v18.2.4（审计 C.1）：行尾与 BOM 归一后再解析。此前用 `text.startsWith('---\n')`
 * 判定，而 `readFileSync(p, 'utf8')` **不做行尾归一**——SKILL.md 一旦是 CRLF 行尾
 * （Windows `core.autocrlf=true` 检出、或编辑器另存为 CRLF），首行是 `---\r\n`，
 * 判定为假 → frontmatter 整块**静默**退化成内置兜底描述，而 description/whenToUse
 * 恰是模型侧路由的唯一依据（`whenToUse` 丢失后连注册字段都会消失），静态门全绿也照样漏过。
 * @param text - raw SKILL.md content.
 * @returns parsed routing fields (present keys only), the instruction body, and
 *   whether the frontmatter block was actually recognized.
 */
function splitFrontmatter(text) {
  // 行尾归一（CRLF / 孤立 CR → LF）+ 去 BOM：两者都只影响解析，不影响正文语义。
  const norm = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  // 首行必须是 `---`，且必须有**成行**的闭合 `---`（缺闭合 = 未解析，不猜）。
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(norm)
  if (!match) return { fields: {}, body: norm, parsed: false }
  const meta = match[1]
  const body = norm.slice(match[0].length).replace(/^\n+/, '')
  const read = (key) => {
    const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(meta)
    return match?.[1]?.trim().replace(/^["']|["']$/g, '')
  }
  return {
    fields: { name: read('name'), description: read('description'), whenToUse: read('whenToUse') },
    body,
    parsed: true,
  }
}

/**
 * Build the entry's status reporter (v18.2.4，审计 C.3).
 *
 * 宿主带 Cordis `logger` 时走正规日志面，否则退回 `console.error`。此前 3 条
 * 「已注册 / 已启用」状态行**无条件**写 stderr，宿主每次启动都刷屏，而这些信息本就
 * 只对宿主日志有用。口径：`info`（成功）可被 `LUNHENG_QUIET=1` 静音；`warn`（降级 / 失败）
 * **不静音**——「静默降级」正是 v18.0.0 事故的形态，必须始终可见。
 * @param ctx - the plugin context (minimal hosts may carry no logger).
 * @param quiet - `true` 时静音 info 级（来自 Config.quiet 或 LUNHENG_QUIET，v18.2.6 起 Config 也生效）。
 * @returns a `(level, message) => void` reporter bound to this context.
 */
function makeReporter(ctx, quiet = false) {
  const logger = ctx?.logger
  const silent = quiet || ENV_TRUE(process.env.LUNHENG_QUIET)
  return (level, message) => {
    if (level === 'info' && silent) return
    if (logger && typeof logger[level] === 'function') logger[level](message)
    else console.error(message) // 宿主无日志面时不丢信息（宁可见勿静默）
  }
}

/**
 * 本包版本（三次复审 N-1③）：启动状态行**带上版本号**——「装错了要看得见」。
 *
 * 为什么（实测）：文档的安装命令可能装到**陈旧 5 个版本**的构建（本机 pnpm 解析状态所致：
 *   同一命令装到 18.15.0，而 registry `latest` 已是 18.20.4），而此前**没有任何一步能让人察觉**
 *   —— 入口只打技能名、不打版本，文档也没有版本核对步骤。加这一行后，`dsh` 启动日志即可自证版本。
 * 边界（如实）：读的是**随包 `package.json`**（包根），不是 profile 里的安装记录——同一次安装里两者必然
 *   一致；若 profile 内被手工替换，本行如实反映替换后的值。读不到时回 `unknown`（不抛，启动不受影响）。
 * @returns {string} 版本号，或 `'unknown'`。
 */
function readPackageVersion() {
  try {
    return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Register the pipeline skill. Registration is an effect: the disposer
 * returned by `ctx.skills.register()` removes the contribution on unload.
 * @param ctx - Cordis context; the injected `skills` service is the hard
 *   dependency (its absence is a host-contract violation: it is reported and
 *   skipped, never a TypeError), while the C-group services stay optional.
 * @param config - loader 传入的插件配置（v18.2.6 起**真的被消费**了）。
 *   旧版签名是 `apply(ctx)`，而 Cordis 在插件无 `Config` 时会**原样传第二参数**
 *   （`cordis/lib/index.js:1067/:1070`）——于是 profile 补丁里的 `config:` 被静默丢弃。
 *   非法配置在 `resolveConfig()` 里**抛错**（加载期响亮失败），不静默回落默认值。
 */
export function apply(ctx, config) {
  const cfg = resolveConfig(config)
  const say = makeReporter(ctx, cfg.quiet)
  const skillPath = join(skillDir, 'SKILL.md')
  const { fields, body, parsed } = splitFrontmatter(readFileSync(skillPath, 'utf8'))
  // 技能名唯一真源 = frontmatter `name`（缺省回落包内字面量）；两者不一致时**响亮提示**，
  // 因为宿主按 name 去重、`resourceBase` 又是按目录给的，不一致会造成「注册名 ≠ 目录名」的隐性错位。
  const skillName = fields.name ?? name
  if (fields.name && fields.name !== name) {
    say('warn', `· 论衡技能名不一致：SKILL.md frontmatter "${fields.name}" ≠ 包名 "${name}"——将以 frontmatter 为准注册。`)
  }
  // N-1③：版本自证行（`LUNHENG_QUIET` / `config.quiet` 可静音；warn 永不静音）。
  say('info', `· 论衡 v${readPackageVersion()}（bundle 入口已执行；主技能 ${skillName}）`)
  // 审计 C.2：解析失败此前**静默**退回兜底 description——模型侧路由字段丢了却没有任何信号。
  if (!parsed) {
    say(
      'warn',
      `· 论衡技能 frontmatter 未解析（SKILL.md 首行不是成行 \`---\` 或缺闭合行）：${skillPath}` +
        ' —— 已退回内置兜底 description，whenToUse 未注册；请检查该文件是否被 CRLF / 前置空行 / BOM 破坏。',
    )
  }
  // 审计 E.2（v18.2.4）：`skills` 是 `inject` 声明的**硬依赖**——合规宿主在 apply 前就已就绪，
  //   故这条不是「降级」分支而是「宿主违约」分支：响亮点名后**跳过注册**，但 C 组可选能力照常安装
  //   （入口不因缺一个服务就整体崩掉）。此前缺失时抛的是
  //   `Cannot read properties of undefined (reading 'register')`——一句话能说清的事不该以 TypeError 出现。
  //
  // v18.7.1（论衡 l 嵌 lunheng-commands）：除主技能外，**自动注册** `skills/lunheng-commands/SKILL.md`
  //   作为第二个技能——让 `dsh plugin add lunheng-article-pipeline` 自动获得 11 个 `/lunheng` 命令
  //   （v18.12.0，全量审计 L-12：此处旧写「12 个」，与下方运行期文案及 `skills/lunheng-commands/SKILL.md` 的
  //    「11 个」不一致——四处取三，以 11 为准；该计数此前无门覆盖，lib/** 不在 consistency-check 扫描面内）。
  //   失败回退：lunheng-commands 缺 SKILL.md → 仅警告，不阻塞主技能注册。
  if (ctx?.skills?.register) {
    ctx.effect(() => {
      // 主技能：论衡
      ctx.skills.register({
        name: skillName,
        source: 'runtime',
        description:
          fields.description ??
          '论衡：多 Agent 深度长文流水线（学术论文 / 商业评论 / 行业分析 / 公众号）。',
        ...(fields.whenToUse ? { whenToUse: fields.whenToUse } : {}),
        content: body,
        resourceBase: { kind: 'directory', path: skillDir },
      })
      // 子技能：lunheng-commands（v18.7.1 嵌入）
      const cmdSkillDir = join(packageRoot, 'skills', 'lunheng-commands')
      const cmdSkillPath = join(cmdSkillDir, 'SKILL.md')
      if (existsSync(cmdSkillPath)) {
        try {
          const cmdParsed = splitFrontmatter(readFileSync(cmdSkillPath, 'utf8'))
          const cmdName = cmdParsed.fields.name ?? 'lunheng-commands'
          if (cmdName === skillName) {
            say('warn', `· lunheng-commands SKILL.md frontmatter "${cmdParsed.fields.name}" 与主技能同名——已跳过子技能注册以避免名称冲突`)
          } else {
            ctx.skills.register({
              name: cmdName,
              source: 'runtime',
              description:
                cmdParsed.fields.description ??
                '论衡集成斜杠命令薄壳：/lunheng -draft/-cite/-audit/-journal/-ppt/-history/-rollback/-resume/-status/-stats/-help。',
              ...(cmdParsed.fields.whenToUse ? { whenToUse: cmdParsed.fields.whenToUse } : {}),
              content: cmdParsed.body,
              resourceBase: { kind: 'directory', path: cmdSkillDir },
            })
            say('info', `· 子技能已注册：${cmdName}（11 个 /lunheng 命令；薄壳 wrapper 不引入新角色 / 新 M 门）`)
          }
        } catch (e) {
          say('warn', `· lunheng-commands SKILL.md 解析失败（不影响主技能）：${String(e?.message || e).slice(0, 120)}`)
        }
      } else {
        say('info', `· lunheng-commands 子技能未找到：${cmdSkillPath}——11 个 /lunheng 命令不可用（论衡主流程仍 100% 运行）`)
      }
    })
  } else {
    say(
      'warn',
      '· 论衡技能未注册：宿主 ctx 缺 `skills` 服务（inject 声明的硬依赖未满足）——' +
        '原生工具 / 机制写保护 / 人类命令仍会尝试安装。',
    )
  }

  // ── C 组（v18.1.0）：原生工具 / 机制写保护 / 人类命令 ──────────────────────
  // 设计要点（官方依据见各模块头注释）：
  //   · 这些是**可选能力**：宿主缺 `tools` / `commands` 服务或缺 `@deepseek-ai/dsh-tools` 包时
  //     **只降级、不拖垮入口**（技能注册是第一职责；v18.0.0「入口 import 失败 → 技能不注册」的形态不可重演）；
  //   · 异步安装包在 `ctx.effect()` 里：任何一步失败都只打印一行提示，注册顺序与卸载语义不变。
  //   · v18.2.6：授权例外除 env 外也接受 `Config.allowMechanismEdit`（旧版 guard.js 注释声称有这个开关，
  //     而入口当时不接 config——文档承诺未实装，本次补上）。
  const allowMechEdit = () => cfg.allowMechanismEdit || ENV_TRUE(process.env.LUNHENG_ALLOW_MECH_EDIT)
  ctx.effect(() => {
    const disposers = []
    let alive = true
    ;(async () => {
      try {
        const { installLunhengTools } = await import('./tools.js')
        const d = await installLunhengTools(ctx, {
          skillRoot: skillDir,
          report: say,
          scriptTimeoutMs: cfg.scriptTimeoutMs,
          scriptMaxOutputBytes: cfg.scriptMaxOutputBytes,
          handoffLevel: cfg.handoffLevel,
        })
        if (!alive) { for (const x of d) try { x?.() } catch { /* 已卸载 */ } return }
        disposers.push(...d)
        if (d.length) say('info', `· 论衡原生工具已注册：${d.length} 个（lunheng_m_gate / lunheng_char_count / lunheng_handoff_check / lunheng_ethics_sanitize，均只读）`)
      } catch (e) {
        say('warn', `· 论衡原生工具安装失败（不影响技能与流水线）：${String(e?.message || e).slice(0, 120)}`)
      }
      // H2（v18.60.1 反哺 v3，主人显式授权）：tools/post-execute 自动伦理脱敏监听器
      //   仅对材料类工具触发（read / web_* / subagent*），basic 模式，不改其他工具语义；
      //   失败只降级 warn，不影响技能。详见 `audits/反哺报告-v18.60.1-DSH新能力接缝.md` §四.2 H2 +
      //   `audits/机制文件修订记录-2026-09-30-反哺v3全批.md`。
      //   宿主契约（v18.62.1 全量审计 P0-1 修复）：`tools/post-execute` 是 3 参 waterfall
      //   `(exec, result, next)`——旧 4 参写法 `(tool, args, result, next)` 入参错位后，真实宿主
      //   **每次工具调用**都会抛 `next is not a function` 并被静默改写成 isError。result.content 是
      //   content 块数组（`[{type:'text', text}]`），不是字符串；工具名是 `read`/`web_search`/`subagent`
      //   等真实名，不存在 `file_read`。
      try {
        const { sanitize, loadDicts } = await import('./ethics-sanitize.js')
        const dicts = loadDicts(skillDir)
        // v18.69.0（批 6-A · P2 修复）：三监听器（H2/H7/H4）此前丢弃 ctx.on 返回的 disposer、
        //   也不检查 alive——与同文件 guard/commands 的既有模式（ disposers.push + !alive 回收）
        //   不一致。若宿主在本异步 import 完成前已 dispose，会在已卸载的 ctx 上注册监听器
        //   并落进 catch 打误导性 warn。现统一接同一套清理模式。
        const dH2 = ctx.on('tools/post-execute', async (exec, result, next) => {
          // ── v18.76.0（v18.75.1 全量架构审计 R1 · P0 修复）：**契约载体整体改写** ──────────────
          // 旧实现给 `result` 赋值（`result.content = …` / `result.reviewFlags = …` /
          //   `result.ethicsSanitized = …`），而真宿主交给 `tools/post-execute` 的 result 是
          //   `dsh-tools` `materializeFinalResult()` 产出的**深冻对象**（D1：ESM 严格模式下赋值抛
          //   TypeError），且它在 `finishScheduledExecution` 里还要再过一次**字段白名单投影**
          //   （D2：只有 `content`/`meta`/`additionalContexts`/`error`/`value`/`concludesTurn` 能活）。
          //   两条机制**各自独立成立**，故旧实现整体静默失效：抛错被下面的 catch 吞掉，标记与改写
          //   都到不了任何消费方（实测探针：深冻 result 下 `listenerThrew=null`、result 零新属性、
          //   返回值仅 `{kind:'accept'}`；见 `audits/核实报告-v18.75.1-全量架构审计-2026-10-04.md` §2）。
          // 现契约（**本监听器不再写入 result 的任何字段**）：
          //   ① 先 `await next()` 取下游裁决——**只调一次、绝不截断** waterfall（与 H4/H7 同口径）；
          //   ② 命中摘要走 `decision.additionalContexts`：宿主 `dsh-tools:3380/3391` 明确采纳该字段，
          //      并由 `dsh-agent-loop` 的 `acceptContext` 作为 user 消息放进下一轮上下文。元素形状与
          //      `@deepseek-ai/dsh-llm` 的 `createUserMessage()` 产物一致（id/role/content/source），
          //      否则 `dsh-agent` 的 `Inbox.validate` 会因缺 `id` 判重失败；
          //   ③ opt-in 改写（`Config.hookRewriteContent`）走 `decision.content`（宿主 `:3404` 采纳），
          //      且仅在裁决既非 block、也未携带 `value` 时才设置（宿主 `:3390` 禁止两者并存）；
          //   ④ `ethicsSanitized` 结构化字段仍挂在**返回值**上，但**只对更晚注册的同进程监听器可见**
          //      ——宿主会按白名单丢弃它，不再假装它是消费方契约；
          //   ⑤ **降级必须可观察**：catch 内至少 report 一次 warn（与 `lib/guard.js:265-272` 同口径），
          //      旧版的裸 `catch {}` 正是本缺陷「不报错、不打警告」的成因之一。
          //   ⑥ 标记文本**只含计数与类别**，绝不含 `reviewFlags[].text` / `replacements[].from`（原文）
          //      ——该消息会被 host 落进会话日志，原样回吐 PII 会重演 R4。
          const decided = (await next()) ?? { kind: 'accept' }
          try {
            // v18.80.0（全量审计 P1-2）：**总开关**。默认 true（伦理脱敏是合规能力），
            //   置 false 则本会话完全不扫、不注入标记——供纯代码与文档工作流关掉噪声。
            //   为什么给开关：该监听器对材料类工具的每个 text 块无条件跑 basic 模式，
            //   而实测其对技术文档的命中「person 全部为低置信、无一是真人姓名」（数字见 CHANGELOG 本版段）
            //   ——在不需要伦理脱敏的场景里，它只产出常驻上下文噪声。
            if (cfg.ethicsHook === false) return decided
            // v18.78.1 全量审计 · 批 5（P3 · H2 工具名大小写）：与同包 `lib/guard.js` 的写工具名判定同口径（那里已
            //   `.toLowerCase()`）。不加 lower 时 `Read` / `READ` / `WEB_SEARCH` / `Subagent` 全部
            //   被判成「非材料类工具」→ **静默漏脱敏**（探针实测：四者 ethicsSanitized 全为 no）。
            const name = String(exec?.name || '').toLowerCase()
            if (!/^(read|web_|subagent)/.test(name)) return decided
            const blocks = Array.isArray(result?.content) ? result.content : null
            if (!blocks) return decided
            let reviews = []
            let scannedBlocks = 0   // v18.69.0：全部流经钩子的 text 块数（含 0 命中）——opt-in 方据此确认「钩子确实扫过」
            // P0-1（v18.62.5 全量审计-性能与安全）：钩子默认传 `maxChars: MAX_SAFE_INTEGER`——
            //   钩子的职责是「脱敏」，不是「限流」；限流应由宿主/工具侧负责。旧默认 60000 会让
            //   `>60000 字符` 的工具结果被静默截断、且 `truncated` 未注入 summary（v18.62.4 报告 §P0-1）。
            // P2-3（同批）：`summary` 在 `blocks.map(...)` 内被反复覆盖成「最后一个 text 块的结果」，
            //   `counts`/`replacements` 同样只反映单块而非全文聚合；多块结果（`read` 带附属说明、
            //   `web_*` 多段落）下 `result.ethicsSanitized` 会低报实际替换量。改为在 `map` 外维护
            //   累加器，并把 `truncated` / `distinctPersons` / `blockCount` 一并写入。
            // P0-2（同批，默认改为「只标记不改写」）：钩子此前默认把命中项替换回写到 `result.content`，
            //   等于「所有 read/web_/subagent* 的文本块被无条件改写」——实测会误伤「时间戳」「订单 ID」
            //   等普通文本（v18.62.4 报告 §P0-2），且 SECURITY.md 描述与实现漂移。
            //   现默认行为（v18.76.0 R1 修复后）：`basic` 模式下命中项**只产出标记**——标记走宿主唯一
            //   采纳的副通道 `decision.additionalContexts`（见监听器头注释 ②），**不动 `result.content`**
            //   （深冻对象不可写、也不需要写）；下游角色仍拿原文，并额外收到一行「此处有命中待复核」摘要。
            //   改写正文改为**显式 opt-in**（`Config.hookRewriteContent: true`，默认 `false`），走 `decision.content`。
            const hookRewrite = !!cfg.hookRewriteContent
            const hookMaxBlockChars = Number.isFinite(cfg.hookMaxBlockChars) && cfg.hookMaxBlockChars > 0 ? cfg.hookMaxBlockChars : 262144
            const aggCounts = { idcard: 0, bankcard: 0, phone: 0, landline: 0, email: 0, person: 0, personHigh: 0, personLow: 0, place: 0 }
            let aggReplacements = 0
            let aggTruncated = false
            const distinctPersons = new Set()
            let blockCount = 0
            let skippedTooLarge = 0
            // v18.80.4（全量审计-v18.80.3 P1-3）：**下游已改写 content 时以其为准**。
            //   病根：opt-in 改写（hookRewriteContent=true）下，旧实现 `await next()` 之后仍从**原始**
            //   result.content 重建脱敏数组并写 decision.content——若下游监听器已对 content 做删减/安全
            //   过滤（探针复现：DOWNSTREAM_SAFE_REPLACEMENT），会被整体覆盖（下游删掉的文本被重新引入）。
            //   现以「下游送达形态」为脱敏输入：下游给了 content 数组 → 扫它、改它；否则扫原始 result.content。
            const effBlocks = (decided && Array.isArray(decided.content) && decided.content.length)
              ? decided.content
              : blocks
            const sanitized = effBlocks.map((b) => {
              if (!b || typeof b !== 'object' || b.type !== 'text' || typeof b.text !== 'string') return b
              // P2-2（v18.62.5 全量审计-性能与安全）：单块 > hookMaxBlockChars 时跳过脱敏改写。
              //   报告 §P2-2 实测 2 MB 同步耗时 ~150 ms，且 `lunheng_ethics_sanitize` 工具内部
              //   `readFileSync` 全量读 + `MAX_SAFE_INTEGER` 全文展开，会同时占用「原文 + 脱敏副本」
              //   两份内存。钩子职责是「监听 result」——超限内容由宿主/工具侧分页处理（已具备
              //   `offset`/`maxChars`），不应让钩子内部再吃一份全量。
              if (b.text.length > hookMaxBlockChars) {
                skippedTooLarge++
                reviews.push({
                  kind: 'too-large-for-hook',
                  detail: `单 text 块长度 ${b.text.length} > 钩子上限 ${hookMaxBlockChars}，跳过脱敏（用 lunheng_ethics_sanitize 工具分页处理）`,
                })
                return b
              }
              const out = sanitize(b.text, { mode: 'basic', dicts, maxChars: Number.MAX_SAFE_INTEGER })
              scannedBlocks++
              const textChanged = out.text !== b.text
              // v18.80.1（全量审查修订批 · B14-②）：聚合**移出 `textChanged` 门控**。
              //   病灶（本批实测）：只统计「真的改写了」的块，而**默认形态**（`hookRewrite=false`，
              //   低置信候选不改写正文）下 `textChanged` 恒假 → `aggCounts.personLow` **恒为 0**，
              //   于是 v18.80.0 P1-2 专门要传出的「扫到了多少候选」在最常见场景下**永不出现**
              //   （实测：工具面 `personLow=4` vs 监听器聚合 `personLow=0`，而 reviewFlags 有 4 条）。
              //   新口径 = **扫过就累加**；「是否改写了正文」已由 `rewriteApplied` 单独如实声明。
              // v18.80.1（B14-④）：下面两个分支原本**逐语句相同**（只差 return 值），合并为一段——
              //   本批这条「计数被门控吞掉」的缺陷，正出在这种「改一半」的双份结构里。
              for (const k of Object.keys(aggCounts)) {
                if (out.counts && typeof out.counts[k] === 'number') aggCounts[k] += out.counts[k]
              }
              if (out.truncated) aggTruncated = true
              aggReplacements += Array.isArray(out.replacements) ? out.replacements.length : 0
              if (typeof out.distinctPersons === 'number' && out.distinctPersons > 0) {
                // 调用方传 individualPerson 计数之外的「distinct 全名集合」不可拿；
                // 钩子侧能拿到的最高粒度是「至少 1 个不同人名」二值，故用计数上限兜底。
                distinctPersons.add(`b${blockCount}:${out.distinctPersons}`)
              }
              blockCount++
              if (Array.isArray(out.reviewFlags) && out.reviewFlags.length) reviews.push(...out.reviewFlags)
              // 仅在确实有命中时返回改写后的块；opt-in 关闭时一律返回原块
              return (textChanged && hookRewrite) ? { ...b, text: out.text } : b
            })
            // v18.76.0（R1 修复）：注入条件仍是「扫过任意 text 块（含 0 命中）或跳过任意超限块」——
            //   超限块没进 sanitize、scannedBlocks 不 +1，故 skippedTooLarge 必须单列。
            if ((scannedBlocks + skippedTooLarge) === 0) return decided
            // 按 kind+detail 去重：dict-missing 类降级条目按块 push 会重复 N 份（v18.69.0 批 6-A · P2 修复保留）。
            const seen = new Set()
            const deduped = reviews.filter((r) => {
              const k = `${r?.kind}|${r?.detail}`
              if (seen.has(k)) return false
              seen.add(k)
              return true
            })
            const ethicsSanitized = {
              mode: 'basic',
              counts: aggCounts,
              replacements: aggReplacements,
              distinctPersonBlocks: distinctPersons.size,   // ⚠️ 语义 = 「命中人名的块数」而非人数（块内人数上限不可得，见上方粒度注释；字段名保留以兼容既有消费方）
              blockCount,
              scannedBlocks,                               // 流经钩子的全部 text 块数（含 0 命中）
              skippedTooLarge,                             // P2-2：超体积跳过的块数
              hookMaxBlockChars,                           // P2-2：上限值（如实暴露给下游）
              truncated: aggTruncated,                     // P0-1：完整上传 `truncated`
              degraded: !!dicts?.missing?.length,
              degradedReason: (dicts?.missing?.length ? `缺词表：${dicts.missing.join(' / ')}` : ''),
              rewriteApplied: hookRewrite,                 // P0-2：如实声明「是否改写」
            }
            // ⚠️ 只写**返回值**，不写 `result`（深冻对象赋值必抛 TypeError，见监听器头注释 D1）。
            const out = { ...(decided && typeof decided === 'object' ? decided : { kind: 'accept' }), ethicsSanitized }
            // ① opt-in 改写走 `decision.content`（宿主采纳）；宿主禁止与 `value` 并存、block 分支不看 content。
            if (hookRewrite && decided?.kind !== 'block' && !Object.hasOwn(decided ?? {}, 'value')
              && sanitized.some((b, i) => b !== effBlocks[i])) {
              out.content = sanitized
            }
            // ② 标记走 `additionalContexts`——宿主**唯一**会把「插件附加信息」送达消费方的通道。
            // v18.80.0（P1-2）：`actionable` 补 `lowCandidates > 0` —— 低置信候选**不再改写正文**，
            //   但仍须让操作者知道「扫到了多少候选」（否则从「噪声」变成「沉默」，更糟）。
            // v18.80.1（B14-③）：**注入条件收紧**——低置信候选**不再单独触发**注入。
            //   病灶（本批实测）：姓氏正则对技术文本精度极低（实测 9.5 KB 技术表格报 **61 个候选 / 真名 0 个**），
            //   于是「候选 > 0」几乎恒真 → **每一次中文材料读取都注入一行 ~190 字符的标记**，信息量近零。
            //   候选数**并未消失**：它仍在返回值的 `ethicsSanitized.counts.personLow` 里，也可随时用
            //   `lunheng_ethics_sanitize` 工具按需取明细（该工具的用途正是这个）。
            //   标记只在**真有可执行事项**时出现：真替换 / 超限跳过 / 非低置信类复核项 / 词表缺失。
            const lowCandidates = aggCounts.personLow || 0
            const actionableReviews = deduped.filter((r) => String(r?.kind || '') !== 'person-low-confidence')
            const actionable = aggReplacements > 0 || skippedTooLarge > 0 || actionableReviews.length > 0 || !!dicts?.missing?.length
            if (actionable) {
              // byType 只列**真实发生**的计数：`personLow` 是候选数不是替换数，单列，避免混进「替换」列表。
              // v18.80.1（B14-①）：**`person` 也必须排除**——`person === personHigh + personLow`
              //   （该恒等式由 `tests/ethics-sanitize.test.mjs` 自钉），把它印在「命中替换 N 处」的括号里
              //   等于**把候选数当替换数报**（实测标记出现过「命中替换 8 处（person=129 …）」：8 处替换中
              //   真人名只有 1 处）。`personHigh` 保留——它才是替换数的真值分项。
              const byType = Object.entries(aggCounts).filter(([k, v]) => v > 0 && k !== 'personLow' && k !== 'person').map(([k, v]) => `${k}=${v}`)
              const kinds = [...new Set(deduped.map((r) => String(r?.kind || 'unknown')))]
              const marker =
                `〔论衡 H2 伦理脱敏〕basic 模式：命中替换 ${aggReplacements} 处` +
                (byType.length ? `（${byType.join(' / ')}）` : '') +
                (lowCandidates > 0 ? `；另有**低置信候选 ${lowCandidates} 个未改写**（姓氏命中但无角色词，实测绝大多数是普通词，须人工确认）` : '') +
                `；扫描 text 块 ${scannedBlocks} 个、跳过超限块 ${skippedTooLarge} 个；改写正文=${hookRewrite ? '是' : '否'}` +
                (kinds.length ? `；待复核类别：${kinds.join(' / ')}（明细见 lunheng_ethics_sanitize 工具返回值，本标记不含原文）` : '') +
                (dicts?.missing?.length ? `；⚠ 词表缺失：${dicts.missing.join(' / ')}（该维度未生效，不得声称已完整脱敏）` : '') +
                '。需要真脱敏请调用 lunheng_ethics_sanitize 工具，并只把其 text 字段交给下游角色。'
              out.additionalContexts = [
                ...(Array.isArray(decided?.additionalContexts) ? decided.additionalContexts : []),
                {
                  id: randomUUID(),
                  role: 'user',
                  content: [{ type: 'text', text: marker.slice(0, 800) }],
                  source: { kind: 'lunheng-article-pipeline' },
                },
              ]
            }
            return out
          } catch (e) {
            // 降级必须可观察：旧版裸 `catch {}`（既不报错也无标记）正是本缺陷「静默」的成因之一。
            try { say('warn', `· H2 伦理脱敏监听器判定异常（${String(e?.message || e).slice(0, 120)}）——本次不注入标记，按下游裁决原样放行。`) } catch { /* say 自身不可用时不二次抛 */ }
            return decided
          }
        })
        if (!alive) { try { dH2?.() } catch { /* 已卸载 */ } return }
        if (dH2) disposers.push(dH2)
        say('info', '· H2 伦理脱敏监听器已挂（tools/post-execute → basic 模式，仅对材料类工具触发）')
      } catch (e) {
        say('warn', `· H2 伦理脱敏监听器安装失败（不影响技能）：${String(e?.message || e).slice(0, 120)}`)
      }

      // H5（v18.60.1 反哺 v3，已移除 —— v18.62.1 全量审计 P1-1）：
      //   原监听 `file-watcher:change` 自动 spawn refresh-gates.mjs，但 `file-watcher:change` 在 dsh 宿主
      //   全树 0 命中（无派发方）——cordis 的 `ctx.on` 只挂 hooks 数组、不校验事件存在，故「注册成功」≠「会
      //   触发」，是死监听器。且 spawn 目标写 `scripts/refresh-gates.mjs`，脚本实际在
      //   `skills/lunheng-article-pipeline/scripts/refresh-gates.mjs`，即便有派发方也必 ENOENT（`stdio:'ignore'`
      //   还会吞掉错误）。refresh-gates 仍是幂等脚本、可手动跑，HMR 触发面删除后能力不受损。

      // H7（v18.61.0 反哺 v4，**已移除 —— v18.76.0 · v18.75.1 全量架构审计 R2 · P1**）：
      //   原监听 `agent/request` waterfall，按 `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_{PROVIDER,MODEL}` env
      //   覆盖 provider/model，卖点是「改 env 不必重启 dsh 即切模型」。
      //   **为什么删**：该事件的 payload **只有** `{turn, step, signal}`（宿主 `dsh-agent-loop` 的
      //   `buildRequest` 派发点；本仓 `scripts/_lib/host-contract.mjs` 的契约表注**早已写明**这三个键），
      //   而监听器读 `request.toolName || request.tool?.toolName` → **恒 `undefined`** → 每次请求都在
      //   `if (!pair) return next()` 空转。判别键在 payload 里根本不存在，属「派发方存在、判别键缺失」的
      //   死监听器（继 H5「宿主无派发方」、H3「session 日志事件」之后**第三例**），且它挂在**每个模型请求**
      //   的 waterfall 上——纯开销 + 语义污染。它与 `host-contract` 门**不冲突**（事件名在表内、arity=2 也
      //   对得上），故门抓不到——正是 R3「契约门只比形参个数」的活标本。
      //   **能力是否受损**：不受损。分档路由仍由 `examples/preset/agent-tiered/cordis.yml` 的
      //   `agentOptions`（`!!js` 加载期求值，与 H7 同一条 env 公式）承载——**改 env 后需重载插件行**；
      //   「免重启」这一卖点已从 `SKILL.md` / `references/_shared/DSH-集成方案.md` / `CHANGELOG` 一并撤下。
      //   删除前后行为**完全等价**（删除前该监听器对任何请求都返回 `next()` 的既有结果）。
      //   **若将来要恢复热路由**：必须先做**真宿主探针**确认可用判别键（当前唯一可用信息是 scope 与
      //   `{turn, step, signal}`），确认后以集成测试钉住该判别键，不得再凭记忆假设字段名。
      //   `agent/request` 的契约表项**保留**（它是宿主事实、且 `host-contract-probe` 持续对该 payload
      //   键集合断言）——删的是本包对该事件的**注册**，不是该事件的契约记录。

      // H3（v18.61.0 反哺 v4，已移除 —— v18.62.1 全量审计 P1-1）：
      //   原监听 `assistant/chunk` 做 G14 启发式预筛，但 `assistant/chunk` 在宿主里是 **session 日志事件**
      //   （`session.append("assistant/chunk", …)`），不是 ctx 事件——ctx 侧无派发方，监听器永不触发。
      //   G14 中文 AI 痕迹检测已由 G14 终闸（v2.4.0 + v18.2.8 三层防御第 3 层 LLM 推理判定）完整覆盖，
      //   预筛仅作高风险标注的减负手段、本就不替代终闸，删除后检测能力不受损。

      // H4（v18.61.0 反哺 v4，主人显式授权）：system-prompt/assemble 钩子
      //   监听 system-prompt/assemble 事件 → 在 dsh 默认 prompt 之后**只追加**一个 phase-specific 提示段
      //   （**不覆盖** dsh 默认内容）。
      //   宿主契约（v18.62.1 全量审计 P1-2 修复）：`system-prompt/assemble` 是 3 参 waterfall
      //   `(assembly, context, next)`——旧 2 参写法 `(prompt, next)` 入参错位（prompt=assembly 对象、next=context）
      //   且不调 next()，会把更后注册的下游监听器（含 dsh-agent 的模型选择）静默截断。正确形态：
      //   `await next()` 拿到装配结果后，向 `sections` **追加**一个论衡提示段并返回——不覆盖任何既有字段。
      //   **边界（如实登记）**：① 追加失败只降级为「返回下游结果原样」，不抛错、不截断下游；② 监听器
      //   **只读装配结果 + 追加 sections 项**——无 spawn / 无 IO / 无改仓库。
      try {
        // v18.62.4（全量审计-v18.62.3 P2-1）：**尾注版本号不再硬编码**。
        //   旧码写死「本会话已加载 lunheng-article-pipeline 技能（v18.61.0）」——该串**每个会话都进模型上下文**，
        //   而包版本已到 v18.62.4 → 直接抵消了上面那条刻意加的「版本自证行（装错了要看得见）」
        //   （自证行说真版本，同一段 prompt 说旧版本）。为什么没有门抓到：本仓版本规则全部跑在
        //   **技能根**（`consistency-check.mjs` 的 `files = walk(ROOT)`，且 `walk` 只收 `.md`），
        //   `lib/**` 完全在扫描面之外，且该形态（行内括注）也不匹配任何版本规则。
        //   现改为**运行时读随包 package.json**（与 `readPackageVersion()` 同源），版本随包自证。
        // v18.62.6 补正：**v18.62.4 那次只改了一半**——正文换成 `${pkgVersion}`，标题里的
        //   `## 论衡·按需追加（v18.62.5）` 仍是**字面量**，于是 v18.62.5 bump 时它照旧漂移
        //   （bump-version 的形态表不含该形态、`lib/**` 又不在任何版本门扫描面内 → 无人发现）。
        //   现在标题也走 `${pkgVersion}`：**该串内不再有任何版本字面量**，结构上不可能再漂。
        // v18.76.0（v18.75.1 全量架构审计 R7-S7 · P2 修复）：**版本号改为每次 assemble 现读**。
        //   旧版在本 `try` 块（apply 期）一次性算出 `LUNHENG_PROMPT_TAIL`，于是**原地升级已加载的插件
        //   不会刷新注入文本**——实测本机 profile 实装 18.74.0 时，注入文本仍写 `v18.74.0` 而仓库已
        //   18.75.1。「装错了要看得见」此前只对**随包文档**成立，对这份**注入文本**不成立。
        //   代价 = 每次 assemble 一次 `readFileSync`（已在 `readPackageVersion()` 内 try/catch，失败回
        //   `unknown`、不抛）。注：`lib/**` 的版本字面量另有 `consistency-check` 规则 ㉚ 守着（同批新增）。
        const buildPromptTail = () => {
          const pkgVersion = readPackageVersion()
          return `\n\n---\n## 论衡·按需追加（v${pkgVersion}）\n\n本会话已加载 \`lunheng-article-pipeline\` 技能（v${pkgVersion}）。\n如需启动流水线：\n1. 主控先走 **Phase 0 定题**（人在环确认主题/类型/外部服务）\n2. Phase 1 三检索员 T1∥T2∥T3 真并行\n3. Phase 2/3/4 全程 \`agents-log.md\` 落盘 / \`status.md\` 主控独占\n详见 \`SKILL.md\` §⚡ 启动速查表。`
        }
        const dH4 = ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
          const r = await next()
          try {
            // v18.78.1 全量审计 · 批 5（P3 · H4 兜底）：`next()` 返回 `undefined`（或非对象）时，`{...r}` = `{}`，
            //   会把装配结果的 contexts / tools / variables（**含模型选择**）整体抹掉——探针实测
            //   `next() -> undefined` 时返回值键只剩 `['sections']`，contexts/variables 全丢。
            //   与同文件 H2（`:367` 的 `?? { kind: 'accept' }`）同口径：现退回**入参 assembly** 作底，
            //   再在其上追加论衡段（下游没给结果 = 没人改过装配结果，基线就是入参本身）。
            const base = (r && typeof r === 'object') ? r : (assembly && typeof assembly === 'object' ? assembly : {})
            const sections = Array.isArray(base.sections) ? base.sections : []
            return { ...base, sections: [...sections, { name: 'lunheng', text: buildPromptTail() }] }
          } catch { return r }
        })
        if (!alive) { try { dH4?.() } catch { /* 已卸载 */ } return }
        if (dH4) disposers.push(dH4)
        say('info', '· H4 system-prompt/assemble 钩子已挂（只追加不覆盖）')
      } catch (e) {
        say('warn', `· H4 system-prompt/assemble 钩子安装失败（不影响技能）：${String(e?.message || e).slice(0, 120)}`)
      }

      try {
        const { installMechanismGuard } = await import('./guard.js')
        // 受保护根 = 审计定义的「机制文件」范围：技能体（SKILL.md / AGENTS.md / references/** / scripts/**）
        //   + 包级 `cordis.patch.yml` + 入口目录 `lib/` + 仓库级门 `scripts/`（**仅当它存在**——
        //   npm 装包后仓库级 `scripts/` 不随包，旧版登记的是个死路径）。
        //   **不含** docs / README / CHANGELOG（文档可自由改，不受机制否决）。
        // v18.2.6：额外把「同名技能的其它落点（rank 100/200/400/500）」纳入——见 guard.js 的 mirrorRoots()；
        //   只保护包内那一份，等于保护了一份**没人读**的文件。
        const mechRoots = [
          skillDir,
          // v18.16.0（B-1 反哺）：内嵌子技能 skills/lunheng-commands/ 也纳入受保护根——
          //   该子技能的 SKILL.md 定义 11 个 /lunheng 命令、其 scripts/route-command.mjs 还是
          //   consistency-check 规则 ⑳（命令数真源）的**唯一真源**。guard 只保护主技能等于
          //   留下半条规则可被悄悄改写。
          ...(existsSync(join(packageRoot, 'skills', 'lunheng-commands')) ? [join(packageRoot, 'skills', 'lunheng-commands')] : []),
          join(packageRoot, 'lib'),
          join(packageRoot, 'cordis.patch.yml'),
          ...(existsSync(join(packageRoot, 'scripts')) ? [join(packageRoot, 'scripts')] : []),
        ]
        const d = installMechanismGuard(ctx, {
          mechanismRoots: mechRoots,
          skillName,
          // v18.69.0（批 6-A）：子技能同名副本（.dsh/skills/lunheng-commands 等）一并纳入镜像根
          mirrorSkillNames: ['lunheng-commands'],
          allowed: allowMechEdit,
          report: say,   // v18.57.x（审计修订 P2）：降级原因必须打出来，不得静默不装
        })
        if (!alive) { try { d?.() } catch { /* 已卸载 */ } return }
        if (d) {
          disposers.push(d)
          say(
            'info',
            '· 论衡机制文件写保护已启用（write/edit 类工具对技能包内路径一律否决；主人授权时设 LUNHENG_ALLOW_MECH_EDIT=1 或在插件行 config 写 allowMechanismEdit: true）',
          )
        }
      } catch (e) {
        say('warn', `· 论衡机制写保护安装失败（不影响技能）：${String(e?.message || e).slice(0, 120)}`)
      }
      try {
        const { installStatusCommand, installStatsCommand } = await import('./commands.js')
        const d1 = installStatusCommand(ctx, { cwd: process.cwd() })
        const d2 = installStatsCommand(ctx, { cwd: process.cwd(), skillRoot: skillDir, scriptTimeoutMs: cfg.scriptTimeoutMs })
        if (!alive) { for (const d of [d1, d2]) try { d?.() } catch { /* 已卸载 */ } return }
        if (d1) disposers.push(d1)
        if (d2) disposers.push(d2)
        if (d1 || d2) say('info', '· 论衡人类命令已注册：/lunheng-status（单项目进展）＋ /lunheng-stats（跨项目遥测看板），均不产生模型消息')
      } catch (e) {
        say('warn', `· 论衡人类命令安装失败（不影响技能）：${String(e?.message || e).slice(0, 120)}`)
      }
      // v18.90.0（B 批）：运行面板（宿主半边）——**默认关**（config.panel / LUNHENG_PANEL=1），
      //   打开时在 `ctx.webServer` 上注册一个只读前缀路由（官方契约：kind/path/handler，handler 可持有响应做 SSE）。
      //   `webServer` 是**可选**服务：headless / 无 Web 组合下如实提示并跳过，不抛错。
      try {
        const d = registerPanel(ctx, cfg, say)
        if (!alive) { try { d?.() } catch { /* 已卸载 */ } return }
        if (d) disposers.push(d)
      } catch (e) {
        say('warn', `· 论衡运行面板挂载失败（不影响技能）：${String(e?.message || e).slice(0, 120)}`)
      }
    })()
    return () => {
      alive = false
      for (const d of disposers) { try { d?.() } catch { /* 卸载期失败不抛 */ } }
    }
  })
}
