#!/usr/bin/env node
// 论衡交接门（handoff-check）— 收报侧机械验收（v18.6.0 新增）
// 规格真源：docs/审计与修订记录/交接门-handoff-check-规格-v1.md
//
// 定位：把主控收报后的第一动作（产物落盘校验 + 回报齐备性）从手工 read/ls 变成一次只读调用。
//   是「派发前 preflight 反注」（v18.5.1，pipeline-readme.md §共享读取纪律）的**收报侧对偶**：
//   preflight 下发契约，本门验收契约。
//
// 用法：
//   node scripts/handoff-check.mjs --project run/<项目> --role T1
//   node scripts/handoff-check.mjs --project run/<项目> --role T5 --report-file <回报.md>
//   node scripts/handoff-check.mjs --project run/<项目> --role T7 --summary --level strict
//
// 退出码（与 M 门 1/2/3 **刻意分离**，防「exit 10 被读成 P1」类撞码——见 exit-guard 头注释）：
//   0  = 交接合格 / 20 = 产物缺失或 0 字节 / 21 = 结构·版本·成对·回报段不合 / 22 = 仅软提示
//   10 = 参数或路径错误 / 70 = 内部错误（EX_SOFTWARE）
//   ⚠️ **档位不对称（v18.78.2 · 全量审计-v18.78.1 P3 补注，实测照抄不美化）**：
//     `ROLE_TO_ARTIFACTS['T8']` **为空**（T8 是主控亲执行的角色，本就无收报）→ 对 T8 跑本门
//     **恒得 exit 22**（`total = 0` + 一条 A0 软提示，`hard` 为空）。即：**20/21 两档对 T8 不可达**，
//     只有加 `--require-gates`（或 T7 的 `--level strict`）才可能触及硬档。
//     这是刻意保留的语义（不是缺陷：不存在的收报不该被判硬失败），但头注释此前未标该不对称，
//     读代码的人会以为 T8 也有 20/21 两档。A0 文案已在结果里如实说明同一件事。
//
// 真源派生（禁止新建第二份清单）：
//   · 角色 → 必需产物：从 cc-rules/content-rules.mjs 的 CONTRACTS 反查（族名 → 产出者卡 → 角色）
//   · 磁盘路径：mgate-helpers.mjs 的 CARD_SPECS（卡片类）+ 本文件 PATH_SPECS（非卡片类）
//   · 回报六要素段名：交接报告六要素（做了什么/产物在哪/怎么验证/已知问题/下一步/状态机更新）+ AI 使用披露
//
// 只读：不联网、不写盘、不 spawn 子进程。stdout 只有 JSON（--summary 时 artifacts 只留失败项）。
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { createHash } from 'node:crypto'   // v18.13.0（L-06）：A4c 复算最新正文 sha256，与 M 门审定对象比对
import { installExitGuard, requireExistingDir } from './_lib/exit-guard.mjs'
import { loadSessions, pairAskUserQuestion, collectTouched } from './_lib/session-log.mjs'   // v18.81.0（批 1.4）：会话日志独立核对
import { parseLedger, ROUND_CAPS, LEDGER_REL } from './_lib/round-ledger.mjs'   // v18.81.0（批 2.1）：轮次额度真源
import { BLIND_FORBIDDEN } from './_lib/blind-forbidden.mjs'   // v18.80.4（QLT-6 脚手架批）：盲评禁忌面**单一真源**
import { CONTRACTS } from './_lib/cc-rules/content-rules.mjs'
import { CARD_SPECS, latestReport, indexSection, entryIds, idsByToken } from './_lib/mgate-helpers.mjs'

installExitGuard()   // 必须在任何 readFileSync 之前（fs 异常 → 10，其余 → 70）

const HELP = [
  '用法：node scripts/handoff-check.mjs --project <项目目录> --role <Tn> [--report <文本> | --report-file <路径>] [--summary] [--level basic|strict] [--require-gates]',
  '  --project   项目目录（如 run/<项目名>）',
  '  --role      被验收角色（T1..T9 / G14；必填，禁止从 agents-log 猜）',
  '  --report    回报原文（给了才做回报侧 B 组校验；- 表示从 stdin 读）',
  '  --report-file 回报文件路径（与 --report 二选一，--report 优先）',
  '  --summary   只回聚合 + 硬失败项（省 token；hard/soft 永不省略）',
  '  --level     basic（默认：A0/A1/A2）/ strict（另加 A3/A4/A4b/A4c/A5/A6/A8；其中 A4b/A4c/A5/A8 仅 T7）',
  '              ⚠️ **回报侧 B1–B4 不随 level 变**（v18.43.0 更正：旧文案写「strict = 全量 A1-A6 + B1-B5」，',
  '                 而**本脚本没有 B5**，且 A7 也不由 level 触发——两处均为陈旧断言，已按代码实测改正）。',
  '  --require-gates  加验**人在环四门**（阶段确认-Phase0/2.5/3.5/5.md 四份齐备 + §6 主人回复段五项字段已回填）——**A7 只在此旗标下判**。',
  '                   主人在 2026-09-25 定案「四门必须」→ 主控在 **Phase 5 交付前**调用本旗标做机械校验；',
  '                   不加此旗标则不判四门（向后兼容 T1-T4/T6/T9 等中期角色的收报，那时后几门本就还没开）。',
  '  --session-log <文件|目录|会话 id>  v18.81.0（批 1.4）：读 **DSH 会话日志**做 A7 的**独立核对**——',
  '                   回执账本由主控写入（自述），而会话日志由**宿主**写入（主控改不了）：本旗标核对',
  '                   「账本每条回执的 `callId` 在日志里确有 `ask_user_question` 调用，且其答复逐字等于 `rawAnswer`」。',
  '                   开启后账本的 `callId` 字段**必填**；不开启则不判（默认关，避免依赖宿主日志形态）。',
  '  --session-root <目录>  配合 --session-log 传「会话 id」时用（默认 $DSH_HOME/sessions）。',
  '  --blind-review <盲评件.md>  v18.81.0（批 1.4）：只判**盲评件契约**并退出（不要求 --project/--role）——',
  '                   六维名逐字 + 每维 x/5 + 总评分 = 六维之和 + 首节「已读范围」非空 + 禁忌面（自述层）；',
  '                   再给 --session-log 时另判**独立越界层**：会话日志里**真的读过**禁忌面即硬失败。',
  '报告编号命名契约（v18.62.7 A7 —— 别再靠读源码猜）：',
  '  · 审计族（审计报告 / 复核报告 / 反哺报告）的 N = **审计轮次**；复核必须与它复核的那轮审计同号。',
  '  · 审稿报告 / G14-检测报告 的 N = **正文轮次**（= drafts/初稿-vN.md 的 N）。',
  '退出码：0 合格 / 20 产物缺失或 0 字节 / 21 结构·版本·成对·回报段不合 / 22 仅软提示 / 10 参数路径错 / 70 内部错误',
].join('\n')

// ── 真源派生：角色 → 必需产物（从 CONTRACTS 反查） ─────────────────────────────
const CARD_TO_ROLE = {
  '01-文献检索-literature-scout.md': 'T1',
  '02-数据检索-data-scout.md': 'T2',
  '03-案例检索-case-scout.md': 'T3',
  '04-分析-analyst.md': 'T4',
  '05-写作-writer.md': 'T5',
  '06-批判-critical-companion.md': 'T6',
  '07-审计-auditor.md': 'T7',
  '09-审稿-peer-reviewer.md': 'T9',
  'checkers/中文AI痕迹-checker.md': 'G14',
}
// 修订轮才有的产物（缺失判软提示 22，不判 20）
const CONDITIONAL = new Set(['修订说明', '复核报告'])
// 版本号独立于**正文轮次**的报告族（其 `N` 另有定义，不参与 A4 与正文对齐）
//   · v18.13.0（L-06，主人 2026-09-25 定案）：`审计报告` 的 N = **T7 审计轮次**，`复核报告` 的 N = 同一轮
//     —— 与 `初稿-vN` 的正文轮次**刻意解耦**。旧版把两者硬对齐（`报告版本 vN ≠ 被审正文 vN（禁 v{N-1}）`），
//     与主人定案冲突，且与实测账本不符：22 个真实项目里 `审计报告-vN` 的 N **无一例外等于该项目的审计轮次**
//     （`共锁` 审计 4 份而初稿只到 v4 且缺 v3；`guannian-yu-linian` 审计 1 份而初稿 3 份）——
//     旧口径在这两种形态上都会误报。
//   · 「审的是哪一版正文」不再靠**编号**表达，改由**可机读的审定对象**表达：M 门报告的
//     `verdict_scope.draft_name` + `draft_sha256`（A4c 校验）+ 审计报告头部 `被审正文：` 声明。
const VERSION_INDEPENDENT = new Set(['反哺报告', '审计报告', '复核报告'])
// 非磁盘文件产物（§11 写手版精简段是分析大纲的一节，不是文件）
const NON_FILE = new Set(['写手版精简段'])
const VALID_ROLES = new Set(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'G14'])

const ROLE_TO_ARTIFACTS = {}
for (const [artifact, producer] of CONTRACTS) {
  const role = CARD_TO_ROLE[producer]
  if (!role || NON_FILE.has(artifact)) continue
  ;(ROLE_TO_ARTIFACTS[role] ||= []).push(artifact)
}

// ── 路径解析（卡片类走 CARD_SPECS；非卡片类走本表，与 build-evidence-bundle 同口径） ──
const PATH_SPECS = {
  '分析大纲.md': { dir: 'analysis', fixed: '分析大纲.md' },
  '素材加载清单': { dir: 'analysis', fixed: '素材加载清单.md' },
  '初稿-v': { dir: 'drafts', versioned: '初稿' },
  '修订说明': { dir: 'drafts', versioned: '修订说明' },
  '批判报告': { dir: 'analysis', versioned: '批判报告' },
  '审计报告': { dir: 'audits', versioned: '审计报告' },
  '复核报告': { dir: 'audits', versioned: '复核报告' },
  '反哺报告': { dir: 'audits', versioned: '反哺报告' },
  '审稿报告': { dir: 'audits', versioned: '审稿报告' },
  'G14-检测报告': { dir: 'audits', versioned: 'G14-检测报告' },
}
const CARD_PATH = new Map(CARD_SPECS.map(([name, rel]) => [name, rel]))

function resolveArtifact(project, artifact) {
  if (CARD_PATH.has(artifact)) {
    return { name: artifact, path: join(project, CARD_PATH.get(artifact)), version: null, versioned: false, isCard: true }
  }
  const spec = PATH_SPECS[artifact]
  if (!spec) return { name: artifact, path: null, version: null, versioned: false, isCard: false }
  if (spec.versioned) {
    const r = latestReport(join(project, spec.dir), spec.versioned)
    return { name: artifact, path: r ? r.path : null, version: r ? r.n : null, versioned: true, isCard: false }
  }
  return { name: artifact, path: join(project, spec.dir, spec.fixed), version: null, versioned: false, isCard: false }
}

const bytesOf = (p) => { try { return statSync(p).size } catch { return null } }
const headCount = (text) => (text.match(/^#{2,4}\s/mg) || []).length

// 卡片条目数：[LDC] 编号（文献/数据/案例卡）+ [先NN]（先行者清单）
function cardEntries(text) {
  const ldc = entryIds(text).size
  const xian = idsByToken(text, '先\\d+').size
  return ldc + xian
}

// ── 参数解析 ───────────────────────────────────────────────────────────────
// v18.12.0（全量审计 L-62）：**带值旗标缺值守卫**。旧版 5 个带值旗标一律 `args[++i]` —— 缺值时变
//   undefined，**下一个旗标会被当成它的值**（实测 `handoff-check --report --summary` → `opt.report="--summary"`
//   且 `--summary` 被吃掉 → 产物侧整段静默跳过，exit 0）。现与 `_lib/cli-args.mjs` 同口径：缺值 → exit 10。
const args = process.argv.slice(2)
const opt = { project: null, role: null, report: null, reportFile: null, summary: false, level: 'basic', requireGates: false, help: false }
const needValue = (name, i) => {
  const v = args[i + 1]
  // v18.16.0（A-5 反哺）：原 `!v || v.startsWith('-')` 把单字符 `-`（stdin 哨兵）也拒了 → `--report -` 走不到 stdin 分支。
  //   现仅当值以 `-` 开头**且不是单独的 `-`** 时才报缺值。
  if (!v || (v.startsWith('-') && v !== '-')) {
    console.error(`${name} 缺少值（${name} 后必须紧跟一个值，` + (name === '--report' ? '用 `-` 表示从 stdin 读取' : '') + `）\n${HELP}`)
    process.exit(10)
  }
  return v
}
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '-h' || a === '--help') opt.help = true
  else if (a === '--project') opt.project = needValue('--project', i++)
  else if (a === '--role') opt.role = needValue('--role', i++)
  else if (a === '--report') opt.report = needValue('--report', i++)
  else if (a === '--report-file') opt.reportFile = needValue('--report-file', i++)
  else if (a === '--summary') opt.summary = true
  else if (a === '--require-gates') opt.requireGates = true
else if (a === '--session-log') opt.sessionLog = needValue('--session-log', i++)
else if (a === '--session-root') opt.sessionRoot = needValue('--session-root', i++)
else if (a === '--blind-review') opt.blindReview = needValue('--blind-review', i++)
  else if (a === '--level') opt.level = needValue('--level', i++)
  else { console.error(`未知参数: ${a}\n${HELP}`); process.exit(10) }
}
if (opt.help) { console.log(HELP); process.exit(0) }
if (!opt.blindReview && !opt.project) { console.error('缺 --project（项目目录）\n' + HELP); process.exit(10) }
if (!opt.blindReview && !opt.role) { console.error('缺 --role（被验收角色）\n' + HELP); process.exit(10) }
if (opt.role && !VALID_ROLES.has(opt.role)) { console.error(`--role 非法: ${opt.role}（须 ∈ ${[...VALID_ROLES].join('/')}）`); process.exit(10) }
if (!['basic', 'strict'].includes(opt.level)) { console.error(`--level 非法: ${opt.level}（须 basic|strict）`); process.exit(10) }

const project = opt.project ? requireExistingDir(opt.project, '项目目录') : null
const role = opt.role
const level = opt.level
const strict = level === 'strict'

// v18.70.0（批 7 · BOM 口径统一）：剥 UTF-8 BOM（与 count-chars/md2html 同口径）。本脚本是**结构校验器**
//   （回报/产物按 `##`/`###` 匹配），BOM 只影响首行 h1，故**静默剥离不警告**（警告纯属噪音）；不改退出码。
const readText = (p) => { const t = readFileSync(p, 'utf8'); return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t }

// ── v18.81.0（批 1.4）：**会话日志独立核对**（只在显式给 `--session-log` 时启用）──────────────
// 为什么默认关：会话日志的**路径与事件形态属宿主契约**（实测本机为
//   `$DSH_HOME/sessions/<workspace>/<id>/session.v4.jsonl.zstd`）。把它设成默认依赖，会让本门在
//   别的宿主版本/部署形态下**假红**——那比不判更坏。故：**显式开启、开启即严格**。
// 判据（这一层是**真的独立**，不是又一层自述）：账本由主控写，会话日志由**宿主**写。
const sessionIndex = (() => {
  if (!opt.sessionLog) return null
  const target = opt.sessionLog
  if (!existsSync(target) && !opt.sessionRoot) {
    console.error(`--session-log 目标不存在: ${target}（传会话 id 时请一并给 --session-root）`)
    process.exit(10)
  }
  const loaded = loadSessions(target, { sessionRoot: opt.sessionRoot || null })
  if (loaded.files.length === 0) {
    console.error(`--session-log 未匹配到任何会话文件: ${target}`)
    process.exit(10)
  }
  const { pairs, callOnly } = pairAskUserQuestion(loaded.events)
  return { ...loaded, pairs, callOnly }
})()

// ── v18.81.0（批 1.4）：**盲评件契约**模式——独立出口，不进入 A 组（它审的是一个产物，不是一个项目）
// v18.80.4（QLT-6 脚手架批）：禁忌面词表**外提为共享模块** `_lib/blind-forbidden.mjs`——载荷打包器
//   （`scripts/blind-review-pack.mjs`）需要同一份，两处副本必然漂。语义真源仍是 09 卡 §🕶 的「不给」清单。
if (opt.blindReview) {
  const r = runBlindReview(opt.blindReview, sessionIndex ? { events: sessionIndex.events, collectTouched } : null)
  const exit = r.hard.some((h) => h.exitClass === 20) ? 20 : (r.hard.length ? 21 : (r.soft.length ? 22 : 0))
  console.log(JSON.stringify({
    mode: 'blind-review',
    artifact: opt.blindReview,
    exit,
    hardCount: r.hard.length,
    softCount: r.soft.length,
    hard: r.hard.map(({ exitClass, ...rest }) => rest),
    soft: r.soft,
    ...(r.notes.length ? { notes: r.notes } : {}),
    countingNote: '本模式只判**盲评件契约**（六维逐字 + 总评分=和 + 已读范围 + 禁忌面自述层），'
      + '给了 --session-log 时另判**独立越界层**（宿主日志，主控改不了）。退出码与 A 组共用：20/21/22/0。',
    checkedAt: new Date().toISOString(),
  }, null, 2))
  console.error(`盲评件契约：${opt.blindReview}｜exit ${exit}（硬 ${r.hard.length} / 软 ${r.soft.length}）`)
  process.exit(exit)
}

// ── v18.81.0（批 1.4）：**盲评件契约**模式（`--blind-review <路径>`）────────────────────────
// 定位：把 T9 盲评的产物契约（`09-审稿-peer-reviewer.md` §🕶 盲评模式）变成机械判据。
//   与 A 组共用退出码语义：20 产物缺失 / 21 结构不合 / 22 仅软提示。
// 为什么放在本脚本而不是新脚本：① 「已读范围不得含禁忌面」的**独立核对**要用
//   `_lib/session-log.mjs` 的 `collectTouched`（本脚本已 import）；② 新入口要连带改
//   `SKILL.md` 白名单行 + 计数 + 对照用例，而本批的原则是**先减字再加规则**。
// 禁忌面真源 = 09 卡 §🕶 盲评模式的「不给」清单（此处按**文件名词**匹配；改卡须同批改这里）。
// ⚠️ 它必须声明在**调用点之前**：`const` 与函数声明不同，**不提升**——首版把它放在
//   `runBlindReview` 定义旁（晚于调用点），运行时直接 TDZ 崩溃（`Cannot access 'BLIND_FORBIDDEN'
//   before initialization`，被 exit-guard 映射为 70）。实测由 `--blind-review` 探针当场抓出。

/** 用同一套 hard/soft 结构跑盲评件契约，返回退出码（不写盘）。 */
function runBlindReview(blindPath, session) {
  const hard = [], soft = [], notes = []
  if (!existsSync(blindPath)) { hard.push({ check: 'BR-A1', subject: blindPath, severity: 'hard', detail: '盲评件不存在（产物缺失）', exitClass: 20 }); return { hard, soft, notes } }
  let text = ''
  try { text = readText(blindPath) } catch { hard.push({ check: 'BR-A1', subject: blindPath, severity: 'hard', detail: '盲评件不可读', exitClass: 20 }); return { hard, soft, notes } }
  if (!text.trim()) { hard.push({ check: 'BR-A1', subject: blindPath, severity: 'hard', detail: '盲评件 0 字节', exitClass: 20 }); return { hard, soft, notes } }

  // ① 六维名逐字 + 每维 x/5（名字真源 = 09 卡，机检契约不得改写）
  const DIMS = ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范']
  const scores = []
  for (const d of DIMS) {
    const m = new RegExp(`${d}\\s*[（(]\\s*([1-5])\\s*/\\s*5\\s*[)）]`).exec(text)
    if (!m) { hard.push({ check: 'BR-A2', subject: d, severity: 'hard', detail: `缺「${d}（x/5）」——六维名是机检契约，逐字不得改写，且每维都要写出 x/5`, exitClass: 21 }) }
    else scores.push(Number(m[1]))
  }
  // ② 总评分 = 六维之和（逐项写出算式）
  const total = /总评分[^\n]*?(\d{1,2})\s*\/\s*30/.exec(text)
  if (!total) {
    hard.push({ check: 'BR-A3', subject: '总评分', severity: 'hard', detail: '缺 `总评分 XX/30`（盲评件与审稿报告共用该契约）', exitClass: 21 })
  } else if (scores.length === 6) {
    const sum = scores.reduce((a, b) => a + b, 0)
    if (Number(total[1]) !== sum) {
      hard.push({ check: 'BR-A3', subject: '总评分', severity: 'hard', detail: `总评分 ${total[1]} ≠ 六维之和 ${sum}（逐项写算式：${scores.join('+')} = ${sum}）`, exitClass: 21 })
    }
  }
  // ③ 「已读范围」为首节且非空
  const mRead = /^##\s*已读范围/m.exec(text)
  if (!mRead) {
    hard.push({ check: 'BR-A4', subject: '已读范围', severity: 'hard', detail: '缺首节「## 已读范围」——盲评的**全部效力**建立在「读的是什么」可核对之上', exitClass: 21 })
  } else {
    const after = text.slice(mRead.index + mRead[0].length)
    const nextH2 = after.search(/^##\s/m)
    const body = (nextH2 === -1 ? after : after.slice(0, nextH2)).trim()
    if (!body) hard.push({ check: 'BR-A4', subject: '已读范围', severity: 'hard', detail: '「已读范围」为空——空节会被读成「已核对过」', exitClass: 21 })
    // ④ 禁忌面（本轮**自述**层）
    const hit = BLIND_FORBIDDEN.filter((k) => body.includes(k))
    if (hit.length) {
      hard.push({ check: 'BR-A5', subject: '已读范围', severity: 'hard', detail: `已读范围含**禁忌面**：${hit.join(' / ')}——盲评载荷不得含生产中间产物（09 卡 §🕶 的「不给」清单）`, exitClass: 21 })
    }
    if (!/匿名/.test(text)) soft.push({ check: 'BR-A6', subject: '匿名声明', severity: 'soft', detail: '未见「匿名送审稿 / 未接触生产中间产物」类声明' })
  }
  // ⑤ 独立核对（给了 `--session-log` 才做）：会话真正碰过的路径 vs 禁忌面
  if (session) {
    const { collectTouched } = session
    const touched = collectTouched(session.events)
    const bad = touched.filter((t) => BLIND_FORBIDDEN.some((k) => String(t.value).includes(k)))
    if (bad.length) {
      hard.push({
        check: 'BR-B1', subject: '会话越界', severity: 'hard', exitClass: 21,
        detail: `会话日志显示该次评审**真的读过禁忌面**（${bad.length} 处，宿主记录、主控改不了）：`
          + bad.slice(0, 4).map((t) => `${t.tool}→${t.value}`).join('；') + `${bad.length > 4 ? ' …' : ''}`,
      })
    } else {
      notes.push(`盲评独立核对：会话共 ${touched.length} 次带路径的调用，未命中禁忌面（宿主日志，非自述）。`)
    }
  }
  return { hard, soft, notes }
}

let reportText = null
if (opt.report === '-') reportText = readFileSync(0, 'utf8')          // stdin
else if (opt.report != null) reportText = opt.report
else if (opt.reportFile) {
  try { reportText = readText(opt.reportFile) }
  catch { console.error(`回报文件不存在或不可读: ${opt.reportFile}`); process.exit(10) }
}

// ── A 组：产物侧 ───────────────────────────────────────────────────────────
const hard = []
const soft = []
// v18.81.0（独立审计批 1.1）：**信息通道**——与 hard/soft 分开，专门承载「可见但本轮不判」的观测。
//   为什么需要第三条通道：把「无回执账本」记作 soft 会让 exit 0 → 22，从而把**门齐备且记录完整**的
//   最好项目在 `quality-score` 的 handoff 分量上从 1 压到 0.5（该分量把 22 映射为 0.5）——
//   那是对合规项目的反向惩罚（与 A6「记录越勤越扣分」同型）。判据：**新观测在拿到存量迁移方案之前，
//   只能可见，不能改判定。**
const notes = []
const artifacts = []
const addHard = (check, subject, detail, exitClass) => hard.push({ check, subject, severity: 'hard', detail, exitClass })
const addSoft = (check, subject, detail) => soft.push({ check, subject, severity: 'soft', detail })

const required = ROLE_TO_ARTIFACTS[role] || []
if (required.length === 0) {
  addSoft('A0', role, `${role} 无收报必需产物清单（T0/T8 为主控亲执行或主人侧，一般不做交接验收）`)
}

// 被审正文最新版本（A4 版本对齐用）
const latestDraft = latestReport(join(project, 'drafts'), '初稿')

// ── v18.62.7（反哺-主控实测-2026-10-02 §A6）：**复核义务的判据（与 `mexist-gates.mjs` 的 M-Exist-4 同源）**
//   病灶：`复核报告` 被登记为「修订轮产物 → 首轮可缺」（本文件 A1 的软档），而 M-Exist-4 对
//   「有修订说明、无复核报告」判**硬** —— 两门口径相反。实测后果：T7 首审**必然**被 M-Exist-4 要求交
//   一份当时不可能存在的复核报告，只能补交「内容全为『未复核』」的形式产物，再由同号覆盖 + 归档。
//   判据（两门共用）：**只有当「本轮审计之后真的发生过修订」时，复核才算逾期** ——
//   `修订说明-vN` 的 N > 审计报告 `被审正文：drafts/初稿-vN.md` 的 N。
//   ⚠️ 与 M-Exist-4 **刻意不对称**（如实登记）：M-Exist-4 在「缺 `被审正文：` 声明」时**保守判硬**
//     （它是 T8 前的项目终局门，而 A4c 本就要求那一行，故那里不产生新的翻红）；而本门是**单次派发**
//     的产物存在性检查，且 **basic 档也跑 A1**——若对未声明的存量形态一律判硬，会给一批本来只报
//     软提示的历史项目**新增 20 号红**。故此处只在**可证**（声明在盘且 `修订说明-vN` 的 N > 被审 N）
//     时升硬；声明缺失时维持「首轮可缺」的软档（不放过由 M-Exist-4 兜）。
const reviewOverdue = (() => {
  if (role !== 'T7') return false
  const ap = resolveArtifact(project, '审计报告')
  if (!ap.path || !existsSync(ap.path)) return false
  let t = ''
  try { t = readText(ap.path) } catch { return false }
  const decl = /\*{0,2}被审正文\*{0,2}\s*[：:]\s*`?([^\s`|，。]+\.md)/.exec(t)
  if (!decl) return false
  const rel = decl[1].replaceAll('\\', '/')
  const m = /初稿-v(\d+)\.md$/.exec(rel)
  if (!m) return false
  const auditedN = Number(m[1])
  const draftsDir = join(project, 'drafts')
  if (!existsSync(draftsDir)) return false
  const noteNs = readdirSync(draftsDir)
    .map((f) => Number((f.match(/^修订说明-v(\d+)\.md$/) || [])[1]))
    .filter((n) => Number.isInteger(n))
  return noteNs.length > 0 && Math.max(...noteNs) > auditedN
})()

for (const artifact of required) {
  const art = resolveArtifact(project, artifact)
  const isCond = CONDITIONAL.has(artifact)
  const exists = art.path != null && existsSync(art.path)
  const bytes = exists ? bytesOf(art.path) : null
  artifacts.push({ name: artifact, path: art.path, exists, bytes, version: art.version })

  if (!exists) {
    if (isCond) {
      // v18.62.7（A6/A7 配套）：`复核报告` 的「首轮可缺」**只在修订尚未发生时成立**——与 M-Exist-4 同判据。
      //   两门若各说各话，就会重演「T7 被迫补交形式产物」那一次（实测 A6）。
      if (artifact === '复核报告' && reviewOverdue) {
        const ap = resolveArtifact(project, '审计报告')
        addHard('A1', artifact, `**修订已发生**但缺复核报告——必须落盘 \`audits/复核报告-v${ap.version ?? 'N'}.md\`（N = 审计轮次；与 M-Exist-4 同判据，v18.62.7 A6）`, 20)
      } else {
        addSoft('A1', artifact, `修订轮产物「${artifact}」不存在（**本轮修订尚未发生 → 首轮可缺**，缺了不判 20）`)
      }
    } else addHard('A1', artifact, `产物不存在（族名 ${artifact} → 解析路径 ${art.path}）`, 20)
    continue
  }
  if (bytes === 0) {
    addHard('A2', artifact, `产物 0 字节（写盘前失败）: ${art.path}`, 20)
    continue
  }
  if (!strict) continue

  // A3 结构（strict）
  let text = ''
  try { text = readText(art.path) } catch { addHard('A3', artifact, `产物不可读: ${art.path}`, 21); continue }
  if (art.isCard) {
    const entries = cardEntries(text)
    const hasIndex = indexSection(text.split('\n')) != null
    if (entries === 0) addHard('A3', artifact, `卡片无条目（[LDC]/[先] 编号 0 条）: ${art.path}`, 21)
    else if (!hasIndex) addSoft('A3', artifact, `卡片缺「## 📇 索引段」（有 ${entries} 条但无索引）`)
    // ── v18.78.0（反哺 F4/F21）**核实后不落地**，如实登记在此（防下一位维护者重复提案）──────────────
    //   反哺报告 F4 主张「T3 案例卡 markdown 原文 URL 字段几乎全空」，据此要在本门加「C 类 URL 必填校验」。
    //   现场核实结果（产物实据，逐条复算，命令见 `审计/核实` 记录）：**该主张与产物相反**——
    //   `run/cn-llm-inference-cost-econ/cases/案例卡.md` 8 条案例（C01–C08）**每条都含 URL**，
    //   且每条「2. **独立来源**」行内都带 `http(s)://`（逐条 URL 数：2/1/1/1/2/3/2/1）；
    //   同判据下 `sources/{T1,T2,T3}.jsonl` 的 30/42/8 行**亦全部有 url**。
    //   该实例真正的问题在**另一处**（且已被现有门抓住）：卡片条目写成 `## C01 …` 而非规范形态
    //   `### [C01] …` → `entryIds` 命中 0 条 → A3 判「卡片无条目」。
    //   判据：**没有失败证据的门不加**——新增门若只为「听起来更严」，付出的是**全量项目的误报面**
    //   （离线来源：判决书 / 纸质档案 / 内部文件本就没有 URL，硬判会把合规稿判红）。
  } else {
    const h = headCount(text)
    if (h === 0) addHard('A3', artifact, `非卡片产物无任何二级标题（结构可疑）: ${art.path}`, 21)
  }

  // A4 版本对齐（strict；仅版本化报告类；正文轮次无关的报告族豁免——见 VERSION_INDEPENDENT）
  if (art.versioned && art.version != null && latestDraft && art.version !== latestDraft.n && !VERSION_INDEPENDENT.has(artifact)) {
    addHard('A4', artifact, `报告版本 v${art.version} ≠ 被审正文 v${latestDraft.n}（禁 v{N-1}）`, 21)
  }
}

// ── A4b 审计↔复核**同轮配对**（strict；v18.12.2 L-06）────────────────────────────
// 判据：`audits/审计报告-vN.md` 与 `audits/复核报告-vM.md` 必须 **N === M**。
//   为什么需要它：把审计报告的 N 重新定义为「审计轮次」之后，「报告 ↔ 报告」的配对不能再靠正文编号
//   隐式保证（旧口径下审计-v3 必有初稿-v3 作锚）。同轮配对是**审计轮次**这条时间线的自洽条件：
//   第 N 轮审计与它的复核是同一次审计动作的两半，错轮即「复核了上一轮」或「审计了没复核的稿」。
//   时点：只有被审角色是 T7（或收全项目时显式要求）才判——T1-T6/T9 收报时复核报告本就还没产出。
if (strict && role === 'T7') {
  const audit = artifacts.find((a) => a.name === '审计报告')
  const review = artifacts.find((a) => a.name === '复核报告')
  if (audit && review && audit.exists && review.exists && audit.version != null && review.version != null) {
    if (audit.version !== review.version) {
      // v18.73.0（反哺报告-v7 F-4）：**接受「同一审计轮次的第 k 次独立复核」** ——
      //   旧判据 `audit.version !== review.version` 隐含假定「**一个审计轮次只做一次复核**」。
      //   实测（《不能评估的忠诚》）：对**同一个 `审计报告-v1`** 做了**三次**独立复核
      //   （A 轨修订后一次、B 轨第 1 轮后一次、B 轨末轮后一次）→ `latestReport` 取到 `复核报告-v3.md`
      //   → 与 `审计报告-v1` 不同号 → **A4b 恒判 hard**，且**无合法出口**：改名则三次复核重名，
      //   不改名则硬失败。本项目只能「遵从语义正确的文件名 + 如实登记冲突」绕过。
      //   修法：**保住本项的原意**（「复核了上一轮」/「审计了没复核的稿」必须仍被抓），
      //   判据由「最新那份复核的编号必须相等」改为「**该审计轮次是否已被复核过**」：
      //     · 磁盘上存在 `audits/复核报告-v{audit.version}.md` → 该轮**已被复核**
      //       · 且 review.version > audit.version（后续独立复核）→ 软提示（留痕，不判 hard）
      //       · 且 review.version < audit.version（复核的轮次**早于**审计）→ 仍判 hard（真错轮）
      //     · 磁盘上**不存在**同轮复核报告 → 仍判 hard（「审计了没复核的稿」）
      const sameRoundPath = join(project, 'audits', `复核报告-v${audit.version}.md`)
      const reviewedThisRound = existsSync(sameRoundPath)
      const isLaterReview = review.version > audit.version
      if (reviewedThisRound && isLaterReview) {
        addSoft('A4b', 'T7 审计↔复核', `审计报告 v${audit.version} 已有同轮复核（\`复核报告-v${audit.version}.md\` 在盘）；`
          + `当前最新复核为 v${review.version}，属对**同一审计轮次**的第 k 次独立复核——**合规**（v18.73.0 F-4）。`
          + '命名契约一句话 = **审计族（审计报告 / 复核报告 / 反哺报告）跟审计轮次；审稿报告 / G14-检测报告跟正文轮次**（v18.62.7 A7）。')
      } else {
        addHard('A4b', 'T7 审计↔复核', `审计报告 v${audit.version} 与复核报告 v${review.version} **不同轮**——复核必须与它复核的那一轮审计同号（N = 审计轮次）。`
          + (reviewedThisRound
            ? `**当前问题**：最新复核（v${review.version}）**早于**审计报告（v${audit.version}），即「复核了上一轮」。`
            : `**当前问题**：磁盘上**没有** \`audits/复核报告-v${audit.version}.md\`，即该审计轮次**尚未复核**。`)
          + `**可执行指引**：把该文件改名为 \`audits/复核报告-v${audit.version}.md\`（现为 \`复核报告-v${review.version}.md\`）；`
          + '命名契约一句话 = **审计族（审计报告 / 复核报告 / 反哺报告）跟审计轮次；审稿报告 / G14-检测报告跟正文轮次**（v18.62.7 A7）', 21)
      }
    }
  }
}

// ── A8 复核报告「已读范围」声明（strict；v18.22.3 EFF-3）──────────────────────
// 判据：被审角色 = T7 且 `audits/复核报告-vN.md` 在盘（= 修订轮）时，该报告必须**显式声明已读范围**
//   （读了哪些载体：`drafts/修订说明-vN.md` / 段级 diff 清单 / 被审正文的哪几节）。认两种形态：
//   ① 标题行 `## 已读范围` / `### 已读范围`（可带后缀）；② 加粗标签行 `- **已读范围**：…`。
// 为什么需要（v18.22.0 报告 §三.3 EFF-3）：现有文本只对**写手**要求「段级 diff」，对**复核**只写
//   「逐条对照确认 P0/P1 是否关闭」——没有「复核只读 diff」的约束，于是复核可能**重读全稿**。
//   把「已读范围」写成必填声明后：① 复核者必须交代读了什么；② 主控在 T7.5 闸门可机械核对；
//   ③ 「**没读的不算已核**」第一次变成可判定的句子（此前只是一句无从核对的纪律）。
//
// ⚠️ **分档现状（v18.22.3 先软 → v18.33.0 半收 → v18.39.0 全部转硬）**：
//   · **「有节但空」→ 硬**（v18.33.0）：实测存量复核类报告 **0/6** 落此档 → 收紧零牵连。
//   · **「完全缺节」→ 硬**（**v18.39.0 主人裁定「A8」**）。沿革与代价如实：v18.22.3 判软
//     （存量 6 份全落此档），v18.33.0 把触发条件写死（首次经 `templates/复核报告-template.md` 产出的
//     报告通过本门后改硬）并**补了那个模板让条件可达**；本批主人直接裁定**不等那个事件**——
//     即 `run/**` 下 6 份历史项目重跑本门会红，**主人知情并接受**。
//     判据（为什么可覆盖「不对历史形态过度收紧」）：该节自 **v18.22.3** 起就是规范要求
//     （`07-审计-auditor.md`「报告**首节必须写「已读范围」**」+ `pipeline-readme.md` §6），
//     缺节 = **报告不合规**，不是「历史形态不同」；闭合动作极轻——**补一节**。
//     与 A4c ②（v18.36.0 同样由主人裁定转硬）**同一路径**：见 `maintainers.md` §九 的第三条收紧路径。
// 边界（如实）：① 本门只判「有没有这处声明 + 有没有内容」，**不判**声明是否诚实（那要人读）；
//   ② 产物名唯一口径 = `audits/复核报告-vN.md`——另两种历史命名（`审计复核-` / `复核记录-`）**本门看不到**，
//   故它们**既不会被判软、也不会被判硬**（口径由 07 卡与模板固定；不为历史命名扩面，以免连带触发 A4b 的轮次对账）。
//   ⚠️ 全收之后这条缺口更值得记住：**门看不见的东西，不会因为它不存在而变绿**。
if (strict && role === 'T7') {
  const review = artifacts.find((a) => a.name === '复核报告')
  if (review && review.exists) {
    let rtext = ''
    try { rtext = readFileSync(review.path, 'utf8') } catch { rtext = '' }
    const found = /(?:^#{2,4}\s*已读范围)|(?:^\s*[-*]?\s*\*\*已读范围\*\*)/m.exec(rtext)
    if (!found) {
      addHard('A8', '复核报告', '缺「已读范围」声明（须写明本轮读了哪些载体：`drafts/修订说明-vN.md` / 段级 diff 清单 / 被审正文哪几节）——v18.22.3 EFF-3：**没读的不算已核**。**按 `templates/复核报告-template.md` 产出即含本节**；存量报告补一节即可闭合（v18.39.0 起判硬）', 21)
    } else {
      const after = rtext.slice(found.index + found[0].length)
      const body = after.replace(/^\*\*[^\n]*\*\*/, '').split(/\n#{1,4}\s/)[0].replace(/[\s:*\-—（）()]/g, '')
      if (body.length < 4) {
        addHard('A8', '复核报告', '「已读范围」节为空——**只写标签不算声明**，须列出实际读过的载体（存量报告无一落此档，故本档收紧不牵连历史）', 21)
      }
    }
  }
}

// ── A4c 审定对象校验（strict；v18.12.2 L-06）───────────────────────────────────
// 判据（两条，**一硬一软，刻意分级**）：
//   ① 硬：**仅当 M 门报告自报的被审正文（`verdict_scope.draft_name`）就是最新正文**时，才要求 sha256 一致。
//      否则该报告审的是**别的合法对象**——最典型是 `final/定稿.md`（T8 终检阶段审的是定稿，不是草稿，
//      实测 `筛选竞赛的均衡` 的 M-Gate-Report 审 `final/定稿.md` 而 `drafts/` 最新是初稿-v4）。此时**放行**。
//      只在「自报对象 == 最新正文」这一条上做内容断言，才不会把「审的是定稿」误判成「改稿后没重跑」。
//   ② 硬（v18.12.2 判软 → v18.34.0 写死触发条件 → **v18.36.0 主人裁定转硬**）：审计报告头部须写
//      `被审正文：drafts/初稿-vN.md`（或 `final/定稿.md`），且**该文件须在盘**——两条分支都判硬（21）。
//      **沿革与代价（如实）**：v18.12.2 定案时判软，理由是「**22/22 个既有项目的审计报告都没有这个字段**，
//      判硬会让全部已交付项目一次性变红」；v18.34.0 复测结论不变（最晚一份报告写于规则落地之前），
//      当时处置 = **把触发条件写死**（首次经模板产出的报告通过本门后改硬）+ **补
//      `templates/审计报告-template.md`** 让条件可达。**v18.36.0 主人直接裁定转硬**（原话「4c ② 拦」），
//      **不等那个可观测事件**——即 `run/**` 下 22 份历史项目重跑本门会红，**主人知情并接受**。
//      **判据（为什么这次可以覆盖「不对历史形态过度收紧」）**：该字段自 **v18.12.2** 就是规范要求的，
//      缺声明 = **报告不合规**，不是「历史形态不同」；且修复动作极轻——**补一行声明即可闭合**。
//      新报告按 `templates/审计报告-template.md` 产出即天然满足。
//      **同批修一处格式假设**（v18.34.0）：原正则 `被审正文\s*[：:]` 要求冒号**紧跟**在词后，于是加粗写法
//      `**被审正文**：…` 匹配不上（新模板第一版就踩了）。现为 `\*{0,2}被审正文\*{0,2}`，
//      **与规则 ⑫ 在 v18.2.4 的修法同一形态**（当时是 `> **版本**：vX.Y.Z` 整条逃逸）。
//      这属于修「格式假设」而不是放宽判据：要核的是「有没有这一行、指的文件在不在盘」。
if (strict && role === 'T7') {
  const audit = artifacts.find((a) => a.name === '审计报告')
  if (audit && audit.exists && latestDraft) {
    // ① 硬：自报审定对象 == 最新正文 → 必须同 sha256
    //    报告位置与 M-Exist-5 的 repPath5 **同口径**（四处布局：final/ 现行、audits/ 旧、带版本后缀更旧）
    const mgate = [
      join(project, 'final', 'M-Gate-Report.json'),
      join(project, 'audits', 'M-Gate-Report.json'),
      join(project, 'final', '证据包', 'M-Gate-Report.json'),
    ].find((p) => existsSync(p))
    if (mgate) {
      let rj = null
      try { rj = JSON.parse(readFileSync(mgate, 'utf8')) } catch { addSoft('A4c', 'M-Gate-Report.json', `无法解析，未核审定对象：${mgate}`) }
      const sha = rj?.verdict_scope?.draft_sha256
      const claimed = String(rj?.verdict_scope?.draft_name || '')
      const claimedIsLatestDraft = claimed.endsWith(basename(latestDraft.path))
      if (typeof sha === 'string' && sha.length === 64 && claimedIsLatestDraft && latestDraft.path) {
        try {
          const cur = createHash('sha256').update(readFileSync(latestDraft.path)).digest('hex')
          if (cur !== sha) {
            addHard('A4c', 'M-Gate-Report 审定对象',
              `报告自报审的是 \`${claimed}\`（sha256 ${sha.slice(0, 12)}…），但该文件现为 ${cur.slice(0, 12)}…`
              + '——改稿后未重跑 M 门，旧裁定不再适用，请重跑 M 门并重写 T8 裁定段', 21)
          }
        } catch { /* 读不到当前正文：交由 A1/A2 报 */ }
      }
    }
    // ② 硬（**v18.36.0 按主人裁定转硬**）：头部「被审正文：」声明
    //   沿革如实：v18.12.2 定案时判软（存量 22/22 都无此字段，判硬会追溯否决历史交付）；
    //   v18.34.0 复测后把它拆成两半——**触发条件写死 + 补 `templates/审计报告-template.md`**（让条件可达）；
    //   v18.36.0 **主人裁定直接转硬**（原话「4c ② 拦」），**不等那个可观测事件**。
    //   **已知代价（有意，不是疏漏）**：`run/**` 下 **22 份历史项目**若重跑本门会变红——主人知情并接受；
    //   本仓「不对历史形态过度收紧」的原则在此被**显式覆盖**：判据是「审计报告必须交代审的是哪一版正文」，
    //   而这件事从 v18.12.2 起就是规范要求的（缺声明 = 报告不合规，不是「历史形态不同」）。
    //   新报告照 `templates/审计报告-template.md` 产出即天然满足。
    let txt = ''
    try { txt = readFileSync(audit.path, 'utf8') } catch { /* 上面 A3 已报不可读 */ }
    const decl = txt.match(/\*{0,2}被审正文\*{0,2}\s*[：:]\s*`?([^\s`|，。]+\.md)/)
    if (!decl) {
      addHard('A4c', '审计报告', '头部未写 `被审正文：drafts/初稿-vN.md`——N 跟审计轮次后，审定对象只能靠此声明 + M 门 `verdict_scope` 表达（v18.12.2 L-06）。**按 `templates/审计报告-template.md` 产出即含此行**；存量报告补一行声明即可闭合（v18.36.0 起判硬）', 21)
    } else {
      const rel = decl[1].replaceAll('\\', '/')
      const cand = [join(project, rel), join(project, 'drafts', rel), join(project, 'final', rel)]
      if (!cand.some((p) => existsSync(p))) {
        addHard('A4c', '审计报告', `「被审正文：${decl[1]}」指向的文件**不在盘**（声明与实际不符）——声明必须指向真实存在的那一版正文；若旧版已归档，改成现版本并重跑 M 门（v18.36.0 起判硬）`, 21)
      }
    }
  }
}

// A5 成对产物（strict）：T7 审计报告 + 反哺报告 缺一不可
if (strict && role === 'T7') {
  const audit = artifacts.find((a) => a.name === '审计报告')
  const fb = artifacts.find((a) => a.name === '反哺报告')
  if (audit && fb && (audit.exists !== fb.exists)) {
    addHard('A5', 'T7 成对产物', `审计报告（${audit.exists ? '在' : '缺'}）与反哺报告（${fb.exists ? '在' : '缺'}）缺一不可`, 21)
  }
}

// A6 agents-log（strict）：该角色「### Tn 执行记录」至少一条
//   v18.62.7（反哺-主控实测 §A12）：**项目已有 ≥3 个角色的执行记录时升为硬问题**。
//   病灶：全流程 20 个角色**没有一个**被要求追加 agents-log，直到 T7 复核时本项报软提示才暴露；
//   而软提示不改退出码 → **20 次都没拦住**。判据 = 「追加 agents-log」在走满 3 个角色后已是**既成约定**
//   （模板 + AGENTS.md 都要求），首轮角色可缺（文件可能还没建）。
if (strict) {
  // ── v18.86.0-prep（台海反哺 F-10）：agents-log 允许**按 Phase 拆分** ─────────────────────────
  //   病灶：单文件 24 小时内涨到 599+ 行（台海实测），可读性与 token 成本都劣化。
  //   处置：**允许**写成 `agents-log-P1.md` / `agents-log-Phase3.md` 等**分片**，本项改为**按族读取**
  //   （`^agents-log.*\.md$` 全部按文件名排序拼接）——**判据一字不变**。
  //   **「拆分后是否仍算单一留痕」的裁定（本批给出）**：**是**。判据 = **文件名前缀 `agents-log`
  //   即同一留痕族**，与 `run/<项目>/sources/T{1,2,3}.jsonl`（分片合并由主控 `--merge`）同一思路。
  //   ⚠️ 这条**必须与文档同批改**：若只改文档、不改本项，拆分会让 A6 **静默退回「无文件」的软提示**
  //   ——正是本仓「删了它这条要求会静默失效」族的老病（见同文件 A8/A4c 的沿革声明）。
  const logFiles = (() => {
    if (!existsSync(project)) return []
    try {
      return readdirSync(project, { withFileTypes: true })
        .filter((e) => e.isFile() && /^agents-log.*\.md$/.test(e.name))
        .map((e) => e.name).sort()
    } catch { return [] }
  })()
  const logLabel = logFiles.length > 1 ? `agents-log*.md（${logFiles.length} 个分片）` : (logFiles[0] || 'agents-log.md')
  // ── v18.81.0（独立审计批 2 · 2.3）：**T8 不适用本项**（修掉「记录越勤越扣分」的逆向激励）─────────
  // 病灶（实测两项目对照）：
  //   · `run/test-v18-78-2-县中塌陷`（agents-log 有 T1/T2/T3/T7 四条记录）→ 缺 `### T8 执行记录`
  //     → `others.size=4 ≥ 3` → **硬 21** → `quality-score` 的 handoff 分量 = **0**；
  //   · `run/共锁-自愿性理论的第四象限`（**一条记录都没有**）→ `others.size=0` → 软 → **22** → 分量 **0.5**。
  //   即：**记录得越多，越容易被判硬、分数越低**；而完全不记的项目反而拿 0.5。
  // 判据（不是"为了分数好看"，而是**本项的前提在 T8 上不成立**）：
  //   A6 的依据是「**派发话术**要求子代理追加 agents-log，走满 3 个角色后已是既成约定」（见下方旧注释）。
  //   而 T8 **不 spawn 子代理**——本文件头注释的「档位不对称」段自陈「T8 是主控亲执行的角色，本就无收报」
  //   （`ROLE_TO_ARTIFACTS['T8']` 为空即此意），`08-终检-finalizer.md` 亦写死「T8 不 spawn 子代理」。
  //   ⇒ 把**面向子代理的留痕约定**套到 T8 上，是把同一文件自己声明的非对称性抹掉。
  //   实测本项对本仓最具代表性的项目给出的正是那个**反向激励**（越规范越吃亏），故在此显式排除。
  // 边界（如实）：**排除的是「T8 记录」这一项**，不是排除 T8 的留痕——T8 的产物（`final/M-Gate-Report.json`、
  //   `final/交付说明.md`）仍由 A1 与 M-Exist 系列核；T1-T7/T9/G14 的 A6 行为**一字未改**。
  if (role === 'T8') {
    notes.push('A6（agents-log 执行记录）：T8 **不 spawn 子代理**（主控亲执行），'
      + '本项面向子代理的留痕约定不适用 → 不判；T8 的留痕由 `final/` 产物（M-Gate-Report / 交付说明）核。')
  } else if (logFiles.length) {
    const log = logFiles.map((n) => readFileSync(join(project, n), 'utf8')).join('\n')
    const token = role === 'G14' ? 'G14' : role
    if (!new RegExp(`###\\s*${token}\\s*执行记录`).test(log)) {
      const others = new Set([...log.matchAll(/^###\s*(T\d+|G14)\s*执行记录/gm)]
        .map((m) => m[1]).filter((t) => t !== token))
      if (others.size >= 3) {
        addHard('A6', logLabel, `缺「### ${token} 执行记录」——项目已有 ${others.size} 个角色的记录（≥3），追加 agents-log 已是既成约定，缺节判硬（v18.62.7 A12；` + '`00-主控-扩展职责.md` §子系统巡检 的派发话术含可粘贴模板）', 21)
      } else {
        addSoft('A6', logLabel, `缺「### ${token} 执行记录」段落（中断续接快照不全；项目已有 ${others.size} 个角色记录，达 3 个后本项升硬）`)
      }
    }
  } else {
    addSoft('A6', 'agents-log.md', '项目无 agents-log 流水（中断续接快照缺失）')
  }
}

// ── B 组：回报侧（给了 report 才跑） ────────────────────────────────────────
// v18.62.4（全量审计-v18.62.3 P1-10）：**「没给回报」不再等于「回报合格」**（fail-open 修复）。
//   病灶（实测）：旧版 `reportText == null` 时 B 组整组既不进 `total`、也不进 `hard`/`soft`
//   → `handoff-check --project <p> --role T5` 在**六要素回报完全缺失**时照样 `exit 0`（= 合格），
//   而「六要素缺一不可」是本包写进 SKILL.md / AGENTS.md 的硬约束。这正是本仓反复批判的
//   「PASS 与『没输入』同形」，且发生在最常用的调用形态上（原生工具的 `report` 是可选参数）。
//   边界（为什么不是一律判 20/21）：
//     · `ROLE_TO_ARTIFACTS[role]` 为空（T0/T8）→ 本就不走收报验收，不受影响（A0 已如实软提示）；
//     · **带 `--require-gates`**（交付前一次性验收）或**给了任何回报**时，缺回报 = **硬判**（21）；
//     · **既没 `--require-gates` 也没回报**时——即调研/收报模式——记一条**软提示**（→ exit 22
//       「需人工复核」）。理由：那正是工具 `lunheng_handoff_check` 的「查一下产物在不在」调用形态，
//       硬判 21 会把「只想看产物」误报成「回报不合」；而 exit 22 仍**不等于 0**，不会静默放行。
//     · 判据一句话：**缺输入要可见、且绝不与 0（合格）同形**。
let report = null
const reportExpected = required.length > 0
if (reportText == null && reportExpected) {
  if (opt.requireGates) addHard('B0', role, '未提供回报（缺 `--report` / `--report-file`）——本角色应带六要素交接回报，`--require-gates` 下判 21', 21)
  else addSoft('B0', role, '未提供回报（缺 `--report` / `--report-file`）——本次只验了 A 组产物侧，回报六要素**未核**；交付前请用 `--require-gates` 复跑或补 `--report`')
}
if (reportText != null) {
  const norm = String(reportText)
  const lines = norm.split('\n').filter((l) => l.trim() !== '')
  const SECTION_NAMES = ['做了什么', '产物在哪', '怎么验证', '已知问题', '下一步', '状态机更新']
  const sectionsFound = []
  const sectionsMissing = []
  // v18.12.0（全量审计 L-65）：判据由 `norm.includes(段名)` 改为**结构判据**。
  //   旧判据只看「这六个词出现过没有」——实测单行散文
  //   「本次检索已结束。产物在哪我还没整理，怎么验证暂缺，已知问题未记录，下一步待定，状态机更新稍后补」
  //   把首句补上「做了什么」即六词齐全 → **exit 0 放行**（而它什么都没交代）；
  //   反过来「六要素成段但产物名不全」却被判 exit 21。即该组与「是否成段」无关，与「词出现与否」有关。
  //   现要求：段名须以**段首形态**出现（行首 `**段名**：` / `段名：` / `### 段名` / `## N. 段名` / 表格首列 `| 段名 |`）。
  // v18.80.1（全量审查修订批 · B3）：补两处，缺任一处则**本包自己的模板仍被判「缺段」**：
  //   ① `(?:\\d+\\.\\s*)?` —— 模板用的是 **`## 1. 做了什么`**，旧正则要求段名**紧跟** `## `；
  //   ② `(?:\\s*[（(][^）)\\n]{0,40}[）)])?` —— 模板 §6 是
  //      **`## 6. 状态机更新（**建议变更，由主控执行**）`**，段名后带括注，旧式按 `\\s*$` 收尾同样不认。
  //   实测（修复前）：逐字照模板产出的**完全合规**回报被判「六要素全缺」→ exit 21（**门拒绝自己发的模板**）。
  const SEG_RE = (s) => new RegExp(
    '(?:^|\\n)\\s*(?:#{2,6}\\s*(?:\\d+\\.\\s*)?|\\|\\s*|[-*]\\s+)?\\*{0,2}' + s + '\\*{0,2}'
    + '(?:\\s*[（(][^）)\\n]{0,40}[）)])?'
    + '\\s*(?:\\*{0,2}\\s*[:：]|\\s*\\||\\s*$)', 'm',
  )
  for (const s of SECTION_NAMES) {
    if (SEG_RE(s).test(norm)) sectionsFound.push(s)
    else sectionsMissing.push(s)
  }
  // v18.80.1（全量审查修订批 · F5）：与 B1 **同源的段判据**，不再用裸子串。
  //   旧式 `/AI 使用|披露/` 只要求「这个词出现过」——把「无（数据来源披露见数据卡）。」写进「已知问题」行，
  //   即可满足 T5/T8 的**硬**披露要求（B2），而报告里没有任何 AI 使用披露内容。
  const aiDisclosed = SEG_RE('AI 使用披露').test(norm) || SEG_RE('AI 使用声明').test(norm)
  const pathMismatch = []
  for (const a of artifacts) {
    if (a.exists && a.path && !norm.includes(basename(a.path))) {
      pathMismatch.push({ artifact: a.name, path: a.path })
    }
  }
  report = { sectionsFound, sectionsMissing, lines: lines.length, pathMismatch }

  // B1 六要素段齐备（硬，21）
  if (sectionsMissing.length) {
    addHard('B1', '回报六要素', `缺段：${sectionsMissing.join('、')}（做了什么/产物在哪/怎么验证/已知问题/下一步/状态机更新）`, 21)
  }
  // B2 AI 使用披露（软；T5/T8 硬）
  if (!aiDisclosed) {
    if (role === 'T5' || role === 'T8') addHard('B2', 'AI 使用披露', 'T5/T8 回报必填「AI 使用披露」段', 21)
    else addSoft('B2', 'AI 使用披露', '回报缺「AI 使用披露」段')
  }
  // B3 回报 ≤10 行（软）
  if (lines.length > 10) addSoft('B3', '回报行数', `回报 ${lines.length} 行 > 10 行上限`)
  // B4 产物在哪段路径 vs A1 解析路径（硬，21；只核「存在产物未出现在回报里」这一向，防假阳性）
  if (pathMismatch.length) {
    addHard('B4', '回报路径', `回报未提及实际落盘产物：${pathMismatch.map((m) => basename(m.path)).join('、')}`, 21)
  }
}

// ── A7 人在环四门（**仅在 `--require-gates` 时判**；v18.12.2 L-08）────────────────────
// 主人 2026-09-25 定案：「L-08 人在环四门**必须**」——四个节点（Phase 0 / 2.5 / 3.5 / 5）**全部必需**，
//   不留「可省任一门」的口子。本项是该定案在机械层的落点。
//
// 判据（两段，都要过）：
//   ① **四份齐备**：`阶段确认-Phase0.md` / `-Phase2.5.md` / `-Phase3.5.md` / `-Phase5.md` 四份都在
//      项目根且非 0 字节 —— 缺一份 → 硬（exit 20，与「产物缺失」同码：补救动作都是**补开那一门**）。
//   ② **§6 已回填**：每份的 `### 6. 主人回复…` 段须含五个固定字段（主人原话 / 回复时间 / 提问方式 /
//      主控落盘结论 / 轮次计数），且**不得残留 `<…>` 占位符** —— 这是「决策真的留痕」与「只落了一份空模板」
//      的分界。字段清单真源 = `references/templates/主人确认-template.md` §6（此处按**字段名**匹配，不抄行文）。
//      不合 → 硬（exit 21，与「结构不合」同码：补救动作都是**回填**）。
//
// 为什么默认不判、只由 `--require-gates` 触发（**有意选择，非疏漏**）：
//   T1-T4/T6/T9 这些中期角色收报时，Phase 3.5/5 两门**本就还没开**——无条件判会把「时点没到」误报成违规
//   （与 M-Exist-2 的「drafts 阶段证据包为空判 N/A」同一条原则）。故把**时点**交给调用方：
//   **主控在 Phase 5 交付前调用 `--require-gates`**；这也让本项成为「交付前一次性验收」而非每轮开销。
if (opt.requireGates) {
  const GATE_DOCS = [
    ['阶段确认-Phase0.md', 'Phase 0 定题', 'Phase0'],
    ['阶段确认-Phase2.5.md', 'Phase 2.5 大纲确认', 'Phase2.5'],
    ['阶段确认-Phase3.5.md', 'Phase 3.5 洞察补充', 'Phase3.5'],
    ['阶段确认-Phase5.md', 'Phase 5 终稿交付', 'Phase5'],
  ]
  const GATE_FIELDS = ['主人原话', '回复时间', '提问方式', '主控落盘结论', '轮次计数']
  // ── v18.81.0（独立审计批 1.1）：**人门口回执账本** ──────────────────────────────
  // 病灶（实测，不是假想）：45 份真实 `阶段确认-*.md` 里，「主控落盘结论」含 **驳回/打回** 的实例 = **0**，
  //   而「主人原话」栏**系统性填的是主控自己的选项标签**——`cn-llm-inference-cost-econ/阶段确认-Phase2.5.md:47`
  //   与 `-Phase5.md:53` 直接把「推荐:按 T4 大纲推进…」「推荐:不进 minor 修订…」抄进该栏；
  //   45 份里只有 1 份是逐字原话。即：§6 五字段只能证明「有人填过」，不能证明「主人真的这么答过」，
  //   而机制把它称作**权威留痕**。
  // 判据：**回执账本 `audits/gate-receipts.jsonl`**（一行一次人门往返，字段形态见
  //   `references/templates/主人确认-template.md` §6 的「回执 id」条）。§6 用 `回执 id` 指向账本行
  //   （形如 `Phase0#1`——**一个门可以有多轮**，实测 `test-v18-78-2-县中塌陷` 的 Phase 0 就有两轮），
  //   本门核对三件事：① 账本里确有该次往返；② 该回执的 gate 与本文档一致；③ §6 的话与账本**相容**
  //   （账本 `rawAnswer` 须逐字出现在「主人原话」栏、`answeredAt` 须出现在「回复时间」栏）。
  //   「相容」而非「相等」是刻意的：真实确认单会把**多轮**往返合并写在同一个 §6（实测），
  //   精确等值会把那种正常形态判红。代价是它比等值弱——**如实登记，不假装更强**。
  // 三态（分段，避免一刀切误伤存量）：
  //   · **无账本文件** → 只进 `notes[]`（**不改退出码**）：存量项目在 v18.81.0 前不可能有账本；
  //     若把它记作 soft，会把「门齐备且记录完整」的最好项目从 exit 0 压到 22（评分 handoff 分量
  //     由 1 掉到 0.5）——**那是对合规项目的反向惩罚**，与 A6 的逆向激励同型，故刻意不挂软项。
  //   · **有账本**：§6 缺 `回执 id` / id 解析不到 / gate 不符 / 文本不相容 → **硬 21**（动作 = 回填）；
  //     账本行自身不自洽（缺字段、tool 名不对、`options[chosenIndex] ≠ chosenLabel`）→ **硬 21**。
  // ⚠️ 能力边界（如实，不得读成「已双盲」或「已防伪」）：**账本仍由主控写入**，它不是 Host 侧独立记录，
  //   故本项提高的是**自述的门槛与一致性**（必须维护一份可交叉核对的结构化账本），**不是密码学保证**。
  //   真正独立于主控的核对路径 = 会话日志（Host 写、主控改不了）——那是**待办**，不构成本项的宣称。
  const receiptsPath = join(project, 'audits', 'gate-receipts.jsonl')
  const receipts = []
  const badLines = []
  if (existsSync(receiptsPath)) {
    let raw = ''
    try { raw = readFileSync(receiptsPath, 'utf8') } catch { addHard('A7', 'gate-receipts.jsonl', '回执账本存在但不可读', 21) }
    raw.split(/\r?\n/).forEach((line, i) => {
      const t = line.trim()
      if (!t) return
      let o = null
      try { o = JSON.parse(t) } catch { badLines.push(`第 ${i + 1} 行不是合法 JSON`); return }
      const problems = []
      if (typeof o.gate !== 'string' || !o.gate) problems.push('缺 gate')
      if (typeof o.answeredAt !== 'string' || !o.answeredAt) problems.push('缺 answeredAt')
      if (typeof o.rawAnswer !== 'string' || !o.rawAnswer) problems.push('缺 rawAnswer')
      if (o.tool !== 'ask_user_question') problems.push('tool 必须逐字为 "ask_user_question"')
      if (!Array.isArray(o.options) || o.options.length === 0) problems.push('options 必须是非空数组')
      else if (!Number.isInteger(o.chosenIndex) || o.chosenIndex < 0 || o.chosenIndex >= o.options.length) problems.push('chosenIndex 越界或非整数')
      else if (o.chosenLabel !== o.options[o.chosenIndex]) problems.push('chosenLabel ≠ options[chosenIndex]（账本自身不自洽）')
      if (problems.length) { badLines.push(`第 ${i + 1} 行：${problems.join(' / ')}`); return }
      receipts.push({ ...o, _line: i + 1, _key: `${o.gate}#${o.round ?? 1}` })
    })
    if (badLines.length) {
      addHard('A7', 'gate-receipts.jsonl',
        `回执账本 ${badLines.length} 行不合法：${badLines.slice(0, 3).join('；')}${badLines.length > 3 ? ' …' : ''}`
        + '——账本损坏时**回执核对不可当通过**（与「N/A ≠ SKIP」同口径）', 21)
    }
  }
  /** 取 §6 段内某固定字段的值（字段名真源 = 模板 §6；此处按名字匹配，不抄行文）。 */
  const fieldVal = (s, k) => {
    const m = new RegExp(`\\*\\*${k}\\*\\*[：:]\\s*([^\\n]*)`).exec(s)
    return m ? m[1].trim() : null
  }
  const missingDocs = []
  // v18.80.4（全量审计-v18.80.3 P1-9）：生效轮次额度 = 默认 ∪ 账本「额度授权」行（主人显式授权，
  //   只许上调、须含依据，见 `_lib/round-ledger.mjs` 的 authorizedCaps）——§6 分母与越额判定
  //   均按**生效额度**判。病根：模板 §8 承诺主人可变更上限，而旧判定固定 ROUND_CAPS → 合法授权
  //   的额外轮次被硬 21。
  const effCaps = parseLedger(project).caps
  for (const [f, label, gateId] of GATE_DOCS) {
    const p = join(project, f)
    if (!existsSync(p)) { missingDocs.push(`${f}（${label}）`); continue }
    let bytes = null
    try { bytes = statSync(p).size } catch { /* 下面统一报 */ }
    if (bytes === 0) { missingDocs.push(`${f}（${label}，0 字节）`); continue }
    let t = ''
    try { t = readFileSync(p, 'utf8') } catch { addHard('A7', f, `四门确认单不可读（${label}）`, 21); continue }
    const secStart = t.search(/^###\s*6\.\s*主人回复/m)
    if (secStart === -1) {
      addHard('A7', f, `缺「### 6. 主人回复」段（${label}）——主人的决策没有落盘留痕（模板 §6 必填）`, 21)
      continue
    }
    const after = t.slice(secStart)
    const nextSec = after.slice(1).search(/^###\s*7\./m)
    const sec = nextSec === -1 ? after : after.slice(0, nextSec + 1)
    const missFields = GATE_FIELDS.filter((k) => !new RegExp(`\\*\\*${k}\\*\\*`).test(sec))
    if (missFields.length) {
      addHard('A7', f, `§6 回填不全（${label}）：缺字段 ${missFields.join(' / ')}（固定五项，缺一即未留痕）`, 21)
    }
    // v18.62.4（全量审计-v18.62.3 §8.1 #2）：**占位符探测的判据过宽，会误伤正常正文**。
    //   病灶：旧式 `<[^>\n]{2,40}>` 只要求「尖括号内有 2-40 个非 `>` 字符」——于是
    //   「如需使用 `<` 与 `>`，请统一为全角」这类**正文里的符号说明**被当成占位符 → **硬判 21**
    //   （A7 = 交接报告结构不合），把一份正常确认单判成「空模板直接落盘」。
    //   修法：占位符 = **紧凑记号**——`<` 后与 `>` 前**都不得是空白**，且首字符须是中文/字母/数字/`._%…`。
    //   实测对照（`_audit_tmp/test-placeholder-re.mjs`，10 例）：`<项目名>`/`<X%>`/`<...>`/`<your-name>`/
    //   `<01-任务简报.md>`/`<T7 审计报告>`/`<被审正文路径>` 全部仍命中；`< 与 >`、`< b >`、`a<b 且 c>d`
    //   不再命中。
    //   ⚠️ **残余歧义（如实声明）**：形如 `a<b 且 c>d`（尖括号内容恰好是紧凑中文）的**正文**仍会被命中——
    //   本判据无法在不引入语义理解的前提下彻底区分「模板占位符」与「正文里用尖括号举例」。
    //   但相较旧判据（**几乎任意含空格文本都命中**），误伤面已从「常见」收到「需刻意构造」；
    //   且该判定为硬失败，故**宁可在注释里说清边界，也不假装判得准**。
    if (/<(?=\S)[\u4e00-\u9fa5A-Za-z0-9._%…][\u4e00-\u9fa5A-Za-z0-9._%… \-]{0,38}(?<=\S)>/.test(sec.replace(/`[^`]*`/g, ''))) {
      addHard('A7', f, `§6 仍含 \`<…>\` 占位符（${label}）——确认单像是**空模板直接落盘**，须回填主人真实回复`, 21)
    }
    if (/TBD|待回填/.test(sec)) {
      addSoft('A7', f, `§6 含「TBD / 待回填」字样（${label}）——请确认是主人真这么答，还是没回填`)
    }
    // ── v18.81.0（批 2.1）：**轮次计数越额**（此前只判「字段非空」，写「已用 5/2 轮」也放行）────────
    // 口径真源 = `_lib/round-ledger.mjs` 的 `ROUND_CAPS`（A ≤2 / B ≤1 / G ≤2；**相位轮无额度**）。
    // 只判**本门声明的数字**是否越额；「账本 ↔ §6 是否一致」放在循环外按 Phase 5 做（累计量只在那时可比）。
    // ⚠️ **本项必须排在「回执账本缺位即 continue」之前**：轮次额度与「有没有回执账本」是**两件独立的事**，
    //   首版把它写在回执块之后 → 无回执账本的项目（占多数）**永远轮不到本项**（本批自证抓出）。
    const roundField = fieldVal(sec, '轮次计数') || ''
    for (const m of roundField.matchAll(/([ABG])\s*轨?\s*(\d+)\s*\/\s*(\d+)/g)) {
      const [, trk, usedRaw, capRaw] = m
      const used = Number(usedRaw); const cap = effCaps[trk]
      const capNote = cap !== ROUND_CAPS[trk] ? `（默认 ${ROUND_CAPS[trk]}，已按账本「额度授权」行上调）` : ''
      if (Number(capRaw) !== cap) {
        addHard('A7', f, `§6「轮次计数」里 ${trk} 轨的分母写成 ${capRaw}，而额度真源是 **${cap}**${capNote}（见 \`${LEDGER_REL}\` 与 \`glossary.md\` §修订回环）`, 21)
      }
      if (used > cap) {
        addHard('A7', f, `§6「轮次计数」**越额**：${trk} 轨 ${used}/${cap}——` +
          (trk === 'A'
            ? '第 3 轮应走 **Acknowledged Limitations**（未关闭 P0/P1 搬入 `final/局限性.md`）并升级主控，不得继续打回'
            : '该轨额度用尽后只出建议件（交付后由主控另行处置）'), 21)
      }
    }
    // ── v18.81.0（批 1.1）：回执核对（**只在账本存在时判硬**，理由见上方三态注释）──────────
    // ── v18.80.4（全量审计-v18.80.3 P1-7）：**Phase 0 预授权门**接受 Phase0 回执 ──────────
    //   模板 §0-d 承诺：主人在 Phase 0 勾选预授权（三条件满足时不等现场回复），§6「提问方式」写
    //   「Phase 0 预授权」。旧判据要求每门一份 gate 相符的现场回执 → 合法预授权被硬 21（审计 P1-7）。
    //   预授权本身在 Phase 0 经 ask_user_question 确认过，故「回执 id」指向 Phase0 那条即合法。
    //   三条件核验仍由人工按模板执行（soft 提示，不假装机械已核）。
    const askMode = fieldVal(sec, '提问方式') || ''
    const isPreAuth = /Phase\s*0\s*预授权/.test(askMode)
    if (isPreAuth) {
      addSoft('A7', f, `本门标注「Phase 0 预授权」——请人工核对「主控落盘结论」栏是否含三条件逐条核验（建议=通过 / P0 数=0 / 未做项=无，模板 §0-d）`)
    }
    if (!existsSync(receiptsPath)) continue
    const idRaw = fieldVal(sec, '回执 id')
    if (!idRaw) {
      addHard('A7', f, `§6 缺「**回执 id**」字段（${label}）——回执账本在盘却未被引用：`
        + '主人的决策将只剩主控自述这一个来源（模板 §6 已列该字段为必填；预授权门填 Phase 0 确认门的回执，如 `Phase0#1`）', 21)
      continue
    }
    const idList = idRaw.split(/[、,，\s]+/).filter(Boolean)
    const hit = idList.map((id) => receipts.find((r) => r._key === id)).filter(Boolean)
    if (hit.length !== idList.length) {
      const miss = idList.filter((id) => !receipts.some((r) => r._key === id))
      addHard('A7', f, `§6 的「回执 id」在账本中找不到：${miss.join(' / ')}`
        + `（可用 id 形如 \`Phase0#1\`；账本共 ${receipts.length} 条有效回执）`, 21)
      continue
    }
    const wrongGate = hit.filter((r) => r.gate !== gateId && !(isPreAuth && r.gate === 'Phase0'))
    if (wrongGate.length) {
      addHard('A7', f, `「回执 id」指向的 gate 与本文档不一致（期望 ${gateId}，实得 ${wrongGate.map((r) => r.gate).join(' / ')}）`, 21)
      continue
    }
    const answerVal = fieldVal(sec, '主人原话') || ''
    const whenVal = fieldVal(sec, '回复时间') || ''
    const textMiss = hit.filter((r) => !answerVal.includes(r.rawAnswer))
    if (textMiss.length) {
      addHard('A7', f, `§6「主人原话」与回执**不相容**：回执 ${textMiss.map((r) => r._key).join(' / ')} 的 \`rawAnswer\` `
        + '未逐字出现在原话栏——该栏必须记录主人的实际回复（模板 §6「不得改写」），不得替换为主控的选项标签', 21)
    }
    const timeMiss = hit.filter((r) => !whenVal.includes(r.answeredAt))
    if (timeMiss.length) {
      addHard('A7', f, `§6「回复时间」未包含回执的 \`answeredAt\`：`
        + `${timeMiss.map((r) => `${r._key}=${r.answeredAt}`).join('；')}`, 21)
    }
    // ── v18.81.0（批 1.4）：**用宿主写的会话日志核对账本**（开启 `--session-log` 时）──────────
    // 批 1.1 的边界是「账本由主控写 ⇒ 提高自述门槛，不是防伪」。本层把那个边界**实质收掉**：
    //   日志由宿主落盘，主控改不了；核对的是「这条回执声称的主人答复，在日志里确有对应的
    //   `ask_user_question` 调用与答复，且答复逐字相同」。
    if (sessionIndex) {
      for (const r of hit) {
        if (!r.callId) {
          addHard('A7', f, `回执 ${r._key} 缺 \`callId\`——**开启 --session-log 后该字段必填**：`
            + '没有它就无法把账本条目绑到日志里那一次真实提问（账本将退回「仅自述」）', 21)
          continue
        }
        const pair = sessionIndex.pairs.find((p) => p.callId === r.callId)
        if (!pair) {
          const known = sessionIndex.callOnly.some((c) => c.callId === r.callId)
          addHard('A7', f, `回执 ${r._key} 的 \`callId=${r.callId}\` 在会话日志中`
            + (known ? '**只有调用、没有答复记录**' : '**找不到**')
            + `（本批读到 ${sessionIndex.files.length} 个会话文件、${sessionIndex.pairs.length} 次完整问答）——`
            + '账本条目无独立来源可核', 21)
          continue
        }
        if (!pair.selected.includes(r.rawAnswer)) {
          addHard('A7', f, `回执 ${r._key} 与**会话日志**不一致：账本 \`rawAnswer\`=「${r.rawAnswer}」，`
            + `而宿主记录的答复是「${pair.selected.join(' / ') || '（无）'}」。`
            + '日志由宿主写入、主控改不了，故此项**不可由改账本消除**', 21)
        }
      }
    }
  }
  // 无账本 → 只进 notes（**不改退出码**，理由见上方三态注释：挂软项会反向惩罚合规项目）
  if (!existsSync(receiptsPath)) {
    notes.push('人门口回执：未发现 `audits/gate-receipts.jsonl` —— 本项目的门留痕仅为 §6 **人工自述**'
      + '（无法核对「主人真的这么答过」）。v18.81.0 前开工的项目属此形态；'
      + '**新项目必须按 `references/templates/主人确认-template.md` §6 落回执账本**（一行一次往返）。')
  } else if (receipts.length === 0 && badLines.length === 0) {
    notes.push('人门口回执：账本存在但 0 条有效回执——与「没记」同形，禁止（与 disproofs-check 对空账本的口径一致）。')
  }
  if (sessionIndex) {
    const totalEvents = sessionIndex.perFile.reduce((s, x) => s + x.events, 0)
    const badLines = sessionIndex.perFile.reduce((s, x) => s + x.badLines, 0)
    notes.push(`人门口回执·独立核对：已读 ${sessionIndex.files.length} 个会话文件 / ${totalEvents} 条事件`
      + `${badLines ? `（${badLines} 行不可解析）` : ''}，配对到 ${sessionIndex.pairs.length} 次 \`ask_user_question\` 完整问答`
      + `${sessionIndex.callOnly.length ? `（另有 ${sessionIndex.callOnly.length} 次只有调用、无答复记录）` : ''}`
      + '——**这一层不依赖账本自述**（日志由宿主写入、主控改不了）。')
  }
  // ── v18.81.0（批 2.1）：**轮次账本**的独立核对（只在账本存在时判）────────────────────────
  // 三件事：① 账本可解析（损坏 ⇒ 额度不可判，不得当通过）；② 账本自身未越额；
  //   ③ **Phase 5 的 §6 声明**与账本累计计数一致（其余门的 §6 是**当时**读数，与累计量不可比，故不比）。
  const ledgerInfo = parseLedger(project)
  if (ledgerInfo.exists) {
    if (ledgerInfo.malformed.length) {
      addHard('A7', LEDGER_REL, `轮次账本有 ${ledgerInfo.malformed.length} 处不可解析：${ledgerInfo.malformed.slice(0, 3).join('；')}`
        + '——账本损坏时**额度不可判**，不得当通过（与「N/A ≠ SKIP」同口径）', 21)
    }
    if (ledgerInfo.over.length) {
      addHard('A7', LEDGER_REL, `轮次账本已越额：${ledgerInfo.over.join('；')}`, 21)
    }
    const p5 = join(project, '阶段确认-Phase5.md')
    if (existsSync(p5)) {
      let t5 = ''
      try { t5 = readFileSync(p5, 'utf8') } catch { /* 不可读已由上文报 */ }
      // ⚠️ **不要用 `\Z`**：JS 正则里 `\Z` 不是「串尾」断言——它退化成**字面量 `Z`**，
      //   于是该节在多数文档里**匹配不上**，而 `s5` 为 null 会让 declared 为空、
      //   **静默跳过不一致检查**（本批自证抓出：探针显示 accounts.A=1 而 §6 写 0/2 却不报）。
      //   这里改用与上文同款的「search + 切到下一个 `### 7.`」写法，避免两类锚点差异。
      const start5 = t5.search(/^###\s*6\.\s*主人回复/m)
      let field5 = ''
      if (start5 !== -1) {
        const after5 = t5.slice(start5)
        const next5 = after5.slice(1).search(/^###\s*7\./m)
        const sec5 = next5 === -1 ? after5 : after5.slice(0, next5 + 1)
        field5 = fieldVal(sec5, '轮次计数') || ''
      }
      const declared = {}
      for (const m of field5.matchAll(/([ABG])\s*轨?\s*(\d+)\s*\/\s*(\d+)/g)) declared[m[1]] = Number(m[2])
      const mismatch = Object.keys(declared).filter((k) => declared[k] !== (ledgerInfo.counts[k] || 0))
      if (mismatch.length) {
        addHard('A7', LEDGER_REL, `Phase 5 的 §6「轮次计数」与账本**不一致**：`
          + mismatch.map((k) => `${k} 轨 §6 记 ${declared[k]} 而账本累计 ${ledgerInfo.counts[k] || 0}`).join('；')
          + '——两者必须同源（账本是累计真源，§6 是当时读数；终稿门应已收敛）', 21)
      }
    }
  } else {
    notes.push(`轮次额度：未发现 \`${LEDGER_REL}\` —— **A 轨 ≤2 / B 轨 ≤1 / G 环 ≤2 本轮仅按 §6 声明的数字判越额**，`
      + '无累计账本可比（存量项目形态；新项目应由 `apply-revision-cycle.mjs` 落账）。')
  }
  // ── v18.81.0（批 2.2）：**A9 轮次复核绑定**（每一轮内容修订都必须有一份指纹相符的复核报告）──────
  // 病灶（审计 P0-2，实测）：`run/test-v18-78-2-县中塌陷` 的 **B 轨深化轮（v4→v5，15 项编辑，改后即定稿）**
  //   **没有独立 T7 复核产物**——`audits/` 下只有 `复核报告-v1.md`，其首节明写只审 `drafts/初稿-v4.md`。
  //   而 A4b 与 M-Exist-4 都只判「审计报告 ↔ 复核报告」的**编号配对**，**B 轨 / 相位轮根本没有审计报告**，
  //   于是「某一轮内容修订从未被复核」在机检层**完全不可见**。
  // 判据：以 `drafts/轮次账本.md` 为真源（批 2.1 已建），对**每一行 A/B 轨**要求
  //   ① `复核报告` 列非空且文件在盘；② 该报告含 `被审正文 sha256`；③ 该指纹与本行 `正文版本` 的实算值相符。
  // 为什么用指纹而不是编号：编号是**审计轮次**的键，B 轨/相位轮没有这个键；指纹是唯一能把「复核过哪一版」钉死的键。
  // 分段（与批 1/2.1 一致）：**账本不存在则不判**（存量项目不追溯）。
  if (ledgerInfo.exists) {
    for (const r of ledgerInfo.rows) {
      if (r.track !== 'A' && r.track !== 'B') continue
      const label = `${r.track} 轨第 ${r.n} 轮（正文 ${r.draft || '**账本未记**'}）`
      if (!r.review) {
        addHard('A9', LEDGER_REL, `${label} 缺「复核报告」列——该轮内容修订**无复核产物**`
          + '（B 轨/相位轮没有审计报告可配对，故这一列是它们唯一的复核凭证）', 21)
        continue
      }
      const repPath = resolve(project, r.review)
      if (!existsSync(repPath)) {
        addHard('A9', LEDGER_REL, `${label} 的复核报告不在盘：\`${r.review}\``, 21)
        continue
      }
      if (!r.draft) {
        addSoft('A9', LEDGER_REL, `${label} 的「正文版本」列空缺 → **无法核对复核指纹**（如实声明，不算通过）`)
        continue
      }
      const draftFile = resolve(project, r.draft)
      if (!existsSync(draftFile)) {
        addSoft('A9', LEDGER_REL, `${label} 的正文文件不在盘（${r.draft}）→ 无法核对复核指纹`)
        continue
      }
      let want = ''
      try { want = createHash('sha256').update(readFileSync(draftFile)).digest('hex') } catch { /* 下面按缺指纹报 */ }
      let repTxt = ''
      try { repTxt = readFileSync(repPath, 'utf8') } catch { /* 上面已确认可读 */ }
      // ⚠️ 模式必须容忍**模板自己规定的那种写法**：`- **被审正文 sha256**：\`<hex>\``——
      //   `sha256` 后面紧跟的是 `**` 而不是冒号。首版正则写成 `…sha256\s*[:：]?…` → 对模板原文
      //   **零命中** → 一份照模板写的合规复核报告被判「缺字段」（本批自证抓出：M1 用例当场红）。
      //   判据：**门用来识别契约的正则，必须先在契约原文上试一遍**（这与「改机制前先读文档」同源）。
      const mm = /被审正文\s*(?:sha256|指纹)[\s*]{0,6}[:：]?[\s*]{0,6}`?([0-9a-fA-F]{12,64})`?/.exec(repTxt)
      if (!mm) {
        addHard('A9', LEDGER_REL, `${label} 的复核报告缺「**被审正文 sha256**」字段`
          + '——没有它无法证明该报告复核的是**这一版**正文（编号对不上 B 轨/相位轮）', 21)
        continue
      }
      const got = mm[1].toLowerCase()
      const n = Math.min(got.length, 12)
      if (!want.toLowerCase().startsWith(got.slice(0, n))) {
        addHard('A9', LEDGER_REL, `${label} 的复核指纹**不符**：账本该轮正文实算 ${want.slice(0, 12)}… `
          + `vs 报告声明 ${got.slice(0, 12)}…——该报告复核的是**另一版**正文`, 21)
      }
    }
  }
  // ── v18.80.1+v（批 5 · A10）：**`drafts/` 语义目录不得混入中间件** ──────────────────────────
  // 判据真源 = `references/agents/05-写作-writer.md` 的修订轮纪律 ④（v18.79.0）：
  //   「段级 diff 的中间件一律落 `%TEMP%` 或 `<项目>/_tmp/`，**不得写进 `drafts/`**」——
  //   理由是 `drafts/` 的语义是「**正文版本**」，而 `build-evidence-bundle.mjs` 靠
  //   「`drafts/` 里最高版 `初稿-vN.md`」**自动挑选被审正文**；混入 `_t5-probe*/` 之类会让
  //   「**最高版本 = 谁**」这条判据依赖命名巧合。卡里自己写着「用毕自删」，并注明「主控手工清了两次」
  //   ——**手工清两次 = 该规则从未被机械化**（本次实测：`run/test-v18-78-2-县中塌陷/drafts/` 下
  //   `_t5-probe{,2,3}` 共 **6.12 MB / 139 文件**，全部违反该条）。
  // 判级取**软**（`addSoft`）：它不改变稿件质量，也不阻塞交付，但必须**可见**——
  //   且**不追溯判红存量项目**（与批 1/2 的分段口径一致：先把事实摆出来，语义处置归主控）。
  // 判据（只认能确证的形态）：`drafts/` 下的**子目录**或**文件名**以 `_` 开头，或形如 `_t5-*` / `*.tmp` / `*.bak`
  //   ——**注意只查 `drafts/` 一级**，不递归（`drafts/archive/` 之类的既有归档不算）。
  //   白名单：`初稿-vN.md` / `修订说明-vN.md` / `段级diff-vN.md` / `轮次账本.md` / `archive/`。
  try {
    const draftsDir = join(project, 'drafts')
    if (existsSync(draftsDir)) {
      const ALLOW = /^(初稿-v\d+\.md|修订说明-v\d+\.md|段级diff-v\d+\.md|轮次账本\.md|archive)$/
      const junk = readdirSync(draftsDir).filter((n) => !ALLOW.test(n) && (/^_/.test(n) || /\.(tmp|bak)$/.test(n) || /^_t5-/.test(n)))
      if (junk.length) {
        addSoft('A10', 'drafts/ 语义目录', `\`drafts/\` 里混入 ${junk.length} 项**非正文版本**产物：`
          + `${junk.slice(0, 6).join(' / ')}${junk.length > 6 ? ' …' : ''}——`
          + '该目录的语义是「**正文版本**」（`build-evidence-bundle` 靠「最高版 `初稿-vN.md`」自动挑被审正文），'
          + '混入中间件会让「最高版本 = 谁」依赖**命名巧合**。按 05 卡修订轮纪律 ④，中间件应落 `%TEMP%` 或 `<项目>/_tmp/`，'
          + '**用毕自删**。（本项为**软提示**：不阻塞交付，但请在该项目下次落盘前清掉。）')
      }
    }
  } catch { /* 目录不可读则跳过：不把「读不到」当「干净」以外的事处理 */ }
  if (missingDocs.length) {
    addHard('A7', '人在环四门', `四门确认单不全：缺 ${missingDocs.join(' / ')}——主人 2026-09-25 定案「四门必须」，交付前四份都要在盘`, 20)
  }
}

// ── 出口 ─────────────────────────────────────────────────────────────────
// v18.57.x（审计修订 P2）：**计量单位必须自洽**。
//   旧版：`total = required.length + (reportText != null ? 1 : 0) + …`，把 B 组整组算 **1 个单位**，
//   而 `pass = total - hard.length - soft.length` 又要减去 B 组的**每一条**失败（B1/B2/B3/B4 各自成条）
//   —— 分母按「组」、分子按「条」，于是 `pass` 既不是通过数也不是通过组数，任何读者都会误读。
//   现：B 组按其**真实检查项数**（4 项）入分母，两侧同一尺度。
//   如实声明的残余边界：A 组按**产物数**入分母，而同一份产物可能同时产出多条（如 A2 0 字节 + A3 不可读）
//   → 此时 `pass` 偏**低**（保守方向：只会少报通过数，不会掩盖问题）。原始条数另以 `hardCount`/`softCount` 暴露。
const B_CHECK_ITEMS = 4   // B1 六要素段 / B2 AI 使用披露 / B3 回报行数 / B4 回报路径
const total = required.length + (reportText != null ? B_CHECK_ITEMS : 0) + (strict && role === 'T7' ? 1 : 0) + (opt.requireGates ? 1 : 0)
const pass = total - hard.length - soft.length
let exit = 0
if (hard.some((h) => h.exitClass === 20)) exit = 20
else if (hard.length) exit = 21
else if (soft.length) exit = 22

const out = {
  role,
  project: opt.project,
  level,
  exit,
  total,
  pass: Math.max(0, pass),
  // v18.57.x：原始条数（不受分母口径影响）与分母口径说明——供机器消费，免去猜 `pass` 的含义。
  hardCount: hard.length,
  softCount: soft.length,
  countingNote: 'total = A 组产物数 + B 组检查项数(4) + [strict&T7] + [--require-gates]；'
    + 'pass = total − 失败条目数。同一份产物可能产出多条（A2+A3），此时 pass 偏低（保守方向）；'
    + '判定请以 exit 与 hard/soft 清单为准，pass 仅供速览。',
  hard: hard.map(({ exitClass, ...rest }) => rest),
  soft,
  // v18.81.0（批 1.1）：信息通道（**不改 exit**）——目前只承载「人门口回执账本缺位」。
  //   它与 `soft` 的分界：`soft` = 「适用但有问题，需复核」（22）；`notes` = 「观测到了，但本轮不判」。
  ...(notes.length ? { notes } : {}),
  artifacts: opt.summary ? artifacts.filter((a) => !a.exists || a.bytes === 0) : artifacts,
  ...(report ? { report } : {}),
  checkedAt: new Date().toISOString(),
}
console.log(JSON.stringify(out, null, 2))
process.exit(exit)
