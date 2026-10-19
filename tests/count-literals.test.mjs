// v19.19.1（架构审计 R4 · 反哺报告 §2.4）：**「M 门 24 项」旧口径不得再出现在 lib/**。
//
// 病灶：真值 = 机检 25 项（`lib/tools.js` 的 M 门 description 与 gate 标签去重同源），
//   但同文件注释、`lib/client.js` 的两处**用户可见**面板文案、`lib/panel.mjs` 注释仍写 24。
//   `consistency-check` 只扫 `.md`，`lib/**` 不在扫描面 → 无人发现。
// 修法：注释改 25；面板文案删掉常量，改为 `{total}` 占位 + `rerun.total` 注入（删掉可漂的东西）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')

test('lib/** 不再残留「24 项」旧口径', () => {
  for (const f of ['tools.js', 'client.js', 'panel.mjs', 'index.js']) {
    assert.ok(!/24 项/.test(read('lib', f)),
      `${f} 仍含「24 项」——真值是机检 25 项（见 lib/tools.js 的 M 门描述）；`
      + '面板文案请改用 {total} 占位，注释改为 25 或去数字')
  }
})

test('面板文案用 {total} 占位，且渲染点注入 rerun.total（不复写常量）', () => {
  const client = read('lib', 'client.js')
  assert.match(client, /'panel\.mgRerunNote':[^\n]*\{total\}/, 'zh mgRerunNote 必须含 {total} 占位')
  assert.match(client, /'panel\.mgSumRerunOnly':[^\n]*\{total\}/, 'zh mgSumRerunOnly 必须含 {total} 占位')
  const uses = [...client.matchAll(/t\('panel\.(mgRerunNote|mgSumRerunOnly)'\)(\.replace\('\{total\}', String\(rerun\.total\)\))?/g)]
  assert.ok(uses.length >= 2, `须能定位两个渲染点，实得 ${uses.length}`)
  for (const m of uses) {
    assert.ok(m[2], `${m[1]} 渲染点必须 .replace('{total}', String(rerun.total))——占位不注入会原样显示 {total}`)
  }
})

test('tools.js 的 M 门注释与描述同口径（25 项）', () => {
  const tools = read('lib', 'tools.js')
  assert.match(tools, /工具 1：M 门机械预检（机检 25 项/, '工具 1 头注释须写机检 25 项')
  assert.match(tools, /25 项脚本判定/, 'description 须保留 25 项脚本判定')
})
