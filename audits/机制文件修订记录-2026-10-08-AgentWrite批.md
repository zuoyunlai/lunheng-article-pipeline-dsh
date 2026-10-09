# 机制文件修订记录 — 2026-10-08 · AgentWrite 借鉴批（AW-1 / AW-2）

> **授权依据（如实标注）**：主人 2026-10-08 直接指令「请开始修订吧」——依 `AGENTS.md` §机制文件写保护「唯一例外」（主人明确下令 = 可写），走五步安全流程。
> **方案真源**：两份评估报告（**主人裁定不入库**——评估原文本地保留于 `<工作区>/_backup/lunheng-2026-10-08-agentwrite/评估报告/`）：
> ① `反哺报告-AgentWrite借鉴评估-v1.md`（外部项目解剖 + 四档分类）② `修订评估-AgentWrite借鉴-成本收益风险-v1.md`（**决策件**：复核后把 A 档从 4 项砍到 2 项）。**本文件是库内唯一执行留痕**，不重复论证。
> **版本**：18.82.0 → **18.83.0**（minor：新增**仓库级**脚本能力面 + 两份规范登记行 + 一个词表；**零新增随包脚本、零新增退出码**——白名单计数 31 不变，消融读数不参与任何 exit 语义）。
> **改前备份**：`<工作区>/_backup/lunheng-2026-10-08-agentwrite/`（**366 文件**：skills/{scripts,references,SKILL.md,AGENTS.md} + 仓库级 scripts + tests + docs + examples + lib + 根级 .md/.yml/.json 全量）+ 行数基线 `_baselines.txt`。
> **回滚** = 用备份覆盖对应文件 + 删除本批新增文件（`scripts/ablation-report.mjs`、`tests/ablation-report.test.mjs`、`audits/消融/`、`audits/失败样本台账.md`）+ `node scripts/bump-version.mjs 18.83.0 18.82.0` + `git checkout -- skills/ scripts/_lib/doc-budget-reasons.mjs docs/quick-facts.md CHANGELOG.md`。

## 改动清单（按批次）

### 批 1 · AW-1 机制消融读数（对应评估 §三 A1，**减配版**）

| 文件 | 改动 |
|---|---|
| `scripts/ablation-report.mjs`（仓库级，**不随包**） | 新增：对 `run/*/final/定稿.md` **存量回放**三个战略门 + 可读性四指标；硬命中（P0/P1）与软提示（P2）**分列**；体例不适用记 **N/A**（照抄 `quality-score.mjs` 的 N/A 分支）；**只做存量回放，禁止为做实验重跑完整项目**；产物路径**相对化**（过 `localpath` 门）；exit 0/10/70 |
| `tests/ablation-report.test.mjs` | 新增 4 条：路径错 exit 10 / 参数错 exit 10 / 空 run 如实报 0 份 / 夹具进表 + JSON 契约 + 硬软分列不变量（`hard+soft+ok == denom`） |
| `audits/消融/README.md`（仓库级） | 新增：格式模板 + **四条硬纪律** + **诚实条款**（非预注册、循环风险） |
| `audits/消融/QLT-7-机械门存量回放-v1.md` | 新增：首轮读数（29 份样本）——**含两处口径缺陷的修正留痕** |
| `references/_shared/规范-机械门对照表.md` §三 | 新增行「**新增机制的可消融性声明**」（刻意不做成门） |

### 批 2 · AW-2 失败样本根因分类（对应评估 §三 A2，**减配版**）

| 文件 | 改动 |
|---|---|
| `references/errors.md` | 新增 **§2.0 根因分类词表**（八类）；12 条错误各增 `根因类` 行。**实测 11972 B，未越 12 KB 登记线**（余 316 B） |
| `audits/失败样本台账.md`（仓库级） | 新增：10 条逐行可追溯的历史样本（每条附 `file:line` 证据 + 复现命令 + 是否已进回归夹具 + `review_status`）+ 四条纪律 + 分布表（含「未填不判失败」「允许写『无（语义类）』」「只增不改」） |
| `references/_shared/规范-机械门对照表.md` §三 | 新增行「**失败样本的根因分类**」（刻意不做成门） |

### 批 3 · 不做项（**如实登记**，防「以为做了」）

| 项 | 判定 | 理由（一句话） | 再议触发条件 |
|---|---|---|---|
| **A3 动作级撤销台账** | ❌ 不做 | 等价物已覆盖 90% 暴露面：正文修订**本就强制版本制**（`05-写作-writer.md`「先复制新版本再改」+ `drafts/archive/`）、`fix-gates`/`cite-format` **零写盘**、`refresh-gates` 只替换正则锚定指纹且有 `--dry-run`、写盘安全网 temp+rename+`.bak` | 出现一次「批量改写后无法还原到改前」的真实事故 |
| **A4 质量信号驱动的分场景降级** | ❌ 不做新阈值体系 | 信号面**已在** `lunheng-stats.mjs`（门拦截频率 TOP / 覆盖率 / 轮数 / token）；而其动作侧与「**度量不是闸门**」「**禁止静默降级**」两条铁律冲突 | 连续 ≥3 个项目同一读数异常，且人工确认该读数对应质量损失 |
| **B1 流水线清单（manifest）** | ❌ 不做 | 成本最高（牵动 `consistency-check` + `docs-facts` + 62 脚本），收益不确定 | 再次出现「字面断言失明」类事故（AGENTS.md 已登记一次） |
| B2 / B5 / B6 / B7 | ⏸ 未排期 | 各 ≤半天、收益低-中，留待按需启用 | 见评估报告 §二补 逐条 |

### 同批维护

- **词预算棘轮抬升 1 条**（同提交写明理由）：`references/_shared/规范-机械门对照表.md` 50→**52 KB**（实测 51019 B；改前余量 1885 B，两行吃掉 1704 B 后仅剩 181 B → 按定案 ① 公式归位）；`docs/quick-facts.md` 合计上限 1467→**1469 KB**（条数 49 不变）。
- **版本级联** 18.82.0 → 18.83.0（`bump-version.mjs` 机械替换 **87 文件**；历史注解未动）。
- **落点偏离（如实）**：A1 的可消融性声明原定落 `maintainers.md`，改为落 `规范-机械门对照表.md` §三——理由是前者余量仅 135 B（再写必撞棘轮）、后者余量 1885 B 且本就是「规范 ↔ 门」的真源。

## 验证（终态）

| 门 | 结果 |
|---|---|
| 全量测试（双 glob） | **953/953 全绿**（实测 953 tests / 952 pass / **0 fail** / 1 skip；对比 v18.82.0 = 949，+4 = 本批新增）✓ |
| `consistency-check` | **0 处漂移**（85 个 .md + cordis.patch.yml/examples/.dsh 同步）✓ |
| `repo-hygiene-check` | **全部通过**（棘轮已归位；词预算 49 条 / 合计 1469 KB / 实测 1396.4 KB）✓ |
| `self-check` | **15/15 PASS**（0 FAIL / 0 N-A / 0 SKIP；31 个脚本 143 处相对导入全部可解析）✓ |
| `closeout-verify`（收口批两步） | **差集为空 + 无陈旧「未做」登记**（审计 12 个 ID × 12 份修订记录；第 1 步分列：被修订记录处理 12/12、仅被 CHANGELOG 提及 0）✓ |
| `dsh-plugin-dev check` | **本机不可用**（npm 404，与 v18.82.0 同）——该门由 CI `plugin-surface` job 承担，**如实声明** |

**本批在验证过程中被三道门抓出的问题（如实登记，均为我自己的缺陷）**：

1. `consistency-check` 抓出 **BOM 污染**（`audits/消融/QLT-7-*.md`）——根因：本机 shell 是 **Windows PowerShell 5.1**，`Set-Content -Encoding UTF8` **会写入 BOM**（且 `utf8NoBOM` 枚举不存在，我的一次尝试直接报错、未写盘）。已用 .NET `UTF8Encoding($false)` 剔除，并改走 `edit` 工具 / .NET API。
2. `repo-hygiene-check` 抓出 **`localpath`**（报告含**本机绝对路径** 2 处）→ 改为**产物路径相对化**（脚本内 `relative(cwd, runDir)`），报告重生成。
3. `repo-hygiene-check` 抓出 **`lib-line-ref`**（`ablation-report.mjs` 注释里 2 处裸行号）→ 改**符号引用**（行号随改动漂移）。
4. `tests/docs-facts.test.mjs` 的 CHANGELOG 计数门抓出**我的验证结论措辞不合形态**（缺 `N/N 全绿`）→ 已按本门要求改写为实测值。
5. **意外写入了本批之外的文件**：BOM 扫描误伤 `tests/round-ledger.test.mjs`（该文件的 BOM 是**既存**的，`consistency-check` 的扫描面不含 `tests/`）→ **已 `git checkout` 还原**，保持本批 diff 干净。

## 遗留与移交

1. **首轮读数只有两处可用**：`cite-coverage` 硬拦价值 0 + 软提示近乎恒真（可下结论）；`methodology` 2 例具体命中（待核查）。`structure`（n=2 <5）与 `readability`（**循环**：阈值就在这批稿上标定）**本轮不可用**——下一轮先逐稿取 `--genre`/`--humanities` 再重跑。
2. **`errors.md` 距 12 KB 登记线仅 316 B**——下一次编辑该文件前**先核棘轮**（否则要同批登记并更新 `quick-facts` 条数/合计）。
3. **发版前未跑 `no-write-check`**（该门会重跑全量套 + 四道具，耗时长）——**tag 之前必跑**（`AGENTS.md` §文件修改操作约束）。
4. **部署镜像：本机不存在独立镜像**（实测工作区 `.dsh\skills\…` 与用户级 `~\.dsh\skills\…` 均不存在；本会话加载的就是**仓库内** `lunheng-article-pipeline-dsh\skills\lunheng-article-pipeline`——可由 AGENTS.md 版本头实时变为 v18.83.0 佐证）⇒ **本机无需同步**。若日后在别的机器上装 bundle / 镜像，须按 `references/` 路径映射 `cp`，且**不要在镜像上改**（镜像不含 `tests/`，改了再回流 = 跳过契约验证）。
5. **发版**：提交 → `git tag v18.83.0` → 推 tag（CI 自动 publish）；`latest` 若不跟随，手工 `npm dist-tag add lunheng-article-pipeline@18.83.0 latest`。
