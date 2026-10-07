// 一致性规则的**登记表 = 「有哪些主规则」的唯一真源**（v18.78.2 · 全量审计-v18.78.1 **A2** 修复）
//
// **为什么需要它（教训：同一处四次复发）**：
//   「规则数」这一事实此前**只写在 `consistency-check.mjs` 的头注释里**，而头注释自己四次被审计抓到数字不一致
//   （「21 类 + 4 个子规则」→「23 类」→「24 类」→「30 类」→「31 类」，且同一次里 `:3` / `:10` / `:13`
//   三个数字互不相等）。原作者的结论是「脚本无法可靠地从自身文本里数规则数（正文里到处是 ①-㉕ 的引用），
//   所以只做人工同步」——**人工同步的结果就是第四次复发**。A2 的注入实证：把 `glossary.md` 的
//   「31 类主规则」改成「99 类主规则」，`consistency-check` 仍 **exit 0 /「0 处漂移」**。
//
// **修法（三件一起做才算修）**：
//   ① 「有哪些主规则」上提为**代码里的登记表**（本文件），计数一律由本表**派生**，任何地方不再手写数字；
//   ② 文档（`consistency-check.mjs` 头注释 / `references/glossary.md` / `docs/quick-facts.md`）
//      **只许指向本表**——不写数字就不会漂（比「写数字 + 再加一道门」彻底，也符合「一事实一处」）；
//   ③ 规则 **㉟** 机械校验「本表 ↔ 各模块的规则级标签」**双向覆盖** + **编号唯一**
//      （编号唯一这条直接消灭「两条规则同号」那一族：实测 ㉕/㉖ 各被两个模块占用）。
//
// **边界（如实声明，别当万能门）**：
//   · 本表**只登记无字母后缀的主规则**。带后缀的子规则（`②a`/`③b`/`④b`/`⑥b`/`⑥c`/`⑩b`/`⑩c`/`⑩d`…）
//     **刻意不进本表**：它们的数量口径在本仓从未稳定过（头注释声明过「5 个子规则」，而实测带后缀的标签有
//     十余个），强行登记只会再造一个手写数字——那正是 A2 要消灭的东西。
//   · `module` 只声明「实装位置」，供人定位；㉟ 会核对每个登记项在其声明模块里**确有规则级标签**。
//   · 本表**不保证**每条规则本轮都在跑（规则可能被条件短路）——那是各规则自己的事（真源缺失另有 A6 的 P0）。
export const RULE_REGISTRY = Object.freeze([
  { id: '①', module: 'consistency-check.mjs', what: '跨文件版本一致性（package.json ↔ SKILL.md frontmatter ↔ 版本头行 ↔ 仓库级文档）' },
  { id: '②', module: 'consistency-check.mjs', what: '双头版本行 / M-Gate-Report 文件名与形状漂移' },
  { id: '③', module: 'consistency-check.mjs', what: '悬空引用（版本一致性检查旧名 / scripts/*.mjs 悬空 / 角色卡索引缺失）' },
  { id: '④', module: 'consistency-check.mjs', what: '裸「（检查）」占位符残留' },
  { id: '⑤', module: 'consistency-check.mjs', what: '8 分钟硬卡残留 / 硬编码 fallback 链' },
  { id: '⑥', module: 'consistency-check.mjs', what: '已知口径残留（M-Form 项数 / M-Gate-Report-v2.2.x / G 项数错标等）' },
  { id: '⑦', module: 'consistency-check.mjs', what: '全量版本头一致性（防单文件版本头漏 bump）' },
  { id: '⑧', module: 'repo-surface-rules.mjs', what: 'cordis.patch.yml + examples/ 版本引用' },
  { id: '⑨', module: 'repo-surface-rules.mjs', what: '.dsh 双写同步 + 污染校验' },
  { id: '⑩', module: 'script-rules.mjs', what: '随包脚本白名单集合一致性' },
  { id: '⑪', module: 'docs-version-rules.mjs', what: 'CHANGELOG 当前版本段存在性' },
  { id: '⑫', module: 'docs-version-rules.mjs', what: '版本点位全量扫描 + 版本头必须存在（v18.78.2 A1 加硬判据）' },
  { id: '⑬', module: 'docs-version-rules.mjs', what: 'docs/ 版本点位（安装 pin /「当前版本」声明）' },
  { id: '⑭', module: 'docs-version-rules.mjs', what: 'cordis.patch.yml 执行面红线' },
  { id: '⑮', module: 'content-rules.mjs', what: '派发卡行数上限（≤12 行）' },
  { id: '⑯', module: 'content-rules.mjs', what: '审计视图三方一致' },
  { id: '⑰', module: 'content-rules.mjs', what: '定量节省断言必须有算式/实测出处' },
  { id: '⑱', module: 'content-rules.mjs', what: '图件链路口径' },
  { id: '⑲', module: 'content-rules.mjs', what: '交接契约表（产出者声明 + 下游读清单）' },
  { id: '⑳', module: 'mgate-doc-rules.mjs', what: 'M-Gate-Algorithm.md 文档自洽' },
  { id: '㉑', module: 'repo-surface-rules.mjs', what: '五语 README 结构镜像' },
  { id: '㉒', module: 'repo-surface-rules.mjs', what: '按需查节锚点存在性' },
  { id: '㉓', module: 'repo-surface-rules.mjs', what: '阈值总表自洽（THRESHOLDS ↔ M-Gate-Algorithm.md）' },
  { id: '㉔', module: 'consistency-check.mjs', what: 'Phase 序列自洽（pipeline-readme 全景 ⊆ SKILL.md 速查序列）' },
  { id: '㉕', module: 'content-rules.mjs', what: '命令数口径（真源 = route-command.mjs COMMANDS 表）' },
  { id: '㉖', module: 'content-rules.mjs', what: '子技能版本一致性（lunheng-commands 三件套 + 引擎锚定）' },
  { id: '㉗', module: 'content-rules.mjs', what: '全库锚点覆盖（`](#anchor)` 目标标题 slug 必须存在）' },
  { id: '㉘', module: 'content-rules.mjs', what: 'SKILL.md 正文禁历史叙事句' },
  { id: '㉙', module: 'content-rules.mjs', what: 'G 项主清单口径（真源 = mexist-gates.mjs 的 G_MAIN）' },
  { id: '㉚', module: 'script-rules.mjs', what: 'lib/** 代码面禁当前版本字面量' },
  { id: '㉛', module: 'script-rules.mjs', what: '派发话术格式硬约束 ⊆ _shared/机检硬格式.md 必填项' },
  { id: '㉜', module: 'content-rules.mjs', what: 'CHANGELOG 新段位 ↔ introduction.md 实战验证段对账' },
  { id: '㉝', module: 'repo-surface-rules.mjs', what: '脚本数次级数字外泄扫描（**v18.78.2 由重号 ㉕ 改**）' },
  { id: '㉞', module: 'repo-surface-rules.mjs', what: '全仓库 .md BOM 检测（**v18.78.2 由重号 ㉖ 改**）' },
  { id: '㉟', module: 'repo-surface-rules.mjs', what: '本登记表自洽（登记项 ↔ 模块规则级标签双向覆盖 + 编号唯一）' },
  { id: '㊱', module: 'content-rules.mjs', what: '模板示例 ↔ 机检契约对照（**v18.78.2 由重号 ㉚ 改**）' },
  { id: '㊲', module: 'repo-surface-rules.mjs', what: '速查卡硬数字派生（版本 ↔ `package.json` / 角色数 ↔ `agents/` 编号卡 / 随包脚本数 ↔ `scripts/*.mjs` 实测；**v18.80.0 新立**）' },
])

/** 全部主规则 id（登记表顺序）。 */
export const RULE_MAIN = Object.freeze(RULE_REGISTRY.map((r) => r.id))

/** **唯一允许出现规则数的地方**：由登记表派生，任何文档不得再手写。 */
export const RULE_COUNTS = Object.freeze({ main: RULE_MAIN.length })
