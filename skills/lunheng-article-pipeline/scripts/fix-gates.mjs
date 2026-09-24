#!/usr/bin/env node
// 论衡 Phase 4.5 主控收尾助手（v18.11.0 新增，反哺报告 v2 的 F-5 落地）
//
// 用法：
//   node fix-gates.mjs <项目目录>            # 人类可读清单（含可直接粘贴的修复内容）
//   node fix-gates.mjs <项目目录> --json     # 机器可读（供主控批量取用）
//
// 定位：**只读建议工具**——扫描 4 类「可机械修复项」，输出**修复内容本身**（不是复述问题），
//   零写盘（不修改任何文件）。主控据输出手工 `edit`，省去「读 M 门 detail → 反推修法」的往返。
//
// 检查的 4 类（与 M 门项一一对应）：
//   ① 索引段 ID 锚点（M-Form-10 前置）——素材卡索引表写成 `| L01 |`（无方括号）时，
//      生成可直接插入 `## 📇 索引段` 段末的锚点行 `> **[L01][L02]…**`
//   ② 素材加载清单「## 已加载」段（M-Form-11）——缺段时给出该段的骨架
//   ③ 文末节禁词命中（M-Form-4）——列出 `## 文末节:行号:命中词`（「AI 使用声明」节豁免）
//   ④ 交付说明 12 字段（M-Exist-7）——列出缺失的字段标题
//
// 退出码（**非闸门**，语义与随包脚本一致）：
//   0  = 未发现可机械修复项
//   1  = 发现 ≥1 项（建议清单已输出）
//   10 = 参数或路径错误
//   70 = 内部错误
//
// 与 M 门的关系（重要）：本工具**不判定通过/失败**，也不替代 `m-gate-check.mjs`。
//   M 门是闸门（exit 0/1/2/3 决定能否交付）；本工具是**修法生成器**（告诉你怎么改）。
//   先跑 M 门取结论，再用本工具取修法。
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { h2Headings, sectionBody } from './_lib/sections.mjs'
import { indexSection, entryIds, CARD_SPECS } from './_lib/mgate-helpers.mjs'
import { installExitGuard, requireExistingDir, EXIT_USAGE } from './_lib/exit-guard.mjs'
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs'

installExitGuard()

let flags, opts, positionals
try {
  ({ flags, opts, positionals } = parseArgs(process.argv.slice(2), {
    flags: ['--json'],
    minPositionals: 1,
    maxPositionals: 1,
    positionalHint: '<项目目录>',
  }))
} catch (e) {
  if (e && e.code === USAGE_CODE) {
    console.error(e.message)
    console.error('用法: node fix-gates.mjs <项目目录> [--json]')
    process.exit(EXIT_USAGE)
  }
  throw e
}

const projectDir = positionals[0]
requireExistingDir(projectDir, '项目目录')

const wantJson = flags.has('--json')
const suggestions = []          // { id, target, detail, fix }
const push = (id, target, detail, fix) => suggestions.push({ id, target, detail, fix })

// ── 共用助手 ────────────────────────────────────────────────────────────────
const CARD_FILES = [
  ['文献卡', 'literature/文献卡.md'],
  ['数据卡', 'data/数据卡.md'],
  ['案例卡', 'cases/案例卡.md'],
]

/** 取被审正文：优先 final/定稿.md，回退 drafts/ 最高版本 */
const resolveDraft = () => {
  const final = join(projectDir, 'final', '定稿.md')
  if (existsSync(final)) return final
  const draftsDir = join(projectDir, 'drafts')
  if (!existsSync(draftsDir)) return null
  const cands = readdirSync(draftsDir)
    .filter((f) => /^初稿-v\d+\.md$/.test(f))
    .sort((a, b) => (parseInt(b.match(/\d+/)[0], 10) - parseInt(a.match(/\d+/)[0], 10)))
  return cands.length ? join(draftsDir, cands[0]) : null
}

// ── ① 索引段 ID 锚点（M-Form-10 前置） ─────────────────────────────────────
// 背景：M-Form-10 的 idxIds 只认索引段段体内的**方括号**编号（`[L01]`）。
//   若检索员把索引表写成 `| L01 | 作者 | …`（无方括号），idxIds 为空 → 误报「索引段缺 N 条」P0。
//   规定的修法是**改表格格式**（`| [L01] |`，见 `_shared/机检硬格式.md` 条 3）；
//   若一时不便改表，可在索引段段末补一行锚点（本工具生成该行）。
for (const [label, rel] of CARD_FILES) {
  const p = join(projectDir, rel)
  if (!existsSync(p)) continue
  const cardText = readFileSync(p, 'utf8')
  const idx = indexSection(cardText.split('\n'))
  if (!idx) {
    push('M-Form-10', rel, `缺「## 📇 索引段」标题`,
      `在卡片头部（首条 \`### [Xxx]\` 之前）插入：\n\n## 📇 索引段\n\n| 编号 | 主题 | 信任级别 |\n|---|---|---|\n| [X01] | … | … |\n`)
    continue
  }
  // 索引段**止于首个三级标题**：`indexSection` 只切到下一个 `##`，若卡片未用 H2 分组
  //   （索引表后直接跟 `### [L01] …` 条目），段体会把条目正文一并纳入 → idxIds 误含全部编号 → 漏报。
  //   故此处再收一刀：取首个 `###` 之前的行作为索引表本体。
  const h3At = idx.body.findIndex((l) => /^###\s/.test(l))
  const indexBody = h3At === -1 ? idx.body : idx.body.slice(0, h3At)
  const indexBlock = indexBody.join('\n')
  const idxIds = new Set([...indexBlock.matchAll(/\[([LDC])(\d+)\]/g)].map((m) => m[1] + m[2]))
  const bodyIds = [...entryIds(cardText)].map((s) => s.slice(1, -1))
  const missing = bodyIds.filter((x) => !idxIds.has(x))
  if (missing.length === 0) continue
  // 表格里是否有「无方括号」的裸编号行？（判定是否属格式问题）
  const bareRows = indexBody.filter((l) => /^\s*\|\s*[LDC]\d+\s*\|/.test(l)).length
  const anchor = bodyIds.map((x) => `[${x}]`).join('')
  const fixHow = bareRows > 0
    ? `索引表有 ${bareRows} 行是**裸编号**形态（\`| L01 | …\`）——规范要求方括号（\`| [L01] | …\`，见 \`_shared/机检硬格式.md\` 条 3）。\n` +
      `修法 A（推荐）：逐行改表格首列为 \`| [L01] |\`。\n` +
      `修法 B（表不便改时）：在 \`## 📇 索引段\` 段末插入锚点行——\n\n> **索引段编号锚点**：${anchor}\n`
    : `索引段缺 ${missing.length} 个编号（${missing.slice(0, 5).join(',')}${missing.length > 5 ? ' 等' : ''}）。\n` +
      `修法：补齐缺条，或在段末插入锚点行——\n\n> **索引段编号锚点**：${anchor}\n`
  push('M-Form-10', rel, `索引段缺 ${missing.length} 条（下游按索引定位会漏卡）`, fixHow)
}

// ── ② 素材加载清单「## 已加载」段（M-Form-11） ─────────────────────────────
{
  const p = join(projectDir, 'analysis', '素材加载清单.md')
  if (!existsSync(p)) {
    push('M-Form-11', 'analysis/素材加载清单.md', '文件缺失（T5 每轮须覆盖写）',
      `新建该文件，至少含以下骨架（\`## 已加载\` 段标题是机检锚点，**逐字**）：\n\n# 素材加载清单\n\n## 已加载\n\n### 文献卡\n- [L01] …\n\n### 数据卡\n- [D01] …\n\n### 案例卡\n- [C01] …\n`)
  } else {
    const txt = readFileSync(p, 'utf8')
    // 机检锚点：`## 已加载`（旧版写成 `## 一、已加载素材总览` 等变体会失配）
    if (!/^##\s*已加载\s*$/m.test(txt)) {
      const heads = h2Headings(txt).map((h) => `\`${h.title}\``).join(' / ')
      push('M-Form-11', 'analysis/素材加载清单.md', '缺「## 已加载」段标题（机检无从定位加载集）',
        `现有二级标题：${heads || '（无）'}\n修法：把承载加载集的标题**逐字**改为 \`## 已加载\`（去掉「一、」「素材总览」等修饰）。`)
    }
  }
}

// ── ③ 文末节禁词命中（M-Form-4） ───────────────────────────────────────────
// 与 `_lib/mgate-gates/mform-gates.mjs` 的 ENDNOTE_FORBIDDEN 同源（仅取读者面内部术语一组）。
// 「AI 使用声明」节整体豁免（该节职责即披露 AI 参与）。
{
  const draft = resolveDraft()
  if (draft) {
    const text = readFileSync(draft, 'utf8')
    const lines = text.split('\n')
    const heads = h2Headings(text)
    const ENDNOTE = ['参考文献', '数据来源', '案例来源', '先行者文献', 'AI 使用声明']
    const startIdx = heads.findIndex((h) => ENDNOTE.some((w) => h.title === w || h.title.startsWith(w)))
    if (startIdx >= 0) {
      const startLine = text.slice(0, heads[startIdx].index).split('\n').length - 1
      const BANNED = /承重|素材卡|案例卡|数据卡|文献卡|索引段|素材加载清单|一处两用|段级条目|卡级|修卡|交接报告|六要素|角色卡|任务简报|反哺报告|修订说明/g
      const hits = []
      for (let i = startLine; i < lines.length; i++) {
        const h = heads.find((x) => text.slice(0, x.index).split('\n').length - 1 === i)
        if (h && h.title.startsWith('AI 使用声明')) break   // 进入豁免节即停
        const m = lines[i].match(BANNED)
        if (m) hits.push({ line: i + 1, words: [...new Set(m)].join('/'), text: lines[i].trim().slice(0, 60) })
      }
      if (hits.length) {
        push('M-Form-4', basename(draft), `文末节命中内部术语 ${hits.length} 处`,
          hits.slice(0, 12).map((x) => `L${x.line} 〔${x.words}〕 ${x.text}…`).join('\n') +
          `\n修法：文末节只写**书目信息**（作者/题名/来源/年/URL），不写分析性散文。`)
      }
    }
  }
}

// ── ④ 交付说明 12 字段（M-Exist-7） ────────────────────────────────────────
{
  const p = join(projectDir, 'final', '交付说明.md')
  if (existsSync(p)) {
    const txt = readFileSync(p, 'utf8')
    const REQ = ['路径', '图件清单', '遗留风险', '人工核验项', '数据溯源', '成本指标',
      '建议 merge 的反哺清单', 'AI 使用披露', '证据包指纹', '投稿就绪检查表', '主人决策记录', '终检结论']
    const titles = h2Headings(txt).map((h) => h.title)
    const missing = REQ.filter((r) => !titles.some((t) => t.includes(r)))
    if (missing.length) {
      push('M-Exist-7', 'final/交付说明.md', `缺 ${missing.length} 个固定字段`,
        `缺：${missing.join(' / ')}\n修法：按 \`references/templates/交付说明-template.md\` 补节；\n` +
        `⚠️ 追加段（如字数统计）只能放在 §12 之后，不得插在 12 节序列中间。`)
    }
  }
}

// ── 输出 ───────────────────────────────────────────────────────────────────
if (wantJson) {
  console.log(JSON.stringify({ project: projectDir, count: suggestions.length, suggestions }, null, 2))
} else {
  console.log(`\n论衡 Phase 4.5 收尾建议 — ${projectDir}`)
  console.log(`（只读建议，未修改任何文件；闸门结论请以 m-gate-check.mjs 为准）\n`)
  if (suggestions.length === 0) {
    console.log('✅ 未发现可机械修复项。\n')
  } else {
    suggestions.forEach((s, i) => {
      console.log(`── [${i + 1}/${suggestions.length}] ${s.id} · ${s.target}`)
      console.log(`   问题：${s.detail}`)
      console.log(`   修法：${s.fix.replace(/\n/g, '\n         ')}`)
      console.log('')
    })
    console.log(`合计 ${suggestions.length} 项待修。修完重跑：node scripts/m-gate-check.mjs <final/定稿.md> <final/证据包/>\n`)
  }
}
process.exit(suggestions.length === 0 ? 0 : 1)
