# 安全策略（SECURITY）

> 版本：v18.0.5（DSH 原生插件，发布于 2026-09-11）

## 上报漏洞

发现安全问题时**请勿开公开 issue**。请通过以下任一私密渠道上报：

- GitHub **Private vulnerability reporting**（仓库 → Security → Report a vulnerability）
- 邮件：`zuoyunlai@outlook.com`（标题加 `[SECURITY] lunheng-article-pipeline`）

请在报告中给出：受影响版本（`package.json` 的 `version`）、复现步骤、影响面判断、以及你期望的披露时限。

## 信任边界（安装前请知悉）

本包是 **DSH bundle**：`package.json` 声明 `main`（`lib/index.js` 包入口）+ `dsh.bundle.patch`（→ `cordis.patch.yml`）。入口只消费 `skills` 服务，patch 只叠加 3 档 subagent 工具——但整包**并非「零可执行内容」**：

| 面 | 事实 |
|---|---|
| 入口代码 | `lib/index.js`：纯 ESM，**零第三方依赖**（不 import harness 任何模块，故 `@deepseek-ai/dsh` 是 optional peer）。`apply(ctx)` 只做三件事：读随包 `skills/lunheng-article-pipeline/SKILL.md`、解析 frontmatter、经 `ctx.effect(() => ctx.skills.register(…))` 注册技能（卸载自动清理）。不派生子进程、不联网、不写文件。 |
| 加载期执行 | `cordis.patch.yml` 含 **3 处 `!!js` 表达式**（3 处分档 agentOptions，各自读取 `LUNHENG_*_PROVIDER/MODEL`；未设则返回 `undefined`）。它们由 DSH 宿主进程在**加载期以完整 Node 权限**求值，**发生在 agent 沙箱与审批关卡之前** —— 安装本包即等于允许这些表达式在每次启动时执行。 |
| 允许的表达式内容 | 仅 `process.env.*` 与全局 `Object.assign`。（v18.0.0 起技能目录不再由 patch 求值挂载，故 `baseUrl` / `URL` / `decodeURIComponent` / `process.platform` 已不再需要——表达式面比 v17.0.0 **更窄**。） |
| 禁止的表达式内容（CI 红线，`consistency-check.mjs` 规则 ⑭） | `getBuiltinModule` / `child_process` / `require(` / `import(` / `eval(` / `new Function` / `node:` / `fs.` |
| 随包脚本 | 11 个 `.mjs`：**零第三方依赖、零网络请求**；唯一子进程调用在 `final-check.mjs`（`spawnSync` 固定脚本路径 + 参数数组 + `shell:false`）。其中 `normalize-trust-level.mjs` / `md2html.mjs` / `final-check.mjs` 可写文件——技能已要求其目标路径限于项目目录，且默认 dry-run（`normalize-trust-level`）。 |
| 技能机制 | 技能会让 agent 读写工作区文件、派发子代理、并经外部检索服务外发检索关键词/目标 URL（Phase 0 有「4 选 1」明示同意关卡）。 |
| 已知边界 | 同名技能存在**按 rank 就近静默覆盖**的平台行为：项目根 `.dsh/skills/<同名>` 会顶替本包提供的技能副本（无告警）。技能已加入启动自检条款（核对版本头，不符即停机报告）。 |

## 发布完整性

- 发布走 **OIDC Trusted Publishing + `--provenance`**（`publish.yml`），由 tag 触发；**禁止本地 `npm publish`**。
- 发布前四道机械门 fail-closed：一致性自检 / 打包面检查 / 机械卫生门 / 脚本回归测试（含 windows 矩阵）。
- **幂等守卫**：目标版本已存在于 npm 时跳过发布。
- **发布后审计**：断言 `npm view <pkg>@<ver> gitHead` == 本次提交 SHA，且 `dist-tags.dsh` 指向该版本。
- 历史版本 `2.5.2-dsh.8`–`.12` 为**本地手工发布、无 provenance**（已在 `CHANGELOG.md` 记录）；自 `2.5.2-dsh.13` 起恢复 tag + OIDC 流程。

## 支持的版本

仅**最新发布的版本**接受安全修复（`latest` / `dsh` dist-tag 指向的那一版）。
