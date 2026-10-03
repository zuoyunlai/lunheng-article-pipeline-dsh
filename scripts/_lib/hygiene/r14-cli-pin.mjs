// ⑭ 外部 CLI pin 单点（三次复审 N-3，2026-09-26）
//   真教训：`scripts/plugin-surface-check.mjs` 的 `CLI_SPEC` 与 `.github/workflows/ci.yml` 的
//   loader-smoke 各硬编码了一份 CLI 版本 pin——v18.20.2 抬 pin 时**只改了前者**，于是两处分叉
//   （发布门用新检验器、CI 的「真实 Loader 冒烟」仍用旧检验器），且**无门守护**。这与仓库标志性的
//   「修一处不修一类」同型，故把「运行面只允许一处 pin」机械化。
//   判据：运行面（`scripts/**` / `.github/**` / `lib/**` / `skills/**` / 根 `package.json` /
//   `cordis.patch.yml`）里，`dsh-plugin-guide@<semver>` 只允许出现在唯一真源文件里。
//   **刻意不扫** `CHANGELOG.md` / `audits/**` / `docs/**`——那里是**留痕叙述**（引述历史 pin），
//   不是运行期 pin；按字面扫它们会把「引述被纠正内容」当成那内容本身（仓库已踩过三次的老毛病）。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CLI_PIN_OWNER = 'scripts/plugin-surface-check.mjs'
const CLI_PIN_RE = /dsh-plugin-guide@(\d+\.\d+\.\d+)/g
const inRunSurface = (p) =>
  /^(scripts|\.github|lib|skills)\//.test(p) || p === 'package.json' || p === 'cordis.patch.yml'

export function run(ctx) {
  const { fail, note, ROOT, scanSet, SELF } = ctx
  const hits = []
  for (const p of scanSet) {
    if (!inRunSurface(p) || p === SELF) continue
    if (!/\.(mjs|js|yml|yaml|json|md)$/.test(p)) continue
    const abs = join(ROOT, p)
    if (!existsSync(abs)) continue
    for (const m of readFileSync(abs, 'utf8').matchAll(CLI_PIN_RE)) hits.push({ p, v: m[1] })
  }
  const ownerHits = hits.filter((h) => h.p === CLI_PIN_OWNER)
  const others = hits.filter((h) => h.p !== CLI_PIN_OWNER)
  for (const h of others.slice(0, 5)) {
    fail('cli-pin', `⑭ 外部 CLI pin 出现第二处：${h.p} 硬编码 dsh-plugin-guide@${h.v}——本包所用 CLI 版本的**唯一 pin 点**是 ${CLI_PIN_OWNER} 的 CLI_SPEC；CI 应改用 \`node scripts/plugin-surface-check.mjs --print-cli-spec\` 派生。两处 pin 会分叉（N-3 实测：发布门 0.3.19 / CI 0.3.16）`)
  }
  if (!ownerHits.length) {
    fail('cli-pin', `⑭ ${CLI_PIN_OWNER} 里找不到 dsh-plugin-guide@<semver> pin——真源消失（常量被改名？），本门会变成恒真断言`)
  } else if (!others.length) {
    note(`⑭ 外部 CLI pin 单点：dsh-plugin-guide@${ownerHits[0].v} 仅出现于 ${CLI_PIN_OWNER}（运行面零分叉）`)
  }
}
