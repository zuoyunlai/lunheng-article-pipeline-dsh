// ⑥ 发布面（npm pack --dry-run）
// 用单命令串 + shell（Windows 上 npm 是 .cmd）：避免 Node 对「shell:true + args 数组」的 DEP0190 告警
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parsePackManifest } from '../pack-manifest.mjs' // 二次复审 M-2/O-3：npm pack --json 单点解析（数组 ≤npm11 / 对象 npm12+）
import { scanShipped } from '../pack-negative.mjs' // D-1②：与 pack-smoke 共用同形负清单（结构上同形，不靠两份代码同步）

/**
 * ⑥ 与 ⑥b 共用上下文：发布物清单（v18.18.4 从 ⑥ 的 try 里提到外层）。
 * 三态（O-2，二次复审 M-2）：string[] = PASS / **null = UNKNOWN**（pack 没跑成或输出形态不认识）
 */
export function packManifest(ctx) {
  const { ROOT } = ctx
  const pack = spawnSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 32 * 1024 * 1024 })
  let packFiles = null
  let packUnpackedSize = 0
  if (pack.status !== 0) return { packFiles, packUnpackedSize, status: 'fail', msg: `npm pack --dry-run 失败：${(pack.stderr || pack.stdout || '').split('\n').slice(-3).join(' / ')}` }
  try {
    const { files, unpackedSize } = parsePackManifest(pack.stdout)   // M-2：单点解析（数组 ≤npm11 / 对象 npm12+）
    packFiles = files
    packUnpackedSize = unpackedSize
    return { packFiles, packUnpackedSize, status: 'ok', msg: null, files }
  } catch (e) {
    // 三态（O-2）：解析失败 → packFiles 保持 null = UNKNOWN；⑦b 据此**不得**打印合格字样。
    return { packFiles, packUnpackedSize, status: 'parse-fail', msg: `npm pack --json 解析失败（输出形态不认识 → 发布物清单 UNKNOWN）：${e.message}` }
  }
}

export function run(ctx) {
  const { fail, note, ROOT } = ctx
  const result = packManifest(ctx)
  if (result.status === 'fail') {
    fail('pack', result.msg)
    return
  }
  if (result.status === 'parse-fail') {
    fail('pack', result.msg)
    return
  }
  const { files, packFiles, packUnpackedSize } = result
  // 三态（O-2，二次复审 M-2）：写入 ctx 让 ⑦b 读到，**null 语义为 UNKNOWN**
  ctx.packFiles = packFiles
  if (files.length === 0) fail('pack', 'npm pack 报告无文件（--json 解析异常？）')
  const must = [
    'package.json',
    'cordis.patch.yml',
    'LICENSE',
    'README.md',
    // 运行期最小集：入口 + C 组模块 + 技能体 + 随包脚本
    'lib/index.js',
    'lib/tools.js',
    'lib/guard.js',
    'lib/commands.js',
    'skills/lunheng-article-pipeline/SKILL.md',
    'skills/lunheng-article-pipeline/AGENTS.md',
    'skills/lunheng-article-pipeline/scripts/m-gate-check.mjs',
    'skills/lunheng-article-pipeline/scripts/_lib/exit-guard.mjs',
  ]
  for (const m of must) if (!files.includes(m)) fail('pack', `发布包缺关键路径：${m}`)

  // v18.2.0 发布面裁剪（主人指示「最终用户拿到的是功能正常的纯插件，不含无用的冗余文件」）：
  //   **仓库向文件一律不得随包**——它们对装包用户没有用途，只会让发布物变胖、让用户跑不存在的命令。
  //   本清单是**机械防线**：谁把 `CHANGELOG.md` 加回 `files` 白名单，这里立刻报（不是靠自觉）。
  //   边界（如实）：npm **强制包含** 根目录 `README*` 与 `LICENSE`（实测 `files` 删掉、`.npmignore`
  //   排除均无效）——故五语 README 保留在包内，这是 npm 的规则而非本仓疏漏。
  //
  //   v18.18.3（审计 D-1②）：负清单由「仓库根前缀匹配」改为**路径分量匹配**，与 `pack-smoke.mjs`
  //   共用 `_lib/pack-negative.mjs`。旧口径 `f.startsWith('tests/')` 只看根，导致
  //   `skills/lunheng-commands/tests/`（22 用例）与嵌套 `package.json` 随包时**本门照打印零污染**。
  //   多数条目收敛进共用清单后，原先在此逐条硬写的 `scripts/*.mjs` 由 `scripts`（root 作用域）覆盖。
  const negViolations = scanShipped(files)
  for (const v of negViolations) {
    if (v.hits.length) {
      fail('pack', `发布面污染：${v.name}（${v.kind === 'dir' ? '目录' : '文件'}·${v.scope} 作用域）下有 ${v.hits.length} 个随包（如 ${v.hits[0]}）——${v.why}`)
    }
  }
  // 只数**顶层**随包脚本（`scripts/_lib/` 是共享库，不算入口；v2.5.2-dsh.13）
  const scripts = files.filter((f) => /^skills\/lunheng-article-pipeline\/scripts\/[^/]+\.mjs$/.test(f))
  // v2.5.2-dsh.17：脚本数**从 SKILL.md 白名单派生**，不再写死数字（写死会在加脚本时变成噪音红灯；
  // 白名单本身的正确性由 consistency-check 规则 ⑩ 双向核验：磁盘 ↔ SKILL.md）
  const wl = readFileSync(join(ROOT, 'skills', 'lunheng-article-pipeline', 'SKILL.md'), 'utf8')
    .split('\n').find((l) => l.includes('随包脚本白名单')) || ''
  const declared = (wl.split('=')[1] || '').split('+')[0].split('/').map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9-]*$/.test(s))
  if (declared.length === 0) fail('pack', 'SKILL.md 未声明随包脚本白名单（规则 ⑩ 同源）')
  else if (scripts.length !== declared.length) fail('pack', `发布包内随包脚本数 ${scripts.length} ≠ SKILL.md 白名单 ${declared.length}（白名单不一致）`)
  const unpacked = packUnpackedSize
  const negClean = negViolations.filter((v) => v.hits.length === 0).length
  note(
    `⑥ 发布面：${files.length} 个文件 / 随包脚本 ${scripts.length} 个（与 SKILL.md 白名单一致）/ 关键路径齐备` +
      ` / 仓库向零污染（负清单 ${negClean}/${negViolations.length} 条无命中；口径 = 路径分量匹配，非根前缀）` +
      (unpacked ? `｜解包 ${(unpacked / 1024).toFixed(0)} KB` : ''),
  )

  // ⑥b「扫描集 ⊇ 打包集」差集门（二次复审 M-1②，2026-09-26）：
  //   把「④/⑤/⑦ 的扫描集必须覆盖发布物」从**靠人记得**变成**机械不变量**。
  //   为什么需要（M-1 实测复现）：`npm pack` 按 `files` 白名单取**盘上**文件，**不受 `.gitignore` 约束**；
  //   而扫描集 `scanSet = tracked ∪ 未跟踪且未被 ignore`。两者之差 = 「被 ignore 但落在白名单目录内」的文件
  //   （如 `skills/**/*.bak`）——它**会随包发布**却对 ④/⑤/⑦ 全部隐形。实测：含 `sk-…` 形态的
  //   `skills/lunheng-article-pipeline/tmp-creds-probe.bak` 未被 ⑦ 命中、却被 `npm pack` 收录。
  //   判据：`pack 清单` 里的每个**文本文件**都必须在 `scanSet` 内；差集非空即报。
  if (packFiles !== null) {
    const scanSetHas = new Set(ctx.scanSet)
    const uncovered = packFiles.filter((f) => ctx.isText(f) && !scanSetHas.has(f))
    if (uncovered.length) {
      fail('pack-coverage', `${uncovered.length} 个**随包文件**不在 ④/⑤/⑦ 扫描集内（会被发布出去却逃过全部规则）：${uncovered.slice(0, 5).join(' / ')}——多半是被 .gitignore 排除、却落在 files 白名单目录内的文件（如 *.bak）；请在 package.json 的 files 加负向项排除它，或把它纳入扫描集`)
    } else {
      note(`⑥b 扫描集覆盖：随包 ${packFiles.filter(ctx.isText).length} 个文本文件全部在 ④/⑤/⑦ 扫描集内`)
    }
  } else {
    note('⑥b 扫描集覆盖：**UNKNOWN**（⑥ 的 pack 清单未取得——**不得**读作「已覆盖」）')
  }
}
