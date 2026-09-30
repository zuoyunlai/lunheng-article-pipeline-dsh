# 决策记录 — v18.61.0 文档 M 门项数口径漂移诊断

> **类型**：诊断（**不动仓库文件**——主人 2026-09-30 说"我觉得有些文档太大，可能存在口径不一致，逻辑错误以及冗余"，要求**详细的检查**——按主人授权"诊断不修订"原则）
> **仓库真源**：`<REPO>`（v18.0.1 教训 #153：实现与测试同居的目录才是真源——所有 `<REPO>` 在主人 host shell 实际位置由 `git rev-parse --show-toplevel` 解析）
> **触发**：主控主人 2026-09-30 在论衡 v18.61.0 push 后请主控做文档体检
> **作者**：主控 T0（会话模型）
> **日期**：2026-09-30
> **状态**：诊断完成，等主人 review

---

## 一、实测真值（v18.61.0 = v18.60.1 + v18.25.0 M-Fact-1 + v18.27.0 M-Exist-11 后的真实形态）

跑实测：

```sh
node skills/lunheng-article-pipeline/scripts/m-gate-check.mjs \
  audits/机制文件修订记录-2026-09-30-反哺v3全批.md audits
```

实测 JSON 输出关键字段：
- **`total: 24`**
- `pass: 14, p0: 8, p1: 0, p2: 1, soft: 0, skips: 1`
- `hard_red_line_hits: [M-Form-2(P0), M-Form-7(P0), M-Integrity-1(P0)]`

**真值 24 = M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1**
- M-Form 11 项（脚本 `mform-gates.mjs` import 1-11）
- M-Exist 11 项（脚本 `mexist-gates.mjs` import 1-11）
- M-Integrity 1 项机检 + **1 项人工** = M-Integrity-2（**不在脚本 `total` 里**）
- M-Fact 1 项（脚本 `mfact-gate.mjs` import 1）
- **总 25 = 机械 24 + 人工 1（M-Integrity-2）**

---

## 二、口径漂移清单（仓库文档对 M 门项数的各种说法）

按仓库 `grep -E "22 项|23 项|24 项|25 项|M-Form 1-11|M-Exist 1-11"` 扫得：

### A. **过时（写 22 / 23）— 应改为 24 / 25**

| 文件 | 行 | 当前文本 | 应改为 |
|---|---|---|---|
| `scripts/m-gate-check.mjs` | L11 | "本脚本机检 **22 项**（M-Form 11 + M-Exist 10 + M-Integrity-1 佐证）" | "本脚本机检 **24 项**（M-Form 11 + M-Exist 11 + M-Integrity-1 + M-Fact-1）" |
| `scripts/m-gate-check.mjs` | L12 | "M 门**总项数 23 项 = 机检 22 项 + 人工 1 项**" | "M 门**总项数 25 项 = 机检 24 项 + 人工 1 项**" |
| `scripts/m-gate-check.mjs` | L13-14 | "实测真实项目回放 `total = 22`：机检 22 项就是 M-Form 11 + M-Exist 10 + M-Integrity-1，没有第 23 个机械项" | "实测 `total = 24`：机检 24 项就是 M-Form 11 + M-Exist 11 + M-Integrity-1 + M-Fact-1，没有第 25 个机械项" |
| `scripts/m-gate-check.mjs` | L15 | "AGENTS.md 与 M-Gate-Algorithm.md：23 项中 22 项已脚本化" | "AGENTS.md 与 M-Gate-Algorithm.md：25 项中 24 项已脚本化" |
| `scripts/m-gate-check.mjs` | L16 | "`total` = 本次实际入账的机检项数（满配 22）" | "满配 24" |
| `references/_shared/M-Gate-Algorithm-appendix.md` | L13 | "`total`: 22" | "24" |
| `references/_shared/M-Gate-Algorithm-appendix.md` | L41 | "`total` \| 整数 \| 恒 22（机械项）" | "恒 24（机械项）" |
| `references/_shared/M-Gate-Algorithm-appendix.md` | L50 | "**M-Integrity** \| 1（脚本内）" | 不变（脚本内只有 M-Integrity-1） |
| `references/_shared/M-Gate-Algorithm-appendix.md` | L44 | "**机械 24 项 gate 标签**（逐字；`m-gate-check.mjs` 的 `gate:` 值即真源）" | 不变（24 是对的） |
| `scripts/methodology-check.mjs` | L175 | "m-gate-check.mjs 的 M 门 22 项（M-Form 1-11 / M-Exist 1-10 / M-Integrity-1）" | "24 项（M-Form 1-11 / M-Exist 1-11 / M-Integrity-1 / M-Fact-1）" |
| `references/_shared/M-Gate-Algorithm.md` | L23 | "**M 门项数真源（v18.2.6 审计修复，全库唯一口径）**：M 门总 25 项 = 机械 24 项（M-Form 1-11 + M-Exist 1-11 + M-Integrity-1）+ 人工 1 项（M-Integrity-2）" | "M 门总 25 项 = 机械 24 项（M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1）+ 人工 1 项（M-Integrity-2）"（**漏 M-Fact-1**）|
| `references/_shared/M-Gate-Algorithm.md` | L108 | "M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 是纯正则/结构判定" | "M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1 是纯正则/结构判定"（**漏 M-Fact-1**）|
| `references/_shared/M-Gate-Algorithm.md` | L1205 | "M 门**机械 24 项**（M-Form 1-11 + M-Exist 1-11 + M-Integrity-1）" | "M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1"（**漏 M-Fact-1**）|
| `references/_shared/M-Gate-Algorithm.md` | L1241 | "### M-Fact-1: 跨节事实一致性（数字跨节 + 术语近形）" | 不变（M-Fact-1 确实存在）|

### B. **不一致（同一文档内部口径错）**

| 文件 | 行 | 问题 |
|---|---|---|
| `references/glossary.md` | L107 | "M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1（共 24 项）" |
| `references/glossary.md` | L109 | "覆盖范围：24 项检查（M-Form 11 项 + M-Exist 11 项 + M-Integrity 2 项）" |
| | | **↯ 同文件 L107 vs L109 内部矛盾**：L107 把 M-Fact-1 算入 24 项；L109 把 M-Integrity 算 2 项（M-Integrity-2 是人工项不进机检 24）|
| `references/glossary.md` | L461 | "**M 门** \| `M-Form 11 + M-Exist 11 + M-Integrity 2 + M-Fact 1 = 25 项`形式合规门，由 `scripts/m-gate-check.mjs` 机械判定 + T8 LLM 复核 \| 不是「质量评分」\| " |
| | | **↯ 同一张表里"M-Integrity 2"既指 M-Integrity-1（机检）又指 M-Integrity-2（人工）——歧义** |
| `references/agents/08-终检-finalizer.md` | L13 | "**M 门 25 项全复核**（**24 项**：M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1 = 机械 24；人工 1 = M-Integrity-2）：读 `_shared/M-Gate-Algorithm.md`，机械项先跑 `scripts/m-gate-check.mjs`（**22 项**，逐项 gate 标签见 `_shared/M-Gate-Algorithm-appendix.md` §1.2），**LLM 判项收敛为 2 项（v18.18.0 起按 AGENTS.md 主控真源口径）**：" |
| | | **↯ L13 内部矛盾**："M 门 25 项全复核（24 项...机械 24；人工 1 = M-Integrity-2）"——总数 25 对，机械 24 对，但又说 "机械项先跑 m-gate-check.mjs（**22 项**）" + "LLM 判项收敛为 **2 项**"——22 + 2 = 24（口径一致），但同段又说机械 24。**22 与 24 的差是 M-Fact-1 漏计** |
| `scripts/quality-score.mjs` | L42 | "M-Gate \| M 门机械项（含 M-Form-9 图件闭环 + M-Fact-1） \| 38" |
| | | 这个 38 不是 M 门项数，是质量分权重——**口径不一致**：M 门 24 项 vs 权重 38——**不是同一个数字，但放在同一文档里易混淆** |
| `references/pipeline-readme.md` | L866 | "T7 必跑全量 `node scripts/m-gate-check.mjs <被审正文> <final/证据包> --report <tmp.json>`（**24 项机械项**），把结果**逐项**纳入审计报告" |
| | | 这条是对的 |
| `references/agents/07-审计-auditor.md` | L118 | "**M 门契约（v18.18.0 命名空间澄清）**：本脚本的「方法节参数完整性 / 统计-数据匹配 / 结果-方法闭环」三检属于 **methodology-check.mjs 自有命名空间**（前缀 `MC-` 防撞号），**不是 M 门体系编号**——M 门体系总 25 项 = 机械 24（M-Form 1-11 + M-Exist 1-11 + M-Integrity-1）+ 人工 1（M-Integrity-2），**无 M-Form-12**" |
| | | **↯ 漏 M-Fact-1**（说"机械 24"但只列 23 项 = 11+11+1）|
| `references/deliverables.md` | L177 | "**M 门三类（v18.2.6 审计修复：项数收敛到唯一真源）**：M 门总 25 项 = 机械 24 项（M-Form 1-11 + M-Exist 1-11 + M-Integrity-1，走 `scripts/m-gate-check.mjs`）+ 人工 1 项（M-Integrity-2，主控 T7.5 门）——**M-Form 11 项 / M-Exist 11 项 / M-Integrity 2 项**" |
| | | **↯ 漏 M-Fact-1**（说机械 24 但只列 23 项）|
| `references/_shared/字数判定表.md` | L90 | "① **M 门 25 项里没有字数项**（机械 24 = M-Form 1-11 + M-Exist 1-11 + M-Integrity-1；人工 1 = M-Integrity-2）" |
| | | **↯ 漏 M-Fact-1**（说机械 24 但只列 23 项）|
| `references/templates/局限性-template.md` | L7 | "`M-Exist-11` 为**建议项**：加门会使**机械项 22→23、M 门总项数 23→24**（真源：机械 24 = M-Form 1-11 + M-Exist 1-11 + M-Integrity-1；人工 1 = M-Integrity-2）" |
| | | **↯ 说"M-Exist-11 是建议项"是错的**——M-Exist-11 已经在 v18.27.0 落地；**且"加门后 22→23"也是错的**（应为 23→24，且反推 M-Fact-1 也漏）|
| `references/templates/闸门记录-template.md` | L8 | "本表曾有两行写「信任级别一致性（M-Exist-3）」——而 `m-gate-check.mjs` 的 `M-Exist-3 引用闭环`" |
| | | 这条本身不算 M 门项数错误，但上下文说"22 项逐字清单见 `../_shared/M-Gate-Algorithm-appendix.md` §1.2"——同文件"L35: 22 项"过时 |
| `references/_shared/DSH-集成方案.md` | L66 | "description: '运行论衡 M 门机械预检（**24 项**形式合规门）'" |
| | | 这条是对的 |
| `SKILL.md` | L66 | "总 25 项 = 机械 24 项（M-Form 1-11 + M-Exist 1-11 + M-Integrity-1）+ 人工 1 项（M-Integrity-2）" |
| | | **↯ 漏 M-Fact-1**（说机械 24 但只列 23 项）|
| `references/agents/00-主控-扩展职责.md` | L70 | "机械项（M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1，共 24 项）" |
| | | 这条是对的 |
| `references/errors.md` | L69 | "`M-Integrity-1 failed: outline not found at T2→T3 transition`" |
| | | 这条是错误样例，不是 M 门项数 |

### C. **正确（已对齐 24 / 25 真值）— 不动**

| 文件 | 行 | 文本 |
|---|---|---|
| `AGENTS.md` | L49 | "M 门 25 项中 24 项已脚本化为 `scripts/m-gate-check.mjs`（M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1 佐证），LLM 只复核 M-Form-8 的承重墙质量与 M-Integrity-2 跨文件判断" |
| `references/_shared/DSH-集成方案.md` | L66 | "运行论衡 M 门机械预检（**24 项**形式合规门）" |
| `QUICKSTART.md` | L41 / L146 | "M 门 25 项" / "M 门 25 项复核" |
| `references/templates/status-template.md` | L26 / L134 | "M 门 25 项" |
| `references/agents/06-批判-critical-companion.md` | L103 | "M 门 25 项" |
| `references/agents/08-终检-finalizer.md` | L49 | "M 门机械 24 项（M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1 = 机械 24；人工 1 = M-Integrity-2）" |
| `references/agents/09-审稿-peer-reviewer.md` | L15 | "M 门 25 项状态" |
| `references/_shared/规范-机械门对照表.md` | L138 | "**跨节事实一致性**（QLT-2；规范真源 = `M-Gate-Algorithm.md` §M-Fact）\| v18.25.0" |
| `references/glossary.md` | L107 | "M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1（共 24 项）" |

### D. **m-gate-check.mjs 头注释 = 自报头与脚本输出矛盾（最严重）**

```js
// scripts/m-gate-check.mjs L1-22：
//   论衡 M 门机械化预检脚本（v2.5.2-dsh 补丁 + v2.5.2-dsh.5 重大增强 + v2.5.2-dsh.16 加图件闭环 + v2.5.2-dsh.17 加 4 项）
//   v2.5.2-dsh:   M-Form-1/3/5/7 + M-Exist-2 纯正则/哈希判定
//   v2.5.2-dsh.5: M 门全脚本化（T8 仅复核 M-Form-8 承重墙质量 + M-Integrity 跨文件判断）
//   v2.5.2-dsh.16: 新增 M-Form-9 图件闭环（[图N] ↔ final/图件/ ↔ 图上数字）
//   v17.0.0（端到端测试反哺）: 正文引用扫描前**剥离代码块/行内反引号**
//   v2.5.2-dsh.17: 新增 M-Form-10 索引段完整性 / M-Form-11 素材按需加载闭环 /
//                  M-Exist-4 审计条目闭环 / M-Exist-5 阶段闸门记录表 /
//                  M-Exist-6 审稿报告与期刊匹配 / M-Exist-7 交付说明字段齐备 /
//                  M-Exist-8 批判报告覆盖（C1-C7）/ M-Exist-9 审计报告 G 项覆盖；
//                  M-Form-8 增补「承重墙超载」机检 → 本脚本机检 **22 项**（M-Form 11 + M-Exist 10 + M-Integrity-1 佐证）
// v18.2.6 审计修复：M 门**总项数 23 项 = 机检 22 项 + 人工 1 项（M-Integrity-2 跨文件判断，T8 亲做）**。
//   旧头注释写「M 门 22 项（脚本 21 项 + M-Integrity-2 主控）」——**与本脚本自己输出的 `total` 矛盾**
//   （实测真实项目回放 `total = 22`：机检 22 项就是 M-Form 11 + M-Exist 10 + M-Integrity-1，没有第 23 个机械项）。
//   真源口径见 `AGENTS.md`「M 门」节与 `references/_shared/M-Gate-Algorithm.md`：23 项中 22 项已脚本化。
//   本脚本报告里的 `total` = **本次实际入账的机检项数（满配 22）**，人工项 M-Integrity-2 不由本脚本产出。
```

**问题**：
1. **L11 说"机检 22 项（M-Form 11 + M-Exist 10 + M-Integrity-1 佐证）"** — 实测是 24（M-Form 11 + M-Exist 11 + M-Integrity-1 + M-Fact-1），不是 22。**L11 漏写 M-Fact-1 + 漏 M-Exist 11**
2. **L12 说"M 门总项数 23 项"** — 实测总 25（机械 24 + 人工 1 = M-Integrity-2）
3. **L13-14 说"实测真实项目回放 `total = 22`"** — 实测是 24
4. **L15 说"23 项中 22 项已脚本化"** — 应是 25 项中 24 项

**这是脚本头注释过期——**应改为：

```js
//   M-Form-10 / 11 + M-Exist-4..11 + M-Fact-1（M-Fact-1 v18.25.0 新增）→ 本脚本机检 **24 项**（M-Form 11 + M-Exist 11 + M-Integrity-1 + M-Fact-1）
// v18.27.0（QLT-4 反哺）：M-Exist-11 反方论证闭合落地
// v18.61.0 实测：`total = 24`：M 门总项数 25 项 = 机检 24 项 + 人工 1 项（M-Integrity-2 跨文件判断，T8 亲做）。
//   旧头注释写「机检 22 项 / 总 23 项」——与本脚本自己输出的 `total` 矛盾（实测 `total = 24`）
//   真实机检 24 项 = M-Form 11 + M-Exist 11 + M-Integrity-1 + M-Fact-1
//   真源口径见 AGENTS.md「M 门」节与 references/_shared/M-Gate-Algorithm.md：25 项中 24 项已脚本化。
//   本脚本报告里的 `total` = **本次实际入账的机检项数（满配 24）**，人工项 M-Integrity-2 不由本脚本产出。
```

---

## 三、其他诊断项（v18.61.0 push 后全文档扫描发现的非项数问题）

### E. **冗余：跨文档的"判据/出口/契约"被多处复述**

| 主题 | 重复文件 | 复述程度 |
|---|---|---|
| **M-Integrity-1 步骤 7**（指纹 sha256 实值）| `M-Gate-Algorithm.md` L1205 + `交付说明-template.md` L92 + `errors.md` L64 | 3 处 |
| **M-Exist-2 步骤 5**（sha256 实值）| `M-Gate-Algorithm.md` + `交付说明-template.md` | 2 处 |
| **M-Form-4 黑名单 vs 白名单切换**（v2.5.2-dsh.5 修订理由）| `M-Gate-Algorithm.md` L295 + `06-批判-critical-companion.md` L45 + `08-终检-finalizer.md` L10 + `机检硬格式.md` L18-22 | 4 处重复"任一处即 P0"+ 引用 |
| **M-Fact-1 三条防误报口径**（键 ≥4 汉字 / 不含通用词 / 术语近形 ≥2）| `M-Gate-Algorithm.md` L1241 + `mfact-gate.mjs` L38-44 | 2 处（合理复述：理论 + 实现）|
| **M-Form-9 v2.5.2-dsh.16 + mform-gates.mjs 实现** | `M-Gate-Algorithm.md` L644 + `mform-gates.mjs` L884 | 2 处（理论 + 注释）|
| **M-Exist-5 闸门记录表 + 报告指纹互锁** | `M-Gate-Algorithm.md` L943 + `mexist-gates.mjs` L302 + `errors.md` L64 + `闸门记录-template.md` L8 | 4 处 |
| **§反哺 v2 修订说明 / 6 处 handoff 漏登** | `M-Gate-Algorithm.md` + `errors.md` L64 + `errors.md` L69 + 4 处分散 | 多处但每处内容不同——不算冗余 |

### F. **逻辑/口径错误（非项数）**

| 文件 | 行 | 问题 |
|---|---|---|
| `scripts/_lib/cc-rules/content-rules.mjs` | L113 | "**有真值的**（appendix「约 45%」）→ **恢复口径三要素并改成可复算的分数**（10 项 / 22 项）" |
| | | **「10 项 / 22 项」** — 22 项是 v2.5.2-dsh 之前的旧口径；现在 24 项机检 / 25 项总。"约 45%"应改为实际比例 10/24 ≈ 42% 或 10/25 = 40% |
| `references/glossary.md` | L109 | "覆盖范围：24 项检查（M-Form 11 项 + M-Exist 11 项 + M-Integrity 2 项）" |
| | | "M-Integrity 2 项"**混淆**了 M-Integrity-1（机检 1 项）+ M-Integrity-2（人工 1 项）。实际 24 = 11+11+1(M-Integrity-1)+1(M-Fact-1)，不是 11+11+2 |
| `references/glossary.md` | L461 | "M-Form 11 + M-Exist 11 + M-Integrity 2 + M-Fact 1 = 25 项" |
| | | "M-Integrity 2" 又模糊——指 M-Integrity-1（机检）+ M-Integrity-2（人工）？应改为"M-Integrity-1 + M-Integrity-2" |
| `references/agents/08-终检-finalizer.md` | L13 | "机械项先跑 `scripts/m-gate-check.mjs`（**22 项**）" |
| | | 22 应为 24（实测） |
| `references/templates/局限性-template.md` | L7 | "`M-Exist-11` 为**建议项**：加门会使**机械项 22→23、M 门总项数 23→24**" |
| | | M-Exist-11 **不是建议项**——已在 v18.27.0 落地（脚本已 import）；且"加门"应该是从 23→24，不是 22→23 |

### G. **仓库文档大小（含 18% 增长 v18.61 后）**

| Top 20（仓库文档按大小） | 大小 | 行数 | 备注 |
|---|---|---|---|
| `pipeline-readme.md` | 112 KB | 530 | 派发话术为主，结构化清单多 |
| `M-Gate-Algorithm.md` | 107 KB | 902 | M 门 25 项伪代码全量 |
| `05-写作-writer.md` | 64 KB | 247 | 写作卡（含术语禁用清单 / 触发词） |
| `00-主控-扩展职责.md` | 61 KB | 350 | 主控扩展职责 |
| `SKILL.md` | 48 KB | 138 | 启动清单 + 速度查表 |
| `07-审计-auditor.md` | 48 KB | 201 | 审计卡 |
| `09-审稿-peer-reviewer.md` | 39 KB | 275 | 审稿卡 |
| `glossary.md` | 38 KB | 298 | 概念词汇表 |
| `规范-机械门对照表.md` | 36 KB | 156 | 门 ID 全覆盖 |
| `DSH-集成方案.md` | 34 KB | 297 | DSH 集成方案 |
| `maintainers.md` | 32 KB | 145 | 维护者向 |
| `任务简报-template.md` | 30 KB | 111 | 任务简报模板 |
| `04-分析-analyst.md` | 25 KB | 133 | T4 分析卡 |
| `06-批判-critical-companion.md` | 25 KB | 162 | T6 批判卡 |
| `deliverables.md` | 22 KB | 133 | 交付物清单 |
| `01-文献检索-literature-scout.md` | 21 KB | 110 | T1 文献检索 |
| `外部检索源接入面.md` | 20 KB | 163 | 6 源接入面 |
| `AGENTS.md` | 19 KB | 40 | 操作手册 |
| `图表-SVG-template.md` | 19 KB | 236 | 5 类 SVG 模板 |
| `lessons.md` | 19 KB | 34 | 教训真源 |
| 总计 | 1.27 MB | 4,562 | 80 个 .md |

---

## 四、为什么 v18.40.0 / v18.43.0 / v18.45.0 的自动化测试没抓到

仓库有 `tests/docs-facts.test.mjs`（见 `规范-机械门对照表.md` L10）：

> ④ `tests/docs-facts.test.mjs` 断言四件事——① M 门项 ID 全覆盖（代码 `gate:` 标签里的机械项全部能在 §一/§二 找到，**v18.40.0 即抓到 `M-Fact-1` 漏登**）；② handoff 判据码全覆盖；③ 引用可解析；④ 作废门号不复活。

**但是**：这些测试只断言 **门 ID 字符串覆盖**（正则匹配 `M-Form-1`、`M-Integrity-2` 等门编号），**不断言数字**（"22 项 / 23 项 / 24 项 / 25 项"是否对）。所以数字漂移一直存在，但**测试不出**.

> **教训（v18.45.0 §四.6）**：`tests/docs-facts.test.mjs` 应**扩面**：
> - 断言 **总项数 24 项 / 总 25 项**（按门族 + M-Integrity-2 / M-Fact-1）
> - 断言 **"M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1 = 24 项机检"** 这一字符串在所有文档里出现一致

---

## 五、风险评估

| 风险 | 严重度 | 说明 |
|---|---|---|
| 主控 LLM 误判 | 🟡 中 | 当主控读 AGENTS.md "M 门 24 项已脚本化" + glossary.md "覆盖范围 24 项检查（M-Integrity 2 项）" 会混淆 → M-Integrity-2 是人工项不是 24 项之一 |
| 子代理误判 | 🟢 低 | subagent 主要看角色卡（M-Form/M-Exist/M-Integrity/M-Fact 各自的伪代码），不会因总项数错误而误跑 |
| 测试盲区 | 🟡 中 | `docs-facts.test.mjs` 只查字符串覆盖，不查数字 → 漂移不报警 |

---

## 七、建议修订（待主人 review 后决定）

按 **风险 / 收益** 排序：

1. **必修**（10 分钟内可做，机械化、零风险）：
   - `scripts/m-gate-check.mjs` L11-16：改头注释（22 → 24，23 → 25）
   - `scripts/methodology-check.mjs` L175：补 M-Exist 1-11 + M-Fact-1
   - `references/_shared/M-Gate-Algorithm-appendix.md` L13、L41、L50：改 22 → 24
   - `references/_shared/M-Gate-Algorithm.md` L23、L108、L1205：补 M-Fact-1
   - `references/glossary.md` L109、L461：改 "M-Integrity 2 项" → "M-Integrity-1 + M-Fact-1"
   - `references/agents/07-审计-auditor.md` L118：补 M-Fact-1
   - `references/deliverables.md` L177：补 M-Fact-1
   - `references/_shared/字数判定表.md` L90：补 M-Fact-1
   - `SKILL.md` L66：补 M-Fact-1
   - `references/templates/局限性-template.md` L7：删"建议项"误说，改"已落地"
   - `references/agents/08-终检-finalizer.md` L13：改 22 → 24 + "M-Integrity-1 + M-Fact-1"
2. **自动化扩面**（30 分钟）：`tests/docs-facts.test.mjs` 加 **数字项数断言**（24 机检 + 25 总）
3. **冗余消解**（30 分钟）：M-Integrity-1 步骤 7 的 3 处复述保留 1 处 + 引用另 2 处；M-Form-4 黑名单转白名单的 4 处复述保留 1 处 + 引用另 3 处

**总工作量 ≈ 1.5 小时**（10 处文档微改 + 1 处测试扩面 + 1 处冗余消解）。

---

## 八、决策

**不动仓库文件**——按主人授权"诊断不修订"原则，本报告仅作诊断文档。

**下一步**：
- A. 主人批准后做 §七 "1. 必修" 10 处微改（预计 commit 1 个 + push v18.61.1 patch）
- B. 主人批准后做 §七 "2. 自动化扩面"（新增测试 + 跑全套）
- C. 主人批准后做 §七 "3. 冗余消解"（3-4 处文档瘦身）
- D. 暂不做（主人想自己改）

**主人选 A / B / C / D 后再执行**。

---

> 本诊断报告遵循 v18.45.0 §十三决策记录硬要求（位置 `audits/decisions/`），不动仓库文件，仅给主人做决策参考。
> 不引向具体实施版本——主人 review 后再做。

---

> **诊断时间**：v18.61.0 push 后立即
> **下次决策**：等主人选 A/B/C/D