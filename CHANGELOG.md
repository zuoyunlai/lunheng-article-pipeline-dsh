# Changelog

本文件记录 DSH bundle（lunheng-article-pipeline）的版本历史。DSH 版与 OpenClaw 原版分离维护，版本号以 -dsh.N 标记第 N 次 DSH 适配。

## 2.5.2-dsh.8（2026-09-07）

- **12 个 token 优化 commits 合并发布**（基于 v2.5.2-dsh.8，平台-gig 项目实测 cacheRead 191M → 预计 80-90M，省 50~55%）：
  1. `a31a03c` 角色卡瘦身 + Phase 1.5 拆任务 + 审计视图
  2. `eb53def` T5 段级 diff 模式（修订轮 60-105 步 → ≤25 步）+ T2 失败熔断
  3. `6112c72` 一键终检 final-check.mjs（count-chars + m-gate + build-evidence 串联，5-8 分钟 → 1 分钟）
  4. `6639dce` T1 文献检索失败熔断 + T6 段级攻击清单（单会话 88 步 → ≤30 步）
  5. `01e8482` count-chars.mjs 加 --summary 模式
  6. `1013fd4` build-evidence-bundle.mjs 加 --deep-summary 模式（含 L/D/C 前 30 条素材卡）
  7. `a3c49bc` final-check.mjs 加 --json + --report 模式
  8. `bb251d6` m-gate-check.mjs 加 --summary 模式
  9. `d331f84` 任务简报加 Phase 1.5 触发字段（trigger + 必补关键词 + 拆任务约束 ≤30 步）+ 主控读字段指引
  10. `44e3dd0` 04-分析 + 05-写手 卡加 Phase 1.5 触发字段读取指引
  11. `6d0d886` 06-批判 + 09-审稿 卡加 Phase 1.5 触发字段读取指引
  12. `8435952` 07-审计 + 08-终检 + status-template + consistency-check --fix + token-cost --top
- **9 层 Phase 1.5 trigger 决策一致性**：主控 + 任务简报 + T4/T5/T6/T7/T8/T9 全部读取同一 trigger 字段，避免每次 LLM 副产物判断的不一致性
- **一键修复**：`node scripts/consistency-check.mjs --fix` 自动修复「（检查）」占位符等可逆漂移
- **性能调试**：`node scripts/token-cost.mjs --top N` 按 cacheRead 排序取前 N 会话，秒定位 cache 消耗大头
- **一键终检**：`node scripts/final-check.mjs <项目> [--no-summary] [--json] [--report PATH]` 串联 count-chars + m-gate + build-evidence

## 2.5.2-dsh.7（2026-09-07）

- **角色语义定案（主人指令）**：
  - **9 个独立角色 T1-T9 互不可替代**（文献/数据/案例/分析/写作/批判/审计/终检/审稿）——每个都有独立角色卡 `references/agents/01~09`
  - **主控 = T0 调度 + T8 终检执行双重身份**：T8 终检是独立角色，执行者由主控担任、不 spawn 子代理 → **新增 `references/agents/08-终检-finalizer.md`**（此前 T8 无独立角色卡，语义修正为「独立角色 + 主控执行」不矛盾）
  - **T9 审稿可选但默认选中，学术论文必选**（废止 v2.4.6「公众号默认关闭」口径；行业分析/商业评论/公众号默认选中、主人 Phase 0 可取消）
- **T8 终检自动化新增**：
  - `scripts/build-evidence-bundle.mjs`：一键自动生成 `final/证据包/`（文献卡/数据卡/案例卡/先行者清单/大纲/批判报告/审计报告/复核报告/反哺报告/修订说明*/status/任务简报），取代手工复制
  - AI 使用声明三版本模板（学术/出版/公众）：`references/templates/AI-使用声明-template.md`
  - 主人确认单模板（Phase 2.5/3.5/5 人在环节点标准化）：`references/templates/主人确认-template.md`
- **写作字数约束**：反方段每派 ≤150 字硬上限（防反方喧宾夺主）+ 写完自跑 `count-chars.mjs` 取实值
- **版本号全库同步** v2.5.2-dsh.6 → v2.5.2-dsh.8（33 个 .md 版本头 + package.json + cordis.patch.yml + examples）

## 2.5.2-dsh.6（2026-09-06）

- **稳定性三件套（测试轮复盘）**：
  - **子代理失败三段式处理**：落盘校验 → 产物完整则 `send_message` 续接原子代理 → 缺失才重派；连续失败先查 DSH 环境（教训：测试轮三检索员全失败 + T5 两次结算异常）
  - **配图意向回写**：Phase 2.5 拍板后主控必回写大纲配图段 + 派 T5 显式传图位（教训：拍板要图但大纲写 0 张，T5 删图位）
- **口径统一**：
  - **字数口径单一锁定** = count-chars.mjs 正文区纯汉字（教训：3998/4310/4060 三口径漂移）
  - **证据数量区分**「检索量（数据卡）」vs「引用量（正文）」，大纲/引言只声明引用量（教训：大纲22/数据卡27/正文26 漂移）
- **引用核验强化**：二手转引必须回查原始报告核实「口径是否对应」（教训：D09 高中生抄袭口径被误引为 AI 调查）
- **T9 时序声明**：G14 未产出时以 T7 G5 兜底并显式声明「G14 待补」
- **[EB/OL] 著录扩展**：数据来源/案例来源网络条目同样按 GB/T 7714 [EB/OL] 著录（教训：32 条网络来源缺著录，T9 引文规范 3 分）
- **期刊库扩充**：补教育技术类（中国高教研究/中国电化教育/电化教育研究/开放教育研究），中文 24→28 个
- **G14-C 主题词豁免**：命中词若是标题/关键词/核心论点里的主题词（如「路径」），不计入学术套话命中（教训：测试轮「路径」11 处误报）
- **status.md 维护轻量化**：开始/完成时间可省略，时间戳由 agents-log.md 承担（减轻主控逐字段维护负担）

## 2.5.2-dsh.5（2026-09-06）

- **M 门 13 项全脚本化（M 门 14 项反思落地）**：`m-gate-check.mjs` 从 5 门（M-Form-1/3/5/7 + M-Exist-2）扩到 13 门（M-Form 1-8 + M-Exist 1-3 + M-Integrity-1），引入严重度 P0/P1/P2 分级 + exit code 分级（P0→2 / P1→1 / 仅 P2 或全过→0）
  - M-Form-1 阈值提升 L≥3；M-Form-2/7 白名单统一 5 节；M-Form-4 黑名单转白名单（剥离引用/数字/机构后查内部代码）；M-Form-5 扩弱 AI 痕禁词；M-Form-6 双格式 + 描述字段交叉验证；M-Form-8 每论点强制含 L + coverage≥2
  - **M-Form-8 前置段修复**：排除摘要/关键词/引言/结语（防无引用摘要/引言被误判「缺 L」恒定 P0——引言以 [先xx] 声明原创性差异点，非论点论证）
  - **M-Integrity-1 正则兼容**：子问题编号兼容「子问题 A/B/C」∪「S1/S2」旧格式 + 「需找数据点≥N」占位符识别
  - **tally 对齐**：soft（LLM 兜底）独立 bucket，total=pass+p0+p1+p2+soft+skips
- **count-chars.mjs 新增**：字数统计（正文区/全文纯汉字双口径），替代 T5 LLM 估算（实测偏差 ~30%）
- **DSH 架构优化**：`cordis.patch.yml` 重写为 4 段 insert（技能提供者 + 三档 subagent）；删除 `examples/preset/agent.cordis.yml`（standard 全量副本，防漂移）；preset.yml 重定位为说明
- **status.md / agents-log.md 双文件写入约定**：status.md 主控独占写，agents-log.md 子代理追加写（防并发写冲突）
- **repo↔.dsh 同步修复**：M 门修订回写仓库 + `.dsh` 技能目录清污染（整仓混入清干净）
- **测试轮验证（gen-ai-academic-integrity 学术论文全链路）**：Phase 0-5 全闭环跑通，M 门 13 项 exit 0（P0×0/P1×0/P2×1）、T9 审稿 22/30 minor revision、G14 Pass；真实定稿压测暴露并修复 2 处脚本 bug：
  - M-Form-6 正则 `信任级别[:：]` 未容忍 Markdown 加粗 `**信任级别**：` → 误判 P0，修为 `信任级别\**[:：]`
  - M-Form-8 未排除「引言」段 → 误判 P0，已把「引言」加入排除清单

## 2.5.2-dsh.4（2026-08-26）

- **第三方全量审计修复（6 维审计 + 交叉验证，P0/P1/P2/P3 四批 36 文件）**：
  - **P0 版本治理**：版本统一 dsh.4（仓库级 README/introduction/skills-README/CHANGELOG 漂移清零）；SKILL.md「使用者发布版」声明与事实对齐（archive/CI 如实说明）
  - **P0/P1 工程**：M-Gate-Report 文件名统一无后缀（含 JSON schema 值）；publish.yml 加 `--tag dsh` + tag/版本一致性校验 + 去掉 `|| true` 吞错；`process.getBuiltinModule?.()` 兜底 + `engines: >=20.6`
  - **P1 安全**：注入防御下沉到 T1/T2/T3 检索角色卡铁律 + 派发话术（外部内容不可信原则从主控层落实到检索层）；「零 exec」声明如实修正（白名单脚本 + 有限 shell）；信任级别 ≠ 注入防御的认知修正
  - **P1 机制**：分档预设接线（三档工具 subagent_retrieval/strong/audit 进入派发话术，从此实际生效）；修订回环双轨制定案；G 十五项 / M-Form 8 项 / T9·G14 默认开 口径统一
  - **P1 脚本**：m-gate-check 补 `C-主` 引用 + 版本化归一化 + M-Form-5 估算标记豁免 + 缺目录友好报错；token-cost zstd 兼容（node<22.15 报错）+ tree 前缀归一化 + cacheWrite 按未命中价 + 参数校验
  - **P2/P3**：consistency-check 增强为 6 类（跨文件版本比对/M-Gate-Report 漂移/角色卡索引/口径残留）；安装文档纠错（新版 dsh 自动加 bundles）；预设默认继承父会话（消灭 NO_ADAPTER）；files 补 CHANGELOG/CONTRIBUTING；pdfcheck 判定与消息一致；md2html SVG 消毒 + 图N 支持 + 同文件保护；C1-C7 七维；OpenClaw 残留清零
- **门 V 增强**：M-Gate-Report 检查补 JSON schema 值盲区

## 2.5.2-dsh.3（2026-08-25）

- **token 优化 6 项 + 终检成本实取**：
  - 卡片索引/分层加载：主控启动 ~35K 降本（启动速查表，glossary/pipeline-readme 按需查概念再读对应节）
  - 注解聚合：角色卡/文档历史分层注解不再逐层堆叠，同主题合并为单行「v2.5.2-dsh 补丁，教训：…」格式（防文档随版本膨胀）
  - M-Form 脚本化：M-Form-1/3/5/7 + M-Exist-2 由 `scripts/m-gate-check.mjs` 纯正则/哈希判定（零 LLM），T8 只判 M-Form-8 + 复核（省 ~12K token）
  - 终检成本实取：`scripts/token-cost.mjs --sessions/--tree` 读会话投影缓存，实取 token 四类 + 估算成本
  - 执行韧化协议压缩：DSH 精简版（状态机 + 交接报告六要素 + 三播报），完整版移作参考
  - pdfcheck 入库：`scripts/pdfcheck.mjs` 原始字节校验 PDF（/Page /Font /ToUnicode /CIDFont）
- **全量检查清理**：consistency-check 新增 2c「scripts/ 引用完整性」检查；写手卡精简段；M 门预检前置到 T7

## 2.5.2-dsh.2（2026-08-22）

- **第三方评审 P0-P2 全修复**：
  - 一致性自检脚本 + CI：`scripts/consistency-check.mjs`（P0-1 四类漂移自动检测）+ `.github/workflows/ci.yml`（push/PR 自动跑，exit 0 才通过）
  - 占位符标记：「（检查）」占位符净化剥离标记，SKILL.md/glossary.md 豁免
  - 门数口径统一：M 门 13 项 / 自审门 21 门（含门 V）口径对齐；QUICKSTART 触发关键词收紧（8→4 核心 + 强制 Phase 0 确认）
  - 启动清单与快速开始分层；M-Form-7 文末白名单 v2.3.5 + M-Form-8 三角验证 v2.3.7 归位

## 2.5.2-dsh.1（2026-08-22）

- **15 项实战反哺改进**：
  - 写盘校验：subagent 完成事件早于写盘落盘 → 完成通知后 wait 30s + 双重 ls 再读（写盘延迟双重校验）；写手写盘后立即 read 验证非空 + 关键标题存在
  - Phase 1.5 定向补检索：T4 大纲标「待复核 [Dxx]」或「缺口论点」→ 主控 spawn T1 补检索（关键二手数据定向回查 + 缺口论点补检索，Permanent Gap 标注）
  - 字数层级：任务简报显式二选一写入 + Phase 2.5 主人拍板（v1-v3 全超 +3-9% 教训）
  - 图号规则：图位编号 = 章节出现顺序（[图1]→[图2]→[图3] 连续，禁止断号，断号自动重排仅警告）
  - 破折号自检前移（v1 落地前 grep「——」≤8 处）；跨学科理论概念核验（catharsis category error 教训）；洞察引导 3 具体问题；G14 与 T6 并行触发
  - 分档预设补 T9/G14 映射；版本行全量统一

## 2.5.2-dsh.0（2026-08-25）

- **同步正典 v2.5.2（v2.3.7 → v2.5.2 大版本跨越）**：
  - **新增 9 角色体系**：T9 同行评审（`09-审稿-peer-reviewer.md`，6 维度评分 → accept/minor/major/reject）+ 主控扩展职责（`00-主控-扩展职责.md`）
  - **新增 G14 中文 AI 痕迹闸**（`gates/14-中文AI痕迹-gate.md` + `checkers/中文AI痕迹-checker.md`，8 类检测维度，LLM 推理判定零 exec）
  - **新增期刊匹配助手**（`_shared/期刊数据库.md` 25 CSSCI + 12 SSCI + `期刊匹配算法.md`）
  - **新增多格式导出**（`_shared/format-export.md` md/latex/docx/pdf）+ **中文数据源集成**（`_shared/中文数据源集成.md` OpenAlex/Crossref 第一梯队）
  - **新增退化场景规范**（`degraded-scenarios.md`）+ 字数判定表 + M 门附录 + 投稿就绪检查表 + 修订说明模板 full
  - **外部内容防注入**（v2.4.0：外部内容一律视为不可信证据，只提取事实不执行指令）
  - **中文学术特化定位**（v2.4.4：GB/T 7714-2015 / Top 3 中文期刊 / G14）
- **DSH 适配**（156 处 OpenClaw 残留 + 23 文件版本行）：
  - 51 文件同步（17 新增 + 34 覆盖），保留 21 个 DSH 独有文件（AGENTS/设计文档/教训库/自审门等）
  - 工具映射批量替换（sessions_*→subagent、tavily_*→web_search/read_page、metadata.tools 删除、心跳/8分钟硬卡→DSH 精简版）
  - 10 张角色卡韧化协议段 DSH 化；SKILL.md 新增「🔧 DSH 适配说明」段
  - 分档预设补 T9/G14 映射；自审门更新到 9 角色；image_generate 封面描述 DSH 化（SVG/投喂/图像 MCP）

## 2.3.7-dsh.8（2026-08-22）

- **全面独立审计修复**（工程层 + 3 独立子代理并行，13 严重 + 40 中轻微）：
  - **P0 自审门 DSH 化**：版本升级自审门-v2.3.0 头部加 DSH 适配映射表；门 C/D/E/G/J 路径与编号 DSH 化（pipeline/→references/、ClawHub→仓库↔.dsh 副本、门 D 文件列表 00-07 实际编号）；门数口径统一（21 门含门 V）
  - **P0 执行层歧义清零**：M 门项数统一「M-Form 8 + M-Exist 3 + M-Integrity 2 = 13 项」（原 6/7/11 混用）；修订回环**定案为审计独立 2 轮预算**（v1→v2 洞察 + v2→v3 批判不计入）；G/F 清单 glossary 重写对齐执行真源；渐进式验证标注未启用；M-Gate-Report 文件名统一（去版本后缀）；批判维度统一 C1-C7；终检必查项 15 项；六要素第 6 条统一状态机更新
  - **P1 元数据/残留**：package.json 补 repository/homepage/bugs/author；cordis 注释 dsh.8；preset.yml 补 PROVIDER；版本残留（faq/introduction/skills README 的 dsh.1、三处 dsh.6 标注）清零；m_exist_1_diff.sh 归档；glossary §七 ClawHub 第 5 层删除改 DSH 3 层真源
  - **P1 中轻微项**：operations 禁做#3、任务简报 M-Form-4/T3.5、errors 三处旧编号、架构篇 Phase 3.6/6 阶段、数据卡残字符/测算者、侦查→检索、案例封顶矛盾、status 8 分钟硬卡、SKILL 重复行、损坏链接、死锚点等 40 处
  - **P2 门 V 固化**：自审门新增「门 V：DSH 口径一致性」，机械化检查 M 门项数/Report 文件名/C1-C7/修订回环语义/旧编号，防本轮问题复发

## 2.3.7-dsh.7（2026-08-22）

- **角色卡模型设定去硬编码（通用化收尾，v2.3.7-dsh.6 的延续）**：
  - `07-审计-auditor.md`：删「主模型 claude-opus-5（kkaiapi 接口）」+ OpenClaw fallback 链 → 「审计档定位顶配防漏判，不写死具体模型名；超时换档重派」
  - `pipeline-readme.md`：删「claude-opus-5 → deepseek-v4-pro → minimax-M3 fallback 链」→ 「DSH 无脚本级 fallback 链，换档重派」
  - `operations.md`：模型建议表「如 deepseek-v4-flash/minimax-m3」示例 → 纯能力定位（便宜快/推理强/顶配）；删 OpenClaw fallback 链 4 档
  - `status-template-lite.md`：模板写死「当前模型: deepseek-v4-pro」→ 「继承会话模型或分档指定」
  - `00-主控-coordinator.md`：删「自动兑底路径：模型路由顺序（deepseek-v4-pro → minimax-M3 → ...）」→ 「换档重派路径（DSH 版）」；命名隔离示例 `06-v2-attack.deepseek-v4-pro.md` → `<模型名>`
  - `SKILL.md` 核心原则 5：模型分工示例名 → 纯能力描述（不写死具体模型名）
  - **门 U 同步修订**（版本升级自审门）：原检查「claude-opus-5 fallback 链 + 1-token ping 预检」与删除的硬编码冲突会自审 FAIL → 改为 DSH 版（检查「不写死模型名 + 换档重派 + 异常标注」）
  - 设计原则：能力描述（便宜快/推理强/顶配）→ 角色卡/文档；具体模型名 → 只在分档预设默认值（可覆盖）+ settings.yaml

## 2.3.7-dsh.6（2026-08-22）

- **模型配置通用化（通用插件诉求）**：
  - **单模型配置零配置可用**：不装预设，所有角色继承会话模型，任何 dsh 模型配置都能跑（通用性兜底）；
  - **多模型按角色能力分档**：分档预设默认「检索便宜快 / 分析写作批判推理强 / 审计顶配」，各档可经 `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_PROVIDER` + `_MODEL` 覆盖；
  - **预设补 provider 字段**（DSH 架构要求：`agentOptions.provider` 与 `model` 分离，跨 provider 必须同时指定两者，否则 dsh-llm 报 NO_ADAPTER）；
  - **修正无效示例**：`LUNHENG_AUDIT_MODEL=claude-opus-5`（用户环境无此 provider）→ 实际可用模型（minimax/MiniMax-M3 + provider 指定）；
  - 涉及：examples/preset/agent.cordis.yml + README、SKILL.md（模型分配段+分档表）、AGENTS.md、pipeline-readme（调度模型段）、docs/{installation,usage,introduction}.md、skills/README.md；
  - 技术验证：DSH `!!js` 仅求值标量（js-yaml scalar type），条件注入 provider 对象不可行 → 采用「固定默认 + 双环境变量覆盖」方案；新预设经 dsh --dump-config 加载验证 exit 0

## 2.3.7-dsh.5（2026-08-22）

- **定稿文末两处必填规范**（主人终稿评审确立，固化到 deliverables.md 真源 + pipeline-readme 终检项 14/15 + 00 主控卡 ⑭ + 05 写手卡铁律 9/12）：
  - **① 先行者差异声明**：`## 先行者文献` 节后必附 `> **本文与先行者的差异（原创性声明）**` 段——聚焦**主要论点/分析范式差异**（2-3 句），先诚实声明「不宣称首创」，再点差异（证据分级框架/中文语境等）；禁止罗列 4-5 点细节清单
  - **② AI 使用声明一句式**：`## AI 使用声明` 节内容限制 1-2 句（AI 生成 + 引用真实可核验 + 经审计），禁止展开多条 bullet；完整版披露留给交付说明

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
