#!/usr/bin/env node
/**
 * 论衡打包面检查（CI 用）—— 包装 dsh-plugin-dev check
 *
 * 背景（v2.5.2-dsh.13 补）：论衡自带 consistency-check.mjs 只覆盖 skills/ 下的 .md 漂移
 * （当前 57 个，且已含 10 类机械规则）；本脚本补上「打包面」这一层——cordis.patch.yml 合法性 / 行 id 唯一 /
 * dsh.bundle.patch 指向 / package.json 元数据 / 工程红线，由 dsh-plugin-guide 提供的
 * dsh-plugin-dev CLI 机械判定。两层互补，互不重叠。
 *
 * 豁免（waiver）—— **v18.0.0 起本包无豁免**：早期版本是「纯 skill bundle」（不设 main、
 * files 白名单无 lib/dist），故对下面两条各声明过一条豁免：
 *   1) manifest-main  ：不设 main
 *   2) manifest-files ：files 白名单不含 lib/dist
 * v18.0.0 起本包改为**官方推荐的插件形态**：`lib/index.js` 包入口（`inject = ['skills']` +
 * `ctx.skills.register()`）注册技能，`main` 与 `files: ['lib', ...]` 齐备 —— 两条豁免来源消失，
 * 于是**全部清空**。豁免机制本身保留（见 WAIVERS），但任何新增豁免都必须写明理由并随发布评审；
 * 空白名单下的默认行为是 fail-closed：任一项 fail 都直接拦发布。
 *
 * 关键设计：豁免精确到「子条件」而非整个检查项——若将来重新声明豁免，只有 allowPrefixes
 * 命中的问题字符串才放行（例如 patch 文件被移出白名单 = 真实回归，仍会拦截）。
 * 检查项通过时豁免会自动标为可清理（stale），避免豁免长期滞留。
 *
 * 用法：
 *   node scripts/plugin-surface-check.mjs            # 退出码 0/1（warn 不阻塞）
 *   STRICT_WARN=1 node scripts/plugin-surface-check.mjs   # warn > 0 也阻塞（CI 与发布门用；见下方 WARN_EXEMPT）
 *   node scripts/plugin-surface-check.mjs --json     # 额外打印原始 JSON 报告
 *   DSH_PLUGIN_DEV_SPEC=dsh-plugin-guide@latest node scripts/plugin-surface-check.mjs
 *
 * CLI 获取策略（按序尝试，任一可用即止）：`DSH_PLUGIN_DEV_CLI` 环境变量 → 仓库 `node_modules`
 * → **DSH profile 的 `node_modules`** → `pnpm dlx` → `npx -y`。为什么不止一种：**npm 10.9.3（Node 22.19 自带）
 * 无法安装本包**——dsh-plugin-guide 声明了 optional peerDependency
 * （`@deepseek-ai/dsh`, `optional: true`），npm 10 的 arborist 在 #loadPeerSet 读取
 * `edgesOut` 时崩溃，导致 npx / npm install 全部不可用；pnpm 的解析器不受影响。
 * （CI 在 Node 22.19 上因此失败过一次，详见 CHANGELOG。）
 *
 * ⚠️ **前两条本地策略在本仓是结构性不可达的（v18.2.6 如实更正旧头注释）**：本仓**没有 lockfile、
 * 没有 devDependencies、也没有 `node_modules/`**（刻意不引入依赖树，见 ci.yml 里「为什么不加 cache: pnpm」
 * 的注释）。旧头注释把「本地优先」写成了可用路径，实际每次都要落到 `pnpm dlx`（**从 registry 现场下载**）。
 * 故 v18.2.6 补第三条：**DSH profile 里已装的 dsh-plugin-guide**（`<DSH_HOME>/profiles/<profile>/node_modules/
 * dsh-plugin-guide/bin/dsh-plugin-dev.js`，本机 = 0.3.10）——有则直接用，零下载；CI 上不存在，自动落到 dlx。
 * 无论走哪条，**实际解析到的 CLI 版本都会打印出来**（取自 CLI 报告的 `version` 字段），并校验与 pin 是否一致。
 *
 * 失败即失败（fail-closed）：所有策略都拿不到合法 JSON → 退出码 1，不静默放行；同时输出
 * GitHub Actions annotation（`::error::`），无需翻日志即可在 UI/API 看到失败原因。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
/**
 * CLI 版本 pin（可经 `DSH_PLUGIN_DEV_SPEC` 覆盖）。
 * v18.2.6 抬升 0.3.7 → **0.3.10**：0.3.7 已落后上游三版，且旧 pin 下的门数与仓库文档口径不一致
 *   （文档写「14 项：11 通过 / 3 跳过」，而 0.3.10 实测 **9 通过 / 1 warn / 4 skip**，warn = CLI 期望
 *   `README-zh.md` 连字符命名，见下方 WARN_EXEMPT）。抬高 pin 的意义不是「追新」，而是让**门与文档
 *   对齐到同一个可复现的 CLI 版本**；抬升后必须重跑本脚本并把实际数字写回文档（本次已写回）。
 */
const CLI_SPEC = process.env.DSH_PLUGIN_DEV_SPEC || 'dsh-plugin-guide@0.3.10'
const TIMEOUT_MS = Number(process.env.DSH_PLUGIN_DEV_TIMEOUT || 300000)
/** warn 是否阻塞（`STRICT_WARN=1`）：CI 与发布门打开——「0 warn」此前只是文档承诺，代码并不阻塞。 */
const STRICT_WARN = process.env.STRICT_WARN === '1' || process.env.STRICT_WARN === 'true'

/**
 * 豁免清单：allowPrefixes 命中的问题字符串才放行，其余一律拦截。
 *  v18.0.0：清空——本包已有 main + lib/ 入口，manifest-main / manifest-files 两条豁免不再需要，
 *  目标是「0 fail / 0 warn / 0 豁免」。新增条目必须写明 reason 并随发布评审。 */
const WAIVERS = []

/**
 * **允许 skip 的检查项白名单**（v18.2.6 新增，fail-closed 的另一半）。
 * 动机：`dsh-plugin-dev check` 的 `skip` 既可能是「本包没有该面可查」（正常），也可能是**上游把一条
 *   本应判定的检查改成 skip**（那样它就从「门」退化成「永久绿」——本包最反感的静默失效形态）。
 * 故：**skip 只允许出现在这张表里**；出现表外 skip → 直接判失败（并提示「如果是上游新增检查，请先人工
 *   确认它不该对本包判定，再把 id 登记进来」）。表内每项都写清「为什么它是 skip 而不是 pass」。
 * 同时打印表内**未触发**的条目（上游行为变化时可据此清理，避免白名单变成橡皮图章）。
 */
const SKIP_ALLOWED = new Map([
  ['readme-consistency', 'CLI 的 README_LANGS 只认连字符命名（README-zh.md…）；本仓用 README.<lang>.md 点号命名，故它「找不到两份可比的 README」。见 WARN_EXEMPT 的 readme-five-langs 同源说明'],
  ['redline-persona-role', '该检查找**仓库根**的 SKILL.md / systemPrompt 段落，而本包（bundle 形态）的技能体在 skills/lunheng-article-pipeline/SKILL.md —— 结构上永远看不到'],
  ['redline-waterfall-next', '本包不用任何 waterfall 监听器（能力面走 ctx.effect / ctx.tools.guard / ctx.commands.register），没有 next() 可漏'],
  ['redline-no-hardcoded-tunables', 'CLI 只认 `export const Config = Schema.…`（Schemastery）与 `= {`（会被判 fail）；本包入口刻意用 standard-schema 形态 `Object.freeze({…})`（不引入宿主依赖，见 lib/index.js 头注释）→ 三条正则都不命中，只能 skip。**已实测**（CLI dist 0.3.10 的 checkRedlineNoHardcodedTunables：:1065-1066,1077）。等价语义由 tests/entry.test.mjs 的 Config 用例与「非法配置加载期响亮失败」覆盖'],
])

/**
 * **`STRICT_WARN=1` 下仍被豁免的 warn**（v18.2.6 新增）：每一项都必须写清理由与退出条件，
 * 未触发的条目会在输出里被点名（便于清理）。**表外的任何 warn 都在 strict 模式下阻塞**。
 */
const WARN_EXEMPT = [
  {
    id: 'readme-five-langs',
    reason: 'CLI 期望 `README-zh.md` 等**连字符**命名，而本仓沿用 `README.zh.md` 点号命名（npm 侧合法：readmeFilename 由 npm 自己探测）。改成连字符是对外可见的重命名，牵动 consistency-check 规则 ⑦/⑬/㉑（`fiveLangs` 数组硬编码点号名）、五语 README 互链、`package.json.files`，属跨文件协调改动 → 本批（v18.2.6）**不重命名**，改为在此显式登记并写进 CONTRIBUTING 的待办；一旦完成重命名，本条应删除（脚本会提示未触发）。',
  },
]

const wantJson = process.argv.includes('--json')
const isCI = Boolean(process.env.GITHUB_ACTIONS)

/** 输出 GitHub Actions annotation（让 CI 失败原因在 UI 与 API 可见，不必翻日志）。 */
function annotate(level, message) {
  if (!isCI) return
  const one = String(message).replace(/\r?\n/g, ' ').trim()
  if (one) console.log(`::${level}::${one.slice(0, 900)}`)
}

/** Windows 下 spawn 无法直接执行 .cmd，需要 shell，故自行加引号。 */
function quote(s) {
  return /[\s"]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s
}

/**
 * 找出 DSH 各 profile 里**已经装好的** dsh-plugin-guide（v18.2.6 新增；零下载路径）。
 * 为什么需要：本仓没有 lockfile / devDependencies / node_modules（刻意），上一条「本地 node_modules」
 *   策略因此结构性不可达；而开发机与 CI 之外的运行环境里，DSH profile 通常**已经装了**这个包
 *   （本机 `~/.dsh/profiles/desktop/node_modules/dsh-plugin-guide` = 0.3.10）。有则直接用，
 *   避免每次为一道静态门从 registry 现场下载一个 CLI。
 * @returns {Array<{label: string, file: string}>} 命中的候选（按版本号降序，最多取前 3 个）
 */
function profileInstalls() {
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  if (!home) return []
  const profilesDir = path.join(home, 'profiles')
  if (!existsSync(profilesDir)) return []
  let names = []
  try { names = readdirSync(profilesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch { return [] }
  const found = []
  for (const n of names) {
    const bin = path.join(profilesDir, n, 'node_modules', 'dsh-plugin-guide', 'bin', 'dsh-plugin-dev.js')
    if (!existsSync(bin)) continue
    let version = '?'
    try {
      version = JSON.parse(readFileSync(path.join(profilesDir, n, 'node_modules', 'dsh-plugin-guide', 'package.json'), 'utf8')).version || '?'
    } catch { /* 读不到版本不影响使用 */ }
    found.push({ label: `DSH profile「${n}」的 dsh-plugin-guide@${version}`, file: bin, version })
  }
  return found.sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true })).slice(0, 3)
}

/**
 * CLI 获取策略（按序尝试）。pnpm 优先于 npx：见文件头对 npm 10.9.3 缺陷的说明。
 * @returns {Array<{label: string, cmd: string}>}
 */
function strategies() {
  const base = []
  const explicit = process.env.DSH_PLUGIN_DEV_CLI
  if (explicit) base.push({ label: 'DSH_PLUGIN_DEV_CLI', argv: ['node', quote(explicit)] })
  const local = path.join(ROOT, 'node_modules', 'dsh-plugin-guide', 'bin', 'dsh-plugin-dev.js')
  if (existsSync(local)) base.push({ label: '本地 node_modules', argv: ['node', quote(local)] })
  // 结构性不可达的说明见文件头；下面是**真正可用**的本地路径（DSH profile 里已装的副本）
  for (const p of profileInstalls()) base.push({ label: p.label, argv: ['node', quote(p.file)] })
  base.push({ label: `pnpm dlx ${CLI_SPEC}`, argv: ['pnpm', 'dlx', CLI_SPEC] })
  base.push({ label: `npx -y ${CLI_SPEC}`, argv: ['npx', '-y', CLI_SPEC] })
  return base.map((s) => ({
    label: s.label,
    cmd: [...s.argv, 'check', '--json', '--cwd', quote(ROOT)].join(' '),
    // 策略标签里带版本时，用它做「实际解析到哪个版本」的**独立于 CLI 报告**的第二证据
    hinted: /@(\d+\.\d+\.\d+)/.exec(s.label)?.[1] || null,
  }))
}

function runCommand(cmd) {
  return spawnSync(cmd, {
    shell: true,
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  })
}

/** 依次尝试各获取策略，直到拿到可解析的报告；全败则 fail-closed。 */
function resolveReport() {
  const tried = []
  for (const s of strategies()) {
    const res = runCommand(s.cmd)
    if (res.error) {
      tried.push(`${s.label} → 无法执行：${res.error.message}`)
      continue
    }
    const stdout = res.stdout ?? ''
    const start = stdout.indexOf('{')
    if (start < 0) {
      const tail = String(res.stderr || stdout).trim().split('\n').slice(-2).join(' / ')
      tried.push(`${s.label} → 未输出 JSON（退出码 ${res.status}）：${tail}`)
      continue
    }
    let report
    try {
      report = JSON.parse(stdout.slice(start))
    }
    catch (err) {
      tried.push(`${s.label} → JSON 解析失败：${err.message}`)
      continue
    }
    if (!Array.isArray(report?.checks) || report.checks.length === 0) {
      tried.push(`${s.label} → 报告里没有检查项（CLI 版本不兼容？）`)
      continue
    }
    if (tried.length > 0) console.log(`（已跳过 ${tried.length} 个不可用策略，改用：${s.label}）\n`)
    return { report, label: s.label, hinted: s.hinted }
  }
  annotate('error', '打包面检查无法完成：所有 CLI 获取策略均失败')
  for (const t of tried) annotate('error', t)
  fail('所有 CLI 获取策略均失败', tried.join('\n'))
}

/** 一个检查项的「有效问题」：有 detail 用 detail，否则用 message。 */
function problemsOf(check) {
  const detail = check?.detail
  if (Array.isArray(detail) && detail.length > 0) return detail.map(String)
  return [String(check?.message ?? '')]
}

/** 返回未被豁免覆盖的阻塞问题（已豁免的返回空数组）。 */
function blockingProblems(check) {
  if (check?.status !== 'fail') return []
  const waiver = WAIVERS.find((w) => w.id === check.id)
  const problems = problemsOf(check)
  if (!waiver) return problems
  return problems.filter((p) => !waiver.allowPrefixes.some((pre) => p.startsWith(pre)))
}

function fail(msg, extra) {
  annotate('error', `打包面检查无法完成：${msg}`)
  console.error(`\n✗ 打包面检查无法完成：${msg}`)
  if (extra) console.error(String(extra).trim().split('\n').slice(-15).join('\n'))
  console.error('  （fail-closed：不因工具异常而静默放行）')
  process.exit(1)
}

if (!existsSync(path.join(ROOT, 'package.json'))) fail(`仓库根未找到 package.json：${ROOT}`)

const { report, label, hinted } = resolveReport()

const checks = report.checks

if (wantJson) console.log(JSON.stringify(report, null, 2))

const SYMBOL = { pass: '✓', fail: '✗', warn: '!', skip: '-' }
const cliVersion = String(report.version || '未知')
console.log(`\n论衡打包面检查（dsh-plugin-dev via ${label}）· 目标：${ROOT}`)
// v18.2.6：**打印实际解析到的 CLI 版本**（旧版只打策略名，pin 漂了也看不出来）。
//   两个独立证据：① CLI 报告里的 `version` 字段；② 策略标签里带的版本（profile 副本/显式 pin）。
//   与 pin 不一致时只**提示**不失败——`DSH_PLUGIN_DEV_SPEC` 是给维护者临时试新版用的合法覆盖。
console.log(`CLI 版本：${cliVersion}（pin = ${CLI_SPEC}${hinted && hinted !== cliVersion ? `；策略标签给出 ${hinted}` : ''}）\n`)
if (CLI_SPEC.includes('@') && cliVersion !== '未知' && !CLI_SPEC.endsWith(`@${cliVersion}`) && !hinted) {
  console.log(`⚠ 实际 CLI 版本 ${cliVersion} 与 pin ${CLI_SPEC} 不一致——若这是上游换了 dlx/npx 的解析结果，请复核 pin 是否需要抬升\n`)
}

const blocking = []
const waivedUsed = new Set()

for (const check of checks) {
  const problems = blockingProblems(check)
  const isWaived = check.status === 'fail' && problems.length === 0
  if (isWaived) waivedUsed.add(check.id)
  const sym = isWaived ? '✓' : (SYMBOL[check.status] ?? '?')
  console.log(`${sym} [${check.id}] ${check.message}`)
  if (check.detail?.length && check.status !== 'pass' && !isWaived) {
    for (const d of check.detail) console.log(`    - ${d}`)
  }
  for (const p of problems) blocking.push(`[${check.id}] ${p}`)
}

// ── skip 上界断言（v18.2.6）──────────────────────────────────────────────────
// 见 SKIP_ALLOWED 的说明：表外 skip = 上游把一条判定检查改成了永绿，必须拦。
const skipIds = checks.filter((c) => c.status === 'skip').map((c) => c.id)
const unexpectedSkips = skipIds.filter((id) => !SKIP_ALLOWED.has(id))
for (const id of unexpectedSkips) {
  blocking.push(`[skip-bound] 检查项「${id}」被 CLI 判为 skip，但它不在 SKIP_ALLOWED 白名单里——skip 等于该检查对本包**永久不判定**（不再是门）。请人工确认它确实不该对本包判定，再把 id 与理由登记进 scripts/plugin-surface-check.mjs 的 SKIP_ALLOWED`)
}
console.log(`\nskip 上界：${skipIds.length} 项 skip（白名单 ${SKIP_ALLOWED.size} 项，表外 ${unexpectedSkips.length} 项）`)
for (const id of skipIds) {
  console.log(SKIP_ALLOWED.has(id)
    ? `  · [${id}] 已登记：${SKIP_ALLOWED.get(id)}`
    : `  ✗ [${id}] **未登记**（判失败）`)
}
const staleSkips = [...SKIP_ALLOWED.keys()].filter((id) => !skipIds.includes(id))
if (staleSkips.length > 0) console.log(`  ⚠ 白名单里 ${staleSkips.length} 项本次未触发（上游可能已开始判定，或已移除该检查）：${staleSkips.join(', ')}`)

// ── warn 阻塞（`STRICT_WARN=1`）──────────────────────────────────────────────
// 旧版只看 `failed === 0`，于是「0 warn」只是文档承诺；而 warn 恰恰是「本包不该有的形态」
//（如 manifest 缺 packageManager）落地的唯一可见处。CI 与发布门统一打开 STRICT_WARN=1。
const warnIds = checks.filter((c) => c.status === 'warn').map((c) => c.id)
const exemptIds = new Set(WARN_EXEMPT.map((w) => w.id))
const unexemptWarns = warnIds.filter((id) => !exemptIds.has(id))
console.log(`\nwarn 口径：STRICT_WARN=${STRICT_WARN ? '1（warn 阻塞）' : '未设（warn 仅提示）'}｜本次 warn ${warnIds.length} 项（显式豁免 ${WARN_EXEMPT.length} 项）`)
for (const w of WARN_EXEMPT) {
  const hit = warnIds.includes(w.id)
  console.log(`  ${hit ? '·' : '○'} [${w.id}] ${w.reason}${hit ? '' : '（本次未触发：如已完成对应改造，可删除本条豁免）'}`)
}
if (STRICT_WARN) {
  for (const id of unexemptWarns) {
    blocking.push(`[strict-warn] 检查项「${id}」报 warn——STRICT_WARN=1 下 warn 视为阻塞（0 warn 是本仓对外的承诺；若确需长期豁免，请登记进 WARN_EXEMPT 并写明理由与退出条件）`)
  }
}

const stale = WAIVERS.filter((w) => !waivedUsed.has(w.id))
if (WAIVERS.length === 0) {
  console.log('\n豁免：无（v18.0.0 起本包自证通过全部检查项；任何 fail 都是发布阻塞项）')
} else {
  console.log('\n已声明的豁免：')
  for (const w of WAIVERS) {
    const used = waivedUsed.has(w.id)
    console.log(`  ${used ? '·' : '○'} ${w.id} —— ${w.reason}${used ? '' : '（本次未触发：如已稳定通过，可考虑清理本条豁免）'}`)
  }
  if (stale.length > 0) console.log(`  ⚠ ${stale.length} 条豁免本次未使用，建议复核后清理`)
}

const failed = checks.filter((c) => c.status === 'fail').length
const passed = checks.filter((c) => c.status === 'pass').length
const warned = checks.filter((c) => c.status === 'warn').length

// ── 本包自加的补充检查（v18.0.5，第三方审计 P1-6）─────────────────────────────
// 动机：`dsh-plugin-dev check` 的 `manifest-peers` 只扫**源码 import**——不看 `cordis.patch.yml` 里
//   `name:` 引用了哪些包。于是本包 patch 里的三行 `@deepseek-ai/dsh-tool-subagent` **没有任何声明**，
//   而负对照实测：把行名改成不存在的包 → `failed to import loader entry …` → **整棵 profile 起不来**。
// 规则：patch 里每个 `name:` 必须是①本包自己的名字（自注册行）②`dependencies`/`peerDependencies`
//   里声明过的包，或③显式白名单里的宿主核心包（宿主标准组合树自带、无法也不该由本包声明版本）。
const HOST_CORE_ALLOW = new Set(['@deepseek-ai/dsh-base'])
const pkgPath = path.join(ROOT, 'package.json')
const patchPath = path.join(ROOT, 'cordis.patch.yml')
if (existsSync(pkgPath) && existsSync(patchPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const declared = new Set([
    pkg.name,
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
    ...HOST_CORE_ALLOW,
  ])
  const patchText = readFileSync(patchPath, 'utf8')
  const rowNames = [...patchText.matchAll(/^\s*-?\s*name:\s*['"]?([^'"\s#]+)['"]?\s*$/gm)].map((m) => m[1])
  const undeclared = [...new Set(rowNames)].filter((n) => !declared.has(n))
  for (const n of undeclared) {
    blocking.push(
      `[patch-deps] cordis.patch.yml 的行 name「${n}」既不是本包名，也没在 package.json 的 dependencies/peerDependencies 里声明——宿主升级改名/移除该包时，组合树 import 失败会让整个 profile 起不来（请在 peerDependencies 声明，或加入本文件的 HOST_CORE_ALLOW 白名单并写明理由）`,
    )
  }
  console.log(
    `\n自加补充检查（v18.0.5）：\n${undeclared.length === 0 ? '✓' : '✗'} [patch-deps] patch 行 name ${rowNames.length} 处，均已在 package.json 声明或属宿主核心包白名单`,
  )
}

if (blocking.length > 0) {
  console.log(`\n✗ 打包面检查未通过：${blocking.length} 个未豁免问题（fail ${failed} / pass ${passed} / warn ${warned}）`)
  for (const b of blocking) console.log(`  - ${b}`)
  annotate('error', `打包面检查未通过：${blocking.length} 个未豁免问题`)
  for (const b of blocking.slice(0, 5)) annotate('error', b)
  process.exit(1)
}

console.log(
  (failed === 0
    ? `\n✓ 打包面检查通过：${passed} 项通过，0 项失败，${warned} 项提示（${STRICT_WARN ? 'STRICT_WARN=1：已逐一核对豁免' : '不阻塞'}）`
    : `\n✓ 打包面检查通过：${passed} 项通过，${failed} 项均为已声明豁免，${warned} 项提示（${STRICT_WARN ? 'STRICT_WARN=1：已逐一核对豁免' : '不阻塞'}）`)
  + `｜skip ${skipIds.length} 项（均在 SKIP_ALLOWED 白名单内）`
  + `｜CLI ${cliVersion}`,
)
