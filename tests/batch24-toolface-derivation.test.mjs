// 批 24（反哺清单 §二·5 / §二·6 / §二·7 文档侧 / §二·10）：**工具面派生失真**四条落地钉。
//
// 覆盖（按 `run/xingbie/audits/merge清单-合并版-19条.md` **正文小节号**引用；该清单总表序号与小节号不一致）：
//   · §二·5 审计视图派生失真 —— 字数槽位走正文区口径（与 count-chars 同助手）、卡数与信任分布
//     从**真源逐条读取**、双标单列、卡头手写汇总只对账不采信、超限显著标记；
//   · §二·6 methodology-check 对文本分析型不适用的 SKIP 档（`--genre text-qualitative`）；
//   · §二·7 **[G] 族缺口的文档侧**（三卡模板 + 机检硬格式 + 素材加载清单三类的单列约定；
//     脚本侧 M-Exist-1 归另一名工程师，本文件不碰）；
//   · §二·10 `segment-chars --section` 的唯一前缀匹配 / 歧义报错 / 失败打印全量标题（带行号）。
//
// **夹具只读**：真夹具 `run/<项目>/**` 一律**只读**——用到时先**复制**到 tmp 项目再跑脚本，
//   本文件不写夹具项目一个字节。
// ⚠️ 真夹具路径**不写死**（本仓 `_lib/local-path-scan.mjs` 专扫本机绝对路径）：
//   解析顺序 = `$LUNHENG_FIXTURE_ROOT` → 仓库同级 `run/` 下按「有 final/证据包/数据卡.md」递归探测；
//   找不到 = 环境事实，带理由跳过（同 `tests/batch25-compress-charcount-loop.test.mjs` 的既有口径）。
//
// 运行：node --test tests/batch24-toolface-derivation.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, cpSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SCRIPTS, run, parseJson, tmp, skipWhen } from './_fixtures.mjs'

const S = (n) => join(SCRIPTS, n)
const SKILL = join(SCRIPTS, '..')
const REF = join(SKILL, 'references')

// ── 只读真夹具根（动态解析，见文件头）────────────────────────────────────────────
//   判别特征（三条同时满足，本机 `run/` 下唯一命中本轮被审项目）：证据包数据卡 ① **索引段声明了「总条数」**
//   ② **存在双标信任级别行**（同一行并列两种档位词）+ ③ 证据包文献卡也**声明了「总条数」**。
//   为什么要这么挑：本机 `run/` 下有 30+ 个项目，其中 `gen-ai-academic-integrity` 同样含双标行，
//   但它的文献卡没有条数声明——只按「有双标」挑会选错项目，断言随之漂（首版两轮都栽在这里）。
//   仍可用 `$LUNHENG_FIXTURE_ROOT` 显式锁定；选择结果不满足**夹具签名**时用例会**响亮失败**
//   （而不是换个数字蒙混），提示改用该环境变量。
const FIXTURE = (() => {
  if (process.env.LUNHENG_FIXTURE_ROOT) return process.env.LUNHENG_FIXTURE_ROOT
  const cands = [join(SKILL, '..', '..', '..', 'run'), join(process.cwd(), 'run')]
  const TOTAL = /总条数\*{0,2}[ \t\u3000]*[:：][ \t\u3000]*\*{0,2}[ \t\u3000]*(\d+)/
  const DUAL = /信任级别\*{0,2}[ \t\u3000]*[:：][^\n]*\+\s*\*{0,2}(已发布|主人投喂|二手转引)/
  let best = null
  for (const b of cands) {
    if (!existsSync(b)) continue
    let names = []
    try { names = readdirSync(b) } catch { continue }
    for (const n of names) {
      const dcard = join(b, n, 'final', '证据包', '数据卡.md')
      const lcard = join(b, n, 'final', '证据包', '文献卡.md')
      if (!existsSync(dcard) || !existsSync(lcard)) continue
      let dt = ''
      let lt = ''
      try { dt = readFileSync(dcard, 'utf8'); lt = readFileSync(lcard, 'utf8') } catch { continue }
      const tot = Number((TOTAL.exec(dt) || [])[1] || 0)
      if (!tot || !DUAL.test(dt) || !TOTAL.test(lt)) continue
      if (best === null || tot > best.tot) best = { dir: join(b, n), tot }
    }
  }
  return best ? best.dir : null
})()

/** 造一个最小项目（`01-任务简报.md` 既是形态标记也是可复制源）+ 可选正文/卡片。 */
const mkProj = ({ draft = null, brief = '# 简报\n\n主题：夹具。\n', cards = {} } = {}) => {
  const d = tmp('lunheng-b24-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, '01-任务简报.md'), brief, 'utf8')
  if (draft !== null) writeFileSync(join(proj, 'final', '定稿.md'), draft, 'utf8')
  for (const [rel, content] of Object.entries(cards)) {
    const p = join(proj, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content, 'utf8')
  }
  return { d, proj }
}
const viewOf = (proj) => readFileSync(join(proj, 'audits', '审计视图-v0.md'), 'utf8')
/** 视图里的「素材卡数量」表行（按类型取整行）。 */
const cardRow = (view, label) => (view.split('\n').find((l) => l.startsWith(`| ${label} `)) || '')

// ═══════════════════════════════════════════════════════════════════════════════
// §二·5 —— 审计视图派生失真（build-evidence-bundle.mjs）
// ═══════════════════════════════════════════════════════════════════════════════

test('B24-§5-1【核心夹具】视图派生计数 == 卡内逐条独立行逐类（数据卡 42/13/双标 1；卡数取索引段 56）',
  { skip: skipWhen(!FIXTURE, '真夹具 run/<项目>/final/证据包/数据卡.md 不在本机（CI 不含 run/）——带理由跳过') },
  () => {
    const c = mkProj({ draft: null })
    try {
      // 只读夹具 → **复制**进 tmp 项目（不写夹具一个字节）
      mkdirSync(join(c.proj, 'data'), { recursive: true })
      cpSync(join(FIXTURE, 'final', '证据包', '数据卡.md'), join(c.proj, 'data', '数据卡.md'))
      // 夹具签名自检（防「跑到别的项目上、断言换个数字蒙混」）：本用例的 56/42/13/1 只对被审项目成立。
      const sig = readFileSync(join(c.proj, 'data', '数据卡.md'), 'utf8')
      assert.match(sig, /总条数\*{0,2}\s*[:：]\s*\*{0,2}\s*56/, '夹具签名不符（期望数据卡声明 56 条）——请用 $LUNHENG_FIXTURE_ROOT 指向被审项目')
      const r = run([S('build-evidence-bundle.mjs'), c.proj, '--summary'])
      assert.equal(r.code, 0, `生成视图应 exit 0：${r.out.slice(-500)}`)
      const view = viewOf(c.proj)
      const row = cardRow(view, '数据卡 [Dxx]')
      // ① 卡数 = 卡内**索引段「总条数」声明**（56）——旧实现按全文 `[Dxx]` 编号去重（本夹具恰好也是 56，
      //    故这里同时用文献卡那条钉住「24 vs 22」的判别力，见 B24-§5-2）
      assert.match(row, /\| 数据卡 \[Dxx\] \| 56 \|/, `卡数须取索引段声明 56：${row}`)
      // ② 分布 = **逐条独立行**：已发布 42 / 二手转引 13（旧实现把双标行并入「已发布」得 43）
      assert.match(row, /\| 56 \| 0 \/ 13 \/ 42 \/ 0 \|/, `逐条独立行口径应为 主人投喂0 / 二手13 / 已发布42 / 未声明0：${row}`)
      // ③ 双标单列且点名条目（D22 = 那一行并列写了两档的那条）
      assert.match(row, /双标 1（D22）/, `双标须单列并点名条目：${row}`)
      assert.match(row, /计数口径：索引段「总条数」声明/, `须标出计数真源口径：${row}`)

      // ④ 测试侧**独立**重算一遍：视图行里的四个数必须与卡内逐条独立行逐类相等
      const lines = readFileSync(join(c.proj, 'data', '数据卡.md'), 'utf8').split(/\r?\n/)
      const dist = { 已发布: 0, 二手转引: 0, 主人投喂: 0, 双标: 0 }
      let declared = 0
      for (const line of lines) {
        const m = /^\s*(?:[-*+]\s+)?\*{0,2}信任级别\*{0,2}[ \t\u3000]*[:：][ \t\u3000]*(.*)$/.exec(line)
        if (!m) continue
        declared++
        const toks = [...new Set(m[1].split(/[+＋]/).map((s) => s.trim())
          .map((s) => (/^\*{0,2}[ \t\u3000]*(已发布|主人投喂|二手转引)/.exec(s) || [])[1]).filter(Boolean))]
        if (toks.length === 0) continue
        if (toks.length > 1) { dist.双标++; continue }
        dist[toks[0]]++
      }
      assert.equal(dist.已发布, 42, '夹具自核：逐条独立行应为 42 条已发布')
      assert.equal(dist.二手转引, 13, '夹具自核：逐条独立行应为 13 条二手转引')
      assert.equal(dist.双标, 1, '夹具自核：应有 1 条双标（D22）')
      assert.equal(declared, 56, '夹具自核：应有 56 条独立声明行')
      const cell = `| 0 / ${dist.二手转引} / ${dist.已发布} / ${56 - declared} |`
      assert.ok(row.includes(cell), `视图分布单元格须等于逐条统计 ${cell}：${row}`)
      // ⑤ 卡头手写汇总（本夹具 = 已发布 39 / 二手转引 17）与逐条不一致 → 必须**报出**且不采信
      assert.match(view, /卡头手写汇总与逐条真源不一致（不采信手写值）/, `卡头汇总漂移须在视图内报出：${view.slice(0, 200)}`)
      assert.match(view, /卡头写 已发布 39、二手转引 17/, '须列出卡头手写值')
      assert.match(view, /逐条独立行统计为 已发布 42、二手转引 13/, '须给出逐条真源值（便于逐项对照）')
      assert.match(r.out, /卡头手写汇总与逐条真源不一致/, 'stderr 也须报出（不静的降级）')
    } finally { rmSync(c.d, { recursive: true, force: true }) }
  })

test('B24-§5-2【核心夹具】卡数取索引段声明：文献卡 = 22，**不得**是全文编号去重的 24',
  { skip: skipWhen(!FIXTURE, '真夹具不在本机——带理由跳过') },
  () => {
    const c = mkProj({ draft: null })
    try {
      mkdirSync(join(c.proj, 'literature'), { recursive: true })
      cpSync(join(FIXTURE, 'final', '证据包', '文献卡.md'), join(c.proj, 'literature', '文献卡.md'))
      const r = run([S('build-evidence-bundle.mjs'), c.proj, '--summary'])
      assert.equal(r.code, 0, `生成视图应 exit 0：${r.out.slice(-400)}`)
      const raw = readFileSync(join(c.proj, 'literature', '文献卡.md'), 'utf8')
      // 夹具事实（签名）：全文编号去重 = 24（含索引段的特殊索引 [L00]/[L99]），索引段「总条数」= 22
      const allIds = new Set((raw.match(/\[L\d+\]/g) || []))
      assert.equal(allIds.size, 24, '夹具自核：全文编号去重应为 24（旧实现的失真值）——请用 $LUNHENG_FIXTURE_ROOT 指向被审项目')
      assert.match(raw, /总条数\*\*：22/, '夹具自核：索引段声明应为 22')
      const row = cardRow(viewOf(c.proj), '文献卡 [Lxx]')
      assert.match(row, /\| 文献卡 \[Lxx\] \| 22 \|/, `卡数须取索引段声明的 22：${row}`)
      assert.doesNotMatch(row, /\| 文献卡 \[Lxx\] \| 24 \|/, `不得再用全文编号去重的 24：${row}`)
    } finally { rmSync(c.d, { recursive: true, force: true }) }
  })

test('B24-§5-3【反向】卡头手写汇总与逐条不一致 → 脚本报出不一致，且数值一律取逐条真源', () => {
  // 反向夹具（自造，不依赖真夹具）：卡头写 已发布 5 / 二手转引 0，逐条只有 1 已发布 + 1 二手转引。
  const card = '# 数据卡（Dxx 系列）\n\n## 基本信息\n\n- **总条数**：2\n'
    + '- **信任级别声明**：已发布 5 / 主人投喂 0 / 二手转引 0\n\n## 📇 索引段\n\n> **总条数**：2 条\n\n'
    + '| 编号 | 主题 |\n|---|---|\n| [D01] | 甲 |\n| [D02] | 乙 |\n\n## 列表\n\n'
    + '### [D01] 甲\n- **信任级别**：已发布（官方原文）\n\n'
    + '### [D02] 乙\n- **信任级别**：二手转引（媒体转述）\n'
  const c = mkProj({ cards: { 'data/数据卡.md': card } })
  try {
    const r = run([S('build-evidence-bundle.mjs'), c.proj, '--summary'])
    assert.equal(r.code, 0, `生成视图应 exit 0（漂移是**报告项**，不是 exit 项）：${r.out.slice(-400)}`)
    const view = viewOf(c.proj)
    const row = cardRow(view, '数据卡 [Dxx]')
    // ① 报出不一致（视图 + stderr），两类都点名
    assert.match(view, /卡头手写汇总与逐条真源不一致（不采信手写值）/, '视图须报出卡头漂移')
    assert.match(view, /卡头写 已发布 5、二手转引 0/, `须列出卡头手写值：${view.split('\n').find((l) => l.includes('手写汇总'))}`)
    assert.match(view, /逐条独立行统计为 已发布 1、二手转引 1/, '须给出逐条真源值')
    assert.match(r.out, /已发布 手写 5 ≠ 逐条 1/, 'stderr 须给出「手写 ≠ 逐条」的逐项对照')
    assert.match(r.out, /二手转引 手写 0 ≠ 逐条 1/, 'stderr 须给出「手写 ≠ 逐条」的逐项对照')
    // ② 数值取**逐条真源**（0 / 1 / 1 / 0），绝不取手写的 5/0
    assert.match(row, /\| 数据卡 \[Dxx\] \| 2 \| 0 \/ 1 \/ 1 \/ 0 \|/, `分布须取逐条真源：${row}`)
    assert.doesNotMatch(row, /5 \/ 0 \/ 0 \/ 0/, '不得把卡头手写值填进分布')
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

test('B24-§5-4【核心】字数槽位 = **正文区**口径，与 count-chars.mjs 逐值相等（全文只作对照）', () => {
  const draft = '# 题名\n\n## 摘要\n\n摘要正文甲乙丙。\n\n## 一、导论\n\n' + '汉字'.repeat(50)
    + '\n\n## 参考文献\n\n[L01] 甲\n\n## AI 使用声明\n\nAI 辅助。\n'
  const c = mkProj({ draft })
  try {
    const r = run([S('build-evidence-bundle.mjs'), c.proj, '--summary'])
    assert.equal(r.code, 0, `生成视图应 exit 0：${r.out.slice(-400)}`)
    const body = parseJson(run([S('count-chars.mjs'), join(c.proj, 'final', '定稿.md')]))
    const full = parseJson(run([S('count-chars.mjs'), join(c.proj, 'final', '定稿.md'), '--full']))
    assert.notEqual(body.hanChars, full.hanChars, '夹具前提：正文区值与全文值必须不同（否则本用例退化成恒真）')
    const view = viewOf(c.proj)
    assert.match(view, new RegExp(`## 一、正文结构（正文区 ${body.hanChars} 纯汉字｜全文 ${full.hanChars}`),
      `视图字数槽位必须是正文区口径（与 count-chars 同助手），并附全文对照：${view.split('\n').find((l) => l.startsWith('## 一'))}`)
    assert.match(view, /验收只认正文区值/, '须显式写明验收口径，防再次被当全文引用')
    // 待确认项里的字数行同样必须是正文区值
    assert.match(view, new RegExp(`字数：定稿\\*\\*正文区\\*\\* ${body.hanChars} 汉字（全文 ${full.hanChars}）`), '待确认项的字数行须同口径')
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

// ⚠️ v19.5.0（**主控裁定** · merge 清单 §二.5 的 exit 码分歧，两版实现曾各写一份互斥断言）：
//   甲案 = 口径坍缩 → 写盘后 `exit 10`（理由：视图是 T4–T9 六角色共用入口，它们不读 stderr）；
//   乙案 = **不得改退出码**（理由：刷新证据包这个动作本身不该失败，否则逼出「不刷新视图」的旁路；
//   与本批派单写明的「取不到时不得改退出码」同源）。
//   **裁定取乙案**，并把口径固定为「**降级要可见，但不与「动作失败」同形**」：
//     ① 退出码中性（契约 [0,10,70] 内不新增码）；
//     ② **stderr 响亮报出**，且按「有文末节却相等（真失真）」/「尚未写文末节（合法同值）」**分两档**；
//     ③ 视图槽位**如实保留产线脚本给的实值**（不静默改写、不留空）——两个相等的数本身就是可疑信号，
//        六角色读视图时看得见，无需依赖退出码。
//   ⇒ 本用例改为钉这三条；原「exit 10 + 视图内 ⛔ 标记」的期望作废（记录在此，不静默抹掉）。
test('B24-§5-5【反向】正文区值 === 全文值（口径坍缩）→ **stderr 分级响亮报出 + 槽位如实（exit 0）**', () => {
  // 夹具：无 `## 摘要`、无文末节 → 正文区切片 ≡ 全文（count-chars 对同形态会置 degraded）
  const c = mkProj({ draft: '正文只有一句话。\n' })
  try {
    const r = run([S('build-evidence-bundle.mjs'), c.proj, '--summary'])
    // ① 退出码中性：证据面降级不得与「动作失败」同形。
    assert.equal(r.code, 0, `证据面降级不得改退出码：${r.out.slice(-500)}`)
    // ② 响亮报出：两档之一必须出现在 stderr（本夹具无文末节 → 合法同值档）。
    assert.match(r.out, /字数口径自检失败|合法同值/, '口径坍缩必须响亮报出（分「真失真」/「合法同值」两档）：' + r.out.slice(0, 600))
    assert.match(r.out, /尚未写文末节|切片没有真正收窄/, '报出须点明形态与成因')
    // ③ 槽位如实：保留产线脚本给的实值，供六角色在视图里看出「两值相等」。
    const view = viewOf(c.proj)
    assert.match(view, /## 一、正文结构（正文区 \d+ 纯汉字｜全文 \d+/, `槽位须如实保留产线脚本给的值（不得静默改写或留空）：${view.split('\n').find((l) => l.startsWith('## 一'))}`)
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

test('B24-§5-6 正文区 > 目标上限 × 1.2 → 视图内**显著标记**超限（目标取自任务简报）', () => {
  const draft = '# 题名\n\n## 摘要\n\n' + '汉'.repeat(1300) + '\n\n## 参考文献\n\n[L01] 甲\n'
  const c = mkProj({ draft, brief: '- **目标篇幅**：**1000 汉字**\n' })
  try {
    const r = run([S('build-evidence-bundle.mjs'), c.proj, '--summary'])
    assert.equal(r.code, 0, `超限是标记项、不是 exit 项：${r.out.slice(-400)}`)
    const view = viewOf(c.proj)
    assert.match(view, /超限（显著标记）/, '视图须打显著标记')
    assert.match(view, new RegExp(`正文区 1300 汉字 > 任务简报目标上限 1000 × 1.2 = 1200`), `须给出可复算的算式：${view.split('\n').find((l) => l.includes('超限'))}`)
    assert.match(r.out, /目标上限 1000 × 1.2 = 1200/, 'stderr 亦须可见')
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

// ═══════════════════════════════════════════════════════════════════════════════
// §二·6 —— methodology-check 的文本分析型 SKIP 档（脚本侧实现与另一名工程师同批；
//          本组用例是**独立验收**：钉住口径与出口，防实现漂移/回退）
// ═══════════════════════════════════════════════════════════════════════════════

test('B24-§6-1【核心夹具】--genre text-qualitative 不得 exit 2；两项记 SKIP + N/A 注明',
  { skip: skipWhen(!FIXTURE, '真夹具 run/<项目>/final/定稿.md 不在本机——带理由跳过') },
  () => {
    const draft = join(FIXTURE, 'final', '定稿.md')
    if (!existsSync(draft)) { assert.ok(true, '夹具定稿缺失，跳过'); return }
    const rep = join(tmp('lunheng-b24-mc-'), 'tq.json')
    const r = run([S('methodology-check.mjs'), draft, '--genre', 'text-qualitative', '--report', rep])
    assert.notEqual(r.code, 2, `文本分析型不得因体裁不适用报 P0（exit 2）：${r.out.slice(-400)}`)
    assert.equal(r.code, 3, '未检 ≠ 通过：本档须落到 exit 3（需人工复核）')
    const j = JSON.parse(readFileSync(rep, 'utf8'))
    for (const k of ['M-Form-12', 'M-Exist-11']) {
      assert.equal(j.checks[k].severity, 'SKIP', `${k} 须记 SKIP（不是 P0/P1，也不是 PASS）`)
      assert.notEqual(j.checks[k].pass, true, `${k} 的 SKIP 不得写成 pass: true（未检 ≠ 通过）`)
      assert.match(String(j.checks[k].note), /不适用/, `${k} 的 note 须写明「本门不适用于文本分析型论文」`)
      assert.match(String(j.checks[k].note), /人工复核/, `${k} 的 note 须写明「请人工核验」及该谁核`)
    }
    assert.equal(j.overall.exitCode, 3, 'JSON 出口须与进程退出码一致')
  })

test('B24-§6-2【反向】--genre empirical-stat 仍须报出缺参项；不传 --genre 与旧口径逐值一致',
  { skip: skipWhen(!FIXTURE, '真夹具不在本机——带理由跳过') },
  () => {
    const draft = join(FIXTURE, 'final', '定稿.md')
    if (!existsSync(draft)) { assert.ok(true, '夹具定稿缺失，跳过'); return }
    const d = tmp('lunheng-b24-mc2-')
    try {
      const es = join(d, 'es.json')
      const base = join(d, 'base.json')
      const rEs = run([S('methodology-check.mjs'), draft, '--genre', 'empirical-stat', '--report', es])
      const rBase = run([S('methodology-check.mjs'), draft, '--report', base])
      const jEs = JSON.parse(readFileSync(es, 'utf8'))
      const jBase = JSON.parse(readFileSync(base, 'utf8'))
      assert.equal(rEs.code, 2, `实证口径下缺参项仍须报 P0：${rEs.out.slice(-300)}`)
      assert.ok(jEs.checks['M-Form-12'].missing.length > 0, '实证口径须点名缺哪些参数（不得静默豁免）')
      assert.equal(jEs.checks['M-Form-12'].severity, 'P0', '方法节参数 1/4 → P0（旧口径不变）')
      assert.equal(jEs.checks['M-Exist-11'].severity, 'P1', '统计-数据匹配缺项 → P1（旧口径不变）')
      // 向后兼容：不传 --genre 时与 empirical-stat 完全同形（同一份 JSON，除时间戳/文件路径外逐值相等）
      assert.equal(rBase.code, rEs.code, '不传 --genre 必须与旧口径同出口')
      assert.deepEqual(jBase.checks, jEs.checks, '不传 --genre 时三项检查结果须与 empirical-stat 逐值一致')
    } finally { rmSync(d, { recursive: true, force: true }) }
  })

// ═══════════════════════════════════════════════════════════════════════════════
// §二·10 —— segment-chars --section：唯一前缀 / 歧义 / 未命中
// ═══════════════════════════════════════════════════════════════════════════════

const mkMd = (name, content) => {
  const d = mkdtempSync(join(tmpdir(), 'lunheng-b24-sc-'))
  const p = join(d, name)
  writeFileSync(p, content, 'utf8')
  return { d, p }
}

test('B24-§10-1【核心】唯一前缀命中成功（"2 文献回顾" → "2 文献回顾与研究缺口"）', () => {
  const f = mkMd('x.md', '## 2 文献回顾与研究缺口\n乙段内容。\n\n## 3 方法\n丙段。\n')
  try {
    const r = run([S('segment-chars.mjs'), f.p, '--section', '2 文献回顾'])
    assert.equal(r.code, 0, `唯一前缀命中应 exit 0：${r.out.slice(-300)}`)
    const j = parseJson(r)
    assert.equal(j.sections.length, 1)
    assert.equal(j.sections[0].title, '2 文献回顾与研究缺口', '回显的实际标题须是命中的那一条')
    // 唯一**严格**命中同样成功（`--section "2"` 只有一条标题以「2」+分隔符开头时）
    const r2 = run([S('segment-chars.mjs'), f.p, '--section', '2'])
    assert.equal(r2.code, 0, `唯一严格命中应 exit 0：${r2.out.slice(-300)}`)
    assert.equal(parseJson(r2).sections[0].title, '2 文献回顾与研究缺口')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('B24-§10-2【反向】歧义必须报错并列出候选（严格档多命中亦算歧义）', () => {
  const f = mkMd('x.md', '## 2 文献回顾\n甲段。\n\n## 2.1 极化\n乙段。\n\n## 3 方法\n丙段。\n')
  try {
    const r = run([S('segment-chars.mjs'), f.p, '--section', '2'])
    assert.equal(r.code, 10, `歧义必须 exit 10（不得静默取首个）：${r.out.slice(-300)}`)
    assert.match(r.out, /选择器有歧义（命中 2 条标题）: 2/, '须报歧义并给出命中条数')
    assert.match(r.out, /候选 1: ## 2 文献回顾/, '须逐条列候选（带行号）')
    assert.match(r.out, /候选 4: ## 2\.1 极化/, '须逐条列候选（带行号）')
    // 前缀档歧义（严格档全落空）：同一条判据
    const g = mkMd('y.md', '## 甲节研究\n甲。\n\n## 甲节分析\n乙。\n')
    try {
      const r2 = run([S('segment-chars.mjs'), g.p, '--section', '甲节'])
      assert.equal(r2.code, 10, '前缀档多条命中同样是歧义')
      assert.match(r2.out, /命中 2 条标题/)
    } finally { rmSync(g.d, { recursive: true, force: true }) }
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('B24-§10-3 未命中：直接打印**全部**可用标题（带行号），不再截断到前 40 个', () => {
  const many = Array.from({ length: 45 }, (_, i) => `## ${i + 1} 第${i + 1}节\n正文。\n`).join('\n')
  const f = mkMd('many.md', many)
  try {
    const r = run([S('segment-chars.mjs'), f.p, '--section', '不存在的节'])
    assert.equal(r.code, 10)
    assert.match(r.out, /以下选择器未命中任何标题: 不存在的节/)
    assert.match(r.out, /可用标题（带行号，格式「行号: level 标题」）：/, '须声明清单形态与行号')
    assert.match(r.out, /^ {2}1: ## 1 第1节$/m, '须带行号（1-based）')
    assert.match(r.out, /^ {2}133: ## 45 第45节$/m, '须给**全量**（第 45 条也在；旧版只给前 40 个）')
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

// ═══════════════════════════════════════════════════════════════════════════════
// §二·7 —— [G] 族缺口的**文档侧**约定（模板 + 机检硬格式 + 加载清单）
// ═══════════════════════════════════════════════════════════════════════════════

test('B24-§7-1 三卡模板 + 机检硬格式：缺口编号单列一节、不计入「总条数」的约定必须在场', () => {
  const hard = readFileSync(join(REF, '_shared', '机检硬格式.md'), 'utf8')
  assert.match(hard, /## 十一、缺口登记（`\[Gnn\]`）单列/, '机检硬格式须有缺口登记的独立小节（约定真源）')
  assert.match(hard, /缺口条目只要求「正文引用 ⊆ 缺口集」/, '须写明缺口条目的机检口径')
  assert.match(hard, /缺口编号（`\[Gnn\]`）/, '§一 通用表须有缺口编号一行（供三卡模板指针可达）')
  for (const f of ['文献卡-template-lite.md', '数据卡-template-lite.md', '案例卡-template-lite.md']) {
    const t = readFileSync(join(REF, 'templates', f), 'utf8')
    assert.match(t, /\[Gnn\]/, `${f} 须写明缺口编号 [Gnn] 单列`)
    assert.match(t, /不计入「总条数」/, `${f} 须写明缺口不计入总条数`)
    assert.match(t, /机检硬格式\.md/, `${f} 须指向机检硬格式（单一真源，不复述）`)
  }
  const dk = readFileSync(join(REF, 'templates', '数据卡-template-lite.md'), 'utf8')
  assert.match(dk, /## 缺口清单（🔴 单列，不计条）/, '数据卡模板须给出卡内缺口单列的既有形态')
  assert.match(dk, /卡头汇总行纪律/, '数据卡模板须有卡头汇总行纪律（禁手写）')
  assert.match(dk, /分类计数/, '数据卡自检须升级为分类计数（旧自检只核行数）')
})

test('B24-§7-2 素材加载清单模板：来源 / 缺口 / 卡片索引三类区分必须在场（缺口不进加载率分母）', () => {
  const t = readFileSync(join(REF, 'templates', '素材加载清单-template.md'), 'utf8')
  assert.match(t, /三类编号区分/, '须有「三类编号区分」段')
  assert.match(t, /\| ① 来源条目 \| `\[Lxx\]` \/ `\[Dxx\]` \/ `\[Cxx\]` \| \*\*计入\*\*/, '① 来源条目须计入')
  assert.match(t, /② 缺口条目/, '② 缺口条目须单列')
  assert.match(t, /③ 卡片索引/, '③ 卡片索引须单列')
  assert.match(t, /分母 = 各卡索引段编号数/, '须写明分母口径')
})
