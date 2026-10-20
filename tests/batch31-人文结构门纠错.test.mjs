// 批次 31（2026-10-20 · 人文结构门纠错批 · `audits/定位错配审计-2026-10-20` E1/E2/E7 + B1/B2，主人授权）
//
// 为什么需要：中文人文长文的常规体例是**章节式论证 + 结语**，而 structure-check 只认字面
//   「引言/讨论/结论」——实测 5 份真实人文稿 3 份被判 exit 2（「结语」不命中「结论」，
//   无「讨论」节 → 四要素全缺 → P0）。这是「机器把对的判成错的」。
// 本批改三件事，本文件逐件钉死：
//   ① 「结论」接受同义组 结语 / 余论（刻意不收「小结」——章节小结抢先命中会截断真结论节）；
//   ② 无「讨论」节 = P2（转 T7 人工），**不再 P0**；「有讨论节而四项特征词全无」**仍 P0**（v18.62.4 收紧保留）；
//   ③ 漏斗词表含人文缺口侧词面（问题的提出 / 学界长期 / 聚讼 / 既有研究 / 重估…）。
// 判级契约：结语式人文稿的标准落点 = **exit 1**（S-IMRaD 记「讨论」缺 1 节 → P1，是 T7 人工复核的
//   可见标记），不是 exit 0（那等于「讨论」彻底可选）也不是 exit 2（那是本批要修的假 P0）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCRIPTS, run } from './_fixtures.mjs'

const STRUCT = join(SCRIPTS, 'structure-check.mjs')

const tmpWrite = (name, body) => {
  const d = mkdtempSync(join(tmpdir(), 'lunheng-b31-'))
  const f = join(d, name)
  writeFileSync(f, body, 'utf8')
  return f
}
const gate = (f, ...flags) => {
  const r = run([STRUCT, f, ...flags])
  return { code: r.code, json: JSON.parse(r.out.slice(r.out.indexOf('{'))) }
}

test('① 结语/余论同义：章节式人文稿不再因「结论」字面缺节（exit 2 → 1）', () => {
  const f = tmpWrite('结语稿.md',
    '# 论 X\n\n## 引言\n\n该领域历来受到关注，学界长期聚讼于 Y 能否成立。\n本文尝试重估此问题。\n\n'
    + '## 一、甲\n\n内容。\n\n## 二、乙\n\n内容。\n\n## 结语\n\n本文重审了 Y 的边界。\n')
  const { code, json } = gate(f, '--humanities')
  assert.equal(code, 1, `结语式人文稿应落 exit 1（S-IMRaD 记讨论缺 1 节→P1；disc→P2），实得 ${code}`)
  const imrad = json.checks['S-IMRaD']
  assert.deepEqual(imrad.missing, ['讨论'], '「结论」应由结语同义命中，唯一缺节 = 讨论')
  assert.equal(imrad.severity, 'P1')
})

test('①b 余论同义命中；「小结」刻意不同义（防章节小结截断真结论节）', () => {
  const mk = (tail) => tmpWrite('余论稿.md',
    '# 论 X\n\n## 引言\n\n领域重要，尚无研究。本文提出 Z。\n\n## 一、甲\n\n内容。\n\n' + tail)
  const yu = gate(mk('## 余论\n\n本文重审了边界。\n'), '--humanities')
  assert.deepEqual(yu.json.checks['S-IMRaD'].missing, ['讨论'], '「余论」应命中结论同义')
  // 章节小结在前、结语在后：若「小结」入同义组，首个命中的「小结」会截断真结论——断言它没入组
  const mixed = gate(mk('## 本章小结\n\n过渡。\n\n## 结语\n\n本文重审了边界。\n'), '--humanities')
  assert.deepEqual(mixed.json.checks['S-IMRaD'].missing, ['讨论'], '小结不得抢先充当结论（结语仍应命中）')
})

test('② 无讨论节 = P2 转人工，不再 P0（IMRaD 模式同适用）', () => {
  const f = tmpWrite('无讨论.md',
    '# 题\n\n## 引言\n\n该领域很重要，但尚无研究。本文提出新方法。\n\n## 方法\n\n内容。\n\n'
    + '## 结果\n\n结果表明 X。\n\n## 结论\n\n本文发现 Y，未来可扩展。\n')
  const { code, json } = gate(f)
  assert.equal(code, 1, 'S-IMRaD 缺讨论 1 节 → P1 主导；disc 降 P2 后不得再 P0')
  const disc = json.checks['S-Discussion-4']
  assert.equal(disc.severity, 'P2', '无讨论节应记 P2（转 T7 人工）')
  assert.ok(String(disc.missing[0]).includes('无「讨论」节'), 'missing 应言明无节与人工转办：' + JSON.stringify(disc.missing))
})

test('②b 有讨论节而四项特征词全无 → 仍 P0（v18.62.4 收紧保留，降档不得滑到空壳）', () => {
  const f = tmpWrite('空壳讨论.md',
    '# 题\n\n## 引言\n\n该领域很重要，但尚无研究。本文提出新方法。\n\n## 方法\n\n内容。\n\n'
    + '## 结果\n\n结果表明 X。\n\n## 讨论\n\n好。\n\n## 结论\n\n本文发现 Y，未来可扩展。\n')
  const { code, json } = gate(f)
  assert.equal(code, 2, '空壳讨论必须仍可触 P0 / exit 2')
  assert.equal(json.checks['S-Discussion-4'].severity, 'P0')
})

test('③ 漏斗人文词面：问题的提出 / 学界长期 / 既有研究 / 重估 不再判「知识缺口」缺', () => {
  const f = tmpWrite('人文引言.md',
    '# 论 X\n\n## 引言\n\n' + '美学领域历来关注丑的范畴。学界长期聚讼于丑能否成为审美对象，既有研究多集中于形式层面。'
    + '本文重估这一问题的提出方式。\n\n## 讨论\n\n本文发现 A，与既有研究相比有所不同，机制在于 B，局限是 C，未来进一步。\n\n## 结论\n\n结语内容。\n')
  const { json } = gate(f, '--humanities')
  assert.deepEqual(json.checks['S-Intro-Funnel'].missing, [],
    '人文写法的三要素（历来/学界长期/重估）应全部命中：' + JSON.stringify(json.checks['S-Intro-Funnel'].missing))
})
