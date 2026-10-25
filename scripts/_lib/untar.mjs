// untar.mjs —— `pack-smoke` 的**内置解包器**（v19.27.12 · 2026-10-25 发版实测）
//
// **为什么存在**：`pack-smoke` 一直用系统 `tar -xzf` 解发布物。2026-10-20 起
//   `pack-smoke (windows-latest)` 偶发 `tar: Archive entry has empty or unreadable filename ... skipping`
//   → exit 1 → 整个 `ci.yml` 红 → 连带 `publish.yml` 的「同 SHA CI 绿闸」fail-closed，发版被卡住。
//   实测事实（2026-10-25）：同一个 tgz 在 ubuntu / macOS / 本机 GNU tar 1.35 都能正常解开，
//   `tar -tzf` 逐条一致、`gzip -t` 通过，与上一发布 tag 的包**只差一个新增文件**（212→213 条）——
//   即**包是好的，跑者的 tar 有毛病**，且重跑 2 次（共 3 次）全红，靠 rerun 碰运气不可接受。
//
// 所以：`tar` 仍是首选路径（Linux/macOS 用系统实现，零风险），只有在它失败时才用本模块兜底。
//   **兜底不降低门的强度**——解出来的文件仍要过 `pack-smoke` 的全部断言（关键文件齐备 / `lib/*.js`
//   与真源逐一对齐 / 发布面裁剪 / 入口 apply 真跑 / frontmatter 剥离）。
//
// 支持范围（够用即可，不追求完整 tar 实现）：
//   · ustar 常规条目（name+prefix 拼接）、目录、普通文件；
//   · `L`（GNU 长文件名）/ `x` `g`（PAX 扩展头，取 `path=`）；
//   · 校验和逐块验证（坏块直接抛错，不静默产出错文件）；
//   · 安全：拒绝绝对路径、`..` 段、符号链接/硬链接（跳过并计数）。
// 不支持：稀疏文件、大文件 base-256 size（>8 GiB）、加密——发布物不会出现这些形态。

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'

const BLOCK = 512

// 一个 tar 数字字段：八进制 + NUL/空格填充；个别实现用 base-256（首字节高位）表示大数。
function readNum(buf, off, len) {
  if (buf[off] & 0x80) {
    let n = 0
    for (let i = 1; i < len; i++) n = n * 256 + buf[off + i]
    return n
  }
  const s = buf.subarray(off, off + len).toString('latin1').replace(/\0.*$/, '').trim()
  return s ? parseInt(s, 8) : 0
}

function readStr(buf, off, len) {
  const raw = buf.subarray(off, off + len)
  const nul = raw.indexOf(0)
  return raw.subarray(0, nul === -1 ? raw.length : nul).toString('utf8')
}

function verifyChecksum(block) {
  const stored = readNum(block, 148, 8)
  if (!stored) return true // 全零块（归档结尾）不算错
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]
  return sum === stored
}

// PAX 扩展头：若干条 `"<长度> key=value\n"`，长度含自身
function parsePax(body) {
  const out = {}
  let i = 0
  while (i < body.length) {
    const sp = body.indexOf(0x20, i)
    if (sp === -1) break
    const len = parseInt(body.subarray(i, sp).toString('latin1'), 10)
    if (!Number.isFinite(len) || len <= 0) break
    const rec = body.subarray(sp + 1, i + len - 1).toString('utf8') // 去掉尾部 \n
    const eq = rec.indexOf('=')
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1)
    i += len
  }
  return out
}

// 安全判定：只接受「相对、无 .. 段」的路径，且统一成当前平台分隔符
function safeTarget(destDir, name) {
  const flat = name.replace(/\\/g, '/')
  if (!flat || flat.startsWith('/') || /^[A-Za-z]:/.test(flat)) throw new Error(`拒绝绝对路径条目：${name}`)
  const parts = flat.split('/').filter((p) => p && p !== '.')
  if (parts.includes('..')) throw new Error(`拒绝越界条目（含 ..）：${name}`)
  const target = normalize(join(destDir, ...parts))
  const root = normalize(destDir)
  if (target !== root && !target.startsWith(root + sep)) throw new Error(`拒绝越界条目：${name}`)
  return target
}

/**
 * 解开 `.tgz` Buffer 到 destDir。
 * @returns {{files:number, dirs:number, skipped:number, entries:string[]}}
 */
export function untarGz(gzBuffer, destDir) {
  const buf = gunzipSync(gzBuffer)
  const result = { files: 0, dirs: 0, skipped: 0, entries: [] }
  let off = 0
  let pendingLongName = null
  let pendingPax = null

  while (off + BLOCK <= buf.length) {
    const header = buf.subarray(off, off + BLOCK)
    off += BLOCK
    if (header.every((b) => b === 0)) break // 归档结尾
    if (!verifyChecksum(header)) throw new Error(`tar 头校验和不对（偏移 ${off - BLOCK}）——发布物可能被截断`)

    const type = String.fromCharCode(header[156] || 0x30)
    const size = readNum(header, 124, 12)
    const bodyLen = Math.min(size, Math.max(0, buf.length - off))
    const body = buf.subarray(off, off + bodyLen)
    off += Math.ceil(size / BLOCK) * BLOCK

    if (type === 'L') { pendingLongName = readStr(body, 0, bodyLen).replace(/\0+$/, ''); continue }
    if (type === 'x' || type === 'g') { pendingPax = { ...(pendingPax || {}), ...parsePax(body) }; continue }

    const rawName = pendingLongName
      || pendingPax?.path
      || [readStr(header, 345, 155), readStr(header, 0, 100)].filter(Boolean).join('/')
    pendingLongName = null
    pendingPax = null

    if (type === '1' || type === '2' || type === '3' || type === '4' || type === '6') { result.skipped++; continue }
    if (!rawName) throw new Error('tar 条目名为空（正是 Windows 跑者报的那种坏头）')

    const target = safeTarget(destDir, rawName)
    if (type === '5' || rawName.endsWith('/')) {
      mkdirSync(target, { recursive: true })
      result.dirs++
      result.entries.push(rawName)
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body.subarray(0, size))
    result.files++
    result.entries.push(rawName)
  }
  if (result.files === 0) throw new Error('内置解包器没解出任何文件（归档为空或格式不支持）')
  return result
}
