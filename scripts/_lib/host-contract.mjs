// 宿主契约（host-contract）——静态解析 `lib/index.js` 的 `ctx.on(...)` 注册，断言
//   「事件名存在于宿主」+「监听器形参个数 == 宿主 waterfall 派发实参个数」。
//
// 为什么需要（v18.62.1 全量审计 P0-1 / P1-1 / P1-2 / P2-2）：
//   `lib/index.js` 注册进宿主的监听器，签名必须与宿主 waterfall 派发实参**逐位对齐**，否则：
//     · 形参写多 → 入参错位 → `next` 变成 undefined → 每次工具调用抛 `next is not a function`、
//       结果被宿主 `finalizeScheduledExecution` 的 try/catch 静默改写成 isError（P0-1，实测）。
//     · 形参写少且不调 next() → 截断下游 waterfall，把更后注册的监听器（含 dsh-agent 的模型选择）
//       静默顶掉（P1-2，实测）。
//   cordis 的 `ctx.on` 只挂 hooks 数组、**不校验事件是否存在**——「注册成功」≠「会触发」（P1-1 的两个
//   死监听器 `assistant/chunk` / `file-watcher:change` 正是这样）。此前没有任何门校验这两条，故 P0-1
//   从机制上不可能被现有门发现（600 个用例全绿，因为自建桩测试「照着实现写」、与实现共错）。
//
// 契约真源（宿主 `@deepseek-ai/dsh` **0.2.0-rc.2**，核对日期 2026-10-01；0.1.7-rc.2 同形）：
//   · `tools/post-execute` → 3 参 `(exec, result, next)`
//       派发：`dsh-tools/lib/index.js` `postExecute` →
//         `this.ctx.waterfall(..., "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" }))`
//       官方同事件监听器（dsh-spill-policy / dsh-repeat-tool-reminder / dsh-tool-fs-search / dsh-hooks-*）
//        全部写 `(exec, result, next)`。
//   · `system-prompt/assemble` → 3 参 `(assembly, context, next)`
//       派发：`dsh-system-prompt/lib/index.js` `assemble` →
//         `this.ctx.waterfall(..., "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly))`
//   · `agent/request` → 2 参 `(payload, next)`（payload = `{ turn, step, signal }`）
//       派发：`dsh-agent-loop/lib/index.js` →
//         `this.dispatch.waterfall("agent/request", { turn, step, signal }, () => Promise.resolve(seedConfig))`
//
// 更新契约表的口径：宿主升版后**重新核对上面三个派发点**（真源出处已写在 host 字段），实参个数变了就
//   同步改本表；**不要凭记忆改**（这正是本门要守的「凭记忆推断」病）。
export const HOST_CONTRACT = Object.freeze({
  'tools/post-execute': {
    arity: 3,
    params: ['exec', 'result', 'next'],
    host: 'dsh-tools postExecute',
  },
  'system-prompt/assemble': {
    arity: 3,
    params: ['assembly', 'context', 'next'],
    host: 'dsh-system-prompt assemble',
  },
  'agent/request': {
    arity: 2,
    params: ['payload', 'next'],
    host: 'dsh-agent-loop agent/request',
  },
})

// 匹配真实注册：`ctx.on('event', [async] (a, b, ...) => {`
//   · 只匹配箭头函数监听器（本仓唯一形态）；`function(...)` 或变量引用会被退化防线抓出（fail-closed）。
const CTX_ON_RE = /ctx\.on\(\s*['"]([^'"]+)['"]\s*,\s*(?:async\s+)?\(\s*([^)]*)\)\s*=>/g

/**
 * 解析源码里的 `ctx.on(...)` 注册，返回每条的事件名 + 形参个数 + 形参名。
 * @param {string} source - lib/index.js 全文。
 * @returns {{ regs: Array<{event:string, arity:number, params:string[]}>, totalCtxOn: number }}
 */
export function parseCtxOnRegistrations(source) {
  const regs = []
  const re = new RegExp(CTX_ON_RE.source, 'g')
  let m
  while ((m = re.exec(source))) {
    const params = m[2].split(',').map((s) => s.trim()).filter(Boolean)
    regs.push({ event: m[1], arity: params.length, params })
  }
  // `ctx.on(` 总数（含未解析成箭头函数的写法）——退化防线用。
  const totalCtxOn = (source.match(/ctx\.on\(/g) || []).length
  return { regs, totalCtxOn }
}

/**
 * 对账：每条注册的事件名必须在契约表里、形参个数必须 == 宿主实参个数。
 * @param {string} source - lib/index.js 全文。
 * @returns {{ regs: Array, errors: string[] }}
 */
export function reconcileHostContract(source) {
  const { regs, totalCtxOn } = parseCtxOnRegistrations(source)
  const errors = []

  // 退化防线 1：一个监听器都没解析出来 → 注册入口消失或解析器完全退化，门会空跑。
  if (regs.length === 0) {
    errors.push('未解析出任何 ctx.on 监听器——注册入口消失或解析器退化（fail-closed）')
  }
  // 退化防线 2：`ctx.on(` 出现数 ≠ 解析出的箭头函数注册数 → 有非箭头函数/未覆盖写法，门会漏判。
  if (regs.length !== totalCtxOn) {
    errors.push(
      `解析退化：源码有 ${totalCtxOn} 处 \`ctx.on(\`，仅解析出 ${regs.length} 处箭头函数监听器签名——` +
        '存在非箭头函数或本解析器未覆盖的写法，门会漏判，请同步解析器（fail-closed）',
    )
  }

  for (const r of regs) {
    const c = HOST_CONTRACT[r.event]
    if (!c) {
      errors.push(
        `事件 "${r.event}" 不在宿主契约表（宿主无派发方，或契约表未登记）——` +
          'cordis 的 ctx.on 不校验事件存在，「注册成功」≠「会触发」；请删除该死监听器或先核对宿主确有派发方再补登契约表',
      )
      continue
    }
    if (r.arity !== c.arity) {
      errors.push(
        `监听器 "${r.event}" 形参 ${r.arity} 个 ≠ 宿主 ${c.arity} 参 (${c.params.join(', ')})（${c.host}）——` +
          '入参错位会抛 next is not a function（P0-1）或截断下游（P1-2）',
      )
    }
  }
  return { regs, errors }
}
