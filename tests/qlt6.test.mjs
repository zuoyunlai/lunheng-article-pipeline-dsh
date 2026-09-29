// v18.53.0（QLT-5 反哺 F-BC ③ / 主人裁定口径 D）**QLT-6 论证强度**回归测试
//
// 本文件锁的是**量尺的效度与边界**（不是「分数好不好看」）：
//   · 双分量合成口径：50% × 审稿判断（T9 六维和值归一化） + 50% × 论证缺陷闭合率
//   · **指纹绑定**：关闭裁定只对**被审的那一版正文**有效 ——「基线对照」行里的本版 sha **不算绑定**
//     （这是标定第一轮 FAIL 的根因：不收紧就会让 v3 快照借 v4 的裁定拿到 10/10，位移归零 = 假绿）
//   · 无绑定裁定 → ② **保守按未关闭计 0**（与 M-Exist-4「关闭真源 = 复核报告」同口径），不是 N/A
//   · 否定优先：「未关闭」不得因同行还有「关闭」二字而被计为关闭
//   · N/A 纪律与「度量不是闸门」与 QLT-1 同源；**不得与 QLT-1 相加**
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCRIPTS, run, mkProject } from './_fixtures.mjs'

const Q = join(SCRIPTS, 'quality-score.mjs')
const QLT6 = pathToFileURL(join(SCRIPTS, '_lib', 'qlt6.mjs')).href
const sha = (b) => createHash('sha256').update(b).digest('hex')

const DRAFT = '# 标题\n\n## 摘要\n\n正文 [L01] [D01]。\n\n## 一、论证\n\n'
  + '这一节承载论证叙述，交代机制与边界条件。'.repeat(8) + ' [L01] [D01]。\n\n'
  + '## 参考文献\n\n- [L01] 甲. 题名[J]. 刊, 2024.\n\n## 数据来源\n\n- [D01] 机构 2024\n\n'
  + '## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\n- AI。\n'

/** 批判报告：§关闭状态 自述清单 4 条 + 标题全集 10 条（strict 与 declared 故意不同，供核对透明性）。 */
const CRIT = [
  '# 批判报告-v2', '',
  '## 二、七维批判（C1-C7）', '',
  '### C1 · 核心论点可攻击性', '',
  '#### [P0-C1-1] 论点1 机制说明缺', '',
  '#### [P1-C1-2] 论点2 定义不足', '',
  '#### [P1-C1-3] 论点3 链式依赖未消（接受脆弱）', '',
  '#### [P0-C2-1] §4.3 术语非机制', '',
  '## 三、批判总结', '',
  '### 3.4 关闭状态', '',
  '- 本期：所有 P0/P1 项**未关闭**',
  '- **预期 v3 关闭清单**：',
  '  - **P0/C1-1** 关闭条件：补机制说明段',
  '  - **P1/C1-2** 关闭条件：补程序定义',
  '  - **P0/C2-1** 关闭条件：把术语改写成机制',
  '  - **P1/C1-3** 关闭条件：加一条替代解释的排除',
  '',
].join('\n')

/** 复核报告：`verdicts` = { idCanon: '关闭'|'未关闭'|省略 }；`fp` 决定头部声明的指纹。 */
const REVIEW = (fp, baselineFp, verdicts) => {
  const rows = Object.entries(verdicts).map(([id, v]) => {
    const slash = id.replace(/-(C\d+)-/, '/$1-')   // P0-C1-1 → P0/C1-1（实测两种写法并存）
    return [`### 2.1 ${slash} —— 条件摘要`, '| 项 | 值 |', '|---|---|', `| 判定 | **${v}** |`, ''].join('\n')
  })
  return [
    '# 复核报告-v1', '',
    `> **被审正文**：\`final/定稿.md\` ｜ **字节 / sha256**：1 B / \`${fp}\``,
    ...(baselineFp ? [`> **基线对照**：\`drafts/初稿-v1.md\` ｜ **字节 / sha256**：1 B / \`${baselineFp}\``] : []),
    '',
    '## 二、P0 关闭逐条表', '',
    ...rows,
  ].join('\n')
}

const mkQ6 = ({ review = true, verdicts = { 'P0-C1-1': '关闭', 'P1-C1-2': '关闭', 'P0-C2-1': '未关闭' }, fpMode = 'current', reviewOverrides = {}, critText, panelText } = {}) => {
  const { d, proj, fin, aud } = mkProject({ audits: true })
  mkdirSync(aud, { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  const draftPath = join(fin, '定稿.md')
  writeFileSync(draftPath, DRAFT)
  const cur = sha(readFileSync(draftPath))
  writeFileSync(join(proj, 'analysis', '批判报告-v2.md'), critText ?? CRIT)
  writeFileSync(join(aud, '审稿报告-v1.md'), panelText ?? [
    '# 审稿报告-v1', '', '> **评审版本**：v1（基于 drafts/初稿-v1.md）', '> **总评分**：22/30', '',
    '#### 1. 原创性（4/5）', '#### 2. 方法论（4/5）', '#### 3. 证据强度（3/5）',
    '#### 4. 论证结构（3/5）', '#### 5. 写作质量（4/5）', '#### 6. 引文规范（4/5）', '',
  ].join('\n'))
  if (review) {
    const fp = fpMode === 'current' ? cur : 'f'.repeat(24)
    const baseline = fpMode === 'baseline-only' ? cur : 'a'.repeat(24)
    const text = REVIEW(fpMode === 'baseline-only' ? 'b'.repeat(24) : fp, baseline, verdicts)
    writeFileSync(join(aud, '复核报告-v1.md'), Object.entries(reviewOverrides).length
      ? text.replace(reviewOverrides.from, reviewOverrides.to) : text)
  }
  return { d, proj, draftPath, cur }
}
const evalQ6 = async (f) => {
  const { evaluateQlt6 } = await import(QLT6)
  return evaluateQlt6({ projectDir: f.proj, draftPath: f.draftPath })
}
const comp = (r, id) => r.components.find((c) => c.id === id)

test('qlt6（口径 D）：双分量 50/50 合成，值可逐项复算', async () => {
  const f = mkQ6()
  try {
    const r = await evalQ6(f)
    assert.equal(r.metric, 'QLT-6')
    assert.equal(comp(r, 'panel').weight, 50)
    assert.equal(comp(r, 'closure').weight, 50)
    // ① = clamp((22 − 16) / 14) = 0.4286；② = 2/4 = 0.5 → (50×0.4286 + 50×0.5) / 100 × 100 = 46.4
    assert.equal(comp(r, 'panel').ratio, 0.4286, '① 归一化口径：clamp((总评分 − 16) / 14, 0, 1)')
    assert.equal(comp(r, 'closure').raw.total, 4, '② 条件集须取「§关闭状态 自述清单」（4 条）')
    assert.equal(comp(r, 'closure').raw.closed, 2, '② 关闭数须来自绑定复核的判定')
    assert.equal(r.score, 46.4, '双分量加权后应可复算')
    assert.equal(r.coverage, 1)
    assert.equal(comp(r, 'closure').evidence.strictP01Count, 4, '同报告 P0/P1 标题全集数须一并报出（非计分）')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('qlt6（F-? 标定根因）：**「基线对照」行里的本版 sha 不算绑定**（否则 v3 快照会借 v4 的裁定）', async () => {
  const f = mkQ6({ fpMode: 'baseline-only' })   // 只有「基线对照」行带当前 sha
  try {
    const r = await evalQ6(f)
    assert.equal(comp(r, 'closure').ratio, 0, '基线对照 ≠ 被审对象 → 不得绑定')
    assert.match(String(comp(r, 'closure').evidence.closureBasis), /no-bound-verdict/)
    assert.equal(r.score, 21.4, '② 保守计 0 → 总分只剩 ① 的一半权重')
    assert.ok(r.notes.some((n) => /保守计 0/.test(n)), '须在 notes 里点名「保守计 0、低估方向」')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('qlt6（反向控制组）：判定为「未关闭」不得计为关闭（否定优先）', async () => {
  const f = mkQ6({ verdicts: { 'P0-C1-1': '关闭（与 P0-C2-1 同源，未关闭全部要素）', 'P1-C1-2': '未关闭', 'P0-C2-1': '关闭' } })
  try {
    const r = await evalQ6(f)
    assert.equal(comp(r, 'closure').raw.closed, 1, '含「未关闭」的判定行不得计关闭；另两条按判定计')
    // 条件集 4 条（P0-C1-1 / P1-C1-2 / P0-C2-1 / P1-C1-3），本用例的判定只覆盖前三条 → 第 4 条留在 open ✓
    assert.deepEqual(comp(r, 'closure').evidence.open.sort(), ['P0-C1-1', 'P1-C1-2', 'P1-C1-3'].sort())
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('qlt6：条件集不可解析 → ② N/A（coverage 0.5，不给 0 分蒙混）', async () => {
  const f = mkQ6({ critText: '# 批判报告-v1\n\n## 二、七维批判\n\n纯散文，无 id 也没有关闭状态段。\n' })
  try {
    const r = await evalQ6(f)
    assert.equal(comp(r, 'closure').applicable, false)
    assert.match(String(comp(r, 'closure').naReason), /无可解析的条件 id/)
    assert.equal(r.coverage, 0.5)
    assert.equal(r.score, 42.9, '只算 ① 时按适用权重归一，不是给 0 分')
    assert.match(String(r.coverageWarning), /适用权重 50\/100/)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('qlt6：无整合审稿报告 → ① N/A；有分件（T9-x）也不得冒充整合报告', async () => {
  const f = mkQ6()
  try {
    rmSync(join(f.proj, 'audits', '审稿报告-v1.md'))
    writeFileSync(join(f.proj, 'audits', '审稿报告-T9-d-v3.md'), '# T9-d 视角\n\n> 总评分：30/30\n')
    const r = await evalQ6(f)
    assert.equal(comp(r, 'panel').applicable, false, '三视角分件不是整合报告（口径混用正是 F-AC 反例）')
    assert.equal(r.coverage, 0.5)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('qlt6（纪律）：度量不是闸门 + 不得与 QLT-1 相加 + 标定状态可见', async () => {
  const f = mkQ6()
  try {
    const r = await evalQ6(f)
    assert.match(String(r.validity.noSum), /不得与 QLT-1 相加/)
    assert.equal(r.validity.calibration.status, 'pass', '标定状态必须随产出落盘（未标定前不得用）')
    assert.match(String(r.validity.calibration.evidence), /\+50\.0/)
    assert.match(String(r.validity.boundary), /保守按未关闭计 0/)
    assert.match(String(r.meta.notes), /不影响退出码/)
    // 端到端：quality-score 同时给出两块量尺，且 QLT-6 不并进 QLT-1 的 score
    const rep = join(f.proj, 'final', 'qlt.json')
    const res = run([Q, f.proj, '--report', rep])
    assert.equal(res.code, 0, '度量门必须 exit 0：' + res.out.slice(-200))
    const j = JSON.parse(readFileSync(rep, 'utf8'))
    assert.equal(typeof j.score, 'number')
    assert.equal(j.qlt6.metric, 'QLT-6')
    assert.equal(j.qlt6.score, 46.4, 'QLT-6 必须是独立块，不与 QLT-1 的 score 混算')
    assert.match(String(j.componentSemantics.handoff), /不衡量论文质量/, 'F-S ②：handoff 语义须随产出落盘')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})
