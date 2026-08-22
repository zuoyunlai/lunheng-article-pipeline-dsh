# 论衡（lunheng-article-pipeline）— DSH bundle 插件

多 Agent 深度长文流水线技能包，**DeepSeek Harness（dsh）bundle 插件版**。

把一篇深度文章/论文的生产拆成 **8 张角色卡**（T0 主控 + T1-T3 检索 + T4 分析 + T5 写作 + T6 批判 + T7 审计，T8 终检 = 主控亲完成）：Phase 1 三检索员（T1 文献 ∥ T2 数据 ∥ T3 案例）**三方真并行、互不干涉**，T3 **任何量级必 spawn**（含 0 条场景空卡协议）；T6 批判伙伴从反方攻击论证；G0-G13 独立审计 + M 门机械化终检（M-Form 6+7 / M-Exist 3 / M-Integrity 2）。用 dsh `subagent` 子代理编排，产出有**证据底座、反方论证、独立审计、人工核验节点**的交付物。

> 版本：v2.3.7-dsh.4（DSH 适配版，对应正典 v2.3.7）。

## 安装（在目标机器上）

```sh
# 1) 装进 profile 的 node_modules
dsh plugin --profile web add lunheng-article-pipeline

# 2) 把 bundle 加入 profile 清单
#    $DSH_HOME/profiles/web/package.json
#    "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "lunheng-article-pipeline"] } }

# 3) 重启 dsh web
```

安装后技能自动出现在会话的 `skill` 工具目录，无需手动复制到技能根。

## 内容

- `skills/lunheng-article-pipeline/` — 技能本体（`SKILL.md` + `AGENTS.md` + `references/`：8 张角色卡 + 7 个模板 + `_shared/` 共享机制（M 门/F 模式/韧化协议）+ 运行手册 + 设计文档）
- `cordis.patch.yml` — bundle 补丁：注册指向包内 `skills/` 的 filesystem 技能提供者

## 按角色分模型（可选）

默认所有角色继承会话模型。若要**按角色指派不同模型**（检索用便宜快模型，分析/写作/批判/审计用强模型），用随包附带的「分档预设」：

| 工具 | 角色 | 默认模型 | 环境变量 |
|---|---|---|---|
| `subagent_retrieval` | T1 文献 / T2 数据 / T3 案例 | `deepseek-v4-flash` | `LUNHENG_RETRIEVAL_MODEL` |
| `subagent_strong` | T4 分析 / T5 写作 / T6 批判 | `deepseek-v4-pro` | `LUNHENG_STRONG_MODEL` |
| `subagent_audit` | T7 审计 | `deepseek-v4-pro` | `LUNHENG_AUDIT_MODEL` |

```sh
# 1) 复制预设到用户预设根
cp -r examples/preset "$DSH_HOME/.agent-presets/lunheng"

# 2) 新会话在预设选择器里选「论衡分档」

# 3) 换模型：设环境变量后重启 dsh（模型挂载期求值一次）
export LUNHENG_AUDIT_MODEL=claude-opus-5
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
- `docs/architecture.md` — 架构（8 角色 + 三角验证 + G0-G13 审计 + M 门）
- `docs/introduction.md` — 插件介绍
- `docs/faq.md` — 常见问题
- `CHANGELOG.md` — 版本历史
- `CONTRIBUTING.md` — 维护与同步指南

## 许可

MIT，见 `LICENSE`。
