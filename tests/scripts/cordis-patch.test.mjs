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

// v19.0.0（§4.1 preset 层升格）：示例目录自本版起是**真 preset 目录**。三条 `disabled` / 三条
//   `agentOptions` 与包根 patch 的**同源比对**由 `tests/batch22-structural-v18-80-1.test.mjs` 第3批①
//   承担（v18.80.1 起就在钉，且它还做行为求值）——**同一事实不设两道门**，本用例只补该处没有的三条：
//   ① 组合文件名必须是官方契约名（`COMPOSITION_FILE = 'agent.cordis.yml'`），否则目录「占着 id 却加载不了」；
//   ② 不得复活 `agent-tiered/` 双份（一处事实两处文件 = 下一个漂移源）；
//   ③ 头注释必须写明「为什么叫这个名字」与「preset 不携带技能」这一决定（防后人改回去）。
test('agent.cordis.yml（v19.0.0 §4.1）：preset 组合文件名与头注释契约', () => {
  const presetPath = join(ROOT, 'examples', 'preset', 'agent.cordis.yml')
  assert.ok(existsSync(presetPath), 'preset 组合文件必须叫 agent.cordis.yml（官方 COMPOSITION_FILE 契约名）')
  assert.ok(
    !existsSync(join(ROOT, 'examples', 'preset', 'agent-tiered')),
    'v18.61.0 的 agent-tiered/ 目录已并入 agent.cordis.yml——不得复活成双份',
  )
  const preset = readFileSync(presetPath, 'utf8')
  assert.ok(preset.includes('COMPOSITION_FILE'), '头注释必须写明它为何叫这个名字（防后人改名回 agent-tiered）')
  assert.match(preset, /不携带技能/, '头注释必须写明「preset 不携带技能」这一决定（含 rank 250 vs 300 的静默冲突理由）')
})

