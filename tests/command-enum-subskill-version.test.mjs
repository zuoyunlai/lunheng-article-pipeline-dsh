// 命令枚举缺项（规则 ㉕ 扩展）+ 子技能版本一致性（规则 ㉖）—— 全量审计 P1-①/P1-② 的机械化回归。
//
// 背景：v18.7.1 把 lunheng-commands 从独立包嵌入论衡 bundle 时，升了 SKILL.md/command-routing/route-command
//   三处版本与命令清单，却漏了 package.json + README.md 两处 → 1.0.0/1.0.1 漂移与「声称 11 命令只列 10」
//   （缺 -stats）存活到 v18.20.0。旧规则 ㉕ 只核对「N 个」这个数字字面量（数字 11 是对的、枚举 10 项是漏的），
//   规则 ① 只对账主包 18.x 版本（子技能 1.0.x 无人管）——两条盲区正是本用例要钉死的。
// 断言口径（沿用 batch12 教训）：只断「本规则自己的输出」，不断全局 exit —— 夹具仓可能因无关规则报错
//   而 exit 1，断言 exit 会测到别的规则。负向断「该报却没报」、正向断「不该报却报」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkRepo, run } from './_fixtures.mjs'

const ccPath = (repo) => join(repo, 'skills', 'lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')

test('㉖ 子技能版本漂移：package.json version 改回 1.0.0 → 必须报 P1', () => {
  const { d, repo } = mkRepo()
  const pkg = join(repo, 'skills', 'lunheng-commands', 'package.json')

  const before = run([ccPath(repo)], { cwd: d })
  assert.ok(!/子技能版本漂移/.test(before.out), `基线不该报子技能版本漂移：\n${before.out.slice(-400)}`)

  writeFileSync(pkg, readFileSync(pkg, 'utf8').replace('"version": "1.0.1"', '"version": "1.0.0"'))
  const after = run([ccPath(repo)], { cwd: d })
  assert.equal(after.code, 1, `注入漂移后应 exit 1，实得 ${after.code}`)
  assert.match(after.out, /子技能版本漂移/, `漏了 package.json 版本漂移却未点名：\n${after.out.slice(-400)}`)
})

test('㉖ 子技能版本缺失：package.json 删掉 version 行 → 必须报 P1', () => {
  const { d, repo } = mkRepo()
  const pkg = join(repo, 'skills', 'lunheng-commands', 'package.json')

  const src = readFileSync(pkg, 'utf8')
  assert.ok(/"version"\s*:\s*"1\.0\.1"/.test(src), '夹具 package.json 应含 version 1.0.1')
  writeFileSync(pkg, src.replace(/\n\s*"version"\s*:\s*"[^"]+",/, ''))

  const after = run([ccPath(repo)], { cwd: d })
  assert.equal(after.code, 1)
  assert.match(after.out, /子技能版本缺失/, `删了 version 行却未点名缺失：\n${after.out.slice(-400)}`)
})

test('㉕ 命令枚举缺项：README 代码块删掉 -stats → 必须报 P1（数字对、清单漏的盲区）', () => {
  const { d, repo } = mkRepo()
  const readme = join(repo, 'skills', 'lunheng-commands', 'README.md')

  const before = run([ccPath(repo)], { cwd: d })
  assert.ok(!/命令枚举缺项/.test(before.out), `基线不该报命令枚举缺项：\n${before.out.slice(-400)}`)

  const src = readFileSync(readme, 'utf8')
  assert.ok(src.includes('/lunheng -stats'), '夹具 README 应含 -stats 行（本次修复点）')
  writeFileSync(readme, src.replace(/\/lunheng -stats[^\n]*\n/, ''))

  const after = run([ccPath(repo)], { cwd: d })
  assert.equal(after.code, 1, `注入缺项后应 exit 1，实得 ${after.code}`)
  assert.match(after.out, /命令枚举缺项[\s\S]*-\s*stats/, `漏了 -stats 却未点名：\n${after.out.slice(-400)}`)
})

test('㉕ 命令枚举缺项：package.json description 删掉 -stats → 必须报 P1（JSON 枚举盲区）', () => {
  const { d, repo } = mkRepo()
  const pkg = join(repo, 'skills', 'lunheng-commands', 'package.json')

  const src = readFileSync(pkg, 'utf8')
  assert.ok(src.includes('-status/-stats/-help'), '夹具 package.json description 应含 -stats（本次修复点）')
  writeFileSync(pkg, src.replace('-status/-stats/-help', '-status/-help'))

  const after = run([ccPath(repo)], { cwd: d })
  assert.equal(after.code, 1)
  assert.match(after.out, /命令枚举缺项[\s\S]*-\s*stats/, `package.json 枚举漏 -stats 却未点名：\n${after.out.slice(-400)}`)
})
