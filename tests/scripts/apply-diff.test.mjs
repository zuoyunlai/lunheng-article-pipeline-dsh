// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 apply-diff 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/apply-diff.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('v18.2.9 方案：apply-diff causal 守恒——强档替换中档且无新增引用 → causal_upgrades', () => {
  const { d, proj, fin, ev } = mkProject()
  // 目标正文（含一处中档因果句）
  const target = join(fin, '定稿.md')
  writeFileSync(target, '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、导论\n\n' + '段落内容。'.repeat(20) + '\n\n研究发现该变量与结果相关。\n\n## 参考文献\n\n[L01] a\n')
  // 段级 diff 清单：把「相关」升级为「导致」，且不新增引用
  const list = join(fin, '清单.md')
  writeFileSync(list, '# 清单\n\n[P0-1]\n- 现况：研究发现该变量与结果相关。\n- 修改：研究发现该变量导致该结果。\n')
  const r = run([join(SCRIPTS, 'apply-diff.mjs'), target, list, '--out', join(fin, '初稿-v2.md')])
  assert.equal(r.code, 0, 'apply-diff 应成功应用：' + r.out)
  const j = parseJson(r)
  assert.equal(j.causal_upgrades.length, 1, '中档→强档且无新增引用应记 1 条 causal_upgrades：' + JSON.stringify(j.causal_upgrades))
  assert.equal(j.causal_upgrades[0].from, 'suggestive')
  assert.equal(j.causal_upgrades[0].to, 'strong')
  rmSync(d, { recursive: true, force: true })
})


test('v18.2.9 方案：apply-diff causal 守恒——升级但新增引用 → 不报', () => {
  const { d, proj, fin, ev } = mkProject()
  const target = join(fin, '定稿.md')
  writeFileSync(target, '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、导论\n\n' + '段落内容。'.repeat(20) + '\n\n研究发现该变量与结果相关。\n\n## 参考文献\n\n[L01] a\n')
  const list = join(fin, '清单.md')
  // 升级因果的同时新增 [D05] 引用（有证据支撑 → 不算无证据升级）
  writeFileSync(list, '# 清单\n\n[P0-1]\n- 现况：研究发现该变量与结果相关。\n- 修改：研究发现该变量导致该结果 [D05]。\n')
  const r = run([join(SCRIPTS, 'apply-diff.mjs'), target, list, '--out', join(fin, '初稿-v2.md')])
  assert.equal(r.code, 0)
  const j = parseJson(r)
  assert.equal(j.causal_upgrades.length, 0, '升级但新增引用应不记 causal_upgrades')
  rmSync(d, { recursive: true, force: true })
})

test('v18.3.0 阶段 2：apply-diff 数值守恒——改稿改数字 → numeric_drift；数字不变 → 不报', () => {
  const { d, proj, fin, ev } = mkProject()
  const target = join(fin, '定稿.md')
  writeFileSync(target, '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、导论\n\n' + '段落内容。'.repeat(20) + '\n\n据统计该比例为 58%。\n\n## 参考文献\n\n[L01] a\n')
  // ① 改措辞但改了数字（58% → 60%）→ numeric_drift
  const list1 = join(fin, '清单1.md')
  writeFileSync(list1, '# 清单\n\n[P0-1]\n- 现况：据统计该比例为 58%。\n- 修改：据测算该比例为 60%。\n')
  const r1 = run([join(SCRIPTS, 'apply-diff.mjs'), target, list1, '--out', join(fin, 'v2.md')])
  assert.equal(r1.code, 0)
  const j1 = parseJson(r1)
  assert.equal(j1.numeric_drift.length, 1, '58→60 应记 numeric_drift：' + JSON.stringify(j1.numeric_drift))
  // ② 只改措辞、数字不变（58% 保留）→ 不报
  const list2 = join(fin, '清单2.md')
  writeFileSync(list2, '# 清单\n\n[P0-1]\n- 现况：据统计该比例为 58%。\n- 修改：据测算该比例仍为 58%。\n')
  const r2 = run([join(SCRIPTS, 'apply-diff.mjs'), target, list2, '--out', join(fin, 'v3.md')])
  assert.equal(r2.code, 0)
  const j2 = parseJson(r2)
  assert.equal(j2.numeric_drift.length, 0, '数字不变不应记 numeric_drift')
  rmSync(d, { recursive: true, force: true })
})

// v18.7.2 P0-1 回归：公共前缀 > CTX 时 tail 切片索引错——旧实现把 oldPart 尾部+前缀字符重复注入修订稿且报 ok:true。
// 参数化 prefixLen ∈ {12, 20, 36, 68}，分别落进 CTX=8/16/32/64 的「前缀超过 CTX」区间。
for (const prefixLen of [12, 20, 36, 68]) {
  test(`v18.7.2 P0-1：apply-diff 公共前缀(${prefixLen})>CTX——替换结果必须逐字节等于期望，不得重复注入旧文（致命缺陷回归）`, () => {
    const { d, proj, fin, ev } = mkProject()
    const target = join(fin, '定稿.md')
    const before = '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、导论\n\n段落甲。'
    const after = '段落甲。'
    const oldSent = '前'.repeat(prefixLen) + '旧内容旧内容。'
    const newSent = '前'.repeat(prefixLen) + '新内容新内容。'
    const tailPara = '\n\n段落后文。\n\n## 参考文献\n\n[L01] a\n'
    writeFileSync(target, before + oldSent + tailPara)
    const list = join(fin, '清单.md')
    writeFileSync(list, '# 清单\n\n[P0-1]\n- 现况：' + oldSent + '\n- 修改：' + newSent + '\n')
    const r = run([join(SCRIPTS, 'apply-diff.mjs'), target, list, '--out', join(fin, '初稿-v2.md')])
    assert.equal(r.code, 0, 'apply-diff 应成功应用：' + r.out)
    const j = parseJson(r)
    assert.ok(j.applied >= 1, '至少应用 1 条：' + r.out)
    const out = readFileSync(join(fin, '初稿-v2.md'), 'utf8')
    const expected = before + newSent + tailPara
    assert.equal(out, expected, `prefixLen=${prefixLen}：输出必须逐字节等于期望文本（旧缺陷会重复注入前缀/旧文片段）\n--- 实际 ---\n${out}\n--- 期望 ---\n${expected}`)
    // 纯插入场景回归（v18.2.5 修复形态，防修一漏一）：oldPart 退化为空格时仍须正确定位
    const target2 = join(fin, '定稿2.md')
    writeFileSync(target2, '# 标题\n\n## 摘要\n\n唯一锚点句 [L01] 结尾。\n\n## 参考文献\n\n[L01] a\n')
    const list2 = join(fin, '清单2.md')
    writeFileSync(list2, '# 清单\n\n[P0-2]\n- 现况：唯一锚点句 [L01] 结尾。\n- 修改：唯一锚点句 [L01]（辅助证据） 结尾。\n')
    const r2 = run([join(SCRIPTS, 'apply-diff.mjs'), target2, list2, '--out', join(fin, 'v2-2.md')])
    assert.equal(r2.code, 0, '纯插入场景应成功：' + r2.out)
    const out2 = readFileSync(join(fin, 'v2-2.md'), 'utf8')
    assert.ok(out2.includes('[L01]（辅助证据）'), '纯插入结果须含插入文本：' + out2)
    assert.ok(!out2.includes('（辅助证据））'), '纯插入结果不得重复右括号：' + out2)
    rmSync(d, { recursive: true, force: true })
  })
}
