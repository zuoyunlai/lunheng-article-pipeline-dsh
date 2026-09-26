// 随包脚本「执行面 / 写盘面」派生（C-7 机械化 · v18.18.8）——供 repo-hygiene 与测试使用。
//
// ── 为什么需要 ────────────────────────────────────────────────────────
// `SECURITY.md` 是**操作者安装前的信任边界依据**，其中一段手写维护着「哪些随包脚本会写盘 /
// 会派生子进程」。这类**手写代码事实清单**正是本仓反复出错的形态（C-1 工具数、D-1 发布面
// 负清单、C-11 退出码表、C-7 本次都是同族）：代码一改、清单不跟，而失真方向几乎总是
// **低报执行面**（把会写盘的脚本说成只读）。
//
// 审计 C-7 的实测：`SECURITY.md` 把 `apply-compression-cycle.mjs` 列为「只读」，而它
// `spawnSync` 转调 `consistency-check.mjs` / `build-evidence-bundle.mjs`（后者有 10 处写盘）。
// 该处已修；本模块补的是**防复发**——清单改为**从源码派生**，与文档对账。
//
// ── 分档口径（这是本次顺带改正的一处：文档原来把两档混为一谈）──────
//   · **写内容**：`writeFileSync` / `writeWithSafety` / `appendFileSync` / `copyFileSync` /
//     `renameSync` / `rmSync` / `unlinkSync`——会改变文件**内容**。
//   · **仅建目录**：只命中 `mkdirSync`——只造目录，不写内容（`--report` 输出目录之类）。
//   · **子进程**：`spawnSync` / `execSync` / `execFileSync` / `spawn` / `exec`。
// 文档原先把 `final-check.mjs`（仅 mkdirSync）与真正的写内容脚本并列，又漏了三个真写内容的
// ——两档混在一起就说不清「最坏能坏到什么程度」。
//
// ── 解析口径的坑（实测踩过）──────────────────────────────────────────
// 子进程模式**必须**排除方法调用：`/(?<![\w.])exec\s*\(/`。第一版写成 `/\bexec\s*\(/`，
// 结果把 **`RegExp.prototype.exec()`**（`re.exec(s)`）全算成派生子进程——12 个脚本里 9 个是误报。
// 「子进程面」这种安全断言宁可漏报也不能误报成灾：一次误报就会让整段描述失去可信度。
//
// ── 已知边界（如实，不要当作缺陷去「修」）────────────────────────────
// 本模块是**按 API 名字的静态扫描**，不是 AST 分析。故：
//   · `import { writeFileSync as w }` 再调 `w(...)` → **扫不到**（换了名字）。
//   · 经 `_lib/**` 间接写盘的脚本（如 `apply-compression-cycle.mjs` 走 `consistency-check.mjs`）
//     在本口径下自身不算写内容——文档里已单独说明该间接效果。
// 这两条都写进了 `tests/script-surface.test.mjs`，避免后来者误以为本模块能覆盖别名与间接调用。
import fs from 'node:fs'
import path from 'node:path'

const SPAWN_PATTERNS = [
  ['spawnSync', /(?<![\w.])spawnSync\s*\(/g],
  ['execSync', /(?<![\w.])execSync\s*\(/g],
  ['execFileSync', /(?<![\w.])execFileSync\s*\(/g],
  ['spawn', /(?<![\w.])spawn\s*\(/g],
  ['exec', /(?<![\w.])exec\s*\(/g],
]
const CONTENT_WRITE_PATTERNS = [
  ['writeFileSync', /(?<![\w.])writeFileSync\s*\(/g],
  ['appendFileSync', /(?<![\w.])appendFileSync\s*\(/g],
  ['copyFileSync', /(?<![\w.])copyFileSync\s*\(/g],
  ['renameSync', /(?<![\w.])renameSync\s*\(/g],
  ['rmSync', /(?<![\w.])rmSync\s*\(/g],
  ['unlinkSync', /(?<![\w.])unlinkSync\s*\(/g],
  ['writeWithSafety', /(?<![\w.])writeWithSafety\s*\(/g],
]
const MKDIR_ONLY_PATTERN = /(?<![\w.])mkdirSync\s*\(/

const hits = (src, patterns) => patterns.filter(([, re]) => (src.match(re) || []).length > 0).map(([n]) => n)

/**
 * 从**顶层**随包脚本（`scripts/*.mjs`，与 SKILL.md 白名单同口径）派生执行面/写盘面。
 * 只取顶层：`_lib/**` 是被引用的共享库，它的写盘能力通过顶层脚本体现（该口径写在文档里）。
 */
export function deriveScriptSurface(scriptsDir) {
  const top = fs
    .readdirSync(scriptsDir)
    .filter((f) => f.endsWith('.mjs'))
    .sort()
  const spawn = []
  const writeContent = []
  const mkdirOnly = []
  for (const f of top) {
    const src = fs.readFileSync(path.join(scriptsDir, f), 'utf8')
    const sp = hits(src, SPAWN_PATTERNS)
    const wc = hits(src, CONTENT_WRITE_PATTERNS)
    const mk = MKDIR_ONLY_PATTERN.test(src)
    if (sp.length) spawn.push(f)
    if (wc.length) writeContent.push(f)
    else if (mk) mkdirOnly.push(f) // 只建目录、不写内容
  }
  const mutated = new Set([...spawn, ...writeContent, ...mkdirOnly])
  const readOnly = top.filter((f) => !mutated.has(f))
  return { all: top, spawn, writeContent, mkdirOnly, readOnly }
}

/** 从 `SECURITY.md` 的「随包脚本」行解析出文档**声明**的三档清单。 */
export function parseSecuritySurface(docText) {
  const row = docText.split('\n').find((l) => l.includes('随包脚本') && l.includes('子进程面'))
  if (!row) throw new Error('SECURITY.md 未找到含「随包脚本」且含「子进程面」的行——文档结构变了，请同步本解析器')

  const namesIn = (segment) => [...new Set([...segment.matchAll(/`([^`]+\.mjs)`/g)].map((m) => m[1]))].sort()
  // ⚠️ 结束 marker 找不到时**必须抛错**，绝不能退化为「切到行尾」——本模块第一版就是这么错的：
  //    SECURITY.md 写的是「写文件面分两档」而不是「写文件面：」，`indexOf` 返回 -1，
  //    于是「子进程面」那一段一路切到行尾，把写内容/仅建目录的脚本名全算成了 spawner。
  //    这类**静默降级**正是本仓反复记录的门失效形态（门还在、但看的东西已经错了）。
  const slice = (from, to) => {
    const a = row.indexOf(from)
    if (a < 0) throw new Error(`SECURITY.md 的随包脚本行里找不到起始标记「${from}」`)
    const b = row.indexOf(to, a + from.length)
    if (b < 0) throw new Error(`SECURITY.md 的随包脚本行里找不到结束标记「${to}」（起始「${from}」之后）——请同步本解析器与该行措辞`)
    return row.slice(a, b)
  }

  return {
    spawn: namesIn(slice('子进程面：', '写文件面')),
    writeContent: namesIn(slice('写内容', '仅建目录')),
    mkdirOnly: namesIn(slice('仅建目录', '只读')),
  }
}

/** 双向差集。 */
export function reconcileSurface(derived, declared) {
  const diff = (a, b) => a.filter((x) => !b.includes(x))
  return {
    spawn: { onlyDerived: diff(derived.spawn, declared.spawn), onlyDoc: diff(declared.spawn, derived.spawn) },
    writeContent: { onlyDerived: diff(derived.writeContent, declared.writeContent), onlyDoc: diff(declared.writeContent, derived.writeContent) },
    mkdirOnly: { onlyDerived: diff(derived.mkdirOnly, declared.mkdirOnly), onlyDoc: diff(declared.mkdirOnly, derived.mkdirOnly) },
  }
}
