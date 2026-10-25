// v19.27.12（2026-10-25 发版实测）：`scripts/_lib/untar.mjs` 的回归。
// 为什么必须有用例：内置解包器是 `pack-smoke` 在系统 tar 失败时的**兜底**——它一旦悄悄解错
//   （比如把 PAX 长名当普通条目、或解出 0 个文件却报成功），`pack-smoke` 会在**空的发布物**上跑断言，
//   于是「关键文件齐备」全成假失败或假通过。这里用手工构造的 tar 字节锁住四条：PAX 长名、
//   目录、越界拒收、空名拒收。
// 运行：node --test tests/scripts/untar.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { untarGz } from '../../scripts/_lib/untar.mjs'
import { ROOT, run, NPM_UNAVAILABLE, skipWhen } from '../_fixtures.mjs'

const BLOCK = 512

const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0'

// 造一个 ustar 头（名字只放前 100 字节；长名走 PAX 扩展头）
function header({ name = '', size = 0, type = '0' } = {}) {
  const b = Buffer.alloc(BLOCK)
  b.write(name.slice(0, 100), 0, 100, 'latin1')
  b.write(octal(0o644, 8), 100, 8, 'latin1')
  b.write(octal(0, 8), 108, 8, 'latin1')
  b.write(octal(0, 8), 116, 8, 'latin1')
  b.write(octal(size, 12), 124, 12, 'latin1')
  b.write(octal(0, 12), 136, 12, 'latin1')
  b.write('        ', 148, 8, 'latin1') // 校验和先填空格再算
  b.write(type, 156, 1, 'latin1')
  b.write('ustar\0', 257, 6, 'latin1')
  b.write('00', 263, 2, 'latin1')
  let sum = 0
  for (const x of b) sum += x
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1')
  return b
}

// PAX 记录：`"<总长> key=value\n"`，总长含自身
function paxRecord(key, value) {
  const body = `${key}=${value}\n`
  let len = Buffer.byteLength(body) + 2
  for (;;) {
    const cand = `${len} ${body}`
    const bl = Buffer.byteLength(cand)
    if (bl === len) return Buffer.from(cand, 'utf8')
    len = bl
  }
}

function body(buf) {
  const pad = (BLOCK - (buf.length % BLOCK)) % BLOCK
  return Buffer.concat([buf, Buffer.alloc(pad)])
}

function archive(entries) {
  const parts = []
  for (const e of entries) {
    if (e.pax) {
      const rec = body(Buffer.concat(e.pax))
      parts.push(header({ name: 'PaxHeader', size: rec.length, type: 'x' }), rec)
    }
    const content = e.content ? Buffer.from(e.content, 'utf8') : Buffer.alloc(0)
    parts.push(header({ name: e.name, size: content.length, type: e.type || '0' }), content.length ? body(content) : Buffer.alloc(0))
  }
  parts.push(Buffer.alloc(BLOCK * 2)) // 归档结尾
  return gzipSync(Buffer.concat(parts))
}

test('untar：PAX 长名 / 目录 / 普通文件都能解，内容逐字节一致', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lunheng-untar-'))
  try {
    const longName = 'package/skills/lunheng-article-pipeline/references/agents/00-主控-扩展职责-超长路径用于强制-PAX-扩展头-以免一百字节截断.md'
    assert.ok(Buffer.byteLength(longName) > 100, '夹具前提：长名必须超过 100 字节，否则不会产生 PAX 头')
    const gz = archive([
      { name: 'package/', type: '5' },
      { name: 'package/a.txt', content: 'hi' },
      { name: 'package/truncated-name', pax: [paxRecord('path', longName)], content: '长名正文' },
    ])
    const res = untarGz(gz, dir)
    assert.equal(readFileSync(join(dir, 'package', 'a.txt'), 'utf8'), 'hi')
    assert.equal(readFileSync(join(dir, longName), 'utf8'), '长名正文', 'PAX path 必须生效，不能用头里的截断名')
    assert.equal(res.files, 2)
    assert.equal(res.dirs, 1)
    assert.ok(res.entries.includes(longName))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('untar：越界条目（../）必须拒收，不能在目标目录之外落盘', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lunheng-untar-'))
  try {
    const gz = archive([{ name: '../evil.txt', content: 'x' }])
    assert.throws(() => untarGz(gz, join(dir, 'out')), /拒绝越界条目/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('untar：空文件名条目必须抛错（就是 Windows 跑者报的坏头形态）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lunheng-untar-'))
  try {
    const gz = archive([{ name: '', content: 'x' }])
    assert.throws(() => untarGz(gz, dir), /条目名为空/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('untar：解不出任何文件时抛错（不允许「成功但空」）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lunheng-untar-'))
  try {
    const gz = gzipSync(Buffer.alloc(BLOCK * 2)) // 只有结尾块
    assert.throws(() => untarGz(gz, dir), /没解出任何文件/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pack-smoke：系统 tar 失败时必须自动改用内置解包器并仍然通过（v19.27.12 端到端）', {
  // 为什么要有这条：内置解包器只在「跑者的 tar 坏了」时才执行——那条分支若长年不跑，坏了也没人知道。
  //   开关让 CI 每次都真走一遍；断言不只是 exit 0，还要看到「内置解包器：N 个文件」，
  //   否则「tar 没失败、压根没进兜底」也会被误当成通过。
  skip: skipWhen(NPM_UNAVAILABLE, '`npm pack` 在本机不可用（探测：`npm --version` 经管道 spawn → EPERM/非 0）——本用例需真打包并在真发布物上跑断言，请在无文件沙箱的 host shell 或 CI 复核'),
  timeout: 180000,
}, () => {
  const r = run([join(ROOT, 'scripts', 'pack-smoke.mjs')], {
    env: { ...process.env, LUNHENG_PACK_SMOKE_FORCE_BUILTIN_TAR: '1' },
    timeout: 180000,
  })
  assert.equal(r.code, 0, '强制内置解包时 pack-smoke 必须仍通过（门强度不得因兜底而降）：' + r.out.slice(-500))
  assert.match(r.out, /内置解包器：\d+ 个文件/, '必须真的走了内置解包器，而不是 tar 恰好成功：' + r.out.slice(0, 300))
})
