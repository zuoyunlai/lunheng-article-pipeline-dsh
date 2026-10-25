// 批 26（T7 反哺清单 契约面 + 流程与可见性）回归网
//
// 覆盖 5 条改动的**可机械核**面（每条对应实现/文档里的一处判据）：
//   ⑨  G14「路径」类计数登记不全  → gate 文档 §三「C 类计数与登记三档」+ 报告模板必填骨架
//   ⑫  交付说明 12 字段清单不在被填模板里 → 模板头部 12 字段清单，且**序号 ↔ 标题一一对应**
//   ⑯  同路径同版本号并行写无护栏 → 两份派发话术里都能检索到该条
//   ⑰  机制版本级联缺「变更面」提示 → 追加提示含「行为变更 N 条 + CHANGELOG 锚点」
//   ⑱  主人侧看不到「卡在哪一步」 → 面板只读投影「当前 Phase + 上次更新时刻 + 是否在等主人」
//
// 运行：node --test tests/batch26-contract-flow.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmp } from './_fixtures.mjs'
import { lightSnapshot } from '../lib/panel.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REF = join(ROOT, 'skills', 'lunheng-article-pipeline', 'references')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

// ── ⑨ G14 计数登记（gate 文档 + 报告模板）───────────────────────────────────────────────
test('⑨ gate 文档：C 类计数固定三档 + 逐处列 L 号 + 命中前词表对账 + 统计口径声明', () => {
  const gate = read('skills/lunheng-article-pipeline/references/gates/14-中文AI痕迹-gate.md')
  assert.match(gate, /C 类计数与登记三档/, 'gate §三 应有「C 类计数与登记三档」节（本节即该条的判据落点）')
  assert.match(gate, /\*\*总处数\*\*/, '三档之一「总处数」必须显式出现')
  assert.match(gate, /\*\*豁免处数\*\*/, '三档之一「豁免处数」必须显式出现')
  assert.match(gate, /\*\*逐处计入处数\*\*/, '三档之一「逐处计入处数」必须显式出现')
  assert.match(gate, /逐处列 L 号/, '必须要求逐处列 L 号（不接受「共 N 处」式汇总数）')
  assert.match(gate, /词表对账/, '命中前必须先做词表对账')
  assert.match(gate, /不在词表的词不得进分子/, '词表对账的判据必须写成「不在词表的词不得进分子」')
  assert.match(gate, /统计口径 = 全文 \/ 正文区/, '报告头固定声明「统计口径 = 全文 / 正文区」')
  // 零字段式的空报告必须不合格
  assert.match(gate, /缺一档即(?:视为\*\*)?报告不完整/, '缺一档须判报告不完整')
})

test('⑨ 报告模板：三档表是必填骨架 + 词表对账段 + 报告头固定「统计口径」', () => {
  const tpl = read('skills/lunheng-article-pipeline/references/templates/G14检测报告-template.md')
  assert.match(tpl, /必填骨架/, 'C 类三档表须标为必填骨架')
  assert.match(tpl, /\|\s*\*\*总处数\*\*\s*\|/, '模板须含「总处数」骨架行')
  assert.match(tpl, /\|\s*\*\*豁免处数\*\*\s*\|/, '模板须含「豁免处数」骨架行')
  assert.match(tpl, /\|\s*\*\*逐处计入处数\*\*\s*\|/, '模板须含「逐处计入处数」骨架行')
  assert.match(tpl, /逐处清点/, '模板须要求逐处清点表（逐处列 L 号）')
  assert.match(tpl, /词表对账/, '模板须含词表对账段')
  // 报告头固定注明统计口径（在报告头代码块内，且在「检测时间」之前）
  const head = tpl.slice(0, tpl.indexOf('## 一、检测摘要'))
  assert.match(head, /统计口径/, '报告头必须固定注明「统计口径 = 全文 / 正文区」')
  assert.ok(head.indexOf('统计口径') < head.indexOf('检测时间'), '统计口径须在报告头（检测时间之前）')
})

// ── ⑫ 交付说明 12 字段清单（模板头部 + 序号一一对应）─────────────────────────────────────
test('⑫ 模板头部列全 12 字段名，且序号 ↔ 字段标题一一对应（防错位真判据）', () => {
  const tpl = read('skills/lunheng-article-pipeline/references/templates/交付说明-template.md')
  const head = tpl.slice(0, tpl.indexOf('\n---'))
  const NAMES = ['路径', '图件清单', '遗留风险', '人工核验项', '数据溯源 check-list', '成本指标',
    '建议 merge 的反哺清单', 'AI 使用披露（完整版）', '证据包指纹', '投稿就绪检查表', '主人决策记录', '终检结论']
  // ① 头部逐名出现（一行一个 / 亦可两行合排，只核逐名在场）
  for (const n of NAMES) assert.ok(head.includes(n), `模板头部缺字段名「${n}」`)
  // ② 头部「N. 字段名」序列 == 正文 `## N. 标题` 序列（**序号与字段名一一对应**）
  const listed = [...head.matchAll(/(\d{1,2})\.\s*([^\s　0-9][^\s　]*)/g)]
    .map((m) => [Number(m[1]), m[2].replace(/[）)]$/, '')])
    .filter(([n]) => n >= 1 && n <= 12)
  const seen = new Map()
  for (const [n, name] of listed) if (!seen.has(n)) seen.set(n, name)
  const headings = [...tpl.matchAll(/^##\s+(\d{1,2})\.\s*(.+)$/gm)].map((m) => [Number(m[1]), m[2].trim()])
  for (const [n, title] of headings) {
    assert.ok(seen.has(n), `头部清单缺第 ${n} 项（正文有「## ${n}. ${title}」）`)
    const listedName = seen.get(n)
    assert.ok(title.startsWith(listedName) || listedName.startsWith(title),
      `序号 ${n} 错位：头部写「${listedName}」，正文标题是「${title}」`)
  }
  assert.deepEqual(headings.map(([n]) => n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], '正文 12 节序号须为 1…12')
  // ③ 既有约束保留：追加段一律放 §12 之后
  assert.match(tpl, /追加段一律放在 §12 之后|追加段一律放 §12 之后/, '模板须保留「追加段一律放 §12 之后」约束')
})

test('⑫ deliverables.md 改为指针（不再复述字段名，指向被填模板）', () => {
  const d = read('skills/lunheng-article-pipeline/references/deliverables.md')
  const seg = d.slice(d.indexOf('## 交付说明模板字段'))
  assert.match(seg, /templates\/交付说明-template\.md/, '该段须指向被填模板')
  assert.match(seg, /不再复述字段名/, '该段须声明不再复述字段名（指针语义）')
})

// ── ⑯ 同路径同版本号并行写（两份话术里可检索到）────────────────────────────────────────
test('⑯ 两份派发话术都可检索到「同版本不得改写 · 修订必须递增版本号」', () => {
  const RE = /如无授权，不得改写同一版本文件；修订必须递增版本号/
  const cards = read('skills/lunheng-article-pipeline/references/dispatch-cards.md')
  const pipe = read('skills/lunheng-article-pipeline/references/pipeline-readme.md')
  assert.match(cards, RE, 'dispatch-cards.md 通用条款须含该条')
  assert.match(pipe, RE, 'pipeline-readme.md#dispatch 通用前置条款须含该条')
})

// ── ⑰ 变更面提示（行为变更条数 + CHANGELOG 锚点）────────────────────────────────────────
function makeCordaxLikeCtx() {
  const listeners = Object.create(null)
  const ctx = {
    get: (n) => ({
      tools: { register: () => [], guard: () => undefined },
      commands: { register: () => () => {} },
      skills: { register: () => () => {} },
    })[n],
    on: (event, listener) => { (listeners[event] ??= []).push(listener); return () => {} },
    effect: (fn) => { const r = fn(); if (typeof r === 'function') return r; return () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }
  return { ctx, listeners }
}

async function promptTail() {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))
  const handlers = listeners['system-prompt/assemble'] || []
  assert.ok(handlers.length >= 1, 'H4 监听器未注册')
  const assembly = { sections: [], contexts: [], tools: [], variables: {} }
  const out = await handlers[0](assembly, {}, async () => assembly)
  return out.sections.map((s) => s.text).join('\n')
}

test('⑰ 追加提示含「行为变更 N 条」与 CHANGELOG 锚点（且与 CHANGELOG 机读行一致）', async () => {
  const text = await promptTail()
  const pkgVersion = JSON.parse(read('package.json')).version
  const cl = read('CHANGELOG.md')
  const m = /<!--\s*行为变更\s*(\d+)\s*条\s*\|\s*锚点\s*=\s*([^（(]*)/.exec(cl)
  assert.ok(m, 'CHANGELOG 当前版本段须有 `<!-- 行为变更 N 条 | 锚点 = … -->` 机读行（真源形态）')
  assert.match(text, /变更面/, '追加提示须给出「变更面」段')
  assert.ok(text.includes(`行为变更 ${m[1]} 条`), `追加提示须含「行为变更 ${m[1]} 条」，实际：\n${text}`)
  assert.ok(text.includes('CHANGELOG'), '追加提示须给 CHANGELOG 锚点')
  assert.ok(text.includes(`§ ${pkgVersion}`), `锚点须指向当前版本段 § ${pkgVersion}`)
  // 版本自证不可丢（既有契约）：提示里所有 vX.Y.Z 都必须等于 package.json
  const found = [...new Set([...text.matchAll(/v(\d{1,3}\.\d{1,3}\.\d{1,3})/g)].map((x) => x[1]))]
  assert.deepEqual(found.filter((v) => v !== pkgVersion), [], '尾注不得含非当前版本号')
})

test('⑰ 机读行与 CHANGELOG 该段「改动」小节的条目数一致（计数不靠手写）', () => {
  const cl = read('CHANGELOG.md')
  const m = /<!--\s*行为变更\s*(\d+)\s*条/.exec(cl)
  assert.ok(m, '缺少机读行')
  const after = cl.slice(m.index)
  const nextVer = after.slice(1).search(/\n## /)
  const seg = nextVer === -1 ? after : after.slice(0, nextVer + 1)
  // v19.11.2：编号字符类从「①-⑨」扩到「①-⑳」——旧类只认得 9 个，第 10 条起**不计入**，
  //   于是「11 条」的登记行与「实测 9 条」假冲突。计数器必须覆盖它要数的全部形态。
  const n = (seg.match(/^- \*\*[\u2460-\u2473]/gm) || []).length
  assert.equal(Number(m[1]), n, `机读行写 ${m[1]} 条，而该段「改动」小节实测 ${n} 条——登记数与真源必须一致`)
})

// ── ⑱ 主人侧「卡在哪一步」（面板只读投影）─────────────────────────────────────────────
test('⑱ lightSnapshot：status.md 在等主人 → owner.waiting + 行号 + lastUpdate', () => {
  const root = tmp('batch26-wait')
  try {
    const dir = join(root, 'run', 'p-wait')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'status.md'), [
      '# Status',
      '',
      '| 阶段 | 名称 | 状态 | 备注 |',
      '|------|------|------|------|',
      '| 0 定题 | 选题 | ✅ Done | 2026-10-01 |',
      '| 2.5 大纲确认 | 主人 | ⬜ Inbox | 人在环节点 |',
    ].join('\n'))
    const s = lightSnapshot(root, 'p-wait')
    assert.ok(s, '快照应非空')
    assert.equal(s.status.owner.waiting, true, '人在环未闭合行须判「在等主人」')
    assert.equal(s.status.owner.line, 6, '须给 status.md 的行号（可点回原文核对）')
    assert.ok(s.status.owner.hits >= 1, '须给出命中条数')
    assert.ok(typeof s.status.lastUpdate === 'string' && !Number.isNaN(Date.parse(s.status.lastUpdate)),
      'lastUpdate 须是 status.md 的 mtime（ISO）')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('⑱ lightSnapshot：模板原样的 status.md 不得点亮（审计 P1-1 反面回归：旧判据在模板上命中 32 行）', () => {
  // v19.27.5（审计 P1-1）：`Inbox` / 裸 `待` / 裸 `人在环` 只描述**阶段类型**，模板每行初始态都带 →
  //   旧判据在新项目第一分钟就常亮（实测 32 行命中），主人学会忽略指示灯。
  //   现判据：只有「显式等待字面」或「活动门那一行的 Inbox + 主人字样」才算。
  const tpl = read(join('skills', 'lunheng-article-pipeline', 'references', 'templates', 'status-template.md'))
  const root = tmp('batch26-tpl')
  try {
    const dir = join(root, 'run', 'p-tpl')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'status.md'), tpl, 'utf8')
    const s = lightSnapshot(root, 'p-tpl')
    assert.equal(s.status.owner.waiting, false, '模板原样 status.md 不得判「在等主人」（否则指示灯常亮＝无信息）')
    assert.equal(s.status.owner.hits, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('⑱ lightSnapshot：无待主人项时不得误报（✅/Done/已确认/Skipped 行一律不算）', () => {
  const root = tmp('batch26-nowait')
  try {
    const dir = join(root, 'run', 'p-ok')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'status.md'), [
      '# Status',
      '',
      '| 阶段 | 名称 | 状态 | 备注 |',
      '|------|------|------|------|',
      '| 2.5 大纲确认 | 主人 | ✅ Done | 主人已确认 |',
      '| 3.5 洞察补充 | 主人 | ⏭ Skipped | 无洞察 |',
    ].join('\n'))
    const s = lightSnapshot(root, 'p-ok')
    assert.equal(s.status.owner.waiting, false, '已闭合 / 已跳过的门不得判「在等主人」（错报比空更糟）')
    assert.equal(s.status.owner.line, null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('⑱ 面板读面明细登记该投影（口径真源 ← 文档，落点 ← lib/panel.mjs）', () => {
  const doc = read('skills/lunheng-article-pipeline/references/_shared/运行面板-读面明细.md')
  assert.match(doc, /卡在哪一步/, '读面明细须登记该投影')
  assert.match(doc, /上次更新时刻/, '须点名「上次更新时刻」')
  assert.match(doc, /是否在等主人/, '须点名「是否在等主人」')
  assert.match(doc, /parseOwnerWait/, '须给出实现落点（lib/panel.mjs 的 parseOwnerWait）')
})
