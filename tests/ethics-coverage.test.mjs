// 未覆盖形态探测器回归测试（v19.27.21 · 第三方全量审计-2026-11-19 §P1-2 ①）
//
// 为什么必须有这一条：第三方审计在真机上把脱敏函数喂边界样本，实测 **5 类形态一律原样返回
//   且计数为 0**，而 H2 标记只报「命中替换 N 处」——于是「0」与「干净」在输出上长得一样。
//   本文件钉的是：**这些形态必须至少变成一条可核事实**（uncovered 计数 + reviewFlags）。
//
// 三个断言面，缺一不可：
//   ① 召回：审计点名的样本必须被探测到（否则修复没落地）；
//   ② 不改写：探测**绝不**改正文（否则重演「静默损坏正文」——本仓最贵的缺陷形态）；
//   ③ 不误报：普通中文技术文本不得凭空报出未覆盖形态（否则噪声复发，等同没修）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectUncovered, UNCOVERED_KINDS, UNCOVERED_WHY } from '../lib/ethics-coverage.js'
import { sanitize, loadDicts } from '../lib/ethics-sanitize.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const SKILL_DIR = join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline')

/** 审计 §P1-2 的边界样本（真机实测为「原样返回、计数 0」的那几行）。 */
const AUDIT_SAMPLES = Object.freeze([
  { kind: 'idn-email', text: '邮箱 张三@例子.中国' },
  { kind: 'passport-like', text: '护照 E12345678' },
  { kind: 'street-address', text: '住址：海淀区中关村南大街5号院3号楼802室' },
  { kind: 'im-account', text: '微信 wxid_abcdef123' },
  { kind: 'im-account', text: 'QQ 123456789' },
  { kind: 'plate', text: '车牌 京A12345' },
])

test('① 召回：审计点名的 5 类未覆盖形态必须被探测到', () => {
  for (const s of AUDIT_SAMPLES) {
    const r = detectUncovered(s.text)
    assert.ok(r.counts[s.kind] > 0,
      `未探测到 ${s.kind}：输入「${s.text}」→ ${JSON.stringify(r.counts)}`
        + '。若确属无法探测的形态，请从 AUDIT_SAMPLES 移除并在报告里登记——不得让样本静默失效。')
  }
})

test('② 不改写：detectUncovered 是纯探测，不返回也不修改任何正文', () => {
  const src = '住址：海淀区中关村南大街5号院3号楼802室，护照 E12345678，车牌 京A12345'
  const before = String(src)
  const r = detectUncovered(src)
  assert.equal(src, before, '入参不得被修改')
  assert.equal(Object.keys(r).sort().join(','), 'counts,hits', '返回值只应有 counts/hits 两个键——出现 text 就说明它在改写')
})

test('③ 不误报：普通中文技术文本不得报出未覆盖形态', () => {
  // 本仓真实技术文本的高频形态：版本号、行号、指标、Gate 名、代码标识符。
  const clean = [
    'v19.27.21 修复了 M-Form-6 与 M-Exist-5 的一致性，机检 25 项、上限 60416 B。',
    '见 lib/index.js 的 CONFIG_SPEC（共 11 键）与 tests/guard-config.test.mjs。',
    '执行 npm test 后 1450 例通过，耗时 106.7 s；exit code 0。',
    '第 3 章第 2 节讨论了 1998 年与 2026 年的口径差异。',
  ].join('\n')
  const r = detectUncovered(clean)
  assert.deepEqual(r.counts, {},
    `普通技术文本被误报 ${JSON.stringify(r.counts)}——这会让标记重新变成每读必响的噪声（v18.80.1 B14-③ 的复发形态）`)
})

test('④ 集成：sanitize 把未覆盖形态放进 uncovered 与 reviewFlags（且不进 counts）', () => {
  const dicts = loadDicts(SKILL_DIR)
  const r = sanitize('联系 13812345678，护照 E12345678，住址 5号院3号楼802室', { mode: 'basic', dicts })
  assert.ok(r.uncovered && typeof r.uncovered === 'object', '返回值必须有 uncovered 对象')
  assert.ok(r.uncovered['passport-like'] > 0, `uncovered 应含 passport-like，实际 ${JSON.stringify(r.uncovered)}`)
  assert.ok(r.uncovered['street-address'] > 0, `uncovered 应含 street-address，实际 ${JSON.stringify(r.uncovered)}`)
  // **结构性**约束：uncovered 的键不得污染 counts（counts 的每个键都会被 H2 当替换数打印）
  const polluted = UNCOVERED_KINDS.filter((k) => Object.hasOwn(r.counts, k))
  assert.deepEqual(polluted, [], `counts 不得含未覆盖形态键 ${JSON.stringify(polluted)}——那会被读成「替换了 N 处」`)
  const flags = r.reviewFlags.filter((f) => f.kind === 'uncovered-kind')
  assert.ok(flags.length >= 2, `reviewFlags 应至少登记 2 条 uncovered-kind，实际 ${flags.length}`)
  // 每条都要带 kind 与说明（人读面靠它，不得只有数字）
  for (const f of flags) {
    assert.ok(UNCOVERED_KINDS.includes(f.uncoveredKind), `uncoveredKind 必须是已知 kind，实际 ${f.uncoveredKind}`)
    assert.ok(f.detail && f.detail.length > 10, 'detail 必须可读（含计数与原因）')
  }
})

test('⑤ 每个 kind 都有 why 文案（标记与 render 依赖它，缺了就是空说明）', () => {
  for (const k of UNCOVERED_KINDS) {
    assert.equal(typeof UNCOVERED_WHY[k], 'string')
    assert.ok(UNCOVERED_WHY[k].length > 8, `${k} 的 why 太短：${UNCOVERED_WHY[k]}`)
  }
})
