// 测试回调上下文钉（v19.6.2 · 发版 CI 红反哺）
//
// ── 为什么需要它（本次真实踩中，代价 = 一次发版红）──────────────────────────────────────
// v19.6.2 把 6 处「缺夹具时空断言假绿」（`assert.ok(true, '…跳过…') + return`，见审计 P2-9）改成
//   `t.skip(理由)`。其中**一处**的回调仍写作 `() => {`（忘了加 `t` 形参）。
//   · 本机：真夹具存在 ⇒ 该分支**从不执行** ⇒ 本地全量套 **1196 全绿**；
//   · CI（`ubuntu-latest`，无 `run/` 夹具）⇒ 一走到 skip 出口就 `ReferenceError: t is not defined`
//     ⇒ **gates 作业红、publish 被 needs 拦下**（v19.6.2 首次发版即卡在这里）。
//   判据：**「只在环境缺失时才执行」的代码路径，在开发机上天然覆盖不到**——这类分支不能只靠跑套件，
//   必须**静态钉住它的前提**（本仓「把声明搬进门的视野」的又一实例：`t` 是声明，skip 是使用）。
//
// ── 口径 ────────────────────────────────────────────────────────────────────────────
//   扫描 `tests/**` 与 `skills/*/tests/**` 的 `*.test.mjs`：凡出现 `t.<api>(` 的**方法调用**，
//   就回看最近的**测试回调**声明行（`(…) => {` 形态，含 `async`），要求其形参列表里含 `t`。
//   边界（如实）：① 只认 `t.` 前缀（其它上下文变量名如 `ctx` 不在本门范围）；② 回调声明行
//   回看窗口 ≤ 12 行（够覆盖本仓既有的多行 `test(名字,\n { skip: … },\n (t) => {` 形态）；
//   ③ 不改写任何测试，只报**声明与使用不匹配**。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 递归收集测试文件（两个 glob 与 `package.json#scripts.test` 同口径）。 */
function collectTestFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') collectTestFiles(p, out) }
    else if (e.name.endsWith('.test.mjs')) out.push(p)
  }
  return out
}

/** 回调声明：行内**最后一个** `(…) => {` 形态（覆盖单行 `test('名', (t) => {`、多行 `  (t) => {`、
 *  以及 `test('名', { skip: … }, (t) => {` 三种既有写法；末尾注释不影响）。
 *  ⚠️ 首版写成 `^\s*\(…\)\s*=>\s*\{`（行首锚）→ 单行形态**一个都匹配不到** → 反向自证用例当场抓到
 *  （goodText 被判成「未找到回调声明」）。教训同本仓「门自己也会犯它要抓的错」：**先写反向自证**。 */
const CALLBACK_RE_G = /(?:^|[\s,])(\([^()]*\))\s*=>\s*\{/g
/** 测试上下文方法调用（本门只关心这些）。 */
const CONTEXT_CALL_RE = /\bt\.(skip|diagnostic|todo)\s*\(/

/** 该行是否是「回调声明行」；是则返回其形参列表，否则 null。
 *  **只认缩进 ≤ 4 空格**的声明行——测试回调在本仓写作 0–4 空格缩进，而嵌套箭头（`setTimeout(() => …)`）
 *  通常更深；这条限制避免把「测试体内的嵌套回调」误当成本测试的回调（否则会假报缺 `t`）。 */
function callbackParams(line) {
  const raw = String(line)
  const indent = raw.match(/^ */)[0].length
  if (indent > 4) return null
  const ms = [...raw.matchAll(CALLBACK_RE_G)]
  if (!ms.length) return null
  const last = ms[ms.length - 1][1]
  return last.slice(1, -1)   // 去掉两侧括号
}

/** 回看窗口（行）：既有的 `test(名, async (t) => {` 到 `t.skip(...)` 实测可达 16 行（`commands.test.mjs`），
 *  故窗口取 60（够宽），并由上面的缩进判据挡住嵌套回调带来的假报。 */
const LOOKBACK_LINES = 60

/** 找出「声明了 `t`」的回调所在行号集合（供断言用）：返回 `{ violations, checked }`。 */
export function scanCallbackContexts(text) {
  const lines = text.split('\n')
  const violations = []
  let checked = 0
  for (let i = 0; i < lines.length; i++) {
    if (!CONTEXT_CALL_RE.test(lines[i])) continue
    if (/^\s*\/\//.test(lines[i])) continue            // 注释里的示例不算
    checked++
    // 回看最近的测试回调声明行
    let decl = null
    for (let j = i; j >= 0 && i - j <= LOOKBACK_LINES; j--) {
      const params = callbackParams(lines[j])
      if (params !== null) { decl = { line: j + 1, params }; break }
    }
    if (!decl) { violations.push({ line: i + 1, why: `回看 ${LOOKBACK_LINES} 行内未找到回调声明（\`(…) => {\`）——无法确认 \`t\` 在作用域内` }); continue }
    const params = decl.params.split(',').map((s) => s.trim()).filter(Boolean)
    if (!params.includes('t')) {
      violations.push({
        line: i + 1,
        why: `该行调用了测试上下文方法，而它所属的回调（第 ${decl.line} 行）形参是 \`(${decl.params})\`——缺 \`t\`（本机不覆盖该分支，CI 一到就 ReferenceError）`,
      })
    }
  }
  return { violations, checked }
}

test('测试回调上下文：`t.skip(` / `t.diagnostic(` 必须落在声明了 `t` 的回调里（v19.6.2 发版红反哺）', () => {
  const files = [
    ...collectTestFiles(join(ROOT, 'tests')),
    ...collectTestFiles(join(ROOT, 'skills', 'lunheng-commands', 'tests')),
  ]
  assert.ok(files.length >= 50, `测试文件过少（实测 ${files.length}）——收集面退化会让本门恒真`)
  let checked = 0
  const bad = []
  for (const f of files) {
    // 自豁免：本文件的两个用例把「缺 t 的反面教材」写成字符串夹具（引文），扫它必然假报
    //   —— 与 `_lib/lib-line-refs.mjs` 的 `SCRIPT_COMMENT_REF_EXEMPT` 同判据（扫描器自身的夹具）。
    if (f.endsWith('test-callback-context.test.mjs')) continue
    const { violations, checked: n } = scanCallbackContexts(readFileSync(f, 'utf8'))
    checked += n
    for (const v of violations) bad.push(`${f.slice(ROOT.length + 1)}:${v.line} —— ${v.why}`)
  }
  assert.ok(checked >= 5, `全仓应至少核到 5 处上下文方法调用（实测 ${checked}）——正则失配会让本门静默失效`)
  assert.deepEqual(bad, [], `以下调用点的回调缺 \`t\` 形参：\n  ${bad.join('\n  ')}`)
})

test('反向自证：缺 `t` 形参的形态必须被判出（否则本门是空转）', () => {
  const badText = [
    "const { test } = await import('node:test')",
    "test('x', () => {",
    "  if (!exists) { t.skip('缺夹具'); return }",
    '})',
  ].join('\n')
  const r = scanCallbackContexts(badText)
  assert.equal(r.violations.length, 1, '应报 1 处：' + JSON.stringify(r))
  const goodText = [
    "test('x', (t) => {",
    "  if (!exists) { t.skip('缺夹具'); return }",
    '})',
  ].join('\n')
  assert.deepEqual(scanCallbackContexts(goodText).violations, [], '声明了 `t` 的形态不得误报')
})
