#!/usr/bin/env node
// 论衡派发前 preflight（v18.95.0 反哺 E2 新增）
// 用法：node preflight.mjs <项目目录> [--source <正文路径>] [--report <path>]
// 定位：把「派发前的多个机械动作」合并成一次只读调用，产出统一 JSON——
//   ① 机检契约（m-gate-check 的 pass:false 项 + gate/detail，供主控反注派发话术）
//   ② 三件硬核验值（正文 sha256 前 8 位 / 证据包 auditTarget 是否最新 / 图位清单）
//   ③ 字数（count-chars 正文区纯汉字数）
//   主控据此一次拿到全部派发前置信息，不再逐次跑门（E2：主控亲跑合并，防动作堆叠无预算）。
// 退出码：0 = 完成 / 10 = 参数或路径错 / 70 = 内部错误（与 M 门 1/2/3 刻意分离）。
// 边界（如实）：
//   · 本脚本是**聚合观测器**，不是闸门——机检契约/硬核验值只供主控反注派发话术；
//     闸门结论仍以 m-gate-check / handoff-check 各自为准，本脚本不改任何退出码语义。
//   · 证据包未生成时，机检契约标 `unavailable`（不是 N/A，也不是失败），主控据阶段决定是否先建包。
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { installExitGuard, requireExistingDir } from './_lib/exit-guard.mjs'

installExitGuard()

const SCRIPTS = fileURLToPath(new URL('.', import.meta.url))
const NODE = process.execPath

// --- CLI ---
const argv = process.argv.slice(2)
let project = null
let sourceArg = null
let reportPath = null
const USAGE = '用法: node preflight.mjs <项目目录> [--source <正文路径>] [--report <path>]'
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--source' || a === '--report') {
    const v = argv[++i]
    if (!v || v.startsWith('--')) { console.error(`${a} 缺少值\n${USAGE}`); process.exit(10) }
    if (a === '--source') sourceArg = v; else reportPath = v
  } else if (a.startsWith('--')) {
    console.error(`未知参数: ${a}\n${USAGE}`); process.exit(10)
  } else if (project === null) {
    project = a
  } else {
    console.error(`多次传入项目参数: ${a}\n${USAGE}`); process.exit(10)
  }
}
if (!project) { console.error(USAGE); process.exit(10) }
if (!existsSync(project)) { console.error(`项目目录不存在: ${project}`); process.exit(10) }
requireExistingDir(project, '项目目录')

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

// 定位正文（--source > final/定稿.md > drafts/ 最高版本）
const latestDraft = (() => {
  const d = join(project, 'drafts')
  if (!existsSync(d)) return null
  let best = null
  for (const f of readdirSync(d)) {
    const m = f.match(/^初稿-v(\d+)\.md$/)
    if (m && (!best || Number(m[1]) > best.n)) best = { path: join(d, f), name: f, n: Number(m[1]) }
  }
  return best
})()
const finalDraft = join(project, 'final', '定稿.md')
const draftPath = sourceArg || (existsSync(finalDraft) ? finalDraft : (latestDraft ? latestDraft.path : null))
if (!draftPath || !existsSync(draftPath)) {
  console.error(`找不到被审正文（--source / final/定稿.md / drafts/初稿-vN.md）: ${project}`)
  process.exit(10)
}

const tmpDir = mkdtempSync(join(tmpdir(), 'lunheng-pf-'))
const cleanup = () => rmSync(tmpDir, { recursive: true, force: true })

// ① 机检契约（m-gate-check --report 临时文件，只读 pass:false 的项）
let gateContract = null
const ev = join(project, 'final', '证据包')
if (existsSync(ev)) {
  const out = join(tmpDir, 'mgate.json')
  const r = spawnSync(NODE, [join(SCRIPTS, 'm-gate-check.mjs'), draftPath, ev, '--report', out], { stdio: 'ignore', timeout: 120000 })
  const j = readJson(out)
  if (j && Array.isArray(j.results)) {
    const fails = j.results.filter((x) => x.pass === false)
    gateContract = {
      exit: j.exit, pass: j.pass, total: j.total, p0: j.p0 ?? 0, p1: j.p1 ?? 0, p2: j.p2 ?? 0,
      fails: fails.map((x) => ({ gate: x.gate, severity: x.severity, detail: x.detail })),
    }
  } else {
    gateContract = { unavailable: true, reason: `m-gate-check 未产出可解析结果（status=${r.status}）——修复后重跑` }
  }
} else {
  gateContract = { unavailable: true, reason: '证据包未生成（final/证据包 不存在）——机检契约暂不可取，先跑 build-evidence-bundle' }
}

// ② 正文 sha256 前 8 位
const text = readFileSync(draftPath, 'utf8')
const sha8 = createHash('sha256').update(text).digest('hex').slice(0, 8)

// ③ 证据包状态（manifest 是否在盘 + auditTarget 是否指向本稿）
let bundle = null
const manifestPath = join(ev, 'manifest.json')
if (existsSync(manifestPath)) {
  const m = readJson(manifestPath)
  bundle = {
    manifest: true,
    auditTarget: (m && m.auditTarget) || null,
    auditTargetStale: !!(m && m.auditTarget && !m.auditTarget.includes(basename(draftPath))),
    zeroByteSrcs: (m && m.zeroByteSrcs) || [],
    sizeMismatch: (m && m.sizeMismatch) || [],
  }
} else {
  bundle = { manifest: false, reason: '无 manifest.json（证据包未生成或未刷新）' }
}

// ④ 图位清单（正文里 [图N：标题] 独占行）
const figures = [...text.matchAll(/\[图(\d+)[：:]\s*([^\]]+)\]/g)].map((m) => ({ id: Number(m[1]), title: m[2].trim() }))

// ⑤ 字数（count-chars 默认正文区，JSON 到 stdout）
let charCount = null
const cc = spawnSync(NODE, [join(SCRIPTS, 'count-chars.mjs'), draftPath], { timeout: 60000 })
if (cc.status === 0) {
  try {
    const cj = JSON.parse(cc.stdout.toString())
    charCount = { hanChars: cj.hanChars, scope: cj.scope, degraded: cj.degraded }
  } catch { /* 落到 unavailable */ }
}
if (charCount === null) charCount = { unavailable: true, reason: `count-chars 未跑通（exit ${cc.status}）` }

cleanup()

const result = {
  preflight: 'v19.1.6',
  draft: { path: draftPath, name: basename(draftPath), sha256_8: sha8, bytes: Buffer.byteLength(text) },
  gateContract,
  bundle,
  figures,
  charCount,
  notScope: '本脚本是派发前聚合观测器，不是闸门——机检契约/硬核验值只供主控反注派发话术；M 门 exit 仍以 m-gate-check 为准，本脚本不改任何退出码语义',
}

if (reportPath) {
  const { writeReport } = await import('./_lib/destructive-write.mjs')
  writeReport(reportPath, JSON.stringify(result, null, 2) + '\n', { protect: [draftPath] })
} else {
  console.log(JSON.stringify(result, null, 2))
}
process.exit(0)
