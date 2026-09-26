// 第八梯队回归（v18.12.0 全量审计 L-67 / L-68 / L-69 / L-70 / L-72）
//
// 本文件钉住**四处「静默失真」**：门/工具都「成功」了，但产物或结论与事实不符，且没有任何
// 副作用提示。每条都先写「修前会得到什么」的对照，避免将来有人把修好的行为又改回去。
//
//   L-67  token-budget / token-cost：用法错记成 1（= M 门「P1 内容失败」）→ 主控误触发 T5 修订轮
//   L-68  EXIT_CONTRACT 只覆盖 13/23 → 「装了 guard 却忘登记」无门发现
//   L-69  apply-diff 全部条目被跳过时仍写出与输入**逐字节相同**的「下一版」
//   L-70  md2html 无围栏感知 → 围栏内 `# 标题` 升格 <h1>、围栏内 `[图9]` 被当真图位
//   L-72  svg.mjs 的 DANGEROUS 不含 <style>（@import 外发零告警）；--report 目录缺失口径不一
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, ROOT, run, parseJson, tmp } from './_fixtures.mjs'

const S = (n) => join(SCRIPTS, n)

// ── L-67：用法/参数错必须是 10，绝不借用 1 ────────────────────────────────────────────
test('L-67 token-budget：未知参数 / 无模式 / 路径不存在 一律 exit 10（修前：前两者是 1）', () => {
  for (const [args, why] of [
    [['--bogus'], '未知参数'],
    [[], '未给任何模式'],
    [['--project', join(tmp('lunheng-b8-'), 'no-such-proj')], '项目路径不存在'],
    [['--project'], '带值旗标缺值'],
  ]) {
    const r = run([S('token-budget.mjs'), ...args])
    assert.equal(r.code, 10, `${why} 应 exit 10（参数或路径错），实得 ${r.code}：${r.out.slice(0, 200)}`)
  }
})

test('L-67 token-cost：未知参数 / 非法数值 / 未给模式 一律 exit 10（修前：全部是 1）', () => {
  for (const [args, why] of [
    [['--bogus'], '未知参数'],
    [['--top', '0'], '--top 0 非正整数'],
    [['--top', 'x'], '--top 非数字'],
    [[], '未给任何模式'],
  ]) {
    const r = run([S('token-cost.mjs'), ...args])
    assert.equal(r.code, 10, `${why} 应 exit 10，实得 ${r.code}：${r.out.slice(0, 200)}`)
  }
})

// ── L-67：退出码不变量（**独立复算**，取代原来的「源码里不许出现 process.exit(1)」文本断言）──
// v18.18.12（审计 F-5 转行为断言）：原断言 `assert.doesNotMatch(src, /process\.exit\(1\)/)` 有两个毛病：
//   · **假绿**——它只认 `exit(1)` 这一种写法。`process.exit( 1 )`（带空格）、`process.exit(0x1)`、
//     或把码装进变量 `const C = 1; process.exit(C)`，行为上与撞码完全等价，文本断言全都看不见；
//   · **扫得太窄**——真正的规则是「**任何**随包脚本都不得使用自己契约行之外的码」（1 只是最危险的那个，
//     因为 1 = M 门「P1 内容失败」）。只看两个 token 脚本 = 漏掉另外 21 个。
//   现改为对**真实产物**独立复算这条不变量（不复用门的实现，故门自己退化时仍能发现）：
//   解析 EXIT_CONTRACT → 逐脚本收集 `process.exit(<字面整数>)` → 断言每个字面码都落在本脚本契约行内。
//   设计上**只扫字面整数**（保守子集）：变量形式的码本用例不解析，交由门 ⑧ 的「一层变量内联」负责，
//   因此本用例红 ⇒ 门 ⑧ 也必然红，不会产生门看不见的假红。
//   原断言那两条具体事实（两个 token 脚本不得含 1）保留，但**改为读契约行**而非读源码文本。
test('L-67 退出码不变量：全部随包脚本的字面 exit 码都在各自契约行内（独立复算）', () => {
  const hyg = readFileSync(join(ROOT, 'scripts', 'repo-hygiene-check.mjs'), 'utf8')
  const contract = new Map()
  for (const m of hyg.matchAll(/^\s*'([\w.-]+\.mjs)':\s*\[([^\]]*)\]/gm)) {
    contract.set(
      m[1],
      m[2].split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x)),
    )
  }
  assert.ok(contract.size >= 23, `契约表至少应覆盖 23 个随包脚本，实得 ${contract.size}`)

  const dir = join(SCRIPTS)
  const violations = []
  let literals = 0
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const allowed = contract.get(f)
    if (!allowed) continue // 「装了 guard 却未登记」由下一条用例负责，此处不重复报
    const src = readFileSync(join(dir, f), 'utf8')
    for (const m of src.matchAll(/process\.exit\(\s*(\d+)\s*\)/g)) {
      literals += 1
      const code = Number(m[1])
      if (!allowed.includes(code)) violations.push(`${f} exit ${code}（契约 ${allowed.join('/')}）`)
    }
  }
  assert.ok(literals > 0, '复算未扫到任何 process.exit 字面码——扫描面失效（不许静默变成空跑）')
  assert.deepEqual(violations, [], `这些脚本使用了契约行外的退出码（撞码风险）：${violations.join('; ')}`)

  // 两个 token 脚本的具体事实：契约行不得含 1（= M 门「P1 内容失败」）——读契约，不读源码文本
  for (const f of ['token-budget.mjs', 'token-cost.mjs']) {
    assert.ok(!contract.get(f).includes(1), `${f} 的契约行不得含 1（与 M 门「P1 内容失败」撞义）`)
  }
})

// ── L-68：退出码契约的覆盖面（装了 guard 必登记）────────────────────────────────────
test('L-68 EXIT_CONTRACT 覆盖全部随包脚本，且每个 import exit-guard 的脚本都已登记', () => {
  const hyg = readFileSync(join(ROOT, 'scripts', 'repo-hygiene-check.mjs'), 'utf8')
  // v18.18.12（审计 F-5）：此处原有两条**源码文本断言**已删——
  //   `assert.match(hyg, /EXIT_GUARDED_EXEMPT\s*=\s*\{\}/)`（豁免表为空）与
  //   `assert.match(hyg, /guardedButUnregistered/)`（门里写着这条判据）。
  //   审计修法：「用同用例下半段的独立复算作**唯一判据**」。二者都被下面的复算**严格覆盖**：
  //   · 复算不读 `EXIT_GUARDED_EXEMPT`——任何人往豁免表里塞一行，该脚本就会落进 `missing` → 红，
  //     比「断言豁免表字面为空」更严（原文只查字面，改成 `{ 'x.mjs': '理由' }` 就漏了）；
  //   · 门上是否**写着**这条判据属实现细节；不变量由复算直接钉在产物上，门退化时本用例照样抓得到。

  // 独立复算一遍：模拟门的判据，防止门本身的实现悄悄退化（本用例的**唯一**判据）
  const contractNames = new Set(
    [...hyg.matchAll(/^\s*'([\w.-]+\.mjs)':\s*\[/gm)].map((m) => m[1]),
  )
  const dir = join(SCRIPTS)
  const missing = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const t = readFileSync(join(dir, f), 'utf8')
    if (/^\s*import[^\n]*from\s*['"][^'"]*_lib\/exit-guard\.mjs['"]/m.test(t) && !contractNames.has(f)) missing.push(f)
  }
  assert.deepEqual(missing, [], `这些脚本装了 exit-guard 却未登记：${missing.join(', ')}`)
  assert.ok(contractNames.size >= 23, `契约表至少应覆盖 23 个随包脚本，实得 ${contractNames.size}`)
})

// ── L-69：无实际改动不得写出「下一版」─────────────────────────────────────────────────
const MD_NOOP = '# 标题\n\n## 摘要\n\n正文内容 [L01]。\n'

test('L-69 apply-diff：清单条目全部无法定位（正文零改动）→ 不写盘、不产出同名副本、如实标 noop', () => {
  const d = tmp('lunheng-b8-diff-')
  const src = join(d, 'a.md')
  writeFileSync(src, MD_NOOP, 'utf8')
  const list = join(d, 'list.md')
  // 「现况」行在正文里**根本不存在** → locateAndReplace 必然失败 → 全部进 skipped
  writeFileSync(list, [
    '[Diff 1]',
    '现况：这段文字在正文里不存在甲乙丙丁',
    '修改：替换成别的',
    '',
  ].join('\n'), 'utf8')
  const out = join(d, 'a-v2.md')

  const r = run([S('apply-diff.mjs'), src, list, '--out', out])
  const j = parseJson(r)

  assert.equal(j.skipped, 1, '该条应被跳过（定位不到）')
  assert.equal(j.noop, true, '必须如实标注 noop（旧版没有这个字段，且会写盘）')
  assert.equal(j.written, false, '零改动不得写盘（旧版 written:true）')
  assert.equal(existsSync(out), false, '不得产出与输入逐字节相同的「下一版」副本')
  assert.equal(readFileSync(src, 'utf8'), MD_NOOP, '源正文必须原样不动')
})

test('L-69 apply-diff 对照：确有改动时照常写盘（修 noop 不能连正常路径一起改坏）', () => {
  const d = tmp('lunheng-b8-diff2-')
  const src = join(d, 'a.md')
  writeFileSync(src, MD_NOOP, 'utf8')
  const list = join(d, 'list.md')
  writeFileSync(list, [
    '[Diff 1]',
    '现况：正文内容',
    '修改：正文内容（已修订）',
    '',
  ].join('\n'), 'utf8')
  const out = join(d, 'a-v2.md')

  const r = run([S('apply-diff.mjs'), src, list, '--out', out])
  const j = parseJson(r)

  assert.equal(j.applied, 1, '该条应被应用')
  assert.equal(j.noop, false, '有改动时 noop 必须为 false')
  assert.equal(j.written, true, '有改动必须写盘')
  assert.equal(existsSync(out), true, '下一版必须存在')
  assert.match(readFileSync(out, 'utf8'), /已修订/)
})

// ── L-70：md2html 围栏感知 ────────────────────────────────────────────────────────
const MD_FENCE = [
  '# 真标题',
  '',
  '正文段落。',
  '',
  '```md',
  '# 这是代码里的井号，不应变成 h1',
  '## 也不应变成 h2',
  '- 不应变成列表',
  '[图9：代码里的图位，不应配图]',
  '```',
  '',
  '## 真二级标题',
  '',
  '结尾。',
  '',
].join('\n')

test('L-70 md2html：围栏内的井号 / 列表 / 图位一概不解析，围栏块原样进 <pre><code>', () => {
  const d = tmp('lunheng-b8-md2html-')
  const md = join(d, 't.md')
  const html = join(d, 't.html')
  writeFileSync(md, MD_FENCE, 'utf8')

  const r = run([S('md2html.mjs'), md, html])
  assert.equal(r.code, 0, '正常导出应 exit 0：' + r.out.slice(0, 300))
  const out = readFileSync(html, 'utf8')

  // ① 真标题在、代码里的假标题不在
  assert.match(out, /<h1>真标题<\/h1>/, '真 H1 必须渲染')
  assert.match(out, /<h2>真二级标题<\/h2>/, '真 H2 必须渲染')
  assert.doesNotMatch(out, /<h1>这是代码里的井号/, '围栏内 `# …` 不得升格为 <h1>')
  assert.doesNotMatch(out, /<h2>也不应变成 h2<\/h2>/, '围栏内 `## …` 不得升格为 <h2>')
  assert.doesNotMatch(out, /<li>不应变成列表<\/li>/, '围栏内 `- …` 不得变成列表项')

  // ② 围栏块被渲染为 <pre><code>，且内容原样（含井号原文）
  assert.match(out, /<pre class="md-fence" data-info="md"><code>/, '围栏应渲染为带 info 的 <pre><code>')
  assert.match(out, /# 这是代码里的井号，不应变成 h1/, '围栏内容必须原样保留')

  // ③ 围栏内的图位不计入「正文图位」（旧版：图位 1 个 + 凭空生成一张缺图占位）
  assert.match(r.stdout, /图件：正文图位 0 个/, '围栏内 [图9] 不得计入正文图位，实得：' + r.stdout.trim())
  // 注意：样式表里**总是**有 `.fig-missing { … }` 这条 CSS 规则，故不能直接 grep `fig-missing`——
  //   要断言的是「没有生成缺图占位**元素**」。
  assert.doesNotMatch(out, /class="fig-missing"/, '不得为围栏内的图位生成缺图占位元素')
})

// ── L-72a：svg.mjs 的 <style> 处置 ────────────────────────────────────────────────
test('L-72 svg：<style>@import url(外部)</style> 必须被剥离并告警（修前零告警通过）', async () => {
  // 通过 md2html 端到端观察（svg.mjs 是 ESM，Windows 绝对路径不能直接 import）
  const d = tmp('lunheng-b8-svg-')
  const svg = join(d, '图1_x.svg')
  writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
    + '<style>@import url(https://evil.example/x.css);</style>'
    + '<text x="1" y="5">1</text></svg>', 'utf8')
  const md = join(d, 't.md')
  writeFileSync(md, '# 标题\n\n[图1：测试]\n', 'utf8')
  const html = join(d, 't.html')

  const r = run([S('md2html.mjs'), md, html, '--fig-dir', d])
  const out = readFileSync(html, 'utf8')

  assert.match(r.out, /<style> 块/, '必须出现「含 <style> 块（已剥离）」告警，实得：' + r.out)
  assert.doesNotMatch(out, /@import/, '外发 @import 不得出现在导出 HTML 里')
  assert.doesNotMatch(out, /evil\.example/, '外部地址不得出现在导出 HTML 里')
})

// ── L-72b：--report 目录缺失 ──────────────────────────────────────────────────────
test('L-72 --report 目标目录不存在时自动建目录并出报告（修前各脚本口径不一）', () => {
  const d = tmp('lunheng-b8-rep-')
  const md = join(d, 'a.md')
  writeFileSync(md, '# 标题\n\n## 摘要\n\n正文 [L01]。\n', 'utf8')
  const rep = join(d, 'audits', 'deep', 'nested', 'cite.json')

  const r = run([S('cite-coverage-check.mjs'), md, '--report', rep])
  assert.ok(r.code === 0 || r.code === 1 || r.code === 3, `应正常出报告（0/1/3），实得 ${r.code}：${r.out.slice(0, 300)}`)
  assert.equal(existsSync(rep), true, '报告必须落盘（目录应被自动创建）')
  assert.match(r.out, /目标目录不存在，已创建/, '建目录必须留痕')
})

test('L-72 --report 指向被审正文 → exit 10 且原文件字节不变（同文件守卫仍在）', () => {
  const d = tmp('lunheng-b8-rep2-')
  const md = join(d, 'a.md')
  const body = '# 标题\n\n## 摘要\n\n正文 [L01]。\n'
  writeFileSync(md, body, 'utf8')

  const r = run([S('cite-coverage-check.mjs'), md, '--report', md])
  assert.equal(r.code, 10, '同文件必须 exit 10，实得 ' + r.code)
  assert.equal(readFileSync(md, 'utf8'), body, '被审正文必须逐字节不变')
})
