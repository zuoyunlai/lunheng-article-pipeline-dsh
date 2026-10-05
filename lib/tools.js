// 论衡原生工具（C 组 · v18.1.0）：把两个**只读**机检脚本暴露为 DSH 原生工具。
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
import { join } from 'node:path'

/** 跑一个随包脚本并收集输出（尊重 `exec.signal`；v18.2.6 加**超时**与**输出上限**）。
 *
 * 为什么必须加（审计 P2-12）：旧实现既无超时也无输出上限——脚本挂起会一直占住这次工具调用
 * （只靠 `exec.signal` 兜底），而 `out += String(d)` 对「M 门默认打印全量 results」这类输出无界缓冲。
 * 超时/截断都**如实回传**（不静默），由 execute 决定怎么呈现。
 */
function runScript(scriptPath, args, signal, { timeoutMs, maxBytes } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(process.execPath, [scriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
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
    const append = (cur, d) => {
      const s = String(d)
      if (cur.length + s.length <= cap) return cur + s
      truncated = true
      return cur.slice(0, Math.max(0, cap - 1)) + '…'
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
    child.stdout.on('data', (d) => { out = append(out, d) })
    child.stderr.on('data', (d) => { err = append(err, d) })
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

  // ── 工具 1：M 门机械预检（24 项；只读，不写任何文件）────────────────────────
  // H1（v18.60.1 反哺 v3）：executionMode:'parallel' 让 driver 用有界滚动池调度（与 handoff_check / char_count 并发安全）。
  // 主人显式授权落地，详见 `audits/反哺报告-v18.60.1-DSH新能力接缝.md` §四 H1 + `audits/机制文件修订记录-2026-09-30-反哺v3全批.md`。
  disposers.push(tools.register(defineTool({
    name: 'lunheng_m_gate',
    executionMode: 'parallel',
    description:
      '运行论衡 M 门机械预检（M-Form 11 + M-Exist 11 + M-Integrity-1 + M-Fact-1 佐证 = 24 项脚本判定；25 项含主控人工门 M-Integrity-2）。' +
      '**只读**：不修改任何文件。返回规范 JSON（exit / 通过数 / P0·P1·P2 / 硬失败明细），人类可读文本另走渲染。' +
      'exit 语义：0 通过 / 1 有 P1 / 2 有 P0 / 3 仅 P2·soft·SKIP（需人工复核，不得当通过）/ 10 参数或路径错 / 70 内部错误。',
    parameters: {
      draft: { type: 'string', required: true, description: '被审正文路径（<项目>/final/定稿.md 或 <项目>/drafts/初稿-vN.md）' },
      evidence: { type: 'string', required: true, description: '证据包目录（<项目>/final/证据包）' },
      summary: { type: 'boolean', description: 'true = 只回聚合统计与硬失败项（省 token）；省略 = 全量 results' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exit: { type: 'number', description: '脚本机械退出码（见工具描述）' },
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
          truncated: { type: 'boolean', description: '脚本输出触到采集上限（结果可能不完整）' },
        },
      },
      render: (args, v) => [{
        type: 'text',
        text:
          `M 门：exit=${v.exit}｜通过 ${v.pass}/${v.total}｜P0 ${v.p0} / P1 ${v.p1} / P2 ${v.p2}` +
          (v.skips ? ` / SKIP ${v.skips}` : '') +
          (v.failures.length ? '\n' + v.failures.map((f) => `- [${f.severity}] ${f.gate}：${clip(f.detail, 240)}`).join('\n') : '') +
          (v.stderr ? `\n（stderr 尾部）${clip(v.stderr, 300)}` : '') +
          (v.truncated ? '\n⚠️ 输出被截断，结果可能不完整' : ''),
      }],
    },
    async execute(args, exec) {
      const argv = [args.draft, args.evidence, ...(args.summary ? ['--summary'] : [])]
      const r = await runScript(join(skillRoot, 'scripts', 'm-gate-check.mjs'), argv, exec.signal, {
        timeoutMs: scriptTimeoutMs,
        maxBytes: scriptMaxOutputBytes,
      })
      const j = parseJson(r.out)
      if (!j) {
        // 基础设施失败（拿不到 JSON）→ throw（官方：throw 表示 isError）；内容不理想不算失败
        throw new Error(`${describeScriptFailure('m-gate-check', 'm-gate-check', r, scriptTimeoutMs, scriptMaxOutputBytes)}（exit=${r.code}）：${clip(r.err || r.out, 300)}`)
      }
      return {
        exit: Number(j.exit ?? 0),
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
      '统计论衡口径的**纯汉字数**（不含标点/数字/英文/编号）。mode=body（默认）＝正文区（`## 摘要` 之后至第一个文末节之前）；' +
      'full＝全文；summary＝分段字数 + 结构密度。缺「## 摘要」时返回 degraded=true（口径失真，须显式处理）。**只读**。',
    parameters: {
      file: { type: 'string', required: true, description: '待统计的 Markdown 文件路径' },
      mode: { type: 'string', enum: ['body', 'full', 'summary'], description: '统计模式；省略 = body' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hanChars: { type: 'number' },
          scope: { type: 'string' },
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
          (v.degraded ? `\n⚠️ 口径失真：${v.degradedReason}` : '') +
          (v.sections ? `\n${clip(JSON.stringify(v.sections), 400)}` : '') +
          (v.truncated ? '\n⚠️ 输出被截断，结果可能不完整' : ''),
      }],
    },
    async execute(args, exec) {
      const argv = [args.file, ...(args.mode === 'full' ? ['--full'] : args.mode === 'summary' ? ['--summary'] : [])]
      const r = await runScript(join(skillRoot, 'scripts', 'count-chars.mjs'), argv, exec.signal, {
        timeoutMs: scriptTimeoutMs,
        maxBytes: scriptMaxOutputBytes,
      })
      const j = parseJson(r.out)
      if (!j) {
        throw new Error(`${describeScriptFailure('count-chars', 'count-chars', r, scriptTimeoutMs, scriptMaxOutputBytes)}（exit=${r.code}）：${clip(r.err || r.out, 300)}`)
      }
      const isSummary = args.mode === 'summary'
      return {
        hanChars: Number(isSummary ? (j.total?.hanChars ?? j.body?.hanChars ?? 0) : (j.hanChars ?? 0)),
        scope: String(isSummary ? `summary（body=${j.body?.hanChars ?? 0} / total=${j.total?.hanChars ?? 0}）` : (j.scope ?? '')),
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
      '**只读**：不写文件、不自动重派。exit 语义：0 合格 / 20 产物缺失或 0 字节 / 21 结构·版本·成对·回报段不合 / 22 仅软提示 / 10 参数路径错 / 70 内部错误。' +
      '与 M 门 1/2/3（=P1/P0/P2）**刻意分离**，不得混用。',
    parameters: {
      project: { type: 'string', required: true, description: '项目目录，如 run/<项目名>' },
      role: { type: 'string', required: true, enum: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'G14'], description: '被验收角色（G14=中文 AI 痕迹检测器；T8/T0 无收报，一般不用）' },
      report: { type: 'string', description: '可选：子代理回报原文。给了才做回报侧校验（六要素/行数/路径）' },
      reportFile: { type: 'string', description: '可选：回报文件路径（与 report 二选一，report 优先）' },
      summary: { type: 'boolean', description: 'true = 只回聚合与硬失败项（省 token）；省略 = 含逐产物机械事实' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exit: { type: 'number', description: '0 合格 / 20 产物缺失或0字节 / 21 结构·版本·成对·回报段不合 / 22 仅软提示 / 10 参数路径错 / 70 内部错误' },
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
          `交接门 ${v.role}：exit=${v.exit}｜通过 ${v.pass}/${v.total}` +
          (v.hard.length ? '\n' + v.hard.map((h) => `- [hard ${h.check}] ${h.subject}：${clip(h.detail, 240)}`).join('\n') : '') +
          (v.soft.length ? '\n' + v.soft.map((s) => `- [soft ${s.check}] ${s.subject}：${clip(s.detail, 240)}`).join('\n') : '') +
          (v.exit === 20 ? '\n→ 对策：重派（或按快照续作）' : v.exit === 21 ? '\n→ 对策：续接补交' : ''),
      }],
    },
    async execute(args, exec) {
      const argv = ['--project', args.project, '--role', args.role, '--level', handoffLevel || 'basic']
      if (args.report) argv.push('--report', args.report)
      else if (args.reportFile) argv.push('--report-file', args.reportFile)
      if (args.summary) argv.push('--summary')
      const r = await runScript(join(skillRoot, 'scripts', 'handoff-check.mjs'), argv, exec.signal, {
        timeoutMs: scriptTimeoutMs,
        maxBytes: scriptMaxOutputBytes,
      })
      const j = parseJson(r.out)
      if (!j) {
        throw new Error(`${describeScriptFailure('handoff-check', 'handoff-check', r, scriptTimeoutMs, scriptMaxOutputBytes)}（exit=${r.code}）：${clip(r.err || r.out, 300)}`)
      }
      return {
        exit: Number(j.exit ?? 0),
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
      '**能力边界（务必如实转述，不得读成「已彻底匿名化」）**：人名与地名靠词表匹配，' +
      '召回率与精度都不可能 100%；拿不准的进 reviewFlags 待人工复核。**本工具不是双盲评审的充分条件**。' +
      '大文件用 offset + maxChars 分页读（返回 nextOffset）。',
    parameters: {
      file: { type: 'string', required: true, description: '待脱敏的文本文件路径（访谈逐字稿 / 田野笔记）' },
      mode: { type: 'string', enum: ['none', 'basic', 'strict'], description: '脱敏模式；省略 = basic' },
      offset: { type: 'number', description: '返回文本的起始字符偏移（分页用）；省略 = 0' },
      maxChars: { type: 'number', description: '本次返回的字符上限；省略 = 60000' },
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
          counts: { type: 'json', description: '各类实体替换计数（idcard/bankcard/phone/landline/email/person/place）' },
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
    async execute(args) {
      // 动态 import 兄弟模块（静态 import 亦可，但保持与其它工具一致的「失败可降级」形态）
      const { loadDicts, sanitize, summarize } = await import('./ethics-sanitize.js')
      const { readFileSync, existsSync, statSync } = await import('node:fs')
      if (!existsSync(args.file)) {
        // 路径错 = 基础设施失败 → throw（不得把「文件没找到」伪装成「脱敏完成、0 处替换」）
        throw new Error(`伦理脱敏：文件不存在 ${args.file}`)
      }
      // v18.69.0（批 6-A · P2 修复）：旧版 readFileSync 全量读 + MAX_SAFE_INTEGER 全文处理，即便调用方
      //   只取 60000 字符分页也会把整个文件（含 GB 级）同步吃进内存 → 宿主进程卡死。加体积上限：
      //   超限抛错并给可操作指引（切分 / 走 H2 钩子单块分页），不给宿主装死。上限 16MB 对「单篇长文
      //   或访谈稿」绰绰有余，又拦得住失控输入。
      const MAX_INPUT_BYTES = 16 * 1024 * 1024
      let fileSize = 0
      try { fileSize = statSync(args.file).size } catch { /* stat 失败由下方 readFileSync 报 */ }
      if (fileSize > MAX_INPUT_BYTES) {
        throw new Error(
          `伦理脱敏：输入文件过大（${fileSize} B > ${MAX_INPUT_BYTES} B 上限）——本工具为同步全量处理，` +
          `超大文件请先按节切分，或改用 H2 钩子（tools/post-execute）对单个 text 块分页脱敏。`,
        )
      }
      const raw = readFileSync(args.file, 'utf8')
      const dicts = loadDicts(skillRoot)
      const full = sanitize(raw, { mode: args.mode, dicts, maxChars: Number.MAX_SAFE_INTEGER })
      const offset = Number.isFinite(args.offset) && args.offset > 0 ? Math.floor(args.offset) : 0
      const limit = Number.isFinite(args.maxChars) && args.maxChars > 0 ? Math.floor(args.maxChars) : 60000
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
