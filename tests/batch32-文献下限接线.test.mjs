// 批次 32（2026-10-20 · 文献下限接线批 · `audits/落地建议-2026-10-20` 批 2 / 审计 B3，主人授权）
//
// 为什么需要：`m-gate-check --genre` 自 v18.72.0 就有、`GENRE_MIN_L` 也登记了各文类下限，但
//   **T7/T8 两条实际命令行都没传这个旗标**（`pipeline-readme.md:975` / `07-审计-auditor.md:51` /
//   `08-终检-finalizer.md` 三处，接线前实测均无 `--genre`）⇒ M-Form-1 恒回落缺省 3，
//   `academic-hum/lit-review` 新抬的 15 与 `kaiti` 的 10 **都不会生效**——「收紧」是假的。
// 本文件锁三件事（缺一即红）：
//   ① 值面：GENRE_MIN_L 的 hum/lit-review = 15（批 0c 基准 17–23 之下留余量 2）；
//   ② 三方可核：脚本 `GENRE_MIN_L` ↔ `文类档案.md`「文献下限」列 ↔ `lib/client.js` `minLit` 逐文类一致；
//   ③ 接线证据：三处派发命令**必须写 `--genre`**，且 CLI 真按文类取档（16 条过 / 14 条 P0）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, SCRIPTS, run, tmp } from './_fixtures.mjs'
import { GENRE_MIN_L } from '../skills/lunheng-article-pipeline/scripts/_lib/mgate-gates/mform-gates.mjs'

const SK = join(ROOT, 'skills', 'lunheng-article-pipeline')
const GENRES_MD = join(SK, 'references', '_shared', '文类档案.md')
const M = join(SCRIPTS, 'm-gate-check.mjs')

/** 解析文类档案表：code → 文献下限（第 15 列，index 14）。 */
function archiveMinLit() {
  const md = readFileSync(GENRES_MD, 'utf8')
  const out = {}
  for (const line of md.split('\n')) {
    const m = /^\|\s*`([a-z0-9-]+)`\s*\|/.exec(line)
    if (!m) continue
    const cells = line.split('|').map((c) => c.trim())
    out[m[1]] = Number(cells[14])   // 首尾空串 ⇒ 第 14 列 = cells[14]（与 panel.test 的派生口径同源）
  }
  return out
}

test('① 值面：academic-hum / lit-review 文献下限 = 15（批 0c 基准 17–23 之下留余量 2）', () => {
  assert.equal(GENRE_MIN_L['academic-hum'], 15)
  assert.equal(GENRE_MIN_L['lit-review'], 15)
  // 不动的档位（防顺手扩大收紧范围）
  assert.equal(GENRE_MIN_L['academic-cn'], 3)
  assert.equal(GENRE_MIN_L['academic-case'], 3)
  assert.equal(GENRE_MIN_L['course'], 3)
  assert.equal(GENRE_MIN_L['book-review'], 2)
  assert.equal(GENRE_MIN_L['kaiti'], 10)
})

test('② 三方可核：脚本 GENRE_MIN_L ↔ 文类档案「文献下限」列 ↔ 开工台 client.js minLit', () => {
  const arch = archiveMinLit()
  assert.deepEqual(Object.keys(arch).sort(), Object.keys(GENRE_MIN_L).sort(),
    '文类档案与 GENRE_MIN_L 的 code 集合不一致——两处必须同批改')
  for (const [code, v] of Object.entries(GENRE_MIN_L)) {
    assert.equal(arch[code], v, `文类档案「${code}」文献下限 = ${arch[code]}，脚本 = ${v}（两处必须一致）`)
  }
  const client = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  for (const [code, v] of Object.entries(GENRE_MIN_L)) {
    const re = new RegExp(`code: '${code}',[^\\n]*minLit: (\\d+)`)
    const m = re.exec(client)
    assert.ok(m, `client.js 缺 ${code} 的 minLit——开工台副本未同步`)
    assert.equal(Number(m[1]), v, `client.js ${code}.minLit = ${m[1]}，脚本 = ${v}`)
  }
})

test('③ 接线证据：T7/T8 三处派发命令必须带 --genre（接线前实测均无）', () => {
  const files = {
    'pipeline-readme.md': readFileSync(join(SK, 'references', 'pipeline-readme.md'), 'utf8'),
    '07-审计-auditor.md': readFileSync(join(SK, 'references', 'agents', '07-审计-auditor.md'), 'utf8'),
    '08-终检-finalizer.md': readFileSync(join(SK, 'references', 'agents', '08-终检-finalizer.md'), 'utf8'),
  }
  for (const [name, text] of Object.entries(files)) {
    assert.match(text, /m-gate-check[^\n]*--genre/, `${name} 的 m-gate-check 命令缺 --genre（文献下限不生效）`)
  }
  // final-check 必须支持透传（T8 常用入口）
  assert.match(files['08-终检-finalizer.md'], /final-check[^\n]*--genre|--genre <code>（v19.23.0）/, 'final-check 的 --genre 透传未登记')
})

test('④ CLI 行为：--genre academic-hum 下 15 条过、14 条 P0（阈值真按文类取档）', () => {
  const mk = (n) => {
    const d = tmp('lunheng-b32-')
    const p = join(d, 'run', 'proj')
    mkdirSync(join(p, 'final', '证据包'), { recursive: true })
    const refs = Array.from({ length: n }, (_, i) => `[L${String(i + 1).padStart(2, '0')}]`).join(' ')
    const entries = Array.from({ length: n }, (_, i) => `[L${String(i + 1).padStart(2, '0')}] 文献${i + 1}`).join('\n')
    writeFileSync(join(p, 'final', '定稿.md'),
      `# 题\n\n## 摘要\n\n摘要 ${refs}。\n\n## 讨论\n\n本文发现 X，与既有研究相比一致，机制在于 Y，局限是样本，未来进一步。\n\n## 参考文献\n\n${entries}\n`, 'utf8')
    const rep = join(p, 'r.json')
    run([M, join(p, 'final', '定稿.md'), join(p, 'final', '证据包'), '--genre', 'academic-hum', '--report', rep])
    const j = JSON.parse(readFileSync(rep, 'utf8'))
    const g = (j.results || []).find((r) => /M-Form-1/.test(r.gate || ''))
    rmSync(d, { recursive: true, force: true })
    return g
  }
  const ok = mk(15)
  assert.ok(ok, 'M-Form-1 必须在场')
  assert.equal(ok.pass, true, 'hum 档 15 条应通过：' + ok.detail)
  const bad = mk(14)
  assert.equal(bad.pass, false, 'hum 档 14 条应判不通过（不低于 min_L）：' + bad.detail)
  assert.match(String(bad.detail), /15/, '判据文案须带文类阈值 15：' + bad.detail)
})
