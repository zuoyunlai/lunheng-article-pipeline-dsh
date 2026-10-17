// lib/client.js — 论衡「运行面板」浏览器半边（v18.90.0 · B 批）
//
// 协议（**官方契约**，出处见 dsh-plugin-guide 的 official-docs `docs/cookbook/adding-a-settings-card.zh.md` §5
//   「浏览器半侧挂在哪里」+ `packages/client/modules` 的 lazy-CJS 形态）：
//   · 浏览器半侧由客户端模块系统按 `package.json` 的 `dsh.client` + `exports["./client"]` 送出；
//   · 构建产物必须是一段 lazy-CJS 脚本：`window.__ModuleLoader__.load({ id: <包名>, factory: (require) => … })`，
//     factory 返回 cordis-plugin 形状（`exports.apply` / `exports.inject`）。
//   · **仓库外的包要自己复刻这一步构建** —— 本文件即手写实现，**零构建链、零第三方依赖**
//     （只用 `require('react')`；UI 与样式全部走 `React.createElement` + 内联 style）。
//
// 数据来源：宿主半边的**只读** HTTP 路由（`lib/panel.mjs`，`/lunheng-panel/*`），
//   `EventSource` 订阅 `/events`（宿主侧 `fs.watch` 去抖推 + 5 s 心跳兜底）。**不直连文件系统、不读凭据**。
//
// 座位（feature-detect，**如实汇报实际落点**）：① 侧栏面板图标 + 中央面板（`sidebar.panellist` + `main`）；
//   ② 若客户端存在右栏服务（`sidebarRightTabs` / `sidebarRight`），再加注册一个右栏 tab 类型，
//   并在面板里给「在右栏打开」按钮。当前本机客户端服务目录里**没有**右栏服务，故实际落点由运行时决定。
window.__ModuleLoader__.load({
  id: 'lunheng-article-pipeline',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var react = require('react');
    var h = react.createElement;

    var PANEL_ID = 'lunheng-run';
    var API = '/lunheng-panel';
    var LS_KEY = 'lunheng.panel.project';
    var LS_ROOT = 'lunheng.panel.root';   // v18.90.7：记住主人选中的工作区根
    var LS_WB_CFG = 'lunheng.workbench.last_cfg';  // 工作台：上一次开工配置（「↺ 填充上次配置」）
    var LS_WB_OPEN = 'lunheng.workbench.open';     // 工作台：展开态
    // v19.1.5：**会话 ↔ 项目** 绑定（键 = 前缀 + sessionId）。为什么需要它：宿主 dock 席位是**每会话一份**，
    //   而旧版「当前项目」只有**全局判据**（跨根取活动最新）⇒ 两个会话并行时两条 bar 会显示同一个项目、
    //   并随两边交替写入而来回跳。有了本会话身份（见注册处的 `inject(sessionId)`）就能各看各的。
    //   只记「哪个会话在看哪个项目名」——不含任何项目内容，且只写 localStorage（本包唯一写面）。
    var LS_WB_BIND = 'lunheng.workbench.proj.';
    var NS = 'lunheng';                            // 宿主 locale 命名空间

    // ══ L10N:BEGIN ══════════════════════════════════════════════════════════════════════════
    // 文案真源（v19.0.0 §4.4）：**本块是唯一允许出现 UI 中文字面量的地方**（机检见
    //   `tests/panel.test.mjs` 的 L10N 棘轮用例）。zh / en 两套**键集合必须逐字相同**——
    //   官方 locale 服务的类型化形态即「bilingual balance enforced at registration」，本包用测试等价保证。
    // 缺席降级：宿主无 `locale` 服务时 `t()` 直接用本表（中文），**绝不阻断渲染**。
    var L10N = {
      zh: {
        'panel.label': '论衡运行',
        'panel.title': '论衡运行面板',
        'panel.rightbarTitle': '论衡运行',
        'panel.rightbarGuide': '实时看 run/<项目> 的阶段、角色、门与产物',
        'panel.rightbarBtn': '在右栏打开（若宿主支持）',
        'panel.readonly': '只读面：数据来自宿主侧 /lunheng-panel（不写文件、不起子进程、不读凭据）。完整图表报告：',
        'panel.figRecon': '图件对账：',
        'panel.figMissing': '缺的图位（正文已声明，final/图件 无对应文件）：',
        'panel.figSlot': '· 图',
        'panel.figHowTo': '补法：Phase 4.5 复制 references/templates/图表-SVG-template.md 对应图型填空落盘（数值须取自正文 / 数据卡）。',
        'panel.figReasonFrom': '不配图理由（来自 {src}）：{text}',
        'panel.figNoReason': '本项 0 图位、0 图件，但交付说明未登记理由 —— 须在 final/交付说明.md 的「图件」行写明为何不配图。',
        'panel.figExtras': '非正文图（封面 / 附录，不计入图位）：',
        'panel.mgRerun': '边车里没有逐项校验结果。重跑一次即可带上：',
        'panel.mgLegacy': '⚠ 该项目的 M 门报告**取不到逐项明细**（旧格式没有 results[] 数组，或该字段无法解析），**重跑 run-report 也带不上**（重跑只是把同一份旧报告再读一遍）。二选一：① 用当前版 m-gate-check 重跑 M 门生成新格式报告；② 接受「只有汇总数字、无逐项明细」。',
        'panel.mgNoReport': '该项目里没有 M 门报告（final/M-Gate-Report.json 或 audits/M-Gate-Report-v*.json）——须先在 T7 / T8 跑 m-gate-check 生成报告，数字层边车才有可呈现的机械实据。',
        'panel.mgRerunNote': '交付时的 M 门报告**没有逐项明细**（旧格式无 results[]）或**根本没有报告**。下面是**用当前版 m-gate-check 复跑**的结果——**仅供参考，不改变交付结论**：当年 M 门是 13 项、规则更宽，按今日 24 项规则多数老项目都会出现 P0/警告（卡内索引段硬格式、交付说明 12 字段、G0–G14 全覆盖等都是那些报告之后才立的口径）。',
        'panel.mgRerunMeta': '复跑于 {at}前 ｜ exit {exit} ｜ P0 {p0} · P1 {p1} · P2 {p2} ｜ 通过 {pass}/{total} ｜ 源：{rel}',
        'panel.mgSumRerunOnly': '交付时没有可用的 M 门汇总（项目内无报告）。下方「M 门准出门」展示的是**当前版复跑**的 24 项——**非交付结论**。',
        // v19.5.0（T7 反哺 N-11）：主人侧「卡在哪一步」两格——当前 Phase 在 KPI 行，本组给出「等待 / 上次更新」
        'panel.status.waitUpdate': '等待 / 更新',
        'panel.status.waiting': '⏳ 在等主人',
        'panel.status.waitingAt': '（status.md 行 ',
        'panel.status.waitingHits': ' 等 ',
        'panel.status.waitingHitsTail': ' 处',
        'panel.status.none': '✅ 无待主人项',
        'panel.status.lastUpdate': '  ·  上次更新 ',
        'seat.dock.on': '开工台 = 已注册（输入框上方 · conversation.input.dock）',
        'seat.dock.off': '开工台 = 未注册（本机客户端无 conversation.input.dock 席位）',
        'wb.btn.open': '打开',
        'wb.btn.close': '收起',
        'wb.title': '论衡开工',
        'wb.sub': '填写后生成结构化开场白；**只填入输入框，不自动发送** —— Phase 0 由你确认后才开工。',
        'wb.sec1': '基本设置',
        'wb.sec2': '项目素材与素材池',
        // v19.6.7（授权串文案对齐批）：括号里补「推理＝会话决定」——授权串是三段（检索/推理/脱敏），
        //   而面板只对「检索 / 脱敏」设控件；旧标题只列两段，主人对照开场白时会读成「表单漏了一项」。
        'wb.sec3': '外部服务授权（检索 / 脱敏；推理＝会话决定）与人在环',
        'wb.sec4': '高级（可选；留空＝跟随文类）',
        // v19.1.6：必填/可选标记——**判据以 `wbValidate` 为准**（真正拦人生成的那三个才是必填），
        //   不靠印象标注：题名 / 项目名 / 外部服务授权（已有默认值）为必填，其余一律可选。
        'wb.req': '必填',
        'wb.opt': '可选',
        'wb.f.title': '题名（≤25 字）',
        'wb.f.project': '项目名',
        'wb.f.projectPh': '1-32 字：中英文 / 数字 / - / _（将建 run/<项目名>/）',
        'wb.f.genre': '文类（场景预设）',
        'wb.f.words': '字数上限',
        'wb.f.lang': '语言',
        'wb.f.tone': '文风',
        'wb.f.styleBaseline': '风格基线',
        'wb.f.mask': '脱敏档',
        'wb.f.materials': '投喂材料',
        'wb.f.materialsPh': '浏览器读不到你的磁盘：请把材料放进工作区后，在此写文件名/路径清单',
        'wb.poolNote': '素材池为所有项目长期共享素材，位于 <工作区根>/evidence-pool/（与 run/ 平级，首次查池时惰性创建）。请将公共素材原件放入 evidence-pool/raw/{books,datasets,papers,misc}/，Phase 5 会自动抽取成卡片供复用。',
        'wb.f.scope': '检索范围',
        'wb.f.hitl': '人在环（OOH）',
        'wb.f.brief': '研究问题 / 写作要点',
        'wb.f.citeStyle': '引用格式',
        'wb.f.citeMode': '引用模式（= 交付形态）',
        'wb.f.journal': '期刊匹配',
        // v19.4.0（主人 2026-10-13 裁决）：`quality` / `rescan` 都不在面板出现——
        //   前者不是面板该管的开关，真载体 = Phase 0 确认单的「T9·G14 开关」格
        //   （`references/templates/主人确认-template.md:13`）；后者一词两指、表单还会给出第三种默认。
        'wb.f.targetJournal': '目标期刊',
        'wb.follow': '跟随文类',
        'wb.fill': '生成开场白并填入输入框',
        'wb.fillLast': '↺ 填充上次配置',
        'wb.clear': '清空',
        'wb.adv': '展开高级设置',
        'wb.advHide': '收起高级设置',
        'wb.preview': '开场白预览',
        'wb.copy': '复制',
        'wb.copied': '已复制',
        'wb.previewEmpty': '（填好题目与项目名后，这里会出现可核对的开场白）',
        'wb.channel.inputActions': '已填入输入框（席位标准通道 inputActions.setDraft）',
        'wb.channel.none': '未找到写入通道：本机客户端未提供 inputActions——请手动复制下方开场白。',
        'wb.need.title': '请先填题目',
        'wb.need.project': '请先填项目名',
        'wb.need.projectChars': '项目名只能含中文 / 字母 / 数字 / - / _，长度 1-32',
        'wb.need.retrieval': '检索范围必须显式选择',
        'wb.charts': '图件',
        'wb.chartsOn': '生成',
        'wb.chartsOff': '跳过',
        'wb.custom': '自定义（不套预设）',
        'wb.empty': '（无）',
        // v19.1.4（主人裁定）：删掉「继续已有项目」出口（含 `wb.proj.*` 与 `wb.resume.prompt`）。
        //   理由：**续接这件事本来就该在对话里说**（「继续 XXX 项目」），主控按真源读 status.md 即可；
        //   摆进表单既多余、又让表单变长。进度条仍需要项目清单与快照 —— 那部分取数逻辑保留（见下）。
        'wb.lastFilled': '已回填上次配置',
        'wb.previewHint': '预览见上方；只填入输入框，**不自动发送**',
        // v19.4.0：开场白末段的四条例律**从代码字面量搬进 L10N**——它们是「文案」，按
        //   `tests/panel.test.mjs` §4.4「L10N 块外的中文字面量受棘轮约束（只许降）」的口径，
        //   新文案只许进块、用 `t()` 取；顺带把旧的两条也搬进来，净把该棘轮往下压。
        'wb.prompt.byGenre': '随文类',
        'wb.prompt.l1': '- 结构门: {s} ｜ 引用格式: {c} ｜ 引用模式（= 交付形态）: {m}',
        'wb.prompt.l2': '- T9 视角: {t} ｜ 期刊匹配: {j}',
        'wb.prompt.n1': '说明：① 我**没有**发送本消息之外的任何指令，请你先给 Phase 0 确认单草案；',
        'wb.prompt.n2': '② 未经我确认不要启动 Phase 1，也不要 spawn 子代理或写 run/ 之外的文件。',
        // v19.6.7（授权串文案对齐批）：旧文案「③ 上面 `外部服务授权` 一行的 `推理=` 请按本会话实际位置填」
        //   有两处病灶——①「上面」在**面板**语境里指向表单（表单里根本没有那一行），主人据此读成「表单漏项」；
        //   ② 没写「这项面板填不出来」。现明写「面板不设控件，由你（主控）填」并把落点（简报头部）写出来。
        'wb.prompt.n3': '③ 授权串的 `推理=` **面板不设控件**——由你按**本会话实际**位置填（`远程 provider 名` / `本地 Ollama`），并写进 `01-任务简报.md` 头部，**不得把尖括号原样落盘**——交付前 `handoff-check --role T8 --require-gates` 的 A11 会核这条串，缺段或留 `<…>` 判硬 21；`脱敏=` 亦可由同文件独立的 `ETHICS=` 行承载。',
        // v19.6.6（素材池可见性批）：补**池的位置与定档前置**——档 B 此前只讲「怎么派发」，
        //   不讲「池在哪、有没有存货」，主人无法判断这一档能不能用（v19.4.1 已禁表单体内说明行，
        //   故显形走**开场白**这条既有通道；元素树断言见 tests/panel.test.mjs:935-942）。
        // v19.6.7（授权串文案对齐批）：**拆题**——④ 只讲「池在哪 / 两条素材路」，定档前置另立 ⑤。
        //   旧文案把六件事挤在一条（≈330 汉字），且「先看 `POOL=` 行再定档」与表单「检索范围必填」
        //   构成次序冲突（主人已在表单里选完档，才被告知要先看池）；B 轨旧文案还只写了清单文件，
        //   漏掉材料实际落点 `materials/`（真源 = `_shared/素材池.md` §11.1 表、`任务简报-template.md`）。
        'wb.prompt.n4': '④ 若 `检索=` 为「仅本地素材 / 仅项目素材 / 仅素材池」任一本地档：T1/T2/T3 **不得调用任何网络检索工具**，合法来源与 A/B 轨口径按 `references/_shared/素材池.md` §11 执行（**不外网 ≠ 零外发**——大模型推理仍读全文，这也是上一行必须有 `推理=` 段的原因）。',
        'wb.prompt.n5': '⑤ 选本地档前先看简报 `POOL=` 行：**该档合法来源为空 ⇒ 本地档不适用**，须停手带三选一问主人（① 改档 A ② 先投喂/放池 ③ 显式接受受限证据面），**不得代选**；派 T1/T2/T3 时按 `references/_shared/素材池.md` **§11.2** 逐字追加（材料不足照实报缺口），三角色**一个都不减**。',
        'wb.prompt.styleAuto': '- 风格基线: 自动（读 ~/.lunheng/style-baseline/{g}/，目录空则仅按文风档位）',
        'wb.prompt.styleOff': '- 风格基线: 关',
        'wb.ph.topic': '定题',
        'wb.ph.search': '检索',
        'wb.ph.analysis': '分析',
        'wb.ph.writing': '写作',
        'wb.ph.audit': '审计',
        'wb.ph.final': '终检',
        'wb.ph.failShort': '进度读取失败（悬停看原因）',
        'wb.proj.sel': '切换项目（本会话在看哪一单）',
        'wb.ph.failAt': '快照读取失败（读面不可用？）——进度无法显示，不猜。（试过：{root} / {proj}）',
        'wb.ph.defaultRoot': '默认根',
        'wb.ph.hint': '判据 = status.md + agents-log.md 的 Tn 留痕 + final/定稿.md；**闸门记录与卡片条目数未纳入**（本试点不扩读面）。',
        // ⚠️ v19.5.0（T7 反哺批 · §四.18「卡在哪一步」）：主人要的是**收起态也能看见**「当前 Phase +
        //   上次更新时刻 + 是否在等主人」三项。六块 phase chips 只回答第一项，故标题栏同排补两格
        //   （等待态 / 更新时刻）。口径 = **字面投影**：不解析 status.md 的语义，宁可漏报不误报。
        'wb.ph.ownerWait': '⏳ 等主人',
        'wb.ph.ownerNone': '✅ 无待主人项',
        'wb.ph.updated': '更新 {t}',
        'wb.ph.ownerHint': '是否在等主人：只按 status.md 的行做**字面**投影（命中「待/等主人」等形态，或人在环门行未标 ✅/Done），不解析语义——自由散文式状态可能判不出，宁可漏报。',
        'wb.ph.updHint': '上次更新时刻 = status.md 的最后修改时间（**不用启动时间冒充进度**）。',
        'wb.journal.none': '（不指定）',
        'wb.journal.cn': '中文（CSSCI/北大核心）',
        'wb.journal.en': '英文（SSCI）',
        'wb.journal.custom': '其他（手填）',
        'wb.journal.customPh': '例：管理世界 / Nature Energy',
      },
      en: {
        'panel.label': 'Lunheng Runs',
        'panel.title': 'Lunheng run panel',
        'panel.rightbarTitle': 'Lunheng Runs',
        'panel.rightbarGuide': 'Live phases, roles, gates and artifacts of run/<project>',
        'panel.rightbarBtn': 'Open in right bar (if supported)',
        'panel.readonly': 'Read-only: data comes from the host-side /lunheng-panel (no file writes, no subprocesses, no credentials). Full chart report:',
        'panel.figRecon': 'Figure reconciliation: ',
        'panel.figMissing': 'Missing slots (declared in the draft, no matching file under final/图件):',
        'panel.figSlot': '· Fig ',
        'panel.figHowTo': 'Fix: in Phase 4.5 copy the matching chart type from references/templates/图表-SVG-template.md into final/图件 (values must come from the draft / data card).',
        'panel.figReasonFrom': 'No-figure reason (from {src}): {text}',
        'panel.figNoReason': 'This project has 0 slots and 0 figures, but the delivery note records no reason — state why it has no figures in the 图件 row of final/交付说明.md.',
        'panel.figExtras': 'Non-body figures (cover / appendix, not counted as slots):',
        'panel.mgRerun': 'The sidecar has no per-gate results. Re-run once to fill them in:',
        'panel.mgLegacy': '⚠ This project\'s M-gate report yields **no per-gate details** (a legacy format without a results[] array, or that field cannot be parsed), so **re-running run-report will not add them** — it just re-reads the same old report. Either re-run the M gate with the current m-gate-check to produce a new-format report, or accept summary-only numbers.',
        'panel.mgNoReport': 'This project has no M-gate report (final/M-Gate-Report.json or audits/M-Gate-Report-v*.json) — run m-gate-check in T7 / T8 first; without it the sidecar has no mechanical evidence to show.',
        'panel.mgRerunNote': 'The delivery-time M-gate report has **no per-gate details** (legacy format without results[]) or **no report at all**. Below is a **re-run with the current m-gate-check** — **for reference only; it does not change the delivery verdict**: the gate had 13 items back then and the rules were looser, so under today\'s 24-item rules most old projects show P0/warnings (the card-index hard format, the 12 delivery-note fields and full G0–G14 coverage were all introduced after those reports were written).',
        'panel.mgRerunMeta': 'Re-run {at} ago ｜ exit {exit} ｜ P0 {p0} · P1 {p1} · P2 {p2} ｜ pass {pass}/{total} ｜ source: {rel}',
        'panel.mgSumRerunOnly': 'No usable delivery-time M-gate summary (no report in the project). The "M-gate items" card below shows a **current-rule re-run** — **not the delivery verdict**.',
        // v19.5.0 (T7 feedback N-11): "where is it stuck" for the owner — current Phase sits in the KPI row, this group carries "waiting / last update".
        'panel.status.waitUpdate': 'Waiting / update',
        'panel.status.waiting': '⏳ Waiting for owner',
        'panel.status.waitingAt': '(status.md line ',
        'panel.status.waitingHits': ' — ',
        'panel.status.waitingHitsTail': ' sites',
        'panel.status.none': '✅ Nothing awaits the owner',
        'panel.status.lastUpdate': '  ·  last update ',
        'seat.dock.on': 'Kickoff = registered (above the composer · conversation.input.dock)',
        'seat.dock.off': 'Kickoff = not registered (this client has no conversation.input.dock seat)',
        'wb.btn.open': 'Open',
        'wb.btn.close': 'Collapse',
        'wb.title': 'Lunheng kickoff',
        'wb.sub': 'Fills a structured kickoff prompt into the composer; it is **never auto-sent** — Phase 0 starts only after your confirmation.',
        'wb.sec1': 'Basics',
        'wb.sec2': 'Project materials & evidence pool',
        // v19.6.7: mirror of the zh section title — the segment name stays Chinese (`推理=`) because the
        //   generated authorisation string is language-independent; writing "inference" here would name a
        //   segment that does not exist anywhere in the mechanism.
        'wb.sec3': 'Outbound authorisation (retrieval / anonymisation; 推理 = session-decided) & human-in-the-loop',
        'wb.sec4': 'Advanced (optional; blank = follow genre preset)',
        'wb.req': 'required',
        'wb.opt': 'optional',
        'wb.f.title': 'Title (max 25 chars)',
        'wb.f.project': 'Project name',
        'wb.f.projectPh': '1-32 chars: CJK / letters / digits / - / _ (creates run/<name>/)',
        'wb.f.genre': 'Genre (scenario preset)',
        'wb.f.words': 'Word limit',
        'wb.f.lang': 'Language',
        'wb.f.tone': 'Tone',
        'wb.f.styleBaseline': 'Style baseline',
        'wb.f.mask': 'Anonymisation level',
        'wb.f.materials': 'Fed-in materials',
        'wb.f.materialsPh': 'The browser cannot read your disk: copy files into the workspace, then list their names/paths here',
        'wb.poolNote': 'The evidence pool is shared long-term material for all projects, at <workspace root>/evidence-pool/ (sibling of run/, lazily created on first query). Put public material originals into evidence-pool/raw/{books,datasets,papers,misc}/; Phase 5 extracts them into cards for reuse.',
        'wb.f.scope': 'Retrieval scope',
        'wb.f.hitl': 'Human in the loop (OOH)',
        'wb.f.brief': 'Research question / writing notes',
        'wb.f.citeStyle': 'Citation style',
        'wb.f.citeMode': 'Citation mode (= delivery form)',
        'wb.f.journal': 'Journal match',
        // v19.4.0 (owner ruling 2026-10-13): neither `quality` nor `rescan` appears in the panel —
        //   the former is not a panel-level switch (its real carrier is the Phase 0 confirmation sheet
        //   T9/G14 switch cell); the latter covered two different things and implied a third default.
        'wb.f.targetJournal': 'Target journal',
        'wb.follow': 'Follow genre',
        'wb.fill': 'Build prompt and fill composer',
        'wb.fillLast': '↺ Fill last config',
        'wb.clear': 'Clear',
        'wb.adv': 'Show advanced',
        'wb.advHide': 'Hide advanced',
        'wb.preview': 'Prompt preview',
        'wb.copy': 'Copy',
        'wb.copied': 'Copied',
        'wb.previewEmpty': '(fill title and project name to preview the kickoff prompt)',
        'wb.channel.inputActions': 'Filled into the composer (slot channel inputActions.setDraft)',
        'wb.channel.none': 'No write channel found: this client exposes no inputActions — copy the prompt below manually.',
        'wb.need.title': 'Title is required',
        'wb.need.project': 'Project name is required',
        'wb.need.projectChars': 'Project name allows CJK / letters / digits / - / _ , length 1-32',
        'wb.need.retrieval': 'Retrieval scope must be chosen explicitly',
        'wb.charts': 'Figures',
        'wb.chartsOn': 'Generate',
        'wb.chartsOff': 'Skip',
        'wb.custom': 'Custom (no preset)',
        'wb.empty': '(none)',
        'wb.lastFilled': 'Last config restored',
        'wb.previewHint': 'Preview above; fills the composer only, **never auto-sends**',
        // v19.4.0: the four opening-prompt disciplines moved from code literals into L10N (see the zh note).
        'wb.prompt.byGenre': 'from genre',
        'wb.prompt.l1': '- Structure gate: {s} | Citation style: {c} | Citation mode (= delivery form): {m}',
        'wb.prompt.l2': '- T9 review depth: {t} | Journal match: {j}',
        'wb.prompt.n1': 'Notes: (1) I have sent no instruction other than this message — start by giving me a draft Phase 0 confirmation sheet;',
        'wb.prompt.n2': '(2) do not start Phase 1 and do not spawn sub-agents or write files outside run/ until I confirm.',
        // v19.6.7（授权串文案对齐批 · 本批唯一的实质缺陷）：旧文案写的是 `inference=`，而 buildPrompt
        //   生成的三段名**恒为中文**（`检索=` / `推理=` / `脱敏=`，与 locale 无关），A11 也只认 `/推理\s*=/`
        //   （`scripts/handoff-check.mjs`）——照英文说明「改写段名」即判缺段、交付前 exit 21。
        'wb.prompt.n3': '(3) The `推理=` segment of the authorisation string has **no panel control** — fill it yourself with THIS session\'s real location (`远程 provider 名` / `本地 Ollama`) and write it into the head of `01-任务简报.md`; never leave the angle brackets in place. The A11 check in `handoff-check --role T8 --require-gates` verifies that string before delivery, and a missing segment or a leftover `<...>` is a hard 21. The `脱敏=` segment may also be carried by the separate `ETHICS=` line in the same file.',
        // v19.6.7: split of the old single n4 — n4 keeps "where the pool is / the two material tracks",
        //   n5 takes the tier-B gating (POOL= line, three-way choice back to the owner, dispatch wording).
        'wb.prompt.n4': '(4) If `检索=` is any local tier (`仅本地素材` / `仅项目素材` / `仅素材池`): T1/T2/T3 **may not call any online retrieval tool**; the legal sources and the A/B track rules follow `references/_shared/素材池.md` §11 (staying offline ≠ sending nothing — inference still reads the full text, which is why the line above must carry a `推理=` segment).',
        'wb.prompt.n5': '(5) Before picking a local tier, read the briefing `POOL=` line: **an empty legal source for that tier means the local tier does not apply** — stop and come back to the owner with the three-way choice (① switch to tier A ② feed the pool or materials first ③ explicitly accept a restricted evidence base); do not decide for them. When dispatching T1/T2/T3, append the verbatim wording from `references/_shared/素材池.md` **§11.2** (report gaps honestly), and keep all three roles.',
        'wb.prompt.styleAuto': '- Style baseline: auto (read ~/.lunheng/style-baseline/{g}/, empty dir falls back to tone tier only)',
        'wb.prompt.styleOff': '- Style baseline: off',
        'wb.ph.topic': 'Topic',
        'wb.ph.search': 'Retrieval',
        'wb.ph.analysis': 'Analysis',
        'wb.ph.writing': 'Writing',
        'wb.ph.audit': 'Audit',
        'wb.ph.final': 'Final check',
        'wb.ph.failShort': 'Progress unavailable (hover for the reason)',
        'wb.proj.sel': 'Switch project (which one this session is watching)',
        'wb.ph.failAt': 'Snapshot failed (read face unavailable?) — progress is not shown rather than guessed. (tried: {root} / {proj})',
        'wb.ph.defaultRoot': 'default root',
        'wb.ph.hint': 'Evidence = status.md + Tn traces in agents-log.md + final/定稿.md; **gate records and card counts are not covered** (this pilot adds no read surface).',
        // v19.5.0（T7 back-feed · §四.18）：the collapsed header must also show "where it is stuck" —
        //   waiting-state and last-update chips, sourced from the same status.md read face (literal projection).
        'wb.ph.ownerWait': '⏳ Waiting for owner',
        'wb.ph.ownerNone': '✅ Nothing waiting',
        'wb.ph.updated': 'updated {t}',
        'wb.ph.ownerHint': 'Whether the owner is being waited on: a **literal** projection of status.md lines (waiting markers, or an in-the-loop gate line without ✅/Done). Semantics are not parsed — free-prose status files may read as no-wait; under-reporting is preferred.',
        'wb.ph.updHint': 'Last update = status.md mtime (**never the start time pretending to be progress**).',
        'wb.journal.none': '(unspecified)',
        'wb.journal.cn': 'Chinese (CSSCI / Peking core)',
        'wb.journal.en': 'English (SSCI)',
        'wb.journal.custom': 'Other (type it)',
        'wb.journal.customPh': 'e.g. 管理世界 / Nature Energy',
      },
    };
    // ══ L10N:END ════════════════════════════════════════════════════════════════════════════

    // ── 宿主 locale 桥（v19.0.0 §4.4）───────────────────────────────────────────────────────
    // 接法：**运行时探测** `ctx.get('locale')`（不改 `exports.inject`）；缺席即降级为内置字典。
    //   两条硬经验（dsh-research 的 locale.ts 踩过，逐字记录）：① 缺席必须兜底、不得阻断渲染；
    //   ② 裸方法引用会丢 `this` —— 这里一律经闭包调用 `svc.xxx()`，不把方法摘下来传。
    var LOCALE = { svc: null, tr: null, active: 'zh', rev: 0, subs: [], err: null };
    function dictOf(loc) { return L10N[loc] || L10N.zh; }
    function t(key) {
      var host = null;
      if (LOCALE.tr) { try { host = LOCALE.tr(key); } catch (e) { host = null; } }
      if (typeof host === 'string' && host !== '' && host !== key) return host;
      var d = dictOf(LOCALE.active);
      return (d && d[key]) || L10N.zh[key] || key;
    }
    function installLocale(ctx) {
      var svc = null;
      try { svc = (ctx && ctx.get) ? ctx.get('locale') : null; } catch (e) { svc = null; }
      if (!svc) return;   // 缺席降级：内置字典照常工作
      LOCALE.svc = svc;
      try {
        if (typeof svc.register === 'function') { svc.register(NS, 'zh', L10N.zh); svc.register(NS, 'en', L10N.en); }
        if (typeof svc.bind === 'function') LOCALE.tr = svc.bind(NS);
        if (typeof svc.getLocale === 'function') { var s0 = svc.getLocale(); if (s0 && s0.active) LOCALE.active = String(s0.active); }
        if (typeof svc.subscribe === 'function') {
          svc.subscribe(function () {
            try { var s1 = svc.getLocale(); if (s1 && s1.active) LOCALE.active = String(s1.active); } catch (e) { /* 保留旧值 */ }
            LOCALE.rev++;
            for (var i = 0; i < LOCALE.subs.length; i++) { try { LOCALE.subs[i](); } catch (e) { /* 单个订阅者失败不影响其余 */ } }
          });
        }
      } catch (e) { LOCALE.err = (e && e.message) ? e.message : String(e); }
    }
    /** 语言切换后重渲染（官方契约：订阅走 subscribe，快照读 getLocale；本包不用 uSES）。 */
    function useLocaleTick() {
      var pair = react.useState(LOCALE.rev);
      react.useEffect(function () {
        var fn = function () { pair[1](LOCALE.rev); };
        LOCALE.subs.push(fn);
        return function () { var i = LOCALE.subs.indexOf(fn); if (i >= 0) LOCALE.subs.splice(i, 1); };
      }, []);
      return pair[0];
    }

    // ── 文类档案（工作台下拉的数据面）───────────────────────────────────────────────────────
    // ══ DATA:BEGIN ══（**派生数据副本区**：受机检逐列对账，**不计入文案棘轮**——数据不是文案）
    // **真源 = `references/_shared/文类档案.md` 的 12 行表**；此处是**受机检钉住的派生副本**
    //   （`tests/panel.test.mjs` 逐列回读该表并 deepEqual —— 表改了而此处没跟，测试当场红）。
    //   为什么不做 host 派生端点：那会新增一条读面（要同步 SECURITY 与词预算），而本表稳定且只有 12 行；
    //   若将来列数增长，再换成端点更划算（记在落地报告 §5 边界）。
    var GENRES = [
      { code: 'kaiti', scene: '学位论文/期刊长文的开题报告', cite: 'GB/T 7714', structure: '开题九节', t9: '单视角', journal: '关闭', minLit: 10, sections: '3 节' },
      { code: 'academic-cn', scene: '期刊投稿（社科实证）', cite: 'GB/T 7714', structure: 'IMRaD', t9: '三视角', journal: '默认启用', minLit: 3, sections: '9 节' },
      { code: 'academic-hum', scene: '期刊投稿（人文/理论）', cite: 'GB/T 7714', structure: 'IMRaD-Alternate', t9: '三视角', journal: '默认启用', minLit: 3, sections: '9 节' },
      { code: 'academic-case', scene: '案例研究型 / 质性论文', cite: 'GB/T 7714', structure: 'IMRaD＋识别策略', t9: '三视角', journal: '默认启用', minLit: 3, sections: '9 节' },
      { code: 'course', scene: '课程论文 / 学位论文章节', cite: 'GB/T / APA', structure: 'IMRaD', t9: '单视角', journal: '关闭', minLit: 3, sections: '9 节' },
      { code: 'lit-review', scene: '研究述评 / 综述 / 年度盘点', cite: 'GB/T / APA', structure: 'IMRaD-Alternate', t9: '三视角', journal: '可选', minLit: 3, sections: '9 节' },
      { code: 'book-review', scene: '学术书评（长，≥3000 字）', cite: 'GB/T / 内联', structure: 'Alternate / 不跑', t9: '单视角', journal: '关闭', minLit: 2, sections: '5 节' },
      { code: 'policy', scene: '政策分析报告 / 咨政报告', cite: 'GB/T 或简化内联', structure: 'IMRaD-Alternate', t9: '单视角', journal: '关闭', minLit: 2, sections: '5 节' },
      { code: 'report-3rd', scene: '第三方研究报告 / 独立白皮书', cite: '内联', structure: '不跑（记 N/A）', t9: '单视角', journal: '关闭', minLit: 1, sections: '5 节' },
      { code: 'biz-review', scene: '商业评论', cite: '内联', structure: '不跑（记 N/A）', t9: '单视角', journal: '关闭', minLit: 1, sections: '5 节' },
      { code: 'industry', scene: '行业分析', cite: '内联', structure: '不跑（记 N/A）', t9: '单视角', journal: '关闭', minLit: 2, sections: '5 节' },
      { code: 'wechat', scene: '公众号深度长文', cite: '内联', structure: '不跑（记 N/A）', t9: '单视角', journal: '关闭', minLit: 1, sections: '5 节' },
    ];
    function genreOf(code) { for (var i = 0; i < GENRES.length; i++) if (GENRES[i].code === code) return GENRES[i]; return null; }

    // v19.4.0（主人 2026-10-13 授权）：**「结构门 / T9 视角」改为文类派生值**（面板只读展示）。
    //   真源 = `references/_shared/文类档案.md` 的「结构门」「T9 视角」两列；本表同名列是它的**受机检钉住的
    //   派生副本**（`tests/panel.test.mjs` 逐行回读 deepEqual）。旧版把这两项做成**可自由选择的下拉**，
    //   等于在真源之外造第二个真值来源 ⇒ 面板选的档与主控按档案展开的档可以不一致，且没有任何仲裁规则。
    //   自定义文类（`genre === ''`）无派生值 ⇒ 留空，语义 = 「跟随文类」，由主控在 Phase 0 定档。
    function applyDerived(f) {
      var g = genreOf(f.genre || '');
      f.structure = g ? (g.structure || '') : '';
      f.t9 = g ? (g.t9 || '') : '';
      return f;
    }

    // 期刊库（工作台「目标期刊」下拉的数据面）——**与 GENRES 同规**：真源 = `references/_shared/期刊数据库.md`
    // 的 §一（中文，28）/ §二（英文，12）两张表；此处是**受机检钉住的派生副本**（测试逐行回读并 deepEqual，
    // 行数不足即判「派生源形变」）。只带**期刊名**（下拉需要的全部）；类别/审稿周期等留在真源，由主控按需读。
    var JOURNALS_CN = [
      '管理世界', '经济研究', '中国工业经济', '南开管理评论', '管理评论', '装饰', '家具与室内装饰', '建筑学报',
      '城市规划', '中国社会科学', '社会学研究', '法学研究', '新闻与传播研究', '国际新闻界', '中国行政管理',
      '公共管理学报', '教育研究', '高等教育研究', '中国高教研究', '中国电化教育', '电化教育研究', '开放教育研究',
      '心理学报', '哲学研究', '历史研究', '文学评论', '文艺研究', '学术月刊',
    ];
    var JOURNALS_EN = [
      'Administrative Science Quarterly (ASQ)', 'Academy of Management Journal (AMJ)', 'Academy of Management Review (AMR)',
      'Strategic Management Journal (SMJ)', 'Organization Science', 'Journal of Applied Psychology',
      'American Journal of Sociology', 'American Sociological Review', 'Journal of Marketing',
      'Journal of Consumer Research', 'American Economic Review', 'Strategic Entrepreneurship Journal',
    ];
    var JOURNAL_CUSTOM = '__custom';

    // ── 开工台字段模型（v19.0.0 §4.2；字段集参照主人另一项目 yily web 面板的「新建项目」）──────
    // 论衡化改动：① 增 `project`（论衡没有服务端 project_id，`run/<项目名>/` 必须主人给）；
    //   ② 增 `root`（复用面板已选工作区根）；③ 删「运行后端」（论衡是纯 skill，无此概念）；
    //   ④ 「交互模式」不做开关 —— 论衡四门（P0/P2.5/P3.5/P5）**不设可省任一门**，做成开关反而诱导绕过。
    // v19.4.0（主人显式授权批 · §4 三控件统一口径）：**旧的 `consent` 4 选 1 拆成三个正交面**。
    //   为什么拆：原件把「检索范围 / 脱敏档 / 推理位置 / SVG 与文生图」四件不同的事压进一个 4 选 1，
    //   于是任何选择都在暗示别的事也跟着变（实测：选「脱敏+SVG+本地」被读成「不外发 = 不联网检索」，
    //   二者其实无关）。拆开后每一面只有它自己的语义，且三段合成 `01-任务简报.md` 头部的**一条三段式
    //   授权串**（`检索=` / `推理=` / `脱敏=`），由机检 **A11** 核（`handoff-check --require-gates`）。
    //   ① **检索范围**：唯一「真的改变流水线行为」的一档——档 B 关掉外部检索工具，只吃池 + 投喂
    //      （真源 `references/_shared/素材池.md` §十一）；取值**逐字**用模板受控词。
    //   ② **脱敏档**：`basic` 是 H2 的恒定档、`strict` 才是真选项（同源 `ETHICS=`）。
    //   ③ **推理位置**：面板**不给开关、也不回显**——它由会话 provider 决定，不是主人的选题；
//      v19.4.1（主人裁定「只读和默认的部分去掉」）连只读徽标一并撤除，只在开场白里留占位符
//      ＋ 末段第 ③ 条例律逼主控按**本会话实际**落实后再落盘（A11 对 `<…>` 残留判硬 21）。
    var WB_RETRIEVAL = ['全网检索', '仅本地素材', '仅项目素材', '仅素材池'];
    // 风格基线（v19.9.x 反哺）：开关二态「自动/关」，默认自动——自动 = 读该文类公共语料目录
    //   `~/.lunheng/style-baseline/<文类>/`，目录空则退回只按文风档位。值是受控词（进开场白）。
    var WB_STYLE_BASELINE = ['自动', '关'];
    var WB_MASK = ['basic', 'strict'];
    // **受控词表**，逐字对齐 `references/templates/任务简报-template.md` 的 `**语言**：中文 / English / 中英混`。
    //   旧档 `['zh','en']` 两头都对不上：模板认「中文」，且旧档**缺「中英混」**。`lang=en` 还有连环后果——
    //   `scripts/count-chars.mjs` 只数 `\u4E00–\u9FFF`，英文稿 hanChars=0 必触发字数门的 P0「不足 >10%」。
    var WB_LANG = ['中文', 'English', '中英混'];
    var WB_STRUCTURE = ['', 'IMRaD', 'IMRaD-Alternate', 'IMRaD＋识别策略'];
    var WB_CITE_STYLE = ['', 'gbt', 'apa'];
    var WB_CITE_MODE = ['', '编号', '内联'];
    var WB_T9 = ['', '三视角', '单视角'];
    // ⚠️ v19.4.0 订正（同日第二次复核，推翻本批先前的错判）：**三档都是真源取值**，不得删「可选」。
    //   `references/_shared/文类档案.md:14` 的「期刊匹配」列实测取值 = `默认启用`（`:17-19` 三个学术文类）
    //   / **`可选`（`:20` lit-review：`… | 三视角 | B 轨 | 可选 | 3`）** / `关闭`（其余）；本文件 `:324`
    //   的 `GENRES` 对账表同样写 `lit-review → journal: '可选'`，且被 `tests/panel.test.mjs` 逐行钉住。
    //   本批先前写成「该档真源没有」并据此删档，是**只扫了一部分行**得出的假陈述，已回滚。
    //   覆盖本身是合法的（`:65`「主人可当场改任一项，变更即留痕」）；真载体见 `WB_DEFAULT` 上方注释。
    var WB_JOURNAL = ['', '默认启用', '可选', '关闭'];
    // v19.4.0（主人裁决）：`WB_QUALITY` / `WB_RESCAN` **两个枚举连同字段一起删**，理由见 `WB_DEFAULT` 上方注释。
    // ── 六块进度（v19.1.0 试点）────────────────────────────────────────────────────────────
    // **粗分组**，不是 Phase 数量（真源流水线有 15 个节点，见 `pipeline-readme.md` §流水线全景）——
    //   块界刻意落在两道主控闸门上：②｜**T2.5**｜③ 与 ⑤｜**T7.5**｜⑥。
    // 判据**全部取自面板既有只读快照**（`/lunheng-panel/snapshot` 的 `status` / `agents.roles` / `artifacts`），
    //   **本试点刻意不扩读面**（扩读面要动 SECURITY 与词预算）。
    //   未纳入的判据（如实显示为「未纳入」而不是假装知道）：两道闸门记录 `audits/闸门记录-T2.5|T7.5.md`、
    //   卡片条目数（要加须另批扩读面）。
    var PHASES = [
      { id: 'topic', roles: [], final: false },                       // ① 判据：status.md 已建
      { id: 'search', roles: ['T1', 'T2', 'T3'], final: false },      // ② 三检索员
      { id: 'analysis', roles: ['T4'], final: false },                // ③ 分析员
      { id: 'writing', roles: ['T5'], final: false, drafts: true },   // ④ 写手（或已有初稿文件）
      { id: 'audit', roles: ['T7'], final: false, extra: ['T6'] },    // ⑤ 审计员（T6 批判属 Phase 3.6，只展示不计分）
      { id: 'final', roles: ['T8'], final: true },                    // ⑥ 终检（判据：final/定稿.md 存在）
    ];
    // ── 人在环（OOH）选项（v19.1.7，主人指令新增）────────────────────────────────────────────
    // 值与提示都是**要写进开场白的机器可读文本** ⇒ 放 DATA 区（同「数据不是文案」的分治）。
    // **真源 = `SKILL.md` §人在环四节点 + `pipeline-readme.md` 的「四门「必须」（L-08）」**：
    //   P0 定题 / P2.5 大纲 / P3.5 洞察 / P5 终稿，机制原文是「全部必需、**不设可省任一门**」。
    // 故「全自动」在本包里的表述是**主人显式授权例外**（不谎称机制已改），且**有确定的替代规则**：
    //   机制已规定四门统一用 `ask_user_question` 提问、**首个选项 = 主控建议并标「（推荐）」**
    //   ⇒ 全自动 = **直接采用各门的首个推荐项**（主人 2026-10-12 原话：「部分决策按 AI 推荐即可」），
    //   并把逐门替你做的选择写进交付说明（留痕可查）。P0 开工确认仍保留（同意项与项目名的围栏依赖它）。
    // 测试把四个节点名**双向钉**在真源上（真源改词也红）。
    var WB_HITL = ['四门必须', '全自动'];
    var WB_HITL_LABEL = '- 人在环: ';
    var WB_HITL_FOUR = '（P0 定题 / P2.5 大纲 / P3.5 洞察 / P5 终稿，逐门等主人过目）';
    var WB_HITL_AUTO = '（**主人显式授权**：不再逐门提问，**直接采用各门 `ask_user_question` 的首个推荐项**继续——P2.5 大纲 / P3.5 洞察 / P5 终稿三门均按主控建议自决；仅保留 P0 开工确认；请把逐门替你做的选择写进交付说明，便于回溯）';
    // ══ DATA:END ══（本块 = **派生数据 / 枚举值**：文类档案表、期刊库、各字段的选项值。
    //   它们是**要与流水线对齐的机器可读取值**（主控按字面识别），不是 UI 文案 ⇒ 不进文案棘轮；
    //   正确约束是逐行对账（见 `tests/panel.test.mjs` 的文类表/期刊库两条用例）。）
    // v19.4.0（主人显式授权批）：① `lang` 取值改**受控词表**「中文／English／中英混」——与任务简报模板
    //   `**语言**：中文 / English / 中英混` 逐字一致（旧值 `zh`/`en` 两头都对不上，且旧档**缺「中英混」**）；
    //   ② `charts` 默认改 **false**——机制原文是「配图**默认关闭**，不得因此判失败」（`M-Gate-Algorithm.md`），
    //   旧默认 true 与真源相反；③ 删死字段 `root`（工作区根**只能**是会话工作区根，见 `SKILL.md`）与
    //   `minLit`（脚本只读 `--genre` 对应的 `GENRE_MIN_L`，本字段全库零消费者）。
    // v19.4.0（主人 2026-10-13 裁决 · 同批追加）：**`quality` / `rescan` 两字段删除**。这两个字段此前被记为
    //   「零消费者」，**该定性是错的**——复核真源后确认它们是**文类档案两列的 Phase-0 覆盖 UI**
    //   （`references/_shared/文类档案.md:14` 表头含 `--qlt` / `补扫` 两列，`:17-19` 三个
    //   学术文类预置一律 `on` / `默认即跑`）。真正的病灶是**双真源 + 无仲裁 + 表单值到不了真载体**：
    //   ⚠️ **同日第二次复核的订正**：`journal`（期刊匹配）**不在删除之列**——本批先前把它一起记为「零消费者」、
    //      还删了它的「可选」档，两处都是错的。① 值域：`文类档案.md:21` 的 `lit-review` 行**就是 `可选`**；
    //      ② 机器载体：`scripts/_lib/mgate-gates/mexist-gates.mjs:872-895`（M-Exist-6）**确实读**它——
    //      优先级 = ① 审稿报告自述（`/启用期刊匹配|期刊匹配助手/`）→ ② 项目 `01-任务简报.md` 的
    //      `/启用期刊匹配/` 字面（`wantJournal`），命中且缺「综合匹配度」表即报 findings。故三档保留、字段保留。
    //   ① `quality`：真载体是**简报 `QLT=on`**（`templates/任务简报-template.md:124`；消费者 `scripts/g-audit-check.mjs:6-7`
    //      的 `--qlt`），它驱动的是 **G15-VolIssue**（卷期页码），**不是 G14**；而 G14 的真载体是
    //      **Phase 0 确认单的「T9·G14 开关」格**（`templates/主人确认-template.md:13`）。旧标签「质量门（G14 评分）」
    //      **双重失真**：G14 是二元闸（`gates/14-中文AI痕迹-gate.md:22` 可关闭、`:24-34` 8 类计数），
    //      而仓库明写**刻意不引入「AI 痕迹密度」分数**（`_shared/规范-机械门对照表.md:141`）。且这条「可关闭」
    //      已被误读一次（`audits/反哺报告-v7-不能评估的忠诚全流程.md:124`：T7 把能力说明当既成裁定）⇒
    //      **面板不该再添第三个落点**，故降为**只读提示**（见渲染层），字段本身删除。
    //   ② `rescan`：「补扫」在真源里指**两件不同的事**——简报 `:88` 投稿前最新进展补扫（**默认即跑**、非学术模式
    //      可取消）与简报 `:167-171` Phase 1.5 定向补检索（**默认「否」**）；表单一个「开启/关闭」盖了两件、
    //      还给第三种默认。两件各自的真源都在 ⇒ 字段删除，功能不丢。
    var WB_DEFAULT = { title: '', project: '', genre: '', words: 8000, lang: '中文', tone: '', styleBaseline: WB_STYLE_BASELINE[0], materials: '', retrieval: '全网检索', mask: 'basic', hitl: '', structure: '', citeStyle: '', citeMode: '', t9: '', journal: '', targetJournalPick: '', targetJournal: '', charts: false, brief: '' };
    var WB_PROJECT_RE = /^[\w\-一-鿿]{1,32}$/;

    /** 校验（返回 i18n 键或 null）。三处硬约束：项目名正则、题目必填、**检索范围必须显式选**。 */
    function wbValidate(f) {
      if (!String(f.title || '').trim()) return 'wb.need.title';
      var p = String(f.project || '').trim();
      if (!p) return 'wb.need.project';
      if (!WB_PROJECT_RE.test(p)) return 'wb.need.projectChars';
      // v19.4.0：必选项从「外发同意 4 选 1」换成「检索范围」——它才是三段式授权串里唯一会改变
      //   流水线行为的一段（档 B 关掉外部检索工具）；脱敏档有恒定缺省 `basic`，不必逼主人选。
      if (!f.retrieval) return 'wb.need.retrieval';
      return null;
    }

    /**
     * 开场白生成：**结构化 `- 键: 值` 块**（不是散文）。
     * 目的：让主控零歧义地把它照抄进 `阶段确认-Phase0.md` §6 与 `01-任务简报.md` 头部——
     *   散文式口述会丢字段，而 Phase 0 的字段各有下游机检（文类→11 项、同意→审计追溯、项目名→路径围栏）。
     * 末段写死两条纪律：不自动提交、先落盘再等确认（对齐 `SKILL.md` §触发：不得直接 spawn 或写文件）。
     */
    function buildPrompt(f) {
      var g = genreOf(f.genre);
      var kw = function (v) { return (v === '' || v === undefined || v === null) ? t('wb.follow') : String(v); };
      var out = [];
      out.push('请按论衡流水线开工。以下是 Phase 0 定题信息（结构化字段，请原样落到阶段确认单 §6 与任务简报头部）：');
      out.push('');
      out.push('- 项目名: ' + String(f.project).trim());
      // v19.4.0：标签从「题目」改「题名」——与简报的 `**题名**`（`templates/任务简报-template.md:127`，≤25 字、空 = T7 判 P2）
      //   同字面，主控照抄时不需要再猜「题目该落到 `**主题**`(:37) 还是 `**题名**`(:127)」。
      out.push('- 题名: ' + String(f.title).trim());
      out.push('- 文类: ' + (f.genre ? (f.genre + '（' + (g ? g.scene : '') + '）') : t('wb.custom')));
      // v19.4.0：标签改 `目标篇幅` 且用**全角冒号**——旧串 `- 篇幅上限: 8000 汉字` 过不了
      //   `scripts/_lib/target-chars.mjs:30` 的 `LINE_RE`（「上限」二字落在字段名与冒号之间），
      //   后果是 `apply-revision-cycle` / `apply-compression-cycle` **静默跳过 G8 字数硬阈且 exit 0**。
      out.push('- **目标篇幅**：' + f.words + ' 汉字');
      out.push('- 语言: ' + f.lang);
      out.push('- 文风: ' + kw(f.tone));
      out.push(f.styleBaseline === WB_STYLE_BASELINE[1] ? t('wb.prompt.styleOff') : t('wb.prompt.styleAuto').replace('{g}', f.genre || '<genre>'));
      // v19.4.0：旧的「外部检索范围：T1/T2/T3 三选」+「外发同意 4 选 1」两行**换成一条三段式授权串**。
      //   ① 它是机检 **A11** 的唯一机械落点（`handoff-check --require-gates` 读简报头部该行）；
      //   ② `推理=` 面板**填不出来**（由会话 provider 决定）⇒ 给占位符 + 末尾显式指令，逼主控落实后再落盘；
      //      A11 对 `<…>` 残留判硬 21（与 A7 §6 的 `<主人原话>` 同一条判据）。
      //   v19.6.7：占位符照旧，但说明 ③ 已明写「**面板不设控件**、由你填」——主人 2026-10-16 复核时正是
      //      因为旧文案只讲怎么填、不讲「这项不归面板」，把「表单里没有该项」读成了漏项。
      out.push('- 外部服务授权：检索=' + (f.retrieval || WB_RETRIEVAL[0])
        + ' / 推理=<按本会话实际填：远程 provider 名 或 本地 Ollama>'
        + ' / 脱敏=' + (f.mask || WB_MASK[0]));
      // 人在环（v19.1.7）：**必须显式写进开场白**——否则主控不知道该停几门（默认四门必须）。
      out.push(WB_HITL_LABEL + (f.hitl === WB_HITL[1] ? WB_HITL[1] + WB_HITL_AUTO : (f.hitl || WB_HITL[0]) + WB_HITL_FOUR));
      // v19.4.0：这两行的文案进 L10N（受 `tests/panel.test.mjs` 的「L10N 块外中文字面量只许降」棘轮约束），
      //   并把「结构门 / T9 视角」标成**随文类**——它们不是主人选的档，而是文类档案对应列的投影
      //   （`applyDerived`）。自定义文类无投影 ⇒ 回落 `kw()`，空值渲染为「跟随文类」。
      var byGenre = function (val) { return g ? (t('wb.prompt.byGenre') + '（' + g.code + '）= ' + val) : kw(val); };
      out.push(t('wb.prompt.l1').replace('{s}', byGenre(f.structure)).replace('{c}', kw(f.citeStyle)).replace('{m}', kw(f.citeMode)));
      out.push(t('wb.prompt.l2').replace('{t}', byGenre(f.t9)).replace('{j}', kw(f.journal)));
      // v19.4.0（主人 2026-10-13 裁决）：删「质量门 / 补扫」两段——它们的真载体**不在开场白里**
      //   （G14 开关在 Phase 0 确认单的「T9·G14 开关」格、补扫在简报 `:88` 与 `:167-171`），
      //   面板只留只读提示，不再往开场白里造第三个说法。
      out.push('- 图件: ' + (f.charts ? t('wb.chartsOn') : t('wb.chartsOff')));
      var jp = (f.targetJournalPick && f.targetJournalPick !== JOURNAL_CUSTOM)
        ? String(f.targetJournalPick)
        : String(f.targetJournal || '').trim();
      if (jp) out.push('- 目标期刊: ' + jp);
      if (String(f.materials || '').trim()) out.push('- 投喂材料（已在工作区内）: ' + String(f.materials).trim());
      if (String(f.brief || '').trim()) out.push('- 研究问题/写作要点: ' + String(f.brief).trim());
      out.push('');
      // v19.4.0：四条例律改由 `t()` 取——它们是**文案**，按 `tests/panel.test.mjs` §4.4 的棘轮口径
      //   （L10N 块外的中文字面量只许降）必须放进 L10N 块；旧版前两条留在代码里是历史欠账。
      // v19.6.7：五条（原四条 + 档 B 定档前置拆出的 ⑤）——同一条口径，全部走 `t()`；
      //   `tests/panel.test.mjs` 的 v19.6.7 用例钉住「段名必须用 `推理=`」「档 B 须写出 `materials/`」两条事实。
      out.push(t('wb.prompt.n1'));
      out.push(t('wb.prompt.n2'));
      out.push(t('wb.prompt.n3'));
      out.push(t('wb.prompt.n4'));
      out.push(t('wb.prompt.n5'));
      return out.join('\n');
    }

    /**
     * 六块进度（v19.1.0 试点）：**只读面板既有快照**，不新增读面、不猜、不美化。
     * 判据（每条都机械可核）：
     *   ① 定题 = `status.hasStatus`（status.md 已建）　　② 检索 = `agents-log.md` 里 T1/T2/T3 留痕数 / 3
     *   ③ 分析 = T4 留痕　　④ 写作 = T5 留痕 或 `artifacts.drafts > 0`
     *   ⑤ 审计 = T7 留痕（T6 批判一并展示、**不计入**完成度——它在 Phase 3.6）　　⑥ 终检 = `artifacts.hasFinal`
     * 返回每块 `{id, n, d, seen, extra}`：`n/d` = 命中的判据数 / 该块判据总数。
     * ⚠️ 刻意**不纳入**的判据（UI 上如实写「未纳入」，不假装知道）：两道闸门记录与卡片条目数——要加须另批扩读面。
     */
    function wbPhases(snap) {
      var s = snap || {};
      var st = s.status || {}, ar = s.artifacts || {};
      var counts = {};
      var roles = (s.agents && s.agents.roles) || [];
      for (var i = 0; i < roles.length; i++) { if (roles[i] && roles[i].role) counts[roles[i].role] = roles[i].count || 0; }
      var has = function (r) { return !!counts[r]; };
      return PHASES.map(function (p) {
        var seen = [], n = 0, j;
        if (p.id === 'topic') {
          if (st.hasStatus) n = 1;
        } else if (p.final) {
          if (ar.hasFinal) n = 1;
          if (has('T8')) seen.push('T8');
        } else {
          for (j = 0; j < p.roles.length; j++) { if (has(p.roles[j])) { seen.push(p.roles[j]); n++; } }
          if (p.drafts && n === 0 && (ar.drafts || 0) > 0) { n = 1; seen.push('drafts'); }
        }
        var extra = [];
        if (p.extra) { for (j = 0; j < p.extra.length; j++) { if (has(p.extra[j])) extra.push(p.extra[j]); } }
        return { id: p.id, n: n, d: p.roles.length || 1, seen: seen, extra: extra };
      });
    }

    /**
     * 把开场白送进输入框（v19.0.5 **通道收口**）：**只走席位标准通道 `props.inputActions.setDraft`**。
     * 依据（证据，不是风格偏好）：
     *   ① 开工台**只挂在 `conversation.input.dock` 一个席位**，而该席位契约就提供 `inputActions`——
     *      **主人真机回执已确认走的就是这条**（状态行原文：「已填入输入框（席位标准通道 inputActions.setDraft）」）。
     *   ② 旧版的第二通道是从**服务内部**取（`sessions.scope(id).get('conversation').input.for(actx)`）：
     *      **不是公开接缝**，且在那台宿主上**从未被走到**（首选通道一直命中）⇒ 属「猜出来的兼容层」，
     *      留着只有维护成本与静默腐坏风险（改版后它悄悄失效，而没人知道）。
     *   ③ 哪天真出现「席位不给 props」的情形，`wb.channel.none` 会**当场如实报缺**——这条自述本身就是诊断面，
     *      按它补通道即可，比现在预先猜一条更可靠。
     * 硬约束不变：**只 setDraft，绝不 submit**（Phase 0 必须人确认后才开工）。
     * 失败也如实：`setDraft` 抛错时把**错误原文**带进 `err`（不吞成「未找到通道」那种似是而非的说法）。
     */
    function pushDraft(props, text) {
      var ia = props && props.inputActions;
      if (ia && typeof ia.setDraft === 'function') {
        try { ia.setDraft(text); return { ok: true, channel: 'wb.channel.inputActions', err: null }; }
        catch (e) { return { ok: false, channel: 'wb.channel.none', err: (e && e.message) ? String(e.message) : 'setDraft threw' }; }
      }
      return { ok: false, channel: 'wb.channel.none', err: null };
    }
    // 实际落点（v18.90.0 自审修正 F1）：**如实记录**注册到了哪些座位。
    //   旧版用「seats 数组长度 > 1」猜座位，而数组里只会被压入 'main' → 无论右栏是否真的可用，
    //   面板都写「（右栏服务不可用）」——一句**不实自述**，正是本包最反感的那类呈现。
    var SEATS = { main: false, rightbar: false, dock: false, error: null, dockError: null };

    // ── 配色（v18.90.8）：**只用 DSH 语义 token**，不写颜色字面量、不做明暗分支 ───────────────
    // 官方口径（`docs/web-styling.zh.md`）：功能组件使用 `--dsw-alias-*` 语义 token，「不得复制静态色板值
    //   或在其中写入颜色字面量」「功能组件 CSS 不得包含主题选择器」；明暗偏好归 `ui-theme`，由 `ui-layout`
    //   把解析后的主题快照应用到文档 ⇒ 面板**随 DSH 主题自动切换，零 JS 分支**。
    // token 名可机械查得：`cordis_inspect_query client Theme.listTokens`（14 个 alias + sidebar fill，
    //   全部 `requiresLightAndDark: true`）。
    // 每个 token 带一个**浅色兜底值**：若宿主未定义该 token（极简客户端），退化成旧观感而不是变成不可读。
    var T = function (name, fallback) { return 'var(' + name + ', ' + fallback + ')'; };
    var S = {
      // v18.93.1：**基础文字色**——暗色主题下，未显式设色的文本必须继承 label-primary，
      //   否则会继承宿主/浏览器的默认黑（实测：题名 / 文类·目标 / 状态行 / 最近改动文件名在暗色下黑到看不见）。
      wrap: { className: 'lh-wrap', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'stretch', alignContent: 'flex-start', color: T('--dsw-alias-label-primary', '#1a202c'), font: '12.5px/1.6 "Segoe UI","Microsoft YaHei",system-ui,sans-serif', padding: '14px 16px', color: T('--dsw-alias-label-primary', '#1a202c'), boxSizing: 'border-box', maxWidth: '100%', minWidth: 0, height: '100%', maxHeight: '100vh', overflow: 'auto' },
      h1: { fontSize: '15px', fontWeight: 650, margin: '0 0 10px' },
      card: { flex: '1 1 460px', minWidth: 0, color: T('--dsw-alias-label-primary', '#1a202c'),  border: '0.5px solid ' + T('--dsw-alias-border-l1', '#e2e8f0'), borderRadius: '10px', padding: '8px 10px', marginBottom: '10px', background: T('--dsw-alias-bg-layer-1', '#ffffff'), boxSizing: 'border-box', maxWidth: '100%', minWidth: 0 },
      footer: { flex: '1 1 100%', marginTop: '2px', paddingTop: '8px', borderTop: '0.5px solid ' + T('--dsw-alias-border-l1', '#e4e7ec'), display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' },
      row: { display: 'flex', gap: '8px', alignItems: 'baseline', margin: '2px 0', flexWrap: 'wrap', minWidth: 0 },
      k: { color: T('--dsw-alias-label-secondary', '#4a5568'), minWidth: '84px' },
      mono: { fontFamily: 'ui-monospace,Consolas,monospace', fontSize: '11.5px' },
      dim: { color: T('--dsw-alias-label-secondary', '#718096'), fontSize: '11.5px' },
      badge: { display: 'inline-block', padding: '1px 7px', borderRadius: '999px', fontSize: '11px', border: '0.5px solid ' + T('--dsw-alias-border-l2', '#cbd5e0'), color: T('--dsw-alias-label-secondary', '#4a5568'), marginRight: '6px' },
      btn: { border: '0.5px solid ' + T('--dsw-alias-border-l1', '#cbd5e0'), background: T('--dsw-alias-bg-layer-2', '#f7fafc'), color: T('--dsw-alias-label-primary', '#1a202c'), borderRadius: '6px', padding: '3px 9px', cursor: 'pointer', fontSize: '12px' },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' },
      td: { borderBottom: '0.5px solid ' + T('--dsw-alias-border-l1', '#edf2f7'), padding: '3px 4px', textAlign: 'left' },
      ok: { color: T('--dsw-alias-state-success-primary', '#2f855a') },
      bad: { color: T('--dsw-alias-state-error-primary', '#c53030') },
      warn: { color: T('--dsw-alias-state-warn-primary', '#b7791f') },
      idle: { color: T('--dsw-alias-state-idle-primary', '#718096') },
      // v18.91.2：**不再用 brand-primary 当图表主色**——实测该 token 在本机主题里是「墨色」（近黑），全部变黑就是它。改用真正的状态色（明暗下都有色），品牌色只留给文字性强调。
      chart: T('--dsw-alias-state-success-primary', '#2f855a'),
      chart2: T('--dsw-alias-state-warn-primary', '#b54708'),
      tint: { background: T('--dsw-alias-bg-layer-2', '#fffaf0'), borderColor: T('--dsw-alias-state-warn-primary', '#fbd38d') },
      // ── 图形与信息层级（v18.91.0 起）───────────────────────────────────────────────
      cardTitle: { fontSize: '10.5px', letterSpacing: '0.06em', color: T('--dsw-alias-label-secondary', '#718096'), textTransform: 'uppercase', marginBottom: '4px' },
      kpiRow: { background: T('--dsw-alias-bg-layer-2', '#f7fafc'), borderRadius: '10px', padding: '6px', flex: '1 1 100%', display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' },
      kpi: { flex: '1 1 118px', minWidth: '112px', background: T('--dsw-alias-bg-layer-1', '#ffffff'), borderRadius: '10px', padding: '6px 9px' },
      kpiLabel: { fontSize: '11px', color: T('--dsw-alias-label-secondary', '#718096') },
      kpiValue: { fontSize: '16px', fontWeight: 700, lineHeight: 1.35, color: T('--dsw-alias-label-primary', '#1a202c') },
      barRow: { display: 'flex', alignItems: 'center', gap: '8px', margin: '2px 0', minWidth: 0 },
      barLabel: { flex: '0 1 84px', minWidth: 0, fontSize: '11.5px', color: T('--dsw-alias-label-secondary', '#4a5568'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      barTrack: { flex: '1 1 60px', minWidth: '40px', height: '9px', borderRadius: '999px', background: T('--dsw-alias-bg-layer-2', '#edf2f7'), overflow: 'hidden' },
      barFill: { display: 'block', height: '100%', borderRadius: '999px', background: T('--dsw-alias-state-success-primary', '#2f855a') },
      barValue: { flex: '0 0 auto', minWidth: '56px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '11.5px', color: T('--dsw-alias-label-primary', '#1a202c') },
      ribbon: { display: 'flex', gap: '3px', margin: '2px 0 5px' },
      seg: { flex: '1 1 0', textAlign: 'center', fontSize: '10.5px', padding: '3px 0', borderRadius: '5px', fontVariantNumeric: 'tabular-nums' },
      segDone: { background: T('--dsw-alias-state-success-primary', '#2f855a'), color: T('--dsw-alias-bg-layer-1', '#ffffff') },
      segNow: { background: T('--dsw-alias-state-warn-primary', '#b54708'), color: T('--dsw-alias-bg-layer-1', '#ffffff'), fontWeight: 650 },
      segTodo: { background: T('--dsw-alias-bg-layer-2', '#edf2f7'), color: T('--dsw-alias-label-secondary', '#a0aec0') },
      // ── insights 视觉（v18.91.0）：环形 + 分段条 + 图例 ──────────────────────────────
      ringWrap: { display: 'flex', alignItems: 'center', gap: '12px' },
      ringTrack: { stroke: T('--dsw-alias-bg-layer-2', '#edf2f7') },
      ringLegend: { display: 'flex', flexDirection: 'column', gap: '2px' },
      stackTrack: { display: 'flex', height: '12px', borderRadius: '999px', overflow: 'hidden', background: T('--dsw-alias-bg-layer-2', '#edf2f7') },
      stackSeg: { display: 'block', height: '100%' },
      legend: { display: 'flex', flexWrap: 'wrap', gap: '7px', marginTop: '6px' },
      legendItem: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: T('--dsw-alias-label-secondary', '#4a5568'), fontVariantNumeric: 'tabular-nums' },
      swatch: { display: 'inline-block', width: '9px', height: '9px', borderRadius: '2px' },
      axis: { fill: T('--dsw-alias-label-secondary', '#98a2b3') },
      grid: { stroke: T('--dsw-alias-border-l2', '#d0d5dd') },
      band: { fill: T('--dsw-alias-bg-layer-2', '#f2f4f7') },
      cmd: { display: 'block', overflowX: 'auto', whiteSpace: 'nowrap', padding: '2px 0' },
      tdPath: { wordBreak: 'break-all' },
      // ── 信息块版式（v18.91.1）：统计格 / 计量条 / 环形区 ──────────────────────────────
      stats: { display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', margin: '2px 0 4px' },
      statCell: { flex: '1 1 76px', minWidth: '72px', padding: '2px 10px 2px 0' },
      statCellSep: { borderLeft: '0.5px solid ' + T('--dsw-alias-border-l1', '#e4e7ec'), paddingLeft: '12px' },
      statLabel: { fontSize: '10.5px', color: T('--dsw-alias-label-secondary', '#667085') },
      statValue: { fontSize: '15px', fontWeight: 650, lineHeight: 1.45, color: T('--dsw-alias-label-primary', '#1a202c'), fontVariantNumeric: 'tabular-nums' },
      meterRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '5px 0 3px', minWidth: 0 },
      meterLabel: { flex: '0 0 auto', fontSize: '11.5px', color: T('--dsw-alias-label-secondary', '#4a5568') },
      meterTrack: { flex: '1 1 90px', minWidth: '70px', height: '9px', borderRadius: '999px', background: T('--dsw-alias-bg-layer-2', '#edf2f7'), overflow: 'hidden' },
      meterFill: { display: 'block', height: '100%', borderRadius: '999px', background: T('--dsw-alias-state-success-primary', '#2f855a') },
      meterValue: { flex: '0 0 auto', minWidth: '62px', textAlign: 'right', fontSize: '12px', fontWeight: 650, fontVariantNumeric: 'tabular-nums', color: T('--dsw-alias-label-primary', '#1a202c') },
      split: { display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '6px' },
      splitMain: { flex: '0 0 auto', display: 'flex', justifyContent: 'center' },
      splitSide: { flex: '1 1 240px', minWidth: 0 },
      dlRow: { display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' },
      dlName: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11.5px', color: T('--dsw-alias-label-primary', '#1a202c') },
      dlBtn: { flex: '0 0 auto', fontSize: '11px', padding: '1px 8px', borderRadius: '6px', textDecoration: 'none', color: T('--dsw-alias-bg-layer-1', '#ffffff'), background: T('--dsw-alias-state-success-primary', '#2f855a') },
      dlBtnGhost: { flex: '0 0 auto', fontSize: '11px', padding: '1px 8px', borderRadius: '6px', textDecoration: 'none', color: T('--dsw-alias-label-secondary', '#4a5568'), border: '0.5px solid ' + T('--dsw-alias-border-l2', '#d0d5dd') },
      figGrid: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px' },
      figItem: { textDecoration: 'none', padding: '2px 7px', borderRadius: '6px', background: T('--dsw-alias-bg-layer-2', '#f2f4f7'), color: T('--dsw-alias-label-primary', '#1a202c'), fontSize: '10.5px', maxWidth: '100%' },
      figName: { display: 'inline-block', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' },
      cmdRow: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '3px', alignItems: 'center' },
      cmdChip: { display: 'inline-flex', alignItems: 'center', gap: '2px' },
      cmdBtn: { font: 'inherit', fontSize: '11px', padding: '2px 9px', borderRadius: '6px', cursor: 'pointer', border: '0.5px solid ' + T('--dsw-alias-border-l2', '#d0d5dd'), background: T('--dsw-alias-bg-layer-2', '#f2f4f7'), color: T('--dsw-alias-label-primary', '#1a202c') },

      subBlock: { background: T('--dsw-alias-bg-layer-2', '#f7fafc'), borderRadius: '8px', padding: '8px 10px' },
      sectionTitle: { flex: '1 1 100%', margin: '12px 0 5px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: T('--dsw-alias-label-secondary', '#667085'), textTransform: 'uppercase', borderBottom: '0.5px solid ' + T('--dsw-alias-border-l1', '#e4e7ec'), paddingBottom: '3px' },
      cols: { display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'flex-start' },
      empty: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0 2px' },
      emptyText: { color: T('--dsw-alias-label-secondary', '#667085'), fontSize: '11.5px', lineHeight: 1.5 },
      emptyCmd: { display: 'flex', alignItems: 'center', gap: '6px', background: T('--dsw-alias-bg-layer-2', '#f2f4f7'), borderRadius: '6px', padding: '4px 8px', minWidth: 0 },
      cardWide: { flex: '1 1 100%' },
      col: { flex: '1 1 300px', minWidth: 0 },
      gateGrid: { display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' },
      gateCell: { display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px' },
      heatRow: { display: 'flex', alignItems: 'center', gap: '4px', margin: '1px 0' },
      heatLabel: { flex: '1 1 auto', minWidth: 0, fontSize: '10.5px', color: T('--dsw-alias-label-secondary', '#4a5568'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      heatHead: { flex: '0 0 26px', textAlign: 'center', fontSize: '10px', color: T('--dsw-alias-label-secondary', '#667085') },
      heatCell: { flex: '0 0 26px', height: '17px', lineHeight: '17px', textAlign: 'center', borderRadius: '4px', fontSize: '10.5px', fontVariantNumeric: 'tabular-nums' },
      radarRow: { display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '8px', justifyContent: 'center' },
      radarCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 1 180px', minWidth: 0, background: T('--dsw-alias-bg-layer-2', '#f7fafc'), borderRadius: '8px', padding: '6px 8px' },

      // ── 开工台（v19.0.0 §4.2）：**输入框上方的通栏条目**（`conversation.input.dock`）──────────
      // 版式口径（写入 `references/DESIGN.md`）：所有色值走语义 token；圆角 10/6/999 三档；
      //   字号只用 10.5/11/11.5/12.5/15 五级；无主题选择器、无颜色字面量。
      // v19.0.1（主人反馈「横向撑满窗口」）→ v19.0.3（主人反馈「又窄了点，两端没对齐」）：
      //   **该槽位有两族几何，选错族就必然不齐**——
      //   · **叠层卡片族**（QueueDock / TodoPanel）：`width: calc(100% - 2×side-clearance - 2×dock-inset)`、
      //     `max-width: calc(card-max-width - 2×dock-inset)`、`padding: 0 dock-inset`、负下边距、**圆角只留上边**
      //     ——它们**刻意**比输入框窄一圈并贴在输入框上沿（视觉上是「叠在输入框上的附件」）。
      //   · **独立卡片/提示条族**（shell 自己在输入栏里的 notice：`uV2eYG_notice`）：
      //     `width: 100%; max-width: var(--dsh-composer-card-max-width)`——**与输入框两端严格对齐**。
      //   开工台是**四边独立圆角的卡片**，属后者 ⇒ 抄 `notice`，**不**再减 `side-clearance`（外层容器已有
      //   `padding: 0 side-clearance`，再减一次就是双重内缩 = 我上一版窄掉的那 32px）与 `dock-inset`。
      //   变量缺失时 fallback 到 100%（退化成满宽而不是算坏）。
      wbDock: {
        boxSizing: 'border-box', flex: 'none', margin: '0 auto 6px',
        width: '100%',
        maxWidth: 'var(--dsh-composer-card-max-width, 100%)',
      },
      wbWrap: { minWidth: 0, color: T('--dsw-alias-label-primary', '#1a202c'), border: '0.5px solid ' + T('--dsw-alias-border-l1', '#e2e8f0'), borderRadius: '10px', background: T('--dsw-alias-bg-layer-1', '#ffffff'), boxSizing: 'border-box', maxWidth: '100%', overflow: 'hidden' },
      wbBar: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', flexWrap: 'wrap', minWidth: 0 },
      wbTitle: { fontSize: '12.5px', fontWeight: 650, color: T('--dsw-alias-label-primary', '#1a202c') },
      wbSub: { fontSize: '11px', color: T('--dsw-alias-label-secondary', '#718096'), flex: '1 1 220px', minWidth: 0 },
      // 表单内的说明行（v19.1.4，主人裁定把「只填入输入框、不自动发送」从标题栏移进表单）：
      //   **方向无关**（不带 flex）——标题栏那行用 `wbSub`（行样式，带 220px 基准宽），
      //   而这里在块容器里，绝不能复用带 flex 的行样式（历史教训：列/块里 flex-basis 会被当尺寸）。
      wbIntro: { fontSize: '11px', color: T('--dsw-alias-label-secondary', '#718096'), lineHeight: 1.5, marginBottom: '7px' },
      wbBody: { borderTop: '0.5px solid ' + T('--dsw-alias-border-l1', '#e4e7ec'), padding: '8px 10px', maxHeight: '320px', overflow: 'auto', boxSizing: 'border-box' },
      wbSec: { marginBottom: '8px' },
      wbSecTitle: { fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.06em', color: T('--dsw-alias-label-secondary', '#667085'), textTransform: 'uppercase', marginBottom: '5px' },
      wbGrid: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
      wbField: { flex: '1 1 180px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
      wbFieldWide: { flex: '1 1 100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
      wbLabel: { fontSize: '10.5px', color: T('--dsw-alias-label-secondary', '#667085') },
      // 必填/可选小标（v19.1.6）：**只能用 10.5 那一档字号**（DESIGN.md §三 字号只有五级）；
      //   靠**颜色**区分：必填用 label-primary（更实），可选用 state-idle（更淡）——不去争字号。
      wbTagReq: { fontSize: '10.5px', marginLeft: '4px', color: T('--dsw-alias-label-primary', '#1a202c') },
      wbTagOpt: { fontSize: '10.5px', marginLeft: '4px', color: T('--dsw-alias-state-idle-primary', '#98a2b3') },
      // v19.0.2（主人实测「全部同意和展开高级设置之间有大段空白」）：**字段列内的提示不得复用行样式**——
      //   `S.wbNote` 带 `flex: '1 1 220px'`，而字段容器是 `flexDirection: 'column'`，
      //   于是 flex-basis 被解释成**高度 220px**（列方向）⇒ 视觉上就是一大段空白。
      //   列内提示一律用本样式（**方向无关：不带 flex**）。机检见 tests/panel.test.mjs 的通类方向钉。
      wbFieldHint: { fontSize: '10.5px', color: T('--dsw-alias-label-secondary', '#98a2b3'), lineHeight: 1.45 },
      // 六块进度 chips（v19.1.0 试点）：命中判据的块用 success 描边 + 同色文字；未命中保持中性。
      wbPhRow: { display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' },
      wbPh: { display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '1px 7px', borderRadius: '999px', border: '0.5px solid ' + T('--dsw-alias-border-l1', '#e4e7ec'), fontSize: '10.5px', color: T('--dsw-alias-label-secondary', '#98a2b3') },
      wbPhOn: { display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '1px 7px', borderRadius: '999px', border: '0.5px solid ' + T('--dsw-alias-state-success-primary', '#2f855a'), fontSize: '10.5px', color: T('--dsw-alias-state-success-primary', '#2f855a') },
      // 标题栏里的项目切换器（v19.1.5）：**只在多项目时出现**；做成小尺寸、低对比，避免与进度 chips 抢注意力。
      wbProjSel: { font: 'inherit', fontSize: '10.5px', maxWidth: '170px', padding: '0 2px', borderRadius: '6px', border: '0.5px solid ' + T('--dsw-alias-border-l1', '#e4e7ec'), background: T('--dsw-alias-bg-layer-2', '#f7fafc'), color: T('--dsw-alias-label-secondary', '#718096') },
      // 常驻只读进度 chips（v19.1.4）：挂在标题栏里（`wbPhRow` + `wbPh`/`wbPhOn`）。
      //   旧版另有一条 `wbStrip` 独立条，因**同一事实两处呈现**被主人一眼看穿 ⇒ 已删（一事实一处）。
      wbInput: { font: 'inherit', fontSize: '12px', padding: '3px 7px', borderRadius: '6px', border: '0.5px solid ' + T('--dsw-alias-border-l2', '#d0d5dd'), background: T('--dsw-alias-bg-layer-1', '#ffffff'), color: T('--dsw-alias-label-primary', '#1a202c'), boxSizing: 'border-box', width: '100%' },
      wbActions: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', borderTop: '0.5px solid ' + T('--dsw-alias-border-l1', '#e4e7ec'), padding: '7px 10px' },
      wbPrimary: { font: 'inherit', fontSize: '12px', fontWeight: 650, padding: '3px 10px', borderRadius: '6px', cursor: 'pointer', border: '0.5px solid ' + T('--dsw-alias-border-l2', '#d0d5dd'), background: T('--dsw-alias-state-success-primary', '#2f855a'), color: T('--dsw-alias-bg-layer-1', '#ffffff') },
      wbNote: { fontSize: '11px', color: T('--dsw-alias-label-secondary', '#718096'), flex: '1 1 220px', minWidth: 0 },
      wbErr: { fontSize: '11px', color: T('--dsw-alias-state-error-primary', '#c53030'), flex: '1 1 100%' },
      wbPreview: { margin: '0 10px 8px', padding: '6px 8px', borderRadius: '8px', background: T('--dsw-alias-bg-layer-2', '#f7fafc'), border: '0.5px solid ' + T('--dsw-alias-border-l1', '#edf2f7'), whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace,Consolas,monospace', fontSize: '11px', color: T('--dsw-alias-label-primary', '#1a202c'), maxHeight: '150px', overflow: 'auto' },
    };

    function api(path, params) {
      var qs = params ? '?' + Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&') : '';
      return fetch(API + path + qs, { headers: { accept: 'application/json' } }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }

    function age(iso) {
      if (!iso) return '—';
      var s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
      return s < 60 ? s + 's 前' : s < 3600 ? Math.round(s / 60) + 'm 前' : (s / 3600).toFixed(1) + 'h 前';
    }

    /** 字数迷你折线（内联 SVG，零依赖；口径来自边车，不在此处重算）。 */
    function Sparkline(props) {
      var pts = (props.series || []).filter(function (p) { return typeof p.han === 'number'; });
      if (pts.length < 2) return h('span', { style: S.dim }, '（字数序列不足）');
      var lo = Math.min.apply(null, pts.map(function (p) { return p.han; }));
      var hi = Math.max.apply(null, pts.map(function (p) { return p.han; }));
      var span = Math.max(1, hi - lo);
      var w = 220, hgt = 46;
      var d = pts.map(function (p, i) {
        var x = (i / (pts.length - 1)) * (w - 4) + 2;
        var y = hgt - 4 - ((p.han - lo) / span) * (hgt - 10);
        return (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
      return h('div', null,
        h('svg', { width: w, height: hgt, viewBox: '0 0 ' + w + ' ' + hgt },
          h('path', { d: d, fill: 'none', stroke: S.chart, strokeWidth: 2 })),
        h('div', { style: S.dim }, pts[0].label + ' ' + pts[0].han + ' → ' + pts[pts.length - 1].label + ' ' + pts[pts.length - 1].han));
    }

    /**
     * **环形占比图**（v18.91.0，参照「上下文洞察」那类 insights 视觉：环形 + 中心大数 + 图例）。
     * 纯 SVG：`stroke-dasharray` 画弧，`transform` 旋转 −90° 从 12 点起；颜色一律走主题 token。
     */
    function Ring(props) {
      var pct = Math.max(0, Math.min(100, Number(props.pct) || 0));
      var size = props.size || 92, r = (size - 12) / 2, c = 2 * Math.PI * r;
      var center = props.center || (Math.round(pct) + '%');
      return h('div', { style: S.ringWrap },
        h('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, 'aria-label': props.label || '占比' },
          h('circle', { cx: size / 2, cy: size / 2, r: r, fill: 'none', stroke: S.ringTrack.stroke, strokeWidth: 8 }),
          h('circle', {
            cx: size / 2, cy: size / 2, r: r, fill: 'none', stroke: props.color || S.chart, strokeWidth: 8, strokeLinecap: 'round',
            strokeDasharray: (c * pct / 100).toFixed(2) + ' ' + c.toFixed(2),
            transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')',
          }),
          h('text', { x: size / 2, y: size / 2 + 5, textAnchor: 'middle', fontSize: '17', fontWeight: 650, fill: S.kpiValue.color }, center)),
        h('div', { style: S.ringLegend },
          h('div', { style: S.kpiLabel }, props.label || ''),
          props.hint ? h('div', { style: S.dim }, props.hint) : null));
    }

    /**
     * **分段组成条 + 图例 + 百分比**（v18.91.0，同样对齐 insights 视觉）：
     * 一条 100% 宽的分段条回答「构成是什么」，图例回答「哪段是谁、占多少」。
     * 分段颜色按序取主题状态色/品牌色——**不引入任何写死的色值**。
     */
    function StackedBar(props) {
      var items = (props.items || []).filter(function (i) { return (Number(i.value) || 0) > 0; });
      var total = items.reduce(function (a, i) { return a + (Number(i.value) || 0); }, 0);
      if (!items.length || total <= 0) return h('div', { style: S.dim }, props.empty || '—');
      // v18.94.1：修「不同项目撞色」——旧色板只有 5 色且首尾同绿，9 个目录必然重复。
      //   现用 4 个状态基色 + `color-mix` 派生浅变体 + 灰，凑成 9 个**有序且互不相同**的颜色；
      //   仍全部由 token 派生（color-mix 里嵌的是 T() 值），明暗主题都会跟着变。
      var mixWith = function (c, pct) { return 'color-mix(in srgb, ' + c + ' ' + pct + '%, ' + T('--dsw-alias-bg-layer-1', '#ffffff') + ')'; };
      var base = [S.chart, S.chart2, T('--dsw-alias-brand-primary', '#1a202c'), S.bad.color];
      var palette = [base[0], base[1], base[2], base[3], mixWith(base[0], 55), mixWith(base[1], 55), mixWith(base[2], 45), mixWith(base[3], 55), S.idle.color];
      return h('div', null,
        h('div', { style: S.stackTrack }, items.map(function (it, i) {
          var pct = (Number(it.value) / total) * 100;
          return h('span', {
            key: it.label, title: it.label + ' · ' + Math.round(pct) + '%',
            style: Object.assign({}, S.stackSeg, { width: pct.toFixed(2) + '%', background: it.color || palette[i % palette.length] , borderRight: '1px solid ' + T('--dsw-alias-bg-layer-1', '#ffffff')}),
          });
        })),
        h('div', { style: S.legend },
          items.map(function (it, i) {
            var pct = (Number(it.value) / total) * 100;
            return h('span', { key: it.label, style: S.legendItem },
              h('span', { style: Object.assign({}, S.swatch, { background: it.color || palette[i % palette.length] }) }),
              it.label + ' ' + (props.unit === '%' ? Math.round(pct) + '%' : (it.text != null ? it.text : it.value) + '（' + Math.round(pct) + '%）'));
          })));
    }

    /**
     * **字数演进图**（v18.91.1 细化）：把「一条折线」升级为**带目标走廊的版本图**。
     * 数据 = 边车 `words.series`（脚本口径，面板不重算）+ `status.md` 的目标篇幅/纠偏线/G8 硬阈。
     *   · 两条横向色带：G8 硬阈（宽）、纠偏线（窄）——一眼看出每一版是否落在允许区间；
     *   · 目标参考线（13000 这类具体数字）；
     *   · 每个版本一个数据点 + 悬浮提示（版本号 / 字数 / 距目标差）；
     *   · 图例给出 起→终、总增减、末版判定（在纠偏线内 / 越过纠偏线 / 破硬阈）。
     * **不编造**：没有数字层就不画（提示怎么生成）；判定文案只依据这两组阈值做区间比较，不做质量评价。
     */
    function WordsChart(props) {
      var series = (props.series || []).filter(function (p) { return typeof p.han === 'number'; });
      var meta = props.meta || {};
      if (series.length < 2) return h('div', { style: S.dim }, '（字数序列不足 2 个版本——需数字层边车）');
      var W = 660, H = 150, padL = 44, padR = 34, padT = 10, padB = 22;
      var iw = W - padL - padR, ih = H - padT - padB;
      var vals = series.map(function (p) { return p.han; });
      var lo = Math.min.apply(null, vals.concat((meta.hard || []).concat(meta.calibrate || [])));
      var hi = Math.max.apply(null, vals.concat((meta.hard || []).concat(meta.calibrate || [])));
      var pad = Math.max(80, (hi - lo) * 0.12);
      lo -= pad; hi += pad;
      var xAt = function (i) { return padL + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw); };
      var yAt = function (v) { return padT + ih - ((v - lo) / Math.max(1, hi - lo)) * ih; };
      var band = function (r, fill, op, key, label) {
        if (!r || r.length !== 2) return null;
        var y1 = yAt(r[1]), y2 = yAt(r[0]);
        return h('g', { key: key },
          h('rect', { x: padL, y: y1.toFixed(1), width: iw, height: Math.max(1, y2 - y1).toFixed(1), fill: fill, opacity: op }),
          h('title', null, label + '：' + r[0] + ' – ' + r[1] + ' 字'));
      };
      var gridVals = [lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.75];
      var grid = gridVals.map(function (v, i) {
        return h('line', { key: 'g' + i, x1: padL, y1: yAt(v).toFixed(1), x2: W - padR, y2: yAt(v).toFixed(1), stroke: S.grid.stroke, strokeWidth: 0.5, strokeDasharray: '3 3' });
      });
      var targetLine = meta.targetWords
        ? h('line', { x1: padL, y1: yAt(meta.targetWords).toFixed(1), x2: W - padR, y2: yAt(meta.targetWords).toFixed(1), stroke: S.ok.color, strokeWidth: 1, strokeDasharray: '5 3' })
        : null;
      var pts = series.map(function (p, i) { return xAt(i).toFixed(1) + ',' + yAt(p.han).toFixed(1); }).join(' ');
      var dots = series.map(function (p, i) {
        var d = meta.targetWords ? p.han - meta.targetWords : null;
        var inCal = meta.calibrate ? (p.han >= meta.calibrate[0] && p.han <= meta.calibrate[1]) : null;
        var inHard = meta.hard ? (p.han >= meta.hard[0] && p.han <= meta.hard[1]) : null;
        var judge = inCal === true ? '在纠偏线内' : inCal === false ? (inHard === false ? '破 G8 硬阈' : '越纠偏线') : '';
        return h('circle', { key: 'p' + i, cx: xAt(i).toFixed(1), cy: yAt(p.han).toFixed(1), r: 3.2, fill: inCal === false ? S.warn.color : S.chart },
          h('title', null, p.label + ' · ' + p.han + ' 字' + (d === null ? '' : '（距目标 ' + (d >= 0 ? '+' : '') + d + '）') + (judge ? ' · ' + judge : '')));
      });
      var xLabels = series.map(function (p, i) {
        return h('text', { key: 'x' + i, x: xAt(i).toFixed(1), y: H - 6, textAnchor: 'middle', fontSize: '9.5', fill: S.axis.fill }, p.label);
      });
      var last = series[series.length - 1];
      var delta = last.han - series[0].han;
      var lastJudge = meta.calibrate
        ? (last.han >= meta.calibrate[0] && last.han <= meta.calibrate[1] ? '末版在纠偏线内' : (meta.hard && (last.han < meta.hard[0] || last.han > meta.hard[1]) ? '末版破 G8 硬阈' : '末版越纠偏线但未破硬阈'))
        : '';
      return h('div', null,
        h('svg', { width: '100%', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '字数演进（含目标走廊）', style: { display: 'block' } },
          band(meta.hard, S.grid.stroke, 0.30, 'hard', 'G8 硬阈'),
          band(meta.calibrate, S.ok.color, 0.13, 'cal', '纠偏线'),
          grid, targetLine,
          h('polyline', { fill: 'none', stroke: S.chart, strokeWidth: 2, strokeLinejoin: 'round', points: pts }),
          dots,
          h('text', { x: 0, y: yAt(hi) + 10, fontSize: '9.5', fill: S.axis.fill }, Math.round(hi) + ''),
          h('text', { x: 0, y: yAt(lo) + 3, fontSize: '9.5', fill: S.axis.fill }, Math.round(lo) + ''),
          meta.targetWords ? h('text', { x: W - padR + 2, y: yAt(meta.targetWords) + 3, fontSize: '9.5', fill: S.ok.color }, String(meta.targetWords)) : null,
          xLabels),
        h('div', { style: S.legend },
          h('span', { style: S.legendItem }, h('span', { style: Object.assign({}, S.swatch, { background: S.chart }) }), '各版本字数（边车口径）'),
          meta.targetWords ? h('span', { style: S.legendItem }, '目标 ' + meta.targetWords + ' 字') : null,
          h('span', { style: S.legendItem }, series[0].label + ' ' + series[0].han + ' → ' + last.label + ' ' + last.han + '（Δ ' + (delta >= 0 ? '+' : '') + delta + '）'),
          lastJudge ? h('span', { style: S.legendItem }, lastJudge) : null));
    }


    function CardTitle(props) { return h('div', { style: S.cardTitle }, props.text); }

    /**
     * **空态**（v18.92.0）：无数据时不摆一行灰字，而是给「说明 + 可复制的生成命令」。
     * 设计意图：**空态也必须能推动下一步**——用户看到的是"点一下就能拿到数据"，而不是一句「暂无」。
     */
    function EmptyState(props) {
      var cmd = props.cmd || '';
      return h('div', { style: S.empty },
        h('div', { style: S.emptyText }, props.hint || '暂无数据'),
        h('div', { style: S.emptyText }, '把下面这条发到会话里让 AI 执行即可（也可在本机 PowerShell 运行）：'),
        cmd ? h('div', { style: S.emptyCmd },
          h('span', { style: Object.assign({}, S.mono, { flex: '1 1 auto', minWidth: 0, overflowX: 'auto', whiteSpace: 'nowrap' }) }, cmd),
          h('button', { style: S.cmdBtn, title: cmd, onClick: function (ev) { var ok = copyText(cmd); ev.target.textContent = ok ? '已复制' : '复制失败'; } }, '复制')) : null);
    }
    /** 复制到剪贴板（v18.93.0）：优先 `navigator.clipboard`；不可用时退回隐藏 textarea + execCommand。 */
    function copyText(txt) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); return true; }
      } catch (e) { /* 落到下面的兜底 */ }
      try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        return true;
      } catch (e) { return false; }
    }

    /**
     * **交付件与图件**（v18.93.0）——写作者最先要的东西：定稿 / 交付说明 / 门报告 / 证据包 / 图件在哪、
     * 多大、什么时候改的，并且**一键下载**（只读端点，见 SECURITY.md）。导出用「复制命令」按钮：
     * PDF / Word / LaTeX 需要 pandoc（本机未装），HTML 用仓内 `md2html.mjs` 即可——
     * **命令即事实，不假装这里能一键转**。
     */
    function Deliverables(props) {
      var d = props.deliverables;
      if (!d) return null;
      var root = props.root || '';
      var project = props.project || '';
      var link = function (rel) { return API + '/file?root=' + encodeURIComponent(root) + '&project=' + encodeURIComponent(project) + '&rel=' + encodeURIComponent(rel); };
      var fmt = function (kb) { return kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'; };
      return h('div', { style: S.card },
        h(CardTitle, { text: '交付件与图件（下载 / 复制命令）' }),
        (d.finalFiles || []).length ? h('div', null, d.finalFiles.map(function (f) {
          return h('div', { key: f.rel, style: S.dlRow },
            h('span', { style: S.dlName, title: f.rel }, f.label),
            h('span', { style: S.dim }, fmt(f.kb) + ' · ' + age(new Date(f.mtime).toISOString()) + '前'),
            h('a', { href: link(f.rel), download: '', style: S.dlBtn }, '下载'),
            h('a', { href: link(f.rel), target: '_blank', rel: 'noreferrer', style: S.dlBtnGhost }, '预览'));
        })) : h('div', { style: S.dim }, '（还没有 final/ 交付件）'),
        // 图件区块（v19.1.8）：从「列 final/图件 里有什么」升级为**对账卡片**——回答真正的问题：
        //   正文声明了几个图位 / 实有几张（SVG 与 PNG 同权）/ 缺哪几张 / **没有图时理由是什么**。
        //   主人实测反馈：「有些项目跑完了很多图表没有显示」——旧版只显示「图件 0 个」，
        //   既不区分「缺」与「本就不需要」，也不给理由。这里把四种状态分色写明。
        (function () {
          var fr = d.figRec;
          if (!fr) {
            // 兼容旧快照形状（`deliverables.figures` 而无 `figRec`）：**仍要列出文件名**——
            //   旧版就是列文件名，退化成只显示计数会丢掉「图在哪」这个最要紧的信息。
            return (d.figures || []).length
              ? h('div', { style: { marginTop: '7px' } },
                h('div', { style: S.dim }, '图件 ' + d.figures.length + ' 个（final/图件）'),
                h('div', { style: S.figGrid }, (d.figures || []).map(function (g) {
                  return h('a', { key: g.rel, href: link(g.rel), target: '_blank', rel: 'noreferrer', style: S.figItem, title: g.name + ' · ' + fmt(g.kb) },
                    h('span', { style: S.figName }, g.name));
                })))
              : null;
          }
          var tone = fr.status === 'ok' ? S.ok
            : fr.status === 'missing' ? S.bad
              : (fr.status === 'none-reasoned' || fr.status === 'pending') ? S.dim : S.warn;
          var rows = [h('div', { key: 'sum', style: Object.assign({}, tone, { marginTop: '7px' }) }, t('panel.figRecon') + (d.figSummary || ''))];
          if (fr.status === 'missing') {
            rows.push(h('div', { key: 'miss', style: { marginTop: '4px' } },
              h('div', { style: S.dim }, t('panel.figMissing')),
              (fr.missing || []).map(function (m) {
                return h('div', { key: 'm' + m.n, style: S.dim }, t('panel.figSlot') + m.n + '：' + (m.title || '—'));
              }),
              h('div', { style: Object.assign({}, S.dim, { marginTop: '3px' }) }, t('panel.figHowTo'))));
          }
          if (fr.status === 'none-reasoned') {
            var why = fr.reason || {};
            rows.push(h('div', { key: 'why', style: Object.assign({}, S.dim, { marginTop: '4px' }) },
              t('panel.figReasonFrom').replace('{src}', why.source || '—').replace('{text}', why.text || '—')));
          }
          if (fr.status === 'none-unreasoned') {
            rows.push(h('div', { key: 'why', style: Object.assign({}, S.warn, { marginTop: '4px' }) }, t('panel.figNoReason')));
          }
          if ((fr.extras || []).length) {
            rows.push(h('div', { key: 'extra', style: Object.assign({}, S.dim, { marginTop: '3px' }) },
              t('panel.figExtras') + fr.extras.join('、')));
          }
          if ((d.figures || []).length) {
            rows.push(h('div', { key: 'grid', style: S.figGrid }, d.figures.map(function (g) {
              return h('a', { key: g.rel, href: link(g.rel), target: '_blank', rel: 'noreferrer', style: S.figItem, title: g.name + ' · ' + fmt(g.kb) },
                h('span', { style: S.figName }, g.name));
            })));
          }
          return h('div', null, rows);
        })(),
        h('div', { style: { marginTop: '8px' } },
          h('div', { style: S.dim }, '导出为其它格式：**复制命令**→ 发到会话里让 AI 执行，或在本机 PowerShell 运行（命令已用**绝对路径**，不依赖 PATH 与当前目录；HTML 用仓内转换器，Word/PDF/LaTeX 需另装 pandoc）'),
          h('div', { style: S.cmdRow }, (props.exportCmds || []).map(function (e) {
            return h('span', { key: e.format, style: S.cmdChip },
              h('button', { style: S.cmdBtn, title: e.cmd, onClick: function (ev) { var ok = copyText(e.cmd); ev.target.textContent = ok ? e.format + ' ✅ 已复制' : e.format + ' ✗ 复制失败'; } }, e.format),
              h('span', { style: Object.assign({}, S.dim, { marginLeft: '3px' }) }, e.note || ''));
          }))));
    }


    /** 严重度 → 颜色/文案（M 门与准出门共用；只有「不通过」才给状态色，跳过用灰）。 */
    function sevStyle(sev) {
      var s = String(sev || '');
      if (s === 'P0') return { color: S.bad.color, label: 'P0' };
      if (s === 'P1') return { color: S.warn.color, label: 'P1' };
      if (s === 'P2') return { color: S.chart2, label: 'P2' };
      if (s === '跳过' || s === 'SKIP' || s === 'skip') return { color: S.idle.color, label: '跳过' };
      return { color: S.chart, label: '通过' };
    }

    /**
     * **M-Gate 准出门**（v18.92.0）：把边车 `mGate.results` 的**逐项校验结果**画成一条「准出灯带」。
     * 每格一个校验项、颜色 = 严重度；悬浮提示给「项 id + 门名 + 结论」。图例给出各档计数——
     * 比只看「19/24 通过」有用得多：**能一眼看到哪几项的灯是红的**。
     */
    function GateStrip(props) {
      var items = props.items || [];
      if (!items.length) return null;
      var order = { P0: 0, P1: 1, P2: 2, 通过: 3, 跳过: 4 };
      var sorted = items.slice().sort(function (a, b) {
        var x = order[a.severity] == null ? 9 : order[a.severity];
        var y = order[b.severity] == null ? 9 : order[b.severity];
        return x - y || String(a.id).localeCompare(String(b.id));
      });
      var counts = {};
      items.forEach(function (it) { var k = sevStyle(it.severity).label; counts[k] = (counts[k] || 0) + 1; });
      return h('div', { style: { marginTop: '8px' } },
        h('div', { style: S.gateGrid }, sorted.map(function (it, i) {
          var sv = sevStyle(it.severity);
          return h('span', { key: it.id || i, style: Object.assign({}, S.gateCell, { background: sv.color }), title: (it.id || '') + ' · ' + (it.gate || '') + ' · ' + sv.label },
            h('title', null, (it.id || '') + ' · ' + (it.gate || '') + ' · ' + sv.label));
        })),
        h('div', { style: S.legend }, ['P0', 'P1', 'P2', '通过', '跳过'].filter(function (k) { return counts[k]; }).map(function (k) {
          var sv = sevStyle(k);
          return h('span', { key: k, style: S.legendItem }, h('span', { style: Object.assign({}, S.swatch, { background: sv.color }) }), k + ' ×' + counts[k]);
        })));
    }

    /**
     * **合规分构成**（v18.92.0）：边车 `scoring.components` 的 8 个分量——**权重**（占多少）与**达标率**
     * （过得怎样）分开呈现；**不适用的分量如实画灰并写明原因**，绝不把 N/A 当 0 分。
     */
    function ScoreParts(props) {
      var items = props.items || [];
      if (!items.length) return null;
      return h('div', null, items.map(function (c) {
        var pct = c.applicable && typeof c.ratio === 'number' ? c.ratio * 100 : null;
        return h('div', { key: c.id, style: S.barRow, title: (c.name || c.id) + (c.applicable ? '' : '（不适用：' + (c.note || '') + '）') },
          h('span', { style: S.barLabel }, String(c.name || c.id || '').replace(/（[^）]*）/g, '').slice(0, 10)),
          h('span', { style: S.barTrack },
            h('span', { style: Object.assign({}, S.barFill, { width: (pct === null ? 100 : Math.max(1.5, pct)).toFixed(1) + '%' }, pct === null ? { background: S.idle.color, opacity: 0.35 } : null) })),
          h('span', { style: S.barValue }, (pct === null ? '不适用' : Math.round(pct) + '%') + ' · w' + c.weight));
      }));
    }

    /** **QLT-6 论证强度**（v18.92.0）：两分量 + **覆盖率告警原话**（边车写的「不得当整体结论」必须带出来）。 */
    function Qlt6(props) {
      var q = props.qlt;
      if (!q) return null;
      var pct = typeof q.score === 'number' ? q.score : null;
      return h('div', { style: { marginTop: '8px' } },
        h(Meter, { label: '论证强度 QLT-6', pct: pct === null ? 0 : pct, text: pct === null ? '—' : String(pct), hint: '覆盖 ' + Math.round((q.coverage || 0) * 100) + '%（N/A 不进分母）', color: S.chart2 }),
        h(ScoreParts, { items: (q.components || []).map(function (c) { return { id: c.id, name: c.name, weight: c.weight, ratio: c.ratio, applicable: c.applicable }; }) }),
        q.coverageWarning ? h('div', { style: Object.assign({}, S.dim, { marginTop: '3px' }) }, q.coverageWarning) : null,
        (q.na || []).length ? h('div', { style: S.dim }, 'N/A：' + q.na.map(function (n) { return n.id + '（' + (n.reason || '') + '，权重 ' + n.weight + '）'; }).join('；')) : null);
    }

    /** 证据类型 → 颜色/名（文献 L / 数据 D / 案例 C；红色留给「不通过」，故第三色取墨色）。 */
    var EV = [
      { key: 'L', name: '文献', color: T('--dsw-alias-brand-primary', '#3b5bdb') },
      { key: 'D', name: '数据', color: T('--dsw-alias-state-success-primary', '#2f855a') },
      { key: 'C', name: '案例', color: T('--dsw-alias-state-warn-primary', '#b54708') },
    ];

    /** **证据密度**（v18.92.0）：逐章节的 L/D/C 引用标记数（**只数标记，不判引用质量**）。 */
    function EvidenceBars(props) {
      var ev = props.evidence;
      if (!ev) return null;
      var secs = (ev.sections || []).filter(function (s) { return s.L + s.D + s.C > 0; });
      if (!secs.length) return null;
      var max = Math.max.apply(null, secs.map(function (s) { return s.L + s.D + s.C; }).concat([1]));
      return h('div', null,
        h('div', { style: Object.assign({}, S.legend, { marginBottom: '6px' }) },
          EV.map(function (e) { return h('span', { key: e.key, style: S.legendItem }, h('span', { style: Object.assign({}, S.swatch, { background: e.color }) }), e.name + ' ' + e.key); }),
          h('span', { style: S.legendItem }, '合计 L' + ev.totals.L + ' / D' + ev.totals.D + ' / C' + ev.totals.C + '（' + ev.draft + '）')),
        secs.map(function (s) {
          var total = s.L + s.D + s.C;
          var scale = total / max;
          return h('div', { key: s.title, style: S.barRow, title: s.title + '：文献 ' + s.L + ' · 数据 ' + s.D + ' · 案例 ' + s.C + '（共 ' + total + '）' },
            h('span', { style: S.barLabel, title: s.title }, s.title),
            h('span', { style: Object.assign({}, S.stackTrack, { flex: '1 1 auto' }) },
              EV.map(function (e) {
                var v = s[e.key];
                if (!v) return null;
                return h('span', { key: e.key, style: Object.assign({}, S.stackSeg, { width: ((v / total) * scale * 100).toFixed(2) + '%', background: e.color }) },
                  h('title', null, e.name + ' ' + v + ' 条'));
              }),
              h('span', { style: { flex: '0 0 auto', width: ((1 - scale) * 100).toFixed(2) + '%' } })),
            h('span', { style: S.barValue }, String(total)));
        }));
    }

    /** **章节 × 证据类型热力**（v18.92.0）：同一份数据的矩阵画法——能看出「哪一章只堆数据、没文献对话」。 */
    function EvidenceHeatmap(props) {
      var ev = props.evidence;
      if (!ev) return null;
      var secs = (ev.sections || []).filter(function (s) { return s.L + s.D + s.C > 0; });
      if (!secs.length) return null;
      var maxCell = Math.max.apply(null, secs.map(function (s) { return Math.max(s.L, s.D, s.C); }).concat([1]));
      return h('div', { style: { marginTop: '10px' } },
        h('div', { style: S.heatRow },
          h('span', { style: Object.assign({}, S.heatLabel, { fontWeight: 650 }) }, '章节 × 证据类型'),
          EV.map(function (e) { return h('span', { key: e.key, style: Object.assign({}, S.heatHead, { fontWeight: 650 }) }, e.key); })),
        secs.map(function (s) {
          return h('div', { key: s.title, style: S.heatRow },
            h('span', { style: S.heatLabel, title: s.title }, s.title),
            EV.map(function (e) {
              var v = s[e.key];
              var op = v ? 0.18 + 0.82 * (v / maxCell) : 0;
              return h('span', {
                key: e.key,
                style: Object.assign({}, S.heatCell, v ? { background: e.color, opacity: op, color: S.kpiValue.color } : { background: S.grid.stroke, opacity: 0.12, color: undefined }),
                title: s.title + ' · ' + e.name + ' ' + v + ' 条',
              }, v ? String(v) : '·');
            }));
        }),
        h('div', { style: Object.assign({}, S.dim, { marginTop: '4px' }) }, '色深 = 该章该类标记数（单格峰值 ' + maxCell + '）；「·」= 0 条 —— **只数标记，不判引用质量**'));
    }

    /** **审稿雷达**（v18.92.0）：三视角 × **各自维度**的雷达（子报告口径）。**不合成单一「六维总分」**——
     *  三份子报告的维度名不同，硬拼等于把不同尺子混成一个数（本仓 QLT 口径明确反对这种合成）。 */
    function ReviewRadars(props) {
      var views = props.views || [];
      if (!views.length) return null;
      var colors = [T('--dsw-alias-state-success-primary', '#2f855a'), T('--dsw-alias-state-warn-primary', '#b54708'), T('--dsw-alias-brand-primary', '#3b5bdb')];
      return h('div', { style: S.radarRow }, views.map(function (v, vi) {
        var n = Math.max(3, v.dims.length);
        var size = 176, cx = size / 2, cy = size / 2 + 6, R = 52;
        var pt = function (i, ratio) {
          var ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
          return [(cx + Math.cos(ang) * R * ratio).toFixed(1), (cy + Math.sin(ang) * R * ratio).toFixed(1)];
        };
        var ringPts = function (ratio) { return v.dims.map(function (_, i) { return pt(i, ratio).join(','); }).join(' '); };
        var poly = v.dims.map(function (d, i) { return pt(i, Math.max(0.04, (d.score || 0) / 5)).join(','); }).join(' ');
        return h('div', { key: v.view, style: S.radarCard },
          h('div', { style: S.statLabel }, v.view),
          h('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, role: 'img', 'aria-label': v.view + ' 雷达' },
            [0.25, 0.5, 0.75, 1].map(function (r, i) { return h('polygon', { key: 'r' + i, points: ringPts(r), fill: 'none', stroke: S.grid.stroke, strokeWidth: 0.5 }); }),
            v.dims.map(function (_, i) { var p = pt(i, 1); return h('line', { key: 'ax' + i, x1: cx, y1: cy, x2: p[0], y2: p[1], stroke: S.grid.stroke, strokeWidth: 0.5 }); }),
            h('polygon', { points: poly, fill: colors[vi % colors.length], opacity: 0.22, stroke: colors[vi % colors.length], strokeWidth: 1.8 },
              h('title', null, v.dims.map(function (d) { return d.name + ' ' + d.score + '/5'; }).join(' · '))),
            v.dims.map(function (d, i) {
              var p = pt(i, 1.3);
              return h('text', { key: 't' + i, x: p[0], y: p[1], textAnchor: 'middle', fontSize: '8.5', fill: S.axis.fill }, d.name.slice(0, 6) + ' ' + d.score);
            }),
            h('text', { x: cx, y: cy + 4, textAnchor: 'middle', fontSize: '15', fontWeight: 650, fill: S.kpiValue.color }, String(v.total))),
          h('div', { style: S.dim }, '满分 ' + v.max + (v.verdict ? ' · ' + v.verdict : '')));
      }));
    }

    /**
     * **统计格**（v18.91.1）：把「一行长文字」拆成若干「标签 + 大数」的格子，用发丝线分隔。
     * 用途：M 门的 P0/P1/P2/exit、轮次/门/字数点等——比一串顿号分隔的文本更好读、也更好横向对比。
     */
    function Stats(props) {
      var items = props.items || [];
      return h('div', { style: S.stats }, items.map(function (it, i) {
        return h('div', { key: it.label, style: Object.assign({}, S.statCell, i ? S.statCellSep : null) },
          h('div', { style: S.statLabel }, it.label),
          h('div', { style: Object.assign({}, S.statValue, it.tone ? { color: it.tone } : null) }, String(it.value)),
          it.hint ? h('div', { style: S.dim }, it.hint) : null);
      }));
    }

    /** **计量条**（v18.91.1）：0–100 的比例条 + 右侧数值（合规分这类「百分比型」指标专用）。 */
    function Meter(props) {
      var pct = Math.max(0, Math.min(100, Number(props.pct) || 0));
      return h('div', { style: S.meterRow },
        h('span', { style: S.meterLabel }, props.label),
        h('span', { style: S.meterTrack },
          h('span', { style: Object.assign({}, S.meterFill, { width: pct.toFixed(1) + '%' }, props.color ? { background: props.color } : null) })),
        h('span', { style: S.meterValue }, props.text || (Math.round(pct) + '%')),
        props.hint ? h('span', { style: Object.assign({}, S.dim, { marginLeft: '6px' }) }, props.hint) : null);
    }

    /**
     * **水平条形图**（v18.91.0）——零依赖：标签 + 比例条 + 数值。
     * 用途：角色段分布、产物分布（文件数 / 字节）。比例用 `max` 归一，故「谁最多」一眼可见。
     */
    function Bars(props) {
      var items = props.items || [];
      if (!items.length) return h('div', { style: S.dim }, props.empty || '—');
      var max = Math.max.apply(null, items.map(function (i) { return Number(i.value) || 0; }).concat([1]));
      return h('div', null, items.map(function (it) {
        var pct = Math.max(1.5, ((Number(it.value) || 0) / max) * 100);
        return h('div', { key: it.label, style: S.barRow },
          h('span', { style: S.barLabel, title: it.label }, it.label),
          h('span', { style: S.barTrack },
            h('span', { style: Object.assign({}, S.barFill, { width: pct.toFixed(1) + '%' }, it.color ? { background: it.color } : null) })),
          h('span', { style: S.barValue }, String(it.text != null ? it.text : it.value) + (props.unit || '')));
      }));
    }

    /**
     * **阶段进度带**（v18.91.0）：把「Phase 0→5」的闭合情况画成一条分段带。
     * 数据来自 `status.md` 的既有字段（当前阶段 + 已闭合阶段），**不做任何推断**——
     * 未提及的阶段一律画成「未开始」，而不是猜它可能已完成。
     */
    function Stepper(props) {
      var ph = props.phases;
      // v19.1.8：空结果**说明原因**（旧版只写「status.md 未给出阶段」，用户看不出是缺文件还是体例不含 ✅）
      if (!ph || ph.current === null) return h('div', { style: S.dim }, ph && ph.note ? ph.note : '（status.md 未给出阶段）');
      var known = (ph.closed || []).concat([ph.current]).filter(function (v) { return typeof v === 'number'; });
      var max = Math.max.apply(null, known.length ? known : [0]);
      var stages = ['0', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.2', '4.5', '4.6', '4.7', '5'];
      var shown = stages.filter(function (s) { return Number(s) <= max + 0.5; });
      return h('div', null,
        h('div', { style: S.ribbon }, shown.map(function (s) {
          var v = Number(s);
          var state = (ph.closed || []).indexOf(v) >= 0 ? 'done' : (v === ph.current ? 'now' : 'todo');
          var st = state === 'done' ? S.segDone : state === 'now' ? S.segNow : S.segTodo;
          return h('span', { key: s, style: Object.assign({}, S.seg, st), title: 'Phase ' + s + '（' + (state === 'done' ? '已闭合' : state === 'now' ? '进行中' : '未开始') + '）' }, s);
        })),
        h('div', { style: S.dim },
          '当前 Phase ' + ph.current + ' · 已闭合 ' + ((ph.closed || []).join(' / ') || '—'),
          // **必须作为独立子节点传入**：v19.1.8 首版用 `+ (cond ? h(...) : null)` 拼字符串，
          //   把虚拟节点对象拼成了字面量 `[object Object]null`（被 tests/panel.test.mjs 的阶段带用例抓出）。
          ph.note ? h('span', { style: Object.assign({}, S.warn, { marginLeft: '6px' }) }, '⚠ ' + ph.note) : null));
    }

    /**
     * **活动节律图**（v18.91.1 细化，替下旧版光秃秃的柱状图）：
     *   · 坐标轴与网格：y 轴给峰值/0，x 轴给**绝对时钟刻度**（不是"48h 前"这种模糊说法）；
     *   · **工作段背景色带**：把「机器真的在干活」的区间画出来（数据 = 宿主侧 mtime 会话化的段起止）；
     *   · 每格 `<title>` 悬浮提示：时间窗 + 改动次数；
     *   · 峰值参考线 + 统计行（总改动 / 活跃格 / 峰值）；
     *   · 0 值画 1px 基线（**"没在动"也要看得见**，而不是留白让人以为是缺数据）。
     */
    function ActivityChart(props) {
      var buckets = props.buckets || [];
      var meta = props.meta || {};
      if (!buckets.length) return h('div', { style: S.dim }, '—');
      var W = 660, H = 132, padL = 30, padR = 8, padT = 10, padB = 20;
      var iw = W - padL - padR, ih = H - padT - padB;
      var peak = Math.max(1, meta.peak || 1);
      var bw = iw / buckets.length;
      var t0 = meta.from || (Date.now() - buckets.length * (meta.bucketMs || 7200000));
      var step = meta.bucketMs || 7200000;
      var xAt = function (i) { return padL + i * bw; };
      var yAt = function (v) { return padT + ih - (v / peak) * ih; };
      var bands = (props.segments || []).map(function (s, i) {
        var x1 = padL + ((s.start - t0) / (step * buckets.length)) * iw;
        var x2 = padL + ((s.end - t0) / (step * buckets.length)) * iw;
        if (x2 < padL || x1 > W - padR) return null;
        var w = Math.max(1.5, Math.min(W - padR, x2) - Math.max(padL, x1));
        return h('rect', { key: 'seg' + i, x: Math.max(padL, x1).toFixed(1), y: padT, width: w.toFixed(1), height: ih, fill: S.band.fill, rx: 2 },
          h('title', null, '工作段：' + fmtClock(s.start) + ' → ' + fmtClock(s.end) + '（' + fmtDur(s.end - s.start) + '）'));
      });
      var grid = [0.5, 1].map(function (f, i) {
        return h('line', { key: 'g' + i, x1: padL, y1: yAt(peak * f).toFixed(1), x2: W - padR, y2: yAt(peak * f).toFixed(1), stroke: S.grid.stroke, strokeWidth: 0.5, strokeDasharray: '3 3' });
      });
      var bars = buckets.map(function (v, i) {
        var bh = v > 0 ? Math.max(2, (v / peak) * ih) : 1;
        return h('rect', {
          key: i, x: (xAt(i) + 1).toFixed(1), y: (padT + ih - bh).toFixed(1), width: Math.max(1.5, bw - 2).toFixed(1), height: bh.toFixed(1), rx: v > 0 ? 2 : 0,
          fill: v > 0 ? S.chart : S.grid.stroke,
        }, h('title', null, fmtClock(t0 + i * step) + '–' + fmtClock(t0 + (i + 1) * step) + '：' + v + ' 次改动'));
      });
      var ticks = [0, 6, 12, 18, 23].filter(function (i) { return i < buckets.length; }).map(function (i) {
        return h('text', { key: 't' + i, x: (i === 23 ? W - padR : xAt(i)).toFixed(1), y: H - 6, textAnchor: i === 0 ? 'start' : i === 23 ? 'end' : 'middle', fontSize: '9.5', fill: S.axis.fill }, i === 23 ? '现在' : fmtClock(t0 + i * step));
      });
      return h('div', null,
        h('svg', { width: '100%', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '近 48 小时活动节律', style: { display: 'block' } },
          bands, grid, bars,
          h('line', { x1: padL, y1: (padT + ih).toFixed(1), x2: W - padR, y2: (padT + ih).toFixed(1), stroke: S.axis.fill, strokeWidth: 0.5 }),
          h('text', { x: 0, y: yAt(peak) + 3, fontSize: '9.5', fill: S.axis.fill }, String(peak)),
          h('text', { x: 0, y: padT + ih + 3, fontSize: '9.5', fill: S.axis.fill }, '0'),
          ticks),
        h('div', { style: S.legend },
          h('span', { style: S.legendItem }, h('span', { style: Object.assign({}, S.swatch, { background: S.chart }) }), '改动次数（每格 2h）'),
          h('span', { style: S.legendItem }, h('span', { style: Object.assign({}, S.swatch, { background: S.band.fill, border: '0.5px solid ' + S.grid.stroke }) }), '工作段（mtime 会话化）'),
          h('span', { style: S.legendItem }, '总 ' + (meta.total || 0) + ' 次 · 活跃 ' + (meta.activeBuckets || 0) + '/' + buckets.length + ' 格 · 峰值 ' + peak + ' · 扫描 ' + (meta.scanned || 0) + ' 文件')));
    }

    /**
     * **草稿演进图**（v18.91.1 细化）：真时间轴 + 数据点 + 两条系列（初稿 / 修订说明）+ 悬浮提示。
     * 旧版只画一条折线且没有时间轴，看不出「什么时候写的哪一版」。
     */
    function DraftChart(props) {
      var rows = props.rows || [];
      if (rows.length < 2) return h('div', { style: S.dim }, '（草稿不足 2 个版本）');
      var W = 660, H = 132, padL = 34, padR = 8, padT = 10, padB = 20;
      var iw = W - padL - padR, ih = H - padT - padB;
      var t0 = rows[0].mtime, t1 = rows[rows.length - 1].mtime || t0 + 1;
      var span = Math.max(1, t1 - t0);
      var maxKb = Math.max.apply(null, rows.map(function (r) { return r.kb; }).concat([1]));
      var xAt = function (t) { return padL + ((t - t0) / span) * iw; };
      var yAt = function (kb) { return padT + ih - (kb / (maxKb * 1.12)) * ih; };
      var colorOf = function (k) { return k === 'draft' ? S.chart : k === 'revision' ? S.warn.color : S.idle.color; };
      var series = ['draft', 'revision', 'other'].map(function (k) {
        var pts = rows.filter(function (r) { return r.kind === k; });
        if (!pts.length) return null;
        return h('polyline', {
          key: k, fill: 'none', stroke: colorOf(k), strokeWidth: 1.8, strokeLinejoin: 'round',
          points: pts.map(function (r) { return xAt(r.mtime).toFixed(1) + ',' + yAt(r.kb).toFixed(1); }).join(' '),
        });
      });
      var dots = rows.map(function (r, i) {
        return h('circle', { key: i, cx: xAt(r.mtime).toFixed(1), cy: yAt(r.kb).toFixed(1), r: 2.8, fill: colorOf(r.kind) },
          h('title', null, r.name + ' · ' + r.kb + ' KB · ' + fmtClock(r.mtime)));
      });
      var grid = [0.5, 1].map(function (f, i) {
        return h('line', { key: 'g' + i, x1: padL, y1: yAt(maxKb * f).toFixed(1), x2: W - padR, y2: yAt(maxKb * f).toFixed(1), stroke: S.grid.stroke, strokeWidth: 0.5, strokeDasharray: '3 3' });
      });
      var nDraft = rows.filter(function (r) { return r.kind === 'draft'; }).length;
      var nRev = rows.filter(function (r) { return r.kind === 'revision'; }).length;
      return h('div', null,
        h('svg', { width: '100%', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '草稿体积演进', style: { display: 'block' } },
          grid, series, dots,
          h('text', { x: 0, y: yAt(maxKb) + 3, fontSize: '9.5', fill: S.axis.fill }, maxKb.toFixed(0) + 'KB'),
          h('text', { x: 0, y: padT + ih + 3, fontSize: '9.5', fill: S.axis.fill }, '0'),
          h('text', { x: padL, y: H - 6, fontSize: '9.5', fill: S.axis.fill }, fmtClock(t0)),
          h('text', { x: W - padR, y: H - 6, textAnchor: 'end', fontSize: '9.5', fill: S.axis.fill }, fmtClock(t1))),
        h('div', { style: S.legend },
          h('span', { style: S.legendItem }, h('span', { style: Object.assign({}, S.swatch, { background: S.chart }) }), '初稿 ×' + nDraft),
          nRev ? h('span', { style: S.legendItem }, h('span', { style: Object.assign({}, S.swatch, { background: S.warn.color }) }), '修订说明 ×' + nRev) : null,
          h('span', { style: S.legendItem }, Math.min.apply(null, rows.map(function (r) { return r.kb; })).toFixed(1) + ' → ' + maxKb.toFixed(1) + ' KB · 共 ' + rows.length + ' 个文件')));
    }

    /** **KPI 小卡**（v18.91.0）：一行放 3–5 个关键数字，先给结论再给图。 */
    function Kpis(props) {
      return h('div', { style: S.kpiRow }, (props.items || []).map(function (k) {
        return h('div', { key: k.label, style: S.kpi },
          h('div', { style: S.kpiLabel }, k.label),
          h('div', { style: Object.assign({}, S.kpiValue, k.tone ? { color: k.tone } : null) }, k.value),
          k.hint ? h('div', { style: S.dim }, k.hint) : null);
      }));
    }

    /** 字节 → 人类可读（只做单位换算，不改变事实）。 */
    function bytes(kb) { return kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.round(kb) + ' KB'; }

    /** 毫秒 → 人类可读时长（v18.91.1）。 */
    function fmtDur(ms) {
      if (!(ms > 0)) return '—';
      var m = ms / 60000;
      if (m < 60) return Math.round(m) + ' 分钟';
      var hrs = m / 60;
      return hrs < 48 ? hrs.toFixed(1) + ' 小时' : (hrs / 24).toFixed(1) + ' 天';
    }

    /** 大数 → 人类可读（`98,004,578` → `98.0M`；只做单位换算，不改数值）。 */
    function fmtNum(n) {
      if (typeof n !== 'number' || !isFinite(n)) return '—';
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return Math.round(n / 1e3) + 'k';
      return String(n);
    }

    /** 时间戳 → `MM-DD HH:mm`（活动图/草稿图的坐标轴刻度与悬浮提示用；本地时区）。 */
    function fmtClock(ms) {
      if (!(ms > 0)) return '—';
      var d = new Date(ms);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    /** 座位行的**唯一呈现口径**（自审修正 F1）：三个事实各说各话，不合并成一句好听的。 */
    function seatLine() {
      var parts = [];
      parts.push(SEATS.main ? '侧栏图标 + 主面板 = 已注册' : '侧栏图标 + 主面板 = 未注册（`slots` 服务不可用？）');
      parts.push(SEATS.rightbar ? '右栏 tab = 已注册' : '右栏 tab = 未注册（本机客户端无 `sidebarRightTabs` / `sidebarRight`）');
      // v19.0.0 §4.2：开机台的落点同样**如实汇报**（缺席位/注册抛错都写出来，不假装有）。
      parts.push(SEATS.dock ? t('seat.dock.on') : t('seat.dock.off'));
      if (SEATS.dockError) parts.push(SEATS.dockError);
      if (SEATS.error) parts.push('注册异常：' + SEATS.error);
      var loc = LOCALE.svc ? ('locale = ' + LOCALE.active) : 'locale = 未接入（用内置中文）';
      if (LOCALE.err) loc += '（接入失败：' + LOCALE.err + '）';
      parts.push(loc);
      return h('div', { style: Object.assign({}, S.dim, { marginTop: '6px' }) }, '座位：' + parts.join(' ｜ '));
    }

    function Panel(props) {
      var ctx = props.ctx;
      var state = react.useState({ phase: 'loading', snap: null, projects: [], project: null, error: null, hostVersion: null, root: null, roots: [] });
      var st = state[0], setState = state[1];
      var esRef = react.useRef(null);
      var pollRef = react.useRef(null);

      // 兜底轮询（自审修正 F5）：SSE 断流时按主人裁定的 5s 节拍轮询 `/snapshot`（非流式端点，
      //   本就是为兜底准备的）；任一侧恢复即停轮询——**不让「断流」静默退化成「显示旧数」**。
      var stopPoll = function () { if (pollRef.current) { try { clearInterval(pollRef.current); } catch (e) { /* noop */ } pollRef.current = null; } };
      var pollRoot = null;
      var startPoll = function (project, root) {
        pollRoot = root || null;
        if (pollRef.current) return;
        pollRef.current = setInterval(function () {
          var rq = pollRoot ? '&root=' + encodeURIComponent(pollRoot) : '';
          api('/snapshot?project=' + encodeURIComponent(project) + rq)
            .then(function (s) { setState(function (old) { return Object.assign({}, old, { phase: 'poll', snap: s }); }); })
            .catch(function () { /* 轮询失败：保持 poll 态与最后一帧，不谎称实时 */ });
        }, 5000);
      };

      var connect = react.useCallback(function (project, root) {
        if (esRef.current) { try { esRef.current.close(); } catch (e) { /* noop */ } esRef.current = null; }
        stopPoll();
        if (!project) return;
        var rq = root ? '&root=' + encodeURIComponent(root) : '';
        try {
          var es = new EventSource(API + '/events?project=' + encodeURIComponent(project) + rq);
          esRef.current = es;
          es.addEventListener('snapshot', function (ev) {
            stopPoll();
            try { setState(function (s) { return Object.assign({}, s, { phase: 'live', snap: JSON.parse(ev.data), error: null }); }); } catch (e) { /* 忽略坏帧 */ }
          });
          es.addEventListener('error', function () {
            // SSE 断线：EventSource 会自动重连。**如实分两态**（自审修正 F8）：已有帧 → 退化为 5s 轮询；
            //   尚无帧 → 标「重连中」占位。两种都不谎称实时。
            setState(function (s) { return Object.assign({}, s, { phase: s.snap ? 'stale' : 'loading' }); });
            startPoll(project, root);
          });
        } catch (e) {
          setState(function (s) { return Object.assign({}, s, { phase: 'error', error: 'EventSource 不可用：' + e.message }); });
          startPoll(project, root);
        }
      }, []);

      react.useEffect(function () {
        var alive = true;
        api('/ping').then(function (p) {
          if (!alive) return;
          var roots = (p.roots && p.roots.length) ? p.roots.slice() : [];
          setState(function (s) { return Object.assign({}, s, { hostVersion: p.version || null, onDiskVersion: p.onDiskVersion || null, roots: roots }); });
          // v18.90.7：**逐根探测**。旧版只用宿主给的**第一个**根，而第一个根常常是「本插件所在仓库」，
          //   它没有 run/ ⇒ 主人真实项目（在别的根下）明明有 39 个却显示「未发现项目」。
          //   现在按顺序找到**第一个真的有项目**的根；主人选过的根优先。
          var savedRoot = null; try { savedRoot = window.localStorage.getItem(LS_ROOT); } catch (e) { /* noop */ }
          var order = roots.slice();
          if (savedRoot && order.indexOf(savedRoot) > 0) { order.splice(order.indexOf(savedRoot), 1); order.unshift(savedRoot); }
          var probe = function (idx) {
            if (!alive || idx >= order.length) return Promise.resolve({ root: order[0] || null, list: [] });
            return api('/projects', { root: order[idx] }).then(function (pl) {
              var l = pl.projects || [];
              return l.length ? { root: pl.root || order[idx], list: l } : probe(idx + 1);
            }).catch(function () { return probe(idx + 1); });
          };
          return probe(0).then(function (res) {
            if (!alive) return;
            var list = (res && res.list) || [];
            var root = res && res.root;
            var saved = null; try { saved = window.localStorage.getItem(LS_KEY); } catch (e) { /* noop */ }
            var pick = list.some(function (x) { return x.name === saved; }) ? saved : (list[0] && list[0].name);
            if (root) { try { window.localStorage.setItem(LS_ROOT, root); } catch (e) { /* noop */ } }
            // 空态（自审修正 F4）：一个 run/ 项目都没有时旧版会把 phase 永远停在「加载中…」——
            //   现显式进入 empty 态并给出可执行提示，而不是无声地转圈。
            setState(function (s) { return Object.assign({}, s, { projects: list, project: pick || null, root: root || null, phase: pick ? 'loading' : 'empty' }); });
            connect(pick, root);
          });
        }).catch(function (e) {
          if (!alive) return;
          setState(function (s) { return Object.assign({}, s, { phase: 'off', error: '面板未启用或不可达（' + e.message + '）—— 在插件行配置 `config: { panel: true }` 或设 `LUNHENG_PANEL=1` 后重载。' }); });
        });
        return function () { alive = false; stopPoll(); if (esRef.current) { try { esRef.current.close(); } catch (e) { /* noop */ } } };
      }, [connect]);

      var choose = function (name) {
        try { window.localStorage.setItem(LS_KEY, name); } catch (e) { /* noop */ }
        setState(function (s) { return Object.assign({}, s, { project: name, snap: null, phase: 'loading' }); });
        connect(name, st.root);
      };

      // v18.90.7：切换工作区根（多根时才出现）——重新列该项目清单并接上实时流。
      var switchRoot = function (root) {
        try { window.localStorage.setItem(LS_ROOT, root); } catch (e) { /* noop */ }
        setState(function (s) { return Object.assign({}, s, { root: root, projects: [], project: null, snap: null, phase: 'loading' }); });
        api('/projects', { root: root }).then(function (pl) {
          var list = pl.projects || [];
          var pick = list[0] && list[0].name;
          setState(function (s) { return Object.assign({}, s, { projects: list, project: pick || null, phase: pick ? 'loading' : 'empty' }); });
          connect(pick, root);
        }).catch(function (e) {
          setState(function (s) { return Object.assign({}, s, { phase: 'empty', error: '切换工作区根失败：' + e.message }); });
        });
      };

      var rootPicker = function () {
        if (!st.roots || st.roots.length < 2) {
          return st.root ? h('span', { style: Object.assign({}, S.dim, { marginLeft: '8px' }) }, st.root) : null;
        }
        return h('select', {
          value: st.root || st.roots[0], title: '工作区根（项目在该根下的 run/ 中）', style: Object.assign({}, S.btn, { marginLeft: '8px', maxWidth: '320px' }),
          onChange: function (e) { switchRoot(e.target.value); },
        }, st.roots.map(function (r) { return h('option', { key: r, value: r }, r); }));
      };

      var openRight = function () {
        var svc = ctx && (ctx.get ? ctx.get('sidebarRight') : null);
        if (svc && typeof svc.openTab === 'function') { try { svc.openTab(PANEL_ID); } catch (e) { /* noop */ } }
      };

      if (st.phase === 'off') {
        return h('div', { style: S.wrap }, h('div', { style: S.h1 }, t('panel.title')), h('div', { style: Object.assign({}, S.card, S.tint) }, st.error));
      }
      if (st.phase === 'empty') {
        return h('div', { style: S.wrap },
          h('div', { style: S.h1 }, t('panel.title'), h('span', { style: S.dim }, st.hostVersion ? '  ·  宿主 v' + st.hostVersion : ''), rootPicker()),
          h('div', { style: S.card },
            '当前工作区根' + (st.root ? ' `' + st.root + '`' : '') + ' 下未发现 `run/<项目>/` —— 先跑一次论衡流水线（Phase 0 起即会生成 `status.md`）；'
            + (st.roots && st.roots.length > 1 ? '若项目在别的根下，用标题栏的下拉切换工作区根。' : '或确认宿主注册的工作区根是否包含本工作区。')),
          seatLine());
      }
      var snap = st.snap;
      var roleRows = snap && snap.agents ? snap.agents.roles : [];
      var newest = snap && snap.artifacts ? snap.artifacts.newest : [];
      var rep = snap ? snap.report : null;
      var tk = snap ? snap.tokens : null;
      var ins = (snap && snap.insights) || {};
      // v19.1.11：M 门**复跑**（次级来源）——交付报告缺 results[] 时用它画灯带，并显著标注来源与日期
      var rerun = ins.gateRerun || null;
      var meta = ins.meta || null;
      var dirs = (ins.dirs || []).filter(function (d) { return d.files > 0; });
      var totalFiles = dirs.reduce(function (a, d) { return a + d.files; }, 0);
      var totalKb = dirs.reduce(function (a, d) { return a + d.kb; }, 0);
      var roleTotal = roleRows.reduce(function (a, r) { return a + r.count; }, 0);
      var closedCount = ins.phases ? (ins.phases.closed || []).length : 0;
      var elapsed = (function () {
        var s = snap && snap.status && snap.status.started;
        if (!s) return '—';
        var t = Date.parse(String(s).replace(/-/g, '/'));
        if (!t) return '—';
        var hrs = (Date.now() - t) / 3600000;
        return hrs < 1 ? Math.round(hrs * 60) + ' 分钟' : hrs < 48 ? hrs.toFixed(1) + ' 小时' : (hrs / 24).toFixed(1) + ' 天';
      })();
      var freshness = st.phase === 'live' ? '实时（fs.watch + 5s 心跳）'
        : st.phase === 'poll' ? '⚠ SSE 已断，当前由 5s 兜底轮询供给'
        : st.phase === 'stale' ? '⚠ SSE 已断：正在重连，且已开启 5s 兜底轮询（显示最后一帧）'
        : '加载中…';
      return h('div', { style: S.wrap },
        h('div', { style: S.h1 }, t('panel.title'),
          h('span', { style: S.dim },
            '  ·  ' + freshness,
            snap ? '  ·  数据 ' + age(snap.at) : '',
            st.hostVersion ? '  ·  宿主 v' + st.hostVersion : '',
            st.onDiskVersion && st.onDiskVersion !== st.hostVersion ? '  ·  ⚠ 磁盘上已是 v' + st.onDiskVersion + '，宿主需重启才生效' : '')),

        // ① KPI 行：先给结论（阶段 / 时长 / 角色 / 产物 / 失败）
        snap ? h(Kpis, {
          items: [
            { label: '当前阶段', value: ins.phases && ins.phases.current != null ? 'Phase ' + ins.phases.current : '—', hint: '已闭合 ' + closedCount + ' 段' },
            {
              label: '活跃时长（不含人在环）',
              value: ins.active ? fmtDur(ins.active.ms) : elapsed,
              hint: ins.active && ins.active.files
                ? '总跨度 ' + fmtDur(ins.active.spanMs) + ' · ' + ins.active.segs + ' 段 · 间隔≤' + ins.active.gapMinutes + 'min 计连续'
                : '（无文件 mtime，退化为启动至今）',
            },
            { label: '角色执行', value: roleTotal + ' 次', hint: roleRows.length + ' 个角色 / 9' },
            { label: '产物', value: totalFiles + ' 文件', hint: bytes(totalKb) },
            { label: '异常/收报', value: (ins.failures || 0) + ' / ' + ((ins.handoffs && ins.handoffs.ok) || 0), hint: '失败 / 收报放行', tone: (ins.failures || 0) > 0 ? S.warn.color : null },
          ],
        }) : null,

        h('div', { style: Object.assign({}, S.card, S.cardWide) },
          h(CardTitle, { text: '项目' }),
          h('div', { style: S.row },
            h('span', { style: S.k }, '选择'),
            h('select', { value: st.project || '', onChange: function (e) { choose(e.target.value); }, style: S.btn },
              (st.projects || []).map(function (p) { return h('option', { key: p.name, value: p.name }, p.name + (p.hasFinal ? ' ✅' : '')); })),
            rootPicker()),
          meta && meta.title ? h('div', { style: S.row }, h('span', { style: S.k }, '题名'), h('span', null, meta.title)) : null,
          meta ? h('div', { style: S.row }, h('span', { style: S.k }, '文类 / 目标'),
            h('span', null, (meta.genre || '—') + (meta.targetWords ? ' · ' + meta.targetWords + ' 字' : '')
              + (meta.calibrate ? '（纠偏 ' + meta.calibrate[0] + '–' + meta.calibrate[1] + '）' : '')
              + (meta.hard ? '（硬阈 ' + meta.hard[0] + '–' + meta.hard[1] + '）' : ''))) : null,
          h('div', { style: S.row }, h('span', { style: S.k }, '状态行'), h('span', null, (snap && snap.status && snap.status.phaseLine) || '—')),
          // v19.5.0（T7 反哺 N-11）：主人侧「卡在哪一步」——当前 Phase（KPI 行）+ **上次更新时刻** + **是否在等主人**
          //   只读投影自 snap.status（面板从 status.md 解析，见 lib/panel.mjs 的 parseOwnerWait）。
          //   `owner.line` 是 status.md 的**行号**（可点回原文核对），不是渲染行号。
          (snap && snap.status) ? h('div', { style: S.row },
            h('span', { style: S.k }, t('panel.status.waitUpdate')),
            h('span', null,
              snap.status.owner && snap.status.owner.waiting
                ? h('span', { style: S.warn },
                  t('panel.status.waiting'),
                  snap.status.owner.line ? t('panel.status.waitingAt') + snap.status.owner.line + '）' : '',
                  snap.status.owner.hits > 1 ? t('panel.status.waitingHits') + snap.status.owner.hits + t('panel.status.waitingHitsTail') : '',
                  snap.status.owner.label ? '：' + snap.status.owner.label : '')
                : t('panel.status.none'),
              t('panel.status.lastUpdate') + (snap.status.lastUpdate ? age(snap.status.lastUpdate) : '—'))) : null,
          h('div', { style: Object.assign({}, S.row, { marginTop: '6px' }) }, h('span', { style: S.k }, '阶段')),
          h(Stepper, { phases: ins.phases })),

        h('div', { style: S.sectionTitle }, '交付 · ' + (ins.deliverables ? (ins.deliverables.finalFiles.length + ins.deliverables.figures.length) : 0) + ' 件'),

          h(Deliverables, { deliverables: ins.deliverables, exportCmds: ins.exportCmds, root: st.root, project: st.project }),

        h('div', { style: S.sectionTitle }, '质量与证据 · ' + [!!(rep && rep.mGate), !!(rep && rep.gateItems && rep.gateItems.length), !!(rep && rep.scoreComponents && rep.scoreComponents.length), !!(rep && rep.qlt6), !!(rep && rep.words && rep.words.length), !!ins.evidence, !!ins.evidence, !!ins.review].filter(Boolean).length + ' 张'),

        // ① M 门：机械门汇总（一行原文 + 环形 + P0/P1/P2 统计格）——**一张卡只放这一项**
        h('div', { style: S.card },
          h(CardTitle, { text: 'M 门（机械门汇总）' }),
          rep && rep.mGate
            ? h('div', null,
              h('div', { style: S.row }, h('span', { style: S.k }, '结论'),
                h('span', null,
                  h('span', { style: rep.mGate.exit === 0 ? S.ok : S.warn }, 'exit ' + rep.mGate.exit),
                  '｜' + rep.mGate.pass + '/' + rep.mGate.total + ' 通过')),
              h('div', { style: S.split },
                h('div', { style: S.splitMain }, h(Ring, {
                  size: 112,
                  pct: rep.mGate.total ? (rep.mGate.pass / rep.mGate.total) * 100 : 0,
                  center: rep.mGate.pass + '/' + rep.mGate.total,
                  label: 'M 门通过率',
                  hint: 'exit ' + rep.mGate.exit + (rep.mGate.skips != null ? ' · 跳过 ' + rep.mGate.skips : ''),
                  color: rep.mGate.p0 > 0 ? S.bad.color : rep.mGate.p1 > 0 ? S.warn.color : S.ok.color,
                })),
                h('div', { style: S.splitSide }, h('div', { style: S.subBlock }, h(Stats, {
                  items: [
                    { label: 'P0（必须为 0）', value: rep.mGate.p0, tone: rep.mGate.p0 > 0 ? S.bad.color : null },
                    { label: 'P1', value: rep.mGate.p1, tone: rep.mGate.p1 > 0 ? S.warn.color : null },
                    { label: 'P2', value: rep.mGate.p2 },
                    { label: '跳过', value: rep.mGate.skips == null ? '—' : rep.mGate.skips },
                  ],
                })))))
            : h(EmptyState, {
              hint: rep && rep.gateDetail === 'no-report'
                // v19.1.11：项目内没有**交付时**的 M 门报告，但可能有**复跑**——这时说「没有报告」会与
                //   下方准出门卡的灯带自相矛盾，故改说「下方展示的是复跑、非交付结论」。
                ? (rerun && rerun.items.length ? t('panel.mgSumRerunOnly') : t('panel.mgNoReport'))
                : '还没有数字层边车（M 门汇总 / 合规分 / 字数序列都在它里面）。跑一次：',
              cmd: rep && rep.gateDetail === 'no-report'
                ? 'node scripts/m-gate-check.mjs final/定稿.md final/证据包 --report final/M-Gate-Report.json'
                : (ins.exec ? ins.exec.runReport + ' "run/' + (st.project || '<项目>') + '" --json "run/' + (st.project || '<项目>') + '/final/运行报告.json"' : 'node scripts/run-report.mjs run/' + (st.project || '<项目>') + ' --json final/运行报告.json'),
            })),

        // ② M 门准出门：24 项逐项灯带
        h('div', { style: S.card },
          h(CardTitle, { text: 'M 门准出门（逐项校验）' }),
          rep && rep.gateItems && rep.gateItems.length
            ? h(GateStrip, { items: rep.gateItems })
            // v19.1.11：交付报告缺明细时，若项目内有**复跑**报告（次级来源），改用它画灯带并**显著标注来源**
            //   ——「有数据」与「不篡改交付结论」两件事同时成立。标注不是装饰：不标就会被读成交付时的结论。
            : (rerun && rerun.items.length
              ? h('div', null,
                h('div', { style: Object.assign({}, S.warn, { marginBottom: '4px' }) }, t('panel.mgRerunNote')),
                h(GateStrip, { items: rerun.items }),
                h('div', { style: Object.assign({}, S.dim, { marginTop: '4px' }) },
                  t('panel.mgRerunMeta')
                    .replace('{at}', age(new Date(rerun.at).toISOString()))
                    .replace('{exit}', String(rerun.exit))
                    .replace('{p0}', String(rerun.p0)).replace('{p1}', String(rerun.p1)).replace('{p2}', String(rerun.p2))
                    .replace('{pass}', String(rerun.pass)).replace('{total}', String(rerun.total))
                    .replace('{rel}', rerun.rel)))
              // v19.1.9：空态**按原因分流**——旧版一律写「重跑一次即可带上」，而源报告若是旧格式
              //   （没有 results[]），重跑 run-report **永远带不上**（它只是把同一份旧报告再读一遍）。
              //   教用户做无效动作比不教更糟，故这里按 `rep.gateDetail` 给三条不同指引。
              : h(EmptyState, {
                hint: rep && rep.gateDetail === 'legacy-no-results' ? t('panel.mgLegacy')
                  : rep && rep.gateDetail === 'no-report' ? t('panel.mgNoReport')
                    : t('panel.mgRerun'),
                cmd: rep && rep.gateDetail
                  ? 'node scripts/m-gate-check.mjs final/定稿.md final/证据包 --report final/M-Gate-Report.json'
                  : 'node scripts/run-report.mjs run/' + (st.project || '<项目>') + ' --json final/运行报告.json',
              }))),

        // ③ 合规分（QLT-1）：计量条 + 8 分量构成
        h('div', { style: S.card },
          h(CardTitle, { text: '合规分（QLT-1，不是论证质量）' }),
          h(Meter, {
            label: '合规分',
            pct: rep && typeof rep.score === 'number' ? rep.score : 0,
            text: rep && typeof rep.score === 'number' ? rep.score + ' / 100' : '—',
            hint: '不是论证质量',
          }),
          rep && rep.scoreComponents && rep.scoreComponents.length
            ? h('div', { style: { marginTop: '6px' } }, h('div', { style: S.dim }, '合规分构成（权重 × 达标率；不适用者画灰，不计 0 分）'), h(ScoreParts, { items: rep.scoreComponents }))
            : null),

        // ④ 论证强度（QLT-6）：两分量 + 覆盖率告警
        h('div', { style: S.card },
          h(CardTitle, { text: '论证强度（QLT-6）' }),
          h(Qlt6, { qlt: rep ? rep.qlt6 : null })),

        // ⑤ 字数演进：目标走廊图 + 轮次/门/字数点
        h('div', { style: S.card },
          h(CardTitle, { text: '字数演进（含目标走廊）' }),
          h(Stats, {
            items: [
              { label: '修订轮次', value: rep && rep.rounds != null ? rep.rounds : '—' },
              { label: '阶段门', value: rep && rep.gates != null ? rep.gates : '—' },
              { label: '字数序列', value: rep && rep.words && rep.words.length ? rep.words.length + ' 点' : '—' },
            ],
          }),
          h(WordsChart, { series: rep ? rep.words : [], meta: meta || {} }),
          !rep ? h(EmptyState, { hint: '数字层边车还没有——生成后本卡会画出带目标走廊的字数演进：', cmd: 'node scripts/run-report.mjs run/' + (st.project || '<项目>') + ' --json final/运行报告.json' }) : null,
          rep && rep.generatedAt ? h('div', { style: Object.assign({}, S.dim, { marginTop: '5px' }) }, '数字层截至 ' + rep.generatedAt + '（' + age(rep.generatedAt) + '）—— 面板不实时重算门') : null),

        // ⑥ 证据密度（逐章 L/D/C）
        h('div', { style: S.card },
          h(CardTitle, { text: '证据密度（逐章 L/D/C 标记数）' }),
          ins.evidence ? h(EvidenceBars, { evidence: ins.evidence }) : h(EmptyState, { hint: '需要 drafts/初稿-vN.md（T5 写手产出后自动出现）' })),

        // ⑦ 章节 × 证据类型（热力）
        h('div', { style: S.card },
          h(CardTitle, { text: '章节 × 证据类型（热力）' }),
          ins.evidence ? h(EvidenceHeatmap, { evidence: ins.evidence }) : h(EmptyState, { hint: '同上——有初稿后自动出现' })),

        // ⑧ T9 三视角审稿：**单列**（与之前一致——三个雷达并排在自己的卡里）
        h('div', { style: S.card },
          h(CardTitle, { text: 'T9 三视角审稿' }),
          h('div', { style: S.dim }, '子报告口径：各视角 5 维、维度名各不相同，故不合成单一总分'),
          ins.review ? h(ReviewRadars, { views: ins.review.views }) : h(EmptyState, { hint: '需要 audits/审稿整合报告-vN.md（Phase 4.7 整合员产出）' })),

        h('div', { style: S.sectionTitle }, '进度与开销 · ' + (6 + (ins.drafts && ins.drafts.length > 1 ? 1 : 0)) + ' 张'),

        h('div', { style: S.card },
          h(CardTitle, { text: '角色段（按 agents-log 的 ### Tn 段计数）' }),
          h(Bars, { items: roleRows.map(function (r) { return { label: r.role, value: r.count, text: '×' + r.count }; }), empty: '（agents-log 里还没有 ### Tn 段）' }),
          h('div', { style: Object.assign({}, S.dim, { marginTop: '4px' }) }, 'agents-log 最后更新 ' + ((snap && snap.agents && snap.agents.logAge) || '—') + ' 前')),

        h('div', { style: S.card },
          h(CardTitle, { text: '产物分布（体积）' }),
          h(StackedBar, { items: dirs.map(function (d) { return { label: d.name, value: d.kb, text: bytes(d.kb) }; }), empty: '（目录还是空的）' })),

        h('div', { style: S.card },
          h(CardTitle, { text: '各目录文件数' }),
          h(Bars, { items: dirs.map(function (d) { return { label: d.name, value: d.files, text: d.files + ' 文件' }; }), empty: '（目录还是空的）' })),

        h('div', { style: S.card },
          h(CardTitle, { text: '活动节律（近 48 小时的文件改动）' }),
          h(ActivityChart, { buckets: ins.activity, meta: ins.activityMeta, segments: (ins.active && ins.active.segments) || [] }),
          h('div', { style: Object.assign({}, S.dim, { marginTop: '4px' }) },
            '活跃时长口径：本目录文件改动**会话化**（相邻改动间隔 ≤' + ((ins.active && ins.active.gapMinutes) || 15) + ' 分钟算同一工作段）累加段内跨度；人在环等待天然落成空档，故不计入——这是**启发式**，不是精确工时。')),

        ins.drafts && ins.drafts.length > 1 ? h('div', { style: S.card },
          h(CardTitle, { text: '草稿演进（KB，**字节**不是正文字数）' }),
          h(DraftChart, { rows: ins.drafts })) : null,

        h('div', { style: S.card },
          h(CardTitle, { text: 'Token 消耗（来自 final/token-cost.json，权威脚本 token-cost.mjs 产出）' }),
          tk && typeof tk.total === 'number'
            ? h('div', null,
              h(StackedBar, {
                items: [
                  { label: 'cacheRead', value: tk.cacheRead || 0, text: fmtNum(tk.cacheRead) },
                  { label: 'uncachedInput', value: tk.uncachedInput || 0, text: fmtNum(tk.uncachedInput) },
                  { label: 'output', value: tk.output || 0, text: fmtNum(tk.output) },
                  { label: 'cacheWrite', value: tk.cacheWrite || 0, text: fmtNum(tk.cacheWrite) },
                ],
                unit: '%',
              }),
              h('div', { style: S.legend },
                h('span', { style: S.legendItem }, '合计 ' + fmtNum(tk.total) + ' tokens'),
                tk.costUsd != null ? h('span', { style: S.legendItem }, '估算成本 $' + tk.costUsd) : null,
                tk.sessions != null ? h('span', { style: S.legendItem }, '会话 ' + (tk.matched != null ? tk.matched + '/' : '') + tk.sessions + ' 个') : null,
                tk.at ? h('span', { style: S.legendItem }, '数据截至 ' + age(new Date(tk.at).toISOString())) : null),
              tk.prices ? h('div', { style: Object.assign({}, S.dim, { marginTop: '4px' }) }, '估算单价（美元/百万 token）：in ' + tk.prices.in + ' · cache ' + tk.prices.cache + ' · out ' + tk.prices.out) : null,
              tk.note ? h('div', { style: Object.assign({}, S.dim, { marginTop: '4px' }) }, tk.note) : null)
            : tk && tk.broken
              ? h('div', { style: S.dim }, '（final/token-cost.json 解析失败——请重跑 token-cost.mjs 覆盖它）')
              : h(EmptyState, { hint: '还没有 token 数据（面板只读展示，不自己算）。跑一次即自动落盘 final/token-cost.json：', cmd: (ins.exec ? ins.exec.tokenCost + ' --project "run/' + (st.project || '<项目>') + '"' : 'node scripts/token-cost.mjs --project run/' + (st.project || '<项目>')) })),

        (ins.compare && ins.compare.items && ins.compare.items.length > 1) ? h('div', { style: S.card },
          h(CardTitle, { text: '跨项目对比（同一工作区根）' }),
          h('div', { style: S.dim }, '按**合规分（QLT-1）**排序 · 共 ' + ins.compare.scanned + ' 个有数字层的项目' + (ins.compare.scanned > ins.compare.items.length ? '，此处列前 ' + ins.compare.items.length + ' 个' : '')),
          h(Bars, {
            items: ins.compare.items.map(function (c) {
              return {
                label: (c.name === ins.compare.self ? '▶ ' : '') + c.name,
                value: typeof c.score === 'number' ? c.score : 0,
                text: (typeof c.score === 'number' ? c.score : '—') + ' · M 门 ' + (c.pass == null ? '—' : c.pass + '/' + c.total),
              };
            }),
            empty: '',
          }),
          h('div', { style: Object.assign({}, S.dim, { marginTop: '4px' }) }, '▶ = 当前项目；口径 = 各项目 `final/运行报告.json` 的**合规分代理**（门计数合成），**不是质量排序**；各项目数据截至各自的 generatedAt'),
        ) : null,

        h('div', { style: S.card },
          h(CardTitle, { text: '最近改动' }),
          h('table', { style: S.table }, h('tbody', null,
            newest.map(function (f) {
              return h('tr', { key: f.rel }, h('td', { style: Object.assign({}, S.td, S.tdPath) }, f.rel), h('td', { style: Object.assign({}, S.td, S.dim, { textAlign: 'right' }) }, (f.bytes / 1024).toFixed(1) + ' KB'), h('td', { style: Object.assign({}, S.td, S.dim, { textAlign: 'right' }) }, f.age + ' 前'));
            }))),
          h('div', { style: S.dim }, snap && snap.artifacts ? ('初稿 ' + snap.artifacts.drafts + ' 个版本｜audits ' + snap.artifacts.audits + ' 文件' + (snap.artifacts.hasFinal ? '｜已定稿' : '') + (snap.artifacts.hasEvidence ? '｜证据包在' : '')) : '')),


        h('div', { style: S.footer },
        h('div', { style: S.row },
          h('button', { style: S.btn, onClick: function () { if (st.project) connect(st.project, st.root); } }, '重新连接'),
          h('button', { style: S.btn, onClick: openRight }, t('panel.rightbarBtn'))),
        seatLine(),

        h('div', { style: S.dim },
          t('panel.readonly'),
          h('div', { style: S.cmd }, h('span', { style: S.mono }, 'node scripts/run-report.mjs run/<项目> --json final/运行报告.json')))));
    }

    /**
     * 侧栏图标（`sidebar.panellist`，list 席位：id/order/label）。
     *
     * v18.90.4 修正：旧版渲染的是 `<button style=S.btn>论衡</button>`——而**图标席位只该给图标**：
     *   侧栏自己就是那个按钮、并自己解析 `label`（官方席位目录原文：the sidebar owns the button and
     *   resolves its label from list metadata；席位 ownerProps = `{size, active}`）。把带边框与底色的
     *   按钮塞进图标格，视觉上就成一个**空心方块**（主人实测反馈的原样）。点击、选中所属侧栏管，
     *   本组件不再需要 onClick / layout.selectPanel。
     *   现改为**纯内联 SVG**（零依赖、24 格 viewBox 随 size 缩放、stroke=currentColor 跟随主题、
     *   `active` 反映选中态）：图案 = 圆角方框内的三根柱——面板本体就是 M 门 / 合规分 / 字数序列，
     *   一眼可读作「运行图表」。
     */
    function PanelIcon(props) {
      var size = (props && typeof props.size === 'number' && props.size > 0) ? props.size : 20;
      var active = !!(props && props.active);
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', role: 'img', 'aria-label': t('panel.title'),
        fill: 'none', stroke: 'currentColor', strokeWidth: active ? 2.1 : 1.7,
        strokeLinecap: 'round', strokeLinejoin: 'round',
        style: { display: 'block', opacity: active ? 1 : 0.72 },
      },
        h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 4.5 }),
        h('path', { d: 'M8 16.4v-4.1M12 16.4V8M16 16.4V9.6' }));
    }

    // ── 开工台组件（v19.0.0 §4.2）──────────────────────────────────────────────────────────
    // 标题前的**「圆 + 论」标记**（v19.0.5：主人给 `E:\Pictures\lunheng.svg`，**重建为纯路径版**）。
    // 为什么原文件不能直接内联（三条**实测**，不是推断）：
    //   ① **靠内嵌 SVG 字体出字**：原文件 `<defs><font id="FontID0">…<glyph unicode="论">` + `<text>论</text>`
    //      靠 `@font-face{src:url("#FontID0") format(svg)}`——而**现代浏览器早已不支持 SVG 字体**，
    //      实际渲染退化成「宿主得装微软雅黑」：本机（装了雅黑）看着正常，换台没装的机器圈里就空。
    //      违反 `DESIGN.md` §五「纯内联 SVG、零依赖」。
    //   ② **颜色写死**：描边与填充都是同一个硬编码深色字面量 ⇒ 违反「禁颜色字面量」；**暗色主题下几乎看不见**
    //      （已用无头 Chrome 在暗底上实测确认）。
    //   ③ CorelDRAW 导出件带 DOCTYPE / `<metadata>` / `xmlns:xodm` / 注释——不适合内联进客户端。
    // 重建做法（几何由脚本算，非目测）：取字体里嵌的**「论」轮廓路径**（纯路径、与字体无关）配自绘圆；
    //   归一化到 24×24 网格、`currentColor`、圆描边 1.8；字形缩放到占直径约 0.68（16px 下更清楚）。
    //   字形 bbox = 980×942 字体单位、**y 轴向上**（字体制）⇒ 变换须带负 y 缩放把它翻正并居中；
    //   该翻转是本图标唯一的几何陷阱（丢了它字会上下颠倒），测试已钉。
    //   观感已用无头 Chrome 渲染 14/16/24/32/48/200px（亮底 + 暗底）逐档核对。
    var WB_GLYPH_D = 'M427.901 450.011l78.3728 0 0 -206.153c125.619,54.2557 228.448,117.065 308.149,188.397l54.9351 -64.8166c-101.316,-79.7006 -222.396,-148.037 -363.084,-204.98l0 -128.614c0,-43.2316 19.763,-64.8166 58.9494,-64.8166l195.283 0c47.0607,0 74.204,20.9365 81.399,62.7785 8.55369,47.9254 14.39,99.4945 17.7559,155.109 20.9365,-9.04776 47.4004,-18.5896 79.3918,-28.4711 -5.86715,-53.6072 -13.0621,-103.694 -21.4614,-150.076 -13.2165,-75.8715 -64.1372,-113.884 -153.071,-113.884l-222.89 0c-75.8715,0 -113.73,41.5333 -113.73,124.6l0 430.927zm264.948 374.818l-12.7225 -22.604c77.6934,-138.002 183.055,-239.843 315.869,-305.154 -18.9293,-22.9436 -37.8586,-47.4004 -56.9422,-73.6791 -129.479,85.7222 -230.301,188.737 -302.127,309.137 -70.0044,-115.706 -172.185,-219.709 -306.173,-312.009 -19.0837,27.483 -36.9939,50.0869 -54.0704,67.6884 148.532,87.7294 256.889,199.792 324.886,336.62l91.2805 0zm-346.502 -716.472c2.00718,-33.9986 4.35404,-62.13 6.8553,-84.2399 -73.185,-49.0679 -138.99,-96.3139 -197.105,-141.337l-46.227 65.6503c22.2643,18.4043 33.3192,46.5358 33.3192,84.3943l0 387.695 -127.441 0 0 72.5365 204.146 0 0 -473.973c38.507,26.3095 80.7197,55.9541 126.453,89.2733zm-211.866 707.578c71.3322,-73.185 122.932,-127.595 155.078,-162.952l-68.8309 -57.776c-41.1936,54.2557 -89.9218,110.549 -146.216,168.82l59.9685 51.9088z';
    var WB_GLYPH_TF = 'translate(4.2797,17.3996) scale(0.0152615,-0.0152615)';
    var WB_ICON_GRID = '0 0 24 24';

    /**
     * 开工台标题前的**「圆 + 论」标记**（v19.0.5；由主人给的 CorelDRAW 件重建成纯路径版）。
     * 设计口径（同步进 `references/DESIGN.md` §五）：
     *   · **纯内联 SVG**——零依赖、零外链、**零字体依赖**（字形是路径，不是 `<text>`）；
     *   · `currentColor` ⇒ 描边与字形都随主题明暗自动变色，**不写颜色字面量**；
     *   · 24×24 网格，显示尺寸由 `size` 决定（默认 16，随 `wbTitle` 12.5px 字高）；
     *   · `aria-hidden` —— 标题文字已表达含义，图标是装饰，读屏不该重复念。
     */
    function WbIcon(props) {
      var size = (props && typeof props.size === 'number' && props.size > 0) ? props.size : 16;
      return h('svg', {
        width: size, height: size, viewBox: WB_ICON_GRID, fill: 'none',
        role: 'img', 'aria-hidden': 'true', focusable: 'false',
        style: { display: 'block', flex: '0 0 auto' },
      },
        h('circle', { cx: 12, cy: 12, r: 11, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }),
        h('path', { transform: WB_GLYPH_TF, fill: 'currentColor', d: WB_GLYPH_D }));
    }

    /**
     * 读「本会话 ↔ 项目」绑定（v19.1.5）。`sid` 来自 dock 席位注册的 `inject(sessionId)`
     *   （官方队列面板用同一机制拿会话作用域服务）。读失败一律回落空串 —— 宁可**没有绑定**（退到全局兜底），
     *   也不能因为 localStorage 不可用就让进度条整块失效。
     */
    function loadBind(sid) {
      try { return (sid && window.localStorage.getItem(LS_WB_BIND + sid)) || ''; } catch (e) { return ''; }
    }
    /** 写绑定：只在真有 sessionId 与项目名时写（空值不写，避免造出「空绑定」把兜底也挡住）。 */
    function saveBind(sid, proj) {
      try { if (sid && proj) window.localStorage.setItem(LS_WB_BIND + sid, String(proj)); } catch (e) { /* noop */ }
    }

    function loadWbCfg() {
      var f = Object.assign({}, WB_DEFAULT);
      try {
        var raw = window.localStorage.getItem(LS_WB_CFG);
        if (raw) { var o = JSON.parse(raw); for (var k in f) { if (Object.prototype.hasOwnProperty.call(o, k)) f[k] = o[k]; } }
      } catch (e) { /* 坏数据：整体回默认，绝不抛 */ }
      // v19.4.0：**词表迁移**。`loadWbCfg` 只按 `WB_DEFAULT` 的键过滤，故已废字段（`consent`/`scopeLit`/
      //   `scopeCase`/`scopeData`/`root`/`minLit`/`quality`/`rescan`）会被自然丢掉；但**取值**仍可能带进来，
      //   而本批改过词表：`lang:'zh'`（现行 `中文`）、`citeStyle:'ieee'|'mixed'`、`structure:'off'`、
      //   `t9:'关闭'`、`journal:'必须匹配'`（该档是本批前的自造第四档；**`'可选'` 是真源值、保留**）。若不校验，下拉会显示不出选中项、
      //   并把非法值写进开场白与简报。
      var WB_VOCAB = { lang: WB_LANG, journal: WB_JOURNAL, citeStyle: WB_CITE_STYLE, structure: WB_STRUCTURE, t9: WB_T9, retrieval: WB_RETRIEVAL, mask: WB_MASK, hitl: WB_HITL };
      Object.keys(WB_VOCAB).forEach(function (k) {
        if (f[k] !== '' && WB_VOCAB[k].indexOf(f[k]) < 0) f[k] = WB_DEFAULT[k];
      });
      // v19.4.0：回过头按文类**重算派生值**——`structure` / `t9` 不再是主人填的档，而是文类档案的投影
      //   （`applyDerived`），故旧存档里手填的档一律被覆盖（这正是本批的目的：消灭第二真值来源）。
      return applyDerived(f);
    }
    function saveWbCfg(f) { try { window.localStorage.setItem(LS_WB_CFG, JSON.stringify(f)); } catch (e) { /* 配额/隐私模式：不影响本次开工 */ } }

    /**
     * 开工台（`conversation.input.dock`）。
     * 落点选择（v19.0.0 实测）：dock 是 **session 域**席位，props 自带 `inputActions`（标准写入面）⇒
     *   不需要另起会话、不需要跨域管道；找不到时回落会话作用域通道，再不行**如实报缺并把开场白原样给出**。
     * **永不自动提交**：只 `setDraft`，因为 Phase 0 是人在环硬闸（`SKILL.md` §触发：不得直接 spawn 或写文件）。
     */
    function Workbench(props) {
      useLocaleTick();
      var pairOpen = react.useState(function () { var v = null; try { v = window.localStorage.getItem(LS_WB_OPEN); } catch (e) { /* noop */ } return v === '1'; });
      var open = pairOpen[0], setOpen = pairOpen[1];
      var pairAdv = react.useState(false);
      var adv = pairAdv[0], setAdv = pairAdv[1];
      var pairCfg = react.useState(loadWbCfg);
      var f = pairCfg[0], setF = pairCfg[1];
      var pairPrev = react.useState(false);
      var hasPrev = pairPrev[0], setHasPrev = pairPrev[1];
      var pairNote = react.useState(null);
      var note = pairNote[0], setNote = pairNote[1];
      // 续接出口的数据面（v19.0.0 收口）：只在展开时拉一次**面板既有只读读面**，失败**不阻断**开工台本体。
      var pairProjs = react.useState({ phase: 'idle', root: '', list: [] });
      var projs = pairProjs[0], setProjs = pairProjs[1];
      var pairSel = react.useState('');
      var sel = pairSel[0], setSel = pairSel[1];
      // v19.1.5：本会话身份（来自席位注册的 `inject(sessionId)`）与「会话 ↔ 项目」绑定。
      var sid = (props && props.sessionId) || '';
      var pairBind = react.useState(loadBind(sid));
      var bind = pairBind[0], setBind = pairBind[1];
      // 选中项目的**只读快照**（v19.1.0 试点）：走面板**既有**读面 `/snapshot`，不新增任何读面。
      var pairSnap = react.useState({ phase: 'idle', data: null });
      var snap = pairSnap[0], setSnap = pairSnap[1];

      react.useEffect(function () {
        if (!sel) return undefined;
        var alive = true;
        setSnap({ phase: 'loading', data: null });
        // v19.1.2（主人实测「快照读取失败」的真因）：**取快照必须带上探测出来的那个根**。
        //   宿主 `resolveTarget` 不带 `root` 时只取 `roots[0]`——多工作区下若项目是在**别的根**里找到的，
        //   不带 root 的快照请求就会打到 roots[0] ⇒ 404 ⇒ 界面上报「读面不可用」（**我看错了自己的数据源**）。
        //   根未知（单工作区兜底）时不带该参数，交回宿主默认。
        var q = '/snapshot?project=' + encodeURIComponent(sel) + (projs.root ? '&root=' + encodeURIComponent(projs.root) : '');
        api(q).then(function (s) {
          if (alive) setSnap({ phase: 'ready', data: s });
        }).catch(function () {
          if (alive) setSnap({ phase: 'fail', data: null });
        });
        return function () { alive = false; };
      }, [sel, projs.root]);
      // v19.1.5：**「当前项目」的三级判据**（并行会话下才有意义——dock 席位每会话一份，而旧版只有全局判据）：
      //   ① **本会话绑定**优先（`props.sessionId` → localStorage；存在且仍在清单里就用它）；
      //   ② 无绑定才兜底：**按项目内最新写入时间排序取最新**（读快照的 `artifacts.newest[0].mtime`
      //      ——比目录 mtime 准得多：目录 mtime 会被子目录变动扰动，实测某老单目录被碰过就排到了新单前面）；
      //   ③ 兜底探测**最多取前 12 个候选**（宿主已按目录 mtime 倒序，老单排在后面的概率高），
      //      避免项目多时把读面打成一片；≤12 时逐个问快照的代价是本地几十毫秒级。
      react.useEffect(function () {
        if (projs.phase !== 'ready' || sel || !projs.list.length) return;
        var names = projs.list.map(function (p) { return p.name; });
        if (bind && names.indexOf(bind) >= 0) { setSel(bind); return; }
        var rootQ = projs.root ? '&root=' + encodeURIComponent(projs.root) : '';
        var cands = projs.list.slice(0, 12);
        var best = null, i = 0, alive = true;
        var next = function () {
          if (!alive) return;
          if (i >= cands.length) { setSel(best ? best.name : (cands[0] && cands[0].name) || ''); return; }
          var nm = cands[i++].name;
          api('/snapshot?project=' + encodeURIComponent(nm) + rootQ).then(function (s) {
            var nr = (s && s.artifacts && s.artifacts.newest) || [];
            var mt = (nr[0] && nr[0].mtime) || 0;
            if (!best || mt > best.mt) best = { name: nm, mt: mt };
            next();
          }).catch(function () { next(); });
        };
        next();
        return function () { alive = false; };
      }, [projs.phase, projs.list, sel, bind, projs.root]);

      react.useEffect(function () {
        var has = false;
        try { has = !!window.localStorage.getItem(LS_WB_CFG); } catch (e) { /* noop */ }
        setHasPrev(has);
      }, [open]);
      react.useEffect(function () {
        if (projs.phase !== 'idle') return;
        setProjs({ phase: 'loading', root: projs.root, list: projs.list });
        // v19.1.1：**多工作区**下不能只问 `/projects`——宿主的 `resolveTarget` 在没带 `root` 时只取
        //   `roots[0]`，而你的 `run/<项目>/` 完全可能在另一个根下（那样列表就是空的，进度自然不出现）。
        //   故先问 `/ping` 拿本进程已知的根清单，**逐个根问一遍，取第一个有项目的根**；`/ping` 不可用
        //   （老宿主/读面未开）时退回原来的单次问法。全部走**既有只读端点**，不新增读面。
        api('/ping').then(function (p) {
          var roots = (p && Array.isArray(p.roots) && p.roots.length) ? p.roots : [''];
          var probe = function (i) {
            if (i >= roots.length) { setProjs({ phase: 'ready', root: roots[0], list: [] }); return; }
            api('/projects', { root: roots[i] }).then(function (pl) {
              var list = (pl && pl.projects) ? pl.projects : [];
              if (list.length) { setProjs({ phase: 'ready', root: (pl && pl.root) || roots[i], list: list }); return; }
              probe(i + 1);
            }).catch(function () { probe(i + 1); });
          };
          probe(0);
        }).catch(function () {
          api('/projects').then(function (p2) {
            setProjs({ phase: 'ready', root: (p2 && p2.root) || '', list: (p2 && p2.projects) || [] });
          }).catch(function () {
            setProjs({ phase: 'fail', root: '', list: [] });
          });
        });
      }, [projs.phase]);

      var set = function (k, v) { setF(function (old) { var n = Object.assign({}, old); n[k] = v; return n; }); };
      // v19.4.0：改文类要**同批**刷新派生的「结构门 / T9 视角」——一次 setF 里做完，避免两次 set 竞争渲染。
      var pickGenre = function (v) {
        setF(function (old) { var n = Object.assign({}, old); n.genre = v; return applyDerived(n); });
      };
      var toggle = function () { var next = !open; setOpen(next); try { window.localStorage.setItem(LS_WB_OPEN, next ? '1' : '0'); } catch (e) { /* noop */ } };
      var errKey = wbValidate(f);
      var prompt = errKey ? '' : buildPrompt(f);

      var doFill = function () {
        if (errKey) { setNote({ kind: 'err', key: errKey }); return; }
        var r = pushDraft(props, prompt);
        saveWbCfg(f);
        setHasPrev(true);
        // v19.1.5：填了开场白 ⇒ **本会话要跑的就是这个项目**，顺手建立绑定（并行会话各看各的依据）。
        if (f.project) { saveBind(sid, f.project); setBind(String(f.project)); }
        setNote({ kind: r.ok ? 'ok' : 'err', key: r.channel });
      };
      var doLast = function () { setF(loadWbCfg()); setNote({ kind: 'ok', key: 'wb.lastFilled' }); };
      var doCopy = function () {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(prompt).then(function () { setNote({ kind: 'ok', key: 'wb.copied' }); }, function () { /* 拒绝授权：预览框仍在，可手动选 */ });
          }
        } catch (e) { /* 无剪贴板 API：预览框仍在 */ }
      };

      /** 必填/可选小标（v19.1.6）：`tag === 'req'` 出「必填」、`'opt'` 出「可选」、其余不渲染。 */
      var wbTag = function (tag) {
        if (tag === 'req') return h('span', { style: S.wbTagReq }, t('wb.req'));
        if (tag === 'opt') return h('span', { style: S.wbTagOpt }, t('wb.opt'));
        return null;
      };
      var wbInput = function (key, labelKey, opts) {
        opts = opts || {};
        var val = f[key] === undefined || f[key] === null ? '' : String(f[key]);
        var onChange = function (e) { set(key, opts.type === 'number' ? e.target.value : e.target.value); };
        return h('label', { style: opts.wide ? S.wbFieldWide : S.wbField },
          h('span', { style: S.wbLabel }, t(labelKey), wbTag(opts.tag)),
          opts.textarea
            ? h('textarea', { style: S.wbInput, rows: 2, placeholder: opts.ph || '', value: val, onChange: onChange })
            : h('input', { type: opts.type || 'text', style: S.wbInput, placeholder: opts.ph || '', value: val, onChange: onChange }));
      };
      // v19.4.0：`wbSelect` 增第 5 参 `extra = { tag }`——政策区的下拉要挂「必选」标记，
      //   旧签名只能手写整套 `label/span/select`（同意项当初就是那么写的）。既有 10 处调用不受影响。
      //   v19.4.1（主人裁定「注释说明都去掉」）：`extra.hint` 一并撤除，表单内不再有说明行。
      var wbSelect = function (key, labelKey, options, labelOf, extra) {
        var ex = extra || {};
        return h('label', { style: S.wbField },
          h('span', { style: S.wbLabel }, t(labelKey), ex.tag ? wbTag(ex.tag) : null),
          h('select', { style: S.wbInput, value: String(f[key] === undefined || f[key] === null ? '' : f[key]), onChange: function (e) { set(key, e.target.value); } },
            options.map(function (o) { return h('option', { key: o, value: o }, labelOf ? labelOf(o) : (o === '' ? t('wb.follow') : o)); })));
      };

      var kids = [];
      // 标题栏（v19.1.4 收口）：**进度 chips 就在这里**（主人裁定「再放一条独立的没必要」）——
      //   收起状态即可见；读面失败时给一句短的 + `title` 里放完整原因（含试过的根/项目），不静默。
      var failText = (projs.root || t('wb.ph.defaultRoot')) + ' / ' + sel;
      kids.push(h('div', { style: S.wbBar },
        h(WbIcon, { size: 16 }),
        h('span', { style: S.wbTitle }, t('wb.title')),
        snap.phase === 'ready' ? h('span', { style: S.wbPhRow, title: t('wb.ph.hint') },
          // v19.1.5：多项目时项目名变成**极简切换器**（只切换「看哪一单」，不生成任何文案）；
          //   只有一个项目时不摆控件（多一个控件就是多一分噪音）。选择即写「会话↔项目」绑定。
          projs.list.length > 1
            ? h('select', {
              style: S.wbProjSel, value: sel, title: t('wb.proj.sel'), 'aria-label': t('wb.proj.sel'),
              onChange: function (e) { var v = e.target.value; setSel(v); setBind(v); saveBind(sid, v); },
            }, projs.list.map(function (p) { return h('option', { key: p.name, value: p.name }, p.name); }))
            : h('span', { style: S.wbFieldHint }, sel),
          wbPhases(snap.data).map(function (b) {
            return h('span', { key: b.id, style: b.n > 0 ? S.wbPhOn : S.wbPh }, t('wb.ph.' + b.id) + ' ' + b.n + '/' + b.d);
          }),
          // ⚠️ v19.5.0（T7 反哺批 · §四.18 下半条）：**收起态也必须看得见「卡在哪一步」**——
          //   六块 phase chips 只回答「到哪一阶段」，不回答「上次动过没有 / 现在是不是在等我」。
          //   故在同一行补两格（只读、不可点、零写面）：等待态取 `status.owner`（字面投影，不解析语义），
          //   更新时刻取 `status.lastUpdate`（= status.md 的 mtime，不用启动时间冒充进度）。
          snap.data && snap.data.status && snap.data.status.owner
            ? (snap.data.status.owner.waiting
              ? h('span', { key: 'ownerWait', style: S.wbPhOn, title: t('wb.ph.ownerHint') }, t('wb.ph.ownerWait'))
              : h('span', { key: 'ownerNone', style: S.wbPh, title: t('wb.ph.ownerHint') }, t('wb.ph.ownerNone')))
            : null,
          snap.data && snap.data.status && snap.data.status.lastUpdate
            ? h('span', { key: 'updated', style: S.wbPh, title: t('wb.ph.updHint') }, t('wb.ph.updated').replace('{t}', age(snap.data.status.lastUpdate)))
            : null) : null,
        snap.phase === 'fail' ? h('span', { style: S.wbErr, title: t('wb.ph.failAt').replace('{root}', projs.root || t('wb.ph.defaultRoot')).replace('{proj}', sel) }, t('wb.ph.failShort')) : null,
        // v19.1.6：开关按钮**靠右**（`marginLeft: auto` 在 flex 行里把它推到本行最右；换行时也仍在本行右端）。
        h('button', { style: Object.assign({}, S.btn, { marginLeft: 'auto' }), onClick: toggle, type: 'button' }, open ? t('wb.btn.close') : t('wb.btn.open'))));

      if (open) {
        kids.push(h('div', { style: S.wbBody },
          // v19.1.4（主人裁定）：说明行放**表单里、基本设置上方**，标题栏不再挂它
          //   （标题栏只留：图标 + 名称 + 进度 chips + 展开按钮）。
          h('div', { style: S.wbIntro }, t('wb.sub')),
          h('div', { style: S.wbSec },
            h('div', { style: S.wbSecTitle }, t('wb.sec1')),
            h('div', { style: S.wbGrid },
              wbInput('title', 'wb.f.title', { wide: true, tag: 'req' }),
              wbInput('project', 'wb.f.project', { ph: t('wb.f.projectPh'), tag: 'req' }),
              // v19.4.0：文类改为**手写控件**（不再走 `wbSelect`）——它要在 onChange 里**同批**刷新
              //   派生值（`pickGenre` → `applyDerived`，投影「结构门 / T9 视角」进开场白），
              //   `wbSelect` 的通用 onChange 做不到。v19.4.1：派生值不在面板回显，只经 `buildPrompt` 进开场白。
              h('label', { style: S.wbField },
                h('span', { style: S.wbLabel }, t('wb.f.genre')),
                h('select', { style: S.wbInput, value: String(f.genre || ''), onChange: function (e) { pickGenre(e.target.value); } },
                  [''].concat(GENRES.map(function (g) { return g.code; })).map(function (code) {
                    var g = genreOf(code);
                    return h('option', { key: code, value: code }, code === '' ? t('wb.custom') : (code + ' · ' + (g ? g.scene : '')));
                  }))),
              wbInput('words', 'wb.f.words', { type: 'number' }),
              wbSelect('lang', 'wb.f.lang', WB_LANG),
              wbSelect('tone', 'wb.f.tone', ['', '克制', '中性', '鲜明']),
              wbSelect('styleBaseline', 'wb.f.styleBaseline', WB_STYLE_BASELINE))),
          h('div', { style: S.wbSec },
            h('div', { style: S.wbSecTitle }, t('wb.sec2')),
            h('div', { style: S.wbGrid },
              // v19.4.0：删「工作区根」输入框（死字段）——机制只认**会话工作区根**（`SKILL.md` §触发），
              //   面板当前选中的根就是它；表单再摆一个字段只会与真源打架（旧版填了也无人读）。
              wbInput('materials', 'wb.f.materials', { wide: true, textarea: true, ph: t('wb.f.materialsPh'), tag: 'opt' }),
              h('div', { style: S.wbFieldWide }, h('div', { style: S.wbFieldHint }, t('wb.poolNote'))))),
          h('div', { style: S.wbSec },
            h('div', { style: S.wbSecTitle }, t('wb.sec3')),
            h('div', { style: S.wbGrid },
              wbSelect('retrieval', 'wb.f.scope', WB_RETRIEVAL, null, { tag: 'req' }),
              wbSelect('mask', 'wb.f.mask', WB_MASK),
              // 人在环（v19.1.7，主人指令）：**直接影响主控停几门**，故与外部服务授权两项并列放在政策区。
              //   默认「四门必须」= 机制原文；「全自动」= 主人显式授权，
              //   语义落在机制已有的约定上（各门 `ask_user_question` 的**首个推荐项**）。
              h('div', { style: S.wbFieldWide },
                h('span', { style: S.wbLabel }, t('wb.f.hitl')),
                h('select', { style: S.wbInput, value: String(f.hitl || WB_HITL[0]), onChange: function (e) { set('hitl', e.target.value); } },
                  WB_HITL.map(function (o) { return h('option', { key: o, value: o }, o); })))),
          h('div', { style: S.wbSec },
            // v19.1.6：补上分区标题——旧版这里**只渲染开关按钮**，于是 `wb.sec4`（「高级（可选；留空＝跟随文类）」）
            //   成了死文案：主人根本看不到「整块可选」与「留空＝跟随文类」这条最省事的说明。
            h('div', { style: S.wbSecTitle }, t('wb.sec4')),
            h('button', { style: S.btn, type: 'button', onClick: function () { setAdv(!adv); } }, adv ? t('wb.advHide') : t('wb.adv')),
            adv ? h('div', { style: Object.assign({}, S.wbGrid, { marginTop: '6px' }) },
              // v19.4.0（主人 2026-10-13 授权）：「结构门 / T9 视角」两项都是**文类派生值**
              //   （真源 = `references/_shared/文类档案.md` 对应列，本表是其受机检钉住的派生副本）——
              //   面板另给开关 = 在真源之外造第二个真值来源，且没有任何仲裁规则。
              //   v19.4.1（主人裁定「只读和默认的部分去掉」）：连**只读回显**也撤掉（面板不摆没有选择余地的行），
              //   派生值只经 `buildPrompt` 的 `wb.prompt.l1` / `l2` 进开场白。
              wbSelect('citeStyle', 'wb.f.citeStyle', WB_CITE_STYLE),
              wbSelect('citeMode', 'wb.f.citeMode', WB_CITE_MODE),
              // v19.4.0：删「文献下限」（死字段）——脚本只读 `--genre` 对应的 `GENRE_MIN_L`（`mform-gates.mjs`），
              //   本字段全库零消费者；真源下限见 `references/_shared/文类档案.md`。
              // v19.4.0：`T9 视角` 不再是可编辑控件（`applyDerived` 从文类投影）；v19.4.1 起连只读回显也撤除，
              //   派生值只进开场白（`wb.prompt.l2`），此处不再有任何形态的 T9 控件。
              wbSelect('journal', 'wb.f.journal', WB_JOURNAL),
              // v19.4.0（主人 2026-10-13 裁决）：「质量门」「补扫」两个**假开关**删除——
              //   `rescan` 整删（「补扫」在真源里指两件不同的事，且表单给了第三种默认）；
              //   `quality` 不是面板能决定的开关，真载体 = Phase 0 确认单的「T9·G14 开关」格
              //   （`references/templates/主人确认-template.md:13`）。下游本就靠「`audits/G14-检测报告-*.md`
              //   不存在」当代理信号（`scripts/quality-score.mjs:323`），面板再添一个落点只会重演
              //   `audits/反哺报告-v7-不能评估的忠诚全流程.md:124` 那次把「可关闭」能力说明读成既成裁定的误读。
              //   v19.4.1（主人裁定）：只读回显行也撤除。
              // v19.0.1（主人实测反馈）：目标期刊由**填空改为选项**——数据取自 `期刊数据库.md`
              //   （中文 28 / 英文 12，受机检钉住），并保留「其他（手填）」出口不丢表达力。
              h('div', { style: S.wbField },
                h('span', { style: S.wbLabel }, t('wb.f.targetJournal')),
                h('select', { style: S.wbInput, value: f.targetJournalPick || '', onChange: function (e) { set('targetJournalPick', e.target.value); } }, [
                  h('option', { key: '', value: '' }, t('wb.journal.none')),
                  h('optgroup', { key: 'cn', label: t('wb.journal.cn') }, JOURNALS_CN.map(function (n) { return h('option', { key: n, value: n }, n); })),
                  h('optgroup', { key: 'en', label: t('wb.journal.en') }, JOURNALS_EN.map(function (n) { return h('option', { key: n, value: n }, n); })),
                  h('option', { key: JOURNAL_CUSTOM, value: JOURNAL_CUSTOM }, t('wb.journal.custom')),
                ]),
                f.targetJournalPick === JOURNAL_CUSTOM
                  ? h('input', { type: 'text', style: S.wbInput, placeholder: t('wb.journal.customPh'), value: f.targetJournal, onChange: function (e) { set('targetJournal', e.target.value); } })
                  : null),
              h('div', { style: S.wbField },
                h('span', { style: S.wbLabel }, t('wb.charts')),
                h('button', { style: S.btn, type: 'button', onClick: function () { set('charts', !f.charts); } }, f.charts ? t('wb.chartsOn') : t('wb.chartsOff'))),
              wbInput('brief', 'wb.f.brief', { wide: true, textarea: true, tag: 'opt' })) : null))));
          // v19.1.4（主人裁定「继续已有项目似无必要」）：**整节删除**——续接本来就该在对话里说，
          //   主控按真源读 status.md 即可；摆进表单既多余、又把表单拉长。
          //   进度条仍要项目清单与快照 ⇒ 取数逻辑保留，只是不再有「选项目 + 生成续接开场白」这组控件。

        kids.push(h('div', { style: S.wbPreview }, prompt || t('wb.previewEmpty')));
        kids.push(h('div', { style: S.wbActions },
          h('button', { style: S.wbPrimary, type: 'button', onClick: doFill }, t('wb.fill')),
          h('button', { style: S.btn, type: 'button', onClick: doLast, disabled: !hasPrev }, t('wb.fillLast')),
          h('button', { style: S.btn, type: 'button', onClick: function () { setF(Object.assign({}, WB_DEFAULT)); setNote(null); } }, t('wb.clear')),
          prompt ? h('button', { style: S.btn, type: 'button', onClick: doCopy }, t('wb.copy')) : null,
          note ? h('span', { style: note.kind === 'ok' ? S.ok : S.wbErr }, t(note.key)) : null,
          h('span', { style: S.wbNote }, t('wb.previewHint'))));
      }
      // v19.1.4（主人裁定「上面已经有进度显示了，独立进度条没必要」）：**独立条删除**——进度 chips
      //   就在标题栏里（见上），**同一个事实只在一处呈现**。上一版同时保留了两处 ⇒ 主人当场看见重复，
      //   这是我的漏删（v19.1.1 加的 chips 忘了撤）。
      return h('div', { style: S.wbDock }, h('div', { style: S.wbWrap }, kids));
    }

    function apply(ctx) {
      // v19.0.0 §4.4：**先接宿主 locale**（运行时探测 `ctx.get('locale')`；缺席即降级为内置字典）。
      //   不改 `exports.inject` —— 与面板既有的「零 inject、全 ctx.get 探测」纪律一致。
      installLocale(ctx);

      // v18.92.0：注入一条类样式（官方 `styles.insert`）——hover 微抬升。
      // 为什么用类样式：hover 是伪类，内联样式写不了；且卡片边框是内联的，故 hover 里需 `!important` 才能覆盖。
      // ⚠️ v19.0.0 修复（本批实测发现）：旧版把 `T(...)` 的**实参整体写成了字符串字面量**
      //   （即 `+ "T(<两个实参>)" +` —— 拼接的是那段源码文本，而不是调用结果）——
      //   注入的 CSS 因此是 `border-color:T(<token 名>, <兜底色>) !important`（原样文本，不是 var()），
      //   **浏览器把整条声明丢弃** ⇒ 该 hover 微抬升自 v18.92.0 起**从未生效**（静默失效，正是本包最反感的那类）。
      //   现改为真调用；`tests/panel.test.mjs` 加了回归钉（注入的 CSS 必须含 `var(--dsw-alias-` 且不含 `T(`）。
      try {
        var stylesSvc = ctx && ctx.get ? ctx.get('styles') : null;
        if (stylesSvc && stylesSvc.insert) {
          stylesSvc.insert('.lh-wrap>*{transition:box-shadow .16s ease,border-color .16s ease}' +
            '.lh-wrap>*:hover{border-color:' + T('--dsw-alias-border-l2', '#d0d5dd') + ' !important;box-shadow:0 2px 12px color-mix(in srgb, ' + T('--dsw-alias-label-primary', '#1a202c') + ' 14%, transparent)}');
        }
      } catch (e) { /* 注入失败只降级：不影响面板本体 */ }
      // ① 侧栏面板图标 + 中央面板（两个席位都已在实时客户端服务目录中确认可用）。
      // 自审修正 F2：**整块包 try/catch** —— 旧版若 `slots` 服务形态漂移，`scope.slots.inject` 会抛
      //   TypeError 并让整个浏览器半边 apply 崩掉；面板会**彻底不出现且没有任何提示**（静默失效）。
      //   现在：失败只影响对应座位，异常原因如实进 `SEATS.error` 并在面板页脚显示。
      try {
        ctx.inject(['slots'], function (scope) {
          var a = scope.slots.inject('sidebar.panellist', function () {
            return scope.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: function () { return t('panel.label'); } }, function (props) { return h(PanelIcon, Object.assign({}, props, { ctx: scope })); });
          });
          var b = scope.slots.inject('main', function () {
            return scope.slots.register({ name: 'main', key: PANEL_ID }, function (props) { return h(Panel, Object.assign({}, props, { ctx: scope })); });
          });
          if (typeof a === 'function' && typeof b === 'function') SEATS.main = true;
          // ③ 开工台（v19.0.0 §4.2）：注册到 `conversation.input.dock`（**session 域** list 席位，
          //   官方席位目录原文：Full-width entries above the composer card）。
          //   复用**已就绪的 `slots` 作用域**，故 `exports.inject` 仍为 `[]`、不新增等待面；
          //   注册失败只记 `SEATS.dockError`（并在面板页脚如实汇报），不影响面板本体。
          try {
            var c = scope.slots.inject('conversation.input.dock', function () {
              // v19.1.5：**声明 `inject(sessionId)` 拿本会话身份**——官方同槽位占据者（队列面板）正是用这个
              //   机制拿会话作用域服务的（本地包 `queueDockEntry` 实证：`inject: (sessionId) => ({…})`，
              //   返回值即组件 props）。没有它，并行会话下「当前项目」只能全局猜：两条 bar 会显示同一个项目。
              return scope.slots.register({
                name: 'conversation.input.dock', id: 'lunheng-workbench', order: 40,
                inject: function (sessionId) { return { sessionId: sessionId }; },
              }, function (props) { return h(Workbench, Object.assign({}, props, { ctx: scope })); });
            });
            if (typeof c === 'function') SEATS.dock = true;
          } catch (e2) {
            SEATS.dockError = '开工台席位注册失败：' + (e2 && e2.message ? e2.message : String(e2));
            console.error('[lunheng-workbench]', SEATS.dockError);
          }
        });
      } catch (e) {
        SEATS.error = '主面板注册失败：' + (e && e.message ? e.message : String(e));
        console.error('[lunheng-panel]', SEATS.error);
      }

      // ② 右栏 tab（**可选**：官方契约见 `docs/subsystems/sidebar-right.zh.md` §Tab 类型注册；
      //   本机客户端服务目录里没有 `sidebarRightTabs` / `sidebarRight` —— `ctx.inject` 会一直等待，
      //   回调不执行 ⇒ 天然降级为「未注册」，并在面板页脚**如实**写出，而不是假装有）。
      try {
        ctx.inject(['slots', 'sidebarRightTabs', 'sidebarRight'], function (scope) {
          var tabs = scope.get('sidebarRightTabs');
          if (!tabs || typeof tabs.register !== 'function') return;
          scope.slots.inject('sidebar.right.pane.tab', function () {
            return scope.slots.register({ name: 'sidebar.right.pane.tab', key: PANEL_ID }, function (props) { return h(Panel, Object.assign({}, props, { ctx: scope })); });
          });
          tabs.register({
            id: PANEL_ID,
            kind: PANEL_ID,
            title: function () { return t('panel.rightbarTitle'); },
            // keepMounted（自审修正 F7）：官方定义支持「懒保活」——右栏切走再切回时不重建正文
            //   （否则每次切换都会重连 SSE、丢掉当前选中项目）。失败不影响主面板。
            keepMounted: true,
            guide: { order: 60, title: function () { return t('panel.title'); }, description: function () { return t('panel.rightbarGuide'); } },
          });
          SEATS.rightbar = true;
        });
      } catch (e) {
        SEATS.error = (SEATS.error ? SEATS.error + '；' : '') + '右栏 tab 注册失败：' + (e && e.message ? e.message : String(e));
        console.error('[lunheng-panel]', e);
      }
    }

    exports.apply = apply;
    exports.inject = [];
    exports.__panel = { Panel: Panel, PanelIcon: PanelIcon, Workbench: Workbench, WbIcon: WbIcon, WB_GLYPH_D: WB_GLYPH_D, WB_GLYPH_TF: WB_GLYPH_TF, WB_ICON_GRID: WB_ICON_GRID, PHASES: PHASES, WB_HITL: WB_HITL, WB_HITL_LABEL: WB_HITL_LABEL, WB_HITL_FOUR: WB_HITL_FOUR, WB_HITL_AUTO: WB_HITL_AUTO, wbPhases: wbPhases, api: api, age: age, seatLine: seatLine, SEATS: SEATS, PANEL_ID: PANEL_ID, API: API, S: S, T: T, L10N: L10N, LOCALE: LOCALE, t: t, installLocale: installLocale, GENRES: GENRES, JOURNALS_CN: JOURNALS_CN, JOURNALS_EN: JOURNALS_EN, JOURNAL_CUSTOM: JOURNAL_CUSTOM, WB_DEFAULT: WB_DEFAULT, WB_PROJECT_RE: WB_PROJECT_RE, WB_RETRIEVAL: WB_RETRIEVAL, WB_MASK: WB_MASK, WB_LANG: WB_LANG, WB_STRUCTURE: WB_STRUCTURE, WB_T9: WB_T9, applyDerived: applyDerived, wbValidate: wbValidate, buildPrompt: buildPrompt, pushDraft: pushDraft, loadWbCfg: loadWbCfg, saveWbCfg: saveWbCfg, LS_WB_CFG: LS_WB_CFG, LS_WB_OPEN: LS_WB_OPEN, LS_WB_BIND: LS_WB_BIND, loadBind: loadBind, saveBind: saveBind };
    return module.exports;
  },
});
