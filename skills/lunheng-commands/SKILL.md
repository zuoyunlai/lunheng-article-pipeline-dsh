---
name: "lunheng-commands"
version: "1.0.3"
description: "lunheng-commands v1.0.3 是论衡 v18.90.8 **内嵌子技能**——11 个 /lunheng 斜杠命令 UX（薄壳 wrapper，不引入新角色 / 新 M 门）。-status --pending = 跨项目「待我决策」聚合收件箱；-rollback 需 --confirm。版本信息见 frontmatter `version` 字段。"
whenToUse: "「何时该用」与「何时不该用」的完整判据已并入 description（v18.0.5：官方目录只渲染 name + description，本字段对模型不可见，保留仅供工具链与维护者阅读）。v18.7.1 起：本技能随论衡 bundle 自动安装——`dsh plugin add lunheng-article-pipeline` 即获，无需单独 install。"
---

> 版本：v1.0.3（v18.62.4 全量审计-v18.62.3 落地；2026-10-01）｜引擎版本引用当前锚定 **v18.90.8**
> **v1.0.3 变更**：① **修复 CLI 入口不可用**（P1-4）——`scripts/route-command.mjs` 旧入口把 `process.argv` 直接交给 `routeCommand`，而 `argv[1]` 恒为**脚本路径** → `argv[1] !== '-lunheng'` 恒真 → **任何真实命令都只打印用法并 exit 1**，help 表与 JSON 输出从未可达（单测只传合成 argv，故测不到）。现入口改为 `['node','-lunheng', ...process.argv.slice(2)]`，并补 **6 条端到端用例**（真 spawn 进程 + 一条源码级回归钉）。② 引擎版本引用当时由 v18.62.0 更正为 **v18.62.4**——但该口径此后又随包漂移到 v18.62.5 而无人发现（规则 ㉖ 原先只管子技能自己的 1.0.x）。**v18.67.0 已把「引擎版本锚定」纳入规则 ㉖ 机检**：`论衡 vX.Y.Z **内嵌子技能**` 声明式锚点必须等于主包 `package.json` 版本，同类漂移不再可能静默存活。
> **版本同步点（7 处，改动须同批）**：本文件 frontmatter `version` + 本行 + `README.md` 标题 + `package.json` `version` + `references/command-routing.md` 版本头 + `scripts/route-command.mjs` 头注释 + **「引擎版本引用当前锚定」行**（v18.67.0 新增，由规则 ㉖ 机检）——**v18.20.0 审计的 P1-① 正是只改了其中三处留下的漂移**，勿重演。（v18.62.4 更正：本行原写「5 处」而实际列了 6 项。）
> **v18.7.1 升级**：从独立 npm 包**嵌入**到论衡 bundle 内——`skills/lunheng-commands/` 作为论衡第二个技能自动注册。所有 11 个 /lunheng 命令免单独安装。
> **本包为薄壳 wrapper**：所有重活仍走 `lunheng-article-pipeline` 的子代理；本包仅做"用户意图 → 论衡阶段调用"的翻译层。

# 论衡斜杠命令外壳（v18.7.1 内嵌）

## 定位

论衡（lunheng-article-pipeline）当前是"一次性黑盒触发"，用户写完想改引用 / 换期刊 / 加 PPT 时只能重新走完整流水线。本技能提供 11 个 `/lunheng -X` 斜杠命令（-cite 含 3 种模式）供中途干预使用。

## v18.7.1 安装方式

- ✅ **自动嵌入**（推荐）：`dsh plugin add lunheng-article-pipeline` 即获——论衡 lib/index.js 自动注册两个技能（lunheng-article-pipeline + lunheng-commands）
- 兼容旧方式（⚠️ **v18.69.0 起如实标注依赖**）：`cp -r skills/lunheng-commands/ <DSH_HOME>/skills/lunheng-commands/` 会**缺依赖**——`history-cli` / `pending-cli` 自 v18.62.5 起 `import ... from '../../../lib/run-path-fence.mjs'`（三层围栏真源），单独复制技能目录后该 import 即断。请优先走自动嵌入；确需独立部署时连 `<repo>/lib/` 一并放入，或改回「技能目录自足」的打包方式。

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
| `-status --pending` | **跨项目「待我决策」聚合收件箱**（v18.62.0 F4；扫 `run/*/` 的 §6 未回填 + 进展页待办） | [command-routing.md#status] |
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