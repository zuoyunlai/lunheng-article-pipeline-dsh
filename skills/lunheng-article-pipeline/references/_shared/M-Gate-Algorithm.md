> 版本：v2.3.7-dsh.4（DSH 适配版，对应正典 v2.3.7，自动同步 2026-08-22）

# M 门算法规约（论衡当前主流程完整版，v2.2.12 Phase D-1 合并）

> **v2.2.15 新增**：[渐进式执行模式](M-Gate-渐进式验证-v2.2.15.md)—— 把 11 项 M 门从「T8 一次性全跑」改为「5 阶段分批执行 + T8 兜底」，P0 错误提前暴露（Phase 1.5 而非 T8），节省 30-50% 工作量。
>
> **v2.2.8 Phase D-1 重大变更**：本规约从「**4 个增量版本并存**」（v2.2.0/v2.2.1/v2.2.1.2/v2.2.4 共 15.4K tokens）合并为「**1 个完整版**」（本文件约 12K tokens，主流程只读这一份）。
>
> 完整版包含 v2.2.0 基础 + v2.2.1 扩展（M-Form-6 + M-Exist-3 + M-Integrity-1/2）+ v2.2.1.2 算法升级（M-Form-3 + M-Exist-1 + M-Form-6 + M-Exist-3 双格式）+ v2.2.4 内联引用 + 补检索回填 + 修订轮流程约束。**3 个历史版本已归档到 `_shared/archive/M-Gate-Algorithm-legacy/`（仅做版本演进参考，不需主流程读取）**。
>
> **执行前置**：「同时读取 4 个版本」改为「**读取本完整版**」。节省 ~10K tokens 主流程加载。

---

## 📖 核心概念（优先阅读）

**执行 M 门前，请先阅读**：[`../glossary.md`](../glossary.md)

词汇表第二章详细定义了 M 门的性质、覆盖范围、单一真源原则。本文档是算法实现细节，不重复概念定义。

---

## 执行模型（v2.2.12 澄清）

**M 门的执行方式**：
1. 主控用 `read` 工具读取本算法文档
2. 主控用 `read` 工具读取 `final/定稿.md` + `final/证据包/` 所有文件  
3. 主控按下面的**伪代码推理判定**，产出 `M-Gate-Report-v2.2.12.json`
4. exit 0 才能返回，否则触发修订或补检索

**本文档中的代码示例**：
- **Python 风格** → 伪代码，描述算法逻辑（主控 LLM 推理执行）
- **Bash 风格** → 验证示例，供人类主人在 host shell 手动执行（非 agent 执行）

**工具能力边界**：详见 [glossary.md 第五章](../glossary.md#五工具能力边界v2212-前置声明)

---

## 背景（v2.2.0 原版）

论衡 agent 的 15 项白名单不含 `exec`，M 门由 LLM 推理执行，不引入新代码风险。

**设计哲学**：算法规约 100% 由论衡主控可读懂的伪代码构成，零 shell 依赖。

**借鉴出处**：vincentjiang06 paper-writer objective/verify gate 硬约束理念 + ARS M1-M7 失败模式组织。

**v2.2.1 扩展**（教训 #77）：数据信任级别 + 阶段闸门 — vincentjiang06 paper-writer Trust Boundary + ARS Stage 2.5/4.5 论衡化。

**v2.2.1.2 升级**（教训 #79 + #82 + #83 + #84）：4 个算法 bug 实战修正 + 数据卡双格式支持。

**v2.2.4 升级**（AI安全隐患实战 + 深度长文定位）：内联引用模式分支 + 补检索回填校验 + 修订轮流程约束。

---

## 执行前置（v2.2.0 → v2.2.4 合并版）

**主控 T8 终检前必须**：

1. ✅ **读取本规约全文**（用 `read` 工具读 `M-Gate-Algorithm.md`，**不再需要读 4 个历史版本**）
2. ✅ **读取 final/定稿.md + final/证据包/所有文件**（用 `read` 工具）
3. ✅ **依次执行 M-Form 6 项 + M-Exist 3 项 + M-Integrity 2 项**（按本规约伪代码推理，含 v2.2.1.2/v2.2.4 升级算法）
4. ✅ **产出 M-Gate-Report-v2.2.12.json**（用 `write` 工具写入）
5. ✅ **判定 exit code 0 才允许 T8 返回**，否则触发 T5 修订（v2.3.0 改 T4→T5）或主控补检索

**Phase 0 同意关卡**：本算法不调用任何外部服务（纯 LLM 推理 + 文件 I/O），无需主人额外同意。实战验证如需 m_exist_1_diff.sh（shell 版）跑 dry-run，需主人明示同意（教训 #51 金标准）。

---

## M-Form 形式合规门（7 项，含 v2.2.1.2 + v2.3.5 升级）

### M-Form-1: 引用标注完整性（v2.2.0 原版）

**伪代码**（主控 LLM 推理执行）：
```python
# 读取定稿全文
draft_text = read("final/定稿.md")

# 提取所有引用标注
import re
references = re.findall(r'\[(?:D|C|C-主|L|先)\d+\]', draft_text)
references_unique = sorted(set(references))

# 判定
if len(references_unique) > 0:
    return {"通过": True, "引用数": len(references_unique)}
else:
    return {"通过": False, "失败原因": "正文无任何引用标注"}
```

**人类验证示例**（可选，主人手动复核用）：
```bash
# 在 host shell 执行
grep -oE '\[(D|C|L|先)\d+\]' final/定稿.md | sort -u | wc -l
```

### M-Form-2: 文末四节存在性（v2.2.0 原版）

**伪代码**（主控 LLM 推理执行）：
```python
# 读取定稿全文
draft_text = read("final/定稿.md")

# 检查四节
required_sections = [
    "## 数据来源",
    "## 案例来源", 
    "## 参考文献",
    "## 先行者文献"
]

missing = [s for s in required_sections if s not in draft_text]

if len(missing) == 0:
    return {"通过": True}
else:
    return {"通过": False, "缺失章节": missing}
```

### M-Form-3: 临时编号残留（v2.2.1.2 升级版，教训 #79）

**v2.2.0 算法**（**有 bug**）：简单 grep 段落中 [L/D/Cxx] → 误判合规内联引用为「残留」。

**v2.2.1.2 新算法**：

**伪代码**（主控 LLM 推理执行）：
```python
# 读取定稿
draft_text = read("final/定稿.md")

# 辅助函数：提取正文部分（排除文末四节）
def extract_body(text):
    endnote_markers = ["## 数据来源", "## 案例来源", "## 参考文献", "## 先行者文献", "## 附"]
    for marker in endnote_markers:
        if marker in text:
            text = text.split(marker)[0]
    return text

# 辅助函数：提取文末部分
def extract_endnote(text):
    endnote_markers = ["## 数据来源", "## 案例来源", "## 参考文献", "## 先行者文献", "## 附"]
    parts = []
    for marker in endnote_markers:
        if marker in text:
            parts.append(text.split(marker)[1] if len(text.split(marker)) > 1 else "")
    return "\n".join(parts)

# 提取正文和文末的引用编号
import re
body_text = extract_body(draft_text)
endnote_text = extract_endnote(draft_text)

intext = sorted(set(re.findall(r'\[(L|D|C)\d+\]', body_text)))
endnote = sorted(set(re.findall(r'\[(L|D|C)\d+\]', endnote_text)))

# 计算真正残留（正文有但文末无）
orphan = sorted(set(intext) - set(endnote))

if len(orphan) == 0:
    return {"通过": True}
else:
    return {"通过": False, "残留编号": orphan}
```

**人类验证示例**（可选）：
```bash
# 提取正文编号（文末四节之前）
awk '/^## 数据来源|^## 案例来源|^## 参考文献|^## 先行者/{exit} {print}' final/定稿.md | \
  grep -oE '\[(L|D|C)\d+\]' | sort -u > /tmp/intext.txt

# 提取文末编号
awk '/^## 数据来源|^## 案例来源|^## 参考文献|^## 先行者/{flag=1} flag' final/定稿.md | \
  grep -oE '\[(L|D|C)\d+\]' | sort -u > /tmp/endnote.txt

# 计算差集
comm -23 /tmp/intext.txt /tmp/endnote.txt  # 正文有但文末无
```

**实战验证**：
- 实战 5（教师场域孤岛）：v2.2.0 算法 38 条命中（误判）→ v2.2.1.2 算法 0 命中（合规内联引用）✅
- 实战 4（品牌一致性）：v2.2.0 算法 14 条命中（误判）→ v2.2.1.2 算法 0 命中 ✅

### M-Form-4: 角色元数据泄露（v2.2.0 原版）

**伪代码**（主控 LLM 推理执行）：
```python
# 读取定稿
draft_text = read("final/定稿.md")

# 元数据泄露检查词
metadata_leaks = [
    "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8",
    "交接报告", "六要素", "论衡主控", "子代理", "反哺报告", "角色卡"
]

found = [word for word in metadata_leaks if word in draft_text]

if len(found) == 0:
    return {"通过": True}
else:
    return {"通过": False, "泄露词": found, "优先级": "P0"}
```

**注意**：M-Form-4 是 P0 优先级，角色元数据泄露 = 读者看到论衡内部代码 = 失去学术严肃性。

### M-Form-5: 过程语言残留（v2.2.0 原版）

**伪代码**（主控 LLM 推理执行）：
```python
# 读取定稿
draft_text = read("final/定稿.md")

import re

# 过程语言检查
process_patterns = [
    r'v[0-9] 稿',
    r'初稿',
    r'草稿',
    r'修订说明',
    r'上一版',
    r'下一版'
]

found = []
for pattern in process_patterns:
    matches = re.findall(pattern, draft_text)
    if matches:
        found.extend(matches)

# 特殊检查："据行业经验估算" 必须有 [行业估算] 标记
estimate_uses = re.findall(r'据行业经验估算', draft_text)
for use in estimate_uses:
    # 检查上下文是否有 [行业估算] 标记
    context = get_paragraph_containing(draft_text, use)
    if "[行业估算" not in context:
        found.append("据行业经验估算（未标记）")

if len(found) == 0:
    return {"通过": True}
else:
    return {"通过": False, "残留词": found}
```

**注意**："据行业经验估算" 是 v2.1.1 引入的「合法估算标记」。段落开头标 `[行业估算，非数据卡]` → G6 论据类型自标（合法）；无标记直接用 → P1 残留。

### M-Form-6: 信任级别标注完整性（v2.2.1.2 双格式升级版，教训 #83 + #84）

**v2.2.1 算法**：仅支持标准 [Dxx] 格式。

**v2.2.1.2 新算法**（双格式支持）：

**伪代码**（主控 LLM 推理执行）：
```python
# 读取数据卡
data_card_text = read("final/证据包/数据卡.md")

import re

# 标准格式检查（[Dxx] 编号）
d_entries_std = re.findall(r'^\*\*\[D\d+\]', data_card_text, re.MULTILINE)
trust_std = re.findall(r'信任级别：(已发布|主人投喂|二手转引)', data_card_text)

# 表格 fallback 检查（1.x 表格格式）
d_entries_table = re.findall(r'^\| \d+\.\d+ \|', data_card_text, re.MULTILINE)
trust_table = re.findall(r'\|\s*(已发布|主人投喂|二手转引)\s*\|', data_card_text)

# 判定
std_pass = (len(d_entries_std) == len(trust_std))
table_pass = (len(d_entries_table) == len(trust_table))

if std_pass and table_pass:
    return {
        "通过": True,
        "标准格式": {"条目": len(d_entries_std), "信任级别": len(trust_std)},
        "表格格式": {"条目": len(d_entries_table), "信任级别": len(trust_table)}
    }
else:
    return {"通过": False, "详情": {"标准格式通过": std_pass, "表格格式通过": table_pass}}
```

**人类验证示例**（可选）：
```bash
# 标准格式
grep -cE '^\*\*\[D[0-9]+\]' final/证据包/数据卡.md  # 条目数
grep -c '信任级别：' final/证据包/数据卡.md  # 信任级别标注数

# 表格格式
grep -cE '^\| [0-9]+\.[0-9]+ \|' final/证据包/数据卡.md  # 表格行数
grep -cE '\|\s*(已发布|主人投喂|二手转引)\s*\|' final/证据包/数据卡.md  # 信任级别字段数
```

**实战验证**：
- 实战 5（教师场域孤岛）：标准格式 47 条 D + 0 信任级别 → 失败
- 实战 4（品牌一致性）：表格格式 35 行 + 0 信任级别 → v2.2.1.2 能识别为表格格式

### M-Form-7: 定稿文末节标题白名单纯净（v2.3.5 新增，教训 #139）

**背景**：v2.3.1 首次实战（ai-productivity-scene-dependence）定稿文末混入「图表清单」「引用规范（四节闭环）」「主控签字（T8 终检）」三段操作员报告内容，而「终检必查项①」只在文档层声明、未机械执行——T8 签字时自己签「✅ 交付边界纯净」但文末明明混着禁止项。**教训 #139：规范从文档层到执行层断链，签字走形式。**

**伪代码**（主控 LLM 推理执行）：
```python
# 读取定稿全文
draft_text = read("final/定稿.md")

import re

# 白名单 5 节（deliverables.md「定稿文末白名单」）
whitelist = ["参考文献", "数据来源", "案例来源", "先行者文献", "AI 使用声明"]

def is_whitelisted(title):
    # 前缀匹配：容忍「数据来源（可信度标注）」这类带括号的变体
    return any(title == w or title.startswith(w) for w in whitelist)

# 提取所有二级标题（含行号）
lines = draft_text.split('\n')
sections = [(i, m.group(1)) for i, l in enumerate(lines)
            if (m := re.match(r'^##\s+(.+)$', l))]

# 找文末节起点（第一个白名单标题）
start_idx = next((idx for idx, (i, t) in enumerate(sections) if is_whitelisted(t)), None)

if start_idx is None:
    return {"通过": False, "优先级": "P0", "失败原因": "文末无任何白名单节（参考文献/数据来源/案例来源/先行者文献/AI 使用声明）"}

# 起点之后的所有 ## 标题必须在白名单内
violations = [t for (i, t) in sections[start_idx:] if not is_whitelisted(t)]

if len(violations) == 0:
    return {"通过": True}
else:
    return {"通过": False, "优先级": "P0", "违规节标题": violations,
            "失败原因": "文末混入操作员报告节（图表清单/主控签字/引用规范等），需移入 final/交付说明.md 或删除"}
```

**人类验证示例**（可选）：
```bash
# 从第一个白名单标题起，打印其后所有 ## 标题——白名单外任何输出 = 违规
awk '/^## (参考文献|数据来源|案例来源|先行者文献|AI 使用声明)/{flag=1} flag && /^## /{print}' final/定稿.md
```

**判定铁律**：M-Form-7 是 **P0 优先级**。文末混入操作员报告节 = 读者看到论衡内部代码 = 失去「论文是给读者的，报告是给主人的」边界。**T8 在 M-Form-7 exit 0 之前，禁止在签字块写「交付边界纯净」四个字**（教训 #139）。

### M-Form-8: 三角验证覆盖率检查（v2.3.7 论文三实战升级，P1-4）

**背景**：v2.3.7 论文三实战 §四 P4 一直缺 [Lxx]（L=0 D=22 C=3），直到 T7 fallback 审计才发现（v3→v4 加了 [L06] [L12]）。**毛在才不出现**——主控「三角验证把关」职责未机制化，写手 v1 落地前没自动跑 [Lxx]+[Dxx]+[Cxx] 三维 grep。

**三角验证原理**（论衡核心机制）：任何论点必须能映射到文献卡[Lxx]+数据卡[Dxx]+案例卡[Cxx]（涉企业行为/事件者必须配案例卡，至少两项齐全）。检索不到就标缺口，严禁编造。主角控「三角验证把关」职责（2026-08-13 v2.4 增）原本是主控手动检查，v2.3.7 P1-4 升级为**写手 v1 落地前机械化自动跑**。

**伪代码**（主控 LLM 推理执行，写手 v1 落地前跑）：
```python
import re

# 读取任务简报 + 初稿
brief = read("01-任务简报.md")
draft_text = read("drafts/初稿-v1.md")

# 提取任务简报 §四「核心论点」清单（如 [论点N] 格式）
# 如任务简报未明确标论点，以 §三 研究问题作为论点提取依据
claim_pattern = re.findall(r'\[论点\d+\]|第[一二三四五六七八九十]+章', brief)
claims = [c.strip() for c in claim_pattern]

# 从初稿提取所有引用编号（4 类）
l_refs = re.findall(r'\[L\d+\]', draft_text)
d_refs = re.findall(r'\[(?:D-?基?-?\w*-?\d+)\]', draft_text)
c_refs = re.findall(r'\[C\d+\]', draft_text)

# 对每个论点检查三角验证：拆初稿为按论点的段落（按章节切分）
sections = re.split(r'^## ', draft_text, flags=re.MULTILINE)

violations = []
for claim in claims:
    # 找包含该论点的章节
    section_for_claim = next((s for s in sections if claim in s), "")
    # 检查三角验证覆盖率
    has_l = bool(re.search(r'\[L\d+\]', section_for_claim))
    has_d = bool(re.search(r'\[(?:D-?基?-?\w*-?\d+)\]', section_for_claim))
    has_c = bool(re.search(r'\[C\d+\]', section_for_claim))
    # 三角验证：至少 2 项齐全（不必须 3 项）
    coverage = sum([has_l, has_d, has_c])
    if coverage < 2:
        violations.append({
            "claim": claim,
            "section": section_for_claim[:50],
            "has_L": has_l,
            "has_D": has_d,
            "has_C": has_c,
            "coverage": f"{coverage}/3"
        })

if len(violations) == 0:
    return {"通过": True, "论点数": len(claims)}
else:
    return {"通过": False, "优先级": "P0",
            "未复核论点数": len(violations),
            "违规详情": violations,
            "失败原因": "写手 v1 未补齐三角验证覆盖（<2 类引用），需补检索或降级为「观点」"}
```

**触发时机**：
1. **写手 v1 落地后**（v1 写手产物已落盘）→ T4 分析员或主控跑 M-Form-8 预检 → 不通过 → 打回 v2 重写（计入修订轮）
2. **T7 审计员**跑最终审计时也跑 M-Form-8 → 不通过 → 打回（计入修订轮）

**实战背景**（v2.3.7 论文三）：§四 P4 [论点4] 一直缺 [Lxx]（L=0 D=22 C=3）直到 T7 fallback 审计才发现 → v3→v4 加了 [L06] [L12] 修补 → 浪费 1 轮修订。v2.3.7 升级后 M-Form-8 在 v1 落地时拦截，不再依赖 T7 兜底。

**人类验证示例**（可选）：
```bash
# 提取每个章节的引用类型分布
awk '/^## /{section=$0; next} /\[L[0-9]+\]/{l++} /\[D[0-9]+\]/{d++} /\[C[0-9]+\]/{c++} END{print section, "L="l, "D="d, "C="c}' drafts/初稿-v1.md
```

---

## M-Exist 存在性合规门（3 项，含 v2.2.1.2 + v2.2.4 升级算法）

### M-Exist-1: 文末四节双向 diff（v2.2.1.2 + v2.2.4 升级版）

**v2.2.0 算法**（**有 bug**）：awk 严格匹配 4 个标准文末节 → 对「## 附」段误判。

**v2.2.1.2 升级算法**（教训 #82）+ **v2.2.4 内联引用 + 补检索回填分支**：

```
算法步骤：
1. 判断引用格式：读 01-任务简报.md「引用格式」字段
   - 「内联（机构，年份）」或「公众号/商业评论/行业分析」 → 走内联模式分支（v2.2.4）
   - 「[Lxx]/[Dxx] 编号」或「期刊/学术」 → 走标准 diff（v2.2.1.2）

2A. 标准模式（v2.2.1.2）：
   ① 提取正文 [Dxx]/[Cxx]/[Lxx]/[先xx]（不在文末任意节内）→ set_intext
   ② 提取文末任意节（标准 ## 数据来源 + ## 案例来源 + ## 参考文献 + ## 先行者文献 + 非标准 ## 附 等 + 文末最后 1/3 段 fallback）的所有引用编号 → set_endnote
   ③ 计算双向 diff：comm -23 set_intext set_endnote = 漏引；comm -13 set_intext set_endnote = 孤儿
   ④ 判定：漏引空 + 孤儿空 → 通过

2B. 内联模式（v2.2.4）：
   ① 提取正文内联引用（机构，年份）：grep -oE '（[^（）]*[0-9]{4}[^（）]*）' | sort -u
   ② 5 项依赖编号的检查必须改为「可回溯性」检查：
      - M-Exist-1：每条内联引用能否在文末四节+证据包找到对应条目
      - G2 数据溯源：每个正文数字能否在数据卡/文献卡找到来源（防无主数据）
      - M-Exist-3：引用机构的信任级别在数据卡/案例卡有标注
      - G4-2 四节 diff：正文引用的机构/数据/案例在文末四节有对应
   ③ 判定：全部内联引用可回溯 + 所有数字有源 + 信任级别齐全 → 通过；任一不可回溯 → P1

伪代码（标准模式）：
intext = extract_intext_v2(draft_text)
endnote = extract_endnote_v2(draft_text, standard=True, non_standard=True, last_third=True)
leaked = sorted(set(intext) - set(endnote))
orphan = sorted(set(endnote) - set(intext))
return (len(leaked) == 0 and len(orphan) == 0, leaked, orphan)
```

**v2.2.4 补检索回填校验分支**（当流水线发生过补检索时触发）：

```
1. 判断是否发生补检索：检查 run/<项目名>/literature/ 是否有「补检索-*.md」文件

2. 回填校验（v2.2.5 修正，教训 P1-2：不可用「L总数==清单条目数」判定）：
   ⚠️ 反例警示（v2.2.11 补充）—— **不要用** 等式判定「L总数==文末清单条目数」。
   文末参考文献清单可包含**非 L 文献**（法规[S]/报告[R]/标准/数据库[DB/OL]/网站等），
   如 GAO/EU AI Act/中国办法/OECD/Stanford HAI/AIID，等式在实战中「23==23」可能只是巧合（不同来源凑出同样数字）。
   扫描器误读为「L23==ref23 PASS」，**这是反例不是示例**。

   正确判定法（v2.2.11 明确）：
   ① 提取补检索新增 L 编号（文献卡中「补检索」段标记）
   ② 对**每个**补检索 L，**人工逐条**检查文末参考文献清单是否有对应条目（按作者/标题/期刊匹配）
   ③ 判定：每个补检索 L 都在文末清单有对应条目 → 通过；任一缺 → P1
```

**实战验证**：
- 实战 4（品牌一致性-发布稿）：v2.2.0 算法误判 14 条漏引 → v2.2.1.2 算法 0 漏引 0 孤儿（## 附 段被识别）✅
- 实战 AI安全隐患：v2.2.1.2 标准 diff 在内联引用模式下空转 → v2.2.4 内联模式分支覆盖 24 条引用 ✅

### M-Exist-2: 证据包文件完整性 sha256（v2.2.0 原版 + v2.2.10 跨平台等价命令 + v2.2.11 能力边界修正）

```
算法步骤（v2.2.17 修订，回应 ClawHub scanner v2.2.16 finding F03+F05 94%/92%）：
1. 读取 final/证据包/ 目录下所有 .md 和 .txt 文件
2. **LLM 能力边界**（v2.2.17 澄清）：主控 LLM 不能直接计算 sha256 二进制哈希 → 主控用 `read` 读全文 + 推理验证「文件非空」+ 列文件名 +修改时间。**重要：以下占位符机制是论衡默认设计，不是 bug**。
3. **生成 sha256 占位**（v2.2.17 明确占位符机制）：在 final/交付说明.md「证据包指纹」段写出（由主控 LLM 写入，纯文本占位符）：
   ```
   ## 证据包指纹（v2.2.17）

   ⚠️ 重要：以下 sha256 哈希是【待主人在 host shell 手动计算后回填】的占位符，不是 agent 计算结果。

   - 数据卡.md: `[SHA256-PENDING:HOST-VERIFY]`
   - 案例卡.md: `[SHA256-PENDING:HOST-VERIFY]`
   - 文献卡.md: `[SHA256-PENDING:HOST-VERIFY]`
   - 先行者清单.md: `[SHA256-PENDING:HOST-VERIFY]`

   主人回填（可选）：
   sha256sum final/证据包/数据卡.md >> final/交付说明.md
   sha256sum final/证据包/案例卡.md >> final/交付说明.md
   # ... 其他文件同上
   ```
4. **判定**（v2.2.17 三种状态全部接受）：
   - （a）占位符存在 `[SHA256-PENDING:HOST-VERIFY]` → **P5 ✅ 通过**（主人未验证不阻塞交付）
   - （b）实际 sha256 已回填（主人手动计算后）→ **P5 ✅ 通过**（高信任度）
   - （c）指纹段完全缺失 → **P5 ❌ 失败**（主控未生成占位符，是真错误）
5. **人类主人补填**（v2.2.17 明示）：可选步骤，人类主人在 host shell 跑后回填 sha256 值
6. **本文档中所有 sha256 示例**（v2.2.17 立场声明）：是「跨平台命令参考」，给主人在自己机器上手动验证用——**不是 agent 执行的代码**。论衡 LLM **不执行**任何 bash 命令（不在 15 项白名单内）。
```

**跨平台等价命令**（v2.2.10 新增，教训 #107）——**仅人类主人使用，不是论衡 agent 调用**：

| 平台 | 命令 |
|------|------|
| **Linux/macOS** | `sha256sum file.md` |
| **Windows PowerShell** | `Get-FileHash -Algorithm SHA256 file.md` |
| **Windows CMD** | `certutil -hashfile file.md SHA256` |
| **Python（任意平台）** | `hashlib.sha256(open(file,'rb').read()).hexdigest()` |

**v2.2.11 能力边界澄清**（回应 ClawHub scanner finding #4 98%）：
- 论衡 agent **不能** 直接计算 sha256（不在 15 项白名单内）
- 主控 LLM 能用 `read` 读全文做「文件非空/有内容」验证（**这是 LLM 推理，不是 sha256**）
- 真正 sha256 由人类主人在 host shell **手动计算后回填**到「证据包指纹」段
- 本算法的「exit code」判定仅指「所有文件能被主控 read 验证非空」，不包括 sha256 完整性验证（sha256 是人类补填项）
```

### M-Exist-3: 数据信任级别一致性 diff（v2.2.1.2 双格式升级版，教训 #84）

**v2.2.1 算法**：grep -oE '\[D[0-9]+\]' final/定稿.md → **不支持表格行 [1.x] 引用**。

**v2.2.1.2 新算法**（双格式支持）：

```
算法步骤：
1. 正文引用提取：
   - 标准格式 [Dxx]：grep -oE '\[D[0-9]+\]' final/定稿.md → set_intext_d
   - 表格格式 [1.x]：grep -oE '\[1\.[0-9]+|\[2\.[0-9]+' final/定稿.md → set_intext_table

2. 数据卡条目提取：
   - 标准格式 [Dxx]：grep -oE '^\*\*\[D[0-9]+\]' final/证据包/数据卡.md → set_card_d
   - 表格格式 [1.x]：grep -oE '^\| ([0-9]+\.[0-9]+) |' final/证据包/数据卡.md → set_card_table

3. 信任级别一致性 diff：
   - 标准格式 diff：comm -23/-13 set_intext_d set_card_d
   - 表格格式 diff：comm -23/-13 set_intext_table set_card_table

4. 信任级别空标检查：
   - 标准格式：每条 [Dxx] 对应数据卡信任级别非空
   - 表格格式：每行 [1.x] 表格的「信任级别」列非空

5. 判定：所有 diff 空 + 信任级别全填 → 通过；任一非空 → 失败

伪代码：
intext_d = sorted(set(re.findall(r'\[D\d+\]', draft_text)))
intext_table = sorted(set(re.findall(r'\[\d+\.\d+\]', draft_text)))
card_d = sorted(set(re.findall(r'^\*\*\[D\d+\]', data_card_text, re.MULTILINE)))
card_table = sorted(set(re.findall(r'^\| (\d+\.\d+) \|', data_card_text, re.MULTILINE)))
trust_d = extract_trust_dict_standard(data_card_text)
trust_table = extract_trust_dict_table(data_card_text)
leaked = sorted(set(intext_d) - set(card_d))
orphan = sorted(set(card_d) - set(intext_d))
missing_trust = [d for d in intext_d if d not in trust_d or trust_d[d] == '']
all_pass = (len(leaked) == 0 and len(orphan) == 0 and len(missing_trust) == 0)
return (all_pass, leaked, orphan, missing_trust)
```

---

## M-Integrity 阶段闸门（2 项，含 v2.2.4 修订轮流程约束）

### M-Integrity-1: T2.5 完整性门（T2 数据检索 → T4 分析前，v2.2.1 新增 + v2.2.10 时序修正）

> **v2.2.10 重要修正**：原版逻辑矛盾 — M-Integrity-1 在 T2→T4 之间，大纲（T4 产物）尚不存在却需查「数据条目数 ≥ 大纲 D 列数」。修正为查任务简报（Phase 0 已产物化）子问题的数据需求数。

```
算法步骤（主控 LLM 兜底执行）：
1. 检查数据卡文件存在：ls final/证据包/数据卡.md → 必须存在
2. 提取数据条目数（双格式）：
   标准 [Dxx] 计数：grep -cE '^\*\*\[D[0-9]+\]' final/证据包/数据卡.md
   表格 [1.x] 计数：grep -cE '^\| [0-9]+\.[0-9]+ \|' final/证据包/数据卡.md
   两者取并集 dedupe
3. **v2.2.10 修正**：提取任务简报子问题数据需求数
   从 01-任务简报.md 「研究问题」段读取每个子问题的「需找数据点 ≥N」
   需求总数 = Σ 子问题数据需求数
   （不再 grep analysis/分析大纲.md，因 T4 尚未产出）
4. 数据条目数 >= 任务简报需求总数 → 数据完整 → 通过；否则 → 触发 T2 重检索
5. 信任级别完整性：M-Form-6 exit 0 → 通过；否则 → 触发 T2 补标注
6. 信任级别一致性：M-Exist-3 exit 0 → 通过；否则 → 触发 T2 补数据卡
7. **v2.2.17 修复（教训 #123）**：sha256 指纹为**可选验证**——主控发占位符 `[SHA256-PENDING:HOST-VERIFY]` 到 `final/交付说明.md`「证据包指纹」段，**不**作为闸门强制项。主人需手动在 host shell 跑 `sha256sum final/证据包/*.md >> final/交付说明.md`（参考 `_shared/m_exist_1_diff.sh`）。**该步骤不是 agent 执行的代码，是人类验证示例。**
8. **v2.2.10 新增（教训 #106）**：数据卡头部「共 N 条」声明 vs 实际 grep 计数一致性
   头部声明：grep -oE '共 [0-9]+ 条' final/证据包/数据卡.md
   实际计数：步骤 2 的双格式并集 dedupe
   不一致 → 标 Failed（防 T2 未自检 + T4 人工 grep 才发现的延后问题）
9. 判定：7 项全通过 → T2.5 ✅ 派发 T4；任一失败 → T2.5 ❌ 不派发 T4
   **v2.3.2 删「主人签字 Phase 1」（教训 #136）**：T2.5 是纯机械化闸门，主人签字只在 Phase 0（4 选 1 同意关卡）/ Phase 2.5（大纲确认）/ Phase 5（终稿）三节点；检索完成→T4 之间**不应**打断主人（v2.3.1 实战暴露「T2/T3 完成后分别询问主人 4 选 1」的过度打断）

伪代码：
data_card = 'final/证据包/数据卡.md'
data_count = count_d_entries(data_card)
outline_count = count_data_requirements_in_brief('01-任务简报.md')  # v2.2.17 显式标注：读任务简报，不读分析大纲
data_ok = data_count >= outline_count
trust_form_ok = check_M_Form_6(data_card)
trust_exist_ok = check_M_Exist_3(data_card, 'final/定稿.md')
sha256_pending = emit_placeholder_sha256(data_card)  # v2.2.17：发占位符 [SHA256-PENDING:HOST-VERIFY]，**不**作为闸门强制项
header_consistent = check_header_vs_actual_count(data_card)  # v2.2.10 新增
all_pass = data_ok and trust_form_ok and trust_exist_ok and header_consistent  # v2.3.2 删 owner_signed（主人签字不在 T2.5 闸门，教训 #136）
# v2.2.17 修复 F03 + F05：sha256 不是“必填门”，是“可选验证”（主人手动跑）
return (all_pass, fail_reasons, sha256_pending)
```

**实战反例**（教训 #106）：T2 写数据卡时凭印象在头部写「共 29 条」，实际 grep 只有 26 条，T4 靠人工 grep 才发现。本次新增步骤 9 拦截。
```

### M-Integrity-2: T7.5 完整性门（T8 审计 → T8 终检前，v2.2.1 新增 + v2.2.4 修订轮扩展）

```
算法步骤（主控 LLM 兜底执行）：
1. 检查审计报告最新版：ls audits/审计报告-vN.md → N 取最大 → 必须存在
2. P0/P1 清单已列：grep -E '^- \*\*P0|^- \*\*P1' audits/审计报告-vN.md → 必须有 ≥1 条
3. M 门（M-Form 6 项 + M-Exist 3 项）全部 exit 0：读 M-Gate-Report-v2.2.12.json → 全部 true
4. 证据包 sha256 指纹完整：读 final/交付说明.md「证据包指纹」段 → 必须有 sha256 哈希
5. 信任级别一致性：M-Exist-3 exit 0 → 通过
6. 论文交付物 vs 操作员报告独立隔离：
   - final/定稿.md（论文）不含 audits/ / final/交付说明.md 内容
   - final/交付说明.md / audits/（报告）不混入 final/定稿.md
7. **v2.3.3 删「主人签字 Phase 5」（教训 #138）**：T7.5 是纯机械化闸门（T7 审计 → T8 终检），主人签字在 Phase 5（T8 终检交付后主人验收），**不在** T7.5 闸门里；原「如有修订回环 ≤2 轮降级触发则主人读局限性.md」逻辑，改为 T8 终检交付时一并请主人验收（含局限性声明）
8. **v2.2.4 修订轮流程约束**：检查本轮修订是否由独立写手子代理执行
   - 证据：status.md 修订回环记录写明「spawn 独立写手 vN 执行」
   - 若发现主控代执行 → 打回修订轮，强制 spawn 独立写手
   - 例外：主控直接 edit 定点修复（<5 处纯校对类，v2.1.3 允许）不视为违反
9. 判定：7 项全通过 → T7.5 ✅ 派发 T8；任一失败 → T7.5 ❌ 不派发 T8

伪代码：
audit_latest = get_latest_audit_report('audits/')
p0_p1_listed = check_p0_p1_listed(audit_latest)
m_gate_ok = check_m_gate_all_pass('final/M-Gate-Report-v2.2.12.json')
sha256_ok = check_evidence_sha256('final/交付说明.md')
trust_ok = check_M_Exist_3(...)
isolation_ok = check_draft_vs_report_isolation('final/定稿.md', 'final/交付说明.md', 'audits/')
revision_independent = check_revision_by_independent_writer('status.md')
all_pass = audit_latest and p0_p1_listed and m_gate_ok and sha256_ok and trust_ok and isolation_ok and revision_independent  # v2.3.3 删 owner_signed（主人签字在 Phase 5，不在 T7.5 闸门，教训 #138）
return (all_pass, fail_reasons)
```

---

## M-Gate-Report v2.2.4 输出格式（4 版本合并最终版）

主控 T8 执行 M 门后，必须产出 `final/M-Gate-Report-v2.2.12.json`：

```json
{
  "schema": "M-Gate-Report-v2.2.4",
  "项目": "<项目名>",
  "执行时间": "<ISO-8601>",
  "执行者": "论衡主控 T8 (LLM 兜底执行)",
  "M门执行版本": "v2.2.4（v2.2.8 起主流程读合并完整版 M-Gate-Algorithm.md）",

  "M-Form_形式合规门": {
    "M-Form-1_引用标注完整性": true | false,
    "M-Form-2_文末四节存在性": true | false,
    "M-Form-3_临时编号残留_v2.2.1.2升级": {
      "v2.2.0算法_误判命中数": 0,
      "v2.2.1.2算法_真正残留数": 0,
      "通过": true | false
    },
    "M-Form-4_角色元数据泄露": true | false,
    "M-Form-5_过程语言残留": true | false,
    "M-Form-6_信任级别标注完整性_v2.2.1.2双格式": {
      "标准格式_条目数": 0,
      "标准格式_信任级别标注数": 0,
      "表格格式_行数": 0,
      "表格格式_信任级别字段数": 0,
      "通过": true | false
    },
    "M-Form-7_定稿文末节标题白名单纯净_v2.3.5": {
      "文末节标题": [],
      "违规节标题": [],
      "通过": true | false
    },
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
    "M-Exist-1_双向diff_v2.2.1.2+v2.2.4升级": {
      "mode": "inline|standard",
      "v2.2.0算法_误判漏引数": 0,
      "v2.2.1.2算法_真正漏引数": 0,
      "v2.2.1.2算法_真正孤儿数": 0,
      "内联引用_条数": 0,
      "内联引用_可回溯条数": 0,
      "补检索回填_新增L数": 0,
      "补检索回填_已回填数": 0,
      "通过": true | false
    },
    "M-Exist-3_信任级别一致性_v2.2.1.2双格式": {
      "标准格式_漏注": [],
      "标准格式_孤儿": [],
      "标准格式_信任级别空标": [],
      "表格格式_漏注": [],
      "表格格式_孤儿": [],
      "表格格式_信任级别空标": [],
      "通过": true | false
    },
    "全部通过": true | false
  },

  "M-Integrity_阶段闸门": {
    "M-Integrity-1_T2.5": {
      "数据条目完整性": true | false,
      "信任级别完整性": true | false,
      "通过": true | false
    },
    "M-Integrity-2_T7.5": {
      "审计报告最新版": true | false,
      "P0P1清单已列": true | false,
      "M门全exit0": true | false,
      "论文vs报告隔离": true | false,
      "修订轮独立写手_v2.2.4新增": true | false,
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
  "下一步": "T8 返回" | "触发 T8 修订" | "触发主控补检索" | "触发 T2.5 重审" | "触发 T7.5 重审"
}
```

---

## 论衡哲学化（4 版本合并）

- **「M 门是论衡的「返璞归真」** —— 不引入 Python 脚本，不扩大 exec 白名单，由 LLM 推理执行机械化校验」（v2.2.0）
- **「形式合规 ≠ 存在性合规**」—— vincentjiang06 核心洞察论衡化（v2.2.0）
- **「**M 门由 LLM 兜底**」** —— 主控用 read 工具读本规约 + final/ 文件，按伪代码推理（v2.2.0）
- **「**数据信任级别是论衡防御 prompt injection 的核心机制**」** —— vincentjiang06 paper-writer Trust Boundary 论衡化（v2.2.1）
- **「**阶段闸门是论衡主控纪律**」** —— 不引入新 agent，主控用 todo_write + read 实现；ARS Stage 2.5/4.5 论衡化（v2.2.1）
- **「**形式合规 ≠ 存在性合规 ≠ 信任一致**」** —— v2.2.0 → v2.2.1 M 门体系三层验证（v2.2.1）
- **「**M 门算法的实战有效 = 论衡哲学最纯粹的版本（M 门零 exec 依赖）的实战验证**」** —— v2.2.1.2 是 v2.2.0/v2.2.1 算法 bug 的实战修正
- **「**实战反馈驱动升级**」** —— v2.2.1.2/v2.2.4 不是规划出来的，是实战反馈暴露出来的
- **「**数据卡格式不只是「字段格式」**」** —— v2.2.1.2 P0-C 双格式支持 = 论衡防御体系的「全格式兼容」
- **「内联引用 ≠ 无引用**」** —— 公众号/商业评论的引用是可信度，M 门必须校验其可回溯性，不能因格式不同而放行（v2.2.4）
- **「**补检索是源头，回填是闭环**」** —— 补检索新增文献必须同步回填文末清单，否则正文引用悬空，T8 必拦（v2.2.4）
- **「修订也需独立角色**」** —— 论衡 8 角色独立的核心理念应贯穿到修订轮，主控只协调不代笔（v2.2.4）

---

## 教训沉淀（v2.2.0 ~ v2.2.4 全部）

- **教训 #65**（v2.2.0）：集成测试 > 组件测试。组件能跑 ≠ 系统能用
- **教训 #77**（v2.2.1）：数据信任级别是论衡防御 prompt injection 的核心机制
- **教训 #79**（v2.2.1.2）：v2.2.0 M-Form-3 算法 bug → v2.2.1.2 升级 comm -13 diff
- **教训 #82**（v2.2.1.2）：v2.2.0 M-Exist-1 算法对「## 附」段误判 → v2.2.1.2 升级支持多种文末节
- **教训 #83**（v2.2.1.2）：v2.2.1 P0-C 在「表格格式数据卡」落地短板 → 数据卡-template.md 加表格 fallback 段
- **教训 #84**（v2.2.1.2）：v2.2.1 P0-C 必须支持「[Dxx] 编号 + 1.x 表格」双格式 → M-Form-6 + M-Exist-3 双格式支持
- **教训 P1-2**（v2.2.5 自指审计修正）：不可用「L总数==清单条目数」判定补检索回填——文末清单含非 L 文献，等式可能巧合
- **教训 P1-3**（v2.2.5 自指审计修正）：内联模式下不只 M-Exist-1 空转，G2/M-Form-1/M-Exist-3/G4-2 等所有依赖 [Dxx]/[Lxx] 编号的机械检查都会空转，必须覆盖全部 5 项而非只修 M-Exist-1

**实战反馈映射**：

- 实战 2（品牌一致性）：T2 数据检索完成后 → 直接进 T4 分析 → 信任级别缺失未拦截 → T8 写手引 14 条 [Lxx] 漏引 → 实战 2 失败 → T2.5 闸门可防
- 实战 3（教师场域 outputs/）：outputs/ 公众号版 = 论文交付物，但 run/ 含完整文末四节 = 论衡工作区版本 → 两者不一致未拦截 → T7.5 闸门可防
- 实战 4（品牌一致性-发布稿）：v2.2.0 算法误判 14 条漏引 → v2.2.1.2 算法 0 漏引 0 孤儿（## 附 段被识别）✅
- 实战 5（教师场域孤岛）：v2.2.0 算法 38 条命中（误判）→ v2.2.1.2 算法 0 命中（合规内联引用）✅
- 实战 AI安全隐患：v2.2.1.2 标准 diff 在内联引用模式下空转 → v2.2.4 内联模式分支覆盖 24 条引用 ✅

---

## 历史版本归档（v2.2.8 Phase D-1 合并后）

- `M-Gate-Algorithm-v2.2.0.md`（基础版 3.1K tokens）
- `M-Gate-Algorithm-v2.2.1.md`（增量版 5.0K tokens）
- `M-Gate-Algorithm-v2.2.1.2.md`（算法升级版 5.0K tokens）

3 文件已归档到 `_shared/archive/M-Gate-Algorithm-legacy/`（README 已说明）。**主流程只读本完整版**，归档版仅做版本演进参考。
