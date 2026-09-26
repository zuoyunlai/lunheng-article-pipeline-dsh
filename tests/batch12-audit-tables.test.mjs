// 第十二批（v18.12.3 收口）：**审计表里 11 项「无记录」条目的实质缺陷**回归。
//
// 背景（为什么要新建这个文件）：18.12.2 交付时我声称「三条定案都已落地」，而第三方复核指出审计 68 项里
//   有 11 项**从未被任何修订记录覆盖**。逐一查代码后确认其中 5 项是**真实且未修**的：
//     L-57 apply-diff 删掉正文里合法的行尾括号（静默数据丢失，ok:true）
//     L-58 apply-diff 多行「现况」的续行被静默丢弃（半截替换仍报 ok）
//     L-59 apply-diff 条目头正则把正文引用 `[L01]` 当条目头（真 diff 被吞）
//     L-56 apply-revision-cycle 用**改前**字数当「脚本实测」，且 body 口径含题名区
//             + 同族新发现：目标字数 `\d{4,5}` 让 `300 字` / `12,000 字` / `1.2 万 字` 解析失败
//               → G5 阻塞线**整段静默跳过且 exit 0**（主控会以为「已核」）
//     L-55 证据包只加不删 → 源被删后包内留孤儿副本，M 门核到旧副本仍判通过
//   每条都用「先造出本该报警的输入」的方式钉住，并对旧行为写对照断言。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, run, parseJson, tmp, mkRepo } from './_fixtures.mjs'

const S = (n) => join(SCRIPTS, n)

// 一份带「摘要 / 正文 / 五节文末」的正文，便于同时测字数与替换
const paper = (bodyText, { abstractLen = 0 } = {}) => [
  '# 大标题',
  '',
  '## 摘要',
  '',
  '摘'.repeat(abstractLen),
  '',
  '## 一、正文',
  '',
  bodyText,
  '',
  '## 参考文献',
  '',
  '- [L01] x',
  '',
  '## 数据来源',
  '',
  '## 案例来源',
  '',
  '## 先行者文献',
  '',
  '## AI 使用声明',
  '',
  '- AI。',
  '',
].join('\n')

const mk = (files) => {
  const d = tmp('l12-')
  mkdirSync(join(d, 'drafts'), { recursive: true })
  mkdirSync(join(d, 'audits'), { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const p = join(d, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content, 'utf8')
  }
  return d
}

// ── L-57 正文里合法的行尾括号不得被删 ──────────────────────────────────────────
test('L-57：`文字（对应的系数）` 不得被当元注记删除（旧版删尾括号且 ok:true）', () => {
  const d = mk({
    'a.md': paper('文字（对应的系数）'),
    'l.md': '[Diff 1]\n现况：文字（对应的系数）\n修改：文字（对应的系数）已订正\n',
  })
  try {
    const out = join(d, 'a2.md')
    const r = run([S('apply-diff.mjs'), join(d, 'a.md'), join(d, 'l.md'), '--out', out])
    const text = existsSync(out) ? readFileSync(out, 'utf8') : ''
    assert.match(text, /文字（对应的系数）已订正/, '正文里的合法括号必须原样保留（旧版会删成「文字已订正」）')
    assert.equal(r.code, 0, '正常替换应 exit 0：' + r.out.slice(0, 200))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('L-57：真正的元注记（含报告编号）仍应被剥离并留痕', () => {
  const d = mk({
    'a.md': paper('该结论（按 G14 报告 C-01）'),
    'l.md': '[Diff 1]\n现况：该结论（按 G14 报告 C-01）\n修改：该结论（按 G14 报告 C-01）成立\n',
  })
  try {
    const out = join(d, 'a2.md')
    const r = run([S('apply-diff.mjs'), join(d, 'a.md'), join(d, 'l.md'), '--out', out])
    const j = parseJson(r)
    assert.ok(Array.isArray(j.stripped_meta), '仍须输出 stripped_meta 留痕字段')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── L-59 条目头只认四个清单族 ────────────────────────────────────────────────
test('L-59：清单里的 `[L01]` 引用行不得吞掉真 diff（旧版 applied=0、exit 1）', () => {
  const d = mk({
    'a.md': paper('原句 A。'),
    'l.md': '[L01] 这条是正文引用，不是 diff 条目\n\n[Diff 1]\n现况：原句 A。\n修改：新句 B。\n',
  })
  try {
    const out = join(d, 'a2.md')
    const r = run([S('apply-diff.mjs'), join(d, 'a.md'), join(d, 'l.md'), '--out', out])
    const j = parseJson(r)
    assert.equal(j.applied, 1, '`[L01]` 后面的真 diff 必须被应用：' + r.out.slice(0, 300))
    assert.match(readFileSync(out, 'utf8'), /新句 B。/)
    assert.equal(r.code, 0)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('L-59：非四族的方括号头（如 `[1]`）→ 0 条并**点名**，不再只说「未解析出条目」', () => {
  const d = mk({
    'a.md': paper('原句 A。'),
    'l.md': '[1] 旧式纯数字头\n现况：原句 A。\n修改：新句 B。\n',
  })
  try {
    const r = run([S('apply-diff.mjs'), join(d, 'a.md'), join(d, 'l.md'), '--dry-run'])
    assert.match(r.out, /都不是\*\*可识别的条目头|都不是.*可识别的条目头/, '须点名「方括号行但不可识别」：' + r.out.slice(0, 400))
    assert.match(r.out, /\[Diff N\]/, '须给出可识别的四种前缀')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── L-58 丢弃行必须上报且 ok 转假 ─────────────────────────────────────────────
test('L-58：多行「现况」的续行被丢弃 → ok 转假 + 点名（旧版半截替换仍 ok:true）', () => {
  const d = mk({
    'a.md': paper('第一句。第二句。'),
    'l.md': '[Diff 1]\n现况：第一句。\n  第二句。\n修改：第一句。第二句（已改）。\n',
  })
  try {
    const out = join(d, 'a2.md')
    const r = run([S('apply-diff.mjs'), join(d, 'a.md'), join(d, 'l.md'), '--out', out])
    const j = parseJson(r)
    assert.equal(j.dropped_count, 1, '丢弃行须被计数：' + r.out.slice(0, 300))
    assert.equal(j.ok, false, '有丢弃行时 ok 必须转假（旧版 true）')
    assert.equal(r.code, 1, 'exit 1（走既有的「需人工处理」通道）')
    assert.match(r.out, /续行|未参与替换/, 'stderr 须点名')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('L-58 对照：规规矩矩的清单仍 ok:true / exit 0（不误伤）', () => {
  const d = mk({
    'a.md': paper('原句 A。'),
    'l.md': '[P0-1] 改一处\n定位：正文段\n现况：原句 A。\n修改：新句 B。\n',
  })
  try {
    const out = join(d, 'a2.md')
    const r = run([S('apply-diff.mjs'), join(d, 'a.md'), join(d, 'l.md'), '--out', out])
    const j = parseJson(r)
    assert.equal(j.ok, true, '正常清单不得被新判据误伤：' + r.out.slice(0, 300))
    assert.equal(r.code, 0)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── L-56 目标字数解析（静默跳过 G5）───────────────────────────────────────────
test('L-56 同族：目标字数支持 3–5 位 / 千分位 / 万·千·k（旧版 `\\d{4,5}` 全部 null → G5 静默跳过）', async () => {
  const { parseTargetChars } = await import('../skills/lunheng-article-pipeline/scripts/_lib/target-chars.mjs')
  const cases = [
    ['目标篇幅：300 字', 300],
    ['目标篇幅：800 字', 800],
    ['目标篇幅：2500 字', 2500],
    ['目标篇幅：12,000 字', 12000],
    ['目标篇幅：1.2 万 字', 12000],
    ['篇幅：3千字', 3000],
  ]
  for (const [text, want] of cases) {
    assert.equal(parseTargetChars(text).value, want, `${text} 应解析为 ${want}`)
  }
  // 解析不到时必须**说明原因**（不能静默 null）
  for (const bad of ['没有这一行', '目标篇幅：50 字', '目标篇幅：99999999 字']) {
    const r = parseTargetChars(bad)
    assert.equal(r.value, null)
    assert.ok(r.reason && r.reason.length > 4, `${bad} 必须给 reason`)
  }
})

test('L-56：apply-revision-cycle 的「脚本实测」是**改后**值、且 body 口径与 count-chars 逐字同源', () => {
  const d = mk({
    '01-任务简报.md': '# 简报\n\n目标篇幅：300 字\n',
    'drafts/初稿-v1.md': paper('甲'.repeat(300), { abstractLen: 50 }),
    'list.md': `[Diff 1]\n现况：${'甲'.repeat(300)}\n修改：${'甲'.repeat(200)}\n`,
  })
  try {
    // ⚠️ `--diff-list` 按 `process.cwd()` 解析（不是项目目录）→ 用 cwd 相对的清单路径，
    //    这正是真实派发里的形态（主控从仓库根跑，清单写作 `run/<项目>/analysis/vN-diff-list.md`）
    const r = run([S('apply-revision-cycle.mjs'), d, '2', '--diff-list', join(d, 'list.md'), '--skip-bundle'], { cwd: d })
    const j = parseJson(r)
    // 关键回归（L-56 的**实质**）：改前 353、改后 253 —— 差 **100**（正好是清单里删掉的 100 个「甲」）。
    //   旧版把**改前**值当 post 写进「脚本实测」，差值会是 0，而它正是修订说明那张表的唯一数据源。
    assert.equal(j.chars.prevBody, 353, '改前 body（口径见下条断言）')
    assert.equal(j.chars.nextBody, 253, '改后 body —— 旧版报的是改前的 353（差值恒 0）')
    assert.equal(j.chars.delta, -100, 'delta 必须等于清单实际改动量（旧版恒 0）')
    assert.equal(j.target, 300, '3 位目标须解析到（旧版 `\\d{4,5}` → null → G5 静默跳过）')
    assert.match(String(j.g5Verdict), /低于阻塞线|阻塞线内/, 'G5 必须真的判定，而不是「跳过」')
    // 与 count-chars 交叉核对：**同源口径 = 逐字同值**（这条把「两处各写一份实现」钉死）
    const cc = parseJson(run([S('count-chars.mjs'), join(d, 'drafts/初稿-v2.md')]))
    assert.equal(cc.hanChars, j.chars.nextBody, 'apply-revision-cycle 的 body 必须与 count-chars 同值')
    //   口径已**实测核实**（v18.12.3）：body = 「摘要标题行之后（含其行终止符）→ 首个文末节行首之前」，
    //   故 body = 摘要正文 + 关键词段 + 正文，**题名区不计**。本夹具 253 = 摘要正文 50 + 关键词行 3 + 正文 200。
    //   （2026-09 复核曾据「摘要后」的歧义措辞误判出「含题名」的假缺陷——把 count-chars 的返回值与
    //     段长度混算所致；独立复核证据：题名区[0,7)=3 / 摘要标题行[7,13)=2 / 正文区[13,377)=353。
    //     精确边界已写死进 `sections.mjs` 与 `count-chars.mjs` 注释，防二次误判。）
    assert.equal(j.chars.nextBody, 3 + 50 + 200, '当前口径 = 摘要正文 + 关键词行 + 正文（题名不计）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── L-09（v18.12.3）：M-Gate-Report 文件名**形状规则**（旧规则只拦两个字面量）────────────────────
// 旧规则 `/M-Gate-Report-v2\.2\.(4|12)(\.json|")/` 只认识 `-v2.2.4` / `-v2.2.12`，而真实项目 final/ 下的
// 变体是 `-final.json` / `-rev.json` / `-verify.json` / `-full.json` / `-v18.2.2b.json`——**任一都绕过它**。
// 后果：交付目录并存 exit=0 与 exit=1 两份 M 门报告，事后审计看到互相矛盾的结论（L-09 原文实测 5 种变体）。
test('L-09：M-Gate-Report 形状规则——`-v<数字>` 仅限 audits/，中间态命名任何位置都判 P1', () => {
  const cases = [
    // [相对技能目录的路径, 内容, 期望退出码, 说明]
    ['references/_shared/probe-canon.md', '见 `final/M-Gate-Report.json`。\n', 0, '唯一口径放行'],
    ['references/_shared/probe-ver.md', '本轮 `audits/M-Gate-Report-v3.json` 记录。\n', 0, 'audits/ 下的版本化副本合法'],
    ['references/_shared/probe-ver2.md', '裸文件名不做位置臆断：`M-Gate-Report-v3.json`。\n', 0, '无目录前缀 → 不判（防假阳性）'],
    ['references/_shared/probe-bad1.md', '见 `final/M-Gate-Report-rev.json`。\n', 1, '中间态 -rev（旧规则漏）'],
    ['references/_shared/probe-bad2.md', '见 `final/M-Gate-Report-verify.json`。\n', 1, '中间态 -verify（旧规则漏）'],
    ['references/_shared/probe-bad3.md', '见 `final/M-Gate-Report-v18.2.2b.json`。\n', 1, '带字母的版本（旧规则漏）'],
    ['references/_shared/probe-bad4.md', '版本化副本放在 final/：`final/M-Gate-Report-v4.json`。\n', 1, '版本化副本挂在 final/ 下'],
  ]
  // v18.18.0（F-7 反哺 · 合并 full 克隆）：旧实现**每个 case 各建一次 `full: true` 夹具仓**
  //   （7 案例 = 7 次整仓 cpSync，实测单次 ~478 ms → 本用例独占 ~3.4 s，占整套一成）。
  //   现改为**一个夹具仓贯穿全部 case**：每轮只改写同一个探针文件的内容（先清上一个探针，
  //   避免上一轮残留的 `-rev` 之类把下一轮带红）。用例语义逐字不变，只去掉重复克隆。
  const PROBE = 'references/_shared/probe-shape.md'
  const { d, R, repo } = mkRepo({ full: true, readme: true })
  try {
    const ccPath = join(repo, 'skills', 'lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')
    for (const [rel, content, want, why] of cases) {
      writeFileSync(join(R, PROBE), content)
      const r = run([ccPath], { cwd: d })
      const all = `${r.stdout}${r.stderr}`
      // ⚠️ 断言的是**本规则自己的输出**，不是退出码 —— `full: true` 会把整个真源克隆进夹具，
      //    真源里任何无关的红（如某个文档的字数棘轮、某条待登记项）都会顺带把 exit 变成 1，
      //    那种情况下断言 exit 就会「测到别的规则」。规则的判据 = **它自己没有报**，
      //    故正向要求「输出里不含本规则的报错」，负向要求「输出里含本规则的报错」。
      //    （仍保留 exit 的粗断言，但只作为「不该崩」的底线。）
      const reported = all.includes('M-Gate-Report 文件名形状非法') || all.includes('版本化副本挂在 final/ 下')
      assert.ok(r.code === 0 || r.code === 1, `夹具仓应正常结束，实得 ${r.code}`)
      if (want === 0) {
        assert.ok(!reported, `${why} —— 本规则不该报，却报了：\n${all.slice(-400)}`)
      } else {
        assert.ok(reported, `${why} —— 本规则应报却没有：\n${all.slice(-400)}`)
      }
    }
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── L-07（v18.12.3）：Phase 序列自洽（速查表 = 主控计划真源，流水线全景 = 详述真源）───────────────
// 旧状：`Phase 1.5`（会真 spawn T1）与 `Phase 4.2`（整轮修订回环）**只在 pipeline-readme 的流水线全景里**，
// 不在 `SKILL.md §⚡ 启动速查表` 的 `- Phase：` 行内——而后者是主控排 `todo_write` 的唯一 Phase 真源，
// 于是主控的计划里**没有修订回环这一步**（真实项目被迫造「Phase 4 修订」这种临时命名）。
// 本用例直接复现该故障：把速查序列里的 4.2 删掉 → 必须红且点名 4.2。
test('L-07：Phase 序列自洽——速查表删掉 4.2 时必须报 P1（复现主控计划缺修订回环的成因）', () => {
  const { d, repo, R } = mkRepo({ full: true, readme: true })
  try {
    const skill = join(R, 'SKILL.md')
    const before = readFileSync(skill, 'utf8')
    const seqLine = before.split('\n').find((l) => /^\s*-\s*Phase：/.test(l))
    assert.ok(seqLine, '夹具的 SKILL.md 应有 `- Phase：` 序列行')
    assert.ok(seqLine.includes('1.5') && seqLine.includes('4.2'), '速查序列应已含 1.5 与 4.2（本次修复点）')
    writeFileSync(skill, before.replace(seqLine, seqLine.replace(' → **4.2 修订回环(≤2 轮+A 轨)**', '')))

    const r = run([join(repo, 'skills', 'lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')], { cwd: d })
    const all = `${r.stdout}${r.stderr}`
    assert.equal(r.code, 1, `期望 exit 1，实得 ${r.code}\n${all.slice(-400)}`)
    assert.match(all, /Phase 序列自洽[\s\S]*Phase 4\.2/, '必须点名是 4.2 缺失，而不是泛泛报「文档漂移」')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── 口径守卫（v18.12.3 新增）：把 count-chars 的**精确边界**钉成数字，防再次误判 ────────────────
// 为什么值得单独一条：2026-09 复核时「body 是否含题名」被误判为缺陷，根因是**没有一条用可区分字符
// 写成的边界断言**（当时靠「题名字数 + 切片长度」心算 → 得出假结论，并在测试里写下错误期望值）。
// 本用例用「各段字符互不相同」的夹具，把三个区间的汉字数各自钉死；任何边界改动都会在这里变红。
test('口径守卫：count-chars 的 body 边界（不含题名/不含各节标题行/不含文末节）', () => {
  const d = mk({
    // 题名 3 / 摘要正文 50 / 正文节标题 3（一、正文）/ 正文 300 / 文末节标题 4 / 文末 20
    'p.md': ['# 大标题', '', '## 摘要', '', '摘'.repeat(50), '', '## 一、正文', '',
      '甲'.repeat(300), '', '## 参考文献', '', '参'.repeat(20), ''].join('\n'),
  })
  try {
    const body = parseJson(run([S('count-chars.mjs'), join(d, 'p.md')]))
    const full = parseJson(run([S('count-chars.mjs'), join(d, 'p.md'), '--full']))
    assert.equal(body.hanChars, 50 + 3 + 300, 'body = 摘要正文 + 正文节标题 + 正文（题名 3 不计）')
    assert.equal(full.hanChars, 3 + 2 + 50 + 3 + 300 + 4 + 20, 'full = 全文含题名与文末节')
    // 差值必须**恰好等于**「题名 + 摘要标题 + 文末节标题 + 文末节体」= 3 + 2 + 4 + 20
    assert.equal(full.hanChars - body.hanChars, 3 + 2 + 4 + 20, 'full − body = 题名 + 摘要标题 + 文末节（含标题）')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// ── L-55 证据包陈旧副本 ──────────────────────────────────────────────────────
test('L-55：源数据卡被删后，包内孤儿副本须被判「可能陈旧」（旧版 M 门核旧副本仍判通过）', () => {
  const d = mk({
    '01-任务简报.md': '# 简报\n',
    'data/数据卡.md': '# 数据卡\n\n## 📇 索引段\n\n[D01] 主题 ｜ 论点\n',
    'drafts/初稿-v1.md': '# 标题\n\n## 摘要\n\n正文 [D01]。\n',
  })
  try {
    const ev = join(d, 'final', '证据包')
    const b = run([S('build-evidence-bundle.mjs'), d])
    assert.equal(b.code, 0, '首次构建应成功：' + b.out.slice(0, 300))
    assert.ok(existsSync(join(ev, 'manifest.json')), '须产出清单')
    // 删源 → 包内副本成为孤儿
    unlinkSync(join(d, 'data', '数据卡.md'))
    const r = run([S('m-gate-check.mjs'), join(d, 'drafts/初稿-v1.md'), ev])
    const it = parseJson(r).results.find((x) => x.gate.startsWith('M-Exist-2'))
    assert.match(String(it.detail), /可能陈旧/, '须报陈旧：' + JSON.stringify(it))
    assert.match(String(it.detail), /孤儿副本/, '须说明「包内那份是孤儿副本，M 门可能核到它」')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
