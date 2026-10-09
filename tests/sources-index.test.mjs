// sources-index（检索三线共享来源索引，v18.29.0 EFF-5）回归测试
//
// 锁四条口径：
//   · `--check` 只校验**行合法性**；**跨线重复只报不判错**（那是收益来源，不是缺陷）
//   · **缺分片 / 空分片不判错**（= 该线尚未登记）——与 M-Exist-10/11「缺输入记 N/A 且未检」同口径
//   · `--query` 按 url 去重并标出来源线；`--merge` 落盘 `sources.json` 且计数正确
//   · 退出码：0 成功 / 1 `--check` 发现不合法行 / 10 参数或路径错
// 运行：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, tmp } from './_fixtures.mjs'

const S = join(SCRIPTS, 'sources-index.mjs')

/** 造一个项目：写入若干分片行（`null` 表示该线不建文件）。 */
const mkProj = (shards) => {
  const d = tmp()
  mkdirSync(join(d, 'sources'), { recursive: true })
  for (const [line, rows] of Object.entries(shards)) {
    if (rows === null) continue
    writeFileSync(join(d, 'sources', `${line}.jsonl`), rows.join('\n') + (rows.length ? '\n' : ''))
  }
  return d
}
const OK = (url, title = '标题', summary = '摘要') => JSON.stringify({ url, title, fetchedAt: '2026-09-27', summary })

test('sources-index --check：合法分片 exit 0，且**跨线重复只报不判错**', () => {  const d = mkProj({ T1: [OK('https://a.example/1'), OK('https://b.example/2')], T2: [OK('https://b.example/2', '乙（T2 也抓到）')], T3: null })
  const r = run([S, d, '--check'])
  assert.equal(r.code, 0, '跨线重复不得判错（它是收益来源）：' + r.out.slice(-200))
  assert.match(r.out, /跨线重复 1 个/, '必须统计出重复数：' + r.out)
  assert.match(r.out, /该线尚未登记/, '缺分片必须如实说明而不是报错')
  const m = readFileSync(join(d, 'sources', 'T1.jsonl'), 'utf8')
  assert.ok(m.includes('a.example'), '分片内容不得被脚本改写')
})

test('sources-index --check：不合法行 → exit 1 并逐行给行号与原因', () => {
  const d = mkProj({ T1: [OK('https://a.example/1')], T2: ['{bad json}', JSON.stringify({ url: 'ftp://x/1', title: 't', fetchedAt: '2026-09-27', summary: 's' }), JSON.stringify({ url: 'https://c/1', title: '缺 summary', fetchedAt: '2026-09-27' })] })
  const r = run([S, d, '--check'])
  assert.equal(r.code, 1, '不合法行必须 exit 1：' + r.out.slice(-300))
  assert.match(r.out, /不是合法 JSON/)
  assert.match(r.out, /url 不是 http\(s\)/)
  assert.match(r.out, /缺必填键：summary/)
})

test('sources-index --query：按 url 去重、标出来源线、支持 needle 过滤', () => {
  const d = mkProj({ T1: [OK('https://a.example/1', '甲')], T2: [OK('https://a.example/1', '甲（T2）'), OK('https://z.example/9', '丙')] })
  const all = run([S, d, '--query'])
  assert.equal(all.code, 0)
  assert.match(all.out, /2 个来源/, '同 url 跨线只算一个来源')
  assert.match(all.out, /\[T1\+T2\]/, '必须标出该来源被哪几线登记过')
  const one = run([S, d, '--query', 'z.example'])
  assert.match(one.out, /1 个来源/)
  assert.match(one.out, /丙/)
})

test('sources-index --merge：落盘 sources.json 且计数正确（unique / perLine / crossLineDuplicates）', () => {
  const d = mkProj({ T1: [OK('https://a/1'), OK('https://b/2')], T2: [OK('https://b/2')], T3: [OK('https://c/3')] })
  const r = run([S, d, '--merge'])
  assert.equal(r.code, 0, r.out.slice(-200))
  const out = join(d, 'sources.json')
  assert.ok(existsSync(out), '必须生成 sources.json')
  const j = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(j.counts.perLine.T1, 2)
  assert.equal(j.counts.perLine.T3, 1)
  assert.equal(j.counts.total, 4)
  assert.equal(j.counts.unique, 3, '按 url 去重')
  assert.equal(j.counts.crossLineDuplicates, 1)
  assert.equal(j.entries.find((e) => e.url === 'https://b/2').lines.length, 2, '重复来源须保留来源线标记')
})

test('sources-index：参数/路径错一律 exit 10（未知参数 / 缺模式 / 多模式 / 目录不存在）', () => {
  const d = mkProj({ T1: [OK('https://a/1')] })
  assert.equal(run([S, d, '--nope']).code, 10, '未知参数')
  assert.equal(run([S, d]).code, 10, '缺模式')
  assert.equal(run([S, d, '--check', '--merge']).code, 10, '一次只跑一个模式')
  assert.equal(run([S, 'C:/__nope__/x', '--check']).code, 10, '目录不存在')
  assert.equal(run([S]).code, 10, '缺项目参数')
})

// ── v18.62.7（反哺 §A22）：**溯源字段 tool/engine/query** ─────────────────────────────────────
//   口径：**要么三个都不写**（旧格式行 → 软提示、不判红）**要么写齐**（写一个就必须三个全有）。
//   为什么：没有它们，「某条是不是用规定的检索源取的」在交付物里查不到（实测只能回翻 DSH 会话缓存）。
test('A22：溯源字段「要么都不写、要么写齐」；写齐则随 --merge 进 sources.json', () => {
  // ① 全缺（旧格式行）→ exit 0，且**软提示点名**（不判红：存量项目不该因此翻红）
  const d1 = mkProj({ T1: [OK('https://a/1')] })
  const r1 = run([S, d1, '--check'])
  assert.equal(r1.code, 0, '旧格式行（无溯源字段）不得判红：' + r1.out.slice(-200))
  assert.match(r1.out, /无溯源字段/, '必须软提示点名（否则「没标注」与「已标注」同形）：' + r1.out.slice(-200))

  // ② 三个写齐 → exit 0；--merge 后 sources.json 保留三字段（可核验「哪条由哪个工具/引擎/query 取得」）
  const full = JSON.stringify({ url: 'https://a/2', title: '标题', fetchedAt: '2026-09-27', summary: '摘要', tool: 'multi_search', engine: 'exa+tavily', query: 'AIGC 意向性' })
  const d2 = mkProj({ T1: [full] })
  assert.equal(run([S, d2, '--check']).code, 0, '三字段齐备应合法')
  const r2 = run([S, d2, '--merge'])
  assert.equal(r2.code, 0, r2.out.slice(-200))
  const j = JSON.parse(readFileSync(join(d2, 'sources.json'), 'utf8'))
  assert.equal(j.entries[0].tool, 'multi_search')
  assert.equal(j.entries[0].engine, 'exa+tavily')
  assert.equal(j.entries[0].query, 'AIGC 意向性')

  // ③ 写一个缺两个 → **不合法**（否则「写了一半」会被读成「已标注」）
  const part = JSON.stringify({ url: 'https://a/3', title: '标题', fetchedAt: '2026-09-27', summary: '摘要', tool: 'advanced_search' })
  const d3 = mkProj({ T1: [part] })
  const r3 = run([S, d3, '--check'])
  assert.equal(r3.code, 1, '溯源字段不齐必须判不合法：' + r3.out.slice(-200))
  assert.match(r3.out, /溯源字段不齐/)
  assert.match(r3.out, /engine,query/, '必须点名缺哪几个字段：' + r3.out.slice(-200))
})

// ── v18.78.0（反哺-v18.78.0-candidate F2）：**补检索分片 + 未识别分片** ─────────────────────────
//   病灶（实测 cn-llm-inference-cost-econ）：Phase 1.5 补检索产出 `sources/T1-补.jsonl`（5 行），
//   而 `LINES = ['T1','T2','T3']` 只认三份主分片 → 那 5 行**无声地不进 sources.json**，退出码仍 0。
//   判据：**目录里躺着没被读的分片，就不得算成功**（与 --merge 的「掉了数据必须让调用方看出来」同源）。
test('F2：补检索分片 T<n>-<后缀>.jsonl 纳入索引（归并入基础线），不再静默丢行', () => {
  const d = mkProj({ T1: [OK('https://a/1')], 'T1-补': [OK('https://b/2')] })
  const c = run([S, d, '--check'])
  assert.equal(c.code, 0, '补检索分片合法时不得判红：' + c.out.slice(-200))
  assert.match(c.out, /T1-补\.jsonl/, '--check 必须逐文件列出（否则读者看不到读了几份分片）：' + c.out)
  const m = run([S, d, '--merge'])
  assert.equal(m.code, 0, m.out.slice(-200))
  const j = JSON.parse(readFileSync(join(d, 'sources.json'), 'utf8'))
  assert.equal(j.counts.total, 2, '补检索段的 1 行必须进产物')
  assert.equal(j.counts.perLine.T1, 2, '补检索段归并入基础线 T1（line 标记保持三线语义）')
  assert.ok(j.entries.some((e) => e.url === 'https://b/2'), '补检索段的来源必须出现在 entries 里')
})

test('F2：未识别的 *.jsonl 分片不得静默忽略（--check 与 --merge 同判据）', () => {
  const d = mkProj({ T1: [OK('https://a/1')], T4: [OK('https://x/9')] })
  const c = run([S, d, '--check'])
  assert.equal(c.code, 1, '未识别分片 = 该文件的行全部没进索引 → 必须判红：' + c.out.slice(-300))
  assert.match(c.out, /分片文件名未识别/)
  assert.match(c.out, /T4\.jsonl/, '必须点名是哪个文件')
  const m = run([S, d, '--merge'])
  assert.equal(m.code, 1, '--merge 必须与 --check 同判据（模式不得改变同一缺陷的严重度）')
  assert.match(m.out, /整份分片文件未被识别/, '整份文件级缺口须与「少了几行」区分开：' + m.out.slice(-300))
})

test('F6：分片首行带 UTF-8 BOM 时剥除后照常解析（不再误报「不是合法 JSON」）', () => {
  const d = mkProj({ T1: [OK('https://a/1')] })
  const p = join(d, 'sources', 'T1.jsonl')
  writeFileSync(p, '\uFEFF' + readFileSync(p, 'utf8'))
  const r = run([S, d, '--check'])
  assert.equal(r.code, 0, 'BOM 是编码头问题，不该被报成 JSON 写坏：' + r.out.slice(-300))
  assert.doesNotMatch(r.out, /不是合法 JSON/)
  assert.match(r.out, /含 UTF-8 BOM/, 'BOM 必须显式点名（机检硬格式要求无 BOM）')
})

// ── v18.86.0-prep（台海反哺 F-14）：分片级「溯源混用」判据（兼容期 → 强制的渐进升级）──────────
//   行级规则「要么都不写、要么写齐」挡不住**半途而废**：同一分片里部分行带齐、部分行全缺，
//   两半各自「合法」，而换档可审计性已破坏（台海 55/55 缺 tool/engine/query 即此类）。
//   三条口径：纯旧 = 兼容期（软提示，不判红）｜纯新 = 通过｜**混用 = 不合法**（exit 1）。
const WITH_PROV = (url) => JSON.stringify({ url, title: '标题', fetchedAt: '2026-09-27', summary: '摘要', tool: 'advanced_search', engine: 'exa', query: '检索式' })

test('F-14：纯旧分片（全缺溯源）走**兼容期**——只软提示、不判红', () => {
  const d = mkProj({ T1: [OK('https://a.example/1'), OK('https://b.example/2')] })
  const r = run([S, d, '--check'])
  assert.equal(r.code, 0, '纯旧分片属兼容期，不得判不合法：' + r.out.slice(-300))
  assert.match(r.out, /无溯源字段/, '必须如实软提示（可见但不判红）')
  assert.doesNotMatch(r.out, /混用/)
})

test('F-14：纯新分片（全带齐溯源）通过', () => {
  const d = mkProj({ T1: [WITH_PROV('https://a.example/1'), WITH_PROV('https://b.example/2')] })
  const r = run([S, d, '--check'])
  assert.equal(r.code, 0, '纯新分片应通过：' + r.out.slice(-300))
  assert.doesNotMatch(r.out, /混用/)
})

test('F-14：**混用**分片（部分带齐 / 部分全缺）→ exit 1 并给出两半计数', () => {
  const d = mkProj({ T1: [WITH_PROV('https://a.example/1'), OK('https://b.example/2')] })
  const r = run([S, d, '--check'])
  assert.equal(r.code, 1, '混用必须判不合法：' + r.out.slice(-300))
  assert.match(r.out, /混用/, '必须点名「混用」')
  assert.match(r.out, /1 行带齐溯源（tool\/engine\/query）、1 行全缺/, '必须给出两半计数以便定位：' + r.out.slice(-400))
})

test('F-14：**跨分片**不构成混用（T1 纯新 / T2 纯旧 → 各自成立）', () => {
  const d = mkProj({ T1: [WITH_PROV('https://a.example/1')], T2: [OK('https://b.example/2')] })
  const r = run([S, d, '--check'])
  assert.equal(r.code, 0, '判据是**分片级**：跨分片纯新 + 纯旧并存不构成混用：' + r.out.slice(-300))
  assert.doesNotMatch(r.out, /混用/)
})
