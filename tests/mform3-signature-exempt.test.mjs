// M-Form-3 签名栏豁免的**钉住用例**（v18.81.0 · 独立审计批 2 · 2.4a）
//
// **为什么需要**：独立审计报告（v18.80.1）的 P1-2 曾把
//   「`final/定稿.md` 残留 `[作者签名]` / `[日期 YYYY-MM-DD]` 而 M-Form-3 判『零占位符残留』」
//   记为**占位符门漏形态**。经复核，这是**审计方的误判**：
//   `references/templates/AI-使用声明-template.md:20-23`（v18.60.1，主人授权反哺 v2 §1.4）
//   **明确规定**签名栏就用方括号占位、**不得**用连续下划线——理由是学术版签名栏天然含下划线，
//   若把下划线计入占位符，则**每个走学术版的项目都必然命中**（该批实测：把签名栏改成方括号后清零）。
//   ⇒ 留下 `[作者签名]` 是**文档规定的形态**，不是缺陷；主人在投稿时手填。
//
// 本组用例把该决定**钉住**，使后人（包括再一次审计）不能把它当漏检「修」掉：
//   · P-1 规定形态**不得**被报（否则重演 v18.60.1 修掉的那个系统性假阳性）；
//   · P-2 反向控制：真占位符 `[待补]` **必须**照报（防「为了让 P-1 过而把整类检测废掉」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, mkProject } from './_fixtures.mjs'

const DRAFT = ({ aiDecl, bodyExtra = '' }) => [
  '# 标题', '', '## 摘要', '', '正文 [L01]。', '', '## 一、导论', '',
  '段落内容。'.repeat(20) + bodyExtra, '',
  '## 参考文献', '', '[L01] 作者甲. 题名[J]. 刊, 2024.', '',
  '## 数据来源', '', '## 案例来源', '', '## 先行者文献', '', '## AI 使用声明', '', aiDecl, '',
].join('\n')

const mform3 = (draftPath, ev) => parseJson(run([join(SCRIPTS, 'm-gate-check.mjs'), draftPath, ev])).results.find((x) => x.gate.startsWith('M-Form-3'))

test('P-1（钉住）：AI 声明节的 `[作者签名]` / `[日期 YYYY-MM-DD]` 是**模板规定的形态**，M-Form-3 不得报', () => {
  const { d, fin, ev } = mkProject()
  try {
    writeFileSync(join(fin, '定稿.md'), DRAFT({
      aiDecl: '本文由作者与 AI 协作完成。\n\n作者签名：[作者签名]　　日期：[日期 YYYY-MM-DD]',
    }))
    const it = mform3(join(fin, '定稿.md'), ev)
    assert.equal(it.pass, true,
      '方括号签名栏是 `AI-使用声明-template.md:20-23` 规定的形态（v18.60.1 刻意从下划线改来，避免系统性假阳性）——'
      + '把它判为占位符残留等于重演那个假阳性：' + it.detail)
    assert.match(it.detail, /零占位符残留/, '文案保持现行契约字符串')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('P-2（反向控制）：真占位符 `[待补]` 在**正文区**必须照报 —— 上述豁免不得扩大到整类检测', () => {
  const { d, fin, ev } = mkProject()
  try {
    writeFileSync(join(fin, '定稿.md'), DRAFT({
      aiDecl: '本文由作者与 AI 协作完成。\n\n作者签名：[作者签名]　　日期：[日期 YYYY-MM-DD]',
      bodyExtra: '\n本段尚缺一处数据 [待补]。',
    }))
    const it = mform3(join(fin, '定稿.md'), ev)
    assert.equal(it.pass, false, '真占位符必须仍被抓住（否则「豁免」被误扩成「不检」）：' + it.detail)
    assert.match(it.detail, /临时\/占位方括号/, '须点名命中类目（输出用类目标签而非字面词）：' + it.detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
