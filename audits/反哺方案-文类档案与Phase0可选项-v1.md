# 反哺方案：文类档案（Genre Profile）与 Phase 0 可选项 — v1

> 生成时间：2026-10-03 ｜ 生成角色：主控（T0）｜ 性质：**反哺动议 → 已落地 v18.72.0（批 1 + 批 2 按主人授权 apply；批 3 永久不做）**
> 本文件是**新增的未跟踪文件**；未修改任何 tracked 文件，未触碰任何机制文件（`SKILL.md` / `AGENTS.md` / `references/**` / `scripts/**` / `cordis.patch.yml`）。
> 勘察对象 = 已安装 bundle：`C:\Users\Zuoyunlai\.dsh\profiles\desktop\node_modules\lunheng-article-pipeline\skills\lunheng-article-pipeline`（下文简称**包根**，行号均为其相对路径）。
> ⚠️ **apply 前须重钉基线**：本仓纪律「禁止凭旧记忆写行号」——下表行号取自本次实读的 bundle，仓库 HEAD 可能领先，逐项核对后再改。

---

## 0. 一句话结论

**能做成 Phase 0 可选项，但形态必须是「选一份档案」而不是「逐项勾开关」，且必须做成「既有开关的预置映射」而不是新机制。**

- 文类**不需要**新的闸门、新的 §6 字段、新的脚本：Phase 0 的提问口（§7）、数值可见化口（§8）、留痕口（§6）**都已存在**。
- 11 个受文类影响的开关里，**10 个已经有消费点**（脚本或角色卡真的读它），**只有 1 个是「文档有口径、代码无路径」**：M-Form-1 的文献下限「公众号/商业评论可降为 1、行业分析降为 2」。
- 所以落地分三批：**批 1 零脚本改动**（档案表 + Phase 0 交互）→ **批 2 只动一处**（M-Form-1 文类感知，用 CLI 旗标而非改 THRESHOLDS）→ **批 3 建议永久不做**（让脚本直接解析简报）。

---

## 1. 现状：文类在论衡里是「隐式」的

### 1.1 文类词表现状

包内**不存在**集中定义。文类名以**自然语言取值**散落在模板与角色卡里，且**两套词表不一致**：

| 出处 | 取值集合 |
|---|---|
| `references/templates/任务简报-template.md:38` | 课程论文 / 期刊投稿 / 学位论文章节 / 公众号长文 / 商业评论 / 行业分析 / 其他 |
| `references/templates/任务简报-template-lite.md:26` | 学术论文 / 商业评论 / 行业分析 / 公众号深度长文 |
| `references/glossary.md:368-372`（§八 适用边界） | 学术论文（社科/人文）/ 商业评论 / 行业分析 / 公众号深度长文 / **政策分析报告** |
| `references/_shared/期刊匹配算法.md:14` | 学术论文 / 商业评论 / 公众号 |
| `references/deliverables.md:64` | 学术投稿 / 商业评论 / 行业分析 / 公众号 |

**判读**：五处口径两两不同（政策分析报告只在一处出现；「学术论文」vs「课程论文/期刊投稿/学位论文章节」是粒度冲突）。这是文档层漂移，不是代码问题——但它是**新文类没有「登记处」**的直接表现。

### 1.2 受文类影响的 11 个开关（现状盘点）

| # | 开关 | 载体 | 消费点 | 类型 |
|---|---|---|---|---|
| 1 | 引用模式（编号 / 内联） | `任务简报-template.md:14` | `scripts/_lib/mgate-gates/mexist-gates.mjs`（M-Exist-1 双向对账） | 机器 |
| 2 | 引用格式（GB/T / APA / MLA / 内联） | `任务简报-template.md:105-106` | T5 写手卡 + `scripts/cite-format.mjs` | 机器（生成） |
| 3 | 字数口径 A / B | `references/_shared/字数判定表.md:13-14` | T7 / T8 双口径核验 | 人工 |
| 4 | 结构门 IMRaD / IMRaD-Alternate | `结构门` | `scripts/structure-check.mjs:4` 的 `--humanities`；`scripts/quality-score.mjs:6` 透传 | **CLI 旗标** |
| 5 | QLT（引用数量与质量控制） | `任务简报-template.md:124` | `scripts/g-audit-check.mjs:329` 读 `QLT=on/off` | 机器 |
| 6 | 投稿前最新进展补扫 | `任务简报-template.md:88` | `references/agents/01-文献检索-literature-scout.md:88` | 人工 |
| 7 | 文风档位（克制/中性/鲜明） | `任务简报-template.md:130` | T5 写手卡 | 人工 |
| 8 | 文末节（必需 5 节 / 学术 +4 声明） | `references/deliverables.md:64`、`scripts/_lib/sections.mjs:28` | `scripts/_lib/mgate-gates/mform-gates.mjs`（M-Form-7） | 机器 |
| 9 | T9 视角数（学术三视角 / 其他单视角） | `references/agents/09-审稿-peer-reviewer.md:298`、`glossary.md:85` | T9 派发 | 人工 |
| 10 | 期刊匹配开关 | `任务简报-template.md:67` | `scripts/_lib/mgate-gates/mexist-gates.mjs:794`（读简报「启用期刊匹配」） | 机器 |
| 11 | **M-Form-1 文献下限（3 / 2 / 1）** | `references/_shared/M-Gate-Algorithm.md:215` | **无** | **孤儿** |

> **判据**：第 11 行是全表唯一的孤儿——下面 1.3 事实 B 给证据。

### 1.3 四条硬事实（诊断依据）

**事实 A — 文类差异没有集中定义，且新文类无登记处。**
见 1.1 / 1.2：11 个开关散落在 6 个模板/文档 + 5 个脚本，跨 8 个文件；档案表不存在，受控词表不存在（对照：`范式标签` 是有受控词表的——`scripts/journal-fit.mjs:78`「受控词表 = quantitative/qualitative/theoretical/mixed/case」，说明本仓**会**做受控词表，文类只是还没做）。
**后果**：支持一个新文类时，「该改哪几个开关」靠主控临场记忆——漏配即产生假 P0。

**事实 B — 「公众号/商业评论可降为 1、行业分析降为 2」这条口径在代码里不存在。**
- `scripts/m-gate-check.mjs:239`：`mform1MinL: 3`，在 `Object.freeze` 的 `THRESHOLDS` 里。
- `scripts/_lib/mgate-gates/mform-gates.mjs:81-104`：`mForm1(ctx)` 只读 `ctx.THRESHOLDS.mform1MinL`，**无文类参数、无内联分支**，且 `L_count === 0` 直接 P0、`L_count < min_L` 亦 P0。
- `scripts/m-gate-check.mjs:309`：`refRe = /\[(L|D|C-主|C|先)\d+...\]/g` 是**固定正则**——内联（机构，年份）模式下的引用**不被它匹配**。
- 全库 grep `mform1MinL` 仅 4 处：定义（`:239`）、使用（`mform-gates.mjs:85`）、`--dump-thresholds` 自解析（`m-gate-check.mjs:80`）、仓库面自检（`_lib/cc-rules/repo-surface-rules.mjs:180`）。**没有任何地方按文类改写它。**
**后果**：内联模式的稿件（公众号/商业评论/行业分析/第三方报告）在 M-Form-1 上**按学术论文的阈值被判**。文中那句「可降为 1/2」是**没有机器路径的口径**（文档写了、代码没接）。

**事实 C — 本仓已因文类吃过假 P0，且修法是「收窄正则」而非「引入文类维度」。**
`scripts/_lib/mgate-gates/mexist-gates.mjs:73-87` 原文记录：旧式非标准编号正则在 `[COVID-19]` / `[GPT-4]` / `[B2B-2]` 上**全部误判**，而「本包支持『行业分析 / AI 产业评论』类选题，正文出现 `[GPT-4]`/`[COVID-19]` 是**必然**」→「M-Form-1 转 P0 → 整体 exit 2 → 按 AGENTS.md『M 门 exit 0 才返回』只能走 Acknowledged Limitations，等于**对一整类选题硬性阻断**」。
**判读**：这是同一类病灶的既往发作。当时的处置是打补丁收窄正则（代价如实记录为「`[GPT-4]` 这类真引用游离于闭环之外」）。**说明文类是新文类接入的复发点，不是一次性问题。**

**事实 D — 简报 → 机检的接口是 6 处零散正则，不是结构化字段表。**
`任务简报.md` 被脚本读取的位置（穷举）：

| 位置 | 读什么 |
|---|---|
| `scripts/_lib/mgate-gates/mexist-gates.mjs:794` | `/启用期刊匹配/` |
| `scripts/_lib/mgate-gates/mintegrity-gate.mjs:62,89` | 「需找数据点 ≥N」子问题 |
| `scripts/_lib/mgate-gates/mform-gates.mjs:428,443,820` | 承重墙机读声明 + 图位数量 |
| `scripts/g-audit-check.mjs:174,329` | `BUF=on/off`、`QLT=on/off` |
| `scripts/_lib/target-chars.mjs:33` | 目标字数 |
| `scripts/apply-revision-cycle.mjs:143` / `apply-compression-cycle.mjs:72` | 目标字数（判 G8 硬阈） |

**判读**：新增一个机器可读字段的成本**不是「加一行」，而是「再加一处零散正则」**。这直接否掉了批 3（见 §6）。

---

## 2. 设计原则（先钉约束，再谈方案）

| # | 约束 | 来源 / 判据 |
|---|---|---|
| P1 | 档案表的**每一列必须已有消费点**；不接受「先登记后接线」 | 反孤儿纪律：`scripts/_lib/cc-rules/content-rules.mjs:523-524`（「本门看不到任务简报，一律要求会造假阳性」——宁可不判也不造孤儿） |
| P2 | **不新增独立机制**，全部复用已闭环的必经节点 | 主人 2026-10-03 定案（论衡流水线立场锋芒注入修订规则） |
| P3 | **不动 §6**「主人回复」 | `scripts/handoff-check.mjs:511` `GATE_FIELDS = ['主人原话','回复时间','提问方式','主控落盘结论','轮次计数']`，A7 按**字段名**硬校验，改 §6 = 碰闸门代码 |
| P4 | **不碰 `THRESHOLDS` 自动块** | `m-gate-check.mjs:80-93` `--dump-thresholds` 单向生成 `M-Gate-Algorithm.md` 的 THRESHOLDS-AUTO 块；`repo-surface-rules.mjs:180` 读该块；跨文档一致性门 ㉓ 盯着它 → 改它牵动三条自动链 |
| P5 | 档案取值必须**受控**，不得引入新档位 | 防止档案退化为「绕过闸门的后门」（本仓反复总结的形态：判据要落在留痕上） |

---

## 3. 方案总览：三层

```
L1  文类档案表（新增 references/_shared/文类档案.md）
    └─ 单一真源：文类 code → 11 个既有开关的取值
L2  派发契约（写进主控 Phase 0 动作）
    └─ 主控读档案 → 把派生值写进「既有字段」，不改字段名、不加字段
L3  Phase 0 交互（复用 §7 提问 / §8 可见化 / §6 留痕）
    └─ 一问选档案 → §8 列展开结果（可当场改）→ §6 逐字留痕
```

**没有任何一层引入新脚本、新闸门、新字段名。**

---

## 4. L1 文类档案表（建议稿）

列 = **1.2 表的 11 个开关**，一格不改、一名不加。取值全部落在既有档位内。

| code | 代表场景 | 引用模式 | 引用格式 | 字数口径 | 结构门 | `--qlt` | 补扫 | 文风档 | 文末节 | T9 | 期刊匹配 | 文献下限 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `academic-cn` | 期刊投稿（社科） | 编号 | GB/T 7714 | A | IMRaD | on | 默认即跑 | 克制 | 9 节 | 三视角 | 默认启用 | 3 |
| `academic-hum` | 期刊投稿（人文） | 编号 | GB/T 7714 | A | **IMRaD-Alternate** | on | 默认即跑 | 克制 | 9 节 | 三视角 | 默认启用 | 3 |
| `academic-case` | 案例研究型 / 质性论文 | 编号 | GB/T 7714 | A | IMRaD＋识别策略 | on | 默认即跑 | 克制 | 9 节 | 三视角 | 默认启用 | 3 |
| `tech-report` | 理工科论文 | — | — | — | — | — | — | — | — | — | **不适用**（官方明列 5 类不适用之一） | — |
| `course` | 课程论文 / 学位论文章节 | 编号 | GB/T / APA | A | IMRaD | off | 默认即跑 | 克制 | 9 节 | 单视角 | 关闭 | 3 |
| `lit-review` | 研究述评 / 综述 / 年度盘点 | 编号 | GB/T / APA | A | IMRaD-Alternate | on | 默认即跑 | 中性 | 9 节 | 三视角 | 可选 | 3 |
| `book-review` | 学术书评（长，≥3000 字） | 编号 | GB/T / 内联 | A | Alternate / 不跑 | off | 默认即跑 | 中性 | 5 节 | 单视角 | 关闭 | 2 |
| `policy` | 政策分析报告 / 咨政报告 | 内联 | GB/T 或简化内联 | A | IMRaD-Alternate | off | 默认即跑 | 中性 | 5 节 | 单视角 | 关闭 | 2 |
| `report-3rd` | 第三方研究报告 / 独立白皮书 | 内联 | 内联 | B | 不跑（记 N/A） | off | 关闭 | 中性 | 5 节 | 单视角 | 关闭 | 1 |
| `biz-review` | 商业评论 | 内联 | 内联 | B | 不跑（记 N/A） | off | 关闭 | 中性 | 5 节 | 单视角 | 关闭 | 1 |
| `industry` | 行业分析 | 内联 | 内联 | B | 不跑（记 N/A） | off | 关闭 | 中性 | 5 节 | 单视角 | 关闭 | 2 |
| `wechat` | 公众号深度长文 | 内联 | 内联 | B | 不跑（记 N/A） | off | 关闭 | **鲜明** | 5 节 | 单视角 | 关闭 | 1 |

**四类刻意不进档案**（写「不适用」而不是写配置）：
- **理工科论文**（需数学推导 / 实验设计）、**文学创作**（小说/诗歌/剧本）、**抢时效新闻快讯**（<24h）、**营销软文**——`glossary.md:374-379` 官方明列的 5 类不适用，其中前三类 + 第 5 类「需一手数据而主人未提供」。**档案表是准入清单，不是万能表**：把不适用项写进表里等于给它们开准入通道。

**「不跑（记 N/A）」不是新机制**：`quality-score.mjs:189-191` 已有既有路径——无 IMRaD 节且未传 `--humanities` → structure 分量**如实记 N/A**，降价分母并给 `coverageWarning`，**不给 0 分**。档案只是**指定**走这条已有分支。

---

## 5. L2 / L3：Phase 0 可选项怎么做（**结论：能，且形态已由既有接缝决定**）

### 5.1 三条「不需要新机制」的理由

| 需要的能力 | 已有接缝 | 证据 |
|---|---|---|
| **提问** | Phase 0 闸门本来就用 `ask_user_question`，且模板已定「一问即可 / 选项 ≤5 / 第一个是主控建议」 | `references/templates/主人确认-template.md:77-82` |
| **数值可见 + 当场可改** | §8「本门生效的数值约束」表**明文**「主人可当场变更，变更即留痕」「无相关数值时写『本门无生效的数值约束』，不留空」——文类档案正是数值约束的容器 | `主人确认-template.md:92-104` |
| **留痕** | §6 逐字记录主人回复；**A7 只校验那五个字段名「存在」**，不排斥内容里出现文类信息 | `主人确认-template.md:62-73` + `handoff-check.mjs:511,531` |

> **为什么不能加字段到 §6**：`handoff-check.mjs:531` 按**字段名**硬校验 `GATE_FIELDS`；A7 是 `--require-gates` 下交付前最后一道硬门（缺门 20 / §6 未回填 21）。往 §6 塞新字段属于「碰闸门代码」，与 P3 冲突。**而文类选择本来就不属于「主人回复的五要素」，它属于「本门生效的数值约束」——放 §8 是语义正确的落点，不是凑合。**

### 5.2 交互形态（建议稿）

**① 提问**——`ask_user_question` 一问，选项 ≤5（§7 既有约束），超出走两级：

```
header: Phase 0 定题
question: 本文文类？（决定引用模式/结构门/字数口径/T9 视角等 11 项预置）
① 学术论文 · 社科实证（推荐）   → academic-cn
② 学术论文 · 人文/理论          → academic-hum
③ 案例研究型 / 质性论文          → academic-case
④ 非学术深度长文（评论/行业/公众号/政策/第三方报告） → 二级问
⑤ 其他（我会补充说明）
```

二级问（仅在选项④时）沿用同一表单选：政策分析报告 / 第三方研究报告 / 商业评论 / 行业分析 / 公众号深度长文。

**② 回填**——主控把 code 写进 `01-任务简报.md` 的**「论文类型」既有字段**（`任务简报-template.md:38`），并把它在该字段的**受控取值**上加括号标注，例如：

```
- **论文类型**：期刊投稿（academic-hum）
```

> **关键**：**不新增字段名**。档案 code 是既有字段的**受控取值**，不是新字段。这样机器侧不需要新正则（它是给人读的），而「受控」保证 T2.5/T7 复核时口径一致。

**③ 展开**——主控按档案表把派生值写进那 11 个既有位置（引用模式行、字数口径、`--humanities` 的使用、`QLT=`、`BUF=`、文风档、T9 视角、期刊匹配开关、补扫开关）。

**④ 可见化**——在 `阶段确认-Phase0.md` §8 加一行（**填表，不是改机制**）：

| 数值 | 当前读数 | 本门是否受限 | 主人是否变更 |
|---|---|---|---|
| 文类档案 | `academic-hum`（展开：编号 / GB-T / 口径A / IMRaD-Alternate / QLT=on / 补扫=开 / 克制 / 9节 / 三视角 / 期刊匹配=启用） | 是 | 不变 / 改为 … |

**⑤ 留痕**——§6 照旧逐字记录主人原话（主人若说「按人文论文那档走」，原话里就带文类信息，天然留痕，**无需新字段**）。

### 5.3 为什么不做「11 项逐项勾选」

- 与 §7 既有约束冲突（「一问即可」「选项 ≤5」），逐项问要 11 问；
- 把**文类决策**退化成**配置负担**——主人要说的是「这是篇人文论文」，不是「我要 IMRaD-Alternate 且 QLT=on」；
- **档案 = 预设 + 可覆盖**（§8 允许当场改任一项）才是符合既有 UX 的形态：**默认值给机制，例外给主人。**

---

## 6. 三批落地

| 批 | 内容 | 改动面 | 风险 | 建议 |
|---|---|---|---|---|
| **批 1** | 新增 `references/_shared/文类档案.md`（L1）＋ 任务简报「论文类型」字段加受控取值说明 ＋ Phase 0 提问话术 ＋ §8 加一行示例 | 新增 1 份文档 + 2 处模板文字 | **0**（不动脚本、不动 §6、不动 THRESHOLDS） | **做** |
| **批 2** | M-Form-1 的文类感知（事实 B 的修法） | `m-gate-check.mjs` 加 CLIm 旗标 + `mform-gates.mjs` 的 `mForm1` 读它 | 中（碰脚本与解析） | **条件做** |
| **批 3** | 让脚本直接解析简报的 `GENRE=` | 再加一处零散正则（事实 D） | 低但**收益为负** | **建议不做** |

### 批 2 的形态建议：**CLI 旗标 `--genre <code>`，不要改 `THRESHOLDS` 表**

```
node scripts/m-gate-check.mjs <定稿.md> <证据包目录> [--genre <code>]
```

- `mForm1` 的 `min_L` 取档案值；**缺省 = 3**（向后兼容，既有项目与既有报告零影响）。
- 与既有先例同构：`structure-check.mjs:4 --humanities`、`g-audit-check.mjs --qlt`、`handoff-check.mjs --require-gates` —— 全是「模式开关走 CLI 旗标」；`_lib/cli-args.mjs` 已有严格解析器。
- **不塞进 `THRESHOLDS` 的理由**（P4）：`mform1MinL` 在 `--dump-thresholds` 单向生成的文档块里、被 `repo-surface-rules.mjs:180` 读取、被跨文档一致性门 ㉓ 盯着——**加一个 `mform1MinLByGenre` 对象进去，会同时影响文档生成与非对象形态的自解析正则**（`m-gate-check.mjs:85` 的正则只认 `(\w+):\s*([0-9.]+),` 数值，遇对象/字符串会**静默少生成一行**）。旗标路径把这些自动链全部绕开。

### 批 3 为什么建议不做

事实 D 已证：简报→机检已有 6 处零散正则。**再加一处不解决问题，只是让「零散」多一处**；而「主控读档案 → 展开成既有字段」在 L2 层已经闭环，脚本侧不需要知道文类。**能在人这一层闭环的，不要下沉到正则层。**

---

## 7. 风险与边界（如实）

1. **孤儿机制风险**（最高）。档案表列了没有消费点的列 = 孤儿。本方案已据此把表压到 11 列，且 10 列有消费点、第 11 列正是批 2 的对象。**若批 1 落地而批 2 不做，第 11 列应显式标「文档口径，代码未接」而不是留白**——留白会被读成「已生效」。
2. **档位后门风险**。档案值必须受控：引用模式 ∈ {编号, 内联}、结构门 ∈ {IMRaD, IMRaD-Alternate, 不跑}、文献下限 ∈ {1,2,3}。**不得出现 `文献下限 = 0`** 或 `结构门 = 跳过` 之类的开关式豁免——那是把配置变成绕过闸门。要给豁免，走既有的 `WAIVER=on`（`字数判定表.md:69`）与 Acknowledged Limitations。
3. **双维护漂移风险**。档案表一旦落地即为「文类↔取值」的**唯一真源**；1.1 里那 5 处文档口径必须**改成指针**（本仓已多次因「同一事实两处维护」付费，见 `字数判定表.md:53-56` 的口径变更留痕清单）。
4. **批 2 不做的代价（如实）**：内联模式稿件在 M-Form-1 上仍按 `min_L=3` 判。我的判断是——**仅当非学术文类要作为常规产品线时**才值得动；偶发一两篇可在 Phase 0 用 §8 变更数值或 Acknowledged Limitations 处置，不必为此改脚本。
5. **本报告自身的边界**：① 全部行号取自本次实读的 bundle（版本头混杂：`SKILL.md` 为 v18.62.9、模板为 v18.69.0 —— 这本身体现仓内版本号漂移，**不影响本方案结论**，但 apply 前须重钉基线）；② 事实 B/C/D 均为代码级证据，可直接复核；③ 文类档案的**列取值**是建议稿，`--qlt`、补扫、T9 视角这三列的按文类默认值**以主人判断为准**（它们目前没有「按文类的成文规定」，是我按官方适用边界与既有条文推导的）。

---

## 8. 需要主人决策（三项）

- [ ] **D1 批 1 是否 apply？**（零脚本改动；但 `references/**` 属机制文件，须主人在 host shell 执行，我不得 write/edit）
- [ ] **D2 批 2 做不做？** 若做，形态选 ① `--genre` CLI 旗标（我推荐，见 §6）还是 ② 改 `THRESHOLDS` 表（我不推荐，理由 §6 P4）
- [ ] **D3 受控词表就按 §4 的 11 个 code？** 是否精简（例如 `course` / `lit-review` / `book-review` 三段合一为 `academic-*` 变体，或反过来把 `policy` 再拆「咨政内参 / 公开政策分析」）

---

## 附录 A 证据索引（可逐条复核）

包根 = `C:\Users\Zuoyunlai\.dsh\profiles\desktop\node_modules\lunheng-article-pipeline\skills\lunheng-article-pipeline`

| 结论 | 证据 |
|---|---|
| 文类词表 5 处不一致 | `references/templates/任务简报-template.md:38`、`-lite.md:26`、`references/glossary.md:368-372`、`references/_shared/期刊匹配算法.md:14`、`references/deliverables.md:64` |
| `academic-hum` 的既有开关 | `scripts/structure-check.mjs:4`（`--humanities`）、`:74`（`IMRAD_ALT_SECTIONS`）、`:154`（mode 字符串）；`scripts/quality-score.mjs:189-200`（N/A 与透传） |
| QLT 机器标记 | `任务简报-template.md:124-125`；`scripts/g-audit-check.mjs:329,351,424` |
| BUF / WAIVER 机器标记 | `字数判定表.md:66-76`；`scripts/g-audit-check.mjs:174,184-195` |
| 字数口径 A / B | `字数判定表.md:13-14`；`scripts/count-chars.mjs` |
| 文末 5 必需 / 9 节顺序 | `deliverables.md:63-82`；`scripts/_lib/sections.mjs:25-29` |
| T9 视角数按文类 | `references/agents/09-审稿-peer-reviewer.md:298`；`glossary.md:85` |
| 期刊匹配开关被脚本读 | `scripts/_lib/mgate-gates/mexist-gates.mjs:784-805` |
| A7 硬校验 §6 五字段 | `scripts/handoff-check.mjs:495-497,511,523,531,546,553` |
| §7 提问约束 / §8 数值约束 | `references/templates/主人确认-template.md:77-82` / `:92-104` |
| THRESHOLDS 单一真源与自动生成 | `scripts/m-gate-check.mjs:60-94,238-256`；`scripts/_lib/cc-rules/repo-surface-rules.mjs:180` |
| M-Form-1 无文类分支 | `scripts/_lib/mgate-gates/mform-gates.mjs:81-104`；`scripts/m-gate-check.mjs:309`（固定 `refRe`） |
| 既往文类假 P0 与处置 | `scripts/_lib/mgate-gates/mexist-gates.mjs:73-87` |
| 官方适用/不适用边界 | `references/glossary.md:366-379` |
| 范式标签受控词表先例 | `scripts/journal-fit.mjs:74-78,157` |

## 附录 B 未采用的替代方案（逐项给否掉的理由）

| 替代方案 | 否掉理由 |
|---|---|
| **新增文类专属闸门 / 角色** | 违反 P2（不新增独立机制）；且新闸门要有必经调用路径，否则即孤儿 |
| **给 §6 加「文类」字段** | 违反 P3：A7 按字段名硬校验 `GATE_FIELDS`，改 §6 即碰交付前硬门代码 |
| **把文类档案写进 `THRESHOLDS`** | 违反 P4：该块被 `--dump-thresholds` 单向生成文档、被 repo-surface 自检读取、被一致性门 ㉓ 盯；且自解析正则只认数值，加对象会**静默少生成行** |
| **让脚本直接解析简报 `GENRE=`** | 事实 D：再加一处零散正则；L2 层已闭环，下沉无收益（= 批 3） |
| **把不适用文类也写进档案表（值置空）** | 档案表是准入清单，写进去等于开准入通道；不适用项应在档案表外用 `glossary.md` 的 5 类负面清单拦 |
| **11 项逐项勾选** | 与 §7「一问即可 / ≤5 选项」冲突；把文类决策退化为配置负担 |
| **按文类放宽 G14 / 字数硬阈** | 这两项是**质量闸**不是**体例闸**，文类不改变「文本该不该像人写的」「篇幅该不该达标」；放宽即 P5 的档位后门 |
