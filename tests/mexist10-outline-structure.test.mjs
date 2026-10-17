// M-Exist-10 扩展（v19.11.2 · 反哺 §13.4）：把「大纲逐节承重 top1 + 预算」接成**可见读数**。
// 背景：04 卡 :56/:65 早已要求这两样，但 39 个真实项目里只有 3 份 / 2 份遵守（≈8%/5%）——
//   规范没有消费者。本扩展把「几节写了」写进 detail（notes），**不改 pass/exit**：
//   因为它会在绝大多数存量项目上命中，做成软提示就会重演 M-Form-11 的「90% 常年红 = 信号淹掉」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, tmp, ROOT } from './_fixtures.mjs'

const MGATE = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', 'm-gate-check.mjs')

const DRAFT = '# 标题\n\n## 摘要\n\n正文 [L01][D01]。\n\n## 一、正文\n\n' + '汉'.repeat(200)
  + '\n\n## 参考文献\n\n[1] x\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'

/** §11 六要素齐备的最小大纲；sections 控制「逐节结构」是否合规。 */
const mkOutline = ({ sections }) => `# 分析大纲

${sections}

## §11 写手版精简段（T5 只读本节）

**论证主线**：本文论证 X 成立。

**论点-论据映射表**：

| 论点 | 论据 |
|---|---|
| 论点1 | [L01] |

**反方规划要点**：有人质疑样本。

**字数预算**：8000 字。

**禁做项**：不写营销腔。

**承重墙清单**：论点1 → [L01]。

补充说明行一。
补充说明行二。
补充说明行三。
`

const GOOD = `## 1 引言（预算 ≥800 字）

- 承重证据 top1：[L01]

## 2 正文（预算 ≥1200 字）

- 承重证据 top1：[D01]
`
const BAD = `## 1 引言（预算 ≥800 字）

- 承重证据 top1：[L01]

## 2 正文

本节没有承重标记，也没有预算标注。
`

function mkProj(outline) {
  const d = tmp('lunheng-mexist10-')
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), DRAFT, 'utf8')
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), outline, 'utf8')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 索引\n\n[D01] 某数据（2021）\n', 'utf8')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 索引\n\n[L01] 某文（2020）\n', 'utf8')
  return { d, draftPath: join(fin, '定稿.md'), ev }
}

const m10 = (rep, d) => {
  const j = JSON.parse(readFileSync(join(d, 'rep.json'), 'utf8'))
  return j.results.find((r) => /M-Exist-10/.test(r.gate || ''))
}

test('M-Exist-10 扩展：逐节合规 → 不出「大纲逐节结构」备注', () => {
  const f = mkProj(mkOutline({ sections: GOOD }))
  try {
    run([MGATE, f.draftPath, f.ev, '--report', join(f.d, 'rep.json')])
    const r = m10(null, f.d)
    assert.ok(!(r.notes || []).some((n) => /大纲逐节结构/.test(n)),
      '全部合规时不得凭空报逐节问题：' + JSON.stringify(r.notes))
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('M-Exist-10 扩展：有节缺承重/预算 → 备注报出读数，且不改 pass/exit', () => {
  const f = mkProj(mkOutline({ sections: BAD }))
  try {
    run([MGATE, f.draftPath, f.ev, '--report', join(f.d, 'rep.json')])
    const r = m10(null, f.d)
    const note = (r.notes || []).find((n) => /大纲逐节结构/.test(n))
    assert.ok(note, '缺项时必须报出：' + JSON.stringify(r.notes))
    assert.match(note, /2 个编号节/, '须报编号节总数：' + note)
    assert.match(note, /1 节无「承重证据 top1」/, '须报缺承重节数：' + note)
    assert.match(note, /1 节无「（预算 ≥N 字）」/, '须报缺预算节数：' + note)
    assert.equal(r.severity, '通过', '备注不得改变本门严重度（否则重演「90% 常年红」）')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})
