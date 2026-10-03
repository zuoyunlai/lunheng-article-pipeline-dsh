// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 m-gate-accepted-gaps 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/m-gate-accepted-gaps.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('A3：ACCEPTED-GAPS 机读声明让「已接受缺口」的段不计弱段，且**留痕**（不消失）', () => {
  const { d, proj, fin, ev } = mkTriFixture()
  // 声明第二个段（2 字片段「乙段」——首版 ≥3 字闸门会把它静默丢掉，本用例正是钉这一点）
  writeFileSync(join(proj, 'analysis', '分析大纲.md'),
    '# 分析大纲\n\nACCEPTED-GAPS: 乙段\n\n> 理由：论点2 无 [Cxx] 角，属 Permanent Gap，主人已知接受。\n\n'
    + '## 承重墙清单\n\n| 承重证据 top1 | 服务于 |\n|---|---|\n| [L01] | 论点1 |\n')
  const it = mform8Of(fin, ev)
  assert.equal(it.pass, true, '声明后该段不得再算弱段：' + it.detail)
  assert.match(it.detail, /0 段覆盖 <2 类/, it.detail)
  // 「不计弱段」≠「消失」：豁免必须逐条带出处出现在 detail 里（同「未检 ≠ 通过」的判据）
  assert.match(it.detail, /已接受缺口/, '豁免必须留痕（不得静默消失）：' + it.detail)
  assert.match(it.detail, /乙段/, '留痕必须点名到具体段')
  assert.match(it.detail, /分析大纲\.md/, '留痕必须给出声明来源文件')
  // 未声明时行为不变（防滥用）：同一夹具去掉声明 → 回到 P1
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), '# 分析大纲\n\n## 承重墙清单\n\n| 承重证据 top1 | 服务于 |\n|---|---|\n| [L01] | 论点1 |\n')
  const it2 = mform8Of(fin, ev)
  assert.equal(it2.pass, false, '无声明时不得豁免（行为逐字不变）：' + it2.detail)
  assert.match(it2.detail, /1 段覆盖 <2 类/)
  rmSync(d, { recursive: true, force: true })
})

test('A3 边界：声明了但与任何段都对不上 → 软留痕提示（防「声明看似生效、实则空转」）', () => {
  const { d, proj, fin, ev } = mkTriFixture()
  writeFileSync(join(proj, 'analysis', '分析大纲.md'), '# 分析大纲\n\nACCEPTED-GAPS: 这个段名不存在\n')
  const it = mform8Of(fin, ev)
  assert.match(it.detail, /未匹配到任何段/, '对不上的声明必须被点名：' + it.detail)
  assert.equal(it.pass, false, '对不上的声明不产生任何豁免效果')
  rmSync(d, { recursive: true, force: true })
})