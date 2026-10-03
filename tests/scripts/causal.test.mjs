// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 causal 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/causal.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('v18.2.9 方案：causal.mjs 三档词表逐词注入（删任意一词必红）', async () => {
  const { causalStrength, CAUSAL_WORDS } = await import(pathToFileURL(join(SCRIPTS, '_lib', 'causal.mjs')).href)
  const cases = [
    ['strong', CAUSAL_WORDS.strong.en, CAUSAL_WORDS.strong.zh],
    ['suggestive', CAUSAL_WORDS.suggestive.en, CAUSAL_WORDS.suggestive.zh],
    ['null', CAUSAL_WORDS.null.en, CAUSAL_WORDS.null.zh],
  ]
  for (const [tier, en, zh] of cases) {
    for (const w of en) assert.equal(causalStrength(`The result ${w} the outcome.`), tier, `英文「${w}」应判 ${tier}`)
    for (const w of zh) assert.equal(causalStrength(`该发现${w}该结论`), tier, `中文「${w}」应判 ${tier}`)
  }
  // 反例：无因果词 → null；弱档词不被强档误判
  assert.equal(causalStrength('这是一段没有因果词的叙述。'), null)
  assert.equal(causalStrength('no significant difference'), 'null')
})
