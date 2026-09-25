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

// ── L-61 / L-66：编排脚本不得在**可执行代码**里引用未定义变量 ────────────────────────
test('apply-compression-cycle L-61/L-66：可执行代码无未定义 repoRoot，且 --skip-bundle 真被读取', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(join(SCRIPTS, 'apply-compression-cycle.mjs'), 'utf8')
  // 注释里会**如实记述**这次修正（提到旧版的 `repoRoot`），故只看剥掉注释后的代码。
  const code = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .map((l) => l.replace(/\s\/\/.*$/, ''))
    .join('\n')
  assert.doesNotMatch(code, /\brepoRoot\b/, '可执行代码不得引用未定义变量 repoRoot（旧版必然 ReferenceError → exit 70）')
  assert.match(code, /flags\.has\('--skip-bundle'\)/, '--skip-bundle 必须被真正读取（旧版只在白名单里挂着、无效果）')
  assert.doesNotMatch(code, /writeFileSync|copyFileSync/, '未被调用的导入应已删除')
})
