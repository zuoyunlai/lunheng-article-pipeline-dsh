#!/usr/bin/env node
// 论衡按需读抽取器 ref-get（v18.22.2 CTX-3 新增，依据 v18.22.0 三维优化方案 §三.2 CTX-3）
//
// 用法：
//   node ref-get.mjs <文件.md> <#锚点>          # 抽取该节（打印节头 + 真字节数 + 正文）
//   node ref-get.mjs <文件.md> --list           # 列出全部节的「锚点 / 层级 / 行区间 / 字节数」
//   node ref-get.mjs <文件.md> <#锚点> --json   # 机器可读（含节正文）
//
// 退出码（本脚本**不是闸门**，但与随包脚本共用 `_lib/exit-guard` 的路径语义）：
//   0  = 成功
//   10 = 参数或路径错误（含 **锚点未命中** —— 会打印可用锚点清单帮你改参数）
//   70 = 内部错误（脚本缺陷）
//
// ── 为什么需要它（v18.22.0 报告 §三.2 CTX-3）───────────────────────────
// `SKILL.md` / 角色卡让读者「按需读 `_shared/M-Gate-Algorithm.md#mgate`」——可那份文档
// **97 KB / 1,195 行**，「找节」本身就要在 97 KB 里定位，等于一次**近似整读**；而成本模型是
// 「**步数 × 每步上下文**」（`docs/token-optimization-plan.md:94`），读进来的东西会被后续每一步重读。
// 本脚本把「按需读」从**模型自觉**变成**机制动作**：由主控在派发前跑一次，把**确定的字节数**带进派发话术。
//
// ── 两条硬边界（如实）────────────────────────────────────────────────
// ① **锚点未命中 = 失败，不返回空**（exit 10 + 可用清单）。「抽了个空」最危险的后果是被当作
//    「这一节已读过」——本脚本宁可响亮失败，也不给一个看起来成功的空节。
// ② 抽取口径（标题层级嵌套、字节计法、slug 规则）**与规则 ㉗ 同源**——两者共用
//    `_lib/anchor-slug.mjs`；那份文件的头注释写明「不要顺手优化 slugify」的三条理由。
import { readFileSync, existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anchorsWithRanges, resolveAnchor } from './_lib/anchor-slug.mjs'
import { installExitGuard } from './_lib/exit-guard.mjs'
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs'

installExitGuard()

/** 技能根（`scripts/` 的上一级）——文档里的路径都是相对它写的。 */
const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let flags, opts, positionals
try {
  ({ flags, opts, positionals } = parseArgs(process.argv.slice(2), {
    flags: ['--list', '--json'],
    values: {},
    minPositionals: 1,
    maxPositionals: 2,
    positionalHint: '<文件.md> [#锚点]',
  }))
} catch (e) {
  if (e && e.code === USAGE_CODE) {
    console.error(e.message)
    console.error('用法: node ref-get.mjs <文件.md> <#锚点> | <文件.md> --list [--json]')
    process.exit(10)
  }
  throw e
}

const wantList = flags.has('--list')
const wantJson = flags.has('--json')
const fileArg = positionals[0]
const anchorArg = positionals[1]

if (wantList && anchorArg) {
  console.error('--list 与「指定锚点」不能同时给（前者列全部、后者取一节）')
  process.exit(10)
}

/**
 * 解析文件路径：先按**当前目录**、再按**技能根**（文档里的相对路径都是相对技能根写的）。
 * 两个候选都存在时不静默二选一——把实际解析到的路径打印出来（结果里含 `file`）。
 */
function resolveInput(p) {
  if (isAbsolute(p)) return existsSync(p) ? p : null
  const fromCwd = resolve(process.cwd(), p)
  if (existsSync(fromCwd)) return fromCwd
  const fromSkill = resolve(SKILL_ROOT, p)
  if (existsSync(fromSkill)) return fromSkill
  return null
}

const abs = resolveInput(fileArg)
if (!abs) {
  console.error(`找不到文件：${fileArg}`)
  console.error(`（已试：当前目录 ${resolve(process.cwd(), fileArg)} ／ 技能根 ${resolve(SKILL_ROOT, fileArg)}）`)
  process.exit(10)
}

let text
try {
  text = readFileSync(abs, 'utf8')
} catch (e) {
  console.error(`读不到文件：${abs}（${e?.code || e?.message}）`)
  process.exit(10)
}

const relTo = (p) => (p.startsWith(SKILL_ROOT) ? relative(SKILL_ROOT, p).replaceAll('\\', '/') : p)
const fileLabel = relTo(abs)
const totalBytes = Buffer.byteLength(text, 'utf8')
const sections = anchorsWithRanges(text)

const fmt = (n) => n.toLocaleString('en-US')

// ── --list：列全部节 ─────────────────────────────────────────────────────
if (wantList) {
  if (wantJson) {
    console.log(JSON.stringify({
      file: fileLabel, totalBytes,
      sections: sections.map(({ text: _t, ...rest }) => rest),
    }, null, 2))
  } else {
    console.log(`# ref-get --list：${fileLabel}｜全文 ${fmt(totalBytes)} B｜共 ${sections.length} 个锚点\n`)
    for (const s of sections) {
      const indent = s.level ? '  '.repeat(s.level - 1) : '  '
      const kind = s.via === 'explicit' ? '显式' : `H${s.level}`
      console.log(`  ${fmt(s.bytes).padStart(9)} B  ${kind.padEnd(4)}  #${s.slug}`)
      console.log(`  ${' '.repeat(9)}        ${indent}${s.heading}（行 ${s.startLine}–${s.endLine}）`)
    }
    console.log(`\n提示：取某一节 → node ref-get.mjs ${fileArg} #<锚点>`)
  }
  process.exit(0)
}

// ── 取一节 ──────────────────────────────────────────────────────────────
if (!anchorArg) {
  console.error('缺少锚点参数（或改用 --list 列出全部节）')
  console.error('用法: node ref-get.mjs <文件.md> <#锚点> | <文件.md> --list [--json]')
  process.exit(10)
}
const anchor = String(anchorArg).replace(/^#/, '')

// 命中解析走共享库（标题锚点 + 显式 `<a id>` 两类；未命中返回 null）
const hit = resolveAnchor(text, anchor)

if (!hit) {
  // ② 硬边界：未命中 = 失败，绝不返回空节（空节会被读成「已读过」）
  console.error(`锚点未命中：#${anchor}（${fileLabel}）`)
  console.error(`该文件的锚点（共 ${sections.length} 个，按出现顺序）：`)
  for (const s of sections.slice(0, 40)) console.error(`  #${s.slug}   ${s.via === 'explicit' ? '显式' : `H${s.level}`}  ${s.heading}`)
  if (sections.length > 40) console.error(`  …（其余 ${sections.length - 40} 个用 --list 看）`)
  process.exit(10)
}

if (wantJson) {
  console.log(JSON.stringify({
    file: fileLabel, anchor, matched: hit.slug, via: hit.via, kind: hit.via === 'exact-explicit' ? 'explicit' : 'heading',
    heading: hit.heading, level: hit.level,
    startLine: hit.startLine, endLine: hit.endLine,
    bytes: hit.bytes, totalBytes, text: hit.text,
  }, null, 2))
} else {
  const how = hit.via === 'contains' ? `（片段命中 → #${hit.slug}）` : hit.via === 'exact-explicit' ? '（显式锚点）' : ''
  console.log(`# ref-get：${fileLabel} #${anchor}${how}`)
  console.log(`# 区间：${hit.heading}｜行 ${hit.startLine}–${hit.endLine}｜**${fmt(hit.bytes)} B**（全文 ${fmt(totalBytes)} B，本节占 ${((hit.bytes / totalBytes) * 100).toFixed(1)}%）`)
  console.log('---')
  console.log(hit.text)
}
process.exit(0)
