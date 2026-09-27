# 机制文件修订记录 — 2026-09-27（C-7 ⑧c 写盘词表补 `writeReport` · v18.29.1）

> **授权依据**：本次机制文件改动**依据主人显式授权**——主人 2026-09-27「继续」。对应 `AGENTS.md` §机制文件写保护 的唯一例外条款。
> **配套方案**：`audits/反哺报告-v18.22.0-上下文效率质量三维优化方案.md` §五.1 实施顺序（本批 = 收尾梯队第 2 项）。
> **来源**：v18.29.0 自己登记的「已知缺陷」（见 `CHANGELOG.md` §18.29.0 三 与 `机制文件修订记录-2026-09-27-EFF5-来源索引.md` §五），**判据已在上批写明**，本批执行。
> **交付提交**：本批单 commit（见 `git log`）+ tag `v18.29.1`。
> **回滚**：备份位置 `<DSH_HOME>/_backup/lunheng-v18.29.1-20260927/`（root `scripts/` 全量 17 文件 + `SECURITY.md` + `tests/script-surface.test.mjs`）。回滚 = 覆盖回该备份 + `git checkout -- SECURITY.md CHANGELOG.md`。

## 一、缺陷本体（为什么这是「门犯了自己要抓的错」）

`scripts/_lib/script-surface.mjs` 的 `CONTENT_WRITE_PATTERNS` 收了 `writeWithSafety`，却**漏了 `writeReport`**。
`writeReport`（`skills/lunheng-article-pipeline/scripts/_lib/destructive-write.mjs`）是 `--report <path>` 的**唯一**写盘出口——内部 `return writeWithSafety(reportPath, text, { inPlace: true })`，会**真的改变目标文件内容**并留时间戳 `.bak`。

**后果**：只用 `writeReport` 写报告的脚本被判为「只读」/「仅建目录」，`SECURITY.md` 的「写内容面」**低报执行面**。
**讽刺点**：该模块开头自己写着——这类手写清单「失真方向几乎总是**低报执行面**」。**门也会犯它要抓的错**，这是本批最值得记下的一条。

## 二、改动清单

| 文件 | 改动 |
|---|---|
| `scripts/_lib/script-surface.mjs` | `CONTENT_WRITE_PATTERNS` 增 `['writeReport', /(?<![\w.])writeReport\s*\(/g]`；头部「分档口径」补该词条的成因注解（含九个受影响脚本名与「必须与反向自证同时做」） |
| `SECURITY.md` | 随包脚本行「写文件面」**整段重排**：写内容面列全 16 个并写明其中十一个经 `writeReport`（同文件守卫 + 时间戳 `.bak` + 缺失目录自动建）；**仅建目录面本版为空**且写明留位理由；「只读」补计数 10。第 31 行派生口径表补 `writeReport` |
| `scripts/repo-hygiene-check.mjs` | ⑧c 的 note 文案改为由 `drifted` 派生（连带修复，见 §四） |
| `tests/script-surface.test.mjs` | 7 → **9** 用例：新增「词表回归（writeReport ∈ 写内容）」与「真源里 writeReport 调用者必须全在写内容面」；旧断言「仅建目录面应非空」按事实改写（见 §五） |

## 三、收口后的三档实测

| 档 | 改前 | 改后 |
|---|---|---|
| 子进程 | 4 | **4**（不变） |
| 写内容 | 7 | **16** |
| 仅建目录 | 2 | **0** |
| 只读 | 17 | **10** |
| 合计 | 27 | 27 |

九个新升档的脚本：`cite-coverage-check` / `final-check` / `g-audit-check` / `journal-fit` / `m-gate-check` / `meta-synthesize` / `methodology-check` / `sources-index` / `structure-check`。

**为什么必须与 `SECURITY.md` 同批**：派生词表一改，双向差集会在**三个档位同时红**（写内容 onlyDerived 九个 / 仅建目录 onlyDoc 两个 / 其余连带）。词表与文档是一个**原子变更**，拆开做中间态必红。

**为什么把「仅建目录」留成空档而不是删档**：① 解析器的结束 marker 是「只读」，删掉该档会连带改解析器（无谓扩大改动面）；② 该档口径有效，将来真出现「只造目录不写内容」的脚本时它会被自动填充。**留空 + 写明理由**，是为了断掉「为了让它非空而注水」这条歪路。

## 四、连带修复（反向自证时抓到）：⑧c 那行 note 的**假陈述**

反向自证第 ① 步（故意删掉 `writeReport` 词条）时暴露：门已经 `fail`（红），**同一行的 note 却仍打印「与 SECURITY.md 双向一致」**——文案写死、不看比较结果。
这正是本仓反复记录的「**门还在、但看的东西已经错了**」同族形态（与 `parseSecuritySurface` 第一版「结束 marker 找不到就切到行尾」的静默降级同源）。
**已改为**：`drifted` 由本次差集派生 → 有漂移打印「**不一致（差异见上）**」，无漂移打印「双向一致」。
**判据**：**门的结论文案必须由本次比较结果派生，不得硬编码**——写死的「通过」类文案，在门变红的那一刻就变成了假证据。

## 五、一条旧断言按事实改写（不是放松，是换成真实不变量）

`tests/script-surface.test.mjs` 原断言 `assert.ok(d.mkdirOnly.length > 0, '仅建目录面应非空')`——本版该面**合法为空**。
**若保留它**，后来者面对红灯只有两条路：改回错误的词表，或**往 `SECURITY.md` 塞一个源码里没有的脚本名**——后者正是本门（⑧c）存在的意义所反对的「清单注水」。
**故改为**：断言该面**可解析**（可为空数组）+ 三档合计不下限（防空转），并把「三档 + 只读之并集恰好等于全部脚本」这条**真实不变量**留在原处继续承担非空性守卫。

## 六、反向自证（三种破坏形态逐个验红，复原后复绿）

脚本 `%TEMP%\c7-reverse-proof-writeReport.mjs`（改 → 跑 → 复原，全程可回滚）：

| # | 破坏形态 | 期望 | 实测 |
|---|---|---|---|
| ① | **词表漏项**：删掉 `writeReport` 词条 | ⑧c 红 | exit 1；`写内容面：SECURITY.md 列了 …（九个）但源码里已无该能力`；note 打印「**不一致**」 |
| ② | **文档漏列**：从 `SECURITY.md` 写内容面删 `sources-index.mjs` | ⑧c 红 | exit 1；`写内容面：源码派生出的 sources-index.mjs 未写进 SECURITY.md…（低报执行面）` |
| ③ | **文档注水**：往写内容面塞 `ghost-report.mjs` | ⑧c 红 | exit 1；`写内容面：SECURITY.md 列了 ghost-report.mjs 但源码里已无该能力` |
| ④ | **复原** | 复绿 | exit 0；⑧c 打印「双向一致」 |
| — | **复原字节一致** | 必须 | 两个文件读回原文 `===` 比较均 `true`（防「自证脚本本身改了文件却没说」） |

**两层自证的关系**：① 是**端到端**（门级），`tests/script-surface.test.mjs` 的「词表回归」是**单元级**（fixture 里删词条即红）。两层都要，是因为端到端自证靠临时改文件、不可常驻；常驻的那层必须由测试承担。

## 七、验证

| 项 | 结果 |
|---|---|
| 门 | 四道具全绿（consistency 0 漂移 / plugin-surface 9 过 0 失败 / repo-hygiene 全过：⑧c **子进程 4 / 写内容 16 / 仅建目录 0 / 只读 10** 双向一致、⑨ 词预算 30 文档全覆盖 + 未登记 0 / pack-smoke 通过） |
| 测试 | 全量套 **431/431**（v18.29.0 = 429 → **+2**） |
| 反向自证 | 四步见 §六，逐条命中 |

## 八、边界（如实，未做）

- 本模块仍是**按 API 名字的静态扫描**，不是 AST：`import { writeReport as w }` 之类**换名调用**扫不到（已有常驻用例记录该边界）。本批只补了「漏项」，没有改解析口径。
- `apply-compression-cycle.mjs` **自身不写盘**（只 spawn 转调），仍归「子进程面 + 只读」——它经 `consistency-check` / `build-evidence-bundle` **间接**写盘的效果写在 `SECURITY.md` 的补充边界里，不在本派生口径内。这是**刻意**，不是遗漏。
