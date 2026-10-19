// v19.19.2：**「schema 里有字段」不等于「值到了 render」**——工具输出面的接线钉。
//
// 病灶（2026-10-19 发布后实测，19.19.1 已注册进 npm 的 P2）：
//   A-3 把 `scopeSource` 加进了 `output.schema`、也加进了 `render` 的首行，但 `execute` 是
//   **逐字段组装**返回对象的 → 脚本 JSON 里明明有 `"scopeSource": "first-h2"`，工具输出里却没有，
//   render 的 `v.scopeSource` 恒 undefined，「起点：」永远不会出现。
//   ⇒ 只测「schema 接受该字段」会全绿；必须测「执行器真的把它取出来」。
//
// 本文件钉两半：① schema 声明；② execute 里对该字段的实际取值（正则指向 `j.scopeSource`）。
// 同族历史：19.19.0 修 `advisories` / `unchecked` / `hardRedLineHits` 时也是同一坑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')

/** 取某个工具的定义块（从 name 到下一个 name 之间）。 */
const toolBlock = (src, name, nextName) => {
  const a = src.indexOf(`name: '${name}'`)
  const b = nextName ? src.indexOf(`name: '${nextName}'`, a) : src.length
  assert.ok(a > 0, `未找到工具 ${name} 的定义`)
  return src.slice(a, b > a ? b : src.length)
}

test('char_count：scopeSource 既在 schema、也在 execute 的取值里（缺一半都不算接上）', () => {
  const block = toolBlock(read('lib', 'tools.js'), 'lunheng_char_count', 'lunheng_handoff_check')
  assert.match(block, /scopeSource: \{ type: 'string'/, 'schema 必须声明该字段（否则 additionalProperties:false 会丢弃）')
  assert.match(block, /j\.scopeSource/, 'execute 必须真的从脚本 JSON 取值（否则 render 恒 undefined）')
})
