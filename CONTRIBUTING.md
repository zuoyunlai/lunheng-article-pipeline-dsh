# Contributing / 维护指南

## 仓库关系

本仓库是「论衡」的 **DeepSeek Harness（dsh）bundle 端口**。OpenClaw 原版在独立仓库维护：

- OpenClaw 原版（正典）：`github.com/zuoyunlai/lunheng-article-pipeline`
- DSH bundle（本仓库）：`github.com/zuoyunlai/lunheng-article-pipeline-dsh`

版本号约定：正典 `X.Y.Z` → DSH bundle `X.Y.Z-dsh.N`（`-dsh.N` 标记第 N 次 DSH 适配）。

## 升级流程

1. 更新 OpenClaw 原版（正典）并升版本；
2. 将正典的变更**翻译成 DSH 表述**合并进本仓库的 `skills/lunheng-article-pipeline/`：
   - `sessions_spawn` → `subagent`；`sessions_yield` → 等完成通知；`sessions_history/list` → `list_agents`
   - `tavily_search/extract` → `web_search`（`site:` 限定站点）
   - `update_plan` → `todo_write`；`image_generate` → SVG 矢量风 / 投喂
   - `exec`/`apply_patch` → `pwsh`/`bash` / `edit`；`pipeline/README.md` → `references/pipeline-readme.md`
   - 「五要素」→「六要素」；「G0-G10」→「G0-G11」
3. 同步 `package.json` / `SKILL.md` 的版本号；
4. `dsh --profile web --dump-config` 验证 bundle 行生效；
5. 提交并打 tag `vX.Y.Z-dsh.N`。

## 发布

```sh
npm login
npm publish --tag dsh
```

## 验证

```sh
dsh --profile web --dump-config   # 应看到 skill-filesystem-lunheng 行
```

空目录 headless 验证（确认技能仅来自 bundle，排除本地技能根干扰）：

```sh
dsh --profile headless-lunheng-test "请调用 skill 工具列出你可见的技能名称"
```
