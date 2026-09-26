// 退出码静态解析器回归网（v18.18.11 新增 · 审计 A-7③）
//
// 审计 A-7③ 要求把「动态 exit」从「文件里出现过即认」收紧成「三元/条件式里的数字字面量 ⊆ 声明集」，
// 并配回归用例。本文件钉住三件事：
//   ① 解析器本身的三个坑（本次一口气踩出来的，见 `_lib/exit-resolution.mjs` 头注释）；
//   ② 审计要的那条参数化用例——**每个随包脚本的可得退出码 ⊆ EXIT_CONTRACT 声明集**；
//   ③ 真实树上的两个具体结论（methodology-check 可达 3 / structure-check 可达 2,3）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExitCodes, parseGuardConsts } from '../scripts/_lib/exit-resolution.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const S = (p) => join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', p)
const GUARD = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', '_lib', 'exit-guard.mjs')
const guardConsts = parseGuardConsts(readFileSync(GUARD, 'utf8'))
const codes = (src) => [...resolveExitCodes(src, guardConsts).resolved].sort((a, b) => a - b)

test('坑①：赋值不止初值——`let x = 0; … x = 3; process.exit(x)` 两个都算', () => {
  const src = ['let exitCode = 0', 'if (a) exitCode = 3', 'process.exit(exitCode)'].join('\n')
  assert.deepEqual(codes(src), [0, 3])
})

test('坑②：`let a = <未解变量>` 时**必须仍判动态**，不能当成「已完全解析」', () => {
  const r = resolveExitCodes(['let finalExit = exitCode', 'process.exit(finalExit)'].join('\n'), guardConsts)
  assert.equal(r.dynamic, true, '赋值来自另一个解不出的变量 → 静态看不见，必须如实标动态')
  assert.deepEqual([...r.resolved], [], '不应凭空产出任何码')
})

test('坑③：**复合实参不追标识符**——`ok ? 0 : 1` 不得把条件里的阈值当退出码', () => {
  // 实测踩过：`ok` 被追到 `ok = … && counts.Page >= 5 && …`，把**页数阈值 5** 报成「表外退出码 5」。
  const src = [
    "const ok = header.startsWith('%PDF-') && counts.Page >= 5 && counts.Font >= 1",
    'process.exit(ok ? 0 : 1)',
  ].join('\n')
  const got = codes(src)
  assert.deepEqual(got, [0, 1], `复合实参只应取其分支字面量；实测 ${JSON.stringify(got)}（若含 5 即为误抓阈值）`)
})

test('裸标识符内联：`const exitCode = a ? 0 : (b ? 2 : (c ? 1 : 3))` 四个分支都算', () => {
  const src = ['const exitCode = allPass ? 0 : (hasP0 ? 2 : (hasP1 ? 1 : 3))', 'process.exit(exitCode)'].join('\n')
  assert.deepEqual(codes(src), [0, 1, 2, 3])
})

test('guard 常量与 `process.exitCode =` 赋值形态都要认', () => {
  const r = resolveExitCodes('process.exitCode = 4', guardConsts)
  assert.ok(r.resolved.has(4), '`process.exitCode = N` 与 `process.exit(N)` 在 Node 里同样生效')
  const g = resolveExitCodes('process.exit(EXIT_USAGE)', guardConsts)
  assert.ok(g.resolved.has(10), 'guard 导出的 EXIT_USAGE = 10 应被解析出来')
})

/** 从 repo-hygiene 源码解析 `EXIT_CONTRACT`（逐脚本）。 */
function parseContract() {
  const src = readFileSync(join(ROOT, 'scripts', 'repo-hygiene-check.mjs'), 'utf8')
  const block = src.slice(src.indexOf('const EXIT_CONTRACT = {'), src.indexOf('\n}', src.indexOf('const EXIT_CONTRACT = {')))
  const map = new Map()
  for (const m of block.matchAll(/^\s{2}'([^']+)':\s*\[([^\]]*)\]/gm)) {
    map.set(m[1], m[2].split(',').map((s) => Number(s.trim())).filter(Number.isFinite))
  }
  return map
}

test('审计要的参数化用例：**每个随包脚本的可得退出码 ⊆ EXIT_CONTRACT 声明集**', () => {
  const contract = parseContract()
  assert.ok(contract.size >= 20, `契约表解析出 ${contract.size} 个脚本——过少说明解析退化，本用例会空过`)

  const violations = []
  let dynamicCount = 0
  for (const [name, allowed] of contract) {
    const { resolved, dynamic } = resolveExitCodes(readFileSync(S(name), 'utf8'), guardConsts)
    if (dynamic) dynamicCount++
    // 装了 guard 的脚本其异常路径由 guard 统一映射为 10 / 70
    const extra = [...resolved].filter((c) => !allowed.includes(c) && c !== 10 && c !== 70)
    if (extra.length) violations.push(`${name} 使用了表外退出码 ${extra.sort((a, b) => a - b).join(', ')}（已声明 ${allowed.join('/')}）`)
  }
  assert.deepEqual(violations, [], `退出码契约表漏登记：\n${violations.map((v) => '  · ' + v).join('\n')}`)
  assert.ok(dynamicCount >= 1, '一个动态 exit 脚本都没有——说明判据退化成了「全部静态可判定」，需复核')
})

test('真实树结论：methodology-check 可达 3；structure-check 可达 2 与 3（A-7 当时漏了）', () => {
  assert.ok(codes(readFileSync(S('methodology-check.mjs'), 'utf8')).includes(3), 'methodology-check 的 exitCode 三元可达 3（仅 P2 软提示）')
  const sc = codes(readFileSync(S('structure-check.mjs'), 'utf8'))
  assert.ok(sc.includes(2) && sc.includes(3), `structure-check 与 methodology-check 同形，应可达 2 与 3；实测 ${JSON.stringify(sc)}`)
})
