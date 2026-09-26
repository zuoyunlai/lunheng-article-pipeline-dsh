// 版本点位批量 bump（参数化：node bump-version.mjs <old> <new>）
//
// 纪律（踩过两次，见 MEMORY）：
//   · **只改「当前版本声明」的固定形态**，绝不无差别 replaceAll——那会把
//     「（v18.18.0 审计修复：…）」这类**历史注记**一起改写，等于篡改 changelog 语义。
//   · 排除 `audits/`（历史审计报告原文）、`tests/`、`scripts/`（代码内历史注解）。
//
// 用法：node scripts/bump-version.mjs 18.18.2 18.18.3
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const [OLD, NEW] = process.argv.slice(2)
if (!/^\d+\.\d+\.\d+$/.test(OLD || '') || !/^\d+\.\d+\.\d+$/.test(NEW || '')) {
  console.error('用法：node scripts/bump-version.mjs <old x.y.z> <new x.y.z>')
  process.exit(10)
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', '.git', '_backup'].includes(e.name)) continue
      walk(full, out)
    } else if (/\.(md|mjs|yml|json)$/.test(e.name)) out.push(full)
  }
  return out
}

const files = [
  ...walk(path.join(ROOT, 'skills')),
  ...walk(path.join(ROOT, 'docs')),
  ...walk(path.join(ROOT, 'examples')),
  path.join(ROOT, 'package.json'),
  path.join(ROOT, 'cordis.patch.yml'),
  ...[ 'README.md', 'README.zh.md', 'README.es.md', 'README.pt.md', 'README.hi.md', 'SECURITY.md', 'CONTRIBUTING.md' ].map((f) =>
    path.join(ROOT, f),
  ),
]

// 「当前版本声明」的固定形态白名单（每条都在真实文件里出现过，非猜的）
const RULES = [
  [`> 版本：v${OLD}`, `> 版本：v${NEW}`],                        // 文件头
  [`- 版本：v${OLD}｜`, `- 版本：v${NEW}｜`],                     // SKILL.md 角色卡行
  [`version: "${OLD}"`, `version: "${NEW}"`],                    // SKILL.md frontmatter
  [`"version": "${OLD}"`, `"version": "${NEW}"`],                // package.json
  [`DSH 原生插件 v${OLD}`, `DSH 原生插件 v${NEW}`],               // cordis.patch.yml 包头
  [`DSH 原生插件（v${OLD}）`, `DSH 原生插件（v${NEW}）`],          // skills/README.md 头（v18.18.1 曾漏此形态）
  [`论衡 v${OLD}：`, `论衡 v${NEW}：`],                           // description 首句
  [`当前版本 **v${OLD}**`, `当前版本 **v${NEW}**`],               // docs/introduction.md
  [`@${OLD}`, `@${NEW}`],                                        // 安装 pin / dist-tag
  [`tag v${OLD}`, `tag v${NEW}`],                                // 发布示例
  [`push origin v${OLD}`, `push origin v${NEW}`],
  [`快速开始指南（v${OLD}）`, `快速开始指南（v${NEW}）`],          // QUICKSTART 标题
]

let patched = 0
for (const f of files) {
  let src
  try { src = fs.readFileSync(f, 'utf8') } catch { continue }
  const before = src
  const hits = []
  for (const [from, to] of RULES) {
    const n = src.split(from).length - 1
    if (n > 0) { hits.push(`${from} ×${n}`); src = src.split(from).join(to) }
  }
  if (src !== before) {
    fs.writeFileSync(f, src)
    patched++
    console.log(`[ok] ${path.relative(ROOT, f)}  <- ${hits.join(' | ')}`)
  }
}
console.log(`\n总计 ${patched} 个文件被改（${OLD} -> ${NEW}）`)
