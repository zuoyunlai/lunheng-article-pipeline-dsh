// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 lunheng-stats 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/lunheng-stats.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('lunheng-stats：聚合 run/ 各项目（机器/LLM兜底/无证据 三桶 + 门拦截频率 + 阶段 + 轮数）', () => {
  const d = tmp()
  const runDir = join(d, 'run')
  // 项目 A：机器格式报告 + 3 轮修订 + P0/P2 各一
  const a = join(runDir, 'proj-a')
  mkdirSync(join(a, 'final'), { recursive: true })
  mkdirSync(join(a, 'drafts'), { recursive: true })
  writeFileSync(join(a, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文若干字。\n')
  writeFileSync(join(a, 'drafts', '初稿-v3.md'), '# v3\n')
  writeFileSync(join(a, 'final', 'M-Gate-Report.json'), JSON.stringify({ exit: 2, p0: 1, p1: 0, p2: 1, total: 22, results: [{ gate: 'M-Form-1 引用标注完整性', pass: false, severity: 'P0' }, { gate: 'M-Exist-5 阶段闸门记录表', pass: false, severity: 'P2' }] }))
  // 项目 B：LLM 兜底格式（无 results 数组）
  const b = join(runDir, 'proj-b')
  mkdirSync(join(b, 'final'), { recursive: true })
  writeFileSync(join(b, 'final', '定稿.md'), '# 标题\n\n正文。\n')
  writeFileSync(join(b, 'final', 'M-Gate-Report.json'), JSON.stringify({ 'M-Form_形式合规门': { 'M-Form-1_引用标注完整性': { pass: true } } }))
  // 项目 C：无报告
  const c = join(runDir, 'proj-c')
  mkdirSync(join(c, 'final'), { recursive: true })
  writeFileSync(join(c, 'final', '定稿.md'), '# 标题\n\n正文。\n')
  // v18.67.0（批 3 围栏落地后）：--run-dir 须落在 <cwd>/run 之内（与 pending-cli 同口径）。
  //   故本用例以 tmp 为 cwd、相对路径调用——聚合逻辑的测试意图不变，只是调用形态过围栏。
  const r = run([join(SCRIPTS, 'lunheng-stats.mjs'), '--run-dir', 'run', '--json'], { cwd: d })
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const j = parseJson(r)
  assert.equal(j.projects.length, 3)
  const A = j.projects.find((x) => x.name === 'proj-a')
  assert.equal(A.stage, 'final', '有定稿应记 final')
  assert.equal(A.rounds, 3, '初稿-v3 应计 3 轮')
  assert.equal(A.mgate, 'machine')
  assert.equal(A.exit, 2)
  assert.equal(A.p0, 1)
  const B = j.projects.find((x) => x.name === 'proj-b')
  assert.equal(B.mgate, 'llm-legacy', '无 results 数组的历史格式应归 LLM 兜底')
  const C = j.projects.find((x) => x.name === 'proj-c')
  assert.equal(C.mgate, 'none')
  assert.equal(j.summary.mGateEvidence.machine, 1)
  assert.equal(j.summary.mGateEvidence['llm-legacy'], 1)
  assert.equal(j.summary.mGateEvidence.none, 1)
  assert.equal(j.summary.topFailingGates[0].gate, 'M-Form-1', '拦截频率应按 P0/P1 降序，M-Form-1 的 P0 排最前')
  assert.equal(j.summary.topFailingGates[0].p0, 1)
  rmSync(d, { recursive: true, force: true })
})

test('lunheng-stats：未知参数 / run 目录不存在 → exit 10（与 0=成功区分）', () => {
  const d = tmp()
  assert.equal(run([join(SCRIPTS, 'lunheng-stats.mjs'), '--nope']).code, 10, '未知参数应 exit 10')
  // v18.67.0：cwd 锚定在 d、指向 run/ 内不存在的子路径 → 命中「目录不存在」分支（越界分支由 cli-e2e 钉）
  assert.equal(run([join(SCRIPTS, 'lunheng-stats.mjs'), '--run-dir', 'run/no-such'], { cwd: d }).code, 10, 'run 目录不存在应 exit 10')
  rmSync(d, { recursive: true, force: true })
})
