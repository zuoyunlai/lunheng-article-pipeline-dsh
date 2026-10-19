// v19.19.3（反哺报告-2026-10-19 M1）回归网：**压缩轮候选清单可机械应用**。
//   病根：压缩轮是最贵的机械轮（xingbie 单篇压实/收口/引用闭环/收尾修复 = 34.3M，占 23.1%），
//   而它必须 spawn T5 的**唯一**原因是「清单只能由模型出」——脚本原来只产「残留风险清单」，
//   不产 `apply-diff` 可吃的四族条目。本批让脚本在 compress 方向直接出清单。
//   四条用例锁：① 只收「元话语整句」一档；② 四类不变量（引用/图位/判据句/数字）**从生产端就不产出**；
//   ③ 全文唯一出现才收（apply-diff 按 expect 命中次数断言）；④ 清单能被 apply-diff 真应用。
// 运行：node --test tests/m1-compression-candidates.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { run, parseJson, tmp, ROOT } from './_fixtures.mjs'

const S = (n) => join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', n)
const CYCLE = S('apply-compression-cycle.mjs')
const APPLY_DIFF = S('apply-diff.mjs')

const META_OK = '值得指出的是，本文的分析只覆盖公开材料。'
const META_WITH_REF = '需要指出的是，这一判断见 [D01] 的统计。'
const META_WITH_DIGIT = '总的来说，本轮数据为 3 条。'
const META_WITH_CRITERION = '必须指出的是，判据尚未统一。'

/** 目标 1000 字、正文 ~1150 汉字 → 必落「超阻塞线 +N 字」。 */
const mkDraft = (extra = '') => '# 标题\n\n## 摘要\n\n' + '摘'.repeat(20) + '\n\n'
  + '## 1 引言\n\n' + '汉'.repeat(1000) + '\n\n' + META_OK + META_WITH_REF + META_WITH_DIGIT
  + META_WITH_CRITERION + extra + '\n\n'

function mkProj({ draft } = {}) {
  const d = tmp('lunheng-m1-')
  const proj = join(d, 'run', 'proj')
  mkdirSync(join(proj, 'final'), { recursive: true })
  mkdirSync(join(proj, 'drafts'), { recursive: true })
  writeFileSync(join(proj, '01-任务简报.md'), '# 简报\n\n目标篇幅：1000 字\n', 'utf8')
  writeFileSync(join(proj, 'final', '定稿.md'), draft ?? mkDraft(), 'utf8')
  return { d, proj }
}

test('M1：压缩方向 → 产出 apply-diff 四族格式候选清单，且只收「元话语整句」', () => {
  const { d, proj } = mkProj()
  try {
    const j = parseJson(run([CYCLE, proj, '--skip-bundle']))
    assert.equal(j.gapDirection, 'compress', '夹具须落在超阻塞线：' + j.verdict)
    assert.equal(j.compressionCandidates.count, 1,
      '只应产出 1 条（带引用 / 带数字 / 含判据词 三条必须被排除）：' + JSON.stringify(j.compressionCandidates))
    const listPath = join(proj, 'drafts', '段级diff-v2.md')
    assert.ok(existsSync(listPath), '清单须落 drafts/段级diff-vN.md（N = 下一版）：' + j.compressionCandidates.file)
    const list = readFileSync(listPath, 'utf8')
    assert.match(list, /### \[P1-1\]/, '条目头须是 apply-diff 认的四族之一：' + list.slice(0, 300))
    assert.match(list, /- \*\*定位\*\*：第 \d+ 行/, '条目须带「定位」行：' + list.slice(0, 300))
    assert.match(list, /- \*\*修改\*\*：\s*$/m, '删除型条目的「修改」行须存在且内容为空（hasNew 语义）')
    assert.ok(list.includes(META_OK), '元话语句须进清单')
    for (const banned of [META_WITH_REF, META_WITH_DIGIT, META_WITH_CRITERION]) {
      assert.equal(list.includes(banned), false, '四类不变量保护的句子不得进清单：' + banned)
    }
    assert.equal(/\[(?:L|D|C)\d+\]/.test(list), false, '清单条目不得夹带文内引用（四族头 `[P1-n]` 除外）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('M1：全文重复出现的元话语句不得进清单（apply-diff 的 expect 语义要求唯一）', () => {
  const draft = mkDraft('\n\n' + META_OK + '\n\n')   // 同一句出现两次
  const { d, proj } = mkProj({ draft })
  try {
    const j = parseJson(run([CYCLE, proj, '--skip-bundle']))
    assert.equal(j.compressionCandidates.count, 0, '重复句必须被排除：' + JSON.stringify(j.compressionCandidates))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('M1：清单能被 apply-diff 真应用（原句消失、引用/数字/判据句原样保留）', () => {
  const { d, proj } = mkProj()
  try {
    const j = parseJson(run([CYCLE, proj, '--skip-bundle']))
    assert.ok(j.compressionCandidates.file, '前置：须先产出清单')
    const outFile = join(proj, 'drafts', '初稿-v2.md')
    const r = run([APPLY_DIFF, join(proj, 'final', '定稿.md'), j.compressionCandidates.file, '--out', outFile])
    assert.equal(r.code, 0, 'apply-diff 应用候选清单必须成功：' + r.out.slice(-400))
    const after = readFileSync(outFile, 'utf8')
    assert.equal(after.includes(META_OK), false, '被批准的元话语句必须已被删除')
    for (const keep of [META_WITH_REF, META_WITH_DIGIT, META_WITH_CRITERION, '[D01]']) {
      assert.ok(after.includes(keep), '受不变量保护的句子必须原样保留：' + keep)
    }
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('M1：--dry-run 只打印不落盘（dry-run 只影响写盘、不影响判定）', () => {
  const { d, proj } = mkProj()
  try {
    const j = parseJson(run([CYCLE, proj, '--skip-bundle', '--dry-run']))
    assert.ok(j.compressionCandidates.count >= 1, 'dry-run 也要算候选：' + JSON.stringify(j.compressionCandidates))
    assert.equal(j.compressionCandidates.file, null, 'dry-run 不得给落盘路径')
    assert.equal(existsSync(join(proj, 'drafts', '段级diff-v2.md')), false, 'dry-run 不得落盘')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
