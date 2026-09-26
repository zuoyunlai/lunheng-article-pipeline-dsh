// 发布面负清单匹配器回归网（v18.18.3 新增 · 审计 D-1②）
//
// 为什么需要：D-1 的漏检**不是**「忘了排除两个文件」，而是**门的匹配口径**——
// 两处门都用 `f.startsWith('tests/')`（只看仓库根），于是
// `skills/lunheng-commands/tests/route.test.mjs`（22 用例）与嵌套 `package.json`
// 随包时，`pack-smoke` 与 `repo-hygiene` **照打印「仓库向文件零污染」**。
// 修掉那两个具体文件只治症。本文件钉住的是**口径本身**。
//
// 本文件同时是「过度收紧」的防线：把负清单改成一律 any-层级会误伤
// `skills/**/scripts/`（随包脚本本体），发布物直接残废——见下方脚本作用域用例。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanShipped, NEGATIVE, describeViolations } from '../scripts/_lib/pack-negative.mjs'

const hitsFor = (name, files) => scanShipped(files).find((v) => v.name === name).hits

test('负清单自身形态：每条都显式声明 scope 与 why（防「笼统 any 层级」回归）', () => {
  assert.ok(NEGATIVE.length >= 5, `负清单条目过少（实测 ${NEGATIVE.length}）——可能被误删`)
  for (const e of NEGATIVE) {
    assert.ok(['root', 'any', 'nested'].includes(e.scope), `${e.name} 的 scope 非法：${e.scope}`)
    assert.ok(['dir', 'file'].includes(e.kind), `${e.name} 的 kind 非法：${e.kind}`)
    assert.ok(e.why && e.why.length > 10, `${e.name} 缺 why（改这条口径的人必须看得到理由）`)
  }
})

test('D-1 正向：任意层级的 tests/ 与嵌套 package.json 必须命中（旧前缀口径会漏）', () => {
  // 这两条就是 D-1 实测随包的那两个文件
  assert.deepEqual(hitsFor('tests', ['skills/lunheng-commands/tests/route.test.mjs']), [
    'skills/lunheng-commands/tests/route.test.mjs',
  ])
  assert.deepEqual(hitsFor('package.json', ['skills/lunheng-commands/package.json']), ['skills/lunheng-commands/package.json'])
  // 仓库根形态同样命中
  assert.deepEqual(hitsFor('tests', ['tests/scripts.test.mjs']), ['tests/scripts.test.mjs'])
  // 阴性对照：旧口径对上面两条**一个都不命中**——本用例存在的意义
  const oldPrefix = (f) => ['tests/', 'scripts/', '.github/'].some((d) => f.startsWith(d))
  assert.equal(oldPrefix('skills/lunheng-commands/tests/route.test.mjs'), false, '旧前缀口径本应漏掉该路径（若此处为 true 说明对照写错了）')
})

test('root 作用域：`scripts` 只排仓库根，不误伤随包脚本本体（过度收紧防线）', () => {
  const shippedScripts = [
    'skills/lunheng-article-pipeline/scripts/m-gate-check.mjs',
    'skills/lunheng-article-pipeline/scripts/_lib/exit-guard.mjs',
    'skills/lunheng-commands/scripts/route-command.mjs',
  ]
  assert.deepEqual(hitsFor('scripts', shippedScripts), [], 'skills/**/scripts/ 是随包脚本本体，被排掉会让发布物失去全部机检能力')
  assert.deepEqual(hitsFor('scripts', ['scripts/pack-smoke.mjs', 'scripts/_lib/pack-negative.mjs']), [
    'scripts/pack-smoke.mjs',
    'scripts/_lib/pack-negative.mjs',
  ])
})

test('nested 作用域：根 package.json 必须放行（npm 强制且必需）', () => {
  assert.deepEqual(hitsFor('package.json', ['package.json']), [], '根 package.json 排除掉会让 npm 包无法安装')
})

test('反向：真实发布物清单必须零命中（防「门自己写了个恒真断言」）', async (t) => {
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { readPackManifest, isPackEnvUnavailable } = await import('../scripts/_lib/pack-manifest.mjs') // M-2/O-3
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
  let files
  try {
    files = readPackManifest(ROOT).files // 单点解析器（数组 ≤npm11 / 对象 npm12+）
  } catch (e) {
    // O-5：只有「环境不可用」才 skip（可见）；形状不认识一律照抛——旧 `catch { return }` 会吞成 pass。
    if (isPackEnvUnavailable(e)) return t.skip('受限会话禁子进程 / npm 不可用')
    throw e
  }
  assert.ok(files.length > 100, `pack 清单过少（实测 ${files.length}）——派生失败会让本断言恒真`)
  const violations = describeViolations(scanShipped(files))
  assert.deepEqual(violations, [], `真实发布物出现仓库向内容：\n${violations.join('\n')}`)
})
