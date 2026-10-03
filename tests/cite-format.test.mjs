// 论衡参考文献格式生成器回归（v18.66.0）
//
// 为什么要这组钉子：这一块的**主要风险不是「拼错」，而是「猜」**——猜类型、猜作者反不反转、猜「待核」是不是真值。
//   故用例重心在**负面行为**：判不出时必须落占位/进 blocked，而**不得**产出「看着像著录、其实是错著录」的串。
// 运行：node --test tests/cite-format.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, tmp, run, SCRIPTS } from './_fixtures.mjs'

const S = () => join(SCRIPTS, 'cite-format.mjs')

/** 最小项目：literature/文献卡.md（字段结构化，与真实卡片同形） */
const mk = (cardBody, { withIndex = true } = {}) => {
  const d = tmp('lunheng-cite-')
  mkdirSync(join(d, 'literature'), { recursive: true })
  const idx = withIndex ? [
    '## 📇 索引段',
    '',
    '| 编号 | 作者 | 年份 | 信任级别 | 用于 |',
    '|---|---|---|---|---|',
    '| [L01] | Nozick | 1969 | 已发布（学术期刊） | §1.2 |',
    '| [L02] | 王文军 | 2022 | 已发布（学术期刊） | §1.6 |',
    '',
    '---',
    '',
  ].join('\n') : ''
  writeFileSync(join(d, 'literature', '文献卡.md'), idx + cardBody)
  return d
}
const J = (id, extra = '') => `### [${id}] Nozick "Coercion"（强制论基线）\n\n`
  + `- **作者**: Robert Nozick\n- **年份**: 1969\n- **类型**: 期刊文章 [J]\n`
  + `- **出版社/期刊**: *Philosophy & Public Affairs*, Vol. 1, No. 4, pp. 441–445\n`
  + `- **DOI/URL**: DOI: 10.1093/xyz.001\n${extra}`

test('① GB/T：字段 → 著录串（编号**双标** `[n] [Lxx]`，顺序不重排）', () => {
  const d = mk(J('L01'))
  try {
    const r = run([S(), d])
    assert.equal(r.code, 0, '字段齐备应 exit 0：' + r.out + r.err)
    assert.match(r.out, /\[1\] \[L01\] Robert Nozick\. Coercion\[J\]\. Philosophy & Public Affairs, 1969, 1\(4\): 441–445\./)
    assert.match(r.out, /DOI: 10\.1093\/xyz\.001/)
    assert.match(r.out, /不得重排/, '必须明写「顺序不得重排」')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('② APA：英文作者反转、**中文作者不反转**（APA 中文变体），且不加顺序号', () => {
  const body = J('L01') + '\n' + `### [L02] 王文军《关系契约论》（本土对话）\n\n- **作者**: 王文军\n- **年份**: 2022\n- **类型**: 期刊文章 [J]\n- **出版社/期刊**: *法学研究*, Vol. 44, No. 2, pp. 10-30\n- **DOI/URL**: DOI: 10.9999/abc\n`
  const d = mk(body)
  try {
    const r = run([S(), d, '--style', 'apa'])
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /\[L01\] Nozick, R\. \(1969\)\. Coercion\. \*Philosophy & Public Affairs\*, 1\(4\), 441–445\./)
    assert.ok(!/\[1\] \[L01\]/.test(r.out), 'APA 场景不加顺序号')
    assert.match(r.out, /\[L02\] 王文军\. \(2022\)\./, '中文姓名不得反转（禁出「军, 王文」）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('③ **不猜**：类型未识别 → 该条不生成、进 blocked、exit 1（不得默认按 [J] 拼）', () => {
  const d = mk('### [L01] 无类型条目\n\n- **作者**: 甲\n- **年份**: 2024\n- **出版社/期刊**: 某刊\n')
  try {
    const r = run([S(), d, '--json'])
    assert.equal(r.code, 1, '类型判不出必须 exit 1（候选须人工），不得 exit 0')
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    assert.equal(j.generated, 0)
    assert.equal(j.blocked.length, 1)
    assert.match(j.blocked[0].reason, /不猜类型/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('④ **不把「待核」当值**：占位值一律当缺字段（`⟨缺 …⟩`），绝不进著录串', () => {
  const d = mk(J('L01').replace('*Philosophy & Public Affairs*', '期刊版本待核验'))
  try {
    const r = run([S(), d, '--json'])
    assert.equal(r.code, 1)
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    assert.match(j.generated !== undefined ? JSON.stringify(j.placeholders) : '', /⟨缺 刊名⟩/, '「待核」栏必须判为缺字段')
    assert.ok(!/待核验/.test(JSON.stringify(j.generated)), '「待核」字样不得进著录串')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('⑤ 索引段对账：条目与索引段**年份不一致** → 进 crossCheck 且 exit 1', () => {
  const d = mk(J('L01').replace('- **年份**: 1969', '- **年份**: 1999'))
  try {
    const r = run([S(), d, '--json'])
    assert.equal(r.code, 1)
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    assert.equal(j.crossCheck.length, 1, '索引段 1969 vs 条目 1999 必须报出')
    assert.equal(j.crossCheck[0].field, '年份')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('⑥ 缺输入 exit 3（「没卡」不得读成「无需格式」）；`--style ieee` 明确拒绝（IEEE 暂缓）', () => {
  const d = tmp('lunheng-cite-')
  try {
    const r = run([S(), d])
    assert.equal(r.code, 3, '无文献卡 → 3（适用却缺输入），不得 0')
    assert.match(r.out + r.err, /不得.*读成通过|须人工确认/)
  } finally { rmSync(d, { recursive: true, force: true }) }
  const d2 = mk(J('L01'))
  try {
    const r2 = run([S(), d2, '--style', 'ieee'])
    assert.equal(r2.code, 10, 'IEEE 尚未支持：必须 exit 10 明确拒绝，不得静默降级')
    assert.match(r2.out + r2.err, /IEEE 暂缓/)
  } finally { rmSync(d2, { recursive: true, force: true }) }
})

test('⑦ 边界钉：默认**不写项目任何文件**；`--report` 才落报告，且为 **CWD 相对**（全族同口径，v18.67.0）', () => {
  const d = mk(J('L01'))
  try {
    const before = readFileSync(join(d, 'literature', '文献卡.md'), 'utf8')
    const r = run([S(), d])
    assert.equal(r.code, 0)
    assert.ok(!existsSync(join(d, 'final', '引用格式报告.json')), '不带 --report 时不得写任何文件')
    assert.equal(readFileSync(join(d, 'literature', '文献卡.md'), 'utf8'), before, '文献卡必须逐字节不变')
    // v18.67.0：--report 为 CWD 相对（与 m-gate/final-check 全族同口径）——绝对路径形态不受基准影响
    const r2 = run([S(), d, '--report', join(d, 'literature', '格式报告.json')])
    assert.equal(r2.code, 0)
    assert.ok(existsSync(join(d, 'literature', '格式报告.json')), '--report 才落盘（绝对路径原样解析）')
    assert.ok(!existsSync(join(d, 'final', '引用格式报告.json')), '显式 --report 不得再按「项目相对」另写一份（旧版异类口径）')
    const j = JSON.parse(readFileSync(join(d, 'literature', '格式报告.json'), 'utf8'))
    assert.equal(j.style, 'gbt')
    assert.match(j.boundary, /只出\*\*草稿\*\*/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('⑧ 源码钉：真源文档在场，且生成器零 spawn、不 import 任何子进程模块', () => {
  const src = readFileSync(S(), 'utf8')
  assert.ok(!/child_process|spawn|execSync/.test(src), '生成器不得起子进程（只读式工具）')
  assert.match(src, /IEEE 暂缓/, '用法/l 说明里必须写明 IEEE 暂缓（不得声称支持）')
  assert.ok(existsSync(join(ROOT, 'skills', 'lunheng-article-pipeline', 'references', '_shared', '引用格式.md')), '真源契约必须在场')
})

// v18.67.0（全量审计-v18.66.0 P0-1 回归钉）：英文占位词必须**词边界锚定**。
//   旧版 `n\/?a` 是无边界子串匹配（/i），实测把 `Nancy Fraser`/`Nature`/`China Quarterly`/
//   `Governance`（凡含 "na" 子串）系统性误判成「未核验」→ 假占位 + 假对账不一致 + exit 1。
test('⑨ P0-1 回归：含 "na" 子串的正当著录值（Nancy/Nature/China…）不得判为未核验占位', () => {
  const body = [
    '### [L01] Fraser "Rethinking the Public Sphere"（na 子串·作者）', '',
    '- **作者**: Nancy Fraser',
    '- **年份**: 1990',
    '- **类型**: 期刊文章 [J]',
    '- **出版社/期刊**: *China Quarterly*, Vol. 12, No. 3, pp. 1-20',
    '- **DOI/URL**: DOI: 10.9999/na.001',
    '',
  ].join('\n')
  const d = mk(body, { withIndex: false })
  try {
    // 索引段省略时索引作者缺失属正常降级；此处只钉「作者/刊名不被占位」
    const r = run([S(), d, '--json'])
    assert.equal(r.code, 0, '正当著录值不得产出假占位/假对账 → 必须 exit 0：' + r.out + r.err)
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    assert.equal(j.generated, 1)
    assert.equal(j.blocked.length, 0)
    assert.equal(j.placeholders.length, 0, 'Nancy Fraser / China Quarterly 不得被误判为未核验 → 假 ⟨缺 作者/刊名⟩')
    assert.equal(j.crossCheck.length, 0, '正当著录值不得产出假对账不一致')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('⑩ P0-1 回归对照：整值 n/a / N/A / unknown / TBD 仍判为未核验占位（词边界不放宽真占位）', () => {
  const d = mk(J('L01').replace('- **作者**: Robert Nozick', '- **作者**: n/a'))
  try {
    const r = run([S(), d, '--json'])
    assert.equal(r.code, 1, '整值 n/a 作者必须仍判缺字段 → exit 1')
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    assert.match(JSON.stringify(j.placeholders || []), /⟨缺 作者⟩/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
