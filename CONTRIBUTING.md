# Contributing / 维护指南

## 仓库定位

本仓库是「论衡」的 **DeepSeek Harness（dsh）独立 bundle 技能包**——技能本体位于 `skills/lunheng-article-pipeline/`，机制文档、脚本、示例与发布均在本仓库内独立维护，不依赖外部上游仓库。

## 版本号约定

**v17.0.0 起：版本号 = 纯语义化版本，迭代号进 major**——`<迭代号>.0.0`（本轮 `18.0.0`；同轮修补 `18.0.1` / `18.0.2`、小步改进 `18.1.0`）。DSH 版独立维护、独立版本线。

> **为什么不是 `dsh.17.0`**：npm 强制 semver，三段必须是数字；`dsh` 只能作 prerelease/build 后缀（实测 `npm publish` 对 `dsh.17.0` 直接 `Invalid version`）。
> **历史形态** `2.5.2-dsh.N`（截至 `2.5.2-dsh.17`）仍被一致性规则 ① 兼容识别（CHANGELOG 历史段与旧注解里都还有）。
> **未单独发布的迭代**：`17.0.0` 从未推到 npm/GitHub（它在本地历史中存在过）。其内容随 `18.0.0` 首发，并在 `CHANGELOG.md` 的 `## 17.0.0` 段注明。
> **版本头约定**：未发布期间写「（DSH 原生插件，尚未发布）」，发版时改「（DSH 原生插件，发布于 <日期>）」。
> **功能注解不追溯改写**：`（v17.0.0 修）` 这类注解记的是**当时**的版本号（注：`17.0.0` 的改动随 `18.0.0` 首发，但注解保留其原始迭代号）；本版起新注解用 `v18.0.0`。
> **✅ 已知漏点 A：内联 `git tag vX.Y.Z` 形态——已于 v18.2.4 终结**（v18.2.2 记录，v18.2.4 实施机检）。历史成因：版本扫描的其余规则各有明确锚点——①/⑦ 认 `> 版本：` 开头行、⑫ 认 `^\s*[-*>#]*\s*版本：`、⑧ 认 `cordis.patch.yml` 头与 `examples/` 的 `@x.y.z` **安装 pin**、⑬ 认 `docs/` 的安装 pin 与「当前版本」行——而它们**全都跑在技能目录内**（`files = walk(ROOT)`），**`git tag vX.Y.Z && git push origin vX.Y.Z` 这类内联示例却全在仓库根**（本文件 2 处 + 5 语 README 各 1 处）→ 四条规则全都扫不到。
> **代价（历史）**：每次 bump 靠人工记得刷——`v18.0.4` → `v18.2.1` 起连续五次靠人工（`v18.2.1` / `v18.2.2` / `v18.2.3` / `v18.2.4`）。
> **现状（v18.2.4）**：已在规则①/⑦ **同址**补扫（只认 `git tag` / `git push origin` 两种形态，判 P1；散文中的历史注记不误伤），并带对照实验与回归用例。**bump 时仍建议人工过一眼**——机检只保证「不一致就红」，不保证「该有的示例都在」。
> **✅ 已知漏点 B：加粗版版本头 `> **版本**：vX.Y.Z`——已于 v18.2.4 终结**。成因：规则⑫ 旧正则 `[-*>#]*\s*版本：` 在标记与 `版本：` 之间**不允许夹 `**`** → 该形态整条逃逸。**实测代价**：加固后首次运行即抓到 4 个文档**各带两个版本头**（首行 DSH 版 + 第 5 行残留的 `v2.5.1（2026-08-24）` 旧版本线头），因逃逸而从未被发现；修法为 `\*{0,2}` + 按「一事实一处」删去残留行。

## 升级流程（发布新版本时）

1. **在真源仓库**（不是部署镜像——见下节「开发位置」）的 `skills/lunheng-article-pipeline/` 下完成机制/角色卡/脚本的修改；改包面（`package.json` / `cordis.patch.yml` / `lib/**`）时**先查官方资料**（`dsh-plugin-guide` 技能），见 `skills/lunheng-article-pipeline/AGENTS.md` 的「开发参考资料」段；
2. **同步版本号**：`package.json` 的 `version`、`SKILL.md`（frontmatter `version` + 首部版本行）、`cordis.patch.yml` 头、根 `README.md`/`README.zh.md`/`README.es.md`/`README.pt.md`/`README.hi.md`、`SECURITY.md`、`docs/introduction.md`、`docs/troubleshooting.md`、`skills/lunheng-article-pipeline/README.md`、`examples/preset/README.md` 的安装命令——**全部一致**。
   > ⚠️ **但机检并不「全量扫描」（v18.2.6 如实更正；旧文写「规则 ⑫⑬ 会全量扫描版本点位」是夸大的）**：`consistency-check.mjs` 的版本点位规则 **⑫ 只覆盖 3 处**——根 `README.md`、`docs/introduction.md`、以及**技能级 README**（脚本内部登记名写作 `skills/README.md`，实际解析为 `skills/lunheng-article-pipeline/README.md`，见 `consistency-check.mjs:179-186`）；规则 ⑬ 另外认 `docs/` 下的**安装 pin** 与「当前版本」行；规则 ①/⑦ 认 `> 版本：` 行与内联 `git tag` 示例。**其余文件的版本头（`SECURITY.md`、`docs/troubleshooting.md`、`docs/*.md` 的版本行）目前靠人工同步**——2026-09 的第三方审计正是这样抓到 `SECURITY.md:3` 与 `docs/troubleshooting.md:3` 双双停在 v18.2.4 而 `package.json` 已是 18.2.5，同时 `consistency-check` 仍报「0 处漂移」（C-3「版本点位门是假覆盖」）。
   > **待办（未做，属规则所有者的改动）**：把版本点位门的覆盖面从「硬编码 3 文件」改为「根 `*.md` + `docs/**`（可执行 `*.md`）」，并补一条**负向用例**（注入旧版本头必须变红）。补丁点位见交付报告 §3 ③。
3. **同一提交内更新 `CHANGELOG.md`**（写 `## X.Y.Z` 段，如 `## 18.0.0`）——规则 ⑪ 会机械校验「当前版本段存在」，bump 与 CHANGELOG 脱钩会直接红灯；
4. 本地跑**四道门 + 回归测试**（v18.2.6 更正：旧文只列 4 条命令却把其中一条写成回归测试，实际是**门 1-4 + 测试**五条；门 4 = `pack-smoke`，此前两处清单都漏了它），全绿才提交：
   ```sh
   node skills/lunheng-article-pipeline/scripts/consistency-check.mjs   # 门 1/4 一致性自检
   STRICT_WARN=1 node scripts/plugin-surface-check.mjs                  # 门 2/4 打包面（warn 也阻塞）
   node scripts/repo-hygiene-check.mjs                                  # 门 3/4 机械卫生门
   node scripts/pack-smoke.mjs                                          # 门 4/4 打包产物冒烟（npm pack → 解包 → 入口 apply）
   node --test "tests/**/*.test.mjs" "skills/*/tests/**/*.test.mjs"      # 回归测试（**含子技能**；不是门，但发布链要求全绿）
   ```
   > **子技能测试为何要显式 glob**（v18.18.3，审计 D-1③）：`skills/lunheng-commands/tests/route.test.mjs`
   > （22 用例）此前**不在任何自动触发点**——根 `test` 脚本只 glob `tests/**`，CI 也 grep 不到它，
   > 只靠人手动跑。三处（`package.json` 的 `test` / `test:no-isolation` + CI 一处）已补 `skills/*/tests/**`。
   > **判据不是某个固定数字**（它会随新增用例变，写死必过期）——而是「子技能那 22 个用例必须出现在总计里」：
   > 只有根 glob 时总计不含它们；补上后总计至少 +22。
   > **受限会话（DSH `workspace-write` 沙箱）下的降级跑法**：门 2 需要从 registry/本地解析一个第三方 CLI、门 4 需要 `npm pack`，两者都**要派生子进程**——受限会话禁命名管道时它们 fail-closed 报错（`spawnSync … EPERM` / `→ 退出码 10（环境问题）`），这是环境限制而非本包缺陷。回归测试同理，但可用：
   > ```sh
   > npm run test:no-isolation      # = node --test --test-isolation=none "tests/**/*.test.mjs" "skills/*/tests/**/*.test.mjs"
   > ```
   > `--test-isolation=none` 让测试文件在**同一进程**内跑，是受限 DSH 会话里**唯一能跑通**的形态（`node --test` 默认模式由 runner 自己 spawn 子进程 → EPERM）。代价与边界（如实）：**隔离模式不覆盖跨进程行为**——CI 与发布链仍用标准隔离模式（`.github/workflows/*.yml`），两处结论不一致时**以 CI 为准**。另有三个用例按环境**带理由跳过**（工具内部 spawn / `npm pack` / `final-check` 子步骤），跳过会出现在 `ℹ skipped N` 里——**跳过 ≠ 通过**，不得据此宣称机检已过。
5. 提交并推送分支；
6. **发布 = 只推 tag**：`git tag v18.18.5 && git push origin v18.18.5`（tag 必须等于 `v` + `package.json.version`，publish 工作流会校验；**v18.2.1 更正：本行示例上一版停在 `v18.0.4`——bump 脚本的点位正则按行首锚定，扫不到这种内联形态，两次都漏了**；**v18.2.2 更正：第三处人工刷新**；**v18.2.3 更正：第四处人工刷新 —— 根因与终结方案见 §版本号约定 的「已知漏点」注**；**v18.2.4 起已机械化**：`consistency-check` 规则①/⑦ 同址补扫本形态，每次 bump 漏刷即 P1 变红）
   - **发布前多跑一步打包产物验证**：`npm pack` 后解包，确认新增脚本/库/入口随包且能从解包副本运行（两条历史教训：`_lib/` 重构后必须确认相对 `import` 未因 `files` 白名单而丢失；入口移入 `lib/` 后必须确认 `apply` 真能读到 `SKILL.md`——后者现由 `tests/entry.test.mjs` 在 CI 里常驻防守）
   - **发布面裁剪是机械门，不是自觉**（v18.2.0）：`repo-hygiene-check` 规则⑥ 与 `scripts/pack-smoke.mjs` 都带**负清单**——`CHANGELOG.md` / `CONTRIBUTING.md` / `scripts/` / `tests/` / `.github/` **不得随包**；把仓库向文件加回 `package.json` 的 `files` 白名单会**直接红**。另：npm **强制包含**根目录 `README*` 与 `LICENSE`（从 `files` 删掉、加 `.npmignore` 均**无效**，已实测），故五语 README 一定在包内——别把它当缺陷报。
   - ⚠️ **一次只能推 1 个 tag**：GitHub 对「单次 push 超过 3 个 tag」**不触发任何 workflow**（实测：一次推 4 个 tag → 0 个运行）；
   - ⚠️ **补推历史 tag = 乱序发布，会覆盖 `dsh` dist-tag（2026-09-22 实测教训）**：`npm publish --tag dsh` 每次把 `dsh` 指到当前发布版本。若在最新版**之后**补推旧 tag（如已推 v18.6.1、再补推 v18.5.1 / v18.6.0），每个旧 tag 的 publish 会依次把 `dsh` 覆盖回旧版，最终停在**最后完成的旧版**而非最新版。**补推后必须手工重设**：`npm dist-tag add lunheng-article-pipeline@<最新版> dsh`（`latest` 同理——它因 `NPM_TOKEN` 已删而从不自动前移，见 `publish.yml`「核对 dist-tag」步注释）；
   - ⚠️ **禁止本地 `npm publish`**（会绕过 CI 的四道门 + 回归测试与 OIDC provenance，且 npm 版本不可覆盖）；
   - tag 触发的 `publish.yml` 分**两个 job**（v18.2.6 起）：
     - **`gates`**（`permissions: contents: read`，**不持 `id-token`、不读 `NPM_TOKEN`**）：跑**门 1/4 一致性自检 → 门 2/4 打包面检查（`STRICT_WARN=1`）→ 门 3/4 机械卫生门 → 门 4/4 打包产物冒烟（`pack-smoke`）→ 随包脚本回归测试**；
     - **`publish`**（持 `id-token: write`，`needs: gates`）：**只有 gates 全绿才可能开始**；本 job 自己只做 tag/版本一致校验 → **幂等守卫**（该版本已发布则跳过）→ OIDC `npm publish --provenance --tag dsh` → dist-tag 核对 → **发布后审计**（`npm view <pkg>@<ver> gitHead` 必须等于本次提交）。
     > **为什么拆**（第三方审计「CLI 门的外部依赖被排除在供应链考虑之外」）：门 2 会**从 registry 现场下载并执行**第三方 CLI（`dsh-plugin-guide`）——把它放在**持有发布身份**的作业里，等于让一个下载来的二进制在 `id-token: write` 与 `NPM_TOKEN` 面前执行。拆开后，发布身份所在的作业**不再执行任何第三方 CLI**。

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
git tag v18.18.5 && git push origin v18.18.5   # 工作流会校验 tag == v + package.json.version
```

> ⚠️ **不要在本机 `npm publish`**：会绕过 CI 的**四道门 + 回归测试**与来源证明，且 npm 版本**不可覆盖**（发错只能 bump 重发）。
> 历史（≤ `2.5.2-dsh.12`）留有「本地 `npm publish --tag dsh`」的记录，自 `2.5.2-dsh.13` 起改为 tag + OIDC。

## 验证

```sh
dsh --profile web --dump-config   # 应看到本包层 + 4 段 insert 行（自注册行 + 三档 tool-subagent-*）
#   注意：`--dump-config` 只打印**声明行**——三档行默认不装载（v18.2.6），要确认装载需设
#   任一档 LUNHENG_*_PROVIDER/MODEL 或 LUNHENG_TIERING=on。
```

空目录 headless 验证（确认技能仅来自 bundle，排除本地技能根干扰）：

```sh
dsh --profile headless-lunheng-test "请调用 skill 工具列出你可见的技能名称"
```
