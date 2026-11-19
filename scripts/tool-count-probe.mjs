#!/usr/bin/env node
// 三档 subagent 工具「到底装没装」核对探针（v19.27.21 · 第三方全量审计-2026-11-19 §P2-4）
//
// 要解决的问题（挂了十余个版本）：cordis.patch.yml 的三行 disabled: !!js … 决定装完是否多出
//   3 个工具（subagent_retrieval / subagent_strong / subagent_audit），而注释里一直写着
//   「本机 --dump-config 只打印声明行……仍需在能起 headless 的环境核对真实工具清单」。
//   于是「默认零成本」这个卖点在**本机从未被验证过**——用户无法自助确认。
//
// 本脚本给两条互相独立的证据，**刻意分开打印、不混为一谈**：
//   ① 静态推演（无需运行宿主）：读 patch 的 disabled 表达式，按本仓已在 patch 注释里写死的
//      语义（三种 env 组合）判定每行会不会被 loader 裁掉。证据强度 = 「按表达式文本推演」。
//   ② 运行期实测（需要宿主在跑）：GET <base>/lunheng-panel/plugin-info，把宿主自己报的 tiers
//      原样打印。证据强度 = 「宿主进程内的实际配置面」。
//   两者不一致时**以 ② 为准**——那正是「推算 ≠ 现实」该被发现的地方。
//
// ⚠️ 本脚本**不做**的两件事（如实）：
//   · 不 eval 那个表达式（本仓规则 ⑭ 禁止 patch 里出现 eval/new Function 等；脚本侧也不引入
//     求值面）。改为：从表达式里**派生**它引用的 env 名，与 KNOWN_ENV 求差集；差集非空即
//     **exit 10**（「表达式引用了未登记的环境变量，请同步本脚本」）——宁可响亮失败，也不猜。
//   · 不声称自己看到了宿主的**真实工具注册表**。/plugin-info 的 tiers 是配置面事实；真实工具
//     清单需要宿主提供工具注册表读面（当前无），故本脚本不给「工具数 = N」这种假精确。
//
// 用法：
//   node scripts/tool-count-probe.mjs                  # 只做静态推演
//   node scripts/tool-count-probe.mjs --url <base>     # 追加运行期实测（如 http://127.0.0.1:4431）
//   node scripts/tool-count-probe.mjs --json           # 机器可读
//   node scripts/tool-count-probe.mjs --env VAR=VAL    # 按指定 env 推演（不污染本进程；可多次给）
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PATCH = join(PKG_ROOT, 'cordis.patch.yml')

/** 本仓 patch 的三行分档门控引用的环境变量（表达式真源仍是 patch；这里是**对账面**）。 */
const KNOWN_ENV = Object.freeze([
  'LUNHENG_TIERING',
  'LUNHENG_RETRIEVAL_PROVIDER', 'LUNHENG_RETRIEVAL_MODEL',
  'LUNHENG_STRONG_PROVIDER', 'LUNHENG_STRONG_MODEL',
  'LUNHENG_AUDIT_PROVIDER', 'LUNHENG_AUDIT_MODEL',
])

const TIER_IDS = Object.freeze(['tool-subagent-retrieval', 'tool-subagent-strong', 'tool-subagent-audit'])

const argv = process.argv.slice(2)
const wantJson = argv.includes('--json')
const urlAt = argv.indexOf('--url')
const url = urlAt >= 0 ? argv[urlAt + 1] : null
const envOverrides = {}
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--env') continue
  const pair = argv[++i] || ''
  const eq = pair.indexOf('=')
  if (eq > 0) envOverrides[pair.slice(0, eq)] = pair.slice(eq + 1)
}

/** 按本仓 patch 注释里写死的语义推演「该行是否被裁掉」。 */
function inferDisabled(env) {
  const tiering = env.LUNHENG_TIERING
  if (tiering === 'off') return { disabled: true, reason: 'LUNHENG_TIERING=off（优先级最高，强制不装载）' }
  if (tiering) return { disabled: false, reason: 'LUNHENG_TIERING=' + tiering + '（显式开启）' }
  const anyTier = KNOWN_ENV.filter((k) => k !== 'LUNHENG_TIERING').some((k) => env[k])
  if (anyTier) return { disabled: false, reason: '未设 TIERING，但设了任一档的 _PROVIDER/_MODEL → 自动装载' }
  return { disabled: true, reason: '未设任何 LUNHENG_* → 默认不装载（默认零成本）' }
}

/** 从 patch 文本里取每行的 disabled 表达式原文（只取 !!js 形）。 */
function extractDisabledExprs(text) {
  const out = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*disabled:\s*!!js\s+([\s\S]*?)\s*$/.exec(lines[i])
    if (!m) continue
    let id = null
    for (let j = i; j >= 0; j--) {
      const idm = /^\s*-\s*id:\s*(\S+)/.exec(lines[j])
      if (idm) { id = idm[1]; break }
    }
    out.push({ id, line: i + 1, expr: m[1] })
  }
  return out
}

async function fetchPanelInfo(base) {
  const u = base.replace(/\/$/, '') + '/lunheng-panel/plugin-info'
  const res = await fetch(u, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + u)
  return { url: u, body: await res.json() }
}

async function main() {
  const text = readFileSync(PATCH, 'utf8')
  const exprs = extractDisabledExprs(text)

  const missing = TIER_IDS.filter((id) => !exprs.some((e) => e.id === id))
  if (missing.length) {
    console.error('✗ 以下三档行缺少 disabled 行级门控：' + missing.join(' / '))
    console.error('  → 装了本包就会多出对应的 subagent 工具（与「默认零成本」矛盾）。')
    process.exit(10)
  }

  const referenced = new Set()
  for (const e of exprs) for (const m of e.expr.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) referenced.add(m[1])
  const unknownEnv = [...referenced].filter((n) => !KNOWN_ENV.includes(n))
  if (unknownEnv.length) {
    console.error('✗ patch 的 disabled 表达式引用了未登记的环境变量：' + unknownEnv.join(' / '))
    console.error('  → 本脚本按 KNOWN_ENV 推演语义；表达式变了却不登记，推演结果就是错的。')
    console.error('  → 请同步 scripts/tool-count-probe.mjs 的 KNOWN_ENV 与 inferDisabled()。')
    process.exit(10)
  }

  const env = { ...process.env, ...envOverrides }
  const verdict = inferDisabled(env)
  const staticPart = {
    source: 'cordis.patch.yml（按表达式文本推演）',
    envUsed: KNOWN_ENV.filter((k) => env[k]),
    tiersEnabled: !verdict.disabled,
    reason: verdict.reason,
    rows: TIER_IDS.map((id) => ({ id, ...verdict })),
    caveat: '本段是推演，不是宿主内的实测：它回答「按当前 env 这些行会不会被 loader 裁掉」，不回答「宿主真的注册了这些工具」。',
  }

  let runtimePart = null
  if (url) {
    try {
      const r = await fetchPanelInfo(url)
      runtimePart = { source: r.url, tiers: r.body?.tiers ?? null, providers: r.body?.providers ?? null, envWarnings: r.body?.envWarnings ?? null }
    } catch (e) {
      runtimePart = { source: url, error: String(e?.message || e).slice(0, 200) }
    }
  }

  if (wantJson) {
    console.log(JSON.stringify({ static: staticPart, runtime: runtimePart }, null, 2))
    return
  }

  console.log('论衡三档 subagent 工具装载探针')
  console.log('  静态推演（真源 = cordis.patch.yml 的 disabled 表达式）')
  console.log('  env 命中：' + (staticPart.envUsed.length ? staticPart.envUsed.join(' / ') : '（无 LUNHENG_* 环境变量）'))
  console.log('  判定：' + (verdict.disabled ? '三行**均不装载**' : '三行**均装载**') + ' —— ' + verdict.reason)
  for (const r of staticPart.rows) console.log('    · ' + r.id)
  console.log('  ⚠️ ' + staticPart.caveat)
  console.log('')
  if (!runtimePart) {
    console.log('  运行期实测：未请求（加 --url http://127.0.0.1:4431 可对宿主实测）')
  } else if (runtimePart.error) {
    console.log('  运行期实测：**失败** ' + runtimePart.source + ' —— ' + runtimePart.error)
    console.log('  → 这不等于「没装载」；只说明本脚本无法从该地址取到配置面。')
  } else {
    console.log('  运行期实测：' + runtimePart.source)
    console.log('    tiers = ' + JSON.stringify(runtimePart.tiers))
    console.log('    providers = ' + JSON.stringify(runtimePart.providers))
    if (runtimePart.envWarnings && runtimePart.envWarnings.length) console.log('    envWarnings = ' + JSON.stringify(runtimePart.envWarnings))
    console.log('  → 以本段为准（宿主进程内的实际配置面）；与静态推演不一致时说明推演语义已过期。')
  }
}

main().catch((e) => { console.error('tool-count-probe 失败：' + String(e?.message || e)); process.exit(70) })
