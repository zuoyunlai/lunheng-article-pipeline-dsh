// 可读性剖面（v18.26.0 QLT-3）回归测试
//
// 锁三条口径（错一条都会让这一维失去意义，且不会自己报错）：
//   · 阈值**来自 21 份真实定稿的实测分布**（不是印象）——真实稿不误报、合成机械文本必红
//   · 判定**最高只到 P2**（文风不是正确性；挂硬门会制造「为过门而写」的反向激励）
//   · 接入 `quality-score` 为第 8 分量，八分量权重合计 100
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync } from 'node:fs'
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
  // ── v18.48.0（反哺 F-BD）：**显式排除受控 A/B 实验产物**（具名、有理由，不是"跳过跑不过的"）──
  // 理由：本用例的阈值标定依据是「**21 份常规交付定稿**」的实测分布；QLT-5 的四份定稿是
  //   **实验操控产物**（分档模型 + 主人授权的多轮修订 + 字数压缩轮），把它们计入 = 把"实验条件"
  //   混进标定基线。**同时如实登记读数（不藏）**：`AB-ai-content-farm-B` 实测
  //   **>60 字长句占比 30.2% > 25%** —— 已作为 **F-BD** 登记（标定带对「机制说明密集型」哲学长文
  //   可能偏紧），**留待按新样本重新标定**。
  // ⚠️ 本条**不是**为让它变绿而放宽阈值：**阈值一个数都没动**（`THRESHOLDS` 未改）；排除的是
  //   **样本**，且排除名单是**具名枚举**（不是前缀/正则通配），新增实验项目必须**显式**登记于此。
  const EXCLUDED_EXPERIMENTS = new Set(['AB-ai-content-farm-A', 'AB-ai-content-farm-B', 'AB-共锁-A', 'AB-共锁-B'])
  let n = 0
  let maxLong = 0          // v18.73.0（F-25 重标定）：标定语料的长句占比极值——用于双向校准守卫
  let maxStd = 0
  const excluded = []
  for (const name of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    if (EXCLUDED_EXPERIMENTS.has(name)) { excluded.push(name); continue }
    const p = join(root, name, 'final', '定稿.md')
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8')
    const a = bodyStartAfterAbstract(text)
    const e = firstEndnoteIndex(text)
    const r = evaluate(text.slice(a.found ? a.index : 0, e === -1 ? text.length : e))
    assert.equal(r.pass, true, `${name} 被误报：${r.hits.join('；')}（阈值 ${JSON.stringify(THRESHOLDS)}）`)
    const m = r.metrics || {}
    if (typeof m.longSentenceRatio === 'number') maxLong = Math.max(maxLong, m.longSentenceRatio)
    if (typeof m.sentenceLenStd === 'number') maxStd = Math.max(maxStd, m.sentenceLenStd)
    n++
  }
  assert.ok(n >= 5, `真实稿样本过少（${n}）——本用例的价值就在样本量`)
  // ── v18.73.0（反哺报告-v7 F-25）：**双向校准守卫** ──
  //   立法目的：本用例此前只断言「不误报」（单向）。于是**阈值可以静默地变得过松**——
  //   只需语料变短或变易，而没人会发现「25% 已远高于极值」。
  //   实测教训：本项目 27 份语料的极值 27.6% **已高于**原阈值 25%，即**标定原则被打破却无人报**，
  //   直到主控实测才发现（F-25）。
  //   ⚠️ 此处**仍不放宽任何阈值**：两条断言都是「标定是否仍然成立」，不是「这一篇过不过」。
  assert.ok(maxLong <= THRESHOLDS.longRatioMax,
    `标定语料长句占比极值 ${(maxLong * 100).toFixed(1)}% **已超阈值** ${THRESHOLDS.longRatioMax * 100}% —— 标定原则（阈值应略高于真实稿极值）被打破，请重新标定`)
  assert.ok(maxLong > THRESHOLDS.longRatioMax * 0.85,
    `标定语料长句占比极值 ${(maxLong * 100).toFixed(1)}% 距阈值 ${THRESHOLDS.longRatioMax * 100}% 过远（< 85%）—— 阈值可能**过松**，请重新标定`)
  // v18.48.0（F-BD）：排除须**可见**——排了哪几个、排了几个，随用例一起报出来。
  // v18.73.0（F-25）：改为**报告实测校准量**（此前那条 `assert.ok(true, …)` 无论校准如何都恒真，
  //   等于「排除可见」但「校准不可见」）。现在把极值与语料规模一并报出，供逐版对照。
  assert.ok(true, `（本次排除受控实验产物 ${excluded.length} 个：${excluded.join('/') || '无'}；`
    + `标定样本 n=${n}；实测极值 长句占比 ${(maxLong * 100).toFixed(1)}% / 句长std ${maxStd.toFixed(2)}；`
    + `阈值 长句占比 ${THRESHOLDS.longRatioMax * 100}% —— 极值必须 ≤ 阈值 且 > 阈值×85%）`)
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

// ── v18.73.0（F-25 重标定的**源码钉**）：阈值字面量不得被静默改动 ──
//   ADR 第 ③ 条要求「成对测试 = 行为测 + 源码钉」。上面那条「真实稿不误报」是**行为测**
//   （真跑 evaluate 并断言行为）；本条是**源码钉**——直接断言源文件里的字面量。
//   二者缺一则重标定可被静默回退：**行为测**在语料恰好都不越界时会通过（阈值调松了也看不出来），
//   **源码钉**则在有人改数时立刻点名。
test('readability：长句占比阈值的**源码钉**（v18.73.0 F-25 重标定后不得被静默改动）', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(join(SCRIPTS, '_lib', 'readability.mjs'), 'utf8')
  assert.match(src, /longRatioMax:\s*0\.30\b/,
    'longRatioMax 必须逐字为 0.30（v18.73.0 由 0.25 重标定：在册语料极值 27.6% + 约 2.4pp）。'
    + '**若确要再改，必须同批更新本断言、`readability.mjs` 的标定注释、以及 `audits/decisions/` 里的重标定记录**——'
    + '不得只改数字。')
  // 另三维仍为原标定值——一并钉住，防止"顺手调一个"。
  assert.match(src, /stdMin:\s*13\b/, 'stdMin 必须为 13（本轮未重标定）')
  assert.match(src, /termRateMax:\s*50\b/, 'termRateMax 必须为 50（本轮未重标定）')
  assert.match(src, /passiveRatioMax:\s*0\.22\b/, 'passiveRatioMax 必须为 0.22（本轮未重标定）')
})

test('quality-score：M-Gate 分量名与权重不得随「证据包有无」改变（同 id 即同分量）', () => {
  const { d, proj, fin, ev } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、导论\n\n'
    + Array.from({ length: 30 }, (_, i) => `第${i}句用来凑够句数并让长度有变化，长短交错才像人写的。`).join('')
    + '\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n### [L01] 甲\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n### [D01] 甲\n- **时效评级**：🟢 ≤2 年\n')
  const withEv = parseJson(run([Q, proj])).components.find((c) => c.id === 'M-Gate')
  // 去掉证据包 → 走「缺 final/证据包」的 N/A 分支
  rmSync(ev, { recursive: true, force: true })
  const withoutEv = parseJson(run([Q, proj])).components.find((c) => c.id === 'M-Gate')
  assert.ok(withEv && withoutEv, '两种场景都必须产出 M-Gate 分量')
  assert.equal(withoutEv.weight, withEv.weight,
    `同一 id 必须同权重（旧版 38 / 40 两种写法会让 --baseline 并排阅读时误判评分结构变化）：`
    + `有证据=${withEv.weight} 无证据=${withoutEv.weight}`)
  assert.equal(withoutEv.name, withEv.name, '同一 id 必须同名（旧版分别写「23 机械项」与「22 机械项」）')
  assert.doesNotMatch(withEv.name, /\d+\s*机械项/,
    '名称不得硬编码机械项数——该数字已漂移三次（22/23/24），真实值由 detail 的 pass/total 承载')
  rmSync(d, { recursive: true, force: true })
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
