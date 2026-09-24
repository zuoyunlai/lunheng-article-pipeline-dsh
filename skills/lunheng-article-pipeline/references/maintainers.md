# 维护者手册（maintainers.md）

> 版本：v18.9.0｜**读者**：维护者/主人。**本文件不进任何运行期读清单**（角色/主控不读）；它承接 v18.8.0 文档瘦身从 SKILL.md 迁出的维护者向元信息（rank 考证 / guard 缺口 / 更正史）。改本文件不受「同一事实多处漂移」约束——运行期事实仍以 SKILL.md 为唯一真源，此处是背景与考证。

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
