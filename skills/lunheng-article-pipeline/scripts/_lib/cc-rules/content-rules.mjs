// ⑮ 派发卡行数 / ⑯ 审计视图三方 / ⑰ 定量断言出处 / ⑱ 图件链路 / ⑲ 交接契约表
// v18.3.1（审计 B2 阶段 3）：从 consistency-check.mjs 按规则族抽离，行为逐字等价（回归测试的
//   注入验证用例 + 真源仓库自跑兜底）。共享态（errors / 派生源 / 版本真源等）由主脚本构建 ctx 传入。
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

// ⑮ 派发卡行数上限机械校验（v2.5.2-dsh.15 新增）：文档自称「每卡 ≤12 行」但此前**无任何脚本校验**——
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

// ⑰ 定量节省断言必须有出处（v2.5.2-dsh.15 新增）：防「省 60%+」这类**无算式、无实测**的数字在文档间自我繁殖——
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

}
