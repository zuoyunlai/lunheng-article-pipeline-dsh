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
