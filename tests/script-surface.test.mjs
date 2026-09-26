// 随包脚本「执行面/写盘面」派生器回归网（v18.18.8 新增 · 审计 C-7）
//
// 为什么需要：`SECURITY.md` 是操作者安装前的**信任边界依据**，其中一段手写维护着
// 「哪些随包脚本会写盘 / 会派生子进程」。手写的代码事实清单在本仓反复出错
// （C-1 工具数 / D-1 发布面负清单 / C-11 退出码表 / C-7 本次，同族），且失真方向
// 几乎总是**低报执行面**（把会写盘的脚本说成只读）。本文件钉住派生器本身。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveScriptSurface, parseSecuritySurface, reconcileSurface } from '../scripts/_lib/script-surface.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')
const SECURITY = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8')

/** 用临时目录造最小 scripts 树，验证派生口径（而非只测真源）。 */
function withScripts(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'surface-'))
  try {
    for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('派生口径：子进程 / 写内容 / 仅建目录 三档互斥且覆盖全部', () => {
  const r = withScripts(
    {
      'a.mjs': 'import { spawnSync } from "node:child_process"\nspawnSync("node", ["x"])\n',
      'b.mjs': 'import { writeFileSync } from "node:fs"\nwriteFileSync("x", "y")\n',
      'c.mjs': 'import { mkdirSync } from "node:fs"\nmkdirSync("d", { recursive: true })\n',
      'd.mjs': 'export const x = 1\n',
      'e.mjs': 'import { mkdirSync, writeFileSync } from "node:fs"\nmkdirSync("d")\nwriteFileSync("x", "y")\n',
    },
    (dir) => deriveScriptSurface(dir),
  )
  assert.deepEqual(r.spawn, ['a.mjs'])
  assert.deepEqual(r.writeContent, ['b.mjs', 'e.mjs'], '同时 mkdir + 写内容的脚本应归入「写内容」而非「仅建目录」')
  assert.deepEqual(r.mkdirOnly, ['c.mjs'])
  assert.deepEqual(r.readOnly, ['d.mjs'])
  assert.equal(r.all.length, 5, '三档 + 只读 应恰好覆盖全部脚本，不重不漏')
})

test('**误报回归**：`RegExp.prototype.exec()` 不得被当成派生子进程', () => {
  // 本模块第一版用 /\bexec\s*\(/，把 re.exec(s) 全算成 spawn——12 个脚本里 9 个误报。
  // 「子进程面」是安全描述，一次误报就让整段失去可信度，故钉住这个口径。
  const r = withScripts({ 're.mjs': 'const re = /x/g\nconst m = re.exec("x")\nconst n = str.matchAll(/y/g)\n' }, (dir) =>
    deriveScriptSurface(dir),
  )
  assert.deepEqual(r.spawn, [], '`re.exec(...)` 是正则方法调用，不是子进程')
  assert.deepEqual(r.readOnly, ['re.mjs'])
})

test('派生真源：三档数量与只读数量自洽（防空转）', () => {
  const r = deriveScriptSurface(SCRIPTS)
  assert.ok(r.all.length >= 20, `顶层随包脚本过少（实测 ${r.all.length}）——目录扫错会让本断言恒真`)
  const union = new Set([...r.spawn, ...r.writeContent, ...r.mkdirOnly, ...r.readOnly])
  assert.equal(union.size, r.all.length, '四类之并集应恰好等于全部脚本（既不重、也不漏）')
  assert.ok(r.spawn.length > 0 && r.writeContent.length > 0, '真源里应至少各有 1 个——否则断言退化')
})

test('解析 SECURITY.md：三档清单能取出，且缺 marker 时**响亮抛错**', () => {
  const d = parseSecuritySurface(SECURITY)
  assert.ok(d.spawn.includes('apply-compression-cycle.mjs'), '子进程面应含 apply-compression-cycle.mjs（C-7 的事主）')
  assert.ok(d.writeContent.includes('build-evidence-bundle.mjs'), '写内容面应含 build-evidence-bundle.mjs（10 处写盘）')
  assert.ok(d.mkdirOnly.length > 0, '仅建目录面应非空')

  // 防空转：marker 缺失必须抛错，不得退化为「切到行尾」——第一版就是这样把三档混成一份的。
  // 断言「抛的是 marker 类错误」而非某个具体 marker：fixture 里写死 marker 字面量会互相干扰
  // （第一版就踩了两次：fixture 里带了「写文件面标记」字样，于是先命中了下一个 marker）。
  const markerError = /找不到(起始|结束)标记/
  assert.throws(
    () => parseSecuritySurface('| 随包脚本 | 子进程面：`a.mjs` 到此为止 |'),
    markerError,
    '结束 marker 缺失时应抛错（而不是切到行尾）',
  )
  assert.throws(
    () => parseSecuritySurface('| 随包脚本 | 子进程面：`a.mjs` x `b.mjs` y |'),
    markerError,
    '后续 marker 缺失时同样应抛错',
  )
  assert.throws(() => parseSecuritySurface('| 无关行 |'), /未找到/, '没有该行时应抛错')
})

test('reconcile：双向差集都能报', () => {
  const base = { spawn: ['a.mjs'], writeContent: ['b.mjs'], mkdirOnly: ['c.mjs'] }
  const d1 = reconcileSurface(base, base)
  assert.deepEqual(
    Object.values(d1).flatMap((x) => [x.onlyDerived, x.onlyDoc]),
    [[], [], [], [], [], []],
  )
  const d2 = reconcileSurface({ ...base, spawn: ['a.mjs', 'z.mjs'] }, base)
  assert.deepEqual(d2.spawn.onlyDerived, ['z.mjs'])
  const d3 = reconcileSurface(base, { ...base, writeContent: ['b.mjs', 'ghost.mjs'] })
  assert.deepEqual(d3.writeContent.onlyDoc, ['ghost.mjs'])
})

test('已知边界：换名字的 import 绕过本扫描（写成用例，免得后来者以为是缺陷）', () => {
  // 本模块是**按 API 名字的静态扫描**，不是 AST。故取别名就绕过——这是**刻意记录的边界**：
  // 把它写成用例，是为了（a）口径诚实；（b）将来若真要做 AST 版本，这条会先红、提醒改文档。
  const r = withScripts({ 'alias.mjs': 'import { writeFileSync as w } from "node:fs"\nw("x", "y")\n' }, (dir) =>
    deriveScriptSurface(dir),
  )
  assert.deepEqual(r.writeContent, [], '别名调用扫不到——这是已知边界')
  assert.deepEqual(r.readOnly, ['alias.mjs'], '在本口径下它落入「只读」——文档的免责边界需覆盖此情形')
})

test('真实树：源码派生面与 SECURITY.md 声明双向一致（本门的存在意义）', () => {
  const { spawn, writeContent, mkdirOnly, onlyDoc } = (() => {
    const s = deriveScriptSurface(SCRIPTS)
    const p = parseSecuritySurface(SECURITY)
    const d = reconcileSurface(s, p)
    return { spawn: d.spawn, writeContent: d.writeContent, mkdirOnly: d.mkdirOnly, onlyDoc: null }
  })()
  for (const [label, v] of Object.entries({ 子进程面: spawn, 写内容面: writeContent, 仅建目录: mkdirOnly })) {
    assert.deepEqual(v.onlyDerived, [], `${label}：源码里新出现的脚本未写进 SECURITY.md → ${v.onlyDerived.join(', ')}`)
    assert.deepEqual(v.onlyDoc, [], `${label}：SECURITY.md 列了但源码已无该能力 → ${v.onlyDoc.join(', ')}`)
  }
})
