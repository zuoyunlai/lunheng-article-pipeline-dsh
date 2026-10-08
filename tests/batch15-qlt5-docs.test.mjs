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
  // v18.62.4（全量审计-v18.62.3 P1-2）：斜杠命令清单补 `-stats` 与 `-status --pending` 两行
  //   → 本文件 858 之后的引用整体下移 2 行（858 → 860）。判据同上：引错行号即红。
  // v18.62.7（反哺-主控实测批）：§派发话术 新增「通用派发前置条款（二）」（+19 行）→ 再下移至 **879**。
  // v18.62.7（§九 补录批）：同段追加 T1/T2/T3 的「检索工具面 + 承重交叉印证」两行（+9 行）→ 再下移至 **888**。
  // v18.62.7（§九 二修 · 通用性）：降级链改为终止式（A → B → **D 档保底**），该块再 +3 行 → **891**。
  // v18.63.1（材料摄取批）：§主人侧三件套 的「主人投喂清单」行下新增二进制摄取口径指针（+2 行）→ **893**。
  // v18.65.0（D1 角色最小权限批）：§主人侧三件套 **之前**插入「§角色 × 工具面负向清单」（+14 行）→ **907**。
  // v18.71.0（D2 workflow 配方批）：§派发话术 标题前插入「可选 workflow 编排」指针（+2 行）→ **909**。
  // v18.73.0（反哺报告-v7 F-16）：§修订轮默认段级 diff 的「偏差判定」条下补**分母口径**引用块（+4 行）→ **913**。
  // v18.73.0（反哺报告-v7 F-23）：§派发话术 前置条款模板内补「【报告编号】」一行（+2 行）→ **915**。
  // v18.73.0（反哺报告-v7 F-22）：§修订轮默认段级 diff 增「格式校验前置」第 0 条（+4 行）→ **919**。
  // v18.75.0（相位与修订环口径统一批）：§6.6.1 的 B 轨判定时点修正 + **G 环**定义表 + 文类分档段（+1 行净增，插在**本行之前**）→ **920**。
  // v18.77.0（文档与运行-审计 v1 批 · P-9）：L920 在「B 轨累计轮数 ≤ 1」条**之前**新增 T9 决策树指针（指向 `_shared/文类档案.md` §T9 决策树），整体下移 1 行 → 「B 轨累计轮数 ≤ 1」落到 **921**。
  // v18.78.0（反哺-v18.78.0-candidate F23 核实批）：**M 门速查（§派发话术 前置条款）第 4 条**按脚本实况改正
  //   （把「承重自 v18.11.0 起不算禁止词」这条**与脚本/用例/05 卡相反的断言**改回「正文与文末都禁」），
  //   并在该速查块之后补 4 行「既往错误」说明 + 1 行空行（**净 +6 行，全部在本行之前**）→ **927**。
  // v18.80.5（QLT-6 盲评动议 C-3）：Phase 4.2 修订行下补 1 行「**轮次增加 ≠ 质量提高**」判据（+1 行，插在**本行之前**）
  //   → 「B 轨累计轮数 ≤ 1」落到 **928**。
  assert.match(pl[928 - 1], /B 轨累计轮数 ≤ 1/, 'pipeline-readme.md:928 须是 B 轨「累计轮数 ≤ 1」（v18.62.4：858→860；v18.62.7：860→879→888→891；v18.63.1：891→893；v18.65.0：893→907；v18.71.0：907→909；v18.73.0 F-16：909→913；v18.73.0 F-23：913→915；v18.73.0 F-22：915→919；v18.75.0：919→920；v18.77.0 P-9：920→921；v18.78.0 F23：921→927；v18.80.5 C-3：927→928）')

  const mf = lines('scripts', '_lib', 'mgate-gates', 'mform-gates.mjs')
  // v18.62.4（全量审计-v18.62.3 P1-3）：文件头新增 4 行 ERROR 归类注记 → 以下常量整体下移 5 行
  //   （254 → 259 / 244 → 249 / 274 → 279 / 277 → 282）。判据同上：引错行号即红。
  // v18.72.0（文类档案批 2）：mForm1 前新增 GENRE_MIN_L 受控映射（+11 行）→ 265→276 / 255→266 / 285→296 / 288→299。
  // v18.80.1（全量审查修订批 · **B4**）：mForm2 的 `missingSections` 与 mForm7 的违规判据 + **顺序映射**由裸
  //   `startsWith` 改走 `sections.titleMatches`（剥离「五、」式排版前缀），本文件 F4 段前**两次净增 7 行注释**
  //   → 以下四处整体下移 7 行（276→283 / 266→273 / 296→303 / 299→306）。判据同上：引错行号即红。
  assert.match(mf[303 - 1], /ENDNOTE_SCAN_EXEMPT = \['AI 使用声明'\]/, 'mform-gates.mjs:303 须是整节豁免白名单（v18.62.4：260→265；v18.72.0：265→276；v18.80.1 B4：276→283；**v18.81.0 独立审计批 2：283→303**）')
  // v18.62.4：同上整体下移。
  //   **v18.81.0（独立审计批 2）**：本批在 M-Form-3 与 M-Form-5 各插了一段判据注释（签名栏豁免的钉住说明 +
  //   禁词表增补 5 词的实测依据），共 +20 行 → 以下四处**整体下移 20 行**（283→303 / 273→293 / 303→323 / 306→326）。
  //   判据不变：引错行号即红（本用例的作用就是让「文件改了但引用没跟」当场暴露）。
  assert.match(mf[293 - 1], /案例卡\|数据卡\|文献卡/, 'mform-gates.mjs:293 须含文末禁止词（数据卡/案例卡）（v18.62.4：250→255；v18.72.0：255→266；v18.80.1 B4：266→273；v18.81.0 批 2：273→293）')
  assert.match(mf[323 - 1], /const endnoteNonBiblio/, 'mform-gates.mjs:323-326 须是「仅豁免数字编号书目行」那段（v18.62.4：280→285；v18.72.0：285→296；v18.80.1 B4：296→303；v18.81.0 批 2：303→323）')
  assert.match(mf[326 - 1], /join\('\\n'\)/, '同上：:326 为止（v18.62.4：283→288；v18.72.0：288→299；v18.80.1 B4：299→306；v18.81.0 批 2：306→326）')
})
