// lib/ 静态自检（v18.80.4 · 审计优化方向 5 落地 · 批 A）
//
// **为什么需要**（审计依据）：`lib/**` 此前**没有任何静态检查**——无 lint、无 unused 检查，与
//   `skills/**` 的严密门禁形成反差（该事实由 v18.80.1 全量审查修订批记录在 `lib/commands.js` 头注释）。
//   本仓的零依赖哲学（`package.json` 无 devDependencies）决定了**不引入 ESLint**，改为两条高精度启发式：
//     ① **未使用的 import**（导入的本地/相对绑定在文件其余部分从未出现）——零误报面：
//        真用到就必然出现；删掉未用导入不改变行为（纯清理）。
//     ② **孤儿模块**（`lib/*.js` 未被任何其它 `lib/` 文件 import/动态 import）——入口目录里的死文件
//        会随包发布且永不执行；F1/包面门只查「在盘」，不查「有人用」。
//
// **边界（如实，不得读成「lib 已完整类型/契约检查」）**：
//   · 只做上述两条**语法层**判定，不做类型检查、不做未使用**变量**分析、不判导出是否被外部消费
//     （导出面是 API，被测试或宿主消费都算合法，静态无法判全）；
//   · 依赖 `import ... from '<相对路径>'` / `import('<相对路径>')` 的**字面量**形态——动态拼接的
//     模块路径（本包无此写法）不会被识别；
//   · 注释内的示例代码**不遮**：若注释里出现 `import x from './y.js'` 字样会被统计（当前无此形态；
//     真出现时本用例会红，届时按实例补遮蔽，而不是放宽整个判据）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const LIB = join(ROOT, 'lib')

const libFiles = readdirSync(LIB, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.js'))
  .map((e) => e.name)
  .sort()

/** 抽取 `import ... from '<相对路径>'` 与 `import('<相对路径>')` 的相对模块说明符。 */
const relSpecifiers = (src) => {
  const out = new Set()
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)) out.add(m[1])
  for (const m of src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) out.add(m[1])
  return out
}

/** 抽取每个 import 语句的**本地绑定名**（default / named / namespace / side-effect 无绑定）。 */
const importedBindings = (src) => {
  const binds = []
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+([\s\S]*?)\s+from\s+['"](\.[^'"]+)['"]/g)) {
    const clause = m[1].trim()
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause)
    if (ns) binds.push({ name: ns[1], spec: m[2] })
    const named = /\{([\s\S]*?)\}/.exec(clause)
    if (named) {
      for (const part of named[1].split(',')) {
        const t = part.trim()
        if (!t) continue
        const as = /\s+as\s+([A-Za-z_$][\w$]*)$/.exec(t)
        const nm = as ? as[1] : t.replace(/^type\s+/, '').trim()
        if (/^[A-Za-z_$][\w$]*$/.test(nm)) binds.push({ name: nm, spec: m[2] })
      }
    }
    const def = clause.replace(/\{[\s\S]*?\}/, '').replace(/^,|,$/g, '').trim()
    if (/^[A-Za-z_$][\w$]*$/.test(def)) binds.push({ name: def, spec: m[2] })
  }
  return binds
}

test('lib 静态自检 ①：不得存在**未使用的相对 import**（零依赖替代 lint）', () => {
  const unused = []
  for (const f of libFiles) {
    const src = readFileSync(join(LIB, f), 'utf8')
    for (const { name, spec } of importedBindings(src)) {
      // 去掉所有 import 语句本身，再看该绑定是否在其余代码里出现（含注释引用——注释里点名也算“有人提”）
      const body = src.replace(/(?:^|\n)\s*import\s+[\s\S]*?\s+from\s+['"]\.[^'"]+['"]/g, '\n')
      if (!new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(body)) {
        unused.push(`${f}: import { ${name} } from '${spec}' —— 绑定未在文件其余部分出现`)
      }
    }
  }
  assert.deepEqual(unused, [], `发现未使用的相对 import（删掉即纯清理，不得留着）：\n${unused.join('\n')}`)
})

test('lib 静态自检 ②：不得存在**孤儿模块**（`lib/*.js` 必须被 lib 内某处引用）', () => {
  const referenced = new Set()
  for (const f of libFiles) {
    const src = readFileSync(join(LIB, f), 'utf8')
    for (const spec of relSpecifiers(src)) {
      const abs = join(LIB, spec)
      const base = abs.endsWith('.js') || abs.endsWith('.mjs') ? abs.replace(/\\/g, '/').split('/').pop() : null
      if (base && libFiles.includes(base)) referenced.add(base)
      // 目录形态（如 './commands.js' 之外的可能写法）不做模糊匹配——本包 lib 内全部为同目录文件
    }
  }
  // v18.90.0（运行面板批）：**浏览器半边不由 import 图引用**——官方契约是「客户端模块系统按
  //   `package.json` 的 `exports["./client"]` 把构建产物送给页面」（出处：官方
  //   `docs/cookbook/adding-a-settings-card.zh.md` §5「浏览器半侧挂在哪里」），故 manifest 声明的
  //   lib 内文件同样算「有人引用」；否则 `lib/client.js` 会被误判成「会随包发布却永不执行」的死模块。
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  for (const v of Object.values(pkg.exports || {})) {
    const s = typeof v === 'string' ? v : (v && typeof v === 'object' ? Object.values(v)[0] : null)
    if (typeof s !== 'string') continue
    const base = s.replace(/\\/g, '/').split('/').pop()
    if (base && libFiles.includes(base)) referenced.add(base)
  }
  const orphans = libFiles.filter((f) => !referenced.has(f))
  // 入口自身必然无人 import（它是包入口）——单列，不算孤儿
  const notOrphan = new Set(['index.js'])
  assert.deepEqual(
    orphans.filter((f) => !notOrphan.has(f)),
    [],
    `lib/ 下存在无人引用的模块（会随包发布却永不执行）：${orphans.filter((f) => !notOrphan.has(f)).join(', ')}`
    + `（当前引用图：${[...referenced].sort().join(', ') || '空'}）`,
  )
  assert.ok(libFiles.includes('index.js') && existsSync(join(LIB, 'index.js')), '入口必须存在（否则本判据退化为空集断言）')
})

// ── `lib/**` **文案门**（v18.88.0-prep · 结构性债「lib/** 文案门」落地）──────────────────────────
//   **为什么需要**：`lib/tools.js` 里工具的 `description` 是**调用方实际读到的文案**，而它声明的
//   「本工具面未暴露哪些旗标」与 `TOOL_FACE_FLAG_GAPS` 表**此前无任何对账**。两处漂移的后果已在真实
//   报告里出现过：台海反哺（综合版）F-9 把**从未注册为工具**的 `g-audit-check` / `disproofs-check`
//   列为「工具面未暴露的 flag gap」——正是因为**没有任何一条判据**问过「表里的工具真的注册了吗」。
//   本组三条判据（零依赖、纯源码解析；与既有两条同址，同属「lib 静态自检」归属）：
//     ① **集合对账**：`TOOL_FACE_FLAG_GAPS` 的键集合 == 实际注册的 `lunheng_*` 工具名集合
//        （防「表里列了不存在的工具」与「注册了新工具忘了登记」两个方向）；
//     ② **文案 ↔ 表一致**：表里登记的非空旗标，必须在**该工具的描述文本**里以 CLI 形态出现
//        （`figDir` → `--fig-dir`）；表里为**空**的工具，描述**不得**出现「工具面未暴露」字样
//        （防反向漂移：描述说没暴露、从而误导调用方绕开工具）；
//     ③ **文案不得与实现矛盾**：表里登记的旗标**不得**出现在该工具的 `parameters` 里
//        （「说没暴露却真能传」是最坏的一种——调用方按文案绕开、而实际支持）。
//   **边界（如实）**：只核这三类**可机械判定**的关系，不判描述的自然语言质量、不判措辞风格。
const TOOLS_SRC = readFileSync(join(LIB, 'tools.js'), 'utf8')

/** 解析 `TOOL_FACE_FLAG_GAPS`：`{ 工具名: ['旗标', …] }`。 */
function parseFlagGaps() {
  const block = TOOLS_SRC.match(/TOOL_FACE_FLAG_GAPS = Object\.freeze\(\{([\s\S]*?)\n\}\)/)
  assert.ok(block, '未能定位 TOOL_FACE_FLAG_GAPS 表——解析失效时本组用例必须红，不得静默空集')
  const out = {}
  for (const line of block[1].split('\n')) {
    const m = /(?:'([\w]+)'|(\w+)):\s*Object\.freeze\(\[([^\]]*)\]\)/.exec(line)
    if (!m) continue
    out[m[1] || m[2]] = m[3].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  }
  return out
}

/** 每个注册工具的 `{ name, slice }`（slice = 从该工具 name 起、到下一个工具 name 前）。 */
function toolSlices() {
  const names = [...TOOLS_SRC.matchAll(/\bname:\s*'(lunheng_\w+)'/g)]
  return names.map((m, i) => ({
    name: m[1],
    slice: TOOLS_SRC.slice(m.index, i + 1 < names.length ? names[i + 1].index : TOOLS_SRC.length),
  }))
}

/** 取某工具 `parameters: { … }` 块的键名（花括号配对，避免误取 output.schema.properties）。 */
function paramKeys(slice) {
  const at = slice.indexOf('parameters: {')
  if (at < 0) return []
  const open = slice.indexOf('{', at)
  let depth = 0
  let end = -1
  for (let i = open; i < slice.length; i++) {
    if (slice[i] === '{') depth++
    else if (slice[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  assert.ok(end > 0, '未能定位 parameters 块结束（解析失效必须红）')
  return [...slice.slice(open, end).matchAll(/^\s{4,8}(\w+):\s*\{/gm)].map((m) => m[1])
}

const dash = (s) => '--' + s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

test('lib 文案门①：TOOL_FACE_FLAG_GAPS 的键集合 == 实际注册的工具名集合（两个方向都判）', () => {
  const gaps = parseFlagGaps()
  const registered = new Set(toolSlices().map((t) => t.name))
  const tabled = new Set(Object.keys(gaps))
  assert.ok(registered.size >= 4, `注册工具数异常（${registered.size}）——本判据会退化为空集断言`)
  const tabledNotRegistered = [...tabled].filter((n) => !registered.has(n))
  const registeredNotTabled = [...registered].filter((n) => !tabled.has(n))
  assert.deepEqual(tabledNotRegistered, [],
    `TOOL_FACE_FLAG_GAPS 列了**未注册**的工具：${tabledNotRegistered.join(', ')}——`
    + '正是台海反哺 F-9 把 `g-audit-check` / `disproofs-check` 误列为「工具面 flag gap」的那一类')
  assert.deepEqual(registeredNotTabled, [],
    `注册了工具但未登记旗标缺口：${registeredNotTabled.join(', ')}——新增工具须同批登记（表是调用方的唯一提示面）`)
})

test('lib 文案门②：描述里声明的「未暴露旗标」必须与表逐项一致（空表不得声称未暴露）', () => {
  const gaps = parseFlagGaps()
  for (const { name, slice } of toolSlices()) {
    const declared = gaps[name] || []
    const claimsGap = /工具面未暴露/.test(slice)
    if (declared.length === 0) {
      assert.ok(!claimsGap,
        `${name} 在表中**无**旗标缺口，描述却声称「工具面未暴露」——反向漂移会误导调用方绕开工具`)
      continue
    }
    for (const flag of declared) {
      assert.ok(slice.includes(dash(flag)),
        `${name} 的旗标缺口 ${flag}（CLI 形态 ${dash(flag)}）未出现在描述里——`
        + '表与**调用方实际读到的文案**漂移；两处必须同批改')
    }
  }
})

test('lib 文案门③：表中登记的「未暴露」旗标不得出现在该工具的 parameters（说没有却真能传）', () => {
  const gaps = parseFlagGaps()
  for (const { name, slice } of toolSlices()) {
    const keys = paramKeys(slice)
    const declared = gaps[name] || []
    const leaked = declared.filter((f) => keys.includes(f))
    assert.deepEqual(leaked, [],
      `${name} 的 parameters 里出现了表称「未暴露」的旗标：${leaked.join(', ')}——`
      + '「文案说没有、实现却支持」是最坏漂移（调用方按文案绕开工具去直调脚本）')
  }
})
