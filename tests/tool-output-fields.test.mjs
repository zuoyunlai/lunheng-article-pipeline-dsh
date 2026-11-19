// 工具面「输出字段」对账门（v19.27.21 · 第三方全量审计-2026-11-19 §P2-6）
//
// 要解决的问题（有历史实例）：v19.19.1 的注释自陈——`count-chars.mjs` 早已产出 `scopeSource`，
//   而 `lib/tools.js` 的 execute 是**逐字段组装**返回对象的 → 脚本明明产出了，工具把它丢弃了。
//   这类缺陷比「旗标没接线」更隐蔽：调用方以为拿全了。
//   `TOOL_FACE_FLAG_GAPS` 只对账**旗标**，对账不到**输出字段**——本文件补的就是这一维。
//
// 两层断言：
//   ① execute 返回的每个键都必须在 `output.schema.properties` 里——否则宿主按白名单投影时
//      **静默丢掉**（本仓已实测「结果深冻 + 字段白名单」两重机制）；
//   ② 脚本 `--json` 的顶层键必须 ⊆（schema properties ∪ 已登记的输出缺口）——防「脚本有、工具没有」。
//
// 覆盖面（如实）：本文件只覆盖**无需项目夹具**的两个工具（char_count / ethics_sanitize）。
//   `lunheng_m_gate` 与 `lunheng_handoff_check` 的 execute 需要真实项目目录（draft/evidence/role），
//   建那套夹具的成本高于本门当前收益，故**未覆盖**——它们的字段面由 batch21/batch22 那几组
//   已钉住的形态断言间接守着。这是刻意留的缺口，写在明处。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SKILL_DIR = join(ROOT, 'skills', 'lunheng-article-pipeline')

/** 已登记的输出缺口：脚本产出但工具面**刻意**不转发的字段。
 *  每一条都要写理由——登记制不是白名单，是「例外必须可审」。 */
const OUTPUT_FIELD_GAPS = Object.freeze({
  // 与 lib/tools.js 的 TOOL_FACE_FLAG_GAPS 同精神：旗标缺口已经有表，字段缺口此前没有。
  // 当前**没有**刻意缺口（v19.27.21 复核：char_count 的 scopeSource / degraded / degradedReason 均已接线；
  //   ethics 的 uncovered / reviewFlags / replacements 均已接线）。新增例外请在此登记并写理由。
})

/** 真装一次工具，返回注册表（与 tests/entry.test.mjs 同范式）。 */
async function realTools() {
  const fakeDefineTool = (def) => def
  const { installLunhengTools } = await import(pathToFileURL(join(ROOT, 'lib', 'tools.js')).href)
  const regs = []
  const ctx = { get: (n) => (n === 'tools' ? { register: (d) => { regs.push(d); return () => {} } } : undefined) }
  await installLunhengTools(ctx, {
    skillRoot: SKILL_DIR,
    defineToolFactory: async () => ({ defineTool: fakeDefineTool }),
    scriptTimeoutMs: 60000,
    scriptMaxOutputBytes: 4 * 1024 * 1024,
  })
  const byName = {}
  for (const t of regs) byName[t.name] = t
  return byName
}

const exec = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: undefined })

test('① char_count：execute 返回的键必须全部在 output.schema.properties 内', async () => {
  const tools = await realTools()
  const tool = tools.lunheng_char_count
  assert.ok(tool, '未注册 lunheng_char_count')
  const dir = mkdtempSync(join(tmpdir(), 'lunheng-keys-'))
  try {
    const draft = join(dir, 'draft.md')
    writeFileSync(draft, '# 测试\n\n## 摘要\n\n本文有一百个汉字。\n\n## 一、引言\n\n正文若干。\n', 'utf8')
    const out = await tool.execute({ file: 'draft.md' }, exec(dir))
    assert.ok(out && typeof out === 'object', 'execute 应返回对象')
    const declared = new Set(Object.keys(tool.output.schema.properties || {}))
    const extra = Object.keys(out).filter((k) => !declared.has(k))
    assert.deepEqual(extra, [],
      `execute 返回了 schema 未声明的键 ${JSON.stringify(extra)}——宿主会按字段白名单**静默丢弃**它们，`
    )
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('② char_count：脚本 --json 的顶层键必须 ⊆ schema ∪ 已登记缺口', async () => {
  const tools = await realTools()
  const tool = tools.lunheng_char_count
  const dir = mkdtempSync(join(tmpdir(), 'lunheng-keys-'))
  try {
    const draft = join(dir, 'draft.md')
    writeFileSync(draft, '# 测试\n\n## 摘要\n\n本文有一百个汉字。\n', 'utf8')
    const { spawnSync } = await import('node:child_process')
    // 注意：count-chars.mjs **没有** --json 旗标（它的默认输出就是 JSON）——首次落盘写了 --json，
    //   被脚本的参数白名单以 exit 10 拒掉。这是「脚本旗标真源在 --help」的又一例样本。
    const r = spawnSync(process.execPath, [join(SKILL_DIR, 'scripts', 'count-chars.mjs'), draft], {
      encoding: 'utf8', timeout: 60000, windowsHide: true,
    })
    assert.equal(r.status, 0, `count-chars --json 应 exit 0，实际 ${r.status}：${String(r.stderr).slice(0, 300)}`)
    const j = JSON.parse(String(r.stdout).slice(String(r.stdout).indexOf('{')))
    const declared = new Set([...Object.keys(tool.output.schema.properties || {}), ...Object.keys(OUTPUT_FIELD_GAPS)])
    const dropped = Object.keys(j).filter((k) => !declared.has(k))
    assert.deepEqual(dropped, [],
      `脚本产出了 ${JSON.stringify(dropped)} 而工具 schema 未声明——这正是 v19.19.1 记过的「脚本有、工具丢弃」形态；`
    )
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('③ ethics_sanitize：execute 返回的键必须全部在 schema 内（含新加的 uncovered）', async () => {
  const tools = await realTools()
  const tool = tools.lunheng_ethics_sanitize
  assert.ok(tool, '未注册 lunheng_ethics_sanitize')
  const dir = mkdtempSync(join(tmpdir(), 'lunheng-keys-'))
  try {
    writeFileSync(join(dir, 'note.txt'), '受访者张伟在北京市海淀区5号院3号楼802室工作，电话13812345678。', 'utf8')
    const out = await tool.execute({ file: 'note.txt' }, exec(dir))
    const declared = new Set(Object.keys(tool.output.schema.properties || {}))
    const extra = Object.keys(out).filter((k) => !declared.has(k))
    assert.deepEqual(extra, [], `execute 返回了 schema 未声明的键 ${JSON.stringify(extra)}`)
    // 结构性：uncovered 必须是 schema 里的一等字段（否则「我没有能力」到不了消费方）
    assert.ok(declared.has('uncovered'), 'schema 必须声明 uncovered 字段')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
