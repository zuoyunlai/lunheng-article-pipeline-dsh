#!/usr/bin/env node
// 论衡引用机械核验 ref-verify（v19.13.0 新增；源动议 = `audits/反哺报告-2026-10-18-参考文献真实性机械核验-v1.md` R1/R3/R5/R6）
//
// 用法：
//   node scripts/ref-verify.mjs <项目目录> [--report <path>] [--card <相对路径>]
//                                [--dry-run] [--offline] [--max <n>] [--json]
//
// 退出码（**刻意不设 1**：本脚本不做内容判定，见下）：
//   0  = 清单已生成（**不判结论分布**——found/not_found 的多少不是"通过/不通过"）
//   3  = 存在 `unverified` / `error`（无网、授权档位禁跑、源全失败）→ 须人工复核，**不得当通过**
//   10 = 参数或路径错误
//   70 = 内部错误（脚本缺陷）
//
// ── 三条硬边界（改本脚本前先读）──────────────────────────────────────────────
// ① **不设 exit 1**：`AGENTS.md` 判据——「只要脚本不做内容判定，它的 1 就一定是撞码」。本脚本只出清单，
//    判级归 T7（G1）。所以「有 N 条编造信号」也仍是 0（清单完整落盘），不是 1。
// ② **缺席不改变任何判级**：本脚本不产出 M 门项、不进 `g-audit-check`。T7 的 G1 在**没有** `引用核验.json`
//    时仍按既有抽验口径写报告（`M-Exist-9` 的"带量词的数字"实据形态仍成立）——这是「不阻塞」的实现形态。
// ③ **无网不是失败而是降级**：任何网络问题 → 该条 `unverified` + exit 3，**绝不**写"找不到"（那会把
//    基础设施故障读成文献造假）。
//
// ── 为什么是 DOI-first（与 dsh-reference-checker 的关键差异）─────────────────
// 论衡文献卡是**结构化**的（`- **DOI**: 10.x/y`），而参考实现只吃自由文本行、把 DOI 丢在行里不直查。
// DOI 直查 = 1 次请求拿回 title/author/**volume/issue/pages**，同时服务两件事：存在性核验（R1）
// 与卷期页码回填（R3，治 `G15-VolIssue` 的候选清单）。
//
// ── 年份口径（R4）─────────────────────────────────────────────────────────
// Crossref 的 `issued` 常是在线优先年，`published-print` 才是纸本年。GB/T 与 APA 都用**出版年**，
// 故取值优先级 = published-print > journal-issue.published-print > issued > published-online。
// 只取 `issued` 会把对的年份改错（实测 DOI `10.1080/14703297.2023.2190148`：`issued`=2023 / print=2024）。

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installExitGuard, requireExistingDir, requireExistingFile, EXIT_USAGE, EXIT_INTERNAL } from './_lib/exit-guard.mjs'
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs'
import { writeReport } from './_lib/destructive-write.mjs'
import { packageVersionTag } from './_lib/pkg-version.mjs'

const USAGE = '用法: node scripts/ref-verify.mjs <项目目录> [--report <path>] [--card <相对路径>] [--dry-run] [--offline] [--max <n>] [--json]'

export const SCHEMA = 'lunheng-ref-verify/1'
export const DEFAULT_CARD = 'literature/文献卡.md'
export const DEFAULT_BRIEF = '01-任务简报.md'
export const HARD_MAX = 200
export const DEFAULT_MAX = 50
const CONCURRENCY = 4
const HTTP_TIMEOUT_MS = 15000
const RETRY_ON = new Set([429, 500, 502, 503])

// ── 文献卡解析（纯函数，供测试直接调用）───────────────────────────────────────

/**
 * 把 `文献卡.md` 切成 `[Lxx]` 条目。
 * 三种真实形态都要认（实测 `run/` 下三种并存）：
 *   ① `### [L01] 标题`（**主流**：条目是三级标题）
 *   ② `- [L01] 作者. 题名[J]. …`（无序列表）
 *   ③ `[L01] 作者. 题名[J]. …`（裸行）
 * @param {string} text 卡片全文
 * @returns {{id:string, raw:string, line:string}[]}
 */
export function parseCards(text) {
  const out = []
  let cur = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.replace(/\s+$/, '')
    // `[Lxx]` 可带后缀（模板里有 `[L03 二手转引]`）——后缀不参与编号
    const m = /^\s*(?:#{1,6}\s*|[-*]\s*)?\[(L\d+)[^\]]*\]\s*(.*)$/.exec(l)
    if (m) {
      if (cur) out.push(cur)
      cur = { id: m[1], raw: l, line: m[2] }
    } else if (cur) {
      cur.raw += '\n' + l
    }
  }
  if (cur) out.push(cur)

  // 同一份卡里可能出现**两处** `[Lxx]`：目录/清单段（一行式）+ 真正的条目段（字段齐全）。
  // 实测（`run/夫妻收入差异家庭权力`：清单 L62-63 + 条目 L92-106 → 15 条被读成 32 条）。
  // 去重口径 = 保留 **raw 更长**的那一条（字段更全），按编号排序。
  const byId = new Map()
  for (const c of out) {
    const prev = byId.get(c.id)
    if (!prev || c.raw.length > prev.raw.length) byId.set(c.id, c)
  }
  return [...byId.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
}

/** 条目里那条 GB/T 著录行（含 `[J]`/`[J/OL]`/`[EB/OL]`/`[M]`… 标记的行）；没有则 null。 */
export function citationLine(card) {
  for (const l of String(card.raw || '').split(/\r?\n/)) {
    const t = l.trim()
    if (t.length > 20 && /\[[A-Z][A-Z/]*\]\s*[.．,]?\s/.test(t)) return t
  }
  return null
}

/**
 * 取条目的结构化字段（`- **标题**：…` / `- **作者**：…` / `- **年份**：…` …）。
 * **这是本脚本与自由文本核验器的根本差异**：论衡文献卡是字段化的，字段优先、著录行兜底
 * （字段是 T1 落卡时直接写的，著录行是拼给人看的，前者更接近真值）。
 * @param {{raw:string}} card
 * @returns {Record<string,string>}
 */
export function fieldsOf(card) {
  const f = {}
  for (const l of String(card.raw || '').split(/\r?\n/)) {
    const m = /^\s*[-*]?\s*\*\*([^*]{1,24})\*\*\s*[：:]\s*(.+)$/.exec(l)
    if (m) f[m[1].trim()] = m[2].trim()
  }
  return f
}

const pickField = (f, keys) => {
  for (const k of keys) if (f[k] && f[k].length) return f[k]
  return null
}

/** 取条目的 DOI（字段优先，其次全文；剥 `https://doi.org/` 与尾随标点）。 */
export function cardDoi(card) {
  const f = fieldsOf(card)
  const src = pickField(f, ['DOI', 'DOI 或 URL', 'DOI/URL', 'DOI 或链接']) || card.raw || ''
  const m = /(10\.\d{4,9}\/[^\s，。；、）)（(：:"'<>]+)/.exec(src)
  return m ? m[1].replace(/[.,;]$/, '') : null
}

/**
 * 取条目标题（**判不出就返回 null，绝不猜**）：
 *   ① 字段 `- **标题**：…`（最可靠）
 *   ② GB/T 著录行：`作者. 题名[J/OL]. …`（`[J/OL]` 必须认——论衡定稿主力形态）
 *   ③ APA 著录行：`Tian, L. (2024). Title. *Journal*, …`
 */
export function cardTitle(card) {
  const f = fieldsOf(card)
  const field = pickField(f, ['标题', '题名'])
  const cite = citationLine(card)
  if (field) {
    const t = /\[([A-Z][A-Z/]*)\]/.exec(cite || '') || /\[([A-Z][A-Z/]*)\]/.exec(card.line || '')
    return { title: field.replace(/^["“]|["”]$/g, ''), type: t ? t[1] : null, cite }
  }
  const s = cite || card.line || ''
  const gb = /[.．]\s*([^\[\n]{4,300}?)\s*\[([A-Z][A-Z/]*)\]\s*[.．,]?/.exec(s)
  if (gb) return { title: gb[1].trim(), type: gb[2], cite }
  const apa = /\(\s*(?:19|20)\d{2}\s*\)\s*[.．]\s*(.+?)\s*\.\s+[*_]/.exec(s)
  if (apa) return { title: apa[1].trim(), type: 'APA', cite }
  // ④ 只有标题行（`### [L01] 题名`）：剥掉可能存在的「作者. 」前缀后当标题；太短则放弃
  const head = String(card.line || '').trim()
  if (head.length >= 15) {
    const stripped = head.replace(/^[^.]{0,60}?[.．]\s*(?=\S{10,})/, '')
    return { title: stripped.trim(), type: null, cite }
  }
  return { title: null, type: null, cite }
}

/** 取条目年份（字段 `年份` / `来源/年份` 优先，其次著录行）。 */
export function cardYear(card) {
  const f = fieldsOf(card)
  const field = pickField(f, ['年份', '出版年', '来源/年份', '发表年份'])
  const src = field || citationLine(card) || card.raw || ''
  const m = /(?:19|20)\d{2}/.exec(src)
  return m ? Number(m[0]) : null
}

/**
 * 取首作者的**候选姓氏**（数组，任一命中即算作者匹配）。
 * 为什么给数组而不是单个"姓氏"：GB/T 写 `COTTON D R E`（姓在前）、APA 写 `Tian, L.`、
 * 数据源写 `Alex Glynn`（姓在后）——**同一份卡里三种写法都有**（实测 `gen-ai-academic-integrity`
 * 的 `COTTON D R E` 会被「取最后一个词」读成 `E`）。取首位两个 token 作候选，
 * 既覆盖两种序，又不会把「不同作者的论文」误判成匹配。
 */
export function cardSurnames(card) {
  const f = fieldsOf(card)
  const field = pickField(f, ['作者', '作者/来源'])
  const s = String(field || citationLine(card) || card.line || '').trim()
  const first = s.split(/[,，;；]/)[0].trim()
  if (!first) return []
  const cjk = /^([\u4e00-\u9fff]{2,4})/.exec(first)
  if (cjk) return [cjk[1]]
  const tokens = first.split(/\s+/).map((w) => w.replace(/[.,;:、]$/g, '')).filter((w) => w.length >= 2 && !/\d/.test(w))
  if (!tokens.length) return []
  return [...new Set([tokens[0], tokens[tokens.length - 1]])]
}

/** 展示用：候选姓氏的第一个。 */
export function cardSurname(card) {
  const list = cardSurnames(card)
  return list.length ? list[0] : null
}

// ── Crossref 记录消费（R4 年份口径 / R3 回填）───────────────────────────────

/**
 * 按 R4 的优先级取出版年：`published-print` > `journal-issue.published-print` > `issued` > `published-online`。
 * @param {object} m Crossref `message`
 * @returns {{year:number|null, source:string}}
 */
export function pickYear(m) {
  const y = (o) => (o && o['date-parts'] && o['date-parts'][0] && o['date-parts'][0][0]) || null
  const order = [
    ['published-print', y(m && m['published-print'])],
    ['journal-issue.published-print', y(m && m['journal-issue'] && m['journal-issue']['published-print'])],
    ['issued', y(m && m.issued)],
    ['published-online', y(m && m['published-online'])],
  ]
  for (const [source, year] of order) if (year) return { year: Number(year), source }
  return { year: null, source: 'none' }
}

/** 标题相似度：token Jaccard 与 containment 取较大者（短标题 / 双向匹配都稳）。 */
export function titleSimilarity(a, b) {
  return titleOverlap(a, b).t
}

/**
 * 标题重合的**完整形态**：除相似度外还给出 `shared`（共有 token 数）。
 * 为什么必须有 `shared`：containment 对**短标题**天然宽松——实测伪造题
 * 「A non-existent paper that was never published anywhere」与真实论文
 * 「A non-existent genre」只共 2 个 token，containment 却是 0.67 → 判成 `partial`。
 * 故 `found` 额外要求 `shared ≥ 3`，`partial` 要求 `shared ≥ 2`（短题名靠 DOI 路径兜底，
 * 见 `verifyCard`：DOI 命中时比的是**整条记录**，不依赖标题长度）。
 */
export function titleOverlap(a, b) {
  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !/^\d{4}$/.test(t))
  const A = new Set(norm(a)); const B = new Set(norm(b))
  if (!A.size || !B.size) return { t: 0, shared: 0 }
  let shared = 0
  for (const t of A) if (B.has(t)) shared++
  const jac = shared / (A.size + B.size - shared)
  const cont = shared / Math.min(A.size, B.size)
  return { t: Math.max(jac, cont), shared }
}

/** 候选打分（与参考实现同构，阈值见 `judge`）：0.72 标题 + 0.18 年份 + 0.10 首作者。 */
export function scoreCandidate(cand, card) {
  const ov = titleOverlap(cand.title, card.title || card.line)
  const t = ov.t
  const year = cardYear(card)
  const dy = year && cand.year ? Math.abs(year - cand.year) : null
  const yearFactor = dy === null ? 1 : dy <= 1 ? 1 : dy === 2 ? 0.5 : 0
  const surnames = card.surnames || cardSurnames(card)
  const hay = String(cand.authors || '').toLowerCase()
  const authorMiss = Boolean(surnames.length && hay && !surnames.some((s) => hay.includes(String(s).toLowerCase())))
  const score = 0.72 * t + 0.18 * yearFactor + 0.10 * (authorMiss ? 0 : 1)
  return { score, t, shared: ov.shared, yearGap: dy, authorMiss }
}

/**
 * 判定（`found` 从紧——误判"真实"的代价远大于误判"存疑"）：
 *   found    = score ≥ 0.80 且 t ≥ 0.75 且 shared ≥ 3 且 |Δyear| ≤ 1 且作者未明确不符
 *   partial  = t ≥ 0.55 且 shared ≥ 2（或 DOI 命中但题名对不上 = 张冠李戴候选）
 *   not_found= 其余（有候选但重合不足，或三源皆无）
 */
export function judge(sc) {
  if (sc.score >= 0.8 && sc.t >= 0.75 && sc.shared >= 3 && (sc.yearGap === null || sc.yearGap <= 1) && !sc.authorMiss) return 'found'
  // 短题名例外：token 少时共享 2 个就可能 "看起来很像"（实测伪造题与真论文共 2 个词、containment 0.67）。
  // 故短题必须**近乎完全重合**（t ≥ 0.9）才给 partial；否则一律 not_found。
  const shortOk = sc.shared >= 2 && sc.t >= 0.9
  if (sc.t >= 0.55 && (sc.shared >= 3 || shortOk)) return 'partial'
  return 'not_found'
}

// ── A11 授权串（R5）─────────────────────────────────────────────────────────

/**
 * 读任务简报的外部服务授权串。**缺席/不可读 = 未授权**（不是"默认允许"）。
 * @param {string} briefText
 * @returns {{mode:string|null, allowed:boolean, why:string}}
 */
export function parseAuthz(briefText) {
  const m = /外部服务授权[：:]\s*([^\n]*)/.exec(String(briefText || ''))
  if (!m) return { mode: null, allowed: false, why: '简报无「外部服务授权」串（A11）' }
  const seg = /检索\s*=\s*([^\s/／|]+)/.exec(m[1])
  if (!seg) return { mode: null, allowed: false, why: '授权串缺「检索=」段' }
  const mode = seg[1].trim()
  if (/^<.*>$/.test(mode)) return { mode, allowed: false, why: '授权串留了 <…> 占位（未填）' }
  if (mode !== '全网检索') return { mode, allowed: false, why: `检索=${mode} 不含外网检索，不得外发书目查询` }
  return { mode, allowed: true, why: 'ok' }
}

// ── 网络（4 并发 / 15s / 429·5xx 重试一次 / Crossref polite pool）───────────────

const MAILTO = (process.env.LUNHENG_MAILTO || '').trim()
const UA = `lunheng-ref-verify/1.0 (bibliographic verification${MAILTO ? '; mailto:' + MAILTO : ''})`

/** 单次 GET（带超时与重试）；返回 `{ok, status, json, error}`，**不抛**。 */
async function getJson(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      })
      if (RETRY_ON.has(res.status) && attempt === 0) { await sleep(1200); continue }
      const text = await res.text()
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` }
      return { ok: true, status: res.status, json: JSON.parse(text) }
    } catch (e) {
      if (attempt === 0) { await sleep(600); continue }
      return { ok: false, status: 0, error: String((e && e.message) || e) }
    }
  }
  return { ok: false, status: 0, error: 'unreachable' }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 并发池（4 worker；顺序稳定）。 */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/** Crossref 记录 → 统一候选形态（含 R4 年份与 R3 卷期页）。 */
function fromCrossref(m) {
  const y = pickYear(m)
  const authors = (m.author || []).map((a) => a.family || a.name || '').filter(Boolean).join(', ')
  return {
    source: 'Crossref',
    title: String((m.title && m.title[0]) || '').replace(/\s+/g, ' ').trim(),
    year: y.year, yearSource: y.source,
    venue: (m['container-title'] && m['container-title'][0]) || '',
    volume: m.volume || '', issue: m.issue || '', pages: m.page || '',
    doi: m.DOI || '', authors,
  }
}

/** 单卡核验。返回结果对象（**永不抛**：网络异常归 `unverified`）。 */
async function verifyCard(card, ctx) {
  const base = { id: card.id, ref: card.line.slice(0, 160), doi: cardDoi(card) }
  if (!ctx.net) {
    return { ...base, status: 'unverified', why: ctx.netWhy, flags: [] }
  }
  const candidates = []
  const flags = []
  let anyOk = false

  // ① DOI 直查（1 请求；同时供 R3 回填）
  if (base.doi) {
    const r = await getJson(`https://api.crossref.org/works/${encodeURIComponent(base.doi)}`)
    if (r.ok && r.json && r.json.message) {
      anyOk = true
      const c = fromCrossref(r.json.message)
      const t = titleSimilarity(c.title, card.title || card.line)
      if (t < 0.55) flags.push('doi-title-mismatch')   // 张冠李戴候选（AB-共锁-A 的 P0-2 形态）
      candidates.push({ ...c, t, via: 'doi' })
    } else if (r.status === 404) {
      anyOk = true
      flags.push('doi-404')
    }
  }

  // ② 无 DOI 或 DOI 未命中 → 标题检索（判不出标题时退整行书目检索）
  if (!candidates.length && card.title) {
    const q = new URLSearchParams({ rows: '8', 'query.bibliographic': card.title.slice(0, 300) })
    if (card.author) q.set('query.author', card.author)
    const r = await getJson(`https://api.crossref.org/works?${q}`)
    if (r.ok && r.json) {
      anyOk = true
      for (const m of (r.json.message && r.json.message.items) || []) {
        const c = fromCrossref(m)
        if (!c.title) continue
        candidates.push({ ...c, t: titleSimilarity(c.title, card.title), via: 'title' })
      }
    }
  }

  if (!candidates.length) {
    return anyOk
      ? { ...base, status: 'not_found', flags }
      : { ...base, status: 'unverified', why: '数据源不可达', flags }
  }

  candidates.sort((a, b) => b.t - a.t)
  const best = candidates[0]
  const sc = scoreCandidate({ ...best, year: best.year }, card)
  const status = flags.includes('doi-title-mismatch') ? 'partial' : judge(sc)
  const out = {
    ...base,
    status,
    flags,
    score: Number(sc.score.toFixed(2)),
    t: Number(sc.t.toFixed(2)),
    best: {
      source: best.source, title: best.title, year: best.year, yearSource: best.yearSource,
      venue: best.venue, volume: best.volume, issue: best.issue, pages: best.pages,
      doi: best.doi, url: best.doi ? `https://doi.org/${best.doi}` : '',
    },
  }
  // ③ R3 回填建议（**只建议不改卡**）：**仅 found 才给**——partial/not_found 的"最近记录"可能是
  //    另一篇论文（实测：中文政府文件被配到「教育生态学视角下的中小学教师减负」，若据此回填年份
  //    会把对的改错）。这条与 `G15-VolIssue` 的分工不变：本脚本只列可回填，改卡仍走 P1-D 亲修。
  const backfill = []
  if (status === 'found') {
    const year = cardYear(card)
    if (best.year && year && best.year !== year) backfill.push(`年份 ${year} → ${best.year}（${best.yearSource}）`)
    if (best.volume && !card.raw.includes(String(best.volume))) backfill.push(`卷 ${best.volume}`)
    if (best.issue && !card.raw.includes(`(${best.issue})`)) backfill.push(`期 ${best.issue}`)
    if (best.pages && !card.raw.includes(String(best.pages))) backfill.push(`页 ${best.pages}`)
  }
  if (backfill.length) out.backfill = backfill
  return out
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  installExitGuard()
  let flags, opts, positionals
  try {
    ({ flags, opts, positionals } = parseArgs(process.argv.slice(2), {
      flags: ['--json', '--dry-run', '--offline'],
      values: { '--report': 'final/引用核验.json', '--card': DEFAULT_CARD, '--max': '50' },
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
  const cardRel = String(opts['--card'] || DEFAULT_CARD).replace(/\\/g, '/')
  const cardPath = join(project, cardRel)
  requireExistingFile(cardPath, '文献卡')

  let max = Number.parseInt(String(opts['--max'] || DEFAULT_MAX), 10)
  if (!Number.isFinite(max) || max <= 0) { console.error(`--max 必须是正整数（收到 ${opts['--max']}）`); console.error(USAGE); process.exit(EXIT_USAGE) }
  max = Math.min(max, HARD_MAX)

  const briefPath = join(project, DEFAULT_BRIEF)
  const authz = existsSync(briefPath)
    ? parseAuthz(readFileSync(briefPath, 'utf8'))
    : { mode: null, allowed: false, why: '缺 01-任务简报.md（A11 无从判定）' }

  const net = !flags.has('--dry-run') && !flags.has('--offline') && authz.allowed
  const netWhy = flags.has('--dry-run') || flags.has('--offline')
    ? '本地模式（--dry-run/--offline）：未发出任何请求'
    : `未获授权：${authz.why}`

  const cards = parseCards(readFileSync(cardPath, 'utf8'))
  if (!cards.length) { console.error(`文献卡里没有 [Lxx] 条目：${cardPath}`); process.exit(EXIT_USAGE) }
  const picked = cards.slice(0, max)

  const results = await mapPool(picked.map((c) => {
    const t = cardTitle(c)
    return { ...c, title: t.title, type: t.type, surnames: cardSurnames(c) }
  }), CONCURRENCY, (c) => verifyCard(c, { net, netWhy }))

  const summary = { found: 0, partial: 0, not_found: 0, unverified: 0, error: 0 }
  for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1
  const backfill = results.filter((r) => r.backfill && r.backfill.length)
    .map((r) => ({ id: r.id, suggest: r.backfill }))

  const out = {
    schema: SCHEMA,
    version: packageVersionTag(),
    project: resolve(project),
    card: cardRel,
    authz: { 检索: authz.mode, allowed: authz.allowed, why: authz.why },
    mode: net ? 'online' : 'local',
    total: cards.length,
    checked: picked.length,
    truncated: cards.length > picked.length,
    summary,
    backfill,
    results,
  }

  if (opts['--report']) {
    writeReport(resolve(String(opts['--report'])), JSON.stringify(out, null, 2), { label: '--report' })
  }
  if (wantJson) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log(`# ref-verify：${project}｜模式 ${out.mode}｜条目 ${out.checked}/${out.total}${out.truncated ? '（已截断）' : ''}`)
    if (!net) console.log(`# ${netWhy}`)
    console.log(`# found ${summary.found} / partial ${summary.partial} / not_found ${summary.not_found} / unverified ${summary.unverified} / error ${summary.error}`)
    for (const r of results) {
      const tag = r.status === 'unverified' ? '⏸' : r.status === 'found' ? '✅' : r.status === 'partial' ? '⚠️' : '❌'
      console.log(`${tag} [${r.id}] ${r.status}${r.t !== undefined ? ` t=${r.t}` : ''}${r.flags && r.flags.length ? ' ' + r.flags.join(',') : ''}`)
      if (r.best && r.best.title) console.log(`      ↔ ${r.best.title.slice(0, 70)}${r.best.year ? ` (${r.best.year})` : ''}`)
      if (r.backfill) console.log(`      ⟳ 回填建议：${r.backfill.join('；')}`)
    }
    if (backfill.length) console.log(`\n# 可回填 ${backfill.length} 条（**只建议，不改卡**；改卡走 P1-D 亲修）`)
    if (summary.unverified || summary.error) console.log('# ⚠ 存在 unverified/error：本清单不构成「已核验」结论（exit 3）')
  }

  if (summary.unverified || summary.error) process.exit(3)
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e && e.stack ? e.stack : String(e))
    process.exit(EXIT_INTERNAL)
  })
}
