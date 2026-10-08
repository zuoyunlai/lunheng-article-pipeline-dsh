// 盲评载荷打包器的回归网（v18.80.4 · QLT-6 跨体例盲评脚手架）
//
// **为什么必须测**：载体制备是盲评的**唯一效力来源**——载荷里残留项目名或禁忌面文件名词，判者就读到了
//   生产中间产物的线索，而**失效是静默的**（判者不会报告自己看见了什么）。本文件钉四件事：
//   ① 去标识真的生效（项目名 / 版本头 / 「论衡·流水线」字样全抹）；
//   ② **钥匙与载荷物理分离**：`--map` 必填，且与载荷同目录时**拒绝**（"分离"不能只靠文档纪律）；
//   ③ 自检 fail-closed：残留禁忌面 → exit 1（宁可不放行，也不放可疑载荷进盲评）；
//   ④ **禁忌面词表与真源同步**：解析 `handoff-check.mjs` 源码里的 `BLIND_FORBIDDEN` 逐项比对——
//      两处漂了必须红（本仓判据：同一事实两处实现必然再漂）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, run, tmp } from './_fixtures.mjs'

const PACK = join(ROOT, 'scripts', 'blind-review-pack.mjs')
const HANDOFF = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', 'handoff-check.mjs')
const SHARED = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', '_lib', 'blind-forbidden.mjs')
const BODY = '论衡流水线产出的这一段正文用于盲评载荷测试，需足够长以满足最小汉字数校验。'.repeat(12)

/** 造一个最小项目：稿件含项目名、版本头、库内字样
 *  forbid：注入**指向形态**的禁忌面（`见 分析大纲 与 批判报告`）
 *  prose ：注入**散文形态**的禁忌面词（`局限性`，学术常用词——不应被拦）
 *  inject：注入任意文本（用于逐形态验证文件名/路径/显式指引） */
const mkProj = ({ forbid = false, prose = false, inject = '' } = {}) => {
  const d = tmp('lunheng-bpack-')
  const proj = join(d, 'run', '某测试项目')
  mkdirSync(join(proj, 'final'), { recursive: true })
  writeFileSync(join(proj, 'final', '定稿.md'),
    '> 版本：v18.80.4（DSH bundle 插件）\n\n# 标题\n\n' + BODY
    + (forbid ? '\n\n（见 分析大纲 与 批判报告）\n' : '\n')
    + (prose ? '\n本文的局限性在于样本量偏小。\n' : '')
    + inject
    + '\n项目 某测试项目 的内部说明。\n论衡流水线角色。\n')
  return { d, proj, out: join(d, '载荷'), map: join(d, '_QLT6-盲评', '映射表.md') }
}
const packArgs = (c, extra = []) => [PACK, '--project', c.proj, '--id', 'ACAD-T-01', '--out', c.out, '--map', c.map, ...extra]

test('载荷 ①：去标识生效（项目名 / 版本头 / 「论衡·流水线」字样全部抹除）+ 产物齐备', () => {
  const c = mkProj()
  try {
    const r = run(packArgs(c))
    assert.equal(r.code, 0, '正常打包应 exit 0：' + r.out + r.err)
    const payload = readFileSync(join(c.out, '盲评稿-ACAD-T-01.md'), 'utf8')
    assert.ok(!payload.includes('某测试项目'), '载荷不得含项目名')
    assert.ok(!/^>\s*版本[:：]/m.test(payload), '载荷不得含版本头行')
    assert.ok(!payload.includes('论衡') && !payload.includes('流水线'), '载荷不得含「论衡·流水线」字样')
    assert.ok(existsSync(join(c.out, '载荷清单-ACAD-T-01.txt')), '须产出载荷清单（供越界核对）')
    const map = readFileSync(c.map, 'utf8')
    assert.match(map, /ACAD-T-01/, '映射表须有该编号')
    assert.match(map, /某测试项目/, '映射表（钥匙）里保留项目名——它不进载荷')
    assert.match(r.out, /去标识记录/, '须打印去标识记录供人工复核')
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

test('载荷 ②：残留禁忌面文件名词 → **exit 1**（fail-closed，不放行可疑载荷）', () => {
  const c = mkProj({ forbid: true })
  try {
    const r = run(packArgs(c))
    assert.equal(r.code, 1, '含禁忌面词必须判失败：' + r.out)
    assert.match(r.out, /载荷自检未通过/)
    assert.match(r.out, /分析大纲|批判报告/, '须点名命中的禁忌面词')
    assert.ok(!existsSync(join(c.out, '盲评稿-ACAD-T-01.md')), '自检不过时**不得**留下载荷文件')
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

test('载荷 ②b：散文用词**不拦**（「本文的局限性」是学术常用词，非对产物的指向）——v18.80.4 实测纠正', () => {
  // 由来：首版口径是「出现禁忌面词就拦」，实测 `共锁-自愿性理论的第四象限` 初稿含「分析大纲」（散文），
  //   整批载荷被判 exit 1、无法开工——门退化为噪声。真源口径（handoff-check BR-A5）判的是**指向形态**。
  const c = mkProj({ prose: true })
  try {
    const r = run(packArgs(c))
    assert.equal(r.code, 0, '散文提及不得拦：' + r.out + r.err)
    assert.match(r.out, /散文提及（可见性，非硬门）：局限性/, '须登记为可见性清单，供人看一眼')
    const manifest = readFileSync(join(c.out, '载荷清单-ACAD-T-01.txt'), 'utf8')
    assert.match(manifest, /散文提及（\*\*可见性，非硬门\*\*）：局限性/, '载荷清单里也要如实登记')
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

test('载荷 ②c：**指向形态**仍必须拦（文件名 / 路径 / 显式指引）——三道形态逐一验', () => {
  for (const [label, payload] of [
    ['文件名', '\n\n见 `分析大纲.md`。\n'],
    ['路径', '\n\n详见 `audits/批判报告`。\n'],
    ['显式指引', '\n\n（参见 先行者清单）\n'],
  ]) {
    const c = mkProj({ inject: payload })
    try {
      const r = run(packArgs(c))
      assert.equal(r.code, 1, `${label}形态必须拦：` + r.out)
      assert.match(r.out, /指向/, `${label}：须说明拦的是「指向」形态`)
    } finally { rmSync(c.d, { recursive: true, force: true }) }
  }
})

test('载荷 ③：`--map` 与载荷同目录 → **exit 10 拒绝**（钥匙必须物理解耦）', () => {
  const c = mkProj()
  try {
    const r = run([PACK, '--project', c.proj, '--id', 'ACAD-T-01', '--out', join(c.d, '载荷'), '--map', join(c.d, '载荷', '映射表.md')])
    assert.equal(r.code, 10, '同目录必须拒绝：' + r.out)
    assert.match(r.out, /物理分离/)
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

test('载荷 ④：缺 --map → exit 10（钥匙没有默认值，防"顺手放在一起"）', () => {
  const c = mkProj()
  try {
    const r = run([PACK, '--project', c.proj, '--id', 'ACAD-T-01', '--out', c.out])
    assert.equal(r.code, 10)
    assert.match(r.out, /缺 --map/)
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

test('载荷 ⑤：重复打包同一编号未加 --force → 拒绝（编号一稿一号，重跑意味着上一份作废）', () => {
  const c = mkProj()
  try {
    assert.equal(run(packArgs(c)).code, 0)
    const again = run(packArgs(c))
    assert.equal(again.code, 1, '未加 --force 时不得静默覆盖：' + again.out)
    assert.equal(run(packArgs(c, ['--force'])).code, 0, '--force 应放行')
  } finally { rmSync(c.d, { recursive: true, force: true }) }
})

test('载荷 ⑥：禁忌面词表是**单一真源**（两个消费者 import 同一模块，任何一方都不得再持内联副本）', async () => {
  const mod = await import(pathToFileURL(SHARED).href)
  assert.equal(mod.BLIND_FORBIDDEN.length, 13, '词表项数应为 13（改 09 卡须同批改此表，并同步本条）')
  assert.ok(Object.isFrozen(mod.BLIND_FORBIDDEN), '词表应冻结，防运行期被改')

  // 两个消费者都必须**从共享模块取**，且不得再有内联字面量副本（有 = 两处实现，必漂）
  for (const [label, file] of [['handoff-check.mjs', HANDOFF], ['blind-review-pack.mjs', PACK]]) {
    const src = readFileSync(file, 'utf8')
    assert.match(src, /from\s+['"][^'"]*blind-forbidden\.mjs['"]/,
      `${label} 必须 import \`blind-forbidden.mjs\`（禁忌面词表的单一真源）`)
    assert.ok(!/const BLIND_FORBIDDEN\s*=\s*\[/.test(src),
      `${label} 里出现了**内联的 BLIND_FORBIDDEN 字面量**——两处实现必然漂，请改为 import 共享模块`)
  }
})
