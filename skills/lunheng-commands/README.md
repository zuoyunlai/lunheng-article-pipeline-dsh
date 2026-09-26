# lunheng-commands v1.0.0

> 论衡（`lunheng-article-pipeline` v18.7+）的斜杠命令薄壳 wrapper。

## 是什么

论衡本身是"一次性黑盒触发"——`@lunheng-article-pipeline` 启动完整流水线后，用户写完想改引用 / 换期刊 / 加 PPT 时只能重新走完整流水线。

`lunheng-commands` 提供 11 个 `/lunheng -X` 斜杠命令供**中途干预**使用——主控仍按论衡原机制运行；本包仅做"用户意图 → 论衡阶段调用"的翻译层（薄壳 wrapper）。

## 11 个命令

```
/lunheng -draft [task]      # 启动完整流水线
/lunheng -resume <id>       # 续跑已有项目
/lunheng -cite <text>       # 对段落跑 auto_cite（默认免费）
/lunheng -cite -auto        # 全文 auto_cite
/lunheng -cite -manual <m>  # 手动模式（用户已标 [CITE]）
/lunheng -audit             # 仅跑 G 审计 + M 门（不改稿）
/lunheng -journal <name>    # 改目标期刊 + 重跑 T9
/lunheng -ppt               # 长文 → PPT 大纲
/lunheng -history           # 列 run/* 历史
/lunheng -rollback <id> --confirm  # 回滚到 checkpoint
/lunheng -status [id]        # 显示当前进度
/lunheng -help              # 列可用命令
```

## 借鉴来源

[2026-09-22 调研 https://ai4scholar.net/](https://ai4scholar.net/) 后的第一梯队落地。详见论衡仓库 [`audits/反哺报告-v4-lunheng-commands斜杠命令.md`](../../audits/反哺报告-v4-lunheng-commands斜杠命令.md)。

**Ai4Scholar 借鉴点**：
- **v2.9.5**「斜杠命令合并重复的引用/搜索为统一入口」——避免 UX 噪声
- **v2.9.5**「🆓 斜杠命令引用免费」——`/lunheng -cite` 不消耗 auto_cite 积分
- **v2.9.5**「写作页斜杠命令」——`/lunheng` 在 DSH 聊天框随时触发

## 安装

```bash
# 方式 1：本地技能根
cp -r lunheng-commands/ <DSH_HOME>/skills/lunheng-commands/

# 方式 2：项目技能根
cp -r lunheng-commands/ <workspace>/.dsh/skills/lunheng-commands/
```

## 测试

```bash
cd lunheng-commands/
node --test tests/route.test.mjs
```

## 设计原则

1. **薄壳 wrapper**：不引入新角色、新阶段、新 M 门；所有重活走论衡 9 角色流水线
2. **二次确认**：`/lunheng -rollback` 必须 `--confirm`，防误操作
3. **单一真源**：所有命令路由细节见 `references/command-routing.md`

## 与论衡的关系

| 维度 | lunheng-commands | lunheng-article-pipeline |
|------|------------------|--------------------------|
| 角色数 | 0（薄壳） | 9 个独立角色 T1-T9 |
| 流水线 | 不引入 | Phase 0-5 + 三角验证 + M 门 + G 审计 |
| 引用模板 | 不引用 | 5 格式（APA/IEEE/Vancouver/Nature/numbered） |
| auto_cite 集成 | 命令路由 | 完整集成约定（见论衡 `references/_shared/auto_cite-integration.md`） |
| 项目目录 | 不引入 | `run/<项目>/` 完整产物树 |

## License

MIT — Copyright (c) 2026 左运来 (zuoyunlai)