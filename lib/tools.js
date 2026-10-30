// 论衡原生工具（C 组 · v18.1.0）：把四个原生工具暴露给宿主——三个是随包机检脚本的薄包装
//   （`lunheng_m_gate` / `lunheng_char_count` / `lunheng_handoff_check`），第四个 `lunheng_ethics_sanitize`
//   是 `lib/ethics-sanitize.js` 的**纯函数**（不派生任何子进程，见该文件头注释与 SECURITY.md）。
//   写面边界：普通读取与校验只读；`lunheng_m_gate` 传 `report` 时写该门报告，
//   落点仅限会话工作区或系统临时目录（围栏见 `resolveWritableReportPath`）。
//   ⚠️ v18.78.1 全量审计 · 批 5 更正：本行原写「两个**只读**机检脚本」（v18.1.0 时只有两个）——此后新增了
//   `lunheng_handoff_check`（随包脚本）与 `lunheng_ethics_sanitize`（纯函数），数字未跟。
//   数字真源 = 本文件里经 `tools.register` 注册的 `defineTool` 调用点数（现为 4；机械门见
//   `tests/docs-facts.test.mjs` 的对外声明面派生与 `tests/entry.test.mjs` 的「应注册 … 四个工具」断言）。
//   ⚠️ 本注释刻意**不**复刻那个调用的完整字面形态：`docs-facts` 用正则在本文件源码里派生工具集，
//   注释里照着写会被派生成一个**幻影工具名**（本批实测踩到过一次，C-1 因此变红）。
//
// 为什么（第三方审计 C-1，官方依据）：
//   · `docs/cookbook/adding-a-tool.md:45`「**Declare and return one canonical JSON value** …
//     Do not … make callers parse prose for ids and fields」——现状是主控 `pwsh node scripts/x.mjs`
//     再由模型读 stdout 与 6 个退出码；工具化后**规范值由工具返回**，模型拿结构化字段。
//   · 顺带得到：参数校验（`INVALID_ARGS`）、`output.render` 人类可读文本、`exec.signal` 取消、
//     Code Mode 免费用（`await tools.lunheng_m_gate({...})` 直接拿规范值）。
//   · **诚实边界**（官方 `docs/subsystems/tools.md:370`）：canonical value **只在执行期有效**，
//     日志只持久化 `content`/`error`/`meta`——所以**工具化不会自动改善审计留痕**，闸门实据真源
//     仍是落盘的 `final/M-Gate-Report.json`（v18.0.5 已把它与正文指纹绑定）。
//
// 为什么用**动态 import + ctx.get() 可选依赖**（而不是静态 import + inject）：
//   · 官方 `guide/plugin-dev-guide.md:139`：「可选依赖：不写 inject，用 `ctx.get('metrics')?.method()`」；
//   · 本包的**核心职责是注册技能**（`skills` 服务）。若为了工具而静态 import 宿主包、或把 `tools`
//     写进 `inject`，一旦某个 profile 缺该服务/包，**整个入口 import 失败 → 技能也不注册**——
//     那正是 v18.0.0 缺陷的形态（教训 #154）。故：技能注册保持硬依赖，工具/命令走「有则装、无则退」。
import { spawn } from 'node:child_process'
import { isAbsolute, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'   // v19.6.1（审计 F-1）：写参数围栏要判「是否在系统临时目录内」；v19.19.1：sessionLog 只读根要回退 ~/.dsh
import { isPathInsideRunDir } from './run-path-fence.mjs'   // 三层路径围栏真源（不另写一套判定）

/**
 * **工具面旗标缺口登记**（工具化时**未**转成 `parameters` 的脚本旗标）。
 *
 * 为什么必须显式登记：`SKILL.md` 的工具表写「清单里有就优先用（省 `pwsh` + stdout 解析）」，
 *   容易被读成「两条路径等价」；而实测**参数面覆盖不到脚本的全部旗标**——不声明，
 *   调用方就会以为「用工具就够了」，从而**静默少做一步**（最贵的一例：M 门报告不落盘，
 *   而它是闸门记录指纹互锁与 M-Exist-5/9 的共同输入）。
 *
 * 判据（机械）：`tests/batch21-seam-gates-v18-80-1.test.mjs` 双向对账——
 *   ① 文档要求的旗标必须**要么已接线**（源码里出现 `args.<旗标>`）、**要么**在本表登记；
 *   ② 本表的每一条都必须**确实未接线**（陈旧登记同样判红）。
 * 边界（如实）：本表只登记**已评估**的缺口，不表示这些旗标不可达——直调脚本始终可用。
 */
export const TOOL_FACE_FLAG_GAPS = Object.freeze({
  // v19.6.0（架构与机制反哺批 §3.5）：`report` / `handoff_check` 的两项**已接线**，故从本表移除。
  //   保留 `adjudicate` 是**刻意的**（见报告 §3.5 B-4）：裁定 JSON 由主控亲写（「T8 不 spawn」的既有
  //   权衡），工具面代写反而削弱留痕语义；`figDir` / `genre` 属按需档，本批不动。
  // v19.16.0（反哺 F-01/F-02）：`liteProfile` / `genre` / `figDir` **已接线**，故从本表移除。
  //   保留 `adjudicate` 仍是刻意的（v19.6.0 §3.5 B-4 的理由不变）：裁定 JSON 由主控亲写，
  //   工具面代写会削弱「T8 不 spawn」的留痕语义。
  // v19.19.0（反哺 2026-10-19 · 主人「依次全部修订」）：**登记面重做**。
  //   病灶：本表三处 `[]` 声明「零缺口」，而脚本 `--help` 里仍有未接线的旗标——
  //   `handoff-check` 的 `--session-log`（Phase 5 唯一独立核对层）、`count-chars` 的 `--genre`；
  //   而 `tests/batch21` 的「文档要求旗标」是一张**手抄清单**（三条），扫不到新旗标。
  //   现改为：**旗标真源 = 脚本 `--help`**（测试从 `--help` 派生后逐条判「已接线 ∪ 已登记」）。
  //   本表保留的每一条都是「刻意不接」，理由写在下方；其余全部已接线。
  //   判据：新增旗标若未接线、也未登记 → `tests/batch21-seam-gates-v18-80-1.test.mjs` 直接红。
  lunheng_m_gate: Object.freeze([
    'adjudicate',        // 刻意：裁定 JSON 由 T8 亲写（「T8 不 spawn」留痕语义），工具代写会削弱它
    'verifyReport',      // 维护期只读体检（判历史报告可解析性），不属运行期路径；直调脚本即可
    'dumpThresholds',    // 阈值总表生成器（文档派生面），非门判定面
  ]),
  lunheng_handoff_check: Object.freeze([
    'blindReview',       // 盲评件契约模式（不要求 --project/--role），运行期由 T9/T8 直调脚本
  ]),
  lunheng_char_count: Object.freeze([
    'report',            // 工具面按参数返回结果，无需落盘；需要留证时直调脚本
    'warnThreshold',     // 告警阈值属调用点策略，工具面不设
    'wordMetric',        // Word 口径字数列未纳入工具 schema，接线会重演「脚本有字段、工具丢弃」
  ]),
  lunheng_ethics_sanitize: Object.freeze([]),
})

/**
 * v18.80.4（全量审计-v18.80.3 P1-2）：按**会话工作区**解析工具入参里的相对路径。
 * 病根：宿主进程 cwd ≠ 会话工作区（DSH Desktop / `dsh web` 常态）时，旧实现把相对路径原样传给
 *   子进程 / readFileSync——它们按**宿主 cwd** 解析 → 「文件不存在」，或（宿主 cwd 恰有同名文件时）
 *   **对错文件给出门结果**。与 fs 工具同源的官方基准 = `exec.agent.session.header.cwd`
 *   （`dsh-tool-fs/lib/index.js:225-242`；`lib/guard.js` 的 v18.2.6 修复同判据）。
 * 取不到会话 cwd（旧宿主 / 最小 ctx）→ 原样返回（不劣于旧行为）。
 */
export function resolveSessionPath(exec, p) {
  if (typeof p !== 'string' || !p || isAbsolute(p)) return p
  const base = exec?.agent?.session?.header?.cwd
  return typeof base === 'string' && base.trim() ? resolve(base.trim(), p) : p
}

/**
 * v19.6.1（全量审计-2026-10-15 **P2-7** 修复）：**读参数围栏**（与 `resolveWritableReportPath` 同族）。
 *
 * 病灶：原生工具的参数在**宿主进程内**读盘（`readFileSync`），**不经宿主的 agent fs 策略**——
 *   `lunheng_ethics_sanitize` 尤其明显：`mode:'none'` 会**逐字节返回原文**，故它是一个
 *   「任意文件全文读」原语；`char_count` / `handoff_check` / `m_gate` 的路径参数同类（面较窄）。
 *   本仓对**同族问题**的既有处置是 `lib/commands.js` 的叶文件拒止（`isPathInsideRunDir`）——
 *   本条把同一条口径推广到工具面（审计 §优化方向 2：**新入口一律复用共享围栏**）。
 *
 * 允许范围：**会话工作区 ∪ `os.tmpdir()`**（与写侧同口径；测试夹具与临时产物都在 `tmpdir`）。
 *   界外 → `INVALID_ARGS`，提示把材料**拷进工作区**——这正是既有「材料摄取」流程
 *   （`run/<项目>/materials/` + `主人投喂清单.md`）的规定动作，不是新要求。
 *
 * 边界（如实）：① 判据与写侧同源（`lib/run-path-fence.mjs`），仍**不防 TOCTOU 竞态**
 *   （check 与 read 之间路径被换成链接）；② 该围栏只约束**本工具的路径参数**，主控用 `read`/`pwsh`
 *   读界外文件不受它影响（本包从不声称工具面能约束 `pwsh`）。
 * @returns {string} 允许的绝对路径（未给则原样返回，交由各工具自己的非空校验）
 * @throws {Error} 越界时抛（message 以 `INVALID_ARGS` 开头）
 * @param opts.extraRoots - v19.19.1（架构审计 R1）：**显式登记**的额外只读根（目前唯一调用点 =
 *   `lunheng_handoff_check` 的 `sessionLog` / `sessionRoot`）。**默认不放宽**——只有登记点才会传入，
 *   避免把「工作区/tmp 之外一律拒绝」这条既有口径悄悄变成「任意目录可读」。
 */
export function resolveReadablePath(exec, p, label = '路径', opts = {}) {
  if (typeof p !== 'string' || !p.trim()) return p
  const abs = isAbsolute(p) ? p : resolveSessionPath(exec, p)
  const base = exec?.agent?.session?.header?.cwd
  const root = typeof base === 'string' && base.trim() ? base.trim() : process.cwd()
  const extraRoots = (Array.isArray(opts.extraRoots) ? opts.extraRoots : [])
    .filter((r) => typeof r === 'string' && r.trim())
    .map((r) => r.trim())
  if (isPathInsideRunDir(root, abs) || isPathInsideRunDir(tmpdir(), abs)
    || extraRoots.some((r) => isPathInsideRunDir(r, abs))) return abs
  throw new Error(
    `INVALID_ARGS：${label} 只能指向会话工作区、系统临时目录`
    + (extraRoots.length ? `或已登记的只读根（${extraRoots.join(' / ')}）` : '')
    + `之内，收到 ${abs}。`
    + '（判据 = lib/run-path-fence.mjs 的三层围栏；v19.6.1 起生效，见全量审计-2026-10-15 §P2-7——'
    + '原生工具在宿主进程内读盘，不经宿主对 agent 的 fs 策略，故必须自带围栏。'
    + `需要读界外材料时，请先按「材料摄取」流程拷进 run/<项目>/materials/ 再调用本工具）`,
  )
}

/**
 * v19.19.1（架构审计 R1 · 反哺报告 §2.1）：`--session-log` / `--session-root` 的**唯一**只读根。
 *
 * 病灶（已实测）：`handoff-check` 传会话 **id** 时必须配 `--session-root`（脚本刻意不做
 *   `DSH_HOME` 兜底，见该脚本 `:202-204` 的理由），而工具面把 `sessionRoot` 交给
 *   `resolveReadablePath`（只放行工作区 ∪ tmpdir）→ `$DSH_HOME/sessions` **必被拒**；
 *   于是 Phase 5 的「唯一独立核对层」只能退回 `pwsh` 直调——而 `pwsh` 恰是本包已声明的
 *   机制写保护绕过口。修法 = 给这两个参数**单独**开一条**只读**根，不复用工作区围栏。
 *
 * 边界（如实）：只认 `DSH_HOME`（缺省 `~/.dsh`）下的 `sessions`；设了自定义 DSH_HOME 时以它为准。
 *   **不**把「任意名为 sessions 的目录」都放行（那等于取消围栏）。
 * @returns {string[]} 允许的会话日志只读根（绝对路径）
 */
export function sessionLogRoots() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim()
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return [join(home, 'sessions')]
}

/**
 * v19.6.1（全量审计-2026-10-15 **F-1** 修复 · 工具侧第二道）：**写参数围栏**。
 *
 * 病灶（已端到端实测）：`lunheng_m_gate` 的 `report` 经 `resolveSessionPath` 只做**基准解析**、
 *   不做**包含判定** → `report: '<任意路径>'` 会把门报告写到任何地方（含受保护根内）。
 *   guard 侧已加参数级写面（`lib/guard.js` 的 `WRITE_PARAMS`），本处是**第二道**——两道并存是刻意的：
 *   guard 管「受保护根」，本函数管「可写范围」，任一道单独失效时另一道仍在。
 *
 * 允许范围（**与 SECURITY.md 的既定设计一致**，不新增限制）：
 *   ① 会话工作区之内（项目产物都在这里）；
 *   ② `os.tmpdir()` 之内——`quality-score` 的既有合法用法就是把各门的 `--report` 写进临时目录
 *      （主人 2026-09-29 裁定「报告允许写到项目外的**临时**路径」，本函数把「临时」落成可判定的集合）。
 *   其余一律拒绝（抛错 = 工具的 `INVALID_ARGS` 语义，宿主会把它呈现成参数错误而不是内部故障）。
 *
 * 边界（如实）：判定复用 `lib/run-path-fence.mjs` 的 `isPathInsideRunDir`（词法 → 结构 → 物理 realpath
 *   三层），**不另写一套**——审计 §优化方向 2 点名的正是本包曾有「四套路径收口」。
 *   该函数名里的 `runDir` 是历史命名：它判的是「cand 是否在容器内」，容器不限于 `run/`。
 *   `report` 未给 → 返回 null（调用方无需判空）。
 * @returns {string|null} 允许的绝对路径；未给返回 null
 * @throws {Error} 越界时抛（message 以 `INVALID_ARGS` 开头，与宿主参数校验语义对齐）
 */
export function resolveWritableReportPath(exec, p) {
  if (typeof p !== 'string' || !p.trim()) return null
  const abs = isAbsolute(p) ? p : resolveSessionPath(exec, p)
  const base = exec?.agent?.session?.header?.cwd
  const root = typeof base === 'string' && base.trim() ? base.trim() : process.cwd()
  const inWorkspace = isPathInsideRunDir(root, abs)
  const inTmp = isPathInsideRunDir(tmpdir(), abs)
  if (!inWorkspace && !inTmp) {
    throw new Error(
      `INVALID_ARGS：report 只能写到会话工作区或系统临时目录之内，收到 ${abs}。`
      + '（判据 = lib/run-path-fence.mjs 的三层围栏：词法 → 结构 → realpath 物理层；'
      + '本限制自 v19.6.1 起生效，见全量审计-2026-10-15 §F-1——旧版此处只做基准解析、不做包含判定）',
    )
  }
  return abs
}

/** 跑一个随包脚本并收集输出（尊重 `exec.signal`；v18.2.6 加**超时**与**输出上限**）。
 *
 * 为什么必须加（审计 P2-12）：旧实现既无超时也无输出上限——脚本挂起会一直占住这次工具调用
 * （只靠 `exec.signal` 兜底），而 `out += String(d)` 对「M 门默认打印全量 results」这类输出无界缓冲。
 * 超时/截断都**如实回传**（不静默），由 execute 决定怎么呈现。
 */
function runScript(scriptPath, args, signal, { timeoutMs, maxBytes, cwd } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      // P1-2（同批）：显式 cwd = 会话工作区——脚本内部的相对路径推导（如 quality-score 族的 REPO 探测）
      //   不再跟随宿主进程启动目录漂移；未给 cwd 时保持旧行为。
      child = spawn(process.execPath, [scriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'], ...(cwd ? { cwd } : {}) })
    } catch (e) {
      // v18.2.6：`spawn` 在受限部署下会**同步抛**（实测本机 DSH `workspace-write` 下 EPERM：
      //   沙箱禁止被围栏进程开命名管道）。旧实现让这个 throw 直接穿出 Promise executor →
      //   Promise 以原始 `Error: spawn EPERM` 拒绝，模型读到的是无从下手的报错。
      //   现改为**带原因码地返回**，由 execute 给出可操作的提示（本包 §九 已记录过「sandbox 报错
      //   易被误读为命令失败、导致反复重试耗尽步数」的教训）。
      resolve({ code: null, out: '', err: String(e?.message || e), spawnError: e?.code || 'SPAWN_FAILED', timedOut: false, truncated: false })
      return
    }
    let out = '', err = '', truncated = false, timedOut = false
    const cap = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : Infinity
    // v19.27.13（反哺 2026-10-26 F-12①）：上限改按**字节**计（配置名 `scriptMaxOutputBytes` 的语义）。
    //   旧实现按 JS 字符数（`cur.length`）累计——中文 1 字符 = 3 字节，实际缓冲可达配置值 ~3×，
    //   调用方按「4 MB 上限」推理内存占用会失真。字符串拼接保留（utf8 setEncoding 的跨分片解码
    //   正确性不动），另维护逐流字节记账；截断点用 Buffer.byteLength 保证不多不少 cap 字节。
    const byteAcc = { out: 0, err: 0 }
    const append = (cur, d, key) => {
      const s = String(d)
      const next = byteAcc[key] + Buffer.byteLength(s, 'utf8')
      if (next <= cap) { byteAcc[key] = next; return cur + s }
      truncated = true
      // 按完整 Unicode code point 累计 UTF-8 字节；cut 仍用原字符串下标，但绝不落在代理对中间。
      const whole = cur + s
      let acc = 0, cut = 0
      for (const ch of whole) {
        const bytes = Buffer.byteLength(ch, 'utf8')
        if (acc + bytes > cap - 3) break
        acc += bytes
        cut += ch.length
      }
      // 已进入截断态：后续分片不得因省略号未计满 cap 而被追加到省略号之后。
      byteAcc[key] = cap
      return whole.slice(0, cut) + '…'
    }
    const onAbort = () => {
      try { child.kill() } catch { /* 已退出 */ }
      // v18.69.0（批 6-A · P2 修复）：SIGTERM 后短延迟仍未退出 → SIGKILL 兜底。旧版单发 SIGTERM，
      //   进程树中的孤孙子进程（脚本又 spawn 了别的进程）可能不响应 TERM 而残留。unref 防本定时器拖住宿主进程。
      const esc = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 已退出 */ } }, 5000)
      if (typeof esc.unref === 'function') esc.unref()
    }
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => { timedOut = true; onAbort() }, timeoutMs)
      : null
    const done = () => { if (timer) clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort) }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    // P2-1（v18.62.5 全量审计-性能与安全）：`stdout`/`stderr` 默认是 Buffer 流的二进制形态，
    //   原写法 `append` 内部对每个分片独立做 UTF-8 解码，跨分片边界的多字节字符（汉字最常见）
    //   会被解成 `U+FFFD`（实测 7.2 万字符中文输出含 5 个 U+FFFD）。改为 `setEncoding('utf8')`：
    //   内部用 `StringDecoder` 自动缓存不完整的多字节序列，跨分片拼接不会丢字。
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => { out = append(out, d, 'out') })
    child.stderr.on('data', (d) => { err = append(err, d, 'err') })
    child.on('error', (e) => { done(); resolve({ code: null, out, err: err + String(e.message), spawnError: e?.code || 'SPAWN_FAILED', timedOut, truncated }) })
    child.on('close', (code) => { done(); resolve({ code, out, err, timedOut, truncated }) })
  })
}

/** 把「拿不到脚本输出」的三种原因写成**可操作**的提示（v18.2.6；本包 §九 的教训：sandbox 报错最易被误读）。 */
function describeScriptFailure(tool, scriptName, r, scriptTimeoutMs, scriptMaxOutputBytes) {
  if (r.spawnError === 'EPERM' || r.spawnError === 'EACCES') {
    return (
      `${tool} 无法执行随包脚本：宿主禁止本进程派生子进程（${r.spawnError}，常见于受限文件策略下` +
      '「被围栏进程不能开命名管道」）。**请改用 `pwsh` 直接调用同一脚本**' +
      `（\`node <技能目录>/scripts/${scriptName}.mjs …\`），` +
      '两条路径的**退出码与 JSON 契约完全一致**；若 `pwsh` 也不可用，属 DSH 宿主侧限制，' +
      '请如实记为「本机无法执行机检」，**不得**用 LLM 断言替代闸门实据。'
    )
  }
  if (r.timedOut) return `${tool} 脚本超时（>${scriptTimeoutMs}ms）已中止`
  if (r.truncated) return `${tool} 脚本输出超过采集上限（${scriptMaxOutputBytes} B）已被截断`
  return `${tool} 未返回 JSON`
}

/** 从脚本输出里取 JSON（脚本输出**只有** JSON，但仍容错：从第一个 `{` 起解析）。 */
function parseJson(text) {
  const i = String(text || '').indexOf('{')
  if (i < 0) return null
  try { return JSON.parse(String(text).slice(i)) } catch { return null }
}

const clip = (s, n = 500) => String(s ?? '').slice(0, n)

/**
 * 注册论衡原生工具（只读）。返回 disposer 数组；宿主无 `tools` 服务时返回空数组（技能照常注册）。
 * @param ctx - 插件 ctx（profile 级）。
 * @param opts.skillRoot - 随包技能目录（脚本相对它解析）。
 * @param opts.defineToolFactory - 可选：自定义 `defineTool` 来源（默认 `() => import('@deepseek-ai/dsh-tools')`）。
 *   存在的意义：① 测试环境（裸仓库 / CI）没有宿主包，可注入契约等价的替身，从而**照常覆盖工具行为**；
 *   ② 宿主换包名时只改这一处。
 * @param opts.report - 可选：状态输出回调 `(level, message) => void`（默认 `console.error`）。
 *   v18.2.4（审计 C.3）：宿主有 Cordis `logger` 时入口会传入按 logger 分流的 reporter，
 *   避免每次启动无条件刷 stderr。
 * @param opts.scriptTimeoutMs - 可选：单次脚本执行的超时（v18.2.6；来自 `Config.scriptTimeoutMs`）。
 * @param opts.scriptMaxOutputBytes - 可选：stdout/stderr 采集上限（v18.2.6；来自 `Config.scriptMaxOutputBytes`）。
 */
export async function installLunhengTools(ctx, { skillRoot, defineToolFactory, report, scriptTimeoutMs, scriptMaxOutputBytes, handoffLevel } = {}) {
  const say = typeof report === 'function' ? report : (level, message) => console.error(message)
  const tools = ctx.get('tools')
  if (!tools?.register) return []
  let defineTool
  try {
    const factory = defineToolFactory || (() => import('@deepseek-ai/dsh-tools'))
    ;({ defineTool } = await factory())
    if (typeof defineTool !== 'function') throw new Error('defineTool 不是函数')
  } catch (e) {
    say('warn', `· 论衡原生工具未启用（无法取得 defineTool：${String(e?.code || e?.message).slice(0, 80)}）——技能与流水线不受影响，仍可用 pwsh 调脚本`)
    return []
  }
  const disposers = []

  // ── 工具 1：M 门机械预检（机检 25 项；默认只读，给 report 时写门报告）────────────
  // H1（v18.60.1 反哺 v3）：executionMode:'parallel' 让 driver 用有界滚动池调度（与 handoff_check / char_count 并发安全）。
  // 主人显式授权落地，详见 `audits/反哺报告-v18.60.1-DSH新能力接缝.md` §四 H1 + `audits/机制文件修订记录-2026-09-30-反哺v3全批.md`。
  disposers.push(tools.register(defineTool({
    name: 'lunheng_m_gate',
    executionMode: 'parallel',
    description:
      '运行论衡 M 门机械预检（M-Form 11 + M-Exist 12 + M-Integrity-1 + M-Fact-1 佐证 = 25 项脚本判定；26 项含主控人工门 M-Integrity-2）。' +
      // v19.6.1（全量审计-2026-10-15 F-1）：旧文案逐字写「**只读**：不修改任何文件」——而 `report`
      //   自 v19.6.0 起已接线（会写那一份门报告），该声明与实现相反（审计把它列为「5 处文档自相矛盾」之一）。
      '**不修改被审正文与证据包**；给了 `report` 时会写那一份门报告（**只允许落在会话工作区或系统临时目录内**，越界报参数错）。返回规范 JSON（exit / 通过数 / P0·P1·P2 / 硬失败明细），人类可读文本另走渲染。' +
      'exit 语义：0 通过 / 1 有 P1 / 2 有 P0 / 3 仅 P2·soft·SKIP（需人工复核，不得当通过）/ 10 参数或路径错 / 70 内部错误。' +
      // v19.6.0（架构与机制反哺批 §3.5 · 主人授权「依次全部修订」）：`--report` **已接线**。
      //   此前缺口声明里点名「最贵的一例：`M-Gate-Report.json` 是闸门记录指纹互锁与 M-Exist-5/9 的
      //   共同输入，而经本工具调用不会落盘」——现按 handoff 工具同款接线（`resolveSessionPath` + 同 cwd）。
      // v19.19.0（反哺 2026-10-19 U-06）：工具面的「只暴露一部分」已按脚本 `--help` 对账重建——
      //   未接线的只剩 `TOOL_FACE_FLAG_GAPS` 里登记的三项（adjudicate / verifyReport / dumpThresholds），
      //   且每项都写了「为什么刻意不接」。`advisories` / `unchecked` / `hardRedLineHits` 三个字段
      //   已进 `output.schema` 并在 render 首行呈现（此前被 `additionalProperties:false` 静默丢弃）。
      '⚠️ **未暴露的旗标仅见 `TOOL_FACE_FLAG_GAPS`**（`--adjudicate`=裁定须主控亲写；`--verify-report` / `--dump-thresholds`=维护期只读面，直调脚本即可）：'
      + '`liteProfile` / `genre` / `figDir` / `overwriteAdjudicated` 均已接线；**`--report` 自 v19.6.0 起可直接用**（落盘 `final/M-Gate-Report.json`），'
      + '自 v19.6.1 起该参数受两道围栏约束（`lib/guard.js` 的参数级写面 + 本工具的可写范围判定）。',
    parameters: {
      draft: { type: 'string', required: true, description: '被审正文路径（<项目>/final/定稿.md 或 <项目>/drafts/初稿-vN.md）' },
      evidence: { type: 'string', required: true, description: '证据包目录（<项目>/final/证据包）' },
      summary: { type: 'boolean', description: 'true = 只回聚合统计与硬失败项（省 token）；省略 = 全量 results' },
      report: { type: 'string', description: '可选：门报告落盘路径（默认 final/M-Gate-Report.json）——**闸门记录指纹互锁与 M-Exist-5/9 的共同输入**；省略则不落盘' },
      liteProfile: { type: 'boolean', description: 'true = 快轨档（映射 --lite-profile：只评估 M-Form-1/3/5/7 + M-Exist-2 五道）。**快写入口必须置 true**，否则会跑全量 25 门并把快轨稿判成缺报告（假红）' },
      genre: { type: 'string', description: '可选：文类 code（映射 --genre，如 academic-cn / biz-review / kaiti）——决定 M-Form-1 的**文献下限**（真源 `_lib/mgate-gates/mform-gates.mjs` 的 `GENRE_MIN_L` 共 12 档：academic-hum / lit-review 15 · kaiti 10 · academic-cn / academic-case / course 3 · book-review / policy / industry 2 · report-3rd / biz-review / wechat 1；缺省 3。本描述不复述全表，改表须同步此处或直接以脚本为准）' },
      figDir: { type: 'string', description: '可选：图件目录（映射 --fig-dir，如 final/图件）——**M-Form-9 图件闭环的唯一输入**；不给则该门判不了缺图' },
      overwriteAdjudicated: { type: 'boolean', description: '映射 --overwrite-adjudicated：允许覆盖**已含 T8 裁定**的报告（阶段边界显式化）。仅在换稿重裁时用；普通 --report 复跑默认拒绝覆盖（exit 3）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exit: { type: 'number', description: '脚本机械退出码（见工具描述）' },
          exitMismatch: { type: 'boolean', description: 'JSON 自报退出码与进程退出码不一致' },
          jsonExit: { type: 'number', description: '脚本 JSON 自报退出码' },
          procExit: { type: 'number', description: '子进程实际退出码' },
          total: { type: 'number' },
          pass: { type: 'number' },
          p0: { type: 'number' },
          p1: { type: 'number' },
          p2: { type: 'number' },
          soft: { type: 'number' },
          skips: { type: 'number' },
          failures: {
            type: 'array',
            items: {
              // ⚠️ 此处**不得**写 `required`（嵌套与根都不行——见下）。宿主 value schema DSL 的 `required`
              //   只在**参数属性**层可用（`dsh-tools/lib/index.js:600-608` 的 property 分支 `allowRequired:true`），
              //   `output.schema` 走 `compileValueSchema`（同文件 :770-783，`allowRequired:false`）。
              //   写错会让 `defineTool()` **在定义期抛错** → 工具永不注册，且被入口的降级 catch 吞成一行提示。
              //   实测报错原文：`unsupported JSON schema: schema.required is not supported by the value schema DSL`。
              //   回归防线：`tests/entry.test.mjs` 断言「output.schema 全程不得出现 required」。
              type: 'object',
              additionalProperties: false,
              properties: {
                gate: { type: 'string' },
                severity: { type: 'string' },
                detail: { type: 'string' },
              },
            },
          },
          stderr: { type: 'string', description: '脚本 stderr 尾部（告警/提示，便于判断是否为路径问题）' },
          // v19.19.0（反哺 2026-10-19 U-06）：脚本 v19.18.0 起输出的三个**不进统计桶**的通道。
          //   此前 `additionalProperties:false` 把它们整体丢弃——而 `advisories` 恰是「选错机检档」的
          //   唯一提示（设计决定：不进任何桶、不改退出码，见 2026-10-18 三入口反哺 §128-144）。
          advisories: { type: 'array', items: { type: 'string' }, description: '档位对账提示（如「快写入口但未传 liteProfile」）——不改判级、不改退出码' },
          unchecked: { type: 'array', items: { type: 'string' }, description: '未能核验的项（如素材缺失导致 M-Fact-1 未核）' },
          hardRedLineHits: { type: 'array', items: { type: 'string' }, description: '命中硬红线的门（如 M-Integrity-1(P0)）' },
          truncated: { type: 'boolean', description: '脚本输出触到采集上限（结果可能不完整）' },
        },
      },
      render: (args, v) => [{
        type: 'text',
        text:
          (v.advisories && v.advisories.length
            ? '⚠ 档位对账提示（不改判级、不改退出码）：\n' + v.advisories.map((a) => `- ${a}`).join('\n') + '\n'
            : '') +
          `M 门：exit=${v.exit}｜通过 ${v.pass}/${v.total}｜P0 ${v.p0} / P1 ${v.p1} / P2 ${v.p2}` +
          (v.skips ? ` / SKIP ${v.skips}` : '') +
          (v.hardRedLineHits && v.hardRedLineHits.length ? `\n硬红线：${v.hardRedLineHits.join(' / ')}` : '') +
          (v.failures.length ? '\n' + v.failures.map((f) => `- [${f.severity}] ${f.gate}：${clip(f.detail, 240)}`).join('\n') : '') +
          (v.unchecked && v.unchecked.length ? '\n未核：' + v.unchecked.map((u) => `- ${u}`).join('\n') : '') +
          (v.stderr ? `\n（stderr 尾部）${clip(v.stderr, 300)}` : '') +
          (v.truncated ? '\n⚠️ 输出被截断，结果可能不完整' : ''),
      }],
    },
    async execute(args, exec) {
      // P1-2（v18.80.4）：相对路径按会话工作区解析；子进程 cwd 同基准（防「按宿主 cwd 查错目录」）
      const sessionCwd = exec?.agent?.session?.header?.cwd
      const argv = [resolveReadablePath(exec, args.draft, 'draft'), resolveReadablePath(exec, args.evidence, 'evidence'), ...(args.summary ? ['--summary'] : [])]
      // v19.6.0（§3.5）：报告落盘接线（此前是缺口表里点名的「最贵的一例」）。
      // v19.6.1（审计 F-1）：改成**围栏后**的路径——工作区 ∪ os.tmpdir() 之内，越界抛 INVALID_ARGS。
      if (args.report) argv.push('--report', resolveWritableReportPath(exec, args.report))
      // v19.16.0（反哺 F-01/F-02）：三面接线——此前只声明为「须直调脚本」的三个旗标。
      //   为什么必须接：`--lite-profile` 是快写入口的机检档开关（不接 → 全量 25 门 → 快轨假红）；
      //   `--genre` 决定文献下限（不接 → 非学术文类按缺省 3 多判）；`--fig-dir` 是 M-Form-9 的唯一输入。
      if (args.liteProfile) argv.push('--lite-profile')
      if (args.genre != null && String(args.genre).trim()) {
        const g = String(args.genre).trim()
        if (!/^[a-z0-9-]{2,32}$/.test(g)) throw new Error('INVALID_ARGS：genre 只接受文类 code（小写字母/数字/连字符），收到 ' + g)
        argv.push('--genre', g)
      }
      if (args.figDir) argv.push('--fig-dir', resolveReadablePath(exec, args.figDir, 'figDir'))
      // v19.19.0（U-06 同批）：`--overwrite-adjudicated` 接线——它是「防静默越界」的显式声明旗标，
      //   T8 换稿重裁时需要；工具面此前未暴露，调用方只能直调脚本（等于又绕回 pwsh）。
      if (args.overwriteAdjudicated) argv.push('--overwrite-adjudicated')
      const r = await runScript(join(skillRoot, 'scripts', 'm-gate-check.mjs'), argv, exec.signal, {
        timeoutMs: scriptTimeoutMs,
        maxBytes: scriptMaxOutputBytes,
        ...(typeof sessionCwd === 'string' && sessionCwd.trim() ? { cwd: sessionCwd.trim() } : {}),
      })
      const j = parseJson(r.out)
      if (!j) {
        // 基础设施失败（拿不到 JSON）→ throw（官方：throw 表示 isError）；内容不理想不算失败
        throw new Error(`${describeScriptFailure('m-gate-check', 'm-gate-check', r, scriptTimeoutMs, scriptMaxOutputBytes)}（exit=${r.code}）：${clip(r.err || r.out, 300)}`)
      }
      // v19.27.13（反哺 2026-10-26 F-12②）：退出码**双读**——任何不一致都留下两个原值；
      //   进程码非零且不一致时优先采用进程码，否则保留 JSON 自报。这样 JSON=1 / proc=70 也不会
      //   隐藏进程尾步内部错误，JSON=1 / proc=0 则仍以脚本明确判级为准。
      const jsonExitM = Number(j.exit ?? 0)
      const procExitM = Number.isInteger(r.code) ? r.code : 0
      const exitMismatchM = jsonExitM !== procExitM
      const exitFinalM = procExitM !== 0 && exitMismatchM ? procExitM : jsonExitM
      return {
        exit: exitFinalM,
        ...(exitMismatchM ? { exitMismatch: true, jsonExit: jsonExitM, procExit: procExitM } : {}),
        total: Number(j.total ?? 0),
        pass: Number(j.pass ?? 0),
        p0: Number(j.p0 ?? 0),
        p1: Number(j.p1 ?? 0),
        p2: Number(j.p2 ?? 0),
        soft: Number(j.soft ?? 0),
        skips: Number(j.skips ?? 0),
        failures: (j.results || [])
          .filter((x) => x.pass === false)
          .slice(0, 12)
          .map((x) => ({ gate: String(x.gate ?? ''), severity: String(x.severity ?? ''), detail: clip(x.detail, 800) })),
        // v19.19.0（U-06）：三个「提示/未核/硬红线」通道——此前被 schema 丢弃，等于工具面看不见档位错配。
        advisories: (j.advisories || []).map((s) => clip(s, 400)),
        unchecked: (j.unchecked || []).map((s) => clip(s, 400)),
        hardRedLineHits: (j.hard_red_line_hits || []).map((s) => clip(s, 120)),
        stderr: clip(String(r.err || '').split('\n').filter(Boolean).slice(-6).join('\n'), 600),
        ...(r.truncated ? { truncated: true } : {}),
      }
    },
  })))

  // ── 工具 2：字数统计（纯汉字；与全流水线同口径）────────────────────────────
  disposers.push(tools.register(defineTool({
    name: 'lunheng_char_count',
    executionMode: 'parallel',
    description:
      '统计论衡口径的**纯汉字数**（不含标点/数字/英文/编号）。mode=body（默认）＝正文区（`## 摘要` 之后至第一个文末节之前；' +
      '**无摘要时回落到首个正文二级标题**，v19.17.0 起口径统一、不留旧口径开关）；' +
      'full＝全文；summary＝分段字数 + 结构密度。**degraded=true 只在连正文二级标题都没有时置位**（起点退化为文件开头＝口径失真，须显式处理）。'
      + '未接的旗标见 `TOOL_FACE_FLAG_GAPS`（`--report` / `--warn-threshold` / `--word-metric` 须直调脚本）。**只读**。',
    parameters: {
      file: { type: 'string', required: true, description: '待统计的 Markdown 文件路径' },
      mode: { type: 'string', enum: ['body', 'full', 'summary'], description: '统计模式；省略 = body' },
      genre: { type: 'string', description: '可选：文类 code（映射 --genre，如 academic-cn / biz-review / kaiti）——非学术文类改用「首个正文二级标题」为起点；缺省 = 学术口径' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hanChars: { type: 'number' },
          scope: { type: 'string' },
          // v19.19.1（验收复现批 A-3）：脚本早已产出 `scopeSource`（bodyStartSource 派生），
          //   却被 `additionalProperties:false` 静默丢弃——与 19.19.0 修 `advisories` 同族，
          //   此处是漏网的第四个。`scope` 标签带同义信息，故不是误导，是**契约不一致**。
          scopeSource: { type: 'string', description: '起点来源（由 bodyStartSource 派生：abstract / first-h2 / full …），脚本原样透出，供核对统计口径' },
          exit: { type: 'number' },
          degraded: { type: 'boolean' },
          degradedReason: { type: 'string' },
          sections: { type: 'json', description: 'mode=summary 时的分段结构（原样透传，便于按需展开；v18.2.6 由 JSON 字符串改为规范 JSON 值，宿主 DSL 原生支持 json 节点）' },
          truncated: { type: 'boolean', description: '脚本输出触到采集上限（结果可能不完整）' },
        },
      },
      render: (args, v) => [{
        type: 'text',
        text:
          `${args.file}：${v.hanChars} 个纯汉字（${v.scope}）` +
          (v.exit !== 0 ? `｜exit=${v.exit}` : '') +
          (v.scopeSource ? `｜起点：${v.scopeSource}` : '') +
          (v.degraded ? `\n⚠️ 口径失真：${v.degradedReason}` : '') +
          (v.sections ? `\n${clip(JSON.stringify(v.sections), 400)}` : '') +
          (v.truncated ? '\n⚠️ 输出被截断，结果可能不完整' : ''),
      }],
    },
    async execute(args, exec) {
      // P1-2（v18.80.4）：同 m-gate——相对路径按会话工作区解析 + 子进程 cwd 钉同基准
      const sessionCwd = exec?.agent?.session?.header?.cwd
      const argv = [resolveReadablePath(exec, args.file, 'file'), ...(args.mode === 'full' ? ['--full'] : args.mode === 'summary' ? ['--summary'] : [])]
      // v19.19.0（U-10）：`--genre` 接线（脚本 v19.14.0 起已支持，工具面此前零暴露）。
      if (args.genre != null && String(args.genre).trim()) {
        const g = String(args.genre).trim()
        if (!/^[a-z0-9-]{2,32}$/.test(g)) throw new Error('INVALID_ARGS：genre 只接受文类 code（小写字母/数字/连字符），收到 ' + g)
        argv.push('--genre', g)
      }
      const r = await runScript(join(skillRoot, 'scripts', 'count-chars.mjs'), argv, exec.signal, {
        timeoutMs: scriptTimeoutMs,
        maxBytes: scriptMaxOutputBytes,
        ...(typeof sessionCwd === 'string' && sessionCwd.trim() ? { cwd: sessionCwd.trim() } : {}),
      })
      const j = parseJson(r.out)
      if (!j) {
        throw new Error(`${describeScriptFailure('count-chars', 'count-chars', r, scriptTimeoutMs, scriptMaxOutputBytes)}（exit=${r.code}）：${clip(r.err || r.out, 300)}`)
      }
      const isSummary = args.mode === 'summary'
      return {
        hanChars: Number(isSummary ? (j.total?.hanChars ?? j.body?.hanChars ?? 0) : (j.hanChars ?? 0)),
        scope: String(isSummary ? `summary（body=${j.body?.hanChars ?? 0} / total=${j.total?.hanChars ?? 0}）` : (j.scope ?? '')),
        // v19.19.2：**值也要取出来**。19.19.1 只把它加进了 `output.schema` 与 `render`，
        //   而 execute 是**逐字段组装**返回对象的 → 脚本明明产出了 `scopeSource`，
        //   渲染面却永远拿不到（实测：脚本 JSON 有 first-h2，工具输出只剩 scope）。
        //   这是「schema 有字段 ≠ 值到了 render」的又一实例，回归钉 = tests/tool-output-wiring.test.mjs。
        ...(j.scopeSource ? { scopeSource: String(j.scopeSource) } : {}),
        exit: Number(r.code ?? 0),
        degraded: j.degraded === true,
        ...(j.degraded ? { degradedReason: String(j.degradedReason ?? '') } : {}),
        ...(isSummary ? { sections: j } : {}),
        ...(r.truncated ? { truncated: true } : {}),
      }
    },
  })))

  // ── 工具 3：交接门（收报侧机械验收；只读，v18.6.0）────────────────────────
  disposers.push(tools.register(defineTool({
    name: 'lunheng_handoff_check',
    executionMode: 'parallel',
    description:
      '运行论衡交接门（收报侧机械验收）：核验收报角色的必需产物是否落盘、非空，以及（给了回报时）回报六要素是否齐备。' +
      '**只读**：不写文件、不自动重派。exit 语义：0 合格 / 20 产物缺失或 0 字节 / 21 结构·版本·成对·回报段不合 / 22 仅软提示（**≠ 已验收**：须人工复核并显式判，不得当通过）/ 10 参数路径错 / 70 内部错误。' +
      '与 M 门 1/2/3（=P1/P0/P2）**刻意分离**，不得混用。' +
      // v19.6.0（架构与机制反哺批 §3.5 · 主人授权「依次全部修订」）：**本工具的旗标缺口已清零**——
      //   `--require-gates` / `--level` 已接线（此前只有描述里的缺口声明，于是 Phase 5 的必跑验收
      //   只能走 `pwsh`，而 `pwsh` 恰是机制文件写保护**唯一已声明**的绕过口）。
      '⚠️ **v19.6.0 起 `--require-gates` 与 `--level` 已可在工具面直接使用**；'
      + '**v19.19.0 起 `--session-log` / `--session-root` 也已接线**（Phase 5 交付前的唯一独立核对层：'
      + '账本由主控写＝自述，宿主会话日志主控改不了）——`requireGates + sessionLog` 是 Phase 5 的标准调用形态。'
      + '剩下的 `--blind-review` 是盲评件契约模式（不要求 project/role），刻意不接，见 `TOOL_FACE_FLAG_GAPS`'
      + '（该表与本文件由 `tests/batch21-seam-gates` 双向对账，旗标真源 = 各脚本 `--help`）。',
    parameters: {
      project: { type: 'string', required: true, description: '项目目录，如 run/<项目名>' },
      role: { type: 'string', required: true, enum: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'G14'], description: '被验收角色（G14=中文 AI 痕迹检测器；**T8 是 Phase 5 交付前的必跑验收**，见 `SKILL.md` §执行能力边界；T0 无收报）' },
      report: { type: 'string', description: '可选：子代理回报原文。给了才做回报侧校验（六要素/行数/路径）' },
      reportFile: { type: 'string', description: '可选：回报文件路径（与 report 二选一，report 优先）' },
      summary: { type: 'boolean', description: 'true = 只回聚合与硬失败项（省 token）；省略 = 含逐产物机械事实' },
      requireGates: { type: 'boolean', description: 'true = 加验**人在环四门**（四份确认单齐备 + §6 五字段已回填）+ A11 外部服务授权串——**Phase 5 交付前必用**；省略 = 不判四门（中期角色收报时后几门本就未开）' },
      level: { type: 'string', enum: ['basic', 'strict'], description: 'basic（默认：A0/A1/A2）/ strict（另加 A3/A4/A4b/A4c/A5/A6/A8/A9；其中 A4b/A4c/A5/A8/A9 仅 T7）；省略 = 走 config 的 handoffLevel' },
      sessionLog: { type: 'string', description: '可选：会话 id，或会话日志文件/目录（映射 --session-log）——**Phase 5 交付前必给的独立核对层**（v19.6.0 列为主流程必跑；加它后账本 callId 必填，缺则硬 21）。只读宿主日志，本工具不写' },
      sessionRoot: { type: 'string', description: '会话 id 模式下的会话目录（映射 --session-root）。**传会话 id 时必须一并给**（脚本刻意不做 DSH_HOME 兜底，避免跨宿主假红；无它 → exit 10）；只接受 `$DSH_HOME/sessions` 之内（v19.19.1 起单独登记的只读根）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exit: { type: 'number', description: '0 合格 / 20 产物缺失或0字节 / 21 结构·版本·成对·回报段不合 / 22 仅软提示（**≠ 已验收**） / 10 参数路径错 / 70 内部错误' },
          exitMismatch: { type: 'boolean', description: 'JSON 自报退出码与进程退出码不一致' },
          jsonExit: { type: 'number', description: '脚本 JSON 自报退出码' },
          procExit: { type: 'number', description: '子进程实际退出码' },
          role: { type: 'string' },
          total: { type: 'number' },
          pass: { type: 'number' },
          hard: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { check: { type: 'string' }, subject: { type: 'string' }, severity: { type: 'string' }, detail: { type: 'string' } } } },
          soft: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { check: { type: 'string' }, subject: { type: 'string' }, severity: { type: 'string' }, detail: { type: 'string' } } } },
          artifacts: { type: 'json', description: '逐产物机械事实（summary=true 时仅失败项）' },
          report: { type: 'json', description: '回报侧结果（仅传了 report/reportFile 时出现）' },
          stderr: { type: 'string', description: '脚本 stderr 尾部' },
          truncated: { type: 'boolean', description: '输出触到采集上限' },
        },
      },
      render: (args, v) => [{
        type: 'text',
        text:
          // v19.19.0（U-02）：**空转必须显式可见**。此前 `total=0`（一项没核）与 `total=3 全软`
          //   都渲染成同一行「exit=22」，而 SKILL 把 22 读作「放行」——空转被写成已验收。
          (v.role === 'T8' && !args.requireGates
            ? '⚠ 空壳检查：未核四门、未核五件交付物——**这不是验收**（Phase 5 须 requireGates + sessionLog）\n'
            : '') +
          `交接门 ${v.role}：exit=${v.exit}｜通过 ${v.pass}/${v.total}` +
          (v.total === 0 ? '（**无可核项**：本次只跑了空壳分支）' : '') +
          (v.hard.length ? '\n' + v.hard.map((h) => `- [hard ${h.check}] ${h.subject}：${clip(h.detail, 240)}`).join('\n') : '') +
          (v.soft.length ? '\n' + v.soft.map((s) => `- [soft ${s.check}] ${s.subject}：${clip(s.detail, 240)}`).join('\n') : '') +
          (v.exit === 20 ? '\n→ 对策：重派（或按快照续作）' : v.exit === 21 ? '\n→ 对策：续接补交' : v.exit === 22 ? '\n→ 22 = **仅软提示，不等于已验收**：请按上面的 soft 清单人工确认后再写「已核」' : ''),
      }],
    },
    async execute(args, exec) {
      // P1-2（v18.80.4）：project/report/reportFile 的相对路径按会话工作区解析 + 子进程 cwd 同基准
      const sessionCwd = exec?.agent?.session?.header?.cwd
      // v19.6.0（§3.5）：`--require-gates` 必须在**位置参数之后**，紧跟 `--role` 的兄弟位置——
      //   实测：把它排在 `runScript` 之前、`argv` 之外（即漏 push）时工具**静默少做一步**；
      //   故这里只做「拼进去」，顺序与 `pwsh` 直调一致（选项可出现在任意位置）。
      const argv = ['--project', resolveReadablePath(exec, args.project, 'project'), '--role', args.role, '--level', args.level || handoffLevel || 'basic']
      if (args.requireGates) argv.push('--require-gates')
      // v19.19.0（U-01）：`--session-log` / `--session-root` 接线（此前工具面零暴露，缺口表却记 []）。
      //   值的形态有两种：**会话 id**（无路径分隔符，交由脚本按 $DSH_HOME/sessions 解析）与**文件/目录路径**
      //   （须过读面围栏）。二者不能套同一个 resolveReadablePath——id 不是路径，套了会误判越界。
      // v19.19.1（架构审计 R1）：只读根**单独登记**（`sessionLogRoots()`）——v19.19.0 只接线没验证可达性，
      //   而 `$DSH_HOME/sessions` 在工作区/tmp 之外 → `sessionRoot` 必被拦、id 形态又必缺 root 而 exit 10。
      const sessionExtra = sessionLogRoots()
      if (args.sessionLog != null && String(args.sessionLog).trim()) {
        const v = String(args.sessionLog).trim()
        const looksLikePath = /[\\/]/.test(v) || /^[A-Za-z]:/.test(v) || v.startsWith('.')
        argv.push('--session-log', looksLikePath ? resolveReadablePath(exec, v, 'sessionLog', { extraRoots: sessionExtra }) : v)
      }
      if (args.sessionRoot != null && String(args.sessionRoot).trim()) {
        argv.push('--session-root', resolveReadablePath(exec, String(args.sessionRoot).trim(), 'sessionRoot', { extraRoots: sessionExtra }))
      }
      if (args.report) argv.push('--report', args.report)
      else if (args.reportFile) argv.push('--report-file', resolveReadablePath(exec, args.reportFile, 'reportFile'))
      if (args.summary) argv.push('--summary')
      const r = await runScript(join(skillRoot, 'scripts', 'handoff-check.mjs'), argv, exec.signal, {
        timeoutMs: scriptTimeoutMs,
        maxBytes: scriptMaxOutputBytes,
        ...(typeof sessionCwd === 'string' && sessionCwd.trim() ? { cwd: sessionCwd.trim() } : {}),
      })
      const j = parseJson(r.out)
      if (!j) {
        throw new Error(`${describeScriptFailure('handoff-check', 'handoff-check', r, scriptTimeoutMs, scriptMaxOutputBytes)}（exit=${r.code}）：${clip(r.err || r.out, 300)}`)
      }
      // v19.27.13（反哺 F-12②）：与 m-gate-check 同款退出码双读（见该处注释）。
      const jsonExitH = Number(j.exit ?? 0)
      const procExitH = Number.isInteger(r.code) ? r.code : 0
      const exitMismatchH = jsonExitH !== procExitH
      const exitFinalH = procExitH !== 0 && exitMismatchH ? procExitH : jsonExitH
      return {
        exit: exitFinalH,
        ...(exitMismatchH ? { exitMismatch: true, jsonExit: jsonExitH, procExit: procExitH } : {}),
        role: String(j.role ?? ''),
        total: Number(j.total ?? 0),
        pass: Number(j.pass ?? 0),
        hard: (j.hard || []).slice(0, 12).map((h) => ({ check: String(h.check ?? ''), subject: String(h.subject ?? ''), severity: String(h.severity ?? ''), detail: clip(h.detail, 800) })),
        soft: (j.soft || []).slice(0, 12).map((s) => ({ check: String(s.check ?? ''), subject: String(s.subject ?? ''), severity: String(s.severity ?? ''), detail: clip(s.detail, 800) })),
        artifacts: j.artifacts ?? [],
        ...(j.report ? { report: j.report } : {}),
        stderr: clip(String(r.err || '').split('\n').filter(Boolean).slice(-6).join('\n'), 600),
        ...(r.truncated ? { truncated: true } : {}),
      }
    },
  })))

  // ── 工具 4：伦理脱敏（只读；v18.60.0）──────────────────────────────────────
  // 为什么是**只读**：本工具处理的是最敏感的输入（访谈逐字稿 / 田野笔记）。若由工具写盘，
  //   写盘目标就来自调用方入参；改为「返回脱敏文本、由主控自己 write」后：
  //   ① 保住「只读工具」族的既有声明（SECURITY.md）；② 落盘位置由主控显式决定，不经入参注入。
  disposers.push(tools.register(defineTool({
    name: 'lunheng_ethics_sanitize',
    executionMode: 'parallel',  // 纯函数，与其他并发安全
    description:
      '论衡伦理脱敏：把访谈逐字稿 / 田野笔记中的**可识别个人信息**替换为占位符，供后续角色在**已脱敏文本**上作业。' +
      '**只读**：不写盘、不联网、不起子进程；脱敏后的文本**随返回值给出**，落盘由主控用自身 write 工具决定。' +
      '覆盖：身份证 / 手机 / 固话 / 邮箱 / 银行卡（正则判定）+ 人名 / 地名（词表判定）。' +
      'mode：none（显式声明不脱敏）/ basic（默认）/ strict（地名泛化到省级，保留地域分析价值）。' +
      '**低置信人名默认不改写正文**（v18.80.0 P1-2）：姓氏命中但上下文无角色词的人名只登记进 reviewFlags，' +
      '要连它们一起替换须显式传 rewriteLowConfidence=true（**会误伤**「张三补充」→「受访者C充」这类普通词，故不默认）。' +
      '**能力边界（务必如实转述，不得读成「已彻底匿名化」）**：人名与地名靠词表匹配，' +
      '召回率与精度都不可能 100%；拿不准的进 reviewFlags 待人工复核。**本工具不是双盲评审的充分条件**。' +
      '大文件用 offset + maxChars 分页读（返回 nextOffset）。',
    parameters: {
      file: { type: 'string', required: true, description: '待脱敏的文本文件路径（访谈逐字稿 / 田野笔记）' },
      mode: { type: 'string', enum: ['none', 'basic', 'strict'], description: '脱敏模式；省略 = basic' },
      offset: { type: 'number', description: '返回文本的起始字符偏移（分页用）；省略 = 0' },
      maxChars: { type: 'number', description: '本次返回的字符上限；省略 = 60000' },
      rewriteLowConfidence: { type: 'boolean', description: 'true = 低置信人名也一并替换（默认 false：只登记待复核，不改写正文）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', description: '实际生效的模式（非法入参回落 basic）' },
          text: { type: 'string', description: '**已脱敏**的文本片段（不是原文）；请只把本字段交给下游角色' },
          textOffset: { type: 'number', description: '本片段的起始偏移' },
          textTotalChars: { type: 'number', description: '脱敏后全文总字符数' },
          nextOffset: { type: 'number', description: '下一页的 offset；仅当还有未返回内容时出现' },
          truncated: { type: 'boolean', description: '本片段被 maxChars 截断（还有后续内容）' },
          counts: { type: 'json', description: '各类实体替换计数（idcard/bankcard/phone/landline/email/person/personHigh/personLow/place；personLow 是**候选数非替换数**）' },
          distinctPersons: { type: 'number', description: '涉及的不同人名个数' },
          replacements: { type: 'json', description: '替换明细（原名 → 占位符），受条数上限约束' },
          reviewFlags: { type: 'json', description: '**待人工复核项**（含低置信度人名与缺词表降级说明）' },
          degraded: { type: 'boolean', description: '词表缺失导致某维度未生效（此时不得声称已完整脱敏）' },
          degradedReason: { type: 'string' },
          summary: { type: 'string', description: '人类可读摘要（不含脱敏文本本身）' },
        },
      },
      render: (args, v) => [{
        type: 'text',
        text:
          `伦理脱敏 ${args.file}｜${v.summary}` +
          (v.reviewFlags.length
            // v18.76.0（v18.75.1 全量架构审计 R4 · P1 修复）：**不得把原文渲染进 content**。
            //   本字符串是 canonical value 之外**唯一被会话日志持久化**的面（见本文件头注释 :9-11），
            //   旧实现打印 `f.text`（= 原文人名，`lib/ethics-sanitize.js:269` 写入）→ 与同一返回值里的
            //   占位符一一对应，整篇匿名化稿可被还原。现只打印**项数 + 类别**；定位交给结构化 value
            //   （`reviewFlags[].kind` / `reviewFlags[].detail`，二者不含原文）。
            ? `\n**待复核**：${v.reviewFlags.length} 项（类别：${[...new Set(v.reviewFlags.map((f) => f.kind))].join(' / ')}）——明细含原名，仅在结构化返回值里；请只把本文的 \`text\`（已脱敏）交给下游角色`
            : '') +
          (v.truncated ? `\n→ 还有后续内容，下一页用 offset=${v.nextOffset}（全文 ${v.textTotalChars} 字）` : ''),
      }],
    },
    async execute(args, exec) {
      // 动态 import 兄弟模块（静态 import 亦可，但保持与其它工具一致的「失败可降级」形态）
      const { loadDicts, sanitize, summarize } = await import('./ethics-sanitize.js')
      const { readFileSync, existsSync, statSync } = await import('node:fs')
      // P1-2（v18.80.4）：相对路径按会话工作区解析（旧实现按宿主 cwd 直读 → 桌面/多工作区常态查错目录）
      const filePath = resolveReadablePath(exec, args.file, 'file')
      if (!existsSync(filePath)) {
        // 路径错 = 基础设施失败 → throw（不得把「文件没找到」伪装成「脱敏完成、0 处替换」）
        throw new Error(`伦理脱敏：文件不存在 ${filePath}`)
      }
      // v18.69.0（批 6-A · P2 修复）：旧版 readFileSync 全量读 + MAX_SAFE_INTEGER 全文处理，即便调用方
      //   只取 60000 字符分页也会把整个文件（含 GB 级）同步吃进内存 → 宿主进程卡死。加体积上限：
      //   超限抛错并给可操作指引（切分 / 走 H2 钩子单块分页），不给宿主装死。上限 16MB 对「单篇长文
      //   或访谈稿」绰绰有余，又拦得住失控输入。
      const MAX_INPUT_BYTES = 16 * 1024 * 1024
      let fileSize = 0
      try { fileSize = statSync(filePath).size } catch { /* stat 失败由下方 readFileSync 报 */ }
      if (fileSize > MAX_INPUT_BYTES) {
        throw new Error(
          `伦理脱敏：输入文件过大（${fileSize} B > ${MAX_INPUT_BYTES} B 上限）——本工具为同步全量处理，` +
          `超大文件请先按节切分，或改用 H2 钩子（tools/post-execute）对单个 text 块分页脱敏。`,
        )
      }
      const raw = readFileSync(filePath, 'utf8')
      const dicts = loadDicts(skillRoot)
      const full = sanitize(raw, { mode: args.mode, dicts, maxChars: Number.MAX_SAFE_INTEGER, rewriteLowConfidence: args.rewriteLowConfidence === true })
      const offset = Number.isFinite(args.offset) && args.offset > 0 ? Math.floor(args.offset) : 0
      // v18.80.4（全量审计-v18.80.3 P2-2）：floor 后夹 ≥1——旧实现对 0<maxChars<1 的小数 floor 成 0，
      //   slice(0,0)=空串且 hasMore=true → nextOffset=offset（不前进），消费方分页陷入无进展循环。
      //   不变式：hasMore 为真时 nextOffset = offset + slice.length 且 slice.length ≥ 1 → 必然前进。
      const limit = Math.max(1, Math.floor(Number.isFinite(args.maxChars) && args.maxChars > 0 ? args.maxChars : 60000))
      const total = full.text.length
      const slice = full.text.slice(offset, offset + limit)
      const hasMore = offset + slice.length < total
      return {
        mode: full.mode,
        text: slice,
        textOffset: offset,
        textTotalChars: total,
        ...(hasMore ? { nextOffset: offset + slice.length, truncated: true } : {}),
        counts: full.counts,
        distinctPersons: full.distinctPersons,
        replacements: full.replacements,
        reviewFlags: full.reviewFlags,
        degraded: full.degraded,
        ...(full.degraded ? { degradedReason: full.degradedReason } : {}),
        summary: summarize(full),
      }
    },
  })))

  return disposers
}
