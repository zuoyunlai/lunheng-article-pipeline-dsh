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
      wrap: { font: '12.5px/1.6 "Segoe UI","Microsoft YaHei",system-ui,sans-serif', padding: '14px 16px', color: T('--dsw-alias-label-primary', '#1a202c') },
      h1: { fontSize: '15px', fontWeight: 650, margin: '0 0 10px' },
      card: { border: '0.5px solid ' + T('--dsw-alias-border-l1', '#e2e8f0'), borderRadius: '10px', padding: '10px 12px', marginBottom: '10px', background: T('--dsw-alias-bg-layer-1', '#ffffff') },
      row: { display: 'flex', gap: '8px', alignItems: 'baseline', margin: '3px 0' },
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
      chart: T('--dsw-alias-brand-primary', '#1a56db'),
      tint: { background: T('--dsw-alias-bg-layer-2', '#fffaf0'), borderColor: T('--dsw-alias-state-warn-primary', '#fbd38d') },
      // ── 图形与信息层级（v18.91.0 起）───────────────────────────────────────────────
      cardTitle: { fontSize: '11px', letterSpacing: '0.06em', color: T('--dsw-alias-label-secondary', '#718096'), textTransform: 'uppercase', marginBottom: '7px' },
      kpiRow: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' },
      kpi: { flex: '1 1 118px', minWidth: '112px', border: '0.5px solid ' + T('--dsw-alias-border-l1', '#e2e8f0'), background: T('--dsw-alias-bg-layer-1', '#ffffff'), borderRadius: '10px', padding: '8px 10px' },
      kpiLabel: { fontSize: '11px', color: T('--dsw-alias-label-secondary', '#718096') },
      kpiValue: { fontSize: '16px', fontWeight: 650, lineHeight: 1.35, color: T('--dsw-alias-label-primary', '#1a202c') },
      barRow: { display: 'flex', alignItems: 'center', gap: '8px', margin: '3px 0' },
      barLabel: { flex: '0 0 84px', fontSize: '11.5px', color: T('--dsw-alias-label-secondary', '#4a5568'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      barTrack: { flex: '1 1 auto', height: '9px', borderRadius: '999px', background: T('--dsw-alias-bg-layer-2', '#edf2f7'), overflow: 'hidden' },
      barFill: { display: 'block', height: '100%', borderRadius: '999px', background: T('--dsw-alias-brand-primary', '#1a56db') },
      barValue: { flex: '0 0 76px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '11.5px', color: T('--dsw-alias-label-primary', '#1a202c') },
      ribbon: { display: 'flex', gap: '3px', margin: '2px 0 5px' },
      seg: { flex: '1 1 0', textAlign: 'center', fontSize: '10.5px', padding: '3px 0', borderRadius: '5px', fontVariantNumeric: 'tabular-nums' },
      segDone: { background: T('--dsw-alias-state-success-primary', '#2f855a'), color: T('--dsw-alias-bg-layer-1', '#ffffff') },
      segNow: { background: T('--dsw-alias-brand-primary', '#1a56db'), color: T('--dsw-alias-bg-layer-1', '#ffffff'), fontWeight: 650 },
      segTodo: { background: T('--dsw-alias-bg-layer-2', '#edf2f7'), color: T('--dsw-alias-label-secondary', '#a0aec0') },
      // ── insights 视觉（v18.91.0）：环形 + 分段条 + 图例 ──────────────────────────────
      ringWrap: { display: 'flex', alignItems: 'center', gap: '12px' },
      ringTrack: { stroke: T('--dsw-alias-bg-layer-2', '#edf2f7') },
      ringLegend: { display: 'flex', flexDirection: 'column', gap: '2px' },
      stackTrack: { display: 'flex', height: '12px', borderRadius: '999px', overflow: 'hidden', background: T('--dsw-alias-bg-layer-2', '#edf2f7') },
      stackSeg: { display: 'block', height: '100%' },
      legend: { display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '6px' },
      legendItem: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: T('--dsw-alias-label-secondary', '#4a5568'), fontVariantNumeric: 'tabular-nums' },
      swatch: { display: 'inline-block', width: '9px', height: '9px', borderRadius: '2px' },
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
      var palette = [S.chart, S.ok.color, S.warn.color, S.bad.color, S.idle.color];
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

    /** 卡片小标题（v18.91.0 起统一用它，替代各处裸文案）。 */
    function CardTitle(props) { return h('div', { style: S.cardTitle }, props.text); }

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

    /** **活动节律柱状图**（v18.91.0）：近 48h、每格 2h 的文件改动次数。 */
    function Histogram(props) {
      var b = props.buckets || [];
      if (!b.length) return h('div', { style: S.dim }, '—');
      var max = Math.max.apply(null, b.concat([1]));
      var W = 260, H = 42, bw = W / b.length;
      return h('div', null,
        h('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'aria-label': '近 48 小时活动节律' },
          b.map(function (v, i) {
            var hh = Math.max(v > 0 ? 1.5 : 0, (v / max) * (H - 4));
            return h('rect', { key: i, x: (i * bw + 0.5).toFixed(1), y: (H - hh).toFixed(1), width: Math.max(1, bw - 1).toFixed(1), height: hh.toFixed(1), fill: v > 0 ? S.chart : 'transparent' });
          })),
        h('div', { style: S.dim }, '48h 前 → 现在（每格 2h，峰值 ' + max + ' 次改动）'));
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
          setState(function (s) { return Object.assign({}, s, { hostVersion: p.version || null, roots: roots }); });
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
            st.hostVersion ? '  ·  宿主 v' + st.hostVersion : '')),

        // ① KPI 行：先给结论（阶段 / 时长 / 角色 / 产物 / 失败）
        snap ? h(Kpis, {
          items: [
            { label: '当前阶段', value: ins.phases && ins.phases.current != null ? 'Phase ' + ins.phases.current : '—', hint: '已闭合 ' + closedCount + ' 段' },
            { label: '已用时长', value: elapsed, hint: (snap.status && snap.status.started) || '' },
            { label: '角色执行', value: roleTotal + ' 次', hint: roleRows.length + ' 个角色 / 9' },
            { label: '产物', value: totalFiles + ' 文件', hint: bytes(totalKb) },
            { label: '异常/收报', value: (ins.failures || 0) + ' / ' + ((ins.handoffs && ins.handoffs.ok) || 0), hint: '失败 / 收报放行', tone: (ins.failures || 0) > 0 ? S.warn.color : null },
          ],
        }) : null,

        h('div', { style: S.card },
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

        h('div', { style: S.card },
          h(CardTitle, { text: '角色段（按 agents-log 的 ### Tn 段计数）' }),
          h(Bars, { items: roleRows.map(function (r) { return { label: r.role, value: r.count, text: '×' + r.count }; }), empty: '（agents-log 里还没有 ### Tn 段）' }),
          h('div', { style: Object.assign({}, S.dim, { marginTop: '4px' }) }, 'agents-log 最后更新 ' + ((snap && snap.agents && snap.agents.logAge) || '—') + ' 前')),

        h('div', { style: S.card },
          h(CardTitle, { text: '产物分布（文件数 / 体积）' }),
          h(StackedBar, { items: dirs.map(function (d) { return { label: d.name, value: d.kb, text: bytes(d.kb) }; }), empty: '（目录还是空的）' }),
          h('div', { style: { marginTop: '8px' } },
            h(Bars, { items: dirs.map(function (d) { return { label: d.name, value: d.files, text: d.files + ' 文件' }; }), empty: '' }))),

        h('div', { style: S.card },
          h(CardTitle, { text: '活动节律（近 48 小时的文件改动）' }),
          h(Histogram, { buckets: ins.activity }),
          ins.drafts && ins.drafts.length > 1 ? h('div', { style: { marginTop: '8px' } },
            h('div', { style: S.dim }, '草稿体积（KB，**字节**不是正文字数）'),
            h(Sparkline, { series: ins.drafts.map(function (d) { return { label: d.name, han: d.kb }; }) })) : null),

        h('div', { style: S.card },
          h(CardTitle, { text: '质量数字层（来自 final/运行报告.json）' }),
          rep && rep.mGate
            ? h('div', null,
              h('div', { style: S.row }, h('span', { style: S.k }, 'M 门'),
                h('span', null, h('span', { style: rep.mGate.exit === 0 ? S.ok : S.warn }, 'exit ' + rep.mGate.exit),
                  '｜' + rep.mGate.pass + '/' + rep.mGate.total + ' 通过｜P0 ' + rep.mGate.p0 + ' / P1 ' + rep.mGate.p1 + ' / P2 ' + rep.mGate.p2)),
              h(Ring, {
                pct: rep.mGate.total ? (rep.mGate.pass / rep.mGate.total) * 100 : 0,
                center: rep.mGate.pass + '/' + rep.mGate.total,
                label: 'M 门通过率',
                hint: 'P0 ' + rep.mGate.p0 + ' · P1 ' + rep.mGate.p1 + ' · P2 ' + rep.mGate.p2,
                color: rep.mGate.p0 > 0 ? S.bad.color : rep.mGate.p1 > 0 ? S.warn.color : S.ok.color,
              }))
            : h('div', { style: S.dim }, '（尚无数字层 —— 它会带来 M 门汇总 / 合规分 / 字数序列三张图）'),
          h('div', { style: S.row }, h('span', { style: S.k }, '合规分'), h('span', null, rep && typeof rep.score === 'number' ? rep.score + ' / 100（不是论证质量）' : '—')),
          h('div', { style: S.row }, h('span', { style: S.k }, '轮次/门'), h('span', null, rep ? '轮次 ' + (rep.rounds === null ? '—' : rep.rounds) + ' 行｜门 ' + (rep.gates === null ? '—' : rep.gates) + ' 个' : '—')),
          h('div', { style: S.row }, h('span', { style: S.k }, '字数'), h(Sparkline, { series: rep ? rep.words : [] })),
          !rep ? h('div', { style: Object.assign({}, S.dim, { marginTop: '5px' }) },
            '生成命令：', h('span', { style: S.mono }, 'node scripts/run-report.mjs run/' + (st.project || '<项目>') + ' --json final/运行报告.json')) : null,
          rep && rep.generatedAt ? h('div', { style: Object.assign({}, S.dim, { marginTop: '5px' }) }, '数字层截至 ' + rep.generatedAt + '（' + age(rep.generatedAt) + '）—— 面板不实时重算门') : null),

        h('div', { style: S.card },
          h(CardTitle, { text: '最近改动' }),
          h('table', { style: S.table }, h('tbody', null,
            newest.map(function (f) {
              return h('tr', { key: f.rel }, h('td', { style: S.td }, f.rel), h('td', { style: Object.assign({}, S.td, S.dim, { textAlign: 'right' }) }, (f.bytes / 1024).toFixed(1) + ' KB'), h('td', { style: Object.assign({}, S.td, S.dim, { textAlign: 'right' }) }, f.age + ' 前'));
            }))),
          h('div', { style: S.dim }, snap && snap.artifacts ? ('初稿 ' + snap.artifacts.drafts + ' 个版本｜audits ' + snap.artifacts.audits + ' 文件' + (snap.artifacts.hasFinal ? '｜已定稿' : '') + (snap.artifacts.hasEvidence ? '｜证据包在' : '')) : '')),

        h('div', { style: S.row },
          h('button', { style: S.btn, onClick: function () { if (st.project) connect(st.project, st.root); } }, '重新连接'),
          h('button', { style: S.btn, onClick: openRight }, '在右栏打开（若宿主支持）')),
        seatLine(),

        h('div', { style: S.dim },
          '只读面：数据来自宿主侧 /lunheng-panel（不写文件、不起子进程、不读凭据）。完整图表报告：',
          h('span', { style: S.mono }, 'node scripts/run-report.mjs run/<项目> --json final/运行报告.json')));
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
