# 架构说明

## 角色

| 角色 | 编号 | 职责 |
|---|---|---|
| 主控 | T0 | 定题、拆解、派发、阶段闸门（T2.5/T7.5）、终检（M 门）、状态机 |
| 文献检索员 | T1 | 文献卡 [Lxx]（可信度 A/B/C + GB/T 7714）+ 先行者清单 |
| 数据检索员 | T2 | 数据卡 [Dxx]（🟢🟡🔴 时效 + 信任级别 + 冲突口径并列） |
| 案例检索员 | T3 | 案例卡 [Cxx]（事件结构 + 多方立场 + ≥2 来源，任何量级必 spawn） |
| 分析员 | T4 | 分析大纲（论点-论据映射 + 反方论证规划 + 三角验证） |
| 写手 | T5 | 初稿（引用/数据/案例全标编号） |
| 批判伙伴 | T6 | 批判报告（C1-C7 反方攻击） |
| 审计员 | T7 | 审计报告（G0-G14，只审不改） |
| 终检 | T8 | 主控亲完成（M 门 + 定稿 + 证据包；有角色卡 `references/agents/08-终检-finalizer.md`，但**执行者 = 主控本人不 spawn**） |
| 同行评审 | T9 | 审稿报告（6 维度评分 + 期刊匹配 Top 3，可选） |

编号 = 阶段顺序（T1-T3 检索 / T4-T5 加工 / T6-T9 防御）。

## 三角验证

任何核心论点必须能映射到三类证据至少两项：

- [Lxx] 学术依据 + [Dxx] 量级数据 + [Cxx] 具体事件

缺角就标缺口，严禁编造。

## 审计 G0-G14 + M 门

G0 覆盖度 / G0.5 视角一致性 / G1 分级核验（C 级 100% web_search 实测）/ G2 数据溯源 / G2.5 案例核验 / G3 逻辑 / G4 格式 / G4-2 文末四节 / G5 规范 / G6 论据自标 / G7 原创性 / G8 成品度 / G9 时序 / G10 一致性 / G11 时效 / G12 信任级别一致性 / G13 AI 使用披露 / G14 中文 AI 痕迹闸（8 类检测维度；Phase 4.6 串行）。

终检前主控跑 **M 门**（`references/_shared/M-Gate-Algorithm.md`）：**总 26 项 = 机检 25 项（M-Form 11 项 + M-Exist 12 项 + M-Integrity-1 + M-Fact-1）+ 人工 1 项（M-Integrity-2）**，LLM 兜底执行，产出 `final/M-Gate-Report.json`，exit 0 才交付。

## 原创性保证

T1 先行者检索 → T4 差异点声明 → T7 G7 原创性审计，防止「重复/改写已公开文章」。

## 跨项目证据素材池（v19.6.6：此前架构文档零提及）

```
项目① run/<项目名>/ ──Phase 5 pool-extract──▶ <工作区根>/evidence-pool/      ← 跨项目、长期（A 轨）
项目② Phase 0.5 pool-query ──命中──▶ 注入 T1/T2/T3 派发话术（复用不绕过三角验证 / G8 / G7）
```

- **落点**：`<工作区根>/evidence-pool/`（与 `run/` 平级）+ `raw/{books,datasets,papers,misc}/`（主人预设原件，**只读**）+ 四个池文件（`literature` / `data` / `cases` / `databases`.json）+ `index.md`（人类视图）+ `manifest.json`（**派生量**，一律由池文件重算）。
- **与项目内两条路的区别**：池是 **A 轨**（跨项目复用）；`run/<项目>/materials/` + `主人投喂清单.md` 是 **B 轨**（本项目一次性）。两者互不替代。
- **三个脚本**：`pool-query.mjs`（Phase 0 显形 + Phase 0.5 查池）/ `pool-extract.mjs`（Phase 5 回写）/ `pool-report.mjs`（统计），均属随包白名单；**不随包分发的是数据**。
- 机制真源 = [`../skills/lunheng-article-pipeline/references/_shared/素材池.md`](../skills/lunheng-article-pipeline/references/_shared/素材池.md)。

## 机制全景图（v19.19.0 起随包）

Mermaid 源码 4 张图（装载面 / 编排面 / 门禁面 / 修订回环）：[`机制全景.mmd`](../skills/lunheng-article-pipeline/references/_shared/机制全景.mmd)。装包即可读，**不需要**仓库外的 6 视图 HTML；图内数字核对记录留在维护者的 `diagrams/_facts/`（不随包）。

## DSH 适配

技能以「bundle」形态发布，两部分各司其职：**包入口 `lib/index.js`** 经 `ctx.skills.register()` 注册**两个技能**（`lunheng-article-pipeline` 主技能 + `lunheng-commands` 内嵌子技能；`resourceBase` 指向随包的 `skills/lunheng-article-pipeline/`，故角色卡/模板/脚本的相对引用在任意 cwd 下可解析，且注册即 effect、卸载自动清理）；**`cordis.patch.yml`**（由 `package.json` 的 `dsh.bundle.patch` 声明）只叠加 3 档 subagent 工具。工具集由 DSH Agent 预设决定，模型路由由 `settings.yaml` 配置。

## lib/ 的运行时半边（v19.6.1 补：此前本节只讲注册面，另一半无声明）

> **为什么补**：2026-10-15 全量审计 **P2-14** 实测——本节此前只描述「注册技能 + patch 工具」，对
> `lib/` 里**随包发货的另外约四百 KB**（守卫 / 工具 / 命令 / 监听器 / 面板 / 浏览器半边）**一个词都没提**
> （`panel` / `guard` / `写保护` / `命令` / `监听` / `client` 关键词命中全为 0）。架构文档只覆盖一半注册面
> ＝读者无法据它判断「装了这个包会在宿主里多出哪些面」。

| 模块 | 作用 | 默认 | 关闭方式 |
|---|---|---|---|
| `lib/index.js` 的 **H2/H4 监听器** | `tools/post-execute` 上做伦理脱敏**标记**（默认**不改写**正文）；`system-prompt/assemble` 上追加「变更面」提示（本次行为变更条数 + CHANGELOG 锚点；数据源 = **随包的** `lib/change-surface.json`，开发树无该文件时回退读仓库根 `CHANGELOG.md`） | 开 | `Config.ethicsHook: false` |
| `lib/guard.js` **机制文件写保护** | 经 `ctx.tools.guard()` 全局否决命中**受保护根**的写调用（技能副本 / `lib/` / 仓库 `scripts/` / `cordis.patch.yml`；写工具**与**登记过的写参数） | 开 | 主人授权：env `LUNHENG_ALLOW_MECH_EDIT=1`（或 profile 里的同名开关） |
| `lib/tools.js` **原生工具 ×4** | `lunheng_m_gate` / `lunheng_char_count` / `lunheng_handoff_check` / `lunheng_ethics_sanitize`（前三个薄包装随包脚本；`m_gate` 可写门报告，受**可写范围围栏**） | 宿主有 `tools` 服务即注册 | 宿主不含 `tools` 服务时自动降级 |
| `lib/commands.js` **人类命令** | `/lunheng-status`（读单项目进展）/ `/lunheng-stats`（跨项目遥测看板）/ 子技能侧的 `/lunheng-*` 路由 | 开 | 无需开关 |
| `lib/panel.mjs` **运行面板（只读 HTTP 读面）** | 在宿主 `ctx.webServer` 上挂 `prefix` 路由 `/lunheng-panel/*`：`/ping`、`/projects`、`/snapshot`、`/file`（只读下载项目内产物）、`/events`（SSE） | **开**（v18.93.0 起「装完即用」） | `Config.panel: false` 或 `LUNHENG_PANEL=0` |
| `lib/client.js` + 开工台 | 浏览器半边：运行面板视图 + 「开工台」表单；只写 `localStorage`，**不新增宿主路由** | 随面板 | 同面板 |

**共同口径**：以上模块都**零第三方依赖**、不联网、不写盘（例外逐条写明：面板只读、工具仅 `m_gate` 的门报告可写、监听器默认只标记）；所有路径判定统一走 `lib/run-path-fence.mjs` 的**三层围栏**（词法 → 结构 → realpath 物理层），**新入口不得自写一套**（审计 §优化方向 2）。逐项信任边界与残余风险见 [`SECURITY.md`](../SECURITY.md)。
