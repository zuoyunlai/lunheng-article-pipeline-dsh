// 运行面板（B 批，v18.90.0）契约测试：宿主半边路由 + 客户端半边 lazy-CJS 形态 + 包面声明。
// 运行：node --test tests/panel.test.mjs
//
// 覆盖（每条对应实现里的一处判断）：
//   ① **默认关**：未配置时 `registerPanel` 不注册任何路由（新增读面必须显式开启，仓内既有口径）；
//   ② 开启后路由可认领 `/lunheng-panel/*`：`/ping`、`/projects`、`/snapshot` 的 JSON 形状；
//   ③ **围栏**：`project` 越出 `run/` 或含路径段 → 403；未知端点 404；非 GET → 405；
//   ④ **SSE**：响应头 + 首帧 `snapshot` + `retry` 行（心跳间隔 = 主人裁定的 5 s）；
//   ⑤ `lightSnapshot` 的实时层（status 行 / `### Tn` 段计数 / 最近产物）与数字层（A 批边车）；
//   ⑥ **客户端半边**：是 lazy-CJS 协议（`__ModuleLoader__.load` + `factory` + `exports.apply`）、
//      不引用任何外部 http(s) 资源、只打同源 `/lunheng-panel`；
//   ⑦ **包面**：`dsh.client` 声明 + `exports["./client"]` 指向在盘文件；
//   ⑧ **客户端半边的渲染逻辑**（v18.90.0 自审修正批）：用**最小 React 替身**真正执行
//      `lib/client.js` 的 factory（本机无 `react` 包，实测 profile 与仓库 node_modules 均无），
//      以桩 fetch / EventSource / localStorage 驱动状态机，对**渲染出的文本**断言——
//      锁行为而不是源码字符串。覆盖：实时帧 / 未启用提示 / 空态 / SSE 断流兜底 / 座位如实汇报。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

// ⚠️ **测试必须与环境无关**（v18.90.1 实测教训）：主人一旦 `setx LUNHENG_PANEL 1`，
//   跑测试的 shell 也会继承该变量 → 「默认关」那条断言会被静默变成「开启」。
//   故本文件在加载时先把该变量摘掉；需要验 env 通道的用例自己显式设、用完即删。
delete process.env.LUNHENG_PANEL
const PANEL_STATUS_FILE = join(tmpdir(), 'lunheng-panel-status.json')
const readPanelStatus = () => JSON.parse(readFileSync(PANEL_STATUS_FILE, 'utf8'))
import { tmp } from './_fixtures.mjs'
import { registerPanel, handlePanelRequest, lightSnapshot, listProjects, panelRoots, PANEL_ROUTE, PANEL_HEARTBEAT_MS } from '../lib/panel.mjs'

const ROOT = join(import.meta.dirname, '..')

/** 最小项目夹具：status.md + agents-log.md + 一份 A 批边车。 */
function mkProject(root, name = 'proj-p') {
  const dir = join(root, 'run', name)
  mkdirSync(join(dir, 'drafts'), { recursive: true })
  mkdirSync(join(dir, 'audits'), { recursive: true })
  mkdirSync(join(dir, 'final'), { recursive: true })
  writeFileSync(join(dir, 'status.md'), '# Status\n\n- ✅ **In Progress** — Phase 3（T5 写手出初稿 v1）\n- **启动时间**: 2026-10-01 10:00\n')
  writeFileSync(join(dir, 'agents-log.md'), '### T1 执行记录\n\n### T2 执行记录\n\n### T1 续接记录\n')
  writeFileSync(join(dir, 'drafts', '初稿-v1.md'), '# v1\n')
  writeFileSync(join(dir, 'final', '运行报告.json'), JSON.stringify({
    generatedAt: '2026-10-01T12:00:00.000Z',
    // 形状与 run-report.mjs 的真实边车一致（mGate.summary 是**嵌套**的，不是平铺）
    mGate: { path: 'final/M-Gate-Report.json', summary: { total: 24, pass: 23, p0: 0, p1: 0, p2: 1, skips: 0, exit: 1 }, results: [] },
    scoring: { score: 87.1, coverage: 0.88 },
    words: { series: [{ label: 'v1', han: 100 }, { label: '定稿', han: 120 }] },
    rounds: [{ track: 'A' }], gates: [{ gate: 'Phase0' }, { gate: 'Phase5' }],
  }))
  return dir
}
const mkCtx = (root, sink) => ({
  workspaceRegistry: { list: () => [{ path: root }] },
  webServer: { register: (route) => { sink.route = route; return () => { sink.disposed = true; } } },
})
function mkRes() {
  const res = { code: null, headers: null, chunks: [] }
  res.writeHead = (code, headers) => { res.code = code; res.headers = headers }
  res.write = (s) => { res.chunks.push(String(s)); return true }
  res.end = (s) => { if (s) res.chunks.push(String(s)) }
  return res
}
function mkReq(url, method = 'GET') {
  const h = {}
  return { url, method, on: (ev, fn) => { h[ev] = fn }, emit: (ev) => { h[ev] && h[ev]() } }
}
const body = (res) => JSON.parse(res.chunks.join(''))
const call = (ctx, url, method) => { const res = mkRes(); handlePanelRequest(ctx, mkReq(url, method), res); return res }

test('面板：默认关 —— 未配置时不注册任何 HTTP 路由', () => {
  const sink = {}
  const ctx = mkCtx(tmp(), sink)
  assert.equal(registerPanel(ctx, { panel: false }, () => {}), null)
  assert.equal(sink.route, undefined, '默认不得注册路由（新增读面必须显式开启）')
})

test('面板：开启后注册 prefix 路由，/ping /projects /snapshot 形状正确', () => {
  const d = tmp()
  try {
    mkProject(d)
    const sink = {}
    const ctx = mkCtx(d, sink)
    const dispose = registerPanel(ctx, { panel: true }, () => {})
    assert.equal(typeof dispose, 'function')
    assert.equal(sink.route.kind, 'prefix')
    assert.equal(sink.route.path, PANEL_ROUTE)

    const ping = call(ctx, '/lunheng-panel/ping')
    assert.equal(ping.code, 200)
    assert.equal(body(ping).ok, true)
    assert.equal(body(ping).heartbeatMs, PANEL_HEARTBEAT_MS)
    assert.deepEqual(body(ping).roots, [d])

    const projects = call(ctx, '/lunheng-panel/projects')
    assert.equal(projects.code, 200)
    assert.deepEqual(body(projects).projects.map((p) => p.name), ['proj-p'])

    const snap = call(ctx, '/lunheng-panel/snapshot?project=proj-p')
    assert.equal(snap.code, 200)
    const s = body(snap)
    assert.equal(s.project, 'proj-p')
    assert.match(s.status.phaseLine, /Phase 3/)
    assert.deepEqual(s.agents.roles, [{ role: 'T1', count: 2 }, { role: 'T2', count: 1 }], '### Tn 段计数（含续接段）')
    assert.ok(s.artifacts.newest.length >= 1, '最近产物应有条目')
    assert.equal(s.report.mGate.pass, 23, '数字层来自 A 批边车')
    assert.equal(s.report.score, 87.1)
    assert.equal(s.report.gates, 2)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('面板：围栏 —— 越界项目名 403 / 未知端点 404 / 非 GET 405', () => {
  const d = tmp()
  try {
    mkProject(d)
    const ctx = mkCtx(d, {})
    assert.equal(call(ctx, '/lunheng-panel/snapshot?project=..%2Fetc').code, 403, '含路径段应 403')
    assert.equal(call(ctx, '/lunheng-panel/snapshot?project=../../etc').code, 403)
    assert.equal(call(ctx, '/lunheng-panel/snapshot').code, 400, '缺 project → 400')
    assert.equal(call(ctx, '/lunheng-panel/nope').code, 404)
    assert.equal(call(ctx, '/lunheng-panel/ping', 'POST').code, 405, '只读面只接受 GET/HEAD')
    assert.equal(call(ctx, '/lunheng-panel/snapshot?root=' + encodeURIComponent('C:\\Windows') + '&project=proj-p').code, 403, 'root 必须在本进程已知工作区根内')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('面板：SSE —— 头 + retry + 首帧 snapshot，断连后清理（不留定时器）', () => {
  const d = tmp()
  try {
    mkProject(d)
    const ctx = mkCtx(d, {})
    const req = mkReq('/lunheng-panel/events?project=proj-p')
    const res = mkRes()
    handlePanelRequest(ctx, req, res)
    assert.equal(res.code, 200)
    assert.match(res.headers['content-type'], /text\/event-stream/)
    assert.equal(res.headers['cache-control'], 'no-store')
    const joined = res.chunks.join('')
    assert.match(joined, new RegExp(`retry: ${PANEL_HEARTBEAT_MS}`))
    assert.match(joined, /event: snapshot\ndata: /)
    assert.equal(JSON.parse(joined.slice(joined.indexOf('data: ') + 6).split('\n')[0]).project, 'proj-p')
    req.emit('close')   // 断连 → 清理 watcher 与心跳（否则测试进程会挂住）
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('面板：客户端半边是 lazy-CJS 协议、零外部引用、只打同源面板路由', () => {
  const src = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(src, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(src, /id: 'lunheng-article-pipeline'/)
  assert.match(src, /factory: \(require\)/)
  assert.match(src, /exports\.apply = apply/)
  assert.match(src, /require\('react'\)/)
  assert.ok(!/https?:\/\//.test(src), '客户端半边不得出现任何 http(s) 绝对地址')
  assert.ok(!/<script/.test(src), '客户端半边不得注入 <script>')
  assert.match(src, /EventSource\(API \+ '\/events/, '实时推送走同源 SSE')
})

test('面板：包面声明 —— dsh.client + exports["./client"] 指向在盘文件', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.deepEqual(pkg.dsh.client.inject, [])
  assert.equal(pkg.exports?.['.'], './lib/index.js')
  assert.equal(pkg.exports?.['./client'], './lib/client.js')
  assert.ok(existsSync(join(ROOT, 'lib', 'client.js')), 'exports 声明的文件必须在盘')
  assert.ok(existsSync(join(ROOT, 'lib', 'panel.mjs')), '宿主半边必须在盘')
})

test('面板：listProjects / panelRoots 的读面边界', () => {
  const d = tmp()
  try {
    mkProject(d, 'p1')
    mkdirSync(join(d, 'run', 'no-status'), { recursive: true })     // 无 status.md → 不列
    mkdirSync(join(d, 'run', 'not-a-project.txt'), { recursive: true })
    const names = listProjects(d).map((p) => p.name)
    assert.deepEqual(names, ['p1'], '只列含 status.md 的直接子目录')
    assert.ok(panelRoots({ workspaceRegistry: { list: () => [{ path: d }] } }).includes(d))
    assert.ok(panelRoots({}).length >= 1, 'registry 不可用时兜底到 cwd（不抛）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── v18.90.1：服务迟到 + 状态文件（来自一次真实盲区：入口 active、工具齐全、浏览器半边也挂上，路由却 404）──

test('面板（v18.90.1）：webServer 迟到也接得住 —— ctx.inject 等服务就绪再注册', () => {
  const d = tmp()
  try {
    mkProject(d)
    const sink = {}
    let cb = null
    const ctx = {
      workspaceRegistry: { list: () => [{ path: d }] },
      inject: (deps, fn) => { assert.deepEqual(deps, ['webServer'], '只等 webServer 一个服务'); cb = fn; return () => { sink.off = true } },
    }
    const dispose = registerPanel(ctx, { panel: true }, () => {})
    assert.equal(sink.route, undefined, '服务未就绪时不得注册（也不得放弃等待）')
    assert.equal(typeof cb, 'function', '必须挂上等待（旧版在这里直接放弃 → 路由永不注册）')
    cb({ webServer: { register: (r) => { sink.route = r; return () => { sink.disposed = true } } }, workspaceRegistry: ctx.workspaceRegistry })
    assert.equal(sink.route.path, PANEL_ROUTE, '服务到达即注册')
    assert.equal(sink.route.kind, 'prefix')
    dispose()
    assert.ok(sink.off && sink.disposed, '处置器应同时注销等待与路由')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('面板（v18.90.1）：状态文件如实记录分支（未启用 / config / env），供宿主日志不可读时取证', () => {
  const d = tmp()
  try {
    mkProject(d)
    registerPanel({ workspaceRegistry: { list: () => [{ path: d }] } }, { panel: false }, () => {})
    assert.equal(readPanelStatus().stage, 'disabled')
    const sink = {}
    registerPanel(mkCtx(d, sink), { panel: true }, () => {})
    const st = readPanelStatus()
    assert.equal(st.stage, 'registered')
    assert.equal(st.source, 'config', '来源必须是 config.panel（另一种是 env）')
    assert.equal(st.registered, true)
    assert.ok(st.version && st.at && st.pid, '版本 / 时间 / pid 必填——「装错了要看得见」')
    // env 通道：不设 config、只设 LUNHENG_PANEL
    const sink2 = {}
    process.env.LUNHENG_PANEL = '1'
    try {
      registerPanel(mkCtx(d, sink2), { panel: false }, () => {})
      assert.equal(readPanelStatus().source, 'env')
      assert.ok(sink2.route, 'env 通道也必须真的注册')
    } finally { delete process.env.LUNHENG_PANEL }
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── v18.90.2：入口结构钉（真实宿主根因：注册落在异步链尾段，被 fiber reconcile 的 early-return 吞掉）──

test('入口结构钉（v18.90.2）：registerPanel 必须在**同步段**调用，且只有一处', () => {
  const src = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
  const call = 'registerPanel(ctx, cfg, say)'
  const count = src.split(call).length - 1
  assert.equal(count, 1, `registerPanel 只允许一处调用（异步链里那处会被 early-return 吞掉，重复挂载同样有害），实际 ${count} 处`)
  const callIdx = src.indexOf(call)
  const firstAwaitImport = src.search(/await import\(/)
  assert.ok(firstAwaitImport > 0, '入口应仍用动态 import（本钉的参照点）')
  assert.ok(
    callIdx < firstAwaitImport,
    'registerPanel 必须出现在**第一个 `await import(` 之前**（同步段）。放进异步链会在宿主启动期反复 reconcile 处置 fiber 时'
    + '被 `if (!alive) return` 早退吞掉 ⇒ 面板永不注册（v18.90.0/18.90.1 现场：条目 active、工具齐全、浏览器半边已挂上，'
    + '路由 404 且诊断文件连 enter 都没写）。',
  )
})

test('入口行为（v18.90.3）：即使 ctx.effect 的回调永不执行，registerPanel 仍必须被调用', async () => {
  // 真实宿主实测：18.90.2 把注册放进 `ctx.effect(() => …)` 后，宿主里**连诊断状态文件都没写**、
  // 路由 404；而本地对**同一份已装产物**调 apply 一切正常 ⇒ 差异在宿主对 effect 回调的调度上。
  // 本用例把「effect 回调不执行」做成桩，把这条教训钉成机器判据。
  const calls = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect: () => { calls.push('effect-登记但永不执行'); return () => {} },
    on: () => () => {},
    get: () => undefined,
    inject: (deps) => { calls.push('inject:' + deps.join(',')); return () => {} },
    skills: { register: () => { calls.push('skills.register'); return () => {} } },
    tools: { register: () => () => {} },
  }
  const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  mod.apply(ctx, { panel: true })
  assert.equal(
    calls.filter((c) => c === 'inject:webServer').length,
    1,
    '面板注册不得依赖 effect 回调执行（宿主里它会不执行 ⇒ 面板永不挂载）',
  )
  const st = readPanelStatus()
  assert.match(st.stage, /^(apply-|enter$|registered$|no-inject$|disabled$|skill-threw$|panel-threw$|register-failed$)/, 'apply 必须落诊断标记，实际 ' + st.stage)
  assert.ok(st.version, '标记必须带版本号')
})

test('入口行为（v18.90.3）：配置非法（resolveConfig 抛错）也必须先留下诊断标记', async () => {
  const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect: () => () => {},
    on: () => () => {},
    get: () => undefined,
    inject: () => () => {},
    skills: { register: () => () => {} },
  }
  assert.throws(() => mod.apply(ctx, { 这个键不存在: 1 }), '未知配置键必须在加载期响亮失败（本包既有设计）')
  const bad = readPanelStatus()
  assert.equal(bad.stage, 'apply-threw', '致命错必须留下带阶段的痕迹，而不是只留 apply-enter（要能区分「没跑」与「跑一半死了」）')
  assert.ok(bad.error && bad.error.length > 0, '错误原文必须落盘——宿主日志不落盘时这是唯一线索')
})

test('客户端半边（v18.90.4）：侧栏图标席位渲染**纯 SVG 图标**，且跟随 size / active（不再是方块按钮）', async () => {
  // 主人实测反馈：「论衡运行前面没有图标，只有一个方块」——根因是旧版在**图标席位**里渲染了
  // 带 border+background 的 `<button>论衡</button>`（`S.btn`）。官方席位目录写明：the sidebar owns the
  // button and resolves its label from list metadata；icon 席位的 ownerProps = `{size, active}`。
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const regs = {}
  const slots = { inject: (n, cb) => { regs[n] = cb; return () => {} }, register: (def, comp) => { regs[def.name + '|' + (def.key || def.id)] = comp; return () => {} } }
  mod.apply({ inject: (deps, cb) => cb({ slots, get: () => undefined }) })
  const icon = mod.__panel.PanelIcon
  assert.equal(typeof icon, 'function', '图标席位必须注册')
  assert.equal(mod.__panel.PANEL_ID, 'lunheng-run', '席位 id 是稳定契约（侧栏按钮与主面板靠它配对）')
  const tree = h.render(icon, { size: 18, active: true })
  assert.ok(tree.startsWith('<svg'), '渲染根节点必须是 svg（图标），实际：' + tree.slice(0, 40))
  assert.ok(!tree.includes('<button'), '不得再渲染 button——图标席位只给图标，按钮与标签归侧栏')
  const el = icon({ size: 18, active: true })
  assert.equal(el.type, 'svg')
  assert.equal(el.props.width, 18, '必须跟随席位给的 size')
  assert.equal(el.props.height, 18)
  assert.equal(el.props.stroke, 'currentColor', '必须跟随主题色（侧栏在深/浅色下都能用）')
  assert.equal(el.props.strokeWidth, 2.1, 'active 态加粗')
  assert.deepEqual(el.children.map((c) => c.type), ['rect', 'path'])
  const idle = icon({ active: false })
  assert.equal(idle.props.width, 20, '缺 size 时用 20 兜底')
  assert.equal(idle.props.strokeWidth, 1.7)
  assert.equal(idle.props.style.opacity, 0.72)
})

test('面板：lightSnapshot 缺 status.md 时如实标记（不编造）', () => {
  const d = tmp()
  try {
    const dir = join(d, 'run', 'bare')
    mkdirSync(dir, { recursive: true })
    const s = lightSnapshot(d, 'bare')
    assert.equal(s.status.hasStatus, false)
    assert.equal(s.status.phaseLine, null)
    assert.equal(s.report, null, '无边车 → null（不编 0）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 客户端半边：逻辑级渲染测试（v18.90.0 自审修正批）─────────────────────────────
// **最小 React 替身**：只实现本组件用到的 5 个 API（createElement / useState / useEffect /
//   useCallback / useRef），按「实例序号 + 实例内 hook 序号」保存状态（与 React 的调用顺序契约同形），
//   effect 在一趟渲染提交后 drain；setState 标脏 → 再跑一趟（上限 12 趟防死循环）。
function makeReactStub() {
  const store = []           // 每个组件实例的 hook 槽位（跨趟持久）
  let inst = null, cursor = 0, seq = 0, effects = [], dirty = false
  const hooksFor = () => (store[seq++] || (store[seq - 1] = []))
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(init) { const H = inst, i = cursor++; if (!(i in H)) H[i] = typeof init === 'function' ? init() : init
      // 注意：**闭包必须捕获本实例的 hook 数组**（H）——渲染趟结束后 `inst` 会被复位/指向别的组件，
      //   惰性读 `inst[i]` 会读到 null（这是替身自己的正确性要求，真 React 同样按实例保存状态）。
      const set = (v) => { const next = typeof v === 'function' ? v(H[i]) : v; if (next !== H[i]) { H[i] = next; dirty = true } }
      return [H[i], set] },
    useRef(init) { const i = cursor++; if (!(i in inst)) inst[i] = { current: init }; return inst[i] },
    useCallback(fn, deps) { const i = cursor++; const p = inst[i]; const d = deps || []
      if (!p || JSON.stringify(p.deps) !== JSON.stringify(d)) inst[i] = { fn, deps: d }; return inst[i].fn },
    useEffect(fn, deps) { const i = cursor++; const p = inst[i]; const d = deps || []
      if (!p || JSON.stringify(p.deps) !== JSON.stringify(d)) { inst[i] = { deps: d }; effects.push(fn) } },
  }
  const renderNode = (node) => {
    if (node === null || node === undefined || node === false) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(renderNode).join('')
    if (typeof node.type === 'function') {
      const pInst = inst, pCur = cursor
      inst = hooksFor(); cursor = 0
      const out = renderNode(node.type(Object.assign({}, node.props, { children: node.children })))
      inst = pInst; cursor = pCur
      return out
    }
    return `<${node.type}>${node.children.map(renderNode).join('')}</${node.type}>`
  }
  const render = (Component, props) => {
    let text = '', passes = 0
    for (;;) {
      seq = 0; inst = null; cursor = 0; effects = []
      text = renderNode(React.createElement(Component, props))
      const pend = effects; effects = []
      for (const fn of pend) fn()
      if (!dirty || ++passes > 12) break
    }
    return text
  }
  return { React, render }
}

/** 装载 `lib/client.js`（每次全新实例）并返回其 factory 产物。 */
async function loadClient(reactStub, opts = {}) {
  const captured = {}
  globalThis.window = {
    __ModuleLoader__: { load: (def) => { captured.def = def } },
    localStorage: { getItem: () => opts.saved || null, setItem: () => {} },
  }
  globalThis.EventSource = opts.EventSource || class { constructor(u) { this.url = u; this.listeners = {}; (opts.onES || (() => {}))(this) } addEventListener(t, f) { this.listeners[t] = f } close() { this.closed = true } }
  globalThis.fetch = opts.fetch || (() => Promise.reject(new Error('no fetch stub')))
  const url = pathToFileURL(join(ROOT, 'lib', 'client.js')).href + '?t=' + Math.random()
  await import(url)
  assert.ok(captured.def, 'lib/client.js 必须调用 window.__ModuleLoader__.load')
  const mod = captured.def.factory((name) => { if (name === 'react') return reactStub.React; throw new Error('意外 require: ' + name) })
  return mod
}

const okJson = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

/** 造一个「按 URL 分派」的 fetch 桩，并记录调用。 */
function fetchStub(map) {
  const calls = []
  const fn = (u) => { calls.push(String(u)); for (const k of Object.keys(map)) if (String(u).includes(k)) return map[k]() ; return Promise.reject(new Error('HTTP 404')) }
  fn.calls = calls
  return fn
}
const SNAPSHOT = {
  project: 'p1', at: new Date().toISOString(), status: { phaseLine: 'Phase 3（T5 写手出初稿 v1）', started: '2026-10-01 10:00', hasStatus: true },
  agents: { roles: [{ role: 'T1', count: 2 }], logAge: '5m' },
  artifacts: { newest: [{ rel: 'drafts/初稿-v1.md', bytes: 2048, age: '5m' }], drafts: 1, audits: 3, hasFinal: false, hasEvidence: false },
  report: { generatedAt: '2026-10-01T12:00:00.000Z', mGate: { total: 24, pass: 23, p0: 0, p1: 0, p2: 1, exit: 1 }, score: 87.1, rounds: 5, gates: 4, words: [{ label: 'v1', han: 100 }, { label: '定稿', han: 120 }] },
}

test('客户端半边：有实时帧 → 渲染出项目/状态行/M 门/宿主版本，且座位如实写「已注册」', async () => {
  const h = makeReactStub()
  const es = []
  const mod = await loadClient(h, {
    fetch: fetchStub({ '/ping': () => okJson({ ok: true, version: '18.90.0', roots: ['/w'] }), '/projects': () => okJson({ root: '/w', projects: [{ name: 'p1', hasFinal: false }] }) }),
    onES: (e) => es.push(e),
  })
  // apply 走桩 ctx：注册两个主座位
  const regs = {}
  const slots = { inject: (n, cb) => { regs[n] = cb; return () => {} }, register: (def, comp) => { regs[def.name + '|' + (def.key || def.id)] = comp; return () => {} } }
  mod.apply({ inject: (deps, cb) => cb({ slots, get: () => undefined }) })
  assert.equal(mod.__panel.SEATS.main, true, '主座位注册成功后必须置位')

  const text = await (async () => {
    let t = ''
    for (let i = 0; i < 6; i++) { t = h.render(mod.__panel.Panel, { ctx: null }); await new Promise((r) => setTimeout(r, 0)) }
    return t
  })()
  assert.match(text, /宿主 v18\.90\.0/, '必须显示宿主半边版本（用于分辨装的是哪一版）')
  assert.match(text, /加载中|实时|回退/, '应有新鲜度标注')
  // 推一帧 SSE 快照 → 再渲染
  es[0].listeners.snapshot({ data: JSON.stringify(SNAPSHOT) })
  let t2 = ''
  for (let i = 0; i < 4; i++) { t2 = h.render(mod.__panel.Panel, { ctx: null }); await new Promise((r) => setTimeout(r, 0)) }
  assert.match(t2, /p1/, '项目名应渲染')
  assert.match(t2, /Phase 3/, '状态行应渲染')
  assert.match(t2, /exit 1｜23\/24 通过/, 'M 门摘要应来自数字层')
  assert.match(t2, /87\.1 \/ 100/, '合规分应渲染')
  assert.match(t2, /实时|fs\.watch/, '收到帧后应标实时')
  assert.match(t2, /座位：侧栏图标 \+ 主面板 = 已注册/, '座位必须如实写「已注册」')
  assert.match(t2, /右栏 tab = 未注册/, '未注册的座位必须如实写「未注册」而不是含糊其辞')
})

test('客户端半边：未启用（/ping 404）→ 给可执行提示，而不是空白或假数据', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })   // 任何路径都 404
  mod.apply({ inject: (deps, cb) => cb({ slots: { inject: () => () => {}, register: () => () => {} }, get: () => undefined }) })
  let text = ''
  for (let i = 0; i < 6; i++) { text = h.render(mod.__panel.Panel, { ctx: null }); await new Promise((r) => setTimeout(r, 0)) }
  assert.match(text, /面板未启用或不可达/)
  assert.match(text, /panel: true/, '提示里必须给出开启方式')
})

test('客户端半边：无 run/ 项目 → 进入空态并说明原因（不再无声转圈）', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({ '/ping': () => okJson({ ok: true, version: '18.90.0', roots: [] }), '/projects': () => okJson({ projects: [] }) }) })
  mod.apply({ inject: (deps, cb) => cb({ slots: { inject: () => () => {}, register: () => () => {} }, get: () => undefined }) })
  let text = ''
  for (let i = 0; i < 6; i++) { text = h.render(mod.__panel.Panel, { ctx: null }); await new Promise((r) => setTimeout(r, 0)) }
  assert.match(text, /未发现/)
  assert.doesNotMatch(text, /加载中…$/, '不得停在「加载中」')
})

test('客户端半边：SSE 断流 → 标「回退到 5s 轮询」并真的去拉 /snapshot（兜底不是口号）', async () => {
  const h = makeReactStub()
  const timers = []
  const realSetInterval = globalThis.setInterval
  globalThis.setInterval = (fn) => { timers.push(fn); return { unref() {} } }
  globalThis.clearInterval = () => {}
  try {
    const es = []
    const fetch = fetchStub({ '/ping': () => okJson({ ok: true, version: '18.90.0', roots: ['/w'] }), '/projects': () => okJson({ projects: [{ name: 'p1' }] }), '/snapshot': () => okJson(SNAPSHOT) })
    const mod = await loadClient(h, { fetch, onES: (e) => es.push(e) })
    mod.apply({ inject: (deps, cb) => cb({ slots: { inject: () => () => {}, register: () => () => {} }, get: () => undefined }) })
    let text = ''
    for (let i = 0; i < 6; i++) { text = h.render(mod.__panel.Panel, { ctx: null }); await new Promise((r) => setTimeout(r, 0)) }
    es[0].listeners.snapshot({ data: JSON.stringify(SNAPSHOT) })
    for (let i = 0; i < 3; i++) { text = h.render(mod.__panel.Panel, { ctx: null }); await new Promise((r) => setTimeout(r, 0)) }
    es[0].listeners.error({})
    for (let i = 0; i < 3; i++) { text = h.render(mod.__panel.Panel, { ctx: null }); await new Promise((r) => setTimeout(r, 0)) }
    assert.match(text, /5s 兜底轮询/, '断流必须**当场**如实标注已开启兜底轮询（而不是等第一次轮询成功才说）')
    assert.ok(timers.length >= 1, '断流必须真的挂上兜底定时器')
    const before = fetch.calls.filter((u) => u.includes('/snapshot')).length
    timers[0]()                                    // 手动触发一次兜底轮询
    await new Promise((r) => setTimeout(r, 0))
    const after = fetch.calls.filter((u) => u.includes('/snapshot')).length
    assert.ok(after > before, '兜底定时器必须真的去拉 /snapshot')
  } finally { globalThis.setInterval = realSetInterval }
})

test('客户端半边：右栏服务可用时 → 座位如实写「已注册」，且注册了 kind + keepMounted', async () => {
  const h = makeReactStub()
  const defs = []
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  mod.apply({
    inject: (deps, cb) => cb({
      slots: { inject: (n, f) => { const d = f(); return () => {} }, register: () => () => {} },
      get: (k) => (k === 'sidebarRightTabs' ? { register: (d) => { defs.push(d); return () => {} } } : { openTab: () => {} }),
    }),
  })
  assert.equal(mod.__panel.SEATS.rightbar, true)
  assert.equal(defs.length, 1)
  assert.equal(defs[0].kind, mod.__panel.PANEL_ID)
  assert.equal(defs[0].keepMounted, true, '右栏 tab 应懒保活（避免切换即重连 SSE）')
  const text = h.render(mod.__panel.seatLine, {})
  assert.match(text, /右栏 tab = 已注册/)
})

test('客户端半边：座位注册抛错 → 如实记进 SEATS.error，不静默（也不影响另一半边）', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  mod.apply({ inject: () => { throw new TypeError('slots 服务形态漂移') } })
  assert.match(String(mod.__panel.SEATS.error), /slots 服务形态漂移/)
  assert.equal(mod.__panel.SEATS.main, false)
  assert.match(h.render(mod.__panel.seatLine, {}), /注册异常/)
})
