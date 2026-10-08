// 门运行结果统一类型（v18.80.4 · 审计优化方向 4 落地 · 批 B）
//
// ── 为什么需要 ────────────────────────────────────────────────────────────────────────────
// 审计 P1-8 的病灶是「**门执行错误被当成缺数据（N/A）**」；而本批修复时发现同一个判据在
//   `quality-score.mjs` 里**写了五遍**（M 门一处 + 四个三检门各一处），且形状还不一致
//   （M 门用三条件 `gateErr`，四检门用 `status === null || status === 70`）。
//   判据一旦分头写，下一次新增门或新增分量时**必然漏掉一处**——本仓的「同族收紧 ≠ 一致」
//   已在 `cli-args.mjs` 与 `run-path-fence.mjs` 两处发作过，这次的对象是**门运行状态**。
//   故：**一处定义、处处消费**。
//
// ── 四态语义（不得混用；与 quality-score 的 N/A 三态、M 门的 SKIP/通过/N-A 三态同族）──────
//   · `ok`            门跑通并产出**可判定产物**。`status` 允许 0/1/2/3——那是**内容判定档**
//                     （0 全过 / 1 有 P1 / 2 有 P0 / 3 仅 P2·软提示），**不是运行错误**。
//   · `invalid`       **门没跑通、未对内容下结论**：子进程无退出码 / 进程 70 / JSON `exit:70` /
//                     无可解析 JSON。消费方**不得**读成「缺数据」，**不得**据此计分或判通过。
//   · `not_applicable` **调用方**显式声明本项不适用（体例 / 时序 / 模式）——不进分母。
//   · `unavailable`   基础设施不可用（spawn EPERM / 命令不存在 / 被信号或超时终止）。
//
// ── 边界（如实）────────────────────────────────────────────────────────────────────────────
//   · 本模块**只判运行状态**，不判内容对错：P0/P1/P2 是门自己的结论，仍在 `json` 里。
//   · 「JSON 结构是否符合消费方期望」（如缺 `checks`）**不在此判**——那是各消费方的口径；
//     本模块只保证「门跑通了、有可解析 JSON」。
//   · `invalid` 与 `unavailable` 的**处置相同**（都不得计分、都要修复后重跑），分开只为**报错可读**：
//     前者是门内部缺陷，后者是环境/调用问题，补救动作不同。
//
// 用法：
//   import { classifyGateRun, explainGateRun } from './gate-result.mjs'
//   const cls = classifyGateRun({ status: r.status, error: r.error, json: r.json })
//   if (cls.kind !== 'ok') { /* 记 invalid，不要记 N/A */ }
export const GATE_RUN_KINDS = Object.freeze(['ok', 'invalid', 'not_applicable', 'unavailable'])

/** 门自报内部错误时使用的退出码（真源 = `SKILL.md` §执行能力边界 / M 门 exit 语义）。 */
export const GATE_INTERNAL_ERROR_EXIT = 70

/**
 * 判定一次门运行的**状态**（四态之一）。
 * @param {{status?: number|null, error?: string|null, json?: any, applicable?: boolean, exitKey?: string}} run
 *   `status` = 子进程退出码（`null` = 未产出）；`error` = spawn 层错误码；`json` = 门写下的报告对象；
 *   `applicable` = 调用方声明是否适用；`exitKey` = 报告里承载「门自身判决」的字段名（默认 `exit`）。
 * @returns {{kind: string, reason: string, status: number|null, jsonExit: number|null}}
 */
export function classifyGateRun({ status, error, json, applicable = true, exitKey = 'exit' } = {}) {
  const st = status === undefined ? null : status
  if (applicable === false) {
    return { kind: 'not_applicable', reason: '调用方声明本项不适用（体例/时序/模式）', status: st, jsonExit: null }
  }
  if (error) {
    return { kind: 'unavailable', reason: `子进程不可用（${error}）——基础设施问题，未对内容下结论`, status: st, jsonExit: null }
  }
  if (st === null) {
    return { kind: 'unavailable', reason: '子进程未产出退出码（未启动 / 被信号或超时终止）', status: null, jsonExit: null }
  }
  const rawExit = json && json[exitKey] !== undefined ? Number(json[exitKey]) : null
  const jExit = rawExit !== null && Number.isFinite(rawExit) ? rawExit : null
  if (st === GATE_INTERNAL_ERROR_EXIT) {
    return { kind: 'invalid', reason: `门自报内部错误（进程 exit ${GATE_INTERNAL_ERROR_EXIT}${jExit !== null ? `，JSON ${exitKey}=${jExit}` : ''}）`, status: st, jsonExit: jExit }
  }
  if (jExit === GATE_INTERNAL_ERROR_EXIT) {
    return { kind: 'invalid', reason: `门自报内部错误（JSON ${exitKey}=${GATE_INTERNAL_ERROR_EXIT}，而进程 exit ${st}）`, status: st, jsonExit: jExit }
  }
  if (!json) {
    return { kind: 'invalid', reason: `门未产出可解析 JSON（进程 exit ${st}）`, status: st, jsonExit: jExit }
  }
  return { kind: 'ok', reason: `门跑通（进程 exit ${st}${jExit !== null ? `，JSON ${exitKey}=${jExit}` : ''}）`, status: st, jsonExit: jExit }
}

/** 是否为「可判定」状态（唯一可计分/可判通过的状态）。 */
export const isUsableGateRun = (cls) => !!cls && cls.kind === 'ok'

/** 一行人类可读说明（供 detail / naReason 拼接；**只含状态与原因，不含门的内容结论**）。 */
export function explainGateRun(cls) {
  if (!cls || !cls.kind) return '门运行状态未知（未调用 classifyGateRun？）'
  return `运行状态=${cls.kind}：${cls.reason}`
}
