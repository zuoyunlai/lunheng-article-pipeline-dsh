#!/usr/bin/env node
// 论衡证据素材池 · 统计脚本（v18.96.0 新增）
//
// 用法：
//   node scripts/pool-report.mjs <工作区根>
//
// 功能：读 <工作区根>/evidence-pool/ 的四个池 + manifest，输出统计并（重）生成
//   index.md 人类可读视图。供主控/主人查看池的条数、渠道、信任、时效、复用分布。
//
// 退出码：0 = 成功 ｜ 10 = 参数/路径错 ｜ 70 = 内部错误
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { installExitGuard, requireExistingDir, EXIT_USAGE } from './_lib/exit-guard.mjs'
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs'

installExitGuard()

const USAGE = '用法: node scripts/pool-report.mjs <工作区根>'
let positionals
try {
  ({ positionals } = parseArgs(process.argv.slice(2), {
    flags: ['--help'],
    minPositionals: 1, maxPositionals: 1,
    positionalHint: '<工作区根>',
  }))
} catch (e) {
  if (e && e.code === USAGE_CODE) { console.error(`${e.message}\n${USAGE}`); process.exit(EXIT_USAGE) }
  throw e
}

const workspaceRoot = requireExistingDir(positionals[0], '工作区根')
const poolDir = join(workspaceRoot, 'evidence-pool')
const POOL_FILES = { L: 'literature.json', D: 'data.json', C: 'cases.json', DB: 'databases.json' }
const TYPE_LABEL = { L: '文献', D: '数据', C: '案例', DB: '数据库' }
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))

function main() {
  const all = []
  const perType = { L: 0, D: 0, C: 0, DB: 0 }
  for (const key of Object.keys(POOL_FILES)) {
    const p = join(poolDir, POOL_FILES[key])
    if (!existsSync(p)) continue
    const j = readJson(p)
    perType[key] = j.entries.length
    all.push(...j.entries)
  }

  const trust = { '已发布': 0, '主人投喂': 0, '二手转引': 0 }
  const time = { '🟢': 0, '🟡': 0, '🔴': 0, '': 0 }
  const channel = { '主人预设': 0, '项目沉淀': 0 }
  let reuseTotal = 0
  let maxReuse = { n: 0, title: '' }
  for (const e of all) {
    trust[e.trustLevel] = (trust[e.trustLevel] || 0) + 1
    time[e.timeliness || ''] = (time[e.timeliness || ''] || 0) + 1
    channel[e.channel] = (channel[e.channel] || 0) + 1
    reuseTotal += (e.reuseCount || 0)
    if ((e.reuseCount || 0) > maxReuse.n) maxReuse = { n: e.reuseCount, title: e.title }
  }

  const lines = []
  lines.push('# 论衡证据素材池')
  lines.push('')
  lines.push(`> 生成于 ${new Date().toISOString().slice(0, 10)} ｜ 总条目 ${all.length} ｜ 累计复用 ${reuseTotal} 次`)
  lines.push(`> 渠道：主人预设 ${channel['主人预设']} 条 / 项目沉淀 ${channel['项目沉淀']} 条`)
  lines.push('')
  lines.push('## 分布')
  lines.push('')
  lines.push('| 类型 | 文献 | 数据 | 案例 | 数据库 |')
  lines.push('|---|---|---|---|---|')
  lines.push(`| 条数 | ${perType.L} | ${perType.D} | ${perType.C} | ${perType.DB} |`)
  lines.push('')
  lines.push('| 信任级别 | 已发布 | 主人投喂 | 二手转引 |')
  lines.push('|---|---|---|---|')
  lines.push(`| 条数 | ${trust['已发布']} | ${trust['主人投喂']} | ${trust['二手转引']} |`)
  lines.push('')
  lines.push('| 时效 | 🟢(≤2年) | 🟡(2-5年) | 🔴(>5年) | 未标 |')
  lines.push('|---|---|---|---|---|')
  lines.push(`| 条数 | ${time['🟢']} | ${time['🟡']} | ${time['🔴']} | ${time['']} |`)
  lines.push('')
  lines.push('## 条目清单')
  lines.push('')
  for (const key of Object.keys(POOL_FILES)) {
    const p = join(poolDir, POOL_FILES[key])
    if (!existsSync(p)) continue
    const j = readJson(p)
    if (j.entries.length === 0) continue
    lines.push(`### ${TYPE_LABEL[key]}（${j.entries.length} 条）`)
    lines.push('')
    for (const e of j.entries) {
      const cnt = (e.reuseCount || 0) > 0 ? `【复用${e.reuseCount}次】` : ''
      lines.push(`- **${e.title}** — ${e.source || '—'}（${e.year || '—'}）${e.trustLevel || ''} ${e.timeliness || ''} ${cnt}`)
      if (e.url && e.url[0]) lines.push(`  - ${e.url[0]}`)
    }
    lines.push('')
  }

  writeFileSync(join(poolDir, 'index.md'), lines.join('\n'), 'utf8')

  console.log(`总条目: ${all.length} (L=${perType.L} D=${perType.D} C=${perType.C} DB=${perType.DB})`)
  console.log(`渠道: 主人预设 ${channel['主人预设']} / 项目沉淀 ${channel['项目沉淀']}`)
  console.log(`信任: 已发布 ${trust['已发布']} / 主人投喂 ${trust['主人投喂']} / 二手转引 ${trust['二手转引']}`)
  console.log(`时效: 🟢${time['🟢']} 🟡${time['🟡']} 🔴${time['🔴']} 未标${time['']}`)
  console.log(`累计复用 ${reuseTotal} 次${maxReuse.n > 0 ? `；最高复用「${maxReuse.title}」×${maxReuse.n}` : ''}`)
  console.log(`index.md 已生成: ${join(poolDir, 'index.md')}`)
}

try { main() } catch (err) { throw err }
