// 「图位 ↔ 图件」对账库契约测试（v19.1.8）
// 运行：node --test tests/figure-reconcile.test.mjs
//
// 为什么单独成文件：`_lib/figure-reconcile.mjs` 是**两个消费者共用的唯一口径**
//   （`run-report.mjs` 的 HTML 看板 + JSON 边车、`lib/panel.mjs` 的运行面板卡片）。
//   它一旦漂移，两处会同时错，且错法是「把已交付的图报成缺图」——**错报比漏报更伤**
//   （实测病灶：只认 `.svg` 时 `cn-llm-inference-cost-econ` 的 6 张 PNG 被报成无图）。
//
// 覆盖（每条对应实现里的一处判断）：
//   ① 图位四种写法（独占行 / 图片语法 / 全角括号行 / 双写去重）；标题为空不算图位（防行内指代误判）；
//   ② 图件 **PNG 与 SVG 同权**；非编号图件（封面 / 附录）进 `extras` 且**不计缺口**；
//   ③ 配对失败时的**显式绑定回退**（交付说明写了 `…/图件/xxx.svg` — [图N] 就采信）;
//   ④ 六种状态的判定顺序：ok / missing / orphan-files / none-reasoned / none-unreasoned / pending /
//      intent-gap（说明里定了要图却一张没落 = **真缺口**，不是「本就不需要」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp } from './_fixtures.mjs'
import { reconcileFigures, figureSummaryLine, parseFigureSlots } from '../skills/lunheng-article-pipeline/scripts/_lib/figure-reconcile.mjs'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500"><text x="1" y="1">x</text></svg>'

/** 造一个项目目录：`{ final/定稿.md, final/图件/*, final/交付说明.md, 01-任务简报.md }` 按需给。 */
function mkProj({ draft = null, figures = {}, note = null, brief = null } = {}) {
  const d = tmp('lh-fig-')
  const fin = join(d, 'final')
  mkdirSync(fin, { recursive: true })
  if (draft !== null) writeFileSync(join(fin, '定稿.md'), draft)
  if (note !== null) writeFileSync(join(fin, '交付说明.md'), note)
  if (brief !== null) writeFileSync(join(d, '01-任务简报.md'), brief)
  const names = Object.keys(figures)
  if (names.length) {
    mkdirSync(join(fin, '图件'), { recursive: true })
    for (const n of names) writeFileSync(join(fin, '图件', n), figures[n])
  }
  return d
}

test('图位：四种写法都认，同编号去重，空标题不算图位', () => {
  const md = [
    '正文开头。',
    '[图1：趋势线]',
    '![图2：占比构成](final/图2.svg)',
    '（图 3　教师周工时对比（口径差异标注），图件见 x/图3.svg）',
    '[图1：趋势线（更完整的标题）]',     // 与第一处同编号 → 去重，保留标题更全的一条
    '见[图9]的讨论。',                    // 行内指代：标题为空 → 不算图位
  ].join('\n')
  const s = parseFigureSlots(md)
  assert.deepEqual(s.map((x) => x.n), [1, 2, 3], '应识别 1/2/3 三个图位（图9 是指代不是图位）')
  assert.match(s[0].title, /更完整的标题/, '同编号保留标题更全的一条')
  assert.match(s[2].title, /教师周工时对比/, '全角括号行须贪婪匹配，标题里的嵌套括号不能截断')
})

test('图件：PNG 与 SVG 同权；非编号图件进 extras 且不计缺口', () => {
  const d = mkProj({
    draft: '[图1：定价序列]\n',
    figures: { '图1_定价序列.png': 'PNG', '封面-横版.svg': SVG },
  })
  const r = reconcileFigures(d)
  assert.equal(r.status, 'ok', 'PNG 必须算数（本机 Pillow 工作流直出 PNG，只认 svg 会把已交付的图报成缺图）')
  assert.deepEqual(r.extras, ['封面-横版.svg'], '无编号图件列进 extras')
  assert.equal(r.totals.slots, 1, 'extras 不计入图位')
  assert.equal(r.missing.length, 0)
})

test('配对回退：文件名未带图号时，采信交付说明里的显式绑定', () => {
  const d = mkProj({
    draft: '[图1：2006-2026 扶老人被讹事件时间线]\n',
    figures: { '2006-2026事件时间线.svg': SVG },     // 实测：文件名没带 `图1`
    note: '# 交付说明\n\n## 三、图件清单\n\n- `final/图件/2006-2026事件时间线.svg` — [图1]（主控手写 SVG）\n',
  })
  const r = reconcileFigures(d)
  assert.equal(r.status, 'ok', '已交付的图不能因为命名不合规就被判成缺失')
  assert.equal(r.slots[0].boundAnyway, '2006-2026事件时间线.svg')
  assert.match(figureSummaryLine(r), /按交付说明绑定/)
})

test('缺图：正文有图位、图件目录没有对应文件 → missing，并列出图号', () => {
  const d = mkProj({ draft: '[图1：甲]\n\n[图2：乙]\n', figures: { '图1_甲.svg': SVG } })
  const r = reconcileFigures(d)
  assert.equal(r.status, 'missing')
  assert.deepEqual(r.missing.map((m) => m.n), [2])
  assert.match(figureSummaryLine(r), /缺 1 张：图2/)
})

test('无图三态：已登记理由 / 未登记理由 / 未交付（pending 不算缺口）', () => {
  // ① 理由写在任务简报的 Phase 0「配图意向」里（复用既有产物，不新造约定文件）
  const a = mkProj({ draft: '# 稿\n', brief: '- **配图意向**：无（测试轮省 token）\n' })
  assert.equal(reconcileFigures(a).status, 'none-reasoned')

  // ② 已交付、无图、又没说为什么 → 标「未登记理由」
  const b = mkProj({ draft: '# 稿\n' })
  assert.equal(reconcileFigures(b).status, 'none-unreasoned')

  // ③ 没有定稿 = 还没到配图阶段 → pending（**不制造假告警**：中段项目恒红会把信号训练掉）
  const c = mkProj({})
  assert.equal(reconcileFigures(c).status, 'pending')
})

test('intent-gap：说明里定了要图却一张没落 → 真缺口（不能被当成「本就不需要」）', () => {
  const d = mkProj({
    draft: '# 稿\n',
    brief: '- **配图意向**：要图（数据图表 + 封面视觉）\n',
  })
  const r = reconcileFigures(d)
  assert.equal(r.status, 'intent-gap', '要图未落图是缺口；只有明确「不配图」才算合规缺省')
  assert.match(figureSummaryLine(r), /配图未落图/)
})

test('orphan-files：正文无图位但有已编号图件 → 图件未与正文对账', () => {
  const d = mkProj({ draft: '# 没有图位的稿\n', figures: { '图1_孤儿.svg': SVG } })
  const r = reconcileFigures(d)
  assert.equal(r.status, 'orphan-files')
  assert.deepEqual(r.orphans, ['图1_孤儿.svg'])
})
