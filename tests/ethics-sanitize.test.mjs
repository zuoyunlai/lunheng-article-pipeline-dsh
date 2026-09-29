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
