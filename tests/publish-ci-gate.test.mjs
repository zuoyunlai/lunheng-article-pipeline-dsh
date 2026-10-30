// P1-3 的可执行回归：**同 SHA CI 绿闸**必须真的判负（离线、零网络、零发布）
//
// 为什么必须有：该闸是「发布前必须看到同 SHA 的 ci.yml 全绿」的唯一执行点，而它跑在
//   GitHub Actions 里、本地无法触发真实发布。旧式做法是源码字符串钉——字符串能钉住「命令写了」，
//   钉不住「失败分支真的会红」。本文件用假 `gh` 驱动真实 shell 的四个分支。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WF = join(ROOT, '.github', 'workflows', 'publish.yml')
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0
const SKIP = hasBash ? false : '本机没有 bash——无法执行 workflow shell，带理由跳过'
// Windows 句柄可能延迟释放；有限重试后仍失败时，rmSync 保留并抛出最后一条真实错误。
const RM_RETRY = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }

/** 抽出「同 SHA CI 绿闸」step 的 run 块。 */
function extractGate() {
  const y = readFileSync(WF, 'utf8')
  const i = y.indexOf('同 SHA CI 绿闸')
  if (i < 0) throw new Error('workflow 里找不到「同 SHA CI 绿闸」step')
  const r = y.indexOf('run: |', i)
  const body = []
  for (const ln of y.slice(r + 6).split('\n')) {
    if (!ln.trim()) { body.push(''); continue }
    if (!ln.startsWith('          ')) break
    body.push(ln.slice(10))
  }
  return body.join('\n')
}

/**
 * 造一个假 `gh`：按场景返回 `actions/workflows/ci.yml/runs` 的 JSON。
 * 同时把脚本里的 `sleep 30` 压成 `sleep 0`，避免用例真的等 15 分钟。
 */
function harness(json) {
  const dir = mkdtempSync(join(tmpdir(), 'lh-ci-gate-'))
  const bin = join(dir, 'bin'); mkdirSync(bin, { recursive: true })
  const gh = join(bin, 'gh')
  writeFileSync(gh, `#!/bin/sh\ncat <<'JSON'\n${json}\nJSON\n`)
  chmodSync(gh, 0o755)
  return { dir, bin }
}

function runGate(gate, { dir }) {
  const script = gate.replace(/sleep 30/g, 'sleep 0').replace(/\+ 900/, '+ 3')
  const env = 'PATH="bin:$PATH"\nexport GITHUB_REPOSITORY=\'o/r\' GITHUB_SHA=\'abc123\'\n'
  writeFileSync(join(dir, 'gate.sh'), env + script)
  return spawnSync('bash', ['gate.sh'], { cwd: dir, encoding: 'utf8' })
}

const wrap = (runs) => JSON.stringify({ total_count: runs.length, workflow_runs: runs })
const run = (status, conclusion, n = 1) => ({ name: 'ci', run_number: n, status, conclusion, html_url: 'https://x/' + n })

test('P1-3 ①：同 SHA 的 ci.yml 全绿 → 闸门放行（exit 0）', { skip: SKIP }, () => {
  const h = harness(wrap([run('completed', 'success', 1)]))
  try {
    const r = runGate(extractGate(), h)
    const all = `${r.stdout || ''}${r.stderr || ''}`
    assert.equal(r.status, 0, '全绿必须放行：' + all)
    assert.match(all, /已成功 1 次/)
  } finally { rmSync(h.dir, RM_RETRY) }
})

test('P1-3 ②：同 SHA 有失败运行 → 闸门必须红（exit 1），且点名是哪次', { skip: SKIP }, () => {
  const h = harness(wrap([run('completed', 'success', 1), run('completed', 'failure', 2)]))
  try {
    const r = runGate(extractGate(), h)
    const all = `${r.stdout || ''}${r.stderr || ''}`
    assert.equal(r.status, 1, '有失败必须红：' + all)
    assert.match(all, /未成功|failure/, '须点出失败：' + all)
  } finally { rmSync(h.dir, RM_RETRY) }
})

test('P1-3 ③：同 SHA 查不到任何 ci 运行 → **fail-closed**（不得因「没记录」放行）', { skip: SKIP }, () => {
  const h = harness(wrap([]))
  try {
    const r = runGate(extractGate(), h)
    const all = `${r.stdout || ''}${r.stderr || ''}`
    assert.equal(r.status, 1, '无运行记录必须 fail-closed：' + all)
    assert.match(all, /fail-closed|等待/)
  } finally { rmSync(h.dir, RM_RETRY) }
})

test('P1-3 ④：该闸的 shell 必须能被 bash 解析', { skip: SKIP }, () => {
  const d = mkdtempSync(join(tmpdir(), 'lh-ci-syntax-'))
  try {
    const f = join(d, 'gate.sh')
    writeFileSync(f, extractGate())
    const r = spawnSync('bash', ['-n', 'gate.sh'], { cwd: d, encoding: 'utf8' })
    assert.equal(r.status, 0, 'bash -n 必须通过：' + `${r.stdout || ''}${r.stderr || ''}`)
  } finally { rmSync(d, RM_RETRY) }
})
