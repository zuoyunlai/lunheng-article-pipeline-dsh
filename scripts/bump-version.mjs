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
// v19.11.2（反哺 2026-10-17 §P1-10）：新增 `--check` —— **只判定、不写盘**。
//   为什么需要：本脚本是发版链上唯一会写仓库文件的工具，却既无测试也无 CI 调用；
//   `--check` 让 CI 能在**不写盘**的前提下回答「当前树里还有没有被漏 bump 的版本声明」。
//   exit 语义（与仓内既有约定一致）：0 = 无待改（或已 bump 到位）；1 = 存在待改但未写；10 = 参数错。
const CHECK = process.argv.includes('--check')
// v19.11.2（反哺 §S3 第一步）：**`--sync` = 版本头生成化**。
//   病灶：每次发版要人工/多脚本同步 89 份文档的 `> 版本：vX` 头，漏一份就是一次 P1 漂移
//   （本仓历史上已发生多次）。`--sync` 把「该写什么」完全交给 `package.json`：
//   不传 old/new，只把每份文档的**版本头行**改写成 package.json 的 version。
//   与既有 `<old> <new>` 模式的区别：那条走 13 条 RULES（含安装 pin / 标题 / 表格行），
//   本模式**只动版本头**（`> 版本：vX` 与 `- 版本：vX｜`），是最小、最安全的生成面。
const SYNC = process.argv.includes('--sync')
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const [OLD, NEW] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!SYNC && (!/^\d+\.\d+\.\d+$/.test(OLD || '') || !/^\d+\.\d+\.\d+$/.test(NEW || ''))) {
  console.error('用法：node scripts/bump-version.mjs <old x.y.z> <new x.y.z> [--check]')
  console.error('   或：node scripts/bump-version.mjs --sync [--check]   # 版本头一律对齐 package.json')
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
  // v18.69.0（批 6-B）：子技能引擎锚点四种形态——v18.68.0 bump 时规则㉖ 机检抓到这几处漂移
  //   （bump-version 白名单没覆盖，靠人工同步）。纳入后发版不再漏。
  [`论衡 v${OLD} **内嵌子技能**`, `论衡 v${NEW} **内嵌子技能**`],     // lunheng-commands/SKILL.md description 声明式锚点
  [`引擎版本引用当前锚定 **v${OLD}**`, `引擎版本引用当前锚定 **v${NEW}**`], // 同上「当前锚定」行
  [`（论衡 v${OLD}；`, `（论衡 v${NEW}；`],                        // stats-cli / history-cli 头注释「（论衡 vX；…）」
  [`版本：v${OLD}。`, `版本：v${NEW}。`],                          // dispatch-cards.md 行尾「版本：vX。」
  // v18.80.2（独立审计批 5 发版实测）：`docs/quick-facts.md` 的**三处版本声明**长期在替换面之外——
  //   `consistency-check` 规则 ㊲ 的原文即写着「标题那处**不在 bump 脚本的替换面内**，历来靠人工，**实测漏过两版**」。
  //   本机 18.80.1 → 18.80.2 发版时**再次复现**：规则当场报 2 处 P1，第三处「引擎锚定」连规则都没覆盖、由人工比对发现。
  //   判据：**门知道某形态会漂、也知道漂的原因，却不把它纳入自动同步 = 把已知缺口留给下一次手工。**
  //   故补齐三种形态，并把此前既不在白名单、也不在规则里的「引擎锚定」一并纳入。
  [`论衡速查卡（v${OLD}）`, `论衡速查卡（v${NEW}）`],               // quick-facts 标题
  [`| 当前版本 | **v${OLD}** |`, `| 当前版本 | **v${NEW}** |`],     // quick-facts「当前版本」行
  [`| 引擎锚定（子技能 \`lunheng-commands\`） | **v${OLD}**`, `| 引擎锚定（子技能 \`lunheng-commands\`） | **v${NEW}**`], // 「引擎锚定」行
  // v18.97.0（E3 反哺发版实测）：`preflight.mjs` 的 `preflight: 'vX'` 是**当前版本戳**（进 JSON 输出，
  //   供主控反注派发话术），**不是历史注记**——但此前不在替换面内，于是 v18.96.0 → v18.97.0 发版后
  //   它仍输出旧版本号（**工具报「36 个随包脚本」，其中一个自报错版本**）。判据与本文件头注释同源：
  //   **门/工具知道某形态会漂、却不把它纳入自动同步 = 把已知缺口留给下一次手工**。
  [`preflight: 'v${OLD}'`, `preflight: 'v${NEW}'`],   // preflight.mjs 的版本戳
]

let patched = 0
// `--sync` 的替换面：**只动主包版本头**（形如 `> 版本：vX`），目标值一律取 package.json。
//
// ⚠️ 两条踩过的坑（v19.11.2 首版实测，已修）：
//   ① **不得碰子技能**：`skills/lunheng-commands/**` 的版本是**独立的 1.0.x**（规则㉖ 管它），
//      首版把它的 `> 版本：v1.0.3` 改成了主包版本 → 直接制造语义错误。
//   ② **不得用 `- 版本：vX｜` 那条形态**：它在速查表里指的是**子技能**版本；且首版把回调用成
//      `(_m, p1, p3)`（漏了 `p2`）→ 第三个实参是 offset 而不是捕获组 → 写坏了那一行。
//      现只保留 `>` 头形态，且回调参数与捕获组一一对应。
const SYNC_RE = /(>\s*版本：v)(\d+\.\d+\.\d+)/g
const inSubSkill = (p) => path.relative(ROOT, p).split(path.sep)[0] === 'skills'
  && path.relative(ROOT, p).split(path.sep)[1] === 'lunheng-commands'
for (const f of files) {
  let src
  try { src = fs.readFileSync(f, 'utf8') } catch { continue }
  const before = src
  const hits = []
  if (SYNC) {
    if (inSubSkill(f)) continue   // 子技能版本独立，绝不参与主包 sync
    const n = (src.match(SYNC_RE) || []).length
    if (n > 0) { hits.push(`版本头 ×${n}`); src = src.replace(SYNC_RE, (_m, p1) => `${p1}${PKG_VERSION}`) }
  } else {
    for (const [from, to] of RULES) {
      const n = src.split(from).length - 1
      if (n > 0) { hits.push(`${from} ×${n}`); src = src.split(from).join(to) }
    }
  }
  if (src !== before) {
    if (CHECK) {
      console.log(`[pending] ${path.relative(ROOT, f)}  <- ${hits.join(' | ')}`)
      patched++
    } else {
      fs.writeFileSync(f, src)
      patched++
      console.log(`[ok] ${path.relative(ROOT, f)}  <- ${hits.join(' | ')}`)
    }
  }
}
console.log(`\n${CHECK ? '待改' : '已改'} ${patched} 个文件（${SYNC ? `版本头 → ${PKG_VERSION}` : `${OLD} -> ${NEW}`}）`)
if (CHECK && patched > 0) {
  console.error('✗ --check：存在未 bump 的版本声明（未写盘）——请去掉 --check 重跑，或确认这些文件本就该保留旧版本')
  process.exit(1)
}
