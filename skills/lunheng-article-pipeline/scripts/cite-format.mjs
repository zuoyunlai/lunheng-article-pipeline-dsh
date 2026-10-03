#!/usr/bin/env node
// 论衡参考文献格式生成器（v18.66.0 新增；主人 2026-10-03 指令：只做 **GB/T 7714-2015 ↔ APA 7th**，IEEE 暂缓）
//
// 用法：
//   node scripts/cite-format.mjs <项目目录> [--style gbt|apa] [--json] [--report <path>] [--card <相对路径>]
//
// 定位：**正向生成器**（字段 → 目标格式串），**不是**「串 → 串」转换器。
//   真源契约 = `references/_shared/引用格式.md`（两格式著录模板 / 类型映射 / 缺字段占位规则 / 双标形态 / 与既有门的分工）。
//
// ── 为什么只做正向（这是本器最重要的判据）─────────────────────────────────────────────
//   「自动转换」听起来是「把一段 APA 重排成 GB/T」。但那样必须先**反向解析**作者/刊名/年，
//   而正则猜作者与刊名会**静默改错**——本仓最反对的形态（实测事故族：把 `[Lxx]` 猜成 `[1]` 之类）。
//   实测本仓文献卡是**字段结构化**的（`- **作者**: Robert Nozick` / `- **类型**: 期刊文章 [J]` /
//   `- **出版社/期刊**: *Philosophy & Public Affairs*, Vol. 1, No. 4, pp. 441–445`），
//   故正确做法是**从字段正向拼**：可判定的才拼，判不出的落 `⟨缺 …⟩` 占位并进清单，**绝不编造**。
//
// ── 它不碰什么（三条硬边界）─────────────────────────────────────────────────────────
//   ① **不改定稿正文**：只输出**草稿**（参考文献节），粘贴/改名/核对由 T5 或 T8（P1-D 亲修）做；
//   ② **不重排顺序**：输出顺序 = 文献卡顺序（GB/T 顺序编码制与 `M-Exist-1` 的双向闭环都依赖它）；
//   ③ **不判级**：缺字段的判级归 `g-audit-check.mjs` 的 `G15-VolIssue`（候选 P2，模式相关）——
//      本器只**列清单**，不进 M 门、不改任何退出码语义。
//
// 退出码（**复用既有语义，不新造码**）：
//   0  = 每条都可生成，且**无占位、无索引段对账不一致**
//   1  = 有占位 / 有条目类型未识别 / 索引段与条目字段不一致（**候选清单，须人工**；机器不替人补字段）
//   3  = 文献卡不存在或 0 条目（适用却缺输入 → 人工确认；**绝不把「没卡」读成「无需格式」**）
//   10 = 参数或路径错误 / 70 = 内部错误（EX_SOFTWARE，脚本缺陷）
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installExitGuard, requireExistingDir, EXIT_USAGE } from './_lib/exit-guard.mjs'
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs'
import { writeReport } from './_lib/destructive-write.mjs'
import { packageVersionTag } from './_lib/pkg-version.mjs'

installExitGuard()
const EXIT_INTERNAL = 70
const scriptDir = dirname(fileURLToPath(import.meta.url))

const USAGE = '用法: node scripts/cite-format.mjs <项目目录> [--style gbt|apa] [--json] [--report <path>] [--card <相对路径>]'

let flags, opts, positionals
try {
  ({ flags, opts, positionals } = parseArgs(process.argv.slice(2), {
    flags: ['--json'],
    values: { '--style': 'gbt', '--report': 'final/引用格式报告.json', '--card': 'literature/文献卡.md' },
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
// ⚠️ `opts[...]` 未传时是 `null`（`cli-args` 的 `values` 只提供**示例值**用于报错，不提供默认值）
const style = (opts['--style'] || 'gbt').toLowerCase()
const cardRel = opts['--card'] || 'literature/文献卡.md'
const reportRel = opts['--report'] || 'final/引用格式报告.json'
if (!['gbt', 'apa'].includes(style)) {
  console.error(`⚠️ --style 只支持 gbt / apa（IEEE 暂缓：见 references/_shared/引用格式.md §五）`)
  console.error(USAGE)
  process.exit(EXIT_USAGE)
}

const STYLE_NAME = { gbt: 'GB/T 7714-2015', apa: 'APA 7th' }
const PLACEHOLDER = (what) => `⟨缺 ${what}⟩`
// 「待核/待补/未知」类**占位值**一律当缺字段处理：本仓既有铁律就禁「待核」占位（`文献卡-template.md:110` 作者栏），
//   实测卡片里也真有 `期刊版本待核验`（L12）——若原样进著录串，就把**未核验**当成了**已著录**。
// v18.67.0 审计 P0-1 修复：英文占位词必须**词边界锚定**——旧版 `n\/?a` 是无边界子串匹配，
//   实测把 `Nancy Fraser`/`Hannah Arendt`/`Nature`/`China Quarterly`/`Governance`（凡含 "na" 子串）
//   系统性误判成「未核验」→ 假占位 + 假对账不一致。中文关键词无歧义，保留子串匹配。
const UNVERIFIED = /待核|待补|待确认|待定|未知|不详|未检索到|未找到|\b(?:unknown|tbd|n\/?a)\b/i
const clean = (v) => (v == null ? null : (UNVERIFIED.test(String(v)) ? null : String(v).trim()))
const stripParen = (s) => String(s || '').replace(/[（(][^（()）]*[）)]/g, ' ').trim()

// ── 解析：条目标题 + `- **字段**: 值` 行（多行值取到下一个字段/标题为止）────────────────
const pick = (block, names) => {
  for (const n of names) {
    const re = new RegExp(`^-\\s*\\*\\*${n}\\*\\*\\s*[:：]\\s*([\\s\\S]*?)(?=\\n-\\s*\\*\\*|\\n###|\\n##|$)`, 'm')
    const m = block.match(re)
    if (m) return m[1].trim()
  }
  return null
}
const firstYear = (s) => { const m = String(s || '').match(/(?:19|20)\d{2}/); return m ? m[0] : null }
const firstOf = (re, s) => { const m = String(s || '').match(re); return m ? m[1].trim() : null }

/** 条目标题 → 题名（去掉末尾的「（用途括注）」；去引号/书名号/斜体标记；若开头与作者姓同名则去掉）。 */
const titleFrom = (heading, authorRaw) => {
  const strip = (s) => s
    .replace(/[（(][^（()）]*[）)]\s*$/, '').trim()                      // 末尾用途括注
    .replace(/\*/g, '')                                                 // 卡片用 *…* 标斜体：进著录串前去掉（APA 由模板自己加斜体）
    .replace(/^[《“"'「]+/, '').replace(/[》”"'」]+$/, '').trim()          // 书名号 / 引号（**两侧都要**）
  let t = strip(String(heading || ''))
  const derived = []
  if (authorRaw) {
    const surname = authorRaw.trim().split(/\s+/).pop()
    if (surname && t.toLowerCase().startsWith(surname.toLowerCase())) {
      const rest = strip(t.slice(surname.length))                       // 去掉作者词后**再剥一次引号**（实测：`Nozick "Coercion"` 曾留下孤引号）
      if (rest) { t = rest; derived.push('题名去掉了与作者同名的开头词') }
    }
  }
  return { title: t, derived }
}

/** 作者：中文不反转（APA 中文变体）；英文「Given Surname」→ 「Surname, G.」（**仅在索引段认可时**）。 */
const authors = (raw, indexAuthor) => {
  const notes = []
  const src0 = clean(raw)
  if (!src0) return { text: PLACEHOLDER('作者'), notes: raw ? [`作者栏是「${String(raw).slice(0, 20)}…」类未核验占位 → 当缺字段处理`] : [] }
  // 实测：作者栏常带**职称/机构括注**（`王文军（博士、教授，民法学方向）` / `Dario Gädeke（KU Leuven 政治哲学）`）
  //   → 先摘括注再拆多作者，否则「，」会把括注拆成假作者（第一版实测出 `（博士, & 教授, & 民法学方向）`）。
  const paren = (src0.match(/[（(]([^（()）]*)[）)]/g) || []).map((x) => x.slice(1, -1)).join('；')
  if (paren) notes.push(`作者栏括注未进著录串（${paren.slice(0, 40)}）`)
  const src = stripParen(src0) || src0
  const parts = src.split(/\s*(?:、|;|；|,|，|\band\b|&)\s*/).map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return { text: PLACEHOLDER('作者'), notes }
  const sep = style === 'apa' ? (parts.length > 1 ? ', & ' : '') : ', '
  const idxCore = stripParen(indexAuthor || '').split(/[\s、,，]+/).filter(Boolean)
  const conv = parts.map((p) => {
    if (/[\u4e00-\u9fff]/.test(p)) return p                                     // 中文：原样（不反转；APA 中文变体）
    const toks = p.split(/\s+/).filter(Boolean)
    if (toks.length === 1) { notes.push(`「${p}」只有姓、无名首字母 → 未编造首字母`); return p }
    const surname = toks[toks.length - 1]
    if (idxCore.length && !idxCore.some((x) => x.includes(surname) || surname.includes(x))) {
      notes.push(`「${p}」的姓（${surname}）与索引段「${indexAuthor}」不符 → **未反转**，请人工核`)
      return p
    }
    const initials = toks.slice(0, -1).map((x) => `${x[0].toUpperCase()}.`).join(' ')
    return `${surname}, ${initials}`
  })
  if (style === 'gbt') return { text: src, notes }                              // GB/T 保留原栏（含全名/次序）
  return { text: conv.join(sep), notes }
}

/** 出处栏 → 刊名 / 卷 / 期 / 页（判不出就 null，不猜）。 */
const source = (raw) => {
  const s = String(raw || '')
  // 专著/报告/学位论文类：卡片的「出版社/期刊」栏常带**散文括注与页数**（实测：`Princeton: … , xi+318 页（属 … 系列）`）
  //   → 只取「第一个全角/半角括注之前」并去掉尾部的 `, <页数> 页`：进著录串的是出版信息，不是读书笔记。
  const clean = s.replace(/\*([^*]+)\*/g, '$1')
    .replace(/[（(].*$/, '')
    .replace(/[,，]\s*[\divxlIVXL]+\s*\+?\s*\d*\s*页.*$/, '')
    .trim().replace(/[,，]\s*$/, '')
  return {
    journal: (s.match(/\*([^*]+)\*/) || [])[1]?.trim() || firstOf(/^([^,，;；]+)/, clean) || null,
    volume: firstOf(/(?:Vol\.?|卷)\s*([\dIVXLC]+)/i, s),
    issue: firstOf(/(?:No\.?|期)\s*([\dA-Za-z]+)/i, s),
    pages: firstOf(/pp?\.?\s*([\d–\-—~]+\s*[-–—~]\s*[\d]+|[\d]+)/i, s) || firstOf(/[:：]\s*([\d–\-—~]+)/, s),
    raw: clean || s.trim(),
  }
}
const doiOf = (s) => firstOf(/(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)/, s)
// 实测：URL 后紧跟全角括注（`…9780521269841（CUP.`）→ 半角与全角括号都必须排除
const urlOf = (s) => firstOf(/(https?:\/\/[^\s()（）\[\]<>，；、]+)/, s)

// ── 四种体型 + 两套格式的**正向拼装**（模板真源 = `_shared/引用格式.md` §二/§三）──────────
const build = (e) => {
  const ph = []
  const need = (v, what) => { if (!v) { ph.push(PLACEHOLDER(what)); return PLACEHOLDER(what) } return v }
  const y = need(e.year, '年')
  // 句点收口（实测：GB/T 模板自带 `作者. 题名`，而 APA 作者串本身以 `.` 结尾 → 必须分开处理，否则出 `Robert Nozick..`）
  const aG = e.authors.replace(/[.。]+$/, '')
  const aA = /[.。]$/.test(e.authors) ? e.authors : `${e.authors}.`
  const t = need(e.title, '题名')
  const tail = [e.doi ? `DOI: ${e.doi}.` : null, e.url ? `URL: ${e.url}.` : null].filter(Boolean).join(' ')
  if (style === 'gbt') {
    switch (e.type) {
      case 'J': return `${aG}. ${t}[J]. ${need(e.src.journal, '刊名')}, ${y}${e.src.volume ? `, ${e.src.volume}` : ph.push(PLACEHOLDER('卷')) ? `, ${PLACEHOLDER('卷')}` : ''}${e.src.issue ? `(${e.src.issue})` : ''}${e.src.pages ? `: ${e.src.pages}` : `: ${PLACEHOLDER('起-止页')}`}.${tail ? ` ${tail}` : ''}`
      case 'M': return `${aG}. ${t}[M]. ${need(e.src.raw, '出版地: 出版者')}, ${y}.${e.isbn ? ` ISBN: ${e.isbn}.` : ''}${tail ? ` ${tail}` : ''}`
      case 'EB/OL': return `${aG}. ${t}[EB/OL]. (${e.pubDate || PLACEHOLDER('发布日期')})[${e.accessDate || PLACEHOLDER('引用日期')}]. ${need(e.url, 'URL')}.`
      case 'D': return `${aG}. ${t}[D]. ${need(e.src.raw, '培养单位')}, ${y}.`
      case 'R': return `${aG}. ${t}[R]. ${need(e.src.raw, '机构')}, ${y}.`
      case 'N': return `${aG}. ${t}[N]. ${need(e.src.journal, '报纸名')}, ${y}${e.src.pages ? `(${e.src.pages})` : ''}.`
      default: return null
    }
  }
  // APA 7th（专著/报告/学位论文只写**出版者**，不写出版地 → 从卡片的 `出版地: 出版者` 形态确定性拆栏）
  const pub = e.src.raw.includes(':') ? e.src.raw.slice(e.src.raw.lastIndexOf(':') + 1).trim() : e.src.raw
  switch (e.type) {
    case 'J': return `${aA} (${y}). ${t}. *${need(e.src.journal, '刊名')}*, ${e.src.volume || PLACEHOLDER('卷')}${e.src.issue ? `(${e.src.issue})` : ''}, ${e.src.pages || PLACEHOLDER('起-止页')}.${e.doi ? ` https://doi.org/${e.doi}` : e.url ? ` ${e.url}` : ''}`
    case 'M': return `${aA} (${y}). *${t}*. ${need(pub, '出版者')}.${e.url ? ` ${e.url}` : ''}`
    case 'EB/OL': return `${aA} (${y}). ${t}. ${need(e.url, 'URL')}`
    case 'D': return `${aA} (${y}). *${t}* [博士学位论文]. ${need(pub, '培养单位')}.`
    case 'R': return `${aA} (${y}). *${t}*. ${need(pub, '机构')}.`
    case 'N': return `${aA} (${y}). ${t}. *${need(e.src.journal, '报纸名')}*.${e.url ? ` ${e.url}` : ''}`
    default: return null
  }
}

const cardPath = join(project, cardRel)
if (!existsSync(cardPath)) {
  const msg = `⚠️ 文献卡不存在：${cardPath}（适用却缺输入 → 须人工确认「本项目无需参考文献」还是「路径/D 档未落卡」；**不得**读成通过）`
  if (wantJson) console.log(JSON.stringify({ tool: 'cite-format', style, card: cardRel, exit: 3, reason: msg }, null, 2))
  else console.error(msg)
  process.exit(3)
}
const raw = readFileSync(cardPath, 'utf8')

// 索引段表：[L01] | Nozick | 1969 | 信任级别 | 用途
//   ⚠️ 实测教训（第一版 bug）：**必须只在本节里扫**。第一版对全文逐行匹配 `| [Lxx] | … |`，
//   而卡片后文另有以 `[Lxx]` 开头的表格行（核验记录类，列义完全不同）→ **后匹配覆盖先匹配**，
//   索引段作者被写成 `DOI: 10.…`，于是全文条目都报「与索引段不符」（16 处假阳性）。
//   判据：**表格语义由表头决定，不由行形状决定**——所以先定位 `## 📇 索引段` 段，再核表头含「编号」与「作者」。
const indexSection = (() => {
  // ⚠️ 实测 bug：第一版写 `/…([\s\S]*?)(?=^##\s|\Z)/m` —— **JS 正则没有 `\Z`**（被当字面字符 `Z`），
  //   于是「后面没有 `##` 标题」的卡片（测试夹具即如此）整体匹配失败 → 索引段解析为空 → 对账全部静默通过。
  //   现改为**按 `##` 切块再挑标题含「索引段」的那块**：不依赖行尾/串尾断言，无 flag 陷阱。
  const hit = raw.split(/^##\s/m).find((c) => /索引段/.test(c.split('\n')[0]))
  return hit || ''
})()
const headerOk = /^\|.*编号.*\|.*作者.*\|/m.test(indexSection)
const index = new Map()
if (headerOk) {
  for (const line of indexSection.split('\n')) {
    const m = line.match(/^\|\s*\[(L\d+)\]\s*\|\s*([^|]*)\|\s*([^|]*)\|/)
    if (m) index.set(m[1], { author: m[2].trim(), year: firstYear(m[3]) })
  }
}

const entries = []
const headRe = /^###\s*\[(L\d+)\]\s*(.+?)\s*$/gm
const heads = [...raw.matchAll(headRe)]
for (let i = 0; i < heads.length; i++) {
  const id = heads[i][1]
  const heading = heads[i][2]
  const body = raw.slice(heads[i].index + heads[i][0].length, i + 1 < heads.length ? heads[i + 1].index : raw.length)
  const f = {
    作者: pick(body, ['作者', 'Author']),
    年份: pick(body, ['年份', '年', 'Year']),
    类型: pick(body, ['类型', '文献类型', 'Type']),
    出处: clean(pick(body, ['出版社/期刊', '出版社／期刊', '期刊', '出处', 'Publisher'])),
    DOIURL: pick(body, ['DOI/URL', 'DOI／URL', 'DOI', 'URL', 'DOI/链接']),
    访问日期: pick(body, ['访问日期', '引用日期', '检索日期']),
    发布日期: pick(body, ['发布日期', '发表日期', '日期']),
  }
  const typeM = String(f.类型 || '').match(/\[([A-Z]{1,2}(?:\/[A-Z]{2})?)\]/) || String(f.出处 || '').match(/\[([A-Z]{1,2}(?:\/[A-Z]{2})?)\]/)
  const type = typeM ? typeM[1] : null
  const idx = index.get(id) || null
  const au = authors(f.作者, idx?.author || null)
  const ti = titleFrom(heading, stripParen(f.作者 || '') || f.作者)
  const e = {
    id, heading, type,
    authors: au.text, authorNotes: au.notes,
    year: firstYear(clean(f.年份)), yearRaw: f.年份,
    title: ti.title, titleDerived: ti.derived,
    src: source(f.出处),
    doi: doiOf(f.DOIURL), url: urlOf(f.DOIURL),
    isbn: firstOf(/((?:97[89])?[\d-]{9,17}[\dXx])/, f.DOIURL || ''),
    accessDate: f.访问日期 ? firstYear(f.访问日期) : null, pubDate: f.发布日期 ? firstYear(f.发布日期) : null,
  }
  const text = build(e)
  entries.push({ e, text, blocked: text ? null : `类型未识别或缺失（类型栏：${f.类型 || '空'}）——**不猜类型**，请先按真源补 [J]/[M]/[EB/OL]/[D]/[R]/[N]` })
}

const generated = [], blocked = [], crossCheck = [], placeholders = []
for (const { e, text, blocked: why } of entries) {
  if (why) { blocked.push({ id: e.id, reason: why }); continue }
  const ph = [...new Set((text.match(/⟨缺 [^⟩]+⟩/g) || []))]
  if (ph.length) placeholders.push({ id: e.id, placeholders: ph })
  const idx = index.get(e.id)
  if (idx) {
    if (e.year && idx.year && e.year !== idx.year) crossCheck.push({ id: e.id, field: '年份', 条目: e.year, 索引段: idx.year })
    const s = String(e.authors).split(/[\s,，、]+/).filter(Boolean)
    if (idx.author && s.length && !idx.author.split(/[\s、,，]+/).some((x) => s.includes(x))) {
      crossCheck.push({ id: e.id, field: '作者', 条目: String(e.authors).slice(0, 40), 索引段: idx.author })
    }
  }
  generated.push({ id: e.id, type: e.type, text, placeholders: ph, notes: [...e.authorNotes, ...e.titleDerived] })
}

const bad = placeholders.length + blocked.length + crossCheck.length
const exitCode = entries.length === 0 ? 3 : (bad > 0 ? 1 : 0)
const out = {
  tool: 'cite-format', version: packageVersionTag(), style, styleName: STYLE_NAME[style], card: cardRel,
  total: entries.length, generated: generated.length, blocked, placeholders, crossCheck,
  byType: entries.reduce((a, x) => { a[x.e.type || 'unknown'] = (a[x.e.type || 'unknown'] || 0) + 1; return a }, {}),
  orderNote: '输出顺序 = 文献卡顺序（**不得重排**）：GB/T 顺序编码制与 M-Exist-1 双向闭环都依赖它',
  boundary: '本器只出**草稿**：不改定稿正文；缺字段判级归 g-audit-check 的 G15-VolIssue（候选 P2）；类型未识别**不猜**',
  exit: exitCode,
}

if (wantJson) console.log(JSON.stringify(out, null, 2))
else {
  console.log(`\n📚 参考文献草稿（${STYLE_NAME[style]}）——${generated.length}/${entries.length} 条，来源 ${cardRel}\n`)
  if (generated.length === 0) console.log('（无可生成条目）')
  for (const [i, g] of generated.entries()) {
    console.log(`${style === 'gbt' ? `[${i + 1}] ` : ''}[${g.id}] ${g.text}`)
    for (const p of g.placeholders) console.log(`      ⚠ ${p}`)
    for (const n of g.notes) console.log(`      · ${n}`)
  }
  if (blocked.length) { console.log('\n🚫 未生成（类型未识别，不猜）：'); for (const b of blocked) console.log(`  [${b.id}] ${b.reason}`) }
  if (crossCheck.length) { console.log('\n🔍 索引段 ↔ 条目字段不一致（须人工核）：'); for (const c of crossCheck) console.log(`  [${c.id}] ${c.field}：条目 ${c.条目} ≠ 索引段 ${c.索引段}`) }
  console.log(`\n合计：占位 ${placeholders.length} 条 / 未生成 ${blocked.length} 条 / 对账不一致 ${crossCheck.length} 处`)
  console.log(out.orderNote)
}
if (opts['--report']) {
  // v18.67.0（批 4）：`--report` 改为 **CWD 相对**，与全族（m-gate-check / final-check / g-audit-check /
  //   cite-coverage-check / apply-diff / quality-score）同口径。旧版 `join(project, reportRel)` 是本族
  //   唯一的「项目相对」异类——同一旗标两套语义，调用方按 M 门族习惯传参时会解析到非预期位置。
  //   （本旗标只在**显式传入**时才落盘；cli-args 的 `values` 只是示例值，不构成默认路径。）
  //   同时镜像 final-check 的两道显式化（主人裁定方案 (C)，v18.62.4 §8.1 #4）：① 打印解析后绝对路径；
  //   ② 若落在仓库/包根内 → 响亮警告（防误传相对路径静默造目录/覆盖文件）。
  const absReportPath = resolve(reportRel)
  const pkgRootProbe = [join(scriptDir, '..', '..'), join(scriptDir, '..'), join(scriptDir, '..', '..', '..')]
    .find((p) => existsSync(join(p, 'package.json')))
  if (pkgRootProbe) {
    const key = (p) => resolve(p).toLowerCase()
    if (key(absReportPath).startsWith(key(pkgRootProbe))) {
      console.error(`\n⚠ --report 目标落在**仓库/包根**内：${absReportPath}`)
      console.error('  `--report` 的相对路径以**当前工作目录（CWD）**为基准——若非本意，请改用绝对路径或 <项目>/ 下的路径。\n')
    }
  }
  writeReport(absReportPath, JSON.stringify(out, null, 2), { protect: [join(project, 'final', '定稿.md')] })
  console.error(`📄 引用格式报告已落盘: ${absReportPath}`)
}
process.exit(exitCode)
