// ⑩ 注解密度门（v18.8.0 新增，P2 文档瘦身战役的「防再膨胀」机制）：
//    全量审计（v18.7.1）实证：四大文档 83-90KB 中 20-30% 是「vX.Y.Z 新增/修订，教训：…」式版本考古注解，
//    自家的「注解聚合」政策（AGENTS.md）从未回溯执行。本门把该政策机械化：
//    references/**/*.md 中匹配版本注解模式的行占比 > 阈值即 fail——先治病的瘦身（P2a）已完成，此后不许再沉积。
//    口径：行含 `v\d+\.\d+[^）\n]{0,40}(新增|修订|修复|更正|补)` 或 `(v\d+\.\d+(?:\.\d+)?[-a-z.\d]*…)` 形态
//    且非「已聚合」标记行 / 目录锚链（`...](##` 形态） / 表格行 / 代码块内。
//    v18.8.0 阈值 = 12%（v18.8.0 P2a 完成 SKILL/08-终检/07-审计/任务简报 聚合后实测）——v18.8.x 须降，
//    本规则**禁止抬升**；任何后续提交超 12% 即失败（强制先瘦身）。锚链/表格行/标题行/已聚合引言豁免）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { walkDir, toRepoPosix } from './_shared.mjs'

export function run(ctx) {
  const { note, ROOT } = ctx
  const ANN_RE = /v\d+\.\d+(?:[-.\d]*[a-z]*)?\s*[^，。\n]{0,24}(新增|修订|修复|更正|补充|扩展|抬升|登记)/
  const EXEMPT_RE = /注解聚合|git log|CHANGELOG|maintainers\.md|版本头|v18\.8\.0/
  const ANCHOR_LINK_RE = /\]\(#/
  const ANN_MAX_RATIO = 0.12
  // ── v18.80.1（全量审查修订批 · 报告 §C3）：**表格行沿革的独立棘轮** ─────────────────────────
  //   为什么必须单列一条：上面的 `ANN_RE` 要求「版本号 **+ 24 字内的注解动词**」，而表格里的沿革
  //   常常**只有裸版本号**（「版本」列本身就是沿革）→ `ANN_RE` 在结构上看不到它。
  //   **实证「按报告原写法（给表格行豁免加『行内含版本号即计入』）是空操作」**：本批实测现行与收紧后
  //   **都是 0/80 超限**——因为那句豁免仍受 `ANN_RE` 前置约束，改不动任何文件的命中数。
  //   故此处的度量与主判据**分开**，采**计数棘轮**：以立门时实测为基线，**只许降不许升**
  //   （沿革只增长，正是 §C3 要治的病）。基线口径 = 表格行里出现 `vX.Y[.Z]` 的行数。
  //   实测（v18.80.1 立门时）：附录 26/48 · 对照表 68/135 · status-template 15/34 · 机检硬格式 17/46
  //   · case-studies 9/27 · glossary 6/18 · deliverables 12/41 · failure-modes 4/19。
  const ANN_TABLE_BASELINE = Object.freeze({
    'skills/lunheng-article-pipeline/references/_shared/M-Gate-Algorithm-appendix.md': 26,
    'skills/lunheng-article-pipeline/references/_shared/规范-机械门对照表.md': 68,
    'skills/lunheng-article-pipeline/references/templates/status-template.md': 15,
    'skills/lunheng-article-pipeline/references/_shared/机检硬格式.md': 17,
    'skills/lunheng-article-pipeline/references/case-studies.md': 9,
    'skills/lunheng-article-pipeline/references/glossary.md': 6,
    'skills/lunheng-article-pipeline/references/deliverables.md': 12,
    'skills/lunheng-article-pipeline/references/_shared/failure-modes.md': 4,
  })
  const ANN_TABLE_VER_RE = /v\d+\.\d+(?:\.\d+)?/
  const ANN_TABLE_SEP_RE = /^\s*\|[\s:|-]+\|\s*$/
  const annOver = []
  const annStats = []
  const files = walkDir(
    join(ROOT, 'skills', 'lunheng-article-pipeline', 'references'),
    (name) => name.endsWith('.md'),
  )
  for (const p of files) {
    const lines = readFileSync(p, 'utf8').split('\n')
    let hits = 0
    for (const l of lines) {
      if (!ANN_RE.test(l) || EXEMPT_RE.test(l) || ANCHOR_LINK_RE.test(l)) continue
      // 标题行（# / ## / ### 开头）豁免：标题文本中的版本引用是结构性装饰（例：## 修订任务书（v2.2.4 新增）），不是散文注解
      if (/^\s*#{1,6}\s/.test(l)) continue
      // 表格行（| 开头）不计
      if (/^\s*\|/.test(l)) continue
      hits++
    }
    const ratio = lines.length ? hits / lines.length : 0
    annStats.push(`${toRepoPosix(p, ROOT)} ${(ratio * 100).toFixed(1)}%`)
    if (ratio > ANN_MAX_RATIO) annOver.push(`${toRepoPosix(p, ROOT)}（${(ratio * 100).toFixed(1)}% > ${ANN_MAX_RATIO * 100}%，${hits}/${lines.length} 行）`)
  }
  // 表格行沿革棘轮（计数口径见上）——⚠️ **必须在 `files` 定义之后执行**：首版把它放进常量区，
  //   触发 `ReferenceError: Cannot access 'files' before initialization`（TDZ），门整条崩掉。
  //   留此注记是因为「常量与循环混放」在这一条里极易复发。
  const tblOver = []
  for (const p of files) {
    const rel = toRepoPosix(p, ROOT)
    const base = ANN_TABLE_BASELINE[rel]
    if (base === undefined) continue      // 未登记 = 立门时未超 30%，不在棘轮面内（新增文件如需纳入，同批登记）
    let tblHits = 0
    for (const l of readFileSync(p, 'utf8').split('\n')) {
      if (!/^\s*\|/.test(l) || ANN_TABLE_SEP_RE.test(l)) continue
      if (ANN_TABLE_VER_RE.test(l)) tblHits++
    }
    if (tblHits > base) tblOver.push(`${rel}：${tblHits} 行 > 基线 ${base}`)
  }
  if (annOver.length) {
    ctx.fail('ann-density', `版本注解密度超 ${ANN_MAX_RATIO * 100}% 上限：${annOver.join('；')}——按 AGENTS.md「注解聚合」政策合并为卡头单行（最新版本 + 一句教训），历史细节指向 git log；确需抬升阈值须在同一次提交写明理由`)
  }
  note(`⑩ 注解密度：references/**/*.md 版本注解行占比 ≤ ${(ANN_MAX_RATIO * 100)}%（超限 ${annOver.length} 个；TOP5：${annStats.sort((a, b) => parseFloat(b.split(' ')[1]) - parseFloat(a.split(' ')[1])).slice(0, 5).map((s) => s.replace('%', '%')).join('、') || '—'}）`)
  if (tblOver.length) {
    ctx.fail('ann-density-table', `表格行沿革**只增不减**（「表格行含版本号」的行数超出立门基线，v18.80.1 · 报告 §C3）：${tblOver.join('；')}——按 AGENTS.md「注解聚合」政策把沿革压成一行或移出表格；确需增长须在**同一次提交**里抬该文件基线并写明理由`)
  }
  note(`⑩ 表格行沿革棘轮（v18.80.1 新增 · 报告 §C3）：${Object.keys(ANN_TABLE_BASELINE).length} 个已登记文件的「表格行含版本号」行数只许降不许升（本次超基线 ${tblOver.length} 个）——`
    + '立此门的直接证据：报告原写法（给表格豁免加「行内含版本号即计入」）**实测为空操作**（现行与收紧后都是 0/80），因为它仍受 `ANN_RE` 的「版本号 + 注解动词」前置约束，看不见「只有裸版本号」的沿革行')
}
