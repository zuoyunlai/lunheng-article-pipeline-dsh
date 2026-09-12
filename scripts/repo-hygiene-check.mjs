#!/usr/bin/env node
/**
 * repo-hygiene-check.mjs —— 仓库机械卫生门（CI 专用，零依赖，不随包分发）
 *
 * 为什么存在（v2.5.2-dsh.13 新增，回应第三方审计「CI 覆盖度」）：
 *   `consistency-check.mjs` 管文档漂移、`plugin-surface-check.mjs` 管打包面契约，
 *   但**语法/编码/行尾/发布内容**这些「零成本就能机械判定」的东西此前无人守：
 *   - 随包脚本多数从未被 CI 执行过（含承重的 m-gate-check）；v2.5.2-dsh.17 起共 11 个（数量从 SKILL.md 白名单派生）；
 *   - `examples/preset/preset.yml` 从未被任何解析器校验；
 *   - 35 个文件工作区 CRLF、`.gitignore` 是 GBK——而 npm 打包读工作区。
 *
 * 检查项：
 *   ① git 跟踪文件：*.mjs 逐个 `node --check`（语法）
 *   ② *.json 逐个 JSON.parse
 *   ③ *.yml/*.yaml 结构健全（禁制表符缩进 + 关键文件必须含预期键）
 *   ④ 行尾：git ls-files --eol 不得出现 w/crlf 或 w/mixed（配 .gitattributes）
 *   ⑤ 编码：文本文件必须为合法 UTF-8（拒绝替换字符/非法序列）
 *   ⑥ 发布面：npm pack --dry-run --json 必须含关键路径 + 脚本数 == SKILL.md 白名单数
 *
 * 退出码：0 = 全通过；1 = 有失败（fail-closed，CI 红灯）
 * 失败同时输出 GitHub annotation（::error::），无需下载日志即可定位。
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
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

// ① 语法：node --check
let mjs = 0
for (const p of tracked.filter((f) => f.endsWith('.mjs'))) {
  if (!existsSync(join(ROOT, p))) continue
  const r = spawnSync(process.execPath, ['--check', join(ROOT, p)], { encoding: 'utf8' })
  mjs++
  if (r.status !== 0) fail('syntax', `${p}: ${(r.stderr || '').split('\n').slice(0, 2).join(' / ')}`)
}
notes.push(`① 语法：检查 ${mjs} 个 .mjs`)

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
const dec = new TextDecoder('utf-8', { fatal: true })
for (const p of tracked.filter(isText)) {
  const abs = join(ROOT, p)
  if (!existsSync(abs)) continue
  utf8Checked++
  try { dec.decode(readFileSync(abs)) } catch { fail('utf8', `${p}: 非法 UTF-8（可能是 GBK 等本地编码）`) }
}
notes.push(`⑤ 编码：UTF-8 校验 ${utf8Checked} 个文本文件`)

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
    const must = ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'CHANGELOG.md', 'skills/lunheng-article-pipeline/SKILL.md']
    for (const m of must) if (!files.includes(m)) fail('pack', `发布包缺关键路径：${m}`)
    // 只数**顶层**随包脚本（`scripts/_lib/` 是共享库，不算入口；v2.5.2-dsh.13）
    const scripts = files.filter((f) => /^skills\/lunheng-article-pipeline\/scripts\/[^/]+\.mjs$/.test(f))
    // v2.5.2-dsh.17：脚本数**从 SKILL.md 白名单派生**，不再写死数字（写死会在加脚本时变成噪音红灯；
    // 白名单本身的正确性由 consistency-check 规则 ⑩ 双向核验：磁盘 ↔ SKILL.md）
    const wl = readFileSync(join(ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md'), 'utf8')
      .split('\n').find((l) => l.includes('随包脚本白名单')) || ''
    const declared = (wl.split('=')[1] || '').split('+')[0].split('/').map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9-]*$/.test(s))
    if (declared.length === 0) fail('pack', 'SKILL.md 未声明随包脚本白名单（规则 ⑩ 同源）')
    else if (scripts.length !== declared.length) fail('pack', `发布包内随包脚本数 ${scripts.length} ≠ SKILL.md 白名单 ${declared.length}（白名单不一致）`)
    notes.push(`⑥ 发布面：${files.length} 个文件 / 随包脚本 ${scripts.length} 个（与 SKILL.md 白名单一致）/ 关键路径齐备`)
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

// ⑧ 退出码契约表（v18.0.2 新增）
//    动机：退出码是**被别的组件消费的输出契约**（`final-check` 的推荐语、主控的闸门判定），
//    实测出现过两类撞码且**此前无门可拦**：
//      · `m-gate-check` 把「定稿/证据包不存在」判 exit 1 → 伪装成「P1 内容失败」，主控据此去改正文；
//      · `model-routing` 用 exit 3 表示「需人工决定」→ 与 M 门 3（仅 P2，**可放行**）撞码。
//    规则：① 脚本内 `process.exit(...)` 用到的数字必须是表内声明的子集；
//          ② 表内每个码必须在脚本里**以字面量出现**（防表格腐烂成空想）；
//          ③ 表外脚本一律忽略（CI 专用脚本另有 0/1 命名空间）。
//    改退出码 ⇒ 必须同步本表 + `docs/troubleshooting.md §8` + 相关测试。
const EXIT_CONTRACT = {
  'm-gate-check.mjs': [0, 1, 2, 3, 10],
  'final-check.mjs': [0, 1, 2, 3, 10],
  'build-evidence-bundle.mjs': [0, 10],
  'count-chars.mjs': [0, 10],
  'normalize-trust-level.mjs': [0, 1, 10],
  'model-routing.mjs': [0, 1, 4],
  'consistency-check.mjs': [0, 1],
  'token-budget.mjs': [0, 1, 2],
  'token-cost.mjs': [0, 1],
  'md2html.mjs': [0, 1, 2],
  'pdfcheck.mjs': [0, 1],
}
const scriptDir = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')
for (const [name, allowed] of Object.entries(EXIT_CONTRACT)) {
  const p = join(scriptDir, name)
  if (!existsSync(p)) { fail('exit-code', `退出码表登记的脚本不存在：${name}`); continue }
  const text = readFileSync(p, 'utf8')
  const used = new Set()
  for (const m of text.matchAll(/process\.exit\(([^)]*)\)/g)) {
    for (const n of m[1].matchAll(/\b\d+\b/g)) used.add(Number(n[0]))
  }
  const unexpected = [...used].filter((c) => !allowed.includes(c))
  if (unexpected.length) {
    fail('exit-code', `${name}: 使用了表外退出码 ${unexpected.join(', ')}（已声明 ${allowed.join('/')}）——若是有意新增，请同步 repo-hygiene 的 EXIT_CONTRACT 与 docs/troubleshooting.md §8`)
  }
  const phantom = allowed.filter((c) => !new RegExp(`\\b${c}\\b`).test(text))
  if (phantom.length) {
    fail('exit-code', `${name}: 契约表声明了 ${phantom.join(', ')}，但脚本里找不到该字面量——表格已过期，请核对`)
  }
}
notes.push(`⑧ 退出码表：${Object.keys(EXIT_CONTRACT).length} 个随包脚本的 exit code 与契约一致`)

console.log('\n=== 仓库机械卫生门（repo-hygiene-check）===')
for (const n of notes) console.log('  ✓ ' + n)
if (fails.length) {
  console.log(`\n✗ 未通过：${fails.length} 项`)
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log('\n✓ 全部通过')
