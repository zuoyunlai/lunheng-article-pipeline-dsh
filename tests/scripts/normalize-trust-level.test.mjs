// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 normalize-trust-level 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/normalize-trust-level.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('normalize-trust-level：缺 token 必须拒绝推断并以 exit 1 收尾（旧版默认填「已发布」）', () => {
  const d = tmp()
  const f = join(d, '卡.md')
  writeFileSync(f, '# 数据卡\n\n## [D01] 某公报\n来源：stats.gov.cn\n摘要：某数据。\n')
  const r = run([join(SCRIPTS, 'normalize-trust-level.mjs'), f])
  assert.equal(r.code, 1, '缺 token 应 exit 1')
  assert.match(r.out, /拒绝推断/)
  assert.ok(!readFileSync(f, 'utf8').includes('信任级别：'), '不得写入任何推断值')
  rmSync(d, { recursive: true, force: true })
})

test('normalize-trust-level：默认 dry-run 不落盘；--write 落盘写时间戳 .bak，两次写盘不抹上一次回滚点（v18.7.3 P1-1）', () => {
  const d = tmp()
  const f = join(d, '卡.md')
  writeFileSync(f, '# 数据卡\n\n## [D07] 某报告\n摘要：本数据二手转引自某日报。\n')
  const dry = run([join(SCRIPTS, 'normalize-trust-level.mjs'), f])
  assert.equal(dry.code, 0)
  assert.ok(!readFileSync(f, 'utf8').includes('信任级别：'), 'dry-run 不得落盘')
  const baks = () => readdirSync(d).filter((x) => x.startsWith('卡.md.') && x.endsWith('.bak'))
  const w = run([join(SCRIPTS, 'normalize-trust-level.mjs'), f, '--write'])
  assert.equal(w.code, 0)
  assert.match(readFileSync(f, 'utf8'), /信任级别：二手转引/)
  assert.ok(baks().length === 1, '应写时间戳 .bak 备份（writeWithSafety）：' + baks().join(','))
  // 二次写盘（再插入一条不同卡）：旧实现的固定名 .bak 会抹掉第一次的回滚点——时间戳 .bak 必须保留两个
  const firstBak = baks()[0]
  writeFileSync(f, readFileSync(f, 'utf8') + '\n## [D08] 另一报告\n摘要：主人投喂的内部数据。\n', 'utf8')
  const w2 = run([join(SCRIPTS, 'normalize-trust-level.mjs'), f, '--write'])
  assert.equal(w2.code, 0)
  assert.ok(baks().includes(firstBak), '第二次写盘不得抹掉第一次的回滚点：' + baks().join(','))
  assert.ok(baks().length >= 2, '两次写盘应留下两个回滚点：' + baks().join(','))
  assert.match(readFileSync(f, 'utf8'), /信任级别：主人投喂/)
  rmSync(d, { recursive: true, force: true })
})
