# 维护者手册（maintainers.md）

> 版本：v18.14.0｜**读者**：维护者/主人。**本文件不进任何运行期读清单**（角色/主控不读）；它承接 v18.8.0 文档瘦身从 SKILL.md 迁出的维护者向元信息（rank 考证 / guard 缺口 / 更正史）。改本文件不受「同一事实多处漂移」约束——运行期事实仍以 SKILL.md 为唯一真源，此处是背景与考证。

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

- 版本注解聚合政策：见 `AGENTS.md`「注解聚合」条；完整演进见 git log 与 `CHANGELOG.md`。
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
