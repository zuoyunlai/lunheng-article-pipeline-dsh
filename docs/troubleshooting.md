# 故障排查（troubleshooting）

> 版本：v2.5.2-dsh.13（DSH 原生插件）

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
