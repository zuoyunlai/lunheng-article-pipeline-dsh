// 宿主装载烟测的回归网（v18.80.4 · 审计优化方向 9 落地 · 批 B 续）
//
// **为什么需要**：本脚本补的是 `pack-smoke` 明说「证明不了」的那一段——**宿主 loader 会不会加载本包**
//   （v18.0.0「装了但技能从不注册」的缺陷面）。它的**读数语义**必须被钉住，否则最糟的失效形态是
//   「环境里没有 dsh → 脚本静默跳过 → 被读成绿」。
//
// 本文件钉两件事：
//   ① **没跑 ≠ 通过**：PATH 上无宿主 CLI 时必须 `exit 10` 并明说「未执行」，**不得** exit 0；
//   ② 真实宿主在场时**真的跑完**安装 → 合成，并断言合成结果含**自注册行**（本机实测可用；
//      无 dsh 的环境**带理由跳过**，不静默删除强度）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SCRIPT = join(ROOT, 'scripts', 'host-install-smoke.mjs')

const which = (cmd, env) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8', env })
const hasDsh = () => which('dsh', process.env).status === 0

test('宿主烟测 ①：PATH 上无 dsh → **exit 10 且明说「没跑」**（不得伪装成通过）', () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'lh-pathless-'))
  try {
    const r = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, PATH: emptyDir, Path: emptyDir, PATHEXT: '.CMD;.EXE' },
    })
    assert.equal(r.status, 10, `无宿主 CLI 时必须 exit 10（**没跑** ≠ 通过），实得 ${r.status}：` + String(r.stderr).slice(0, 300))
    const all = `${r.stdout || ''}${r.stderr || ''}`
    assert.match(all, /环境不支持/, '须明说原因（环境不支持）')
    assert.match(all, /没跑/, '须显式声明「没跑 ≠ 通过」——这是本判据的立身之处')
  } finally { rmSync(emptyDir, { recursive: true, force: true }) }
})

// v19.27.3（反哺 2026-10-22 **P2-9** 修复）：**安装 / 联网副作用必须显式 opt-in**。
//   病灶（反哺报告 P2-9）：用例 ② 只判「PATH 上有 dsh」，一旦成立就**真的**跑 `dsh plugin add`
//   （临时 DSH_HOME，但要走 registry 拉依赖）——于是「跑一遍单元测试」这件事在装了宿主 CLI 的
//   机器上**隐式包含联网安装**。在只读审计 / 受限环境里，这会与「默认测试应离线」的预期冲突，
//   且失败原因会被误读成代码缺陷。
//   判据：接入点与安装动作分两层——
//     · **默认**只跑「无宿主时必须 exit 10」这条纯离线判据（它正是本文件立身之处）；
//     · 真实安装只在 `LUNHENG_HOST_INSTALL_SMOKE=1` 时执行（CI 的专用 job 由它显式打开）。
//   `skip` 文案必须写明**为什么没跑**，避免把「未执行」读成「通过」。
const INSTALL_OPT_IN = process.env.LUNHENG_HOST_INSTALL_SMOKE === '1'
const installSkip = !INSTALL_OPT_IN
  ? '默认离线：真实安装/联网需显式设 LUNHENG_HOST_INSTALL_SMOKE=1（v19.27.3 P2-9）'
  : (hasDsh() ? false : '本机 PATH 无 dsh——环境不支持，带理由跳过（不得静默删除强度）')

test('宿主烟测 ②：真实宿主在场 → 安装 + profile 合成含自注册行（**安装侧需显式 opt-in**）', { skip: installSkip }, () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 300000 })
  const all = `${r.stdout || ''}${r.stderr || ''}`
  assert.equal(r.status, 0, `宿主烟测应通过，实得 ${r.status}：` + all.slice(-500))
  assert.match(all, /安装成功/, '须走官方 `dsh plugin add` 路径')
  assert.match(all, /自注册层/, '须断言 profile 合成含本包自注册行（loader 入口锚）')
})

test('宿主烟测 ③（v19.27.3 P2-9）：**dump 非零退出不得因输出含自注册行而假绿**', () => {
  // 与 `scripts/host-install-smoke.mjs` 的 P2-5 修复配对：判据必须先看进程状态再看文本。
  // 本用例**不安装任何东西**——它用一个假 `dsh` 驱动脚本的判定分支（离线、零副作用）。
  const dir = mkdtempSync(join(tmpdir(), 'lh-fakedsh-'))
  try {
    const isWin = process.platform === 'win32'
    const fake = join(dir, isWin ? 'dsh.cmd' : 'dsh')
    // 假 dsh：`--dump-config` 先打出**含自注册行**的输出，再以 1 退出（这正是旧实现会漏判的形态）
    const body = isWin
      ? '@echo off\r\nif "%1"=="--dump-config" (\r\n  echo   - id: lunheng-article-pipeline\r\n  exit /b 1\r\n)\r\nexit /b 0\r\n'
      : '#!/bin/sh\ncase "$1" in\n  --dump-config) echo "  - id: lunheng-article-pipeline"; exit 1 ;;\nesac\nexit 0\n'
    writeFileSync(fake, body)
    if (!isWin) chmodSync(fake, 0o755)
    const r = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, PATH: dir + (isWin ? ';' : ':') + process.env.PATH },
    })
    const all = `${r.stdout || ''}${r.stderr || ''}`
    // 安装步骤在本夹具下会失败（假 dsh 不实现 add）——关键断言是**不得以 0 退出**，
    // 且若走到 dump 判定，必须报「未正常结束」而不是「自注册层在场 → 通过」。
    assert.notEqual(r.status, 0, '假 dsh 下不得判通过：' + all.slice(-500))
    assert.ok(!/✓ profile 合成含本包自注册层/.test(all), 'dump 非零时不得输出成功判定：' + all.slice(-500))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
