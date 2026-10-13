// 批 24（合并 merge 清单 §二 · 工具面）回归网：三条改动的**独立夹具 + 反向用例**
//   条目 ⑤（总表第 5/6 条）审计视图派生失真：① 字数槽位口径（全文 → 正文区）② 卡数真源
//                            ③ 信任级别分布（双标单列）＋ ④「卡头手写汇总 ≠ 逐条真源」必须**报出**
//   条目 ⑥ `methodology-check.mjs` 对文本分析型报 P0/P1：`--genre text-qualitative` 记 SKIP、不再 exit 2
//   条目 ⑩ `segment-chars.mjs --section` 容错：唯一前缀匹配 / 歧义列候选 / 未命中**带行号**全量标题
//
// 运行：node --test tests/batch24-derived-truth-and-gates.test.mjs
//
// 为什么带**反向**用例（本仓纪律：只钉一侧必然在下一轮「收紧到过严 / 放宽回旧口径」时失明）：
//   · 字数槽位：正例断言「视图值 = count-chars 的**正文区**值」；反例断言「它与全文值**必须不同**」
//     （否则夹具本身无法区分两个口径，正例就是假绿）+ 注入一份「body 塞全文」的假 count-chars → 必须响亮报出。
//   · 卡片统计：正例用项目夹具逐类对账；反例造「卡头手写 ≠ 逐条」的卡 → 脚本必须报不一致且**不采信手写值**。
//   · 体裁：`text-qualitative` 不得 exit 2（且要说明是 SKIP 不是 PASS）；`empirical-stat` 仍须报缺参项（exit 2）。
//   · `--section`：唯一前缀命中成功；歧义**报错并列候选**（不得隐式选最长/第一个）；未命中列全量标题带行号。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject } from './_fixtures.mjs'

// ── 只读夹具：项目 xingbie（主人侧真实产物；**只读**，不得改写）──────────────────────────────
const X = resolve(ROOT, '..', 'run', 'xingbie')
const X_FINAL = join(X, 'final', '定稿.md')
const X_DATA_CARD = join(X, 'data', '数据卡.md')
// 项目树不存在时整文件 skip（**带理由**）——不让环境缺件训练人无视红灯；存在时强度与逐条断言完全一致。
const X_SKIP = existsSync(X_FINAL) && existsSync(X_DATA_CARD)
  ? false
  : `只读夹具不在位（${X_FINAL} / ${X_DATA_CARD} 缺一）——本文件需 run/xingbie 项目树`

/** 把只读夹具**复制**到临时目录再用：`build-evidence-bundle` 会往项目目录写 `audits/` 与 `final/证据包/`，
 *  直跑只读夹具等于**污染**它（主人明确要求 `run/xingbie/**` 只读）。复制后两份内容逐字相同，
 *  视图里的取值与「直读只读夹具」完全一致，但写盘落在临时目录。 */
function copyFixtureProject() {
  const d = tmp('b24-copy-')
  const proj = join(d, 'xingbie')
  cpSync(X, proj, {
    recursive: true,
    filter: (src) => !/[\\/](证据包|图件)([\\/]|$)/.test(src),
  })
  return { d, proj }
}

/** 视图里的「素材卡数量」表行：`| 文献卡 [Lxx] | N | a / b / c / d | <双标与口径列> |`。 */
const VIEW_ROW_RE = (label) => new RegExp(String.raw`\| ${label} \| (\d+) \| (\d+) \/ (\d+) \/ (\d+) \/ (\d+) \|`)

/** 一句「卡内逐条独立行」的档位分布（与 build-evidence-bundle 的独立行判据同向，但**独立实现**：
 *  对账必须用两条独立读法，复用被测函数等于自证）。`+` 分段且段首为档位词才算双标。 */
const TRUST_TOKENS = ['已发布', '主人投喂', '二手转引']
function lineDistOf(cardText) {
  const dist = { 主人投喂: 0, 二手转引: 0, 已发布: 0, 未声明: 0, 双标: 0 }
  let lines = 0
  const duals = []
  for (const line of cardText.split(/\r?\n/)) {
    const m = /^\s*(?:[-*+]\s+)?\*{0,2}信任级别\*{0,2}[ \t\u3000]*[:：][ \t\u3000]*(.*)$/.exec(line)
    if (!m) continue
    lines++
    const toks = []
    for (const seg of m[1].split(/[+＋]/)) {
      const t = /^\*{0,2}[ \t\u3000]*(已发布|主人投喂|二手转引)/.exec(seg.trim())
      if (t && !toks.includes(t[1])) toks.push(t[1])
    }
    if (toks.length > 1) { dist.双标++; duals.push(line.trim().slice(0, 40)); continue }
    if (toks.length === 1) dist[toks[0]]++
  }
  return { dist, lines, duals }
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// 条目 ⑤①②③④：审计视图的三处派生值必须取自真源 + 卡头手写汇总只对账不采信
// ══════════════════════════════════════════════════════════════════════════════════════════

test('批24 §5①：审计视图字数槽位 = count-chars 的**正文区**值（且与全文值不同），卡数取索引段', { skip: X_SKIP }, () => {
  // 夹具 = **只读夹具的临时副本**（不写 run/xingbie）：视图与证据包都落在临时树里。
  const { d, proj } = copyFixtureProject()
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 0, '视图生成应 exit 0（口径自检有问题也只报不改退出码）：' + r.out.slice(0, 400))
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')

  // ① 字数槽位（真源 = count-chars.mjs 自己算的正文区值；对只读原件的计数与副本逐字相同）
  const cc = run([join(SCRIPTS, 'count-chars.mjs'), X_FINAL, '--summary'])
  assert.equal(cc.code, 0, cc.out.slice(0, 200))
  const ccj = parseJson(cc)
  const body = ccj.body.hanChars
  const full = ccj.total.hanChars
  // 反例前置（防假绿）：夹具必须能区分两个口径，否则「视图值 == 正文区」这条断言毫无判别力
  assert.notEqual(body, full, '夹具本身必须「正文区 ≠ 全文」——否则本条断言无法区分旧版（填全文）与新版')
  assert.match(view, new RegExp(String.raw`## 一、正文结构（正文区 ${body} 纯汉字`),
    `槽位必须是正文区值 ${body}（旧版填全文 ${full}）：` + view.slice(view.indexOf('## 一、'), view.indexOf('## 二、')))
  assert.doesNotMatch(view, new RegExp(String.raw`正文区 ${full} 纯汉字`), '全文值不得出现在正文区槽位')
  assert.match(view, new RegExp(String.raw`全文 ${full}`), '全文值应作为**对照**保留（不是删掉了事）')

  // ② 卡数（真源 = 卡内索引段）：同一份临时副本即可（视图已含三张卡的计数）
  const xView = view
  const litRow = VIEW_ROW_RE(String.raw`文献卡 \[Lxx\]`).exec(xView)
  const datRow = VIEW_ROW_RE(String.raw`数据卡 \[Dxx\]`).exec(xView)
  assert.ok(litRow && datRow, '视图必须有文献卡/数据卡两行：' + xView.slice(xView.indexOf('| 类型')))
  // 索引段声明必须与**行数**一致：文献卡索引段 22 行（旧版按全文编号 Set 去重得 24，把 [L00]/[L99] 也算成条目）
  const indexRows = (t) => {
    const lines = t.split(/\r?\n/)
    // 找**标题行**（`## 📇 索引段`）：只认 `#` 开头的行 —— 否则会被基本信息里那句
    //   「…索引段编号 = 实际编号」的正文（卡片第 12 行）抢先命中（实测踩过）。
    const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && /索引段/.test(l))
    if (start === -1) return 0
    const level = (lines[start].match(/^(#{1,6})/) || [, '##'])[1].length
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      const h = lines[i].match(/^(#{1,6})\s/)
      if (h && h[1].length <= level) { end = i; break }
    }
    // 索引段表行：首单元格即编号（`| [L01] | … |`）。**只在索引段节体内数**，防把正文其它表算进来。
    return lines.slice(start + 1, end).filter((l) => /^\|\s*\[?[LDC]\d+/.test(l)).length
  }
  const litIdx = indexRows(readFileSync(join(X, 'literature', '文献卡.md'), 'utf8'))
  assert.equal(Number(litRow[1]), litIdx, `文献卡卡数必须 = 索引段行数 ${litIdx}（不得 24）`)
  const datIdx = indexRows(readFileSync(X_DATA_CARD, 'utf8'))
  assert.equal(Number(datRow[1]), datIdx, `数据卡卡数必须 = 索引段行数 ${datIdx}`)

  rmSync(d, { recursive: true, force: true })
})

test('批24 §5②③：视图的信任分布 = 卡内**逐条独立行**逐类相等；双标单列且不并入单类', { skip: X_SKIP }, () => {
  // 同样用**临时副本**（只读夹具不写盘）：视图与「逐条独立行」读的是同一份卡（副本逐字相同）。
  const { d, proj } = copyFixtureProject()
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const xView = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')

  // 独立读法（本文件自己实现）逐类对账
  const card = readFileSync(X_DATA_CARD, 'utf8')
  const { dist, duals } = lineDistOf(card)
  const row = VIEW_ROW_RE(String.raw`数据卡 \[Dxx\]`).exec(xView)
  assert.ok(row, '视图必须有数据卡行')
  const got = { 主人投喂: Number(row[2]), 二手转引: Number(row[3]), 已发布: Number(row[4]), 未声明: Number(row[5]) }
  assert.deepEqual(got, { 主人投喂: dist.主人投喂, 二手转引: dist.二手转引, 已发布: dist.已发布, 未声明: dist.未声明 },
    `视图（${JSON.stringify(got)}）必须与逐条独立行（${JSON.stringify(dist)}）**逐类相等**`)
  // 三档之和 = 卡数 − 双标（双标**不并入**单类；旧口径把它静默算进「首个档位词」那一类）
  assert.equal(got.主人投喂 + got.二手转引 + got.已发布 + got.未声明 + dist.双标, Number(row[1]),
    '三档 + 双标必须等于卡数（双标单列、不重复计）')
  assert.ok(dist.双标 >= 1, '夹具必须含 ≥1 条双标独立行（否则「双标单列」这条断言是空转）')
  assert.match(xView, new RegExp(String.raw`双标 ${dist.双标}`), `视图须给出双标数 ${dist.双标}：` + xView.slice(xView.indexOf('数据卡 [Dxx]')))
  // 口径声明同行可见（口径可复查，不靠读者猜）
  assert.match(xView, /计数口径：索引段「总条数」声明/, '视图须声明卡数取自索引段声明')
  rmSync(d, { recursive: true, force: true })
})

test('批24 §5④/总表6：卡头手写汇总 ≠ 逐条真源 → 必须报出不一致，且**数值取逐条**（不采信手写）', () => {
  const { d, proj } = mkProject()
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n主题：卡头漂移夹具。\n')
  mkdirSync(join(proj, 'data'), { recursive: true })
  // 夹具：卡头手写「已发布 2」（假）／逐条独立行实为 2 条**二手转引** + 1 条**双标** → 逐条 = 二手转引 2 / 双标 1
  writeFileSync(join(proj, 'data', '数据卡.md'), [
    '# 数据卡（Dxx 系列）',
    '',
    '## 基本信息',
    '- **总条数**：3',
    '- **信任级别声明**：已发布 2 / 主人投喂 0 / 二手转引 1（手写值，与逐条不一致）',
    '',
    '## 📇 索引段',
    '',
    '| 编号 | 主题 |',
    '|---|---|',
    '| [D01] | 甲 |',
    '| [D02] | 乙 |',
    '| [D03] | 丙 |',
    '',
    '### [D01] 甲',
    '- **信任级别**：二手转引（媒体转述）',
    '',
    '### [D02] 乙',
    '- **信任级别**：二手转引（转引页）',
    '',
    '### [D03] 丙',
    '- **信任级别**：已发布（法规原文）+ 二手转引（媒体报道）',
    '',
  ].join('\n'))
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 0, r.out.slice(0, 400))
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  // ① 报出不一致（视图内 + stderr 各一处）
  assert.match(view, /卡头手写汇总与逐条真源不一致/, '视图必须显著报出卡头漂移：' + view.slice(view.indexOf('## 二、')))
  // 视图内的漂移行给出「卡头写 X，逐条独立行统计为 Y」两串值（都是**逐字段**的）
  assert.match(view, /卡头写[^\n]*已发布 2[^\n]*逐条独立行统计为[^\n]*已发布 0/, '视图须点名逐字段差异（已发布）：手写 2 vs 逐条 0')
  assert.match(view, /卡头写[^\n]*二手转引 1[^\n]*逐条独立行统计为[^\n]*二手转引 2/, '视图须点名逐字段差异（二手转引）：手写 1 vs 逐条 2')
  assert.match(r.stderr, /卡头手写汇总与逐条真源不一致/, 'stderr 也必须可见（不静默）')
  assert.match(r.stderr, /已发布 手写 2 ≠ 逐条 0/, 'stderr 须点名差异字段')
  assert.match(r.stderr, /二手转引 手写 1 ≠ 逐条 2/, 'stderr 须点名差异字段（二手转引）')
  // ② 数值取逐条（不采信手写值）：已发布 0（不是手写的 2）、二手转引 2（不是手写的 1）、双标 1
  const row = VIEW_ROW_RE(String.raw`数据卡 \[Dxx\]`).exec(view)
  assert.ok(row, '视图必须有数据卡行')
  assert.deepEqual([Number(row[1]), Number(row[2]), Number(row[3]), Number(row[4]), Number(row[5])], [3, 0, 2, 0, 0],
    '卡数 3（索引段）/ 主人投喂 0 / 二手转引 2 / 已发布 0 / 未声明 0 —— 手写值一律不采信')
  assert.match(view, /双标 1（D03）/, '双标条目须单列并点名（D03）')
  rmSync(d, { recursive: true, force: true })
})

test('批24 §5①（反向）：注入「body 塞全文」的假 count-chars → 口径自检必须**响亮报出**且视图槽位留空', () => {
  const { d, proj } = mkProject()
  const fake = join(d, 'count-chars-fake.mjs')
  // 假脚本：把 `--summary` 的 body 直接填成 total（模拟「全文冒充正文区」那一类口径回归）
  writeFileSync(fake, 'console.log(JSON.stringify({ file: process.argv[2], mode: "summary", total: { hanChars: 999 }, body: { hanChars: 999, scope: "摘要后~文末节前" } }))\n')
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n主题：口径回归注入。\n')
  // 本脚本有一条「一个源都没找到 → exit 10」的既有守卫（fail-open 修复）：夹具必须**至少有一个可复制源**，
  //   否则退出码 10 来自那条守卫、与本用例要验的「字数取不到」无关（会把守卫的失败读成口径自检的失败）。
  mkdirSync(join(proj, 'data'), { recursive: true })
  writeFileSync(join(proj, 'data', '数据卡.md'), '# 数据卡\n\n### [D01] 甲\n- **信任级别**：已发布\n')
  mkdirSync(join(proj, 'final'), { recursive: true })
  // 有文末节 → 正文区 ≠ 全文 是**合法期望**；此时假脚本报 999/999 即口径坍缩。
  //   假脚本只 `console.log` 一行 JSON（不读文件、不依赖 cwd），保证它自己必然 exit 0 —— 这样
  //   「非 0 退出」只可能来自被审脚本，测试失败原因不会与夹具混在一起。
  writeFileSync(join(proj, 'final', '定稿.md'), [
    '# 标题', '', '## 摘要', '', '摘'.repeat(30), '',
    '## 一、正文', '', '正'.repeat(60), '',
    '## 参考文献', '', '参'.repeat(20), '',
    '## 数据来源', '', '数', '',
    '## 案例来源', '', '', '## 先行者文献', '', '', '## AI 使用声明', '', 'AI。', '',
  ].join('\n'))
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary', '--source', join(proj, 'final', '定稿.md')],
    { env: { ...process.env, LUNHENG_COUNT_CHARS_SCRIPT: fake } })
  assert.equal(r.code, 0, '「视图字数口径可疑」属证据面降级，**不得**改退出码（契约 [0,10,70]）：' + r.out.slice(0, 500))
  assert.match(r.stderr, /字数口径自检失败/, '口径坍缩必须响亮报出：' + r.stderr.slice(0, 600))
  assert.match(r.stderr, /有文末节/, '报错须点明「有文末节却相等」这一形态（无文末节时相等是合法的，见下一条）')
  assert.match(r.stderr, /切片没有真正收窄/, '报错须说明成因')
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  assert.match(view, /正文区 999 纯汉字/, '槽位仍如实展示产线脚本给的值（不静默改写）')
  rmSync(d, { recursive: true, force: true })
})

test('批24 §5①（分级·反向）：**无文末节**时「正文区 = 全文」是**合法同值**——只提示、不报失败', () => {
  const { d, proj } = mkProject()
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n主题：无文末节草稿。\n')
  // 至少一个可复制源（否则会撞「一个源都没找到 → exit 10」那条既有守卫，与本用例无关）
  mkdirSync(join(proj, 'data'), { recursive: true })
  writeFileSync(join(proj, 'data', '数据卡.md'), '# 数据卡\n\n### [D01] 甲\n- **信任级别**：已发布\n')
  mkdirSync(join(proj, 'final'), { recursive: true })
  // 早期草稿：## 摘要 之后直到文件末就是全部正文（无文末五节）→ 正文区 ≡ 全文，**合法**
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n' + '摘'.repeat(30) + '\n\n## 一、正文\n\n' + '正'.repeat(20) + '\n')
  // 为什么这里也走**注入**（而不是真 count-chars）：**真脚本下「正文区 ≡ 全文」不可达**——
  //   它的正文区切片**含每一节的节标题汉字**（`_lib/sections.mjs` 的边界公式：`to` = 首个文末节标题**行首**，
  //   故文末五节之外的标题全在切片内），而全文 = 切片 + 题名 + 文末五节标题 + 文末五节正文；
  //   差集恒 ≥ 题名汉字数 ⇒ 「相等」这一形态只能靠注入复现。本用例即是**该分级分支的可达性钉**。
  const fakeEq = join(d, 'count-chars-fake-eq.mjs')
  writeFileSync(fakeEq, 'console.log(JSON.stringify({ file: process.argv[2], mode: "summary", total: { hanChars: 55 }, body: { hanChars: 55, scope: "摘要后~文末节前" } }))\n')
  const rEq = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary', '--source', join(proj, 'final', '定稿.md')],
    { env: { ...process.env, LUNHENG_COUNT_CHARS_SCRIPT: fakeEq } })
  assert.equal(rEq.code, 0, '合法同值属正常稿件，**不得**改退出码：' + rEq.out.slice(0, 300))
  assert.doesNotMatch(rEq.stderr, /字数口径自检失败/, '无文末节时相等是合法同值，**不得**报口径失败：' + rEq.stderr.slice(0, 400))
  assert.match(rEq.stderr, /尚未写文末节/, '应给一条「尚未写文末节 → 同值合法」的提示（与失败分级）：' + JSON.stringify(rEq.stderr.slice(0, 200)))
  rmSync(d, { recursive: true, force: true })
})

test('批24 §5①（分级）：真 count-chars 下「正文区 ≡ 全文」不可达——故合法同值分支由注入钉住（本用例记录该事实）', () => {
  const { d, proj } = mkProject()
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n主题：无文末节草稿。\n')
  mkdirSync(join(proj, 'data'), { recursive: true })
  writeFileSync(join(proj, 'data', '数据卡.md'), '# 数据卡\n\n### [D01] 甲\n- **信任级别**：已发布\n')
  mkdirSync(join(proj, 'final'), { recursive: true })
  // 最接近「相等」的形态：无文末节 + 题名无汉字 → 真脚本仍报「正文区 < 全文」（差集 = 各节标题汉字）
  writeFileSync(join(proj, 'final', '定稿.md'), '## 摘要\n\n' + '摘'.repeat(30) + '\n\n## 一、正文\n\n' + '正'.repeat(60) + '\n')
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  assert.doesNotMatch(r.stderr, /字数口径自检失败/, '真脚本下不得误报口径失败：' + r.stderr.slice(0, 400))
  const v = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  const m = /正文区 (\d+) 纯汉字｜全文 (\d+)/.exec(v)
  assert.ok(m, '视图须给出正文区/全文两个值：' + v.split('\n').find((l) => /正文区/.test(l)))
  assert.ok(Number(m[1]) < Number(m[2]), `正文区(${m[1]}) 必须严格小于全文(${m[2]})——差值 = 节标题汉字`)
  rmSync(d, { recursive: true, force: true })
})

// ══════════════════════════════════════════════════════════════════════════════════════════
// 条目 ⑥：methodology-check 的体裁分档（text-qualitative 记 SKIP，不再报 P0/P1）
// ══════════════════════════════════════════════════════════════════════════════════════════

test('批24 §6：--genre text-qualitative 下 M-Form-12/M-Exist-11 记 SKIP、不再 exit 2（0/1/2 都不许）', { skip: X_SKIP }, () => {
  const r = run([join(SCRIPTS, 'methodology-check.mjs'), X_FINAL, '--genre', 'text-qualitative'])
  assert.notEqual(r.code, 2, '文本分析型不得再报 P0（exit 2）——正是本条反哺的病灶：' + r.out.slice(0, 300))
  assert.notEqual(r.code, 1, '也不得报 P1（exit 1）')
  assert.notEqual(r.code, 0, 'SKIP ≠ PASS：本门未检，**不得**产出干净的 exit 0')
  assert.equal(r.code, 3, 'SKIP 应落到已登记末档 3（需人工复核）；不新增退出码：' + r.out.slice(0, 300))
  const j = parseJson(r)
  assert.equal(j.overall.pass, false, 'SKIP 不计入 pass')
  assert.equal(j.overall.exitCode, 3)
  assert.equal(j.checks['M-Form-12'].severity, 'SKIP', 'M-Form-12 记 SKIP')
  assert.equal(j.checks['M-Exist-11'].severity, 'SKIP', 'M-Exist-11 记 SKIP')
  for (const k of ['M-Form-12', 'M-Exist-11']) {
    assert.match(j.checks[k].note, /SKIP（N\/A）/, `${k} 的 note 须写明 N/A：` + j.checks[k].note)
    assert.match(j.checks[k].note, /不得读作「已通过」/, `${k} 的 note 须禁止被读成通过`)
  }
})

test('批24 §6（反向）：--genre empirical-stat 仍须报缺参项（退出码与缺省一致，不得被豁免口径吃掉）', { skip: X_SKIP }, () => {
  const dft = run([join(SCRIPTS, 'methodology-check.mjs'), X_FINAL])
  const emp = run([join(SCRIPTS, 'methodology-check.mjs'), X_FINAL, '--genre', 'empirical-stat'])
  assert.equal(emp.code, dft.code, '`empirical-stat` 必须与不传 --genre 同判（不得因新档位而放宽）')
  assert.equal(emp.code, 2, '实证统计型仍须报 P0（方法节参数缺 4 项）：' + emp.out.slice(0, 300))
  const j = parseJson(emp)
  assert.equal(j.checks['M-Form-12'].severity, 'P0', 'M-Form-12 仍须 P0')
  assert.equal(j.checks['M-Exist-11'].severity, 'P1', 'M-Exist-11 仍须 P1')
  assert.ok(j.checks['M-Form-12'].missing.length > 0, '必须点出缺哪些参数项')
  // 既有文类 code 档位不得被新档位改动（向后兼容）
  const hum = run([join(SCRIPTS, 'methodology-check.mjs'), X_FINAL, '--genre', 'academic-hum'])
  assert.equal(hum.code, 0, '`academic-hum`（v18.73.0 既有口径）行为必须保持不变（N/A + exit 0）')
})

// ══════════════════════════════════════════════════════════════════════════════════════════
// 条目 ⑩：segment-chars --section 的唯一前缀匹配 / 歧义 / 未命中清单
// ══════════════════════════════════════════════════════════════════════════════════════════

test('批24 §10：--section 唯一前缀命中（"2 文献回顾" → "2 文献回顾与研究缺口"），并回显实际标题', { skip: X_SKIP }, () => {
  const r = run([join(SCRIPTS, 'segment-chars.mjs'), X_FINAL, '--section', '2 文献回顾'])
  assert.equal(r.code, 0, '唯一前缀必须命中（旧版此处 exit 10）：' + r.out.slice(0, 300))
  const j = parseJson(r)
  assert.equal(j.sections.length, 1)
  assert.equal(j.sections[0].title, '2 文献回顾与研究缺口', 'JSON 须回显**实际**标题（调用方看得见命中了谁）')
  assert.equal(j.sections[0].selector, '2 文献回顾')
  assert.ok(j.sections[0].hanChars > 0, '节字数应 > 0')
  assert.equal(j.sections[0].startLine, 19, '起始行号（1-based）')
  // 纯段号前缀（"2"）在本稿里**同时**命中 H2「2 文献回顾与研究缺口」与 H3「2.1/2.2/2.3 …」
  //   → 按「唯一命中才采用」口径必须**报错并列候选**（旧实现 findIndex 静默取首个 = 按文档顺序猜一个）
  const amb = run([join(SCRIPTS, 'segment-chars.mjs'), X_FINAL, '--section', '2'])
  assert.equal(amb.code, 10, '段号前缀（"2"）在本稿歧义 → 必须 exit 10：' + amb.out.slice(0, 300))
  assert.match(amb.stderr, /歧义/, 'stderr 须写明「歧义」')
  for (const t of ['2 文献回顾与研究缺口', '2.1 极化的测量传统及其边界', '2.2 边界工作：从科学划界到平台划界', '2.3 平台治理研究与中国语境']) {
    assert.match(amb.stderr, new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `候选须列出：${t}`)
  }
  // 全等标题照旧
  const exact = parseJson(run([join(SCRIPTS, 'segment-chars.mjs'), X_FINAL, '--section', '2 文献回顾与研究缺口']))
  assert.equal(exact.sections[0].hanChars, j.sections[0].hanChars, '全等与唯一前缀必须量到同一节、同一字数')
})

test('批24 §10（反向）：前缀命中 ≥2 条 → 报错并列候选（不得隐式选最长/第一个）', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, '## 甲一 起始\n内容一。\n## 甲二 收束\n内容二。\n')
  const r = run([join(SCRIPTS, 'segment-chars.mjs'), f, '--section', '甲'])
  assert.equal(r.code, 10, '歧义必须 exit 10（静默选一条 = 量错节而无人知）：' + r.out.slice(0, 300))
  assert.match(r.stderr, /歧义/, 'stderr 须写明「歧义」')
  assert.match(r.stderr, /甲一 起始/, '须列出候选①')
  assert.match(r.stderr, /甲二 收束/, '须列出候选②')
  // 同一条输入给出完整标题后必须命中（证明报错给出的候选是可直接照抄的）
  const ok = run([join(SCRIPTS, 'segment-chars.mjs'), f, '--section', '甲二 收束'])
  assert.equal(ok.code, 0, ok.out.slice(0, 200))
  assert.equal(parseJson(ok).sections[0].hanChars, 3, '「内容二」3 字')
  rmSync(d, { recursive: true, force: true })
})

test('批24 §10（反向）：未命中 → exit 10 + **全量**标题清单**带行号**（不再截断前 40 / 不再无行号）', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  // 60 个 H2：旧版只印前 40 个；本用例把它拉过截断线，并要求每行都带行号
  const titles = Array.from({ length: 60 }, (_, i) => `## 第${i + 1}节\n内容${i + 1}。`)
  writeFileSync(f, titles.join('\n'))
  const r = run([join(SCRIPTS, 'segment-chars.mjs'), f, '--section', '不存在的选择器'])
  assert.equal(r.code, 10, '未命中 → 10')
  assert.match(r.stderr, /可用标题/, 'stderr 须给可用标题清单')
  const listed = r.stderr.split(/\r?\n/).filter((l) => /^\s*\d+: #+ /.test(l))
  assert.equal(listed.length, 60, `清单必须是**全量**（60 条，旧版截断到 40）；实测 ${listed.length} 条`)
  assert.match(listed[0], /^\s*1: ## 第1节$/, '第一行须是「行号: level 标题」形态：' + listed[0])
  assert.match(listed[59], /^\s*119: ## 第60节$/, '最后一行行号须正确（60 节 × 2 行 − 1）：' + listed[59])
  rmSync(d, { recursive: true, force: true })
})

test('批24 §10（向后兼容）：选择器「分隔符前缀」旧行为不变（"3.6" 命中 "3.6 反方论证"）', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, '## 3.6 反方论证\n反驳甲。\n## 3.7 补强\n补强乙。\n')
  const r = run([join(SCRIPTS, 'segment-chars.mjs'), f, '--section', '3.6'])
  assert.equal(r.code, 0, r.out.slice(0, 200))
  const j = parseJson(r)
  assert.equal(j.sections[0].title, '3.6 反方论证')
  assert.equal(j.sections[0].hanChars, 3, '「反驳甲」3 字')
  rmSync(d, { recursive: true, force: true })
})
