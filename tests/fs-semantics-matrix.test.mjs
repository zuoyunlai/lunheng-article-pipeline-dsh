// 文件系统语义矩阵（v18.80.4 · 审计优化方向 8 落地 · 批 A）
//
// **为什么需要**（审计依据）：本批修的两处越界（P1-1 叶文件 symlink、P1-6 硬链接）**都是先有真实绕过、
//   后补单点用例**。判据是：**路径围栏必须按文件系统语义成矩阵地测**——目录软链、叶文件软链、硬链接、
//   junction、大小写变体、相对/绝对混写，各自是**不同的绕过面**，修了 A 不等于修了 B。
//   本文件把矩阵固化：`run-path-fence`（三层收口）+ `destructive-write`（同文件判定）。
//
// **环境能力探测（不假装能测）**：文件软链在 Windows 需管理员/开发者模式；目录 junction 在同一卷上
//   通常无需特权。能力不足的**子用例带理由跳过**（`ℹ skipped` 可见），不静默删除强度。
//
// **边界（如实）**：本矩阵在**本机 Windows + Node 24.20** 实测；Linux/macOS 的对应面（如 case-sensitive
//   文件系统、`O_NOFOLLOW`）未实测——跨平台差异由 CI 的其它平台作业覆盖，本文件只保证**判据在语义上
//   成矩阵**，不声称跨平台已验证。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const imp = (p) => import(pathToFileURL(p).href)
const fence = await imp(join(ROOT, 'lib', 'run-path-fence.mjs'))
const dw = await imp(join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', '_lib', 'destructive-write.mjs'))

const mk = (prefix) => {
  const d = join(tmpdir(), `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(join(d, 'run', 'proj'), { recursive: true })
  mkdirSync(join(d, 'outside'), { recursive: true })
  return d
}

const canFileSymlink = (() => {
  const d = mk('lh-fs-sym')
  try {
    writeFileSync(join(d, 'a'), 'x')
    symlinkSync(join(d, 'a'), join(d, 'a.link'))
    return true
  } catch { return false } finally { rmSync(d, { recursive: true, force: true }) }
})()
const canDirJunction = (() => {
  const d = mk('lh-fs-junc')
  try {
    symlinkSync(join(d, 'outside'), join(d, 'run', 'junc'), 'junction')
    return true
  } catch { return false } finally { rmSync(d, { recursive: true, force: true }) }
})()
const canHardlink = (() => {
  const d = mk('lh-fs-hard')
  try {
    writeFileSync(join(d, 'a'), 'x')
    linkSync(join(d, 'a'), join(d, 'b'))
    return true
  } catch { return false } finally { rmSync(d, { recursive: true, force: true }) }
})()

// ── ① 词法层：项目名不得含分隔符 / 绝对路径 / 点段 ─────────────────────────────
test('矩阵 ① 词法层：isSafeProjectArg 拒绝分隔符/绝对路径/点段，接受单段名', () => {
  for (const bad of ['..', '.', '', '  ', 'a/b', 'a\\b', 'C:\\x', '/abs', '../x']) {
    assert.equal(fence.isSafeProjectArg(bad), false, `必须拒绝：${JSON.stringify(bad)}`)
  }
  for (const ok of ['proj', 'demo-1', '中文项目']) {
    assert.equal(fence.isSafeProjectArg(ok), true, `必须接受：${ok}`)
  }
})

// ── ② 结构层：直接子目录才算，孙目录不算 ─────────────────────────────────────
test('矩阵 ② 结构层：isDirectChildOf 只认直接子目录（孙目录/外部一律 false）', () => {
  const d = mk('lh-fs-struct')
  try {
    const runDir = join(d, 'run')
    mkdirSync(join(runDir, 'proj', 'drafts'), { recursive: true })
    assert.equal(fence.isDirectChildOf(runDir, join(runDir, 'proj')), true, '直接子目录应通过')
    assert.equal(fence.isDirectChildOf(runDir, join(runDir, 'proj', 'drafts')), false, '孙目录不得通过（防多级穿越）')
    assert.equal(fence.isDirectChildOf(runDir, join(d, 'outside')), false, 'run 外不得通过')
    assert.equal(fence.isDirectChildOf(runDir, runDir), false, 'run 自身不是「直接子目录」')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── ③ 物理层（目录 junction/软链）：run/<链接> 指向外部必须被拦 ────────────────
test('矩阵 ③ 物理层：run/ 内的目录链接指向外部 → 路径围栏拒绝（junction 不可用则跳过）', { skip: canDirJunction ? false : '本机无法创建目录 junction/软链——环境不支持，带理由跳过' }, () => {
  const d = mk('lh-fs-phys')
  try {
    const runDir = join(d, 'run')
    symlinkSync(join(d, 'outside'), join(runDir, 'escape'), 'junction')
    writeFileSync(join(d, 'outside', 'secret.md'), 'SECRET')
    assert.equal(fence.isPathInsideRunDir(runDir, join(runDir, 'escape', 'secret.md')), false,
      '经 junction 解析到 run 外 → 必须判「不在 run 内」（否则宿主权限脚本可越界读）')
    assert.equal(fence.resolveProjectDir(runDir, 'escape'), null,
      '指向 run 外的项目目录链接不得被解析为合法项目（三层收口物理层）')
    // 反向：真实子目录仍必须通过（防收紧到过严）
    mkdirSync(join(runDir, 'real'), { recursive: true })
    assert.equal(fence.resolveProjectDir(runDir, 'real'), join(runDir, 'real'), '正常项目目录必须仍可解析')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── ④ 物理层（叶文件软链）：文件本身指向外部必须被识别 ─────────────────────────
test('矩阵 ④ 叶文件软链：isPathInsideRunDir 对「链接到 run 外的文件」判 false（软链不可用则跳过）', { skip: canFileSymlink ? false : '本机无文件软链权限（EPERM）——环境不支持，带理由跳过' }, () => {
  const d = mk('lh-fs-leaf')
  try {
    const proj = join(d, 'run', 'proj')
    writeFileSync(join(d, 'outside', 'secret.md'), 'SECRET')
    symlinkSync(join(d, 'outside', 'secret.md'), join(proj, 'status.md'))
    assert.equal(fence.isPathInsideRunDir(proj, join(proj, 'status.md')), false,
      '叶文件经 realpath 落在项目目录外 → 必须判 false（P1-1 的判据本体）')
    writeFileSync(join(proj, 'ok.md'), 'ok')
    assert.equal(fence.isPathInsideRunDir(proj, join(proj, 'ok.md')), true, '普通文件必须通过')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── ⑤ 同文件判定：相对写法 / 大小写变体 / 硬链接 ──────────────────────────────
test('矩阵 ⑤ sameFile：相对写法与（Windows）大小写变体判同文件；不同文件判不同', () => {
  const d = mk('lh-fs-same')
  try {
    const a = join(d, 'run', 'proj', '定稿.md')
    writeFileSync(a, 'x')
    assert.equal(dw.sameFile(a, a), true, '同一路径')
    assert.equal(dw.sameFile(a, join(d, 'run', 'proj', '.', '定稿.md')), true, '`./` 写法变体必须归一')
    if (process.platform === 'win32') {
      assert.equal(dw.sameFile(a, join(d, 'run', 'proj', '定稿.MD')), true, 'Windows 大小写不敏感：变体必须判同文件')
    }
    assert.equal(dw.sameFile(a, join(d, 'run', 'proj', '其他.md')), false, '不同文件不得误判')
    assert.equal(dw.sameFile(a, join(d, 'run', '不存在.md')), false, '不存在的路径不得抛错，判 false')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('矩阵 ⑥ 硬链接：sameFile 与 assertNotSameFile 都必须认（inode 语义，链接不可用则跳过）', { skip: canHardlink ? false : '本机不支持硬链接（linkSync 失败）——环境不支持，带理由跳过' }, () => {
  const d = mk('lh-fs-hard2')
  try {
    const a = join(d, 'run', 'proj', '定稿.md')
    const b = join(d, 'alias.md')
    writeFileSync(a, 'const')
    linkSync(a, b)
    assert.equal(dw.sameFile(a, b), true, '硬链接别名必须判同文件（P1-6 判据本体）')
    assert.throws(() => dw.assertNotSameFile(a, b), (e) => e && e.code === dw.SAME_FILE_CODE,
      'assertNotSameFile 必须抛 SameFileError（否则 writeReport 的源保护可被别名绕过覆盖真源）')
    // 反向：不同文件不得被误判（防收紧到过严——真实写入路径必须仍然可用）
    const c = join(d, 'run', 'proj', 'other.md')
    writeFileSync(c, 'y')
    assert.equal(dw.sameFile(a, c), false, '不同 inode 必须判不同')
    assert.doesNotThrow(() => dw.assertNotSameFile(a, c), '正常输出路径不得被误拒')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── ⑦ 组合：围栏 + 同文件判定必须在同一路径空间里工作（防只修一侧） ─────────────
test('矩阵 ⑦ 组合：合法项目内的输出路径既「在围栏内」又「不同于源文件」', () => {
  const d = mk('lh-fs-combo')
  try {
    const proj = join(d, 'run', 'proj')
    const src = join(proj, 'final', '定稿.md')
    mkdirSync(dirname(src), { recursive: true })
    writeFileSync(src, 'x')
    const out = join(proj, 'final', '定稿.html')
    assert.equal(fence.isPathInsideRunDir(join(d, 'run'), out), true, '合法输出必须在 run 内')
    assert.equal(dw.sameFile(src, out), false, '输出与源不同文件')
    assert.equal(existsSync(out), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
