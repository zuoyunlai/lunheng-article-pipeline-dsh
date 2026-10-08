#!/usr/bin/env node
// 盲评载荷打包（blind-review-pack）—— v18.80.4 · QLT-6 跨体例盲评脚手架（预注册见 `audits/预注册-QLT6-跨体例盲评-v1.md`）
//
// ── 它解决什么 ────────────────────────────────────────────────────────────────────────────────
//   `09-审稿-peer-reviewer.md` §🕶 盲评模式的**全部效力**建立在「读的是什么」可核对之上。载体制备
//   此前靠人工：去项目名 / 去版本头 / 去「论衡·流水线」字样，逐稿手改——**改漏一处，盲评即失效**，
//   而失效是静默的（判者不会说自己看见了什么）。本脚本把这一步机械化，并加一道 **fail-closed 自检**。
//
// ── 产物（三项，钥匙与载荷物理分离）──────────────────────────────────────────────────────────
//   ① `<out>/盲评稿-<id>.md`     —— 去标识载荷（稿件 + 可选附段），交给判者的**唯一**读物；
//   ② `<out>/载荷清单-<id>.txt`  —— 本次交给判者的确切清单（供 `--session-log` 越界核对与复现）；
//   ③ `<map>`                    —— 映射表追加一行（编号 ↔ 项目/稿件/sha256/时间）＝**唯一钥匙**。
//      **`--map` 是必填且刻意无默认值**：钥匙若与载荷同目录，"分离"就只剩文档纪律（本仓判据：
//      **政策要靠机制落，不能靠同一页上的另一句话**）。
//
// ── 自检（fail-closed，exit 1；宁可让操作者返工，也不放一份可疑载荷进盲评）──────────────────
//   ① 载荷内不得再出现**项目名**（含 `run/<名>` 形态）；
//   ② 载荷内不得出现**禁忌面**文件名词（真源 = `handoff-check.mjs` 的 `BLIND_FORBIDDEN`，
//      本文件持有**同步副本**，由 `tests/blind-review-pack.test.mjs` 解析真源源码逐项比对——防两处漂）；
//   ③ 载荷须含足量正文（纯汉字 ≥ 200），防「错传了空稿/简报」；
//   ④ 载荷不得含映射信息（编号↔项目关系只写在 `--map`）。
//
// 用法：
//   node scripts/blind-review-pack.mjs --project run/<项目> --id <编号> --out <目录> --map <映射表路径>
//       [--draft <项目内相对路径，默认 final/定稿.md>]
//       [--journal <文本或文本文件路径>]   # 固定期刊定位段（受众 + 目标刊名），内联去标识
//       [--related <文件路径>]             # 去标识邻近工作清单（可选，补维度 1）
//       [--scrub <正则>]...                # 额外要抹掉的项目特有词（可重复）
//       [--force]                          # 允许覆盖已存在的载荷文件（默认拒绝，防手滑重跑）
// 退出码：0 成功｜1 自检不过（载荷不安全）｜10 参数/路径错｜70 内部错
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
// 禁忌面词表：**单一真源**（技能内 `_lib/blind-forbidden.mjs`，`handoff-check.mjs` 消费同一份）。
//   放在技能目录而非仓库级：`handoff-check` 是随包脚本，镜像部署下没有仓库级 `scripts/`。
import { BLIND_FORBIDDEN } from '../skills/lunheng-article-pipeline/scripts/_lib/blind-forbidden.mjs'

/** 去标识替换 token（统一，便于判者读到「此处被抹」而不会误以为原文如此）。 */
const REPL = '〔去标识〕'

const HELP = `用法：node scripts/blind-review-pack.mjs --project <run/项目> --id <编号> --out <目录> --map <映射表> [--draft <相对路径>] [--journal <文本|文件>] [--related <文件>] [--scrub <正则>]... [--force]`

const argv = process.argv.slice(2)
const opt = { scrub: [] }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const val = (name) => { const v = argv[++i]; if (!v || v.startsWith('--')) { console.error(`${name} 缺值`); process.exit(10) } return v }
  if (a === '--project') opt.project = val(a)
  else if (a === '--id') opt.id = val(a)
  else if (a === '--out') opt.out = val(a)
  else if (a === '--map') opt.map = val(a)
  else if (a === '--draft') opt.draft = val(a)
  else if (a === '--journal') opt.journal = val(a)
  else if (a === '--related') opt.related = val(a)
  else if (a === '--scrub') opt.scrub.push(val(a))
  else if (a === '--force') opt.force = true
  else { console.error(`未知参数：${a}\n${HELP}`); process.exit(10) }
}
for (const need of ['project', 'id', 'out', 'map']) {
  if (!opt[need]) { console.error(`缺 --${need}\n${HELP}`); process.exit(10) }
}

try {
  const projectDir = resolve(opt.project)
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) { console.error(`项目目录不存在：${projectDir}`); process.exit(10) }
  const projectName = basename(projectDir)
  const draftRel = opt.draft || join('final', '定稿.md')
  const draftAbs = join(projectDir, draftRel)
  if (!existsSync(draftAbs)) { console.error(`稿件不存在：${draftAbs}（用 --draft 指定项目内相对路径）`); process.exit(10) }

  const outDir = resolve(opt.out)
  mkdirSync(outDir, { recursive: true })
  const payloadPath = join(outDir, `盲评稿-${opt.id}.md`)
  const manifestPath = join(outDir, `载荷清单-${opt.id}.txt`)
  const mapPath = resolve(opt.map)
  if (existsSync(payloadPath) && !opt.force) { console.error(`拒绝覆盖已存在的载荷：${payloadPath}\n（确要重跑请加 --force；编号应一稿一号，重跑意味着上一份载荷已作废）`); process.exit(1) }
  if (resolve(dirname(payloadPath)) === resolve(dirname(mapPath))) {
    console.error('拒绝：`--map`（钥匙）与载荷同目录——钥匙必须与载荷**物理分离**（判者若拿到该目录即等同拿到编号↔项目关系）')
    process.exit(10)
  }

  const raw = readFileSync(draftAbs, 'utf8')
  const scrubLog = []
  const count = (s, re) => (s.match(re) || []).length

  // ① 去「版本头」行（09 卡口径：去版本头）
  let text = raw.split('\n').filter((l) => {
    const hit = /^\s*>\s*版本[:：]/.test(l)
    if (hit) scrubLog.push(`  删版本头行：${l.trim().slice(0, 80)}`)
    return !hit
  }).join('\n')

  // ② 去项目名 / 库内标识（论衡 · 流水线）——逐个记录，便于人工复核「有没有伤到正文语义」
  const scrubPairs = [
    [new RegExp(`run[\\\\/]${projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), '项目路径形态'],
    [new RegExp(projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '项目名'],
    [/论衡/g, '「论衡」字样'],
    [/流水线/g, '「流水线」字样'],
  ]
  for (const extra of opt.scrub) {
    try { scrubPairs.push([new RegExp(extra, 'g'), `--scrub ${extra}`]) } catch { console.error(`--scrub 正则非法：${extra}`); process.exit(10) }
  }
  for (const [re, why] of scrubPairs) {
    const n = count(text, re)
    if (n) { text = text.replace(re, REPL); scrubLog.push(`  抹除 ${n} 处（${why}）`) }
  }

  // ③ 附加段（期刊定位 + 去标识邻近工作），同样过一遍 scrub
  const appendParts = []
  const readMaybe = (v) => (v && existsSync(resolve(v)) ? readFileSync(resolve(v), 'utf8') : v)
  if (opt.journal) {
    let j = String(readMaybe(opt.journal))
    for (const [re] of scrubPairs) j = j.replace(re, REPL)
    appendParts.push('---\n\n## 期刊定位（送审设定，非稿件内容）\n\n' + j.trim() + '\n')
  }
  if (opt.related) {
    let r = String(readMaybe(opt.related))
    for (const [re] of scrubPairs) r = r.replace(re, REPL)
    appendParts.push('---\n\n## 邻近工作清单（已去标识；供维度 1 参照）\n\n' + r.trim() + '\n')
  }
  const payload = text.trimEnd() + '\n' + (appendParts.length ? '\n' + appendParts.join('\n') : '')

  // ── 自检（fail-closed）────────────────────────────────────────────────────────────────────
  const problems = []
  if (new RegExp(projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(payload)) problems.push(`载荷内仍出现项目名「${projectName}」`)
  for (const w of BLIND_FORBIDDEN) if (payload.includes(w)) problems.push(`载荷内出现禁忌面文件名词「${w}」（真源 = handoff-check 的 BLIND_FORBIDDEN）`)
  const han = (payload.match(/[\u4e00-\u9fff]/g) || []).length
  if (han < 200) problems.push(`载荷正文过短（纯汉字 ${han} < 200）——错传了简报/空稿？`)

  if (problems.length) {
    console.error(`✗ 载荷自检未通过（${problems.length} 项，**不放行**）：`)
    for (const p of problems) console.error(`  - ${p}`)
    console.error('→ 退出码 1：请修稿件/加 --scrub，或确认这一稿本就不该进盲评（样本宁可少，不可可疑）。')
    process.exit(1)
  }

  writeFileSync(payloadPath, payload, 'utf8')

  // ④ 载荷清单（供越界核对与复现）：只记「交给了什么」，**不记编号↔项目关系**（那在映射表里）
  const sha = createHash('sha256').update(payload, 'utf8').digest('hex')
  writeFileSync(manifestPath, [
    `盲评编号：${opt.id}`,
    `载荷文件：${basename(payloadPath)}`,
    `载荷 sha256：${sha}`,
    `载荷纯汉字：${han}`,
    `生成时间：${new Date().toISOString()}`,
    '',
    '交给判者的确切内容（09 卡 §🕶「载荷」三项）：',
    `  ① 盲评稿（本目录 ${basename(payloadPath)}，全文）`,
    opt.journal ? '  ② 固定期刊定位段（已并入载荷尾部「## 期刊定位」）' : '  ② （未附期刊定位段）',
    opt.related ? '  ③ 去标识邻近工作清单（已并入载荷尾部）' : '  ③ （未附邻近工作清单）',
    '',
    '判者**不得**接触（禁忌面）：' + BLIND_FORBIDDEN.join(' / '),
    '越界核对：node skills/lunheng-article-pipeline/scripts/handoff-check.mjs --blind-review audits/盲评-' + opt.id + '-vN.md',
  ].join('\n') + '\n', 'utf8')

  // ⑤ 映射表（钥匙）：追加一行，绝不写进载荷目录
  mkdirSync(dirname(mapPath), { recursive: true })
  if (!existsSync(mapPath)) {
    writeFileSync(mapPath, '# QLT-6 跨体例盲评 · 映射表（**唯一钥匙**，不得进入任何载荷）\n\n| 编号 | 项目 | 稿件（项目内相对路径） | 载荷 sha256(12) | 生成时间 |\n|---|---|---|---|---|\n', 'utf8')
  }
  appendFileSync(mapPath, `| ${opt.id} | ${projectName} | ${draftRel.replace(/\\/g, '/')} | ${sha.slice(0, 12)} | ${new Date().toISOString().slice(0, 10)} |\n`, 'utf8')

  console.log(`✓ 载荷已生成：${payloadPath}`)
  console.log(`  载荷清单：${manifestPath}`)
  console.log(`  映射表（钥匙，已与载荷分离）：${mapPath}`)
  console.log(`  载荷纯汉字 ${han}｜sha256 ${sha.slice(0, 12)}…`)
  console.log(scrubLog.length ? `  去标识记录：\n${scrubLog.join('\n')}` : '  去标识记录：（本稿无需替换）')
  console.log('  下一步：人工复核去标识处是否伤及正文语义 → spawn 判者 → `handoff-check --blind-review` 核对')
} catch (e) {
  console.error(`内部错误：${e?.stack || e}`)
  process.exit(70)
}
