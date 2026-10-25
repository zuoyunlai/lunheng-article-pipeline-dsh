#!/usr/bin/env node
// 主人侧入口 CLI（v19.27.8 · 审计 P2-2）——`-gate` 与 `-abort` 的**机械实现**，由 `/lunheng` 路由转交。
//
// **为什么存在**：审计结论「论衡的人在环是**单向**的」——「证明主人同意过」有登记表 / A7 / 回执账本 /
//   会话日志四层机械；而「让主人**直接**推动流程」却只有一条路：主人在对话里说话，主控再转录成
//   §6 五字段与回执。转录这一步没有任何机械约束（主控可以写得更顺、更简、更像自己想要的结论），
//   实测项目里就出现过「§6 主人原话」比主人真实发言更长更漂亮的情况。
//   本脚本把**两种主人动作**变成可核文件：
//     · `gate`  —— 主人在命令行给出通过/驳回，**原文**直接进回执账本（`rawAnswer` 就是主人打的字）；
//     · `abort` —— 主人中止项目，落 `audits/abort.json`，主控在下一个门边界必须停。
//
// **它不能做什么（如实边界）**：它不写 §6、不改 `status.md`、不删任何产物——那些是主控的写面。
//   它只写两处：`run/<项目>/audits/gate-receipts.jsonl`（追加一行）与 `run/<项目>/audits/abort.json`。
//   故 `-gate` 之后主控仍须把同一句 `rawAnswer` **逐字**回填 §6「主人原话」，否则 A7 报「不相容」
//   （这是刻意的：账本是主人写的，§6 是主控写的，两者必须字面相等才叫未改写）。
//
// 用法：
//   node .../owner-cli.mjs gate  <项目> <Phase0|Phase2.5|Phase3.5|Phase5> --approve|--reject [--note "…"] [--run-dir <dir>] [--json]
//   node .../owner-cli.mjs abort <项目> [--reason "…"] [--run-dir <dir>] [--json]
//   node .../owner-cli.mjs list  [--run-dir <dir>] [--json]        # 列出 run/ 下项目与已有门/中止标记
//
// exit：0 = 成功 / 10 = 用法或参数错 / 20 = 项目不存在或路径越界（run-path-fence 真源判）

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveProjectDir, isPathInsideRunDir } from '../../../lib/run-path-fence.mjs'

const die = (msg, code = 10) => {
  const out = { ok: false, error: msg }
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2))
  else console.error(`[owner-cli] ${msg}`)
  process.exit(code)
}

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
const runDir = resolve(flag('--run-dir') || process.env.LUNHENG_RUN_DIR || join(process.cwd(), 'run'))
const verb = argv[0]
const positional = argv.slice(1).filter((a) => !a.startsWith('--') && a !== flag('--note') && a !== flag('--reason') && a !== flag('--run-dir'))

const PHASES = ['Phase0', 'Phase2.5', 'Phase3.5', 'Phase5']
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

const emit = (obj) => {
  if (asJson) console.log(JSON.stringify(obj, null, 2))
  else for (const line of obj.lines || []) console.log(line)
  process.exit(obj.ok ? 0 : 20)
}

// ── 项目解析（三层围栏真源 = lib/run-path-fence.mjs）───────────────────────────
const resolveProject = (arg) => {
  if (!arg) die('缺项目名（用法：owner-cli.mjs gate <项目> <Phase> --approve|--reject）')
  if (!existsSync(runDir)) die(`run 目录不存在：${runDir}（用 --run-dir 指定，或在工作区根执行）`, 20)
  let dir = null
  try { dir = resolveProjectDir(runDir, arg) } catch { dir = null }
  if (!dir || !existsSync(dir)) die(`项目不存在：run/${arg}（可用 \`list\` 子命令看现有项目）`, 20)
  if (!isPathInsideRunDir(runDir, dir)) die(`路径越界：${dir} 不在 ${runDir} 之内`, 20)
  return dir
}

// ── gate ───────────────────────────────────────────────────────────────────
const doGate = () => {
  const [projectArg, phase] = positional
  if (!phase) die('缺门次（Phase0 / Phase2.5 / Phase3.5 / Phase5）')
  if (!PHASES.includes(phase)) die(`未知门次：${phase}（只接受 ${PHASES.join(' / ')}）`)
  const approve = argv.includes('--approve')
  const reject = argv.includes('--reject')
  if (approve === reject) die('必须且只能给一个：--approve 或 --reject')
  const dir = resolveProject(projectArg)
  const note = flag('--note')
  // rawAnswer = 主人实际打的字（含 --note 原样），A7 会要求 §6「主人原话」**逐字**含它。
  const rawAnswer = note && note.trim()
    ? note.trim()
    : `主人 CLI 裁定：${phase} ${approve ? '通过' : '驳回'}`

  const audits = join(dir, 'audits')
  mkdirSync(audits, { recursive: true })
  const ledger = join(audits, 'gate-receipts.jsonl')
  // round = 该门已有回执数 + 1（与 handoff-check 的 `_key = gate#round` 对齐）
  let round = 1
  if (existsSync(ledger)) {
    const lines = readFileSync(ledger, 'utf8').split(/\r?\n/).filter((l) => l.trim())
    const same = lines.map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter((o) => o && o.gate === phase)
    round = same.length + 1
  }
  const receipt = {
    gate: phase,
    round,
    answeredAt: nowIso(),
    rawAnswer,
    tool: 'owner-cli',
    callIdSource: 'not-captured',
    decision: approve ? 'approve' : 'reject',
    by: 'owner-cli',
    ...(note ? { note } : {}),
  }
  appendFileSync(ledger, `${JSON.stringify(receipt)}\n`, 'utf8')

  emit({
    ok: true,
    project: projectArg,
    dir,
    ledger,
    key: `${phase}#${round}`,
    receipt,
    lines: [
      `✓ 已写入回执 ${phase}#${round}（${approve ? '通过' : '驳回'}）→ ${ledger}`,
      '',
      '主控接下来必须做（本脚本不代劳，否则等于自证）：',
      `  1. 把下面这句**逐字**粘进 \`阶段确认-${phase}.md\` §6「主人原话」：`,
      `     ${rawAnswer}`,
      `  2. 「回复时间」填 ${receipt.answeredAt}；「提问方式」写「主人 CLI（-gate）」；`,
      `  3. 「回执 id」填 \`${phase}#${round}\`；「主控落盘结论」写本次裁定的执行结论；「轮次计数」递增。`,
      ...(reject ? ['  4. 驳回：按主控卡 §四 的处置走（不得自行放行；重做后另开一轮门）。'] : []),
    ],
  })
}

// ── abort ──────────────────────────────────────────────────────────────────
const doAbort = () => {
  const dir = resolveProject(positional[0])
  const reason = (flag('--reason') || '').trim()
  const audits = join(dir, 'audits')
  mkdirSync(audits, { recursive: true })
  const marker = join(audits, 'abort.json')
  const prev = existsSync(marker) ? (() => { try { return JSON.parse(readFileSync(marker, 'utf8')) } catch { return null } })() : null
  const rec = {
    abortedAt: nowIso(),
    ...(reason ? { reason } : {}),
    by: 'owner-cli',
    ...(prev ? { firstAbortedAt: prev.firstAbortedAt || prev.abortedAt } : {}),
  }
  writeFileSync(marker, `${JSON.stringify(rec, null, 2)}\n`, 'utf8')
  emit({
    ok: true,
    project: positional[0],
    dir,
    marker,
    record: rec,
    lines: [
      `✓ 已落中止标记 → ${marker}${prev ? '（覆盖：此前已有中止记录）' : ''}`,
      '',
      '主控接下来必须做：',
      '  1. **在下一个门边界立即停下**，不再派发新角色（已落盘的产物一律保留，不删）；',
      '  2. 在 `status.md` 末行记一行「已中止（主人 CLI -abort）＋时间」，并把未完项列进 `进展-主人版.md`；',
      '  3. 交付件保持原样：中止不是回滚，账本/门记录/证据包都不动（删产物会让 A7 对不上）。',
    ],
  })
}

// ── list ───────────────────────────────────────────────────────────────────
const doList = () => {
  if (!existsSync(runDir)) die(`run 目录不存在：${runDir}`, 20)
  const rows = []
  for (const name of readdirSync(runDir)) {
    const dir = join(runDir, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    if (!isPathInsideRunDir(runDir, dir)) continue
    const gates = PHASES.filter((p) => existsSync(join(dir, '阶段确认-' + p + '.md')))
    const aborted = existsSync(join(dir, 'audits', 'abort.json'))
    let receipts = 0
    const ledger = join(dir, 'audits', 'gate-receipts.jsonl')
    if (existsSync(ledger)) receipts = readFileSync(ledger, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length
    rows.push({ project: name, gates, receipts, aborted })
  }
  rows.sort((a, b) => a.project.localeCompare(b.project))
  emit({
    ok: true,
    runDir,
    projects: rows,
    lines: [
      `run/ 下 ${rows.length} 个项目（${runDir}）`,
      ...rows.map((r) => `  ${r.aborted ? '⛔' : '  '} ${r.project}  门 ${r.gates.length}/4  回执 ${r.receipts}`),
    ],
  })
}

// ── 分派 ───────────────────────────────────────────────────────────────────
if (verb === 'gate') doGate()
else if (verb === 'abort') doAbort()
else if (verb === 'list') doList()
else die(`未知子命令：${verb || '(空)'}（gate / abort / list）`)
