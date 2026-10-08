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
// 口径真源 = `glossary.md` §修订回环 / `deliverables.md` §修订回环：
//   A 轨（审计打回）≤2 ／ B 轨（主控触发：主人洞察 / T6 / T9）≤1 ／ G 环（G14 终闸）≤2 ／
//   **相位轮**（Phase 3.5 主人洞察、Phase 3.6 批判回应）**不占额度，但必须可见**——
//   它们是无额度约束的全稿级改稿，藏起来就等于「≤2 轮」只覆盖了一部分改稿。
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
> **轮次口径真源** = \`glossary.md\` §修订回环：**A 轨 ≤2**（审计打回）／**B 轨 ≤1**（主控触发：主人洞察 / T6 / T9）／
> **G 环 ≤2**（G14 终闸）／**相位轮**（Phase 3.5 / 3.6 的全稿级改稿）**不占额度但必须可见**。
> ⚠️ **本账本的「轮次」与「草稿版本号 N」不是一回事**：实测一个项目 v1..v5 里只有 1 个 A 轨轮
> （其余是首稿、Phase 3.5、Phase 3.6、B 轨）。**轮次以本表为准**。

| 轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间 |
|---|---|---|---|---|---|
`

/** 账本是否存在 */
export function ledgerPath(projectDir) { return join(projectDir, LEDGER_REL) }
export function hasLedger(projectDir) { return existsSync(ledgerPath(projectDir)) }

/**
 * 解析账本。
 * @returns {{exists:boolean, rows:Array, counts:Record<string,number>, malformed:Array<string>, over:Array<string>}}
 */
export function parseLedger(projectDir) {
  const p = ledgerPath(projectDir)
  const out = { exists: false, rows: [], counts: { A: 0, B: 0, G: 0, 相位: 0 }, malformed: [], over: [] }
  if (!existsSync(p)) return out
  out.exists = true
  let text = ''
  try { text = readFileSync(p, 'utf8') } catch { out.malformed.push('账本不可读'); return out }
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
    const cap = ROUND_CAPS[track]
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
  const cap = row.cap ?? ROUND_CAPS[row.track]
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
