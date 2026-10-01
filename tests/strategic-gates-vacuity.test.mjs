// §8.2 #18/#19 回归网（v18.62.4 新增 · 全量审计-v18.62.3 附录）
//
// **为什么需要**：这两条都属「**门看似在检、实际恒真/恒假**」——
//   · #18：`structure-check` 的讨论四要素里，「机制解释」的旧词表含 `表明/说明/由于`（中文行文无处不在）
//     → `discMissing` 永远到不了 4 → **「四要素全缺 → P0」是死档**（门写了却永不触发）。
//   · #19：`methodology-check` 的「软硬件环境」旧词表含**单字母 `R`**（被 `R²`/`R&D`/`Review` 命中）
//     与两字母 `lr`/`IV` → **虚增 `methodFound` → 方法节没写参数也被判 PASS**（方向相反的空转）。
// 两条都**双向**钉住：假阳性（泛用词/短记号）必须不被算作证据；真写法必须仍被识别。
// 若只钉一侧，下一次「收紧到过严」或「放宽回旧表」都无人发现。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, tmp } from './_fixtures.mjs'

const SC = join(SCRIPTS, 'structure-check.mjs')
const MC = join(SCRIPTS, 'methodology-check.mjs')

/** 造最小 IMRaD 稿：可注入讨论节与方法节正文。 */
function mkDraft(discussion, method) {
  const d = tmp('sc-')
  const body = [
    '# 标题', '', '## 摘要', '', '摘要。', '',
    '## 一、引言', '', '重要性：本领域受到关注。知识缺口：已有研究尚不足。本文提出框架。', '',
    '## 二、方法', '', method, '',
    '## 三、结果', '', '结果显示显著。', '',
    '## 四、讨论', '', discussion, '',
    '## 五、结论', '', '结论。', '',
    '## 参考文献', '', '[L01] 甲', '',
    '## 数据来源', '', '无。', '',
    '## 案例来源', '', '无。', '',
    '## 先行者文献', '', '无。', '',
    '## AI 使用声明', '', '本稿由 AI 辅助完成。', '',
  ].join('\n')
  const p = join(d, '定稿.md')
  writeFileSync(p, body)
  return { d, p }
}
/** 跑脚本并取 JSON（两脚本的 stdout 本就是 JSON；失败时返回 {}）。 */
function jsonOf(script, file) {
  let out
  try { out = execFileSync(process.execPath, [script, file], { encoding: 'utf8' }) }
  catch (e) { out = String(e.stdout || '') }
  const i = out.indexOf('{')
  if (i < 0) throw new Error(`无 JSON 输出：${out.slice(0, 200)}`)
  return JSON.parse(out.slice(i))
}

// ── #18 双向 ────────────────────────────────────────────────────────────────
test('#18 假阳性侧：讨论**只有泛用连接词**（表明/说明/由于/一致/相比）→ 机制解释与与既有比较必须**判缺**', () => {
  const { d, p } = mkDraft(
    '表 3 表明主效应稳定。上述结果说明模型可用。由于样本来自单一地区，结论需谨慎。'
    + '这一发现与常识一致，和其他指标相比表现更好。数据处理流程与此前一致。',
    '样本量 n = 320，采用分层抽样。使用 OLS 回归。',
  )
  try {
    const j = jsonOf(SC, p)
    const disc = j.checks['S-Discussion-4']
    assert.ok(disc, 'S-Discussion-4 必须在场')
    assert.ok(disc.missing.includes('机制解释'),
      '泛用词（表明/说明/由于）**不得**充作「机制解释」已写——否则该档恒真：' + JSON.stringify(disc))
    assert.ok(disc.missing.includes('与既有研究比较'),
      '泛用词（一致/相比）**不得**充作「与既有研究比较」已写：' + JSON.stringify(disc))
    // 这条是死档可达性的直接证据：三项缺 ⇒ 若再加一项缺即 P0
    assert.ok(disc.missing.length >= 3, '本夹具应至少缺 3 项（证明 4 项全缺的 P0 档可达）：' + JSON.stringify(disc))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('#18 真阳性侧：讨论**写了特征性短语**（机制/与既有研究/局限/未来）→ 必须判 PASS（不得收紧到过严）', () => {
  const { d, p } = mkDraft(
    '本文发现主效应稳定。与既有研究相比，本文结论呼应了前人的判断。'
    + '其机制在于信息不对称，这一路径可解释为成本转嫁。本研究局限在于样本单一，未来可进一步扩展。',
    '样本量 n = 320，采用分层抽样。使用 OLS 回归。',
  )
  try {
    const j = jsonOf(SC, p)
    const disc = j.checks['S-Discussion-4']
    assert.equal(disc.severity, 'PASS', '真写了四要素应 PASS：' + JSON.stringify(disc))
    assert.deepEqual(disc.missing, [], '不应报缺失：' + JSON.stringify(disc))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── #19 双向 ────────────────────────────────────────────────────────────────
test('#19 假阳性侧：方法节只有 `R²` / `Review` / `Already` → **不得**算作「软硬件环境」', () => {
  for (const body of ['模型拟合优度 R² 为 0.68，Review 了文献。', 'We already reviewed the data.']) {
    const { d, p } = mkDraft('讨论正文。', body)
    try {
      const j = jsonOf(MC, p)
      // 判据基准 = **真源数组** `checks['M-Form-12'].found`（不是全 JSON 搜词：该词也会作为**缺项**出现在 missing 里）
      const found = j.checks['M-Form-12'].found
      assert.ok(Array.isArray(found), 'M-Form-12 应有 found 数组：' + JSON.stringify(j.checks['M-Form-12']))
      assert.ok(
        !found.includes('软硬件环境'),
        `短记号（R²/Review/Already）不得充作「软硬件环境」已写——否则方法节不写参数也被判 PASS。`
          + `输入=${body}｜found=${JSON.stringify(found)}`,
      )
    } finally { rmSync(d, { recursive: true, force: true }) }
  }
})

test('#19 真阳性侧：方法节写了 `R 语言` / `Python` / `GPU` → 必须识别（不得收紧到过严）', () => {
  for (const body of ['使用 R 语言完成估计。', '使用 Python 与 GPU 训练。']) {
    const { d, p } = mkDraft('讨论正文。', body)
    try {
      const j = jsonOf(MC, p)
      assert.ok(
        j.checks['M-Form-12'].found.includes('软硬件环境'),
        `真写了软件/硬件应被识别。输入=${body}｜found=${JSON.stringify(j.checks['M-Form-12'].found)}`,
      )
    } finally { rmSync(d, { recursive: true, force: true }) }
  }
})

// ── #20 / #21 双向 ──────────────────────────────────────────────────────────
test('#21 假阳性侧：方法写 `logit`、结果写 `Logit` → **不得**判「未回链」（旧实现丢 `i` 旗标）', () => {
  const { d, p } = mkDraft('讨论正文。', '采用 logit 模型。样本量 n = 320，分层抽样，变量为因变量。')
  // 结果节需要出现 Logit——mkDraft 固定写「结果显示显著」，故这里单独造一份带结果节的稿
  const d2 = tmp('sc-')
  const body = [
    '# 标题', '', '## 摘要', '', '摘要。', '',
    '## 一、引言', '', '重要性：本领域受到关注。知识缺口：已有研究尚不足。本文提出框架。', '',
    '## 二、方法', '', '采用 logit 模型。样本量 n = 320，分层抽样，变量为因变量。', '',
    '## 三、结果', '', 'Logit 回归结果显示显著。', '',
    '## 四、讨论', '', '讨论正文。本文发现稳定，与既有研究相比一致，机制在于成本，局限是样本，未来可扩展。', '',
    '## 五、结论', '', '结论。', '',
    '## 参考文献', '', '[L01] 甲', '',
    '## 数据来源', '', '无。', '',
    '## 案例来源', '', '无。', '',
    '## 先行者文献', '', '无。', '',
    '## AI 使用声明', '', '本稿由 AI 辅助完成。', '',
  ].join('\n')
  writeFileSync(join(d2, '定稿.md'), body)
  try {
    void p
    const j = jsonOf(MC, join(d2, '定稿.md'))
    const m = j.checks['M-Exist-12']
    assert.equal(m.severity, 'PASS', '大小写差异不得判「未回链」（重编译须保留 `i` 旗标）：' + JSON.stringify(m))
    assert.ok(m.methodNamesFound.includes('logit'), '方法名应被识别：' + JSON.stringify(m))
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(d2, { recursive: true, force: true }) }
})

test('#20 空转侧：方法节**无表内方法名**（质性/人文稿或表外方法）→ 必须 **SKIP（未检）**，不得判 PASS', () => {
  for (const body of [
    '采用多元线性回归。样本量 n = 320，分层抽样，变量为因变量。',   // 表外方法名
    '采用深度访谈与扎根理论编码。样本量 n = 20，目的抽样。',          // 质性/人文
  ]) {
    const { d, p } = mkDraft('讨论正文。', body)
    try {
      const j = jsonOf(MC, p)
      const m = j.checks['M-Exist-12']
      assert.equal(
        m.severity, 'SKIP',
        `方法节无表内方法名时本项**未检**（旧实现 'length===0 || …' 恒真判 PASS）。输入=${body}｜${JSON.stringify(m)}`,
      )
      assert.notEqual(m.pass, true, 'SKIP 不得写成 pass:true')
      assert.match(String(m.note || ''), /未检|不适用/, 'SKIP 时 note 必须写明「未检/不适用」及该谁核：' + JSON.stringify(m))
      // SKIP 的退出码语义：**不得是干净的 0**。注意优先级 —— 若同时有 P0/P1，exit 取更高档（2/1），
      //   故这里断言的是「当本轮无 P0/P1 时，SKIP 必须把 exit 抬到 3」，与 g-audit-check 的 skipped 同判据。
      const sevs = Object.values(j.checks).map((c) => c.severity)
      if (!sevs.includes('P0') && !sevs.includes('P1')) {
        assert.equal(j.overall.exitCode, 3, 'SKIP 不得产出干净的 exit 0（未检 ≠ 通过）')
      } else {
        assert.notEqual(j.overall.exitCode, 0, 'SKIP 在场时 exit 不得为 0')
      }
    } finally { rmSync(d, { recursive: true, force: true }) }
  }
})

test('#17 不变量：g-audit-check 现不产出 P0（exit 2 为防御性保留位，由脚本内守卫看住）', () => {
  const src = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1],"utf8"))', join(SCRIPTS, 'g-audit-check.mjs')], { encoding: 'utf8' })
  const producers = [...src.matchAll(/severity:\s*'P0'/g)].length
  assert.equal(producers, 0, `g-audit-check 不应产出 P0（实测 ${producers} 处）；若新增 P0 产出者，必须同批更新头部退出码表`)
  assert.match(src, /p0Producers/, '必须保留不变量守卫：一旦出现 P0 产出者即响亮失败（exit 70），而不是留一个不可达档位')
})
