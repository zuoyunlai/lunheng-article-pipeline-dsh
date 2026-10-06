// 机制写保护「绕过面」回归网（v18.18.0 新增 · 审计 F-4 覆盖缺口 · 补齐 v18.16.0 B-1~B-5 的五个修复）
//
// 为什么必须有这一条：v18.16.0 修了五类 guard 绕过（B-1 ~ B-5），但**当时没有留下任何回归用例**——
//   于是这五个修复全部处于「改完没人钉住」的状态，下一次重构可以静默回退而测试全绿。
//   本文件把每类绕过做成**注入前 DENY / 反向自证**的用例（对照 `lib/guard.js` 的注释与 `SECURITY.md` §信任边界）。
//
// 五类（与 v18.16.0 CHANGELOG §B 族逐条对应）：
//   B-1 受保护根**不含内嵌子技能** `skills/lunheng-commands/**` → 子技能 SKILL.md 与命令真源脚本全放行
//   B-2 写工具名判定**大小写敏感** → `Write` / `EDIT` / `Apply_Patch` 绕过
//   B-3 `*** Move to:` 分支**不可达**（正则只认 `*** Update File:`）→ 重命名覆盖受保护文件
//   B-4 载荷键名**精确匹配** → `patchContent` / `patch_text` / `diffText` 等变体绕过
//   B-5 深度上限**静默放行**（超限返回空数组）→ 7 层嵌套参数绕过
//
// 本文件真跑一次入口拿 guard（与 guard-config.test.mjs 同源 harness），测的是**发布物本身的行为**。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { settle } from './_fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const ENTRY = join(PACKAGE_ROOT, 'lib', 'index.js')
const SKILL_MD = join(PACKAGE_ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md')
const CMD_SKILL_MD = join(PACKAGE_ROOT, 'skills', 'lunheng-commands', 'SKILL.md')
const CMD_ROUTE = join(PACKAGE_ROOT, 'skills', 'lunheng-commands', 'scripts', 'route-command.mjs')
const LIB_INDEX = join(PACKAGE_ROOT, 'lib', 'index.js')

/** 真跑一次入口，回收 guard（与 guard-config.test.mjs 同形，故意重复以便本文件可独立运行）。 */
async function runApply() {
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
  mod.apply(ctx)
  await settle()
  return guards[0]
}

const exec = (name, args) => ({ name, arguments: args, agent: { session: { header: { cwd: PACKAGE_ROOT } } } })

test('B-1 受保护根含内嵌子技能：lunheng-commands 的 SKILL.md 与命令真源脚本必须被拦', async () => {
  const guard = await runApply()
  assert.ok(guard, '入口必须装上写保护')
  for (const [label, p] of [
    ['子技能 SKILL.md（定义 11 个 /lunheng 命令）', CMD_SKILL_MD],
    ['子技能命令数真源脚本（consistency-check ㉕ 的唯一真源）', CMD_ROUTE],
  ]) {
    const reason = await guard(exec('write', { file_path: p }))
    assert.ok(reason, `${label} 位于 skills/lunheng-commands/ 内，必须被拦——该目录定义流水线一半的规则（v18.16.0 B-1 回归）`)
    assert.match(reason, /机制文件写保护/)
  }
})

test('B-2 写工具名大小写不敏感：Write / EDIT / Apply_Patch 变体必须被拦', async () => {
  const guard = await runApply()
  const lower = await guard(exec('write', { file_path: SKILL_MD }))
  assert.ok(lower, '小写基线：write 必须被拦（否则后续断言失去意义）')
  for (const name of ['Write', 'EDIT', 'Apply_Patch', 'STR_REPLACE_EDITOR']) {
    const reason = await guard(exec(name, { file_path: SKILL_MD }))
    assert.ok(reason, `工具名 "${name}" 是同一写工具的变体写法，必须与小写同样被拦（v18.16.0 B-2 回归）`)
  }
})

test('B-3 `*** Move to:` 重命名路径必须被拦（原正则只认 `*** Update File:`）', async () => {
  const guard = await runApply()
  const patch = `*** Begin Patch\n*** Move to: ${SKILL_MD}\n*** End Patch\n`
  const reason = await guard(exec('apply_patch', { patch }))
  assert.ok(reason, 'apply_patch 的 `*** Move to:` 是**重命名语法**——重命名会覆盖受保护文件，必须被拦（v18.16.0 B-3 回归）')
  // 对照：`*** Update File:` 形态在修前就能拦，修后不得回归
  const upd = `*** Begin Patch\n*** Update File: ${SKILL_MD}\n@@\n-x\n+y\n*** End Patch\n`
  assert.ok(await guard(exec('apply_patch', { patch: upd })), '对照：`*** Update File:` 形态必须仍被拦（不得因 B-3 拆支而回归）')
})

test('B-4 载荷键名子串匹配：patchContent / patch_text / diffText 变体必须被拦', async () => {
  const guard = await runApply()
  const body = `*** Update File: ${SKILL_MD}\n@@\n-x\n+y\n`
  // 对照：强匹配集合里的 key 修前就能拦
  assert.ok(await guard(exec('apply_patch', { patch: body })), '对照：`patch` 键必须仍被拦')
  // v18.16.0 B-4：以下四个是原实现漏网的真实变体
  for (const key of ['patchContent', 'patch_text', 'patchText', 'diffText']) {
    const reason = await guard(exec('apply_patch', { [key]: body }))
    assert.ok(reason, `载荷键 "${key}" 含 patch/diff 子串，必须被拦（v18.16.0 B-4 回归）`)
  }
})

test('B-5 参数嵌套超深度 → 拒绝（原实现静默放行，7 层即可绕过）', async () => {
  const guard = await runApply()
  // 6 层（= MAX_DEPTH 以内）：正常判定，落在受保护文件上 → DENY
  const nest = (n) => { let o = { file_path: SKILL_MD }; for (let i = 0; i < n; i++) o = { [`k${i}`]: o }; return o }
  assert.ok(await guard(exec('write', nest(5))), '6 层嵌套内的受保护路径应被正常判 DENY（不得误伤正常嵌套）')
  // 7 层以上：无法判定 → 按 guard「只收紧」语义**拒绝**
  const deep = await guard(exec('write', nest(8)))
  assert.ok(deep, '超深嵌套参数无法判定被写路径，必须拒绝而非静默放行（v18.16.0 B-5 回归）')
  assert.match(deep, /深度|无法判定/, `拒绝理由须点明「深度/无法判定」，实得：${deep}`)
})

test('对照（不得误伤）：包外路径与非写类工具一律放行', async () => {
  const guard = await runApply()
  assert.equal(await guard(exec('write', { file_path: join(PACKAGE_ROOT, 'README.md') })), undefined,
    '包外/非机制路径必须放行——guard 的契约是「宁松勿误伤」')
  assert.equal(await guard(exec('pwsh', { command: 'echo hi > x' })), undefined,
    '非写类工具不在 guard 职责内（如实边界：guard 只看工具调用）')
  assert.equal(await guard(exec('read', { file_path: SKILL_MD })), undefined, '读工具不得被拦')
})

test('B-1 补：包内 lib/ 与 cordis.patch.yml 仍在受保护根内（回归网）', async () => {
  const guard = await runApply()
  for (const [label, p] of [['入口 lib/index.js', LIB_INDEX], ['包级 patch', join(PACKAGE_ROOT, 'cordis.patch.yml')]]) {
    assert.ok(await guard(exec('write', { file_path: p })), `${label} 必须被拦——受保护根 = 技能体 + lib/ + patch + 仓库级 scripts/`)
  }
})

// ── v18.78.1 全量审计 · 批 5（代码面）：B9 / P3 数字键 / P3 路径归一平台门 ────────────────────
// 与 runApply 同形，但额外回收 `logger.warn`——B9 的「无候选 → 必须 warn」断言需要看到告警本身。
async function runApplyLogged() {
  const mod = await import(pathToFileURL(ENTRY).href)
  const guards = []
  const warns = []
  const ctx = {
    get: (n) => (n === 'tools'
      ? { register: () => () => {}, guard: (fn) => { guards.push(fn); return () => {} } }
      : undefined),
    effect: (fn) => fn(),
    skills: { register: () => () => {} },
    logger: { info: () => {}, warn: (m) => warns.push(String(m)) },
  }
  mod.apply(ctx)
  await settle()
  return { guard: guards[0], warns }
}

test('B9 载荷键与「值本身是绝对路径」解耦：{input|patch|diff|payload} 的值直接是受保护路径时必须被拦', async () => {
  const guard = await runApply()
  assert.ok(await guard(exec('write', { file_path: LIB_INDEX })), '对照基线：file_path + 绝对路径必须被拦')
  // 修前：载荷键分支命中后直接落到分支尾，紧随其后的「顶层 + 绝对路径」兜底被 `else` 串**结构性跳过**
  //   → 这四种形态只 warn 不判（`input` 更因同时在 CONTENT_KEYS 里连 warn 都被抑制）。
  for (const key of ['input', 'patch', 'diff', 'payload', 'patchText', 'diffText']) {
    const reason = await guard(exec('apply_patch', { [key]: LIB_INDEX }))
    assert.ok(reason, `载荷键 "${key}" 的值就是受保护文件的绝对路径（未含补丁语法），必须被拦（B9 回归）`)
    assert.match(reason, /机制文件写保护/)
  }
  // 对照：同键名 + **补丁语法**（修前就能拦）不得因解耦而回归
  assert.ok(await guard(exec('apply_patch', { input: `*** Update File: ${LIB_INDEX}\n@@\n-x\n+y\n` })),
    '对照：载荷键 + 补丁文本路径必须仍被拦')
  // 对照（不得误伤）：载荷键 + **受保护根之外**的绝对路径必须放行——不得退化成「值像绝对路径就否决」
  assert.equal(await guard(exec('apply_patch', { input: join(PACKAGE_ROOT, 'README.md') })), undefined,
    '载荷键的值是包外/非机制路径的绝对路径时必须放行（guard 契约：宁松勿误伤）')
})

test('B9 双重身份：参数只有 {input: …} 且收不到候选时仍必须 warn（input 同时在 CONTENT_KEYS 与 PAYLOAD_KEYS）', async () => {
  const { guard, warns } = await runApplyLogged()
  // ① `input` 是载荷键：可能把路径藏在文本里，故「只剩 input 一个键」**不能**当作「纯内容参数」而抑制告警
  warns.length = 0
  assert.equal(await guard(exec('write', { input: '这是一段正文，不含任何路径' })), undefined, '无候选 → 不否决（「宁松勿误伤」不变）')
  assert.equal(warns.length, 1, `{input: …} 收不到候选路径时必须 warn 留痕（修前被 allContent 判据抑制）；实得 warns=${JSON.stringify(warns)}`)
  // ② 对照：真正的「纯内容键」仍不得产生噪音（降噪边界不变）
  warns.length = 0
  assert.equal(await guard(exec('write', { content: '这是一段正文' })), undefined)
  assert.equal(warns.length, 0, `纯内容键（content）不得产生告警噪音，实得 ${JSON.stringify(warns)}`)
  warns.length = 0
  assert.equal(await guard(exec('write', { text: '正文', arguments: '正文' })), undefined)
  assert.equal(warns.length, 0, `text/arguments 不得产生告警噪音，实得 ${JSON.stringify(warns)}`)
})

test('P3 数字键位参 + **相对**路径：与键名形态同等判定（修前静默放行、且不进任何兜底）', async () => {
  const guard = await runApply()
  // exec() 的会话工作区 = PACKAGE_ROOT，相对路径按它解析（与 fs 工具同源）
  assert.ok(await guard(exec('write', { 0: join('lib', 'index.js') })),
    '数字键 + 相对路径必须被解析后判定——修前只收 isAbsolute(v) 的值，此处静默放行（P3 回归）')
  assert.ok(await guard(exec('write', { 1: join('skills', 'lunheng-article-pipeline', 'SKILL.md') })),
    '数字键（非 0）+ 相对路径同样必须被拦')
  assert.ok(await guard(exec('write', { targetPath: join('lib', 'index.js') })), '对照：键名形态修前就能拦，不得回归')
  // 不误伤：解析结果落在受保护根之外的相对路径仍放行
  assert.equal(await guard(exec('write', { 0: 'README.md' })), undefined,
    '数字键 + 相对路径解析到包外/非机制路径（README.md 不在受保护根内）必须放行——不得退化成「有键就否决」')
})

test('P3 路径归一平台门：canonicalPath 的大小写归一**仅在 Windows** 生效（POSIX 不得无条件 lower）', {
  skip: process.platform === 'win32' ? 'Windows 路径本就大小写不敏感（大小写归一是正确行为）；本用例只在 POSIX 上判定' : false,
}, async () => {
  const { canonicalPath } = await import(pathToFileURL(join(PACKAGE_ROOT, 'lib', 'guard.js')).href)
  // 用一个必然不存在的根，避免 realpath 把 /tmp 这类符号链接解析成别的路径
  const p = '/nonexistent-lunheng-probe/Lunheng/Guard.js'
  assert.equal(canonicalPath(p, '/'), p,
    'POSIX 路径大小写敏感：无条件 toLowerCase 会把「与被保护根仅差大小写的真实路径」误判为命中（假否决）；' +
    '对照实现 = lib/run-path-fence.mjs 的 norm()（process.platform === "win32" ? … : s）')
})
