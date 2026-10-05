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
// 契约真源版本（v18.76.0 · v18.75.1 全量架构审计 R3 修复）：**从散文注释提升为可执行常量**。
//   旧版这里写死「宿主 `@deepseek-ai/dsh` **0.2.0-rc.2**，核对日期 2026-10-01；0.1.7-rc.2 同形」——
//   三个数字互相打架且**无人校验**：本文件注 `0.2.0-rc.2` / `ci.yml` 的 loader-smoke pin `0.1.7-rc.2`
//   / lockfile 实装 `0.1.2-rc.1`。现改为：本常量 = **探针实际核对的产物版本**，由
//   `scripts/host-contract-probe.mjs` 断言「本地已装 `@deepseek-ai/dsh-tools` 的 version 必须 == 它」。
//   三条版本轴的分工（**不再假装它们是同一个数**）：
//     · 本常量 / 探针目标 = lockfile 实装的宿主（本包 dev + CI 的 `pnpm install --frozen-lockfile` 产物）；
//     · `ci.yml` 的 `loader-smoke` pin = 全局 npm 装一个**更新的**宿主，只验「宿主能加载本插件」；
//     · 契约表条目本身只在**探针目标**上被核对，跨 rc 线的 arity/payload 变化由探针红来暴露。
export const CONTRACT_HOST_VERSION = '0.1.2-rc.1'

// 更新契约表的口径：宿主升版后**重新核对上面三个派发点**（真源出处已写在 host 字段），实参个数变了就
//   同步改本表；**不要凭记忆改**（这正是本门要守的「凭记忆推断」病）。
// 每条另带 `since`（v18.76.0 R3 修复）：该事件**在本包验证过的最低宿主版本**上实测存在。缺 `since`
//   即门红（`tests/host-contract.test.mjs`）——它防的是「落在 peer 区间下限的用户遇到事件根本没有派发方
//   而静默死监听」这一类：没有 `since` 就无法判断「这个事件在用户的宿主版本上是否存在」。
export const HOST_CONTRACT = Object.freeze({
  'tools/post-execute': {
    arity: 3,
    params: ['exec', 'result', 'next'],
    host: 'dsh-tools postExecute',
    since: '0.1.2-rc.1',
  },
  'system-prompt/assemble': {
    arity: 3,
    params: ['assembly', 'context', 'next'],
    host: 'dsh-system-prompt assemble',
    since: '0.1.2-rc.1',
  },
  'agent/request': {
    arity: 2,
    params: ['payload', 'next'],
    host: 'dsh-agent-loop agent/request',
    since: '0.1.2-rc.1',
    // payload 键集合（v18.76.0 R3 修复新增）：本包**不再注册**该事件监听器（H7 已按 R2 移除），
    //   但契约记录保留——它是「为什么不能读 request.toolName」的机械证据，也是将来若恢复热路由时的前置事实。
    payloadKeys: ['turn', 'step', 'signal'],
  },
})

/**
 * `materializeFinalResult()` 的**字段白名单**（v18.76.0 · R3 修复新增）——单一真源。
 *
 * 为什么必须机械化：本包 H2 监听器曾把 `reviewFlags` / `ethicsSanitized` 写在 `result` 上，而真宿主在
 *   结果落地前会按这个白名单**投影一次**，非契约字段被结构性丢弃（D2）；同时对象是 `deepFreeze` 过的
 *   （D1，赋值抛 TypeError）。两条机制各自独立成立 → 监听器整体静默失效（P0）。
 *   `scripts/host-contract-probe.mjs` 断言宿主产物里 `materializeFinalResult` 引用的 `result.*` 字段集合
 *   **恰好等于**本表——宿主增删字段即红，且指名变化点。
 */
export const MATERIALIZE_WHITELIST = Object.freeze([
  'additionalContexts', 'concludesTurn', 'content', 'error', 'isError', 'meta', 'value',
])

/**
 * 本包关心的三处**宿主派发点**的规范化期望形态（v18.76.0 · R3 修复新增）——探针按此断言宿主产物。
 * 判据 = 空白归一后子串必须出现；`{ turn, step, signal }` 这一项同时钉住 `agent/request` 的 payload 键集合。
 */
export const HOST_DISPATCH = Object.freeze({
  'tools/post-execute': '"tools/post-execute", exec, result, () =>',
  'system-prompt/assemble': '"system-prompt/assemble", assembly, context, () =>',
  'agent/request': '"agent/request", { turn, step, signal }, () =>',
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

/**
 * **宿主核心包白名单**（v18.62.4 · 全量审计-v18.62.3 §8.3 #35）——本模块是该事实的**唯一真源**。
 *
 * 为什么上提到这里：`pack-smoke.mjs` 与 `plugin-surface-check.mjs` **各写了一份同名常量**
 * （`HOST_CORE_ALLOW`），而**内容不同**：前者 3 个、后者 1 个。两处的心智模型是同一句话——
 * 「宿主标准组合树自带、无法也不该由本包声明版本的核心包」——**同一事实两处维护即必然漂移**
 * （本仓反复立规的那类缺陷）。**注意**：实测两处当前**都不漏**（`@deepseek-ai/dsh-tool-subagent`
 * 已在 `peerDependencies` 里声明、`@deepseek-ai/dsh` 也在），所以这是**潜在**漂移而非现行漏检——
 * 如实记录，不夸大成「正在漏」。
 *
 * 判据：**允许集收窄 = 更严的门**。本表只保留**实测确认**为宿主核心的两个；
 * 其余包一律要求**显式声明**（`dependencies` / `peerDependencies`）——
 * 那样宿主改名/移除时 `npm install` 与 `manifest-peers` 会一起发现，而不是靠一张手维护的表放行。
 */
export const HOST_CORE_ALLOW = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh'])
