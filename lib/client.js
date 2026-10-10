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
    // 实际落点（v18.90.0 自审修正 F1）：**如实记录**注册到了哪些座位。
    //   旧版用「seats 数组长度 > 1」猜座位，而数组里只会被压入 'main' → 无论右栏是否真的可用，
    //   面板都写「（右栏服务不可用）」——一句**不实自述**，正是本包最反感的那类呈现。
    var SEATS = { main: false, rightbar: false, error: null };

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
      var palette = [S.chart, S.chart2, S.bad.color, S.idle.color, S.ok.color];  // 依次：绿 / 琥珀 / 红 / 灰 / 绿（状态色板，明暗皆有色）
      return h('div', null,
        h('div', { style: S.stackTrack }, items.map(function (it, i) {
          var pct = (Number(it.value) / total) * 100;
          return h('span', {
            key: it.label, title: it.label + ' · ' + Math.round(pct) + '%',
            style: Object.assign({}, S.stackSeg, { width: pct.toFixed(2) + '%', background: it.color || palette[i % palette.length] }),
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
        (d.figures || []).length ? h('div', { style: { marginTop: '7px' } },
          h('div', { style: S.dim }, '图件 ' + d.figures.length + ' 个（final/图件）'),
          h('div', { style: S.figGrid }, d.figures.map(function (g) {
            return h('a', { key: g.rel, href: link(g.rel), target: '_blank', rel: 'noreferrer', style: S.figItem, title: g.name + ' · ' + fmt(g.kb) },
              h('span', { style: S.figName }, g.name));
          }))) : null,
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
      if (!ph || ph.current === null) return h('div', { style: S.dim }, '（status.md 未给出阶段）');
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
        h('div', { style: S.dim }, '当前 Phase ' + ph.current + ' · 已闭合 ' + ((ph.closed || []).join(' / ') || '—')));
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
      if (SEATS.error) parts.push('注册异常：' + SEATS.error);
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
        return h('div', { style: S.wrap }, h('div', { style: S.h1 }, '论衡运行面板'), h('div', { style: Object.assign({}, S.card, S.tint) }, st.error));
      }
      if (st.phase === 'empty') {
        return h('div', { style: S.wrap },
          h('div', { style: S.h1 }, '论衡运行面板', h('span', { style: S.dim }, st.hostVersion ? '  ·  宿主 v' + st.hostVersion : ''), rootPicker()),
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
        h('div', { style: S.h1 }, '论衡运行面板',
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
            : h(EmptyState, { hint: '还没有数字层边车（M 门汇总 / 合规分 / 字数序列都在它里面）。跑一次：', cmd: (ins.exec ? ins.exec.runReport + ' "run/' + (st.project || '<项目>') + '" --json "run/' + (st.project || '<项目>') + '/final/运行报告.json"' : 'node scripts/run-report.mjs run/' + (st.project || '<项目>') + ' --json final/运行报告.json') })),

        // ② M 门准出门：24 项逐项灯带
        h('div', { style: S.card },
          h(CardTitle, { text: 'M 门准出门（逐项校验）' }),
          rep && rep.gateItems && rep.gateItems.length
            ? h(GateStrip, { items: rep.gateItems })
            : h(EmptyState, { hint: '边车里没有逐项校验结果。重跑一次即可带上：', cmd: 'node scripts/run-report.mjs run/' + (st.project || '<项目>') + ' --json final/运行报告.json' })),

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
              : h(EmptyState, { hint: '还没有 token 数据（面板只读展示，不自己算）。生成：', cmd: (ins.exec ? ins.exec.tokenCost + ' --project "run/' + (st.project || '<项目>') + '" > "run/' + (st.project || '<项目>') + '/final/token-cost.json"' : 'node scripts/token-cost.mjs --project run/' + (st.project || '<项目>') + '  >  final/token-cost.json') })),

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
          h('button', { style: S.btn, onClick: openRight }, '在右栏打开（若宿主支持）')),
        seatLine(),

        h('div', { style: S.dim },
          '只读面：数据来自宿主侧 /lunheng-panel（不写文件、不起子进程、不读凭据）。完整图表报告：',
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
        width: size, height: size, viewBox: '0 0 24 24', role: 'img', 'aria-label': '论衡运行面板',
        fill: 'none', stroke: 'currentColor', strokeWidth: active ? 2.1 : 1.7,
        strokeLinecap: 'round', strokeLinejoin: 'round',
        style: { display: 'block', opacity: active ? 1 : 0.72 },
      },
        h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 4.5 }),
        h('path', { d: 'M8 16.4v-4.1M12 16.4V8M16 16.4V9.6' }));
    }

    function apply(ctx) {
      // v18.92.0：注入一条类样式（官方 `styles.insert`）——hover 微抬升。
      // 为什么用类样式：hover 是伪类，内联样式写不了；且卡片边框是内联的，故 hover 里需 `!important` 才能覆盖。
      try {
        var stylesSvc = ctx && ctx.get ? ctx.get('styles') : null;
        if (stylesSvc && stylesSvc.insert) {
          stylesSvc.insert('.lh-wrap>*{transition:box-shadow .16s ease,border-color .16s ease}' +
            '.lh-wrap>*:hover{border-color:' + "T('--dsw-alias-border-l2', '#d0d5dd')" + ' !important;box-shadow:0 2px 12px color-mix(in srgb, ' + "T('--dsw-alias-label-primary', '#1a202c')" + ' 14%, transparent)}');
        }
      } catch (e) { /* 注入失败只降级：不影响面板本体 */ }
      // ① 侧栏面板图标 + 中央面板（两个席位都已在实时客户端服务目录中确认可用）。
      // 自审修正 F2：**整块包 try/catch** —— 旧版若 `slots` 服务形态漂移，`scope.slots.inject` 会抛
      //   TypeError 并让整个浏览器半边 apply 崩掉；面板会**彻底不出现且没有任何提示**（静默失效）。
      //   现在：失败只影响对应座位，异常原因如实进 `SEATS.error` 并在面板页脚显示。
      try {
        ctx.inject(['slots'], function (scope) {
          var a = scope.slots.inject('sidebar.panellist', function () {
            return scope.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: function () { return '论衡运行'; } }, function (props) { return h(PanelIcon, Object.assign({}, props, { ctx: scope })); });
          });
          var b = scope.slots.inject('main', function () {
            return scope.slots.register({ name: 'main', key: PANEL_ID }, function (props) { return h(Panel, Object.assign({}, props, { ctx: scope })); });
          });
          if (typeof a === 'function' && typeof b === 'function') SEATS.main = true;
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
            title: function () { return '论衡运行'; },
            // keepMounted（自审修正 F7）：官方定义支持「懒保活」——右栏切走再切回时不重建正文
            //   （否则每次切换都会重连 SSE、丢掉当前选中项目）。失败不影响主面板。
            keepMounted: true,
            guide: { order: 60, title: function () { return '论衡运行面板'; }, description: function () { return '实时看 run/<项目> 的阶段、角色、门与产物'; } },
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
    exports.__panel = { Panel: Panel, PanelIcon: PanelIcon, api: api, age: age, seatLine: seatLine, SEATS: SEATS, PANEL_ID: PANEL_ID, API: API, S: S, T: T };
    return module.exports;
  },
});
