# M 门算法规约（v2.2.0 新增，教训 #65 — 论衡 agent 无 exec 工具）

> **背景**：论衡 agent 的 15 项白名单不含 `exec`，M 门脚本（m_exist_1_diff.sh）无法由主控 agent 自动执行。
> **解法**：本规约用「**LLM 可直接执行的伪代码 + 算法步骤**」描述 M 门，主控用 `read` 工具读 final/定稿.md + final/证据包/，再按本规约的步骤推理得出判定结果。
> **设计哲学**：**不引入新代码风险**——M 门由 LLM 推理执行，算法规约 100% 由论衡主控可读懂的伪代码构成。
> **借鉴出处**：vincentjiang06 paper-writer objective/verify gate 硬约束理念 + ARS M1-M7 失败模式组织。

## 执行前置（Phase 0 主控必读，教训 #51 同意关卡金标准）

**主控 T7 终检前必须**：

1. ✅ **读取本规约全文**（用 `read` 工具读 `references/_shared/M-Gate-Algorithm-v2.2.0.md`）
2. ✅ **读取 final/定稿.md + final/证据包/所有文件**（用 `read` 工具）
3. ✅ **依次执行 M-Form 5 项 + M-Exist 2 项**（按本规约伪代码推理）
4. ✅ **产出 M-Gate-Report.json**（用 `write` 工具写入 `final/M-Gate-Report-v2.2.0.json`）
5. ✅ **判定 exit code 0 才允许 T7 返回**，否则触发 T4 修订或主控补检索

**Phase 0 同意关卡**：本算法不调用任何外部服务（纯 LLM 推理 + 文件 I/O），无需主人额外同意。但**实战验证时如需 m_exist_1_diff.sh（shell 版）跑 dry-run**，需要主人明示同意（教训 #51 金标准）—— 因为 dry-run 跑 shell 命令 = 论衡 agent 主控直接调用 = 触发 exec 工具 = 当前白名单 deny。**实战 dry-run 建议**：主控自己手跑（bash 不在 exec 白名单里 —— 实际是 bash 用绝对路径 `/bin/bash` 由主控 host shell 跑，非论衡 agent 内部 exec）。

---

## M-Form 形式合规门（5 项）

### M-Form-1: 引用标注完整性

```
算法步骤：
1. 读取 final/定稿.md 全文
2. 用正则 r'\[(?:D|C|C-主|L|先)\d+\]' 提取所有匹配
3. 去重（set）+ 排序（sorted）
4. 判定：len(提取结果) > 0 → 通过；否则 → 失败

伪代码：
refs = re.findall(r'\[(?:D|C|C-主|L|先)\d+\]', draft_text)
unique_refs = sorted(set(refs))
return len(unique_refs) > 0
```

### M-Form-2: 文末四节存在性

```
算法步骤：
1. 检查 final/定稿.md 是否同时包含以下 4 个二级标题：
   - "## 数据来源"
   - "## 案例来源"
   - "## 参考文献"
   - "## 先行者文献"
2. 判定：4 个都存在 → 通过；任一缺失 → 失败（缺哪个写哪个）

伪代码：
required = ['## 数据来源', '## 案例来源', '## 参考文献', '## 先行者文献']
missing = [r for r in required if r not in draft_text]
return (len(missing) == 0, missing)
```

### M-Form-3: 临时编号残留

```
算法步骤：
1. 检查 final/定稿.md 是否含 [Lxx] / [Dxx] / [Cxx] / [图N：xxx] 等「临时编号标注」
2. 判定：无命中 → 通过；有命中 → 失败（说明交付物含过程阶段编号，未转内联）

注意：此处 [Lxx] [Dxx] [Cxx] 是「未清理」的临时编号（即出现在最终读者看到的段落里），
区别于「文末四节清单」中的 [L01] [D01] [C01] 等正式引用编号。
M-Form-1 查的是「所有引用编号」；M-Form-3 查的是「正文段落中残留的临时编号」。
```

### M-Form-4: 角色元数据泄露

```
算法步骤：
1. 检查 final/定稿.md 是否含以下元数据泄露词：
   - "T1" / "T2" / ... / "T7"（角色编号）
   - "交接报告" / "六要素"
   - "论衡主控" / "子代理"
   - "反哺报告" / "角色卡"
2. 判定：无命中 → 通过；有命中 → 失败（P0 致命：交付物泄露论衡内部架构）

注意：M-Form-4 是 P0 优先级，因为角色元数据泄露 = 读者看到论衡内部代码 = 失去学术严肃性。
```

### M-Form-5: 过程语言残留

```
算法步骤：
1. 检查 final/定稿.md 是否含以下过程语言：
   - "v[0-9] 稿"（如 v1 稿、v2 稿）
   - "初稿" / "草稿"
   - "修订说明" / "上一版" / "下一版"
   - "据行业经验估算"
2. 判定：无命中 → 通过；有命中 → 失败

注意："据行业经验估算" 是论衡 v2.1.1 引入的「合法估算标记」，出现在正文段落中属于"合规使用"。
但出现在「读者能看到的过程语言位置」属于残留。判定逻辑：
- 如果段落开头标 [行业估算，非数据卡] → 属于 G6 论据类型自标（合法）
- 如果无标记直接用 → 属于 P1 残留（需 G0.5 视角一致性自查 + M-Form-5 检查）
```

---

## M-Exist 存在性合规门（2 项）

### M-Exist-1: 文末四节双向 diff

```
算法步骤：
1. 从 final/定稿.md 提取正文所有引用编号（intext_refs）
   - 正则：r'\[(?:D|C|C-主|L|先)\d+\]'
   - 去重 + 排序
2. 从 final/定稿.md 提取文末四节各自引用编号
   - 数据来源节：'## 数据来源' 到 '## 案例来源' 之间，r'\[D\d+\]'
   - 案例来源节：'## 案例来源' 到 '## 参考文献' 之间，r'\[C\d+\]|\[C-主\d+\]'
   - 参考文献节：'## 参考文献' 到 '## 先行者文献'（或文末）之间，r'\[L\d+\]'
   - 先行者文献节：'## 先行者文献' 之后到文末，r'\[先\d+\]'
3. 合并文末四节 = all_refs（去重 + 排序）
4. 计算双向 diff：
   - 漏引 = intext_refs - all_refs（正文有但文末无）→ P1 必补
   - 孤儿 = all_refs - intext_refs（文末有但正文未引用）→ P1 必删
5. 判定：漏引空 + 孤儿空 → 通过；任一非空 → 失败

伪代码：
intext = extract_intext_refs(draft_text)
data_sec = extract_section_refs(draft_text, '## 数据来源', '## 案例来源', r'\[D\d+\]')
case_sec = extract_section_refs(draft_text, '## 案例来源', '## 参考文献', r'\[C\d+\]|\[C-主\d+\]')
lit_sec  = extract_section_refs(draft_text, '## 参考文献', '## 先行者文献', r'\[L\d+\]')
xian_sec = extract_section_refs(draft_text, '## 先行者文献', '__END__', r'\[先\d+\]')
all_refs = sorted(set(data_sec + case_sec + lit_sec + xian_sec))
leaked = sorted(set(intext) - set(all_refs))
orphan = sorted(set(all_refs) - set(intext))
return (len(leaked) == 0 and len(orphan) == 0, leaked, orphan)
```

### M-Exist-2: 证据包文件完整性 sha256

```
算法步骤：
1. 读取 final/证据包/ 目录下所有 .md 和 .txt 文件
2. 对每个文件计算 sha256（用 LLM 模拟：读全文 + hashlib.sha256）
3. 输出字典 {文件名: sha256}
4. 写入 final/交付说明.md 的「证据包指纹」段
5. 判定：所有文件都能计算 sha256（非空）→ 通过；否则 → 失败

注意：LLM 实际无法直接计算 sha256 哈希（需要 binary 计算），但可以：
- 验证文件非空
- 列出文件名 + 文件大小 + 修改时间
- 标 "sha256 待主控 host shell 计算" 占位，由主控 T7 收尾时手动 `sha256sum final/证据包/*.md >> 交付说明.md`

实践做法：M-Exist-2 输出 "文件清单 + 大小 + sha256(待补)"，由 T7 在实战时调用宿主 shell 计算。
```

---

## M-Gate-Report 输出格式（v2.2.0 标准化）

主控 T7 执行 M 门后，必须产出 `final/M-Gate-Report-v2.2.0.json`：

```json
{
  "项目": "<项目名>",
  "执行时间": "<ISO-8601>",
  "执行者": "论衡主控 T7 (LLM 兜底执行)",
  "M-Form_形式合规": {
    "M-Form-1_引用标注完整性": true | false,
    "M-Form-2_文末四节存在性": true | false,
    "M-Form-3_临时编号残留": true | false,
    "M-Form-4_角色元数据泄露": true | false,
    "M-Form-5_过程语言残留": true | false,
    "全部通过": true | false
  },
  "M-Exist_存在性合规": {
    "正文引用编号数": 0,
    "文末四节分布": {
      "数据来源": 0,
      "案例来源": 0,
      "参考文献": 0,
      "先行者文献": 0
    },
    "漏引": [],
    "孤儿": [],
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
  "下一步": "T7 返回" | "触发 T4 修订" | "触发主控补检索"
}
```

---

## 论衡哲学化（v2.2.0 SOP 标注）

- **「**M 门是论衡的「返璞归真」** —— 不引入 Python 脚本，不扩大 exec 白名单，由 LLM 推理执行机械化校验」**
- **「**形式合规 ≠ 存在性合规**」** —— vincentjiang06 核心洞察的论衡化表述
- **「**M 门由 LLM 兜底** —— 主控用 read 工具读本规约 + final/ 文件，按伪代码推理**」** —— **v2.2.0 是论衡哲学最纯粹的版本**

---

## 教训 #65: v2.2.0 改造审计发现的「设计自检缺失」教训

v2.2.0 升级时只跑了 m_exist_1_diff.sh dry-run（脚本本身能跑），**没核验主控能不能调用这个脚本**——这是「**只测了组件没测集成**」的典型错误。

**论衡哲学化**：「**集成测试 > 组件测试。组件能跑 ≠ 系统能用**」—— 论衡主人口吻

**修复路径**：本规约 = LLM 兜底执行 + 零 exec 依赖 + 实战验证（M-Gate-Report.json 实战生成）
