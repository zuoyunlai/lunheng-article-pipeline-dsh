// 注解密度门的**阈值钉**（v18.88.0-prep · 结构性债 P3-r10「注解密度阈值无门」落地）
//
// **为什么需要**：`scripts/_lib/hygiene/r10-ann-density.mjs` 自称「本规则**禁止抬升**」，但那是**散文**。
//   实测该文件的两个旋钮——`ANN_MAX_RATIO`（全库注解行占比阈值）与 `ANN_TABLE_BASELINE`（逐文件
//   「表格行含版本号」的计数基线）——**此前没有任何门看它们**：把 0.12 改成 0.30、或把某文件基线抬高，
//   全库不会有任何门变红（所有文件都会「通过」，因为门本身变松了）。
//   ⇒ 本钉把「只许降」变成机械判据：**要抬必须同批改本文件**（于是在 review / `git diff` 里可见）。
//
// **判据（单向下调，与 r09/r10 的棘轮语义一致）**：
//   ① `0 < ANN_MAX_RATIO ≤ 0.12`——**降**不拦（瘦身的成果本来就该锁得更紧），**抬**即红；
//   ② 逐文件基线：**键集合必须与记录值完全一致**（新增文件要进基线面，须显式登记），
//      且每个值 **≤ 记录值**（只许降不许升）。
//
// **边界（如实）**：本钉只保证「旋钮不被静默拧松」。它**不**保证「该文件真的按该阈值在跑」——
//   那由 `repo-hygiene-check` 的 ⑩ 两项 note/fail 自证（含「立门时实测值」注释）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ANN_MAX_RATIO, ANN_TABLE_BASELINE } from '../scripts/_lib/hygiene/r10-ann-density.mjs'

/** 记录值（= 立门/历次合法下调后的快照）。**抬升旋钮时必须同批改这里**，否则本钉会红。 */
const PINNED_MAX_RATIO = 0.12
const PINNED_BASELINE = Object.freeze({
  'skills/lunheng-article-pipeline/references/_shared/M-Gate-Algorithm-appendix.md': 26,
  'skills/lunheng-article-pipeline/references/_shared/规范-机械门对照表.md': 68,
  'skills/lunheng-article-pipeline/references/templates/status-template.md': 15,
  'skills/lunheng-article-pipeline/references/_shared/机检硬格式.md': 17,
  'skills/lunheng-article-pipeline/references/case-studies.md': 9,
  'skills/lunheng-article-pipeline/references/glossary.md': 6,
  'skills/lunheng-article-pipeline/references/deliverables.md': 12,
  'skills/lunheng-article-pipeline/references/_shared/failure-modes.md': 4,
})

test('P3-r10 钉①：注解密度阈值只许降不许抬（抬升须同批改本钉）', () => {
  assert.equal(typeof ANN_MAX_RATIO, 'number', '常量未正确导出——本钉会退化为空断言')
  assert.ok(ANN_MAX_RATIO > 0, `阈值必须为正（实测 ${ANN_MAX_RATIO}）`)
  assert.ok(ANN_MAX_RATIO <= PINNED_MAX_RATIO,
    `ANN_MAX_RATIO 被抬高到 ${ANN_MAX_RATIO}（记录值 ${PINNED_MAX_RATIO}）——`
    + '抬高等于把「防再膨胀」这道门拧松，而全库不会有任何门变红。'
    + '确需抬高请同批改 PINNED_MAX_RATIO 并在 CHANGELOG 写明理由；否则请改回')
})

test('P3-r10 钉②：表格行沿革基线键集合 == 记录快照（新增文件须显式登记）', () => {
  const got = Object.keys(ANN_TABLE_BASELINE).sort()
  const pinned = Object.keys(PINNED_BASELINE).sort()
  assert.deepEqual(got, pinned,
    `基线的**文件面**变了：多出 ${got.filter((k) => !pinned.includes(k)).join(', ') || '（无）'}；`
    + `少了 ${pinned.filter((k) => !got.includes(k)).join(', ') || '（无）'}——`
    + '新增/移除纳入棘轮的文件都要同批改本钉（否则「谁在被管」本身可被静默改动）')
})

test('P3-r10 钉③：逐文件基线只许降不许升', () => {
  for (const [rel, pinned] of Object.entries(PINNED_BASELINE)) {
    const now = ANN_TABLE_BASELINE[rel]
    assert.equal(typeof now, 'number', `${rel} 的基线不是数字（实测 ${now}）`)
    assert.ok(now <= pinned,
      `${rel} 的表格行沿革基线被抬高：${pinned} → ${now}——`
      + '该棘轮的语义是「沿革只增」，基线抬高即等于取消这道门（v18.80.1 §C3 立此门的直接理由）')
  }
})
