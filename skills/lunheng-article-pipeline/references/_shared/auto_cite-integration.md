> 版本：v18.7.1（DSH bundle 插件）

# auto_cite 集成约定（v18.7.1 借鉴 Ai4Scholar v2.9.1）

> **本文件由论衡 v18.7.1 一次性发布新增（依据 4 份反哺报告整合）；不再变更单独发布。**
> **本文件性质**：机制文件（references/_shared/ 下），默认禁写；改进动议只写 `audits/反哺报告-vN.md`。

## 何时调用

- **T5 写手 v1 完成后**：对每段引用做完整性检查，缺卷期页码 → 触发 Phase 1.5 补检索
- **Phase 4.5 终稿前**：跑一次 auto_cite 全量校验，确保所有 [Lxx]/[Dxx] 通过 100% 真实性核验
- **主人通过 `/lunheng -cite` 命令触发**（详见反哺报告 v4 + 论衡 SKILL.md description + lunheng-commands 技能包）
- **T3.5 auto_cite 预标注阶段**（可选，详见反哺报告 v2）

## 调用参数（与 DSH 原生 auto_cite 工具对齐）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| field | "computer science" | 学术领域倾向（从任务简报 §论文类型 自动映射） |
| min_citations | 5 | 最小引用数（仅 auto 模式有效） |
| citation_style | 任务简报 §引用格式 默认值 | APA / IEEE / Vancouver / Nature / numbered |
| exclude_preprints | true | 排除预印本（投稿论文场景） |
| exclude_conferences | false | 不排除会议论文 |
| year_preference | (无) | 优先年份（如 2024） |

## 失败处理

- **API 积分不足** → 自动降级到自维护 [Dxx]/[Lxx] 库，不抛错；在交接报告标「⚠ auto_cite 降级」
- **找不到匹配文献** → 输出「⚠ 该论点无匹配真实文献」，T7 标 P1
- **部分引用有卷期页码，部分无** → 报告「差异覆盖率 X%」，T8 终检记录偏差
- **auto_cite 推荐的引用与已有 [Lxx] 重复** → 提示「已有相同文献 Lxx」，避免重复入卡

## 与论衡已有机制的对齐

- **引用模式锁定**（v2.2.10）：auto_cite 输出必须遵循任务简报 §引用模式（编号 / 内联）
- **数据信任级别**（v2.2.1）：auto_cite 推荐文献的信任级别由其数据源决定（Semantic Scholar = 已发布 / 二手转引 = 需回溯）
- **三角验证**（v2.3.7）：auto_cite 不替代 T1 文献检索；仅在 T5 v1 后做"补强"扫描

## 跨工具边界

auto_cite 调用 DSH 原生 AI4Scholar 工具（消耗积分），主控须在任务简报 §v2.5.0 可选项 显示预估积分成本。