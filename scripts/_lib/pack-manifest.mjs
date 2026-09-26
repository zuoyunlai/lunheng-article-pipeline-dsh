// `npm pack --dry-run --json` 输出的**单点解析器**（v18.20.4 · 二次复审 M-2 / O-3）。
//
// 为什么必须单点（O-3：同一事实的解析只允许一处实现）：
//   `npm pack --json` 的**顶层形态随 npm 大版本变**——
//     · npm ≤ 11（Node 22.19 / 24）：顶层是**数组** `[ { files: [...] } ]`
//     · npm 12（Node 26）：顶层是**对象** `{ "«name»-«ver».tgz": { files: [...] } }`
//   旧实现 `JSON.parse(stdout.slice(stdout.indexOf('[')))[0].files` 在对象形态下**必抛**
//   （`indexOf('[')` 落在 `"files": [` 处 → 切出 `[...] } }` → "Unexpected non-whitespace
//   character after JSON"）。实测（2026-09-26）它造成三处连锁：
//     ① `⑥ 发布面`红（可以接受——响亮失败）；
//     ② **`⑦b` 在空集上真空打印「发布物 0 处（须为 0）」合格字样**（不可接受——失败路径输出合格，
//        与首轮 D-2「凭据扫描照绿」同构，而 ⑦b 正是为防 D-2 复发才加的）；
//     ③ 3 处测试的就地解析 `catch { return }` 把 TypeError 当「环境不可用」吞掉 → 用例报 ✔（静默 pass）。
//
// 设计口径（O-2：三态 PASS / FAIL / UNKNOWN）：
//   · **形状不认识就抛错并指名**——照 `_lib/exit-namespace.mjs` 的「形状变了会抛错而非静默通过」正例；
//   · 调用方据错误**分流**：`isPackEnvUnavailable(err)` 为真 → 环境不可用（测试可 `skip`）；
//     否则（JSON 非法 / 形状不认识）→ **照抛**，绝不当「环境不可用」吞掉；
//   · 门侧：解析失败 → `packFiles = null`（UNKNOWN），**不得**当作「发布物 0 处」合格。
import { execSync } from 'node:child_process'

/** 判定「形状不认识」类错误（与「环境不可用」相对）。 */
export class PackManifestShapeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PackManifestShapeError'
  }
}

/**
 * 从 `npm pack --dry-run --json` 的 stdout 解析出「文件清单 + 解包字节」。
 * @param {string} stdout - 子进程输出（数组或对象形态均可）。
 * @returns {{ files: string[], unpackedSize: number }}
 * @throws {PackManifestShapeError} 输出为空 / 非 JSON / 顶层非数组非对象 / 缺 `.files` 数组 / 对象键数 ≠ 1。
 */
export function parsePackManifest(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) throw new PackManifestShapeError('npm pack --json 输出为空')
  let raw
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new PackManifestShapeError(`npm pack --json 不是合法 JSON：${e.message}`)
  }
  let entry
  if (Array.isArray(raw)) {
    entry = raw[0] // npm ≤ 11
  } else if (raw && typeof raw === 'object') {
    const keys = Object.keys(raw)
    if (keys.length !== 1) {
      throw new PackManifestShapeError(`npm pack --json 对象形态期望恰好 1 个 tarball 键，实得 ${keys.length}（${keys.slice(0, 3).join(' / ')}）`)
    }
    entry = raw[keys[0]] // npm 12+
  } else {
    throw new PackManifestShapeError(`npm pack --json 顶层既非数组也非对象：${typeof raw}`)
  }
  if (!entry || !Array.isArray(entry.files)) {
    throw new PackManifestShapeError(`npm pack --json 的 tarball 条目里没有 \`.files\` 数组（键：${entry && typeof entry === 'object' ? Object.keys(entry).slice(0, 6).join(' / ') : String(entry)}）`)
  }
  return {
    files: entry.files.map((f) => f && f.path).filter(Boolean),
    unpackedSize: Number(entry.unpackedSize ?? 0),
  }
}

/** 跑 `npm pack --dry-run --json` 并解析（`cwd` 必须是包根）。任何非零退出 / 解析失败都**抛错**。 */
export function readPackManifest(cwd, execOpts = {}) {
  const out = execSync('npm pack --dry-run --json', {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
    ...execOpts,
  })
  return parsePackManifest(out)
}

/**
 * 错误是否属于「**环境不可用**」——沙箱禁子进程（`EPERM`）/ npm 不存在（`ENOENT`）/ 权限（`EACCES`）。
 * 只有这一类才允许调用方 `skip`；`PackManifestShapeError`（形状不认识）**不属于**，必须照抛。
 * @param {unknown} err
 * @returns {boolean}
 */
export function isPackEnvUnavailable(err) {
  const code = err?.code ?? err?.cause?.code
  return code === 'ENOENT' || code === 'EPERM' || code === 'EACCES'
}
