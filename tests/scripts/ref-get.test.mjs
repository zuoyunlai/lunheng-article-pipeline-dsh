// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 ref-get 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/ref-get.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


// ── v18.22.2 CTX-3：ref-get.mjs（按需读抽取器）─────────────────────────────────────────────
// 为什么需要：文档让读者「按需读 X.md#anchor」，而 M-Gate-Algorithm.md / pipeline-readme.md
//   各约 97 KB——「找节」本身接近一次整读；成本模型 = 步数 × 每步上下文。
// 本组三条断言覆盖报告的 CTX-3 判据：
//   ① 抽取结果与「声明区间」自洽（bytes == 真字节、行数 == endLine-startLine+1）——防「声明的数和给的内容对不上」；
//   ② **两类锚点都要能取**：标题 slug + 显式 `<a id="…">`（实测教训：`#mgate` 是显式锚点，首版只扫标题会漏）；
//   ③ **锚点未命中 = exit 10**（硬边界：绝不返回空节——空节会被读成「这一节已读过」）。
test('v18.22.2 CTX-3 ref-get：区间自洽 + 两类锚点 + 未命中响亮失败', () => {
  const rg = join(SCRIPTS, 'ref-get.mjs')
  const doc = 'references/_shared/M-Gate-Algorithm.md'   // 97 KB 真实文档，文档里正是用 #mgate 引用它

  // ① 显式锚点（`<a id="mgate">`）——文档正在使用的那个
  const a = run([rg, doc, '#mgate', '--json'])
  assert.equal(a.code, 0, '显式锚点必须命中且 exit 0：' + a.out.slice(-300))
  const aj = parseJson(a)
  assert.equal(aj.kind, 'explicit', '#mgate 应识别为显式锚点')
  assert.equal(Buffer.byteLength(aj.text, 'utf8'), aj.bytes, '声明的 bytes 必须等于返回正文的真字节数')
  assert.equal(aj.text.split('\n').length, aj.endLine - aj.startLine + 1, '声明区间行数必须等于返回正文行数')
  assert.ok(aj.bytes < aj.totalBytes, '抽出的必须是一节而非全文')

  // ② 标题锚点——同一文档的 H3 节；且区间必须止于下一个同级/更高级标题（不得越界吞掉邻节）
  const h = run([rg, doc, '#exit-字段双语义定义v1800-新增p0-2', '--json'])
  assert.equal(h.code, 0, '标题锚点必须命中且 exit 0：' + h.out.slice(-300))
  const hj = parseJson(h)
  assert.equal(hj.kind, 'heading', '标题锚点应识别为 heading')
  assert.match(hj.text.split('\n')[0], /^###\s/, '返回正文首行必须就是该标题行')
  assert.ok(!/^##\s/m.test(hj.text), 'H3 节不得吞进任何 H2 标题（区间须止于同级/更高级标题前）')

  // ③ 未命中：必须 exit 10，且把可用锚点列出来（绝不返回空节）
  const miss = run([rg, doc, '#zhe-ge-mao-dian-bu-cun-zai'])
  assert.equal(miss.code, 10, '锚点未命中必须 exit 10（绝不静默返回空节）：' + miss.out.slice(-200))
  assert.match(miss.out, /锚点未命中/, '未命中必须在 stderr 明说')
  assert.match(miss.out, /#mgate/, '未命中必须列出可用锚点（便于改参数）')

  // ④ 路径错 = exit 10（与 M 门 1/2/3 的内容判定刻意分离）
  assert.equal(run([rg, 'references/不存在的文件.md', '#x']).code, 10, '文件不存在应 exit 10')
  assert.equal(run([rg, doc]).code, 10, '缺锚点参数应 exit 10')
  assert.equal(run([rg, doc, '--list', '#mgate']).code, 10, '--list 与锚点同时给应 exit 10')

  // ⑤ --list 必须给出「锚点 + 字节数」，且条数与 --json 的 listings 一致
  const l = run([rg, doc, '--list', '--json'])
  assert.equal(l.code, 0, '--list 应 exit 0')
  const lj = parseJson(l)
  assert.ok(Array.isArray(lj.sections) && lj.sections.length > 10, `--list 应列出全部锚点，实得 ${lj.sections?.length}`)
  assert.ok(lj.sections.every((s) => typeof s.bytes === 'number' && s.slug), '每条须含 slug 与 bytes')
  assert.ok(lj.sections.some((s) => s.via === 'explicit'), '--list 必须包含显式锚点（不能只列标题）')
})
