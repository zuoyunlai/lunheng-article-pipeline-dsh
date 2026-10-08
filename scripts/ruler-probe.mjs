#!/usr/bin/env node
// ruler-probe.mjs — 各档模型「有效生成上限」探针（v18.82.0 · LongWriter 借鉴批 LW-3）
//
// 【仓库级维护脚本，不随包】运行期角色（T0-T9）永远用不到它——探针是**维护期工具**，
//   换模型 / 增候选时由主人在 host shell 手动跑，结果粘进
//   `skills/lunheng-article-pipeline/references/_shared/模型路由.md` §十。
//
// 为什么需要（LongWrite-Ruler 借鉴，arXiv:2408.07055）：
//   `model-routing.mjs` 是**只读复算面**（读配置算路由，不真实调用模型）——它不知道各档模型
//   的**实际单次输出上限**。标称 max_tokens=8192 的模型实际可能在 3000-4000 纯汉字就开始
//   重复/塌缩。这个「有效生成上限」决定 T5 单节预算封多少、修订轮整节重写是否可行。
//
// 两个模式（刻意**不内置真实 LLM 调用**，见下「成本声明」）：
//   node ruler-probe.mjs --plan --models a,b --levels 1000,2000,3000,5000,8000
//       打印「请求计划」：对每个模型 × 每档字数的生成请求 prompt（主人复制到任意客户端逐个跑，
//       把原始输出存为 <目录>/<模型名>/<字数>.txt）。
//   node ruler-probe.mjs --record <目录> --models a,b
//       读已存输出，逐档算「实际纯汉字 / 请求字数」，判定有效上限（比率 ≥0.9 的最大档），
//       输出 Markdown 表（粘贴进模型路由.md §十）。
//
// 退出码（与仓库级脚本族一致）：0 = 完成 / 10 = 参数错误 / 70 = 内部错误。
//
// ⚠️ 成本声明（为什么不内置真实调用）：一次全档探针 ≈ 十几次长生成，几十分钟、几毛到几块钱。
//   内置自动调用会诱导「随手重跑」，且把 API key 依赖引入维护脚本。v1 刻意做「计划 + 记录」
//   两段式：真实生成由主人在自己惯用的客户端完成（对生成参数完全可控、可复核）。
//
// 口径（必须同源，否则探针数据与运行期对不上）：纯汉字 = [\u4e00-\u9fff]，
//   与随包 `count-chars.mjs` / `segment-chars.mjs` 同一实现（`_lib/han.mjs` 的 countHan）。
// 塌缩粗判：输出首段 200 字与末段 200 字的重复率 >60% 视为「疑似重复塌缩」（只标注，不判死）。
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countHan } from '../skills/lunheng-article-pipeline/scripts/_lib/han.mjs'

const HAN = fileURLToPath(new URL('../skills/lunheng-article-pipeline/scripts/_lib/han.mjs', import.meta.url))
if (!existsSync(HAN)) {
  console.error(`找不到共享库 ${HAN} —— 探针与随包脚本必须同口径，缺库即停。`)
  process.exit(70)
}

const argv = process.argv.slice(2)
const USAGE = [
  '用法:',
  '  node scripts/ruler-probe.mjs --plan --models <m1,m2> [--levels 1000,2000,3000,5000,8000]',
  '  node scripts/ruler-probe.mjs --record <输出目录> --models <m1,m2>',
].join('\n')

const getOpt = (name) => {
  const i = argv.indexOf(name)
  if (i === -1) return null
  const v = argv[i + 1]
  if (!v || v.startsWith('--')) { console.error(`${name} 缺少值\n${USAGE}`); process.exit(10) }
  return v
}
const models = getOpt('--models')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
if (!models || models.length === 0) { console.error(`必须给 --models\n${USAGE}`); process.exit(10) }
const levels = (getOpt('--levels') ?? '1000,2000,3000,5000,8000').split(',').map(Number).filter((n) => n >= 100 && Number.isInteger(n))
if (levels.length === 0) { console.error('--levels 须为 ≥100 的整数列表'); process.exit(10) }

/** 首末段重复率粗判（塌缩标注用，不判死）。 */
const collapseRatio = (text) => {
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).join('')
  if (han.length < 400) return 0
  const head = han.slice(0, 200); const tail = han.slice(-200)
  let hit = 0
  for (const ch of tail) if (head.includes(ch)) hit++
  return hit / 200
}

if (argv.includes('--plan')) {
  console.log('# ruler-probe 请求计划（v18.82.0 LW-3）')
  console.log('')
  console.log(`模型：${models.join(' / ')}｜档位（请求字数）：${levels.join(', ')}`)
  console.log('做法：把下面每个 prompt 在目标模型上各跑一次（temperature 建议 0.5），')
  console.log('把**原始输出**分别存为 `<目录>/<模型名>/<字数>.txt`，再跑 --record。')
  for (const m of models) {
    console.log(`\n## ${m}`)
    for (const lv of levels) {
      console.log(`\n### ${lv} 字\n\`\`\`\n请写一篇关于「城市公交系统的历史演变」的连贯科普文，要求恰好 ${lv} 个汉字左右（±10%），不要分节标题，不要列表，一气呵成。\n\`\`\``)
    }
  }
  process.exit(0)
}

const dir = getOpt('--record')
if (!dir) { console.error(`--plan 与 --record 二选一\n${USAGE}`); process.exit(10) }
if (!existsSync(dir)) { console.error(`输出目录不存在: ${dir}`); process.exit(10) }

const today = new Date().toISOString().slice(0, 10)
const rows = []
for (const m of models) {
  const mDir = join(dir, m)
  if (!existsSync(mDir)) { console.error(`缺模型目录: ${mDir}（先跑 --plan 并存好输出）`); process.exit(10) }
  let effective = null
  for (const lv of levels) {
    const f = join(mDir, `${lv}.txt`)
    if (!existsSync(f)) { rows.push({ m, lv, actual: null }); continue }
    const text = readFileSync(f, 'utf8')
    const actual = countHan(text)
    const ratio = actual / lv
    const collapse = collapseRatio(text)
    if (ratio >= 0.9 && collapse <= 0.6) effective = Math.max(effective ?? 0, lv)
    rows.push({ m, lv, actual, ratio: +ratio.toFixed(3), collapse: +collapse.toFixed(2), effective: null })
  }
  // 有效上限回填到该模型行（取达标最大档）
  for (const r of rows) if (r.m === m) r.effective = effective
}

console.log(`| 模型 | 请求字数 | 实际纯汉字 | 比率 | 疑似塌缩 | 有效上限 |`)
console.log(`|---|---|---|---|---|---|`)
for (const r of rows) {
  console.log(`| ${r.m} | ${r.lv} | ${r.actual ?? '（未测）'} | ${r.ratio ?? '—'} | ${r.collapse != null && r.collapse > 0.6 ? '⚠️ 是' : '否'} | ${r.effective ? (r.lv === Math.max(...rows.filter((x) => x.m === r.m && x.actual != null).map((x) => x.lv)) ? `${r.effective}（${today} 实测）` : '') : ''} |`)
}
console.log('')
console.log(`> 判定口径：比率 = 实际纯汉字 / 请求字数；有效上限 = 比率 ≥0.9 且无疑似塌缩的最大档。`)
console.log(`> 粘贴去向：references/_shared/模型路由.md §十；T5 单节预算不应超过写手档有效上限的 80%。`)
console.log(`> 实测日期 ${today}；>90 天未复测请在 §十 标「过期」。`)
process.exit(0)
