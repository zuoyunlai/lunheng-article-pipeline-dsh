// 可读性剖面（v18.26.0 QLT-3）回归测试
//
// 锁三条口径（错一条都会让这一维失去意义，且不会自己报错）：
//   · 阈值**来自 21 份真实定稿的实测分布**（不是印象）——真实稿不误报、合成机械文本必红
//   · 判定**最高只到 P2**（文风不是正确性；挂硬门会制造「为过门而写」的反向激励）
//   · 接入 `quality-score` 为第 8 分量，八分量权重合计 100
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp, mkProject } from './_fixtures.mjs'
import { pathToFileURL } from 'node:url'

const LIB = pathToFileURL(join(SCRIPTS, '_lib', 'readability.mjs')).href
const Q = join(SCRIPTS, 'quality-score.mjs')

test('readability：四个指标的口径（句切分 / 标准差 / 长句占比 / 被动占比 / 术语代理）', async () => {
  const { profile } = await import(LIB)
  // 三句汉字数 = 18 / 16 / 2 → 均值 12，方差 = (36+16+100)/3 = 50.67 → std = 7.12
  const text = '这是一个用来测试句长统计的中文句子啊。另一个同样长度的中文句子在这里哦。短的。'
  const m = profile(text)
  assert.equal(m.sentences, 3, '按 。；！？ 与换行切句')
  assert.equal(m.hanChars, (text.match(/[\u4e00-\u9fff]/g) || []).length, '纯汉字计数与 _lib/han.mjs 同源（同为 U+4E00–U+9FFF）')
  assert.ok(Math.abs(m.sentenceLenStd - 7.12) < 0.05, 'std 应为 7.12（18/16/2 三句）：' + m.sentenceLenStd)
  assert.equal(m.longSentenceRatio, 0, '无 >60 汉字句')
  assert.ok(m.termRatePer300 > 0, '术语代理（全篇只出现一次的 4–6 汉字片段）应有值')
  assert.equal(m.passiveRatio, 0, '无被动标志')
  const p = profile('他被公司解雇了。该政策受到广泛批评。他买了被子。')
  assert.equal(p.passiveRatio, +(2 / 3).toFixed(4), '「被子」不得算被动（词表刻意排除）')
})

test('readability：合成机械文本（等长句）必红——这是本检测器存在的理由', async () => {
  const { evaluate } = await import(LIB)
  const mech = Array.from({ length: 40 }, () => '本文认为范式迁移与结构性协同构成第重底层逻辑并赋能抓手闭环。').join('')
  const r = evaluate(mech)
  assert.equal(r.pass, false, '等长句堆叠必须报（标准化差趋近 0 = 机械感最强信号）')
  assert.equal(r.severity, 'P2', '**最高只到 P2**（文风不是正确性）：' + r.severity)
  assert.ok(r.hits.some((h) => /标准差/.test(h)), '命中说明须指出是标准差这一维')
})

test('readability：长句轰炸会被多指标同时命中，但仍是 P2', async () => {
  const { evaluate } = await import(LIB)
  const longText = Array.from({ length: 30 }, () => '在全球产业链重构与地缘政治竞争叠加的背景下，本文试图通过对多来源证据的交叉比对与机制层面的拆解说明一个被既有研究所忽略的结构性事实并给出可证伪的推论与政策含义。').join('')
  const r = evaluate(longText)
  assert.equal(r.pass, false)
  assert.equal(r.severity, 'P2')
  assert.ok(r.hits.some((h) => /长句占比/.test(h)), '长句占比超界必须命中：' + r.hits.join('；'))
})

test('readability：21 份真实定稿**全部在标定界内**（不误报——本机跑，CI 无 run/ 时跳过）', async () => {
  const { evaluate, THRESHOLDS } = await import(LIB)
  const { readdirSync, existsSync, readFileSync } = await import('node:fs')
  const { firstEndnoteIndex, bodyStartAfterAbstract } = await import(pathToFileURL(join(SCRIPTS, '_lib', 'sections.mjs')).href)
  const root = 'E:/HERNESS/run'
  if (!existsSync(root)) return
  let n = 0
  for (const name of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const p = join(root, name, 'final', '定稿.md')
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8')
    const a = bodyStartAfterAbstract(text)
    const e = firstEndnoteIndex(text)
    const r = evaluate(text.slice(a.found ? a.index : 0, e === -1 ? text.length : e))
    assert.equal(r.pass, true, `${name} 被误报：${r.hits.join('；')}（阈值 ${JSON.stringify(THRESHOLDS)}）`)
    n++
  }
  assert.ok(n >= 5, `真实稿样本过少（${n}）——本用例的价值就在样本量`)
})

test('quality-score：可读性剖面是第 8 分量，八分量权重合计 100', () => {
  const { d, proj, fin, ev } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、导论\n\n'
    + Array.from({ length: 30 }, (_, i) => `第${i}句用来凑够句数并让长度有变化，长短交错才像人写的。`).join('')
    + '\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n### [L01] 甲\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n### [D01] 甲\n- **时效评级**：🟢 ≤2 年\n')
  const j = parseJson(run([Q, proj]))
  const rd = j.components.find((c) => c.id === 'readability')
  assert.ok(rd, '必须有 readability 分量：' + j.components.map((c) => c.id).join(','))
  assert.equal(rd.weight, 10, '第 8 分量权重 10')
  assert.equal(j.components.length, 8, '共 8 分量')
  const sum = j.components.reduce((s, c) => s + c.weight, 0)
  assert.equal(sum, 100, `八分量权重合计必须 100（八项全适用时）：实测 ${sum}｜${j.components.map((c) => c.id + ':' + c.weight).join(' ')}`)
  assert.ok(rd.evidence.metrics && typeof rd.evidence.metrics.sentenceLenStd === 'number', '分值须带四指标原值供逐版对照')
})

test('quality-score：句数 < 20 → 可读性分量如实 N/A（不拿无统计意义的数字判档）', () => {
  const { d, proj, fin, ev } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n短。\n\n## 一、导论\n\n两句而已。就这样。\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n### [L01] 甲\n')
  const j = parseJson(run([Q, proj]))
  const rd = j.components.find((c) => c.id === 'readability')
  assert.equal(rd.applicable, false, '短稿不得判档：' + JSON.stringify(rd))
  assert.match(rd.naReason, /句数不足/)
})
