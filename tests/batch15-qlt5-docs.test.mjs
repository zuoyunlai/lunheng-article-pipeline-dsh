// v18.51.0（QLT-5 实测反哺批次 3）**协议与约定的落点**回归：F-AI / F-Z / F-AZ / F-AP / F-AT / F-AX / F-AC / F-AQ / F-AD / F-AE
//
// 本批与前两批的分工：批次 1 改**读数**、批次 2 改**判据**，本批 10 条全是「机制里没有这条约定」或
//   「约定写在运行期读不到的地方」→ 用例形态是**文档契约断言**（条文在不在、在不在读得到的那份卡里），
//   外加两类**真机械断言**：
//     ① F-AD：新的「算式」行不得打断 M-Exist-6 的总分正则，且算术自相矛盾仍须被抓（口径只许变清、不许变软）；
//     ② 行引用守卫：本批新写的 `文件:行号` 引用必须逐条指向它声称的内容——「引错规则原文」正是 F-Z 的病灶。
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, tmp } from './_fixtures.mjs'

const SKILL = join(ROOT, 'skills', 'lunheng-article-pipeline')
const read = (...p) => readFileSync(join(SKILL, ...p), 'utf8')
const lines = (...p) => read(...p).split('\n')

// ── F-AI：G14 自检口径必须与终闸同源（旧版自检口径一律窄于终闸：1 vs 10 / 1-2 处 vs 22 处） ──
test('05 卡（F-AI）：G14 自检硬约束必须要求「可复算形态」，并写明零 exec', () => {
  const w = read('references', 'agents', '05-写作-writer.md')
  assert.match(w, /G14 自检的「口径」必须与终闸同源/, '缺「口径同源」这条硬约束')
  assert.match(w, /逐处列出行号 \+ 该行原文片段/, 'C 类须逐处列行号 + 原文片段（不许只给总数）')
  assert.match(w, /装饰性 \/ 半装饰 \/ 功能性/, 'E 类须给三分计数')
  assert.match(w, /推理判定、零 exec/, '必须声明与「写手不调 shell」同口径（零 exec）')
})

// ── F-Z：「不用改 / 属豁免」是主张，举证责任在主张方 ──
test('07 卡（F-Z）：「不用改」类判定必须要求规则原文位置 + 逐字机器读数', () => {
  const a = read('references', 'agents', '07-审计-auditor.md')
  assert.match(a, /「不用改」比「已改好」更需要证据/, '缺 F-Z 铁律')
  assert.match(a, /规则原文位置/, '须要求 `文件:行号`')
  assert.match(a, /逐字引用该处的机器读数/, '须要求逐字引用机器读数（不是只抄汇总）')
})

// ── F-AZ：自指字段必然过期 —— 报告不得自报自身 sha/字节（实测两例） ──
test('F-AZ：07 卡禁自报指纹 / 05 卡一节一时点 / 00 卡主控不转引自指字段', () => {
  const a = read('references', 'agents', '07-审计-auditor.md')
  assert.match(a, /报告不自报自身指纹/, '缺「报告不自报自身指纹」铁律')
  assert.match(a, /不是「可能漂移」，而是\*\*必然过期\*\*/, '须写明判据：必然过期而非可能漂移')
  const w = read('references', 'agents', '05-写作-writer.md')
  assert.match(w, /元信息「一节一时点」/, '05 卡缺修订说明的时点约定')
  assert.match(w, /两代状态/, '须点明「同文件不得同时存在两代状态」')
  const c = read('references', 'agents', '00-主控-扩展职责.md')
  assert.match(c, /主控不转引自指字段/, '00 卡缺消费侧义务')
})

// ── F-AP：亲修必须回写「正文真源」（否则下一轮以 drafts/ 起跑时修复静默丢失） ──
test('08 卡（F-AP）：亲修后必须回写正文真源，或改派发对象并声明', () => {
  const f = read('references', 'agents', '08-终检-finalizer.md')
  assert.match(f, /亲修必须回写「正文真源」/, '缺 F-AP 铁律')
  assert.match(f, /正文的真源在哪？我改的是不是它？/, '缺那句当场自问')
  assert.match(f, /drafts\/初稿-vN\.md/, '须点名要回写的对象')
})

// ── F-AT：G14 Warning 的触发轮与 B 轨预算的时序缺口 → 必须写明降级路径 ──
test('14 闸（F-AT）：必须写明「配额耗尽时的降级路径」，且不得引用不存在的交付说明字段', () => {
  const g = read('references', 'gates', '14-中文AI痕迹-gate.md')
  assert.match(g, /配额耗尽时的降级路径/, '缺 F-AT 降级路径')
  assert.match(g, /门的义务是/, '缺判据句')
  assert.match(g, /把档位刷绿/, '缺判据句的后半')
  assert.match(g, /Acknowledged Limitation/, '降级落点须是已披露风险（局限性 + 交付说明 §3）')
  // 反例回归：本批初稿曾指向 `交付说明` 的「必须随交付告知主人的 N 件事」——该字段在 §12 字段体系里不存在
  assert.equal(/必须随交付告知主人的/.test(g), false, '不得引用不存在的交付说明字段（幻觉字段）')
})

// ── F-AX：主人放开硬上限时的三步协议（辨名 → 记例外不动数值 → 读数冻结 + 投递读数并列） ──
test('F-AX：00 卡三步协议 + maintainers 指针（授权与测量纪律分离）', () => {
  const c = read('references', 'agents', '00-主控-扩展职责.md')
  assert.match(c, /「主人放开硬上限」时的标准三步协议/, '缺 F-AX 三步协议')
  for (const kw of ['辨名', '主人显式授权例外', '投递读数', '单侧追加']) {
    assert.ok(c.includes(kw), `三步协议缺要素：${kw}`)
  }
  assert.match(c, /主人可以放开「你能做多少轮」，但不能顺手放开「你拿什么当证据」/, '缺判据句')
  const m = read('references', 'maintainers.md')
  assert.match(m, /「主人放开硬上限」≠ 授权改机制数值/, 'maintainers 缺相邻指针条款')
})

// ── F-AC：T9 六维评分口径（求和 vs 加权）必须落盘声明 ──
test('09 卡（F-AC）：整合员协议必须声明「判定口径 = 求和，加权不是判定量」', () => {
  const r = read('references', 'agents', '09-审稿-peer-reviewer.md')
  assert.match(r, /评分口径声明/, '缺口径声明')
  assert.match(r, /判定口径 = 六维之和/, '须把判定口径钉在 /30 和值上')
  assert.match(r, /加权平均（`x\.xx\/5`）不是判定量/, '须显式否定加权为判定量')
  assert.match(r, /同一文稿同一时点/, '须带实测反例（同稿同时点分裂 1 档）')
})

// ── F-AD：总分行必须写出算式；且（机械层）新写法不得打断 M-Exist-6 ──
test('09 卡（F-AD）：总评分后必须写「算式」，逐项相加', () => {
  const r = read('references', 'agents', '09-审稿-peer-reviewer.md')
  assert.match(r, /逐项写出六维分值再相加/, '缺算式要求')
  assert.match(r, /4\+4\+3\+3\+4\+4 = 22/, '算式示例缺失（实测反例须留痕）')
})

/** 造一个只有 `final/定稿.md` + `audits/审稿报告-v1.md` 的最小项目，直调 mExist6。 */
const mkReview = (reportText) => {
  const d = tmp('lunheng-b15-')
  const proj = join(d, 'run', 'p')
  mkdirSync(join(proj, 'final'), { recursive: true })
  mkdirSync(join(proj, 'audits'), { recursive: true })
  const draftPath = join(proj, 'final', '定稿.md')
  writeFileSync(draftPath, '# 标题\n\n## 摘要\n\n正文。\n')
  writeFileSync(join(proj, 'audits', '审稿报告-v1.md'), reportText)
  return { d, proj, draftPath }
}
const runMExist6 = async (f) => {
  const { mExist6 } = await import(pathToFileURL(join(SCRIPTS, '_lib', 'mgate-gates', 'mexist-gates.mjs')).href)
  const results = []
  mExist6({
    draftPath: f.draftPath,
    auditsDirOf: () => join(f.proj, 'audits'),
    skillRoot: SKILL,
    results,
  })
  const r = results.at(-1)
  assert.ok(r, 'mExist6 必须推一条结果')
  return String(r.detail)
}
/** 六维 4/4/3/3/4/4 = 22（与 F-AD 的实测反例同形）。
 *  `withTotalLines=false` → 连 `总评分` / `总分` 两行一起去掉，只留算式行（用于「算式不替代总分行」的反向用例）。 */
const REPORT = (totalLine, exprLine, { withTotalLines = true } = {}) => [
  '# 审稿报告 — p',
  '',
  ...(withTotalLines ? [`> **总评分**：${totalLine}`, ''] : []),
  '## 评审维度',
  '',
  '#### 1. 原创性（4/5）',
  '#### 2. 方法论（4/5）',
  '#### 3. 证据强度（3/5）',
  '#### 4. 论证结构（3/5）',
  '#### 5. 写作质量（4/5）',
  '#### 6. 引文规范（4/5）',
  '',
  ...(withTotalLines ? ['### 总评', '', `- **总分**：${totalLine}`] : []),
  exprLine,
  '',
  '- **建议**：minor revision（小修后投稿）',
  '',
].join('\n')

test('mexist-gates（F-AD 机械）：新增「算式」行不得打断总分行解析', async () => {
  const f = mkReview(REPORT('22/30', '- **算式**：4+4+3+3+4+4 = 22'))
  try {
    const detail = await runMExist6(f)
    assert.equal(/缺「总评分 XX\/30」/.test(detail), false, '算式行不得让总分正则失配：' + detail)
    assert.equal(/自相矛盾/.test(detail), false, '同值不得被判自相矛盾：' + detail)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('mexist-gates（F-AD 机械）：算式**不替代**总分行——只写算式仍须判缺总评分', async () => {
  const f = mkReview(REPORT('22/30', '- **算式**：4+4+3+3+4+4 = 22', { withTotalLines: false }))
  try {
    const detail = await runMExist6(f)
    assert.match(detail, /缺「总评分 XX\/30」/, '算式是补充、不是替代（口径只许变清，不许变松）：' + detail)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('mexist-gates（F-AD 反向控制组）：写了算式也**不豁免**算术自相矛盾', async () => {
  const f = mkReview(REPORT('23/30', '- **算式**：4+4+3+3+4+4 = 22'))
  try {
    const detail = await runMExist6(f)
    assert.match(detail, /≠ 6 维之和 22/, '自报 23 而六维加出 22 仍须判自相矛盾（F-AD 实测反例）：' + detail)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

// ── F-AQ：阶段产物写入权（坑位）——工具层不校验阶段身份，只能靠协议 ──
test('pipeline-readme（F-AQ）：必须有「阶段产物写入权（坑位）清单」并逐项指明唯一写入者', () => {
  const p = read('references', 'pipeline-readme.md')
  assert.match(p, /阶段产物写入权（坑位）清单/, '缺坑位清单')
  assert.match(p, /\| `final\/M-Gate-Report\.json` \| \*\*T8\*\*/, 'M-Gate-Report 的写入者须钉死为 T8')
  assert.match(p, /\| `status\.md` \| \*\*主控独占\*\*/, 'status.md 写入权须明确')
  assert.match(p, /坑位归谁/, '缺跨阶段两问')
})

// ── F-AE：聚合时点必须晚于最后一个被聚合产物的写盘时点 ──
test('00 卡（F-AE）：聚合/终检落笔前必须做最后一次 ls', () => {
  const c = read('references', 'agents', '00-主控-扩展职责.md')
  assert.match(c, /聚合时点必须晚于最后一个被聚合产物的写盘时点/, '缺 F-AE 判据句')
  assert.match(c, /必须重读该产物再落笔/, '缺「变过就重读」的动作')
})

// ── 行引用守卫：本批新写的 `文件:行号` 引用必须指向它声称的内容（F-Z 的病灶就是引错规则原文） ──
test('行引用守卫：本批引用的 `文件:行号` 逐条指向所声称内容', () => {
  const gl = lines('references', 'glossary.md')
  assert.match(gl[259 - 1], /至多 \+1 深化轮/, 'glossary.md:259 须是 B 轨「至多 +1 深化轮」')

  const pl = lines('references', 'pipeline-readme.md')
  assert.match(pl[858 - 1], /B 轨累计已达 1 → 不再开/, 'pipeline-readme.md:858 须是 B 轨「累计已达 1 → 不再开」（v18.60.1：T9 整合契约段插入后由 819 下移至 858）')

  const mf = lines('scripts', '_lib', 'mgate-gates', 'mform-gates.mjs')
  assert.match(mf[260 - 1], /ENDNOTE_SCAN_EXEMPT = \['AI 使用声明'\]/, 'mform-gates.mjs:260 须是整节豁免白名单（v18.60.1：TEMP_MARKERS_AI_DECL_EXEMPT 段插入后由 254 下移至 260）')
  // v18.60.1：mform-gates.mjs 因新增 TEMP_MARKERS_AI_DECL_EXEMPT 段（下划线豁免）整体下移 6 行，以下三处同步。
  assert.match(mf[250 - 1], /案例卡\|数据卡\|文献卡/, 'mform-gates.mjs:250 须含文末禁止词（数据卡/案例卡）（v18.60.1：由 244 下移至 250）')
  assert.match(mf[280 - 1], /const endnoteNonBiblio/, 'mform-gates.mjs:280-283 须是「仅豁免数字编号书目行」那段（v18.60.1：由 274 下移至 280）')
  assert.match(mf[283 - 1], /join\('\\n'\)/, '同上：:283 为止（v18.60.1：由 277 下移至 283）')
})
