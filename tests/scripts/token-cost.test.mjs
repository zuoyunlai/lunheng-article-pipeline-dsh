// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 token-cost 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/token-cost.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('token-cost --top N：按 cacheRead 降序给出排名（旧版只有头注释与 CHANGELOG 承诺，代码里是死变量 topMode=false）', () => {
  const d = tmp()
  const home = join(d, 'dshhome')
  mkdirSync(join(home, 'storages'), { recursive: true })
  const t = (cacheRead, outputTokens) => ({ uncachedInputTokens: 10, cacheReadTokens: cacheRead, cacheWriteTokens: 20, outputTokens })
  writeFileSync(join(home, 'storages', 'session_projcache.json'), JSON.stringify({
    tables: {
      sessions: {
        'main-1': { rows: { tokenUsage: { val: { totals: t(5000000, 3000) } } } },
        'sub-a': { rows: { tokenUsage: { val: { totals: t(20000000, 4000) } } } },
        'sub-b': { rows: { tokenUsage: { val: { totals: t(100000, 700) } } } },
      },
    },
  }))
  const base = [join(SCRIPTS, 'token-cost.mjs'), '--dsh-home', home, '--sessions', 'main-1,sub-a,sub-b']
  const r = run([...base, '--top', '2'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const j = parseJson(r)
  assert.equal(j.topByCacheRead.length, 2, 'Top 2 应只给两条')
  assert.equal(j.topByCacheRead[0].session, 'sub-a', 'cacheRead 最大者必须排第一')
  assert.ok(j.topByCacheRead[0].cacheReadShareOfTotalPct > j.topByCacheRead[1].cacheReadShareOfTotalPct, 'share 必须递减')
  assert.ok(j.topByCacheRead[0].costEstimateUsd > 0, '必须给单会话成本估算')
  // 向后兼容：不传 --top 时输出契约不变（不得凭空多出字段）
  assert.equal(parseJson(run(base)).topByCacheRead, undefined, '无 --top 时不得输出排名段')
  // 非法值必须报错，不得静默忽略（与 --price-* 的 NaN 防御同口径）
  // v18.12.0（L-67）：契约由 exit 1 → **exit 10**。旧断言编码的是「用法错 = 1」，而 1 是 M 门的
  //   「P1 内容失败」——主控会把「--top 写错」读成「正文有 P1 残留」并误触发 T5 修订轮。
  //   本脚本没有内容判定，故**整个 1 都被取消**（见 docs/troubleshooting.md §8 与 EXIT_CONTRACT）。
  assert.equal(run([...base, '--top', '0']).code, 10, '--top 0 应 exit 10（参数错）')
  assert.equal(run([...base, '--top', 'x']).code, 10, '--top x 应 exit 10（参数错）')
  assert.equal(run([...base, '--nope']).code, 10, '未知参数应 exit 10（旧版静默忽略；v18.12.0 起不再借用 1）')
  rmSync(d, { recursive: true, force: true })
})
