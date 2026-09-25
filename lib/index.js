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
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) issues.push({ message: `config.${key} 必须是正数，收到 ${String(v)}`, path: [key] })
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
        if (d.length) say('info', `· 论衡原生工具已注册：${d.length} 个（lunheng_m_gate / lunheng_char_count / lunheng_handoff_check，均只读）`)
      } catch (e) {
        say('warn', `· 论衡原生工具安装失败（不影响技能与流水线）：${String(e?.message || e).slice(0, 120)}`)
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
          join(packageRoot, 'lib'),
          join(packageRoot, 'cordis.patch.yml'),
          ...(existsSync(join(packageRoot, 'scripts')) ? [join(packageRoot, 'scripts')] : []),
        ]
        const d = installMechanismGuard(ctx, {
          mechanismRoots: mechRoots,
          skillName,
          allowed: allowMechEdit,
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
    })()
    return () => {
      alive = false
      for (const d of disposers) { try { d?.() } catch { /* 卸载期失败不抛 */ } }
    }
  })
}
