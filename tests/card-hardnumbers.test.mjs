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

// ── ㊲-e 真源存在性自证（v18.80.1 · 报告 §C2 外移的**护栏**） ──
//   病灶（本批实测）：④⑤ 两条门此前嵌在 `if (block)` / `if (alwaysLimit && block)` 里——
//   **把 `DOC_BUDGET` 搬走或改名，两条门就静默消失、0 报错**，而速查卡的条数 / KB 数从此无人对账。
//   而「搬走 DOC_BUDGET」正是报告 §C2 建议的重构方向（v18.80.1 已实际执行），故这条护栏必须有机检。
test('㊲-e 真源派生失败必须报 P0（防「搬走数据 → 两条门静默消失」）', () => {
  const { d, repo } = mkRepo({
    extraFiles: [
      'CONTRIBUTING.md',
      join('scripts', 'repo-hygiene-check.mjs'),
      join('scripts', '_lib', 'doc-budget-reasons.mjs'),
    ],
  })
  try {
    mkdirSync(join(repo, 'docs'), { recursive: true })
    writeFileSync(join(repo, QF_REL), readFileSync(join(process.cwd(), QF_REL), 'utf8'))

    // 正对照：两份真源齐备时**不得**报「规则失效」（证明本用例不是恒真）
    const ok = run([cc(repo)])
    assert.ok(!/规则失效/.test(ok.stdout + ok.stderr),
      `真源齐备时不得报「规则失效」：\n${ok.stdout}${ok.stderr}`)

    // 负例 1：`DOC_BUDGET` 块缺失（= 外移了数据但读取面没跟进）
    //   ⚠️ 必须精确命中**声明那一行**（`export const DOC_BUDGET = {`）：模块头注释里另有一处
    //   `` `const DOC_BUDGET = {` `` 的**字面提及**（用于说明形态契约）——用不带 `export ` 的串去替换，
    //   会先命中那句注释、而真声明毫发无伤（本用例首版即如此，于是「注入成功」却测不到东西）。
    const bp = join(repo, 'scripts', '_lib', 'doc-budget-reasons.mjs')
    const bOrig = readFileSync(bp, 'utf8')
    assert.ok(bOrig.includes('export const DOC_BUDGET = {'), '夹具前提：真声明形如 `export const DOC_BUDGET = {`')
    writeFileSync(bp, bOrig.replace('export const DOC_BUDGET = {', 'export const DOC_BUDGET_MOVED_AWAY = {'))
    const r1 = run([cc(repo)])
    assert.notEqual(r1.code, 0, '真源缺失必须非 0（旧行为：exit 0 / 静默）')
    assert.match(r1.stdout + r1.stderr, /\[P0 规则失效\]/, '必须报「P0 规则失效」而不是静默跳过')
    assert.match(r1.stdout + r1.stderr, /doc-budget-reasons/, '须点名缺失的真源文件，便于定位')
    writeFileSync(bp, bOrig)

    // 负例 2：`ALWAYS_LIMIT` 缺失（常驻上限的另一个真源）
    const rp = join(repo, 'scripts', 'repo-hygiene-check.mjs')
    const rOrig = readFileSync(rp, 'utf8')
    writeFileSync(rp, rOrig.replace(/const ALWAYS_LIMIT = \d+/, 'const ALWAYS_LIMIT_MOVED_AWAY = 1'))
    const r2 = run([cc(repo)])
    assert.notEqual(r2.code, 0, 'ALWAYS_LIMIT 缺失必须非 0')
    assert.match(r2.stdout + r2.stderr, /ALWAYS_LIMIT/, '须点名 `ALWAYS_LIMIT`')
    writeFileSync(rp, rOrig)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
