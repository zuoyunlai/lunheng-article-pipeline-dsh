// self-check.mjs（随包完整性自检）回归测试（v18.63.0 新增，依据 audits/反哺报告-v5-竞品驱动.md §v5.2-1）
//
// 覆盖：真源上必须 exit 0（否则包本身不完整）/ --json 契约自洽 / **删一个随包脚本必 FAIL 且点名** /
//   **多一个未声明脚本必 FAIL 且点名** / 多余参数 → 10 / **源码钉「零 spawn、零写盘」**。
// 运行：node --test tests/self-check.test.mjs
//
// 为什么「删一个脚本必掉级」是这条用例的承重点：本脚本的存在理由就是回答「手里这份包是不是完整的」，
//   而**唯一能证明它真的在核**的方式，是在副本上制造一个真实缺件并看它点名（本仓「反向自证」纪律）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, run, parseJson, tmp, skipWhen, PIPE_SPAWN_BLOCKED } from './_fixtures.mjs'

const SCRIPT = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', 'self-check.mjs')
const SKILL_SRC = join(ROOT, 'skills', 'lunheng-article-pipeline')

const failsOf = (j) => j.results.filter((r) => r.status === 'fail')

/** 在临时目录里造一份**纯技能部署**副本（无 package.json → ④ 组如实 N/A），供缺件用例做手术。 */
const mkSkillCopy = () => {
  const d = tmp()
  mkdirSync(join(d, 'skills'), { recursive: true })
  cpSync(SKILL_SRC, join(d, 'skills', 'lunheng-article-pipeline'), { recursive: true })
  return { d, R: join(d, 'skills', 'lunheng-article-pipeline') }
}

test('真源仓库上 self-check 必须 exit 0（白名单自洽 / 承重文件齐备 / 版本一致）', { skip: skipWhen(PIPE_SPAWN_BLOCKED, '宿主禁子进程管道') }, () => {
  const r = run([SCRIPT])
  assert.equal(r.code, 0, `真源未通过自检——本包自己就不完整：\n${r.out}`)
  assert.match(r.out, /✅ 本包完整/)
  assert.match(r.out, /FAIL 0/)
})

test('--json 契约：results / summary / exit 三者自洽，且 5 组俱全', { skip: skipWhen(PIPE_SPAWN_BLOCKED, '宿主禁子进程管道') }, () => {
  const r = run([SCRIPT, '--json'])
  assert.equal(r.code, 0, r.out.slice(0, 400))
  const j = parseJson(r)
  assert.equal(j.script, 'self-check')
  assert.equal(j.exit, 0)
  assert.equal(j.summary.total, j.results.length)
  for (const k of ['pass', 'fail', 'na', 'skip']) {
    assert.equal(j.summary[k], j.results.filter((x) => x.status === k).length, `summary.${k} 与 results 不一致`)
  }
  // 五组齐备：缺哪一组都意味着「有一类事实没被核」（而不是「该类无问题」）
  const groups = new Set(j.results.map((x) => x.group))
  for (const g of ['whitelist', 'files', 'version', 'package', 'imports']) {
    assert.ok(groups.has(g), `缺少 ${g} 组`)
  }
})

test('删掉一个随包脚本 → exit 1 且 detail 点名它（本脚本真的在核，不是恒绿）', { skip: skipWhen(PIPE_SPAWN_BLOCKED, '宿主禁子进程管道') }, () => {
  const { d, R } = mkSkillCopy()
  try {
    rmSync(join(R, 'scripts', 'fix-gates.mjs'))
    const r = run([join(R, 'scripts', 'self-check.mjs'), '--json'], { cwd: d })
    assert.equal(r.code, 1, r.out.slice(0, 400))
    const j = parseJson(r)
    const fails = failsOf(j)
    assert.deepEqual(fails.map((x) => x.id), ['W4'], `应只白名单缺失项失败，实得 ${JSON.stringify(fails)}`)
    assert.match(fails[0].detail, /fix-gates/)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('多出一个未声明脚本 → exit 1 且 detail 点名它（白名单是唯一真源，双向对账）', { skip: skipWhen(PIPE_SPAWN_BLOCKED, '宿主禁子进程管道') }, () => {
  const { d, R } = mkSkillCopy()
  try {
    writeFileSync(join(R, 'scripts', 'zzz-undeclared.mjs'), '// 未登记脚本\n')
    const r = run([join(R, 'scripts', 'self-check.mjs'), '--json'], { cwd: d })
    assert.equal(r.code, 1, r.out.slice(0, 400))
    const fails = failsOf(parseJson(r))
    assert.deepEqual(fails.map((x) => x.id), ['W5'], `应只「未声明」项失败，实得 ${JSON.stringify(fails)}`)
    assert.match(fails[0].detail, /zzz-undeclared/)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('纯技能部署：包面组如实 N/A（不臆造通过），且不因此改退出码', { skip: skipWhen(PIPE_SPAWN_BLOCKED, '宿主禁子进程管道') }, () => {
  const { d, R } = mkSkillCopy()
  try {
    const r = run([join(R, 'scripts', 'self-check.mjs'), '--json'], { cwd: d })
    assert.equal(r.code, 0, `纯技能部署应通过（包面无输入 → N/A）：\n${r.out.slice(0, 400)}`)
    const j = parseJson(r)
    const p0 = j.results.find((x) => x.id === 'P0')
    assert.equal(p0.status, 'na')
    assert.match(p0.detail, /纯技能部署/)
    // 无 package.json 会同时让两处如实降级：V2（包版本对比）与 P0（包面齐备）——两处都必须是 N/A
    // 而非 PASS（「没输入」不许与「核过了」同形），且都**不改退出码**（否则纯技能部署会恒非 0）。
    assert.deepEqual(
      j.results.filter((x) => x.status === 'na').map((x) => x.id).sort(),
      ['P0', 'V2'],
      `N/A 项应恰为 P0/V2，实得 ${JSON.stringify(j.results.filter((x) => x.status === 'na'))}`,
    )
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('参数错 → exit 10（多余位置参数 / 未知旗标都不许静默忽略）', { skip: skipWhen(PIPE_SPAWN_BLOCKED, '宿主禁子进程管道') }, () => {
  const extra = run([SCRIPT, 'run/some-project'])
  assert.equal(extra.code, 10, extra.out.slice(0, 200))
  assert.match(extra.out, /多余的参数/)
  const unknown = run([SCRIPT, '--sumary'])
  assert.equal(unknown.code, 10, unknown.out.slice(0, 200))
  assert.match(unknown.out, /未知参数/)
})

// ── 源码钉（ADR 硬要求「成对测试」的另一半）：把「零 spawn、零写盘、零网络」从承诺变成断言 ──────
// 为什么钉源码而不是只测行为：行为测只能证明**本次运行**没写盘；若后来有人给本脚本加一个
//   `writeFileSync`（哪怕在分支里），行为测在正常路径上仍会绿。源码钉让它当场红。
test('源码钉：self-check 不得引入 spawn / 写盘 / 网络 API（它是「只读自证」的承诺）', () => {
  const src = readFileSync(SCRIPT, 'utf8')
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')   // 注释里提到 API 名不算
  const banned = /\b(spawnSync|spawn|execSync|execFileSync|writeFileSync|appendFileSync|createWriteStream|writeReport|writeWithSafety|mkdirSync|rmSync|unlinkSync|fetch)\s*\(/
  const hit = code.match(banned)
  assert.equal(hit, null, `self-check 引入了被禁 API：${hit && hit[1]}（本脚本承诺零 spawn / 零写盘 / 零网络）`)
  assert.ok(!/child_process/.test(code), 'self-check 不得引入 child_process')
})
