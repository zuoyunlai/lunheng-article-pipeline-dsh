// v18.12.0（2026-09-25 全量审计 L-52）：**按模板形态写的数据卡**不得被 M-Form-6 判 P0。
//
// 教训（审计实测三变体对照）：`数据卡-template.md` 的「## 📇 索引段」是**围栏内行首裸编号**、
//   且位于条目**之前**；条目形态同样是行首 `[Dxx] …`。旧 `splitCard` 回退行内式时**索引行先命中** →
//   切出的是索引行 → 块内没有「信任级别」行 → 一张**完全合规**的卡被判「独立段缺失」P0（>5 条必触发），
//   并派生 M-Integrity-1 P0。改成表格索引段或删掉索引段反而通过——**恰好是模板规定的形态被判失败**。
// 连带：`normalize-trust-level` 对行内式 block 的插入点恒为 0（落在条目之前）→ 永不达标 + 非幂等。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'

const { splitCard, cardHeadingPattern } = await import(pathToFileURL(join(SCRIPTS, '_lib', 'cards.mjs')).href)
const { TRUST_COMPLIANT_RE } = await import(pathToFileURL(join(SCRIPTS, '_lib', 'trust.mjs')).href)

/** 照 `数据卡-template.md` 原样写：围栏索引段（在条目之前）+ 行首式条目 + `├ 信任级别：` */
const card = (withTrust = true) => [
  '# 数据卡', '',
  '> 总条数 2 条', '',
  '## 📇 索引段', '',
  '```',
  '[D01] 数值甲 ｜ 主题 ｜ 论点1',
  '[D02] 数值乙 ｜ 主题 ｜ 论点2',
  '```', '',
  '[D01] 数值甲 | 机构 | 2024 | https://example.org/a',
  ...(withTrust ? ['      ├ 信任级别：已发布', '      └ 口径说明：城镇口径'] : ['      └ 口径说明：城镇口径']),
  '',
  '[D02] 数值乙 | 机构 | 2023 | https://example.org/b',
  ...(withTrust ? ['      ├ 信任级别：二手转引', '      └ 口径说明：转引自 L05'] : ['      └ 口径说明：转引自 L05']),
  '',
].join('\n')

test('splitCard：行内式命中**条目**而非索引段行（模板索引段在围栏内）', () => {
  const c = splitCard(card(), '01')
  assert.ok(c, '应命中 [D01]')
  assert.equal(c.form, 'line', '模板条目无 ### 标题 → 走行内式')
  assert.ok(c.block.includes('数值甲 | 机构'), '块必须是条目正文')
  assert.ok(!c.block.includes('论点1'), '块不得是索引段行（含「论点1」）')
  assert.ok(TRUST_COMPLIANT_RE.test(c.block), '合规条目的块内必须能看到信任级别行')
})

test('splitCard：标题式仍优先（有条目无围栏索引段时行为不变）', () => {
  const t = '# 卡\n\n### [D01] 甲\n\n- 值：1\n- 信任级别：已发布\n'
  const c = splitCard(t, '01')
  assert.equal(c.form, 'heading')
  assert.ok(c.block.includes('信任级别'))
  assert.match(cardHeadingPattern('01').source, /#\{2,4\}/)
})

test('splitCard：条目确实没写信任级别时仍返回该条目块（由门报 P0，不得静默回退成索引行）', () => {
  const c = splitCard(card(false), '02')
  assert.ok(c.block.includes('数值乙 | 机构'), '仍应切到真条目')
  assert.equal(TRUST_COMPLIANT_RE.test(c.block), false, '门应据此报缺失')
})

test('normalize-trust-level：行内式卡片的插入点在条目**之内**且幂等（L-52 连带）', () => {
  const dir = tmp('lunheng-card-')
  const f = join(dir, '数据卡.md')
  // 条目里「描述字段含档位词、缺独立行」——正是本脚本的补行场景（token 可推断，故不是「拒绝推断」路径）
  const noTrust = card(false).replace('口径说明：城镇口径', '来源说明：该数据为已发布统计公报')
    .replace('口径说明：转引自 L05', '来源说明：本文二手转引自某日报')
  writeFileSync(f, noTrust)
  try {
    run([join(SCRIPTS, 'normalize-trust-level.mjs'), f, '--write'], {})
    const after1 = readFileSync(f, 'utf8')
    const n1 = (after1.match(/^信任级别：/gm) || []).length
    assert.equal(n1, 2, `第一轮应为两条各补一行独立声明，实际 ${n1}`)
    run([join(SCRIPTS, 'normalize-trust-level.mjs'), f, '--write'], {})
    const after2 = readFileSync(f, 'utf8')
    const n2 = (after2.match(/^信任级别：/gm) || []).length
    assert.equal(n2, n1, '第二轮必须幂等——不得再插一条')
    for (const id of ['01', '02']) {
      const c = splitCard(after2, id)
      assert.ok(c.block.includes('数值'), `[D${id}] 的块应仍是条目正文`)
      assert.ok(TRUST_COMPLIANT_RE.test(c.block), `[D${id}] 插入后必须达标（插入点须在条目内）`)
      assert.ok(!c.block.includes('论点'), `[D${id}] 的块不得变成索引段行`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
