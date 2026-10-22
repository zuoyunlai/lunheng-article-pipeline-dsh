// 发布链 **latest 硬断言 step** 的可执行回归（v19.27.3 · 反哺 2026-10-22 **P1-2**）
//
// 为什么必须是**执行**测试而不是源码字符串钉：
//   缺陷本体是「GitHub Actions 每个 step 是独立 shell，局部变量不跨 step」——这是**控制流**事实，
//   字符串里出现 `VER=...` 与它能否在**本 step** 被解析，是两件事。旧版本把该 step 钉在
//   `tests/third-review-gates.test.mjs` 的「shell 文本包含某些句子」上，于是**恰好捕不到** P1-2
//   （实测：开关启用后必然 `VER: unbound variable`，而文本钉一直绿）。
// 本文件的做法：从 publish.yml 里**抽出真实 shell 块**，配一个 `npm` 桩在 PATH 上执行它，
//   断言三种场景的退出码与文案。零网络、零发布、零宿主依赖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WF = join(ROOT, '.github', 'workflows', 'publish.yml')
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0

/** 从 workflow 抽出指定 step 的 `run:` 块（按 10 空格缩进还原）。 */
function extractStepShell(marker) {
  const y = readFileSync(WF, 'utf8')
  const i = y.indexOf(marker)
  if (i < 0) throw new Error(`workflow 里找不到 step：${marker}`)
  const r = y.indexOf('run: |', i)
  if (r < 0) throw new Error(`step 没有 run 块：${marker}`)
  const body = []
  for (const ln of y.slice(r + 6).split('\n')) {
    if (!ln.trim()) { body.push(''); continue }
    if (!ln.startsWith('          ')) break
    body.push(ln.slice(10))
  }
  return body.join('\n')
}

/** 造一个隔离工作区：假的 package.json + 假 npm（按场景回放 dist-tag / 是否有更新版本）。 */
function harness(latestTag, { newer = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lh-latest-step-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'lunheng-article-pipeline', version: '19.27.2' }))
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const stub = [
    '#!/bin/sh',
    'if [ "$1" = "view" ]; then',
    // `npm view <pkg>@>VER version`：无更新版本时 npm 报 E404（这里以空输出 + 0 模拟「无更新」）
    `  case "$2" in *"@>"*) ${newer ? `echo "${newer}"; ` : ''}exit 0 ;; esac`,
    '  case "$3" in dist-tags.latest) echo "${STUB_LATEST}" ;; esac',
    'fi',
    'exit 0',
    '',
  ].join('\n')
  const npmPath = join(bin, 'npm')
  writeFileSync(npmPath, stub)
  chmodSync(npmPath, 0o755)
  return { dir, bin }
}

function runStep(script, { dir, bin }, latestTag) {
  return spawnSync('bash', ['-c', script], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH, PKG: 'lunheng-article-pipeline', STUB_LATEST: latestTag },
  })
}

const SKIP = hasBash ? false : '本机没有 bash——无法执行 workflow shell，带理由跳过（不得读成通过）'

test('P1-2 ①：latest 与本版一致 → 该 step 必须 **exit 0**（且不得报 unbound variable）', { skip: SKIP }, () => {
  const s = extractStepShell('latest 前移硬断言')
  const h = harness('19.27.2')
  try {
    const r = runStep(s, h, '19.27.2')
    const all = `${r.stdout || ''}${r.stderr || ''}`
    assert.ok(!/unbound variable/.test(all), 'VER 必须由本 step 自己求值（跨 step 局部变量不共享）：' + all)
    assert.equal(r.status, 0, 'latest 已同步时必须通过：' + all)
    assert.match(all, /latest == 19\.27\.2/)
  } finally { rmSync(h.dir, { recursive: true, force: true }) }
})

test('P1-2 ②：latest 落后 → 必须 **exit 1** 并给出可读修法（不得静默通过）', { skip: SKIP }, () => {
  const s = extractStepShell('latest 前移硬断言')
  const h = harness('19.27.1')
  try {
    const r = runStep(s, h, '19.27.1')
    const all = `${r.stdout || ''}${r.stderr || ''}`
    assert.equal(r.status, 1, 'latest 落后必须红：' + all)
    assert.match(all, /latest=19\.27\.1/)
    assert.match(all, /dist-tag add/, '须给出可执行的闭合路径')
  } finally { rmSync(h.dir, { recursive: true, force: true }) }
})

test('P1-2 ③：**补推历史 tag**（registry 上已有更新版本）→ 不得硬断言 latest==VER（防回退口径互斥）', { skip: SKIP }, () => {
  // 这是 P1-2 的第二半：即使把 VER 定义好，旧逻辑仍会在这里误红 ——
  //   而「补推旧 tag 不动 latest」是上一步**刻意**的防回退行为，两条规则必须相容。
  const s = extractStepShell('latest 前移硬断言')
  const h = harness('19.27.5', { newer: '19.27.5' })
  try {
    const r = runStep(s, h, '19.27.5')
    const all = `${r.stdout || ''}${r.stderr || ''}`
    assert.equal(r.status, 0, '补推历史 tag 不得因 latest 指向前进而失败：' + all)
    assert.match(all, /不\*\*断言 latest|不断言 latest|不\*\*断言/)
  } finally { rmSync(h.dir, { recursive: true, force: true }) }
})

test('P1-2 ④：该 step 的 shell 必须能被 bash 解析（语法级，防「注释写对、语法写坏」）', { skip: SKIP }, () => {
  const s = extractStepShell('latest 前移硬断言')
  const d = mkdtempSync(join(tmpdir(), 'lh-latest-syntax-'))
  try {
    const f = join(d, 'step.sh')
    writeFileSync(f, s)
    const r = spawnSync('bash', ['-n', f], { encoding: 'utf8' })
    assert.equal(r.status, 0, 'bash -n 必须通过：' + `${r.stdout || ''}${r.stderr || ''}`)
    assert.ok(existsSync(f))
  } finally { rmSync(d, { recursive: true, force: true }) }
})
