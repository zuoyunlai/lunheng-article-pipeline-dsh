// 派生型规则的**真源缺失**处置（v18.78.2 · 全量审计-v18.78.1 **A6** 修复）
//
// **病灶（审计实测 + 本次复核）**：多条规则的真源文件被 `if (existsSync(p)) { …规则体… }` 包着，
//   **没有 else 分支**。真源被改名 / 移出 / 按需裁剪（子技能重构、批量重命名）时，规则**整条静默失效**，
//   而脚本照旧打印「一致性自检通过…**0 处漂移**」——正是本仓 ⑳/㉕ 明文禁止的
//   「**规则失效即静默放行**」（㉕ 的原话就在 `repo-surface-rules.mjs` 的白名单缺失分支上）。
//   A6 的反事实实验（审计在副本内做的，本次复核沿用同一判据）：把 `route-command.mjs` 改名后，
//   盘上明明还有「本技能提供 99 个 /lunheng 命令」的漂移，脚本仍 exit 0。
//
// **处置**：真源缺失即 `[P0 规则失效]`，与既有的 `[P0 派生源失效]`（`_lib/mgate-gates/` 目录缺失）
//   同族同严重度——两者都是「规则跑不起来」，绝不能读成「检查通过」。
//
// **边界（如实声明，别扩用）**：
//   · 本助手只用于「**真源**缺失 ⇒ 该规则整条跑不了」。**被检查的文档**缺失**不算**——那是「被检对象
//     不存在」，各规则按自身语义处理（例：角色卡缺失另有 `[P1 角色卡缺失]`；`SKILL.md` 缺 `- Phase：` 行
//     另记 `[P1 Phase 序列真源缺失]`——**规则还能跑，只是输入不全**，那属于 P1 而非 P0）。
//   · 判据是「路径不在盘」，**不判内容**。真源在盘但内容被改坏，由各规则自己的对账逻辑报。
import { existsSync } from 'node:fs'

/**
 * 真源存在性断言。缺失即往 `errors` 推一条 P0「规则失效」。
 * @param {string|string[]} paths - 真源路径（可多份）
 * @param {string} ruleId - 规则号（如 `'㉕ 命令数口径'`）
 * @param {Array<string>} errors - 主脚本的 errors 收集器
 * @param {string} [what] - 真源说明（写进报错，便于定位）
 * @returns {boolean} 全部在盘 = true；任一缺失 = false（调用方据此**整条跳过**规则体）
 */
export function requireTruthSource(paths, ruleId, errors, what) {
  const list = Array.isArray(paths) ? paths : [paths]
  const missing = list.filter((p) => !existsSync(p))
  if (missing.length) {
    errors.push(
      `[P0 规则失效] ${ruleId} 的真源${what ? `（${what}）` : ''}不存在：${missing.join(' / ')}——`
      + '该规则整条无法运行，**不得读成通过**（真源改名/移出/裁剪必须同批改这里的路径）',
    )
    return false
  }
  return true
}
