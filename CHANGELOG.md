# Changelog

本文件记录 DSH bundle（`lunheng-article-pipeline`）的版本历史。DSH 版与 OpenClaw 原版分离维护，版本号以 `-dsh.N` 标记第 N 次 DSH 适配。

## 2.1.8-dsh.3（2026-08-18）

- npm 包补入 `docs/` 与 `examples/`（分档预设随包发布；2.1.8-dsh.2 漏配 `files` 清单，tarball 未含此二者）

## 2.1.8-dsh.2（2026-08-18）

- 新增「分档预设」`examples/preset/`：三档 subagent 工具按角色分模型（`subagent_retrieval`/`subagent_strong`/`subagent_audit`），模型经 `LUNHENG_*_MODEL` 环境变量覆盖，默认检索档 `deepseek-v4-flash`、分析写作档/审计档 `deepseek-v4-pro`
- 技能内「成本与模型建议」与派发话术同步标注分档工具，未挂载时回退 `subagent`
- 执行韧化协议精简为「执行约定（DSH 精简版）」：保留状态机 + 交接报告六要素 + G8 自检 + 超时介入（`list_agents`），移除心跳/ack/预检/8 分钟硬卡

## 2.1.8-dsh.1（2026-08-17）

- 首个 DSH bundle 发布（npm + GitHub）
- Phase 1 三检索员三方真并行、互不干涉：T1 文献 ∥ T2 数据 ∥ T6 案例（教训 #56 + #58）
- T6 案例检索员「任何量级必 spawn」，含 0 条场景空卡协议（输出 [C-空] 空卡，不阻塞主流程）
- Phase 0 增加「cases 需求（含 0 条场景显式声明）」，取消旧的三档（轻/中/重）分流
- 完整 DSH 工具适配：`sessions_spawn`→`subagent`、`tavily_search`→`web_search`、`update_plan`→`todo_write`、`sessions_history/list`→`list_agents`、`image_generate`→SVG/投喂、`exec`→`pwsh`/`bash`
- 审计统一为 G0-G11 全项检查；交接报告统一为六要素
