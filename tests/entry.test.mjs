// 入口回归测试（v18.0.0 新增）
//
// 为什么必须有这一条：包面静态检查（dsh-plugin-dev check / repo-hygiene-check）**不执行 `apply`**，
// 因此「入口能 import、但 apply 一跑就崩」这类缺陷静态门全绿也照样漏过。v18.0.0 发布前实测踩到过一次：
// 入口从包根移入 `lib/` 后未同步调整相对路径 → `readFileSync(<包根>/lib/SKILL.md)` ENOENT →
// 技能注册失败，而当时的两个静态门全绿（教训 #152）。
//
// 本测试用最小 ctx 真正执行 `apply`，把「入口 → SKILL.md → 技能目录」这条路径钉在 CI 里：
//   ① 入口导出的契约（name / inject / apply 形态）；
//   ② `apply` 确实调用 `ctx.effect`（注册即可逆，卸载自动清理）；
//   ③ 注册字段（name / source / description / whenToUse / content / resourceBase）齐备且指向真实目录；
//   ④ resourceBase 目录下 SKILL.md / references/ / scripts/ 真实存在（渐进披露的相对引用前提）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PIPE_SPAWN_BLOCKED, skipWhen } from './_fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const ENTRY = join(PACKAGE_ROOT, 'lib', 'index.js')

/** 最小 ctx：只实现入口消费的能力（effect + skills.register），并可选提供 tools / commands 服务。
 *  v18.1.0：`ctx.get(name)` 是官方「可选依赖」的取法（guide L139），入口用它取 tools/commands/…，
 *  故这里按需注入，用来同时覆盖「有服务」与「无服务（降级）」两条路径。 */
function makeCtx({ tools = false, commands = false } = {}) {
  const captured = { registrations: [], disposers: 0, effects: 0, tools: [], guards: 0, commands: [], commandResults: [] }
  const services = {}
  if (tools) {
    services.tools = {
      register(definition) { captured.tools.push(definition); return () => { captured.toolsDisposed = (captured.toolsDisposed || 0) + 1 } },
      guard(fn) { captured.guards += 1; captured.guardFn = fn; return () => { captured.guardDisposed = true } },
    }
  }
  if (commands) {
    services.commands = { register(definition) { captured.commands.push(definition); return () => { captured.commandDisposed = true } } }
  }
  const ctx = {
    get(name) { return services[name] },
    effect(fn) {
      captured.effects += 1
      const disposer = fn()
      return () => {
        captured.disposers += 1
        if (typeof disposer === 'function') disposer()
      }
    },
    skills: {
      register(definition) {
        captured.registrations.push(definition)
        return () => {}
      },
    },
  }
  return { ctx, captured }
}

/** 等入口里那次异步安装（动态 import + 注册）落定。
 *  入口把安装包在 `ctx.effect()` 的异步 IIFE 里，测试要等到微任务队列被冲刷（导入缓存命中时极快）。 */
const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 5))
}

test('入口契约：name / inject / apply 形态符合 DSH 插件约定', async () => {
  const mod = await import(pathToFileURL(ENTRY).href)
  assert.equal(mod.name, 'lunheng-article-pipeline', 'entry must export the plugin name')
  assert.deepEqual(mod.inject, ['skills'], 'entry must declare the skills service as a dependency')
  assert.equal(typeof mod.apply, 'function', 'entry must export apply(ctx)')
  assert.ok(existsSync(ENTRY), `entry file must exist: ${ENTRY}`)
})

test('apply 注册技能：字段齐备 + resourceBase 指向真实技能目录', async () => {
  const mod = await import(pathToFileURL(ENTRY).href)
  const { ctx, captured } = makeCtx()
  mod.apply(ctx)

  assert.ok(captured.effects >= 1, 'apply must register through ctx.effect (reversible registration)')
  assert.equal(captured.registrations.length, 1, 'apply must register exactly one skill')

  const reg = captured.registrations[0]
  assert.equal(reg.name, 'lunheng-article-pipeline')
  // source 必须是 'runtime'，**不是 'bundled'**（v18.2.6 审计 B-6 / P2-13 修）：
  //   宿主对 `ctx.skills.register()` 注册进来的技能，候选 rank **恒取 `RUNTIME_RANK = 250`**——注册接口
  //   并不接受 rank，插件也无法自报 rank。而官方 rank 表里 `bundled` 是 **600**（最低优先级）。
  //   于是旧写法自贴 `source: 'bundled'` 会让任何**按 rank 表读**这份注册的人和工具误判优先级
  //   （以为「包内技能优先级最低、会被项目级副本顶替」），而实际运行期语义是 250。改 'runtime' 后
  //   字段与宿主实际使用的 rank 语义一致；`lib/index.js` 内 `source: 'runtime'` 处有同源注释。
  assert.equal(reg.source, 'runtime', "注册 source 必须与宿主实际使用的 RUNTIME_RANK=250 语义一致，不得自贴 'bundled'（官方 rank 表里 bundled = 600）")
  assert.ok(typeof reg.description === 'string' && reg.description.length > 0, 'description is required for the model catalogue')
  assert.ok(typeof reg.whenToUse === 'string' && reg.whenToUse.length > 0, 'whenToUse carries the routing boundary')
  assert.ok(typeof reg.content === 'string' && reg.content.length > 1000, 'skill body must be the SKILL.md body')

  // 前端 matter 必须已被剥离：正文不得以 `---` 开头（否则 frontmatter 会作为指令正文污染技能）
  assert.ok(!reg.content.startsWith('---'), 'frontmatter must be stripped from the registered body')
  assert.ok(!/^name:\s*"lunheng-article-pipeline"/m.test(reg.content), 'frontmatter keys must not leak into the body')

  // resourceBase 必须是目录且真实存在——这是 references/** 与 scripts/** 相对引用的前提
  assert.deepEqual(reg.resourceBase?.kind, 'directory')
  const skillDir = reg.resourceBase?.path
  assert.ok(typeof skillDir === 'string' && skillDir.length > 0, 'resourceBase.path is required')
  assert.ok(skillDir.endsWith(join('skills', 'lunheng-article-pipeline')), `resourceBase must point at the packaged skill dir, got: ${skillDir}`)

  // 路径回归（教训 #152）：入口移动 / files 白名单变化后，这里会立刻红
  for (const rel of ['SKILL.md', 'references', 'scripts']) {
    assert.ok(existsSync(join(skillDir, rel)), `resourceBase 下缺 ${rel}：${join(skillDir, rel)}`)
  }

  // 注册正文应与 SKILL.md 的正文段一致（防止入口读到别的文件）
  const raw = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
  const body = raw.slice(raw.indexOf('\n---', 4) + 4).replace(/^\n+/, '')
  assert.equal(reg.content, body, 'registered content must equal the SKILL.md body')

  // 卸载可逆：disposer 可调用
  const disposer = ctx.effect(() => () => {})
  assert.equal(typeof disposer, 'function')
})

// ===== v18.1.0（C 组）：原生工具 / 机制写保护 / 人类命令 =====
// 关键设计约束：这三者都是**可选能力**——宿主缺服务或缺包时只降级，**技能注册必须照常**。
test('C 组降级：宿主无 tools / commands 服务时，技能仍注册且不抛错', async () => {
  const mod = await import(pathToFileURL(ENTRY).href)
  const { ctx, captured } = makeCtx() // 不注入任何服务
  mod.apply(ctx)
  await settle()
  assert.equal(captured.registrations.length, 1, '缺 tools/commands 服务不得影响技能注册（第一职责）')
  assert.equal(captured.tools.length, 0)
  assert.equal(captured.commands.length, 0)
  assert.equal(captured.guards, 0)
})

test('C 组：注册 3 个只读原生工具，规范值可复算（真跑一次 M 门与字数）', {
  // v18.2.6：带探测的条件跳过（不是无条件 skip）。本用例要**真跑随包脚本**，而工具在**测试进程内**
  //   `spawn`（`lib/tools.js` 的 `runScript`），受限 DSH 会话（workspace-write 沙箱）禁止被围栏进程
  //   开命名管道 → 必红。恒红会训练人无视红灯，故探测到该环境即带理由跳过；**CI / 无沙箱 host shell
  //   下探测为假 → 照常执行，强度不变**。探测实现见 tests/_fixtures.mjs 的 PIPE_SPAWN_BLOCKED。
  skip: skipWhen(PIPE_SPAWN_BLOCKED, '宿主禁止子进程开命名管道（探测：对 process.execPath 做 spawn 管道 → EPERM）——本用例需在测试进程内真跑随包脚本（`lib/tools.js` 的 runScript）。请在无文件沙箱的 host shell 或 CI 复核；受限 DSH 会话下无法执行，且**不得用 LLM 断言替代机检结论**。'),
}, async () => {
  // 裸仓库 / CI 没有宿主包 `@deepseek-ai/dsh-tools`，故注入**契约等价**的替身：
  //   真 defineTool 负责参数校验/规范值冻结，这里只需要它把定义原样返回（本用例断言的是**本包的行为**）。
  const fakeDefineTool = (def) => def
  const { installLunhengTools } = await import(pathToFileURL(join(PACKAGE_ROOT, 'lib', 'tools.js')).href)
  const regs = []
  const ctx = { get: (n) => (n === 'tools' ? { register: (d) => { regs.push(d); return () => {} } } : undefined) }
  const disposers = await installLunhengTools(ctx, {
    skillRoot: join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline'),
    defineToolFactory: async () => ({ defineTool: fakeDefineTool }),
  })
  assert.equal(disposers.length, 3, '应返回 3 个 disposer')
  assert.equal(regs.length, 3, '应注册 lunheng_m_gate / lunheng_char_count / lunheng_handoff_check 三个工具')
  const names = regs.map((t) => t.name).sort()
  assert.deepEqual(names, ['lunheng_char_count', 'lunheng_handoff_check', 'lunheng_m_gate'])

  const charTool = regs.find((t) => t.name === 'lunheng_char_count')
  assert.equal(charTool.parameters?.file?.required, true, 'file 参数必填')
  assert.ok(charTool.output?.schema, '必须声明 canonical output schema')
  assert.equal(typeof charTool.output.render, 'function', '必须提供人类可读 render')

  // 真跑：拿一个真实文件（SKILL.md）算一次字数，断言返回的是**规范值**而不是散文
  const skillMd = join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md')
  const value = await charTool.execute({ file: skillMd }, { signal: new AbortController().signal })
  assert.equal(typeof value.hanChars, 'number', 'canonical value 必须带 hanChars 数字字段')
  assert.ok(value.hanChars > 1000, `SKILL.md 汉字数应 > 1000，实得 ${value.hanChars}`)
  assert.equal(typeof value.scope, 'string')
  assert.equal(value.exit, 0)
  const rendered = charTool.output.render({ file: skillMd }, value)
  assert.ok(Array.isArray(rendered) && /汉字/.test(rendered[0].text), 'render 应产出人类可读文本')

  // M 门工具：参数错（不存在的路径）应当是**基础设施失败**（throw），而不是把路径错伪装成内容结论
  const gateTool = regs.find((t) => t.name === 'lunheng_m_gate')
  await assert.rejects(
    () => gateTool.execute({ draft: join(PACKAGE_ROOT, 'nope.md'), evidence: join(PACKAGE_ROOT, 'nope') }, { signal: new AbortController().signal }),
    /未返回 JSON/,
    '拿不到 JSON（路径错 → exit 10）时必须 throw，不得返回伪造的规范值',
  )
})

test('C 组降级：宿主缺 @deepseek-ai/dsh-tools 时，工具安装失败但不影响技能（裸仓库场景）', async () => {
  const { installLunhengTools } = await import(pathToFileURL(join(PACKAGE_ROOT, 'lib', 'tools.js')).href)
  const regs = []
  const ctx = { get: (n) => (n === 'tools' ? { register: (d) => { regs.push(d); return () => {} } } : undefined) }
  const disposers = await installLunhengTools(ctx, {
    skillRoot: join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline'),
    defineToolFactory: async () => { throw Object.assign(new Error('Cannot find package'), { code: 'ERR_MODULE_NOT_FOUND' }) },
  })
  assert.deepEqual(disposers, [], '取不到 defineTool 时必须安静降级（返回空数组，不抛）')
  assert.equal(regs.length, 0)
})

// ===== 宿主 value schema DSL 合规（v18.1.0 追加；这是**真实踩到过**的缺陷类别）=====
// 背景：`@deepseek-ai/dsh-tools` 的 `defineTool` 不直接吃 JSON Schema，而是先编译**作者期 DSL**：
//   · 只认这些关键字：`type` / `oneOf` / `properties` / `additionalProperties` / `items` / `enum` / `const`
//     + 注解 `description` / `title` / `default` / `examples`（源码 `lib/index.js` 的 `assertAuthorKeys`）；
//   · `type: 'object'` **必须显式写** `additionalProperties: true|false`，否则报错；
//   · **`required` 只在「参数属性」层可用**（源码 :600-608 的 property 分支 `allowRequired:true`，且值必须是
//     布尔 `true`）；`output.schema` 走 `compileValueSchema`（:770-783，`allowRequired:false`）→
//     **任何层级的 `required` 都会被拒**。
// 为什么必须钉在 CI 里：违规的表现是 `defineTool()` **定义期抛错 → 工具永不注册**，而入口的降级 catch
//   会把它吞成一行提示（技能照常注册），于是「测试全绿 + 生产无工具」同时成立。
//   **本包实测**：首版 `lib/tools.js` 在 `output.schema` 里用了 `required`（根 + 数组 items 两处），
//   用真实 `defineTool` 一灌即抛 `unsupported JSON schema: schema.required is not supported by the value schema DSL`。
//   用的是「契约等价替身」的测试**看不见**这一类问题，故此处按 DSL 规则做**结构断言**（不依赖宿主包，CI 可跑）。
const DSL_VALUE_KEYS = new Set(['type', 'oneOf', 'properties', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples'])
const DSL_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null', 'json'])
/** 按宿主 DSL 规则走一遍 schema，返回违规清单（空 = 合规）。 */
function dslViolations(node, path, { inParameters = false } = {}) {
  const bad = []
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [`${path}: 必须是 schema 对象`]
  for (const k of Object.keys(node)) {
    if (k === 'required' && inParameters) continue
    if (!DSL_VALUE_KEYS.has(k)) bad.push(`${path}.${k}: DSL 不支持该关键字（${k === 'required' ? 'required 只在参数属性层可用，output.schema 全程禁用' : '非白名单'}）`)
  }
  if (node.oneOf) {
    if (node.type) bad.push(`${path}: type 与 oneOf 不能同时声明`)
    node.oneOf.forEach((b, i) => bad.push(...dslViolations(b, `${path}.oneOf[${i}]`)))
    return bad
  }
  if (node.type !== undefined && (Array.isArray(node.type) || !DSL_TYPES.has(node.type))) bad.push(`${path}.type: 必须是单个受支持的类型字符串`)
  if (node.type === 'object') {
    if (typeof node.additionalProperties !== 'boolean') bad.push(`${path}.additionalProperties: object 必须显式声明布尔值`)
    for (const [k, v] of Object.entries(node.properties || {})) bad.push(...dslViolations(v, `${path}.properties.${k}`))
  }
  if (node.type === 'array') bad.push(...dslViolations(node.items, `${path}.items`))
  return bad
}

test('C 组：工具定义必须符合宿主 value schema DSL（required 只在参数层；object 必须显式 additionalProperties）', async () => {
  const { installLunhengTools } = await import(pathToFileURL(join(PACKAGE_ROOT, 'lib', 'tools.js')).href)
  const regs = []
  const ctx = { get: (n) => (n === 'tools' ? { register: (d) => { regs.push(d); return () => {} } } : undefined) }
  await installLunhengTools(ctx, {
    skillRoot: join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline'),
    defineToolFactory: async () => ({ defineTool: (def) => def }),
  })
  assert.equal(regs.length, 3)
  for (const t of regs) {
    const bad = [...dslViolations(t.output?.schema, `${t.name}.output.schema`)]
    // `parameters` 本身是**属性映射**（`{ 参数名: schema }`），逐个参数按其自身 schema 走（此处 required 合法）
    for (const [k, v] of Object.entries(t.parameters || {})) {
      bad.push(...dslViolations(v, `${t.name}.parameters.${k}`, { inParameters: true }))
      // 参数层额外规则：`required` 存在时必须是 === true（官方 :602「must be true when present」）
      if ('required' in v && v.required !== true) bad.push(`${t.name}.parameters.${k}.required: 只能是 true（缺省即非必填）`)
    }
    assert.deepEqual(bad, [], `工具 ${t.name} 的 schema 不符合宿主 DSL：\n  - ${bad.join('\n  - ')}`)
    assert.equal(typeof t.description, 'string', `${t.name} 必须有 description`)
  }
  // 反向自证：把 required 放回 output.schema 必须被判违规（防这个断言本身恒真）
  const probe = dslViolations({ type: 'object', additionalProperties: false, properties: {}, required: ['x'] }, 'probe')
  assert.ok(probe.length > 0, '探测样例必须被判违规（否则本规则形同虚设）')
  const probe2 = dslViolations({ type: 'object', properties: {} }, 'probe2')
  assert.ok(probe2.some((m) => /additionalProperties/.test(m)), '缺 additionalProperties 必须被判违规')
})

// v18.2.6 契约微调（审计 B-6 附带）：两处输出 schema 变化必须被钉住，否则「改了实现没改契约」
//   ① `lunheng_char_count` 的 `sections`：JSON 字符串 → **规范 JSON 值**（宿主 DSL 原生 `json` 节点）。
//      动机：宿主 value schema 支持 `type: 'json'`，把结构化数据塞进字符串等于让消费方多解析一次、
//      且 canonical value 失去结构（官方 cookbook 要求「返回一个规范值，别让调用方解析散文」）。
//   ② 两个工具新增**可选** `truncated: boolean`（仅在输出触到 `Config.scriptMaxOutputBytes` 时出现）。
//      它必须是可选的：宿主 value schema 的 `additionalProperties: false` 只约束**未声明**的键，
//      声明为可选（不进 required、缺失即可）才是合法形态。
test('C 组：v18.2.6 输出 schema 契约（sections 为 json 值；truncated 为可选布尔）', async () => {
  const { installLunhengTools } = await import(pathToFileURL(join(PACKAGE_ROOT, 'lib', 'tools.js')).href)
  const regs = []
  const ctx = { get: (n) => (n === 'tools' ? { register: (d) => { regs.push(d); return () => {} } } : undefined) }
  await installLunhengTools(ctx, {
    skillRoot: join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline'),
    defineToolFactory: async () => ({ defineTool: (def) => def }),
  })
  const byName = new Map(regs.map((t) => [t.name, t]))
  const charProps = byName.get('lunheng_char_count')?.output?.schema?.properties ?? {}
  assert.equal(charProps.sections?.type, 'json', "sections 必须是 DSL 原生 json 节点（v18.2.6 由 JSON 字符串改为规范 JSON 值）")
  for (const n of ['lunheng_char_count', 'lunheng_m_gate']) {
    const props = byName.get(n)?.output?.schema?.properties ?? {}
    assert.equal(props.truncated?.type, 'boolean', `${n} 的 schema 必须声明可选 truncated: boolean（输出截断时出现）`)
    assert.ok(!('required' in (byName.get(n)?.output?.schema ?? {})), `${n} 的 output.schema 不得出现 required（DSL 禁用）`)
  }
})

test('C 组：机制写保护 guard —— 技能包内路径否决、包外放行、主人授权时放行', async () => {
  const mod = await import(pathToFileURL(ENTRY).href)
  const { ctx, captured } = makeCtx({ tools: true })
  mod.apply(ctx)
  await settle()
  assert.equal(captured.guards, 1, '应注册恰好一个全局 guard')
  const guard = captured.guardFn
  assert.ok(typeof guard === 'function')

  const inside = join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md')
  const outside = join(PACKAGE_ROOT, 'docs', 'usage.md')
  const deny = guard({ name: 'write', arguments: { path: inside } })
  assert.equal(typeof deny, 'string', '技能包内路径必须被否决（返回理由）')
  assert.match(deny, /机制文件写保护/)
  assert.match(deny, /LUNHENG_ALLOW_MECH_EDIT/)

  assert.equal(guard({ name: 'write', arguments: { path: outside } }), undefined, '包外路径不得被拦（宁松勿误伤）')
  assert.equal(guard({ name: 'pwsh', arguments: { command: 'echo hi > x' } }), undefined, '非写类工具不在本 guard 职责内（如实边界）')

  // 主人授权 → 放行（env 开关）
  process.env.LUNHENG_ALLOW_MECH_EDIT = '1'
  try {
    assert.equal(guard({ name: 'write', arguments: { path: inside } }), undefined, 'LUNHENG_ALLOW_MECH_EDIT=1 时必须放行')
  } finally {
    delete process.env.LUNHENG_ALLOW_MECH_EDIT
  }
})

test('C 组：/lunheng-status 命令 —— 读 run/<项目> 进展，不产生模型消息（返回 CommandResult）', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const d = mkdtempSync(join(tmpdir(), 'lh-cmd-'))
  const proj = join(d, 'run', 'proj-x')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'status.md'), '# 状态机\n\n| 阶段 | 状态 |\n|---|---|\n| Phase 3 写作 | Running |\n')
  writeFileSync(join(proj, '进展-主人版.md'), '## 进展\n\n- 已完成检索与大纲\n- 正在写初稿\n')
  try {
    const mod = await import(pathToFileURL(ENTRY).href)
    // 命令注册需要 cwd 指向含 run/ 的目录 —— 入口用 process.cwd()，故这里直接调模块函数
    const { installStatusCommand } = await import(pathToFileURL(join(PACKAGE_ROOT, 'lib', 'commands.js')).href)
    const regs = []
    const ctx = { get: (n) => (n === 'commands' ? { register: (def) => { regs.push(def); return () => {} } } : undefined) }
    installStatusCommand(ctx, { cwd: d })
    assert.equal(regs.length, 1)
    const def = regs[0]
    assert.equal(def.name, 'lunheng-status')
    assert.ok(typeof def.description === 'string' && def.description.length > 0, 'description 必填（发现 UI 用）')
    const ok = def.handler({ rawInput: ' proj-x', signal: new AbortController().signal })
    assert.equal(ok.kind, 'success', '有进展时返回 success')
    assert.match(ok.text, /proj-x/)
    assert.match(ok.text, /正在写初稿/, '应带出主人版进展内容')
    const missing = def.handler({ rawInput: ' nope', signal: new AbortController().signal })
    assert.equal(missing.kind, 'success')
    assert.match(missing.text, /未找到项目/, '项目不存在时给可读提示（而非抛错）')

    // v18.2.6（审计 P1-4 修复的回归网）：`run/<项目>` 必须按**会话工作区**解析，而不是宿主启动目录。
    //   旧实现只认 apply 期捕获的 `process.cwd()` —— DSH Desktop / `dsh web` 下那通常是宿主启动目录、
    //   不是用户工作区，于是 `/lunheng-status` 永远报「未找到项目」。现优先取
    //   `invocation.agent.session.header.cwd`（与 fs 工具同源），`opts.cwd` 只作兜底。
    const d2 = mkdtempSync(join(tmpdir(), 'lh-cmd2-'))
    try {
      const proj2 = join(d2, 'run', 'session-proj')
      mkdirSync(proj2, { recursive: true })
      writeFileSync(join(proj2, 'status.md'), '# 状态机\n\n| 阶段 | 状态 |\n|---|---|\n| Phase 4 审计 | Running |\n')
      const viaSession = def.handler({
        rawInput: ' session-proj',
        signal: new AbortController().signal,
        agent: { session: { header: { cwd: d2 } } },
      })
      assert.equal(viaSession.kind, 'success', '带会话工作区的 invocation 必须能命中该项目')
      assert.match(viaSession.text, /session-proj/, '必须按会话工作区解析 run/（不得回落到宿主启动目录）')
      // 反向：同一 invocation 在**没有**会话工作区时只认兜底 cwd → 该项目不存在（证明优先级真的生效）
      const viaFallback = def.handler({ rawInput: ' session-proj', signal: new AbortController().signal })
      assert.match(viaFallback.text, /未找到项目/, '无会话工作区时应回落到 opts.cwd（只认 cwd 下的 run/）')
    } finally {
      rmSync(d2, { recursive: true, force: true })
    }
    // 入口路径也走一遍：process.cwd() 不含 run/ 时不得抛错
    mod.apply({ get: () => undefined, effect: (fn) => fn(), skills: { register: () => () => {} } })
    await settle()
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})
