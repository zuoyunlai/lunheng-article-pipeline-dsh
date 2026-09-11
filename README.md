# 论衡（lunheng-article-pipeline）— DSH bundle 插件

> 🌐 **English**: [`README.en.md`](README.en.md) ｜ 中文（本文件）

多 Agent 深度长文流水线技能包，**DeepSeek Harness（dsh）bundle 插件版**。

把一篇深度文章/论文的生产拆成 **9 个独立角色 T1-T9（互不可替代）**（文献/数据/案例/分析/写作/批判/审计/终检/审稿；主控 = T0 调度 + T8 终检亲执行，T8 是独立角色不 spawn 子代理；T9 审稿可选默认选中、学术必选）：Phase 1 三检索员（T1 文献 ∥ T2 数据 ∥ T3 案例）**三方真并行、互不干涉**，T3 **任何量级必 spawn**（含 0 条场景空卡协议）；T6 批判伙伴从反方攻击论证；T9 同行评审 + 期刊匹配；G0-G14 独立审计（含 G14 中文 AI 痕迹闸）+ M 门机械化终检（M-Form 10 / M-Exist 3 / M-Integrity 2）。用 dsh `subagent` 子代理编排，产出有**证据底座、反方论证、独立审计、人工核验节点**的交付物。

> 版本：v2.5.2-dsh.16（DSH 原生插件）。

## 安装（在目标机器上）

```sh
# 1) 装进 profile（推荐）
dsh plugin --profile web add lunheng-article-pipeline
#    ✅ 新版 dsh（reconcilePlugins）会自动把声明了 dsh.bundle 的依赖加进
#       dsh.profile.bundles，无需手动编辑——装完重启 dsh web 即可

# 2) 仅当用纯 npm/pnpm 直接安装（不经 dsh plugin）或旧版 dsh 时，才需手动加 bundle：
#    $DSH_HOME/profiles/web/package.json
#    "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "lunheng-article-pipeline"] } }

# 3) 重启 dsh web
```

安装后技能自动出现在会话的 `skill` 工具目录，无需手动复制到技能根。

## 内容

- `skills/lunheng-article-pipeline/` — 技能本体（`SKILL.md` + `AGENTS.md` + `references/`：9 张角色卡 + 模板 + `_shared/` 共享机制（M 门/F 模式/韧化协议/期刊匹配/G14 闸）+ 运行手册 + 设计文档）
- `cordis.patch.yml` — bundle 补丁：注册指向包内 `skills/` 的 filesystem 技能提供者

## 数据图表（SVG，本地零外发）

写手只标 `[图N：标题]` **图位**（须独占一行）→ 主控 Phase 4.5 用 `write` 工具**手写 SVG** 到 `final/图件/图N_标题.svg`（唯一口径；**禁止文生图**——数字不可控）→ 导出 `node scripts/md2html.mjs <定稿.md> <out.html> --fig-dir final/图件` 或走 pandoc + rsvg-convert。

- **机械门**：M 门 **M-Form-9 图件闭环**（`scripts/m-gate-check.mjs` 自动跑）对账「正文图位 ↔ 图件文件 ↔ 图上数字」——缺图/图位不足 → P1·P0；孤儿图件、图上数字无出处、SVG 安全告警 → P2 提示；未启用配图记 N/A（不判失败）。
- **导出前置校验**：SVG 结构不合格（未闭合 / 无 `viewBox` / 含 DTD·ENTITY）→ 导出 **exit 2 拒绝**且不留半成品；`<script>`/`on*`/`javascript:`/外部引用被剥离并告警；缺图的图位输出显式占位（含期望文件名）。
- **可见性**：图件随证据包收进 `证据包/图件/`，审计视图有「图件对账」段——T7 审计 / T8 终检不必逐文件翻图。

## 按角色分模型（可选，通用化）

**单模型用户零配置**——默认所有角色继承会话模型，任何模型配置都能跑。配了多模型想**按角色能力分档**（检索便宜快 / 分析写作批判推理强 / 审计顶配）时，用随包附带的「分档预设」：

| 工具 | 角色 | 能力定位 | 默认 provider/model（可覆盖） |
|---|---|---|---|
| `subagent_retrieval` | T1 文献 / T2 数据 / T3 案例 | 便宜快 | 继承父会话（设 `LUNHENG_RETRIEVAL_*` 才分档） |
| `subagent_strong` | T4 分析 / T5 写作 / T6 批判 / T9 审稿 | 推理强 | 继承父会话（设 `LUNHENG_STRONG_*` 才分档） |
| `subagent_audit` | T7 审计 / G14 检测 | 顶配防漏判 | 继承父会话（设 `LUNHENG_AUDIT_*` 才分档） |

```sh
# 分档随 bundle 自动生效：安装本包即在 profile 里插入 3 档 subagent 工具
# （无需复制预设目录——examples/preset/ 只是分档说明，不含可加载的 agent.cordis.yml）

# 换模型：设环境变量后重启 dsh（模型挂载期求值一次）
#    ⚠️ provider 与 model 分离：model 是裸 id，provider 必须单独指定
#    ⚠️ 只设 MODEL 不设 PROVIDER → 该档静默继承会话模型（不报错）
export LUNHENG_AUDIT_PROVIDER=minimax
export LUNHENG_AUDIT_MODEL=MiniMax-M3
dsh web
```

不装预设也没关系——技能会回退到 `subagent`，所有角色继承会话模型。详见 `examples/preset/README.md` 与 `docs/installation.md`。

## 验证

```sh
dsh --profile web --dump-config   # 应能看到 skill-filesystem-lunheng 行
# 新开会话后，skill 工具目录应列出 lunheng-article-pipeline
```

## 前置要求

| 项 | 要求 |
|---|---|
| DSH | `dsh` CLI 可用（bundle 的 `- insert:` 增量 patch 需 DSH 5.5.0+） |
| Node | `^22.19.0 \|\| >=24.0.0`（DSH 运行时下限；见 `package.json` 的 `engines`） |
| pnpm | 安装/卸载依赖它（`dsh plugin` 内部转 pnpm） |
| 平台 | Windows / macOS / Linux（脚本零依赖，跨平台可跑） |

## 卸载

```sh
dsh plugin --profile <profile> remove lunheng-article-pipeline
```

卸载后 `cordis.patch.yml` 的 4 段 `- insert:` 一并消失——技能提供者与三档 subagent 工具同时移除，不留残余行。
若曾手工把技能目录拷到技能根（`.dsh/skills/` 或 `.agents/skills/`），需另行删除该目录。

## 数据流向与免责

- **外发**：检索关键词与目标 URL 会发往 DSH 配置的检索服务商（如 DeepSeek 官方 `web_search`）；Phase 0 有「4 选 1」明示同意关卡，拒绝任一外发项即调整方案重做 Phase 0。
- **不外发**：本地文件记忆（`memory/*.md`、`references/memory/lessons.md`）与所有随包脚本（零网络请求）；PDF/HTML 导出为本地步骤。
- **稿件**：项目名/主题/纲要可能含未公开信息——敏感题材请脱敏并选用 SVG 封面（本地生成），主人投喂的一手材料须已获知情同意。**主人是数据处理责任方**。
- **AI 披露**：流水线会在产物中输出 AI 使用声明（学术投稿另加「AI 使用声明」段），不隐瞒生成方式。
- **免责**：本软件以 MIT 许可「按现状」提供，不附带任何担保；产出内容的正确性、合规性与引用准确性由使用者负责。
- **安全**：安装前的信任边界（含加载期 `!!js` 求值）见 [`SECURITY.md`](SECURITY.md)。

## 发布（维护者）

> **只打 tag 发布，禁止本地 `npm publish`**（v2.5.2-dsh.13 起）。
> 本地直发会绕过 CI 的三道门与 OIDC 来源证明（provenance），且 npm 版本不可覆盖 —— 一旦发出无法补救。

```sh
git tag v2.5.2-dsh.N && git push origin v2.5.2-dsh.N   # 一次只推 1 个 tag（GitHub：单次 push >3 个 tag 不触发任何 workflow）
# 触发 publish.yml：门 1 一致性 → 门 2 打包面 → 门 3 机械卫生 → 脚本回归测试
#   → tag/版本一致校验 → 幂等守卫（已发布则跳过）→ OIDC 发布 --provenance --tag dsh → 发布后审计（gitHead/dist-tags）
```

发布前自检（本地同款三道门）：

```sh
node skills/lunheng-article-pipeline/scripts/consistency-check.mjs
node scripts/plugin-surface-check.mjs
node scripts/repo-hygiene-check.mjs
node --test "tests/**/*.test.mjs"
```

## 文档

- `docs/installation.md` — 安装与验证
- `docs/usage.md` — 使用流程（阶段 + 产物结构）
- `docs/architecture.md` — 架构（9 角色 + 三角验证 + G0-G14 审计 + M 门）
- `docs/introduction.md` — 插件介绍
- `docs/faq.md` — 常见问题
- `docs/troubleshooting.md` — 安装/验证故障排查（症状→原因→处置）
- `SECURITY.md` — 安全策略与信任边界
- `CHANGELOG.md` — 版本历史
- `CONTRIBUTING.md` — 维护与同步指南

## 许可

MIT，见 `LICENSE`。
