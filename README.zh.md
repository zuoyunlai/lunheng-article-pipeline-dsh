# 论衡（lunheng-article-pipeline）— DSH bundle 多 Agent 深度长文流水线

> 🌐 [English](README.md) ｜ **中文**（本文件）｜ [Español](README.es.md) ｜ [Português](README.pt.md) ｜ [हिन्दी](README.hi.md)

> 版本：v18.2.1（DSH bundle：package.json + cordis.patch.yml + lib/index.js）

> 一个 DeepSeek Harness（DSH）bundle 插件，注册一个按需加载的 agent 技能。它把深度长文的生产——学术论文、行业分析、商业评论、公众号深文——变成**带人在环节点的 9 角色流水线**。

## What this is

论衡是流水线，不是文本生成器。它把一份深度长文拆成 **9 个独立角色 T1–T9（互不可替代）**，跨 6 个阶段，用 DSH `subagent` 编排，产出带**证据底座、反方论证、独立审计、人工核验节点**的交付物。

九角色：T1 文献检索员 / T2 数据检索员 / T3 案例检索员 / T4 分析员 / T5 写手 / T6 批判伙伴 / T7 审计员 / T8 终检（由主控亲执行，不 spawn）/ T9 同行评审。

## When to use it

- 需要 2000 字以上、经得起追问的深度长文，且可接受 1–3 小时流水线时长。
- 题材涉及事实、数据或多方观点，需要证据底座而非纯观点输出。
- 你希望保留人在环节点：写作前确认大纲，交付前过目终稿。

## When not to use it

论衡主动检索**已公开发表**的证据，并整合你投喂的材料。以下类型它无法自行产出——请先投喂素材，或换用别的工具：

- **一手数据采集**——实验、问卷、访谈、田野。
- **统计分析**——它能引用结论，但不跑 SPSS/R/Python。
- **原始图表数据采集**——它负责渲染数据图；抓取、OCR、语音转写需要专门工具。
- **原创图像或视频**——DSH 无内置文生图；封面回退到本地 SVG 或你提供的文件。
- **代码执行**——流水线只跑白名单脚本，其余需要你显式批准。

判据一句话：先问「证据是否**已公开**」。已公开 → 论衡能检索；未公开 → 先投喂。

## What you get

| 产物 | 内容 |
|---|---|
| 文献卡 `[Lxx]` | 已发表来源 + A/B/C 可信度分级 + 先行者清单（用于原创性核对） |
| 数据卡 `[Dxx]` | 数字 + 来源/年份/时效分级/信任级别；冲突数字并列呈现 |
| 案例卡 `[Cxx]` | 事件结构（谁/何时/何事/各方说法），或显式 `[C-空]` 空卡标记 |
| 分析大纲 | 论点线索、论点-论据映射、反方论证计划、承重证据清单 |
| 初稿 | 逐版递进，含中文 AI 痕迹清理，每轮由独立写手执行 |
| 审阅报告 | 批判报告（C1–C7）、审计报告（G0–G14）、审稿报告（6 维度 + 期刊匹配）、AI 痕迹报告 |
| 终交付 | `final/定稿.md`、图件、证据包、交付说明、M 门报告 |

## Pipeline overview

```text
Phase 0  定题      确认主题/篇幅/引用格式 + 外部服务同意
Phase 1  并行检索  T1 文献 ∥ T2 数据 ∥ T3 案例（真并行、互不干涉）
闸门 T2.5          数据条目 ≥ 简报要求；信任级别完整
Phase 2  分析      T4 分析员 → 分析大纲
Phase 2.5 大纲确认 主人过目（人在环）
Phase 3  写作      T5 写手 → 初稿 v1
Phase 3.5 洞察补充 主人补充一手语境（人在环）→ 初稿 v2
Phase 3.6 批判     T6 批判伙伴 → C1–C7 报告
Phase 4  审计      T7 审计员 → G0–G14 审计报告 + 修订任务书
Phase 4.2 修订     写手修订 + 修订说明（≤2 轮，独立写手）
Phase 4.5 审稿     T9 同行评审 + G14 中文 AI 痕迹闸（并行）；配图
闸门 T7.5          最新审计 + P0/P1 清单 + M 门 exit 0 + 报告隔离
Phase 5  终检      T8 终检（主控执行）→ 定稿、证据包、交付说明
```

**三角证据底座**（`[L]` + `[D]` + `[C]`）——每条论断都要能映射到文献、数据与（事件类论断）案例证据。**独立审计**——审计员不改稿，只报告。**四道人在环节点**——Phase 0 / 2.5 / 3.5 / 5。

## Repository layout

```text
lunheng-article-pipeline/                 # 包即仓库
├── package.json              # 声明 main（lib/index.js）+ dsh.bundle.patch
├── cordis.patch.yml          # bundle 层：叠加 3 档 subagent 工具
├── lib/index.js              # 插件入口：通过 ctx.skills 注册技能
├── skills/lunheng-article-pipeline/       # 技能本体（一个目录）
│   ├── SKILL.md              # 技能入口（角色 / 闸门 / 执行能力边界）
│   ├── AGENTS.md             # 操作手册
│   ├── QUICKSTART.md         # 5 分钟快速开始
│   ├── README.md             # 技能级说明（中文）
│   ├── references/           # 9 张角色卡、模板、共享闸门算法、期刊数据库
│   └── scripts/              # 11 个零依赖 .mjs 机械校验脚本
├── scripts/                  # 仓库门：打包面 + 机械卫生
├── tests/                    # node --test 回归（脚本 + 插件入口冒烟）
├── docs/                     # 安装 / 使用 / 架构 / FAQ / 排障
├── examples/preset/          # 分档说明与安装指南
├── README.md                 # 英文源版
├── README.zh.md README.es.md README.pt.md README.hi.md
├── SECURITY.md CHANGELOG.md CONTRIBUTING.md LICENSE
```

插件入口把 `skills/lunheng-article-pipeline/SKILL.md` 注册为技能，其 `resourceBase` 指向该目录——因此 `references/**` 与 `scripts/**` 的相对引用在任意工作目录下都能解析。

patch 层做两件事：**插入一行本包自注册行**（`- id: lunheng-article-pipeline` / `name: lunheng-article-pipeline`）——loader 靠这一行按包名 import `lib/index.js`，技能才注册得上——以及插入三档分档 subagent 工具。**这一行是承重的**：缺了它入口永远不会被 import、技能不会出现（v18.0.0 的缺陷，18.0.1 修复；由 `tests/bundle-contract.test.mjs` 机械防守）。

### Documentation

| 文件 | 内容 |
|---|---|
| `docs/installation.md` | 安装与验证 |
| `docs/usage.md` | 使用流程（阶段 + 产物结构） |
| `docs/architecture.md` | 架构（9 角色 + 三角验证 + G0–G14 审计 + M 门） |
| `docs/introduction.md` | 插件介绍 |
| `docs/faq.md` | 常见问题 |
| `docs/troubleshooting.md` | 安装/验证故障排查（症状 → 原因 → 处置） |
| `SECURITY.md` | 安全策略与信任边界 |
| `CHANGELOG.md` | 版本历史 |
| `CONTRIBUTING.md` | 维护与发布指南 |

### Publishing (maintainers)

**只推 tag 发布，禁止本地 `npm publish`**（本地直发会绕过 CI 三道门与 OIDC 来源证明，且 npm 版本不可覆盖）。

```sh
git tag v18.2.1 && git push origin v18.2.1   # 一次只推 1 个 tag（GitHub：单次 push >3 个 tag 不触发任何 workflow）
# publish.yml 依次跑：门 1 一致性 → 门 2 打包面 → 门 3 机械卫生 → 门 4 打包产物冒烟 → 脚本回归测试
#   → tag/版本一致校验 → 幂等守卫 → OIDC 发布 --provenance --tag dsh → 发布后审计
```

## Install

**方式一：作为 bundle 安装**（推荐；入口注册技能，patch 层激活分档工具）

```sh
dsh plugin --profile web add lunheng-article-pipeline
dsh --profile web --dump-config   # 应出现 "# == lunheng-article-pipeline" 层
```

新版 dsh 看到 `dsh.bundle` 声明后会自动把依赖加进 `dsh.profile.bundles`——装完重启 `dsh web` 即可。仅当用纯 npm/pnpm 安装或旧版 dsh 时，才需手工在 profile 的 `package.json` 里加 `dsh.profile.bundles` 条目。

**方式二：作为纯技能目录**（免安装，热加载）

```sh
# 复制**技能目录**（不是仓库根）到任一 DSH 技能根：
#   $DSH_HOME/skills/lunheng-article-pipeline        （用户级，rank 400）
#   <项目>/.dsh/skills/lunheng-article-pipeline      （项目级，rank 100）
```

纯目录不含 `dsh.bundle` 声明，因此 `dsh plugin add` 只会把它当普通依赖安装、**不激活任何层**——复制技能目录才是受支持的路径。

### Requirements

| 项 | 要求 |
|---|---|
| DSH | `dsh` CLI 可用；bundle 的 `- insert:` 增量 patch 行需 DSH 5.5.0+ |
| Node | `^22.19.0 \|\| >=24.0.0`（DSH 运行时下限；见 `package.json` 的 `engines`） |
| pnpm | 安装/卸载依赖它（`dsh plugin` 内部转 pnpm） |
| 平台 | Windows / macOS / Linux（脚本零依赖，跨平台可跑） |

### Uninstall

```sh
dsh plugin --profile <profile> remove lunheng-article-pipeline
```

卸载后 `cordis.patch.yml` 的 3 段 `- insert:` 与入口注册的技能一并消失，不留残余行。若曾手工把技能目录拷到技能根（`.dsh/skills/` 或 `.agents/skills/`），需另行删除该目录。

## Model routing

DSH 通过 `settings.yaml` 路由模型；`subagent` 继承会话模型，因此**单模型零配置**即可跑。要按角色分档时，bundle 会装入三档工具：

| 工具 | 角色 | 能力定位 |
|---|---|---|
| `subagent_retrieval` | T1 文献 / T2 数据 / T3 案例 | 便宜快 |
| `subagent_strong` | T4 分析 / T5 写作 | 推理强 |
| `subagent_audit` | T6 批判 / T7 审计 / T9 审稿 / G14 检测 | 顶配防漏判 |

用 `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_PROVIDER` 与 `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_MODEL` 覆盖：provider 与 model 是**独立字段**，跨 provider 时才需同时给；`LUNHENG_TIERING=off` 一键让三档全部退回继承。某档工具未挂载时，派发自动回退 `subagent`。详见 `examples/preset/README.md` 与 `docs/installation.md`。

## Data and external services

流水线会向第三方发送：

| 操作 | 发送内容 | 接收方 |
|---|---|---|
| `web_search` / `web_fetch` | 检索关键词、目标 URL | DSH 配置的检索/抓取服务商 |
| 模型推理 | 文献卡/数据卡/案例卡、大纲、初稿 | 当前模型 provider |
| 文生图（可选，默认关闭） | 主题与品牌描述 | 图像 MCP，仅在你启用并配置时 |

主控必须在 Phase 0 披露并取得明示同意。敏感题材：措辞脱敏、封面改用本地 SVG（零外发）、选用本地模型端点。拒绝任一项即回到 Phase 0 调整方案。

## Verification status

| 文章 | 规模 | 关键结果 |
|---|---|---|
| 品牌一致性文章（2026-08） | 约 7900 字，15 条文献 + 54 条数据 | 证据包齐备；8 项审计问题全部关闭 |
| 原创性悖论文章（2026-08） | 约 9500 字，12 文献 + 34 数据 + 6 案例 | 4 轮修订，A- 评级，已发表 |
| 教师场域隔离论文（2026-08） | 约 12000 字，18 文献 + 47 数据 + 9 案例 | 审计第 2 轮通过；首次一致性审计 |
| 生成式 AI 学生写作评论（2026-08） | 约 2000 字，12 文献 + 26 数据 | 三方并行检索；M 门 exit 0 |
| 甲醛白菜文章（2026-08） | 约 4200 字，12 文献 + 29 数据 + 4 案例 | M 门 exit 0；并入 6 条反哺规则 |
| 观念与理念哲学论文（2026-09） | 约 6280 字，18 文献 + 15 数据，0 案例 | 2 轮审计，23/30 minor revision，M 门真 P0 = 0 |

本地四道门：`node skills/lunheng-article-pipeline/scripts/consistency-check.mjs`、`node scripts/plugin-surface-check.mjs`、`node scripts/repo-hygiene-check.mjs`、`node --test "tests/**/*.test.mjs"`。

## Known limitations

- **中文优先。** 角色提示词、交付物、文件名与流程默认中文。
- **默认不做网络核验。** 数字级出处核对常停留在「待人工复核」，因为付费墙与线下来源取不到。
- **审计独立性有成本。** 一次完整运行会派 15+ 个子代理；大部分 token 花在上下文读取而非生成。
- **M 门可能假阳性。** 脚本会误判合法写法；T8 必须记录 `script_exit_raw` 并说明 `exit` 裁定理由，而不是改稿去凑 exit 0。
- **不能替代同行评审。** T9 报告只是投稿前的模拟。

## License

MIT，见 `LICENSE`。
