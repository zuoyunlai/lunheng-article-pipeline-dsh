// 批 5-2 拆分（v18.68.0）：scripts.test.mjs 巨石拆分时抽出的**跨文件共享夹具**。
// 仅放夹具与薄封装；单文件独用的夹具留在各自文件里。
//   （「不放断言」的旧表述在 v18.78.1 修正：`gateOf` 与 `assertExitBySeverity` 都是**薄断言封装**——
//    抽取的是**判据的唯一定义**，断言仍在调用点逐条写明消息；不抽取等于同一判据散落 15 处。）
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { SCRIPTS, run, parseJson, mkProject, MD } from './_fixtures.mjs'

/** SVG 图件链路用：run/<proj> 最小骨架（定稿 + 简报 + 证据包两卡）。 */
export const mkProj = (d) => {
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final', '图件'), { recursive: true })
  mkdirSync(join(proj, 'final', '证据包'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), MD)
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n子问题 A：x。\n图位数量：2\n')
  writeFileSync(join(proj, 'final', '证据包', '数据卡.md'), '# 数据卡\n\n## [D01] x\n数值 86 万\n信任级别：已发布\n')
  writeFileSync(join(proj, 'final', '证据包', '文献卡.md'), '# 文献卡\n\n## [L01] x\n信任级别：已发布\n')
  return proj
}

/** M 门用：五节文末齐备、四类证据闭环的「干净定稿」。 */
export const DRAFT_OK = '# 标题\n\n## 摘要\n\n摘要若干字。\n\n## 一、导论\n\n'
  + '正文 [L01] [D01] [C01] [先01]。'.repeat(12)
  + '\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] c\n\n## 先行者文献\n\n[先01] p\n\n## AI 使用声明\n\nAI。\n'

/** 三卡（文献/数据/案例）各一条 L01/D01/C01 的标准卡片。 */
export const cardOk = (name, ids) => `# ${name}\n\n## 📇 索引段\n\n`
  + ids.map((id) => `[${id}] 主题 ｜ 论点1`).join('\n')
  + '\n\n## 正文\n\n' + ids.map((id) => `### [${id}] 条目\n信任级别：已发布\n`).join('\n')

export const setupCards = (ev) => {
  writeFileSync(join(ev, '文献卡.md'), cardOk('文献卡', ['L01']))
  writeFileSync(join(ev, '数据卡.md'), cardOk('数据卡', ['D01']))
  writeFileSync(join(ev, '案例卡.md'), cardOk('案例卡', ['C01']))
}

/** 跑 m-gate-check 并取指定前缀的门项（找不到即断言失败）。 */
export const gateOf = (draft, ev, prefix) => {
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev])
  const it = parseJson(r).results.find((x) => x.gate.startsWith(prefix))
  assert.ok(it, `找不到门 ${prefix}`)
  return it
}

/** 造一份「两段正文 + 五节文末」的定稿：甲段 L+先（2 类）、乙段仅先（1 类）。 */
export function mkTriFixture() {
  const { d, proj, fin, ev } = mkProject({ analysis: true })
  const pad = '本段为凑足节长而写的叙述文字，刻意不含任何编号。'.repeat(5)
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n摘要若干字。\n\n'
    + `## 一、甲段\n\n${pad} 见 [L01] 与 [先01]。\n\n`
    + `## 二、乙段\n\n${pad} 见 [先02]。\n\n`
    + '## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] c\n\n'
    + '## 先行者文献\n\n[先01] p\n[先02] q\n\n## AI 使用声明\n\nAI。\n')
  return { d, proj, fin, ev }
}

/**
 * 严重度分档退出码守卫（v18.62.4 §8.1 #12 的口径；v18.78.1 全量审计 B13-②：收敛本仓 15 处逐字副本）。
 * 口径：输出含 `[P0 …]` → 期望 exit 2；仅 P1 → 期望 exit 1。
 *   断言**不得假定环境无 P0**——临时仓常缺版本一致性三文件，P0 参与退出码是**正确**行为。
 * ⚠️ 本守卫**不**接受「无 P0 且 exit 0」：那正是「该报却什么都没报」的假绿形态，故恒期望非 0。
 *   `msg` 由调用方给——各用例的失败文案是**上下文**，不随判据收敛而丢失。
 */
export const assertExitBySeverity = (r, msg) => assert.equal(r.code, (/\[P0[ \-\]]/.test(r.out) ? 2 : 1), msg)

export const mform8Of = (fin, ev) =>
  parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])).results.find((x) => x.gate.startsWith('M-Form-8'))
