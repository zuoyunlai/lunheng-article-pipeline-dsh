// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 count-chars 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/count-chars.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'



test('count-chars：缺「## 摘要」时正文口径必须显式标记 degraded（不得静默退化）', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, '# 标题\n\n正文若干字。\n\n## 参考文献\n\n[L01] 某文献\n')
  const r = run([join(SCRIPTS, 'count-chars.mjs'), f])
  assert.equal(r.code, 0)
  const j = parseJson(r)
  assert.equal(j.degraded, true, '应带 degraded 标记')
  assert.match(j.degradedReason, /摘要/)
  rmSync(d, { recursive: true, force: true })
})

test('count-chars：--full 不应带 degraded 标记', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  writeFileSync(f, '# 标题\n\n正文若干字。\n')
  const r = run([join(SCRIPTS, 'count-chars.mjs'), f, '--full'])
  const j = parseJson(r)
  assert.equal(j.degraded, undefined)
  rmSync(d, { recursive: true, force: true })
})

// v18.2.3（主人授权修订；依据 2026-09-12 全量测试后主人反问「字数限定仅指正文吗」的取证）：
//   `--summary` 曾用**含「摘要/关键词」的列表**求 body 终点 → 命中 `## 关键词` 即截断
//   → `body.hanChars` 只剩摘要正文（实测 243 vs 默认口径 5112，**差 21 倍**），
//   而脚本头注释写「--summary …（**T7/T8 一眼可见结构**）」→ T7/T8 照注释取用会把长文判成
//   「仅 4% 篇幅」并下达错误的 P0 精简指令。**单跑任一模式都自洽，只有跨路径对账能抓**。
test('count-chars：--summary 的 body.hanChars 必须等于默认口径（v18.2.3 跨路径对账）', () => {
  const d = tmp()
  const f = join(d, 'x.md')
  // 该排布刻意复现「关键词把 body 截断」：摘要 → 关键词 → 正文 → 文末五节
  writeFileSync(f, [
    '# 标题', '', '## 摘要', '', '摘要正文若干字。', '',
    '## 关键词', '', '关键词若干；词二；词三', '',
    '## 一、导论', '', '正文段落若干字。'.repeat(20), '',
    '## 参考文献', '', '[L01] 某文献', '',
    '## 数据来源', '', '[D01] 某数据', '',
    '## 案例来源', '', '[C01] 某案例', '',
    '## 先行者文献', '', '[先01] 某先行者', '',
    '## AI 使用声明', '', 'AI 辅助声明若干字。', '',
  ].join('\n'))
  const def = parseJson(run([join(SCRIPTS, 'count-chars.mjs'), f]))
  const sum = parseJson(run([join(SCRIPTS, 'count-chars.mjs'), f, '--summary']))
  assert.equal(sum.body.hanChars, def.hanChars,
    `--summary body 必须与默认口径同源（默认 ${def.hanChars} vs summary ${sum.body.hanChars}）`)
  // 结构性佐证：body 必须**大于**摘要节（含关键词段 + 正文），旧版 bug 下 body == 摘要节
  assert.ok(sum.body.hanChars > sum.endnotes['摘要'],
    `body 应含关键词与正文（> 摘要节），实得 body=${sum.body.hanChars} / 摘要=${sum.endnotes['摘要']}`)
  // v18.2.3 附带修正：分节字数不再计入节标题自身的汉字（与 sectionsByHeading 口径统一）
  const kwByHeading = sum.sectionsByHeading.find((s) => s.title === '关键词')
  assert.equal(sum.endnotes['关键词'], kwByHeading.hanChars,
    'sections{} 与 sectionsByHeading 的口径必须一致（均不含标题）')
  rmSync(d, { recursive: true, force: true })
})
