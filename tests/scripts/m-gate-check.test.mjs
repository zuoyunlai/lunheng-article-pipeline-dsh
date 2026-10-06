// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 m-gate-check 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/m-gate-check.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('m-gate-check M-Exist-7：§6 成本指标必须含 `~NN[MKB]` 或「实测不可得」（v18.6.3 反哺：原只看「字段有内容」漏报，看板 17/21 token 列空）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const DD = join(fin, '交付说明.md')
  const item = (txt) => {
    writeFileSync(DD, '# 交付说明\n\n' + txt + '\n')
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-7'))
  }
  let it = item(buildDeliveryNoteWithSec6('- token（实测）：~5M cacheRead\n\n- 时长：3h\n\n- 最贵角色：T5'))
  assert.equal(it.pass, true, '标准 `~NN[MKB]` 应通过：' + it.detail)

  it = item(buildDeliveryNoteWithSec6('- token（实测）：5M tokens\n\n- 时长：3h\n\n- 最贵角色：T5'))
  assert.equal(it.pass, true, '绝对值 `NN[MKB] tokens` 应通过：' + it.detail)

  it = item(buildDeliveryNoteWithSec6('- token（实测）：已耗 ~5M\n\n- 时长：3h\n\n- 最贵角色：T5'))
  assert.equal(it.pass, true, '中文前缀「已耗 ~NN[MKB]」应通过：' + it.detail)

  it = item(buildDeliveryNoteWithSec6('- token（实测）：实测不可得：无会话缓存（console pool 限子进程）\n\n- 时长：3h\n\n- 最贵角色：T5'))
  assert.equal(it.pass, true, '「实测不可得：<原因>」应通过：' + it.detail)

  // 失败：仅定性描述，无 `~NN[MKB]` 也无「实测不可得」（最常见误写）
  it = item(buildDeliveryNoteWithSec6('- token（实测）：已耗：12 次 spawn + 4 轮机械编辑\n\n- 时长：3h\n\n- 最贵角色：T5'))
  assert.equal(it.pass, false, '纯定性描述必须报（v18.6.3 反馈：原写法导致看板 token 列空）')
  assert.match(it.detail, /成本指标缺实测值/)

  // 失败：仅 1.2M 无 ~ 也没实测不可得
  it = item(buildDeliveryNoteWithSec6('- token（实测）：1.2M\n\n- 时长：3h\n\n- 最贵角色：T5'))
  assert.equal(it.pass, false, '无 ~ 也无「实测不可得」必须报')
  assert.match(it.detail, /成本指标缺实测值/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check：参数/路径错误必须 exit 10（与「1 = P1 内容失败」区分）', () => {
  const r = run([join(SCRIPTS, 'm-gate-check.mjs')])
  assert.equal(r.code, 10)
})

test('m-gate-check：不带 --report 的常规调用必须正常工作（回归：曾因 reportIdx=-1 排除首个位置参数而误报用法错误）', () => {
  const d = tmp()
  const proj = join(d, 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
  assert.notEqual(r.code, 10, '不得判为参数错误：' + r.out.slice(0, 160))
  const j = parseJson(r)
  assert.ok(j.total >= 10, '应输出完整 M 门报告（total=' + j.total + '）')
  assert.equal(typeof j.exit, 'number')
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check：--report 落盘结构化报告（报告契约闭环）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  const rep = join(fin, 'M-Gate-Report.json')
  mkdirSync(ev, { recursive: true })
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文。\n\n## 参考文献\n\n[L01] 文献\n')
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev, '--report', rep])
  assert.ok(existsSync(rep), '报告应落盘')
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  assert.equal(typeof j.exit, 'number')
  assert.ok(j.total >= 10, `M 门应有 ≥10 项（实测 ${j.total}）`)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-9：未启用配图记 N/A 不算失败（配图默认关闭，不得据此判 M 门不过）', () => {
  const d = tmp()
  const proj = mkProj(d)
  writeFileSync(join(proj, 'final', '定稿.md'), MD.replace(/\[图\d+：[^\]]*\]\n\n?/g, ''))
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj, 'final', '定稿.md'), join(proj, 'final', '证据包')])
  const j = parseJson(r)
  const item = j.results.find((x) => x.gate.startsWith('M-Form-9'))
  assert.ok(item, '应存在 M-Form-9 项')
  assert.equal(item.pass, true, '无图位无图件 → N/A pass')
  assert.match(item.detail, /N\/A/)
  assert.equal(j.total, 24, '脚本机械项应为 24 项（M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1；v18.25.0 增 M-Fact 族、v18.27.0 增 M-Exist-11）')
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-9：缺图/图件全缺 → 硬失败且严重度分级正确', () => {
  const d = tmp()
  const proj = mkProj(d)
  // 只给图1 → 图2 缺图 → P1
  writeFileSync(join(proj, 'final', '图件', '图1_趋势.svg'), mkSvg('图一独有'))
  let r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj, 'final', '定稿.md'), join(proj, 'final', '证据包')])
  let item = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-9'))
  assert.equal(item.pass, false)
  assert.equal(item.severity, 'P1', '单张缺图应 P1：' + item.detail)
  assert.match(item.detail, /缺图/)
  // 删掉目录 → 图件全缺 → P0
  rmSync(join(proj, 'final', '图件'), { recursive: true, force: true })
  r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj, 'final', '定稿.md'), join(proj, 'final', '证据包')])
  item = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-9'))
  assert.equal(item.severity, 'P0', '图件全缺应 P0（T5 卡宣称的 P0 拦截落地）：' + item.detail)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-9：孤儿图件与无出处数字只给 P2 提示（启发式不得当硬失败）', () => {
  const d = tmp()
  const proj = mkProj(d)
  writeFileSync(join(proj, 'final', '图件', '图1_趋势.svg'), mkSvg('86'))
  writeFileSync(join(proj, 'final', '图件', '图2_占比.svg'), mkSvg('98765'))
  writeFileSync(join(proj, 'final', '图件', '图9_多余.svg'), mkSvg('孤儿'))
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj, 'final', '定稿.md'), join(proj, 'final', '证据包')])
  const item = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-9'))
  assert.equal(item.severity, 'P2', item.detail)
  assert.match(item.detail, /孤儿图件/)
  assert.match(item.detail, /98765/, '图上数字无出处应被提示')
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-11：素材按需加载闭环（引了没读 / 幽灵编号 / 无留痕必须报；齐备则过）', () => {
  const { d, proj, fin, ev } = mkProject({ analysis: true })
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01] 与 [L02]。\n\n## 参考文献\n\n[L01] x\n[L02] y\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 📇 索引段\n\n[L01] a ｜ 主题 ｜ 论点1\n[L02] b ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [L01] a\n信任级别：已发布\n\n### [L02] b\n信任级别：已发布\n')
  writeFileSync(join(proj, 'drafts', '初稿-v2.md'), '# 初稿 v2\n')
  const LIST = join(proj, 'analysis', '素材加载清单.md')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Form-11'))
  }
  // ① 正文有引用但无留痕 → P1（「按需加载」无从核对）
  let it = item()
  assert.equal(it.pass, false, '缺加载清单必须报')
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /无 analysis\/素材加载清单\.md|无.*加载清单/)

  // ② 留痕只记了 L01 → L02 属「引了没读」→ 硬问题
  writeFileSync(LIST, '# 素材加载清单\n\n- **对应正文版本**：v2\n\n## 已加载\n\n| 编号 | 支撑位置 |\n|---|---|\n| [L01] | §1 |\n')
  it = item()
  assert.equal(it.pass, false, '引了没读必须报')
  assert.match(it.detail, /引了没读|未记「已加载」/)
  assert.match(it.detail, /\[L02\]/)

  // ③ 清单里有卡片查不到的编号（幽灵）→ 硬问题
  writeFileSync(LIST, '# 素材加载清单\n\n- **对应正文版本**：v2\n\n## 已加载\n\n| 编号 | 支撑位置 |\n|---|---|\n| [L01] | §1 |\n| [L02] | §1 |\n| [L09] | §2 |\n')
  it = item()
  assert.equal(it.pass, false, '幽灵编号必须报')
  assert.match(it.detail, /无对应条目/)
  assert.match(it.detail, /\[L09\]/)

  // ④ 齐备 → 通过（读了不用只算软提示；「已跳过」段的编号不计入加载集）
  writeFileSync(LIST, '# 素材加载清单\n\n- **对应正文版本**：v2\n\n## 已加载\n\n| 编号 | 支撑位置 |\n|---|---|\n| [L01] | §1 |\n| [L02] | §1 |\n\n## 已跳过\n\n| 编号 | 理由 |\n|---|---|\n| [L07] | 口径不符 |\n')
  it = item()
  assert.equal(it.pass, true, '留痕齐备应通过：' + it.detail)
  assert.match(it.detail, /引用 ⊆ 已加载/)

  // ⑤ 「已加载」段标题缺失 → 硬问题（机检无从定位加载集）
  writeFileSync(LIST, '# 素材加载清单\n\n| 编号 | 支撑位置 |\n|---|---|\n| [L01] | §1 |\n')
  it = item()
  assert.equal(it.pass, false, '缺「## 已加载」段必须报')
  assert.match(it.detail, /已加载.*段标题|缺「## 已加载」/)

  // ⑥ v18.78.0（F3/F26）：正文引用 ∩「## 已跳过」≠ ∅ → 硬问题
  //    病灶：清单声明「不引用 [L01]」，而正文写着 [L01]——旧实现只把跳过编号从「白读」软提示里剔除
  //    （降噪方向），交集本身**没有任何判据**，于是「清单说不引用、正文却引」静默通过。
  writeFileSync(LIST, '# 素材加载清单\n\n- **对应正文版本**：v2\n\n## 已加载\n\n| 编号 | 支撑位置 |\n|---|---|\n| [L01] | §1 |\n| [L02] | §1 |\n\n## 已跳过\n\n| 编号 | 理由 |\n|---|---|\n| [L01] | 与 [L03] 同篇重复 |\n')
  it = item()
  assert.equal(it.pass, false, '「已跳过」的编号被正文引用必须报硬问题（清单与正文自相矛盾）')
  assert.match(it.detail, /已跳过.*声明的编号/)
  assert.match(it.detail, /\[L01\]/)
  rmSync(d, { recursive: true, force: true })
})


test('m-gate-check M-Form-2 / M-Form-7：文末五节缺失与**顺序**都必须报（v18.0.5 补回归网）', () => {
  const { d, fin, ev } = mkProject()
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, DRAFT_OK)
  assert.equal(gateOf(draft, ev, 'M-Form-2').pass, true, '五节齐全应通过')
  assert.equal(gateOf(draft, ev, 'M-Form-7').pass, true, '顺序正确应通过')
  // ① 删掉最后一节 → 存在性失败（P0）
  writeFileSync(draft, DRAFT_OK.replace('\n## AI 使用声明\n\nAI。\n', '\n'))
  const it2 = gateOf(draft, ev, 'M-Form-2')
  assert.equal(it2.pass, false, '缺「AI 使用声明」必须报')
  assert.equal(it2.severity, 'P0')
  assert.match(it2.detail, /AI 使用声明/)
  // ② 仅顺序对调（成员资格仍全白名单）→ M-Form-7 违序 P1
  writeFileSync(draft, DRAFT_OK.replace(
    '## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] c',
    '## 案例来源\n\n[C01] c\n\n## 数据来源\n\n[D01] d',
  ))
  const it7 = gateOf(draft, ev, 'M-Form-7')
  assert.equal(it7.pass, false, '文末五节错序必须报')
  assert.equal(it7.severity, 'P1')
  assert.match(it7.detail, /顺序违规/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-1：正文↔文末双向对比（漏引 / 孤儿都必须报；v18.0.5 补回归网）', () => {
  const { d, fin, ev } = mkProject()
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, DRAFT_OK)
  assert.equal(gateOf(draft, ev, 'M-Exist-1').pass, true, '齐备应通过')
  // ① 正文引 [L99]，文末没有 → 漏引
  writeFileSync(draft, DRAFT_OK.replace('正文 [L01] [D01] [C01] [先01]。', '正文 [L01] [D01] [C01] [先01] [L99]。'))
  let it = gateOf(draft, ev, 'M-Exist-1')
  assert.equal(it.pass, false, '文末漏引必须报：' + it.detail)
  assert.match(it.detail, /漏引 [1-9]/)
  // ② 文末多一条 [L02] 而正文不引 → 孤儿
  writeFileSync(draft, DRAFT_OK.replace('## 参考文献\n\n[L01] a', '## 参考文献\n\n[L01] a\n[L02] b'))
  it = gateOf(draft, ev, 'M-Exist-1')
  assert.equal(it.pass, false, '文末孤儿必须报：' + it.detail)
  assert.match(it.detail, /孤儿 [1-9]/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-6：数据卡条目缺独立「信任级别」段必须报（有则过；v18.0.5 补回归网）', () => {
  const { d, fin, ev } = mkProject()
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, DRAFT_OK)
  assert.equal(gateOf(draft, ev, 'M-Form-6').pass, true, '信任级别齐备应通过')
  writeFileSync(join(ev, '数据卡.md'), cardOk('数据卡', ['D01']).replace('信任级别：已发布\n', ''))
  const it = gateOf(draft, ev, 'M-Form-6')
  assert.equal(it.pass, false, '缺独立信任级别段必须报：' + it.detail)
  assert.match(it.detail, /独立段缺失/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-8：论点段缺 [Lxx] / 承重墙超载与幽灵编号都必须报（v18.0.5 补回归网）', () => {
  const { d, proj, fin, ev } = mkProject({ analysis: true })
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, DRAFT_OK)
  assert.equal(gateOf(draft, ev, 'M-Form-8').pass, true, '齐备应通过')
  // ① 论点段只有 [D01]/[C01]（无 L）→ 段缺 L
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n摘要若干字。\n\n## 一、导论\n\n'
    + '正文 [D01] [C01]。'.repeat(12)
    + DRAFT_OK.slice(DRAFT_OK.indexOf('\n\n## 参考文献')))
  let it = gateOf(draft, ev, 'M-Form-8')
  assert.equal(it.pass, false, '论点段缺 [Lxx] 必须报：' + it.detail)
  assert.match(it.detail, /缺\[Lxx\]|L_missing|段缺/)
  // ② 承重墙超载（同一编号 3 论点）+ 幽灵编号（卡片里不存在）
  writeFileSync(draft, DRAFT_OK)
  writeFileSync(join(proj, 'analysis', '分析大纲.md'),
    '# 分析大纲\n\n## 一、承重墙清单\n\n| 论点 | 承重证据 top1 |\n|---|---|\n| 论点1 | [C01] |\n| 论点2 | [C01] |\n| 论点3 | [C01] |\n| 论点4 | [L99] |\n')
  it = gateOf(draft, ev, 'M-Form-8')
  assert.equal(it.pass, false, '超载/幽灵必须报：' + it.detail)
  assert.match(it.detail, /超载|不存在/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-2 / M-Exist-3：空文件、悬空引用、证据包布局异常（v18.0.5 补回归网）', () => {
  const { d, fin, ev } = mkProject()
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, DRAFT_OK)
  assert.equal(gateOf(draft, ev, 'M-Exist-2').pass, true)
  assert.equal(gateOf(draft, ev, 'M-Exist-3').pass, true)
  // ① 证据包里放 0 字节 .md → P0
  writeFileSync(join(ev, '空卡.md'), '')
  let it = gateOf(draft, ev, 'M-Exist-2')
  assert.equal(it.pass, false, '空文件必须报')
  assert.equal(it.severity, 'P0')
  assert.match(it.detail, /空文件/)
  rmSync(join(ev, '空卡.md'))
  // ② 正文引 [D99]（卡里没有）→ M-Exist-3 报
  writeFileSync(draft, DRAFT_OK.replace('正文 [L01] [D01] [C01] [先01]。', '正文 [L01] [D01] [C01] [先01] [D99]。'))
  it = gateOf(draft, ev, 'M-Exist-3')
  assert.equal(it.pass, false, '悬空引用必须报：' + it.detail)
  assert.match(it.detail, /D99|无对应条目/)
  // ③ 布局异常（顶层无 .md、卡在子目录）：单列一条 P1；有回退的门仍能定位卡片（不再互相矛盾）
  const proj2 = join(d, 'run', 'proj2')
  const ev2 = join(proj2, 'final', '证据包')
  mkdirSync(join(ev2, 'data'), { recursive: true })
  mkdirSync(join(ev2, 'literature'), { recursive: true })
  writeFileSync(join(ev2, 'data', '数据卡.md'), cardOk('数据卡', ['D01']))
  writeFileSync(join(ev2, 'literature', '文献卡.md'), cardOk('文献卡', ['L01']))
  writeFileSync(join(proj2, 'final', '定稿.md'), DRAFT_OK)
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj2, 'final', '定稿.md'), ev2])
  const res = parseJson(r).results
  const ex2 = res.find((x) => x.gate.startsWith('M-Exist-2'))
  assert.equal(ex2.severity, 'P1', '布局异常应单列 P1（不与「真缺卡」同判 P0）：' + ex2.detail)
  assert.match(ex2.detail, /布局异常/)
  const fm10 = res.find((x) => x.gate.startsWith('M-Form-10'))
  assert.match(fm10.detail, /已查 [1-9]/, '带 projectRoot 回退的门仍应定位到卡片（v18.0.5 修口径分裂）')
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-5：闸门记录表（漏项 / 自述当实据 / ✗ 无原因 / 与 M 门报告矛盾必须报）', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(aud, '审计报告-v1.md'), '# 审计报告 v1\n\n结论：通过 ✅\n')
  const SK = join(ROOT, 'skills', 'lunheng-article-pipeline')
  const tpl = readFileSync(join(SK, 'references', 'templates', '闸门记录-template.md'), 'utf8')
  const itemsOf = (gate) => {
    const seg = tpl.split(new RegExp(`^## ${gate.replace('.', '\\.')}`, 'm'))[1].split(/^## /m)[0]
    return seg.split('\n').filter((l) => /^\s*\|/.test(l)).slice(2).map((l) => l.split('|')[1].trim()).filter(Boolean)
  }
  // v18.46.0：模板 T2.5/T7.5 新增「交接门 handoff-check exit」行（主人「依次全部修订」）——该行的实据
  //   **必须含 exit**（门的 branch-① 判据要求 0/20/21/22 之一），故此处单独给它合规写法；
  //   其余行仍用通用实据（本用例要测的是「漏项 / 自述当实据 / ✗ 无原因 / 与报告矛盾」四条）。
  const evFor = (gate, item, fallback) =>
    /交接门/.test(item) ? `handoff-check --role ${gate === 'T7.5' ? 'T7' : 'T2'} → exit 0` : fallback
  const build = (gate, evTxt = 'final/证据包/数据卡.md', res = '✓', why = '') =>
    `# 闸门记录 ${gate}\n\n| 检查项 | 实据（路径 / exit code） | 结论 | 失败原因 |\n|---|---|---|---|\n`
    + itemsOf(gate).map((i) => `| ${i} | ${evFor(gate, i, evTxt)} | ${res} | ${why} |`).join('\n') + '\n'
    // v18.12.0（L-33）：T7.5 记录另须留**三个战略门脚本**的 exit（模板里没有这一行，它是 M-Exist-5 的
    //   独立判据）——真实项目本该手写此行，故合规夹具也补上；缺它的负向用例见 mexist5-binding.test.mjs。
    + (gate === 'T7.5'
      ? '| 战略门预检（structure/methodology/cite-coverage） | structure-check exit 0 / methodology-check exit 0 / cite-coverage exit 0 | ✓ |  |\n'
      : '')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-5'))
  }
  // ① 两表单齐备 + 实据为路径 → 通过
  //   v18.12.0（审计 L-03/L-22）：T7.5 的「M 门全部 exit 0」行现在要求 **M 门报告真实存在**
  //   （闸门留机械证据 = exit code + 产物路径），故合规夹具必须带一份 exit 0 的报告。
  writeFileSync(join(fin, 'M-Gate-Report.json'), JSON.stringify({ script_exit_raw: 0, exit: 0, total: 22 }, null, 2))
  writeFileSync(join(aud, '闸门记录-T2.5.md'), build('T2.5'))
  writeFileSync(join(aud, '闸门记录-T7.5.md'), build('T7.5'))
  let it = item()
  assert.equal(it.pass, true, '闸门记录齐备应通过：' + it.detail)
  assert.match(it.detail, /T2\.5 \d+ 行|T7\.5 \d+ 行/)

  // ② 漏检查项（删掉模板里的第一项那行）→ 硬问题
  const bad = build('T2.5').split('\n').filter((l) => !l.includes(itemsOf('T2.5')[0])).join('\n')
  writeFileSync(join(aud, '闸门记录-T2.5.md'), bad + '\n')
  it = item()
  assert.equal(it.pass, false, '漏检查项必须报')
  assert.match(it.detail, /检查项缺「/)

  // ③ 实据写「已检查」自述 → 硬问题（闸门留机械证据）
  writeFileSync(join(aud, '闸门记录-T2.5.md'), build('T2.5', '已检查'))
  it = item()
  assert.equal(it.pass, false, '自述当实据必须报')
  assert.match(it.detail, /不是机械证据/)

  // ④ 判 ✗ 但没写失败原因 → 硬问题
  writeFileSync(join(aud, '闸门记录-T2.5.md'), build('T2.5', 'final/证据包/数据卡.md', '✗', ''))
  it = item()
  assert.equal(it.pass, false, '✗ 无原因必须报')
  assert.match(it.detail, /未写失败原因/)

  // ⑤ T7.5 全判 ✓，但 M-Gate-Report.json exit=2 → P0 自相矛盾
  writeFileSync(join(aud, '闸门记录-T2.5.md'), build('T2.5'))
  writeFileSync(join(fin, 'M-Gate-Report.json'), JSON.stringify({ exit: 2, total: 19 }))
  it = item()
  assert.equal(it.severity, 'P0', '闸门与报告矛盾应 P0：' + it.detail)
  assert.match(it.detail, /自相矛盾/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-6：审稿报告评分与期刊匹配（总分≠分项和 / 综合不可复算 / 杜撰刊名）', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n启用期刊匹配\n')
  const REP = join(aud, '审稿报告-v2.md')
  const mk = (total, dims, rows) => `# 同行评审报告\n\n> **总评分**：${total}/30\n> **建议**：minor revision\n\n`
    + '| 维度 | 得分 | 一句话评价 |\n|------|------|-----------|\n'
    + ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范'].map((x, i) => `| ${x} | ${dims[i]}/5 | 好 |`).join('\n')
    + `\n| **总分** | **${total}/30** | **minor revision** |\n\n判定：minor revision\n\n`
    + '| 目标方向 | 综合匹配度 | 主题契合 | 风格契合 | 范式契合 | 审稿周期 | 推荐理由 |\n|---------|-----------|---------|---------|---------|---------|---------|\n' + rows + '\n'
    + '\n## 给作者的具体修改建议（按优先级）\n\n1. 补 §三 第 2 段的 [L01] 支撑\n2. 第 4 章增补反方\n'
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-6'))
  }
  // ① 无审稿报告 → SKIP（v18.78.2 · 全量审计 A5：**未检 ≠ 通过**；T9 按文类档案本就可选，故刻意不升 P1）
  let it = item()
  assert.equal(it.pass, 'SKIP', '无审稿报告应记 SKIP 而非通过：' + it.detail)
  assert.equal(it.severity, 'SKIP')
  assert.match(it.detail, /N\/A/)

  // ② 总分 = 分项和（24）+ 综合按**真源四项式**复算
  //    v18.78.0（F29）：公式 = 0.45×主题 + 0.25×风格 + 0.15×范式 + 0.15×归一化（真源 = 期刊匹配算法.md §二 步骤 5）。
  //    归一化 = (24−16)/14 = 57.142857% → 0.45×90 + 0.25×80 + 0.15×100 + 0.15×57.142857 = 84.07 → 84%。
  writeFileSync(REP, mk(24, [4, 4, 4, 4, 4, 4], [
    '| 《管理世界》 | 84% | 90% | 80% | 100% | 3-6 月 | 主题契合高 + 风格偏实证 + 周期可控 |',
    '| 《中国工业经济》 | 78.8% | 85% | 80% | 80% | 4-8 月 | 主题契合同类 + 风格一致 + 周期适中 |',
    '| 《南开管理评论》 | 80.8% | 80% | 85% | 100% | 3-6 月 | 风格贴近 + 主题部分契合 + 周期友好 |',
  ].join('\n')))
  it = item()
  assert.equal(it.pass, true, '评分自洽 + 期刊可复算应通过：' + it.detail)
  assert.match(it.detail, /期刊表 3 行/)

  // ②′ v18.78.0（F29）**反向钉**：无「范式契合」列时按中性默认 50% 复算——
  //    0.45×90 + 0.25×80 + 0.15×50 + 0.15×57.142857 = 76.57 → 填 84% 必须判「不可复算」
  //    （证明新公式真的在算范式项，而不是「换个写法一律放行」）。
  writeFileSync(REP, mk(24, [4, 4, 4, 4, 4, 4], [
    '| 《管理世界》 | 84% | 90% | 80% | 3-6 月 | 主题契合高 + 风格偏实证 + 周期可控 |',
    '| 《中国工业经济》 | 78.8% | 85% | 80% | 4-8 月 | 主题契合同类 + 风格一致 + 周期适中 |',
    '| 《南开管理评论》 | 80.8% | 80% | 85% | 3-6 月 | 风格贴近 + 主题部分契合 + 周期友好 |',
  ].join('\n')))
  it = item()
  assert.equal(it.pass, false, '缺范式列时须按中性默认 50% 复算（不得沿用旧两项式放行）：' + it.detail)
  assert.match(it.detail, /不可复算/)
  assert.match(it.detail, /中性默认 50/, '必须说明复算用了默认值（否则读者不知数字为何对不上）：' + it.detail)

  // ③ 总分 ≠ 分项之和 → 硬问题（评分表与总分自相矛盾）
  writeFileSync(REP, mk(27, [4, 4, 4, 4, 4, 4], '| 《管理世界》 | 84% | 90% | 80% | 100% | 3-6 月 | 主题契合高 + 风格偏实证 + 周期可控 |'))
  it = item()
  assert.equal(it.pass, false, '总分与分项和不符必须报')
  assert.match(it.detail, /≠ 6 维之和/)

  // ④ 综合匹配度不可复算 → 硬问题
  writeFileSync(REP, mk(24, [4, 4, 4, 4, 4, 4], '| 《管理世界》 | 95% | 90% | 80% | 100% | 3-6 月 | 主题契合高 + 风格偏实证 + 周期可控 |'))
  it = item()
  assert.equal(it.pass, false, '数字不可复算必须报')
  assert.match(it.detail, /不可复算/)

  // ⑤ 刊名不在 期刊数据库.md 中 → 软提示；**且不得指控「杜撰」**
  //   v18.49.0（反哺 F-AU）：旧文案「疑似杜撰刊名」把「本库覆盖不全」写成了「作者编造」——
  //   实测反例：《哲学研究》《政治学研究》均为**真实**的中文核心刊物（CSSCI / 北大核心），
  //   仅因未收录于本库即被指「疑似杜撰」= **对作者的失实指控**。口径收敛为「未在本库内找到」，
  //   并**显式说明「查不到 ≠ 不存在」**（把本库规模一并报出）。
  writeFileSync(REP, mk(24, [4, 4, 4, 4, 4, 4], '| 《某虚构学报》 | 84% | 90% | 80% | 100% | 3-6 月 | 主题契合高 + 风格偏实证 + 周期可控 |'))
  it = item()
  assert.match(it.detail, /未在.*内找到/, '不在库内须如实说「未在本库内找到」')
  assert.doesNotMatch(it.detail, /杜撰/, '**不得**把「本库覆盖不全」写成「作者编造」')
  assert.match(it.detail, /不等于该刊不存在/, '须显式说明「查不到 ≠ 不存在」')
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-7：交付说明 12 固定字段（缺字段 / 空字段 / 缺指纹 / 决策记录漏门必须报）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const DD = join(fin, '交付说明.md')
  const GOOD = `# 交付说明

## 1. 路径

| 项 | 路径 |
|----|------|
| 定稿 | final/定稿.md |

## 2. 图件清单

| 图号 | 标题 | 来源 |
|------|------|------|
| 图1 | 趋势 | [D01] |

## 3. 遗留风险

- 无

## 4. 人工核验项

- 无

## 5. 数据溯源 check-list

- [ ] 付费墙文献：无

## 6. 成本指标

- token：~1.2M

## 7. 建议 merge 的反哺清单

- [ ] 反哺规则 A → 05 卡

## 8. AI 使用披露（完整版）

- AI 生成段：全文初稿

## 9. 证据包指纹

- sha256：a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4（权威 = final/证据包/manifest.json）

## 10. 投稿就绪检查表

- 推荐期刊：见审稿报告

## 11. 主人决策记录

- 四门时间线：Phase 0 09:12 通过｜Phase 2.5 10:05 通过｜Phase 3.5 10:40 通过｜Phase 5 11:20 通过

## 12. 终检结论

- M 门 exit = 0
`
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-7'))
  }
  // ① 无交付说明 → SKIP（v18.78.2 · 全量审计 A5：未检 ≠ 通过；定稿在场而交付说明缺席是 T8 的正常中间态，故不升 P1）
  let it = item()
  assert.equal(it.pass, 'SKIP', '无交付说明应记 SKIP 而非通过：' + it.detail)
  assert.equal(it.severity, 'SKIP')
  assert.match(it.detail, /N\/A/)

  // ② 12 字段齐备 → 通过
  writeFileSync(DD, GOOD)
  it = item()
  assert.equal(it.pass, true, '字段齐备应通过：' + it.detail)
  assert.match(it.detail, /11\/11/)
  assert.match(it.detail, /指纹✓/)

  // ③ 缺「成本指标」字段 → 硬问题
  writeFileSync(DD, GOOD.replace('## 6. 成本指标\n\n- token：~1.2M\n\n', ''))
  it = item()
  assert.equal(it.pass, false, '缺固定字段必须报')
  assert.match(it.detail, /缺固定字段「成本指标」/)

  // ④ 字段只剩模板占位符 → 硬问题
  writeFileSync(DD, GOOD.replace('- token：~1.2M', '- token：<待填>'))
  it = item()
  assert.equal(it.pass, false, '占位符未填必须报')
  assert.match(it.detail, /占位符/)

  // ⑤ 主人决策记录漏 Phase 3.5 → 硬问题（缺回填须显式标「未留痕」）
  writeFileSync(DD, GOOD.replace('Phase 0 09:12 通过｜Phase 2.5 10:05 通过｜Phase 3.5 10:40 通过｜Phase 5 11:20 通过', 'Phase 0 09:12 通过｜Phase 2.5 10:05 通过｜Phase 5 11:20 通过'))
  it = item()
  assert.equal(it.pass, false, '决策记录漏门必须报')
  assert.match(it.detail, /未覆盖/)
  // ⑥ 指纹段只剩旧占位符 → 硬问题（2026-09-29 主人授权修订 EXEC-1：占位符路径废止，须写 sha256 实值）
  writeFileSync(DD, GOOD.replace('- sha256：a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4（权威 = final/证据包/manifest.json）', '- sha256：[哈希校验待主人回填]'))
  it = item()
  assert.equal(it.pass, false, 'EXEC-1 回归锚点：指纹段只剩旧占位符必须报（占位符路径已废止）')
  assert.match(it.detail, /实值/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-8：承重墙超载与虚标必须机检（原为纯 LLM 判断）', () => {
  const { d, proj, fin, ev } = mkProject({ analysis: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n## 一、导论\n\n' + '正文段落。'.repeat(40) + '[L01][D01]\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 📇 索引段\n\n[L01] a ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [L01] a\n信任级别：已发布\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n共 1 条\n\n## 📇 索引段\n\n[D01] d ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [D01] d\n信任级别：已发布\n')
  writeFileSync(join(ev, '案例卡.md'), '# 案例卡\n\n## 📇 索引段\n\n[C01] 祁东案 ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [C01] 祁东案\n信任级别：已发布\n')
  const outline = (rows) => `# 分析大纲\n\n## 一、论点映射\n\n| 论点 | 论据 |\n|---|---|\n| 论点1 | [L01] [D01] |\n\n## 十一、写手版精简段\n\n### 承重墙清单\n\n| 论点 | 承重证据 top1 |\n|---|---|\n${rows}\n`
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Form-8'))
  }
  // ① 无大纲 → 覆盖率照判，承重墙只记备注（不判失败）
  let it = item()
  assert.equal(it.pass, true, '无大纲不得因承重墙判失败：' + it.detail)

  // ② 承重墙分散（无超载）→ 通过
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), outline(['| 论点1 | [C01] 祁东案 |', '| 论点2 | [L01] |'].join('\n')))
  it = item()
  assert.equal(it.pass, true, '无超载应通过：' + it.detail)
  assert.match(it.detail, /承重墙 2 条标注、无超载/)

  // ③ 同一证据被 3 个论点承重 → 超载 P1（教训：祁东案一个案例承重四个论点）
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), outline(['| 论点1 | [C01] 祁东案 |', '| 论点2 | [C01] 祁东案 |', '| 论点3 | [C01] 祁东案 |'].join('\n')))
  it = item()
  assert.equal(it.pass, false, '超载必须报')
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /承重墙超载/)
  assert.match(it.detail, /\[C01\]×3论点/)

  // ④ 承重墙标了卡片里没有的编号 → 虚标 P1
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), outline('| 论点1 | [L99] 幽灵 |'))
  it = item()
  assert.equal(it.pass, false, '虚标必须报')
  assert.match(it.detail, /卡片中不存在的编号/)
  assert.match(it.detail, /\[L99\]/)

  // ⑤ 有承重墙标题但无结构性条目 → 备注
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), '# 分析大纲\n\n## 承重墙清单\n\n（待补）\n')
  it = item()
  assert.match(it.detail, /承重墙清单无结构性条目|承重墙清单为空/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check v18.2.1：承重墙锚点收紧 + 需找数据点容忍冒号 + 范围写法 + exit= 实据（本轮实战反哺）', () => {
  // 本用例的 4 个场景全部来自 v18.2.0 短测试实战踩点（详见 CHANGELOG ## 18.2.1）：
  //   ① 大纲标题里**提及**「承重墙」不得被当成承重墙清单锚点（旧式全行匹配会把论据映射表当清单 → 误报超载）；
  //   ② 任务简报「需找数据点：≥ 3」带冒号也必须被识别（否则需求总数记 0 → M-Integrity-1 假 P0）；
  //   ③ 素材加载清单的范围写法 `[L01]-[L03]` 必须展开（否则中间编号被判「引了没读」→ 假 P0）；
  //   ④ 闸门记录实据写 `exit=2` 也必须算机械证据（旧正则只认 `exit 2`）。
  const { d, proj, fin, ev } = mkProject({ analysis: true, audits: true })
  writeFileSync(join(fin, '定稿.md'),
    '# 标题\n\n## 摘要\n\n## 一、导论\n\n' + '正文段落。'.repeat(40) + '[L01][L02][L03][D01]\n\n'
    + '## 参考文献\n\n[L01] a\n[L02] b\n[L03] c\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 📇 索引段\n\n[L01] a\n[L02] b\n[L03] c\n\n## 正文\n\n### [L01] a\n信任级别：已发布\n\n### [L02] b\n信任级别：已发布\n\n### [L03] c\n信任级别：已发布\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 📇 索引段\n\n[D01] d\n\n## 正文\n\n### [D01] d\n信任级别：已发布\n')
  writeFileSync(join(ev, '案例卡.md'), '# 案例卡\n\n## 📇 索引段\n\n\n## 正文\n')
  // ② 简报：带冒号的「需找数据点：≥ 3」
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n子问题 A：x。\n子问题 B：y。\n需找数据点：≥ 3 条\n')
  // ① 大纲：只有「提及」承重墙的标题 + 表内同编号 3 次（若锚点误命中 → 会报超载）
  writeFileSync(join(proj, 'analysis', '分析大纲.md'),
    '# 分析大纲\n\n## 一、论点映射\n\n| 论点 | 论据 |\n|---|---|\n| 论点1 | [L01] |\n\n### 论点-论据映射表（写手版；M-Form-8 承重墙清单）\n\n| 论点1 | [L01] |\n| 论点2 | [L01] |\n| 论点3 | [L01] |\n')
  // ③ 加载清单：范围写法
  writeFileSync(join(proj, 'analysis', '素材加载清单.md'), '# 清单\n\n## 已加载\n\n| 编号 | 位置 |\n|---|---|\n| [L01]-[L03] | §1 |\n| [D01] | §1 |\n')
  // ④ 闸门记录：实据用 `exit=2` 形态 + 表头含 检查项/实据/结论
  const rows = (items) => items.map((t) => `| ${t} | \`x.json\` exit=2 | ✓ |  |`).join('\n')
  writeFileSync(join(proj, 'audits', '闸门记录-T2.5.md'),
    `# 记录\n\n| 检查项 | 实据 | 结论 | 失败原因 |\n|---|---|---|---|\n${rows(['数据卡文件存在', '数据条目数（双格式并集去重）', '任务简报数据需求总数', '数据条目数 ≥ 需求总数', '信任级别完整性（M-Form-6）', '信任级别一致性（M-Exist-3）', '数据卡头部声明 vs 实际计数', '证据包 sha256 实值（权威 = manifest.json）'])}\n`)
  writeFileSync(join(proj, 'audits', '闸门记录-T7.5.md'),
    `# 记录\n\n| 检查项 | 实据 | 结论 | 失败原因 |\n|---|---|---|---|\n${rows(['审计报告最新版存在', 'P0/P1 清单已列', 'M 门全部 exit 0', '**本阶段正文 sha256**（实值；填当前定稿/初稿的最高版指纹）', '信任级别一致性（M-Exist-3）', '论文交付物 vs 报告独立隔离', '修订轮由独立写手执行'])}\n`
    // v18.12.0（L-33）：T7.5 另须留三个战略门脚本的 exit（模板无此行，是该门的独立判据）
    + '| 战略门预检 | structure-check exit 0 / methodology-check exit 0 / cite-coverage exit 0 | ✓ |  |\n')
  const item = (prefix) => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), join(proj, 'final', '证据包')])
    return parseJson(r).results.find((x) => x.gate.startsWith(prefix))
  }
  // ① 提及「承重墙」的标题不得被当锚点 → 不出现「承重墙超载」
  const f8 = item('M-Form-8')
  assert.ok(!/承重墙超载/.test(f8.detail), '标题里提及承重墙不得被当锚点：' + f8.detail)
  // ② 带冒号的「需找数据点：≥ 3」被识别（需求总数 3 而非 0）
  const mi1 = item('M-Integrity-1')
  assert.match(mi1.detail, /需找数据点 3 条/, '冒号写法必须被识别：' + mi1.detail)
  // ③ 范围写法展开 → [L02] 不得被判「引了没读」
  const f11 = item('M-Form-11')
  assert.ok(!/引了没读/.test(f11.detail), '范围写法必须展开：' + f11.detail)
  // ④ `exit=2` 算机械证据 → 不得报「不是机械证据」
  const e5 = item('M-Exist-5')
  assert.ok(!/不是机械证据/.test(e5.detail), 'exit= 形态必须算机械证据：' + e5.detail)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-8：批判报告 C1-C7 覆盖（漏节 / 编号重复 / 要素不足）', () => {
  const { d, proj, fin, ev } = mkProject({ analysis: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const C = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']
  const mk = (ids, extra = '') => '# 批判报告 v2\n\n'
    + ids.map((c) => `## ${c} 维度${c}\n\n` + '攻击内容与论据。'.repeat(8) + '\n').join('\n')
    + '\n## 批判总结\n\n- 关闭状态：未关闭\n\n' + extra
  const FULL_ENTRY = '[P0-C1-1] 论点「X」的反方攻击\n- 论点定位：§三 第 2 段（行 67-72）\n- 反方观点：因果方向可能反转\n- 你的论据 [L01]：未控制变量\n- 攻击强度：高\n- 建议：加固\n'
  const REV = join(proj, 'analysis', '批判报告-v2.md')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-8'))
  }
  // ① 无批判报告 → SKIP（v18.78.2 · 全量审计 A5：未检 ≠ 通过；轻量档一律跳过 Phase 3.6，故不升 P1）
  let it = item()
  assert.equal(it.pass, 'SKIP', '无批判报告应记 SKIP 而非通过：' + it.detail)
  assert.equal(it.severity, 'SKIP')
  assert.match(it.detail, /N\/A/)

  // ② 七节齐备 + 规范清单条目 → 通过
  writeFileSync(REV, mk(C, FULL_ENTRY))
  it = item()
  assert.equal(it.pass, true, '七维齐备应通过：' + it.detail)
  assert.match(it.detail, /C1-C7 实到 7\/7/)

  // ③ 缺 C3 → P1
  writeFileSync(REV, mk(C.filter((c) => c !== 'C3'), FULL_ENTRY))
  it = item()
  assert.equal(it.pass, false, '漏节必须报')
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /缺 1 节：C3/)

  // ④ 缺 4 节 → P0
  writeFileSync(REV, mk(['C1', 'C2', 'C5'], FULL_ENTRY))
  it = item()
  assert.equal(it.severity, 'P0', '缺 >2 节应 P0：' + it.detail)

  // ⑤ 编号重复 → 硬问题
  writeFileSync(REV, mk(C, FULL_ENTRY + FULL_ENTRY))
  it = item()
  assert.equal(it.pass, false, '编号重复必须报')
  assert.match(it.detail, /编号重复/)

  // ⑥ 要素不足（只写建议）→ 软提示
  writeFileSync(REV, mk(C, '[P0-C1-1] 论点「X」\n- 建议：加固\n'))
  it = item()
  assert.match(it.detail, /要素不足 3 项|要素不足/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-9：审计报告 G0-G14 覆盖（漏项 / 只提不判 / 子项缺）', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const GALL = ['G0', 'G0.5', 'G1', 'G2', 'G2.5', 'G3', 'G4', 'G4-2', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14']
  const mk = (gs) => `# 审计报告 v1\n\n结论：通过 ✅\n\n` + gs.map((g) => `- **${g}**：通过（见 引用核验记录；覆盖 5/5）`).join('\n') + '\n'
  const AUD = join(aud, '审计报告-v1.md')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-9'))
  }
  // ① 无审计报告 → **P1**（v18.78.2 · 全量审计 A5）：本夹具已写 `final/定稿.md` ⇒ Phase 5 已开始
  //   ⇒ T7.5 闸门（审计报告 + M 门全 exit 0）必已通过 ⇒ **审计报告必然存在过**；报告却不在 = 被删/改名/移出。
  //   旧行为记 `pass: true`（N/A）→ `rm audits/审计报告-*.md` 即可让本门静默退回「通过」。
  let it = item()
  assert.equal(it.pass, false, '定稿在场而审计报告缺席必须判 P1（防「删文件即通过」）：' + it.detail)
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /阶段已到却/)

  // ② 全 15 主项 + 子项齐 → 通过（G1 不得误命中 G14 / G0 不得误命中 G0.5）
  writeFileSync(AUD, mk(GALL))
  it = item()
  assert.equal(it.pass, true, 'G 项全覆盖应通过：' + it.detail)
  assert.match(it.detail, /G0-G14 实到 15\/15/)

  // ③ 缺 G11-G14 → P0（>3 项）
  writeFileSync(AUD, mk(GALL.filter((g) => !['G11', 'G12', 'G13', 'G14'].includes(g))))
  it = item()
  assert.equal(it.pass, false, '缺 G 项必须报')
  assert.equal(it.severity, 'P0', '缺 >3 项应 P0：' + it.detail)
  assert.match(it.detail, /G11,G12,G13,G14/)

  // ④ 只提名不给结论 → 软提示（须邻域内有结论词）
  writeFileSync(AUD, '# 审计报告 v1\n\n结论：通过 ✅\n\n' + GALL.map((g) => `- ${g}`).join('\n') + '\n')
  it = item()
  assert.equal(it.pass, false, '只提不判应记软问题（pass=false + P2）')
  assert.match(it.detail, /邻域无结论词|有提及但邻域无结论词/)

  // ⑤ 子项缺 → 软提示
  writeFileSync(AUD, mk(['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14']))
  it = item()
  assert.match(it.detail, /子项未覆盖/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-10：大纲 §11 精简段六要素（缺段 / 缺要素 / 假表格）', () => {
  const { d, proj, fin, ev } = mkProject({ analysis: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const OUT = join(proj, 'analysis', '分析大纲.md')
  const SIX = '## 十一、写手版精简段\n\n- 论证主线：X\n- 反方规划要点：Y\n- 字数预算：4000 字\n- 禁做项：Z\n- 承重墙清单：| 论点1 | [C01] |\n- 映射表：| 论点 | 论据 |\n|---|---|\n| 论点1 | [L01] |\n'
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-10'))
  }
  // ① 无大纲 → 未检（SKIP）
  //   v18.62.4（全量审计-v18.62.3 P1-5）：原断言 `pass === true`（N/A）——detail 写着「N/A 且**未检**…
  //   不得读成通过」而退出码侧记「通过」，移走大纲即可静默关掉该门。现改记 `SKIP`（→ exit 3）。
  let it = item()
  assert.equal(it.pass, 'SKIP', '无大纲 = 未检，不得读成通过')
  assert.equal(it.severity, 'SKIP')
  assert.match(it.detail, /N\/A/)

  // ② 有纲但缺 §11 → P2（T5 会回退整读大纲）
  writeFileSync(OUT, '# 分析大纲\n\n## 一、论点\n\n内容\n')
  it = item()
  assert.equal(it.pass, false, '缺 §11 标题必须报')
  assert.equal(it.severity, 'P2')
  assert.match(it.detail, /精简段/)

  // ③ 六要素齐备 → 通过
  writeFileSync(OUT, '# 分析大纲\n\n## 一、论点\n\n内容\n\n' + SIX)
  it = item()
  assert.equal(it.pass, true, '六要素齐备应通过：' + it.detail)
  assert.match(it.detail, /六要素实到 6\/6/)

  // ④ 缺 4 要素 → P0
  writeFileSync(OUT, '# 分析大纲\n\n## 十一、写手版精简段\n\n- 主线：X\n- 映射：| 论点 | 论据 |\n|---|---|\n| 论点1 | [L01] |\n')
  it = item()
  assert.equal(it.pass, false, '缺要素必须报')
  assert.equal(it.severity, 'P0', '缺 ≥3 要素应 P0：' + it.detail)
  assert.match(it.detail, /缺 4 个要素/)

  // ⑤ 六要素关键词齐但映射表不是真表格（无素材编号）→ 软提示
  writeFileSync(OUT, '# 分析大纲\n\n## 十一、写手版精简段\n\n- 论证主线：X\n- 反方规划要点：Y\n- 字数预算：4000 字\n- 禁做项：Z\n- 承重墙清单：X\n- 映射表：论点 → 论据\n- 补充行 1\n')
  it = item()
  assert.match(it.detail, /真表格|映射表/)

  // ⑥ 前置 §D 标题含中置「§11 写手精简段引用」不误命中；真 §11 在后方 → 仍识别 6/6（v18.6.2 反哺）
  writeFileSync(OUT, '# 分析大纲\n\n## 一、论点\n\n内容\n\n## §D 图表建议（v2.4.6，§11 写手精简段引用）\n\n内容\n\n## §11 写手版精简段\n\n- 论证主线：X\n- 反方规划要点：Y\n- 字数预算：4000 字\n- 禁做项：Z\n- 承重墙清单：| 论点1 | [C01] |\n- 映射表：| 论点 | 论据 |\n|---|---|\n| 论点1 | [L01] |\n')
  it = item()
  assert.equal(it.pass, true, '§D 中置「§11 引用」不得误命中：' + it.detail)
  assert.match(it.detail, /六要素实到 6\/6/)

  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-9：G 项结论必须带实据（只写「通过」→ 软提示）', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const GALL = ['G0', 'G0.5', 'G1', 'G2', 'G2.5', 'G3', 'G4', 'G4-2', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14']
  const AUD = join(aud, '审计报告-v1.md')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-9'))
  }
  // ① 结论带实据（文件路径 / 带量词数字）→ 通过
  writeFileSync(AUD, '# 审计报告 v1\n\n结论：通过 ✅\n\n' + GALL.map((g) => `- **${g}**：通过（见 引用核验记录；覆盖 5/5）`).join('\n') + '\n')
  let it = item()
  assert.equal(it.pass, true, '结论带实据应通过：' + it.detail)
  assert.doesNotMatch(it.detail, /无实据/)

  // ② 只写「通过」不给依据 → 软问题（15 项结论无实据）
  writeFileSync(AUD, '# 审计报告 v1\n\n结论：通过 ✅\n\n' + GALL.map((g) => `- **${g}**：通过`).join('\n') + '\n')
  it = item()
  assert.equal(it.pass, false, '只写通过不给依据必须报')
  assert.equal(it.severity, 'P2')
  assert.match(it.detail, /无实据/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-6：审稿建议可消费性 + 修订回执闭环', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const REP = join(aud, '审稿报告-v2.md')
  const base = (sug) => '# 同行评审报告\n\n> **总评分**：24/30\n> **建议**：minor revision\n\n'
    + '| 维度 | 得分 | 一句话评价 |\n|------|------|-----------|\n'
    + ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范'].map((x) => `| ${x} | 4/5 | 好 |`).join('\n')
    + '\n| **总分** | **24/30** | **minor revision** |\n\n判定：minor revision\n\n' + sug
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-6'))
  }
  // ① 建议条目带定位 → 通过
  writeFileSync(REP, base('## 给作者的具体修改建议（按优先级）\n\n1. 补 §三 第 2 段的 [L01] 支撑\n2. 第 4 章增补反方\n'))
  let it = item()
  assert.equal(it.pass, true, '建议带定位应通过：' + it.detail)

  // ② 建议无定位（自由叙述）→ 软提示
  writeFileSync(REP, base('## 给作者的具体修改建议（按优先级）\n\n1. 建议进一步加强论证的严谨性\n'))
  it = item()
  assert.equal(it.pass, false, '建议无定位必须报')
  assert.match(it.detail, /无定位/)

  // ③ 发生修订轮但修订说明未提审稿意见 → 软提示（建议提了没人接）
  writeFileSync(join(proj, 'drafts', '修订说明-v2.md'), '# 修订说明 v2\n\n- 已处理 P0-1\n')
  it = item()
  assert.match(it.detail, /未提及审稿意见/)
  rmSync(d, { recursive: true, force: true })
})

test('自省审计：splitCard 必须优先标题式条目（索引段行抢先命中会让合规卡判 P0 假阳性）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01] [D01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  // 8 条**全部合规**的数据卡（带「## 📇 索引段」——索引行 `[D02] …` 在正文条目前面）
  const N = 8
  writeFileSync(join(ev, '数据卡.md'),
    '# 数据卡\n\n> 合计 8 条\n\n## 📇 索引段\n\n'
    + Array.from({ length: N }, (_, i) => `[D0${i + 1}] 条目${i + 1} ｜ 主题 ｜ 论点1`).join('\n')
    + '\n\n## 正文\n\n' + Array.from({ length: N }, (_, i) => `### [D0${i + 1}] 条目${i + 1}\n信任级别：已发布\n`).join('\n'))
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
  const it = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-6'))
  assert.equal(it.pass, true, `条目全合规的 ${N} 条卡不得判失败（旧版 splitCard 命中索引行 → 8 条「独立段缺失」→ P0 阻塞交付）：${it.detail}`)
  assert.equal(it.severity, '通过')
  rmSync(d, { recursive: true, force: true })
})

test('自省审计：M-Form-3 查占位符残留（不再与 M-Exist-1 重复算被引编号）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 正文\n\n### [D01] d\n信任级别：已发布\n')
  const DRAFT = (tail) => '# 标题\n\n## 摘要\n\n正文 [L01] [D01]。\n\n## 一、导论\n\n' + '段落。'.repeat(20) + tail
    + '\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Form-3'))
  }
  // ① 干净定稿 → 通过（正文↔文末闭环归 M-Exist-1，本项不再报「孤儿编号」）
  writeFileSync(join(fin, '定稿.md'), DRAFT(''))
  let it = item()
  assert.equal(it.pass, true, '干净定稿应通过：' + it.detail)
  assert.doesNotMatch(it.detail, /孤儿编号/)

  // ② 定稿残留 [待补] → P1（旧版无任何项能抓它）
  writeFileSync(join(fin, '定稿.md'), DRAFT('\n本处数据 [待补]。'))
  it = item()
  assert.equal(it.pass, false, '占位符残留必须报')
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /占位符|临时标记/)

  // ③ ≥3 处 → P0
  writeFileSync(join(fin, '定稿.md'), DRAFT('\n[待补] [TBD] （待核）'))
  it = item()
  assert.equal(it.severity, 'P0', '≥3 处占位符应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('自省审计：M-Form-4 任一泄露即 P0 / M-Form-5 补 P0 档（旧版分支不可达）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const DRAFT = (tail) => '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、导论\n\n' + '段落。'.repeat(20) + tail
    + '\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  const item = (pre) => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith(pre))
  }
  // 一处内部代号 → P0（文档写「P0 优先级」，旧脚本只给 P1）
  writeFileSync(join(fin, '定稿.md'), DRAFT('\n本段由 T5 写手完成。'))
  let it = item('M-Form-4')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '一处元数据泄露即 P0（与文档口径对齐）：' + it.detail)

  // 过程语言 >10 处 → P0（旧版最高 P1，P0 分支不可达）
  writeFileSync(join(fin, '定稿.md'), DRAFT('\n' + '初稿 承重墙 卡级 批注 修卡 待回查 审计环节 流水线 草稿 上一版 下一版 将在正式出版前订正。'))
  it = item('M-Form-5')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '过程语言 >10 处应 P0：' + it.detail)

  // v18.2.9（审计 B9 变异盲区）：中档 6-10 处 → P1（旧测试只覆盖两端，P1→P2 降档变异测不出）
  writeFileSync(join(fin, '定稿.md'), DRAFT('\n初稿 承重墙 卡级 批注 修卡 待回查。'))
  it = item('M-Form-5')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P1', '过程语言 6-10 处应 P1（防降档变异）：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.2.9 审计 B9 后半：M-Form-5 禁词表逐词注入（删任意一词必被测试抓出）', () => {
  const { d, proj, fin, ev } = mkProject()
  // 与 m-gate-check.mjs 的 bannedBanned 词表逐条对应（正则形态的 v\d+ 稿 / 将在…订正 除外，其余逐词）
  // 此表即「契约测试」：若实现里删掉某个词，注入该词的用例会从「应命中」变「通过」→ 红。
  const BANNED_WORDS = [
    '初稿', '草稿', '修订说明', '上一版', '下一版', '卡级', '修卡', '承重墙', '批注', '待回查',
    '审计环节', '流水线', '一处两用', '段级条目', '索引段', '素材加载清单', '素材卡', '案例卡', '数据卡', '文献卡',
  ]
  const DRAFT = (word) => '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、导论\n\n' + '段落。'.repeat(20) + `\n本段含「${word}」。`
    + '\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  for (const word of BANNED_WORDS) {
    writeFileSync(join(fin, '定稿.md'), DRAFT(word))
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    const it = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-5'))
    assert.equal(it.pass, false, `禁词「${word}」注入后 M-Form-5 必须命中（若实现删了该词则本用例红）`)
  }
  rmSync(d, { recursive: true, force: true })
})

test('v18.2.9 审计 A7：m-gate-check 未知旗标 / 多余位置参数一律 exit 10（旧版静默忽略）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  // 未知旗标（拼错的 --summary）：旧版被 filter(a => !a.startsWith('--')) 静默丢弃、照常全量运行
  const r1 = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev, '--sumaryx'])
  assert.equal(r1.code, 10, '未知旗标应 exit 10（不得静默忽略——用户以为在出摘要，实际拿全量）')
  assert.match(r1.out + (r1.err || ''), /未知参数/)
  // 第 3 个位置参数：旧版静默忽略
  const r2 = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev, join(fin, '多余参数')])
  assert.equal(r2.code, 10, '多余位置参数应 exit 10')
  // --fig-dir 缺值（值是最后一个 token）：cli-args 统一承担（原 v18.2.6 手写防御的等价回归）
  const r3 = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev, '--fig-dir'])
  assert.equal(r3.code, 10, '--fig-dir 缺值应 exit 10')
  rmSync(d, { recursive: true, force: true })
})

test('v18.2.9 审计 B14：--report 路径错（父目录是文件）→ exit 10 且响亮报错（不得伪装成内容判定/静默通过）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  // 报告路径的父目录其实是一个普通文件 → 建目录失败（磁盘满/权限错的同构形态）
  // v18.70.0（批 7 · mkdir 收敛）语义精化：预建目录的死代码删除后，此场景由 writeReport 的
  //   建目录守卫归 **exit 10**（路径/参数错，与全仓「路径错=10」教义一致），比旧的 70 更准确。
  //   真实「写盘失败」仍由 writeWithSafety 抛错 → 外层 catch → exit 70（落盘失败≠内容判定），该路径未变。
  const badReport = join(join(fin, '定稿.md'), 'no', 'report.json')
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev, '--report', badReport])
  assert.equal(r.code, 10, '路径错（父目录是文件）应 exit 10，不得 exit 0 伪装通过')
  assert.match(r.err || r.out || '', /无法创建|路径|目录/)
  rmSync(d, { recursive: true, force: true })
})

test('自省审计：M-Integrity-1 不再是永久 soft（数据条目不足 → P0）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01] [D01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 📇 索引段\n\n[D01] d ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [D01] d\n信任级别：已发布\n')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Integrity-1'))
  }
  // ① 需求 ≤ 条目 → 通过（保留「主控 L4 跨文件判断」定位）
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n子问题 A：x。\n需找数据点 ≥1\n')
  let it = item()
  assert.equal(it.pass, true, '需求 ≤ 条目应通过：' + it.detail)
  assert.match(it.detail, /对账通过|主控 L4/)

  // ② 需求 > 条目 → P0（文档步骤 4 承诺的 P0，旧版不可达）
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n子问题 A：x。\n需找数据点 ≥12\n')
  it = item()
  assert.equal(it.pass, false, '数据条目不足必须报')
  assert.equal(it.severity, 'P0', 'T2.5 步骤 4 不足应 P0：' + it.detail)
  assert.match(it.detail, /数据条目 1 条 < 简报需求 12 条/)

  // ③ 数据卡缺失 → P0
  rmSync(join(ev, '数据卡.md'), { force: true })
  it = item()
  assert.equal(it.severity, 'P0', '数据卡缺失应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Form-10：索引段缺条必须报（下游按索引定位会漏卡），索引齐则通过', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const lit = join(ev, '文献卡.md')
  // 正文 2 条、索引只有 1 条 → 索引缺 L02
  writeFileSync(lit, '# 文献卡\n\n## 📇 索引段\n\n[L01] Coleman 1988 ｜ 社会资本 ｜ 论点1\n\n## 正文分组\n\n### [L01] Coleman\n信任级别：已发布\n\n### [L02] Putnam\n信任级别：已发布\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 📇 索引段\n\n[D01] 数值 86 万 ｜ 来源 ｜ 论点1\n\n## 正文\n\n### [D01] 某公报\n信任级别：已发布\n')
  const gate = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Form-10'))
  }
  let item = gate()
  assert.equal(item.pass, false, '索引缺条必须失败')
  assert.equal(item.severity, 'P1', item.detail)
  assert.match(item.detail, /索引段缺 1 条/, '必须指名缺哪条：' + item.detail)
  assert.match(item.detail, /L02/)
  // 补齐索引 → 通过（案例卡缺失只记备注，不判失败——0 条场景合法）
  writeFileSync(lit, readFileSync(lit, 'utf8').replace('[L01] Coleman 1988 ｜ 社会资本 ｜ 论点1', '[L01] Coleman 1988 ｜ 社会资本 ｜ 论点1\n[L02] Putnam 1995 ｜ 公民参与 ｜ 论点1'))
  item = gate()
  assert.equal(item.pass, true, '索引补齐后应通过：' + item.detail)
  assert.match(item.detail, /未找到/, '缺卡只作备注')
  // 索引悬空 + 头部声明不符 → 硬/软问题
  // ⚠️ v18.62.7（反哺-主控实测 A4）：**悬空用例改用普通编号 `L98`** —— `[L99]` 是《机检硬格式》§二
  //   明文规定的**索引段独有编号**（对立证据，不计入总条数、正文无对应条目），本批起已从悬空对账豁免。
  //   旧用例把 `[L99]` 当悬空样本，等于把「合规形态」钉成了「必须报错」——这正是 A4 的病灶。
  writeFileSync(lit, readFileSync(lit, 'utf8').replace('# 文献卡', '# 文献卡\n\n> 合计 5 条').replace('[L02] Putnam 1995 ｜ 公民参与 ｜ 论点1', '[L98] 悬空'))
  item = gate()
  assert.equal(item.pass, false, '头部声明与悬空必须报')
  assert.match(item.detail, /头部声明 5 条 ≠ 正文条目 2 条/)
  assert.match(item.detail, /L98/, '**普通编号**的索引悬空仍必须报（豁免只针对特殊编号）：' + item.detail)
  // 反向钉：`[L99]` 不得再被判「正文无对应条目」
  writeFileSync(lit, readFileSync(lit, 'utf8').replace('[L98] 悬空', '[L99] 悬空'))
  item = gate()
  assert.ok(!/L99/.test(item.detail), '[L99] 属《机检硬格式》§二 的索引段独有编号，不得判「索引悬空」：' + item.detail)
  // 三张卡都没有 → N/A
  rmSync(lit, { force: true })
  rmSync(join(ev, '数据卡.md'), { force: true })
  item = gate()
  assert.equal(item.pass, true, '无卡应记 N/A 而非失败')
  assert.match(item.detail, /N\/A/)
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check M-Exist-4：修订任务书结构 + 审计↔复核编号闭环 + 初轮不得预填「已关闭」', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-4'))
  }
  const AUD = join(aud, '审计报告-v1.md')
  const REV = join(aud, '复核报告-v1.md')
  const HEAD = '| 编号 | 严重度 | 改哪里（文件+位置） | 怎么改（具体动作） | 验收标准 | 关闭状态 |\n|---|---|---|---|---|---|\n'
  const ROW = (id, st) => `| ${id} | P1 | 初稿.md §三第 2 段 | 补 [L01] 支撑该论点 | 该段含 [L01] 且 M-Form-8 通过 | ${st} |\n`

  // ① 无审计报告 → **P1**（v18.78.2 · 全量审计 A5）：本夹具已写 `final/定稿.md`（见本用例开头），
  //   故「审计报告缺席」不是「阶段未到」而是被删/改名/移出 —— 旧行为记 N/A pass，删文件即可退回通过。
  let it = item()
  assert.equal(it.pass, false, '定稿在场而审计报告缺席必须判 P1：' + it.detail)
  assert.equal(it.severity, 'P1')
  assert.match(it.detail, /阶段已到却/)

  // ② 打回 + 完整任务书（待复核）+ 复核报告覆盖 → 通过
  writeFileSync(AUD, `# 审计报告 v1\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${HEAD}${ROW('P0-1', '待复核')}${ROW('P1-1', '待复核')}`)
  writeFileSync(REV, '# 复核报告 v1\n\n| 原条目编号 | 判定 | 依据 |\n|---|---|---|\n| P0-1 | ✓已关闭 | 修订说明 §2 |\n| P1-1 | ✓已关闭 | 头部已清理 |\n')
  it = item()
  assert.equal(it.pass, true, '完整任务书 + 复核覆盖应通过：' + it.detail)
  assert.match(it.detail, /闭环成立/)

  // ③ 初轮（无复核报告）预填「已关闭」→ 硬问题
  rmSync(REV, { force: true })
  writeFileSync(AUD, `# 审计报告 v1\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${HEAD}${ROW('P0-1', '已关闭')}`)
  it = item()
  assert.equal(it.pass, false, '未复核就宣称已关闭必须报')
  assert.match(it.detail, /尚未有复核报告|尚无复核报告|真源是复核报告/)

  // ④ 编号重复 + 位置列空缺 → 硬问题
  writeFileSync(AUD, `# 审计报告 v1\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${HEAD}${ROW('P1-1', '待复核')}| P1-1 | P1 |  |  |  | 待复核 |\n`)
  it = item()
  assert.equal(it.pass, false)
  assert.match(it.detail, /编号重复|空缺/)

  // ⑤ 已有修订说明但缺复核报告 → 硬问题（复核必须落盘）
  writeFileSync(join(proj, 'drafts', '修订说明-v1.md'), '# 修订说明 v1\n')
  writeFileSync(AUD, `# 审计报告 v1\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${HEAD}${ROW('P1-1', '待复核')}`)
  it = item()
  assert.equal(it.pass, false, '有修订说明但无复核报告必须报')
  assert.match(it.detail, /复核报告/)

  // ⑥ 结论「通过」→ 无需任务书，也不因缺复核报告而失败
  writeFileSync(AUD, '# 审计报告 v1\n\n结论：通过 ✅（剩余风险：付费墙文献仅核验摘要）\n')
  it = item()
  assert.equal(it.pass, true, '结论通过时无需任务书：' + it.detail)
  assert.match(it.detail, /无需任务书/)
  rmSync(d, { recursive: true, force: true })
})

// ── v18.0.2 新增回归（D1 静默失效门 + 退出码契约）─────────────────────────────

test('m-gate-check M-Form-9：审 drafts/初稿-vN.md 时必须从 01-任务简报.md 取「拍板图位数」（v18.0.2 修 D1 静默失效）', () => {
  const { d, proj, fin, ev } = mkProject()
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  // 简报拍板 3 张图；初稿只标 2 个图位 → 期望 M-Form-9 报「图位不足」
  writeFileSync(join(proj, '01-任务简报.md'), '# 任务简报\n\n图位数量：3\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 📇 索引段\n\n[D01] 数值 1 ｜ 来源 ｜ 论点1\n\n## 正文\n\n### [D01] 某公报\n信任级别：已发布\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 📇 索引段\n\n[L01] 某文 ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [L01] 某文\n信任级别：已发布\n')
  const draft = join(proj, 'drafts', '初稿-v1.md')
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文 [L01][D01]。\n\n[图1：甲]\n\n[图2：乙]\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  // 审「初稿」而非 final/定稿.md —— 旧实现下 briefPath 会退回初稿自身 → pledged=0 → 该项静默不判
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev])
  const item = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-9'))
  assert.ok(item, '必须有 M-Form-9 结果项')
  assert.match(item.detail, /图位不足/, '必须从上级目录的 01-任务简报.md 取到拍板 3 张图并判「图位不足」：' + item.detail)
  assert.match(item.detail, /记为 3 张/, '报错文案必须写明拍板数来自简报')
  rmSync(d, { recursive: true, force: true })
})

test('v18.2.9 方案：m-gate M-Form-8 裸断言段——长段落零引用 → P2 提示；引言段不报', () => {
  const { d, proj, fin, ev } = mkProject()
  // 正文：一导论含正常引用，另有一段 350 字零引用的裸断言段（放在「## 二、方法」下）
  const bare = '这是一个没有任何引用的长段。'.repeat(18)   // 18 × 16 字 ≈ 288 字，再加补足
  const bareLong = bare + '继续补充内容以确保超过阈值。'.repeat(8)
  const draft = '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、导论\n\n段落内容 [L01]。\n\n## 二、方法\n\n' + bareLong + '\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  writeFileSync(join(fin, '定稿.md'), draft)
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
  const it = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-8'))
  assert.match(it.detail, /裸断言/, '350 字零引用段应报裸断言 P2 提示：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.3.0 阶段 3：m-gate M-Form-8 句长异常——超长句 → P2 提示', () => {
  const { d, proj, fin, ev } = mkProject()
  // 构造一个 >120 字的无标点长句
  const longSent = '这是一个非常长的句子' + '内容'.repeat(60) + '。'
  const draft = '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 一、导论\n\n段落 [L01]。\n\n## 二、方法\n\n' + longSent + '\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
  writeFileSync(join(fin, '定稿.md'), draft)
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
  const it = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-8'))
  assert.match(it.detail, /异常长句/, '超长句应报句长异常 P2 提示：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

// ===== v18.3.1 审计 B9 补齐：P0/P1 严重度档位断言（防「P1 改 P2 / P0 改 P1」降档变异）=====
// 第三方审计 B9：多数门只有 `pass === false` 断言、无 `severity === 'P0'/'P1'` 断言——把某门的
//   P1 静默改 P2（软提示）或 P0 改 P1，`pass === false` 仍成立 → 用例不变红。M-Form-5 禁词表删词
//   已在 v18.2.9 用「逐词注入」封死；这里补其余无严重度断言的门，每门钉死其 P0 与/或 P1 硬档。
// 注：以下用「M-Form-1 」带空格前缀，避免 startsWith('M-Form-1') 连带命中 M-Form-10/11。

test('v18.3.1 审计 B9：M-Form-1 正文零 [Lxx] 必须 P0（L=0 漏检根因，防降档）', () => {
  const { d, fin, ev } = mkProject()
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  // 正文只有 [D01][C01]、无任何 [Lxx] → L_count = 0 → P0
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文 [D01] [C01]。\n\n## 参考文献\n\n[D01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] c\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const it = gateOf(draft, ev, 'M-Form-1 ')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '正文无 [Lxx] 应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.3.1 审计 B9：M-Form-6 数据卡缺失 P0 / 缺信任级别段 3 条 P1（防降档）', () => {
  const { d, fin, ev } = mkProject()
  const draft = join(fin, '定稿.md')
  // ① 数据卡缺失 → P0
  writeFileSync(draft, DRAFT_OK)
  writeFileSync(join(ev, '文献卡.md'), cardOk('文献卡', ['L01']))
  writeFileSync(join(ev, '案例卡.md'), cardOk('案例卡', ['C01']))
  let it = gateOf(draft, ev, 'M-Form-6')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '数据卡缺失应 P0：' + it.detail)
  // ② 数据卡 3 条缺独立信任级别段 → P1（mform6P1=2 < 3 ≤ mform6P0=5）
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文 [L01] [D01] [D02] [D03]。\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] a\n[D02] b\n[D03] c\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '数据卡.md'), cardOk('数据卡', ['D01', 'D02', 'D03']).replace(/信任级别：已发布/g, ''))
  it = gateOf(draft, ev, 'M-Form-6')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P1', '3 条缺信任级别段应 P1：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.3.1 审计 B9：M-Form-7 文末混入非白名单节必须 P0（防 P0 降 P1）', () => {
  const { d, fin, ev } = mkProject()
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, DRAFT_OK.replace('## AI 使用声明', '## 主控签字\n\n已终检。\n\n## AI 使用声明'))
  const it = gateOf(draft, ev, 'M-Form-7')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '文末混入非白名单节应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.3.1 审计 B9 / v18.50.0 主人裁定③：M-Form-8 缺 [Lxx] **分三档**（真缺口仍 P0）', () => {
  // **本条被有意改口径，改的是"判定标准"而非"断言强度"**——原意必须完整保留：
  //   · 原（v18.3.1 审计 B9）：论点段缺 [Lxx] → **P0**（防 P0 降 P1），防的是**真缺口被降档**；
  //   · 现（v18.50.0）：主人 2026-09-28 裁定取 **③ 分三档** —— 零证据→P0 / 单类证据→P1 / **≥2 类证据但缺 [L]→P2**。
  //     改的理由（实测）：描述性研究的「描述性结果 / 案例深描」节以 [D]/[C] 承重时三角验证**已成立**，
  //     一律判 P0 会让**写作风格**而非研究质量决定致命度（题1 两臂同门被判不同量级）。
  //   · **B9 的原意未被削弱**：零证据（cov=0）仍是 P0 —— 本条**新增反向控制组**把它钉死。
  const { d, fin, ev } = mkProject()
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  // ① ≥2 类证据（[D]+[C]）但未回引 [Lxx] → P2（旧口径 P0；本次裁定降档）
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n摘要若干字。\n\n## 一、导论\n\n'
    + '正文 [D01] [C01]。'.repeat(12)
    + DRAFT_OK.slice(DRAFT_OK.indexOf('\n\n## 参考文献')))
  let it = gateOf(draft, ev, 'M-Form-8')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P2', '≥2 类证据但缺 [L] 应 P2（主人裁定③）：' + it.detail)
  assert.match(String(it.detail), /有证据但缺 \[Lxx\]/, 'detail 须单列该档计数：' + it.detail)
  // ② **反向控制组（B9 原意）**：零证据段仍必须 P0 —— 真缺口不得被本次放宽带走
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n摘要若干字。\n\n## 一、导论\n\n'
    + '本段叙述刻意不引用任何素材编号，只为撑满节长以进入 M-Form-8 扫描。'.repeat(8)
    + DRAFT_OK.slice(DRAFT_OK.indexOf('\n\n## 参考文献')))
  it = gateOf(draft, ev, 'M-Form-8')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '**零证据段仍必须 P0**（v18.3.1 B9 的原意）：' + it.detail)
  assert.match(String(it.detail), /段缺任意证据/, 'detail 须写明是「缺任意证据」：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.3.1 审计 B9：M-Form-10 索引段缺条 ×3 卡 → P0（防 P0 降 P1）', () => {
  const { d, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01] [D01] [C01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] c\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  // 三张卡：正文条目 2 条、索引段只 1 条 → 每卡一个「索引段缺」finding → 合计 3 → P0
  const card2 = (name, ids) => `# ${name}\n\n## 📇 索引段\n\n[${ids[0]}] 主题 ｜ 论点1\n\n## 正文\n\n` + ids.map((id) => `### [${id}] 条目\n信任级别：已发布\n`).join('\n')
  writeFileSync(join(ev, '文献卡.md'), card2('文献卡', ['L01', 'L02']))
  writeFileSync(join(ev, '数据卡.md'), card2('数据卡', ['D01', 'D02']))
  writeFileSync(join(ev, '案例卡.md'), card2('案例卡', ['C01', 'C02']))
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
  const it = parseJson(r).results.find((x) => x.gate.startsWith('M-Form-10'))
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '三卡各缺 1 条索引应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.3.1 审计 B9：M-Exist-1 漏引 1 条 P1 / 漏引 >10 条 P0（防降档）', () => {
  const { d, fin, ev } = mkProject()
  setupCards(ev)
  const draft = join(fin, '定稿.md')
  // ① 1 条漏引 → P1
  writeFileSync(draft, DRAFT_OK.replace('正文 [L01] [D01] [C01] [先01]。', '正文 [L01] [D01] [C01] [先01] [L99]。'))
  let it = gateOf(draft, ev, 'M-Exist-1 ')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P1', '1 条漏引应 P1：' + it.detail)
  // ② 12 条漏引 → P0
  const many = '正文 ' + ['L20', 'L21', 'L22', 'L23', 'L24', 'L25', 'L26', 'L27', 'L28', 'L29', 'L30', 'L31'].map((x) => `[${x}]`).join(' ') + '。'
  writeFileSync(draft, DRAFT_OK.replace('正文 [L01] [D01] [C01] [先01]。', many))
  it = gateOf(draft, ev, 'M-Exist-1 ')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '漏引 >10 条应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.3.1 审计 B9：M-Exist-3 悬空 [Dxx] 3 条 P1 / 6 条 P0（防降档）', () => {
  const { d, fin, ev } = mkProject()
  setupCards(ev)   // 数据卡只有 [D01]
  const draft = join(fin, '定稿.md')
  const withD = (ids) => DRAFT_OK.replace('正文 [L01] [D01] [C01] [先01]。', '正文 [L01] ' + ids.map((x) => `[${x}]`).join(' ') + ' [C01] [先01]。')
  // ① 3 条悬空 → P1
  writeFileSync(draft, withD(['D01', 'D91', 'D92', 'D93']))
  let it = gateOf(draft, ev, 'M-Exist-3')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P1', '3 条悬空应 P1：' + it.detail)
  // ② 6 条悬空 → P0
  writeFileSync(draft, withD(['D01', 'D91', 'D92', 'D93', 'D94', 'D95', 'D96']))
  it = gateOf(draft, ev, 'M-Exist-3')
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '6 条悬空应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.3.1 审计 B9：M-Exist-4 修订任务书 1 项硬问题 P1 / 多项结构缺失 P0（防降档）', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const AUD = join(aud, '审计报告-v1.md')
  const HEAD = '| 编号 | 严重度 | 改哪里（文件+位置） | 怎么改（具体动作） | 验收标准 | 关闭状态 |\n|---|---|---|---|---|---|\n'
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-4'))
  }
  // ① 初轮（无复核报告）预填「已关闭」→ 1 项硬问题 → P1
  writeFileSync(AUD, `# 审计报告 v1\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${HEAD}| P0-1 | P1 | 初稿.md §三 | 补 [L01] | 该段含 [L01] | 已关闭 |\n`)
  let it = item()
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P1', '初轮预填已关闭应 P1：' + it.detail)
  // ② 3 行每行 位置/动作/验收 三列全空 → >2 项硬问题 → P0
  const bad = ['X1', 'X2', 'X3'].map((id) => `| ${id} | P1 |  |  |  | 待复核 |`).join('\n')
  writeFileSync(AUD, `# 审计报告 v1\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${HEAD}${bad}\n`)
  it = item()
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '多项结构缺失应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.3.1 审计 B9：M-Exist-6 总评分≠分项和 P1 / 期刊行缺百分比 ×3 P0（防降档）', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const REP = join(aud, '审稿报告-v2.md')
  const DIMS = ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范']
  const base = (total, dims, journalRows = '') => '# 同行评审报告\n\n> **总评分**：' + total + '/30\n\n'
    + '| 维度 | 得分 | 一句话评价 |\n|------|------|-----------|\n'
    + DIMS.map((x, i) => `| ${x} | ${dims[i]}/5 | 好 |`).join('\n')
    + (journalRows ? `\n\n| 目标方向 | 综合匹配度 | 主题契合 | 风格契合 | 审稿周期 | 推荐理由 |\n|---------|-----------|---------|---------|---------|---------|\n${journalRows}\n` : '')
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-6'))
  }
  // ① 总分 27 ≠ 6 维之和 24 → 1 项硬问题 → P1
  writeFileSync(REP, base(27, [4, 4, 4, 4, 4, 4]))
  let it = item()
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P1', '总评分≠分项和应 P1：' + it.detail)
  // ② 3 行期刊匹配度缺百分比 → 3 项硬问题 → P0
  const rows = [
    '| 《管理世界》 |  | 90% | 80% | 3-6 月 | 主题契合 |',
    '| 《中国工业经济》 |  | 85% | 80% | 4-8 月 | 主题契合 |',
    '| 《南开管理评论》 |  | 80% | 85% | 3-6 月 | 主题契合 |',
  ].join('\n')
  writeFileSync(REP, base(24, [4, 4, 4, 4, 4, 4], rows))
  it = item()
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '期刊行缺百分比 ×3 应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

// ── v18.62.7（反哺-主控实测-2026-10-02 §A10/§A15）两条回归钉 ────────────────────────────────
//   · A10：M-Exist-6 的 6 维取分旧版是**整份报告的首个匹配** → 三视角表（表格形态）与整合表并存时
//          取到三视角的 6 维 → 与整合总评分比对 → 判「评分表与总分自相矛盾」**P0**（契约级陷阱，
//          护栏却只是「读文档记住」）。
//   · A15：期刊表表头含「排名」列时，旧版拿**首格**（`🥇 1`）当刊名去查库 → 恒报「未在本库内找到」。
test('A10：三视角 6 维表与整合表并存 → M-Exist-6 必须取整合表（含「总评分」/靠后那张）', () => {
  const { d, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n'
    + '## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] c\n\n## 先行者文献\n\n[先01] p\n\n## AI 使用声明\n\nAI。\n')
  const DIMS = ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范']
  const row = (v) => DIMS.map((x) => `| ${x} | ${v}/5 |`).join('\n')
  // 三视角表在前（全 5）、整合表在后（全 3）；总评分写在**表外**（合法形态：`> **总评分**：18/30`）
  writeFileSync(join(aud, '审稿报告-v2.md'), '# 同行评审报告\n\n## 一、三视角分项\n\n'
    + '| 维度 | T9-d | T9-m | T9-s |\n|---|---|---|---|\n' + row(5) + '\n\n'
    + '## 二、整合评分\n\n> **总评分**：18/30（major）\n\n'
    + '| 维度 | 整合得分 |\n|---|---|\n' + row(3) + '\n'
    + '\n## 给作者的具体修改建议（按优先级）\n\n1. §二 第 2 段：补 [L02] 支撑该论点\n2. §四 第 1 段：收紧因果表述\n')
  const it = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])).results.find((x) => x.gate.startsWith('M-Exist-6'))
  assert.equal(it.pass, true, '必须取整合表的 6 维（6×3=18 = 总评分），不得取三视角的 5 分：' + it.detail)
  assert.match(it.detail, /6 维取自候选表/, 'detail 必须交代取分范围（否则又要靠人读代码）：' + it.detail)
  // 反向钉：整合表若真与总分不一致，仍必须报（证明本修法不是「一律放行」）
  writeFileSync(join(aud, '审稿报告-v2.md'), readFileSync(join(aud, '审稿报告-v2.md'), 'utf8').replace('> **总评分**：18/30（major）', '> **总评分**：24/30（major）'))
  const it2 = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])).results.find((x) => x.gate.startsWith('M-Exist-6'))
  assert.equal(it2.pass, false, '整合表 6 维之和 ≠ 总评分时仍必须报：' + it2.detail)
  assert.match(it2.detail, /自相矛盾/)
  rmSync(d, { recursive: true, force: true })
})

test('A15：期刊表带「排名」列（`🥇 1`）时不得把排名格当刊名（实测复现的软提示源）', () => {
  const { d, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n'
    + '## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] c\n\n## 先行者文献\n\n[先01] p\n\n## AI 使用声明\n\nAI。\n')
  const DIMS = ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范']
  const jRows = [
    '| 🥇 1 | 《社会学研究》 | 90.4% | 100% | 100% | 100% | 90.4% | 期刊数据库 §X 行 N |',
    '| 🥈 2 | 《文艺研究》 | 83.4% | 90% | 90% | 100% | 83.4% | 期刊数据库 §Y 行 M |',
    '| 🥉 3 | 《哲学研究》 | 79.9% | 85% | 85% | 100% | 79.9% | 期刊数据库 §Z 行 K |',
  ].join('\n')
  writeFileSync(join(aud, '审稿报告-v2.md'), '# 同行评审报告\n\n> **总评分**：21/30（minor）\n\n'
    + '| 维度 | 得分 |\n|---|---|\n' + DIMS.map((x) => `| ${x} | 3.5/5 |`).join('\n') + '\n\n'
    + '| 排名 | 期刊 | 综合 | 主题 | 风格 | 范式契合 | 综合匹配度 | 来源 |\n|---|---|---|---|---|---|---|---|\n' + jRows + '\n'
    + '\n## 给作者的具体修改建议（按优先级）\n\n1. §二 第 2 段：补 [L02] 支撑该论点\n2. §四 第 1 段：收紧因果表述\n')
  const it = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])).results.find((x) => x.gate.startsWith('M-Exist-6'))
  assert.ok(!/🥇/.test(it.detail), '排名格（🥇 1）不得被当刊名（旧版据此报「未在本库内找到」）：' + it.detail)
  assert.equal(it.pass, true, '带排名列的合规期刊表应通过：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.3.1 审计 B9：M-Exist-7 缺 1 固定字段 P1 / 缺 5 字段 P0（防降档）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const DD = join(fin, '交付说明.md')
  const SECTIONS = [
    '## 1. 路径\n\n- 定稿：final/定稿.md',
    '## 2. 图件清单\n\n- 图1 | 趋势 | [D01]',
    '## 3. 遗留风险\n\n- 无',
    '## 4. 人工核验项\n\n- 无',
    '## 5. 数据溯源 check-list\n\n- 付费墙文献：无',
    '## 6. 成本指标\n\n- token：~1.2M',
    '## 7. 建议 merge 的反哺清单\n\n- 反哺规则 A → 05 卡',
    '## 8. AI 使用披露（完整版）\n\n- AI 生成段：全文初稿',
    '## 9. 证据包指纹\n\n- sha256：a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4（权威 = final/证据包/manifest.json）',
    '## 10. 投稿就绪检查表\n\n- 推荐期刊：见审稿报告',
    '## 11. 主人决策记录\n\n- 四门：Phase 0 通过｜Phase 2.5 通过｜Phase 3.5 通过｜Phase 5 通过',
    '## 12. 终检结论\n\n- M 门 exit = 0',
  ]
  const joinS = (arr) => arr.join('\n\n') + '\n'
  const item = () => {
    const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
    return parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-7'))
  }
  // ① 缺 1 字段（成本指标）→ P1
  writeFileSync(DD, joinS(SECTIONS.filter((s) => !s.startsWith('## 6.'))))
  let it = item()
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P1', '缺 1 固定字段应 P1：' + it.detail)
  // ② 缺 5 字段 → P0
  writeFileSync(DD, joinS(SECTIONS.filter((s) => !['## 3.', '## 4.', '## 6.', '## 8.', '## 10.'].some((p) => s.startsWith(p)))))
  it = item()
  assert.equal(it.pass, false)
  assert.equal(it.severity, 'P0', '缺 5 固定字段应 P0：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.3.1 审计 B3：m-gate-check --dump-thresholds 输出阈值总表（生成源可跑、无需位置参数）', () => {
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), '--dump-thresholds'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  assert.match(r.out, /THRESHOLDS-AUTO-START/, '应输出生成块起始标记')
  assert.match(r.out, /`mform1MinL` \| 3/, '应含 mform1MinL=3 一行')
  assert.match(r.out, /THRESHOLDS-AUTO-END/, '应输出生成块结束标记')
})


test('A2：M-Form-8 把 [先NN] 计为证据类别——[L]+[先] 段达 2 类，不再判「覆盖 <2 类」', () => {
  const { d, proj, fin, ev } = mkTriFixture()
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), '# 分析大纲\n\n## 承重墙清单\n\n| 承重证据 top1 | 服务于 |\n|---|---|\n| [L01] | 论点1 |\n')
  const it = mform8Of(fin, ev)
  // 甲段（L+先）不得被算作弱段；弱段只剩乙段（仅 [先02]，单类证据）
  assert.match(it.detail, /1 段覆盖 <2 类/, '甲段（[L]+[先]，2 类）不得再判弱段——弱段应只剩乙段：' + it.detail)
  assert.match(it.detail, /0 段缺任意证据/, '[先NN] 属文献族 → 乙段不得落「缺任意证据」P0：' + it.detail)
  assert.match(it.detail, /乙段/, '弱段必须点名到乙段（否则本条断言证明不了是哪段弱）')
  assert.ok(!/甲段.*覆盖 <2 类/.test(it.detail), '甲段不得出现在弱段明细里')
  rmSync(d, { recursive: true, force: true })
})

test('A4：M-Form-10 不再把《机检硬格式》§二 的 [L00]/[L99] 判成「索引悬空」', () => {
  const { d, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n'
    + '## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] c\n\n## 先行者文献\n\n[先01] p\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n## 📇 索引段\n\n'
    + '| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n'
    + '| [L00] | 方法论原始文献 | 论点1 |\n| [L99] | 对立证据 | 论点1 |\n| [L01] | 甲 | 论点1 |\n\n'
    + '## 正文\n\n### [L01] 条目\n信任级别：已发布\n')
  const it = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])).results.find((x) => x.gate.startsWith('M-Form-10'))
  assert.equal(it.pass, true, '索引段独有的 [L00]/[L99] 不得再触发「索引悬空」：' + it.detail)
  assert.ok(!/L00|L99/.test(it.detail), '豁免后 detail 里不应再出现这两个编号：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

// ── v18.62.7（反哺-主控实测-2026-10-02 §A6）：M-Exist-4 的「复核义务」按**修订是否已发生**判 ──────
//   病灶：`修订说明-vN.md` 从初稿 v1 起就存在（T5 每轮都产），旧判据只数「有几份」→ **首轮审计必然**
//   被要求交一份当时不可能存在的 `复核报告-vN.md`（T7 因此补了一份全为「未复核」的形式产物）。
//   新判据：`修订说明-vN` 的 N > 被审正文的 N 才算「逾期」，逾期判硬、未逾期判软提示。
test('A6：M-Exist-4 复核义务——「修订尚未发生」判软（首轮审计）、「修订已发生而无复核」仍判硬', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true, drafts: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01]。\n\n## 参考文献\n\n[L01] x\n\n'
    + '## 数据来源\n\n[D01] d\n\n## 案例来源\n\n[C01] c\n\n## 先行者文献\n\n[先01] p\n\n## AI 使用声明\n\nAI。\n')
  const HEAD = '| 编号 | 严重度 | 改哪里（文件+位置） | 怎么改（具体动作） | 验收标准 | 关闭状态 |\n|---|---|---|---|---|---|\n'
  const ROW = (id) => `| ${id} | P1 | 初稿.md §三第 2 段 | 补 [L01] 支撑该论点 | 该段含 [L01] 且 M-Form-8 通过 | 待复核 |\n`
  const item = () => parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])).results.find((x) => x.gate.startsWith('M-Exist-4'))
  // 场景①：首轮审计审 v2，drafts 里只有 T5 的历史修订说明 v1（**修订尚未发生**）→ 软提示，不得判硬
  writeFileSync(join(aud, '审计报告-v2.md'), `# 审计报告 v2\n\n> **被审正文**：\`drafts/初稿-v2.md\`\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${HEAD}${ROW('P1-1')}`)
  writeFileSync(join(proj, 'drafts', '修订说明-v1.md'), '# 修订说明 v1\n')
  let it = item()
  assert.equal(it.severity, 'P2', '「修订尚未发生」必须降为提示（旧版判硬 → 首轮审计构造性假阳性）：' + it.detail)
  assert.match(it.detail, /尚未到复核时点/, it.detail)
  assert.ok(!/必须落盘/.test(it.detail), '未逾期档不得再要求「必须落盘」：' + it.detail)
  // 场景②：同一份审计报告，但 drafts 出现 v3 修订说明（**修订已发生**）→ 回到硬判（原锋芒保留）
  writeFileSync(join(proj, 'drafts', '修订说明-v3.md'), '# 修订说明 v3\n')
  it = item()
  assert.equal(it.pass, false, '修订已发生而无复核必须判硬')
  assert.equal(it.severity, 'P1', it.detail)
  assert.match(it.detail, /必须落盘/, it.detail)
  // 场景③：审计报告无 `被审正文：` 声明 → 无法判定 → 退回硬判（保守，不放过；存量口径不变）
  rmSync(join(proj, 'drafts', '修订说明-v3.md'), { force: true })
  writeFileSync(join(aud, '审计报告-v2.md'), `# 审计报告 v2\n\n结论：打回修订 ❌\n\n## 修订任务书\n\n${HEAD}${ROW('P1-1')}`)
  it = item()
  assert.equal(it.pass, false, '无法判定审的是哪一版时应保守判硬：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

// ── v18.72.0 反哺「文类档案」批 2：--genre 文类感知 ────────────────────────────
const GENRE_DRAFT = '# 标题\n\n## 摘要\n\n正文仅 1 条文献 [L01]。\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'

test('v18.72.0 --genre：wechat 文献下限 1 → 1 个 [Lxx] 即过；缺省 3 则 P0', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), GENRE_DRAFT)
  const gateOfM1 = (r) => parseJson(r).results.find((x) => x.gate === 'M-Form-1 引用标注完整性')
  // 缺省：min_L=3，1 条 L < 3 → P0
  const base = gateOfM1(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev]))
  assert.equal(base.severity, 'P0', '缺省 3 时 1 条 [Lxx] 应判 P0：' + base.detail)
  // --genre wechat：min_L=1，1 条 L ≥ 1 → 通过
  const gen = gateOfM1(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev, '--genre', 'wechat']))
  assert.equal(gen.pass, true, '--genre wechat 下限 1 时 1 条 [Lxx] 应通过：' + gen.detail)
  rmSync(d, { recursive: true, force: true })
})

test('v18.72.0 --genre：非法 code → exit 10（受控取值，不静默回落 3）', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), GENRE_DRAFT)
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev, '--genre', 'bogus-genre'])
  assert.equal(r.code, 10, '非法 --genre 应 exit 10：' + (r.err || r.out))
  assert.match(r.err || r.out || '', /--genre 非法值/)
  rmSync(d, { recursive: true, force: true })
})

test('v18.72.0 一致性钉：文类档案.md「文献下限」列 == GENRE_MIN_L（防两处漂移）', async () => {
  const { GENRE_MIN_L } = await import(pathToFileURL(join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', '_lib', 'mgate-gates', 'mform-gates.mjs')).href)
  const doc = readFileSync(join(ROOT, 'skills', 'lunheng-article-pipeline', 'references', '_shared', '文类档案.md'), 'utf8')
  const docMap = {}
  for (const line of doc.split('\n')) {
    const m = line.match(/^\|\s*`([a-z0-9-]+)`\s*\|.*\|\s*(\d+)\s*\|$/)
    if (m) docMap[m[1]] = Number(m[2])
  }
  assert.deepEqual(docMap, { ...GENRE_MIN_L }, '文类档案.md 的文献下限列必须与脚本 GENRE_MIN_L 逐项一致')
})

test('v18.78.2 A5：审计报告缺席的两种结论（阶段未到 → SKIP；阶段已到 → P1）', () => {
  // 审计实测的病灶：M-Exist-4/5/6/7/8/9 六处「N/A 未检」分支记 `pass: true, severity: '通过'`，
  //   于是 `rm audits/审计报告-*.md` / `rm final/交付说明.md` 即可把这 6 道**实检**门退回「通过」，
  //   退出码无任何信号（同族 M-Exist-10/11 早已是 `pass: 'SKIP'` → exit 3）。
  // 本用例钉住修法两条：① 阶段未到 → SKIP（未检可见、exit 3）；② 阶段已到 → P1（报告被删/改名/移出）。
  const MIN = '# 标题\n\n## 摘要\n\n正文 [L01]。\n'
  const a = mkProject({ drafts: true })
  writeFileSync(join(a.proj, 'drafts', '初稿-v1.md'), MIN)
  const na = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(a.proj, 'drafts', '初稿-v1.md'), a.ev]))
    .results.find((x) => x.gate.startsWith('M-Exist-4'))
  assert.equal(na.pass, 'SKIP', '阶段未到应记 SKIP（未检 ≠ 通过）而非 pass:true：' + na.detail)
  assert.equal(na.severity, 'SKIP')
  rmSync(a.d, { recursive: true, force: true })

  const b = mkProject({ audits: true })
  writeFileSync(join(b.fin, '定稿.md'), MIN)
  const pa = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(b.fin, '定稿.md'), b.ev]))
    .results.find((x) => x.gate.startsWith('M-Exist-4'))
  assert.equal(pa.pass, false, 'final/定稿.md 在场（Phase 5 已开始）而审计报告缺席必须判 P1：' + pa.detail)
  assert.equal(pa.severity, 'P1')
  assert.match(pa.detail, /阶段已到却/)
  rmSync(b.d, { recursive: true, force: true })
})
