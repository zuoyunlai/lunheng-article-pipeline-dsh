#!/usr/bin/env node
// 论衡分段字数实测脚本（v18.2.7 新增，依据 2026-09-20 全流程实战反哺 P0-1）
//
// 用法：
//   node segment-chars.mjs <文件.md> --list                      # 列出全部 H2/H3 标题及各节汉字数
//   node segment-chars.mjs <文件.md> --section "3.6"             # 取单节
//   node segment-chars.mjs <文件.md> --section "3.6" --section "7.4"   # 取多节
//   node segment-chars.mjs <草稿.md> --budget <分析大纲.md>       # 预算对账 + Sl 观测分（v18.82.0）
//
// 输出：JSON（stdout），形如
//   { file, mode, total:{hanChars}, sections:[{selector,level,title,startLine,endLine,hanChars}], sum:{hanChars} }
//   --budget 模式：{ file, mode:'budget', rows:[{selector,budget,actual,devPct,sl}], weightedSl, missing, unbudgeted }
//
// 退出码（本脚本**不是闸门**，但与随包脚本共用 `_lib/exit-guard` 的路径语义）：
//   0  = 成功（全部 selector 命中）
//   10 = 参数或路径错误（含 **selector 未命中** —— 会打印可用标题清单帮你改参数）
//   70 = 内部错误（脚本缺陷）
//
// ── v18.82.0（LongWriter 借鉴批 · LW-2）：`--budget` 模式与 Sl 观测分 ─────────────────────
//   来源：LongBench-Write 的 Sl（柔性长度分，arXiv:2408.07055 evaluation/eval_length.py）。
//   定位（**必须先读这条再改**）：
//     · Sl 是**观测指标，不参与判级**——P0/P1/P2 判级真源仍是 `references/_shared/字数判定表.md` §二；
//     · **不新增退出码**（exit 家族保持 0/10/70 不变；Sl 低不改变 exit）；
//     · 用途：跨项目/跨轮次的字数健康度横向比较，供审计视图与反哺报告引用。
//   Sl 函数（中文版变体，软区间 ±10%）：
//     dev = |实测 − 预算| / 预算
//     dev ≤ 0.1            → Sl = 5
//     0.1 < dev < 1        → Sl = 5 − 4 × (dev − 0.1) / 0.9
//     dev ≥ 1（缺节/超一倍）→ Sl = 0
//     全文 weightedSl = 各节 Sl 的**预算加权**平均
//   预算解析：读分析大纲中标题含「字数预算」的节，扫描表格行；每行取第一个单元格为
//   selector（复用下方 matches() 匹配草稿标题）、行内第一个 ≥100 的整数（后可跟「字」）为预算。
//
// 为什么需要它（反哺报告 P0-1）：
//   段级 diff 模式（v2.5.2-dsh.7）要求 T5 在清单里给「现况 N 汉字 → 修改后 M 汉字」，
//   而 T5 **按任务约定不调用 shell**（见 `references/agents/05-写作-writer.md` §shell 边界声明
//   「写手**本任务约定不调用 shell**」，v2.3.18 / v2.5.2-dsh.4 审计修订；v18.8.0 P1-4 收口为
//   「口径与权威核验分离」），故只给估算 → 实测偏差 6~10%
//   （本项目实例：清单预估 16,987，实测 18,071，超上限 1,271 字 → 被迫 3 轮削裁）。
//   本脚本让**主控**在派发前对目标段跑一次实测，把准确「现况」写进派发话术，
//   误差从「双向」降为「单向（仅 M 为估算）」。
//
//   ⚠️ 措辞澄清（2026-09-29 实核修订，动议 EXEC-4）：旧注写「T5 子代理**无脚本执行能力**
//     （论衡主流程零 exec）」——**两处均不准**：
//       ① 「写手不调 shell」是**任务约定**（= 口径与权威核验分离的**设计选择**，上引两处定案），
//          **不是能力缺失**；
//       ② 论衡**不是**「零 exec」（见 `references/glossary.md` §shell 使用：「论衡**不是零 exec**」）。
//     **实测事实（2026-09-29，spawn 只读探针）**：子代理**真实注册 `pwsh`** 并执行成功
//     （`echo exec-probe-ok` → `exec-probe-ok`；`node --version` → v24.20.0）；且**全库无任何规则**
//     禁止子代理执行白名单脚本。→ 该约定是**设计选择，不是环境限制**。
//     **政策不变**：写手仍不调 shell；主控统一执行本脚本以保**口径一致**。
//     仅「能力可以从」这一事实须如实记载，防后人据此**放宽约定**或**误判环境受限**。
//
// 口径：汉字计数走 `_lib/han.mjs` 的 `countHan`（U+4E00–9FFF，与 count-chars 同源）；
//   节体切走 `_lib/sections.mjs` 的 `allHeadings`（与 m-gate-check / count-chars 同一标题解析），
//   故本脚本给出的「节字数」与 count-chars 的 `sectionsByHeading` **同口径**。
import { readFileSync, existsSync } from 'node:fs'
import { countHan } from './_lib/han.mjs'
import { allHeadings, bodyStartOfHeading } from './_lib/sections.mjs'
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs'
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs'   // 参数解析唯一实现（v18.7.3 P1-5）

installExitGuard()

// v18.7.3（P1-5，全量审计）：改走 _lib/cli-args.mjs（唯一实现，含可重复 --section）。
//   旧手写循环对未知 `-` token（如拼错的 --lst）不报「未知参数」而是落到「至少给一个 --section」——
//   报错口径偏了；且与全库解析实现分叉。
let sgFlags, sgOpts, sgPositionals
try {
  ({ flags: sgFlags, opts: sgOpts, positionals: sgPositionals } = parseArgs(process.argv.slice(2), {
    flags: ['--list'],
    values: { '--section': '"3.6"', '--budget': '"分析大纲.md"' },
    repeat: ['--section'],
    minPositionals: 1,
    maxPositionals: 1,
    positionalHint: '<文件.md>',
  }))
} catch (e) {
  if (e && e.code === USAGE_CODE) {
    console.error(e.message)
    console.error('用法: node segment-chars.mjs <文件.md> --list | --section <sel> [--section <sel>]... | --budget <分析大纲.md>')
    process.exit(10)
  }
  throw e
}
const file = sgPositionals[0]   // 约定：文件路径必须是第一个参数（便于「<文件> --section …」的直观写法）
const wantList = sgFlags.has('--list')
const budgetPath = sgOpts['--budget']
const selectors = sgOpts['--section']

if (!existsSync(file)) {
  console.error(`文件不存在: ${file}`)
  process.exit(10)
}
requireExistingFile(file, '待统计文件')
if (wantList && budgetPath) {
  console.error('--list 与 --budget 互斥（一次只跑一种模式）')
  process.exit(10)
}
if (budgetPath) {
  if (selectors.length > 0) { console.error('--budget 与 --section 互斥'); process.exit(10) }
  if (!existsSync(budgetPath)) { console.error(`预算文件不存在: ${budgetPath}`); process.exit(10) }
  requireExistingFile(budgetPath, '预算文件（分析大纲）')
} else if (!wantList && selectors.length === 0) {
  console.error('至少给一个 --section，或使用 --list / --budget')
  process.exit(10)
}

const text = readFileSync(file, 'utf8')

// 编码体检：非 UTF-8 解码必然出现 U+FFFD（与 count-chars.mjs 同一判据）
if (text.includes('\uFFFD')) {
  console.error(`${file}: 解码出现替换字符 U+FFFD —— 该文件不是合法 UTF-8（常见为 GBK）。请转码后重跑。`)
  process.exit(10)
}

const headings = allHeadings(text)

/** 行号（1-based）：index 之前的换行数 + 1。 */
const lineOf = (idx) => text.slice(0, idx).split('\n').length

/** 取某标题的节体范围：标题行之后 → **下一个 level ≤ 本 level 的标题**之前（故 H2 含其 H3 子节）。 */
const sectionRange = (i) => {
  const from = bodyStartOfHeading(text, headings[i].index)
  let to = text.length
  for (let j = i + 1; j < headings.length; j++) {
    if (headings[j].level <= headings[i].level) { to = headings[j].index; break }
  }
  return { from, to: Math.max(to, from) }
}

/** 选择器匹配：全等，或标题以「选择器 + 空白/分隔」开头（如 "3.6" 命中 "3.6 反方论证…"）。 */
const matches = (title, sel) => {
  const t = title.trim()
  const s = sel.trim()
  if (t === s) return true
  if (!t.startsWith(s)) return false
  const rest = t.slice(s.length)
  return /^[\s\u3000.、:：)）]/.test(rest) || /^\d/.test(rest)
}

// ── v18.82.0（LW-2）：--budget 模式 ──────────────────────────────────────────────────
// Sl 是观测分（不参与判级 / 不改 exit），见文件头「LW-2」注。
if (budgetPath) {
  const outline = readFileSync(budgetPath, 'utf8')
  if (outline.includes('\uFFFD')) {
    console.error(`${budgetPath}: 解码出现替换字符 U+FFFD —— 不是合法 UTF-8，请转码后重跑。`)
    process.exit(10)
  }
  // 预算表定位：标题含「字数预算」的节体（取**最后一个**——§11 写手版精简段在文件末尾）
  const outlineHeadings = allHeadings(outline)
  let budgetBody = null
  for (let i = 0; i < outlineHeadings.length; i++) {
    if (!outlineHeadings[i].title.includes('字数预算')) continue
    const from = bodyStartOfHeading(outline, outlineHeadings[i].index)
    let to = outline.length
    for (let j = i + 1; j < outlineHeadings.length; j++) {
      if (outlineHeadings[j].level <= outlineHeadings[i].level) { to = outlineHeadings[j].index; break }
    }
    budgetBody = outline.slice(from, Math.max(to, from))   // 循环不 break：同文件多节时取最后一份
  }
  if (budgetBody === null) {
    console.error(`${budgetPath}: 找不到标题含「字数预算」的节（预算表须挂在该标题下）`)
    process.exit(10)
  }
  // 表格行解析：第一个单元格 = selector；行内第一个 ≥100 的整数（后可跟「字」）= 预算。
  //   分隔线行（|---|---|）与表头行（无 ≥100 整数）自然被跳过。
  const budgetRows = []
  for (const line of budgetBody.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('|')) continue
    const cells = t.split('|').map((s) => s.trim()).filter((s, k, a) => !(k === 0 && s === '') && !(k === a.length - 1 && s === ''))
    if (cells.length < 2) continue
    const selector = cells[0].replace(/\*/g, '').trim()
    if (!selector || /^[-: ]+$/.test(selector)) continue
    const numMatch = t.match(/(\d{3,6})\s*字?/)
    if (!numMatch) continue
    const budget = Number(numMatch[1])
    if (budget < 100) continue   // <100 视为编号/百分比等噪声，不当预算
    // 同一 selector 只取首行（防同一预算行在多张表重复）
    if (!budgetRows.some((r) => r.selector === selector)) budgetRows.push({ selector, budget })
  }
  if (budgetRows.length === 0) {
    console.error(`${budgetPath}: 「字数预算」节内解析不到任何「| 节 | … | N字 |」表格行（须为 Markdown 表格，且预算为 ≥100 的整数）`)
    process.exit(10)
  }
  // 对账：预算行 → 草稿实测；未命中的 selector 进 missing（Sl=0，按「缺节」口径）
  const rows = []
  const missing = []
  for (const b of budgetRows) {
    const i = headings.findIndex((h) => matches(h.title, b.selector))
    if (i === -1) { missing.push(b.selector); continue }
    const { from, to } = sectionRange(i)
    const actual = countHan(text.slice(from, to))
    const dev = Math.abs(actual - b.budget) / b.budget
    const sl = dev <= 0.1 ? 5 : (dev >= 1 ? 0 : +(5 - 4 * (dev - 0.1) / 0.9).toFixed(3))
    rows.push({ selector: b.selector, title: headings[i].title, budget: b.budget, actual, devPct: +(dev * 100).toFixed(1), sl })
  }
  // 反向：草稿有 H2 而预算没覆盖的节（不计入 weightedSl，只列出来供人看）
  const budgetSels = new Set(budgetRows.map((r) => r.selector))
  const unbudgeted = headings
    .filter((h) => h.level <= 2)
    .filter((h) => ![...budgetSels].some((s) => matches(h.title, s)))
    .map((h) => h.title)
  // 加权平均只对「命中且有预算」的行；全缺时给 null（不给假 0 分）
  const wSum = rows.reduce((a, r) => a + r.budget, 0)
  const weightedSl = wSum > 0 ? +(rows.reduce((a, r) => a + r.sl * r.budget, 0) / wSum).toFixed(3) : null
  console.log(JSON.stringify({
    file,
    mode: 'budget',
    budgetSource: budgetPath,
    metric: 'Sl（柔性长度分，观测指标——不参与 P0/P1/P2 判级，判级真源 = 字数判定表 §二）',
    rows,
    weightedSl,
    missing,
    unbudgeted,
    note: 'Sl：dev≤10% 满分 5；线性衰减；dev≥100%（缺节/超一倍）=0。weightedSl 为预算加权平均；missing 计 0 分。',
  }, null, 2))
  process.exit(0)
}

if (wantList) {
  const headingsOut = headings.map((h, i) => {
    const { from, to } = sectionRange(i)
    return {
      idx: i,
      level: h.level,
      title: h.title,
      startLine: lineOf(h.index),
      endLine: lineOf(Math.max(to - 1, from)),
      hanChars: countHan(text.slice(from, to)),
    }
  })
  console.log(JSON.stringify({
    file,
    mode: 'list',
    total: { hanChars: countHan(text) },
    headingCount: headingsOut.length,
    headings: headingsOut,
  }, null, 2))
  process.exit(0)
}

// 逐 selector 解析（未命中即收集，最后统一报错并给出可用标题）
const sections = []
const unmatched = []
for (const sel of selectors) {
  const i = headings.findIndex((h) => matches(h.title, sel))
  if (i === -1) { unmatched.push(sel); continue }
  const { from, to } = sectionRange(i)
  sections.push({
    selector: sel,
    level: headings[i].level,
    title: headings[i].title,
    startLine: lineOf(headings[i].index),
    endLine: lineOf(Math.max(to - 1, from)),
    hanChars: countHan(text.slice(from, to)),
  })
}

if (unmatched.length > 0) {
  console.error(`以下选择器未命中任何标题: ${unmatched.join(' / ')}`)
  console.error('可用标题（前 40 个，格式「level 标题」）：')
  for (const h of headings.slice(0, 40)) console.error(`  ${'#'.repeat(h.level)} ${h.title}`)
  if (headings.length === 0) console.error('  （本文件未解析到任何 H2/H3 标题）')
  console.error('→ 退出码 10（参数错误）：请改用上面的标题或 --list 查看全量')
  process.exit(10)
}

console.log(JSON.stringify({
  file,
  mode: 'sections',
  total: { hanChars: countHan(text) },
  sections,
  sum: { hanChars: sections.reduce((a, s) => a + s.hanChars, 0) },
}, null, 2))
process.exit(0)
