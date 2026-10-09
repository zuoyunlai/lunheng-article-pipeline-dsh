// agents-log-check 回归网（v18.86.0-prep · 台海项目反哺 F-5）
//
// **本文件钉三件事**：
//   ① 三类判据各有一条**正例**（控制字符 / 「待修」缺处置 / sha256 标签空值）；
//   ② 三类**假阳性**各有一条反例——它们全部来自**真实数据的自证校准**（首版在台海 agents-log 上报
//      17 处，其中 5 处是误报，逐条修完后剩 12 处真损坏）；反例即「当时的误报形态」的回归钉：
//        · 处置语写作 `处置 =`（等号而非冒号）；② sha256「缩写指纹」`d8ec2eaf…`；
//        ③ 引述门的结论原文「6 文件 sha256 一致」。
//   ③ **CRLF 文件不得逐行误报**——首版对 CRLF 文件的每一行都报「孤立 CR」（`split('\n')` 后每行尾
//     都带 `\r`），是自证抓到的缺陷；现以「`\r\n` 占行数过半即视为正常行尾」为判据。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, run, tmp } from './_fixtures.mjs'

const CHK = join(ROOT, 'scripts', 'agents-log-check.mjs')

/** 建一个临时目录并写入 agents-log.md（内容由调用方给，按需含控制字符）。 */
const withLog = (content, fn) => {
  const d = tmp('agents-log-chk-')
  mkdirSync(d, { recursive: true })
  const p = join(d, 'agents-log.md')
  writeFileSync(p, content, 'utf8')
  try { return fn(p, d) } finally { rmSync(d, { recursive: true, force: true }) }
}

test('agents-log-check：干净流水 → exit 0 且报「未发现」（不判失败）', () => {
  withLog('# agents-log\n\n### T1 执行记录\n- 产物：`literature/文献卡.md`（12 条）\n- 正文 sha256：`2b8126d5…`\n', (p) => {
    const r = run([CHK, p])
    assert.equal(r.code, 0, '发现也恒 0（ADR-0003：非内容判定脚本不用 1）：' + r.out)
    assert.match(r.out, /未发现软提示/)
  })
})

test('agents-log-check：检测控制字符（BEL/BS/VT）与 U+FFFD', () => {
  withLog('# log\n- 损坏段\u0007a\u0008b\u000bc\n- 替换符\ufffdx\n', (p) => {
    const r = run([CHK, p])
    assert.equal(r.code, 0)
    assert.match(r.out, /控制字节 0x07（BEL）/)
    assert.match(r.out, /控制字节 0x08（BS）/)
    assert.match(r.out, /控制字节 0x0B（VT）/)
    assert.match(r.out, /U\+FFFD/)
  })
})

test('agents-log-check【回归钉·真实数据】：LF/CRLF **混排**文件不得被误报（台海实测 12 处假阳性）', () => {
  // ⚠️ **本钉来自真实数据的第二次自证**：首版用「`\r\n` 占行数过半才算 CRLF 文件」的判据，
  //   于是「LF 为主 + 少数 CRLF 行」的混排文件会被**逐行误报**「孤立 CR」。台海 `agents-log.md`
  //   实测：`CR 总数(12) == CRLF 数(12)`、行内 CR = 0 ⇒ 12 处**全是假阳性**。
  //   正确判据 = `split('\n')` 后**行尾的 `\r` 就是 CRLF 换行**（豁免），只有**行内** `\r` 才报。
  const mixed = '# log\n- 行一\n- 行二\r\n- 行三\n- 行四\r\n- 行五\n'
  withLog(mixed, (p) => {
    const r = run([CHK, p])
    assert.equal(r.code, 0)
    assert.doesNotMatch(r.out, /孤立 CR/, '混排行尾不得报（那是 CRLF 换行，不是损坏）：' + r.out)
    assert.match(r.out, /未发现软提示/)
  })
})

test('agents-log-check：**行内**孤立 CR → 报（真实损坏形态：转义误写入吃掉换行）', () => {
  withLog('# log\n- 正常行\n- 损坏\r行（行内 CR）\n- 正常行\n', (p) => {
    const r = run([CHK, p])
    assert.equal(r.code, 0)
    assert.match(r.out, /行内孤立 CR/)
  })
})

test('agents-log-check：「待修」缺处置必须报；而 `处置 =` 与「作废」两种写法都算已交代（假阳性回归）', () => {
  // ⚠️ **断言口径（本用例首版踩过）**：成功文案 `✓ 未发现软提示（C0 控制字符 / 「待修」缺处置 / sha256 行格式）`
  //   里**也含**这三个标签名 → 用裸标签 `/「待修」缺处置/` 做 `doesNotMatch` 会**假失败**。
  //   故一律断言**发现项行**形态 `/· \[「待修」缺处置\]/`（只在真有发现时出现）。
  const FOUND = /· \[「待修」缺处置\]/
  // ① 缺处置 → 报
  withLog('# log\n- 待修：信任级别行用了半角冒号\n- 下一段无关内容\n', (p) => {
    assert.match(run([CHK, p]).out, FOUND)
  })
  // ② 其后 20 行内写「处置 = …」（**真实数据里的写法，等号而非冒号**）→ 不报
  withLog('# log\n- 待修：信任级别行用了半角冒号\n' + '- 填充行\n'.repeat(5) + '- 处置 = 实跑 normalize-trust-level 报「将规范化 0 条」→ 本「待修」作废\n', (p) => {
    assert.doesNotMatch(run([CHK, p]).out, FOUND)
  })
})

test('agents-log-check：sha256 三类假阳性回归（引述结论 / 缩写指纹 / 显式缺失）vs 真形态（标签空值）', () => {
  // ① 真形态：`本轮正文 sha256：` 后空着 → 报
  withLog('# log\n- 本轮正文 sha256：\n', (p) => {
    assert.match(run([CHK, p]).out, /sha256/)
  })
  // ② 引述门的结论原文（无分隔符）→ 不报
  withLog('# log\n- 机械实据：M-Exist-2「6 文件 sha256 一致」\n', (p) => {
    assert.doesNotMatch(run([CHK, p]).out, /sha256 标签后未给值/)
  })
  // ③ 缩写指纹 `sha256 d8ec2eaf…` / `auditTargetSha256 = 2b8126d5…` → 不报
  withLog('# log\n- 对象 `drafts/初稿-v3.md`（sha256 d8ec2eaf…）\n- 证据包 v6（auditTargetSha256 = 2b8126d5…）\n', (p) => {
    assert.doesNotMatch(run([CHK, p]).out, /sha256 标签后未给值/)
  })
  // ④ 显式声明缺失 → 不报
  withLog('# log\n- 正文 sha256：待补（T8 后回填）\n', (p) => {
    assert.doesNotMatch(run([CHK, p]).out, /sha256 标签后未给值/)
  })
})

test('agents-log-check：目录入参递归收集 agents-log*.md；--json 契约；用法/路径错 = 10（无 1）', () => {
  const d = tmp('agents-log-dir-')
  const sub = join(d, 'run', 'proj')
  mkdirSync(sub, { recursive: true })
  writeFileSync(join(sub, 'agents-log.md'), '# a\n- 正常\n', 'utf8')
  writeFileSync(join(sub, 'agents-log-Phase3.md'), '# b\n- 损坏\u0007\n', 'utf8')
  try {
    const r = run([CHK, d, '--json'])
    assert.equal(r.code, 0)
    const j = JSON.parse(r.stdout)
    assert.equal(j.files, 2, '目录入参应递归收到 2 个 agents-log*.md：' + r.stdout)
    assert.ok(j.findings >= 1 && Array.isArray(j.items), 'JSON 契约须含 items 数组：' + r.stdout)
    // 用法错 / 路径错 → 10（**不得**用 1）
    assert.equal(run([CHK]).code, 10, '缺参数应 exit 10')
    assert.equal(run([CHK, join(d, 'no-such')]).code, 10, '路径不存在应 exit 10')
    assert.equal(run([CHK, d, '--bogus']).code, 10, '未知参数应 exit 10')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
