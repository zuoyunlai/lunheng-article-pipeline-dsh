// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 destructive-write 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/destructive-write.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('v18.3.1 审计 B4：.bak 上限回收——同文件写 N 次只留最近 BAK_MAX 个回滚点', async () => {
  const { writeWithSafety, BAK_MAX } = await import(pathToFileURL(join(SCRIPTS, '_lib', 'destructive-write.mjs')).href)
  const d = tmp()
  const f = join(d, 'a.md')
  writeFileSync(f, 'v0')
  // 写 30 次（每次覆盖前自动备份上一次内容）→ 30 个 .bak → 回收至 BAK_MAX
  for (let i = 1; i <= 30; i++) writeWithSafety(f, `v${i}`, { inPlace: true })
  const baks = readdirSync(d).filter((x) => x.startsWith('a.md.') && x.endsWith('.bak'))
  assert.equal(baks.length, BAK_MAX, `应只保留 ${BAK_MAX} 个 .bak（实测 ${baks.length}）`)
  assert.equal(readFileSync(f, 'utf8'), 'v30', '最终内容应为最后一次写入')
  const contents = baks.map((x) => readFileSync(join(d, x), 'utf8'))
  assert.ok(contents.includes('v29'), '最新回滚点 v29 应保留')
  // 2026-10-09（检索审计反哺 R7）：BAK_MAX 20 → 6，断言改为按常量派生（夹具不再绑死具体值）
  assert.ok(contents.includes(`v${30 - BAK_MAX}`), `第 ${BAK_MAX} 新回滚点 v${30 - BAK_MAX} 应保留（更旧者已回收）`)
  assert.ok(!contents.includes(`v${29 - BAK_MAX}`), `v${29 - BAK_MAX} 及更早应被回收（防无限累积）`)
  rmSync(d, { recursive: true, force: true })
})
