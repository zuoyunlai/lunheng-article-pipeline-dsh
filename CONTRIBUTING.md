# Contributing / 维护指南

## 仓库定位

本仓库是「论衡」的 **DeepSeek Harness（dsh）独立 bundle 技能包**——技能本体位于 `skills/lunheng-article-pipeline/`，机制文档、脚本、示例与发布均在本仓库内独立维护，不依赖外部上游仓库。

## 版本号约定

**v17.0.0 起：版本号 = 纯语义化版本，迭代号进 major**——`<迭代号>.0.0`（本轮 `18.0.0`；同轮修补 `18.0.1`、小步改进 `18.1.0`）。DSH 版独立维护、独立版本线。

> **为什么不是 `dsh.17.0`**：npm 强制 semver，三段必须是数字；`dsh` 只能作 prerelease/build 后缀（实测 `npm publish` 对 `dsh.17.0` 直接 `Invalid version`）。
> **历史形态** `2.5.2-dsh.N`（截至 `2.5.2-dsh.17`）仍被一致性规则 ① 兼容识别（CHANGELOG 历史段与旧注解里都还有）。
> **未单独发布的迭代**：`17.0.0` 从未推到 npm/GitHub（它在本地历史中存在过）。其内容随 `18.0.0` 首发，并在 `CHANGELOG.md` 的 `## 17.0.0` 段注明。
> **版本头约定**：未发布期间写「（DSH 原生插件，尚未发布）」，发版时改「（DSH 原生插件，发布于 <日期>）」。
> **功能注解不追溯改写**：`（v17.0.0 修）` 这类注解记的是**当时**的版本号（注：`17.0.0` 的改动随 `18.0.0` 首发，但注解保留其原始迭代号）；本版起新注解用 `v18.0.0`。

## 升级流程（发布新版本时）

1. **在真源仓库**（不是部署镜像——见下节「开发位置」）的 `skills/lunheng-article-pipeline/` 下完成机制/角色卡/脚本的修改；改包面（`package.json` / `cordis.patch.yml` / `lib/**`）时**先查官方资料**（`dsh-plugin-guide` 技能），见 `skills/lunheng-article-pipeline/AGENTS.md` 的「开发参考资料」段；
2. **同步版本号**：`package.json` 的 `version`、`SKILL.md`（frontmatter `version` + 首部版本行）、`cordis.patch.yml` 头、根 `README.md`/`README.zh.md`/`README.es.md`/`README.pt.md`/`README.hi.md`、`SECURITY.md`、`docs/introduction.md` 版本头与「当前版本」、`docs/troubleshooting.md`、`skills/lunheng-article-pipeline/README.md`、`examples/preset/README.md` 的安装命令——**全部一致**（`consistency-check.mjs` 规则 ⑫⑬ 会全量扫描版本点位）；
3. **同一提交内更新 `CHANGELOG.md`**（写 `## X.Y.Z` 段，如 `## 18.0.0`）——规则 ⑪ 会机械校验「当前版本段存在」，bump 与 CHANGELOG 脱钩会直接红灯；
4. 本地跑**四道门**，全绿才提交：
   ```sh
   node skills/lunheng-article-pipeline/scripts/consistency-check.mjs
   node scripts/plugin-surface-check.mjs
   node scripts/repo-hygiene-check.mjs
   node --test "tests/**/*.test.mjs"
   ```
5. 提交并推送分支；
6. **发布 = 只推 tag**：`git tag v18.0.0 && git push origin v18.0.0`（tag 必须等于 `v` + `package.json.version`，publish 工作流会校验）
   - **发布前多跑一步打包产物验证**：`npm pack` 后解包，确认新增脚本/库/入口随包且能从解包副本运行（两条历史教训：`_lib/` 重构后必须确认相对 `import` 未因 `files` 白名单而丢失；入口移入 `lib/` 后必须确认 `apply` 真能读到 `SKILL.md`——后者现由 `tests/entry.test.mjs` 在 CI 里常驻防守）
   - ⚠️ **一次只能推 1 个 tag**：GitHub 对「单次 push 超过 3 个 tag」**不触发任何 workflow**（实测：一次推 4 个 tag → 0 个运行）；
   - ⚠️ **禁止本地 `npm publish`**（会绕过 CI 三道门与 OIDC provenance，且 npm 版本不可覆盖）；
   - tag 触发的 `publish.yml` 会依次跑门 1/2/3 + 回归测试 → tag/版本一致校验 → **幂等守卫**（该版本已发布则跳过）→ OIDC `npm publish --provenance --tag dsh` → **发布后审计**（`npm view <pkg>@<ver> gitHead` 必须等于本次提交）。

## 开发位置：改动一律落在真源仓库，再同步部署副本（v18.0.0 新增，教训 #153）

本包在开发机上**同时存在两份技能本体**，二者职责不同：

| 副本 | 路径 | 身份 |
|---|---|---|
| **真源仓库** | `<repo>/skills/lunheng-article-pipeline/` | **唯一可写源**——含 `tests/`、`scripts/plugin-surface-check.mjs`、`scripts/repo-hygiene-check.mjs`、CI 工作流，**四道门齐全** |
| **部署镜像** | 项目技能根（如 `<cwd>/.dsh/skills/lunheng-article-pipeline/`）或用户技能根（`$DSH_HOME/skills/…`） | **运行期加载副本**——被 rank 100 优先加载，故会话读的是它；**不是开发位置** |

**铁律**：机制 / 角色卡 / 脚本 / 模板的改动**在真源仓库里做**，四道门全绿、提交之后，再同步到镜像。**不要反过来**——在镜像上改完再往仓库回流。

**为什么（教训 #153 实例）**：发布前把「证据包缺卡」判为传参错误并 `exit 10` 中止（动机正当：误传 `analysis/` 曾产出 8 个假 P0）。在**镜像上**自测通过、`consistency-check` 0 漂移、官方 14 项门全绿，文档也照此写好；**合入仓库后 `node --test` 立刻红 18 个用例**——中止让下游 `parseJson` 拿到空输出，且与本包「缺卡记 N/A、0 条场景合法」的既有契约冲突。根因很简单：**镜像不含 `tests/`**，在它上面改动永远跑不到契约回归用例。

**判据一句话**：**实现与测试同居的目录才是真源**；镜像只是运行期副本，通过与否不能代表契约成立。

**同步命令**（Windows；`Copy-Item` 不带任何转换，保持字节一致）：

```powershell
$repo   = '<repo>\skills\lunheng-article-pipeline'
$mirror = '<cwd>\.dsh\skills\lunheng-article-pipeline'   # 或 $DSH_HOME\skills\lunheng-article-pipeline
Get-ChildItem $repo -Recurse -File -Force | ForEach-Object {
  $dst = Join-Path $mirror $_.FullName.Substring($repo.Length + 1)
  New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
  Copy-Item -LiteralPath $_.FullName -Destination $dst -Force
}
node <repo>\skills\lunheng-article-pipeline\scripts\consistency-check.mjs   # 规则⑨ 校验镜像 0 漂移
```

**镜像里不得出现的条目**（`consistency-check.mjs` 规则⑨ 判 P1 污染，且会与 `skills/` 内容产生版本歧义）：`package.json`、`cordis.patch.yml`、`docs/`、`examples/`、`.git`、`lib/`、包级 `README.*.md`（除技能自带 `README.md`）、`*.tgz`。**包形态文件只存在于仓库根**——镜像只是一份技能目录。

> 同步后若正在运行的会话没看到新内容：技能内容在会话加载时读取，一般热加载即可生效；未生效再重开会话，**不要**因此去改镜像（改了也会被下一次同步覆盖）。

## 已发布版本不可再改（v2.5.2-dsh.13 新增）

npm 版本**不可覆盖**：一旦某版本发布，仓库里**不得**再改动该版本相关的**语义内容**——`package.json` / `skills/**` / `CHANGELOG` 段（即「用户装到的东西」与「该版本的变更记录」）。任何修复都必须 bump 新版本重发（`18.0.1` / `18.1.0`）——历史教训：`2.5.2-dsh.12` 发布后仓库又改了 `engines.node`，导致「同版本号内容 ≠ 已发布产物」。

> **范围界定**：**仓库级维护文档**（`CONTRIBUTING.md` / `README.*.md` / `docs/**` / `SECURITY.md`）属**文档面**，允许在发布后更正（版本头「尚未发布 → 发布于 <日期>」就是这么定的）。但文档面更正**只准描述已发布的行为**，不得写入尚未发布的功能——否则同样制造「文档 ≠ 产物」。本节的「开发位置」条目即按此口径、在 `18.0.0` 发布后补入；**对应给 agent 的运行时条目在 `skills/lunheng-article-pipeline/AGENTS.md`，属 `skills/**` 冻结面，须等下一次 bump（`18.0.1`）才能写入**。

## 发布（维护者）

**发布 = 推 tag**，由 `.github/workflows/publish.yml` 以 **OIDC Trusted Publishing + `--provenance`** 完成：

```sh
git tag v18.0.0 && git push origin v18.0.0   # 工作流会校验 tag == v + package.json.version
```

> ⚠️ **不要在本机 `npm publish`**：会绕过 CI 三道门与来源证明，且 npm 版本**不可覆盖**（发错只能 bump 重发）。
> 历史（≤ `2.5.2-dsh.12`）留有「本地 `npm publish --tag dsh`」的记录，自 `2.5.2-dsh.13` 起改为 tag + OIDC。

## 验证

```sh
dsh --profile web --dump-config   # 应看到本包层 + 三档 tool-subagent-* 行
```

空目录 headless 验证（确认技能仅来自 bundle，排除本地技能根干扰）：

```sh
dsh --profile headless-lunheng-test "请调用 skill 工具列出你可见的技能名称"
```
