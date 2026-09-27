// 图件模板回归网（v18.30.0 EFF-6 新增）
//
// 为什么需要：`references/templates/图表-SVG-template.md` 是 Phase 4.5 配图的**唯一**入口，
//   而它此前是个**会静默失效的模板**——EFF-6 改造前实测：文件里 6 个 `svg` 代码块有 **5 个**
//   过不了 `_lib/svg.mjs` 的结构校验（没有 `<svg>` 根 / 没有 viewBox），照着抄得到的文件会被
//   `md2html` 判 **exit 40**。「模板还能不能用」此前**没有任何门**在看（文档是散文，改坏了没人发现）。
//
// 本文件把三件事钉成机械事实（对应三条用例）：
//   ① **可落盘**：每个 `svg` 代码块必须自身就是一份合格图件（结构 0 problem / 0 warning）；
//   ② **零可见数字**：块内 `<text>` 一个阿拉伯数字都不能有——模板里的数字一旦被照抄就是**编造数据**，
//      且会被 M-Form-9 的「图上数字 ⊆ 数据卡∪正文」抓到（实测见修订记录 §三）；
//   ③ **端到端闭环**：把模板块**真当图件**喂给 M 门 → M-Form-9 必须通过；删一张 → 必须掉级。
//      另加 ④ 断链回归：SKILL.md 的图件链路行必须指向本模板。
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, SCRIPTS, run, tmp } from './_fixtures.mjs'
import { analyzeSvg, svgTextNumbers } from '../skills/lunheng-article-pipeline/scripts/_lib/svg.mjs'

const TPL = join(ROOT, 'skills', 'lunheng-article-pipeline', 'references', 'templates', '图表-SVG-template.md')
const SKILL = join(ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md')
const DOC = readFileSync(TPL, 'utf8')
const BLOCKS = [...DOC.matchAll(/```svg\n([\s\S]*?)```/g)].map((m) => m[1])

test('模板 copy-ready：每个 svg 代码块都能直接落盘（0 problem / 0 warning）', () => {
  // 防空转：抽取退化（正则失效 / 代码块围栏改名）会让下面循环空跑 = 恒绿
  assert.ok(BLOCKS.length >= 4, `模板内可落盘的图型块过少（实测 ${BLOCKS.length}）——抽取退化会让本用例恒真`)
  BLOCKS.forEach((b, i) => {
    const r = analyzeSvg(b)
    assert.equal(r.ok, true, `第 ${i + 1} 块结构不合格（照抄会被 md2html 判 exit 40）：${r.problems.join('；')}`)
    assert.deepEqual(r.warnings, [], `第 ${i + 1} 块有告警（复制到项目里就是 M-Form-9 的 P2）：${r.warnings.join('；')}`)
    assert.ok(r.bytes > 400, `第 ${i + 1} 块只有 ${r.bytes} B —— 不像是完整图件`)
    // ⚠️ 这一问**曾经只能由本测试兜**：`analyzeSvg` 的 `hasWH` 当时是在**全文**里找 `width=` / `height=`，
    //   而图里必然有 `<rect width=… height=…>` → 「根上既无 viewBox 也无宽高」这种真会渲染塌缩的形态
    //   被判 ok=true。**v18.38.0 已把共用校验器本身收成根标签级**（见 `tests/svg-analyze.test.mjs` 的缺陷回归）。
    //   本行**刻意保留**：它测的是**模板**（本文件）而不是校验器——两层各有各的守备面。共享校验器动了之后，
    //   这条断言从「唯一的兜底」变成「模板侧的第二道」。
    const rootTag = b.match(/<svg\b[^>]*>/i)?.[0] || ''
    const rootOk = /viewBox\s*=/i.test(rootTag) || (/\bwidth\s*=/i.test(rootTag) && /\bheight\s*=/i.test(rootTag))
    assert.ok(rootOk, `第 ${i + 1} 块的**根标签**既无 viewBox 也无 width/height → 缩放不可控：${rootTag.slice(0, 90)}`)
  })
})

test('模板零可见数字：`<text>` 里一个阿拉伯数字都没有（照抄不可能编造数据，也不给 M-Form-9 添噪声）', () => {
  // 判据的来历：M-Form-9 会对图上数字（`<text>`/`<tspan>`/`<title>` 文本节点）与数据卡/正文对账，
  //   对不上就记 P2「可能为刻度或坐标，请人工确认」。模板里的数字**必然**对不上（它不属于任何项目），
  //   故「零可见数字」既是**防编造**，也是**防噪声**。坐标（属性值）刻意不受此限——它们不是可见数字。
  BLOCKS.forEach((b, i) => {
    const nums = [...svgTextNumbers(b).keys()]
    assert.deepEqual(nums, [], `第 ${i + 1} 块 <text> 里出现了可见数字 ${nums.join(',')}——模板必须用 【…】 占位`)
  })
})

test('模板契约：每块含「数据来源」行与填空槽位，且代码块数 == §4.x 节数 == §二 图型表行数', () => {
  BLOCKS.forEach((b, i) => {
    assert.match(b, /数据来源/, `第 ${i + 1} 块缺「数据来源」行——图件与数据卡的出处链路断了`)
    const slots = b.match(/【[^】]*】/g) || []
    assert.ok(slots.length >= 6, `第 ${i + 1} 块填空槽位只有 ${slots.length} 个——太少，谈不上「只填数据与文案」`)
  })
  const sections = (DOC.match(/^### 4\.\d+ /gm) || []).length
  assert.equal(sections, BLOCKS.length, `§4.x 节数（${sections}）与可落盘块数（${BLOCKS.length}）不一致——加了图型却没配完整 SVG`)
  // 两张表都要每图型一行：§二「选哪个图型」与 §三「怎么算坐标」。⚠️ 早期写法在全文档上数 `| 4.N `，
  // 两张表叠在一起得 10 行（实测），断言会指向错误的原因——必须**先切节再数**。
  const between = (from, to) => {
    const a = DOC.indexOf(from)
    const b = DOC.indexOf(to, a)
    assert.ok(a >= 0 && b > a, `模板结构变了：找不到「${from}」→「${to}」区间`)
    return DOC.slice(a, b)
  }
  const usageRows = (between('## 二、三步用法', '## 三、').match(/^\| 4\.\d+ /gm) || []).length
  const mapRows = (between('## 三、', '## 四、').match(/^\| 4\.\d+ /gm) || []).length
  assert.equal(usageRows, BLOCKS.length, `§二 图型表行数（${usageRows}）与块数（${BLOCKS.length}）不一致——选了图型也找不到对应块`)
  assert.equal(mapRows, BLOCKS.length, `§三 映射表行数（${mapRows}）与块数（${BLOCKS.length}）不一致——有图型却没有坐标算法`)
})

test('端到端：模板块直接当图件 → M-Form-9 通过；删一张 → 掉级（反向自证）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const figDir = join(fin, '图件')
  mkdirSync(figDir, { recursive: true })
  mkdirSync(join(fin, '证据包'), { recursive: true })
  // 简报在场（且不写图位数）→ M-Form-9 的「图位不足」对账既不误 P0、也不留「对账已跳过」软提示
  writeFileSync(join(proj, '01-任务简报.md'), '# 任务简报\n\n## 图位\n\n- 由正文 [图N] 决定\n')
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n\n[图1：条形试验]\n\n中间段。\n\n[图2：折线试验]\n\n结尾。\n')
  writeFileSync(join(figDir, '图1_条形试验.svg'), BLOCKS[0])
  writeFileSync(join(figDir, '图2_折线试验.svg'), BLOCKS[1])

  const report = join(d, 'm.json')
  const figOf = () => {
    run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), join(fin, '证据包'), '--report', report])
    const j = JSON.parse(readFileSync(report, 'utf8'))
    return (j.results || []).find((x) => x.gate.startsWith('M-Form-9'))
  }

  const ok = figOf()
  assert.ok(ok, '必须有 M-Form-9 结果项')
  assert.equal(ok.pass, true, `模板块当图件必须过 M-Form-9：${ok.detail}`)
  assert.equal(ok.severity, '通过', `不得留任何软提示（模板里的数字/刻度会变成噪声）：${ok.detail}`)

  // 反向自证：删掉一张 → 同一套输入必须掉级（证明上面那条绿不是恒真）
  rmSync(join(figDir, '图2_折线试验.svg'))
  const bad = figOf()
  assert.equal(bad.pass, false, '缺一张图必须报')
  assert.equal(bad.severity, 'P1', `单张缺图应 P1：${bad.detail}`)
  assert.match(bad.detail, /缺图/)
  rmSync(d, { recursive: true, force: true })
})

test('断链回归：SKILL.md 的「图件链路」行必须指向本模板（且要求按节取用，不整读）', () => {
  const line = readFileSync(SKILL, 'utf8')
    .split('\n')
    .find((l) => l.includes('图件链路'))
  assert.ok(line, 'SKILL.md 找不到「图件链路」行——主控就没有配图入口了')
  assert.match(line, /templates\/图表-SVG-template\.md/, '图件链路行必须指向模板文件（否则模板存在也没人用）')
  assert.match(line, /ref-get\.mjs/, '必须写明按节取用（模板 19 KB，整读会抵消 EFF-6 想省的 token）')
  assert.match(line, /M-Form-9/, 'M-Form-9 对账口径不得从该行消失（它是图件链路的验收端）')
})
