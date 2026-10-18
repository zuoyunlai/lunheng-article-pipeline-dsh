// 反哺 R1/R3/R4/R5/R6 的机械面：`scripts/ref-verify.mjs`（引用机械核验）
//
// 本文件刻意**全程离线**：所有 CLI 用例都走 `--dry-run` 或「授权串禁跑」两条路径，
// 断言的是**解析/口径/降级**，不是 Crossref 的内容（联网用例单列 `tests/network/`，
// 由 `REFVERIFY_ONLINE=1` 才跑——见该目录 README）。
//
// 为什么逐条钉这些点（都来自对照核查的实测缺陷）：
//   ① `[J/OL]` 必须认——参考实现在这里退化成「把作者块当标题」，把真文献判成 not_found；
//   ② 索引段 + 条目段会**双份出现**同一 `[Lxx]`（实测 15 条被读成 32 条）；
//   ③ 年份必须按 `published-print` 优先——只取 `issued` 会把对的年份改错；
//   ④ 伪造题与真论文可能共 2 个 token（containment 0.67），短题必须近乎全等才算 partial；
//   ⑤ 无网/未授权 = `unverified`（exit 3），**绝不**写成 not_found（那是把基础设施故障读成造假）；
//   ⑥ **不设 exit 1**（脚本不做内容判定；写 1 必撞码）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp, mkProject } from '../_fixtures.mjs'

const SCRIPT = join(SCRIPTS, 'ref-verify.mjs')
const mod = await import('file://' + SCRIPT.replace(/\\/g, '/'))

const BRIEF_OK = '外部服务授权：检索=全网检索 / 推理=远程 provider / 脱敏=basic\n'
const BRIEF_LOCAL = '外部服务授权：检索=仅本地素材 / 推理=远程 provider / 脱敏=basic\n'

function mkFixture(brief, cardText, { withCard = true } = {}) {
  const { proj } = mkProject({ extra: ['literature'], prefix: 'lunheng-rv-' })
  if (brief !== null) writeFileSync(join(proj, '01-任务简报.md'), brief, 'utf8')
  if (withCard) writeFileSync(join(proj, 'literature', '文献卡.md'), cardText, 'utf8')
  return proj
}

const CARD_MIXED = `# 文献卡 — 夹具

## 📇 索引段

| 编号 | 作者 | 年份 | 主题 |
|---|---|---|---|
| [L01] | Glynn | 2024 | 索引段里的一行（必须被去重丢掉） |
| [L02] | 王少 | 2023 | 同上 |

### [L01] Academ-AI: documenting the undisclosed use of generative artificial intelligence
- **作者**: GLYNN A
- **年份**: 2024
- **DOI**: 10.1080/14703297.2023.2190148
- **GB/T 7714-2015 著录**: GLYNN A. Academ-AI: documenting the undisclosed use[J/OL]. arXiv, 2024. https://arxiv.org/abs/2411.15218.

### [L02] 王少. ChatGPT与学术不端治理：挑战与应对
- **作者**: 王少
- **年份**: 2023
- **DOI 或 URL**: 10.13718/j.cnki.xdsk.2023.05.014（预印本：https://example.org/x）
`

test('R1 解析：认三种条目形态 + 索引段去重 + [J/OL] 不吃亏', () => {
  const cards = mod.parseCards(CARD_MIXED)
  assert.equal(cards.length, 2, '索引段 2 行 + 条目 2 条 → 去重后必须只剩 2 条（实测曾 15→32）')
  assert.deepEqual(cards.map((c) => c.id), ['L01', 'L02'], '按编号排序')

  const t1 = mod.cardTitle(cards[0])
  assert.equal(t1.type, 'J/OL', '`[J/OL]` 必须被识别（参考实现不认它 → 把作者块当标题）')
  assert.match(t1.title, /^Academ-AI/, '标题必须来自著录行，不得是作者块')

  const t2 = mod.cardTitle(cards[1])
  assert.match(t2.title, /ChatGPT与学术不端治理/, '标题行式（`### [Lxx] 作者. 题名`）要剥掉作者前缀')

  assert.equal(mod.cardDoi(cards[1]), '10.13718/j.cnki.xdsk.2023.05.014', 'DOI 不得吞掉后续中文括注')
  assert.deepEqual(mod.cardSurnames(cards[0]).slice(0, 2), ['GLYNN', 'A'].filter((x) => x.length > 1), '姓在前时必须能取到 GLYNN')
})

test('R4 年份口径：published-print 优先于 issued', () => {
  const rec = {
    issued: { 'date-parts': [[2023, 3, 13]] },
    'published-print': { 'date-parts': [[2024, 3, 3]] },
    'published-online': { 'date-parts': [[2023, 3, 13]] },
  }
  const y = mod.pickYear(rec)
  assert.equal(y.year, 2024, 'GB/T 与 APA 都用出版年 → 必须取 print 年')
  assert.equal(y.source, 'published-print')
  assert.equal(mod.pickYear({ issued: { 'date-parts': [[2020]] } }).year, 2020, '缺 print 时回落 issued')
  assert.equal(mod.pickYear({}).year, null, '全缺 → null（不得瞎猜）')
})

test('判定从紧：伪造题不得靠 containment 混进 partial', () => {
  const card = { line: 'A non-existent paper that was never published anywhere', raw: '- **作者**: Nobody Q' }
  const sc = mod.scoreCandidate({ title: 'A non-existent genre', year: 2001, authors: '' }, card)
  assert.ok(sc.shared <= 2, '这两个题名最多共 2 个 token（实测 containment 0.67）')
  assert.equal(mod.judge(sc), 'not_found', '共享 2 个 token 的短题必须 not_found（否则伪造题会被报成 partial）')

  const same = mod.scoreCandidate({ title: 'ChatGPT and a New Academic Reality: Artificial Intelligence-Written Research Papers', year: 2023, authors: 'Lund, Wang' },
    { line: 'ChatGPT and a New Academic Reality: Artificial Intelligence-Written Research Papers', raw: '- **作者**: LUND B' })
  assert.equal(mod.judge(same), 'found', '整题重合 + 年份一致 + 作者命中 → found')
})

test('R5 A11：检索=仅本地素材 → 拒跑（unverified + exit 3 + 零请求）', () => {
  const proj = mkFixture(BRIEF_LOCAL, CARD_MIXED)
  const r = run([SCRIPT, proj, '--json'])
  assert.equal(r.code, 3, '未授权必须 exit 3（不是 0、不是 10）：' + (r.stdout || '').slice(-300))
  const o = parseJson(r)
  assert.equal(o.mode, 'local', '必须如实标 local 模式')
  assert.equal(o.authz.allowed, false)
  assert.equal(o.summary.unverified, o.checked, '全部条目 unverified，**绝不**写成 not_found')
  assert.equal(o.summary.not_found, 0, '基础设施/授权缺失不得被读成"文献不存在"')
})

test('无网降级：--dry-run 全部 unverified 且 exit 3（不是"找不到"）', () => {
  const proj = mkFixture(BRIEF_OK, CARD_MIXED)
  const r = run([SCRIPT, proj, '--dry-run', '--json'])
  assert.equal(r.code, 3, 'dry-run 未发请求 → 不得 exit 0')
  const o = parseJson(r)
  assert.equal(o.mode, 'local')
  assert.equal(o.total, 2)
  assert.equal(o.summary.unverified, 2)
  assert.match(JSON.stringify(o.authz), /全网检索/, '授权串要被读出来并落到报告里（可追溯）')
})

test('缺简报 = 未授权（不是默认允许）', () => {
  const proj = mkFixture(null, CARD_MIXED)
  const r = run([SCRIPT, proj, '--json'])
  assert.equal(r.code, 3, '缺 A11 串必须按未授权处理')
  const o = parseJson(r)
  assert.equal(o.authz.allowed, false)
  assert.match(String(o.authz.why), /简报/)
})

test('参数与路径错误 → exit 10；空卡 → exit 10', () => {
  const proj = mkFixture(BRIEF_OK, CARD_MIXED)
  assert.equal(run([SCRIPT]).code, 10, '缺位置参数必须 exit 10')
  assert.equal(run([SCRIPT, proj, '--bogus']).code, 10, '未知旗标必须 exit 10')
  assert.equal(run([SCRIPT, proj, '--max', 'abc']).code, 10, '--max 非数字必须 exit 10')
  const empty = mkFixture(BRIEF_OK, '# 空卡\n\n没有条目\n')
  assert.equal(run([SCRIPT, empty]).code, 10, '0 条 [Lxx] 必须 exit 10（不得静默产出空清单）')
})

test('⑥ 不设 exit 1：源码里不得出现 exit(1)（内容判定归 T7）', () => {
  const src = readFileSync(SCRIPT, 'utf8')
  const calls = [...src.matchAll(/process\.exit\(\s*([^)]*)\)/g)].map((m) => m[1].trim())
  assert.ok(calls.length > 0, '必须至少有一处显式 exit')
  assert.ok(!calls.some((c) => c === '1'), '不得出现 process.exit(1)：本脚本不做内容判定，1 必撞码')
  for (const c of calls) assert.match(c, /^(EXIT_USAGE|EXIT_INTERNAL|0|3)$/, `未登记的退出码：${c}`)
})
