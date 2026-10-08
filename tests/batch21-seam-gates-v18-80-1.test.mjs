// v18.80.1（全量审查修订批）**第 2 批 · 反向断言门**。
//
// 为什么需要这一组：v18.80.1 全量审查发现三类「口子」此前**没有任何门在看**——
//   ① **工具面与文档面的旗标缺口**：`SKILL.md` 说「工具优先用」，而工具参数面覆盖不到脚本的全部旗标
//      ⇒ 调用方按文档走会**静默少做一步**（最贵的一例：M 门报告不落盘）；
//   ② **「包内 404」**：`link-check` 只在**仓库布局**下解析路径，看不见「文档链接指向未随包的文件」——
//      `docs/quick-facts.md`（被 6 份随包文档标为「硬数字单一真源」）正是这一类，装包后点开即 404；
//   ③ **文档自称的边界与包面相反**（`docs/`、`examples/` 被四处文档写成「不随包」，而 `files` 里都在）。
// 三条都是**声明与事实之间**的缝，靠读文档发现不了 → 本文件把它们做成机械判据。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ROOT, NPM_UNAVAILABLE, skipWhen } from './_fixtures.mjs'

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')

// ─────────────────── ① 工具面旗标缺口：文档要求的旗标必须「已接线」或「已登记」 ───────────────────

test('① 工具面旗标缺口：文档要求的旗标必须已接线（args.X）或已在 TOOL_FACE_FLAG_GAPS 登记', () => {
  const src = read('lib', 'tools.js')
  const gaps = {}
  for (const m of src.matchAll(/(lunheng_[a-z_]+):\s*Object\.freeze\(\[([^\]]*)\]/g)) {
    gaps[m[1]] = m[2].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
  }
  assert.ok(Object.keys(gaps).length >= 3,
    `须能派生出工具面缺口表（至少三个脚本工具），实得 ${JSON.stringify(Object.keys(gaps))}`)

  // **按工具切片**再判「是否接线」：`args.report` 在 handoff 里接了、在 m_gate 里没接——
  //   全局匹配会把前者误算到后者头上（本用例首版即踩，故按 `name: '<tool>'` 到下一个工具名之间取段）。
  const sliceOf = (tool) => {
    const i = src.indexOf(`name: '${tool}'`)
    if (i === -1) return ''
    const rest = src.slice(i)
    const j = rest.indexOf("name: 'lunheng_", 10)
    return j === -1 ? rest : rest.slice(0, j)
  }
  const wiredIn = (tool, flag) => new RegExp(`args\\.${flag}\\b`).test(sliceOf(tool))

  // 文档面明确要求、而脚本确有该旗标的那些（本表 = 报告 §D2 的实测清单）
  const REQUIRED = [
    { tool: 'lunheng_handoff_check', flag: 'requireGates', why: 'SKILL.md Phase 5「handoff-check --role T8 --require-gates」（缺它则 A7 四门从不核、B0 降软）' },
    { tool: 'lunheng_handoff_check', flag: 'level', why: 'references/templates/审计报告-template.md「--role T7 --level strict」' },
    { tool: 'lunheng_m_gate', flag: 'report', why: 'AGENTS.md 闸门留证「--report <项目>/final/M-Gate-Report.json」（M-Exist-5 指纹互锁与 M-Exist-9 的共同输入）' },
  ]
  for (const r of REQUIRED) {
    assert.ok(wiredIn(r.tool, r.flag) || (gaps[r.tool] || []).includes(r.flag),
      `${r.tool} 的 ${r.flag} 既未接线、也未登记缺口——调用方按文档走会静默少做一步（来源：${r.why}）`)
  }

  // 反向：缺口表不得有**陈旧项**（登记为缺口、其实该工具已经接线）
  for (const [tool, flags] of Object.entries(gaps)) {
    for (const f of flags) {
      assert.ok(!wiredIn(tool, f),
        `${tool}.${f} 已接线，须从 TOOL_FACE_FLAG_GAPS 移除（陈旧登记会让「缺口」这个事实失真）`)
    }
  }

  // ── 描述面（v18.80.1 · 报告 §D2）：工具描述**不得**给出与 SKILL.md 相反的可用性暗示，
  //    且它自己的旗标缺口必须在描述里**可见**（否则调用方按「工具优先用」走会静默少做一步）。
  const descOf = (tool) => {
    const i = src.indexOf(`name: '${tool}'`)
    if (i === -1) return ''
    const rest = src.slice(i)
    const j = rest.indexOf('parameters:')
    return j === -1 ? rest.slice(0, 1600) : rest.slice(0, j)
  }
  const handoffDesc = descOf('lunheng_handoff_check')
  assert.ok(handoffDesc.length > 0, '须能切片出 lunheng_handoff_check 的描述段（实现变更时同批更新本用例）')
  assert.ok(!/T8[^）\n]{0,14}一般不用/.test(handoffDesc),
    '`role` 描述不得声称 T8「一般不用」——`SKILL.md` §执行能力边界要求 Phase 5 跑 `--role T8 --require-gates`，'
    + '两处相反会让主控据工具描述跳过交付前验收（报告 §D2 实测矛盾）')
  assert.match(handoffDesc, /TOOL_FACE_FLAG_GAPS/,
    'handoff 的旗标缺口（`--require-gates` / `--level`）必须在**工具描述**里可见，不能只躺在常量表里')
})

// ─────────────────── ② packed 链接：随包 .md 的链接必须落在包内 ───────────────────

test('② packed 链接：随包 .md 的 Markdown 相对链接必须落在包内（或属已登记的仓库级目标）', (t) => {
  if (skipWhen(NPM_UNAVAILABLE, 'npm 不可用')) { t.skip('npm 不可用——跳过包面链接检查'); return }
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8', shell: true })
  const packed = new Set(JSON.parse(out)[0].files.map((f) => f.path))

  // **已登记的仓库级目标**（**故意**不随包）：npm 常态——README 在 npm 首页渲染时这些链接只在 GitHub 可用。
  //   只收「维护者/仓库向」目标；**面向装包用户的目标（如 docs/quick-facts.md）不得进白名单**，
  //   否则本条就退化成「白名单兜底、什么都拦不住」（本批实测：quick-facts.md 正是被 6 份随包文档引用而漏在包外）。
  const REPO_ONLY = [
    /^CHANGELOG\.md$/, /^CONTRIBUTING\.md$/, /^tests\//, /^audits\//,
    /^scripts\//, /^docs\/审计与修订记录\//, /^docs\/验证记录\//,
  ]

  const offenders = []
  const missingTargets = []
  const hitRepoOnly = new Set()
  // 路径型目标判据（与 `link-check.mjs` 口径 ① 同源）：含目录分隔符，或扩展名在白名单内。
  //   为什么必须：`references/templates/sources-索引-template.md` 的表格里写着 `` `[name](url)` ``——
  //   `url` 是**占位符值**不是路径；不设此判据会把写法示例当断链（本批实测踩到）。
  const EXT_RE = /\.(?:md|mjs|js|json|ya?ml|svg|png|txt|csv)$/i
  const isPathLike = (t) => t.includes('/') || EXT_RE.test(t)
  for (const rel of packed) {
    if (!rel.endsWith('.md')) continue
    const txt = readFileSync(join(ROOT, rel), 'utf8')
    let inFence = false
    for (const line of txt.split('\n')) {
      if (/^\s*(?:```|~~~)/.test(line)) { inFence = !inFence; continue }
      if (inFence) continue
      // 代码跨度内遮成等长空格（同 `content-rules.mjs` 规则 ㉗ 的 codeMasked 手法，保偏移）
      const codeMasked = line.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length))
      for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (codeMasked[m.index] === ' ') continue               // 写法示例（落在代码跨度内）
        const target = m[1].split('#')[0]
        if (!target || /^(https?:|mailto:|#|\/)/.test(target)) continue
        if (target.includes('...')) continue                     // 缩写记法（link-check 同口径）
        if (!isPathLike(target)) continue                        // 非路径型（如占位符 `url`）
        const abs = resolve(dirname(join(ROOT, rel)), target)
        const relTarget = relative(ROOT, abs).replaceAll('\\', '/')
        if (relTarget.startsWith('..')) continue                 // 包外（上游技能/官方文档）
        // v18.80.4（审计优化方向 0 落地 · 批 A）：**本地目标不存在即判负**。
        //   旧版此处 `continue`，注释写「真断链归 link-check」——但 link-check **从未被 CI 调用**
        //   （`check:link` 无任何 workflow 引用），而唯一会跑 `scan()` 的用例只钉扫面与分类、
        //   从不断言 `broken` 为空 ⇒ 「随包文档指向不存在的文件」在两侧**都不判**。
        //   现为 fail-closed：包内本地目标（非 `..`）不存在 → 直接进 missingTargets。
        if (!existsSync(abs)) { missingTargets.push(`${rel} → ${relTarget}`); continue }
        if (packed.has(relTarget)) continue
        if (REPO_ONLY.some((re) => re.test(relTarget))) { hitRepoOnly.add(relTarget); continue }
        offenders.push(`${rel} → ${relTarget}`)
      }
    }
  }
  assert.deepEqual(missingTargets, [],
    `随包文档里的 Markdown 链接指向**仓库内不存在的文件**（断链，且不在包内）：\n${missingTargets.join('\n')}`)
  assert.deepEqual(offenders, [],
    `随包文档里的 Markdown 链接指向**未随包且未登记**的目标（装包后 404）：\n${offenders.join('\n')}`)
  assert.ok(hitRepoOnly.size > 0,
    '仓库级目标白名单本次 **0 命中**——白名单可能已陈旧（或包面已变），请复核后收窄')
})

// ─────────────────── ③ 「仓库级资源清单」的口径：仓库级 ≠ 不随包 ───────────────────

test('③ maintainers §五「仓库级资源清单」：路径须确实不在技能目录内，且须声明「仓库级 ≠ 不随包」', () => {
  // 病灶（v18.80.1 实测）：§五 原文把 `docs/`、`examples/` 整体说成「**不随包**」「**不在盘**」，
  //   而 `package.json#files` 里 `docs/*.md`（7 份）与 `examples` **都在** ⇒ 四处文档互斥，
  //   且 `SKILL.md` 的运行期指示会让 agent**永远不去看**那份其实读得到的 preset 配方。
  //   正确口径是「**不在技能目录内**」（运行期角色只读 `skills/<name>/**`）——本用例把这条钉住。
  const src = read('skills', 'lunheng-article-pipeline', 'references', 'maintainers.md')
  const sec = src.split('## 五、')[1]
  assert.ok(sec, '未找到 §五（仓库级资源与技能体的边界）——若标题变更须同批更新本用例')
  const block = sec.split('## 六、')[0]

  assert.match(block, /仓库级\s*≠\s*不随包/,
    '§五 必须显式声明「仓库级 ≠ 不随包」：`docs/*.md` 与 `examples` **在 `files` 里**，写成「不随包」是事实错误；'
    + '「不在技能目录内」与「不随包」是两个不同的集合，混用会让运行期角色对可读文件视而不见')

  // 逐行取「首列里的第一个反引号 token」——表格首列写法不统一（`path` / `path` §8 / 根 `scripts/`），
  //   故不做整格精确匹配，只取代码跨度（这样 `docs/introduction.md 等用户文档` 也能取到真路径）。
  const rows = [...block.matchAll(/^\|\s*([^|\n]+?)\s*\|/gm)]
    .map((m) => (m[1].match(/`([^`]+)`/) || [null, m[1]])[1]?.trim())
    .filter((p) => p && !/^[-: ]+$/.test(p) && p !== '仓库级路径')
  assert.ok(rows.length >= 3, `须从 §五 表解析出路径清单（≥3 行），实得 ${JSON.stringify(rows)}`)
  for (const p of rows) {
    assert.ok(!p.startsWith('skills/'),
      `「仓库级资源清单」不得收录技能目录内的路径：${p}——该表口径 = 「不在技能目录内」，`
      + '收录技能内路径会让读者以为它需要「运行期替代」（其实运行期直接读得到）')
  }
})
