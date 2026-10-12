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

test('③ 面板链：M 门明细三态——边车带 detail 时以边车为准，**不带时由面板自己判定**', () => {
  const mk = (mGate, reportOnDisk = null) => {
    const { d, fin } = mkProject()
    writeFileSync(join(d, 'run', 'proj', 'status.md'), '# Status\n\n- ✅ **In Progress** — Phase 3（T5 写手出初稿 v1）\n')
    writeFileSync(join(fin, '运行报告.json'), JSON.stringify({
      generatedAt: '2026-10-01T12:00:00.000Z',
      mGate,
      scoring: { score: 80, coverage: 0.9 },
      words: { series: [] },
    }))
    if (reportOnDisk) writeFileSync(join(fin, 'M-Gate-Report.json'), JSON.stringify(reportOnDisk))
    return { d, snap: lightSnapshot(d, 'proj') }
  }
  // 边车带字段：以边车为准（同一判据，避免两处口径分叉）
  const a = mk({ path: 'final/M-Gate-Report.json', summary: { exit: 0 }, results: [], detail: 'legacy-no-results' })
  assert.equal(a.snap.report.gateDetail, 'legacy-no-results')
  assert.deepEqual(a.snap.report.gateItems, [])
  rmSync(a.d, { recursive: true, force: true })
  const b = mk({ path: null, summary: null, results: [], detail: 'no-report' })
  assert.equal(b.snap.report.gateDetail, 'no-report')
  assert.equal(b.snap.report.mGate, null, '无 summary 时汇总卡仍须走空态（不得渲染半成品）')
  rmSync(b.d, { recursive: true, force: true })
  const c = mk({ path: 'final/M-Gate-Report.json', summary: { exit: 0, total: 1 }, results: [{ id: 'M-Form-1', gate: 'M-Form-1', severity: '通过' }], detail: 'ok' })
  assert.equal(c.snap.report.gateDetail, 'ok')
  assert.equal(c.snap.report.gateItems.length, 1)
  rmSync(c.d, { recursive: true, force: true })

  // ⚠ v19.1.10 回归钉：**存量边车不带 detail**（19.1.9 之前生成的边车全是这样）——
  //   面板必须自己从项目目录判定，否则「按原因分流」对它本来要服务的那批旧格式项目完全失效，
  //   客户端会回落到那句要修掉的错指引「重跑一次即可带上」。
  const noField = (reportOnDisk) => mk({ path: 'final/M-Gate-Report.json', summary: { exit: 0 }, results: [] }, reportOnDisk).snap.report.gateDetail
  assert.equal(
    noField({ schema: 'old', exit_code: 0, summary: '终检通过' }),
    'legacy-no-results',
    '边车无 detail + 盘上是旧格式报告（无 results[]）→ 面板须自行判定为 legacy-no-results',
  )
  assert.equal(
    noField({ date: '2026-10-01', exit: 0, results: [{ id: 'M-Form-1' }] }),
    'ok',
    '边车无 detail + 盘上报告有 results[] → 判定为 ok',
  )
  // 盘上连报告都没有 → no-report（汇总卡据此给「先跑 m-gate-check」而不是「还没有数字层边车」）
  const d2 = mk({ path: null, summary: null, results: [] }).snap.report.gateDetail
  assert.equal(d2, 'no-report', '盘上无任何 M 门报告 → no-report')
})

test('④ 落盘链：成功即写盘；查不到用量记录时 exit 10 且绝不落 0 值文件', () => {
  // **环境无关**（v19.1.9 CI 实测教训）：本机有 DSH 会话库时脚本会走到「未找到项目日志」，
  //   而 CI 无库时会先报「找不到会话投影缓存」——**一条只在开发机绿的用例等于没钉住**。
  //   这里改为**自带数据源夹具**：按脚本支持的「旧版单文件布局」造一次真会话，让成功路径可复现。
  const { d } = mkProject()
  const home = join(d, 'dshempty', 'nope')   // 先备用：一个没有会话库的 DSH_HOME
  mkdirSync(join(d, 'dshempty'), { recursive: true })
  const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const store = join(d, 'dshempty', 'storages')
  mkdirSync(store, { recursive: true })
  writeFileSync(join(store, 'session_projcache.json'), JSON.stringify({
    tables: { sessions: { [SID]: { rows: { tokenUsage: { val: { totals: {
      uncachedInputTokens: 1000, cacheReadTokens: 2000, cacheWriteTokens: 0, outputTokens: 500,
    } } } } } } },
  }))
  const homeFixture = join(d, 'dshempty')

  // ① 成功路径：--out 指定的文件必须真的被写出来（写盘是本版新增能力，必须钉住）
  const okFile = join(d, 'out', 'token-cost.json')
  const r1 = run([join(SCRIPTS, 'token-cost.mjs'), '--dsh-home', homeFixture, '--sessions', SID, '--out', okFile])
  assert.equal(r1.code, 0, `应成功：${r1.out.slice(0, 300)}`)
  assert.ok(existsSync(okFile), '--out 指定的文件必须被写出（本版新增的落盘能力）')
  assert.equal(JSON.parse(readFileSync(okFile, 'utf8')).tokens.total, 3500, '落盘内容须与统计数据一致')

  // ② --no-write：成功也不写盘（退回旧行为）
  const noWriteFile = join(d, 'out', 'token-cost-nowrite.json')
  const r2 = run([join(SCRIPTS, 'token-cost.mjs'), '--dsh-home', homeFixture, '--sessions', SID, '--out', noWriteFile, '--no-write'])
  assert.equal(r2.code, 0)
  assert.equal(existsSync(noWriteFile), false, '--no-write 须真的不落盘')

  // ③ **查不到用量记录 → exit 10 且绝不落盘**：这条同时钉住「写盘块在 exit 10 之后」的顺序
  //    （顺序反了就会留下一个 0 值文件，把「查不到」写成「实测 0」——v18.2.6 立此门要防的正是它）
  const zeroFile = join(d, 'out', 'should-not-exist.json')
  const r3 = run([join(SCRIPTS, 'token-cost.mjs'), '--dsh-home', homeFixture, '--sessions', 'ffffffff-0000-0000-0000-000000000000', '--out', zeroFile])
  assert.equal(r3.code, 10, '未命中任何会话 → exit 10')
  assert.ok(!r3.out.includes('未知参数'), `--out 不得被判成未知参数：${r3.out.slice(0, 200)}`)
  assert.equal(existsSync(zeroFile), false, '**查不到用量时绝不落盘**：0 值文件会把「查不到」写成「实测 0」')

  // ④ 完全没有会话库时（CI 形态）：仍然 exit 10，且 --out 已被参数表接受
  const r4 = run([join(SCRIPTS, 'token-cost.mjs'), '--dsh-home', home, '--project', join(d, 'run', 'proj'), '--out', join(d, 'out', 'x.json')])
  assert.equal(r4.code, 10)
  assert.ok(!r4.out.includes('未知参数'), `--out 须在参数表内：${r4.out.slice(0, 200)}`)
  assert.match(r4.out, /找不到会话投影缓存|未提取到会话 ID|未找到任何项目日志/, '失败原因须是「没数据」而不是「参数不认识」')
  rmSync(d, { recursive: true, force: true })
})
