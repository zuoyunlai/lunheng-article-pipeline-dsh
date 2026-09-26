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
const SURFACES = [...README_FILES, 'SECURITY.md', 'docs/installation.md']

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
}

/** 在 surface 里找锚点行：`both` 全部命中才算该行（防命中同文件别处的偶发提及）。 */
function anchorLine(text, mustAll) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => mustAll.every((t) => l.includes(t)))
  return { line: i < 0 ? null : lines[i], no: i + 1 }
}

test('C-1 对外声明 ↔ 代码真源：工具/配置/命令/技能 四集合在 7 个声明面逐项一致', () => {
  const { tools, config, commands, skills, enumValues } = deriveCodeFacts()

  // 非空断言：派生退化（正则失配、文件改名）必须**响亮失败**，否则本门会静默变成恒真断言
  assert.equal(tools.length, 3, `应从 lib/tools.js 派生出 3 个工具，实测 ${tools.length}——派生正则可能已与源码脱节`)
  assert.equal(config.length, 5, `应从 lib/index.js 的 CONFIG_SPEC 派生出 5 个配置键，实测 ${config.length}`)
  assert.equal(commands.length, 2, `应从 lib/commands.js 派生出 2 条命令，实测 ${commands.length}`)
  assert.equal(skills.length, 2, `应从 skills/*/SKILL.md 派生出 2 个技能，实测 ${skills.length}`)

  for (const f of SURFACES) {
    const text = readFileSync(join(ROOT, f), 'utf8')

    // ① 工具集：锚 = 首个同时含「第一个工具名」的行
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

    // ② 配置集：锚 = 首个**同时**含 allowMechanismEdit 与 quiet 的行
    //    （只看 allowMechanismEdit 会误命中 SECURITY.md 的 guard 逃逸口行「config 写 allowMechanismEdit: true」）
    if (f !== 'docs/installation.md') {
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

    // ④ 技能集：整文件覆盖（技能名可在描述段与目录树任一处出现）
    for (const name of skills) {
      assert.ok(
        text.includes(name),
        `${f} 全文未提及技能 \`${name}\`。真源 = skills/*/SKILL.md 的 frontmatter name（共 ${skills.length} 个：${skills.join(' / ')}）。` +
          '⚠️ 漏声明的后果：按文档部署的人「装了什么」与事实不符（实例：lunheng-commands 曾在四语 README 里 0 命中）',
      )
    }
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
