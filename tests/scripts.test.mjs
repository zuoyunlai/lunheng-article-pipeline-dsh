// 随包脚本回归测试（v2.5.2-dsh.13 新增）
// 每个用例对应一个「第三方审计发现、只能靠人工实测才暴露」的缺陷，防止复发。
// 运行：node --test tests/     （CI 在 ubuntu-latest 与 windows-latest 双平台跑）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')
const run = (args, opts = {}) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: opts.cwd || ROOT })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', stderr: r.stderr || '' }
}
const parseJson = (r) => JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
const tmp = () => mkdtempSync(join(tmpdir(), 'lunheng-test-'))

test('count-chars：缺「## 摘要」时正文口径必须显式标记 degraded（不得静默退化）', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, '# 标题\n\n正文若干字。\n\n## 参考文献\n\n[L01] 某文献\n')
  const r = run([join(SCRIPTS, 'count-chars.mjs'), f])
  assert.equal(r.code, 0)
  const j = parseJson(r)
  assert.equal(j.degraded, true, '应带 degraded 标记')
  assert.match(j.degradedReason, /摘要/)
  rmSync(d, { recursive: true, force: true })
})

test('count-chars：--full 不应带 degraded 标记', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, '# 标题\n\n正文若干字。\n')
  const r = run([join(SCRIPTS, 'count-chars.mjs'), f, '--full'])
  const j = parseJson(r)
  assert.equal(j.degraded, undefined)
  rmSync(d, { recursive: true, force: true })
})

test('normalize-trust-level：缺 token 必须拒绝推断并以 exit 1 收尾（旧版默认填「已发布」）', () => {
  const d = tmp()
  const f = join(d, '卡.md')
  writeFileSync(f, '# 数据卡\n\n## [D01] 某公报\n来源：stats.gov.cn\n摘要：某数据。\n')
  const r = run([join(SCRIPTS, 'normalize-trust-level.mjs'), f])
  assert.equal(r.code, 1, '缺 token 应 exit 1')
  assert.match(r.out, /拒绝推断/)
  assert.ok(!readFileSync(f, 'utf8').includes('信任级别：'), '不得写入任何推断值')
  rmSync(d, { recursive: true, force: true })
})

test('normalize-trust-level：默认 dry-run 不落盘；--write 才落盘并写 .bak', () => {
  const d = tmp()
  const f = join(d, '卡.md')
  writeFileSync(f, '# 数据卡\n\n## [D07] 某报告\n摘要：本数据二手转引自某日报。\n')
  const dry = run([join(SCRIPTS, 'normalize-trust-level.mjs'), f])
  assert.equal(dry.code, 0)
  assert.ok(!readFileSync(f, 'utf8').includes('信任级别：'), 'dry-run 不得落盘')
  const w = run([join(SCRIPTS, 'normalize-trust-level.mjs'), f, '--write'])
  assert.equal(w.code, 0)
  assert.match(readFileSync(f, 'utf8'), /信任级别：二手转引/)
  assert.ok(existsSync(f + '.bak'), '应写 .bak 备份')
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check：参数/路径错误必须 exit 10（与「1 = P1 内容失败」区分）', () => {
  const r = run([join(SCRIPTS, 'm-gate-check.mjs')])
  assert.equal(r.code, 10)
})

test('m-gate-check：不带 --report 的常规调用必须正常工作（回归：曾因 reportIdx=-1 排除首个位置参数而误报用法错误）', () => {
  const d = tmp()
  const proj = join(d, 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), join(fin, '定稿.md'), ev])
  assert.notEqual(r.code, 10, '不得判为参数错误：' + r.out.slice(0, 160))
  const j = parseJson(r)
  assert.ok(j.total >= 10, '应输出完整 M 门报告（total=' + j.total + '）')
  assert.equal(typeof j.exit, 'number')
  rmSync(d, { recursive: true, force: true })
})

test('final-check：应把 M 门报告落到真源路径 final/M-Gate-Report.json（供审计视图读取）', () => {
  const d = tmp()
  const proj = join(d, 'proj')
  const fin = join(proj, 'final')
  mkdirSync(join(fin, '证据包'), { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  run([join(SCRIPTS, 'final-check.mjs'), proj, '--no-summary'])
  assert.ok(existsSync(join(fin, 'M-Gate-Report.json')), 'M 门报告应落在 final/M-Gate-Report.json')
  rmSync(d, { recursive: true, force: true })
})

test('m-gate-check：--report 落盘结构化报告（报告契约闭环）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  const rep = join(fin, 'M-Gate-Report.json')
  mkdirSync(ev, { recursive: true })
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n正文。\n\n## 参考文献\n\n[L01] 文献\n')
  const r = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev, '--report', rep])
  assert.ok(existsSync(rep), '报告应落盘')
  const j = JSON.parse(readFileSync(rep, 'utf8'))
  assert.equal(typeof j.exit, 'number')
  assert.ok(j.total >= 10, `M 门应有 ≥10 项（实测 ${j.total}）`)
  rmSync(d, { recursive: true, force: true })
})

test('final-check：正斜杠 --report 路径不得崩溃（旧版硬编码反斜杠 → mkdir \'\' ENOENT）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  const reportRel = 'audits/final.json'
  const r = run([join(SCRIPTS, 'final-check.mjs'), proj, '--no-summary', '--report', join(proj, reportRel)])
  assert.ok(!/ENOENT|mkdir/.test(r.out), `不应出现 mkdir/ENOENT 崩溃：${r.out.slice(0, 200)}`)
  assert.ok(existsSync(join(proj, reportRel)), '报告应落盘')
  rmSync(d, { recursive: true, force: true })
})

test('build-evidence-bundle：--deep-summary 蕴含 --summary（旧版单独用是静默空操作）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n')
  const r = run([join(SCRIPTS, 'build-evidence-bundle.mjs'), proj, '--deep-summary'])
  assert.equal(r.code, 0)
  assert.ok(existsSync(join(proj, 'audits', '审计视图-v0.md')), '应生成审计视图（deep 蕴含 summary）')
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check --fix：dry-run 不得改写任何文件（旧版一跑即 ReferenceError）', () => {
  const before = readFileSync(join(SCRIPTS, 'consistency-check.mjs'), 'utf8')
  const r = run([join(SCRIPTS, 'consistency-check.mjs'), '--fix'])
  assert.ok(!/ReferenceError/.test(r.out), '不得再出现 ReferenceError')
  assert.match(r.out, /dry-run/)
  assert.equal(readFileSync(join(SCRIPTS, 'consistency-check.mjs'), 'utf8'), before)
})
