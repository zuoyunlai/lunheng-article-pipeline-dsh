// run-report.mjs 契约测试（v18.89.0 新增；随包脚本「单项目运行报告」）
// 运行：node --test tests/scripts/run-report.test.mjs
//
// 覆盖三条契约面（各条都对应实现里的一处判断，不是「跑一遍不炸」）：
//   ① 正例：夹具项目 → 自包含 HTML + JSON 边车；**口径与围栏**逐项断言（等待分钟数 / 正文区汉字 /
//      图件内联 / 零外部引用 / 证据包条目数 / 来源分片数）；
//   ② 缺输入：空项目 → exit **3**（沿用 `self-check.mjs` 的「适用却缺输入 = 须人工核」语义，
//      **不是内容失败**），且**仍产出 HTML**（面板标 N/A 而不是拒绝出报告）；
//   ③ 参数/路径错：未知参数 / 项目在 `<cwd>/run` 之外 / 带值旗标缺值 → 一律 exit **10**。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from '../_fixtures.mjs'

const SCRIPT = join(SCRIPTS, 'run-report.mjs')

/** 造一个最小但结构完整的项目夹具（覆盖脚本读的每一类产物）。 */
function fixtureProject(root, name = 'proj-r') {
  const proj = join(root, 'run', name)
  for (const sub of ['final/证据包', 'final/图件', 'drafts', 'audits', 'sources']) {
    mkdirSync(join(proj, sub), { recursive: true })
  }
  const DRAFT = `# 题名\n\n## 摘要\n\n本文研究甲与乙。\n关键词：甲；乙\n\n## 一、正文\n正文甲乙丙丁戊己庚辛壬癸。\n\n## 参考文献\n[1] 某某.\n`
  writeFileSync(join(proj, 'drafts', '初稿-v1.md'), DRAFT)
  writeFileSync(join(proj, 'final', '定稿.md'), DRAFT)
  writeFileSync(join(proj, 'status.md'), [
    '# Status', '',
    '- **启动时间**: 2026-10-01 10:00',
    '- **项目**: `proj-r`｜**题名**：测试题名（4 字）',
    '- **文类**: `academic-hum`｜**目标篇幅**: 1000 字（纠偏线 980–1020；G8 硬阈 900–1100）',
    '',
    '## Phase 进度', '',
    '| Phase | 内容 | 状态 |',
    '|---|---|---|',
    '| 0 定题 | 阶段确认-Phase0.md | ✅ 完成 |',
    '',
    '## 修订回环记录', '',
    '- **A 轨审计打回：1/2 轮**',
    '',
    '## 交付物清单（final/）', '',
    '| 项 | 路径 | 字节 | sha / 校验 |',
    '|---|---|---|---|',
    '| **定稿** | `final/定稿.md` | 100 B | sha `abc123…` |',
    '',
    '## 待主人决策（当前）', '',
    '- **无**',
    '',
  ].join('\n'))
  writeFileSync(join(proj, 'audits', 'gate-receipts.jsonl'), JSON.stringify({
    gate: 'Phase0', round: 1, askedAt: '2026-10-01T10:00:00+08:00', answeredAt: '2026-10-01T10:30:00+08:00',
    chosenLabel: '① 全部同意（推荐）', options: ['① 全部同意（推荐）', '② 部分同意'],
  }) + '\n')
  writeFileSync(join(proj, 'final', 'M-Gate-Report.json'), JSON.stringify({
    total: 24, pass: 23, p0: 0, p1: 0, p2: 1, skips: 0, exit: 1,
    results: [
      { gate: 'M-Form-1 引用标注完整性', pass: true, severity: '通过', detail: '正文引用 3 处' },
      { gate: 'M-Exist-1 引用双向对比', pass: false, severity: 'P2', detail: '缺 1 条（候选）' },
    ],
  }))
  writeFileSync(join(proj, 'drafts', '轮次账本.md'), [
    '# 轮次账本', '',
    '| 轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间 |',
    '|---|---|---|---|---|---|',
    '| A | 1/2 | drafts/初稿-v1.md | audits/审计报告-v1.md（打回修订） | audits/复核报告-v1.md | 2026-10-01 |',
    '',
  ].join('\n'))
  writeFileSync(join(proj, 'sources', 'T1.jsonl'), '{"url":"https://example.invalid/a"}\n{"url":"https://example.invalid/b"}\n')
  writeFileSync(join(proj, 'final', '证据包', 'manifest.json'), JSON.stringify({
    auditTargetSha256: 'f'.repeat(64), entries: [{ path: '定稿.md', sha256: 'a'.repeat(64) }],
  }))
  writeFileSync(join(proj, 'final', '图件', '图1_测试.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><rect width="10" height="10"/></svg>')
  return proj
}

test('run-report：正例 —— 自包含 HTML + JSON 边车，口径/围栏逐项断言', () => {
  const d = tmp()
  try {
    fixtureProject(d)
    const out = join(d, 'report.html')
    const js = join(d, 'report.json')
    const r = run([SCRIPT, 'run/proj-r', '--out', out, '--json', js, '--no-score'], { cwd: d })
    assert.equal(r.code, 0, `应 exit 0，实际 ${r.code}：${r.out.slice(0, 400)}`)

    // ① 产物存在且非空
    assert.ok(existsSync(out), 'HTML 应落盘')
    assert.ok(statSync(out).size > 3000, `HTML 体积异常（${statSync(out).size} B）`)
    const html = readFileSync(out, 'utf8')

    // ② 自包含：零外部引用（内联 SVG 的 xmlns 是命名空间串，不是网络请求，故只查真正的取件面）
    assert.ok(!/<link[\s>]/i.test(html), 'HTML 不得含 <link>（外部样式）')
    assert.ok(!/<img[\s>]/i.test(html), 'HTML 不得含 <img>（外部图片）')
    assert.ok(!/<script[\s>]/i.test(html), 'HTML 不得含 <script>')
    assert.ok(!/@import/.test(html), 'CSS 不得 @import')
    assert.ok(!/(src|href)\s*=\s*"https?:/i.test(html), 'HTML 不得引用 http(s) 资源')

    // ③ 图件被内联（viewBox 原样进入正文，且 width/height 已剥离以自适应）
    assert.ok(html.includes('viewBox="0 0 10 10"'), '图件 SVG 应被内联')
    assert.ok(!html.includes('width="10" height="10"><rect'), '内联图件应剥离固定宽高')

    // ④ 结构化数字
    assert.ok(html.includes('M-Exist-1'), 'M 门逐项应出现在报告里')
    assert.ok(html.includes('N/A —— 本次以 --no-score 运行'), '--no-score 时合规分面板应如实标 N/A')

    // ⑤ JSON 边车：等待分钟数 / 正文区汉字 / 证据包条目 / 来源分片
    const j = parseJson({ stdout: readFileSync(js, 'utf8') })
    assert.equal(j.schema, 'lunheng.run-report/1')
    assert.equal(j.gates.length, 1)
    assert.equal(j.gates[0].waitMin, 30, '10:00 → 10:30 应算 30 分钟等待')
    const fin = j.words.series.find((s) => s.label === '定稿')
    assert.ok(fin, 'JSON 应含定稿字数点')
    // 正文区 = `## 摘要` 之后 → `## 参考文献` 之前（含摘要正文、关键词段与正文节标题汉字）：
    //   本文研究甲与乙 7 + 关键词甲乙 5 + 节标题「一、正文」3 + 正文句 12 = 27（题名 2 与参考文献节不计入）
    assert.equal(fin.han, 27, `正文区汉字口径：期望 27，实际 ${fin.han}`)
    assert.equal(fin.degraded, false, '夹具两侧边界齐备，不应 degraded')
    assert.equal(j.mGate.summary.p2, 1)
    assert.equal(j.mGate.results.length, 2)
    assert.equal(j.artifacts.evidenceEntries, 1, '证据包条目数应来自 manifest.entries')
    assert.equal(j.sources.mergedCount, null, '无 sources.json → 合并来源为 null（不编 0）')
    assert.deepEqual(j.sources.shards.map((s) => [s.name, s.lines]), [['T1', 2]])
    assert.equal(j.dataSourceNotes.filter((n) => n.level === 'miss').length, 0, '夹具齐备时不应有 miss 级缺口')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('run-report：缺输入 —— 空项目仍出报告，但 exit 3（须人工核，非内容失败）', () => {
  const d = tmp()
  try {
    const proj = join(d, 'run', 'proj-empty')
    mkdirSync(proj, { recursive: true })
    const out = join(d, 'r.html')
    const r = run([SCRIPT, 'run/proj-empty', '--out', out, '--no-score'], { cwd: d })
    assert.equal(r.code, 3, `缺输入应 exit 3（不是 0，也不是 1/2），实际 ${r.code}`)
    assert.ok(existsSync(out), '缺输入也要产出报告（面板标 N/A），而不是拒绝出报告')
    const html = readFileSync(out, 'utf8')
    assert.ok(html.includes('status.md'), '缺口清单应点名缺的是 status.md')
    assert.ok(/\[miss\]/.test(r.stdout), 'stdout 应逐条列出 miss 级缺口')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('run-report：默认输出落 <项目>/final/运行报告.html', () => {
  const d = tmp()
  try {
    const proj = fixtureProject(d, 'proj-def')
    const r = run([SCRIPT, 'run/proj-def', '--no-score', '--quiet'], { cwd: d })
    assert.equal(r.code, 0, r.out.slice(0, 300))
    assert.ok(existsSync(join(proj, 'final', '运行报告.html')), '缺省 --out 应落 final/运行报告.html')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('run-report：参数与路径错一律 exit 10（未知参数 / 越出 run / 带值旗标缺值）', () => {
  const d = tmp()
  try {
    fixtureProject(d, 'proj-x')
    const outside = tmp()
    try {
      assert.equal(run([SCRIPT, 'run/proj-x', '--nope'], { cwd: d }).code, 10, '未知参数 → 10')
      assert.equal(run([SCRIPT, outside], { cwd: d }).code, 10, '项目目录在 <cwd>/run 之外 → 10')
      assert.equal(run([SCRIPT, 'run/proj-x', '--out'], { cwd: d }).code, 10, '带值旗标缺值 → 10')
      assert.equal(run([SCRIPT], { cwd: d }).code, 10, '缺位置参数 → 10')
    } finally { rmSync(outside, { recursive: true, force: true }) }
  } finally { rmSync(d, { recursive: true, force: true }) }
})
