// 「位图（PNG/JPG）与 SVG 同权」+「token-cost 落盘」契约测试（v19.1.9）
// 运行：node --test tests/png-figure-parity.test.mjs
//
// 为什么需要：本机 cairo 系统库缺失 ⇒ **Pillow 直出 PNG 是既定工作流**，而链路上曾有**四处**
//   各自 `endsWith('.svg')` 过滤（`figureNoOf` / `md2html` 配图 / `M-Form-9` 图件闭环 /
//   `build-evidence-bundle` 收图）——于是**已交付的 PNG 图件在全链上等于不存在**：
//   M 门报「缺图」P0、导出件留「缺图」占位、证据包不收、面板显示 0 张。
//   **假阳性会逼人无视红灯**，故本批把口径收进 `_lib/svg.mjs` 一处，并在此钉住。
//
// 覆盖：
//   ① 口径唯一：`FIGURE_EXT_RE` / `figureNoOf`（svg|png|jpg 同权）/ `isRasterFigure`；
//   ② 导出链：`md2html --fig-dir` 把 PNG **内联为 data URI**（不再留「缺图」占位）；
//   ③ 面板链：边车的 `mGate.detail` 三态（ok / legacy-no-results / no-report）如实透出
//      ——它是「空态为什么空」的唯一依据，旧版一律说「重跑一次即可带上」对旧格式是**错指引**；
//   ④ 落盘链：`token-cost.mjs --out` 被识别；**查不到用量记录时 exit 10 且绝不落 0 值文件**
//      （v18.2.6 立的门，不得因新增写盘而破）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, mkProject, MD, run, SCRIPTS } from './_fixtures.mjs'
import { FIGURE_EXT_RE, figureNoOf, isRasterFigure } from '../skills/lunheng-article-pipeline/scripts/_lib/svg.mjs'
import { listFigureFiles } from '../skills/lunheng-article-pipeline/scripts/_lib/figure-reconcile.mjs'
import { lightSnapshot } from '../lib/panel.mjs'

test('① 图件口径唯一：svg / png / jpg 同权，且只有位图被判为 raster', () => {
  // 唯一真源 = svg.mjs；三处消费者（md2html / M-Form-9 / 对账库）都从这里取口径。
  for (const f of ['图1_趋势.svg', '图1-趋势.png', '图1.jpg', '图2.jpeg', '图 3.png']) {
    assert.notEqual(figureNoOf(f), null, `${f} 应能被解析出图号（位图与 SVG 同权）`)
  }
  assert.equal(figureNoOf('封面-横版.svg'), null, '无「图N」前缀的不是正文图件')
  assert.equal(figureNoOf('附录A1_成本.png'), null, '无「图N」前缀的不是正文图件')
  assert.ok(FIGURE_EXT_RE.test('图9_甲.PNG'), '扩展名判定应大小写不敏感')
  assert.equal(isRasterFigure('图1_甲.png'), true)
  assert.equal(isRasterFigure('图1_甲.svg'), false)

  // 对账库必须与 svg.mjs 同源（旧版它自带一份 `图\s*(\d+)` 正则——两处分叉会导致
  // 「导出件说缺图但面板说齐」这类互相矛盾的结论）
  const d = tmp('lh-png-')
  mkdirSync(join(d, 'final', '图件'), { recursive: true })
  writeFileSync(join(d, 'final', '图件', '图1_定价序列.png'), 'PNG-BYTES')
  const { files } = listFigureFiles(d)
  assert.deepEqual(files.map((f) => f.n), [1], '对账库须认 PNG 的名字里的图号')
  assert.equal(files[0].ext, 'png')
  rmSync(d, { recursive: true, force: true })
})

test('② 导出链：md2html --fig-dir 把 PNG 内联为 data URI，且不再留「缺图」占位', () => {
  const { d, fin } = mkProject()
  const figDir = join(fin, '图件')
  mkdirSync(figDir, { recursive: true })
  // 夹具 MD 有 [图1：趋势] 与 [图2：占比] 两个图位；这里**只给图1**（PNG），图2 仍应报缺
  writeFileSync(join(figDir, '图1_趋势.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, MD)
  const out = join(d, 'out.html')
  const r = run([join(SCRIPTS, 'md2html.mjs'), draft, out, '--fig-dir', figDir])
  assert.equal(r.code, 0, `导出应成功（位图不得被当 SVG 解析）：${r.out.slice(0, 300)}`)
  const html = readFileSync(out, 'utf8')
  assert.ok(html.includes('data:image/png;base64,'), 'PNG 图件须内联为 data URI')
  // 只数**占位元素**（CSS 里也有 `.fig-missing` 规则，按裸词数会多算一处）
  assert.equal((html.match(/class="fig-missing"/g) || []).length, 1, '未配的图2 仍须留一处缺图占位（不静默）')
  rmSync(d, { recursive: true, force: true })
})

test('③ 面板链：边车 mGate.detail 三态如实透出（空态「为什么空」的唯一依据）', () => {
  const mk = (mGate) => {
    const { d, fin } = mkProject()
    writeFileSync(join(d, 'run', 'proj', 'status.md'), '# Status\n\n- ✅ **In Progress** — Phase 3（T5 写手出初稿 v1）\n')
    writeFileSync(join(fin, '运行报告.json'), JSON.stringify({
      generatedAt: '2026-10-01T12:00:00.000Z',
      mGate,
      scoring: { score: 80, coverage: 0.9 },
      words: { series: [] },
    }))
    return { d, snap: lightSnapshot(d, 'proj') }
  }
  // 旧格式报告（有报告、无 results[]）→ 重跑 run-report **永远带不上**明细
  const a = mk({ path: 'final/M-Gate-Report.json', summary: { exit: 0 }, results: [], detail: 'legacy-no-results' })
  assert.equal(a.snap.report.gateDetail, 'legacy-no-results')
  assert.deepEqual(a.snap.report.gateItems, [])
  rmSync(a.d, { recursive: true, force: true })
  // 项目里根本没有 M 门报告
  const b = mk({ path: null, summary: null, results: [], detail: 'no-report' })
  assert.equal(b.snap.report.gateDetail, 'no-report')
  assert.equal(b.snap.report.mGate, null, '无 summary 时汇总卡仍须走空态（不得渲染半成品）')
  rmSync(b.d, { recursive: true, force: true })
  // 正常：有明细 → 客户端走灯带分支，不看空态文案
  const c = mk({ path: 'final/M-Gate-Report.json', summary: { exit: 0, total: 1 }, results: [{ id: 'M-Form-1', gate: 'M-Form-1', severity: '通过' }], detail: 'ok' })
  assert.equal(c.snap.report.gateDetail, 'ok')
  assert.equal(c.snap.report.gateItems.length, 1)
  rmSync(c.d, { recursive: true, force: true })
})

test('④ 落盘链：--out 被识别；查不到用量记录时 exit 10 且绝不落 0 值文件', () => {
  const { d } = mkProject()   // 空项目：没有任何可提取会话 ID 的日志
  const outFile = join(d, 'final', 'token-cost.json')
  const r = run([join(SCRIPTS, 'token-cost.mjs'), '--project', join(d, 'run', 'proj'), '--out', outFile])
  assert.equal(r.code, 10, '未提取到会话 ID → exit 10（参数或路径错）')
  assert.match(r.out, /未(提取到会话 ID|找到任何项目日志)/, '报错应是「没会话」，不是「未知参数」——即 --out 必须已被参数表接受')
  assert.ok(!r.out.includes('未知参数'), `--out 不得被判成未知参数：${r.out.slice(0, 200)}`)
  assert.equal(existsSync(outFile), false, '**查不到用量时绝不落盘**：0 值文件会把「查不到」写成「实测 0」')
  // --no-write 同样必须被接受（不得报未知参数）
  const r2 = run([join(SCRIPTS, 'token-cost.mjs'), '--project', join(d, 'run', 'proj'), '--no-write'])
  assert.ok(!r2.out.includes('未知参数'), '--no-write 须在参数表内')
  rmSync(d, { recursive: true, force: true })
})
