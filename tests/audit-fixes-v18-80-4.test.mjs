// v18.80.4（全量审计-v18.80.3 修订批）回归测试
//
// 逐项钉住本批修复的行为契约（审计编号与 audits/修订计划-全量审计-v18.80.3-2026-10-08.md 对应）：
//   · P1-1  /lunheng-status 叶文件 symlink 越界 → 拒读并播报（symlink 需权限，EPERM 则带理由跳过）
//   · P1-2  原生工具相对路径按会话工作区解析（resolveSessionPath 单元）
//   · P1-6  sameFile 硬链接（dev+ino）判定（linkSync 不可用则带理由跳过）
//   · P1-8  quality-score 安装在含空格路径下不再把子门失败当 N/A（fileURLToPath 修复）
//   · P1-9  轮次额度授权行（只许上调、须含依据；生效额度进 parseLedger/appendLedgerRow）
//   · P2-1  输入侧哨兵碰撞：原文 \uE000<n>\uE000 序列原样保留 + sentinel-collision-input 标记
//   · P2-2  maxChars 0<x<1：floor 后夹 ≥1（不得产出空串 + truncated 的无进展分页）
//   P1-3/P1-4/P1-5/P1-7/P1-10 在各自既有测试文件中补（h2-h5-listeners / adjudicate / m-gate 族 / gate-receipts 族）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, symlinkSync, linkSync, cpSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { run, tmp } from './_fixtures.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const imp = (p) => import(pathToFileURL(p).href)   // Windows 绝对路径动态 import 必须走 file:// URL
const { sanitize } = await imp(join(ROOT, 'lib', 'ethics-sanitize.js'))
const { sameFile } = await imp(join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', '_lib', 'destructive-write.mjs'))
const { parseLedger, authorizedCaps, appendLedgerRow } = await imp(join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', '_lib', 'round-ledger.mjs'))
const { resolveSessionPath } = await imp(join(ROOT, 'lib', 'tools.js'))
const { installStatusCommand } = await imp(join(ROOT, 'lib', 'commands.js'))

const canSymlink = (() => { const d = join(tmpdir(), 'lh-sym-probe'); try { symlinkSync(d, d + '.link'); return true } catch { return false } finally { try { rmSync(d + '.link', { force: true }) } catch { /* */ } } })()

test('P1-1：run/<项目>/status.md 为指向 run 外的软链接 → /lunheng-status 拒读并播报（不回显外部内容）', { skip: canSymlink ? false : '本机无文件 symlink 权限（EPERM）——环境不支持，带理由跳过' }, () => {
  const d = join(tmpdir(), 'lh-p11-' + Date.now())
  const outside = join(d, 'outside-secret.md')
  const proj = join(d, 'ws', 'run', 'demo')
  mkdirSync(proj, { recursive: true })
  writeFileSync(outside, 'OUTSIDE_RUN_SECRET_MARKER')
  symlinkSync(outside, join(proj, 'status.md'))
  let handler = null
  const ctx = { get: () => ({ register: (def) => { handler = def.handler } }) }
  installStatusCommand(ctx, { cwd: join(d, 'ws') })
  const r = handler({ rawInput: 'demo', agent: { session: { header: { cwd: join(d, 'ws') } } } })
  assert.equal(r.kind, 'success')
  assert.ok(!r.text.includes('OUTSIDE_RUN_SECRET_MARKER'), '外部内容不得被回显（越界读取）')
  assert.match(r.text, /拒绝读取|解析到项目目录之外/)
  rmSync(d, { recursive: true, force: true })
})

test('P1-1 对照：正常 status.md（非链接）仍可读', () => {
  const d = join(tmpdir(), 'lh-p11b-' + Date.now())
  const proj = join(d, 'ws', 'run', 'demo')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'status.md'), '| 阶段 | 状态 |\n|---|---|\n| Phase 1 | done |')
  let handler = null
  const ctx = { get: () => ({ register: (def) => { handler = def.handler } }) }
  installStatusCommand(ctx, { cwd: join(d, 'ws') })
  const r = handler({ rawInput: 'demo', agent: { session: { header: { cwd: join(d, 'ws') } } } })
  assert.equal(r.kind, 'success')
  assert.match(r.text, /Phase 1/)
  rmSync(d, { recursive: true, force: true })
})

test('P1-2：resolveSessionPath 相对路径按会话 cwd 解析；绝对路径/无会话 cwd 保持原样', () => {
  const exec = { agent: { session: { header: { cwd: join('X:', 'ws') } } } }
  assert.equal(resolveSessionPath(exec, 'paper.md'), join('X:', 'ws', 'paper.md'))
  assert.equal(resolveSessionPath(exec, join('X:', 'elsewhere', 'a.md')), join('X:', 'elsewhere', 'a.md'), '绝对路径不得被重定向')
  assert.equal(resolveSessionPath({}, 'paper.md'), 'paper.md', '取不到会话 cwd → 原样返回（不劣于旧行为）')
  assert.equal(resolveSessionPath(exec, ''), '', '空串原样返回')
})

test('P1-6：硬链接（realpath 不同、同 inode）→ sameFile 必须判同文件', { skip: (() => { try { const d = join(tmpdir(), 'lh-p16-probe'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'a'), 'x'); linkSync(join(d, 'a'), join(d, 'b')); rmSync(d, { recursive: true, force: true }); return false } catch { return '本机不支持 linkSync（硬链接）——带理由跳过' } })() }, () => {
  const d = join(tmpdir(), 'lh-p16-' + Date.now())
  mkdirSync(d, { recursive: true })
  const orig = join(d, '正文.md'); const alias = join(d, 'alias.md')
  writeFileSync(orig, '正文内容')
  linkSync(orig, alias)
  assert.ok(sameFile(orig, alias), '硬链接别名必须判同文件（否则 writeReport 保护可被绕过覆盖真源）')
  assert.ok(!sameFile(orig, join(d, '其他.md')), '不同文件不得误判')
  rmSync(d, { recursive: true, force: true })
})

test('P1-8：quality-score 安装在含空格路径下仍能跑子门（fileURLToPath 修复）', () => {
  const d = join(tmpdir(), 'lh p18 ' + Date.now())   // 含空格
  const proj = join(d, 'proj')
  const srcScripts = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')
  const destScripts = join(d, 'space dir', 'scripts')
  mkdirSync(join(proj, 'final', '证据包'), { recursive: true })
  mkdirSync(dirname(destScripts), { recursive: true })
  cpSync(srcScripts, destScripts, { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、导论\n\n' + '汉字内容填充。'.repeat(80) + '\n\n## 参考文献\n\n[L01] a\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n')
  const r = spawnSync(process.execPath, [join(destScripts, 'quality-score.mjs'), proj], { encoding: 'utf8', timeout: 120000 })
  let j = null
  try { j = JSON.parse(r.stdout) } catch { /* 下面断言报 */ }
  assert.ok(j, '应产出 JSON：' + String(r.stderr).slice(0, 300))
  const mg = (j.components || []).find((c) => c.id === 'M-Gate')
  assert.ok(mg, 'M-Gate 分量应在场')
  assert.ok(!/未产出可用 JSON|门执行错误/.test(mg.naReason || ''), `含空格路径下 M-Gate 不得因子门 ENOENT 转 invalid/N/A（实测 naReason=${mg.naReason}——URL.pathname 路径编码缺陷回归）`)
  rmSync(d, { recursive: true, force: true })
})

test('P1-9：authorizedCaps 只认「上调 + 含依据 + 提到主人」的授权行', () => {
  const good = authorizedCaps('> 额度授权：A=3（依据：主人 2026-10-08，阶段确认-Phase0.md §6）')
  assert.deepEqual(good.caps, { A: 3 })
  assert.equal(good.bad.length, 0)
  const bad = authorizedCaps('> 额度授权：A=1（依据：主人）\n> 额度授权：B=2\n> 额度授权：G=x（依据：主人）')
  assert.deepEqual(bad.caps, {}, '下调/无依据/非整数一律不生效')
  // `G=x` 不匹配授权行正则（值非数字）→ 整行不视为授权行、不进 bad（防把普通引用行误报为无效授权）
  assert.equal(bad.bad.length, 2, '有效形态但规则不合的行各进 bad（宁拒不猜）：' + bad.bad.join(' / '))
})

test('P1-9：parseLedger 返回生效额度；越默认但未越授权额度的轮次不判 over', () => {
  const d = join(tmpdir(), 'lh-p19-' + Date.now())
  const proj = join(d, 'p')
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  writeFileSync(join(proj, 'drafts', '轮次账本.md'),
    '> 额度授权：A=3（依据：主人 2026-10-08，阶段确认-Phase0.md §6）\n\n| 轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间 |\n|---|---|---|---|---|---|\n| A | 3/3 | drafts/x.md | audits/y.md | audits/z.md | 2026-10-08 |\n')
  const info = parseLedger(proj)
  assert.equal(info.caps.A, 3, '生效额度应含授权值')
  assert.equal(info.over.length, 0, '第 3 轮 ≤ 授权额度 3 → 不判越额（旧版固定 2 会误判）')
  assert.equal(info.malformed.length, 0)
  rmSync(d, { recursive: true, force: true })
})

test('P1-9：appendLedgerRow 在授权后的分母 = 生效额度', () => {
  const d = join(tmpdir(), 'lh-p19b-' + Date.now())
  const proj = join(d, 'p')
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  writeFileSync(join(proj, 'drafts', '轮次账本.md'), '> 额度授权：B=2（依据：主人 2026-10-08，阶段确认-Phase0.md §6）\n\n| 轨 | 轮次 | 正文版本 | 触发来源 | 复核报告 | 时间 |\n|---|---|---|---|---|---|\n')
  const r = appendLedgerRow(proj, { track: 'B', n: 2, draft: 'd.md', source: 's.md', review: 'r.md' })
  assert.match(r.appended, /\| 2\/2 \|/, '分母应为授权额度 2（旧版固定 1）')
  rmSync(d, { recursive: true, force: true })
})

test('P2-1：原文自带命中本轮编号的哨兵序列 → 原样保留 + sentinel-collision-input 标记（不得静默改写）', () => {
  const dicts = { surnames: new Set(['张']), excludes: new Set(), places: new Map([['杭州', '浙江省']]), missing: [] }
  const src = '原始私用串:\uE0000\uE000 地名:杭州'
  const r = sanitize(src, { dicts })
  const expectPrefix = [...'原始私用串:\uE0000\uE000'].map((c) => c.codePointAt(0)).join(',')
  const gotPrefix = [...r.text.slice(0, 9)].map((c) => c.codePointAt(0)).join(',')
  assert.equal(gotPrefix, expectPrefix, '原文哨兵序列必须逐码点保留（旧版被静默换成地名占位符）')
  assert.ok(r.text.includes('[地名-REDACTED]'), '词表地名照常脱敏')
  assert.ok(r.reviewFlags.some((f) => f.kind === 'sentinel-collision-input'), '须登记 sentinel-collision-input 供人工核')
})

test('P1-5：manifest 的 zeroByteSrcs / sizeMismatch 拒收源 → M-Exist-2 判 P1（不得 pass）', () => {
  const d = tmp('lh-p15-')
  const fin = join(d, 'final'); const ev = join(fin, '证据包')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(d, '01-任务简报.md'), '# 简报\n\n## 研究问题（主控拆解，3-5 个子问题）\n\n1. 一？\n2. 二？\n3. 三？\n\n## 数据需求\n\n- 需找数据点：≥1 条\n')
  const draft = '# 标题\n\n## 摘要\n\n摘要 [L01] [D01]。\n\n## 一、论证\n\n论述 [L01] [D01] [C01]。\n\n## 参考文献\n\n- [L01] a\n\n## 数据来源\n\n- [D01] d\n\n## 案例来源\n\n- [C01] c\n\n## 先行者文献\n\n## AI 使用声明\n\n- AI。\n'
  writeFileSync(join(fin, '定稿.md'), draft)
  const cards = {
    '数据卡.md': '# 数据卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [D01] | 值 | 论点1 |\n',
    '文献卡.md': '# 文献卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [L01] | 综述 | 论点1 |\n',
    '案例卡.md': '# 案例卡\n\n> 总条数 1 条\n\n## 📇 索引段\n\n| 编号 | 主题 | 支撑论点 |\n|---|---|---|\n| [C01] | 案例 | 论点1 |\n',
  }
  const files = []
  for (const [n, c] of Object.entries(cards)) {
    writeFileSync(join(ev, n), c)
    files.push({ path: n, sha256: createHash('sha256').update(Buffer.from(c, 'utf8')).digest('hex'), bytes: Buffer.byteLength(c, 'utf8') })
  }
  // 关键构造：清单复算本身全部一致（无 absent/drifted/extra），但构建器声明了拒收源
  writeFileSync(join(ev, 'manifest.json'), JSON.stringify({
    auditTarget: 'final/定稿.md',
    auditTargetSha256: createHash('sha256').update(Buffer.from(draft, 'utf8')).digest('hex'),
    files,
    zeroByteSrcs: ['drafts/素材-缺失源.md'],
    sizeMismatch: ['data/原始数据.xlsx'],
  }, null, 2))
  const r = run([join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', 'm-gate-check.mjs'), join(fin, '定稿.md'), ev, '--report', join(fin, 'mg.json')])
  const j = JSON.parse(readFileSync(join(fin, 'mg.json'), 'utf8'))
  const me = (j.results || []).find((x) => String(x.gate || '').startsWith('M-Exist-2'))
  assert.ok(me, 'M-Exist-2 应在场：' + r.out.slice(0, 200))
  assert.equal(me.pass, false, '含拒收源的 manifest 不得 pass（旧版不消费该字段 → 构建器说没装全、门说完整）')
  assert.equal(me.severity, 'P1', '拒收源 = 证据不完整 → P1')
  assert.match(me.detail, /拒收源/)
  rmSync(d, { recursive: true, force: true })
})

test('P2-2：maxChars 0.5（0<x<1）→ floor 夹 ≥1，不得产出「空串 + truncated」的无进展分页', () => {
  const r = sanitize('x'.repeat(18), { maxChars: 0.5 })
  assert.ok(r.text.length >= 1, '至少返回 1 字符（旧版 slice(0,0.5) 得空串）')
  assert.equal(r.truncated, true, '仍有剩余——如实报告截断')
})
