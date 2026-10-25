> 版本：v1.0.3（lunheng-commands 独立技能包）

# /lunheng 命令路由表（单一真源）

> 本文档是 13 个命令如何路由到论衡阶段的**唯一真源**（`-cite` 含 3 种模式：默认 / `-auto` / `-manual`；`-h` 是 `-help` 的别名——命令数真源 = `scripts/route-command.mjs` 的 COMMANDS 表，v18.7.3 定案口径「11 个命令」**v19.27.8 增补为 13 个**：新增主人侧 `-gate` / `-abort`）。
> 修改命令行为只改本文档 + `route-command.mjs`；
> `SKILL.md` 只列命令清单与文档锚点。

<a id="draft"></a>

## `-draft [task]`

**行为**：等效 `@lunheng-article-pipeline`，启动完整流水线。
**参数**：`[task]` 可选；省略时主控走 Phase 0 定题关卡（含三段式外部服务授权串 `检索=` / `推理=` / `脱敏=`）。
**论衡阶段**：Phase 0 → 1 → 2 → 2.5（人）→ 3 → 3.5（人）→ 3.6 → 4 → 4.5（配图）→ 4.6（G14 终闸）→ 4.7（T9 审稿）→ 5

<a id="resume"></a>

## `-resume <id>`

**行为**：载入 `run/<id>/01-任务简报.md` + `status.md` + `agents-log.md`，恢复到上次中断点。
**参数**：`<id>` 必填，项目目录名（`run/<id>/`）。
**论衡阶段**：从 status.md 的当前阶段继续。

<a id="cite"></a>

## `-cite <text>`

**行为**：调用 DSH 原生 `auto_cite` 对 `<text>` 段落补强引用。
**消耗 AI4Scholar 积分**——本命令调的就是 DSH 原生 `auto_cite`（计费工具）。旧版此处写「默认免费（借鉴 Ai4Scholar v2.9.5"斜杠命令引用免费"）——不消耗积分」属**未经证实的断言**，v18.18.1 删除。
**参数**：`<text>` 必填。
**论衡阶段**：T5 写手后辅助工具，不影响流水线。

<a id="cite-auto"></a>

## `-cite -auto`

**行为**：对当前 `final/定稿.md` 全文跑 auto_cite 全量校验。
**消耗 AI4Scholar 积分**（同 `-cite`，全文跑积分更高）。
**论衡阶段**：**Phase 5（T8 终检之内）**——落在 T8 终检顺序的 **③ 冻结定稿并记 sha256 之后、⑥ 跑 M 门与 ⑦ 裁定之前**（**v18.75.0 定案**；旧文为「Phase 4.5 终稿前」）。此时 `final/定稿.md` 已由 T8 落盘（**旧时点下它尚不存在——本命令无对象可跑**，与该「行为」行写的作用对象自相矛盾）。**顺序契约**：本校验之后正文不得再变；若它报出的缺项要改正文 → 走 **G 环**（重跑 G14 至 Pass 并重新冻结）后**重跑本校验**。

<a id="cite-manual"></a>

## `-cite -manual <marker>`

**行为**：手动模式（用户已在文本中标记 `[CITE]`）。
**参数**：`<marker>` 必填，标记文本（如 "[CITE]"）。
**论衡阶段**：同 `-cite`。

<a id="audit"></a>

## `-audit`

**行为**：仅跑 T7 G 审计 + M 门，不修改稿件。
**论衡阶段**：Phase 4 审计（不改稿）。
**输出**：`audits/审计报告-vN.md` + `final/M-Gate-Report.json`。

<a id="journal"></a>

## `-journal <name>`

**行为**：修改任务简报 §目标期刊 + 重跑 T9 + 期刊匹配。
**参数**：`<name>` 必填，期刊名。
**论衡阶段**：Phase 4.7 审稿（重跑）。

<a id="ppt"></a>

## `-ppt`

**行为**：把当前定稿 → PPT 大纲（生成 Markdown 表格，可导入 Gamma / Ai4Scholar PPT）。
**论衡阶段**：Phase 5 终检后辅助输出。
**输出**：`run/<id>/exports/ppt-outline.md`。

<a id="history"></a>

## `-history` / `-history --diff <id1> <id2>`

**行为**：
- 默认：列 `run/*/` 所有项目（项目名 + 最后修改时间 + 当前阶段）。
- `--diff`：对比两个项目（基于 sha256 + 文件级 read）。

**数据源**：`run/<id>/history.jsonl`（论衡 v18.7.0 项目化新增字段）。

<a id="stats"></a>

## `-stats` / `-stats --run-dir <path>` / `-stats --json`

**行为**：调用论衡 v18.5.0 已有的 `scripts/lunheng-stats.mjs`（运行时遥测看板），输出 `run/` 目录下所有项目的汇总看板：
- 项目名 / 当前阶段 / 修订轮数 / M 门状态 / P0-P1-P2 计数 / 字数 / 审稿评分 / token 消耗
- 末尾自动汇总：项目分布（final/empty/draft）+ M 门证据分类（机器/LLM 兜底/无）+ 累计 P0/P1/P2
- 门拦截频率 TOP：跨项目统计哪些 M 门被触发最多

**参数**：
- `--run-dir <path>`：扫描指定目录（默认 `<cwd>/run`）
- `--json`：JSON 输出（程序化消费）

**薄壳实现**：`lunheng-commands/scripts/stats-cli.mjs` spawn 调用论衡 `lunheng-stats.mjs`，透传所有参数与退出码。

**数据源**：三位置回退（run/<id>/final/M-Gate-Report.json → audits/M-Gate-Report-vN.json → audits/M-Gate-final.json）+ drafts/ 时间戳 + final/字数控件。

**v18.7.0 → v18.7.1 bug fix**：v18.7.0 lunheng-commands v1.0.1 发布时漏注册此命令（论衡 v18.5.0 已存在但未纳入斜杠命令包装）；v18.7.1 补回。

<a id="rollback"></a>

## `-rollback <id> --confirm`

**行为（v19.6.1 · 全量审计-2026-10-15 P2-10 如实更正）**：本命令**只做两件事**——① 校验 `--confirm`（缺则提示并中止）；② 产出路由 token（`action: 'rollback'`），checkpoint 参数原样透传。

> ⚠️ **项目级 checkpoint 尚未实现（如实声明，不留矛盾）**：全仓**没有任何脚本**创建 `run/<id>/checkpoints/`，也没有可执行的恢复逻辑（`scripts/route-command.mjs` 只解析 token、**零副作用**）。本行此前写「从 `run/<id>/checkpoints/phase-XX/` 恢复到指定 checkpoint」属**文档承诺 > 实现**。**现行可用的回滚是文件级的**：`_lib/destructive-write.mjs` 在每次覆盖写前留时间戳 `.bak` 回滚点（回滚 = `cp <文件>.<时间戳>.bak <文件>`），另加 git 历史。**判据：本命令返回成功 ≠ 项目已被回滚**；需要项目级回滚时须先落地 checkpoint 生产者。

**二次确认**：`--confirm` 必填；缺则提示「将自动确认回滚，请重试并加 --confirm」。
**论衡阶段**：设计意图是影响 status.md + 重置 agents-log.md——**当前无实现**（同上）。

<a id="status"></a>

## `-status [id]` / `-status --pending`

**行为**：
- 默认（带或不带 `[id]`）：显示**单项目**进度（≤15 行人类可读版）。
- **`--pending`（v18.62.0 F4 新增）**：**跨项目「待我决策」聚合收件箱**——扫 `run/*/`，输出「现在需要主人做什么」。

**参数**：`[id]` 可选；省略时取最新项目。`--pending` 与 `[id]` 互斥（给了 `--pending` 即走聚合）。
**数据源**：
- 单项目：`run/<id>/status.md` + Dashboard 头部。
- `--pending`：① `run/*/阶段确认-Phase{0,2.5,3.5,5}.md` 的 **§6 未回填 / 缺门**；② `run/*/进展-主人版.md` 的「🙋 需要你做的事」段。**纯聚合、零新数据、零新留痕义务。**

**`--pending` 的三条口径**（避免收件箱变噪声）：
1. **项目判据** = 目录含 `01-任务简报.md`（Phase 0 的机械标记）。`run/` 下的基线快照 / 测试 / 归档目录**跳过**并单独计数（实测本机 7 个）。
2. **已交付项目的历史留痕缺口不进收件箱**——`final/定稿.md` 存在且无主人侧待办时，归入「历史缺口」一行汇总（那些是**审计面**问题，不是「点一下就能推进」的事）。
3. **只报「需人工回核」的项，不判结论**（与 `closeout-verify` 同判据）：§6 已回填只证明回复被记录，不证明内容对。

**实现**：`lunheng-commands/scripts/pending-cli.mjs`（`--run-dir <path>` / `--json`）。
**退出码**：`0` 已列出（含「无待办」）/ `10` 参数或路径错 / `70` 内部错。**不做内容判定，故不存在 `1/2/3`**（按本仓判据，非判定类脚本的 `1` 一律是撞码）。

**论衡阶段**：任意阶段可查。

<a id="gate"></a>

## `-gate <项目> <Phase> --approve|--reject [--note "…"]`

**行为**（v19.27.8 · 审计 P2-2）：把主人的裁定**写成回执**，而不是让主控转录。
机械实现 = `scripts/owner-cli.mjs gate`。

- 追加一行到 `run/<项目>/audits/gate-receipts.jsonl`：
  `{gate, round, answeredAt, rawAnswer, tool:"owner-cli", callIdSource:"not-captured", decision:"approve"|"reject", ...}`
- **`rawAnswer` 就是主人打的字**（`--note` 的原文；不给则 `主人 CLI 裁定：<Phase> 通过|驳回`）。A7 会要求
  `阶段确认-<Phase>.md` §6「主人原话」**逐字**含它——差额就是转录篡改的证据。
- `--approve` 与 `--reject` 必须且只能给一个（路由层 `route-command.mjs` 与 `owner-cli` 两处同判据）。
- `round` = 该门已有回执数 + 1；回执 id 形如 `Phase2.5#2`，填进 §6「回执 id」。

**它不代劳的部分**（刻意）：不写 §6、不改 `status.md`、不删除任何产物——那些是主控写面。
主控须把同一句 `rawAnswer` 逐字回填 §6 并填「提问方式 = 主人 CLI（-gate）」。

**退出码**：`0` 已写入 / `10` 用法或参数错 / `20` 项目不存在或路径越界（`lib/run-path-fence.mjs` 判）。

**论衡阶段**：四门任一（Phase 0 / 2.5 / 3.5 / 5）。

<a id="abort"></a>

## `-abort <项目> [--reason "…"]`

**行为**（v19.27.8 · 审计 P2-2）：主人中止项目。机械实现 = `scripts/owner-cli.mjs abort`。

- 落 `run/<项目>/audits/abort.json`：`{abortedAt, reason?, by:"owner-cli", firstAbortedAt?}`（重复调用覆盖并保留首次时间）。
- 主控**在下一个门边界立即停**：不派发新角色、不删任何已落盘产物（中止 ≠ 回滚；删产物会让账本与门记录对不上）。
- 只写这一个文件，**不动** `status.md` / 交付件 / 证据包。

**退出码**：`0` 已落标记 / `10` 用法错 / `20` 项目不存在或路径越界。

**论衡阶段**：任意阶段。

<a id="help"></a>

## `-help`

**行为**：列可用命令 + 简述。