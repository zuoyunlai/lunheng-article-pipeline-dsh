// 批次 4 回归：D4 字数双口径 wordChars + D7 kaiti 开题模式
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'

const CC = join(SCRIPTS, 'count-chars.mjs')
const SC = join(SCRIPTS, 'structure-check.mjs')
const M = join(SCRIPTS, 'm-gate-check.mjs')

test('D4：--word-metric 输出 wordChars（汉字+标点+英文串+数字串），hanChars 不变', () => {
  const d = tmp('lunheng-d4-')
  const f = join(d, 'p.md')
  // 100 汉字 + 11 全角标点 + "AI"×5 + "2026"×2 → wordChars = 100+11+5+2 = 118
  const han = '汉'.repeat(100)
  const punct = '，。；：、（）【】《》'   // 11 个全角标点
  const latin = ' AI AI AI AI AI '
  const digits = ' 2026 2026 '
  writeFileSync(f, '# 题\n\n## 摘要\n\n' + han + punct + latin + digits + '\n', 'utf8')
  const r = run([CC, f, '--word-metric'])
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
  assert.equal(j.hanChars, 100, '纯汉字口径仍 100')
  assert.equal(j.wordChars, 118, 'wordChars = 汉字+标点+英文串+数字串 = 118，实测 ' + j.wordChars)
  rmSync(d, { recursive: true, force: true })
})

test('D4：不带 --word-metric 时无 wordChars 字段（向后兼容）', () => {
  const d = tmp('lunheng-d4b-')
  const f = join(d, 'p.md')
  writeFileSync(f, '# 题\n\n## 摘要\n\n正文。\n', 'utf8')
  const r = run([CC, f])
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
  assert.equal(j.wordChars, undefined, '默认无 wordChars')
  rmSync(d, { recursive: true, force: true })
})

test('D7：structure-check --kaiti 开题九节（齐备→PASS，缺≥3→P0）', () => {
  const d = tmp('lunheng-d7-')
  const full = join(d, 'full.md')
  const secs = ['研究背景', '研究目的', '研究意义', '文献综述', '研究内容', '研究方法', '研究框架', '预期成果', '参考文献']
    .map((s) => '## ' + s + '\n\n内容。\n').join('\n')
  writeFileSync(full, '# 开题\n\n' + secs, 'utf8')
  const r1 = run([SC, full, '--kaiti'])
  const j1 = JSON.parse(r1.stdout.slice(r1.stdout.indexOf('{')))
  assert.equal(j1.severity, 'PASS', '九节齐备应 PASS：' + j1.detail)
  const missing = join(d, 'missing.md')
  writeFileSync(missing, '# 开题\n\n## 研究背景\n\n内容。\n', 'utf8')
  const r2 = run([SC, missing, '--kaiti'])
  assert.equal(r2.code, 2, '缺 ≥3 节 → exit 2')
  rmSync(d, { recursive: true, force: true })
})

test('D7：m-gate-check --genre kaiti 被 GENRE_MIN_L 接受，M-Exist-12 实检贡献陈述', () => {
  const d = tmp('lunheng-d7b-')
  const { proj, fin, ev } = (() => {
    const p = join(d, 'run', 'proj'); mkdirSync(join(p, 'final'), { recursive: true }); mkdirSync(join(p, 'final', '证据包'), { recursive: true })
    return { proj: p, fin: join(p, 'final'), ev: join(p, 'final', '证据包') }
  })()
  writeFileSync(join(fin, '定稿.md'),
    '# 开题\n\n## 摘要\n\n摘要 [L01]。\n\n## 研究背景\n\n本文的贡献如下：\n\n- 提出 X [L01]，见第二节；\n- 验证 Y [L01]。\n\n## 参考文献\n\n[L01] a\n', 'utf8')
  const rep = join(proj, 'r.json')
  run([M, join(fin, '定稿.md'), ev, '--genre', 'kaiti', '--report', rep])
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  const m12 = (j.results || []).find((r) => /M-Exist-12/.test(r.gate || ''))
  assert.ok(m12, 'kaiti 下 M-Exist-12 必须在场')
  assert.equal(m12.pass, true, 'kaiti 贡献陈述应实检并通过：' + m12.detail)
  rmSync(d, { recursive: true, force: true })
})
