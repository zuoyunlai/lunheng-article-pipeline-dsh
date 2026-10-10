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
import { pathToFileURL } from 'node:url'
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
