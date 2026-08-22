# Changelog

本文件记录 DSH bundle（lunheng-article-pipeline）的版本历史。DSH 版与 OpenClaw 原版分离维护，版本号以 -dsh.N 标记第 N 次 DSH 适配。

## 2.3.7-dsh.4（2026-08-22）

- **实战改进 9 项沉淀**（基于《AI 编程助手对开发者效率的影响》实测，教训源自 [L03] 量级两轮纠错 / METR 转述失真 / 引擎额度耗尽 / status 并发写冲突）：
  - **P0-1 跨卡冲突修订铁律**（05-写作卡）：数字冲突先回查一手来源定正确值，禁止「对齐式统一」掩盖基准错误
  - **P0-2 出处层级**（02-数据卡）：样本特征二次转述标「摘要/正文/博客」层级，摘要未出现默认待复核
  - **P0-3 审计核验两档标注**（07-审计卡）：存在性核验 ≠ 数字级核验；PDF/反爬源用 Crossref/DOI 兜底
  - **P1-4 检索引擎容错**（01/02/03 检索卡）：引擎失败即切换备用/read_page，中文源缺口显式上报
  - **P1-5 修订复核关闭/未关闭显式化**（07-审计卡）：未关闭条目一律升级，修订说明「已处理」≠审计「已关闭」
  - **P1-6 status.md 只读约定**（AGENTS.md + 派发话术）：status 主控独占写，子代理只读 + 交接报告回报
  - **P2-7 接受脆弱剩余风险入交付说明**（pipeline-readme 终检必查项 12）
  - **P2-8 启动标记文件**（派发话术）：子代理启动写 `analysis/Tn-启动.txt`，主控快速判断进度
  - **P2-9 反哺 merge 清单**（pipeline-readme 终检必查项 13）：反哺建议列入交付说明 checklist 等主人 review

## 2.3.7-dsh.3（2026-08-22）

- **文档深度清理（第二轮独立审计）**：净 -447 行
  - **OpenClaw 专属机制归档**：`执行韧化协议-v2.1.0.md` + `通用韧化块-v2.1.0.md` 移入 `references/_shared/archive/legacy-protocols/`（心跳/分阶段 ack/模型预检/8 分钟硬卡/`subagents(action=list)` 伪代码均为 OpenClaw 机制，DSH 用不上）；8 张角色卡 + AGENTS.md 引用改指 DSH 执行约定
  - **DSH 事实矛盾修复**：`image_generate`/OpenAI gpt-image-2→gemini→minimax fallback 链 → SVG 矢量风/主人投喂/图像 MCP；`exec 被 deny` → DSH standard 预设含 `pwsh`/`bash`；Tavily/Ollama fallback → DSH web provider/本地模型；`~/.DSH/agents/*.trajectory.jsonl` 诊断 → `list_agents`
  - **冗余清理**：16 个文件头部 12-13 行自动同步版本行堆叠压缩为 1 行 DSH 版本；SKILL.md 重复 T8 行/重复工具条目；status 模板心跳/ack/降级记录段精简
  - 涉及 SKILL.md / AGENTS.md / QUICKSTART.md / pipeline-readme.md / glossary.md / 8 张角色卡 / 4 个模板 / 3 份设计文档，共 27 文件

## 2.3.7-dsh.2（2026-08-22）

- **工程层编号同步审计修复**：README.md / docs/{introduction,usage,architecture,faq,installation}.md / examples/preset 全量对齐 v2.3.7 编号（T3 案例/T6 批判/T7 审计、T7.5 门、分档表 T1-T3/T4-T6/T7）；package.json description、cordis.patch.yml 注释同步

## 2.3.7-dsh.1（2026-08-22）

- **同步 OpenClaw 正典 v2.3.7 全量升级**（43 提交 / 60 文件 +6996 行）：
  - **角色编号重构（v2.3.0）**：T1 文献 / T2 数据 / T3 案例（原 T6）/ T4 分析（原 T3）/ T5 写作（原 T4）/ T6 批判（原 T8）/ T7 审计（原 T5）/ T8 终检=主控亲完成——编号 = 流水线 Phase 顺序
  - **M-Form-7 定稿文末白名单硬门**（v2.3.5）+ **渐进式 M 门验证**（v2.2.15）+ 阶段闸门 T2.5/T7.5
  - **lite 模板族**（7 类 × full+lite）+ 图表-SVG 模板 + 版本号自动化（scripts/check-version.sh）
  - **新文档**：glossary.md（单一真源词汇表）/ errors.md（错误友好化）/ 设计文档-哲学/架构拆分 / QUICKSTART.md
  - **人在环纠偏**：Phase 3.6 批判非人在环节点（教训 #138）；删 T2.5 主人签字（教训 #136/#137）
- **DSH 适配**：8 张角色卡全部 DSH 化（执行约定精简 + 分档预设 T3 案例→retrieval/T6 批判→strong/T7 审计→audit）；机械替换 + 深度审计修复（workflow 3 组 × 全文件，修复旧编号残留/OpenClaw 现行机制/坏引用/矛盾 100+ 处）

## 2.2.8-dsh.3（2026-08-19）

- **实跑反馈的 10 项改进**（试运行《AI 让你写得快，但未必让你更会写》后沉淀）：
  1. **T2.5 门逻辑修正**：数据需求基准从「大纲 D 列数」（T2.5 在大纲前，不存在）改为「任务简报数据需求声明」
  2. **子代理异常兜底协议**：failed 通知 → 验产物/验 status/验口径 3 步，不默认重跑
  3. **简报不预转述数据**：任务简报加「数据需求声明」字段，只写需求不写内容（防 Phase 0→1 漂移）
  4. **文献作者必核**：文献卡模板 + T1 话术禁止「作者待核」占位
  5. **数据卡计数自检强制**：T2 交付前必须核对头部声明条数 vs 实际条目数
  6. **派发话术自读角色卡**：7 段话术统一加「先读 references/agents/0X-xxx.md」
  7. **分档预设推荐**：全量长文优先「论衡分档」预设（检索 flash / 分析写作审计 pro）
  8. **汇报粒度约定**：默认阶段级汇总，异常/打回才即时打断
  9. **M 门引用模式前置**：简报显式记录内联/编号模式，M 门执行前确认
  10. **证据包指纹 SHA256**：M-Exist-2 补 Windows `Get-FileHash -Algorithm SHA256` 命令

## 2.2.8-dsh.2（2026-08-18）

- **深入质量审计修复**（workflow 5 组并行 × 36 文件 × 6 维度，~130 处问题）：
  - **去除 DSH 用不上的 OpenClaw 残留**：删除 `m_exist_1_diff.sh`；fallback 链 / `include_domains` / `session-kill` / 15 项白名单 / `fc-list`/`ls -la`/`sha256sum` 等 bash 命令改 DSH 等价；`/tmp` 路径适配 Windows
  - **修复 8 处 SOUL.md 坏引用**（正典已删）→ `failure-modes.md` / 设计文档；README/scripts/lessons.md/workspace-paperwriter 等无效引用修正
  - **统一口径**：M 门 6+3+2、M-Gate-Report-v2.2.4.json、T6 任何量级必 spawn、T8 可跳过、G0-G13、终检必查 13 项、交接报告六要素（5 卡补齐）
  - **版本升级自审门 DSH 化**（门 C/D/E 改为仓库/活动副本/npm 路径）

## 2.2.8-dsh.1（2026-08-18）

- **同步 OpenClaw 正典 v2.2.8 全量升级**（41 文件重构基线）：
  - **8 角色**：新增 T8 批判伙伴（C1-C5 反方攻击，Phase 3.6，轻量档可跳过）
  - **审计 G0-G13**（新增 G11 时效告警 / G12 信任级别一致性 / G13 AI 使用披露）+ **M 门**（M-Form 6 + M-Exist 3 + M-Integrity 2，LLM 兜底执行，零 exec 依赖）
  - **T2.5 / T5.5 阶段闸门**（主控 checkpoint）+ 修订回环 ≤2 轮硬约束 + Acknowledged Limitations 模式
  - **字数分层**（≥5000 全量 / 3000-5000 标准 / 2000-3000 轻量跳 T8 / <2000 简化）
  - 文档分层：SKILL.md 瘦身，机制详情进 `references/`（设计文档 / deliverables / operations / case-studies / `_shared/`）
  - 模板拆分为 7 个（新增文献卡 / 数据卡 / 先行者清单模板）
- **DSH 适配**：8 张角色卡全部 DSH 化（执行约定精简版：状态机 + 交接报告六要素 + G8 自检 + 超时介入 `list_agents`，移除心跳/ack/预检/8 分钟硬卡）；工具映射 subagent/web_search/todo_write/list_agents/SVG 降级；分档预设新增 T8 归 strong 档
- **删除**：SOUL.md（正典 v2.2.8 已移除，内容并入 SKILL.md）

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
