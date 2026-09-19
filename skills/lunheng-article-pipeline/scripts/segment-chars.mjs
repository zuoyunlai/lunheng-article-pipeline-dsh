#!/usr/bin/env node
// 论衡分段字数实测脚本（v18.2.7 新增，依据 2026-09-20 全流程实战反哺 P0-1）
//
// 用法：
//   node segment-chars.mjs <文件.md> --list                      # 列出全部 H2/H3 标题及各节汉字数
//   node segment-chars.mjs <文件.md> --section "3.6"             # 取单节
//   node segment-chars.mjs <文件.md> --section "3.6" --section "7.4"   # 取多节
//
// 输出：JSON（stdout），形如
//   { file, mode, total:{hanChars}, sections:[{selector,level,title,startLine,endLine,hanChars}], sum:{hanChars} }
//
// 退出码（本脚本**不是闸门**，但与随包脚本共用 `_lib/exit-guard` 的路径语义）：
//   0  = 成功（全部 selector 命中）
//   10 = 参数或路径错误（含 **selector 未命中** —— 会打印可用标题清单帮你改参数）
//   70 = 内部错误（脚本缺陷）
//
// 为什么需要它（反哺报告 P0-1）：
//   段级 diff 模式（v2.5.2-dsh.7）要求 T5 在清单里给「现况 N 汉字 → 修改后 M 汉字」，
//   但 T5 子代理**无脚本执行能力**（论衡主流程零 exec），只能目测 → 实测偏差 6~10%
//   （本项目实例：清单预估 16,987，实测 18,071，超上限 1,271 字 → 被迫 3 轮削裁）。
//   本脚本让**主控**在派发前对目标段跑一次实测，把准确「现况」写进派发话术，
//   误差从「双向」降为「单向（仅 M 为估算）」。
//
// 口径：汉字计数走 `_lib/han.mjs` 的 `countHan`（U+4E00–9FFF，与 count-chars 同源）；
//   节体切走 `_lib/sections.mjs` 的 `allHeadings`（与 m-gate-check / count-chars 同一标题解析），
//   故本脚本给出的「节字数」与 count-chars 的 `sectionsByHeading` **同口径**。
import { readFileSync, existsSync } from 'node:fs'
import { countHan } from './_lib/han.mjs'
import { allHeadings, bodyStartOfHeading } from './_lib/sections.mjs'
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs'

installExitGuard()

const argv = process.argv.slice(2)
const file = argv[0]   // 约定：文件路径必须是第一个参数（便于「<文件> --section …」的直观写法）
const wantList = argv.includes('--list')
const selectors = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--section') {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) {
      console.error('--section 后缺少选择器（如 --section "3.6"）')
      process.exit(10)
    }
    selectors.push(v)
    i++
  }
}

if (!file || file.startsWith('--')) {
  console.error('用法: node segment-chars.mjs <文件.md> --list | --section <sel> [--section <sel>]...')
  process.exit(10)
}
if (!existsSync(file)) {
  console.error(`文件不存在: ${file}`)
  process.exit(10)
}
requireExistingFile(file, '待统计文件')
if (!wantList && selectors.length === 0) {
  console.error('至少给一个 --section，或使用 --list 先看有哪些节')
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
