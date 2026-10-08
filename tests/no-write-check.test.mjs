// no-write-check（发布前固定动作：工具链不得改写仓库）回归测试（v18.45.0 新增）
//
// 这个脚本的**存在理由**是一次未定位成因的事故：v18.44.0 发版前，`consistency-check` 抓到
// `auto_cite-补充-template.md` 的标题里**少了一段被登记的豁免括注**——git 历史证明没有任何提交删过它
// （是工作树被某物改写），而排除法查遍了 bump / --fix / 套件 / 探针脚本都没复现。
// 于是把当时的「试纸」固化成固定动作：跑完发布序列后核对**仓库净状态未被改写**，下次当场抓住改写者。
//
// 本文件钉住的是这个脚本自己的四个行为（它是个**检查器**，所以「假绿」的代价与门一样高）：
//   ① 良性命令 → exit 0（不误报）；
//   ② 写入者 → exit 1 且**点名文件**（增量/内容变/删除三类都要抓到）；
//   ③ **命令没跑起来 → 必须判负**——「没跑」与「跑了没改写」在快照上完全一样，
//      首版就是在这里给了假绿（`--` 的参数被多前置了一个 node，子进程 exit 1 而检查器报「✓ 无改写」）；
//   ④ 参数错 / 空目录 → exit 10（不得把「指错根」当「干净」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, run, tmp } from './_fixtures.mjs'

const CHECK = join(ROOT, 'scripts', 'no-write-check.mjs')

/** 造一个最小「仓库」夹具：两个文档 + 一个脚本。 */
const mkRoot = () => {
  const d = tmp('lunheng-nowrite-')
  mkdirSync(join(d, 'docs'), { recursive: true })
  mkdirSync(join(d, 'scripts'), { recursive: true })
  writeFileSync(join(d, 'docs', 'a.md'), '# a\n')
  writeFileSync(join(d, 'README.md'), '# readme\n')
  writeFileSync(join(d, 'scripts', 'x.mjs'), '// x\n')
  return d
}
const NODE = process.execPath

test('no-write-check：良性命令 → exit 0，且报「无改写」', () => {
  const d = mkRoot()
  try {
    const r = run([CHECK, '--root', d, '--', NODE, '-e', '0'])
    assert.equal(r.code, 0, '没改任何东西就该 0：' + r.out + r.err)
    assert.match(r.out, /无改写/, '应明确报无改写：' + r.out)
    assert.match(r.out, /3 个文件/, '快照文件数应写出来（夹具 3 个）：' + r.out)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── v18.80.4（发版实测补）：**失败步骤必须回显内层输出** ───────────────────────────────
// 由来（一次真实的诊断代价）：v18.80.4 发版时 publish 的 gates 作业报「随包脚本回归测试 exit=1」，
//   而内层 TAP 被 `stdio: 'pipe'` 丢弃——CI 日志里只有归因表，**看不出是哪条用例红**。
//   一个「测试夹具在 POSIX 下的绝对路径假设」缺陷因此多耗一整个 CI 周期。判据：
//   **归因表说「哪一步失败」，输出尾部说「为什么失败」——两者缺一不可**。
test('no-write-check：被包命令失败时，**其输出尾部必须回显**（否则 CI 只说 exit=1、无法定位）', () => {
  const d = mkRoot()
  try {
    const r = run([CHECK, '--root', d, '--', NODE, '-e', 'console.error("MARKER_INNER_OUTPUT"); process.exit(3)'])
    assert.equal(r.code, 1, '被包命令退非 0 → 必须判负：' + r.out + r.err)
    assert.match(r.out, /MARKER_INNER_OUTPUT/, '失败步骤的内层输出必须出现在本脚本输出里（诊断面）：' + r.out)
    assert.match(r.out, /失败步骤输出尾部/, '须有一段明确标题，便于人在 CI 日志里直接定位')
    assert.match(r.out, /exit=3/, '须点名该步的退出码')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('no-write-check --json：失败步骤的 outputTail 也要出现在结构化结果里', () => {
  const d = mkRoot()
  try {
    const r = run([CHECK, '--root', d, '--json', '--', NODE, '-e', 'console.error("JSON_TAIL_MARK"); process.exit(2)'])
    assert.equal(r.code, 1)
    const j = JSON.parse(r.out.slice(r.out.indexOf('{')))
    assert.equal(j.steps[0].exit, 2)
    assert.match(String(j.steps[0].outputTail || ''), /JSON_TAIL_MARK/, 'JSON 分支同样要带 outputTail')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('no-write-check：新增 / 内容变 / 删除**三类改写都要抓到并点名**', () => {
  const d = mkRoot()
  try {
    // ① 新增
    let r = run([CHECK, '--root', d, '--', NODE, '-e', "require('node:fs').writeFileSync('docs/new.md','x')"])
    assert.equal(r.code, 1, '新增文件必须判负：' + r.out)
    assert.match(r.out, /docs\/new\.md/, '必须点名新增的文件：' + r.out)
    rmSync(join(d, 'docs', 'new.md'), { force: true })
    // ② 内容变
    r = run([CHECK, '--root', d, '--', NODE, '-e', "require('node:fs').appendFileSync('README.md','x')"])
    assert.equal(r.code, 1, '内容变化必须判负：' + r.out)
    assert.match(r.out, /README\.md/, '必须点名内容变的文件：' + r.out)
    writeFileSync(join(d, 'README.md'), '# readme\n')
    // ③ 删除
    r = run([CHECK, '--root', d, '--', NODE, '-e', "require('node:fs').rmSync('scripts/x.mjs')"])
    assert.equal(r.code, 1, '删除文件必须判负：' + r.out)
    assert.match(r.out, /scripts\/x\.mjs/, '必须点名被删的文件：' + r.out)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('no-write-check：**命令没跑起来必须判负**（「没跑」与「跑了没改写」在快照上一样）', () => {
  const d = mkRoot()
  try {
    const r = run([CHECK, '--root', d, '--', 'definitely-not-a-command-xyz'])
    assert.equal(r.code, 1, '命令不存在必须判负，不得给「✓ 无改写」的假绿：' + r.out)
    assert.match(r.out + r.err, /没跑起来|找不到命令/, '须写明「有步骤没跑起来」：' + r.out + r.err)
    assert.doesNotMatch(r.out, /✓ 无改写/, '不得出现无改写的成功文案')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('no-write-check：参数错 / 空根目录 → exit 10（「指错根」不得当「干净」）', () => {
  const d = mkRoot()
  try {
    const rBad = run([CHECK, '--root', d, '--nope'])
    assert.equal(rBad.code, 10, '未知参数应 exit 10：' + rBad.out + rBad.err)
    const empty = tmp('lunheng-nowrite-empty-')
    try {
      const rEmpty = run([CHECK, '--root', empty, '--', NODE, '-e', '0'])
      assert.equal(rEmpty.code, 10, '空目录应 exit 10（快照 0 个文件 = 根指错）：' + rEmpty.out)
    } finally { rmSync(empty, { recursive: true, force: true }) }
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('no-write-check：--json 给出机器可读结构（steps 逐步 + total 汇总）', () => {
  const d = mkRoot()
  try {
    const r = run([CHECK, '--root', d, '--json', '--', NODE, '-e', '0'])
    assert.equal(r.code, 0, r.out + r.err)
    const j = JSON.parse(r.out)
    assert.ok(Array.isArray(j.steps) && j.steps.length === 1, 'steps 应为数组且含本步：' + r.out)
    assert.equal(j.steps[0].total, 0)
    assert.equal(j.steps[0].exit, 0)
    assert.equal(typeof j.total.changed.length, 'number', 'total 三个类别都应是数组')
    assert.ok(j.root.endsWith('lunheng-nowrite-' + j.root.split('lunheng-nowrite-')[1]), 'root 应回显')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
