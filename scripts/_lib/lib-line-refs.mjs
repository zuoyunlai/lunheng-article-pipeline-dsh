// `lib/**:LINE` 裸行号引用检测（C-9 机械化 · v18.18.9）——供 repo-hygiene 使用，可单测。
//
// ── 为什么需要 ────────────────────────────────────────────────────────
// 审计 C-9 的实测：`SECURITY.md` 引 `lib/tools.js:18,24,133,191`，而实际 `:18` 是
// `import { spawn }`、`:24` 是缓冲注释、真实 `spawn` 调用在 `:31`。**行号引用会随任何改动漂移**，
// 而它读起来却像一个可核验的事实——比没有引用更有害。
//
// 该处当时已改为符号引用，`SECURITY.md` 甚至就地写下了政策：「行号随改动漂移故**按符号引用**，
// **不写绝对行号**」。**但政策没有门** ——v18.18.9 复核发现同一文件隔壁那行仍写着
// `lib/guard.js:177`，而该行实际是 `const cwd = process.cwd()`；真正的守卫安装点是
// `installMechanismGuard()` 内的 `tools.guard(...)`。**同一份文档里，一行宣布了政策、下一行违反了它。**
// 这就是本门的存在理由：政策要靠门落，不能靠同一页上的另一句话。
//
// ── 口径 ─────────────────────────────────────────────────────────────
//   · **只认「本仓的 lib/」**：路径前一个字符若是 `/`（如 `dsh-app-boot/lib/index.js:1112`，
//     那是**上游包**的路径），不算本仓引用——否则会把对上游代码的引用误判成我们的。
//   · **历史记录豁免**：`CHANGELOG.md` / `audits/**` / `docs/审计与修订记录/**` 是**当时状态**的
//     留痕，拿今天的代码去核它们反而是错的。豁免是**按目录**声明的，不是「凡是引用都放过」。
//   · 只判**存在性**（有没有裸行号），不判对错——对错无法静态判（正因如此才要求改成符号引用）。

/** 本仓 `lib/**.js:LINE` 的裸行号引用。`(?<![\w./-])` 排掉上游包的 `pkg/lib/...` 形态。 */
const LIB_LINE_REF = /(?<![\w./-])lib\/[\w.-]+\.js:(\d+)/g

/** 找出文本里所有裸行号引用。 */
export function findLibLineRefs(text) {
  const out = []
  for (const m of text.matchAll(LIB_LINE_REF)) {
    out.push({ raw: m[0], line: Number(m[1]) })
  }
  return out
}

/** 历史留痕文件（记录的是「当时」的状态，不拿今天的代码去核）。 */
export const HISTORICAL_DOC_PATTERNS = [
  /^CHANGELOG\.md$/,
  /^audits\//,
  /^docs\/审计与修订记录\//,
]

/** 该路径是否为历史留痕文件。 */
export function isHistoricalDoc(rel) {
  return HISTORICAL_DOC_PATTERNS.some((re) => re.test(rel))
}
