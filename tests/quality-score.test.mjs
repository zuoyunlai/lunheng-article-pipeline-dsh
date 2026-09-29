// quality-score（文章质量回归评分，v18.24.0 QLT-1）回归测试
//
// 每一组都锁一条**口径**（口径错会让分数失去意义，且不会自己报错）：
//   · 可复现：同产物两次跑分数与分量逐项一致
//   · N/A 不入分母但必须报 coverage（只报分数不报覆盖率 = 给「什么都不做」满分）
//   · 分数只反映**硬失败**（P0/P1 / 结构缺项）；P2 候选单列、不扣分
//   · 体例不适用（无 IMRaD 节）→ structure N/A 而不是 0 分
//   · 本门是**度量不是闸门**：分数再低也 exit 0；参数/路径错才 exit 10
//   · `--baseline` 给逐分量差异（机制改动前后对照的载体）
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, mkProject } from './_fixtures.mjs'

const Q = join(SCRIPTS, 'quality-score.mjs')
const DRAFT_ENDNOTES = '\n\n## 参考文献\n\n[L01] a\n[L02] b\n[L03] c\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'

/** 造一个最小「完整项目」：定稿 + 三卡 + 简报 + 交付说明（可选 G14 报告）。 */
const mkQProject = ({ g14 = false, deliver = true, methods = false, brief = true } = {}) => {
  const { d, proj, fin, ev, aud } = mkProject({ audits: true })
  mkdirSync(aud, { recursive: true })
  const draft = join(fin, '定稿.md')
  writeFileSync(draft, '# 标题\n\n## 摘要\n\n摘要。\n\n## 一、' + (methods ? '研究设计' : '导论') + '\n\n'
    + '汉字内容填充。'.repeat(80) + '[L01] [D01]。\n' + DRAFT_ENDNOTES)
  if (brief) writeFileSync(join(proj, '01-任务简报.md'), '- **篇幅**：**500 字**\n')
  writeFileSync(join(ev, '文献卡.md'), '# 文献卡\n\n### [L01] 甲\n- 标题：甲\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n> **截止**：2026-09-19\n\n### [D01] 甲\n- **时效评级**：🟢 ≤2 年\n')
  writeFileSync(join(ev, '案例卡.md'), '# 案例卡\n\n### [C01] 甲\n- **时间窗口**：2024-01-01 ~ 2024-02-01\n- **检索截止**：2026-09-19\n- **来源谱系（≥2 独立来源）**：\n  - 甲源 <https://a.example/1>\n  - 乙源 <https://b.example/2>\n')
  if (deliver) writeFileSync(join(fin, '交付说明.md'), '# 交付说明\n\n## 1. 项目概况\n\nx\n')
  if (g14) writeFileSync(join(aud, 'G14-检测报告-v1.md'), '# G14 检测报告\n\n**整体判定**：✅ **Pass**（0-2 类）\n')
  return { d, proj, draft, fin, ev, aud }
}

test('quality-score：同一产物两次跑 → 分数与逐分量完全一致（可复现，QLT-1 判据）', () => {
  const f = mkQProject({ g14: true })
  const a = parseJson(run([Q, f.proj]))
  const b = parseJson(run([Q, f.proj]))
  assert.equal(a.score, b.score, '同产物两次跑分数必须一致')
  assert.deepEqual(a.components.map((c) => [c.id, c.ratio]), b.components.map((c) => [c.id, c.ratio]), '逐分量也必须一致')
  assert.equal(a.coverage, b.coverage)
  rmSync(f.d, { recursive: true, force: true })
})

test('quality-score：分数只反映硬失败——P2 候选与 G14 Warning 之外的口径不得混入', () => {
  // 定稿 480 汉字 / 简报目标 500 字 → G8 在区间内（PASS）；把目标改成 200 字（低于 MIN 300 会被拒）
  //   → 改用 300 字目标 + 480 字正文 → 超上界 ×1.05 = P2 候选。此时 g-audit 应为「无硬失败」= ratio 1
  const f = mkQProject({ g14: true })
  writeFileSync(join(f.proj, '01-任务简报.md'), '- **篇幅**：**300 字**\n')
  const j = parseJson(run([Q, f.proj]))
  const ga = j.components.find((c) => c.id === 'g-audit')
  assert.equal(ga.applicable, true)
  assert.equal(ga.ratio, 1, 'G8 越限只是 P2 候选 → g-audit 不得扣分：' + JSON.stringify(ga.evidence))
  assert.ok(ga.evidence.soft.length >= 1 || ga.detail.includes('P2'), '但必须把候选单列出来：' + ga.detail)
  rmSync(f.d, { recursive: true, force: true })
})

test('quality-score：缺 G14 报告 / 缺证据包 → 如实 N/A（不给 0 分）且 coverage 下降 + 低覆盖告警', () => {
  const f = mkQProject({ g14: false, brief: false })
  const j = parseJson(run([Q, f.proj]))
  const ids = j.na.map((x) => x.id)
  assert.ok(ids.includes('G14'), '无 G14 报告 → G14 必须 N/A：' + JSON.stringify(j.na))
  assert.ok(ids.includes('g-audit'), '缺简报 → G 项机检必须 N/A（不拿默认目标假装核过）')
  assert.ok(j.coverage < 0.8, `覆盖率应低于 0.8（实测 ${j.coverage}）`)
  assert.match(j.coverageWarning, /适用权重仅/, '低覆盖必须给显式告警（防「只报分数」误读）')
  assert.ok(!j.components.some((c) => c.id === 'G14' && c.ratio === 0), 'N/A 不等于 0 分')
  rmSync(f.d, { recursive: true, force: true })
})

test('quality-score：非 IMRaD 体例（无方法/结果节）→ structure 判 N/A 而不是 0 分', () => {
  const f = mkQProject({ methods: false })
  const j = parseJson(run([Q, f.proj]))
  const st = j.components.find((c) => c.id === 'structure')
  assert.equal(st.applicable, false, '理论/评论体例不得被结构门判负：' + JSON.stringify(st))
  assert.match(st.naReason, /非 IMRaD 体例/)
  rmSync(f.d, { recursive: true, force: true })

  // 有「研究设计」节 → 适用（且标题带序号前缀也必须识别出来）
  const g = mkQProject({ methods: true })
  const j2 = parseJson(run([Q, g.proj]))
  assert.equal(j2.components.find((c) => c.id === 'structure').applicable, true,
    '「一、研究设计」这类带序号前缀的标题必须被识别（实测 startsWith 判据 6/6 项目误判）')
  rmSync(g.d, { recursive: true, force: true })
})

test('quality-score：本门是**度量不是闸门**——分数再低也 exit 0；参数/路径错才 exit 10', () => {
  const f = mkQProject()   // 无 G14、无简报 → 分数偏低
  const r = run([Q, f.proj])
  assert.equal(r.code, 0, `度量门必须 exit 0（实测 ${r.code}）：` + r.out.slice(-300))
  const low = parseJson(r)
  assert.ok(low.score !== null && low.score < 80, '该夹具应得低分（用来证明低分不影响退出码）')

  for (const args of [['C:/__nope__/x'], [f.proj, '--nope'], [f.proj, '--report'], [f.proj, '--baseline', 'C:/__nope__/b.json']]) {
    assert.equal(run([Q, ...args]).code, 10, `参数/路径错须 exit 10：${args.join(' ')}`)
  }
  rmSync(f.d, { recursive: true, force: true })
})

test('quality-score：缺 final/定稿.md → exit 10（评分对象不存在，不得给 0 分蒙混）', () => {
  const f = mkQProject()
  rmSync(f.draft)
  const r = run([Q, f.proj])
  assert.equal(r.code, 10)
  assert.match(r.out, /缺 final\/定稿\.md/)
  rmSync(f.d, { recursive: true, force: true })
})

test('quality-score --baseline：给逐分量差异（机制改动前后对照的载体）', () => {
  const f = mkQProject({ g14: true })
  const basePath = join(f.d, 'baseline.json')
  writeFileSync(basePath, JSON.stringify(parseJson(run([Q, f.proj])), null, 2))

  // 同产物 → 分数差 0、各分量差 0
  const same = parseJson(run([Q, f.proj, '--baseline', basePath]))
  assert.equal(same.baseline.scoreDelta, 0, '同产物对照差异必须为 0')
  assert.ok(same.baseline.perComponent.every((c) => c.delta === null || c.delta === 0), '逐分量差异必须为 0')

  // 改产物（删 G14 报告 → 该分量变 N/A）→ 必须能看出「变为不适用」
  rmSync(join(f.aud, 'G14-检测报告-v1.md'))
  const after = parseJson(run([Q, f.proj, '--baseline', basePath]))
  const g14 = after.baseline.perComponent.find((c) => c.id === 'G14')
  assert.match(String(g14.note), /变为不适用/, '分量适用性变化必须显式标注（否则差异会被读成质量下降）')
  rmSync(f.d, { recursive: true, force: true })
})

test('quality-score：G14 报告无判定行也无「命中 N 类」→ N/A（不猜）', () => {
  const f = mkQProject({ g14: true })
  writeFileSync(join(f.aud, 'G14-检测报告-v1.md'), '# G14 检测报告\n\n（本报告没有给判定）\n')
  const j = parseJson(run([Q, f.proj]))
  const g14 = j.components.find((c) => c.id === 'G14')
  assert.equal(g14.applicable, false, '读不到判定就必须 N/A，不得猜 Pass：' + JSON.stringify(g14))
  assert.match(g14.naReason, /读不到判定行/)
  rmSync(f.d, { recursive: true, force: true })
})

test('quality-score：G14 判定三档映射（Pass=1 / Warning=0.6 / Fail=0）', () => {
  const map = { Pass: 1, Warning: 0.6, Fail: 0 }
  for (const [word, want] of Object.entries(map)) {
    const f = mkQProject({ g14: true })
    writeFileSync(join(f.aud, 'G14-检测报告-v1.md'), `# G14 检测报告\n\n**整体判定**：${word}\n`)
    const j = parseJson(run([Q, f.proj]))
    assert.equal(j.components.find((c) => c.id === 'G14').ratio, want, `${word} 应映射为 ${want}`)
    rmSync(f.d, { recursive: true, force: true })
  }
})

test('quality-score：报告文件真的写盘（--report）且不改动被评产物', () => {
  const f = mkQProject({ g14: true })
  const out = join(f.d, 'score.json')
  const before = readFileSync(f.draft, 'utf8')
  const r = run([Q, f.proj, '--report', out])
  assert.equal(r.code, 0)
  const j = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(typeof j.score, 'number')
  assert.equal(readFileSync(f.draft, 'utf8'), before, '评分不得改动被评产物')
  rmSync(f.d, { recursive: true, force: true })
})

// ── v18.48.0（反哺 F-AM / F-AR）：G14 分量读数两条口径的回归锁 ──
// 锁的口径：
//   ① **判定词大小写归一**（F-AM）——报告里写全大写 `PASS` 时，不得被读成「非 Pass」而把分量打成 0
//      （实测：题2 分档臂 69.2 应为 80.9；不修则 A/B 会得出「分档臂崩跌 15.4 分」的错误结论）；
//   ② **判定行 ↔ 8 类摘要表必须交叉校验**（F-AR）——不一致时**暴露冲突证据**，**不静默改分**
//      （实测：对照臂题1 判定行写 Warning／命中 3 类，而其类别表只列 1 类命中 → 按闸门阈值应为 Pass）。
const mkG14 = (body) => {
  const f = mkQProject({ g14: false })
  writeFileSync(join(f.aud, 'G14-检测报告-v9.md'), body)
  return f
}
const g14Row = (label, cls, hit, state) => `| ${label} | ${cls} | ${hit} | ≥3 | ${state} |\n`

test('quality-score（F-AM）：判定行写**全大写** `PASS` → G14 分量仍须为 1（大小写归一）', () => {
  const f = mkG14('# G14\n\n**整体判定**：⚠️ **PASS**（命中 0 类）\n\n'
    + '| 维度 | 类别 | 命中 | 阈值 | 状态 |\n|---|---|---|---|---|\n'
    + g14Row('学术模板语', 'G14-A', '否', '✅ Pass'))
  const j = parseJson(run([Q, f.proj]))
  const g = j.components.find((c) => c.id === 'G14')
  assert.equal(g.ratio, 1, '全大写 PASS 归一后应等于 Pass → ratio 1（修复前会读成 0）')
})

test('quality-score（F-AR）：判定行与类别表不一致 → 暴露 g14_verdict_conflict，且**不静默改分**', () => {
  const f = mkG14('# G14\n\n**整体判定**：⚠️ **Warning**（命中 3 类）\n\n'
    + '| 维度 | 类别 | 命中 | 阈值 | 状态 |\n|---|---|---|---|---|\n'
    + g14Row('学术模板语', 'G14-A', '否', '✅ Pass')
    + g14Row('句式同质化', 'G14-B', '否', '✅ Pass')
    + g14Row('学术套话高频', 'G14-C', '**否（擦边）**', '✅ Pass')
    + g14Row('三项排比', 'G14-E', '**是**', '⚠️ **命中** 4 处'))
  const j = parseJson(run([Q, f.proj]))
  const g = j.components.find((c) => c.id === 'G14')
  assert.ok(g.evidence.g14_verdict_conflict, '应暴露 g14_verdict_conflict 证据字段')
  assert.equal(g.evidence.g14_verdict_conflict.tableLevel, 'Pass', '表命中 1 类 → 反推应为 Pass')
  assert.equal(g.ratio, 0.6, '**不静默改分**：仍按判定行给 Warning 的分量（由 T8/主人裁定）')
})

test('quality-score（F-AR 反向控制组）：判定行与类别表**一致** → 不得误报冲突', () => {
  const f = mkG14('# G14\n\n**整体判定**：⚠️ **Warning**（命中 3 类）\n\n'
    + '| 维度 | 类别 | 命中 | 阈值 | 状态 |\n|---|---|---|---|---|\n'
    + g14Row('句式同质化', 'G14-B', '**形式命中 / 实质归一豁免**', '⚠️ 形式命中')
    + g14Row('学术套话高频', 'G14-C', '**是**', '❌ **HIT**')
    + g14Row('三项排比', 'G14-E', '**是**', '❌ **HIT** 22 处累计'))
  const j = parseJson(run([Q, f.proj]))
  const g = j.components.find((c) => c.id === 'G14')
  assert.equal(g.evidence.g14_verdict_conflict, undefined,
    '表命中 3 类 = 判定行档位（Warning）→ 不得报冲突（防「狼来了」把冲突标记变成噪音）')
  assert.equal(g.ratio, 0.6, '档位不变 → 分量仍为 0.6')
})