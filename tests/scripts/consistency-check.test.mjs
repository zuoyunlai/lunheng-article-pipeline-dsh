// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 consistency-check 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/consistency-check.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


// v18.2.3（主人授权修订；依据版本抬升 18.2.2 → 18.2.3 后的实测复核）：
//   规则⑨ 旧实现**只核 4 个文件、且只比字节大小**（`statSync().size`），
//   而**版本头替换天生等长**（`v18.2.2` → `v18.2.3`）→ size 不变 → 完全看不见。
//   实测后果：镜像里 **44 个文件**内容已变（连 SKILL.md 版本头都是旧的），本门却输出
//   「0 处漂移」= **假绿**——而镜像正是运行时真正被加载的那一份。
//   本用例注入一处**等长内容差异**（中文句号 → 中文逗号，UTF-8 下同为 3 字节），
//   确保比对**不会退回 size 代理**。（断言不依赖基线退出码：只比对「注入前无该错误、注入后有」。）
test('consistency-check ⑨：.dsh 镜像与真源 size 相同但内容不同时，必须报「内容漂移」（v18.2.3）', () => {
  const { d, repo, R } = mkRepo()
  const dshSkill = join(d, '.dsh', 'skills', 'lunheng-article-pipeline')
  cpSync(R, dshSkill, { recursive: true })
  const cc = join(repo, 'skills', 'lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')

  // ① 基线：镜像与真源内容一致 → 不应出现 .dsh 同步错误
  const baseOut = run([cc]).out
  assert.doesNotMatch(baseOut, /\[P1 \.dsh 同步\]/, '内容一致时不应报 .dsh 同步错误：' + baseOut.slice(-400))

  // ② 只改镜像：中文句号 → 中文逗号（同为 3 字节 → 文件 size 不变）
  const repoFile = join(R, 'references', 'glossary.md')
  const dshFile = join(dshSkill, 'references', 'glossary.md')
  const before = readFileSync(dshFile, 'utf8')
  assert.ok(before.includes('。'), '夹具假设该文件含中文句号')
  const after = before.replace('。', '，')
  assert.equal(Buffer.byteLength(after), Buffer.byteLength(before), '注入必须等长，否则测不到 size 盲区')
  writeFileSync(dshFile, after)
  assert.equal(statSync(dshFile).size, statSync(repoFile).size, '注入后两边 size 必须仍然相同（这正是旧版漏检的条件）')

  // ③ 等长内容漂移 → 必须被报出（旧版只比 size 会静默通过）
  const badOut = run([cc]).out
  assert.match(badOut, /\[P1 \.dsh 同步\][^\n]*内容漂移/, '等长内容漂移必须报「内容漂移」：' + badOut.slice(-400))
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ⑩b：脚本名尾随数字（如 `eff4-probe2.mjs`）**不得**被当成脚本计数断言（v18.22.3 假阳性修复，双侧锁）', () => {
  const { d, repo, R } = mkRepo()
  const cc = join(repo, 'skills', 'lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')
  const probe = join(R, 'references', '_shared', '__tmp-10b.md')

  // ① 假阳性侧：句子里只是**引用了一个尾随数字的脚本名**，没有任何计数断言 → 不得报
  //    （旧式 `(\d+)\s*\.mjs` 把 `probe2.mjs` 的 `2.mjs` 读成「写 2 个」——实测 v18.22.3 修订记录因此判红）
  writeFileSync(probe, '# 临时\n\n本表由 eff4-probe2.mjs 复跑得到同一结果（临时脚本，不入库）。\n')
  const fpOut = run([cc]).out
  assert.doesNotMatch(
    fpOut,
    /脚本计数漂移\][^\n]*__tmp-10b\.md/,
    '脚本名尾随数字被误判成计数断言（假阳性）：' + fpOut.slice(-400),
  )

  // ② 真阳性侧：同一文件写**真**计数断言 → 必须照旧报（证明修复没有削弱覆盖面）
  writeFileSync(probe, '# 临时\n\n白名单共 11 个脚本。\n')
  const tpOut = run([cc]).out
  assert.match(
    tpOut,
    /脚本计数漂移\][^\n]*__tmp-10b\.md/,
    '真计数漂移必须仍然被报（假阳性修复不得顺带放行真漂移）：' + tpOut.slice(-400),
  )
  rmSync(d, { recursive: true, force: true })
})

// v18.2.4（主人指令「修」；第三方审计「门必须覆盖它声称覆盖的规范」）：补两类**实测漏检**的回归网。
// 为什么必须有：这两处此前**全靠人工记得刷**——门绿不等于版本点位齐，而「版本头替换天生等长」，
// 漂移在字节数上完全不可见（与 v18.2.3 修掉的 size 假绿同源）。两个用例都用「注入前不报 / 注入后必报」，
// 不依赖基线退出码，从而在「夹具恰好已漂移」时也不会假绿。
test('consistency-check ①/⑦ 补面：内联 `git tag vX.Y.Z` 与 package.json 不一致时必须报（v18.2.4 新增）', () => {
  const { d, repo } = mkRepo({ readme: true, extraFiles: ['CONTRIBUTING.md'] })
  const cc = join(repo, 'skills', 'lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')

  const base = run([cc]).out
  assert.doesNotMatch(base, /内联 tag 版本漂移/, '夹具基线不应报内联 tag 漂移：' + base.slice(-400))

  const p = join(repo, 'README.md')
  const before = readFileSync(p, 'utf8')
  const after = before.replace(/git tag v\d+\.\d+\.\d+/, 'git tag v18.0.4')
  assert.notEqual(after, before, '夹具假设 README.md 含 `git tag vX.Y.Z` 内联发布示例')
  writeFileSync(p, after)

  const bad = run([cc]).out
  assert.match(
    bad,
    /\[P1 内联 tag 版本漂移\]/,
    '内联 tag 版本漂移必须被报（旧的四条版本规则全跑在技能目录内、全都扫不到仓库根这 7 处）：' + bad.slice(-400),
  )
  // 负向：普通散文里的历史版本注记**不得**被误判（那些必须允许保留旧号）
  const prose = before.replace(/git tag v\d+\.\d+\.\d+/, 'git tag v18.0.4') + '\n<!-- 历史注记：v18.0.0 引入，v18.2.3 修订 -->\n'
  writeFileSync(p, prose)
  const bad2 = run([cc]).out
  assert.equal(
    (bad2.match(/内联 tag 版本漂移/g) || []).length,
    1,
    '应恰好只报内联 tag 那一处，散文里的历史注记不得连带命中：' + bad2.slice(-400),
  )
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ⑫：加粗版版本头 `> **版本**：vX.Y.Z` 漂移必须报（v18.2.4 新增）', () => {
  const { d, R } = mkRepo()
  const cc = join(R, 'scripts', 'consistency-check.mjs')

  const base = run([cc]).out
  assert.doesNotMatch(base, /版本点位漂移/, '夹具基线不应报版本点位漂移：' + base.slice(-400))

  const p = join(R, 'references', 'glossary.md')
  const before = readFileSync(p, 'utf8')
  // 旧正则 `[-*>#]*\s*版本：` 在标记与 `版本：` 之间不许夹 `**` → 加粗形态整条逃逸
  const after = before.replace(/^>\s*版本：v[\d.]+/m, '> **版本**：v18.0.0')
  assert.notEqual(after, before, '夹具假设 glossary.md 首行是 `> 版本：vX.Y.Z`')
  writeFileSync(p, after)

  const bad = run([cc]).out
  assert.match(
    bad,
    /\[P0 版本点位漂移\][^\n]*glossary\.md/,
    '加粗版版本头漂移必须被报（旧正则漏检，实测该形态一直是人工刷的）：' + bad.slice(-400),
  )
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ㉖：UTF-8 BOM 污染必须报 P1（v18.9.0 反哺 / 教训 #2026-09-24 edit 工具静默注入 \\ufeff）', () => {
  const { d, repo, R } = mkRepo()
  const cc = join(R, 'scripts', 'consistency-check.mjs')

  // 基线：fixture 仓库（已 BOM-clean）不应报 BOM 污染
  const base = run([cc]).out
  assert.doesNotMatch(base, /BOM 污染/, '夹具基线不应报 BOM 污染（fixture 仓库已 BOM-clean）：' + base.slice(-400))

  // 注入 BOM 到一个新文件 + 修改一个 fixture 文件首部
  const bomFile = join(repo, 'test-bom-inject.md')
  writeFileSync(bomFile, '\ufeff# Test\n', 'utf8')
  const skillReadme = join(R, 'README.md')
  const before = readFileSync(skillReadme, 'utf8')
  const bomBytes = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(before, 'utf8')])
  writeFileSync(skillReadme, bomBytes)

  const bad = run([cc]).out
  assert.match(
    bad,
    /\[P1 BOM 污染\][^\n]*(test-bom-inject\.md|README\.md)/,
    'BOM 污染必须被报（v18.9.0 教训：edit 工具在含 BOM 文件上静默注入 \\ufeff）：' + bad.slice(-400),
  )

  // 清理
  rmSync(bomFile, { force: true })
  writeFileSync(skillReadme, before, 'utf8')
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check --fix：dry-run 不得改写任何文件（旧版一跑即 ReferenceError）', () => {
  const before = readFileSync(join(SCRIPTS, 'consistency-check.mjs'), 'utf8')
  const r = run([join(SCRIPTS, 'consistency-check.mjs'), '--fix'])
  assert.ok(!/ReferenceError/.test(r.out), '不得再出现 ReferenceError')
  assert.match(r.out, /dry-run/)
  assert.equal(readFileSync(join(SCRIPTS, 'consistency-check.mjs'), 'utf8'), before)
})

// v18.7.2 P0-2 回归：--write 此前被参数守卫拒绝（exit 1）→ `--fix --write` 落盘 100% 不可达。
// 用 tmp 副本跑（绝不碰真仓库）；副本按「仓库布局」摆放（tmp/package.json + tmp/skills/<name>/）。
test('v18.7.2 P0-2：consistency-check 参数契约——--write 可达、--fix --write 真落盘+备份、--nope 仍拒', () => {
  const d = tmp()
  const repoLayout = join(d, 'repo')
  mkdirSync(join(repoLayout, 'skills'), { recursive: true })
  cpSync(join(SCRIPTS, '..'), join(repoLayout, 'skills', 'lunheng-article-pipeline'), { recursive: true })
  writeFileSync(join(repoLayout, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0' }))
  const cc = join(repoLayout, 'skills', 'lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')
  const victim = join(repoLayout, 'skills', 'lunheng-article-pipeline', 'references', 'fixture-fix-target.md')
  writeFileSync(victim, '# fixture\n\n示例（检查）一处。\n')
  // ① v18.12.0（全量审计 L-66）：**`--write` 单独出现现在必须 exit 10**（旧行为：被白名单放行但
  //    **静默空转** —— 只读模式跑完 exit 0，用户以为已修复）。守卫语义从「拒绝该旗标」升级为
  //    「要求与 `--fix` 成对」，故断言随之更新。
  const rW = run([cc, '--write'])
  assert.ok(!/未知参数/.test(rW.out), '不得报「未知参数」（--write 本身是合法旗标）：' + rW.out)
  assert.equal(rW.code, 10, '`--write` 单独给出应 exit 10（缺 --fix）：' + rW.out)
  assert.match(rW.out, /必须与 --fix 同用/)
  // ② `--fix --write` 真落盘 + **时间戳 `.bak`** 备份存在
  //    v18.12.0（L-66）：旧实现的**固定名 `.bak-fix`** 连跑两次会抹掉上一次的回滚点（destructive-write
  //    头注释明文批判的形态），且是非原子写；现统一走 `writeWithSafety`（时间戳 .bak + temp→rename）。
  const rFW = run([cc, '--fix', '--write'])
  assert.match(rFW.out, /--fix --write 完成/, '应打印完成文案：' + rFW.out)
  const after = readFileSync(victim, 'utf8')
  assert.ok(!after.includes('（检查）'), '落盘后不得残留（检查）：' + after)
  assert.ok(after.includes('（按主控 phase 0 协议）'), '落盘后应为替换文本：' + after)
  const baks = readdirSync(join(repoLayout, 'skills', 'lunheng-article-pipeline', 'references'))
    .filter((f) => f.startsWith('fixture-fix-target.md.') && f.endsWith('.bak'))
  assert.ok(baks.length >= 1, '落盘前必须留时间戳 .bak 回滚点（v18.12.0 起不再用固定名 .bak-fix）')
  assert.match(readFileSync(join(repoLayout, 'skills', 'lunheng-article-pipeline', 'references', baks[0]), 'utf8'), /（检查）/, '备份内容应为修复前原文')
  // ③ --nope 仍被拒（守住 v18.0.5 初衷不回退）
  //    v18.12.0（L-62）：**参数错改 10**（旧版 1 与「文档真漂移」撞码，主控无法区分改命令还是改文档）
  assert.equal(run([cc, '--nope']).code, 10, '未知参数应 exit 10（参数/路径错，与内容漂移的 1 区分）')
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ⑮⑯⑰：新规则必须真的会报（派发卡超长 / 审计视图断链 / 定量断言缺出处）', () => {
  const { d, repo, R } = mkRepo()
  // ⑮：把 T2 卡灌到 13 行（超过 12 行上限）
  const dcPath = join(R, 'references', 'dispatch-cards.md')
  const filler = Array.from({ length: 10 }, (_, i) => `- 灌水第 ${i + 1} 行`).join('\n')
  writeFileSync(dcPath, readFileSync(dcPath, 'utf8').replace('## T3 案例检索员', `${filler}\n\n## T3 案例检索员`))
  // ⑯：抹掉 T4 卡里的「审计视图」字样（文档仍声称默认只读 → 断链）
  const t4Path = join(R, 'references', 'agents', '04-分析-analyst.md')
  writeFileSync(t4Path, readFileSync(t4Path, 'utf8').replaceAll('审计视图', '审计报告'))
  // ⑰：追加一条无算式/无实测出处的百分比断言
  const tplPath = join(R, 'references', 'templates', '案例卡-template.md')
  writeFileSync(tplPath, readFileSync(tplPath, 'utf8') + '\n> 本模板可省 77% token。\n')
  const r = run([join(R, 'scripts', 'consistency-check.mjs')])
  {
    // v18.62.4（§8.1 #12）：本门现按严重度分档（含 [P0 …] → 2；仅 P1 → 1）。
    //   断言**不得假定环境无 P0**——临时仓常缺版本一致性三文件，P0 参与退出码是**正确**行为。
    const __p0 = /\[P0[ \-\]]/.test(r.out)
    assert.equal(r.code, __p0 ? 2 : 1, '注入 3 处漂移后必须 exit 1（v18.62.4 §8.1 #12：含 P0→2，仅 P1→1）')
  }
  assert.match(r.out, /派发卡超长/, '⑮ 必须捕获派发卡超长')
  assert.match(r.out, /审计视图断链/, '⑯ 必须捕获角色卡与文档断链')
  assert.match(r.out, /定量断言缺出处/, '⑰ 必须捕获无出处的百分比断言')
  rmSync(d, { recursive: true, force: true })
})

// v18.31.0 MEA-2 收口：⑰' 由「`STRICT_PCT=1` 才启用」改为**默认开启**（开关已删）。
// 判据（报告原文）：把一条仅含百分比、无样本数的句子写回文档 → 规则必红。
// v18.47.0：⑰' 的**扫描面扩到 repo 级 `docs/**`**（此前只扫技能根）。
//   起因：审计报告点名「`docs/**` 不在 ⑰' 扫描面内」→ `docs/token-optimization-plan.md` 的裸百分比无人管。
//   **先量后扩**：窄触发 + docs/** 只 4 处（全在一份文件、都带 n=）；而**放宽触发**（覆盖「占…的 N%」）
//   在技能根新增 14 处**全是阈值声明**（「占比 >3%」「上界 25%」）→ **放宽被否决**（阈值本就不需要三要素）。
//   本用例钉住扩面后的三条行为：docs/ 里裸百分比必报、补三要素必放行、**历史留痕目录豁免**。
test("consistency-check ⑰'：repo 级 docs/** 在扫描面内（v18.47.0 扩面）+ 历史留痕豁免", () => {
  const { d, repo, R } = mkRepo()
  const cc = join(R, 'scripts', 'consistency-check.mjs')
  const docs = join(repo, 'docs')
  mkdirSync(docs, { recursive: true })
  const sig = () => /定量断言缺三要素/.test(run([cc]).out)

  // ① docs/ 下的裸百分比 → 必须报（扩面前这条**完全不报**）
  writeFileSync(join(docs, 'plan.md'), '# plan\n\n本节降低 60% 成本。\n')
  assert.equal(sig(), true, "docs/** 下的裸百分比必须被 ⑰' 抓到（v18.47.0 扩面）")

  // ② 同一句补上三要素 → 放行（内容级放行，与技能根同口径）
  writeFileSync(join(docs, 'plan.md'), '# plan\n\n本节降低 60% 成本（口径 = 单源重试预算；v18.47.0 实测；n = 3 次重试）。\n')
  assert.equal(sig(), false, '三要素齐备必须放行：' + run([cc]).out.slice(0, 300))

  // ③ **历史留痕目录豁免**（docs/审计与修订记录/）——显式设计，不是「今天恰好没命中」
  const arch = join(docs, '审计与修订记录')
  mkdirSync(arch, { recursive: true })
  writeFileSync(join(arch, 'old-record.md'), '# 旧记录\n\n本节降低 60% 成本。\n')
  assert.equal(sig(), false, '历史留痕（docs/审计与修订记录/**）按既有先例豁免——那里引述当年裸百分比是正当文本')

  // ④ **钉子：阈值 / 规格声明不受本规则管辖**（钉住 v18.47.0 **否决**的那次放宽）
  //    实测：把触发正则放宽到「占比…N%」会在技能根新增 14 处命中，**全是阈值声明**
  //    （「占比 >3%」破折号判据 / 「上界 25%」可读性阈值 / 「>80% 警告」早期框架锁定）——
  //    而 ⑰' 管的是「**听起来像实测的断言**」，阈值本就不需要口径三要素。
  //    故本断言把「不许放宽触发」钉住：谁放宽，这里立刻红，并被迫先解决「断言 vs 阈值」的判别问题。
  rmSync(arch, { recursive: true, force: true })
  writeFileSync(join(docs, 'plan.md'), '# plan\n\n| 破折号滥用 | 占比 >3%（单一判据） |\n| 长句占比 | 上界 25% |\n')
  assert.equal(sig(), false, '阈值/规格声明（占比 >3% / 上界 25%）不得被 ⑰\' 误报——放宽触发已在 v18.47.0 被实测否决')
  rmSync(d, { recursive: true, force: true })
})

test("consistency-check ⑰'：默认开启（口径三要素缺一即报）+ 三要素齐/白名单不误报", () => {
  // 判据只看 ⑰' **这一条信号**（`定量断言缺三要素`），不看整体 exit：
  //   `mkRepo()` 的镜像只带 `skills/` + 包级清单，不带五语 README → 整体 exit 恒为 1
  //   （7 处与本规则无关的漂移）。用 exit 当判据会把「规则没跑」和「别处漂移」混在一起。
  const { d, R } = mkRepo()
  const tplPath = join(R, 'references', 'templates', '案例卡-template.md')
  const base = readFileSync(tplPath, 'utf8')
  const pct = () => {
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    return { hit: /定量断言缺三要素/.test(r.out), out: r.out }
  }
  const inject = (body) => writeFileSync(tplPath, base + '\n## 注入试验\n\n' + body + '\n')

  // ① 裸百分比（无口径/日期/样本）→ 必须报，且逐项列出缺哪几个
  inject('本节降低 60% 成本。')
  let r = pct()
  assert.equal(r.hit, true, "⑰' 默认开启后裸百分比必须报（v18.22.0 时它默认关着，本批收口）")
  assert.match(r.out, /缺：口径\+日期\+样本数/, '缺哪几项必须逐项列出，不能只说「缺三要素」')

  // ② 同一句补上三要素 → 必须放行（证明放行是**内容级**的，不是「见 % 就报」）
  inject('本节降低 60% 成本（口径 = 单源重试预算；v18.31.0 实测；n = 3 次重试）。')
  r = pct()
  assert.equal(r.hit, false, '口径/日期/样本数三者齐备必须放行：' + r.out.slice(0, 400))

  // ③ 白名单：100%（覆盖类）/ 0%（边界类）不得误报
  inject('本节提升 100% 覆盖率，同时降低 0% 成本。')
  r = pct()
  assert.equal(r.hit, false, '100%/0% 属白名单，不得误报：' + r.out.slice(0, 400))
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ⑱：图件路径口径与「宣称的图件门」必须一致（注入旧路径须报错）', () => {
  const { d, repo, R } = mkRepo()
  // ① 旧图件路径口径
  const t8 = join(R, 'references', 'agents', '08-终检-finalizer.md')
  writeFileSync(t8, readFileSync(t8, 'utf8') + '\n> 图件落在 `final/图N-标题.svg`。\n')
  // ② M 门计数漂移（把当前值写回 13 项）——**注入串必须跟着真源走**：M 门总数 v18.25.0 起为 24
  const gl = join(R, 'references', 'glossary.md')
  writeFileSync(gl, readFileSync(gl, 'utf8').replace('M 门 25 项复核', 'M 门 13 项复核'))
  const r = run([join(R, 'scripts', 'consistency-check.mjs')])
  {
    // v18.62.4（§8.1 #12）：本门现按严重度分档（含 [P0 …] → 2；仅 P1 → 1）。
    //   断言**不得假定环境无 P0**——临时仓常缺版本一致性三文件，P0 参与退出码是**正确**行为。
    const __p0 = /\[P0[ \-\]]/.test(r.out)
    assert.equal(r.code, __p0 ? 2 : 1, '注入漂移后必须 exit 1（v18.62.4 §8.1 #12：含 P0→2，仅 P1→1）')
  }
  assert.match(r.out, /图件路径口径漂移/, '⑱ 必须捕获旧图件路径')
  assert.match(r.out, /口径残留 M 门总项数/, '⑥b 必须捕获 M 门计数漂移')
  rmSync(d, { recursive: true, force: true })
})

test('consistency-check ⑳+⑥b：M 门文档节头项数 / 编号跳号 / 文档↔脚本不一致都必须报（注入验证）', () => {
  const GA = ['references', '_shared', 'M-Gate-Algorithm.md']

  // ① 已知漂移形态：节头括注写 10 项，节内已 11 个 ### 子节，且括注带「，含 …」说明
  //    ——这正是 ⑥b 首版正则（要求「项」紧跟右括号）静默漏检、⑳ 必须抓住的形态
  {
    const { d, R } = mkRepo()
    const p = join(R, ...GA)
    writeFileSync(p, readFileSync(p, 'utf8').replace('## M-Form 形式合规门（11 项，含', '## M-Form 形式合规门（10 项，含'))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    {
      // v18.62.4（§8.1 #12）：本门现按严重度分档（含 [P0 …] → 2；仅 P1 → 1）。
      //   断言**不得假定环境无 P0**——临时仓常缺版本一致性三文件，P0 参与退出码是**正确**行为。
      const __p0 = /\[P0[ \-\]]/.test(r.out)
      assert.equal(r.code, __p0 ? 2 : 1, '节头项数过期必须 exit 1（v18.62.4 §8.1 #12：含 P0→2，仅 P1→1）')
    }
    assert.match(r.out, /M 门文档自洽/, '⑳ 必须按节内 ### 子节数抓出节头过期')
    assert.match(r.out, /括注项数/, '⑥b 放宽后的中文括注规则也必须命中带说明的写法')
    rmSync(d, { recursive: true, force: true })
  }
  // ①b dsh.17 三次收紧的写法：「M 门 N 项中 M 项已脚本化」与「**N 项**：M-Form 1-」
  {
    const { d, R } = mkRepo()
    const ag = join(R, 'AGENTS.md')
    writeFileSync(ag, readFileSync(ag, 'utf8').replace('M 门 25 项中 24 项已脚本化', 'M 门 25 项中 14 项已脚本化'))
    const fin = join(R, 'references', 'agents', '08-终检-finalizer.md')
    writeFileSync(fin, readFileSync(fin, 'utf8').replace('（**24 项**：M-Form 1-', '（**15 项**：M-Form 1-'))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    {
      // v18.62.4（§8.1 #12）：本门现按严重度分档（含 [P0 …] → 2；仅 P1 → 1）。
      //   断言**不得假定环境无 P0**——临时仓常缺版本一致性三文件，P0 参与退出码是**正确**行为。
      const __p0 = /\[P0[ \-\]]/.test(r.out)
      assert.equal(r.code, __p0 ? 2 : 1, '旧写法漂移必须 exit 1（v18.62.4 §8.1 #12：含 P0→2，仅 P1→1）')
    }
    assert.match(r.out, /已脚本化项数/, '⑥b 必须捕获「N 项中 M 项已脚本化」写法')
    assert.match(r.out, /「\*\*N 项\*\*：M-Form 1-」写法/, '⑥b 必须捕获「**N 项**：M-Form 1-」写法')
    rmSync(d, { recursive: true, force: true })
  }
  // ② 编号跳号（把 M-Exist-3 改名成 M-Exist-9 → 1,2,9,4,5,6,7 非连续）
  {
    const { d, R } = mkRepo()
    const p = join(R, ...GA)
    writeFileSync(p, readFileSync(p, 'utf8').replace('### M-Exist-3:', '### M-Exist-9:'))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    {
      // v18.62.4（§8.1 #12）：本门现按严重度分档（含 [P0 …] → 2；仅 P1 → 1）。
      //   断言**不得假定环境无 P0**——临时仓常缺版本一致性三文件，P0 参与退出码是**正确**行为。
      const __p0 = /\[P0[ \-\]]/.test(r.out)
      assert.equal(r.code, __p0 ? 2 : 1, '编号跳号必须 exit 1（v18.62.4 §8.1 #12：含 P0→2，仅 P1→1）')
    }
    assert.match(r.out, /M 门编号跳号/, '⑳ 必须抓出子节编号不连续')
    rmSync(d, { recursive: true, force: true })
  }
  // ③ 文档与脚本加项不同步（文档删掉 M-Form-11 节体标题 → 文档 10 ≠ 脚本 11）
  {
    const { d, R } = mkRepo()
    const p = join(R, ...GA)
    writeFileSync(p, readFileSync(p, 'utf8').replace('### M-Form-11: 素材按需加载闭环（v2.5.2-dsh.17 新增）', '### 素材按需加载闭环（v2.5.2-dsh.17 新增）'))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    {
      // v18.62.4（§8.1 #12）：本门现按严重度分档（含 [P0 …] → 2；仅 P1 → 1）。
      //   断言**不得假定环境无 P0**——临时仓常缺版本一致性三文件，P0 参与退出码是**正确**行为。
      const __p0 = /\[P0[ \-\]]/.test(r.out)
      assert.equal(r.code, __p0 ? 2 : 1, '文档↔脚本不同步必须 exit 1（v18.62.4 §8.1 #12：含 P0→2，仅 P1→1）')
    }
    assert.match(r.out, /M 门文档↔脚本不一致/, '⑳ 必须抓出「文档项数 ≠ 脚本 gate 标签数」')
    rmSync(d, { recursive: true, force: true })
  }
  // ④ 节头漏写项数（口径无从派生）— M-Integrity 括注必须按「脚本 1 项 + 人工门 1 项 = 2 项」判，不得误报
  {
    const { d, R } = mkRepo()
    const p = join(R, ...GA)
    writeFileSync(p, readFileSync(p, 'utf8').replace('## M-Integrity 阶段闸门（2 项，含 v2.2.4 修订轮流程约束）', '## M-Integrity 阶段闸门'))
    const r = run([join(R, 'scripts', 'consistency-check.mjs')])
    {
      // v18.62.4（§8.1 #12）：本门现按严重度分档（含 [P0 …] → 2；仅 P1 → 1）。
      //   断言**不得假定环境无 P0**——临时仓常缺版本一致性三文件，P0 参与退出码是**正确**行为。
      const __p0 = /\[P0[ \-\]]/.test(r.out)
      assert.equal(r.code, __p0 ? 2 : 1, '节头缺项数必须 exit 1（v18.62.4 §8.1 #12：含 P0→2，仅 P1→1）')
    }
    assert.match(r.out, /节头缺项数/, '⑳ 必须抓出节头未写「（N 项）」')
    assert.doesNotMatch(r.out, /M-Integrity 括注项数/, 'M-Integrity 括注应期望 2 项（含主控人工门），不得误报')
    rmSync(d, { recursive: true, force: true })
  }
})


test('consistency-check ⑳：真源仓库自身必须自洽（M-Form 11 / M-Exist 11 / M-Integrity 2 == 节内子节数）', () => {
  const SK = join(ROOT, 'skills', 'lunheng-article-pipeline')
  const ga = readFileSync(join(SK, 'references', '_shared', 'M-Gate-Algorithm.md'), 'utf8')
  const secs = {}
  let cur = null
  for (const l of ga.split('\n')) {
    const h = l.match(/^## M-(Form|Exist|Integrity)\b/)
    if (h) { cur = h[1]; secs[cur] = { declared: Number((l.match(/（(\d+)\s*项/) || [])[1]), subs: [] }; continue }
    const s = l.match(/^### M-(?:Form|Exist|Integrity)-\d+:/)
    if (s && cur) secs[cur].subs.push(s[0])
  }
  assert.equal(secs.Form.declared, 11, 'M-Form 节头应写 11 项')
  assert.equal(secs.Form.subs.length, 11, 'M-Form 应有 11 个 ### 子节')
  assert.equal(secs.Exist.declared, 11, 'M-Exist 节头应写 11 项（v18.27.0 QLT-4 新增 M-Exist-11）')
  assert.equal(secs.Exist.subs.length, 11, 'M-Exist 应有 11 个 ### 子节')
  assert.equal(secs.Integrity.declared, 2, 'M-Integrity 节头应写 2 项')
  assert.equal(secs.Integrity.subs.length, 2, 'M-Integrity 应有 2 个 ### 子节')
})

test('v18.3.1 审计 B3：阈值总表自洽——改文档总表数字必须被 consistency-check 抓出（注入验证）', () => {
  const { d, repo, R } = mkRepo()
  const ga = join(R, 'references', '_shared', 'M-Gate-Algorithm.md')
  const cc = join(R, 'scripts', 'consistency-check.mjs')
  // ① 基线：真源仓库总表与 THRESHOLDS 一致 → 不报阈值总表漂移
  const base = run([cc]).out
  assert.doesNotMatch(base, /阈值总表/, '基线不应报阈值总表漂移：' + base.slice(-400))
  // ② 把文档总表里的 mform1MinL 从 3 改成 9 → 必须报 P1
  writeFileSync(ga, readFileSync(ga, 'utf8').replace('| `mform1MinL` | 3 |', '| `mform1MinL` | 9 |'))
  const bad = run([cc]).out
  assert.match(bad, /阈值总表.*mform1MinL/, '改总表数字必须被 ㉓ 抓出：' + bad.slice(-400))
  rmSync(d, { recursive: true, force: true })
})

// ── v18.22.1 CTX-1 规则 ㉘：SKILL.md 正文禁历史叙事句（常驻体回涨防护）─────────────────────────
// 为什么需要：SKILL.md 是**每次技能激活都进上下文**的常驻体（最贵文件），而「版本增量 / 历史成因」
//   类叙事句只对维护者有意义——v18.22.0 报告 §二.4a 实测：拆分后 17 天从 16,865 B 回涨到 36,420 B
//   （+115.9%）。v18.22.1 迁出约 3.1 KB 后加本规则，防它被写回来。
// 三条断言（含两条反向，v18.15.0「门的覆盖靠负向输入证明」」）：
//   ① 基线（夹具 SKILL.md 已是清干净态）不报 ㉘；
//   ② 往**正文**注入一句历史叙事 → 必须报（门真的在工作）；
//   ③ 往 **frontmatter（description）** 注入同一个词 → **不得**报（证明规则只扫正文，不误伤路由文案）。
test('v18.22.1 CTX-1 ㉘：SKILL.md 正文出现历史叙事词必须报（且只扫正文、不扫 frontmatter）', () => {
  const { d, R } = mkRepo()
  const cc = join(R, 'scripts', 'consistency-check.mjs')
  const skPath = join(R, 'SKILL.md')

  // ① 基线
  const base = run([cc]).out
  assert.doesNotMatch(base, /SKILL\.md 历史叙事句/, '夹具基线不应报 ㉘（夹具 SKILL.md 已是清干净态）：' + base.slice(-300))

  // ② 往正文注入 → 必红
  const clean = readFileSync(skPath, 'utf8')
  writeFileSync(skPath, clean + '\n> 旧版此处写的是另一套口径，已删。\n')
  const bad = run([cc]).out
  assert.match(bad, /\[P2 SKILL\.md 历史叙事句\]/, '㉘ 必须捕获正文里的历史叙事句：' + bad.slice(-400))

  // ③ 把同一个词放进 frontmatter（description）→ 不得报（规则只扫正文）
  const withFm = clean.replace(/^(description:\s*")/m, '$1旧版口径，已删。')
  assert.notEqual(withFm, clean, '夹具假设 SKILL.md frontmatter 含 description 行')
  writeFileSync(skPath, withFm)
  const fmOut = run([cc]).out
  assert.doesNotMatch(fmOut, /SKILL\.md 历史叙事句/, '㉘ 不得扫 frontmatter（description 是路由文案，不在本规则范围）：' + fmOut.slice(-300))

  rmSync(d, { recursive: true, force: true })
})
