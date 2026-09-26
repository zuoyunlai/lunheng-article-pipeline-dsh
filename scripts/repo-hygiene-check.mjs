#!/usr/bin/env node
/**
 * repo-hygiene-check.mjs —— 仓库机械卫生门（CI 专用，零依赖，不随包分发）
 *
 * 为什么存在（v2.5.2-dsh.13 新增，回应第三方审计「CI 覆盖度」）：
 *   `consistency-check.mjs` 管文档漂移、`plugin-surface-check.mjs` 管打包面契约，
 *   但**语法/编码/行尾/发布内容**这些「零成本就能机械判定」的东西此前无人守：
 *   - 随包脚本多数从未被 CI 执行过（含承重的 m-gate-check）；**数量不在此处写死**（v18.2.6 更正：旧注释写
 *     「共 11 个」而脚本自己已改成从 SKILL.md 白名单派生、实测 12 个——注释与代码必须同源，否则下一个人
 *     会照着注释去核对错数字）；
 *   - `examples/preset/preset.yml` 从未被任何解析器校验；
 *   - 35 个文件工作区 CRLF、`.gitignore` 是 GBK——而 npm 打包读工作区。
 *
 * 检查项：
 *   ① git 跟踪文件：*.mjs / *.js 逐个 `node --check`（语法；v18.1.0 起含 lib/*.js）
 *   ② *.json 逐个 JSON.parse
 *   ③ *.yml/*.yaml 结构健全（禁制表符缩进 + 关键文件必须含预期键）
 *   ④ 行尾：git ls-files --eol 不得出现 w/crlf 或 w/mixed（配 .gitattributes）
 *   ⑤ 编码：文本文件必须为合法 UTF-8（拒绝替换字符/非法序列）
 *   ⑥ 发布面：npm pack --dry-run --json 必须含关键路径（运行期最小集）+ 脚本数 == SKILL.md 白名单数
 *      **且不得含仓库向文件**（v18.2.0：CHANGELOG/CONTRIBUTING 与 tests/、仓库 scripts/、.github/ 一律不随包）
 *   ⑦ 凭据扫描（零依赖，10 类模式）
 *   ⑦b 本机绝对路径（D-2·修法② · v18.18.4）：发布物硬零 + 非随包树棘轮
 *   ⑧ 退出码契约表（静态解析 process.exit + exit-guard 兜底检查）
 *   ⑧b 退出码命名空间双向对账（EXIT_CONTRACT ↔ troubleshooting §8 · C-11 · v18.18.5）
 *   ⑧c 随包脚本执行面/写盘面派生对账（↔ SECURITY.md · C-7 · v18.18.8）
 *   ⑧d 脚本**自述**退出码 ⊆ 自身契约行（F-5 · v18.18.12）
 *   ⑨ 文档词预算门（v18.1.0：逐文件棘轮上限 + ≥12 KB 全覆盖 + 常驻集合计上限）
 *   ⑩ 注解密度门（v18.8.0：references/** 版本注解行占比上限，只降不抬）
 *   ⑪ `lib/**:LINE` 裸行号引用（C-9 · v18.18.9）
 *   ⑫ E 族「单源不变量」（E-14 期刊规模派生自洽 + E-8/E-14 锚点在场 · v18.18.10）
 *   ⑬ CHANGELOG 版本段结构自洽（段内小节编号递增 / 首段 == package.json / 无重复键 / 降序 · v18.18.13）
 *
 *   ⚠️ 本清单**必须与实现同步**：v18.18.13 补 ⑩–⑬ 与 ⑦b/⑧b–d 时，本清单此前只列到 ⑨，
 *   即「门自己的头落后于门的实现」——与它守的「清单落后于代码」是同一病，故一并补齐。
 *
 * 退出码：0 = 全通过；1 = 有失败（fail-closed，CI 红灯）
 * 失败同时输出 GitHub annotation（::error::），无需下载日志即可定位。
 */
import { readFileSync, existsSync, statSync, mkdtempSync, copyFileSync, rmSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanShipped } from './_lib/pack-negative.mjs' // D-1②：与 pack-smoke 共用同形负清单（结构上同形，不靠两份代码同步）
import { scanLocalPaths, LOCAL_PATH_BASELINE } from './_lib/local-path-scan.mjs' // D-2②：本机绝对路径（发布物硬零 + 非随包树棘轮）
import { parseExitContract, parseNamespaceQuota, reconcile, reconcileScriptHeaders } from './_lib/exit-namespace.mjs' // C-11：§8 配额 ↔ EXIT_CONTRACT 双向对账；v18.18.12 加 ⑧d 脚本自述码对账
import { deriveScriptSurface, parseSecuritySurface, reconcileSurface } from './_lib/script-surface.mjs' // C-7：随包脚本执行面/写盘面 ∈ SECURITY.md
import { findLibLineRefs, isHistoricalDoc } from './_lib/lib-line-refs.mjs' // C-9：当前文档不得有裸 `lib/**:LINE` 引用
import { resolveExitCodes, parseGuardConsts } from './_lib/exit-resolution.mjs' // A-7③：退出码静态解析（含一层变量内联，可单测）
import { parseChangelogSections, reconcileChangelogStructure } from './_lib/changelog-structure.mjs' // ⑬：CHANGELOG 版本段结构自洽（v18.18.13）
import {
  deriveJournalCounts,
  declaredJournalCounts,
  MC_LABEL_ANCHORS,
  JOURNAL_POINTER_ANCHORS,
} from './_lib/e-family-invariants.mjs' // E 族：可派生的单源不变量（见模块头，为什么不做字面禁令）

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const isCI = Boolean(process.env.GITHUB_ACTIONS)
const annotate = (level, msg) => { if (isCI) console.log(`::${level}::${String(msg).replace(/\r?\n/g, ' ').slice(0, 900)}`) }

const fails = []
const notes = []
const fail = (id, msg) => { fails.push(`[${id}] ${msg}`); annotate('error', `[${id}] ${msg}`) }

const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const lsOut = git(['ls-files', '-z'])
if (lsOut.status !== 0) { console.error('git ls-files 失败：' + (lsOut.stderr || '')); process.exit(1) }
const tracked = lsOut.stdout.split('\0').filter(Boolean)

const isText = (p) => !/\.(png|jpe?g|gif|webp|pdf|tgz|zip|ico|woff2?|ttf|eot|mp4|mp3)$/i.test(p)

// ① 语法：node --check（v18.1.0 起含 .js）
//   v18.1.0 扩面的动机（自查发现的缺口）：入口与 C 组新增的 `lib/*.js` 此前**不被任何静态门做语法检查**
//   （规则①只扫 .mjs），它们唯一的下场是「被测试 import」——而裸仓库/CI 里 `lib/index.js` 由
//   `tests/entry.test.mjs` 覆盖、`lib/tools.js` 等**只在有宿主包时才被装载**，语法错会静默潜伏。
//   兼容性：文件是 ESM（包内 `"type":"module"`），Node ≥12 会按最近的 package.json 解析模块类型；
//   万一某版本 `--check` 仍按 CJS 解析（报 "Cannot use import statement outside a module"），
//   退化为「复制成临时 .mjs 再 check」——不引入版本假设。
//   v18.1.0 加一条：扫描集 = git 跟踪文件 **∪ 未跟踪但未被 ignore 的文件**。理由（真实不对称）：
//   `npm pack` 按 package.json 的 `files` 白名单取盘上文件，**包含尚未 git add 的新文件**——
//   即「新写的脚本能被打进发布物、却逃过规则①的语法检查」。
const lsUntracked = git(['ls-files', '-z', '--others', '--exclude-standard'])
const untracked = lsUntracked.status === 0 ? lsUntracked.stdout.split('\0').filter(Boolean) : []
const scanSet = [...new Set([...tracked, ...untracked])]
let checked = 0
let mjs = 0
for (const p of scanSet.filter((f) => f.endsWith('.mjs') || f.endsWith('.js'))) {
  if (!existsSync(join(ROOT, p))) continue
  checked++
  if (p.endsWith('.mjs')) mjs++
  const r = spawnSync(process.execPath, ['--check', join(ROOT, p)], { encoding: 'utf8' })
  if (r.status === 0) continue
  const err = r.stderr || ''
  const esmAsCjs = /import statement outside a module|Unexpected token 'export'|Cannot use import statement/.test(err)
  if (p.endsWith('.js') && esmAsCjs) {
    const d = mkdtempSync(join(tmpdir(), 'lh-syntax-'))
    try {
      const tmp = join(d, 'probe.mjs')
      copyFileSync(join(ROOT, p), tmp)
      const r2 = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' })
      if (r2.status === 0) continue
      fail('syntax', `${p}: ${(r2.stderr || '').split('\n').slice(0, 2).join(' / ')}`)
      continue
    } finally { rmSync(d, { recursive: true, force: true }) }
  }
  fail('syntax', `${p}: ${err.split('\n').slice(0, 2).join(' / ')}`)
}
notes.push(`① 语法：检查 ${checked} 个脚本（.mjs ${mjs} + .js ${checked - mjs}${untracked.length ? `；含未跟踪 ${untracked.length} 个（npm pack 会打包它们）` : ''}）`)

// ② JSON
let jsons = 0
for (const p of tracked.filter((f) => f.endsWith('.json'))) {
  const abs = join(ROOT, p)
  if (!existsSync(abs)) continue
  jsons++
  try { JSON.parse(readFileSync(abs, 'utf8')) } catch (e) { fail('json', `${p}: ${e.message}`) }
}
notes.push(`② JSON：解析 ${jsons} 个 .json`)

// ③ YAML 结构健全（不引入解析器依赖：禁制表符缩进 + 关键文件预期键）
const yamls = tracked.filter((f) => /\.(ya?ml)$/.test(f))
for (const p of yamls) {
  const abs = join(ROOT, p)
  if (!existsSync(abs)) continue
  const text = readFileSync(abs, 'utf8')
  text.split('\n').forEach((l, i) => {
    if (/^\t/.test(l)) fail('yaml', `${p}:${i + 1} 缩进使用制表符（YAML 禁止）`)
  })
}
const needKeys = {
  'cordis.patch.yml': ['insert:', 'dsh'],
  'examples/preset/preset.yml': ['name:', 'description:'],
  '.github/workflows/ci.yml': ['jobs:', 'runs-on:'],
  '.github/workflows/publish.yml': ['jobs:', 'runs-on:'],
}
for (const [rel, keys] of Object.entries(needKeys)) {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) { fail('yaml', `关键 YAML 缺失：${rel}`); continue }
  const text = readFileSync(abs, 'utf8')
  for (const k of keys) if (!text.includes(k)) fail('yaml', `${rel}: 缺预期键「${k}」`)
}
notes.push(`③ YAML：结构检查 ${yamls.length} 个（含 4 个关键文件的预期键）`)

// ④ 行尾
const eolOut = git(['ls-files', '--eol'])
let eolBad = 0
for (const line of (eolOut.stdout || '').split('\n')) {
  const m = line.match(/w\/(crlf|mixed)/)
  if (m) { eolBad++; if (eolBad <= 5) fail('eol', `工作区行尾 ${m[1]}：${line.split('\t').pop()}`) }
}
if (eolBad === 0) notes.push('④ 行尾：无 w/crlf / w/mixed')

// ⑤ UTF-8
let utf8Checked = 0
let replacementHits = 0
const dec = new TextDecoder('utf-8', { fatal: true })
for (const p of tracked.filter(isText)) {
  const abs = join(ROOT, p)
  if (!existsSync(abs)) continue
  utf8Checked++
  try { dec.decode(readFileSync(abs)) } catch { fail('utf8', `${p}: 非法 UTF-8（可能是 GBK 等本地编码）`) }
  // v18.0.5 新增（教训：本轮修订中我用 PowerShell `Get-Content|Set-Content` 往返改 preset.yml，
  //   把文件写成了本地编码 → 规则⑤（fatal 解码）**确实抓到了**；但**同一类事故的更隐蔽形态**是
  //   「已经是合法 UTF-8、却含 U+FFFD 替换字符」——那是不可逆的字符丢失，解码不会报错，
  //   scan 起来像正常文本。故加这一条：任何文本文件不得含 U+FFFD（`\uFFFD`）。
  const text = readFileSync(abs, 'utf8')
  const n = (text.match(/\uFFFD/g) || []).length
  if (n > 0) {
    replacementHits += n
    const line = text.split('\n').findIndex((l) => l.includes('\uFFFD')) + 1
    fail('utf8-replacement', `${p}:${line}: 含 ${n} 个 U+FFFD 替换字符（字符已丢失，通常是编码往返转换造成——请从 git blob 或备份恢复该文件，不要手改）`)
  }
}
notes.push(`⑤ 编码：UTF-8 校验 ${utf8Checked} 个文本文件${replacementHits === 0 ? '（无 U+FFFD 替换字符）' : `（❗ 命中 U+FFFD ${replacementHits} 处）`}`)

// ⑥ 发布面（npm pack --dry-run）
// 用单命令串 + shell（Windows 上 npm 是 .cmd）：避免 Node 对「shell:true + args 数组」的 DEP0190 告警
const pack = spawnSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 32 * 1024 * 1024 })
/** 发布物清单（供 ⑥ 发布面 与 ⑦b 本机绝对路径 共用；v18.18.4 从 ⑥ 的 try 里提到外层）。 */
let packFiles = []
if (pack.status !== 0) {
  fail('pack', `npm pack --dry-run 失败：${(pack.stderr || pack.stdout || '').split('\n').slice(-3).join(' / ')}`)
} else {
  try {
    const arr = JSON.parse(pack.stdout.slice(pack.stdout.indexOf('[')))
    const files = (arr[0]?.files || []).map((f) => f.path)
    packFiles = files
    if (files.length === 0) fail('pack', 'npm pack 报告无文件（--json 解析异常？）')
    const must = [
      'package.json',
      'cordis.patch.yml',
      'LICENSE',
      'README.md',
      // 运行期最小集：入口 + C 组模块 + 技能体 + 随包脚本
      'lib/index.js',
      'lib/tools.js',
      'lib/guard.js',
      'lib/commands.js',
      'skills/lunheng-article-pipeline/SKILL.md',
      'skills/lunheng-article-pipeline/AGENTS.md',
      'skills/lunheng-article-pipeline/scripts/m-gate-check.mjs',
      'skills/lunheng-article-pipeline/scripts/_lib/exit-guard.mjs',
    ]
    for (const m of must) if (!files.includes(m)) fail('pack', `发布包缺关键路径：${m}`)

    // v18.2.0 发布面裁剪（主人指示「最终用户拿到的是功能正常的纯插件，不含无用的冗余文件」）：
    //   **仓库向文件一律不得随包**——它们对装包用户没有用途，只会让发布物变胖、让用户跑不存在的命令。
    //   本清单是**机械防线**：谁把 `CHANGELOG.md` 加回 `files` 白名单，这里立刻报（不是靠自觉）。
    //   边界（如实）：npm **强制包含** 根目录 `README*` 与 `LICENSE`（实测 `files` 删掉、`.npmignore`
    //   排除均无效）——故五语 README 保留在包内，这是 npm 的规则而非本仓疏漏。
    //
    //   v18.18.3（审计 D-1②）：负清单由「仓库根前缀匹配」改为**路径分量匹配**，与 `pack-smoke.mjs`
    //   共用 `_lib/pack-negative.mjs`。旧口径 `f.startsWith('tests/')` 只看根，导致
    //   `skills/lunheng-commands/tests/`（22 用例）与嵌套 `package.json` 随包时**本门照打印零污染**。
    //   多数条目收敛进共用清单后，原先在此逐条硬写的 `scripts/*.mjs` 由 `scripts`（root 作用域）覆盖。
    const negViolations = scanShipped(files)
    for (const v of negViolations) {
      if (v.hits.length) {
        fail('pack', `发布面污染：${v.name}（${v.kind === 'dir' ? '目录' : '文件'}·${v.scope} 作用域）下有 ${v.hits.length} 个随包（如 ${v.hits[0]}）——${v.why}`)
      }
    }
    // 只数**顶层**随包脚本（`scripts/_lib/` 是共享库，不算入口；v2.5.2-dsh.13）
    const scripts = files.filter((f) => /^skills\/lunheng-article-pipeline\/scripts\/[^/]+\.mjs$/.test(f))
    // v2.5.2-dsh.17：脚本数**从 SKILL.md 白名单派生**，不再写死数字（写死会在加脚本时变成噪音红灯；
    // 白名单本身的正确性由 consistency-check 规则 ⑩ 双向核验：磁盘 ↔ SKILL.md）
    const wl = readFileSync(join(ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md'), 'utf8')
      .split('\n').find((l) => l.includes('随包脚本白名单')) || ''
    const declared = (wl.split('=')[1] || '').split('+')[0].split('/').map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9-]*$/.test(s))
    if (declared.length === 0) fail('pack', 'SKILL.md 未声明随包脚本白名单（规则 ⑩ 同源）')
    else if (scripts.length !== declared.length) fail('pack', `发布包内随包脚本数 ${scripts.length} ≠ SKILL.md 白名单 ${declared.length}（白名单不一致）`)
    const unpacked = Number(arr[0]?.unpackedSize ?? 0)
    const negClean = negViolations.filter((v) => v.hits.length === 0).length
    notes.push(
      `⑥ 发布面：${files.length} 个文件 / 随包脚本 ${scripts.length} 个（与 SKILL.md 白名单一致）/ 关键路径齐备` +
        ` / 仓库向零污染（负清单 ${negClean}/${negViolations.length} 条无命中；口径 = 路径分量匹配，非根前缀）` +
        (unpacked ? `｜解包 ${(unpacked / 1024).toFixed(0)} KB` : ''),
    )
  } catch (e) {
    fail('pack', `npm pack --json 解析失败：${e.message}`)
  }
}

// ⑦ 凭据扫描（v2.5.2-dsh.13 新增）：零依赖实现，取代引入第三方扫描 action——
//    与仓库「零运行时依赖」哲学一致，且不扩大 CI 的供应链面（本项目 action 已全部 pin SHA）。
//    注意：本文件自身含模式字面量，扫描时跳过自身。
const SELF = 'scripts/repo-hygiene-check.mjs'
const SECRET_PATTERNS = [
  ['npm token', /npm_[A-Za-z0-9]{30,}/],
  ['GitHub PAT（classic）', /ghp_[A-Za-z0-9]{30,}/],
  ['GitHub PAT（fine-grained）', /github_pat_[A-Za-z0-9_]{30,}/],
  ['OpenAI 风格 key', /sk-[A-Za-z0-9]{20,}/],
  ['AWS Access Key ID', /AKIA[0-9A-Z]{16}/],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['GitLab PAT', /glpat-[A-Za-z0-9_-]{15,}/],
  ['HuggingFace token', /hf_[A-Za-z0-9]{30,}/],
  ['私钥块', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['npmrc _authToken', /_authToken\s*=\s*\S{20,}/],
]
const scanned = tracked.filter(isText).filter((p) => p !== SELF)
let secretHits = 0
for (const p of scanned) {
  const abs = join(ROOT, p)
  if (!existsSync(abs)) continue
  readFileSync(abs, 'utf8').split('\n').forEach((l, i) => {
    for (const [label, re] of SECRET_PATTERNS) {
      const m = l.match(re)
      if (m) {
        secretHits++
        // 只输出掩码前缀——绝不把疑似凭据原文写进 CI 日志/annotation（日志本身就是泄漏面）
        fail('secret', `${p}:${i + 1} 疑似凭据（${label}）：${m[0].slice(0, 6)}…（已掩码）——请轮换该凭据并改用环境变量 / GitHub Secrets`)
      }
    }
  })
}
notes.push(`⑦ 凭据扫描：${scanned.length} 个文本文件 × ${SECRET_PATTERNS.length} 类模式${secretHits ? '（命中 ' + secretHits + '）' : '，无命中'}`)

// ⑦b 本机绝对路径（D-2·修法② · v18.18.4）
//   动机：规则⑦ 只扫**凭据形态**，对「路径」这类可避免的信息泄露完全无感——审计 D-2 实测
//   发布物里写着 `E:\<本机根>\…`（其中一处还带内部项目目录名与内部审计报告名），而⑦ 照打印
//   「无命中」。那三处内容已在早前批次改为占位符；本规则补的是**防复发的那一半**。
//
//   两档强度（这是刻意的，理由见 `_lib/local-path-scan.mjs` 头注释）：
//     · **发布物**——硬零。它是要发出去的制品，一条都不许有。
//     · **非随包树**——**棘轮**。那 22 个文件是历史修订记录，备份路径是安全流程的过程证据；
//       设成硬零会让门**永久红**，而永久红的门等于没有门。棘轮 = 新增即红、缩减即绿。
//
//   ⚠️ **两个由 CI 抓出来的实现缺陷**（v18.18.4，本地跑是绿的、推上去才红）：
//     ① **扫 tracked 会漏掉未 `git add` 的新文件**——`git ls-files` 只列已跟踪的。我本地跑门时
//        新模块还没 add，于是「零命中」；提交后被 CI 扫到才暴露。**改为扫 `scanSet`（含未跟踪，
//        与规则① 同源）**，本地与 CI 才同口径。
//     ② **扫描器自身的定义与测试必然含示例机器路径**——`_lib/local-path-scan.mjs` 要写出模式、
//        `tests/local-path-scan.test.mjs` 要写正/负例夹具，那不是泄露。故显式豁免（同 `SELF` 的思路）。
//        边界（如实）：这三个文件里若真藏了一条与模式无关的真实路径，本规则会漏；缓解是它们
//        **都不随包**（发布物硬零仍生效）、体积小、用途单一。
const LOCAL_PATH_EXEMPT = new Set([SELF, 'scripts/_lib/local-path-scan.mjs', 'tests/local-path-scan.test.mjs'])
const packedSet = new Set(packFiles ?? [])
let shippedPathHits = 0
let ratchetBreaches = 0
const baselineSeen = new Set()
for (const p of scanSet.filter(isText)) {
  if (LOCAL_PATH_EXEMPT.has(p)) continue
  const abs = join(ROOT, p)
  if (!existsSync(abs)) continue
  const hits = scanLocalPaths(readFileSync(abs, 'utf8'))
  if (!hits.length) continue
  if (packedSet.has(p)) {
    shippedPathHits++
    // 路径本身不是凭据，可以照原样打印（打印才可修）；但仍只给首例，避免刷屏
    if (shippedPathHits <= 5) fail('localpath', `**发布物**含本机绝对路径：${p} → \`${hits[0].text}\`（${hits[0].why}）——发布物一条都不许有，请改占位符（如 \`<项目根>/…\`）`)
  } else {
    const cap = LOCAL_PATH_BASELINE[p]
    if (cap === undefined) {
      ratchetBreaches++
      if (ratchetBreaches <= 5) fail('localpath', `非随包文件含本机绝对路径但**未登记**：${p}（${hits.length} 处，首例 \`${hits[0].text}\`）——若确属历史记录，请在 \`_lib/local-path-scan.mjs\` 的 LOCAL_PATH_BASELINE 登记并写明理由`)
    } else {
      baselineSeen.add(p)
      if (hits.length > cap) {
        ratchetBreaches++
        if (ratchetBreaches <= 5) fail('localpath', `${p} 本机绝对路径 ${hits.length} 处 > 棘轮上限 ${cap}（首例 \`${hits[0].text}\`）——新增泄露当即拦下；确属必要请在同一次提交抬升上限并写明理由`)
      }
    }
  }
}
if (shippedPathHits > 5) fail('localpath', `发布物本机绝对路径另有 ${shippedPathHits - 5} 处未逐条列出`)
const staleBaseline = Object.keys(LOCAL_PATH_BASELINE).filter((p) => !baselineSeen.has(p))
notes.push(
  `⑦b 本机绝对路径：发布物 ${shippedPathHits} 处（须为 0）／非随包树棘轮 ${baselineSeen.size}/${Object.keys(LOCAL_PATH_BASELINE).length} 个已登记文件在基线内` +
    `${staleBaseline.length ? `；⚠️ 基线内 ${staleBaseline.length} 个文件已无命中，可把上限改小（${staleBaseline.slice(0, 3).join(' / ')}…）` : ''}`,
)

// ⑧ 退出码契约表（v18.0.2 新增；v18.0.5 大修——第三方审计 P1-5 指出旧版「声称与能力不符」）
//    动机：退出码是**被别的组件消费的输出契约**（`final-check` 的推荐语、主控的闸门判定），
//    实测出现过两类撞码且**此前无门可拦**：
//      · `m-gate-check` 把「定稿/证据包不存在」判 exit 1 → 伪装成「P1 内容失败」，主控据此去改正文；
//      · `model-routing` 用 exit 3 表示「需人工决定」→ 与 M 门 3（仅 P2，**可放行**）撞码。
//    旧版只做两件事：`process.exit(字面量)` ∈ 声明集、以及「表内数字在文件里出现过」（近乎恒真）
//      → **运行时真实退出码（异常路径一律 1）完全不可见**，且规则自身形同虚设。
//    v18.0.5 起改为真核验：
//      ① 解析 `process.exit(<arg>)`：字面量直接用；**标识符**按「本文件 const」→「`_lib/exit-guard.mjs` 导出」
//         两级解析（这样 `process.exit(EXIT_USAGE)` 也能被看见）；
//      ② 解析结果必须是声明集的子集（**这是本规则的主要锋芒**：新加一个 `process.exit(1)` 当路径错会被抓）；
//      ③ 声明集里每个码要么被解析出来、要么在文件里以字面量出现过——**动态 exit 的计算结果无法静态判定**
//         （如 `process.exit(p0 > 0 ? 2 : …)`），此时退化为「字面量出现即认」并在输出里如实标注该脚本是动态的；
//         码 `0` 一律豁免（正常返回不写 `process.exit(0)`）；
//      ④ 异常路径：每个读盘脚本**必须** import `exit-guard`（未 import = 兜底缺失 = 判失败），
//         且 `_lib/exit-guard.mjs` 必须真在盘并导出契约里的两个常量。
//    v18.2.6 两处收紧（第三方审计指出旧版的两个盲区，均已实测确认）：
//      ⑤ **`process.exitCode = N` 赋值形态**纳入解析（Node 里它与 `process.exit(N)` 同样生效）；
//      ⑥ **「已 import guard」改为真 import 匹配**（旧版 `text.includes(GUARD)` 对**注释里提到文件名**也判真——
//         而本仓每个脚本头注释都提到它 ⇒ 该检查恒真，恰恰漏掉「注释还在、import 被删」这一最该抓的形态）。
//    边界（如实）：本规则能拦「静态可解析的撞码」与「兜底缺失」，**不能**拦动态计算出的错误码——
//      那由 `tests/scripts.test.mjs` 的异常路径用例（传目录/传文件/PATH 置空）覆盖。
const GUARD = '_lib/exit-guard.mjs'
const EXIT_CONTRACT = {
  'm-gate-check.mjs': [0, 1, 2, 3, 10, 30, 70],   // v18.12.0（L-05）：30 = `--adjudicate` 裁定被拒（红线命中 / 四件套不全 / 缺 true_p0-p1）
  'final-check.mjs': [0, 1, 2, 3, 10, 70],
  'build-evidence-bundle.mjs': [0, 10, 70],
  'count-chars.mjs': [0, 10, 70],
  'normalize-trust-level.mjs': [0, 1, 10, 70],
  'model-routing.mjs': [0, 4, 10, 70],   // v18.12.0（L-67 同族收口）：删 1——用法/配置错改 10；4 保留为「需人工决定」自有码
  'consistency-check.mjs': [0, 1, 10, 70],
  'token-budget.mjs': [0, 10, 70],   // v18.2.9：删 2——旧版「2 = 项目路径不存在」与 M 门「2 = P0」撞义，已改 10
  // v18.12.0（L-67）：删 1——用法/未知参数/未给模式由 1 改 10。旧版把用法错记为 1，而 1 是 M 门的
  //   「P1 内容失败」→ 主控会把「参数写错」读成「正文有 P1 残留」并误触发 T5 修订轮。
  'token-cost.mjs': [0, 10, 70],   // v18.12.0（L-67）：同上，删 1（未知参数 / 数值非法 / 缓存缺失 / 未给模式一律 10）
  // v18.12.0（L-72c）：`--strict` 校验失败 / 结构不合格拒绝导出 由 **2 改 40**。旧值 2 与 M 门「2 = P0」
  //   撞义——一次全量审计的第三方复核会把「md2html --strict 因缺图退出」读成「定稿有 P0」，两者补救动作
  //   完全不同（补图件 vs 改正文）。40 是 handoff-check(20/21/22) / model-routing(4) / --adjudicate(30)
  //   这一族「给非 M 门语义独立码」里的下一个空位。
  'md2html.mjs': [0, 10, 40, 70],
  'pdfcheck.mjs': [0, 1, 10, 70],
  // v18.2.6 补登（第三方审计 §4.2「`apply-diff.mjs` 未登记进 EXIT_CONTRACT」）：v18.2.5 新增的脚本
  //   装了 exit-guard 却**无门核其退出码**——即「有守卫、无契约」，新增的越界码不会被任何门拦下。
  //   口径取自该脚本头注释：0 = 全部条目应用成功 / 1 = 有跳过或未解析条目、或清单解析出 0 条 / 10 = 参数或路径错。
  'apply-diff.mjs': [0, 1, 10, 70],
  // v18.6.0 补登（交接门规格 §5「登记义务」）：handoff-check 的退出码与 M 门 1/2/3 刻意分离——
  //   20 = 产物缺失或 0 字节 / 21 = 结构·版本·成对·回报段不合 / 22 = 仅软提示；10/70 走 exit-guard 通用语义。
  // v18.12.0（L-05）：`m-gate-check --adjudicate` 的**裁定被拒**同理刻意分离 —— 用 **30**（区别于内容判定
  //   1/2/3，也区别于参数错 10）；理由与本仓记载的「exit 10 被读成 P1」事故同源：**拒绝裁定 ≠ 内容失败**。
  'handoff-check.mjs': [0, 20, 21, 22, 10, 70],
  // ── v18.12.0（L-68）：补齐**全部 23 个随包脚本** ──────────────────────────────────────
  // 旧表只登记 13 个，其余 10 个「装了 exit-guard、却没有契约」——只要它们自己新增一个表外退出码，
  // 任何门都不会吭声（本规则的锋芒正是「表外退出码」）。下面这 10 条全部来自「脚本内字面量 + guard 的
  // 10/70」实测解析；`EXIT_GUARDED_EXEMPT` 为空即证明「装了 guard 必登记」这条不变量成立。
  'apply-compression-cycle.mjs': [0, 1, 10, 70],   // 0 阻塞线内 / 1 仍超阻塞线需 T5 修订轮
  'apply-revision-cycle.mjs': [0, 1, 10, 70],      // 0 循环完成 / 1 diff 解析 0 条或 apply-diff 失败（含部分跳过）
  'cite-coverage-check.mjs': [0, 1, 3, 10, 70],    // M 门同源代码：1 = P1，3 = 仅 P2 软提示
  'fix-gates.mjs': [0, 1, 10, 70],                 // 0 无待修项 / 1 有生成的修订建议（**非闸门**）
  'journal-fit.mjs': [0, 1, 3, 10, 70],            // 1 = P1 命中 / 3 = 仅 P2（期刊不在库等）
  'lunheng-stats.mjs': [0, 10, 70],
  'meta-synthesize.mjs': [0, 3, 10, 70],           // 3 = 仅 P2 软提示（表内曾误登 1，静态解析无此字面量）
  'methodology-check.mjs': [0, 1, 2, 3, 10, 70],   // v18.16.0（A-7 反哺）：补 2 = P0（方法节参数 <2 项）；**v18.18.11 再补 3**——A-7 当时只补了 2，而该脚本的 `exitCode = allPass ? 0 : (hasP0 ? 2 : (hasP1 ? 1 : 3))` 明确可达 3（仅 P2 软提示），属「修一半」
  'segment-chars.mjs': [0, 10, 70],
  'structure-check.mjs': [0, 1, 2, 3, 10, 70],  // v18.18.11（A-7③ 一层内联后暴露）：本脚本与 methodology-check 同形（`allPass ? 0 : (hasP0 ? 2 : (hasP1 ? 1 : 3))`），旧表只登记 0/1/10/70，**2 与 3 都漏了**
}
// v18.12.0（L-68）：**「装了 guard 必登记」是判据，不是注释** —— 旧表靠人工维护，漏登记没有任何门会发现。
//   新脚本加 guard 却忘了登记，等于给自己开了一个「表外退出码随便用」的后门；故本规则改为
//   「凡是真 import `_lib/exit-guard.mjs` 的随包脚本，必须在 EXIT_CONTRACT 里有一行」。
//   豁免留一扇门（必须是**显式登记的理由**，不是静默跳过）：当前为空——23/23 全覆盖。
const EXIT_GUARDED_EXEMPT = {}
const scriptDir = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')
const dynamicScripts = []
let indirectHits = 0 // A-7③：一层变量内联累计命中数（跨脚本统计，故声明在循环外）
const guardPath = join(scriptDir, GUARD)
if (!existsSync(guardPath)) {
  fail('exit-code', `缺少 ${GUARD}——退出码硬化的实现不在盘（契约里 10/70 的语义无处可查）`)
} else {
  const gt = readFileSync(guardPath, 'utf8')
  for (const [name, val] of [['EXIT_USAGE', 10], ['EXIT_INTERNAL', 70]]) {
    if (!new RegExp(`export const ${name} = ${val}\\b`).test(gt)) {
      fail('exit-code', `${GUARD} 未按契约导出 ${name} = ${val}（契约表与 troubleshooting §8 都引它）`)
    }
  }
}
for (const [name, allowed] of Object.entries(EXIT_CONTRACT)) {
  const p = join(scriptDir, name)
  if (!existsSync(p)) { fail('exit-code', `退出码表登记的脚本不存在：${name}`); continue }
  const text = readFileSync(p, 'utf8')
  // ①-③（A-7③ v18.18.11）：静态解析交给 `_lib/exit-resolution.mjs`（含「一层变量内联」，可单测）。
  //   该模块头注释记了本次一口气修掉的三个坑（只取初值 / 赋值为另一变量 / 复合实参误追标识符）。
  const guardConsts = existsSync(guardPath) ? parseGuardConsts(readFileSync(guardPath, 'utf8')) : new Map()
  const { resolved, dynamic: dynamicExit, indirectHits: hits } = resolveExitCodes(text, guardConsts)
  indirectHits += hits
  // 真 import 检查（v18.2.6 收紧）：旧实现是 `text.includes(GUARD)`——**注释里提到也算「已 import」**，
  //   于是「头注释写了 `_lib/exit-guard.mjs`、代码里却删了 import」这种**最该抓的形态**恰好被判通过
  //   （本仓每个脚本的头注释都提到该文件名，等于这条检查对它们恒真）。现改为匹配真正的 import：
  //   静态 `import … from '<…>/_lib/exit-guard.mjs'` 或动态 `import('<…>/_lib/exit-guard.mjs')`。
  const guardEsc = GUARD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const importRe = new RegExp(`(?:^|\\n)\\s*import[^\\n]*?from\\s*['"][^'"]*${guardEsc}['"]|import\\(\\s*['"][^'"]*${guardEsc}['"]\\s*\\)`)
  const usesGuard = importRe.test(text)
  if (usesGuard) { resolved.add(10); resolved.add(70) }   // 异常路径由 guard 统一映射（fs → 10；其余 → 70）
  const unexpected = [...resolved].filter((c) => !allowed.includes(c))
  if (unexpected.length) {
    fail('exit-code', `${name}: 使用了表外退出码 ${unexpected.join(', ')}（已声明 ${allowed.join('/')}）——若是有意新增，请同步 repo-hygiene 的 EXIT_CONTRACT 与 docs/troubleshooting.md §8`)
  }
  // 动态 exit：静态不可判定 → 退化为「文件里出现过即认」，并在 note 里如实标注（不假装核验过）
  const phantom = allowed.filter((c) => c !== 0 && !resolved.has(c) && !(dynamicExit && new RegExp(`\\b${c}\\b`).test(text)))
  if (phantom.length) {
    fail('exit-code', `${name}: 契约表声明了 ${phantom.join(', ')}，但脚本里既解析不出、也无字面量——表格已过期，请核对`)
  }
  if (!usesGuard) {
    fail('exit-code', `${name}: 未真正 import ${GUARD}（注释里提到不算）——异常路径会退回 Node 默认的 exit 1，与「1 = P1 内容失败」撞义（v18.0.5 起每个读盘脚本都必须装 guard；v18.2.6 起本检查改为匹配真实 import 语句）`)
  }
  if (dynamicExit) dynamicScripts.push(name)
}
// v18.12.0（L-68）：「装了 guard 必登记」的**覆盖面断言**（旧表靠人工维护，漏登记无门发现）。
//   为什么把它放在逐脚本循环之后而不是并进去：它判的是**表本身完不完整**（集合关系），
//   而不是某个脚本的内容——混进循环会让「新增脚本忘登记」看起来像那个脚本的错。
const guardedButUnregistered = []
for (const f of readdirSync(scriptDir).filter((x) => x.endsWith('.mjs'))) {
  if (EXIT_CONTRACT[f] || EXIT_GUARDED_EXEMPT[f]) continue
  const t = readFileSync(join(scriptDir, f), 'utf8')
  const re = new RegExp(`(?:^|\\n)\\s*import[^\\n]*?from\\s*['"][^'"]*${GUARD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`)
  if (re.test(t)) guardedButUnregistered.push(f)
}
if (guardedButUnregistered.length) {
  fail('exit-code', `${guardedButUnregistered.join(', ')}：装了 ${GUARD} 却未登记进 EXIT_CONTRACT——` +
    '装了 guard 的脚本其异常路径会产出 10/70，而它自己新加的表外退出码将没有任何门能拦（这正是本规则的锋芒）。' +
    '请在 EXIT_CONTRACT 补一行；若确需豁免，必须在 EXIT_GUARDED_EXEMPT 写明理由（不得静默跳过）')
}
notes.push(
  `⑧ 退出码表：${Object.keys(EXIT_CONTRACT).length} 个随包脚本的退出码契约已核（静态解析 process.exit/exitCode 两种写法 + **一层变量内联**（A-7③）+ guard **真 import** 兜底检查）` +
    `；覆盖面：凡 import ${GUARD} 的脚本 100% 已登记（豁免 ${Object.keys(EXIT_GUARDED_EXEMPT).length} 个）` +
    `；一层内联命中 ${indirectHits} 处字面量` +
    (dynamicScripts.length ? `；**仍未静态可判定**（仅对契约码核「文件里出现过」，如实标注不假装核过）：${dynamicScripts.join(', ')}` : '；全部脚本均可静态判定'),
)

// ⑧b 退出码命名空间对账（C-11 机械化 · v18.18.5）
//   动机：纪律要求两处登记——`EXIT_CONTRACT`（机器面）与 `docs/troubleshooting.md` §8
//   「命名空间配额」（人读面）——但两处一直**只靠人工同步**。加了新码而 §8 忘写（或反之）
//   没有任何门会发现。审计 C-11 要的是「§8 与 EXIT_CONTRACT 一致（新增断言）」。
//   审计设想 §8 是逐行表，实测它是**配额散文**，故实现其等价不变量：
//   「代码实际用到的码集合」== 「§8 声明的码集合」，**双向**查（漏登记 / 已无人用 都报）。
//   解析器放在 `_lib/exit-namespace.mjs`（可单测）；形状变了会**抛错**而不是静默通过。
try {
  const contract = parseExitContract(readFileSync(join(ROOT, 'scripts', 'repo-hygiene-check.mjs'), 'utf8'))
  const quota = parseNamespaceQuota(readFileSync(join(ROOT, 'docs', 'troubleshooting.md'), 'utf8'))
  const { onlyInCode, onlyInDoc } = reconcile(contract.codes, quota.codes)
  if (onlyInCode.length) {
    fail('exit-code', `退出码 ${onlyInCode.join(', ')} 已写进 EXIT_CONTRACT 但**未登记**于 docs/troubleshooting.md §8 命名空间配额（:${quota.line}）——两处必须同一次提交一起改`)
  }
  if (onlyInDoc.length) {
    fail('exit-code', `§8 命名空间配额（:${quota.line}）声明了 ${onlyInDoc.join(', ')}，但 EXIT_CONTRACT 里**已无人使用**——要么补用，要么从 §8 删掉（免得下一个人以为这些码被占了）`)
  }
  notes.push(`⑧b 退出码命名空间：代码侧 ${contract.codes.length} 个码 ↔ §8 声明 ${quota.codes.length} 个码，双向一致（${contract.codes.join('/')}）`)
} catch (e) {
  fail('exit-code', `⑧b 退出码命名空间对账无法执行：${e.message}`)
}

// ⑧c 随包脚本「执行面/写盘面」派生对账（C-7 机械化 · v18.18.8）
//   动机：`SECURITY.md` 是操作者安装前的**信任边界依据**，其中一段手写维护「哪些随包脚本会写盘 /
//   会派生子进程」。这类**手写代码事实清单**正是本仓反复出错的形态（C-1 工具数 / D-1 发布面负清单 /
//   C-11 退出码表 / C-7 本次，同族）——代码一改、清单不跟，而失真方向几乎总是**低报执行面**
//   （把会写盘的脚本说成只读）。审计 C-7 的实测即如此：`apply-compression-cycle.mjs` 被列为只读，
//   而它 spawnSync 转调的 `build-evidence-bundle.mjs` 有 10 处写盘。
//   现改为**从源码派生 + 双向对账**。三档口径（写内容 / 仅建目录 / 子进程）见 `_lib/script-surface.mjs`。
try {
  const surface = deriveScriptSurface(join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts'))
  const declared = parseSecuritySurface(readFileSync(join(ROOT, 'SECURITY.md'), 'utf8'))
  const diff = reconcileSurface(surface, declared)
  const label = { spawn: '子进程面', writeContent: '写内容面', mkdirOnly: '仅建目录' }
  for (const [key, d] of Object.entries(diff)) {
    if (d.onlyDerived.length) {
      fail('surface', `${label[key]}：源码派生出的 ${d.onlyDerived.join(', ')} **未写进** SECURITY.md 的随包脚本行——清单落后于代码（低报执行面）`)
    }
    if (d.onlyDoc.length) {
      fail('surface', `${label[key]}：SECURITY.md 列了 ${d.onlyDoc.join(', ')} 但**源码里已无该能力**——清单陈旧，请删或改`)
    }
  }
  notes.push(
    `⑧c 随包脚本执行面：子进程 ${surface.spawn.length} / 写内容 ${surface.writeContent.length} / 仅建目录 ${surface.mkdirOnly.length} / 只读 ${surface.readOnly.length}` +
      `（共 ${surface.all.length}）——与 SECURITY.md 双向一致`,
  )
} catch (e) {
  fail('surface', `⑧c 随包脚本执行面对账无法执行：${e.message}`)
}

// ⑧d 脚本**自述**退出码 ↔ 自身契约行（F-5 机械化 · v18.18.12）
//   动机：随包脚本头部会自述返回码（`// 返回码：0 = …；4 = …`），这是退出码的**第三处**登记
//   ——`EXIT_CONTRACT`（机器面，⑧ 管）与 `troubleshooting.md §8`（人读面，⑧b 管）之外的
//   **脚本自带面**，此前没有任何门看它。实测教训（本次审计 F-5 执行中发现）：
//   `model-routing.mjs:20` 自述「`1 = 读不到配置`」，而该脚本 `process.exit(1)` 个数为 **0**、
//   契约行是 `[0,4,10,70]`——那个 `1` 是 v18.12.0 收口前的遗留声明。调用方按自述去接 `1`
//   永远等不到；维护者按自述去改会以为 `1` 还被占着。此即 F-5 一类「文案与行为脱节」的形态，
//   故机械化成门（而不是再补一条只看字面的文本断言——那样连这次这个错都抓不到）。
//   不变量（**单向**）：脚本自述的码 ⊆ 自身契约行。反方向**刻意不报**（`0`/`70` 对每个装了
//   guard 的脚本都可用、自述常只写语义码而省略它们，实测 apply-diff / apply-revision-cycle
//   两处属此情形）——详见 `_lib/exit-namespace.mjs` 的偏差说明。
try {
  const entries = []
  for (const name of Object.keys(EXIT_CONTRACT)) {
    const p = join(scriptDir, name)
    if (existsSync(p)) entries.push({ name, allowed: EXIT_CONTRACT[name], text: readFileSync(p, 'utf8') })
  }
  const { checked, violations } = reconcileScriptHeaders(entries)
  for (const v of violations) {
    fail('exit-code', `${v.name}:${v.line} 头部自述的退出码 ${v.extra.join(', ')} **不在**自身契约行（${v.allowed.join('/')}）内——脚本承诺了它产不出的码，请改注释或改契约（两处必须同一次提交一起改）`)
  }
  // 只有**零违例**时才打这条「一致」的 note：本门自己犯过「一边 fail 一边打 ✓ 一致」的毛病
  //   （v18.18.12 反向自证时现场抓到），那会让读报告的人以为该项通过了。
  if (!violations.length) {
    notes.push(`⑧d 脚本自述退出码：${checked} 个脚本的头部「退出码/返回码」段 ↔ EXIT_CONTRACT **单向**一致（自述码均 ⊆ 自身契约行）`)
  }
} catch (e) {
  fail('exit-code', `⑧d 脚本自述退出码对账无法执行：${e.message}`)
}

// ⑨ 文档词预算门（v18.1.0 新增，第三方审计改进方案 C-6）
//    为什么需要：本包的成本结构里，**唯一随每次会话恒定的开销就是被载入上下文的文档**（技能体 SKILL.md
//      由入口注册 → 每次技能激活都在上下文里；AGENTS.md 在工作目录下自动生效）。审计实测「较瘦身底 +69%」，
//      且历史趋势是**只增不减**（每轮修订都往 SKILL.md 加一行注解）。此前的门全都只看「有没有错」，
//      **没有一条门看「涨没涨」**——于是膨胀是唯一无人反对的方向。
//    官方先例：`references/official-docs/AGENTS.md` 的 `verify-doc-budgets`（doc budget manifest + 机检）。
//    设计（三条，缺一不可）：
//      ① **逐文件上限**：技能目录内所有 ≥ `DOC_BUDGET_MIN` 的 .md 必须有登记（新增胖文档不能悄悄逃过测量）；
//      ② **上限即棘轮**：上限取「当前字节数向上取整到整 KB」——留 ≤1 KB 余量，任何增长都必须**在同一个 diff 里
//         显式抬升上限**（抬升动作可见、可 review、可被主人否决），而不是无声膨胀；
//      ③ **常驻集合计上限**：SKILL.md + AGENTS.md 的**合计**另有上限——防止「瘦 SKILL、肥 AGENTS」把固定开销换个口袋。
//    边界（如实）：本规则管的是**字节量**（代理指标，≠ 真实 token 数，不区分中英）；`target`（长期目标）只作
//      报告用，**不判失败**——本版是棘轮，不是瘦身令（瘦身需要主人拍板口径，见 CHANGELOG `## 18.1.0`）。
const DOC_BUDGET_MIN = 12 * 1024
const kb = (n) => `${(n / 1024).toFixed(1)} KB`
const DOC_BUDGET = {
  // 相对仓库根的路径 → [上限字节, 长期目标字节, 说明]
  'skills/lunheng-article-pipeline/SKILL.md': [38912, 20480, '技能体：入口注册的正文，每次技能激活都进上下文（最贵的文件）——**v18.12.3 显式抬升 37→38 KB（审计 L-07 落地）**：唯一的实质增长是 §⚡ 启动速查表的 `- Phase：` 序列行补入 `1.5 补检索` 与 `4.2 修订回环`（+约 30 B）+ 该行为什么曾经缺二者的成因注（依「注解聚合」约定：成因与判据留在原处，细节归 CHANGELOG §18.12.3）。为什么必须增长而不是瘦身：该行是**主控排 `todo_write` 的唯一 Phase 真源**，缺 `4.2` 时主控的计划里整整一轮修订回环不存在（L-07 的实测后果：真实项目临时造「Phase 4 修订」命名）——这条不是元信息、是运行期承重内容；而 `Phase 1.5` 会真 spawn 一个 T1 子代理。抬升后留 ~500 B 余量。**v18.12.0 显式抬升 36→37 KB（全量审计收口批）**：本版新增一行 v18.12.0 版本增量摘要（依「注解聚合」约定：一句话 + 指针，细节归 CHANGELOG §18.12.0），并**同批先做两轮瘦身**——① 把 v18.11.0/18.10.0/18.8.0/18.7.1–18.7.3 五段摘要逐条压成「一句话 + 指针」（细节全在 CHANGELOG 同名版本段，删掉的是**重复叙述**而非机制事实）；② 补一行「本版增量明细外移」说明，防后来者把 CHANGELOG 里的细节再抄回来。瘦身后实测 **36777 B**，距 36864 B 仅 87 B —— 按「不许把棘轮停在距上限数十 B（等效禁止再写）」的既有原则（v18.2.7 / v18.11.0 先例）抬到 37 KB，留 ~1.1 KB 余量。**瘦身待办**：把运行期不读的维护者向元信息继续外移（rank 表 / guard 边界 / 模板计数已迁 `references/maintainers.md`），长期目标 20 KB。**v18.11.0 显式抬升 34→36 KB**：本版反哺落地按「注解聚合」约定新增一行版本增量摘要（单行 + 指针，细节归 CHANGELOG §18.11.0）；抬升后留 ~1.4 KB 余量。**v18.11.0 补登记 33→34 KB（主人授权「依次全部都做」）**：v18.10.0 落地 12 项战略改进时本文件增长但**未同提交抬棘轮**（违反 v18.1.0「文档增长须同提交抬升」），发布后 `repo-hygiene-check` 即为红；本次补登记实测值。v18.6.0 后曾显式抬升 32→33 KB（整体审查收尾）：启动速查表补「收报验收」行（交接门 handoff-check 收报动作，规格 §8 #7 补齐）'],
  'skills/lunheng-article-pipeline/AGENTS.md': [21504, 16384, '操作手册：技能目录内自动生效的指令'],
  'skills/lunheng-article-pipeline/references/pipeline-readme.md': [98304, 61440, '**外部机制借鉴批 2（2026-09-26）显式抬升 95→96 KB（主人指令「启动批2」；抬升理由是余量只剩 98 B——按本文件既有的「不许把棘轮停在距上限数十 B（等效禁止再写）」原则抬升，留约 1.1 KB）**：§T9 段「何时用」下补一行**可选对抗视角**（T9-v / T9-i：参谋性质 + 三条硬边界的最小集），使派发层与 09 卡同源。流水线全景 + 派发话术（T0 启动必读）——**v18.12.2 显式抬升 92→94 KB（2026-09-25 L-06「产物 N 跟审计轮次」+ L-08「四门必须」）**：本版在派发层新增两条**交付契约级**规则，无处可挪——① §T7 派发话术产出行补「N = 审计轮次 + 头部须写 `被审正文:` 声明」（旧口径「报告版本 == 初稿版本」仍是默认读法，不写清 T7 会照旧命名）；② §主人侧三件套表下补「四门『必须』」段（不设可省任一门 + `--require-gates` 的机械落点与退出码）。**同批已先瘦身**（四门段 750→560 B，删去与主控卡重复的字段清单复述改指针）。**v18.12.0 显式抬升 91→92 KB（2026-09-25 全量审计第七梯队）**：派发层新增两处**会让流水线卡死或漏检**的口径补正，均无处可挪（T0 启动必读、按需加载无从谈起）——① §T7 派发话术前置条件补「跳过 T6 的档位」分支（L-26：轻量档/3000-5000 档允许跳过 T6，而旧前置条件写「T6 批判报告 + T5 v3 完成」→ 该条件**永假**，照做会让流水线断在「不派 T7」）；② 两道闸门段落补「v18.12.0 三处口径补正」块（L-37 T2.5 判定前须先刷证据包，否则报数据卡不存在类假 P0；L-33 三个战略门脚本尚无门核验真跑过，约定 T7.5 备注栏留 exit 一览并已登记为待补门；L-24 全库锚点由一致性规则 ㉗ 强制）。**同批已先做两处瘦身**：B 轨「为什么」段 400 B（删 2026-09-20 完整轨迹，保留根因结论——轨迹留在 git log 与 `_shared/` 反哺报告）、L-33 段 200 B（脚本体与 exit 一览示例指针化）。净增 2.1 KB。**v18.11.0 显式抬升 82→91 KB（主人授权「根据反哺依次全部修订」）**：落地反哺报告 v2 的三条派发侧规则——F-4 通用派发前置条款「产出铁律」（治 T9/G14 子代理读盘后静默零产物）+ F-4\' T2 数据卡模板版本核验（治旧模板产出 → 31 条缺信任级别独立段 → M-Form-6 P0）+ F-5\' T5 字数上限铁律（治写手自设目标 → T7 判超任务简报目标 18.2%）；同步 M 门速查第 4 条（「承重」自本版起不再计入文末禁止词）。**v18.2.2 显式抬升 60→64 KB：补「段级 diff 字数回测硬约束」与「T5/T6/T9 派发用 M 门速查」；v18.2.5 显式抬升 64→65 KB：补「段级 diff 字数口径硬约束（纯汉字 = count-chars 同源）」与「审计视图刷新落盘留痕（status.md 可核对项）」；**v18.2.7 显式抬升 65→74 KB（主人授权修订）**：依 2026-09-20 全流程实战反哺，一处补 6 条硬约束——① 派发最小集补第 7 条「文末五节条目标签用论衡编号」（真源 `机检硬格式.md` §五 v18.2.2 已有该条，但最小集一直漏同步，实战第三次踩到：T5 四版全写 `[1]`-`[11]`，T7 三轮未抓出，直到 T8 才爆 P0）；② 段级 diff 加「预算闸门前置」（清单预估 16,987 → 实测 18,071，超限 1,271 字 → 被迫削 3 轮）；③ 加「素材加载清单刷新责任在段级 diff 模式下归主控」（与「T5 每轮覆盖写」机制直接冲突）；④ 加「清单须机器可读、优先用 apply-diff.mjs」（实战主控为此做约 52 处手工 edit）；⑤ T7 修订任务书加「验收方式」列（解「字面验收 vs 字数约束」死结）；⑥ T7 预检从 5 项扩为**全量 22 项 M 门** + 缺陷冻结机制（3 个零判断力 P0 漏到 T8、A 轨 2 轮用满仅 29% 完全关闭）；**v18.2.8 显式抬升 74→75 KB（主人授权「G14 早闸去掉」）**：流水线全景的 G14 行与派发话术段改为「三层防御、仅一次 spawn」。**已先做两轮瘦身**（删除依据移至 `gates/14` 单点持有），瘦身后仍超 150 B；剩余为 Phase 序列与派发话术本身，属 T0 启动必读的承重内容；**v18.5.1 显式抬升 75→78 KB（ai-content-farm-retractions 反哺：派发前 preflight 反注 + T6/T9 意见强制机械证据硬约束）**；**v18.7.1 显式抬升 78→79 KB（共锁反哺：T1 派发前自检 handoff-check）**；**v18.7.1 显式抬升 79→82 KB（借鉴 Ai4Scholar 落地 4 份反哺报告整合）**：§快速开始后加 §进阶用法 /lunheng 段（11 命令 + 借鉴说明）；§写手派发话术后加 v18.7.1 铁律（每条 [Lxx]/[Dxx] 必须含 vol.X, no.Y, pp.Z-Z 完整字段）+ §T3.5 派发话术段（auto_cite 预标注阶段）。属 T0 启动必读的承重内容，依据 v18.1.0「词预算预冲」原则显式抬升上限；目标（长期）维持 60 KB（已两轮瘦身）。**v18.18.0 显式抬升 94→95 KB（C 批审计 E-1/E-6/E-10/E-13）**：①E-1 §T6 派发话术的批判维度名由「五维（论点级/证据级/逻辑级/立场级/时效级）」改为 **06 卡七维原名 + 真源指针**——旧写法与 06 卡**不同名不符**，而 M-Exist-8 要求七节齐备（缺 >2 节 = P0）→ **照抄派发话术即 P0**；②E-6 L-33 由「尚未机械化」改为「已由 M-Exist-5 机械化（v18.12.0 补门）」；③E-10「简化直写档（<2000 字）」改「2000-3000 字」（与 SKILL.md 字数分层真源对齐）；④E-13 终检必查项由 11 条补为 **15 条**并把 §4.5 死指针改为 08 卡真源（原文声称「详见 §4.5」而本文件无该章节）。四项均为派发层/闸门层契约修正，T0 启动必读、无处可挪。'],
  // v18.12.0（L-67）：本文件因「1.3 退出码」段补两条同族收口说明而越过 12 KB 登记线 → 首次登记。
  'skills/lunheng-article-pipeline/references/_shared/M-Gate-Algorithm-appendix.md': [13312, 12288, 'M 门阈值与附录真源（仅 T7/T8 读）——**v18.12.0 首次登记（13 KB）**：本文件此前 11.5 KB（未达 12 KB 登记线），L-67 收口时在 §1.3 补两句「非闸门工具退出码」说明（`model-routing` / `token-budget` / `token-cost` 的用法错由 1 改 10）后越过登记线。补的这两句是**退出码撞码**的口径真源（读者按本表读码会误判内容失败），属承重内容、不挪他处。'],
  'skills/lunheng-article-pipeline/references/_shared/M-Gate-Algorithm.md': [98304, 79872, 'M 门伪代码（仅 T7/T8 读）——**v18.11.0 显式抬升 89→91 KB（主人授权「根据反哺依次全部修订」）**：落地反哺报告 v2 的 F-1「硬 P0 红线」段（4 类结构性缺陷不允许 T8 的 `_t8_llm_review` 兜底覆盖：文末节缺失 / 顺序错 / 漏引 >0 / 数据不完整；含量化判据 + 可兜底项白名单 + 反面教训），并同步阈值总表 `exist1ClosureP0` 条目（F-7 建议上调被回归测试驳回，实测值维持 10）。**v18.2.2 显式抬升 78→84 KB：补 6 处 v18.2.2 判定语义修订注记（M-Form-4/8/11 + M-Exist-2/10 + M-Integrity-1）；**v18.3.1 显式抬升 84→86 KB（第三方审计 B3）**：新增「阈值总表」生成块（24 个阈值键，由 m-gate-check.mjs `THRESHOLDS` 单向生成 + consistency-check ㉓ 逐键核对，消灭阈值数字与正文伪代码的双维护）；**v18.7.1 显式抬升 86→87 KB（共锁反哺：M-Exist-10 定位口径登记）**；**v18.7.1 显式抬升 87→89 KB（借鉴 Ai4Scholar 落地 4 份反哺报告整合）**：§M-Form-2 加 v18.7.1 卷期页码扩展段（4 项中至少 3 项必填 + 卷期页码正则 + DOI/URL fallback + 触发条件）；§M-Form-10 加 v18.7.1 T3.5 扩展段（auto_cite-补充.md 索引段核验）；§M-Exist-6 加 v18.7.1 G15 扩展段（任务简报 §引用数量与质量控制 → 审稿报告 6 维表格核验）。依据 v18.1.0「词预算预冲」原则显式抬升上限；目标（长期）维持 78 KB。**v18.12.0 显式抬升 91→95 KB（2026-09-25 全量审计第二梯队 L-44 + L-02/L-03/L-22）**：① §硬 P0 红线段补「实装状态」——该红线此前**只有规格没有实现**（`m-gate-check.mjs` 的注释宣称强制重审而代码里一行都没有），现落到三处（`hard_red_line_hits` 收集 / 落盘拒绝采纳 T8 裁定 / M-Exist-5 放行前置），规格必须与实装同址陈述；② §M-Exist-5 伪代码补「逐行绑定」四项（M 门 `exit N` 对账 / 有效裁定值必须为 0 / handoff exit 必写 / 路径存在性）与「修复前五条空洞」的完整记录（同一处门、互不重叠，是本次审计的核心发现）。**v18.12.0 显式抬升 95→96 KB（2026-09-25 全量审计 L-05 落地）**：§`_t8_*` 留痕要求新增第 4 条「写入方式」——两段必须经 `m-gate-check.mjs --adjudicate <json>` 正式通道写入（含裁定文件 schema、三条拒绝路径 exit 30、以及「进程退出码 = 裁定值」），并说明为什么必须走通道（此前无正式入口，实战项目自建脚本直接改 `rj.exit` → 产出 `exit=0` + `verdict_stale=true` 的自相矛盾交付物）。'],
  'skills/lunheng-article-pipeline/references/agents/00-主控-扩展职责.md': [57344, 50176, 'T0 实操手册（全库第二，闸门公共动作在此）——v18.2.2 显式抬升 49→52 KB：补「修订回环提前 Ack 判据」四类归因决策表；v18.2.9 显式抬升 52→53 KB（第三方审计 A12）：补「T8 人工裁定双签」（M-Form-8 / M-Integrity-2 亲裁定须独立复核，守住独立角色互为镜像）；**v18.6.0 后显式抬升 53→54 KB（整体审查收尾）**：补「收报验收」闸门公共动作（交接门 handoff-check，规格 §8 #3 补齐）；**v18.12.0 显式抬升 54→55 KB（2026-09-25 全量审计第三梯队 L-01）**：删除本卡内与全库定案冲突的「轮」的定义（旧文本把 B 轨 T6 算作第 1 轮，与 glossary 双轨制直接冲突；实测两个真实项目均按双轨制记账），改为指向 glossary 的**指针 + 删除理由**——指针化不会净减字节（旧定义一行换新说明数行），但消除了一处会误导轮次计数的独立定义**v18.18.0 显式抬升 55→56 KB（C 批审计 E-7）**：删除「T8 人工裁定双签」段（v18.2.9 A12）并写明取消理由——该机制要求 T8 初裁后**再派 subagent 独立复核**，而 T8 执行者就是主控本人（主控 = T0 调度 + T8 执行双身份），**等于让新上下文复核本人的判断**，与「T8 不 spawn 子代理」的既有定案直接冲突；其产物 `audits/T8裁定复核-vN.md` 在 08 卡终检 15 项中**本就不存在**，属孤儿机制。删除段为**指针化替换**（旧 1 段换新说明 1 段）故非净减。'],
  'skills/lunheng-article-pipeline/references/glossary.md': [37888, 32768, '术语表（含 §十二 刻意偏离，改机制前必读）——v18.5.1 显式抬升 32→34 KB（ai-content-farm-retractions 反哺：§12.1 正文字数单一真源 + §12.3 五节 vs 国标仲裁）；**v18.7.1 显式抬升 34→35 KB（借鉴 Ai4Scholar 落地）**：§核心角色新增 T3.5 文献补标注角色卡（可选阶段，auto_cite 预扫描）；§十一 关键术语新增「引用匹配度」（与 G15 审计项 + M-Exist-6 联动）。依据 v18.1.0「词预算预冲」原则显式抬升上限；目标（长期）维持 32 KB。**v18.12.0 显式抬升 35→36 KB（2026-09-25 全量审计第三梯队 L-21 + L-39）**：① §修订回环的 B 轨口径由「不限额」改为「**至多 +1 深化轮**」（全库统一，旧写法与 `pipeline-readme.md:785` 直接冲突）+ 口径统一说明；② §十二「一事实一处」行更正 mechanical coverage 数字（旧写「21 类」，脚本自述为 23 类 + 5 子规则）并如实补「本门只能抓集合/计数/版本点位/字符串四类漂移，**抓不到语义级事实**」这一已知边界**v18.18.0 显式抬升 36→37 KB（C 批审计 E-11/E-12/E-15）**：①E-15「一事实一处」行的规则数由「23 类」校正为「**①-㉕ 共 24 类主规则 + 5 子规则**」，并把「全库规则编号止于 ⑳」这一**已为假**的断言改为**指向脚本头清单**（㉔/㉕ 实装后失准）；②E-11 G 清单由「G0-G14（15 项）」改为「**G0-G14 主项（14 项硬门）+ G15 模式相关项**」；③E-12 空卡标识统一为 `[C-空]`（旧文写「[空卡]」，机检只认 `[C-空]`）。三处均为口径收口，改完本文件是全库该类事实的单一真源。'],
  'skills/lunheng-article-pipeline/references/agents/05-写作-writer.md': [58368, 36864, '**外部机制借鉴批 2（2026-09-26）显式抬升 56→57 KB（主人指令「启动批2」= AGENTS.md 例外条款授权）**：§视角与精度铁律 新增第 4 条「因果主张的强度纪律」——案例研究型须 ≥1 处显式反事实推理 + ≥1 条可证伪预测；强档因果词只在能指回识别策略时使用（与 `apply-diff.mjs` 的 `causal_upgrades` 三档**守恒**分工：机械只守恒、语义判定归本条）。T5 写手卡——**v18.11.0 补登记 52→55 KB（主人授权「依次全部都做」）**：v18.10.0 落地 12 项战略改进时本卡增长但未同提交抬棘轮（违反 v18.1.0），发布后 `repo-hygiene-check` 即为红；本次补登记实测值。**瘦身待办**：§「🚫 元数据泄露词表」28 行与 M-Form-4/5 黑名单同源，可改为指针 + 真源（`机检硬格式.md`）持有。v18.2.5 显式抬升 36→38 KB：补「段级 diff 字数口径与 count-chars 同源（两侧汉字计数）」+「图位编号 = 正文出现顺序，禁照抄大纲编号」两条硬约束；**v18.2.8 显式抬升 38→39 KB（主人授权「G14 早闸去掉」）**：F 自检 7 项 → 7+1 项，新增「G14 v1 自检」（早闸删除后由写手在写作阶段承担第 1 层检测）；**v18.3.0 显式抬升 39→40 KB（G 体系机械下沉）**：写作规范新增「删优于改（Prefer CUT over REWRITE）」一条（借鉴 Writing Guard）；**v18.7.1 显式抬升 40→45 KB（共锁反哺：G14 实测铁律 / 图位编号 / 幽灵引用 / 双口径字数 / 元数据红线 / 修订说明等量覆盖 四组补丁）**；**v18.9.0 显式抬升 45→52 KB（数字社交-关系重构项目实战反哺 v18.8.x + v18.9.0 两轮承重）**：①字数估算 +20% buffer 段（治 LLM 估算 1.44x 偏差，v18.8.x 反哺）——含边界 / 实战教训 3 轮 / 机检留痕 3 项；②「🚫 元数据泄露词表」段（v18.9.0 反哺，与 M-Form-4/5 黑名单同源）——含词表 28 行 / 判定 3 类 / 文末五节白名单 1 类 / AI 使用声明 1 处豁免。两条均为实战反哺的承重内容（不挪 references/），按「同一次提交显式抬升」原则同步抬上限；目标（长期）维持 36 KB（v18.9.1 起考虑瘦身）。**v18.12.0 显式抬升 55→56 KB（2026-09-25 全量审计响应 L-17 + L-20）**：① §铁律 9「文末节顺序」改写为「必需五节 + 可选四学术声明」两层，并补机检真源指针（`_lib/sections.mjs` 的 `ENDNOTE_ORDER`）——旧文本只列五节，而 v18.10.0 起本节已要求写四声明，两处口径互斥（照规范写必被 M-Form-7 判 P0）；② §四声明自检三连更正两处错标：「M-Form-7 文末五节顺序扩面到七节」（既非五节也非七节）与「机检 M-Form-12 子门」（M 门编号体系内不存在该门，属假绿）。'],
  'skills/lunheng-article-pipeline/references/_shared/DSH-集成方案.md': [29696, 25600, 'DSH 能力面集成：§七 落地状态 + §八 preset 配方 + §九 运行环境限制（v18.1.0 扩容，新进预算表）——v18.2.2 显式抬升 25→28 KB：新增 §九「Windows sandbox --temp 前置目录缺失」现象 + 四条替代路径 + 主控操作纪律；**v18.6.3 显式抬升 28→29 KB**：DSH 集成方案同步（v18.6.3 落地时回填具体子项）'],
  'skills/lunheng-article-pipeline/references/agents/07-审计-auditor.md': [35840, 22528, 'T7 审计卡——**v18.12.0 显式抬升 33→34 KB（2026-09-25 全量审计第七梯队 L-27）**：§「M 门预检」的清单由 **5 项**（M-Form-3/4/5/7/8）改写为**全量 22 项 + M-Form-4 人工补扫**。旧清单按「判断力要求低」选，却恰好漏掉三个**零判断力、后果最重**的项（M-Form-9 图件闭环 / M-Exist-1 引用双向闭环 / M-Form-11 素材清单）——2026-09-20 实战中这三项**一路漏到 T8** 才被脚本抓出，此时 A 轨已封盘，只能进 `final/局限性.md`。本卡优先级高于派发话术（`pipeline-readme.md:351`），故漏项必须在卡内修正而非只改话术。**同批已先瘦身**：删去卡内与 `pipeline-readme.md` 重复的「为什么扩全量」完整论述（保留一行结论 + 指针），并删去与 `_shared/M-Gate-Algorithm-appendix.md` 重复的 5 项阈值速查表（改为指针）。**v18.11.0 补登记 28→33 KB（主人授权「依次全部都做」）**：v18.10.0 落地 12 项战略改进时本卡增长但未同提交抬棘轮（违反 v18.1.0），发布后即为红；本次补登记实测值，并叠加本次反哺落地（新增「提议写法：稿件侧优先」元规则段——4 条被回归测试驳回的实测教训 + 判据）。**瘦身待办**：§「G 项实据最小样板」的 5 类形态 + 模板可下沉到 `_shared/` 按需加载。v18.5.1 显式抬升 22→23 KB：修订任务书新增「违反规范」列 + 「怎么改」列处置动作动词前缀（补/删/改/降级），借鉴 writing-guard rule/action 分离（反哺报告-writing-guard借鉴-v1 动议一）；**v18.7.1 显式抬升 23→24 KB（共锁反哺：铁律加 T6 交叉验证）**；**v18.9.0 显式抬升 24→28 KB（数字社交-关系重构项目实战反哺）**：①「与 T6 批判的职责边界」段（v18.9.0 反哺 P1-1，治 T6/T7 重叠攻击同一论点）——含 12 行职责分工表 + 判定边界 + 重叠项终判口径；②「G 项实据最小样板」段（v18.9.0 反哺 P0-3，治 M-Exist-9 = P2 软提示「9/15 项 G 项结论无实据」）——含实据形态清单 5 类（路径 / 素材编号 / §+行号 / 带量词数字 / M-Gate-Report exit code）+ 判定 3 类 + 写作模板 1 个。两条均为实战反哺的承重内容（M 门契约源头 / 不挪 references/），按「同一次提交显式抬升」原则同步抬上限；目标（长期）维持 22 KB（v18.9.1 起考虑瘦身）。**v18.18.0 显式抬升 34→35 KB（C 批审计 E-5/E-8）**：①E-5 承重墙超载阈值由「4 论点以上 = P0」改为「**≥3 = 超载 P1 / ≥4 = P0**」+ 真源指针（原写法与 `M-Gate-Algorithm.md` 的「同一证据被 ≥3 论点标承重 = 超载」逐字冲突，卡面比机检更宽 → 人工复核会放过机检该报的超载）；②E-8「M 门契约」段补**命名空间澄清**（本脚本三检属 `methodology-check.mjs` 自有命名空间、加 `MC-` 前缀，不是 M 门体系编号——M 门总 23 项内无 M-Form-12）。'],
  'skills/lunheng-article-pipeline/references/memory/lessons.md': [19456, 19456, '教训库（只增，需定期合并同类项）'],
  'skills/lunheng-article-pipeline/references/_shared/audit-checklist-quickref.md': [14336, 10240, '审计必查项快速参考——**v18.11.0 显式抬升 12.5→14 KB（主人授权「根据反哺依次全部修订」）**：F-3 在 §G8 字数偏差核验下新增「字数判定渐进式警告」（`<11,000` 完美 / `11,000-11,550` 通过 / `11,550-12,000` 警告 / `>12,000` 阻塞），协调 v18.10.0「+20% buffer」与原 G5 单点阻塞线的口径冲突。**v18.7.1 首次登记（借鉴 Ai4Scholar v2.9.4 落地）：§必查项尾部新增 G15 引用匹配度（任务简报 §引用数量与质量控制 字段核验：引用数区间 / 优先同刊比例 / IF 门槛 / 卷期页码完整率 / auto_cite 替换率 + 修订任务书条目联动）。依据 v18.1.0「词预算预冲」原则显式登记上限；目标（长期）维持 10 KB。'],
  'skills/lunheng-article-pipeline/references/templates/任务简报-template.md': [26624, 19456, '**外部机制借鉴批 2（2026-09-26）显式抬升 25→26 KB（主人指令「启动批2」= AGENTS.md 例外条款授权）**：Phase 0 可选项增两条——「**案例研究型 / 质性论文**」（触发识别策略 + 反事实条件 + 可证伪预测必填，未声明 → T9-m M3 判 P1）与「**启用对抗视角 T9-v / T9-i**」（写明参谋性质：不产 P0/P1、不进判定词、不得触发 T5 修订轮）。任务简报模板（full 版）——v18.2.2 显式抬升 19→21 KB：① 补「字数判定层级强制显式勾选 + 与 G5 硬阈的关系澄清」；② 补「GB/T 7714 只约束著录格式、不约束标签形态」正误形态对照（第二处抬升，20480→21504）——**v18.5.1 显式抬升 21→22 KB（ai-content-farm-retractions 反哺：「需找数据点 vs 需找案例」标签口径说明）**；**v18.7.1 显式抬升 22→24 KB（借鉴 Ai4Scholar 落地 4 份反哺报告整合）**：§引用格式段后追加 §引用数量与质量控制 字段（目标引用数 / 目标期刊 / IF 门槛 / JCR 分区 / 优先同刊 / auto_cite 替换预算）+ §卷期页码完整性 段；§v2.5.0 可选项追加 3 个新勾选项（APA 优先输出 + T3.5 + /lunheng）。依据 v18.1.0「词预算预冲」原则显式抬升上限；目标（长期）维持 19 KB。**v18.18.10 显式抬升 24→25 KB（E 族 E-14）**：§启用期刊匹配 勾选说明里的「（25 中文 CSSCI + 12 英文 SSCI 数据库，…）」改为「（中文 CSSCI + 英文 SSCI 期刊库，**规模真源 = `期刊数据库.md` 表行数**，本模板不写死数字；…）」——原文写死 25 而真源表实为 28，属 E-14「四处写死规模」的其中一处。改指针比删数字略长（+约 40 B），且改后余量仅 254 B——按本文件既有的「不许把棘轮停在距上限数十 B」原则抬到 25 KB（余量约 1.2 KB）。'],
  'skills/lunheng-article-pipeline/references/agents/06-批判-critical-companion.md': [24576, 17408, 'T6 批判卡——**v18.6.3 显式抬升 17→18 KB**：补 T7 互不搬运清单 / 校对协议深化（v18.6.3 落地时回填具体子项）；**v18.9.0 显式抬升 18→24 KB（数字社交-关系重构项目实战反哺 v18.8.x + v18.9.0 两轮承重）**：①「豁免规则：任务简报 Phase 1.5 trigger=false 项不主动攻击」段（v18.8.x 反哺，治 T6 攻击 trigger=false Permanent Gap → T5 v2/v3 写防御性文字字数膨胀 1.4x）——含触发条件 / 豁免范围 / T6 行为 3 项 / 3 类例外触发 / 机检判别 / 实战教训（数字社交-关系重构 4 项 Permanent Gap 完整链）；②「与 T7 审计的职责边界」段（v18.9.0 反哺 P1-1，治重叠审）——含 12 行职责分工表 + 重叠项处理。两条均为实战反哺的承重内容（教训细节不可丢，不挪 references/），按「同一次提交显式抬升」原则同步抬上限；目标（长期）维持 17 KB（v18.9.1 起考虑瘦身）。'],
  'skills/lunheng-article-pipeline/references/deliverables.md': [22528, 16384, '交付边界 + F1-F9 + 闸门（按需加载）——v18.2.1 显式抬升 16→17 KB：补「文末编号必须沿用素材卡真编号」硬要求；**v18.12.2 显式抬升 18→21 KB（2026-09-25 L-06 定案）**：新增 §「产物 `-vN` 的 N 跟谁走」——七类版本化产物的 N 语义表 + 「审的是哪一版」的两载体（报告头 `被审正文:` 声明 / M 门 `verdict_scope`）+ 三条机械校验（A4b/A4c）+ 实测依据（22 项目账本）。该节是**七类产物 N 语义的唯一真源**，删不得。**v18.12.0 显式抬升 17→18 KB（2026-09-25 全量审计响应 L-17）**：「定稿文末白名单」由“只允许 5 节”改写为「必需 5 节（M-Form-2 存在性）+ 可选 4 学术声明（仅 M-Form-7 成员/顺序）」两层表 + 机检真源指针——旧表述与 v18.10.0 起写手卡要求的「文末九节」互斥，学术稿照规范写必被 M-Form-7 判 P0 且该门不可兜底（实测 exit=2）**v18.18.0 显式抬升 21→22 KB（C 批审计 E-4）**：§修订回环的「轮」定义由**独立定义**改为**指向 glossary 双轨真源**（A 轨 = 审计打回轮 ≤2 轮 / B 轨 = 主控触发轮至多 +1 深化），v2.3.1 旧口径（把 T6 批判与审计打回混在同一计数轴）降级为**历史注记 + 已作废声明**——原写法与 glossary 直接冲突，两个真实项目均按双轨记账。**同批已先瘦身**：历史注记由「原文 4 条 + 背景段」压成 1 行（约 -400 B）。'],
  'skills/lunheng-article-pipeline/README.md': [16384, 15360, '技能目录 README（人类入口）——**v18.6.3 显式抬升 15→16 KB**：v18.6.3 同步（v18.6.3 落地时回填具体子项）'],
  'skills/lunheng-article-pipeline/QUICKSTART.md': [16384, 15360, '快速开始——v18.2.9 显式抬升 15→16 KB（第三方审计「Step1 手写简报与 Phase 0 协议路径冲突」）：Step 1 补一句与 Phase 0 的关系澄清，消除两处生成简报的歧义'],
  'skills/lunheng-article-pipeline/references/agents/04-分析-analyst.md': [24576, 14336, '**外部机制借鉴批 2（2026-09-26）显式抬升 23→24 KB（主人指令「启动批2」= AGENTS.md 例外条款授权）**：新增 §13「识别策略与反事实（案例研究型必填）」——质性识别策略五选一（process tracing / congruence testing / counterfactual / most-similar-most-different / 统计推断）+ 每个承重论点的反事实条件 + ≥1 条可证伪预测；这正是批 2 的 A1 落点（本地定量参数门与 `--humanities` 豁免之间的空档）。**外部机制借鉴批 1（2026-09-26）显式抬升 21→23 KB（主人指令「立即执行」= AGENTS.md 例外条款授权）**：两处新增——① §原创性声明内补「理论贡献三层声明（概念 / 机制 / 预测）+ 贡献层级自评（L1-L4）」（T4 是层级判定的**源头**，T6 C3 与 T9 原创性维度均据它复核）；② 新增 §12「学科对话点（可选，任务简报勾选启用）」。本卡利用率曾为全库最高（129%），抬升同时重申**瘦身待办**：§11 精简段字段对位表可改指针。T4 分析卡——**v18.11.0 补登记 16→21 KB（主人授权「依次全部都做」）**：v18.10.0 落地 12 项战略改进时本卡增长但未同提交抬棘轮（违反 v18.1.0），发布后即为红；本次补登记实测值。**瘦身待办**：本卡已到 **129%** 利用率（超限比例全库最高），是下一轮瘦身的首要目标——§11 精简段字段对位表可改指针。v18.2.5 显式抬升 14→15 KB：补「建议图表编号 = 预计正文出现顺序」（不确定时显式授权 T5 重排）；**v18.9.0 显式抬升 15→16 KB（数字社交-关系重构项目实战反哺 P1-2）**：补「§11 写手精简段与修订说明字段对齐表」段——含 6 要素字段对位表（论证主线 / 论点-论据映射表 / 反方规划要点 / 字数预算 / 禁做项 / 承重墙清单）+ 机检判别（M-Exist-10 子门 ≥5 项对位 = 通过）+ 机检留痕。属实战反哺的承重内容（M-Exist-10 契约源头 / 不挪 references/），按「同一次提交显式抬升」原则同步抬上限；目标（长期）维持 14 KB（v18.9.1 起考虑瘦身）。'],
  'skills/lunheng-article-pipeline/references/_shared/机检硬格式.md': [14336, 12288, '机检硬格式（**v18.11.0 补登记 13→14 KB（主人授权「依次全部都做」）**：v18.10.0 增长未同提交抬棘轮，本次补登记。）（模板 ↔ m-gate-check.mjs 的排版契约，唯一真源）——v18.2.5 新增登记（原 11.5 KB 越过 12 KB 登记线）：补「期刊匹配输入来源须逐行标注」与「非标准编号黑名单」口径'],
  'skills/lunheng-article-pipeline/references/agents/01-文献检索-literature-scout.md': [18432, 12288, '**外部机制借鉴批 1（2026-09-26）显式抬升 17→18 KB（主人指令「立即执行」= AGENTS.md 例外条款授权）**：新增 §「最新进展补扫（T1b 增量）」段（近 6 个月新进展 → `[L-pre]` 可选索引 + 未做须在交接报告声明 + T7 判 P2 的判别口径）——属**按需加载的可选增量**，长期目标维持 12 KB。T1 文献检索卡（**v18.11.0 补登记 16→17 KB（主人授权「依次全部都做）」**：v18.10.0 增长未同提交抬棘轮，本次补登记。）——**v18.9.0 首次登记（数字社交-关系重构项目实战反哺 P0-1）**：原 11.5 KB（未达 12 KB 登记线），v18.9.0 反哺 P0-1「卷期页码双写契约」段使其增 1.6 KB → 越过 12 KB 登记线。含契约（期刊 [J] / 专著 [M] / 电子资源 [EB/OL] 三类必填字段）+ 强制双写（专著 ISBN + DOI 双字段）+ 机检判别（M-Form-2 v2 分支报 P1）+ 协作（M-Gate-Algorithm.md）。属实战反哺的承重内容（M 门契约源头 / 不挪 references/），按「同一次提交显式登记」原则新增 + 抬上限；目标（长期）维持 12 KB（v18.9.1 起考虑瘦身）。'],
  'skills/lunheng-article-pipeline/references/agents/02-数据检索-data-scout.md': [13312, 13312, 'T2 数据检索卡'],
  'skills/lunheng-article-pipeline/references/agents/03-案例检索-case-scout.md': [13312, 13312, 'T3 案例检索卡'],
  'skills/lunheng-article-pipeline/references/agents/09-审稿-peer-reviewer.md': [37888, 13312, '**外部机制借鉴批 2（2026-09-26）显式抬升 32→37 KB（主人指令「启动批2」= AGENTS.md 例外条款授权）**：两处新增——① §T9-m 的 M3「因果推断合法性」加**质性路径**（识别策略声明 + 证据链可追溯 + 替代解释逐条排除 + 反事实 + 可证伪预测），并补「**刻意不加机检**」的理由（正则会因「本文用案例研究法」一句判合规 = 假绿）；② 新增 §「🎭 可选对抗视角（T9-v 立场 / T9-i 国际）」——**参谋性质**：不产 P0/P1、不进 accept/minor/major/reject、**不触发 T5 修订轮**，三条硬边界写在段首。T9 审稿卡——**v18.11.0 补登记 24→31 KB（主人授权「依次全部都做」）**：v18.10.0 落地 12 项战略改进时本卡新增 §「🎯 三视角审稿模式」等约 100 行（P0-2 改进：T9-d 领域专家 / T9-m 方法学家 / T9-s 统计学家 三视角并行 + 整合员协议 + 派发契约 + 与 6 维评分框架的关系），但**未同提交抬棘轮**（违反 v18.1.0），发布后即为红；本次补登记实测值。**瘦身待办**：三视角的三份结构化清单（T9-d/m/s 各 6-8 项，约 55 行）是**按需加载**的典型候选——可下沉到 `references/checkers/` 新文件，本卡只留判据与指针；但该动作会连带派发话术与 T9 读取路径，宜独立提交。v18.2.1 显式抬升 13→14 KB：补 M-Exist-6 六维机检契约警示（防派发时改写维度名）；**v18.2.7 显式抬升 14→18 KB（主人授权修订）**：依 2026-09-20 全流程实战反哺，补三处——① **修本卡内部矛盾**：§when 写「T9 只能在 T7 审计后」而 §exclusions 写「❌ T7 审计后（已晚）」，同一张卡两处直接冲突（v2.4.0 引入 G14 时点漂移时的遗留），现删除错误项并注明正确时点；② 新増铁律「我是参谋层，不是交付闸门」——判定词 accept/minor/major/reject 借自真实同行评审、天然带程序效力暗示，若机制不写明「T9 不阻塞交付」，主控在 A 轨用满时读到「major revision」可能被迫多跑一轮；③ 格式骨架补「综合匹配度」**表的字面样例**（此前只有文字说明 → T9 按卡产出自然语言段落 → M-Exist-6 判 P1）；**v18.5.1 显式抬升 18→19 KB（writing-guard 借鉴反哺 v1，动议二+动议一）**：扩写清单扩为「字数+文体偏差」双维度 + 建议段 rule/action 分离（违反规范 + 处置动作）；**v18.6.3 显式抬升 19→20 KB**：补 M-Exist-6 批处理契约 / 拒吞项源头（v18.6.3 落地时回填具体子项）；**v18.9.0 显式抬升 20→24 KB（数字社交-关系重构项目实战反哺 P1-3）**：补「LLM 补充行契约」段——含背景（3 条 LLM 补充期刊漏标注风险）/ 强制契约（含「LLM」「补充」「不在数据库」「人工核验」四关键词）+ M-Exist-6.5 子门判定 + 正面/反面示例。属实战反哺的承重内容（M-Exist-6.5 契约源头 / 不挪 references/），按「同一次提交显式抬升」原则同步抬上限；目标（长期）维持 13 KB（v18.9.1 起考虑瘦身）。**v18.18.0 显式抬升 31→32 KB（C 批审计 E-8）**：四处审稿检查项（D5/M4/S1/S3）引用的机检名由 `M-Form-12`/`M-Exist-11`/`M-Exist-12` 改为 **`MC-Form-12`/`MC-Exist-11`/`MC-Exist-12`** 并注明「自带命名空间前缀，与 M 门体系编号不共用」——旧名与 M 门机械项**数字撞号**，T9 按卡引用会让读者以为存在这些 M 门项（实际 M 门总 23 项内没有），属跨卡命名空间污染。'],
  'skills/lunheng-article-pipeline/references/checkers/中文AI痕迹-checker.md': [15360, 12288, 'G14 检测器契约（checker 侧）——**v18.2.6 新增登记**：本轮修订把 G14 触发时点统一为「早闸 Phase 3.6 与 T6 同批 / 终闸 Phase 4.5 与 T9 并行」（旧文写「早闸 Phase 3.1」「终闸与 T6 并行」，后者在时序上不可能），文件由 11.5 KB → 12.0 KB **越过 12 KB 登记线**，故按规则⑨ ① 补登记；**v18.2.8 显式抬升 13→14 KB（主人授权「G14 早闸去掉」）**：§when 重写为「三层防御、仅一次 spawn」，并新增 §exclusions「Phase 4.5 之前的任何时点不得 spawn」。**已先做两轮瘦身**（把删除依据的三条理由移出、只留指向 `gates/14` §触发阶段注的指针），瘦身后仍超 400 B；剩余内容为规则性定义（三层各自的执行者与产出），无法再压缩而不损可执行性；**v18.6.3 显式抬升 14→15 KB**：G14 检测器边例扩充（v18.6.3 落地时回填具体子项）'],
  'skills/lunheng-article-pipeline/references/_shared/规范-机械门对照表.md': [36864, 16384, '**独立全量审计（2026-09-26）显式抬升 35→36 KB（主人指令「依次全部修订」= AGENTS.md 例外条款授权）**：§一 新增 2 行勾稽——① /lunheng 命令枚举完整性（规则 ㉕ 扩展：核数字→核清单）；② lunheng-commands 子技能版本一致性（规则 ㉖：三件套 1.0.x 交叉核对）。两行都是「断链→补门」的状态变更登记，本表的存在意义即这一步。**外部机制借鉴批 2（2026-09-26）显式抬升 34→35 KB（主人指令「启动批2」= AGENTS.md 例外条款授权）**：§三 再增 2 行（识别策略与反事实 / 可选对抗视角 T9-v·T9-i），均如实标注「无门 + **刻意不加门的理由**」；对抗视角一行并写明「机检既不核它跑没跑、也不核结论质量 → **绝不能被当作交付质量的证据**」。**外部机制借鉴批 1（2026-09-26）显式抬升 31→34 KB（主人指令「立即执行」= AGENTS.md 例外条款授权）**：§三 新增 5 行勾稽（理论贡献三层声明 / 学科对话点 / 最新进展补扫 `[L-pre]` / G14 按章命中定位表 / 人类决策链汇总），其中 3 行如实标注「无门或部分覆盖 + **刻意不加门的理由**」——本表的存在意义就是这一步（防「条文无落地路径」，教训 #139），故按「同一次提交显式抬升」原则抬高。规范条文 ↔ 机械门 ID 对照表（改机制前须同步的一览）——**v18.12.3 显式抬升 30→31 KB（审计 L-07 / L-09 / L-11 三项落地）**：新增三行勾稽——① **Phase 序列两处维护必须自洽**（✅ 已机械化：`consistency-check` 规则 **㉔**，流水线全景 Phase ⊆ 速查表序列）；② **`M-Gate-Report` 文件名形状**（✅ 已机械化：规则 **②c** 形状白名单，旧 ②b 只认两个字面量、实测 5 种变体全部绕过）；③ **M 门 `exit=3` 逐条明细**（⚠️ 形式已定、**机械门刻意未加**并写明理由：真判据是语义比对）。三行都是「规范侧有了、执行侧补上/不补并说明」的状态变更登记——本表的存在意义就是这一步，按 v18.1.0「同一次提交显式抬升」原则抬高；抬升后留 ~250 B 余量。**v18.12.2 显式抬升 28→30 KB（2026-09-25 L-06/L-08/L-25 三案）**：新增三行勾稽——产物 `-vN` 的 N 语义门、人在环四门「必须」门、运行期读物不得指向 `docs/`·`examples/`（末者如实标「部分机械化」）。本表的存在意义就是这一步。**v18.12.0 显式抬升 26→28 KB（2026-09-25 全量审计收口批）**：新增两行勾稽——① **T7 必跑的三个战略门脚本**（`structure-check` / `methodology-check` / `cite-coverage`）由「❌ 无门·待补」改为「✅ 已补门」（M-Exist-5 判 T7.5 记录的留痕档位：零留痕 P1 / 部分 P2 / 无 exit P2）；② **证据包清单**（`manifest.json` 逐文件 sha256 + 被审正文指纹）由「内容全公开、改了没人知道」改为「M-Exist-2 复算，篡改/空降 → P0」。两行都是**断链→补门**的状态变更登记，本表的存在意义就是这一步，故按「同一次提交显式抬升」原则抬高；抬升后留 ~750 B 余量。v18.2.2 新增登记；v18.2.4 显式抬升 16→17 KB：补 3 行断链；v18.2.5 显式抬升 17→22 KB：补 7 行（门补面与同步本表是同一件事的两半）；v18.3.0 显式抬升 22→23 KB（G 体系机械下沉）：补「因果强度守恒（apply-diff causal_upgrades）+ 裸断言段（M-Form-8 子项）」两行勾稽；**v18.7.1 显式抬升 23→24 KB（共锁反哺：§11 标题唯一性 + 闸门记录裸竖线 两行假阳性登记）**；**v18.12.0 显式抬升 24→26 KB（2026-09-25 全量审计响应 L-17 + L-20）**：新增三行勾稽——① 文末九节白名单（「先有规范、无门」→ 本次补齐 M-Form-7 九节断言）；② 四声明档位勾选（**无门**，原「T7 跑 M-Form-12 子门」系假绿，已改判「T7 人工核验」）；③ `methodology-check.mjs` 的 M-Form-12 / M-Exist-11 / M-Exist-12 命名空间撞号登记（`M-Exist-11` 在本表指「局限性门」、在该脚本指「统计-数据匹配」）。'],
  // 外部机制借鉴批 1（2026-09-26）：G14 门文件因 §五 报告输出补第 6 条必含字段而越过 12 KB 登记线 → 首次登记。
  'skills/lunheng-article-pipeline/references/gates/14-中文AI痕迹-gate.md': [13312, 12288, 'G14 中文 AI 痕迹闸门定义（8 类维度 / 三层防御 / 判定规则 / D 类口径 / 报告输出）——**外部机制借鉴批 1（2026-09-26）首次登记（13 KB；主人指令「立即执行」= AGENTS.md 例外条款授权）**：本文件此前 12220 B（距 12 KB 登记线仅 68 B，任何增补都会越线），本次在 §五「报告输出」补第 6 条必含字段「**按章命中定位表**」（章名 / 该章汉字数 / 命中类别 / 命中条目与行号；**只报可核查事实、不出「AI 痕迹密度」类分数**）后越过门限，按 v18.1.0 规则⑨ ① 补登记。'],
  'skills/lunheng-article-pipeline/references/maintainers.md': [13312, 16384, '维护者向背景资料（rank 考证 / guard 已知边界 / 更正史 / 发布面事实）——**运行期角色不读**。**v18.15.0 首次登记**：新增 §七「收口批固定动作：差集 + 反向核验」（主人指示「固化为固定动作」），含两次自证后的实现细节与**边界如实声明**（只报「需人工回核」，不判「已完成」）。本文件此前未达 12 KB 门限故未登记；本次跨过门限，按 v18.1.0「同一次提交显式抬升/登记」原则补登。目标（长期）维持 16 KB。'],
}
const ALWAYS_RESIDENT = [
  'skills/lunheng-article-pipeline/SKILL.md',
  'skills/lunheng-article-pipeline/AGENTS.md',
]
// 常驻集合计上限（v18.1.0 由 51200 抬升：C 组四处机制事实入 SKILL.md/AGENTS.md）
//   **v18.12.0 显式抬升 57344 → 60416（全量审计收口批）**：SKILL.md 抬到 37 KB（理由见上）后，
//     常驻集合计实测 **57234 B**，距 57344 B 仅 **110 B** —— 与 v18.2.7 那次「99.8% 利用率 ≈ 等效
//     禁止再写」同形。合计上限的**目的**是防「瘦 SKILL、肥 AGENTS 换口袋」，不是把两个文件各自
//     的合法余量卡死；故随 SKILL.md 同步抬升，保持与逐文件上限同级的余量（AGENTS.md 自身未增长，
//     仍为 20457 B / 上限 21504 B）。**瘦身待办不变**：常驻集长期目标仍为 51200 B。
//   **v18.11.0 显式抬升 54272 → 57344**：① **补登记**——v18.10.0 落地 12 项战略改进时 SKILL.md 增长但
//     **未同提交抬棘轮**（违反 v18.1.0），发布后即为红；改前实测**常驻集合计 54334 B，超限 62 B**。
//     ② **本版新增**一行版本增量摘要（依「注解聚合」约定：单行 + 指针，细节归 CHANGELOG §18.11.0）→
//     合计 **55599 B**。按 v18.1.0「同一次提交里显式抬升并写明理由」原则抬高，**不采用「删既有机制
//     说明」腾空间**（那会以丢失机制事实为代价）；抬升后留 ~1.7 KB 余量，防重演「距上限仅数十 B ≈
//     等效禁止再写」的失效态（v18.2.7 先例）。**瘦身待办不变**：常驻集长期目标仍为 51200 B（v18.1.0
//     原始值），须把 SKILL.md 的运行期非承重段继续外移。
//   **v18.2.7 由 53248 抬升到 54272（主人授权修订）**：改前实测常驻集合计 **53222 B**，距上限仅 **26 B**
//   ——即该约束已处于 99.95% 利用率，实际等效于「禁止再向 SKILL.md 写任何内容」。而本次新增
//   `scripts/segment-chars.mjs` 后，**规则 ⑩（随包脚本白名单集合一致性）强制要求**把新脚本名写进
//   SKILL.md 的白名单行——该写入**不可回避**（不写则规则 ⑩ 判 P1「白名单漏列」）。故按「同一次提交里
//   显式抬升并写明理由」原则抬高 1 KB，不采用「删既有机制说明」来腾空间（那会以丢失机制事实为代价）。
const ALWAYS_LIMIT = 60416

const budgetBad = []
let docOver = 0
let residentTotal = 0
for (const [rel, [limit, target, why]] of Object.entries(DOC_BUDGET)) {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) { fail('doc-budget', `词预算表登记了不存在的文件：${rel}（表已过期，请删除该行）`); continue }
  const size = statSync(abs).size
  if (ALWAYS_RESIDENT.includes(rel)) residentTotal += size
  const pct = ((size / limit) * 100).toFixed(0)
  if (size > limit) {
    docOver++
    fail(
      'doc-budget',
      `${rel} 已达 ${size} B（${kb(size)}），超出上限 ${limit} B（${kb(limit)}）——「${why}」。` +
        `两条合法出路：① **先瘦身**（把细节移到按需加载的 references/，本文件只留指针与判据）；` +
        `② 若确需增长，在**同一次提交**里把 repo-hygiene-check.mjs 的 DOC_BUDGET 上限抬到 ≥${Math.ceil(size / 1024) * 1024} B 并在 CHANGELOG 写明为何必须增长。` +
        `目标（长期）${target} B（${kb(target)}），当前 ${pct}% 用了上限。`,
    )
  } else if (limit - size < 256) {
    // 余量 < 256 B：下一次改动几乎必然撞上限——提前在 note 里点名（上限按整 KB 取，故余量恒在 0–1023 B）
    budgetBad.push(`${rel} 余量仅 ${limit - size} B`)
  }
}
// 覆盖：技能目录内 ≥ 阈值的 .md 必须登记（否则新胖文档可无声进入上下文成本）
const unregistered = []
const skillAbs = join(ROOT, 'skills', 'lunheng-article-pipeline')
if (existsSync(skillAbs)) {
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (e.name.endsWith('.md')) {
        const rel = relative(ROOT, f).split(sep).join('/')
        if (statSync(f).size >= DOC_BUDGET_MIN && !DOC_BUDGET[rel]) unregistered.push(`${rel}（${kb(statSync(f).size)}）`)
      }
    }
  }
  walk(skillAbs)
}
if (unregistered.length) {
  fail('doc-budget', `技能目录内 ≥${kb(DOC_BUDGET_MIN)} 的文档未登记词预算：${unregistered.join('；')}——请在 DOC_BUDGET 加一行（含上限与理由）`)
}
if (residentTotal > ALWAYS_LIMIT) {
  fail(
    'doc-budget',
    `常驻集（SKILL.md + AGENTS.md）合计 ${residentTotal} B（${kb(residentTotal)}）超上限 ${ALWAYS_LIMIT} B（${kb(ALWAYS_LIMIT)}）` +
      '——这两个文件是每次会话的固定开销，不能用「此消彼长」绕开逐文件上限。',
  )
}
notes.push(
  `⑨ 词预算：登记 ${Object.keys(DOC_BUDGET).length} 个文档（≥${kb(DOC_BUDGET_MIN)} 全覆盖，未登记 ${unregistered.length} 个）` +
    `；常驻集合计 ${kb(residentTotal)}/${kb(ALWAYS_LIMIT)}（SKILL.md + AGENTS.md）` +
    (docOver ? `；❗ 超限 ${docOver} 个` : budgetBad.length ? `；⚠️ 接近上限：${budgetBad.join('、')}` : '，均在预算内'),
)

// ⑩ 注解密度门（v18.8.0 新增，P2 文档瘦身战役的「防再膨胀」机制）：
//    全量审计（v18.7.1）实证：四大文档 83-90KB 中 20-30% 是「vX.Y.Z 新增/修订，教训：…」式版本考古注解，
//    自家的「注解聚合」政策（AGENTS.md）从未回溯执行。本门把该政策机械化：
//    references/**/*.md 中匹配版本注解模式的行占比 > 阈值即 fail——先治病的瘦身（P2a）已完成，此后不许再沉积。
//    口径：行含 `v\d+\.\d+[^）\n]{0,40}(新增|修订|修复|更正|补)` 或 `(v\d+\.\d+(?:\.\d+)?[-a-z.\d]*…)` 形态
//    且非「已聚合」标记行 / 目录锚链（`...](##` 形态） / 表格行 / 代码块内。
//    v18.8.0 阈值 = 12%（v18.8.0 P2a 完成 SKILL/08-终检/07-审计/任务简报 聚合后实测）——v18.8.x 须降，
//    本规则**禁止抬升**；任何后续提交超 12% 即失败（强制先瘦身）。锚链/表格行/标题行/已聚合引言豁免）。
{
  const ANN_RE = /v\d+\.\d+(?:[-.\d]*[a-z]*)?\s*[^，。\n]{0,24}(新增|修订|修复|更正|补充|扩展|抬升|登记)/
  const EXEMPT_RE = /注解聚合|git log|CHANGELOG|maintainers\.md|版本头|v18\.8\.0/
  const ANCHOR_LINK_RE = /\]\(#/
  const ANN_MAX_RATIO = 0.12
  const annOver = []
  const annStats = []
  const annWalk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { annWalk(p); continue }
      if (!e.name.endsWith('.md')) continue
      const lines = readFileSync(p, 'utf8').split('\n')
      let hits = 0
      for (const l of lines) {
        if (!ANN_RE.test(l) || EXEMPT_RE.test(l) || ANCHOR_LINK_RE.test(l)) continue
        // 标题行（# / ## / ### 开头）豁免：标题文本中的版本引用是结构性装饰（例：## 修订任务书（v2.2.4 新增）），不是散文注解
        if (/^\s*#{1,6}\s/.test(l)) continue
        // 表格行（| 开头）不计
        if (/^\s*\|/.test(l)) continue
        hits++
      }
      const ratio = lines.length ? hits / lines.length : 0
      annStats.push(`${relative(ROOT, p).split(sep).join('/')} ${(ratio * 100).toFixed(1)}%`)
      if (ratio > ANN_MAX_RATIO) annOver.push(`${relative(ROOT, p).split(sep).join('/')}（${(ratio * 100).toFixed(1)}% > ${ANN_MAX_RATIO * 100}%，${hits}/${lines.length} 行）`)
    }
  }
  annWalk(join(ROOT, 'skills', 'lunheng-article-pipeline', 'references'))
  if (annOver.length) {
    fail('ann-density', `版本注解密度超 ${ANN_MAX_RATIO * 100}% 上限：${annOver.join('；')}——按 AGENTS.md「注解聚合」政策合并为卡头单行（最新版本 + 一句教训），历史细节指向 git log；确需抬升阈值须在同一次提交写明理由`)
  }
  notes.push(`⑩ 注解密度：references/**/*.md 版本注解行占比 ≤ ${(ANN_MAX_RATIO * 100)}%（超限 ${annOver.length} 个；TOP5：${annStats.sort((a, b) => parseFloat(b.split(' ')[1]) - parseFloat(a.split(' ')[1])).slice(0, 5).map((s) => s.replace('%', '%')).join('、') || '—'}）`)
}

// ⑪ `lib/**:LINE` 裸行号引用（C-9 机械化 · v18.18.9）
//   动机：审计 C-9 实测 `SECURITY.md` 引 `lib/tools.js:18,24,133,191`，四行全都不是它说的东西。
//   该处改成符号引用后，**同一份文档就地写下了政策**「行号随改动漂移故按符号引用，不写绝对行号」
//   ——**但政策没有门**。v18.18.9 复核发现隔壁那行仍写着 `lib/guard.js:177`，而该行是
//   `const cwd = process.cwd()`（真实安装点 = `installMechanismGuard()` 内的 `tools.guard(...)`）。
//   **同一页上，一行宣布政策、下一行违反它** —— 政策要靠门落，不能靠同一页的另一句话。
//   口径与豁免见 `_lib/lib-line-refs.mjs`（历史留痕按目录豁免；上游包路径如 `dsh-app-boot/lib/...` 不算）。
{
  const docExts = /\.(md|html)$/
  const scannedDocs = scanSet.filter((p) => docExts.test(p) && !isHistoricalDoc(p))
  let refHits = 0
  let scannedExisting = 0
  for (const p of scannedDocs) {
    const abs = join(ROOT, p)
    if (!existsSync(abs)) continue
    scannedExisting++
    for (const hit of findLibLineRefs(readFileSync(abs, 'utf8'))) {
      refHits++
      if (refHits <= 5) {
        fail(
          'lib-line-ref',
          `${p} 用了裸行号引用 \`${hit.raw}\`——请改为**符号引用**（如「\`lib/guard.js\` 的 \`installMechanismGuard()\` 内的 \`tools.guard(...)\`」）。` +
            '理由：行号随任何改动漂移，而它读起来像一个可核验的事实——C-9 实测某处引的四行全都不是它说的东西',
        )
      }
    }
  }
  if (refHits > 5) fail('lib-line-ref', `另有 ${refHits - 5} 处裸行号引用未逐条列出`)
  notes.push(`⑪ 文档行号引用：${scannedExisting} 个当前文档（.md/.html，已排除历史留痕）零裸 \`lib/**:LINE\` 引用`)
}

// ⑫ E 族「单源不变量」机检（v18.18.10）
//   审计 E 族统一处理法要「该事实只允许出现在真源一处，其余必须是指针」——但**对 17 组异质散文
//   事实不可判定**，硬做只能退化成字面禁令，而字面禁令在本仓**必然误报**（文档规范要求更正记录
//   写出旧值：`07卡` 写「无 M-Form-12」、期刊文档写「原写 25 个，真源实为 28」都属正当）。
//   故本规则只做两类**可判定**检查，均为正向存在性或可派生数值、没有绕过口：
//     ① **E-14 数值派生**：真源自称的规模 == 它自己的表行数（「按磁盘表行数导出规模」的题面本身）
//     ② **E-8 / E-14 锚点在场**：新名字（`MC-` 三标签）与新指针（「规模真源 = 期刊数据库.md」）
//        必须在场——单侧回退会让锚点消失
//   边界：E 族**语义半边**（取哪一侧是否正确）没有门，也不假装有；详见模块头注释。
{
  const S = (p) => join(ROOT, 'skills', 'lunheng-article-pipeline', p)
  // ① 期刊规模：自称 vs 表行数
  try {
    const db = readFileSync(S('references/_shared/期刊数据库.md'), 'utf8')
    const derived = deriveJournalCounts(db)
    const declared = declaredJournalCounts(db)
    for (const k of ['zh', 'en']) {
      const label = k === 'zh' ? '中文' : '英文'
      if (derived[k] === null || declared[k] === null) {
        fail('e-family', `期刊库${label}规模：真源里「表行数」或「章节标题自称」有一侧读不到（派生 ${derived[k]} / 自称 ${declared[k]}）——解析器与文档形状脱节`)
      } else if (derived[k] !== declared[k]) {
        fail('e-family', `期刊库${label}规模不自洽：章节标题自称 ${declared[k]}，而表实有 ${derived[k]} 行——加减期刊后忘了改标题（E-14 的原病就是这个）`)
      }
    }
    notes.push(`⑫① 期刊库规模真源自洽：中文 ${derived.zh} 行 / 英文 ${derived.en} 行（与章节标题自称一致）`)
  } catch (e) {
    fail('e-family', `⑫① 期刊规模核对无法执行：${e.message}`)
  }
  // ② 锚点在场（E-8 新名字 / E-14 新指针）
  const anchors = [
    { file: MC_LABEL_ANCHORS.file, miss: MC_LABEL_ANCHORS.labels.filter((n) => !MC_LABEL_ANCHORS.definitionRe(n).test(readFileSync(S(MC_LABEL_ANCHORS.file), 'utf8'))), what: 'MC- 命名空间三标签的**定义项**（E-8）' },
    ...JOURNAL_POINTER_ANCHORS.map((a) => ({
      file: a.file,
      miss: a.must.test(readFileSync(S(a.file), 'utf8')) ? [] : ['「规模真源 = 期刊数据库.md」指针'],
      what: '期刊规模指针（E-14）',
    })),
  ]
  for (const a of anchors) {
    if (a.miss.length) {
      fail('e-family', `${a.file} 缺 ${a.what}：${a.miss.join('、')}——单侧回退（改回旧名 / 改回硬编码数字）会让锚点消失，故此处正向要求它在场`)
    }
  }
  notes.push(`⑫② E 族锚点在场：MC- 三标签 + ${JOURNAL_POINTER_ANCHORS.length} 处期刊规模指针均在场`)
}

// ⑬ CHANGELOG「版本段结构自洽」（v18.18.13）
//   真教训（不是假想）：v18.18.12 发版后复查发现 **`## 18.18.11 — 2026-09-26` 这个版本标题被删了**——
//   写 v18.18.12 段时 `old_string` 只匹配了那行标题、`new_string` 末尾忘了写回去，于是 v18.18.11 的
//   整段内容（`### 一、`…`### 六、`）挂到了 `## 18.18.12` 名下，两个版本段被合并。
//   **它逃过了所有门**：`consistency-check` 规则 ⑪ 只核「**当前**版本段存在」（`## 18.18.12` 在场 → 通过），
//   没有任何门管历史版本标题被删。同形失真在 v18.12.0 段也发生过一次（段内两个 `### 七、`）直到本次才发现。
//   三条不变量（完全自洽可判，不依赖 git / 网络 / 发布记录——理由与代价见 `_lib/changelog-structure.mjs` 头注释）：
//     ① 段内小节编号严格递增（抓「版本标题被删 → 两段合并 → 编号回绕」这一结构指纹）
//     ② 首个 `## ` 段的版本 == `package.json.version`
//     ③ 版本键不重复 ④ 版本键降序
//   解析器在 `_lib/changelog-structure.mjs`（可单测）；形状变了会**抛错**而不是静默通过。
try {
  const clText = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  const pkgVer = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  const { sections } = parseChangelogSections(clText)
  const { checked, withSubs, violations } = reconcileChangelogStructure(sections, pkgVer)
  for (const v of violations) fail('changelog', `⑬ CHANGELOG 版本段结构（${v.kind}）:${v.line} ${v.msg}`)
  // 退化防线（独立于违例报出，两者不互相吞掉——设计理由见 `_lib/changelog-structure.mjs` 头注释）
  if (withSubs === 0) {
    fail('changelog', '⑬ CHANGELOG 段形变了：没有任何「### 一、」式编号小节 → 子序不变量**空跑**（不是「通过」）——请同步解析器')
  }
  if (!violations.length && withSubs > 0) {
    notes.push(`⑬ CHANGELOG 版本段结构：${checked} 个版本段（其中 ${withSubs} 个含编号小节）编号递增、版本降序、无重复键，且首段 == package.json`)
  }
} catch (e) {
  fail('changelog', `⑬ CHANGELOG 版本段结构对账无法执行：${e.message}`)
}

console.log('\n=== 仓库机械卫生门（repo-hygiene-check）===')
for (const n of notes) console.log('  ✓ ' + n)
if (fails.length) {
  console.log(`\n✗ 未通过：${fails.length} 项`)
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log('\n✓ 全部通过')
