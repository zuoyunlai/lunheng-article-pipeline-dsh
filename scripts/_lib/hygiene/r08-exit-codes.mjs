// ⑧ 退出码契约表（v18.0.2 新增；v18.0.5 大修——第三方审计 P1-5 指出旧版「声称与能力不符」）
//    动机：退出码是**被别的组件消费的输出契约**（`final-check` 的推荐语、主控的闸门判定），
//    实测出现过两类撞码且**此前无门可拦**：
//      · `m-gate-check` 把「定稿/证据包不存在」判 exit 1 → 伪装成「P1 内容失败」，主控据此去改正文；
//      · `model-routing` 用 exit 3 表示「需人工决定」→ 与 M 门 3（仅 P2，**可放行**）撞码。
//    旧版只做两件事：`process.exit(字面量)` ∈ 声明集、以及「表内数字在文件里出现过」（近乎恒真）
//      → **运行时真实退出码（异常路径一律 1）完全不可见**，且规则自身形同虚设。
//    v18.0.5 起改为真核验：
//      ① 解析 `process.exit(<arg>)`：字面量直接用；**标识符**按「本文件 const」→「`_lib/exit-guard.mjs` 导出」
//         两级解析（这样 `process.exit(EXIT_USAGE)` 也能被看见）；
//      ② 解析结果必须是声明集的子集（**这是本规则的主要锋芒**：新加一个 `process.exit(1)` 当路径错会被抓）；
//      ③ 声明集里每个码要么被解析出来、要么在文件里以字面量出现过——**动态 exit 的计算结果无法静态判定**
//         （如 `process.exit(p0 > 0 ? 2 : …)`），此时退化为「字面量出现即认」并在输出里如实标注该脚本是动态的；
//         码 `0` 一律豁免（正常返回不写 `process.exit(0)`）；
//      ④ 异常路径：每个读盘脚本**必须** import `exit-guard`（未 import = 兜底缺失 = 判失败），
//         且 `_lib/exit-guard.mjs` 必须真在盘并导出契约里的两个常量。
//    v18.2.6 两处收紧（第三方审计指出旧版的两个盲区，均已实测确认）：
//      ⑤ **`process.exitCode = N` 赋值形态**纳入解析（Node 里它与 `process.exit(N)` 同样生效）；
//      ⑥ **「已 import guard」改为真 import 匹配**（旧版 `text.includes(GUARD)` 对**注释里提到文件名**也判真——
//         而本仓每个脚本头注释都提到它 ⇒ 该检查恒真，恰恰漏掉「注释还在、import 被删」这一最该抓的形态）。
//    v18.78.2（全量审计-v18.78.1 两处修复）：
//      ⑦ **B7**：解析前先剥离注释与字符串字面量（`_lib/source-mask.mjs`）。旧版拿全文当判据 →
//         只含注释 `// … process.exit(2) …` 与字符串 `"process.exit(7)"` 的脚本也会产出码 2/7。
//         本处两处调用点同步：① `resolveExitCodes` 内部已剥离；② **phantom 判据改用同一份剥离结果**
//         （`masked`），否则会出现「解析看剥离文本、在场判据看全文」的两套口径 —— 一句注释就能顶
//         「声明码在场」，正是要拦的假绿方向。⚠️ **真 import 探测仍走全文**：`import … from '<路径>'`
//         的路径是**字符串字面量**，剥离后反而看不见（这条刻意不剥离，口径写在下方 `importRe` 处）。
//      ⑧ **B6**：契约面由「随包 `skills/**/scripts/*.mjs`」扩到「**随包 + 仓库根 `scripts/*.mjs`**」。
//         仓库根那 10 个脚本（含发布链的 `pack-smoke.mjs`、`plugin-surface-check.mjs`）此前**无契约、无门**：
//         其中 `pack-smoke.mjs` 真的 `installExitGuard()`，却因不在随包脚本目录而不被「装了 guard 必登记」覆盖。
//         两个面的**判据同源**（同一个 `checkOne`），差异只有一处，且是刻意的：**仓库根脚本不强制装 guard**
//         （如 `closeout-verify.mjs` 自己 try/catch → 70），只要求「装了 guard 就必须登记」。
//    边界（如实）：本规则能拦「静态可解析的撞码」与「兜底缺失」，**不能**拦动态计算出的错误码——
//      那由 `tests/scripts/` 各分脚本文件的异常路径用例（传目录/传文件/PATH 置空）覆盖（v18.68.0 拆分后按脚本归位）。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveExitCodes, parseGuardConsts } from '../exit-resolution.mjs' // A-7③：退出码静态解析（含一层变量内联，可单测）

const GUARD = '_lib/exit-guard.mjs'

export function run(ctx) {
  const {
    fail, note, scriptDir, rootScriptDir,
    EXIT_CONTRACT, EXIT_GUARDED_EXEMPT, ROOT_EXIT_CONTRACT, ROOT_EXIT_GUARDED_EXEMPT,
  } = ctx
  const dynamicScripts = []
  let indirectHits = 0 // A-7③：一层变量内联累计命中数（跨脚本统计，故声明在循环外）
  const guardPath = join(scriptDir, GUARD)
  if (!existsSync(guardPath)) {
    fail('exit-code', `缺少 ${GUARD}——退出码硬化的实现不在盘（契约里 10/70 的语义无处可查）`)
  } else {
    const gt = readFileSync(guardPath, 'utf8')
    for (const [name, val] of [['EXIT_USAGE', 10], ['EXIT_INTERNAL', 70]]) {
      if (!new RegExp(`export const ${name} = ${val}\\b`).test(gt)) {
        fail('exit-code', `${GUARD} 未按契约导出 ${name} = ${val}（契约表与 troubleshooting §8 都引它）`)
      }
    }
  }
  // 静态 import 形态 + 动态 import() 形态（v18.62.4 #13 收紧：两处 guard 探测同源）
  const guardEsc = GUARD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // ⚠️ B7 的口径边界：import 探测**不能用剥离文本**——`from '<路径>'` 的路径本身是字符串字面量，
  //   剥离后整条 import 语句就看不见了。而「注释里提到算不算」这一半由 `(?:^|\n)\s*import` 锚定挡住
  //   行注释（`// import …` 行首是 `//`，不匹配）；块注释里的裸 import 行是本口径已知的漏面，如实登记。
  const importRe = new RegExp(`(?:^|\\n)\\s*import[^\\n]*?from\\s*['"][^'"]*${guardEsc}['"]|import\\(\\s*['"][^'"]*${guardEsc}['"]\\s*\\)`)
  const guardConsts = existsSync(guardPath) ? parseGuardConsts(readFileSync(guardPath, 'utf8')) : new Map()

  /**
   * 单个脚本的退出码判定（v18.78.2 B6：抽出，供「随包」与「仓库根」两个面共用同一判据）。
   * @param {string} name 脚本名
   * @param {string} dir 所在目录
   * @param {number[]} allowed 契约声明的码
   * @param {string} label 输出前缀（'' = 随包；'scripts/' = 仓库根，便于在同一行 note 里分辨）
   * @param {{requireGuard:boolean}} opt 是否强制装 guard（随包 = 是；仓库根 = 否，见头注释 ⑧）
   */
  const checkOne = (name, dir, allowed, label, { requireGuard }) => {
    const p = join(dir, name)
    if (!existsSync(p)) { fail('exit-code', `退出码表登记的脚本不存在：${label}${name}`); return }
    const text = readFileSync(p, 'utf8')
    // ①-③（A-7③ v18.18.11）：静态解析交给 `_lib/exit-resolution.mjs`（含「一层变量内联」，可单测）。
    //   该模块头注释记了本次一口气修掉的三个坑（只取初值 / 赋值为另一变量 / 复合实参误追标识符）+ B7 的剥离口径。
    const { resolved, dynamic: dynamicExit, indirectHits: hits, masked } = resolveExitCodes(text, guardConsts)
    indirectHits += hits
    // 真 import 检查（v18.2.6 收紧）：旧实现是 `text.includes(GUARD)`——**注释里提到也算「已 import」**，
    //   于是「头注释写了 `_lib/exit-guard.mjs`、代码里却删了 import」这种**最该抓的形态**恰好被判通过
    //   （本仓每个脚本的头注释都提到该文件名，等于这条检查对它们恒真）。现改为匹配真正的 import：
    //   静态 `import … from '<…>/_lib/exit-guard.mjs'` 或动态 `import('<…>/_lib/exit-guard.mjs')`。
    const usesGuard = importRe.test(text)
    if (usesGuard) { resolved.add(10); resolved.add(70) }   // 异常路径由 guard 统一映射（fs → 10；其余 → 70）
    const unexpected = [...resolved].filter((c) => !allowed.includes(c))
    if (unexpected.length) {
      fail('exit-code', `${label}${name}: 使用了表外退出码 ${unexpected.join(', ')}（已声明 ${allowed.join('/')}）——若是有意新增，请同步 repo-hygiene 的契约表（随包 = EXIT_CONTRACT；仓库根 = ROOT_EXIT_CONTRACT）与 docs/troubleshooting.md §8`)
    }
    // 动态 exit：静态不可判定 → 退化为「剥离后文本里出现过即认」，并在 note 里如实标注（不假装核验过）
    // B7：这里的在场判据用 `masked`（与解析同一份剥离结果）——注释/字符串不得为「声明码在场」作证。
    const phantom = allowed.filter((c) => c !== 0 && !resolved.has(c) && !(dynamicExit && new RegExp(`\\b${c}\\b`).test(masked)))
    if (phantom.length) {
      fail('exit-code', `${label}${name}: 契约表声明了 ${phantom.join(', ')}，但脚本里既解析不出、也无字面量（注释与字符串不算）——表格已过期，请核对`)
    }
    if (requireGuard && !usesGuard) {
      fail('exit-code', `${label}${name}: 未真正 import ${GUARD}（注释里提到不算）——异常路径会退回 Node 默认的 exit 1，与「1 = P1 内容失败」撞义（v18.0.5 起每个读盘脚本都必须装 guard；v18.2.6 起本检查改为匹配真实 import 语句）`)
    }
    if (dynamicExit) dynamicScripts.push(`${label}${name}`)
  }

  for (const [name, allowed] of Object.entries(EXIT_CONTRACT)) {
    checkOne(name, scriptDir, allowed, '', { requireGuard: true })
  }
  // B6：仓库根 `scripts/*.mjs` 的平行契约面（不强制装 guard，见头注释 ⑧）
  for (const [name, allowed] of Object.entries(ROOT_EXIT_CONTRACT)) {
    checkOne(name, rootScriptDir, allowed, 'scripts/', { requireGuard: false })
  }

  // v18.12.0（L-68）：「装了 guard 必登记」的**覆盖面断言**（旧表靠人工维护，漏登记无门发现）。
  //   为什么把它放在逐脚本循环之后而不是并进去：它判的是**表本身完不完整**（集合关系），
  //   而不是某个脚本的内容——混进循环会让「新增脚本忘登记」看起来像那个脚本的错。
  // v18.62.4（全量审计-v18.62.3 §8.1 #13）：**两处 guard 探测必须同源**。
  //   病灶：本循环旧版用**自己另写的一条正则**（只认静态 `import … from`），而上方逐脚本检查
  //   （`:506` 的 `importRe`）**已认静态 + 动态 `import(…)` 两种形态**。于是用
  //   `await import('…/_lib/exit-guard.mjs')` 的脚本：**先通过**「真 import 检查」，
  //   却在本覆盖面断言里**不被算作装了 guard** → 只要它没登记进 EXIT_CONTRACT，就**静默逃逸**
  //   （正是本规则要拦的那个后门）。**同一事实两处实现，谁也不知道谁先漂** —— 本仓最反感的形态。
  //   修法：直接复用上方那条 `importRe`（单一真源），删掉本处另写的正则。
  // v18.78.2（B6）：覆盖面断言同样**扩到两个面**（随包 + 仓库根）——否则新出现的「装了 guard 的
  //   仓库根脚本」仍可静默逃逸，而它恰恰是发布链自己（`pack-smoke.mjs`）。
  const coverageOf = (dir, contract, exempt, label) => {
    const missed = []
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
      if (contract[f] || exempt[f]) continue
      const t = readFileSync(join(dir, f), 'utf8')
      if (importRe.test(t)) missed.push(`${label}${f}`)
    }
    return missed
  }
  const guardedButUnregistered = [
    ...coverageOf(scriptDir, EXIT_CONTRACT, EXIT_GUARDED_EXEMPT, ''),
    ...coverageOf(rootScriptDir, ROOT_EXIT_CONTRACT, ROOT_EXIT_GUARDED_EXEMPT, 'scripts/'),
  ]
  if (guardedButUnregistered.length) {
    fail('exit-code', `${guardedButUnregistered.join(', ')}：装了 ${GUARD} 却未登记进契约表——` +
      '装了 guard 的脚本其异常路径会产出 10/70，而它自己新加的表外退出码将没有任何门能拦（这正是本规则的锋芒）。' +
      '请在契约表补一行（随包 = EXIT_CONTRACT；仓库根 = ROOT_EXIT_CONTRACT）；若确需豁免，必须在对应的 *_EXIT_GUARDED_EXEMPT 写明理由（不得静默跳过）')
  }
  const totalContracts = Object.keys(EXIT_CONTRACT).length + Object.keys(ROOT_EXIT_CONTRACT).length
  note(
    `⑧ 退出码表：${totalContracts} 个脚本的退出码契约已核（随包 ${Object.keys(EXIT_CONTRACT).length} + **仓库根 ${Object.keys(ROOT_EXIT_CONTRACT).length}**（v18.78.2 B6）；静态解析 process.exit/exitCode 两种写法 + **一层变量内联**（A-7③）+ guard **真 import** 兜底检查 + **注释/字符串先剥离**（v18.78.2 B7））` +
      `；覆盖面：凡 import ${GUARD} 的脚本 100% 已登记（两个面合计豁免 ${Object.keys(EXIT_GUARDED_EXEMPT).length + Object.keys(ROOT_EXIT_GUARDED_EXEMPT).length} 个）` +
      `；一层内联命中 ${indirectHits} 处字面量` +
      (dynamicScripts.length ? `；**仍未静态可判定**（仅对契约码核「剥离后出现过」，如实标注不假装核过）：${dynamicScripts.join(', ')}` : '；全部脚本均可静态判定'),
  )
}
