# 使用流程

论衡把一篇深度长文/论文的生产拆成 9 张角色卡、6 个阶段，由主控按协议派发子代理协作完成。

## 阶段

| Phase | 内容 | 产物 |
|---|---|---|
| 0 定题 | 与主人确认主题/篇幅/引用格式/cases 需求/外部服务 4 选 1 同意 | `run/<项目>/01-任务简报.md` + `status.md` |
| 1 并行检索 | **T1 文献 ∥ T2 数据 ∥ T3 案例** 三方真并行（T3 任何量级必 spawn） | 文献卡 + 数据卡 + 案例卡 + 先行者清单 |
| 2 分析 | T4 分析员（含 T2.5 完整性门通过后） | `analysis/分析大纲.md` |
| 2.5 大纲确认 | 主人过目（人在环） | — |
| 3 写作 | T5 写手 | `drafts/初稿-v1.md` |
| 3.6 批判 | T6 批判伙伴（C1-C7 反方攻击，轻量档可跳过） | `analysis/批判报告-vN.md` |
| 4 审计 | T7 审计员（G0-G14，只审不改） | `audits/审计报告-vN.md` |
| 4.2 修订 | 写手修订 ≤2 轮（独立写手执行） | `修订说明` + `v2/v3` |
| 4.5 审稿 | T9 同行评审（可选，学术/行业分析默认开）+ G14 中文 AI 痕迹闸 | `audits/审稿报告-vN.md` + `G14-检测报告-vN.md` |
| 5 终检 | 主控 M 门终检（T7.5 完整性门通过后；M-Form 11 / M-Exist 11 / M-Integrity 2 / M-Fact 1） | `final/定稿.md` + 图件 + 证据包 + 交付说明 |

## 项目目录结构

```
run/<项目名>/
├── 01-任务简报.md       status.md
├── literature/文献卡.md  # [Lxx] + 先行者清单.md
├── data/数据卡.md        # [Dxx]
├── cases/案例卡.md       # [Cxx]（T3 常驻产出，0 条走空卡协议）
├── analysis/分析大纲.md + 批判报告-vN.md（T6）
├── drafts/初稿-vN.md + 修订说明
├── audits/审计报告-vN.md
└── final/定稿.md + 图件/ + 证据包/ + 交付说明.md
```

## 人在环四节点

Phase 0（定题）、Phase 2.5（大纲）、Phase 3.5（洞察补充）、Phase 5（终稿）——四个节点必须主人过目。

## 分档派发（按角色指定模型，可选）

默认所有角色走同一个 `subagent` 工具、继承会话模型。**三档工具行默认不装载**（v18.2.6 起：三档全继承时它们与内置 `subagent` 完全同义）；**设任一档的 `LUNHENG_*_PROVIDER` / `_MODEL`，或 `LUNHENG_TIERING=on`** 装载后，主控会按角色改用三档工具，把模型也分档：

| 工具 | 角色 | 能力定位 | 默认 provider/model（可覆盖） |
|---|---|---|---|
| `subagent_retrieval` | T1 文献 / T2 数据 / T3 案例 | 便宜快 | 继承父会话（设 `LUNHENG_RETRIEVAL_*` 才分档） |
| `subagent_strong` | T4 分析 / T5 写作 | 推理强 | 继承父会话（设 `LUNHENG_STRONG_*` 才分档） |
| `subagent_audit` | T6 批判 / T7 审计 / T9 审稿 / G14 检测 | 顶配防漏判 | 继承父会话（设 `LUNHENG_AUDIT_*` 才分档） |

- 覆盖环境变量：`LUNHENG_{RETRIEVAL,STRONG,AUDIT}_PROVIDER`（provider 名）+ `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_MODEL`（裸模型 id）——**两者分离，跨 provider 必须同时指定**；**设了任一档即同时装载三行**（每档自己的取值仍独立，未设的档继承父会话）；
- `LUNHENG_TIERING=on` = 不指定任何模型也装载三行（用于确认工具是否可见）；`LUNHENG_TIERING=off` = 强制不装载（优先级最高）；
- 安装与切换见 `docs/installation.md` 的「分档预设」一节；
- 三档行未装载时，主控自动回退到 `subagent`（所有角色继承会话模型），不影响流水线运行。

## 长会话与主会话体量（成本治理）

会话成本 ≈ **步数 × 每步上下文**。论衡最贵的从来不是某个子代理，而是**人驱动的主会话**——主控要读产物、跑门、回填四门、盯修订轮，步数一路累积（本机实测最贵的两个会话都是主会话，419 步 / 435 步，合计与全部子代理成本同量级）。两条可操作建议：

1. **审计类长会话按阶段拆 session**。一条流水线不必塞进一个会话：Phase 0-2（定题 + 检索 + 分析）、Phase 3-4（写作 + 批判 + 审计 + 修订）、Phase 4.5-5（审稿 + 终检）各起一个会话；跨会话靠 **落盘产物 + `status.md`** 交接（本技能的状态机本就是为断点续跑设计的）。**插件侧无法自动拆分**，需要主人手动起新会话。
2. **先跑机械门，只把失败项交给会话**。`m-gate-check.mjs` / `final-check.mjs` / `handoff-check.mjs` / `consistency-check.mjs` / `repo-hygiene-check.mjs` 都是**零模型成本**的：先在 host shell 跑一遍，只把 **exit code + 失败项**贴进会话，避免让会话逐条通读全文去做机械判定（那是把确定性工作交给最贵的一环）。
