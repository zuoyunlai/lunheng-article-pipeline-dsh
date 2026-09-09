# Contributing / 维护指南

## 仓库定位

本仓库是「论衡」的 **DeepSeek Harness（dsh）独立 bundle 技能包**——技能本体位于 `skills/lunheng-article-pipeline/`，机制文档、脚本、示例与发布均在本仓库内独立维护，不依赖外部上游仓库。

## 版本号约定

主版本沿用语义化版本基线 `2.5.2`，DSH 迭代以 `-dsh.N` 后缀递增——`-dsh.N` 标记第 N 次 DSH 迭代发布。

## 升级流程（发布新版本时）

1. 在 `skills/lunheng-article-pipeline/` 下完成机制/角色卡/脚本的修改；
2. 同步版本号：`package.json` 的 `version` 与 `SKILL.md`（frontmatter `version` + 首部版本行）必须一致；
3. 在技能包根运行一致性检查：`node scripts/consistency-check.mjs`，**exit 0 才可提交**；
4. 更新 `CHANGELOG.md`，记录本次迭代要点；
5. 提交并打 tag `vX.Y.Z-dsh.N`，推送仓库。

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
