// CHANGELOG 版本段结构对账器回归网（v18.18.13 新增 · 规则 ⑬）
//
// 为什么需要（真教训）：v18.18.12 发版后复查发现 `## 18.18.11 — 2026-09-26` 版本标题**被删了**
//   ——写新版本段时 old_string 只匹配了那行标题、new_string 末尾忘了写回去，于是上一个版本段的
//   内容挂到了新版本段名下（两段合并）。**它逃过了所有门**：`consistency-check` 规则 ⑪ 只核
//   「**当前**版本段存在」，没有门管历史版本标题被删。同形失真在 v18.12.0 段也发生过一次
//   （段内两个 `### 七、`）直到本次才被发现 —— 故本文件把这条不变量钉住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cnToNumber,
  versionOf,
  versionTuple,
  parseChangelogSections,
  reconcileChangelogStructure,
} from '../scripts/_lib/changelog-structure.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REAL = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

test('cnToNumber：中文序号（含「十」的三种位置）与阿拉伯数字', () => {
  assert.equal(cnToNumber('一'), 1)
  assert.equal(cnToNumber('九'), 9)
  assert.equal(cnToNumber('十'), 10)
  assert.equal(cnToNumber('十一'), 11)
  assert.equal(cnToNumber('二十'), 20)
  assert.equal(cnToNumber('二十五'), 25)
  assert.equal(cnToNumber('7'), 7)
  assert.equal(cnToNumber('七的'), null, '非纯序号应返回 null（不得猜）')
})

test('versionOf：三种真实标题形态都能取到版本键', () => {
  assert.equal(versionOf('18.18.12 — 2026-09-26'), '18.18.12')
  assert.equal(versionOf('2.5.2-dsh.17（2026-09-11）— 机检可信化 + 成本可实测（11 批）'), '2.5.2-dsh.17')
  assert.equal(versionOf('17.0.0（未单独发布 —— 内容随 18.0.0 首发）— 版本号方案迁移'), '17.0.0')
  assert.equal(versionOf('18.6.3 — 计划中（未发布）'), '18.6.3')
  assert.equal(versionOf('不是版本标题'), null)
})

test('versionTuple：`-dsh.N` 视为第 4 位，历史线因此排在 17/18 之前', () => {
  assert.deepEqual(versionTuple('18.18.12'), [18, 18, 12, 0])
  assert.deepEqual(versionTuple('2.5.2-dsh.17'), [2, 5, 2, 17])
  assert.deepEqual(versionTuple('garbage'), null)
})

// ── 假阳性防线：把真实段形**最小化复刻**，合法结构必须 0 违例 ──
const good = [
  '## 1.2.0 — 2026-01-02',
  '',
  '### 一、甲',
  '### 二、乙',
  '',
  '## 1.1.0 — 2026-01-01',
  '',
  '### 一、丙',
  '### 二、丁',
  '### 十、戊',
  '',
].join('\n')

test('假阳性防线：合法结构（各段编号递增 / 版本降序 / 首段 == pkg）不得报', () => {
  const { sections } = parseChangelogSections(good)
  const r = reconcileChangelogStructure(sections, '1.2.0')
  assert.deepEqual(r.violations, [], '合法 CHANGELOG 不得被判红')
  assert.equal(r.withSubs, 2)
})

test('假阳性防线：段内**无编号小节**是合法形态（只有带编号的段才参与递增判定）', () => {
  const mix = ['## 2.0.0 — x', '', '随便一段散文', '', '## 1.0.0 — y', '', '### 一、甲', ''].join('\n')
  const { sections } = parseChangelogSections(mix)
  assert.deepEqual(reconcileChangelogStructure(sections, '2.0.0').violations, [])
})

// ── 真问题：四种失真都必须报 ──
test('真问题①：版本标题被删 → 两段合并 → 段内编号回绕（v18.18.12 的实际形态）', () => {
  // 复刻事故：`## 1.1.0` 标题被删，其 `### 一、` 直接接在 `## 1.2.0` 的 `### 二、` 之后
  const merged = [
    '## 1.2.0 — 2026-01-02',
    '',
    '### 一、甲',
    '### 二、乙',
    '### 一、本属上一个版本段',
    '### 二、也是',
    '',
  ].join('\n')
  const { sections } = parseChangelogSections(merged)
  const r = reconcileChangelogStructure(sections, '1.2.0')
  assert.equal(r.violations.length, 1, '编号回绕必须报')
  assert.equal(r.violations[0].kind, 'sub-order')
  assert.match(r.violations[0].msg, /编号回绕/)
  assert.match(r.violations[0].msg, /上一个版本标题被删/)
})

test('真问题②：首段版本 ≠ package.json', () => {
  const { sections } = parseChangelogSections(good)
  const r = reconcileChangelogStructure(sections, '9.9.9')
  assert.equal(r.violations.length, 1)
  assert.equal(r.violations[0].kind, 'first-mismatch')
})

test('真问题③：同一版本键出现两次', () => {
  const dup = ['## 1.0.0 — a', '', '## 1.0.0 — b', ''].join('\n')
  const { sections } = parseChangelogSections(dup)
  const r = reconcileChangelogStructure(sections, '1.0.0')
  assert.equal(r.violations.length, 1)
  assert.equal(r.violations[0].kind, 'dup-version')
})

test('真问题④：版本段顺序不是降序', () => {
  const asc = ['## 1.0.0 — a', '', '## 1.1.0 — b', ''].join('\n')
  const { sections } = parseChangelogSections(asc)
  const r = reconcileChangelogStructure(sections, '1.0.0')
  assert.equal(r.violations.length, 1)
  assert.equal(r.violations[0].kind, 'order')
})

// ── 防空转：解析器形状脱节必须响亮抛错；「不变量空跑」则作为返回值报出 ──
test('防空转：解析不出 `## ` 段 → 抛错（解析器形状脱节，绝不静默放行）', () => {
  assert.throws(() => parseChangelogSections('# 只有一级标题\n\n正文\n'), /解析出 0 个 `## ` 版本段/)
})

// 设计要点（本用例是它的回归钉）：`withSubs === 0` **不能**用 throw 实现。
//   本函数在判定点之前已算出 violations，若此处 throw，**真实违例会被吞掉**——
//   门仍会红，但会报成「解析器脱节」而不是「CHANGELOG 有 X 处结构违例」，丢掉真正的发现。
//   故「退化」走返回值，由规则与违例**并列**报出。下面两条同时断言「退化被报出」与「违例没被吞」。
test('防空转：无编号小节时 withSubs=0 被报出，且**同时**保留已发现的违例（不许吞）', () => {
  const noSubs = '## 1.0.0 — a\n\n纯散文，没有编号小节\n'
  const r1 = reconcileChangelogStructure(parseChangelogSections(noSubs).sections, '1.0.0')
  assert.equal(r1.withSubs, 0, '退化必须作为返回值暴露给调用方')
  assert.deepEqual(r1.violations, [], '这一例本身没有违例')

  // 关键：既退化、又有违例时，两者都要在场（复现被吞的那个 bug 形态）
  const dupNoSubs = '## 1.0.0 — a\n\n## 1.0.0 — b\n\n纯散文\n'
  const r2 = reconcileChangelogStructure(parseChangelogSections(dupNoSubs).sections, '1.0.0')
  assert.equal(r2.withSubs, 0, '退化仍须报出')
  assert.equal(r2.violations.length, 1, '重复版本键**不得**因退化而被吞掉')
  assert.equal(r2.violations[0].kind, 'dup-version')
})

// ── 真实树：这是本门的存在意义 ──
test('真实树：CHANGELOG 版本段结构自洽（0 违例），且版本段数量在合理量级', () => {
  const { sections } = parseChangelogSections(REAL)
  const { checked, withSubs, violations } = reconcileChangelogStructure(sections, PKG)
  assert.deepEqual(
    violations.map((v) => `[${v.kind}] :${v.line} ${v.msg}`),
    [],
    '真实 CHANGELOG 的版本段结构必须自洽',
  )
  assert.ok(checked >= 50, `版本段过少（实测 ${checked}）——解析器可能已与文件脱节`)
  assert.ok(withSubs >= 10, `含编号小节的段过少（实测 ${withSubs}）——不变量会退化成空跑`)
  assert.equal(sections[0].version, PKG, '首段必须是当前版本')
  // 事故的回归钉：v18.18.11 的版本标题必须在场（它曾被我删掉）
  assert.ok(
    sections.some((s) => s.version === '18.18.11'),
    '`## 18.18.11` 版本标题必须在场——它是 v18.18.12 事故中被误删的那个',
  )
})
