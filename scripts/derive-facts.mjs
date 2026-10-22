// 受管数字的**派生真源**（S1 第一步 · 反哺 2026-10-17 §S1）
//
// 要解决的问题（有实测）：本仓一致性规则已有 35 条且自报「0 漂移」，仍查出至少 8 处可核漂移
//   （M 门 24/25、常驻集 54 KB vs 61 KB、T8 清单 5/6/7…）。规律是：**规则覆盖的是「结构性可派生量」，
//   漂的全是「散文里手抄的数字」**。故本条不是加第 36 条规则，而是给数字一个**唯一出口**：
//     `node scripts/derive-facts.mjs`      → 打印权威值（JSON）
//     `node scripts/derive-facts.mjs --check` → 只读断言「散文里没有与派生值冲突的手抄数字」
//
// 受管数字（本批只收这三个，避免一次动太多）：
//   ① M 门机械项 / 总项   ← `_lib/mgate-gates/gate-count.mjs` 的 deriveGateCounts（与一致性规则 ⑥b 同源）
//   ② 常驻集上限字节数     ← `scripts/repo-hygiene-check.mjs` 的 `ALWAYS_LIMIT`
//   ③ T8 交付物最小件数    ← `skills/.../scripts/handoff-check.mjs` 的 `T8_MIN_ARTIFACTS`
//
// 边界（如实）：
//   · ②③ 用**源码正则**读取常量，不 import——`handoff-check.mjs` / `repo-hygiene-check.mjs` 是入口脚本，
//     import 会**执行主逻辑**（会跑门）。正则只认形如 `const X = 123` / `const X = [` 的声明，读不到即报错
//     （不静默退回默认值）。
//   · 本工具**不写盘**；也不改任何文档——它只回答「现在的文档与代码是否一致」。
//   · 它只覆盖上述三个数字；其余数字仍由既有规则负责（本工具不是 ⑥b 的替代）。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGateSource, deriveGateCounts } from '../skills/lunheng-article-pipeline/scripts/_lib/mgate-gates/gate-count.mjs'

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL = join(PKG_ROOT, 'skills', 'lunheng-article-pipeline')

/** 从源码里取一个数字常量（读不到就抛——不静默给默认值）。 */
function readNumberConst(src, name, file) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`).exec(src)
  if (!m) throw new Error(`在 ${file} 里找不到数字常量 ${name}——本工具的读法已与实现脱节，请同步`)
  return Number(m[1])
}

/** 从源码里数一个数组常量的条目数（按行首 `['…'` 形态计）。 */
function readArrayConstLen(src, name, file) {
  const at = src.indexOf(`const ${name} = [`)
  if (at === -1) throw new Error(`在 ${file} 里找不到数组常量 ${name}`)
  const tail = src.slice(at)
  const end = tail.indexOf('\n]')
  const block = end === -1 ? tail : tail.slice(0, end)
  return block.split(/\r?\n/).filter((l) => /^\s*\[\s*'/.test(l)).length
}

/**
 * 采集权威值。
 * @param root - 仓库根（默认本仓库；测试可传临时根）。
 * @returns 受管数字对象。
 */
export function collectFacts(root = PKG_ROOT) {
  const scriptsDir = join(root, 'skills', 'lunheng-article-pipeline', 'scripts')
  const { src: gateSrc } = loadGateSource(scriptsDir)
  const counts = deriveGateCounts(gateSrc)

  const hygiene = readFileSync(join(root, 'scripts', 'repo-hygiene-check.mjs'), 'utf8')
  const alwaysLimit = readNumberConst(hygiene, 'ALWAYS_LIMIT', 'scripts/repo-hygiene-check.mjs')

  const handoff = readFileSync(join(scriptsDir, 'handoff-check.mjs'), 'utf8')
  const t8 = readArrayConstLen(handoff, 'T8_MIN_ARTIFACTS', 'skills/.../scripts/handoff-check.mjs')

  const scriptCount = readdirSync(scriptsDir).filter((f) => f.endsWith('.mjs')).length
  const tplDir = join(SKILL, 'references', 'templates')
  const templateCount = existsSync(tplDir) ? readdirSync(tplDir).filter((f) => f.endsWith('.md')).length : 0

  return {
    schema: 1,
    m_gate_mech: counts.mech,
    m_gate_total: counts.total,
    m_gate_families: { form: counts.form, exist: counts.exist, integ: counts.integ, fact: counts.fact },
    always_limit_bytes: alwaysLimit,
    t8_min_artifacts: t8,
    script_count: scriptCount,
    template_count: templateCount,
  }
}

/**
 * 断言语义：文档里**不得**出现与派生值冲突的手抄数字。
 *
 * 只钉三处已知会漂的位置，且用「精确短语」而非裸数字（裸数字扫描会在无关语境误报）：
 *   ① SKILL 的「机检 N 项」/「总 M 项」；
 *   ② `operations-capability.md` 的常驻集**不得写死上限数值**（只许指针）——旧值 54 KB 即由此漂出；
 *   ③ 08 卡的交付物清单**不得写死件数**（五件/7 件/6 条 三种曾并存）。
 * @param facts - collectFacts 的返回值。
 * @param docs - { skill, ops, finalizer } 三段文本。
 * @returns 问题列表（空 = 通过）。
 */
export function checkDocs(facts, docs) {
  const issues = []
  const push = (where, msg) => issues.push(`${where}: ${msg}`)

  // v19.27.3（反哺 2026-10-22 **P2-6** 修复）：**穷举全部同类声明**，不再只看第一处。
  //   病灶（已用纯函数探针复现）：旧实现用 `.exec` 只取**首个**匹配 —— 一份文档里写
  //   「机检 25 项；总 26 项」是绿的，随后又写「机检 999 项，总 999 项」时 `issues` 仍为 `[]`。
  //   即：本门证明的只是「第一处没漂」，而它想证明的是「全文没有与派生值冲突的手抄数字」。
  //   判据：同一份文档内每个同类声明都要核；任一处不一致即报（并点名第几处，便于定位）。
  let mechSeen = 0
  for (const m of docs.skill.matchAll(/机检\s*(\d+)\s*项/g)) {
    mechSeen += 1
    if (Number(m[1]) !== facts.m_gate_mech) {
      push('SKILL.md', `第 ${mechSeen} 处「机检 ${m[1]} 项」与派生值 ${facts.m_gate_mech} 不一致（真源 = gate-count.mjs；本门穷举全部同类声明）`)
    }
  }
  let totalSeen = 0
  for (const m of docs.skill.matchAll(/总\s*(\d+)\s*项/g)) {
    totalSeen += 1
    if (Number(m[1]) !== facts.m_gate_total) {
      push('SKILL.md', `第 ${totalSeen} 处「总 ${m[1]} 项」与派生值 ${facts.m_gate_total} 不一致（= 机检 + 1 人工项；本门穷举全部同类声明）`)
    }
  }

  // ② 只许指针：常驻集上限不得写死（形如「合计上限 54.0 KB」「上限 **61 KB**」）
  const kb = /(?:合计上限|常驻集[^\n]{0,20}上限)[^\n]{0,12}?\d+(?:\.\d+)?\s*KB/i.exec(docs.ops)
  if (kb) {
    push('operations-capability.md', `常驻集上限被写死（「${kb[0]}」）——只许指针（真源 = repo-hygiene-check.mjs 的 ALWAYS_LIMIT = ${facts.always_limit_bytes} B）`)
  }

  // ③ T8 清单不得写死件数（中文数字也算：历史上正是「五件」「7 件」「6 条」三种并存）
  const NUM = '[0-9]+|[一二三四五六七八九十]+'
  const pieces = new RegExp(`交付物最小清单（[^）\\n]*?(${NUM})\\s*件`).exec(docs.finalizer)
    || new RegExp(`清单（[^）\\n]*?(${NUM})\\s*件`).exec(docs.finalizer)
  if (pieces) {
    push('08-终检-finalizer.md', `交付物清单写死了件数（「${pieces[0]}」）——只许指针（真源 = handoff-check.mjs 的 T8_MIN_ARTIFACTS，当前 ${facts.t8_min_artifacts} 条）`)
  }
  return issues
}

/** 读取三份受管文档（不存在即报错——不把「读不到」当成「没问题」）。 */
export function readDocs(root = PKG_ROOT) {
  const skillDir = join(root, 'skills', 'lunheng-article-pipeline')
  return {
    skill: readFileSync(join(skillDir, 'SKILL.md'), 'utf8'),
    ops: readFileSync(join(skillDir, 'operations-capability.md'), 'utf8'),
    finalizer: readFileSync(join(skillDir, 'references', 'agents', '08-终检-finalizer.md'), 'utf8'),
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const CHECK = process.argv.includes('--check')
  let facts
  try { facts = collectFacts() } catch (e) {
    console.error(`✗ 采集受管数字失败：${e.message}`)
    process.exit(70)
  }
  if (!CHECK) {
    console.log(JSON.stringify(facts, null, 2))
  } else {
    let issues
    try { issues = checkDocs(facts, readDocs()) } catch (e) {
      console.error(`✗ 读取受管文档失败：${e.message}`)
      process.exit(10)
    }
    if (issues.length) {
      console.error(`✗ derive-facts --check：${issues.length} 处手抄数字与派生值冲突`)
      for (const s of issues) console.error(`  - ${s}`)
      process.exit(1)
    }
    console.log(`✓ derive-facts --check：三个受管数字与文档一致（机检 ${facts.m_gate_mech} / 总 ${facts.m_gate_total} / 上限 ${facts.always_limit_bytes} B / T8 ${facts.t8_min_artifacts} 件）`)
  }
}
