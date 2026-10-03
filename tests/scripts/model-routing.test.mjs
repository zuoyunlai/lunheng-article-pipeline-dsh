// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 model-routing 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/model-routing.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('model-routing.mjs：按本机 settings.yaml 给档位建议，且跨 provider 时同时输出 _PROVIDER', () => {
  const d = tmp()
  const home = join(d, 'dshhome')
  mkdirSync(home, { recursive: true })
  // 夹具：默认 provider 有两个模型（高/低版本），另有一个本地 provider
  writeFileSync(join(home, 'settings.yaml'), [
    'agent-default-model:',
    '  provider: cloud-x',
    '  model: X-Pro-3',
    'llm-pi-ai:',
    '  providers:',
    '    cloud-x:',
    '      displayName: Cloud X',
    '      baseURL: https://api.example.com/v1',
    '      models:',
    '        - id: X-Pro-3',
    '          contextWindow: 200000',
    '        - id: X-Mini-1',
    '          contextWindow: 32000',
    '    local-y:',
    '      baseURL: http://127.0.0.1:11434/v1',
    '      models:',
    '        - id: y-qwen:14b',
    '          contextWindow: 32000',
    '',
  ].join('\n'))
  const r = run([join(SCRIPTS, 'model-routing.mjs'), '--dsh-home', home, '--no-probe', '--json'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const j = parseJson(r)
  const byTier = Object.fromEntries(j.routing.map((x) => [x.tier, x]))
  assert.ok(byTier.retrieval.pick, '检索档应有候选')
  assert.ok(byTier.audit.pick, '审计档应有候选')
  assert.equal(byTier.audit.pick, 'X-Pro-3', '批判审计档应选同族高版本强模型')
  assert.equal(byTier.strong.pick, 'X-Pro-3', '分析写作档应选强推理模型')
  // 主人指定的四档表：T6 属批判审计档；T9 亦归此档（推断）；T8 不适用；T0 不参与路由
  assert.ok(byTier.audit.roles.some((x) => x.startsWith('T6')), 'T6 批判必须在批判审计档（主人指定表）')
  assert.ok(byTier.audit.roles.some((x) => x.startsWith('T9')), 'T9 审稿归批判审计档（主人确认）')
  assert.ok(byTier.audit.roles.some((x) => x.startsWith('G14')), 'G14 检测归批判审计档（主人确认）')
  assert.ok(byTier.strong.roles.some((x) => x.startsWith('T4')) && byTier.strong.roles.some((x) => x.startsWith('T5')), '分析写作档 = T4/T5')
  assert.match(j.t8.strategy, /不适用/, 'T8 终检不适用分档')
  assert.ok(j.t0.suggest, '主控档应给稳定性建议（但不由论衡自动改宿主配置）')
  assert.match(j.t0.strategy, /不参与分档路由/, '主控不参与路由')
  // **检索档默认「本地优先 + 远程兜底」**：--no-probe 下本地视为可用 → 主选本地、兜底为远端
  assert.match(byTier.retrieval.pick, /qwen/, '检索档默认应本地优先')
  assert.equal(byTier.retrieval.pickLocal, true, '检索档主选应为本地模型')
  assert.equal(byTier.retrieval.crossProvider, true, '本地模型属另一 provider → 必须标记跨 provider')
  assert.ok(byTier.retrieval.fallback && byTier.retrieval.fallback.local === false, '本地主选必须带**远端兜底**')
  assert.ok(j.envSnippet.powershell.some((l) => l.includes('LUNHENG_RETRIEVAL_PROVIDER')), '跨 provider 必须同时输出 _PROVIDER')
  assert.equal(byTier.audit.pickLocal, false, '批判审计档不得用本地小模型')
  // --prefer-remote：忽略本地优先（主人显式选择「不用本地」）
  const r2 = run([join(SCRIPTS, 'model-routing.mjs'), '--dsh-home', home, '--no-probe', '--prefer-remote', '--json'])
  const j2 = parseJson(r2)
  const t2 = Object.fromEntries(j2.routing.map((x) => [x.tier, x]))
  assert.equal(t2.retrieval.pickLocal, false, '--prefer-remote 时检索档不得选本地')
  assert.equal(t2.retrieval.crossProvider, false, '同 provider 匹配 → 不输出 _PROVIDER')
  assert.equal(t2.audit.pick, 'X-Pro-3', '审计档不受 --prefer-remote 影响')
  rmSync(d, { recursive: true, force: true })
})

// v18.18.12（审计 F-5 转行为断言）：原用例三条断言**全是源码文本**——
//   `!/process\.exit\(3\)/`、`/process\.exit\(anyMissing \? 4 : 0\)/`、`/返回码：0 = 三档都有主选；4 =/`。
//   第三条正是让那个陈旧的「读不到配置」码活到本版的原因：它只核了**前缀**「0 = …；4 =」，
//   后面多挂一个早已不存在的码照样绿（假绿）；而真去改那行行文又会无故变红（假红）。
//   现改为行为断言：**造一个「所有档位都没有候选」的 settings.yaml**，断言脚本真按 `4` 退出
//   （= 「需人工决定」自有码，不是 M 门的 1/2/3）；并保留「用法/配置错必须 10」的行为对照，
//   这两条一起钉住「3 与 1 都不再用」这个事实。头注释与契约行的一致性由仓库门 ⑧d 机械钉住。
test('model-routing：无可用模型时 exit 4、配置错时 exit 10（行为，旧版是 3 与 1）', () => {
  const d = tmp('lunheng-mr-')
  const home = join(d, 'dsh-home')
  mkdirSync(home, { recursive: true })
  // provider 存在但**一个模型都没登记** ⇒ inventory 为空 ⇒ 走「没有可用模型」分支
  writeFileSync(
    join(home, 'settings.yaml'),
    ['providers:', '  testprov:', '    displayName: "Test"', '    baseURL: "https://api.example.com/v1"', ''].join('\n'),
    'utf8',
  )
  const r4 = run([join(SCRIPTS, 'model-routing.mjs'), '--dsh-home', home, '--json', '--no-probe'])
  assert.equal(r4.code, 4, '无可用模型应 exit 4（需人工决定），实得 ' + r4.code + '：' + (r4.out + r4.err).slice(0, 300))
  assert.notEqual(r4.code, 3, '不得用 3（与 M 门「仅 P2·soft·SKIP，可放行」撞码）')
  assert.match(r4.out, /没有可用模型/, '应给出可读原因')

  // 配置读不到 ⇒ 10（旧版是 1，与 M 门「P1 内容失败」撞义）
  const r10 = run([join(SCRIPTS, 'model-routing.mjs'), '--dsh-home', join(d, 'nonexistent-home'), '--json'])
  assert.equal(r10.code, 10, '读不到 settings.yaml 应 exit 10，实得 ' + r10.code)
  assert.notEqual(r10.code, 1, '不得退回 1（= M 门「P1 内容失败」，会让主控误触发 T5 修订轮）')

  rmSync(d, { recursive: true, force: true })
})
