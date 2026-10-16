// 元分析协议生成器 `meta-synthesize.mjs` 回归网（v19.7.1 · 元分析输入面修复批）
//
// **为什么需要**：该脚本此前在 `tests/**` 里**零覆盖**（本批修复前，它的输出面没有任何一条用例），
//   而它同时是「Phase 0 触发式协议生成 + 直接写盘（`--report`）」的脚本——零覆盖正是两条真缺陷
//   长期潜伏的结构性原因（实测 `run/xingbie` 56 张数据卡暴露）。
//
// 本文件钉三件事（对应两条已实测缺陷 + 一条防误改）：
//   · **缺陷① 效应量退化不再是静默的**：`studyType` 未识别的卡**必须**给出 `candidates: []` + `degraded: true`，
//     **不得**再回落到「通用候选」（旧版 `else` 分支让 56/56 卡拿到同一组 MD/SMD/r，下游会误读成「已识别」）；
//     且 `effectSizeSummary.degraded` 必须等于这种卡的张数（**反向自证**：已知类型不得被算成 degraded）。
//   · **缺陷② PRISMA 的单位如实声明**：`prismaFlow.unit` 必须点明记录单位是**数据卡（数据点）而非研究**，
//     且 `studyCount === null`（数据卡契约不含「研究标识」⇒ 脚本**不得**把 records 数当研究数）。
//     **反向钉**：`identification.identified` 仍须等于卡数——不许用「改小数字」来消除歧义（那是伪造）。
//   · **退出码纪律**：阈值未达 → **exit 3**（`repo-hygiene-check` 钉住本脚本的退出码集 `[0, 3, 10, 70]`，
//     **不得新增**退出码）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp, parseJson } from '../_fixtures.mjs'

const META = () => join(SCRIPTS, 'meta-synthesize.mjs')

/** 建一个最小项目（只需 `data/数据卡.md`——该脚本的唯一输入）。 */
const mk = (dataCardText) => {
  const ws = tmp('lunheng-meta-')
  const proj = join(ws, 'proj')
  mkdirSync(join(proj, 'data'), { recursive: true })
  writeFileSync(join(proj, 'data', '数据卡.md'), dataCardText)
  return { ws, proj, card: join(proj, 'data', '数据卡.md') }
}

/** `### [Dxx]` 段形态；`type` 为空串 = **卡体不含任何 studyType 关键词**（= 未识别）。 */
const sec = (i, type = '') => {
  const id = String(i).padStart(2, '0')
  return `### [D${id}] 指标${i}\n年份：2023\n样本量：100\n${type ? `研究类型：${type}\n` : ''}\n`
}

/** 索引段表格形态：本脚本的**兜底路径**，其 `studyType` 恒为 `null`（不解析卡体）。 */
const idx = (n) => Array.from({ length: n }, (_, k) =>
  `| [D${String(k + 1).padStart(2, '0')}] | 指标${k + 1} | 100万 | 来源X 2023 |`).join('\n') + '\n'

test('退出码纪律：阈值未达 → exit 3（本脚本退出码集为 [0,3,10,70]，不得新增）', () => {
  const { ws, proj } = mk(sec(1) + sec(2))
  try {
    const r = run([META(), proj, '--trigger', '10'])
    assert.equal(r.code, 3, '卡数 2 < 阈值 10 应 exit 3：' + r.out)
    assert.match(r.stderr, /未触发元分析协议生成/, 'stderr 须如实说明未触发：' + r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('缺陷①：studyType 未识别 → candidates 为空 + degraded=true（**不得**回落通用候选）', () => {
  const { ws, proj } = mk(idx(3))
  try {
    const r = run([META(), proj, '--trigger', '3'])
    assert.equal(r.code, 0, r.out)
    const j = parseJson(r)
    assert.equal(j.effectSizeCandidates.length, 3, '三张卡都应出现在候选清单里（不得因退化而被丢弃）')
    for (const c of j.effectSizeCandidates) {
      assert.equal(c.studyType, null, '索引段路径解析不出 studyType：' + JSON.stringify(c))
      assert.deepEqual(c.candidates, [],
        '未识别时**必须给空候选**——旧版在此回落到 MD/SMD/r，56/56 卡会拿到同一组候选而被下游误读成「已识别」：' + JSON.stringify(c))
      assert.equal(c.degraded, true, '未识别必须显式标 degraded：' + JSON.stringify(c))
      assert.ok(c.degradedReason && c.degradedReason.length > 0, 'degraded 必须带理由，不许裸标：' + JSON.stringify(c))
    }
    assert.deepEqual(
      { total: j.effectSizeSummary.total, identified: j.effectSizeSummary.identified, degraded: j.effectSizeSummary.degraded },
      { total: 3, identified: 0, degraded: 3 },
      '退化须在**顶层聚合**处可读（单卡上的 degraded 容易被略过）：' + JSON.stringify(j.effectSizeSummary))
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('缺陷① 反向自证：已知 RCT → OR/RR + RD 且 degraded=false（不得把已知类型也算退化）', () => {
  const { ws, proj } = mk(sec(1, 'RCT') + sec(2, '队列研究') + sec(3, 'case-control'))
  try {
    const r = run([META(), proj, '--trigger', '3'])
    assert.equal(r.code, 0, r.out)
    const j = parseJson(r)
    for (const c of j.effectSizeCandidates) {
      assert.equal(c.degraded, false, '已知二分类设计不得标 degraded：' + JSON.stringify(c))
      assert.equal(c.candidates.length, 2, 'RCT/队列/case-control 应给 OR/RR + RD 两项：' + JSON.stringify(c))
      assert.match(c.candidates.join('|'), /OR \/ RR/, JSON.stringify(c))
    }
    assert.equal(j.effectSizeSummary.degraded, 0, '已知类型不得计入 degraded：' + JSON.stringify(j.effectSizeSummary))
    assert.equal(j.effectSizeSummary.identified, 3)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('缺陷① 三分支：已知非 RCT（横断面）仍给连续候选但 degraded=false', () => {
  const { ws, proj } = mk(sec(1, '横断面') + sec(2, 'survey'))
  try {
    const r = run([META(), proj, '--trigger', '2'])
    assert.equal(r.code, 0, r.out)
    const j = parseJson(r)
    for (const c of j.effectSizeCandidates) {
      assert.equal(c.degraded, false, '「已识别但非二分类设计」≠「未识别」：' + JSON.stringify(c))
      assert.equal(c.candidates.length, 3, '连续结局分支应给 MD / SMD / r 三项：' + JSON.stringify(c))
    }
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('缺陷②：PRISMA 单位如实声明（记录 = 数据卡 ≠ 研究）+ studyCount 为 null', () => {
  const { ws, proj } = mk(sec(1, 'RCT') + sec(2, 'RCT'))
  try {
    const r = run([META(), proj, '--trigger', '2'])
    assert.equal(r.code, 0, r.out)
    const j = parseJson(r)
    assert.match(j.prismaFlow.unit, /不是研究数/,
      'unit 必须点明记录单位不是研究——旧版让四个阶段一律等于卡数，读者会读成「N 项研究入选」：' + j.prismaFlow.unit)
    assert.equal(j.prismaFlow.studyCount, null,
      'studyCount 必须为 null（数据卡契约无「研究标识」⇒ 脚本不得把 records 当研究数）：' + JSON.stringify(j.prismaFlow.studyCount))
    assert.match(j.prismaFlow.studyCountReason, /研究标识/, 'null 必须带理由，不许裸标：' + j.prismaFlow.studyCountReason)
    // **反向钉**：不得用「改小数字」来消除歧义——records 计数仍须如实等于卡数
    assert.equal(j.prismaFlow.identification.identified, 2, 'records 计数不得被改小（那是伪造而非修复）')
    assert.equal(j.prismaFlow.included.included, 2)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('输入面缺口如实声明：meta.notes 必须同时点出效应量面与 PRISMA 面两条后果', () => {
  const { ws, proj } = mk(sec(1, 'RCT'))
  try {
    const r = run([META(), proj, '--trigger', '1'])
    assert.equal(r.code, 0, r.out)
    const j = parseJson(r)
    const text = (j.meta.inputFaceCaveats || []).join('\n')
    assert.match(text, /效应量面/, '须声明效应量面后果：' + text)
    assert.match(text, /PRISMA 面/, '须声明 PRISMA 面后果：' + text)
    assert.match(text, /数据点/, '须点明输入是数据点而非研究报告：' + text)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('写面安全：`--report` 与数据卡同文件 → exit 10（不得自毁输入）', () => {
  const { ws, proj, card } = mk(sec(1, 'RCT'))
  try {
    const r = run([META(), proj, '--trigger', '1', '--report', card])
    assert.equal(r.code, 10, '报告路径 == 数据卡路径 应被判参数错 exit 10：' + r.out)
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('写面正确性：`--report` 落盘且内容与 stdout 同源（可被下游直接读）', () => {
  const { ws, proj } = mk(sec(1, 'RCT') + sec(2))
  const out = join(ws, 'meta.json')
  try {
    const r = run([META(), proj, '--trigger', '2', '--report', out])
    assert.equal(r.code, 0, r.out)
    assert.ok(existsSync(out), '--report 应落盘：' + out)
    const j = JSON.parse(readFileSync(out, 'utf8').replace(/^\uFEFF/, ''))
    assert.equal(j.effectSizeSummary.total, 2, '落盘内容须含本批新增的退化聚合：' + JSON.stringify(j.effectSizeSummary))
    assert.equal(j.effectSizeSummary.degraded, 1, '一卡已知(RCT) + 一卡未识别 ⇒ degraded=1')
  } finally { rmSync(ws, { recursive: true, force: true }) }
})
