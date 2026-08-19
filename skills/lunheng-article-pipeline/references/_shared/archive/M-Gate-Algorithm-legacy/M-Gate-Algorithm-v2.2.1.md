# M 门算法规约 v2.2.1（增量更新，教训 #77 — 数据信任级别 + 阶段闸门）

> **背景**：v2.2.0 M 门（M-Form 5 项 + M-Exist 2 项）在实战 2 + 实战 3 暴露 2 个结构性短板——
> **数据来源不清**（实战 2 历史项目未应用后期教训 + 实战 3 outputs/ vs run/ 数据不同步）+ **阶段交接无闸门**（实战 2 + 实战 3 都显示 T2 → T3 / T5 → T7 间无强制 checkpoint）。
> **解法**：本规约在 v2.2.0 M 门基础上扩展 4 项（M-Form-6 / M-Exist-3 / M-Integrity-1 / M-Integrity-2），由 LLM 兜底执行（零 exec 依赖），T7 必跑。
> **设计哲学**：**沿用 v2.2.0 M 门哲学**——不引入 Python 脚本，主控用 `read` + `write` 工具按本规约伪代码推理执行；**不引入新代码风险**。
> **借鉴出处**：vincentjiang06 paper-writer 数据信任边界 + ARS Stage 2.5/4.5 双完整性门 → 论衡化扩展为「M-Form-6 / M-Exist-3 / M-Integrity-1/2」。

## 目录

- [与 v2.2.0 的关系](#与-v220-的关系)
- [执行前置（Phase 0 主控必读，教训 #51 同意关卡金标准）](#执行前置phase-0-主控必读教训-51-同意关卡金标准)
- [M-Form-6: 信任级别标注完整性（v2.2.1 新增）](#m-form-6-信任级别标注完整性v221-新增)
- [M-Exist-3: 数据信任级别一致性 diff（v2.2.1 新增）](#m-exist-3-数据信任级别一致性-diffv221-新增)
- [M-Integrity-1: T2.5 完整性门（T2 数据检索 → T3 分析前，v2.2.1 新增）](#m-integrity-1-t25-完整性门t2-数据检索-t3-分析前v221-新增)
- [M-Integrity-2: T5.5 完整性门（T5 审计 → T7 终检前，v2.2.1 新增）](#m-integrity-2-t55-完整性门t5-审计-t7-终检前v221-新增)
- [M-Gate-Report-v2.2.1 输出格式（v2.2.1 标准化）](#m-gate-report-v221-输出格式v221-标准化)
- [论衡哲学化（v2.2.1 SOP 标注）](#论衡哲学化v221-sop-标注)
- [教训沉淀](#教训沉淀)

---

## 与 v2.2.0 的关系

| 项 | v2.2.0 | v2.2.1 |
|---|--------|--------|
| M-Form 形式合规门 | 5 项（M-Form-1~5）| 6 项（+ **M-Form-6 信任级别标注完整性**）|
| M-Exist 存在性合规门 | 2 项（M-Exist-1/2）| 3 项（+ **M-Exist-3 信任级别一致性 diff**）|
| M-Integrity 阶段闸门 | 无 | 2 项（**M-Integrity-1 T2.5** + **M-Integrity-2 T5.5**）|

**M-Form 5 项 + M-Exist 2 项仍有效**——本规约不替换 v2.2.0 M 门，**只扩展**。

---

## 执行前置（Phase 0 主控必读，教训 #51 同意关卡金标准）

**主控 T7 终检前必须**：

1. ✅ **同时读取 v2.2.0 规约 + 本规约**（用 `read` 工具读 `M-Gate-Algorithm-v2.2.0.md` + `M-Gate-Algorithm-v2.2.1.md`）
2. ✅ **读取 final/定稿.md + final/证据包/所有文件**（用 `read` 工具）
3. ✅ **依次执行 M-Form 6 项 + M-Exist 3 项 + M-Integrity 2 项**（按本规约伪代码推理）
4. ✅ **产出 M-Gate-Report-v2.2.1.json**（用 `write` 工具写入）
5. ✅ **判定 exit code 0 才允许 T7 返回**，否则触发 T4 修订或主控补检索

**Phase 0 同意关卡**：本算法不调用任何外部服务（纯 LLM 推理 + 文件 I/O），无需主人额外同意。

---

## M-Form-6: 信任级别标注完整性（v2.2.1 新增）

**目标**：数据卡每条数据必须有「信任级别」标注（已发布 / 主人投喂 / 二手转引 三档之一），防 F8.4 信任级别遗漏。

```
算法步骤：
1. 读取 final/证据包/数据卡.md 全文
2. 提取所有数据条目首行：grep -oE '^\[D[0-9]+\]' final/证据包/数据卡.md | sort -u > /tmp/datacard_D.txt
3. 提取所有信任级别标注：grep -c '信任级别：(已发布|主人投喂|二手转引)' final/证据包/数据卡.md > /tmp/trust_count.txt
4. 比较：len(数据条目首行) == len(信任级别标注)
5. 判定：相等 → 通过；不相等 → 失败（漏几条）

伪代码：
data_entries = re.findall(r'^\[D\d+\]', data_card_text)
trust_marks = re.findall(r'信任级别：(已发布|主人投喂|二手转引)', data_card_text)
return (len(data_entries) == len(trust_marks), abs(len(data_entries) - len(trust_marks)))
```

**失败处理**：
- 漏标 → P1（主控 T2.5 闸门触发：写手修订补信任级别标签）
- 多标 → P1（数据卡条目可能重复或格式错误）

**实战反馈**：
- 实战 2（品牌一致性）：14 条 [Dxx] 数据无信任级别标注（v2.1.4 之前项目）→ M-Form-6 失败 → T2.5 闸门可拦截
- 实战 3（教师场域 outputs/）：outputs/ 公众号版数据无信任级别标注 → M-Form-6 失败 → T5.5 闸门可拦截

---

## M-Exist-3: 数据信任级别一致性 diff（v2.2.1 新增）

**目标**：正文每条 [Dxx] 引用必须在数据卡里有对应「信任级别」标注，防 F8.1 来源混入 + F8.2 公众号版不同步。

```
算法步骤：
1. 提取正文所有 [Dxx] 编号：grep -oE '\[D[0-9]+\]' final/定稿.md | sort -u > /tmp/intext_D.txt
2. 提取数据卡所有 D 条目首行：grep -oE '^\[D[0-9]+\]' final/证据包/数据卡.md | sort -u > /tmp/datacard_D.txt
3. 提取数据卡所有信任级别标注：grep -oE '\[D[0-9]+\].*?信任级别：(已发布|主人投喂|二手转引)' final/证据包/数据卡.md
   → 建立 {Dxx: 信任级别} 字典
4. diff 双向：
   - 漏注 = intext_D - datacard_D（正文有 [Dxx] 但数据卡无该 D 条目）→ P1（必补数据卡）
   - 孤儿 = datacard_D - intext_D（数据卡有 [Dxx] 但正文未引用）→ P1（必删或加正文引用）
5. 信任级别核查：每条正文 [Dxx] 对应的数据卡信任级别 = 必须填写（非空）
6. 判定：漏注空 + 孤儿空 + 信任级别全填 → 通过；任一非空 → 失败

伪代码：
intext_D = sorted(set(re.findall(r'\[D\d+\]', draft_text)))
datacard_D = sorted(set(re.findall(r'^\[D\d+\]', data_card_text, re.MULTILINE)))
leaked = sorted(set(intext_D) - set(datacard_D))
orphan = sorted(set(datacard_D) - set(intext_D))
trust_dict = build_trust_dict(data_card_text)  # {Dxx: 信任级别}
missing_trust = [d for d in intext_D if d not in trust_dict or trust_dict[d] == '']
return (len(leaked) == 0 and len(orphan) == 0 and len(missing_trust) == 0,
        leaked, orphan, missing_trust)
```

**失败处理**：
- 漏注 → P1（触发 T2 检索员补数据卡条目）
- 孤儿 → P1（触发 T4 写手补正文引用或主控删数据卡条目）
- 信任级别空 → P1（触发 T2 检索员补信任级别标签）

**实战反馈**：
- 实战 3（教师场域 outputs/）：outputs/ 公众号版含 45 条 [Dxx] 但数据卡没配套更新 → M-Exist-3 失败 → T5.5 闸门可拦截

---

## M-Integrity-1: T2.5 完整性门（T2 数据检索 → T3 分析前，v2.2.1 新增）

**目标**：T2 数据检索员完成 → T3 分析员启动前的「主控 checkpoint」，防 F8.1 来源混入 + F8.4 信任级别遗漏。

```
算法步骤（主控 LLM 兜底执行）：
1. 检查数据卡文件存在：ls final/证据包/数据卡.md → 必须存在
2. 提取数据条目数：grep -c '^\[D[0-9]+\]' final/证据包/数据卡.md
3. 提取大纲 D 列需求数：grep -oE '\[D[0-9]+\]' analysis/分析大纲.md | sort -u | wc -l
4. 数据条目数 >= 大纲 D 需求数 → 数据完整 → 通过；否则 → 触发 T2 重检索
5. 信任级别完整性：M-Form-6 exit 0 → 通过；否则 → 触发 T2 补标注
6. 信任级别一致性：M-Exist-3 exit 0 → 通过；否则 → 触发 T2 补数据卡
7. 数据卡 sha256 指纹：写入 final/交付说明.md「证据包指纹」段（M-Exist-2 复用）
8. 主人签字 Phase 1：任务简报有 4 选 1 选项确认
9. 判定：8 项全通过 → T2.5 ✅ 派发 T3；任一失败 → T2.5 ❌ 不派发 T3

伪代码：
import os
data_card = 'final/证据包/数据卡.md'
data_count = count_d_entries(data_card)  # 步骤 2
outline_count = count_d_in_outline('analysis/分析大纲.md')  # 步骤 3
data_ok = data_count >= outline_count
trust_form_ok = check_M_Form_6(data_card)  # 步骤 5
trust_exist_ok = check_M_Exist_3(data_card, 'final/定稿.md')  # 步骤 6
sha256_ok = write_evidence_sha256(data_card)  # 步骤 7
owner_signed = check_phase1_signature()  # 步骤 8
all_pass = data_ok and trust_form_ok and trust_exist_ok and sha256_ok and owner_signed
return (all_pass, fail_reasons)
```

**失败处理**：
- 数据条目数 < 大纲 D 需求数 → T2 检索员重检索补数据卡（不派发 T3）
- M-Form-6 失败 → T2 补信任级别标签
- M-Exist-3 失败 → T2 补数据卡条目
- 主人未签字 → 主控回到 Phase 0 重新确认

**实战反馈**：
- 实战 2（品牌一致性）：T2 数据检索完成后 → 直接进 T3 分析 → 信任级别缺失未拦截 → T4 写手引 14 条 [Lxx] 漏引 → 实战 2 失败 → T2.5 闸门可防
- 实战 3（教师场域 outputs/）：T2 数据检索 → T3 分析 → T4 写手 → T5 审计 → T7 终检完整跑完 → outputs/ 公众号版剥离文末四节未拦截 → T5.5 闸门可防

---

## M-Integrity-2: T5.5 完整性门（T5 审计 → T7 终检前，v2.2.1 新增）

**目标**：T5 审计员完成 → T7 主控终检前的「主控 checkpoint」，防 F8.2 公众号版不同步 + F8.3 转引未标注 + F8.4 信任级别遗漏。

```
算法步骤（主控 LLM 兜底执行）：
1. 检查审计报告最新版：ls audits/审计报告-vN.md → N 取最大 → 必须存在
2. P0/P1 清单已列：grep -E '^- \*\*P0|^- \*\*P1' audits/审计报告-vN.md → 必须有 ≥1 条
3. M 门（M-Form 6 项 + M-Exist 3 项）全部 exit 0：读 M-Gate-Report-v2.2.1.json → 全部 true
4. 证据包 sha256 指纹完整：读 final/交付说明.md「证据包指纹」段 → 必须有 sha256 哈希
5. 信任级别一致性：M-Exist-3 exit 0 → 通过
6. 论文交付物 vs 操作员报告独立隔离：
   - final/定稿.md（论文）不含 audits/ / final/交付说明.md 内容
   - final/交付说明.md / audits/（报告）不混入 final/定稿.md
   - grep 反向检查：定稿无「交接报告」「角色卡」「反哺报告」「P0 致命」等元数据
7. 主人签字 Phase 5（如有 v2.2.0 修订回环 ≤2 轮降级触发）：任务简报注明 + 主人已读局限性.md
8. 判定：7 项全通过 → T5.5 ✅ 派发 T7；任一失败 → T5.5 ❌ 不派发 T7

伪代码：
audit_latest = get_latest_audit_report('audits/')  # 步骤 1
p0_p1_listed = check_p0_p1_listed(audit_latest)  # 步骤 2
m_gate_ok = check_m_gate_all_pass('final/M-Gate-Report-v2.2.1.json')  # 步骤 3
sha256_ok = check_evidence_sha256('final/交付说明.md')  # 步骤 4
trust_ok = check_M_Exist_3(...)  # 步骤 5
isolation_ok = check_draft_vs_report_isolation('final/定稿.md', 'final/交付说明.md', 'audits/')  # 步骤 6
owner_signed = check_phase5_signature()  # 步骤 7
all_pass = audit_latest and p0_p1_listed and m_gate_ok and sha256_ok and trust_ok and isolation_ok and owner_signed
return (all_pass, fail_reasons)
```

**失败处理**：
- 审计报告缺 → 触发 T5 审计重跑
- P0/P1 清单空 → 触发 T5 审计补判定
- M 门失败 → 触发 T4 修订（详见 v2.2.0 M 门处理）
- 论文交付物 vs 操作员报告混淆 → 触发主控隔离清理
- 主人未签字 → 主控回到 Phase 5 等主人验收

**实战反馈**：
- 实战 3（教师场域 outputs/）：outputs/ 公众号版 = 论文交付物，但 run/ 含完整文末四节 = 论衡工作区版本 → 两者不一致未拦截 → T5.5 闸门可防

---

## M-Gate-Report-v2.2.1 输出格式（v2.2.1 标准化）

主控 T7 执行 M 门 v2.2.1 后，必须产出 `final/M-Gate-Report-v2.2.1.json`：

```json
{
  "项目": "<项目名>",
  "执行时间": "<ISO-8601>",
  "执行者": "论衡主控 T7 (LLM 兜底执行)",
  "M门执行版本": "v2.2.1",
  "M-Form_形式合规门": {
    "M-Form-1_引用标注完整性": true | false,
    "M-Form-2_文末四节存在性": true | false,
    "M-Form-3_临时编号残留": true | false,
    "M-Form-4_角色元数据泄露": true | false,
    "M-Form-5_过程语言残留": true | false,
    "M-Form-6_信任级别标注完整性": true | false,
    "全部通过": true | false
  },
  "M-Exist_存在性合规门": {
    "正文引用编号数": 0,
    "文末四节分布": {
      "数据来源": 0,
      "案例来源": 0,
      "参考文献": 0,
      "先行者文献": 0
    },
    "漏引": [],
    "孤儿": [],
    "M-Exist-3_信任级别一致性": {
      "正文Dxx数": 0,
      "数据卡Dxx数": 0,
      "漏注": [],
      "孤儿": [],
      "信任级别空标": [],
      "通过": true | false
    },
    "全部通过": true | false
  },
  "M-Integrity_阶段闸门": {
    "M-Integrity-1_T2.5": {
      "数据条目完整性": true | false,
      "信任级别完整性": true | false,
      "主人签字Phase1": true | false,
      "通过": true | false
    },
    "M-Integrity-2_T5.5": {
      "审计报告最新版": true | false,
      "P0P1清单已列": true | false,
      "M门全exit0": true | false,
      "论文vs报告隔离": true | false,
      "主人签字Phase5": true | false,
      "通过": true | false
    },
    "全部通过": true | false
  },
  "证据包_sha256指纹": {
    "数据卡.md": "<sha256 或 待补>",
    "案例卡.md": "<sha256 或 待补>",
    "文献卡.md": "<sha256 或 待补>",
    "先行者清单.md": "<sha256 或 待补>"
  },
  "判定": "✅ 通过" | "❌ 失败",
  "退出码": 0 | 1,
  "下一步": "T7 返回" | "触发 T4 修订" | "触发主控补检索" | "触发 T2.5 重审" | "触发 T5.5 重审"
}
```

---

## 论衡哲学化（v2.2.1 SOP 标注）

- **「**数据信任级别是论衡防御 prompt injection 的核心机制**」** —— vincentjiang06 paper-writer Trust Boundary 论衡化
- **「**阶段闸门是论衡主控纪律**」** —— 不引入新 agent，主控用 todo_write + read 实现；**ARS Stage 2.5/4.5 论衡化为主控 checkpoint**
- **「**形式合规 ≠ 存在性合规 ≠ 信任一致**」** —— v2.2.0 → v2.2.1 论衡 M 门体系三层验证
- **「**M 门由 LLM 兜底执行，零 exec 依赖**」** —— v2.2.0 哲学保留 + v2.2.1 扩展
- 教训 #77：**v2.2.1 总教训**——4 子教训（数据信任级别 / 阶段闸门 / M 门三层 / F8 补漏）

---

## 教训沉淀

- **教训 #77**: v2.2.1 升级总教训
  - 子教训 1：数据信任级别是论衡防御 prompt injection 的核心机制
  - 子教训 2：阶段闸门是论衡主控纪律，不引入新 agent
  - 子教训 3：M-Exist-3 + M-Integrity-1/2 三件套补 M 门体系
  - 子教训 4：F8 数据信任失败模式补 F1-F7 体系
- **实战反馈映射**（v2.2.0 实战三轮驱动）：
  - 实战 2 失败 → F8.4 信任级别遗漏 → M-Form-6 防御
  - 实战 3 失败 → F8.2 outputs/ 公众号版数据不同步 → M-Exist-3 + M-Integrity-2 防御
  - 实战 2 失败 → 阶段交接无闸门（T2 → T3） → M-Integrity-1 防御
  - 实战 3 失败 → 阶段交接无闸门（T5 → T7） → M-Integrity-2 防御