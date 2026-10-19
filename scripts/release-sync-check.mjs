#!/usr/bin/env node
// release-sync-check.mjs — **三向同版核对**：源码 / 产物 / 发行（只读，v19.19.1 验收复现批 A-4）
// **仓库级脚本（不随包）**——与 dist-tag-check / no-write-check / closeout-verify 同类。
//
// 为什么存在（具体事故，2026-10-19 验收复现）：
//   v19.19.0 的 `sessionLog` / `sessionRoot` 在工具面**不可达**（读面围栏拦死），修法已在源码
//   v19.19.1 里落地且带回归测试——但 **npm latest 与已装 profile 都还是 19.19.0**。于是「验收通过」
//   这句话测的是**上一版产物**：源码绿 ≠ 产物绿。当时的验收只核了 loaded == onDisk（都 19.19.0），
//   没核 onDisk 与 git HEAD 的关系，所以「落后一版」在报告里看不出红。
//
// 判据（唯一决定退出码的一条）：**profile 已装版本 == 源码 package.json 版本**。
//   其余两向作为**证据列**呈现（git 断点态 / registry 发行态），默认不改退出码——因为「待发版」时
//   HEAD 领先 tag、registry 还没有本版本，都是**预期态**，把它们判红只会制造「习以为常的红」。
//   需要全绿判定时用 `--strict`（把证据列里的一切异常也计入失败）。
//
// 用法：
//   node scripts/release-sync-check.mjs                  # 三向（registry 走 --online 才查）
//   node scripts/release-sync-check.mjs --online         # 额外核对 npm dist-tags（需要网络）
//   node scripts/release-sync-check.mjs --strict         # 证据列异常也算失败
//   node scripts/release-sync-check.mjs --json
//   node scripts/release-sync-check.mjs --pkg <name> --profile <目录>
//
// 退出码：0 三向无「产物落后」（默认判据）／1 产物与源码不同版（或 --strict 下证据列异常）
//         ／10 用法或环境错（不是 git 仓库、读不到 package.json、registry 不可达）／70 内部错
//
// 边界（如实声明）：
//   · 它**不是发布门**：发布链自己会在 CI 里跑四道门 + 回归；本脚本回答的是「**你手上的产物是不是
//     源码那一版**」，属发版后 / 交付前的人工核对（同 dist-tag-check 的定位，刻意不进 CI）。
//   · 只读：不写盘、不改 dist-tag、不装包。提示里的命令**只打印不执行**。

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 纯函数：判定三向状态（便于单测，不碰 git / 网络 / 盘）。
 * @param {{pkgVersion: string, git: {state: string, ahead?: number, behind?: number, tag: string}, profile: {state: string, version?: string|null, path?: string}, registry?: {state: string, latest?: string|null, dsh?: string|null} | null}} state
 * @returns {{ok: boolean, problems: object[], warnings: object[], summary: string}}
 */
export function evaluate(state) {
  const { pkgVersion, git, profile, registry = null } = state
  const problems = []
  const warnings = []

  // 主判据：产物是否与源码同版
  if (profile.state === 'same') {
    // 同版，无问题
  } else if (profile.state === 'not-found') {
    problems.push({
      id: 'profile', kind: 'not-installed',
      detail: `未找到已装产物（试过 ${profile.tried || 0} 个候选位置）——无法核对「装的」与「改的」是否同版`,
    })
  } else {
    problems.push({
      id: 'profile', kind: 'drift',
      detail: `已装 ${profile.version ?? '（无版本）'} ≠ 源码 ${pkgVersion}` + (profile.path ? `（${profile.path}）` : ''),
    })
  }

  // 证据列：git 断点态（待发版 = 预期，不判红）
  if (git.state === 'behind') {
    warnings.push({ id: 'git', kind: 'behind', detail: `HEAD 落后于 tag ${git.tag}（${git.behind} 个提交）——tag 指向了未来的代码` })
  } else if (git.state === 'diverged') {
    warnings.push({ id: 'git', kind: 'diverged', detail: `HEAD 与 tag ${git.tag} 分叉（两者互不为祖先）` })
  } else if (git.state === 'ahead') {
    warnings.push({ id: 'git', kind: 'ahead', detail: `HEAD 领先 tag ${git.tag} ${git.ahead} 个提交 ⇒ **待发版**（源码改动尚未落 tag）` })
  } else if (git.state === 'no-tag') {
    warnings.push({ id: 'git', kind: 'no-tag', detail: `tag ${git.tag} 不存在 ⇒ **待发版**` })
  }

  // 证据列：registry（仅 --online）
  if (registry) {
    if (registry.state === 'same') {
      // 一致
    } else if (registry.state === 'missing') {
      warnings.push({ id: 'registry', kind: 'missing', detail: `registry 上还没有 ${pkgVersion} ⇒ **待发布**` })
    } else if (registry.state === 'newer') {
      warnings.push({ id: 'registry', kind: 'newer', detail: `registry 上有更高版本（latest=${registry.latest ?? '?'}、dsh=${registry.dsh ?? '?'}）` })
    } else {
      warnings.push({ id: 'registry', kind: 'drift', detail: `registry dist-tags 未指向 ${pkgVersion}（latest=${registry.latest ?? '（无）'}、dsh=${registry.dsh ?? '（无）'}）` })
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    summary: problems.length
      ? `${problems.length} 项「产物与源码不同版」`
      : '产物与源码同版',
  }
}

/** 解析 profile 里已装包的版本；返回 {state, version, path, tried}。缺目录 = not-found。 */
export function resolveProfileVersion(pkg, candidates) {
  let tried = 0
  for (const base of candidates) {
    tried++
    const p = join(base, 'node_modules', pkg, 'package.json')
    if (!existsSync(p)) continue
    try {
      const version = JSON.parse(readFileSync(p, 'utf8')).version ?? null
      return { state: 'found', version, path: p, tried }
    } catch {
      return { state: 'unreadable', version: null, path: p, tried }
    }
  }
  return { state: 'not-found', version: null, path: null, tried }
}

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** 读 git 断点态（at-tag / ahead / behind / diverged / no-tag）。 */
export function readGitState(pkgVersion) {
  const tag = `v${pkgVersion}`
  const has = (() => {
    try { return Boolean(git(['tag', '--list', tag])) } catch { return false }
  })()
  if (!has) return { state: 'no-tag', tag }
  const ref = `refs/tags/${tag}`
  let tagSha = ''
  try { tagSha = git(['rev-parse', '-q', '--verify', `${ref}^{commit}`]) } catch { return { state: 'no-tag', tag } }
  const headSha = git(['rev-parse', 'HEAD'])
  if (headSha === tagSha) return { state: 'at-tag', tag }
  const ahead = Number(git(['rev-list', '--count', `${ref}..HEAD`]) || 0)
  const behind = Number(git(['rev-list', '--count', `HEAD..${ref}`]) || 0)
  if (ahead > 0 && behind === 0) return { state: 'ahead', tag, ahead }
  if (behind > 0 && ahead === 0) return { state: 'behind', tag, behind }
  return { state: 'diverged', tag, ahead, behind }
}

/** 人类可读报告（含确切修复命令；只打印不执行）。 */
export function render(pkg, pkgVersion, gitState, profile, registry, result, strict) {
  const out = []
  out.push('# 三向同版核对（只读）')
  out.push('')
  out.push('| 面 | 实测 | 判据 |')
  out.push('| --- | --- | --- |')
  out.push(`| 源码 package.json | \`${pkgVersion}\` | 锚点 |`)
  const gitText = gitState.state === 'at-tag'
    ? `HEAD == tag ${gitState.tag}`
    : gitState.state === 'ahead'
      ? `HEAD 领先 ${gitState.tag} ${gitState.ahead} 个提交（待发版）`
      : gitState.state === 'behind'
        ? `HEAD 落后 ${gitState.tag} ${gitState.behind} 个提交`
        : gitState.state === 'diverged'
          ? `HEAD 与 ${gitState.tag} 分叉`
          : `tag ${gitState.tag} 不存在（待发版）`
  out.push(`| git 断点 | ${gitText} | 证据列 |`)
  out.push(`| profile 已装 | ${profile.version ?? '（未找到）'} | **主判据** |`)
  out.push(`| registry | ${registry ? `latest=${registry.latest ?? '（无）'} / dsh=${registry.dsh ?? '（无）'}` : '（未查，加 --online）'} | 证据列 |`)
  out.push('')
  if (result.ok && !(strict && result.warnings.length)) {
    out.push('✅ **产物与源码同版**' + (result.warnings.length ? `（${result.warnings.length} 条非阻塞提示见下）` : '。'))
  } else {
    out.push('❌ **不同版 / 有异常**：')
    for (const p of result.problems) out.push(`  - [${p.id}/${p.kind}] ${p.detail}`)
    if (strict) for (const w of result.warnings) out.push(`  - [${w.id}/${w.kind}] ${w.detail}（--strict 计入）`)
  }
  if (result.warnings.length && !strict) {
    out.push('')
    out.push('非阻塞提示（默认不改退出码；--strict 计入）：')
    for (const w of result.warnings) out.push(`  - [${w.id}/${w.kind}] ${w.detail}`)
  }
  if (result.problems.length) {
    out.push('')
    out.push('**修复（只打印，不执行）**：')
    out.push(`  dsh plugin --profile ${process.env.DSH_PROFILE || 'desktop'} add ${pkg}@${pkgVersion}`)
    out.push('  # 装完须**重启 GUI**（GUI 内的「更新」会误判 already-installed）')
  }
  return out.join('\n')
}

async function main(argv) {
  const args = argv.slice(2)
  const json = args.includes('--json')
  const online = args.includes('--online')
  const strict = args.includes('--strict')
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  const unknown = args.filter((a) => a.startsWith('--') && !['--json', '--online', '--strict', '--pkg', '--profile', '--help', '-h'].includes(a))
  if (unknown.length) { console.error(`未知参数：${unknown.join(', ')}`); process.exit(10) }
  if (args.includes('--help') || args.includes('-h')) { console.log(helpText()); return }

  const pkgPath = join(ROOT, 'package.json')
  let pj
  try { pj = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch (err) {
    console.error(`无法解析 ${pkgPath}：${err && err.message}`); process.exit(10)
  }
  const pkg = arg('--pkg') ?? pj.name
  const pkgVersion = pj.version
  if (!pkg || !pkgVersion) { console.error('缺少包名或版本（无法从 package.json 派生）'); process.exit(10) }

  let gitState
  try { gitState = readGitState(pkgVersion) } catch (err) {
    console.error(`不是 git 仓库或 git 不可用：${err && err.message}`); process.exit(10)
  }

  const profileDir = arg('--profile')
  const candidates = [
    profileDir,
    process.env.DSH_PROFILE_DIR,
    process.env.DSH_HOME ? join(process.env.DSH_HOME, 'profiles', process.env.DSH_PROFILE || 'desktop') : null,
    join(homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE || 'desktop'),
  ].filter(Boolean)
  const found = resolveProfileVersion(pkg, candidates)
  const profile = found.state === 'found'
    ? { state: found.version === pkgVersion ? 'same' : 'drift', version: found.version, path: found.path, tried: found.tried }
    : { state: found.state === 'not-found' ? 'not-found' : 'drift', version: found.version, path: found.path, tried: found.tried }

  let registry = null
  if (online) {
    const mod = await import('./dist-tag-check.mjs')
    try {
      const { tags } = await mod.fetchDistTags(pkg)
      const latest = tags.latest ?? null
      const dsh = tags.dsh ?? null
      const state = latest === pkgVersion && dsh === pkgVersion
        ? 'same'
        : (latest === null && dsh === null)
          ? 'missing'
          : (latest && latest !== pkgVersion && latest > pkgVersion) ? 'newer' : 'drift'
      registry = { state, latest, dsh }
    } catch (err) {
      console.error(`registry 不可达：${err && err.message}`); process.exit(10)
    }
  }

  const result = evaluate({ pkgVersion, git: gitState, profile, registry })
  const failed = !result.ok || (strict && result.warnings.length > 0)
  if (json) {
    console.log(JSON.stringify({ pkg, pkgVersion, git: gitState, profile, registry, ...result, strict, failed }, null, 2))
  } else {
    console.log(render(pkg, pkgVersion, gitState, profile, registry, result, strict))
  }
  process.exit(failed ? 1 : 0)
}

function helpText() {
  return [
    '用法：node scripts/release-sync-check.mjs [--online] [--strict] [--json] [--pkg <name>] [--profile <目录>]',
    '',
    '  --online   额外核对 npm dist-tags（需要网络；失败按环境错 exit 10）',
    '  --strict   证据列异常（待发版 / registry 落后）也计入失败',
    '  --json     JSON 输出',
    '',
    '主判据：profile 已装版本 == 源码 package.json 版本。',
    '退出码：0 同版 / 1 不同版（或 --strict 下证据列异常）/ 10 用法或环境错 / 70 内部错',
  ].join('\n')
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main(process.argv).catch((err) => { console.error(`内部错误：${err && err.stack || err}`); process.exit(70) })

export { helpText }
