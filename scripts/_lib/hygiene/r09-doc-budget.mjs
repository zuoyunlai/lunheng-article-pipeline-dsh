// ⑨ 文档词预算门（v18.1.0 新增，第三方审计改进方案 C-6）
//    为什么需要：本包的成本结构里，**唯一随每次会话恒定的开销就是被载入上下文的文档**（技能体 SKILL.md
//      由入口注册 → 每次技能激活都在上下文里；AGENTS.md 在工作目录下自动生效）。审计实测「较瘦身底 +69%」，
//      且历史趋势是**只增不减**（每轮修订都往 SKILL.md 加一行注解）。此前的门全都只看「有没有错」，
//      **没有一条门看「涨没涨」**——于是膨胀是唯一无人反对的方向。
//    官方先例：`references/official-docs/AGENTS.md` 的 `verify-doc-budgets`（doc budget manifest + 机检）。
//    设计（三条，缺一不可）：
//      ① **逐文件上限**：技能目录内所有 ≥ `DOC_BUDGET_MIN` 的 .md 必须有登记（新增胖文档不能悄悄逃过测量）；
//      ② **上限即棘轮**：上限取「当前字节数向上取整到整 KB」——留 ≤1 KB 余量，任何增长都必须**在同一个 diff 里
//         显式抬升上限**（抬升动作可见、可 review、可被主人否决），而不是无声膨胀；
//      ③ **常驻集合计上限**：SKILL.md + AGENTS.md 的**合计**另有上限——防止「瘦 SKILL、肥 AGENTS」把固定开销换个口袋。
//    边界（如实）：本规则管的是**字节量**（代理指标，≠ 真实 token 数，不区分中英）；`target`（长期目标）只作
//      报告用，**不判失败**——本版是棘轮，不是瘦身令（瘦身需要主人拍板口径，见 CHANGELOG `## 18.1.0`）。
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { kb, walkMd, toRepoPosix } from './_shared.mjs'

const DOC_BUDGET_MIN = 12 * 1024

export function run(ctx) {
  const { fail, note, ROOT, DOC_BUDGET, ALWAYS_RESIDENT, ALWAYS_LIMIT } = ctx
  const budgetBad = []
  let docOver = 0
  let residentTotal = 0
  // v18.62.4（全量审计-v18.62.3 §8.3 #36）：**第 4 项不再被静默丢弃**。
  //   实测（运行时解析 DOC_BUDGET 字面量）：35 条里 **34 条 3 元、1 条 4 元** ——
  //   `references/_shared/外部检索源接入面.md` 是唯一的 4 元项：`[上限, 目标, 较新理由, 更早理由]`，
  //   而本行旧版只解构 `[limit, target, why]` → **那份更早的抬升理由被无声吃掉**。
  //   「数组多一项、解构少一项」最坏之处是**它不报错**：数据在源码里、读者以为它在生效。
  //   修法：显式接收第 4 项，并把两段理由**都**带进超限报错文案（多一条理由 = 多一条
  //   「为什么必须增长」的上下文，正是这条报错要回答的问题）。⚠️ 只改**本循环的解构与文案**，不动数据形状。
  for (const [rel, [limit, target, why, whyOlder]] of Object.entries(DOC_BUDGET)) {
    const whyAll = whyOlder ? `${why}｜更早：${whyOlder}` : why
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) { fail('doc-budget', `词预算表登记了不存在的文件：${rel}（表已过期，请删除该行）`); continue }
    const size = statSync(abs).size
    if (ALWAYS_RESIDENT.includes(rel)) residentTotal += size
    const pct = ((size / limit) * 100).toFixed(0)
    if (size > limit) {
      docOver++
      fail(
        'doc-budget',
        `${rel} 已达 ${size} B（${kb(size)}），超出上限 ${limit} B（${kb(limit)}）——「${whyAll}」。` +
          `两条合法出路：① **先瘦身**（把细节移到按需加载的 references/，本文件只留指针与判据）；` +
          `② 若确需增长，在**同一次提交**里把 repo-hygiene-check.mjs 的 DOC_BUDGET 上限抬到 ≥${Math.ceil(size / 1024) * 1024} B 并在 CHANGELOG 写明为何必须增长。` +
          `目标（长期）${target} B（${kb(target)}），当前 ${pct}% 用了上限。`,
      )
    } else if (limit - size < 256) {
      // 余量 < 256 B：下一次改动几乎必然撞上限——提前在 note 里点名（上限按整 KB 取，故余量恒在 0–1023 B）
      budgetBad.push(`${rel} 余量仅 ${limit - size} B`)
    }
  }
  // 覆盖：技能目录内 ≥ 阈值的 .md 必须登记（否则新胖文档可无声进入上下文成本）
  const unregistered = []
  const skillAbs = join(ROOT, 'skills', 'lunheng-article-pipeline')
  if (existsSync(skillAbs)) {
    for (const f of walkMd(skillAbs)) {
      const rel = toRepoPosix(f, ROOT)
      if (statSync(f).size >= DOC_BUDGET_MIN && !DOC_BUDGET[rel]) unregistered.push(`${rel}（${kb(statSync(f).size)}）`)
    }
  }
  if (unregistered.length) {
    fail('doc-budget', `技能目录内 ≥${kb(DOC_BUDGET_MIN)} 的文档未登记词预算：${unregistered.join('；')}——请在 DOC_BUDGET 加一行（含上限与理由）`)
  }
  if (residentTotal > ALWAYS_LIMIT) {
    fail(
      'doc-budget',
      `常驻集（SKILL.md + AGENTS.md）合计 ${residentTotal} B（${kb(residentTotal)}）超上限 ${ALWAYS_LIMIT} B（${kb(ALWAYS_LIMIT)}）` +
        '——这两个文件是每次会话的固定开销，不能用「此消彼长」绕开逐文件上限。',
    )
  }
  note(
    `⑨ 词预算：登记 ${Object.keys(DOC_BUDGET).length} 个文档（≥${kb(DOC_BUDGET_MIN)} 全覆盖，未登记 ${unregistered.length} 个）` +
      `；常驻集合计 ${kb(residentTotal)}/${kb(ALWAYS_LIMIT)}（SKILL.md + AGENTS.md）` +
      (docOver ? `；❗ 超限 ${docOver} 个` : budgetBad.length ? `；⚠️ 接近上限：${budgetBad.join('、')}` : '，均在预算内'),
  )
}
