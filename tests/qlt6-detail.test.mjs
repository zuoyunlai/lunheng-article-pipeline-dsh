// v18.65.0（反哺报告-v5 §v5.3-2 的 C2 变体）：**QLT-6 逐维 / 逐域明细**回归。
//
// 为什么要这组钉子：C2 的裁定是「**不造新框架**——QLT-6 已经是那把尺；只加定位用的明细」。
//   于是本文件要钉住两件**相反**的事：① 明细**在**（逐维六分 / 逐域 C1–C7 聚合）；② 明细**不参与计分**
//   （`score` 仍只由 ① 的 ratio 与 ② 的闭合率按 50/50 合成）——只钉第 ① 件会让「明细悄悄改了总分」无法被发现，
//   只钉第 ② 件则明细丢了也没人知道。
// 运行：node --test tests/qlt6-detail.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, ROOT } from './_fixtures.mjs'

const { evaluateQlt6 } = await import(new URL('../skills/lunheng-article-pipeline/scripts/_lib/qlt6.mjs', import.meta.url).href)

/** 最小项目：定稿 + 审稿报告（六维 + 总评分）+ 批判报告（C1/C2 两域条件） */
const mkProject = () => {
  const d = tmp('lunheng-qlt6d-')
  mkdirSync(join(d, 'final'), { recursive: true })
  mkdirSync(join(d, 'audits'), { recursive: true })
  mkdirSync(join(d, 'analysis'), { recursive: true })
  const draft = join(d, 'final', '定稿.md')
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文 [L01]。\n')
  writeFileSync(join(d, 'audits', '审稿报告-v1.md'),
    '# 审稿报告\n\n> **总评分**：24 / 30\n\n## 评审维度\n\n'
    + '### 1. 原创性（5/5）\n### 2. 方法论（3/5）\n### 3. 证据强度（4/5）\n'
    + '### 4. 论证结构（4/5）\n### 5. 写作质量（4/5）\n### 6. 引文规范（4/5）\n\n'
    + '- **总分**：24 / 30（5 + 3 + 4 + 4 + 4 + 4）\n')
  // 批判报告：条件集取自「全文 P0/P1 攻击条目标题」（本夹具不给 §关闭状态 清单）
  writeFileSync(join(d, 'analysis', '批判报告-v1.md'),
    '# 批判报告\n\n### [P0-C1-1] 甲攻击\n\n正文\n\n### [P1-C1-4] 乙攻击\n\n正文\n\n### [P1-C2-3] 丙攻击\n\n正文\n')
  return { d, draft }
}

test('① 逐维明细：从审稿报告的 `### N. 名称（x/5）` 解析六维（**不改 ① 的 ratio**）', () => {
  const { d, draft } = mkProject()
  try {
    const r = evaluateQlt6({ projectDir: d, draftPath: draft })
    const dims = r.components[0].evidence.byDimension
    assert.equal(dims.length, 6, '六维应全部解析出来')
    assert.deepEqual(dims.map((x) => x.dimension), ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范'])
    assert.deepEqual(dims.map((x) => x.score), [5, 3, 4, 4, 4, 4])
    // ① 的 ratio 只由「总评分」决定（24/30 → clamp((24−16)/14) = 0.5714），与逐维无关
    assert.equal(r.components[0].ratio, 0.5714)
    assert.match(r.notes.join('\n'), /① 逐维明细（\*\*不参与计分\*\*/, '必须有一行「不参与计分」的逐维明细')
    assert.match(r.notes.join('\n'), /最低维 = 方法论 3\/5/, '最低维应被点出（定位信息）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('①b（v18.80.5 动议 A）：evidence 必须同时给**不夹取**的 `ratioRaw` 与下界饱和标记', () => {
  // 由来：① 的下界 = reject 上界 16 ⇒ 总评分 ≤16 一律映射 0，低分段分辨率被抹平
  //   （v18.80.4 跨体例盲评实测：15/30 与 16/30 的 ① 同为 0.0000）。裁定 = **只加读数、不改合成**，
  //   故本条同时钉两件相反的事：**读数在**（ratioRaw = total/30）+ **合成不变**（ratio 仍是夹取值）。
  const { d, draft } = mkProject()
  try {
    const r = evaluateQlt6({ projectDir: d, draftPath: draft })
    const ev = r.components[0].evidence
    assert.equal(ev.ratioRaw, +(24 / 30).toFixed(4), 'ratioRaw 必须是不夹取的 总分/30')
    assert.equal(ev.saturatedAtFloor, false, '24 > 16 → 未触下界')
    assert.equal(r.components[0].ratio, 0.5714, '合成仍用夹取值（口径未改，既有标定不作废）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('①c（v18.80.5）：总评分 16 → ratio 夹取为 0，但 ratioRaw 保留分辨率（0.5333）', () => {
  const { d, draft } = mkProject()
  try {
    writeFileSync(join(d, 'audits', '审稿报告-v1.md'),
      '# 审稿报告\n\n> **总评分**：16 / 30\n\n- **总分**：16 / 30（3 + 3 + 2 + 3 + 3 + 2）\n')
    const r = evaluateQlt6({ projectDir: d, draftPath: draft })
    const ev = r.components[0].evidence
    assert.equal(r.components[0].ratio, 0, '16 = reject 上界 → 夹取后 0（既有口径）')
    assert.equal(ev.saturatedAtFloor, true, '须标出「已触下界」，否则读者会以为它真的很差')
    assert.equal(ev.ratioRaw, 0.5333, 'ratioRaw 让低分段差异仍可见（这就是动议 A 的目的）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('② 逐域明细：按条件 id 的 `C1–C7` 段聚合（提出 / 已关闭 / 未闭合 id）', () => {
  const { d, draft } = mkProject()
  try {
    const r = evaluateQlt6({ projectDir: d, draftPath: draft })
    const by = r.components[1].evidence.byDomain
    const c1 = by.find((x) => x.domain === 'C1'); const c2 = by.find((x) => x.domain === 'C2')
    assert.ok(c1 && c2, '应聚合出 C1 / C2 两域：' + JSON.stringify(by))
    assert.deepEqual({ p: c1.proposed, c: c1.closed }, { p: 2, c: 0 })
    assert.deepEqual(c1.openIds, ['P0-C1-1', 'P1-C1-4'])
    assert.deepEqual({ p: c2.proposed, c: c2.closed }, { p: 1, c: 0 })
    assert.match(r.notes.join('\n'), /② 逐域明细（\*\*不参与计分\*\*/, '必须有一行「不参与计分」的逐域明细')
    assert.match(r.notes.join('\n'), /未闭合域 = C1\(0\/2\)、C2\(0\/1\)/, '未闭合域应被点出（且不带 id 列表，避免 note 被 30 条 id 撑爆）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('③ **反向钉**：明细不进计分——`score` 必须恰等于 ①ratio×50 + ②ratio×50（改明细不得改分）', () => {
  const { d, draft } = mkProject()
  try {
    const r = evaluateQlt6({ projectDir: d, draftPath: draft })
    const expect = +(r.components[0].ratio * 50 + r.components[1].ratio * 50).toFixed(1)
    assert.equal(r.score, expect, `score 必须只由两分量合成（实得 ${r.score}，按分量应为 ${expect}）`)
    // 且两分量权重仍是 50/50（防「顺手把明细当第三分量」）
    assert.deepEqual(r.components.map((c) => c.weight), [50, 50])
    assert.match(String(r.validity.byDomainNote || ''), /只用于定位/, 'validity 必须声明明细只用于定位')
    assert.match(String(r.validity.byDomainNote || ''), /不参与计分/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('④ 源码钉：明细字段不得进入加权求和（`weighted` 只由两个 ratio 产生）', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', '_lib', 'qlt6.mjs'), 'utf8')
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  // 求和式里不得出现 byDimension / byDomain
  const sumLine = (code.match(/const\s+score\s*=[^\n]*/) || [''])[0]
  assert.ok(sumLine, '未找到 score 求和式（源码钉失效）')
  assert.ok(!/byDimension|byDomain/.test(sumLine), 'score 求和式里出现了明细字段——明细不得参与计分')
  // 求和式只许由**加权分量聚合**产生（实测形态：`100 * wGot / wSum`，权重来自各分量的 weight）
  assert.match(sumLine, /wGot|wSum|panel\.|closure\./, 'score 求和式应由加权分量产生（wGot/wSum），而不是别的量')
})
