// ⑧c 随包脚本「执行面/写盘面」派生对账（C-7 机械化 · v18.18.8）
//   动机：`SECURITY.md` 是操作者安装前的**信任边界依据**，其中一段手写维护「哪些随包脚本会写盘 /
//   会派生子进程」。这类**手写代码事实清单**正是本仓反复出错的形态（C-1 工具数 / D-1 发布面负清单 /
//   C-11 退出码表 / C-7 本次，同族）——代码一改、清单不跟，而失真方向几乎总是**低报执行面**
//   （把会写盘的脚本说成只读）。审计 C-7 的实测即如此：`apply-compression-cycle.mjs` 被列为只读，
//   而它 spawnSync 转调的 `build-evidence-bundle.mjs` 有 10 处写盘。
//   现改为**从源码派生 + 双向对账**。三档口径（写内容 / 仅建目录 / 子进程）见 `_lib/script-surface.mjs`。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deriveScriptSurface, parseSecuritySurface, reconcileSurface } from '../script-surface.mjs' // C-7：随包脚本执行面/写盘面 ∈ SECURITY.md

export function run(ctx) {
  const { fail, note, ROOT } = ctx
  try {
    const surface = deriveScriptSurface(join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts'))
    const declared = parseSecuritySurface(readFileSync(join(ROOT, 'SECURITY.md'), 'utf8'))
    const diff = reconcileSurface(surface, declared)
    const label = { spawn: '子进程面', writeContent: '写内容面', mkdirOnly: '仅建目录' }
    let drifted = false // v18.29.1：本行末尾旧写死「与 SECURITY.md 双向一致」——**有漂移时它也照说**，
    //   反向自证时抓到的假陈述（门报红、同一行却宣称一致）。判据：文案必须由本次比较结果决定，不得写死。
    for (const [key, d] of Object.entries(diff)) {
      if (d.onlyDerived.length) {
        drifted = true
        fail('surface', `${label[key]}：源码派生出的 ${d.onlyDerived.join(', ')} **未写进** SECURITY.md 的随包脚本行——清单落后于代码（低报执行面）`)
      }
      if (d.onlyDoc.length) {
        drifted = true
        fail('surface', `${label[key]}：SECURITY.md 列了 ${d.onlyDoc.join(', ')} 但**源码里已无该能力**——清单陈旧，请删或改`)
      }
    }
    note(
      `⑧c 随包脚本执行面：子进程 ${surface.spawn.length} / 写内容 ${surface.writeContent.length} / 仅建目录 ${surface.mkdirOnly.length} / 只读 ${surface.readOnly.length}` +
        `（共 ${surface.all.length}）——与 SECURITY.md ${drifted ? '**不一致（差异见上）**' : '双向一致'}`,
    )
  } catch (e) {
    fail('surface', `⑧c 随包脚本执行面对账无法执行：${e.message}`)
  }
}
