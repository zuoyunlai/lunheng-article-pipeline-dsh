// 门运行状态四态判定的回归网（v18.80.4 · 审计优化方向 4 落地 · 批 B）
//
// **为什么需要**：`_lib/gate-result.mjs` 是 P1-8 那类缺陷（「门没跑通」被记成「缺数据 N/A」）的
//   **单一真源判据**，被 `quality-score.mjs` 五处消费。判据分头写就会漏，收口之后**判据本身**必须
//   有直接测试——否则下一次「顺手改一个分支」又会把 invalid 放开成 ok。
//
// 本文件钉三件事：
//   ① 四态**边界**（尤其 `status=3`（仅 P2·软提示）必须仍是 ok——它是**内容判定档**不是运行错误）；
//   ② `70` 的两种载体（进程码 / JSON 字段）**都**判 invalid；
//   ③ 「跑通但无 JSON」判 invalid（**不得**被消费方读成 N/A）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyGateRun, explainGateRun, isUsableGateRun, GATE_RUN_KINDS, GATE_INTERNAL_ERROR_EXIT } from '../skills/lunheng-article-pipeline/scripts/_lib/gate-result.mjs'

test('门状态 ①：内容判定档（exit 0/1/2/3）**都是 ok**——不得把「有 P0/P1/P2」误判成运行错误', () => {
  for (const code of [0, 1, 2, 3]) {
    const cls = classifyGateRun({ status: code, json: { exit: code, total: 24 } })
    assert.equal(cls.kind, 'ok', `exit ${code} 是内容判定档，必须判 ok：` + JSON.stringify(cls))
    assert.equal(isUsableGateRun(cls), true)
  }
})

test('门状态 ②：内部错误（70）的**两种载体**都判 invalid', () => {
  const byProc = classifyGateRun({ status: GATE_INTERNAL_ERROR_EXIT, json: { exit: 70, total: 24 } })
  assert.equal(byProc.kind, 'invalid', '进程 70 → invalid')
  const byJson = classifyGateRun({ status: 1, json: { exit: 70, total: 24 } })
  assert.equal(byJson.kind, 'invalid', 'JSON exit=70（进程非 70）→ 必须也判 invalid（P1-8 的病灶形态）')
  assert.match(explainGateRun(byJson), /内部错误/, '说明里要点名内部错误')
})

test('门状态 ③：子进程未起 / 无退出码 / 有 error → unavailable（≠ invalid，报错可读性）', () => {
  assert.equal(classifyGateRun({ status: null, json: null }).kind, 'unavailable')
  assert.equal(classifyGateRun({ status: null, error: 'EPERM', json: null }).kind, 'unavailable')
  assert.match(classifyGateRun({ status: null, error: 'EPERM' }).reason, /EPERM/, '须透传 error 原文，不推断原因')
})

test('门状态 ④：跑通了但**无 JSON** → invalid（不得当 N/A）', () => {
  const cls = classifyGateRun({ status: 1, json: null })
  assert.equal(cls.kind, 'invalid', '无 JSON = 没有可判定产物 → invalid')
  assert.match(explainGateRun(cls), /未产出可解析 JSON/)
})

test('门状态 ⑤：调用方声明不适用 → not_applicable（唯一「不进分母」态）', () => {
  const cls = classifyGateRun({ status: null, json: null, applicable: false })
  assert.equal(cls.kind, 'not_applicable')
  assert.equal(isUsableGateRun(cls), false)
})

test('门状态 ⑥：四态枚举封闭 + jsonExit 透传（供 detail 复算）', () => {
  const kinds = new Set([
    classifyGateRun({ status: 0, json: {} }).kind,
    classifyGateRun({ status: 70, json: {} }).kind,
    classifyGateRun({ applicable: false }).kind,
    classifyGateRun({ status: null }).kind,
  ])
  for (const k of kinds) assert.ok(GATE_RUN_KINDS.includes(k), `kind 必须在枚举内：${k}`)
  assert.equal(classifyGateRun({ status: 2, json: { exit: 2 } }).jsonExit, 2, 'jsonExit 须透传（供 detail 复算）')
  assert.equal(classifyGateRun({ status: 2, json: { mechanical: 2 }, exitKey: 'mechanical' }).jsonExit, 2,
    'exitKey 可定制（不同门的报告字段名不同）')
})
