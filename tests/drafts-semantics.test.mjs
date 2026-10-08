// `drafts/` 语义目录污染检查（v18.80.1+v · 独立审计批 5 · A10）
//
// **为什么需要**：`references/agents/05-写作-writer.md` 修订轮纪律 ④（v18.79.0）明写
//   「段级 diff 的中间件一律落 `%TEMP%` 或 `<项目>/_tmp/`，**不得写进 `drafts/`**」——
//   因为 `drafts/` 的语义是「正文版本」，而 `build-evidence-bundle.mjs` 靠「`drafts/` 里最高版
//   `初稿-vN.md`」**自动挑选被审正文**；混入 `_t5-probe*/` 会让「**最高版本 = 谁**」依赖命名巧合。
//   **卡里自己写着「用毕自删」，并注明「主控手工清了两次」——手工清两次 = 该规则从未被机械化。**
//   实测（批 5 清点）：`run/test-v18-78-2-县中塌陷/drafts/` 下 `_t5-probe{,2,3}` 共 **6.12 MB / 139 文件**。
//
// 本组用例钉住两态：**有中间件 → 报（且是软、不阻塞）** ／ **只有正文版本与许可项 → 不报**。
// 后一条同样重要：一个会误报的门比没有门更糟（它会训练人忽略它）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

const H = () => join(SCRIPTS, 'handoff-check.mjs')

const mkProj = () => {
  const d = tmp('lunheng-drafts-')
  mkdirSync(join(d, 'drafts'), { recursive: true })
  writeFileSync(join(d, 'drafts', '初稿-v1.md'), '# 初稿\n\n## 摘要\n\n正文。\n')
  writeFileSync(join(d, 'drafts', '修订说明-v1.md'), '# 修订说明\n')
  return d
}
const a10 = (d) => {
  const r = run([H(), '--project', d, '--role', 'T8', '--require-gates', '--summary'])
  const j = parseJson(r)
  return { j, items: [...(j.soft || []), ...(j.hard || [])].filter((x) => x.check === 'A10') }
}

test('W1【核心】：`drafts/` 里有 `_t5-probe/` → 报 A10，且判**软**（不阻塞交付）', () => {
  const d = mkProj()
  try {
    mkdirSync(join(d, 'drafts', '_t5-probe'), { recursive: true })
    writeFileSync(join(d, 'drafts', '_t5-probe', 'scratch.md'), '临时\n')
    const { j, items } = a10(d)
    assert.equal(items.length, 1, '应报 1 条 A10：' + JSON.stringify(j))
    assert.match(items[0].detail, /_t5-probe/, '须点名具体项：' + items[0].detail)
    assert.match(items[0].detail, /正文版本/, '须说明为何该目录不是它该在的地方')
    assert.equal(items[0].severity, 'soft', '判级必须是软：' + items[0].severity)
    assert.notEqual(j.exit, 21, '软提示不得把退出码抬成 21')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('W2【防误报】：只有正文版本 / 修订说明 / 段级diff / 轮次账本 / archive → 不报', () => {
  const d = mkProj()
  try {
    writeFileSync(join(d, 'drafts', '段级diff-v1.md'), '# diff\n')
    writeFileSync(join(d, 'drafts', '轮次账本.md'), '# 轮次账本\n')
    mkdirSync(join(d, 'drafts', 'archive'), { recursive: true })
    const { items } = a10(d)
    assert.equal(items.length, 0, '合规目录不得误报：' + JSON.stringify(items))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('W3：`.tmp` / `.bak` 等中间件残留同样报（不只认 `_` 前缀）', () => {
  const d = mkProj()
  try {
    writeFileSync(join(d, 'drafts', '初稿-v2.md.bak'), '备份\n')
    writeFileSync(join(d, 'drafts', '_t5-apply-v1.ps1'), '脚本\n')
    const { items } = a10(d)
    assert.equal(items.length, 1, '应报 1 条：' + JSON.stringify(items))
    assert.match(items[0].detail, /2 项/, '两条都要列进计数：' + items[0].detail)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
