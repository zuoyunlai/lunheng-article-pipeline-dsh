#!/usr/bin/env node
// 预算重算器（v19.27.8 · 主人「另外两件按你的建议」之 ②）——**只读**，不写任何文件。
//
// **为什么要这个脚本**：抬「词预算上限」时，理由文本里要写三件事——实测字节、按定案 ① 公式
//   算出的新上限、余量。这三件事我在 P2-4 批里**手工算错过一次**（DOC_BUDGET 条目是数组
//   `[上限, 长期目标, 理由]` 而不是数字，首版脚本写成 `v - n` 算出全 `NaN`；另有「常驻集」
//   是另一把尺——`ALWAYS_RESIDENT`/`ALWAYS_LIMIT`，与单文件上限不同量纲）。
//   判据：**手抄的派生数字一定会漂**——那就别手抄，跑这个脚本取。
//
// **口径**（与 `repo-hygiene-check.mjs` 第 ⑨ 条严格同源）：
//   · 单文件面 = `_lib/doc-budget-reasons.mjs` 的 `DOC_BUDGET`（条目形状 `[上限, 长期目标, 理由, …]`）；
//   · 常驻集面 = `repo-hygiene-check.mjs` 的 `ALWAYS_RESIDENT`（文件清单）+ `ALWAYS_LIMIT`（集合上限），
//     两者**不同量纲**：集合上限是每次会话的硬开销，单文件上限只防「增量全塞给一个文件」。
//   · 定案 ① 公式：`ceil((实测 + 1536) / 1024) * 1024`（实测 + 1.5 KB，向上取整到整 KB）。
//
// 用法：
//   node scripts/budget-recalc.mjs            # 人读：常驻集 + 余量最小的 12 个文件
//   node scripts/budget-recalc.mjs --json     # 机读（供台账/报告引用）
//   node scripts/budget-recalc.mjs --all      # 列全部登记文件
//   node scripts/budget-recalc.mjs --file <path>   # 只看一个文件（含公式建议值）
//
// exit：0 = 正常输出（**刻意没有 1**——它不是门，判「是否超限」的是 `repo-hygiene-check` ⑨；
//        ADR-0003：非内容判定脚本用 1 = 撞码）/ 10 = 参数或路径错。

import { readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOC_BUDGET } from './_lib/doc-budget-reasons.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HYGIENE = join(ROOT, 'scripts/repo-hygiene-check.mjs')
const FORMULA_SLACK = 1536
const KB = 1024

const die = (msg) => { console.error(`[budget-recalc] ${msg}`); process.exit(10) }

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const showAll = args.includes('--all')
const onlyIdx = args.indexOf('--file')
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null
if (onlyIdx >= 0 && !only) die('--file 需要一个路径参数')

const bytes = (rel) => {
  try { return statSync(join(ROOT, rel)).size } catch { return null }
}
/** 定案 ①：实测 + 1.5 KB 向上取整到整 KB */
const formula = (actual) => Math.ceil((actual + FORMULA_SLACK) / KB) * KB

// ── 常驻集（集合面）──────────────────────────────────────────────────────────
const hygieneSrc = readFileSync(HYGIENE, 'utf8')
const residentBlock = hygieneSrc.match(/const ALWAYS_RESIDENT = \[([\s\S]*?)\]/)
const residentFiles = residentBlock ? [...residentBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []
const limitMatch = hygieneSrc.match(/const ALWAYS_LIMIT\s*=\s*(\d+)/)
if (!residentFiles.length || !limitMatch) die('无法从 repo-hygiene-check.mjs 派生常驻集清单/上限（判据形态变了？）')
const alwaysLimit = Number(limitMatch[1])
const residentDetail = residentFiles.map((f) => ({ file: f, bytes: bytes(f) ?? 0 }))
const residentTotal = residentDetail.reduce((n, r) => n + r.bytes, 0)

// ── 单文件面 ────────────────────────────────────────────────────────────────
const files = Object.entries(DOC_BUDGET).map(([file, entry]) => {
  const [cap, target] = Array.isArray(entry) ? entry : [entry, entry]
  const actual = bytes(file)
  return {
    file,
    actual,
    cap: Number(cap),
    target: Number(target),
    headroom: actual == null ? null : Number(cap) - actual,
    overTarget: actual == null ? null : actual - Number(target),
    formula: actual == null ? null : formula(actual),
  }
})
const missing = files.filter((f) => f.actual == null)
const known = files.filter((f) => f.actual != null).sort((a, b) => a.headroom - b.headroom)

const payload = {
  resident: { files: residentDetail, total: residentTotal, limit: alwaysLimit, headroom: alwaysLimit - residentTotal, formula: formula(residentTotal) },
  files: only ? files.filter((f) => f.file.includes(only)) : showAll ? known : known.slice(0, 12),
  missing,
  count: known.length,
}
if (only && !payload.files.length) die(`--file ${only} 不在 DOC_BUDGET 登记表里`)

if (asJson) {
  console.log(JSON.stringify(payload, null, 2))
  process.exit(0)
}

const pad = (s, n) => String(s).padEnd(n)
const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
console.log(`常驻集（集合面 · ALWAYS_LIMIT = ${num(alwaysLimit)} B ≈ ${Math.round(alwaysLimit / KB)} KB）`)
for (const r of residentDetail) console.log(`  ${pad(num(r.bytes) + ' B', 12)} ${r.file}`)
console.log(`  ${pad(num(residentTotal) + ' B', 12)} 合计`)
console.log(`  余量 ${num(payload.resident.headroom)} B ｜ 定案 ① 公式值 = ${num(payload.resident.formula)} B`
  + `（${payload.resident.headroom < 0 ? '⚠️ 已超上限，须先瘦身或显式抬升并写理由' : '尚在上限内'}）`)
console.log(`\n单文件面（DOC_BUDGET 共 ${payload.count} 条${showAll || only ? '' : '，只列余量最小的 12 条（--all 看全部）'}）`)
console.log(`  ${pad('余量', 10)}${pad('实测', 12)}${pad('上限', 12)}${pad('公式值', 12)}文件`)
for (const f of payload.files) {
  console.log(`  ${pad(num(f.headroom) + ' B', 10)}${pad(num(f.actual) + ' B', 12)}${pad(num(f.cap) + ' B', 12)}${pad(num(f.formula) + ' B', 12)}${f.file}`)
}
if (missing.length) console.log(`\n⚠️ 登记表里 ${missing.length} 条路径在盘上不存在：${missing.map((m) => m.file).join(' / ')}`)
console.log('\n提示：抬上限时把「实测 / 公式值 / 余量」三个数直接抄进理由；长期目标那一列不受本脚本影响。')
process.exit(0)
