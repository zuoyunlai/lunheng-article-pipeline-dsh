#!/usr/bin/env node
/**
 * 论衡打包面检查（CI 用）—— 包装 dsh-plugin-dev check
 *
 * 背景（v2.5.2-dsh.13 补）：论衡自带 consistency-check.mjs 只覆盖 skills/ 下的 .md 漂移
 * （当前 57 个，且已含 10 类机械规则）；本脚本补上「打包面」这一层——cordis.patch.yml 合法性 / 行 id 唯一 /
 * dsh.bundle.patch 指向 / package.json 元数据 / 工程红线，由 dsh-plugin-guide 提供的
 * dsh-plugin-dev CLI 机械判定。两层互补，互不重叠。
 *
 * 豁免（waiver）—— 论衡是「纯 skill bundle」，无 JS 运行时产物：
 *   1) manifest-main  ：不设 main（bundle patch 只叠加 skill filesystem provider +
 *                       3 档 subagent 工具，无入口模块）
 *   2) manifest-files ：files 白名单不含 lib/dist（无构建步骤）
 * 两条均为 dsh-plugin-dev 面向「代码插件」的模板假设，非论衡缺陷。
 *
 * 关键设计：豁免精确到「子条件」而非整个检查项——manifest-files 若因别的原因失败
 * （例如 patch 文件被移出白名单 = 真实回归），仍会拦截。检查项通过时豁免会自动标为
 * 可清理（stale），避免豁免长期滞留。
 *
 * 用法：
 *   node scripts/plugin-surface-check.mjs            # 退出码 0/1
 *   node scripts/plugin-surface-check.mjs --json     # 额外打印原始 JSON 报告
 *   DSH_PLUGIN_DEV_SPEC=dsh-plugin-guide@latest node scripts/plugin-surface-check.mjs
 *
 * CLI 获取策略（按序尝试，任一可用即止）：`DSH_PLUGIN_DEV_CLI` 环境变量 → 本地
 * node_modules → `pnpm dlx` → `npx -y`。为什么不止一种：**npm 10.9.3（Node 22.19 自带）
 * 无法安装本包**——dsh-plugin-guide 声明了 optional peerDependency
 * （`@deepseek-ai/dsh`, `optional: true`），npm 10 的 arborist 在 #loadPeerSet 读取
 * `edgesOut` 时崩溃，导致 npx / npm install 全部不可用；pnpm 的解析器不受影响。
 * （CI 在 Node 22.19 上因此失败过一次，详见 CHANGELOG。）
 *
 * 失败即失败（fail-closed）：所有策略都拿不到合法 JSON → 退出码 1，不静默放行；同时输出
 * GitHub Actions annotation（`::error::`），无需翻日志即可在 UI/API 看到失败原因。
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
/** CLI 版本 pin（可经环境变量覆盖）；与 dsh-plugin-guide 的 npm dist-tag latest 对齐。 */
const CLI_SPEC = process.env.DSH_PLUGIN_DEV_SPEC || 'dsh-plugin-guide@0.3.7'
const TIMEOUT_MS = Number(process.env.DSH_PLUGIN_DEV_TIMEOUT || 300000)

/** 豁免清单：allowPrefixes 命中的问题字符串才放行，其余一律拦截。 */
const WAIVERS = [
  {
    id: 'manifest-main',
    allowPrefixes: ['package.json has no `main` entry'],
    reason: '纯 skill bundle 无 JS 入口模块（patch 只叠加 skill provider + subagent 工具）',
  },
  {
    id: 'manifest-files',
    allowPrefixes: ['files whitelist has no built-artifact directory'],
    reason: '无构建步骤，故无 lib/dist 产物；patch 文件或入口缺失仍会拦截',
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
 * CLI 获取策略（按序尝试）。pnpm 优先于 npx：见文件头对 npm 10.9.3 缺陷的说明。
 * @returns {Array<{label: string, cmd: string}>}
 */
function strategies() {
  const base = []
  const explicit = process.env.DSH_PLUGIN_DEV_CLI
  if (explicit) base.push({ label: 'DSH_PLUGIN_DEV_CLI', argv: ['node', quote(explicit)] })
  const local = path.join(ROOT, 'node_modules', 'dsh-plugin-guide', 'bin', 'dsh-plugin-dev.js')
  if (existsSync(local)) base.push({ label: '本地 node_modules', argv: ['node', quote(local)] })
  base.push({ label: `pnpm dlx ${CLI_SPEC}`, argv: ['pnpm', 'dlx', CLI_SPEC] })
  base.push({ label: `npx -y ${CLI_SPEC}`, argv: ['npx', '-y', CLI_SPEC] })
  return base.map((s) => ({
    label: s.label,
    cmd: [...s.argv, 'check', '--json', '--cwd', quote(ROOT)].join(' '),
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
    return { report, label: s.label }
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

const { report, label } = resolveReport()

const checks = report.checks

if (wantJson) console.log(JSON.stringify(report, null, 2))

const SYMBOL = { pass: '✓', fail: '✗', warn: '!', skip: '-' }
console.log(`\n论衡打包面检查（dsh-plugin-dev via ${label}）· 目标：${ROOT}\n`)

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

const stale = WAIVERS.filter((w) => !waivedUsed.has(w.id))
console.log('\n已声明的豁免（纯 skill bundle，非缺陷）：')
for (const w of WAIVERS) {
  const used = waivedUsed.has(w.id)
  console.log(`  ${used ? '·' : '○'} ${w.id} —— ${w.reason}${used ? '' : '（本次未触发：如已稳定通过，可考虑清理本条豁免）'}`)
}
if (stale.length > 0) console.log(`  ⚠ ${stale.length} 条豁免本次未使用，建议复核后清理`)

const failed = checks.filter((c) => c.status === 'fail').length
const passed = checks.filter((c) => c.status === 'pass').length
const warned = checks.filter((c) => c.status === 'warn').length

if (blocking.length > 0) {
  console.log(`\n✗ 打包面检查未通过：${blocking.length} 个未豁免问题（fail ${failed} / pass ${passed} / warn ${warned}）`)
  for (const b of blocking) console.log(`  - ${b}`)
  annotate('error', `打包面检查未通过：${blocking.length} 个未豁免问题`)
  for (const b of blocking.slice(0, 5)) annotate('error', b)
  process.exit(1)
}

console.log(`\n✓ 打包面检查通过：${passed} 项通过，${failed} 项均为已声明豁免，${warned} 项提示（不阻塞）`)
