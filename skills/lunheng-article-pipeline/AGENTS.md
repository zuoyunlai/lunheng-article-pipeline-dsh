# AGENTS.md — 论文流水线操作手册

> **DSH 说明**：本手册为 DSH 原生手册。所用 DSH 工具：subagent / list_agents / send_message / web_search / web_fetch / todo_write / pwsh / edit / write 等；结构性差异见 `SKILL.md` 的「🔧 DSH 环境说明」章节。

## 启动时必读
1. `references/pipeline-readme.md` — 流水线运行手册（含复制即用的派发话术）
2. `references/glossary.md` — 核心概念词汇表（单一真源：角色/三层防御/数据信任/教训体系）
3. `references/glossary.md` **§十二 本技能自用术语与文档约定** — 承重墙/三角验证/M 门等术语的确切含义，以及与官方文档规范的刻意偏离说明（v18.0.0 新增）
4. `memory/YYYY-MM-DD.md` — 今日/昨日记录（如有）

> **包形态（v18.0.0 起）**：**包根**含 `package.json`（`main` → `lib/index.js` + `dsh.bundle.patch` → `cordis.patch.yml`）、`lib/index.js`（**入口**：读随包 `skills/lunheng-article-pipeline/SKILL.md`，经 `ctx.skills.register()` 注册为 agent 技能，`inject=['skills']` + `resourceBase` 指向技能目录，注册即 effect、卸载自动清理）、`cordis.patch.yml`（**① 插入本包自注册行** `- id: lunheng-article-pipeline / name: lunheng-article-pipeline`——loader 靠这一行按包名 import 入口，**删了它技能就不注册**（v18.0.0 缺陷，v18.0.1 修复）+ ② 3 档 subagent 工具）。两种部署均受支持：① `dsh plugin add` 装 bundle（技能由入口注册）；② 把 **`skills/lunheng-article-pipeline/` 技能目录**复制到任一 skill 根（项目级 `.dsh/skills/` rank 100 / 用户级 `$DSH_HOME/skills/` rank 400）。**包面自检**：`dsh-plugin-dev check`（14 项：11 通过 / 3 跳过——**v18.0.0 起无豁免**，目标 0 fail / 0 warn）+ `node --test "tests/**/*.test.mjs"`。

## 流水线协议（摘要，详见 references/pipeline-readme.md）

```
Phase 0 定题     → 与主人确认主题/类型/篇幅/引用格式 + cases 需求（含 0 条场景显式声明）+ 外部服务 4 选 1 同意 → 写 run/<项目>/01-任务简报.md
Phase 1 并行检索 → spawn T1 文献检索员 ∥ T2 数据检索员 ∥ T3 案例检索员（**任何量级必 spawn**，含 0 条场景空卡协议；subagent 三方真并行互不干涉，等完成通知）
[🔒 T2.5 完整性门] 数据条目≥简报数据需求 + 信任级别完整 → 通过才派 T4
Phase 2 分析     → spawn T4 分析员 → analysis/分析大纲.md
Phase 2.5 大纲确认 → 主人过目 → 三角验证 [L]+[D]+[C] 缺角补检索
Phase 3 写作     → spawn T5 写手 → drafts/初稿-v1.md
Phase 3.5 洞察补充 → 主人深度洞察补充（人在环）→ 写手 v2 融入
Phase 3.6 批判   → spawn T6 批判伙伴（C1-C7 反方攻击 v2，轻量档可跳）→ analysis/批判报告-vN.md
Phase 4 审计     → spawn T7 审计员 → audits/审计报告-vN.md（G0-G14 全项检查，v2.4.0 加 G14 中文 AI 痕迹闸，与 T6 并行）
                 → 打回修订 ≤2 轮（必须 spawn 独立写手）；仍不过 → 升级决策 / Acknowledged Limitations 模式
Phase 4.5 审稿   → spawn T9 同行评审（可选，默认选中，**学术论文必选**）→ audits/审稿报告-vN.md（6 维度评分 + 期刊匹配助手 Top 3）
[🔒 T7.5 完整性门] 审计报告最新版 + P0/P1 清单 + M 门全 exit 0 + 隔离 → 通过才终检
Phase 5 终检     → T8 终检（独立角色，主控 T0 以 T8 身份亲完成 M 门：M-Form 11 / M-Exist 10 / M-Integrity 2，LLM 兜底）→ final/定稿.md + 证据包/ + 交付说明.md
```

## 关键规则
- **派发话术**：直接从 `references/pipeline-readme.md` 复制，改项目名即可
- **每个项目一个目录**：`run/<项目名>/`，产物路径见任务简报
- **角色编号（v2.3.0 重构，v2.5.2 延续，v2.5.2-dsh.8 语义定案）**：**9 个独立角色 T1-T9 不可相互替代**——T1 文献 / T2 数据 / T3 案例 / T4 分析 / T5 写作 / T6 批判 / T7 审计 / **T8 终检（独立角色，主控 T0 亲执行）** / **T9 同行评审（可选默认选中，学术必选）**（编号 = 流水线 Phase 顺序）
- **模型分配（v2.5.2-dsh.17 重写：按角色能力自动匹配，不写死厂商默认）**：`subagent` 默认继承会话模型（**单模型配置零配置可用**）。要按角色分档时——**先跑 `node scripts/model-routing.mjs`**（只读脚本）探测本机 provider×模型并给出「档位→模型」建议，细则见 [`references/_shared/模型路由.md`](references/_shared/模型路由.md)：
  - **四档能力表（主人指定，v2.5.2-dsh.17；T9/G14 归属已确认）**：**检索** T1/T2/T3 = 便宜快（小参数 + 高 token/s；**默认本地 Ollama + 远程兜底**）→ `subagent_retrieval`；**分析写作** T4/T5 = 强推理（中大参数推理模型）→ `subagent_strong`；**批判审计** T6/T7/**T9**/**G14** = 顶配防漏判（顶级推理，**不得为省钱降档**）→ `subagent_audit`；**主控** T0 = 稳定路由（**不参与分档**，它就是会话模型，改的是 `agent-default-model`）；**终检** T8 = 主控亲执行，不适用。
  - **兜底链（宿主无模型级回退，故由主控执行）**：某档主选报错 → 换脚本给出的 `fallback`（检索档本地不可达时即远端便宜档）→ 仍失败 → `LUNHENG_TIERING=off` 全继承 → 再失败 → 标准 `subagent`；**每一级回退都要在进展页与交接报告如实记录**。
  - **配置方式**：`LUNHENG_*_MODEL`（+ 跨 provider 时同时给 `LUNHENG_*_PROVIDER`）——**字段独立**，只给 model 也能生效（provider 由宿主逐字段继承父级）；**不设任何变量 = 三档全继承**（安全默认）；`LUNHENG_TIERING=off` = 一键强制全部继承。
  - **禁止写死厂商默认值**：本机实测默认模型可能是任何 provider（例：`minimax-cn-openai`），宿主**无模型级回退**，写错模型 = 该档工具直接不可用。
  - **主控工作流**：Phase 0 跑一次脚本 → 把结论落 `run/<项目>/model-routing.md` → 派发时按表选档位；未启用分层时在进展页如实标注。
  - 已装分档工具时派发必须按角色选工具；未挂载时回退 `subagent`（任何模型配置都能跑）。
- **子代理产出必须交交接报告**：六要素缺一不可（做了什么/产物在哪/怎么验证/已知问题/下一步 + 状态更新），长时间无产出则主控用 `list_agents` 查看并介入
- **子代理失败三段式处理（v2.5.2-dsh.6 修订，教训：测试轮三检索员全失败 + T5 两次结算异常）**：① **落盘校验**——子代理 settle 后主控必跑 `read`/`ls` 检查关键产物是否存在+非空+结构完整，区分「写盘前失败」vs「写盘后失败」vs「任务完成」；② **产物完整 → `send_message` 续接原子代理**（DSH continuable，让它读已落盘产物确认后继续，**不是整任务重派**）；③ **产物缺失 → 才 spawn 新子代理重派**。**连续失败**：先查 DSH 环境（`list_agents` 看是否 `[ready]` 可续接；全失败可能 = DSH 进程状态问题，重启 dsh web 再试）。
- **status.md / agents-log.md 分文件写入约定（v2.5.2-dsh.5 修订，教训：T1/T2 与主控并发写冲突）**：**状态文件分两层**——① `status.md` 由**主控独占写**（纯状态机表，不允许子代理直接 edit）；② `agents-log.md`（v2.5.2-dsh.5 新增，项目根目录）由**子代理追加写**（每完成一个角色任务追加一段 `### Tn 执行记录` 节）。子代理的进度/完成状态通过「交接报告 + 产物落盘」回报，主控在收到交接报告后统一更新 status.md。**两文件分离目的**：避免子代理追加触发主控 edit status.md 报「file changed since it was read」（测试轮多次遇到的小摩擦）。冲突已发生时：主控先 re-read 再 edit。
- **执行约定（DSH 精简版）**：状态机 + 交接报告六要素 + G8 自检 + **进度播报三播报**（派发即播报 / 完成即转播 / 卡住即告警，防主人干等；无需心跳/分阶段 ack/预检/8 分钟硬卡；旧版完整韧化协议已移出仓库（历史见 git log），现行规则即本执行约定）
- **阶段闸门（v2.2.1，v2.3.0 改 T5.5→T7.5）**：T2.5（检索→分析）与 T7.5（审计→终检）两道主控 checkpoint，用 `todo_write` + `read` 实现，**不绕过交接直接派发**
- **闸门留机械证据（v2.5.2-dsh.13）**：两道闸门与 M 门**不得只凭自述**——交接报告须附**脚本 exit code + 产物路径**（`m-gate-check.mjs … --report <项目>/final/M-Gate-Report.json`）；exit 语义 `0` 通过 / `1` P1 / `2` P0 / `3` 仅 P2·soft·SKIP（需 LLM 复核，不得当通过）/ `10` 参数错误
- **机制文件写保护（v2.5.2-dsh.13；v18.0.0 补授权例外）**：`SKILL.md` / `AGENTS.md` / `references/**` / `scripts/**` / `cordis.patch.yml` 任何角色（含子代理）**默认禁写**；改进动议只写 `audits/反哺报告-vN.md`，由主人在 host shell 手工 apply（**agent 自主改机制文件 = P0 违规，本次交付作废**）。
  > **⚠️ 唯一例外：主人显式授权（v18.0.0）**：当**主人直接指令**要求修订机制文件时（如「你依次全部修订吧」），**不构成越权**——主人是机制文件的所有者，该指令即授权。此时仍须遵守：
  > ① **改前备份**（工作区外 `<DSH_HOME>/_backup/lunheng-<日期>/`，含 `scripts/` + `references/` + `SKILL.md` + `AGENTS.md` 全量）+ 记录行数基线；
  > ② **改中用 `edit` 精确匹配**（禁 `sed -i`）；
  > ③ **改后验证**（逐文件语法检查 `node -c`、重跑受影响脚本、必要时 `diff` 对比备份）；
  > ④ **全程可回滚**（备份保留；改动清单与回滚命令写入交付说明）；
  > ⑤ **如实标注**（在改动记录中写明「本次机制文件改动依据主人显式授权」，不掩盖默认约束的突破）。
  > **判据一句话**：**agent 自发改进 = 禁写（只出反哺报告）；主人明确下令 = 可写（走安全流程）**。
- **技能来源自检（v2.5.2-dsh.13）**：启动时核对 `SKILL.md` 版本头与期望版本一致，不一致即停机报「技能来源可疑」（同名技能会按 rank 就近静默顶替）
- **M 门（v2.2.0+）**：终检前必读 `references/_shared/M-Gate-Algorithm.md`（**仅 T7/T8 读**——T1-T5/T9 不读，因 M 门 23 项中 22 项已脚本化为 `scripts/m-gate-check.mjs`（M-Form 1-11 + M-Exist 1-10 + M-Integrity-1 佐证），LLM 只复核 M-Form-8 的承重墙质量与 M-Integrity-2 跨文件判断），按伪代码执行 M-Form/M-Exist/M-Integrity（M-Form 11 项含 M-Form-7 文末白名单 v2.3.5 + M-Form-8 三角验证 v2.3.7 + M-Form-9 图件闭环 v2.5.2-dsh.16 + M-Form-10 索引段完整性 / M-Form-11 素材按需加载闭环 v2.5.2-dsh.17），产出 `final/M-Gate-Report.json`，exit 0 才返回
- **图件链路（v2.5.2-dsh.16）**：写手只标 `[图N：标题]`（**独占一行**）→ 主控 Phase 4.5 用 `write` 手写 SVG 到 `final/图件/图N_标题.svg`（**唯一口径**）→ 导出 `md2html.mjs --fig-dir final/图件`（按图号配图，缺图显式标注）→ **M-Form-9** 对账（缺图/图位不足 → P0·P1；孤儿图件/图上数字无出处 → P2 提示）
- **G14 中文 AI 痕迹闸（v2.4.0+）**：Phase 4.5 与 T6 并行触发（LLM 推理判定，零 exec），8 类检测维度，0-2 类 Pass / 3-4 类 Warning 触发 T5 修订 1 轮 / 5+ 类 Fail 触发 2 轮；主人在 Phase 0 可显式关闭。闸门定义 `references/gates/14-中文AI痕迹-gate.md`，检测器 `references/checkers/中文AI痕迹-checker.md`
- **T9 同行评审 + 期刊匹配（v2.4.0+/v2.5.0，v2.5.2-dsh.8 定案：可选默认选中，学术论文必选）**：Phase 4.5 终稿前触发，6 维度评分 → accept/minor/major/reject；学术模式输出 Top 3 推荐期刊（`references/_shared/期刊数据库.md` + `期刊匹配算法.md`）
- **项目进展记入** `memory/YYYY-MM-DD.md` 和 `memory/projects.md`
- **注解聚合（v2.5.2-dsh 补丁，token 优化）**：新机制注解**不再逐层堆叠**（v2.1.8 新增/v2.2.1 新增/v2.3.0 改…），同主题合并为单行「v2.5.2-dsh 补丁，教训：…」格式；历史分层注解聚合到卡头一行，细节见 git log——防角色卡/文档随版本膨胀（实测单卡已 4-5 层历史注解）。

## 文件修改操作约束（v2.1.4 F5 补完，教训 #48）

论衡工作区所有修改走以下安全流程，**任何时候禁止 `sed -i`**（静默清空文件事故教训）：

1. **改前**：`wc -l <file>` 记录行数 + `cp <file> <备份目录>/<file>.bak` 备份（Windows 用 `$env:TEMP` 或工作区内备份目录）
2. **改中**：用 `edit` 工具（精确 oldText 匹配），**不用 sed/awk/perl 直接写回原文件**
3. **改后**：`wc -l` 对比 + `diff <file> <备份目录>/<file>.bak` 验证（不一致立即从 .bak 恢复）
4. **跨文件 sync**：用 `cp` 不带任何转换，直接覆盖（skill 副本同步是 `references/` 路径映射）
5. **改动位置（v18.0.1 新增，教训 #153）**：机制 / 角色卡 / 脚本 / 模板的改动**一律在真源仓库里做**（`<repo>/skills/lunheng-article-pipeline/`——那里才有 `tests/` 与两道仓库门），四道门全绿、提交之后**再同步到部署镜像**（项目技能根 `.dsh/skills/<name>/` 或用户技能根）。**不要反过来**：镜像不含 `tests/`，在镜像上改完再回流 = 跳过契约验证（实例：一处 `exit 10` 中止在镜像上自测通过、官方门全绿，合入仓库后 18 个用例红）。**判据：实现与测试同居的目录才是真源**。镜像里不得出现 `package.json` / `cordis.patch.yml` / `docs` / `examples` / `.git` / `lib` / 包级 README / `*.tgz`（`consistency-check` 规则⑨ 判 P1 污染）。
6. **验证**：本修改走完后必 `grep` 关键词 + 结构性 grep（如本手册的「## 交接报告」所有角色卡齐整性）；改论衡机制/文档后额外跑两条门（v18.0.0 起为双门）：
   - `node scripts/consistency-check.mjs` —— 文档一致性（21 类漂移，**exit 0 才提交**）
   - `dsh-plugin-dev check` —— 包面静态门（14 项：patch 合法性 / `package.json` 元数据 / 多语 README 一致性 / 工程红线；**目标 0 fail / 0 warn**）
   - `node --test "tests/**/*.test.mjs"` —— 随包脚本 + **组合包契约** + 入口回归（改脚本输出契约、`cordis.patch.yml`、`package.json` 时**必跑**）
   > **布局提示（v18.0.0）**：`consistency-check.mjs` 支持两种部署布局——**仓库布局**（`<repo>/package.json` + `<repo>/skills/<name>/`）与**技能即包根**（`<skillRoot>/package.json`，本机 `.dsh/skills/<name>/` 部署）；`REPO_ROOT` 自动探测，旧版硬编码「向上两级」会在本机布局下指向 `~/.dsh` 而 ENOENT。
   **仓库级打包面检查**（`cordis.patch.yml` 合法性 / 行 id 唯一 / `dsh.bundle.patch` 指向 / `package.json` 元数据（`main` + `files` 含 `lib` + `packageManager`）/ 五语 README 一致性 / 工程红线；**v18.0.0 起无豁免**，11 通过 / 3 跳过）由 CI 的 `plugin-surface` job 承担，本地复现命令见 `.github/workflows/ci.yml` 与 CHANGELOG 同名条目；**包入口的执行路径**由 `tests/entry.test.mjs` 用最小 ctx 真跑 `apply` 覆盖、**「patch 必须插入本包自注册行」由 `tests/bundle-contract.test.mjs` 覆盖**（静态门不执行入口、也不验 patch 是否引用本包，故这两条不可省——教训 #152 / #154）

## 开发参考资料（v18.0.0 新增，主人指示：官方资料为以后开发的重要参考）

> **判据（主人 2026-09-11 指示）**：凡涉及**包形态、插件契约、服务/事件、工具注册、打包发布、官方文档规范**的改动，**先查官方资料再动手**——不得凭记忆、也不得凭本包既有写法推断（既有写法本身可能与官方漂移）。

**官方资料入口**（`dsh-plugin-guide` 技能；其包目录含 `guide/` + `references/official-docs/`）：

| 需要什么 | 查哪里 |
|---|---|
| 契约速查（插件骨架 / core ctx API / 事件分发模式 / 硬规则） | `guide/quick-reference.md` |
| 完整开发路径（新工具 / 新服务 / 拦截策略 / 打包发布） | `guide/plugin-dev-guide.md` |
| 官方文档全文（215 页，中英成对） | `references/official-docs/docs/**` |
| **skill 子系统契约**（frontmatter 键 / 本地发现 rank 表 / `resourceBase` / 目录只用 name+description） | `references/official-docs/docs/subsystems/skills.zh.md` |
| 打包与层顺序（bundle vs plain cordis、`dsh.bundle.patch`、覆盖语义） | `references/official-docs/docs/user/develop/basic/publish.zh.md` |
| 仓库约束 + **文档写作规范**（不用隐喻 / 不保留审查历史 / 一事实一处） | `references/official-docs/AGENTS.md` |
| 精确服务与事件签名 | `references/official-docs/docs/subsystems/*.md`（生成式 Cordis API 区） |
| 能力接缝（Service Definition / Provider / Consumer 三层） | `references/official-docs/docs/capability-seams.md` |

**机械层（官方 CLI，随知识库分发）**：
- `dsh-plugin-dev check` —— 14 项静态门（patch 合法性 / `package.json` 元数据 / 多语 README 一致性 / 工程红线）；**目标 0 fail / 0 warn**
- `dsh-plugin-dev verify` —— `pnpm pack` 后装入干净 `DSH_HOME` profile 做安装+启动+卸载冒烟
- `dsh-plugin-dev new <name>` —— 参数化脚手架（生成契约模板 / Schemastery Config / `cordis.patch.yml` / 五语 README）

**冲突裁决顺序**：① 官方 `references/official-docs/**`（官方仓库原文）→ ② 本包 `AGENTS.md` / `SKILL.md` → ③ 其他文档。**官方与本包冲突时以官方为准**，并按上表判断应改本包哪一处；改完跑双门。

**何时必须查官方资料**：改 `package.json` / `cordis.patch.yml` / `lib/**`；新增工具或服务；改 `SKILL.md` frontmatter；调整审计/门禁的**执行方式**（而非检查内容）；打包发布前。

**本包与官方的已知刻意偏离**：见 [`references/glossary.md`](references/glossary.md) **§十二**（自用术语 + 文档约定 + 偏离理由与代价）——改动前先读该节，避免把「刻意设计」当成疏漏改掉。

## 记忆文件（运行时由主控在项目目录创建，非技能包内置）
- `memory/YYYY-MM-DD.md` — 每日日志（记结论不记过程）
- `memory/projects.md` — 各论文项目状态
- `MEMORY.md` — 长期约定（保持精简）
