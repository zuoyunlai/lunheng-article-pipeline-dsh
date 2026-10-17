// 批次 3 回归：D2 G16 反方段骨架预扫 + D5 双义词上下文判定
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'

const G = join(SCRIPTS, 'g-audit-check.mjs')
const CYCLE = join(SCRIPTS, 'apply-compression-cycle.mjs')

const mkDraft = (body) => '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、正文\n\n' + body + '\n'

test('D2 G16：≥3 段让步-转折同构骨架 → P2 软提示（不阻断）', () => {
  const d = tmp('lunheng-g16-')
  const f = join(d, '正文.md')
  writeFileSync(f, mkDraft(
    '尽管存在争议，但本文仍认为其成立。\n\n尽管样本有限，但结论稳健。\n\n尽管成本较高，但收益显著。\n\n'
  ))
  const r = run([G, f, '--json'])
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
  const g16 = j.checks['G16-反方段骨架']
  assert.equal(g16.severity, 'P2', '≥3 段应提示模板化：' + g16.detail)
  assert.equal(j.overall.exitCode, 3, '仅 P2 → exit 3')
  rmSync(d, { recursive: true, force: true })
})

test('D2 G16：<3 段同构骨架 → PASS', () => {
  const d = tmp('lunheng-g16b-')
  const f = join(d, '正文.md')
  writeFileSync(f, mkDraft('尽管存在争议，但本文仍认为其成立。\n\n另一段正常论述，无让步词。\n\n'))
  const r = run([G, f, '--json'])
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
  assert.equal(j.checks['G16-反方段骨架'].severity, 'PASS')
  rmSync(d, { recursive: true, force: true })
})

// v19.11.2（反哺「把自述搬进产物」第二条）：反方节**必须有证据锚点**——纯立场对撞不可核。
test('D2 G16：反方节无任何证据锚点 → P2（锚点判据）；带锚点 → 放行', () => {
  const d = tmp('lunheng-g16c-')
  try {
    const bad = join(d, 'bad.md')
    writeFileSync(bad, mkDraft('## 二、反方观点\n\n也有人认为该结论不成立，但本文认为其依然稳健。\n'))
    const rb = run([G, bad, '--json'])
    const jb = JSON.parse(rb.stdout.slice(rb.stdout.indexOf('{')))
    const gb = jb.checks['G16-反方段骨架']
    assert.equal(gb.severity, 'P2', '无锚点的反方节须提示：' + gb.detail)
    assert.match(gb.detail, /锚点/, 'detail 须点名「锚点」：' + gb.detail)
    assert.equal(gb.evidence.anchorlessOpposition, 1, 'evidence 须报出无数量的反方节数')

    const good = join(d, 'good.md')
    writeFileSync(good, mkDraft('## 二、反方观点\n\n也有研究认为该结论不成立（[L01]，2019），但本文以 [D01] 的样本量差异作出回应。\n'))
    const rg = run([G, good, '--json'])
    const jg = JSON.parse(rg.stdout.slice(rg.stdout.indexOf('{')))
    assert.equal(jg.checks['G16-反方段骨架'].severity, 'PASS', '带锚点应放行：' + jg.checks['G16-反方段骨架'].detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('D5：SOFT 双义词「流水线」在含文内引用的正文段 → 记 flowSoftNotes 不判泄漏', () => {
  const d = tmp('lunheng-d5-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'),
    '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、正文\n\n本文采用两阶段流水线的架构 [L01]。\n\n## 参考文献\n\n[L01] a\n', 'utf8')
  const r = run([CYCLE, proj, '--dry-run'])
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
  assert.ok(Array.isArray(j.flowSoftNotes), '应有 flowSoftNotes 字段')
  assert.ok(j.flowSoftNotes.some((s) => /流水线.*正文合法使用/.test(s)), '「流水线」应记合法使用：' + JSON.stringify(j.flowSoftNotes))
  const leakHit = (j.flowHits || []).find((h) => h.word === '流水线')
  assert.ok(!leakHit || leakHit.count === 0, '正文合法使用的「流水线」不得判泄漏')
  rmSync(d, { recursive: true, force: true })
})

test('D5：HARD 词「承重」仍命中即泄漏（不因上下文判定放行）', () => {
  const d = tmp('lunheng-d5b-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'),
    '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、正文\n\n本句出现内部黑话承重证据。\n', 'utf8')
  const r = run([CYCLE, proj, '--dry-run'])
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
  const h = (j.flowHits || []).find((x) => x.word === '承重')
  assert.ok(h && h.count > 0, 'HARD 词「承重」命中即泄漏：' + JSON.stringify(j.flowHits))
  rmSync(d, { recursive: true, force: true })
})
