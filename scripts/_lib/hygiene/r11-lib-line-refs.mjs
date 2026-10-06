// ⑪ `lib/**:LINE` 裸行号引用（C-9 机械化 · v18.18.9）
//   动机：审计 C-9 实测 `SECURITY.md` 引 `lib/tools.js:18,24,133,191`，四行全都不是它说的东西。
//   该处改成符号引用后，**同一份文档就地写下了政策**「行号随改动漂移故按符号引用，不写绝对行号」
//   ——**但政策没有门**。v18.18.9 复核发现隔壁那行仍写着 `lib/guard.js:177`，而该行是
//   `const cwd = process.cwd()`（真实安装点 = `installMechanismGuard()` 内的 `tools.guard(...)`）。
//   **同一页上，一行宣布政策、下一行违反它** —— 政策要靠门落，不能靠同一页的另一句话。
//   口径与豁免见 `_lib/lib-line-refs.mjs`（历史留痕按目录豁免；上游包路径如 `dsh-app-boot/lib/...` 不算）。
//
// ── v18.78.2（全量审计-v18.78.1 B8）：扫面由「文档」扩到「**脚本注释**」────────────────────────
//   审计 B8 的证据是 `scripts/link-check.mjs` 的 SUSPECT 注释**自陈**：规则 ⑪ 管不到仓库脚本注释里的
//   互指，而全库同类引用实测成片（该注释当时估 9 处；本次扩面后实测 **16 个文件 / 20 处**——数字的
//   真源是 `_lib/lib-line-refs.mjs` 的 `SCRIPT_COMMENT_REF_BASELINE`，本处不再复述以免两处维护）。
//   两个扫面、两档强度（**刻意不同，理由在下面**）：
//     · **文档面（`.md`/`.html`，含历史留痕豁免）**：硬零——有则判失败。文档里的行号引用没有任何正当理由。
//     · **脚本注释面（`.mjs`/`.js` 的注释文本）**：**棘轮**——`SCRIPT_COMMENT_REF_BASELINE` 逐文件登记上限，
//       **新增即红、缩减即绿**。为什么不能硬零：现有 20 处里多数是规则的自我描述与夹具（引文，改它=
//       篡改引文），其余落在本批不可改的 `lib/**` 与跨簇在改的 `tests/**`、`skills/**` ——硬零会让门
//       **永久红**，而永久红的门等于没有门（判据同 ⑦b）。
//   **只扫注释、不扫代码**：由 `_lib/source-mask.mjs` 的 `extractComments()` 保证（代码里的正则字面量、
//     字符串夹具都不会被误判成引用）。**边界（如实）**：① 注释面的判据只到「形态 + 数量」，
//     「这条引用是否已经指错」不静态判定（那正是要求改符号引用的理由）；② 只有 `<name>.mjs|.js:LINE`
//     与 `lib/**.js:LINE` 两种形态被认（`lib/**.mjs:LINE` 不在内——本仓 `lib/` 只有 `.js`）；
//     ③ 扫描器自身的定义与夹具按 `SCRIPT_COMMENT_REF_EXEMPT` 豁免（引文，同 ⑦b 的 SELF 思路）。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  findLibLineRefs,
  findScriptLineRefs,
  isHistoricalDoc,
  SCRIPT_COMMENT_REF_BASELINE,
  SCRIPT_COMMENT_REF_EXEMPT,
} from '../lib-line-refs.mjs' // C-9：当前文档不得有裸 `lib/**:LINE` 引用；B8：脚本注释面棘轮
import { extractComments } from '../source-mask.mjs' // B8：只取注释文本（代码里的正则/字符串不算）

export function run(ctx) {
  const { fail, note, ROOT, scanSet } = ctx
  // ── 文档面：硬零 ─────────────────────────────────────────────────────────────────────
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

  // ── 脚本注释面（B8）：棘轮 ─────────────────────────────────────────────────────────────
  //   `SCRIPT_COMMENT_REF_BASELINE` 是单一真源（登记在 `_lib/lib-line-refs.mjs`，与 ⑪ 的文档面同址）。
  const scriptFiles = scanSet.filter((p) => /\.(mjs|js)$/.test(p) && !SCRIPT_COMMENT_REF_EXEMPT.has(p))
  const baselineSeen = new Set()
  let scriptScanned = 0
  let scriptRefTotal = 0
  let ratchetBreaches = 0
  for (const p of scriptFiles) {
    const abs = join(ROOT, p)
    if (!existsSync(abs)) continue
    scriptScanned++
    const comments = extractComments(readFileSync(abs, 'utf8'))
    // 两形态合一（文档面判据 + `lib/**.js:LINE`）：去重后计**唯一引用数**（同一处写两遍只算一处）
    const unique = [...new Set([...findLibLineRefs(comments), ...findScriptLineRefs(comments)].map((h) => h.raw))].sort()
    if (!unique.length) continue
    scriptRefTotal += unique.length
    const cap = SCRIPT_COMMENT_REF_BASELINE.get(p)
    if (cap === undefined) {
      ratchetBreaches++
      if (ratchetBreaches <= 5) {
        fail(
          'lib-line-ref',
          `${p} 的注释里出现未登记的裸行号引用（${unique.length} 处，首例 \`${unique[0]}\`）——` +
            '请改为**符号引用**（行号随任何改动漂移）；若确属**引文/反面教材**（改它=篡改引文），' +
            '在 `_lib/lib-line-refs.mjs` 的 `SCRIPT_COMMENT_REF_BASELINE` 登记并写明理由（v18.78.2 B8：脚本注释面是棘轮，不是静默豁免）',
        )
      }
    } else {
      baselineSeen.add(p)
      if (unique.length > cap) {
        ratchetBreaches++
        if (ratchetBreaches <= 5) {
          fail(
            'lib-line-ref',
            `${p} 的注释里有 ${unique.length} 处裸行号引用 > 棘轮上限 ${cap}（首例 \`${unique[0]}\`）——` +
              '新增当即拦下；确属引文请在 `_lib/lib-line-refs.mjs` 的 `SCRIPT_COMMENT_REF_BASELINE` 同一次抬升上限并写明理由',
          )
        }
      }
    }
  }
  const staleBaseline = [...SCRIPT_COMMENT_REF_BASELINE.keys()].filter((p) => !baselineSeen.has(p))
  note(
    `⑪ 文档行号引用：${scannedExisting} 个当前文档（.md/.html，已排除历史留痕）零裸 \`lib/**:LINE\` 引用` +
      `｜**脚本注释面（v18.78.2 B8）**：${scriptScanned} 个 .mjs/.js 的注释文本已扫，命中 ${scriptRefTotal} 处、` +
      `棘轮 ${baselineSeen.size}/${SCRIPT_COMMENT_REF_BASELINE.size} 个已登记文件在基线内（豁免 ${SCRIPT_COMMENT_REF_EXEMPT.size} 个 = 规则本体与夹具）` +
      `${staleBaseline.length ? `；⚠️ 基线内 ${staleBaseline.length} 个文件已无命中，可把上限改小（${staleBaseline.slice(0, 3).join(' / ')}…）` : ''}`,
  )
}
