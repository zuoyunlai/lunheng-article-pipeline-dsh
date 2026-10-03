// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 final-check 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/final-check.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('final-check：应把 M 门报告落到真源路径 final/M-Gate-Report.json（供审计视图读取）', {
  // v18.2.6：带探测的条件跳过。`final-check` 内部要 **spawn 子步骤**（如 `m-gate-check.mjs`）才能产出
  //   `final/M-Gate-Report.json`；受限会话禁命名管道 → 子步骤起不来 → 按本包既有规则「子步骤失败即中止
  //   终检」→ 报告不落盘。该用例在 CI / 无沙箱 host shell 下照常执行（探测为假）。
  //   ⚠️ 待确认（脚本所有者反馈中）：「子步骤失败即中止」是否仍属设计——若最终改为「子步骤失败仍落盘
  //   部分报告」，这里的 skip 条件需一并复核（本用例本身不应被弱化）。
  skip: skipWhen(PIPE_SPAWN_BLOCKED, '宿主禁止子进程开命名管道（探测：对 process.execPath 做 spawn 管道 → EPERM）——final-check 需 spawn 子步骤（m-gate-check 等）才会落 final/M-Gate-Report.json，本环境下子步骤起不来 → 按既有规则中止终检。请在无文件沙箱的 host shell 或 CI 复核；受限 DSH 会话下无法执行，且不得用 LLM 断言替代机检结论。'),
}, () => {
  const d = tmp()
  const proj = join(d, 'proj')
  const fin = join(proj, 'final')
  mkdirSync(join(fin, '证据包'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  run([join(SCRIPTS, 'final-check.mjs'), proj, '--no-summary'])
  assert.ok(existsSync(join(fin, 'M-Gate-Report.json')), 'M 门报告应落在 final/M-Gate-Report.json')
  rmSync(d, { recursive: true, force: true })
})

test('final-check：正斜杠 --report 路径不得崩溃（旧版硬编码反斜杠 → mkdir \'\' ENOENT）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  const reportRel = 'audits/final.json'
  const r = run([join(SCRIPTS, 'final-check.mjs'), proj, '--no-summary', '--report', join(proj, reportRel)])
  assert.ok(!/ENOENT|mkdir/.test(r.out), `不应出现 mkdir/ENOENT 崩溃：${r.out.slice(0, 200)}`)
  assert.ok(existsSync(join(proj, reportRel)), '报告应落盘')
  rmSync(d, { recursive: true, force: true })
})
