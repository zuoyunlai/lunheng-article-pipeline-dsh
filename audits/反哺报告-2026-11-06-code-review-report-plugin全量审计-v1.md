# 反哺报告：code-review-report-plugin 0.1.12 全量审计（v1）

- **审查日期**：2026-11-06
- **审查对象**：`%USERPROFILE%\.trae-cn\plugins\trae-remote-official\code-review-report-plugin\0.1.12`（本地安装产物：`server/main.mjs`、`dist/mcp-app.html`、`skills/review-code-report/**`、`.mcp.json`、`.trae-plugin/plugin.json`）
- **基线**：插件 0.1.12；服务端为 28836 行打包产物，插件实现约 1500 行（`src/*` 段），无原始 TS 源码与测试
- **范围**：MCP 工具面与输入契约、快照捕获与存储、报告校验与发布、UI 资源、技能与交付规约、跨平台与性能
- **核实方式**：静态审读 + 8 组 MCP stdio 端到端用例（V1–V8）+ 2 组性能基准（100/300 文件）+ 符号链接、非仓库、失效锁等负向用例；不以"报告提及"代替"实测"
- **修订授权**：主人明确指令「逐项核实按规则形成反哺报告成文落盘后依次全部修订」。本报告先行落盘，随后按本报告编号顺序修订；不提交、不发版，不改动用户既有 review 数据

---

## 一、结论与分级

**综合评分 7.1 / 10**：审查方法论与报告体验扎实，核心链路端到端可用；主要短板是**工程性能**（300 文件单次捕获 150 s，同步阻塞事件循环）、**门禁失效**（覆盖率校验不可达）与**运维健壮性**（锁无 TTL、数据无保留策略、git 错误裸透）。

| 维度 | 权重 | 得分 | 判定依据 |
|---|---|---|---|
| 功能正确性 | 25% | 9.0 | 捕获/校验/发布/详情/代码分页/导航/修复上下文全链路通过 |
| 审查方法论 | 20% | 8.5 | 固定 SHA、双验证、证据链、反幻觉规则完整 |
| 性能与扩展性 | 15% | 3.5 | 300 文件 begin 150.5 s；100 文件 publish 38.1 s |
| 健壮性/错误处理 | 15% | 6.0 | 裸 git 报错、锁失效永久阻塞、无保留策略 |
| 安全与隐私 | 10% | 7.5 | 路径穿越与完整性防护到位；`O_NOFOLLOW` 在 Windows 失效；绝对路径入库 |
| 可维护性 | 10% | 5.5 | 死契约、死字段、阈值分裂、仅发布 bundle |
| 文档与交付 | 5% | 8.5 | 分层加载设计优秀；存在工具名与关联规则表述漂移 |

### 1.1 问题族与处置原则

| 编号 | 级别 | 问题族 | 修订原则 |
|---|---|---|---|
| A-01 | P1 | 快照捕获按文件起 git 子进程、workspace 双重扫描、同步阻塞 | 批量读 blob、单次状态指纹、diff 并发生成；不改快照语义 |
| A-02 | P1 | 覆盖率门禁不可达：`change-unassigned` 自动补组使 `REVIEW_COVERAGE_INCOMPLETE` 永不触发 | 仅在全空报告时保留兼容补组；其余交回门禁 |
| A-03 | P2 | Windows 下 `repository.name` 为完整绝对路径 | 改用 `path.basename`，不改 scope 结构 |
| A-04 | P2 | 发布锁无 TTL，崩溃残留永久阻塞 | 加持有者与过期接管；不改变互斥语义 |
| A-05 | P2 | git 失败原样透出（`spawnSync git ENOENT` / `fatal: not a git repository`） | 映射为结构化错误码与可执行提示 |
| A-06 | P2 | 发布重复全量捕获并整份水合快照 | 复用状态指纹做漂移校验 |
| A-07 | P2 | 省略 `changeIndex` 时静默绑定第一个匹配组 | 多组匹配时拒绝并指明字段 |
| A-08 | P2 | finding 位置自动计入 `reviewedPaths`，弱化审阅真实性 | 保留但显式记为审阅来源，并在文档披露 |
| A-09 | P2 | 审查数据无保留上限与清理入口 | 增加有上限的自动清理与环境变量开关 |
| A-10 | P2 | `O_NOFOLLOW` 在 Windows 不生效（符号链接实测可发布） | 打开前 `lstat` 拒绝符号链接/非普通文件 |
| A-11 | P2 | 发布摘要不截断，300×12K 文本可回灌模型上下文 | 摘要层截断长描述，完整内容留在报告内 |
| A-12 | P3 | `ReportBatch`/`DraftOperations`/`AnalysisJsonSchema` 等 5 个契约无消费者 | 删除死定义，保留在用契约 |
| A-13 | P3 | `reviewMarkdown` 接收并持久化（实测 200 KB），UI 零引用 | 停止持久化，保留输入兼容 |
| A-14 | P3 | 变更上限 100/300、文件上限 1000 三套阈值 | 收敛为单一常量 |
| A-15 | P3 | `pageRows` 逐行整体序列化，O(n²) | 改为增量字节计量 |
| A-16 | P3 | Windows 仍用 `~/.local/share` 数据目录 | 新装走 `%LOCALAPPDATA%`，存量目录兼容 |
| A-17 | P3 | 文档引用不存在的 `SearchCodebase`；关联/审阅规则表述与实现不符 | 同步三份规约 |

### 1.2 核实后驳回的候选（不计缺陷）

| 候选 | 驳回理由 |
|---|---|
| change/readingStep 位置未限 100 行 | 复核 `review-standard.md` §Scope：100 行上限只约束 **issue 位置**；变更导读位置可覆盖更大范围，属设计而非缺陷 |
| `<html lang="zh-CN">` 硬编码 | UI 运行时设置 `document.documentElement.lang`，实测会随宿主语言切换 |
| `summary` 中 `telemetrySummary` 与 `card` 重复 | 前者是遥测口径（`report_stats_status` 等），后者是面板展示口径，职责不同 |
| 快照上限 16 MiB 与 1000 文件上限不匹配 | 两道上限分别约束体量与数量，任一超限即报错并提示收窄范围，行为正确 |

---

## 二、证据与修订任务书

### A-01｜快照捕获性能与阻塞（P1）

**证据**：
1. `capture()` 对每个文件执行 `cat-file -s` + `show` 两次子进程；`writeSnapshotFile()` 再为每个文件单独跑一次 `git diff --no-index`。
2. workspace 模式在 `scan()` 后**再次完整 `scan()`** 做漂移比对，单文件成本约 5–6 次进程启动。
3. 实测（`crr-bench`）：300 文件 `begin_review` **150 488 ms**；100 文件 **49 946 ms**；按 1000 文件上限外推约 8 分钟。
4. `execFileSync` 全程同步：捕获期间服务端无法响应 `get_review_detail` / `get_review_code`。

**影响**：中大改动（>200 文件）几乎不可用；UI 并发请求被拖死；用户易误判插件卡死。

**修订**：以 `git cat-file --batch-check` + `--batch` 批量读取 blob（进程数由 O(files) 降为常数 2）；workspace 二次校验改为「HEAD + `git status --porcelain=v2 -z` + 每文件 stat」指纹；diff 生成改为异步 `execFile` 并有界并发；发布侧复用同一指纹。

**验收**：300 文件 `begin_review` ≤ 30 s；100 文件 `publish` ≤ 10 s；端到端用例全绿；快照 ID 与内容一致性不变。

### A-02｜覆盖率门禁不可达（P1）

**证据**：
1. `convertReport()` 先为未分组文件自动创建 `change-unassigned`（实测 V8：`changes: []` + 1 finding **发布成功**，组名 `change-unassigned`、`reviewed=1`），再为所有可读性限制自动补 `coverage.limitations`。
2. 因此 `assertCoverage()` 的 `MISSING_CHANGE_OR_LIMITATION` / `MISSING_FILE_LIMITATION` 分支在发布路径上恒为空；`REVIEW_COVERAGE_INCOMPLETE` 及其 `recovery` 文案不可达。
3. 与 `SKILL.md` Phase A 第 6 步"无 finding 的变更也要解释"要求冲突。

**影响**：改动导读可合法退化为单一"未分组"组；文档承诺的强校验未生效；错误契约成为死代码。

**修订**：仅在 `overview` 只有摘要、无 `changes`、无 `findings` 时保留兼容补组；其余输入不再补组，交回 `assertCoverage` 报错并给出可执行的补组指引。

**验收**：空 `changes` + 有 finding 的输入被拒并指向 `changes[].paths`；完整分组输入照常发布；`fileIdsReviewed` 不因补组被动扩张。

### A-03｜Windows 仓库名泄漏绝对路径（P2）

**证据**：`capture()` 用 `root.split("/").pop()` 取名；Windows `realpath` 返回反斜杠路径，实测 `scope.repository.name` = 临时仓库的完整绝对路径（`%TEMP%\crr-verify\repo`），并随 `begin_review`、`show_review`、卡片元数据回传。

**影响**：本机绝对路径进入报告与遥测上下文；跨平台命名不一致。

**修订**：改用 `path.basename(root)`。

**验收**：Windows 下名称为最终目录名，POSIX 行为不变。

### A-04｜发布锁无过期接管（P2）

**证据**：锁为 `mkdir(.lock)` 轮询 50×30 ms；实测预置 `.lock` 后发布在 **1698 ms** 失败，错误提示"stale locks require manual inspection"，无 TTL、无持有者信息、无自动接管。

**影响**：进程崩溃或强杀后该 review 永久不可发布，只能人工删目录。

**修订**：锁内写入 `pid`/`createdAt`；冲突时若锁龄超过阈值（默认 5 分钟）则安全接管并记录；阈值可用环境变量覆盖。

**验收**：新鲜锁仍互斥；超龄锁自动接管；并发发布不产生双重写入。

### A-05｜git 失败裸透（P2）

**证据**：非仓库目录返回 `Command failed: git ... fatal: not a git repository`；不存在的路径返回 `spawnSync git ENOENT`（与"Git 未安装"的 `GIT_NOT_FOUND` 契约混淆）。

**影响**：Agent 可能误判为 Git 缺失并停止审查；用户拿不到修复动作。

**修订**：`capture()` 包装 `rev-parse` 与 `rev` 失败，映射 `NOT_A_REPOSITORY` / `INVALID_REVISION` / `GIT_UNAVAILABLE`，每条附 `action`。

**验收**：三类失败均返回稳定错误码与可执行提示；正常仓库不受影响。

### A-06｜发布重复全量捕获与水合（P2）

**证据**：`publishFile()` 以 `readDraft(id, {withContent: true})` 水合全部 before/after；workspace 发布前再执行一次完整 `capture()`。实测 100 文件 publish **38 053 ms**。

**影响**：发布耗时与捕获同量级，且峰值内存翻倍。

**修订**：漂移校验改用与捕获一致的轻量指纹；水合改为按需（仅无 content 的 manifest + 校验所需行数）。

**验收**：100 文件 publish ≤ 10 s；漂移检测用例仍能拦截内容变更。

### A-07｜`changeIndex` 歧义静默关联（P2）

**证据**：`convertReport()` 在省略 `changeIndex` 时取 `changes.find(c => c.fileIds.includes(fileId))`；实测 V1：同一文件属于两组时绑定 `change-1`（第一组），无任何提示。`report-delivery.md` 声称"仅当文件只属于一个组时可省略"。

**影响**：finding 挂到错误的变更叙事下，读者被误导。

**修订**：省略时收集全部匹配组；多于一个时返回字段级错误，要求显式 `changeIndex`。

**验收**：唯一匹配自动关联；多组匹配被拒；显式索引正常。

### A-08｜finding 自动计入已审阅（P2）

**证据**：`convertReport()` 对每个 finding 主位置执行 `reviewed.add(position.fileId)`；实测 V2：未提供 `reviewedPaths` 时 `fileIdsReviewed=1`，且不再生成"未声明审阅状态"限制。

**影响**：审阅覆盖率可被 finding 隐式抬高，弱化"已审阅"声明的真实性。

**修订**：保留该行为（finding 成立即意味着已读证据），但在覆盖率限制与交付文档中显式标注来源；不虚构未读文件。

**验收**：无 finding 且未声明的文件仍产生限制；有 finding 的文件不再重复声明。

### A-09｜审查数据无保留策略（P2）

**证据**：除临时 diff 目录与锁目录外，无任何 `rm` 清理路径；每次审查保留 before/after 与逐文件 diff（单次上限约 24 MiB），实测 V6 目录持续累积。

**影响**：长期使用无限占盘；无清理入口。

**修订**：`begin()` 时按上限（默认保留 100 份、可用 `CODE_REVIEW_REPORT_MAX_REVIEWS` 覆盖）清理最旧的**已发布**审查；永不删除当前审查；清理失败不影响主流程。

**验收**：超过上限后最旧已发布审查被移除；未发布/进行中的审查不被删除。

### A-10｜`O_NOFOLLOW` 在 Windows 失效（P2）

**证据**：实测 V-符号链接：把 `report-input.json` 换成指向另一文件的符号链接后，`publish_review_report` **发布成功**，说明该平台未按 `O_NOFOLLOW` 拒绝。

**影响**：路径绑定校验可被链接绕过；当前影响有限（仍需命中指定路径），但防护声明不成立。

**修订**：打开前 `lstat`，拒绝符号链接与非普通文件；打开后 `fstat` 复核大小与类型。

**验收**：符号链接路径被拒；普通文件正常发布。

### A-11｜发布摘要无截断（P2）

**证据**：`summary()` 原样返回全部 findings 的 `description`（单条上限 12 000 字符、最多 300 条），无长度控制。

**影响**：极端报告把数 MB 文本回灌模型上下文，触发截断/成本失控。

**修订**：摘要层对单条描述截断（默认 600 字符，含省略标记），完整文本仍保留在报告 UI 数据中。

**验收**：长描述摘要被截断且可识别；`get_review_detail` 仍返回全文。

### A-12｜死契约（P3）

**证据**：`ReportBatch`、`ReportBatchJsonSchema`、`DraftOperations`、`DraftOperationsJsonSchema`、`AnalysisJsonSchema` 仅在定义处出现，无调用方（疑似废弃的分批上报方案残留）。

**修订**：删除上述定义；保留 `Analysis`/`ReportInput` 等在用契约。

**验收**：`tools/list` 输出不变；发布流程回归通过。

### A-13｜`reviewMarkdown` 死字段（P3）

**证据**：schema 接受最多 512 KB；实测 V5 传入 200 000 字符后 `report.json` 为 202 198 字节，UI 对该字段零引用。

**修订**：保留输入兼容，但不再写入 `report.json` 的 `originalReview`；同步交付文档说明其仅为历史输入兼容。

**验收**：包含 `reviewMarkdown` 的输入仍可发布；`report.json` 不再包含该字段。

### A-14｜阈值分裂（P3）

**证据**：适配层 `changes.max(100)`、内部 `Analysis.changes.max(300)`、`ReportBatch.max(28)` 三套并存。

**修订**：删除未使用的 28；将内部上限与适配层统一为 100。

**验收**：合法报告不受影响；超限输入报同一错误。

### A-15｜分页 O(n²)（P3）

**证据**：`pageRows()` 每追加一行即 `JSON.stringify` 整个 `items`，页内复杂度平方级。

**修订**：改为增量字节计量（骨架 + 逐项大小 + 游标长度），保留 `max_bytes` 精确语义。

**验收**：分页结果与修订前逐字节一致（同输入同游标）；大页不再重复序列化。

### A-16｜Windows 数据目录（P3）

**证据**：`defaultRoot` 固定 `~/.local/share/code-review-report-plugin`，Windows 下不符合平台惯例。

**修订**：Windows 且不存在存量目录时使用 `%LOCALAPPDATA%/code-review-report-plugin`；存量目录存在则继续沿用，避免历史报告失联。

**验收**：新装路径为 `%LOCALAPPDATA%`；已有 `~/.local/share` 数据的机器行为不变。

### A-17｜文档漂移（P3）

**证据**：
1. `review-standard.md` 使用不存在的工具名 `SearchCodebase`。
2. `report-delivery.md` 称"文件只属于一个组时可省略 `changeIndex`"，实现为"取第一个匹配组"。
3. `reviewedPaths` 未说明 finding 位置会自动计入审阅。

**修订**：改为实际可用工具名（Read / Grep / Glob）；补充多组必须显式 `changeIndex`；补充 finding 自动计入审阅的来源说明与覆盖率要求。

**验收**：三份规约与实现逐条对齐；无残留 `SearchCodebase`。

---

## 三、执行顺序与验证计划

1. **先低风险声明面**：A-03 → A-05 → A-07 → A-08 → A-11 → A-12 → A-13 → A-14 → A-17（行为不变或错误更清晰）。
2. **再存储与安全**：A-04 → A-09 → A-10 → A-16。
3. **再门禁**：A-02（影响发布判定，单独一步）。
4. **最后性能**：A-01 → A-06 → A-15（改动最大，需基准回归）。
5. **逐批验证**：每批后运行 V1–V8 端到端；性能批后重跑 100/300 文件基准。
6. **收口**：更新本报告 §四，逐项给出实测读数；不以"已改"代替"已验"。

### 验证边界

- 只修插件安装产物，不触碰宿主、不提交、不发版。
- UI 仅做静态核对（React 默认转义、CSP 为空域），不改 `dist/mcp-app.html`。
- 性能结论基于本机 Windows + NTFS；未在 Linux/macOS 复验。
- 修改后的插件包不再与 `.success` 记录的校验和一致，宿主若做完整性校验可能提示或重装，属预期外溢。

---

## 四、落地状态

**当前状态：A-01～A-17 已按本报告顺序完成修订。** 端到端回归 **15/15 通过**；性能基准见 §4.2。未提交、未发版。

修订前备份（仓库外）：`%TEMP%\crr-backup-20261106\`（`main.mjs.bak`、`SKILL.md.bak`、`review-standard.md.bak`、`report-delivery.md.bak`）。

### 4.1 逐项完成证据

| 编号 | 实际修订 | 定向验证 |
|---|---|---|
| A-01 | `readBlobs()` 用 `cat-file --batch-check` + `--batch` 批量取 blob；workspace 漂移由完整二次扫描改为 `status` + `stat` 指纹；`generateDiff` 改为异步 `execFile`，快照写入 8 路并发 | 300 文件 begin **150 488 → 10 328 ms**；100 文件 **49 946 → 4 335 ms** |
| A-02 | 仅在「无 changes 且无 findings」时保留 `change-unassigned` 兼容补组；其余交由 `assertCoverage` 拒绝 | 空 changes + finding 被拒（`findings.0.changeIndex`）；空报告仍可发布 |
| A-03 | `root.split("/").pop()` → `basename(root)` | Windows 实测 `repository.name = repo` |
| A-04 | 锁内写 `owner.json`（pid/createdAt），超过 `CODE_REVIEW_REPORT_LOCK_TTL_MS`（默认 5 分钟）自动接管 | 预置 10 分钟旧锁后发布成功（1.46 s）；新鲜锁仍互斥 |
| A-05 | 包装 `rev-parse` / `rev` / `merge-base`，映射 `NOT_A_REPOSITORY`、`GIT_UNAVAILABLE`、`INVALID_REVISION`、`NO_MERGE_BASE`，附 `action` | 无效路径与无效 ref 均返回可执行提示 |
| A-06 | 发布改用 `withContent:false` 元数据草稿 + `verifyWorkspaceSnapshot()` 内容哈希校验；仅在需要 excerpt 时水合对应文件 | 100 文件 publish **38 053 → 415 ms**；内容漂移仍被拒 |
| A-07 | 省略 `changeIndex` 时收集全部匹配组，多于一个即报字段级错误 | 双组同文件被拒，信息为 `Multiple change groups contain this file` |
| A-08 | 保留「finding 位置视为已审阅」行为，在交付规约中显式披露来源 | 文档 §reviewedPaths 已更新 |
| A-09 | `begin()` 前置 `prune()`：默认保留 100 份，`CODE_REVIEW_REPORT_MAX_REVIEWS` 可调；只清理最旧**已发布**审查 | `MAX_REVIEWS=2` + 4 次 begin：目录数稳定在 3（3→删 1→增至 3） |
| A-10 | 打开前 `lstat` 拒绝符号链接/非普通文件，保留 `O_NOFOLLOW` | 符号链接 reportPath 被拒 |
| A-11 | `summary()` 对 finding 描述截断至 600 字符并加省略号；完整文本仍在 `get_review_detail` | 代码审读 + 回归无异常 |
| A-12 | 删除 `ReportBatch` / `ReportBatchJsonSchema` / `DraftOperations` / `DraftOperationsJsonSchema` / `AnalysisJsonSchema` 及仅被其引用的中间契约 | `tools/list` 仍为 8 个工具，回归通过 |
| A-13 | `convertReport()` 返回前剥离 `reviewMarkdown`；schema 保留输入兼容 | 200 KB 输入可发布，`originalReview.reviewMarkdown` 为 undefined，`report.json` 5 318 B |
| A-14 | 内部 `changes` 上限 300 → 100，与适配层一致；删除 28 的旁支阈值 | 合法报告不受影响，回归通过 |
| A-15 | `pageRows()` 改为增量字节计量（骨架 + 逐项 + 逗号 + 游标/行号位数差） | 2 048 B 预算下 123 行分页、每页均 ≤ 预算、游标单调推进 |
| A-16 | Windows 且无存量 `~/.local/share` 目录时改用 `%LOCALAPPDATA%/code-review-report-plugin`；存量目录继续沿用 | 静态核对；测试均以 `TRAE_PLUGIN_DATA_DIR` 覆盖，未触发默认路径 |
| A-17 | `SearchCodebase` → `Read/Grep/Glob`；补充多组必须显式 `changeIndex`、finding 自动计入审阅、每文件必须分组或声明限制、`reviewMarkdown` 不落盘 | 三份规约与实现逐条对齐，无 `SearchCodebase` 残留 |

**修订过程中新增发现并已修复**：批量读取首版把全部 spec 送入 `--batch` 却只解析可读子集，导致内容错位（`src/app.js` 被误判为二进制）。已改为仅向 `--batch` 送入可读 spec，并由「二进制/大文件限制」用例捕获后复测通过。

### 4.2 回归读数

| 检查 | 结果 |
|---|---|
| 端到端回归（`crr-harness/regress.mjs`） | **15/15 通过** |
| 100 文件 workspace：`begin_review` | 4 335 ms（修订前 49 946 ms，**11.5×**） |
| 100 文件 workspace：`publish_review_report` | 415 ms（修订前 38 053 ms，**91.7×**） |
| 300 文件 workspace：`begin_review` | 10 328 ms（修订前 150 488 ms，**14.6×**） |
| 300 文件 workspace：`publish_review_report` | 478 ms（修订前未单测） |
| commit 范围 + `excerptRequests` | 发布成功；`get_code_excerpt` 返回 removed/added 两行 |
| `tools/list` | 8 个工具，与修订前一致 |
| `node --check server/main.mjs` | 通过 |

### 4.3 残余边界

- 未改动 `dist/mcp-app.html`，UI 侧仅做静态核对（React 默认转义、CSP 连接域为空）。
- 修订后插件包与 `.success` 记录的校验和不一致；宿主若做完整性校验，可能提示损坏或重新安装，属预期外溢。
- 性能读数基于本机 Windows + NTFS；未在 Linux/macOS 复验，`O_NOFOLLOW` 与符号链接行为按平台而异。
- A-16 只做静态核对，未在真实默认目录上跑迁移；已有 `~/.local/share` 数据的机器保持原路径。
- A-15 验证的是预算、分页行数与游标推进，未与旧实现做逐字节页内容对比。
- 未重跑真实业务仓库的完整审查；回归均使用临时仓库。

