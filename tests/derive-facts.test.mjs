// S1 第一步的回归：受管数字（M 门项数 / 常驻集上限 / T8 清单件数）必须只有一个出口。
// 本文件测**纯函数**（`collectFacts` 的真值关系 + `checkDocs` 的判定），不复制真值——
// 把 25 / 62464 这类字面量写进测试 = 再造一份手抄副本，正是本项要消灭的东西。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectFacts, checkDocs } from '../scripts/derive-facts.mjs'

const FACTS = { m_gate_mech: 25, m_gate_total: 26, always_limit_bytes: 62464, t8_min_artifacts: 5 }
const CLEAN = { skill: '……机检 25 项……总 26 项……', ops: '上限的唯一真源 = repo-hygiene-check.mjs 的 ALWAYS_LIMIT 常量', finalizer: '清单（路径逐字，按交付重要性排）' }

test('S1 真值关系：total = mech + 1；各值可用', () => {
  const f = collectFacts()
  assert.equal(f.schema, 1)
  assert.ok(Number.isInteger(f.m_gate_mech) && f.m_gate_mech > 0, '机检项数必须是正整数')
  assert.equal(f.m_gate_total, f.m_gate_mech + 1, '总项 = 机检 + 1（人工项 M-Integrity-2）')
  assert.ok(f.always_limit_bytes > 0, '常驻集上限必须能读出来')
  assert.ok(f.t8_min_artifacts >= 1, 'T8 清单至少 1 件')
  assert.ok(f.script_count > 0 && f.template_count > 0)
})

test('S1 干净文档：无冲突', () => {
  assert.deepEqual(checkDocs(FACTS, CLEAN), [])
})

test('S1 冲突：SKILL 的机检项数写错 → 报出（不静默）', () => {
  const issues = checkDocs(FACTS, { ...CLEAN, skill: '机检 24 项…总 26 项' })
  assert.equal(issues.length, 1)
  assert.match(issues[0], /24.*25|25.*24/, '须同时点名手抄值与派生值：' + issues[0])
})

test('S1 冲突：SKILL 的总项写错 → 报出', () => {
  const issues = checkDocs(FACTS, { ...CLEAN, skill: '机检 25 项…总 27 项' })
  assert.equal(issues.length, 1)
  assert.match(issues[0], /总 27 项/)
})

test('v19.27.3（反哺 2026-10-22 P2-6）：**同文后续矛盾**也必须报——不得只看第一处', () => {
  // 病灶（探针实测）：旧实现用 `.exec` 只取首个匹配 → 「机检 25 项；总 26 项」在前、
  //   「机检 999 项；总 999 项」在后时 issues 仍为 []，即本门只证明了「第一处没漂」。
  // 判据：穷举全部同类声明；任一处不一致即报，且点名是第几处。
  const issues = checkDocs(FACTS, { ...CLEAN, skill: '机检 25 项；总 26 项。\n另处：机检 999 项，总 999 项。' })
  assert.equal(issues.length, 2, '两处矛盾都要报：' + JSON.stringify(issues))
  assert.ok(issues.some((x) => /999/.test(x) && /机检/.test(x)), '须点名后续「机检 999 项」')
  assert.ok(issues.some((x) => /999/.test(x) && /总/.test(x)), '须点名后续「总 999 项」')
  assert.ok(issues.some((x) => /第 2 处/.test(x)), '须给出命中序号，便于定位：' + JSON.stringify(issues))
})

test('v19.27.3（反哺 2026-10-22 P2-6）：**逆序**同样要报（错误在前、正确在后不得洗白）', () => {
  const issues = checkDocs(FACTS, { ...CLEAN, skill: '机检 999 项；总 26 项。\n其后：机检 25 项。' })
  assert.equal(issues.length, 1, '前段错误不得被后段正确值掩盖：' + JSON.stringify(issues))
  assert.match(issues[0], /第 1 处|999/)
})

test('S1 冲突：常驻集上限被写死（旧版 54 KB 的形态）→ 报出', () => {
  const issues = checkDocs(FACTS, { ...CLEAN, ops: '合计上限 **54.0 KB**（真源 = ALWAYS_LIMIT）' })
  assert.equal(issues.length, 1)
  assert.match(issues[0], /写死.*54\.0 KB|54\.0 KB/, '须点名被写死的值：' + issues[0])
})

test('S1 冲突：T8 清单写死件数（阿拉伯数字与中文数字都算）→ 报出', () => {
  for (const head of ['交付物最小清单（**五件，缺一 hard 20**', '交付物最小清单（**7 件，缺一 hard 20**']) {
    const issues = checkDocs(FACTS, { ...CLEAN, finalizer: head })
    assert.equal(issues.length, 1, `「${head}」必须被判出`)
    assert.match(issues[0], /件数/, '须点名件数问题：' + issues[0])
  }
})
