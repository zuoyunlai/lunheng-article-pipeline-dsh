> 版本：v17.0.0（DSH 原生插件，尚未发布）


# 多格式导出（v2.5.0 新增，可选，默认 md）

> **原则**：主人不选就不加载导出逻辑，尽可能节省 token。
> **默认**：Phase 5 终稿输出 Markdown（当前行为，零额外 token）。
> **触发**：主人在 Phase 0 定题时或 Phase 5 终稿时选 `--format md/latex/docx/pdf`。

## 一、format 参数

| 参数 | 输出格式 | 适用场景 | 主人操作 |
|------|---------|---------|---------|
| `--format md`（默认） | Markdown | 公众号 / 知乎 / 商业评论 / 通用 | 无需操作 |
| `--format latex` | LaTeX 学术模板 | 学术论文投稿（LaTeX 排版） | 主人选 + pandoc + LaTeX 引擎 |
| `--format docx` | Word 学术模板 | 学术论文投稿（Word 排版） | 主人选 + pandoc |
| `--format pdf` | Markdown → PDF（含 SVG 图表嵌入） | 终稿存档 / 打印 | 主人选 + pandoc + LaTeX 引擎 |

## 二、导出命令（pandoc 模板）

### `--format md`（默认）
无需额外命令，直接输出 `final/定稿.md`（当前行为）。

### `--format latex`

### `--format docx`

### `--format pdf`

## 三、SVG 图表嵌入（PDF 关键）

`--format pdf` 必须处理 SVG 图表嵌入，否则图表丢失或变占位框：


> **零外发原则**：SVG 转 PDF 用 rsvg-convert（本地工具，零外发），pandoc 本地跑。

### 三-b、无 pandoc/LaTeX 环境降级路径（v2.5.2-dsh 补丁，教训：善行实战本机无 pandoc/rsvg-convert/LaTeX）

当主机未装 pandoc + LaTeX 引擎时，用零安装替代：**`scripts/md2html.mjs`（Markdown→HTML + 内嵌 SVG + 中文打印 CSS）→ Chrome/Edge headless `--print-to-pdf`**。

```sh
# 多图（推荐，v2.5.2-dsh.16）：按图号自动配 final/图件/图N_标题.svg
node scripts/md2html.mjs <定稿.md> <定稿.html> --fig-dir final/图件
# 单图（向后兼容）：同一份 SVG 会嵌入每一个 [图N]，脚本会显式告警；多图请改用 --fig-dir
node scripts/md2html.mjs <定稿.md> <定稿.html> <SVG 文件路径>
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu --user-data-dir="%TEMP%\chrome-pdf-profile" --print-to-pdf="<定稿.pdf>" "file:///<定稿.html 绝对路径>"
```

**导出前置校验（v2.5.2-dsh.16）**：`md2html.mjs` 会先用 `scripts/_lib/svg.mjs` 校验每张 SVG——**结构不合格（未闭合 / 无 `<svg>` 根 / 无 viewBox 且无宽高 / 含 DTD·ENTITY）直接 exit 2 拒绝导出且不产出 HTML**（旧版坏 SVG 原样嵌入、exit 0，浏览器整块不渲染而无提示）；`<script>`/`on*`/`foreignObject`/`javascript:`/外部引用会被剥离并逐条告警；`--strict` 可让任何告警都判失败。缺图的图位输出显式占位（含期望文件名），不会静默留白。

校验：`scripts/pdfcheck.mjs`（解压 PDF FlateDecode 流 + 原始字节直查 `/Page` `/Font`/`ToUnicode`/`CIDFont` 计数 + `%%EOF`）。中文字体依赖系统字体（Windows 自带 SimSun/微软雅黑即够）。

## 四、Phase 0 + Phase 5 选择流程

### Phase 0（定题）
主控询问主人：
```
本次任务是否需要多格式导出？
□ 是（请选格式：latex / docx / pdf）→ 启用 v2.5.0 format-export.md
□ 否（默认 md）→ 不加载导出逻辑，节省 token
```

### Phase 5（终稿）
如 Phase 0 选了格式 → T8 主控按所选格式跑 pandoc 命令生成 final/定稿.{tex/docx/pdf}
如 Phase 0 选否 → 仅输出 final/定稿.md

## 五、与字数判定表 / 投稿就绪检查表的关系

- 字数判定表（v2.4.6）：无论 format，所有格式都要过字数核验
- 投稿就绪检查表（v2.4.6）：Word/PDF 转换检查项在 v2.5.0 启用 `--format docx/pdf` 时激活

## 六、限制

- **执行边界**（v2.5.2-dsh.5 修订，非「零 exec」）：pandoc / rsvg-convert 由主人在 host shell 手动跑（论衡 agent 不直接调用外部格式转换工具）；随包白名单脚本（md2html/pdfcheck）可由主控执行
- **模板依赖**：latex/docx/pdf 需要主人提供对应的模板文件（academic-paper.tex / academic-paper-template.docx）
- **中文支持**：用 xelatex 引擎 + csl=chinese-gb7714-2015-numeric 处理中文引用
