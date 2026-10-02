// v18.21.2 外部检索源接入面扩展（N-接入面 / N-勾选）的回归网。
//
// 为什么需要：v18.21.2 把 6 个检索源（firecrawl / tavily / exa / consensus / AI4Scholar 学术套件
//   / search_google_scholar）的指引面落到 T1/T2/T3 卡 + 任务简报模板 + `_shared/外部检索源接入面.md`。
//   与 N-3 同型风险：**声明面与真实行为脱节，而没有任何东西会红**——
//     · 接入面文档若不在 T1/T2/T3 卡的职责段被引用 = 接入面是"门在此却不生效"的空话；
//     · 任务简报模板若不含 6 源勾选位 = 主人无可用接口，主控只能用 web_search；
//     · `中文数据源集成.md` 第一梯队若仍写「`web_fetch` 拼 URL」= 表述陈旧，与 DSH 实际工具面不符。
//   本文件把三条钉在**产物/源文本**上（不靠自由文本审）：T1/T2/T3 卡必须显式引用接入面文档；任务简报必须
//   含 6 源勾选项；中文集成文档第一梯队必须不再用「web_fetch 拼 URL」字面量（兜底形态可保留）。
//
// 用例清单：
//   ① T1 卡显式引用 [`../_shared/外部检索源接入面.md`](../_shared/外部检索源接入面.md)
//   ② T2 卡显式引用 同上
//   ③ T3 卡显式引用 同上
//   ④ 任务简报模板 §启用扩展检索源 含 6 源勾选（AI4Scholar / Google Scholar / Tavily / Exa / Firecrawl / Consensus）
//   ⑤ 中文集成文档第一梯队**主推荐**改用 DSH `search_papers` 工具，不再以「web_fetch 拼 URL」作主推荐
//   ⑥ 反向自证 A：删 T1 卡的接入面引用 → 该用例红（"门在此却不生效"形态）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = join(ROOT, 'skills', 'lunheng-article-pipeline')
const read = (rel) => readFileSync(join(SKILLS, rel), 'utf8')
const SOURCE_RE = /(?:\[`\.\.\/)?(?:_shared\/)?外部检索源接入面\.md`\]?\(\.\.\/_shared\/外部检索源接入面\.md\)|_shared\/外部检索源接入面\.md/

// ── ① T1 卡必须显式引用接入面文档 ────────────────────────────────────────────────
test('N-接入面① T1 卡职责段显式引用 `外部检索源接入面.md`', () => {
  const t1 = read('references/agents/01-文献检索-literature-scout.md')
  assert.ok(SOURCE_RE.test(t1), 'T1 卡必须在职责段显式引用 `外部检索源接入面.md`——否则 6 源接入面是空话（"门在此却不生效"形态）')
})

// ── ② T2 卡必须显式引用接入面文档 ────────────────────────────────────────────────
test('N-接入面② T2 卡职责段显式引用 `外部检索源接入面.md`', () => {
  const t2 = read('references/agents/02-数据检索-data-scout.md')
  assert.ok(SOURCE_RE.test(t2), 'T2 卡必须在职责段显式引用 `外部检索源接入面.md`')
})

// ── ③ T3 卡必须显式引用接入面文档 ────────────────────────────────────────────────
test('N-接入面③ T3 卡职责段显式引用 `外部检索源接入面.md`', () => {
  const t3 = read('references/agents/03-案例检索-case-scout.md')
  assert.ok(SOURCE_RE.test(t3), 'T3 卡必须在职责段显式引用 `外部检索源接入面.md`')
})

// ── ④ 任务简报模板 §启用扩展检索源 含 6 源勾选 ──────────────────────────────────
test('N-勾选 任务简报模板 §v2.5.0 可选项 必含「启用扩展检索源」段 + 6 源勾选', () => {
  const brief = read('references/templates/任务简报-template.md')
  assert.match(brief, /启用扩展检索源/, '任务简报模板必须含「启用扩展检索源」段——主控与主人显式勾选 6 源可用性的唯一接口')
  // 6 源必须逐项出现
  for (const src of ['AI4Scholar 学术套件', 'Google Scholar', 'Tavily', 'Exa', 'Firecrawl', 'Consensus']) {
    assert.ok(brief.includes(src), `任务简报模板「启用扩展检索源」段必须勾选 ${src}`)
  }
})

// ── ⑤ 中文集成文档第一梯队主推荐改用 DSH 学术工具 ──────────────────────────────────
test('N-接入面⑤ 中文数据源集成.md 第一梯队主推荐不再以「web_fetch 拼 URL」为主推荐', () => {
  const cn = read('references/_shared/中文数据源集成.md')
  // v18.21.2 落地要求：第一梯队 OpenAlex/Crossref 段必须显式提到 `search_papers` 工具
  // （DSH 学术工具主推荐），原 `web_fetch` 拼 URL 仅作兜底。
  assert.ok(cn.includes('search_papers'), '中文集成文档第一梯队必须提及 `search_papers` 工具（v18.21.2 主推荐）')
  // 不允许把 "web_fetch 拼 URL" 当成主推荐——OpenAlex 用法段不能再说「GET ... 用 web_fetch 调用」
  // （注：兜底形态的描述仍允许出现，但不应作为 §用法 段的首要形态）
  const openAlexUsage = /OpenAlex[^\n]*\n[\s\S]{0,200}用法[\s\S]{0,400}/.exec(cn)
  if (openAlexUsage) {
    const seg = openAlexUsage[0]
    // 兜底允许有，但必须有 "v18.21.2 推荐" / "DSH `search_papers` 工具" 字样作主推荐
    assert.ok(/v18\.21\.2/.test(seg), 'OpenAlex §用法 段必须标注 v18.21.2 主推荐形态（DSH 工具）')
  }
})

// ── ⑥ 反向自证 A：T1 卡删掉接入面引用 → 该用例应红 ────────────────────────────────
// 为什么必做（v18.15.0 教训：「门在此却不生效」是本包反复出现的一类缺陷）。
// 用例不修改文件：用注入脚本替换行 → 跑注入后的 T1 临时副本 → 若 SOURCE_RE 仍命中则证明这条
// 防护不是"门在此却不生效"的假绿。
test('N-接入面⑥ 反向自证：把 T1 卡的接入面引用行替换成同长度字符串 → SOURCE_RE 必须不命中', () => {
  const t1Path = join(SKILLS, 'references/agents/01-文献检索-literature-scout.md')
  const before = readFileSync(t1Path, 'utf8')
  // 把"外部检索源接入面.md"全字串替换成同长度的占位符（保留行结构）
  const masked = before.replace(/外部检索源接入面\.md/g, '外部检索源接入面   '.slice(0, '外部检索源接入面.md'.length))
  assert.notEqual(masked, before, '夹具假设 T1 卡含「外部检索源接入面.md」字串——若未含，本用例无法做反向自证')
  // 反向自证：被屏蔽后，T1 卡 **不应** 仍含 SOURCE_RE
  assert.ok(
    !SOURCE_RE.test(masked),
    '把 T1 卡的接入面引用屏蔽后，SOURCE_RE 仍命中 → 「门在此却不生效」的假绿（v18.15.0 教训）',
  )
})

// ── ⑦ v18.21.3 B：T1/T2/T3 卡主轮默认层不含 web_search 作"主推"（v18.21.2 实测发现 Bing 中文偏置，主人 2026-09-26 授权强约束）────
// 为什么需要（v18.18.x「长期存活型缺陷共性：不报错、不失败、`ok:true`」）：v18.21.2 真实项目实测
//   T2/T3 subagent 亲遇 Bing 偏置——主轮默认层含 web_search 是结构性问题，仅靠文档不够，
//   必须**结构性**强约束 T1/T2/T3 卡的主轮默认层不含 web_search 作"主推"。
// 边界：
//   · 只检前 60 行（职责段 + 默认层段）；不检全文（保留 §「检索策略」里「先用 web_search 列 5-10 条候选 URL」措辞的合法性）。
//   · 「URL 列表生成器」措辞允许（T2/T3 仍可调 web_search 作 query→URL 列表生成器）。
test('v18.21.3 B：T1/T2/T3 卡主轮默认层（前 60 行）不含 web_search 作「主推」（结构性强约束）', () => {
  for (const rel of [
    'references/agents/01-文献检索-literature-scout.md',
    'references/agents/02-数据检索-data-scout.md',
    'references/agents/03-案例检索-case-scout.md',
  ]) {
    const text = read(rel)
    const head = text.split('\n').slice(0, 60).join('\n')
    // 「默认层」段（前 60 行内）不得含「web_search」作主推——判定形式：「默认X源 ... web_search」
    //   X ∈ {学术层, 网页层, 事件层, 抓取层, 1源, 2源, 3源}
    assert.ok(
      !/默认[学术网页事件抓取]+层[^\n]{0,40}web_search/.test(head),
      `${rel} 主轮默认层（含「默认学术层/网页层/事件层/抓取层」等措辞的前 60 行）含 web_search——v18.21.3 强约束被绕过。\n相关段落：${head.match(/默认[学术网页事件抓取]+层[^\n]*/)?.[0]?.slice(0, 200) ?? '(无匹配段)'}`
    )
  }
})

// ── v18.62.7（反哺-主控实测 §A19/§A20/§A21/§A23）：**工具面存在性 + 交叉印证 + 引擎位归属** ──────
//   为什么必须钉在源文本上：本族三条都是「**指引面**」修改，机械层测不了「模型是否照做」，
//   但能测「指引面自己有没有说错」——而本次实测的病灶恰恰是**指引面点名的工具本机未安装**
//   （三卡把 AI4Scholar 三源写成默认层，而本机无该插件 → 子代理回落到「备用层」的 web_search）。
//   本组同时钉**反向**：接入面**不得**再出现 `web_search(engine=…)` 这一形态（engine 参数不在该工具上）。
const TOOLFACE_RE = /检索工具面/
test('A19 三检索员卡：源面必须过「工具面存在性」，且点名 A 档工具（advanced_search / multi_search）', () => {
  for (const c of ['01-文献检索-literature-scout.md', '02-数据检索-data-scout.md', '03-案例检索-case-scout.md']) {
    const t = read(`references/agents/${c}`)
    assert.ok(TOOLFACE_RE.test(t), `${c} 必须含「检索工具面」存在性判据——否则又会出现「卡里点名的工具本机没装」（§A19）`)
    assert.match(t, /advanced_search/, `${c} 必须点名 A 档默认工具 advanced_search（本机真实存在的那一档）`)
    assert.match(t, /multi_search/, `${c} 必须含 §A21 的交叉印证动作（multi_search / seenIn）`)
    assert.ok(
      !/默认学术层（主轮并行这 3 件）/.test(t),
      `${c} 不得再把 AI4Scholar 三源写成无条件的「默认学术层」——B 档必须经工具面探测确认（§A19）`,
    )
  }
})
test('A19 任务简报模板：必须含 Phase 0 的 `检索工具面:` 行（档位锁定的唯一依据）', () => {
  const brief = read('references/templates/任务简报-template.md')
  assert.match(brief, /检索工具面\s*:/, '任务简报模板必须含 `检索工具面:` 行——主控在 Phase 0 填，T1/T2/T3 按它执行')
  assert.match(brief, /本轮档位/, '必须含「本轮档位」声明（§A20：不同轮次不得换档，换了要逐条标注归属）')
})
test('A21 接入面必须把 multi_search 立为承重条目的交叉印证指定工具（含 seenIn 口径）', () => {
  const t = read('references/_shared/外部检索源接入面.md')
  assert.match(t, /multi_search/, '接入面必须点名 multi_search（实测 6 个检索会话 0 次调用 = 工具在、方法没接上）')
  assert.match(t, /seenIn/, '必须写明 seenIn 口径（≥2 才算跨源印证）')
  assert.match(t, /承重/, '必须与「承重条目」挂钩（否则又是「工具在但不指定谁用」）')
})
test('A23 接入面：`engine` 参数的归属必须更正到 advanced_search，且不得再出现 `web_search(engine=` 形态', () => {
  const t = read('references/_shared/外部检索源接入面.md')
  assert.ok(
    !/web_search\(engine/.test(t),
    '接入面不得再把 engine 参数绑到 web_search 上（该工具 schema 只有 queries）——§A23 病灶原形',
  )
  assert.ok(
    !/引擎降级链（`web_search` 内部）/.test(t),
    '不得再把引擎降级链归给 web_search（它属于 advanced_search）',
  )
  assert.match(t, /advanced_search/, '必须点名 advanced_search 为引擎位所在工具')
  assert.match(t, /free_search_test/, '引擎集与顺序必须以运行时为准（free_search_test 可实测），不得硬编码当契约')
})
test('A19 反向自证：屏蔽三卡里的「检索工具面」判据 → 本组断言必须能红（证明不是空转）', () => {
  const t1 = read('references/agents/01-文献检索-literature-scout.md')
  const masked = t1.replace(/检索工具面/g, '××工具面')   // 同长度、但不再是该判据串
  assert.notEqual(masked, t1, '夹具假设 T1 卡含「检索工具面」——若未含，本用例无法反向自证')
  assert.ok(!TOOLFACE_RE.test(masked), '屏蔽后仍命中 → 本组判据是空转（假绿）')
})

// ── v18.62.7 二修（**通用性回归网**）：论衡不要求宿主安装任何第三方检索插件 ──────────────────────
//   为什么必须钉：首版 §A19 落地把「A 档（装了 dsh-free-search）」写成**默认主线**，却没定义
//   「连它也没有」的那一档 → 一个只装 DSH base 的宿主在**文档层没有可执行的默认层**
//   （而它其实有 `web_search` + `web_fetch`）。**这等于把 §A19 的病往上抬了一级**：
//   从「点名了本机没装的工具」变成「默认层的前提在别的宿主上不成立」。
//   判据（两条方向都要）：① **保底档必须存在**（D 档 = 仅 base 的 `web_search` + `web_fetch`），
//   三卡与接入面的降级链必须**终止**在它；② **不得**出现「必须安装某插件」这类前置要求。
test('通用性：接入面必须有 D 档保底（无需任何插件），且三卡降级链必须终止于它', () => {
  const t = read('references/_shared/外部检索源接入面.md')
  assert.match(t, /D 档/, '接入面必须定义 D 档保底（只有 DSH 自带的 web_search + web_fetch）')
  assert.match(t, /不要求[^\n]{0,20}任何第三方检索插件/, '必须写明通用性底线：论衡不要求宿主安装任何第三方检索插件')
  for (const c of ['01-文献检索-literature-scout.md', '02-数据检索-data-scout.md', '03-案例检索-case-scout.md']) {
    const x = read(`references/agents/${c}`)
    assert.match(x, /D 档/, `${c} 的降级链必须终止于 D 档保底——否则「A 档也不可用」时子代理无指令可执行`)
  }
})
test('通用性反向钉：接入面与三卡**不得**把第三方插件写成前置要求', () => {
  const files = ['references/_shared/外部检索源接入面.md', 'references/agents/01-文献检索-literature-scout.md', 'references/agents/02-数据检索-data-scout.md', 'references/agents/03-案例检索-case-scout.md']
  for (const f of files) {
    const x = read(f)
    assert.ok(
      !/必须(先)?安装[^\n]{0,20}(dsh-free-search|AI4Scholar)/.test(x),
      `${f} 不得把第三方插件写成「必须安装」的前置要求——档次只决定「怎么检索」，不决定「能不能检索」`,
    )
    assert.ok(
      !/未安装[^\n]{0,20}(则)?(中止|停止检索)/.test(x),
      `${f} 不得因插件缺失而中止检索（缺插件只降档，不降可行性）`,
    )
  }
})
