// v18.65.0（反哺报告-v5 §v5.4-1 的 D1）：**角色最小权限（负向清单）**回归。
//
// 为什么必须钉「不是机制强制」这句话：本仓对**过度声明**有明文禁令（`maintainers.md` §二：guard 都比机制强制弱，
//   不许夸大）。而 `SKILL.md:28` 已写死「DSH **无技能级工具白名单 / denied**」——若只写「T7 不得改正文」
//   而不写这一层，读者（尤其是下一个维护者）会把它读成「已经隔离了」，那是**比没有清单更坏**的形态。
//   故本文件把「清单在 + 性质声明在」两件事一起钉住：清单没了 → 边界失守；性质声明没了 → 变成假隔离声明。
// 运行：node --test tests/role-least-privilege.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './_fixtures.mjs'

const SKILL = join(ROOT, 'skills', 'lunheng-article-pipeline')
const CARDS = {
  T7: join(SKILL, 'references', 'agents', '07-审计-auditor.md'),
  T8: join(SKILL, 'references', 'agents', '08-终检-finalizer.md'),
  T9: join(SKILL, 'references', 'agents', '09-审稿-peer-reviewer.md'),
}
const README = join(SKILL, 'references', 'pipeline-readme.md')

test('三张判读卡各有一节「最小权限」，且**逐卡写明「提示词层、非机制强制」**（防假隔离声明）', () => {
  for (const [role, p] of Object.entries(CARDS)) {
    assert.ok(existsSync(p), `${role} 卡不存在：${p}`)
    const t = readFileSync(p, 'utf8')
    assert.match(t, /## 🚫 最小权限/, `${role} 卡缺「最小权限」节`)
    assert.match(t, /非机制强制|不是机制强制/, `${role} 卡缺「非机制强制」性质声明——只写禁令会被读成已隔离`)
    assert.match(t, /无技能级白名单|无技能级工具白名单/, `${role} 卡必须引用「DSH 无技能级白名单」这条事实（否则声明无出处）`)
    assert.match(t, /越界/, `${role} 卡缺「越界须自陈」的动作（清单只有禁令没有处置 = 不完整）`)
  }
})

test('共享真源在场：`pipeline-readme.md` 有「角色 × 工具面：负向清单」且四类角色都有行', () => {
  const t = readFileSync(README, 'utf8')
  assert.match(t, /角色 × 工具面：\*\*负向清单\*\*/, '缺共享真源小节')
  for (const row of ['T7 审计', 'T8 终检', 'T9 审稿', '全部子代理']) {
    assert.ok(t.includes(row), `负向清单缺「${row}」这一行`)
  }
  // 性质声明必须在共享真源里也出现（卡上只有一句，主控/维护者读的是这张表）
  assert.match(t, /不是机制强制/, '共享真源缺性质声明')
})

test('反向钉：不得把该清单写成「已隔离 / 已强制」（本仓对过度声明的禁令）', () => {
  // ⚠️ 只禁**肯定式**声称：「不得把它读成『已隔离』」是**禁令本身**，含「已隔离」三个字是合法的
  //   （第一版正则把禁令也判违规 → 假阳性；这条修正本身就是「钉得准」的例子）。
  const POSITIVE_CLAIM = /视为已隔离|算作已隔离|即已隔离|已经隔离|已强制隔离|工具层会拦你/
  for (const p of Object.values(CARDS)) {
    const t = readFileSync(p, 'utf8')
    const at = t.indexOf('## 🚫 最小权限')
    const seg = at >= 0 ? t.slice(at, at + 900) : ''
    assert.ok(seg, `未找到最小权限小节：${p}`)
    assert.ok(!POSITIVE_CLAIM.test(seg), `本小节不得做**肯定式**的隔离声明：${p}`)
    assert.match(seg, /非机制强制/, `本小节必须自带性质声明：${p}`)
  }
  const t = readFileSync(README, 'utf8')
  const seg = t.slice(t.indexOf('角色 × 工具面：**负向清单**'), t.indexOf('## 👤 主人侧三件套'))
  assert.ok(seg.includes('不是机制强制'), '共享真源小节必须自带性质声明')
  assert.ok(!POSITIVE_CLAIM.test(seg), '共享真源小节不得做肯定式的隔离声明')
})
