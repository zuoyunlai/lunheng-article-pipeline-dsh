# 使用流程

论衡把一篇深度长文/论文的生产拆成 7 个角色、5 个阶段，由主控按协议派发子代理协作完成。

## 五阶段

| Phase | 内容 | 产物 |
|---|---|---|
| 0 定题 | 与主人确认主题/篇幅/引用格式/cases 需求/外部服务同意 | `run/<项目>/01-任务简报.md` + `status.md` |
| 1 并行检索 | **T1 文献 ∥ T2 数据 ∥ T6 案例** 三方真并行 | 文献卡 + 数据卡 + 案例卡 |
| 2 分析 | T3 分析员 | `analysis/分析大纲.md` |
| 2.5 大纲确认 | 主人过目（人在环） | — |
| 3 写作 | T4 写手 | `drafts/初稿-v1.md` |
| 4 审计 | T5 审计员（G0-G11，只审不改） | `audits/审计报告-vN.md` |
| 4.2 修订 | 写手修订 ≤2 轮 | `修订说明` + `v2/v3` |
| 5 终检 | 主控终检 | `final/定稿.md` + 图件 + 证据包 + 交付说明 |

## 项目目录结构

```
run/<项目名>/
├── 01-任务简报.md       status.md
├── literature/文献卡.md  # [Lxx]
├── data/数据卡.md        # [Dxx]
├── cases/案例卡.md       # [Cxx]（T6 常驻产出，0 条走空卡协议）
├── analysis/分析大纲.md
├── drafts/初稿-vN.md + 修订说明
├── audits/审计报告-vN.md
└── final/定稿.md + 图件/ + 证据包/ + 交付说明.md
```

## 人在环四节点

Phase 0（定题）、Phase 2.5（大纲）、Phase 3.5（洞察补充）、Phase 5（终稿）——四个节点必须主人过目。

## 分档派发（按角色指定模型，可选）

默认所有角色走同一个 `subagent` 工具、继承会话模型。装了「分档预设」后，主控会按角色改用三档工具，把模型也分档：

| 工具 | 角色 | 默认模型 | 环境变量 |
|---|---|---|---|
| `subagent_retrieval` | T1 文献 / T2 数据 / T6 案例 | `deepseek-v4-flash` | `LUNHENG_RETRIEVAL_MODEL` |
| `subagent_strong` | T3 分析 / T4 写作 | `deepseek-v4-pro` | `LUNHENG_STRONG_MODEL` |
| `subagent_audit` | T5 审计 | `deepseek-v4-pro` | `LUNHENG_AUDIT_MODEL` |

- 安装与切换见 `docs/installation.md` 的「分档预设」一节；
- 未装预设或未挂载对应工具时，主控自动回退到 `subagent`（所有角色继承会话模型），不影响流水线运行。
