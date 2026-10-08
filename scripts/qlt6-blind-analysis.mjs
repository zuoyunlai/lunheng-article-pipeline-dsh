#!/usr/bin/env node
// QLT-6 跨体例盲评 · 离线复算与判定（v18.80.4 · 预注册 `audits/预注册-QLT6-跨体例盲评-v1.md` §3 的机械部分）
//
// ── 它做什么 ──────────────────────────────────────────────────────────────────────────────────
//   1) **契约自检**（与 `handoff-check --blind-review` 同口径）：六维名逐字 + `名（x/5）` + `总评分 XX/30`
//      且**等于六维之和** + 首节 `## 已读范围` 非空。不合规件**列入 invalid 且不参与统计**——
//      静默计入 = 用一个没落地的数字支撑结论（本仓最贵的失效形态）。
//   2) **复算 ①**：import `_lib/qlt6.mjs` 的 `normalizePanel`（**单一真源**，绝不另写一份公式）。
//   3) **应用预注册阈值**（只做数值判定，不解释语义）：
//      H1 同尺性：体例均值两两差 ≤ 0.15｜H2 判者一致性：同稿 ① 绝对差均值 ≤ 0.10 且无 > 0.20 者
//      H4 敏感性：每体例 Δ(晚−早) 方向一致且 > 0｜并给出两种 Δ 估计（**同判者**与**跨判者**）
//   4) 报告 **① 的下界饱和**：16 分及以下一律 → 0（下限＝「reject 上界」），故低分段不可区分。
//
// ── 命名约定（本批）──────────────────────────────────────────────────────────────────────────
//   `盲评-<编号>-<判者>.md`，编号首段定体例（`ACAD-T` / `ACAD-D` / `PUB`），末两位 `01`=早期稿、`02`=后期稿。
//   **编号↔项目/稿件的对应在钥匙（映射表）里**，本脚本刻意不读钥匙（分析不需要知道是哪篇）。
//
// 用法：`node scripts/qlt6-blind-analysis.mjs --dir <盲评件目录> [--json] [--strict]`
// 退出码：0 = 契约全合规｜1 = 有不合规件（**不得静默**，见上）｜10 = 参数/目录错｜70 = 内部错误
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DIMS = ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范']
/** 预注册 §3 冻结阈值（改这里＝改判据；须另立预注册 v2 并注明是否已看结果）。 */
export const CRITERIA = { H1_interGenreMaxDiff: 0.15, H2_judgeMeanAbsDiff: 0.10, H2_judgeHardMax: 0.20 }

const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dir') opt.dir = argv[++i]
  else if (argv[i] === '--json') opt.json = true
  else if (argv[i] === '--strict') opt.strict = true
  else { console.error(`未知参数：${argv[i]}`); process.exit(10) }
}
if (!opt.dir) { console.error('用法：node scripts/qlt6-blind-analysis.mjs --dir <盲评件目录> [--json] [--strict]'); process.exit(10) }
const dir = resolve(opt.dir)
if (!existsSync(dir) || !statSync(dir).isDirectory()) { console.error(`目录不存在：${dir}`); process.exit(10) }

try {
  const qlt6 = await import(pathToFileURL(join(process.cwd(), 'skills/lunheng-article-pipeline/scripts/_lib/qlt6.mjs')).href)
  const { normalizePanel } = qlt6
  if (typeof normalizePanel !== 'function') { console.error('qlt6.mjs 未导出 normalizePanel —— 单一真源被改动了？'); process.exit(70) }

  /** 解析一件盲评件；返回 {ok, why} —— 契约口径与 handoff-check BR-A2/A3/A4 一致。 */
  const parseArtifact = (file) => {
    const text = readFileSync(join(dir, file), 'utf8')
    const base = file.replace(/\.md$/, '')
    const m = /^盲评-(.+?)-(j\d+)$/.exec(base)
    if (!m) return { ok: false, why: '文件名不符 `盲评-<编号>-<判者>.md`' }
    const [, id, judge] = m
    const dims = {}
    for (const d of DIMS) {
      const r = new RegExp(`${d}\\s*[（(]\\s*([1-5])\\s*/\\s*5\\s*[)）]`).exec(text)
      if (!r) return { ok: false, why: `缺「${d}（x/5）」（六维名逐字，机检契约）`, id, judge }
      dims[d] = Number(r[1])
    }
    const t = /总评分[^\n]*?(\d{1,2})\s*\/\s*30/.exec(text)
    if (!t) return { ok: false, why: '缺 `总评分 XX/30`', id, judge }
    const total = Number(t[1])
    const sum = DIMS.reduce((a, d) => a + dims[d], 0)
    if (total !== sum) return { ok: false, why: `总评分 ${total} ≠ 六维之和 ${sum}`, id, judge }
    const mr = /^##\s*已读范围/m.exec(text)
    if (!mr) return { ok: false, why: '缺首节 `## 已读范围`', id, judge }
    const after = text.slice(mr.index + mr[0].length)
    const nx = after.search(/^##\s/m)
    if (!(nx === -1 ? after : after.slice(0, nx)).trim()) return { ok: false, why: '「已读范围」为空', id, judge }
    return { ok: true, id, judge, dims, total, ratio: +normalizePanel(total).toFixed(4) }
  }

  const files = readdirSync(dir).filter((f) => /^盲评-.+\.md$/.test(f)).sort()
  if (!files.length) { console.error(`目录下没有 \`盲评-*.md\`：${dir}`); process.exit(10) }
  const ok = [], invalid = []
  for (const f of files) { const r = parseArtifact(f); (r.ok ? ok : invalid).push(r.ok ? { file: f, ...r } : { file: f, ...r }) }

  // 编号约定：末两位 = 版本位（01=早 / 02=晚），其余 = 体例码。**必须按此切**——
  //   首版用 `split('-').slice(0,2)` 判体例，于是 `PUB-01` 被当成体例名（`PUB` 只有两段），
  //   导致「PUB-01 / PUB-02」被读成两个体例、该组 Δ 直接算不出来（自测发现，已修）。
  const genreOf = (id) => id.replace(/-\d{2}$/, '')   // ACAD-T-01 → ACAD-T ｜ PUB-01 → PUB
  const slotOf = (id) => id.slice(-2)                  // 01=早 / 02=晚
  const byId = new Map()
  for (const r of ok) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r) }

  // 判者间一致性（同稿多判者）
  const pairs = [...byId.entries()].filter(([, rs]) => rs.length >= 2)
    .map(([id, rs]) => {
      const totals = rs.map((r) => r.total), ratios = rs.map((r) => r.ratio)
      return { id, genre: genreOf(id), slot: slotOf(id), n: rs.length, totals, ratios,
        absDiffTotal: Math.max(...totals) - Math.min(...totals),
        absDiffRatio: +(Math.max(...ratios) - Math.min(...ratios)).toFixed(4) }
    })

  // 体例均值（① ）+ 体例间两两差
  const genres = [...new Set(ok.map((r) => genreOf(r.id)))].sort()
  const genreMean = {}
  for (const g of genres) {
    const rs = ok.filter((r) => genreOf(r.id) === g)
    genreMean[g] = { n: rs.length, meanRatio: +(rs.reduce((a, r) => a + r.ratio, 0) / rs.length).toFixed(4),
      meanTotal: +(rs.reduce((a, r) => a + r.total, 0) / rs.length).toFixed(2) }
  }
  const genrePairs = []
  for (let i = 0; i < genres.length; i++) for (let j = i + 1; j < genres.length; j++) {
    genrePairs.push({ a: genres[i], b: genres[j], diff: +Math.abs(genreMean[genres[i]].meanRatio - genreMean[genres[j]].meanRatio).toFixed(4) })
  }

  // Δ(晚−早)：① **判者平均**（最稳健，用掉全部有效件，部分抵消判者噪声）；② 同判者(j1)；③ 跨判者(j2早→j1晚)
  const delta = []
  for (const g of genres) {
    const pick = (slot, judge) => ok.find((r) => genreOf(r.id) === g && slotOf(r.id) === slot && r.judge === judge)
    const meanAt = (slot) => {
      const rs = ok.filter((r) => genreOf(r.id) === g && slotOf(r.id) === slot)
      return rs.length ? { n: rs.length, meanTotal: rs.reduce((a, r) => a + r.total, 0) / rs.length, meanRatio: rs.reduce((a, r) => a + r.ratio, 0) / rs.length } : null
    }
    const e = meanAt('01'), l = meanAt('02')
    if (e && l) delta.push({ genre: g, estimator: `判者平均(n早=${e.n}/n晚=${l.n})`, early: +e.meanTotal.toFixed(2), late: +l.meanTotal.toFixed(2), deltaTotal: +(l.meanTotal - e.meanTotal).toFixed(2), deltaRatio: +(l.meanRatio - e.meanRatio).toFixed(4) })
    const e1 = pick('01', 'j1'), l1 = pick('02', 'j1'), e2 = pick('01', 'j2')
    if (e1 && l1) delta.push({ genre: g, estimator: '同判者(j1)：早→晚', early: e1.total, late: l1.total, deltaTotal: l1.total - e1.total, deltaRatio: +(l1.ratio - e1.ratio).toFixed(4) })
    if (e2 && l1) delta.push({ genre: g, estimator: '跨判者(j2早→j1晚)', early: e2.total, late: l1.total, deltaTotal: l1.total - e2.total, deltaRatio: +(l1.ratio - e2.ratio).toFixed(4) })
  }
  /** H4 只认「判者平均」这一档（其余两档作为敏感性对照，本身含判者混杂）。 */
  const h4Rows = delta.filter((d) => d.estimator.startsWith('判者平均'))

  // 判定（只做数值判定）
  const judgeMeanAbs = pairs.length ? +(pairs.reduce((a, p) => a + p.absDiffRatio, 0) / pairs.length).toFixed(4) : null
  const judgeHard = pairs.filter((p) => p.absDiffRatio > CRITERIA.H2_judgeHardMax).length
  const h1Fail = genrePairs.filter((p) => p.diff > CRITERIA.H1_interGenreMaxDiff)
  const h4 = { directions: [...new Set(h4Rows.map((d) => Math.sign(d.deltaTotal)))], allPositiveAndConsistent: h4Rows.length > 0 && h4Rows.every((d) => d.deltaTotal > 0) }
  /** 判者噪声与改稿位移的**量级对比**——本批最关键的读数（若两者同量级，① 无法区分「改稿」与「换判者」）。 */
  const judgeNoiseMax = pairs.length ? Math.max(...pairs.map((p) => p.absDiffTotal)) : null
  const judgeNoiseMean = pairs.length ? +(pairs.reduce((a, p) => a + p.absDiffTotal, 0) / pairs.length).toFixed(2) : null
  const draftShiftMax = h4Rows.length ? Math.max(...h4Rows.map((d) => Math.abs(d.deltaTotal))) : null
  const saturated = ok.filter((r) => r.ratio === 0).length

  const out = {
    dir, files: files.length, valid: ok.length, invalid: invalid.length,
    criteria: CRITERIA,
    perArtifact: ok.map((r) => ({ id: r.id, judge: r.judge, genre: genreOf(r.id), slot: slotOf(r.id), dims: r.dims, total: r.total, ratio: r.ratio })),
    interJudgePairs: pairs, judgeMeanAbsDiff: judgeMeanAbs, judgeHardViolations: judgeHard,
    genreMean, interGenreDiffs: genrePairs, deltas: delta,
    judgeNoise: { meanAbsDiffTotal: judgeNoiseMean, maxAbsDiffTotal: judgeNoiseMax, draftShiftMaxTotal: draftShiftMax, comparable: judgeNoiseMax != null && draftShiftMax != null ? (draftShiftMax <= judgeNoiseMax) : null },
    verdict: {
      H1_同尺性: h1Fail.length ? `不达标（${h1Fail.map((p) => `${p.a} vs ${p.b} 差 ${p.diff}`).join('；')}）——① 不得跨体例横比` : '达标',
      H2_判者一致性: judgeMeanAbs == null ? '未测（无同稿双判者）' : (judgeMeanAbs <= CRITERIA.H2_judgeMeanAbsDiff && judgeHard === 0 ? '达标' : `不达标（均值 ${judgeMeanAbs}，>${CRITERIA.H2_judgeHardMax} 的有 ${judgeHard} 对）`),
      H4_敏感性: delta.length === 0 ? '未测' : (h4.allPositiveAndConsistent ? '达标（方向一致且为正）' : `不达标（Δ 方向集 {${h4.directions.join(',')}}，非全正）`),
      'note_①下界饱和': `${saturated}/${ok.length} 件的 ①=0（总评分 ≤16 一律饱和为 0，低分段不可区分）`,
    },
    invalidDetail: invalid,
  }

  if (opt.json) console.log(JSON.stringify(out, null, 2))
  else {
    console.log(`QLT-6 盲评复算：${out.valid}/${out.files} 件合规${out.invalid ? `（**${out.invalid} 件不合规，未计入**）` : ''}`)
    console.log('\n编号            判者  六维                               总分   ①')
    for (const r of out.perArtifact) console.log(`  ${r.id.padEnd(13)} ${r.judge}   ${DIMS.map((d) => r.dims[d]).join('/')}   ${String(r.total).padStart(2)}/30  ${r.ratio.toFixed(4)}`)
    console.log('\n判者间（同稿双判者）：')
    if (!pairs.length) console.log('  （无——H2 未测）')
    for (const p of pairs) console.log(`  ${p.id}: ${p.totals.join(' vs ')} → 总分差 ${p.absDiffTotal}｜① 差 ${p.absDiffRatio}${p.absDiffRatio > CRITERIA.H2_judgeHardMax ? '  ← 超硬上限' : ''}`)
    console.log(`  → 平均 ① 绝对差 ${judgeMeanAbs ?? '—'}（判据 ≤ ${CRITERIA.H2_judgeMeanAbsDiff}）`)
    console.log('\n体例均值（①）：')
    for (const g of genres) console.log(`  ${g}: n=${genreMean[g].n} 均值①=${genreMean[g].meanRatio}（均分 ${genreMean[g].meanTotal}/30）`)
    for (const p of genrePairs) console.log(`  体例差 ${p.a} vs ${p.b}: ${p.diff}（判据 ≤ ${CRITERIA.H1_interGenreMaxDiff}）`)
    console.log('\nΔ(晚−早)：')
    if (!delta.length) console.log('  （未测）')
    for (const d of delta) console.log(`  ${d.genre} [${d.estimator}] ${d.early}→${d.late} = ${d.deltaTotal > 0 ? '+' : ''}${d.deltaTotal} 分（① ${d.deltaRatio > 0 ? '+' : ''}${d.deltaRatio}）`)
    console.log(`\n**判者噪声 vs 改稿位移**：判者间总分差 均值 ${judgeNoiseMean ?? '—'} / 最大 ${judgeNoiseMax ?? '—'}；判者平均改稿位移 最大 ${draftShiftMax ?? '—'}`
      + (out.judgeNoise.comparable ? '  ⇒ **改稿位移 ≤ 判者噪声：① 在此样本上无法区分「改稿」与「换判者」**' : '  ⇒ 改稿位移大于判者噪声（需更多样本确认）'))
    console.log('\n判定（对照预注册 §3 冻结判据）：')
    for (const [k, v] of Object.entries(out.verdict)) console.log(`  ${k}: ${v}`)
    if (invalid.length) { console.log('\n⚠ 不合规件（**未计入统计**，需补/重跑）：'); for (const r of invalid) console.log(`  ${r.file}：${r.why}`) }
  }
  process.exit(invalid.length ? 1 : 0)
} catch (e) {
  console.error(`内部错误：${e?.stack || e}`)
  process.exit(70)
}
