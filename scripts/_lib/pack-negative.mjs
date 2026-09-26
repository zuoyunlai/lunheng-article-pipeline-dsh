// 发布面负清单（D-1② · v18.18.3）——按**路径分量**匹配，不是字符串前缀。
//
// ── 为什么必须改（这不是预防性设计，是一次真实漏检）────────────────────────────
// 旧实现在两处门里都是 `f.startsWith('tests/')`——**只看仓库根**。后果：
// `skills/lunheng-commands/tests/route.test.mjs`（22 用例）与
// `skills/lunheng-commands/package.json`（自带 `engines >=18` 与本包 `^22.19.0 || >=24`
// 冲突 + bundle 形态下无意义的 `peerDependencies`）**随包了**，而 `pack-smoke` 与
// `repo-hygiene` 照打印「仓库向文件零污染」。修掉那两个具体文件只治了症；
// 病是**门的匹配口径**——只要还是前缀匹配，下一个 `skills/<新技能>/tests/` 会一模一样地漏。
//
// ── 为什么不能一律「任意层级」──────────────────────────────────────────────
// `scripts` 是反例：仓库根 `scripts/` 不得随包，但 `skills/**/scripts/` 是
// **随包脚本本体**，必须发货（那是技能的全部机检能力）。一律 any-层级会让发布物直接残废。
// 故每条负清单项**显式声明作用域**（root / any / nested），不允许笼统 matching。
//
// ── 两处门共用本模块的理由 ──────────────────────────────────────────────
// 审计要求两处「同形」。写成两份相同代码 = 只是承诺同形；共用一份 = **结构上同形**，
// 改一处不可能只改到一边。
//
// 边界（如实）：本模块只回答「这个随包路径**命中**了哪条负清单」，不判该不该红——
// 判定与报错文案留在各自门里（两门的输出契约与退出码不同）。

/**
 * 负清单。`scope` 语义：
 *   · `root`   —— 仅当该分量出现在**仓库根**（路径第 1 段）时算命中
 *   · `any`    —— 出现在**任意层级**都算命中
 *   · `nested` —— 任意层级，但**排除仓库根那一个**（根同名文件是必需的）
 */
export const NEGATIVE = [
  {
    name: 'tests',
    kind: 'dir',
    scope: 'any',
    why: '仓库向测试目录：任意层级都不得随包（D-1 实例：skills/lunheng-commands/tests/ 曾随包而两门照绿）',
  },
  {
    name: 'scripts',
    kind: 'dir',
    scope: 'root',
    why: '只排**仓库根** scripts/——`skills/**/scripts/` 是随包脚本本体，必须发货；一律 any 层级会让发布物残废',
  },
  {
    name: '.github',
    kind: 'dir',
    scope: 'any',
    why: 'CI 配置对装包用户无用',
  },
  {
    name: 'CHANGELOG.md',
    kind: 'file',
    scope: 'any',
    why: '仓库向文件（见 CHANGELOG ## 18.2.0 的裁剪口径）',
  },
  {
    name: 'CONTRIBUTING.md',
    kind: 'file',
    scope: 'any',
    why: '仓库向文件（见 CHANGELOG ## 18.2.0 的裁剪口径）',
  },
  {
    name: 'package.json',
    kind: 'file',
    scope: 'nested',
    why: '根 package.json 是 npm 必需且强制随包；**嵌套 manifest** 在 bundle 形态下无意义，且其 engines / peerDependencies 与外层声明冲突',
  },
]

/** 路径分量。 */
const parts = (p) => p.split('/')

/**
 * 扫随包清单，逐条负清单项给出命中。
 * @param {string[]} files - `npm pack --json` 的 `files[].path`（POSIX 分隔符）。
 * @returns {{name:string,kind:string,scope:string,why:string,hits:string[]}[]}
 */
export function scanShipped(files) {
  return NEGATIVE.map((spec) => {
    const hits = files.filter((f) => {
      const ps = parts(f)
      if (spec.kind === 'dir') {
        const dirs = ps.slice(0, -1) // 最后一段是文件名
        if (spec.scope === 'root') return dirs[0] === spec.name
        return dirs.includes(spec.name) // any
      }
      if (ps[ps.length - 1] !== spec.name) return false
      if (spec.scope === 'nested') return ps.length > 1
      if (spec.scope === 'root') return ps.length === 1
      return true // any
    })
    return { ...spec, hits }
  })
}

/** 便于门输出的一句话摘要（两门共用同形文案）。 */
export function describeViolations(violations) {
  return violations
    .filter((v) => v.hits.length > 0)
    .map((v) => `发布面污染：${v.name}（${v.kind === 'dir' ? '目录' : '文件'}·${v.scope} 作用域）下有 ${v.hits.length} 个随包，如 ${v.hits[0]}——${v.why}`)
}
