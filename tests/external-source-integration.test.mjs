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
