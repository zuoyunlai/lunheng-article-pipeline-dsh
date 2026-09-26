// 第七梯队回归（v18.12.0 全量审计 L-63 / L-64 / L-66）
//
// 本文件只覆盖**三处「门写了却永远不会响」的扫描面缺陷**——它们的共同形态是：
//   门存在、判据看着对、测试也「通过」，但**输入永远喂不到判据面前**（分母短路 / 早退跳过 / 变量未定义）。
// 这类缺陷不会在正常用例里变红，只能在**构造出「本该报警」的输入**时暴露，故每个用例都先给出
//   「旧实现会得到什么」的对照断言。
//
//   L-63  cite-coverage-check：装饰性（幽灵引用）比率的分母与扫描面
//   L-64  journal-fit：`--project` 指错路径时的静默放行
//   L-66  exit-guard.describeSpawn：`spawnSync` 未结算时不再输出 `exit null`
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const S = (n) => join(SCRIPTS, n)

// ── 夹具：正文区 + 文末五节（`参考文献` 是 firstEndnoteIndex 的切点）─────────────────────
// `bodyRefs` 只出现在正文区；`listRefs` 只出现在参考文献节 —— 两者的**差集**就是幽灵引用。
const paper = ({ bodyRefs = [], listRefs = [] } = {}) => [
  '# 测试稿',
  '',
  '## 摘要',
  '',
  '这是一段摘要，用来占位。'.repeat(8),
  '',
  '## 一、正文',
  '',
  `正文段落 ${bodyRefs.join(' ')}`,
  '',
  '## 参考文献',
  '',
  ...listRefs.map((r) => `${r} 某作者. 某文献. 2015.`),
  '',
  '## 数据来源',
  '',
  '## 案例来源',
  '',
  '## 先行者文献',
  '',
  '## AI 使用声明',
  '',
  'AI 仅用于文字润色。',
  '',
].join('\n')

const writePaper = (content) => {
  const d = tmp('lunheng-b7-')
  const p = join(d, '定稿.md')
  writeFileSync(p, content, 'utf8')
  return p
}

// ── L-63a：正文零引用 = 全幽灵 ────────────────────────────────────────────────────────
test('cite-coverage L-63：正文零引用（纯幽灵稿）必须判 P1，不得因分母为 0 而短路放行', () => {
  const listRefs = ['[L01]', '[L02]', '[L03]', '[L04]', '[L05]']
  const p = writePaper(paper({ bodyRefs: [], listRefs }))

  const r = run([S('cite-coverage-check.mjs'), p])
  const j = parseJson(r)

  const strength = j.checks['C-Strength']
  // 旧实现：`totalRefs = L_IN_TEXT.size === 0` → `decorativeRatio = 0` → pass=true（最该报警的稿子恰好放行）
  assert.equal(strength.strength['装饰性'].length, 5, '5 条清单引用全部是幽灵引用')
  assert.equal(strength.decorativeRatio, 1, '装饰性比率 = 5/5 = 1.00（旧实现恒为 0）')
  assert.equal(strength.severity, 'P1', '装饰性 100% > 20% → P1')
  assert.equal(strength.pass, false, 'C-Strength 不得通过')
  assert.equal(r.code, 1, '含 P1 → exit 1，实得 ' + r.code + '：' + r.out.slice(0, 200))
})

// ── L-63b：正文引用只计 1 次（旧实现被文末条目「自己」加成 2 次 = 中档）──────────────
test('cite-coverage L-63：正文出现 1 次的引用判「弱」，不被文末条目行加成到「中」', () => {
  const p = writePaper(paper({ bodyRefs: ['[L01]'], listRefs: ['[L01]', '[L02]'] }))

  const r = run([S('cite-coverage-check.mjs'), p])
  const j = parseJson(r)
  const strength = j.checks['C-Strength']

  assert.deepEqual(strength.strength['弱'].map((x) => x.id), ['L01'], '正文 1 次 → 弱档')
  assert.deepEqual(strength.strength['中'], [], '不得出现「中」——文末条目行不是正文引用')
  assert.deepEqual(strength.strength['装饰性'], ['02'], 'L02 只在清单 → 幽灵引用（该数组存的是编号数字）')
  assert.equal(strength.decorativeRatio, 0.5, '1/2 = 0.50')
  assert.equal(strength.severity, 'P1', '50% > 20% → P1')
})

// ── L-63c：红鲱鱼——围栏内的 `## 参考文献` 不得把正文切在它上面 ────────────────────────
test('cite-coverage L-63：围栏内的伪文末节不得截断正文区（引用仍计入正文）', () => {
  const body = [
    '# 测试稿',
    '',
    '## 摘要',
    '',
    '摘要占位。'.repeat(10),
    '',
    '## 一、正文',
    '',
    '正文引用 [L01] [L01] [L01]。',
    '',
    '```md',
    '## 参考文献',
    '',
    '[L09] 这是被围栏包住的示例，不是真文末节',
    '```',
    '',
    '## 参考文献',
    '',
    '[L01] 某作者. 某文献. 2015.',
    '',
  ].join('\n')
  const p = writePaper(body)

  const r = run([S('cite-coverage-check.mjs'), p])
  const j = parseJson(r)
  const strength = j.checks['C-Strength']

  assert.deepEqual(strength.strength['强'].map((x) => x.id), ['L01'], '正文 3 次 → 强档（围栏未截断正文）')
  assert.deepEqual(strength.strength['装饰性'], [], 'L09 是围栏内示例、不在真清单里 → 不算幽灵引用')
})

// ── L-64：`--project` 路径敲错必须响亮失败 ───────────────────────────────────────────
test('journal-fit L-64：--project 指向不存在的项目 → exit 10（旧实现静默跳过全部项目级检查并 exit 0）', () => {
  const d = tmp('lunheng-b7-jf-')
  const missing = join(d, 'run', 'typo')

  const r = run([S('journal-fit.mjs'), '管理世界', '--project', missing])

  assert.equal(r.code, 10, '参数/路径错 → exit 10，实得 ' + r.code + '：' + r.out.slice(0, 300))
  assert.match(r.out, /定稿\.md/, '报错须点名缺失的具体文件')
  assert.doesNotMatch(r.stdout, /"checks"/, '不得输出「无检查项」的成功 JSON')
})

// ── L-64 对照：项目存在时项目级检查确实在跑 ─────────────────────────────────────────
test('journal-fit L-64：项目存在时 J-Format 有实检查项、字数取自定稿（不是空 checks）', () => {
  const d = tmp('lunheng-b7-jf2-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), [
    '# 测试稿',
    '',
    '## 摘要',
    '',
    '摘要。'.repeat(80),
    '',
    '## 一、正文',
    '',
    '正文内容。'.repeat(60),
    '',
    '## 参考文献',
    '',
    '[L01] 某作者. 某文献. 2015.',
    '',
  ].join('\n'), 'utf8')

  const r = run([S('journal-fit.mjs'), '管理世界', '--project', proj])
  const j = parseJson(r)

  assert.ok(j.projectWordCount > 0, '字数应从 final/定稿.md 实测，实得 ' + j.projectWordCount)
  assert.ok(Array.isArray(j.checks['J-Format'].info.checks), 'J-Format 必须带 checks 数组')
  assert.ok(j.checks['J-Format'].info.checks.length > 0, '缺「AI 使用声明」节应被记入 checks，实得空数组（= 项目级检查未跑）')
})

// ── L-66：`spawnSync` 未结算时的口径（端到端：dry-run 全程不联网、不写盘）────────────────
test('exit-guard L-66：describeSpawn 把 status=null / signal 分流，决策 JSON 不再出现 `exit null`', () => {
  // 端到端而非直接 import：`exit-guard.mjs` 是 ESM，Windows 绝对路径不能直接交给 import()
  //   （ERR_UNSUPPORTED_ESM_URL_SCHEME），且**行为契约**比函数签名更值得钉住。
  //   dry-run 分支会让 ccResult/bundleResult 保持 null → 输出 `dry-run`；此处断言的是
  //   「任何分支都不得吐出 `exit null`」这条不变量。
  const d = tmp('lunheng-b7-dry-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n', 'utf8')

  const r = run([S('apply-compression-cycle.mjs'), proj, '--dry-run'])
  assert.equal(r.code, 0, 'dry-run 应 exit 0，实得 ' + r.code + '：' + r.out.slice(0, 300))
  assert.doesNotMatch(r.stdout, /exit null/, '决策 JSON 不得出现 `exit null`（旧实现 status 为 null 时即此形态）')
  assert.doesNotMatch(r.stdout, /exit undefined/, '决策 JSON 不得出现 `exit undefined`')
  assert.match(r.stdout, /"consistencyCheck": "dry-run"/, '口径应为 dry-run')
})

// ── L-61 / L-66：编排脚本的非 dry-run 分支必须真跑通，且 `--skip-bundle` 真被读取 ────────
// v18.18.12（审计 F-5 转行为断言）：原用例断言的是**源码文本**——`doesNotMatch(code, /\brepoRoot\b/)`
//   与 `match(code, /flags\.has\('--skip-bundle'\)/)` 都只看字面，失效方向是**双向**的：
//     · 假绿——把 `--skip-bundle` 的**行为**改回「永远照跑证据包」，只要那句 `flags.has(...)`
//       的字面还在，文本断言照样绿；
//     · 假红——把 `flags` 改名或把该行拆成两行，行为完全不变却会无故变红；
//     · 且 `repoRoot` 那条**扫错了分支**：旧缺陷在**非 dry-run** 分支，而同文件 :174 的用例只跑 dry-run。
//   现改为行为断言（两次真跑，各约 0.5 s）：
//     · `bundle === 'skipped(--skip-bundle)'` 这个取值**只有**非 dry-run 分支读到该开关时才可能产生
//       （`dryRun ? 'dry-run' : (flags.has('--skip-bundle') ? 'skipped(--skip-bundle)' : 'skipped')`）
//       ⇒ 一条断言同时证明「开关被读取」与「证据包确实没被 spawn」；
//     · `consistencyCheck === 'exit 0'` 证明**非 dry-run 分支真的执行到了**——旧版 `repoRoot`
//       未定义必然在此 ReferenceError → exit-guard 归为 exit 70，故它取代了 `/\brepoRoot\b/` 文本扫描；
//     · 第 ② 次去掉开关，`bundle` 必须不再是 `skipped(--skip-bundle)`（证明该开关真的是**开关**）。
//   原第三条 `doesNotMatch(code, /writeFileSync|copyFileSync/)`（「未被调用的导入应已删除」）**已删**：
//   它是纯 lint（无消费者、无行为可破坏），正是审计 F-5 所述「无消费者的删掉或降级」的对象。
test('apply-compression-cycle L-61/L-66：非 dry-run 分支真跑通，且 --skip-bundle 真被读取（行为断言）', () => {
  const d = tmp('lunheng-b7-skipbundle-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n', 'utf8')

  // ① 带开关：证据包必须被跳过
  const withSkip = run([S('apply-compression-cycle.mjs'), proj, '--skip-bundle'])
  assert.notEqual(withSkip.code, 70, '非 dry-run 分支不得因未定义变量 repoRoot 而 exit 70（旧版必然）：' + withSkip.out.slice(0, 300))
  assert.equal(withSkip.code, 0, '未超阻塞线应 exit 0，实得 ' + withSkip.code + '：' + withSkip.out.slice(0, 300))
  const j1 = parseJson(withSkip)
  // 口径：**非 dry-run 分支是否真的执行到了 spawn**（而不是「一致性门是否通过」——那是门 1 的职责）。
  //   故断言「已结算的 spawn 状态」的形状 `exit <N>`，**不**断言等于 `exit 0`：
  //   v18.18.12 实测踩到过——把这里写成 `=== 'exit 0'` 会让本用例随**仓库全仓一致性**变红
  //   （镜像未同步时 `consistency-check` 就是 exit 1），那就把「行为单测」变成了「依赖环境的集成测」，
  //   正是审计 F-5 要消除的那类脆弱。
  assert.match(j1.consistencyCheck, /^exit \d+$/, '非 dry-run 分支必须真的刷新一致性门（= 该分支已执行到底），实得 ' + j1.consistencyCheck)
  assert.equal(j1.bundle, 'skipped(--skip-bundle)', '--skip-bundle 必须被真正读取并跳过证据包，实得 ' + j1.bundle)

  // ② 去掉开关：证据包必须真被 spawn（`skipped(--skip-bundle)` 不再可能出现）
  const noSkip = run([S('apply-compression-cycle.mjs'), proj])
  const j2 = parseJson(noSkip)
  assert.notEqual(j2.bundle, 'skipped(--skip-bundle)', '不带 --skip-bundle 时必须真的尝试刷新证据包，实得 ' + j2.bundle)
})
