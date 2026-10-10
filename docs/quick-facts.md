# 论衡速查卡（v18.91.2）

> **定位**：新人「第一眼需要知道的硬数字」**单一真源**——所有用户文档**只引本卡**、不在自己文档里复述数字。本卡是 `audit-report-v18.78.0.md` §7.2 立项的落地产物。
>
> **改这里 = 改主文档真源**。任何与本卡不一致的字面 = 漂移（`consistency-check.mjs` 不一定全机检覆盖，**主控人工复核**）。
>
> **维护者规则**：数字变更先改本卡、再 grep 全文核对「是否还在某文档中复述了旧数字」（v18.78.0 文档全量审计 §7.3）。

---

## 版本

| 项 | 值 | 真源 |
|---|---|---|
| 当前版本 | **v18.91.2** | `package.json#version` |
| 引擎锚定（子技能 `lunheng-commands`） | **v18.91.2**（规则 ㉖ 机械对账） | `skills/lunheng-commands/SKILL.md` description + L8 |

## 角色与 Phase

| 项 | 值 | 真源 |
|---|---|---|
| 角色数 | **9 个独立角色 T1-T9 + 主控 T0**（T0 = 调度 + T8 终检执行双重身份） | `references/glossary.md` §一 |
| Phase 主阶段数 | **6**（Phase 0-5，1.5/2.5/3.5/3.6/4.2/4.5/4.6/4.7 是子阶段） | `SKILL.md` §⚡ 启动速查表 |
| 人在环节点 | **4**（Phase 0 定题 / 2.5 大纲 / 3.5 洞察 / 5 终稿；Phase 3.6 T6 批判非人在环） | `references/agents/00-主控-扩展职责.md` §二十一 |

## 闸门 / 修订回环

| 项 | 值 | 真源 |
|---|---|---|
| 阶段闸门 | **2 道**（T2.5 检索→分析；T7.5 审计→终检） | `SKILL.md` §⚡ |
| **M 门总项数** | **机检 24 项 + 人工 1 项 = 总 25 项**（M-Form 11 + M-Exist 11 + M-Integrity-1 + M-Fact-1 = 机检 24；M-Integrity-2 = 人工 1） | `references/_shared/M-Gate-Algorithm.md` L23 |
| M 门脚本实测 `total` | **24**（与机检 24 一致；脚本头注释 v18.61.1 收口） | `skills/.../scripts/m-gate-check.mjs` L14 |
| G 清单 | **G0-G14 主项 15 个 + G15 模式相关项**（v18.18.0 口径，v18.34.0 更正） | `references/glossary.md` §二（G 清单） |
| 修订回环 | **三环制（A 轨 / B 轨 / G 环）**：A 轨 ≤2 轮纠错；B 轨至多 +1 深化（主控触发轮 T6/T9/洞察共享）；G 环 1-2 轮（v18.75.0 新立、G14 终闸 Warning/Fail 触发，**不占 B 轨**） | `references/glossary.md` §十二.1 |

## 文类档案（T9 启用决策树）

| 文类 | T9 视角 | T9 启用 | T9 后处置 |
|---|---|---|---|
| `academic-cn` / `academic-hum` / `academic-case` | 三视角 | **必选不可关** | B 轨 |
| `lit-review` | 三视角 | 可选（主人 Phase 0 选 on/off） | B 轨 |
| `course` / `book-review` / `policy` / `report-3rd` / `biz-review` / `industry` / `wechat` | 单视角 | 默认不选（主人 Phase 0 可显式开） | 只出建议件 |

> **真源**：`references/_shared/文类档案.md` §决策树（v18.77.0 P-9 收口）。
>
> **历史漂移（已修）**：v18.77.0 P-3 之前多份文档用通配 `academic-*`，现已全部收口为特指 `academic-cn/-hum/-case`（`AGENTS.md` / `QUICKSTART.md` / `skills/.../README.md` / `references/agents/00-主控-coordinator.md` / `references/glossary.md` §一 / `references/templates/status-template.md` / `status-template-lite.md` 七处，2026-10-06 修订落地）。

## 脚本 / 命令 / 一致性规则

| 项 | 值 | 真源 |
|---|---|---|
| 随包脚本（`skills/.../scripts/*.mjs` 顶层） | **32 个**（`_lib/` 子目录为共享库非入口，不计；v18.89.0 增补 `run-report`） | `SKILL.md` §执行能力边界「随包脚本白名单」行；`tests/scripts/list*.test.mjs` 派生命令（v18.18.0 审计修订：`P-5` 关闭「31 vs 35」误报） |
| `/lunheng` 斜杠命令数 | **11 个**（-draft/-resume/-cite/-audit/-journal/-ppt/-history/-rollback/-status/-stats/-help） | `skills/lunheng-commands/scripts/route-command.mjs` COMMANDS 表；`consistency-check.mjs` 规则 ㉕ 机械对账 |
| `cordis.patch.yml` 行数 | **4 行**（1 自注册 + 3 分档）+ **6 处 `!!js`**（3 disabled + 3 agentOptions） | `cordis.patch.yml` 实测 |
| `consistency-check.mjs` 主规则 | **37 类主规则**（v18.80.0 实测：㊲ 速查卡硬数字派生新立；**子规则计数不再声明**——带字母后缀的标签实测十余个，旧文写的「5 个子规则」本身就是同一类手写漂移；本卡这个数字由规则 ㉟ 机械对账，其余文档只许指向登记表） | 真源 = `skills/lunheng-article-pipeline/scripts/_lib/cc-rules/rule-registry.mjs` 的 `RULE_REGISTRY`（§五 各模块按 `// <编号> ` 形态登记规则级标签） |
| DSH 原生只读工具 | **4 个**（`lunheng_m_gate` / `lunheng_char_count` / `lunheng_handoff_check` / `lunheng_ethics_sanitize`；v18.60.1 加伦理脱敏） | `SKILL.md` §DSH 原生能力接缝 |
| **常驻上下文面**（每会话固定开销） | `SKILL.md` + `AGENTS.md` **合计上限 54.0 KB**（v18.88.0 **下调** 56→54 KB：依主人「多宿主收口」裁定——AGENTS.md §关键规则 7 组同事实条目收为指针 → 常驻集 54,812→53,310 B〔52.1 KB〕，按定案 ① 公式重核；v18.86.0 曾下调 60→56 KB）；逐文件上限 **40.0 / 16.0 KB**。⚠️ **长期目标 51,200 B 仍未达成（差 2,110 B）**：剩余为唯一宿主承重（子代理失败三段式 / M 门行〔有机械消费者〕/ 各条一句话判据），**再压须删承重**。余量/实测**逐轮以 `repo-hygiene-check` ⑨ 输出为准、本卡不复述**（复述即漂） | `scripts/repo-hygiene-check.mjs` 的 `ALWAYS_LIMIT` + `DOC_BUDGET`（规则 ⑨）；**上限与逐文件值由规则 ㊲ 机械对账** |
| **词预算登记数** | **51 条**（≥12 KB 的 `.md` 逐文件棘轮）；**合计上限 1505 KB**（v18.90.0 首次登记 `docs/installation.md` 13 KB ＋ `SECURITY.md` 32→35 KB〔新增可选 HTTP 读面的强制披露〕；v18.88.0 下调一条：`AGENTS.md` 19→16 KB〔多宿主收口，长期目标已达成〕/ 上调一条：`maintainers.md` 34→41 KB 承接迁入；v18.88.0-prep 首次登记 `errors.md` 14 KB）；实测合计同左**不复述**（逐轮以规则 ⑨ 输出为准） | 同规则 ⑨；报告逐轮打印「越线 N 条 / 余量 <1 KB N 条 / 建议下调」三段；**条数与上限由规则 ㊲ 机械对账** |

## 退出码族（按 §真源排序）

| 脚本族 | 码 | 含义 |
|---|---|---|
| **M 门族**（`m-gate-check.mjs`） | 0 / 1 / 2 / 3 / **30** / 70 | 通过 / P1 / P0 / 仅 P2·soft·SKIP（需 LLM 复核）/ `--adjudicate` 裁定被拒（红线/四件套/缺 `true_p0`；v18.12.0 L-05）/ 内部错误（EX_SOFTWARE） |
| **所有脚本**（含 M 门） | **10** | 参数或路径错（含异常路径，`_lib/exit-guard.mjs` 统一映射，**不得与 P1 撞码**） |
| `model-routing.mjs` | **4** | 需人工决定（与 M 门 3 语义**刻意分离**，不可读作「可放行」） |
| `handoff-check.mjs` | **20 / 21 / 22** | 产物缺失或 0 字节（重派）/ 结构·版本·成对·回报段不合（续接补交）/ 仅软提示（人工复核放行）——**与 M 门 1/2/3 刻意分离** |
| `md2html.mjs` | **40** | 导出被拒 / `--strict` 校验失败（v18.12.0 起；**不是** M 门「2 = P0」） |
| **所有脚本**（含 M 门） | **70** | 内部错误（EX_SOFTWARE）——`exit-guard` 对非 fs 类未捕获异常使用；与内容判定无关 |
| **门内解析/读取失败** | **70** | `severity: 'ERROR'`（v18.62.4 §8 全量审计 P1-3 起；`final-check.mjs` 不得读成「P1 残留」） |

> **判据**：只要脚本**不做内容判定**，它的 `1` 就一定是撞码（v18.12.0 已把全部「用法/参数错」收口到 `10`）。
> **真源**：`docs/troubleshooting.md` §8 + `AGENTS.md` §关键规则 + `_lib/exit-guard.mjs`。

## 实战案例

| 时段 | 真源 |
|---|---|
| v2.x 期间（2026-08 前后） | `docs/introduction.md` §实战验证（v2.2.8-dsh.2/3 公众号短评 + v2.3.7-dsh.8 甲醛白菜事件 4200 字深度文） |
| v18.x 期间（2026-08 ~ 2026-09） | `README.md` 顶部 Verification status 表（6 个 case：品牌一致性 7900 字 / 原创性悖论 9500 字 / 教师田野隔离 12000 字 / 生成式 AI 学生写作 2000 字 / 甲醛白菜 4200 字 / Notion vs. idea 哲学论文 6280 字） |
| 历次反哺合并入角色卡 | `references/case-studies.md`（v18.x 阶段案例库；SKILL.md 不重复维护） |

> **历史口径声明**：「修订轮」数 = 该 run 的全部写手轮次（含 Phase 3.5 洞察 → v2、批判/T6 修订、G14 轮、审计打回）；**Phase 4.2 审计打回 ≤2 轮是子集上限**——两者量纲不同，不可混读（README.md L202「How to read this table」段已明示）。
>
> **重跑注意**：v18.18.x 起跑通的产物再用当前脚本重跑，会因 M 门新增项（如 M-Form-9/10/11、M-Exist-7）报历史 P0——**视为历史快照、不为交付参考**。

## 路径速查

| 项 | 路径 |
|---|---|
| 主文档（新人首屏） | `README.md` → `docs/introduction.md` → `skills/lunheng-article-pipeline/SKILL.md` → `references/glossary.md` |
| 概念单一真源 | `skills/lunheng-article-pipeline/references/glossary.md` |
| 流水线协议 | `skills/lunheng-article-pipeline/references/pipeline-readme.md` |
| M 门算法 | `skills/lunheng-article-pipeline/references/_shared/M-Gate-Algorithm.md` |
| 派发话术（开工卡） | `skills/lunheng-article-pipeline/references/dispatch-cards.md` |
| 维护者手册 | `skills/lunheng-article-pipeline/references/maintainers.md` |
| DSH 集成 | `skills/lunheng-article-pipeline/references/_shared/DSH-集成方案.md` |
| 排错 | `docs/troubleshooting.md` |
| 安装 | `docs/installation.md` |
| 使用流程 | `docs/usage.md` |

---

> **速查卡修订记录**：
> - **2026-10-06**（v18.78.0）：本卡初版。依据 `audits/论衡插件文档全量审计-v18.78.0.md` §7.2 立项；起草依据 SKILL.md / glossary.md / 文类档案 / consistency-check.mjs / m-gate-check.mjs / troubleshooting.md / cordis.patch.yml 真源。
> - **改这里之前必读**：`references/glossary.md` §十二「文档约定」（v18.22.1 CTX-1）——本卡对硬数字集中维护的判据与该节「一事实多处 + 多宿主」刻意偏离同源。
