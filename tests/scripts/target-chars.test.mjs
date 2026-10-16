// 目标字数解析 `_lib/target-chars.mjs` 回归网（v19.8.x · policy 真试跑反哺 F-1）
//
// **为什么需要**：该模块此前在 `tests/**` 里**零覆盖**——`parseTargetCandidates`（供审计视图取候选最大值）
//   与 `parseTargetChars`（供 G8 字数硬阈）两函数对同一输入**不一致**，正是零覆盖导致的：
//   `parseTargetCandidates` 的数字正则**没剥千分位逗号**，`**6,000 字**，区间 **5,880–6,120**` 被拆成
//   6/000/5/880/6/120，只有 880 落在 [MIN_TARGET, MAX_TARGET] → 候选 `[880]`（假超限）；只写 `**6,000 字**`
//   时连 880 都没有 → `[]`（静默跳过）。而 `parseTargetChars` 的 plain 分支早已 `raw.replace(/,/g,'')` → 返回 6000。
//
// 本文件钉：
//   · **F-1 主回归**：千分位必须剥除 → 候选含完整值（6000/5880/6120），不再出现 880 或空。
//   · **两函数一致性**：对同一合法输入，`parseTargetChars.value` 必须落在 `parseTargetCandidates.candidates` 内。
//   · **既有形态不回归**：万单位 / 表格形态 / 目标族字段优先（v18.73.0 F-13 钉过的语义）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { SCRIPTS } from '../_fixtures.mjs'

const { parseTargetChars, parseTargetCandidates } = await import(pathToFileURL(join(SCRIPTS, '_lib', 'target-chars.mjs')).href)

test('F-1：粗体+千分位+区间 → 候选完整、不再误解析 880', () => {
  const text = '- **目标篇幅**：**6,000 字（纯中文字符数，口径 A）**，区间 **5,880–6,120**（±2%）'
  const c = parseTargetCandidates(text)
  assert.deepEqual(c.candidates, [5880, 6000, 6120], '候选应含完整三个值，不得只剩 880')
})

test('F-1：只写粗体千分位 → 不再静默跳过（[]）', () => {
  const text = '- **目标篇幅**：**6,000 字（纯中文字符数，口径 A）**'
  const c = parseTargetCandidates(text)
  assert.deepEqual(c.candidates, [6000], '剥逗号后 6000 应入候选，不再空')
})

test('两函数一致性：parseTargetChars 单值 ∈ parseTargetCandidates 候选', () => {
  const cases = [
    '- **目标篇幅**：**6,000 字（纯中文字符数，口径 A）**，区间 **5,880–6,120**（±2%）',
    '- **目标篇幅**：**6,000 字**',
    '- **目标篇幅**：6000 字（±2%）',
    '- **篇幅**：1.2 万 字',
    '- **篇幅**：3000-5000 字（标准档）',
    '- **总字数**：6000 字（±5%，容差 5700-6300）',
  ]
  for (const text of cases) {
    const c = parseTargetCandidates(text)
    const v = parseTargetChars(text)
    if (c.candidates.length > 0 && v.value !== null) {
      assert.ok(c.candidates.includes(v.value), `「${text}」→ 单值 ${v.value} 应落在候选 ${JSON.stringify(c.candidates)} 内`)
    }
  }
})

test('既有形态不回归：万单位', () => {
  const c = parseTargetCandidates('- **篇幅**：1.2 万 字')
  assert.deepEqual(c.candidates, [12000])
})

test('既有形态不回归：表格形态（无冒号）', () => {
  const c = parseTargetCandidates('| 篇幅 | 约 8000 字（中文） |')
  assert.ok(c.candidates.includes(8000), `表格形态应取到 8000，实得 ${JSON.stringify(c.candidates)}`)
})

test('既有形态不回归：目标族字段优先（v18.73.0 F-13）', () => {
  const text = '- **篇幅**: ≥5000（全量流水线档）；**字数三线制**：\n- **目标正文 12000 汉字**（首要落点…）'
  const c = parseTargetCandidates(text)
  assert.deepEqual(c.candidates, [12000], '「目标正文」族字段应优先于裸「篇幅」，取 12000')
})
