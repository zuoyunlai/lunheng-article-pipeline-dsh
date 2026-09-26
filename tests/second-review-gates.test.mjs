// 二次复审（v18.19.0 方案）M-2 / M-4 的**单点解析器**回归网。
//
// 为什么需要：这两条修法的共同形态是「**形状变了会抛错而非静默通过**」——
//   · M-2：`npm pack --json` 顶层形态随 npm 大版本变（≤11 数组 / 12 对象）。旧实现
//     `slice(indexOf('['))[0].files` 在对象形态下必抛 → `packFiles` 留空 → ⑦b 在空集上
//     **真空打印「发布物 0 处」合格字样**；3 处测试的 `catch { return }` 又把它当「环境不可用」吞掉。
//   · M-4：`troubleshooting.md §8` 的退出码有**两种载体**（配额散文 + 表格）。旧版只钉了散文，
//     实测把表里 `| 2 |` 改成 `| 12 |` 时**全套门绿**。
// 本文件把两条修法的判据钉在**解析器契约**上（正例 + 反例 + 形状不认识必抛）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePackManifest, isPackEnvUnavailable, PackManifestShapeError } from '../scripts/_lib/pack-manifest.mjs'
import { parseExitTable } from '../scripts/_lib/exit-namespace.mjs'

// ── M-2：pack 清单单点解析器 ────────────────────────────────────────────────
test('M-2 parsePackManifest：数组形态（npm ≤11）与对象形态（npm 12）**同解**', () => {
  const arr = JSON.stringify([{ files: [{ path: 'a' }, { path: 'b' }], unpackedSize: 123 }])
  const obj = JSON.stringify({ 'x-1.0.0.tgz': { files: [{ path: 'a' }, { path: 'b' }], unpackedSize: 123 } })
  assert.deepEqual(parsePackManifest(arr), { files: ['a', 'b'], unpackedSize: 123 })
  assert.deepEqual(parsePackManifest(obj), { files: ['a', 'b'], unpackedSize: 123 }, '对象形态（npm 12）必须与数组形态同解——这正是 M-2 修的点')
})

test('M-2 parsePackManifest：形状不认识必须**抛具名错误**（不得静默返回空集）', () => {
  const bad = [
    ['空输出', ''],
    ['非 JSON', 'npm ERR! 不是 JSON'],
    ['顶层是字符串', '"nope"'],
    ['对象有两个 tarball 键', JSON.stringify({ a: { files: [] }, b: { files: [] } })],
    ['对象里没有 files 数组', JSON.stringify({ 'x.tgz': {} })],
    ['数组里没有 [0].files 数组', JSON.stringify([{}])],
  ]
  for (const [label, src] of bad) {
    assert.throws(
      () => parsePackManifest(src),
      (e) => e instanceof PackManifestShapeError,
      `${label}：应抛 PackManifestShapeError（静默返回空集会重演「⑦b 真空合格」）`,
    )
  }
})

test('M-2 isPackEnvUnavailable：只有「环境不可用」才为真——形状错误**不得**被当成环境问题吞掉', () => {
  for (const code of ['ENOENT', 'EPERM', 'EACCES']) {
    assert.equal(isPackEnvUnavailable(Object.assign(new Error('x'), { code })), true, `${code} 应判为环境不可用（测试可 skip）`)
  }
  const shapeErr = new PackManifestShapeError('形状不认识')
  assert.equal(isPackEnvUnavailable(shapeErr), false, 'PackManifestShapeError **不是**环境不可用——旧 `catch { return }` 正是这样把 npm 12 的 TypeError 吞成 pass 的')
  assert.equal(shapeErr.code, undefined, '形状错误不该带 errno 码（否则会被 isPackEnvUnavailable 误判）')
})

// ── M-4：§8 表格码列解析器 ─────────────────────────────────────────────────
test('M-4 parseExitTable：解析 §8 表格的「码」列', () => {
  const doc = ['# T', '', '## 8. exit code 怎么看', '', '| 码 | 含义 |', '|---|---|', '| 0 | 通过 |', '| 1 | P1 |', '| 20 | 交接门 |', '', '> 注'].join('\n')
  assert.deepEqual(parseExitTable(doc), { line: 3, codes: [0, 1, 20] })
})

test('M-4 parseExitTable：§8 标题缺失 / 无表行 → **抛错**（形状变了绝不静默通过）', () => {
  assert.throws(() => parseExitTable('# T\n\n## 9. 别的\n'), /未找到 §8 标题/, '找不到 §8 应抛错')
  assert.throws(() => parseExitTable('## 8. exit code\n\n没有任何表格行\n'), /未解析出任何/, '解析出 0 行应抛错（否则本门静默失效）')
})

test('M-4 真实树：§8 表格码集合 == EXIT_CONTRACT 码集合（三方一致的桩）', async () => {
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { parseExitContract } = await import('../scripts/_lib/exit-namespace.mjs')
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
  const contract = parseExitContract(readFileSync(join(ROOT, 'scripts/repo-hygiene-check.mjs'), 'utf8'))
  const table = parseExitTable(readFileSync(join(ROOT, 'docs/troubleshooting.md'), 'utf8'))
  assert.deepEqual(table.codes, contract.codes, '§8 表格的码必须与 EXIT_CONTRACT 逐码相等（缺行 / 多行都算漂移——表是主控的阅读入口）')
})
