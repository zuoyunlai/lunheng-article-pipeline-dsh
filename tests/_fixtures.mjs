// 测试夹具公共模块（v18.0.5 抽取：冗余审计 §二.4）
//
// 来源：`audits/论衡冗余审计-v1.md` §二.4 —— 「`tmp()`/`rmSync` 生命周期 94 行；项目骨架 5 行块重复 20 处；
// 同一份『五节文末 + [L01]』定稿夹具逐字 13 次；3 份同物夹具生成器；e2e 与 scripts.test 逐字重叠 55 行」。
// 本模块只放**夹具与运行器**，不放断言：断言仍留在各自的 `*.test.mjs` 里（抽取不减少任何断言）。
//
// 使用：`import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD } from './_fixtures.mjs'`
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SCRIPTS = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')

// 跑一个随包脚本：返回 exit code + 合并输出 + 分离的 stdout/stderr（v18.0.5 起两个测试文件共用同一实现）
// opts.env 可整体替换子进程环境（用于 spawn 失败 / 缺环境变量等场景）
//
// ⚠️ **为什么用临时文件承接输出，而不是默认的管道 stdio（v18.2.6 修）**：
//   `spawnSync` 默认 `stdio: 'pipe'` 会在父进程与子进程之间开一对**命名管道**。在 DSH 的受限会话
//   （`workspace-write` 沙箱）下，被沙箱的 Node 进程**不允许开命名管道** → `spawnSync` 直接以
//   `EPERM` 失败、`status === null`、stdout/stderr 全空。后果不是「某条用例红」，而是**整套测试
//   在本包自己的宿主会话里跑不起来**（实测基线：`--test-isolation=none` 全量 102 项里 74 项失败，
//   绝大多数都是这一个根因），而 `AGENTS.md` 恰恰要求 agent 跑 `node --test`——一条在本宿主
//   跑不通的命令。「脚本进程的 stdout/stderr」是本套件的**必需能力**，故改为把子进程的输出重定向到
//   **普通文件**（`stdio: ['ignore', <fd>, <fd>]`），跑完再读回。文件 stdio 不经管道，受限模式下可用。
//   返回契约**完全不变**：`{ code, out, stdout, stderr }`（`out` 仍是 stdout + stderr 拼接）。
//   另加 `error`（`r.error?.code`）：把「脚本自己失败（有退出码）」与「环境根本不许 spawn（EPERM）」
//   区分开——这两者的补救动作完全不同，混在一起会把环境问题读成契约破坏。
export const run = (args, opts = {}) => {
  const d = tmp('lunheng-run-')
  const outPath = join(d, 'stdout.txt')
  const errPath = join(d, 'stderr.txt')
  const outFd = openSync(outPath, 'w')
  const errFd = openSync(errPath, 'w')
  let r
  try {
    r = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      cwd: opts.cwd || ROOT,
      stdio: ['ignore', outFd, errFd], // ← 关键：文件描述符，不是 'pipe'（受限沙箱禁命名管道）
      ...(opts.env ? { env: opts.env } : {}),
    })
  } finally {
    closeSync(outFd)
    closeSync(errFd)
  }
  let stdout = ''
  let stderr = ''
  try {
    stdout = readFileSync(outPath, 'utf8')
    stderr = readFileSync(errPath, 'utf8')
  } catch { /* 采集文件缺失（如 spawn 未启动）：保持空串，与旧实现的空输出同形 */ }
  rmSync(d, { recursive: true, force: true })
  return {
    code: r.status,
    out: stdout + stderr,
    stdout,
    stderr,
    error: r.error ? (r.error.code || r.error.message) : undefined,
  }
}
export const parseJson = (r) => JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
export const tmp = (prefix = 'lunheng-test-') => mkdtempSync(join(tmpdir(), prefix))

// ── 环境探测（v18.2.6）：让「本环境物理上做不到」的用例**带理由跳过**，而不是恒红 ──────────────
// 为什么必须探测而不是无条件 skip：无条件跳过等于把用例删掉（强度永久下降）；**恒红**则训练人无视红灯
//   （假绿的文化前身）。故：探测到环境不允许 → skip 并写明理由（`ℹ skipped N` 汇总里看得见「跳过 ≠ 通过」）；
//   探测到环境可用（CI / 无文件沙箱的 host shell）→ **照常执行，强度与改前完全一致**。
// 探测方式与实测依据（本机 workspace-write 沙箱，2026-09）：
//   · `spawnSync(process.execPath, ['-e','0'], { stdio: ['ignore','pipe','pipe'] })` → `error.code === 'EPERM'`；
//     同一命令 `stdio: ['ignore','ignore','ignore']` → `status === 0`。即**被围栏进程不能开命名管道**
//     （`run()` 的临时文件改法正是为此），而**管道**是「在测试进程内跑子进程」的用例绕不开的。
//   · `npm --version`（shell + 管道）→ 同为 EPERM：`npm pack` 在工作区外写缓存，本沙箱下不可用。
/** 宿主是否禁止子进程开命名管道（受限 DSH 会话的典型形态）。 */
export const PIPE_SPAWN_BLOCKED = (() => {
  try {
    const r = spawnSync(process.execPath, ['-e', '0'], { stdio: ['ignore', 'pipe', 'pipe'] })
    return r.error?.code === 'EPERM'
  } catch { return false }
})()

/** `npm` CLI 在本环境是否可用（`npm pack` 类用例的前置条件）。 */
export const NPM_UNAVAILABLE = (() => {
  try {
    const r = spawnSync('npm --version', { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return r.error?.code === 'EPERM' || r.status !== 0
  } catch { return true }
})()

/** node:test 的 `{ skip }` 选项：条件为真时给理由字符串，否则 `false`（照常执行）。 */
export const skipWhen = (cond, reason) => (cond ? reason : false)

// 项目骨架：`<tmp>/run/proj/{final/证据包, [analysis], [audits], [drafts], [extra…]}`。
//   默认只建证据包（绝大多数用例的最小骨架）；需要额外目录时用开关，避免每个用例各写一遍 mkdirSync。
export const mkProject = ({ analysis = false, audits = false, drafts = false, extra = [], prefix } = {}) => {
  const d = tmp(prefix)
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  const aud = join(proj, 'audits')
  mkdirSync(ev, { recursive: true })
  if (analysis) mkdirSync(join(proj, 'analysis'), { recursive: true })
  if (audits) mkdirSync(aud, { recursive: true })
  if (drafts) mkdirSync(join(proj, 'drafts'), { recursive: true })
  for (const dir of extra) mkdirSync(join(proj, dir), { recursive: true })
  return { d, proj, fin, ev, aud }
}

// 仓库骨架（consistency-check / pack-smoke 等「仓库级门」的注入用例专用）
//   · 默认只复制门所需的最小集（技能体 + 包级清单）——多数用例够用、跑得快
//   · `full: true` 复制整仓（除 .git / node_modules / *.tgz）——供 `pack-smoke.mjs` 这类
//     需要 lib/ + repo scripts/ + files 白名单里全部产物的门使用（v18.0.5 新增）
export const mkRepo = ({ extraFiles = [], readme = false, full = false } = {}) => {
  const d = tmp()
  const repo = join(d, 'repo')
  mkdirSync(repo, { recursive: true })
  if (full) {
    cpSync(ROOT, repo, {
      recursive: true,
      filter: (src) => !/[\\/]\.git([\\/]|$)/.test(src) && !/[\\/]node_modules([\\/]|$)/.test(src) && !src.endsWith('.tgz'),
    })
  } else {
    cpSync(join(ROOT, 'skills'), join(repo, 'skills'), { recursive: true })
    const files = ['package.json', 'CHANGELOG.md', 'cordis.patch.yml', ...(readme ? ['README.md'] : []), ...extraFiles]
    for (const f of files) cpSync(join(ROOT, f), join(repo, f))
  }
  return { d, repo, R: join(repo, 'skills', 'lunheng-article-pipeline') }
}

// 图件链路用例的标准定稿：两个块级图位
export const MD = '# 标题\n\n## 摘要\n\n正文。\n\n[图1：趋势]\n\n中间段。\n\n[图2：占比]\n\n结尾。\n'
export const mkSvg = (marker) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500"><text x="10" y="20">${marker}</text></svg>\n`

// 「五节文末 + [L01][L02][L03][D01]」定稿（端到端与 M 门用例共用同一份夹具，避免逐字抄 13 次）
export const DRAFT_WITH_ENDNOTES = (bodyTail = '') => '# 标题\n\n## 摘要\n\n正文 [L01] [L02] [L03] [D01]。\n\n## 一、导论\n\n'
  + '段落内容。'.repeat(30) + bodyTail
  + '\n\n## 参考文献\n\n[L01] a\n[L02] b\n[L03] c\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'

// 素材卡夹具：索引段 + 正文条目（`信任级别：已发布` 为机检硬格式要求）
export const CARD = (name, ids) => `# ${name}\n\n## 📇 索引段\n\n`
  + ids.map((id) => `[${id}] 主题 ｜ 论点1`).join('\n')
  + '\n\n## 正文\n\n' + ids.map((id) => `### [${id}] 条目\n信任级别：已发布\n`).join('\n')

// 便捷写入：`writeDraft(fin, body)` 等高频组合（保持与手写 writeFileSync 完全一致的落盘形态）
export const writeFixture = (path, content) => { writeFileSync(path, content) }
