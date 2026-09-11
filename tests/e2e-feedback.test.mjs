// 端到端测试反哺的引擎修复回归用例（v17.0.0）
//
// 来源：一次真实端到端测试（`E:\HERNESS\run\论衡M门自省\` —— 按 Phase 0→5 逐角色写出全部产物，
// 再跑 final-check 串联的 count-chars / m-gate-check / build-evidence-bundle）。
// 该次测试把 M 门从「4 P0 + 3 P1 + 4 P2」跑成「1 P0 + 0 P1 + 1 P2」，其中 6 项不通过**不是 fixture 的错**，
// 而是机检自身的假阳性/窄口径 —— 本文件把这 6 处固化为回归用例。
//
// 分组：
//   ① 正文里的「被讨论的编号/占位符字面量」（代码块、反引号）不得参与引用闭环与占位符机检
//   ② M-Form-8 承重墙锚点必须是结构信号（散文里提到「承重墙」三字不得触发超载）
//   ③ M-Exist-8「关闭状态」引用行不算重复定义
//   ④ M-Exist-9 节标题与条目行并存时结论/实据分别判定（含 ✓ 与「N 节」量词）
//   ⑤ M-Exist-10 字数预算允许标题换行后出现数字
//   ⑥ final-check 顺序：证据包必须先刷新（防 M 门读陈旧证据包）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')
const tmp = () => mkdtempSync(join(tmpdir(), 'lunheng-e2e-'))
const run = (args) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' }
}
const parseJson = (r) => JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
const DRAFT_WITH_ENDNOTES = (bodyTail) => '# 标题\n\n## 摘要\n\n正文 [L01] [L02] [L03] [D01]。\n\n## 一、导论\n\n'
  + '段落内容。'.repeat(30) + bodyTail
  + '\n\n## 参考文献\n\n[L01] a\n[L02] b\n[L03] c\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'
const CARD = (name, ids) => `# ${name}\n\n## 📇 索引段\n\n`
  + ids.map((id) => `[${id}] 主题 ｜ 论点1`).join('\n')
  + '\n\n## 正文\n\n' + ids.map((id) => `### [${id}] 条目\n信任级别：已发布\n`).join('\n')

test('端到端反哺①：代码块/反引号里的编号与占位符不参与引用闭环与占位符机检', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  // 正文里【讨论】编号与占位符：反引号 + 围栏代码块
  const CODE = '```js\n' + "const t = String(x ?? '');  // 代码里的 ?? 不是占位符\n" + '```\n'
  writeFileSync(join(fin, '定稿.md'), DRAFT_WITH_ENDNOTES(
    '\n本文讨论 `[待补]` 这类占位符，并说明排除合法形态 `[C-主01]`。\n\n' + CODE))
  writeFileSync(join(ev, '文献卡.md'), CARD('文献卡', ['L01', 'L02', 'L03']))
  writeFileSync(join(ev, '数据卡.md'), CARD('数据卡', ['D01']))
  const j = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev]))
  const g = (p) => j.results.find((x) => x.gate.startsWith(p))
  assert.equal(g('M-Form-3').pass, true, '反引号/代码块里的占位符与 ?? 不应判为残留：' + g('M-Form-3').detail)
  assert.equal(g('M-Form-1').pass, true, '代码里的字面编号不应影响引用完整性：' + g('M-Form-1').detail)
  assert.equal(g('M-Exist-1').pass, true, '被讨论的编号不应产生孤儿/漏引：' + g('M-Exist-1').detail)
  rmSync(d, { recursive: true, force: true })
})

test('端到端反哺②：M-Form-8 承重墙锚点必须是结构信号（散文提到「承重墙」不得触发超载）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n## 一、导论\n\n' + '正文段落。'.repeat(40)
    + '[L01][D01]\n\n## 参考文献\n\n[L01] x\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  writeFileSync(join(ev, '文献卡.md'), CARD('文献卡', ['L01']))
  writeFileSync(join(ev, '数据卡.md'), CARD('数据卡', ['D01']))
  writeFileSync(join(ev, '案例卡.md'), CARD('案例卡', ['C01']))
  // 散文里出现「承重墙」三字（禁做项），真正的清单在其后 40 行之外
  const filler = Array.from({ length: 40 }, (_, i) => `填充行 ${i + 1}`).join('\n')
  writeFileSync(join(proj, 'analysis', '分析大纲.md'),
    '# 分析大纲\n\n## 一、禁做项\n\n- 正文不得出现「初稿」「承重墙」「待回查」等流程词\n\n' + filler
    + '\n\n## 二、承重墙清单\n\n| 论点 | 承重证据 top1 |\n|---|---|\n| 论点1 | [C01] |\n| 论点2 | [L01] |\n')
  const it = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev]))
    .results.find((x) => x.gate.startsWith('M-Form-8'))
  // 注意断言用「承重墙超载」而非「超载」——通过态的 detail 里含「无超载」三字
  assert.doesNotMatch(it.detail, /承重墙超载/, '散文里的「承重墙」三字不得触发超载误判：' + it.detail)
  assert.match(it.detail, /无超载/, '应识别为「无超载」：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('端到端反哺③：M-Exist-8「关闭状态」清单行不算重复定义（06 卡模板要求逐条列）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), DRAFT_WITH_ENDNOTES(''))
  const C = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']
  const entry = '- [P0-C1-1] **标题**\n  - 论点定位：§三\n  - 反方观点：x\n  - 你的论据 [L01]\n  - 攻击强度：高\n  - 建议：加固\n'
  writeFileSync(join(proj, 'analysis', '批判报告-v1.md'),
    '# 批判报告 v1\n\n' + C.map((c) => `## ${c} 维度\n\n` + '内容。'.repeat(20) + '\n').join('\n')
    + '\n## 批判总结\n\n- [P0-C1-1] ✓已关闭（在 §三 修订后）\n\n' + entry)
  const it = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev]))
    .results.find((x) => x.gate.startsWith('M-Exist-8'))
  assert.doesNotMatch(it.detail, /编号重复/, '「关闭状态」引用行不得判为重复定义：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('端到端反哺④：M-Exist-9 节标题与条目行并存时结论/实据分别判定（含 ✓ 与「N 节」）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  const aud = join(proj, 'audits')
  mkdirSync(ev, { recursive: true })
  mkdirSync(aud, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), DRAFT_WITH_ENDNOTES(''))
  const GALL = ['G0', 'G0.5', 'G1', 'G2', 'G2.5', 'G3', 'G4', 'G4-2', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14']
  // 每项：节标题 → 空行 → 条目行（结论与实据都在条目行；G4 用「10 节」量词、结论用 ✓）
  writeFileSync(join(aud, '审计报告-v1.md'), '# 审计报告 v1\n\n结论：通过 ✅\n\n'
    + GALL.map((g) => `## ${g} 检查\n\n- **${g}**：实测 ${g === 'G4' ? '10 节齐全' : '5/5 覆盖'}，见 引用核验记录。**通过** ✓。\n`).join('\n'))
  const it = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev]))
    .results.find((x) => x.gate.startsWith('M-Exist-9'))
  assert.equal(it.pass, true, '节标题+条目行并存、✓ 结论词、「N 节」量词都应识别：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('端到端反哺⑤：M-Exist-10 字数预算允许标题换行后出现数字', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), DRAFT_WITH_ENDNOTES(''))
  writeFileSync(join(proj, 'analysis', '分析大纲.md'),
    '# 分析大纲\n\n## 一、论点\n\n内容\n\n## 六、写手版精简段\n\n'
    + '### 论证主线\n\n主线甲\n\n### 论点-论据映射表\n\n| 论点 | 论据 |\n|---|---|\n| 论点1 | [L01] |\n\n'
    + '### 反方规划要点\n\n反方甲\n\n### 字数预算\n\n2500–3000 字\n\n### 禁做项\n\n不作主观句\n\n'
    + '### 承重墙清单\n\n| 论点 | 承重证据 top1 |\n|---|---|\n| 论点1 | [L01] |\n')
  const it = parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev]))
    .results.find((x) => x.gate.startsWith('M-Exist-10'))
  assert.doesNotMatch(it.detail, /字数预算未见数字/, '标题换行后的数字应被识别：' + it.detail)
  rmSync(d, { recursive: true, force: true })
})

test('端到端反哺⑥：final-check 步骤顺序必须是「先刷新证据包、再跑 M 门」', () => {
  const src = readFileSync(join(SCRIPTS, 'final-check.mjs'), 'utf8')
  const iEv = src.indexOf("steps.push({ name: 'build-evidence-bundle.mjs --summary'")
  const iGate = src.indexOf("steps.push({ name: 'm-gate-check.mjs'")
  assert.ok(iEv > 0 && iGate > 0, '两个步骤都应通过 push 进入 steps 数组')
  assert.ok(iEv < iGate, 'build-evidence-bundle 必须排在 m-gate-check 之前（否则 M 门读到上一次收集的陈旧证据包）')
})
