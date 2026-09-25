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
//
// 真源派生（禁止新建第二份清单）：
//   · 角色 → 必需产物：从 cc-rules/content-rules.mjs 的 CONTRACTS 反查（族名 → 产出者卡 → 角色）
//   · 磁盘路径：mgate-helpers.mjs 的 CARD_SPECS（卡片类）+ 本文件 PATH_SPECS（非卡片类）
//   · 回报六要素段名：交接报告六要素（做了什么/产物在哪/怎么验证/已知问题/下一步/状态机更新）+ AI 使用披露
//
// 只读：不联网、不写盘、不 spawn 子进程。stdout 只有 JSON（--summary 时 artifacts 只留失败项）。
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { createHash } from 'node:crypto'   // v18.12.2（L-06）：A4c 复算最新正文 sha256，与 M 门审定对象比对
import { installExitGuard, requireExistingDir } from './_lib/exit-guard.mjs'
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
  '  --level     basic（默认，A1/A2/B1）/ strict（全量 A1-A6 + B1-B5）',
  '  --require-gates  加验**人在环四门**（阶段确认-Phase0/2.5/3.5/5.md 四份齐备 + §6 主人回复段五项字段已回填）。',
  '                   主人在 2026-09-25 定案「四门必须」→ 主控在 **Phase 5 交付前**调用本旗标做机械校验；',
  '                   不加此旗标则不判四门（向后兼容 T1-T4/T6/T9 等中期角色的收报，那时后几门本就还没开）。',
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
//   · v18.12.2（L-06，主人 2026-09-25 定案）：`审计报告` 的 N = **T7 审计轮次**，`复核报告` 的 N = 同一轮
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
  if (!v || v.startsWith('-')) {
    console.error(`${name} 缺少值（${name} 后必须紧跟一个值）\n${HELP}`)
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
  else if (a === '--level') opt.level = needValue('--level', i++)
  else { console.error(`未知参数: ${a}\n${HELP}`); process.exit(10) }
}
if (opt.help) { console.log(HELP); process.exit(0) }
if (!opt.project) { console.error('缺 --project（项目目录）\n' + HELP); process.exit(10) }
if (!opt.role) { console.error('缺 --role（被验收角色，必填）\n' + HELP); process.exit(10) }
if (!VALID_ROLES.has(opt.role)) { console.error(`--role 非法: ${opt.role}（须 ∈ ${[...VALID_ROLES].join('/')}）`); process.exit(10) }
if (!['basic', 'strict'].includes(opt.level)) { console.error(`--level 非法: ${opt.level}（须 basic|strict）`); process.exit(10) }

const project = requireExistingDir(opt.project, '项目目录')
const role = opt.role
const level = opt.level
const strict = level === 'strict'

let reportText = null
if (opt.report === '-') reportText = readFileSync(0, 'utf8')          // stdin
else if (opt.report != null) reportText = opt.report
else if (opt.reportFile) {
  try { reportText = readFileSync(opt.reportFile, 'utf8') }
  catch { console.error(`回报文件不存在或不可读: ${opt.reportFile}`); process.exit(10) }
}

// ── A 组：产物侧 ───────────────────────────────────────────────────────────
const hard = []
const soft = []
const artifacts = []
const addHard = (check, subject, detail, exitClass) => hard.push({ check, subject, severity: 'hard', detail, exitClass })
const addSoft = (check, subject, detail) => soft.push({ check, subject, severity: 'soft', detail })

const required = ROLE_TO_ARTIFACTS[role] || []
if (required.length === 0) {
  addSoft('A0', role, `${role} 无收报必需产物清单（T0/T8 为主控亲执行或主人侧，一般不做交接验收）`)
}

// 被审正文最新版本（A4 版本对齐用）
const latestDraft = latestReport(join(project, 'drafts'), '初稿')

for (const artifact of required) {
  const art = resolveArtifact(project, artifact)
  const isCond = CONDITIONAL.has(artifact)
  const exists = art.path != null && existsSync(art.path)
  const bytes = exists ? bytesOf(art.path) : null
  artifacts.push({ name: artifact, path: art.path, exists, bytes, version: art.version })

  if (!exists) {
    if (isCond) addSoft('A1', artifact, `修订轮产物「${artifact}」不存在（首轮可缺，缺了不判 20）`)
    else addHard('A1', artifact, `产物不存在（族名 ${artifact} → 解析路径 ${art.path}）`, 20)
    continue
  }
  if (bytes === 0) {
    addHard('A2', artifact, `产物 0 字节（写盘前失败）: ${art.path}`, 20)
    continue
  }
  if (!strict) continue

  // A3 结构（strict）
  let text = ''
  try { text = readFileSync(art.path, 'utf8') } catch { addHard('A3', artifact, `产物不可读: ${art.path}`, 21); continue }
  if (art.isCard) {
    const entries = cardEntries(text)
    const hasIndex = indexSection(text.split('\n')) != null
    if (entries === 0) addHard('A3', artifact, `卡片无条目（[LDC]/[先] 编号 0 条）: ${art.path}`, 21)
    else if (!hasIndex) addSoft('A3', artifact, `卡片缺「## 📇 索引段」（有 ${entries} 条但无索引）`)
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
      addHard('A4b', 'T7 审计↔复核', `审计报告 v${audit.version} 与复核报告 v${review.version} **不同轮**——复核必须与它复核的那一轮审计同号（N = 审计轮次）`, 21)
    }
  }
}

// ── A4c 审定对象校验（strict；v18.12.2 L-06）───────────────────────────────────
// 判据（两条，**一硬一软，刻意分级**）：
//   ① 硬：**仅当 M 门报告自报的被审正文（`verdict_scope.draft_name`）就是最新正文**时，才要求 sha256 一致。
//      否则该报告审的是**别的合法对象**——最典型是 `final/定稿.md`（T8 终检阶段审的是定稿，不是草稿，
//      实测 `筛选竞赛的均衡` 的 M-Gate-Report 审 `final/定稿.md` 而 `drafts/` 最新是初稿-v4）。此时**放行**。
//      只在「自报对象 == 最新正文」这一条上做内容断言，才不会把「审的是定稿」误判成「改稿后没重跑」。
//   ② 软（22 类）：审计报告头部应写 `被审正文：drafts/初稿-vN.md`（或 `final/定稿.md`），且该文件须在盘。
//      为什么是软而不是硬：2026-09-25 实测 **22/22 个既有项目的审计报告都没有这个字段**（该字段本轮才定案），
//      判硬会让全部已交付项目一次性变红——按本仓「不对历史形态过度收紧」的既有原则（见 M-Exist-5 的 L-10
//      同类选择），先做可见性；新报告按 07 卡的写法即天然满足，规则生效后逐轮收紧。
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
    // ② 软：头部「被审正文：」声明
    let txt = ''
    try { txt = readFileSync(audit.path, 'utf8') } catch { /* 上面 A3 已报不可读 */ }
    const decl = txt.match(/被审正文\s*[：:]\s*`?([^\s`|，。]+\.md)/)
    if (!decl) {
      addSoft('A4c', '审计报告', '头部未写「被审正文：`drafts/初稿-vN.md`」——N 跟审计轮次后，审定对象只能靠此声明 + M 门 `verdict_scope` 表达（v18.12.2 L-06）')
    } else {
      const rel = decl[1].replaceAll('\\', '/')
      const cand = [join(project, rel), join(project, 'drafts', rel), join(project, 'final', rel)]
      if (!cand.some((p) => existsSync(p))) {
        addSoft('A4c', '审计报告', `「被审正文：${decl[1]}」指向的文件不在盘（声明与实际不符）`)
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
if (strict) {
  const logPath = join(project, 'agents-log.md')
  if (existsSync(logPath)) {
    const log = readFileSync(logPath, 'utf8')
    const token = role === 'G14' ? 'G14' : role
    if (!new RegExp(`###\\s*${token}\\s*执行记录`).test(log)) {
      addSoft('A6', 'agents-log.md', `缺「### ${token} 执行记录」段落（中断续接快照不全）`)
    }
  } else {
    addSoft('A6', 'agents-log.md', '项目无 agents-log.md（中断续接快照缺失）')
  }
}

// ── B 组：回报侧（给了 report 才跑） ────────────────────────────────────────
let report = null
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
  //   现要求：段名须以**段首形态**出现（行首 `**段名**：` / `段名：` / `### 段名` / 表格首列 `| 段名 |`）。
  const SEG_RE = (s) => new RegExp(
    '(?:^|\\n)\\s*(?:#{2,6}\\s*|\\|\\s*|[-*]\\s+)?\\*{0,2}' + s + '\\*{0,2}\\s*(?:\\*{0,2}\\s*[:：]|\\s*\\||\\s*$)', 'm',
  )
  for (const s of SECTION_NAMES) {
    if (SEG_RE(s).test(norm)) sectionsFound.push(s)
    else sectionsMissing.push(s)
  }
  const aiDisclosed = /AI 使用|披露/.test(norm)
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
    ['阶段确认-Phase0.md', 'Phase 0 定题'],
    ['阶段确认-Phase2.5.md', 'Phase 2.5 大纲确认'],
    ['阶段确认-Phase3.5.md', 'Phase 3.5 洞察补充'],
    ['阶段确认-Phase5.md', 'Phase 5 终稿交付'],
  ]
  const GATE_FIELDS = ['主人原话', '回复时间', '提问方式', '主控落盘结论', '轮次计数']
  const missingDocs = []
  for (const [f, label] of GATE_DOCS) {
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
    if (/<[^>\n]{2,40}>/.test(sec.replace(/`[^`]*`/g, ''))) {
      addHard('A7', f, `§6 仍含 \`<…>\` 占位符（${label}）——确认单像是**空模板直接落盘**，须回填主人真实回复`, 21)
    }
    if (/TBD|待回填/.test(sec)) {
      addSoft('A7', f, `§6 含「TBD / 待回填」字样（${label}）——请确认是主人真这么答，还是没回填`)
    }
  }
  if (missingDocs.length) {
    addHard('A7', '人在环四门', `四门确认单不全：缺 ${missingDocs.join(' / ')}——主人 2026-09-25 定案「四门必须」，交付前四份都要在盘`, 20)
  }
}

// ── 出口 ─────────────────────────────────────────────────────────────────
const total = required.length + (reportText != null ? 1 : 0) + (strict && role === 'T7' ? 1 : 0) + (opt.requireGates ? 1 : 0)
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
  hard: hard.map(({ exitClass, ...rest }) => rest),
  soft,
  artifacts: opt.summary ? artifacts.filter((a) => !a.exists || a.bytes === 0) : artifacts,
  ...(report ? { report } : {}),
  checkedAt: new Date().toISOString(),
}
console.log(JSON.stringify(out, null, 2))
process.exit(exit)
