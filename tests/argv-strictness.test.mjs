// v18.12.0（2026-09-25 全量审计第四梯队 L-62 / L-66）：**参数严格性**回归。
//
// 教训（脚本线 S-15 实测）：10 处入口绕过 `_lib/cli-args.mjs`，后果全是「静默降级」——
//   · `normalize-trust-level 卡.md --wrtie`（拼错）→ **dry-run 跑完 exit 0**，用户以为已落盘（而它是
//     唯一改写素材卡的脚本）；
//   · `handoff-check --report --summary` → `--summary` 被当成 `--report` 的值吃掉 → **产物侧整段静默跳过**；
//   · `cite/structure/methodology/journal/meta --report`（缺值）→ 不落盘却 exit 0；
//   · `pdfcheck a.pdf b.pdf` → 多余参数被静默忽略；
//   · `consistency-check --nope` → exit **1**（与「文档真漂移」撞码，主控无法区分改命令还是改文档）；
//   · `consistency-check --write`（单独）→ 被白名单接受却静默空转。
// 现统一：**参数/路径错一律 exit 10**（AGENTS.md 已明令），缺值/未知旗标/多余参数都不再静默。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'

const S = (n) => join(SCRIPTS, n)

test('L-62 normalize-trust-level：拼错旗标必须 exit 10（旧版按 dry-run 跑完 exit 0，用户以为已落盘）', () => {
  const dir = tmp('lunheng-argv-')
  const card = join(dir, '数据卡.md')
  writeFileSync(card, '# 数据卡\n\n[D01] 值 | 机构 | 2024 | url\n      ├ 信任级别：已发布\n')
  try {
    const r = run([S('normalize-trust-level.mjs'), card, '--wrtie'])
    assert.equal(r.code, 10, '拼错旗标必须 exit 10：' + r.out + r.err)
    assert.match(String(r.err || r.out), /未知参数/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-62 handoff-check：`--report --summary` 缺值必须 exit 10（旧版把 --summary 当值吃掉）', () => {
  const r = run([S('handoff-check.mjs'), '--report', '--summary'])
  assert.equal(r.code, 10, '`: ' + r.out + r.err)
  assert.match(String(r.err || r.out), /缺少值/)
})

test('L-62 五个检查类脚本：`--report` 缺值必须 exit 10（旧版不落盘却 exit 0）', () => {
  const dir = tmp('lunheng-argv-')
  const f = join(dir, '定稿.md')
  writeFileSync(f, '# 标题\n\n## 摘要\n\n正文。\n\n## 参考文献\n\n[L01] x\n')
  try {
    for (const s of ['cite-coverage-check.mjs', 'structure-check.mjs', 'methodology-check.mjs']) {
      const r = run([S(s), f, '--report'])
      assert.equal(r.code, 10, `${s} 缺值应 exit 10：` + r.out + r.err)
      assert.match(String(r.err || r.out), /缺少值/)
    }
    const rj = run([S('journal-fit.mjs'), '社会学研究', '--project'])
    assert.equal(rj.code, 10, 'journal-fit --project 缺值应 exit 10：' + rj.out + rj.err)
    const rm = run([S('meta-synthesize.mjs'), dir, '--trigger'])
    assert.equal(rm.code, 10, 'meta-synthesize --trigger 缺值应 exit 10：' + rm.out + rm.err)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-62 pdfcheck：多余参数必须 exit 10（旧版静默忽略）', () => {
  const dir = tmp('lunheng-argv-')
  const a = join(dir, 'a.pdf'); const b = join(dir, 'b.pdf')
  mkdirSync(dir, { recursive: true })
  writeFileSync(a, '%PDF-1.4\n')
  writeFileSync(b, '%PDF-1.4\n')
  try {
    const r = run([S('pdfcheck.mjs'), a, b])
    assert.equal(r.code, 10, '多余参数应 exit 10：' + r.out + r.err)
    assert.match(String(r.err || r.out), /多余/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('L-62 consistency-check：未知参数 exit 10（旧版给 1，与「文档真漂移」撞码）', () => {
  const r = run([S('consistency-check.mjs'), '--nope'])
  assert.equal(r.code, 10, '参数错应 10：' + r.out + r.err)
})

test('L-66 consistency-check：`--write` 单独给出必须 exit 10（旧版静默空转）', () => {
  const r = run([S('consistency-check.mjs'), '--write'])
  assert.equal(r.code, 10, '--write 单独应 exit 10：' + r.out + r.err)
  assert.match(String(r.err || r.out), /必须与 --fix 同用/)
})
