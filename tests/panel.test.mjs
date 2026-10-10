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
//   ⑦ **包面**：`dsh.client` 声明 + `exports["./client"]` 指向在盘文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
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
