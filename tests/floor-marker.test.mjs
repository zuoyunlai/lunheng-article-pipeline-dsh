// L1 批（v19.12.0）：不足侧 `FLOOR=hard|soft` 的机械验收
//
// **要钉住的事实**（缺一条就等于该标记没有生效）：
//   ① `FLOOR` **缺标记 = hard**（= 现行行为，历史项目不回填）；
//   ② `FLOOR=soft` 时「不足 >10%」**只报告、不阻塞**（脚本 exit 0、verdict 写明 P2）；
//   ③ `soft` **只作用于下限**——超限侧（> +5%）的判级与退出码**一字不变**。
//
// **真源**：文类 → 档位映射 = `references/_shared/文类档案.md` §`FLOOR` 档；
//   判级口径 = `references/_shared/字数判定表.md` §二。
// **为什么由各脚本自己读标记、而不是各自收 `--genre`**：`apply-*-cycle` 本来就不收该旗标，
//   给它加一张「文类 → 档位」表会造第二份真源（`mform-gates.mjs` 的 `GENRE_MIN_L` 已是唯一那张）。
//
// **边界（如实）**：本文件只验「标记 → 判级 / 退出码」这条链路，不验文类映射本身
//   （那由 `文类档案.md` 的对账用例钉）；夹具是合成的，不依赖 `run/` 下任何真项目。
//   ⚠️ 正文区汉字数**不等于**「Σ各节字符数」——节标题里的「第N节」也算汉字（六节 = 12 个），
//   故断言一律从脚本自报的 `chars.body` 出发算差值，不硬编码绝对数（实测踩过：8612 ≠ 8600）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { run, tmp, ROOT } from './_fixtures.mjs'

const S = (n) => join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', n)
const CYCLE = S('apply-compression-cycle.mjs')
const G = S('g-audit-check.mjs')

/** 大纲：六节、各节下限 1,000（下限和 6,000 < 目标 × 0.95，不触发弹性提示、不干扰本组断言）。 */
const OUTLINE = (() => {
  const mins = [1000, 1000, 1000, 1000, 1000, 1000]
  const heads = mins.map((n, i) => `## ${i + 1} 第${i + 1}节（预算 ≥${n} 字）\n\n本节内容。\n`).join('\n')
  const rows = mins.map((n, i) => `| §${i + 1} 第${i + 1}节 | ${n} | ≥${n} |`)
  return `# 分析大纲\n\n${heads}\n## §11 写手版精简段（T5 只读本节）\n\n`
    + `**四、字数预算（口径 A：正文区纯汉字）**\n\n| 章节 | 正文分配 | 本章最小硬指标 |\n|---|---|---|\n`
    + rows.join('\n') + '\n'
})()

/** 定稿：`## 摘要`（20 汉字）+ 六节正文（节标题另计汉字，见文件头边界）。 */
const draftOf = (perSection) => '# 标题\n\n## 摘要\n\n' + '摘'.repeat(20) + '\n\n'
  + perSection.map((n, i) => `## ${i + 1} 第${i + 1}节\n\n` + '汉'.repeat(n) + '\n').join('\n')
  + '\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'

/**
 * 造一个最小项目：`run/proj/{01-任务简报.md, analysis/分析大纲.md, final/定稿.md, final/证据包/}`。
 * @param {number} perSection 每节正文字符数（正文区 ≈ 20 + 6×perSection + 12 个标题汉字）
 * @param {'hard'|'soft'|null} floor null = 简报不写该标记
 */
const mkProj = ({ perSection, floor = null, target = 8000 }) => {
  const d = tmp('lunheng-floor-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final', '证据包'), { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  const floorLine = floor ? `\nFLOOR=${floor}\n` : ''
  writeFileSync(join(proj, '01-任务简报.md'), `# 简报\n\n目标篇幅：${target} 字\n${floorLine}`, 'utf8')
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), OUTLINE, 'utf8')
  writeFileSync(join(proj, 'final', '定稿.md'), draftOf(Array(6).fill(perSection)), 'utf8')
  return { d, proj }
}

/** 取压缩轮 JSON（stdout 前半段固定是 JSON；解析失败时把原文带进断言信息）。 */
const cycleJson = (r) => {
  try { return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) } catch { return null }
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 缺标记 = hard：现行行为必须一字不变（这是「向后兼容」的唯一证据）
// ─────────────────────────────────────────────────────────────────────────────
test('FLOOR 缺标记：不足 >10% 仍判 P0 且 exit 1（现行行为不回填）', () => {
  // 目标 8,000 → floor 7,200；正文 ≈ 7,000（−12.5%）。
  const { d, proj } = mkProj({ perSection: 1160 })
  try {
    const r = run([CYCLE, proj, '--dry-run'])
    const j = cycleJson(r)
    assert.ok(j, '须输出 JSON：' + r.out.slice(0, 300))
    assert.ok(j.chars.body < j.charBand.floor, `夹具须落在不足侧：body=${j.chars.body} floor=${j.charBand.floor}`)
    assert.equal(r.code, 1, '缺标记时不足侧必须 exit 1（v19.11.2 的修法不得被本次改动回退）')
    assert.match(j.verdict, /^低于阻塞线\s*\d+\s*字（P0，须扩写）$/, 'verdict 须与改前逐字一致：' + j.verdict)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// ② soft：不足只报告、不阻塞
// ─────────────────────────────────────────────────────────────────────────────
test('FLOOR=soft：不足 >10% 记 P2、exit 0（不触发扩写轮）', () => {
  const { d, proj } = mkProj({ perSection: 1160, floor: 'soft' })
  try {
    const r = run([CYCLE, proj, '--dry-run'])
    const j = cycleJson(r)
    assert.ok(j, '须输出 JSON：' + r.out.slice(0, 300))
    assert.ok(j.chars.body < j.charBand.floor, `夹具须落在不足侧：body=${j.chars.body} floor=${j.charBand.floor}`)
    assert.equal(r.code, 0, 'FLOOR=soft 时不足侧不得阻塞')
    assert.match(j.verdict, /^低于阻塞线\s*\d+\s*字（P2，不阻塞——FLOOR=soft）$/,
      '判级须写明 P2 与依据：' + j.verdict)
    // 前缀 `低于阻塞线` 必须保留：它是 `gapDirection` / `recommendation` 的 `includes()` 控制信号。
    assert.equal(j.gapDirection, 'expand', 'gapDirection 仍须为 expand（内部契约靠前缀 includes 消费）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('FLOOR=soft 只管下限：超限 >5% 仍 exit 1（判级 P1 不变）', () => {
  // 目标 8,000 → ceil 8,400；正文 ≈ 8,612（越线 212）。
  const { d, proj } = mkProj({ perSection: 1430, floor: 'soft' })
  try {
    const r = run([CYCLE, proj, '--dry-run'])
    const j = cycleJson(r)
    assert.ok(j, '须输出 JSON：' + r.out.slice(0, 300))
    assert.ok(j.chars.body > j.charBand.ceil, `夹具须落在超限侧：body=${j.chars.body} ceil=${j.charBand.ceil}`)
    assert.equal(r.code, 1, 'soft 不得放宽上限')
    assert.match(j.verdict, /^超阻塞线\s*\+\d+\s*字（P1，须压缩）$/, '超限侧文案与判级须一字不变：' + j.verdict)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// ③ G 审计面同源：G8 的「判级义务」字段必须跟着标记走（义务可见，判定仍归 T7）
// ─────────────────────────────────────────────────────────────────────────────
test('g-audit G8：FLOOR 缺标记 → adjudicationRequired.level = P0；FLOOR=soft → P2', () => {
  const g8Of = (proj) => {
    const r = run([G, join(proj, 'final', '定稿.md'), '--cards', join(proj, 'final', '证据包'), '--brief', join(proj, '01-任务简报.md')])
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    const c = Object.values(j.checks).find((x) => /字数偏差/.test(String(x.name || '')))
    assert.ok(c, 'checks 里须有「字数偏差」项：' + Object.keys(j.checks).join(','))
    return c
  }
  const hard = mkProj({ perSection: 1160 })
  const soft = mkProj({ perSection: 1160, floor: 'soft' })
  try {
    const c8 = g8Of(hard.proj)
    assert.equal(c8.evidence.adjudicationRequired.level, 'P0', '缺标记须给 P0 义务：' + JSON.stringify(c8.evidence))
    assert.equal(c8.evidence.floorMarker, null, '未写标记时 floorMarker 须为 null（不得默认成 hard 字符串）')

    const s8 = g8Of(soft.proj)
    assert.equal(s8.evidence.adjudicationRequired.level, 'P2', 'FLOOR=soft 须给 P2 义务：' + JSON.stringify(s8.evidence))
    assert.equal(s8.evidence.floorSoft, true)
    assert.match(s8.detail, /P2（提示，不触发扩写轮——简报标 `FLOOR=soft`）/, 'detail 须写明软档：' + s8.detail)
  } finally {
    rmSync(hard.d, { recursive: true, force: true })
    rmSync(soft.d, { recursive: true, force: true })
  }
})
