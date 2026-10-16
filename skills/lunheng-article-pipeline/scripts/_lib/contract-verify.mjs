// 契约一致性核验（v19.8.0 · 反哺报告 v9 D6-a）
//
// **为什么需要**：机检契约串（exit code 族 / 六要素 / 三要素）此前散布在 20 个脚本的头注释与
// `SKILL.md` / `AGENTS.md` 双写——已有两次实测事故（v18.88.0：「语义等价但不同形」让
// `consistency-check` ⑥b 与 `docs-facts` 同时失明）。根因 = **同一事实没有机器可读的单一真源**。
// 现收敛到 `_lib/contracts.json`；本模块是它的**唯一消费者接口**：
//   · `self-check.mjs` 第⑥组调用 `verifyContracts()`（装包侧自证）；
//   · `tests/contracts.test.mjs` 注入篡改夹具验证「漂移必被抓」（仓库侧回归）。
//
// 判据（与 D6-a 验收判据同口径）：
//   ① `contracts.json` 可解析、键齐全；
//   ② 每个 `exitCodes.<script>` 里声明的非 usage 退出码，须以**字面量**出现在该脚本源码中
//      （`exit-guard.mjs` 已统一持有 10/70，脚本内其余码各自持有）——篡改任一脚本的常量
//      即造成「声明在案、实现不在场」→ 记 FAIL；
//   ③ `SKILL.md` 的交接六要素行须含全部六要素词；产物三要素行须含「路径 + 字节数 + 结构自检结果」。
//
// 边界（如实声明）：②只证「字面量在场」，不证「语义正确」——语义仍靠各脚本测试；本模块把
// 「漂移没有任何门会响」这一历史形态堵死，不假装能判语义。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CONTRACTS_REQUIRED_KEYS = ['exitCodes', 'handoffSixElements', 'artifactThreeElements']

/**
 * 核验契约一致性。返回 `{ issues: string[] }`——issues 非空即漂移（每条一句、含落点）。
 * @param {string} scriptsDir - `.../skills/lunheng-article-pipeline/scripts`
 * @param {string} skillMdPath - `.../skills/lunheng-article-pipeline/SKILL.md`（三要素行在此）
 * @param {string} [agentsMdPath] - `.../skills/lunheng-article-pipeline/AGENTS.md`（六要素枚举在此；缺省回退 SKILL.md）
 */
export function verifyContracts(scriptsDir, skillMdPath, agentsMdPath) {
  const issues = []
  const cjPath = join(scriptsDir, '_lib', 'contracts.json')
  let contracts
  try {
    contracts = JSON.parse(readFileSync(cjPath, 'utf8'))
  } catch (e) {
    return { issues: [`_lib/contracts.json 缺失或不可解析（${e && e.message ? e.message : e}）——契约单一真源不在场`] }
  }
  for (const k of CONTRACTS_REQUIRED_KEYS) {
    if (!contracts[k]) issues.push(`contracts.json 缺键 ${k}`)
  }
  if (issues.length) return { issues }

  // ① 每个声明的退出码须以字面量出现在对应脚本源码中（10/70 由 exit-guard 持有，跳过）
  for (const [script, codes] of Object.entries(contracts.exitCodes)) {
    let src
    try {
      src = readFileSync(join(scriptsDir, script), 'utf8')
    } catch {
      issues.push(`contracts.json 声明了 ${script}，但该脚本不在 scripts/ 目录（改名未同步契约）`)
      continue
    }
    for (const [name, code] of Object.entries(codes)) {
      if (code === 10 || code === 70) continue   // exit-guard.mjs 统一持有
      if (!new RegExp(`(?<![\\d.])${code}(?![\\d.])`).test(src)) {
        issues.push(`${script}：契约声明 ${name}=${code}，但源码中无该字面量——常量被改或实现缺失（契约漂移）`)
      }
    }
  }

  // ② 六要素（枚举真源 = AGENTS.md；纯技能镜像无 AGENTS.md 时回退 SKILL.md）+ 三要素（SKILL.md）
  try {
    let enumText = ''
    if (agentsMdPath) { try { enumText = readFileSync(agentsMdPath, 'utf8') } catch { /* 回退 */ } }
    if (!enumText) enumText = readFileSync(skillMdPath, 'utf8')
    for (const el of contracts.handoffSixElements) {
      if (!enumText.includes(el)) issues.push(`六要素枚举文档未含「${el}」（契约真源 = contracts.json；枚举落点 = AGENTS.md，回退 SKILL.md）`)
    }
    const skill = readFileSync(skillMdPath, 'utf8')
    if (!skill.includes(contracts.artifactThreeElements.join(' + '))) {
      issues.push(`SKILL.md 未含产物三要素行「${contracts.artifactThreeElements.join(' + ')}」（契约真源 = contracts.json）`)
    }
  } catch (e) {
    issues.push(`SKILL.md 不可读（${e && e.message ? e.message : e}）——六要素/三要素无法对账`)
  }
  return { issues }
}
