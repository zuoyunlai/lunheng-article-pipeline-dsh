// 包版本解析（v18.62.4 · 全量审计-v18.62.3 §8.3 #39）：随包脚本产物里 `version` 字段的**唯一真源**。
//
// ── 为什么需要（病灶）────────────────────────────────────────────────
//   7 个随包脚本在自己的 JSON 产物里写死 `version: 'v18.11.0'` 这类字面量，**自实装起从未更新**：
//   实测 `structure-check` / `methodology-check` / `cite-coverage-check` / `meta-synthesize` 停在
//   **v18.11.0**、`quality-score` 停 **v18.24.0**、`g-audit-check` 停 **v18.41.0**、`journal-fit` 停 **v18.59.0**，
//   而包版本已是 **v18.62.4**。这些字段是给下游（审计报告、总报告、`--json` 消费者）看**产物出自哪一版机制**的，
//   写死即**必然腐烂**（本轮 bump 一次就偏一版），且**没有任何门覆盖**它（实测 grep 两门均无）。
//   判据：**「版本」是一处事实，就不该有 7 份手抄本**——本仓已为「同一事实两处维护」立过多条规则。
//
// ── 语义（与 `lib/index.js` 的 `readPackageVersion()` 同源）──────────
//   返回**包版本裸号**（如 `18.62.4`，不带 `v` 前缀），由调用方决定呈现形态（本仓产物惯例是 `v18.62.4`）。
//
// ── 布局（沿用 `consistency-check.mjs` 已验证的两种）────────────────
//   ① 仓库布局：`<repo>/package.json` + `<repo>/skills/lunheng-article-pipeline/scripts/_lib/`（向上 4 级）
//   ② 技能即包根：`<repo>/skills/lunheng-article-pipeline/package.json`（向上 2 级）
//   ⚠️ 部署镜像（`<工作区>/.dsh/skills/lunheng-article-pipeline/`）**不含 package.json**——
//      该形态下读到的是 `'unknown'`；**这是如实降级**，不得用硬编码值来「看起来正常」。
//      镜像里运行时应由上游（真源侧产出的报告）携带版本，而非让镜像自己猜。
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))          // …/skills/lunheng-article-pipeline/scripts/_lib
const CANDIDATES = [
  join(HERE, '..', '..', 'package.json'),                     // 技能即包根：<skillRoot>/package.json
  join(HERE, '..', '..', '..', '..', 'package.json'),         // 仓库布局：<repo>/package.json
]

/**
 * 读随包 `package.json` 的 `version`。
 * @returns {string} 裸版本号（如 `18.62.4`）；读不到 → `'unknown'`（**如实降级，不臆造**）
 */
export const packageVersion = () => {
  for (const p of CANDIDATES) {
    try {
      if (!existsSync(p)) continue
      const v = JSON.parse(readFileSync(p, 'utf8')).version
      if (typeof v === 'string' && v.trim()) return v.trim()
    } catch { /* 继续试下一个候选 */ }
  }
  return 'unknown'
}

/** 产物里惯用的带前缀形态：`v18.62.4`；读不到时为 `vunknown`（明显异常，便于被发现）。 */
export const packageVersionTag = () => 'v' + packageVersion()
