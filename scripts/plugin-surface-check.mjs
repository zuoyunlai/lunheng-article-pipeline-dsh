#!/usr/bin/env node
/**
 * 论衡打包面检查（CI 用）—— 包装 dsh-plugin-dev check
 *
 * 背景（v2.5.2-dsh.12 补）：论衡自带 consistency-check.mjs 只覆盖 skills/ 下 73 个
 * .md 的漂移；本脚本补上「打包面」这一层——cordis.patch.yml 合法性 / 行 id 唯一 /
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
 * 失败即失败（fail-closed）：CLI 无法运行 / 输出不是合法 JSON → 退出码 1，不静默放行。
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

/** Windows 下 spawn 无法直接执行 .cmd，需要 shell，故自行加引号。 */
function quote(s) {
  return /[\s"]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s
}

function runCli() {
  const cmd = ['npx', '-y', '-p', CLI_SPEC, 'dsh-plugin-dev', 'check', '--json', '--cwd', ROOT]
    .map(quote)
    .join(' ')
  return spawnSync(cmd, {
    shell: true,
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  })
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
  console.error(`\n✗ 打包面检查无法完成：${msg}`)
  if (extra) console.error(String(extra).trim().split('\n').slice(-15).join('\n'))
  console.error('  （fail-closed：不因工具异常而静默放行）')
  process.exit(1)
}

if (!existsSync(path.join(ROOT, 'package.json'))) fail(`仓库根未找到 package.json：${ROOT}`)

const res = runCli()
if (res.error) fail(`无法执行 npx（${CLI_SPEC}）：${res.error.message}`)

const stdout = res.stdout ?? ''
const start = stdout.indexOf('{')
if (start < 0) fail(`CLI 输出不是 JSON（退出码 ${res.status}）`, res.stderr || stdout)

let report
try {
  report = JSON.parse(stdout.slice(start))
}
catch (err) {
  fail(`JSON 解析失败：${err.message}`, stdout.slice(0, 800))
}

const checks = Array.isArray(report?.checks) ? report.checks : []
if (checks.length === 0) fail('报告里没有任何检查项（CLI 版本不兼容？）', stdout.slice(0, 400))

if (wantJson) console.log(JSON.stringify(report, null, 2))

const SYMBOL = { pass: '✓', fail: '✗', warn: '!', skip: '-' }
console.log(`\n论衡打包面检查（dsh-plugin-dev via ${CLI_SPEC}）· 目标：${ROOT}\n`)

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
  process.exit(1)
}

console.log(`\n✓ 打包面检查通过：${passed} 项通过，${failed} 项均为已声明豁免，${warned} 项提示（不阻塞）`)
