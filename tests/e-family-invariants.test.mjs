// E 族「单源不变量」机检回归网（v18.18.10 新增）
//
// 本文件钉住的不只是实现，还有**两条设计决定**——因为照审计字面做（「该事实只允许出现在真源一处」）
// 会退化成字面禁令，而字面禁令在本仓**必然误报**：文档规范要求更正记录写出旧值。
// 本会话已三次踩「按字面扫文档会把『引述被纠正内容』当成那内容本身」，故这里把「不做什么」也钉住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deriveJournalCounts,
  declaredJournalCounts,
  MC_LABEL_ANCHORS,
  JOURNAL_POINTER_ANCHORS,
} from '../scripts/_lib/e-family-invariants.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const S = (p) => join(ROOT, 'skills', 'lunheng-article-pipeline', p)
const DB = readFileSync(S('references/_shared/期刊数据库.md'), 'utf8')

test('E-14 派生：表行数（排除表头与分隔行）', () => {
  const mini = [
    '## 一、中文期刊（CSSCI/北大核心，3 个）',
    '| 刊名 | 等级 |',
    '|---|---|',
    '| A | CSSCI |',
    '| B | CSSCI |',
    '| C | 北大核心 |',
    '## 二、英文 SSCI 期刊（1 个）',
    '| 刊名 | 分区 |',
    '|---|---|',
    '| X | Q1 |',
  ].join('\n')
  assert.deepEqual(deriveJournalCounts(mini), { zh: 3, en: 1 })
  assert.deepEqual(declaredJournalCounts(mini), { zh: 3, en: 1 })
})

test('E-14 自称解析：逗号是**可选**的（中文节有、英文节没有）', () => {
  // 回归钉：第一版把逗号写成必需的 `/，\\s*(\\d+)\\s*个/`，于是「（12 个）」解析成 null，
  // 门误报「解析器与文档形状脱节」。真实文档正是这种不对称写法。
  const zhOnlyComma = '## 一、中文期刊（CSSCI/北大核心，28 个）'
  const enNoComma = '## 二、英文 SSCI 期刊（12 个）'
  assert.equal(declaredJournalCounts(zhOnlyComma + '\n' + enNoComma).zh, 28)
  assert.equal(declaredJournalCounts(zhOnlyComma + '\n' + enNoComma).en, 12, '英文节没有逗号，也必须能解析')
})

test('E-14 真实树：真源自称的规模 == 它自己的表行数', () => {
  const derived = deriveJournalCounts(DB)
  const declared = declaredJournalCounts(DB)
  assert.ok(derived.zh > 0 && derived.en > 0, `表行数解析异常（${JSON.stringify(derived)}）——解析退化会让本断言恒真`)
  assert.equal(declared.zh, derived.zh, `中文：标题自称 ${declared.zh} ≠ 表实有 ${derived.zh} 行`)
  assert.equal(declared.en, derived.en, `英文：标题自称 ${declared.en} ≠ 表实有 ${derived.en} 行`)
})

test('E-8 / E-14 锚点在场：新名字与新指针必须都在（单侧回退会让它们消失）', () => {
  const card = readFileSync(S(MC_LABEL_ANCHORS.file), 'utf8')
  for (const label of MC_LABEL_ANCHORS.labels) {
    assert.ok(
      MC_LABEL_ANCHORS.definitionRe(label).test(card),
      `${MC_LABEL_ANCHORS.file} 缺 \`${label}\` 的**定义项**（形如 \`> - **${label} …**\`）——E-8 把三检改名到 \`MC-\` 前缀后，新名字必须以定义项在场`,
    )
  }
  assert.ok(JOURNAL_POINTER_ANCHORS.length >= 3, '期刊规模指针锚点过少——锚点表被削会让本断言空过')
  for (const a of JOURNAL_POINTER_ANCHORS) {
    assert.ok(a.must.test(readFileSync(S(a.file), 'utf8')), `${a.file} 缺期刊规模指针——写死数字的回退应当被拦住`)
  }
})

test('**过弱判据回归**：锚点必须锚到定义项，不能只判「字符串在文件里出现过」', () => {
  // 实测踩到：第一版只判 `card.includes(label)`，而同一张卡的「命名空间契约」行把三个名字并列写了一遍
  // ——于是把**定义项**的名字抹掉，锚点依然在场，反向自证假绿。
  const card = readFileSync(S(MC_LABEL_ANCHORS.file), 'utf8')
  const defRe = MC_LABEL_ANCHORS.definitionRe('MC-Form-12')
  // 反向构造：把定义项的名字去掉（但契约行仍在 —— 裸 includes 会认为它还在）
  const tampered = card.replace('**MC-Form-12 方法节参数完整性**', '**方法节参数完整性**')
  assert.notEqual(tampered, card, '构造失败：未找到定义项')
  assert.ok(tampered.includes('MC-Form-12'), '契约行应当仍留着这个名字（这正是裸 includes 会漏的原因）')
  assert.ok(!defRe.test(tampered), '锚到定义项的判据必须能发现「定义项名字被抹掉」')
})

test('**设计钉**：本门**不做字面禁令**——「否定式提及」与「更正注记」都是正当写法，不得被判红', () => {
  // 这两处是真实存在的正当写法，字面禁令会把它们误报：
  //   ① 07卡 澄清「M 门体系…无 M-Form-12」——**否定式**提及旧名
  //   ② 期刊文档写「原写 25 个，真源实为 28」——**更正注记**引用旧值
  // 断言：这些字符串确实在场（即：一个幼稚的字面禁令会在此误报），而本门的检查口径不受其影响。
  const card = readFileSync(S(MC_LABEL_ANCHORS.file), 'utf8')
  assert.ok(/无\s*M-Form-12/.test(card), '07卡 应仍保留「无 M-Form-12」的否定式澄清（这是它正当存在的证据）')
  const algo = readFileSync(S('references/_shared/期刊匹配算法.md'), 'utf8')
  assert.ok(/25/.test(algo), '期刊匹配算法 应仍保留「原写 25」的更正注记（同上）')

  // 而本门的锚点检查对这些完全无感——它只看「新名字/新指针在不在场」
  for (const label of MC_LABEL_ANCHORS.labels) assert.ok(card.includes(label))
})
