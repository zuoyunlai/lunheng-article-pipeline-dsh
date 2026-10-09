// ablation-report 干跑测试（v18.83.0 · AgentWrite 借鉴批 AW-1）
// 覆盖：路径错 exit 10 / 参数错 exit 10 / 空 run 目录如实报 0 份（exit 0）/ 夹具项目进表 + JSON 契约。
// 只做干跑（临时目录夹具），**不触碰仓库 run/**，也不真实重跑任何项目——与脚本「存量回放、只读」设计一致。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts', 'ablation-report.mjs')
const run = (args) => {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }
  }
}
const tmp = (tag) => {
  const d = join(process.env.TEMP || '/tmp', `ablation-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  mkdirSync(d, { recursive: true })
  return d
}

test('ablation-report：--run-dir 不存在 → exit 10（路径错，不与内容判定撞码）', () => {
  const r = run(['--run-dir', join(process.env.TEMP || '/tmp', 'definitely-not-here-' + Date.now())])
  assert.equal(r.code, 10, r.out.slice(0, 300))
  assert.match(r.out, /不存在或不是目录/)
})

test('ablation-report：--limit 非整数 / 未知参数 → exit 10', () => {
  const d = tmp('args')
  try {
    assert.equal(run(['--run-dir', d, '--limit', 'abc']).code, 10)
    assert.equal(run(['--run-dir', d, '--nope']).code, 10)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('ablation-report：空 run 目录 → exit 0 且如实报「0 份」（不得佯装成功）', () => {
  const d = tmp('empty')
  try {
    const r = run(['--run-dir', d])
    assert.equal(r.code, 0, r.out.slice(0, 300))
    assert.match(r.out, /样本：\*\*0\*\* 份/)
    // 覆盖边界必须与读数同时出现（防「未测」被读成「已核」）
    assert.match(r.out, /LLM 判定类不在读数内/)
    assert.match(r.out, /存量回放 ≠ 开\/关 A\/B/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('ablation-report：夹具项目进表；--json 契约（schema/sampleSize/coverage）', () => {
  const d = tmp('fixture')
  const proj = join(d, 'proj-x', 'final')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, '定稿.md'), [
    '# 测试稿',
    '',
    '## 摘要',
    '这是摘要。',
    '',
    '## 一、引言',
    '本文讨论一个测试问题，用于验证存量回放读数能正确把项目列进表内。',
    '',
    '## 参考文献',
    '[L01] 某人. 某文[J]. 某刊, 2020.',
    '',
  ].join('\n'), 'utf8')
  try {
    const md = run(['--run-dir', d])
    assert.equal(md.code, 0, md.out.slice(0, 400))
    assert.match(md.out, /\| proj-x \|/)
    assert.match(md.out, /\| 机制 \| 硬命中\(P0\+P1\) \| 软提示\(P2\) \| 通过 \| 有判定 \| 硬命中率 \|/)
    assert.match(md.out, /structure（结构战略门）/)
    // 口径限制必须随读数出现（防「默认档命中」被读成「真实缺陷数」）
    assert.match(md.out, /口径限制/)
    assert.match(md.out, /体裁适用性按既有 N\/A 口径处理/)
    assert.match(md.out, /可读性读数存在循环/)
    // N/A 不进分母：夹具无「方法/结果」节 → structure/methodology 记 N/A，cite-coverage 照判
    assert.match(md.out, /\| proj-x \| 42 \| N\/A \| N\/A \| P1 \|/)
    assert.match(md.out, /\| structure（结构战略门） \| 0 \| 0 \| 0 \| 0 \| — \| 1 \|/)

    const js = run(['--run-dir', d, '--json'])
    assert.equal(js.code, 0, js.out.slice(0, 400))
    const obj = JSON.parse(js.out)
    assert.equal(obj.schema, 'lunheng-ablation-report/v1')
    assert.equal(obj.sampleSize, 1)
    assert.equal(obj.rows[0].name, 'proj-x')
    assert.deepEqual(obj.coverage.covered.slice(0, 3), ['structure', 'methodology', 'cite-coverage'])
    assert.ok(obj.coverage.notCovered.includes('G14'))
    assert.ok(obj.rows[0].readability.severity === 'PASS' || obj.rows[0].readability.severity === 'P2')
    // 硬/软分列：每个机制的 hard + soft + ok 必须等于有判定样本数（否则聚合口径漂）
    for (const s of obj.summary) assert.equal(s.hard + s.soft + s.ok, s.denom)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
