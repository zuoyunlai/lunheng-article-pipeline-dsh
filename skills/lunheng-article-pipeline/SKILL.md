---
name: "lunheng-article-pipeline"
version: "2.3.7-dsh.2"
description: "严肃长文流水线（学术论文 / 商业评论 / 行业分析 / 公众号深度长文）——多 Agent 子代理编排（DSH 适配版，对应正典 v2.3.7）。8 张角色卡（T0 主控 + T1-T3 检索 + T4 分析 + T5 写作 + T6 批判 + T7 审计，T8 终检=主控亲完成）。**不适用于** <2000 字短文/即时问答/文学创作。三角验证 + M 机械化硬门 + F 失败模式防御 + 数据信任 3 档 + 修订回环 ≤2 轮。完整变更历史见原仓库 git log。"
metadata:
  note: "DSH 不识别技能级工具白名单——工具集由 Agent 预设（组合文件）决定；原 OpenClaw 的 metadata.requires/tools 段已移除，工具映射见正文「DSH 适配说明」章节。"
---

> 版本：v2.3.7-dsh.2（DSH 适配版，对应正典 v2.3.7，自动同步 2026-08-22）

# 多 Agent 深度长文流水线（论文/深度文章生产）

## 🔧 DSH 适配说明（v2.3.7-dsh.2 — 从 OpenClaw v2.3.7 移植到 DeepSeek Harness）

本技能原为 OpenClaw 编写。在 DeepSeek Harness（dsh web，standard 预设）环境下，工具映射如下：

| OpenClaw 工具 | DSH 对应 | 说明 |
|---|---|---|
| `sessions_spawn` | `subagent` | 派发子代理（后台、可续接）；`subagent_fork` 可继承本会话上下文 |
| `sessions_yield` | `subagent` 默认后台 + 完成通知 | 并行派发后等待各子代理的完成通知，不要空转轮询 |
| `sessions_history` / `sessions_list` | `list_agents` | 查看/续接子代理 |
| `update_plan` | `todo_write` | 计划与任务跟踪 |
| `web_search` | `web_search` | 已内置；搜索提供方按 DSH 配置 |
| `web_fetch` | （默认关闭） | standard 预设 `fetch: false`；需抓取时经主人开启，或改用 `pwsh`/`bash`、`read_page` |
| `tavily_search` / `tavily_extract` | 无内置 → 用 `web_search` / `read_page` | 如需 Tavily 可另配 Tavily MCP（`dsh-mcp-client`） |
| `memory_get` / `memory_search` / `memory_store` / `memory_recall` | 无内置记忆工具 → 用文件 | 沿用本技能 `memory/*.md` 约定，读写文件即可（或 `gm_search`/`gm_record` 图记忆） |
| `image_generate`（封面/插图） | 无内置图像生成工具 | 降级：SVG 矢量风（程序化，本地）或主人投喂图片；如需文生图可另配图像生成 MCP（如 MiniMax `image-01`） |
| `exec` / `process` | `bash`（Linux）/ `pwsh`（Windows） | 本机为 Windows，用 `pwsh` |
| `apply_patch` | `edit` / `str_replace_editor` | |
| `browser` / `cron` / `skill_workshop` / `tts` 等 | 无对应 | 不适用 |

**结构性差异（重要，覆盖正文中所有残留的 OpenClaw 表述）**：

1. **技能级工具白名单/denied 在 DSH 无效**：工具集由 Agent 预设决定，技能声明不了也禁不了工具；正文中「15 项工具」「exec 被 deny」等段落仅为原 OpenClaw 环境的残留说明，DSH 下模型可用工具以当前会话预设为准（standard 预设含 `pwsh`/`bash`，可按需给主控/子代理使用）。
2. **模型分配无法在技能内强制**：DSH 的模型路由由 `settings.yaml` / LLM 适配器配置决定，`subagent` 默认继承会话模型。要**按角色分模型**，装本包「分档预设」（`examples/preset/`，会话预设选「论衡分档」）后，主控按角色用三档工具派发：
   - `subagent_retrieval`（T1 文献/T2 数据/T3 案例）→ 默认 `deepseek-v4-flash`，`LUNHENG_RETRIEVAL_MODEL`
   - `subagent_strong`（T4 分析/T5 写作/T6 批判）→ 默认 `deepseek-v4-pro`，`LUNHENG_STRONG_MODEL`
   - `subagent_audit`（T7 审计）→ 默认 `deepseek-v4-pro`，`LUNHENG_AUDIT_MODEL`
   - 未装预设或未挂载对应工具 → 全部回退 `subagent`（继承会话模型），流水线照常运行。
3. **执行韧化协议在 DSH 精简为「执行约定」**：OpenClaw 的 30 秒心跳/分阶段 ack/模型健康度预检/8 分钟硬卡在 DSH 下移除，改为——状态机（status.md）+ 交接报告六要素 + G8 自检 + 超时介入（主控用 `list_agents` 查看子代理，长时间无产出即介入）。
4. **运行时目录约定**：`run/<项目名>/` 工作树、`memory/*.md`、`final/` 等由本技能在项目启动时创建；机制文档在本技能目录的 `references/`（原 OpenClaw 部署的 `pipeline/` 对应 `references/`）。
5. **角色编号（v2.3.0 重构）**：T1 文献 / T2 数据 / **T3 案例** / **T4 分析** / **T5 写作** / **T6 批判** / **T7 审计** / **T8 终检 = 主控亲完成**（无独立角色卡）——编号 = 流水线 Phase 顺序（T1-T3 检索 / T4-T5 加工 / T6-T8 防御）。

> **🌟 新功能（v2.2.13）**：5 分钟快速开始？读 [`QUICKSTART.md`](QUICKSTART.md)。
> **📖 核心概念**：定义见 [`references/glossary.md`](references/glossary.md)（单一真源）。

## 📖 核心概念词汇表（单一真源入口）

**开始使用前，强烈建议先阅读**：[`references/glossary.md`](references/glossary.md)

词汇表集中定义了：
- 8 张角色卡（T0-T7）+ T8 终检职责（v2.3.0 重构：T6 案例检索 → T3，T6 = 批判伙伴，T7 = 审计员，**T8 终检 = T0 主控亲完成，无独立角色卡**）
- 三层防御体系（M 门/F 模式/G 清单）
- 数据信任级别（3 档）
- 关键协议（Phase 0/0 条空卡/并行独立运行）
- 工具能力边界（DSH：工具集由 Agent 预设决定，见上文「DSH 适配说明」）
- 版本号管理（DSH：git + 双端副本 + npm）
- 教训沉淀体系（#1-#115）

**为什么要先读词汇表**：
- 减少文档冗余，避免同一概念在多处重复定义
- 建立统一的术语体系，降低理解成本
- 快速索引关键概念，提升查询效率

---

## ⚠️ 执行能力边界（重要：先读这一段）

**论衡技能的执行能力**：
- ✅ **可以**：read / write / edit / web_search / read_page / todo_write / subagent / list_agents / pwsh / bash 等当前会话预设提供的工具（DSH 无技能级白名单——工具集由 Agent 预设（组合文件）决定，以当前会话为准）
- ❌ **不做**：凭据访问 / 浏览器自动化 / 定时任务 / 记忆系统外文件（DSH 无技能级 denied——靠预设与主人授权约束；原 OpenClaw 的 exec/apply_patch deny 在 DSH 下不适用，standard 预设含 `pwsh`/`bash`）
- ℹ️  **M 门算法**：主控 LLM 通过 `read` 读取算法文档，按伪代码**推理判定**，不执行实际 shell 命令
- ℹ️  **跨平台 sha256**：需要主人在 host shell 手动计算后回填（算法文档中的 shell 示例仅供人类参考）
- ℹ️  **算法文档中的 grep/ls/sort/sha256 等命令**（v2.2.17 澄清）：是「**LLM 推理模拟**」伪代码，主控用 `read` 读全文后用 LLM 推理模拟「如果执行 grep 会得到什么结果」。**论衡 agent 不执行这些 bash 命令**——它们是给人类主人参考的跨平台命令示例，不是 agent 执行代码。判定以「LLM 推理模拟结果」为准。

**为什么这么设计**：
- 论衡是纯推理流水线，所有验证都通过 LLM 推理完成（读文件 → 正则匹配 → 集合运算 → 判定）
- M 门算法文档中的 bash 命令是「人类验证示例」，方便主人手动复核，**不是 agent 执行的代码**
- 这样设计确保了跨平台兼容（Windows / macOS / Linux）和安全性（零 shell 执行风险）

> 把一篇深度文章/论文的生产拆成 **8 张角色卡 + 6 个阶段**（T1∥T2∥T3 三方真并行互不干涉，v2.1.8 + v2.3.0 重命名原 T6→T3；T6 批判伙伴 v2.2.2 新增 + v2.3.0 重命名原 T8→T6；T8 终检 = 主控亲完成），用 DSH `subagent` 子代理编排。产出有证据底座（文献卡+数据卡+案例卡）、有反方论证、有独立审计、有人工核验节点的交付物。**v2.2.4 定位升级：深度长文通用引擎**——学术论文/商业评论/行业分析/公众号深度长文；学术用 [Lxx]/[Dxx] 编号引用，公众号/商业评论用内联（机构，年份）引用。经验证：一篇 7650 字/8 节/2 图/52 文献/60 数据点的深度文，全流程约 2 小时完成。

## 启动清单（主控 Phase 0 必走）

1. 读 `references/pipeline-readme.md` 了解流水线运行手册（启动清单 / 派发话术 / 模型配置）
2. 读 `references/设计文档.md` 理解论衡的设计哲学（数据信任级别 / M 门 / 阶段闸门 / F 失败模式 / T6 批判）
3. 读 `MEMORY.md` 了解主人偏好（输出风格 / 沟通方式 / 重要教训）
4. 读 `memory/YYYY-MM-DD.md`（今天+昨天）看主人最近关注主题
5. 项目目录固定 `run/<项目名>/`，路径映射见 `references/pipeline-readme.md` 的「项目目录结构」段
6. **spawn 子代理前必读派发话术**（v2.2.8 按需加载，v2.3.0 补 T7）：T1/T2/T3/T4/T5/T6/T7/T8 八个角色（T8 终检不 spawn，仅主控亲完成作参考）的完整派发模板见 [`references/pipeline-readme.md#派发话术`](references/pipeline-readme.md)；不要凭记忆复制 SKILL.md 历史版本（避免双形式同步漂移，教训 #57）
7. 审计前必读 G 体系：`references/agents/07-审计-auditor.md`（G0-G13 详解）+ `references/_shared/M-Gate-Algorithm.md`（M 门算法）
8. 文件修改走安全流程（v2.1.4 F5 补完）：**任何时候禁止 `sed -i`**（静默清空文件事故教训 #48）
   - 改前：`wc -l` 记录 + `cp <file> <备份目录>/<file>.bak` 备份（Windows 用 `$env:TEMP` 或项目内备份目录）
   - 改中：用 `edit` 工具精确 oldText 匹配，不用 sed/awk/perl 直接写回
   - 改后：`wc -l` 对比 + `diff <file> <备份目录>/<file>.bak` 验证，不一致立即恢复
   - 跨文件 sync：直接 `cp` 不带任何转换（skill 副本同步是 `references/` 路径映射）
9. 子代理产出必须交交接报告：**六要素**缺一不可（做了什么/产物在哪/怎么验证/已知问题/下一步 + status.md 更新）；子代理长时间无产出 → 主控用 `list_agents` 查看并介入（DSH 精简版，无 8 分钟硬卡）

## 何时使用 + 字数分层（v2.2.7 软化）

**适用场景**（v2.2.4 定位升级：深度长文通用引擎）：

- 主题涉及事实/数据/多方观点，需要证据底座而非纯观点输出
- 文章需要「人在环」把关：大纲确认后再写，终稿人工审
- 主人愿意等 1-3 小时

**字数分层建议**（v2.2.7 软化分层，不做硬性限制）：

| 字数 | 流水线建议 | 配置差异 |
|---|---|---|
| **≥5000 字** | 强烈推荐全量流水线 | 全套 8 角色 + 三方并行 + T6 批判 + T7 审计修订 ≤2 轮 |
| **3000-5000 字** | 推荐全量流水线 | 标准 8 角色，T3 视量级必 spawn（v2.3.0 改 T6→T3），T6 视论证强度可选 |
| **2000-3000 字** | 可走轻量档 | T1/T2 必跑，T3 0 条空卡协议（v2.3.0 改 T6→T3），T6 必跳，T4 大纲可省（按模板出） |
| **<2000 字** | 流水线偏重，建议简化 | 主控+写手两角色直写更快（不必走 8 角色全流程） |

**触发关键词**：深度长文 / 学术论文 / 商业评论 / 行业分析 / 研究文章 / 系统论证 / 严谨论证 / 评论文章 / 调研报告

**对字数分层的理解**：流水线本身有固定成本（三方并行 + 8 角色 + 4 个闸门），字数太少投入产出比低；但 2000 字以下不是「不能用」，是「不划算」。主人按需选。

**论衡分档模型预设**（v2.2.10 新增，教训 #107；DSH 下装「分档预设」落实）：跑全量长文时，**优先按角色分层选模型**——检索便宜快 / 分析写作强推理 / 审计顶配 / 主控稳定，能省不少成本：

| 角色 | 推荐模型 | 理由 |
|------|---------|------|
| T1 / T2 / T3 检索类 | `subagent_retrieval`（deepseek-v4-flash） | 检索任务是抽取+分类，便宜快足够 |
| T4 分析 + T5 写手 | `subagent_strong`（deepseek-v4-pro） | 分析写作需强推理 |
| T6 批判伙伴 | `subagent_strong`（deepseek-v4-pro） | 批判论证也需强推理 |
| T7 审计 | `subagent_audit`（deepseek-v4-pro，可换 minimax-M3/Claude） | 审计顶配防漏判 |
| T0 主控 | 会话模型（默认） | 主控是判断+路由 |
| T8 终检 | 主控亲自完成 | 不 spawn 子代理，v2.3.0 明确 T8 终检 = 主控职责 |

**模型配置路径（DSH）**：会话级模型路由改 `settings.yaml`；按角色分模型装「分档预设」（`examples/preset/`，见上文 DSH 适配说明第 2 条）；未装预设则 `subagent` 继承会话模型。详见 `references/pipeline-readme.md`「模型配置与更换指南」段。

## 边界与轻量化建议（v2.2.7 软化「不适用场景」段）

论衡是「论文/深度文章」**写作流水线**，**擅长主动检索已发布证据 + 整合主人投喂的证据**。

**论衡能主动采集**（T1 文献检索 / T2 数据检索 / T3 案例检索 sub-agent，v2.3.0 改 T6→T3）：

- ✅ 已发布的学术文献（PubMed / CNKI / Web of Science 等数据库）
- ✅ 已发布的统计数据（教育部 / 统计局 / 行业协会等公开数据）
- ✅ 已发布的案例与报道（媒体 / 法院判决 / 行业报告等公开案例）
- ✅ 政府发布的统计 / 报告 / 调查 / 政策文件

**论衡不擅长主动采集**（这些场景建议主人投喂素材后用，或换专门工具）：

- ⚠️ **一手原始数据采集**：实验设计 / 调查问卷投放 / 用户访谈 / 田野调查 → 需要主人亲自调研，原始数据投喂为「数据源」
- ⚠️ **统计分析**（SPSS/R/Python 跑模型）：论衡可以引用统计结果，但**不执行统计计算**。如需跑回归/聚类/因子分析，请主人用专门工具，结论以「数据 + 方法描述 + 结果」形式投喂
- ⚠️ **图表原始数据采集**：论衡生成的是**数据可视化**（matplotlib/SVG），数据本身需主人提供。如需爬虫/OCR/语音转文字，请主人用专门工具，原始数据投喂后论衡制作图表
- ⚠️ **原创图片 / 视频生成**：DSH 无内置文生图（原 OpenClaw `image_generate` 不可用）——封面/插图降级为 **SVG 矢量风（程序化，本地）或主人投喂图片**，或另配图像生成 MCP（如 MiniMax `image-01`）；**不能拍摄实物照片 / 录制视频**。如需实物素材，请主人拍摄后投喂文件路径，论衡可在文末引用
- ⚠️ **代码执行**：原 OpenClaw 环境 `exec` 被 deny；DSH standard 预设含 `pwsh`/`bash`，如需跑代码验证论据，经主人同意后主控/子代理可执行，结果投喂为证据

**判断口诀**：问「这个证据是**已发布**的数据 / 文献 / 案例吗」——是，论衡主动采集；不是（是一手原始数据 / 自己拍的素材 / 自己跑的计算），主人投喂后再用。

**轻量化建议**（字数 <2000 字时）：

- 不必走流水线全流程，主控+写手两角色直写更快
- 如主人只想要 1000 字短评，主控直接调 T5 写手写一稿即可（v2.3.0 改 T4→T5），不必 T1/T2/T3
- 纯观点输出 / 即时短答 / 朋友圈文案 / 邮件：用 LLM 直接答，论衡不划算

## ⚠️ 执行前安全须知（v2.0.2 起强制 + v2.1.7 补强）

**写入范围**：

- 本流水线会创建 `run/<项目名>/` 文件树（含 01-任务简报 / status / 文献卡 / 数据卡 / 大纲 / 草稿 / 审计报告 / 定稿 / 图件 / 证据包 / 交付说明），共约 15-25 个文件，仅写入到**当前 workspace 根目录**下，不会写到 workspace 外
- **<项目名> 由主人 Phase 0 显式确认**（不接受 LLM 自动命名），且必须满足：`[\w\-一-鿿]{1,32}`（无路径分隔符，无 `..`，无绝对路径前缀）
- **Phase 0 必须先列出将创建的全部文件清单**让主人确认，再开始 Phase 1（dry-run）

**审计反哺不自动 commit**：T7 审计员的反哺报告默认只产出 `audits/反哺报告-vN.md`，**不会**自动修改论衡 workspace 下的角色卡；任何对角色卡的改动必须由主人人工 review 后手动 merge。

**失败回滚**：任一 Phase 失败，已写入的文件保留在 `run/<项目名>/` 供人工清理，不会自动删除。

**重要隐私提示**：主人提供的【项目名】、【主题】、【论文纲要】可能含敏感信息（如未公开研究 / 商业机密）——这些会通过下节列出的外部服务发出。**如敏感请用脱敏措辞 + 改 SVG 封面 + 本地 Ollama 推理**。

仅以上警告项主人独立同意后，主控 T0 才可调用。

## ⚠️ 外部服务与数据流声明（按需加载）

> **完整服务列表 + 4 选 1 同意关卡详见** [`references/glossary.md § 九 外部服务声明`](references/glossary.md#九外部服务声明-v212)

**主控 Phase 0 必须给主人 4 选 1 明示同意**（全部同意 / 脱敏+SVG+本地 Ollama / 部分同意 / 全部拒绝），并写入 `01-任务简报.md` 头部作为审计追溯依据。

**主人拒绝任一外发项** → 主控调整方案并重做 Phase 0 确认。

## 交付边界 + F 失败模式 + M 门 + 修订回环 + 阶段闸门（v2.2.8 按需加载）

> **核心机制详见** [`references/deliverables.md`](references/deliverables.md)（含交付边界 v2.2.0 + F1-F9 失败模式 + M 机械化门控段 v2.2.0~v2.2.1 + 修订回环 ≤2 轮硬约束 v2.2.0 + 阶段闸门 T2.5/T7.5 v2.2.1，v2.3.0 改 T5.5→T7.5）。

> **v2.3.0 重构（2026-08-21）**：角色编号重构——T6 案例检索 → T3 案例检索（三方并行检索员连贯 T1∥T2∥T3），T3-T8 顺延，T7/T8 交换位置（终检 → T8 主控亲完成、批判 → T6 独立早期攻击、审计 → T7 形式审查）。**编号 = 流水线 Phase 顺序**：T1-T3 检索 / T4-T5 加工 / T6-T8 防御。教训 #116。
> **交叉引用**：[`failure-modes.md`](references/_shared/failure-modes.md)（F 体系详解）+ [`audit-checklist-quickref.md`](references/_shared/audit-checklist-quickref.md)（G0-G13 详解）+ [`M-Gate-Algorithm.md`](references/_shared/M-Gate-Algorithm.md)（M 门算法完整规约）。
> **错误信息友好化**：详见 [`references/errors.md`](references/errors.md)（12 类常见错误的三段式友好版）
## 流水线全景（Phase 0-5）

```
Phase 0 定题        与主人确认主题/篇幅/受众/配图需求 → 01-任务简报.md + status.md
Phase 1 并行检索    T1 文献检索员 ∥ T2 数据检索员 ∥ T3 案例检索员（subagent 三方真并行，等子代理完成通知；T3 任何量级必 spawn，含 0 条空卡协议，v2.3.0 改 T6→T3）
Phase 2 分析        T4 分析员 → analysis/分析大纲.md（论点-论据映射 + 反方论证规划 + 三角验证）
Phase 2.5 大纲确认  主人过目大纲 → 确认/修改（人在环！改方向成本最低，不可跳过）
Phase 3 写作        T5 写手 → drafts/初稿-v1.md（铁律：引用标[Lxx]、数字标[Dxx]、案例标[Cxx]、AI去味10项，v2.3.0 改 T4→T5）
Phase 3.5 洞察补充  主人过目初稿 v1 → 主控问主人洞要补 → T5 写手 v2 融入（人在环！v2.1.3 教训 #46）
Phase 3.6 批判      T6 批判伙伴（v2.2.2 新增）→ analysis/批判报告-vN.md（攻击 v2 不是 v1，轻量档可跳过，v2.3.0 改 T8→T6）
Phase 4 审计        T7 审计员 → audits/审计报告-vN.md（G0覆盖度/G1引用核验/G2数据溯源/G3逻辑/G4格式/G5规范，v2.3.0 改 T5→T7）
Phase 4.2 修订      审计打回 → 写手交修订说明+修订稿 → 审计复核 ≤2 轮 → 仍不过升级主控（v2.2.4 起修订轮强制 spawn 独立写手）
Phase 4.5 配图      （**默认关闭**，需主人在 Phase 0 同意关卡明确勾选）写手标 [图N：标题] 图位 → 主控程序化生成 SVG 数据图表（数字与数据卡一致）；封面生成需主人首次确认（v2.1.1 + v2.2.17 强化）——DSH 无内置文生图：默认 SVG 矢量风（程序化，本地）或主人投喂；如需文生图，另配图像生成 MCP（如 MiniMax image-01），首次调用前必须经主人同意。封面不是默认行为——需主人在 Phase 0 明确勾选「启用封面生成」才处理；未勾选则用 SVG 或主人上传。
Phase 5 终检        主控终检 → final/定稿.md + 图件/ + 证据包/ + 交付说明.md
```

## 项目目录结构

```
run/<项目名>/
├── 01-任务简报.md       # Phase 0 产出：子问题拆解 + 字数预算 + 配图需求 + 期刊/风格模板
├── status.md            # 状态机：Inbox→Assigned→In Progress→Review→Done|Failed（角色交接必更新）
├── literature/文献卡.md # T1 产出：[L01]... 每条含可信度等级 A/B/C + 关联
├── data/数据卡.md       # T2 产出：[D01]... 每条含来源机构+年份+URL+时效🟢🟡🔴
├── cases/案例卡.md      # T3 产出：[C01]... 每条含事件/主体/时间窗口/多方说法/≥2来源
├── analysis/分析大纲.md # T4 产出：论证主线+映射表+反方规划+章节字数预算
├── analysis/批判报告-vN.md # T6 产出（v2.3.0 改 T8→T6）：C1-C7 多维批判（从反方攻击论证）
├── drafts/初稿-vN.md    # T5 产出 + 修订稿 v2/v3（**显式覆盖前稿**，每轮均同步 `drafts/修订说明-vN.md`） + 修订说明
├── audits/审计报告-vN.md# T7 产出：P0致命/P1严重/P2建议
├── final/定稿.md        # Phase 5：终稿（去标注版另存）
├── final/图件/          # 数据图表 + 封面
├── final/证据包/        # 文献卡+数据卡+审计报告+核验记录
└── final/交付说明.md    # 路径+图件清单+遗留风险+人工核验项
```

## 核心原则

1. **证据底座先行 + 三角验证**：任何论点必须能映射到文献卡[Lxx]+数据卡[Dxx]+案例卡[Cxx]（涉企业行为/事件者必须配案例卡，至少两项齐全）；检索不到就标缺口，严禁编造
2. **人在环四节点**：Phase 0（定题）、Phase 2.5（大纲）、Phase 3.5（洞察补充）、Phase 5（终稿）必须让主人过目
   - **v2.3.3 纠偏（教训 #138）**：Phase 3.6（T6 批判）**不是**人在环节点，是流水线内部动作（spawn T6 攻击 v2 → T5 写手 v3 融入），主人不介入
3. **反方论证强制**：每个核心论点配「可能的反驳+回应策略」，避免单边叙事
4. **独立审计**：审计员只审不改，与写手分离；引用分级抽验（C级100%/B级≥50%/A级≥10%）；案例卡新增「G2.5 案例核验」项（多源交叉、时间锚点、立场并列）
5. **模型分工**：检索用便宜快模型（如 deepseek-v4-flash），分析/写作用推理强模型（如 deepseek-v4-pro / MiniMax-M3），审计用顶配（如 MiniMax-M3 / Claude），主控负责判断路由（具体按本机可用模型调整）
6. **时间锚点显式化**：所有卡片（文献/数据/案例）写作时引用必带年份；案例卡额外要求填「检索截止日期」+「事件时间窗口」
7. **强相关性原则（防材料堆砌，2026-08-13 教训 #34）**：
   - **每条材料必答「它支撑哪个论点」**——卡片「与本文的关联」字段必填，答不出不收
   - **数量封顶**：[Lxx] 8-12 / [Dxx] 30-50 / [Cxx] 5-8，加一起 50-70 条封顶，宁缺毋滥
   - **反向淘汰自查**（交付前必走）：逐条问「删掉它哪条论点会塌」，无影响→砍
   - **相关性 vs 时效性冲突**：相关性优先；时效新鲜但相关性弱的材料不要
   - **案例卡特别警惕**：是「示例」还是「证据」？示例降级为正文引用，不进案例卡
8. **原创性保证（防「重复/改写已公开文章」，2026-08-13）**：
   - **先行者检索**（T1）：检索支持文献同时，主动搜「该主题是否已有公开深度文/论文写过类似核心论点」，产出先行者清单
   - **差异点声明**（T4）：分析大纲必须声明「本文核心论点与已公开文章的差异点」
   - **G7 原创性审计**（T7）：核心论点与他人重复且未声明 → P0；差异点声明模糊 → P1

## 派发话术与审计必查项（v2.2.8 按需加载）

**派发话术**：T1/T2/T3/T4/T5/T6/T7 七个 spawn 角色的完整派发模板见 [`references/pipeline-readme.md#派发话术`](references/pipeline-readme.md)（T8 终检不 spawn，由主控亲完成，参考主控卡 §终检段）。**主控 spawn 子代理前必读**（不要凭记忆复制 SKILL.md 历史版本，引用 pipeline-readme.md 的最新版，避免双形式同步漂移，教训 #57）。

**审计必查项**：G0-G13 审计清单的逐条详解 + M 门算法 + G6/G7/G11/G12 实战子项见 [`references/_shared/audit-checklist-quickref.md`](references/_shared/audit-checklist-quickref.md)（全集）与 [`references/agents/07-审计-auditor.md`](references/agents/07-审计-auditor.md)。SKILL.md 不重复维护，避免文档漂移（教训 #60）。

**派发话术锚点速查**（主控读 pipeline-readme.md 后定位用）：
- T1 文献检索员 → `## 派发话术` →「文献检索员（并行①）」
- T2 数据检索员 →「数据检索员（并行②）」
- T3 案例检索员 →「案例检索员（v2.3.0 重命名…）」
- T4 分析员 →「分析员」
- T5 写手 →「写手」
- T6 批判伙伴 →「批判伙伴（v2.2.2 新增…）」
- T7 审计员 →「审计员」

**审计锚点速查**：
- G0-G13 全集 → `references/_shared/audit-checklist-quickref.md`
- G 体系 + M 门 + F 模式 → `references/agents/07-审计-auditor.md`
- M-Form/M-Exist/M-Integrity → `references/_shared/M-Gate-Algorithm.md`
- F1-F9 失败模式 → `references/_shared/failure-modes.md`
- 错误信息友好化 → `references/errors.md`
- M-Form/M-Exist/M-Integrity 三层 → `references/_shared/M-Gate-Algorithm.md`

## 修订回环
```
审计结论=打回 → 写手交 修订说明（逐条回应）+ 修订稿 → 审计员对照复核
最多 2 轮。仍不过 → 升级主控：重写/砍段落/咨询人类。
```

## 配图 + 写作禁做清单 + 成本模型（v2.2.8 按需加载）

> **Phase 4.5 配图 + 写手禁做 + 模型建议**详见 [`references/operations.md`](references/operations.md)。
## 角色卡与模板（完整版）

- **8 张角色卡**（00 主控 / 01 文献 / 02 数据 / 03 案例 / 04 分析 / 05 写作 / 06 批判 / 07 审计，v2.3.0 编号重构）：`references/agents/`（T3 案例检索员**任何量级必 spawn** 含 0 条空卡协议；T6 批判伙伴 v2.2.2 新增、v2.3.0 改编号，轻量档可跳过；T8 终检 = 主控亲完成，无独立卡）
- 7 类模板（任务简报 / status 状态机 / 交接报告 / 文献卡 / 数据卡 / 案例卡 / 先行者清单，每类含 lite 精简版 + full 完整版）+ 图表-SVG 模板：`references/templates/`
- 流水线运行手册（含 7 角色完整派发话术 + M 门 + F 模式 + AI 使用披露）：`references/pipeline-readme.md`
- 核心概念词汇表（单一真源）：`references/glossary.md`；错误信息友好化：`references/errors.md`
- 设计文档（数据信任级别 / M 门 / 阶段闸门 / F 失败模式 / T6 批判 详解）：`references/设计文档.md` + `设计文档-哲学.md` + `设计文档-架构.md`
- 实战案例库（商业热点 / 品牌一致性 / 原创性悖论 + 教训沉淀）：`references/case-studies.md`
- 快速开始：`QUICKSTART.md`

## 实战验证案例

论衡实战案例库见 [`references/case-studies.md`](references/case-studies.md)（含商业热点/品牌一致性/原创性悖论 3 个完整案例 + 教训沉淀）。SKILL.md 不重复维护，案例持续追加。
