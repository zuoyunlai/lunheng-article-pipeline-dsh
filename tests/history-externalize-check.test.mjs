// `history-externalize-check`（沿革外移机械验收器）的回归网（v18.80.4 · 优化方向 6 专批）
//
// **为什么必须测这个脚本自己**：它是「沿革外移」这一动作的**验收门**——若它假绿，后续每一次搬运
//   都可以悄悄删掉判据而无人察觉（本仓吃过同类：瘦身删规格句，而字符串级门抓不到语义级事实）。
//   三条用例分别钉它的三条语义：
//     ① 正常搬运（把沿革行搬进外移档）→ **exit 0**，且给出 R3 复核清单；
//     ② 判据行被删（新文件与外移档都没有）→ **exit 1**（R1 判据不丢），并**点名**那一行；
//     ③ 标题被搬走 → **exit 1**（R2 标题不动）——规则 ㉗ 的锚点由标题派生，标题一搬就断链。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, run, tmp } from './_fixtures.mjs'

const CHECK = join(ROOT, 'scripts', 'history-externalize-check.mjs')

const HEAD = '# 规格标题\n\n'
const JUDGE = '判据：本门**必须**在文末核验编号闭环。\n'
const HIST = '> **v2.2.0 沿革**：旧版只核存在性，实测漏了 11 处孤儿。\n'

/** 造一组「原文件 / 新文件 / 外移档」三件套 */
const mkCase = ({ afterExtra = '', movedExtra = '', dropJudge = false, moveHeading = false } = {}) => {
  const d = tmp('lunheng-histext-')
  const before = join(d, 'before.md'); const after = join(d, 'after.md'); const moved = join(d, 'moved.md')
  writeFileSync(before, HEAD + JUDGE + HIST)
  const afterBody = (moveHeading ? '' : HEAD)
    + (dropJudge ? '' : JUDGE)
    + '> 沿革已外移：见 `audits/沿革外移-X.md` §1。\n' + afterExtra
  writeFileSync(after, afterBody)
  writeFileSync(moved, (moveHeading ? HEAD : '') + HIST + movedExtra)
  return { d, before, after, moved }
}

test('验收器 ①：正常搬运 → exit 0（且输出 R3 复核清单）', () => {
  const c = mkCase()
  try {
    const r = run([CHECK, '--before', c.before, '--after', c.after, '--moved', c.moved])
    assert.equal(r.code, 0, '正常搬运必须判通过：' + r.out + r.err)
    assert.match(r.out, /R1 判据不丢 \+ R2 标题不动 通过/)
    assert.match(r.out, /R3 人工复核清单/, '必须给出「不像沿革」的人工复核清单（启发式口径的可见性）')
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

test('验收器 ②：判据行被删（两处都没有）→ exit 1 且点名该行（R1 判据不丢）', () => {
  const c = mkCase({ dropJudge: true })
  try {
    const r = run([CHECK, '--before', c.before, '--after', c.after, '--moved', c.moved])
    assert.equal(r.code, 1, '判据丢失必须判失败：' + r.out)
    assert.match(r.out, /R1 失败/, '须点名 R1')
    assert.match(r.out, /在文末核验编号闭环/, '须把丢失的那一行打出来（否则无从修）')
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

test('验收器 ③：标题被搬走 → exit 1（R2 标题不动，锚点会断链）', () => {
  const c = mkCase({ moveHeading: true })
  try {
    const r = run([CHECK, '--before', c.before, '--after', c.after, '--moved', c.moved])
    assert.equal(r.code, 1, '标题被搬必须判失败：' + r.out)
    assert.match(r.out, /R2 失败/, '须点名 R2（标题/锚点）')
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

test('验收器 ④：未给 --moved 时，被搬走的行按「丢失」处理（防漏传参数造成假绿）', () => {
  const c = mkCase()
  try {
    const r = run([CHECK, '--before', c.before, '--after', c.after])
    assert.equal(r.code, 1, '不传外移档时，搬走的行无从核对 → 必须判失败而不是默认通过')
    assert.match(r.out, /R1 失败/)
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})
