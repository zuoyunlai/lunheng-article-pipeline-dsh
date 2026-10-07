// 规则 ㊲「速查卡硬数字派生」的回归网（v18.80.0 · 全量审计-v18.79.1 P3-9）
//
// 为什么需要：`docs/quick-facts.md` 自称「新人第一眼硬数字的**单一真源**」，但本批审计实测到
//   ——它的**标题**与「当前版本」行停在 v18.78.1 而真源已 v18.80.0，**连漏两版无人发现**。
//   根因不是「人忘了改」，而是**那处字面形态不在 bump 脚本的替换面内**（脚本只认
//   `当前版本 **vX.Y.Z**` 与 `@X.Y.Z` 两种），且**没有任何门**看着它。
//   本组用例把「有唯一可派生真源」的三项钉住（版本 / 角色数 / 随包脚本数），
//   并**同时**锁住实现里踩过的两个陷阱（内层枚举形态 / `00-` 卡不得计入角色数）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { run, mkRepo, SCRIPTS } from './_fixtures.mjs'

const QF_REL = join('docs', 'quick-facts.md')
const cc = (repo) => join(repo, 'skills', 'lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')

/** 造一个含 docs/quick-facts.md 的临时仓（mkRepo 默认只复制 skills/ + 少量包级清单） */
const mkWithCard = () => {
  const { d, repo } = mkRepo({ extraFiles: ['CONTRIBUTING.md'] })
  const dest = join(repo, 'docs')
  mkdirSync(dest, { recursive: true })
  writeFileSync(join(repo, QF_REL), readFileSync(join(process.cwd(), QF_REL), 'utf8'))
  return { d, repo }
}

test('㊲-a 速查卡**标题**版本漂移必须报（标题那处不在 bump 脚本替换面内）', () => {
  const { d, repo } = mkWithCard()
  try {
    const p = join(repo, QF_REL)
    const src = readFileSync(p, 'utf8')
    writeFileSync(p, src.replace(/^#\s*论衡速查卡（v\d+\.\d+\.\d+）/m, '# 论衡速查卡（v0.0.1）'))
    const r = run([cc(repo)])
    assert.notEqual(r.code, 0, `标题版本漂移应报错，实得 exit ${r.code}`)
    assert.match(r.stderr + r.stdout, /速查卡版本漂移/, '必须报「速查卡版本漂移」')
    assert.match(r.stderr + r.stdout, /标题/, '必须点明是标题那一处')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('㊲-b 「当前版本」行漂移必须报', () => {
  const { d, repo } = mkWithCard()
  try {
    const p = join(repo, QF_REL)
    const src = readFileSync(p, 'utf8')
    writeFileSync(p, src.replace(/\|\s*当前版本\s*\|\s*\*\*v\d+\.\d+\.\d+\*\*/, '| 当前版本 | **v0.0.1**'))
    const r = run([cc(repo)])
    assert.notEqual(r.code, 0, `「当前版本」行漂移应报错，实得 exit ${r.code}`)
    assert.match(r.stderr + r.stdout, /速查卡版本漂移/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('㊲-c 角色数漂移必须报，且派生值**不得**把 `00-主控-*.md` 算成独立角色', () => {
  const { d, repo } = mkWithCard()
  try {
    const p = join(repo, QF_REL)
    const src = readFileSync(p, 'utf8')
    writeFileSync(p, src.replace(/(\d+)\s*个独立角色/, '8 个独立角色'))
    const r = run([cc(repo)])
    assert.notEqual(r.code, 0, `角色数漂移应报错，实得 exit ${r.code}`)
    assert.match(r.stderr + r.stdout, /速查卡角色数漂移/)
    // 陷阱回归：若实现用 /^0(\d)-/，`00-主控-coordinator` 与 `00-主控-扩展职责` 会把派生值抬到 10，
    //   于是报「写 8，实测 10」——正确的派生值应为 **9**（01–09 九张编号卡）。
    assert.match(r.stderr + r.stdout, /共 9 张编号卡/,
      '派生值必须是 9（01–09）；出现别的数字说明 `00-` 卡被计入了角色数')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('㊲-d 规则 ㊲ 自身必须已登记（㉟ 双向覆盖不得漏项）', () => {
  // 防空转：本规则是新立的，若忘了登记进 rule-registry，㉟ 会报「规则未登记」——
  //   本用例把它前置钉住，避免「规则在跑但登记表没它」这种半成品状态被合入。
  const reg = readFileSync(join(SCRIPTS, '_lib', 'cc-rules', 'rule-registry.mjs'), 'utf8')
  assert.match(reg, /id:\s*'㊲'/, '规则 ㊲ 必须登记进 rule-registry.mjs')
  // 且真源仓跑一次必须绿（否则说明本规则与卡/登记表之间有未收口的漂移）
  const r = run([cc(join(process.cwd()))])
  assert.equal(r.code, 0, `真源仓一致性自检必须通过：\n${r.stdout}${r.stderr}`)
})
