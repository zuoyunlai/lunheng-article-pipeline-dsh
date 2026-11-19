// 写保护「工具名集合充分性」回归测试（v19.27.21 · 第三方全量审计-2026-11-19 §P1-1）
//
// 为什么必须有这一条（每一条断言都对应一个**经独立探针实测为 ALLOW** 的形态）：
//   `lib/guard.js` 的 `WRITE_TOOLS` 是**按见过的命名变体枚举**收集的，而枚举法的必然结果是
//   漏掉没被想到的变体。第三方审计在真宿主上跑探针，把 `ops_load_sdk` 声明目录里的写类原始 API
//   逐个喂给 guard，实测：
//     write_file → DENY ✓　move → DENY ✓　remove → DENY ✓
//     edit_file  → **ALLOW**　replace → **ALLOW**　copy → **ALLOW**
//   后两个连 F-11 的「写样名告警」都不触发（分词不命中任何写样 token）——**完全静默**。
//   而 `SECURITY.md` 的声明是「命中受保护根的 write/edit 类调用**在分发前即被否决**」。
//   声明强于实现，故本文件把「集合的充分性」变成机械判据。
//
// 本文件测**两层**，缺一不可：
//   ① 集合层：宿主可达写类工具名 ⊆ `WRITE_TOOLS`（纯数据断言，改集合即红）；
//   ② 行为层：真装一次 guard，逐个工具名喂受保护根内路径，断言**否决**（防「集合里有、判据却不认」）。
//
// 边界（如实，不得读成「宿主新增工具也能被抓」）：
//   · 下面的清单是**手抄**自 `ops_load_sdk` 的声明目录，不是运行期派生——它防「集合被删项」，
//     **不防**「宿主新增写类工具」。后者只能靠 guard 内的 F-11 写样名告警兜可观察性。
//   · 宿主升级若新增写类工具，**必须同步本清单**；漏同步的后果是「新工具静默放行」，
//     与本次修复前的形态同源。这是本文件刻意保留的、写在明处的维护契约。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { settle } from './_fixtures.mjs'
import { WRITE_TOOLS } from '../lib/guard.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const ENTRY = join(PACKAGE_ROOT, 'lib', 'index.js')
const SKILL_DIR = join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline')

/**
 * 宿主「可达写类原始 API 名」清单（手抄，真源 = `ops_load_sdk` 的声明目录原文）。
 * 完整声明目录：grep, glob, replace, write_file, edit_file, diff, stat, copy, move, remove,
 *               read_files, read_table, read_docx, read_pdf, batch, result
 * 其中**写或等效写**的是下面这 6 个；其余（grep, glob, diff, stat, read_files 等）是读面。
 * （注：此处不得写成 read_ 加星号斜杠——那会提前闭合本 JSDoc，本次落盘已踩过一次。）
 */
const HOST_WRITE_API_NAMES = Object.freeze([
  'replace', 'write_file', 'edit_file', 'copy', 'move', 'remove',
])

/** 真装一次 guard（与 tests/guard-config.test.mjs 同一套桩，测的是发布物行为）。 */
async function installGuard() {
  const mod = await import(pathToFileURL(ENTRY).href)
  const guards = []
  const logs = { info: [], warn: [] }
  const ctx = {
    get: (n) => (n === 'tools'
      ? { register: () => () => {}, guard: (fn) => { guards.push(fn); return () => {} } }
      : undefined),
    effect: (fn) => fn(),
    skills: { register: () => () => {} },
    logger: { info: (m) => logs.info.push(m), warn: (m) => logs.warn.push(m) },
  }
  mod.apply(ctx, {})
  await settle()
  assert.equal(guards.length, 1, '入口应恰好安装一个机制写保护 guard')
  return { guard: guards[0], logs }
}

/** 构造一次「写」调用的 exec；会话工作区 = 包根，故相对路径也落在受保护面内。 */
const writeExec = (name, args) => ({
  name,
  arguments: args,
  agent: { session: { header: { cwd: PACKAGE_ROOT } } },
})

test('① 集合层：宿主可达写类原始 API 名必须全部在 WRITE_TOOLS 内', () => {
  const missing = HOST_WRITE_API_NAMES.filter((n) => !WRITE_TOOLS.has(n))
  assert.deepEqual(
    missing,
    [],
    'WRITE_TOOLS 缺少宿主可达的写类工具名 ' + JSON.stringify(missing)
      + '——这些名字在真宿主上会被 guard 放行（见本文件头注释的实测记录）。'
      + '修法：补进 lib/guard.js 的 WRITE_TOOLS；若确属非写面，把它从 HOST_WRITE_API_NAMES 移除并写明理由。',
  )
})

test('② 行为层：上述每个工具名写受保护根内路径都必须被否决', async () => {
  const { guard } = await installGuard()
  const target = join(SKILL_DIR, 'SKILL.md')   // 受保护根内的真实文件
  for (const name of HOST_WRITE_API_NAMES) {
    // 三种常见路径参数形态都试：绝对、相对、以及 `destination` 拼写（copy 类）
    const shapes = [
      { file_path: target },
      { path: target },
      { destination: target },
      { path: 'skills/lunheng-article-pipeline/SKILL.md' },   // 相对：按会话工作区解析
    ]
    for (const args of shapes) {
      const verdict = guard(writeExec(name, args))
      assert.equal(
        typeof verdict, 'string',
        '工具名 ' + name + ' 的参数形态 ' + JSON.stringify(Object.keys(args))
          + ' 未被否决——写保护对它是失效的（v19.27.21 §P1-1 的复现形态）',
      )
      assert.match(verdict, /受保护根/, '否决理由应指明受保护根（可操作性），实际：' + verdict.slice(0, 120))
    }
  }
})

test('③ 行为层反证：非写工具写同一个路径必须放行（防过收）', async () => {
  const { guard } = await installGuard()
  const target = join(SKILL_DIR, 'SKILL.md')
  // `read` 不是写工具，且参数落在受保护根内是**合法**的（读机制文件是正常动作）
  assert.equal(guard(writeExec('read', { file_path: target })), undefined)
  assert.equal(guard(writeExec('grep', { path: target, pattern: 'x' })), undefined)
})

test('④ 授权例外仍然优先：allowMechanismEdit 时不否决', async () => {
  const mod = await import(pathToFileURL(ENTRY).href)
  const guards = []
  const ctx = {
    get: (n) => (n === 'tools'
      ? { register: () => () => {}, guard: (fn) => { guards.push(fn); return () => {} } }
      : undefined),
    effect: (fn) => fn(),
    skills: { register: () => () => {} },
    logger: { info: () => {}, warn: () => {} },
  }
  mod.apply(ctx, { allowMechanismEdit: true })
  await settle()
  assert.equal(guards.length, 1)
  assert.equal(guards[0](writeExec('edit_file', { path: join(SKILL_DIR, 'SKILL.md') })), undefined,
    '主人显式授权时写保护必须让行（否则授权开关等于失效）')
})
