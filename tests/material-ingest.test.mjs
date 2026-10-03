// 一手材料摄取（材料摄取.md + 三处落点 + 证据包源码钉）回归测试（v18.63.1）
//
// 覆盖四条判据（每条都对应一个**实测过的失效形态**，不是形式检查）：
//   ① **保底档存在**：四档阶梯里 C/D 档必须「无需任何外部能力」——否则重演 v18.62.7 §A19
//      「默认层的前提在别的宿主上不成立」，把「装了才能用」写成常态。
//   ② **反向钉**：不得把 markitdown / bundled Python 写成**前置条件**（形如「必须先装」）。
//   ③ **落点在场**：投喂清单模板 + 任务简报模板各自必须有 `摄取工具面`/指针——
//      判据同 v18.62.7：「外移 = Phase 0 没有落点 = 该发现在运行期不存在」。
//   ④ **源码钉（主人 2026-10-03 定案）**：`materials/` 不进 `final/证据包/`——
//      `build-evidence-bundle.mjs` 的源清单里不得出现该目录；且它**只**是文档口径，
//      故本项刻意不进 M 门编号体系（对照表 §三 登记为人工兜底）。
// 运行：node --test tests/material-ingest.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './_fixtures.mjs'

const SKILL = join(ROOT, 'skills', 'lunheng-article-pipeline')
const INGEST = join(SKILL, 'references', '_shared', '材料摄取.md')
const BRIEF = join(SKILL, 'references', 'templates', '任务简报-template.md')
const FEED = join(SKILL, 'references', 'templates', '主人投喂清单-template.md')
const TABLE = join(SKILL, 'references', '_shared', '规范-机械门对照表.md')
const PROGRESS = join(SKILL, 'references', 'templates', '进展-主人版-template.md')
const BUNDLE = join(SKILL, 'scripts', 'build-evidence-bundle.mjs')

const read = (p) => readFileSync(p, 'utf8')

test('真源在盘：四档阶梯齐备，且 C/D 两档都是「无需任何外部能力」的保底档', () => {
  assert.ok(existsSync(INGEST), '缺 references/_shared/材料摄取.md（摄取口径的唯一真源）')
  const t = read(INGEST)
  for (const rung of ['**A 档**', '**B 档**', '**C 档（真保底）**', '**D 档（终保底）**']) {
    assert.ok(t.includes(rung), `四档阶梯缺 ${rung}——降级链不完整`)
  }
  // C 档必须是「任何宿主都有」的地板：这是「论衡装上就能用」的那一条
  const cRow = t.split('\n').find((l) => l.includes('**C 档（真保底）**'))
  assert.match(cRow, /无需任何外部能力/, 'C 档必须写明「无需任何外部能力」——否则它不是真保底')
  assert.match(cRow, /任何 DSH 宿主都有/, 'C 档必须显式声明「任何 DSH 宿主都有」')
  // 通用性底线句必须在场（与外部检索源接入面 §0 同源的判据）
  assert.match(t, /不要求任何宿主预先安装/, '缺少通用性底线句：论衡不要求宿主预装任何摄取工具')
  assert.ok(t.includes('build-evidence-bundle') && /不进 `final\/证据包\/`/.test(t), '缺少「materials/ 不进证据包」的口径')
})

test('反向钉：不得把 markitdown / bundled Python 写成前置条件（缺则降档，不得中止）', () => {
  const t = read(INGEST)
  const banned = [
    /(必须|需要)先(安装|装)\s*`?(markitdown|python)/i,      // 「必须先装 markitdown」
    /前置条件\s*[：:]\s*`?(markitdown|python)/i,             // 「前置条件：markitdown」
    /(未安装|没装)[^\n]{0,20}(中止|停止|无法继续)/,          // 「未安装则中止」
  ]
  for (const re of banned) {
    assert.equal(re.test(t), false, `材料摄取.md 出现了把工具写成前置条件的写法：${re}`)
  }
  assert.match(t, /不得中止 Phase 0|不得中止、不得当缺口/, '缺少「缺工具不得中止」的显式禁令')
  assert.match(t, /不得编造工具名/, '缺少「不得编造工具名」的显式禁令')
})

test('落点在场：投喂清单模板与任务简报模板各有一个可填的挂载点（外移≠消失）', () => {
  for (const [p, label] of [[FEED, '主人投喂清单-template.md'], [BRIEF, '任务简报-template.md']]) {
    const t = read(p)
    assert.ok(t.includes('材料摄取.md'), `${label} 缺指向材料摄取.md 的指针——运行期读不到该口径`)
    assert.ok(t.includes('摄取工具面'), `${label} 缺 \`摄取工具面:\` 挂载点（Phase 0 探测结果无处落盘）`)
  }
  // 任务简报的两行形态必须与「检索工具面」平行（便于主控照抄）
  const b = read(BRIEF)
  assert.match(b, /本轮摄取档位\s*[:：]/, '任务简报缺「本轮摄取档位:」行')
  for (const d of ['A 档', 'B 档', 'C 档', 'D 档']) {
    assert.ok(b.includes(d), `任务简报的档位行缺 ${d}`)
  }
})

test('源码钉：materials/ 不进证据包——build-evidence-bundle 的源清单不得含该目录', () => {
  const src = read(BUNDLE)
  assert.equal(/materials/.test(src), false,
    'build-evidence-bundle.mjs 出现了 materials——它是中间产物（转录稿），不得进 final/证据包/（主人 2026-10-03 定案）')
})

test('⑥ 提醒通道②的落点在场：`进展-主人版-template.md` 必须给「需要你做的事」栏一个**材料摄取勾选项**', () => {
  // 为什么这条必须钉（v18.64.2 · 独立审计 C-P1-1）：§4.2 说「提醒必须落常驻窗口」，而**常驻窗口的骨架
  //   就在这个模板里**——模板没这一行，主控照着写进展页时就不会带上它，四通道里的第 ② 条等于不存在
  //   （判据同 v18.62.7 §A19：「外移 = 运行期没有落点 = 该发现在运行期不存在」）。
  const t = read(PROGRESS)
  assert.ok(t.includes('材料摄取'), '进展-主人版模板缺「材料摄取」待办项（通道② 无落点）')
  assert.ok(t.includes('materials/'), '该待办项必须写明产物落点 `materials/`')
  assert.ok(t.includes('材料摄取.md'), '该待办项必须指向口径真源（材料摄取.md §4）')
  // 空/未摄取状态也要有诚实写法（「未纳入」而非「不存在」）
  assert.match(t, /未纳入/, '「已知缺口」栏缺「未纳入」的诚实写法')
})

test('登记面：对照表 §三 已登记该规范为「人工兜底」（刻意不加门）', () => {
  const t = read(TABLE)
  const row = t.split('\n').find((l) => l.includes('一手材料摄取'))
  assert.ok(row, '对照表缺「一手材料摄取」这一行——AGENTS.md 要求新增规范必须在该表登记')
  assert.match(row, /刻意不加门/, '该行必须写明「刻意不加门」及理由（否则后人会当漏项来补门）')
  assert.match(row, /material-ingest\.test\.mjs/, '该行必须指向钉住它的测试（源码钉是它唯一的机械覆盖）')
})
