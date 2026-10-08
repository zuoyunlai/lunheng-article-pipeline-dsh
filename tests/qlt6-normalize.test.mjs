// `normalizePanel`（QLT-6 ① 分量的归一化）回归（v18.80.4 · QLT-6 跨体例盲评批）
//
// **为什么单独钉它**：跨体例盲评要**离线**把盲评件的 `总评分 XX/30` 喂进①，故该式子从
//   `qlt6.mjs` 的内联常量**导出为单一真源**（`scripts/qlt6-blind-analysis.mjs` import 它）——
//   若分析脚本另写一份公式，就会出现「同一事实两处实现」的经典漂移。
//   本文件同时把**实测暴露的边界**写死：**16 分及以下一律饱和为 0**（下限 = 「reject 上界」），
//   故 ① 在 15/30 与 16/30 上**完全不可区分**——这条是本次跨体例盲评的实质发现之一，必须可复算。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCRIPTS } from './_fixtures.mjs'

const QLT6 = await import(pathToFileURL(join(SCRIPTS, '_lib', 'qlt6.mjs')).href)

test('normalizePanel：口径 = clamp((总分 − 16) / 14, 0, 1)，且**导出为单一真源**', () => {
  assert.equal(typeof QLT6.normalizePanel, 'function', '必须导出（离线复算台 import 它，杜绝第二份公式）')
  assert.equal(QLT6.normalizePanel(30), 1, '满分 30 → 1')
  assert.equal(QLT6.normalizePanel(23), 0.5, '(23−16)/14 = 0.5')
  assert.equal(+QLT6.normalizePanel(20).toFixed(4), 0.2857, '(20−16)/14 ≈ 0.2857')
})

test('normalizePanel：**下界饱和**——16 分及以下一律 0（低分段不可区分，实测边界）', () => {
  assert.equal(QLT6.normalizePanel(16), 0, '16 = reject 上界 → 0')
  assert.equal(QLT6.normalizePanel(15), 0, '15 → 0（与 16 不可区分）')
  assert.equal(QLT6.normalizePanel(0), 0, '更低的分数同样 0（clamp 下界）')
  // 上界同理：>30 与 30 不可区分（现实不会出现，但口径要写死）
  assert.equal(QLT6.normalizePanel(31), 1)
})

test('normalizePanel：单调不减（分数越高 ① 越大或持平）', () => {
  let prev = -1
  for (let t = 0; t <= 30; t++) {
    const v = QLT6.normalizePanel(t)
    assert.ok(v >= prev, `t=${t} 处出现下降：${v} < ${prev}`)
    assert.ok(v >= 0 && v <= 1, `t=${t} 越界：${v}`)
    prev = v
  }
})
