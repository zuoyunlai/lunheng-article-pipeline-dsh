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

test('sources-index --check：合法分片 exit 0，且**跨线重复只报不判错**', () => {
  const d = mkProj({ T1: [OK('https://a.example/1'), OK('https://b.example/2')], T2: [OK('https://b.example/2', '乙（T2 也抓到）')], T3: null })
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
