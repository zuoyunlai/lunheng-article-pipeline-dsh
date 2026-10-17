// 发版链上**唯一会写仓库文件**的工具，此前 0 测试 0 CI 调用（反哺 2026-10-17 §P1-10）。
// 本文件在**临时副本**上跑真脚本（绝不碰真仓库），钉三条性质：
//   ① 只改「当前版本声明」的固定形态，**历史归档面整体豁免**（audits/反哺报告-* / docs/审计与修订记录）；
//   ② 幂等：再跑一次 = 0 个文件被改；
//   ③ 新增 `--check`：只判定不写盘（有待改 → exit 1；无 → exit 0）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, tmp, ROOT } from './_fixtures.mjs'

// v19.11.2：版本常量**从真实仓库派生**，不再写死 19.11.1/19.11.2。
//   实测教训：写死的老版本在每次发版后立刻失效——副本里已是新版本，`--check` 找不到待改 → 用例红。
const REAL_VER = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const OLD = REAL_VER
const NEW = (() => { const [a, b, c] = REAL_VER.split('.').map(Number); return `${a}.${b}.${c + 1}` })()

/** 造一个「够 bump-version 扫」的最小仓库副本（skills/docs/examples + 根文件 + 历史归档面）。 */
function makeRepo() {
  const d = tmp('lunheng-bump-')
  mkdirSync(join(d, 'scripts'), { recursive: true })
  cpSync(join(ROOT, 'scripts', 'bump-version.mjs'), join(d, 'scripts', 'bump-version.mjs'))
  for (const sub of ['skills', 'docs', 'examples']) {
    const src = join(ROOT, sub)
    if (existsSync(src)) cpSync(src, join(d, sub), { recursive: true })
  }
  for (const f of ['package.json', 'cordis.patch.yml', 'README.md', 'README-zh.md', 'README-es.md',
    'README-pt.md', 'README-hi.md', 'SECURITY.md', 'CONTRIBUTING.md']) {
    const src = join(ROOT, f)
    if (existsSync(src)) cpSync(src, join(d, f))
  }
  // 历史归档面：必须**保持不变**（脚本的 HIST_ARCHIVE_RE 承诺）
  mkdirSync(join(d, 'audits'), { recursive: true })
  writeFileSync(join(d, 'audits', '反哺报告-test.md'), `> 版本：v${OLD}\n\n历史原文，不得被 bump 改写\n`, 'utf8')
  mkdirSync(join(d, 'docs', '审计与修订记录'), { recursive: true })
  writeFileSync(join(d, 'docs', '审计与修订记录', 'hist.md'), `> 版本：v${OLD}\n\n历史修订记录，不得被 bump 改写\n`, 'utf8')
  return d
}

const script = (d) => join(d, 'scripts', 'bump-version.mjs')
const readPkg = (d) => JSON.parse(readFileSync(join(d, 'package.json'), 'utf8'))

test('P1-10：bump 只改当前版本声明，历史归档面不动', () => {
  const d = makeRepo()
  try {
    const r = run([script(d), OLD, NEW])
    assert.equal(r.code, 0, '正常 bump 须 exit 0：' + r.out.slice(0, 400))
    assert.equal(readPkg(d).version, NEW, 'package.json 的 version 必须被改')
    const skill = readFileSync(join(d, 'skills', 'lunheng-article-pipeline', 'SKILL.md'), 'utf8')
    assert.ok(skill.includes(`> 版本：v${NEW}`), 'SKILL.md 文件头版本行必须被改')
    assert.ok(!skill.includes(`> 版本：v${OLD}`), '旧版本头不得残留')
    assert.match(readFileSync(join(d, 'audits', '反哺报告-test.md'), 'utf8'), new RegExp(`v${OLD.replace(/\./g, '\\.')}`),
      'audits/反哺报告-* 是历史归档面，版本头不得被改写')
    assert.match(readFileSync(join(d, 'docs', '审计与修订记录', 'hist.md'), 'utf8'), new RegExp(`v${OLD.replace(/\./g, '\\.')}`),
      'docs/审计与修订记录 是历史归档面，版本头不得被改写')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('P1-10：bump 幂等——同一对版本再跑一次 = 0 个文件被改', () => {
  const d = makeRepo()
  try {
    assert.equal(run([script(d), OLD, NEW]).code, 0)
    const r2 = run([script(d), OLD, NEW])
    assert.equal(r2.code, 0, '二次运行仍须 exit 0')
    assert.match(r2.out, /已改 0 个文件/, '二次运行必须报告 0 个文件被改（幂等）：' + r2.out.slice(-300))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('P1-10：--check 只判定不写盘（有待改 → exit 1 且文件不变）', () => {
  const d = makeRepo()
  try {
    const before = readFileSync(join(d, 'package.json'), 'utf8')
    const r = run([script(d), OLD, NEW, '--check'])
    assert.equal(r.code, 1, '存在待改时 --check 须 exit 1：' + r.out.slice(0, 300))
    assert.match(r.out, /\[pending\]/, '待改项须逐条列出（不足以「有 N 项」概括）')
    assert.equal(readFileSync(join(d, 'package.json'), 'utf8'), before, '--check 绝不得写盘')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('P1-10：--check 在已 bump 的树上 exit 0', () => {
  const d = makeRepo()
  try {
    assert.equal(run([script(d), OLD, NEW]).code, 0)
    const r = run([script(d), OLD, NEW, '--check'])
    assert.equal(r.code, 0, '已 bump 到位时 --check 须 exit 0：' + r.out.slice(-300))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── S3 第一步：`--sync` = 版本头生成化（只对齐主包，不碰子技能）─────────────
// 病灶：每次发版要人工/多脚本同步 89 份文档版本头，漏一份即 P1 漂移。
// 首个实现踩过两个坑（已修，正是本用例钉住的）：① 把子技能的 1.0.x 改成主包版本；
// ② 用 `- 版本：vX｜` 形态且回调漏参 → 写坏速查表那一行。
test('S3：--sync 只对齐主包版本头，不碰子技能', () => {
  const d = makeRepo()
  try {
    // package.json 前进到 19.11.2，文档仍停在 19.11.1
    const pkgPath = join(d, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    pkg.version = NEW
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    const subPath = join(d, 'skills', 'lunheng-commands', 'SKILL.md')
    const subBefore = readFileSync(subPath, 'utf8')

    assert.equal(run([script(d), '--sync', '--check']).code, 1, '版本头落后时 --sync --check 须 exit 1')
    const fix = run([script(d), '--sync'])
    assert.equal(fix.code, 0, '--sync 须 exit 0：' + fix.out.slice(-300))
    assert.ok(readFileSync(join(d, 'skills', 'lunheng-article-pipeline', 'SKILL.md'), 'utf8').includes(`> 版本：v${NEW}`),
      '主包 SKILL.md 的版本头须被对齐到 package.json')
    assert.equal(readFileSync(subPath, 'utf8'), subBefore,
      '子技能版本是独立的 1.0.x（规则㉖ 管），--sync 绝不得改写它')
    assert.equal(run([script(d), '--sync', '--check']).code, 0, 'sync 后复查须 exit 0')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('P1-10：参数错仍 exit 10（--check 不得放宽既有契约）', () => {
  const d = makeRepo()
  try {
    assert.equal(run([script(d), 'x', 'y']).code, 10, '非 x.y.z 版本号须 exit 10')
    assert.equal(run([script(d)]).code, 10, '缺参数须 exit 10')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
