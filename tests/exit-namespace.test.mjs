// 退出码命名空间对账器回归网（v18.18.5 新增 · 审计 C-11 机械化）
//
// 为什么需要：纪律要求两处登记退出码——`repo-hygiene-check.mjs` 的 `EXIT_CONTRACT`（机器面）
// 与 `docs/troubleshooting.md` §8「命名空间配额」（人读面）——但两处一直**只靠人工同步**。
// 本仓为「退出码撞义」付过多次代价（把「参数写错」读成「正文有 P1 残留」→ 误触发 T5 修订轮），
// 所以这条不变量值得有机检。
//
// 与审计原文的偏差（如实）：审计设想 §8 是**逐行表**，实测它是**配额散文**，逐行比对无从谈起；
// 本文件钉的是它的等价不变量——「代码实际用到的码集合」==「§8 声明的码集合」，且**双向**查。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseExitContract,
  parseNamespaceQuota,
  reconcile,
  parseScriptHeaderCodes,
  reconcileScriptHeaders,
} from '../scripts/_lib/exit-namespace.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HYGIENE = readFileSync(join(ROOT, 'scripts', 'repo-hygiene-check.mjs'), 'utf8')
const TROUBLE = readFileSync(join(ROOT, 'docs', 'troubleshooting.md'), 'utf8')

test('解析 EXIT_CONTRACT：脚本数与码集合', () => {
  const { scripts, codes } = parseExitContract(HYGIENE)
  assert.ok(scripts >= 20, `EXIT_CONTRACT 脚本数过少（实测 ${scripts}）——正则可能已与源码脱节`)
  // 这几个码是本仓退出口径的承重项，缺任何一个都说明表被改坏了
  for (const c of [0, 1, 2, 3, 10, 70]) assert.ok(codes.includes(c), `EXIT_CONTRACT 应含 M 门族/通用码 ${c}`)
  assert.ok(!codes.includes(99), '不应凭空出现 99')
})

test('解析 §8 命名空间配额：能定位到行并取出码', () => {
  const { line, codes } = parseNamespaceQuota(TROUBLE)
  assert.ok(line > 0, '应定位到「命名空间配额」所在行')
  assert.ok(codes.length >= 5, `§8 解析出的码过少（实测 ${codes.length}）`)
  for (const c of [10, 70]) assert.ok(codes.includes(c), `§8 应声明通用码 ${c}`)
})

test('reconcile：双向差集都能报（漏登记 / 已无人用）', () => {
  assert.deepEqual(reconcile([0, 1, 10], [0, 1, 10]), { onlyInCode: [], onlyInDoc: [] })
  assert.deepEqual(reconcile([0, 1, 10, 55], [0, 1, 10]), { onlyInCode: [55], onlyInDoc: [] })
  assert.deepEqual(reconcile([0, 1, 10], [0, 1, 10, 55]), { onlyInCode: [], onlyInDoc: [55] })
  assert.deepEqual(reconcile([0, 1], [10, 70]), { onlyInCode: [0, 1], onlyInDoc: [10, 70] })
})

test('防空转：表形/段落形状变了必须**响亮抛错**，不得静默通过', () => {
  assert.throws(() => parseExitContract('const NOT_THE_TABLE = {}'), /未找到/, 'EXIT_CONTRACT 块找不到时应抛错')
  assert.throws(() => parseExitContract('const EXIT_CONTRACT = {\n}'), /解析出 0 个脚本/, '解析出 0 个脚本时应抛错')
  assert.throws(() => parseNamespaceQuota('# 没有这一段'), /未找到「命名空间配额」/, '§8 段找不到时应抛错')
  assert.throws(() => parseNamespaceQuota('> 命名空间配额：没有反引号码'), /解析出 0 个码/, '§8 里解析不到码时应抛错')
})

test('真实树：代码侧与 §8 双向一致（本门的存在意义）', () => {
  const { codes: actual } = parseExitContract(HYGIENE)
  const { codes: declared } = parseNamespaceQuota(TROUBLE)
  const { onlyInCode, onlyInDoc } = reconcile(actual, declared)
  assert.deepEqual(onlyInCode, [], `以下退出码已进 EXIT_CONTRACT 但 §8 未登记：${onlyInCode.join(', ')}`)
  assert.deepEqual(onlyInDoc, [], `§8 声明了以下码但 EXIT_CONTRACT 已无人使用：${onlyInDoc.join(', ')}`)
})

// ── ⑧d：脚本**自述**退出码 ↔ 自身契约行（v18.18.12，F-5 机械化）────────────────────
// 动机（实测教训）：`model-routing.mjs` 头部自述「读不到配置 ⇒ 某个码」，而该脚本
// `process.exit(1)` 个数为 0、契约行一直是 `[0,4,10,70]`——那个自述是 v18.12.0 收口前的遗留。
// 调用方按自述去接永远等不到；维护者按自述改会以为那个码还被占着。故机械化成门。
// 单向的理由见 `_lib/exit-namespace.mjs`：`0`/`70` 对每个装了 guard 的脚本都可用、自述常省略，
// 双向会成**假红**（实测 apply-diff / apply-revision-cycle 即此情形）。
test('parseScriptHeaderCodes：取头部自述段、跨行续注、不自述则返回 null', () => {
  const one = parseScriptHeaderCodes('#!/usr/bin/env node\n// 退出码：0 = 通过 / 1 = 有 P1 / 10 = 参数错\nimport x from "y"\n')
  assert.deepEqual(one, { line: 2, codes: [0, 1, 10] }, '应取到首行自述段与码集合')

  const multi = parseScriptHeaderCodes('// 返回码：0 = 三档都有主选；4 = 需人工决定\n//   续注：10 = 用法错 / 70 = 内部错误\ncode()\n')
  assert.deepEqual(multi.codes, [0, 4, 10, 70], '续行注释里的码也应计入（同一自述段）')

  assert.equal(parseScriptHeaderCodes('// 一个不自述退出码的脚本\ncode()\n'), null, '不自述 ⇒ null（合法，跳过）')
})

test('parseScriptHeaderCodes：标记在但码解析不出 ⇒ 响亮抛错（防门静默失效）', () => {
  assert.throws(
    () => parseScriptHeaderCodes('// 退出码：见 troubleshooting §8\ncode()\n'),
    /解析出 0 个码/,
    '有「退出码：」段却解析不出码，必须抛错而不是静默放行',
  )
})

test('reconcileScriptHeaders：只报「自述了产不出的码」，反方向刻意不报（假红防线）', () => {
  // 假红防线：自述 [0,1,10] ⊆ 契约 [0,1,10,70]（70 是 guard 兜底码，自述惯例省略）→ 不得报
  const ok = reconcileScriptHeaders([
    { name: 'a.mjs', allowed: [0, 1, 10, 70], text: '// 退出码：0 = 通过 / 1 = P1 / 10 = 参数错\n' },
  ])
  assert.deepEqual(ok.violations, [], '自述码 ⊆ 契约行时不得报（0/70 省略是惯例，不是缺陷）')

  // 真问题：自述了契约行外的码（= 承诺了本脚本产不出的码）
  const bad = reconcileScriptHeaders([
    { name: 'b.mjs', allowed: [0, 4, 10, 70], text: '// 返回码：0 = 都有主选；4 = 需人工决定；1 = 读不到配置\n' },
  ])
  assert.equal(bad.violations.length, 1, '自述越界码必须报')
  assert.deepEqual(bad.violations[0].extra, [1], '应精确指出越界的那个码')
  assert.equal(bad.violations[0].name, 'b.mjs')

  // 不自述的脚本计入 entries 但不算 checked，也不得报
  const mixed = reconcileScriptHeaders([
    { name: 'c.mjs', allowed: [0, 10], text: '// 没有自述\n' },
    { name: 'd.mjs', allowed: [0, 10], text: '// 退出码：0 = 通过 / 10 = 参数错\n' },
  ])
  assert.equal(mixed.checked, 1, '只有自述了的脚本才计入 checked')
  assert.deepEqual(mixed.violations, [])
})

test('reconcileScriptHeaders：一个自述的脚本都没有 ⇒ 抛错（约定删除 / 解析器脱节）', () => {
  assert.throws(
    () => reconcileScriptHeaders([{ name: 'x.mjs', allowed: [0], text: '// 无自述\n' }]),
    /没有任何随包脚本自述退出码/,
  )
})

test('真实树：全部随包脚本的自述退出码都落在各自契约行内（⑧d 的存在意义）', () => {
  // 独立解析每行契约（`'name.mjs': [0, 4, 10, 70],`），不复用门的实现
  const rows = new Map()
  for (const m of HYGIENE.matchAll(/^\s{2}'([\w.-]+\.mjs)':\s*\[([^\]]*)\]/gm)) {
    rows.set(m[1], m[2].split(',').map((x) => Number(x.trim())).filter(Number.isInteger))
  }
  assert.ok(rows.size >= 20, `契约行解析过少（实测 ${rows.size}）——正则可能已与源码脱节`)

  const dir = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')
  const entries = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const allowed = rows.get(f)
    if (!allowed) continue
    entries.push({ name: f, allowed, text: readFileSync(join(dir, f), 'utf8') })
  }
  const { checked, violations } = reconcileScriptHeaders(entries)
  assert.ok(checked >= 3, `自述退出码的脚本过少（实测 ${checked}）——自述约定可能被删，本门会静默失效`)
  assert.deepEqual(
    violations.map((v) => `${v.name}:${v.line} 越界 ${v.extra.join(',')}（契约 ${v.allowed.join('/')}）`),
    [],
    '这些脚本头部自述了自身契约行外的退出码（承诺了产不出的码）',
  )
})
