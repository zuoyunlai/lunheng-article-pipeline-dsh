// session-log.mjs — **DSH 会话日志读取**（v18.81.0 · 独立审计批 1.4）
//
// 为什么需要它：论衡多处机制把「会话日志」当作**独立于 agent 的记录源**，但此前**没有任何代码读过它**
//   （`token-cost.mjs` 只读 `session_projcache` 的**聚合投影**，读不到工具调用参数）。
//   而本轮实测证实了两件关键事实：
//     ① `tool/call` 事件逐次记录**工具名 + arguments 原文**（实测样本 1128 次调用：pwsh 501 / edit 275 /
//        read 135 / ...）→ 「某会话读过哪些文件」是**可机械核对**的；
//     ② `ask_user_question` 的**答复**以 `tool/result` 回来，`data.message.toolCallId` 与调用同号，
//        正文是结构化 JSON `{"answers":[{"id":…,"selected":[…]}]}`（实测样例，调用→答复间隔 51 s）。
//   ⇒ 人门口回执可以**不依赖主控自述**地被验证。这正好补上批 1.1 如实登记的边界
//     （「账本由主控写入，不是独立记录」）。
//
// 口径与边界（如实声明）：
//   · 只读：不联网、不写盘、不 spawn。
//   · **只依赖「`session.v<N>.jsonl.zstd` 前缀/后缀」**，不写死版本号——宿主升级会漂移
//     （`token-cost.mjs` 头注释记过同一教训：写死 v3 而宿主已落 v4）。
//   · 多帧 zstd：活会话按帧落盘，须**逐帧解并拼接**（`zstdDecompressSync` 对多帧会只解第一帧或抛错）。
//   · 非 zstd（`.jsonl`）直接按文本读——测试夹具用这条路径，避免测试依赖压缩实现。
//   · 本模块**不判断**「读了某文件算不算违规」——禁忌面由调用方给（判断力不下沉的同一条判据）。
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

/** 多帧 zstd → utf8 文本；非 zstd 文件直接读。 */
export function readSessionText(filePath) {
  const buf = readFileSync(filePath)
  if (!(buf.length > 4 && ZSTD_MAGIC.every((b, i) => buf[i] === b))) return buf.toString('utf8')
  const parts = []
  let off = 0
  while (off < buf.length) {
    let end = buf.length
    for (let i = off + 4; i <= buf.length - 4; i++) {
      if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) { end = i; break }
    }
    try { parts.push(zstdDecompressSync(buf.subarray(off, end)).toString('utf8')) } catch { /* 坏帧：跳过该帧，不吞整文件 */ }
    if (end >= buf.length) break
    off = end
  }
  return parts.join('')
}

/** 解析为事件数组（逐行 JSON；坏行跳过并计数，不静默）。 */
export function parseEvents(text) {
  const events = []
  let badLines = 0
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try { events.push(JSON.parse(t)) } catch { badLines++ }
  }
  return { events, badLines }
}

/** 递归找出会话目录下的 `session.v<N>.jsonl.zstd` / `session*.jsonl`。 */
export function findSessionFiles(root) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 4) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (/^session\.v\d+\.jsonl\.zstd$/.test(e.name) || /^session.*\.jsonl$/.test(e.name)) out.push(p)
    }
  }
  if (!existsSync(root)) return out
  try { if (statSync(root).isFile()) return [root] } catch { return out }
  walk(root, 0)
  return out.sort()
}

/**
 * 把 `ask_user_question` 的调用与答复**按 callId 配对**。
 * 事件形态（实测，v4 会话日志）：
 *   call   : { type:'tool/call',   data:{ callId, name:'ask_user_question', arguments:'{"questions":[…]' } }
 *   result : { type:'tool/result', data:{ message:{ toolCallId, content:[{type:'text',text:'{"answers":[…]'}] } } } }
 * @returns {{pairs: Array, callOnly: Array, resultOnly: number}}
 */
export function pairAskUserQuestion(events) {
  const calls = new Map()
  const results = new Map()
  for (const e of events) {
    const d = e && e.data
    if (!d) continue
    if (e.type === 'tool/call' && d.name === 'ask_user_question' && d.callId) calls.set(d.callId, { callId: d.callId, time: e.time, arguments: d.arguments })
    if (e.type === 'tool/result') {
      const cid = d.message?.toolCallId
      if (cid && calls.has(cid)) {
        const text = (d.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
        let answers = null
        try { answers = JSON.parse(text).answers ?? null } catch { answers = null }
        results.set(cid, { callId: cid, time: e.time, answers, rawText: text })
      }
    }
  }
  const pairs = []
  const callOnly = []
  for (const [cid, c] of calls) {
    const r = results.get(cid)
    if (!r) { callOnly.push(c); continue }
    let questions = null
    try { questions = JSON.parse(c.arguments || '{}').questions ?? null } catch { questions = null }
    pairs.push({
      callId: cid, time: c.time, questions, answers: r.answers, rawText: r.rawText, resultTime: r.time,
      selected: Array.isArray(r.answers) ? r.answers.flatMap((a) => a.selected || []) : [],
    })
  }
  return { pairs, callOnly, resultOnly: results.size }
}

/** 「这个会话碰过哪些路径」——read/write/edit/glob/grep 的路径参数 + pwsh 命令原文。 */
export function collectTouched(events) {
  const touched = []
  const PATH_KEYS = ['file_path', 'path', 'source', 'file', 'dir', 'directory']
  for (const e of events) {
    if (e?.type !== 'tool/call') continue
    const d = e.data || {}
    let args = {}
    try { args = typeof d.arguments === 'string' ? JSON.parse(d.arguments) : (d.arguments || {}) } catch { args = {} }
    if (d.name === 'pwsh' || d.name === 'bash') {
      touched.push({ tool: d.name, time: e.time, kind: 'command', value: String(args.command || '') })
      continue
    }
    for (const k of PATH_KEYS) {
      if (typeof args[k] === 'string' && args[k]) touched.push({ tool: d.name, time: e.time, kind: k, value: args[k] })
    }
    if (typeof args.pattern === 'string' && args.pattern) touched.push({ tool: d.name, time: e.time, kind: 'pattern', value: args.pattern })
  }
  return touched
}

/** 便捷入口：路径/目录 → 全部会话文件 → 事件（合并）。 */
export function loadSessions(target, { sessionRoot = null } = {}) {
  const files = []
  if (sessionRoot && !existsSync(target)) {
    for (const f of findSessionFiles(sessionRoot)) if (basename(f).includes(String(target))) files.push(f)
  } else {
    for (const f of findSessionFiles(target)) files.push(f)
  }
  const events = []
  const perFile = []
  for (const f of files) {
    const r = parseEvents(readSessionText(f))
    perFile.push({ file: f, events: r.events.length, badLines: r.badLines })
    events.push(...r.events)
  }
  return { files, perFile, events }
}
