# M 门算法规约 v2.2.1.2（增量更新，教训 #79 + #82 + #83 + #84）

> **背景**：v2.2.1.1 实战 4 + 实战 5 暴露 3 个算法 bug + 1 个数据卡格式短板：
> - **教训 #79**：v2.2.0 M-Form-3 算法误判「合规内联引用」为「残留」→ 算法升级为 comm -13 diff
> - **教训 #82**：v2.2.0 M-Exist-1 算法对「非标准文末节」（## 附）误判 → 算法升级支持 ## 附 等多种文末节
> - **教训 #83**：v2.2.1 P0-C 在「表格格式数据卡」落地需要数据卡-template.md 加表格 fallback 段
> - **教训 #84**：v2.2.1 P0-C 必须支持「[Dxx] 编号 + 1.x 表格」两种数据卡格式
> 
> **解法**：本规约在 v2.2.1 M 门基础上**升级 4 个算法**（M-Form-3 + M-Exist-1 + M-Form-6 + M-Exist-3），由 LLM 兜底执行。
> **设计哲学**：**沿用 v2.2.0 + v2.2.1 M 门哲学**——不引入 Python 脚本，主控用 `read` + `write` 工具按本规约伪代码推理执行；**实战反馈驱动升级**。
> **实战反馈来源**：v2.2.1 实战 5（教师场域孤岛）+ 实战 4（品牌一致性-发布稿）。

## 目录

- [与 v2.2.1 的关系](#与-v221-的关系)
- [执行前置（同 v2.2.1，Phase 0 主控必读）](#执行前置同-v221phase-0-主控必读)
- [升级 1：M-Form-3 算法升级（教训 #79）](#升级-1m-form-3-算法升级教训-79)
- [升级 2：M-Exist-1 算法升级（教训 #82）](#升级-2m-exist-1-算法升级教训-82)
- [升级 3：M-Form-6 算法升级（双格式支持，教训 #83 + #84）](#升级-3m-form-6-算法升级双格式支持教训-83-84)
- [升级 4：M-Exist-3 算法升级（双格式支持，教训 #84）](#升级-4m-exist-3-算法升级双格式支持教训-84)
- [M-Gate-Report-v2.2.1.2 输出格式](#m-gate-report-v2212-输出格式)
- [论衡哲学化（v2.2.1.2 SOP 标注）](#论衡哲学化v2212-sop-标注)
- [教训沉淀](#教训沉淀)
- [与论衡 v2.2.1.2 数据卡-template.md 配套](#与论衡-v2212-数据卡-templatemd-配套)

---

## 与 v2.2.1 的关系

| 项 | v2.2.1 | v2.2.1.2 |
|---|--------|--------|
| M-Form 形式合规门 | 6 项（M-Form-1~6）| 6 项（**M-Form-3 算法升级**）|
| M-Exist 存在性合规门 | 3 项（M-Exist-1/2/3）| 3 项（**M-Exist-1 算法升级 + M-Exist-3 双格式支持**）|
| M-Form-6 信任级别 | 单格式（[Dxx]）| **双格式（[Dxx] + 1.x 表格）** |
| M-Integrity 阶段闸门 | 2 项 | 2 项（不变）|
| 数据卡 template | 标准格式段 | **+ 表格 fallback 段（教训 #83）**|

**v2.2.1 M 门仍有效**——本规约不替换 v2.2.1，**只升级 4 个算法 + 加 1 个 template 段**。

---

## 执行前置（同 v2.2.1，Phase 0 主控必读）

主控 T7 终检前必须：

1. ✅ **同时读取 v2.2.0 + v2.2.1 + 本规约**（用 `read` 工具读 `M-Gate-Algorithm-v2.2.0.md` + `M-Gate-Algorithm-v2.2.1.md` + `M-Gate-Algorithm-v2.2.1.2.md`）
2. ✅ **读取 final/定稿.md + final/证据包/所有文件**
3. ✅ **依次执行 M-Form 6 项 + M-Exist 3 项 + M-Integrity 2 项**（按本规约伪代码推理）
4. ✅ **产出 M-Gate-Report-v2.2.1.2.json**
5. ✅ **判定 exit code 0 才允许 T7 返回**

---

## 升级 1：M-Form-3 算法升级（教训 #79）

**v2.2.0 + v2.2.1 算法**（**有 bug**）：简单 grep 段落中 [L/D/Cxx] → 误判合规内联引用为「残留」

**v2.2.1.2 新算法**：

```
算法步骤：
1. 提取正文段落中所有 [Lxx] / [Dxx] / [Cxx]（不在文末四节内）：
   awk '
     /^## 数据来源/ { in_endnote=1 }
     /^## 案例来源/ { in_endnote=1 }
     /^## 参考文献/ { in_endnote=1 }
     /^## 先行者文献/ { in_endnote=1 }
     /^## 附/ { in_endnote=1 }  # v2.2.1.2 新增：兼容 ## 附 段
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

3. 计算真正残留：
   comm -13 set_intext set_endnote = 真正残留（正文有但文末无）

4. 判定：真正残留空 → 通过；非空 → 失败

伪代码：
intext = sorted(set(re.findall(r'\[(L|D|C)\d+\]', extract_body(draft_text))))
endnote = sorted(set(re.findall(r'\[(L|D|C)\d+\]', extract_endnote(draft_text))))
orphan = sorted(set(intext) - set(endnote))  # 真正残留
return (len(orphan) == 0, orphan)
```

**实战验证**：
- 实战 5（教师场域孤岛）：v2.2.0 算法 38 条命中（误判）→ v2.2.1.2 算法 0 命中（合规内联引用）✅ 通过
- 实战 4（品牌一致性）：v2.2.0 算法 14 条命中（误判）→ v2.2.1.2 算法 0 命中（合规内联引用）✅ 通过

---

## 升级 2：M-Exist-1 算法升级（教训 #82）

**v2.2.0 + v2.2.1 算法**（**有 bug**）：awk 严格匹配 ## 数据来源 / ## 案例来源 / ## 参考文献 / ## 先行者文献 4 个标准节 → 对「## 附」段等非标准文末节误判

**v2.2.1.2 新算法**：

```
算法步骤：
1. 提取正文段落中所有 [Dxx] / [Cxx] / [Lxx] / [先xx] → set_intext（用升级 1 的 awk 排除所有 ## 节）

2. 提取文末**任意节**的所有 [Dxx] / [Cxx] / [Lxx] / [先xx]：
   - 优先级 1: ## 数据来源 + ## 案例来源 + ## 参考文献 + ## 先行者文献（标准 v2.1.4 格式）
   - 优先级 2: ## 附 / ## 参考文献与数据卡 / ## 附录 等（非标准 v2.1.4 之前格式）
   - 优先级 3: 文末最后 1/3 段（fallback，v2.2.1.2 新增）

3. 计算双向 diff：
   - comm -23 set_intext set_endnote = 漏引（正文有但文末无）→ P1
   - comm -13 set_intext set_endnote = 孤儿（文末有但正文无）→ P1

4. 判定：漏引空 + 孤儿空 → 通过；任一非空 → 失败

伪代码：
intext = extract_intext(draft_text)
endnote = extract_endnote_v2(draft_text, standard=True, non_standard=True, last_third=True)
leaked = sorted(set(intext) - set(endnote))
orphan = sorted(set(endnote) - set(intext))
return (len(leaked) == 0 and len(orphan) == 0, leaked, orphan)
```

**实战验证**：
- 实战 4（品牌一致性-发布稿）：v2.2.0 算法误判 14 条漏引 → v2.2.1.2 算法 0 漏引 0 孤儿（## 附 段被识别）✅ 通过

---

## 升级 3：M-Form-6 算法升级（双格式支持，教训 #83 + #84）

**v2.2.1 算法**：grep `^\*\*\[D[0-9]+` + grep `信任级别：` → **不支持表格格式**

**v2.2.1.2 新算法**（双格式支持）：

```
算法步骤：
1. **标准格式检查**（[Dxx] 编号）：
   提取数据条目首行：grep -oE '^\*\*\[D[0-9]+\]' final/证据包/数据卡.md | sort -u > /tmp/d_entries.txt
   提取信任级别标注：grep -c '信任级别：(已发布|主人投喂|二手转引)' final/证据包/数据卡.md > /tmp/d_trust.txt
   比较：len(标准条目) == len(信任级别标注)？

2. **表格 fallback 检查**（1.x 表格格式）：
   提取表格行：grep -cE '^\| [0-9]+\.[0-9]+ \|' final/证据包/数据卡.md > /tmp/d_table.txt
   提取表格信任级别字段：grep -cE '\|\s*(已发布|主人投喂|二手转引)\s*\|' final/证据包/数据卡.md > /tmp/d_table_trust.txt
   比较：len(表格行) == len(表格信任级别字段)？

3. **混合格式检查**：
   - [Dxx] 编号 + 1.x 表格 + 行内引用 三种混用时，每种都需覆盖
   - 数据卡总条数 = 标准格式条数 + 表格格式条数（去重）

4. 判定：
   - 标准格式：条数相等 → 通过；不等 → 失败
   - 表格 fallback：条数相等 → 通过；不等 → 失败
   - 报告：「数据卡 X 条 / 标准格式 Y 条 / 表格格式 Z 条 / 信任级别完整 W 条 / 缺标 V 条」

伪代码：
d_entries_std = re.findall(r'^\*\*\[D\d+\]', data_card_text)  # 标准格式
d_entries_table = re.findall(r'^\| \d+\.\d+ \|', data_card_text)  # 表格格式
trust_std = re.findall(r'信任级别：(已发布|主人投喂|二手转引)', data_card_text)  # 标准信任级别
trust_table = re.findall(r'\|\s*(已发布|主人投喂|二手转引)\s*\|', data_card_text)  # 表格信任级别
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
- 实战 4（品牌一致性）：表格格式 35 行 + 0 信任级别 → 失败（原样，跟 v2.2.1 一致，但 v2.2.1.2 算法能识别为表格格式）

---

## 升级 4：M-Exist-3 算法升级（双格式支持，教训 #84）

**v2.2.1 算法**：grep -oE '\[D[0-9]+\]' final/定稿.md → **不支持表格行 [1.x] 引用**

**v2.2.1.2 新算法**（双格式支持）：

```
算法步骤：
1. **正文引用提取**：
   - 标准格式 [Dxx]：grep -oE '\[D[0-9]+\]' final/定稿.md → set_intext_d
   - 表格格式 [1.x]：grep -oE '\[1\.[0-9]+|\[2\.[0-9]+' final/定稿.md → set_intext_table

2. **数据卡条目提取**：
   - 标准格式 [Dxx] 数据条目：grep -oE '^\*\*\[D[0-9]+\]' final/证据包/数据卡.md → set_card_d
   - 表格格式 [1.x] 行：grep -oE '^\| ([0-9]+\.[0-9]+) |' final/证据包/数据卡.md → set_card_table

3. **信任级别一致性 diff**：
   - 标准格式 diff：comm -23 set_intext_d set_card_d / comm -13 set_intext_d set_card_d
   - 表格格式 diff：comm -23 set_intext_table set_card_table / comm -13 set_intext_table set_card_table

4. **信任级别空标检查**：
   - 标准格式：每条 [Dxx] 对应的数据卡信任级别 = 已发布/主人投喂/二手转引（非空）
   - 表格格式：每行 [1.x] 表格的「信任级别」列 = 已发布/主人投喂/二手转引（非空）

5. 判定：所有 diff 空 + 信任级别全填 → 通过；任一非空 → 失败

伪代码：
intext_d = sorted(set(re.findall(r'\[D\d+\]', draft_text)))
intext_table = sorted(set(re.findall(r'\[\d+\.\d+\]', draft_text)))
card_d = sorted(set(re.findall(r'^\*\*\[D\d+\]', data_card_text, re.MULTILINE)))
card_table = sorted(set(re.findall(r'^\| (\d+\.\d+) \|', data_card_text, re.MULTILINE)))
trust_d = extract_trust_dict_standard(data_card_text)
trust_table = extract_trust_dict_table(data_card_text)
leaked = {'d': [], 'table': []}
orphan = {'d': [], 'table': []}
missing_trust = {'d': [], 'table': []}
leaked['d'] = sorted(set(intext_d) - set(card_d))
orphan['d'] = sorted(set(card_d) - set(intext_d))
missing_trust['d'] = [d for d in intext_d if d not in trust_d or trust_d[d] == '']
leaked['table'] = sorted(set(intext_table) - set(card_table))
orphan['table'] = sorted(set(card_table) - set(intext_table))
missing_trust['table'] = [t for t in intext_table if t not in trust_table or trust_table[t] == '']
all_pass = all(len(v) == 0 for v in leaked.values() + orphan.values() + missing_trust.values())
return (all_pass, leaked, orphan, missing_trust)
```

---

## M-Gate-Report-v2.2.1.2 输出格式

主控 T7 执行 M 门 v2.2.1.2 后，必须产出 `final/M-Gate-Report-v2.2.1.2.json`：

```json
{
  "项目": "<项目名>",
  "执行时间": "<ISO-8601>",
  "执行者": "论衡主控 T7 (LLM 兜底执行)",
  "M门执行版本": "v2.2.1.2",
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
    "文末四节分布": {"数据来源": 0, "案例来源": 0, "参考文献": 0, "先行者文献": 0, "总计": 0},
    "M-Exist-1_双向diff_v2.2.1.2升级": {
      "v2.2.0算法_误判漏引数": 0,
      "v2.2.1.2算法_真正漏引数": 0,
      "v2.2.1.2算法_真正孤儿数": 0,
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
    "M-Integrity-1_T2.5": {"通过": true | false},
    "M-Integrity-2_T5.5": {"通过": true | false},
    "全部通过": true | false
  },
  "判定": "✅ 通过" | "❌ 失败",
  "退出码": 0 | 1
}
```

---

## 论衡哲学化（v2.2.1.2 SOP 标注）

- **「**M 门算法的实战有效 = 论衡哲学最纯粹的版本（M 门零 exec 依赖）的实战验证**」** —— v2.2.1.2 是 v2.2.0/v2.2.1 算法 bug 的实战修正
- **「**实战反馈驱动升级**」** —— v2.2.1.2 不是规划出来的，是实战 4 + 实战 5 反馈暴露出来的
- **「**数据卡格式不只是「字段格式」**」** —— v2.2.1.2 P0-C 双格式支持 = 论衡防御体系的「全格式兼容」

---

## 教训沉淀

- **教训 #79**：v2.2.0 M-Form-3 算法 bug → v2.2.1.2 升级 comm -13 diff
- **教训 #82**：v2.2.0 M-Exist-1 算法对「## 附」段误判 → v2.2.1.2 升级支持多种文末节
- **教训 #83**：v2.2.1 P0-C 在「表格格式数据卡」落地短板 → v2.2.1.2 数据卡-template.md 加表格 fallback 段
- **教训 #84**：v2.2.1 P0-C 必须支持「[Dxx] 编号 + 1.x 表格」双格式 → v2.2.1.2 M-Form-6 + M-Exist-3 双格式支持

**v2.2.1.2 总教训**：**M 门算法必须在实战中持续验证** —— 4 个算法 bug 都是实战反馈暴露的，不是组件测试发现的。

---

## 与论衡 v2.2.1.2 数据卡-template.md 配套

本规约 M-Form-6 + M-Exist-3 升级需要数据卡-template.md 加表格 fallback 段（v2.2.1.2 同步升级）：

详见 `pipeline/templates/数据卡-template.md` v2.2.1.2 段：
- 标准格式段：「**[Dxx]** ... 信任级别：已发布/主人投喂/二手转引」（v2.2.1 已有）
- **表格 fallback 段**（v2.2.1.2 新增）：表格行 + 「信任级别」列（已发布/主人投喂/二手转引）