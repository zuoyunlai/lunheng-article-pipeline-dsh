// v18.80.1（全量审查修订批）**第 3 批 · 结构重构**回归网。
//
// 本批三类改动的共同特征：**改动本身很小，但改错了不会有任何门发现**——
//   ① preset 与包根 patch 的**装载语义**此前不一致（preset 缺行级门控与 kill switch）→ 一键退路失效；
//   ② `lunheng-stats` 的**路径归一转**此前无条件压低大小写 → POSIX 下「仅差大小写的真实目录」被判为包含；
//   ③ H2 伦理脱敏标记的**三个口径**（候选数混进替换数 / 计数被门控吞掉 / 低置信单独触发注入）——
//      三者互相纠缠，只改其中一处会「修一半」（本批实测：v18.80.0 的 P1-2 修了「静默」却造出「噪声」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './_fixtures.mjs'

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')
const jsExprs = (yaml) => [...yaml.matchAll(/!!js\s+"([^"]+)"/g)].map((m) => m[1])
const norm = (s) => s.replace(/\s+/g, ' ').trim()
/** 把 YAML 里的 `!!js` 表达式求值为 JS（注入一个假的 `process.env`）。 */
const evalIn = (expr, env) => new Function('process', `return (${expr})`)({ env })

// ─────────────────── ① preset ↔ 包根 patch：装载语义必须同源 ───────────────────

test('第3批①：preset 的三行门控与三档 kill switch 必须与包根 patch 同源', () => {
  const patch = read('cordis.patch.yml')
  const preset = read('examples/preset/agent-tiered/cordis.yml')

  // (a) 行级门控：preset 必须有三行 `disabled`，且表达式与 patch 的逐字相同
  const gates = (yaml) => [...yaml.matchAll(/disabled:\s*!!js\s+"([^"]+)"/g)].map((m) => norm(m[1]))
  const pg = gates(patch)
  const rg = gates(preset)
  assert.equal(rg.length, 3,
    `preset 的三行 \`- insert:\` 必须各有行级门控 \`disabled\`（否则行本身无法被 \`LUNHENG_TIERING=off\` 关掉），实得 ${rg.length} 行`)
  assert.equal(new Set(rg).size, 1, '三行门控表达式必须同一（与包根 patch 同源）')
  assert.ok(pg.includes(rg[0]),
    'preset 的门控表达式必须与包根 `cordis.patch.yml` 的**逐字相同**——两处语义分叉时，'
    + '「preset 路径的 off 一键退路」会静默失效（本批实测到的正是这一形态）')

  // (b) kill switch：三档 `agentOptions` 都必须带 `LUNHENG_TIERING === 'off'`
  const opts = jsExprs(preset).filter((e) => e.includes('=>'))
  assert.equal(opts.length, 3, `preset 须有三档 agentOptions，实得 ${opts.length}`)
  for (const o of opts) {
    assert.match(o, /LUNHENG_TIERING === 'off'/,
      '每档 agentOptions 必须带 kill switch：`off` 时模型选项须清空（与包根 patch 同源）')
  }

  // (c) **行为**（不只看字面）：默认禁用 / off 优先 / 设任一档即装载
  assert.equal(evalIn(rg[0], {}), true, '默认（不设任何 LUNHENG_*）必须**不装载**三行（preset.yml 自述「显式开启才装载」）')
  assert.equal(evalIn(rg[0], { LUNHENG_TIERING: 'off', LUNHENG_RETRIEVAL_PROVIDER: 'P' }), true,
    '`LUNHENG_TIERING=off` 优先级最高——即便同时设了 provider 也必须禁用')
  assert.equal(evalIn(rg[0], { LUNHENG_RETRIEVAL_PROVIDER: 'P' }), false, '设任一档 provider 必须装载')
  for (const o of opts) {
    const own = o.match(/e\.(LUNHENG_[A-Z]+)_PROVIDER/)[1]   // 按**该档自己的** env 前缀断言，不串味
    assert.equal(evalIn(o, { LUNHENG_TIERING: 'off', [`${own}_PROVIDER`]: 'P' }), undefined,
      `\`off\` 下 ${own} 档的模型选项必须清空（一键退路生效）`)
    assert.deepEqual(evalIn(o, { [`${own}_PROVIDER`]: 'P' }), { provider: 'P' },
      `${own} 档设了 provider 时必须生效`)
    assert.equal(evalIn(o, {}), undefined, `${own} 档未设任何 env 时必须返回 undefined`)
  }
})

// ─────────────────── ② 路径归一转：win32 平台门 ───────────────────

test('第3批②：lunheng-stats 的路径归一转必须受 win32 平台门控（与 run-path-fence.norm 同口径）', () => {
  const src = read('skills', 'lunheng-article-pipeline', 'scripts', 'lunheng-stats.mjs')
  assert.match(src, /process\.platform === 'win32' \? s\.toLowerCase\(\) : s/,
    '必须**按平台**决定是否压低大小写（POSIX 路径大小写敏感，无条件 toLowerCase 会把「仅差大小写的真实目录」判为包含）')
  // 判据只扫 **`rpNorm` 的函数体**：文件里还有别的 `toLowerCase()`（如按 severity 字符串归桶），
  //   它们与路径归一无关——把整个文件当扫描面是**假阳性**来源（本用例第二版即踩到）。
  const fnStart = src.indexOf('const rpNorm')
  const fnEnd = src.indexOf('const aBase')
  assert.ok(fnStart !== -1 && fnEnd > fnStart, '须能切出 `rpNorm` 的函数体（实现变更时须同批更新本用例）')
  const fn = src.slice(fnStart, fnEnd)
  const lowers = fn.split('\n').filter((l) => l.includes('toLowerCase()') && !/^\s*\/\//.test(l))
  assert.ok(lowers.length > 0, '本用例须至少能看见一处 toLowerCase()（否则判据空跑）')
  for (const l of lowers) {
    assert.match(l, /win32/,
      `\`toLowerCase()\` 必须与 win32 判据同行（否则 POSIX 下围栏可被大小写差异目录绕过）：${l.trim()}`)
  }
  const fence = read('lib', 'run-path-fence.mjs')
  assert.match(fence, /process\.platform === 'win32' \? s\.toLowerCase\(\) : s/,
    '真源 `lib/run-path-fence.mjs` 的同口径判据必须在场——两处必须能各自复核')
})

// ─────────────────── ③ H2 标记的三个口径（报告 §B14） ───────────────────

test('第3批③：H2 标记的三个口径必须同时成立（byType 排除 person / 计数不受门控 / 低置信不单独触发）', () => {
  const src = read('lib', 'index.js')

  // (1) 候选数不得混进「替换」括号：`person === personHigh + personLow`
  assert.match(src, /k !== 'personLow' && k !== 'person'/,
    '`byType` 必须同时排除 `personLow` **与 `person`**——`person = personHigh + personLow`，'
    + '把它印在「命中替换 N 处」里等于把候选数当替换数报（实测出现过「替换 8 处（person=129）」）')

  // (2) 低置信候选不得**单独**触发注入（否则每次中文读取都注入一行近零信息标记）
  assert.match(src, /const actionableReviews = deduped\.filter\(\(r\) => String\(r\?\.kind \|\| ''\) !== 'person-low-confidence'\)/,
    '注入条件必须把 `person-low-confidence` 类复核项排除——候选数仍留在 `ethicsSanitized.counts.personLow` 与工具面，不丢信息')
  assert.ok(!/const actionable = [^\n]*lowCandidates > 0/.test(src),
    '`actionable` 不得再含 `lowCandidates > 0`（姓氏正则对技术文本精度极低：实测 9.5 KB 技术表格 61 个候选、真名 0 个）')

  // (3) 聚合必须移出 `textChanged` 门控（默认形态下低置信不改写正文 → 旧写法使 personLow 恒 0）
  assert.ok(!/if \(textChanged \|\| hookRewrite\) \{/.test(src),
    '聚合不得再被 `textChanged` 门控——v18.80.0 P1-2 要传出的「扫到多少候选」在该门控下**永不出现**')
})
