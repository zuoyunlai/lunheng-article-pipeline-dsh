// `lib/**:LINE` 裸行号引用检测器回归网（v18.18.9 新增 · 审计 C-9）
//
// 为什么需要：审计 C-9 实测 `SECURITY.md` 引 `lib/tools.js:18,24,133,191`，四行全都不是它说的东西。
// 该处改成符号引用后，**同一份文档就地写下了政策**「按符号引用，不写绝对行号」——**但政策没有门**：
// v18.18.9 复核发现隔壁那行仍写着 `lib/guard.js:177`，而该行是 `const cwd = process.cwd()`。
// 本文件钉住检测器的**两个方向**：该抓的必须抓，不该抓的绝不能抓（误报会让政策失去可信度）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findLibLineRefs, isHistoricalDoc } from '../scripts/_lib/lib-line-refs.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('命中：本仓 lib/**.js 的裸行号引用', () => {
  assert.deepEqual(findLibLineRefs('见 `lib/guard.js:177`。').map((h) => h.raw), ['lib/guard.js:177'])
  assert.deepEqual(findLibLineRefs('`lib/index.js:13,37,42`').map((h) => h.raw), ['lib/index.js:13'])
  assert.deepEqual(findLibLineRefs('lib/tools.js:31 是真调用').map((h) => h.raw), ['lib/tools.js:31'])
})

test('**不命中**：上游包路径 / 非本仓 lib / 非 .js / 无行号', () => {
  const ok = [
    '栈顶 `dsh-app-boot/lib/index.js:1112`', // 上游包——路径前缀是 `/`，不是本仓
    '`@deepseek-ai/dsh-tool-skill/lib/index.js:40`',
    '`mylib/x.js:1`', // 边界：`lib` 前是词字符
    '`lib/guard.js`', // 无行号
    '`lib/notes.md:12`', // 非 .js
    '`scripts/repo-hygiene-check.mjs:334`', // 不是 lib/
  ]
  for (const s of ok) assert.deepEqual(findLibLineRefs(s), [], `误报：${s}`)
})

test('历史留痕豁免**按目录声明**（不是「凡引用都放过」）', () => {
  for (const p of ['CHANGELOG.md', 'audits/反哺报告-v1.md', 'docs/审计与修订记录/论衡插件-修订记录-v18.2.7.md']) {
    assert.ok(isHistoricalDoc(p), `${p} 应判为历史留痕`)
  }
  for (const p of ['SECURITY.md', 'README.md', 'docs/usage.md', 'docs/troubleshooting.md', 'skills/lunheng-article-pipeline/references/glossary.md']) {
    assert.ok(!isHistoricalDoc(p), `${p} 是**当前**文档，不该豁免`)
  }
})

test('真实树：当前文档零裸行号引用，且历史留痕确实含引用（证明豁免不是空跑）', () => {
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '_backup') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full, out)
      else if (/\.(md|html)$/.test(e.name)) out.push(relative(ROOT, full).split(sep).join('/'))
    }
    return out
  }
  const docs = walk(ROOT)
  assert.ok(docs.length > 50, `扫到的文档过少（实测 ${docs.length}）——扫描退化会让本断言恒真`)

  const currentHits = []
  let historicalWithRefs = 0
  for (const p of docs) {
    const hits = findLibLineRefs(readFileSync(join(ROOT, p), 'utf8'))
    if (!hits.length) continue
    if (isHistoricalDoc(p)) historicalWithRefs++
    else currentHits.push(`${p} → ${hits[0].raw}`)
  }
  assert.deepEqual(currentHits, [], `当前文档仍有裸行号引用（应改为符号引用）：\n${currentHits.join('\n')}`)
  assert.ok(
    historicalWithRefs > 0,
    '历史留痕里一处裸行号都没有——说明豁免规则**从未被走到**，本用例的豁免部分等于空跑（真实情况下历史记录应当留有引用）',
  )
})
