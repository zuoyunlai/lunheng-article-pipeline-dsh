# 维护者手册（maintainers.md）

> 版本：v18.34.0｜**读者**：维护者/主人。**本文件不进任何运行期读清单**（角色/主控不读）；它承接 v18.8.0 文档瘦身从 SKILL.md 迁出的维护者向元信息（rank 考证 / guard 缺口 / 更正史）。改本文件不受「同一事实多处漂移」约束——运行期事实仍以 SKILL.md 为唯一真源，此处是背景与考证。

## 一、技能来源 rank 考证（v18.0.0 对齐官方；v18.0.5 修两处官方事实）

同名技能按 **rank 就近取胜**，低 rank 会**静默顶替**高 rank 且无告警。官方 rank 表（`docs/subsystems/skills` 子系统契约）：

| rank | source | 根目录 |
|---|---|---|
| 100 | `project-dsh` | `<项目根>/.dsh/skills` |
| 200 | `project-agents` | `<项目根>/.agents/skills` |
| **250** | **`runtime`（本包 bundle 形态）** | **`ctx.skills.register()` 注册** |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<DSH_HOME>/skills` |
| 500 | `user-agents` | `<AGENTS_HOME>/skills` |
| 600 | `bundled` | `Config.bundledSkillDir` / `DSH_BUNDLED_SKILL_DIR` |

- **实践含义**：项目级副本（100）**胜过一切**（含已装 bundle 250）——「装了 bundle 又留 `.dsh/skills/` 副本」时生效的一直是副本；自检只能靠**读到的 `SKILL.md` 绝对路径 + 版本头**，rank 表不足以反推。
- **v18.0.5 更正**：本包走 `ctx.skills.register()`，候选 rank 恒为 `RUNTIME_RANK = 250`（非 600）；把技能拷到 `~/.dsh/skills`（400）**不能**覆盖已装 bundle（250）。
- **frontmatter 契约**：provider 只读 `name`/`description`/`whenToUse`，其余顶层键（含 `version`）被丢弃；模型会话目录只渲染 `name` + `description`——**「不适用」路由必须写进 `description`**。

## 二、机制写保护（guard）的已知边界（如实声明，不许夸大）

- guard 只看**工具调用**（write/edit/apply_patch 类）。`pwsh`/子进程不经此门——官方对子进程的围栏是部署级 `ctx.sandbox` 后端 / `sandbox/mode`，插件改不了别人的 profile；官方也没有 per-path 只读声明（`fs/write-intent` 无 deny 返回值）。故该保护是「**比 prompt 强、比机制强制弱**」的部分强制。
- guard 覆盖的写工具名集合见 `lib/guard.js` 的 `WRITE_TOOLS`（不同宿主版本的写工具名可能不同，集合匹配 + 参数键名匹配，宁松勿误伤）。
- **部署处方（收敛 pwsh 缺口的推荐配置）**：在宿主 profile / sandbox 配置中将技能包安装目录设为只读（如 Windows 上对 `<包根>/skills/lunheng-article-pipeline` 移除写 ACL；或 sandbox mode 限制写范围到工作区），即把「残余缺口」收敛为部署级强制。
- 主人授权例外：`LUNHENG_ALLOW_MECH_EDIT=1`（env，操作者开关）或插件行 `config: { allowMechanismEdit: true }`（profile，部署开关）。

## 三、更正史与教训编号索引

- 版本注解聚合政策：见 `AGENTS.md`「注解聚合」条；完整演进见 git log 与**仓库根 `CHANGELOG.md` / `audits/**`**（**均不在随包目录内**——npm 发布物与纯技能目录部署都没有这些文件，缺则跳过，不要当成断链）。
- 历史更正（原文详注已聚合）：v18.0.5 修「verify job 不存在」误述；v18.0.1 补 patch 自注册行（v18.0.0 缺陷）；v18.2.4 实证 `disabled` 行级门控；v18.2.6 更正 `!!js` 执行面计数（3→6 处）。
- 教训编号（#57/#128/#152/#153/#154…）：出处见 git log 对应提交与 `references/memory/lessons.md`。
- 全量审计（v18.7.1 综合评分 7.6/10）与修订方案：`audits/全量审计报告-v18.7.1.md`、`docs/审计与修订记录/论衡插件-修订方案-v18.7.2.md`。

## 四、发布面事实

- npm 包不含 `.github/`、`tests/`、`scripts/`（仓库级）、`CHANGELOG.md`、`CONTRIBUTING.md`——由 `package.json` files 白名单 + `repo-hygiene-check` 规则⑥ 负清单 + `pack-smoke` mustNotShip **双重机械保证**（非自觉）。
- npm 强制包含根目录 `README*` 与 `LICENSE`（从 files 删掉、加 .npmignore 均无效，已实测）——五语 README 一定在包内，不是缺陷。
- 发布 = 推 tag，由 `.github/workflows/publish.yml`（OIDC Trusted Publishing + `--provenance`）完成。
- **`latest` dist-tag 不会自动前移**（`NPM_TOKEN` 已删；`--tag dsh` 只动 `dsh`）→ 每次发版后手工跑一次：
  `npm dist-tag add lunheng-article-pipeline@<新版本> latest`（`dsh` 由 publish 工作流维护）。v18.12.0 发版后已执行，两个 tag 均指向 18.12.0。

## 五、仓库级资源与技能体的边界（**L-25 定案**，v18.12.2）

> **主人 2026-09-25 定案**：「`docs/`、`examples/` 如果作为独立插件不影响用户使用，**可以不进技能目录**」。
> 即**保持现状**（它们是仓库级资料，不随包），但**运行期文档不得把它们当「运行期读物」引用**——bundle 部署下技能体只有 `skills/lunheng-article-pipeline/**`，`docs/` 与 `examples/` **不在盘**（本机镜像实测两目录均不存在）。

**判据（改文档时照此办）**：运行期角色（T1-T9 / T0）读到的每一处引用，要么指向**技能目录内**的文件，要么**显式标注「仓库级 / 不随包」并同时给出运行期可用的那一条判据**——不许只给一个部署下取不到的路径。

**已知仓库级资源清单**（引用时必须带「仓库级 / 不随包」字样）：

| 仓库级路径 | 是什么 | 运行期替代 |
|---|---|---|
| `docs/token-optimization-plan.md` | token 量级实测分布表 | 「量级判断非承诺」——主控只报量级，不报承诺值 |
| `examples/preset/`（`preset.yml` + `README.md`） | 分档预设安装配方 | `LUNHENG_TIERING=on` 决定三档工具是否装载；派发时按角色选工具 |
| `docs/troubleshooting.md` §8 | 退出码语义表 | 各脚本**头注释**（真源）+ `repo-hygiene-check` 的 `EXIT_CONTRACT` |
| `docs/introduction.md` 等用户文档 | 人类入口 | 无需运行期替代（角色不读） |
| 根 `scripts/`（`repo-hygiene-check` / `plugin-surface-check` / `link-check` / `pack-smoke`） | 仓库门 | 运行期不调用；改动后由维护者跑 |

> ⚠️ 反面参照：**官方文档路径**（`docs/subsystems/*.md`、`docs/cookbook/*.md`、`references/official-docs/**`）**不属于本表**——属主是 `dsh-plugin-guide` 技能与 DSH 官方仓库，已由 `link-check` 的 `CROSS_SKILL_*` 前缀白名单登记，引用时写属主前缀即可。

## 六、CI `loader-smoke` 的上游缺陷（**v18.12.1 已修**，记录成因防复发）

- **现状**：`ci.yml` 的 `loader-smoke` **全绿**。此前**每次必红**（`publish.yml` 的 `gates` 不含它，故不影响发布，但仓面 CI 徽章一直红）。
- **成因（三步都验过）**：① 该 job 走的官方 `dsh-plugin-guide verify` 的 `pack / install / dump-config` **全过**，只倒在自己的 `headless-smoke`；② 错误是 `dsh: user patch-layer watching requires the Cordis HMR service`（栈顶 `dsh-app-boot/lib/index.js:1112`）——是 **DSH 启动失败**，与本包代码无关；③ 根因：`dsh plugin … add` 生成的 profile manifest 写 `"dsh": { "profile": { "patchReload": "live" } }`（`DEFAULT_PROFILE_PATCH_RELOAD = "live"`，注释「Custom profiles retain the historical live patch-file behavior」），而 `profile-boot` 在 `patchReload === "live"` 时调 `watchUserPatches()`，该函数拿不到 `ctx.get('hmr')` 就抛错 → headless 必红。本机用 `dsh plugin --profile smoke add @deepseek-ai/dsh-base` 复现了同一 manifest 形态。
- **修法（v18.12.0 采取的是 ③）**：把 `ci.yml` 里 pin 的 dsh 由 **0.1.5-rc.2 → 0.1.7-rc.2**。**逐版核对过 `@deepseek-ai/dsh-app-boot`**：0.1.5-rc.2 与 rc.3 都仍有 `DEFAULT_PROFILE_PATCH_RELOAD = "live"` 与那条 HMR 守卫；**0.1.7-rc.2 里两者都已不存在**，且内置 `headless` profile（`bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]` + `headless-runner`）。改后 CI 全绿（`loader-smoke in 50s ✓`）。
- **另两条处方（未采用，留给上游）**：① profile manifest 的 `dsh.profile.patchReload` 设 `"startup"`（需改 profile 生成侧，本包够不到）；② 上游把「`patchReload === "live"` 且无 HMR」改为降级而非抛错。
- **教训（判据级）**：本 job 红了**四个版本周期**而无人修，原因是「它在发布门之外」+「报错栈指向 dsh 自己」→ 容易被读成「环境问题，与我无关」。可行判据：**CI 里任何一个 job 长期必红，本身就是缺陷**——要么修到绿，要么删掉并在文档写明「为什么不跑这一层」；把红当常态会让真正的红失去信息量。

## 七、**收口批固定动作：差集 + 反向核验**（v18.15.0 定案，主人指示「固化为固定动作」）

> **v18.24.0（QLT-1）新增同族固定动作：质量回归基线**。**任何机制改动前后各跑一次**
> `node scripts/quality-score.mjs run/<项目> --report <tmp>.json`（golden 项目见
> [`case-studies.md`](case-studies.md#golden) §golden 项目），把 **score / coverage / 逐分量差异**写进当批反哺报告。
> **判据**：改动前后分数变化**必须可解释**（哪一分量动的、为什么）；「看不出来」即为不可解释。
> **它不是闸门**（分数高低不影响退出码）——挂成闸门会立刻产生「为过门而刷分」的压力。
> **与差集/反向核验的关系**：那两步查「修订项有没有落地」，这一步查「落地之后**质量有没有变化**」——前者是清单核对，后者是度量。

> **执行方式**：仓库级脚本 **closeout-verify**（位于仓库根 scripts 目录、不进技能目录、不随包——同 `assignee-normalization`；
> 维持**本节之前的「§五 仓库级资源与技能体的边界」**所定边界：它是**维护者能力**，运行期角色不读、也不该自动执行）。
> **时机**：每一轮「收口批」在**宣布修订完成之前**必跑；与 `consistency-check` / `repo-hygiene-check` 并列。

### 为什么必须机械化（三次实战教训，全在同一轮 v18.12.x 收口里踩出）

| # | 事件 | 哪一步抓到的 |
|---|---|---|
| ① | 18.12.2 交付时 agent 声称「三条定案都已落地」，实际 **11 个审计 ID 从未被任何记录提及**（`L-07/09/11/16/32/36/55/56/57/58/59`） | **差集**——逐条读记录会漏，因为漏掉的 ID 恰恰是**没有任何记录可读**的那些 |
| ② | 18.12.3 后把「差集为空」当完成证据；而记录里有一份**跨梯队累积的陈旧「仍未做」清单**（第四/六梯队登记，后续梯队早把 27 项做完却未回标） | **反向核验**——差集只能证明「被记录」，不能证明「被结清」 |
| ③ | 反向核验同时**推翻 5 处「记录说未做、实际早已落地」**（`L-27/28/41/60/61`）；v18.15.0 又由新门抓出 `L-43` **登记陈旧**（第六梯队说未修，实测当前形态已无此冲突） | 陈旧清单不只「漏报已修」，也会「误报未修」——**两个方向都得查** |

**判据一句话**：**差集查漏，反向核验查「记录陈旧」——两者缺一不可**。
只跑差集会得到「全部被记录」的假安心；只读记录会漏掉没有任何记录的那些。

### 两步的机械定义

| 步 | 判据 | 输出 |
|---|---|---|
| **第 1 步 差集** | 审计报告里出现的每个 `L-NN`，必须至少被**一处**修订记录 / `CHANGELOG.md` / `audits/README.md` 提及 | 从未提及的 ID 清单 → **P1** |
| **第 2 步 反向核验** | 某**梯队**记录里被登记为「未做 / 仍未做 / 有意未做 / 暂不 / 延后 / 保留代价 / 本次不修」的 ID，**其后梯队必须再提到它** | 陈旧登记清单（含登记于哪一梯队） → **P1** |

**两条自证后的实现细节**（都被真实数据反证过，改脚本时别退回去）：

1. **「未做」标记不是小节标题**：真实记录里是加粗行 `**仍未做（如实）**：`（后跟表或列表）。
   首版只认 `##` 标题 → 第四/六梯队的整块被**静默忽略**、对真仓报「0 项」——正是它要防的那种「门在此、却不生效」。
2. **只有带「第N梯队」序数的记录才构成「后续处理」证据**：专项记录（`L05裁定通道`、`反哺v1v2落地`）与
   后续的**版本段记录**（如 `…第九梯队` 之外的 `v18.13.0 收口`）必须**排除在先后判定之外**；
   首版把它们排成「最后」，于是任何 ID 只要在任意一份非梯队记录里出现过就被当成「已处理」——门同样失效。

### ⚠️ 边界如实声明（**不许把本门当完成证明**）

- **能判**：某 ID 完全无记录；某 ID 的「未做」登记其后无人回标。
- **不能判**：「被提到」是否等于「真做完」。**语义那半必须人工**——拿脚本输出的清单**逐条回代码/产物实测**
  （v18.13.0 正是这么做才发现 5 项其实已修、1 项真未修）。
- 因此脚本**只报「需人工回核」的项，绝不报「已完成」**；看到 `✓` 只代表**没有机械可见的漏项**，
  不代表修订已全部完成。把「提到」当「做完」正是 18.12.3 的错误。

## 九、软档登记：已判软的那些门，各靠什么收紧（v18.34.0）

> **为什么要有这一节**：「先软后硬」是本仓反复使用的过渡手法（不对历史形态过度收紧），但**软档如果没把触发条件挂在可观测事件上，就会永远软**——`A4c` 的软档自 v18.12.2 落地起至今未收，就是先例。本节把三个软档**集中登记**（此前散在三处注释里，谁也看不出全貌），每一行都必须回答**「靠什么事件收紧」**；答不出来的档 = 缺陷，不是过渡。
>
> **v18.33.0 起的手法（拆两半）**：先实测存量落在哪一档——
> ① **存量零落档 → 直接收紧**（收紧它不牵连任何历史交付）；② **存量全落档 → 触发条件写死进软提示文案**（可检索），并补上让触发条件**可达**的那块（通常是**模板**——把「新报告天然含该节」从「等下一次真实运行」变成「产物形状」）。

| 软档 | 位置 | 存量实测（2026-09-27 扫 `run/**`） | 现状 | 靠什么收紧 |
|---|---|---|---|---|
| **A8** 复核报告缺「已读范围」 | `handoff-check.mjs` A8 | **0/6**（门可见的命名口径） | **已半收**（v18.33.0）：「**有节但空**」判**硬**（21）；「完全缺节」仍软 | **触发条件已写死**：首次经 `templates/复核报告-template.md` 产出的报告通过本门后改硬（模板 v18.33.0 已补，条件**可达**） |
| **A4c ②** 审计报告缺 `被审正文:` 声明（两条分支：缺字段 / 指向文件不在盘） | `handoff-check.mjs` A4c | **22/22 都没该字段**（两条分支的存量全落在「缺字段」这一侧，「指向不在盘」**0 份**） | 仍软（v18.34.0 复测） | **触发条件已写死**：首次经 `templates/审计报告-template.md` 产出的报告通过本门后改硬（模板 v18.34.0 已补，条件**可达**）。**为什么这次没有「可直接收紧的那一档」**：两条分支的存量都不为零——与 A8 不同 |
| **M-Exist-5 / L-10** 两份闸门记录均未写 `handoff-check` 的 exit | `_lib/mgate-gates/mexist-gates.mjs`（`noteBits`，**可见但不改 pass**） | — | **仍为 noteBits** | **待主人裁定**：原文写明「『不写就红』的代价应由主人权衡后再定，此处先保证看得见」。这是三个档里**唯一**的「等判断」而非「等事件」——**不属于本节的自动化路径** |

**判据（新档照此登记）**：任何 `addSoft` / `noteBits` 的注释里出现「先做可见性 / 待收紧 / 先软后硬」字样时，**本表必须同时加一行**，且那一行必须能填出「靠什么收紧」——填不出事件或决策人的，视为未完成的设计。

## 八、开发参考资料：官方资料入口与机械层（v18.22.1 CTX-2 从 `AGENTS.md` 迁入）

> **为什么迁到这里**：`AGENTS.md` 是**技能目录内自动生效的指令**（每次加载都进上下文），而本节是**维护者决策时才查**的参考——运行期角色与主控都不需要它。按同一条判据（维护者向 → 本文件）整体外移，`AGENTS.md` 只留指针。

> **判据（主人 2026-09-11 指示）**：凡涉及**包形态、插件契约、服务/事件、工具注册、打包发布、官方文档规范**的改动，**先查官方资料再动手**——不得凭记忆、也不得凭本包既有写法推断（既有写法本身可能与官方漂移）。

**官方资料入口**（`dsh-plugin-guide` 技能；其包目录含 `guide/` + `references/official-docs/`）：

| 需要什么 | 查哪里 |
|---|---|
| 契约速查（插件骨架 / core ctx API / 事件分发模式 / 硬规则） | `guide/quick-reference.md` |
| 完整开发路径（新工具 / 新服务 / 拦截策略 / 打包发布） | `guide/plugin-dev-guide.md` |
| 官方文档全文（215 页，中英成对） | `references/official-docs/docs/**` |
| **skill 子系统契约**（frontmatter 键 / 本地发现 rank 表 / `resourceBase` / 目录只用 name+description） | `references/official-docs/docs/subsystems/skills.zh.md` |
| 打包与层顺序（bundle vs plain cordis、`dsh.bundle.patch`、覆盖语义） | `references/official-docs/docs/user/develop/basic/publish.zh.md` |
| 仓库约束 + **文档写作规范**（不用隐喻 / 不保留审查历史 / 一事实一处） | `references/official-docs/AGENTS.md` |
| 精确服务与事件签名 | `references/official-docs/docs/subsystems/*.md`（生成式 Cordis API 区） |
| 能力接缝（Service Definition / Provider / Consumer 三层） | `references/official-docs/docs/capability-seams.md` |

**机械层（官方 CLI，随知识库分发）**：
- `dsh-plugin-dev check` —— 14 项静态门（patch 合法性 / `package.json` 元数据 / 多语 README 一致性 / 工程红线）；**目标 0 fail / 0 warn**
- `dsh-plugin-dev verify` —— `pnpm pack` 后装入干净 `DSH_HOME` profile 做安装+启动+卸载冒烟
- `dsh-plugin-dev new <name>` —— 参数化脚手架（生成契约模板 / Schemastery Config / `cordis.patch.yml` / 五语 README）

**冲突裁决顺序**：① 官方 `references/official-docs/**`（官方仓库原文）→ ② 本包 `AGENTS.md` / `SKILL.md` → ③ 其他文档。**官方与本包冲突时以官方为准**，并按上表判断应改本包哪一处；改完跑双门。

**何时必须查官方资料**：改 `package.json` / `cordis.patch.yml` / `lib/**`；新增工具或服务；改 `SKILL.md` frontmatter；调整审计/门禁的**执行方式**（而非检查内容）；打包发布前。

**本包与官方的已知刻意偏离**：见 [`glossary.md`](glossary.md) **§十二**（自用术语 + 文档约定 + 偏离理由与代价）——改动前先读该节，避免把「刻意设计」当成疏漏改掉。

**仓库级打包面检查清单**（CI 的 `plugin-surface` job 承担，**v18.0.0 起无豁免**；本地复现见 `.github/workflows/ci.yml`）：`cordis.patch.yml` 合法性 / 行 id 唯一 / `dsh.bundle.patch` 指向 / `package.json` 元数据（`main` + `files` 含 `lib` + `packageManager`）/ 五语 README 一致性 / 工程红线。
> **两条静态门抓不到、必须由测试兜的**：① 包入口执行路径（`tests/entry.test.mjs` 真跑 `apply`）；② 「patch 必须插入本包自注册行」（`tests/bundle-contract.test.mjs`）——教训 #152 / #154。