#!/usr/bin/env node
// 宿主装载烟测（host-install-smoke）—— v18.80.4 · 审计优化方向 9 落地 · 批 B 续
//
// ── 为什么需要（它补的是哪一段）────────────────────────────────────────────────────────────
//   `pack-smoke.mjs` 已能证明「**发布物自身**可 apply」（解包后真跑 `lib/index.js` 的 apply + 断言技能注册），
//   但它的头注释**明确声明**：「**不等于**官方 `dsh-plugin-dev verify`——它不启动真实 DSH profile，
//   因此不能证明**宿主 loader 会加载本包**」。而本仓历史上最贵的一次缺陷（v18.0.0「装了但技能从不注册」）
//   **恰好长在那段空白里**。
//   本脚本用**真实 dsh CLI + 隔离 DSH_HOME** 补上「安装 → profile 合成」这一段：
//     ① `npm pack` 出真发布物（复用 `pack-smoke` 同款零依赖链）；
//     ② **隔离**临时 `DSH_HOME`（绝不碰主人真实 profile）；
//     ③ `dsh plugin --profile <tmp> add <tgz>`：走官方安装路径（pnpm 装入 profile 的 node_modules）；
//     ④ `dsh --profile <tmp> --dump-config`：**只合成、不启停**，断言合成结果里含
//        **本包自注册层**（`- id: lunheng-article-pipeline`）——这一行就是 loader 的入口锚，
//        它缺失 = 技能永不注册（v18.0.0 缺陷形态）。
//
// ── 边界（如实，不许读成「已验证真实运行」）──────────────────────────────────────────────────
//   · 只到「**profile 合成**」层：不 boot app、不跑会话、不验工具/命令在真实会话里可调用
//     （那需要真实模型凭据与会话，且属 Tier-2 昂贵验证——见 `references/maintainers.md` §十二）。
//   · 依赖宿主 CLI（`dsh`）在 PATH 上：**没有就判「环境不支持」并 exit 10**（不是失败）——
//     CI 若未装 dsh，本步会如实报「没跑」，而不是伪装成通过（与 `no-write-check` 的
//     「没跑 ≠ 跑了没改写」同一条判据）。
//   · 需要网络/pnpm 缓存（安装步）。**本机实测**：仅下载本包 tarball（`downloaded 1`，695 ms）。
//
// 用法：`node scripts/host-install-smoke.mjs [--keep]`（`--keep` 保留临时 DSH_HOME 供排查）
// 退出码：0 = 合成结果含本包自注册层｜1 = 不含或安装失败｜10 = 环境不支持（无 dsh CLI / 无 npm / 无 pnpm）
//
// ⚠️ 本脚本是**仓库级**（不随包），与 `pack-smoke` / `repo-hygiene-check` 同类，不进技能目录。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PKG_NAME = 'lunheng-article-pipeline'
const KEEP = process.argv.includes('--keep')

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const has = (cmd) => {
  const r = sh(process.platform === 'win32' ? 'where' : 'which', [cmd])
  return r.status === 0 && String(r.stdout || '').trim().length > 0
}
/** 调宿主 CLI（v18.80.4 实测踩到）：Windows 上 `dsh` 是 `dsh.cmd`，`spawnSync('dsh', …)` **不经 shell**
 *  会以 `EINVAL` 失败（`status: null`、输出全空），而 `where dsh` 明明找得到——**「没跑起来」与「跑了没通过」
 *  在读数上一模一样**（同 `no-write-check` 头注释里那条判据）。故 Windows 下经 shell 调用并逐个引号包裹。 */
const runDsh = (args, opts = {}) => (process.platform === 'win32'
  ? sh(`dsh ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`, [], { shell: true, ...opts })
  : sh('dsh', args, opts))
const errOf = (r) => (r.error ? ` [${r.error.code || r.error.message}]` : '')
const say = (m) => console.log(`  ${m}`)

console.log(`\n=== 宿主装载烟测（host-install-smoke）· ${ROOT} ===`)
for (const tool of ['npm', 'dsh']) {
  if (!has(tool)) {
    console.error(`✗ 环境不支持：PATH 上找不到 \`${tool}\``)
    console.error('→ 退出码 10（**没跑** ≠ 通过）：本步需真实宿主 CLI，缺失时如实报「未执行」，不得读成绿。')
    process.exit(10)
  }
}

const home = mkdtempSync(join(tmpdir(), 'lunheng-hostsmoke-'))
const profile = `smoke${Date.now().toString().slice(-6)}`
const env = { ...process.env, DSH_HOME: home }
let failed = 0

try {
  say(`· 隔离 DSH_HOME：${home}`)

  // ① 真发布物
  const packed = process.platform === 'win32'
    ? sh(`npm pack --pack-destination "${home}" --silent`, [], { cwd: ROOT, shell: true })
    : sh('npm', ['pack', '--pack-destination', home, '--silent'], { cwd: ROOT })
  if (packed.status !== 0) {
    console.error(`✗ npm pack 失败（exit ${packed.status}）：${String(packed.stderr || '').slice(0, 300)}`)
    process.exit(10)
  }
  const tgz = readdirSync(home).find((f) => f.endsWith('.tgz'))
  if (!tgz) { console.error('✗ npm pack 未产出 .tgz'); process.exit(10) }
  say(`· 产物：${tgz}`)

  // ② 官方安装路径（pnpm 装入 profile）
  const add = runDsh(['plugin', '--profile', profile, 'add', join(home, tgz)], { env, timeout: 300000 })
  const addOut = `${add.stdout || ''}${add.stderr || ''}`
  if (add.status !== 0) {
    failed++
    say(`✗ \`dsh plugin add\` 失败（exit ${add.status}${errOf(add)}）：${addOut.trim().split('\n').slice(-4).join(' | ').slice(0, 400)}`)
  } else {
    say('✓ 安装成功（官方 `dsh plugin add` 路径）')
  }

  // ③ profile 合成（只合成、不启停）
  const dump = runDsh(['--profile', profile, '--dump-config'], { env, timeout: 120000 })
  const dumpOut = `${dump.stdout || ''}${dump.stderr || ''}`
  // 断言面 = **自注册行**（loader 靠它 import 入口；缺它 → 技能永不注册 = v18.0.0 缺陷形态）
  const hasSelfRow = new RegExp(`^\\s*-\\s*id:\\s*${PKG_NAME}\\s*$`, 'm').test(dumpOut)
  if (hasSelfRow) {
    say(`✓ profile 合成含本包自注册层（- id: ${PKG_NAME}）——loader 入口锚在场`)
  } else {
    failed++
    say(`✗ profile 合成**未见**本包自注册层（- id: ${PKG_NAME}）——技能将永不注册（v18.0.0 缺陷形态）`)
    say(`  dump 输出尾部：${dumpOut.trim().split('\n').slice(-6).join(' | ').slice(0, 500)}`)
  }
  // 反向钉：合成里**不得**出现「本包 patch 被解析但登记项为空」的形态
  if (!/lunheng-article-pipeline/.test(dumpOut)) {
    failed++
    say('✗ profile 合成里完全没有本包痕迹——patch 层可能根本未被应用')
  }

  if (failed) {
    console.error(`\n✗ 宿主装载烟测未通过（${failed} 项）`)
    if (!KEEP) rmSync(home, { recursive: true, force: true })
    else console.error(`· 已保留临时 DSH_HOME 供排查：${home}`)
    process.exit(1)
  }
  console.log('\n✓ 宿主装载烟测通过（安装 → profile 合成含自注册层；**不含 boot**，见头注释边界）')
} finally {
  if (!failed && !KEEP) rmSync(home, { recursive: true, force: true })
  if (KEEP) console.log(`· --keep：临时 DSH_HOME 保留于 ${home}（含 profile ${profile}；${existsSync(home) ? '存在' : '不存在'}）`)
}
