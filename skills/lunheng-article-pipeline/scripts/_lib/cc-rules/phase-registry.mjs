// phase-registry.mjs — 「人在环四门」与「§6 五字段」的**唯一登记表**（v19.6.0 · 架构与机制反哺批 §3.2）
//
// **为什么需要它**（病灶实测，不是假想）：
//   「四门」这一事实此前有 **5 份实现、3 套命名口径**（**按符号名引用，不写行号**——行号会漂，
//   本仓 `repo-hygiene ⑪` 正是拦这个的）：
//     ① `handoff-check.mjs` —— `if (opt.requireGates)` 段里的三元组数组
//        `['阶段确认-Phase0.md', 'Phase 0 定题', 'Phase0']`
//     ② `pending-cli.mjs` —— `export const GATES = ['Phase0', …]`
//     ③ `flow-metrics.mjs` —— `export const GATES = [{ id: 'Phase0', label: 'P0 定题' }, …]`
//        （**label 与 ① 已不同** ⇒ 漂移已经发生，不是风险而是事实）
//     ④ `run-report.mjs` —— 采集 ② 段私有的 `const GATE_ORDER`
//     ⑤ `references/templates/主人确认-template.md` —— 「命名真源」散文段
//   而「§6 五字段」有 **2 份**（`handoff-check.mjs` 的 `GATE_FIELDS` 与 `pending-cli.mjs` 的
//   `SECTION6_FIELDS`，**当前逐字相同**——即两份靠人工保持同步）。
//   判据（本仓反复付过代价的那条）：**同一事实两处维护必然发散**——③ 的 label 与 ① 不同就是
//   已经发生的一次；而现有门**抓不到**：规则 ㉟ 只核「规则编号」，规则 ⑪ 只核「行号引用」。
//
// **修法（照抄本仓两个正向范本）**：
//   · `RULE_REGISTRY`（`rule-registry.mjs`）：「登记表 = 唯一真源……文档只许指向本表——不写数字就不会漂」；
//   · `CONTRACTS`（`content-rules.mjs`）：`handoff-check` 的角色→必需产物**从它反查**，
//     头注释逐字「真源派生（**禁止新建第二份清单**）」。
//   本表把四门的三套命名（`id` / `label` / `confirmFile`）与 §6 五字段收成**一处**，其余全部 import。
//
// **字段语义（刻意保留「两套 label」而不是统一——统一会改用户可见文案）**：
//   · `id`          机读 id（`Phase0`）：§6「回执 id」的 gate 名、`gate-receipts.jsonl` 的 `gate` 字段、
//                   门序比较键。**改动它会破坏存量账本**，禁止改。
//   · `label`       长标签（`Phase 0 定题`）：`handoff-check` 的人类可读文案沿用。
//   · `shortLabel`  短标签（`P0 定题`）：`flow-metrics.mjs` 的**输出列**沿用（存量报告形态）。
//   · `confirmFile` 落盘文件名（`阶段确认-Phase0.md`，真源 = `templates/主人确认-template.md` 的「命名真源」段）。
//
// **边界（如实声明）**：
//   · 本模块是**纯常量**：无 fs / 无网络 / 无子进程 / 无副作用，可被任何脚本与测试直接 import。
//   · 它**不判断**「某项目是否真有这四份单据」——那是 `handoff-check` 与 `pending-cli` 的事。
//   · `GATE_FIELDS` 是**字段名**真源；字段的**行文**（例如「逐字记录主人实际回复，不得改写」）
//     仍归 `templates/主人确认-template.md` —— 本表只持「给程序匹配的名字」，不持给人读的措辞。

/** 四门（人在环）——**唯一登记表**。顺序 = 门序（`run-report` / `pending-cli` 依赖此顺序）。 */
export const PHASES = Object.freeze([
  Object.freeze({ id: 'Phase0', label: 'Phase 0 定题', shortLabel: 'P0 定题', confirmFile: '阶段确认-Phase0.md' }),
  Object.freeze({ id: 'Phase2.5', label: 'Phase 2.5 大纲确认', shortLabel: 'P2.5 大纲', confirmFile: '阶段确认-Phase2.5.md' }),
  Object.freeze({ id: 'Phase3.5', label: 'Phase 3.5 洞察补充', shortLabel: 'P3.5 洞察', confirmFile: '阶段确认-Phase3.5.md' }),
  Object.freeze({ id: 'Phase5', label: 'Phase 5 终稿交付', shortLabel: 'P5 终稿', confirmFile: '阶段确认-Phase5.md' }),
])

/** 四门 id（顺序同 `PHASES`）。 */
export const PHASE_IDS = Object.freeze(PHASES.map((p) => p.id))

/** 四门确认单文件名（顺序同 `PHASES`）。 */
export const PHASE_FILES = Object.freeze(PHASES.map((p) => p.confirmFile))

/**
 * §6「主人回复」段的**固定五字段**（机检按名字匹配；缺一即「未留痕」）。
 * 真源 = `templates/主人确认-template.md` §6；本表是**给程序匹配的形态**。
 */
export const GATE_FIELDS = Object.freeze(['主人原话', '回复时间', '提问方式', '主控落盘结论', '轮次计数'])

/** `handoff-check` 用的三元组形态 `[confirmFile, label, id]`（保持既有解构顺序，减小 diff）。 */
export const PHASE_DOCS = Object.freeze(PHASES.map((p) => [p.confirmFile, p.label, p.id]))

/** 按 id 取门（找不到返回 `null`，不抛）。 */
export function phaseById(id) {
  return PHASES.find((p) => p.id === id) || null
}

/** 按 id 取确认单文件名（找不到返回 `null`）。 */
export function confirmFileOf(id) {
  const p = phaseById(id)
  return p ? p.confirmFile : null
}
