# status 模板（精简版，v2.2.14）

> **精简版**：只保留骨架，详细说明见 [`status-template.md`](status-template.md)

```markdown
# Status

> **位置**: `run/<项目名>/status.md`
> **使用**: 主控独占写（子代理只读 + 交接报告回报）

## 当前状态

- 🔄 In Progress / ✅ Done / ❌ Failed
- 角色: T1 / T2 / T3 案例 / T4 分析 / T5 写手 / T6 批判 / T7 审计 / T9 审稿（可选默认选中，学术必选）/ T8 终检（独立角色，主控执行）
- 启动时间: YYYY-MM-DD HH:MM
- 当前模型: deepseek-v4-pro（或 LUNHENG_* 分档）
- **审计视图刷新时间（v18.2.5 新增硬检查项）**: YYYY-MM-DD HH:MM ｜ 视图源: <final/定稿.md ｜ drafts/初稿-vN.md ｜ 素材阶段>
  > **怎么用**：每次**派 T4 / T5（修订轮）/ T6 / T7 / T9 / G14 之前**，主控须跑 `node scripts/build-evidence-bundle.mjs <项目> --summary` 刷新 `audits/审计视图-v0.md`，并把刷新时间写在本行；**该时间必须晚于最新 `drafts/初稿-vN.md` 的 mtime**。视图陈旧时子代理只能按「产物实质 + 索引段」自兜底，token 优化空转（实测：本项目 4 次派发全部未刷新，T6/T7 均自主声明「审计视图陈旧」）。

## 执行记录（DSH 精简版：无心跳/ack/硬卡）

- 交接报告六要素: ✅
- 主控介入: 无 / [介入 HH:MM] 说明
- 失败记录: 无 / [Failed HH:MM] 角色 X 原因

## 修订回环记录

- v1 → v2: [日期 + 修改内容]
- v2 → v3: [日期 + 修改内容]
- 归档中间态到 archive/
```

---

**精简版结束**

> 完整版见 [`status-template.md`](status-template.md)