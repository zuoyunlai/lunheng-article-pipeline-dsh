#!/usr/bin/env node
// 生成 `lib/change-surface.json`（v19.6.1 · 全量审计-2026-10-15 **F-4** 修复）
//
// ── 为什么需要它（病灶：政策冲突，不是笔误）────────────────────────────────────────────
// `lib/index.js` 的「变更面」提示（v19.5.0）唯一数据源是**包根 `CHANGELOG.md`**；而 `package.json`
//   的 `files` 白名单**不含 CHANGELOG.md**，且**三道打包门**（`scripts/_lib/pack-negative.mjs`、
//   `scripts/_lib/hygiene/r06-pack.mjs`、`tests/scripts/pack-smoke.test.mjs`）**主动禁止**它随包。
//   后果：**任何 npm 安装形态**下该提示 100% 命中降级分支（「本次行为变更未登记……随包目录不含
//   CHANGELOG，读不到」）。而两条 `batch26-*` 钉都从**仓库根**读 CHANGELOG → 开发树恒绿、
//   打包面永远测不到——「开发树绿、发布物失效」的典型。
//
// ── 修法：把**派生数据**随包（审计 §F-4 建议 ①）────────────────────────────────────────
//   本脚本把 CHANGELOG 当前版本段的机读行**摘出来**，写成 `lib/change-surface.json`（`lib/` 在
//   `files` 白名单内 → 随包发货）。运行期 `readChangeSurface()` **优先读它**、CHANGELOG 作开发树兜底。
//   **为什么不直接把 CHANGELOG 加进 files**：那要同批改三条打包门（负清单是**有意的**：CHANGELOG
//   是 append-only 的仓库向留痕，不是运行期资产）；而把「运行期真正需要的三个字段」单独派生出来，
//   改动面最小、且**数据形状由本脚本负责**。
//
// ── 判据与同步（**派生量必须有门**）──────────────────────────────────────────────────────
//   `lib/change-surface.json` 是**派生量**，必须与 CHANGELOG 的当前版本段一致——`tests/changelog-structure
//   .test.mjs` 的对账用例会本脚本重算一遍并逐字段比对：不一致即红（修法 = 跑一次本脚本）。
//   **每次 bump 之后都要跑它**（见 `CONTRIBUTING.md` 升级流程第 3 步）。
//
// 用法：`node scripts/gen-change-surface.mjs [--check]`
//   `--check` = 只校验不写盘（CI/门用；与文件不一致 → exit 1）
// 退出码：0 = 成功（或 `--check` 一致）｜ 1 = `--check` 发现不一致 ｜ 10 = 参数/路径错 ｜ 70 = 内部错
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHANGELOG = join(ROOT, 'CHANGELOG.md')
const OUT = join(ROOT, 'lib', 'change-surface.json')

/**
 * 从 CHANGELOG 摘出「当前版本段」的变更面（与 `lib/index.js` 的运行期解析**同口径**）。
 * @returns {{ version: string, count: number|null, anchor: string|null, sectionLine: number }}
 */
export function deriveChangeSurface(changelogText) {
  const lines = String(changelogText).split('\n')
  // 当前版本段 = 首个 `## <ver>` 标题行（含其行号），到此段结束（下一个 `## ` 或文末）
  let start = -1
  let version = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(\d+\.\d+\.\d+)\b/)
    if (m) { start = i; version = m[1]; break }
  }
  if (start === -1) throw new Error('CHANGELOG 里找不到任何 `## X.Y.Z` 版本段——段形变了（运行期解析同源，须同步）')
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break }
  }
  const seg = lines.slice(start, end).join('\n')
  const mm = /<!--\s*行为变更\s*(\d+)\s*条\s*\|\s*锚点\s*=\s*([^（(]*)/.exec(seg)
  return {
    version,
    count: mm ? Number(mm[1]) : null,
    anchor: mm ? mm[2].trim() : null,
    sectionLine: start + 1,
  }
}

/** 读 CHANGELOG → 派生对象（供本脚本与测试共用，避免两处各写一份解析）。 */
export function deriveFromRepo(changelogPath = CHANGELOG) {
  const d = deriveChangeSurface(readFileSync(changelogPath, 'utf8'))
  return { version: d.version, count: d.count, anchor: d.anchor }
}

/** 生成待落盘内容（`generatedAt` 不参与一致性判定——它是留痕，不是派生量）。 */
function build() {
  const d = deriveFromRepo()
  return {
    _comment: '派生文件，由 scripts/gen-change-surface.mjs 从 CHANGELOG.md 的当前版本段生成；'
      + '改 CHANGELOG 后重跑该脚本（对账门：tests/changelog-structure.test.mjs）。**不要手改**。',
    version: d.version,
    count: d.count,
    anchor: d.anchor,
    generatedAt: new Date().toISOString(),
  }
}

/** 一致性判定只比**派生字段**（`_comment` / `generatedAt` 属留痕，不参与）。 */
export function isInSync(onDisk, expected) {
  if (!onDisk || typeof onDisk !== 'object') return false
  return onDisk.version === expected.version
    && onDisk.count === expected.count
    && onDisk.anchor === expected.anchor
}

function main() {
  const check = process.argv.slice(2).includes('--check')
  const argv = process.argv.slice(2).filter((a) => a !== '--check')
  if (argv.length) { console.error(`未知参数：${argv.join(' ')}\n用法：node scripts/gen-change-surface.mjs [--check]`); process.exit(10) }
  const next = build()
  if (check) {
    const onDisk = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null
    if (!isInSync(onDisk, next)) {
      console.error(`✗ lib/change-surface.json 与 CHANGELOG 当前版本段不一致\n  盘上：${JSON.stringify(onDisk && { version: onDisk.version, count: onDisk.count, anchor: onDisk.anchor })}\n  应为：${JSON.stringify({ version: next.version, count: next.count, anchor: next.anchor })}\n→ 修法：node scripts/gen-change-surface.mjs`)
      process.exit(1)
    }
    console.log(`✓ lib/change-surface.json 与 CHANGELOG § ${next.version} 一致（行为变更 ${next.count} 条）`)
    return
  }
  writeFileSync(OUT, JSON.stringify(next, null, 2) + '\n', 'utf8')
  console.log(`✓ 已生成 lib/change-surface.json：version=${next.version} / count=${next.count} / anchor=${next.anchor}`)
}

// 仅在被直接执行时跑 main（被测试 import 时不产生副作用——本仓对「import 即副作用」有教训）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
