// 文档事实门（v18.2.6 新增）：把「文档里那些会被消费方读到的数字与引用」变成机械断言。
//
// 为什么需要（第三方审计的两条「无门可拦」）：
//   ① **技能 description 有宿主硬上限但无门**：DSH 的技能目录只渲染 `name + description`
//      （官方契约：目录条目只用 name/description），宿主对每条 description 做**截断**
//      —— `@deepseek-ai/dsh-tool-skill` 的 `DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500`
//      （其 `lib/index.js:40`；经 `catalogSourceEntries`（:42-45）→ `catalogDescription(desc, max)` 施加）。
//      本包实测 254 字符（安全），但**没有任何东西拦着它涨到 501**：一旦超限，模型看到的是被截断的
//      路由判据（本包把「何时不该用」也写进 description）——静默降级，无人报错。
//   ② **五语 README 的数字型事实无门**：`consistency-check` 规则 ㉑ 只比**结构**（语言切换器 / 表行数 /
//      标题数），查不出**行内数字**。v18.2.5 实测四版写「11 个 .mjs」而磁盘真值 12、只有中文版写对，
//      而规则 ㉑ 依旧全绿（C-5）。本文件补的就是「同一事实在五语里必须一致」这一层。
//
// 边界（如实）：
//   · 「数字一致」断言**只覆盖 `## What this is` 一节**（五语的这一节结构对齐、且只含角色数与阶段数两类
//     数字），不是「整篇 README 逐数字比对」——后者会被语言差异（序数、日期、引用格式）淹没，属不可靠断言。
//     故采用审计建议的**降级形态**：断言「角色数 / 阶段数」两类数字在五语间一致，且与流水线结构派生值相等。
//   · **不**断言 `scripts` 数量写在 README 里：v18.2.6 起该数字的**唯一真源 = SKILL.md 白名单行**，
//     README 一律不写死（见下方 test 的反向断言）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scan as scanLinks } from '../scripts/link-check.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL = join(ROOT, 'skills', 'lunheng-article-pipeline')
const README_FILES = ['README.md', 'README.zh.md', 'README.es.md', 'README.pt.md', 'README.hi.md']

/** 宿主技能目录对 description 的硬上限（与 DSH 源码同源，改这里必须同时给出来源行号）。 */
const HOST_CATALOG_DESCRIPTION_MAX_LENGTH = 500

/** 按 lib/index.js 的同一套归一化读 SKILL.md frontmatter（BOM + CRLF 归一后再解析）。 */
function readFrontmatter() {
  const raw = readFileSync(join(SKILL, 'SKILL.md'), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(raw)
  assert.ok(m, 'SKILL.md 必须首行 `---` 且有成行闭合（否则入口会静默退回兜底 description）')
  const read = (k) => {
    const mm = new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(m[1])
    return mm ? mm[1].trim().replace(/^["']|["']$/g, '') : null
  }
  return { body: raw.slice(m[0].length), description: read('description') }
}

test('技能 frontmatter：description 必须非空且不超过宿主目录硬上限（500 字符）', () => {
  const { description } = readFrontmatter()
  assert.ok(typeof description === 'string' && description.length > 0, 'description 是模型侧路由的唯一依据，不得为空')
  const len = description.length
  assert.ok(
    len <= HOST_CATALOG_DESCRIPTION_MAX_LENGTH,
    `SKILL.md 的 description 长 ${len} 字符，超过宿主技能目录上限 ${HOST_CATALOG_DESCRIPTION_MAX_LENGTH}` +
      `（@deepseek-ai/dsh-tool-skill/lib/index.js:40 的 DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH，` +
      `经 catalogSourceEntries(:42-45) 截断）——超限会被**静默截断**，模型拿到残缺的「何时用/何时不用」判据。` +
      '修法：把不适用于路由的细节移进 SKILL.md 正文或 references/，description 只留判据。',
  )
})

/** 取 `## What this is` 一节全文（到下一个 `## ` 为止）；五语共用同一英文节标题。 */
function whatThisIsSection(readme) {
  const text = readFileSync(join(ROOT, readme), 'utf8')
  const m = /^## What this is\s*\n([\s\S]*?)(?=^## |\z)/m.exec(text)
  assert.ok(m, `${readme} 缺 \`## What this is\` 一节（五语结构对齐的前提）`)
  return m[1]
}

/** 该节里出现的角色编号（T1…T9）——**语言无关**的结构真源。 */
function roleIds(section) {
  return new Set([...section.matchAll(/\bT(\d+)\b/g)].map((m) => Number(m[1])))
}

/** 该节里出现的**整数型数字事实**：先剥掉 `T1–T9` 这类编号区间，再收集独立整数。 */
function numericFacts(section) {
  const stripped = section
    .replace(/T\d+\s*[–—-]\s*T\d+/g, ' ')   // T1–T9 编号区间
    .replace(/T\d+/g, ' ')                   // 单独出现的 T1 / T9
    .replace(/\[[LD C]xx\]/gi, ' ')          // [Lxx] [Dxx] [Cxx]
  return [...new Set([...stripped.matchAll(/(?<![\w.])(\d{1,3})(?![\w.])/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
}

/** 流水线概览代码块里的**阶段数**：取每行首个整数（Phase 0 / Fase 0 / चरण 0 …）。 */
function phaseCount(readme) {
  const text = readFileSync(join(ROOT, readme), 'utf8')
  const block = /```text\n([\s\S]*?)```/.exec(text)
  assert.ok(block, `${readme} 缺 \`\`\`text 的流水线概览块`)
  const nums = new Set()
  for (const line of block[1].split('\n')) {
    const m = /^\s*\S+\s+(\d+)(?:\.\d+)?/.exec(line)
    if (m) nums.add(Number(m[1]))
  }
  return nums.size
}

test('五语 README：「What this is」的数字型事实必须跨语言一致，且与流水线结构派生值相等', () => {
  const perReadme = new Map()
  for (const f of README_FILES) {
    const s = whatThisIsSection(f)
    perReadme.set(f, { roles: roleIds(s), nums: numericFacts(s), phases: phaseCount(f) })
  }
  const en = perReadme.get('README.md')
  // 结构真源：① 角色数 = 该节列出的 T 编号个数（T1…T9 ⇒ 9）；② 阶段数 = 概览块里的整数前缀个数
  const rolesTruth = en.roles.size
  const phasesTruth = en.phases
  assert.ok(rolesTruth >= 9, `角色编号应至少覆盖 T1–T9，实测 ${rolesTruth} 个（真源：references/agents/ 的角色卡）`)
  assert.ok(phasesTruth >= 6, `流水线概览应至少 6 个阶段（Phase 0–5），实测 ${phasesTruth}`)

  for (const f of README_FILES) {
    const { nums, roles, phases } = perReadme.get(f)
    assert.deepEqual(
      nums,
      [rolesTruth, phasesTruth].sort((a, b) => a - b),
      `${f} 的「What this is」数字集 ${JSON.stringify(nums)} ≠ 由结构派生的事实 ` +
        `[角色 ${rolesTruth}（T1–T9）, 阶段 ${phasesTruth}] —— 五语 README 的同类数字必须一致` +
        `（各版实测：${[...perReadme].map(([k, v]) => `${k}=${JSON.stringify(v.nums)}`).join(' / ')}）`,
    )
    assert.equal(roles.size, rolesTruth, `${f} 列出的角色编号个数 ${roles.size} ≠ ${rolesTruth}`)
    assert.equal(phases, phasesTruth, `${f} 的流水线阶段数 ${phases} ≠ ${phasesTruth}`)
  }
})

test('五语 README：脚本数不得写死（唯一真源 = SKILL.md 白名单行；v18.2.5 实测四版误写 11 而真值 12）', () => {
  // 期望值取 **SKILL.md 白名单行**（与 consistency-check 规则⑩ / repo-hygiene 规则⑥ / pack-smoke 同源口径），
  // 而不是本文件自己数磁盘——「脚本数」这个事实只有一处真源，本测试只核 README 有没有违背它。
  const wlLine = readFileSync(join(SKILL, 'SKILL.md'), 'utf8').split('\n').find((l) => l.includes('随包脚本白名单')) || ''
  const declared = (wlLine.split('=')[1] || '').split('+')[0].split('/').map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9-]*$/.test(s))
  assert.ok(declared.length > 0, 'SKILL.md 必须有「随包脚本白名单」行（脚本数的唯一真源）')
  assert.ok(existsSync(join(SKILL, 'scripts')), '技能 scripts/ 目录必须存在')
  for (const f of README_FILES) {
    const text = readFileSync(join(ROOT, f), 'utf8')
    const hits = [...text.matchAll(/(\d{1,3})\s*(?:个|zero-dependency|scripts?|स्क्रिप्ट)?[^\n]{0,24}?\.mjs/g)].map((m) => Number(m[1]))
    for (const n of hits) {
      assert.equal(
        n,
        declared.length,
        `${f} 写了「${n} 个 .mjs」而白名单真值是 ${declared.length}——脚本数只有 SKILL.md 白名单一处真源；` +
          'README 里请改为不写数字的表述（如「数量真源见技能白名单行」），或与真值保持一致',
      )
    }
  }
})

test('技能目录断链穷举：无未归类断链（link-check 的纯函数入口，不 spawn）', () => {
  const r = scanLinks()
  assert.ok(r.files >= 50, `应扫到 ≥50 个 .md（实测 ${r.files}）——太少的常见原因是扫错了目录`)
  assert.ok(r.refs >= 100, `应提取到 ≥100 条路径型引用（实测 ${r.refs}）——太少说明提取规则退化了（防本断言恒真）`)
  assert.deepEqual(
    r.broken.map(([t, from]) => `${from} → ${t}`),
    [],
    '存在未归类断链：既不在盘，也不属于运行期产物 / 跨技能资源 / 墓碑 / 存疑任一类。' +
      '修法见 scripts/link-check.mjs 头部口径（改文档 / 登记 TOMBSTONES / 登记 CROSS_SKILL_*）',
  )
})
