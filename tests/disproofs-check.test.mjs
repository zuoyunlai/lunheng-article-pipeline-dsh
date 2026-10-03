// v18.64.0（反哺报告-v5 §v5.3-1 的 C1-b 半）：**负知识账本**校验器回归。
//
// 为什么要它：「只记通过的、不记被证伪的」是负知识流失的形态；账本把「已证伪项」变成可复用产物。
//   本器只核**形状**（七字段 / verdict 枚举 / evidence 非空 / id 不复用 / 空账本禁止 / 缺账本可见），
//   **不判 P0/P1、不进 M 门**——「证伪得对不对」归 T6/T7/T8 人工。
// 关键钉子（每条都对应一种真实的失效形态）：
//   ① 缺账本 → **3**（不得读成 0 通过：须人工确认「确实无」还是「漏记」）；
//   ② **空文件 → 1**（空占位与「没记」同形 —— 这正是本账本要消灭的形态，不许自己制造）；
//   ③ 形状不合 → 1 且点名行号；
//   ④ **源码钉**：校验器必须零写盘零 spawn（否则「校验」会变成「顺手改」，与只读承诺相反）；
//   ⑤ 账本必须随证据包走（`build-evidence-bundle` 的 `RULES` 含它），否则外审看不到负知识。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp, parseJson } from './_fixtures.mjs'

const S = () => join(SCRIPTS, 'disproofs-check.mjs')
const OK = { id: 'DP-001', claim: '主张甲成立', verdict: 'disproven', basis: '反向研究结论相反', evidence: ['[L99] 反向研究 X（2023）'], reproduce: '查文献卡 [L99] 条目', author: 'T6', round: 'v2' }

/** 造一个项目 + 可选账本内容（lines 为 null 表示不建账本） */
const mk = (lines) => {
  const dir = tmp('lunheng-dp-')
  mkdirSync(join(dir, 'audits'), { recursive: true })
  if (lines !== null) writeFileSync(join(dir, 'audits', 'disproofs.jsonl'), lines)
  return dir
}
const JL = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n'

test('合法账本 → exit 0，逐条回显（供 T8 摘录）', () => {
  const d = mk(JL(OK, { ...OK, id: 'DP-002', verdict: 'weakened', claim: '主张乙被削弱' }))
  try {
    const r = run([S(), d])
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /负知识账本合法：2 条/)
    assert.match(r.out, /DP-001/)
    assert.match(r.out, /DP-002/)
    const j = parseJson(run([S(), d, '--json']))
    assert.equal(j.exit, 0)
    assert.equal(j.counts.legal, 2)
    assert.deepEqual(j.counts.byVerdict, { disproven: 1, weakened: 1 })
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('① 缺账本 → exit 3（**不得读成通过**：须人工确认「确实无」还是「漏记」）', () => {
  const d = mk(null)
  try {
    const r = run([S(), d])
    assert.equal(r.code, 3, r.out + r.err)
    assert.match(r.err || r.out, /确实无已证伪项|漏记/)
    assert.match(r.err || r.out, /N\/A ≠ SKIP|不得.*读成通过|不得把「没账本」读成通过/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('② 空账本（0 有效行）→ exit 1（空占位与「没记」同形，禁止）', () => {
  const d = mk('\n\n')
  try {
    const r = run([S(), d])
    assert.equal(r.code, 1, r.out + r.err)
    assert.match(r.err || r.out, /没有任何条目|空占位/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('③ 形状不合 → exit 1 且点名：缺必填 / verdict 越界 / evidence 空 / id 重复或不合规', () => {
  const d = mk([
    JSON.stringify({ ...OK, id: 'DP-001' }),                                  // 合法基线
    JSON.stringify({ ...OK, id: 'DP-002', reproduce: '' }),                   // 缺必填（空串算缺）
    JSON.stringify({ ...OK, id: 'DP-003', verdict: 'maybe' }),                // 枚举越界
    JSON.stringify({ ...OK, id: 'DP-004', evidence: [] }),                    // 空证据
    JSON.stringify({ ...OK, id: 'DP-005' }),
    JSON.stringify({ ...OK, id: 'DP-005' }),                                  // id 重复
    JSON.stringify({ ...OK, id: 'X-1' }),                                     // id 不合规
    '{ 这不是 JSON ',                                                          // 解析失败
  ].join('\n') + '\n')
  try {
    const r = run([S(), d, '--json'])
    assert.equal(r.code, 1, r.out + r.err)
    const j = parseJson(r)
    assert.equal(j.counts.legal, 2, '合法行 = DP-001 + 首个 DP-005（重复的那个才是非法）')
    const all = j.errors.join('\n')
    for (const kw of ['reproduce', 'verdict', 'evidence', 'id 重复', 'DP-001', 'JSON 解析失败']) {
      assert.match(all, new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `错误清单应点名 ${kw}：${all}`)
    }
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('④ 源码钉：校验器必须零写盘、零 spawn（「校验」不得顺手改账本）', () => {
  const src = readFileSync(S(), 'utf8')
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  const banned = /\b(spawnSync|spawn|execSync|execFileSync|writeFileSync|appendFileSync|createWriteStream|writeReport|mkdirSync|rmSync|unlinkSync)\s*\(/
  const hit = code.match(banned)
  assert.equal(hit, null, `disproofs-check 引入了被禁 API：${hit && hit[1]}（它是只读校验器）`)
  assert.ok(!/child_process/.test(code), 'disproofs-check 不得引入 child_process')
})

test('⑥ evidence 的**元素**必须是可回查的非空字符串（v18.64.2 · 独立审计 A-P2 核实后收口）', () => {
  // 旧版只核「非空数组」→ `[123, null, ""]` 会被放行；而 T5 逐条回应 / 外审按图索骥都拿不到东西。
  const d = mk([
    JSON.stringify({ ...OK, id: 'DP-001', evidence: [123] }),        // 数字
    JSON.stringify({ ...OK, id: 'DP-002', evidence: ['[L01]', null] }), // 混入 null
    JSON.stringify({ ...OK, id: 'DP-003', evidence: ['   '] }),       // 纯空白
  ].join('\n') + '\n')
  try {
    const r = run([S(), d, '--json'])
    assert.equal(r.code, 1, '三类坏证据都应判非法：' + r.out + r.err)
    const j = parseJson(r)
    assert.equal(j.counts.legal, 0)
    const all = j.errors.join('\n')
    for (const kw of ['第 1 项', '第 2 项', 'evidence 第 1 项']) {
      assert.match(all, new RegExp(kw), `错误清单应point名到**第几项**：${all}`)
    }
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('⑤ 账本随证据包走：build-evidence-bundle 的 RULES 必须含 audits/disproofs.jsonl', () => {
  const src = readFileSync(join(SCRIPTS, 'build-evidence-bundle.mjs'), 'utf8')
  assert.match(src, /\[\s*'audits\/disproofs\.jsonl'\s*,\s*'disproofs\.jsonl'\s*\]/,
    '证据包源清单缺负知识账本 —— 外审将看不到「哪些主张被证伪过」')
  // 反向：它不得被误当成「版本化报告」（那是取最大版本号的另一套机制，会找 -vN 文件名）
  const latest = src.slice(src.indexOf('const LATEST_REPORTS'), src.indexOf('const LATEST_REPORTS') + 900)
  assert.ok(!/disproofs/.test(latest), 'disproofs.jsonl 是 append-only 账本，不得进 LATEST_REPORTS（版本化报告族）')
})
