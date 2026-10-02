// 伦理脱敏工具回归测试（v18.60.0 新增）
//
// 本文件钉住的**每一条都对应一个实测踩到的缺陷**（写核心逻辑时 smoke test 暴露）：
//   ① 裁剪尾字吞字：`李四表示` → `受访者B示`（「表」被吃掉）
//   ② 贪婪 2 字越界：排除表里是「白天」，实际匹配到「白天我」而躲过排除
//   ③ 占位符被二次处理：strict 下 `杭州`→`浙江省某地`，随后「浙江」又被当人名咬一口
//   ④ 角色词重复：`受访者张三` → `受访者受访者A`
//   ⑤ 姓氏在词尾：`历史概念` 的「史」被切成人名
// 运行：node --test tests/ethics-sanitize.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { ROOT } from './_fixtures.mjs'

const MOD = await import(pathToFileURL(join(ROOT, 'lib', 'ethics-sanitize.js')).href)
const { loadDicts, sanitize, MODES } = MOD
const SKILL = join(ROOT, 'skills', 'lunheng-article-pipeline')
const dicts = loadDicts(SKILL)

test('E-1 词表：三个词表都能加载、无缺失（缺表必须走 degraded 而不是静默少做）', () => {
  assert.deepEqual(dicts.missing, [], '三个词表都应存在')
  assert.ok(dicts.surnames.size > 100, `姓氏表应 >100 条，实得 ${dicts.surnames.size}`)
  assert.ok(dicts.excludes.size > 100, `排除词表应 >100 条，实得 ${dicts.excludes.size}`)
  assert.ok(dicts.places.size > 100, `地名表应 >100 条，实得 ${dicts.places.size}`)
})

test('E-2 硬模式：身份证 / 手机 / 固话 / 邮箱 / 银行卡 全部替换', () => {
  const src = '身份证 110101199003071234，手机 13812345678，座机 010-12345678，邮箱 a.b-c@example.com，卡号 6222021234567890123'
  const r = sanitize(src, { mode: 'basic', dicts })
  assert.match(r.text, /\[身份证号-REDACTED\]/)
  assert.match(r.text, /\[手机号-REDACTED\]/)
  assert.match(r.text, /\[固话-REDACTED\]/)
  assert.match(r.text, /\[邮箱-REDACTED\]/)
  assert.match(r.text, /\[银行卡号-REDACTED\]/)
  assert.equal(r.counts.idcard, 1)
  assert.equal(r.counts.phone, 1)
  assert.equal(r.counts.landline, 1)
  assert.equal(r.counts.email, 1)
  assert.doesNotMatch(r.text, /110101199003071234/, '身份证原值不得残留')
  assert.doesNotMatch(r.text, /13812345678/, '手机原值不得残留')
})

test('E-3 身份证与银行卡不互相二次命中（顺序敏感：18 位先跑）', () => {
  const r = sanitize('110101199003071234', { mode: 'basic', dicts })
  assert.equal(r.counts.idcard, 1, '应判为身份证')
  assert.equal(r.counts.bankcard, 0, '不得同时判为银行卡')
})

test('E-4 修正④：角色词不得重复（`受访者张三` 不得变成 `受访者受访者A`）', () => {
  const r = sanitize('受访者张三说：我在工厂工作。', { mode: 'basic', dicts })
  assert.match(r.text, /^受访者A说：/, `角色词应被吸收，实得：${r.text}`)
  assert.doesNotMatch(r.text, /受访者受访者/, '不得出现重复角色词')
  assert.equal(r.counts.person, 1)
})

test('E-5 修正①：裁剪尾字必须归还正文（`李四表示` 不得吞掉「表」）', () => {
  const r = sanitize('李四表示同意。', { mode: 'basic', dicts })
  assert.match(r.text, /表示同意/, `「表」必须保留，实得：${r.text}`)
  assert.doesNotMatch(r.text, /^受访者A示/, '不得吞字')
})

test('E-6 修正②：排除表命中必须原样保留（王朝 / 李子 / 白天 / 马路）', () => {
  const src = '王朝更替，李子好吃，白天我在马路旁。'
  const r = sanitize(src, { mode: 'basic', dicts })
  assert.equal(r.text, src, '全部命中排除表时应逐字不变')
  assert.equal(r.counts.person, 0, '不得计为替换')
})

test('E-7 修正⑤：姓氏在词尾时不得切成人名（`历史概念`）', () => {
  const r = sanitize('这是历史概念。', { mode: 'basic', dicts })
  assert.equal(r.text, '这是历史概念。', '「历史」在排除表内，不得替换')
  assert.equal(r.counts.person, 0)
})

test('E-8 修正③：strict 下地名泛化后不得被人名轮二次咬（`杭州` → `浙江省某地`）', () => {
  const r = sanitize('调研覆盖杭州。', { mode: 'strict', dicts })
  assert.match(r.text, /浙江省某地/, `应泛化到省级，实得：${r.text}`)
  assert.doesNotMatch(r.text, /受访者/, '泛化结果不得被人名轮再替换')
})

test('E-9 地名：basic 模式替换为占位符；省级在 strict 下保持原样', () => {
  const basic = sanitize('在东莞工作。', { mode: 'basic', dicts })
  assert.match(basic.text, /\[地名-REDACTED\]/)
  const strict = sanitize('在广东省工作。', { mode: 'strict', dicts })
  assert.equal(strict.text, '在广东省工作。', '省级粒度不足以识别个体，应保持原样')
})

test('E-10 同一姓名跨全文得到同一占位符（引用一致性）', () => {
  const r = sanitize('受访者王五说。后来王五又提到。', { mode: 'basic', dicts })
  const hits = r.text.match(/受访者A/g) || []
  assert.equal(hits.length, 2, `同一人应得同一占位符，实得：${r.text}`)
  assert.equal(r.distinctPersons, 1)
})

test('E-11 mode=none 必须原样返回且显式声明未脱敏（不得静默假装做了）', () => {
  const src = '张三的手机 13812345678'
  const r = sanitize(src, { mode: 'none', dicts })
  assert.equal(r.text, src, 'none 模式不得改动任何字符')
  assert.equal(r.counts.phone, 0)
  assert.equal(r.reviewFlags[0].kind, 'mode', '必须显式声明「未做替换」')
})

test('E-12 截断必须如实报告（不得静默截断让调用方以为拿到了全文）', () => {
  const src = '甲'.repeat(500)
  const r = sanitize(src, { mode: 'basic', dicts, maxChars: 100 })
  assert.equal(r.truncated, true)
  assert.equal(r.text.length, 100)
})

test('E-13 词表缺失必须走 degraded（不得静默少做一个维度）', () => {
  const r = sanitize('张三的手机 13812345678', { mode: 'basic', dicts: { surnames: new Set(), excludes: new Set(), places: new Map(), missing: ['中文姓氏.txt'] } })
  assert.equal(r.degraded, true)
  assert.match(r.degradedReason, /中文姓氏\.txt/)
  assert.equal(r.counts.phone, 1, '硬模式仍应工作')
  assert.ok(r.reviewFlags.some((f) => f.kind === 'dict-missing'), '缺表必须进 reviewFlags')
})

test('E-14 低置信度人名必须进 reviewFlags（宁多报不漏报的落点）', () => {
  // 「赵六」前无角色词 → 应替换 + 标记待复核
  const r = sanitize('赵六去了现场。', { mode: 'basic', dicts })
  assert.equal(r.counts.person, 1)
  assert.ok(r.reviewFlags.some((f) => f.kind === 'person-low-confidence'), '无角色词的命中必须可复核')
  // 「受访者孙七」有角色词 → 不标记
  const r2 = sanitize('受访者孙七说。', { mode: 'basic', dicts })
  assert.ok(!r2.reviewFlags.some((f) => f.kind === 'person-low-confidence'), '有角色词的不应标记')
})

test('E-15 MODES 受控：非法 mode 回落到 basic 而不是崩溃', () => {
  assert.deepEqual([...MODES], ['none', 'basic', 'strict'])
  const r = sanitize('受访者周八说。', { mode: 'bogus', dicts })
  assert.equal(r.mode, 'basic', '非法模式应回落 basic')
})

// ── E-16 / E-17（v18.62.6）：邮箱正则的二次回退回归网 ─────────────────────────────
// 为什么需要（独立复测发现，未进任何既有报告）：原写法 `[A-Za-z0-9._%+-]+@…` 在「无 `@` 的长
//   ASCII 段」上是 **O(n²)**——实测 'A'×10k→41 ms / ×20k→163 ms / ×40k→663 ms / ×80k→2927 ms
//   （每翻倍 ×4）。真实可达：base64url 49k→996 ms、长十六进制串 44.8k→850 ms、data URI 37.6k→584 ms。
//   危害面 = 主数据通路（钩子对每个 read/web_*/subagent* 结果同步跑；工具侧无体积上限）。
//   修法：① `required:'@'` 短路；② 量词按 RFC 5321 §4.5.3.1 限长（local ≤64 / domain ≤255）。
// 断言选择：**不用绝对耗时**（CI 机器快慢不一，会 flaky），改用**比值判据**——
//   二次曲线下 2× 输入 → ~4× 耗时；线性下 → ~2×。取 2.5 作分界，留足噪声余量。

/** 跑一次 basic 脱敏并返回耗时（ms）。取三次最小值以平抑 GC / 调度抖动。 */
function timeOf(text) {
  let best = Infinity
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    sanitize(text, { mode: 'basic', dicts, maxChars: Number.MAX_SAFE_INTEGER })
    best = Math.min(best, performance.now() - t0)
  }
  return best
}

test('E-16 邮箱正则不得在「无 @ 的长 ASCII 段」上二次回退（O(n²) 回归网）', () => {
  const N = 40000
  const t1 = timeOf('A'.repeat(N))
  const t2 = timeOf('A'.repeat(N * 2))
  // 基线保护：若单次已 >2 s，无论比值如何都不可能是线性实现（原实现在 80k 时已达 ~2.9 s）
  assert.ok(t1 < 2000, `40k 无 @ ASCII 段耗时 ${t1.toFixed(0)} ms——疑似二次回退复活（原实现 ~663 ms，线性实现 ~0 ms）`)
  const ratio = t2 / Math.max(t1, 0.5)   // 分母设下限，避免「0 ms / 0 ms」除零后比值无意义
  assert.ok(
    ratio < 2.5,
    `2× 输入耗时比 ${ratio.toFixed(2)}（${t1.toFixed(1)} → ${t2.toFixed(1)} ms）≥ 2.5，符合二次曲线而非线性——` +
      '邮箱正则的限长/短路可能被回退掉了（真源 = lib/ethics-sanitize.js 的 HARD_PATTERNS.email）',
  )
})

test('E-17 邮箱限长后仍必须识别合法地址（收紧不得变成漏报）', () => {
  const cases = [
    'foo@bar.com',
    'first.last+tag@sub.example.co.uk',
    'a_b%c-d@example.org',
    'x'.repeat(64) + '@example.com',            // local-part 恰好 64（RFC 上限，必须仍命中）
  ]
  for (const s of cases) {
    assert.ok(sanitize(s, { mode: 'basic', dicts }).counts.email >= 1, `合法邮箱被漏报：${s}`)
  }
  // 多邮箱同现
  const multi = sanitize('联系 zhangsan@company.cn 或 lisi@mail.com', { mode: 'basic', dicts })
  assert.equal(multi.counts.email, 2, '同段多邮箱必须逐个命中')
})

