// G8 字数偏差的**方向可辨 + 判级义务可见**回归（v18.81.0 · 独立审计批 2 · 2.4c）
//
// **为什么需要**：本项此前只有「对上界」一条 detail 分支，于是**不足侧**也会被写成
//   「= 0.370×（对上界）→ 候选」——**方向相反、读数误导**，而 `字数判定表.md` §二明写
//   「**不足 >10% → P0（须扩写）**」（2026-09-29 主人裁定、**明示保留**该档）。
//   ⇒ 结果是「方向记错 + 该 P0 档在机检面完全不可见」（真机复现：`run/中国新能源车出口-2026-09`
//   实测 1,850 字 vs 简报 5,000 字，旧 detail 写「0.370×（对上界）」）。
//
// **本组同时钉住一条刻意设计**：本项**仍不自行判 P1/P0**——理由是简报篇幅可能是失效早期值，
//   实测存在「简报 16k / 定稿 40k + 交付说明记主人豁免」这种**已授权**情形，判罚是最贵的假阳性。
//   故修法只做两件不改判级的事：① detail 分方向；② 新增 `adjudicationRequired`（义务可见、判定归人）。
//   P5 用例就是这条设计的守卫：**判级字段不得被改成 severity**。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const G = () => join(SCRIPTS, 'g-audit-check.mjs')

// 生成约 n 个纯汉字（用**单字** repeat：`'汉字'.repeat(n)` 会给出 2n 字——首版就这么踩了，
//   于是 chars=5200 实际是 10400，P3/P4 两条用例被自己的夹具骗红）
const DRAFT = (n) => '# 标题\n\n## 摘要\n\n' + '汉'.repeat(Math.max(1, n)) + '\n'
const BRIEF = (t) => `# 任务简报\n\n- **篇幅**：**${t} 字**（学术档）\n`

const mk = ({ target = 5000, chars = 5000, brief = null } = {}) => {
  const d = tmp('lunheng-g8-')
  mkdirSync(join(d, 'final', '证据包'), { recursive: true })
  writeFileSync(join(d, 'final', '定稿.md'), DRAFT(chars))
  writeFileSync(join(d, '01-任务简报.md'), brief ?? BRIEF(target))
  return { d, draft: join(d, 'final', '定稿.md'), brief: join(d, '01-任务简报.md'), cards: join(d, 'final', '证据包') }
}
const g8 = (f) => {
  const j = parseJson(run([G(), f.draft, '--cards', f.cards, '--brief', f.brief]))
  // 输出形态：`checks` 是**按检查项 id 键控的对象**（`G8-CharCount`），不是数组——两种都容忍。
  if (Array.isArray(j.checks)) return j.checks.find((x) => String(x.name).startsWith('字数偏差'))
  return j.checks['G8-CharCount'] || Object.values(j.checks).find((x) => String(x?.name).startsWith('字数偏差'))
}

test('P1【核心】：**不足侧** >10% → detail 必须写「不足侧」，且 `adjudicationRequired` 指 P0', () => {
  const f = mk({ target: 5000, chars: 1850 })   // 与真机同量级（实测 0.37×）
  try {
    const it = g8(f)
    assert.equal(it.evidence.shortfall, true, '应识别为不足侧')
    assert.match(it.detail, /不足侧/, '方向必须写明（旧版写「对上界」，方向相反）：' + it.detail)
    assert.match(it.detail, /P0/, '须把 §二 的 P0 档摆出来：' + it.detail)
    assert.equal(it.evidence.adjudicationRequired.level, 'P0', '须给出 T7 应判的档位')
    assert.match(it.evidence.adjudicationRequired.why, /不足 >10%/, '须给出判级依据真源')
    assert.ok(it.evidence.adjudicationRequired.floor > 0, '须给出下限实值（可复算）')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('P2：**超限** >5% → 方向为超限，`adjudicationRequired` 指 P1（不得与不足侧同形）', () => {
  const f = mk({ target: 5000, chars: 6000 })
  try {
    const it = g8(f)
    assert.notEqual(it.evidence.shortfall, true, '超限不得被判为不足')
    assert.match(it.detail, /对上界/, '须保留超限侧写法：' + it.detail)
    assert.equal(it.evidence.adjudicationRequired.level, 'P1', JSON.stringify(it.evidence.adjudicationRequired))
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('P3：超限 ≤5%（+4%）→ **落在候选区间内**，不产生判级义务（`adjudicationRequired` 为 null）', () => {
  // 判据来自实现：候选区间上界 = hi × 1.05，故 ≤5% 的超限**本就在带内** → 本项判通过。
  //   ⇒ 首版把它写成「应指 P2」是**错的**（那个分支不可达）；本用例现改为钉住真正的行为，
  //     并在代码侧删掉了该死分支（死分支比没有分支更误导）。
  const f = mk({ target: 5000, chars: 5200 })
  try {
    const it = g8(f)
    assert.equal(it.pass, true, '+4% 应在候选区间内（上界 5000×1.05=5250）：' + it.detail)
    assert.equal(it.evidence.adjudicationRequired, null, '带内不得产生判级义务')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('P4：落在候选区间内 → `adjudicationRequired` 为 null（不制造无对象的义务）', () => {
  const f = mk({ target: 5000, chars: 5000 })
  try {
    const it = g8(f)
    assert.equal(it.pass, true, '区间内应通过：' + it.detail)
    assert.equal(it.evidence.adjudicationRequired, null, '通过时不得留义务字段')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('P5【设计守卫】：`WAIVER=on` 仍整体 SKIP，且**本项始终不自判 severity**（判级归 T7）', () => {
  const f = mk({ target: 5000, chars: 1850, brief: BRIEF(5000) + '\n- WAIVER=on\n' })
  try {
    const it = g8(f)
    assert.equal(it.checked, false, 'WAIVER=on 应 SKIP：' + JSON.stringify(it))
    assert.equal(it.severity, 'SKIP')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
  const f2 = mk({ target: 5000, chars: 1850 })
  try {
    const it2 = g8(f2)
    assert.equal(it2.severity, 'P2',
      '候选类**必须**保持 P2 —— 若改成 P1/P0 就是把「判级归 T7」的设计推翻（那会重演"已授权篇幅被judged为缺陷"的最贵假阳性）')
  } finally { rmSync(f2.d, { recursive: true, force: true }) }
})
