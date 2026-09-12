#!/usr/bin/env node
// 打包产物冒烟（v18.0.5 新增，第三方审计 P1-7）：验证**发布物本身**（而不是源码树）能否被装载。
//
// 动机：`.github/workflows/` 里此前**没有任何 job 覆盖「安装→启动→卸载」**（`dsh-plugin-dev verify`
//   在本机被 DSH Desktop 的 dsh shim（硬编码 DSH_HOME）+ pnpm 原生依赖策略挡住，CI 也没跑过它）；
//   而历史上 v18.0.0 的「装了但技能从不注册」缺陷**恰好在这些门都覆盖不到的地方**。
//   本脚本用零依赖方式补上「**pack 出来的那包**能不能注册」这一段：
//     ① `npm pack` → 解包到临时目录（真发布物，含 files 白名单裁剪）
//     ② 关键文件齐备（入口 / patch / SKILL.md / 11 个随包脚本 / `_lib`）
//     ③ patch 里本包自注册行**恰好一行**（缺了它 → loader 不会 import 入口 → 技能不注册）
//     ④ patch 行 name 都在 package.json 声明或宿主核心包白名单内（防宿主改名后整树起不来）
//     ⑤ **真跑解包后的 `lib/index.js` 的 apply**（最小 ctx：skills.register + effect），断言
//        注册名 / 正文非空 / frontmatter 已剥离 / resourceBase 指向解包目录 / disposer 可调用
//     ⑥ `tests/` 不得随包（files 白名单裁剪生效）
// 退出码：0 通过｜1 失败（不通过）｜10 参数/环境错（npm/tar 不可用等）
//
// 边界（如实）：本脚本**不等于**官方 `dsh-plugin-dev verify`——它不启动真实 DSH profile，
//   因此不能证明「宿主 loader 会加载本包」；那条由 `tests/bundle-contract.test.mjs`（patch 自注册行）
//   与 `tests/entry.test.mjs`（apply 真跑）在源码树侧覆盖，本脚本则把同一套断言搬到**发布物**侧。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installExitGuard } from '../skills/lunheng-article-pipeline/scripts/_lib/exit-guard.mjs'

installExitGuard()

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PKG_NAME = 'lunheng-article-pipeline'
const HOST_CORE_ALLOW = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh', '@deepseek-ai/dsh-tool-subagent'])

const problems = []
const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { problems.push(msg); console.log(`  ✗ ${msg}`) }

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })

console.log(`\n=== 打包产物冒烟（pack-smoke）· ${ROOT} ===`)
const tmp = mkdtempSync(join(tmpdir(), 'lunheng-pack-smoke-'))
try {
  // ① pack（Windows 下 spawnSync 不能直接跑 `npm.cmd`，需 shell；路径用引号包住防空格）
  const packed = process.platform === 'win32'
    ? sh(`npm pack --pack-destination "${tmp}" --silent`, [], { cwd: ROOT, shell: true })
    : sh('npm', ['pack', '--pack-destination', tmp, '--silent'], { cwd: ROOT })
  if (packed.status !== 0) {
    console.error(`npm pack 失败（exit ${packed.status}）：${(packed.stderr || packed.stdout || '').trim().slice(0, 400)}`)
    console.error('→ 退出码 10（环境问题：npm 不可用或不可写）')
    process.exit(10)
  }
  const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'))
  if (!tgz) { console.error('npm pack 未产出 .tgz'); process.exit(10) }
  console.log(`  · 产物：${tgz}`)

  // ② 解包（tar 在 ubuntu/macos/windows10+ 均可用）
  const untar = sh('tar', ['-xzf', join(tmp, tgz), '-C', tmp])
  if (untar.status !== 0) {
    console.error(`tar 解包失败（exit ${untar.status}）：${(untar.stderr || '').trim().slice(0, 300)}`)
    console.error('→ 退出码 10（环境问题：tar 不可用）')
    process.exit(10)
  }
  const pkg = join(tmp, 'package')

  // ② 关键文件齐备
  const mustExist = [
    'package.json',
    'lib/index.js',
    'cordis.patch.yml',
    `skills/${PKG_NAME}/SKILL.md`,
    `skills/${PKG_NAME}/AGENTS.md`,
    `skills/${PKG_NAME}/scripts/_lib/exit-guard.mjs`,
  ]
  for (const rel of mustExist) {
    if (existsSync(join(pkg, rel))) ok(`随包：${rel}`)
    else bad(`发布物缺 ${rel}`)
  }
  const scriptsDir = join(pkg, 'skills', PKG_NAME, 'scripts')
  const topScripts = existsSync(scriptsDir) ? readdirSync(scriptsDir).filter((f) => f.endsWith('.mjs')) : []
  if (topScripts.length === 11) ok(`随包脚本 11 个（与 SKILL.md 白名单一致）`)
  else bad(`随包脚本数 ${topScripts.length} ≠ 11`)

  // ③/④ patch 自注册行 + 行名声明
  const patchPath = join(pkg, 'cordis.patch.yml')
  if (existsSync(patchPath)) {
    const patch = readFileSync(patchPath, 'utf8')
    const selfRows = patch.split('\n').filter((l) => new RegExp(`^\\s*-?\\s*name:\\s*['"]?${PKG_NAME}['"]?\\s*$`).test(l))
    if (selfRows.length === 1) ok('patch 恰有一行本包自注册行（缺它 → loader 不 import 入口 → 技能不注册）')
    else bad(`patch 自注册行数 = ${selfRows.length}（必须恰好 1）`)
    const pkgJson = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'))
    const declared = new Set([pkgJson.name, ...Object.keys(pkgJson.dependencies || {}), ...Object.keys(pkgJson.peerDependencies || {}), ...HOST_CORE_ALLOW])
    const rowNames = [...patch.matchAll(/^\s*-?\s*name:\s*['"]?([^'"\s#]+)['"]?\s*$/gm)].map((m) => m[1])
    const undeclared = [...new Set(rowNames)].filter((n) => !declared.has(n))
    if (undeclared.length === 0) ok(`patch 行 name ${rowNames.length} 处，均已在 package.json 声明或属宿主核心包`)
    else bad(`patch 引用了未声明的包：${undeclared.join(', ')}（宿主改名/移除 → 整棵 profile 起不来）`)
  }

  // ⑤ 真跑解包后的入口 apply
  const entry = join(pkg, 'lib', 'index.js')
  if (existsSync(entry)) {
    const mod = await import(pathToFileURL(entry).href)
    if (mod.name === PKG_NAME) ok(`入口导出 name = ${mod.name}`)
    else bad(`入口 name = ${mod.name}（期望 ${PKG_NAME}）`)
    if (Array.isArray(mod.inject) && mod.inject.includes('skills')) ok(`入口 inject = [${mod.inject.join(', ')}]`)
    else bad(`入口 inject 未声明 skills：${JSON.stringify(mod.inject)}`)

    let registered = null
    let effectUsed = false
    let disposerCalled = false
    const ctx = {
      effect(fn) {
        effectUsed = true
        const d = fn()
        return () => { disposerCalled = true; if (typeof d === 'function') d() }
      },
      skills: {
        register(def) {
          registered = def
          return () => { registered = null }
        },
      },
    }
    try {
      mod.apply(ctx)
    } catch (e) {
      bad(`apply 抛错：${e.message}`)
    }
    if (effectUsed) ok('注册走 ctx.effect（注册即 effect，卸载可回收）')
    else bad('apply 未使用 ctx.effect —— 卸载无法回收注册')
    if (registered) {
      if (registered.name === PKG_NAME) ok(`apply 注册技能 name = ${registered.name}`)
      else bad(`apply 注册名 = ${registered.name}`)
      const content = String(registered.content || '')
      if (content.length > 500) ok(`技能正文非空（${content.length} 字符）`)
      else bad(`技能正文过短（${content.length} 字符）——SKILL.md 可能未随包`)
      if (!content.startsWith('---')) ok('正文已剥离 frontmatter')
      else bad('正文未剥离 frontmatter（首行仍是 ---）')
      const rb = registered.resourceBase
      const rbPath = rb && typeof rb === 'object' ? rb.path : null
      if (rbPath && resolve(rbPath) === resolve(join(pkg, 'skills', PKG_NAME))) ok('resourceBase 指向解包后的技能目录')
      else bad(`resourceBase 未指向解包技能目录：${JSON.stringify(rb)}`)
      const roleCards = existsSync(join(pkg, 'skills', PKG_NAME, 'references', 'agents'))
        ? readdirSync(join(pkg, 'skills', PKG_NAME, 'references', 'agents')).filter((f) => f.endsWith('.md')).length
        : 0
      if (roleCards >= 11) ok(`随包角色卡 ${roleCards} 张（T0-T9 齐）`)
      else bad(`随包角色卡只有 ${roleCards} 张（期望 ≥11）`)
    } else if (!problems.length) {
      bad('apply 未调用 skills.register')
    }
  }

  // ⑥ tests/ 不随包
  if (!existsSync(join(pkg, 'tests'))) ok('tests/ 未随包（files 白名单裁剪生效）')
  else bad('tests/ 随包了（files 白名单失效）')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (problems.length > 0) {
  console.log(`\n✗ 打包产物冒烟未通过：${problems.length} 项`)
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
console.log('\n✓ 打包产物冒烟通过（发布物可装载：入口 + patch 自注册行 + 技能注册 + frontmatter 剥离 + resourceBase）')
