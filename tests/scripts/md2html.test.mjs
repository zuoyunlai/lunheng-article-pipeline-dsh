// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 md2html 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/md2html.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'



test('md2html --fig-dir：按图号配图（旧版把同一份 SVG 嵌进每个图位 → 多图导出静默出错）', () => {
  const d = tmp()
  const proj = mkProj(d)
  writeFileSync(join(proj, 'final', '图件', '图1_趋势.svg'), mkSvg('图一独有'))
  writeFileSync(join(proj, 'final', '图件', '图2_占比.svg'), mkSvg('图二独有'))
  const out = join(proj, 'final', 'out.html')
  const r = run([join(SCRIPTS, 'md2html.mjs'), join(proj, 'final', '定稿.md'), out, '--fig-dir', join(proj, 'final', '图件')])
  assert.equal(r.code, 0, r.out.slice(0, 200))
  const h = readFileSync(out, 'utf8')
  assert.match(h, /图一独有/, '图1 应嵌自己的图')
  assert.match(h, /图二独有/, '图2 应嵌自己的图（不得复用图1）')
  assert.equal(/class="fig-missing"/.test(h), false, '两图齐备时不应有缺图占位')
  assert.match(h, /图1（源：图1_趋势\.svg）/, '块级图注应标明源文件')
  rmSync(d, { recursive: true, force: true })
})

test('md2html：缺图给出期望文件名；行内图位也被替换且留告警（旧版静默当纯文本）', () => {
  const d = tmp()
  const proj = mkProj(d)
  const mdPath = join(proj, 'final', '定稿.md')
  writeFileSync(mdPath, MD.replace('[图2：占比]', '结构见 [图3：行内图位] 对比。'))
  writeFileSync(join(proj, 'final', '图件', '图1_趋势.svg'), mkSvg('图一独有'))
  const out = join(proj, 'final', 'out.html')
  const r = run([join(SCRIPTS, 'md2html.mjs'), mdPath, out, '--fig-dir', join(proj, 'final', '图件')])
  assert.equal(r.code, 0)
  const h = readFileSync(out, 'utf8')
  assert.match(h, /figure-inline/, '行内图位应就地内联（不再是纯文本）')
  assert.match(h, /class="fig-missing"[^<]*\[图3\]/, '缺失的行内图位应显式占位')
  assert.match(h, /图3_标题\.svg/, '缺图提示应给出期望文件名')
  assert.match(r.out, /行内/, '行内图位必须留告警（不静默）')
  rmSync(d, { recursive: true, force: true })
})

test('md2html：结构不合格的 SVG 必须 exit 40 且不产出 HTML（旧版原样嵌入 exit 0）', () => {
  const d = tmp()
  const proj = mkProj(d)
  writeFileSync(join(proj, 'final', '图件', '图1_趋势.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500"><rect x="1" <text>坏')
  writeFileSync(join(proj, 'final', '图件', '图2_占比.svg'), mkSvg('ok'))
  const out = join(proj, 'final', 'out.html')
  const r = run([join(SCRIPTS, 'md2html.mjs'), join(proj, 'final', '定稿.md'), out, '--fig-dir', join(proj, 'final', '图件')])
  // v18.12.0（L-72c）：2 → **40**。旧值 2 与 M 门「2 = 存在 P0 失败」撞义——把「缺/坏图件」读成
  //   「定稿有 P0」，补救动作完全不同（补图件 vs 改正文）。本仓对这类撞码的既有处置就是给独立码。
  assert.equal(r.code, 40, '坏 SVG 应拒绝导出（exit 40，不是 M 门的 2）')
  assert.match(r.out, /结构不合格|未闭合|未正确嵌套/)
  assert.match(r.out, /不是.*M 门|不要改正文/, '报错须显式提醒「别按 M 门 2=P0 读」')
  assert.ok(!existsSync(out), '拒绝时不得留下半成品 HTML')
  rmSync(d, { recursive: true, force: true })
})

test('md2html：单 SVG 向后兼容但必须告警（多图复用同一份图）', () => {
  const d = tmp()
  const proj = mkProj(d)
  const svg = join(proj, 'final', '图件', '图1_趋势.svg')
  writeFileSync(svg, mkSvg('图一独有'))
  const out = join(proj, 'final', 'out.html')
  const r = run([join(SCRIPTS, 'md2html.mjs'), join(proj, 'final', '定稿.md'), out, svg])
  assert.equal(r.code, 0)
  assert.equal((readFileSync(out, 'utf8').match(/图一独有/g) || []).length, 2, '两个图位复用同一份 SVG')
  assert.match(r.out, /单 SVG 模式/, '必须显式告警（旧版静默）')
  rmSync(d, { recursive: true, force: true })
})

test('v18.2.9 审计 B4：writeWithSafety 原子写（temp+rename）不在目标目录留 .lunheng-tmp 残留', () => {
  const { d, proj, fin } = mkProject()
  const src = join(fin, '定稿.md')
  writeFileSync(src, '# 源\n\n## 摘要\n\n正文。\n', 'utf8')
  const out = join(fin, 'export.html')
  const r = run([join(SCRIPTS, 'md2html.mjs'), src, out])
  assert.equal(r.code, 0, 'md2html 正常导出应 exit 0：' + (r.err || r.out || ''))
  const residue = readdirSync(fin).filter((f) => f.includes('lunheng-tmp'))
  assert.equal(residue.length, 0, '原子写不应留下 temp 残留：' + residue.join(', '))
  assert.ok(existsSync(out), '导出文件应存在')
  rmSync(d, { recursive: true, force: true })
})
