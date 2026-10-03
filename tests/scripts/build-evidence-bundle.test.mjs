// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 build-evidence-bundle 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/build-evidence-bundle.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('build-evidence-bundle：--deep-summary 蕴含 --summary（旧版单独用是静默空操作）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  // v18.2.6（审计 B-2 修复后的夹具适配）：`build-evidence-bundle` 现在要求**至少复制到一个源**——
  //   `copied === 0 && missing > 0` → exit 10（旧版把「一个源都没有」当成功，正是 fail-open 的形态）。
  //   故夹具除正文外必须给一个真实源；这里给 Phase 0 必然存在的任务简报。
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n主题：夹具。\n')
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--deep-summary'])
  assert.equal(r.code, 0)
  assert.ok(existsSync(join(proj, 'audits', '审计视图-v0.md')), '应生成审计视图（deep 蕴含 summary）')
  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：无定稿时视图源回退到最新草稿（旧版写死 final/定稿.md → T6/T7/T9 在定稿前根本无视图可读）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  writeFileSync(join(proj, 'drafts', '初稿-v1.md'), '# 甲\n\n## 摘要\n\n一稿。\n')
  writeFileSync(join(proj, 'drafts', '初稿-v2.md'), '# 乙\n\n## 摘要\n\n二稿正文 [L01]。\n')
  // v18.2.6（B-2 修复后的夹具适配）：形态标记 drafts/ 已满足；这里再补一个可复制源，
  //   否则触发新规则「copied === 0 && missing > 0 → exit 10」（旧版会判成功）。
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n主题：草稿回退夹具。\n')
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 0)
  const viewPath = join(proj, 'audits', '审计视图-v0.md')
  const view = readFileSync(viewPath, 'utf8')
  assert.match(view, /视图源.*初稿-v2\.md/, '应回退到版本号最高的草稿')
  assert.match(view, /草稿快照/, '必须显式标注草稿快照，防被当定稿字数引用')
  // 定稿出现后必须优先定稿（草稿仍在也不得回退）
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), '# 定\n\n## 摘要\n\n定稿正文。\n')
  run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.match(readFileSync(viewPath, 'utf8'), /视图源.*定稿\.md/, '定稿必须优先于草稿')
  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：尚无正文也要出素材阶段视图；--source 缺失须 fail fast（旧版直接跳过不生成）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'data'), { recursive: true })
  writeFileSync(join(proj, 'data', '数据卡.md'), '# 数据卡\n\n## [D01] 某公报\n信任级别：已发布\n')
  // v18.2.6（B-2 修复后的夹具适配）：形态标记**三者之一**（01-任务简报.md / final/ / drafts/）必须命中，
  //   否则新加的「项目形态校验」直接 exit 10（本夹具此前只有 data/，会红）。补 Phase 0 的简报。
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n主题：素材阶段视图夹具。\n')
  // --source 指向不存在文件：必须 exit 10，且不得先把证据包复制一半（先于成功运行断言，防被前一次的产物干扰）
  // v18.0.2：参数/路径错统一 10（旧断言为 2 —— 与「P0 致命」撞码，已随退出码统一而更新）
  const bad = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary', '--source', 'nope.md'])
  assert.equal(bad.code, 10, '--source 缺失应 exit 10（v18.0.2 起路径/参数错一律 10）')
  assert.ok(!existsSync(join(proj, 'final', '证据包')), '不得先复制证据包再报错（fail fast）')
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 0)
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  assert.match(view, /无正文源/, '无正文时必须显式标注，不得留空结构冒充')
  assert.match(view, /素材卡数量/, '素材段必须在（T4 分析/Phase 2 消费）')
  rmSync(d, { recursive: true, force: true })
})

// v18.7.3 P1-2 回归：信任分布必须走 _lib/trust.mjs 三档口径（旧 A/B/C 正则与 M-Form-6 两张皮，且 C 档混杂「二手转引」）
test('v18.7.3 P1-2：build-evidence-bundle 信任分布 = 三档 + 未声明（与 M-Form-6 同口径，旧 A/B/C 键不再出现）', () => {
  const { d, proj, fin, ev } = mkProject()
  mkdirSync(join(proj, 'literature'), { recursive: true })
  mkdirSync(join(proj, 'data'), { recursive: true })
  writeFileSync(join(proj, 'literature', '文献卡.md'),
    '# 文献卡\n\n## [L01] 甲文献\n信任级别：主人投喂（内部资料）\n\n## [L02] 乙文献\n摘要：网络来源报道。\n')
  writeFileSync(join(proj, 'data', '数据卡.md'),
    '# 数据卡\n\n### [D01] 某统计\n信任级别：**已发布**\n\n### [D02] 另一数据\n摘要：来源待核。\n')
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  assert.match(view, /主人投喂 \/ 二手转引 \/ 已发布 \/ 未声明/, '表头必须是三档 + 未声明：' + view.slice(view.indexOf('素材卡数量'), view.indexOf('素材卡数量') + 400))
  assert.match(view, /\| 文献卡 \[Lxx\] \| 2 \| 1 \/ 0 \/ 0 \/ 1 \|/, 'L 卡：1 条主人投喂 + 1 条未声明')
  assert.match(view, /\| 数据卡 \[Dxx\] \| 2 \| 0 \/ 0 \/ 1 \/ 1 \|/, 'D 卡：1 条已发布（含加粗形态）+ 1 条未声明')
  assert.ok(!/A \/ B \/ C/.test(view), '旧 A/B/C 口径不得残留')
  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：图件随证据包收齐，审计视图给出图件对账（T7/T8 不再看不见图）', () => {
  const d = tmp()
  const proj = mkProj(d)
  writeFileSync(join(proj, 'final', '图件', '图1_趋势.svg'), mkSvg('图一独有'))
  writeFileSync(join(proj, 'final', '图件', '图2_占比.svg'), mkSvg('图二独有'))
  run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.ok(existsSync(join(proj, 'final', '证据包', '图件', '图1_趋势.svg')), '证据包应收图件')
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  assert.match(view, /图件对账/)
  assert.match(view, /正文 \[图N\] 图位：2 个/)
  assert.match(view, /图件文件：2 个/)
  rmSync(join(proj, 'final', '图件', '图2_占比.svg'), { force: true })
  run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.match(readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8'), /缺图/, '缺图必须在视图里显式标出')
  rmSync(d, { recursive: true, force: true })
})

// ===== v2.5.2-dsh.17：交接契约 / 占位符 / 版本化报告 =====

test('build-evidence-bundle：版本化报告取最大版本（旧版硬编码 -v1.md → 修订轮报告不进证据包）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  mkdirSync(join(proj, 'audits'), { recursive: true })
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文 [L01][D01]。\n')
  // 只放 v2（不放 v1）——旧版会全部漏收
  writeFileSync(join(proj, 'analysis', '批判报告-v2.md'), '# 批判报告 v2\n')
  writeFileSync(join(proj, 'audits', '审计报告-v2.md'), '# 审计报告 v2\n')
  writeFileSync(join(proj, 'audits', '复核报告-v2.md'), '# 复核报告 v2\n')
  writeFileSync(join(proj, 'audits', 'G14-检测报告-v2.md'), '# G14 v2\n')
  writeFileSync(join(proj, 'drafts', '修订说明-v2.md'), '# 修订说明 v2\n')
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 0)
  for (const f of ['批判报告-v2.md', '审计报告-v2.md', '复核报告-v2.md', 'G14-检测报告-v2.md', '修订说明-v2.md']) {
    assert.ok(existsSync(join(proj, 'final', '证据包', f)), `证据包应收到 ${f}（取最大版本）`)
  }
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  assert.match(view, /审计报告v2✓/, '视图应显示实际版本号')
  assert.match(view, /G14-检测报告v2✓/, 'G14 报告应被收录并显示')
  // 有多个版本时取最大（不取 v1）
  writeFileSync(join(proj, 'audits', '审计报告-v1.md'), '# 审计报告 v1（旧）\n')
  run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.ok(existsSync(join(proj, 'final', '证据包', '审计报告-v2.md')), '存在 v1 时仍应取 v2')
  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：无修订轮时复核报告标 N/A 而非虚假 ✗（旧版恒定虚假告警）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  // v18.2.6（B-2 修复后的夹具适配）：补一个可复制源，满足「不得 copied === 0」的新规则。
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n主题：复核报告 N/A 夹具。\n')
  run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  const view = readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
  assert.match(view, /复核报告: N\/A\(无修订轮\)/, '无修订轮应标 N/A（不报 ✗）')
  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：非项目目录必须 exit 10 且一个字节都不落（v18.2.6 审计 B-2 修复的回归网）', () => {
  // 旧版（≤ v18.2.5）只校验「路径存在且是目录」，于是**传空目录 / 敲错的路径 / 仓库根**都会 exit 0，
  //   并往参数目录里建 `audits/`、`final/`、`审计视图-v0.md` —— 「对不是项目的目录判成功」
  //   （审计 B-2，P0·fail-open），而且**报错路径自身会污染仓库**。新门槛两条，本用例把两条都钉死：
  //   ① 形态校验（`01-任务简报.md` / `final/` / `drafts/` 之一）必须拦在**任何 mkdir 之前**；
  //   ② 「一个源都没复制到」（copied === 0 && missing > 0）不得再记「跳过(不存在)」后判成功。
  const d = tmp()
  const notAProject = join(d, 'run', 'not-a-project')
  mkdirSync(notAProject, { recursive: true })
  assert.equal(readdirSync(notAProject).length, 0, '前置：该目录必须为空')

  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), notAProject, '--summary'])
  assert.equal(r.code, 10, '非项目目录必须 exit 10（参数/路径错），不得 exit 0')
  assert.match(r.out, /项目形态校验未通过/, '必须明确报「不像论衡项目目录」，而不是静默跳过缺失源')
  assert.equal(readdirSync(notAProject).length, 0, '报错路径上不得创建任何条目（旧版会在这里建 audits/ 与 final/）')
  assert.ok(!existsSync(join(notAProject, 'audits')), '不得创建 audits/')
  assert.ok(!existsSync(join(notAProject, 'final')), '不得创建 final/')

  // 反向（防「一律拒绝」的过严实现）：补上 Phase 0 必然存在的形态标记 01-任务简报.md ——
  //   它同时是可复制源，故形态校验与「一个源都没找到」两条都不再触发。
  writeFileSync(join(notAProject, '01-任务简报.md'), '# 简报\n\n主题：形态校验反向用例。\n')
  const r2 = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), notAProject, '--summary'])
  assert.doesNotMatch(r2.out, /项目形态校验未通过/, '有项目标记后不得再报形态错')
  assert.equal(r2.code, 0, '有项目标记 + 有可复制源时应正常通过（否则是过严实现）')
  rmSync(d, { recursive: true, force: true })
})

test('审计修订 P2：build-evidence-bundle「一个源都没找到」时不得留下自建的空证据包目录', () => {
  // 与上一条的区别：那条走**形态校验**失败（排在 mkdir 之前，一个字节不落）；
  //   本条走**另一条**错误路径——项目骨架合法（有 01-任务简报.md 之外还需一个标记？不：本用例刻意
  //   只放 final/ 目录，使其通过形态校验但没有任何可复制源）→ 旧版会先建出空的 final/证据包/ 再 exit 10。
  const d = tmp()
  const proj = join(d, 'run', 'skeleton')
  mkdirSync(join(proj, 'drafts'), { recursive: true })   // 唯一的形态标记：drafts/
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.equal(r.code, 10, '一个源都没有必须 exit 10：' + r.out.slice(0, 300))
  assert.match(r.out, /一个源都没找到/, '须点名「一个源都没找到」')
  assert.ok(!existsSync(join(proj, 'final', '证据包')),
    '该目录系本次新建且为空，错误路径上必须回收（旧版留下空目录，与「报错不落字节」的承诺不符）')
  assert.match(r.out, /已一并回收/, '回收动作须在 stderr 里可见，不得静默')

  // 对照：目录**原本就在**（非本次创建）→ 不得删除它（绝不删既有目录）
  const proj2 = join(d, 'run', 'skeleton2')
  mkdirSync(join(proj2, 'drafts'), { recursive: true })
  mkdirSync(join(proj2, 'final', '证据包'), { recursive: true })
  writeFileSync(join(proj2, 'final', '证据包', 'user-note.md'), '用户自己的文件\n')
  const r2 = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj2, '--summary'])
  assert.equal(r2.code, 10, '同样 exit 10')
  assert.ok(existsSync(join(proj2, 'final', '证据包', 'user-note.md')), '既有目录与其内容必须原样保留')
  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：多版本报告必须取**最大**版本（清空后断言，v18.0.5 修「假测试」）', () => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  writeFileSync(join(fin, '定稿.md'), DRAFT_OK)
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n子问题 A：x。\n需找数据点 ≥1\n')
  writeFileSync(join(ev, '数据卡.md'), cardOk('数据卡', ['D01']))
  writeFileSync(join(aud, '审计报告-v1.md'), '# 审计报告 v1\n\nG0：通过\n')
  writeFileSync(join(aud, '审计报告-v3.md'), '# 审计报告 v3\n\nG0：通过\n')
  run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--summary'])
  assert.ok(existsSync(join(ev, '审计报告-v3.md')), '应收录 v3（版本取最大）')
  assert.ok(!existsSync(join(ev, '审计报告-v1.md')), '只应收录最大版本；v1 出现即说明排序退化（旧用例的断言可被上次运行残留满足）')
  rmSync(d, { recursive: true, force: true })
})
