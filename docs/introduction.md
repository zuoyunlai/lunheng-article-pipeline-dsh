# 论衡：一个多 Agent 深度长文生产流水线（DeepSeek Harness 插件）

> 把一篇「有深度、要站得住脚」的长文/论文，拆成 7 个角色、5 个阶段，用三线并行检索 + 三角验证 + 独立审计，自动生产出有证据底座、有反方论证、有人工核验节点的交付物。

## 一句话简介

**论衡（lunheng-article-pipeline）** 是一个以「子代理编排」为核心的写作流水线：它不是让一个 AI 直接写文章，而是让一支**由 7 个 AI 角色组成的"论文生产小队"**按既定协议协作——定题 → 三线并行检索 → 分析 → 写作 → 审计 → 终检，每一步都有明确的产出物、交接报告和质量闸门。

它最初为 OpenClaw 编写，现已完整移植为 **DeepSeek Harness（dsh）bundle 插件**，开箱即用。

---

## 它解决什么痛点

用 AI 写深度长文/论文，最常见的翻车点：

1. **幻觉编造**——引用是假的、数据是编的；
2. **观点堆砌**——材料一堆，但每条都不支撑论点；
3. **单边叙事**——只讲支持自己的话，没有反方论证；
4. **重复已有文章**——写出来的东西早就有人写过了，还当成原创；
5. **质量不可控**——AI 一次成稿，没有人独立挑错。

论衡的答案，是把这些问题**交给结构化流程 + 多角色分工**去化解，而不是指望单个模型自觉。

---

## 核心设计：8 角色 + 5 阶段

```
主控 Coordinator（定题、拆解、派发、阶段闸门、终检、状态机）
  │
  ├─ T1 文献检索员 ── 文献卡 [Lxx]（A/B/C 可信度分级 + GB/T 7714 条目）+ 先行者清单
  ├─ T2 数据检索员 ── 数据卡 [Dxx]（🟢🟡🔴 时效评级 + 信任级别 + 冲突口径并列）
  ├─ T6 案例检索员 ── 案例卡 [Cxx]（事件结构 + 多方立场 + ≥2 来源，任何量级必 spawn）
  ├─ T3 分析员     ── 分析大纲（论点-论据映射 + 反方论证规划 + 三角验证）
  ├─ T4 写手       ── 初稿（引用/数据/案例全标编号）
  ├─ T8 批判伙伴   ── 批判报告（C1-C5 反方攻击，v2.2.2 新增，轻量档可跳过）
  ├─ T5 审计员     ── 审计报告（G0-G13 全项检查，只审不改）
  └─ 主控终检      ── M 门（M-Form/M-Exist/M-Integrity）+ 定稿 + 证据包 + 交付说明
```

五个阶段：**Phase 0 定题 → Phase 1 并行检索 → Phase 2 分析 → Phase 3 写作 → Phase 4 审计 → Phase 5 终检**，中间穿插 T2.5/T5.5 完整性门与四个「人在环」节点。

---

## 三大亮点

### ① 三线并行检索 + 三角验证

Phase 1 一次性并行派出 **T1 文献 ∥ T2 数据 ∥ T6 案例** 三个检索员，三方真并行、互不干涉：

- T1 只写 `literature/`，T2 只写 `data/`，T6 只写 `cases/`，边界清晰；
- 三张卡共同构成「三角验证」——任何核心论点必须能映射到 [Lxx]（学术依据）+ [Dxx]（量级数据）+ [Cxx]（具体事件）至少两项，缺角就标缺口，严禁编造；
- **T6 任何量级必 spawn**：哪怕主题"无需案例"，也会走「0 条空卡协议」——T6 显式声明无案例需求，输出 [C-空] 空卡，保证流程可审计、不留下"到底查没查案例"的模糊地带。

### ② 独立审计闭环（G0-G13 + M 门）

审计员 **只审不改**，与写手分离，执行 15+ 项检查（G0-G13，含 G12 信任级别一致性 / G13 AI 使用披露）：

- **G1 分级核验**：C 级引用 100%、B 级 ≥50%、A 级 ≥10% 用 web_search 实测核验，抓到假引用升级 P0 并全量核验；
- **G2 数据溯源**：每个数字找来源，数据卡没有的 → P0；
- **G7 原创性审计**：对照先行者清单，重复未声明 → P0；
- **G8 成品度 / G9 时序 / G11 时效 / G12 信任级别**：过程语言残留、时间倒挂、过期数据、信任级别缺失逐一拦截。

审计打回 → 写手修订 → 复核，**最多 2 轮**硬约束（仍不过走 Acknowledged Limitations 模式）。终检前主控跑 **M 门**（LLM 兜底执行的机械化终检：M-Form 6 + M-Exist 3 + M-Integrity 2），exit 0 才交付。

### ③ 人在环四节点

定题、大纲、洞察补充、终稿四个节点必须主人过目，改方向成本最低的阶段由人把关，避免 AI 一路跑偏。

---

## DSH 适配（从 OpenClaw 到 DeepSeek Harness）

插件对 DSH 环境做了完整适配：

| 原 OpenClaw 工具 | DSH 对应 |
|---|---|
| `sessions_spawn` | `subagent`（后台、可续接） |
| `tavily_search` | `web_search`（`site:` 限定站点） |
| `update_plan` | `todo_write` |
| `sessions_history/list` | `list_agents` |
| `image_generate`（封面） | 无内置 → SVG 矢量风 / 主人投喂 |
| `exec` / `apply_patch` | `pwsh`/`bash` / `edit` |

工具集由 DSH 的 Agent 预设决定，模型路由由 `settings.yaml` 配置，技能开箱即用。

---

## 快速上手

```sh
# 1) 安装到 profile
dsh plugin --profile web add lunheng-article-pipeline

# 2) 加入 bundles 清单
#    $DSH_HOME/profiles/web/package.json 的 dsh.profile.bundles 追加 "lunheng-article-pipeline"

# 3) 重启 dsh web
```

安装后，新会话的 `skill` 工具目录会出现 `lunheng-article-pipeline`。使用时直接说「加载 lunheng-article-pipeline 技能」或交给它一个深度文章主题即可，它会先走 Phase 0 定题确认。

> **安装注意**：① 目标机器需有 pnpm（`dsh plugin` 内部转 pnpm）；② `dsh plugin add` 只装包、**不会**自动把 bundle 加进 `dsh.profile.bundles`——第 2 步必须手动做；③ 用 `dshmarket` 市场的用户会看到「校验失败」误报（它只认 JS 入口，不认 `dsh.bundle.patch`），不影响实际使用。

---

## 实战验证

- **商业热点深度文**：8 节 / 7650 字 / 2 数据图 / 52 文献 / 60 数据点，全流程约 2 小时；
- **品牌一致性深度文**：~7900 字，证据包 15 文献 + 54 数据点，审计复核 8 项全修复；
- **短视频未成年人保护论文**（三线并行验证跑）：T1 产出 12 文献 + T2 产出 28 数据点 + **T6 独立产出 5 案例卡**，三线真并行验证通过，20 次 web_search 核验零编造。

---

## 获取方式

- **GitHub（DSH bundle）**：https://github.com/zuoyunlai/lunheng-article-pipeline-dsh
- **npm**：`lunheng-article-pipeline@2.2.8-dsh.1`（`npm i lunheng-article-pipeline@dsh`）
- **OpenClaw 原版**：https://github.com/zuoyunlai/lunheng-article-pipeline

---

## 结语

论衡把「写一篇好文章」这件看似靠才华的事，拆解成了一套**可复制、可审计、可交接**的工程流程：证据底座防幻觉，三角验证防堆砌，反方论证防单边，先行者检索防重复，独立审计防质量漂移，人在环防跑偏。

它尤其适合：公众号深度文章、研究报告、学术论文、长文评论——以及任何"要站得住脚"的长内容生产场景。
