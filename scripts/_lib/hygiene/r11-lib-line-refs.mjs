// ⑪ `lib/**:LINE` 裸行号引用（C-9 机械化 · v18.18.9）
//   动机：审计 C-9 实测 `SECURITY.md` 引 `lib/tools.js:18,24,133,191`，四行全都不是它说的东西。
//   该处改成符号引用后，**同一份文档就地写下了政策**「行号随改动漂移故按符号引用，不写绝对行号」
//   ——**但政策没有门**。v18.18.9 复核发现隔壁那行仍写着 `lib/guard.js:177`，而该行是
//   `const cwd = process.cwd()`（真实安装点 = `installMechanismGuard()` 内的 `tools.guard(...)`）。
//   **同一页上，一行宣布政策、下一行违反它** —— 政策要靠门落，不能靠同一页的另一句话。
//   口径与豁免见 `_lib/lib-line-refs.mjs`（历史留痕按目录豁免；上游包路径如 `dsh-app-boot/lib/...` 不算）。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { findLibLineRefs, isHistoricalDoc } from '../lib-line-refs.mjs' // C-9：当前文档不得有裸 `lib/**:LINE` 引用

export function run(ctx) {
  const { fail, note, ROOT, scanSet } = ctx
  const docExts = /\.(md|html)$/
  const scannedDocs = scanSet.filter((p) => docExts.test(p) && !isHistoricalDoc(p))
  let refHits = 0
  let scannedExisting = 0
  for (const p of scannedDocs) {
    const abs = join(ROOT, p)
    if (!existsSync(abs)) continue
    scannedExisting++
    for (const hit of findLibLineRefs(readFileSync(abs, 'utf8'))) {
      refHits++
      if (refHits <= 5) {
        fail(
          'lib-line-ref',
          `${p} 用了裸行号引用 \`${hit.raw}\`——请改为**符号引用**（如「\`lib/guard.js\` 的 \`installMechanismGuard()\` 内的 \`tools.guard(...)\`」）。` +
            '理由：行号随任何改动漂移，而它读起来像一个可核验的事实——C-9 实测某处引的四行全都不是它说的东西',
        )
      }
    }
  }
  if (refHits > 5) fail('lib-line-ref', `另有 ${refHits - 5} 处裸行号引用未逐条列出`)
  note(`⑪ 文档行号引用：${scannedExisting} 个当前文档（.md/.html，已排除历史留痕）零裸 \`lib/**:LINE\` 引用`)
}
