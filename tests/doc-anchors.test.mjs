// P1-6 回归：`M-Gate-Algorithm.md` 必须能用**族级短锚点**按需取节（而不是整读）。
// 病灶：文档教 agent 用 `#mgate`「只取该节」，而 `#mgate` 是全文级显式锚点（99.7%）——
//   所谓「按需读」零收益。修法是给四个族加短锚点 `<a id="mform|mexist|mintegrity|mfact">`，
//   并让 SKILL 指向族级锚点。本文件只钉「锚点存在且确实收窄」这一件事。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, ROOT } from './_fixtures.mjs'

const S = (n) => join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', n)
const REFGET = S('ref-get.mjs')
const DOC = 'skills/lunheng-article-pipeline/references/_shared/M-Gate-Algorithm.md'

test('P1-6：族级短锚点存在，且每个都真的收窄（< 50% 全文）', () => {
  for (const a of ['mform', 'mexist', 'mintegrity']) {
    const r = run([REFGET, DOC, `#${a}`])
    assert.equal(r.code, 0, `锚点 #${a} 必须可解析：` + r.out.slice(0, 200))
    const m = /本节占 ([\d.]+)%/.exec(r.out)
    assert.ok(m, `ref-get 须报出「本节占比」（#${a}）：` + r.out.slice(0, 200))
    assert.ok(Number(m[1]) < 50, `#${a} 占全文 ${m[1]}%（应 < 50%，否则「按需读」等于整读）`)
  }
})

test('P1-6：全文级 #mgate 仍在（兼容旧引用），但 SKILL 已不再教它', () => {
  const r = run([REFGET, DOC, '#mgate'])
  assert.equal(r.code, 0, '#mgate 必须保留（旧文档/旧派发话术仍可能引用）')
  const skill = readFileSync(join(ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md'), 'utf8')
  assert.match(skill, /#mform/, 'SKILL 必须指向族级锚点 #mform')
  // 判据 = 「ref-get 的示例锚点不得是 #mgate」——用「取节示例」这一形态判，避免误伤「不要用 #mgate」的告警句
  assert.doesNotMatch(skill, /ref-get\.mjs[^\n]*\s#mgate\b/, 'SKILL 的取节示例不得用 #mgate（全文锚点）')
})
