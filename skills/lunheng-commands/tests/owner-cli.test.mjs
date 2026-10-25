#!/usr/bin/env node
// 主人侧入口 CLI 的 E2E 回归（v19.27.8 · 审计 P2-2）
//
// **为什么必须有这一层**：`route.test.mjs` 的三条新用例只覆盖**路由**（`-gate` / `-abort` 被正确解析并
//   转交给 owner-cli），不覆盖 owner-cli 自己**写了什么**。而 P2-2 的全部价值就在那个写入：
//   账本里的 `rawAnswer` 必须是主人**原样打的字**（A7 之后会拿它和 §6 逐字比），`round` 必须按门递增
//   （否则 handoff-check 的 `_key = gate#round` 会对不上），越界路径必须被拒（run-path-fence 是三层的真源）。
//   这三件事任一退化，P2-2 就退回「主控自己写账本」的老路——而这正是本次修的东西。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'scripts', 'owner-cli.mjs')

const mkRun = () => {
  const root = mkdtempSync(join(tmpdir(), 'lunheng-owner-'))
  const runDir = join(root, 'run')
  const projectDir = join(runDir, '测试项目')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'status.md'), '# 状态\n\n| Phase | 状态 |\n| --- | --- |\n| Phase 0 | 已确认 |\n', 'utf8')
  return { root, runDir, projectDir, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const run = (args, runDir) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--run-dir', runDir, '--json'], { encoding: 'utf8' })
  let json = null
  try { json = JSON.parse((r.stdout || '').trim()) } catch { /* 非 JSON 时留给断言看原文 */ }
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', json }
}

test('-gate --approve：rawAnswer 就是主人原样打的字，decision/tool/round 齐备', () => {
  const f = mkRun()
  try {
    const r = run(['gate', '测试项目', 'Phase2.5', '--approve', '--note', '这批检索够用了，进分析'], f.runDir)
    assert.equal(r.code, 0, `应 exit 0，实得 ${r.code}\n${r.err}`)
    assert.ok(r.json?.ok, 'JSON 应 ok:true')

    const ledger = join(f.projectDir, 'audits', 'gate-receipts.jsonl')
    assert.ok(existsSync(ledger), '必须落 audits/gate-receipts.jsonl')
    const lines = readFileSync(ledger, 'utf8').split(/\r?\n/).filter((l) => l.trim())
    assert.equal(lines.length, 1, '一次裁定 = 一行')
    const rec = JSON.parse(lines[0])
    assert.equal(rec.rawAnswer, '这批检索够用了，进分析', 'rawAnswer 必须逐字等于主人打的字（A7 靠它比对 §6）')
    assert.equal(rec.decision, 'approve')
    assert.equal(rec.tool, 'owner-cli')
    assert.equal(rec.gate, 'Phase2.5')
    assert.equal(rec.round, 1)
  } finally { f.cleanup() }
})

test('-gate 第二轮：同门 round 递增（handoff-check 的 gate#round 靠它对齐）', () => {
  const f = mkRun()
  try {
    assert.equal(run(['gate', '测试项目', 'Phase0', '--approve', '--note', '开题可以'], f.runDir).code, 0)
    const r2 = run(['gate', '测试项目', 'Phase0', '--reject', '--note', '题目还得换'], f.runDir)
    assert.equal(r2.code, 0, `应 exit 0，实得 ${r2.code}\n${r2.err}`)
    assert.equal(r2.json?.key, 'Phase0#2', '第二轮应是 Phase0#2')

    const recs = readFileSync(join(f.projectDir, 'audits', 'gate-receipts.jsonl'), 'utf8')
      .split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l))
    assert.equal(recs.length, 2)
    assert.deepEqual(recs.map((x) => x.round), [1, 2])
    assert.deepEqual(recs.map((x) => x.decision), ['approve', 'reject'])
    assert.equal(recs[1].rawAnswer, '题目还得换', '驳回那条的 rawAnswer 同样必须逐字')
  } finally { f.cleanup() }
})

test('-abort：落 audits/abort.json（含 reason + by），且**不删任何既有产物**', () => {
  const f = mkRun()
  try {
    const before = readFileSync(join(f.projectDir, 'status.md'), 'utf8')
    const r = run(['abort', '测试项目', '--reason', '数据拿不到，先停'], f.runDir)
    assert.equal(r.code, 0, `应 exit 0，实得 ${r.code}\n${r.err}`)

    const marker = join(f.projectDir, 'audits', 'abort.json')
    assert.ok(existsSync(marker), '必须落 audits/abort.json')
    const rec = JSON.parse(readFileSync(marker, 'utf8'))
    assert.equal(rec.reason, '数据拿不到，先停')
    assert.equal(rec.by, 'owner-cli')
    assert.ok(rec.abortedAt, '须有时间戳')
    assert.equal(readFileSync(join(f.projectDir, 'status.md'), 'utf8'), before, '中止不是回滚：既有产物一律保留')
  } finally { f.cleanup() }
})

test('越界/不存在：项目不在 run/ 下一律 exit 20，且**不创建** audits 目录', () => {
  const f = mkRun()
  try {
    const r = run(['gate', '不存在的项目', 'Phase5', '--approve'], f.runDir)
    assert.equal(r.code, 20, `未知项目应 exit 20（run-path-fence），实得 ${r.code}`)
    assert.ok(!existsSync(join(f.runDir, '不存在的项目')), '不得凭名字创建项目目录')

    const r2 = run(['gate', '测试项目', 'Phase9', '--approve'], f.runDir)
    assert.notEqual(r2.code, 0, '未知门次必须拒绝')

    const r3 = run(['gate', '测试项目', 'Phase5', '--approve', '--reject'], f.runDir)
    assert.notEqual(r3.code, 0, '--approve 与 --reject 同时给出必须拒绝')
    assert.ok(!existsSync(join(f.projectDir, 'audits')), '被拒的调用不得留下 audits 目录')
  } finally { f.cleanup() }
})
