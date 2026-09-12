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

/** 跑一个随包脚本并收集输出（尊重 `exec.signal`：中止即 kill 子进程）。 */
function runScript(scriptPath, args, signal) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    const onAbort = () => { try { child.kill() } catch { /* 已退出 */ } }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    child.stdout.on('data', (d) => { out += String(d) })
    child.stderr.on('data', (d) => { err += String(d) })
    child.on('error', (e) => { resolve({ code: null, out, err: err + String(e.message) }) })
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve({ code, out, err })
    })
  })
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
 */
export async function installLunhengTools(ctx, { skillRoot, defineToolFactory } = {}) {
  const tools = ctx.get('tools')
  if (!tools?.register) return []
  let defineTool
  try {
    const factory = defineToolFactory || (() => import('@deepseek-ai/dsh-tools'))
    ;({ defineTool } = await factory())
    if (typeof defineTool !== 'function') throw new Error('defineTool 不是函数')
  } catch (e) {
    console.error(`· 论衡原生工具未启用（无法取得 defineTool：${String(e?.code || e?.message).slice(0, 80)}）——技能与流水线不受影响，仍可用 pwsh 调脚本`)
    return []
  }
  const disposers = []

  // ── 工具 1：M 门机械预检（23 项；只读，不写任何文件）────────────────────────
  disposers.push(tools.register(defineTool({
    name: 'lunheng_m_gate',
    description:
      '运行论衡 M 门机械预检（M-Form 11 + M-Exist 10 + M-Integrity-1 佐证 = 22 项脚本判定；23 项含主控人工门 M-Integrity-2）。' +
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
        },
      },
      render: (args, v) => [{
        type: 'text',
        text:
          `M 门：exit=${v.exit}｜通过 ${v.pass}/${v.total}｜P0 ${v.p0} / P1 ${v.p1} / P2 ${v.p2}` +
          (v.skips ? ` / SKIP ${v.skips}` : '') +
          (v.failures.length ? '\n' + v.failures.map((f) => `- [${f.severity}] ${f.gate}：${clip(f.detail, 240)}`).join('\n') : '') +
          (v.stderr ? `\n（stderr 尾部）${clip(v.stderr, 300)}` : ''),
      }],
    },
    async execute(args, exec) {
      const argv = [args.draft, args.evidence, ...(args.summary ? ['--summary'] : [])]
      const r = await runScript(join(skillRoot, 'scripts', 'm-gate-check.mjs'), argv, exec.signal)
      const j = parseJson(r.out)
      if (!j) {
        // 基础设施失败（拿不到 JSON）→ throw（官方：throw 表示 isError）；内容不理想不算失败
        throw new Error(`m-gate-check 未返回 JSON（exit=${r.code}）：${clip(r.err || r.out, 300)}`)
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
      }
    },
  })))

  // ── 工具 2：字数统计（纯汉字；与全流水线同口径）────────────────────────────
  disposers.push(tools.register(defineTool({
    name: 'lunheng_char_count',
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
          sections: { type: 'string', description: 'mode=summary 时的分段 JSON（原样透传，便于按需展开）' },
        },
      },
      render: (args, v) => [{
        type: 'text',
        text:
          `${args.file}：${v.hanChars} 个纯汉字（${v.scope}）` +
          (v.exit !== 0 ? `｜exit=${v.exit}` : '') +
          (v.degraded ? `\n⚠️ 口径失真：${v.degradedReason}` : '') +
          (v.sections ? `\n${clip(v.sections, 400)}` : ''),
      }],
    },
    async execute(args, exec) {
      const argv = [args.file, ...(args.mode === 'full' ? ['--full'] : args.mode === 'summary' ? ['--summary'] : [])]
      const r = await runScript(join(skillRoot, 'scripts', 'count-chars.mjs'), argv, exec.signal)
      const j = parseJson(r.out)
      if (!j) throw new Error(`count-chars 未返回 JSON（exit=${r.code}）：${clip(r.err || r.out, 300)}`)
      const isSummary = args.mode === 'summary'
      return {
        hanChars: Number(isSummary ? (j.total?.hanChars ?? j.body?.hanChars ?? 0) : (j.hanChars ?? 0)),
        scope: String(isSummary ? `summary（body=${j.body?.hanChars ?? 0} / total=${j.total?.hanChars ?? 0}）` : (j.scope ?? '')),
        exit: Number(r.code ?? 0),
        degraded: j.degraded === true,
        ...(j.degraded ? { degradedReason: String(j.degradedReason ?? '') } : {}),
        ...(isSummary ? { sections: JSON.stringify(j) } : {}),
      }
    },
  })))

  return disposers
}
