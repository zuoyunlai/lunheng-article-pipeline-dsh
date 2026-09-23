---
name: "lunheng-commands"
version: "1.0.1"
description: "lunheng-commands v1.0.1：论衡 v18.7.1 **内嵌子技能**，提供 12 个 /lunheng 斜杠命令 UX（-draft/-resume/-cite/-audit/-journal/-ppt/-history/-rollback/-status/-stats/-help）。薄壳设计：不引入新角色 / 新阶段 / 新 M 门；所有重活仍走论衡 9 角色流水线。-cite 默认免费（借鉴 Ai4Scholar v2.9.5）；-rollback 需 --confirm 二次确认；-stats 显示 run/ 项目汇总看板（包装论衡 v18.5.0 lunheng-stats.mjs）。**不适用**：<2000 字短文与即时问答；实时聊天 / 朋友圈 / 邮件。"
whenToUse: "「何时该用」与「何时不该用」的完整判据已并入 description（v18.0.5：官方目录只渲染 name + description，本字段对模型不可见，保留仅供工具链与维护者阅读）。v18.7.1 起：本技能随论衡 bundle 自动安装——`dsh plugin add lunheng-article-pipeline` 即获，无需单独 install。"
---

> 版本：v1.0.1（v18.7.1 内嵌子技能，2026-09-23）
> **v18.7.1 升级**：从独立 npm 包**嵌入**到论衡 bundle 内——`skills/lunheng-commands/` 作为论衡第二个技能自动注册。所有 12 个 /lunheng 命令免单独安装。
> **本包为薄壳 wrapper**：所有重活仍走 `lunheng-article-pipeline` 的子代理；本包仅做"用户意图 → 论衡阶段调用"的翻译层。

# 论衡斜杠命令外壳（v18.7.1 内嵌）

## 定位

论衡（lunheng-article-pipeline）当前是"一次性黑盒触发"，用户写完想改引用 / 换期刊 / 加 PPT 时只能重新走完整流水线。本技能提供 12 个 `/lunheng -X` 斜杠命令供中途干预使用。

## v18.7.1 安装方式

- ✅ **自动嵌入**（推荐）：`dsh plugin add lunheng-article-pipeline` 即获——论衡 lib/index.js 自动注册两个技能（lunheng-article-pipeline + lunheng-commands）
- 兼容旧方式：`cp -r skills/lunheng-commands/ <DSH_HOME>/skills/lunheng-commands/`（rank 400，独立覆盖场景）

## 命令集

| 命令 | 论衡阶段 | 文档 |
|------|---------|------|
| `-draft [task]` | 启动完整流水线（等效 @lunheng-article-pipeline） | [command-routing.md#draft] |
| `-resume <id>` | 续跑 `run/<id>/` 已存在的项目 | [command-routing.md#resume] |
| `-cite <text>` | 调用 auto_cite（DSH 原生）补强段落 | [command-routing.md#cite] |
| `-cite -auto` | 对当前 `final/定稿.md` 全文跑 auto_cite | [command-routing.md#cite-auto] |
| `-cite -manual <marker>` | 手动模式（用户已标 [CITE]） | [command-routing.md#cite-manual] |
| `-audit` | 仅跑 T7 G 审计 + M 门 | [command-routing.md#audit] |
| `-journal <name>` | 改目标期刊 + 重跑 T9 | [command-routing.md#journal] |
| `-ppt` | 把当前定稿 → PPT 大纲（生成 Markdown） | [command-routing.md#ppt] |
| `-history` | 列 `run/*/` 历史 + 支持 `--diff <id1> <id2>` | [command-routing.md#history] |
| `-rollback <id> --confirm` | 回滚到 checkpoint | [command-routing.md#rollback] |
| `-status [id]` | 显示当前进度（status.md 内容，≤15 行） | [command-routing.md#status] |
| `-stats` | run/ 目录项目汇总看板（包装论衡 v18.5.0 lunheng-stats.mjs） | [command-routing.md#stats] |
| `-help` | 列可用命令 | [command-routing.md#help] |

## 不适用场景

- 短文（<2000 字）：直接用 LLM 答，不走命令
- 实时聊天 / 朋友圈 / 邮件：不适用
- 一次性脚本：直接调论衡子代理，不走本 wrapper

## 工具边界

- ✅ 可调用：DSH 当前会话预设的所有工具
- ✅ 白名单：论衡随包脚本（清单见论衡 SKILL.md §执行能力边界）
- ❌ 不做：自动 commit / 自动 publish / 自动 apply 机制文件改动

## 与论衡的关系

- lunheng-commands 是 **薄壳**：不引入新角色、新阶段、新 M 门
- 论衡的所有 M 门 / G 门 / F 模式不变
- `history.jsonl` 等新增文件**写在项目目录 `run/<id>/`**（项目级，不污染论衡机制）