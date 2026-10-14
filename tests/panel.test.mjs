// 运行面板（B 批，v18.90.0）契约测试：宿主半边路由 + 客户端半边 lazy-CJS 形态 + 包面声明。
// 运行：node --test tests/panel.test.mjs
//
// 覆盖（每条对应实现里的一处判断）：
//   ① **默认开**（v18.93.0）：未配置时也注册路由；`LUNHENG_PANEL=0` / `config.panel: false` 可显式关闭；
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

test('面板：默认开（v18.93.0）—— 缺省即开；\`panel: false\` 显式关闭', () => {
  // ① 缺省（未写该键）= 开：不得打印「未启用」提示。
  //    注：注册可能走 inject-wait 异步路径，故这里只做**同步可判**的判据（同步断言"有路由"会假失败）。
  const logs = []
  registerPanel(mkCtx(tmp(), {}), {}, (m) => logs.push(m))
  assert.ok(!logs.some((l) => String(l).includes('未启用')), '缺省必须视为开启（v18.93.0 起默认开）')
  // ② 显式 false = 关：直接返回 null 且不注册任何路由
  const sink = {}
  assert.equal(registerPanel(mkCtx(tmp(), sink), { panel: false }, () => {}), null)
  assert.equal(sink.route, undefined, '显式关闭时不得注册路由')
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

test('面板（v18.90.6 根因回归）：宿主式严格 ctx（裸读服务直接抛）也必须经 inject 注册成功', () => {
  // 隔离宿主实测原文：`cannot get property "webServer" without inject` —— 本 Cordis 版本对
  // **未在 inject 声明里列出的服务**做裸属性读会抛。18.90.0–18.90.5 就是因为 registerPanel 第一行
  // 裸读 `ctx?.webServer?.register`，四版全部在「注册」之前就死。本用例把该行为做成桩（getter 抛错）。
  const d = tmp()
  try {
    mkProject(d)
    const sink = {}
    const ctx = {
      get: () => undefined,
      inject: (deps, cb) => {
        assert.deepEqual(deps, ['webServer'], '只等 webServer')
        cb({ get: () => ({ register: (r) => { sink.route = r; return () => { sink.disposed = true } } }) })
        return () => { sink.off = true }
      },
    }
    Object.defineProperty(ctx, 'webServer', { get() { throw new TypeError('cannot get property "webServer" without inject') } })
    Object.defineProperty(ctx, 'workspaceRegistry', { get() { return { list: () => [{ path: d }] } } })
    registerPanel(ctx, { panel: true }, () => {})
    assert.equal(sink.route?.path, PANEL_ROUTE, '裸读会抛也必须在 inject 回调里注册成功')
    assert.equal(sink.route?.kind, 'prefix')
    const st = readPanelStatus()
    assert.equal(st.stage, 'registered', '步骤历史必须落 registered')
    assert.ok(st.steps.some((s) => s.stage === 'inject-wait'), '必须留下 inject-wait 这一步（可判读）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('客户端半边（v18.90.7）：多工作区根 → 逐根探测，选**真有项目**的根，并把 root 带给 SSE', async () => {
  // 真实场景：宿主给的第一个根是「插件所在仓库」（没有 run/），主人的 39 个项目在第二个根下。
  // 旧版只用第一个根 ⇒ 面板显示「未发现项目」。本用例锁住「逐根探测 + 选中根 + root 透传」。
  const h = makeReactStub()
  const es = []
  const calls = []
  const route = (u) => {
    const s = String(u); calls.push(s)
    if (s.includes('/ping')) return okJson({ ok: true, version: '18.90.6', roots: ['/repo-no-run', '/work-with-run'] })
    if (s.includes('/projects') && s.includes(encodeURIComponent('/repo-no-run'))) return okJson({ root: '/repo-no-run', projects: [] })
    if (s.includes('/projects')) return okJson({ root: '/work-with-run', projects: [{ name: 'p9', hasFinal: true }] })
    if (s.includes('/snapshot')) return okJson(SNAPSHOT)
    return Promise.reject(new Error('HTTP 404'))
  }
  const mod = await loadClient(h, { fetch: (u) => route(u), onES: (e) => es.push(e) })
  let text = ''
  for (let i = 0; i < 6; i++) { text = h.render(mod.__panel.Panel, { ctx: null }); await new Promise((r) => setTimeout(r, 0)) }
  assert.ok(calls.some((u) => u.includes('/projects') && u.includes(encodeURIComponent('/repo-no-run'))), '必须**探测过**第一个（空）根，而不是想当然')
  assert.equal(es.length, 1, '必须接上唯一一条实时流')
  assert.match(es[0].url, /project=p9/, '应选中有项目的 p9')
  assert.ok(es[0].url.includes('root=' + encodeURIComponent('/work-with-run')), 'SSE 必须带上选中的根，实际 ' + es[0].url)
  assert.match(text, /p9/, '项目应出现在选择器里')
  assert.match(text, /work-with-run/, '标题栏应显示当前工作区根（多根时可切换）')
})

test('客户端半边（v18.90.8）：配色只用 DSH 语义 token（随明暗主题），不写颜色字面量、不自造明暗分支', async () => {
  // 官方口径（docs/web-styling.zh.md）：功能组件用 `--dsw-alias-*` 语义 token，「不得复制静态色板值或在
  //   其中写入颜色字面量」「不得包含主题选择器」；明暗偏好归 ui-theme，由 ui-layout 应用到文档。
  //   ⇒ 面板必须靠 token 自动跟随，而不是自己判断 dark。
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const S = mod.__panel.S
  assert.ok(S.card.background.includes('--dsw-alias-bg-layer-1'), '卡片底色必须是语义 token：' + S.card.background)
  assert.ok(S.wrap.color.includes('--dsw-alias-label-primary'), '正文色必须是语义 token')
  assert.ok(S.dim.color.includes('--dsw-alias-label-secondary'), '次要文字色必须是语义 token')
  assert.ok(S.card.border.includes('--dsw-alias-border-l1'), '描边必须是语义 token')
  assert.ok(S.btn.background.includes('--dsw-alias-bg-layer-2'), '控件底色必须是语义 token')
  assert.ok(String(S.chart).includes('--dsw-alias-state-success-primary'), '图表主系列必须用**有色**的状态 token')
  // v18.91.2 回归钉：曾用 brand-primary 当图表主色，而本机主题里它是**墨色（近黑）** ⇒ 整片图变黑（主人实测）
  assert.ok(!String(S.chart).includes('brand-primary'), '图表主系列**不得**再用 brand-primary（本机主题里是墨色）')
  assert.ok(!String(S.segNow.background).includes('brand-primary'), '「进行中」片段不得用 brand-primary')
  assert.ok(!String(S.barFill.background).includes('brand-primary'), '条形图填充不得用 brand-primary（主人实测：那一排条全变黑）')
  // v18.94.1：产物分布色板必须 9 项且互不相同（主人实测：不同项同色 → 分不清）。
  //   注：渲染桩不带属性，故此处对**客户端源码**做机械断言（色板是源码里的显式数组）。
  {
    const src = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
    const m = /var palette = \[(.*)\];/m.exec(src)
    assert.ok(m, '产物分布必须有显式色板数组')
    let depth = 0
    let cur = ''
    const parts = []
    for (const ch of m[1]) {
      if (ch === '(' || ch === '[') depth += 1
      else if (ch === ')' || ch === ']') depth -= 1
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue }
      cur += ch
    }
    if (cur.trim()) parts.push(cur.trim())
    assert.equal(parts.length, 9, '色板须 9 项（9 个目录一一对色，不再取模撞色），实际 ' + parts.length)
    assert.equal(new Set(parts).size, parts.length, '色板各项不得重复')
    assert.match(src, /color-mix\(in srgb/, '浅色变体须由 color-mix 派生（随明暗主题走）')
  }
  assert.ok(S.ok.color.includes('--dsw-alias-state-success-primary') && S.bad.color.includes('--dsw-alias-state-error-primary'), '状态色必须是状态 token')
  // 兜底值：宿主未定义 token 时退化成浅色旧观感，而不是不可读
  for (const k of ['card', 'wrap', 'dim', 'k']) {
    const v = JSON.stringify(S[k])
    assert.match(v, /var\(--dsw-[a-z0-9-]+, #/, k + ' 的 token 必须带兜底值：' + v)
  }
  // 源码级：剥掉 token 兜底值后，不得残留任何颜色字面量；也不得出现自造的明暗分支
  const src = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  const stripped = src.replace(/T\('[^']+',\s*'#[0-9a-fA-F]{3,8}'\)/g, 'T(TOKEN)')
  const left = stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || []
  assert.deepEqual(left, [], '除 token 兜底值外不得出现颜色字面量：' + left.join(','))
  assert.ok(!/prefers-color-scheme/.test(src), '不得用媒体查询自造明暗分支——那归主题所有方')
  assert.ok(!/['"]dark['"]\s*:/.test(src), '不得在样式里编码 dark 分支')
  assert.deepEqual(src.match(/T\('[^']+'\)/g) || [], [], '每个 token 都必须带兜底值（单参 T() 一律拒绝）')
  // token 名白名单：**真源 = 本机客户端目录**（`cordis_inspect_query client Theme.listTokens`，14 个）。
  //   拼错一个字母的后果很隐蔽——`var(--typo, #fff)` 会静默退化到浅色兜底，面板在暗色主题下依旧发白。
  const KNOWN = new Set([
    '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
    '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-brand-primary',
    '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
    '--dsw-alias-state-error-primary', '--dsw-alias-state-idle-primary',
    '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
    '--dsw-specific-sidebar-fill',
  ])
  const used = new Set((src.match(/T\('(--dsw-[a-z0-9-]+)'/g) || []).map((s) => s.slice(3, -1)))
  assert.ok(used.size >= 8, '应大量使用主题 token，实际 ' + used.size + ' 个')
  for (const t of used) assert.ok(KNOWN.has(t), '用了不在主题目录里的 token 名：' + t)
})

test('面板（v18.91.0）：快照带 insights —— 阶段链 / 题名文类目标篇幅 / 九宫格分布 / 48h 节律（全部只读派生）', () => {
  const d = tmp()
  try {
    const dir = mkProject(d)
    // 把夹具补成「有 meta 与阶段链」的形态，并造出 3 个目录、若干文件（含 mtime 分布）
    writeFileSync(join(dir, 'status.md'), [
      '# Status',
      '- 🔄 **In Progress** — Phase 3（T5 写手出初稿 v1）；**Phase 1/2/2.5 全部 ✅ 闭合**',
      '- **题名**：路径依赖与决策时点：台海问题可预测性的边界在哪里（24 字）',
      '- **文类**: `academic-hum`｜**目标篇幅**: 13000 字（纠偏线 12740–13260；G8 硬阈 11700–13650）',
      '- `[Failed 20:47]` T1 首派 — 零落盘',
      '- T3 ✅ `handoff-check --role T3 --report-file` → **exit 22（放行）**',
      '',
    ].join('\n'))
    mkdirSync(join(dir, 'literature'), { recursive: true })
    writeFileSync(join(dir, 'literature', '文献卡.md'), 'x'.repeat(2048))
    writeFileSync(join(dir, 'audits', '反哺报告-综合-v1.md'), 'y'.repeat(1024))
    const s = lightSnapshot(d, 'proj-p')
    const ins = s.insights
    assert.equal(ins.meta.title, '路径依赖与决策时点：台海问题可预测性的边界在哪里')
    assert.equal(ins.meta.genre, 'academic-hum')
    assert.equal(ins.meta.targetWords, 13000)
    assert.deepEqual(ins.meta.calibrate, [12740, 13260])
    assert.deepEqual(ins.meta.hard, [11700, 13650])
    assert.equal(ins.phases.current, 3)
    assert.deepEqual(ins.phases.closed, [1, 2, 2.5])
    assert.equal(ins.failures, 1, '失败记录计数')
    assert.equal(ins.handoffs.ok, 1, '收报放行（exit 22）计数')
    const names = ins.dirs.map((x) => x.name)
    for (const n of ['literature', 'data', 'cases', 'analysis', 'drafts', 'audits', 'final', 'final/图件', 'final/证据包']) {
      assert.ok(names.includes(n), '九宫格必须每一项都在，缺 ' + n)
    }
    assert.equal(ins.dirs.find((x) => x.name === 'literature').files, 1)
    assert.ok(ins.dirs.find((x) => x.name === 'literature').kb >= 2, 'literature 至少 2KB')
    assert.equal(ins.activity.length, 24, '节律必须固定 24 格（缺格用 0 补齐，不画「不确定」）')
    assert.ok(ins.activity.reduce((a, b) => a + b, 0) >= 1, '刚写的文件应落进最后一格')
    assert.ok(Array.isArray(ins.drafts) && ins.drafts.length >= 1, '草稿体积序列')
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
  // v19.0.0：记录**最近一次被调用的组件所返回的元素树**——桩的 `render()` 只回字符串，
  //   而「点击某按钮会调用哪个 handler」需要元素树本身。断言用 `h.tree()` 取树后按标签找按钮
  //   （宿主元素的 props.onClick 就在树上）。纯增量能力，不影响既有断言。
  // v19.1.5：只记**最外层**组件返回的树。旧版是「最后一个渲染完的组件」胜出——一旦组件里有子组件
  //   （如标题图标 `WbIcon`），`tree()` 会返回**子组件**的树，于是「在树上找按钮/输入框」会扑空。
  let lastTree = null
  let depth = 0
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
      const isTop = depth === 0
      depth++
      inst = hooksFor(); cursor = 0
      const produced = node.type(Object.assign({}, node.props, { children: node.children }))
      const out = renderNode(produced)
      depth--
      if (isTop) lastTree = produced
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
  return { React, render, tree: () => lastTree }
}

/** 装载 `lib/client.js`（每次全新实例）并返回其 factory 产物。 */
async function loadClient(reactStub, opts = {}) {
  const captured = {}
  globalThis.window = {
    __ModuleLoader__: { load: (def) => { captured.def = def } },
    // v19.1.5：localStorage 桩升级为**按键存取**（`savedByKey`），并保留旧的 `saved`（任意键都回同一值）语义——
    //   没有它就无法测「会话 ↔ 项目」绑定（旧桩忽略键、setItem 是空实现）。
    localStorage: opts.localStorage || {
      getItem: (k) => ((opts.savedByKey && Object.prototype.hasOwnProperty.call(opts.savedByKey, k)) ? opts.savedByKey[k] : (opts.saved || null)),
      setItem: (k, v) => { if (opts.savedByKey) opts.savedByKey[k] = String(v); },
      removeItem: (k) => { if (opts.savedByKey) delete opts.savedByKey[k] },
    },
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
  report: {
    generatedAt: '2026-10-01T12:00:00.000Z', mGate: { total: 24, pass: 23, p0: 0, p1: 0, p2: 1, exit: 1 },
    score: 87.1, rounds: 5, gates: 4, words: [{ label: 'v1', han: 100 }, { label: '定稿', han: 120 }],
    // v18.92.0 六张新图的输入
    gateItems: [
      { id: 'M-Form-1', gate: 'M-Form-1 引用标注完整性', severity: '通过' },
      { id: 'M-Exist-4', gate: 'M-Exist-4 复核裁定', severity: 'P0' },
      { id: 'M-Form-9', gate: 'M-Form-9 图件闭环', severity: 'P2' },
    ],
    scoreComponents: [
      { id: 'M-Gate', name: 'M 门机械项', weight: 38, ratio: 0.8333, applicable: true, note: '' },
      { id: 'structure', name: '学术结构', weight: 8, ratio: null, applicable: false, note: '非 IMRaD 体例' },
    ],
    qlt6: {
      score: 0, coverage: 0.5, coverageWarning: '适用权重 50/100——本条只覆盖了 1/2 个分量，不得当整体论证强度结论',
      na: [{ id: 'panel', weight: 50, reason: '无审稿整合报告' }],
      components: [{ id: 'closure', name: '论证缺陷闭合率', weight: 50, ratio: 0, applicable: true }],
    },
  },
}

test('客户端半边（v18.91.0）：insights 到位时渲染出**图表**（KPI / 阶段带 / 条形图 / 节律柱 / 草稿折线）', async () => {
  // 面板从「文字表」升级为图形面板：断言的是**图形元素真的被画出来**（svg/rect/阶段带段数/条形条目），
  //   而不是「有没有那几个字」——图形退化成文字必须被测出来。
  const h = makeReactStub()
  const es = []
  const withInsights = Object.assign({}, SNAPSHOT, {
    insights: {
      meta: { title: '路径依赖与决策时点', genre: 'academic-hum', targetWords: 13000, calibrate: [12740, 13260], hard: [11700, 13650] },
      phases: { current: 3, closed: [1, 1.5, 2, 2.5] },
      dirs: [{ name: 'drafts', files: 17, kb: 694 }, { name: 'audits', files: 32, kb: 345 }, { name: 'final', files: 47, kb: 621 }],
      activity: [0, 0, 50, 21, 0, 0, 0, 0, 43, 25, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      activityMeta: { bucketMs: 7200000, from: Date.now() - 48 * 3600000, to: Date.now(), peak: 50, total: 140, activeBuckets: 5, scanned: 140, windowHours: 48 },
      failures: 3, handoffs: { ok: 9, retry: 0 },
      deliverables: {
        figures: [{ name: '图1_x.svg', kb: 3, mtime: Date.now() - 3600000, rel: 'final/图件/图1_x.svg' }],
        finalFiles: [
          { rel: 'final/定稿.md', label: '定稿（Markdown 主交付）', kb: 64, mtime: Date.now() - 7200000 },
          { rel: 'final/运行报告.json', label: '运行报告边车（JSON）', kb: 36, mtime: Date.now() - 3600000 },
        ],
        process: [{ rel: 'drafts', label: '草稿', count: 3, newest: { name: '初稿-v6.md', mtime: Date.now(), kb: 64 } }],
      },
      exportCmds: [
        { format: 'HTML', cmd: 'node scripts/md2html.mjs run/x/final/定稿.md run/x/final/定稿.html', note: '仓内转换器' },
        { format: 'Word', cmd: 'pandoc run/x/final/定稿.md -o run/x/final/定稿.docx', note: '需 pandoc' },
        { format: 'PDF', cmd: 'pandoc run/x/final/定稿.md -o run/x/final/定稿.pdf --pdf-engine=xelatex', note: '需 pandoc + XeLaTeX' },
        { format: 'LaTeX', cmd: 'pandoc run/x/final/定稿.md -o run/x/final/定稿.tex --standalone', note: '需 pandoc' },
      ],
      compare: { root: 'E:\\tmp', scanned: 3, self: 'p1', items: [{ name: 'p1', pass: 23, total: 24, p0: 0, score: 87.1, words: 7, at: null }, { name: 'p2', pass: 22, total: 24, p0: 0, score: 89.1, words: 6, at: null }] },
      evidence: { draft: '初稿-v6.md', sections: [{ title: '1 引言', L: 6, D: 12, C: 3 }, { title: '2 理论框架', L: 9, D: 4, C: 0 }], totals: { L: 15, D: 16, C: 3 } },
      review: { report: '审稿整合报告-v6.md', views: [{ view: 'T9-d 领域学者', dims: [{ name: '理论贡献', score: 4 }, { name: '文献对话', score: 4 }, { name: '论证逻辑', score: 4 }, { name: '领域准确性', score: 4 }, { name: '学术规范', score: 5 }], total: 21, max: 25, verdict: '小修' }, { view: 'T9-m 方法学', dims: [{ name: '识别策略', score: 4 }, { name: '案例选择', score: 4 }, { name: '反事实设计', score: 5 }, { name: '可证伪预测', score: 5 }, { name: '方法论披露', score: 4 }], total: 22, max: 25, verdict: '接收' }, { view: 'T9-s 学界编辑', dims: [{ name: '贡献度', score: 4 }, { name: '引用规范', score: 4 }, { name: '学术伦理披露', score: 4 }, { name: '文末声明完整性', score: 5 }, { name: '整体可发表性', score: 4 }], total: 21, max: 25, verdict: '小修' }] },
      active: { ms: 6503754, spanMs: 77103123, segs: 5, gapMinutes: 15, files: 140 },
      drafts: [{ name: '初稿-v2', kb: 62, kind: 'draft', mtime: Date.now() - 7200000 }, { name: '修订说明-v2', kb: 9.4, kind: 'revision', mtime: Date.now() - 5400000 }, { name: '初稿-v6', kb: 64.1, kind: 'draft', mtime: Date.now() - 3600000 }],
    },
  })
  const mod = await loadClient(h, {
    fetch: fetchStub({ '/ping': () => okJson({ ok: true, version: '18.91.0', roots: ['/w'] }), '/projects': () => okJson({ root: '/w', projects: [{ name: 'p1', hasFinal: false }] }) }),
    onES: (e) => es.push(e),
  })
  let text = ''
  for (let i = 0; i < 6; i++) { text = h.render(mod.__panel.Panel, { ctx: null }); await new Promise((r) => setTimeout(r, 0)) }
  es[0].listeners.snapshot({ data: JSON.stringify(withInsights) })
  let t = ''
  for (let i = 0; i < 3; i++) { t = h.render(mod.__panel.Panel, { ctx: null }); await new Promise((r) => setTimeout(r, 0)) }
  // KPI 行（先给结论）
  assert.match(t, /当前阶段/, 'KPI 行应渲染')
  assert.match(t, /活跃时长（不含人在环）/, 'KPI 行应含「活跃时长（不含人在环）」')
  assert.match(t, /间隔≤15min 计连续/, 'KPI 提示必须写明活跃时长的算法口径（启发式，不是精确工时）')
  assert.match(t, /异常\/收报/, 'KPI 行应含失败/收报')
  // 阶段带：已闭合的阶段片段必须真的出现（1 / 1.5 / 2 / 2.5 + 当前 3）
  for (const s of ['1.5', '2.5', '3']) assert.ok(t.includes('>' + s + '<'), '阶段带应含 Phase ' + s + ' 片段')
  assert.match(t, /当前 Phase 3/, '阶段带应写明当前阶段')
  // 条形图：角色段 + 产物分布（含人类可读体积）
  assert.match(t, /角色段（按 agents-log/, '角色段条形图标题应渲染')
  assert.match(t, /产物分布（体积）/, '产物分布卡应在场（已拆成单项卡）')
  assert.match(t, /各目录文件数/, '文件数应独立成卡（一张卡只放一项）')
  assert.match(t, /T9 三视角审稿/, 'T9 三视角审稿应独立成卡')
  assert.match(t, /跨项目对比/, 'v18.94.0：跨项目对比卡应在场')
  assert.match(t, /不是质量排序/, '跨项目对比必须写明口径（不是质量排序）')
  assert.match(t, /694 KB/, '产物分布应给出体积（组成条图例）')
  assert.match(t, /17 文件/, '产物分布应给出文件数（条形图）')
  // 活动节律：柱状图 = svg + 多个 rect
  assert.match(t, /活动节律（近 48 小时的文件改动）/, '活动节律标题应渲染')
  const rects = (t.match(/<rect>/g) || []).length
  assert.ok(rects >= 20, '节律柱应画满 24 格，实际 rect ' + rects)
  assert.match(t, /峰值 50/, '节律图例应给出峰值（不编造）')
  // v18.91.1 细化：坐标轴 / 悬浮提示 / 工作段色带 / 草稿双系列——**图要真的给出信息**，不是几根光秃秃的柱子
  assert.ok((t.match(/<title>[^<]*次改动<\/title>/g) || []).length >= 20, '每格都应有悬浮提示（时间窗 + 次数）')
  assert.match(t, /\d\d-\d\d \d\d:\d\d/, 'x 轴应给绝对时钟刻度，而不是「48h 前」这种模糊说法')
  assert.match(t, /工作段（mtime 会话化）/, '活动图应画出工作段（机器真在干活的时间）')
  assert.match(t, /改动次数（每格 2h）/, '活动图应有图例')
  assert.match(t, /初稿 ×2/, '草稿图应按系列统计（初稿 / 修订说明）')
  assert.match(t, /修订说明 ×1/, '草稿图应把「修订说明」单独成系列')
  // v18.91.1 字数图细化：目标走廊（硬阈 + 纠偏线色带）/ 目标线 / 逐点提示 / 起→终增减与末版判定
  assert.match(t, /G8 硬阈/, '字数图应画出 G8 硬阈走廊')
  assert.match(t, /纠偏线/, '字数图应画出纠偏线走廊')
  assert.match(t, /目标 13000 字/, '字数图应标出目标篇幅（来自 status.md）')
  assert.ok(/<title>[^<]*字（距目标[^<]*<\/title>/.test(t), '每个版本点应有悬浮提示：字数 + 距目标')
  assert.match(t, /Δ [+\-]?\d+/, '应给出起 → 终的增减')
  assert.match(t, /末版(在纠偏线内|越纠偏线|破 G8 硬阈)/, '应给出末版相对目标走廊的判定（只做区间比较，不做质量评价）')
  // v18.91.1 版式：质量数字层从「一列靠左长文字」改成「环形 + 统计格 + 计量条」
  assert.match(t, /P0（必须为 0）/, 'M 门应拆成统计格（P0/P1/P2/跳过），而不是一行顿号文字')
  assert.match(t, /修订轮次/, '轮次应进统计格')
  assert.match(t, /阶段门/, '阶段门应进统计格')
  assert.match(t, /M 门通过率/, '环形应保留（左）')
  assert.match(t, /不是论证质量/, '合规分必须保留这句限定（避免被读成论证质量）')
  // v18.92.0 六张新图：准出门 / 合规分构成 / QLT-6 / 证据密度 / 证据热力 / 三视角雷达
  assert.match(t, /M 门准出门/, 'M 门准出门应在场')
  assert.ok((t.match(/<title>[^<]*M-[A-Za-z]+-\d[^<]*<\/title>/g) || []).length >= 3, '准出门每格应有悬浮提示（项 id + 门名 + 结论）')
  assert.match(t, /P0 ×1/, '准出门图例应给出各档计数')
  assert.match(t, /合规分构成/, '合规分构成应在场')
  assert.match(t, /不适用 · w8/, '不适用的分量必须画灰并标注权重，不得当 0 分')
  assert.match(t, /论证强度 QLT-6/, 'QLT-6 应在场')
  assert.match(t, /不得当整体论证强度结论/, 'QLT-6 必须带出覆盖率告警原话')
  assert.match(t, /证据密度/, '证据密度图应在场')
  assert.match(t, /章节 × 证据类型/, '章节×类型热力应在场')
  assert.match(t, /只数标记，不判引用质量/, '热力图注必须写明口径（只数标记、不判引用质量）')
  assert.match(t, /T9 三视角审稿/, '三视角雷达应在场')
  // v18.93.0 交付件与图件卡：下载 / 预览 / 图件 / 四格式复制命令
  assert.match(t, /交付件与图件应在场|交付件与图件/, '交付件与图件卡应在场')
  assert.ok((t.match(/<a/g) || []).length >= 3, '交付件与图件应有下载/预览链接，实际 ' + (t.match(/<a/g) || []).length)
  assert.match(t, /定稿（Markdown 主交付）/, '交付件应用标签名列出')
  assert.match(t, /图1_x\.svg/, '图件应列出文件名')
  for (const f of ['HTML', 'Word', 'PDF', 'LaTeX']) assert.ok(t.includes(f), '导出格式按钮应有 ' + f)
  assert.match(t, /需 pandoc/, '缺少外部工具时必须如实标注依赖（PDF/Word/LaTeX）')
  // 注意：测试替身渲染宿主元素时**不带属性**，故这里按 '<polygon' 计数（预览器/真浏览器才带属性）
  assert.ok((t.match(/<polygon/g) || []).length >= 12, '三个雷达各应有环+面（≥12 个 polygon），实际 ' + (t.match(/<polygon/g) || []).length)
  assert.match(t, /理论贡献 4/, '雷达轴标签应给出维度名 + 分数')
  // 草稿体积折线（并如实标注是字节不是字数）
  assert.match(t, /草稿演进（KB，\*\*字节\*\*不是正文字数）/, '草稿折线图注必须如实标注口径')
  // insights 视觉（参照「上下文洞察」那类观感）：分段组成条 + 图例 + 百分比 + 环形占比
  assert.match(t, /M 门通过率/, '环形图应带图例文字')
  assert.ok((t.match(/<circle>/g) || []).length >= 2, '环形图应画「轨道 + 进度」两段圆环，实际 ' + (t.match(/<circle>/g) || []).length)
  assert.match(t, /\d+%/, '图例或图注应给出百分比')
})

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
  assert.match(t2, /exit 1/, 'M 门 exit 应渲染')
  assert.match(t2, /23\/24 通过/, 'M 门摘要应来自数字层')
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

test('v18.93.0：/file 只读下载——项目内 200 + 四类越界 403 + 缺失 404 + 超限 413 + 目录 403', () => {
  const d = tmp()
  try {
    mkProject(d, 'proj-file')
    const ctx = mkCtx(d, {})
    const base = PANEL_ROUTE + '/file?root=' + encodeURIComponent(d) + '&project=proj-file&rel='
    // ① 正常下载：项目内已存在的产物
    const ok = call(ctx, base + encodeURIComponent('final/运行报告.json'))
    assert.equal(ok.code, 200)
    assert.match(ok.headers['content-type'], /application\/json/)
    assert.match(ok.headers['content-disposition'], /^attachment/)
    assert.equal(ok.headers['x-content-type-options'], 'nosniff')
    assert.ok(JSON.parse(ok.chunks.join('')).scoring, '下载内容必须是该文件本身')
    // ② 越界四类 + 空 rel 一律 403
    for (const bad of ['../../../etc/passwd', 'final/../../x.md', '/etc/passwd', 'final\\x.md', '']) {
      assert.equal(call(ctx, base + encodeURIComponent(bad)).code, 403, '必须拒绝：' + JSON.stringify(bad))
    }
    // ③ 缺失文件 404；目录 403
    assert.equal(call(ctx, base + encodeURIComponent('final/不存在.md')).code, 404)
    assert.equal(call(ctx, base + encodeURIComponent('final')).code, 403)
    // ④ 超限 413（上限 8 MB）
    writeFileSync(join(d, 'run', 'proj-file', 'final', 'big.bin'), Buffer.alloc(9 * 1024 * 1024))
    assert.equal(call(ctx, base + encodeURIComponent('final/big.bin')).code, 413)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('v18.93.0：交付件与导出命令派生（只读工作区内的既有产物）', () => {
  const d = tmp()
  try {
    mkProject(d, 'proj-dl')
    const snap = lightSnapshot(d, 'proj-dl')
    const dl = snap.insights.deliverables
    assert.ok(dl, '必须有 deliverables 派生')
    assert.ok(dl.finalFiles.some((f) => f.rel === 'final/运行报告.json' && f.kb > 0), '边车应作为交付件列出')
    assert.equal(dl.process.length, 7, '过程件分七组（含证据包）')
    assert.ok(Array.isArray(dl.figures), '图件必须是数组（无图件时为空）')
    const cmds = snap.insights.exportCmds
    assert.equal(cmds.length, 4, '四种格式各给一条命令')
    assert.deepEqual(cmds.map((c) => c.format), ['HTML', 'Word', 'PDF', 'LaTeX'])
    assert.match(cmds[0].cmd, /md2html\.mjs/, 'HTML 走仓内转换器')
    assert.match(cmds[2].cmd, /xelatex/, 'PDF 命令须含 xelatex（并已在 UI 标注需 pandoc）')
    assert.ok(snap.insights.compare && Array.isArray(snap.insights.compare.items), 'v18.94.0：应派生跨项目对比（同根各项目边车摘要）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ════════════════════════════════════════════════════════════════════════════════════════════
// v19.0.0：开工台（§4.2）+ 宿主 locale 桥（§4.4）+ hover 类样式修复
// ════════════════════════════════════════════════════════════════════════════════════════════

/** L10N/DATA 块外**代码行**中文字面量的**棘轮基线**（v19.4.0 同批再测 **250**，只许降；v19.0.2 起口径 =
 *  只数会被渲染的代码行——**整行注释不计**，v19.1.6 起 `//`、`/**`、`*` 三种注释开头都算注释）。
 *  历史：v19.0.0 = 340（含派生数据）→ v19.0.1 = 268（划出 DATA 区）→ v19.0.2 = 267（只数代码行）
 *  → v19.1.6 = 264（块注释也算注释，去掉 4 处 JSDoc 假阳性）→ v19.4.0 = 257（开工台三控件改造：
 *  端到端删掉 consent/scopeLit/scopeCase/scopeData/minLit/root 六项旧文案，同时把开场白末段四条
 *  纪律搬进 L10N 块改走 `t()`）→ v19.4.0 同批 **250**（甲案表单侧：结构门/T9 降只读、题名与
 *  引用模式改标签、infer/charts/lang/brief 等提示与「Phase 0 其余必答项」清单**全部进 L10N 块**，
 *  块外只净减）。**基线数字一律以本用例自身的计数为准**：外部脚本数出的 245/257 是**欠计数**，
 *  只有与最后一次实测一致才可采信（每次改 `lib/client.js` 后按实测下调，只降不升）。
 *  新文案进 L10N 块用 `t()`；派生数据进 DATA 块。 */
const OUTSIDE_CN_BASELINE = 250

// ── v19.0.1：主人装新版后的三条实测反馈 ────────────────────────────────────────────────────────

test('开工台（v19.4.0）：检索范围必选且默认「全网检索」；旧的「外发同意 4 选 1」已整体拆解', async () => {
  // 病灶沿革（主人 2026-10-13 追问链）：旧的 4 选 1 把「检索范围 / 脱敏档 / 推理位置 / SVG 与文生图」四件
  //   不同的事压进**一个**选择，于是任何一档都在暗示别的事也跟着变（实测：选「脱敏+SVG+本地」被读成
  //   「不外发 = 不联网检索」，二者其实无关）。本批按已获采纳的 §4 方案拆成**两个正交下拉**；
  //   v19.4.1（主人裁定「把注释说明都去掉；只读和默认的部分去掉」）：「推理位置」只读徽标一并撤除。
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const P = mod.__panel
  assert.equal(P.WB_DEFAULT.retrieval, '全网检索', '检索范围默认必须是「全网检索」')
  assert.equal(P.WB_DEFAULT.mask, 'basic', '脱敏档默认 basic（H2 恒定档；strict 才是真选项）')
  assert.deepEqual(P.WB_RETRIEVAL, ['全网检索', '仅本地素材'], '两档取值必须与素材池 §十一 逐字一致')
  assert.deepEqual(P.WB_MASK, ['basic', 'strict'])
  assert.equal(P.WB_CONSENT, undefined, '旧 4 选 1 的选项表必须**整体消失**（不是换个名字留着）')
  assert.equal(P.WB_DEFAULT.consent, undefined, '旧 consent 字段必须从默认表里去掉')
  // 开场白：不改任何项即应能直接生成，且带**三段式授权串**
  const prompt = P.buildPrompt(Object.assign({}, P.WB_DEFAULT, { title: 'T', project: 'P1' }))
  assert.match(prompt, /- 外部服务授权：检索=全网检索 \/ 推理=<[^>]+> \/ 脱敏=basic/, '默认档必须能直接生成三段式授权串')
  assert.ok(!/外发同意/.test(prompt), '开场白里不得再有「外发同意」一行（已被授权串取代）')
  // 组件层面：两个下拉都在、都**不含空值项**（空值经 `wbSelect` 会渲染成「跟随文类」，对本区语义不通）
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined } }
  h.render(P.Workbench, props)
  wbButton(h.tree(), '打开').props.onClick()
  h.render(P.Workbench, props)
  const hasOpt = (kids, v) => (kids || []).some((c) => Array.isArray(c) ? hasOpt(c, v) : (c && c.props && c.props.value === v))
  const retSel = wbFind(h.tree(), (n) => n.type === 'select' && hasOpt(n.children, '仅本地素材'))
  assert.ok(retSel, '检索范围下拉必须存在且含「仅本地素材」')
  assert.ok(!hasOpt(retSel.children, ''), '检索下拉不得有空值项（它现在被 wbValidate 硬拦，空值 = 每次开工先卡一下）')
  const maskSel = wbFind(h.tree(), (n) => n.type === 'select' && hasOpt(n.children, 'strict'))
  assert.ok(maskSel, '脱敏档下拉必须存在且含 strict')
  assert.ok(!hasOpt(maskSel.children, ''), '脱敏下拉不得有空值项')
  // 「推理位置」面板**不给开关**，且 v19.4.1 起连只读行也不摆：它由会话 provider 决定，不是主人的选题。
  const text = h.render(P.Workbench, props)
  assert.ok(!/推理位置/.test(text), '面板不得再出现「推理位置」只读行（主人 2026-10-13 裁定）')
  assert.equal(P.L10N.zh['wb.f.infer'], undefined, '其标签文案必须同批从 L10N 撤除，不留孤儿键')
  assert.equal(P.L10N.zh['wb.inferBadge'], undefined, '其徽标文案必须同批撤除')
  // 同批撤除的其余只读块文案：结构门 / T9 视角 / G14 / Phase 0 其余必答项
  for (const gone of ['wb.f.structure', 'wb.derivedFollow', 'wb.derivedHint', 'wb.f.t9',
    'wb.f.g14', 'wb.qualityBadge', 'wb.f.p0left', 'wb.p0leftList']) {
    assert.equal(P.L10N.zh[gone], undefined, gone + ' 属只读块文案，必须同批撤除')
  }
  assert.equal(P.S.wbInfer, undefined, '只读徽标样式必须同批撤除（面板里已无宿主）')
  assert.equal(P.S.wbInferDot, undefined, '只读徽标圆点样式必须同批撤除')
  // 「注释说明」全清：表单里不得再有任何 `S.wbFieldHint` 行，唯余标题栏的单项目名（`:2099` 那处）——
  //   它由**标题栏**渲染，不在打开的表单体内。
  let hintInsideForm = 0
  const wbBody = wbFind(h.tree(), (n) => n.props && n.props.style === P.S.wbBody)
  const walkHint = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walkHint); return }
    if (node.props && node.props.style === P.S.wbFieldHint) hintInsideForm++
    ;(node.children || []).forEach(walkHint)
  }
  walkHint(wbBody)
  assert.equal(hintInsideForm, 0, '表单体内不得再有说明行（主人 2026-10-13 裁定：注释说明都去掉）')
})

test('开工台（v19.4.0）WB-13：每个表单字段都登记了消费点（script 类真命中脚本锚点 / prompt 类真落到开场白）', async () => {
  // 为什么要这条：v19.3.0 的开工台字段**没有任何用例**钉「字段 ↔ 真源消费点」，于是三类病一起潜伏
  //   （证据链见 audits/反哺报告-2026-10-13-开工台字段对齐-v1.md）：
  //   ① 真死字段（工作区根 / 文献下限：机制只认会话工作区根与 GENRE_MIN_L[文类]，表单值无人读）；
  //   ② **消费点格式对不上 ⇒ 静默失效**（旧开场白 `- 篇幅上限: 8000 汉字` 过不了 target-chars 的 LINE_RE，
  //      apply-revision-cycle / apply-compression-cycle 遂**跳过 G8 字数硬阈且 exit 0**）；
  //   ③ 自造档位（IEEE / 结构门 off / T9 关闭：真源根本没有这些取值）。
  // 本条把它们变成**机器可核的登记表**：新增字段不登记就红；登记为 script 的必须真在脚本里命中锚点。
  const S = 'skills/lunheng-article-pipeline/'
  const FIELDS = [
    // ── script：被 `scripts/**` 直接读（锚点失配 = 该消费点已消失）──────────────────────────
    { k: 'project', kind: 'script', file: 'scripts/handoff-check.mjs', re: /01-任务简报\.md/,
      why: '项目目录名 → run/<项目> 下一切机检的入口（如 A11 读简报头部授权串）' },
    { k: 'genre', kind: 'script', file: 'scripts/_lib/mgate-gates/mform-gates.mjs', re: /GENRE_MIN_L/,
      why: '文类决定文献下限（GENRE_MIN_L[文类]），表单自填的「文献下限」从来不是输入' },
    { k: 'words', kind: 'script', file: 'scripts/_lib/target-chars.mjs', re: /(?:目标篇幅|篇幅)/,
      why: '目标字数 → G8 硬阈；见本用例 ④ 的格式敏感断言' },
    { k: 'retrieval', kind: 'script', file: 'scripts/handoff-check.mjs', re: /检索\s*=/,
      why: '三段式授权串第一段（A11）；仅本地素材时按 素材池 §11.2 派三检索员' },
    { k: 'mask', kind: 'script', file: 'scripts/handoff-check.mjs', re: /脱敏\s*=/,
      why: '三段式授权串第三段（A11），与简报 `ETHICS=` 同源（二选一即可，都缺才判硬）' },
    { k: 'hitl', kind: 'script', file: 'scripts/handoff-check.mjs', re: /A7/,
      why: '四门必须 → 交付前的四份阶段确认单（A7 判据码；`--require-gates` 才判）' },
    { k: 'structure', kind: 'script', file: 'scripts/g-audit-check.mjs', re: /structure-check/,
      why: '结构门 v19.4.0 起是**文类派生值**（面板无控件，经 `applyDerived` 从 `GENRES[genre].structure` 投影；真源 = `_shared/文类档案.md`「结构门」列）→ T7.5 记录必提 structure-check（缺 ⇒ P1），所以它**关不掉**' },
    { k: 'citeStyle', kind: 'script', file: 'scripts/cite-format.mjs', re: /'gbt', 'apa'/,
      why: '引用格式白名单只有 gbt/apa，其余 exit 10（IEEE 暂缓：引用格式.md §五）' },
    { k: 'citeMode', kind: 'script', file: 'scripts/_lib/target-chars.mjs', re: /内联/,
      why: '编号 / 内联 → **交付形态**（v19.4.0 澄清：稿内一律 `[Lxx]`，内联由主控在交付阶段转写）；此处是内联引注的计数口径' },
    { k: 't9', kind: 'script', file: 'scripts/apply-revision-cycle.mjs', re: /T9/,
      why: 'T9 视角 v19.4.0 起是**文类派生值**（面板无控件，经 `applyDerived` 从 `GENRES[genre].t9` 投影；真源 = `_shared/文类档案.md`「T9 视角」列）→ T9 修订轮次口径' },
    { k: 'targetJournal', kind: 'script', file: 'scripts/journal-fit.mjs', re: /目标期刊/,
      why: '期刊名是**位置参数**，J-Reason / J-Cycle / J-Format 三项据此判定' },
    { k: 'charts', kind: 'script', file: 'scripts/m-gate-check.mjs', re: /fig-dir|配图/,
      why: '图件 → M 门图件判据（|F|=0 且正文有配图承诺 ⇒ P0）' },
    { k: 'brief', kind: 'script', file: 'scripts/g-audit-check.mjs', re: /'--brief'/,
      why: '研究问题/写作要点 → G 审计读简报的落点' },
    // ── prompt：无脚本消费者，只有主控读开场白（照抄进简报）后按文字约定执行 ──────────────
    { k: 'title', kind: 'prompt', re: /^- 题名: /m,
      why: '开场白题名 → 简报题名；**无脚本消费者**（题名本身不参与任何机检）' },
    { k: 'lang', kind: 'prompt', re: /^- 语言: /m,
      why: '**无脚本消费者**；且 count-chars 只数汉字（\\u4E00-\\u9FFF）⇒ 选 English 会连环撞字数门' },
    { k: 'tone', kind: 'prompt', re: /^- 文风: /m,
      why: '**零机器消费点**：「文风档位」只出现在 failure-modes.md 的文字说明里' },
    { k: 'materials', kind: 'prompt', re: /投喂材料/,
      why: '自由文本投喂；机制要的是 主人投喂清单-template.md 的 8 列表格（本项只传递路径/说明）' },
    { k: 'journal', kind: 'prompt', re: /期刊匹配: /,
      why: '**有机器消费点**（本批较早时误记为「无消费者」、还误删了「可选」档，均已订正）：mexist-gates.mjs:872-895（M-Exist-6）按优先级 ① 审稿报告自述 `/启用期刊匹配|期刊匹配助手/` → ② 简报 `01-任务简报.md` 的 `/启用期刊匹配/` 字面 判定；真载体 = templates/任务简报-template.md:67 的「**启用期刊匹配**」勾选式。值域三档「默认启用/可选/关闭」均取自文类档案「期刊匹配」列（:16-20）' },
    // ── internal：不直接落开场白，由面板自身合成 ──────────────────────────────────────────
    { k: 'targetJournalPick', kind: 'internal',
      why: '期刊库下拉；buildPrompt 里与 targetJournal 合成同一行「目标期刊」' },
  ]
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const P = mod.__panel
  const keys = Object.keys(P.WB_DEFAULT)
  // ① 双向完备：表单字段 ⇄ 登记表（新增字段不登记就红；登记表留着已删字段也红）
  for (const k of keys) {
    assert.ok(FIELDS.some((f) => f.k === k), '字段 ' + k + ' 没有登记消费点（填了等于没填？先证明它有人读）')
  }
  for (const f of FIELDS) {
    assert.ok(keys.includes(f.k), '登记表里的 ' + f.k + ' 已不是表单字段，登记表需同步删')
    assert.ok(f.why && f.why.length > 6, f.k + ' 的登记必须写清「谁读它」')
  }
  // ② script 类：脚本在 + 锚点命中（防登记表自己说谎）
  for (const f of FIELDS.filter((f) => f.kind === 'script')) {
    const p = join(ROOT, S, f.file)
    assert.ok(existsSync(p), f.k + ' 的消费脚本不存在：' + f.file)
    assert.match(readFileSync(p, 'utf8'), f.re, f.k + ' 的消费锚点在 ' + f.file + ' 里失配（消费点已消失？）')
  }
  // ③ prompt 类：真落到开场白（否则这一项连主控都读不到）
  const filled = Object.assign({}, P.WB_DEFAULT, { title: 'T', project: 'P1', materials: '素材池' })
  const prompt = P.buildPrompt(filled)
  for (const f of FIELDS.filter((f) => f.kind === 'prompt')) {
    assert.match(prompt, f.re, f.k + ' 必须出现在开场白里（否则这一项填了等于没填）')
  }
  // ④ 格式敏感项：篇幅行必须能被 target-chars.mjs 的 LINE_RE 真解析到
  //    （真源 scripts/_lib/target-chars.mjs:30；旧串「- 篇幅上限: 8000 汉字」的「上限」二字卡在
  //     字段名与冒号之间 ⇒ 两张 cycle 脚本静默跳过 G8 字数硬阈且 exit 0）
  const tc = readFileSync(join(ROOT, S, 'scripts', '_lib', 'target-chars.mjs'), 'utf8')
  assert.ok(tc.includes('(?:目标篇幅|篇幅)'), 'target-chars 的篇幅行契约已变，本用例 ④ 需同步')
  const wordsLine = prompt.split('\n').find((l) => l.includes('目标篇幅'))
  assert.ok(wordsLine, '开场白必须有篇幅行')
  assert.ok(/(?:目标篇幅|篇幅)[\s*_`]{0,4}[:：][\s*_`]{0,4}([^\n]{0,24})/.test(wordsLine),
    '篇幅行过不了 target-chars 的 LINE_RE（会静默跳过字数硬阈）：' + wordsLine)
  // ⑤ 死字段禁令：v19.4.0 已从表单删除，不得复活（复活 = 重新引入「填了等于没填」）
  //   `quality` / `rescan` 系主人 2026-10-13 裁决删除（前者降为只读提示、后者整删），同列禁令。
  for (const gone of ['root', 'minLit', 'consent', 'scopeLit', 'scopeCase', 'scopeData', 'quality', 'rescan']) {
    assert.ok(!keys.includes(gone), gone + ' 是死字段/已拆解字段，不得再回到表单')
  }
  // ⑥ v19.4.0：结构门 / T9 视角是**文类派生值**，不得再成为可编辑字段。
  //   `applyDerived` 必须把 `GENRES[genre]` 的两列投影到 `f.structure` / `f.t9`（自定义文类 ⇒ 空）。
  //   真源 = `references/_shared/文类档案.md`「结构门」「T9 视角」两列；`GENRES` 是受另一用例逐行钉住的副本。
  assert.equal(typeof P.applyDerived, 'function', 'applyDerived 必须导出（面板用它做派生投影）')
  for (const g of P.GENRES) {
    const f = P.applyDerived({ genre: g.code })
    assert.equal(f.structure, g.structure, g.code + ' 的结构门应投影为档案预置值')
    assert.equal(f.t9, g.t9, g.code + ' 的 T9 视角应投影为档案预置值')
  }
  assert.equal(P.applyDerived({ genre: '' }).structure, '', '未选文类 ⇒ 结构门留空（跟随文类，不猜档）')
  assert.equal(P.applyDerived({ genre: 'not-a-genre' }).structure, '', '自定义文类 ⇒ 结构门留空（无投影可依）')
  assert.equal(P.L10N.zh['wb.derivedHint'], undefined, 'v19.4.1：派生只读说明已随只读块撤除（派生值只进开场白）')
})

test('开工台（v19.0.1）：目标期刊下拉必须与 期刊数据库.md 的 §一/§二 逐行一致', async () => {
  // 主人实测反馈：目标期刊原来是填空。改选项后，**数据面必须钉住真源**（否则期刊库更新而副本没跟 = 静默漂移）。
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const md = readFileSync(join(ROOT, 'skills', 'lunheng-article-pipeline', 'references', '_shared', '期刊数据库.md'), 'utf8')
  const section = (head) => {
    const i = md.indexOf(head)
    assert.ok(i >= 0, '期刊数据库必须含小节 ' + head)
    const j = md.indexOf('\n## ', i + 1)
    return md.slice(i, j > 0 ? j : md.length)
  }
  const rowsOf = (t) => t.split('\n')
    .filter((l) => /^\|\s*\S/.test(l) && !/^\|\s*期刊名/.test(l) && !/^\|\s*[-:]/.test(l))
    .map((l) => l.split('|')[1].trim())
  const cn = rowsOf(section('## 一、中文期刊'))
  const en = rowsOf(section('## 二、英文 SSCI'))
  assert.ok(cn.length >= 20 && en.length >= 10, `期刊库解析：中文 ${cn.length} / 英文 ${en.length}——派生源形变（表头或分隔符改了？）`)
  assert.deepEqual(mod.__panel.JOURNALS_CN, cn, '中文期刊副本与期刊数据库 §一 不一致')
  assert.deepEqual(mod.__panel.JOURNALS_EN, en, '英文期刊副本与期刊数据库 §二 不一致')
  // 组件层面：下拉里三组齐全（不指定 / 中文 / 英文 / 其他手填）
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined } }
  h.render(mod.__panel.Workbench, props)
  wbButton(h.tree(), '打开').props.onClick()
  h.render(mod.__panel.Workbench, props)
  wbButton(h.tree(), '展开高级设置').props.onClick()
  h.render(mod.__panel.Workbench, props)
  const hasOpt = (kids, v) => (kids || []).some((c) => {
    if (Array.isArray(c)) return hasOpt(c, v)
    if (c && c.props && c.props.value === v) return true
    return !!(c && Array.isArray(c.children) && hasOpt(c.children, v))   // 递归进 <optgroup>
  })
  const jSel = wbFind(h.tree(), (n) => n.type === 'select' && hasOpt(n.children, mod.__panel.JOURNAL_CUSTOM))
  assert.ok(jSel, '目标期刊下拉必须存在，且带「其他（手填）」出口')
  assert.ok(hasOpt(jSel.children, '管理世界'), '中文刊名应在选项里')
  assert.ok(wbFind(jSel, (n) => n.type === 'optgroup' && String(n.props.label).includes('中文')), '中文期刊应按 optgroup 分组')
})

/** 通类方向钉（v19.0.2）：**列容器的子元素不得带 px 的 flex-basis**。
 *  理由（主人实测到的真 bug）：`S.wbNote` 是**行样式**（`flex: '1 1 220px'`），被复用到**列容器**
 *  `S.wbField`（`flexDirection: 'column'`）里时，flex-basis 在列方向被解释成**高度 220px** ⇒
 *  界面上表现为「一大段空白」。本钉不针对某一处，而是**扫整棵渲染树**——同类错误换一处复用照样红。 */
const assertNoColumnFlexBasis = (node, path = 'root') => {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((c, i) => assertNoColumnFlexBasis(c, path + '[' + i + ']')); return }
  const st = (node.props && node.props.style) || {}
  const kids = node.children || []
  if (st.flexDirection === 'column') {
    for (const c of kids) {
      const cs = (c && c.props && c.props.style) || {}
      if (typeof cs.flex === 'string' && /\d+px/.test(cs.flex)) {
        assert.fail(`${path} 的列容器里，子元素带了 px 的 flex-basis（列方向 = 高度）：flex=${cs.flex}`)
      }
    }
  }
  kids.forEach((c, i) => assertNoColumnFlexBasis(c, path + '>' + String(node.type) + '[' + i + ']'))
}

test('开工台（v19.0.5）：标题前是**纯路径「圆 + 论」标记**（无字体依赖 / currentColor / 可翻正）', async () => {
  // 主人给了 `E:\Pictures\lunheng.svg`（CorelDRAW 导出）并问「行吗」。**不能直接用**，三条实测：
  //   ① 它靠内嵌 SVG 字体（`@font-face{src:url("#FontID0") format(svg)}`）出「论」字——现代浏览器不支持，
  //      实际退化成「宿主装了微软雅黑才行」；② 颜色写死为一个硬编码深色（暗色主题下几乎看不见，已实测）；
  //   ③ 导出件带 DOCTYPE/metadata/xodm 命名空间，不适合内联。
  //   ⇒ 重建为纯路径版：取字体里嵌的「论」轮廓 + 自绘圆，归一到 24 网格、currentColor。
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const P = mod.__panel
  const el = P.WbIcon({ size: 18 })
  assert.equal(el.type, 'svg')
  assert.equal(el.props.width, 18, '必须跟随传入的 size')
  assert.equal(el.props.height, 18)
  assert.equal(el.props.viewBox, '0 0 24 24', '归一化到 24 网格（与侧栏图标同族）')
  assert.equal(el.props.fill, 'none', '图形分件上色：圆走 stroke、字形走 fill，根节点不得整体填色')
  assert.equal(el.props['aria-hidden'], 'true', '装饰性图标：读屏不该重复念（标题文字已表达含义）')
  assert.equal(el.children.length, 2, '两个分件：圆 + 字形路径')
  assert.equal(el.children[0].type, 'circle')
  assert.equal(el.children[0].props.stroke, 'currentColor', '圆必须跟随主题色')
  assert.equal(el.children[0].props.fill, 'none')
  assert.equal(el.children[1].type, 'path')
  assert.equal(el.children[1].props.fill, 'currentColor', '字形必须跟随主题色（暗色下才看得见）')
  // **零字体依赖**：这是本图标从原文件重建出来的**唯一理由**，必须钉死
  assert.ok(!/<text|<font|font-family|微软雅黑|FontID0/.test(JSON.stringify(el)), '不得含 <text>/内嵌字体（原文件的致命依赖）')
  // 字形几何：轮廓路径 + **含负 y 缩放**（字体制是 y 轴向上，丢了翻转字会上下颠倒）
  const tf = el.children[1].props.transform
  assert.match(tf, /scale\([-\d.]+,-\d/, '变换必须带负 y 缩放（把字体制翻正）：' + tf)
  const d = el.children[1].props.d
  assert.ok(d.startsWith('M427.901 450.011'), '字形应为主人文件里「论」的轮廓（换图形需主人确认）')
  assert.ok(d.length > 1200, '轮廓数据完整性（实测 1,311 字符）')
  assert.equal(P.WbIcon({}).props.width, 16, '缺 size 时用 16 兜底')
  // 组件层面：图标必须在标题文字**之前**渲染
  const text = h.render(P.Workbench, { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined } })
  assert.ok(text.includes('<svg'), '标题行应含图标')
  assert.ok(text.indexOf('<svg') < text.indexOf('论衡开工'), '图标必须在标题**前**')
  // v19.1.4（主人裁定）：标题去掉「（Phase 0 定题）」后缀；Phase 0 的说明移进表单、标题栏不挂
  assert.ok(!text.includes('（Phase 0 定题）'), '标题不该再带 Phase 0 后缀')
  assert.ok(text.includes('填写后生成结构化开场白') === false, '说明行不该出现在标题栏（未展开时）：' + text.slice(0, 120))
})

test('开工台（v19.0.2）：列容器内不得出现 px 的 flex-basis（主人实测「大段空白」的通类根因）', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined } }
  h.render(mod.__panel.Workbench, props)
  wbButton(h.tree(), '打开').props.onClick()
  h.render(mod.__panel.Workbench, props)
  wbButton(h.tree(), '展开高级设置').props.onClick()
  h.render(mod.__panel.Workbench, props)
  assertNoColumnFlexBasis(h.tree())
  // 具体钉：表单内的**文字行**必须用**方向无关**的样式（无 flex）——那 220px 空白的来源就是这个形状。
  //   v19.0.2 当事元素是「外发同意」的提示 → v19.4.0 换成「检索范围」的提示。
  //   v19.4.1（主人裁定撤除字段说明行）：锚点改挂 `wbIntro`（表单体列容器里的「填写后生成结构化开场白…」），
  //   **坑位与形状不变**：列容器里的文字行不得带 flex，否则列方向会把 `flex-basis` 当高度撑出空白。
  const intro = wbFind(h.tree(), (n) => n.props && n.props.style === mod.__panel.S.wbIntro)
  assert.ok(intro, '表单说明行必须在渲染树里（它是本 bug 在 v19.4.1 的当事元素）')
  assert.equal(intro.props.style.flex, undefined, '列容器内的文字行不得带 flex（列方向会被当高度）')
  assert.ok(mod.__panel.S.wbFieldHint, '必须存在方向无关的 wbFieldHint 样式（标题栏的项目名回显仍在用）')
  assert.equal(mod.__panel.S.wbFieldHint.flex, undefined, 'wbFieldHint 必须是方向无关的（不带 flex）')
})

test('运行面板（v19.0.2）：同一「列容器 / px flex-basis」通类检查对面板树也成立', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, {
    fetch: fetchStub({
      '/ping': () => okJson({ ok: true, version: '19.0.2', roots: ['/r'] }),
      '/projects': () => okJson({ root: '/r', projects: [{ name: 'p1', hasFinal: false }] }),
      '/snapshot': () => okJson(SNAPSHOT),
    }),
  })
  for (let i = 0; i < 6; i++) { h.render(mod.__panel.Panel, { ctx: null }); await new Promise((r) => setTimeout(r, 0)) }
  assertNoColumnFlexBasis(h.tree())
})

test('开工台（v19.0.1/v19.0.3）：控宽必须抄 shell 的**独立卡片族**（notice），不得抄叠层卡片族', async () => {
  // 病灶沿革（两版各一次，主人实测）：
  //   v19.0.0「横向撑满窗口」→ v19.0.1 抄了 QueueDock 的几何 → v19.0.3「又窄了点，两端没对齐」。
  //   **根因是选错了几何族**：QueueDock / TodoPanel 是**叠层卡片**（`- 2×side-clearance - 2×dock-inset`、
  //   负下边距、圆角只留上边，刻意比输入框窄一圈贴在上面）；而 shell 自己在输入栏里的 notice
  //   （`uV2eYG_notice`）是 `width: 100%; max-width: var(--dsh-composer-card-max-width)`——**与输入框两端严格对齐**。
  //   开工台是四边独立圆角的卡片 ⇒ 属 notice 族。
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const S = mod.__panel.S
  assert.ok(S.wbDock, '必须有外层几何样式 wbDock（几何与卡片分离——卡片自带边框/底色，几何归槽位契约）')
  assert.equal(S.wbDock.width, '100%', '在外层容器内占满（外层已有 side-clearance 内边距，不得再减一次）')
  assert.match(String(S.wbDock.maxWidth), /--dsh-composer-card-max-width/, '最大宽必须取 shell 的 composer 卡片宽变量')
  assert.match(String(S.wbDock.maxWidth), /, 100%\)/, '变量缺失必须有 fallback（退化成满宽而不是算坏）')
  assert.ok(!/dock-inset/.test(String(S.wbDock.maxWidth)), '**不得**再减 dock-inset——那是叠层卡片族，减了就是两端不齐（v19.0.3 实测）')
  assert.ok(!/dock-inset/.test(String(S.wbDock.width)), 'width 里同样不得出现 dock-inset / side-clearance')
  assert.ok(S.wbDock.padding === undefined, '不得再给外层加 dock-inset 左右内边距（会二次内缩）')
  assert.match(String(S.wbDock.margin), /auto/, '必须居中（margin auto）')
  assert.ok(!String(S.wbWrap.flex || '').includes('1 1 100%'), '卡片本身不得横向撑满（v19.0.0 症状）')
})

test('开工台（v19.0.0 §4.4）：zh/en 字典键集合必须逐字相同（双语平衡）', async () => {
  // 官方 locale 服务的**类型化**形态即「bilingual balance enforced at registration」；本包走未类型化
  //   单语形态（`register(ns, locale, dict)`）绕开了那道编译期检查 ⇒ 必须用测试等价保证。
  //   失衡的后果是**静默的**：某个 key 只写了中文，英文宿主下回落成中文而不是报错。
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const zh = Object.keys(mod.__panel.L10N.zh).sort()
  const en = Object.keys(mod.__panel.L10N.en).sort()
  assert.deepEqual(en, zh, 'en 与 zh 的键集合必须完全一致（差异 = 静默双语失衡）')
  assert.deepEqual(zh.filter((k) => mod.__panel.L10N.zh[k] === ''), [], '不得有空译文')
  assert.deepEqual(en.filter((k) => mod.__panel.L10N.en[k] === ''), [], '不得有空译文')
  assert.ok(zh.length >= 40, '字典规模下限 = 40 键（防「文案又写回组件里」），实际 ' + zh.length)
})

test('开工台（v19.0.0 §4.4）：L10N 块外的中文字面量受棘轮约束（新文案只许进块；派生数据另计）', () => {
  const src = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  const lines = src.split('\n')
  // v19.0.2 口径收紧：**只数会被渲染的代码行**——整行注释不参与（注释永远渲染不出来；
  //   且实测注释里的「两个单引号片段夹中文」会被正则误判成字面量，属假阳性，别让假阳性逼人抬基线）。
  //   同时跳过 L10N（文案）与 DATA（派生数据/枚举值）两个标记块——两者各有自己的机械约束。
  let inL10n = false, inData = false, n = 0
  for (const l of lines) {
    if (l.includes('L10N:BEGIN')) { inL10n = true; continue }
    if (l.includes('L10N:END')) { inL10n = false; continue }
    if (l.includes('DATA:BEGIN')) { inData = true; continue }
    if (l.includes('DATA:END')) { inData = false; continue }
    if (inL10n || inData) continue
    // v19.1.6：**块注释行也算注释**（`/**`、`*`、`*/` 开头）——旧版只跳 `//`，于是 JSDoc 里
    //   「两个引号片段夹中文」（如 `'req' 出「必填」、'opt' 出「可选」`）又被误判成字面量。
    //   注释渲染不出来；别让假阳性逼人抬基线。
    if (/^\s*(\/\/|\/\*|\*)/.test(l)) continue
    n += (l.match(/['"][^'"\n]*[\u4e00-\u9fff][^'"\n]*['"]/g) || []).length
  }
  assert.ok(
    n <= OUTSIDE_CN_BASELINE,
    `L10N/DATA 块外**代码行**的中文字面量 ${n} 处 > 基线 ${OUTSIDE_CN_BASELINE}：新文案请放进 L10N 块并用 t() 取；`
    + '若确属派生数据，放进 DATA 块（并加逐行对账用例）。',
  )
})

test('开工台（v19.0.0 §4.4）：接宿主 locale —— 缺席降级 / 命中注册双语 / 优先级四档', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const P = mod.__panel
  // ① 缺席（无 locale 服务）：**绝不抛**，t() 回落内置中文
  assert.doesNotThrow(() => P.installLocale({ get: () => undefined }))
  assert.equal(P.t('wb.fill'), '生成开场白并填入输入框', '缺席时必须回落内置中文（不是键名、不是空）')
  // ② 命中：两套字典都注册到同一命名空间；bind 拿到译文
  const reg = []; let bound = null
  const svc = {
    register: (ns, loc, dict) => { reg.push([ns, loc, Object.keys(dict).length]); return () => {} },
    bind: (ns) => { bound = ns; return (k) => (k === 'wb.fill' ? 'FROM-HOST' : k) },
    getLocale: () => ({ active: 'en' }),
    subscribe: () => () => {},
  }
  assert.doesNotThrow(() => P.installLocale({ get: (n) => (n === 'locale' ? svc : undefined) }))
  assert.deepEqual(reg.map((r) => r[1]), ['zh', 'en'], 'zh/en 都要注册（否则英文宿主会看到键名）')
  assert.equal(reg[0][0], 'lunheng', '命名空间是跨版本契约（宿主字典与插件字典在此对齐）')
  assert.equal(bound, 'lunheng')
  // ③ 优先级：宿主译文 > 当前语言内置字典 > 键名（逐档验证）
  assert.equal(P.t('wb.fill'), 'FROM-HOST', '宿主有译文时必须优先用宿主')
  assert.equal(P.t('panel.label'), 'Lunheng Runs', '宿主未覆盖的键 → 用当前语言（en）的内置字典')
  assert.equal(P.t('wb.nope'), 'wb.nope', '宿主与内置都没有 → 回落键名（可诊断，不静默变空）')
})

test('开工台（v19.0.0 §4.2）：注册进 conversation.input.dock，且 exports.inject 仍为空', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  // 本包的跨版本生存策略 = **零 inject + 全 ctx.get 探测**（照抄别人的 inject 清单会在缺服务的宿主上挂死）
  assert.deepEqual(mod.inject, [], 'exports.inject 必须保持空数组')
  const regs = {}
  let registered = null
  const slots = {
    inject: (n, cb) => { regs[n] = cb; return () => {} },
    register: (def, comp) => { registered = { def, comp }; return () => {} },
  }
  mod.apply({ inject: (deps, cb) => cb({ slots, get: () => undefined }) })
  assert.equal(typeof regs['conversation.input.dock'], 'function', '必须 inject 到 conversation.input.dock 席位')
  regs['conversation.input.dock']()
  assert.equal(registered.def.name, 'conversation.input.dock')
  assert.equal(registered.def.id, 'lunheng-workbench', 'id 是稳定契约（同名席位唯一）')
  assert.equal(typeof registered.comp, 'function')
  assert.equal(mod.__panel.SEATS.dock, true, '注册成功必须置位')
  assert.match(h.render(mod.__panel.seatLine, {}), /开工台 = 已注册/, '座位行必须**如实**汇报开工台落点')
  assert.match(h.render(mod.__panel.seatLine, {}), /locale = 未接入/, 'locale 未接入也要如实写出（不假装接上了）')
})

test('开工台（v19.0.0 §4.2）：三处硬校验 + 结构化开场白 + 只 setDraft 不 submit', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const P = mod.__panel
  // ① 校验：题目 / 项目名（正则，含路径穿越）/ 检索范围（必须显式选；v19.4.0 起取代旧的「外发同意」）
  assert.equal(P.wbValidate({ title: '', project: 'p', retrieval: '全网检索' }), 'wb.need.title')
  assert.equal(P.wbValidate({ title: 't', project: '', retrieval: '全网检索' }), 'wb.need.project')
  assert.equal(P.wbValidate({ title: 't', project: '../escape', retrieval: '全网检索' }), 'wb.need.projectChars')
  assert.equal(P.wbValidate({ title: 't', project: 'a'.repeat(33), retrieval: '全网检索' }), 'wb.need.projectChars')
  assert.equal(P.wbValidate({ title: 't', project: 'p', retrieval: '' }), 'wb.need.retrieval')
  assert.equal(P.wbValidate({ title: 't', project: '我的项目-1', retrieval: '全网检索' }), null, '中文/连字符合法')
  // ② 开场白：结构化字段块（**不是散文**）+ 授权串 + 四条例律
  const prompt = P.buildPrompt(Object.assign({}, P.WB_DEFAULT, { title: 'T', project: 'P1', genre: 'academic-cn', retrieval: '全网检索', mask: 'basic', materials: 'data.csv' }))
  assert.match(prompt, /- 项目名: P1/)
  assert.match(prompt, /- 题名: T/)
  assert.match(prompt, /academic-cn（期刊投稿（社科实证））/, '选文类必须带出它的场景（一选定 11 项）')
  assert.match(prompt, /- 外部服务授权：检索=全网检索 \/ 推理=<[^>]+> \/ 脱敏=basic/, '三段式授权串必须整条出现在开场白里')
  assert.ok(!/外发同意/.test(prompt), '旧「外发同意」一行必须消失（不是叠着新串再留一行）')
  assert.match(prompt, /- 投喂材料（已在工作区内）: data\.csv/)
  assert.match(prompt, /跟随文类/, '未填项必须写明「跟随文类」而不是留空')
  assert.match(prompt, /不要启动 Phase 1/, '必须带人在环纪律（否则工作台等于绕过 Phase 0 闸门）')
  assert.match(prompt, /素材池\.md` \*\*§11\.2/, '档 B（仅本地素材）的派发话术指针必须写进开场白，否则主控会自己编')
  // ③ **唯一通道**：席位标准 props（v19.0.5 收口 —— 主人真机回执确认走的就是这条），且**只 setDraft**
  const calls = []
  const r1 = P.pushDraft({ inputActions: { setDraft: (s) => calls.push(['draft', s]), submit: () => calls.push(['submit']) } }, prompt)
  assert.equal(r1.ok, true)
  assert.equal(r1.channel, 'wb.channel.inputActions')
  assert.equal(calls.length, 1, '**只 setDraft，绝不自动 submit**（Phase 0 是人确认后才开工）')
  assert.equal(calls[0][1], prompt)
  // ④ 无席位 props → 如实报缺（**不假装**、也不去摸服务内部：`ctx.get` 故意设计成会抛）
  const r2 = P.pushDraft({ ctx: { get: () => { throw new Error('不得在写入路径上摸服务') } }, sessionId: 's1' }, prompt)
  assert.equal(r2.ok, false)
  assert.equal(r2.channel, 'wb.channel.none')
  assert.equal(r2.err, null, '没走到的路径不该报错——报缺就是报缺')
  // ⑤ setDraft 自身抛错 → 如实带出**错误原文**（不吞成「未找到通道」那种似是而非的说法）
  const r3 = P.pushDraft({ inputActions: { setDraft: () => { throw new Error('host rejected draft') } } }, prompt)
  assert.equal(r3.ok, false)
  assert.equal(r3.channel, 'wb.channel.none')
  assert.equal(r3.err, 'host rejected draft', '错误原文必须透传（否则诊断时看不出是「没通道」还是「通道报错」）')
  // ⑥ 旧版的第二通道（会话作用域）**已删除**：L10N 里不得再留那条文案
  assert.equal(P.L10N.zh['wb.channel.scope'], undefined, '会话作用域通道已收口，文案应同批删除')
  assert.equal(P.L10N.en['wb.channel.scope'], undefined)
})

test('开工台（v19.0.0 §4.2）：组件渲染 + 点「生成开场白」把文本送进 inputActions', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const drafts = []
  const props = { inputActions: { setDraft: (s) => drafts.push(s) }, ctx: { get: () => undefined } }
  const findButton = (node, label) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) { for (const c of node) { const r = findButton(c, label); if (r) return r } return null }
    if (node.type === 'button' && node.props && typeof node.props.onClick === 'function') {
      const txt = (node.children || []).map((c) => (typeof c === 'string' ? c : '')).join('')
      if (txt.includes(label)) return node
    }
    for (const c of node.children || []) { const r = findButton(c, label); if (r) return r }
    return null
  }
  // ① 收起态：只有开关按钮，正文不渲染（默认收起 = 不占输入框上方的空间）
  let text = h.render(mod.__panel.Workbench, props)
  assert.match(text, /论衡开工/, '标题常显')
  assert.ok(!text.includes('（Phase 0 定题）'), 'v19.1.4：标题不再带 Phase 0 后缀')
  assert.ok(!text.includes('填写后生成结构化开场白'), 'v19.1.4：说明行在表单里，收起态不显示')
  assert.doesNotMatch(text, /生成开场白并填入输入框/, '收起态不得渲染正文按钮')
  // ② 点开
  const toggle = findButton(h.tree(), '打开')
  assert.ok(toggle, '必须有「打开」按钮')
  toggle.props.onClick()
  text = h.render(mod.__panel.Workbench, props)
  assert.match(text, /项目名/, '展开后必须出现项目名（论衡特有：run/<项目名>/ 必须主人给）')
  assert.match(text, /外部服务授权/, '展开后必须出现外部服务授权（Phase 0 硬闸；v19.5.5 起取代旧称「外发同意」）')
  // ③ 未填必填项时点击 → 不写入，且给出**具体**原因
  const fill0 = findButton(h.tree(), '生成开场白并填入输入框')
  assert.ok(fill0, '展开后必须有生成按钮')
  fill0.props.onClick()
  text = h.render(mod.__panel.Workbench, props)
  assert.equal(drafts.length, 0, '缺必填项时**不得**写入输入框')
  assert.match(text, /请先填题目/, '必须给出可读的具体原因（不是静默禁用）')
})

test('开工台（v19.0.0 §4.2）：内置文类表必须与 references/_shared/文类档案.md 逐列一致', async () => {
  // 客户端读不到文件系统 ⇒ 文类表只能是**内置副本**。按本仓纪律，「同一事实两处」必须机械对账：
  //   本用例逐列回读真源表（`文类档案.md`）并 deepEqual —— 档案改了而副本没跟，当场红。
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const md = readFileSync(join(ROOT, 'skills', 'lunheng-article-pipeline', 'references', '_shared', '文类档案.md'), 'utf8')
  const rows = md.split('\n').filter((l) => /^\|\s*`[a-z0-9-]+`\s*\|/.test(l)).map((l) => l.split('|').map((c) => c.trim()))
  assert.ok(rows.length >= 11, '文类档案表解析出 ' + rows.length + ' 行——派生源形变（表头/分隔符改了？）')
  const parsed = rows.map((c) => ({
    code: c[1].replace(/`/g, ''), scene: c[2], cite: c[4], structure: c[6],
    sections: c[10], t9: c[11], journal: c[13], minLit: Number(c[14]),
  }))
  assert.deepEqual(mod.__panel.GENRES, parsed, '内置文类表与文类档案.md 不一致（客户端副本必须同批同步）')
})

test('客户端半边（v19.0.0）：注入的 hover 类样式必须是真调用（不得再拼出 T(...) 源码文本）', async () => {
  // v18.92.0 起该 hover 规则**从未生效**：旧版把实参写成字符串字面量，注入的 CSS 是
  //   `border-color:T(<token>, <兜底>) !important` —— 浏览器整条声明丢弃（静默失效）。
  //   本钉把「必须是真调用」钉死：CSS 里出现 `T(` 字样即红。
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const css = []
  const stylesSvc = { insert: (s) => css.push(s) }
  mod.apply({
    inject: (deps, cb) => cb({ slots: { inject: () => () => {}, register: () => () => {} }, get: () => undefined }),
    get: (n) => (n === 'styles' ? stylesSvc : undefined),
  })
  assert.equal(css.length, 1, '应注入恰好一条类样式')
  assert.match(css[0], /var\(--dsw-alias-border-l2, #/, 'hover 描边必须是 var(token, 兜底)')
  assert.match(css[0], /color-mix\(in srgb/, 'hover 阴影须由 color-mix 派生（随明暗主题）')
  assert.ok(!/T\(/.test(css[0]), '不得把 T(...) 源码文本拼进 CSS：' + css[0])
})

/** 元素树遍历：按**按钮文案**或**元素类型**找节点（v19.0.0 起用于点击级断言）。 */
const wbFind = (node, pred) => {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const c of node) { const r = wbFind(c, pred); if (r) return r } return null }
  if (pred(node)) return node
  for (const c of node.children || []) { const r = wbFind(c, pred); if (r) return r }
  return null
}
const wbButton = (node, label) => wbFind(node, (n) => n.type === 'button' && typeof n.props.onClick === 'function'
  && (n.children || []).map((c) => (typeof c === 'string' ? c : '')).join('').includes(label))

test('开工台（v19.1.1）：**多工作区**时须逐个根探测，取第一个真有项目的根（主人实测踩点）', async () => {
  // 宿主 `resolveTarget` 不带 root 时只取 `roots[0]`——若你的 run/ 在另一个根下，列表就是空的、进度不出现。
  const h = makeReactStub()
  const seen = []
  const route = (u) => {
    const s = String(u)
    seen.push(s)
    if (s.includes('/ping')) return okJson({ ok: true, version: '19.1.1', roots: ['/rootA', '/rootB'] })
    if (s.includes('/projects')) {
      const root = /root=([^&]+)/.exec(s) ? decodeURIComponent(/root=([^&]+)/.exec(s)[1]) : ''
      if (root === '/rootA') return okJson({ root: '/rootA', projects: [] })
      return okJson({ root: '/rootB', projects: [{ name: 'realproj' }] })
    }
    if (s.includes('/snapshot')) {
      return okJson({ project: 'realproj', status: { hasStatus: true }, agents: { roles: [{ role: 'T1', count: 1 }, { role: 'T2', count: 1 }, { role: 'T3', count: 1 }] }, artifacts: { drafts: 0, hasFinal: false } })
    }
    return Promise.reject(new Error('HTTP 404'))
  }
  const mod = await loadClient(h, { fetch: route })
  const P = mod.__panel
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined } }
  const tick = async () => { const s = h.render(P.Workbench, props); await new Promise((r) => setTimeout(r, 0)); return s }
  await tick(); await tick(); await tick(); await tick()
  assert.ok(seen.some((u) => u.includes('/ping')), '必须先问 /ping 拿根清单：' + seen.join(' | '))
  assert.ok(seen.some((u) => u.includes('root=%2FrootB') || u.includes('root=/rootB')), '应问到第二个根：' + seen.join(' | '))
  // v19.1.2 回归钉（主人实测「快照读取失败」的真因）：**快照请求必须带上探测出来的那个根**。
  //   不带 root ⇒ 宿主 resolveTarget 取 roots[0] ⇒ 打到另一个根 ⇒ 404 ⇒ 界面误报「读面不可用」。
  const snapUrl = seen.find((u) => u.includes('/snapshot?project=realproj'))
  assert.ok(snapUrl, '应对第二个根里的项目取快照：' + seen.join(' | '))
  assert.ok(/root=%2FrootB|root=\/rootB/.test(snapUrl), '快照请求必须带探测到的根（否则多工作区下必 404）：' + snapUrl)
  assert.match(h.render(P.Workbench, props), /检索 3\/3/, '第二个根的项目应显示真实进度')
})

test('开工台（v19.1.6）：必填/可选标记**以 wbValidate 为准**（不靠印象标）', async () => {
  // `wbValidate` 是真正拦人生成的判据：只有 题名 / 项目名 / 检索范围（有默认值）三个。
  //   其余字段（含投喂材料、研究问题/写作要点、整块高级设置）一律可选——标错会把主人挡在门外。
  //   v19.4.0：第三项从「外发同意」换成「检索范围」；同批删掉死字段「工作区根」；**主人同日裁决**再删
  //   「质量门」「补扫」两个假开关（`quality` 降为只读提示、`rescan` 整删）。
  //   故「可选」的期望处数 5 → **3**（现只剩 投喂材料 / 研究问题·写作要点 / 高级区标题 三处，
  //   已按实际渲染逐处核过：`wbInput('materials', …, tag:'opt')`、`wbInput('brief', …, tag:'opt')`、
  //   `wb.sec4` 标题；**下降**是事实变化，不是宽容）。
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const P = mod.__panel
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined } }
  h.render(P.Workbench, props)
  wbButton(h.tree(), '打开').props.onClick()
  h.render(P.Workbench, props)
  wbButton(h.tree(), '展开高级设置').props.onClick()
  const text = h.render(P.Workbench, props)
  const count = (sn, sub) => sn.split(sub).length - 1
  // v19.4.0：计数改用**元素树上的标记节点**（`S.wbTagReq`），不再数文本里的「必填」二字——
  //   当时提示文案里合法出现「必填」（`wb.titleHint`「简报的必填格」/ `wb.p0leftList`「下列格必填」）
  //   会把文本计数从 3 抬到 5，那是**工具误报**，不是标记多了。v19.4.1 主人裁定撤除全部说明行后，
  //   标记计数口径**保持不变**——它比文本计数稳，不随文案增删而漂。
  const tagCount = (styleKey) => {
    let n = 0
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (node.props && node.props.style === P.S[styleKey]) n++
      ;(node.children || []).forEach(walk)
    }
    walk(h.tree())
    return n
  }
  assert.equal(tagCount('wbTagReq'), 3, '必填标记应恰好 3 个（题名/项目名/检索范围），与 wbValidate 对齐')
  assert.equal(tagCount('wbTagOpt'), 2, '可选标记应恰好 2 个（投喂材料 / 研究问题·写作要点）')
  assert.ok(count(text, '可选') >= 3, '投喂材料/研究问题/写作要点 + 高级区标题都应带「可选」：' + count(text, '可选'))
  assert.match(text, /高级（可选；留空＝跟随文类）/, '高级区标题要写明整块可选（旧版此文案是死的，根本没渲染）')
  // v19.4.0（主人 2026-10-13 授权）：结构门 / T9 视角**降为文类派生值**——面板不许再有这两个可编辑控件。
  const selects = []
  const collectSel = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(collectSel); return }
    if (node.type === 'select') selects.push(node)
    ;(node.children || []).forEach(collectSel)
  }
  collectSel(h.tree())
  const optTexts = (sel) => (sel.children || []).map((o) => (o.props && o.props.value) || '')
  const hasOpt = (sel, v) => optTexts(sel).includes(v)
  assert.equal(selects.some((s) => hasOpt(s, 'IMRaD')), false, '结构门不得再是可编辑下拉（文类派生值）')
  assert.equal(selects.some((s) => hasOpt(s, '三视角')), false, 'T9 视角不得再是可编辑下拉（文类派生值）')
  // v19.4.1（主人裁定「只读和默认的部分去掉」）：只读回显行也不再摆（面板不摆没有选择余地的行）。
  //   只认**表单标签节点**（`S.wbLabel`），不认整段渲染文本——开场白预览里 `- 结构门:` 是合法内容。
  const labelTexts = []
  const collectLabels = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(collectLabels); return }
    if (node.type === 'span' && node.props && node.props.style === P.S.wbLabel) {
      labelTexts.push((node.children || []).filter((c) => typeof c === 'string').join(''))
    }
    ;(node.children || []).forEach(collectLabels)
  }
  collectLabels(h.tree())
  assert.ok(!labelTexts.some((s) => /结构门|T9 视角|G14|推理位置|Phase 0 其余必答项/.test(s)),
    '只读行标签必须全部撤除，实到标签：' + JSON.stringify(labelTexts))
  // 负向：标记集合要与 validate 一致（抽查——可选字段不该被标必填）
  const hasReqAfter = (label) => {
    const i = text.indexOf(label)
    return i < 0 ? -1 : (/必填/.test(text.slice(i, i + 30)) ? 1 : 0)
  }
  assert.equal(hasReqAfter(P.t('wb.f.title')), 1, '题名必填')
  assert.equal(hasReqAfter(P.t('wb.f.project')), 1, '项目名必填')
  assert.equal(hasReqAfter(P.t('wb.f.scope')), 1, '检索范围必填（v19.4.0 起它是三项硬约束之一）')
  assert.equal(hasReqAfter(P.t('wb.f.mask')), 0, '脱敏档可选（validate 不拦它，有恒定缺省 basic）')
  assert.equal(hasReqAfter(P.t('wb.f.genre')), 0, '文类可选（validate 不拦它）')
  assert.equal(hasReqAfter(P.t('wb.f.words')), 0, '目标篇幅可选')
  assert.equal(hasReqAfter(P.t('wb.f.materials')), 0, '投喂材料可选')
  assert.equal(hasReqAfter(P.t('wb.f.brief')), 0, '研究问题/写作要点可选')
  // v19.4.0：`citeMode` 的标签改口径（「内联」现为**合法交付形态**，不是被删的假选项）。
  assert.match(P.t('wb.f.citeMode'), /交付形态/, '引用模式的标签必须写明它是交付形态')
  assert.equal(P.t('wb.f.title'), '题名（≤25 字）', '「题目」改「题名」并对齐简报的 ≤25 字硬约束')
})

test('开工台（v19.1.7）：人在环（OOH）——四门节点名**双向钉在真源**，全自动＝按首个推荐项', async () => {
  // 真源：`SKILL.md` §人在环四节点（P0 定题 / P2.5 大纲 / P3.5 洞察 / P5 终稿 必须主人过目）
  //   + `pipeline-readme.md` 的「四门「必须」…全部必需、不设可省任一门」。
  // 本包对「全自动」的表述是**主人显式授权例外**（不谎称机制已改），且替代规则落在机制已有约定上：
  //   四门统一用 `ask_user_question`、首个选项＝主控建议 ⇒ 全自动 = 采用首个推荐项 + 逐门留痕。
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const P = mod.__panel
  const skill = readFileSync(join(ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md'), 'utf8')
  const readme = readFileSync(join(ROOT, 'skills', 'lunheng-article-pipeline', 'references', 'pipeline-readme.md'), 'utf8')
  const NODES = ['P0 定题', 'P2.5 大纲', 'P3.5 洞察', 'P5 终稿']
  for (const n of NODES) {
    assert.ok(skill.includes(n) || readme.includes(n), `真源应含四门之一：${n}`)
    assert.ok(P.WB_HITL_FOUR.includes(n), `四门文案必须列全：${n}`)
  }
  // v19.4.1（主人裁定「注释说明都去掉」）：说明行撤除后，四门节点名在面板侧**只由 `WB_HITL_FOUR`
  //   承载**，唯一权威仍在上面的真源两文件（故不因撤除说明而丢失可核性）。
  assert.equal(P.L10N.zh['wb.hitlHint'], undefined, '人在环说明行必须同批撤除，不留孤儿键')
  assert.match(readme, /全部必需、不设可省任一门/, '真源里「四门必须」是**默认**硬口径；全自动必须写成显式授权例外')
  // v19.1.9：机制已正式写入「全自动」例外——两处真源都要有，且必须写明「四份单照落 ⇒ A7 门不变」（留痕不破）
  const gateReadme = readme.split('\n').find((l) => l.includes('四门「必须」')) || ''
  assert.match(gateReadme, /全自动/, 'pipeline-readme §四门 必须写入全自动例外')
  assert.match(gateReadme, /首个推荐项/, '全自动的替代规则必须确定（按各门首个推荐项）')
  assert.match(gateReadme, /四份确认单仍必须落盘|四份单照落/, '必须写明四份确认单照旧落盘')
  assert.match(gateReadme, /A7[^\n]{0,60}(无需任何改动|不变)/, '必须写明 A7 机械门零改动（留痕不破）')
  const skillHuman = skill.split('\n').find((l) => l.includes('人在环四节点')) || ''
  assert.match(skillHuman, /全自动/, 'SKILL.md §人在环四节点 必须写入全自动例外')
  assert.match(skillHuman, /P0 不受此授权影响/, 'P0 必须明确不受授权影响')
  assert.match(skill, /ask_user_question/, '全自动的替代规则要落在机制已有约定（各门首个推荐项）上')
  assert.match(P.WB_HITL_AUTO, /首个推荐项/, '全自动必须写明「按首个推荐项」——不能是含糊的「自行决定」')
  assert.match(P.WB_HITL_AUTO, /交付说明/, '全自动必须要求逐门留痕（写进交付说明）')
  // 默认 = 四门必须（空值即默认），且必须出现在开场白里（主控据此知道停几门）
  const p4 = P.buildPrompt(Object.assign({}, P.WB_DEFAULT, { title: 'T', project: 'P1' }))
  assert.match(p4, /- 人在环: 四门必须（P0 定题 \/ P2\.5 大纲 \/ P3\.5 洞察 \/ P5 终稿/, '默认四门必须：' + p4.split('\n').filter((l) => l.includes('人在环')).join(''))
  const pAuto = P.buildPrompt(Object.assign({}, P.WB_DEFAULT, { title: 'T', project: 'P1', hitl: '全自动' }))
  assert.match(pAuto, /- 人在环: 全自动（\*\*主人显式授权\*\*/, '选全自动要把授权语义写进开场白')
  assert.ok(!/四门必须/.test(pAuto.split('\n').filter((l) => l.includes('人在环')).join('')), '全自动不该再写四门必须')
})

test('开工台（v19.1.7/v19.4.1）：人在环下拉在「外部服务授权」旁、两个选项（说明行已撤）', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const P = mod.__panel
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined } }
  h.render(P.Workbench, props)
  wbButton(h.tree(), '打开').props.onClick()
  const text = h.render(P.Workbench, props)
  assert.match(text, /人在环（OOH）/, '下拉要有标签')
  const hasOpt = (kids, v) => (kids || []).some((c) => Array.isArray(c) ? hasOpt(c, v) : (c && c.props && c.props.value === v))
  const sel = wbFind(h.tree(), (n) => n.type === 'select' && hasOpt(n.children, '四门必须'))
  assert.ok(sel, '必须有人/环下拉且含「四门必须」')
  assert.ok(hasOpt(sel.children, '全自动'), '必须含「全自动」选项')
  // v19.4.1（主人裁定撤除说明行）：下拉旁不再挂说明；「全自动的实际后果」改由 `WB_HITL_AUTO`
  //   单点承载（同一句真源：既进开场白给主控看，也进上面 T-1 的双向钉），面板侧不留副本。
  assert.equal(P.L10N.zh['wb.hitlHint'], undefined, '下拉旁的说明行必须同批撤除，不留孤儿键')
  assert.match(P.WB_HITL_AUTO, /首个推荐项/, '全自动的实际后果必须仍写在 WB_HITL_AUTO 里')
})

test('开工台（v19.1.6）：标题栏的开关按钮**靠右**（`marginLeft: auto`）', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const P = mod.__panel
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined } }
  h.render(P.Workbench, props)
  const btn = wbButton(h.tree(), '打开')
  assert.equal(btn.props.style.marginLeft, 'auto', '靠右由 flex 行的 marginLeft:auto 实现（换行时仍在本行右端）')
  btn.props.onClick()
  h.render(P.Workbench, props)
  const btn2 = wbButton(h.tree(), '收起')
  assert.equal(btn2.props.style.marginLeft, 'auto', '收起按钮也要靠右')
})

test('开工台（v19.1.5）：席位注册必须声明 `inject(sessionId)` —— 并行会话各看各的**唯一**依据', async () => {
  // 没有本会话身份，「当前项目」只能全局猜：两个会话并行时两条 bar 会显示同一个项目、并随写入来回跳。
  // 官方同槽位占据者（队列面板）用的就是这个机制：`inject: (sessionId) => ({…})`，返回值即组件 props。
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  let registered = null
  const slots = { inject: (n, cb) => { cb(); return () => {} }, register: (def, comp) => { registered = { def, comp }; return () => {} } }
  mod.apply({ inject: (deps, cb) => cb({ slots, get: () => undefined }) })
  assert.ok(registered, '必须注册开工台席位')
  assert.equal(typeof registered.def.inject, 'function', '必须声明 inject（否则拿不到 sessionId）')
  assert.deepEqual(registered.def.inject('sess-1'), { sessionId: 'sess-1' }, 'inject 的返回值就是组件 props')
})

test('进度条（v19.1.5）：**本会话绑定优先**——并行会话下不再全局猜测', async () => {
  const h = makeReactStub()
  const seen = []
  const route = (u) => {
    const s = String(u)
    seen.push(s)
    if (s.includes('/ping')) return okJson({ ok: true, roots: ['/rootA'] })
    if (s.includes('/projects')) return okJson({ root: '/rootA', projects: [{ name: 'pA', mtime: 999 }, { name: 'pB', mtime: 1 }] })
    if (s.includes('/snapshot')) {
      const p = /project=([^&]+)/.exec(s)[1]
      return okJson({ project: decodeURIComponent(p), status: { hasStatus: true }, agents: { roles: [{ role: 'T7', count: 1 }] }, artifacts: { drafts: 0, hasFinal: false } })
    }
    return Promise.reject(new Error('HTTP 404'))
  }
  // 本会话 s1 绑定到 pB（列表里 pA 的目录 mtime 更新 → 全局判据会选 pA）
  const mod = await loadClient(h, { fetch: route, savedByKey: { 'lunheng.workbench.proj.s1': 'pB' } })
  const P = mod.__panel
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined }, sessionId: 's1' }
  const tick = async () => { const s = h.render(P.Workbench, props); await new Promise((r) => setTimeout(r, 0)); return s }
  await tick(); await tick(); await tick()
  assert.ok(seen.some((u) => u.includes('/snapshot?project=pB')), '必须按**本会话绑定**取快照：' + seen.join(' | '))
  assert.ok(!seen.some((u) => u.includes('/snapshot?project=pA')), '绑定了就不该再去全局猜 pA：' + seen.join(' | '))
  assert.match(h.render(P.Workbench, props), /审计 1\/1/, '显示的应是绑定项目的进度')
})

test('进度条（v19.1.5）：无绑定时按**项目内最新写入时间**取最新（目录 mtime 会被子目录扰动）', async () => {
  const h = makeReactStub()
  const route = (u) => {
    const s = String(u)
    if (s.includes('/ping')) return okJson({ ok: true, roots: ['/rootA'] })
    if (s.includes('/projects')) return okJson({ root: '/rootA', projects: [{ name: 'oldDir', mtime: 1000 }, { name: 'liveNow', mtime: 1 }] })
    if (s.includes('/snapshot')) {
      const p = decodeURIComponent(/project=([^&]+)/.exec(s)[1])
      // 目录 mtime 小的那个，**文件写入时间**却是最新（实测过的真实形态：老单目录被碰过）
      const mt = p === 'liveNow' ? 9e12 : 1e12
      return okJson({ project: p, status: { hasStatus: true }, agents: { roles: p === 'liveNow' ? [{ role: 'T1', count: 1 }, { role: 'T2', count: 1 }, { role: 'T3', count: 1 }] : [] }, artifacts: { drafts: 0, newest: [{ rel: 'status.md', mtime: mt }] } })
    }
    return Promise.reject(new Error('HTTP 404'))
  }
  const mod = await loadClient(h, { fetch: route })
  const P = mod.__panel
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined }, sessionId: 's2' }
  const tick = async () => { const s = h.render(P.Workbench, props); await new Promise((r) => setTimeout(r, 0)); return s }
  await tick(); await tick(); await tick(); await tick()
  assert.match(h.render(P.Workbench, props), /检索 3\/3/, '应按文件写入时间选中 liveNow（目录 mtime 判据会错选 oldDir）')
})

test('进度条（v19.1.5）：多项目才有切换器；切换即写「会话 ↔ 项目」绑定', async () => {
  const h = makeReactStub()
  const store = {}
  const route = (u) => {
    const s = String(u)
    if (s.includes('/ping')) return okJson({ ok: true, roots: ['/rootA'] })
    if (s.includes('/projects')) return okJson({ root: '/rootA', projects: [{ name: 'p1' }, { name: 'p2' }] })
    if (s.includes('/snapshot')) return okJson({ project: 'p1', status: { hasStatus: true }, agents: { roles: [] }, artifacts: { drafts: 0, newest: [{ rel: 'status.md', mtime: 5 }] } })
    return Promise.reject(new Error('HTTP 404'))
  }
  const mod = await loadClient(h, { fetch: route, savedByKey: store })
  const P = mod.__panel
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined }, sessionId: 's9' }
  const tick = async () => { const s = h.render(P.Workbench, props); await new Promise((r) => setTimeout(r, 0)); return s }
  await tick(); await tick(); await tick(); await tick()
  const hasOpt = (kids, v) => (kids || []).some((c) => Array.isArray(c) ? hasOpt(c, v) : (c && c.props && c.props.value === v))
  const selBox = wbFind(h.tree(), (n) => n.type === 'select' && hasOpt(n.children, 'p2'))
  assert.ok(selBox, '两个项目时必须出现项目切换器')
  selBox.props.onChange({ target: { value: 'p2' } })
  await tick(); await tick()
  assert.equal(store['lunheng.workbench.proj.s9'], 'p2', '切换必须写入本会话绑定：' + JSON.stringify(store))
})

test('进度条（v19.1.5）：单项目**不摆切换器**（多一个控件就是多一分噪音）', async () => {
  const h = makeReactStub()
  const route = (u) => {
    const s = String(u)
    if (s.includes('/ping')) return okJson({ ok: true, roots: ['/rootA'] })
    if (s.includes('/projects')) return okJson({ root: '/rootA', projects: [{ name: 'solo' }] })
    if (s.includes('/snapshot')) return okJson({ project: 'solo', status: { hasStatus: true }, agents: { roles: [] }, artifacts: { drafts: 0, newest: [{ rel: 'status.md', mtime: 5 }] } })
    return Promise.reject(new Error('HTTP 404'))
  }
  const mod = await loadClient(h, { fetch: route, savedByKey: {} })
  const P = mod.__panel
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined }, sessionId: 's3' }
  const tick = async () => { const s = h.render(P.Workbench, props); await new Promise((r) => setTimeout(r, 0)); return s }
  await tick(); await tick(); await tick()
  assert.ok(!wbFind(h.tree(), (n) => n.type === 'select'), '只有一个项目时不该出现切换器')
  assert.match(h.render(P.Workbench, props), /solo/, '项目名仍要以文本形式显示')
})

test('开工台（v19.1.5）：点「生成开场白并填入」顺手建立**本会话 ↔ 该项目**的绑定', async () => {
  const h = makeReactStub()
  const store = {}
  const route = (u) => {
    const s = String(u)
    if (s.includes('/ping')) return okJson({ ok: true, roots: ['/rootA'] })
    if (s.includes('/projects')) return okJson({ root: '/rootA', projects: [] })
    return Promise.reject(new Error('HTTP 404'))
  }
  const mod = await loadClient(h, { fetch: route, savedByKey: store })
  const P = mod.__panel
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined }, sessionId: 's7' }
  const tick = async () => { const s = h.render(P.Workbench, props); await new Promise((r) => setTimeout(r, 0)); return s }
  await tick()
  wbButton(h.tree(), '打开').props.onClick()
  await tick()
  // 填最小必需项：标题 + 项目名
  //   注意：子节点里可能是**数组**（React 支持，本包也这么用，如 `kids`）→ walk 必须展开数组，
  //   否则走到数组那层就停住（实测踩过：`h('div', {…}, kids)` 的 children 就是 `[kids]`）。
  const inputs = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (n.type === 'input' && n.props && n.props.type !== 'checkbox') inputs.push(n)
    ;(n.children || []).forEach(walk)
  }
  walk(h.tree())
  assert.ok(inputs.length >= 2, '应有题目/项目名两个输入框')
  inputs[0].props.onChange({ target: { value: '测试题目' } })
  inputs[1].props.onChange({ target: { value: 'proj-xyz' } })
  await tick()
  wbButton(h.tree(), '生成开场白并填入输入框').props.onClick()
  await tick()
  assert.equal(store['lunheng.workbench.proj.s7'], 'proj-xyz', '填写开场白即建立绑定：' + JSON.stringify(store))
})

test('进度条（v19.1.4）：**没有项目**时不摆空壳——不显示 chips、不报错，开工台照常可用', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, {
    fetch: (u) => (String(u).includes('/projects') ? okJson({ root: '/work', projects: [] }) : Promise.reject(new Error('HTTP 404'))),
  })
  const P = mod.__panel
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined } }
  const tick = async () => { const s = h.render(P.Workbench, props); await new Promise((r) => setTimeout(r, 0)); return s }
  await tick(); await tick()
  let text = h.render(P.Workbench, props)
  assert.ok(!/检索 0\/3/.test(text), '没有项目时不得显示进度 chips（没数据不摆空壳）')
  assert.ok(!/进度读取失败/.test(text), '没有项目不是读面失败，不该报错')
  // 开工台本身照常可用（删掉「继续已有项目」后，表单只剩开新项目这条路径）
  wbButton(h.tree(), '打开').props.onClick()
  text = await tick()
  assert.match(text, /基本设置/, '没有项目也能开新项目（不禁用整个开工台）')
  assert.ok(!text.includes('继续已有项目'), 'v19.1.4：该节已按主人裁定删除')
})
test('试点（v19.1.0）：六块进度的判据全部来自既有快照字段（空态不猜 + 逐块真相表）', async () => {
  const h = makeReactStub()
  const mod = await loadClient(h, { fetch: fetchStub({}) })
  const P = mod.__panel
  assert.deepEqual(P.PHASES.map((p) => p.id), ['topic', 'search', 'analysis', 'writing', 'audit', 'final'],
    '六块顺序 = 块界落在两道主控闸门（T2.5/T7.5）上的那个顺序')
  const nOf = (snap, id) => P.wbPhases(snap).find((b) => b.id === id).n
  // ① 空态：**不许猜出进度**
  const empty = P.wbPhases(null)
  assert.equal(empty.length, 6)
  assert.ok(empty.every((b) => b.n === 0), '没有快照时每块都必须为 0（不美化）')
  assert.equal(empty.find((b) => b.id === 'search').d, 3, '检索块分母 = 3（T1/T2/T3）')
  // ② 逐块真相表
  assert.equal(nOf({ status: { hasStatus: true } }, 'topic'), 1)
  assert.equal(nOf({ agents: { roles: [{ role: 'T1', count: 1 }] } }, 'search'), 1)
  assert.equal(nOf({ agents: { roles: [{ role: 'T1', count: 1 }, { role: 'T2', count: 2 }, { role: 'T3', count: 1 }] } }, 'search'), 3)
  assert.equal(nOf({ agents: { roles: [{ role: 'T4', count: 1 }] } }, 'analysis'), 1)
  assert.equal(nOf({ agents: { roles: [{ role: 'T5', count: 1 }] } }, 'writing'), 1)
  assert.equal(nOf({ artifacts: { drafts: 1 } }, 'writing'), 1, '没有 T5 留痕但有初稿文件 ⇒ 也算写作有进展（两者都是机械证据）')
  assert.equal(nOf({ agents: { roles: [{ role: 'T7', count: 1 }] } }, 'audit'), 1)
  assert.equal(nOf({ artifacts: { hasFinal: true } }, 'final'), 1)
  // ③ T6（批判）在 Phase 3.6：只展示、**不计入**审计块完成度
  const a = P.wbPhases({ agents: { roles: [{ role: 'T6', count: 1 }] } }).find((b) => b.id === 'audit')
  assert.equal(a.n, 0, 'T6 不属审计块完成度')
  assert.deepEqual(a.extra, ['T6'], '但必须如实展示「见到 T6」')
})
test('进度条（v19.1.3）：**在开工表单之外**——不展开也能看到，表单里不再有它（主人裁定）', async () => {
  // 主人裁定原话：「进度条可以保留，甚至不必要在论衡开工表单里体现」「检索派发运行时没必要」
  //   ⇒ 观察面（只读）与操作面（要输入）分开：进度条独立成条；表单只管开新项目 / 续接已有项目。
  const h = makeReactStub()
  const calls = []
  const route = (u) => {
    const s = String(u)
    calls.push(s)
    if (s.includes('/projects')) return okJson({ root: '/work', projects: [{ name: 'p9' }] })
    if (s.includes('/snapshot')) {
      return okJson({
        project: 'p9',
        status: { hasStatus: true, phaseLine: 'Phase 1 并行检索' },
        agents: { roles: [{ role: 'T1', count: 1 }, { role: 'T2', count: 2 }] },
        artifacts: { drafts: 0, audits: 0, hasFinal: false, hasEvidence: false },
      })
    }
    return Promise.reject(new Error('HTTP 404'))
  }
  const mod = await loadClient(h, { fetch: route })
  const P = mod.__panel
  const props = { inputActions: { setDraft: () => {} }, ctx: { get: () => undefined } }
  const tick = async () => { const s = h.render(P.Workbench, props); await new Promise((r) => setTimeout(r, 0)); return s }
  await tick(); await tick(); await tick()
  // ① **未展开**就该能看到进度（这是它唯一的用途）；同时对照：表单不在树里
  let text = h.render(P.Workbench, props)
  assert.match(text, /定题 1\/1/, 'status.md 已建 ⇒ 定题 1/1（收起状态即可见）')
  assert.match(text, /检索 2\/3/, 'T1/T2 有留痕、T3 没有 ⇒ 检索 2/3')
  assert.match(text, /写作 0\/1/, '没有初稿也没 T5 留痕 ⇒ 写作 0/1')
  assert.ok(!/基本设置/.test(text), '对照：未展开时表单不该在树里')
  assert.ok(calls.some((u) => u.startsWith('/lunheng-panel/snapshot?project=p9')), '进度取自既有快照读面：' + calls.join(' | '))
  const snapCall = calls.find((u) => u.includes('/snapshot')) || ''
  assert.ok(/root=%2Fwork|root=\/work/.test(snapCall),
    '根已知时必须带上它（v19.1.2 实测：不带 root 在多工作区下会打到别的根 ⇒ 404）：' + snapCall)
  // ② 展开后：表单在，但**表单里没有进度条**，也没有已删掉的检索派发
  wbButton(h.tree(), '打开').props.onClick()
  await tick()
  text = h.render(P.Workbench, props)
  assert.match(text, /基本设置/, '展开后表单应在')
  for (const gone of ['Phase 进度', '检索派发', '三段派发', '仅 T1', '检索关键词']) {
    assert.ok(!text.includes(gone), '「' + gone + '」不该再出现（进度已移出表单 / 派发已按主人裁定删除）')
  }
  assert.match(text, /定题 1\/1/, '展开不影响进度条（它独立于表单）')
})

