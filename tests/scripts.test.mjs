// 随包脚本回归测试（v2.5.2-dsh.13 新增）
// 每个用例对应一个「第三方审计发现、只能靠人工实测才暴露」的缺陷，防止复发。
// 运行：node --test tests/     （CI 在 ubuntu-latest 与 windows-latest 双平台跑）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')
const run = (args, opts = {}) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: opts.cwd || ROOT })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', stderr: r.stderr || '' }
}
const parseJson = (r) => JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
const tmp = () => mkdtempSync(join(tmpdir(), 'lunheng-test-'))

test('count-chars：缺「## 摘要」时正文口径必须显式标记 degraded（不得静默退化）', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, '# 标题\n\n正文若干字。\n\n## 参考文献\n\n[L01] 某文献\n')
  const r = run([join(SCRIPTS, 'count-chars.mjs'), f])
  assert.equal(r.code, 0)
  const j = parseJson(r)
  assert.equal(j.degraded, true, '应带 degraded 标记')
  assert.match(j.degradedReason, /摘要/)
  rmSync(d, { recursive: true, force: true })
})

test('count-chars：--full 不应带 degraded 标记', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, '# 标题\n\n正文若干字。\n')
  const r = run([join(SCRIPTS, 'count-chars.mjs'), f, '--full'])
  const j = parseJson(r)
  assert.equal(j.degraded, undefined)
  rmSync(d, { recursive: true, force: true })
})

test('normalize-trust-level：缺 token 必须拒绝推断并以 exit 1 收尾（旧版默认填「已发布」）', () => {
  const d = tmp()
  const f = join(d, '卡.md')
  writeFileSync(f, '# 数据卡\n\n## [D01] 某公报\n来源：stats.gov.cn\n摘要：某数据。\n')
  const r = run([join(SCRIPTS, 'normalize-trust-level.mjs'), f])
  assert.equal(r.code, 1, '缺 token 应 exit 1')
  assert.match(r.out, /拒绝推断/)
  assert.ok(!readFileSync(f, 'utf8').includes('信任级别：'), '不得写入任何推断值')
  rmSync(d, { recursive: true, force: true })
})

test('normalize-trust-level：默认 dry-run 不落盘；--write 才落盘并写 .bak', () => {
  const d = tmp()
  const f = join(d, '卡.md')
  writeFileSync(f, '# 数据卡\n\n## [D07] 某报告\n摘要：本数据二手转引自某日报。\n')
  const dry = run([join(SCRIPTS, 'normalize-trust-level.mjs'), f])
  assert.equal(dry.code, 0)
  assert.ok(!readFileSync(f, 'utf8').includes('信任级别：'), 'dry-run 不得落盘')
  const w = run([join(SCRIPTS, 'normalize-trust-level.mjs'), f, '--write'])
  assert.equal(w.code, 0)
  assert.match(readFileSync(f, 'utf8'), /信任级别：二手转引/)
  assert.ok(existsSync(f + '.bak'), '应写 .bak 备份')
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check：参数/路径错误必须 exit 10（与「1 = P1 内容失败」区分）', () => {
  const r = run([join(SCRIPTS, 'm-gate-check.mjs')])
  assert.equal(r.code, 10)
})

test('m-gate-check：不带 --report 的常规调用必须正常工作（回归：曾因 reportIdx=-1 排除首个位置参数而误报用法错误）', () => {
  const d = tmp()
  const proj = join(d, 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
  assert.notEqual(r.code, 10, '不得判为参数错误：' + r.out.slice(0, 160))
  const j = parseJson(r)
  assert.ok(j.total >= 10, '应输出完整 M 门报告（total=' + j.total + '）')
  assert.equal(typeof j.exit, 'number')
  rmSync(d, { recursive: true, force: true })
})

test('final-check：应把 M 门报告落到真源路径 final/M-Gate-Report.json（供审计视图读取）', () => {
  const d = tmp()
  const proj = join(d, 'proj')
  const fin = join(proj, 'final')
  mkdirSync(join(fin, '证据包'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  run([join(SCRIPTS, 'final-check.mjs'), proj, '--no-summary'])
  assert.ok(existsSync(join(fin, 'M-Gate-Report.json')), 'M 门报告应落在 final/M-Gate-Report.json')
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check：--report 落盘结构化报告（报告契约闭环）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  const rep = join(fin, 'M-Gate-Report.json')
  mkdirSync(ev, { recursive: true })
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文。\n\n## 参考文献\n\n[L01] 文献\n')
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev, '--report', rep])
  assert.ok(existsSync(rep), '报告应落盘')
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  assert.equal(typeof j.exit, 'number')
  assert.ok(j.total >= 10, `M 门应有 ≥10 项（实测 ${j.total}）`)
  rmSync(d, { recursive: true, force: true })
})

test('final-check：正斜杠 --report 路径不得崩溃（旧版硬编码反斜杠 → mkdir \'\' ENOENT）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  const reportRel = 'audits/final.json'
  const r = run([join(SCRIPTS, 'final-check.mjs'), proj, '--no-summary', '--report', join(proj, reportRel)])
  assert.ok(!/ENOENT|mkdir/.test(r.out), `不应出现 mkdir/ENOENT 崩溃：${r.out.slice(0, 200)}`)
  assert.ok(existsSync(join(proj, reportRel)), '报告应落盘')
  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：--deep-summary 蕴含 --summary（旧版单独用是静默空操作）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--deep-summary'])
  assert.equal(r.code, 0)
  assert.ok(existsSync(join(proj, 'audits', '审计视图-v0.md')), '应生成审计视图（deep 蕴含 summary）')
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check --fix：dry-run 不得改写任何文件（旧版一跑即 ReferenceError）', () => {
  const before = readFileSync(join(SCRIPTS, 'consistency-check.mjs'), 'utf8')
  const r = run([join(SCRIPTS, 'consistency-check.mjs'), '--fix'])
  assert.ok(!/ReferenceError/.test(r.out), '不得再出现 ReferenceError')
  assert.match(r.out, /dry-run/)
  assert.equal(readFileSync(join(SCRIPTS, 'consistency-check.mjs'), 'utf8'), before)
})

test('token-cost --top N：按 cacheRead 降序给出排名（旧版只有头注释与 CHANGELOG 承诺，代码里是死变量 topMode=false）', () => {
  const d = tmp()
  const home = join(d, 'dshhome')
  mkdirSync(join(home, 'storages'), { recursive: true })
  const t = (cacheRead, outputTokens) => ({ uncachedInputTokens: 10, cacheReadTokens: cacheRead, cacheWriteTokens: 20, outputTokens })
  writeFileSync(join(home, 'storages', 'session_projcache.json'), JSON.stringify({
    tables: {
      sessions: {
        'main-1': { rows: { tokenUsage: { val: { totals: t(5000000, 3000) } } } },
        'sub-a': { rows: { tokenUsage: { val: { totals: t(20000000, 4000) } } } },
        'sub-b': { rows: { tokenUsage: { val: { totals: t(100000, 700) } } } },
      },
    },
  }))
  const base = [join(SCRIPTS, 'token-cost.mjs'), '--dsh-home', home, '--sessions', 'main-1,sub-a,sub-b']
  const r = run([...base, '--top', '2'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const j = parseJson(r)
  assert.equal(j.topByCacheRead.length, 2, 'Top 2 应只给两条')
  assert.equal(j.topByCacheRead[0].session, 'sub-a', 'cacheRead 最大者必须排第一')
  assert.ok(j.topByCacheRead[0].cacheReadShareOfTotalPct > j.topByCacheRead[1].cacheReadShareOfTotalPct, 'share 必须递减')
  assert.ok(j.topByCacheRead[0].costEstimateUsd > 0, '必须给单会话成本估算')
  // 向后兼容：不传 --top 时输出契约不变（不得凭空多出字段）
  assert.equal(parseJson(run(base)).topByCacheRead, undefined, '无 --top 时不得输出排名段')
  // 非法值必须报错，不得静默忽略（与 --price-* 的 NaN 防御同口径）
  assert.equal(run([...base, '--top', '0']).code, 1, '--top 0 应 exit 1')
  assert.equal(run([...base, '--top', 'x']).code, 1, '--top x 应 exit 1')
  assert.equal(run([...base, '--nope']).code, 1, '未知参数应 exit 1（旧版静默忽略）')
  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：无定稿时视图源回退到最新草稿（旧版写死 final/定稿.md → T6/T7/T9 在定稿前根本无视图可读）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  writeFileSync(join(proj, 'drafts', '初稿-v1.md'), '# 甲\n\n## 摘要\n\n一稿。\n')
  writeFileSync(join(proj, 'drafts', '初稿-v2.md'), '# 乙\n\n## 摘要\n\n二稿正文 [L01]。\n')
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 0)
  const viewPath = join(proj, 'audits', '审计视图-v0.md')
  const view = readFileSync(viewPath, 'utf8')
  assert.match(view, /视图源.*初稿-v2\.md/, '应回退到版本号最高的草稿')
  assert.match(view, /草稿快照/, '必须显式标注草稿快照，防被当定稿字数引用')
  // 定稿出现后必须优先定稿（草稿仍在也不得回退）
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), '# 定\n\n## 摘要\n\n定稿正文。\n')
  run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.match(readFileSync(viewPath, 'utf8'), /视图源.*定稿\.md/, '定稿必须优先于草稿')
  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：尚无正文也要出素材阶段视图；--source 缺失须 fail fast（旧版直接跳过不生成）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'data'), { recursive: true })
  writeFileSync(join(proj, 'data', '数据卡.md'), '# 数据卡\n\n## [D01] 某公报\n信任级别：已发布\n')
  // --source 指向不存在文件：必须 exit 2，且不得先把证据包复制一半（先于成功运行断言，防被前一次的产物干扰）
  const bad = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary', '--source', 'nope.md'])
  assert.equal(bad.code, 2, '--source 缺失应 exit 2')
  assert.ok(!existsSync(join(proj, 'final', '证据包')), '不得先复制证据包再报错（fail fast）')
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 0)
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  assert.match(view, /无正文源/, '无正文时必须显式标注，不得留空结构冒充')
  assert.match(view, /素材卡数量/, '素材段必须在（T4 分析/Phase 2 消费）')
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ⑮⑯⑰：新规则必须真的会报（派发卡超长 / 审计视图断链 / 定量断言缺出处）', () => {
  const d = tmp()
  const repo = join(d, 'repo')
  mkdirSync(repo, { recursive: true })
  cpSync(join(ROOT, 'skills'), join(repo, 'skills'), { recursive: true })
  for (const f of ['package.json', 'CHANGELOG.md', 'cordis.patch.yml']) cpSync(join(ROOT, f), join(repo, f))
  const R = join(repo, 'skills', 'lunheng-article-pipeline')
  // ⑮：把 T2 卡灌到 13 行（超过 12 行上限）
  const dcPath = join(R, 'references', 'dispatch-cards.md')
  const filler = Array.from({ length: 10 }, (_, i) => `- 灌水第 ${i + 1} 行`).join('\n')
  writeFileSync(dcPath, readFileSync(dcPath, 'utf8').replace('## T3 案例检索员', `${filler}\n\n## T3 案例检索员`))
  // ⑯：抹掉 T4 卡里的「审计视图」字样（文档仍声称默认只读 → 断链）
  const t4Path = join(R, 'references', 'agents', '04-分析-analyst.md')
  writeFileSync(t4Path, readFileSync(t4Path, 'utf8').replaceAll('审计视图', '审计报告'))
  // ⑰：追加一条无算式/无实测出处的百分比断言
  const tplPath = join(R, 'references', 'templates', '案例卡-template.md')
  writeFileSync(tplPath, readFileSync(tplPath, 'utf8') + '\n> 本模板可省 77% token。\n')
  const r = run([join(R, 'scripts', 'consistency-check.mjs')])
  assert.equal(r.code, 1, '注入 3 处漂移后必须 exit 1')
  assert.match(r.out, /派发卡超长/, '⑮ 必须捕获派发卡超长')
  assert.match(r.out, /审计视图断链/, '⑯ 必须捕获角色卡与文档断链')
  assert.match(r.out, /定量断言缺出处/, '⑰ 必须捕获无出处的百分比断言')
  rmSync(d, { recursive: true, force: true })
})

// ===== v2.5.2-dsh.16：SVG 图件链路 =====
const MD = '# 标题\n\n## 摘要\n\n正文。\n\n[图1：趋势]\n\n中间段。\n\n[图2：占比]\n\n结尾。\n'
const mkSvg = (marker) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500"><text x="10" y="20">${marker}</text></svg>\n`
const mkProj = (d) => {
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final', '图件'), { recursive: true })
  mkdirSync(join(proj, 'final', '证据包'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), MD)
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n子问题 A：x。\n图位数量：2\n')
  writeFileSync(join(proj, 'final', '证据包', '数据卡.md'), '# 数据卡\n\n## [D01] x\n数值 86 万\n信任级别：已发布\n')
  writeFileSync(join(proj, 'final', '证据包', '文献卡.md'), '# 文献卡\n\n## [L01] x\n信任级别：已发布\n')
  return proj
}

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

test('md2html：结构不合格的 SVG 必须 exit 2 且不产出 HTML（旧版原样嵌入 exit 0）', () => {
  const d = tmp()
  const proj = mkProj(d)
  writeFileSync(join(proj, 'final', '图件', '图1_趋势.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500"><rect x="1" <text>坏')
  writeFileSync(join(proj, 'final', '图件', '图2_占比.svg'), mkSvg('ok'))
  const out = join(proj, 'final', 'out.html')
  const r = run([join(SCRIPTS, 'md2html.mjs'), join(proj, 'final', '定稿.md'), out, '--fig-dir', join(proj, 'final', '图件')])
  assert.equal(r.code, 2, '坏 SVG 应拒绝导出')
  assert.match(r.out, /结构不合格|未闭合|未正确嵌套/)
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

test('m-gate-check M-Form-9：未启用配图记 N/A 不算失败（配图默认关闭，不得据此判 M 门不过）', () => {
  const d = tmp()
  const proj = mkProj(d)
  writeFileSync(join(proj, 'final', '定稿.md'), MD.replace(/\[图\d+：[^\]]*\]\n\n?/g, ''))
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj, 'final', '定稿.md'), join(proj, 'final', '证据包')])
  const j = parseJson(r)
  const item = j.results.find((x) => x.gate.startsWith('M-Form-9'))
  assert.ok(item, '应存在 M-Form-9 项')
  assert.equal(item.pass, true, '无图位无图件 → N/A pass')
  assert.match(item.detail, /N\/A/)
  assert.equal(j.total, 13, '脚本机械项应为 13 项（含 M-Form-9）')
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-9：缺图/图件全缺 → 硬失败且严重度分级正确', () => {
  const d = tmp()
  const proj = mkProj(d)
  // 只给图1 → 图2 缺图 → P1
  writeFileSync(join(proj, 'final', '图件', '图1_趋势.svg'), mkSvg('图一独有'))
  let r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj, 'final', '定稿.md'), join(proj, 'final', '证据包')])
  let item = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-9'))
  assert.equal(item.pass, false)
  assert.equal(item.severity, 'P1', '单张缺图应 P1：' + item.detail)
  assert.match(item.detail, /缺图/)
  // 删掉目录 → 图件全缺 → P0
  rmSync(join(proj, 'final', '图件'), { recursive: true, force: true })
  r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj, 'final', '定稿.md'), join(proj, 'final', '证据包')])
  item = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-9'))
  assert.equal(item.severity, 'P0', '图件全缺应 P0（T5 卡宣称的 P0 拦截落地）：' + item.detail)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-9：孤儿图件与无出处数字只给 P2 提示（启发式不得当硬失败）', () => {
  const d = tmp()
  const proj = mkProj(d)
  writeFileSync(join(proj, 'final', '图件', '图1_趋势.svg'), mkSvg('86'))
  writeFileSync(join(proj, 'final', '图件', '图2_占比.svg'), mkSvg('98765'))
  writeFileSync(join(proj, 'final', '图件', '图9_多余.svg'), mkSvg('孤儿'))
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj, 'final', '定稿.md'), join(proj, 'final', '证据包')])
  const item = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-9'))
  assert.equal(item.severity, 'P2', item.detail)
  assert.match(item.detail, /孤儿图件/)
  assert.match(item.detail, /98765/, '图上数字无出处应被提示')
  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：图件随证据包收齐，审计视图给出图件对账（T7/T8 不再看不见图）', () => {
  const d = tmp()
  const proj = mkProj(d)
  writeFileSync(join(proj, 'final', '图件', '图1_趋势.svg'), mkSvg('图一独有'))
  writeFileSync(join(proj, 'final', '图件', '图2_占比.svg'), mkSvg('图二独有'))
  run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.ok(existsSync(join(proj, 'final', '证据包', '图件', '图1_趋势.svg')), '证据包应收图件')
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  assert.match(view, /图件对账/)
  assert.match(view, /正文 \[图N\] 图位：2 个/)
  assert.match(view, /图件文件：2 个/)
  rmSync(join(proj, 'final', '图件', '图2_占比.svg'), { force: true })
  run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.match(readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8'), /缺图/, '缺图必须在视图里显式标出')
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ⑱：图件路径口径与「宣称的图件门」必须一致（注入旧路径须报错）', () => {
  const d = tmp()
  const repo = join(d, 'repo')
  mkdirSync(repo, { recursive: true })
  cpSync(join(ROOT, 'skills'), join(repo, 'skills'), { recursive: true })
  for (const f of ['package.json', 'CHANGELOG.md', 'cordis.patch.yml']) cpSync(join(ROOT, f), join(repo, f))
  const R = join(repo, 'skills', 'lunheng-article-pipeline')
  // ① 旧图件路径口径
  const t8 = join(R, 'references', 'agents', '08-终检-finalizer.md')
  writeFileSync(t8, readFileSync(t8, 'utf8') + '\n> 图件落在 `final/图N-标题.svg`。\n')
  // ② M 门计数漂移（把 14 项写回 13 项）
  const gl = join(R, 'references', 'glossary.md')
  writeFileSync(gl, readFileSync(gl, 'utf8').replace('M 门 14 项复核', 'M 门 13 项复核'))
  const r = run([join(R, 'scripts', 'consistency-check.mjs')])
  assert.equal(r.code, 1, '注入漂移后必须 exit 1')
  assert.match(r.out, /图件路径口径漂移/, '⑱ 必须捕获旧图件路径')
  assert.match(r.out, /口径残留 M 门总项数/, '⑥b 必须捕获 M 门计数漂移')
  rmSync(d, { recursive: true, force: true })
})
