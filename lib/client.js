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
    // 实际落点（v18.90.0 自审修正 F1）：**如实记录**注册到了哪些座位。
    //   旧版用「seats 数组长度 > 1」猜座位，而数组里只会被压入 'main' → 无论右栏是否真的可用，
    //   面板都写「（右栏服务不可用）」——一句**不实自述**，正是本包最反感的那类呈现。
    var SEATS = { main: false, rightbar: false, error: null };

    var S = {
      wrap: { font: '12.5px/1.6 "Segoe UI","Microsoft YaHei",system-ui,sans-serif', padding: '14px 16px', color: '#1a202c' },
      h1: { fontSize: '15px', fontWeight: 650, margin: '0 0 10px' },
      card: { border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px', background: '#fff' },
      row: { display: 'flex', gap: '8px', alignItems: 'baseline', margin: '3px 0' },
      k: { color: '#4a5568', minWidth: '84px' },
      mono: { fontFamily: 'ui-monospace,Consolas,monospace', fontSize: '11.5px' },
      dim: { color: '#718096', fontSize: '11.5px' },
      badge: { display: 'inline-block', padding: '1px 7px', borderRadius: '999px', fontSize: '11px', border: '1px solid #cbd5e0', marginRight: '6px' },
      btn: { border: '1px solid #cbd5e0', background: '#f7fafc', borderRadius: '6px', padding: '3px 9px', cursor: 'pointer', fontSize: '12px' },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' },
      td: { borderBottom: '1px solid #edf2f7', padding: '3px 4px', textAlign: 'left' },
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
          h('path', { d: d, fill: 'none', stroke: '#1a56db', strokeWidth: 2 })),
        h('div', { style: S.dim }, pts[0].label + ' ' + pts[0].han + ' → ' + pts[pts.length - 1].label + ' ' + pts[pts.length - 1].han));
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
      var state = react.useState({ phase: 'loading', snap: null, projects: [], project: null, error: null, hostVersion: null });
      var st = state[0], setState = state[1];
      var esRef = react.useRef(null);
      var pollRef = react.useRef(null);

      // 兜底轮询（自审修正 F5）：SSE 断流时按主人裁定的 5s 节拍轮询 `/snapshot`（非流式端点，
      //   本就是为兜底准备的）；任一侧恢复即停轮询——**不让「断流」静默退化成「显示旧数」**。
      var stopPoll = function () { if (pollRef.current) { try { clearInterval(pollRef.current); } catch (e) { /* noop */ } pollRef.current = null; } };
      var startPoll = function (project) {
        if (pollRef.current) return;
        pollRef.current = setInterval(function () {
          api('/snapshot?project=' + encodeURIComponent(project))
            .then(function (s) { setState(function (old) { return Object.assign({}, old, { phase: 'poll', snap: s }); }); })
            .catch(function () { /* 轮询失败：保持 poll 态与最后一帧，不谎称实时 */ });
        }, 5000);
      };

      var connect = react.useCallback(function (project) {
        if (esRef.current) { try { esRef.current.close(); } catch (e) { /* noop */ } esRef.current = null; }
        stopPoll();
        if (!project) return;
        try {
          var es = new EventSource(API + '/events?project=' + encodeURIComponent(project));
          esRef.current = es;
          es.addEventListener('snapshot', function (ev) {
            stopPoll();
            try { setState(function (s) { return Object.assign({}, s, { phase: 'live', snap: JSON.parse(ev.data), error: null }); }); } catch (e) { /* 忽略坏帧 */ }
          });
          es.addEventListener('error', function () {
            // SSE 断线：EventSource 会自动重连。**如实分两态**（自审修正 F8）：已有帧 → 退化为 5s 轮询；
            //   尚无帧 → 标「重连中」占位。两种都不谎称实时。
            setState(function (s) { return Object.assign({}, s, { phase: s.snap ? 'stale' : 'loading' }); });
            startPoll(project);
          });
        } catch (e) {
          setState(function (s) { return Object.assign({}, s, { phase: 'error', error: 'EventSource 不可用：' + e.message }); });
          startPoll(project);
        }
      }, []);

      react.useEffect(function () {
        var alive = true;
        api('/ping').then(function (p) {
          if (!alive) return;
          setState(function (s) { return Object.assign({}, s, { hostVersion: p.version || null }); });
          return api('/projects').then(function (pl) {
            if (!alive) return;
            var list = pl.projects || [];
            var saved = null; try { saved = window.localStorage.getItem(LS_KEY); } catch (e) { /* noop */ }
            var pick = list.some(function (x) { return x.name === saved; }) ? saved : (list[0] && list[0].name);
            // 空态（自审修正 F4）：一个 run/ 项目都没有时旧版会把 phase 永远停在「加载中…」——
            //   现显式进入 empty 态并给出可执行提示，而不是无声地转圈。
            setState(function (s) { return Object.assign({}, s, { projects: list, project: pick || null, roots: pl.root ? [pl.root] : s.roots, phase: pick ? 'loading' : 'empty' }); });
            connect(pick);
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
        connect(name);
      };

      var openRight = function () {
        var svc = ctx && (ctx.get ? ctx.get('sidebarRight') : null);
        if (svc && typeof svc.openTab === 'function') { try { svc.openTab(PANEL_ID); } catch (e) { /* noop */ } }
      };

      if (st.phase === 'off') {
        return h('div', { style: S.wrap }, h('div', { style: S.h1 }, '论衡运行面板'), h('div', { style: Object.assign({}, S.card, { borderColor: '#fbd38d', background: '#fffaf0' }) }, st.error));
      }
      if (st.phase === 'empty') {
        return h('div', { style: S.wrap },
          h('div', { style: S.h1 }, '论衡运行面板', h('span', { style: S.dim }, st.hostVersion ? '  ·  宿主 v' + st.hostVersion : '')),
          h('div', { style: S.card }, '未发现 `run/<项目>/` 项目 —— 先跑一次论衡流水线（Phase 0 起即会生成 `status.md`），或确认宿主注册的工作区根是否包含本工作区。'),
          seatLine());
      }
      var snap = st.snap;
      var roleRows = snap && snap.agents ? snap.agents.roles : [];
      var newest = snap && snap.artifacts ? snap.artifacts.newest : [];
      var rep = snap ? snap.report : null;
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

        h('div', { style: S.card },
          h('div', { style: S.row },
            h('span', { style: S.k }, '项目'),
            h('select', { value: st.project || '', onChange: function (e) { choose(e.target.value); }, style: S.btn },
              (st.projects || []).map(function (p) { return h('option', { key: p.name, value: p.name }, p.name + (p.hasFinal ? ' ✅' : '')); }))),
          h('div', { style: S.row }, h('span', { style: S.k }, '状态行'), h('span', null, (snap && snap.status && snap.status.phaseLine) || '—')),
          h('div', { style: S.row }, h('span', { style: S.k }, '启动'), h('span', { style: S.mono }, (snap && snap.status && snap.status.started) || '—'))),

        h('div', { style: S.card },
          h('div', { style: S.row }, h('span', { style: S.k }, '角色段'),
            h('span', null, roleRows.length ? roleRows.map(function (r) { return h('span', { key: r.role, style: S.badge }, r.role + ' ×' + r.count); }) : '—')),
          h('div', { style: S.row }, h('span', { style: S.k }, 'agents-log'), h('span', { style: S.dim }, (snap && snap.agents && snap.agents.logAge) ? snap.agents.logAge : '—'))),

        h('div', { style: S.card },
          h('div', { style: S.row }, h('span', { style: S.k }, 'M 门'),
            h('span', null, rep && rep.mGate
              ? 'exit ' + rep.mGate.exit + '｜' + rep.mGate.pass + '/' + rep.mGate.total + ' 通过｜P0 ' + rep.mGate.p0 + ' / P1 ' + rep.mGate.p1 + ' / P2 ' + rep.mGate.p2
              : h('span', { style: S.dim }, '（无数字层：跑一次 run-report.mjs --json 生成边车）'))),
          h('div', { style: S.row }, h('span', { style: S.k }, '合规分'), h('span', null, rep && typeof rep.score === 'number' ? rep.score + ' / 100（不是论证质量）' : '—')),
          h('div', { style: S.row }, h('span', { style: S.k }, '轮次/门'), h('span', null, rep ? '轮次 ' + (rep.rounds === null ? '—' : rep.rounds) + ' 行｜门 ' + (rep.gates === null ? '—' : rep.gates) + ' 个' : '—')),
          h('div', { style: S.row }, h('span', { style: S.k }, '字数'), h(Sparkline, { series: rep ? rep.words : [] })),
          rep && rep.generatedAt ? h('div', { style: S.dim }, '数字层截至 ' + rep.generatedAt + '（' + age(rep.generatedAt) + '）—— 面板不实时重算门') : null),

        h('div', { style: S.card },
          h('div', { style: S.row }, h('span', { style: S.k }, '最近产物')),
          h('table', { style: S.table }, h('tbody', null,
            newest.map(function (f) {
              return h('tr', { key: f.rel }, h('td', { style: S.td }, f.rel), h('td', { style: Object.assign({}, S.td, S.dim) }, (f.bytes / 1024).toFixed(1) + ' KB'), h('td', { style: Object.assign({}, S.td, S.dim) }, f.age + ' 前'));
            }))),
          h('div', { style: S.dim }, snap && snap.artifacts ? ('初稿 ' + snap.artifacts.drafts + ' 个版本｜audits ' + snap.artifacts.audits + ' 文件' + (snap.artifacts.hasFinal ? '｜已定稿' : '') + (snap.artifacts.hasEvidence ? '｜证据包在' : '')) : '')),

        h('div', { style: S.row },
          h('button', { style: S.btn, onClick: function () { if (st.project) connect(st.project); } }, '重新连接'),
          h('button', { style: S.btn, onClick: openRight }, '在右栏打开（若宿主支持）')),
        seatLine(),

        h('div', { style: S.dim },
          '只读面：数据来自宿主侧 /lunheng-panel（不写文件、不起子进程、不读凭据）。完整图表报告：',
          h('span', { style: S.mono }, 'node scripts/run-report.mjs run/<项目> --json final/运行报告.json')));
    }

    /** 侧栏图标（`sidebar.panellist`，list 席位：id/order/label）。 */
    function PanelIcon(props) {
      var ctx = props.ctx;
      var select = function () {
        var layout = ctx && (ctx.get ? ctx.get('layout') : null);
        if (layout && typeof layout.selectPanel === 'function') { try { layout.selectPanel(PANEL_ID); } catch (e) { /* noop */ } }
      };
      return h('button', { style: S.btn, title: '论衡运行面板', onClick: select }, '论衡');
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
    exports.__panel = { Panel: Panel, PanelIcon: PanelIcon, api: api, age: age, seatLine: seatLine, SEATS: SEATS, PANEL_ID: PANEL_ID, API: API };
    return module.exports;
  },
});
