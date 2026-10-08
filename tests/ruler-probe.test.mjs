// ruler-probe 干跑测试（v18.82.0 · LongWriter 借鉴批 LW-3）
// 覆盖：--plan 请求计划形态 / --record 对账判定（达标上限 + 塌缩标注）/ 参数错误 exit 10。
// 只做干跑（--record 用临时 txt 夹具），不真实调用任何模型——与脚本「两段式、不内置调用」设计一致。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts', 'ruler-probe.mjs')
const run = (args) => {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }
  }
}

test('ruler-probe --plan：输出请求计划（模型×档位 prompt），exit 0', () => {
  const r = run(['--plan', '--models', 'mA,mB', '--levels', '1000,2000'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  assert.match(r.out, /# ruler-probe 请求计划/)
  assert.match(r.out, /## mA/)
  assert.match(r.out, /恰好 1000 个汉字/)
  assert.match(r.out, /## mB/)
})

test('ruler-probe --record：比率 ≥0.9 判有效上限，未测档标（未测）', () => {
  const d = join(process.env.TEMP || '/tmp', `ruler-probe-test-${Date.now()}`)
  mkdirSync(join(d, 'mA'), { recursive: true })
  writeFileSync(join(d, 'mA', '1000.txt'), '汉'.repeat(980))   // 比率 0.98 → 达标
  writeFileSync(join(d, 'mA', '2000.txt'), '汉'.repeat(900))   // 比率 0.45 → 不达标
  // 8000 档不存 → （未测）
  const r = run(['--record', d, '--models', 'mA', '--levels', '1000,2000,8000'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  assert.match(r.out, /\| mA \| 1000 \| 980 \| 0\.98 /)
  assert.match(r.out, /（未测）/)
  assert.match(r.out, /有效上限 = 比率 ≥0\.9/, '必须自带判定口径声明')
  assert.match(r.out, /模型路由\.md §十/, '必须指明粘贴去向')
  rmSync(d, { recursive: true, force: true })
})

test('ruler-probe：参数错误一律 exit 10（缺 --models / 缺目录）', () => {
  assert.equal(run(['--plan']).code, 10)
  assert.equal(run([]).code, 10)
  assert.equal(run(['--record', join(process.env.TEMP || '/tmp', '不存在目录-x7z'), '--models', 'mA']).code, 10)
})
