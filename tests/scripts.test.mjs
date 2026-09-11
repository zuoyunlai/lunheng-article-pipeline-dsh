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
  assert.equal(j.total, 19, '脚本机械项应为 19 项（M-Form 1-11 + M-Exist 1-7 + M-Integrity-1）')
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
  // ② M 门计数漂移（把 20 项写回 13 项）
  const gl = join(R, 'references', 'glossary.md')
  writeFileSync(gl, readFileSync(gl, 'utf8').replace('M 门 20 项复核', 'M 门 13 项复核'))
  const r = run([join(R, 'scripts', 'consistency-check.mjs')])
  assert.equal(r.code, 1, '注入漂移后必须 exit 1')
  assert.match(r.out, /图件路径口径漂移/, '⑱ 必须捕获旧图件路径')
  assert.match(r.out, /口径残留 M 门总项数/, '⑥b 必须捕获 M 门计数漂移')
  rmSync(d, { recursive: true, force: true })
})

// ===== v2.5.2-dsh.17：交接契约 / 占位符 / 版本化报告 =====

test('build-evidence-bundle：版本化报告取最大版本（旧版硬编码 -v1.md → 修订轮报告不进证据包）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  mkdirSync(join(proj, 'audits'), { recursive: true })
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01][D01]。\n')
  // 只放 v2（不放 v1）——旧版会全部漏收
  writeFileSync(join(proj, 'analysis', '批判报告-v2.md'), '# 批判报告 v2\n')
  writeFileSync(join(proj, 'audits', '审计报告-v2.md'), '# 审计报告 v2\n')
  writeFileSync(join(proj, 'audits', '复核报告-v2.md'), '# 复核报告 v2\n')
  writeFileSync(join(proj, 'audits', 'G14-检测报告-v2.md'), '# G14 v2\n')
  writeFileSync(join(proj, 'drafts', '修订说明-v2.md'), '# 修订说明 v2\n')
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 0)
  for (const f of ['批判报告-v2.md', '审计报告-v2.md', '复核报告-v2.md', 'G14-检测报告-v2.md', '修订说明-v2.md']) {
    assert.ok(existsSync(join(proj, 'final', '证据包', f)), `证据包应收到 ${f}（取最大版本）`)
  }
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  assert.match(view, /审计报告v2✓/, '视图应显示实际版本号')
  assert.match(view, /G14-检测报告v2✓/, 'G14 报告应被收录并显示')
  // 有多个版本时取最大（不取 v1）
  writeFileSync(join(proj, 'audits', '审计报告-v1.md'), '# 审计报告 v1（旧）\n')
  run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.ok(existsSync(join(proj, 'final', '证据包', '审计报告-v2.md')), '存在 v1 时仍应取 v2')
  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：无修订轮时复核报告标 N/A 而非虚假 ✗（旧版恒定虚假告警）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  assert.match(view, /复核报告: N\/A\(无修订轮\)/, '无修订轮应标 N/A（不报 ✗）')
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ④b+⑲：占位符残留 / 版本硬编码 / 契约表断链都必须报（注入验证）', () => {
  const d = tmp()
  const repo = join(d, 'repo')
  mkdirSync(repo, { recursive: true })
  cpSync(join(ROOT, 'skills'), join(repo, 'skills'), { recursive: true })
  for (const f of ['package.json', 'CHANGELOG.md', 'cordis.patch.yml']) cpSync(join(ROOT, f), join(repo, f))
  const R = join(repo, 'skills', 'lunheng-article-pipeline')
  // ① 占位符残留
  const t5 = join(R, 'references', 'agents', '05-写作-writer.md')
  writeFileSync(t5, readFileSync(t5, 'utf8') + '\n> 校验方式：（命令已剥离·DSH 用 read 推理）\n')
  // ② 版本化报告写死 -v1.md
  const be = join(R, 'scripts', 'build-evidence-bundle.mjs')
  writeFileSync(be, readFileSync(be, 'utf8').replace('const LATEST_REPORTS = [', "const LEGACY = ['audits/审计报告-v1.md'];\nconst LATEST_REPORTS = ["))
  // ③ 契约表：产出者不再声明复核报告
  const t7 = join(R, 'references', 'agents', '07-审计-auditor.md')
  writeFileSync(t7, readFileSync(t7, 'utf8').replaceAll('复核报告', 'X报告'))
  const r = run([join(R, 'scripts', 'consistency-check.mjs')])
  assert.equal(r.code, 1, '注入后必须 exit 1')
  assert.match(r.out, /占位符残留/, '④b 必须捕获「命令已剥离」残留')
  assert.match(r.out, /版本硬编码/, '⑲ 必须捕获 -v1.md 硬编码')
  assert.match(r.out, /契约表：产出者未声明/, '⑲ 必须捕获产出者未声明')
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ⑳+⑥b：M 门文档节头项数 / 编号跳号 / 文档↔脚本不一致都必须报（注入验证）', () => {
  const mkRepo = () => {
    const d = tmp()
    const repo = join(d, 'repo')
    mkdirSync(repo, { recursive: true })
    cpSync(join(ROOT, 'skills'), join(repo, 'skills'), { recursive: true })
    for (const f of ['package.json', 'CHANGELOG.md', 'cordis.patch.yml']) cpSync(join(ROOT, f), join(repo, f))
    return { d, R: join(repo, 'skills', 'lunheng-article-pipeline') }
  }
  const GA = ['references', '_shared', 'M-Gate-Algorithm.md']

  // ① 已知漂移形态：节头括注写 10 项，节内已 11 个 ### 子节，且括注带「，含 …」说明
  //    ——这正是 ⑥b 首版正则（要求「项」紧跟右括号）静默漏检、⑳ 必须抓住的形态
  {
    const { d, R } = mkRepo()
    const p = join(R, ...GA)
    writeFileSync(p, readFileSync(p, 'utf8').replace('## M-Form 形式合规门（11 项，含', '## M-Form 形式合规门（10 项，含'))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    assert.equal(r.code, 1, '节头项数过期必须 exit 1')
    assert.match(r.out, /M 门文档自洽/, '⑳ 必须按节内 ### 子节数抓出节头过期')
    assert.match(r.out, /括注项数/, '⑥b 放宽后的中文括注规则也必须命中带说明的写法')
    rmSync(d, { recursive: true, force: true })
  }
  // ①b dsh.17 三次收紧的写法：「M 门 N 项中 M 项已脚本化」与「**N 项**：M-Form 1-」
  {
    const { d, R } = mkRepo()
    const ag = join(R, 'AGENTS.md')
    writeFileSync(ag, readFileSync(ag, 'utf8').replace('M 门 20 项中 19 项已脚本化', 'M 门 20 项中 14 项已脚本化'))
    const fin = join(R, 'references', 'agents', '08-终检-finalizer.md')
    writeFileSync(fin, readFileSync(fin, 'utf8').replace('（**19 项**：M-Form 1-', '（**15 项**：M-Form 1-'))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    assert.equal(r.code, 1, '旧写法漂移必须 exit 1')
    assert.match(r.out, /已脚本化项数/, '⑥b 必须捕获「N 项中 M 项已脚本化」写法')
    assert.match(r.out, /「\*\*N 项\*\*：M-Form 1-」写法/, '⑥b 必须捕获「**N 项**：M-Form 1-」写法')
    rmSync(d, { recursive: true, force: true })
  }
  // ② 编号跳号（把 M-Exist-3 改名成 M-Exist-9 → 1,2,9,4,5,6,7 非连续）
  {
    const { d, R } = mkRepo()
    const p = join(R, ...GA)
    writeFileSync(p, readFileSync(p, 'utf8').replace('### M-Exist-3:', '### M-Exist-9:'))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    assert.equal(r.code, 1, '编号跳号必须 exit 1')
    assert.match(r.out, /M 门编号跳号/, '⑳ 必须抓出子节编号不连续')
    rmSync(d, { recursive: true, force: true })
  }
  // ③ 文档与脚本加项不同步（文档删掉 M-Form-11 节体标题 → 文档 10 ≠ 脚本 11）
  {
    const { d, R } = mkRepo()
    const p = join(R, ...GA)
    writeFileSync(p, readFileSync(p, 'utf8').replace('### M-Form-11: 素材按需加载闭环（v2.5.2-dsh.17 新增）', '### 素材按需加载闭环（v2.5.2-dsh.17 新增）'))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    assert.equal(r.code, 1, '文档↔脚本不同步必须 exit 1')
    assert.match(r.out, /M 门文档↔脚本不一致/, '⑳ 必须抓出「文档项数 ≠ 脚本 gate 标签数」')
    rmSync(d, { recursive: true, force: true })
  }
  // ④ 节头漏写项数（口径无从派生）— M-Integrity 括注必须按「脚本 1 项 + 人工门 1 项 = 2 项」判，不得误报
  {
    const { d, R } = mkRepo()
    const p = join(R, ...GA)
    writeFileSync(p, readFileSync(p, 'utf8').replace('## M-Integrity 阶段闸门（2 项，含 v2.2.4 修订轮流程约束）', '## M-Integrity 阶段闸门'))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    assert.equal(r.code, 1, '节头缺项数必须 exit 1')
    assert.match(r.out, /节头缺项数/, '⑳ 必须抓出节头未写「（N 项）」')
    assert.doesNotMatch(r.out, /M-Integrity 括注项数/, 'M-Integrity 括注应期望 2 项（含主控人工门），不得误报')
    rmSync(d, { recursive: true, force: true })
  }
})

test('consistency-check ⑳：真源仓库自身必须自洽（M-Form 11 / M-Exist 7 / M-Integrity 2 == 节内子节数）', () => {
  const SK = join(ROOT, 'skills', 'lunheng-article-pipeline')
  const ga = readFileSync(join(SK, 'references', '_shared', 'M-Gate-Algorithm.md'), 'utf8')
  const secs = {}
  let cur = null
  for (const l of ga.split('\n')) {
    const h = l.match(/^## M-(Form|Exist|Integrity)\b/)
    if (h) { cur = h[1]; secs[cur] = { declared: Number((l.match(/（(\d+)\s*项/) || [])[1]), subs: [] }; continue }
    const s = l.match(/^### M-(?:Form|Exist|Integrity)-\d+:/)
    if (s && cur) secs[cur].subs.push(s[0])
  }
  assert.equal(secs.Form.declared, 11, 'M-Form 节头应写 11 项')
  assert.equal(secs.Form.subs.length, 11, 'M-Form 应有 11 个 ### 子节')
  assert.equal(secs.Exist.declared, 7, 'M-Exist 节头应写 7 项')
  assert.equal(secs.Exist.subs.length, 7, 'M-Exist 应有 7 个 ### 子节')
  assert.equal(secs.Integrity.declared, 2, 'M-Integrity 节头应写 2 项')
  assert.equal(secs.Integrity.subs.length, 2, 'M-Integrity 应有 2 个 ### 子节')
})

test('m-gate-check M-Form-11：素材按需加载闭环（引了没读 / 幽灵编号 / 无留痕必须报；齐备则过）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01] 与 [L02]。\n\n## 参考文献\n\n[L01] x\n[L02] y\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 📇 索引段\n\n[L01] a ｜ 主题 ｜ 论点1\n[L02] b ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [L01] a\n信任级别：已发布\n\n### [L02] b\n信任级别：已发布\n')
  writeFileSync(join(proj, 'drafts', '初稿-v2.md'), '# 初稿 v2\n')
  const LIST = join(proj, 'analysis', '素材加载清单.md')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Form-11'))
  }
  // ① 正文有引用但无留痕 → P1（「按需加载」无从核对）
  let it = item()
  assert.equal(it.pass, false, '缺加载清单必须报')
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /无 analysis\/素材加载清单\.md|无.*加载清单/)

  // ② 留痕只记了 L01 → L02 属「引了没读」→ 硬问题
  writeFileSync(LIST, '# 素材加载清单\n\n- **对应正文版本**：v2\n\n## 已加载\n\n| 编号 | 支撑位置 |\n|---|---|\n| [L01] | §1 |\n')
  it = item()
  assert.equal(it.pass, false, '引了没读必须报')
  assert.match(it.detail, /引了没读|未记「已加载」/)
  assert.match(it.detail, /\[L02\]/)

  // ③ 清单里有卡片查不到的编号（幽灵）→ 硬问题
  writeFileSync(LIST, '# 素材加载清单\n\n- **对应正文版本**：v2\n\n## 已加载\n\n| 编号 | 支撑位置 |\n|---|---|\n| [L01] | §1 |\n| [L02] | §1 |\n| [L09] | §2 |\n')
  it = item()
  assert.equal(it.pass, false, '幽灵编号必须报')
  assert.match(it.detail, /无对应条目/)
  assert.match(it.detail, /\[L09\]/)

  // ④ 齐备 → 通过（读了不用只算软提示；「已跳过」段的编号不计入加载集）
  writeFileSync(LIST, '# 素材加载清单\n\n- **对应正文版本**：v2\n\n## 已加载\n\n| 编号 | 支撑位置 |\n|---|---|\n| [L01] | §1 |\n| [L02] | §1 |\n\n## 已跳过\n\n| 编号 | 理由 |\n|---|---|\n| [L07] | 口径不符 |\n')
  it = item()
  assert.equal(it.pass, true, '留痕齐备应通过：' + it.detail)
  assert.match(it.detail, /引用 ⊆ 已加载/)

  // ⑤ 「已加载」段标题缺失 → 硬问题（机检无从定位加载集）
  writeFileSync(LIST, '# 素材加载清单\n\n| 编号 | 支撑位置 |\n|---|---|\n| [L01] | §1 |\n')
  it = item()
  assert.equal(it.pass, false, '缺「## 已加载」段必须报')
  assert.match(it.detail, /已加载.*段标题|缺「## 已加载」/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-5：闸门记录表（漏项 / 自述当实据 / ✗ 无原因 / 与 M 门报告矛盾必须报）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  const aud = join(proj, 'audits')
  mkdirSync(ev, { recursive: true })
  mkdirSync(aud, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(aud, '审计报告-v1.md'), '# 审计报告 v1\n\n结论：通过 ✅\n')
  const SK = join(ROOT, 'skills', 'lunheng-article-pipeline')
  const tpl = readFileSync(join(SK, 'references', 'templates', '闸门记录-template.md'), 'utf8')
  const itemsOf = (gate) => {
    const seg = tpl.split(new RegExp(`^## ${gate.replace('.', '\\.')}`, 'm'))[1].split(/^## /m)[0]
    return seg.split('\n').filter((l) => /^\s*\|/.test(l)).slice(2).map((l) => l.split('|')[1].trim()).filter(Boolean)
  }
  const build = (gate, evTxt = 'final/证据包/数据卡.md', res = '✓', why = '') =>
    `# 闸门记录 ${gate}\n\n| 检查项 | 实据（路径 / exit code） | 结论 | 失败原因 |\n|---|---|---|---|\n`
    + itemsOf(gate).map((i) => `| ${i} | ${evTxt} | ${res} | ${why} |`).join('\n') + '\n'
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-5'))
  }
  // ① 两表单齐备 + 实据为路径 → 通过
  writeFileSync(join(aud, '闸门记录-T2.5.md'), build('T2.5'))
  writeFileSync(join(aud, '闸门记录-T7.5.md'), build('T7.5'))
  let it = item()
  assert.equal(it.pass, true, '闸门记录齐备应通过：' + it.detail)
  assert.match(it.detail, /T2\.5 \d+ 行|T7\.5 \d+ 行/)

  // ② 漏检查项（删掉模板里的第一项那行）→ 硬问题
  const bad = build('T2.5').split('\n').filter((l) => !l.includes(itemsOf('T2.5')[0])).join('\n')
  writeFileSync(join(aud, '闸门记录-T2.5.md'), bad + '\n')
  it = item()
  assert.equal(it.pass, false, '漏检查项必须报')
  assert.match(it.detail, /检查项缺「/)

  // ③ 实据写「已检查」自述 → 硬问题（闸门留机械证据）
  writeFileSync(join(aud, '闸门记录-T2.5.md'), build('T2.5', '已检查'))
  it = item()
  assert.equal(it.pass, false, '自述当实据必须报')
  assert.match(it.detail, /不是机械证据/)

  // ④ 判 ✗ 但没写失败原因 → 硬问题
  writeFileSync(join(aud, '闸门记录-T2.5.md'), build('T2.5', 'final/证据包/数据卡.md', '✗', ''))
  it = item()
  assert.equal(it.pass, false, '✗ 无原因必须报')
  assert.match(it.detail, /未写失败原因/)

  // ⑤ T7.5 全判 ✓，但 M-Gate-Report.json exit=2 → P0 自相矛盾
  writeFileSync(join(aud, '闸门记录-T2.5.md'), build('T2.5'))
  writeFileSync(join(fin, 'M-Gate-Report.json'), JSON.stringify({ exit: 2, total: 19 }))
  it = item()
  assert.equal(it.severity, 'P0', '闸门与报告矛盾应 P0：' + it.detail)
  assert.match(it.detail, /自相矛盾/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-6：审稿报告评分与期刊匹配（总分≠分项和 / 综合不可复算 / 杜撰刊名）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  const aud = join(proj, 'audits')
  mkdirSync(ev, { recursive: true })
  mkdirSync(aud, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n启用期刊匹配\n')
  const REP = join(aud, '审稿报告-v2.md')
  const mk = (total, dims, rows) => `# 同行评审报告\n\n> **总评分**：${total}/30\n> **建议**：minor revision\n\n`
    + '| 维度 | 得分 | 一句话评价 |\n|------|------|-----------|\n'
    + ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范'].map((x, i) => `| ${x} | ${dims[i]}/5 | 好 |`).join('\n')
    + `\n| **总分** | **${total}/30** | **minor revision** |\n\n判定：minor revision\n\n`
    + '| 目标方向 | 综合匹配度 | 主题契合 | 风格契合 | 审稿周期 | 推荐理由 |\n|---------|-----------|---------|---------|---------|---------|\n' + rows + '\n'
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-6'))
  }
  // ① 无审稿报告 → N/A
  let it = item()
  assert.equal(it.pass, true, '无审稿报告应记 N/A')
  assert.match(it.detail, /N\/A/)

  // ② 总分 = 分项和（24）+ 综合按公式复算（0.5×90+0.3×80+0.2×57.14 = 80.43 → 80）→ 通过
  writeFileSync(REP, mk(24, [4, 4, 4, 4, 4, 4], [
    '| 《管理世界》 | 80% | 90% | 80% | 3-6 月 | 主题契合高 + 风格偏实证 + 周期可控 |',
    '| 《中国工业经济》 | 78% | 85% | 80% | 4-8 月 | 主题契合同类 + 风格一致 + 周期适中 |',
    '| 《南开管理评论》 | 77% | 80% | 85% | 3-6 月 | 风格贴近 + 主题部分契合 + 周期友好 |',
  ].join('\n')))
  it = item()
  assert.equal(it.pass, true, '评分自洽 + 期刊可复算应通过：' + it.detail)
  assert.match(it.detail, /期刊表 3 行/)

  // ③ 总分 ≠ 分项之和 → 硬问题（评分表与总分自相矛盾）
  writeFileSync(REP, mk(27, [4, 4, 4, 4, 4, 4], '| 《管理世界》 | 84% | 90% | 80% | 3-6 月 | 主题契合高 + 风格偏实证 + 周期可控 |'))
  it = item()
  assert.equal(it.pass, false, '总分与分项和不符必须报')
  assert.match(it.detail, /≠ 6 维之和/)

  // ④ 综合匹配度不可复算 → 硬问题
  writeFileSync(REP, mk(24, [4, 4, 4, 4, 4, 4], '| 《管理世界》 | 95% | 90% | 80% | 3-6 月 | 主题契合高 + 风格偏实证 + 周期可控 |'))
  it = item()
  assert.equal(it.pass, false, '数字不可复算必须报')
  assert.match(it.detail, /不可复算/)

  // ⑤ 杜撰刊名（不在 期刊数据库.md 中）→ 软提示
  writeFileSync(REP, mk(24, [4, 4, 4, 4, 4, 4], '| 《某虚构学报》 | 80% | 90% | 80% | 3-6 月 | 主题契合高 + 风格偏实证 + 周期可控 |'))
  it = item()
  assert.match(it.detail, /查不到|杜撰/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-7：交付说明 12 固定字段（缺字段 / 空字段 / 缺指纹 / 决策记录漏门必须报）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const DD = join(fin, '交付说明.md')
  const GOOD = `# 交付说明

## 1. 路径

| 项 | 路径 |
|----|------|
| 定稿 | final/定稿.md |

## 2. 图件清单

| 图号 | 标题 | 来源 |
|------|------|------|
| 图1 | 趋势 | [D01] |

## 3. 遗留风险

- 无

## 4. 人工核验项

- 无

## 5. 数据溯源 check-list

- [ ] 付费墙文献：无

## 6. 成本指标

- token：1.2M

## 7. 建议 merge 的反哺清单

- [ ] 反哺规则 A → 05 卡

## 8. AI 使用披露（完整版）

- AI 生成段：全文初稿

## 9. 证据包指纹

- sha256：\`[哈希校验待主人回填]\`

## 10. 投稿就绪检查表

- 推荐期刊：见审稿报告

## 11. 主人决策记录

- 四门时间线：Phase 0 09:12 通过｜Phase 2.5 10:05 通过｜Phase 3.5 10:40 通过｜Phase 5 11:20 通过

## 12. 终检结论

- M 门 exit = 0
`
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-7'))
  }
  // ① 无交付说明 → N/A
  let it = item()
  assert.equal(it.pass, true, '无交付说明应记 N/A')
  assert.match(it.detail, /N\/A/)

  // ② 12 字段齐备 → 通过
  writeFileSync(DD, GOOD)
  it = item()
  assert.equal(it.pass, true, '字段齐备应通过：' + it.detail)
  assert.match(it.detail, /11\/11/)
  assert.match(it.detail, /指纹✓/)

  // ③ 缺「成本指标」字段 → 硬问题
  writeFileSync(DD, GOOD.replace('## 6. 成本指标\n\n- token：1.2M\n\n', ''))
  it = item()
  assert.equal(it.pass, false, '缺固定字段必须报')
  assert.match(it.detail, /缺固定字段「成本指标」/)

  // ④ 字段只剩模板占位符 → 硬问题
  writeFileSync(DD, GOOD.replace('- token：1.2M', '- token：<待填>'))
  it = item()
  assert.equal(it.pass, false, '占位符未填必须报')
  assert.match(it.detail, /占位符/)

  // ⑤ 主人决策记录漏 Phase 3.5 → 硬问题（缺回填须显式标「未留痕」）
  writeFileSync(DD, GOOD.replace('Phase 0 09:12 通过｜Phase 2.5 10:05 通过｜Phase 3.5 10:40 通过｜Phase 5 11:20 通过', 'Phase 0 09:12 通过｜Phase 2.5 10:05 通过｜Phase 5 11:20 通过'))
  it = item()
  assert.equal(it.pass, false, '决策记录漏门必须报')
  assert.match(it.detail, /未覆盖/)
  rmSync(d, { recursive: true, force: true })
})

test('cordis.patch.yml：三档 agentOptions 表达式形态正确（未设=undefined，只给 model 亦生效，含一键退路）', () => {
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
  const exprs = [...patch.matchAll(/agentOptions:\s*!!js\s+"(.+?)"\s*$/gm)].map((m) => m[1])
  assert.equal(exprs.length, 3, '应恰有三档 agentOptions 表达式（检索/强推理/审计）')
  const evalWith = (expr, env) => new Function('process', `return (${expr})`)({ env })
  // ① 全未设 → undefined（**不得传 {}**：空对象会触发 provider 的 agentOptions 能力门）
  for (const e of exprs) assert.equal(evalWith(e, {}), undefined, '未设任何 env 时必须为 undefined（全继承）')
  // ② 只给 model → {model}（字段独立：provider 由宿主逐字段继承父级）
  assert.deepEqual(evalWith(exprs[0], { LUNHENG_RETRIEVAL_MODEL: 'X' }), { model: 'X' }, '只给 model 必须生效')
  // ③ 只给 provider → {provider}
  assert.deepEqual(evalWith(exprs[0], { LUNHENG_RETRIEVAL_PROVIDER: 'P' }), { provider: 'P' })
  // ④ 两者都给
  assert.deepEqual(evalWith(exprs[0], { LUNHENG_RETRIEVAL_PROVIDER: 'P', LUNHENG_RETRIEVAL_MODEL: 'X' }), { provider: 'P', model: 'X' })
  // ⑤ 一键退路 LUNHENG_TIERING=off（即便其它变量已设）
  assert.equal(evalWith(exprs[0], { LUNHENG_TIERING: 'off', LUNHENG_RETRIEVAL_PROVIDER: 'P', LUNHENG_RETRIEVAL_MODEL: 'X' }), undefined, 'kill switch 必须压过其它变量')
  // ⑥ 红线复核：表达式内不得出现被禁标识符
  for (const e of exprs) {
    assert.ok(!/require\(|import\(|eval\(|fs\.|node:|child_process|getBuiltinModule|new Function/.test(e), '分档表达式不得含被禁标识符：' + e.slice(0, 60))
  }
  // ⑦ 不得再写死厂商默认模型（宿主无模型级回退，写错 = 该档不可用）
  for (const bad of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
    assert.ok(!patch.includes(bad), `cordis.patch.yml 不得硬编码厂商默认模型 ${bad}——应由 model-routing.mjs 按本机实况生成`)
  }
})

test('model-routing.mjs：按本机 settings.yaml 给档位建议，且跨 provider 时同时输出 _PROVIDER', () => {
  const d = tmp()
  const home = join(d, 'dshhome')
  mkdirSync(home, { recursive: true })
  // 夹具：默认 provider 有两个模型（高/低版本），另有一个本地 provider
  writeFileSync(join(home, 'settings.yaml'), [
    'agent-default-model:',
    '  provider: cloud-x',
    '  model: X-Pro-3',
    'llm-pi-ai:',
    '  providers:',
    '    cloud-x:',
    '      displayName: Cloud X',
    '      baseURL: https://api.example.com/v1',
    '      models:',
    '        - id: X-Pro-3',
    '          contextWindow: 200000',
    '        - id: X-Mini-1',
    '          contextWindow: 32000',
    '    local-y:',
    '      baseURL: http://127.0.0.1:11434/v1',
    '      models:',
    '        - id: y-qwen:14b',
    '          contextWindow: 32000',
    '',
  ].join('\n'))
  const r = run([join(SCRIPTS, 'model-routing.mjs'), '--dsh-home', home, '--no-probe', '--json'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const j = parseJson(r)
  const byTier = Object.fromEntries(j.routing.map((x) => [x.tier, x]))
  assert.ok(byTier.retrieval.pick, '检索档应有候选')
  assert.ok(byTier.audit.pick, '审计档应有候选')
  assert.equal(byTier.audit.pick, 'X-Pro-3', '批判审计档应选同族高版本强模型')
  assert.equal(byTier.strong.pick, 'X-Pro-3', '分析写作档应选强推理模型')
  // 主人指定的四档表：T6 属批判审计档；T9 亦归此档（推断）；T8 不适用；T0 不参与路由
  assert.ok(byTier.audit.roles.some((x) => x.startsWith('T6')), 'T6 批判必须在批判审计档（主人指定表）')
  assert.ok(byTier.audit.roles.some((x) => x.startsWith('T9')), 'T9 审稿归批判审计档（主人确认）')
  assert.ok(byTier.audit.roles.some((x) => x.startsWith('G14')), 'G14 检测归批判审计档（主人确认）')
  assert.ok(byTier.strong.roles.some((x) => x.startsWith('T4')) && byTier.strong.roles.some((x) => x.startsWith('T5')), '分析写作档 = T4/T5')
  assert.match(j.t8.strategy, /不适用/, 'T8 终检不适用分档')
  assert.ok(j.t0.suggest, '主控档应给稳定性建议（但不由论衡自动改宿主配置）')
  assert.match(j.t0.strategy, /不参与分档路由/, '主控不参与路由')
  // **检索档默认「本地优先 + 远程兜底」**：--no-probe 下本地视为可用 → 主选本地、兜底为远端
  assert.match(byTier.retrieval.pick, /qwen/, '检索档默认应本地优先')
  assert.equal(byTier.retrieval.pickLocal, true, '检索档主选应为本地模型')
  assert.equal(byTier.retrieval.crossProvider, true, '本地模型属另一 provider → 必须标记跨 provider')
  assert.ok(byTier.retrieval.fallback && byTier.retrieval.fallback.local === false, '本地主选必须带**远端兜底**')
  assert.ok(j.envSnippet.powershell.some((l) => l.includes('LUNHENG_RETRIEVAL_PROVIDER')), '跨 provider 必须同时输出 _PROVIDER')
  assert.equal(byTier.audit.pickLocal, false, '批判审计档不得用本地小模型')
  // --prefer-remote：忽略本地优先（主人显式选择「不用本地」）
  const r2 = run([join(SCRIPTS, 'model-routing.mjs'), '--dsh-home', home, '--no-probe', '--prefer-remote', '--json'])
  const j2 = parseJson(r2)
  const t2 = Object.fromEntries(j2.routing.map((x) => [x.tier, x]))
  assert.equal(t2.retrieval.pickLocal, false, '--prefer-remote 时检索档不得选本地')
  assert.equal(t2.retrieval.crossProvider, false, '同 provider 匹配 → 不输出 _PROVIDER')
  assert.equal(t2.audit.pick, 'X-Pro-3', '审计档不受 --prefer-remote 影响')
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-10：索引段缺条必须报（下游按索引定位会漏卡），索引齐则通过', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const lit = join(ev, '文献卡.md')
  // 正文 2 条、索引只有 1 条 → 索引缺 L02
  writeFileSync(lit, '# 文献卡\n\n## 📇 索引段\n\n[L01] Coleman 1988 ｜ 社会资本 ｜ 论点1\n\n## 正文分组\n\n### [L01] Coleman\n信任级别：已发布\n\n### [L02] Putnam\n信任级别：已发布\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 📇 索引段\n\n[D01] 数值 86 万 ｜ 来源 ｜ 论点1\n\n## 正文\n\n### [D01] 某公报\n信任级别：已发布\n')
  const gate = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Form-10'))
  }
  let item = gate()
  assert.equal(item.pass, false, '索引缺条必须失败')
  assert.equal(item.severity, 'P1', item.detail)
  assert.match(item.detail, /索引段缺 1 条/, '必须指名缺哪条：' + item.detail)
  assert.match(item.detail, /L02/)
  // 补齐索引 → 通过（案例卡缺失只记备注，不判失败——0 条场景合法）
  writeFileSync(lit, readFileSync(lit, 'utf8').replace('[L01] Coleman 1988 ｜ 社会资本 ｜ 论点1', '[L01] Coleman 1988 ｜ 社会资本 ｜ 论点1\n[L02] Putnam 1995 ｜ 公民参与 ｜ 论点1'))
  item = gate()
  assert.equal(item.pass, true, '索引补齐后应通过：' + item.detail)
  assert.match(item.detail, /未找到/, '缺卡只作备注')
  // 索引悬空 + 头部声明不符 → 硬/软问题
  writeFileSync(lit, readFileSync(lit, 'utf8').replace('# 文献卡', '# 文献卡\n\n> 合计 5 条').replace('[L02] Putnam 1995 ｜ 公民参与 ｜ 论点1', '[L99] 悬空'))
  item = gate()
  assert.equal(item.pass, false, '头部声明与悬空必须报')
  assert.match(item.detail, /头部声明 5 条 ≠ 正文条目 2 条/)
  assert.match(item.detail, /L99/)
  // 三张卡都没有 → N/A
  rmSync(lit, { force: true })
  rmSync(join(ev, '数据卡.md'), { force: true })
  item = gate()
  assert.equal(item.pass, true, '无卡应记 N/A 而非失败')
  assert.match(item.detail, /N\/A/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-4：修订任务书结构 + 审计↔复核编号闭环 + 初轮不得预填「已关闭」', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  const aud = join(proj, 'audits')
  mkdirSync(ev, { recursive: true })
  mkdirSync(aud, { recursive: true })
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-4'))
  }
  const AUD = join(aud, '审计报告-v1.md')
  const REV = join(aud, '复核报告-v1.md')
  const HEAD = '| 编号 | 严重度 | 改哪里（文件+位置） | 怎么改（具体动作） | 验收标准 | 关闭状态 |\n|---|---|---|---|---|---|\n'
  const ROW = (id, st) => `| ${id} | P1 | 初稿.md §三第 2 段 | 补 [L01] 支撑该论点 | 该段含 [L01] 且 M-Form-8 通过 | ${st} |\n`

  // ① 无审计报告 → N/A（不判失败）
  let it = item()
  assert.equal(it.pass, true, '无审计报告应记 N/A')
  assert.match(it.detail, /N\/A/)

  // ② 打回 + 完整任务书（待复核）+ 复核报告覆盖 → 通过
  writeFileSync(AUD, `# 审计报告 v1\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${HEAD}${ROW('P0-1', '待复核')}${ROW('P1-1', '待复核')}`)
  writeFileSync(REV, '# 复核报告 v1\n\n| 原条目编号 | 判定 | 依据 |\n|---|---|---|\n| P0-1 | ✓已关闭 | 修订说明 §2 |\n| P1-1 | ✓已关闭 | 头部已清理 |\n')
  it = item()
  assert.equal(it.pass, true, '完整任务书 + 复核覆盖应通过：' + it.detail)
  assert.match(it.detail, /闭环成立/)

  // ③ 初轮（无复核报告）预填「已关闭」→ 硬问题
  rmSync(REV, { force: true })
  writeFileSync(AUD, `# 审计报告 v1\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${HEAD}${ROW('P0-1', '已关闭')}`)
  it = item()
  assert.equal(it.pass, false, '未复核就宣称已关闭必须报')
  assert.match(it.detail, /尚未有复核报告|尚无复核报告|真源是复核报告/)

  // ④ 编号重复 + 位置列空缺 → 硬问题
  writeFileSync(AUD, `# 审计报告 v1\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${HEAD}${ROW('P1-1', '待复核')}| P1-1 | P1 |  |  |  | 待复核 |\n`)
  it = item()
  assert.equal(it.pass, false)
  assert.match(it.detail, /编号重复|空缺/)

  // ⑤ 已有修订说明但缺复核报告 → 硬问题（复核必须落盘）
  writeFileSync(join(proj, 'drafts', '修订说明-v1.md'), '# 修订说明 v1\n')
  writeFileSync(AUD, `# 审计报告 v1\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${HEAD}${ROW('P1-1', '待复核')}`)
  it = item()
  assert.equal(it.pass, false, '有修订说明但无复核报告必须报')
  assert.match(it.detail, /复核报告/)

  // ⑥ 结论「通过」→ 无需任务书，也不因缺复核报告而失败
  writeFileSync(AUD, '# 审计报告 v1\n\n结论：通过 ✅（剩余风险：付费墙文献仅核验摘要）\n')
  it = item()
  assert.equal(it.pass, true, '结论通过时无需任务书：' + it.detail)
  assert.match(it.detail, /无需任务书/)
  rmSync(d, { recursive: true, force: true })
})

test('主人侧三件套与输入模板齐备，且确认单含回填段与 Phase 0 附加块（v2.5.2-dsh.17）', () => {
  const SK = join(ROOT, 'skills', 'lunheng-article-pipeline')
  const TPL = join(SK, 'references', 'templates')
  for (const f of ['进展-主人版-template.md', '主人投喂清单-template.md', 'style-baseline-template.md', '主人确认-template.md', '任务简报-template.md']) {
    const p = join(TPL, f)
    assert.ok(existsSync(p), `模板应存在: ${f}`)
    assert.ok(readFileSync(p, 'utf8').includes('版本：'), `${f} 应有版本头`)
  }
  // 确认单：四门 + 改动摘要 + §6 回复回填 + Phase 0 三块
  const sheet = readFileSync(join(TPL, '主人确认-template.md'), 'utf8')
  assert.match(sheet, /### 6\. 主人回复/, '必须含主人回复回填段（决策留痕）')
  assert.match(sheet, /Phase 0 附加块/, '必须含 Phase 0 附加块')
  assert.match(sheet, /本轮改动摘要/, '必须含改动摘要段')
  assert.match(sheet, /Phase 0（定题）/, '用途必须覆盖 Phase 0（四门）')
  assert.match(sheet, /资源预估/, 'Phase 0 块必须含资源预估')
  assert.match(sheet, /主人待办清单/, 'Phase 0 块必须含主人待办清单')
  // 投喂清单：4 项收货校验
  const feed = readFileSync(join(TPL, '主人投喂清单-template.md'), 'utf8')
  for (const k of ['路径存在且可读', '口径 / 范围 / 时间齐全', '可对外引用性明确', '脱敏与知情同意已确认']) {
    assert.ok(feed.includes(k), `投喂清单应含校验项: ${k}`)
  }
  // 契约表登记（防新产物游离在机检之外）
  const cs = readFileSync(join(SCRIPTS, 'consistency-check.mjs'), 'utf8')
  for (const k of ['进展-主人版', '阶段确认-', '主人投喂清单', 'style-baseline']) {
    assert.ok(cs.includes(`['${k}'`), `交接契约表应登记 ${k}`)
  }
  // 主控卡：四门 + 主人侧可见性
  const coord = readFileSync(join(SK, 'references', 'agents', '00-主控-coordinator.md'), 'utf8')
  assert.match(coord, /进展-主人版/, '主控卡应声明刷新进展（主人版）')
  assert.match(coord, /四个\*\*人在环节点|四个\*\*人在环节点|Phase 0（定题）/, '主控卡应把 Phase 0 计入人在环节点')
  // v2.5.2-dsh.17 续：模型路由表（模板存在 + 主控卡声明 + 契约表登记 + token-cost 帮助）
  assert.ok(existsSync(join(TPL, '模型路由表-template.md')), '模型路由表模板应存在')
  assert.match(coord, /模型路由表/, '主控卡应声明 Phase 0 落模型路由表')
  assert.ok(readFileSync(join(SCRIPTS, 'consistency-check.mjs'), 'utf8').includes("['模型路由表'"), '交接契约表应登记模型路由表')
  const help = run([join(SCRIPTS, 'token-cost.mjs'), '--help'])
  assert.equal(help.code, 0, 'token-cost --help 应 exit 0')
  assert.match(help.stdout, /--top N/, '帮助应列出 --top')
  const bogus = run([join(SCRIPTS, 'token-cost.mjs'), '--bogus'])
  assert.equal(bogus.code, 1, '未知参数应 exit 1')
  assert.match(bogus.out, /用法/, '未知参数应附打印用法（旧版只有一行报错）')
})
