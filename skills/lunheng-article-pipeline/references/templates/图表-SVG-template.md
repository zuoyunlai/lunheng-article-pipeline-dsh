# 数据图表 SVG 模板（Phase 4.5 配图专用，v2.3.1 新增）

> **用途**：论衡主控在 Phase 4.5 生成数据图表时，参考本模板用 `write` 工具手写 SVG 矢量图。
> **核心铁律**：数据图表**禁止文生图**（数字不可控）；SVG 是文本，主控 LLM 可直接 `write` 生成，符合论衡「零 exec」哲学。图上所有数字必须来自数据卡，与正文 [Dxx]/[Cxx] 引用一致，生成后抽查核对。
> **品牌调性**（主人「极简自然」）：米色底 + 深棕文字 + 衬线字体 + 手绘感，忌浓艳、忌渐变、忌数据水印感。

---

## 一、品牌视觉规范（统一强制）

| 要素 | 值 | 说明 |
|------|-----|------|
| **背景色** | `#F4EFE5`（米白） | 所有图统一底 |
| **主文字** | `#2A2826`（深棕黑） | 标题/数据/标签 |
| **次要文字** | `#6A6560`（灰棕） | 副标题/年份/口径 |
| **辅助线** | `#8A8580`（浅灰棕） | 坐标轴/网格 |
| **强调色** | `#A0413F`（砖红） | 关键数据点/对比落差点 |
| **浅底块** | `#E8DDC8`（浅棕） | 图例底/高亮块 |
| **字体** | `-apple-system, 'PingFang SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif` | 衬线，极简自然 |
| **画布** | viewBox 700×500（默认） | 可调 |

---

## 二、SVG 骨架（通用）

```svg
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500" font-family="-apple-system, 'PingFang SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif">
  <rect width="700" height="500" fill="#F4EFE5"/>

  <!-- 标题区 -->
  <text x="350" y="45" text-anchor="middle" font-size="22" font-weight="bold" fill="#2A2826">【图表标题】</text>
  <text x="350" y="68" text-anchor="middle" font-size="12" fill="#6A6560">【副标题/口径说明】</text>
  <text x="350" y="86" text-anchor="middle" font-size="10" fill="#8A8580">数据来源：【[Dxx]/[Cxx] 编号，详见文末引用来源】</text>

  <!-- 图表主体（见下方各类型） -->

  <!-- 底部注（可选） -->
  <text x="350" y="478" text-anchor="middle" font-size="10" fill="#8A8580">【注：口径/时效/数据缺口说明】</text>
</svg>
```

---

## 三、五种图表类型的 SVG 结构

### 3.1 柱状图（横向对比）

适用于：多主体处置强度对比、各区域占比等。

```svg
  <!-- 纵轴标签（左） -->
  <g font-size="11" fill="#2A2826" text-anchor="end">
    <text x="180" y="158">【类别1】</text>
    <text x="180" y="208">【类别2】</text>
    <text x="180" y="258">【类别3】</text>
  </g>
  <!-- 纵轴线 -->
  <line x1="200" y1="120" x2="200" y2="430" stroke="#8A8580" stroke-width="0.5"/>
  <!-- 柱子（宽度与数值成正比） -->
  <rect x="240" y="140" width="【数值×比例】" height="30" fill="#2A2826"/>
  <rect x="240" y="190" width="【数值×比例】" height="30" fill="#6A6560"/>
  <!-- 强调柱（关键落差点用砖红） -->
  <rect x="240" y="240" width="【数值×比例】" height="30" fill="#A0413F"/>
  <!-- 数值标签 -->
  <text x="【柱右端+10】" y="160" font-size="13" font-weight="bold" fill="#2A2826">【数值】</text>
```

### 3.2 折线图（趋势/时间序列）

适用于：舆情事件年度分布、指标逐年变化等。

```svg
  <!-- 坐标轴 -->
  <line x1="120" y1="80" x2="120" y2="420" stroke="#8A8580" stroke-width="1"/>
  <line x1="120" y1="420" x2="640" y2="420" stroke="#8A8580" stroke-width="1"/>
  <!-- 刻度标签（X 轴 = 年份/时间，Y 轴 = 数值） -->
  <text x="120" y="440" text-anchor="middle" font-size="10" fill="#6A6560">【年份1】</text>
  <text x="250" y="440" text-anchor="middle" font-size="10" fill="#6A6560">【年份2】</text>
  <!-- 折线（polyline 连接各数据点） -->
  <polyline points="120,380 250,300 380,220 510,150 640,110"
            fill="none" stroke="#A0413F" stroke-width="2"/>
  <!-- 数据点 -->
  <circle cx="120" cy="380" r="4" fill="#A0413F"/>
  <circle cx="250" cy="300" r="4" fill="#A0413F"/>
  <!-- 数值标签 -->
  <text x="120" y="368" text-anchor="middle" font-size="11" font-weight="bold" fill="#2A2826">【数值】</text>
```

### 3.3 饼图（占比分布）

适用于：投资结构、资金来源占比等。

```svg
  <!-- 饼图（用 path 圆弧，或简化用多个扇形） -->
  <!-- 简化法：用同心圆 + 分段弧，或用图例 + 比例条替代 -->
  <!-- 比例条（更符合极简自然风格，替代真饼图） -->
  <g font-size="12" fill="#2A2826">
    <rect x="160" y="140" width="200" height="18" fill="#2A2826"/>
    <text x="380" y="154">【类别1】 40%</text>
    <rect x="160" y="170" width="120" height="18" fill="#6A6560"/>
    <text x="300" y="184">【类别2】 25%</text>
    <rect x="160" y="200" width="80" height="18" fill="#A0413F"/>
    <text x="260" y="214">【类别3】 15%</text>
  </g>
```

### 3.4 散点 / 二维坐标系

适用于：广度-烈度二维框架、定位图等。

```svg
  <!-- 象限背景 -->
  <line x1="120" y1="250" x2="640" y2="250" stroke="#8A8580" stroke-width="1"/>
  <line x1="380" y1="80" x2="380" y2="420" stroke="#8A8580" stroke-width="1"/>
  <!-- 轴标签 -->
  <text x="640" y="270" text-anchor="end" font-size="11" fill="#2A2826">【X轴：广度→】</text>
  <text x="380" y="70" text-anchor="middle" font-size="11" fill="#2A2826">【Y轴：烈度↑】</text>
  <!-- 数据点（坐标映射到画布） -->
  <circle cx="【x坐标】" cy="【y坐标】" r="5" fill="#A0413F"/>
  <text x="【x坐标+8】" y="【y坐标-8】" font-size="11" fill="#2A2826">【数据点标签】</text>
```

### 3.5 关系图 / 示意图（事件链、合谋模型）

适用于：五方合谋、事件链、传导路径等。

```svg
  <!-- 节点（圆角矩形） -->
  <rect x="80" y="200" width="120" height="40" rx="6" fill="#F4EFE5" stroke="#2A2826" stroke-width="1.2"/>
  <text x="140" y="225" text-anchor="middle" font-size="12" fill="#2A2826">【主体/节点】</text>
  <!-- 连线（箭头） -->
  <line x1="200" y1="220" x2="260" y2="220" stroke="#6A6560" stroke-width="1.2" marker-end="url(#arrow)"/>
  <!-- 箭头定义（放 svg 顶部 defs） -->
  <!-- <defs><marker id="arrow" ...>...</marker></defs> -->
```

---

## 四、数据精确性铁律（强制）

1. **数字必须来自数据卡**：图上每个数值都要能回溯到数据卡 [Dxx] 或案例卡 [Cxx]，禁止凭记忆/估算填数。
2. **生成后抽查核对**：主控生成 SVG 后，逐个数字 grep 回数据卡核对，不一致 → 修正。
3. **数据缺口如实标注**：查不到精确值 → 图上写「数据缺口」，不许估一个"约"。
4. **口径说明必带**：副标题/底部注写明口径（城镇/农村、样本量、统计范围）。
5. **时效标注**：🔴 红级（>5年）数据在图上显著标注。

---

## 五、与封面（文生图）的边界

| 维度 | 数据图表（本模板） | 封面视觉（image_generate） |
|------|-------------------|--------------------------|
| 生成方式 | 主控 `write` 手写 SVG | AI 文生图 |
| 数字可控 | ✅ 来自数据卡，100% 精确 | ❌ 数字不可控（封面无需精确数字） |
| 是否需主人同意 | ❌ 否（SVG 本地生成零外发） | ✅ 是（调用外部图像服务，教训 #44） |
| fallback | 无（SVG 永远可用） | OpenAI → Google → minimax → SVG → 人工上传 |
| 图件位置 | `final/图件/图N_标题.svg` | `final/图件/封面.svg` |

---

## 六、交付清单

- 图件统一入 `final/图件/`，命名 `图N_标题.svg`（N 与正文 [图N] 对应）
- 交付说明 `final/交付说明.md` 列图件清单 + 每图数据来源编号
- 如需 PNG（公众号排版），主控可用 `image_generate` 或主人用 rsvg-convert 转（注意：PNG 转 SVG 不影响数字精确性）

---

**维护说明**：新增图表类型时，先更新本模板，再在实战中复用；品牌配色如需调整，改本模板第一节，全局生效。
