# 安全策略（SECURITY）

> 版本：v18.2.6（DSH 原生插件，发布于 2026-09-13）

## 上报漏洞

发现安全问题时**请勿开公开 issue**。请通过以下任一私密渠道上报：

- GitHub **Private vulnerability reporting**（推荐）：<https://github.com/zuoyunlai/lunheng-article-pipeline-dsh/security/advisories/new>
  > **v18.2.4 复核（第三方审计 D.2）**：该开关此前**没开**——`GET /repos/…/private-vulnerability-reporting` 返回 `{"enabled":false}`，即本节旧文写的「仓库 → Security → Report a vulnerability」**当时是个死链**（公开仓库上尤其糟：报告者照文档走却找不到入口，只剩开公开 issue 一途）。现已开启并核验为 `{"enabled":true}`。
- 邮件：`zuoyunlai@outlook.com`（标题加 `[SECURITY] lunheng-article-pipeline`）

请在报告中给出：受影响版本（`package.json` 的 `version`）、复现步骤、影响面判断、以及你期望的披露时限。

## 信任边界（安装前请知悉）

本包是 **DSH bundle**：`package.json` 声明 `main`（`lib/index.js` 包入口）+ `dsh.bundle.patch`（→ `cordis.patch.yml`）。入口把 `skills` 服务作为**硬依赖**（写入 `inject`，缺则技能不注册），并在宿主提供对应服务时**可选**安装原生只读工具 / 全局机制写保护 / 人类命令（任一失败只降级）；patch 叠加 4 行（本包自注册行 + 3 档 subagent 工具行，**后者 v18.2.6 起默认不装载**——需显式设 `LUNHENG_*` 或 `LUNHENG_TIERING=on` 才挂载，见下方「加载期执行」）——但整包**并非「零可执行内容」**：

| 面 | 事实 |
|---|---|
| 入口代码 · 技能注册（`lib/index.js`） | 纯 ESM，**零第三方依赖**（不 import harness 任何模块，故 `@deepseek-ai/dsh` 是 optional peer）。`apply(ctx)` 读随包 `skills/lunheng-article-pipeline/SKILL.md`（唯一一次 `readFileSync`）、解析 frontmatter、经 `ctx.effect(() => ctx.skills.register(…))` 注册技能（卸载自动清理）。**该模块本身零外发 IO**：不派生子进程、不联网、不写文件。 |
| 入口代码 · 原生工具（`lib/tools.js`） | 注册两个**只读**工具 `lunheng_m_gate`（M 门机械预检）与 `lunheng_char_count`（纯汉字数）。**每次工具调用都派生一个子进程**跑随包脚本（`lib/tools.js:18,24,133,191`：`spawn(process.execPath, [<skillRoot>/scripts/<门脚本>.mjs, …])`）。收紧点：脚本路径由入口拼死、**不经 shell**（无 `shell:true`）、参数走数组 → 工具入参**不能**注入额外命令；子进程用的是**同一个 Node 二进制**；v18.2.6 起有超时与输出上限（`Config.scriptTimeoutMs` / `scriptMaxOutputBytes`）。**是否注册取决于宿主**：宿主无 `tools` 服务或 `@deepseek-ai/dsh-tools` 不可解析时，**只降级并打印一行提示，不报错**（`:63-73`，技能注册不受影响）。 |
| 入口代码 · 机制写保护（`lib/guard.js`） | 经官方 `ctx.tools.guard()` 安装**全局**工具守卫（`lib/guard.js:177`；profile 级 ctx → 官方语义「A plain-context guard applies globally」）。**作用域是该 profile 下的全部会话**（不止论衡自己的会话）：命中受保护根的 `write` / `edit` 类调用**在分发前即被否决**（返回理由 = 否决，后续监听器无法改回允许）。受保护根 = **当前生效的技能副本**（v18.2.6 起另含同名技能的 rank 100 / 200 / 400 / 500 落点）+ `lib/` + 仓库级 `scripts/` + `cordis.patch.yml`；**不含** `docs/`、README、CHANGELOG、`tests/`。**边界（如实，不夸大）**：① 只看**工具调用**——`pwsh` 与任何子进程写盘**不经此门**（官方对子进程的围栏是部署级沙箱，插件改不了别人的 profile）；② 只匹配常见写工具名（`write` / `edit` / `apply_patch` / `str_replace*` 等集合 + 参数键名与补丁文本里的路径，**宁松勿误伤**）；③ 相对路径按**会话工作区** `execution.agent.session.header.cwd`（与 fs 工具同源）与进程 cwd **两个基准同时判**（v18.2.6 修掉的基准错位绕过）；④ **主人授权例外**：宿主环境设 `LUNHENG_ALLOW_MECH_EDIT=1`，或在本插件行 `config` 写 `allowMechanismEdit: true`——授权是主人的动作，agent 不得自行声明；⑤ 纯技能目录部署（不经入口）下**不生效**——那里仍只有文档纪律。故本保护是「**比 prompt 强、比机制强制弱**」的部分强制。 |
| 入口代码 · 人类命令（`lib/commands.js`） | 注册人类命令 **`/lunheng-status`**（`ctx.commands.register()`；官方语义：命令 dispatch **不产生模型消息**）。handler **只读工作区文件**（`lib/commands.js:48-88`）：`<cwd>/run/<项目>/status.md` 与 `进展-主人版.md`，输出截断到 4000 字符。不写文件、不联网、不派生子进程。未给项目名时 `readdirSync(<cwd>/run)` 取 `status.md` 最近修改的项目，并把最多 12 个项目名回显到命令输出。 |
| 可调参数（`export const Config`，v18.2.6 起） | 入口导出 standard-schema 形态的 `Config`（**零宿主依赖**——刻意不 import `@deepseek-ai/schemastery`，见 `lib/index.js` 头注释）。四个开关：`allowMechanismEdit`（等价 `LUNHENG_ALLOW_MECH_EDIT=1`）、`quiet`（等价 `LUNHENG_QUIET=1`，只静音 info 级状态行，warn **永不**静音）、`scriptTimeoutMs`、`scriptMaxOutputBytes`。**非法配置在加载期响亮失败**（Cordis 抛 ValidationError），不会静默回落到默认值；`--dump-config` 可见。env 是**操作者开关**，Config 是**部署开关**（profile 补丁）。 |
| 加载期执行 | `cordis.patch.yml` 含 **6 处 `!!js` 表达式** = **3 处 `disabled:`（三段分档工具行的行级门控，读 `LUNHENG_TIERING` 与三档 `*_PROVIDER` / `*_MODEL`）** + **3 处 `agentOptions:`（各自读本档 `LUNHENG_<档>_PROVIDER` / `_MODEL`，未设则返回 `undefined`）**。计数口径：`^\s*[A-Za-z]+:\s*!!js` 的 YAML 值行（`Select-String cordis.patch.yml -Pattern '^\s*[A-Za-z]+:\s*!!js'` → 6 行）。它们由 DSH 宿主进程在**加载期以完整 Node 权限**求值（`disabled` 由 loader 的 `disabledOf()` 求值，`@deepseek-ai/cordis-plugin-loader/src/config/entry.ts:104-107`），**发生在 agent 沙箱与审批关卡之前**——安装本包即等于允许这些表达式在每次启动时执行。（v18.2.6 更正：旧版本节与 patch 注释只写「3 处」，**漏算 3 处 `disabled`**，等于把加载期执行面**少报一半**。）另：v18.2.6 起三段分档行改为「**默认不装载**」——未设任何 `LUNHENG_*` 时三行不挂载（不再每会话白付 3 份与内置 `subagent` 同义的工具 schema）。 |
| 允许的表达式内容 | 仅 `process.env.*` 与全局 `Object.assign`。（v18.0.0 起技能目录不再由 patch 求值挂载，故 `baseUrl` / `URL` / `decodeURIComponent` / `process.platform` 已不再需要——表达式面比 v17.0.0 **更窄**。） |
| 禁止的表达式内容（CI 红线，`consistency-check.mjs` 规则 ⑭） | `getBuiltinModule` / `child_process` / `require(` / `import(` / `eval(` / `new Function` / `node:` / `fs.` |
| 随包脚本 | 12 个 `.mjs`（**数量真源 = `SKILL.md` 的「随包脚本白名单」行**；v18.2.5 实测 `skills/lunheng-article-pipeline/scripts/*.mjs` 顶层 = 12）：**零第三方依赖**。网络面：**零外发**——唯一的网络调用是 `model-routing.mjs:124` 的 `fetch()`，且**只对回环地址** provider 的 `/models` 做可达性探测（仅当 provider 的 `baseURL` 命中 `127.0.0.1` / `localhost` / `[::1]`，3 秒超时、不读也不发任何密钥、结果只用于本地候选池，`--no-probe` 可整体关闭）；此外**没有任何出网请求**。子进程：唯一一处是 `final-check.mjs` 的 `spawnSync`（固定脚本路径 + 参数数组 + `shell:false`）。写文件：`normalize-trust-level.mjs` / `md2html.mjs` / `final-check.mjs` / `apply-diff.mjs` 均可写盘——技能已要求其目标路径限于项目目录，且 `normalize-trust-level` 默认 dry-run。 |
| 技能机制 | 技能会让 agent 读写工作区文件、派发子代理、并经外部检索服务外发检索关键词/目标 URL（Phase 0 有「4 选 1」明示同意关卡）。 |
| 已知边界 | 同名技能存在**按 rank 就近静默覆盖**的平台行为：项目根 `.dsh/skills/<同名>` 会顶替本包提供的技能副本（无告警）。技能已加入启动自检条款（核对版本头，不符即停机报告）。 |

## 发布完整性

- 发布走 **OIDC Trusted Publishing + `--provenance`**（`publish.yml`），由 tag 触发；**禁止本地 `npm publish`**。
- 发布前四道机械门 + 随包脚本回归测试，全部 fail-closed，且**跑在与发布身份隔离的独立 job 里**（`permissions: contents: read`，不持 `id-token: write`、不读 `NPM_TOKEN`）：① 一致性自检 ② 打包面检查 ③ 机械卫生门 ④ 打包产物冒烟（`npm pack` → 解包 → 入口 `apply` 真跑）＋ 随包脚本回归测试（含 windows / macos 矩阵）。`publish` job 以 `needs:` 依赖它，门失败即不发布。
- **幂等守卫**：目标版本已存在于 npm 时跳过发布。
- **发布后审计**：断言 `npm view <pkg>@<ver> gitHead` == 本次提交 SHA，且 `dist-tags.dsh` 指向该版本。
- 历史版本 `2.5.2-dsh.8`–`.12` 为**本地手工发布、无 provenance**（已在 `CHANGELOG.md` 记录）；自 `2.5.2-dsh.13` 起恢复 tag + OIDC 流程。
- **`NPM_TOKEN` 的用途与治理（v18.2.4 增补，第三方审计 G.1；v18.2.6 末已删除该 secret）**：发布本身走 OIDC、**不需要** token；该 secret 曾经**只**用于发布后 `npm dist-tag add … latest` 这一步——OIDC 覆盖的是 `npm publish`，而 `npm dist-tag` 仍需写鉴权（工作流注释已记实测：无 token 时该命令因无鉴权 exit 1；故工作流写成「无 token 只告警、不失败」）。
  > **治理要求**：① 用**细粒度 token**、只授本包写权限、设最短有效期；② 定期轮换；③ **一旦出现在聊天记录 / 日志 / 截图 / CI 输出中即视为已泄露**，立即 revoke 并重发；④ 该 token 永远不得打印（`publish.yml` 只经 `env:` 传递，不 `echo`）。
  > **当前状态（2026-09-19 记录）**：该 secret **已删除** —— 它在 v18.2.4 与 v18.2.6 两次发布时均已失效（实测 `E401`，见 `CHANGELOG.md` 对应段），使「核对 dist-tag」这一步在**发布成功后**仍把作业判红。删除后该步走「无 token」分支（仅 `::warning::`，作业绿）。
  > **运维后果（后来者须知）**：**每次发版后 `latest` 不再自动前移**（`dsh` 由 `npm publish --tag dsh` 自动指向新版本，不受影响）。发布后请在有凭据的机器上执行：`npm dist-tag add lunheng-article-pipeline@<版本> latest`（首次发布 18.2.6 时即按本仓发布日志中的同一条命令手工补打）。若要恢复自动化，重新签发细粒度 token 并按上面 ①–④ 治理，然后 `gh secret set NPM_TOKEN`。

## 支持的版本

仅**最新发布的版本**接受安全修复（`latest` / `dsh` dist-tag 指向的那一版）。
