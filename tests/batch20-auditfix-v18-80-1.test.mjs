// v18.80.1（全量审查修订批）**第 0 批**回归网。
//
// 为什么需要这一组：v18.80.1 全量审查在「8 门全绿 + 794 用例全绿」之下仍找出 ≥20 处可复现逻辑缺陷。
//   根因不是「没测试」，而是**测试只断言了作者写实现时想到的形态**——模板的真实写法、带序号的标题、
//   `M-Exist-10/11` 这类同前缀标签，都属于**反向形态**，系统性缺席。
//   本文件按「反向形态」逐条钉住第 0 批修复，每条都注明**修复前的实测形态**（即本用例在修复前必红）。
//
// 覆盖：B1 已跳过段被 `###` 截断 / B2 硬红线正则的标签边界 / B3 交接报告模板形态（含 §6 括注）
//   / B4 带序号文末节（成员资格 **与顺序映射**）/ B5 门内读取失败的 ERROR 档 / B9 扩展编号未闭环
//   / B11 嵌套围栏 / B12 按行替换 / F5 B2 披露的裸子串判据。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, ROOT, run, parseJson, tmp, mkProject } from './_fixtures.mjs'
import { titleMatches, maskFences } from '../skills/lunheng-article-pipeline/scripts/_lib/sections.mjs'
import { mForm2, mForm7 } from '../skills/lunheng-article-pipeline/scripts/_lib/mgate-gates/mform-gates.mjs'

const S = (...p) => join(SCRIPTS, ...p)
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')
const gateOf = (results, prefix) => results.find((r) => String(r.gate || '').startsWith(prefix))

// ─────────────────────────── B4 · 序号是排版前缀 ───────────────────────────

test('B4：titleMatches 剥离「五、」「9、」「4.1」式前缀，且不得误伤「第一作者声明」', () => {
  assert.equal(titleMatches('五、参考文献', '参考文献'), true)
  assert.equal(titleMatches('9、AI 使用声明', 'AI 使用声明'), true)
  assert.equal(titleMatches('4.1 数据来源', '数据来源'), true)
  assert.equal(titleMatches('参考文献', '参考文献'), true, '无前缀的既有语义必须保留')
  assert.equal(titleMatches('数据来源说明', '数据来源'), true, '前缀匹配语义必须保留')
  assert.equal(titleMatches('第一作者声明', '作者声明'), false, '「一」后紧跟汉字不得剥离（防误伤，见 sections.mjs 判据）')
})

test('B4：带序号的九节文末 → M-Form-2 与 M-Form-7 都必须 pass', () => {
  // 修复前：裸 `startsWith` → M-Form-2 报「缺失: 参考文献,…」P0、M-Form-7 报「文末无任何白名单节」P0
  //   （两者都是不可兜底的硬红线），而同一次运行的正文区切分（firstEndnoteIndex）却承认它们。
  const h2s = ['摘要', '五、参考文献', '六、数据来源', '七、案例来源', '八、先行者文献', '九、AI 使用声明']
  const ctx = { h2s, firstIdx: 1, results: [] }
  mForm2(ctx)
  mForm7(ctx)
  const f2 = gateOf(ctx.results, 'M-Form-2')
  const f7 = gateOf(ctx.results, 'M-Form-7')
  assert.equal(f2.pass, true, `M-Form-2 不得误报：${f2.detail}`)
  assert.equal(f7.pass, true, `M-Form-7 不得误报：${f7.detail}`)
})

test('B4 反向（顺序映射的「另一半」）：带序号但顺序违规 → M-Form-7 仍须报 P1', () => {
  // 只改成员资格而不改顺序映射，会因 `findIndex` 返回 -1 被 `.filter` 掉 → `seq` 塌成空
  //   → 「顺序违规」永不触发：**把一次修复变成一处新的静默放行**。本用例正是钉住那另一半。
  const h2s = ['摘要', '五、数据来源', '六、参考文献', '七、案例来源', '八、先行者文献', '九、AI 使用声明']
  const ctx = { h2s, firstIdx: 1, results: [] }
  mForm7(ctx)
  const f7 = gateOf(ctx.results, 'M-Form-7')
  assert.equal(f7.pass, false, '顺序违规（数据来源 在 参考文献 之前）必须报')
  assert.equal(f7.severity, 'P1', `顺序违规的档位应为 P1，实得 ${f7.severity}`)
  assert.match(f7.detail, /顺序违规/)
})

// ─────────────────────────── B11 · 嵌套围栏 ───────────────────────────

test('B11：带 info string 的内层开栏不得提前结束围栏遮罩', () => {
  // 修复前：`^ {0,3}`{3,}` 无「其后仅空白」约束 → ```` ```js ```` 被当成闭合栅栏
  //   → 围栏内的 `## 参考文献` 被提升为**真**文末节（实测 count-chars 正文区 356 vs 378）。
  const nested = '```markdown\n```js\n## 参考文献\n```\n'
  assert.ok(!maskFences(nested).includes('## 参考文献'), '内层开栏行不得作为闭合栅栏')
  // 对照组（既有语义必须保留）：无内层开栏时同样遮罩
  assert.ok(!maskFences('```markdown\n## 参考文献\n```\n').includes('## 参考文献'))
  // 反向对照：真正的闭合行之后，标题必须重新可见
  assert.ok(maskFences('```\n正文\n```\n## 参考文献\n').includes('## 参考文献'), '围栏外的标题必须保持可见')
})

// ─────────────────────────── B2 · 硬红线的标签边界 ───────────────────────────

test('B2：硬红线正则必须有标签边界，且不得把 LLM 兜底/ERROR 计为红线', () => {
  const src = read('skills', 'lunheng-article-pipeline', 'scripts', 'm-gate-check.mjs')
  const m = src.match(/const HARD_RED_LINE_RE = (\/.+\/);/)
  assert.ok(m, '未找到 HARD_RED_LINE_RE 定义（若契约变更，须同批更新本用例）')
  const re = new Function(`return ${m[1]}`)()   // 用**实际发布的正则**，而非测试里另写一份

  assert.equal(re.test('M-Form-2 文末必需五节存在性'), true)
  assert.equal(re.test('M-Form-7 文末白名单'), true)
  assert.equal(re.test('M-Exist-1 引用双向对比'), true)
  assert.equal(re.test('M-Integrity-1 T2.5 完整性'), true)
  // 修复前无边界：这两条会被误当红线 → 只有 P2/P1 的稿子在 `--adjudicate` 上一律 exit 30
  assert.equal(re.test('M-Exist-10 大纲 §11 精简段'), false, 'M-Exist-10 不在红线 4 类内')
  assert.equal(re.test('M-Exist-11 反方论证闭合'), false, 'M-Exist-11 不在红线 4 类内')
  // 排除「本项交 LLM 判断」与「门没跑通」两档（把前者列为「不允许 LLM 兜底」自相矛盾）
  assert.match(src, /NON_ADJUDICABLE_SEVERITIES = new Set\(\['LLM 兜底', 'ERROR'\]\)/,
    '硬红线必须排除 LLM 兜底 / ERROR 两档')
})

// ─────────────────────────── B3 + F5 · 交接门与自己的模板同形 ───────────────────────────

test('B3：逐字照 `交接报告-template.md` 形态（含 §6 括注）的回报不得被判「缺段」', () => {
  // 修复前的两种反向形态，本条都要挡住：
  //   ① `## 1. 做了什么`（段名前的 `N. `）→ 旧 SEG_RE 不认 → 六段全误报；
  //   ② `## 6. 状态机更新（**建议变更，由主控执行**）`（段名后括注）→ 只补 ① 仍不认。
  const { proj } = mkProject({ prefix: 'lunheng-b3-' })
  const rep = [
    '## 1. 做了什么', '跑了三线检索。', '',
    '## 2. 产物在哪', '`run/proj/literature/文献卡.md`', '',
    '## 3. 怎么验证', '脚本 exit 0；抽 3 条 URL 可搜到。', '',
    '## 4. 已知问题', '无', '',
    '## 5. 下一步', '无', '',
    '## 6. 状态机更新（**建议变更，由主控执行**）', '请主控把 T1 行置为 Done。', '',
    '## 7. AI 使用披露（v2.2.2 新增）', '### AI 使用披露', '- ① AI 生成内容：文献卡由论衡 AI 生成', '',
  ].join('\n')
  const p = join(tmp('lunheng-b3-rep-'), 'report.md')
  writeFileSync(p, rep)
  const r = run([S('handoff-check.mjs'), '--project', proj, '--role', 'T1', '--report-file', p])
  assert.ok(!/缺段/.test(r.stdout + r.stderr),
    `模板形态的合规回报被判缺段（门拒绝自己发的模板）：\n${r.stdout}\n${r.stderr}`)
})

test('F5 反向：仅出现「披露」二字（不在披露段）→ 不得满足 T5/T8 的硬披露要求', () => {
  // 修复前 `/AI 使用|披露/` 只要求词出现过：把「披露」写进「已知问题」行即满足**硬**要求。
  const { proj } = mkProject({ prefix: 'lunheng-f5-' })
  const rep = [
    '## 1. 做了什么', '写作。', '',
    '## 2. 产物在哪', '`drafts/初稿-v1.md`', '',
    '## 3. 怎么验证', 'exit 0', '',
    '## 4. 已知问题', '无（数据来源披露见数据卡）。', '',
    '## 5. 下一步', '无', '',
    '## 6. 状态机更新', '置 Done。', '',
  ].join('\n')
  const p = join(tmp('lunheng-f5-rep-'), 'report.md')
  writeFileSync(p, rep)
  const r = run([S('handoff-check.mjs'), '--project', proj, '--role', 'T5', '--report-file', p])
  assert.match(r.stdout + r.stderr, /B2/,
    '§4 里的「披露」二字不得代替 AI 使用披露段（B2 必须仍判硬）')
})

// ─────────────────────────── B5 · 门内失败一律 ERROR ───────────────────────────

test('B5：M-Integrity-1 的「脚本跳过」档必须记 ERROR（exit 70 才可达）', () => {
  const src = read('skills', 'lunheng-article-pipeline', 'scripts', '_lib', 'mgate-gates', 'mintegrity-gate.mjs')
  assert.match(src, /scriptSkipHits > 0 \? 'ERROR' : 'LLM 兜底'/,
    '读取/解析失败须记 ERROR；记 P1 会被 final-check 读成「P1 残留」并触发一轮付费修订')
  assert.ok(!/scriptSkipHits > 0 \? 'P1'/.test(src), '旧的 P1 档必须已移除（不得两档并存）')
})

// ─────────────────────────── B9 · 扩展编号未闭环须有退出码信号 ───────────────────────────

test('B9：`[脚注-N]` 未双向闭环 → M-Exist-1 必须 pass=false 且 P1', () => {
  // 修复前：`extLeaked`/`extOrphan` 既不在 `pass` 也不在 severity → 只在 detail 里可见，退出码信号为 0。
  const { proj, fin, ev } = mkProject({ prefix: 'lunheng-b9-' })
  void proj
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文引用了 [脚注-1]。\n\n'
    + '## 参考文献\n\n- [L01] x\n\n## 数据来源\n\n- [D01] y\n\n## 案例来源\n\n- [C01] z\n\n'
    + '## 先行者文献\n\n- [先01] w\n\n## AI 使用声明\n\n- AI。\n')
  const r = run([S('m-gate-check.mjs'), draft, ev])
  const out = parseJson(r)
  const item = gateOf(out.results || [], 'M-Exist-1')
  assert.ok(item, `报告里须有 M-Exist-1 项：${r.stdout.slice(0, 400)}`)
  assert.equal(item.pass, false, `未闭环的扩展编号必须使该门 fail：${item.detail}`)
  assert.equal(item.severity, 'P1', `档位应为 P1，实得 ${item.severity}`)
})

// ─────────────────────────── B1 / B12 · 源码钉（行为面用例已登记为待办） ───────────────────────────

test('B1：M-Form-11 的两处段边界必须同为 `/^##\\s/`（`###` 不得截断「已跳过」）', () => {
  const src = read('skills', 'lunheng-article-pipeline', 'scripts', '_lib', 'mgate-gates', 'mform-gates.mjs')
  const boundaries = [...src.matchAll(/sectionRange\(ls2,\s*h\w*,\s*(\/\^#+\s*\\s\/)\)/g)].map((m) => m[1])
  assert.ok(boundaries.length >= 2, `须至少两处段边界（已加载 / 已跳过），实得 ${JSON.stringify(boundaries)}`)
  for (const b of boundaries) {
    assert.equal(b, '/^##\\s/', `段边界必须统一为 /^##\\s/（否则「###」子节会截断清单 → F3/F26 硬检查变空转）：实得 ${b}`)
  }
})

test('B12：refresh-gates 的替换必须按行（不得再按值全局 split）', () => {
  const src = read('skills', 'lunheng-article-pipeline', 'scripts', 'refresh-gates.mjs')
  assert.match(src, /if \(!CONTEXT_RE\.test\(lines\[i\]\)\) continue;/,
    '替换必须复用与「收集」同一个行内语境守卫')
  assert.ok(!/const parts = text\.split\(oldSha\)/.test(src),
    '不得再按值全局替换（会改写非语境行里同值的 manifest 条目 sha256，且 count 虚高）')
})

// ─────────────────────────── A1 · 速查卡的 KB 数必须派生（不得手写） ───────────────────────────

test('A1：速查卡不得复述实测 KB（复述即漂），且必须留下取数指针', () => {
  const card = read('docs', 'quick-facts.md')
  assert.ok(!/实测\s*≈\s*\d+(?:\.\d+)?\s*KB/.test(card),
    '卡上不得出现「实测 ≈ N KB」——实测值随**每次文档改动**变化；v18.80.1 实测三个 KB 数全漂（71 / 70.4 / 1371）')
  assert.match(card, /逐轮以\s*`repo-hygiene-check`/,
    '须留下「逐轮以 `repo-hygiene-check` ⑨ 输出为准」的取数指针，否则读者无从取得实测值')
})

test('A1：速查卡的常驻上限 / 词预算合计上限 == 真源派生值', () => {
  // 与规则 ㊲ ⑤ 同法派生（这条用例是「门之外的第二双眼睛」：门自己坏了也还能抓到卡漂）。
  // v18.80.1：`DOC_BUDGET` 已**外移**到 `scripts/_lib/doc-budget-reasons.mjs`（`ALWAYS_LIMIT` 仍在主门文件），
  //   故本条读**两个**真源。⚠️ 解析不到时**必须显式失败**——静默按 0 计会让本用例悄悄变成空跑
  //   （这正是审查报告 §C1「覆盖面静默收窄」那一族，本用例自己也不许犯）。
  const rh = read('scripts', 'repo-hygiene-check.mjs')
  const budget = read('scripts', '_lib', 'doc-budget-reasons.mjs')
  const alwaysLimit = Number(rh.match(/const ALWAYS_LIMIT\s*=\s*(\d+)/)?.[1])
  const blockMatch = budget.match(/const DOC_BUDGET\s*=\s*\{[\s\S]*?\n\}/)
  assert.ok(Number.isFinite(alwaysLimit),
    '须能从 `scripts/repo-hygiene-check.mjs` 解析出 `ALWAYS_LIMIT`（真源搬迁时须同批更新本用例）')
  assert.ok(blockMatch,
    '须能从 `scripts/_lib/doc-budget-reasons.mjs` 解析出 `const DOC_BUDGET = {…}`（v18.80.1 外移后的位置）')
  const block = blockMatch[0]
  let sumLimit = 0
  for (const m of block.matchAll(/^\s*'([^']+)':\s*\[\s*(\d+)/gm)) {
    if (existsSync(join(ROOT, m[1]))) sumLimit += Number(m[2])
  }
  assert.ok(sumLimit > 0, `合计上限派生值须 > 0（实得 ${sumLimit}）——为 0 说明解析面已失效`)
  const card = read('docs', 'quick-facts.md')
  const hits = [...card.matchAll(/合计上限\s*\*{0,2}(\d+(?:\.\d+)?)\s*KB/g)].map((m) => Number(m[1]))
  assert.equal(hits.length, 2, `卡上须有两处「合计上限 N KB」（常驻 + 词预算），实得 ${JSON.stringify(hits)}`)
  assert.equal(hits[0], Number((alwaysLimit / 1024).toFixed(1)), `常驻集合计上限须 == ALWAYS_LIMIT/1024 = ${(alwaysLimit / 1024).toFixed(1)}`)
  assert.equal(hits[1], Number((sumLimit / 1024).toFixed(1)), `词预算合计上限须 == DOC_BUDGET 上限之和/1024 = ${(sumLimit / 1024).toFixed(1)}`)
})
