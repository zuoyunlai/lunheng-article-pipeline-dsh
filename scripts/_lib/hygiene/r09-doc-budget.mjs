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
//
// ── v18.78.2（全量审计-v18.78.1 两条 P2 修复）──────────────────────────────────────
//    B1（棘轮只升不降）——病灶：`target` **只在超限报错文案里被读**，从不参与判定 →
//      「一次显式抬升 = 永久豁免」——**本条不再抄具体条数**（批 5 复算已与写入时不同），
//      只见「超自述长期目标 >20% 的条数 / 余量 <1 KB 的条数 / 合计余量」三类事实，数字每轮由本规则打印。
//      修法（三条，都是**可见性**而非新判据——本版刻意不改判定，避免与棘轮语义打架）：
//        ① `target` 进 note：`超自述长期目标 >20% 的 N 个` + TOP5 点名（含 实测/target 比例）；
//        ② note 增「**合计上限 / 实测 / 余量**」三项（回答「语料还能涨多少」）；
//        ③ **下调建议**：某文件比**上次提交**（`HEAD` 的 blob 大小）缩小 >1.5 KB 时，建议把上限降到
//           「实测 + 1.5 KB 向上取整到整 KB」——**只提示、不自动改**（自动收紧会与「抬升必须在同一
//           diff 里显式发生」的棘轮语义打架：门自己改数值 = 数值变化不进 review）。
//      为什么用 `git ls-tree HEAD` 判「上次」：本仓的棘轮上限就是**上次提交时**按公式定的，
//        与 HEAD 比才语义一致（与工作树比等于恒 0）。**边界（如实）**：未跟踪文件 / HEAD 上不存在
//        的文件不产出建议；`git` 不可用时本段整体跳过并在 note 里说明（不静默）。
//    B4（覆盖面窄）——病灶：未登记检查只 `walkMd(技能目录)`，`DOC_BUDGET` 键全为 `skills/**`。
//      而 `docs/*.md`（`introduction` 33.4 KB / `troubleshooting` 31.8 KB）与根级
//      `README*.md` / `CONTRIBUTING.md` / `SECURITY.md` 同样是**公开发布面的长文**，却一条上限都没有
//      ——「文档防膨胀」这一政策在仓库级文档上等于不存在。修法：覆盖面扩为**三面**（技能目录 / `docs/` /
//      仓库根**仅根级** .md），新增文件一并登记（上限 = 当前字节向上取整到整 KB，与既有公式同形）。
//      **排除面（显式写明，不是静默跳过）**：
//        · `CHANGELOG.md`（171→176 KB）——**append-only 留痕**：每版一段、只增不减，给它设上限等于
//          要求改写历史（与 `_lib/lib-line-refs.mjs` 的历史归档豁免同判据）。故**既不登记、也不进覆盖面**；
//          它的形状由 ⑬（版本段结构）管、节奏由发布纪律管。
//        · `docs/审计与修订记录/**`、`docs/验证记录/**`——历史归档（记录的是「当时」的状态，
//          拿今天的口径去限它同样是错的；同 `isHistoricalDoc` 判据）。
//        · `docs/介绍与排版/*.html`（18.2 KB）——**排版物料**，非随会话载入的文本；本门是 `.md` 词预算门
//          （`walkMd` 只认 `.md`）。如实登记该边界：它的膨胀目前无门（要不要登记须主人定口径）。
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { kb, walkMd, toRepoPosix } from './_shared.mjs'

const DOC_BUDGET_MIN = 12 * 1024
/** 「建议下调上限」的触发阈值：比上次提交缩小超过这么多字节即在 note 里点名（只提示）。 */
const SHRINK_SUGGEST_BYTES = 1536
/** 覆盖面扩面（B4）：`docs/` 下的历史归档目录按既有豁免口径排除。 */
const DOCS_HISTORICAL = [/^docs\/审计与修订记录\//, /^docs\/验证记录\//]
/** 覆盖面扩面（B4）：仓库根**仅根级** .md 中按「留痕」口径排除的面（理由见文件头）。
 *  v18.80.0（全量审计-v18.79.1 P3⑨）补 `audits/**` 的**口径声明**：`audits/` 是**不随包**的审计留痕
 *  （实测 150 文件 / 2.85 MB），按本仓「留痕 = append-only、不做逐文件预算」的既有口径与 `CHANGELOG.md`
 *  同档，故**不进 DOC_BUDGET**。原文只写了 `CHANGELOG.md`，读者会以为 `audits/` 是被漏掉的——**政策空白与
 *  政策豁免必须能分辨**（这正是本仓「不静的降级」纪律在门自身的应用）。
 *  另注：`audits/` 不在 `walkMd` 的任一扫面根（`skills/` `docs/` 根级）内，故它连带**不会**被 checkCover 扫到。 */
const ROOT_TOP_EXCLUDE = new Set(['CHANGELOG.md', 'audits'])

export function run(ctx) {
  const { fail, note, ROOT, DOC_BUDGET, ALWAYS_RESIDENT, ALWAYS_LIMIT, git } = ctx
  const budgetBad = []
  const lowHeadroom = []
  const overTarget20 = []
  const shrinkSuggest = []
  const overTargetRaise = []
  let docOver = 0
  let overTargetAny = 0
  let residentTotal = 0
  let sumLimit = 0
  let sumActual = 0
  // 「上次提交」的字节数：一次 `git ls-tree -r -l HEAD` 拿全量 blob 大小（**一次子进程**，不做 N 次 git show）。
  //   取不到（非 git 环境 / 无 HEAD）时整段跳过并如实标注，不静默当作「无不一致」。
  const headSizes = new Map()
  let headAvailable = false
  try {
    const ls = git(['ls-tree', '-r', '-l', 'HEAD'])
    if (ls.status === 0 && ls.stdout) {
      headAvailable = true
      for (const m of ls.stdout.matchAll(/^\d+\s+\w+\s+[0-9a-f]+\s+(\d+)\t(.+)$/gm)) {
        headSizes.set(m[2].trim(), Number(m[1]))
      }
    }
  } catch { /* headAvailable 保持 false */ }
  // v18.62.4（全量审计-v18.62.3 §8.3 #36）：**第 4 项不再被静默丢弃**。
  //   ⚠️ **v18.78.2（全量审计-v18.78.1 P3 复核）：本注释原文的实测句已不成立**——原文写
  //   「实测 35 条里 34 条 3 元、1 条 4 元（`references/_shared/外部检索源接入面.md` 是唯一的 4 元项）」，
  //   而本次复核：`DOC_BUDGET` **48 条全为 3 元**、`grep '更早：'` **0 命中** → `whyOlder` 分支
  //   **当前永不执行**（原注释是「当时的实测」，随数据形状变化已成假陈述——「注释与实现脱节」那一族，
  //   与 B1/B3 同源：数据在源码里，读者以为它在生效）。
  //   该分支**保留**（将来补写更早理由时不被静默吃掉、也不报错），但注释不得再声称库里存在 4 元条目。
  //   **v18.80.0（全量审计-v18.79.1 P3③）追加**：实测仍是「48 条全 3 元、`grep '更早：'` 0 命中」，
  //   故本行再加一句**何时该删它**——判据：若某次复核连 `DOC_BUDGET` 都不再有 4 元条目**且**无新增
  //   4 元条目计划，就删掉解构第 4 位与 `whyAll` 拼接（保留注释里的这段沿革）。
  //   为什么不现在就删：删了将来补「更早理由」会被静默忽略（`undefined` 不报错），属同一类「静默吞掉」。
  //   解构与文案的原始理由（仍然成立）：显式接收第 4 项，并把两段理由**都**带进超限报错文案——
  //   多一条理由 = 多一条「为什么必须增长」的上下文，正是这条报错要回答的问题。只改解构与文案，不动数据形状。
  for (const [rel, [limit, target, why, whyOlder]] of Object.entries(DOC_BUDGET)) {
    const whyAll = whyOlder ? `${why}｜更早：${whyOlder}` : why
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) { fail('doc-budget', `词预算表登记了不存在的文件：${rel}（表已过期，请删除该行）`); continue }
    // v18.80.0（全量审计-v18.79.1 **P2-2** 棘轮不得只升不降）：上限**超过自述长期目标** = 该条已欠债。
    //   ⚠️ **v18.80.1+v（独立审计批 5）：本注释不再抄具体条数**——原文写「实测 28/48 条处于此态」，
    //   实测已漂成 **38/49**（`SKILL.md` 值也从 253% 变过），且「余量 <1 KB」由 8 条变 **24 条**。
    //   判据（照 `AGENTS.md` 对 consistency-check 的同款处理）：「此处不再抄数字，防『加规则忘改数字』」
    //   ——**数字一律以本规则每轮实际打印为准**（报告里有「超自述长期目标 N 个 / 余量 <1 KB 的 N 个」两段）。
    //   沿革：2026-10-07 记 28/48（写这条时的真实值）→ 2026-10-07 批 5 复算 38/49。
    //   旧行为只有一行 note（「超自述长期目标 N 个」）——**可见但不可行动**：下次任何增长照样抬上限。
    //   本版给它齿：把这些条目列进报告并**要求抬升必须附「为什么必须超过长期目标」**，否则视为漂移。
    //   为什么不当场 fail：现状是**历史累积态**（条数见本规则打印），当场 fail 会把本批提交堵死——
    //   那正是用户要修的 22 条里的另一类「改不动」。故取「可见 + 有行动要求」而不引入新的阻塞。
    const debt = target > 0 && limit > target
    if (debt) overTargetRaise.push({ rel, pct: Math.round((limit / target) * 100) })
    const size = statSync(abs).size
    sumLimit += limit
    sumActual += size
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
    // B1：棘轮的「另一半」——长期目标与实际余量。**不判失败**，只让它们可见（本版不改判定）。
    if (target > 0) {
      const ratio = size / target
      if (size > target) overTargetAny++
      if (ratio > 1.2) overTarget20.push({ rel, pct: Math.round(ratio * 100) })
    }
    if (limit - size < 1024) lowHeadroom.push(`${rel} ${limit - size} B`)
    const headSize = headSizes.get(rel)
    if (headAvailable && headSize !== undefined && headSize - size > SHRINK_SUGGEST_BYTES) {
      const suggestion = Math.ceil((size + SHRINK_SUGGEST_BYTES) / 1024) * 1024
      // 只在**建议值小于当前上限**时提示，否则这条「下调建议」会变成抬高建议（自相矛盾）。
      //   出现「建议值 ≥ 上限」说明该条的上限早已低于公式值（另一次漂移），本段不猜、不提示——
      //   `limit - size` 那一半（合计余量 / 余量 <1 KB）已经把这种状态显示得很清楚。
      if (suggestion < limit) {
        shrinkSuggest.push(
          `${rel}: HEAD ${headSize} B → 实测 ${size} B（−${headSize - size} B，已超 ${SHRINK_SUGGEST_BYTES} B 阈值）` +
            `——建议把上限 ${limit} B 下调到 **${suggestion} B**（= 实测 + 1.5 KB 向上取整到整 KB；长期目标 ${target} B）`,
        )
      }
    }
  }
  // 覆盖：三面（技能目录 / docs/ 排除历史归档 / 仓库根仅根级）内所有 ≥ 阈值的 .md 必须登记
  //   （否则新胖文档可无声进入上下文成本或公开交付面）。B4 扩面，排除面见文件头。
  const unregistered = []
  const checkCover = (rel, abs) => {
    if (statSync(abs).size >= DOC_BUDGET_MIN && !DOC_BUDGET[rel]) unregistered.push(`${rel}（${kb(statSync(abs).size)}）`)
  }
  const skillAbs = join(ROOT, 'skills', 'lunheng-article-pipeline')
  if (existsSync(skillAbs)) {
    for (const f of walkMd(skillAbs)) checkCover(toRepoPosix(f, ROOT), f)
  }
  const docsAbs = join(ROOT, 'docs')
  if (existsSync(docsAbs)) {
    for (const f of walkMd(docsAbs)) {
      const rel = toRepoPosix(f, ROOT)
      if (DOCS_HISTORICAL.some((re) => re.test(rel))) continue
      checkCover(rel, f)
    }
  }
  // 仓库根：**只扫根级**（`readdirSync` 非递归）——递归会把 skills/ docs/ node_modules 全卷进来。
  for (const e of readdirSync(ROOT, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.md') || ROOT_TOP_EXCLUDE.has(e.name)) continue
    checkCover(e.name, join(ROOT, e.name))
  }
  if (unregistered.length) {
    fail('doc-budget', `以下 ≥${kb(DOC_BUDGET_MIN)} 的文档未登记词预算：${unregistered.join('；')}——请在 DOC_BUDGET 加一行（含上限与理由）`)
  }
  if (residentTotal > ALWAYS_LIMIT) {
    fail(
      'doc-budget',
      `常驻集（SKILL.md + AGENTS.md）合计 ${residentTotal} B（${kb(residentTotal)}）超上限 ${ALWAYS_LIMIT} B（${kb(ALWAYS_LIMIT)}）` +
        '——这两个文件是每次会话的固定开销，不能用「此消彼长」绕开逐文件上限。',
    )
  }
  note(
    `⑨ 词预算：登记 ${Object.keys(DOC_BUDGET).length} 个文档（≥${kb(DOC_BUDGET_MIN)} 全覆盖 = 技能目录 + docs/ + 仓库根根级，未登记 ${unregistered.length} 个；` +
      `排除面见规则头：CHANGELOG.md（append-only 留痕）/ docs 历史归档 / docs/介绍与排版 的 .html（非 .md 物料））` +
      `；常驻集合计 ${kb(residentTotal)}/${kb(ALWAYS_LIMIT)}（SKILL.md + AGENTS.md）` +
      (docOver ? `；❗ 超限 ${docOver} 个` : budgetBad.length ? `；⚠️ 接近上限：${budgetBad.join('、')}` : '，均在预算内'),
  )
  // B1②③：棘轮的另一半（合计余量 / 超长期目标 / 建议下调）——**只报告，不判失败**。
  //   为什么不做 38 条全量逐条打印：其中 35 条已超其自述长期目标，逐条打印是噪声（B2 的教训是
  //   「管膨胀的门自己别膨胀」）；本行按**可行动**筛选：合计三项 + 超目标 >20% 的 TOP5 + 余量 <1 KB 全体
  //   + 建议下调全体。target 数值因此在这三处都是**可见的**，不再只活在超限报错文案里。
  const top20 = [...overTarget20].sort((a, b) => b.pct - a.pct).slice(0, 5)
  // 余量 <1 KB 的条目会有十几条（**首次登记**的条目按公式天然只留 ≤1 KB，见规则头），故只点名最紧的 5 条。
  const tight = [...lowHeadroom].sort((a, b) => Number(a.split(' ').pop()) - Number(b.split(' ').pop())).slice(0, 5)
  note(
    `⑨ 棘轮另半（v18.78.2 B1）：合计上限 ${kb(sumLimit)} / 实测 ${kb(sumActual)} / **余量 ${kb(sumLimit - sumActual)}**` +
      `（${((sumActual / sumLimit) * 100).toFixed(1)}% 用了合计上限）；超自述长期目标的 ${overTargetAny} 个（其中 >20% 的 ${overTarget20.length} 个` +
      (top20.length ? `，TOP：${top20.map((x) => `${x.rel.split('/').pop()} ${x.pct}%`).join('、')}` : '') +
      `）；**余量 <1 KB 的 ${lowHeadroom.length} 个**（最紧 5 个：${tight.join('、') || '无'}；另 ${Math.max(0, lowHeadroom.length - tight.length)} 个同类，` +
      `本次新登记的条目按公式天然只留 ≤1 KB，逐条列出属噪声——任一条的余量 = 上限 − 实测，可直接复算）`,
  )
  // ── P2-2（v18.80.0 · 全量审计-v18.79.1）：棘轮「只升不降」的可见化 + 行动要求 ──────────────
  //   ⚠️ **v18.80.1+v（独立审计批 5）：本注释不再抄条数**（原文「48 条里 28 条」已漂为 **38/49**；
  //   「余量 <1 KB」由 8 → **24**）。**数字以本规则每轮打印为准**——同 `AGENTS.md` 对 consistency-check 的
  //   「此处不再抄数字，防『加规则忘改数字』」判据。**沿革**：2026-10-07 记 28/48 → 同日批 5 复算 38/49。
  //   **为什么不当场 fail**：这是历史累积态，当场 fail 会把任何一批修订都堵死，
  //   那正是本仓反复吃的「门全红 → 只能删门」的药。取可见 + 有要求，把决定权留给 review。
  //   长期目标的语义是「这个文件最终应该多大」——上限越线意味着**棘轮的余额已被预支**。
  //   旧实现只在别处打一行「超自述长期目标 N 个」，读者看见数字也不知道该做什么。
  //   本段把它变成**点名 + 行动要求**：抬升可以，但必须在这一条的 `why` 里回答「为什么必须超过长期目标」。
  //   判据（可机械核）：`why` 含「长期目标」四字且含越线比例——写了就是有交代，没写就是没交代。
  //   **为什么不当场 fail**：这是历史累积态（条数见本规则打印），当场 fail 会把任何一批修订都堵死，
  //   那正是本仓反复吃的「门全红 → 只能删门」的药。取可见 + 有要求，把决定权留给 review。
  const debtNoReason = overTargetRaise.filter((x) => !String(DOC_BUDGET[x.rel]?.[2] || '').includes('长期目标'))
  if (overTargetRaise.length) {
    const worst = [...overTargetRaise].sort((a, b) => b.pct - a.pct).slice(0, 5).map((x) => `${x.rel.split('/').pop()} ${x.pct}%`)
    note(
      `⑨ 棘轮已越线（v18.80.0 P2-2）：**${overTargetRaise.length}/${Object.keys(DOC_BUDGET).length} 条**的**上限**超自述长期目标`
        + `（语义 = 棘轮余额已预支；越线最狠 5 条：${worst.join('、')}）。`
        + `**行动要求**：再抬这些条的上限时，理由里必须回答「为什么必须超过长期目标」（写「长期目标」四字即视为已交代）；`
        + `**未交代的 ${debtNoReason.length} 条**：${debtNoReason.slice(0, 5).map((x) => x.rel.split('/').pop()).join('、') || '无'}`
        + `${debtNoReason.length > 5 ? ` 等 ${debtNoReason.length} 条` : ''}——下次触及该条时同批补写。`,
    )
  }
  if (shrinkSuggest.length) {
    note(
      `⑨ 建议下调上限（v18.78.2 B1③ · **只提示不自动改**：数值变化必须走显式 review，见规则头）：${shrinkSuggest.join('；')}`,
    )
  } else {
    note(
      `⑨ 下调建议（v18.78.2 B1③）：${headAvailable
        ? `无——没有「比 HEAD 缩小 >${SHRINK_SUGGEST_BYTES} B」的已登记文件（已比对 ${headSizes.size} 个 blob 的大小）`
        : '**未判定**：HEAD 的 blob 大小拿不到（非 git 环境或无提交）——不得读作「无建议」'}`,
    )
  }
  // ── B3 **类级**（v18.78.2 · 复核报告 §四-3 收口）：理由必须记录**产生当前上限的那次抬升** ──────────
  //   病灶：B3 原只修了审计**点名的那一条**（05 写手卡），**类未扫**——复核报告以独立口径实测
  //   「9/48 条理由未记录当前上限值」；本方以更严口径（只认 `N B` 与整 KB 的 `N KB` 两种写法）复算为
  //   **12/48**（差异 3 条为写法宽容度：字数判定表 / 数据卡-template / 主人确认-template）。
  //   这里把它**机械化**：逐条判「理由文本里是否出现当前上限值」，未出现即 note 点名。
  //   **为什么只 note 不 fail**：它们是**历史欠账**（当时的抬升没写理由），判失败会让门永久红、逼人删门；
  //   对症修法是「下次抬升该条时同批补写实测→上限数值链」（B3 原话），故本条提供**可见性 + 自愈**
  //   （补一条少一条），并把口径（只认 B / 整 KB）写进文案，避免读者把「没写 KB」误读成「没写」。
  const whyMissingLimit = Object.entries(DOC_BUDGET)
    // DOC_BUDGET 条目形状 = `[limit, target, why]`（可选第 4 项 whyOlder）——**注意下标**：
    //   首版误写成 `[, limit, , why, whyOlder]`（整体右移一位：limit 取到了 target、why 取到 undefined），
    //   于是恒判「未记录」→ note 报 48/48（与独立复算的 12/48 不符而暴露）。
    .filter(([, [limit, , why, whyOlder]]) => {
      const text = `${why || ''}${whyOlder ? '\n' + whyOlder : ''}`
      const kbInt = Math.round(limit / 1024)
      return !new RegExp(`(^|[^0-9])${limit}\\s*B`).test(text) && !new RegExp(`(^|[^0-9])${kbInt}\\s*KB`).test(text)
    })
    .map(([rel]) => rel)   // DOC_BUDGET 的键本就是「仓库 posix 相对路径」，**不要再过 toRepoPosix**（它要绝对路径）
  if (whyMissingLimit.length) {
    note(
      `⑨ 理由数值链缺口（v18.78.2 B3 **类级** · 复核报告 §四-3）：${whyMissingLimit.length}/${Object.keys(DOC_BUDGET).length} 条登记项的`
        + '**理由未记录当前上限值**（口径：出现 `N B` 或整 KB 的 `N KB` 即算记录）——下次抬升该条时请同批补写「实测 A B → 上限 B B」。'
        + `本轮点名（前 6）：${whyMissingLimit.slice(0, 6).join('、')}${whyMissingLimit.length > 6 ? ' …' : ''}`,
    )
  }
}
