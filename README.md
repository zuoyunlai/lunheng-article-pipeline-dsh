# 论衡（lunheng-article-pipeline）— DSH bundle 插件

多 Agent 深度长文流水线技能包，**DeepSeek Harness（dsh）bundle 插件版**。

把一篇深度文章/论文的生产拆成 **7 个角色 + 5 个阶段**（Phase 1 为 T1 文献∥T2 数据∥T6 案例 三检索员**三方真并行、互不干涉**，T6 **任何量级必 spawn** 含 0 条场景空卡协议），用 dsh `subagent` 子代理编排，产出有**证据底座、反方论证、独立审计、人工核验节点**的交付物。

> 版本：v2.1.8-dsh.1（DSH 适配版，对应正典 v2.1.8）。

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

- `skills/lunheng-article-pipeline/` — 技能本体（`SKILL.md` + `AGENTS.md` + `SOUL.md` + `references/`：7 张角色卡 + 4 个模板 + 运行手册）
- `cordis.patch.yml` — bundle 补丁：注册指向包内 `skills/` 的 filesystem 技能提供者

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
- `docs/usage.md` — 使用流程（五阶段 + 产物结构）
- `docs/architecture.md` — 架构（7 角色 + 三角验证 + G0-G11 审计）
- `docs/introduction.md` — 插件介绍
- `docs/faq.md` — 常见问题
- `CHANGELOG.md` — 版本历史
- `CONTRIBUTING.md` — 维护与同步指南

## 许可

MIT，见 `LICENSE`。
