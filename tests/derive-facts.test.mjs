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

// ── v19.27.13（反哺 2026-10-26 G-1）：README 复述层对账的回归钉 ─────────────────
//   每条都用**修复前的真实旧文案**做负对照（反哺报告 F-1/F-4/F-5 的实测形态）。
const G1_FACTS = {
  ...FACTS,
  command_count: 13,
  config_keys: ['quiet', 'allowMechanismEdit', 'scriptTimeoutMs', 'scriptMaxOutputBytes', 'handoffLevel', 'hookRewriteContent', 'hookMaxBlockChars', 'hookMaxTotalChars', 'ethicsHook', 'panel'],
  panel_default: true,
  config_env_mirrors: ['LUNHENG_ALLOW_MECH_EDIT', 'LUNHENG_PANEL', 'LUNHENG_QUIET'],
}
const G1_CLEAN_LINE = 'covers `quiet`, `allowMechanismEdit`, `scriptTimeoutMs`, `scriptMaxOutputBytes`, `handoffLevel`, `hookRewriteContent`, `hookMaxBlockChars`, `hookMaxTotalChars`, `ethicsHook`, and `panel` (v18.90.0; **on by default since v18.93.0**) mirrored by `LUNHENG_QUIET` / `LUNHENG_ALLOW_MECH_EDIT` / `LUNHENG_PANEL`'
const G1_CLEAN_CMD = '13 `/lunheng-*` slash commands (draft / resume / cite / audit / journal / ppt / history / rollback / status / stats / gate / abort / help)'
const G1_CLEAN = { ...CLEAN, readmeEn: G1_CLEAN_LINE + '\n' + G1_CLEAN_CMD }

test('G-1 干净复述层：无冲突（真值关系不复制文档数字之外的判断）', () => {
  assert.deepEqual(checkDocs(G1_FACTS, G1_CLEAN), [])
})

test('G-1 冲突：panel 默认值反转（off by default、无 v18.93.0 锚点）→ 报出（F-1 形态）', () => {
  const issues = checkDocs(G1_FACTS, { ...G1_CLEAN, readmeEn: G1_CLEAN_LINE.replace('**on by default since v18.93.0**', '**off** by default') + '\n' + G1_CLEAN_CMD })
  assert.equal(issues.length, 1)
  assert.match(issues[0], /v18\.93\.0/)
})

test('G-1 冲突：命令计数 11 且枚举缺 gate/abort → 两处都报（F-4 形态）', () => {
  const issues = checkDocs(G1_FACTS, { ...G1_CLEAN, readmeEn: G1_CLEAN_LINE + '\n11 /lunheng-* slash commands (draft / resume / cite / audit / journal / ppt / history / rollback / status / stats / help)' })
  assert.equal(issues.length, 2, JSON.stringify(issues))
  assert.ok(issues.some((x) => /11 ≠ 派生值 13/.test(x)), '须点名手抄值与派生值：' + JSON.stringify(issues))
  assert.ok(issues.some((x) => /缺 gate \/ abort/.test(x)), '须点名清单脱节：' + JSON.stringify(issues))
})

test('G-1 冲突：Config 枚举缺键（漏 hookMaxTotalChars——v18.18.1 同族第三次复发形态）→ 报出', () => {
  const dropped = G1_CLEAN_LINE.replace('`hookMaxBlockChars`, `hookMaxTotalChars`, `ethicsHook`', '`hookMaxBlockChars`, `ethicsHook`')
  const issues = checkDocs(G1_FACTS, { ...G1_CLEAN, readmeEn: dropped + '\n' + G1_CLEAN_CMD })
  assert.equal(issues.length, 1)
  assert.match(issues[0], /hookMaxTotalChars/)
})

test('G-1 冲突：env 镜像漏列 LUNHENG_PANEL → 报出（F-5「只有前两键有 env」形态）', () => {
  const dropped = G1_CLEAN_LINE.replace('mirrored by `LUNHENG_QUIET` / `LUNHENG_ALLOW_MECH_EDIT` / `LUNHENG_PANEL`', 'mirrored by `LUNHENG_QUIET` / `LUNHENG_ALLOW_MECH_EDIT`')
  const issues = checkDocs(G1_FACTS, { ...G1_CLEAN, readmeEn: dropped + '\n' + G1_CLEAN_CMD })
  assert.equal(issues.length, 1)
  assert.match(issues[0], /LUNHENG_PANEL/)
})

test('G-1 真值关系：派生面字段齐备且自洽（不复制具体清单字面量）', () => {
  const f = collectFacts()
  assert.ok(Array.isArray(f.config_keys) && f.config_keys.length >= 10, 'Config 键清单可派生')
  assert.equal(f.config_key_count, f.config_keys.length)
  assert.ok(f.config_keys.includes('panel') && f.config_keys.includes('hookMaxTotalChars'))
  assert.equal(typeof f.panel_default, 'boolean')
  assert.ok(Array.isArray(f.command_names) && f.command_names.length >= 13)
  assert.equal(f.command_count, f.command_names.length)
  assert.ok(!f.command_names.includes('-h'), '别名不计入计数')
  assert.ok(Array.isArray(f.config_env_mirrors) && f.config_env_mirrors.every((k) => /^LUNHENG_/.test(k)))
})
