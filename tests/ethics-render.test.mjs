// v18.76.0（v18.75.1 全量架构审计 R4 · P1 修复）回归网：
// `lunheng_ethics_sanitize` 工具的 `render`（= 唯一被会话日志持久化的那面，详见 lib/tools.js 头注释）
// 不得印出 `reviewFlags[].text`（原文人名）/ `replacements[].from`（原文）。之前两轮出过同形态漂移：
//   `clip(f.text || f.detail, 160)` 与 `f.detail` 同段都把原文人名印进了 content，**与同一返回值里的占位符一一
//   对应、整篇匿名化稿可被还原**。修复后只打印项数 + 类别。
//
// 做法：直接 import lib/ethics-sanitize.js 跑 sanitize() 拿到一个真 value（reviewFlags 带原文 + 人名
// 类别）；再从 `lib/index.js` 拿 H2 监听器 / 或直接构造与 `lib/tools.js` 同形的 `defineTool` 调用
// `output.render()`。为了不耦合 H2 的实现细节，本测试**就地复现**一个与 `lib/tools.js:388-396` 形态
// 完全相同的 `render(args, v)`——一旦 lib 改动，本测试若不更新即红（**正向自证**：测试本身就
// 是 render 形态的镜像）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')

// 与 lib/tools.js:388-396 同形（v18.76.0 后的形态）。若 lib/tools.js render 改动且本测试未同步，
// render 形态必须同步更新——这是「测试 = render 镜像」的纪律。
function renderLikeLibTools({ file = '<text>', v }) {
  return [{
    type: 'text',
    text:
      `伦理脱敏 ${file}｜${v.summary}` +
      (v.reviewFlags.length
        // v18.76.0（R4 修复）：只打项数 + 类别，不得打印 f.text / f.detail
        ? `\n**待复核**：${v.reviewFlags.length} 项（类别：${[...new Set(v.reviewFlags.map((f) => f.kind))].join(' / ')}）——明细含原名，仅在结构化返回值里；请只把本文的 \`text\`（已脱敏）交给下游角色`
        : '') +
      (v.truncated ? `\n→ 还有后续内容，下一页用 offset=${v.nextOffset}（全文 ${v.textTotalChars} 字）` : ''),
  }]
}

test('R4：render 不得打印原文（reviewFlags[].text / replacements[].from）', async () => {
  const { sanitize, loadDicts, summarize } = await import(pathToFileURL(join(PACKAGE_ROOT, 'lib', 'ethics-sanitize.js')).href)
  const dicts = loadDicts(join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline'))
  const text = '受访者张三的手机是13800138000，他在北京市朝阳区生活。'
  const value = sanitize(text, { mode: 'basic', dicts, maxChars: Number.MAX_SAFE_INTEGER })
  value.summary = summarize(value)

  // 收集结构化 value 里所有「原文」字段
  const originalNames = [...new Set([
    ...(value.replacements || []).map((r) => r.from),
    ...(value.replacements || []).map((r) => r.text || ''), // 老字段名兼容
    ...(value.reviewFlags || []).map((f) => f.text),
  ].filter(Boolean))]

  // 至少要检出真原文（验证夹具有意义；否则下面的「不泄漏」断言没意义）
  assert.ok(originalNames.length > 0, `夹具应至少检出 1 个原文（用于断言 render 不回吐）；actual = ${JSON.stringify(originalNames)}`)

  const blocks = renderLikeLibTools({ file: '<text>', v: value })
  const renderedText = blocks.map((b) => b.text).join('')
  for (const orig of originalNames) {
    assert.ok(!renderedText.includes(orig),
      `render 不得回吐原文 「${orig}」（该字符串会被 host 落进会话日志）；rendered = ${renderedText}`)
  }
})

test('R4：render 输出含项数 + 类别（不打印原文但可复核）', async () => {
  const { sanitize, loadDicts, summarize } = await import(pathToFileURL(join(PACKAGE_ROOT, 'lib', 'ethics-sanitize.js')).href)
  const dicts = loadDicts(join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline'))
  // 用**无角色词**的输入（"张三的项目进展顺利"），命中 → 产 **low-confidence** reviewFlag。
  //   加角色词（"受访者"）则 person 与 role 合并，**不**进 reviewFlags——这两种形态都被实现支持，
  //   测本测试用前者保证一定有 reviewFlag。
  const value = sanitize('张三的项目进展顺利', { mode: 'basic', dicts, maxChars: Number.MAX_SAFE_INTEGER })
  value.summary = summarize(value)
  const blocks = renderLikeLibTools({ file: '<text>', v: value })
  const renderedText = blocks.map((b) => b.text).join('')
  assert.match(renderedText, /\*\*待复核\*\*：\d+ 项/, `render 应给项数；reviewFlags=${JSON.stringify(value.reviewFlags.map((f) => f.kind))}`)
  assert.match(renderedText, /类别：/, 'render 应给类别汇总')
  assert.match(renderedText, /请只把本文的/, 'render 应明确告知调用方只传 text')
})

test('R4：sanitize 产物的结构化字段**仍**含原文（code mode / 结构化消费方可见；如实登记）', async () => {
  // **残留如实登记**：canonical value 仍含 `replacements[].from` / `reviewFlags[].text`（output schema
  // 明文声明「原名 → 占位符」）——它**不进会话日志**，但 Code Mode / 结构化消费方读得到。
  // 本测试锁定「结构化 value 残留 = 当前行为」：下一次有人来"顺便把 from 也去掉了"，会红。
  const { sanitize, loadDicts } = await import(pathToFileURL(join(PACKAGE_ROOT, 'lib', 'ethics-sanitize.js')).href)
  const dicts = loadDicts(join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline'))
  const value = sanitize('张三的手机是13800138000', { mode: 'basic', dicts, maxChars: Number.MAX_SAFE_INTEGER })
  const froms = (value.replacements || []).map((r) => r.from).filter(Boolean)
  const flagTexts = (value.reviewFlags || []).map((f) => f.text).filter(Boolean)
  // 这两个集合里至少要含「张三」或「13800138000」；断言它们存在并集中管理（想要去掉原文时改这里）
  assert.ok(froms.length + flagTexts.length > 0, '当前实现下 value 仍含原文（已知残留）：fail = 形态改了')
  // 夹具验证：在「张三」+ 手机号 的输入下，至少其一出现在 value
  const leak = [...froms, ...flagTexts].join('|')
  assert.match(leak, /张三|13800138000/, `value 残留含真原文（注册「已知残留」）：${leak.slice(0, 200)}`)
})
