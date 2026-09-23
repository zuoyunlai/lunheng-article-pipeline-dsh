> 版本：v1.0.0（lunheng-commands 独立技能包）

# /lunheng 命令路由表（单一真源）

> 本文档是 11 个命令如何路由到论衡阶段的**唯一真源**。
> 修改命令行为只改本文档 + `route-command.mjs`；
> `SKILL.md` 只列命令清单与文档锚点。

<a id="draft"></a>

## `-draft [task]`

**行为**：等效 `@lunheng-article-pipeline`，启动完整流水线。
**参数**：`[task]` 可选；省略时主控走 Phase 0 同意关卡（4 选 1）。
**论衡阶段**：Phase 0 → 1 → 2 → 2.5（人）→ 3 → 3.5（人）→ 3.6 → 4 → 4.5 → 5

<a id="resume"></a>

## `-resume <id>`

**行为**：载入 `run/<id>/01-任务简报.md` + `status.md` + `agents-log.md`，恢复到上次中断点。
**参数**：`<id>` 必填，项目目录名（`run/<id>/`）。
**论衡阶段**：从 status.md 的当前阶段继续。

<a id="cite"></a>

## `-cite <text>`

**行为**：调用 DSH 原生 `auto_cite` 对 `<text>` 段落补强引用。
**默认免费**（借鉴 Ai4Scholar v2.9.5"斜杠命令引用免费"）——不消耗积分。
**参数**：`<text>` 必填。
**论衡阶段**：T5 写手后辅助工具，不影响流水线。

<a id="cite-auto"></a>

## `-cite -auto`

**行为**：对当前 `final/定稿.md` 全文跑 auto_cite 全量校验。
**默认免费**。
**论衡阶段**：Phase 4.5 终稿前辅助工具。

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
**论衡阶段**：Phase 4.5 审稿（重跑）。

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

<a id="rollback"></a>

## `-rollback <id> --confirm`

**行为**：从 `run/<id>/checkpoints/phase-XX/` 恢复到指定 checkpoint。
**二次确认**：`--confirm` 必填；缺则提示「将自动确认回滚，请重试并加 --confirm」。
**论衡阶段**：影响 status.md + 重置 agents-log.md。

<a id="status"></a>

## `-status [id]`

**行为**：显示当前项目进度（≤15 行人类可读版）。
**参数**：`[id]` 可选；省略时取最新项目。
**数据源**：`run/<id>/status.md` + Dashboard 头部。

<a id="help"></a>

## `-help`

**行为**：列可用命令 + 简述。