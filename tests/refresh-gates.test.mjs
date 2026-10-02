// refresh-gates.mjs 回归测试（v18.62.4 新增 · 全量审计-v18.62.3 P1-8 + P2-6）
//
// **为什么必须有这一组**：`refresh-gates.mjs` 与 `fix-gates.mjs` 此前是**唯二零测试的随包脚本**
//   （`grep -l refresh-gates tests/**` 零命中），而 `refresh-gates` 会**改写终检交付件**
//   （闸门记录 ×2 + 交付说明）——**最需要回归的地方恰好没有回归**。本文件按 P1-8 的修复点写死四类判据。
//
// 判据（每条都对应一个**已实测的失败形态**或必须守住的边界）：
//   ① dry-run 绝不写盘；
//   ② 无可刷新项 → exit 0 且不写盘（不是错误）；
//   ③ **逐文件条目指纹不得被改写**（P1-8 病灶：旧模式 `sha256:<hex>` 会把 `final/证据包/manifest.json`
//      的逐文件 sha256 静默换成正文指纹）；
//   ④ 说明行（含「旧版写法」等）不得被当成正文指纹替换（行内语境守卫）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { SCRIPTS, tmp } from './_fixtures.mjs'

const SCRIPT = join(SCRIPTS, 'refresh-gates.mjs')
const H = (s) => createHash('sha256').update(s).digest('hex').repeat(1)
/** 64 位 hex 常量（不需要真实对应任何文件，只用于「不该被改」的断言） */
const OTHER = 'a'.repeat(64)
const OTHER2 = 'b'.repeat(64)

/** 跑 refresh-gates：返回 { code, out }。非 0 退出不抛（exit 1 = 已刷新，是本脚本的**正常**语义）。 */
function run(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    return { code: e.status ?? -1, out: String(e.stdout || '') + String(e.stderr || '') }
  }
}

/** 造项目夹具：`final/定稿.md` + 两份闸门记录 + 交付说明。 */
function mkProject({ gateRecords = true, deliver = true, deliverBody = '' } = {}) {
  const d = tmp('rf-')
  mkdirSync(join(d, 'final'), { recursive: true })
  mkdirSync(join(d, 'audits'), { recursive: true })
  const draft = '# 标题\n\n## 摘要\n\n正文内容。\n'
  writeFileSync(join(d, 'final', '定稿.md'), draft)
  const sha = createHash('sha256').update(draft).digest('hex')
  if (gateRecords) {
    // 含「正文 sha256」+ 一个**已过期的**旧值；另含 draft_sha256 形态
    writeFileSync(join(d, 'audits', '闸门记录-T2.5.md'),
      `# 闸门记录\n\n| 检查项 | 实据 | 结论 | 失败原因 |\n|---|---|---|---|\n`
      + `| **本阶段正文 sha256** | \`${OTHER}\` | ✓ |  |\n`
      + `| draft_sha256 形态 | draft_sha256=\`${OTHER2}\` | ✓ |  |\n`)
    writeFileSync(join(d, 'audits', '闸门记录-T7.5.md'), `# 闸门记录\n\n| 检查项 | 实据 | 结论 | 失败原因 |\n|---|---|---|---|\n| **本阶段正文 sha256** | \`${OTHER}\` | ✓ |  |\n`)
  }
  if (deliver) {
    writeFileSync(join(d, 'final', '交付说明.md'),
      `# 交付说明\n\n## 9. 证据包指纹\n\n`
      + `- **被审正文（定稿）sha256**：sha256：\`${OTHER}\`（与 M-Gate-Report.json 的 verdict_scope 对账）\n`
      + `- **逐文件条目指纹**：sha256: \`${OTHER2}\`（final/证据包/数据卡.md，权威 = manifest.json）\n`
      + `- 说明：旧版写法无标注的 \`sha256: ${'c'.repeat(64)}\` 不应被本工具刷新\n`
      + deliverBody)
  }
  return { d, sha }
}

test('refresh-gates：`--dry-run` 绝不写盘（三个目标原样保留）', () => {
  const { d } = mkProject()
  const before = readFileSync(join(d, 'audits', '闸门记录-T2.5.md'), 'utf8')
  const beforeD = readFileSync(join(d, 'final', '交付说明.md'), 'utf8')
  const r = run([d, '--dry-run', '--json'])
  assert.equal(r.code, 0, 'dry-run 应 exit 0：' + r.out.slice(0, 300))
  const j = JSON.parse(r.out.slice(r.out.indexOf('{')))
  assert.equal(j.dryRun, true)
  assert.ok(j.replaced > 0, '夹具含过期旧值 → 应报出待替换数：' + JSON.stringify(j.results))
  assert.equal(readFileSync(join(d, 'audits', '闸门记录-T2.5.md'), 'utf8'), before, 'dry-run 不得改闸门记录')
  assert.equal(readFileSync(join(d, 'final', '交付说明.md'), 'utf8'), beforeD, 'dry-run 不得改交付说明')
  rmSync(d, { recursive: true, force: true })
})

test('refresh-gates：无可刷新项 → exit 0 且不写盘（非错误）', () => {
  const { d, sha } = mkProject({ gateRecords: false, deliver: false })
  const r = run([d, '--json'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  const j = JSON.parse(r.out.slice(r.out.indexOf('{')))
  assert.equal(j.replaced, 0)
  assert.ok(j.results.every((x) => x.status === 'skip' || x.status === 'ok'), JSON.stringify(j.results))
  rmSync(d, { recursive: true, force: true })
})

test('P1-8 核心：**逐文件条目指纹不得被改写**（旧模式 `sha256:<hex>` 会误伤）', () => {
  const { d, sha } = mkProject()
  const r = run([d, '--json'])
  assert.equal(r.code, 1, '有替换 → exit 1（本脚本语义）：' + r.out.slice(0, 300))
  const t25 = readFileSync(join(d, 'audits', '闸门记录-T2.5.md'), 'utf8')
  const t75 = readFileSync(join(d, 'audits', '闸门记录-T7.5.md'), 'utf8')
  const del = readFileSync(join(d, 'final', '交付说明.md'), 'utf8')
  // ① 正文指纹：两处闸门记录 + 交付说明的「被审正文」行都刷新为新值
  assert.ok(t25.includes(sha), 'T2.5 的正文指纹应被刷新')
  assert.ok(t75.includes(sha), 'T7.5 的正文指纹应被刷新')
  assert.ok(del.includes(sha), '交付说明的正文指纹应被刷新')
  // ② `draft_sha256=` 形态**就是正文指纹**（M-Gate-Report 里同名字段 = 被审正文的 sha256），
  //    故它**应被刷新**——本仓的字段命名没有歧义：`draft_sha256` == 正文指纹。
  //    （本用例第一版把这条写成「不得被改」，被实测纠正：把「另一处指纹」与「同一指纹的另一种写法」
  //      混为一谈。真正的区分判据是**语义**（是不是指向被审正文），不是**拼写**。）
  assert.ok(t25.includes(sha), 'draft_sha256= 形态应被刷新为新正文指纹')
  assert.ok(!t25.includes(OTHER2), '旧值应已消失（被刷新，而非原样保留）')
  // ③ **逐文件条目指纹必须原样保留**（这是 P1-8 的判据本体）
  assert.ok(del.includes(OTHER2), '**逐文件条目指纹被改写了**——正是 P1-8 要防的静默污染：' + del)
  // ③ 说明行（无正文标注）不得被替换
  assert.ok(del.includes('c'.repeat(64)), '无正文标注的说明行不得被替换')
  rmSync(d, { recursive: true, force: true })
})

test('P1-8 边界：交付说明里**只有逐文件指纹**时，不得改写任何东西且不写盘', () => {
  const d = tmp('rf-')
  mkdirSync(join(d, 'final'), { recursive: true })
  writeFileSync(join(d, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文内容。\n')
  const only = `# 交付说明\n\n## 9. 证据包指纹\n\n- 逐文件：sha256: \`${OTHER2}\`（final/证据包/数据卡.md）\n`
  writeFileSync(join(d, 'final', '交付说明.md'), only)
  const r = run([d, '--json'])
  assert.equal(r.code, 0, '无正文指纹可刷 → exit 0：' + r.out.slice(0, 300))
  assert.equal(readFileSync(join(d, 'final', '交付说明.md'), 'utf8'), only, '只有逐文件指纹时不得写盘')
  rmSync(d, { recursive: true, force: true })
})

test('P1-8 反向自证：**去掉语境守卫**时，旧的裸模式确实会改写逐文件指纹（证明本用例不是空转）', () => {
  // 为什么要有这条：上面那条「逐文件指纹不得被改写」的断言，只有在**门真的有被突破的可能**时才有意义。
  //   实测发现：真正挡住误伤的是**行内语境守卫**（`正文|定稿|被审|draft_sha256`），而**不是**模式收窄
  //   —— 逐文件行里没有这些词，所以即便把模式放回旧的裸 `sha256[:：]<hex>`，它也不会被收进 olds。
  //   故本用例在**内存里**重演「旧实现 = 无语境守卫」的匹配逻辑，断言它**确实**会把逐文件指纹收进待替换集合。
  //   （不在磁盘上回归任何代码：这是对「旧实现会误伤」这一命题的直接复现。）
  const { d } = mkProject()
  const del = readFileSync(join(d, 'final', '交付说明.md'), 'utf8')
  // 旧实现：`text.matchAll(/sha256[:：]\s*`?([0-9a-f]{64})`?/g)` —— 无按行、无语境守卫
  const oldHits = new Set([...del.matchAll(/sha256[:：]\s*`?([0-9a-f]{64})`?/g)].map((m) => m[1]))
  assert.ok(
    oldHits.has(OTHER2),
    '旧实现的裸模式应把**逐文件条目指纹**收进待替换集合（否则本夹具证明不了 P1-8 的病灶）',
  )
  assert.ok(oldHits.has('c'.repeat(64)), '旧实现也会收进无标注说明行里的 hex')
  // 新实现：按行 + 语境守卫 → 逐文件行与说明行都**不进**
  const CONTEXT_RE = /正文|定稿|被审|draft_sha256/
  const newHits = new Set()
  for (const line of del.split('\n')) {
    if (!CONTEXT_RE.test(line)) continue
    for (const m of line.matchAll(/(?:被审正文|正文|定稿)[^\n]*?sha256[:：]\s*`?([0-9a-f]{64})`?/g)) newHits.add(m[1])
  }
  assert.ok(!newHits.has(OTHER2), '新实现不得收进逐文件条目指纹')
  assert.ok(!newHits.has('c'.repeat(64)), '新实现不得收进无标注说明行')
  assert.equal(newHits.size, 1, '新实现应恰好收进 1 个正文指纹：' + JSON.stringify([...newHits]))
  rmSync(d, { recursive: true, force: true })
})

test('refresh-gates：参数/路径错 → exit 10（与 0=无需刷新、1=已刷新 区分）', () => {
  assert.equal(run([]).code, 10, '缺项目目录参数 → 10')
  assert.equal(run(['definitely-not-a-dir-xyz']).code, 10, '目录不存在 → 10')
  assert.equal(run([tmp('rf-'), '--unknown-flag']).code, 10, '未知参数 → 10')
})

test('fix-gates：零写盘形态——输出建议但不改任何文件（P2-6 补面）', () => {
  const SCRIPT_FIX = join(SCRIPTS, 'fix-gates.mjs')
  const d = tmp('fg-')
  mkdirSync(join(d, 'final'), { recursive: true })
  const draft = '# 标题\n\n## 摘要\n\n正文。\n'
  writeFileSync(join(d, 'final', '定稿.md'), draft)
  const before = readFileSync(join(d, 'final', '定稿.md'), 'utf8')
  let code, out
  try {
    out = execFileSync(process.execPath, [SCRIPT_FIX, d], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    code = 0
  } catch (e) {
    code = e.status ?? -1
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  assert.ok([0, 1].includes(code), 'fix-gates 的契约是 0=无可修项 / 1=有建议 / 10=参数错，实得 ' + code + '：' + out.slice(0, 300))
  assert.equal(readFileSync(join(d, 'final', '定稿.md'), 'utf8'), before, 'fix-gates 必须**零写盘**（它只输出可粘贴的修法）')
  rmSync(d, { recursive: true, force: true })
})

// ── v18.62.7（反哺-主控实测-2026-10-02 §A1）：**静默漏判**的三条回归钉 ──────────────────────
//   病灶（实测受控对照，同一份文件只改写法）：
//     实据 = `正文 sha256 <hex>`      → `would-replace ×2`（正常）
//     实据 = `` `final/定稿.md` sha256 `<hex>` `` → `ok（无可刷新项）`（**静默漏判**）
//   根因：模式的 `[^`\n]*` 不允许跨反引号，而闸门记录的实据列**恰恰鼓励写带反引号的路径**。
//   本组三条：① 真实形态必须被识别；② 「标签在、指纹抓不到」不得再报 ok；③ 替换只动指纹、不动标签。

/** 造一个「实据列 = 带反引号路径 + sha256 标签 + 旧指纹」的 T7.5 记录。 */
function mkBacktickProject(hexOrNull) {
  const d = tmp('rf-bt-')
  mkdirSync(join(d, 'final'), { recursive: true })
  mkdirSync(join(d, 'audits'), { recursive: true })
  const draft = '# 标题\n\n## 摘要\n\n正文内容。\n'
  writeFileSync(join(d, 'final', '定稿.md'), draft)
  const sha = createHash('sha256').update(draft).digest('hex')
  const cell = hexOrNull ? `\`final/定稿.md\` sha256 \`${hexOrNull}\`` : '`final/定稿.md` sha256（未回填）'
  writeFileSync(join(d, 'audits', '闸门记录-T7.5.md'),
    `# 闸门记录\n\n| 检查项 | 实据 | 结论 | 失败原因 |\n|---|---|---|---|\n| **本阶段正文 sha256** | ${cell} | ✓ |  |\n`)
  return { d, sha }
}

test('A1：实据写成「`路径` sha256 `<hex>`」必须被识别（旧模式在第一个反引号处截断 → 静默漏判）', () => {
  const { d } = mkBacktickProject(OTHER)
  const r = run([d, '--dry-run', '--json'])
  assert.equal(r.code, 0, 'dry-run 应 exit 0：' + r.out.slice(0, 300))
  const j = JSON.parse(r.out.slice(r.out.indexOf('{')))
  const t75 = j.results.find((x) => x.file === 'audits/闸门记录-T7.5.md')
  assert.equal(t75.status, 'would-replace', '带反引号路径的实据必须被识别（这正是 A1 的判据本体）：' + JSON.stringify(t75))
  assert.equal(j.replaced, 1, '应恰好抓到一个旧指纹：' + JSON.stringify(j.results))
  rmSync(d, { recursive: true, force: true })
})

test('A1：**替换只动 64 位指纹本身，不改写标签与路径**（放宽模式后的必备回归）', () => {
  const { d, sha } = mkBacktickProject(OTHER)
  const r = run([d, '--json'])          // 非 dry-run：真写盘
  assert.equal(r.code, 1, '有替换 → exit 1（本脚本语义）：' + r.out.slice(0, 300))
  const t75 = readFileSync(join(d, 'audits', '闸门记录-T7.5.md'), 'utf8')
  assert.ok(t75.includes(sha), '指纹应被刷新为当前正文值')
  assert.ok(!t75.includes(OTHER), '旧指纹应已消失')
  assert.ok(t75.includes('本阶段正文 sha256'), '**检查项单元格的标签文本不得被改写**：' + t75)
  assert.ok(t75.includes('`final/定稿.md` sha256'), '**实据里的路径与标签也不得被改写**：' + t75)
  rmSync(d, { recursive: true, force: true })
})

test('A1：**有标签却解析不出指纹** → 报 warn（不得再报 ok），exit 0 且不写盘', () => {
  const { d } = mkBacktickProject(null)   // 有标签、无指纹
  const before = readFileSync(join(d, 'audits', '闸门记录-T7.5.md'), 'utf8')
  const r = run([d, '--json'])
  assert.equal(r.code, 0, '未发生替换 → exit 0（本批不新增退出码，见脚本头 :21-32 的契约约束）')
  const j = JSON.parse(r.out.slice(r.out.indexOf('{')))
  const t75 = j.results.find((x) => x.file === 'audits/闸门记录-T7.5.md')
  assert.equal(t75.status, 'warn', '「标签在、指纹抓不到」必须与「无可刷新项」区分开：' + JSON.stringify(t75))
  assert.equal(j.warnings.length, 1, 'warnings 必须非空（可见性修复的判据）：' + JSON.stringify(j.warnings))
  assert.match(j.warnings[0], /解析失败|不兼容/)
  assert.match(j.note, /解析失败|不是「已同步」/)
  assert.equal(readFileSync(join(d, 'audits', '闸门记录-T7.5.md'), 'utf8'), before, 'warn 形态必须零写盘')
  rmSync(d, { recursive: true, force: true })
})

// ── v18.62.7（反哺-主控实测-2026-10-02 §A16）：fix-gates ④ 补「字段含 <…>」形态 ──────────────────
//   病灶（实测）：交付说明 12 字段**齐备**但其中两处正文含 `<…>` → `M-Exist-7` 判 P1，而 `fix-gates`
//   报「✅ 未发现可机械修复项」——**两个工具结论相反**。根因：本类旧判据只列「字段标题缺不缺」。
test('A16：fix-gates ④ 必须报「字段正文含 <…> 占位符」（与 M-Exist-7 同形判据）', () => {
  const d = tmp('fg-ph-')
  mkdirSync(join(d, 'final'), { recursive: true })
  writeFileSync(join(d, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  const REQ = ['路径', '图件清单', '遗留风险', '人工核验项', '数据溯源', '成本指标',
    '建议 merge 的反哺清单', 'AI 使用披露', '证据包指纹', '投稿就绪检查表', '主人决策记录', '终检结论']
  const note = '# 交付说明\n\n' + REQ.map((t, i) => {
    const bad = t === '成本指标' ? '：~5M（其中 <待实测> 部分为估算）'
      : t === '主人决策记录' ? '：Phase 0 通过（原话 <主人原话>）' : `：已填（第 ${i + 1} 节）`
    return `## ${i + 1}. ${t}\n\n- 内容${bad}\n`
  }).join('\n')
  writeFileSync(join(d, 'final', '交付说明.md'), note)
  const runFix = (extraArgs) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [join(SCRIPTS, 'fix-gates.mjs'), ...extraArgs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    } catch (e) {
      return { code: e.status ?? -1, out: String(e.stdout || '') + String(e.stderr || '') }
    }
  }
  const r1 = runFix([d, '--json'])
  const j = JSON.parse(r1.out.slice(r1.out.indexOf('{')))
  const hit = j.suggestions.find((s) => s.id === 'M-Exist-7' && /尖括号|占位符/.test(s.detail))
  assert.ok(hit, '字段正文含 <…> 必须被列出（旧版只查字段缺失 → 与 M-Exist-7 相反）：' + JSON.stringify(j.suggestions))
  assert.match(hit.fix, /成本指标/, '修法里必须点名到**具体字段**（否则读者仍要自己找）：' + hit.fix)
  assert.match(hit.fix, /主人决策记录/)
  assert.match(hit.fix, /圆括号/, '修法必须给出可粘贴的替代写法：' + hit.fix)
  // 反向：字段齐备且无占位符 → 本类不得再报（防假阳性）
  writeFileSync(join(d, 'final', '交付说明.md'), note.replace('（其中 <待实测> 部分为估算）', '（其中待实测部分为估算）').replace('（原话 <主人原话>）', '（原话：维持 13000）'))
  const r2 = runFix([d, '--json'])
  const j2 = JSON.parse(r2.out.slice(r2.out.indexOf('{')))
  assert.ok(!j2.suggestions.some((s) => s.id === 'M-Exist-7'), '无占位符时不得再报 M-Exist-7：' + JSON.stringify(j2.suggestions))
  rmSync(d, { recursive: true, force: true })
})
