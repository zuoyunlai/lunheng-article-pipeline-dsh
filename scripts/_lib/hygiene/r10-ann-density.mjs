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
  if (annOver.length) {
    ctx.fail('ann-density', `版本注解密度超 ${ANN_MAX_RATIO * 100}% 上限：${annOver.join('；')}——按 AGENTS.md「注解聚合」政策合并为卡头单行（最新版本 + 一句教训），历史细节指向 git log；确需抬升阈值须在同一次提交写明理由`)
  }
  note(`⑩ 注解密度：references/**/*.md 版本注解行占比 ≤ ${(ANN_MAX_RATIO * 100)}%（超限 ${annOver.length} 个；TOP5：${annStats.sort((a, b) => parseFloat(b.split(' ')[1]) - parseFloat(a.split(' ')[1])).slice(0, 5).map((s) => s.replace('%', '%')).join('、') || '—'}）`)
}
