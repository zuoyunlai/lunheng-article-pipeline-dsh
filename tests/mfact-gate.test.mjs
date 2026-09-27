// M-Fact-1（跨节事实一致性门，v18.25.0 QLT-2）回归测试
//
// 每组用例锁定一条**已实测校准的口径**（校准过程见 `M-Gate-Algorithm.md` §M-Fact 的「校准记录」）：
//   · 注入「摘要 86% / 正文 68%」同一表述 → 必红，且因含**摘要节**判 **P0**
//   · 只跨节才判（同节内重复表述不算）；容差 2% 内视为一致（约 68% vs 68.1%）
//   · **从句碎片不得成组**（实测假阳性：「可能的反驳」55.8/88/84、「年调查中」85/97/90）
//   · 通用词不成组（「增长」这类把两处无关百分比凑一组）、单位不同不判（万 vs 亿）
//   · 术语近形对（「续约频率」/「续约的频率」）→ **P2 候选**（判级归 T7，不是 P0/P1）
//   · 真源项目**不误报**：三份 golden 定稿实测该门全 PASS
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, ROOT, run, parseJson, tmp } from './_fixtures.mjs'

const M = join(SCRIPTS, 'm-gate-check.mjs')
const END = '\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'

/** 造一个最小 project：定稿（两节可注入）+ 证据包目录。返回 `{ d, draft, ev }`。 */
const mkCase = (abstractBody, bodySection) => {
  const d = tmp()
  const ev = join(d, '证据包')
  mkdirSync(ev, { recursive: true })
  const draft = join(d, '定稿.md')
  writeFileSync(draft, `# 标题\n\n## 摘要\n\n${abstractBody}\n\n## 一、正文\n\n${bodySection}\n` + END)
  return { d, draft, ev }
}
/** 跑 M 门并只取 M-Fact-1 项。 */
const factOf = ({ d, draft, ev }) => {
  const rep = join(d, 'r.json')
  run([M, draft, ev, '--report', rep])
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  return { item: (j.results || []).find((r) => /M-Fact-1/.test(r.gate)), total: j.total }
}

test('M-Fact-1：注入「摘要 86% / 正文 68%」同一表述 → 必红且判 P0（含摘要节）', () => {
  const c = mkCase('平台抽成约 86%，高于行业均值。', '平台抽成约 68%，低于行业均值。')
  const { item, total } = factOf(c)
  assert.ok(item, 'M-Fact-1 必须出现在结果里')
  assert.equal(item.pass, false, '同一表述跨节给出不同数值必须报：' + item.detail)
  assert.equal(item.severity, 'P0', '任一出现落在摘要/结论节 → P0（规格如此）')
  assert.equal(item.conflicts[0].key, '平台抽成')
  assert.deepEqual(item.conflicts[0].values, [86, 68])
  assert.equal(total, 24, `M 门机械项数应为 24（含 M-Fact-1 与 M-Exist-11）：实测 ${total}`)
  rmSync(c.d, { recursive: true, force: true })
})

test('M-Fact-1：只跨节才判 + 容差 2%（同节重复 / 容差内差异都不得报）', () => {
  // 同节内两次不同数值 → 不判（判据是「跨节」）
  let c = mkCase('本节无数字。', '平台抽成约 68%，另处又说平台抽成约 86%。')
  assert.equal(factOf(c).item.pass, true, '同节内不同数值不得报（非跨节）')
  rmSync(c.d, { recursive: true, force: true })

  // 跨节但差异在容差内（68 vs 68.1）→ 不判
  c = mkCase('平台抽成约 68.1%。', '平台抽成约 68%。')
  assert.equal(factOf(c).item.pass, true, '容差 2% 内视为一致')
  rmSync(c.d, { recursive: true, force: true })

  // 跨节且超容差 → 判（含摘要 → P0）
  c = mkCase('平台抽成约 70%。', '平台抽成约 60%。')
  assert.equal(factOf(c).item.pass, false, '跨节超容差必须报')
  rmSync(c.d, { recursive: true, force: true })
})

test('M-Fact-1：**从句碎片不得成组**（实测假阳性「可能的反驳」/「年调查中」）', () => {
  const c = mkCase('可能的反驳是 55.8% 的样本。', '另一种可能的反驳是 88% 的样本，还有 84% 的人持此看法。')
  const { item } = factOf(c)
  assert.equal(item.pass, true, '键含从句标记词「的/可能」→ 不成组（否则实测 3 处假阳性）：' + item.detail)
  rmSync(c.d, { recursive: true, force: true })

  const c2 = mkCase('在 2024 年调查中，85% 的人表示同意。', '另一年调查中，97% 的人表示同意。')
  assert.equal(factOf(c2).item.pass, true, '键以「中」结尾属从句碎片 → 不成组')
  rmSync(c2.d, { recursive: true, force: true })
})

test('M-Fact-1：通用词不成组 + 单位不同不判（防「增长/占比」与万-vs-亿 假阳性）', () => {
  let c = mkCase('增长约为 12%，超出预期。', '增长约为 30%，不及预期。')
  assert.equal(factOf(c).item.pass, true, '通用词开头（增长）不得成组')
  rmSync(c.d, { recursive: true, force: true })

  c = mkCase('驻军人数约 5.4 万，规模可观。', '驻军人数约 3 亿，规模可观。')
  assert.equal(factOf(c).item.pass, true, '单位不同（万 vs 亿）不判——换算差异会造成假阳性')
  rmSync(c.d, { recursive: true, force: true })
})

test('M-Fact-1：术语近形对 → **P2 候选**（判级归 T7，不得升 P1；**仅当词被标点/空白切出**）', () => {
  // 口径边界如实声明：近形项用 `[\u4e00-\u9fff]{4,6}` 取词，故只在词**被标点/空白/换行切出**时可见；
  //   嵌在长句里的术语（如「认为续约频率是核心变量」）不会被单独取出——**零假阳性、低召回**是刻意的
  //   （滑窗全量取词会把任意 4-6 字片段当候选，假阳性爆炸）。本用例即按该真实行为写。
  const c = mkCase('续约频率 是核心变量，「续约频率」再次出现。', '续约的频率 同样重要，（续约的频率）被反复引用。')
  const { item } = factOf(c)
  assert.ok(item, 'M-Fact-1 必须在场')
  assert.equal(item.severity, 'P2', '术语近形只判 P2 候选：' + item.detail)
  assert.ok(item.aliasPairs && item.aliasPairs.length >= 1, '须列出近形对供 T7 判读：' + JSON.stringify(item.aliasPairs))
  rmSync(c.d, { recursive: true, force: true })
})

test('M-Fact-1：真源仓库三份 golden 定稿实测不误报（只在项目存在时跑）', () => {
  const roots = [
    'E:/HERNESS/run/共锁-自愿性理论的第四象限',
    'E:/HERNESS/run/ai-content-farm-retractions',
    'E:/HERNESS/run/甲醛白菜事件',
  ].filter((p) => {
    try { readFileSync(join(p, 'final', '定稿.md')); return true } catch { return false }
  })
  if (roots.length === 0) return   // 无本地项目（CI）→ 跳过：本用例是**本地防误报网**，不依赖仓库夹具
  for (const p of roots) {
    const rep = join(tmp(), 'r.json')
    run([M, join(p, 'final', '定稿.md'), join(p, 'final', '证据包'), '--report', rep], { timeout: 180000 })
    const j = JSON.parse(readFileSync(rep, 'utf8'))
    const item = (j.results || []).find((r) => /M-Fact-1/.test(r.gate))
    assert.ok(item, `${p} 应产出 M-Fact-1 结果`)
    assert.notEqual(item.severity, 'P0', `${p} 被误报 P0（实测该门在 golden 上全 PASS 或仅 P2）：` + item.detail)
    assert.notEqual(item.severity, 'P1', `${p} 被误报 P1：` + item.detail)
  }
  void ROOT
})
