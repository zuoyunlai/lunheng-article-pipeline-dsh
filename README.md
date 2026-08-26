# 论衡（lunheng-article-pipeline）— DSH bundle 插件

多 Agent 深度长文流水线技能包，**DeepSeek Harness（dsh）bundle 插件版**。

把一篇深度文章/论文的生产拆成 **9 张角色卡**（T0 主控 + T1-T3 检索 + T4 分析 + T5 写作 + T6 批判 + T7 审计 + T9 审稿，T8 终检 = 主控亲完成）：Phase 1 三检索员（T1 文献 ∥ T2 数据 ∥ T3 案例）**三方真并行、互不干涉**，T3 **任何量级必 spawn**（含 0 条场景空卡协议）；T6 批判伙伴从反方攻击论证；T9 同行评审 + 期刊匹配；G0-G14 独立审计（含 G14 中文 AI 痕迹闸）+ M 门机械化终检（M-Form 8 / M-Exist 3 / M-Integrity 2）。用 dsh `subagent` 子代理编排，产出有**证据底座、反方论证、独立审计、人工核验节点**的交付物。

> 版本：v2.5.2-dsh.4（DSH 适配版，对应正典 v2.5.2）。

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

## 按角色分模型（可选，通用化）

**单模型用户零配置**——默认所有角色继承会话模型，任何模型配置都能跑。配了多模型想**按角色能力分档**（检索便宜快 / 分析写作批判推理强 / 审计顶配）时，用随包附带的「分档预设」：

| 工具 | 角色 | 能力定位 | 默认 provider/model（可覆盖） |
|---|---|---|---|
| `subagent_retrieval` | T1 文献 / T2 数据 / T3 案例 | 便宜快 | 继承父会话（设 `LUNHENG_RETRIEVAL_*` 才分档） |
| `subagent_strong` | T4 分析 / T5 写作 / T6 批判 / T9 审稿 | 推理强 | 继承父会话（设 `LUNHENG_STRONG_*` 才分档） |
| `subagent_audit` | T7 审计 / G14 检测 | 顶配防漏判 | 继承父会话（设 `LUNHENG_AUDIT_*` 才分档） |

```sh
# 1) 复制预设到用户预设根
cp -r examples/preset "$DSH_HOME/.agent-presets/lunheng"

# 2) 新会话在预设选择器里选「论衡分档」

# 3) 换模型：设环境变量后重启 dsh（模型挂载期求值一次）
#    ⚠️ provider 与 model 分离：model 是裸 id，provider 必须单独指定
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

## 发布

```sh
npm login     # 首次需登录
npm publish   # 或 npm publish --access public
```

## 文档

- `docs/installation.md` — 安装与验证
- `docs/usage.md` — 使用流程（阶段 + 产物结构）
- `docs/architecture.md` — 架构（9 角色 + 三角验证 + G0-G14 审计 + M 门）
- `docs/introduction.md` — 插件介绍
- `docs/faq.md` — 常见问题
- `CHANGELOG.md` — 版本历史
- `CONTRIBUTING.md` — 维护与同步指南

## 许可

MIT，见 `LICENSE`。
