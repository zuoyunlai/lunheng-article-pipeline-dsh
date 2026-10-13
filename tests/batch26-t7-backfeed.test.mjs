// batch26：T7 反哺（项目 xingbie）机制落地钉 —— v19.5.0 批
//
// 覆盖五条（按 `run/xingbie/audits/merge清单-合并版-19条.md` **正文小节号**引用；清单总表序号与小节号不一致）：
//   · §二-9  G14「路径」类计数登记不全 → C 类计数**固定三档** + **词表对账** + **逐处列 L 号** + 报告头**统计口径**
//   · §三-12 交付说明 12 字段清单不在被填模板里 → 12 个字段名进模板头部，`deliverables.md` 改指针
//   · §四-16 同路径同版本号并行写无护栏 → 两处派发话术通用条款都能检索到该句
//   · §四-17 机制版本级联缺「变更面」提示 → 追加提示除版本号外给「行为变更 N 条 + CHANGELOG 锚点」
//   · §四-18 主人侧看不到「卡在哪一步」→ 快照投影「当前 Phase + 上次更新时刻 + 是否在等主人」并渲染
//
// 写这条的理由（v18.79.0 反哺判据）：**反哺条目「改了没有」只能靠机械核**——纯文档条目尤其如此
//   （第 16 条的行为面没有门，只能靠可检索的字符串钉住）。故本文件对五条各给一条**可复现断言**。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { tmp } from './_fixtures.mjs'

const ROOT = join(import.meta.dirname, '..')
const SKILL = join(ROOT, 'skills', 'lunheng-article-pipeline')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const GATE = 'skills/lunheng-article-pipeline/references/gates/14-中文AI痕迹-gate.md'
const G14_TPL = 'skills/lunheng-article-pipeline/references/templates/G14检测报告-template.md'
const DELIV_TPL = 'skills/lunheng-article-pipeline/references/templates/交付说明-template.md'
const DELIVERABLES = 'skills/lunheng-article-pipeline/references/deliverables.md'
const DISPATCH = 'skills/lunheng-article-pipeline/references/dispatch-cards.md'
const README = 'skills/lunheng-article-pipeline/references/pipeline-readme.md'

/** 12 个固定字段：**真源 = 模板头部**（本表只作为断言期望值，与 `## N.` 标题逐项比对）。 */
const DELIV_FIELDS = [
  '路径',
  '图件清单',
  '遗留风险',
  '人工核验项',
  '数据溯源 check-list',
  '成本指标',
  '建议 merge 的反哺清单',
  'AI 使用披露（完整版）',
  '证据包指纹',
  '投稿就绪检查表',
  '主人决策记录',
  '终检结论',
]

// ── §二-9：G14 C 类计数三档 ───────────────────────────────────────────────────

test('batch26 · §二-9：G14 gate §三 把 C 类计数固定为三档（总 / 豁免 / 逐处计入），并要求词表对账与逐处 L 号', () => {
  const t = read(GATE)
  for (const tier of ['总处数', '豁免处数', '逐处计入处数']) {
    assert.ok(t.includes(tier), `gate 文档缺三档之一「${tier}」——三档缺一即视为报告不完整（T7 反哺 N-8）`)
  }
  assert.ok(t.includes('词表对账'), 'gate 文档缺「词表对账」——不在 C 类词表的词不得进分子')
  assert.ok(t.includes('逐处列 L 号'), 'gate 文档缺「逐处列 L 号」——不接受「共 N 处」式汇总数')
  assert.match(t, /统计口径\s*=\s*全文\s*\/\s*正文区/, 'gate 文档缺报告头固定统计口径「统计口径 = 全文 / 正文区」')
  // 三档与两条硬约束必须同处一节（同一口径，读者一次读全）——防止「三档写在 A 节、口径写在 B 节」再漂。
  const idx = t.indexOf('C 类计数与登记三档')
  assert.ok(idx > 0, 'gate 文档缺 §三「C 类计数与登记三档」小节')
  const section = t.slice(idx, idx + 2000)
  assert.ok(section.includes('逐处列 L 号') && section.includes('词表对账'), '三档与词表对账 / 逐处 L 号必须同节')
})

test('batch26 · §二-9：G14 报告模板把三档做成**必填骨架**（含统计口径与逐处清点表）', () => {
  const t = read(G14_TPL)
  assert.ok(t.includes('必填骨架'), '模板缺「必填骨架」标记——三档表会被填表人当可选项')
  for (const tier of ['总处数', '豁免处数', '逐处计入处数']) {
    assert.ok(t.includes(tier), `模板缺三档之一「${tier}」`)
  }
  assert.ok(t.includes('词表对账'), '模板缺「词表对账」段（不在词表的词不得进分子）')
  assert.ok(t.includes('逐处清点'), '模板缺「逐处清点」逐行表——不接受汇总数')
  assert.match(t, /统计口径/, '模板头必须固定要求写明统计口径 = 全文 / 正文区')
  // 词表真源必须写死在骨架里，否则「对账」无参照物。
  for (const w of ['赋能', '抓手', '底层逻辑', '范式', '迭代', '路径']) {
    assert.ok(t.includes(w), `模板词表对账段缺 C 类词「${w}」`)
  }
})

// ── §三-12：交付说明 12 字段清单进被填模板 ────────────────────────────────────

test('batch26 · §三-12：交付说明模板头部一次列全 12 个字段名，且序号 ↔ 标题一一对应', () => {
  const t = read(DELIV_TPL)
  const bodyIdx = t.indexOf('## 1.')
  assert.ok(bodyIdx > 0, '模板缺 `## 1.` 正文节')
  const header = t.slice(0, bodyIdx)

  let prev = -1
  DELIV_FIELDS.forEach((name, i) => {
    const n = i + 1
    const at = header.indexOf(`${n}. ${name}`)
    assert.ok(at >= 0, `模板头部缺第 ${n} 个字段名「${n}. ${name}」（填表只能倒推标题号）`)
    assert.ok(at > prev, `模板头部字段顺序错位：第 ${n} 项「${name}」不在第 ${n - 1} 项之后`)
    prev = at
    // 序号 ↔ 标题一一对应：正文里的 `## N. 名` 必须与头部清单逐字一致
    assert.ok(t.includes(`## ${n}. ${name}`), `正文缺标题「## ${n}. ${name}」——头部清单与标题体例不符`)
  })
  // 既有约束不得被这次改动挤掉
  assert.ok(t.includes('追加段一律放在 §12 之后'), '模板丢了「追加段一律放 §12 之后」既有约束')
})

test('batch26 · §三-12：deliverables.md 的字段表改为指针（不再复述字段名，避免一事实两处）', () => {
  const t = read(DELIVERABLES)
  const i = t.indexOf('## 交付说明模板字段')
  assert.ok(i > 0, 'deliverables.md 缺「## 交付说明模板字段」节')
  const next = t.indexOf('\n## ', i + 10)
  const section = t.slice(i, next === -1 ? t.length : next)
  assert.ok(section.includes('templates/交付说明-template.md'), '该节必须指向被填模板（字段名清单真源）')
  assert.match(section, /指针|不再复述/, '该节必须显式声明已改为指针 / 不再复述字段名')
})

// ── §四-16：同版本文件不得改写 ────────────────────────────────────────────────

const NO_REWRITE = '如无授权，不得改写同一版本文件；修订必须递增版本号'

test('batch26 · §四-16：两处派发话术模板都能检索到「同版本文件不得改写」护栏句', () => {
  const cards = read(DISPATCH)
  const readme = read(README)
  assert.ok(cards.includes(NO_REWRITE), `dispatch-cards.md 缺护栏句：${NO_REWRITE}`)
  assert.ok(readme.includes(NO_REWRITE), `pipeline-readme.md 缺护栏句：${NO_REWRITE}`)
  // 护栏必须落在**通用条款**区（T9/G14 各一次实测都因它缺位），不是某个角色卡的附注
  assert.ok(cards.includes('派发通用条款'), 'dispatch-cards.md 缺「派发通用条款」分区标题')
  const i = cards.indexOf('派发通用条款')
  assert.ok(cards.slice(i).includes('同版本'), '该护栏句必须在通用条款区内（角色卡附注拦不住 T9/G14 两处并行）')
})

// ── §四-17：追加提示带「变更面」 ──────────────────────────────────────────────

function makeCordaxLikeCtx() {
  const listeners = Object.create(null)
  const ctx = {
    get: (n) => ({
      tools: { register: () => [], guard: () => undefined },
      commands: { register: () => () => {} },
      skills: { register: () => () => {} },
    })[n],
    on: (event, listener) => { (listeners[event] ??= []).push(listener); return () => {} },
    effect: (fn) => { const r = fn(); if (r && typeof r.then === 'function') r.catch(() => {}); return () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }
  return { ctx, listeners }
}

test('batch26 · §四-17：会话追加提示除版本号外给出「行为变更 N 条」与 CHANGELOG 锚点', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['system-prompt/assemble'] || []
  assert.ok(handlers.length >= 1, 'H4 监听器未注册')
  const texts = []
  for (const h of handlers) {
    const r = await h({ sections: [], contexts: [], tools: [], variables: {} }, { agent: {} }, async (a) => a)
    for (const s of (r && r.sections) || []) texts.push(String(s.text))
  }
  const tail = texts.filter((t) => t.includes('按需追加')).join('\n')
  assert.ok(tail, '追加提示段缺失（应含「论衡·按需追加」）')

  assert.ok(tail.includes('变更面'), '追加提示缺「变更面」行——版本号只说明「变了」，变更面才说明「该读什么」')
  assert.match(tail, /行为变更\s*(?:\d+\s*条|未登记)/, '变更面必须给「行为变更 N 条」（或如实标「未登记」，不得留空/编数字）')
  assert.ok(tail.includes('CHANGELOG'), '变更面必须带 CHANGELOG 锚点，否则读了条数也不知道去哪看')

  // 来源侧：机读行是这个提示的唯一数据源，仓库自身不得缺（缺了提示只能报「未登记」）。
  const changelog = read('CHANGELOG.md')
  // 机读行形态：条数与锚点都在 HTML 注释里（`lib/**` 禁版本字面量，故真源只能是数据文件）。
  // 锚点后的括号是**人读补充**，不在提取范围内——故这里只要求 `锚点 = <非空>`，不要求注释以短串结尾。
  assert.match(changelog, /<!--\s*行为变更\s*\d+\s*条\s*\|\s*锚点\s*=\s*[\s\S]*?-->/, 'CHANGELOG.md 缺机读「变更面」行：`<!-- 行为变更 N 条 | 锚点 = … -->`')

  // 实现侧：提示由 lib 内生成（不是技能侧手抄），且不得写死版本字面量。
  const src = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
  assert.ok(src.includes('readChangeSurface'), 'lib/index.js 缺 readChangeSurface()（变更面提取）')
  assert.ok(/行为变更/.test(src) && /CHANGELOG/.test(src), 'lib/index.js 内的变更面提取逻辑缺「行为变更」/ CHANGELOG 字面')
})

// ── §四-18：主人侧「卡在哪一步」 ─────────────────────────────────────────────

test('batch26 · §四-18：快照投影「上次更新时刻 + 是否在等主人」，并在客户端渲染出来', async () => {
  const { lightSnapshot } = await import(pathToFileURL(join(ROOT, 'lib', 'panel.mjs')).href)
  const d = tmp()
  try {
    // ① 有「待主人」行 → waiting = true，且给出 status.md 行号（可点回原文核对）
    const waiting = join(d, 'run', 'p-wait')
    mkdirSync(waiting, { recursive: true })
    writeFileSync(join(waiting, 'status.md'),
      '# Status\n\n- ✅ **In Progress** — Phase 2（检索收口）\n- 🔄 **待主人** — Phase 2.5 checkpoint：请确认数据卡取舍\n',
      'utf8')
    const s1 = lightSnapshot(d, 'p-wait')
    assert.ok(s1 && s1.status, '快照缺 status')
    assert.ok(s1.status.owner, '快照缺 status.owner（「是否在等主人」的只读投影）')
    assert.equal(s1.status.owner.waiting, true, 'status.md 里有「待主人」行 → waiting 必须为 true')
    assert.equal(typeof s1.status.owner.line, 'number', '必须给出行号（面板只报可核查事实）')
    assert.ok(s1.status.lastUpdate, '快照缺 status.lastUpdate（上次更新时刻）')
    assert.ok(!Number.isNaN(Date.parse(s1.status.lastUpdate)), 'lastUpdate 必须是可解析的时间戳串')

    // ② 全闭合 → 不得误报「在等主人」（假信号比没信号更坏：主人会为不存在的等待守着）
    const closed = join(d, 'run', 'p-closed')
    mkdirSync(closed, { recursive: true })
    writeFileSync(join(closed, 'status.md'), '# Status\n\n- ✅ **Done** — Phase 5 已完成（已确认）\n', 'utf8')
    const s2 = lightSnapshot(d, 'p-closed')
    assert.equal(s2.status.owner.waiting, false, '已完成/已确认行不得被判成「在等主人」')

    // ③ 渲染侧：快照字段必须真被画出来（只加字段不加渲染 = 主人侧仍看不到）
    // ⚠️ **降级面（如实登记，故本用例只断言到这一层）**：`等待 / 更新` 行落在**面板正文的项目卡**里，
    //   而 v19.1.3/v19.1.4 主人裁定「不展开也能看到」的那个面 = **开工台标题栏的六块 chips**
    //   （`wbPhBar` 一段：项目选择 + `wbPhases()` 六块 + 展开按钮）——该处**仍只有六块 n/d**，
    //   看不到「上次更新时刻 / 是否在等主人」。故清单第 18 条的验收句（「面板收起态能看到该三项」）
    //   **只达成一半**：快照投影 ✓ / 面板正文档渲染 ✓ / 收起态标题栏 ✗。补法见回报（需在标题栏加一格）。
    const client = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
    assert.ok(/在等主人/.test(client), 'lib/client.js 未渲染「在等主人」')
    assert.ok(/上次更新/.test(client), 'lib/client.js 未渲染「上次更新」时刻')
    assert.ok(/status\.lastUpdate|owner/.test(client), 'lib/client.js 未消费 status.owner / status.lastUpdate')

    // ④ 当前 Phase：既有 KPI 行（v19.1.0 试点）——三项里这一项本就在，作回归钉
    assert.ok(s1.status.phaseLine !== undefined, '快照缺 status.phaseLine（当前 Phase 的既有载体）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
