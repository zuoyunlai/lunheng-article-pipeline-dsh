// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 cross-script 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/cross-script.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of, assertExitBySeverity } from '../_scripts-shared.mjs'


// v18.34.0：规则 ㉙（G 项主清单口径）——真源 = `_lib/mgate-gates/mexist-gates.mjs` 的 `G_MAIN`。
// 为什么需要：M 门项数规则 ⑥b **刻意豁免**了前缀含「G0-G14 / G 清单」的行（防把 G 项数误读成 M 门项数，
//   该豁免本身正确）——于是 G 项数成了**盲区**，实测该盲区里同时漂了四处（三处计数写 14、派发话术漏列 G14）。
// 本用例锁四件事：① 计数漂移必报；② 派发话术清单漏项必报；③ 防误报：`G14 主项` 不得被读成「14 主项」
//   （**⑩b 在 v18.22.3 踩过的同款坑**，修法同为「标识符左边界」）；④ 防误报：比较量词「缺 >3 项」不算项数。
test('consistency-check ㉙：G 项数与 G 清单对账（含两处防误报回归）', () => {
  const { d, R } = mkRepo()
  const glossary = join(R, 'references', 'glossary.md')
  const dispatch = join(R, 'references', 'pipeline-readme.md')
  const gBase = readFileSync(glossary, 'utf8')
  const dBase = readFileSync(dispatch, 'utf8')
  const check = () => {
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    return r.out
  }

  // ① 计数漂移：真源 15 → 写成 14（本批实测的真实漂移形态）
  writeFileSync(glossary, gBase.replace('**15 项硬门 = 机检硬门**', '**14 项硬门 = 机检硬门**'))
  let out = check()
  assert.match(out, /G 项数口径漂移/, 'G 项数写成 14 必须报：' + out.slice(0, 300))
  writeFileSync(glossary, gBase)

  // ② 清单漏项：把派发话术里的 G14 去掉（本批实测的真实漂移形态）
  writeFileSync(dispatch, dBase.replace(' / **G14 中文 AI 痕迹**', ''))
  out = check()
  assert.match(out, /G 项清单漏项/, '派发话术漏 G14 必须报：' + out.slice(0, 300))
  assert.match(out, /漏 G14/, '报错必须点名漏了哪一项')
  writeFileSync(dispatch, dBase)

  // ③ 防误报：`G14 主项` 不是「14 主项」（标识符左边界；⑩b v18.22.3 同款坑）
  writeFileSync(glossary, gBase + '\n- 探针：G0-G14 主项逐条执行即可。\n')
  out = check()
  assert.ok(!/G 项数口径漂移/.test(out), '「G14 主项」不得被读成计数声明：' + out.slice(0, 300))

  // ④ 防误报：比较量词「缺 >3 项 → P0」不是 G 项数
  writeFileSync(glossary, gBase + '\n- 探针：G0-G14 十五个主项；缺 >3 项 → P0。\n')
  out = check()
  assert.ok(!/G 项数口径漂移/.test(out), '「缺 >3 项」不得被读成 G 项数：' + out.slice(0, 300))

  // ⑤ 防空转：真源必须真的从代码派生（G_MAIN 找不到时是 P0，而不是静默不判）
  const mg = join(R, 'scripts', '_lib', 'mgate-gates', 'mexist-gates.mjs')
  const mgBase = readFileSync(mg, 'utf8')
  writeFileSync(mg, mgBase.replace('const G_MAIN =', 'const G_MAIN_X ='))
  out = check()
  assert.match(out, /派生源失效/, 'G_MAIN 消失时必须响亮报错（否则本规则恒真）')
  writeFileSync(mg, mgBase)
  writeFileSync(glossary, gBase)
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ④b+⑲：占位符残留 / 版本硬编码 / 契约表断链都必须报（注入验证）', () => {
  const { d, repo, R } = mkRepo()
  // ① 占位符残留
  const t5 = join(R, 'references', 'agents', '05-写作-writer.md')
  writeFileSync(t5, readFileSync(t5, 'utf8') + '\n> 校验方式：（命令已剥离·DSH 用 read 推理）\n')
  // ② 版本化报告写死 -v1.md
  const be = join(R, 'scripts', 'build-evidence-bundle.mjs')
  writeFileSync(be, readFileSync(be, 'utf8').replace('const LATEST_REPORTS = [', "const LEGACY = ['audits/审计报告-v1.md'];\nconst LATEST_REPORTS = ["))
  // ③ 契约表：产出者不再声明复核报告
  const t7 = join(R, 'references', 'agents', '07-审计-auditor.md')
  writeFileSync(t7, readFileSync(t7, 'utf8').replaceAll('复核报告', 'X报告'))
  const r = run([join(R, 'scripts', 'consistency-check.mjs')])
  {
    assertExitBySeverity(r, '注入后必须 exit 1（v18.62.4 §8.1 #12：含 P0→2，仅 P1→1）')
  }
  assert.match(r.out, /占位符残留/, '④b 必须捕获「命令已剥离」残留')
  assert.match(r.out, /版本硬编码/, '⑲ 必须捕获 -v1.md 硬编码')
  assert.match(r.out, /契约表：产出者未声明/, '⑲ 必须捕获产出者未声明')
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ⑩c：分档工具↔角色映射漂移必须报（注入验证，真源 = model-routing.mjs 的 tool→roles）', () => {
  // ① 旧口径复发：把 T6 批判 / T9 审稿 塞回「强推理档」行（v18.0.3 前 11 处副本的真实漂移形态）
  {
    const { d, repo, R } = mkRepo({ readme: true })
    const en = join(repo, 'README.md')
    writeFileSync(en, readFileSync(en, 'utf8').replace('| T4 analyst / T5 writer |', '| T4 analyst / T5 writer / T6 critical / T9 reviewer |'))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    {
      assertExitBySeverity(r, '映射漂移必须 exit 1（v18.62.4 §8.1 #12：含 P0→2，仅 P1→1）')
    }
    assert.match(r.out, /分档映射漂移/, '⑩c 必须抓出强推理档行多出 T6/T9')
    assert.match(r.out, /subagent_strong/, '⑩c 报错须点名漂移的工具')
    rmSync(d, { recursive: true, force: true })
  }

  // ② 真源不可派生 → P0（规则失效必须响，不得静默放行）
  {
    const { d, R } = mkRepo()
    const mr = join(R, 'scripts', 'model-routing.mjs')
    writeFileSync(mr, readFileSync(mr, 'utf8').replace("tool: 'subagent_audit'", "toolName: 'subagent_audit'"))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    {
      assertExitBySeverity(r, '真源不可派生必须 exit 1（v18.62.4 §8.1 #12：含 P0→2，仅 P1→1）')
    }
    assert.match(r.out, /分档真源/, '⑩c 派生失败须按 P0 报（否则整条映射门静默失效）')
    rmSync(d, { recursive: true, force: true })
  }

  // ③ 反向断言：真源仓库自身的 30 处断言齐整时，⑩c 不得误报（防止把散文/复合写法误当断言）
  {
    const r = run([join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')])
    assert.doesNotMatch(r.out, /分档映射漂移/, '真源仓库当前应零漂移（复合写法 subagent_retrieval\/strong\/audit 不得被当作断言）')
  }
})

test('consistency-check ⑩：随包脚本白名单漏列必须报（v18.0.5 补回归网）', () => {
  const { d, R } = mkRepo()
  writeFileSync(join(R, 'scripts', 'new-tool.mjs'), '// 新增脚本（未登记白名单）\n')
  const r = run([join(R, 'scripts', 'consistency-check.mjs')])
  {
    assertExitBySeverity(r, '白名单漏列必须 exit 1（v18.62.4 §8.1 #12：含 P0→2，仅 P1→1）')
  }
  assert.match(r.out, /白名单/, '必须点名白名单不一致')
  rmSync(d, { recursive: true, force: true })
})

// v18.7.3 P1-5 回归：md2html / segment-chars / lunheng-stats 接入 cli-args + exit-guard。
// 旧实现拼错的 `--` token（--strick/--lst）被静默丢弃或报错口径偏移；lunheng-stats 无 exit-guard，
// run/ 下 readFileSync 抛错以默认 exit 1 收场（与「1 = 内容失败」撞义）。
test('v18.7.3 P1-5：md2html/segment-chars/lunheng-stats 参数契约——拼错旗标 exit 10 + 未知参数报错 + stats fs 异常 exit 10', () => {
  const { d, proj, fin, ev } = mkProject()
  writeFileSync(join(fin, '定稿.md'), '# 标题\n\n## 摘要\n\n正文。\n\n## 参考文献\n\nx\n')
  const out = join(fin, 'o.html')
  // md2html：拼错 --strict → exit 10（旧版静默丢弃、strict 不生效 exit 0）
  const m1 = run([join(SCRIPTS, 'md2html.mjs'), join(fin, '定稿.md'), out, '--strick'])
  assert.equal(m1.code, 10, 'md2html 拼错旗标应 exit 10')
  assert.match(m1.out + (m1.err || ''), /未知参数/)
  // md2html：多余位置参数 → exit 10（旧版静默忽略 positional[3+]）
  const m2 = run([join(SCRIPTS, 'md2html.mjs'), join(fin, '定稿.md'), out, join(fin, '定稿.md'), join(fin, '多余')])
  assert.equal(m2.code, 10, 'md2html 多余位置参数应 exit 10')
  // segment-chars：拼错 --list → exit 10 且报「未知参数」（旧版落到「至少给一个 --section」口径偏移）
  const s1 = run([join(SCRIPTS, 'segment-chars.mjs'), join(fin, '定稿.md'), '--lst'])
  assert.equal(s1.code, 10, 'segment-chars 拼错旗标应 exit 10')
  assert.match(s1.out + (s1.err || ''), /未知参数/)
  // segment-chars：多 --section 仍可用（可重复值旗标）
  const s2 = run([join(SCRIPTS, 'segment-chars.mjs'), join(fin, '定稿.md'), '--list'])
  assert.equal(s2.code, 0, 'segment-chars --list 应照常成功：' + s2.out)
  // lunheng-stats：未知参数仍 10；run 目录不存在仍 10（行为保持）
  assert.equal(run([join(SCRIPTS, 'lunheng-stats.mjs'), '--nope']).code, 10, 'lunheng-stats 未知参数应 exit 10')
  assert.equal(run([join(SCRIPTS, 'lunheng-stats.mjs'), '--run-dir', join(d, 'no-such-run')]).code, 10, 'run 目录不存在应 exit 10')
  // lunheng-stats：fs 异常 → exit 10（exit-guard 归类）。用「文件充当 run 目录」构造 readFileSync EISDIR 之外的场景：
  //   传一个存在的普通文件作 --run-dir → existsSync 过，后续 readdirSync(文件) 抛 ENOTDIR → exit-guard 应归 10 而非裸 1
  const fakeRun = join(fin, '定稿.md')
  const st = run([join(SCRIPTS, 'lunheng-stats.mjs'), '--run-dir', fakeRun])
  assert.equal(st.code, 10, 'lunheng-stats fs 异常应 exit 10（exit-guard），实得 exit=' + st.code + '：' + (st.out || st.err || '').slice(0, 120))
  rmSync(d, { recursive: true, force: true })
})

// v18.18.12（审计 F-5「模板类断言下沉到消费者」）：原用例对模板与角色卡做了 **11 处文案断言**
//   （`sheet` 必含 `Phase 0 附加块` / `本轮改动摘要` / `资源预估` / `主人待办清单` / `### 6. 主人回复`；
//    `feed` 必含 4 项收货校验；`coord` 必含两处措辞）。实测它们的问题不是「看不出来」而是**看错了对象**：
//   · **假红**——改一个标题的措辞（判据没变）就红；
//   · **假绿**——真改坏行为时，只要那串字还在别处就照样绿；
//   · **无消费者**——实测 `Phase 0 附加块` / `本轮改动摘要` / `Phase 0（定题）` / `资源预估` /
//     `主人待办清单` / 投喂清单 4 项，在 `skills/**/scripts/**` 里**零消费者**（只有人/LLM 读），
//     断言它们等于把「文案」当契约。
//   现按审计修法分三类处置：
//     ① **有消费者的下沉**——`### 6. 主人回复` 的消费者是 `handoff-check.mjs --require-gates`
//        （`<项目>/阶段确认-Phase*.md` 的 §6 段 + 五项字段），改为**真跑消费者**断言三档行为；
//     ② **无消费者的删除**——上面点名的 6 组文案断言全部删掉（模板正文**不动**，它仍是给人与 LLM 读的）；
//     ③ **契约表登记改读真表**——不再 grep `content-rules.mjs` 的源码文本，改为 `import` 真实的
//        `CONTRACTS` 表断言登记（源码文本断言对「换行/引号/合并写法」过敏）。
//   另附一条**新发现的两处维护**对账（③ 之后）：模板 §6 的条目标题 ↔ 消费者 `GATE_FIELDS`——
//   模板改了字段名而消费者没跟，没有任何门会发现；而后果是**每个项目都被判「未留痕」**。
test('模板齐备；§6 回填由消费者 handoff-check 判定；§6 字段与消费者 GATE_FIELDS 对账', async () => {
  const SK = join(ROOT, 'skills', 'lunheng-article-pipeline')
  const TPL = join(SK, 'references', 'templates')

  // ① 模板在盘 + 版本头（产物存在性，与措辞无关，保留）
  for (const f of ['进展-主人版-template.md', '主人投喂清单-template.md', 'style-baseline-template.md', '主人确认-template.md', '任务简报-template.md']) {
    const p = join(TPL, f)
    assert.ok(existsSync(p), `模板应存在: ${f}`)
    assert.ok(readFileSync(p, 'utf8').includes('版本：'), `${f} 应有版本头`)
  }
  assert.ok(existsSync(join(TPL, '模型路由表-template.md')), '模型路由表模板应存在')

  // ② §6 回填：**下沉到消费者**。造三档输入 → 断言 handoff-check 的**行为**（而不是模板里的那句文案）。
  //    注意：夹具没有产物/回报，故 exit code 恒为 20（别的项也在报）——断言**报错内容**而不是退出码。
  const GATES = ['阶段确认-Phase0.md', '阶段确认-Phase2.5.md', '阶段确认-Phase3.5.md', '阶段确认-Phase5.md']
  const FIVE = ['主人原话', '回复时间', '提问方式', '主控落盘结论', '轮次计数']
  const sec6 = (fields) => ['### 6. 主人回复（主控回填）', '', ...fields.map((f) => `- **${f}**：已回填`), ''].join('\n')
  const probeGates = (name, docBody) => {
    const d = tmp(`lunheng-f5e-${name}-`)
    for (const g of GATES) writeFileSync(join(d, g), docBody, 'utf8')
    const r = run([join(SCRIPTS, 'handoff-check.mjs'), '--project', d, '--role', 'T5', '--require-gates', '--summary'])
    rmSync(d, { recursive: true, force: true })
    return r.out
  }
  const noSec = probeGates('nos', '# 阶段确认\n\n### 5. 其他\n\n内容\n')
  assert.match(noSec, /缺「### 6\. 主人回复」段/, '缺 §6 段的确认单必须被消费者报出（决策留痕判据）')
  const missField = probeGates('miss', `# 阶段确认\n\n${sec6(FIVE.slice(0, 4))}`)
  assert.match(missField, /§6 回填不全/, '§6 缺字段必须被消费者报出')
  assert.match(missField, /缺字段 轮次计数/, '应精确指出缺的那一项')
  const full = probeGates('full', `# 阶段确认\n\n${sec6(FIVE)}`)
  assert.doesNotMatch(full, /缺「### 6\. 主人回复」段|§6 回填不全/, '五项齐全且已回填时，消费者不得再报 §6 问题')

  // ③ 两处维护对账：消费者要求的字段必须都在模板 §6 里定义。
  //    **单向**（理由同 repo-hygiene ⑧d）：模板多出的**可选**字段（如「部署上下文备注」）不报，
  //    但消费者若要求一个模板没有的字段，则每个项目都会被判「未留痕」——那才是真缺陷。
  const sheet = readFileSync(join(TPL, '主人确认-template.md'), 'utf8')
  const s6 = sheet.slice(sheet.search(/^###\s*6\./m), sheet.search(/^###\s*7\./m))
  assert.ok(s6.length > 0, '模板 §6 段应可定位（§6…§7 之间）——形状变了请同步本解析器')
  const tplFields = [...s6.matchAll(/^-\s*\*\*(.+?)\*\*/gm)].map((m) => m[1].replace(/[（(].*$/, '').trim())
  assert.ok(tplFields.length >= 5, `模板 §6 解析出的字段过少（实测 ${tplFields.length}）——形状变了？`)
  const hcSrc = readFileSync(join(SCRIPTS, 'handoff-check.mjs'), 'utf8')
  const mGf = hcSrc.match(/const GATE_FIELDS = \[([^\]]*)\]/)
  assert.ok(mGf, '消费者 handoff-check.mjs 应含 `const GATE_FIELDS = [...]`——形状变了请同步本解析器')
  const gateFields = [...mGf[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert.ok(gateFields.length >= 5, `GATE_FIELDS 解析出的字段过少（实测 ${gateFields.length}）`)
  const undef = gateFields.filter((k) => !tplFields.includes(k))
  assert.deepEqual(undef, [], `消费者要求了模板 §6 未定义的字段：${undef.join(' / ')}——模板与 handoff-check 必须同一次提交一起改`)

  // ④ 契约表登记：读**真表**（`CONTRACTS`），不 grep 源码文本
  const contracts = await import(pathToFileURL(join(SCRIPTS, '_lib', 'cc-rules', 'content-rules.mjs')).href)
  const names = contracts.CONTRACTS.map((row) => row[0])
  for (const k of ['进展-主人版', '阶段确认-', '主人投喂清单', 'style-baseline', '模型路由表']) {
    assert.ok(names.includes(k), `交接契约表应登记 ${k}（实测登记 ${names.length} 项）`)
  }

  // ⑤ token-cost 的 CLI 行为（原属本用例的 v2.5.2-dsh.17 段，是**行为**断言，保留）
  const help = run([join(SCRIPTS, 'token-cost.mjs'), '--help'])
  assert.equal(help.code, 0, 'token-cost --help 应 exit 0')
  assert.match(help.stdout, /--top N/, '帮助应列出 --top')
  const bogus = run([join(SCRIPTS, 'token-cost.mjs'), '--bogus'])
  assert.equal(bogus.code, 10, '未知参数应 exit 10（v18.12.0 L-67：1 = M 门「P1 内容失败」，用法错不得借用）')
  assert.match(bogus.out, /用法/, '未知参数应附打印用法（旧版只有一行报错）')
})

test('退出码契约：路径/参数错一律 exit 10（v18.0.2 统一，防与 P1/P0 撞码）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  mkdirSync(proj, { recursive: true })
  // m-gate-check：定稿不存在 / 证据包目录不存在 —— 旧版均为 1（= 「P1 内容失败」），会误导主控去改正文
  const g1 = run([join(SCRIPTS, 'm-gate-check.mjs'), join(proj, 'final', '定稿.md'), join(proj, 'final', '证据包')])
  assert.equal(g1.code, 10, 'm-gate-check 定稿/证据包路径不存在应 exit 10')
  assert.match(g1.out + g1.err, /定稿不存在/, '应给出可读原因')
  // final-check：项目目录不存在
  const g2 = run([join(SCRIPTS, 'final-check.mjs'), join(d, 'nope')])
  assert.equal(g2.code, 10, 'final-check 项目路径不存在应 exit 10')
  // count-chars：文件不存在 / 缺参
  const g3 = run([join(SCRIPTS, 'count-chars.mjs'), join(d, 'nope.md')])
  assert.equal(g3.code, 10, 'count-chars 文件不存在应 exit 10')
  const g4 = run([join(SCRIPTS, 'count-chars.mjs')])
  assert.equal(g4.code, 10, 'count-chars 缺参应 exit 10')
  // normalize-trust-level：缺参（其「有未决条目」仍为 1，属自有语义）
  const g5 = run([join(SCRIPTS, 'normalize-trust-level.mjs')])
  assert.equal(g5.code, 10, 'normalize-trust-level 缺参应 exit 10')
  rmSync(d, { recursive: true, force: true })
})

// ── v18.62.7（反哺-主控实测-2026-10-02 §A5）：**交付判据 = 稳定态** ──────────────────────────
//   病灶（实测）：机械值 1、T8 已裁定 0，而 `final-check` 的**进程退出码 = 1**、recommendation 写
//   「存在 P1 残留，可触发 T5 修订一轮」→ 同一件事两个读数，且退出码偏向悲观（会把已裁定干净的稿子
//   再送进一轮付费修订）。本用例钉住：`exit`/进程码 = 稳定态；机械值另存 `script_exit_raw`；两数同屏。
test('A5：final-check 交付判据取稳定态（机械 1 / 裁定 0）——exit 与 recommendation 同源，机械值另存', () => {
  const { d, proj, fin, ev } = mkProject()
  setupCards(ev)
  // M-Integrity-1 需要项目根的 01-任务简报.md：缺它该门失败 → 命中**硬 P0 红线** → 裁定被门拒绝
  //   （那是设计正确行为，但会让本用例证不到 A5）。故补一份最小简报。
  writeFileSync(join(proj, '01-任务简报.md'),
    '# 任务简报 — A5 夹具\n\n## 目标篇幅\n\n13000 汉字\n\n## 研究问题（1 个子问题）\n\n1. 甲问？\n\n## 数据需求\n\n需找数据点：1\n')
  const draft = join(fin, '定稿.md')
  // 在 DRAFT_OK 的正文区插一段**单类证据**（只引 [D01]）→ M-Form-8 的 F-AH ② 档 = 恰好 1 个 P1
  const body = '本段只引数据，刻意不引其他证据类别。'.repeat(8)
  writeFileSync(draft, DRAFT_OK.replace('\n\n## 参考文献', `\n\n## 二、乙段\n\n${body} 见 [D01]。\n\n## 参考文献`))
  // 先确证「机械值就是 1」——否则本用例证不了任何东西（断言不建立在假定上）
  const mech = run([join(SCRIPTS, 'm-gate-check.mjs'), draft, ev])
  assert.equal(mech.code, 1, '夹具必须先产出「机械 exit 1」：' + mech.out.slice(-260))
  const sha = createHash('sha256').update(readFileSync(draft)).digest('hex')
  // 预置一份**有效的** T8 裁定报告（指纹自述绑定本稿 → m-gate-check 复跑时会保留裁定值）
  writeFileSync(join(fin, 'M-Gate-Report.json'), JSON.stringify({
    exit: 0, script_exit_raw: 1, verdict_stale: false,
    verdict_scope: { draft_name: 'final/定稿.md', draft_sha256: sha },
    _t8_conclusion: { note: `已就 final/定稿.md（sha256: ${sha}）裁定：1 项属机制假阳性（已随文留痕）` },
    _t8_adjudicated_by: 'T8（主控亲执行）',
  }))
  const r = run([join(SCRIPTS, 'final-check.mjs'), proj, '--no-summary', '--report', join(d, 'fc.json')])
  assert.equal(r.code, 0, '进程退出码必须取稳定态 0（旧版取机械值 1）：' + r.out.slice(-300))
  const j = JSON.parse(readFileSync(join(d, 'fc.json'), 'utf8'))
  assert.equal(j.exit, 0, 'report.exit 应为稳定态（交付判据）')
  assert.equal(j.script_exit_raw, 1, '机械读数必须另存 script_exit_raw（两个数都在）：' + JSON.stringify({ exit: j.exit, raw: j.script_exit_raw }))
  assert.match(j.summary.recommendation, /稳定态 0/, 'recommendation 必须点明稳定态：' + j.summary.recommendation)
  assert.match(j.summary.recommendation, /机械读数 1/, 'recommendation 必须同时可见机械读数：' + j.summary.recommendation)
  assert.match(j.summary.recommendation, /✅ 终检通过/, '稳定态为 0 时文案不得再说「存在 P1 残留」')
  rmSync(d, { recursive: true, force: true })
})
