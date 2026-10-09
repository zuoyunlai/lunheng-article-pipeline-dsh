// round-ledger.mjs — **修订轮次账本**（v18.81.0 · 独立审计批 2 · 2.1）
//
// 为什么需要它（实测病灶）：「审计打回 ≤2 轮」这条硬约束**零机械强制**——
//   · `apply-revision-cycle.mjs` 对目标版本号**只要求 ≥2 的整数**（v9/v99 都放行）；
//   · 唯一接触轮次的 `轮次类别` 只有 1 处命中（骨架注释），**无消费者**；
//   · `handoff-check.mjs` 对四门单的「轮次计数」**只判字段非空、从不解析数值**
//     （写「已用 5/2 轮」也放行）。
//   全库也**没有一处**「本约束为人工门、机械不判」的边界声明（与 A4c/A8 的沿革声明做法不一致）。
//
// ⚠️ **本模块刻意不做的事**（这是审计报告点名的仪器缺陷，不能再犯一次）：
//   **不把「草稿版本号 N」当轮次**。实测 `run/test-v18-78-2-县中塌陷` 的 `修订说明-v1..v5` 拆开是
//   「首稿自检 / Phase 3.5 正常产物 / Phase 3.6 批判回应 / **A 轨第 1 轮** / B 轨深化轮」——
//   5 是 `max(初稿 N)`，A 轨实际只用 **1** 轮。故轮次必须**独立记账**，账本才是真源。
//
// 口径真源 = `glossary.md` §修订回环 / `deliverables.md` §修订回环 / `pipeline-readme.md` §6.6.1：
//   A 轨（审计打回）≤2 ／ B 轨（**主控触发的「深化轮」**，来源 = 主人洞察 / T6 批判 / T9 建议，
//   须同时满足 §6.6.1 三条件）≤1 ／ G 环（G14 终闸）≤2 ／
//   **相位轮**（Phase 3.5 洞察融合、Phase 3.6 批判修订等**流水线常规相位产物**）**不占额度，但必须可见**——
//   它们是无额度约束的全稿级改稿，藏起来就等于「≤2 轮」只覆盖了一部分改稿。
//   ⚠️ **v18.85.0 口径收敛（治本文件自相矛盾）**：旧文同一段里既把「主人洞察 / T6」列进 **B 轨来源**，
//     又把「Phase 3.5 主人洞察、Phase 3.6 批判回应」列为**相位轮** —— 两读并存，读者无法判定
//     「v2 / v3 占不占 B 轨」。现按 `pipeline-readme.md` §6.6.1 收敛为**一读**：
//     · **常规相位产物**（每项目必经的 3.5 洞察融合轮 / 3.6 批判修订轮）= 相位轮，**不计额度**；
//     · 上述来源若产出**实质建议**且满足 §6.6.1 三条件 → 主控**另行**开 **B 轨深化轮（≤1）**。
//     **两者是不同的轮**：前者是流水线既定产物，后者是额外的质量增益轮——账本里各记一行（轨名不同）。
//     实现未变（`ROUND_CAPS` / `TRACKS` / 解析逻辑一字未动），本批只收敛**注释口径**。
//
// 账本格式（Markdown 表格，主控独占写；脚本可追加行）：
//   | 轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间 |
//   | A | 1/2 | drafts/初稿-v4.md | audits/审计报告-v1.md | audits/复核报告-v1.md | 2026-10-07 |
// 边界（如实）：解析是**行级表格解析**——不认自由散文；行长错列 → 该行计入 `malformed` 并**不静默丢弃**。
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 各轨额度（真源 = glossary §修订回环；改这里必须同批改该文档）。相位轮**无额度**。 */
export const ROUND_CAPS = Object.freeze({ A: 2, B: 1, G: 2 })
/** 合法轨名（含相位轮） */
export const TRACKS = Object.freeze(['A', 'B', 'G', '相位'])
export const LEDGER_REL = 'drafts/轮次账本.md'

export const LEDGER_HEADER = `# 轮次账本

> **主控独占写**（与 \`status.md\` 同一条判据：子代理不写状态文件）。
> **轮次口径真源** = \`glossary.md\` §修订回环：**A 轨 ≤2**（审计打回）／**B 轨 ≤1**（**主控触发的深化轮**，来源：主人洞察 / T6 批判 / T9，须满足 \`pipeline-readme.md\` §6.6.1 三条件）／
> **G 环 ≤2**（G14 终闸）／**相位轮**（Phase 3.5 / 3.6 的**常规相位产物**）**不占额度但必须可见**。
> ⚠️ **v18.85.0 口径收敛**：**常规相位产物（不计额度）**与 **B 轨深化轮（≤1）**是**两轮**——来源相同不等于同一轮；
> 旧文把二者混写，现按 \`pipeline-readme.md\` §6.6.1 分开（判据：该轮是「流水线必经相位」还是「额外资深轮」）。
> ⚠️ **本账本的「轮次」与「草稿版本号 N」不是一回事**：实测一个项目 v1..v5 里只有 1 个 A 轨轮
> （其余是首稿、Phase 3.5、Phase 3.6、B 轨）。**轮次以本表为准**。

| 轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间 |
|---|---|---|---|---|---|
`

/** 账本是否存在 */
export function ledgerPath(projectDir) { return join(projectDir, LEDGER_REL) }
export function hasLedger(projectDir) { return existsSync(ledgerPath(projectDir)) }

/**
 * v18.80.4（全量审计-v18.80.3 P1-9）：从账本头注解析**主人授权的额度覆盖**。
 * 病根：模板 §8 承诺「主人可当场变更轮次上限、写进 §6 即生效」，而机械面固定 `ROUND_CAPS` 2/1/2
 *   → 合法授权的额外轮次仍被 handoff-check 硬 21（授权与机械两个「真源」互斥）。
 * 授权行形态（每轨一行，主控独占写，与表格同文件）：
 *   > 额度授权：A=3（依据：主人 2026-10-08，阶段确认-Phase0.md §6）
 * 规则（宁拒不猜）：① 数值须为正整数且**只许上调**（下调 = 借「授权」绕过既有上限，不允许）；
 *   ② 须含「依据：」说明且提到「主人」——无依据的授权行不生效并计入 malformed。
 * @param {string} text 账本全文
 * @returns {{caps: Record<string, number>, bad: string[]}}
 */
export function authorizedCaps(text) {
  const caps = {}
  const bad = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^>\s*额度授权[:：]\s*([ABG])\s*=\s*(\d+)\s*(.*)$/.exec(line.trim())
    if (!m) continue
    const [, trk, nRaw, rest] = m
    const n = Number(nRaw)
    if (!Number.isInteger(n) || n <= ROUND_CAPS[trk]) {
      bad.push(`轨 ${trk} 的授权行无效（${n} 须为大于默认额度 ${ROUND_CAPS[trk]} 的整数——只许上调）`)
      continue
    }
    if (!/依据[:：]/.test(rest) || !/主人/.test(rest)) {
      bad.push(`轨 ${trk} 的授权行缺「依据：…主人…」说明——不生效`)
      continue
    }
    caps[trk] = n
  }
  return { caps, bad }
}

/**
 * 解析账本。
 * @returns {{exists:boolean, rows:Array, counts:Record<string,number>, malformed:Array<string>, over:Array<string>, caps:Record<string,number>, capsAuthorized:Record<string,number>}}
 */
export function parseLedger(projectDir) {
  const p = ledgerPath(projectDir)
  const out = { exists: false, rows: [], counts: { A: 0, B: 0, G: 0, 相位: 0 }, malformed: [], over: [], caps: { ...ROUND_CAPS }, capsAuthorized: {} }
  if (!existsSync(p)) return out
  out.exists = true
  let text = ''
  try { text = readFileSync(p, 'utf8') } catch { out.malformed.push('账本不可读'); return out }
  // v18.80.4（P1-9）：生效额度 = 默认 ∪ 授权行（只许上调、须含依据；无效行进 malformed 不静默吞）。
  const auth = authorizedCaps(text)
  out.caps = { ...ROUND_CAPS, ...auth.caps }
  out.capsAuthorized = auth.caps
  out.malformed.push(...auth.bad)
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('|')) continue
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (cells.length < 4) continue
    if (/^-+$/.test(cells[0]) || cells[0] === '轨') continue          // 分隔行 / 表头
    const track = cells[0]
    if (!TRACKS.includes(track)) { out.malformed.push(`未知轨名「${track}」（合法：${TRACKS.join('/')}）`); continue }
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(cells[1] || '')
    if (!m) { out.malformed.push(`轨 ${track} 的「轮次」不是 \`n/m\` 形态：「${cells[1]}」`); continue }
    const n = Number(m[1]); const declared = Number(m[2])
    const cap = out.caps[track]
    out.rows.push({ track, n, declared, draft: cells[2] || '', source: cells[3] || '', review: cells[4] || '', at: cells[5] || '' })
    out.counts[track] += 1
    if (declared !== (cap ?? declared)) out.malformed.push(`轨 ${track} 的 \`n/m\` 分母 ${declared} ≠ 该轨额度 ${cap ?? '（无额度）'}`)
    if (cap != null && n > cap) out.over.push(`${track} 轨第 ${n} 轮 > 额度 ${cap}——第 ${cap + 1} 轮应走「Acknowledged Limitations」并升级主控`)
    if (cap != null && out.counts[track] > cap) out.over.push(`${track} 轨已记 ${out.counts[track]} 轮 > 额度 ${cap}`)
  }
  return out
}

/**
 * 追加一行（主控或脚本调用；**不覆盖既有行**）。
 * @param {{track:string, n:number, cap?:number, draft?:string, source?:string, review?:string, at?:string}} row
 */
export function appendLedgerRow(projectDir, row) {
  const p = ledgerPath(projectDir)
  // v18.80.4（P1-9）：分母取「生效额度」（默认 ∪ 账本授权行）——授权后追加的行直接写新分母。
  let effCaps = ROUND_CAPS
  if (existsSync(p)) {
    try { effCaps = { ...ROUND_CAPS, ...authorizedCaps(readFileSync(p, 'utf8')).caps } } catch { /* 读不到保持默认 */ }
  }
  const cap = row.cap ?? effCaps[row.track]
  const roundCell = cap == null ? `${row.n}` : `${row.n}/${cap}`
  const line = `| ${row.track} | ${roundCell} | ${row.draft || ''} | ${row.source || ''} | ${row.review || ''} | ${row.at || new Date().toISOString().slice(0, 10)} |\n`
  if (!existsSync(p)) {
    mkdirSync(join(projectDir, 'drafts'), { recursive: true })
    writeFileSync(p, LEDGER_HEADER + line, 'utf8')
    return { created: true, appended: line.trim() }
  }
  writeFileSync(p, readFileSync(p, 'utf8').replace(/\n*$/, '\n') + line, 'utf8')
  return { created: false, appended: line.trim() }
}
