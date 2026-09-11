# Contributing / 维护指南

## 仓库定位

本仓库是「论衡」的 **DeepSeek Harness（dsh）独立 bundle 技能包**——技能本体位于 `skills/lunheng-article-pipeline/`，机制文档、脚本、示例与发布均在本仓库内独立维护，不依赖外部上游仓库。

## 版本号约定

主版本沿用语义化版本基线 `2.5.2`，DSH 迭代以 `-dsh.N` 后缀递增——`-dsh.N` 标记第 N 次 DSH 迭代发布。

## 升级流程（发布新版本时）

1. 在 `skills/lunheng-article-pipeline/` 下完成机制/角色卡/脚本的修改；
2. **同步版本号**：`package.json` 的 `version`、`SKILL.md`（frontmatter `version` + 首部版本行）、`cordis.patch.yml` 头、`README.md`/`docs/introduction.md` 版本头、`examples/preset/README.md` 的安装命令——**全部一致**（`consistency-check.mjs` 规则 ⑫⑬ 会全量扫描版本点位）；
3. **同一提交内更新 `CHANGELOG.md`**（写 `## vX.Y.Z-dsh.N` 段）——规则 ⑪ 会机械校验「当前版本段存在」，bump 与 CHANGELOG 脱钩会直接红灯；
4. 本地跑**四道门**，全绿才提交：
   ```sh
   node skills/lunheng-article-pipeline/scripts/consistency-check.mjs
   node scripts/plugin-surface-check.mjs
   node scripts/repo-hygiene-check.mjs
   node --test "tests/**/*.test.mjs"
   ```
5. 提交并推送分支；
6. **发布 = 只推 tag**：`git tag vX.Y.Z-dsh.N && git push origin vX.Y.Z-dsh.N`
   - ⚠️ **一次只能推 1 个 tag**：GitHub 对「单次 push 超过 3 个 tag」**不触发任何 workflow**（实测：一次推 4 个 tag → 0 个运行）；
   - ⚠️ **禁止本地 `npm publish`**（会绕过 CI 三道门与 OIDC provenance，且 npm 版本不可覆盖）；
   - tag 触发的 `publish.yml` 会依次跑门 1/2/3 + 回归测试 → tag/版本一致校验 → **幂等守卫**（该版本已发布则跳过）→ OIDC `npm publish --provenance --tag dsh` → **发布后审计**（`npm view <pkg>@<ver> gitHead` 必须等于本次提交）。

## 已发布版本不可再改（v2.5.2-dsh.13 新增）

npm 版本**不可覆盖**：一旦某版本发布，仓库里**不得**再改动该版本相关的语义内容（`package.json` / `skills/**` / `CHANGELOG` 段）。任何修复都必须 bump 新版本重发——历史教训：`2.5.2-dsh.12` 发布后仓库又改了 `engines.node`，导致「同版本号内容 ≠ 已发布产物」。

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
