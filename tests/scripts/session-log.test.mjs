// v19.6.7（反哺 · 生成式AI M-04）：`--session-log` 的会话 id 过滤必须含**目录名**。
//
// 病灶（实测）：`loadSessions(id, { sessionRoot })` 旧实现用 `basename(f).includes(target)` 过滤——
//   而会话文件的 basename 恒为 `session.v4.jsonl.zstd`（**不含 id**），会话 id 落在**目录名**上
//   （本机布局 `<sessionRoot>/<workspace>/<id>/session.v4.jsonl.zstd`）⇒ 传 id 时**零命中**、
//   消费方 exit 10「未匹配到任何会话文件」；只有传目录/文件路径才通过。
//   最坏后果：交付前的「独立核对层」按文档写法（传 id）即失败，被误读成「没有留痕」。
//
// 本用例钉三件事：① 传 id 必须命中；② 传目录名片段仍命中（旧语义不退化）；③ 不存在的 id 零命中
//   （防修成「匹配一切」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmp } from '../_fixtures.mjs'
import { loadSessions } from '../../skills/lunheng-article-pipeline/scripts/_lib/session-log.mjs'

test('v19.6.7（反哺 M-04）：会话 id 过滤按完整路径匹配（含目录名），且不存在的 id 零命中', () => {
  const d = tmp('lh-session-log-')
  try {
    const root = join(d, 'sessions')
    const id = 'sess-abc123'
    const dir = join(root, 'workspace-x', id)
    mkdirSync(dir, { recursive: true })
    // `.jsonl`（非 zstd）走直读路径（本文件头注释第 18 行明示测试用这条路径）
    writeFileSync(join(dir, 'session.v4.jsonl'),
      JSON.stringify({ type: 'tool/call', time: '2026-10-16T00:00:00Z', data: { name: 'pwsh', arguments: '{"command":"ls"}' } }) + '\n')

    // ① 传**会话 id**（旧版零命中）：必须匹配到该会话文件
    const byId = loadSessions(id, { sessionRoot: root })
    assert.equal(byId.files.length, 1, '按会话 id 必须命中（id 在目录名上）：' + JSON.stringify(byId.files))
    assert.ok(byId.files[0].includes(id), '命中的文件路径应包含该 id')
    assert.equal(byId.events.length, 1, '命中后应能解析出事件（非 0 条才说明真读到了）')

    // ② 传**目录名片段**仍命中（旧的文件名匹配语义不得退化）
    const byDir = loadSessions('workspace-x', { sessionRoot: root })
    assert.equal(byDir.files.length, 1, '按目录名片段也必须命中')

    // ③ 不存在的 id → 零命中（不得放宽成「匹配一切」）
    const none = loadSessions('no-such-session', { sessionRoot: root })
    assert.equal(none.files.length, 0, '不存在的 id 不得命中任何文件')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
