// v19.19.1（架构审计 R2 · 反哺报告 §2.2）：**面板路由必须在披露面逐条出现**。
//
// 病灶：`/plugin-info`（v19.18.0 新增）是默认开启面板里**唯一读 run/ 之外**的端点，
//   却三处披露全缺（SECURITY.md / docs/architecture.md / 运行面板-读面明细.md），
//   而 404 枚举还是手写串（漏 /file 与 /plugin-info）。
// 本文件把「新增暴露面必须披露」从纪律变成门：路由表 == 源码分支；每条路由都在披露文档里。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROOT } from './_fixtures.mjs'

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')

test('PANEL_ROUTES 与源码分支逐一相等，且 404 文案由它派生', () => {
  const src = read('lib', 'panel.mjs')
  const branches = [...new Set([...src.matchAll(/rest === '([^']+)'/g)].map((m) => m[1]))].sort()
  assert.deepEqual(branches, ['/events', '/file', '/ping', '/plugin-info', '/projects', '/snapshot'],
    '源码里的面板分支变了——请同批更新披露面与本用例')

  const table = /export const PANEL_ROUTES = Object\.freeze\(\[([^\]]+)\]\)/.exec(src)
  assert.ok(table, 'PANEL_ROUTES 必须存在（路由唯一真源）')
  const listed = [...table[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(listed, branches, 'PANEL_ROUTES 必须与源码分支逐一相等')
  assert.match(src, /PANEL_ROUTES\.join\(' '\)/, '404 文案必须从 PANEL_ROUTES 派生，不得手写枚举')
})

test('每条路由都在 SECURITY.md 与 docs/architecture.md 披露', () => {
  const src = read('lib', 'panel.mjs')
  const routes = [...new Set([...src.matchAll(/rest === '([^']+)'/g)].map((m) => m[1]))]
  const security = read('SECURITY.md')
  const arch = read('docs', 'architecture.md')
  for (const r of routes) {
    assert.ok(security.includes(r), `SECURITY.md 缺端点披露：${r}（新增暴露面必须同批登记）`)
    assert.ok(arch.includes(r), `docs/architecture.md 的暴露面表缺：${r}`)
  }
})

test('读面明细登记 /plugin-info（唯一读 run/ 之外的端点）并声明其边界', () => {
  const detail = read('skills', 'lunheng-article-pipeline', 'references', '_shared', '运行面板-读面明细.md')
  assert.ok(detail.includes('/plugin-info'), '读面明细必须点名 /plugin-info')
  assert.match(detail, /唯一例外|唯一读面/, '「不读 run/ 之外」必须标注 /plugin-info 这一例外')
  assert.match(detail, /cordis\.patch\.yml/, '必须写明它读 profile 的 cordis.patch.yml（否则「不读项目外」是假断言）')
})
