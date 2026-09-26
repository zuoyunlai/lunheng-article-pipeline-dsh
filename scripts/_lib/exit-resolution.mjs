// 随包脚本退出码的**静态解析**（A-7③ · v18.18.11）——从 repo-hygiene 规则⑧ 抽出，便于单测。
//
// ── 为什么抽出来 ──────────────────────────────────────────────────────
// 审计 A-7③ 要求把「动态 exit」的核验从「文件里出现过即认」收紧成「三元/条件式里的数字字面量
// ⊆ 声明集」，并配回归用例。这段逻辑本次一口气被改出**三个 bug**（见下），而它当时内联在
// 700+ 行的门脚本里、**没有任何单测**——不抽出来就只能靠「跑一遍门看红不红」来验，太粗。
//
// ── 三个实测踩过的坑（都已固化成用例）──────────────────────────────────
//   ① **只取初值不够**：`final-check` 的 `exitCode` 初值 0，后续才 `= statusVal || 1` / `= 3`；
//      只看 `const/let` 初值会漏掉真值。
//   ② **`… = <另一个变量>` 时数字一个也取不到**（如 `let finalExit = exitCode`）——此时**必须
//      仍旧判为动态**，否则会误判成「已完全解析」，让下游「声明码是否在场」的检查假红。
//   ③ **复合实参不能追标识符**：`process.exit(ok ? 0 : 1)` 里的 `ok` 是**三元的条件**，不是退出值。
//      追下去会撞到 `ok = … && counts.Page >= 5 && …`，把**页数阈值 5** 当成退出码，报出假
//      「表外退出码 5」。各分支的数字本来就被 `\b\d+\b` 收全了，故**只在实参是裸标识符时才内联**。
//
// ── 边界（如实）──────────────────────────────────────────────────────
// 只做**一层**变量内联，不递归、不做流敏感分析。表达式里仍有解不出的标识符时判为 `dynamic`，
// 由调用方如实标注「未静态可判定」，**不假装核过**。

/** 从 guard 模块源码里解析它导出的数字常量（`export const X = 10`）。 */
export function parseGuardConsts(guardText) {
  const m = new Map()
  for (const x of guardText.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\b/g)) m.set(x[1], Number(x[2]))
  return m
}

/**
 * 解析一个脚本里可能出现的退出码。
 * @param {string} text 脚本源码
 * @param {Map<string,number>} guardConsts guard 导出的常量
 * @returns {{resolved:Set<number>, dynamic:boolean, indirectHits:number, exitArgs:string[]}}
 */
export function resolveExitCodes(text, guardConsts = new Map()) {
  const localConsts = new Map()
  for (const m of text.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\b/g)) localConsts.set(m[1], Number(m[2]))

  // 两种写法都看：`process.exit(N)` / `process.exitCode(N)`（调用）与 `process.exitCode = N`（赋值）
  const exitArgs = [
    ...[...text.matchAll(/process\.exit(?:Code)?\(([^)]*)\)/g)].map((m) => m[1].trim()),
    ...[...text.matchAll(/process\.exitCode\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim()),
  ]

  const collectAssignments = (nm) => {
    const esc = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${esc}\\s*=(?!=)\\s*([^\\n;]+)`, 'g') // 排除 == / === / <= 等比较
    return [...text.matchAll(re)].map((m) => m[1])
  }

  const resolved = new Set()
  let dynamic = false
  let indirectHits = 0
  const KEYWORDS = /^(?:const|let|var|true|false|null|undefined|NaN)$/

  for (const arg of exitArgs) {
    if (!arg) continue
    for (const n of arg.matchAll(/\b\d+\b/g)) resolved.add(Number(n[0]))
    for (const id of arg.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      const nm = id[1]
      if (localConsts.has(nm)) { resolved.add(localConsts.get(nm)); continue }
      if (guardConsts.has(nm)) { resolved.add(guardConsts.get(nm)); continue }
      if (/^\d+$/.test(arg)) continue // 实参本身就是数字，上面的 \b\d+\b 已收
      if (!/^[A-Za-z_$][\w$]*$/.test(arg)) { dynamic = true; continue } // 坑③：复合实参不追标识符
      const exprs = collectAssignments(nm)
      if (!exprs.length) { dynamic = true; continue } // 不是本文件局部变量（函数返回/参数）
      let unresolved = false
      for (const expr of exprs) {
        for (const n of expr.matchAll(/\b\d+\b/g)) { resolved.add(Number(n[0])); indirectHits++ }
        for (const eid of expr.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
          const e = eid[1]
          if (KEYWORDS.test(e)) continue
          if (localConsts.has(e) || guardConsts.has(e)) { resolved.add(localConsts.get(e) ?? guardConsts.get(e)); continue }
          unresolved = true // 坑②：还有解不出的标识符 → 该脚本仍是动态的
        }
      }
      if (unresolved) dynamic = true
    }
  }
  return { resolved, dynamic, indirectHits, exitArgs }
}
