// 批次 30（2026-10-20 · 正文骨架真源批）：`references/_shared/正文骨架.md` 的三方对账
//
// 为什么需要：本批把「文类 → 正文节序列」这一事实从**三处手抄**收敛为一份真源
//   （旧形态：`QUICKSTART.md` 内联九节 + `templates/开题报告-template.md` 头部复述九节 +
//    `structure-check.mjs` 的 `KAITI_SECTIONS` 数组，三处只能靠人记得一起改）。
//   但**收敛本身不是机制**：新增的那张表如果没有机械对账，它就只是第四个手抄点。
//   故本文件锁三件事：
//     ① **活的对账**（不是文案断言）——用表里的节名造稿，跑 `structure-check --kaiti`，必须 PASS；
//        → 断言的是「门接受这张表写的序列」，而不是「表里出现了某串字」。
//     ② **展开件与真源同序**——`templates/开题报告-template.md` 的 `##` 标题（剥编号后）必须逐字等于表里的 `kaiti` 行。
//     ③ **不漏文类**——表的 code 集合必须**等于** `_shared/文类档案.md` 表格的 code 集合（缺行/多行都红）。
//   另加一条**防孤儿**：`QUICKSTART.md` 与 `文类档案.md` 必须指向 `正文骨架.md`
//   （判据与 `figure-template.test.mjs` 同源：模板存在但没人指向 = 存在也没人用）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, SCRIPTS, run, tmp } from './_fixtures.mjs'
import { stripMcDecor } from '../skills/lunheng-article-pipeline/scripts/_lib/sections.mjs'

const SK = join(ROOT, 'skills', 'lunheng-article-pipeline')
const REF = join(SK, 'references')
const SKELETON = join(REF, '_shared', '正文骨架.md')
const GENRES = join(REF, '_shared', '文类档案.md')
const TEMPLATE = join(REF, 'templates', '开题报告-template.md')
const STRUCT = join(SCRIPTS, 'structure-check.mjs')

/** 从 markdown 表格里取首列 `code`（形如 `| \`kaiti\` | … |`）。 */
const tableCodes = (md) =>
  md
    .split('\n')
    .map((l) => /^\|\s*`([^`]+)`\s*\|/.exec(l))
    .filter(Boolean)
    .map((m) => m[1])

/** 取表格行里第 n 列（0-based，按 `|` 切分后的下标，已去空白）。 */
const cell = (line, n) => {
  const parts = line.split('|').map((s) => s.trim())
  // 首尾为空串（行首/行尾的 `|`），故第 n 列 = parts[n + 1]
  return parts[n + 1] ?? ''
}

const skeletonMd = readFileSync(SKELETON, 'utf8')
const skeletonRows = skeletonMd.split('\n').filter((l) => /^\|\s*`[^`]+`\s*\|/.test(l))

/** 表里的 `kaiti` 行 → 节名数组（`研究背景 / 研究目的 / …` 按 ` / ` 切）。 */
const kaitiFromSkeleton = () => {
  const row = skeletonRows.find((l) => cell(l, 0) === '`kaiti`')
  assert.ok(row, '正文骨架.md 缺 `kaiti` 行——开题文类没有节序列登记')
  return cell(row, 1)
    .split(' / ')
    .map((s) => stripMcDecor(s))
    .filter(Boolean)
}

test('① 活的对账：按正文骨架.md 的 kaiti 行造稿，structure-check --kaiti 必须 PASS', () => {
  const secs = kaitiFromSkeleton()
  assert.ok(secs.length >= 9, `kaiti 行列出的节名过少（实测 ${secs.length}）——切分方式变了？`)
  const d = tmp('lunheng-b30-kaiti-')
  const f = join(d, '开题.md')
  writeFileSync(f, '# 开题报告\n\n' + secs.map((s) => `## ${s}\n\n本节内容 [L01]。\n`).join('\n'), 'utf8')
  const r = run([STRUCT, f, '--kaiti'])
  assert.equal(r.code, 0, '按表里的节序列写稿必须 PASS（表与门已漂移）：' + r.out.slice(0, 400))
  const j = JSON.parse(r.out.slice(r.out.indexOf('{')))
  assert.equal(j.severity, 'PASS', '九节应齐备：' + j.detail)
  assert.deepEqual(j.missing, [], '不应有缺节：' + JSON.stringify(j.missing))
})

test('② 展开件与真源同序：开题模板的 `##` 标题（剥编号）=== 表的 kaiti 行', () => {
  const secs = kaitiFromSkeleton()
  const headings = readFileSync(TEMPLATE, 'utf8')
    .split('\n')
    .map((l) => /^##\s+(.+)$/.exec(l))
    .filter(Boolean)
    .map((m) => stripMcDecor(m[1]))
  assert.deepEqual(headings, secs, '开题模板的九节标题与正文骨架.md 的 kaiti 行不一致——两者必须同一次提交一起改')
})

test('③ 不漏文类：正文骨架.md 的 code 集合 === 文类档案.md 表格的 code 集合', () => {
  const skeletonCodes = tableCodes(skeletonMd).sort()
  const genreCodes = tableCodes(readFileSync(GENRES, 'utf8')).sort()
  assert.ok(genreCodes.length >= 10, `文类档案表解析出的 code 过少（实测 ${genreCodes.length}）——表形态变了？`)
  assert.deepEqual(
    skeletonCodes,
    genreCodes,
    '两表 code 集合不等：新增文类须同时加正文骨架行；删/改 code 须同批改两表',
  )
})

test('④ 防孤儿：QUICKSTART 与 文类档案 都必须指向正文骨架.md', () => {
  const quick = readFileSync(join(SK, 'QUICKSTART.md'), 'utf8')
  const genres = readFileSync(GENRES, 'utf8')
  assert.match(quick, /正文骨架\.md/, 'QUICKSTART.md 必须指向正文骨架.md（kaiti 提示行是它的主入口）')
  assert.match(genres, /正文骨架\.md/, '文类档案.md §消费点索引 必须指向正文骨架.md（「结构门」列不展开节名）')
})
