// 「同一模块两份副本」的同源对账（v18.80.0 · 全量审计-v18.79.1）
//
// **为什么需要**：本仓有一个**刻意**的双副本格局——`scripts/_lib/source-mask.mjs`（仓库根，供
//   `scripts/_lib/exit-resolution.mjs` 的 B7 修法使用）与
//   `skills/lunheng-article-pipeline/scripts/_lib/source-mask.mjs`（**随包**，供一致性规则 ㉚ 使用）。
//   必须两份而不是一份的理由：
//     · 一致性规则跑在 `tests/**` 的 **mkRepo 临时仓库**里（只复制 `skills/` + 少量包级清单，
//       **不含**仓库根 `scripts/`）→ 跨层 import 会让所有注入用例 `ERR_MODULE_NOT_FOUND`
//       （v18.80.0 首版实测：19 条用例同批变红）；
//     · 仓库根的 `exit-resolution` 又不随包 → 不能反过来只留包内那份。
//   **双副本的代价是漂移**（这正是本仓「一事实一处」纪律要防的形态）。本用例就是它的**唯一**防线：
//   两份必须**逐字节相同**。改其中一份而忘了另一份 → 本用例红。
//
// 边界（如实）：用例只在**两份都在盘**时断言（从 npm 包内跑测试时仓库根 `scripts/` 不存在，
//   此时跳过——那种环境下本来也只有一份，不构成漂移风险）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')
const PAIRS = [
  [
    join(REPO_ROOT, 'scripts', '_lib', 'source-mask.mjs'),
    join(REPO_ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', '_lib', 'source-mask.mjs'),
  ],
]

test('SYNC-1 双副本模块必须逐字节同源（改一份忘另一份 = 漂移，本用例即防线）', () => {
  for (const [a, b] of PAIRS) {
    const rel = (p) => p.slice(REPO_ROOT.length + 1).replace(/\\/g, '/')
    if (!existsSync(a) || !existsSync(b)) {
      // 包内（发布物）环境只有一份——不构成漂移风险，如实不判
      continue
    }
    const sa = readFileSync(a, 'utf8')
    const sb = readFileSync(b, 'utf8')
    assert.equal(
      sb,
      sa,
      `${rel(b)} 与 ${rel(a)} **内容不同**——这两份是同一模块的两处副本（前者随包、供一致性规则 ㉚；` +
        '后者仅供仓库根 exit-resolution）。本仓的「一事实一处」纪律不允许同源内容有两份不同实现。' +
        '修法：把改动同步到两份（或把其中一份改成 `export * from` 另一份——但那样在 mkRepo 临时仓库里会断，' +
        '见本文件头注释，故**保持两份逐字相同**是当前唯一可行形态）。',
    )
  }
})

test('SYNC-2 对账不得因「两份都不在」而静默变成恒真', () => {
  // 防空转：至少有一对是真的在盘上被判过的——否则上面的循环可能一次都没进（文件改名/移动即触发）。
  const onDisk = PAIRS.filter(([a, b]) => existsSync(a) && existsSync(b))
  assert.ok(onDisk.length > 0, 'PAIRS 里没有任何一对同时在盘——source-mask 的副本对账已失效（路径改名了？）')
})
