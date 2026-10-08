// 模型路由 · **版本号解析**回归（v18.80.1+v · 独立审计批 4 · 4.2）
//
// **为什么需要**（实测病灶，不是假想）：旧 `versionOf` 的兜底式 `/(\d+(?:\.\d+)?)\s*$/` 对
//   `claude-haiku-4-5-20251001` 抓到的是**日期后缀 `20251001`** → `version = 20251001`；
//   而 `scoreOf` 里有 `s += 0.3 * c.version` → 该项贡献 **+6,075,300 分**，把推理 / 上下文全部维度淹没。
//   **实测后果**：审计档（需求 =「顶配防漏判、**不得为省钱降档**」）给出的主选是
//   `claude-haiku-4-5`（小参数快模型），而 `claude-opus-4-8` 落到兜底。
// 判据：**排序项必须与它声称衡量的东西相关**——一个能被 id 里任意数字串放大的项不是「版本偏好」，是噪声。
//
// 本组用例同时钉住两处：① 日期后缀不得被当版本；② 版本项**有上限夹取**（即便出现没预料到的 id 形态，
// 它也最多是温和 tie-break，不能压过能力维度）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp } from './_fixtures.mjs'

/** 造一个含「日期后缀 id + opus 级 + haiku 级」的候选池 */
const mkHome = (models) => {
  const d = tmp('lunheng-mr-')
  const home = join(d, 'dshhome')
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'settings.yaml'), [
    'agent-default-model:',
    '  provider: pool-x',
    '  model: claude-opus-4-8',
    'llm-pi-ai:',
    '  providers:',
    '    pool-x:',
    '      displayName: Pool X',
    '      baseURL: https://api.example.com/v1',
    '      models:',
    ...models.flatMap((m) => [`        - id: ${m}`, '          contextWindow: 200000']),
    '',
  ].join('\n'))
  return { d, home }
}
const route = (home) => {
  const r = run([join(SCRIPTS, 'model-routing.mjs'), '--dsh-home', home, '--no-probe', '--json'])
  assert.equal(r.code, 0, '应正常出报告：' + r.out.slice(0, 300))
  const j = parseJson(r)
  return Object.fromEntries(j.routing.map((x) => [x.tier, x]))
}
const full = (home) => {
  const r = run([join(SCRIPTS, 'model-routing.mjs'), '--dsh-home', home, '--no-probe', '--json'])
  assert.equal(r.code, 0, r.out.slice(0, 300))
  return parseJson(r)
}

test('R1【核心回归】：审计/强档**不得**被日期后缀 id 抢走 —— 应选 opus 级而非 haiku 级', () => {
  const { d, home } = mkHome(['claude-haiku-4-5-20251001', 'claude-opus-4-8', 'deepseek-v4-pro-260425'])
  try {
    const byTier = route(home)
    assert.notEqual(byTier.audit.pick, 'claude-haiku-4-5-20251001',
      '审计档需求是「顶配防漏判、不得为省钱降档」——选到 haiku 级即说明排序被日期后缀污染：' + byTier.audit.pick)
    assert.equal(byTier.audit.pick, 'claude-opus-4-8', '审计档应选 opus 级：' + byTier.audit.pick)
    assert.equal(byTier.strong.pick, 'claude-opus-4-8', '强推理档同样应选 opus 级：' + byTier.strong.pick)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('R2：**6 位 YYMMDD** 后缀同样不得被当版本（`deepseek-v4-pro-260425`）', () => {
  // 只有「快模型 + 带日期后缀」与「强模型 + 无后缀」两类时，强档必须选强模型
  const { d, home } = mkHome(['glm-5.3-flash-260425', 'claude-opus-4-8'])
  try {
    const byTier = route(home)
    assert.equal(byTier.audit.pick, 'claude-opus-4-8',
      'flash 级不得因日期后缀压过 opus 级：' + byTier.audit.pick)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('R3：检索档仍**按「便宜快」**取向（修复不得把三档拉成同一个模型）', () => {
  const { d, home } = mkHome(['claude-haiku-4-5-20251001', 'claude-opus-4-8'])
  try {
    const byTier = route(home)
    assert.equal(byTier.retrieval.pick, 'claude-haiku-4-5-20251001',
      '检索档需求是「便宜快」——haiku 级正解；若这里也变成 opus，说明修过头了：' + byTier.retrieval.pick)
    assert.notEqual(byTier.audit.pick, byTier.retrieval.pick, '三档不应塌缩成同一个模型')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('R4：正常语义版本（`X-Pro-3` / `M2.7` / `v4`）解析不回归', () => {
  const { d, home } = mkHome(['X-Pro-3', 'X-Mini-1'])
  try {
    const byTier = route(home)
    assert.equal(byTier.audit.pick, 'X-Pro-3', 'Pro 级应胜 Mini 级：' + byTier.audit.pick)
    assert.equal(byTier.retrieval.pick, 'X-Mini-1', '检索档应取 Mini 级：' + byTier.retrieval.pick)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 档位策略可满足性（批 4 · 4.1）──────────────────────────────────────────────
// 审计 P1-5 说「每档 ≥2 候选」是策略 ②/③ 的前置而**无人校验**。修法不是再加一条规则，而是把它变成
//   **机器可读的可满足性判定**（`strategyVerdict`）：单 provider 多模型 → ② 可满足、③ 不可满足；
//   两 provider → ③ 可满足；候选 <2 → 连 ② 都不满足。三条用例把这三态钉住。
test('S1：**单 provider + 多模型** → 同平台分档可满足，跨平台分档**不可满足**（且说明原因）', () => {
  const { d, home } = mkHome(['model-a', 'model-b', 'model-c'])
  try {
    const sv = full(home).strategyVerdict
    assert.equal(sv.inherit.allowed, true, '策略 ① 恒可满足')
    assert.equal(sv.samePlatform.allowed, true, '每档 ≥2 候选 → 同平台应可满足：' + sv.samePlatform.why)
    assert.equal(sv.crossPlatform.allowed, false, '只有一个 provider → 跨平台不应声称可满足')
    assert.match(sv.crossPlatform.why, /provider/, '须说明不可满足的原因：' + sv.crossPlatform.why)
    assert.ok(sv.perTier.every((x) => x.candidateCount >= 2), JSON.stringify(sv.perTier))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S2：**两 provider** → 跨平台分档可满足', () => {
  const d = tmp('lunheng-mr2-')
  const home = join(d, 'dshhome')
  try {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'settings.yaml'), [
      'agent-default-model:', '  provider: p1', '  model: m1', 'llm-pi-ai:', '  providers:',
      '    p1:', '      baseURL: https://a.example.com/v1', '      models:',
      '        - id: m1', '          contextWindow: 200000',
      '        - id: m2', '          contextWindow: 200000',
      '    p2:', '      baseURL: https://b.example.com/v1', '      models:',
      '        - id: n1', '          contextWindow: 200000',
      '        - id: n2', '          contextWindow: 200000', '',
    ].join('\n'))
    const sv = full(home).strategyVerdict
    assert.equal(sv.crossPlatform.allowed, true, '两 provider 且每档 ≥2 → 跨平台应可满足：' + sv.crossPlatform.why)
    assert.ok(sv.perTier.every((x) => x.distinctProviders >= 2), JSON.stringify(sv.perTier))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('S3：**只有一个模型** → 同平台分档也不满足前置（「没有兜底」）', () => {
  const { d, home } = mkHome(['only-one'])
  try {
    const sv = full(home).strategyVerdict
    assert.equal(sv.samePlatform.allowed, false, '候选 <2 时不得声称同平台分档可满足：' + sv.samePlatform.why)
    assert.match(sv.samePlatform.why, /不满足前置|候选/, sv.samePlatform.why)
    assert.equal(sv.crossPlatform.allowed, false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
