#!/usr/bin/env node
// 宿主契约**产物探针**（v18.76.0 新增 —— v18.75.1 全量架构审计 R3 · P1 修复）。
//
// 为什么需要（R3 的根因）：本包对宿主的三处接缝（`tools/post-execute` / `system-prompt/assemble` /
//   `agent/request`）此前只有**静态正则门**（`scripts/_lib/host-contract.mjs` 解析本包自己的
//   `ctx.on(...)` 形参个数），而**没有任何东西去读宿主产物**。于是：
//     · `lib/index.js` 的 H2 监听器把标记写在 `result` 上 → 真宿主深冻 + 白名单投影**双杀**（P0，静默）；
//     · H7 读 `request.toolName` → 该事件 payload 里根本没有这个键（P1，恒空转）；
//   两者都能通过既有全部门与 737 条用例。判据：**门比对产物，而不是比对注释**。
//
// 三条断言（对齐 R3 的最小修复）：
//   ① 三处派发点的**实参形态**（含 `agent/request` 的 payload 键集合）必须与契约表一致；
//   ② `materializeFinalResult()` 引用的 `result.*` 字段集合必须**恰好等于**字段白名单（增删即红）；
//   ③ 本地已装 `@deepseek-ai/dsh-tools` 的 version 必须 == `CONTRACT_HOST_VERSION`（版本不再靠散文注释）。
//
// 退出码：0 通过（或产物缺失且未要求 host）；1 任一断言失败 / 产物缺失但 `--require-host`。
// 用法：`node scripts/host-contract-probe.mjs [--require-host] [--json]`
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONTRACT_HOST_VERSION,
  HOST_CONTRACT,
  HOST_DISPATCH,
  MATERIALIZE_WHITELIST,
} from './_lib/host-contract.mjs'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 空白归一：宿主产物用 tab 缩进、注释换行位置随版本变，逐字符对照必然假红。 */
export const norm = (s) => String(s).replace(/\s+/g, ' ')

const SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[0-9A-Za-z][0-9A-Za-z.]*)?$/

/**
 * 定位已装宿主产物。pnpm 只把**直接声明**的 peer 软链到 `node_modules/@deepseek-ai/`，
 * 传递依赖（dsh-agent-loop / dsh-system-prompt）只在 `.pnpm` 里 → 三个候选位置依次试。
 * @param {string} root - 仓库根。
 * @returns {{ files: Record<string,string|null>, toolsVersion: string|null }}
 */
export function resolveHostArtifacts(root = REPO_ROOT) {
  const direct = (pkg, rel) => join(root, 'node_modules', '@deepseek-ai', pkg, rel)
  // pnpm 的目录命名在带 peer 时是 `@deepseek-ai+<pkg>_<hash>`（**不带 `@version`**），故不能靠名字匹配版本；
  //   判据改为「该候选路径真的存在」。传递依赖（dsh-system-prompt 等）只作为**别的包的兄弟目录**存在
  //   （例：`.pnpm/@deepseek-ai+dsh-agent-loop_<hash>/node_modules/@deepseek-ai/dsh-system-prompt`），
  //   故遍历所有 `@deepseek-ai+…dsh…` 的 store 目录找兄弟。
  const siblings = () => {
    const store = join(root, 'node_modules', '.pnpm')
    if (!existsSync(store)) return []
    return readdirSync(store)
      .filter((d) => d.startsWith('@deepseek-ai+') && d.includes('dsh'))
      .map((d) => join(store, d, 'node_modules', '@deepseek-ai'))
  }
  const pick = (pkg, rel = join('lib', 'index.js')) => {
    const p = direct(pkg, rel)
    if (existsSync(p)) return p
    for (const s of siblings()) {
      const q = join(s, pkg, rel)
      if (existsSync(q)) return q
    }
    return null
  }
  const toolsEntry = pick('dsh-tools')
  let toolsVersion = null
  const toolsPkgJson = pick('dsh-tools', 'package.json')
  if (toolsPkgJson) {
    try { toolsVersion = JSON.parse(readFileSync(toolsPkgJson, 'utf8')).version ?? null } catch { toolsVersion = null }
  }
  return {
    files: {
      'dsh-tools': toolsEntry,
      'dsh-agent-loop': pick('dsh-agent-loop'),
      'dsh-system-prompt': pick('dsh-system-prompt'),
    },
    toolsVersion,
  }
}

/**
 * 取一个类方法的**函数体文本**（从 `name(…args) {` 到同级缩进的 `}`）。
 * 只用于断言「白名单没变」，不需要通用 JS 解析器。
 * @param {string} src - 源码全文。
 * @param {string} signaturePrefix - 形如 `materializeFinalResult(result) {`。
 * @returns {string|null}
 */
export function sliceMethodBody(src, signaturePrefix) {
  const at = src.indexOf(signaturePrefix)
  if (at < 0) return null
  const rest = src.slice(at + signaturePrefix.length)
  const end = rest.search(/\n\t\}/)
  return end < 0 ? rest : rest.slice(0, end)
}

/**
 * 纯函数形态的断言集（**可被测试双向驱动**：喂真产物 → 绿；喂篡改产物 → 红并指名变化点）。
 * @param {{toolsSrc?:string, agentLoopSrc?:string, systemPromptSrc?:string, installedToolsVersion?:string|null, tables?:object}} input
 * @returns {{ errors: string[], checks: Array<{name:string, ok:boolean, detail:string}> }}
 */
export function probeContracts(input) {
  const {
    toolsSrc = '',
    agentLoopSrc = '',
    systemPromptSrc = '',
    installedToolsVersion = null,
    tables = { HOST_CONTRACT, HOST_DISPATCH, MATERIALIZE_WHITELIST, CONTRACT_HOST_VERSION },
  } = input
  const errors = []
  const checks = []
  const add = (name, ok, detail) => { checks.push({ name, ok, detail }); if (!ok) errors.push(`${name}：${detail}`) }

  // ① 契约表自洽：arity == params.length、since 合法、host 非空、payloadKeys 与派发形态一致
  for (const [event, c] of Object.entries(tables.HOST_CONTRACT)) {
    add(`契约表自洽 ${event}`, c.params.length === c.arity, `arity=${c.arity} 与 params(${c.params.length}) 不等`)
    add(`契约表 since ${event}`, typeof c.since === 'string' && SEMVER.test(c.since), `since 缺失或非 semver：${String(c.since)}`)
    add(`契约表 host ${event}`, typeof c.host === 'string' && c.host.length > 0, 'host 字段缺失（无从回查真源）')
  }

  // ② 派发形态（产物级）：子串必须出现在归一化后的宿主源码里
  const srcOf = (event) => ({ 'tools/post-execute': toolsSrc, 'system-prompt/assemble': systemPromptSrc, 'agent/request': agentLoopSrc })[event] ?? ''
  for (const [event, expect] of Object.entries(tables.HOST_DISPATCH)) {
    const src = srcOf(event)
    if (!src) { add(`派发形态 ${event}`, false, '宿主产物缺失（未安装 / 路径未解析到）'); continue }
    add(`派发形态 ${event}`, norm(src).includes(norm(expect)), `宿主产物里找不到归一化形态 「${expect}」——派发实参或 payload 键集合已变`)
  }

  // ③ 结果字段白名单（产物级）：materializeFinalResult 引用的 result.* 集合必须恰好等于白名单
  const body = sliceMethodBody(toolsSrc, 'materializeFinalResult(result) {')
  if (body === null) {
    add('字段白名单', false, '宿主产物里找不到 `materializeFinalResult(result) {`——方法改名/搬家')
  } else {
    const fields = [...new Set([...body.matchAll(/result\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))].sort()
    const want = [...tables.MATERIALIZE_WHITELIST].sort()
    const missing = want.filter((f) => !fields.includes(f))
    const extra = fields.filter((f) => !want.includes(f))
    add(
      '字段白名单',
      missing.length === 0 && extra.length === 0,
      `期望 [${want.join(', ')}]，产物 [${fields.join(', ')}]` +
        (extra.length ? `｜**新增/未登记**：${extra.join(', ')}（插件写在 result 上的该字段会被丢弃，须同步本表与 SECURITY.md）` : '') +
        (missing.length ? `｜**消失**：${missing.join(', ')}` : ''),
    )
    // 深冻（D1）也一并盯住：监听器拿到的是冻结对象，赋值必抛
    add(
      '结果深冻',
      /materializePresentation\(candidate\) \{[\s\S]{0,200}?return deepFreeze\(detached\)/.test(toolsSrc),
      '`materializePresentation` 里不再 `return deepFreeze(detached)`——「宿主传入 result 只读」的前提变了（本包 H2 已不写 result，但该前提仍是注释契约的一部分）',
    )
  }

  // ④ 版本：本地实装宿主的 version 必须 == 契约表注明的探针目标版本
  if (installedToolsVersion === null) {
    add('探针目标版本', false, '读不到已装 @deepseek-ai/dsh-tools 的 version（未安装？）')
  } else {
    add(
      '探针目标版本',
      installedToolsVersion === tables.CONTRACT_HOST_VERSION,
      `实装 ${installedToolsVersion} ≠ 契约表 CONTRACT_HOST_VERSION ${tables.CONTRACT_HOST_VERSION}` +
        '（要么同步常量并重核三处派发点，要么把 lockfile 钉回该版本——**不得只改注释**）',
    )
  }

  return { errors, checks }
}

function main() {
  const argv = process.argv.slice(2)
  const requireHost = argv.includes('--require-host')
  const asJson = argv.includes('--json')
  const { files, toolsVersion } = resolveHostArtifacts()
  const read = (p) => (p ? readFileSync(p, 'utf8') : '')
  const missing = Object.entries(files).filter(([, p]) => !p).map(([k]) => k)
  const { errors, checks } = probeContracts({
    toolsSrc: read(files['dsh-tools']),
    agentLoopSrc: read(files['dsh-agent-loop']),
    systemPromptSrc: read(files['dsh-system-prompt']),
    installedToolsVersion: toolsVersion,
  })
  const ok = errors.length === 0
  if (asJson) {
    console.log(JSON.stringify({ ok, requireHost, missing, toolsVersion, errors, checks }, null, 2))
  } else {
    console.log(`宿主契约产物探针（目标版本 ${CONTRACT_HOST_VERSION}｜实装 dsh-tools ${toolsVersion ?? '未安装'}）`)
    for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : ` — ${c.detail}`}`)
    if (missing.length) console.log(`  ○ 产物缺失：${missing.join(' / ')}`)
  }
  if (!ok && !requireHost && missing.length === Object.keys(files).length) {
    // 裸仓库（未 pnpm install）：CI 侧用 --require-host 把它当失败；本地不必为一个未安装的环境红
    console.log('  ○ 未安装宿主产物 → 本次判 N/A（exit 0）。CI 请用 `--require-host`。')
    process.exit(0)
  }
  process.exit(ok ? 0 : 1)
}

// 仅在被直接执行时跑 main（被测试 import 时不动）
if (process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('scripts/host-contract-probe.mjs')) main()
