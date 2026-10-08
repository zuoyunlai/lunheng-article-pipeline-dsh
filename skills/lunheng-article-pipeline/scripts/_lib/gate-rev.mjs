// gate-rev.mjs — **门版本指纹**（v18.81.0 · 独立审计批 1.2）
//
// 为什么需要它（实测病灶，不是假想）：
//   `final/M-Gate-Report.json` 只绑定**被审正文指纹**（`verdict_scope.draft_sha256`），
//   **不绑定门版本**。后果实测：`run/夫妻收入差异家庭权力` 的同一份 `final/定稿.md`
//   （sha256 `01b89282…`，逐字节未变）在 2026-09-30 的报告里是 `p0=0 / p1=0 / p2=5`，
//   而用当前脚本复跑得 `p0=2 / p1=1 / p2=1`。报告的 `verdict_stale` 仍是 `false`
//   （因为它的判据只看正文指纹），于是**同一份产物上的两个门读数无法被任何字段区分**：
//   读报告的人无法回答「这是按旧门交的，还是漏跑了」。
//   判据：**跨门版本的可比性必须由产物自己声明**——报告里没有版本号，比较就永远是猜。
//
// 口径（单一真源，禁止第二份实现）：
//   `gate_rev` = 对 `<scriptDir>/**/*.mjs`（含 `scripts/_lib/**`，含门族 `_lib/mgate-gates/**`）
//   按**仓库相对路径排序**后，逐文件喂 `relPath \0 sha256(content) \0`，取整体 sha256 的**前 12 位**。
//   · 为什么把 `_lib/**` 全含进来：门族与共享库的改动**会改变门的判定**（如 `sections.mjs` 的
//     正文区边界、`refs.mjs` 的编号口径），只哈希 `m-gate-check.mjs` 本身会漏掉绝大多数真改动。
//   · 为什么是**内容哈希**而不是「语义版本号」：版本号是人写的、会忘（本仓已有 N 处口径漂移先例），
//     内容哈希不会撒谎。代价是**注释改动也会抬 rev**——这是刻意的保守方向。
//   · 12 位十六进制 = 48 bit，用于「区分本仓自己的两次提交」足够；它不是安全边界。
//
// 边界（如实声明）：
//   ① 本函数**只读**，不写盘、不联网、不 spawn。
//   ② 它**不判断改动是否重要**——「注释改了」与「判定逻辑改了」都会抬 rev。判定重要性属语义，
//      刻意不下沉（与本仓「判断力项刻意不下沉」同一条判据）。
//   ③ 消费侧（`m-gate-check.mjs`）对**旧报告缺 `gate_rev`** 的情形**不翻 stale**，只标
//      `gate_rev_absent`（legacy 容忍：无法证明不可比时，不说它不可比）。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'

/** rev 取多少位十六进制（48 bit） */
export const GATE_REV_CHARS = 12
/** 报告里的字段名（单一真源：消费侧不得硬写字面量） */
export const GATE_REV_FIELD = 'gate_rev'

function listMjs(dir, out) {
  if (!existsSync(dir)) return out
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') listMjs(p, out); continue }
    if (e.isFile() && e.name.endsWith('.mjs')) out.push(p)
  }
  return out
}

/**
 * 计算门版本指纹。
 * @param {string} scriptDir `<pkg>/skills/lunheng-article-pipeline/scripts` 的绝对路径
 * @returns {{rev: string, fileCount: number, algorithm: string}}
 */
export function computeGateRev(scriptDir) {
  const files = listMjs(scriptDir, []).sort()
  const h = createHash('sha256')
  for (const f of files) {
    const rel = relative(scriptDir, f).split(sep).join('/')
    h.update(rel); h.update('\0')
    try { h.update(createHash('sha256').update(readFileSync(f)).digest('hex')) }
    catch { h.update('UNREADABLE') }   // 读不动就明确喂一个常量，不静默跳过（否则该文件的变化会被吞掉）
    h.update('\0')
  }
  return { rev: h.digest('hex').slice(0, GATE_REV_CHARS), fileCount: files.length, algorithm: 'sha256(sorted relPath + per-file sha256), first 12 hex' }
}
