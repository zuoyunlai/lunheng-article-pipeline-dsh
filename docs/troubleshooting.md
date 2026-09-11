# 故障排查（troubleshooting）

> 版本：v2.5.2-dsh.16（DSH 原生插件）

安装/验证失败时按「症状 → 原因 → 处置」对照。**先跑本地三道门**：

```sh
node skills/lunheng-article-pipeline/scripts/consistency-check.mjs   # 仓库一致性
node scripts/plugin-surface-check.mjs                                # 打包面契约
node scripts/repo-hygiene-check.mjs                                  # 语法/行尾/UTF-8/发布包
```

---

## 1. `dsh plugin add` 报 `pnpm` 相关错误 / `ERR_PNPM_IGNORED_BUILDS`

- **原因**：`dsh plugin` 内部转 pnpm；新建 profile 的 `pnpm-workspace.yaml` 里 `allowBuilds` 五项是占位符字符串。
- **处置**：编辑 `<DSH_HOME>/profiles/<profile>/pnpm-workspace.yaml`，把
  `'@deepseek-ai/dsh-subprocess-local': set this to true or false` 之类的占位符改成 `true`，再重跑 add。
- **另注**：`pnpm` 必须在 PATH 里（`dsh plugin` 依赖它）。

## 2. `dshmarket` 显示「安装完成但校验失败 / 入口产物缺失」

- **原因**：dshmarket 的校验器只认 JS 入口（`main`/`exports`/`index.js`），而本包是纯 bundle（入口是 `dsh.bundle.patch`）。
- **处置**：忽略该误报。验证方式见下一条。

## 3. 装完看不到 `lunheng-article-pipeline` 技能

按顺序排：

1. **bundle 是否进了 profile**：`<DSH_HOME>/profiles/<profile>/package.json` 的 `dsh.profile.bundles` 应含 `lunheng-article-pipeline`（新版 `dsh plugin add` 会自动加）。
2. **patch 行是否组合进树**：
   ```sh
   dsh --profile <profile> --dump-config | Select-String 'skill-filesystem-lunheng|tool-subagent-(retrieval|strong|audit)'
   ```
   注意：`--dump-config` 会把 `!!js` 原样打印（不求值），所以这一步只证明「行进入了组合树」，**不证明技能挂载成功**。
3. **真验证**：开一个会话问「列出你可见的技能名称」——期望出现 `lunheng-article-pipeline`。
4. **同名覆盖**：检查当前工作目录下是否存在 `.dsh/skills/lunheng-article-pipeline/`（项目技能根 rank 100 **高于**本包的 custom root rank 300，会**静默顶替**）。删掉或改名该目录即可确认。
5. **路径解析**：本包用 `!!js` 把 `<profile>/node_modules/lunheng-article-pipeline/skills/` 绝对化（`baseUrl` 由宿主锚定在 profile 目录；该解析已于 2026-09-11 在真实 profile 上端到端实测通过，详见 `CHANGELOG.md` dsh.13 段「已知限制」）。若包被解析到共享回退目录（`<DSH_HOME>/profiles/node_modules`），该路径不存在，而技能文件系统 provider 对缺失根**只轮询不报错** → 技能静默消失。用 `dsh plugin --profile <profile> add <pkg>` 直装（而非手工拷贝）可避免。
6. **只想快速排除「是不是本地同名技能顶替」**：临时把 `<cwd>/.dsh/skills/lunheng-article-pipeline` 改名，重开会话再看技能是否出现。

## 4. `dsh-plugin-dev verify` 跑不通

- **症状 A**：`ERR_PNPM_IGNORED_BUILDS` → 见第 1 条。
- **症状 B**：报 `ENOENT .../dsh-pd-verify-XXXX/lunheng-article-pipeline-*.tgz` → 该工具复用真实 `DSH_HOME` 的 `compat` profile，里面钉着上一轮**已被清理的临时 tarball** 路径。处置：删掉 `<DSH_HOME>/profiles/compat/package.json` 与 `pnpm-lock.yaml` 后重跑。
- **症状 C**：安装步骤超时后 CLI 自身挂起不退出，且其 `dsh`/`pnpm` **孙进程会存活为孤儿**并锁住 `compat` 目录（导致目录删不掉）。处置：`Stop-Process` 掉命令行含 `--profile compat` 与 `dsh-pd-verify` 的进程，再删目录。
- 以上三条是 `dsh-plugin-dev` v0.3.7 的中止路径缺陷，已记录在 `CHANGELOG.md` 第 6 条。

## 5. Node 22.19 下 `npx dsh-plugin-guide` 报 `Cannot read properties of null (reading 'edgesOut')`

- **原因**：Node 22.19 自带 npm 10.9.3，无法安装声明了 **optional peerDependency** 的 `dsh-plugin-guide`（arborist 崩）。
- **处置**：用 `pnpm dlx dsh-plugin-guide@<ver> …` 替代 `npx`（本仓库的 `scripts/plugin-surface-check.mjs` 已自动优先 pnpm）。

## 6. 字数统计与报告对不上

- **正文区 vs 全文**：全流水线唯一口径是 **正文区纯汉字**（`## 摘要` 之后 ~ 文末节之前）。若定稿缺 `## 摘要`，`count-chars.mjs` 会输出 `degraded: true` 并在 stderr 告警——此时正文区起点退化为文件开头，**数字不可与目标区间直接比较**，应先补摘要。
- **一键终检**：`final-check.mjs` 已改为按正文区口径取数（旧版取全文）。

## 7. M 门报告/审计视图为空

- 报告真源是 `<项目>/final/M-Gate-Report.json`，由
  `node scripts/m-gate-check.mjs <项目>/final/定稿.md <项目>/final/证据包 --report <项目>/final/M-Gate-Report.json` 落盘。
- `build-evidence-bundle.mjs --summary` 会按该路径（兼容 `audits/` 旧路径）读取；找不到时会在审计视图里给出**可直接复制的命令**。

## 8. exit code 怎么看

| 码 | 含义 |
|---|---|
| 0 | 通过（M 门要求：无失败且无 SKIP） |
| 1 | 存在 P1 失败 |
| 2 | 存在 P0 失败 |
| 3 | 仅 P2 / LLM 兜底 / SKIP —— **需 LLM 复核，不得当作通过** |
| 10 | 参数/路径错误（不是内容问题） |

## 9. CI 绿灯但内容有问题

先确认三道门都跑了：`ci.yml` 的 `drift-check` / `plugin-surface` / `hygiene` / `script-tests`（后者含 **windows** 矩阵）。
若某类漂移仍漏检，请按 `consistency-check.mjs` 的既有规则样式补规则 + **对抗测试**（注入假漂移确认能抓到，再还原），见 `tests/scripts.test.mjs`。

## 10. 审计视图（`audits/审计视图-v0.md`）读不到 / 内容像草稿

- **读不到**（v2.5.2-dsh.15 起）：
  - Phase 2～4.5 时**尚无定稿**，视图源自动回退到 `drafts/` 中版本号最高的正文；连草稿都没有（Phase 1-2）时仍会生成「素材阶段视图」（只有卡数/信任分布/报告存在性）。**若一行都没有**，多半是没跑生成命令：`node scripts/build-evidence-bundle.mjs <项目> --summary`。
  - 旧版（≤ dsh.14）该脚本**写死 `final/定稿.md`**，定稿前直接跳过 → 升级到 dsh.15 后 T6/T7/T9 才真正读得到。
- **视图头写着「草稿快照」是正常的**：草稿阶段的字数/引用闭环只代表那一轮；**定稿阶段必须重新生成**（`--source final/定稿.md`）后才能当定稿口径引用。
- **源的版本 ≠ 被审版本**：显式 `--source <被审正文路径>` 重新生成后再派发，不要拿旧视图审新稿。
- **`--source` 指向不存在的文件**：脚本 exit **2** 并**不复制证据包**（fail fast，避免半成品目录）。

## 11. `token-cost.mjs` 参数报错 / 想看哪个角色最贵

- `--top N` 于 v2.5.2-dsh.15 **真正实现**（此前只有头注释与 CHANGELOG 提到，代码里是死变量 `topMode=false`）：输出 `topByCacheRead` 排名（cacheRead、单会话成本估算、占总量百分比）。
  ```sh
  node scripts/token-cost.mjs --sessions <主会话>,<子代理…> --top 5
  ```
- 未知参数与非法 `--top`（0/负数/非整数）现在一律 **exit 1** 并打印用法（旧版静默忽略，容易误以为生效）。

## 12. 检索「饱和」判定怎么落到交接报告

- T1/T2/T3 交接报告须含一行：`检索预算：已用 N 步 ｜ 饱和判定：<子主题>=饱和/未饱和`。
- 判据：**连续 2 轮检索（每轮 ≥3 次 query/URL）新增有效卡片 = 0** → 该子主题判饱和即停；首轮软预算 ≤40 步（Phase 1.5 补检索沿用 ≤30 步铁律）。
- 饱和**不等于**缺口：饱和段照实写「已检到饱和，未检索到 X」计入已知问题，**不得**补占位条目，也不得写成「已穷尽」。

## 13. 图件（`final/图件/`）与图表导出

- **唯一路径口径（v2.5.2-dsh.16 起）**：`final/图件/图N_标题.svg`（N 与正文 `[图N]` 对应；图位须**独占一行**）。旧文档里的 `final/图N-*.svg` 已废止——一致性规则 ⑱ 会拦截旧口径。
- **导出（多图）**：`node scripts/md2html.mjs <定稿.md> <out.html> --fig-dir final/图件`。**不要**用位置参数传单个 SVG——那会把同一份图嵌进每个 `[图N]`（脚本会告警，但导出结果仍是错的）；需要单图时才用它。
- **缺图**：图位没有对应 SVG 时，输出里是显式占位 `[图N]（期望文件：…/图N_标题.svg）`，不会静默留白。行内写的 `[图N：…]` 会被就地内联但**无图注**，脚本告警提示改为独占一行。
- **坏 SVG**：结构不合格（标签未闭合 / 无 `<svg>` 根 / 无 `viewBox` 且无宽高 / 含 DTD·ENTITY）→ `md2html.mjs` **exit 2 拒绝导出且不产出 HTML**（旧版原样嵌入、exit 0）。`<script>`/`on*`/`foreignObject`/`javascript:`/外部引用会被剥离并逐条告警；`--strict` 让任何告警都失败。判定真源 `scripts/_lib/svg.mjs`。
- **M 门 M-Form-9 图件闭环**（T7/T8 自动跑）：
  - 缺图（正文有图位、`final/图件/` 无文件）→ **P1**；**图件全缺或图位全缺 → P0**（exit 2，打回 Phase 4.5 补图）；图位数 < 任务简报「图位数量」→ 硬问题（呼应 T5 卡「必产 ≥ N 个图位」）。
  - 孤儿图件（图件未被正文引用）、图上数字在数据卡/正文找不到出处、SVG 安全告警 → **P2 提示**（数字对账是**启发式**，可能命中刻度/坐标，需人工确认）。
  - **未启用配图**（无图位且无 `final/图件/`）→ 记 **N/A 且通过**，不会因「没配图」把 M 门判失败（配图默认关闭）。
- **证据包与审计视图**：`final/图件/*.svg` 现在随证据包收进 `证据包/图件/`，审计视图有「图件对账」段（图位数/图件数/缺图/孤儿），T7/T8 不必逐文件翻图件。
