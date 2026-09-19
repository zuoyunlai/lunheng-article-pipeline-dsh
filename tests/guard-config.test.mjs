// 机制文件写保护 + 插件 Config 回归测试（v18.2.6，第三方全量审计 B-5/B-6/B-7 与 P2-18/P2-19）
//
// 为什么必须有这一条（每条断言都对应一个「曾经真的能绕过」的形态）：
//   · **基准错位**（审计 B-5）：旧 guard 用 `resolve(raw)`，基准是**宿主进程的 `process.cwd()`**；
//     而写工具（`write`/`edit`）把相对路径解析到**会话工作区**（`exec.agent.session.header.cwd`，
//     官方 `dsh-tool-fs/lib/index.js:225-242`）。两者不等时相对路径**直接放行**——而它写的正是受保护文件。
//   · **路径拼写**（审计 B-6）：`e:/…`（小写盘符）、`\\?\E:\…`（长路径前缀）、二层嵌套对象
//     （旧 `writtenPath()` 只递归数组）、补丁文本里的路径（旧实现完全看不到）——旧实现全部放行。
//   · **保护错对象**（审计 B-6 后半）：旧实现只保护**本包安装目录**里那份技能，而本包文档反复强调
//     「项目级副本 rank 100 会静默顶替 bundle rank 250」——于是真正生效的那一份没有任何保护。
//   · **无 Config**（审计 B-3/B-7）：入口只写 `apply(ctx)`，而 Cordis 在插件无 `Config` 时会
//     **原样传第二参数**（`cordis/lib/index.js:1067/:1070`）→ profile 补丁里的 `config:` 被静默丢弃。
//
// 本文件不导出内部函数，而是**真跑一次入口**拿到 guard 与 reporter——测的就是发布物本身的行为。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const ENTRY = join(PACKAGE_ROOT, 'lib', 'index.js')
const SKILL_DIR = join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline')
const SKILL_MD = join(SKILL_DIR, 'SKILL.md')
const LIB_INDEX = join(PACKAGE_ROOT, 'lib', 'index.js')

/** 冲刷入口里那次异步安装（C 组动态 import）并回收输出。 */
const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 5))
}

/**
 * 真跑一次入口，回收 guard / 注册项 / 日志。
 * @param config - 传给 `apply` 的第二参数（v18.2.6 起被真正消费）。
 * @returns `{ guards, regs, logs }`
 */
async function runApply(config) {
  const mod = await import(pathToFileURL(ENTRY).href)
  const guards = []
  const regs = []
  const logs = { info: [], warn: [] }
  const ctx = {
    get: (n) => (n === 'tools'
      ? { register: () => () => {}, guard: (fn) => { guards.push(fn); return () => {} } }
      : undefined),
    effect: (fn) => fn(),
    skills: { register: (d) => { regs.push(d); return () => {} } },
    logger: { info: (m) => logs.info.push(m), warn: (m) => logs.warn.push(m) },
  }
  mod.apply(ctx, config)
  await settle()
  return { guards, regs, logs }
}

/** 构造一次「写」调用的 exec：会话工作区与进程 cwd 可以不同（真实部署里它们常常不同）。 */
const exec = (name, args, sessionCwd) => ({
  name,
  arguments: args,
  ...(sessionCwd === undefined ? {} : { agent: { session: { header: { cwd: sessionCwd } } } }),
})

/** 会话工作区故意选一个与 `process.cwd()` 不同的目录（本测试进程的 cwd = 仓库根，故用其父目录）。 */
const OTHER_WORKSPACE = resolve(PACKAGE_ROOT, '..')

test('B-5 基准错位：会话工作区 ≠ 进程 cwd 时，相对路径写机制文件必须被拦', async () => {
  const { guards } = await runApply()
  assert.equal(guards.length, 1, '入口必须装上写保护（否则后续断言全是假绿）')
  const guard = guards[0]
  // 前提自检：本测试确实处在本报告复现的那个形态里（两个基准不同）
  assert.notEqual(resolve(process.cwd()), resolve(OTHER_WORKSPACE), '夹具无效：请让本测试进程的 cwd 与 OTHER_WORKSPACE 不同')
  const rel = join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md').slice(resolve(OTHER_WORKSPACE).length + 1)
  const reason = await guard(exec('write', { file_path: rel }, OTHER_WORKSPACE))
  assert.ok(reason, `相对路径 "${rel}" 在会话工作区 ${OTHER_WORKSPACE} 下正是受保护文件，必须被拦（审计 B-5 回归）`)
  assert.match(reason, /机制文件写保护/)
})

// ⚠️ 路径拼写变体必须**按平台分表**（v18.2.6 CI 首跑踩到）：
//   `e:/…`（盘符）与 `\\?\E:\…`（长路径前缀）是 **Windows 专属**语义；在 POSIX 上这两个串是
//   **合法的相对路径**（反斜杠是合法文件名字符，`\\?\` 只是个普通目录名），guard 判 ALLOW 才是
//   正确行为——若无条件断言 DENY，ubuntu/macOS 上必红（CI 实测：windows-latest 绿、另三者红）。
//   POSIX 侧改用**同义**的拼写变体（重复分隔符 / 点段）继续覆盖「归一化」这层能力。
const WIN = process.platform === 'win32'
const SPELLING_VARIANTS = WIN
  ? [
      ['小写盘符（Windows 专属）', { file_path: SKILL_MD.replace(/^([A-Za-z]):/, (_, d) => `${d.toLowerCase()}:`) }],
      ['长路径前缀 \\\\?\\（Windows 专属）', { file_path: `\\\\?\\${SKILL_MD.replace(/\//g, '\\')}` }],
    ]
  : [
      ['重复分隔符 //', { file_path: `${SKILL_DIR}//SKILL.md` }],
      ['点段 /.', { file_path: `${SKILL_DIR}/./SKILL.md` }],
    ]

test('B-6 路径拼写：平台专属拼写 / 嵌套对象 / 补丁文本 / `..` 绕行全部被拦', async () => {
  const { guards } = await runApply()
  const guard = guards[0]
  const ws = PACKAGE_ROOT
  const variants = [
    ['绝对路径（正斜杠）', 'write', { file_path: SKILL_MD }],
    ['反斜杠绝对路径', 'write', { file_path: SKILL_MD.replace(/\//g, '\\') }],
    ...SPELLING_VARIANTS.map(([label, args]) => [label, 'write', args]),
    ['二层嵌套对象（旧 writtenPath 不递归对象）', 'write', { edits: { file: { file_path: SKILL_MD } } }],
    ['数组多文件编辑', 'write', { edits: [{ file_path: SKILL_MD }] }],
    ['str_replace_editor 的 path 键', 'str_replace_editor', { command: 'str_replace', path: SKILL_MD }],
    ['apply_patch 补丁文本', 'apply_patch', { patch: `*** Update File: ${SKILL_MD}\n@@\n-a\n+b\n` }],
    ['unified diff 的 b/ 前缀', 'apply_patch', { input: `--- a/${join('lib', 'index.js')}\n+++ b/${join('lib', 'index.js')}\n` }],
    // 用**未归一化**的原串测穿越（旧写法 `join(SKILL_DIR,'references','..','SKILL.md')` 会被 join 提前归一，
    // 等于没测到 guard 的归一化能力——两平台都换成原串）
    ['`..` 绕行', 'write', { file_path: `${SKILL_DIR}/references/../SKILL.md` }],
    ['入口目录 lib/', 'edit', { file_path: LIB_INDEX }],
    ['包级 cordis.patch.yml', 'write', { file_path: join(PACKAGE_ROOT, 'cordis.patch.yml') }],
  ]
  for (const [label, tool, args] of variants) {
    const reason = await guard(exec(tool, args, ws))
    assert.ok(reason, `${label} 必须被拦（审计 B-6 回归）`)
  }
})

test('B-6 后半：同名技能的其它落点（rank 100/200/400）也要保护——否则保护的是「没人读」的那份', async () => {
  const { guards } = await runApply()
  const guard = guards[0]
  const ws = OTHER_WORKSPACE
  const mirrors = [
    join(ws, '.dsh', 'skills', 'lunheng-article-pipeline', 'SKILL.md'),
    join(ws, '.agents', 'skills', 'lunheng-article-pipeline', 'SKILL.md'),
  ]
  for (const p of mirrors) {
    assert.ok(await guard(exec('write', { file_path: p }, ws)), `${p} 是 rank 100/200 的生效副本，必须被拦`)
  }
  // rank 400/500 由 env 指定；设了就必须生效
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = join(ws, 'fake-dsh-home')
  try {
    const { guards: g2 } = await runApply()
    assert.ok(await g2[0](exec('write', { file_path: join(process.env.DSH_HOME, 'skills', 'lunheng-article-pipeline', 'SKILL.md') }, ws)),
      'DSH_HOME/skills（rank 400）在设了 DSH_HOME 时也必须被拦')
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
  }
})

test('不误伤：项目产物 / 包内文档 / tests / 只读工具 一律放行', async () => {
  const { guards } = await runApply()
  const guard = guards[0]
  const ws = PACKAGE_ROOT
  const benign = [
    ['项目产物 run/<项目>/final/定稿.md', 'write', { file_path: join(ws, 'run', 'x', 'final', '定稿.md') }],
    ['包内 README（机制否决刻意不含 docs/README）', 'write', { file_path: join(PACKAGE_ROOT, 'README.md') }],
    ['仓库 tests', 'write', { file_path: join(PACKAGE_ROOT, 'tests', 'entry.test.mjs') }],
    ['skills/scripts 之外的普通文件', 'write', { file_path: join(ws, 'docs', 'faq.md') }],
    ['只读工具 read（名字不在写工具集合内）', 'read', { file_path: SKILL_MD }],
    ['无路径参数（不含 file/path 键）', 'write', { content: 'x' }],
  ]
  for (const [label, tool, args] of benign) {
    assert.equal(await guard(exec(tool, args, ws)), undefined, `${label} 不得被误伤`)
  }
})

test('授权例外：allowed() 为真时放行（env 与 Config 两条路径都要能用）', async () => {
  // 路径 1：Config.allowMechanismEdit
  const cfg = await runApply({ allowMechanismEdit: true })
  assert.equal(await cfg.guards[0](exec('write', { file_path: SKILL_MD }, PACKAGE_ROOT)), undefined,
    'config.allowMechanismEdit=true 必须放行（旧版 guard.js 注释声称有这个开关，而入口当时根本不接 config）')
  // 路径 2：LUNHENG_ALLOW_MECH_EDIT=1
  process.env.LUNHENG_ALLOW_MECH_EDIT = '1'
  try {
    const env = await runApply()
    assert.equal(await env.guards[0](exec('write', { file_path: SKILL_MD }, PACKAGE_ROOT)), undefined,
      'LUNHENG_ALLOW_MECH_EDIT=1 必须放行（既有操作者开关不得因加 Config 而失效）')
  } finally {
    delete process.env.LUNHENG_ALLOW_MECH_EDIT
  }
})

test('B-3/B-7 Config：默认值、合法值、非法值（响亮失败）三条路径', async () => {
  const mod = await import(pathToFileURL(ENTRY).href)
  assert.ok(mod.Config, '入口必须导出 Config（否则 official redline「不得硬编码可调参数」的门永久 skip）')
  assert.equal(typeof mod.Config['~standard']?.validate, 'function', 'Config 必须是 standard-schema 形态（Cordis 靠它校验）')
  const d = mod.resolveConfig(undefined)
  assert.equal(d.allowMechanismEdit, false)
  assert.equal(d.quiet, false)
  assert.equal(d.scriptTimeoutMs, 120000)
  assert.ok(d.scriptMaxOutputBytes > 0, '输出上限必须有默认值（旧版无界缓冲）')
  assert.equal(mod.resolveConfig({ scriptTimeoutMs: 5000 }).scriptTimeoutMs, 5000)
  for (const [label, bad] of [['未知键', { nope: 1 }], ['类型错', { quiet: 'yes' }], ['负数', { scriptTimeoutMs: -1 }], ['整块是数组', []]]) {
    assert.throws(() => mod.resolveConfig(bad), `${label} 必须响亮失败（静默回落 = 审计 B-3 的形态）`)
  }
})

test('B-7 Config 真的被消费：quiet 静音 info、非法 config 不得静默通过', async () => {
  const quiet = await runApply({ quiet: true })
  assert.deepEqual(quiet.logs.info, [], 'config.quiet=true 必须静音 info 级（旧版入口丢弃 config → 静音无效）')
  // 非法 config 经 Cordis 校验会抛；直接调 apply 时也必须在入口内抛（两条路径都不许静默）
  const mod = await import(pathToFileURL(ENTRY).href)
  const ctx = { get: () => undefined, effect: (fn) => fn(), skills: { register: () => () => {} }, logger: { info: () => {}, warn: () => {} } }
  assert.throws(() => mod.apply(ctx, { quiet: 'yes' }), /config/)
})

test('P2-18 description 不得超宿主目录上限 500 字符（超了会静默截断，丢掉「不适用」路由段）', async () => {
  const { regs } = await runApply()
  const desc = regs[0].description
  // 宿主：dsh-tool-skill/lib/index.js:40 DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500，
  // 超出即 slice(0, 497) + '...'（同文件 :359-361）；而 description 是模型侧唯一可见的路由字段。
  assert.ok(desc.length <= 500, `description ${desc.length} 字符 > 500：模型侧会被截断（当前尾部应含「不适用」段）`)
  assert.match(desc, /不适用/, '否定路由必须留在 description 里且不得被截断')
})

test('source 字段与宿主实际档位一致（不得自贴 bundled——bundle 的 rank 是 250，不是 600）', async () => {
  const { regs } = await runApply()
  assert.equal(regs[0].source, 'runtime',
    'v18.2.6 更正：宿主对 ctx.skills.register() 的候选恒取 RUNTIME_RANK=250，「bundled」在官方 rank 表里是 600，自贴会造成读表误判')
  assert.deepEqual(regs[0].resourceBase, { kind: 'directory', path: SKILL_DIR })
})
