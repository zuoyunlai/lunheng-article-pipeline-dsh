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