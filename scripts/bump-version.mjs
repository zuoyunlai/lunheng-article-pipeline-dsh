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

// v18.62.4（全量审计-v18.62.3 §8.3 #34）：**历史归档面必须整体豁免**——与本仓别处的口径同源。
//   病灶：旧版只跳 `node_modules` / `.git` / `_backup`，而扫描面含 `walk(docs/)`（`:32`）→
//   **会改写 `docs/审计与修订记录/**` 与 `docs/验证记录/**` 里的**历史版本头**。
//   实测（临时副本上跑 `bump-version 18.5.0 18.5.1`）：
//     `[ok] docs\审计与修订记录\论衡插件-遥测看板落地与门裁剪分析.md  <- > 版本：v18.5.0 ×1`
//   —— 把一份**历史分析报告的当年版本头**改成了另一个版本，而该目录在本仓被明定为**历史归档**：
//   `content-rules.mjs:395` 原文「**历史归档目录整体豁免**（`docs/审计与修订记录|验证记录`、
//   `audits/反哺报告-*`、`archive/`）」。→ **一个工具在改写所有门都约定不看的历史**，
//   而文件头注释却声称「排除 `audits/`（历史审计报告原文）」——**注释与实现相反**。
//   修法：把同一套历史归档面在 `walk()` 里也豁免（与 `content-rules.mjs:401` 的 `HIST` 同源）。
//   本 session 亦有两次**独立实证**：`bump-version` 曾把修订记录里的绝对路径改写成占位形态
//   （使本机路径棘轮从 3 降到 2），以及改写 §四 回滚命令旁的历史注解。
const HIST_ARCHIVE_RE = /^(?:docs[\\/](?:审计与修订记录|验证记录)[\\/]|audits[\\/]反哺报告-|archive[\\/])/
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', '.git', '_backup'].includes(e.name)) continue
      if (HIST_ARCHIVE_RE.test(path.relative(ROOT, full) + path.sep)) continue
      walk(full, out)
    } else if (HIST_ARCHIVE_RE.test(path.relative(ROOT, full))) continue
    else if (/\.(md|mjs|yml|json)$/.test(e.name)) out.push(full)
  }
  return out
}

const files = [
  ...walk(path.join(ROOT, 'skills')),
  ...walk(path.join(ROOT, 'docs')),
  ...walk(path.join(ROOT, 'examples')),
  path.join(ROOT, 'package.json'),
  path.join(ROOT, 'cordis.patch.yml'),
  ...[ 'README.md', 'README-zh.md', 'README-es.md', 'README-pt.md', 'README-hi.md', 'SECURITY.md', 'CONTRIBUTING.md' ].map((f) =>
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
