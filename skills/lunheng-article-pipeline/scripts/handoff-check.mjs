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
import { installExitGuard, requireExistingDir } from './_lib/exit-guard.mjs'
import { CONTRACTS } from './_lib/cc-rules/content-rules.mjs'
import { CARD_SPECS, latestReport, indexSection, entryIds, idsByToken } from './_lib/mgate-helpers.mjs'

installExitGuard()   // 必须在任何 readFileSync 之前（fs 异常 → 10，其余 → 70）

const HELP = [
  '用法：node scripts/handoff-check.mjs --project <项目目录> --role <Tn> [--report <文本> | --report-file <路径>] [--summary] [--level basic|strict]',
  '  --project   项目目录（如 run/<项目名>）',
  '  --role      被验收角色（T1..T9 / G14；必填，禁止从 agents-log 猜）',
  '  --report    回报原文（给了才做回报侧 B 组校验；- 表示从 stdin 读）',
  '  --report-file 回报文件路径（与 --report 二选一，--report 优先）',
  '  --summary   只回聚合 + 硬失败项（省 token；hard/soft 永不省略）',
  '  --level     basic（默认，A1/A2/B1）/ strict（全量 A1-A6 + B1-B5）',
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
// 版本号独立于正文轮次的报告（反哺报告 vN = 第 N 次反哺，非正文轮次——不参与 A4 版本对齐）
const VERSION_INDEPENDENT = new Set(['反哺报告'])
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
const opt = { project: null, role: null, report: null, reportFile: null, summary: false, level: 'basic', help: false }
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

  // A4 版本对齐（strict；仅版本化报告类；反哺报告等独立版本线豁免）
  if (art.versioned && art.version != null && latestDraft && art.version !== latestDraft.n && !VERSION_INDEPENDENT.has(artifact)) {
    addHard('A4', artifact, `报告版本 v${art.version} ≠ 被审正文 v${latestDraft.n}（禁 v{N-1}）`, 21)
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
  for (const s of SECTION_NAMES) {
    if (norm.includes(s)) sectionsFound.push(s); else sectionsMissing.push(s)
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

// ── 出口 ─────────────────────────────────────────────────────────────────
const total = required.length + (reportText != null ? 1 : 0) + (strict && role === 'T7' ? 1 : 0)
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
