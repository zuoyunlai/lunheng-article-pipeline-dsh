// 随包脚本回归测试（v2.5.2-dsh.13 新增）
// 每个用例对应一个「第三方审计发现、只能靠人工实测才暴露」的缺陷，防止复发。
// 运行：node --test tests/     （CI 在 ubuntu-latest 与 windows-latest 双平台跑）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD } from './_fixtures.mjs'

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

// v18.2.3（主人授权修订；依据 2026-09-12 全量测试后主人反问「字数限定仅指正文吗」的取证）：
//   `--summary` 曾用**含「摘要/关键词」的列表**求 body 终点 → 命中 `## 关键词` 即截断
//   → `body.hanChars` 只剩摘要正文（实测 243 vs 默认口径 5112，**差 21 倍**），
//   而脚本头注释写「--summary …（**T7/T8 一眼可见结构**）」→ T7/T8 照注释取用会把长文判成
//   「仅 4% 篇幅」并下达错误的 P0 精简指令。**单跑任一模式都自洽，只有跨路径对账能抓**。
test('count-chars：--summary 的 body.hanChars 必须等于默认口径（v18.2.3 跨路径对账）', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  // 该排布刻意复现「关键词把 body 截断」：摘要 → 关键词 → 正文 → 文末五节
  writeFileSync(f, [
    '# 标题', '', '## 摘要', '', '摘要正文若干字。', '',
    '## 关键词', '', '关键词若干；词二；词三', '',
    '## 一、导论', '', '正文段落若干字。'.repeat(20), '',
    '## 参考文献', '', '[L01] 某文献', '',
    '## 数据来源', '', '[D01] 某数据', '',
    '## 案例来源', '', '[C01] 某案例', '',
    '## 先行者文献', '', '[先01] 某先行者', '',
    '## AI 使用声明', '', 'AI 辅助声明若干字。', '',
  ].join('\n'))
  const def = parseJson(run([join(SCRIPTS, 'count-chars.mjs'), f]))
  const sum = parseJson(run([join(SCRIPTS, 'count-chars.mjs'), f, '--summary']))
  assert.equal(sum.body.hanChars, def.hanChars,
    `--summary body 必须与默认口径同源（默认 ${def.hanChars} vs summary ${sum.body.hanChars}）`)
  // 结构性佐证：body 必须**大于**摘要节（含关键词段 + 正文），旧版 bug 下 body == 摘要节
  assert.ok(sum.body.hanChars > sum.endnotes['摘要'],
    `body 应含关键词与正文（> 摘要节），实得 body=${sum.body.hanChars} / 摘要=${sum.endnotes['摘要']}`)
  // v18.2.3 附带修正：分节字数不再计入节标题自身的汉字（与 sectionsByHeading 口径统一）
  const kwByHeading = sum.sectionsByHeading.find((s) => s.title === '关键词')
  assert.equal(sum.endnotes['关键词'], kwByHeading.hanChars,
    'sections{} 与 sectionsByHeading 的口径必须一致（均不含标题）')
  rmSync(d, { recursive: true, force: true })
})

// v18.2.3（主人授权修订；依据版本抬升 18.2.2 → 18.2.3 后的实测复核）：
//   规则⑨ 旧实现**只核 4 个文件、且只比字节大小**（`statSync().size`），
//   而**版本头替换天生等长**（`v18.2.2` → `v18.2.3`）→ size 不变 → 完全看不见。
//   实测后果：镜像里 **44 个文件**内容已变（连 SKILL.md 版本头都是旧的），本门却输出
//   「0 处漂移」= **假绿**——而镜像正是运行时真正被加载的那一份。
//   本用例注入一处**等长内容差异**（中文句号 → 中文逗号，UTF-8 下同为 3 字节），
//   确保比对**不会退回 size 代理**。（断言不依赖基线退出码：只比对「注入前无该错误、注入后有」。）
test('consistency-check ⑨：.dsh 镜像与真源 size 相同但内容不同时，必须报「内容漂移」（v18.2.3）', () => {
  const { d, repo, R } = mkRepo()
  const dshSkill = join(d, '.dsh', 'skills', 'lunheng-article-pipeline')
  cpSync(R, dshSkill, { recursive: true })
  const cc = join(repo, 'skills', 'lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')

  // ① 基线：镜像与真源内容一致 → 不应出现 .dsh 同步错误
  const baseOut = run([cc]).out
  assert.doesNotMatch(baseOut, /\[P1 \.dsh 同步\]/, '内容一致时不应报 .dsh 同步错误：' + baseOut.slice(-400))

  // ② 只改镜像：中文句号 → 中文逗号（同为 3 字节 → 文件 size 不变）
  const repoFile = join(R, 'references', 'glossary.md')
  const dshFile = join(dshSkill, 'references', 'glossary.md')
  const before = readFileSync(dshFile, 'utf8')
  assert.ok(before.includes('。'), '夹具假设该文件含中文句号')
  const after = before.replace('。', '，')
  assert.equal(Buffer.byteLength(after), Buffer.byteLength(before), '注入必须等长，否则测不到 size 盲区')
  writeFileSync(dshFile, after)
  assert.equal(statSync(dshFile).size, statSync(repoFile).size, '注入后两边 size 必须仍然相同（这正是旧版漏检的条件）')

  // ③ 等长内容漂移 → 必须被报出（旧版只比 size 会静默通过）
  const badOut = run([cc]).out
  assert.match(badOut, /\[P1 \.dsh 同步\][^\n]*内容漂移/, '等长内容漂移必须报「内容漂移」：' + badOut.slice(-400))
  rmSync(d, { recursive: true, force: true })
})

// v18.2.4（主人指令「修」；第三方审计「门必须覆盖它声称覆盖的规范」）：补两类**实测漏检**的回归网。
// 为什么必须有：这两处此前**全靠人工记得刷**——门绿不等于版本点位齐，而「版本头替换天生等长」，
// 漂移在字节数上完全不可见（与 v18.2.3 修掉的 size 假绿同源）。两个用例都用「注入前不报 / 注入后必报」，
// 不依赖基线退出码，从而在「夹具恰好已漂移」时也不会假绿。
test('consistency-check ①/⑦ 补面：内联 `git tag vX.Y.Z` 与 package.json 不一致时必须报（v18.2.4 新增）', () => {
  const { d, repo } = mkRepo({ readme: true, extraFiles: ['CONTRIBUTING.md'] })
  const cc = join(repo, 'skills', 'lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')

  const base = run([cc]).out
  assert.doesNotMatch(base, /内联 tag 版本漂移/, '夹具基线不应报内联 tag 漂移：' + base.slice(-400))

  const p = join(repo, 'README.md')
  const before = readFileSync(p, 'utf8')
  const after = before.replace(/git tag v\d+\.\d+\.\d+/, 'git tag v18.0.4')
  assert.notEqual(after, before, '夹具假设 README.md 含 `git tag vX.Y.Z` 内联发布示例')
  writeFileSync(p, after)

  const bad = run([cc]).out
  assert.match(
    bad,
    /\[P1 内联 tag 版本漂移\]/,
    '内联 tag 版本漂移必须被报（旧的四条版本规则全跑在技能目录内、全都扫不到仓库根这 7 处）：' + bad.slice(-400),
  )
  // 负向：普通散文里的历史版本注记**不得**被误判（那些必须允许保留旧号）
  const prose = before.replace(/git tag v\d+\.\d+\.\d+/, 'git tag v18.0.4') + '\n<!-- 历史注记：v18.0.0 引入，v18.2.3 修订 -->\n'
  writeFileSync(p, prose)
  const bad2 = run([cc]).out
  assert.equal(
    (bad2.match(/内联 tag 版本漂移/g) || []).length,
    1,
    '应恰好只报内联 tag 那一处，散文里的历史注记不得连带命中：' + bad2.slice(-400),
  )
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ⑫：加粗版版本头 `> **版本**：vX.Y.Z` 漂移必须报（v18.2.4 新增）', () => {
  const { d, R } = mkRepo()
  const cc = join(R, 'scripts', 'consistency-check.mjs')

  const base = run([cc]).out
  assert.doesNotMatch(base, /版本点位漂移/, '夹具基线不应报版本点位漂移：' + base.slice(-400))

  const p = join(R, 'references', 'glossary.md')
  const before = readFileSync(p, 'utf8')
  // 旧正则 `[-*>#]*\s*版本：` 在标记与 `版本：` 之间不许夹 `**` → 加粗形态整条逃逸
  const after = before.replace(/^>\s*版本：v[\d.]+/m, '> **版本**：v18.0.0')
  assert.notEqual(after, before, '夹具假设 glossary.md 首行是 `> 版本：vX.Y.Z`')
  writeFileSync(p, after)

  const bad = run([cc]).out
  assert.match(
    bad,
    /\[P0 版本点位漂移\][^\n]*glossary\.md/,
    '加粗版版本头漂移必须被报（旧正则漏检，实测该形态一直是人工刷的）：' + bad.slice(-400),
  )
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
  const { d, proj, fin, ev } = mkProject()
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
  // --source 指向不存在文件：必须 exit 10，且不得先把证据包复制一半（先于成功运行断言，防被前一次的产物干扰）
  // v18.0.2：参数/路径错统一 10（旧断言为 2 —— 与「P0 致命」撞码，已随退出码统一而更新）
  const bad = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary', '--source', 'nope.md'])
  assert.equal(bad.code, 10, '--source 缺失应 exit 10（v18.0.2 起路径/参数错一律 10）')
  assert.ok(!existsSync(join(proj, 'final', '证据包')), '不得先复制证据包再报错（fail fast）')
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 0)
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  assert.match(view, /无正文源/, '无正文时必须显式标注，不得留空结构冒充')
  assert.match(view, /素材卡数量/, '素材段必须在（T4 分析/Phase 2 消费）')
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ⑮⑯⑰：新规则必须真的会报（派发卡超长 / 审计视图断链 / 定量断言缺出处）', () => {
  const { d, repo, R } = mkRepo()
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
// MD / mkSvg / DRAFT_WITH_ENDNOTES / CARD 已移入 `tests/_fixtures.mjs`（v18.0.5 去重，与 e2e 用例共用同一份）
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
  assert.equal(j.total, 22, '脚本机械项应为 22 项（M-Form 1-11 + M-Exist 1-10 + M-Integrity-1）')
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
  const { d, repo, R } = mkRepo()
  // ① 旧图件路径口径
  const t8 = join(R, 'references', 'agents', '08-终检-finalizer.md')
  writeFileSync(t8, readFileSync(t8, 'utf8') + '\n> 图件落在 `final/图N-标题.svg`。\n')
  // ② M 门计数漂移（把 20 项写回 13 项）
  const gl = join(R, 'references', 'glossary.md')
  writeFileSync(gl, readFileSync(gl, 'utf8').replace('M 门 23 项复核', 'M 门 13 项复核'))
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
  const { d, repo, R } = mkRepo()
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
    writeFileSync(ag, readFileSync(ag, 'utf8').replace('M 门 23 项中 22 项已脚本化', 'M 门 23 项中 14 项已脚本化'))
    const fin = join(R, 'references', 'agents', '08-终检-finalizer.md')
    writeFileSync(fin, readFileSync(fin, 'utf8').replace('（**22 项**：M-Form 1-', '（**15 项**：M-Form 1-'))
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

test('consistency-check ⑩c：分档工具↔角色映射漂移必须报（注入验证，真源 = model-routing.mjs 的 tool→roles）', () => {
  // ① 旧口径复发：把 T6 批判 / T9 审稿 塞回「强推理档」行（v18.0.3 前 11 处副本的真实漂移形态）
  {
    const { d, repo, R } = mkRepo({ readme: true })
    const en = join(repo, 'README.md')
    writeFileSync(en, readFileSync(en, 'utf8').replace('| T4 analyst / T5 writer |', '| T4 analyst / T5 writer / T6 critical / T9 reviewer |'))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    assert.equal(r.code, 1, '映射漂移必须 exit 1')
    assert.match(r.out, /分档映射漂移/, '⑩c 必须抓出强推理档行多出 T6/T9')
    assert.match(r.out, /subagent_strong/, '⑩c 报错须点名漂移的工具')
    rmSync(d, { recursive: true, force: true })
  }

  // ② 真源不可派生 → P0（规则失效必须响，不得静默放行）
  {
    const { d, R } = mkRepo()
    const mr = join(R, 'scripts', 'model-routing.mjs')
    writeFileSync(mr, readFileSync(mr, 'utf8').replace("tool: 'subagent_audit'", "toolName: 'subagent_audit'"))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    assert.equal(r.code, 1, '真源不可派生必须 exit 1')
    assert.match(r.out, /分档真源/, '⑩c 派生失败须按 P0 报（否则整条映射门静默失效）')
    rmSync(d, { recursive: true, force: true })
  }

  // ③ 反向断言：真源仓库自身的 30 处断言齐整时，⑩c 不得误报（防止把散文/复合写法误当断言）
  {
    const r = run([join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')])
    assert.doesNotMatch(r.out, /分档映射漂移/, '真源仓库当前应零漂移（复合写法 subagent_retrieval\/strong\/audit 不得被当作断言）')
  }
})


test('consistency-check ⑳：真源仓库自身必须自洽（M-Form 11 / M-Exist 10 / M-Integrity 2 == 节内子节数）', () => {
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
  assert.equal(secs.Exist.declared, 10, 'M-Exist 节头应写 10 项')
  assert.equal(secs.Exist.subs.length, 10, 'M-Exist 应有 10 个 ### 子节')
  assert.equal(secs.Integrity.declared, 2, 'M-Integrity 节头应写 2 项')
  assert.equal(secs.Integrity.subs.length, 2, 'M-Integrity 应有 2 个 ### 子节')
})

test('m-gate-check M-Form-11：素材按需加载闭环（引了没读 / 幽灵编号 / 无留痕必须报；齐备则过）', () => {
  const { d, proj, fin, ev } = mkProject({ analysis: true })
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

// ===== v18.0.5：补齐 M 门回归网（第三方审计 P1-4 —— 9 项「改坏实现也不变红」的盲区）=====
// 要求：**注入真实缺陷 → 对应门必须变红**。此前 M-Form-1/2/6/7/8、M-Exist-1/2/3 在用例集中
// 没有回归网（35 个变异实验里有 10 个不变红），故专门补齐；夹具统一走 `_fixtures.mjs`。
const DRAFT_OK = '# 标题\n\n## 摘要\n\n摘要若干字。\n\n## 一、导论\n\n'
  + '正文 [L01] [D01] [C01] [先01]。'.repeat(12)
  + '\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] c\n\n## 先行者文献\n\n[先01] p\n\n## AI 使用声明\n\nAI。\n'
const cardOk = (name, ids) => `# ${name}\n\n## 📇 索引段\n\n`
  + ids.map((id) => `[${id}] 主题 ｜ 论点1`).join('\n')
  + '\n\n## 正文\n\n' + ids.map((id) => `### [${id}] 条目\n信任级别：已发布\n`).join('\n')
const setupCards = (ev) => {
  writeFileSync(join(ev, '文献卡.md'), cardOk('文献卡', ['L01']))
  writeFileSync(join(ev, '数据卡.md'), cardOk('数据卡', ['D01']))
  writeFileSync(join(ev, '案例卡.md'), cardOk('案例卡', ['C01']))
}
const gateOf = (draft, ev, prefix) => {
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev])
  const it = parseJson(r).results.find((x) => x.gate.startsWith(prefix))
  assert.ok(it, `找不到门 ${prefix}`)
  return it
}

test('m-gate-check M-Form-2 / M-Form-7：文末五节缺失与**顺序**都必须报（v18.0.5 补回归网）', () => {
  const { d, fin, ev } = mkProject()
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, DRAFT_OK)
  assert.equal(gateOf(draft, ev, 'M-Form-2').pass, true, '五节齐全应通过')
  assert.equal(gateOf(draft, ev, 'M-Form-7').pass, true, '顺序正确应通过')
  // ① 删掉最后一节 → 存在性失败（P0）
  writeFileSync(draft, DRAFT_OK.replace('\n## AI 使用声明\n\nAI。\n', '\n'))
  const it2 = gateOf(draft, ev, 'M-Form-2')
  assert.equal(it2.pass, false, '缺「AI 使用声明」必须报')
  assert.equal(it2.severity, 'P0')
  assert.match(it2.detail, /AI 使用声明/)
  // ② 仅顺序对调（成员资格仍全白名单）→ M-Form-7 违序 P1
  writeFileSync(draft, DRAFT_OK.replace(
    '## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] c',
    '## 案例来源\n\n[C01] c\n\n## 数据来源\n\n[D01] d',
  ))
  const it7 = gateOf(draft, ev, 'M-Form-7')
  assert.equal(it7.pass, false, '文末五节错序必须报')
  assert.equal(it7.severity, 'P1')
  assert.match(it7.detail, /顺序违规/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-1：正文↔文末双向对比（漏引 / 孤儿都必须报；v18.0.5 补回归网）', () => {
  const { d, fin, ev } = mkProject()
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, DRAFT_OK)
  assert.equal(gateOf(draft, ev, 'M-Exist-1').pass, true, '齐备应通过')
  // ① 正文引 [L99]，文末没有 → 漏引
  writeFileSync(draft, DRAFT_OK.replace('正文 [L01] [D01] [C01] [先01]。', '正文 [L01] [D01] [C01] [先01] [L99]。'))
  let it = gateOf(draft, ev, 'M-Exist-1')
  assert.equal(it.pass, false, '文末漏引必须报：' + it.detail)
  assert.match(it.detail, /漏引 [1-9]/)
  // ② 文末多一条 [L02] 而正文不引 → 孤儿
  writeFileSync(draft, DRAFT_OK.replace('## 参考文献\n\n[L01] a', '## 参考文献\n\n[L01] a\n[L02] b'))
  it = gateOf(draft, ev, 'M-Exist-1')
  assert.equal(it.pass, false, '文末孤儿必须报：' + it.detail)
  assert.match(it.detail, /孤儿 [1-9]/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-6：数据卡条目缺独立「信任级别」段必须报（有则过；v18.0.5 补回归网）', () => {
  const { d, fin, ev } = mkProject()
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, DRAFT_OK)
  assert.equal(gateOf(draft, ev, 'M-Form-6').pass, true, '信任级别齐备应通过')
  writeFileSync(join(ev, '数据卡.md'), cardOk('数据卡', ['D01']).replace('信任级别：已发布\n', ''))
  const it = gateOf(draft, ev, 'M-Form-6')
  assert.equal(it.pass, false, '缺独立信任级别段必须报：' + it.detail)
  assert.match(it.detail, /独立段缺失/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-8：论点段缺 [Lxx] / 承重墙超载与幽灵编号都必须报（v18.0.5 补回归网）', () => {
  const { d, proj, fin, ev } = mkProject({ analysis: true })
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, DRAFT_OK)
  assert.equal(gateOf(draft, ev, 'M-Form-8').pass, true, '齐备应通过')
  // ① 论点段只有 [D01]/[C01]（无 L）→ 段缺 L
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n摘要若干字。\n\n## 一、导论\n\n'
    + '正文 [D01] [C01]。'.repeat(12)
    + DRAFT_OK.slice(DRAFT_OK.indexOf('\n\n## 参考文献')))
  let it = gateOf(draft, ev, 'M-Form-8')
  assert.equal(it.pass, false, '论点段缺 [Lxx] 必须报：' + it.detail)
  assert.match(it.detail, /缺\[Lxx\]|L_missing|段缺/)
  // ② 承重墙超载（同一编号 3 论点）+ 幽灵编号（卡片里不存在）
  writeFileSync(draft, DRAFT_OK)
  writeFileSync(join(proj, 'analysis', '分析大纲.md'),
    '# 分析大纲\n\n## 一、承重墙清单\n\n| 论点 | 承重证据 top1 |\n|---|---|\n| 论点1 | [C01] |\n| 论点2 | [C01] |\n| 论点3 | [C01] |\n| 论点4 | [L99] |\n')
  it = gateOf(draft, ev, 'M-Form-8')
  assert.equal(it.pass, false, '超载/幽灵必须报：' + it.detail)
  assert.match(it.detail, /超载|不存在/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-2 / M-Exist-3：空文件、悬空引用、证据包布局异常（v18.0.5 补回归网）', () => {
  const { d, fin, ev } = mkProject()
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, DRAFT_OK)
  assert.equal(gateOf(draft, ev, 'M-Exist-2').pass, true)
  assert.equal(gateOf(draft, ev, 'M-Exist-3').pass, true)
  // ① 证据包里放 0 字节 .md → P0
  writeFileSync(join(ev, '空卡.md'), '')
  let it = gateOf(draft, ev, 'M-Exist-2')
  assert.equal(it.pass, false, '空文件必须报')
  assert.equal(it.severity, 'P0')
  assert.match(it.detail, /空文件/)
  rmSync(join(ev, '空卡.md'))
  // ② 正文引 [D99]（卡里没有）→ M-Exist-3 报
  writeFileSync(draft, DRAFT_OK.replace('正文 [L01] [D01] [C01] [先01]。', '正文 [L01] [D01] [C01] [先01] [D99]。'))
  it = gateOf(draft, ev, 'M-Exist-3')
  assert.equal(it.pass, false, '悬空引用必须报：' + it.detail)
  assert.match(it.detail, /D99|无对应条目/)
  // ③ 布局异常（顶层无 .md、卡在子目录）：单列一条 P1；有回退的门仍能定位卡片（不再互相矛盾）
  const proj2 = join(d, 'run', 'proj2')
  const ev2 = join(proj2, 'final', '证据包')
  mkdirSync(join(ev2, 'data'), { recursive: true })
  mkdirSync(join(ev2, 'literature'), { recursive: true })
  writeFileSync(join(ev2, 'data', '数据卡.md'), cardOk('数据卡', ['D01']))
  writeFileSync(join(ev2, 'literature', '文献卡.md'), cardOk('文献卡', ['L01']))
  writeFileSync(join(proj2, 'final', '定稿.md'), DRAFT_OK)
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj2, 'final', '定稿.md'), ev2])
  const res = parseJson(r).results
  const ex2 = res.find((x) => x.gate.startsWith('M-Exist-2'))
  assert.equal(ex2.severity, 'P1', '布局异常应单列 P1（不与「真缺卡」同判 P0）：' + ex2.detail)
  assert.match(ex2.detail, /布局异常/)
  const fm10 = res.find((x) => x.gate.startsWith('M-Form-10'))
  assert.match(fm10.detail, /已查 [1-9]/, '带 projectRoot 回退的门仍应定位到卡片（v18.0.5 修口径分裂）')
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ⑩：随包脚本白名单漏列必须报（v18.0.5 补回归网）', () => {
  const { d, R } = mkRepo()
  writeFileSync(join(R, 'scripts', 'new-tool.mjs'), '// 新增脚本（未登记白名单）\n')
  const r = run([join(R, 'scripts', 'consistency-check.mjs')])
  assert.equal(r.code, 1, '白名单漏列必须 exit 1')
  assert.match(r.out, /白名单/, '必须点名白名单不一致')
  rmSync(d, { recursive: true, force: true })
})

test('pack-smoke：patch 缺自注册行 / 引用未声明的包 / 发布面污染 必须报（v18.0.5 新增发布物门；v18.2.0 加裁剪断言）', () => {
  // ① 基线：本仓 pack 出来的产物应通过
  const ok = run([join(ROOT, 'scripts', 'pack-smoke.mjs')])
  assert.equal(ok.code, 0, '本仓发布物应通过 pack-smoke：' + ok.out.slice(-400))

  // ② 删掉自注册行 → 必须报（v18.0.0 的真实缺陷形态）
  const { d, repo } = mkRepo({ full: true })
  // `full` 会整仓复制，含 CHANGELOG.md/CONTRIBUTING.md —— 而 v18.2.0 起它们**不得随包**，
  // 留着会让 ② ③ 因「发布面污染」而失败（用错误的理由通过断言）。故先按当前发布面清掉，
  // 让每个注入只检验它自己那一件事。
  for (const f of ['CHANGELOG.md', 'CONTRIBUTING.md']) rmSync(join(repo, f), { force: true })
  const patchPath = join(repo, 'cordis.patch.yml')
  const patch = readFileSync(patchPath, 'utf8')
  writeFileSync(patchPath, patch.replace(/^\s*- id: lunheng-article-pipeline\n\s*name: lunheng-article-pipeline\n/m, ''))
  let r = run([join(repo, 'scripts', 'pack-smoke.mjs')])
  assert.equal(r.code, 1, '缺自注册行必须 exit 1')
  assert.match(r.out, /自注册行/)

  // ③ patch 引用未声明的包 → 必须报（宿主改名即整树起不来）
  writeFileSync(patchPath, patch.replace(/name: '@deepseek-ai\/dsh-tool-subagent'/g, "name: '@deepseek-ai/dsh-tool-nonexistent'"))
  r = run([join(repo, 'scripts', 'pack-smoke.mjs')])
  assert.equal(r.code, 1, '引用未声明包必须 exit 1')
  assert.match(r.out, /未声明/)

  // ④ 把仓库向文件塞回发布面 → 必须报（v18.2.0 裁剪口径的机械防线；防「谁顺手加回 files 白名单」）
  //   注意：先得让该文件**真的存在于工作区**，否则 npm 会忽略不存在的白名单项（那样注入就是空转，测试形同虚设）
  writeFileSync(patchPath, patch)
  writeFileSync(join(repo, 'CHANGELOG.md'), readFileSync(join(ROOT, 'CHANGELOG.md')))
  const pjPath = join(repo, 'package.json')
  const pj = readFileSync(pjPath, 'utf8')
  writeFileSync(pjPath, pj.replace('"LICENSE",', '"LICENSE",\n    "CHANGELOG.md",'))
  r = run([join(repo, 'scripts', 'pack-smoke.mjs')])
  assert.equal(r.code, 1, '仓库向文件随包必须 exit 1（注入若为空转说明本用例无效）')
  assert.match(r.out, /发布面污染/, '必须点名「发布面污染」')

  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：多版本报告必须取**最大**版本（清空后断言，v18.0.5 修「假测试」）', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), DRAFT_OK)
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n子问题 A：x。\n需找数据点 ≥1\n')
  writeFileSync(join(ev, '数据卡.md'), cardOk('数据卡', ['D01']))
  writeFileSync(join(aud, '审计报告-v1.md'), '# 审计报告 v1\n\nG0：通过\n')
  writeFileSync(join(aud, '审计报告-v3.md'), '# 审计报告 v3\n\nG0：通过\n')
  run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.ok(existsSync(join(ev, '审计报告-v3.md')), '应收录 v3（版本取最大）')
  assert.ok(!existsSync(join(ev, '审计报告-v1.md')), '只应收录最大版本；v1 出现即说明排序退化（旧用例的断言可被上次运行残留满足）')
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-5：闸门记录表（漏项 / 自述当实据 / ✗ 无原因 / 与 M 门报告矛盾必须报）', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
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
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n启用期刊匹配\n')
  const REP = join(aud, '审稿报告-v2.md')
  const mk = (total, dims, rows) => `# 同行评审报告\n\n> **总评分**：${total}/30\n> **建议**：minor revision\n\n`
    + '| 维度 | 得分 | 一句话评价 |\n|------|------|-----------|\n'
    + ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范'].map((x, i) => `| ${x} | ${dims[i]}/5 | 好 |`).join('\n')
    + `\n| **总分** | **${total}/30** | **minor revision** |\n\n判定：minor revision\n\n`
    + '| 目标方向 | 综合匹配度 | 主题契合 | 风格契合 | 审稿周期 | 推荐理由 |\n|---------|-----------|---------|---------|---------|---------|\n' + rows + '\n'
    + '\n## 给作者的具体修改建议（按优先级）\n\n1. 补 §三 第 2 段的 [L01] 支撑\n2. 第 4 章增补反方\n'
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
  const { d, proj, fin, ev } = mkProject()
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

test('m-gate-check M-Form-8：承重墙超载与虚标必须机检（原为纯 LLM 判断）', () => {
  const { d, proj, fin, ev } = mkProject({ analysis: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n## 一、导论\n\n' + '正文段落。'.repeat(40) + '[L01][D01]\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 📇 索引段\n\n[L01] a ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [L01] a\n信任级别：已发布\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n共 1 条\n\n## 📇 索引段\n\n[D01] d ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [D01] d\n信任级别：已发布\n')
  writeFileSync(join(ev, '案例卡.md'), '# 案例卡\n\n## 📇 索引段\n\n[C01] 祁东案 ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [C01] 祁东案\n信任级别：已发布\n')
  const outline = (rows) => `# 分析大纲\n\n## 一、论点映射\n\n| 论点 | 论据 |\n|---|---|\n| 论点1 | [L01] [D01] |\n\n## 十一、写手版精简段\n\n### 承重墙清单\n\n| 论点 | 承重证据 top1 |\n|---|---|\n${rows}\n`
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Form-8'))
  }
  // ① 无大纲 → 覆盖率照判，承重墙只记备注（不判失败）
  let it = item()
  assert.equal(it.pass, true, '无大纲不得因承重墙判失败：' + it.detail)

  // ② 承重墙分散（无超载）→ 通过
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), outline(['| 论点1 | [C01] 祁东案 |', '| 论点2 | [L01] |'].join('\n')))
  it = item()
  assert.equal(it.pass, true, '无超载应通过：' + it.detail)
  assert.match(it.detail, /承重墙 2 条标注、无超载/)

  // ③ 同一证据被 3 个论点承重 → 超载 P1（教训：祁东案一个案例承重四个论点）
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), outline(['| 论点1 | [C01] 祁东案 |', '| 论点2 | [C01] 祁东案 |', '| 论点3 | [C01] 祁东案 |'].join('\n')))
  it = item()
  assert.equal(it.pass, false, '超载必须报')
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /承重墙超载/)
  assert.match(it.detail, /\[C01\]×3论点/)

  // ④ 承重墙标了卡片里没有的编号 → 虚标 P1
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), outline('| 论点1 | [L99] 幽灵 |'))
  it = item()
  assert.equal(it.pass, false, '虚标必须报')
  assert.match(it.detail, /卡片中不存在的编号/)
  assert.match(it.detail, /\[L99\]/)

  // ⑤ 有承重墙标题但无结构性条目 → 备注
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), '# 分析大纲\n\n## 承重墙清单\n\n（待补）\n')
  it = item()
  assert.match(it.detail, /承重墙清单无结构性条目|承重墙清单为空/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check v18.2.1：承重墙锚点收紧 + 需找数据点容忍冒号 + 范围写法 + exit= 实据（本轮实战反哺）', () => {
  // 本用例的 4 个场景全部来自 v18.2.0 短测试实战踩点（详见 CHANGELOG ## 18.2.1）：
  //   ① 大纲标题里**提及**「承重墙」不得被当成承重墙清单锚点（旧式全行匹配会把论据映射表当清单 → 误报超载）；
  //   ② 任务简报「需找数据点：≥ 3」带冒号也必须被识别（否则需求总数记 0 → M-Integrity-1 假 P0）；
  //   ③ 素材加载清单的范围写法 `[L01]-[L03]` 必须展开（否则中间编号被判「引了没读」→ 假 P0）；
  //   ④ 闸门记录实据写 `exit=2` 也必须算机械证据（旧正则只认 `exit 2`）。
  const { d, proj, fin, ev } = mkProject({ analysis: true, audits: true })
  writeFileSync(join(fin, '定稿.md'),
    '# 标题\n\n## 摘要\n\n## 一、导论\n\n' + '正文段落。'.repeat(40) + '[L01][L02][L03][D01]\n\n'
    + '## 参考文献\n\n[L01] a\n[L02] b\n[L03] c\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 📇 索引段\n\n[L01] a\n[L02] b\n[L03] c\n\n## 正文\n\n### [L01] a\n信任级别：已发布\n\n### [L02] b\n信任级别：已发布\n\n### [L03] c\n信任级别：已发布\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 📇 索引段\n\n[D01] d\n\n## 正文\n\n### [D01] d\n信任级别：已发布\n')
  writeFileSync(join(ev, '案例卡.md'), '# 案例卡\n\n## 📇 索引段\n\n\n## 正文\n')
  // ② 简报：带冒号的「需找数据点：≥ 3」
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n子问题 A：x。\n子问题 B：y。\n需找数据点：≥ 3 条\n')
  // ① 大纲：只有「提及」承重墙的标题 + 表内同编号 3 次（若锚点误命中 → 会报超载）
  writeFileSync(join(proj, 'analysis', '分析大纲.md'),
    '# 分析大纲\n\n## 一、论点映射\n\n| 论点 | 论据 |\n|---|---|\n| 论点1 | [L01] |\n\n### 论点-论据映射表（写手版；M-Form-8 承重墙清单）\n\n| 论点1 | [L01] |\n| 论点2 | [L01] |\n| 论点3 | [L01] |\n')
  // ③ 加载清单：范围写法
  writeFileSync(join(proj, 'analysis', '素材加载清单.md'), '# 清单\n\n## 已加载\n\n| 编号 | 位置 |\n|---|---|\n| [L01]-[L03] | §1 |\n| [D01] | §1 |\n')
  // ④ 闸门记录：实据用 `exit=2` 形态 + 表头含 检查项/实据/结论
  const rows = (items) => items.map((t) => `| ${t} | \`x.json\` exit=2 | ✓ |  |`).join('\n')
  writeFileSync(join(proj, 'audits', '闸门记录-T2.5.md'),
    `# 记录\n\n| 检查项 | 实据 | 结论 | 失败原因 |\n|---|---|---|---|\n${rows(['数据卡文件存在', '数据条目数（双格式并集去重）', '任务简报数据需求总数', '数据条目数 ≥ 需求总数', '信任级别完整性（M-Form-6）', '信任级别一致性（M-Exist-3）', '数据卡头部声明 vs 实际计数', '证据包哈希占位符（可选验证）'])}\n`)
  writeFileSync(join(proj, 'audits', '闸门记录-T7.5.md'),
    `# 记录\n\n| 检查项 | 实据 | 结论 | 失败原因 |\n|---|---|---|---|\n${rows(['审计报告最新版存在', 'P0/P1 清单已列', 'M 门全部 exit 0', '证据包指纹占位符', '信任级别一致性（M-Exist-3）', '论文交付物 vs 报告独立隔离', '修订轮由独立写手执行'])}\n`)
  const item = (prefix) => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), join(proj, 'final', '证据包')])
    return parseJson(r).results.find((x) => x.gate.startsWith(prefix))
  }
  // ① 提及「承重墙」的标题不得被当锚点 → 不出现「承重墙超载」
  const f8 = item('M-Form-8')
  assert.ok(!/承重墙超载/.test(f8.detail), '标题里提及承重墙不得被当锚点：' + f8.detail)
  // ② 带冒号的「需找数据点：≥ 3」被识别（需求总数 3 而非 0）
  const mi1 = item('M-Integrity-1')
  assert.match(mi1.detail, /需找数据点 3 条/, '冒号写法必须被识别：' + mi1.detail)
  // ③ 范围写法展开 → [L02] 不得被判「引了没读」
  const f11 = item('M-Form-11')
  assert.ok(!/引了没读/.test(f11.detail), '范围写法必须展开：' + f11.detail)
  // ④ `exit=2` 算机械证据 → 不得报「不是机械证据」
  const e5 = item('M-Exist-5')
  assert.ok(!/不是机械证据/.test(e5.detail), 'exit= 形态必须算机械证据：' + e5.detail)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-8：批判报告 C1-C7 覆盖（漏节 / 编号重复 / 要素不足）', () => {
  const { d, proj, fin, ev } = mkProject({ analysis: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const C = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']
  const mk = (ids, extra = '') => '# 批判报告 v2\n\n'
    + ids.map((c) => `## ${c} 维度${c}\n\n` + '攻击内容与论据。'.repeat(8) + '\n').join('\n')
    + '\n## 批判总结\n\n- 关闭状态：未关闭\n\n' + extra
  const FULL_ENTRY = '[P0-C1-1] 论点「X」的反方攻击\n- 论点定位：§三 第 2 段（行 67-72）\n- 反方观点：因果方向可能反转\n- 你的论据 [L01]：未控制变量\n- 攻击强度：高\n- 建议：加固\n'
  const REV = join(proj, 'analysis', '批判报告-v2.md')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-8'))
  }
  // ① 无批判报告 → N/A（轻量档可跳）
  let it = item()
  assert.equal(it.pass, true, '无批判报告应记 N/A')
  assert.match(it.detail, /N\/A/)

  // ② 七节齐备 + 规范清单条目 → 通过
  writeFileSync(REV, mk(C, FULL_ENTRY))
  it = item()
  assert.equal(it.pass, true, '七维齐备应通过：' + it.detail)
  assert.match(it.detail, /C1-C7 实到 7\/7/)

  // ③ 缺 C3 → P1
  writeFileSync(REV, mk(C.filter((c) => c !== 'C3'), FULL_ENTRY))
  it = item()
  assert.equal(it.pass, false, '漏节必须报')
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /缺 1 节：C3/)

  // ④ 缺 4 节 → P0
  writeFileSync(REV, mk(['C1', 'C2', 'C5'], FULL_ENTRY))
  it = item()
  assert.equal(it.severity, 'P0', '缺 >2 节应 P0：' + it.detail)

  // ⑤ 编号重复 → 硬问题
  writeFileSync(REV, mk(C, FULL_ENTRY + FULL_ENTRY))
  it = item()
  assert.equal(it.pass, false, '编号重复必须报')
  assert.match(it.detail, /编号重复/)

  // ⑥ 要素不足（只写建议）→ 软提示
  writeFileSync(REV, mk(C, '[P0-C1-1] 论点「X」\n- 建议：加固\n'))
  it = item()
  assert.match(it.detail, /要素不足 3 项|要素不足/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-9：审计报告 G0-G14 覆盖（漏项 / 只提不判 / 子项缺）', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const GALL = ['G0', 'G0.5', 'G1', 'G2', 'G2.5', 'G3', 'G4', 'G4-2', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14']
  const mk = (gs) => `# 审计报告 v1\n\n结论：通过 ✅\n\n` + gs.map((g) => `- **${g}**：通过（见 引用核验记录；覆盖 5/5）`).join('\n') + '\n'
  const AUD = join(aud, '审计报告-v1.md')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-9'))
  }
  // ① 无审计报告 → N/A
  let it = item()
  assert.equal(it.pass, true, '无审计报告应记 N/A')
  assert.match(it.detail, /N\/A/)

  // ② 全 15 主项 + 子项齐 → 通过（G1 不得误命中 G14 / G0 不得误命中 G0.5）
  writeFileSync(AUD, mk(GALL))
  it = item()
  assert.equal(it.pass, true, 'G 项全覆盖应通过：' + it.detail)
  assert.match(it.detail, /G0-G14 实到 15\/15/)

  // ③ 缺 G11-G14 → P0（>3 项）
  writeFileSync(AUD, mk(GALL.filter((g) => !['G11', 'G12', 'G13', 'G14'].includes(g))))
  it = item()
  assert.equal(it.pass, false, '缺 G 项必须报')
  assert.equal(it.severity, 'P0', '缺 >3 项应 P0：' + it.detail)
  assert.match(it.detail, /G11,G12,G13,G14/)

  // ④ 只提名不给结论 → 软提示（须邻域内有结论词）
  writeFileSync(AUD, '# 审计报告 v1\n\n结论：通过 ✅\n\n' + GALL.map((g) => `- ${g}`).join('\n') + '\n')
  it = item()
  assert.equal(it.pass, false, '只提不判应记软问题（pass=false + P2）')
  assert.match(it.detail, /邻域无结论词|有提及但邻域无结论词/)

  // ⑤ 子项缺 → 软提示
  writeFileSync(AUD, mk(['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14']))
  it = item()
  assert.match(it.detail, /子项未覆盖/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-10：大纲 §11 精简段六要素（缺段 / 缺要素 / 假表格）', () => {
  const { d, proj, fin, ev } = mkProject({ analysis: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const OUT = join(proj, 'analysis', '分析大纲.md')
  const SIX = '## 十一、写手版精简段\n\n- 论证主线：X\n- 反方规划要点：Y\n- 字数预算：4000 字\n- 禁做项：Z\n- 承重墙清单：| 论点1 | [C01] |\n- 映射表：| 论点 | 论据 |\n|---|---|\n| 论点1 | [L01] |\n'
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-10'))
  }
  // ① 无大纲 → N/A
  let it = item()
  assert.equal(it.pass, true, '无大纲应记 N/A')
  assert.match(it.detail, /N\/A/)

  // ② 有纲但缺 §11 → P2（T5 会回退整读大纲）
  writeFileSync(OUT, '# 分析大纲\n\n## 一、论点\n\n内容\n')
  it = item()
  assert.equal(it.pass, false, '缺 §11 标题必须报')
  assert.equal(it.severity, 'P2')
  assert.match(it.detail, /精简段/)

  // ③ 六要素齐备 → 通过
  writeFileSync(OUT, '# 分析大纲\n\n## 一、论点\n\n内容\n\n' + SIX)
  it = item()
  assert.equal(it.pass, true, '六要素齐备应通过：' + it.detail)
  assert.match(it.detail, /六要素实到 6\/6/)

  // ④ 缺 4 要素 → P0
  writeFileSync(OUT, '# 分析大纲\n\n## 十一、写手版精简段\n\n- 主线：X\n- 映射：| 论点 | 论据 |\n|---|---|\n| 论点1 | [L01] |\n')
  it = item()
  assert.equal(it.pass, false, '缺要素必须报')
  assert.equal(it.severity, 'P0', '缺 ≥3 要素应 P0：' + it.detail)
  assert.match(it.detail, /缺 4 个要素/)

  // ⑤ 六要素关键词齐但映射表不是真表格（无素材编号）→ 软提示
  writeFileSync(OUT, '# 分析大纲\n\n## 十一、写手版精简段\n\n- 论证主线：X\n- 反方规划要点：Y\n- 字数预算：4000 字\n- 禁做项：Z\n- 承重墙清单：X\n- 映射表：论点 → 论据\n- 补充行 1\n')
  it = item()
  assert.match(it.detail, /真表格|映射表/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-9：G 项结论必须带实据（只写「通过」→ 软提示）', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const GALL = ['G0', 'G0.5', 'G1', 'G2', 'G2.5', 'G3', 'G4', 'G4-2', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14']
  const AUD = join(aud, '审计报告-v1.md')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-9'))
  }
  // ① 结论带实据（文件路径 / 带量词数字）→ 通过
  writeFileSync(AUD, '# 审计报告 v1\n\n结论：通过 ✅\n\n' + GALL.map((g) => `- **${g}**：通过（见 引用核验记录；覆盖 5/5）`).join('\n') + '\n')
  let it = item()
  assert.equal(it.pass, true, '结论带实据应通过：' + it.detail)
  assert.doesNotMatch(it.detail, /无实据/)

  // ② 只写「通过」不给依据 → 软问题（15 项结论无实据）
  writeFileSync(AUD, '# 审计报告 v1\n\n结论：通过 ✅\n\n' + GALL.map((g) => `- **${g}**：通过`).join('\n') + '\n')
  it = item()
  assert.equal(it.pass, false, '只写通过不给依据必须报')
  assert.equal(it.severity, 'P2')
  assert.match(it.detail, /无实据/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-6：审稿建议可消费性 + 修订回执闭环', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const REP = join(aud, '审稿报告-v2.md')
  const base = (sug) => '# 同行评审报告\n\n> **总评分**：24/30\n> **建议**：minor revision\n\n'
    + '| 维度 | 得分 | 一句话评价 |\n|------|------|-----------|\n'
    + ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范'].map((x) => `| ${x} | 4/5 | 好 |`).join('\n')
    + '\n| **总分** | **24/30** | **minor revision** |\n\n判定：minor revision\n\n' + sug
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-6'))
  }
  // ① 建议条目带定位 → 通过
  writeFileSync(REP, base('## 给作者的具体修改建议（按优先级）\n\n1. 补 §三 第 2 段的 [L01] 支撑\n2. 第 4 章增补反方\n'))
  let it = item()
  assert.equal(it.pass, true, '建议带定位应通过：' + it.detail)

  // ② 建议无定位（自由叙述）→ 软提示
  writeFileSync(REP, base('## 给作者的具体修改建议（按优先级）\n\n1. 建议进一步加强论证的严谨性\n'))
  it = item()
  assert.equal(it.pass, false, '建议无定位必须报')
  assert.match(it.detail, /无定位/)

  // ③ 发生修订轮但修订说明未提审稿意见 → 软提示（建议提了没人接）
  writeFileSync(join(proj, 'drafts', '修订说明-v2.md'), '# 修订说明 v2\n\n- 已处理 P0-1\n')
  it = item()
  assert.match(it.detail, /未提及审稿意见/)
  rmSync(d, { recursive: true, force: true })
})

test('自省审计：splitCard 必须优先标题式条目（索引段行抢先命中会让合规卡判 P0 假阳性）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01] [D01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  // 8 条**全部合规**的数据卡（带「## 📇 索引段」——索引行 `[D02] …` 在正文条目前面）
  const N = 8
  writeFileSync(join(ev, '数据卡.md'),
    '# 数据卡\n\n> 合计 8 条\n\n## 📇 索引段\n\n'
    + Array.from({ length: N }, (_, i) => `[D0${i + 1}] 条目${i + 1} ｜ 主题 ｜ 论点1`).join('\n')
    + '\n\n## 正文\n\n' + Array.from({ length: N }, (_, i) => `### [D0${i + 1}] 条目${i + 1}\n信任级别：已发布\n`).join('\n'))
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
  const it = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-6'))
  assert.equal(it.pass, true, `条目全合规的 ${N} 条卡不得判失败（旧版 splitCard 命中索引行 → 8 条「独立段缺失」→ P0 阻塞交付）：${it.detail}`)
  assert.equal(it.severity, '通过')
  rmSync(d, { recursive: true, force: true })
})

test('自省审计：M-Form-3 查占位符残留（不再与 M-Exist-1 重复算被引编号）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 正文\n\n### [D01] d\n信任级别：已发布\n')
  const DRAFT = (tail) => '# 标题\n\n## 摘要\n\n正文 [L01] [D01]。\n\n## 一、导论\n\n' + '段落。'.repeat(20) + tail
    + '\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Form-3'))
  }
  // ① 干净定稿 → 通过（正文↔文末闭环归 M-Exist-1，本项不再报「孤儿编号」）
  writeFileSync(join(fin, '定稿.md'), DRAFT(''))
  let it = item()
  assert.equal(it.pass, true, '干净定稿应通过：' + it.detail)
  assert.doesNotMatch(it.detail, /孤儿编号/)

  // ② 定稿残留 [待补] → P1（旧版无任何项能抓它）
  writeFileSync(join(fin, '定稿.md'), DRAFT('\n本处数据 [待补]。'))
  it = item()
  assert.equal(it.pass, false, '占位符残留必须报')
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /占位符|临时标记/)

  // ③ ≥3 处 → P0
  writeFileSync(join(fin, '定稿.md'), DRAFT('\n[待补] [TBD] （待核）'))
  it = item()
  assert.equal(it.severity, 'P0', '≥3 处占位符应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('自省审计：M-Form-4 任一泄露即 P0 / M-Form-5 补 P0 档（旧版分支不可达）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const DRAFT = (tail) => '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、导论\n\n' + '段落。'.repeat(20) + tail
    + '\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  const item = (pre) => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith(pre))
  }
  // 一处内部代号 → P0（文档写「P0 优先级」，旧脚本只给 P1）
  writeFileSync(join(fin, '定稿.md'), DRAFT('\n本段由 T5 写手完成。'))
  let it = item('M-Form-4')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '一处元数据泄露即 P0（与文档口径对齐）：' + it.detail)

  // 过程语言 >10 处 → P0（旧版最高 P1，P0 分支不可达）
  writeFileSync(join(fin, '定稿.md'), DRAFT('\n' + '初稿 承重墙 卡级 批注 修卡 待回查 审计环节 流水线 草稿 上一版 下一版 将在正式出版前订正。'))
  it = item('M-Form-5')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '过程语言 >10 处应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('自省审计：M-Integrity-1 不再是永久 soft（数据条目不足 → P0）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01] [D01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 📇 索引段\n\n[D01] d ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [D01] d\n信任级别：已发布\n')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Integrity-1'))
  }
  // ① 需求 ≤ 条目 → 通过（保留「主控 L4 跨文件判断」定位）
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n子问题 A：x。\n需找数据点 ≥1\n')
  let it = item()
  assert.equal(it.pass, true, '需求 ≤ 条目应通过：' + it.detail)
  assert.match(it.detail, /对账通过|主控 L4/)

  // ② 需求 > 条目 → P0（文档步骤 4 承诺的 P0，旧版不可达）
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n子问题 A：x。\n需找数据点 ≥12\n')
  it = item()
  assert.equal(it.pass, false, '数据条目不足必须报')
  assert.equal(it.severity, 'P0', 'T2.5 步骤 4 不足应 P0：' + it.detail)
  assert.match(it.detail, /数据条目 1 条 < 简报需求 12 条/)

  // ③ 数据卡缺失 → P0
  rmSync(join(ev, '数据卡.md'), { force: true })
  it = item()
  assert.equal(it.severity, 'P0', '数据卡缺失应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('token-budget --project：读目标对账（省比 / 缺失不给假 100% / §11 与索引段同口径）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const ev = join(proj, 'final', '证据包')
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  mkdirSync(ev, { recursive: true })
  mkdirSync(join(proj, 'audits'), { recursive: true })
  // 大纲：一长段无关内容 + 末尾 §11（60 行规格的浓缩版）
  writeFileSync(join(proj, 'analysis', '分析大纲.md'),
    '# 分析大纲\n\n## 一、论点\n\n' + '大段论证内容。'.repeat(300) + '\n\n## 十一、写手版精简段\n\n- 论证主线：甲\n- 反方：乙\n- 字数预算：4000 字\n- 禁做项：丙\n- 承重墙：丁\n- 映射：| 论点 | 论据 |\n|---|---|\n| 论点1 | [L01] |\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 📇 索引段\n\n[D01] 甲 ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [D01] 甲\n' + '数据说明。'.repeat(200) + '\n信任级别：已发布\n')
  writeFileSync(join(ev, '分析大纲.md'), 'x')
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n' + '正文内容。'.repeat(150) + '\n')
  const r = run([join(SCRIPTS, 'token-budget.mjs'), '--project', proj, '--json'])
  assert.equal(r.code, 0, r.out.slice(0, 200))
  const j = parseJson(r)
  const byWhat = (kw) => j.static.rows.find((x) => x.what.includes(kw))
  const s11 = byWhat('§11')
  assert.ok(s11, '应给出 大纲→§11 一行')
  assert.equal(s11.leanSource, 'measured', '本夹具大纲含 §11 → measured')
  assert.ok(s11.savePct >= 50, `§11 应显著省（实测 ${s11.savePct}%）`)
  assert.ok(s11.fullTokens[0] <= s11.fullTokens[1], 'token 应给区间 [低, 高]')
  const idx = byWhat('索引段')
  assert.ok(idx && idx.leanSource === 'measured', '三卡→索引段应为 measured')
  assert.ok(idx.savePct >= 50, `索引段应显著省（实测 ${idx.savePct}%）`)
  // 缺 M-Gate-Report.json → 不给「省 100%」的假节省
  const t8 = byWhat('M 门 JSON')
  assert.ok(t8, '应给出 T8 一行')
  assert.equal(t8.savePct, null, '缺按需读目标时不得报省比（防假 100%）')
  assert.equal(t8.leanSource, 'missing')
  assert.match(t8.note, /无 M-Gate-Report/)
  rmSync(d, { recursive: true, force: true })
})

test('token-budget --roles：按角色聚合真实 tokenUsage（纯聚合数学，假 DSH_HOME 夹具）', () => {
  const d = tmp()
  const sdir = join(d, 'storages', 'session_projcache', 'sessions')
  mkdirSync(sdir, { recursive: true })
  const mk = (id, label, cacheRead, output, steps) => writeFileSync(join(sdir, `${id}.json`), JSON.stringify({
    record: {
      identity: { createdAt: 1 },
      rows: {
        title: { val: `你是论衡流水线的「${label}」` },
        subagent: { val: { identity: { label } } },
        sessionStats: { val: { steps } },
        tokenUsage: { val: { totals: { cacheReadTokens: cacheRead, uncachedInputTokens: 1000, outputTokens: output, cacheWriteTokens: 0 } } },
      },
    },
  }))
  mk('a', 'T5 写手', 8_000_000, 200_000, 50)
  mk('b', 'T7 审计', 2_000_000, 100_000, 30)
  mk('c', 'T2 数据检索', 1_000_000, 50_000, 20)
  mk('d', '审查打包与插件契约', 9_000_000, 999_999, 99)   // 非论衡角色 → 必须排除
  const r = run([join(SCRIPTS, 'token-budget.mjs'), '--roles', '--dsh-home', d, '--json'])
  assert.equal(r.code, 0, r.out.slice(0, 200))
  const j = parseJson(r)
  assert.equal(j.roles.sessionsTotal, 4, '应读到 4 个会话投影')
  assert.equal(j.roles.sessionsClassified, 3, '非论衡角色的子代理必须被排除')
  assert.equal(j.roles.subagentCacheRead, 11_000_000, '分母只计可识别角色（8M+2M+1M）')
  const t5 = j.roles.byRole.find((x) => x.role.startsWith('T5'))
  assert.equal(t5.cacheRead, 8_000_000)
  assert.equal(t5.sharePct, 72.7, `T5 占比应为 8/11=72.7%（实测 ${t5.sharePct}）`)
  assert.equal(j.roles.byRole[0].role.startsWith('T5'), true, '应按 cacheRead 降序')
  rmSync(d, { recursive: true, force: true })
})

test('token-budget：参数契约（-h exit 0 / 未知参数 exit 1+用法 / 无模式 exit 1 / 路径不存在 exit 2）', () => {
  const help = run([join(SCRIPTS, 'token-budget.mjs'), '--help'])
  assert.equal(help.code, 0, '--help 应 exit 0')
  assert.match(help.stdout, /--project/)
  assert.match(help.stdout, /--roles/)
  const bogus = run([join(SCRIPTS, 'token-budget.mjs'), '--bogus'])
  assert.equal(bogus.code, 1, '未知参数应 exit 1')
  assert.match(bogus.out, /用法/)
  const none = run([join(SCRIPTS, 'token-budget.mjs')])
  assert.equal(none.code, 1, '无模式应 exit 1')
  assert.match(none.out, /--project|--roles/)
  const missing = run([join(SCRIPTS, 'token-budget.mjs'), '--project', join(tmpdir(), 'no-such-proj-xyz')])
  assert.equal(missing.code, 2, '项目路径不存在应 exit 2')
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
  const { d, proj, fin, ev } = mkProject()
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
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
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

// ── v18.0.2 新增回归（D1 静默失效门 + 退出码契约）─────────────────────────────

test('m-gate-check M-Form-9：审 drafts/初稿-vN.md 时必须从 01-任务简报.md 取「拍板图位数」（v18.0.2 修 D1 静默失效）', () => {
  const { d, proj, fin, ev } = mkProject()
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  // 简报拍板 3 张图；初稿只标 2 个图位 → 期望 M-Form-9 报「图位不足」
  writeFileSync(join(proj, '01-任务简报.md'), '# 任务简报\n\n图位数量：3\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 📇 索引段\n\n[D01] 数值 1 ｜ 来源 ｜ 论点1\n\n## 正文\n\n### [D01] 某公报\n信任级别：已发布\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 📇 索引段\n\n[L01] 某文 ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [L01] 某文\n信任级别：已发布\n')
  const draft = join(proj, 'drafts', '初稿-v1.md')
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文 [L01][D01]。\n\n[图1：甲]\n\n[图2：乙]\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  // 审「初稿」而非 final/定稿.md —— 旧实现下 briefPath 会退回初稿自身 → pledged=0 → 该项静默不判
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev])
  const item = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-9'))
  assert.ok(item, '必须有 M-Form-9 结果项')
  assert.match(item.detail, /图位不足/, '必须从上级目录的 01-任务简报.md 取到拍板 3 张图并判「图位不足」：' + item.detail)
  assert.match(item.detail, /记为 3 张/, '报错文案必须写明拍板数来自简报')
  rmSync(d, { recursive: true, force: true })
})

test('退出码契约：路径/参数错一律 exit 10（v18.0.2 统一，防与 P1/P0 撞码）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(proj, { recursive: true })
  // m-gate-check：定稿不存在 / 证据包目录不存在 —— 旧版均为 1（= 「P1 内容失败」），会误导主控去改正文
  const g1 = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj, 'final', '定稿.md'), join(proj, 'final', '证据包')])
  assert.equal(g1.code, 10, 'm-gate-check 定稿/证据包路径不存在应 exit 10')
  assert.match(g1.out + g1.err, /定稿不存在/, '应给出可读原因')
  // final-check：项目目录不存在
  const g2 = run([join(SCRIPTS, 'final-check.mjs'), join(d, 'nope')])
  assert.equal(g2.code, 10, 'final-check 项目路径不存在应 exit 10')
  // count-chars：文件不存在 / 缺参
  const g3 = run([join(SCRIPTS, 'count-chars.mjs'), join(d, 'nope.md')])
  assert.equal(g3.code, 10, 'count-chars 文件不存在应 exit 10')
  const g4 = run([join(SCRIPTS, 'count-chars.mjs')])
  assert.equal(g4.code, 10, 'count-chars 缺参应 exit 10')
  // normalize-trust-level：缺参（其「有未决条目」仍为 1，属自有语义）
  const g5 = run([join(SCRIPTS, 'normalize-trust-level.mjs')])
  assert.equal(g5.code, 10, 'normalize-trust-level 缺参应 exit 10')
  rmSync(d, { recursive: true, force: true })
})

test('model-routing：退出码 3 已改为 4（避免与 M 门「仅 P2 可放行」撞码）', () => {
  const src = readFileSync(join(SCRIPTS, 'model-routing.mjs'), 'utf8')
  assert.ok(!/process\.exit\(3\)/.test(src), 'model-routing 不得再用 exit 3')
  assert.match(src, /process\.exit\(anyMissing \? 4 : 0\)/, '缺档位的退出码应为 4')
  assert.match(src, /返回码：0 = 三档都有主选；4 =/, '头注释必须写明新的返回码语义')
})