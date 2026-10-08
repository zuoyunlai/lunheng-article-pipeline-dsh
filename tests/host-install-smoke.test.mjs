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
import { mkdtempSync, rmSync } from 'node:fs'

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

test('宿主烟测 ②：真实宿主在场 → 安装 + profile 合成含自注册行', { skip: hasDsh() ? false : '本机 PATH 无 dsh——环境不支持，带理由跳过（不得静默删除强度）' }, () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 300000 })
  const all = `${r.stdout || ''}${r.stderr || ''}`
  assert.equal(r.status, 0, `宿主烟测应通过，实得 ${r.status}：` + all.slice(-500))
  assert.match(all, /安装成功/, '须走官方 `dsh plugin add` 路径')
  assert.match(all, /自注册层/, '须断言 profile 合成含本包自注册行（loader 入口锚）')
})
