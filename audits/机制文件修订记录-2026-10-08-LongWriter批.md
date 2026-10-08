# 机制文件修订记录 — 2026-10-08 · LongWriter 借鉴批（LW-1/LW-2/LW-3）

> **授权依据（如实标注）**：主人 2026-10-08 直接指令「请开始依次全部修订」——依 `AGENTS.md` §机制文件写保护「唯一例外」（主人明确下令 = 可写），走五步安全流程。
> **方案真源**：借鉴评估报告 `反哺报告-LongWriter借鉴-2026-10-08-v1.md`（**主人裁定不入库**——评估原文本地保留于 `<工作区>/_backup/lunheng-2026-10-08-longwriter/`；本文件是其执行留痕与库内唯一记录，不重复论证）。
> **版本**：18.80.5 → **18.82.0**（minor：新增脚本能力面与角色卡机制条目，零新增随包脚本、零新增退出码）。
> **改前备份**：`<工作区>/_backup/lunheng-2026-10-08-longwriter/`（196 文件）；回滚 = 用备份覆盖对应文件 + `node scripts/bump-version.mjs 18.82.0 18.80.5`。

## 改动清单（按批次）

### 批 1 · LW-2 Sl 观测分
| 文件 | 改动 |
|---|---|
| `skills/.../scripts/segment-chars.mjs` | 增 `--budget <分析大纲.md>` 模式（预算表解析 + Sl 柔性分 + weightedSl/missing/unbudgeted）；exit 家族不变 |
| `skills/.../scripts/quality-score.mjs` | 增顶层 `lengthProfile` 观测字段（非 components 分量，不动分数与基线） |
| `skills/.../references/_shared/字数判定表.md` | 增 §六「Sl 观测分」（不判级双轨声明） |
| `tests/segment-chars.test.mjs` | +3 用例 |

### 批 2 · LW-1 前文锚
| 文件 | 改动 |
|---|---|
| `skills/.../references/agents/05-写作-writer.md` | 读清单增「前文锚」条（≥5000 字档；摘要注入非全文） |
| `skills/.../references/agents/04-分析-analyst.md` | §11「论证主线」增节间承接规划要求 |
| `skills/.../references/pipeline-readme.md` | T5 派发话术增 1.3 前文锚行 |
| `tests/docs-facts.test.mjs` | +1 防瘦身心线断言（三处真源齐备） |
| `tests/batch15-qlt5-docs.test.mjs` | 行引用锚 928→929（v18.82.0 LW-1 链注） |

### 批 3 · LW-3 生成上限探针
| 文件 | 改动 |
|---|---|
| `scripts/ruler-probe.mjs`（仓库级，**不随包**） | 新增：--plan / --record 两段式；countHan 同源口径；不内置真实 LLM 调用 |
| `skills/.../references/_shared/模型路由.md` | 增 §十「有效生成上限实测表」（≤80% 判据 / 兜底 3000 / 90 天过期） |
| `tests/ruler-probe.test.mjs` | 新增 3 用例 |

### 同批维护
- 棘轮抬升 2 条（`scripts/_lib/doc-budget-reasons.mjs`，理由同提交写明）：字数判定表 15→18 KB / 模型路由 21→24 KB；`docs/quick-facts.md` 合计 1461→1467 KB。
- 版本级联 87 文件（bump-version.mjs）；历史注解未动。
- `CHANGELOG.md` 增 `## 18.82.0` 段。

## 验证（终态）

| 门 | 结果 |
|---|---|
| 全量测试（双 glob） | **949 tests / 948 pass / 0 fail / 1 skip** ✓ |
| `consistency-check` | 85 个 .md + 同步面，0 处漂移 ✓ |
| `repo-hygiene-check` | 全部通过（含棘轮、localpath）✓ |
| `self-check` | 15/15 PASS ✓ |
| `pack-smoke` | 通过（发布物 3303 KB / 187 文件，可装载）✓ |
| `dsh-plugin-dev check` | **本机不可用**（npm 404；该门由 CI `plugin-surface` job 承担）——如实声明 |

## 遗留与移交

1. **LW-1 试点**：按方案批 2 建议，前文锚机制在下一个 ≥5000 字实战项目试点一轮后再定稿判据（试点报告落 `audits/试点报告-LW1-pilot-*.md`）。
2. **LW-3 实测**：模型路由 §十 表当前全为「待实测」——主人维护期跑 `ruler-probe --plan/--record` 后回填；未实测期间 T5 单节预算按兜底 3000 汉字。
3. **同车批**：代码内注记 v18.81.0 的「独立审计批」改动随本版一并交付，其 CHANGELOG 段待补。
4. **发版**：提交 → `git tag v18.82.0` → 推 tag（CI 自动 publish + `npm dist-tag add ... latest`）。
