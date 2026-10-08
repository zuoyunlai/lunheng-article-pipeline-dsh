// H2/H5 集成测试（v18.60.1 反哺 v3 落地；v18.62.1 全量审计 P1-1 移除 H5）
//
// v18.76.0 重写（v18.75.1 全量架构审计 R1 · P0 修复）：**断言面从 `result` 换到「监听器返回值」**。
//   为什么必须换：真宿主交给 `tools/post-execute` 的 result 是 `dsh-tools` `materializeFinalResult()`
//   产出的**深冻对象**，且它在 `finishScheduledExecution` 里还要过一遍**字段白名单投影**——旧实现写
//   `result.reviewFlags` / `result.ethicsSanitized`，两条机制**各自独立**让它失效：
//     · D1 深冻：ESM 严格模式下赋值抛 TypeError（被监听器自己的裸 catch 吞掉，对外不可见）；
//     · D2 投影：非白名单字段被结构性丢弃（连 tools/result 通知与会话日志都到不了）。
//   实测读数（本仓 `%TEMP%` 探针，见 `audits/核实报告-v18.75.1-全量架构审计-2026-10-04.md` §2）：
//     [A] 可变 result（**本文件旧版夹具的形状**）→ `result.ethicsSanitized` 真的出现了 → 旧断言全绿；
//     [B] 深冻 result（真宿主的形状）        → `listenerThrew: null`、result 零新属性 → 现状是**静默失效**。
//   故本文件第 2 个用例（真宿主形状）就是 R1 的**反事实回归**：把实现退回「写 result」形态时它会红。
// 现行契约（详见 `lib/index.js` 的 H2 监听器头注释）：
//   ① 摘要走 `decision.additionalContexts`（宿主唯一采纳的插件副通道，元素 = `createUserMessage` 形状）；
//   ② opt-in 改写走 `decision.content`；③ `ethicsSanitized` 只挂返回值（同进程监听器可见）；
//   ④ `next()` 只调一次、绝不截断；⑤ 降级必留痕（warn）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const INDEX_MOD = join(PACKAGE_ROOT, 'lib', 'index.js')

/** 贴近 Cordis 真实语义的 ctx：ctx.on 收集监听器，ctx.effect 同步跑 fn 拿 disposer。 */
function makeCordaxLikeCtx() {
  const listeners = Object.create(null)
  const effectDisposers = []
  const warns = []
  const toolsRegistry = { register: () => [], guard: () => undefined }
  const skillsRegistry = { register: () => () => {} }
  const commandsRegistry = { register: () => () => {} }

  const ctx = {
    get: (n) => ({
      tools: toolsRegistry,
      commands: commandsRegistry,
      skills: skillsRegistry,
    })[n],
    on: (event, listener) => {
      ;(listeners[event] ??= []).push(listener)
      return () => {}
    },
    effect: (fn) => {
      const result = fn()
      if (result && typeof result.then === 'function') {
        result.then((d) => effectDisposers.push(d)).catch(() => {})
      } else if (typeof result === 'function') {
        effectDisposers.push(result)
      }
      return () => {}
    },
    logger: { info: () => {}, warn: (m) => warns.push(String(m)), error: () => {} },
  }
  // 补 skills 服务（inject 写死）
  ctx.skills = skillsRegistry
  return { ctx, listeners, warns }
}

/** 按宿主 `ctx.waterfall(..., "tools/post-execute", exec, result, next)` 的 3 参形状 fire。 */
async function fire(ctx, listeners, event, ...args) {
  const arr = listeners[event] || []
  const results = []
  for (const fn of arr) {
    const r = await fn(...args)
    results.push(r)
  }
  return results
}

/** 宿主真实 result 形状：content 是 content 块数组（见 dsh-tools postExecute 的 `result.content`）。 */
function makeResult(text) {
  return { content: [{ type: 'text', text }], isError: false }
}

/** 递归冻结——与宿主 `deepFreeze`（@deepseek-ai/dsh-util-values）同语义的最小替身。 */
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const k of Object.keys(o)) deepFreeze(o[k])
  }
  return o
}

const HOST_NEXT = () => Promise.resolve({ kind: 'accept' })

/** 收集一次 H2 驱动所需的全部读数（新契约下断言面 = 返回值 + result 未被改动）。 */
async function driveH2({ config = {}, name = 'read', text, frozen = true, next = HOST_NEXT } = {}) {
  const { ctx, listeners, warns } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, config)
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['tools/post-execute'] || []
  assert.ok(handlers.length >= 1, 'H2 监听器未注册到 ctx.on(tools/post-execute)')

  const exec = { name, arguments: {}, agent: {} }
  const result = makeResult(text)
  if (frozen) deepFreeze(result)
  const before = JSON.stringify(result)
  const decision = await handlers[0](exec, result, next)
  return { result, decision, before, warns, handlers, listeners }
}

test('H2 契约：listener 形参个数 = 3（exec, result, next）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const handlers = listeners['tools/post-execute'] || []
  assert.ok(handlers.length >= 1, 'H2 监听器未注册到 ctx.on(tools/post-execute)')
  assert.equal(
    handlers[0].length,
    3,
    'H2 监听器必须是 3 参 (exec, result, next)——4 参会在真实宿主每次工具调用抛 next is not a function',
  )
})

test('H2 R1 核心回归：**深冻 result**（真宿主形状）驱动 → 不抛错、result 零新属性、标记由**返回值**承载', async () => {
  // 这条就是 R1 的反事实网：把实现退回「写 result.*」形态，`decision.additionalContexts` 不会出现 → 必红。
  const { result, decision, before } = await driveH2({
    text: '受访者张三的手机是13800138000，他在北京市朝阳区生活。',
    frozen: true,
  })

  assert.equal(JSON.stringify(result), before, '监听器**不得**改动宿主传入的 result（深冻：改必抛，且改也到不了消费方）')
  assert.equal(result.ethicsSanitized, undefined, 'result 上不得出现 ethicsSanitized（白名单会丢弃它）')
  assert.equal(result.reviewFlags, undefined, 'result 上不得出现 reviewFlags（白名单会丢弃它）')

  assert.ok(decision && typeof decision === 'object', '监听器必须返回裁决对象（宿主只读返回值）')
  assert.equal(decision.kind, 'accept', '默认裁决应原样透传（kind 来自下游 next()）')

  // ① 结构化字段挂在返回值上（同进程监听器可见）
  assert.ok(decision.ethicsSanitized, '返回值应携带 ethicsSanitized 结构化字段')
  assert.equal(decision.ethicsSanitized.mode, 'basic')
  assert.equal(decision.ethicsSanitized.rewriteApplied, false, '默认 hookRewriteContent=false：不改写正文')
  assert.ok(decision.ethicsSanitized.counts.phone >= 1, `手机号应被识别，实际 ${JSON.stringify(decision.ethicsSanitized.counts)}`)
  assert.ok(decision.ethicsSanitized.replacements >= 1, '至少有 1 处替换')

  // ② 命中标记走 additionalContexts（宿主 tools/post-execute 唯一采纳的副通道）
  const ctxs = decision.additionalContexts
  assert.ok(Array.isArray(ctxs) && ctxs.length === 1, `应追加恰好 1 条 additionalContexts，实际 ${JSON.stringify(ctxs)}`)
  const msg = ctxs[0]
  assert.equal(msg.role, 'user', '元素必须是 user 消息（与宿主 createUserMessage 产物同形）')
  assert.ok(typeof msg.id === 'string' && msg.id.length > 0, '元素必须带唯一 id（否则 dsh-agent 的 Inbox.validate 判重会失败）')
  assert.deepEqual(msg.source, { kind: 'lunheng-article-pipeline' }, '元素应带生产者自有 source.kind（DSH 0.2.x v4 要求禁用泛用 plugin:{kind:"plugin"} 包装）')
  const marker = msg.content.map((b) => b.text).join('')
  assert.match(marker, /H2 伦理脱敏/, '标记应点名 H2')
  assert.match(marker, /命中替换 \d+ 处/, '标记应含替换计数')

  // ③ 默认不改写正文
  assert.equal(decision.content, undefined, '默认不应替换 content（只标记）')
  assert.ok(/13800138000/.test(result.content[0].text), '默认不重写时原文应保留')
})

test('H2 P1-3（v18.80.4）：opt-in 改写时**下游已替换的 decision.content 不得被覆盖**（以其为脱敏输入）', async () => {
  // 反事实网：旧实现从**原始 result.content** 重建脱敏数组再写 decision.content——下游监听器的
  //   删减/安全过滤（此处 DOWNSTREAM_SAFE_REPLACEMENT）会被整体覆盖、被删文本被重新引入 → 必红。
  const { decision } = await driveH2({
    text: '联系 a@example.com',
    config: { hookRewriteContent: true },
    next: () => Promise.resolve({ kind: 'accept', content: [{ type: 'text', text: 'DOWNSTREAM_SAFE_REPLACEMENT' }] }),
  })
  assert.ok(Array.isArray(decision.content), '下游已给 content 时应保留 content 字段')
  assert.equal(decision.content[0].text, 'DOWNSTREAM_SAFE_REPLACEMENT',
    `下游替换的 content 必须原样保留（实测 ${JSON.stringify(decision.content)}——被覆盖即审计 P1-3 病灶）`)
  assert.ok(!JSON.stringify(decision.content).includes('a@example.com'), '不得从原始 result 重新引入文本')
})

test('H2 标记**不含原文**：additionalContexts 里不得出现被脱敏的原手机号 / 原人名', async () => {
  const { decision } = await driveH2({ text: '受访者张三的手机是13800138000' })
  const marker = decision.additionalContexts.map((m) => m.content.map((b) => b.text).join('')).join('\n')
  assert.ok(!marker.includes('13800138000'), `标记不得回吐原手机号（该消息会被 host 落进会话日志）：${marker}`)
  assert.ok(!marker.includes('张三'), `标记不得回吐原人名：${marker}`)
  assert.match(marker, /phone=1/, '标记应保留**计数**（可复核又无原文）')
})

// ── v18.80.1（全量审查修订批 · 报告 §B14）：H2 标记的两个口径（**行为级**，非源码钉） ──
//   为什么必须行为级：本批实测这三处缺陷都会「改一半就好」——只改计数口径，标记反而更频繁地
//   打印一个被 `person=` 污染的假替换数；只收紧注入条件，又把唯一的量化信号一起掐掉。
test('H2 ① 标记的「替换」括号不得含 `person=`（它 = high + low，是候选合计数）', async () => {
  const { decision } = await driveH2({ text: '受访者张三的手机是13800138000。' })
  const marker = decision.additionalContexts
    .map((m) => m.content.map((b) => b.text).join('')).join('\n')
  assert.match(marker, /命中替换 \d+ 处/, '标记须含替换计数')
  assert.ok(!/\bperson=/.test(marker),
    `标记不得把 \`person\`（= personHigh + personLow 的候选合计）印进「替换」括号——`
    + `实测本会话出现过「命中替换 7 处（phone=4 / person=27 / personHigh=2 / place=1）」：27 个候选被读成 27 处替换。实际：${marker}`)
  assert.match(marker, /personHigh=/, '`personHigh` 须保留——它才是替换数的真值分项')
})

test('H2 ③ 低置信候选**不得单独**触发标记注入（候选数仍在结构化字段里，不丢信息）', async () => {
  // 病灶（实测）：姓氏正则对技术文本精度极低（9.5 KB 技术表格报 61 个候选、真名 0 个），
  //   而旧条件含 `lowCandidates > 0` ⇒ 几乎每次中文材料读取都注入一行 ~190 字符、信息量近零的标记。
  const { decision } = await driveH2({ text: '本节列出各阶段的时间与成本明细，参见下文明细。' })
  const es = decision.ethicsSanitized
  assert.ok(es, '须有 ethicsSanitized 结构化字段')
  assert.equal(es.replacements, 0, `夹具不得产生真替换（否则测不到「单独」这一面），实际 ${es.replacements}`)
  assert.ok(es.counts.personLow >= 0, 'counts.personLow 必须存在（候选数的唯一载体）')
  assert.ok(!decision.additionalContexts || decision.additionalContexts.length === 0,
    '无真替换 / 无超限跳过 / 无词表缺失时**不得注入**标记（低置信候选只通知结构化字段与工具面）')
})

test('H2 必须调用 next() 且**只调一次**（不截断下游、也不重复驱动下游）', async () => {
  let calls = 0
  let sawExec = null
  const next = async () => { calls++; sawExec = 'called'; return { kind: 'accept', downstreamMarker: 1 } }
  const { decision } = await driveH2({ text: '受访者张三的手机是13800138000', next })

  assert.equal(calls, 1, `next() 必须恰好被调用 1 次，实际 ${calls} 次（不调 = 截断下游；重复调 = 下游监听器被跑两遍）`)
  assert.equal(sawExec, 'called')
  assert.equal(decision.downstreamMarker, 1, '下游裁决的字段必须保留（本监听器只在它之上追加，不替换）')
})

test('H2 下游抛错 → 传播（不吞）——同 H4 的口径', async () => {
  await assert.rejects(
    () => driveH2({ text: '手机13800138000', next: () => { throw new Error('downstream boom') } }),
    /downstream boom/,
    'next() 必须落在 try 之外：下游抛错要让宿主按「监听器抛错 → isError」处理，不得被本监听器吞成静默放行',
  )
})

test('H2 监听器：非材料类工具（write）不触发脱敏且不抛错', async () => {
  const { result, decision } = await driveH2({ name: 'write', text: '受访者张三的手机是13800138000' })
  assert.equal(decision.ethicsSanitized, undefined, '非材料类工具（write）不应触发 H2')
  assert.equal(decision.additionalContexts, undefined, '非材料类工具不追加 additionalContexts')
  assert.equal(result.content[0].text, '受访者张三的手机是13800138000', 'text 应保持不变（无脱敏）')
})

test('H2 监听器：无 content 块数组 / 无文本块 → 静默放行不抛错', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))
  const handlers = listeners['tools/post-execute'] || []

  // result 无 content 字段
  const noContent = deepFreeze({ isError: false })
  const d1 = await handlers[0]({ name: 'read', agent: {} }, noContent, HOST_NEXT)
  assert.equal(d1.ethicsSanitized, undefined, '无 content → 不注入元数据')
  assert.equal(d1.additionalContexts, undefined, '无 content → 不追加标记')

  // content 只有非文本块（如图像）
  const imageOnly = deepFreeze({ content: [{ type: 'image', source: {} }], isError: false })
  const d2 = await handlers[0]({ name: 'read', agent: {} }, imageOnly, HOST_NEXT)
  assert.equal(d2.ethicsSanitized, undefined, '无文本块 → 不注入元数据、不抛错')
})

test('H2 opt-in：Config.hookRewriteContent=true → 由**返回值 content** 承载脱敏正文', async () => {
  const { result, decision } = await driveH2({
    config: { hookRewriteContent: true },
    text: '受访者张三的手机是13800138000',
  })
  assert.ok(decision.ethicsSanitized, '应携带 ethicsSanitized')
  assert.equal(decision.ethicsSanitized.rewriteApplied, true, 'opt-in=true：应标记「已改写」')
  const text = (decision.content || []).map((b) => b.text).join('')
  assert.ok(!/13800138000/.test(text), `opt-in=true 时手机号应被替换，decision.content = ${text}`)
  assert.ok(/13800138000/.test(result.content[0].text), 'result 仍不得被改动（载体是返回值）')
})

test('H2 下游裁决携带 value 时：不得再设置 content（宿主禁止两者并存）', async () => {
  // 宿主 `dsh-tools` `postExecute`：`if (Object.hasOwn(decision,"content") && Object.hasOwn(decision,"value")) throw TypeError`
  const { decision } = await driveH2({
    config: { hookRewriteContent: true },
    text: '受访者张三的手机是13800138000',
    next: () => Promise.resolve({ kind: 'accept', value: { replaced: true } }),
  })
  assert.deepEqual(decision.value, { replaced: true }, '下游的 value 必须保留')
  assert.equal(decision.content, undefined, '不得与 value 并存（否则宿主抛 TypeError → 整次工具调用变 isError）')
  assert.ok(Array.isArray(decision.additionalContexts) && decision.additionalContexts.length === 1, '标记仍应送达')
})

test('H2 P0-1 行为回归：150 000 字符 read 结果不缩短 + truncated 正确报告（v18.62.4 全量审计 §P2-4 推荐）', async () => {
  // 150 000 字符；为了规避 ethics-sanitize 在大块 'A' 输入上邮箱正则的回退爆炸（实测 ~10s），
  //   这里用多种**已知无命中**字符（汉字混合）填充——文本中存在真实命中项（手机号）以便元数据断言。
  const filler = '论衡流水线材料 '.repeat(22000)        // 22000 * 7 = 154 000 字符
  const longText = filler + '手机13800138000' + '结尾标记-END-OF-FILE'
  assert.ok(longText.length >= 150000, `构造文本应 >= 150 000 字符，实际 ${longText.length}`)

  const { result, decision } = await driveH2({ text: longText, frozen: true })

  // ① 文本不被截断：默认不重写 → text 长度与原文一致；尾标记保留
  const outText = result.content[0].text
  assert.equal(outText.length, longText.length, `text 长度应与原文一致，实际 ${outText.length}/${longText.length}`)
  assert.ok(outText.endsWith('结尾标记-END-OF-FILE'), '尾标记应保留（v18.62.4 会因 maxChars=60000 默认值丢失尾部）')

  // ② 元数据：counts.phone >= 1，truncated 字段存在
  assert.ok(decision.ethicsSanitized, 'ethicsSanitized 必须出现在返回值上')
  assert.ok(decision.ethicsSanitized.counts.phone >= 1, `手机号应被识别，实际 ${JSON.stringify(decision.ethicsSanitized.counts)}`)
  assert.equal(decision.ethicsSanitized.truncated, false, '150 000 字符 < MAX_SAFE_INTEGER，truncated 应为 false')
})

test('H2 P2-2 体积上限：单 text 块超 hookMaxBlockChars → 跳过改写（u16 其余）', async () => {
  const bigText = '手机13800138000' + 'C'.repeat(5000)
  const { result, decision } = await driveH2({
    config: { hookMaxBlockChars: 1024, hookRewriteContent: true },
    text: bigText,
  })

  assert.ok(decision.ethicsSanitized, '应携带 ethicsSanitized')
  assert.ok(decision.ethicsSanitized.skippedTooLarge >= 1, `超限块应被跳过，实际 ${decision.ethicsSanitized.skippedTooLarge}`)
  assert.equal(decision.ethicsSanitized.hookMaxBlockChars, 1024, '上限值应如实暴露')
  // 跳过改写 → 即使 opt-in=true，正文也不变
  assert.equal(decision.content, undefined, '跳过改写时不得设置 decision.content')
  assert.equal(result.content[0].text, bigText, '跳过改写时 text 不变')
  const marker = (decision.additionalContexts || []).map((m) => m.content.map((b) => b.text).join('')).join('')
  assert.match(marker, /too-large-for-hook/, '标记应含 too-large-for-hook 类别')
})

test('基线：ctx.on 注册的工具监听器**至少**包含 tools/post-execute（契约钉住）', async () => {
  const { ctx, listeners } = makeCordaxLikeCtx()
  const mod = await import(pathToFileURL(INDEX_MOD).href)
  mod.apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))

  const postHandlers = listeners['tools/post-execute'] || []
  assert.ok(postHandlers.length >= 1, `ctx.on('tools/post-execute') 必须至少 1 个监听器——H2 注册入口；当前 ${postHandlers.length}（请检查 lib/index.js 的 ctx.on('tools/post-execute', ...) 是否还在）`)
})

test('H2 工具名大小写（P3 回归）：Read / READ / WEB_SEARCH / Subagent 变体必须同样触发脱敏', async () => {
  // 为什么需要：判定写的是 `/^(read|web_|subagent)/.test(name)` 而 `name` 未 lower——宿主若传
  //   `Read` / `READ` / `WEB_SEARCH` / `Subagent`，四个全部被判成「非材料类工具」，**静默漏脱敏**
  //   （探针实测四者 ethicsSanitized 全为 no；对照同包 lib/guard.js 的写工具名判定早已
  //   `.toLowerCase()`，同一形态在写保护面被修过、在脱敏面漏了）。材料类文本不会被脱敏 = 敏感原文
  //   一路照原样进下游，属「静默漏做」而非「少做」。
  const base = await driveH2({ name: 'read', text: '受访者张三的手机是13800138000' })
  assert.ok(base.decision.ethicsSanitized, '对照基线：小写 read 必须触发 H2（否则后续断言失去意义）')
  for (const name of ['Read', 'READ', 'WEB_SEARCH', 'Subagent']) {
    const { decision } = await driveH2({ name, text: '受访者张三的手机是13800138000' })
    assert.ok(decision.ethicsSanitized, `工具名 "${name}" 必须与小写同形触发脱敏（P3 大小写回归）`)
    assert.ok(decision.ethicsSanitized.counts.phone >= 1, `"${name}" 的标记计数应含手机号，实得 ${JSON.stringify(decision.ethicsSanitized.counts)}`)
  }
  // 对照（不得误伤）：非材料类工具的大小写变体仍不得触发
  const w = await driveH2({ name: 'Write', text: '受访者张三的手机是13800138000' })
  assert.equal(w.decision.ethicsSanitized, undefined, 'Write 不是材料类工具，不得触发脱敏')
})
