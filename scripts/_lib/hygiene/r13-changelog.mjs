// ⑬ CHANGELOG「版本段结构自洽」（v18.18.13）
//   真教训（不是假想）：v18.18.12 发版后复查发现 **`## 18.18.11 — 2026-09-26` 这个版本标题被删了**——
//   写 v18.18.12 段时 `old_string` 只匹配了那行标题、`new_string` 末尾忘了写回去，于是 v18.18.11 的
//   整段内容（`### 一、`…`### 六、`）挂到了 `## 18.18.12` 名下，两个版本段被合并。
//   **它逃过了所有门**：`consistency-check` 规则 ⑪ 只核「**当前**版本段存在」（`## 18.18.12` 在场 → 通过），
//   没有任何门管历史版本标题被删。同形失真在 v18.12.0 段也发生过一次（段内两个 `### 七、`）直到本次才发现。
//   三条不变量（完全自洽可判，不依赖 git / 网络 / 发布记录——理由与代价见 `_lib/changelog-structure.mjs` 头注释）：
//     ① 段内小节编号严格递增（抓「版本标题被删 → 两段合并 → 编号回绕」这一结构指纹）
//     ② 首个 `## ` 段的版本 == `package.json.version`
//     ③ 版本键不重复 ④ 版本键降序
//   解析器在 `_lib/changelog-structure.mjs`（可单测）；形状变了会**抛错**而不是静默通过。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseChangelogSections, reconcileChangelogStructure, readChangelogAll } from '../changelog-structure.mjs' // ⑬：CHANGELOG 版本段结构自洽（v18.18.13）

export function run(ctx) {
  const { fail, note, ROOT } = ctx
  try {
    // v18.68.0 拆档：主档 + changelog/archive/ 联合校验（不变量覆盖全量历史，见 readChangelogAll 注释）
    const clText = readChangelogAll(ROOT)
    const pkgVer = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
    const { sections } = parseChangelogSections(clText)
    const { checked, withSubs, violations } = reconcileChangelogStructure(sections, pkgVer)
    for (const v of violations) fail('changelog', `⑬ CHANGELOG 版本段结构（${v.kind}）:${v.line} ${v.msg}`)
    // 退化防线（独立于违例报出，两者不互相吞掉——设计理由见 `_lib/changelog-structure.mjs` 头注释）
    if (withSubs === 0) {
      fail('changelog', '⑬ CHANGELOG 段形变了：没有任何「### 一、」式编号小节 → 子序不变量**空跑**（不是「通过」）——请同步解析器')
    }
    if (!violations.length && withSubs > 0) {
      note(`⑬ CHANGELOG 版本段结构：${checked} 个版本段（其中 ${withSubs} 个含编号小节）编号递增、版本降序、无重复键，且首段 == package.json`)
    }
  } catch (e) {
    fail('changelog', `⑬ CHANGELOG 版本段结构对账无法执行：${e.message}`)
  }
}
