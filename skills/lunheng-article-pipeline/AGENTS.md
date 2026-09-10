# AGENTS.md — 论文流水线操作手册

> **DSH 说明**：本手册为 DSH 原生手册。所用 DSH 工具：subagent / list_agents / send_message / web_search / read_page / todo_write / pwsh / edit / write 等；结构性差异见 `SKILL.md` 的「🔧 DSH 环境说明」章节。

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
Phase 4 审计     → spawn T7 审计员 → audits/审计报告-vN.md（G0-G14 全项检查，v2.4.0 加 G14 中文 AI 痕迹闸，与 T6 并行）
                 → 打回修订 ≤2 轮（必须 spawn 独立写手）；仍不过 → 升级决策 / Acknowledged Limitations 模式
Phase 4.5 审稿   → spawn T9 同行评审（可选，默认选中，**学术论文必选**）→ audits/审稿报告-vN.md（6 维度评分 + 期刊匹配助手 Top 3）
[🔒 T7.5 完整性门] 审计报告最新版 + P0/P1 清单 + M 门全 exit 0 + 隔离 → 通过才终检
Phase 5 终检     → T8 终检（独立角色，主控 T0 以 T8 身份亲完成 M 门：M-Form 8 / M-Exist 3 / M-Integrity 2，LLM 兜底）→ final/定稿.md + 证据包/ + 交付说明.md
```

## 关键规则
- **派发话术**：直接从 `references/pipeline-readme.md` 复制，改项目名即可
- **每个项目一个目录**：`run/<项目名>/`，产物路径见任务简报
- **角色编号（v2.3.0 重构，v2.5.2 延续，v2.5.2-dsh.8 语义定案）**：**9 个独立角色 T1-T9 不可相互替代**——T1 文献 / T2 数据 / T3 案例 / T4 分析 / T5 写作 / T6 批判 / T7 审计 / **T8 终检（独立角色，主控 T0 亲执行）** / **T9 同行评审（可选默认选中，学术必选）**（编号 = 流水线 Phase 顺序）
- **模型分配（DSH 通用自适应）**：`subagent` 默认继承会话模型（**单模型配置零配置可用**），路由由 DSH `settings.yaml` 决定。配了多模型想按角色分档 → 装「分档预设」（三档工具 `subagent_retrieval`/`subagent_strong`/`subagent_audit`，默认检索 `deepseek-v4-flash`、分析写作批判审稿/审计 `deepseek-v4-pro`，均可经 `LUNHENG_*_PROVIDER`（provider 名）+ `LUNHENG_*_MODEL`（裸模型 id）覆盖——**provider 与 model 分离，跨 provider 必须同时指定两者**，否则 dsh-llm 报 NO_ADAPTER）；**已装分档预设时派发必须按角色选工具**（T1/T2/T3→subagent_retrieval，T4/T5/T6/T9→subagent_strong，T7/G14→subagent_audit，见 pipeline-readme「DSH 分档预设接线」）；未挂载对应工具时回退 `subagent`（任何模型配置都能跑）
- **子代理产出必须交交接报告**：六要素缺一不可（做了什么/产物在哪/怎么验证/已知问题/下一步 + 状态更新），长时间无产出则主控用 `list_agents` 查看并介入
- **子代理失败三段式处理（v2.5.2-dsh.6 修订，教训：测试轮三检索员全失败 + T5 两次结算异常）**：① **落盘校验**——子代理 settle 后主控必跑 `read`/`ls` 检查关键产物是否存在+非空+结构完整，区分「写盘前失败」vs「写盘后失败」vs「任务完成」；② **产物完整 → `send_message` 续接原子代理**（DSH continuable，让它读已落盘产物确认后继续，**不是整任务重派**）；③ **产物缺失 → 才 spawn 新子代理重派**。**连续失败**：先查 DSH 环境（`list_agents` 看是否 `[ready]` 可续接；全失败可能 = DSH 进程状态问题，重启 dsh web 再试）。
- **status.md / agents-log.md 分文件写入约定（v2.5.2-dsh.5 修订，教训：T1/T2 与主控并发写冲突）**：**状态文件分两层**——① `status.md` 由**主控独占写**（纯状态机表，不允许子代理直接 edit）；② `agents-log.md`（v2.5.2-dsh.5 新增，项目根目录）由**子代理追加写**（每完成一个角色任务追加一段 `### Tn 执行记录` 节）。子代理的进度/完成状态通过「交接报告 + 产物落盘」回报，主控在收到交接报告后统一更新 status.md。**两文件分离目的**：避免子代理追加触发主控 edit status.md 报「file changed since it was read」（测试轮多次遇到的小摩擦）。冲突已发生时：主控先 re-read 再 edit。
- **执行约定（DSH 精简版）**：状态机 + 交接报告六要素 + G8 自检 + **进度播报三播报**（派发即播报 / 完成即转播 / 卡住即告警，防主人干等；无需心跳/分阶段 ack/预检/8 分钟硬卡；旧版完整韧化协议已移出仓库（历史见 git log），现行规则即本执行约定）
- **阶段闸门（v2.2.1，v2.3.0 改 T5.5→T7.5）**：T2.5（检索→分析）与 T7.5（审计→终检）两道主控 checkpoint，用 `todo_write` + `read` 实现，**不绕过交接直接派发**
- **M 门（v2.2.0+）**：终检前必读 `references/_shared/M-Gate-Algorithm.md`（**仅 T7/T8 读**——T1-T5/T9 不读，因 M-Form-1/3/5/7 + M-Exist-2 已脚本化为 `scripts/m-gate-check.mjs`，LLM 只判 M-Form-8 三角验证等不可脚本化项），按伪代码执行 M-Form/M-Exist/M-Integrity（M-Form 8 项含 M-Form-7 定稿文末白名单 v2.3.5 + M-Form-8 三角验证 v2.3.7），产出 `final/M-Gate-Report.json`，exit 0 才返回
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
5. **验证**：本修改走完后必 `grep` 关键词 + 结构性 grep（如本手册的「## 交接报告」所有角色卡齐整性）；改论衡机制/文档后额外跑 `node scripts/consistency-check.mjs`（P0-1 四类漂移自动检测，exit 0 才提交）；**仓库级打包面检查**（cordis.patch.yml 合法性 / 行 id 唯一 / `dsh.bundle.patch` 指向 / package.json 元数据 / 工程红线，含纯 skill bundle 的两条已声明豁免）由 CI 的 `plugin-surface` job 承担，本地复现命令见 `.github/workflows/ci.yml` 与 CHANGELOG 同名条目

## 记忆文件（运行时由主控在项目目录创建，非技能包内置）
- `memory/YYYY-MM-DD.md` — 每日日志（记结论不记过程）
- `memory/projects.md` — 各论文项目状态
- `MEMORY.md` — 长期约定（保持精简）
