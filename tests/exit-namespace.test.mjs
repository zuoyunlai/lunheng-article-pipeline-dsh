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
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseExitContract, parseNamespaceQuota, reconcile } from '../scripts/_lib/exit-namespace.mjs'

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
