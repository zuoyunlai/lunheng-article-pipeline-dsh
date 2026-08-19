# M 门算法规约（论衡当前主流程完整版，v2.2.8 Phase D-1 合并）

> **v2.2.8 Phase D-1 重大变更**：本规约从「**4 个增量版本并存**」（v2.2.0/v2.2.1/v2.2.1.2/v2.2.4 共 15.4K tokens）合并为「**1 个完整版**」（本文件约 8.3K tokens，主流程只读这一份）。
>
> 完整版包含 v2.2.0 基础 + v2.2.1 扩展（M-Form-6 + M-Exist-3 + M-Integrity-1/2）+ v2.2.1.2 算法升级（M-Form-3 + M-Exist-1 + M-Form-6 + M-Exist-3 双格式）+ v2.2.4 内联引用 + 补检索回填 + 修订轮流程约束。**历史版本已归档到 `_shared/archive/M-Gate-Algorithm-legacy/`（v2.2.0/v2.2.1/v2.2.1.2/v2.2.4 共 4 份，仅做版本演进参考，不需主流程读取）**。
>
> **执行前置**：「同时读取 4 个版本」改为「**读取本完整版**」。节省 ~10K tokens 主流程加载。

---

## 背景（v2.2.0 原版）

OpenClaw 时代论衡的 15 项工具白名单不含 `exec`，M 门 shell 脚本无法由主控 agent 自动执行；DSH 下同理，M 门判定不依赖任何 shell 命令。

**解法**：本规约用「**LLM 可直接执行的伪代码 + 算法步骤**」描述 M 门，主控用 `read` 工具读 final/定稿.md + final/证据包/，再按本规约的步骤推理得出判定结果。

**设计哲学**：**不引入新代码风险**——M 门由 LLM 推理执行，算法规约 100% 由论衡主控可读懂的伪代码构成。

**借鉴出处**：vincentjiang06 paper-writer objective/verify gate 硬约束理念 + ARS M1-M7 失败模式组织。

**v2.2.1 扩展**（教训 #77）：数据信任级别 + 阶段闸门 — vincentjiang06 paper-writer Trust Boundary + ARS Stage 2.5/4.5 论衡化。

**v2.2.1.2 升级**（教训 #79 + #82 + #83 + #84）：4 个算法 bug 实战修正 + 数据卡双格式支持。

**v2.2.4 升级**（AI安全隐患实战 + 深度长文定位）：内联引用模式分支 + 补检索回填校验 + 修订轮流程约束。

---

## 执行前置（v2.2.0 → v2.2.4 合并版）

**主控 T7 终检前必须**：

0. ✅ **确认引用模式**：先读 `01-任务简报.md` 的「引用模式」字段——**内联（机构，年份）**（公众号/商业评论）走 v2.2.4 内联分支（可回溯性检查，不强制编号>0）；**编号 [Lxx]/[Dxx]**（期刊/学术）走标准分支。模式决定 M-Form-1/M-Exist-1 的算法。
1. ✅ **读取本规约全文**（用 `read` 工具读 `M-Gate-Algorithm.md`，**不再需要读 4 个历史版本**）
2. ✅ **读取 final/定稿.md + final/证据包/所有文件**（用 `read` 工具）
3. ✅ **依次执行 M-Form 6 项 + M-Exist 3 项 + M-Integrity 2 项**（按本规约伪代码推理，含 v2.2.1.2/v2.2.4 升级算法）
4. ✅ **产出 M-Gate-Report-v2.2.4.json**（用 `write` 工具写入）
5. ✅ **判定 exit code 0 才允许 T7 返回**，否则触发 T4 修订或主控补检索

**Phase 0 同意关卡**：本算法不调用任何外部服务（纯 LLM 推理 + 文件 I/O），无需主人额外同意。主控按本规约伪代码执行即可（DSH 下无需 shell 脚本；如需机械化复核，可请主人在 host shell 用 pwsh/grep 等价命令 dry-run，教训 #51 金标准）。

---

## M-Form 形式合规门（6 项，含 v2.2.1.2 升级算法）

### M-Form-1: 引用标注完整性（v2.2.0 原版）

```
算法步骤：
1. 读取 final/定稿.md 全文
2. 用正则 r'\[(?:D|C|C-主|L|先)\d+\]' 提取所有匹配
3. 去重（set）+ 排序（sorted）
4. 判定：len(提取结果) > 0 → 通过；否则 → 失败
```

### M-Form-2: 文末四节存在性（v2.2.0 原版）

```
算法步骤：
1. 检查 final/定稿.md 是否同时包含以下 4 个二级标题：
   - "## 数据来源"
   - "## 案例来源"
   - "## 参考文献"
   - "## 先行者文献"
2. 判定：4 个都存在 → 通过；任一缺失 → 失败（缺哪个写哪个）
```

### M-Form-3: 临时编号残留（v2.2.1.2 升级版，教训 #79）

**v2.2.0 算法**（**有 bug**）：简单 grep 段落中 [L/D/Cxx] → 误判合规内联引用为「残留」。

**v2.2.1.2 新算法**：

```
算法步骤：
1. 提取正文段落中所有 [Lxx] / [Dxx] / [Cxx]（不在文末四节内）：
   awk '
     /^## 数据来源/ { in_endnote=1 }
     /^## 案例来源/ { in_endnote=1 }
     /^## 参考文献/ { in_endnote=1 }
     /^## 先行者文献/ { in_endnote=1 }
     /^## 附/ { in_endnote=1 }
     !in_endnote { print }
   ' final/定稿.md
   → 提取所有 [Lxx] / [Dxx] / [Cxx] → set_intext

2. 提取文末所有 [Lxx] / [Dxx] / [Cxx]（在 ## 数据来源 / ## 案例来源 / ## 参考文献 / ## 先行者文献 / ## 附 等任意段内）：
   awk '
     /^## 数据来源/ { in_endnote=1 }
     /^## 案例来源/ { in_endnote=1 }
     /^## 参考文献/ { in_endnote=1 }
     /^## 先行者文献/ { in_endnote=1 }
     /^## 附/ { in_endnote=1 }
     in_endnote { print }
   ' final/定稿.md
   → 提取所有 [Lxx] / [Dxx] / [Cxx] → set_endnote

3. 计算真正残留：comm -13 set_intext set_endnote = 真正残留（正文有但文末无）
4. 判定：真正残留空 → 通过；非空 → 失败

伪代码：
intext = sorted(set(re.findall(r'\[(L|D|C)\d+\]', extract_body(draft_text))))
endnote = sorted(set(re.findall(r'\[(L|D|C)\d+\]', extract_endnote(draft_text))))
orphan = sorted(set(intext) - set(endnote))  # 真正残留
return (len(orphan) == 0, orphan)
```

**实战验证**：
- 实战 5（教师场域孤岛）：v2.2.0 算法 38 条命中（误判）→ v2.2.1.2 算法 0 命中（合规内联引用）✅
- 实战 4（品牌一致性）：v2.2.0 算法 14 条命中（误判）→ v2.2.1.2 算法 0 命中 ✅

### M-Form-4: 角色元数据泄露（v2.2.0 原版）

```
算法步骤：
1. 检查 final/定稿.md 是否含以下元数据泄露词：
   - "T1" / "T2" / ... / "T7"（角色编号）
   - "交接报告" / "六要素"
   - "论衡主控" / "子代理"
   - "反哺报告" / "角色卡"
2. 判定：无命中 → 通过；有命中 → 失败（P0 致命）

注意：M-Form-4 是 P0 优先级，角色元数据泄露 = 读者看到论衡内部代码 = 失去学术严肃性。
```

### M-Form-5: 过程语言残留（v2.2.0 原版）

```
算法步骤：
1. 检查 final/定稿.md 是否含以下过程语言：
   - "v[0-9] 稿"（如 v1 稿、v2 稿）
   - "初稿" / "草稿"
   - "修订说明" / "上一版" / "下一版"
   - "据行业经验估算"
2. 判定：无命中 → 通过；有命中 → 失败

注意："据行业经验估算" 是 v2.1.1 引入的「合法估算标记」。如果段落开头标 [行业估算，非数据卡] → 属于 G6 论据类型自标（合法）；无标记直接用 → 属于 P1 残留。
```

### M-Form-6: 信任级别标注完整性（v2.2.1.2 双格式升级版，教训 #83 + #84）

**v2.2.1 算法**：仅支持标准 [Dxx] 格式。

**v2.2.1.2 新算法**（双格式支持）：

```
算法步骤：
1. 标准格式检查（[Dxx] 编号）：
   提取数据条目首行：grep -oE '^\*\*\[D[0-9]+\]' final/证据包/数据卡.md | sort -u > /tmp/d_entries.txt
   提取信任级别标注：grep -c '信任级别：(已发布|主人投喂|二手转引)' final/证据包/数据卡.md > /tmp/d_trust.txt
   比较：len(标准条目) == len(信任级别标注)？

2. 表格 fallback 检查（1.x 表格格式）：
   提取表格行：grep -cE '^\| [0-9]+\.[0-9]+ \|' final/证据包/数据卡.md > /tmp/d_table.txt
   提取表格信任级别字段：grep -cE '\|\s*(已发布|主人投喂|二手转引)\s*\|' final/证据包/数据卡.md > /tmp/d_table_trust.txt
   比较：len(表格行) == len(表格信任级别字段)？

3. 混合格式检查：[Dxx] 编号 + 1.x 表格 + 行内引用 三种混用时，每种都需覆盖

4. 判定：标准格式 + 表格 fallback 都通过 → 通过；任一失败 → 失败

伪代码：
d_entries_std = re.findall(r'^\*\*\[D\d+\]', data_card_text)
d_entries_table = re.findall(r'^\| \d+\.\d+ \|', data_card_text)
trust_std = re.findall(r'信任级别：(已发布|主人投喂|二手转引)', data_card_text)
trust_table = re.findall(r'\|\s*(已发布|主人投喂|二手转引)\s*\|', data_card_text)
return (
    len(d_entries_std) == len(trust_std) and
    len(d_entries_table) == len(trust_table),
    {
        '标准格式': {'条目': len(d_entries_std), '信任级别': len(trust_std)},
        '表格格式': {'条目': len(d_entries_table), '信任级别': len(trust_table)}
    }
)
```

**实战验证**：
- 实战 5（教师场域孤岛）：标准格式 47 条 D + 0 信任级别 → 失败（原样，跟 v2.2.1 一致）
- 实战 4（品牌一致性）：表格格式 35 行 + 0 信任级别 → v2.2.1.2 能识别为表格格式

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
   ⚠️ 文末参考文献清单包含非 L 文献（法规[S]/报告[R]/标准/数据库[DB/OL]）,
     如 GAO/EU AI Act/中国办法/OECD/Stanford HAI/AIID，等式在实战中「23==23」只是巧合。

   ① 提取文献卡中补检索新增的 L 编号（如 L18+，有「补检索」段标记）
   ② 对每个补检索 L，人工检查文末参考文献清单是否有对应条目（按作者/标题/期刊匹配）

3. 判定：每个补检索 L 都在文末清单有对应条目 → 通过；任一缺 → P1
```

**实战验证**：
- 实战 4（品牌一致性-发布稿）：v2.2.0 算法误判 14 条漏引 → v2.2.1.2 算法 0 漏引 0 孤儿（## 附 段被识别）✅
- 实战 AI安全隐患：v2.2.1.2 标准 diff 在内联引用模式下空转 → v2.2.4 内联模式分支覆盖 24 条引用 ✅

### M-Exist-2: 证据包文件完整性 sha256（v2.2.0 原版）

```
算法步骤：
1. 读取 final/证据包/ 目录下所有 .md 和 .txt 文件
2. 对每个文件计算 sha256（用 LLM 模拟：读全文 + hashlib.sha256）
3. 输出字典 {文件名: sha256}
4. 写入 final/交付说明.md 的「证据包指纹」段
5. 判定：所有文件都能计算 sha256（非空）→ 通过；否则 → 失败

注意：LLM 实际无法直接计算 sha256 哈希（需要 binary 计算），但可以验证文件非空 + 列文件名 + 大小 + 修改时间 + 标 "sha256 待主控 host shell 计算" 占位。**主控收尾时调用宿主 shell 计算并回填**：Linux/macOS 用 `sha256sum final/证据包/*.md`；Windows 用 PowerShell `Get-FileHash final\证据包\*.md -Algorithm SHA256`（M-Exist-2 输出「文件清单 + 大小 + sha256(待补→回填)」）。
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

### M-Integrity-1: T2.5 完整性门（T2 数据检索 → T3 分析前，v2.2.1 新增）

> **时序说明（v2.2.8-dsh.3 修正）**：T2.5 在 **T2 → T3 之间**执行，此时分析大纲尚未产出——**不能以大纲为数据需求的基准**。数据需求基准改为任务简报的「数据需求声明」字段（Phase 0 填写：需要哪几类/哪些口径的数据）。

```
算法步骤（主控 LLM 兜底执行）：
1. 检查数据卡文件存在：ls final/证据包/数据卡.md → 必须存在
2. 提取数据条目数：grep -c '^\[D[0-9]+\]' final/证据包/数据卡.md
3. 读取任务简报「数据需求声明」的需求类别数（T2.5 在大纲前，不能用大纲做基准）
4. 数据条目数 >= 简报数据需求类别数，且每条「与本文的关联」可对应到需求类别 → 数据完整 → 通过；否则 → 触发 T2 重检索或主控补数据
5. 信任级别完整性：M-Form-6 exit 0 → 通过；否则 → 触发 T2 补标注
6. 信任级别一致性：M-Exist-3 exit 0 → 通过；否则 → 触发 T2 补数据卡
7. 数据卡 sha256 指纹：写入 final/交付说明.md「证据包指纹」段（M-Exist-2 复用；Windows 用 `Get-FileHash -Algorithm SHA256`）
8. 主人签字 Phase 1：任务简报有 4 选 1 选项确认
9. 判定：8 项全通过 → T2.5 ✅ 派发 T3；任一失败 → T2.5 ❌ 不派发 T3

伪代码：
data_card = 'final/证据包/数据卡.md'
data_count = count_d_entries(data_card)
need_count = count_data_needs('01-任务简报.md')   # 简报「数据需求声明」类别数
data_ok = data_count >= need_count and all_entries_mapped_to_needs(data_card, need_list)
trust_form_ok = check_M_Form_6(data_card)
trust_exist_ok = check_M_Exist_3(data_card, 'final/定稿.md')
sha256_ok = write_evidence_sha256(data_card)
owner_signed = check_phase1_signature()
all_pass = data_ok and trust_form_ok and trust_exist_ok and sha256_ok and owner_signed
return (all_pass, fail_reasons)
```

### M-Integrity-2: T5.5 完整性门（T5 审计 → T7 终检前，v2.2.1 新增 + v2.2.4 修订轮扩展）

```
算法步骤（主控 LLM 兜底执行）：
1. 检查审计报告最新版：ls audits/审计报告-vN.md → N 取最大 → 必须存在
2. P0/P1 清单已列：grep -E '^- \*\*P0|^- \*\*P1' audits/审计报告-vN.md → 必须有 ≥1 条
3. M 门（M-Form 6 项 + M-Exist 3 项）全部 exit 0：读 M-Gate-Report-v2.2.4.json → 全部 true
4. 证据包 sha256 指纹完整：读 final/交付说明.md「证据包指纹」段 → 必须有 sha256 哈希
5. 信任级别一致性：M-Exist-3 exit 0 → 通过
6. 论文交付物 vs 操作员报告独立隔离：
   - final/定稿.md（论文）不含 audits/ / final/交付说明.md 内容
   - final/交付说明.md / audits/（报告）不混入 final/定稿.md
7. 主人签字 Phase 5（如有 v2.2.0 修订回环 ≤2 轮降级触发）：任务简报注明 + 主人已读局限性.md
8. **v2.2.4 修订轮流程约束**：检查本轮修订是否由独立写手子代理执行
   - 证据：status.md 修订回环记录写明「spawn 独立写手 vN 执行」
   - 若发现主控代执行 → 打回修订轮，强制 spawn 独立写手
   - 例外：主控直接 edit 定点修复（<5 处纯校对类，v2.1.3 允许）不视为违反
9. 判定：8 项全通过 → T5.5 ✅ 派发 T7；任一失败 → T5.5 ❌ 不派发 T7

伪代码：
audit_latest = get_latest_audit_report('audits/')
p0_p1_listed = check_p0_p1_listed(audit_latest)
m_gate_ok = check_m_gate_all_pass('final/M-Gate-Report-v2.2.4.json')
sha256_ok = check_evidence_sha256('final/交付说明.md')
trust_ok = check_M_Exist_3(...)
isolation_ok = check_draft_vs_report_isolation('final/定稿.md', 'final/交付说明.md', 'audits/')
owner_signed = check_phase5_signature()
revision_independent = check_revision_by_independent_writer('status.md')
all_pass = audit_latest and p0_p1_listed and m_gate_ok and sha256_ok and trust_ok and isolation_ok and owner_signed and revision_independent
return (all_pass, fail_reasons)
```

---

## M-Gate-Report v2.2.4 输出格式（4 版本合并最终版）

主控 T7 执行 M 门后，必须产出 `final/M-Gate-Report-v2.2.4.json`：

```json
{
  "schema": "M-Gate-Report-v2.2.4",
  "项目": "<项目名>",
  "执行时间": "<ISO-8601>",
  "执行者": "论衡主控 T7 (LLM 兜底执行)",
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
      "主人签字Phase1": true | false,
      "通过": true | false
    },
    "M-Integrity-2_T5.5": {
      "审计报告最新版": true | false,
      "P0P1清单已列": true | false,
      "M门全exit0": true | false,
      "论文vs报告隔离": true | false,
      "主人签字Phase5": true | false,
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
  "下一步": "T7 返回" | "触发 T4 修订" | "触发主控补检索" | "触发 T2.5 重审" | "触发 T5.5 重审"
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
- **「**补检索是源头，回填是闭环**」** —— 补检索新增文献必须同步回填文末清单，否则正文引用悬空，T7 必拦（v2.2.4）
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

- 实战 2（品牌一致性）：T2 数据检索完成后 → 直接进 T3 分析 → 信任级别缺失未拦截 → T4 写手引 14 条 [Lxx] 漏引 → 实战 2 失败 → T2.5 闸门可防
- 实战 3（教师场域 outputs/）：outputs/ 公众号版 = 论文交付物，但 run/ 含完整文末四节 = 论衡工作区版本 → 两者不一致未拦截 → T5.5 闸门可防
- 实战 4（品牌一致性-发布稿）：v2.2.0 算法误判 14 条漏引 → v2.2.1.2 算法 0 漏引 0 孤儿（## 附 段被识别）✅
- 实战 5（教师场域孤岛）：v2.2.0 算法 38 条命中（误判）→ v2.2.1.2 算法 0 命中（合规内联引用）✅
- 实战 AI安全隐患：v2.2.1.2 标准 diff 在内联引用模式下空转 → v2.2.4 内联模式分支覆盖 24 条引用 ✅

---

## 历史版本归档（v2.2.8 Phase D-1 合并后）

- `M-Gate-Algorithm-v2.2.0.md`（基础版 3.1K tokens）
- `M-Gate-Algorithm-v2.2.1.md`（增量版 5.0K tokens）
- `M-Gate-Algorithm-v2.2.1.2.md`（算法升级版 5.0K tokens）

3 文件已归档到 `_shared/archive/M-Gate-Algorithm-legacy/`（README 已说明）。**主流程只读本完整版**，归档版仅做版本演进参考。