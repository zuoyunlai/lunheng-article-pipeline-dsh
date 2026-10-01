// ⑮ 派发卡行数 / ⑯ 审计视图三方 / ⑰ 定量断言出处 / ⑱ 图件链路 / ⑲ 交接契约表
// ⑳-㉗ 见本文件后段与 mgate-doc-rules.mjs / docs-version-rules.mjs
// ㉘ SKILL.md 正文禁历史叙事句（v18.22.1 CTX-1 新增）
// v18.3.1（审计 B2 阶段 3）：从 consistency-check.mjs 按规则族抽离，行为逐字等价（回归测试的
//   注入验证用例 + 真源仓库自跑兜底）。共享态（errors / 派生源 / 版本真源等）由主脚本构建 ctx 传入。
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
// v18.22.2 CTX-3：slug 单一真源（与 ref-get.mjs 共用）
import { anchorSlugsOf } from '../anchor-slug.mjs'

// ⑲ 交接契约表真源（v18.6.0 上提为模块级常量并 export）：原内联在 runContentRules 函数体内，
//    handoff-check.mjs 需 import 派生「角色 → 必需产物」；数组是纯静态清单、不依赖 ctx，上提后行为不变。
export const CONTRACTS = [
  // [产物匹配子串（族名）, 产出者卡, 可接受的消费者（任一命中即算通过）]
  ['文献卡.md', '01-文献检索-literature-scout.md', ['04-分析-analyst.md', '05-写作-writer.md', 'build-evidence-bundle.mjs']],
  ['先行者清单.md', '01-文献检索-literature-scout.md', ['deliverables.md', '05-写作-writer.md', 'build-evidence-bundle.mjs']],
  ['数据卡.md', '02-数据检索-data-scout.md', ['04-分析-analyst.md', '05-写作-writer.md', 'build-evidence-bundle.mjs']],
  ['案例卡.md', '03-案例检索-case-scout.md', ['04-分析-analyst.md', '05-写作-writer.md', 'build-evidence-bundle.mjs']],
  ['分析大纲.md', '04-分析-analyst.md', ['05-写作-writer.md', 'dispatch-cards.md', 'build-evidence-bundle.mjs']],
  ['写手版精简段', '04-分析-analyst.md', ['05-写作-writer.md', 'dispatch-cards.md']],
  ['初稿-v', '05-写作-writer.md', ['06-批判-critical-companion.md', '07-审计-auditor.md', '09-审稿-peer-reviewer.md']],
  ['修订说明', '05-写作-writer.md', ['07-审计-auditor.md', 'build-evidence-bundle.mjs']],
  ['批判报告', '06-批判-critical-companion.md', ['07-审计-auditor.md', '09-审稿-peer-reviewer.md', 'build-evidence-bundle.mjs']],
  ['审计报告', '07-审计-auditor.md', ['05-写作-writer.md', '09-审稿-peer-reviewer.md', 'build-evidence-bundle.mjs']],
  ['复核报告', '07-审计-auditor.md', ['build-evidence-bundle.mjs']],
  ['反哺报告', '07-审计-auditor.md', ['00-主控-coordinator.md', 'build-evidence-bundle.mjs']],
  ['审稿报告', '09-审稿-peer-reviewer.md', ['build-evidence-bundle.mjs', '08-终检-finalizer.md']],
  ['G14-检测报告', 'checkers/中文AI痕迹-checker.md', ['09-审稿-peer-reviewer.md', 'audit-checklist-quickref.md', 'build-evidence-bundle.mjs']],
  ['定稿.md', '08-终检-finalizer.md', ['build-evidence-bundle.mjs']],
  ['M-Gate-Report.json', '08-终检-finalizer.md', ['build-evidence-bundle.mjs']],
  // 主人侧三件套（v2.5.2-dsh.17）：产出者是主控，消费者是主人/运行手册
  ['进展-主人版', '00-主控-coordinator.md', ['pipeline-readme.md']],
  ['阶段确认-', '00-主控-扩展职责.md', ['pipeline-readme.md']],
  ['主人投喂清单', '00-主控-扩展职责.md', ['数据卡-template.md', 'pipeline-readme.md']],
  ['style-baseline', '00-主控-扩展职责.md', ['05-写作-writer.md', '06-批判-critical-companion.md']],
  ['模型路由表', '00-主控-coordinator.md', ['pipeline-readme.md']],
  // v2.5.2-dsh.17 续（第二批）：素材按需加载留痕 / 闸门记录表 / 交付说明
  ['素材加载清单', '05-写作-writer.md', ['07-审计-auditor.md', '04-分析-analyst.md', 'build-evidence-bundle.mjs']],
  ['闸门记录-', '00-主控-扩展职责.md', ['pipeline-readme.md', '00-主控-coordinator.md']],
  ['交付说明', '08-终检-finalizer.md', ['build-evidence-bundle.mjs', '00-主控-扩展职责.md']],
];

export function runContentRules(ctx) {
  const { ROOT, REPO_ROOT, files, active, skillText, gateSrc, GATE_DERIVED, gateModMissing, checkGateCounts, SEMVER, normVer, pkgVer, inlineTagTargets, isArchive, UPSTREAM_SPEC_VERSIONS, walk, errors } = ctx;
// ⑮ 派发卡行数上限机械校验（v2.5.2-dsh.15 新增）：文档自称「每卡 ≤12 行」但此前**无任何脚本校验**——
//    token 优化契约若不可机检，膨胀回潮没人挡（与 ⑩ 白名单同思路）。
const dispatchPath = join(ROOT, 'references', 'dispatch-cards.md');
if (existsSync(dispatchPath)) {
  let cardName = null, cardLines = 0;
  const flushCard = () => {
    if (cardName && cardLines > 12) {
      errors.push(`[P2 派发卡超长] dispatch-cards.md「${cardName}」${cardLines} 行 > 12 行上限（派发 prompt 最小化的 token 契约）`);
    }
  };
  for (const l of readFileSync(dispatchPath, 'utf8').split('\n')) {
    if (/^#{2,4}\s/.test(l)) { flushCard(); cardName = l.replace(/^#+\s*/, '').trim(); cardLines = 0; }
    else if (cardName && l.trim() !== '') cardLines++;
  }
  flushCard();
}

// ⑯ 审计视图三方一致（v2.5.2-dsh.15 新增。教训：pipeline-readme 声称「T4/T5/T6/T7/T9 默认只读审计视图」，
//    但 04/05/06 角色卡根本没写、生成侧脚本又只能在定稿后产出 → 该优化对除 T8 外全部落空，属「已投入未兑现」。
//    文档、卡片、脚本三者必须同时到位，缺一即报。）
const VIEW_CONSUMERS = [
  '00-主控-coordinator.md', '00-主控-扩展职责.md', '04-分析-analyst.md', '05-写作-writer.md',
  '06-批判-critical-companion.md', '07-审计-auditor.md', '08-终检-finalizer.md', '09-审稿-peer-reviewer.md',
];
const pipelinePath = join(ROOT, 'references', 'pipeline-readme.md');
if (existsSync(pipelinePath) && readFileSync(pipelinePath, 'utf8').includes('审计视图')) {
  for (const c of VIEW_CONSUMERS) {
    const p = join(ROOT, 'references', 'agents', c);
    if (!existsSync(p)) { errors.push(`[P1 角色卡缺失] references/agents/${c} 不存在`); continue; }
    if (!readFileSync(p, 'utf8').includes('审计视图')) {
      errors.push(`[P1 审计视图断链] pipeline-readme 声称默认只读审计视图，但角色卡 ${c} 未提及——文档与卡片必须同步`);
    }
  }
  const beSrc = readFileSync(join(ROOT, 'scripts', 'build-evidence-bundle.mjs'), 'utf8');
  if (!beSrc.includes("'--source'")) {
    errors.push('[P1 审计视图断链] build-evidence-bundle.mjs 未实现 --source：视图源写死 final/定稿.md 时，T6/T7/T9 在定稿前无视图可读');
  }
  if (!/drafts/.test(beSrc)) {
    errors.push('[P1 审计视图断链] build-evidence-bundle.mjs 未做草稿回退：定稿前无法生成视图');
  }
}

// ⑰ 定量节省断言必须有出处（v2.5.2-dsh.15 新增，**v18.22.0 保留**）：
//    旧规则只匹配「省 X%」——保留**默认开启**（保护既有契约；tests/scripts.test.mjs:583 注入「省 77%」反向自证依赖这条）。
//    同行或邻行给出算式（=）、对照（vs）、实测/对比/基线 才放行；否则请补算式或改定性表述。
for (const f of active) {
  const rel = relative(ROOT, f).replaceAll('\\', '/');
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/省(?:略)?\s*\d+(?:\.\d+)?\s*%/);
    if (!m) return;
    const ctx = [lines[i - 1] || '', l, lines[i + 1] || ''].join('\n');
    if (/[=＝]|vs|实测|对比|基线|算式/.test(ctx)) return;
    errors.push(`[P2 定量断言缺出处] ${rel}:${i + 1} 声称「${m[0]}」但同行/邻行无算式或实测出处——请补算式，或改为定性表述`);
  });
}

// ⑰' 定量断言口径三要素扩面（**v18.22.0 MEA-2 新增；v18.31.0 MEA-2 收口：默认开启**）：
//    v18.22.0 实测对照发现 docs/usage.md / docs/token-optimization-plan.md / docs/troubleshooting.md 等
//    多处含百分比/倍数断言却无口径三要素。旧版 ⑰ 只匹配「省 X%」，本扩面匹配
//    「任何百分比 / 倍数 / 占比 / 增长」类断言，要求 ±5 行窗口**同时含 口径/日期/样本数 三者**。
//
//    **v18.22.0 的边界（v18.31.0 已收口）**：当时本规则**默认不开启**——扩面会立刻捕到 4 处
//    **已发布**文档里的历史断言（`01-文献检索`「省 60%」/ `05-写作`「占比 10.6%」/ `09-审稿`「约 85%」/
//    `M-Gate-Algorithm-appendix`「约 45%」），而按 CONTRIBUTING「已发布版本不可再改」，那批不动。
//    v18.31.0 把这 4 处**逐条改掉**，随即去掉开关、默认开启。
//
//    **v18.31.0 的四处改法（两类，都不是「给门补三要素让它变绿」）**：
//      · **有真值的**（appendix「约 45%」）→ **恢复口径三要素并改成可复算的分数**（10 项 / 22 项）。
//        该处本是 `M-Gate-Algorithm.md` §执行模型那句的**副本**，抄写时把口径与样本丢了、只剩裸百分比。
//      · **无真值的**（T1「省 60%」= 由两个预算数算出的比；T5「10.6%」/ T9「约 85%」= **示例里的假数字**）
//        → **不再写成听起来像实测的百分比**：预算比改成分数（2/5），示例数字改占位符（`<X%>` / `X%`）。
//        给「示例数字」硬凑一个「样本数」= **用正则喂门**，比留着裸百分比更坏。
//
//    判据一句：**百分比 / 倍数断言 + 无三要素 = 假绿**（v18.15.0「门在此却不生效」+ v18.18.x「已修只覆盖当时盯住的那一处」）。
//
//    阈值：百分号 % / 「X 倍」/ 「占比 X%」/ 「增长 X%」/ 「降低 X%」/ 「提升 X%」/ 「降幅 X%」；
//    白名单 = 「100%」覆盖类 + 「0%」边界类（避免误报「100% 覆盖」/「0% 退化」）。
//    放行关键字（满足任一即放行）：
//      口径：行内含「口径|分母|基线|n\s*=|N\s*=|vs\s|对比|实测|算式」
//      日期：±5 行内含「YYYY-MM(-DD)?|v\d+\.\d+(\.\d+)?|\d+\.\d+\.\d+|截至|运行至」
//      样本：±5 行内含「\d+\s*(?:个|条|次|M|会话|项目|笔|例|回|轮|MB|KB)」
//
//    已知误报可能：散句缩写（避免规则本身冗长故截短）。
//
//    **无开关（v18.31.0 定案）**：v18.22.0 那个 `STRICT_PCT` 环境变量 / `--strict-pct` 参数已**删除**——
//    带旁路的门离「被关掉」只差一个 flag；而本规则的内容级放行（口径+日期+样本数三者全中）已经
//    足以避免误报，不再需要一把总闸。**判据：门要么开、要么改文案，不开「临时打开看看」的口子。**
//
// ── v18.47.0 扩面：扫描面加上 **repo 级 `docs/**`（排除历史留痕）** ─────────────────────────────
//   起因：一次审计报告点名「`docs/**` 不在 ⑰' 扫描面内，于是 `docs/token-optimization-plan.md` 的
//   裸百分比无人管」。**先量后扩**（22 个 .md 全扫）：
//     · 窄触发（本规则现行）+ `docs/**` → **仅 4 处**，全在同一份文件、且都带 `n=`（可负担）；
//     · **放宽触发**以覆盖「占…的 N%」写法 → 技能根**新增 14 处，且全是「阈值/规格声明」**
//       （「占比 >3%」「上界 25%」「>80% 警告」）——⑰' 管的是「**实测断言**」，**阈值声明本就不需要三要素**。
//   ⇒ **不做放宽**（会制造 14 个误报），只做扩面。**该次实测一并登记，防后来者重提同一改法。**
//   已知覆盖缺口（如实，不靠放宽规则掩盖）：`占 X 的 N%` 这类**实测断言**的写法本规则抓不到——
//   修它需要先有一个「断言 vs 阈值」的判别器（属独立设计问题），本批不假装解决。
{
  for (const f of [...active, ...(ctx.docsActive || [])]) {
    const rel = relative(ROOT, f).replaceAll('\\', '/');
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      const m = l.match(/(?:省(?:略)?|降低|降幅|提升|增长|占比|约)\s*\d+(?:\.\d+)?\s*(?:%|倍)|^\s*\d+(?:\.\d+)?\s*(?:%|倍)/);
      if (!m) return;
      const num = m[0].match(/\d+(?:\.\d+)?/);
      if (num && (num[0] === '100' || num[0] === '0')) return;
      const win = [];
      for (let j = Math.max(0, i - 5); j <= Math.min(lines.length - 1, i + 5); j++) win.push(lines[j]);
      const ctx = win.join('\n');
      const hasCaliber = /口径|分母|基线|n\s*=|N\s*=|vs\s|对比|实测|算式/.test(ctx);
      const hasDate = /\d{4}-\d{2}(?:-\d{2})?|v\d+\.\d+|v\d+\.\d+\.\d+|\d+\.\d+\.\d+|截至|运行至/.test(ctx);
      const hasSample = /\d+\s*(?:个|条|次|M|会话|项目|笔|例|回|轮|MB|KB)/.test(ctx);
      if (hasCaliber && hasDate && hasSample) return;
      const missing = [];
      if (!hasCaliber) missing.push('口径');
      if (!hasDate) missing.push('日期');
      if (!hasSample) missing.push('样本数');
      errors.push(`[P2 定量断言缺三要素] ${rel}:${i + 1} 声称「${m[0]}」但 ±5 行窗口缺：${missing.join('+')}（按 v18.22.0 MEA-2 扩面：百分比/倍数断言必须同时含 口径/日期/样本数 三者；旧版 ⑰ 默认开）`);
    });
  }
}

// ⑱ 图件链路口径（v2.5.2-dsh.16 新增，第三方 SVG 链路审计）：
//   ① 图件路径只有**一个**口径：`final/图件/图N_标题.svg`（旧版 08 卡写 `final/图件/图N_标题.svg`，两套口径并存）；
//   ② 文档宣称的「图件机械门」必须真实存在——T5 卡宣称「T7 跑 M-Gate 检查 [图N] 数量 ≥ 拍板数 → P0 拦截」，
//      而当时的 M 门 16 项**没有任何图项**（现由 M-Form-9 落地）：宣称与实现必须一起改；
//   ③ 图位规范必须写明「独占一行」（md2html 的块级图注/分页依赖它；行内仅在 dsh.16 起被容错识别）。
{
  const mGateSrc = gateSrc;
  const claimsFigGate = active.some((f) => /\[图N\][^\n]{0,40}P0 拦截|P0 拦截[^\n]{0,40}\[图N\]/.test(readFileSync(f, 'utf8')));
  if (claimsFigGate && !mGateSrc.includes('M-Form-9')) {
    errors.push('[P1 图件门断链] 文档宣称「T7 跑 M-Gate 检查 [图N] → P0 拦截」，但 m-gate-check.mjs 未实现 M-Form-9 图件闭环');
  }
  if (!mGateSrc.includes('_lib/svg.mjs')) {
    errors.push('[P1 图件门断链] m-gate-check.mjs 未接入 _lib/svg.mjs（图件结构/安全校验的唯一真源）');
  }
  for (const f of active) {
    const rel = relative(ROOT, f).replaceAll('\\', '/');
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/final[\\/]图N-|final[\\/]图\d+-[^\s`]*\.svg/.test(l) && !/旧版|历史|漂移|教训|错误/.test(l)) {
        errors.push(`[P1 图件路径口径漂移] ${rel}:${i + 1} 用了旧口径 final/图N-*.svg——唯一口径是 final/图件/图N_标题.svg`);
      }
      if (/只标 ?`?\[图N：标题\]/.test(l) && !/独占一行|独立成行/.test(l + '\n' + (lines[i + 1] || ''))) {
        errors.push(`[P2 图位规范缺「独占一行」] ${rel}:${i + 1} 要求写手标 [图N：标题] 但未声明必须独占一行（与 md2html 块级图注/分页契约相关）`);
      }
    });
  }
}

// ⑲ 交接契约表机检（v2.5.2-dsh.17 新增，落地上轮审计的「产出→消费」矩阵）：
//    每个声明产出的产物必须 ① 被产出者声明 ② 被至少一个下游读清单（角色卡/派发卡）或证据包引用。
//    实测教训：审计视图（dsh.15）、批评论据/复核报告（dsh.17）都属于「文档说有人读/有人产，实际断链」。
//    表即契约真源——新增产物时在此登记，与文档同步演进。
//    键用「版本无关的族名」（`初稿-v` / `修订说明` / `审计报告` …）——下游文档天然按族名引用，
//    用精确文件名当键会把正常引用判成断链（本轮实测：4 个假阳性全部来自这一点）。

{
  const readLazy = (() => {
    const cache = new Map();
    return (relPath) => {
      if (!cache.has(relPath)) {
        // 解析顺序：references/<path> → references/agents/<path> → references/templates/<path> → scripts/<path>
        // （templates 支持见 v2.5.2-dsh.17：契约表要能引用模板文件，如 数据卡-template.md）
        const cands = [
          join(ROOT, 'references', relPath),
          join(ROOT, 'references', 'agents', relPath),
          join(ROOT, 'references', 'templates', relPath),
          join(ROOT, 'scripts', relPath),
        ];
        const hit = cands.find((p) => existsSync(p));
        cache.set(relPath, hit ? readFileSync(hit, 'utf8') : '');
      }
      return cache.get(relPath);
    };
  })();
  for (const [artifact, producer, consumers] of CONTRACTS) {
    const prodText = readLazy(producer);
    if (!prodText.includes(artifact)) {
      errors.push(`[P1 契约表：产出者未声明] ${artifact} 的登记产出者 ${producer} 未提及该产物——契约表与角色卡必须同步`);
    }
    const hit = consumers.find((c) => readLazy(c).includes(artifact) || readLazy('dispatch-cards.md').includes(artifact));
    if (!hit) {
      errors.push(`[P1 交接断链] ${artifact} 无任何下游读清单/证据包引用（期望消费者之一：${consumers.join(' / ')}）——「文档说有人读、实际读不到」属 P1`);
    }
  }
  // 报告类版本号写法守卫：`批判报告-v{N-1}` / `G14-检测报告-v{N-1}` 是已被定案否定的写法（会查不存在的 v0）
  for (const f of active) {
    const rel = relative(ROOT, f).replaceAll('\\', '/');
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/(?:批判报告|G14-检测报告|审计报告|审稿报告)-v\{N-1\}/.test(l) && !/禁止|旧版|修正|定案|教训|历史/.test(l)) {
        errors.push(`[P1 报告版本号写法] ${rel}:${i + 1} 用 v{N-1}——报告版本号一律 = 被审正文轮次（${'`'}v{N}${'`'}），禁止加减`);
      }
    });
  }
  // 版本化报告不得再写死 -v1.md（旧版把批判/审计/复核/反哺/审稿报告硬编码成 -v1，修订轮报告被漏收）
  const beSrc2 = readLazy('build-evidence-bundle.mjs');
  for (const prefix of ['批判报告', '审计报告', '复核报告', '反哺报告', '审稿报告', 'G14-检测报告']) {
    if (beSrc2.includes(`${prefix}-v1.md`)) {
      errors.push(`[P1 版本硬编码] build-evidence-bundle.mjs 把 ${prefix} 写死成 -v1.md——必须走「取最大版本」解析（修订轮 v2/v3 报告否则不进证据包）`);
    }
  }
}

// ㉕ 命令数口径（v18.7.3 P1-3，全量审计「命令数 12/11/13 三处漂移」的机械化；
//    v18.18.0 由 ⑳ 改名——⑳ 已被 mgate-doc-rules.mjs 的「M-Gate-Algorithm.md 自洽」占用，
//    两者原为同号两义。改名后全库规则编号唯一，见 consistency-check.mjs 头部清单）：
//    /lunheng 命令数唯一真源 = skills/lunheng-commands/scripts/route-command.mjs 的 COMMANDS 表
//    （排除 `-h` 这类同 phase 别名键）。凡文档写「N 个 /lunheng 命令 / 斜杠命令」且 N ≠ 真源数 → P1。
//    `-cite` 的 3 种模式（默认/-auto/-manual）与 `-h` 别名不计入命令数（口径已在 command-routing.md 定案）。
{
  const rcPath = join(REPO_ROOT, 'skills', 'lunheng-commands', 'scripts', 'route-command.mjs');
  if (existsSync(rcPath)) {
    const rcSrc = readFileSync(rcPath, 'utf8');
    const keys = [...rcSrc.matchAll(/^\s*'(-[A-Za-z0-9]+)':\s*\{\s*phase:/gm)].map((m) => m[1]);
    const phases = new Set();
    let cmdTrue = 0;
    for (const k of keys) {
      const ph = rcSrc.match(new RegExp(`'${k}'\\s*:\\s*\\{\\s*phase:\\s*'([^']+)'`));
      const phase = ph ? ph[1] : k;
      if (phases.has(phase)) continue;   // 同 phase 的后续键 = 别名（如 -h → help）
      phases.add(phase); cmdTrue++;
    }
    const claimRe = /(\d+)\s*个\s*\/lunheng\s*(?:斜杠)?命令/g;
    const scanFile = (absPath, rel) => {
      if (!existsSync(absPath)) return;
      const lines = readFileSync(absPath, 'utf8').split('\n');
      lines.forEach((l, i) => {
        for (const m of l.matchAll(claimRe)) {
          if (Number(m[1]) !== cmdTrue) {
            errors.push(`[P1 命令数口径漂移] ${rel}:${i + 1} 写「${m[1]} 个 /lunheng 命令」≠ 真源 ${cmdTrue} 个（route-command.mjs COMMANDS 表，-cite 3 模式与 -h 别名不计入）`);
          }
        }
      });
    };
    for (const f of active) scanFile(f, relative(ROOT, f).replaceAll('\\', '/'));
    // lunheng-commands 子技能自身（在主技能目录之外，单独扫）
    const cmdDir = join(REPO_ROOT, 'skills', 'lunheng-commands');
    if (existsSync(cmdDir)) {
      const walkLocal = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walkLocal(p);
          else if (e.name.endsWith('.md') || e.name.endsWith('.mjs')) scanFile(p, relative(REPO_ROOT, p).replaceAll('\\', '/'));
        }
      };
      walkLocal(cmdDir);
    }
    scanFile(join(REPO_ROOT, 'lib', 'index.js'), 'lib/index.js');

    // ㉕ 扩展（本次审计 P1-②）：除「N 个」数字外，再对账**枚举清单**——「数字对、清单漏」（README 代码块
    //   与 package.json description 都缺 -stats）此前逃过本规则（数字「11」对，枚举只 10 项）。只对
    //   「会枚举清单」的文件做**缺项**检查，避免误伤只提单个命令的文档：判「枚举」= 斜杠分隔 ≥5 个
    //   -token，或代码块 ≥5 行 /lunheng -xxx。只查缺项（⊇ 真源），不查多列（-auto/-manual/-h/--confirm 不误伤）。
    const canonical = keys.filter((k) => k !== '-h');   // 11 个正命令（-h 别名不计）
    // v18.62.4（全量审计-v18.62.3 P1-2/P2-5）：**枚举检查的扫描面与方向都补齐**。
    //   旧实现的两个缺口（均有实测依据）：
    //     ① **扫描面**：枚举检查只被调用在 `skills/lunheng-commands/**` 与 `lib/index.js` 上
    //        （见下方两个调用点），而**数字**检查（`scanFile`）遍历的是全量 `active`（主技能 80 个 .md）。
    //        同一规则的两半扫描面不同 → 主技能自己的文档从不受枚举检查。
    //        实测后果：`references/pipeline-readme.md` 写「11 个斜杠命令」而代码块只列 **10** 个（缺 `-stats`），
    //        而该文件正是 T1-T9 派发话术的复制源（SKILL.md 明写「勿凭记忆复制」）。
    //     ② **方向**：`missing` 只做「真源 ⊆ 文档」（代码有、文档漏），**不做反向**。
    //        故 `docs/installation.md` 可以列出 `compression-cycle / evidence-bundle / m-gate / handoff-check`
    //        这类**根本不存在的命令名**而不判红（读者会去调一个不存在的命令）。
    //   现按「**数字查主技能 + 枚举查全部**」补齐：enumCheck 的调用点加上 `active` 与 `docsActive`。
    //   反向判据的**误报边界**（刻意收窄，防把文档里的正当 `-x` 词判红）：
    //     · 只认**三级标题行内、形如 `/lunheng -x`** 的写法——它是「列出命令」的强信号；
    //     · 行内以 `（` `(` `` ` `` 开始的括注（如 `` `-cite`（-auto/-manual）``）不算声明；
    //     · `-auto/-manual/-h/--confirm/--json/--dry-run/--diff/--report/--run-dir` 等已登记旗标/模式不计。
    const DECLARED_NONCMD = new Set(['-auto', '-manual', '-h', '--confirm', '--json', '--dry-run', '--diff', '--report', '--run-dir', '--pending', '--level', '--summary', '--project', '--role']);
    const enumCheck = (absPath, rel) => {
      if (!existsSync(absPath)) return;
      const text = readFileSync(absPath, 'utf8');
      const lines = text.split('\n');
      const slashEnum = /(?:^|[^\w-])-([a-z][a-z0-9-]*)(?:\/-([a-z][a-z0-9-]*)){4,}/.test(text);
      const codeLines = lines.filter((l) => /\/lunheng\s+-([a-z][a-z0-9-]*)/.test(l)).length;
      if (!slashEnum && codeLines < 5) return;
      const found = new Set();
      for (const l of lines) {
        for (const m of l.matchAll(/-([a-z][a-z0-9-]*)/g)) {
          const tok = '-' + m[1];
          if (canonical.includes(tok)) found.add(tok);
        }
      }
      const missing = canonical.filter((c) => !found.has(c));
      if (missing.length) {
        errors.push(`[P1 命令枚举缺项] ${rel} 枚举了命令清单但缺 ${missing.join(' / ')}（真源 = route-command.mjs COMMANDS 表 ${canonical.length} 项，-h 别名与 -cite 3 模式不计入）`);
      }
      // 反向：文档**不得声明真源里没有的命令名**（见上方边界注释）
      for (let i = 0; i < lines.length; i++) {
        const m = /^\s*[-*]\s+`\/lunheng\s+(-[a-z][a-z0-9-]*)/.exec(lines[i]);
        if (!m) continue;
        const tok = m[1];
        if (canonical.includes(tok) || DECLARED_NONCMD.has(tok)) continue;
        errors.push(`[P1 命令幻影声明] ${rel}:${i + 1} 声明了真源里不存在的命令 \`${tok}\`（真源 = route-command.mjs COMMANDS 表：${canonical.join(' / ')}）——读者会去调用一个不存在的命令`);
      }
    };
    // v18.62.4（P1-2）：主技能文档同样要过枚举检查（旧版只过数字检查）
    for (const f of active) enumCheck(f, relative(ROOT, f).replaceAll('\\', '/'));
    // v18.62.4（P1-2/P2-5）：随包 `docs/**`（`ctx.docsActive`，已排除历史留痕）也纳入
    for (const f of (ctx.docsActive || [])) enumCheck(f, relative(REPO_ROOT, f).replaceAll('\\', '/'));
    if (existsSync(cmdDir)) {
      const walkEnum = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walkEnum(p);
          else if (e.name.endsWith('.md') || e.name.endsWith('.mjs') || e.name === 'package.json') enumCheck(p, relative(REPO_ROOT, p).replaceAll('\\', '/'));
        }
      };
      walkEnum(cmdDir);
    }
    enumCheck(join(REPO_ROOT, 'lib', 'index.js'), 'lib/index.js');
  }
}

// ㉖ 子技能版本一致性（本次审计 P1-①）：主包规则① 只对账 18.x 主版本，子技能 lunheng-commands
//   自己的 1.0.x 版本无人管 → v18.7.1 升版时漏了 README.md + package.json 两处，1.0.0/1.0.1 漂移
//   存活到 v18.20.0。三件套（SKILL.md frontmatter / README.md 标题 / package.json version）交叉核对。
{
  const cmdDir = join(REPO_ROOT, 'skills', 'lunheng-commands');
  if (existsSync(cmdDir)) {
    const grab = (p, re) => {
      if (!existsSync(p)) return null;
      const m = re.exec(readFileSync(p, 'utf8'));
      return m ? m[1] : null;
    };
    const sv = grab(join(cmdDir, 'SKILL.md'), /^version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m);
    const rv = grab(join(cmdDir, 'README.md'), /^#\s+lunheng-commands\s+v(\d+\.\d+\.\d+)/m);
    const pv = grab(join(cmdDir, 'package.json'), /"version"\s*:\s*"(\d+\.\d+\.\d+)"/);
    const names = ['SKILL.md', 'README.md', 'package.json'];
    const vals = [sv, rv, pv];
    const present = vals.filter(Boolean);
    if (present.length < 3) {
      const missing = names.filter((n, i) => !vals[i]).join(' / ');
      errors.push(`[P1 子技能版本缺失] skills/lunheng-commands/ 缺版本声明：${missing}（三件套须各自声明 1.0.x）`);
    } else if (new Set(present).size > 1) {
      errors.push(`[P1 子技能版本漂移] lunheng-commands 三件套版本不一致：SKILL.md=${sv} / README.md=${rv} / package.json=${pv}`);
    }
  }
}

// ㉗ 全库锚点覆盖（v18.12.0 新增，全量审计 L-24）：
//   为什么必须加：旧规则㉒ 只核 `SKILL.md` **启动清单里**的 `文件#锚点` —— 于是
//   `pipeline-readme.md` 的目录段**34 条里 27 条悬空**（12 条锚点脱靶 + 15 条指向正文已删标题）
//   长期无人发现；另有 6 条跨文件锚点错（锚点截断 / 错字 `v23T7` / 中文化标题被写成阿拉伯数字）。
//   判据：全库 `*.md` 里每一条形如 `](路径.md#锚点)` 或 `](#锚点)` 的链接，
//     ① 目标文件必须存在；② 锚点必须命中目标文件的「标题 slug 集」或**显式 `<a id="…">`**。
//   slug 口径（与 GitHub 实测校准一致）：小写 → 去 emoji 与标点 → 每个空格转一个 `-`（**不折叠、不裁剪**）。
//   历史归档目录整体豁免（`docs/审计与修订记录|验证记录`、`audits/反哺报告-*`、`archive/`）。
// v18.22.2 CTX-3：slug 实现抽到 `_lib/anchor-slug.mjs`（与本包的 `ref-get.mjs` **共用同一份**）——
//   此前这里是唯一实现，而 ref-get 也需要同一口径；两处各写一份必然漂移（本仓最反感的形态）。
//   slug 三条口径（小写 / 只保留字母数字组合符空格与 `-` `_` / **每个空格转一个 `-`、不折叠不裁剪**）
//   与「不要顺手优化」的理由，见该文件头注释。
{
  const HIST = /^(?:docs\/(?:审计与修订记录|验证记录)\/|audits\/反哺报告-|archive\/)/;
  const mdFiles = [];
  const walkMd = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walkMd(p);
      else if (e.name.endsWith('.md')) mdFiles.push(p);
    }
  };
  walkMd(ROOT);
  const slugCache = new Map();
  const slugsFor = (abs) => {
    if (!slugCache.has(abs)) slugCache.set(abs, existsSync(abs) ? anchorSlugsOf(readFileSync(abs, 'utf8')) : null);
    return slugCache.get(abs);
  };
  for (const f of mdFiles) {
    const rel = relative(ROOT, f).replaceAll('\\', '/');
    if (HIST.test(rel)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/旧版|历史|当时|曾经|教训|漂移|更正|修复|不再|示例|形如/.test(l)) return;   // 清仓注解与「写法示例」可引用旧锚
      for (const m of l.matchAll(/\]\(([^)\s]+\.md)?#([^)\s]+)\)/g)) {
        const anchor = m[2];
        const targetAbs = m[1] ? join(dirname(f), m[1]) : f;
        const targetRel = m[1] ? relative(ROOT, targetAbs).replaceAll('\\', '/') : rel;
        if (HIST.test(targetRel)) continue;
        const slugs = slugsFor(targetAbs);
        if (slugs === null) {
          errors.push(`[P1 锚点悬空] ${rel}:${i + 1} 链接目标文件不存在：${m[1]}`);
        } else if (!slugs.has(anchor)) {
          errors.push(`[P1 锚点悬空] ${rel}:${i + 1} → ${targetRel}#${anchor}（目标文件无此标题 slug；改标题后请同步所有引用）`);
        }
      }
    });
  }
}

// ── ㉘ SKILL.md 正文禁历史叙事句（v18.22.1 CTX-1 新增；主人定案 = v18.22.0 方案 CTX-1 的判据）────────
//   为什么：`SKILL.md` 是**每次技能激活都进上下文**的常驻体（最贵文件），而「版本增量 / 历史成因」
//   类叙事句只对维护者有意义——运行期角色读了白付 token，且会随版本累积**回涨**
//   （v18.22.0 报告 §二.4a 实测：2026-09-09 拆分后 16,865 B → 2026-09-26 的 36,420 B = **+115.9%**）。
//   v18.22.1 已把两段巨型增量摘要 + 6 处历史成因句迁出（实测 −3,090 B）；本规则防它被重新写回来。
//
//   规则：`SKILL.md` **正文**（去 frontmatter）不得出现下列历史叙事**标记词**：
//     此前 / 曾经 / 旧版 / 已删 / 已移除 / 已作废 / 历史见 git log
//   放行白名单（须同时满足）：该行含 `CHANGELOG.md` 指针 **且** 含「为什么 / 成因」——即「外移指针行」本身。
//
//   ⚠️ 词表刻意收窄（实测反证）：
//     · **不含「原值」**——`script_exit_raw` 段写「（脚本原值，禁止修改）」是**技术术语**，
//       纳入后实测在 SKILL.md 立即产生 1 处假阳性（v18.22.1 落规则时验出）；
//     · **不含「增量」**——本仓库把它当**中性常用词**（「版本增量」「预算增量」），纳入同样假阳性；
//     · **不含裸「曾」**——「曾」在正常叙述里合法（如「实战漏检过」改写后仍可能含），且 `曾` 单字
//       太容易命中；故只取「曾经」。
//   **边界如实声明**：本规则只抓**词形**，抓不到「换一种说法讲历史」（如「17 天前还是 16.9 KB」）；
//   它是**回归网**，不是「证明正文已无历史叙事」的完成证明（与 `closeout-verify` 同款边界）。
const HISTORY_TOKEN_RE = /此前|曾经|旧版|已删|已移除|已作废|历史见 git log/;
{
  const skillPath = join(ROOT, 'SKILL.md');
  if (existsSync(skillPath)) {
    const raw = readFileSync(skillPath, 'utf8');
    // 去 frontmatter：`description` 是路由文案（官方目录只渲染 name + description），不在本规则范围
    const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw);
    const offset = fm ? fm[0].split('\n').length - 1 : 0;
    const body = fm ? raw.slice(fm[0].length) : raw;
    body.split('\n').forEach((l, i) => {
      const hit = HISTORY_TOKEN_RE.exec(l);
      if (!hit) return;
      if (l.includes('CHANGELOG.md') && /为什么|成因/.test(l)) return;   // 外移指针行：放行
      errors.push(`[P2 SKILL.md 历史叙事句] SKILL.md:${offset + i + 1} 含「${hit[0]}」——常驻体只留现行口径；成因/逐版明细移 CHANGELOG.md 对应版本段，此处只留「一句话 + 指针」（规则 ㉘）`);
    });
  }
}

// ㉙ G 项主清单口径（v18.34.0 新增）——**真源 = `_lib/mgate-gates/mexist-gates.mjs` 的 `G_MAIN` 常量**。
//   为什么需要（本批实测到四处同时漂移，且三种口径并存）：
//     · `audit-checklist-quickref.md:14` 写「G0-G14 主项，**14 项**硬门」——**而 M-Gate-Algorithm 的「真源声明」
//       恰恰指向 quickref**：真源自己错了，四处引它的人各错各的；
//     · `glossary.md:128` / `:455` 写「**14 项**硬门」/「**14 主项**」；
//     · `pipeline-readme.md` 的 T7 派发话术第 1 条**只列到 G13**（漏 G14）——**主控照抄派发话术**是该路径的常规动作，
//       于是审计报告会漏 G14 → **M-Exist-9 判 P1**，而直到 T8 才可能被发现。
//   为什么此前没有任何门抓到：M 门项数规则 ⑥b **刻意豁免**了前缀含「G0-G14 / G 清单」的行（防把 G 项数误读成
//   M 门项数——该豁免本身正确，其反例清单第 3 条引的就是 quickref 那行），于是这块成了**盲区**，漂移正好落在里面。
//   本规则把盲区补上（**⑥b 的豁免一个字不动**）。
//   两条判据：
//     ① **计数**：任何「G0-G14 … N 项/个」的声明必须 == `G_MAIN.length`（显式引用旧值的行豁免）；
//     ② **清单**：T7 派发话术那条「产出 audits/审计报告-vN.md：G0 …」必须**列全** G_MAIN。
//   刻意不查 G15：它是**模式相关**项（仅在任务简报启用「引用数量与质量控制」时必写），与 M-Exist-9 的 note9
//   同一处置——本门看不到任务简报，一律要求会造假阳性。
{
  const mgPath = join(ROOT, 'scripts', '_lib', 'mgate-gates', 'mexist-gates.mjs');
  if (existsSync(mgPath)) {
    const mgSrc = readFileSync(mgPath, 'utf8');
    const gm = /const\s+G_MAIN\s*=\s*\[([^\]]*)\]/.exec(mgSrc);
    if (!gm) {
      errors.push('[P0 派生源失效] mexist-gates.mjs 里找不到 `G_MAIN` 常量——规则 ㉙ 的派生源失效（它是 M-Exist-9 判「审计报告 G 项覆盖」的清单真源）');
    } else {
      const G_MAIN = [...gm[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      const N = G_MAIN.length;
      if (N < 10) {
        errors.push(`[P0 派生源失效] 从 G_MAIN 只解析出 ${N} 个 G 项（应在 15 个左右）——派生退化会让规则 ㉙ 恒真`);
      } else {
        // 中文数字（文档里两种写法都在用：「15 项」与「十五个主项」）
        const CN = { 十: 10, 十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15, 十六: 16 };
        const toNum = (s) => (CN[s] !== undefined ? CN[s] : Number(s));
        const G_LABEL = G_MAIN.map((id) => new RegExp(`(?<![A-Za-z0-9])${id.replace(/[.-]/g, (c) => `\\${c}`)}(?![0-9.])`));
        const HISTQ = /旧版|旧文|历史|废止|旧口径/;   // 清仓注解必须能引用旧数字（与 ⑥b 同口径）
        for (const f of active) {
          const rel = relative(ROOT, f).replaceAll('\\', '/');
          readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
            if (HISTQ.test(l)) return;
            // ① 计数声明：G0-G14 匹配点前后一个**窄窗口**内的「N 项|N 个|N 主项」
            const era = /G0\s*[-–]\s*G14/.exec(l);
            if (era) {
              const win = l.slice(Math.max(0, era.index - 10), era.index + 45);
              for (const m of win.matchAll(/(\d+|十[一二三四五六]?|二十)\s*(?:主)?\s*(?:项|个)/g)) {
                // ⚠️ 三条防误报（全部由反向自证实测逼出来）：
                //   · **标识符左边界**：「G14 主项」里的 `14 主项` 会被读成计数声明——**这正是 ⑩b 在 v18.22.3
                //     踩过的同一个坑**（当时是 `eff4-probe2.mjs` 的 `2.mjs` 被读成「写 2 个」）。修法同款：
                //     数字**前**紧邻字母/数字/`_`/`-`/`.` 即属名字的一部分，不算计数。
                //   · 比较量词：「缺 >3 项 → P0」（`07-审计-auditor.md:193` 实测）
                const pre = win.slice(Math.max(0, m.index - 3), m.index);
                if (/[A-Za-z0-9._-]$/.test(pre)) continue;
                if (/[><≥≤≈~＝=]|缺\s?$|约\s?$/.test(pre)) continue;
                if (toNum(m[1]) !== N) {
                  errors.push(
                    `[P1 G 项数口径漂移] ${rel}:${i + 1} 写「${m[0].trim()}」，真源应为 ${N}（真源 = mexist-gates.mjs 的 G_MAIN = G0–G14 共 ${N} 个主项；`
                    + 'M-Exist-9 按它判审计报告的 G 项覆盖）',
                  );
                }
              }
            }
            // ② T7 派发话术的 G 清单必须列全。
            //   ⚠️ 定位必须精确到**清单行**：第一版按「含 审计报告-vN.md + G0」定位，实测对三处**散文提及**误报
            //   （`AGENTS.md:22` 的「audits/审计报告-vN.md（G0-G14 全项检查）」、`06 卡:109` 的「输出 G0-G14 检查项结论」、
            //   `M-Gate-Algorithm.md:1049` 的「检查对象：… 对 G0-G14 十五个主项的覆盖」）——那三处**本来就不该列全 G 项**。
            //   判据（清单行的构造特征）：文件名**紧跟冒号**再接 `G0`，且该行至少出现 5 个 G 标签（防「一句话提到 G0」被当清单）。
            //   边界（如实）：若将来派发话术改写成不含冒号的形态，本支会**静默不判**（清单漏项回到无门状态，与改前同）。
            const isListLine = /审计报告-vN\.md\s*[:：]\s*`?G0/.test(l) && G_LABEL.filter((re) => re.test(l)).length >= 5;
            if (isListLine) {
              const missing = G_MAIN.filter((_, k) => !G_LABEL[k].test(l));
              if (missing.length) {
                errors.push(
                  `[P1 G 项清单漏项] ${rel}:${i + 1} T7 派发话术的 G 清单漏 ${missing.join('、')}——`
                  + '主控照抄派发话术 → 审计报告漏该 G 项 → M-Exist-9 判 P1（且要到 T8 才可能被发现）',
                );
              }
            }
          });
        }
      }
    }
  }

  // ㉚ 模板示例 ↔ 机检契约对照（v18.60.1，主人授权反哺 v2 §4.1 / §7.1 #9）
  //   为什么立它（实测依据）：论衡实测项目-夫妻收入差异家庭权力 出现 **7 类格式返工**——数据卡信任级别行 /
  //   批判报告 C 节标题 / AI 声明下划线签名栏 / AI 声明区间写法 / 交付说明字段起点 / 审稿 6 维表 /
  //   期刊表三百分比——**无一例外**都是「**模板说的**」与「**脚本认的**」不一致（正是 `机检硬格式.md`
  //   开篇记录的老问题在新位置复现），且每个项目都靠主控在 T7/T8 **人工返工**（本次 7 类 / 11 处）。
  //   判据：**模板里的示例行必须能通过它对应的机检判定**——把「人读的模板」与「机读的脚本」对齐到仓库门
  //   这一层，让模板改错在**提交时**暴露，而不是等项目跑到终检。
  //   覆盖面（首版取实测最高频 3 处；新增同类契约按同一模式追加）：
  //     ㉚-a 数据卡模板信任级别示例行 → 真源 = 机检硬格式.md §一（全角冒号 + 档位词紧跟）
  //     ㉚-b 批判角色卡 C 节标题示例 → 真源 = M-Exist-8 正则（`### C1`，无 `N.N ` 序号前缀）
  //     ㉚-c AI 使用声明模板签名栏 → 真源 = M-Form-3 下划线占位检测（方括号占位，非连续下划线）
  {
    const trustTpl = join(ROOT, 'references', 'templates', '数据卡-template-lite.md');
    if (existsSync(trustTpl)) {
      const t = readFileSync(trustTpl, 'utf8');
      if (!/^- \*\*信任级别\*\*：/m.test(t)) {
        errors.push('[P1 模板↔机检契约失配] references/templates/数据卡-template-lite.md 缺契约形态的信任级别示例行'
          + '（机检只认 `- **信任级别**：已发布` = 全角冒号 + 档位词紧跟）'
          + '；子代理照模板抄写即触发 M-Form-6 P0（实测 v18.60.1 模板用半角冒号+emoji → T2 逐字照抄 → 30 条全失配）');
      }
      if (/^- \*\*信任级别\*\*:\s/m.test(t)) {
        errors.push('[P1 模板↔机检契约失配] references/templates/数据卡-template-lite.md 的信任级别示例行仍用**半角冒号**'
          + '（`- **信任级别**: `）——机检正则要求全角 `：`；照抄即 M-Form-6 P0');
      }
    }
    const critCard = join(ROOT, 'references', 'agents', '06-批判-critical-companion.md');
    if (existsSync(critCard)) {
      const t = readFileSync(critCard, 'utf8');
      if (!/^#{2,4}\s*C1(?![0-9])/m.test(t)) {
        errors.push('[P1 模板↔机检契约失配] references/agents/06-批判-critical-companion.md 的 C 节标题示例未用 `### C1` 形态'
          + '（M-Exist-8 要求 `#` 后**直接**跟 C 编号；写成 `### 1.1 C1` 会判「批判维度缺 N 节」**假 P0**）');
      }
    }
    const aiDeclTpl = join(ROOT, 'references', 'templates', 'AI-使用声明-template.md');
    if (existsSync(aiDeclTpl)) {
      const t = readFileSync(aiDeclTpl, 'utf8');
      // ⚠️ 只检查**签名栏行**（`作者签名：___`），**不扫全文**——否则模板里作为**反例**引用的
      //   `____________` 会自我误报（v18.60.1 首测即踩：规则上线第一次跑就报了自己的模板）。
      if (/^\s*作者签名[：:]\s*_{3,}/m.test(t)) {
        errors.push('[P1 模板↔机检契约失配] references/templates/AI-使用声明-template.md 的签名栏仍用**连续下划线**'
          + '（`____________`）——M-Form-3 判「下划线占位」；请改方括号 `[作者签名]`'
          + '（机检侧 v18.60.1 已豁免 AI 声明节，模板侧按方括号写 = 双保险）');
      }
    }
  }
}

}
