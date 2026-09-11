> 版本：v2.5.2-dsh.15（DSH 原生插件，自动同步 2026-08-26）

> **v2.5.2-dsh.5 重大修订**（测试轮反哺 14 项问题落地）：
> - **P0** #1 M-Form-2 与 M-Form-7 白名单统一（含 AI 使用声明）
> - **P0** #2 M-Form-6 扩字段（双格式 + 描述字段交叉验证，P1/P2 分级）
> - **P0** #3 M-Form-8 强制每论点含 L + coverage ≥ 2（防 L=0 通过）+ P0/P1 分级
> - **P1** #4 M-Form-5 禁词清单扩（弱 AI 痕：据可靠来源/据悉/据了解/研究显示/专家表示）
> - **P1** #7 M-Form-4 黑名单转白名单（v2.5.2-dsh.5 重大结构性修复）
> - **P1** #10/2 模板强化（任务简报「需找数据点 ≥N」+ 数据卡「信任级别」独立段强制）
> - **P1** #11 M-Exist-1 脚本化 + 严重度评级
> - **P2** #6 M-Form-1 阈值提升（L ≥3）
> - **P2** #9 M-Form-3 联动 M-Form-2 跳过（缺文末不误判全部 orphan）
> - **P2** #12 算法 vs 实现 sync CI 校验（v2.6 计划）
> - **P2** #14 M 门严重度评级（P0/P1/P2 + 可放行清单）
> - **P3** #13 实战反例结构化（教训库）
> - 全部 14 项反思见主控复盘报告（`E:\HERNESS\run\审计\论衡全量审计报告-2026-08-25.md`）


# M 门算法规约（论衡当前主流程完整版，v2.2.12 Phase D-1 合并）

> **v2.2.15 渐进式执行模式（已合并入本文档）**：把 13 项 M 门从「T8 一次性全跑」改为「5 阶段分批执行 + T8 兜底」，P0 错误提前暴露（Phase 1.5 而非 T8），节省 30-50% 工作量。详见本文档 M-Form / M-Exist / M-Integrity 各阶段描述。
>
> **v2.2.8 Phase D-1 重大变更**：本规约从「**4 个增量版本并存**」（v2.2.0/v2.2.1/v2.2.1.2/v2.2.4 共 15.4K tokens）合并为「**1 个完整版**」（本文件约 12K tokens，主流程只读这一份）。
>
> 完整版包含 v2.2.0 基础 + v2.2.1 扩展（M-Form-6 + M-Exist-3 + M-Integrity-1/2）+ v2.2.1.2 算法升级（M-Form-3 + M-Exist-1 + M-Form-6 + M-Exist-3 双格式）+ v2.2.4 内联引用 + 补检索回填 + 修订轮流程约束。**历史版本演进见 git log；主流程只读本完整版**。
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
3. 主控按下面的**伪代码推理判定**，产出 `M-Gate-Report.json`
4. exit 0 才能返回，否则触发修订或补检索

> **信任模型声明（v2.5.2-dsh 补丁，回应第三方评审 P0-2）**：「机械化」指**按固定规则逐项判定、不靠主观印象**，**不是机器代码执行**——M 门由主控 LLM 读文件后按伪代码**结构化推理**给出 exit code，是「结构化 + 可复核」而非「机器强制」。真正的正则/sha256 可由主人在 host shell 用本文 bash 示例手动复核（DSH 下主控也可用 `pwsh` 直接算 sha256 回填，见 M-Exist-2）。因此 M 门是**兜底防线**，不替代主人终审。
>
> **渐进式执行落地（v2.5.2-dsh 补丁，教训：善行实战 M-Form-7 文末白名单违规由 T8 才抓出）**：M-Form 预检**前置到 T7 审计**（M-Form-3/5/7/8，任一项失败 = P1），T8 终检只复核 + 兜底——防「机械化硬门」到最后一公里才响。
>
> **机械化脚本化（v2.5.2-dsh 补丁，token 优化）**：M-Form-1/3/5/7 + M-Exist-2 是纯正则/哈希判定，可由 `scripts/m-gate-check.mjs <final/定稿.md> <final/证据包/>` 脚本执行（**零 LLM 判定**）；T8 只判需判断力的 M-Form-8（三角验证）+ 复核脚本结果——省 T8 读定稿+证据包约 12K token，且比 LLM 自评更硬。

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
3. ✅ **依次执行 M-Form 8 项 + M-Exist 3 项 + M-Integrity 2 项**（按本规约伪代码推理，含 v2.2.1.2/v2.2.4 升级算法）
4. ✅ **产出 M-Gate-Report.json**（用 `write` 工具写入）
5. ✅ **判定 exit code 0 才允许 T8 返回**，否则触发 T5 修订（v2.3.0 改 T4→T5）或主控补检索

**Phase 0 同意关卡**：本算法不调用任何外部服务（纯 LLM 推理 + 文件 I/O），无需主人额外同意。实战验证如需 shell 脚本（脚本版）跑 dry-run，需主人明示同意（教训 #51 金标准）。

---

## M-Form 形式合规门（8 项，含 v2.2.1.2 + v2.3.5 + v2.3.7 升级）

### M-Form-1: 引用标注完整性（v2.2.0 原版 + v2.5.2-dsh.5 阈值提升）

**伪代码**（主控 LLM 推理执行）：
```python
# 读取定稿全文
draft_text = read("final/定稿.md")

# 提取所有引用标注
import re
references = re.findall(r'\[(?:D|C|C-主|L|先)\d+\]', draft_text)
references_unique = sorted(set(references))

# === v2.5.2-dsh.5 修订：阈值提升（原 ≥1 即过 → 学术深度论文基线 L≥3）===
# 防 L=0 通过（v2.3.7 §四 P4 实战反例：L=0 D=22 C=3 旧阈值过）
L_count = len(re.findall(r'\[L\d+\]', draft_text))
min_L = 3  # 学术深度论文基线（公众号/商业评论可降为 1，行业分析降为 2）
if len(references_unique) == 0:
    return {"通过": False, "失败原因": "正文无任何引用标注"}
elif L_count < min_L:
    return {"通过": False, "优先级": "P0",
            "失败原因": f"学术深度论文文献 [Lxx] < {min_L}（实测 L={L_count}），需补检索加固文献三角",
            "修订建议": "M-Form-8 联动：L=0 必触发打回（P0）；L<3 也必触发（P0）"}
elif len(references_unique) > 0:
    return {"通过": True, "引用数": len(references_unique), "L 数": L_count, "阈值": f"≥{min_L}"}
```

**v2.5.2-dsh.5 修订理由**：v2.3.7 §四 P4 实战反例暴露——L=0 D=22 C=3 旧阈值（≥1 即过）通过。修订 = a) 阈值提升到 L≥3（学术深度论文基线，公众号/商业评论模板可调）；b) 与 M-Form-8 联动（L=0 必 P0 触发打回）；c) 输出失败原因含 L 实际计数便于主控定位。

**人类验证示例**（可选，主人手动复核用）：

### M-Form-2: 文末白名单节存在性（v2.5.2-dsh.5 修订：与 M-Form-7 统一为 5 节）

**伪代码**（主控 LLM 推理执行；v2.5.2-dsh.5 起 `scripts/m-gate-check.mjs` 机械化执行）：
```python
# 读取定稿全文
draft_text = read("final/定稿.md")

# 检查 5 节白名单（与 M-Form-7 一致；v2.5.2-dsh.5 修订：原 4 节漏 AI 使用声明，测试轮 v3 修 AI 声明前 M-Form-2 一直判过但 T7 打回——前后不一致，修订统一）
required_sections = [
    "## 数据来源",
    "## 案例来源",
    "## 参考文献",
    "## 先行者文献",
    "## AI 使用声明",
]

missing = [s for s in required_sections if s not in draft_text]

if len(missing) == 0:
    return {"通过": True}
else:
    return {"通过": False, "缺失章节": missing}
```

**v2.5.2-dsh.5 修订理由**：原 v2.2.0 算法只检查 4 节，但 v2.5.0 起 M-Form-7 白名单扩为 5 节（含 AI 使用声明），导致 M-Form-2 与 M-Form-7 范围不一致——AI 使用声明缺失时 M-Form-2 通过、M-Form-7 也通过（都过），但实际漏了关键合规节（v3 测试轮 T7 打回 P1 即源于此）。统一为 5 节，**两个 M-Form 都过 → 真正合规**。

### M-Form-3: 临时编号残留（v2.2.1.2 升级版，教训 #79 + v2.5.2-dsh.5 联动 M-Form-2）

**v2.2.0 算法**（**有 bug**）：简单 检查 段落中 [L/D/Cxx] → 误判合规内联引用为「残留」。

**v2.2.1.2 新算法**：

**伪代码**（主控 LLM 推理执行）：
```python
# 读取定稿
draft_text = read("final/定稿.md")

# === v2.5.2-dsh.5 修订：联动 M-Form-2 跳过（缺文末不误判全部 orphan）===
required_sections = ["## 数据来源", "## 案例来源", "## 参考文献", "## 先行者文献", "## AI 使用声明"]
if not any(s in draft_text for s in required_sections):
    # 文末缺失 → 跳过 M-Form-3（M-Form-2 失败优先；防 extract_body 取全文 vs extract_endnote 取空 → 所有引用被误判 orphan）
    return {"通过": "SKIP", "原因": "文末缺失，M-Form-2 失败优先"}

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

**实战验证**：
- 实战 5（教师场域孤岛）：v2.2.0 算法 38 条命中（误判）→ v2.2.1.2 算法 0 命中（合规内联引用）✅
- 实战 4（品牌一致性）：v2.2.0 算法 14 条命中（误判）→ v2.2.1.2 算法 0 命中 ✅

### M-Form-4: 角色元数据泄露（v2.5.2-dsh.5 重大修订：黑名单转白名单）

**v2.2.0 原版**（**黑名单模式，已废弃**）：只查 16 个具体词，漏网多；黑名单永远补不全。

**v2.5.2-dsh.5 新版**（**白名单模式，结构性修复**）：列出**论衡白名单内容**（[Lxx]/[Dxx]/[Cxx]/[C-主xx]/[先xx] 引用 + 公开出版人名/机构名 + 通用学术术语 + 时间锚点 + 数字事实 + 通用标点），白名单外所有「流水线/论衡专属」标识都判定为元数据泄露。**白名单列举**：
- ✅ 允许：[L01]-[L12] 类引用编号 / [D01]-[D18] / [C01]-[C06] / [C-主01] 等主人洞察引用 / [先01]-[先05] 等先行者引用
- ✅ 允许：公开出版的人名（如「庄语滋」「Sadasivan」「Wittenberg」）、机构名（「欧盟」「信通院」「Stanford」）、法律法规名（「欧盟 AI Act」「中国标识办法」）
- ✅ 允许：通用学术术语（三角验证/引文/反方论证/数据卡/案例卡 等论衡通用词——但「角色卡 04-分析」等带编号的元数据禁止）
- ✅ 允许：时间锚点（年份/日期/世纪）、数字事实（百分点/数量）、通用标点
- ❌ 禁止：角色编号 T0-T9 + 角色名（主控/文献检索员/数据检索员/分析员/写手/批判伙伴/审计员/审稿人/案例检索员）——「T5 写手」「主控亲完成」等
- ❌ 禁止：论衡专属元数据（论衡 agent/流水线/技能/角色卡 N-M + 角色名/任务书/六要素/交接报告/反哺报告/教训/N/Phase 0-5/批 v2/v3/初稿/草稿/vN 稿）
- ❌ 禁止：内部路径与代号（输入材料/输出材料/任务简报第 X 行/修订说明-vN/m-gate-check.mjs/scripts/）
- ❌ 禁止：DSH 平台内部词（subagent/foreground/background 等——非论文交付物自然不用）

**伪代码**（v2.5.2-dsh.5 + v2.6 预告；主控 LLM 推理执行 + 起 m-gate-check.mjs 机械化执行）：
```python
import re

# 读取定稿
draft_text = read("final/定稿.md")

# === v2.5.2-dsh.5 白名单：先提取白名单段（标注段+引文段）剥离出禁止检测区 ===
# 剥离"## 参考文献/数据来源/案例来源/先行者文献"四节（白名单参考段+AI 使用声明可保留扫描）
forbidden_scope_end = len(draft_text)
for marker in ["## 参考文献", "## 数据来源", "## 案例来源", "## 先行者文献"]:
    idx = draft_text.find(marker)
    if idx >= 0 and idx < forbidden_scope_end:
        forbidden_scope_end = idx
scanned_text = draft_text[:forbidden_scope_end]

# === 白名单匹配（剥离区扫 [L/D/C/先xx] 引用 + 保留人名/机构名/通用术语/数字/标点）===
# 白名单正则：引用编号 / 公开机构名 / 数字 / 时间锚点
whitelist_patterns = [
    r'\[(?:L|D|C-主|C|先)\d+\]',         # 论衡引用编号
    r'\d{4}年|\d{1,2}月\d{1,2}日',     # 时间锚点
    r'\d+\.?\d*%|\d+\.?\d*\s*(?:万|亿|个|条|项|位|倍|元|倍|成)',  # 数字事实
    r'[\u4e00-\u9fff]+(?:大学|学院|研究院|政府|机构|组织|部|委|局|司|办)',  # 通用机构
    r'AI Act|标识办法|GPT-?\d*|OpenAI|Claude',  # 通用技术/法规名
]
# 白名单匹配后剥离（剩下的就是要查的禁止区）
for_pattern_text = scanned_text
for pat in whitelist_patterns:
    for_pattern_text = re.sub(pat, '', for_pattern_text)

# === 黑名单检测（在白名单剥离后的残留区查）===
forbidden_patterns = [
    # 角色编号 + 角色名
    r'T[0-9] (主控|文献|数据|分析|写手|审计|案例|批判|审稿)',
    r'(主控|文献检索员|数据检索员|分析员|写手|批判伙伴|审计员|审稿人|案例检索员)',
    # 论衡专属元数据
    r'论衡 (agent|流水线|技能|主控|测试轮)',
    r'角色卡|任务书|六要素|交接报告|反哺报告|教训 #?\d+|Phase [0-9.]+',
    r'批 v?\d+ 稿|初稿|草稿|定稿',
    # 内部路径/代号
    r'输入材料|输出材料|任务简报第 ?\d+ ?行|修订说明-?v?\d+|scripts/',
    r'm-gate-check\.mjs|consistency-check\.mjs|count-chars\.mjs',
    # DSH 平台内部
    r'\bsubagent\b|\bforeground\b|\bbackground\b|\bsubagent_fork\b',
]
found = []
for pat in forbidden_patterns:
    matches = re.findall(pat, for_pattern_text)
    if matches:
        found.extend(matches if isinstance(matches[0], str) else [m[0] for m in matches])

if len(found) == 0:
    return {"通过": True, "扫描区": "白名单剥离后残留区"}
else:
    return {"通过": False, "P1": f"元数据泄露 {len(found)} 处", "命中": list(set(found))[:5],
            "修订建议": "v2.5.2-dsh.5 起白名单模式：只允许 [Lxx]/[Dxx]/[Cxx]/[先xx]/公开人名/机构/通用术语/数字/时间锚点；其他都是泄露"}
```

**v2.5.2-dsh.5 修订理由**：v2.2.0 黑名单 16 词永远补不全（v2.5.2-dsh.4 测试轮已加 5 类仍漏 7 类）。结构性改白名单：剥离 [Lxx]/[Dxx] 等引用段+人名+机构+数字+时间锚点后查禁止词。v2.6 计划：全白名单 + 内置合规词库（学术/政策/媒体常用人名/机构名录）。

**注意**：M-Form-4 是 P0 优先级，角色元数据泄露 = 读者看到论衡内部代码 = 失去学术严肃性。

### M-Form-5: 过程语言残留（v2.2.0 原版）

**伪代码**（主控 LLM 推理执行）：
```python
# 读取定稿
draft_text = read("final/定稿.md")

import re

# 过程语言检查（v2.5.2-dsh.5 扩禁词清单：防无据断言的弱 AI 痕）
process_patterns = [
    r'v[0-9] 稿',
    r'初稿',
    r'草稿',
    r'修订说明',
    r'上一版',
    r'下一版',
    # === v2.5.2-dsh.5 扩：弱 AI 痕（无据断言）===
    r'据可靠来源',         # 缺数据卡/文献卡支撑的"权威感"措辞
    r'据悉',              # 同上
    r'据了解',             # 同上
    r'研究显示',           # 缺 [Lxx] 时为弱 AI 痕
    r'专家表示',           # 同上
    # === v2.5.2-dsh.9 扩：内部流程语言（教训：test-paper-01 §八"卡级/修卡交由案例与审计环节复核"至 T9 才被抓出）===
    # 判定范围 = 正文叙述区；AI 使用声明等披露段豁免（披露可含角色/卡/修订说明等词）
    r'卡级',
    r'修卡',
    r'承重墙',
    r'承重案例',
    r'批注',
    r'待回查',
    r'审计环节',
    r'流水线',
    r'将在[^，。\n]{0,8}订正',
    r'本文是[^，。\n]{0,20}(初稿|草稿|修订稿)',
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

**注意**：
- 「据行业经验估算」是 v2.1.1 引入的「合法估算标记」。段落开头标 `[行业估算，非数据卡]` → G6 论据类型自标（合法）；无标记直接用 → P1 残留。
- **v2.5.2-dsh.5 扩禁词清单**（「据可靠来源/据悉/据了解/研究显示/专家表示」）：v2.5.2-dsh.5 起视为「无据断言」弱 AI 痕；判定逻辑 = 出现任一禁词 + 上下文 200 字符内无 [Lxx]/[Dxx]/[Cxx] 支撑 → P1 残留（防无据权威感）。**误判豁免**：若上下文有 `[来源/二手转引/已发布]` 标记且与 [Dxx] 对应 → 通过。

### M-Form-6: 信任级别标注完整性（v2.2.1.2 双格式升级版，v2.5.2-dsh.5 扩字段）

**v2.2.1 算法**：仅支持标准 [Dxx] 格式。

**v2.2.1.2 算法**（双格式支持）：

**伪代码**（主控 LLM 推理执行；v2.5.2-dsh.5 起 `scripts/m-gate-check.mjs` 机械化执行）：
```python
# 读取数据卡
data_card_text = read("final/证据包/数据卡.md")

import re

# === 1. 标准格式（**[Dxx]** 编号 + **信任级别**独立段）===
d_entries_std = re.findall(r'^\*\*\[D\d+\]', data_card_text, re.MULTILINE)
trust_std = re.findall(r'信任级别：(已发布|主人投喂|二手转引)', data_card_text)

# === 2. 表格 fallback（1.x 格式）===
d_entries_table = re.findall(r'^\| \d+\.\d+ \|', data_card_text, re.MULTILINE)
trust_table = re.findall(r'\|\s*(已发布|主人投喂|二手转引)\s*\|', data_card_text)

# === 3. v2.5.2-dsh.5 新增：描述字段交叉验证（防 T2 将信任级别写在描述里漏检）===
# 每条 Dxx 卡片条目（到下一条 ## 前）的文本块里搜信任级别
section_starts = list(re.finditer(r'##\s*\[D\d+\]', data_card_text))
trust_in_section = 0
for i, m in enumerate(section_starts):
    end = section_starts[i+1].start() if i+1 < len(section_starts) else len(data_card_text)
    section = data_card_text[m.start():end]
    if re.search(r'信任级别[:：]|已发布|主人投喂|二手转引', section):
        trust_in_section += 1

# === 判定（v2.5.2-dsh.5 修订：双轨制避免误判）===
# 标准格式：必须有独立「信任级别：xxx」段（规范要求）
# 描述字段：补充交叉验证，但不能替代独立段（一致性声明）
std_pass = (len(d_entries_std) == len(trust_std))
desc_pass = (len(d_entries_std) <= trust_in_section)
# 两者都过 → 通过；任一不过 → 标"需补独立段"P1
if std_pass and desc_pass:
    return {"通过": True, "标准格式": {"条目": len(d_entries_std), "信任级别段": len(trust_std)}}
elif not std_pass:
    return {"通过": False, "P1": f"标准格式 [Dxx] {len(d_entries_std)} 条 vs 独立信任级别段 {len(trust_std)} 条", "建议": "每条 [Dxx] 卡片必须用独立「信任级别：xxx」段（v2.5.2-dsh.5 模板强制）", "实测": "v3 测试轮 12 条 Dxx 缺独立段（T7 兜底才打回 P1）"}
else:
    return {"通过": False, "P2": f"描述字段有信任级别提及 {trust_in_section} 次但独立段 {len(trust_std)} 条", "建议": "统一迁移到独立「信任级别：xxx」段（防描述改写后失锚）"}
```

**v2.5.2-dsh.5 修订理由**：测试轮 v3 数据卡暴露 12 条 [Dxx] 把"信任级别"信息写在了**条目描述字段**而非独立段（教训：算法盲区 + 模板不强制）。修订 = a) 算法增加描述字段交叉验证（防 T2 写法漂移漏检）；b) 数据卡模板强制「信任级别」独立段字段（v2.5.2-dsh.5 同步修订模板）；c) 失败时给出 P1/P2 分级与具体建议。

**实战验证**：
- 实战 5（教师场域孤岛）：标准格式 47 条 D + 0 信任级别 → 失败
- 实战 4（品牌一致性）：表格格式 35 行 + 0 信任级别 → v2.2.1.2 能识别为表格格式
- **v2.5.2-dsh.5 实战（AI 内容标注）**：12 条 Dxx 描述字段有「已发布/二手转引」但无独立段 → v2.2.1.2 旧算法判失败（lucky catch），v2.5.2-dsh.5 新算法给出 P2+建议 → 模板修订后下次走通

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

**判定铁律**：M-Form-7 是 **P0 优先级**。文末混入操作员报告节 = 读者看到论衡内部代码 = 失去「论文是给读者的，报告是给主人的」边界。**T8 在 M-Form-7 exit 0 之前，禁止在签字块写「交付边界纯净」四个字**（教训 #139）。

### M-Form-8: 三角验证覆盖率检查（v2.3.7 论文三实战升级 + v2.5.2-dsh.5 按论点逐一核）

**背景**：v2.3.7 论文三实战 §四 P4 一直缺 [Lxx]（L=0 D=22 C=3），直到 T7 fallback 审计才发现（v3→v4 加了 [L06] [L12]）。**毛在才不出现**——主控「三角验证把关」职责未机制化，写手 v1 落地前没自动跑 [Lxx]+[Dxx]+[Cxx] 三维 检查。

**三角验证原理**（论衡核心机制）：任何论点必须能映射到文献卡[Lxx]+数据卡[Dxx]+案例卡[Cxx]（涉企业行为/事件者必须配案例卡）。检索不到就标缺口，严禁编造。主角控「三角验证把关」职责（2026-08-13 原创性保证增）原本是主控手动检查，v2.3.7 P1-4 升级为**写手 v1 落地前机械化自动跑**。

**伪代码**（主控 LLM 推理执行 + v2.5.2-dsh.5 起 m-gate-check.mjs 产出每论点三轨清单，写手 v1 落地前跑）：
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

# 拆初稿为按章节的段落
sections = re.split(r'^## ', draft_text, flags=re.MULTILINE)

# === v2.5.2-dsh.5 修订：每论点必含 [Lxx]（防 L=0 通过） + 至少 2 项齐全 ===
violations = []
for claim in claims:
    # 找包含该论点的章节
    section_for_claim = next((s for s in sections if claim in s), "")
    has_l = bool(re.search(r'\[L\d+\]', section_for_claim))
    has_d = bool(re.search(r'\[(?:D-?基?-?\w*-?\d+)\]', section_for_claim))
    has_c = bool(re.search(r'\[C\d+\]', section_for_claim))
    coverage = sum([has_l, has_d, has_c])
    # === 修订前：coverage < 2 即通过 → L=0 D=22 C=3 也过（v2.3.7 §四 P4 漏检根因） ===
    # === 修订后：coverage < 2 失败 + 必须含 L（has_l 单独条件） ===
    has_l_required = has_l  # 强制要求
    if coverage < 2 or not has_l_required:
        violations.append({
            "claim": claim,
            "section": section_for_claim[:50],
            "has_L": has_l,
            "has_D": has_d,
            "has_C": has_c,
            "coverage": f"{coverage}/3",
            "必含 L 缺": not has_l,
            "优先级": "P0" if not has_l else "P1"  # 必含 L 缺=P0，仅 2 项不齐全=P1
        })

if len(violations) == 0:
    return {"通过": True, "论点数": len(claims)}
else:
    p0_count = sum(1 for v in violations if v["必含 L 缺"])
    p1_count = len(violations) - p0_count
    return {"通过": False, "P0 违规（必含 L 缺）": p0_count, "P1 违规（<2 类齐全）": p1_count, "违规详情": violations,
            "失败原因": f"{p0_count} 个论点缺 [Lxx] 必含引用（L=0 通过是 v2.3.7 §四 P4 漏检根因），{p1_count} 个论点三角覆盖 < 2 类", "v2.5.2-dsh.5 修订": "每论点强制含 L（防 L=0 通过）"}
```

**v2.5.2-dsh.5 修订理由**：v2.3.7 §四 P4 实战反例暴露——L=0 D=22 C=3 → 旧算法 coverage=2/3 通过，**实际上 P4 论点完全无文献支撑**。修订 = 每论点强制含 L（has_l 必须为真）+ coverage ≥ 2 双条件 + 失败按 P0/P1 分级（必含 L 缺 = P0；<2 类齐全 = P1）。

**触发时机**：
1. **写手 v1 落地后**（v1 写手产物已落盘）→ T4 分析员或主控跑 M-Form-8 预检 → 不通过 → 打回 v2 重写（计入修订轮）
2. **T7 审计员**跑最终审计时也跑 M-Form-8 → 不通过 → 打回（计入修订轮）

**实战背景**（v2.3.7 论文三）：§四 P4 [论点4] 一直缺 [Lxx]（L=0 D=22 C=3）直到 T7 fallback 审计才发现 → v3→v4 加了 [L06] [L12] 修补 → 浪费 1 轮修订。v2.3.7 升级后 M-Form-8 在 v1 落地时拦截，不再依赖 T7 兜底。

**人类验证示例**（可选）：

---

## M-Exist 存在性合规门（3 项，含 v2.2.1.2 + v2.2.4 升级算法）

### M-Exist-1: 文末四节双向 对比（v2.2.1.2 + v2.2.4 升级版 + v2.5.2-dsh.5 严重度评级）

**v2.2.0 算法**（**有 bug**）：提取 严格匹配 4 个标准文末节 → 对「## 附」段误判。

**v2.2.1.2 升级算法**（教训 #82）+ **v2.2.4 内联引用 + 补检索回填分支**：

```
算法步骤：
1. 判断引用格式：读 01-任务简报.md「引用格式」字段
   - 「内联（机构，年份）」或「公众号/商业评论/行业分析」 → 走内联模式分支（v2.2.4）
   - 「[Lxx]/[Dxx] 编号」或「期刊/学术」 → 走标准 对比（v2.2.1.2）

2A. 标准模式（v2.2.1.2）：
   ① 提取正文 [Dxx]/[Cxx]/[Lxx]/[先xx]（不在文末任意节内）→ set_intext
   ② 提取文末任意节（标准 ## 数据来源 + ## 案例来源 + ## 参考文献 + ## 先行者文献 + 非标准 ## 附 等 + 文末最后 1/3 段 fallback）的所有引用编号 → set_endnote
   ③ 计算双向 对比：求差集 set_intext set_endnote = 漏引；求差集 set_intext set_endnote = 孤儿
   ④ 判定：漏引空 + 孤儿空 → 通过

2B. 内联模式（v2.2.4）：
   ① 提取正文内联引用（机构，年份）：匹配 '（[^（）]*[0-9]{4}[^（）]*）' | 去重
   ② 5 项依赖编号的检查必须改为「可回溯性」检查：
      - M-Exist-1：每条内联引用能否在文末四节+证据包找到对应条目
      - G2 数据溯源：每个正文数字能否在数据卡/文献卡找到来源（防无主数据）
      - M-Exist-3：引用机构的信任级别在数据卡/案例卡有标注
      - G4-2 四节 对比：正文引用的机构/数据/案例在文末四节有对应
   ③ 判定：全部内联引用可回溯 + 所有数字有源 + 信任级别齐全 → 通过；任一不可回溯 → P1

伪代码（标准模式）：
intext = extract_intext_v2(draft_text)
endnote = extract_endnote_v2(draft_text, standard=True, non_standard=True, last_third=True)
leaked = sorted(set(intext) - set(endnote))
orphan = sorted(set(endnote) - set(intext))
return (len(leaked) == 0 and len(orphan) == 0, leaked, orphan)
```

**v2.5.2-dsh.5 脚本化 + 严重度评级**：
- 脚本化：`scripts/m-gate-check.mjs` 第 4 项「M-Exist-1 引用双向」实装（v2.5.2-dsh.5 增强版），扫描正文引用 vs 文末节引用集合，差集报告漏引 [Lxx]/[Dxx]/[Cxx]
- 严重度评级：漏引/孤儿 ≤ 3 处 → P2（可放行，由 T8 终检时主控复核）；> 3 处 → P1（必须修订）；> 10 处 → P0（重检索）
- 实测：v3 测试轮 0 漏引 0 孤儿（P2 范围内，主控复核通过）✅

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
- 实战 AI安全隐患：v2.2.1.2 标准 对比 在内联引用模式下空转 → v2.2.4 内联模式分支覆盖 24 条引用 ✅

### M-Exist-2: 证据包文件完整性 sha256（v2.2.0 原版 + v2.2.10 跨平台等价命令 + v2.2.11 能力边界修正）

```
算法步骤（v2.2.17 修订，回应 外部扫描器 v2.2.16 finding F03+F05 94%/92%）：
1. 读取 final/证据包/ 目录下所有 .md 和 .txt 文件
2. **LLM 能力边界**（v2.2.17 澄清）：主控 LLM 不能直接计算 sha256 二进制哈希 → 主控用 `read` 读全文 + 推理验证「文件非空」+ 列文件名 +修改时间。**重要：以下占位符机制是论衡默认设计，不是 bug**。
   - **DSH 例外（v2.5.2-dsh.0 反哺，教训：论艺术中的丑 sha256 占位符形同虚设）**：DSH 下主控有 `pwsh` 工具，**可直接计算 sha256 回填**，不必留占位符——`Get-FileHash -Algorithm SHA256 final\证据包\*.md` 由主控执行并写实值入「证据包指纹」段。仅在主控决定不跑 shell（严格零 exec 场景）时才降级为 `[SHA256-PENDING:HOST-VERIFY]` 占位符。
3. **生成 sha256 占位**（v2.2.17 明确占位符机制）：在 final/交付说明.md「证据包指纹」段写出（由主控 LLM 写入，纯文本占位符）：
   ```
   ## 证据包指纹（v2.2.17）

   ⚠️ 重要：以下 sha256 哈希是【待主人在 host shell 手动计算后回填】的占位符，不是 agent 计算结果。

   - 数据卡.md: `[哈希校验待主人回填]`
   - 案例卡.md: `[哈希校验待主人回填]`
   - 文献卡.md: `[哈希校验待主人回填]`
   - 先行者清单.md: `[哈希校验待主人回填]`

   主人回填（可选）：
   校验哈希 final/证据包/数据卡.md >> final/交付说明.md
   校验哈希 final/证据包/案例卡.md >> final/交付说明.md
   # ... 其他文件同上
   ```
4. **判定**（v2.2.17 三种状态全部接受）：
   - （a）占位符存在 `[哈希校验待主人回填]` → **P5 ✅ 通过**（主人未验证不阻塞交付）
   - （b）实际 sha256 已回填（主人手动计算后）→ **P5 ✅ 通过**（高信任度）
   - （c）指纹段完全缺失 → **P5 ❌ 失败**（主控未生成占位符，是真错误）
5. **人类主人补填**（v2.2.17 明示）：可选步骤，人类主人在 host shell 跑后回填 sha256 值
6. **本文档中所有 sha256 示例**（v2.2.17 立场声明）：是「跨平台命令参考」，给主人在自己机器上手动验证用——**不是 agent 执行的代码**。论衡 LLM **不执行**任何 shell 命令（不在随包脚本白名单内）。
```



**v2.2.11 能力边界澄清**（回应 外部扫描器 finding #4 98%）：
- 论衡 agent **不能** 直接计算 sha256（不在 15 项白名单内）
- 主控 LLM 能用 `read` 读全文做「文件非空/有内容」验证（**这是 LLM 推理，不是 sha256**）
- 真正 sha256 由人类主人在 host shell **手动计算后回填**到「证据包指纹」段
- 本算法的「exit code」判定仅指「所有文件能被主控 read 验证非空」，不包括 sha256 完整性验证（sha256 是人类补填项）
```

### M-Exist-3: 数据信任级别一致性 对比（v2.2.1.2 双格式升级版，教训 #84）

**v2.2.1 算法**：匹配 '\[D[0-9]+\]' final/定稿.md → **不支持表格行 [1.x] 引用**。

**v2.2.1.2 新算法**（双格式支持）：

```
算法步骤：
1. 正文引用提取：
   - 标准格式 [Dxx]：匹配 '\[D[0-9]+\]' final/定稿.md → set_intext_d
   - 表格格式 [1.x]：匹配 '\[1\.[0-9]+|\[2\.[0-9]+' final/定稿.md → set_intext_table

2. 数据卡条目提取：
   - 标准格式 [Dxx]：匹配 '^\*\*\[D[0-9]+\]' final/证据包/数据卡.md → set_card_d
   - 表格格式 [1.x]：匹配 '^\| ([0-9]+\.[0-9]+) |' final/证据包/数据卡.md → set_card_table

3. 信任级别一致性 对比：
   - 标准格式 对比：求差集/-13 set_intext_d set_card_d
   - 表格格式 对比：求差集/-13 set_intext_table set_card_table

4. 信任级别空标检查：
   - 标准格式：每条 [Dxx] 对应数据卡信任级别非空
   - 表格格式：每行 [1.x] 表格的「信任级别」列非空

5. 判定：所有 对比 空 + 信任级别全填 → 通过；任一非空 → 失败（v2.5.2-dsh.5 严重度评级：漏标 ≤2 → P2 可放行，>2 → P1）

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
1. 检查数据卡文件存在：列出 final/证据包/数据卡.md → 必须存在
2. 提取数据条目数（双格式）：
   标准 [Dxx] 计数：计数 '^\*\*\[D[0-9]+\]' final/证据包/数据卡.md
   表格 [1.x] 计数：计数 '^\| [0-9]+\.[0-9]+ \|' final/证据包/数据卡.md
   两者取并集 dedupe
3. **v2.2.10 修正**：提取任务简报子问题数据需求数
   从 01-任务简报.md 「研究问题」段读取每个子问题的「需找数据点 ≥N」
   需求总数 = Σ 子问题数据需求数
   （不再 检查 analysis/分析大纲.md，因 T4 尚未产出）
4. 数据条目数 >= 任务简报需求总数 → 数据完整 → 通过；否则 → 触发 T2 重检索
5. 信任级别完整性：M-Form-6 exit 0 → 通过；否则 → 触发 T2 补标注
6. 信任级别一致性：M-Exist-3 exit 0 → 通过；否则 → 触发 T2 补数据卡
7. **v2.2.17 修复（教训 #123）**：哈希指纹为**可选验证**——主控发占位符 `[哈希校验待主人回填]` 到 `final/交付说明.md`「证据包指纹」段，**不**作为闸门强制项。主人需手动在 host shell 跑 （检查 final/证据包/*.md）（参考 `shell 脚本`）。**该步骤不是 agent 执行的代码，是人类验证示例。**
8. **v2.2.10 新增（教训 #106）**：数据卡头部「共 N 条」声明 vs 实际 检查 计数一致性
   头部声明：匹配 '共 [0-9]+ 条' final/证据包/数据卡.md
   实际计数：步骤 2 的双格式并集 dedupe
   不一致 → 标 Failed（防 T2 未自检 + T4 人工 检查 才发现的延后问题）
9. 判定：7 项全通过 → T2.5 ✅ 派发 T4；任一失败 → T2.5 ❌ 不派发 T4
    **v2.5.2-dsh.5 严重度评级**：单子项失败 P0（信任级别缺失/数据条目不足）→ 整体闸门 P0；单子项失败 P1 → 整体 P1（可放行 + 主人签收）。**v2.5.2-dsh.5 修订**：T2.5 失败时可放行的 P1 子项必须显式记录在 01-任务简报.md「已知风险」段，主控 T8 终检时优先复核。
   **v2.3.2 删「主人签字 Phase 1」（教训 #136）**：T2.5 是纯机械化闸门，主人签字只在 Phase 0（4 选 1 同意关卡）/ Phase 2.5（大纲确认）/ Phase 5（终稿）三节点；检索完成→T4 之间**不应**打断主人（v2.3.1 实战暴露「T2/T3 完成后分别询问主人 4 选 1」的过度打断）

伪代码：
data_card = 'final/证据包/数据卡.md'
data_count = count_d_entries(data_card)
outline_count = count_data_requirements_in_brief('01-任务简报.md')  # v2.2.17 显式标注：读任务简报，不读分析大纲
data_ok = data_count >= outline_count
trust_form_ok = check_M_Form_6(data_card)
trust_exist_ok = check_M_Exist_3(data_card, 'final/定稿.md')
sha256_pending = emit_placeholder_sha256(data_card)  # v2.2.17：发占位符 [哈希校验待主人回填]，**不**作为闸门强制项
header_consistent = check_header_vs_actual_count(data_card)  # v2.2.10 新增
all_pass = data_ok and trust_form_ok and trust_exist_ok and header_consistent  # v2.3.2 删 owner_signed（主人签字不在 T2.5 闸门，教训 #136）
# v2.2.17 修复 F03 + F05：sha256 不是“必填门”，是“可选验证”（主人手动跑）
return (all_pass, fail_reasons, sha256_pending)
```

**实战反例**（教训 #106）：T2 写数据卡时凭印象在头部写「共 29 条」，实际 检查 只有 26 条，T4 靠人工 检查 才发现。本次新增步骤 9 拦截。
```

### M-Integrity-2: T7.5 完整性门（T8 审计 → T8 终检前，v2.2.1 新增 + v2.2.4 修订轮扩展）

```
算法步骤（主控 LLM 兜底执行）：
1. 检查审计报告最新版：列出 audits/审计报告-vN.md → N 取最大 → 必须存在
2. P0/P1 清单已列：检查 -E '^- \*\*P0|^- \*\*P1' audits/审计报告-vN.md → 必须有 ≥1 条
3. M 门（M-Form 8 项 + M-Exist 3 项）全部 exit 0：读 M-Gate-Report.json → 全部 true
4. 证据包 哈希指纹段存在：读 final/交付说明.md「证据包指纹」段 → 必须有 sha256 **占位符** `[哈希校验待主人回填]`（人类可选在 host shell 手动计算后回填真实哈希，占位符即视为通过——v2.2.17 改，agent 不执行 sha256，不把 sha256 作闸门强制项）
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
    **v2.5.2-dsh.5 严重度评级**：单子项失败 P0（M 门 fail / P0 缺）→ 整体 P0（不派发 T8，必须修订重审）；单子项失败 P1 → 整体 P1（可放行 + T8 复核时显式列原因）。

伪代码：
audit_latest = get_latest_audit_report('audits/')
p0_p1_listed = check_p0_p1_listed(audit_latest)
m_gate_ok = check_m_gate_all_pass('final/M-Gate-Report.json')
sha256_ok = check_evidence_sha256_placeholder('final/交付说明.md')  # v2.2.17 改：占位符 [哈希校验待主人回填] 即通过，人类可选回填
trust_ok = check_M_Exist_3(...)
isolation_ok = check_draft_vs_report_isolation('final/定稿.md', 'final/交付说明.md', 'audits/')
revision_independent = check_revision_by_independent_writer('status.md')
all_pass = audit_latest and p0_p1_listed and m_gate_ok and sha256_ok and trust_ok and isolation_ok and revision_independent  # v2.3.3 删 owner_signed（主人签字在 Phase 5，不在 T7.5 闸门，教训 #138）
return (all_pass, fail_reasons)
```

---

## 附录（按需加载，不计入主流程必读）

以下 4 段（输出格式 / 论衡哲学化 / 教训沉淀 / 历史版本）已抽出到独立文档，按需加载：

- **M-Gate-Report v2.2.4 输出格式**（JSON schema）：[`references/_shared/M-Gate-Algorithm-appendix.md §1`](M-Gate-Algorithm-appendix.md#1-m-gate-report-v224-输出格式4-版本合并最终版)
- **论衡哲学化**（4 版本合并）：[`references/_shared/M-Gate-Algorithm-appendix.md §2`](M-Gate-Algorithm-appendix.md#2-论衡哲学化4-版本合并)
- **教训沉淀（v2.2.0 ~ v2.2.4）**：[`references/_shared/M-Gate-Algorithm-appendix.md §3`](M-Gate-Algorithm-appendix.md#3-教训沉淀v220--v224-全部)
- **历史版本归档（v2.2.8 Phase D-1）**：**主流程只读本完整版**；历史版本演进见 git log。

> **拆分理由（v2.5.2）**：主文件从 780 行降至 635 行（-19%），超 PERF-SIZE-004 800 行临界 145 行的缓冲。附录按需加载，主流程只读「13 个 M门规则 + 触发条件 + 伪代码」。
