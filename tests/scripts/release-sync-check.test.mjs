// v19.19.1（验收复现批 A-4）：`release-sync-check` 的三向判定（纯函数，不碰 git / 网络 / 盘）。
//
// 病灶（2026-10-19 验收复现）：v19.19.0 的工具面缺陷修在源码 19.19.1 里、带回归测试，但
// **npm latest 与已装 profile 都还是 19.19.0** → 「验收通过」测的是上一版产物。
// 当时的核对只覆盖 loaded == onDisk（两侧都 19.19.0），没覆盖 onDisk 与 HEAD 的关系。
//
// 判据（本文件钉住的语义）：**唯一决定退出码的是「产物与源码同版」**；「待发版」（HEAD 领先 tag、
// registry 还没有本版）是**预期态**，只进 warnings，不判失败——否则发布链每次都会亮「习以为常的红」。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { evaluate, resolveProfileVersion } from '../../scripts/release-sync-check.mjs'

const atTag = { state: 'at-tag', tag: 'v19.19.1' }

test('同版 + 已打通点 + registry 一致 → ok，无问题无提示', () => {
  const r = evaluate({
    pkgVersion: '19.19.1',
    git: atTag,
    profile: { state: 'same', version: '19.19.1', path: '/p/node_modules/lunheng-article-pipeline/package.json' },
    registry: { state: 'same', latest: '19.19.1', dsh: '19.19.1' },
  })
  assert.equal(r.ok, true)
  assert.equal(r.problems.length, 0)
  assert.equal(r.warnings.length, 0)
})

test('产物落后一版 → 不 ok（这是本条门存在的唯一理由）', () => {
  const r = evaluate({
    pkgVersion: '19.19.1',
    git: atTag,
    profile: { state: 'drift', version: '19.19.0', path: '/p/node_modules/lunheng-article-pipeline/package.json' },
  })
  assert.equal(r.ok, false)
  assert.equal(r.problems.length, 1)
  assert.equal(r.problems[0].kind, 'drift')
  assert.match(r.problems[0].detail, /19\.19\.0/, '问题描述必须写出实际版本')
})

test('找不到已装产物 → 不 ok（不能把「没装」读成「同版」）', () => {
  const r = evaluate({
    pkgVersion: '19.19.1',
    git: atTag,
    profile: { state: 'not-found', version: null, tried: 4 },
  })
  assert.equal(r.ok, false)
  assert.equal(r.problems[0].kind, 'not-installed')
})

test('待发版（HEAD 领先 tag + registry 尚无本版）→ ok，但两条提示都在', () => {
  const r = evaluate({
    pkgVersion: '19.19.1',
    git: { state: 'ahead', tag: 'v19.19.1', ahead: 3 },
    profile: { state: 'same', version: '19.19.1' },
    registry: { state: 'missing', latest: '19.19.0', dsh: '19.19.0' },
  })
  assert.equal(r.ok, true, '待发版是预期态，不得判红')
  assert.equal(r.warnings.length, 2)
  assert.deepEqual(r.warnings.map((w) => w.kind), ['ahead', 'missing'])
})

test('HEAD 落后于 tag → 提示（tag 指向未来，这不该发生）', () => {
  const r = evaluate({
    pkgVersion: '19.19.1',
    git: { state: 'behind', tag: 'v19.19.1', behind: 2 },
    profile: { state: 'same', version: '19.19.1' },
  })
  assert.equal(r.ok, true)
  assert.equal(r.warnings[0].kind, 'behind')
})

test('无 tag（首版）与分叉都要能被识别出来', () => {
  const noTag = evaluate({ pkgVersion: '20.0.0', git: { state: 'no-tag', tag: 'v20.0.0' }, profile: { state: 'same', version: '20.0.0' } })
  assert.equal(noTag.ok, true)
  assert.equal(noTag.warnings[0].kind, 'no-tag')
  const diverged = evaluate({ pkgVersion: '20.0.0', git: { state: 'diverged', tag: 'v20.0.0' }, profile: { state: 'same', version: '20.0.0' } })
  assert.equal(diverged.warnings[0].kind, 'diverged')
})

test('resolveProfileVersion：候选全落空 → not-found，且如实报试过几个', () => {
  const r = resolveProfileVersion('lunheng-article-pipeline', ['/definitely/not/here-a', '/definitely/not/here-b'])
  assert.equal(r.state, 'not-found')
  assert.equal(r.tried, 2)
  assert.equal(r.version, null)
})

test('registry 有更高版本 → 提示 newer（不是最新版就别宣称已发）', () => {
  const r = evaluate({
    pkgVersion: '19.19.1',
    git: atTag,
    profile: { state: 'same', version: '19.19.1' },
    registry: { state: 'newer', latest: '19.20.0', dsh: '19.20.0' },
  })
  assert.equal(r.warnings[0].kind, 'newer')
})
