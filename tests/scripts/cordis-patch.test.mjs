// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 cordis-patch 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/cordis-patch.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('cordis.patch.yml：三档 agentOptions 表达式形态正确（未设=undefined，只给 model 亦生效，含一键退路）', () => {
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
  const exprs = [...patch.matchAll(/agentOptions:\s*!!js\s+"(.+?)"\s*$/gm)].map((m) => m[1])
  assert.equal(exprs.length, 3, '应恰有三档 agentOptions 表达式（检索/强推理/审计）')
  const evalWith = (expr, env) => new Function('process', `return (${expr})`)({ env })
  // ① 全未设 → undefined（**不得传 {}**：空对象会触发 provider 的 agentOptions 能力门）
  for (const e of exprs) assert.equal(evalWith(e, {}), undefined, '未设任何 env 时必须为 undefined（全继承）')
  // ② 只给 model → {model}（字段独立：provider 由宿主逐字段继承父级）
  assert.deepEqual(evalWith(exprs[0], { LUNHENG_RETRIEVAL_MODEL: 'X' }), { model: 'X' }, '只给 model 必须生效')
  // ③ 只给 provider → {provider}
  assert.deepEqual(evalWith(exprs[0], { LUNHENG_RETRIEVAL_PROVIDER: 'P' }), { provider: 'P' })
  // ④ 两者都给
  assert.deepEqual(evalWith(exprs[0], { LUNHENG_RETRIEVAL_PROVIDER: 'P', LUNHENG_RETRIEVAL_MODEL: 'X' }), { provider: 'P', model: 'X' })
  // ⑤ 一键退路 LUNHENG_TIERING=off（即便其它变量已设）
  assert.equal(evalWith(exprs[0], { LUNHENG_TIERING: 'off', LUNHENG_RETRIEVAL_PROVIDER: 'P', LUNHENG_RETRIEVAL_MODEL: 'X' }), undefined, 'kill switch 必须压过其它变量')
  // ⑥ 红线复核：表达式内不得出现被禁标识符
  for (const e of exprs) {
    assert.ok(!/require\(|import\(|eval\(|fs\.|node:|child_process|getBuiltinModule|new Function/.test(e), '分档表达式不得含被禁标识符：' + e.slice(0, 60))
  }
  // ⑦ 不得再写死厂商默认模型（宿主无模型级回退，写错 = 该档不可用）
  for (const bad of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
    assert.ok(!patch.includes(bad), `cordis.patch.yml 不得硬编码厂商默认模型 ${bad}——应由 model-routing.mjs 按本机实况生成`)
  }
})

