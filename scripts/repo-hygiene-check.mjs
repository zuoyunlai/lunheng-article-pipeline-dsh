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
 *   ⑧ 退出码契约表（静态解析 process.exit + exit-guard 兜底检查）
 *   ⑨ 文档词预算门（v18.1.0：逐文件棘轮上限 + ≥12 KB 全覆盖 + 常驻集合计上限）
 *
 * 退出码：0 = 全通过；1 = 有失败（fail-closed，CI 红灯）
 * 失败同时输出 GitHub annotation（::error::），无需下载日志即可定位。
 */
import { readFileSync, existsSync, statSync, mkdtempSync, copyFileSync, rmSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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
if (pack.status !== 0) {
  fail('pack', `npm pack --dry-run 失败：${(pack.stderr || pack.stdout || '').split('\n').slice(-3).join(' / ')}`)
} else {
  try {
    const arr = JSON.parse(pack.stdout.slice(pack.stdout.indexOf('[')))
    const files = (arr[0]?.files || []).map((f) => f.path)
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
    const mustNotShipFiles = [
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'scripts/repo-hygiene-check.mjs',
      'scripts/plugin-surface-check.mjs',
      'scripts/pack-smoke.mjs',
    ]
    const mustNotShipDirs = ['tests/', 'scripts/', '.github/']
    for (const m of mustNotShipFiles) {
      if (files.includes(m)) fail('pack', `发布面污染：${m} 不应随包（仓库向文件；见 CHANGELOG ## 18.2.0 的裁剪口径）`)
    }
    for (const d of mustNotShipDirs) {
      const hit = files.filter((f) => f.startsWith(d))
      if (hit.length) fail('pack', `发布面污染：${d} 下有 ${hit.length} 个文件随包（如 ${hit[0]}）——仓库向目录不得进发布物`)
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
    notes.push(
      `⑥ 发布面：${files.length} 个文件 / 随包脚本 ${scripts.length} 个（与 SKILL.md 白名单一致）/ 关键路径齐备` +
        ` / 仓库向文件零污染（${mustNotShipFiles.length} 个文件 + ${mustNotShipDirs.length} 个目录）` +
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
  'm-gate-check.mjs': [0, 1, 2, 3, 10, 70],
  'final-check.mjs': [0, 1, 2, 3, 10, 70],
  'build-evidence-bundle.mjs': [0, 10, 70],
  'count-chars.mjs': [0, 10, 70],
  'normalize-trust-level.mjs': [0, 1, 10, 70],
  'model-routing.mjs': [0, 1, 4, 10, 70],
  'consistency-check.mjs': [0, 1, 10, 70],
  'token-budget.mjs': [0, 1, 10, 70],   // v18.2.9：删 2——旧版「2 = 项目路径不存在」与 M 门「2 = P0」撞义，已改 10
  'token-cost.mjs': [0, 1, 10, 70],
  'md2html.mjs': [0, 2, 10, 70],
  'pdfcheck.mjs': [0, 1, 10, 70],
  // v18.2.6 补登（第三方审计 §4.2「`apply-diff.mjs` 未登记进 EXIT_CONTRACT」）：v18.2.5 新增的脚本
  //   装了 exit-guard 却**无门核其退出码**——即「有守卫、无契约」，新增的越界码不会被任何门拦下。
  //   口径取自该脚本头注释：0 = 全部条目应用成功 / 1 = 有跳过或未解析条目、或清单解析出 0 条 / 10 = 参数或路径错。
  'apply-diff.mjs': [0, 1, 10, 70],
  // v18.6.0 补登（交接门规格 §5「登记义务」）：handoff-check 的退出码与 M 门 1/2/3 刻意分离——
  //   20 = 产物缺失或 0 字节 / 21 = 结构·版本·成对·回报段不合 / 22 = 仅软提示；10/70 走 exit-guard 通用语义。
  'handoff-check.mjs': [0, 20, 21, 22, 10, 70],
}
const scriptDir = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')
const dynamicScripts = []
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
  // ① 解析本文件里的 `const X = <数字>`（含顶层与函数内声明）
  const localConsts = new Map()
  for (const m of text.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\b/g)) localConsts.set(m[1], Number(m[2]))
  // ② 解析 guard 模块导出的常量
  const guardConsts = new Map()
  if (existsSync(guardPath)) {
    for (const m of readFileSync(guardPath, 'utf8').matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\b/g)) {
      guardConsts.set(m[1], Number(m[2]))
    }
  }
  const resolved = new Set()
  let dynamicExit = false
  // 退出码的两个写法都要看（v18.2.6 收紧）：
  //   ① `process.exit(N)` / `process.exitCode(N)` —— 括号调用形态（旧版只看这个）；
  //   ② `process.exitCode = N` —— **赋值**形态。它在 Node 里与 ① **同样生效**（进程正常结束即用该码），
  //      而旧版完全看不见它：一个 `process.exitCode = 4` 能绕过「表外退出码」检查（本规则的主要锋芒）。
  //      本包当前无此形态，但门不能只覆盖「今天恰好没写」的那种写法。
  const exitArgs = [
    ...[...text.matchAll(/process\.exit(?:Code)?\(([^)]*)\)/g)].map((m) => m[1].trim()),
    ...[...text.matchAll(/process\.exitCode\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim()),
  ]
  for (const arg of exitArgs) {
    if (!arg) continue
    for (const n of arg.matchAll(/\b\d+\b/g)) resolved.add(Number(n[0]))
    for (const id of arg.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      const nm = id[1]
      if (localConsts.has(nm)) {
        resolved.add(localConsts.get(nm))
      } else if (guardConsts.has(nm)) {
        resolved.add(guardConsts.get(nm))
      } else if (!/^\d+$/.test(arg)) {
        dynamicExit = true // 运行时算出来的值（如 anyMissing ? 4 : 0 / p0>0?2:…）——静态看不见
      }
    }
  }
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
notes.push(
  `⑧ 退出码表：${Object.keys(EXIT_CONTRACT).length} 个随包脚本的退出码契约已核（静态解析 process.exit/exitCode 两种写法 + guard **真 import** 兜底检查）` +
    (dynamicScripts.length ? `；动态 exit（静态不可判定，仅核字面量）：${dynamicScripts.join(', ')}` : ''),
)

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
  'skills/lunheng-article-pipeline/SKILL.md': [33792, 20480, '技能体：入口注册的正文，每次技能激活都进上下文（最贵的文件）——v18.6.0 后显式抬升 32→33 KB（整体审查收尾）：启动速查表补「收报验收」行（交接门 handoff-check 收报动作，规格 §8 #7 补齐）'],
  'skills/lunheng-article-pipeline/AGENTS.md': [21504, 16384, '操作手册：技能目录内自动生效的指令'],
  'skills/lunheng-article-pipeline/references/pipeline-readme.md': [80896, 61440, '流水线全景 + 派发话术（T0 启动必读）——v18.2.2 显式抬升 60→64 KB：补「段级 diff 字数回测硬约束」与「T5/T6/T9 派发用 M 门速查」；v18.2.5 显式抬升 64→65 KB：补「段级 diff 字数口径硬约束（纯汉字 = count-chars 同源）」与「审计视图刷新落盘留痕（status.md 可核对项）」；**v18.2.7 显式抬升 65→74 KB（主人授权修订）**：依 2026-09-20 全流程实战反哺，一处补 6 条硬约束——① 派发最小集补第 7 条「文末五节条目标签用论衡编号」（真源 `机检硬格式.md` §五 v18.2.2 已有该条，但最小集一直漏同步，实战第三次踩到：T5 四版全写 `[1]`-`[11]`，T7 三轮未抓出，直到 T8 才爆 P0）；② 段级 diff 加「预算闸门前置」（清单预估 16,987 → 实测 18,071，超限 1,271 字 → 被迫削 3 轮）；③ 加「素材加载清单刷新责任在段级 diff 模式下归主控」（与「T5 每轮覆盖写」机制直接冲突）；④ 加「清单须机器可读、优先用 apply-diff.mjs」（实战主控为此做约 52 处手工 edit）；⑤ T7 修订任务书加「验收方式」列（解「字面验收 vs 字数约束」死结）；⑥ T7 预检从 5 项扩为**全量 22 项 M 门** + 缺陷冻结机制（3 个零判断力 P0 漏到 T8、A 轨 2 轮用满仅 29% 完全关闭）；**v18.2.8 显式抬升 74→75 KB（主人授权「G14 早闸去掉」）**：流水线全景的 G14 行与派发话术段改为「三层防御、仅一次 spawn」。**已先做两轮瘦身**（删除依据移至 `gates/14` 单点持有），瘦身后仍超 150 B；剩余为 Phase 序列与派发话术本身，属 T0 启动必读的承重内容；**v18.5.1 显式抬升 75→78 KB（ai-content-farm-retractions 反哺：派发前 preflight 反注 + T6/T9 意见强制机械证据硬约束）**；**v18.6.2 显式抬升 78→79 KB（共锁反哺：T1 派发前自检 handoff-check）**'],
  'skills/lunheng-article-pipeline/references/_shared/M-Gate-Algorithm.md': [89088, 79872, 'M 门伪代码（仅 T7/T8 读）——v18.2.2 显式抬升 78→84 KB：补 6 处 v18.2.2 判定语义修订注记（M-Form-4/8/11 + M-Exist-2/10 + M-Integrity-1）；**v18.3.1 显式抬升 84→86 KB（第三方审计 B3）**：新增「阈值总表」生成块（24 个阈值键，由 m-gate-check.mjs `THRESHOLDS` 单向生成 + consistency-check ㉓ 逐键核对，消灭阈值数字与正文伪代码的双维护）；**v18.6.2 显式抬升 86→87 KB（共锁反哺：M-Exist-10 定位口径登记）**'],
  'skills/lunheng-article-pipeline/references/agents/00-主控-扩展职责.md': [55296, 50176, 'T0 实操手册（全库第二，闸门公共动作在此）——v18.2.2 显式抬升 49→52 KB：补「修订回环提前 Ack 判据」四类归因决策表；v18.2.9 显式抬升 52→53 KB（第三方审计 A12）：补「T8 人工裁定双签」（M-Form-8 / M-Integrity-2 亲裁定须独立复核，守住独立角色互为镜像）；**v18.6.0 后显式抬升 53→54 KB（整体审查收尾）**：补「收报验收」闸门公共动作（交接门 handoff-check，规格 §8 #3 补齐）'],
  'skills/lunheng-article-pipeline/references/glossary.md': [34816, 32768, '术语表（含 §十二 刻意偏离，改机制前必读）——v18.5.1 显式抬升 32→34 KB（ai-content-farm-retractions 反哺：§12.1 正文字数单一真源 + §12.3 五节 vs 国标仲裁）'],
  'skills/lunheng-article-pipeline/references/agents/05-写作-writer.md': [46080, 36864, 'T5 写手卡——v18.2.5 显式抬升 36→38 KB：补「段级 diff 字数口径与 count-chars 同源（两侧汉字计数）」+「图位编号 = 正文出现顺序，禁照抄大纲编号」两条硬约束；**v18.2.8 显式抬升 38→39 KB（主人授权「G14 早闸去掉」）**：F 自检 7 项 → 7+1 项，新增「G14 v1 自检」（早闸删除后由写手在写作阶段承担第 1 层检测）；**v18.3.0 显式抬升 39→40 KB（G 体系机械下沉）**：写作规范新增「删优于改（Prefer CUT over REWRITE）」一条（借鉴 Writing Guard）；**v18.6.2 显式抬升 40→45 KB（共锁反哺：G14 实测铁律 / 图位编号 / 幽灵引用 / 双口径字数 / 元数据红线 / 修订说明等量覆盖 四组补丁）**'],
  'skills/lunheng-article-pipeline/references/_shared/DSH-集成方案.md': [29696, 25600, 'DSH 能力面集成：§七 落地状态 + §八 preset 配方 + §九 运行环境限制（v18.1.0 扩容，新进预算表）——v18.2.2 显式抬升 25→28 KB：新增 §九「Windows sandbox --temp 前置目录缺失」现象 + 四条替代路径 + 主控操作纪律；**v18.6.3 显式抬升 28→29 KB**：DSH 集成方案同步（v18.6.3 落地时回填具体子项）'],
  'skills/lunheng-article-pipeline/references/agents/07-审计-auditor.md': [24576, 22528, 'T7 审计卡——v18.5.1 显式抬升 22→23 KB：修订任务书新增「违反规范」列 + 「怎么改」列处置动作动词前缀（补/删/改/降级），借鉴 writing-guard rule/action 分离（反哺报告-writing-guard借鉴-v1 动议一）；**v18.6.2 显式抬升 23→24 KB（共锁反哺：铁律加 T6 交叉验证）**'],
  'skills/lunheng-article-pipeline/references/memory/lessons.md': [19456, 19456, '教训库（只增，需定期合并同类项）'],
  'skills/lunheng-article-pipeline/references/templates/任务简报-template.md': [22528, 19456, '任务简报模板（full 版）——v18.2.2 显式抬升 19→21 KB：① 补「字数判定层级强制显式勾选 + 与 G5 硬阈的关系澄清」；② 补「GB/T 7714 只约束著录格式、不约束标签形态」正误形态对照（第二处抬升，20480→21504）——**v18.5.1 显式抬升 21→22 KB（ai-content-farm-retractions 反哺：「需找数据点 vs 需找案例」标签口径说明）**'],
  'skills/lunheng-article-pipeline/references/agents/06-批判-critical-companion.md': [18432, 17408, 'T6 批判卡——**v18.6.3 显式抬升 17→18 KB**：补 T7 互不搬运清单 / 校对协议深化（v18.6.3 落地时回填具体子项）'],
  'skills/lunheng-article-pipeline/references/deliverables.md': [17408, 16384, '交付边界 + F1-F9 + 闸门（按需加载）——v18.2.1 显式抬升 16→17 KB：补「文末编号必须沿用素材卡真编号」硬要求'],
  'skills/lunheng-article-pipeline/README.md': [16384, 15360, '技能目录 README（人类入口）——**v18.6.3 显式抬升 15→16 KB**：v18.6.3 同步（v18.6.3 落地时回填具体子项）'],
  'skills/lunheng-article-pipeline/QUICKSTART.md': [16384, 15360, '快速开始——v18.2.9 显式抬升 15→16 KB（第三方审计「Step1 手写简报与 Phase 0 协议路径冲突」）：Step 1 补一句与 Phase 0 的关系澄清，消除两处生成简报的歧义'],
  'skills/lunheng-article-pipeline/references/agents/04-分析-analyst.md': [15360, 14336, 'T4 分析卡——v18.2.5 显式抬升 14→15 KB：补「建议图表编号 = 预计正文出现顺序」（不确定时显式授权 T5 重排）'],
  'skills/lunheng-article-pipeline/references/_shared/机检硬格式.md': [13312, 12288, '机检硬格式（模板 ↔ m-gate-check.mjs 的排版契约，唯一真源）——v18.2.5 新增登记（原 11.5 KB 越过 12 KB 登记线）：补「期刊匹配输入来源须逐行标注」与「非标准编号黑名单」口径'],
  'skills/lunheng-article-pipeline/references/agents/02-数据检索-data-scout.md': [13312, 13312, 'T2 数据检索卡'],
  'skills/lunheng-article-pipeline/references/agents/03-案例检索-case-scout.md': [13312, 13312, 'T3 案例检索卡'],
  'skills/lunheng-article-pipeline/references/agents/09-审稿-peer-reviewer.md': [20480, 13312, 'T9 审稿卡——v18.2.1 显式抬升 13→14 KB：补 M-Exist-6 六维机检契约警示（防派发时改写维度名）；**v18.2.7 显式抬升 14→18 KB（主人授权修订）**：依 2026-09-20 全流程实战反哺，补三处——① **修本卡内部矛盾**：§when 写「T9 只能在 T7 审计后」而 §exclusions 写「❌ T7 审计后（已晚）」，同一张卡两处直接冲突（v2.4.0 引入 G14 时点漂移时的遗留），现删除错误项并注明正确时点；② 新増铁律「我是参谋层，不是交付闸门」——判定词 accept/minor/major/reject 借自真实同行评审、天然带程序效力暗示，若机制不写明「T9 不阻塞交付」，主控在 A 轨用满时读到「major revision」可能被迫多跑一轮；③ 格式骨架补「综合匹配度」**表的字面样例**（此前只有文字说明 → T9 按卡产出自然语言段落 → M-Exist-6 判 P1）；**v18.5.1 显式抬升 18→19 KB（writing-guard 借鉴反哺 v1，动议二+动议一）**：扩写清单扩为「字数+文体偏差」双维度 + 建议段 rule/action 分离（违反规范 + 处置动作）；**v18.6.3 显式抬升 19→20 KB**：补 M-Exist-6 批处理契约 / 拒吞项源头（v18.6.3 落地时回填具体子项）'],
  'skills/lunheng-article-pipeline/references/checkers/中文AI痕迹-checker.md': [15360, 12288, 'G14 检测器契约（checker 侧）——**v18.2.6 新增登记**：本轮修订把 G14 触发时点统一为「早闸 Phase 3.6 与 T6 同批 / 终闸 Phase 4.5 与 T9 并行」（旧文写「早闸 Phase 3.1」「终闸与 T6 并行」，后者在时序上不可能），文件由 11.5 KB → 12.0 KB **越过 12 KB 登记线**，故按规则⑨ ① 补登记；**v18.2.8 显式抬升 13→14 KB（主人授权「G14 早闸去掉」）**：§when 重写为「三层防御、仅一次 spawn」，并新增 §exclusions「Phase 4.5 之前的任何时点不得 spawn」。**已先做两轮瘦身**（把删除依据的三条理由移出、只留指向 `gates/14` §触发阶段注的指针），瘦身后仍超 400 B；剩余内容为规则性定义（三层各自的执行者与产出），无法再压缩而不损可执行性；**v18.6.3 显式抬升 14→15 KB**：G14 检测器边例扩充（v18.6.3 落地时回填具体子项）'],
  'skills/lunheng-article-pipeline/references/_shared/规范-机械门对照表.md': [24576, 16384, '规范条文 ↔ 机械门 ID 对照表（改机制前须同步的一览）——v18.2.2 新增登记；v18.2.4 显式抬升 16→17 KB：补 3 行断链；v18.2.5 显式抬升 17→22 KB：补 7 行（门补面与同步本表是同一件事的两半）；v18.3.0 显式抬升 22→23 KB（G 体系机械下沉）：补「因果强度守恒（apply-diff causal_upgrades）+ 裸断言段（M-Form-8 子项）」两行勾稽；**v18.6.2 显式抬升 23→24 KB（共锁反哺：§11 标题唯一性 + 闸门记录裸竖线 两行假阳性登记）**'],
}
const ALWAYS_RESIDENT = [
  'skills/lunheng-article-pipeline/SKILL.md',
  'skills/lunheng-article-pipeline/AGENTS.md',
]
// 常驻集合计上限（v18.1.0 由 51200 抬升：C 组四处机制事实入 SKILL.md/AGENTS.md）
//   **v18.2.7 由 53248 抬升到 54272（主人授权修订）**：改前实测常驻集合计 **53222 B**，距上限仅 **26 B**
//   ——即该约束已处于 99.95% 利用率，实际等效于「禁止再向 SKILL.md 写任何内容」。而本次新增
//   `scripts/segment-chars.mjs` 后，**规则 ⑩（随包脚本白名单集合一致性）强制要求**把新脚本名写进
//   SKILL.md 的白名单行——该写入**不可回避**（不写则规则 ⑩ 判 P1「白名单漏列」）。故按「同一次提交里
//   显式抬升并写明理由」原则抬高 1 KB，不采用「删既有机制说明」来腾空间（那会以丢失机制事实为代价）。
const ALWAYS_LIMIT = 54272

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

console.log('\n=== 仓库机械卫生门（repo-hygiene-check）===')
for (const n of notes) console.log('  ✓ ' + n)
if (fails.length) {
  console.log(`\n✗ 未通过：${fails.length} 项`)
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log('\n✓ 全部通过')
