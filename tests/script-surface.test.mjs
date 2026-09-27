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

test('**词表回归**：`writeReport` 必须算「写内容」（v18.29.1 补漏）', () => {
  // 本模块第一版词表收了 `writeWithSafety` 却**漏了 `writeReport`**——而 `writeReport` 才是
  // `--report` 的唯一写盘出口（`_lib/destructive-write.mjs`，内部转 `writeWithSafety`）。
  // 后果：9 个只经它写报告的脚本被 ⑧c 算成「只读」→ SECURITY.md 低报执行面。
  // 讽刺的是「低报执行面」正是本模块开头写明的、它要防的那类失真：**门也会犯它要抓的错**，
  // 故这条用例是补漏的**反向自证**——删掉词表里那一行，本用例立刻红。
  const r = withScripts(
    {
      'report-only.mjs': 'import { writeReport } from "./_lib/destructive-write.mjs"\nwriteReport("r.json", "x")\n',
      'mkdir-only.mjs': 'import { mkdirSync } from "node:fs"\nmkdirSync("d", { recursive: true })\n',
    },
    (dir) => deriveScriptSurface(dir),
  )
  assert.deepEqual(r.writeContent, ['report-only.mjs'], '只调 writeReport 的脚本属于「写内容」，不得落入「只读」')
  assert.deepEqual(r.mkdirOnly, ['mkdir-only.mjs'], '只调 mkdirSync 的脚本仍归「仅建目录」——两档不得混')
  assert.deepEqual(r.readOnly, [], '两档各一，无只读脚本')
})

test('真实树：写内容面必须覆盖所有 `--report` 写盘脚本（口径钉在真源上）', () => {
  // 上一条是 fixture 级；这条钉真源：真源里 `writeReport(` 的**顶层**调用者必须全在写内容面。
  const r = deriveScriptSurface(SCRIPTS)
  const callers = r.all.filter((f) => /(?<![\w.])writeReport\s*\(/.test(readFileSync(join(SCRIPTS, f), 'utf8')))
  assert.ok(callers.length >= 10, `真源里 writeReport 调用者过少（实测 ${callers.length}）——断言会退化成恒真`)
  for (const f of callers) {
    assert.ok(r.writeContent.includes(f), `${f} 调了 writeReport 却不在写内容面——词表漏项（低报执行面）`)
  }
})

test('解析 SECURITY.md：三档清单能取出，且缺 marker 时**响亮抛错**', () => {
  const d = parseSecuritySurface(SECURITY)
  assert.ok(d.spawn.includes('apply-compression-cycle.mjs'), '子进程面应含 apply-compression-cycle.mjs（C-7 的事主）')
  assert.ok(d.writeContent.includes('build-evidence-bundle.mjs'), '写内容面应含 build-evidence-bundle.mjs（10 处写盘）')
  assert.ok(d.writeContent.includes('m-gate-check.mjs'), '写内容面应含 m-gate-check.mjs（v18.29.1 起：其写面走 writeReport）')
  // 仅建目录面在 v18.29.1 后**合法为空**（原先两个只 mkdirSync 的脚本改用 writeReport 后升档到写内容）。
  // 这里刻意**不再断言它非空**——那会逼后来者为了「让门绿」往文档里塞一个源码没有的脚本名，
  // 正是本门要防的清单注水。非空性改由「并集恰好覆盖全部脚本」这条真实不变量守住（见下一条用例）。
  assert.ok(Array.isArray(d.mkdirOnly), '仅建目录面应能解析出（可为空数组）')
  assert.ok(
    d.spawn.length + d.writeContent.length + d.mkdirOnly.length >= 15,
    `三档解析结果合计过少（实测 ${d.spawn.length + d.writeContent.length + d.mkdirOnly.length}）——解析退化会让对账恒真`,
  )

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
