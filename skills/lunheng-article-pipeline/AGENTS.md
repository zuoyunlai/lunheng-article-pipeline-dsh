# AGENTS.md — 论文流水线操作手册

> **DSH 适配**：本手册由 OpenClaw 版移植（对应正典 v2.3.7）。工具映射（`sessions_spawn`→`subagent`、`sessions_yield`→等完成通知、`sessions_history/list`→`list_agents`、`tavily_search`→`web_search`、`update_plan`→`todo_write`、`image_generate`→SVG/投喂、`exec`→`pwsh`/`bash`）与结构性差异见 `SKILL.md` 的「🔧 DSH 适配说明」章节。

## 启动时必读
1. `references/pipeline-readme.md` — 流水线运行手册（含复制即用的派发话术）
2. `references/glossary.md` — 核心概念词汇表（单一真源：角色/三层防御/数据信任/教训体系）
3. `memory/YYYY-MM-DD.md` — 今日/昨日记录（如有）

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
Phase 4 审计     → spawn T7 审计员 → audits/审计报告-vN.md（G0-G13 全项检查）
                 → 打回修订 ≤2 轮（必须 spawn 独立写手）；仍不过 → 升级决策 / Acknowledged Limitations 模式
[🔒 T7.5 完整性门] 审计报告最新版 + P0/P1 清单 + M 门全 exit 0 + 隔离 → 通过才终检
Phase 5 终检     → T8 主控亲完成 M 门（M-Form 6+7 / M-Exist 3 / M-Integrity 2，LLM 兜底）→ final/定稿.md + 证据包/ + 交付说明.md
```

## 关键规则
- **派发话术**：直接从 `references/pipeline-readme.md` 复制，改项目名即可
- **每个项目一个目录**：`run/<项目名>/`，产物路径见任务简报
- **角色编号（v2.3.0 重构）**：T1 文献 / T2 数据 / T3 案例 / T4 分析 / T5 写作 / T6 批判 / T7 审计 / **T8 终检 = 主控亲完成**（编号 = 流水线 Phase 顺序）
- **模型分配（DSH：分档预设可选）**：`subagent` 默认继承会话模型，路由由 DSH `settings.yaml` 决定。要按角色分模型，装「分档预设」（三档工具 `subagent_retrieval`/`subagent_strong`/`subagent_audit`，模型经 `LUNHENG_*_MODEL` 覆盖，默认检索 `deepseek-v4-flash`、分析写作批判/审计 `deepseek-v4-pro`）；未挂载对应工具时回退 `subagent`
- **子代理产出必须交交接报告**：六要素缺一不可（做了什么/产物在哪/怎么验证/已知问题/下一步 + status.md 更新），长时间无产出则主控用 `list_agents` 查看并介入
- **status.md 写入约定（v2.3.7-dsh.4 强化，教训：T1/T2 与主控并发写冲突）**：status.md 由**主控独占写**——子代理**只读** status.md（了解当前状态），**不直接 edit** 整表；子代理的进度/完成状态通过「交接报告 + 产物落盘」回报，主控在收到交接报告后统一更新 status.md。如子代理确实需要记录执行细节，追加到独立执行记录段（`### Tn 执行记录`），不做整表替换。冲突已发生时：主控先 re-read 再 edit。
- **执行约定（DSH 精简版）**：状态机 + 交接报告六要素 + G8 自检（无需心跳/分阶段 ack/预检/8 分钟硬卡；OpenClaw 完整韧化协议见 `references/_shared/archive/legacy-protocols/执行韧化协议-v2.1.0.md`，仅作参考）
- **阶段闸门（v2.2.1，v2.3.0 改 T5.5→T7.5）**：T2.5（检索→分析）与 T7.5（审计→终检）两道主控 checkpoint，用 `todo_write` + `read` 实现，**不绕过交接直接派发**
- **M 门（v2.2.0+）**：终检前必读 `references/_shared/M-Gate-Algorithm.md`，按伪代码执行 M-Form/M-Exist/M-Integrity（含 M-Form-7 定稿文末白名单 v2.3.5），产出 `final/M-Gate-Report-v2.2.4.json`，exit 0 才返回
- **项目进展记入** `memory/YYYY-MM-DD.md` 和 `memory/projects.md`

## 文件修改操作约束（v2.1.4 F5 补完，教训 #48）

论衡工作区所有修改走以下安全流程，**任何时候禁止 `sed -i`**（静默清空文件事故教训）：

1. **改前**：`wc -l <file>` 记录行数 + `cp <file> <备份目录>/<file>.bak` 备份（Windows 用 `$env:TEMP` 或工作区内备份目录）
2. **改中**：用 `edit` 工具（精确 oldText 匹配），**不用 sed/awk/perl 直接写回原文件**
3. **改后**：`wc -l` 对比 + `diff <file> <备份目录>/<file>.bak` 验证（不一致立即从 .bak 恢复）
4. **跨文件 sync**：用 `cp` 不带任何转换，直接覆盖（skill 副本同步是 `references/` 路径映射）
5. **验证**：本修改走完后必 `grep` 关键词 + 结构性 grep（如本手册的「## 交接报告」所有角色卡齐整性）

## 记忆文件（运行时由主控在项目目录创建，非技能包内置）
- `memory/YYYY-MM-DD.md` — 每日日志（记结论不记过程）
- `memory/projects.md` — 各论文项目状态
- `MEMORY.md` — 长期约定（保持精简）
