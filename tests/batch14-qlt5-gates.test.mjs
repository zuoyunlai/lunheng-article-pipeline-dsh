// v18.49.0（QLT-5 实测反哺批次 2）**门覆盖面 / 体例适配**回归：F-AG / F-AH / F-AU / F-T
//
// 本批与批次 1 的分工：批次 1 只改「读数/证据」（不改门判内容）；**本批改判据**——
//   修的是「门把正确的东西判成错的」这类**假阳性**，故每条用例都锁「旧行为会误报的那个形态」。
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'
import { pathToFileURL } from 'node:url'

const M = join(SCRIPTS, 'm-gate-check.mjs')
const REFS = pathToFileURL(join(SCRIPTS, '_lib', 'refs.mjs')).href
const SECTIONS = pathToFileURL(join(SCRIPTS, '_lib', 'sections.mjs')).href

/** 最小可过红线（文末五节 + [L01]/[D01] 双向闭环）的项目骨架 + 可插正文节。 */
const mkProj = (bodySections) => {
  const d = tmp('lunheng-b14-')
  const fin = join(d, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(d, '01-任务简报.md'),
    '# 任务简报\n\n## 研究问题（主控拆解，3-5 个子问题）\n\n1. 子问题一？\n2. 子问题二？\n3. 子问题三？\n\n## 数据需求\n\n- 需找数据点：≥1 条\n')
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n摘要正文 [L01] [D01]。\n\n'
    + bodySections
    + '\n## 参考文献\n\n- [L01] 作者甲. 题名[J]. 刊, 2024.\n\n## 数据来源\n\n- [D01] 机构 2024\n\n'
    + '## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\n- AI。\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [D01] | 值 | 论点1 |\n\n[D01] y | 机构 | 2024 | url\n      ├ 信任级别：已发布\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [L01] | 综述 | 论点1 |\n\n[L01] 作者甲. 题名[J]. 刊, 2024.\n      ├ 信任级别：已发布\n')
  writeFileSync(join(ev, '案例卡.md'), '# 案例卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [C01] | 案例 | 论点1 |\n\n### [C01] 甲\n- **时间窗口**：2024-01-01 ~ 2024-02-01\n- **检索截止**：2026-09-19\n- **来源谱系（≥2 独立来源）**：\n  - 甲源 <https://a.example/1>\n  - 乙源 <https://b.example/2>\n')
  return { d, draft: join(fin, '定稿.md'), ev, report: join(fin, 'M-Gate-Report.json') }
}
const gate = (f, name) => {
  run([M, f.draft, f.ev, '--report', f.report])
  const j = JSON.parse(readFileSync(f.report, 'utf8'))
  return j.results.find((r) => new RegExp(name).test(r.gate))
}
// 正文节必须 > mform8MinSecLen(100) 汉字才会被 M-Form-8 扫描
const LONG = '这一节用来承载描述性结果的叙述，逐层交代样本来源、编码口径与统计边界，并说明为何只作描述不作因果推断。'.repeat(3)

// ── F-AG：范围写法展开（旧版只命中首尾两项 → 中间条目被判「漏引」） ──
test('refs（F-AG）：expandRefRanges 展开区间写法，且对笔误不展开而是如实报 bad', async () => {
  const { expandRefRanges } = await import(REFS)
  const r1 = expandRefRanges('数据来源：\n- [D01]–[D04] 全部\n')
  assert.deepEqual([...r1.extra].sort(), ['[D01]', '[D02]', '[D03]', '[D04]'], '区间必须展开成逐项')
  assert.deepEqual(r1.bad, [], '正常区间不应进 bad')
  const r2 = expandRefRanges('- [D05]-[D03] 倒序\n- [L01]-[D02] 跨字母\n- [D01]-[D40] 跨度 >30\n')
  assert.deepEqual(r2.bad.length, 3, '倒序 / 跨字母 / 超跨度 三种笔误都要进 bad（不得静默吞掉）')
  assert.deepEqual([...r2.extra], [], '笔误一律不展开')
})

test('m-gate-check（F-AG 集成）：文末用区间写法时，中间条目**不得**被判「漏引」', () => {
  const f = mkProj('## 一、论证\n\n' + LONG + ' [D01] [D02] [D03] [D04]。\n')
  try {
    // 把文末「数据来源」改成区间写法，并让正文引用 D01–D04
    const p = f.draft
    writeFileSync(p, readFileSync(p, 'utf8').replace('- [D01] 机构 2024', '- [D01]–[D04] 机构 2024（区间写法）'))
    const r = gate(f, 'M-Exist-1')
    assert.match(String(r.detail), /漏引 0 /, '区间写法不得产生漏引（旧版这里会报 3 条假漏引）：' + r.detail)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

// ── F-AH（**本批已撤回，转主人裁定**）：改「缺 [L] 必 P0」= 推翻 v18.3.1 审计 B9 的刻意加固 ──
//   证据见 	ests/scripts.test.mjs 的 B9 用例（它明确锁「防 P0 降 P1」）；三套defensible口径待主人择一：
//   ① 保持 P0（现状）；② 零证据→P0 / 有证据缺[L]→P2；③ 零证据→P0 / 单类证据→P1 / ≥2类证据缺[L]→P2。

// ── F-T：标题序号前缀（纯前缀口径 → `## 4 描述性结果` 一个都匹配不上 → 整节判缺） ──
test('sections（F-T）：titleMatches 容忍序号前缀，且**不误伤**「第一作者声明」这类真词头', async () => {
  const { titleMatches } = await import(SECTIONS)
  assert.ok(titleMatches('4 描述性结果', '描述性结果'), '阿拉伯数字 + 空格')
  assert.ok(titleMatches('4.1 结果', '结果'), '多级编号')
  assert.ok(titleMatches('四、结果', '结果'), '中文数字 + 顿号')
  assert.ok(titleMatches('参考文献（共 12 条）', '参考文献'), '原有前缀语义不得丢')
  assert.equal(titleMatches('第一作者声明', '作者声明'), false, '「一」后紧跟汉字 → 不剥离（防误伤）')
  assert.equal(titleMatches('5 结论与展望', '方法'), false, '不相关节不得误匹配')
})

// ── F-AU：M-Exist-6 的刊名措辞（旧版把「本库查不到」写成「疑似杜撰刊名」= 对作者的失实指控） ──
test('mexist-gates（F-AU）：**可执行代码里**不得再出现「疑似杜撰刊名」这种失实指控措辞', () => {
  const src = readFileSync(join(SCRIPTS, '_lib', 'mgate-gates', 'mexist-gates.mjs'), 'utf8')
  // 只查**代码**（剥掉注释行）——注释里引述旧文案是正当留痕，不算违规。
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  assert.equal(/疑似杜撰/.test(code), false, '「本库覆盖不全」不等于「作者编造」——该措辞不得出现在可执行代码里')
  assert.ok(/不等于该刊不存在/.test(code), '新措辞须明确「查不到 ≠ 不存在」（把本库规模一并报出）')
})
