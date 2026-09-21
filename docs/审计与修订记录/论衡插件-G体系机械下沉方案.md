# 论衡「G 体系机械下沉」修订方案 v1.1

> 目标：把 G 体系里「可计算」的项下沉为确定性机械规则，G 只剩纯语义判断。全部走 **P2/soft 档**（复用 `exit 3` 语义），不设 P0，机械只「挑可疑」不「定罪」。
> 状态：方案（已自检修正，待主人确认后实施）

---

## 0. 方案自检记录（v1 → v1.1 三处修正）

1. **causal 守恒落点**：`apply-diff.mjs` 的 `oldPart/newPart` 来自 T5 手写「段级 diff 清单」。清单本就是「现况→修改后」两侧对照，T5 升级因果时清单必然两侧都写，故查清单**能**抓到升级。前提是 T5 如实写清单（论衡已有「写盘双重校验」铁律兜底）；更稳的兜底是将来支持「自动 diff 两份稿件」，首刀先用清单对照（零新增机制）。
2. **编号口径**：新增编号会牵动全库「M 门项数」口径（审计史：M 门项数曾同时存在多种口径，consistency-check 规则⑳ 查自洽）。**修正：不新增编号**——causal 守恒落 `apply-diff`（不进机械门），引用密度作三角验证的 P2 子项。
3. **baseline 对账方法**：新增 P2 项会改 stdout detail、污染哈希。**修正：对账用 `--summary` 模式**（只含 exit/P0/P1/聚合，不含 P2 detail）。

---

## 一、两处落地（修正后）

### A. causal 强度守恒 → `apply-diff.mjs`（改稿当场）

**守护**：T5 修订时因果强度被无意升级（`associated with` → `caused`、`相关` → `导致`）而无新增证据。

**实现**：
1. 新建 `_lib/causal.mjs`，三档因果词表 + `causalStrength(text)` 提取命中档位：

| 档 | 英文 | 中文 |
|---|---|---|
| 强 | cause(s)/caused by/leads to/led to/demonstrate(s)/prove(s)/establish(es) | 导致/引起/证明/证实/决定/必然 |
| 中 | associated with/correlat(ed/ion)/suggest(s)/may/might/could/contribute(s) to | 相关/提示/可能/或许/有助于/与…相关 |
| 弱 | no significant/no association/did not/failed to | 未发现显著/无显著/无关 |

2. `apply-diff.mjs` 对每条清单 `oldPart/newPart` 做守恒：`newPart` 出现强档词、`oldPart` 只有中/弱档、且 `newPart` 内无新增 `[Lxx]/[Dxx]/[Cxx]` 引用 → 记 **P2** `causal_upgrades: [{old:"associated",new:"caused",段号}]`（并入现有 JSON 契约，加法不破坏下游）。

**边界**：机械只做「守恒」，不做「强度判定」——「因果主张是否过强」归 **G3 逻辑**。

### B. 引用密度（裸断言段）→ `m-gate-check.mjs` M-Form-8 子项

**守护**：正文出现长段落零引用（纯 LLM 自由发挥）。

**实现**：
1. 复用 `_lib/sections.mjs`（分节）＋ `_lib/refs.mjs`（`refRe`）＋ `_lib/han.mjs`（`countHan`）。
2. 对每个 `##` 正文段（排除 摘要/关键词/引言/结语/结论/展望——复用 M-Form-8 的 `FRONT_BACK`）：
   - 段内汉字数 > `THRESHOLDS.mform8BareMinHan`（默认 300）且引用数 = 0 → **P2**：`该段 N 字、零引用，疑似裸断言`。
3. 作为 M-Form-8 的 soft 子项输出（`soft8.push(...)`），**不改变 M-Form-8 的 P0/P1 判定逻辑**、不新增 gate 标签。

**边界**：非所有段都要引用（过渡段/方法论段），故只 P2，由 **G3/G6** LLM 复核。

**阈值进 `THRESHOLDS`**（论衡红线「可调参数不得硬编码」）：`mform8BareMinHan: 300`。密度偏低比（`densityFloorRatio`）留阶段 3 配「文风档位」再上（文体差异大，避免公众号文刷屏）。

---

## 二、Writing Guard 借鉴 → 论衡落地映射

| WG 机制 | 论衡落地 | 状态 |
|---|---|---|
| EVIDENCE「causal strength 守恒」 | 本方案 A（apply-diff） | ✅ 首刀 |
| density-based thresholds | 本方案 B（裸断言段） | ✅ 首刀 |
| 「Prefer CUT over REWRITE」 | T5 写作卡铁律加一条（措辞层） | ✅ 低成本，随批 |
| EVIDENCE「数值/单位守恒」 | apply-diff 段内数值/单位/百分比不漂移 | ⏸ 阶段 2 |
| STYLE 句长/词频密度 | 走 P2，配文风档位 | ⏸ 阶段 3 |
| DOCUMENT Word 结构指纹 | 论衡 docx 投稿链（md2html 之外） | ⏸ 独立专项 |
| DELIVERY 上下文泄露 | 论衡 M-Form-4 已更强 | ❌ 不借鉴 |

---

## 三、实施步骤

### 阶段 1（首刀，最小可验证）
1. 新建 `_lib/causal.mjs`（三档词表 + `causalStrength`）。
2. `apply-diff.mjs` 段内 causal 守恒，输出 `causal_upgrades`。
3. `m-gate-check.mjs` M-Form-8 加「裸断言段」P2 子项。
4. 阈值进 `THRESHOLDS`；`规范-机械门对照表.md` 加两行（勾稽「规范 ↔ 机检门」）。
5. T5 写作卡加「Prefer CUT over REWRITE」一条。

### 阶段 2
1. `apply-diff` 数值/单位守恒（WG EVIDENCE 层完整）。
2. causal 守恒「自动 diff 两份稿件」兜底（不依赖 T5 清单）。

### 阶段 3
1. 句长异常、词频密度，配文风档位。
2. 评估 docx 投稿链的 Word 结构指纹。

---

## 四、测试与对账

1. **逐词注入**：`_lib/causal.mjs` 三档词表每词注入、断言档位（删词即红，同 M-Form-5 禁词表模式）。
2. **causal 守恒用例**：`old="associated with"` → `new="caused"` 无新增引用 → 报 P2；加 `[Dxx]` 后 → 不报。
3. **裸断言段用例**：构造 350 字零引用段 → 报 P2；引言段 → 不报（FRONT_BACK 排除）。
4. **baseline 对账**：`_mgate-baseline.mjs` 用 `--summary` 模式 before/after 对比（P2 不污染 summary 哈希）。

---

## 五、风险与边界（论衡教训，防重蹈）

1. **全部 P2，零 P0**——causal/密度是弱信号，机械只挑可疑，定罪归 G3/G6。
2. **中文因果词多义**：「导致」在「数据导致结论」是强因果、在「这项工作导致关注」是弱因果——机械无法消歧，故只能 P2 交 LLM。**这是走 P2 而非 P0 的根本原因**。
3. **causal 守恒依赖 T5 如实写清单**——T5 整段重写时 `oldPart/newPart` 是整段，仍可抓到整段强度对比；但 T5 若「漏写清单条目」则该条不查。阶段 2 的「自动 diff」兜底补这个空档。
4. **引用密度文体差异**：学术 vs 公众号密度天然不同，阶段 1 只上「裸断言段」（300 字零引用是任何文体都该警惕的），「密度偏低」留阶段 3。

---

## 六、实施进度与评估结论（v18.3.0 之后追加）

### 已实施（阶段 2 数值守恒 + 阶段 3 句长异常）

- **数值/单位守恒**（阶段 2）：`apply-diff.mjs` 输出 `numeric_drift`——改动段内数字序列变了（非删除）→ P2。机械只挑「数字变了」，是否故意修正归主控/T7。
- **句长异常**（阶段 3）：`m-gate-check.mjs` M-Form-8 加「异常长句」P2 软提示（单句汉字 >120）。机械只挑长句，是否该拆归 G4/G14。
- 对照表加两行；测试 124/124；baseline 49 组 exit 0 差异。

### 评估结论（暂不实施，附理由）

- **causal「自动 diff 两份稿件」兜底**（阶段 2 剩余）：抓「T5 漏写清单条目」这一边际场景。代价是需要**多段 diff / 序列对齐算法**（现有 `extractDelta` 只做单处最小差异），工程量大；而「T5 如实写清单」已有「写盘双重校验」铁律兜底。**结论：暂缓，作独立专项**；当前清单路径已覆盖主场景。
- **docx Word 结构指纹**（阶段 3 剩余）：论衡当前是**纯 Node + Markdown** 流水线，docx 是可选导出（md2html/pdfcheck）。Word Guard 的 DOCUMENT 层需要 **Python + python-docx + OOXML 包级处理**，引入 Python 依赖是技术栈决策，非机械下沉能顺带做。**结论：独立专项评估**（先定「是否引入 Python 依赖」再动手），不在本阶段实施。

