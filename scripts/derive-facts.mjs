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

  // ── v19.27.13（反哺 2026-10-26 G-1）：README 复述层的派生真源 ──────────────────
  //   病灶：F-1/F-4/F-5 三簇漂移的共同根因 = 既有门只守「真源↔真源」（规则 ㉕/㉖），
  //   不守「真源↔复述层」（五语言 README + installation + SECURITY）。以下全部从代码反射，
  //   新增面（新键 / 新命令 / 新镜像 / 默认值翻转）自动进对账，不再依赖人肉同步：
  //     · Config 键清单与 panel 默认值 ← lib/index.js 的 CONFIG_SPEC
  //     · 命令清单与计数 ← route-command.mjs 的 COMMANDS 表（'-h' 为 help 别名不计）
  //     · env 镜像名 ← lib/** 中 `process.env.LUNHENG_*` 的**实际读取点**
  //       （刻意用 process.env. 前缀：裸 `LUNHENG_*` 会把 `LUNHENG_SCRIPTS_DIR` 这类
  //        局部常量与注释误当镜像——实测 lib 内裸形态有 5 种、env 实读恰 3 个）
  const libDir = join(root, 'lib')
  const libIndex = readFileSync(join(libDir, 'index.js'), 'utf8')
  const specAt = libIndex.indexOf('const CONFIG_SPEC = Object.freeze({')
  if (specAt === -1) throw new Error('lib/index.js 里找不到 CONFIG_SPEC——G-1 的读法已与实现脱节，请同步')
  const specEnd = libIndex.indexOf('\n})', specAt)
  const specBlock = libIndex.slice(specAt, specEnd === -1 ? undefined : specEnd)
  const configKeys = [...specBlock.matchAll(/^  ([a-zA-Z]+): \{ kind: /gm)].map((m) => m[1]).sort()
  if (configKeys.length === 0) throw new Error('CONFIG_SPEC 键解析为空——G-1 的读法已与实现脱节，请同步')
  const panelDefault = /panel:\s*\{\s*kind:\s*'boolean',\s*def:\s*(true|false)/.exec(specBlock)?.[1] === 'true'

  const rcPath = join(root, 'skills', 'lunheng-commands', 'scripts', 'route-command.mjs')
  const rc = readFileSync(rcPath, 'utf8')
  const cmdAt = rc.indexOf('const COMMANDS = {')
  if (cmdAt === -1) throw new Error('route-command.mjs 里找不到 COMMANDS 表——G-1 的读法已与实现脱节，请同步')
  const cmdEnd = rc.indexOf('\n};', cmdAt)
  const cmdBlock = rc.slice(cmdAt, cmdEnd === -1 ? undefined : cmdEnd)
  const commandNames = [...cmdBlock.matchAll(/'(-[a-z-]+)':\s*\{/g)].map((m) => m[1])
  const commands = commandNames.filter((n) => n !== '-h')   // '-h' 是 '-help' 的别名（表内自述），与 quick-facts ㉕ 同口径

  const envMirrors = new Set()
  for (const f of readdirSync(libDir)) {
    if (!/\.(js|mjs)$/.test(f)) continue
    for (const m of readFileSync(join(libDir, f), 'utf8').matchAll(/process\.env\.(LUNHENG_[A-Z_]+)/g)) envMirrors.add(m[1])
  }

  return {
    schema: 1,
    m_gate_mech: counts.mech,
    m_gate_total: counts.total,
    m_gate_families: { form: counts.form, exist: counts.exist, integ: counts.integ, fact: counts.fact },
    always_limit_bytes: alwaysLimit,
    t8_min_artifacts: t8,
    script_count: scriptCount,
    template_count: templateCount,
    // G-1（v19.27.13）新增派生面
    config_keys: configKeys,
    config_key_count: configKeys.length,
    panel_default: panelDefault,
    command_names: commands,
    command_count: commands.length,
    config_env_mirrors: [...envMirrors].sort(),
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

  // ── v19.27.13（反哺 2026-10-26 G-1）：README 复述层对账 ──────────────────────
  //   覆盖 F-1（panel 默认值）/ F-4（命令数）/ F-5（Config 键计数）三簇漂移。
  //   判据全部用**语言无关锚点**（代码标识符 / 阿拉伯数字 / `v18.93.0` 版本串），
  //   不做英文字面量 grep（maintainers.md §6.1 纪律 C：五语同一语义写法各异）。
  //   新字段缺失（旧调用方只传三段文档）时整组跳过——不破坏既有契约。
  const g1Docs = [
    ['README.md', docs.readmeEn], ['README-zh.md', docs.readmeZh], ['README-es.md', docs.readmeEs],
    ['README-pt.md', docs.readmePt], ['README-hi.md', docs.readmeHi],
    ['docs/installation.md', docs.installation], ['SECURITY.md', docs.security],
  ].filter(([, text]) => typeof text === 'string' && text.length > 0)
  if (g1Docs.length) {
    if (facts.panel_default !== true) {
      // 本门当前只钉「默认开」形态；默认值翻转（主人裁定）时必须**显式同步本门**，不得静默漂过。
      for (const [name] of g1Docs) push(name, 'panel 默认值已非 true（代码侧翻转）——本门判据与七份文档需同批显式更新，不得静默漂过')
    }
    for (const [name, text] of g1Docs) {
      const lines = text.split('\n')
      // (a) 命令计数行：含命令枚举（draft / resume）的行，其「数字␣(个␣)`/lunheng」邻接数字必须等于派生计数，
      //     且 v19.27.8 新增的 gate / abort 必须在场（防「数字对了清单还是旧的」）。
      if (facts.command_count !== undefined) {
        lines.forEach((line, i) => {
          if (!/draft \/ resume/.test(line) || !/\/lunheng/.test(line)) return
          for (const m of line.matchAll(/(\d+)[^\d\n]{0,6}\/lunheng/g)) {
            if (Number(m[1]) !== facts.command_count) {
              push(name, `第 ${i + 1} 行命令计数 ${m[1]} ≠ 派生值 ${facts.command_count}（真源 = route-command.mjs COMMANDS 表）`)
            }
          }
          if (!/gate/.test(line) || !/abort/.test(line)) {
            push(name, `第 ${i + 1} 行命令枚举缺 gate / abort（v19.27.8 主人侧入口）——清单与 COMMANDS 表脱节`)
          }
        })
      }
      // (b) panel 默认值声明行：凡「panel 与默认语**邻近**（±60 字符）」的行必须带 v18.93.0
      //     （默认开的翻转版本号，五语锚点）。漂移形态（off by default / 默认 false / desactivado
      //     por defecto …）天然不含此串。邻近度约束排除「同一行里别处恰好有 panel 和默认」的
      //     非声明行（实测：SECURITY.md 的可调参数行在键描述里多次出现「默认」，若不限距离必误报）。
      lines.forEach((line, i) => {
        if (!/panel[\s\S]{0,60}(?:by default|por defecto|por padrão|默认|डिफ़ॉल्ट)|(?:by default|por defecto|por padrão|默认|डिफ़ॉल्ट)[\s\S]{0,60}panel/.test(line)) return
        if (!/v18\.93\.0/.test(line)) {
          push(name, `第 ${i + 1} 行是 panel 默认值声明但不带 v18.93.0（v18.93.0 起默认开启的翻转锚点）——疑似仍在声明「默认关」`)
        }
      })
      // (c) Config 键完整性：各文档的 Config **枚举行**（同时含 allowMechanismEdit 与
      //     scriptTimeoutMs——后者把「顺带提到 allowMechanismEdit 的守卫/边界行」排除在外）
      //     必须逐键含全部 CONFIG_SPEC 键（背键集合 == 派生键集合）。
      if (Array.isArray(facts.config_keys) && facts.config_keys.length) {
        lines.forEach((line, i) => {
          if (!/allowMechanismEdit/.test(line) || !/scriptTimeoutMs/.test(line)) return
          const miss = facts.config_keys.filter((k) => !line.includes(k))
          if (miss.length) push(name, `第 ${i + 1} 行 Config 枚举缺键：${miss.join(' / ')}（真源 = lib/index.js CONFIG_SPEC，共 ${facts.config_keys.length} 键）`)
        })
      }
      // (d) env 镜像：五语 README 的 Config 枚举行必须把全部 `process.env.LUNHENG_*` 实读镜像
      //     名列全（installation/SECURITY 的行结构不同，不适用行级判据——它们的 env 面由
      //     SECURITY ⑮ 族规则覆盖）。
      if (name.startsWith('README') && Array.isArray(facts.config_env_mirrors) && facts.config_env_mirrors.length) {
        lines.forEach((line, i) => {
          if (!/allowMechanismEdit/.test(line) || !/scriptTimeoutMs/.test(line)) return
          const miss = facts.config_env_mirrors.filter((k) => !line.includes(k))
          if (miss.length) push(name, `第 ${i + 1} 行 env 镜像缺列：${miss.join(' / ')}（真源 = lib/** 的 process.env.LUNHENG_* 实读点）`)
        })
      }
    }
  }
  return issues
}

/** 读取受管文档（不存在即报错——不把「读不到」当成「没问题」）。
 *  v19.27.13（G-1）：新增七份 README 层文档（五语 README + installation + SECURITY）。
 *  旧调用方只取前三段的解构用法不受影响（新增字段是追加）。 */
export function readDocs(root = PKG_ROOT) {
  const skillDir = join(root, 'skills', 'lunheng-article-pipeline')
  const read = (p) => readFileSync(join(root, p), 'utf8')
  return {
    skill: readFileSync(join(skillDir, 'SKILL.md'), 'utf8'),
    ops: readFileSync(join(skillDir, 'operations-capability.md'), 'utf8'),
    finalizer: readFileSync(join(skillDir, 'references', 'agents', '08-终检-finalizer.md'), 'utf8'),
    // G-1（v19.27.13）复述层七文档
    readmeEn: read('README.md'),
    readmeZh: read('README-zh.md'),
    readmeEs: read('README-es.md'),
    readmePt: read('README-pt.md'),
    readmeHi: read('README-hi.md'),
    installation: read(join('docs', 'installation.md')),
    security: read('SECURITY.md'),
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
    console.log(`✓ derive-facts --check：受管数字与文档一致（机检 ${facts.m_gate_mech} / 总 ${facts.m_gate_total} / 上限 ${facts.always_limit_bytes} B / T8 ${facts.t8_min_artifacts} 件；G-1：命令 ${facts.command_count} 个 / Config ${facts.config_key_count} 键 / panel 默认 ${facts.panel_default ? '开' : '关'} / env 镜像 ${facts.config_env_mirrors.length} 个，七份复述层文档对账通过）`)
  }
}
