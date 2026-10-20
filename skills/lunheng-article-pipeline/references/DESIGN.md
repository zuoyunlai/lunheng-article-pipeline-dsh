# DESIGN.md — 论衡插件界面设计基准

> 版本：v19.23.0｜**读者**：改 `lib/client.js`（浏览器半边）的维护者/子代理。**本文件不进任何运行期读清单**（流水线角色不读）。
> **为什么需要它**：客户端的样式约定此前**只活在代码注释里**（散在 `lib/client.js` 的 `T()` / `S` 与若干「v18.9x 修复」注解中）。注释会被重写、会被漏读；而 `lib/client.js` 是**单文件 + 零构建链**的形态，没有组件库或 lint 兜底——约定一旦失守就是**静默的视觉退化**（暗色下看不见、图表全黑、文字与底色同色）。本文件把这些约定收成**唯一真源**，并在 §9 列出机械消费者（写错会红）。
> **边界（如实声明）**：本文件**只是约定**，不是自动执行体。真正拦住越界的是 §9 的机检；本文件的作用是让「为什么这样写」在改代码之前就能查到。

## 一、适用范围

`lib/client.js` 的全部 UI（运行面板 + 开工台），以及任何后续新增的客户端半边。**不适用**于产物文档（`run/<项目>/` 下的 Markdown/SVG——那里归 `references/_shared/format-export.md` 与图件模板管）。

## 二、色彩：只用 DSH 语义 token

1. **唯一取色方式**：`T(name, fallback)` → `var(--dsw-alias-x, <浅色兜底>)`。**每个 token 必须带兜底值**（单参调用一律拒），宿主未定义时退化成旧观感，而不是变成不可读。
2. **禁颜色字面量**：除 `T()` 的兜底参数外，源码里不得出现 `#rgb/#rrggbb/#rrggbbaa`。
3. **禁主题选择器**：不得写 `@media (prefers-color-scheme: …)`、不得在样式里编码 `dark:` 分支。明暗归 `ui-theme`（由 `ui-layout` 把解析后的快照应用到文档），组件**随主题自动切换、零 JS 分支**。
4. **实测在用的 token（11 个）**：`bg-layer-1` / `bg-layer-2` / `border-l1` / `border-l2` / `brand-primary` / `label-primary` / `label-secondary` / `state-error-primary` / `state-idle-primary` / `state-success-primary` / `state-warn-primary`。token 名白名单**真源 = 本机客户端目录**（`cordis_inspect_query client Theme.listTokens`，14 个 alias + sidebar fill）——**拼错一个字母不会报错**，只会静默退化到兜底浅色，暗色主题下发白。
5. **两条踩过的坑**：
   - 未显式设色的文本**必须继承** `--dsw-alias-label-primary`（v18.93.1：暗色下题名/状态行/文件名黑到看不见）。
   - **不得用 `brand-primary` 当图表主色**（v18.91.2：本机主题里它是墨色 ⇒ 整片图变黑）。图表主系列用 `state-success-primary`，次系列用 `state-warn-primary`；浅色变体由 `color-mix(in srgb, <token> N%, transparent)` 派生（`lib/client.js` 的 9 项色板即此口径，**首尾不得同色**）。

## 三、字体与字号

| 用途 | 规格 |
|---|---|
| 正文基准 | `12.5px/1.6 "Segoe UI","Microsoft YaHei",system-ui,sans-serif` |
| 等宽（路径 / 命令 / 开场白预览） | `ui-monospace,Consolas,monospace`，11~11.5px |
| 允许的字号级 | 10.5 / 11 / 11.5 / 12 / 12.5 / 15 / 16 px（**不要新增中间值**） |
| 数字 | 一律 `fontVariantNumeric: 'tabular-nums'`（KPI / 进度值 / 表格 / 阶段带） |
| 字重 | 400（正文）/ 650（强调、标题、当前段）/ 700（KPI 数值） |

## 四、间距与圆角

- **gap 序列**：2 / 3 / 4 / 5 / 6 / 8 / 10 / 14 px。
- **内边距**：紧凑控件 `3px 7px`｜中档 `6px 10px` / `8px 10px`｜卡片 `8px 10px`。
- **圆角四档**：`6px`（按钮 / 输入框 / 小 chip）｜`8px`（内嵌信息块 / 子卡）｜`10px`（主卡片 / KPI 容器）｜`999px`（胶囊：徽章 / 进度条）。
- **描边**：`0.5px solid` + `border-l1`（容器）/ `border-l2`（控件）。

## 五、组件约定

| 组件 | 口径 |
|---|---|
| 卡片 | 背景 `bg-layer-1`、描边 `border-l1`、圆角 10、`padding: 8px 10px`、`flex: 1 1 460px` |
| 小节标题 | `cardTitle`：10.5px、字距 0.06em、`label-secondary`、uppercase |
| KPI 格 | 容器 `bg-layer-2` 圆角 10；格内 `bg-layer-1`；标签 11px `label-secondary`；数值 16px/700 `label-primary` |
| 进度条 / 计量条 | 轨道 `bg-layer-2`、填充 `state-success-primary`、高 9px、圆角 999、`overflow: hidden` |
| 徽章 | `padding: 1px 7px`、圆角 999、`border-l2`、11px `label-secondary` |
| 主按钮 | 底色 `state-success-primary`、文字 `bg-layer-1`、圆角 6（**不用 brand-primary 作底**） |
| 次按钮 | `bg-layer-2` 底 + `border-l2` 描边 + `label-primary` 文字 |
| 表格 | 100% 宽、`border-collapse: collapse`、11.5px、行分隔 `0.5px border-l1` |
| 空态 | **必须给出可执行提示**（命令或下一步），不得只写「暂无数据」——「不谎称有数据」是本包纪律（v18.90.1 教训） |
| 状态行 | 三个事实各说各话、**不合并成一句好听的**（座位行 `seatLine` 是范式） |
| **图标（v19.0.4；v19.0.5 补「字形必须是路径」）** | **纯内联 SVG**（零依赖、零外链——不引第三方图标库、不联网取图）：`fill/stroke: currentColor` 随主题、显示尺寸由 `size` 属性决定（缺省 16）、**装饰性图标带 `aria-hidden`**（相邻文字已表达含义时，读屏不该重复念）。两族并存，**按用途选**：① **线性稿**（侧栏 `PanelIcon`：24 网格、`fill:none`+`stroke:currentColor`、`strokeWidth` 1.7/2.1 随 active）；② **圆章稿**（开工台 `WbIcon`：24 网格、圆描边 + 「论」字**轮廓路径**）。⚠️ **字形只许用路径，不得用 `<text>`／内嵌 SVG 字体**（实测：内嵌 SVG 字体现代浏览器不支持 ⇒ 退化成「宿主得装那个字体」；写死颜色在暗色主题下消失）。文字标签前的图标与文字用**容器的 `gap`** 分隔，不给图标加外边距。**字形 bbox 若来自字体制（y 轴向上），变换必须带负 y 缩放翻正并居中** |

## 六、动效

- **全库唯一动效**：`.lh-wrap > *` 的 `box-shadow` / `border-color` 过渡 `.16s ease`，hover 时描边升到 `border-l2` 并加 `0 2px 12px color-mix(…)` 阴影。
- **载体**：经 `ctx.get('styles').insert(css)` 注入**类样式**——hover 是伪类，内联样式写不了；卡片边框是内联的，故 hover 需 `!important` 覆盖。**缺席 `styles` 服务即降级**（无 hover 抬升，不影响可用性）。
- ⚠️ **注入的 CSS 必须是真调用**：v18.92.0–18.99.0 期间这条规则**从未生效**——实参被写成了字符串字面量，注入的是 `T(<token>, <兜底>)` 这段**源码文本**，浏览器整条声明丢弃（静默失效）。v19.0.0 修复并加钉。
- **禁**：自造 `@keyframes`、自写阴影常量、用动画表达状态（状态一律文字 + 颜色 token）。

## 七、响应式

- **不用 media query**（理由同色彩：断点归宿主布局）。一律 `flexWrap: 'wrap'` + `minWidth: 0` + 基准宽度（如 `flex: '1 1 460px'`），容器 `maxWidth: '100%'`、`boxSizing: 'border-box'`。
- 宽屏自适应靠 flex 基准值分裂列，不靠断点。

### 7.0 方向决定语义：**列容器里的 `flex-basis` 是高度**（v19.0.2 立；主人实测到的大段空白）

**教训（主人实测）**：「全部同意和展开高级设置之间有大段空白」——根因是**样式复用错位**：
行方向样式 `S.wbNote`（`flex: '1 1 220px'`，本意 220px 宽）被用进了**列容器** `S.wbField`
（`flexDirection: 'column'`）⇒ 同一个 `flex-basis` 在列方向被解释成**高度 220px**。

**规则**：
1. **字段列内（`wbField` / `wbFieldWide`）只许用方向无关的样式**（如 `wbFieldHint`、`wbLabel`、`wbInput`）——**一律不带 `flex`**。
2. 带 `flex: 1 1 <N>px` 的样式是**行方向专用**（`wbGrid` / `wbBar` / `wbActions` 这类 `flexWrap` 容器里用）。
3. 需要「占满一行」时，用**专用样式**（如 `wbFieldWide: flex: '1 1 100%'`）而不是临时拼。

**机械约束**：`tests/panel.test.mjs` 有**通类方向钉**——扫整棵渲染树（开工台 + 运行面板），任何列容器的子元素带 `px` 的 `flex-basis` 即红。**换一处复用同类样式照样红**，不靠人工记得。

### 7.1 槽位几何：`conversation.input.dock` **有两族几何，先选族再抄**（v19.0.1 立，v19.0.3 更正）

**教训（主人两次实测，两版各一次）**：v19.0.0「横向撑满窗口」→ v19.0.1 抄了 QueueDock 的几何 → v19.0.3「又窄了点，两端没对齐」。**根因不是数值错，是选错了几何族。**

| 族 | 谁在用 | 几何 | 视觉 |
|---|---|---|---|
| **叠层卡片** | `QueueDock` / `TodoPanel` | `width: calc(100% - 2×--dsh-composer-side-clearance - 2×--dsh-composer-dock-inset)`、`max-width: calc(--dsh-composer-card-max-width - 2×dock-inset)`、`padding: 0 dock-inset`、**负下边距**、**圆角只留上边** | **刻意**比输入框窄一圈、贴在输入框上沿（附件感） |
| **独立卡片 / 提示条** | shell 自己在输入栏里的 `uV2eYG_notice` | `width: 100%`、`max-width: var(--dsh-composer-card-max-width)` | **与输入框两端严格对齐** |

**本包的开工台属「独立卡片」族**（四边独立圆角、自带边框）⇒ 抄 `notice` 的写法。

**两条硬纪律**：
1. **外层容器已经做了侧向留白**（输入栏 root 有 `padding: 0 var(--dsh-composer-side-clearance)`）——所以 **`width: 100%` 就够了；再减一次 `side-clearance` 就是双重内缩**（v19.0.3 实测：右端短了约 32px）。
2. `max-width` 用 `var(--dsh-composer-card-max-width, 100%)`：宽窗口时靠 `margin: 0 auto` 居中、与输入框同宽；**变量缺失时 fallback 到 100%**（退化成满宽，而不是把 `calc()` 算坏）。变量的提供方是 shell（输入栏 root 定义 `--dsh-composer-card-max-width: calc(--dsh-chat-content-width + 32px)`、`-side-clearance: 16px`、`-dock-inset: 8px`）。

**判据一句话**：**要跟输入框两端对齐，就抄 shell 自己的 `notice`；要做「贴在输入框上的附件」，才抄 QueueDock。**

## 八、结构与跨版本生存

1. **`exports.inject = []`**：客户端半边**不声明**任何 inject 依赖；服务一律 `ctx.get(name)` 运行时探测 + 缺席降级。理由（实测）：照抄别的插件 `inject` 清单会在缺服务的宿主上**永不执行回调**（如本机无 `sidebarRightTabs`），等于静默消失。例外：`slots` 是注册席位的最小必需面，走 `ctx.inject(['slots'], …)` 并整块 try/catch。
2. **零构建链**：手写 lazy-CJS（`window.__ModuleLoader__.load({ id, factory })`），只 `require('react')`，UI 全走 `React.createElement`。**不得新增第三方依赖**。
3. **座位如实汇报**：注册结果写进 `SEATS`，页面页脚如实列出（已注册/未注册/注册异常），**不假装有**。
4. **文案 vs 数据（两块分治，v19.0.1 明确）**：
   - **文案** → `// ══ L10N:BEGIN ══ … L10N:END ══`，经 `t('key')` 取；`zh`/`en` 键集合必须逐字相同；宿主 `locale` 缺席时回落内置字典。
   - **派生数据 / 枚举值** → `// ══ DATA:BEGIN ══ … DATA:END ══`（文类档案表的派生副本、期刊库、各字段的选项值）。它们是要**与流水线字面对齐**的机器可读值，不是文案 ⇒ **不进文案棘轮**，但**必须加逐行对账用例**（`文类档案.md` / `期刊数据库.md` 各一条）。
   - **两块之外**的**代码行**中文字面量受**棘轮**约束（只许降；v19.0.2 基线 267，口径 = 只数会被渲染的代码行——**整行注释不计**：注释渲染不出来，且注释里「两个单引号片段夹中文」会被正则误判为字面量，属假阳性，别让假阳性逼人抬基线）。
   - 判据：**这个词是给人读的，还是给程序匹配的？** 给人读的进 L10N（要能译）；给程序匹配的进 DATA（要能对账）。
5. **写面纪律**：客户端**只写** `localStorage` 与「自己的输入框草稿」（`setDraft`）。**绝不自动 `submit()`**、不新增宿主 HTTP 路由、不读凭据。**写入只走席位标准通道**（`props.inputActions.setDraft`）——席位契约本身就提供它；**不得**去摸服务内部（如 `conversation.input.for(actx)`）当兜底：那不是公开接缝，会**静默腐坏**（v19.0.5 收口：主人真机回执确认标准通道可用后，删掉了旧版按猜补的第二通道；真出现「席位不给 props」时，`wb.channel.none` 会当场如实报缺，按它补即可）。
6. **一事实一处 + 观察/操作分离（v19.1.3–v19.1.6，主人裁定）**：① 进度 chips **只挂开工台标题栏**（收起即可见、**不进表单**）；**不得另设独立进度条**（两处并存被主人一眼看穿）；② 进度**只算既有快照字段**，缺的判据如实写「未纳入」，**不为它扩读面**；③ 不做逐 Phase 的表单、派发按钮与「续接」出口；字段标「必填/可选」**以 `wbValidate` 为准**，不靠印象；④ **「当前项目」三级判据**：**本会话绑定**（席位 `inject(sessionId)` → `localStorage`）→ 兜底按**项目内最新写入时间**（≤12 候选）→ 多项目才给极简切换器。**同一会话并行两项目无唯一当前项目**，由主人手选。

## 九、给 AI / 维护者的禁令清单（违反即 P0，机检会红）

| 禁令 | 谁在拦 |
|---|---|
| 写颜色字面量（T() 兜底除外）、写 `prefers-color-scheme` / `dark:` 分支 | `tests/panel.test.mjs`（token 白名单 + 字面量扫描） |
| 单参 `T('--token')`（无兜底） | 同上 |
| 图表主色用 `brand-primary` | 同上（`state-*` 白名单） |
| 把 `T(...)` 当字符串拼进 CSS | `tests/panel.test.mjs`（hover 真调用钉） |
| 新增中文文案写在 L10N 块外 | 同上（棘轮） |
| dock 条目自定宽度 / 撑满 100%（不照抄 composer 变量） | `tests/panel.test.mjs`（控宽契约钉） |
| zh/en 键集合不一致、空译文 | 同上（双语平衡） |
| 扩张 `exports.inject` | 同上（`deepEqual(mod.inject, [])`） |
| 新增宿主 HTTP 端点而不更新 `SECURITY.md` | `tests/panel.test.mjs`（面板路由数）+ 人工 review |
| 新增 token 名不先核对 `Theme.listTokens` | 同上（白名单集合） |
| 改本文件 `lib/client.js` 而不走授权五步 | `AGENTS.md` §文件修改操作约束 + `lib/guard.js`（工具级否决） |

## 十、变更流程

1. 改 `lib/client.js` 属**机制文件**改动 ⇒ 走「主人显式授权五步」（判据见 `references/maintainers.md` §14.1）。
2. 文案改动**同批**改 L10N 两套字典；数据表类副本（如开工台的文类表）**必须**与真源同步（钉在 `tests/panel.test.mjs`）。
3. 新增组件前先问：**这个席位存在吗**？席位目录真源 = `cordis_inspect_query(client, Slots, listSubTree)`（本机实测可用：`conversation.input.dock` / `shell.overlay` / `sidebar.footer.action` / `main` / `sidebar.panellist`）。**不要凭记忆写席位名**。
4. 样式改动后跑 `node --test tests/panel.test.mjs`（35 条，纯静态+桩渲染，秒级）。
