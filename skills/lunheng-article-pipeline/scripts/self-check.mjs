#!/usr/bin/env node
// 论衡随包自检（v18.63.0 新增；依据 audits/反哺报告-v5-竞品驱动.md §v5.2-1）
//
// 用法：
//   node scripts/self-check.mjs            # 人类可读：逐项 PASS / FAIL / N-A / SKIP
//   node scripts/self-check.mjs --json     # 机器可读（供外部脚本/CI 消费）
//
// 定位：**给「装完包的人」的离线自证入口**——不依赖仓库、不依赖网络、不依赖 DSH 会话。
//   判据一句话：**一条命令回答「手里这个包是不是完整的」。**
//   为什么需要它：npm 发布物**不含** `tests/`（`references/maintainers.md` §四：由 files 白名单 +
//   `repo-hygiene-check` 规则⑥ 负清单 + `pack-smoke` mustNotShip **双重机械保证**），故使用者装完包后
//   原本**无法自证**；本脚本就是那份「包内可验物」（不破既约：不改 files 白名单）。
//
// 检查 5 组（**零 spawn、零写盘、零网络**——对齐 `fix-gates.mjs` 的零写盘先例）：
//   ① 白名单对账：`SKILL.md` 的「随包脚本白名单」行 ↔ `scripts/*.mjs` 磁盘集合（**双向**）
//   ② 运行期承重文件与关键目录齐备且非空（角色卡 / 共享真源 / 模板 / 门定义 / 检测器 / `_lib`）
//   ③ 版本头一致性：`SKILL.md` 版本 = `package.json` 版本 = 各 .md 文档版本头
//   ④ 包面齐备（**仅包布局**）：`main` 入口 / `cordis.patch.yml` 自注册行 / 五语 README / LICENSE
//      —— 纯技能部署（无 `package.json`）→ **N/A 且不改退出码**（如实降级，不臆造）
//   ⑤ 相对导入可解析：`scripts/*.mjs` 的 `./x.mjs` / `./_lib/*.mjs` 目标必须在盘（**防「包少文件」**）
//
// 退出码（**复用既有语义，不新造码**）：
//   0  = 全部通过（**N/A 不算失败**）
//   1  = ≥1 项 FAIL（包不完整 / 口径不一致）
//   3  = 无 FAIL，但有 SKIP（**适用却缺输入**，须人工复核 —— 与 `g-audit-check` 的「`N/A ≠ SKIP`」同口径）
//   10 = 参数错误（含多余位置参数）
//   70 = 内部错误（EX_SOFTWARE，脚本缺陷）
//
// 与既有门的关系（**本脚本不替代任何门**）：`consistency-check`（仓库内文档对账）、`repo-hygiene-check`
//   （仓库门）、`m-gate-check`（项目门）都要求**仓库 / 项目在场**；本脚本只回答「**手里这份包**是否完整」，
//   故它刻意**不做任何内容判定**（不读正文、不判 P0/P1）。
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installExitGuard, EXIT_USAGE } from './_lib/exit-guard.mjs'
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs'
import { packageVersion } from './_lib/pkg-version.mjs'

installExitGuard()

const USAGE = '用法: node scripts/self-check.mjs [--json]'

let flags
try {
  ({ flags } = parseArgs(process.argv.slice(2), { flags: ['--json', '--help'], minPositionals: 0, maxPositionals: 0 }))
} catch (e) {
  if (e && e.code === USAGE_CODE) {
    console.error(e.message)
    console.error(USAGE)
    process.exit(EXIT_USAGE)
  }
  throw e
}

if (flags.has('--help')) {
  console.log(USAGE)
  console.log('')
  console.log('  逐项核对「这个包是不是完整的」：白名单 ↔ 磁盘 / 承重文件 / 版本头 / 包面 / 相对导入。')
  console.log('  退出码：0 全过 ｜ 1 有 FAIL ｜ 3 无 FAIL 但有 SKIP（须人工复核）｜ 10 参数错 ｜ 70 内部错')
  process.exit(0)
}

const HERE = dirname(fileURLToPath(import.meta.url))   // …/skills/lunheng-article-pipeline/scripts
const SKILL_ROOT = resolve(HERE, '..')                 // …/skills/lunheng-article-pipeline
const wantJson = flags.has('--json')

const results = []                                       // { group, id, status, detail }
const add = (group, id, status, detail = '') => results.push({ group, id, status, detail })
const ok = (g, id, d) => add(g, id, 'pass', d)
const bad = (g, id, d) => add(g, id, 'fail', d)
const na = (g, id, d) => add(g, id, 'na', d)
const skip = (g, id, d) => add(g, id, 'skip', d)

const readUtf8 = (p) => readFileSync(p, 'utf8')
const isNonEmptyFile = (p) => { try { const st = statSync(p); return st.isFile() && st.size > 0 } catch { return false } }
const rel = (p) => relative(SKILL_ROOT, p).split(sep).join('/')

// ── ① 白名单对账（真源 = SKILL.md 的「随包脚本白名单」行）────────────────────
const SKILL_MD = join(SKILL_ROOT, 'SKILL.md')
const skillText = isNonEmptyFile(SKILL_MD) ? readUtf8(SKILL_MD) : null

let declaredNames = []
let declaredCount = null
if (!skillText) {
  bad('whitelist', 'W0', `SKILL.md 缺失或 0 字节：${SKILL_MD}`)
} else {
  const wlLine = skillText.split('\n').find((l) => l.includes('随包脚本白名单'))
  if (!wlLine) {
    bad('whitelist', 'W0', 'SKILL.md 找不到「随包脚本白名单」行——该行是脚本清单与计数的**唯一真源**，缺它即无法对账')
  } else {
    const cm = /共\s*(\d+)\s*个/.exec(wlLine)
    declaredCount = cm ? Number(cm[1]) : null
    const eq = wlLine.indexOf('=')
    const right = eq >= 0 ? wlLine.slice(eq + 1) : ''
    const clean = right.split('+ 有限验证命令')[0]
    declaredNames = clean
      .split('/')
      .map((s) => s.replace(/[`\s]/g, ''))
      .filter((s) => /^[a-z][a-z0-9-]{2,}$/.test(s))
    if (!declaredNames.length) {
      bad('whitelist', 'W1', '白名单行解析不出任何脚本名（行形态已变？）——**本检不得静默通过**，请人工核对该行')
    } else if (declaredCount === null) {
      bad('whitelist', 'W2', `白名单行缺「共 N 个」计数（解析出 ${declaredNames.length} 个脚本名）`)
    } else if (declaredCount !== declaredNames.length) {
      bad('whitelist', 'W2', `行内计数与清单不一致：写「共 ${declaredCount} 个」，实际列出 ${declaredNames.length} 个`)
    } else {
      ok('whitelist', 'W2', `白名单行自洽：共 ${declaredCount} 个`)
    }
  }
}

let diskNames = []
try {
  diskNames = readdirSync(HERE)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('.'))
    .map((f) => f.slice(0, -4))
    .sort()
} catch (e) {
  bad('whitelist', 'W4', `scripts 目录不可读：${e.code || e.message}`)
}

if (declaredNames.length) {
  const missing = declaredNames.filter((n) => !diskNames.includes(n))
  if (missing.length) bad('whitelist', 'W4', `白名单声明但**磁盘缺失**：${missing.join(' / ')}（磁盘实测 ${diskNames.length} 个 .mjs）`)
  else ok('whitelist', 'W4', `白名单声明的 ${declaredNames.length} 个脚本全部在盘`)

  const extra = diskNames.filter((n) => !declaredNames.includes(n))
  if (extra.length) bad('whitelist', 'W5', `磁盘有但白名单**未声明**：${extra.join(' / ')}（白名单是唯一真源，未声明脚本不属授权面）`)
  else if (diskNames.length) ok('whitelist', 'W5', '无未声明的脚本')
}

if (diskNames.length) {
  const emptyOnes = diskNames.filter((n) => !isNonEmptyFile(join(HERE, n + '.mjs')))
  if (emptyOnes.length) bad('whitelist', 'W6', `脚本 0 字节：${emptyOnes.join(' / ')}`)
  else ok('whitelist', 'W6', `全部 ${diskNames.length} 个脚本非空`)
}

// ── ② 运行期承重文件 + 关键目录 ─────────────────────────────────────────────
const KEY_FILES = [
  'SKILL.md', 'AGENTS.md', 'QUICKSTART.md', 'README.md',
  'references/glossary.md', 'references/pipeline-readme.md', 'references/maintainers.md', 'references/dispatch-cards.md',
  'references/agents/00-主控-coordinator.md', 'references/agents/00-主控-扩展职责.md',
  'references/agents/01-文献检索-literature-scout.md', 'references/agents/02-数据检索-data-scout.md',
  'references/agents/03-案例检索-case-scout.md', 'references/agents/04-分析-analyst.md',
  'references/agents/05-写作-writer.md', 'references/agents/06-批判-critical-companion.md',
  'references/agents/07-审计-auditor.md', 'references/agents/08-终检-finalizer.md',
  'references/agents/09-审稿-peer-reviewer.md',
  'references/_shared/M-Gate-Algorithm.md', 'references/_shared/M-Gate-Algorithm-appendix.md',
  'references/_shared/规范-机械门对照表.md', 'references/_shared/外部检索源接入面.md',
  'references/_shared/模型路由.md', 'references/_shared/期刊数据库.md', 'references/_shared/机检硬格式.md',
  // v18.64.2（自审修正）：两份**运行期契约**补进承重清单——它们的缺席会让流水线在 Phase 0 / Phase 3.6-4
  //   静默降级（前者定摄取档位与提示话术、后者定负知识账本字段表），故属「缺了就该掉级」的一类。
  'references/_shared/材料摄取.md', 'references/_shared/负知识账本.md', 'references/_shared/引用格式.md',
  'references/gates/14-中文AI痕迹-gate.md', 'references/checkers/中文AI痕迹-checker.md',
  'references/templates/任务简报-template.md', 'references/templates/闸门记录-template.md',
  'references/templates/交接报告-template.md', 'references/templates/主人投喂清单-template.md',
]
const missingKey = KEY_FILES.filter((r) => !isNonEmptyFile(join(SKILL_ROOT, r)))
// v18.64.2（自审修正）：分项明细**从清单派生**，不再手写——旧版手写的「10 张角色卡」与实测的 11 张不符
//   （清单里 00-主控-coordinator 与 00-主控-扩展职责 两张 00 卡 + 01-09 九张）。手写计数 = 必漂，同本仓
//   「凡复述数字必过期」的既有判据；改为按路径前缀统计后，加/删条目时文案自动跟随。
const keyBreakdown = [
  `${KEY_FILES.filter((r) => /^(SKILL|AGENTS|QUICKSTART|README)\.md$/.test(r)).length} 份顶层`,
  `${KEY_FILES.filter((r) => /^references\/[^/]+\.md$/.test(r)).length} 份 references 顶层`,
  `${KEY_FILES.filter((r) => /^references\/agents\//.test(r)).length} 张角色卡`,
  `${KEY_FILES.filter((r) => /^references\/_shared\//.test(r)).length} 份共享真源`,
  `${KEY_FILES.filter((r) => /^references\/gates\//.test(r)).length} 份门定义`,
  `${KEY_FILES.filter((r) => /^references\/checkers\//.test(r)).length} 份检测器`,
  `${KEY_FILES.filter((r) => /^references\/templates\//.test(r)).length} 份模板`,
].join(' + ')
if (missingKey.length) bad('files', 'F1', `承重文件缺失或 0 字节（${missingKey.length}/${KEY_FILES.length}）：${missingKey.join(' / ')}`)
else ok('files', 'F1', `承重文件齐备（${KEY_FILES.length} 个 = ${keyBreakdown}）`)

const KEY_DIRS = [
  'references/agents', 'references/_shared', 'references/templates', 'references/gates',
  'references/checkers', 'references/dicts', 'scripts/_lib', 'scripts/_lib/mgate-gates', 'scripts/_lib/cc-rules',
]
const emptyDirs = []
for (const d of KEY_DIRS) {
  const abs = join(SKILL_ROOT, d)
  let n = -1
  try { n = readdirSync(abs).length } catch { /* 下面统一报 */ }
  if (n <= 0) emptyDirs.push(n < 0 ? `${d}（不存在）` : `${d}（空）`)
}
if (emptyDirs.length) bad('files', 'F2', `关键目录缺失或为空：${emptyDirs.join(' / ')}`)
else ok('files', 'F2', `关键目录齐备且非空（${KEY_DIRS.length} 个）`)

// ── ③ 版本头一致性 ──────────────────────────────────────────────────────────
const VERSION_HEAD_RE = /版本：v(\d+\.\d+\.\d+)/
const skillVer = skillText ? (VERSION_HEAD_RE.exec(skillText.slice(0, 2000)) || [])[1] : null
if (!skillVer) bad('version', 'V1', 'SKILL.md 前 2000 字符找不到「版本：vX.Y.Z」版本头（技能来源自检的锚点）')
else ok('version', 'V1', `SKILL.md 版本头 = v${skillVer}`)

const pkgVer = packageVersion()
if (pkgVer === 'unknown') {
  na('version', 'V2', '未发现 package.json（**纯技能部署的正常形态**）→ 包版本对比不适用；这不等于通过')
} else if (!skillVer) {
  skip('version', 'V2', `package.json = ${pkgVer}，但 SKILL.md 版本头解析不出 → **无法比对**（须人工复核）`)
} else if (pkgVer === skillVer) {
  ok('version', 'V2', `package.json 版本 = SKILL.md 版本 = ${pkgVer}`)
} else {
  bad('version', 'V2', `**版本漂移**：package.json = ${pkgVer}，SKILL.md = ${skillVer}`)
}

const walkMd = (dir, out = []) => {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkMd(p, out)
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p)
  }
  return out
}
const mdFiles = walkMd(SKILL_ROOT)
let withHeader = 0
const mismatched = []
for (const p of mdFiles) {
  let head = ''
  try { head = readUtf8(p).slice(0, 1200) } catch { continue }
  const m = VERSION_HEAD_RE.exec(head)
  if (!m) continue
  withHeader += 1
  if (skillVer && m[1] !== skillVer) mismatched.push(`${rel(p)}（v${m[1]}）`)
}
if (!skillVer) {
  skip('version', 'V3', '无基准版本（SKILL.md 版本头缺失）→ 逐文档版本头无法比对')
} else if (mismatched.length) {
  bad('version', 'V3', `${mismatched.length} 份文档版本头 ≠ v${skillVer}：${mismatched.slice(0, 8).join(' / ')}${mismatched.length > 8 ? ' …' : ''}`)
} else {
  ok('version', 'V3', `${withHeader} 份文档带版本头且全部 = v${skillVer}（另 ${mdFiles.length - withHeader} 份无版本头，不计）`)
}

// ── ④ 包面齐备（仅包布局；纯技能部署 → N/A）─────────────────────────────────
const pkgPath = [join(SKILL_ROOT, 'package.json'), resolve(SKILL_ROOT, '..', '..', 'package.json')].find((p) => existsSync(p))
if (!pkgPath) {
  na('package', 'P0', '未发现 package.json → **纯技能部署**（技能目录被复制到 skill 根）。本组不适用，**不等于通过**')
} else {
  const pkgRoot = dirname(pkgPath)
  let pkg = null
  try { pkg = JSON.parse(readUtf8(pkgPath)) } catch (e) { bad('package', 'P1', `package.json 解析失败：${e.message}`) }
  if (pkg) {
    if (pkg.main && isNonEmptyFile(join(pkgRoot, pkg.main))) ok('package', 'P1', `入口在盘：${pkg.main}`)
    else bad('package', 'P1', `main 入口缺失或为空：${pkg.main || '(未声明 main)'}`)
    const files = Array.isArray(pkg.files) ? pkg.files : []
    const needFiles = ['lib', 'skills', 'cordis.patch.yml']
    const missFiles = needFiles.filter((n) => !files.includes(n))
    if (missFiles.length) bad('package', 'P2', `package.json files 白名单缺：${missFiles.join(' / ')}（发布物会缺件）`)
    else ok('package', 'P2', 'files 白名单含 lib / skills / cordis.patch.yml')
    const patch = join(pkgRoot, 'cordis.patch.yml')
    if (!isNonEmptyFile(patch)) {
      bad('package', 'P3', 'cordis.patch.yml 缺失或为空（bundle 入口靠它装载）')
    } else {
      const selfReg = readUtf8(patch).includes(pkg.name)
      if (selfReg) ok('package', 'P3', 'cordis.patch.yml 含本包自注册行')
      else bad('package', 'P3', `cordis.patch.yml 找不到自注册行（须含包名 ${pkg.name}）——删了它技能就不注册`)
    }
    const READMES = ['README.md', 'README-zh.md', 'README-es.md', 'README-pt.md', 'README-hi.md']
    const missReadme = READMES.filter((r) => !isNonEmptyFile(join(pkgRoot, r)))
    if (missReadme.length) bad('package', 'P4', `五语 README 缺失或为空：${missReadme.join(' / ')}（npm 强制随包，缺件即发布物异常）`)
    else ok('package', 'P4', '五语 README 齐备')
    if (isNonEmptyFile(join(pkgRoot, 'LICENSE'))) ok('package', 'P5', 'LICENSE 在盘')
    else bad('package', 'P5', 'LICENSE 缺失或为空')
  }
}

// ── ⑤ 相对导入可解析（防「包少文件」）──────────────────────────────────────
const IMPORT_RE = /(?:from|import)\s+\(?\s*['"](\.[^'"]+)['"]/g
const brokenImports = []
let importCount = 0
for (const name of diskNames) {
  const file = join(HERE, name + '.mjs')
  let src = ''
  try { src = readUtf8(file) } catch { continue }
  for (const m of src.matchAll(IMPORT_RE)) {
    importCount += 1
    const spec = m[1]
    const target = resolve(HERE, spec)
    if (!existsSync(target)) brokenImports.push(`${name}.mjs → ${spec}`)
  }
}
if (brokenImports.length) bad('imports', 'I1', `${brokenImports.length} 处相对导入目标不在盘：${brokenImports.slice(0, 8).join(' / ')}${brokenImports.length > 8 ? ' …' : ''}`)
else ok('imports', 'I1', `${diskNames.length} 个脚本的 ${importCount} 处相对导入全部可解析`)

// ── 汇总 ────────────────────────────────────────────────────────────────────
const count = (s) => results.filter((r) => r.status === s).length
const summary = { pass: count('pass'), fail: count('fail'), na: count('na'), skip: count('skip'), total: results.length }
const exitCode = summary.fail > 0 ? 1 : (summary.skip > 0 ? 3 : 0)
const version = pkgVer === 'unknown' ? `v${skillVer || 'unknown'}` : `v${pkgVer}`

if (wantJson) {
  console.log(JSON.stringify({ script: 'self-check', version, skillRoot: SKILL_ROOT, results, summary, exit: exitCode }, null, 2))
} else {
  const ICON = { pass: '✅ PASS', fail: '❌ FAIL', na: '➖ N-A ', skip: '⚠️ SKIP' }
  const GROUP_TITLE = {
    whitelist: '① 白名单 ↔ 磁盘对账', files: '② 运行期承重文件与关键目录',
    version: '③ 版本头一致性', package: '④ 包面齐备', imports: '⑤ 相对导入可解析',
  }
  console.log(`论衡随包自检 ${version} —— ${SKILL_ROOT}`)
  console.log('')
  for (const g of ['whitelist', 'files', 'version', 'package', 'imports']) {
    console.log(`【${GROUP_TITLE[g]}】`)
    for (const r of results.filter((x) => x.group === g)) {
      console.log(`  ${ICON[r.status]} ${r.id}  ${r.detail}`)
    }
  }
  console.log('')
  console.log(`汇总：PASS ${summary.pass} ｜ FAIL ${summary.fail} ｜ N-A ${summary.na} ｜ SKIP ${summary.skip}（共 ${summary.total} 项）`)
  if (exitCode === 0) console.log('✅ 本包完整：白名单自洽、承重文件齐备、版本一致。')
  else if (exitCode === 1) console.log('❌ 本包不完整或口径不一致 —— 见上方 FAIL 项（**这不是内容判定，与稿件质量无关**）。')
  else console.log('⚠️ 无 FAIL，但有 SKIP 项 —— **须人工复核**（SKIP ≠ 通过）。')
  console.log(`exit ${exitCode}`)
}

process.exit(exitCode)
