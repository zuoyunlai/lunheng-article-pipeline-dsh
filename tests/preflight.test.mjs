// preflight 派发前聚合器回归测试（v18.95.0 反哺 E2 新增）
// 锁三条口径：① 正常项目产四块（draft/gateContract/charCount/figures）② 缺证据包如实标 unavailable ③ 参数错 exit 10
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, mkProject, DRAFT_WITH_ENDNOTES, CARD } from './_fixtures.mjs'

const P = join(SCRIPTS, 'preflight.mjs')

test('preflight：正常项目 → 产出 draft/gateContract/charCount/figures 四块', () => {
  const { d, proj, fin, ev } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), DRAFT_WITH_ENDNOTES('[图1：趋势]\n'))
  writeFileSync(join(ev, '文献卡.md'), CARD('文献卡', ['L01', 'L02', 'L03']))
  writeFileSync(join(ev, '数据卡.md'), CARD('数据卡', ['D01']))
  writeFileSync(join(ev, '案例卡.md'), CARD('案例卡', ['C01']))
  const j = parseJson(run([P, proj]))
  assert.ok(j.draft && /^[0-9a-f]{8}$/.test(j.draft.sha256_8), '须有正文 sha256 前 8 位：' + JSON.stringify(j.draft))
  assert.ok(j.gateContract && typeof j.gateContract.total === 'number', '证据包在盘时须有机检契约：' + JSON.stringify(j.gateContract))
  assert.ok(j.charCount && typeof j.charCount.hanChars === 'number', '须有字数（count-chars）：' + JSON.stringify(j.charCount))
  assert.equal(j.figures.length, 1, '须解析出图位清单：' + JSON.stringify(j.figures))
  assert.equal(j.figures[0].id, 1)
  rmSync(d, { recursive: true, force: true })
})

test('preflight：缺证据包 → gateContract.unavailable + bundle.manifest=false', () => {
  const { d, proj, fin, ev } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), DRAFT_WITH_ENDNOTES())
  rmSync(ev, { recursive: true, force: true })  // mkProject 总建 ev 目录，须显式删以触发「证据包不存在」分支
  const j = parseJson(run([P, proj]))
  assert.ok(j.gateContract && j.gateContract.unavailable, '缺证据包须标 unavailable（不是 N/A 也不是失败）：' + JSON.stringify(j.gateContract))
  assert.equal(j.bundle.manifest, false, '无 manifest.json：' + JSON.stringify(j.bundle))
  rmSync(d, { recursive: true, force: true })
})

test('preflight：--source 指定正文优先于 final/定稿.md', () => {
  const { d, proj, fin } = mkProject({ drafts: true })
  writeFileSync(join(fin, '定稿.md'), DRAFT_WITH_ENDNOTES())
  const src = join(proj, 'drafts', '初稿-v2.md')
  writeFileSync(src, '# 初稿v2\n\n## 摘要\n\n摘要。\n\n## 一、导论\n\n正文。\n\n## 参考文献\n\n[L01] a\n')
  const j = parseJson(run([P, proj, '--source', src]))
  assert.match(j.draft.name, /初稿-v2/, '--source 须优先：' + JSON.stringify(j.draft))
  rmSync(d, { recursive: true, force: true })
})

test('preflight：参数错误（缺项目）→ exit 10', () => {
  const r = run([P])
  assert.equal(r.code, 10)
})
