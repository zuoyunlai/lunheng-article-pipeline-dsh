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
//   ⚠️ **v19.5.0（反哺-merge清单-19条 §二.8）：`malformed` 是「该行的问题」，不是「整表的死亡证明」。**
//     病灶（xingbie 实测）：`轮次` 列写成 `1`（应为 `1/2`）时，旧实现让**整表作废**——报「9 处不可解析、
//     账本损坏时额度不可判」，连**格式完全正确的 B/G 行**也无法判定（消费方一律 exit 10 / 硬 21）。
//     一处良构错误（well-formedness bug）作废整份解析 = 把**局部**缺陷放大成**全局**失能。
//     现改为**逐行降级**：坏行记 malformed 后 `continue`（跳过该行），**其余行照判**；
//     `n/m` 校验失败时先尝试**推断 m**（同轨已解析行数 / `ROUND_CAPS`），推断结果写进行的 `capInferred`
//     供展示；推断不出（该轨无额度）才记 malformed。**判据：额度判定只在「该轨一行都解析不出」时才不可判。**
// 复核报告列（v19.5.0 §一.3）：**空** = 未写（A9 判硬）；**显式豁免** = `—（同轮无独立复核：<理由>）`
//   —— 该形态记 `reviewExempt: true`，由 `handoff-check` 的 A9 降 **soft（22）** 而不是硬 21。
//   为什么必须有这一档：A/B 轨在**当时**往往没有独立复核报告（实测 A 轨两轮 v3/v4，复核报告出现在后来的 v6/v8）
//   → 门只能迫使**事后给旧报告补写 sha 声明**，这与本包反对的「事后补闸门留痕」同形。
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeWithSafety } from './destructive-write.mjs'   // v19.6.1（审计 P1-3）：账本写盘走统一安全网

/** 各轨额度（真源 = glossary §修订回环；改这里必须同批改该文档）。相位轮**无额度**。 */
export const ROUND_CAPS = Object.freeze({ A: 2, B: 1, G: 2 })
/** 合法轨名（含相位轮） */
export const TRACKS = Object.freeze(['A', 'B', 'G', '相位'])
export const LEDGER_REL = 'drafts/轮次账本.md'

// ── v19.5.0（反哺-merge清单-19条 §一.3）：**复核报告列的显式豁免形态** ─────────────────────────
//   形态：`—（同轮无独立复核：<理由>）`（破折号亦可写 `-` / `–` / `——`；理由须非空且 ≥4 字）。
//   为什么单列一个判据而不是「空 = 豁免」：**空**是「没写」（缺口），**写了豁免 + 理由**才是「声明过的
//   历史事实」——两者混为一谈会把真缺口放行（见 `handoff-check` A9 的分支）。
const REVIEW_EXEMPT_RE = /^[-–—\u2011]{1,2}\s*[（(]\s*同轮无独立复核\s*[：:]\s*([^）)]*)[）)]\s*$/
/** 该「复核报告」列取值是否为**声明过的豁免**（返回理由串，否则 null）。 */
export function reviewExemption(cell) {
  const m = REVIEW_EXEMPT_RE.exec(String(cell ?? '').trim())
  if (!m) return null
  const why = m[1].trim()
  return why.length >= 4 ? why : null   // 只写「无」这类空理由不算声明（须说明为什么没有）
}

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
 * ⚠️ **v19.5.0（§二.8）逐行降级**：任何一行的形态问题只影响**该行**（进 `malformed` 后跳过），
 *   其余行照判；`n/m` 校验失败时先按「同轨已解析行数 / `ROUND_CAPS`」推断分母（记 `capInferred`）。
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
  // ── v19.21.0（反哺 2026-10-20 插件级 §9）：**按表头列名解析，不再写死列序** ─────────────
  //   病灶（本项目实测两处）：本模块头注的格式是「轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间」，
  //   而实战账本写成了「轨 | 轮次 | 来源 | 正文版本 | 被审正文 sha256 | 复核报告 | 关闭状态」——
  //   列数相同但**含义错位**：`cells[2]` 被读成 draft（实为来源）、`cells[4]` 被读成 review（实为 sha），
  //   于是 A9 报「复核报告不在盘：<sha>」，而人看到的账本明明写着正确路径。
  //   旧实现「列序靠猜」，且**没有轮次账本模板**可抄（references/templates/ 无此件）。
  //   判据：**表头即契约**——先认表头（首列「轨」+ 含「轮次」），再按列名取；无表头时退回旧列序（存量兼容）。
  const COL_OF = {
    track: (c) => /^轨/.test(c),
    round: (c) => /轮次/.test(c),
    draft: (c) => /正文版本|草稿版本|^正文$/.test(c),
    source: (c) => /触发来源|来源/.test(c),
    review: (c) => /复核报告|复核/.test(c),
    at: (c) => /时间|日期/.test(c),
    sha: (c) => /sha256|指纹/i.test(c),
    state: (c) => /关闭状态|状态/.test(c),
  }
  const mapFromHeader = (cells) => {
    const idx = {}
    for (const [k, test] of Object.entries(COL_OF)) idx[k] = cells.findIndex((c) => test(c))
    return idx
  }
  let colMap = null
  let headerLabel = null
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('|')) continue
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (cells.length >= 4 && cells.some((c) => /轮次/.test(c)) && !TRACKS.includes(cells[0])) {
      // 任何「含轮次」的表行都可能是表头或数据行；首列是合法轨名的一定是数据行（`A | 1/2 | …`）。
      if (COL_OF.track(cells[0])) { colMap = mapFromHeader(cells); headerLabel = cells.join(' | ') }
      else if (!colMap && cells.some((c) => /复核|正文|来源/.test(c))) {
        out.malformed.push(`账本表头首列不是「轨」（现为「${cells[0]}」）——列序应为 \`轨 | 轮次 | 来源 | 正文版本 | 被审正文 sha256 | 复核报告 | 关闭状态\``)
      }
    }
    if (colMap) break
  }
  const LEGACY = { track: 0, round: 1, draft: 2, source: 3, review: 4, at: 5, sha: -1, state: -1 }
  const idx = colMap || LEGACY
  const cellAt = (cells, k) => {
    if (idx[k] < 0) return ''
    // v19.21.0（§1/§9）：**单元格先剥排版装饰**（反引号 / 加粗）——账本用 `` `audits/复核报告-v1.md` ``
    //   包路径是合法 markdown，但 A9 的 `resolve(project, r.review)` 不认反引号 → 报「复核报告不在盘」，
    //   而文件明明在盘（本项目实测）。装饰只影响排版、不改变值：剥掉后交给消费者。
    return String(cells[idx[k]] || '').trim().replace(/`/g, '').replace(/\*\*/g, '').trim()
  }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('|')) continue
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (cells.length < 4) continue
    if (/^-+$/.test(cells[0]) || COL_OF.track(cells[0])) continue          // 分隔行 / 表头
    const track = cellAt(cells, 'track')
    if (!TRACKS.includes(track)) {
      out.malformed.push(`未知轨名「${track}」（合法：${TRACKS.join('/')}）`
        + `——本表列序按${colMap ? '表头' : '旧列序'}解析：${headerLabel || '轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间'}；`
        + '「轮次」列必须写成 `n/m`（如 `1/2`）')
      continue
    }
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(cellAt(cells, 'round'))
    if (!m) { out.malformed.push(`轨 ${track} 的「轮次」不是 \`n/m\` 形态：「${cellAt(cells, 'round')}」`); continue }
    const n = Number(m[1]); let declared = Number(m[2])
    const cap = out.caps[track]
    // v19.5.0（§二.8）：分母校验失败**先推断、不牵连整表**——
    //   推断源 = ① 该轨**已解析出的行数**（`n` 正是第几轮时与行数同量纲）；② `ROUND_CAPS`；
    //   ③ 取「已解析行数」与「`n`」中的较大者（一条 `n` 大于行数的行仍说明该轨至少用了 n 轮）。
    let capInferred = false
    if (cap != null && declared !== cap) {
      // v19.9.x（反哺 P2-3）：`guess = Math.max(非负整数, n, cap)` 恒为 ≥n 的整数，原
      //   `Number.isInteger(guess) && guess >= n` 恒真、else 永不执行（死代码）。「该轨无额度」
      //   已由 `cap != null` 跳过整块兜住，此处直接推断即可，不保留伪兜底。
      const guess = Math.max(out.counts[track] || 0, n, cap)
      declared = guess
      capInferred = true
    }
    const row = {
      track, n, declared,
      draft: cellAt(cells, 'draft'), source: cellAt(cells, 'source'),
      review: cellAt(cells, 'review'), at: cellAt(cells, 'at'),
    }
    if (idx.sha >= 0 && cellAt(cells, 'sha')) row.sha256 = cellAt(cells, 'sha')
    if (idx.state >= 0 && cellAt(cells, 'state')) row.state = cellAt(cells, 'state')
    // v19.5.0（§一.3）：复核报告列的**显式豁免**（`—（同轮无独立复核：<理由>）`）→ 记 reviewExempt
    const why = reviewExemption(row.review)
    if (why) { row.reviewExempt = true; row.reviewExemptWhy = why }
    if (capInferred) {
      row.capInferred = true
      out.malformed.push(`轨 ${track} 第 ${n} 轮的 \`n/m\` 分母 ${Number(m[2])} ≠ 生效额度 ${cap}`
        + `——已按「同轨已解析行数 / 额度」推断为 ${declared} 并**照判该行**（v19.5.0 §二.8：一处良构错误不得作废整表解析）`)
    }
    out.rows.push(row)
    out.counts[track] += 1
    if (cap != null && n > cap) out.over.push(`${track} 轨第 ${n} 轮 > 额度 ${cap}——第 ${cap + 1} 轮应走「Acknowledged Limitations」并升级主控`)
    if (cap != null && out.counts[track] > cap) out.over.push(`${track} 轨已记 ${out.counts[track]} 轮 > 额度 ${cap}`)
  }
  return out
}

/**
 * 追加一行（主控或脚本调用；**不覆盖既有行**）。
 * @param {{track:string, n:number, cap?:number, draft?:string, source?:string, review?:string, at?:string, sha256?:string, state?:string}} row
 */
export function appendLedgerRow(projectDir, row) {
  const p = ledgerPath(projectDir)
  let existing = null
  if (existsSync(p)) {
    try { existing = readFileSync(p, 'utf8') } catch { existing = null }
  }
  // v18.80.4（P1-9）：分母取「生效额度」（默认 ∪ 账本授权行）——授权后追加的行直接写新分母。
  let effCaps = ROUND_CAPS
  if (existing != null) {
    try { effCaps = { ...ROUND_CAPS, ...authorizedCaps(existing).caps } } catch { /* 读不到保持默认 */ }
  }
  const cap = row.cap ?? effCaps[row.track]
  const roundCell = cap == null ? `${row.n}` : `${row.n}/${cap}`
  // v19.21.0（§9）：追加行**跟随既有表头**。旧实现写死 6 列，而实战账本有 7 列
  //   （多「被审正文 sha256 / 关闭状态」）→ 追加行与表头错位，A9 把 sha 当复核报告读。
  //   判据：有表头就按列名填；无表头/无文件 → 用 LEDGER_HEADER 的 6 列规范序。
  let line
  if (existing != null) {
    const header = existing.split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('|'))
      .map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
      .find((cells) => cells.length >= 4 && /^轨/.test(cells[0]) && cells.some((c) => /轮次/.test(c)))
    if (header) {
      const val = {
        track: row.track,
        round: roundCell,
        draft: row.draft || '',
        source: row.source || '',
        review: row.review || '',
        at: row.at || new Date().toISOString().slice(0, 10),
        sha256: row.sha256 || '',
        state: row.state || '',
      }
      const cells = header.map((h) => {
        if (/^轨/.test(h)) return val.track
        if (/轮次/.test(h)) return val.round
        if (/sha256|指纹/i.test(h)) return val.sha256
        if (/正文版本|草稿版本|^正文$/.test(h)) return val.draft
        if (/复核报告|复核/.test(h)) return val.review
        if (/关闭状态|状态/.test(h)) return val.state
        if (/时间|日期/.test(h)) return val.at
        if (/触发来源|来源/.test(h)) return val.source
        return ''
      })
      line = `| ${cells.join(' | ')} |\n`
    }
  }
  if (!line) line = `| ${row.track} | ${roundCell} | ${row.draft || ''} | ${row.source || ''} | ${row.review || ''} | ${row.at || new Date().toISOString().slice(0, 10)} |\n`
  // v19.6.1（审计 2026-10-15 全量批 **P1-3**）：账本写盘改走 `writeWithSafety`（temp→rename 原子写 +
  //   时间戳 `.bak` 回滚点）。旧版两处都是裸 `writeFileSync`——账本承载的是**轮次额度**这类「判据输入」
  //   （`parseLedger` 的 `over` 直接喂给交接门与修订环），写坏即无回滚点。
  //   边界（如实）：本函数仍是**读-改-写**，`writeWithSafety` 只消除「半写损坏」，
  //   **不提供并发语义**——当前唯一调用方是单进程顺序执行的修订环脚本，未发现并发调用路径。
  if (!existsSync(p)) {
    mkdirSync(join(projectDir, 'drafts'), { recursive: true })
    writeWithSafety(p, LEDGER_HEADER + line, { inPlace: true })
    return { created: true, appended: line.trim() }
  }
  writeWithSafety(p, readFileSync(p, 'utf8').replace(/\n*$/, '\n') + line, { inPlace: true })
  return { created: false, appended: line.trim() }
}
