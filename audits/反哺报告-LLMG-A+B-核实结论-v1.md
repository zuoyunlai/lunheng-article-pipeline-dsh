# 论衡反哺报告 —— LLMG A+B 方案「动笔前核实结论」（v1）

> **性质**：**核实报告（驳回为主）**。非动议、非执行记录——它是对 [`反哺报告-v18.79.0-LLMG-A+B改造.md`](反哺报告-v18.79.0-LLMG-A+B改造.md) 的**落地前现场核实**，结论是**该方案整体不应落地**。
> **触发**：主人 2026-10-04 授权「接受例外条款授权，其他的按你的默认建议」→ 主控按 `AGENTS.md` §机制文件写保护 §例外条款 第①步（改前备份）完成后，依第③步「改后验证」的同源纪律**先做落点核实**（改前先把「要改的东西现在长什么样」读准），核实时即发现方案前提不成立，**故在动笔前中止**。
> **作者**：主控 T0
> **日期**：2026-10-04
> **基线**：技能 v18.77.1 / 仓库 `E:\HERNESS\lunheng-article-pipeline-dsh`（HEAD 见 §附录）
> **结果**：**LLMG-1 ~ LLMG-10 共 10 项，全部驳回（0 项落地）**；**机制文件零改动**。
> **与 v18.78.0 决策档的关系**：不冲突。本次核实**未发现**任何需要触碰 v18.78.0 已登记的四处设计不变量的改动——因为最终未做任何改动。

---

## §零、为什么在动笔前中止（而不是先改了再说）

主人已授权走例外条款，**授权是充分的**；中止不是权限问题，而是**对象不存在**：

- 原方案（v18.79.0）的**全部 10 项**，在落点核实中逐条撞上**论衡已有的等价机制**——而且既有实现**比方案更细、更贴领域**。
- 更要紧的是：其中至少 4 项若照方案落地，会**直接违反论衡自己写死的纪律**——`handoff-check.mjs:18` 的「**真源派生（禁止新建第二份清单）**」，以及全库 42 处「单一真源 / 不得两处维护」的判据。
- 论衡仓库的文化判据（`references/memory/lessons.md`、`AGENTS.md`）反复记载：**「把『被提到』当『做完』是错的」**、**「改完了这句话在审计里不算证据」**、**「同一事实两处维护必然漂移」**。在这种情况下照方案施工，不是执行主人的指令，而是**用主人的授权去破坏主人的仓库**。

> **判据一句话**：**授权的充分性 ≠ 动议的正确性。** 主人授权我改，不等于我应当去改一份**前提已被现场推翻**的方案。

---

## §一、结论摘要

| # | 项 | 判定 | 一句话理由 |
|---|---|---|---|
| LLMG-1 | 新建交接 JSON Schema | ❌ **驳回** | 已有 `sources-索引-template.md` schema + 负知识账本 schema + 交接报告六要素；新建即「第二份清单」 |
| LLMG-2 | 交接报告模板加 JSON 节 | ❌ **驳回** | 与六要素契约构成两处维护；`handoff-check` 的 B 组已机械校验六要素 |
| LLMG-3 | `handoff-check.mjs` 加 JSON 节校验 | ❌ **驳回** | 无 JSON 契约可校验（LLMG-1/2 已驳） |
| LLMG-4 | 新增 5 个断点节点 | ❌ **驳回** | 已有 §二十一「人在环四节点触发清单」+ 确认单 + 预授权，且更细 |
| LLMG-5 | 改 `00-主控-扩展职责.md` §H5-H9 | ❌ **驳回（锚点伪造）** | **该节不存在**；真实落点 §八 / §二十一 已完整 |
| LLMG-6 | `AGENTS.md` 加「断点门」 | ❌ **驳回** | §二十一 + `handoff-check --require-gates`（A7）已是机械面 |
| LLMG-7 | 规范-机械门对照表加 LLMG 行 | ❌ **驳回** | 无新增规范可登记（连带 LLMG-1~6 全驳） |
| LLMG-8 | hygiene 规则① 扫描面扩面 | ❌ **驳回（早已实现）** | `r01-syntax.mjs` 自 **v18.1.0** 起即扫 `tracked ∪ untracked` 且含 `.js` |
| LLMG-9 | 试点批 | ❌ **驳回（无对象）** | 无改动可试点 |
| LLMG-10 | 加 state 字段断言机检 | ❌ **驳回（无对象）** | 依赖 LLMG-9 |

**净落地项：0。**

---

## §二、逐条核实表（现场实据）

### LLMG-1 / LLMG-2 / LLMG-3 —— 「结构化交接 = typed channel + reducer」

**方案声称**：论衡「只有 markdown log + 路径字符串」，需升级为 typed JSON state。

**现场实据（typed channel + reducer 均已存在，且分场景各有一套）**：

| 既有物 | 形态 | 实据 |
|---|---|---|
| `sources/{T1,T2,T3}.jsonl` | **per-writer append-only 分片** + 显式 schema（`url`/`title`/`fetchedAt`/`summary` 四键必填，另加 `tool`/`engine`/`query` 溯源三键） | schema 真源 = [`templates/sources-索引-template.md`](../skills/lunheng-article-pipeline/references/templates/sources-索引-template.md) §二；三卡派发话术各写一行 |
| `sources-index.mjs --merge` | **reducer**（合并语义） | `SKILL.md:62`；「合并成 `sources.json` 由**主控**在 Phase 2.5 跑 `--merge`」 |
| `audits/disproofs.jsonl` | 第二套 typed 账本（`id/claim/verdict/basis/evidence/reproduce/author` 七字段），有独立校验器 | [`_shared/负知识账本.md`](../skills/lunheng-article-pipeline/references/_shared/负知识账本.md) §二/§三；`scripts/disproofs-check.mjs` |
| `handoff-check.mjs` | 交接**机械验收**（产物落盘 + 六要素回报段 + AI 披露 + 四门 §6 回填） | `handoff-check.mjs:5-23,33-50` |
| `M-Gate-Report.json` / `final/证据包/manifest.json` | 机器可读的结构化产物 | `SKILL.md` §执行能力边界 |

**且论衡对「该不该分片」有显式设计判据**（这正是 LangGraph 论文式「channel 怎么设」的同一位面）：

> `sources/{T1,T2,T3}.jsonl` **分片**（每线独占，防三线互相覆盖）；`disproofs.jsonl` **刻意不分片**——理由写在 `负知识账本.md:28`：「账本要能被 T8/外审一次读完，而分片需要额外 merge 步骤」。

**关键否决依据**：`handoff-check.mjs:18` 逐字写着 ——

> `// 真源派生（禁止新建第二份清单）`

LLMG-1 正是要求新建「第二份清单」（一套平行的交接 JSON schema）。**这不是「可以商量的取舍」，是仓库写死的禁令。**

---

### LLMG-4 / LLMG-5 / LLMG-6 —— 「人机协作断点显式化」

**方案声称**：论衡只在 Phase 0 有 HITL，需把 M 门后 / T5 v3 前 / G14 前 / T9 后 / fix-gates 后建成断点节点。

**现场实据**：`00-主控-扩展职责.md` **§二十一「人在环四节点触发清单」（第 388 行起）** 已远超方案设想：

| 方案想加的能力 | 论衡现状（实据行号） |
|---|---|
| 4 个 HITL 节点 | ✅ 已有 **Phase 0 / 2.5 / 3.5 / 5** 四门，含「必到」判据与遗漏后果（`:392-397`） |
| 断点触发条件可判定 | ✅ 每门「必需要主人在场 + 交付物 / 验证点」（`:392-397`） |
| 断点后的最小动作集 | ✅ 确认单模板 `templates/主人确认-template.md` + 「主控建议 + 一句理由」预填（`:409-410`） |
| 决策留痕 | ✅ 「原话逐字 + 时间 + 落盘结论 + 修订轮次」写进 §6，**未回填 = 该闸门不算完成**（`:411`） |
| 主人往返成本最小化 | ✅ 微确认单（`:418`）、离场预案**预授权**（`:413-416`，三条件） |
| 数值约束上桌 | ✅ §8 数值约束 + 主人可当场变更（`:420`） |
| 机械校验 | ✅ `handoff-check --require-gates`（**A7**）验四门齐备 + §6 五字段（`handoff-check.mjs:43-45`） |
| 驳回后的最小重入集 | ✅ Phase 5 驳回 → 四类最小重入集表（`:423-430`） |

**并且方案遗漏的门，论衡也已处理**：G14 终闸第 2 轮仍 Fail → **报告主人手工润色**（`gates/14-中文AI痕迹-gate.md:54`、`pipeline-readme.md:936`），这本身就是一次 HITL 升级；A 轨第 3 轮 → Acknowledged Limitations（`glossary.md:258`）。

**LLMG-5 的锚点错误**：方案称改「§H5-H9 段」——`00-主控-扩展职责.md` 的 26 个二级标题（§一 ~ §二十六）中**没有 H5-H9**。该文件从无此节。

**若照方案加「断点门」的后果**：与 §二十一 构成**两套 HITL 真源**，直接违反「单一真源」；且方案要「5 个断点默认全开/全关」，而现实四门是**必到**（不得自动放行）——方案的方向是把**更强的约束换成更弱的**。

---

### LLMG-7 —— 规范-机械门对照表加行

方案触发条件是「新增/修改规范或机检门」。**LLMG-1~6 全驳 → 无新增规范可登记 → 本项连带驳回。**
（对照表本体 = `references/_shared/规范-机械门对照表.md`，189 行 / 44,042 字节，未改动。）

---

### LLMG-8 —— hygiene 规则① 扫描面扩面

方案称「扫描面只覆盖随包脚本，需扩到新建的非随包 .md / 新文件」。

**现场实据**：`scripts/_lib/hygiene/r01-syntax.mjs` 第 8-10 行逐字写着：

> `// v18.1.0 加一条：扫描集 = git 跟踪文件 ∪ 未跟踪但未被 ignore 的文件。理由（真实不对称）：`
> `// npm pack 按 package.json 的 files 白名单取盘上文件，包含尚未 git add 的新文件——`
> `// 即「新写的脚本能被打进发布物、却逃过规则①的语法检查」。`

代码面：`:20` 过滤 `.mjs`/`.js`、`:41` 播报含未跟踪计数。**规则① 早已实现方案要求**（且这是 v18.1.0 就补的）。
另：`repo-hygiene-check.mjs` 是**薄编排器**（`_lib/hygiene/rNN-*.mjs` 分规则），方案写的落点 `scripts/repo-hygiene-check.mjs` 规则① **在该文件里根本不存在**——规则① 在 `r01-syntax.mjs`。

---

### LLMG-9 / LLMG-10 —— 试点与 state 断言

LLMG-9 的对象是「跑试点验证 A+B 改造」；LLMG-10 依赖 LLMG-9 的结论。**A+B 无需改造 → 无对象 → 连带驳回。**

---

## §三、原方案的硬伤（三处事实性错误 + 一处纪律冲突）

| # | 类型 | 内容 |
|---|---|---|
| 1 | **锚点伪造** | 「§H5-H9 段」在 `00-主控-扩展职责.md` **不存在**（实为 §一~§二十六） |
| 2 | **锚点伪造** | 「`pipeline-readme.md` 新增 §6.x」——该文件用**中文序号**（§一~§二十余），无 `§6.x` 编号 |
| 3 | **落点错误** | 「`scripts/repo-hygiene-check.mjs` 规则①」——规则① 在 `scripts/_lib/hygiene/r01-syntax.mjs` |
| 4 | **纪律冲突** | LLMG-1/2/3 新建平行交接 schema ↔ `handoff-check.mjs:18`「**禁止新建第二份清单**」；LLMG-4/6 新建断点门 ↔ §二十一「单一真源」 |

**根因（值得记的一条教训）**：原方案是**先按外部框架（LangGraph）反推出「论衡该有什么」，再去写落点**——而不是**先读论衡现状、再判断缺什么**。于是落点靠「按常识推断的文件名 + 章节号」拼出来，必然漂。
**判据**：**外部框架借鉴类反哺报告，必须先做「现状核实」再写方案**；核实必须是**读文件 + 引行号**，不是回忆。

---

## §四、LangGraph 借鉴的净收益（如实陈述，避免过度否定）

方案整体驳回，**不等于**这轮阅读无价值。净收益有三条，但**都不需要改机制**：

1. **术语对齐（可用于对外说明与新人上手）**：论衡的「检索分片 + `--merge`」= LangGraph 的 channel + reducer；「§二十一 四门 + 确认单」= human-in-the-loop interrupt；「`/lunheng -resume <id>`」（`pipeline-readme.md:126`）= durable execution 的断点续跑；「`disproofs.jsonl` 刻意不分片」= 对 reducer 语义的**显式取舍**。这些是**同构**关系，可作为讲解材料。
2. **一处「差异」值得承认**：LangGraph 的 HITL 是**任意节点可插**（`interrupt_before/after`），论衡是**四门固定**。
   **但这是论衡的优点而非缺口**：论衡的四门是**强约束**（「必到、不得自动放行」），任意可插会把「必到」降级为「可绕」。**结论：保持现状。**
3. **一处可选的自查方向（本轮不立项）**：论衡的「阶段闸门」是**阶段级**；Phase 4 内部的 T7 打回轮次判定由主控裁定。是否需要在「A 轨第 2 轮用满、第 3 轮触发前」增设一个**主人可选**的介入窗口——属**论衡内部问题**，与 LangGraph 无关，**如需讨论应另起一份动议，且必须先核实现行「升级主控」的判据**。

---

## §五、本次改动的真实状态（可核对）

| 项 | 状态 |
|---|---|
| `SKILL.md` / `AGENTS.md` / `references/**` / `scripts/**` / `cordis.patch.yml` | **零改动** |
| 例外条款第①步「改前备份」 | ✅ 已执行 → `C:\Users\Zuoyunlai\.dsh\_backup\lunheng-2026-10-04\`（scripts / references / SKILL.md.bak / AGENTS.md.bak） |
| 探针文件 | ✅ 写入后已删除（`references/_shared/_guard-probe.md`），用于验证 `ctx.tools.guard()` 是否拦截本仓库路径写入 |
| **`ctx.tools.guard()` 实测结论** | **未拦截**——guard 只覆盖部署镜像路径，不覆盖本仓库源目录；故机制文件在本仓库**技术可写**（授权因此是唯一门槛，见 §零） |
| 本报告 | `audits/反哺报告-LLMG-A+B-核实结论-v1.md`（非机制文件，可自由落盘） |
| 原方案 | `audits/反哺报告-v18.79.0-LLMG-A+B改造.md` —— **已加「已作废」横幅**，保留作留痕 |

---

## §六、建议处置（交主人裁定）

| 选项 | 内容 | 说明 |
|---|---|---|
| **A（建议）** | **接受本核实结论，本批结案**，v18.79.0 **不发布**；原方案文件保留作「外部框架借鉴为什么会空转」的实例留痕 | 零风险、零改动 |
| **B** | 若主人认为「交接 JSON」确有独立价值（**超出** LangGraph 借鉴理由），**另起一份动议**，且必须先回答：它相对 `sources jsonl + disproofs.jsonl + 六要素回填` **新增了什么事实**？答不出则不进 | 需主人另下指令 |
| **C** | 若主人坚持按原方案落地 | 需主人**明确知悉**：将与 `handoff-check.mjs:18`「禁止新建第二份清单」及 §二十一「单一真源」冲突；主控将逐条标注冲突后再执行，并在交付说明中记为「主人授权的机制例外」 |

---

## §附录 · 复算命令（任何人可复核本报告的每条实据）

```powershell
Set-Location 'E:\HERNESS\lunheng-article-pipeline-dsh'
git rev-parse --short HEAD

# ① 机制文件零改动
git status --short -- skills lib cordis.patch.yml package.json

# ② LLMG-5 锚点证伪：该文件无 §H5-H9
Select-String -Path 'skills\lunheng-article-pipeline\references\agents\00-主控-扩展职责.md' -Pattern '^## ' -Encoding UTF8

# ③ LLMG-4 证伪：§二十一 四门已存在
Select-String -Path 'skills\lunheng-article-pipeline\references\agents\00-主控-扩展职责.md' -Pattern '人在环四节点触发清单' -Encoding UTF8

# ④ LLMG-1/2/3 证伪：禁止新建第二份清单
Select-String -Path 'skills\lunheng-article-pipeline\scripts\handoff-check.mjs' -Pattern '禁止新建第二份清单' -Encoding UTF8

# ⑤ LLMG-8 证伪：规则① 已含未跟踪文件
Select-String -Path 'scripts\_lib\hygiene\r01-syntax.mjs' -Pattern '未跟踪' -Encoding UTF8
Select-String -Path 'scripts\_lib\hygiene\r01-syntax.mjs' -Pattern "endsWith\('\.js'\)" -Encoding UTF8

# ⑥ A 路径证伪：typed 分片 + reducer 已存在
Select-String -Path 'skills\lunheng-article-pipeline\references\templates\sources-索引-template.md' -Pattern 'jsonl' -Encoding UTF8
Select-String -Path 'skills\lunheng-article-pipeline\SKILL.md' -Pattern 'sources-index' -Encoding UTF8

# ⑦ 备份在位
Get-ChildItem "$env:USERPROFILE\.dsh\_backup\lunheng-2026-10-04" | Select-Object Name,Length
```