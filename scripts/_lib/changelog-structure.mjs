// CHANGELOG「版本段结构自洽」对账（规则 ⑬ 机械化 · v18.18.13）——可单测。
//
// ── 为什么需要（真教训，不是假想）──────────────────────────────────────
// v18.18.12 发版后复查发现：**`## 18.18.11 — 2026-09-26` 这个版本标题被删了**。
// 起因是写 v18.18.12 段时 `old_string` 只匹配了那行标题、`new_string` 末尾忘了写回去——于是
// v18.18.11 的整段内容（`### 一、`…`### 六、`）挂到了 `## 18.18.12` 名下，两个版本段被合并。
//
// **它逃过了所有门**：`consistency-check` 规则 ⑪ 只核「**当前**版本段存在」（`## 18.18.12` 在场 → 通过），
// **没有任何门管历史版本标题被删**。这类「删掉历史边界」的失真在 v18.12.x 也发生过一次同形
// （18.12.0 段内有两个 `### 七、`，重号，直到本次才被发现）。
//
// ── 不变量（三条，全部自洽可判，不依赖 git / 网络 / 发布记录）──────────
//   ① **段内小节编号严格递增**：一个 `## X.Y.Z` 段里的 `### 一、`…`### 七、` 必须严格递增。
//      这是抓「版本标题被删」的**结构指纹**——两段合并后编号必然回绕（`…七、一、二…`）。
//   ② **首个 `## ` 段的版本 == `package.json.version`**：版本段必须写在最上面。
//   ③ **版本键不得重复**：同一个版本号不得有两个 `## ` 段。
//
// ── 为什么不用 git tag 作真源（如实）─────────────────────────────────
// 「哪些版本发布过」的权威来源是 git tag，但 CI 的 checkout 未必取 tag（浅克隆默认不取），
// 用它会造出一个**在 CI 上必然失败**的门。故这里选**完全自洽**的判据：不依赖任何外部记录。
// 代价如实声明：它抓不到「最后一个版本段被整段删除」这种（无编号回绕、也无重复键）的情形。
//
// ── 防空转（沿用 C-11 / ⑧d 教训，但**分层**）──────────────────────────
// **解析器**形状脱节 → 抛错：`parseChangelogSections` 解析不出 `## ` 段时**抛错**，绝不静默放行。
// **不变量是否退化** → 由调用方判：`reconcileChangelogStructure` 返回 `withSubs`（含编号小节的段数），
//   不抛错。**为什么这一处刻意与 `reconcileScriptHeaders` 的「checked === 0 即抛」不同**：
//   本函数在抛错点之前已经算出 violations，若此时抛错，那些**真实违例会被 throw 吞掉**——
//   门确实仍会红，但会报成「解析器脱节」而不是「CHANGELOG 有 X 处结构违例」，**丢掉了真正的发现**。
//   故这里把「退化」作为**返回值**交给规则，由规则同时报出违例与退化（实测：本设计由用例
//   「真问题③/④」暴露——它们此前被吞成「没有任何编号小节」）。

/** 中文数字 → 序号（只覆盖 CHANGELOG 实际用到的 一…二十五）。 */
const CN_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/** `一` / `十` / `十一` / `二十` / `二十五` → 数字；非数字返回 null。 */
export function cnToNumber(s) {
  if (/^\d+$/.test(s)) return Number(s)
  if (!/^[一二三四五六七八九十]+$/.test(s)) return null
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + (CN_DIGITS[s[1]] ?? 0)
  if (s.endsWith('十')) return (CN_DIGITS[s[0]] ?? 0) * 10
  if (s.includes('十')) {
    const [a, b] = s.split('十')
    return (CN_DIGITS[a] ?? 0) * 10 + (CN_DIGITS[b] ?? 0)
  }
  return CN_DIGITS[s] ?? null
}

/** 从 `## ` 标题里取版本键：`18.18.12 — 2026-09-26` / `2.5.2-dsh.17（2026-09-11）` / `17.0.0（未单独发布…）`。 */
export function versionOf(heading) {
  const m = heading.match(/^(\d+\.\d+\.\d+(?:-dsh\.\d+)?)/)
  return m ? m[1] : null
}

/**
 * 解析 CHANGELOG 的版本段结构。
 * @returns `{ sections: [{ heading, version, line, subs: [{ n, raw, line }] }] }`
 *   注意：`## ` 行之前的引言（文件头说明）不算段。
 */
export function parseChangelogSections(text) {
  const lines = text.split('\n')
  const sections = []
  let cur = null
  lines.forEach((l, i) => {
    const h = l.match(/^##\s+(.+?)\s*$/)
    if (h) {
      cur = { heading: h[1], version: versionOf(h[1]), line: i + 1, subs: [] }
      sections.push(cur)
      return
    }
    if (!cur) return
    const s = l.match(/^###\s+([一二三四五六七八九十]+|\d+)[、.．]/)
    if (!s) return
    const n = cnToNumber(s[1])
    if (n !== null) cur.subs.push({ n, raw: s[1], line: i + 1 })
  })
  if (sections.length === 0) {
    throw new Error('CHANGELOG 解析出 0 个 `## ` 版本段——段形变了，请同步本解析器（本门会静默失效）')
  }
  return { sections }
}

/** 版本键 → 可比较元组（`-dsh.N` 视为第 4 位；无则 0）。 */
export function versionTuple(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-dsh\.(\d+))?$/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0)]
}
const cmp = (a, b) => {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/**
 * 三条不变量的对账。
 * @param sections `parseChangelogSections` 的输出
 * @param pkgVersion `package.json` 的 version
 * @returns `{ checked, withSubs, violations: [{ kind, line, msg }] }`
 */
export function reconcileChangelogStructure(sections, pkgVersion) {
  const violations = []

  // ① 段内小节编号严格递增（抓「版本标题被删 → 两段合并 → 编号回绕」）
  for (const s of sections) {
    if (s.subs.length === 0) continue
    for (let i = 1; i < s.subs.length; i++) {
      if (s.subs[i].n <= s.subs[i - 1].n) {
        violations.push({
          kind: 'sub-order',
          line: s.subs[i].line,
          msg:
            `\`## ${s.heading}\`（:${s.line}）段内小节编号回绕：` +
            `:${s.subs[i - 1].line} 是 \`### ${s.subs[i - 1].raw}、\`，:${s.subs[i].line} 却是 \`### ${s.subs[i].raw}、\`——` +
            '同一版本段内编号必须严格递增。此形态通常意味着**上一个版本标题被删、两段被合并**了',
        })
      }
    }
  }

  // ② 首个版本段 == package.json.version
  const first = sections[0]
  if (first.version && pkgVersion && first.version !== pkgVersion) {
    violations.push({
      kind: 'first-mismatch',
      line: first.line,
      msg: `首个版本段是 \`## ${first.version}\`（:${first.line}），而 package.json = ${pkgVersion}——最新版本段必须写在最上面`,
    })
  }

  // ③ 版本键不得重复
  const byVer = new Map()
  for (const s of sections) {
    if (!s.version) continue
    if (byVer.has(s.version)) {
      violations.push({
        kind: 'dup-version',
        line: s.line,
        msg: `版本键 \`${s.version}\` 出现两次（:${byVer.get(s.version)} 与 :${s.line}）——同一版本只能有一个 \`## \` 段`,
      })
    } else {
      byVer.set(s.version, s.line)
    }
  }

  // ④ 版本键降序（只在两边都能解析出版本元组时判，避免历史异形标题造成假红）
  let prev = null
  for (const s of sections) {
    const t = versionTuple(s.version)
    if (!t) continue
    if (prev && cmp(t, prev.t) > 0) {
      violations.push({
        kind: 'order',
        line: s.line,
        msg: `版本段顺序不是降序：\`${s.version}\`（:${s.line}）比上一段 \`${prev.v}\`（:${prev.line}）更新`,
      })
    }
    prev = { t, v: s.version, line: s.line }
  }

  const withSubs = sections.filter((s) => s.subs.length > 0).length
  // 注意：这里**不抛错**（理由见文件头「防空转」段）——`withSubs === 0` 表示「子序不变量空跑」，
  //   由调用方作为独立失败项报出，这样它与上面已算出的 violations 能一起呈现，不互相吞掉。
  return { checked: sections.length, withSubs, violations }
}
