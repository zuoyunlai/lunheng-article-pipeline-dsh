# Contributing / 维护指南

## 仓库定位

本仓库是「论衡」的 **DeepSeek Harness（dsh）独立 bundle 技能包**——技能本体位于 `skills/lunheng-article-pipeline/`，机制文档、脚本、示例与发布均在本仓库内独立维护，不依赖外部上游仓库。

## 版本号约定

**v17.0.0 起：版本号 = 纯语义化版本，迭代号进 major**——`<迭代号>.0.0`（本轮 `17.0.0` → 下一轮 `18.0.0`；同轮修补 `17.0.1`、小步改进 `17.1.0`）。DSH 版独立维护、独立版本线。

> **为什么不是 `dsh.17.0`**：npm 强制 semver，三段必须是数字；`dsh` 只能作 prerelease/build 后缀（实测 `npm publish` 对 `dsh.17.0` 直接 `Invalid version`）。
> **历史形态** `2.5.2-dsh.N`（截至 `2.5.2-dsh.17`）仍被一致性规则 ① 兼容识别（CHANGELOG 历史段与旧注解里都还有）。
> **版本头约定**：未发布期间写「（DSH 原生插件，尚未发布）」，发版时改「（DSH 原生插件，发布于 <日期>）」。
> **功能注解不追溯改写**：`（v2.5.2-dsh.17 补）` 记的是**当时**的版本号；本版起新注解用 `v17.0.0`。

## 升级流程（发布新版本时）

1. 在 `skills/lunheng-article-pipeline/` 下完成机制/角色卡/脚本的修改；
2. **同步版本号**：`package.json` 的 `version`、`SKILL.md`（frontmatter `version` + 首部版本行）、`cordis.patch.yml` 头、`README.md`/`docs/introduction.md` 版本头、`examples/preset/README.md` 的安装命令——**全部一致**（`consistency-check.mjs` 规则 ⑫⑬ 会全量扫描版本点位）；
3. **同一提交内更新 `CHANGELOG.md`**（写 `## X.Y.Z` 段，如 `## 17.0.0`）——规则 ⑪ 会机械校验「当前版本段存在」，bump 与 CHANGELOG 脱钩会直接红灯；
4. 本地跑**四道门**，全绿才提交：
   ```sh
   node skills/lunheng-article-pipeline/scripts/consistency-check.mjs
   node scripts/plugin-surface-check.mjs
   node scripts/repo-hygiene-check.mjs
   node --test "tests/**/*.test.mjs"
   ```
5. 提交并推送分支；
6. **发布 = 只推 tag**：`git tag v17.0.0 && git push origin v17.0.0`（tag 必须等于 `v` + `package.json.version`，publish 工作流会校验）
   - **发布前多跑一步打包产物验证**：`npm pack` 后解包，确认新增脚本/库随包且能从解包副本运行（教训：`_lib/` 重构后必须确认相对 `import` 未因 `files` 白名单而丢失）
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
