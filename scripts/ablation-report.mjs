#!/usr/bin/env node
// ablation-report.mjs — 存量回放型「机制消融读数」（v18.83.0 · AgentWrite 借鉴批 AW-1）
//
// 【仓库级维护脚本，不随包】运行期角色（T0-T9）永远用不到它——消融是**维护期动作**，
//   由主人在 host shell 手动跑，读数粘进 `audits/消融/`。
//
// 为什么需要（AgentWrite 借鉴评估 §三 A1）：
//   本仓机制只增不减——32 个随包脚本 / 25 项 M 门 / 9 角色 / G14 三层防御 / B 轨 / 期刊匹配 / auto_cite…
//   每一项都消耗 token 与步数（交付说明「成本指标」正在记实测成本），但**没有任何一处回答
//   「关掉它，质量掉多少」**（实测：技能目录内 `消融|ablation` **0 命中**）。后果双向：
//   ① 已失效的机制长期空转（先例：G14 早闸因实测「产出为零」被删）；
//   ② 承重机制被精简时无法预判损失。
//
// 本脚本给出的是一条**零新实验成本**的读数路径：对 `run/*/final/定稿.md` **存量回放**机械门，
//   统计「当前有多少份已交付稿仍被该门命中」。它把「机制是否在拦真问题」从轶事变成读数。
//
// ⚠️ 覆盖边界（必须与读数一起引用，不得单独引用；脚本内不猜、不补）：
//   · **覆盖**（机械可复算，判定 = 真正则/结构判据）：三个战略门
//     `structure-check` / `methodology-check` / `cite-coverage-check` + 可读性剖面四指标
//     （`_lib/readability.mjs`，最高只判 P2）。
//   · **不覆盖**：LLM 判定类机制——G14 / G1 / G3 / G5 / G6 / G7 / G10（`g-audit-check.mjs`
//     的 G 项判定注记：「只机检…未覆盖的 6 个 G 子项；判断力项…维持 LLM 判定」）与 T6/T7/T9 角色。它们的判定产物是报告里的 LLM 结论，
//     重放需要**新跑 LLM** ⇒ 一次完整项目数小时（`SKILL.md` 实测 17 个有效项目里 8 个跨度 ≥8 h）。
//     故本脚本对它们**不产出任何数字**，缺即如实标 `not_covered`。
//   · **存量回放 ≠ 开/关 A/B**：本读数给的是「当前命中率」，不是「有它 vs 无它的质量差」。
//     配对差值需重跑项目，本脚本**刻意不内置**（主人 2026-10-08 采纳判据：**存量回放优先，
//     禁止为做实验重跑完整项目**）。
//   · **口径**：可读性在本脚本里跑在「文件头 → 首个文末节」切片上（`sections.bodyBounds().to`），
//     与 `count-chars` 的**正文区**（`## 摘要` 之后起算）**不同源**——两栏口径在输出里分别标注。
//
// 用法：
//   node scripts/ablation-report.mjs [--run-dir <dir>] [--limit N] [--json] [--out <file>]
//   缺省扫描 <cwd>/run。`--out` 写 Markdown（维护者显式指定路径，本脚本不写 run/ 与 final/）。
// 退出码（与仓库级脚本族一致）：0 = 完成（含「0 份定稿」，如实报）/ 10 = 参数或路径错 / 70 = 内部错。
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const SKILL_SCRIPTS = fileURLToPath(new URL('../skills/lunheng-article-pipeline/scripts/', import.meta.url))
const NEEDED = {
  readability: join(SKILL_SCRIPTS, '_lib', 'readability.mjs'),
  sections: join(SKILL_SCRIPTS, '_lib', 'sections.mjs'),
  han: join(SKILL_SCRIPTS, '_lib', 'han.mjs'),
}
for (const [k, p] of Object.entries(NEEDED)) {
  if (!existsSync(p)) {
    console.error(`找不到共享库 ${k}: ${p} —— 消融读数与随包脚本必须同口径，缺库即停（exit 70）。`)
    process.exit(70)
  }
}
const { evaluate } = await import(new URL('../skills/lunheng-article-pipeline/scripts/_lib/readability.mjs', import.meta.url))
const { bodyBounds, sectionBody } = await import(new URL('../skills/lunheng-article-pipeline/scripts/_lib/sections.mjs', import.meta.url))
const { countHan } = await import(new URL('../skills/lunheng-article-pipeline/scripts/_lib/han.mjs', import.meta.url))

/** 机械可复算机制清单（**只增机械项**；LLM 判定类刻意不入表，见头注释覆盖边界）。
 *  `codes` = 该脚本自己的 exit → 档位真源（**逐脚本抄自其头注释，不跨脚本套用**）：
 *    三个战略门都「与 M 门语义同源」：0 全过 / 1 P1 / 2 P0 / 3 仅 P2 软提示 / 10 参数路径错 / 70 内部错。
 *    `cite-coverage` **没有 2 档**（该脚本不判 P0）——故不得给它套 2 = P0。
 *  `flags` = 本脚本**未传**的体裁旗标；未传即默认档，对非 IMRaD 体例可能不适用（见输出「口径限制」）。 */
const MECHANISMS = [
  { id: 'structure', script: 'structure-check.mjs', what: '结构战略门', codes: { 0: '通过', 1: 'P1', 2: 'P0', 3: 'P2' }, flags: '--humanities 未传（默认 IMRaD 档）', needsMethods: true },
  { id: 'methodology', script: 'methodology-check.mjs', what: '方法论战略门', codes: { 0: '通过', 1: 'P1', 2: 'P0', 3: 'P2' }, flags: '--genre 未传（默认档）', needsMethods: true },
  { id: 'cite-coverage', script: 'cite-coverage-check.mjs', what: '引用覆盖战略门', codes: { 0: '通过', 1: 'P1', 3: 'P2' }, flags: '无 2 档（不判 P0）', needsMethods: false },
]
const HARD = new Set(['P0', 'P1'])
const SOFT = new Set(['P2'])
/** 「非 IMRaD 体例且未传体裁旗标 → 不适用」——**不是本脚本发明的口径，而是照抄既有消费点**：
 *  `quality-score.mjs` 的「非 IMRaD 且未传 --humanities → 分量 N/A」分支原文「无「方法/结果」节且未显式 `--humanities` → 本分量 N/A（如实写进 na[]，
 *  覆盖率随之下降，而不是悄悄给 0 分）」+ 理由「结构门按 IMRaD 词汇判据会把**体例差异记成质量缺陷**」。
 *  不套这条纪律，本脚本量的就是「体例差异」而不是「机制命中」（首轮实测即撞上，见报告 §1）。 */
const NA_NOTE = '非 IMRaD 体例（无「方法/结果」节）且未传体裁旗标——按 quality-score 的 N/A 口径**不适用**，不判缺陷'

const USAGE = '用法: node scripts/ablation-report.mjs [--run-dir <dir>] [--limit N] [--json] [--out <file>]'
const argv = process.argv.slice(2)
const opts = { runDir: null, limit: null, json: false, out: null }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '-h' || a === '--help') { console.log(`${USAGE}\n  缺省扫描 <cwd>/run，纯只读（--out 除外）。`); process.exit(0) }
  else if (a === '--json') opts.json = true
  else if (a === '--run-dir' || a === '--limit' || a === '--out') {
    const v = argv[++i]
    if (!v || v.startsWith('--')) { console.error(`${a} 缺少值\n${USAGE}`); process.exit(10) }
    if (a === '--run-dir') opts.runDir = v
    else if (a === '--limit') {
      if (!/^\d+$/.test(v)) { console.error(`--limit 必须是整数\n${USAGE}`); process.exit(10) }
      opts.limit = Number(v)
    } else opts.out = v
  } else { console.error(`未知参数: ${a}\n${USAGE}`); process.exit(10) }
}

const runDir = resolve(opts.runDir || join(process.cwd(), 'run'))
if (!existsSync(runDir) || !statSync(runDir).isDirectory()) {
  console.error(`--run-dir 不存在或不是目录：${runDir}\n（本脚本只对**存量产物**回放，不做任何生成）\n${USAGE}`)
  process.exit(10)
}

/** 产物里的路径一律**相对化**（`localpath` 门：非随包文件含本机绝对路径须登记；相对化比登记更省事且可携带）。 */
const runLabel = relative(process.cwd(), runDir) || runDir

/** 收集「项目目录 / final / 定稿.md」（只下探一层，与 `lunheng-stats.mjs` 的扫描面同构）。 */
const projects = []
for (const name of readdirSync(runDir).sort()) {
  const draft = join(runDir, name, 'final', '定稿.md')
  if (!existsSync(draft)) continue
  projects.push({ name, draft })
}
const sample = opts.limit === null ? projects : projects.slice(0, opts.limit)

/** 跑一个机械门：只记**原始 exit** 与末行摘要，不替脚本解释 P 级（exit 语义真源 = 各脚本头注释）。 */
const runMechanism = (scriptName, draftPath) => {
  const scriptPath = join(SKILL_SCRIPTS, scriptName)
  if (!existsSync(scriptPath)) return { kind: 'unavailable', code: null, note: `缺脚本 ${scriptName}` }
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, draftPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { kind: 'ok', code: 0, note: lastLine(stdout) }
  } catch (e) {
    const code = typeof e.status === 'number' ? e.status : null
    const out = `${e.stdout || ''}${e.stderr || ''}`
    if (code === 0) return { kind: 'ok', code: 0, note: lastLine(out) }
    if (code === 10) return { kind: 'invalid', code, note: lastLine(out) }
    if (code === null) return { kind: 'error', code: null, note: lastLine(out) || String(e.message || '') }
    return { kind: 'hit', code, note: lastLine(out) }
  }
}
/** 摘要：优先取人话行；**纯 JSON 输出时解析未通过项**（首轮实测：三个战略门默认把 JSON 打到 stdout，
 *  末行恒为 `}`——只刮末尾等于什么都没记，而真信息就在那段 JSON 里）。 */
function lastLine(s) {
  const raw = String(s ?? '')
  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  const human = lines.find((l) => !/^[{}\[\],]+$/.test(l) && !/^"/.test(l))
  if (human) return clip(human)
  try {
    const j = JSON.parse(raw.slice(raw.indexOf('{')))
    const c = j && j.checks
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      const bad = Object.entries(c).filter(([, v]) => v && v.pass === false)
      if (bad.length) {
        return clip(bad.map(([id, v]) => `${id} ${v.name ?? ''} ${v.severity ?? ''}${Array.isArray(v.missing) && v.missing.length ? `（缺 ${v.missing.slice(0, 3).join('/')}）` : ''}`.replace(/\s+/g, ' ').trim()).join('；'))
      }
      const skip = Object.entries(c).filter(([, v]) => v && v.pass === 'SKIP')
      if (skip.length) return clip(skip.map(([id]) => `${id} SKIP`).join('；'))
      return clip('三项检查全过')
    }
    if (j && j.overall) return clip(String(j.overall))
  } catch { /* 非 JSON：落到下面的兜底 */ }
  return '（无人类摘要行，且 stdout 非可解析 JSON——细则看各脚本 `--report` 产物）'
}
function clip(l) { return l.length > 90 ? l.slice(0, 90) + '…' : l }

const rows = []
for (const p of sample) {
  let text = ''
  try { text = readFileSync(p.draft, 'utf8') } catch (e) { rows.push({ name: p.name, readError: String(e.message || e) }); continue }
  const { to } = bodyBounds(text)
  const slice = text.slice(0, to)
  const read = evaluate(slice)
  const mech = {}
  // 体例适用性判据（与 `quality-score.mjs` 的 N/A 分支同源）：有「方法」或「结果」节 = IMRaD 向 → 默认档适用。
  const hasMethods = sectionBody(text, '方法') !== null || sectionBody(text, '结果') !== null
  for (const m of MECHANISMS) {
    if (m.needsMethods && !hasMethods) {
      mech[m.id] = { kind: 'not_applicable', code: null, note: NA_NOTE, label: null }
      continue
    }
    const r = runMechanism(m.script, p.draft)
    r.label = r.kind === 'hit' ? (m.codes[r.code] ?? `exit ${r.code}`) : null
    mech[m.id] = r
  }
  rows.push({
    name: p.name,
    hanHead: countHan(slice),
    readability: { severity: read.severity, hitCount: read.hits.length, hits: read.hits },
    mech,
  })
}

/** 汇总：**硬命中（P0/P1）与软提示（P2）分列**——把 exit 3 记成「命中」会把「有软提示」读成缺陷（本仓反模式）。
 *  分母只含**有判定**的样本；invalid(10)/unavailable/error 单列，不混进分母。 */
const summary = MECHANISMS.map((m) => {
  let ok = 0, hard = 0, soft = 0, na = 0, invalid = 0, unavailable = 0, error = 0
  const hardDetail = []
  for (const r of rows) {
    const x = r.mech?.[m.id]
    if (!x) continue
    if (x.kind === 'ok') ok++
    else if (x.kind === 'not_applicable') na++
    else if (x.kind === 'invalid') invalid++
    else if (x.kind === 'unavailable') unavailable++
    else if (x.kind === 'error') error++
    else if (x.kind === 'hit') {
      if (HARD.has(x.label)) { hard++; hardDetail.push({ project: r.name, label: x.label, note: x.note }) }
      else soft++
    }
  }
  const denom = ok + hard + soft
  return { id: m.id, what: m.what, ok, hard, soft, na, invalid, unavailable, error, denom, hardRate: denom ? +(hard / denom).toFixed(3) : null, hardDetail }
})
const readHit = rows.filter((r) => r.readability?.severity === 'P2').length
const readDenom = rows.filter((r) => r.readability).length

const payload = {
  schema: 'lunheng-ablation-report/v1',
  runDir: runLabel,
  generatedAt: new Date().toISOString(),
  sampleSize: rows.length,
  coverage: { covered: MECHANISMS.map((m) => m.id).concat('readability'), notCovered: ['G14', 'G1', 'G3', 'G5', 'G6', 'G7', 'G10', 'T6', 'T7', 'T9'] },
  summary,
  readability: { hit: readHit, denom: readDenom },
  rows,
}

if (opts.json) console.log(JSON.stringify(payload, null, 2))
else {
  const md = []
  md.push(`# 机制消融读数（存量回放）— ${runLabel}`)
  md.push('')
  md.push(`> 样本：**${rows.length}** 份 \`final/定稿.md\`｜生成：${payload.generatedAt}｜脚本：\`scripts/ablation-report.mjs\``)
  md.push('> ⚠️ **覆盖边界（须与读数一起引用）**：仅**机械可复算**机制；**LLM 判定类不在读数内**——')
  md.push('>   G14 / G1 / G3 / G5 / G6 / G7 / G10（判断力项）与 T6/T7/T9 角色，重放需新跑 LLM（一次完整项目数小时）。')
  md.push('> **存量回放 ≠ 开/关 A/B**：本表给的是**当前命中率**，不是「有它 vs 无它」的质量差。')
  md.push('> **口径**：`汉字(文件头→首个文末节)` 与 `可读性` 同源切片；它与 `count-chars` 的正文区（`## 摘要` 之后）**不同源**。')
  md.push('')
  md.push('## 读数表（每格 = 该门在该稿上的档位；`通过` = exit 0）')
  md.push('')
  md.push('| 项目 | 汉字(切片) | structure | methodology | cite-coverage | 可读性 |')
  md.push('|---|---|---|---|---|---|')
  for (const r of rows) {
    if (r.readError) { md.push(`| ${r.name} | — | 读取失败 | 读取失败 | 读取失败 | 读取失败 |`); continue }
    const cell = (x) => (x ? (x.kind === 'ok' ? '通过' : x.kind === 'hit' ? x.label : x.kind === 'not_applicable' ? 'N/A' : `${x.kind}${x.code === null ? '' : ' ' + x.code}`) : '—')
    md.push(`| ${r.name} | ${r.hanHead} | ${cell(r.mech.structure)} | ${cell(r.mech.methodology)} | ${cell(r.mech['cite-coverage'])} | ${r.readability.severity === 'PASS' ? '通过' : `P2 ×${r.readability.hitCount}`} |`)
  }
  md.push('')
  md.push('## 汇总（**硬命中 P0/P1 与软提示 P2 分列**；`3` 不是缺陷；`N/A` 不进分母）')
  md.push('')
  md.push('| 机制 | 硬命中(P0+P1) | 软提示(P2) | 通过 | 有判定 | 硬命中率 | N/A(体例不适用) | invalid(10) | unavailable | error |')
  md.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const s of summary) md.push(`| ${s.id}（${s.what}） | ${s.hard} | ${s.soft} | ${s.ok} | ${s.denom} | ${s.hardRate === null ? '—' : s.hardRate} | ${s.na} | ${s.invalid} | ${s.unavailable} | ${s.error} |`)
  md.push(`| readability（可读性剖面，门最高 P2） | — | ${readHit} | ${readDenom - readHit} | ${readDenom} | — | — | — | — | — |`)
  md.push('')
  const hardRows = summary.flatMap((s) => s.hardDetail.map((d) => ({ mech: s.id, ...d })))
  md.push(`## 硬命中明细（仅 P0/P1，共 ${hardRows.length} 条；末行摘要取自各脚本 stdout）`)
  md.push('')
  if (hardRows.length === 0) md.push('（无硬命中）')
  else {
    md.push('| 项目 | 机制 | 档 | 脚本末行摘要 |')
    md.push('|---|---|---|---|')
    for (const d of hardRows) md.push(`| ${d.project} | ${d.mech} | ${d.label} | ${String(d.note || '').replace(/\|/g, '\\|')} |`)
  }
  md.push('')
  md.push('## ⚠️ 口径限制（**必须与读数一起引用**，逐条都可推翻上面的数字）')
  md.push('')
  md.push('1. **体裁适用性按既有 N/A 口径处理**：`structure` / `methodology` 只在「有方法或结果节」时判，否则记 **N/A**——')
  md.push('   这条照抄 `quality-score.mjs` 的「非 IMRaD 且未传 --humanities → 分量 N/A」分支（不传该旗标对非 IMRaD 体例会把**体例差异记成质量缺陷**）。')
  md.push('   **残余限制**：有方法节但体裁仍非实证的稿子无从分辨（`--genre` 真源 = `_shared/文类档案.md` 的 11 个 code，须逐稿传），故 N/A 是**保守近似**。')
  md.push('2. **可读性读数存在循环**：四指标阈值**就是在同批存量 `final/定稿.md` 上标定**的（21 份 / 重标定 23 份参与）——')
  md.push('   故「0 命中」是**构造成立**的结果，**不得**作为「该机制无效」或「该机制有效」的证据。')
  md.push('3. **`exit 3` = 仅 P2 软提示**（各脚本头注释真源），不是缺陷；把它计入命中率是本仓已登记过的反模式。')
  md.push('4. **存量回放 ≠ 开/关 A/B**，亦**不是**质量结论：本表不产出分数、不参与任何 exit 语义（同「度量不是闸门」）。')
  md.push('')
  md.push('## 如实声明')
  md.push('')
  md.push('- **样本量**：`n < 5` 时**只报读数、不下机制判定**（消融结论须写明 `n`；小样本差值不作证据）。')
  md.push('- **exit 只记原值**：本表不替脚本解释 P 级（档位映射逐脚本抄自其头注释）；`10` = 参数/路径错（非内容判定）、`70`/空 = 内部错或不可用，**均不混进命中率分母**。')
  md.push('- **不产出 LLM 判定类读数**：上表缺失的那些机制不是「通过」，而是**未测**——不得读成「已核」。')
  const text = md.join('\n') + '\n'
  if (opts.out) {
    const abs = resolve(opts.out)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, text, 'utf8')
    console.log(`已写入 ${abs}（样本 ${rows.length} 份）`)
  } else console.log(text)
}
process.exit(0)
