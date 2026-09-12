# 故障排查（troubleshooting）

> 版本：v18.0.5（DSH 原生插件，发布于 2026-09-11）

安装/验证失败时按「症状 → 原因 → 处置」对照。**先跑本地四道门**：

```sh
node skills/lunheng-article-pipeline/scripts/consistency-check.mjs   # 仓库一致性
node scripts/plugin-surface-check.mjs                                # 打包面契约
node scripts/repo-hygiene-check.mjs                                  # 语法/行尾/UTF-8/发布包
node --test "tests/**/*.test.mjs"                                    # 随包脚本 + 包入口回归
```

---

## 1. `dsh plugin add` 报 `pnpm` 相关错误 / `ERR_PNPM_IGNORED_BUILDS`

- **原因**：`dsh plugin` 内部转 pnpm；新建 profile 的 `pnpm-workspace.yaml` 里 `allowBuilds` 五项是占位符字符串。
- **处置**：编辑 `<DSH_HOME>/profiles/<profile>/pnpm-workspace.yaml`，把
  `'@deepseek-ai/dsh-subprocess-local': set this to true or false` 之类的占位符改成 `true`，再重跑 add。
- **另注**：`pnpm` 必须在 PATH 里（`dsh plugin` 依赖它）。

## 2. `dshmarket` 显示「安装完成但校验失败 / 入口产物缺失」

- **原因**：旧版（≤ v17.0.0）本包是纯 skill bundle，没有 JS 模块入口，而 dshmarket 的校验器只认 JS 入口。
- **处置**：v18.0.0 起本包带 `main` → `lib/index.js`，该校验不再误报。若在 v18.0.0 上仍报，请贴出 `npm view lunheng-article-pipeline@<ver> main` 的输出（应为 `lib/index.js`）作为 issue 证据。

## 3. 装完看不到 `lunheng-article-pipeline` 技能

按顺序排：

1. **bundle 是否进了 profile**：`<DSH_HOME>/profiles/<profile>/package.json` 的 `dsh.profile.bundles` 应含 `lunheng-article-pipeline`（新版 `dsh plugin add` 会自动加）。
2. **patch 行是否组合进树**：
   ```sh
   dsh --profile <profile> --dump-config | Select-String 'id: lunheng-article-pipeline|tool-subagent-(retrieval|strong|audit)'
   ```
   **必须先看到 `- id: lunheng-article-pipeline`（自注册行）**：loader 靠它 import 本包入口，技能才注册。只看到层头 `# == lunheng-article-pipeline`、没有这一行 → 入口从不被加载、技能绝不出现（v18.0.0 缺陷，18.0.1 修复）。
   注意：`--dump-config` 会把 `!!js` 原样打印（不求值），所以这一步只证明「行进入了组合树」，**不证明技能注册成功**——注册发生在入口 `apply` 里，仍需下一步验证。
3. **真验证**：开一个会话问「列出你可见的技能名称」——期望出现 `lunheng-article-pipeline`。
4. **同名覆盖**：检查当前工作目录下是否存在 `.dsh/skills/lunheng-article-pipeline/`（项目技能根 rank 100 **高于**本包的 rank 300，会**静默顶替**）。删掉或改名该目录即可确认。
5. **入口是否随包**：v18.0.0 起技能由包入口 `lib/index.js` 注册，入口在 `apply` 期读 `<包根>/skills/lunheng-article-pipeline/SKILL.md`。若安装副本缺 `lib/`（例如发布包的 `files` 白名单漏项，或手工只拷了 `skills/`），技能会**静默不出现**。排查：`node -e "import('<包根>/lib/index.js').then(m=>console.log(m.name,m.inject))"`，并确认 `<包根>/skills/lunheng-article-pipeline/SKILL.md` 存在。回归用例见 `tests/entry.test.mjs`。
   > 历史（≤ v17.0.0）：技能由 patch 里的 `@deepseek-ai/dsh-skill-filesystem` 提供者 + `!!js` 路径求值挂载，包被解析到共享回退目录（`<DSH_HOME>/profiles/node_modules`）时会因根不存在而静默消失；该路径求值已在 v18.0.0 删除。
6. **只想快速排除「是不是本地同名技能顶替」**：临时把 `<cwd>/.dsh/skills/lunheng-article-pipeline` 改名，重开会话再看技能是否出现。

## 4. `dsh-plugin-dev verify` 跑不通

- **症状 A**：`ERR_PNPM_IGNORED_BUILDS` → 见第 1 条。
- **症状 B**：报 `ENOENT .../dsh-pd-verify-XXXX/lunheng-article-pipeline-*.tgz` → 该工具复用真实 `DSH_HOME` 的 `compat` profile，里面钉着上一轮**已被清理的临时 tarball** 路径。处置：删掉 `<DSH_HOME>/profiles/compat/package.json` 与 `pnpm-lock.yaml` 后重跑。
- **症状 C**：安装步骤超时后 CLI 自身挂起不退出，且其 `dsh`/`pnpm` **孙进程会存活为孤儿**并锁住 `compat` 目录（导致目录删不掉）。处置：`Stop-Process` 掉命令行含 `--profile compat` 与 `dsh-pd-verify` 的进程，再删目录。
- 以上三条是 `dsh-plugin-dev` v0.3.7 的中止路径缺陷，已记录在 `CHANGELOG.md` 第 6 条。

## 5. Node 22.19 下 `npx dsh-plugin-guide` 报 `Cannot read properties of null (reading 'edgesOut')`

- **原因**：Node 22.19 自带 npm 10.9.3，无法安装声明了 **optional peerDependency** 的 `dsh-plugin-guide`（arborist 崩）。
- **处置**：用 `pnpm dlx dsh-plugin-guide@<ver> …` 替代 `npx`（本仓库的 `scripts/plugin-surface-check.mjs` 已自动优先 pnpm）。

## 6. 字数统计与报告对不上

- **正文区 vs 全文**：全流水线唯一口径是 **正文区纯汉字**（`## 摘要` 之后 ~ 文末节之前）。若定稿缺 `## 摘要`，`count-chars.mjs` 会输出 `degraded: true` 并在 stderr 告警——此时正文区起点退化为文件开头，**数字不可与目标区间直接比较**，应先补摘要。
- **一键终检**：`final-check.mjs` 已改为按正文区口径取数（旧版取全文）。

## 7. M 门报告/审计视图为空

- 报告真源是 `<项目>/final/M-Gate-Report.json`，由
  `node scripts/m-gate-check.mjs <项目>/final/定稿.md <项目>/final/证据包 --report <项目>/final/M-Gate-Report.json` 落盘。
- `build-evidence-bundle.mjs --summary` 会按该路径（兼容 `audits/` 旧路径）读取；找不到时会在审计视图里给出**可直接复制的命令**。

## 8. exit code 怎么看

**闸门脚本的约定（v18.0.2 起全库统一；v18.0.5 补异常路径与内部错误）**：

| 码 | 含义 |
|---|---|
| 0 | 通过（M 门要求：无失败且无 SKIP） |
| 1 | 存在 P1 失败 |
| 2 | 存在 P0 失败 |
| 3 | 仅 P2 / LLM 兜底 / SKIP —— **需 LLM 复核，不得当作通过** |
| 10 | **参数或路径错误（不是内容问题）** —— 全部随包脚本均用此码，**含异常路径**（`_lib/exit-guard.mjs` 把 fs 类未捕获异常统一映射为 10） |
| 70 | **内部错误（EX_SOFTWARE，脚本缺陷）** —— `exit-guard` 对非 fs 类未捕获异常使用；与内容判定无关，请连同命令与栈回报 issue |

> ⚠️ **v18.0.2 修掉的两处撞码**（都会误导主控）：
> 1. `m-gate-check.mjs` 旧版把「定稿不存在 / 证据包目录不存在」判 `exit 1`，而 `1` = 「P1 内容失败」→ 主控据此触发 T5 修订，实际只是路径传错。现统一 `10`。
> 2. `model-routing.mjs` 旧版用 `3` 表示「有档位无候选 / 需人工决定」，与 M 门 `3`（仅 P2，**可放行**）撞码。现改用独立码 **`4`**。
>
> ⚠️ **v18.0.5 修掉的三类「异常路径」误导**（第三方审计 P1-1，均已在 `tests` 里钉住）：
> 3. **未捕获异常退化成 1**：`count-chars <目录>`、`m-gate-check <目录> <目录>`、`build-evidence-bundle --source <目录>`、`final-check <文件当项目>` 等在旧版都会 `EISDIR/ENOTDIR` 崩溃 → Node 默认 `exit 1` → 被读成「P1 内容残留」。现：入口 `statSync().isFile()/.isDirectory()` 前置校验 + 顶层 `uncaughtException` 兜底，一律 `10`。
> 4. **子步骤没跑起来被记成 1**：`PATH` 为空等 spawn 失败在旧版记 `exit: null → 1`，`final-check` 还会打印「⚠️ 存在 P1 残留，可触发 T5 修订一轮」（把环境问题说成内容问题）。现记 **`70`** 并给独立推荐语。
> 5. **未知参数被静默忽略**：`--ful`（拼错）、`--nope` 等旧版直接当无事发生（`exit 0`，走默认口径）。现 `count-chars` / `model-routing` / `consistency-check` 显式拒绝并给用法。
>
> **不共用本语义的工具**（以各自头注释为准，均非流水线闸门）：`token-budget`（0 成功 / 1 用法 / 2 项目路径不存在）、`md2html`（10 参数或路径错 / 2 `--strict` 校验失败）、`pdfcheck`（1 结构异常 / 10 参数或路径错）、`token-cost`（0/1）、`normalize-trust-level`（1 = 有未决条目，其自有语义；全部输入路径都不存在 → 10）、`consistency-check` 与仓库两道门（0/1，CI 独立命名空间）。
>
> 退出码契约由 `scripts/repo-hygiene-check.mjs` 的**退出码表**机械核验（v18.0.2 新增；**v18.0.5 大修**——旧版只 grep `process.exit(字面量)`、且「表内数字在文件里出现过」近乎恒真，等于没核）。现规则：解析 `process.exit(<字面量|本文件 const|guard 导出常量>)` 的实际取值 → 必须是声明集子集；每个声明码必须能被解析或（动态 exit 时）有字面量；每个读盘脚本**必须 import `_lib/exit-guard.mjs`**，否则判失败。**边界（如实）**：动态计算的退出码静态不可判定，那部分由 `tests/scripts.test.mjs` 的异常路径用例覆盖。

## 9. CI 绿灯但内容有问题

先确认四道门都跑了：`ci.yml` 的 `drift-check` / `plugin-surface` / `hygiene` / `pack-smoke` / `script-tests`（后者含 **windows / macos** 矩阵）。
若某类漂移仍漏检，请按 `consistency-check.mjs` 的既有规则样式补规则 + **对抗测试**（注入假漂移确认能抓到，再还原），见 `tests/scripts.test.mjs`。

> **「安装→启动→卸载」这一段曾经没有门**（v18.0.5 补，第三方审计 P1-7）：CI 从来没有 `verify` job，本机 `dsh-plugin-dev verify` 又被 DSH Desktop 的 `dsh` shim（硬编码 `DSH_HOME`，见 §7）与 pnpm 原生依赖策略挡住。现由 **`pack-smoke` job + `scripts/pack-smoke.mjs`** 覆盖「发布物可装载」：`npm pack` → 解包 → 断言自注册行恰一行 / patch 行依赖已声明 / 真跑解包入口的 `apply`（注册名、正文非空、frontmatter 已剥离、`resourceBase` 指向解包目录）/ `tests` 不随包。**它仍不等于官方 verify**（不起真实 profile）——那一段在本机不可达，如实标注。

## 10. 审计视图（`audits/审计视图-v0.md`）读不到 / 内容像草稿

- **读不到**（v2.5.2-dsh.15 起）：
  - Phase 2～4.5 时**尚无定稿**，视图源自动回退到 `drafts/` 中版本号最高的正文；连草稿都没有（Phase 1-2）时仍会生成「素材阶段视图」（只有卡数/信任分布/报告存在性）。**若一行都没有**，多半是没跑生成命令：`node scripts/build-evidence-bundle.mjs <项目> --summary`。
  - 旧版（≤ dsh.14）该脚本**写死 `final/定稿.md`**，定稿前直接跳过 → 升级到 dsh.15 后 T6/T7/T9 才真正读得到。
- **视图头写着「草稿快照」是正常的**：草稿阶段的字数/引用闭环只代表那一轮；**定稿阶段必须重新生成**（`--source final/定稿.md`）后才能当定稿口径引用。
- **源的版本 ≠ 被审版本**：显式 `--source <被审正文路径>` 重新生成后再派发，不要拿旧视图审新稿。
- **`--source` 指向不存在的文件**：脚本 exit **10**（v18.0.5 更正：本节旧版写 2，与同节表格「参数或路径错误一律 10」自相矛盾；实际一直是 10）并**不复制证据包**（fail fast，避免半成品目录）。指向**目录**同样 exit 10（必须先 `statSync().isFile()` 就拦住）。

## 11. `token-cost.mjs` 参数报错 / 想看哪个角色最贵

- `--top N` 于 v2.5.2-dsh.15 **真正实现**（此前只有头注释与 CHANGELOG 提到，代码里是死变量 `topMode=false`）：输出 `topByCacheRead` 排名（cacheRead、单会话成本估算、占总量百分比）。
  ```sh
  node scripts/token-cost.mjs --sessions <主会话>,<子代理…> --top 5
  ```
- 未知参数与非法 `--top`（0/负数/非整数）现在一律 **exit 1** 并打印用法（旧版静默忽略，容易误以为生效）。

## 12. 检索「饱和」判定怎么落到交接报告

- T1/T2/T3 交接报告须含一行：`检索预算：已用 N 步 ｜ 饱和判定：<子主题>=饱和/未饱和`。
- 判据：**连续 2 轮检索（每轮 ≥3 次 query/URL）新增有效卡片 = 0** → 该子主题判饱和即停；首轮软预算 ≤40 步（Phase 1.5 补检索沿用 ≤30 步铁律）。
- 饱和**不等于**缺口：饱和段照实写「已检到饱和，未检索到 X」计入已知问题，**不得**补占位条目，也不得写成「已穷尽」。

## 13. 图件（`final/图件/`）与图表导出

- **唯一路径口径（v2.5.2-dsh.16 起）**：`final/图件/图N_标题.svg`（N 与正文 `[图N]` 对应；图位须**独占一行**）。旧文档里的 `final/图N-*.svg` 已废止——一致性规则 ⑱ 会拦截旧口径。
- **导出（多图）**：`node scripts/md2html.mjs <定稿.md> <out.html> --fig-dir final/图件`。**不要**用位置参数传单个 SVG——那会把同一份图嵌进每个 `[图N]`（脚本会告警，但导出结果仍是错的）；需要单图时才用它。
- **缺图**：图位没有对应 SVG 时，输出里是显式占位 `[图N]（期望文件：…/图N_标题.svg）`，不会静默留白。行内写的 `[图N：…]` 会被就地内联但**无图注**，脚本告警提示改为独占一行。
- **坏 SVG**：结构不合格（标签未闭合 / 无 `<svg>` 根 / 无 `viewBox` 且无宽高 / 含 DTD·ENTITY）→ `md2html.mjs` **exit 2 拒绝导出且不产出 HTML**（旧版原样嵌入、exit 0）。`<script>`/`on*`/`foreignObject`/`javascript:`/外部引用会被剥离并逐条告警；`--strict` 让任何告警都失败。判定真源 `scripts/_lib/svg.mjs`。
- **M 门 M-Form-9 图件闭环**（T7/T8 自动跑）：
  - 缺图（正文有图位、`final/图件/` 无文件）→ **P1**；**图件全缺或图位全缺 → P0**（exit 2，打回 Phase 4.5 补图）；图位数 < 任务简报「图位数量」→ 硬问题（呼应 T5 卡「必产 ≥ N 个图位」）。
  - 孤儿图件（图件未被正文引用）、图上数字在数据卡/正文找不到出处、SVG 安全告警 → **P2 提示**（数字对账是**启发式**，可能命中刻度/坐标，需人工确认）。
  - **未启用配图**（无图位且无 `final/图件/`）→ 记 **N/A 且通过**，不会因「没配图」把 M 门判失败（配图默认关闭）。
- **证据包与审计视图**：`final/图件/*.svg` 现在随证据包收进 `证据包/图件/`，审计视图有「图件对账」段（图位数/图件数/缺图/孤儿），T7/T8 不必逐文件翻图件。

## 14. 人在环：主人看不到进度 / 决策追不回 / 投喂材料被退

- **想随时看进度，不想翻会话记录**：读 `run/<项目>/进展-主人版.md`（≤15 行：现在在哪 / 已完成 / 下一步 / **需要主人做什么** / 风险 / 成本量级）。由主控在**每次派发后 + 闸门后**刷新；若你看到的还是旧内容 → 主控漏刷了一次（可要求立即刷新，不该让你等播报）。
- **事后想核对「当时我同意了什么」**：看 `run/<项目>/阶段确认-<阶段>.md` 的 **§6「主人回复」**（原话 + 时间 + 落盘结论）。**该段由主控回填，未回填 = 该门不算完成**——如果你发现某门 §6 是空的，说明那道门没按留痕规则走，可要求补记，并在交付说明的「主人决策记录」里如实标注「未留痕」。
- **哪些阶段要你确认**：**四门**——Phase 0 定题 / 2.5 大纲 / 3.5 洞察 / 5 终稿。每门都带「主控建议 + 一句话理由」，回「同意」即可。**无分歧的阶段主控可发微确认单（≤5 行）**，但仍必须你明确回复。
- **投喂一手数据被退回**：投喂只走一处入口 `run/<项目>/主人投喂清单.md`，主控按 4 项校验——① 路径存在可读 ② 口径/范围/时间齐全 ③ **可对外引用性**明确（标 ❌ 的只能作内部分析依据，不进正文、不进交付物）④ 脱敏与知情同意已确认。缺一项即退回补齐（**投喂材料默认不外发**，不进检索 query、不进 `final/证据包/`）。
- **洞察被问回细节**：属正常——无法定位到论点/论据的要求（如「写深一点」）主控会当场回问；一手数据类输入会改走投喂清单，不占 `[C-主NN]` 洞察编号。录入后主控应回执 `✅ 已录入 [C-主NN v<k>]（类型 X）→ 将用于 §Y`。
- **风格基线**：勾选后主控按 `templates/style-baseline-template.md` 产出 `style-baseline.md`，其 §0 必须写明「旧作仅用于文风对齐：不外发、不复制表达」+ 你的确认记录；**基线只压文风不压内容**（不得为对齐风格删论证或抄旧作原句）。

## 15. 模型分层没生效 / 想按角色配模型（v2.5.2-dsh.17）

- **先跑规划脚本**（只读，不写任何文件）：`node skills/lunheng-article-pipeline/scripts/model-routing.mjs`
  → 输出本机 provider×模型实况、四档路由（检索 / 分析写作 / 批判审计 / 主控）、**兜底链**、可复制的 env 片段。
  加 `--json` 给主控落 `run/<项目>/model-routing.md`；加 `--no-probe` 跳过本地探测；加 `--prefer-remote` 显式不用本地。
- **「没生效」通常是正常的**：**不设任何 `LUNHENG_*` 变量 = 三档全部继承会话模型**（安全默认，任何 provider 都能跑）。要分层就得设变量（见上条脚本输出），**且需重启 DSH**（工具配置在启动期注册）。
- **只给 `_MODEL` 就够**：provider 由宿主逐字段继承父级；**跨 provider 才必须同时给 `_PROVIDER`**（脚本会在建议里标出并同时输出两行）。
- **检索档默认「本地 Ollama + 远程兜底」**：脚本会自动探测本地 provider（仅 `127.0.0.1`，零外发、不读密钥）。本地**没起**（实测常见：`fetch failed`）→ 自动改用远端便宜档，并在报告里写明原因。
- **一键退路**：换了 provider 导致某档报错时设 `LUNHENG_TIERING=off` → 三档全部回到继承（即便其它 `LUNHENG_*` 已设）。
- **主控（T0）不在分层里**：它就是当前会话模型——想让它更稳，改 DSH 的 `agent-default-model`（settings.yaml）或会话内模型选择，**不由论衡自动改**。
- **看不到 `list_subagent_models` 是正常的**：原生「按调用选模型」需要宿主侧 `subagentModelSelection` 服务且工具行位于 Agent/preset scope，缺任一项**加载期抛错**，故本包不默认开启（宿主 standard 的 `subagent` 行也没开）。详见 `references/_shared/模型路由.md` §五。
- **模型名写错 = 该档不可用**：宿主**没有模型级回退**（`dsh-llm-retry` 只重试），所以脚本对拿不准的档位会明确写「保持继承」，**不要硬填**。

## 16. 新增机检项报了错怎么看（M-Form-10/11 与 M-Exist-5/6/7，v2.5.2-dsh.17）

M 门现为 **20 项**（其中 19 项由 `scripts/m-gate-check.mjs` 判定）。v2.5.2-dsh.17 新增 4 项，报错含义与修法：

| 项 | 报错样例 | 含义与修法 |
|---|---|---|
| **M-Form-10** 索引段完整性 | `文献卡.md: 索引段缺 2 条（L07,L12）→ 下游按索引定位会漏卡` | 卡片「## 📇 索引段」与正文条目不一致。补索引行（编号 + 主题 + 支撑论点）；T1/T2/T3 落盘前自检 |
| **M-Form-11** 素材按需加载闭环 | `正文引用但清单未记「已加载」：L07（引了没读 = 引用不可信）` | T5 每轮按 `templates/素材加载清单-template.md` 覆盖写 `analysis/素材加载清单.md`，「## 已加载」列出**实际读过**的编号；若确为误引则删正文引用 |
| | `已加载 26 / 索引 28 条（>90%）——疑似整卡通读` | **软提示**（P2）：按需加载的意义就在于选择性；确认是否真需要整卡 |
| **M-Exist-5** 阶段闸门记录表 | `缺 audits/闸门记录-T7.5.md` / `「数据条目数」的实据列不是机械证据` | 主控在闸门判定**当场**按 `templates/闸门记录-template.md` 抄表填写；「实据」写**路径 / exit code / 命令**，不写「已检查」 |
| | `闸门记录-T7.5 全判 ✓，但 M-Gate-Report.json 的 exit = 2` | **P0 自相矛盾**：闸门结论与 M 门报告必须一致——先查是哪一步漏跑 |
| **M-Exist-6** 审稿报告与期刊匹配 | `总评分 27/30 ≠ 6 维之和 24` | T9 的评分表与总分必须能相加；改到自洽（这是防「看起来专业的编造」） |
| | `「《管理世界》」综合匹配度 95% ≠ 复算值 84.7%` | 按 `期刊匹配算法.md` 公式重算：`0.5×主题 + 0.3×风格 + 0.2×(总分−16)/14`，容差 ±1.5 |
| | `「《某期刊》」在 期刊数据库.md 中查不到` | **软提示**：刊名须出自 `references/_shared/期刊数据库.md`，杜撰刊名会被拦 |
| **M-Exist-7** 交付说明字段齐备 | `缺固定字段「成本指标」` / `字段「遗留风险」仍含模板占位符` | T8 按 `templates/交付说明-template.md`（12 固定字段）填写；「主人决策记录」须覆盖四门，缺回填标「未留痕」而非省略 |
| **M-Form-8** 承重墙超载（v2.5.2-dsh.17 加） | `承重墙超载：[C02]×3论点` | 同一证据被 ≥3 个论点标为「承重证据 top1」——**被击穿则整链塌**：降级为辅助证据或补检索（T4 改大纲承重墙清单） |
| | `承重墙含卡片中不存在的编号：L99` | 大纲标的 top1 在素材卡里没有对应条目（承重墙虚标）→ 改指向真实编号或补检索 |
| | `大纲未见承重墙清单` | 只是提示（不判失败）：T4 未逐论点标 top1 → T6/T7 的清单专项检查随之失效 |
| **M-Exist-8** 批判报告覆盖 | `批判维度缺 1 节：C3（C1-C7 须逐条执行）` | T6 补写该维度（C3 理论假设 / C7 一处两用最常漏）；缺 >2 节 → P0 |
| | `X 条清单要素不足 3 项` | 段级清单须含 论点定位 / 反方观点 / 你的论据 / 攻击强度 / 建议 中的 ≥3 项 |
| **M-Exist-9** 审计报告 G 项覆盖 | `G 项未覆盖 4 个：G11,G12,G13,G14` | 审计报告逐项补写（缺 >3 → P0）；`G11 时效` / `G12 信任级别` / `G14 AI 痕迹` 是最常整段缺席的四个 |
| | `G7 有提及但邻域无结论词` | 须在该项附近写 通过/不通过/N/A + 证据，不能只提名不判定 |
| | `15 项结论无实据` | 结论要带**实据标记**：素材编号 `[Lxx]` / 文件路径 / `§` / 带量词的数字（`5/5`、`12 条`）——只写「通过」= 自称通过 |
| **M-Exist-10** 大纲 §11 精简段 | `大纲缺「写手版精简段」标题` | T4 按 `templates/…` 在本文件**末尾**写 §11；缺标题时 T5 只能回退整读大纲（50K 上下文） |
| | `缺 4 个要素：反方规划要点,字数预算,禁做项,承重墙清单` | §11 六要素：论证主线 / 论点-论据映射表 / 反方规划要点 / 字数预算（含数字）/ 禁做项 / 承重墙清单；缺 ≥3 → P0 |
| | `未见「论点-论据映射表」真表格` | 映射表要真表格（表头含「论点」+ 行内含素材编号），不能只写「论点 → 论据」 |
| **M-Exist-6** 审稿建议（v2.5.2-dsh.17 加） | `1/1 条建议无定位` | T9 的「给作者的具体修改建议」每条都要带 `§章节` / 段落 / 行号 / 素材编号，否则 T5 无法照做 |
| | `修订说明未提及审稿意见` | 发生过修订轮就必须在 `drafts/修订说明-vN.md` 里回应审稿意见（防「建议提了没人接」） |

- **触发条件**：M-Form-11 / M-Exist-7 在对应产物缺失时记 **N/A（不算失败）**；M-Exist-5 仅在项目已进入 Phase 4（有 `audits/审计报告-vN.md`）时才硬判；M-Exist-6 仅在存在审稿报告时才判——**不会因为「没启用 T9」而判 M 门不过**。
- **想看单条细节**：`node skills/lunheng-article-pipeline/scripts/m-gate-check.mjs <定稿.md> <证据包> --report <项目>/final/M-Gate-Report.json`，报告里 `results[]` 逐项给 `pass / detail / severity`。

## 17. 「到底省没省 token」怎么量（v2.5.2-dsh.17 新增）

- **一条命令出两类数**：
  ```bash
  node skills/lunheng-article-pipeline/scripts/token-budget.mjs --project run/<项目>   # 读目标对账（整读 vs 按需读）
  node skills/lunheng-article-pipeline/scripts/token-budget.mjs --roles                # 真实角色分布（读会话投影）
  ```
  加 `--json` 给机器可读；`--dsh-home <path>` 指定投影缓存位置。
- **两个口径别混**：`--project` 是**静态**（文件规模 → 估算 token 区间，汉字 0.6~1.0 token/字，**非计费值**）；`--roles` 是**真实**（会话投影里的 `tokenUsage.totals`）。要报给主人用后者，要判断「优化有没有效果」用前者做前后对照。
- **「按需读目标缺失」记 `n/a` 而不是 100%**：比如项目没生成审计视图 / 没跑 M 门报告时，脚本**不给省比**——否则会得出「省 100%」的假结论。
- **为什么 T5 最贵**：实测 43.09M cacheRead / 292 步 ≈ **147K/步**——这是「步数 × 每步上下文」，不是「一次读多大」。所以**越早进上下文的字越贵**：一次读进去的内容会被后续每一步重读（省 16K 初始上下文 ≈ 省 0.78M cacheRead/会话）。优化读取位置（§11 / 索引段 / 审计视图）比压缩单次输出更有效。
- **`76%` 与 `63.6%` 是两个口径**：76% 是 test-paper-02 单项目峰值，63.6% 是本机 34 个可识别论衡会话的聚合值。引用时**必须写口径**，否则就是「单项目值当通用值」的漂移（自省审计抓到过这类问题）。
