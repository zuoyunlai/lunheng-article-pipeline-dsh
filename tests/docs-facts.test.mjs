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
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scan as scanLinks } from '../scripts/link-check.mjs'
import { readPackManifest } from '../scripts/_lib/pack-manifest.mjs' // M-2/M-3：pack 清单单点解析（声明面派生）

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL = join(ROOT, 'skills', 'lunheng-article-pipeline')
const README_FILES = ['README.md', 'README-zh.md', 'README-es.md', 'README-pt.md', 'README-hi.md']

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

// ── 对外声明 ↔ 代码真源 对账门（v18.18.1 新增 · 审计 C-1 机械化「本批的承重项」）────────────
//
// **为什么必须机械化**（本门是被一次真实事故逼出来的，不是预防性设计）：
//   v18.18.0 的 C-3 在五语 README + CHANGELOG 里把 Config 第 5 键 `handoffLevel` 描述为
//   「由 `LUNHENG_HANDOFF_LEVEL` env 镜像」——而 `lib/index.js` 全文**只读两个 env**
//   （`LUNHENG_QUIET` / `LUNHENG_ALLOW_MECH_EDIT`）。即文档凭空造出一个**不存在的操作者开关**，
//   读者会照它去设一个永远不生效的环境变量（**静默失效、无报错**）。
//   **四道门 + 本文件原有的 265 条用例全绿，没有一道抓住它**——因为没有任何断言把
//   「文档声称的 Config 键」与「`CONFIG_SPEC` 的真实键集」对起来。
//   同批复查又抓到三处同源漏改：SECURITY.md 仍写「四个开关」、SECURITY.md 声称
//   「唯一一次 `readFileSync`」实际两次、`lunheng-commands` 在四语 README 里 0 命中。
//
// **本门做什么**：从代码派生四个集合，要求 7 个对外声明面**逐项一致**。
//   · 工具集  ← `lib/tools.js` 的 `tools.register(defineTool({ name }))`
//   · 配置集  ← `lib/index.js` 的 `CONFIG_SPEC` 键
//   · 命令集  ← `lib/commands.js` 的 `commands.register({ name })`
//   · 技能集  ← `skills/*/SKILL.md` frontmatter 的 `name`
//
// **边界（如实）**：
//   · 比对用「锚点行」而非全文——文档正文别处提某个工具名属正常，只有**声明行**必须列全。
//   · 数量词只认 2–5 的常见语言对应词；`docs/installation.md` 不声明数量故不查数量词。
//   · 本门抓的是**集合级漂移**（少了谁 / 多了谁 / 数字不符），**抓不到语义级失真**
//     （例：把某个键的行为描述错）。语义那半仍需人读。
// M-3（二次复审，2026-09-26）：声明面**从 pack 清单派生**，而不是手写 7 个常量——手写常量会让
//   **新增的随包文档**天然逃过本门（实测：把同型假声明写进 `docs/architecture.md` / `docs/faq.md`
//   时本门**无感**）。派生口径 = 随包 `.md` ∩ 对外声明面（`docs/**` + 顶层 `README*` + `SECURITY.md`）。
const SURFACES = (() => {
  let packed = []
  try { packed = readPackManifest(ROOT).files } catch { /* 受限会话 / npm 不可用 → 走下方静态回退 */ }
  const derived = packed
    .filter((f) => f.endsWith('.md'))
    .filter((f) => f.startsWith('docs/') || /^README[^/]*\.md$/.test(f) || f === 'SECURITY.md')
    .sort()
  // 派生为空 / 过少 ⇒ 派生退化。**绝不**退回空集（那会让本门变恒真断言）；退回静态清单并留痕。
  if (derived.length < 7) return [...README_FILES, 'SECURITY.md', 'docs/installation.md']
  return derived
})()

/**
 * 配置声明行上**允许出现但不是 Config 键**的纯标识符。
 * 这些是同一段落在讨论的其它东西（写工具名、字面词 config），不是配置面。
 * 任何**不在此表、也不是真源键/枚举值**的标识符都会让本门变红——这正是要抓的「人造键」。
 */
const NON_KEY_TOKENS = new Set(['pwsh', 'bash', 'write', 'edit', 'read', 'config'])

/** 从代码派生四类真源集合（任一为空即认为派生逻辑退化，见下方 non-vacuous 断言）。 */
function deriveCodeFacts() {
  const toolsSrc = readFileSync(join(ROOT, 'lib', 'tools.js'), 'utf8')
  const tools = [...toolsSrc.matchAll(/tools\.register\(\s*defineTool\(\s*\{\s*name:\s*'([^']+)'/g)].map((m) => m[1])

  const idxSrc = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
  const start = idxSrc.indexOf('const CONFIG_SPEC = Object.freeze({')
  const end = idxSrc.indexOf('\n})', start)
  assert.ok(start > -1 && end > start, 'lib/index.js 必须仍有 `const CONFIG_SPEC = Object.freeze({` … `})` 块（派生失败会让本门静默失效）')
  const specBlock = idxSrc.slice(start, end)
  const config = [...specBlock.matchAll(/^ {2}(\w+):\s*\{/gm)].map((m) => m[1])
  // 枚举型键的合法取值也从真源派生（不在文档断言里写死 basic/strict）
  const enumValues = [...specBlock.matchAll(/values:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))

  const cmdSrc = readFileSync(join(ROOT, 'lib', 'commands.js'), 'utf8')
  const commands = [...cmdSrc.matchAll(/commands\.register\(\s*\{\s*name:\s*'([^']+)'/g)].map((m) => m[1])

  const skillsDir = join(ROOT, 'skills')
  const skills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, 'SKILL.md')))
    .map((d) => {
      const raw = readFileSync(join(skillsDir, d.name, 'SKILL.md'), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
      const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(raw)
      assert.ok(m, `skills/${d.name}/SKILL.md 必须有成行闭合的 frontmatter`)
      return (/^name:\s*["']?(.+?)["']?\s*$/m.exec(m[1]) || [])[1]
    })
    .filter(Boolean)

  return { tools, config, commands, skills, enumValues }
}

/** 数量词表（只覆盖本仓实际用到的 2–5）。 */
const NUM_WORDS = {
  2: /\b(two|dos|dois)\b|二|两|दो/i,
  3: /\b(three|tres|três)\b|三|तीन/i,
  4: /\b(four|cuatro|quatro)\b|四|चार/i,
  5: /\b(five|cinco)\b|五|पाँच|पांच/i,
  6: /\b(six|seis)\b|六|छह/i,
  7: /\b(seven|siete|sete)\b|七|सात/i,
}

/** 在 surface 里找锚点行：`both` 全部命中才算该行（防命中同文件别处的偶发提及）。
 *  M-3（二次复审）：**跳过版本演进史行**——`docs/introduction.md` 这类文档的 `（v18.1.0）` 条目是
 *  **历史记录**（当时确实只有 `/lunheng-status`），把它当「声明行」等于要求**篡改历史**（假红）。 */
/** 版本演进史行——历史记录，**不是**对外声明面。两种形态：条目 `- **标题（vX.Y.Z）**：…`
 *  与表格行 `| **vX.Y.Z** | … |`（`docs/introduction.md` 两处都有）。 */
const isHistoryLine = (l) => /^\s*[-*]\s+\*\*[^*]*（v\d+\.\d+/.test(l) || /^\s*\|\s*\*\*v\d+\.\d+/.test(l)

/** 在 surface 里找锚点行：`both` 全部命中才算该行（防命中同文件别处的偶发提及）。
 *  M-3（二次复审）：**跳过版本演进史行**——`docs/introduction.md` 这类文档的 `（v18.1.0）` 条目是
 *  **历史记录**（当时确实只有 `/lunheng-status`），把它当「声明行」等于要求**篡改历史**（假红）。 */
function anchorLine(text, mustAll) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => mustAll.every((t) => l.includes(t)) && !isHistoryLine(l))
  return { line: i < 0 ? null : lines[i], no: i + 1 }
}

test('C-1 对外声明 ↔ 代码真源：工具/配置/命令/技能 四集合在**派生**的随包声明面逐项一致', () => {
  const { tools, config, commands, skills, enumValues } = deriveCodeFacts()

  // 非空断言：派生退化（正则失配、文件改名）必须**响亮失败**，否则本门会静默变成恒真断言
  assert.equal(tools.length, 4, `应从 lib/tools.js 派生出 4 个工具，实测 ${tools.length}——派生正则可能已与源码脱节`)
  assert.equal(config.length, 8, `应从 lib/index.js 的 CONFIG_SPEC 派生出 8 个配置键（v18.62.5 新增 hookRewriteContent / hookMaxBlockChars；v18.80.0 新增 ethicsHook），实测 ${config.length}`)
  assert.equal(commands.length, 2, `应从 lib/commands.js 派生出 2 条命令，实测 ${commands.length}`)
  assert.equal(skills.length, 2, `应从 skills/*/SKILL.md 派生出 2 个技能，实测 ${skills.length}`)

  for (const f of SURFACES) {
    const text = readFileSync(join(ROOT, f), 'utf8')

    // M-3：按**参与度**检查——随包文档里不涉某面的（如 `docs/faq.md` 根本不提工具）不该被要求写
    //   声明行；一旦**提及**该面，就必须列全（集合相等）。这样派生面能扩到全部随包文档、又不误红。
    // 参与度只看**非历史行**——历史条目（`（v18.1.0）` 那类）记的是**当时**的事实，不该拉高参与度
    //   （否则 `docs/introduction.md` 会因历史里的 `lunheng_m_gate` 被要求写「当下」的声明行 = 假红）。
    const prose = text.split('\n').filter((l) => !isHistoryLine(l)).join('\n')
    const engages = {
      tools: tools.some((n) => prose.includes(n)),
      config: prose.includes('allowMechanismEdit'),
      commands: commands.some((n) => prose.includes('/' + n)),
      skills: skills.some((n) => prose.includes(n)),
    }
    // ① 工具集：锚 = 首个同时含「第一个工具名」的行
    if (engages.tools) {
    const t = anchorLine(text, [tools[0]])
    assert.ok(t.line, `${f} 未见工具声明行（须出现 \`${tools[0]}\`）`)
    for (const name of tools) {
      assert.ok(
        t.line.includes(name),
        `${f}:${t.no} 的声明行漏了工具 \`${name}\`（该行已列 \`${tools[0]}\` 却未列全，属 C-1 那类漏列）。` +
          `真源 = lib/tools.js 的 defineTool 注册（共 ${tools.length} 个：${tools.join(' / ')}）`,
      )
    }
    // 反方向：文档**不得多出**真源没有的工具名（「集合相等」而非「包含」）
    const tExtra = [...new Set([...t.line.matchAll(/lunheng_[a-z_]{2,}/g)].map((m) => m[0]))].filter((n) => !tools.includes(n))
    assert.deepEqual(
      tExtra,
      [],
      `${f}:${t.no} 的声明行列出了真源里**不存在**的工具名：${tExtra.join(', ')}——` +
        `真源 lib/tools.js 只有 ${tools.join(' / ')}。文档不得凭空多出工具（读者会去调用一个不存在的工具）`,
    )
    } // ① 工具集 guard 结束

    // ② 配置集：锚 = 首个**同时**含 allowMechanismEdit 与 quiet 的行
    //    （只看 allowMechanismEdit 会误命中 SECURITY.md 的 guard 逃逸口行「config 写 allowMechanismEdit: true」）
    if (engages.config && f !== 'docs/installation.md') {
      const c = anchorLine(text, ['allowMechanismEdit', 'quiet'])
      assert.ok(c.line, `${f} 未见配置声明行（须同时出现 allowMechanismEdit 与 quiet）`)
      for (const key of config) {
        assert.ok(
          c.line.includes(key),
          `${f}:${c.no} 的配置声明行漏了 \`${key}\`。真源 = lib/index.js 的 CONFIG_SPEC（共 ${config.length} 个：${config.join(' / ')}）。` +
            '⚠️ 漏键的后果不是「少写一行」——实例：SECURITY.md 长期写「四个开关」，读者会以为 handoffLevel 不存在',
        )
      }
      // 数量词必须与真值一致（「四个开关」写死数词正是上次翻车的形态）
      const word = c.line.match(NUM_WORDS[config.length])
      assert.ok(
        word,
        `${f}:${c.no} 的配置声明行未见与真值一致的数量词（应含 ${config.length} 的语言对应词）。` +
          '写死数词就会随代码增键而过期——真值只有 CONFIG_SPEC 一处',
      )
      // 反方向（**审计原文要求的「集合相等」**）：文档不得出现真源里没有的配置键。
      // 反引号里的纯标识符 - 真源键 - 枚举值 - 已声明的非键词 = 必须为空。
      const cExtra = [
        ...new Set(
          [...c.line.matchAll(/`([^`]+)`/g)]
            .map((m) => m[1])
            .filter((tok) => /^[a-z][a-zA-Z0-9]*$/.test(tok))
            .filter((tok) => !config.includes(tok) && !enumValues.includes(tok) && !NON_KEY_TOKENS.has(tok)),
        ),
      ]
      assert.deepEqual(
        cExtra,
        [],
        `${f}:${c.no} 的配置声明行列出了真源里**不存在**的键：${cExtra.join(', ')}——` +
          `真源 CONFIG_SPEC 只有 ${config.join(' / ')}（枚举值 ${enumValues.join('/')} 亦已派生）。` +
          '⚠️ 这正是本门被逼出来的那次事故的形态：文档声称一个代码里没有的开关，读者照做只会静默失效',
      )
    }

    // ③ 命令集：锚 = 首个含 /lunheng-status 的行
    if (engages.commands) {
    const k = anchorLine(text, ['/lunheng-status'])
    assert.ok(k.line, `${f} 未见人类命令声明行（须出现 \`/lunheng-status\`）`)
    for (const name of commands) {
      assert.ok(
        k.line.includes('/' + name),
        `${f}:${k.no} 的命令声明行漏了 \`/${name}\`。真源 = lib/commands.js（共 ${commands.length} 条：${commands.join(' / ')}）`,
      )
    }
    // 反方向：不得多出真源没有的命令。负向先行断言排除**技能目录路径**（`/lunheng-article-pipeline`
    // 会被 `\/lunheng-[a-z]+` 截成 `lunheng-article`，那是路径不是命令）。
    const kExtra = [...new Set([...k.line.matchAll(/\/lunheng-[a-z]+(?![-\w])/g)].map((m) => m[0].slice(1)))].filter(
      (n) => !commands.includes(n),
    )
    assert.deepEqual(
      kExtra,
      [],
      `${f}:${k.no} 的声明行列出了真源里**不存在**的命令：${kExtra.join(', ')}——真源 lib/commands.js 只有 ${commands.join(' / ')}`,
    )
    } // ③ 命令集 guard 结束

    // ④ 技能集：整文件覆盖（技能名可在描述段与目录树任一处出现）
    if (engages.skills) {
    for (const name of skills) {
      assert.ok(
        text.includes(name),
        `${f} 全文未提及技能 \`${name}\`。真源 = skills/*/SKILL.md 的 frontmatter name（共 ${skills.length} 个：${skills.join(' / ')}）。` +
          '⚠️ 漏声明的后果：按文档部署的人「装了什么」与事实不符（实例：lunheng-commands 曾在四语 README 里 0 命中）',
      )
    }
    } // ④ 技能集 guard 结束
  }
})

test('C-1 反向自证：本门的派生与锚点对「人为删一个工具名」敏感（防空转）', () => {
  // 用内存中的字符串模拟「有人从 README 删掉一个工具名」，验证断言路径真的会红，
  // 而不是因为锚点找错行 / 集合为空而恒真。
  const { tools } = deriveCodeFacts()
  const tampered = readFileSync(join(ROOT, 'README.md'), 'utf8').replaceAll(tools[2], 'REMOVED_TOOL')
  const t = anchorLine(tampered, [tools[0]])
  assert.ok(t.line, '锚点应仍在（只删了第三个工具名）')
  const missing = tools.filter((n) => !t.line.includes(n))
  assert.deepEqual(
    missing,
    [tools[2]],
    '反向自证失败：人为删掉一个工具名后，本门应当恰好报出那一个缺失项；' +
      '若 missing 为说明断言写错了对象（门恒真），若多报说明锚点选错',
  )
})

// ── C-12 / C-13 机械化（v18.18.6）──────────────────────────────────────────────
//
// 这两条同族：**文档里一句人写的事实陈述，必须与结构真源绑定**，否则它会随结构演进而
// 悄悄变成假话。两处都是「改过一轮、仍没改对」的形态，故值得上机检：
//   · **C-12**：`docs/architecture.md:15` 与 `docs/introduction.md:40` 曾写 T8「**无**角色卡」，
//     而发布物里一直有 `references/agents/08-终检-finalizer.md`（该卡自称「九个独立角色之一、
//     不可被其他角色替代」）。文档否认自家角色卡的存在，会让读者以为 T8 无人负责。
//   · **C-13**：`docs/introduction.md:42` 与 `docs/介绍与排版/*.html` 曾写「六个阶段」却**列了
//     7~8 项**。v18.18.0 把 introduction 的「六」改成「七」，但同一行的箭头序列仍有 8 项，
//     而全库其余位置一律写 6 —— **改了一轮仍未自洽**。真源 = 「Phase 0–5 六个主阶段」，
//     子阶段（1.5/2.5/3.5/3.6/4.2/4.5）不计入。
const DOC_SURFACES = (() => {
  const out = []
  const walk = (dir, base) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full, base)
      else if (/\.(md|html)$/.test(e.name)) out.push(relative(base, full).split(sep).join('/'))
    }
  }
  walk(join(ROOT, 'docs'), ROOT)
  for (const s of readdirSync(join(ROOT, 'skills'), { withFileTypes: true })) {
    if (s.isDirectory() && existsSync(join(ROOT, 'skills', s.name, 'README.md'))) out.push(`skills/${s.name}/README.md`)
  }
  return out
})()

/** 结构真源：**主**阶段数 = 五语 README 概览块里的整数 Phase 前缀去重个数（Phase 0–5 ⇒ 6）。 */
function derivedPhaseCount() {
  return phaseCount('README.md')
}

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

test('C-12：文档不得否认角色卡的存在，且声明的卡必须真的在盘', () => {
  assert.ok(DOC_SURFACES.length > 5, `文档面过少（实测 ${DOC_SURFACES.length}）——扫描退化会让本断言恒真`)

  // ① T1–T9 的角色卡都在（08 是 C-12 的事主；缺任何一张都说明卡片目录被动过）
  const cardDir = join(ROOT, 'skills', 'lunheng-article-pipeline', 'references', 'agents')
  const cards = readdirSync(cardDir).filter((f) => /^\d\d-.*\.md$/.test(f))
  assert.ok(cards.length >= 9, `references/agents/ 的角色卡应 ≥9 张，实测 ${cards.length}`)
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const hit = cards.filter((f) => f.startsWith(`0${n}-`))
    assert.ok(hit.length > 0, `T${n} 的角色卡缺失（references/agents/0${n}-*.md）`)
  }

  // ② 反向：没有任何文档可以声称某角色「无角色卡」——九张卡都在，这句话必假
  const denial = /无(独立)?角色卡|没有角色卡/
  const liars = DOC_SURFACES.filter((f) => denial.test(readFileSync(join(ROOT, f), 'utf8')))
  assert.deepEqual(
    liars,
    [],
    `以下文档声称存在「无角色卡」的角色，而 references/agents/ 下九张卡齐备：${liars.join(', ')}——` +
      '（C-12 实例：architecture.md / introduction.md 曾这样写 T8，而 08-终检-finalizer.md 一直随包）',
  )
})

test('C-13：文档里「N 个阶段」必须等于结构派生值（六个主阶段 Phase 0–5）', () => {
  const truth = derivedPhaseCount()
  assert.ok(truth >= 6, `派生阶段数异常（实测 ${truth}）——派生退化成 0/1 会让本断言形同虚设`)

  const re = /(\d+|[一二三四五六七八九十]+)\s*个(?:主)?阶段/g
  const stated = []
  for (const f of DOC_SURFACES) {
    const text = readFileSync(join(ROOT, f), 'utf8')
    for (const line of text.split('\n')) {
      for (const m of line.matchAll(re)) {
        const raw = m[1]
        const n = /^\d+$/.test(raw) ? Number(raw) : CN_NUM[raw]
        stated.push({ f, n, raw, snippet: line.trim().slice(0, 60) })
      }
    }
  }
  assert.ok(stated.length > 0, '未在任何文档里找到「N 个阶段」表述——正则与文档脱节，本断言会恒真')

  const wrong = stated.filter((s) => s.n !== truth)
  assert.deepEqual(
    wrong.map((s) => `${s.f}：说「${s.raw} 个阶段」而真源是 ${truth}`),
    [],
    `以下文档的阶段数 ≠ 结构派生值 ${truth}（Phase 0–5 六个主阶段；子阶段 1.5/2.5/3.5/3.6/4.2/4.5 不计）：\n` +
      wrong.map((s) => `  · ${s.f} → ${s.snippet}`).join('\n'),
  )
})

// ── C-5：README 承诺的命令必须在「当前形态」可执行（v18.18.7）────────────────────
//
// 动机：五语 README 都列了「Local gates」几条 `node …` 命令，而其中四条走的是**仓库级**路径
// （`scripts/` / `tests/`）——发布物的 `files` 白名单明确**不含**这两者（`pack-smoke` 的
// `mustNotShip` 还把两者列为「必须不随包」）。于是装了 npm 包的人照 README 敲：
//   三条 `node scripts/…` → `Cannot find module`；`node --test "tests/**/*.test.mjs"` →
//   匹配 0 文件且 **exit 0**（**静默成功**，最坏的一种：看起来跑过了）。
//
// 断言形态（审计 C-5 原话）：**README 里出现的 `node …` 命令，若其路径不在发布物内，
// 则该行必须带「仅源码仓库」限定词。** 并且**逐 README**要求至少存在这样一条命令——
// 否则某个语言把整行删掉就能让断言空过（这正是 es/pt/hi 当初的形态）。
const REPO_ONLY_MARKERS = [
  /repository sources only/i,
  /仅源码仓库/,
  /solo fuentes del repositorio/i,
  /somente fontes do reposit[óo]rio/i,
  /केवल स्रोत रिपॉज़िटरी/,
]

/** 从一段「node 命令行」里取出被调用的脚本路径（跳过 `--flag`，去引号与尾部标点）。 */
function nodeCommandPaths(cmdText) {
  const out = []
  for (const m of cmdText.matchAll(/\bnode\s+((?:--\S+\s+)*)("[^"]+"|'[^']+'|[^\s`、,，]+)/g)) {
    const p = m[2].replace(/^["']|["']$/g, '').replace(/[`、,，]+$/, '')
    if (!p || p.startsWith('-')) continue
    out.push(p)
  }
  return out
}

test('C-5：README 里指向「非发布物路径」的命令必须带「仅源码仓库」限定词', async (t) => {
  const { readPackManifest, isPackEnvUnavailable } = await import('../scripts/_lib/pack-manifest.mjs') // M-2/O-3
  let packed
  try {
    packed = readPackManifest(ROOT).files // 单点解析器（数组 ≤npm11 / 对象 npm12+）
  } catch (e) {
    // O-5：只有「环境不可用」才 skip（可见）；形状不认识一律照抛（旧 `catch { return }` 会吞成 pass）。
    if (isPackEnvUnavailable(e)) return t.skip('受限会话禁子进程 / npm 不可用')
    throw e
  }
  const shipped = new Set(packed)
  assert.ok(shipped.size > 100, `发布物清单过少（实测 ${shipped.size}）——派生失败会让本断言恒真`)

  const problems = []
  let nonShippedCommandsSeen = 0
  for (const f of README_FILES) {
    const lines = readFileSync(join(ROOT, f), 'utf8').split('\n')
    let perFileNonShipped = 0
    lines.forEach((l, i) => {
      // 只认**反引号内联命令**——裸正则会跑到布局树的注释行 `# node --test suites (…)` 上，
      // 取出 `suites` 这类垃圾 token（实测踩过）。
      for (const m of l.matchAll(/`([^`]*\bnode\s[^`]*)`/g)) {
        const outside = nodeCommandPaths(m[1]).filter((p) => !shipped.has(p))
        if (!outside.length) continue
        perFileNonShipped++
        nonShippedCommandsSeen++
        if (!REPO_ONLY_MARKERS.some((re) => re.test(l))) {
          problems.push(`${f}:${i + 1} 调用了发布物外的路径 ${outside.join(', ')}，但该行没有「仅源码仓库」限定词`)
        }
      }
    })
    if (perFileNonShipped === 0) {
      problems.push(`${f} 找不到任何「调用发布物外路径」的命令行——按 C-5 口径五语都应保留该行并带限定词（整行删掉会让本断言空过）`)
    }
  }
  assert.ok(nonShippedCommandsSeen > 0, '五语 README 里一条发布物外命令都没找到——正则与文档脱节，本断言会恒真')
  assert.deepEqual(problems, [], `README 承诺了在装包形态下不可执行的命令：\n${problems.map((p) => '  · ' + p).join('\n')}`)
})

// v18.32.0（主人定案 ③：审计分片粒度 = **仅按 G 组切**）——分片粒度是**运行期派发口径**：
//   写宽一次（把「或章节」加回去）就会静默回到被裁掉的那条路，而**没有任何门会因此变红**。
//   这也是本仓反复出现的形态：EFF-2 当年落地时写的正是「按 G 组**或**章节切」——比报告的建议宽，
//   而报告当时只把粒度列进「需主人定案」、没写进任何机检。本用例把定案钉住。
//   三条判据：① 分片段落必须写明「仅按 G 组」；② 必须写明理由（跨节 / 否则只剩一条无理由的禁令）；
//   ③ 不得再出现「按章节切」（引用旧口径说明「已删」不算——正则只挡「当成可用选项写」）。
test('定案 ③：审计分片粒度只许按 G 组，且「章节切」不得复活', () => {
  const files = [
    join(SKILL, 'references', 'pipeline-readme.md'),
    join(SKILL, 'references', 'agents', '07-审计-auditor.md'),
  ]
  for (const f of files) {
    const rel = relative(ROOT, f).replaceAll(sep, '/')
    const text = readFileSync(f, 'utf8')
    const idx = text.indexOf('审计分片并行')
    assert.ok(idx >= 0, `${rel} 找不到「审计分片并行」段——粒度口径的载体不见了`)
    const seg = text.slice(idx, idx + 1800)
    assert.match(seg, /仅按 G 组/, `${rel} 分片段落必须写明「仅按 G 组」（主人定案 ③，2026-09-27）`)
    assert.match(seg, /跨节/, `${rel} 分片段落必须写明理由（章节切会切碎跨节判断）；只有禁令没有理由，后来者会当它可绕`)
    // ⚠️ 否定断言的形状是被反向自证**逼出来的**：第一版只挡「按章节切」，
    //   而 EFF-2 当年真实的写宽形态是「按 **G 组**或**章节**切」——反向自证里把这句话加回去，门**没红**。
    //   现改为「『或』/『按』后面（允许空格与加粗星号）不得紧跟『章节』」——覆盖 按章节 / 按 **章节** /
    //   或章节 / 或**章节** 四种写法；而把「章节」当**理由**讲（「章节切会把跨节判断切碎」）不在此列。
    assert.ok(
      !/(?:或|按)[\s*]{0,4}章节/.test(seg),
      `${rel} 分片段落不得把「章节」写成可选粒度（按/或 + 章节）——该粒度已被定案 ③ 删除`,
    )
  }
})

// v18.35.0（瘦身批）：02 卡把三块内容**收敛成指针 / 迁移到真源**。瘦身最危险的失败形态不是「没瘦下来」，
//   而是**指针指向空气**——读者追过去发现内容既不在卡片、也不在目标文档里（安静地删内容）。
//   本用例把搬运的两端钉在一起：目标处必须真的有，且卡片侧不得再留**定义**（只许留指针里的名字）。
test('v18.35.0 瘦身：02 卡迁出的内容必须在目标文档里真的存在（防「瘦身变删内容」）', () => {
  const SKILL_DIR = join(ROOT, 'skills', 'lunheng-article-pipeline')
  const card = readFileSync(join(SKILL_DIR, 'references', 'agents', '02-数据检索-data-scout.md'), 'utf8')
  const glossaryText = readFileSync(join(SKILL_DIR, 'references', 'glossary.md'), 'utf8')
  const tpl = readFileSync(join(SKILL_DIR, 'references', 'templates', '数据卡-template.md'), 'utf8')
  const sources = readFileSync(join(SKILL_DIR, 'references', '_shared', '外部检索源接入面.md'), 'utf8')

  // ① 三检索员「五条实现」→ glossary（此前只有 02 卡写，T1/T3 卡看不到）
  for (const k of ['上下文隔离', '写入隔离', '读取协议', '冲突解决', '降级隔离']) {
    assert.ok(glossaryText.includes(k), `glossary 缺「${k}」——02 卡已把五条实现迁出，目标处必须真有`)
  }
  assert.match(card, /#三检索员并行独立运行/, '02 卡必须**带锚点**指向 glossary 的并行协议节（否则「单一真源」不可达）')

  // ② 数据卡两个字段子项 → 模板（定义必须在模板里；卡片只许留名字）
  //   ⚠️ 标记要**覆盖语义**，不能只覆盖名字：第一版对「原始位置」只断言 `附表号`，而 mutation
  //   「删掉其中的理由（防抓取小数位截断）」**没有变红**——名字还在、语义已缺。（同族教训：断言太弱=假绿。）
  for (const [k, markers] of [
    ['样本转述出处层级', ['待复核', '三级']],
    ['原始位置', ['附表号', '截断']],
  ]) {
    assert.ok(tpl.includes(k), `数据卡模板缺字段「${k}」`)
    for (const m of markers) {
      assert.ok(tpl.includes(m), `数据卡模板的「${k}」缺语义标记「${m}」——迁了名字没迁语义`)
    }
  }

  // ③ T2 重试预算的成本口径 → 接入面 §4.5，**含那条自我更正**（迁移不得丢记录）
  assert.ok(
    sources.includes('18.9M') && sources.includes('无法复验'),
    '接入面缺「18.9M 无法复验」这条自我更正——它是 02 卡瘦身时被迁出的，不能随卡片瘦身一起消失',
  )
  assert.ok(!card.includes('18.9M'), '02 卡不该再引用那个已失效的数字')

  // ④ 指针在场：卡片必须真的指向两个真源
  assert.match(card, /templates\/数据卡-template\.md/, '02 卡必须指向数据卡模板')
  assert.match(card, /外部检索源接入面\.md/, '02 卡必须指向接入面文档')
})

// v18.37.0（同族瘦身批）：把 02 卡的收敛手法**推到 01/03 卡**——三张检索员卡从此共用同一套真源。
//   本用例钉住三件事：① 三卡都指向接入面（源面）与 glossary 并行协议节；② 三卡**都不再复述**
//   引擎降级链（那是接入面的单一真源）；③ 每卡都保留自己的**产出格式契约**「交接报告必报一行」
//   （刻意不从卡片外移：T1/T3 卡各有一份且无机检兜，省它只值百余字节，丢了要等 T7 才发现）。
test('v18.37.0 三检索员卡同族收敛：源面/协议指向真源，且产出格式契约仍在卡内', () => {
  const SKILL_DIR = join(ROOT, 'skills', 'lunheng-article-pipeline')
  const cards = ['01-文献检索-literature-scout.md', '02-数据检索-data-scout.md', '03-案例检索-case-scout.md']
  for (const c of cards) {
    const t = readFileSync(join(SKILL_DIR, 'references', 'agents', c), 'utf8')
    assert.match(t, /外部检索源接入面\.md/, `${c} 必须指向接入面文档（源面单一真源）`)
    assert.ok(
      !/引擎降级链\s*bing/.test(t),
      `${c} 不得再复述引擎降级链（该链的单一真源 = 外部检索源接入面.md §2.2；v18.37.0 已收敛）`,
    )
    assert.match(t, /检索预算：已用 N 步/, `${c} 必须保留「交接报告必报一行」的产出格式契约（刻意不外移）`)
  }
  // 三卡与 glossary 的跨线协议：01/03 是通过「不产对方的卡」表述，02 是直连锚点
  for (const c of ['02-数据检索-data-scout.md', '03-案例检索-case-scout.md']) {
    const t = readFileSync(join(SKILL_DIR, 'references', 'agents', c), 'utf8')
    assert.match(t, /#三检索员并行独立运行/, `${c} 必须带锚点指向 glossary 的三检索员协议节`)
  }
})

/** 递归收集技能目录内的文本文件；**跳过 `tests/`**——那是断言自己的地方，不是被断言的内容。 */
function walkSkillFiles(dir, exts) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'tests') continue
      out.push(...walkSkillFiles(p, exts))
    } else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
  }
  return out
}

/**
 * M 门项 ID 的**代码真源**：各 gate 模块里的 `gate:` 标签。
 * 刻意不从文档里抄清单——手抄清单正是会漂的那一份（本批实测：`M-Fact-1` 落地时无人补登本表）。
 */
function codeGateIds() {
  const dir = join(SKILL, 'scripts', '_lib', 'mgate-gates')
  const ids = new Set()
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.mjs')) continue
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/gate:\s*'(M-(?:Form|Exist|Integrity|Fact)-\d+)/g)) {
      ids.add(m[1])
    }
  }
  return ids
}

const TABLE_NAME = '规范-机械门对照表.md'

/**
 * 交接门判据码的**代码真源**：`handoff-check.mjs` 里 `addHard/addSoft('X', …)` 的码。
 * 与 `codeGateIds()` 同一判据：清单从代码派生，不从文档抄（抄的那份会漂——`M-Fact-1` 就是这么漏登的）。
 * 本文件只断言 **代码 ⇒ 表** 这一个方向；**反向（表 ⇒ 代码）刻意不设断言**——表内**合法**保留
 * 作废号与否定式提及（如「本脚本**没有** B5」这句更正说明就含 `B5`），反向断言会把正当文本判红
 * （本仓既有判据：对禁令/清点类断言不得为迁就文本而放宽，也不得误伤更正记录）。
 */
function handoffCodes() {
  const src = readFileSync(join(SKILL, 'scripts', 'handoff-check.mjs'), 'utf8')
  const codes = new Set()
  for (const m of src.matchAll(/add(?:Hard|Soft)\(\s*'([AB][0-9a-z]*)'/g)) codes.add(m[1])
  return codes
}

/** 在**登记区**（§一/§二 的表行）里按标识符边界找一个码：`A4` 不得被 `A4b/A4c` 命中，反之亦然。 */
const inRegistry = (registry, token) => new RegExp(`(?<![A-Za-z0-9])${token}(?![0-9a-z])`).test(registry)

/**
 * `g-audit-check.mjs` 实际检几项——从它的 `checks` 对象**键数**派生（唯一真源是代码，不是文档）。
 * ⚠️ 这条守卫来自一次**真实的漏传**：v18.41.0 把机检从 5 项扩到 6 项（并加了 `--qlt`）后同步了 6 处文档，
 *   却漏了 `references/pipeline-readme.md` 的 T7 派发话术那一行（它仍写「5 项机检」且没有旗标）——
 *   而那次全库 grep 用的是 `-Path references\**\*.md`，在 pwsh 里 `**` **只匹配一层中间目录**，
 *   `references/` 下**直属**的 .md 根本没被扫到。故「N 项机检」这类数字断言值得直接机械化。
 */
function gAuditItemCount() {
  const src = readFileSync(join(SKILL, 'scripts', 'g-audit-check.mjs'), 'utf8')
  const block = /const checks = \{([\s\S]*?)\n\}/.exec(src)
  assert.ok(block, 'g-audit-check.mjs 的 `const checks = {…}` 形状变了——派生口径已断，本用例会真空通过')
  const n = [...block[1].matchAll(/^\s*'[^']+':/gm)].length
  assert.ok(n >= 5, `从 checks 对象只派生到 ${n} 项（<5）——派生口径可疑，拒绝在噪声上断言`)
  return n
}

// v18.43.0：把「机检项数」这类**会在多处被引用、且已经漂过一次**的数字钉住。
//   判据：凡在同一行提到 `g-audit` 的文档，行内写的「N 项机检 / N 项已有 / N 个 G 子项」必须 == 代码实际项数。
//   为什么值得一条独立守卫：这类数字**天生多处引用**（派发话术 / 角色卡 / 速查表 / 报告模板 / 对照表），
//   而扩项是**偶发动作**——改的人只盯自己手边那几处，漏掉的地方没有任何门会响（本批实测漏了 1 处）。
test('文档里的「机检 N 项」必须等于 g-audit-check 的实际项数（v18.43.0 防漏传）', () => {
  const n = gAuditItemCount()
  const claims = []
  for (const f of walkSkillFiles(SKILL, ['.md'])) {
    const rel = relative(ROOT, f).split(sep).join('/')
    readFileSync(f, 'utf8').split('\n').forEach((ln, i) => {
      if (!/g-audit/.test(ln)) return
      for (const m of ln.matchAll(/(\d+)\s*(项机检|项已有|个 G 子项|项 G 项机检)/g)) {
        claims.push({ at: `${rel}:${i + 1}`, num: Number(m[1]), raw: m[0] })
      }
    })
  }
  assert.ok(claims.length >= 4, `只扫到 ${claims.length} 处「N 项」声明——扫描口径已与文档写法脱节，本用例会真空通过`)
  const bad = claims.filter((c) => c.num !== n)
  assert.deepEqual(
    bad,
    [],
    `下列位置的机检项数与代码不符（代码实际 = ${n} 项）：\n  ${bad.map((c) => `${c.at} 写「${c.raw}」`).join('\n  ')}\n` +
      '扩项/减项时必须同批更新**所有**引用处——这份引用面天生分散（派发话术 / 07 卡 / 速查表 / 报告模板 / 对照表 / SKILL.md），' +
      'v18.41.0 就漏了 `pipeline-readme.md` 的 T7 派发话术。',
  )
})

/**
 * 只取 §一 / §二 的**表行**（`|` 开头的行）——本表真正的「登记」区。
 * ⚠️ 刻意**不取**表头注记与 §三：这两处会提到门号（作废号留档、漏登说明、旧行名举例），
 *   若把它们算成「已登记」，两个用例都会被**自造污染**。反向自证实测过这一点：
 *   删掉 `M-Fact-1` 那一行、把 09 卡改回悬空行名，两处都仍然绿——表头那句「补登 `M-Fact-1`」
 *   与 §三 里那句旧行名把它们救了回来。（同族教训：断言的面比语义宽 = 假绿。）
 */
function sectionRows(table) {
  const start = table.indexOf('## 一、')
  const end = table.indexOf('## 三、')
  assert.ok(start >= 0 && end > start, '对照表结构变了：找不到 §一 / §三 的分节标题，扫描面无从确定')
  return table
    .slice(start, end)
    .split('\n')
    .filter((l) => l.trimStart().startsWith('|'))
    .join('\n')
}

// v18.40.0（对照表表体收敛）：收敛最危险的失败形态不是「没瘦下来」，而是**丢映射**——某行被合并或删掉后，
//   某个机械门从此在本表里**没有落点**，读者以为「这门有人登记」，实际查不到（本批实测：`M-Fact-1`
//   自 v18.25.0 落地起就没登记过，违反 §四.1，而没人发现）。本用例把「代码里的 M 门项」与「表里的登记」
//   钉在一起，**方向是 表 ⊇ 代码**（表可以有代码没有的号：人工项 `M-Integrity-2`、作废号留档、撞号登记）。
//   ⚠️ 反向断言（表 ⊆ 代码）刻意不做——那会把上述三类正当登记判成红。
test('对照表 §一/§二 必须登记代码里出现的全部 M 门项 ID（v18.40.0 收敛守）', () => {
  const table = readFileSync(join(SKILL, 'references', '_shared', TABLE_NAME), 'utf8')
  const back = sectionRows(table) // §一 + §二 的表行（§三 是「仍无门」，不算登记）
  assert.ok(back.length > 0, `对照表结构变了：§一/§二 里解析不到任何表行，本用例的扫描面无从确定`)
  const ids = codeGateIds()

  // 非真空守卫：四族都必须解析出门 ID。若某次重构改了 gate 模块的形状，`ids` 会变空集，
  //   而「未登记集合为空」照样**真空通过**——那正是一条假绿（本仓已有多起同族教训）。
  for (const fam of ['M-Form-', 'M-Exist-', 'M-Integrity-', 'M-Fact-']) {
    assert.ok(
      [...ids].some((i) => i.startsWith(fam)),
      `未能从 scripts/_lib/mgate-gates/ 解析出任何 ${fam} 族的门 ID——解析口径已断，本用例会真空通过。`,
    )
  }

  const missing = [...ids].filter((i) => !new RegExp(i.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![0-9])').test(back))
  assert.deepEqual(
    missing,
    [],
    `下列 M 门项在对照表 §一/§二 里查不到登记：${missing.join('、')}。` +
      '新增门族 / 门项时必须在同一次提交里同步本表（§四.1），否则「这门有没有人登记」在下一次收敛里无从回答。' +
      '修法：自基线起就有门的进 §一，历轮补上的进 §二。',
  )
})

// v18.43.0（主人「继续」→ 承 v18.40.0 的事前拦截）：把「新门必须登记」的断言**扩到第二个门族**。
//   为什么是 handoff 码族：它是除 M 门之外**唯一**「每条码都是一条规范判据 + 可从代码机械派生」的族
//   （15 条：A0/A1/A2/A3/A4/A4b/A4c/A5/A6/A7/A8/B1/B2/B3/B4）。本批实测缺口 = **7 条未登记**
//   （A0/A3/A4/A5/B2/B3/B4）——与 `M-Fact-1` 漏登同族：判据落地时没人回头看这张表。
//   **覆盖面边界（如实）**：脚本门族（`structure-check` / `methodology-check` / `quality-score` /
//   `readability` / `g-audit-check` 各项）与 ①②③… 规则号族**刻意不设**完整性断言——实测 27 个随包脚本里
//   22 个是工具类（`count-chars` / `md2html` / `model-routing` / `token-budget` …），本来就不是勾稽对象；
//   要覆盖它们只能靠一份无意义的豁免清单，那会把断言变成噪声（同「断言的面比语义宽 = 假绿」的反面）。
test('对照表 §一/§二 必须登记 handoff-check 的全部 A/B 判据码（v18.43.0 扩面）', () => {
  const table = readFileSync(join(SKILL, 'references', '_shared', TABLE_NAME), 'utf8')
  const registry = sectionRows(table)
  assert.ok(registry.length > 0, '对照表结构变了：§一/§二 里解析不到表行')
  const codes = handoffCodes()

  // 非真空守卫：两族都要解析出码（只解析出 A 族也能让「未登记集合为空」真空通过）
  for (const fam of ['A', 'B']) {
    assert.ok(
      [...codes].some((c) => c.startsWith(fam)),
      `未能从 scripts/handoff-check.mjs 解析出任何 ${fam} 族判据码——解析口径已断，本用例会真空通过。`,
    )
  }

  const missing = [...codes].filter((c) => !inRegistry(registry, c))
  assert.deepEqual(
    missing,
    [],
    `下列交接门判据码在对照表 §一/§二 里查不到登记：${missing.join('、')}。` +
      '新增判据码（`addHard`/`addSoft`）时必须在同一次提交里同步本表（§四.1）——' +
      '本批就是这么发现 7 条漏登的（A0/A3/A4/A5/B2/B3/B4）。' +
      '**只断言「代码 ⇒ 表」**：反向不设断言，因为表内合法保留作废号与否定的更正说明。',
  )
})

// v18.40.0：本表的两种「引用腐烂」，都在本批的读表过程中实测到——
//   ① **引用了不存在的行**：`01 卡` / `07 卡` / `09 卡` 各写「与 `规范-机械门对照表.md` 行 `X` 同源」，
//      而 `X` 这样的行在本表里没有（`M-Form-2 v2 分支` / `M-Exist-9 G 项实据` / `M-Exist-6.5 LLM 补充行`）。
//      **读者追过去什么也找不到**，而文本看上去完全正常——这正是本仓「断链」教训的第 N 次复现。
//   ② **引用了从未实装的门号**：`M-Form-2 v2` 分支被 5 处活文档当「机检」写（含协议层唯一出处，而那段
//      协议**自己指着一个不存在的伪代码块**）。作废门号的危害不是「多写了一句」，而是**下游据此以为
//      有机检兜底**（与 `M-Form-12` 假绿同族）。
//   断言两半：a) 「行 `X`」的 `X` 必须能在表内逐字找到；b) 作废门号不得在表外以「机检」身份出现——
//   **带否定标记的更正陈述允许**（同 `e-family-invariants.test.mjs` 的「无 M-Form-12」先例：
//   文档规范要求更正记录写出旧值，一律禁字会误伤正当文本）。
test('对照表引用守：行引用必须可解析，作废门号不得复活（v18.40.0 三悬空引用 + 一幻影门的回归）', () => {
  const table = readFileSync(join(SKILL, 'references', '_shared', TABLE_NAME), 'utf8')
  const registry = sectionRows(table) // 只有 §一/§二 的表行算「登记行」
  const NEG = /不存在|未实装|幻影|无门|作废|没有|已删|从未/
  const PHANTOM = 'M-Form-2 v2'
  const CITE = /行\s*(?:`([^`]+)`|\*\*([^*]+)\*\*)/

  const dangling = []
  const resurrected = []
  let citations = 0

  for (const f of walkSkillFiles(SKILL, ['.md', '.mjs'])) {
    const rel = relative(ROOT, f).split(sep).join('/')
    const isTable = rel.endsWith(TABLE_NAME)
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((ln, i) => {
      const at = `${rel}:${i + 1}`
      // ① 行引用可解析。**表自身除外**：它的散文在描述引用这件事（含占位符 `X`），不是在引用。
      if (!isTable && ln.includes(TABLE_NAME)) {
        const m = CITE.exec(ln)
        if (m) {
          citations += 1
          const tok = (m[1] || m[2] || '').trim()
          if (!registry.includes(tok)) dangling.push(`${at} 引用「${tok}」`)
        }
      }
      // ② 作废门号不复活。
      if (ln.includes(PHANTOM) && !NEG.test(ln)) resurrected.push(at)
    })
  }

  assert.ok(
    citations >= 1,
    '本用例一条「行 `X`」引用都没扫到——正则口径已与文档写法脱节（或最后一处引用被改写）。' +
      '请让口径跟上现行写法，**不要删掉本用例**（它是 ① 的唯一守卫）。',
  )
  assert.deepEqual(
    dangling,
    [],
    `下列位置引用了对照表 §一/§二 里不存在的行名 / 门 ID：\n  ${dangling.join('\n  ')}\n` +
      '修法（§四.7）：引用本表时用**门 ID** 锚（行名会随收敛改写），确要带行名就写成「§X 行 门 ID（行名）」，' +
      '并确认那行真的在 §一/§二 里（§三 的「仍无门」行请按「§三 <行名>」引用，不要写成「行 X」）。',
  )
  assert.deepEqual(
    resurrected,
    [],
    `下列位置把已作废的门号当「机检」写，而该门从未实装：\n  ${resurrected.join('\n  ')}\n` +
      '若这是**更正陈述**（写明它不存在 / 未实装），请在同行给出否定标记；若是宣称它存在，' +
      `改判为「无门 + 人工责任点」，并指向 ${TABLE_NAME} §三 首行。`,
  )
  assert.ok(table.includes(PHANTOM), `对照表 §三 首行的作废门号留档不得被删——它是「这个号为什么不能用」的唯一案卷`)
})

/**
 * M 门**机械项数**（非门 ID）的代码真源：`mgate-gates/*.mjs` 里 `gate:` 标签的**去重个数**。
 * ⚠️ `M-Integrity-2` 是人工门（T7.5 主控亲做，不由脚本产出、无 `gate:` 标签）→ 派生值天然 == 机械项数，
 *   总项数 = 派生值 + 1。**刻意不从文档抄**：手抄的那一份正是会漂的那一份。
 */
function mechanicalGateCount() {
  const ids = codeGateIds()
  assert.ok(
    ids.size >= 20,
    `从 mgate-gates/*.mjs 的 \`gate:\` 标签只派生到 ${ids.size} 个 M 门项（<20）——派生口径可疑，拒绝在噪声上断言`,
  )
  return ids.size
}

// v18.61.1（文档体检反哺）：把「M 门机械/总项数」这类**天生多处引用、且已连漂数版**的数字钉住。
//   实测漂移面：v18.25.0 加 `M-Fact-1`（机械 22→23）与 v18.27.0 加 `M-Exist-11`（→24）之后，
//   脚本头注释 / appendix / `methodology-check` / `glossary` / 多份角色卡与模板仍写「机检 22 项 / 总 23 项」，
//   而脚本**自己输出的 `total` 实测 = 24**（自报头与自输出互相矛盾，且没有任何门会响）。
//   根因：本文件既有的 M 门守卫只断言**门 ID 字符串覆盖**（它抓到过 `M-Fact-1` 漏登），**不断言数字**。
//   判据：① 机械项数从 `gate:` 标签**派生**（唯一真源 = 代码）；② 锚点文档必须写到派生值 + 四族全枚举；
//        ③ 同一批锚点文档不得再出现旧口径的**精确形态**（宽泛的「22」会误伤合法的历史口径三要素行，
//           故只钉 `机检 **22 项**`/`总项数 23 项`/`恒 22（机械项）`/`"total": 22,` 这类无歧义写法）。
test('M 门机械/总项数必须等于 mgate-gates 派生值，锚点文档不得留旧口径（v18.61.1 数字守卫）', () => {
  const mech = mechanicalGateCount()
  const total = mech + 1
  // 四族全枚举真源（与 M-Gate-Algorithm.md 顶部真源行同形）——数字对了但漏一族，同样是漂。
  const ENUM = 'M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1'

  const anchors = [
    join(SKILL, 'scripts', 'm-gate-check.mjs'),
    join(SKILL, 'references', '_shared', 'M-Gate-Algorithm.md'),
    join(SKILL, 'references', '_shared', 'M-Gate-Algorithm-appendix.md'),
    join(SKILL, 'references', 'glossary.md'),
    join(SKILL, 'SKILL.md'),
    join(SKILL, 'AGENTS.md'),
  ]
  const texts = new Map(anchors.map((f) => [f, readFileSync(f, 'utf8')]))
  const at = (f) => relative(ROOT, f).split(sep).join('/')

  // ① 枚举串必须在 M 门算法真源与两处常驻文档里逐字出现。
  for (const f of [
    join(SKILL, 'references', '_shared', 'M-Gate-Algorithm.md'),
    join(SKILL, 'SKILL.md'),
    join(SKILL, 'AGENTS.md'),
  ]) {
    assert.ok(
      texts.get(f).includes(ENUM),
      `${at(f)} 的 M 门项数枚举与代码派生值不同形：期望含「${ENUM}」（派生机械 ${mech} 项）。` +
        '加/删 M 门项时必须同批更新本枚举——「说机械 24 却只列 23 项」正是本批修掉的形态。',
    )
  }

  // ② 脚本头注释与报告 schema 的项数必须写派生值（这两处是「自报头/自输出矛盾」的高发点）。
  const script = texts.get(join(SKILL, 'scripts', 'm-gate-check.mjs'))
  assert.ok(
    script.includes(`机检 **${mech} 项**`),
    `${at(join(SKILL, 'scripts', 'm-gate-check.mjs'))} 头注释必须写「机检 **${mech} 项**」——` +
      `它与脚本自己输出的 \`total\` 是同一事实的两处陈述，实测曾长期停在「22 项」而 \`total\` = ${mech}。`,
  )
  assert.ok(
    script.includes(`总项数 ${total} 项`),
    `${at(join(SKILL, 'scripts', 'm-gate-check.mjs'))} 头注释必须写「总项数 ${total} 项」（机械 ${mech} + 人工 1）。`,
  )
  const appendix = texts.get(join(SKILL, 'references', '_shared', 'M-Gate-Algorithm-appendix.md'))
  assert.ok(
    appendix.includes(`"total": ${mech},`),
    `${at(join(SKILL, 'references', '_shared', 'M-Gate-Algorithm-appendix.md'))} 的 schema 示例必须写 \`"total": ${mech},\`（派生值）。`,
  )
  assert.ok(
    appendix.includes(`恒 ${mech}（机械项）`),
    `${at(join(SKILL, 'references', '_shared', 'M-Gate-Algorithm-appendix.md'))} §1.1 的 \`total\` 语义行必须写「恒 ${mech}（机械项）」。`,
  )

  // ③ 旧口径的**精确形态**不得留在锚点文档里（无歧义写法，故无需历史行豁免）。
  const STALE = [
    ['机检 **22 项**', '机械项数旧口径'],
    ['总项数 23 项', '总项数旧口径'],
    ['恒 22（机械项）', 'schema 语义行旧口径'],
    ['"total": 22,', 'schema 示例旧口径'],
  ]
  const stale = []
  for (const [f, text] of texts) {
    for (const [needle, what] of STALE) {
      if (text.includes(needle)) stale.push(`${at(f)} 仍含「${needle}」（${what}；现行为机械 ${mech} / 总 ${total}）`)
    }
  }
  assert.deepEqual(
    stale,
    [],
    `下列锚点文档残留 M 门项数旧口径：\n  ${stale.join('\n  ')}\n` +
      '修法：改为代码派生值（机械 ' + mech + ' / 总 ' + total + '），并保留四族全枚举。' +
      '**不要**为迁就文本放宽本断言——数字漂移正是这条守卫存在的理由。',
  )
})

// ── v18.62.4（全量审计-v18.62.3 P2-4）：CHANGELOG **最新段**的测试计数必须与真值不矛盾 ──────────
//
// 为什么需要：审计实测 18.62.3 段写「全量 `node --test` **575/575**」，而当时全量套实为 **604**
//   （575 是**根 `tests/` 一项**的数，`skills/*/tests/` 另有 29）——**这类数字无任何门覆盖**，
//   而它恰好会被读者当作「验证强度」的依据。本批自己又犯了一次同型错：18.62.4 段先写 `612/612`，
//   随后两批把套件加到 620 却忘了回改。
// **可断言的真值从哪来**：套件总数无法在**被跑的那个套件内部**取到（自指），故本用例**静态数**
//   「`tests/**` 与 `skills/*/tests/**` 里 `test(` 的出现次数」——它与 `node --test` 的计数一一对应
//   （本仓两个文件存在编译期宏式用例，未计入，故真值只会**偏小**；因此判据取**单向**：声明值 **≥** 真值）。
// **边界（如实）**：① 只查**最新段**——历史段是留痕，改它等于篡改 changelog；② 判据是「不矛盾」，
//   不是「精确相等」（精确相等需要每次加用例都改 CHANGELOG，会立刻退化成噪声门）。
test('v18.62.4 P2-4：CHANGELOG 最新段的测试计数不得与真值矛盾（且内部自洽）', () => {
  const cl = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  const ver = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  const start = cl.indexOf(`\n## ${ver} `)
  assert.ok(start >= 0, `CHANGELOG 必须有当前版本段「## ${ver}」`)
  const nextH2 = cl.indexOf('\n## ', start + 1)
  const seg = cl.slice(start, nextH2 > 0 ? nextH2 : cl.length)

  // 静态数用例数（与 node --test 的 tests 计数同量级；偏小 → 单向断言）
  let actual = 0
  for (const dir of ['tests', join('skills', 'lunheng-commands', 'tests')]) {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.test.mjs')) continue
      actual += (readFileSync(join(abs, e.name), 'utf8').match(/^test\(/gm) || []).length
    }
  }

  const pairs = [...seg.matchAll(/(\d{2,4})\s*\/\s*(\d{2,4})\s*(?:全绿|pass|通过)/g)]
    .map((m) => [Number(m[1]), Number(m[2])])
  assert.ok(pairs.length > 0, `最新版本段（${ver}）必须给出「N/N 全绿」形态的验证结论——否则本门无从核对`)

  // ① 内部自洽：每个 N/N 的两侧必须相等
  assert.deepEqual(
    pairs.filter(([a, b]) => a !== b),
    [],
    `最新版本段里的测试计数自相矛盾（N/N 两侧不等）：${JSON.stringify(pairs)}`,
  )
  // ② 与真值不矛盾：声明值必须 ≥ 静态真值（防「套件涨了、CHANGELOG 没跟」）
  const declaredMax = Math.max(...pairs.map(([a]) => a))
  assert.ok(
    declaredMax >= actual,
    `CHANGELOG 最新段声明全量套 **${declaredMax}**，而按测试文件静态数得的用例数已达 **${actual}**`
      + `（≥ 声明值）→ 声明已过期。修法：把该段「N/N 全绿」改为当前实测值（或删去绝对值只写「全绿」）。`,
  )
})

// ── v18.82.0（LongWriter 借鉴批 LW-1）：前文锚机制的防瘦身心线 ───────────────────────────
//   前文锚（T5 ≥5000 字档的跨节连贯机制）只写在 05 卡 + T5 派发话术两处；文档瘦身批次
//   历史上多次把「角色卡新增条目」当冗余删掉（AGENTS.md 登记「语义等价但不同形 → 机械面失明」）。
//   本断言保证：机制在则两处真源都在；要删须两处同删（那就必然是有意的撤销决策）。
test('LW-1 前文锚：05 卡与 T5 派发话术两处真源齐备（单删一处 = 瘦身漂移）', () => {
  const writer = readFileSync(join(SKILL, 'references', 'agents', '05-写作-writer.md'), 'utf8')
  const readme = readFileSync(join(SKILL, 'references', 'pipeline-readme.md'), 'utf8')
  const analyst = readFileSync(join(SKILL, 'references', 'agents', '04-分析-analyst.md'), 'utf8')
  assert.match(writer, /前文锚/, '05 卡必须含「前文锚」条目（机制定义真源）')
  assert.match(readme, /前文锚/, 'pipeline-readme.md T5 派发话术必须含「前文锚」（spawn 前必读，防只写卡不进话术重演教训 #57）')
  assert.match(analyst, /节间承接规划/, '04 卡 §11 要素须含「节间承接规划」（大纲期承接设计，与 05 卡配套）')
})
