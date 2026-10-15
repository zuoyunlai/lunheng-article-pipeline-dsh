// 素材池回写脚本 `pool-extract.mjs` 回归网（v19.6.1 · 审计 P1-1 / P1-3 / P2-6）
//
// **为什么需要**：审计实测「36 个随包脚本里只有 pool-query / pool-extract / pool-report 三个在
//   `tests/**` 里零提及」，而这三个脚本同时是「白名单成员 + Phase 0.5/5 标准动作 + 直接写盘」——
//   零测试正是 P1-1（`reuseCount` 非幂等）长期潜伏的结构性原因。
//
// 本文件钉两件事：
//   · **幂等**（P1-1）：`reuseCount` 的递增必须绑定「**新项目**入 `reusedBy`」这一唯一事实——
//     同一项目重复抽取（Phase 5 之后的 T5 修订轮 / 重跑交付都会再跑一次）不得虚增计数；
//     「另一个项目复用同一条目」仍必须计数（反向自证：不能为了让幂等用例变绿而把计数改成恒 0）。
//   · **走写盘安全网**（P1-3）：池文件与 manifest 属持久化状态产物，覆盖前必须留时间戳 `.bak`
//     （`_lib/destructive-write.mjs` 的 `writeWithSafety`）——旧版是裸 `writeFileSync`，无回滚点。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from '../_fixtures.mjs'

const POOL = () => join(SCRIPTS, 'pool-extract.mjs')

/** 项目骨架 + 一份最小文献卡（`### [L01]` 形态；重复词名会让 `dedupKey` 缺失，故只留一种形态）。 */
const mkProj = ({ name = 'proj', doi = '10.1234/abcd', title = '某文献标题' } = {}) => {
  const ws = tmp('lunheng-pool-x-')
  const proj = join(ws, 'run', name)
  mkdirSync(join(proj, 'literature'), { recursive: true })
  writeFileSync(
    join(proj, 'literature', '文献卡.md'),
    `# 文献卡\n\n## 正文\n\n### [L01] ${title}\n信任级别：已发布\n来源机构：某机构\nDOI: ${doi}\n`,
  )
  return { ws, proj }
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
const poolOf = (ws) => join(ws, 'evidence-pool')
const entryOf = (ws) => readJson(join(poolOf(ws), 'literature.json')).entries[0]

test('P1-1：同一项目重复抽取 → `reuseCount` 不虚增（而 `reusedBy` 仍只有 1 项）', () => {
  const { ws, proj } = mkProj()
  try {
    const r1 = run([POOL(), proj, ws])
    assert.equal(r1.code, 0, '首跑应 exit 0：' + r1.out)
    assert.match(r1.out, /新增 1 条/, '首跑应新增 1 条：' + r1.out)
    assert.equal(entryOf(ws).reuseCount, 0, '首次入池不计复用')

    for (const n of [2, 3]) {
      const r = run([POOL(), proj, ws])
      assert.equal(r.code, 0, `第 ${n} 跑应 exit 0：` + r.out)
      assert.match(r.out, /复用 1 条/, `第 ${n} 跑应报复用 1 条：` + r.out)
    }
    const e = entryOf(ws)
    assert.equal(e.reuseCount, 1, '同一项目重复抽取只应记 1 次复用（旧版连跑 3 次得 2）：' + JSON.stringify(e.reuseCount))
    assert.deepEqual(e.reusedBy, ['proj'], 'reusedBy 与 reuseCount 的判据必须一致')
    assert.equal(readJson(join(poolOf(ws), 'manifest.json')).reuseCountTotal, 1,
      'manifest 的 `reuseCountTotal` 是派生量，必须与池文件一致（不得虚增）')
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('P1-1 反向自证：**另一个项目**复用同一条目 → 计数照增（幂等不等于「恒 0」）', () => {
  const a = mkProj({ name: 'proj-a' })
  const b = mkProj({ name: 'proj-b' })
  try {
    assert.equal(run([POOL(), a.proj, a.ws]).code, 0)
    // 第二个项目复用同一条目：键相同（同 DOI）→ 命中既有条目
    assert.equal(run([POOL(), b.proj, a.ws]).code, 0)
    const e = entryOf(a.ws)
    assert.equal(e.reuseCount, 1, '换一个项目复用应计 1 次：' + JSON.stringify(e))
    // 口径（真源 = `references/_shared/素材池.md` §三）：`reusedBy[]` = **命中过该条目的项目**，
    //   首发项目记在 `originProject`；故 proj-b 复用后 `reusedBy` 只有 proj-b（不是「作者列表」）。
    assert.equal(e.originProject, 'proj-a', '首发项目记在 originProject')
    assert.deepEqual(e.reusedBy, ['proj-b'], 'reusedBy 记的是复用者：' + JSON.stringify(e.reusedBy))
    // 再跑一次 proj-b：同一项目重复复用不得再 +1（幂等的跨项目形态）
    assert.equal(run([POOL(), b.proj, a.ws]).code, 0)
    assert.equal(entryOf(a.ws).reuseCount, 1, '同一复用项目重复抽取仍只记 1 次')
  } finally {
    rmSync(a.ws, { recursive: true, force: true })
    rmSync(b.ws, { recursive: true, force: true })
  }
})

test('P1-3：池文件与 manifest 的覆盖写必须留时间戳 `.bak` 回滚点（走 `writeWithSafety`）', () => {
  const { ws, proj } = mkProj()
  try {
    assert.equal(run([POOL(), proj, ws]).code, 0)
    const baksIn = (d, base) => readdirSync(d).filter((x) => x.startsWith(base + '.') && x.endsWith('.bak'))
    assert.equal(baksIn(poolOf(ws), 'literature.json').length, 0, '首次写盘目标不存在 → 无备份可做（如实，不是缺陷）')
    assert.equal(run([POOL(), proj, ws]).code, 0)
    assert.ok(baksIn(poolOf(ws), 'literature.json').length >= 1,
      '第二次写 literature.json 应留时间戳 .bak（旧版裸 writeFileSync → 0 个）：' + readdirSync(poolOf(ws)).join(','))
    assert.ok(baksIn(poolOf(ws), 'manifest.json').length >= 1,
      '第二次写 manifest.json 应留时间戳 .bak：' + readdirSync(poolOf(ws)).join(','))
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('P2-6④：池文件带 BOM 仍可解析（Windows PowerShell `Set-Content -Encoding UTF8` 的真实输入形态）', () => {
  const { ws, proj } = mkProj()
  try {
    assert.equal(run([POOL(), proj, ws]).code, 0)
    const p = join(poolOf(ws), 'literature.json')
    writeFileSync(p, '\uFEFF' + readFileSync(p, 'utf8'), 'utf8')   // 人为加 BOM
    const r = run([POOL(), proj, ws])
    assert.equal(r.code, 0, 'BOM 输入不得让脚本崩（exit 70）：' + r.out)
    assert.match(r.out, /复用 1 条/, 'BOM 池文件应被正常解析并命中既有条目：' + r.out)
    assert.equal(entryOf(ws).reuseCount, 1, 'BOM 不得导致条目被重算为新条目')
    assert.equal(readJson(p).entries.length, 1, '不应新增重复条目')
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

test('防空转：本文件真的跑到了脚本（池目录缺 manifest 时上面几条会红，而不是恒真）', () => {
  const { ws, proj } = mkProj()
  try {
    run([POOL(), proj, ws])
    assert.ok(existsSync(join(poolOf(ws), 'manifest.json')), 'pool-extract 必须落 manifest.json')
    assert.ok(existsSync(join(poolOf(ws), 'literature.json')), 'pool-extract 必须落 literature.json')
  } finally { rmSync(ws, { recursive: true, force: true }) }
})

// ── v19.6.6（素材池可见性批 · 反馈闭环）：回写必须给出一行**机器可读回执** ────────────────
// 为什么需要：交付说明模板的「证据素材池贡献」字段要填「本次新增 / 命中复用 / 池累计」，
//   而旧版输出只有前两项，**池累计**（= 主人能看到的「池在长」的唯一证据）无来源 ⇒ 必被估填。
//   本用例同时钉住「输出与 manifest 同值」——防止有人把累计数写死或算成别的东西。
test('v19.6.6 可见性：回写必须输出 `POOL_APPEND` 回执，且累计数 == manifest.totalEntries', () => {
  const { ws, proj } = mkProj()
  try {
    const r = run([POOL(), proj, ws])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /POOL_APPEND 本次新增=1 命中复用=0 池累计=1 /, '回执字段与顺序是交付说明抄录的契约：' + r.out)
    assert.ok(r.out.includes(`路径=${poolOf(ws)}`), '回执须带池路径且与真实落点一致：' + r.out)
    const m = JSON.parse(readFileSync(join(poolOf(ws), 'manifest.json'), 'utf8'))
    assert.equal(m.totalEntries, 1, '回执里的累计数必须与 manifest 同源')
  } finally { rmSync(ws, { recursive: true, force: true }) }
})
