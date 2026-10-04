# 数据图表 SVG 模板（Phase 4.5 配图专用）

> **用途**：主控在 Phase 4.5 生成数据图表时，**复制本文件对应图型的整块 SVG**，只填数据与文案。
> **核心铁律**：数据图表**禁止文生图**（数字不可控）；SVG 是文本，主控用 `write` 工具直接生成（不跑 shell）。图上所有数字必须来自数据卡 / 案例卡，与正文 `[Dxx]`/`[Cxx]` 一致。
> **品牌调性**（主人「极简自然」）：米色底 + 深棕文字 + 衬线字体，忌浓艳、忌渐变、忌数据水印感。
> **v18.30.0（EFF-6）改造**：本文件从「骨架 + 5 个**片段**」改为 **5 个可直接落盘的完整 SVG 文档**。改造前实测：本文件 6 个 `svg` 代码块里 **5 个**过不了 `_lib/svg.mjs` 校验（没有 `<svg>` 根元素／没有 `viewBox`）——照抄得到的文件会被 `md2html` 判 **exit 40**（`md2html.mjs` 导出前用同一套结构校验）。现在**每个代码块本身就是一份合格图件**，剩下的只是填空。
> **机械保证**：`tests/figure-template.test.mjs` 会抽取本文每个 `svg` 代码块做结构校验与「零可见数字」校验——**坏一个就红**，不再靠人眼检查本文是否还能用。

---

## 一、品牌视觉规范（统一强制）

| 要素 | 值 | 说明 |
|------|-----|------|
| **背景色** | `#F4EFE5`（米白） | 所有图统一底 |
| **主文字** | `#2A2826`（深棕黑） | 标题／数据／标签 |
| **次要文字** | `#6A6560`（灰棕） | 副标题／年份／口径 |
| **辅助线** | `#8A8580`（浅灰棕） | 坐标轴／网格 |
| **强调色** | `#A0413F`（砖红） | 关键数据点／对比落差点 |
| **浅底块** | `#E8DDC8`（浅棕） | 图例底／高亮块 |
| **字体** | `-apple-system, 'PingFang SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif` | 衬线，极简自然 |
| **画布** | `viewBox="0 0 700 500"`（默认） | 可调；**必须有 viewBox 或 width+height** |

---

## 二、三步用法

1. **选图型**：按下表挑一类，把**整块**（从 `<?xml …?>` 到 `</svg>`）复制到 `final/图件/图N_标题.svg`（N 与正文 `[图N：标题]` 一致）。
2. **只填空**：替换所有 `【…】` 槽位。数字一律取自数据卡／案例卡；几何量（条宽、折线点、圆心）按 §三 的映射公式**跟着数值一起改**。
3. **落盘后验证**：`node scripts/md2html.mjs <定稿.md> <定稿.html> --fig-dir final/图件`（结构不合格即 **exit 40**）；正式对账由 **M-Form-9** 在 T7/T8 各跑一次。

| 图型 | 适用 | 关键量 |
|---|---|---|
| 4.1 条形图 | 多主体横向对比、分类强度 | 条宽 |
| 4.2 折线图 | 趋势、时间序列 | 折线点坐标 |
| 4.3 占比条 | 构成、占比分布 | 条宽 |
| 4.4 矩阵图 | 二维定位、象限判断 | 圆心坐标 |
| 4.5 流程图 | 事件链、传导路径、关系模型 | 节点与连线 |

---

## 三、数值 → 坐标映射（先算再画）

坐标**不算「图上数字」**（M-Form-9 只抽 `<text>`/`<tspan>`/`<title>` 文本节点），但**比例错了图就是错的**，而没有任何门会替你看这一层（如实声明，见 §五 第 6 条）：

| 图型 | 映射 |
|---|---|
| 4.1 条形图 | `条宽 = 值 ÷ 最大值 × 420`，x 起点固定 240；条高固定 30，条间距固定 50 |
| 4.2 折线图 | `x = 120 + i × 步长`（5 点等距：步长 130）；`y = 420 − 值 ÷ 最大值 × 320` |
| 4.3 占比条 | `条宽 = 占比百分数 × 4`（100% = 400 px） |
| 4.4 矩阵图 | 得分 ∈ [−1, 1]：`cx = 380 + 横向得分 × 240`；`cy = 250 − 纵向得分 × 160` |
| 4.5 流程图 | 主链节点等距：`x = 80 + i × 175`（4 节点），`y = 240`；支线节点自行等距 |

---

### 三·补、**可选**：用 `data-grid` 声明网格结构（v18.73.0 · 为几何自检预留）

**矩阵/热力类图**（第 4 类）可**可选地**在 `<svg>` 根上声明行列：

```xml
<svg viewBox="0 0 640 400" data-grid="rows=5;cols=7" ...>
```

- **用途**：声明后，**将来的机检**可据此核「标记数 = rows×cols」与「标记坐标落在行列中心」，**抓住「标记错位 / 多标少标」这类目视才发现的缺陷**（实测病灶：一批标记不落列中心且多一个，**通过了当时的全部机检**）。
- **当前状态（如实）**：**尚无消费者** —— 本约定为**预置**，检查器与测试须另批补齐（见 `audits/机制文件修订记录-2026-10-04-不能评估的忠诚批.md` §F-17）。
- **为什么必须「可选」**：**不声明的图一律不检** —— 概念图 / 流程图（第 1 / 3 / 5 类）本无网格，强制检会**大面积误报**。**一个会误报的新门比没有门更糟。**
- **不写会怎样**：与今天完全一致（无任何影响）。**写了但写错**（标记数与 `rows×cols` 不符）**才是**将来要被检出的情形。

---

## 四、五类图型

> 每块 = **完整可落盘图件** + **填空清单**。块内**没有任何可见数字**（`<text>` 里一个阿拉伯数字都没有）——这是刻意设计：模板里的数字一旦被照抄，就是编造数据；注释里的示例算术仅供你算坐标用，不会被渲染，也不进 M-Form-9 的对账。

### 4.1 条形图（横向对比）

```svg
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500" font-family="-apple-system, 'PingFang SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif">
  <rect width="700" height="500" fill="#F4EFE5"/>
  <text x="350" y="45" text-anchor="middle" font-size="22" font-weight="bold" fill="#2A2826">【图表标题】</text>
  <text x="350" y="68" text-anchor="middle" font-size="12" fill="#6A6560">【副标题／口径：样本量 · 时间范围】</text>
  <text x="350" y="86" text-anchor="middle" font-size="10" fill="#8A8580">数据来源：【[Dxx]／[Cxx]，详见文末引用来源】</text>
  <g font-size="11" fill="#2A2826" text-anchor="end">
    <text x="180" y="158">【类别一】</text>
    <text x="180" y="208">【类别二】</text>
    <text x="180" y="258">【类别三】</text>
  </g>
  <line x1="200" y1="120" x2="200" y2="300" stroke="#8A8580" stroke-width="0.5"/>
  <!-- 条宽 = 值 ÷ 最大值 × 420（x 起点 240）。示例：最大值 100 → 100/60/30 得 420/252/126 -->
  <rect x="240" y="140" width="420" height="30" fill="#A0413F"/>
  <rect x="240" y="190" width="252" height="30" fill="#2A2826"/>
  <rect x="240" y="240" width="126" height="30" fill="#6A6560"/>
  <text x="690" y="160" text-anchor="end" font-size="13" font-weight="bold" fill="#2A2826">【值一】</text>
  <text x="512" y="210" font-size="13" font-weight="bold" fill="#2A2826">【值二】</text>
  <text x="386" y="260" font-size="13" font-weight="bold" fill="#2A2826">【值三】</text>
  <text x="350" y="340" text-anchor="middle" font-size="11" fill="#6A6560">【单位／注释：全称、口径或数据缺口说明】</text>
  <text x="350" y="478" text-anchor="middle" font-size="10" fill="#8A8580">【注：口径 · 时效 · 数据缺口】</text>
</svg>
```

**填空清单**：① 标题／副标题／底部注；② 数据来源编号（必须与数据卡对应）；③ 三个类别名；④ 三个数值标签 + **对应条宽**（同改，比例 = 值比）；⑤ 单位与注释。

### 4.2 折线图（趋势／时间序列）

```svg
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500" font-family="-apple-system, 'PingFang SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif">
  <rect width="700" height="500" fill="#F4EFE5"/>
  <text x="350" y="45" text-anchor="middle" font-size="22" font-weight="bold" fill="#2A2826">【图表标题】</text>
  <text x="350" y="68" text-anchor="middle" font-size="12" fill="#6A6560">【副标题／口径：样本量 · 时间范围】</text>
  <text x="350" y="86" text-anchor="middle" font-size="10" fill="#8A8580">数据来源：【[Dxx]／[Cxx]，详见文末引用来源】</text>
  <line x1="120" y1="110" x2="120" y2="420" stroke="#8A8580" stroke-width="1"/>
  <line x1="120" y1="420" x2="640" y2="420" stroke="#8A8580" stroke-width="1"/>
  <g font-size="11" fill="#6A6560" text-anchor="middle">
    <text x="120" y="440">【时点一】</text>
    <text x="250" y="440">【时点二】</text>
    <text x="380" y="440">【时点三】</text>
    <text x="510" y="440">【时点四】</text>
    <text x="640" y="440">【时点五】</text>
  </g>
  <!-- 折线点：x = 120 + i×130；y = 420 − 值 ÷ 最大值 × 320（示例：最大值 100 → 50/70/85/95/100） -->
  <polyline points="120,260 250,196 380,148 510,116 640,100" fill="none" stroke="#A0413F" stroke-width="2"/>
  <g fill="#A0413F">
    <circle cx="120" cy="260" r="4"/>
    <circle cx="250" cy="196" r="4"/>
    <circle cx="380" cy="148" r="4"/>
    <circle cx="510" cy="116" r="4"/>
    <circle cx="640" cy="100" r="4"/>
  </g>
  <g font-size="12" font-weight="bold" fill="#2A2826" text-anchor="middle">
    <text x="120" y="244">【值一】</text>
    <text x="250" y="180">【值二】</text>
    <text x="380" y="132">【值三】</text>
    <text x="510" y="100">【值四】</text>
    <text x="640" y="84">【值五】</text>
  </g>
  <text x="350" y="478" text-anchor="middle" font-size="10" fill="#8A8580">【注：口径 · 时效 · 数据缺口】</text>
</svg>
```

**填空清单**：① 标题／副标题／底部注；② 数据来源编号；③ 五个时点标签；④ 五个数值标签与 **`polyline` 点串 + `circle` 圆心**（同改）；⑤ 数据点少于五个时，删掉多余一组（标签／点／圆）并**重算步长**（`步长 = 520 ÷ (n−1)`）。

### 4.3 占比条（构成／占比分布）

> **刻意不用真饼图**：极简自然风格下，分段比例条比饼图更易读、更好核对（旧版即此口径）。占比总和须为 100%，**四舍五入后的残差如实写进注释**，不许凑数。

```svg
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500" font-family="-apple-system, 'PingFang SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif">
  <rect width="700" height="500" fill="#F4EFE5"/>
  <text x="350" y="45" text-anchor="middle" font-size="22" font-weight="bold" fill="#2A2826">【图表标题】</text>
  <text x="350" y="68" text-anchor="middle" font-size="12" fill="#6A6560">【副标题／口径：样本量 · 统计范围】</text>
  <text x="350" y="86" text-anchor="middle" font-size="10" fill="#8A8580">数据来源：【[Dxx]／[Cxx]，详见文末引用来源】</text>
  <!-- 条宽 = 占比百分数 × 4（100% = 400）。示例：40%/25%/20%/15% → 160/100/80/60 -->
  <g>
    <rect x="140" y="150" width="160" height="26" fill="#A0413F"/>
    <text x="312" y="169" font-size="13" font-weight="bold" fill="#2A2826">【类别一】　【占比一】</text>
    <rect x="140" y="196" width="100" height="26" fill="#2A2826"/>
    <text x="252" y="215" font-size="13" font-weight="bold" fill="#2A2826">【类别二】　【占比二】</text>
    <rect x="140" y="242" width="80" height="26" fill="#6A6560"/>
    <text x="232" y="261" font-size="13" font-weight="bold" fill="#2A2826">【类别三】　【占比三】</text>
    <rect x="140" y="288" width="60" height="26" fill="#E8DDC8"/>
    <text x="212" y="307" font-size="13" font-weight="bold" fill="#2A2826">【类别四】　【占比四】</text>
  </g>
  <text x="350" y="360" text-anchor="middle" font-size="11" fill="#6A6560">【注释：占比之和与取整残差说明】</text>
  <text x="350" y="478" text-anchor="middle" font-size="10" fill="#8A8580">【注：口径 · 时效 · 数据缺口】</text>
</svg>
```

**填空清单**：① 标题／副标题／底部注；② 数据来源编号；③ 四组「类别 + 占比」；④ 四条**条宽**（占比 × 4，同改）；⑤ 取整残差注释。**占比之和不为 100% 时不得改数据凑整**——写清缺口与原因。

### 4.4 矩阵图（二维象限／定位）

```svg
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500" font-family="-apple-system, 'PingFang SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif">
  <rect width="700" height="500" fill="#F4EFE5"/>
  <text x="350" y="45" text-anchor="middle" font-size="22" font-weight="bold" fill="#2A2826">【图表标题】</text>
  <text x="350" y="68" text-anchor="middle" font-size="12" fill="#6A6560">【副标题／口径：两个维度的定义与取值范围】</text>
  <text x="350" y="86" text-anchor="middle" font-size="10" fill="#8A8580">数据来源：【[Dxx]／[Cxx]，详见文末引用来源】</text>
  <rect x="140" y="120" width="480" height="260" fill="#E8DDC8" opacity="0.35"/>
  <line x1="140" y1="250" x2="620" y2="250" stroke="#8A8580" stroke-width="1"/>
  <line x1="380" y1="120" x2="380" y2="380" stroke="#8A8580" stroke-width="1"/>
  <g font-size="11" fill="#6A6560">
    <text x="616" y="268" text-anchor="end">【横轴：低 → 高】</text>
    <text x="386" y="134">【纵轴：低 → 高】</text>
    <text x="146" y="134">【象限二标签】</text>
    <text x="614" y="134" text-anchor="end">【象限一标签】</text>
    <text x="146" y="372">【象限三标签】</text>
    <text x="614" y="372" text-anchor="end">【象限四标签】</text>
  </g>
  <!-- 圆心：cx = 380 + 横得分×240；cy = 250 − 纵得分×160（得分 ∈ [−1,1]）。示例：(0.6, 0.5) → (524, 170) -->
  <circle cx="524" cy="170" r="6" fill="#A0413F"/>
  <text x="534" y="166" font-size="12" font-weight="bold" fill="#2A2826">【主体一】</text>
  <circle cx="236" cy="330" r="6" fill="#A0413F"/>
  <text x="246" y="326" font-size="12" font-weight="bold" fill="#2A2826">【主体二】</text>
  <circle cx="476" cy="298" r="6" fill="#6A6560"/>
  <text x="486" y="294" font-size="12" font-weight="bold" fill="#2A2826">【主体三】</text>
  <text x="350" y="478" text-anchor="middle" font-size="10" fill="#8A8580">【注：维度口径 · 打分依据 · 数据缺口】</text>
</svg>
```

**填空清单**：① 标题／副标题／底部注；② 数据来源编号；③ 横纵轴说明与四个象限标签；④ 每个主体的名称 + **圆心坐标**（按 §三 公式由两个维度得分算出，同改）。

### 4.5 流程图（事件链／传导路径）

```svg
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500" font-family="-apple-system, 'PingFang SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif">
  <rect width="700" height="500" fill="#F4EFE5"/>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#6A6560"/>
    </marker>
  </defs>
  <text x="350" y="45" text-anchor="middle" font-size="22" font-weight="bold" fill="#2A2826">【图表标题】</text>
  <text x="350" y="68" text-anchor="middle" font-size="12" fill="#6A6560">【副标题／口径：链条起止与依据】</text>
  <text x="350" y="86" text-anchor="middle" font-size="10" fill="#8A8580">数据来源：【[Dxx]／[Cxx]，详见文末引用来源】</text>
  <!-- 主链 4 节点等距：x = 80 + i×175，y = 240；支线节点自行等距并保持 40 px 间距 -->
  <g stroke="#2A2826" stroke-width="1.2" fill="#F4EFE5">
    <rect x="60" y="220" width="120" height="40" rx="6"/>
    <rect x="235" y="220" width="120" height="40" rx="6"/>
    <rect x="410" y="220" width="120" height="40" rx="6"/>
    <rect x="585" y="220" width="95" height="40" rx="6"/>
  </g>
  <g font-size="12" fill="#2A2826" text-anchor="middle">
    <text x="120" y="245">【环节一】</text>
    <text x="295" y="245">【环节二】</text>
    <text x="470" y="245">【环节三】</text>
    <text x="632" y="245">【环节四】</text>
  </g>
  <g stroke="#6A6560" stroke-width="1.2" marker-end="url(#arrow)">
    <line x1="180" y1="240" x2="231" y2="240"/>
    <line x1="355" y1="240" x2="406" y2="240"/>
    <line x1="530" y1="240" x2="581" y2="240"/>
  </g>
  <!-- 支线（可删）：从「环节二」下引到条件节点 -->
  <g stroke="#A0413F" stroke-width="1.2" marker-end="url(#arrow)">
    <line x1="295" y1="260" x2="295" y2="330"/>
  </g>
  <rect x="205" y="332" width="180" height="40" rx="6" fill="#E8DDC8" stroke="#A0413F" stroke-width="1.2"/>
  <text x="295" y="357" text-anchor="middle" font-size="12" font-weight="bold" fill="#2A2826">【支线条件／反方】</text>
  <text x="350" y="430" text-anchor="middle" font-size="11" fill="#6A6560">【链条说明：箭头语义、时间跨度或因果强度】</text>
  <text x="350" y="478" text-anchor="middle" font-size="10" fill="#8A8580">【注：口径 · 时效 · 数据缺口】</text>
</svg>
```

**填空清单**：① 标题／副标题／底部注；② 数据来源编号；③ 四个环节名 + 支线条件名；④ 链条说明；⑤ 节点增减时**保持等距并重算 `x`**（删支线时连同 `<g>` 支线组与条件节点一起删）。

---

## 五、数据精确性铁律（强制）

1. **数字必须来自数据卡**：图上每个数值都要能回溯到数据卡 `[Dxx]` 或案例卡 `[Cxx]`，禁止凭记忆／估算填数。
2. **模板零数字**：本节四类模板的 `<text>` 里**没有任何阿拉伯数字**（机械校验见 `tests/figure-template.test.mjs`）——你填的每个数字都必须来自卡片，**不许把注释里的示例数照抄**。
3. **数据缺口如实标注**：查不到精确值 → 图上写「数据缺口」，不许估一个"约"。
4. **口径说明必带**：副标题／底部注写明口径（统计范围、样本量、城乡等）。
5. **时效标注**：红级（>5 年）数据在图上显著标注。
6. **几何量不受任何门保护（如实声明）**：条宽／折线点／圆心这些**属性里的坐标**，M-Form-9 不读（它只抽 `<text>` 文本节点）。故「比例对不对」只能靠你自己按 §三 公式算 —— 填完**回读一遍比例**（条宽之比 == 数值之比）是唯一防线。
7. **刻度数字也算「图上数字」**（v18.30.0 实测）：M-Form-9 会把 `<text>` 里长度 ≥2 的数字与数据卡／正文对账；写 `25/50/75/100` 这类区间刻度而正文没有这些数字时，会得到一条 **P2 软提示**「可能为刻度或坐标，请人工确认」（实测见 `audits/机制文件修订记录-2026-09-27-EFF6-图件模板.md` §三）。两条正当做法：① 刻度取自数据卡里**出现过的数字**；② 只标 0 与最大值（`0` 是单字符，不在对账范围）。这是**既有行为**，不是本模板引入的缺陷。

---

## 六、与封面（文生图）的边界

| 维度 | 数据图表（本模板） | 封面视觉（DSH：SVG／投喂／图像服务） |
|------|-------------------|--------------------------|
| 生成方式 | 主控 `write` 手写 SVG | AI 文生图 |
| 数字可控 | ✅ 来自数据卡，100% 精确 | ❌ 数字不可控（封面无需精确数字） |
| 是否需主人同意 | ❌ 否（SVG 本地生成零外发） | ✅ 是（调用外部图像服务，教训 #44） |
| fallback | 无（SVG 永远可用） | OpenAI → Google → minimax → SVG → 人工上传 |
| 图件位置 | `final/图件/图N_标题.svg` | `final/图件/封面.svg` |

---

## 七、交付清单

- 图件统一入 `final/图件/`，命名 `图N_标题.svg`（N 与正文 `[图N]` 对应，**图位独占一行**）。
- 交付说明 `final/交付说明.md` 列图件清单 + 每图数据来源编号。
- 如需 PNG（公众号排版），**默认主人用 rsvg-convert 本地转换**（零外发）；如主人明确同意调用外部图像服务，主控才可用图像 MCP 转 PNG。

---

**维护说明**：新增图型时，**必须同时**更新本文（加一整块可落盘的 SVG）+ §三 映射表 + §二 图型表；改完跑 `node --test tests/figure-template.test.mjs`（结构 + 零数字 + 端到端 M-Form-9 三条都会验）。品牌配色如需调整，改 §一 表并同步四类模板里的十六进制值。
