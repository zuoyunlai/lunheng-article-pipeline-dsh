# 修订计划 — context-mode 外部借鉴落地（v1）

> 报告时间：2026-09-29
> 产出者：主控 T0（依据主人指令「并入上一份报告，整合分析后制定一个详细的修订计划，成文落盘」）
> 依据（两份，本计划是其整合出口）：
> ① [`反哺报告-context-mode借鉴评估-v1.md`](反哺报告-context-mode借鉴评估-v1.md) —— §三 A 档 4 项 / §三 B 档 5 项 / §三 C 档 7 项驳回 / §五 本地已做对 7 项；§九「零 exec」专项复核（含 EXEC 族 4 项）
> ② 本计划 §五 的**逐文件词预算实测量**（本计划新增，报告内无）
> 基线：本地 `lunheng-article-pipeline-dsh` HEAD `1214364` / `master` / 技能 v18.53.0
> 动议性质：机制级改进动议（**只产出，不自动修改任何机制文件**）——落地须主人显式授权后按 `AGENTS.md` 例外条款执行
> 与报告的关系：报告负责「判断该不该做」，本计划负责「**怎么做、按什么顺序、每步怎么验、怎么回滚**」

---

## §零、性质、边界与授权口径

1. **本计划零改动**：未修改 `SKILL.md` / `AGENTS.md` / `references/**` / `scripts/**` / `cordis.patch.yml` 任何一个字节（实测 `git status --short -- skills lib cordis.patch.yml package.json` 为空）。
2. **授权判据**（`AGENTS.md` §文件修改操作约束）：**agent 自发改进 = 禁写（只出反哺报告）；主人明确下令 = 可写（走安全流程）**。本计划属前者，落地须后者。
3. **改动位置判据**（`AGENTS.md` 例外条款 ⑤，教训 #153）：机制 / 角色卡 / 脚本 / 模板的改动**一律在真源仓库里做**（`<repo>/skills/lunheng-article-pipeline/`——那里才有 `tests/` 与两道仓库门），四道门全绿、提交之后**再同步到部署镜像**。**不要反过来**。
4. **编号命名空间**：报告已占用 `A1-A4` / `B1-B5` / `C1-C7` / `D1-D7`；本次新开 **`EXEC-` 族**（执行边界与口径收口）。**撞号实测见 §一**。
5. **主人定案（2026-09-29）**：EXEC-1 方向已裁定为「**写实值、权威 = `manifest.json`、无需主人回填**」——**汇总见 §十一**（含派生决策点）。本计划其余各项仍待主人授权。

---

## §一、编号族可用性（实测，非推断）

| 前缀 | 全库命中 | 判定 |
|---|---|---|
| `MEA-` | 99 | 已占用（v18.22.0 测量与口径族） |
| `CTX-` | 100 | 已占用（v18.22.0 上下文族） |
| `EFF-` | 127 | 已占用（v18.22.0 效率族） |
| `QLT-` | 238 | 已占用（质量族，已到 QLT-6） |
| `EXT-` | 65 | **假阳性**——`Select-String` 大小写不敏感，命中的是 SVG `text-anchor`。**语义易混，勿用** |
| `ADR-` | 9 | **仓库内实为 0**——9 处全部来自本报告自身。**可用** |
| `GOV-` | 0 | 可用 |
| **`EXEC-`** | **0** | **本计划选用（执行边界与口径）** |

> **DoD 步骤**：落地前重跑 §附录 的复算命令确认 `EXEC-` 仍为 0；若已不为 0，改用 `GOV-`。

---

## §二、改动项总表（一页看完）

| ID | 项 | 落点文件 | 门内? | 余量 | 预估成本 | 批 |
|---|---|---|---|---|---|---|
| **EXEC-1** | `sha256` 回填口径定案（**19 处 / 10 文件**，含模板本体与 T8 卡——见 §11.3） | `M-Gate-Algorithm.md` ×10 ／ `deliverables.md` ／ `SKILL.md` ／ **`templates/交付说明-template.md`** ／ **`08-终检-finalizer.md`** ／ `00-主控-扩展职责.md` ×2 ／ `规范-机械门对照表.md` ／ `QUICKSTART.md` | ✅×6 ❌×4 | 见 §11.3 表 | **1~1.5 天** | **0** |
| **EXEC-2** | `SKILL.md:24`「默认零 exec」措辞与 glossary 对齐 | `SKILL.md` | ✅ | 1,601 | 10 分 | **0** |
| **EXEC-3** | `M-Exist-7` 诊断措辞补「实值 sha256」**＋（待 §11.2 定案）同批收紧正则** | `mexist-gates.mjs` | ❌ 脚本 | — | 20 分 / **半天**（若选收紧） | **0** |
| **EXEC-4** | 实核「T5 无脚本执行能力」并改述注释 | `segment-chars.mjs` | ❌ 脚本 | — | 1 时 | **0** |
| **A3** | 计量口径变更固定动作 | `maintainers.md` | ✅ | 1,724 | 1 时 | 1 |
| **A4** | 「转述仍算计费」反模式条目 | `errors.md` | ❌ | — | 10 分 | 1 |
| **B1** | 阈值显式化（`>N 行 → 动作`） | `交接报告-template.md` + `dispatch-cards.md` | ❌×2 | — | 30 分 | 1 |
| **B2** | 一次调用问全部（批量查询纪律） | `dispatch-cards.md` | ❌ | — | 30 分 | 1 |
| **B3** | 检索式批量纪律 | `_shared/外部检索源接入面.md` | ✅ | 2,349 | 20 分 | 1 |
| **B5** | 反模式文档形态（先核后改） | `errors.md` / `failure-modes.md` | ❌×2 | — | 1 时 | 1 |
| **A1** | 决策记录（ADR）形态 + 补写 3 条历史决策 | 新建 `audits/decisions/` + `maintainers.md` 指针 | ❌（目录） | — | 1.5 天 | 2 |
| **B4** | 昂贵验证护栏（含刻意偏离判据） | `maintainers.md`（与 A3 同批） | ✅ | 1,724 | 1 时 | 2 |
| **A2** | 捕获层反向门（先卡后门） | `检索注入防御.md` + `素材加载清单-template.md` | ❌×2 | — | 半天 | 3 |
| **A2b** | （可选）反向机检判据 + tests | `m-gate-check.mjs` + `tests/` | ❌ 脚本 | — | +1 天 | 3 |

**明确不做**：报告 §三 C 档 7 项（多宿主 / MCP server / FTS5-SQLite / 零 exec 哲学 / 跨会话画像 / 省 token 百分比宣称 / 拦截层）。理由见报告 §三 C 档与 §四.3。

---

## §三、分批与依赖顺序

```
批 0（口径收口 · 活体矛盾）  ← 必须先做，与其余各项无依赖
  EXEC-1 ─┬─ 三处同步（M-Gate / deliverables / SKILL）
          └─ 前置核查：manifest.json 与「证据包指纹」段的职责关系
  EXEC-2（同文件 SKILL.md，与 EXEC-1 同批合并计字节）
  EXEC-3（诊断措辞）
  EXEC-4（先实核，再改述）

批 1（文档与措辞 · 零脚本、零机检契约变更）  ← 依赖：无。可与批 0 并行
  A3 + B4（同落 maintainers.md，合并抬棘轮）
  A4 + B5（同落 errors.md，先核形态）
  B1 + B2（同落 dispatch-cards.md）
  B3（落 _shared/外部检索源接入面.md）

批 2（决策记录形态 A1）  ← 依赖：批 1 的 A3（先把「口径变更固定动作」立起来，ADR 才有的可引）
  新建 audits/decisions/ + ADR-template.md + maintainers.md 指针
  补写 3 条历史决策（exit 10 收口 / handoff 20·21·22 与 M 门 1·2·3 分离 / 写盘安全网 tmp+rename+bak）

批 3（捕获层反向门 A2）  ← 依赖：**先跑 1 个实战项目试点**
  卡 + 模板（半天）→ 试点 → 再定是否加 A2b 机检（+1 天）
```

> **为什么 EXEC 族必须最先**：它不是「借鉴 context-mode」，而是本次复核在论衡自身查出的**正在生效的口径冲突**——`sha256 回填` 在三份文档里给出两个互斥答案，且 `M-Gate-Algorithm.md` 内部自相矛盾（报告 §九.4）。**任何一次真实交付都会依据其中一处写出结果，而另两处会判它不合。**「止血」优先于「改进」。

---

## §四、逐项改动规格

> **通用约定**：改前先 `wc -l` 记行数基线 + 备份；改中 `edit` 精确匹配；**禁 `sed -i`**；Δ 为**预估**，**逐处实测后按定案 ① 公式核定上限**（公式 = 「实测 + 1.5 KB 向上取整到整 KB」）。

### 批 0 · EXEC 族（执行边界与口径收口）

#### EXEC-1 `sha256` 回填口径定案（**P0 级 · 活体矛盾**）

- **矛盾事实**（报告 §九.4，逐处已核）：
  - `M-Gate-Algorithm.md:825` 说主控**不能**算 → 用 `read` 推理验证
  - `:826` 说 DSH 下**可直接算、不必留占位符**
  - `:827-833` 又要求**生成占位符**并注明「不是 agent 计算结果」 ← **与 `:826` 直接冲突**
  - `deliverables.md:122`「**agent 不执行 sha256**」；`SKILL.md:31`「由主人在 host shell 回填」
- **前置核查（必做，否则定案可能建立在过时假设上）**：`build-evidence-bundle.mjs:332` 自述「M-Exist-2 据此复算」、`:280` 自述「M-Exist-7 只核占位符出现了没有」。须先确认：
  1. `manifest.json`（`:287,302,314-331`，逐文件 sha256 + `auditTargetSha256`）是否已**完全取代**「交付说明 §证据包指纹」段的用途；
  2. 若已取代 → 「证据包指纹」段应写 **`manifest.json` 的实值/指针**，而非独立哈希（否则就是「同一事实两处维护」，撞本地教训 #156）。
- **✅ 定案（2026-09-29 主人裁定，**已锁定**）**：
  > **「证据包指纹」段写实值，权威真源 = `final/证据包/manifest.json`。主人不参与回填——`[哈希校验待主人回填]` 占位符路径废弃。**
  >
  > 执行口径：主控在 T8 终检跑 `build-evidence-bundle.mjs`（**本已是必做步骤**）→ 该脚本 `:302,314-331` 已逐文件算好 sha256 与 `auditTargetSha256` → 主控把这些**实值**写进 `交付说明.md` §证据包指纹，并在段内写明权威真源 = `manifest.json`。
  >
  > **判据**：交付说明的指纹段**不含**任何 `待主人回填` 字样；且其哈希值与 `manifest.json` 逐条一致（可通过 `M-Exist-2` 复算）。
- **⚠️ 由定案派生的新决策点（见 §十一）**：定案要**生效**而非仅**声明**，机检必须同批收紧——否则占位符仍是**可通过路径**，行为不变（本地教训 #139「规范从文档层到执行层断链」的同型）。
- **改动落点**：**以 §11.3 的全量普查表为唯一施工清单（19 处 / 10 文件）**——本节原写的「三处」是**定案前的低估**，已被实测推翻。
  三条最容易漏、且漏了就会「修不完」的落点，单列如下：
  1. **`templates/交付说明-template.md:91-92`（模板本体）** —— 每个交付件都照抄它；不改则新交付件**由构造即物化废弃口径**。
  2. **`08-终检-finalizer.md:28`（T8 执行卡）** —— 同一句内前半「不得留 `<…>` 占位符」、后半「证据包指纹**须保留**占位符」，**自相矛盾且直接决定 T8 行为**。
  3. **`M-Gate-Algorithm.md:1013 / 1157 / 1175 / 1192 / 1209`** —— 阈值总表（可能须改脚本而非文本）+ 伪代码两条 + M-Integrity-2 步骤 4；只改 §M-Exist-2 的散文段**不会**改变算法行为。
- **预估 Δ 与棘轮动作**（**实测后按公式核定**）：

  | 文件 | 实测 | 上限 | 余量 | 预估 Δ | 预估改后余量 | 动作 |
  |---|---|---|---|---|---|---|
  | `M-Gate-Algorithm.md` | 104,310 | 106,496 | 2,186 | +150 | 2,036 | ≥1,536 → **无需抬升**（若实测 Δ≥650 B 则抬） |
  | `deliverables.md` | 22,262 | 23,552 | **1,290** ⚠️ | +80 | 1,210 | <1,536 → **须抬至 24,576 B**（24 KB） |
  | `SKILL.md` | 39,359 | 40,960 | 1,601 | +80（含 EXEC-2） | 1,521 | 临界 → **建议一并抬至 40,960 B**（按公式同值，若实测 Δ>65 B 必须抬） |

- **判据**：① 三处口径**逐字可比**（无互斥表述）；② `node scripts/m-gate-check.mjs` 对本次改动**无回归**（exit 码与改前一致）；③ `mexist-gates.mjs:895-896` 正则对**实值形态**仍放行（已实测：放行）。
- **回滚**：`git checkout -- <三个文件>` + 棘轮回退（棘轮表现在 `repo-hygiene-check.mjs` 的 `DOC_BUDGET`，同属机制文件，一并回滚）。

#### EXEC-2 `SKILL.md:24` 措辞与 glossary 对齐

- **现文**（`:24` 表格单元格节录）：「…**主流程默认零 exec**（白名单脚本见「执行能力边界」）；Linux 上为 `bash`——**具体工具集以当前会话工具清单为准**」
- **问题**：同一句既称零 exec 又指向白名单；且与 `glossary.md:307,316`、`checkers/中文AI痕迹-checker.md:221`、`_shared/format-export.md:74` **四处相反**（报告 §9.1/§9.2）。
- **改法**：改为与 glossary **同口径**的表述，例如「主流程为**受限 shell（非零 exec）**——白名单脚本见「执行能力边界」；…」。
- **预估 Δ**：+10~25 B。与 EXEC-1 同文件，**合并计字节与棘轮**。
- **判据**：全库 grep `默认零 exec` → 0 命中（或仅剩**带否定的**引用，如「非『零 exec』」）。

#### EXEC-3 `M-Exist-7` 失败诊断措辞

- **落点**：`scripts/_lib/mgate-gates/mexist-gates.mjs:896`（**脚本，不在词预算门内**）
- **现文**：「`缺「证据包指纹」段或 sha256 占位符 \`[哈希校验待主人回填]\`（M-Integrity-2 步骤 4 的输入）`」
- **问题**：正则（`:895`）同时接受**实值**（`sha256[:：]?\s*[0-9a-f]{16,}`）与占位符，但**失败诊断只点名占位符**——按 EXEC-1 定案写实值的执行者，一旦失败会收到一条指向错误方向的提示。
- **改法**：诊断消息补「**或实值 `sha256: <hex16+>`**」。
- **成本**：20 分钟。**风险：改脚本须重跑相关 tests。**
- **判据**：`node --test "tests/**/*.test.mjs"` 全绿；手动构造两种失败样例，诊断消息均正确。

#### EXEC-4 实核「T5 无脚本执行能力」（**先核后改**）

- **问题**（报告 §9.5）：「T5 子代理**无脚本执行能力**」这句**只存在于 `segment-chars.mjs:19` 的注释**，全库 `.md` grep 零命中——它是一条**孤证**，却被用来解释 6~10% 的实测误差（实例：预估 16,987 / 实测 18,071 / 超 1,271 字 / 被迫 3 轮削裁）。
- **实核方法（二选一，均只读）**：
  1. **运行时实核**：spawn 一个最小子代理，让它自报可用工具清单（一问一答，成本极低）；
  2. **静态实核**：查 agent preset 配方 —— 注意分档预设配方在**仓库级** `examples/preset/`（**不随包**）。
- **改法（按结果二选一）**：
  - 若 T5 **有** `pwsh` → 注释改述为「T5 可执行脚本（vX 实核），但**本脚本仍由主控统一执行**以保口径一致」，并把 6~10% 那句改为**历史表述 + 时点**（防被当成现状）。
  - 若 T5 **无** `pwsh` → 注释补**真源指针**（现在该约束无处可查，属不可追溯的假设）。
- **成本**：1 小时（含实核）。**判据**：注释中的每一句断言都能指回一个可查的真源。

### 批 1 · 文档与措辞（零脚本、零机检契约变更）

#### A3 计量口径变更固定动作 → `maintainers.md`

- **落点**：`references/maintainers.md`（维护者向，**与 §七「收口批固定动作：差集 + 反向核验」、§十「发布前固定动作：工具链不得改写仓库」并列**，新增一节）。
- **条文内容**（照报告 §三 A3）：改任何计分 / 比例 / 统计口径（`token-budget.mjs` / `token-cost.mjs` / `lunheng-stats.mjs` / `quality-score.mjs` / 任何 `x/5` 或百分比）时，须在同处贴 ① **同一输入 fix 前 / fix 后两列**；② **受影响显示项清单 + 不受影响项清单**；③ 若为「无数据」态，**显式给出提示文案而非让比例退化**（不出 0% / 100% 假数）。
- **本地依据**：v18.22.0 §2.3「成本口径纠正（本报告最重要的单条发现）」+ MEA 族；同类坑**已踩过**，只是没固化成规则。
- **预估 Δ**：+700~900 B → 25,924 + 800 = 26,724；+1,536 = 28,260 → **须抬至 28,672 B**（28 KB）。
- **判据**：条文在 `maintainers.md`；下次口径改动按此贴表。

#### A4 「转述仍算计费」反模式条目 → `errors.md`

- **落点**：`references/errors.md`（8,731 B，**不在词预算门内**）
- **条文**：**同一事实在一轮内只应完整写一次**；其余位置（含主控**三播报**的「完成转播」）只写**指针**（角色 + 产物路径 + 行号）。
- **依据**：context-mode `skills/context-mode/references/anti-patterns.md:290-291`（已在上下文的数据再送一次 = **2× 计费**）。本地主要风险点**已做对**（交接报告是摘要，`handoff-check.mjs:409-410` 软检），缺的只是这条显式条目。
- **预估 Δ**：+250~400 B（不进棘轮表）。
- **判据**：与 `_shared/failure-modes.md` **不重复**（若已覆盖 → 只加指针，见 B5）。

#### B1 阈值显式化 → `交接报告-template.md` + `dispatch-cards.md`

- **落点**（均**不在**词预算门内）：`references/templates/交接报告-template.md`（2,363 B）、`references/templates/交接报告-template-lite.md`（2,030 B）、`references/dispatch-cards.md`（7,437 B）。
- **改法**：把**形容词**改成**显式数字 + 触发后的动作**。示例：
  > 交接报告正文 > 10 行 → 只留六要素每项 1 行 + 产物路径；细节落盘，报告内写指针。
- **依据**：context-mode 的硬阈值（`server.ts:1979-1980`：5,000 / 102,400 B）。
- **判据**：`handoff-check.mjs:409-410`（B3 软检）命中率下降。
- ⚠️ **勿改 `pipeline-readme.md`**（余量仅 1,617 B，且是全库最大文件之一）；本条不涉及派发话术层。

#### B2 一次调用问全部（批量查询纪律）→ `dispatch-cards.md`

- **落点选择（本计划的关键工程取舍）**：

  | 候选落点 | 实测 | 门内? | 评价 |
  |---|---|---|---|
  | `agents/00-主控-coordinator.md` | 11,964 B | **临界** | ⚠️ 距 `DOC_BUDGET_MIN`（12,288 B）**仅 324 B** —— 增补 >324 B 即**越线**，须**首次登记**（先例：`08-终检-finalizer.md` 首登 14,336 B）。**不建议** |
  | `agents/00-主控-扩展职责.md` | 60,597 B | ✅ 余 1,867 | 可行但更贵（余量本就不宽） |
  | **`dispatch-cards.md`** | 7,437 B | ❌ 不在门内 | **推荐**：零棘轮成本 + 语义最贴（它本身就是派发层） |

- **条文**：主控的 `read` / `grep` 往返应**一次读多文件、一次查多关键词**，而非逐文件往返；检索式同理（一次多查询，非 N 次单查询）。
- **依据**：context-mode `SKILL.md:135-137`（「NEVER make multiple separate calls — put all queries in one array」）+ M4 批量合并（`server.ts:3679-3776`）。
- **判据**：抽查 1 个实战项目的派发记录，单轮 `read` 次数下降而覆盖面不减。

#### B3 检索式批量纪律 → `_shared/外部检索源接入面.md` §4.5

- **落点**：`references/_shared/外部检索源接入面.md`（19,155 B，上限 21,504，**余 2,349**）
- **改法**：**单一真源落点**——只在此处写一次（**勿在 T1/T2/T3 三卡各写一份**，撞本地教训 #156「同段复制必漂移」）。条文：
  > 检索式应**批量提交**；不得用 N 次近似重复的单查询代替一次多查询；「饱和停」判据针对**新增**，不针对**次数**。
- **预估 Δ**：+300~450 B → 改后余量 ≈1,900 ≥1,536 → **无需抬升**。
- **判据**：三卡中**不得**出现同段副本（结构性 grep）。

#### B5 反模式文档形态（**先核后改**）

- **前置**：读 `references/errors.md`（248 行）与 `_shared/failure-modes.md`（76 行），确认是否已是「问题 → BAD 例 → GOOD 例 → **一句话 Rule**」+ 文末 **Summary Checklist** 形态（context-mode `anti-patterns.md` 同款）。
- **改法**：若形态已同 → 只补条目（A4 一并落此）；若否 → 低成本形态升级。
- **成本**：1 小时（含核查）。

### 批 2 · 决策记录（ADR）形态（A1）

- **落点**：**新建仓库级 `audits/decisions/`** + `audits/decisions/ADR-template.md`
- ⚠️ **为什么必须放技能目录外**：`repo-hygiene-check` 规则⑨ 的词预算棘轮只约束**技能目录内** ≥12 KB 的 .md；`audits/` 不受约束。若放 `references/`（如 `maintainers.md` 新增一节），**必然撞墙**（`maintainers.md` 余量 1,724 B，且 A3/B4 已要用它）。
- **交换条件**：**必须在 `references/maintainers.md` 加一行指针**（否则 `decisions/` 成为第五处漂移源，与本地「单一真源」纪律冲突）。
- **模板字段**（照 context-mode `docs/adr/0001-0004`）：Status / Date / Supersedes / Context（**含根因重析**）/ Decision / **Regression-proof anchor**（成对测试：行为测 + **源码钉**）/ Consequences（Positive / Negative / **Neutral**）/ Alternatives considered（**逐条驳回理由**）/ Contract for consumers。
- **补写 3 条历史决策**（建议）：

  | 候选 | 为什么值得回填 |
  |---|---|
  | `exit 10` 收口（L-67：全仓「用法/参数错记 1」的最后三处） | 它是 `handoff-check` 20/21/22 与 M 门 1/2/3 分离的**前置**，两者是同一决策族 |
  | `handoff-check` 20·21·22 与 M 门 1·2·3 **刻意分离** | 「复用会重演 exit 10 被读成 P1 事故」——这是**代价已支付过**的决策，最需要锚点 |
  | 写盘安全网 `tmp + rename + .bak`（v18.2.9 / B4 / v18.14.0 排序修复） | 三层叠加（原子写 / 回滚点 / 有界回收），且踩过 CI flaky；**ADR-0001 式的「替代方案驳回」**在这里最有用（为什么不用固定名 `.bak`） |

- **预估成本**：目录 + 模板 ≈ 半天；补写 3 条 ≈ 1 天。**判据**：抽查一条决策，其 `Alternatives considered` 段能回答「当初为什么不用另一种做法」。
- **回滚**：删除 `audits/decisions/` + `git checkout -- references/maintainers.md`。

### 批 3 · 捕获层反向门（A2，**须先试点**）

- **落点**（均**不在**词预算门内）：
  1. `references/_shared/检索注入防御.md`（930 B，已是三卡共用单一真源）→ 增一节「**落盘不得预筛**」：卡片条数 = 实际取回条数；不相关者在卡内标注「本轮不采用 + 理由」，**而非不写**。
  2. `references/templates/素材加载清单-template.md`（2,481 B）→「## 已跳过」由**可选**改**必填**（无跳过则显式写「无」），沿用本地「**未做须显式声明，防沉默跳过**」纪律。
- **依据**：报告 §三 A2；context-mode `anti-patterns.md:247-269`（「**索引才是唯一幸存面**；进索引前丢的永久消失」）。
- **试点判据**：跑 **1 个实战项目**，验「三卡条目数 ≥ 交接报告自报取回条数」且「已跳过段非空或有显式『无』」。
- **A2b（可选，试点后再定）**：`m-gate-check.mjs` 增一条**反向**判据。⚠️ **必须新开命名空间**，不得复用 M-Form 编号（本地已有「M-Form-12 同号两义」教训）；成本 +1 天（含 tests）。**建议：试点证明「预筛」确实发生再立项。**

---

## §五、词预算棘轮影响（逐文件实测量）

> 公式（本地定案 ①）：**上限 = 「实测 + 1.5 KB」向上取整到整 KB**。配套判据：**余量 <1.5 KB 视同上限已满**；**不许把棘轮停在距上限数十 B**（等效禁止再写）。

**本次涉及且入门（≥12,288 B）的文件**：

| 文件 | 实测 B | 上限 B | 余量 B | 本计划对其动作 |
|---|---|---|---|---|
| `SKILL.md` | 39,359 | 40,960 | 1,601 | EXEC-1 + EXEC-2 → **临界，建议抬** |
| `references/deliverables.md` | 22,262 | 23,552 | **1,290** ⚠️ | EXEC-1 → **须抬至 24,576** |
| `references/_shared/M-Gate-Algorithm.md` | 104,310 | 106,496 | 2,186 | EXEC-1 → 预计无需抬 |
| `references/maintainers.md` | 25,924 | 27,648 | 1,724 | A3 + B4 + A1 指针 → **须抬至 ≈28,672** |
| `references/_shared/外部检索源接入面.md` | 19,155 | 21,504 | 2,349 | B3 → 预计无需抬 |
| `references/_shared/规范-机械门对照表.md` | 35,927 | 37,888 | 1,961 | 仅在新增门时加行（A2b） |
| `references/checkers/中文AI痕迹-checker.md` | 14,313 | 15,360 | 1,047 ⚠️ | 本计划**不动**；如需动须抬 |
| `references/glossary.md` | 38,624 | 40,960 | 2,336 | 本计划**不动**（只作口径真源引用） |
| `references/agents/00-主控-扩展职责.md` | 60,597 | 62,464 | 1,867 | 本计划**不首选**其为落点 |
| `references/agents/01-文献检索-literature-scout.md` | 19,366 | 21,504 | 2,138 | 本计划**不动**（B3 收敛到 `_shared/`） |

**本次涉及但不在门（<12,288 B，自由增补）的文件**：
`errors.md` 8,731 ／ `dispatch-cards.md` 7,437 ／ `_shared/failure-modes.md` 5,552 ／ `_shared/format-export.md` 4,504 ／ `templates/素材加载清单-template.md` 2,481 ／ `templates/交接报告-template.md` 2,363 ／ `templates/交接报告-template-lite.md` 2,030 ／ `_shared/检索注入防御.md` 930

**⚠️ 一处必须点名的临界**：`references/agents/00-主控-coordinator.md` 实测 **11,964 B**，距登记线 12,288 B **仅 324 B** —— 任何 >324 B 的增补都会**越过登记线**，须**首次登记**（按定案 ① 公式，先例 = `08-终检-finalizer.md` 首登 14,336 B）。**故 B2 改落 `dispatch-cards.md`**。

**未取（须实测后补入本表）**：`agents/02-数据检索-data-scout.md`（12,213 B，刚过线）／`agents/03-案例检索-case-scout.md`（13,103 B）的上限。

---

## §六、授权判定

| 项 | 是否机制文件 | 授权判据 |
|---|---|---|
| 批 0 EXEC-1/2/3/4 | ✅（`references/**` + `scripts/**`） | **须主人显式授权** |
| 批 1 A3/B3 | ✅（`references/**`） | **须主人显式授权** |
| 批 1 A4/B1/B2/B5 | ✅（`references/**`，但均不在棘轮门内） | **须主人显式授权**（门只管字节，不管权限） |
| 批 2 A1 目录 + 模板 | ❌（`audits/` = 仓库级） | 目录创建与模板属动议产物；**`maintainers.md` 指针须授权** |
| 批 3 A2 卡 + 模板 | ✅ ／ A2b 脚本 | **须主人显式授权**（A2b 另须） |

**依据**：`AGENTS.md`「**agent 自发改进 = 禁写（只出反哺报告）；主人明确下令 = 可写（走安全流程）**」。「不在词预算门内」**不等于**「不需授权」——两者是不同维度。

---

## §七、DoD（每批必做，引 `AGENTS.md` 例外条款）

1. **改前备份**：全量备份到工作区外 `<DSH_HOME>/_backup/lunheng-<日期>/`（含 `scripts/` + `references/` + `SKILL.md` + `AGENTS.md`）；**记录行数基线**。
2. **改中**：`edit` **精确匹配**（**禁 `sed -i`**——静默清空事故教训）。
3. **改后验证**：
   - 脚本：逐文件 `node --check`
   - 重跑受影响脚本（改 `mexist-gates.mjs` / `m-gate-check.mjs` → 必跑 `m-gate-check` 全项）
   - `diff` 对比备份（不一致立即从 `.bak` 恢复）
4. **四道门**（改机制 / 文档后）：
   - `node skills/lunheng-article-pipeline/scripts/consistency-check.mjs` —— **exit 0 才提交**
   - `node scripts/repo-hygiene-check.mjs` —— **词预算棘轮门**（本计划的核心风险点）
   - `dsh-plugin-dev check` —— 包面静态门（**0 fail / 0 warn**）
   - `node --test "tests/**/*.test.mjs"` —— 改脚本 / `cordis.patch.yml` / `package.json` 时**必跑**
5. **棘轮**：任何增长**必须在同一次提交里**抬升上限并写明理由（照 `DOC_BUDGET` 既有条目的写法）。
6. **同步镜像**：四道门全绿 + 提交之后**再**同步部署镜像（项目技能根 / 用户技能根）；**不要反过来**。
7. **留痕**：改动清单与回滚命令写入 `audits/机制文件修订记录-<日期>-*.md`。
8. **如实标注**：改动记录中写明「本次机制文件改动依据主人显式授权」（不掩盖默认约束的突破）。
9. **收口**：宣布「修订已全部完成」**之前**必跑 **`closeout-verify`**（差集 + 反向核验）；发版前另跑 **`no-write-check`**。

---

## §八、回滚预案

| 批 | 回滚方式 |
|---|---|
| 批 0 | `git checkout -- skills/lunheng-article-pipeline/references/_shared/M-Gate-Algorithm.md skills/lunheng-article-pipeline/references/deliverables.md skills/lunheng-article-pipeline/SKILL.md skills/lunheng-article-pipeline/scripts/_lib/mgate-gates/mexist-gates.mjs skills/lunheng-article-pipeline/scripts/segment-chars.mjs` + **棘轮表同步回退**（`DOC_BUDGET` 在 `scripts/repo-hygiene-check.mjs`，属**仓库级**不随包，须单独回滚） |
| 批 1 | 同上（`maintainers.md` / `errors.md` / `dispatch-cards.md` / `_shared/外部检索源接入面.md` / 两份交接报告模板） |
| 批 2 | `rm -rf audits/decisions/` + `git checkout -- skills/lunheng-article-pipeline/references/maintainers.md` |
| 批 3 | 同上（`检索注入防御.md` / `素材加载清单-template.md` / 若已做 A2b 则含 `m-gate-check.mjs` + `tests/`） |

**统一前提**：备份保留至全部批次验收通过；回滚后**须复跑四道门**（棘轮未回退时门会红，这正是它该有的行为）。

---

## §九、待核清单（**先核后动**，避免把假设当事实）

| # | 待核 | 影响 | 方法 |
|---|---|---|---|
| 1 | ~~`manifest.json` 是否已取代「交付说明 §证据包指纹」段~~ → **方向已定案（§11.1）**；仍须核**取代关系的具体形态** | 决定 EXEC-1 落点的**逐字**改法 | 读 `build-evidence-bundle.mjs:270-340` + 一个已完成项目的 `final/交付说明.md` |
| 1b | **T8 内部 `build-evidence-bundle.mjs` 是否先于 `交付说明.md` 指纹段填写** | **决定 §11.2 选项 a 是否可行**（顺序反了 → 收紧后产生假 P1） | 读 `references/agents/08-终检-finalizer.md` 终检步骤顺序 |
| 2 | `errors.md` / `failure-modes.md` 现有形态 | 决定 A4/B5 是「补条目」还是「形态升级」 | 读两份全文 |
| 3 | T5 子代理是否真有 `pwsh` | 决定 EXEC-4 的改法 | 见 EXEC-4 实核方法 |
| 4 | `agents/02` / `03` 两卡的词预算上限 | §五 表格补全 | 读 `repo-hygiene-check.mjs` `DOC_BUDGET` 剩余行 |
| 5 | `EXEC-` 前缀是否仍未被占用 | 编号唯一性 | §附录 复算命令 |
| 6 | 论衡是否还有**其他**同类「一处例外未同步兄弟文档」的活体矛盾 | 本计划可能低估 批 0 规模 | 对 v18.0.0 以来所有「例外 / 仅…时 / 非默认」类改动做一次跨文档对账 |

> **#6 值得单独跑一次**：EXEC-1 是**被一次提问偶然撞见**的，不是被门抓到的——说明这类「例外只改一处」的缺陷**当前无门覆盖**。这与报告 §三 A1 的动议同源，可作为 A1 的第一个试水用例。

---

## §十、主人 review 提示

1. **建议先只做批 0**（≈半天）。它不是改进而是**止血**：`sha256` 口径当前互斥，任何真实交付都会依据其中一处写出结果而另两处判它不合。**批 0 完成后再决定其余批次是否启动。**
2. **✅ 已定案（2026-09-29）**：**EXEC-1 方向 = 写实值、权威 = `manifest.json`、无需主人回填**。原「保留占位符待回填」选项**已被否决**。执行口径与派生决策点见 **§十一**。**待你决定的只剩下一个**：EXEC-3 是否同批收紧机检（§十一.2）。
3. **本计划的取舍已写明理由，勿当疏漏改掉**：
   - A1 的 ADR 目录放 `audits/`（技能目录外）**不是图省事**，而是避开词预算棘轮——若改放 `references/`，须同批抬棘轮，且 `maintainers.md` 本就紧张。
   - B2 不落 `00-主控-coordinator.md` **不是忽略主控卡**，而是它距登记线仅 324 B。
   - B3 只落 `_shared/` **不是漏了三张检索卡**，而是本地教训 #156 要求单一真源。
4. **明确不做**：报告 §三 C 档 7 项。其中**拦截层**（C7）属**路线变更**（skill+gate → plugin+hook），DSH 技术上支持（`agent/pre-step` / `agent/request` 为可短路 waterfall），但须先出 ADR 定案，**不建议夹在本次落地**。
5. **本计划不含任何机制文件改动**；落地须你显式授权后按 §七 DoD 执行。

---

## §十一、主人定案记录（2026-09-29）

### 11.1 定案原文

> **EXEC-1 定案方向——「证据包指纹段写实值（权威 = `manifest.json`）」 无需主人回填**
> —— 主人 2026-09-29

**含义拆解**（三条，均为本次定案的直接结论）：

1. `交付说明.md` §证据包指纹段写 **sha256 实值**（不再是占位符）。
2. **权威真源 = `final/证据包/manifest.json`**——该段是它的**引用**，不是第二个独立真源（避免「同一事实两处维护」，本地教训 #156）。
3. **主人不参与回填**——`[哈希校验待主人回填]` 这条路径**废弃**，不再作为任何环境下的默认或兜底。

**执行口径（不改动既有流程，只收口口径）**：T8 终检跑 `build-evidence-bundle.mjs`（**本已是必做步骤**）→ 该脚本 `:302,314-331` 已逐文件算好 sha256 与 `auditTargetSha256` → 主控把实值写进 `交付说明.md`，并在段内写明权威真源。**不需要任何额外的计算步骤**——哈希已经算好了，缺的只是「把它抄进去」这个动作被明确成口径。

### 11.2 ⚠️ 派生决策点：机检是否同批收紧（**唯一待主人定案项**）

**问题**：`mexist-gates.mjs:895-896` 当前正则 = `\[哈希校验待主人回填\]|sha256[:：]?\s*[0-9a-f]{16,}` —— **占位符与实值都放行**。
于是：**条文改了、门没改 → 一个偷懒留占位符的交付件仍然 `pass`**。定案只落在 prompt 层，落不到机制层（这正是本地教训 #139「规范从文档层到执行层断链」的同型）。

| 选项 | 做法 | 后果 | 评价 |
|---|---|---|---|
| **a. 收紧（推荐）** | 正则改为**只接受实值**（`sha256[:：]?\s*[0-9a-f]{16,}` 或显式 manifest 指针 + 实值）；留占位符 → **P1** | 未跑 `build-evidence-bundle.mjs` 的项目 M-Exist-7 判 P1。**属门行为变更**，须 tests + 修订记录如实标注 | **使定案可机械执行**；与本报告 A3（口径变更须留痕）同源 |
| b. 不收紧 | 只改条文与诊断措辞 | 占位符仍是可通过路径 → 定案**无法被门保证**，只剩 prompt 强度（论衡自认「比 prompt 强、比机制强制弱」） | 成本最低，但定案形同建议 |
| c. 中间档 | 占位符降为 **P2 软提示**，不停交付 | 渐进取缔，不断人 | 折中；但仍留一条合法路径 |

**✅ 选项 a 的前置依赖已核，成立**（原列为「须先核，不得假定」）：T8 内部 **`build-evidence-bundle.mjs` 必须排在 `m-gate-check.mjs` 之前**——否则收紧后会出现「manifest 尚未生成 → 写不出实值 → 判 P1」的**假 P1**。

实测证据（`references/agents/08-终检-finalizer.md`）：
- `:46-52`：**`final-check.mjs` 自动串联三脚本，明写「顺序不可交换」**：① `count-chars.mjs` → ② **`build-evidence-bundle.mjs --summary`（先刷新证据包）** → ③ **`m-gate-check.mjs`（M 门机械 24 项，含 M-Exist-7）**。
- `:50`：**v17.0.0 已因顺序装反而复现过假 P0**（旧顺序 `count-chars → m-gate-check → build-evidence-bundle`，M 门读到上一次的证据包副本）——说明这条顺序契约**不是约定而是已修的缺陷 + 有实测记录**。
- 辅证：`mexist-gates.mjs:861` 有「尚无 `final/交付说明.md` → N/A」分支，前置期不会误判。

→ **结论：选 a 安全**。收紧正则后不会产生假 P1，因为到达 M-Exist-7 时 `manifest.json` 必然已存在。

**对成本的影响**：EXEC-3 由「20 分钟改措辞」升为「**改措辞 + 改判定 + tests + 修订记录标注门行为变更**」≈ 半天。

### 11.3 全量站点普查与改写要点（**2026-09-29 实测，19 处 / 10 文件**）

> ⚠️ **本节推翻了本计划 §四 EXEC-1 的原估算（原写「三处同步」）**。定案下达后跑了一次全库普查
> （`grep '哈希校验待主人回填|待主人回填|SHA256-PENDING|host shell 回填|agent 不执行 sha256|不能直接计算 sha256|sha256 占位符|占位符机制'`），
> 实际命中 **19 处 / 10 文件**，其中**两处最决定行为的落点原清单完全没有**：**`templates/交付说明-template.md`（每个交付件都会抄的源）** 与 **`08-终检-finalizer.md:28`（执行角色卡，且同句内自相矛盾）**。
> **这本身就是 §九 #6 那条动议的经验证据**：「例外只改一处、兄弟文档不同步」不是偶发，而是**默认结局**。

| # | 落点 | 现文（节录） | 定案后处置 |
|---|---|---|---|
| 1 | `M-Gate-Algorithm.md:825` | 「主控 LLM **不能**直接计算 sha256 二进制哈希…」 | 删**能力否定**；改为「sha256 由 `build-evidence-bundle.mjs` 计算（`:302,314-331`），主控**引用其产出**」 |
| 2 | `M-Gate-Algorithm.md:826` | 「**DSH 例外**…可直接计算回填，**不必留占位符**…」 | 例外**升为正例**（唯一默认路径）；删「仅在严格零 exec 场景才降级」 |
| 3 | `M-Gate-Algorithm.md:827` | 「3. **生成 sha256 占位**…」 | 段头改为「写实值」 |
| 4 | `M-Gate-Algorithm.md:833-836` | 4 行样例 `[哈希校验待主人回填]` | 换为实值样例（或指向 `manifest.json` 字段名） |
| 5 | `M-Gate-Algorithm.md:844` | 「占位符存在 → **P5 ✅ 通过**（主人未验证不阻塞交付）」 | ⚠️ **须重审**：占位符不再是合法值 → 该分支应删或改；**P5 档位语义请主人确认**（本地其他门用 P0/P1/P2） |
| 6 | `M-Gate-Algorithm.md:1013`（**阈值总表**） | 「须有占位符 **或** 真实 sha256 → 缺 → P1」 | ⚠️ 该表由 `m-gate-check --dump-thresholds` **单向生成** → **可能须改脚本而非改文本**；改前后须重跑生成并核对 |
| 7 | `M-Gate-Algorithm.md:1157` | 「v2.2.17 修复（**教训 #123**）：哈希指纹为**可选验证**…**不**作闸门强制项」 | ⚠️ **定案 = 需求升级**：由「可选验证」升为「必填实值」——**须如实标注为需求升级**，不得写成口径修正 |
| 8 | `M-Gate-Algorithm.md:1175` | 伪代码 `sha256_pending = emit_placeholder_sha256(data_card)` | 改为 `read_manifest_sha256(...)` |
| 9 | `M-Gate-Algorithm.md:1192` | M-Integrity-2 步骤 4「必须有 sha256 **占位符**」 | 改为「必须有**实值**（权威 = `manifest.json`）」 |
| 10 | `M-Gate-Algorithm.md:1209` | 伪代码 `check_evidence_sha256_placeholder(...)` | 改名 + 改判定 |
| 11 | `deliverables.md:122` | 「sha256 占位符（人类可选回填；**agent 不执行 sha256**）」 | 「sha256 **实值**（权威 = `manifest.json`；**无需主人回填**）」 |
| 12 | `SKILL.md:31` | 「真实 hash/字数**由主人在 host shell 回填**」 | 保留「（检查）占位符是发布包净化产物」这一**打包事实**；删运行时口径句，改指针 |
| 13 | **`08-终检-finalizer.md:28`** | 同句前半「**不得留 `<…>` 占位符**」＋后半「证据包指纹**须保留** `[哈希校验待主人回填]` 占位符」 | **后半句删除改写**（定案废止）；⚠️ 同句「某门缺 §6 回填则标『未留痕』（**不得代填**）」**不动**——那是主人决策记录，与哈希无关 |
| 14 | `00-主控-扩展职责.md:79` | M-Integrity-1 检查项含「数据卡 **sha256 占位符**」 | 改为「sha256 实值」 |
| 15 | `00-主控-扩展职责.md:166` | 「证据包指纹（`[哈希校验待主人回填]` 占位符，v2.5.2-dsh.17 升为固定字段）」 | 改为「实值，权威 = `manifest.json`」 |
| 16 | **`templates/交付说明-template.md:91-92`** | 模板本体 `- **sha256**：`[哈希校验待主人回填]`` ＋「**占位符即为合规**…agent 不执行 sha256」 | **必改**——这是**每个交付件照抄的源**；不改则新交付件**由构造即物化废弃口径**（修下游不修模板 = 修不完） |
| 17 | `规范-机械门对照表.md:45` | 「sha256 **占位符** + **逐文件 manifest 复算**」（两者混写） | 改为「**实值** + manifest 复算」 |
| 18 | `mexist-gates.mjs:895-896` | 正则接受占位符；失败诊断只点名占位符 | **取决于 §11.2 定案**；若选 a → 正则收紧 + 诊断补实值形态 |
| 19 | `QUICKSTART.md:28` | 「**可选手动 sha256 验证**：主控会发占位符…如需真实 hash 需主人在 host shell 手动计算后回填」 | **用户可见文档** → 改为「主控自动写实值，**无需你操作**」 |

**新增涉及文件的词预算状态**（补 §五 表）：

| 文件 | 实测 B | 上限 B | 余量 B | 本项动作 |
|---|---|---|---|---|
| `references/agents/08-终检-finalizer.md` | 13,038 | 15,360 | 2,322 | 本项以**删减**为主 → 预计无需抬升 |
| `QUICKSTART.md` | 15,464 | 16,384 | **920** ⚠️ | 若净增 → **须抬升**；因以删/改为准，预计可持平 |
| `references/agents/00-主控-扩展职责.md` | 60,597 | 62,464 | 1,867 | 两处小改 → 预计无需抬升 |
| `references/templates/交付说明-template.md` | 10,816 | — | — | **不在门内**，但**距登记线 12,288 仅 1,472 B** —— 净增 >1,472 B 即**越线须首次登记** |

**⚠️ 两处须主人确认的语义后果**（非技术细节，而是**设计意图的反转**）：

1. **`M-Gate-Algorithm.md:1157` / 教训 #123**：占位符机制的**原始设计意图**是「哈希指纹为**可选验证**，**不阻塞交付**」。定案把「主人回填」废止后，须确认新口径下**是否仍要保证「不阻塞」**——若某环境写不出实值，是判 P1（阻塞）还是留一条降级通道？
   **本计划倾向：判 P1 阻塞**——因为 `final-check.mjs` 的顺序契约（`08-终检-finalizer.md:46-52`，**顺序不可交换**）保证 `manifest.json` 必先于 M 门产出，**写不出实值 = 真异常**，应当阻塞而非静默降级。
2. **P5 档位**（`M-Gate-Algorithm.md:844`）在本地其他门中未见他用（其余为 P0/P1/P2）。定案后该分支若保留，须先解释 P5 是什么。

**对成本的影响（修正 §四 EXEC-1 的「半天」）**：**≈ 1~1.5 天**（10 个文件 / 19 处 + 阈值总表可能须改脚本 + 需求升级须在 `CHANGELOG.md` 与修订记录中如实标注 + `tests/**` 回归）。
**这正是「修下游不修模板、不先普查」会反复的原因**——若不先做普查就动手，必然只改掉 `SKILL.md` / `deliverables.md` / `M-Gate-Algorithm.md` 三处，而**模板与 T8 卡会把废弃口径继续复制给每一个新交付件**。

---

## 附录 · 复算命令与基线读数（可复跑）

```powershell
# 基线
cd <仓库根>   # lunheng-article-pipeline-dsh；本机绝对路径不写入文档（repo-hygiene-check 规则 ⑦b）
git rev-parse --short HEAD          # 1214364
git rev-parse --abbrev-ref HEAD     # master
git status --short -- skills lib cordis.patch.yml package.json   # 应为空（机制文件零改动）

# 逐文件实测（§五 表格的来源）
$s = "skills\lunheng-article-pipeline"
Get-Item "$s\SKILL.md","$s\references\deliverables.md","$s\references\_shared\M-Gate-Algorithm.md",`
          "$s\references\maintainers.md","$s\references\_shared\外部检索源接入面.md" |
  Select-Object Name, Length

# 词预算上限（棘轮真源）
Select-String -Path "scripts\repo-hygiene-check.mjs" -Pattern "DOC_BUDGET_MIN|'skills/lunheng-article-pipeline/" -Encoding UTF8

# 编号族可用性（§一）
foreach ($p in 'EXEC-','GOV-','ADR-','MEA-','CTX-','EFF-','QLT-') {
  $n = (Get-ChildItem -Recurse skills,docs,audits -File -Include *.md,*.mjs |
        Select-String -Pattern $p -Encoding UTF8 | Measure-Object).Count
  "{0,-8} {1}" -f $p, $n
}

# 「零 exec」口径全库对账（EXEC-2 判据）
Get-ChildItem -Recurse $s -File -Include *.md |
  Select-String -Pattern '零 exec|零exec' -Encoding UTF8 |
  ForEach-Object { $_.Filename + " L" + $_.LineNumber }

# sha256 口径三处（EXEC-1 判据）
Select-String -Path "$s\references\_shared\M-Gate-Algorithm.md" -Pattern 'sha256' -Encoding UTF8 |
  Where-Object { $_.LineNumber -ge 818 -and $_.LineNumber -le 840 }
Select-String -Path "$s\references\deliverables.md" -Pattern '哈希校验待主人回填' -Encoding UTF8
Select-String -Path "$s\SKILL.md" -Pattern 'host shell 回填|默认零 exec' -Encoding UTF8
```

**本次基线读数**（2026-09-29 实测）：

```
HEAD 1214364 / master / 技能 v18.53.0
机制文件改动：0（git status -- skills lib cordis.patch.yml package.json 为空）
EXEC- 0 ／ GOV- 0 ／ ADR- 9（全部来自本报告自身）／ EXT- 65（SVG text-anchor 假阳性）
```
