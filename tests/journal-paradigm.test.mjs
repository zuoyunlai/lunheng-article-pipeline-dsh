// journal-fit v18.59.0 范式标签回归测试（新增）
//
// 覆盖：
//   · 期刊数据库已加 7 列（含「范式标签」），E-14 不变量仍然成立
//   · journal-fit.mjs 正确解析第 7 列并暴露到 result.paradigm
//   · J-Paradigm 检查的三种判定路径：PASS / PARADIGM_UNRECOGNIZED / PARADIGM_MISMATCH
//   · 「兼容性」语义：文章 mixed 或期刊 mixed → 视作 PASS
//
// 运行：node --test tests/journal-paradigm.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { SCRIPTS, run, parseJson, ROOT } from './_fixtures.mjs'

// === 一、数据库列结构 ====================================================

test('P-1 数据库：中文 28 行 + 英文 12 行，每行均带 7 列（含「范式标签」）', () => {
  const text = readFileSync(ROOT + '/skills/lunheng-article-pipeline/references/_shared/期刊数据库.md', 'utf8')
  let sec = null
  const counts = {}
  for (const l of text.split('\n')) {
    const h = l.match(/^##\s+([一二三四五六七八九十]+)、(.+)$/)
    if (h) { sec = h[2].trim(); counts[sec] = 0; continue }
    if (!sec) continue
    if (/^\|/.test(l) && !/^\|[\s:|-]+\|$/.test(l)) counts[sec]++
  }
  // 中文 28 + 英文 12：扣掉表头 = 27 / 11（？不对，是扣 1）
  // 原 deriveJournalCounts：counts[k] - 1。中文 section 头行 1 条 + 数据 28 条 = 29。counts[k]=29, k-1=28
  const zh = (Object.keys(counts).find((x) => x.includes('中文')) && counts[Object.keys(counts).find((x) => x.includes('中文'))] - 1)
  const en = (Object.keys(counts).find((x) => x.includes('英文')) && counts[Object.keys(counts).find((x) => x.includes('英文'))] - 1)
  assert.equal(zh, 28, `中文应 28 行，实得 ${zh}`)
  assert.equal(en, 12, `英文应 12 行，实得 ${en}`)
})

test('P-2 数据库：每行第 7 列（非表头/分隔行）必须非空且在受控词表内', () => {
  const text = readFileSync(ROOT + '/skills/lunheng-article-pipeline/references/_shared/期刊数据库.md', 'utf8')
  const VOCAB = ['quantitative', 'qualitative', 'theoretical', 'mixed', 'case']
  let dataRows = 0, inData = false
  // 只看 §一 中文期刊 / §二 英文 SSCI 的主表（跳过 §四 扩展示例的 7 列表；后者列数不同）
  let sec = null
  for (const l of text.split('\n')) {
    const h = l.match(/^##\s+([一二三四五六七八九十]+)、(.+)$/)
    if (h) {
      const secTitle = h[2].trim()
      // 只在中文期刊 / 英文 SSCI 两节里做行校验
      sec = (secTitle.includes('中文期刊') || secTitle.includes('英文')) ? secTitle : null
      inData = false
      continue
    }
    if (!sec) continue
    if (/^\|[\s:|-]+\|$/.test(l)) { inData = true; continue }
    if (!inData) continue
    if (!/^\|/.test(l)) { inData = false; continue }
    const cells = l.split('|').map((c) => c.trim()).filter(Boolean)
    if (cells.length < 7) {
      assert.fail(`行缺第 7 列：${l}`)
    }
    const paradigm = cells[6]
    assert.ok(VOCAB.includes(paradigm), `范式标签「${paradigm}」不在受控词表：${l}`)
    dataRows++
  }
  assert.equal(dataRows, 40, `40 行期刊应全有范式标签，实得 ${dataRows}`)
})

// === 二、journal-fit.mjs 解析与 J-Paradigm 检查 ====================================

test('P-3 journal-fit：解析第 7 列 → result.paradigm + J-Paradigm.recognized=true', () => {
  const r = run([SCRIPTS + '/journal-fit.mjs', '管理世界'])
  assert.equal(r.code, 0, `管理世界应为 0，实得 ${r.code}：${r.out.slice(0, 300)}`)
  const j = parseJson(r)
  assert.equal(j.paradigm, 'mixed', `管理世界范式应为 mixed，实得 ${j.paradigm}`)
  assert.equal(j.checks['J-Paradigm'].pass, true)
  assert.equal(j.checks['J-Paradigm'].severity, 'PASS')
  assert.equal(j.checks['J-Paradigm'].info.recognized, true)
  assert.equal(j.checks['J-Paradigm'].info.journal, 'mixed')
  assert.equal(j.checks['J-Paradigm'].info.article, null, '主控未传 --style，article 应为 null')
  assert.deepEqual(j.checks['J-Paradigm'].detected, [])
})

test('P-4 journal-fit：英文期刊同样解析第 7 列', () => {
  const r = run([SCRIPTS + '/journal-fit.mjs', 'Journal of Marketing'])
  assert.equal(r.code, 0)
  const j = parseJson(r)
  assert.equal(j.paradigm, 'quantitative', 'JM 应为 quantitative')
  assert.equal(j.checks['J-Paradigm'].info.recognized, true)
})

test('P-5 journal-fit：5 类范式各抽 1 期刊，result.paradigm 必须对得上', () => {
  // 抽样 5 个有代表性的：quantitative / qualitative / theoretical / case / mixed
  // 注意：周期 > 12 月的期刊会触发 J-Cycle P1 → exit 1；本用例只断言范式字段解析，不断言 exit code。
  const samples = [
    ['心理学报', 'quantitative'],
    ['历史研究', 'qualitative'],
    ['中国社会科学', 'theoretical'],
    ['中国工业经济', 'case'],
    ['管理世界', 'mixed'],
  ]
  for (const [name, expected] of samples) {
    const r = run([SCRIPTS + '/journal-fit.mjs', name])
    const j = parseJson(r)
    assert.equal(j.paradigm, expected, `${name} 范式应为 ${expected}，实得 ${j.paradigm}；exit=${r.code}：${r.out.slice(0, 200)}`)
  }
})

// === 三、PARADIGM_UNRECOGNIZED 触发条件（不依赖 --style）=======================

test('P-6 PARADIGM_UNRECOGNIZED：数据库字段不在词表 → J-Paradigm=P2（不阻断 P1 通路，触发 exit 3）', () => {
  // 临时改数据库 + 改完恢复（不污染真源）
  const dbPath = ROOT + '/skills/lunheng-article-pipeline/references/_shared/期刊数据库.md'
  const original = readFileSync(dbPath, 'utf8')
  // 把「管理世界」的范式改成不在词表的值
  const tampered = original.replace('| 管理世界 | 管理学 | 6-12 月 | 实证研究 / 政策分析 | 严谨实证 | 待回填 | mixed |', '| 管理世界 | 管理学 | 6-12 月 | 实证研究 / 政策分析 | 严谨实证 | 待回填 | bogus_paradigm |')
  assert.notEqual(tampered, original, '测试夹具替换必须真生效（防 paper tiger）')
  writeFileSync(dbPath, tampered, 'utf8')
  try {
    const r = run([SCRIPTS + '/journal-fit.mjs', '管理世界'])
    // P2 不进 P1 档：exitCode 走 3 分支（仅 P2/soft/SKIP），不是 1（P1）
    assert.equal(r.code, 3, `P2 应触发 exit 3（仅软提示）；实得 ${r.code}`)
    assert.notEqual(r.code, 1, 'P2 绝不能误判为 P1')
    assert.notEqual(r.code, 2, 'P2 绝不能误判为 P0')
    const j = parseJson(r)
    assert.equal(j.paradigm, 'bogus_paradigm', '范式应原样透传')
    assert.equal(j.checks['J-Paradigm'].severity, 'P2', '非词表 → P2')
    assert.equal(j.checks['J-Paradigm'].info.recognized, false)
    assert.equal(j.checks['J-Paradigm'].pass, false, 'P2 也算 not pass')
    assert.equal(j.checks['J-Paradigm'].detected.length, 1)
    assert.equal(j.checks['J-Paradigm'].detected[0].code, 'PARADIGM_UNRECOGNIZED')
    assert.match(j.checks['J-Paradigm'].detected[0].desc, /bogus_paradigm/)
  } finally {
    writeFileSync(dbPath, original, 'utf8')   // **必恢复**（写盘污染测试，P0 事故源）
  }
})
