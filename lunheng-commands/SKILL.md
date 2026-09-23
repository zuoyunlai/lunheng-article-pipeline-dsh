---
name: "lunheng-commands"
version: "1.0.0"
description: "lunheng-commands v1.0.0：论衡（lunheng-article-pipeline）的斜杠命令薄壳 wrapper。11 个命令：-draft 启动完整流水线 / -resume 续跑项目 / -cite 对段落跑 auto_cite（默认免费，借鉴 Ai4Scholar v2.9.5）/ -cite -auto 全文 auto_cite / -cite -manual 手动模式 / -audit 仅跑 G 审计 + M 门 / -journal 改目标期刊重跑 T9 / -ppt 长文→PPT 大纲 / -history 列历史 / -rollback 回滚（需 --confirm）/ -status 进度。不替代论衡；所有重活仍走 lunheng-article-pipeline 的 9 角色 + 三角验证 + M 门 + G 审计。**不适用**：<2000 字短文与即时问答；实时聊天 / 朋友圈 / 邮件。"
whenToUse: "「何时该用」与「何时不该用」的完整判据已并入 description（v18.0.5：官方目录只渲染 name + description，本字段对模型不可见，保留仅供工具链与维护者阅读）。"
---

> 版本：v1.0.0（独立技能包，2026-09-23）
> **本包为论衡 v18.7.0 配套技能**：依据 `audits/反哺报告-v4-lunheng-commands斜杠命令.md`，作为论衡 v18.7.0 整合发布的一部分独立发布。
> **本包为薄壳 wrapper**：所有重活仍走 `lunheng-article-pipeline` 子代理；本包仅做"用户意图 → 论衡阶段调用"的翻译层。

# 论衡斜杠命令外壳

## 定位

论衡（lunheng-article-pipeline）当前是"一次性黑盒触发"，用户写完想改引用 / 换期刊 / 加 PPT 时只能重新走完整流水线。本包提供 11 个斜杠命令供中途干预使用。

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
| `-help` | 列可用命令 | [command-routing.md#help] |

## 不适用场景

- 短文（<2000 字）：直接用 LLM 答，不走命令
- 实时聊天 / 朋友圈 / 邮件：不适用
- 一次性脚本：直接调论衡子代理，不走本 wrapper

## 工具边界

- ✅ 可调用：DSH 当前会话预设的所有工具
- ✅ 白名单：论衡随包脚本（清单见论衡 SKILL.md §执行能力边界）
- ❌ 不做：自动 commit / 自动 publish / 自动 apply 机制文件改动

## 安装

两种方式（二选一）：

1. **本地技能根**：`cp -r lunheng-commands/ <DSH_HOME>/skills/lunheng-commands/`（rank 400）
2. **项目技能根**：`cp -r lunheng-commands/ <workspace>/.dsh/skills/lunheng-commands/`（rank 100，会顶替用户级）

## 与论衡的关系

- lunheng-commands 是 **薄壳**：不引入新角色、新阶段、新 M 门
- 论衡的所有 M 门 / G 门 / F 模式不变
- `history.jsonl` 等新增文件**写在项目目录 `run/<id>/`**（项目级，不污染论衡机制）
- 论衡 SKILL.md description 含「/lunheng -X 命令也可触发」的路由提示