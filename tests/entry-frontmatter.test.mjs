// 入口 frontmatter 解析 + 宿主违约降级 回归测试（v18.2.4，第三方审计 C.1/C.2/C.3/E.2）
//
// 为什么必须有这一条：审计发现入口的 frontmatter 判定是 `text.startsWith('---\n')`，而
//   `readFileSync(p,'utf8')` **不做行尾归一**——SKILL.md 一旦被 CRLF 检出（Windows
//   `core.autocrlf=true`，或任一编辑器另存为 CRLF），首行是 `---\r\n`，判定为假 →
//   **静默**退回内置兜底 description 且 `whenToUse` 不再注册。而 description 是模型侧路由
//   的唯一依据（官方目录只渲染 name + description）。
//   为什么静态门全绿也会漏：既有 `tests/entry.test.mjs` 断言的是「description 非空」「whenToUse 是
//   非空字符串」——**兜底 description 也非空**，故它只在真实仓库的 LF 文件上恰好通过；行尾一变即失效
//   而无任何红灯。教训：断言「字段存在」不等于断言「字段来自真源」。
//
// 本文件的做法：不导出内部函数，而是复制 `lib/` 造一个**最小同构包**，对 SKILL.md 做行尾/编码变体，
//   然后真跑一次 `apply`——测的就是发布物本身的行为（与 pack-smoke 同一思路，粒度更细）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const ENTRY = join(PACKAGE_ROOT, 'lib', 'index.js')
const REAL_SKILL_MD = join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md')

/** 内置兜底文案（入口里的 `fields.description ?? ...`）——解析失败时才会出现，故它出现即等于失败。 */
const FALLBACK = '论衡：多 Agent 深度长文流水线（学术论文 / 商业评论 / 行业分析 / 公众号）。'

/** 造最小同构包：`lib/` 全量复制（动态 import 的 tools/guard/commands 也要在）+ 只带 SKILL.md 的技能目录。 */
function makeTempPackage(transform) {
  const root = mkdtempSync(join(tmpdir(), 'lh-fm-'))
  cpSync(join(PACKAGE_ROOT, 'lib'), join(root, 'lib'), { recursive: true })
  const dir = join(root, 'skills', 'lunheng-article-pipeline')
  mkdirSync(dir, { recursive: true })
  const raw = readFileSync(REAL_SKILL_MD, 'utf8')
  writeFileSync(join(dir, 'SKILL.md'), transform ? transform(raw) : raw)
  return root
}

/** 冲刷入口里那次异步安装（C 组动态 import）并回收输出。 */
const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 5))
}

/**
 * 真跑一次入口。
 * @returns registrations / logger 记录 / 落到 console.error 的内容（后者只应在无 logger 时出现）。
 */
async function runApply(root, { logger = true } = {}) {
  const logs = { info: [], warn: [] }
  const errs = []
  const originalError = console.error
  console.error = (...args) => { errs.push(args.join(' ')) }
  try {
    const mod = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)
    const regs = []
    const ctx = {
      get: () => undefined,
      effect: (fn) => fn(),
      skills: { register: (d) => { regs.push(d); return () => {} } },
      ...(logger ? { logger: { info: (m) => logs.info.push(m), warn: (m) => logs.warn.push(m) } } : {}),
    }
    mod.apply(ctx)
    await settle()
    return { regs, logs, errs }
  } finally {
    console.error = originalError
  }
}

const withTemp = async (transform, fn) => {
  const root = makeTempPackage(transform)
  try {
    return await fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** 真源 SKILL.md 的正文（与入口应当产出的 body 一致；行尾归一是入口的既定行为）。 */
const realBody = () => {
  const raw = readFileSync(REAL_SKILL_MD, 'utf8').replace(/\r\n?/g, '\n')
  return raw.slice(raw.indexOf('\n---', 4) + 4).replace(/^\n+/, '')
}

test('C.1 CRLF 行尾：SKILL.md 是 CRLF 时 frontmatter 仍必须解析（不得退回兜底描述）', async () => {
  await withTemp((raw) => raw.replace(/\n/g, '\r\n'), async (root) => {
    const { regs, logs, errs } = await runApply(root)
    assert.equal(regs.length, 1, '技能必须照常注册')
    assert.notEqual(regs[0].description, FALLBACK, 'CRLF 行尾下退回了内置兜底 description（审计 C.1 回归）')
    assert.match(regs[0].description, /论衡：DSH 原生多 Agent 深度长文流水线/, 'description 必须来自 frontmatter 真源')
    assert.equal(typeof regs[0].whenToUse, 'string', 'CRLF 下 whenToUse 也必须注册（丢了 = 模型侧路由字段整块消失）')
    assert.equal(regs[0].content, realBody(), '正文必须与真源一致（行尾归一是既定行为）')
    assert.deepEqual(logs.warn, [], '解析成功时不得报「未解析」')
    assert.deepEqual(errs, [], '宿主有 logger 时不得退回 console.error（审计 C.3）')
  })
})

test('C.1 UTF-8 BOM：文件带 BOM 时 frontmatter 仍必须解析', async () => {
  await withTemp((raw) => `\uFEFF${raw}`, async (root) => {
    const { regs, logs } = await runApply(root)
    assert.equal(regs.length, 1)
    assert.notEqual(regs[0].description, FALLBACK, 'BOM 下退回了内置兜底 description')
    assert.equal(typeof regs[0].whenToUse, 'string')
    assert.deepEqual(logs.warn, [])
  })
})

test('C.2 前置空行 + 缺闭合行：必须响亮告警并把兜底形态说清楚（不得静默）', async () => {
  await withTemp(() => '\n---\nname: "x"\ndescription: "不该被采信"\n', async (root) => {
    const { regs, logs } = await runApply(root)
    assert.equal(regs.length, 1, '解析失败也必须照常注册（兜底形态是既定设计）')
    assert.equal(regs[0].description, FALLBACK, '未解析 → 内置兜底')
    assert.equal(regs[0].whenToUse, undefined, '未解析 → whenToUse 不注册')
    assert.equal(logs.warn.length, 1, '必须恰好告警一次（审计 C.2：此前完全静默）')
    assert.match(logs.warn[0], /frontmatter 未解析/)
    assert.match(logs.warn[0], /CRLF/, '告警必须点出常见成因，否则收到告警的人无从下手')
  })
})

test('C.3 静音开关：LUNHENG_QUIET=1 静音信息行，但降级告警不静音', async () => {
  process.env.LUNHENG_QUIET = '1'
  try {
    await withTemp(() => '\n坏文件（无 frontmatter）\n', async (root) => {
      const { logs } = await runApply(root)
      assert.equal(logs.warn.length, 1, '降级（warn）必须始终可见——「静默降级」正是 v18.0.0 事故的形态')
      assert.deepEqual(logs.info, [], 'LUNHENG_QUIET=1 时信息行必须静音')
    })
  } finally {
    delete process.env.LUNHENG_QUIET
  }
})

test('C.3 无 logger 宿主：退回 console.error，信息不丢', async () => {
  await withTemp(() => '\n坏文件（无 frontmatter）\n', async (root) => {
    const { logs, errs } = await runApply(root, { logger: false })
    assert.deepEqual(logs.warn, [], '无 logger 时不该走 logger')
    assert.equal(errs.length, 1, '宿主无日志面时必须退回 console.error（宁可见勿静默）')
    assert.match(errs[0], /frontmatter 未解析/)
  })
})

test('E.2 宿主违约：ctx 缺 skills 服务时必须响亮降级、不抛 TypeError，且 C 组能力照常安装', async () => {
  const mod = await import(pathToFileURL(ENTRY).href)
  const guards = []
  const warns = []
  const errs = []
  const originalError = console.error
  console.error = (...args) => { errs.push(args.join(' ')) }
  try {
    const ctx = {
      get: (n) => (n === 'tools'
        ? { register: () => () => {}, guard: (fn) => { guards.push(fn); return () => {} } }
        : undefined),
      effect: (fn) => fn(),
      logger: { info: () => {}, warn: (m) => warns.push(m) },
      // 故意不给 skills：这正是 inject 声明的硬依赖被宿主违约的形态
    }
    assert.doesNotThrow(() => mod.apply(ctx), '缺 skills 不得以 TypeError 形态炸掉入口')
    await settle() // C 组的动态 import 是异步的：不冲刷就断言 = 假绿
    assert.ok(warns.some((m) => /skills/.test(m)), '必须点名缺的是哪个服务（其余 warn 是工具链降级，不计入）')
    assert.equal(guards.length, 1, 'C 组可选能力不得因缺 skills 而一起丢失（机制写保护仍应装上）')
  } finally {
    console.error = originalError
  }
  assert.deepEqual(errs, [], '有 logger 时不得产生 console.error 噪声')
})
