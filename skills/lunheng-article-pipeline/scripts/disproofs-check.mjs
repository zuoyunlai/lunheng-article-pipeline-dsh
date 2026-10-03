#!/usr/bin/env node
// 论衡负知识账本校验（v18.64.0 新增；依据 audits/反哺报告-v5-竞品驱动.md §v5.3-1 的 C1-b 半）
//
// 用法：
//   node scripts/disproofs-check.mjs <项目目录> [--json] [--file <账本路径>]
//
// 定位：**只读校验器**（零写盘 · 零 spawn · 零网络）——把「已证伪项」从散落在批判报告 / 审计报告 /
//   `[L99]` 索引行里的**散文**，变成一处**可复用的结构化账本**（`audits/disproofs.jsonl`）。
//   真源契约 = `references/_shared/负知识账本.md`（字段表 / 写入阅读点 / 与既有机制的边界）。
//   判据一句话：**「只记通过的、不记被证伪的」就是负知识流失**；本器只回答「账本在不在、合不合契约」，
//   **不做内容判定、不判 P0/P1、不进 M 门**——刻意不挂闸门，免得催生「为过门补一条像样的证伪」的刷分压力
//   （与 `quality-score.mjs` 的既有判据同源：挂成闸门会立刻产生为过门而刷分的压力）。
//
// 退出码（**复用既有语义，不新造码**）：
//   0  = 账本存在，且**每一行都合法**（逐条回显，供 T8 摘录进交付说明）
//   1  = 有非法行（JSON 解析失败 / 缺必填 / `verdict` 越界 / `evidence` 非数组或空 / `id` 重复或不合规）
//        —— **或账本存在却 0 有效行**（空占位与「没记」同形，禁止）
//   3  = **账本不存在**（适用却缺输入 → 须人工复核：究竟是「确实无已证伪项」还是「漏记」？
//        与 `g-audit-check` 的「`N/A` ≠ `SKIP`」同口径——本器**绝不把「没账本」读成通过**）
//   10 = 参数或路径错误（含项目目录不存在）/ 70 = 内部错误（EX_SOFTWARE，脚本缺陷）
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { installExitGuard, requireExistingDir, EXIT_USAGE } from './_lib/exit-guard.mjs'
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs'

installExitGuard()

const USAGE = '用法: node scripts/disproofs-check.mjs <项目目录> [--json] [--file <账本路径>]'

let flags, opts, positionals
try {
  ({ flags, opts, positionals } = parseArgs(process.argv.slice(2), {
    flags: ['--json'],
    values: { '--file': 'audits/disproofs.jsonl' },
    minPositionals: 1,
    maxPositionals: 1,
    positionalHint: '<项目目录>',
  }))
} catch (e) {
  if (e && e.code === USAGE_CODE) { console.error(e.message); console.error(USAGE); process.exit(EXIT_USAGE) }
  throw e
}

const wantJson = flags.has('--json')
const project = positionals[0]
requireExistingDir(project, '项目目录')
// ⚠️ `opts['--file']` 未传时是 `null`（`cli-args` 的 `values` 只提供**示例值**用于报错，不提供默认值）
const ledgerRel = opts['--file'] || 'audits/disproofs.jsonl'
const ledgerPath = join(project, ledgerRel)

// 契约（字段表真源 = references/_shared/负知识账本.md；本器只核**形状与必填**，不核判断对错）
const VERDICTS = new Set(['disproven', 'weakened', 'unverifiable'])
const ID_RE = /^DP-\d{3,}$/
const REQUIRED = ['id', 'claim', 'verdict', 'basis', 'evidence', 'reproduce', 'author']

const out = {
  script: 'disproofs-check',
  project,
  ledger: ledgerPath,
  exist: false,
  entries: [],
  errors: [],
  counts: { total: 0, legal: 0, illegal: 0, byVerdict: {} },
}

if (!existsSync(ledgerPath)) {
  if (wantJson) { console.log(JSON.stringify({ ...out, exit: 3 }, null, 2)) } else {
    console.error(`⚠️ 未找到负知识账本：${ledgerPath}`)
    console.error('   本器**不得**把「没账本」读成通过：请人工确认——')
    console.error('   ① 本项目**确实无已证伪项** → 在交接报告 / 交付说明里**显式声明**该结论（不是「跳过」），然后不必建账本；')
    console.error('   ② 有已证伪项却**漏记** → 让 T6 / T7 按 references/_shared/负知识账本.md 的字段表补记（append-only）。')
    console.error('→ 退出码 3（适用却缺输入，须人工复核；与 g-audit-check 的「N/A ≠ SKIP」同口径）')
  }
  process.exit(3)
}

// 只读：读全文 + 确认是普通文件（目录/软链到目录 → 10，由 requireExistingDir 的同类语义收口）
if (!statSync(ledgerPath).isFile()) {
  console.error(`账本路径不是文件：${ledgerPath}`)
  process.exit(EXIT_USAGE)
}

const lines = readFileSync(ledgerPath, 'utf8').split('\n')
const seen = new Map()
for (let i = 0; i < lines.length; i++) {
  const raw = lines[i].trim()
  if (!raw) continue
  out.counts.total += 1
  const at = `第 ${i + 1} 行`
  let o = null
  try {
    o = JSON.parse(raw)
  } catch (e) {
    out.errors.push(`${at}：JSON 解析失败（${e.message}）`)
    out.counts.illegal += 1
    continue
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) {
    out.errors.push(`${at}：应为 JSON 对象（一行一条）`)
    out.counts.illegal += 1
    continue
  }
  const miss = REQUIRED.filter((k) => o[k] === undefined || o[k] === null || String(o[k]).trim() === '')
  if (miss.length) out.errors.push(`${at}：缺必填字段 ${miss.join(' / ')}`)
  if (o.id !== undefined && !ID_RE.test(String(o.id))) {
    out.errors.push(`${at}：id 须形如 DP-001（递增三位以上），实得 ${JSON.stringify(o.id)}`)
  }
  if (o.verdict !== undefined && !VERDICTS.has(String(o.verdict))) {
    out.errors.push(`${at}：verdict 须为 ${[...VERDICTS].join(' / ')}，实得 ${JSON.stringify(o.verdict)}`)
  }
  if (o.evidence !== undefined && (!Array.isArray(o.evidence) || o.evidence.length === 0)) {
    out.errors.push(`${at}：evidence 须为**非空数组**（指向 [Lxx]/[Dxx]/[Cxx]/DOI/URL）——空证据不算记过`)
  }
  // v18.64.2（独立审计 A-P2 核实后收口）：**元素也必须是「非空字符串」**。旧版只核「非空数组」，
  //   于是 `[123, null, ""]` 会被放行——而它对下游（T5 逐条回应 / 外审按图索骥）**完全不可用**：
  //   账本里每一条证据都必须是**能去查的东西**（编号、DOI、URL、文件名），不是一个数字或空串。
  if (Array.isArray(o.evidence) && o.evidence.length > 0) {
    const badIdx = o.evidence.findIndex((x) => typeof x !== 'string' || x.trim() === '')
    if (badIdx >= 0) {
      out.errors.push(`${at}：evidence 第 ${badIdx + 1} 项不是非空字符串（${JSON.stringify(o.evidence[badIdx])}）——证据必须可回查`)
    }
  }
  if (o.id !== undefined && ID_RE.test(String(o.id))) {
    if (seen.has(o.id)) out.errors.push(`${at}：id 重复（与第 ${seen.get(o.id)} 行同为 ${o.id}）——append-only 账本不得复用编号`)
    else seen.set(o.id, i + 1)
  }
  const illegal = out.errors.some((m) => m.startsWith(at + '：'))
  if (illegal) out.counts.illegal += 1
  else {
    out.counts.legal += 1
    out.entries.push(o)
    out.counts.byVerdict[o.verdict] = (out.counts.byVerdict[o.verdict] || 0) + 1
  }
}

// 空占位（文件在、却没有一行合法条目）= 与「没记」同形 → 判 1
if (out.counts.legal === 0 && out.counts.illegal === 0) {
  out.errors.push('账本存在但**没有任何条目**（空占位与「没记」同形）——请补记，或删除该空文件并在交接报告显式声明「确实无已证伪项」')
}

const exit = out.errors.length > 0 ? 1 : 0
if (wantJson) {
  console.log(JSON.stringify({ ...out, exit }, null, 2))
} else {
  if (exit === 0) {
    console.log(`✅ 负知识账本合法：${out.counts.legal} 条（${Object.entries(out.counts.byVerdict).map(([k, v]) => `${k} ${v}`).join(' / ')}）`)
    for (const e of out.entries) {
      console.log(`   · ${e.id} [${e.verdict}] ${String(e.claim).slice(0, 60)}${String(e.claim).length > 60 ? '…' : ''}｜依据：${String(e.basis).slice(0, 40)}…`)
    }
    console.log('   读法：本清单是**交付物的一部分**（随证据包）；T5 须在 drafts/修订说明-vN.md 里**逐条回应**，T8 摘录结论进交付说明。')
  } else {
    console.error(`❌ 负知识账本不合契约：${out.errors.length} 处问题（合法 ${out.counts.legal} / 非法 ${out.counts.illegal}）`)
    for (const m of out.errors) console.error(`   - ${m}`)
    console.error('→ 退出码 1（形状不合；**这不是内容判定**——证伪得对不对仍归 T6/T7/T8 人工判断）')
  }
  console.error(`exit ${exit}`)
}
process.exit(exit)
