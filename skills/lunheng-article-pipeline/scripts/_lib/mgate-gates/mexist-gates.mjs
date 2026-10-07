// M-Exist 门族（v18.3.1 审计 B2 阶段 1：从 m-gate-check.mjs 抽离为门模块，行为逐字等价——
// v18.62.4（全量审计-v18.62.3 P1-3）：门内的**解析/读取失败**一律记 `severity: 'ERROR'`（不再记 P1）。
//   为什么：P1 会被 `final-check.mjs` 读成「存在 P1 残留，可触发 T5 修订一轮」→ **脚本缺陷会把未被修改的
//   稿件送进付费修订轮**；且本仓契约明写「内部错 = 70，绝非 1」（见 _lib/exit-guard.mjs）。
//   归并见 m-gate-check.mjs 的 `errors` 统计：errors>0 → exit 70（内部/环境缺陷，未对内容下结论）。
//   run/ 49 组真实项目 baseline（exit + stdout/report sha256）对账）。主脚本构建 ctx 后按原
//   result 顺序调用：mExist1 → M-Form-10/11（仍在主脚本）→ mExist4..mExist10 → mExist2 → mExist3。
//   每个门函数只读 ctx 共享态并往 ctx.results 推结果；模块不持有跨门可变态。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { basename, join, dirname, relative } from 'node:path'
import { createHash } from 'node:crypto'   // v18.12.0（L-15）：M-Exist-2 复算证据包清单的 sha256
import { refsOf, dataCardIds, expandRefRanges } from '../refs.mjs'
import { latestReport, reportByNumber, tableCells, isSeparatorRow, walkMd, sectionRange } from '../mgate-helpers.mjs'

// ── v18.78.2（全量审计-v18.78.1 A5）：**N/A ≠ 通过** ────────────────────────────────────────
//   病灶（审计实测 + 本次复核）：M-Exist-4/5/6/7/8/9 的「N/A 未检」分支记 `pass: true, severity: '通过'`，
//   而同族 M-Exist-10（:1309）/ M-Exist-11（:1645/:1657）早已改 `pass: 'SKIP'`（→ exit 3）。
//   后果：`rm audits/审计报告-*.md` / `rm audits/审稿报告-*.md` / `rm final/交付说明.md` /
//   `rm analysis/批判报告-*.md` 即可把 6 道**实检**门退回「通过」，退出码无任何信号
//   （无 SKIP、无 P0/P1）——正是本仓 ⑩/⑳ 明文禁止的「规则失效即静默放行」。
//   处置 ①（本处）：6 处统一改 `pass: 'SKIP', severity: 'SKIP'` —— exit 3 = **需人工复核，不得当通过**
//   （exit 契约见 m-gate-check.mjs 头部：0 通过 / 1 P1 / 2 P0 / 3 仅 P2·soft·SKIP）。
//   处置 ②（本处）：补一条**只升不降**的升档，防「删文件成为通行手段」——当下游阶段产物已证明
//   Phase 4 发生过（`final/定稿.md` 在场 ⇒ Phase 5 已开始 ⇒ T7.5 闸门「审计报告 + M 门全 exit 0」
//   必已通过 ⇒ **审计报告必然存在过**）而报告却不在，那就不是「阶段未到」而是**被删/改名/移出** → 判 **P1**。
//   **为什么这三项刻意不升档**（如实声明边界，防假红）：
//     · M-Exist-6 —— T9 按 `references/_shared/文类档案.md` 本就可选（`academic-cn/-hum/-case` 必选、其余默认不选），
//       「无审稿报告」在合法配置下是常态；
//     · M-Exist-8 —— 轻量档（2000-3000 字）**一律跳过** Phase 3.6；
//     · M-Exist-7 —— T8 先写 `final/定稿.md` 再写 `final/交付说明.md`，定稿在场而交付说明缺席是**正常中间态**。
function phase4Proven(draftPath) {
  try { return existsSync(join(dirname(dirname(draftPath)), 'final', '定稿.md')); } catch { return false; }
}
/** 「审计报告缺席」的如实结论：阶段未到 → SKIP（未检、可见）；阶段已到 → P1（报告被移出）。 */
function auditAbsentResult(draftPath, gate, what) {
  if (phase4Proven(draftPath)) {
    return { gate, pass: false, severity: 'P1', detail: `阶段已到却**缺 ${what}**：final/定稿.md 在场（Phase 5 已开始 ⇒ T7.5 闸门必已通过 ⇒ 该报告必然存在过）→ 缺它只能是被删/改名/移出，**不得读成 N/A**` };
  }
  return { gate, pass: 'SKIP', severity: 'SKIP', detail: `N/A 且**未检**：尚未进入 Phase 4（无 ${what}）——**不得读成通过**（exit 3 需人工复核）` };
}

// === M-Exist-1 文末四节双向对比（v2.5.2-dsh.5 脚本化 + 严重度评级）===
export function mExist1(ctx) {
  const { firstIdx, bodyProse, endnote, refRe, norm, THRESHOLDS, results, draftPath } = ctx;
if (firstIdx === -1) {
  results.push({ gate: 'M-Exist-1 引用双向对比', pass: 'SKIP', detail: '文末缺失，M-Form-2 失败优先', severity: 'SKIP' });
} else {
  const intext = new Set((bodyProse.match(refRe) || []).map(norm));
  // ── v18.49.0（反哺 F-AG）：文末节**支持区间写法** `[D01]–[D12]` ──
  //   旧实现只按单编号正则匹配 → 区间**只命中首尾两项**，中间的 D02–D11 全被判「漏引」。
  //   实测题1 的「漏引 13」中 **10 条**纯属此因（诊断脚本 `run/_AB-QLT5/diag-mexist1.mjs` 复算过）。
  //   展开逻辑与 M-Form-11 **同源**（已上提至 `refs.mjs:expandRefRanges`，两处不再各写一份）。
  const { extra: endRangeIds2, bad: badRanges2 } = expandRefRanges(endnote);
  const endRefs2 = new Set([...(endnote.match(refRe) || []), ...endRangeIds2].map(norm));
  const rangeNote2 = badRanges2.length
    ? `⚠️ 文末节含无法展开的范围写法：${badRanges2.slice(0, 3).join(' ')}（起止倒序 / 跨字母 / 跨度>30 → 请改为逐条列项）`
    : '';
  const leaked = [...intext].filter((r) => !endRefs2.has(r));
  const orphan2 = [...endRefs2].filter((r) => !intext.has(r));
  // v18.2.2（主人授权修订；依据 2026-09-12 全量测试反哺）：**诊断增强**——
  //   最高频的漏引根因不是「缺条目」，而是**「参考文献」节误用 GB/T 7714 的数字标签 `[1]..[n]`**：
  //   `refRe` 要求**字母前缀**（`[Lxx]`/`[Dxx]`/`[Cxx]`/`[先NN]`），故 `[1]` 一条都扫不到
  //   → 文末的字母编号集为空 → **正文全部 [Lxx] 被判「漏引」**。这正是本仓库 v18.2.1
  //   `规范-机械门对照表.md` 记过的断链（「首版无 [Lxx] → 漏引 17」）。
  //   旧 detail 只报「漏引 N」，主控与写手极易误判为「缺条目」而去补条目（治标不治本、白绕一圈）。
  //   现检测该形态并在 detail 前置可操作提示。**只改提示文字，判定逻辑与严重度完全不变。**
  const mExist1Hint = (() => {
    if (leaked.length === 0) return '';
    if (!leaked.some((r) => /^\[L/.test(r))) return '';   // 只在涉及 [Lxx] 时给该提示
    const sec = /^##\s*参考文献\s*$/m.exec(endnote);
    if (!sec) return '';
    const rest = endnote.slice(sec.index + sec[0].length);
    const nxt = /^##\s+/m.exec(rest);
    const refSec = nxt ? rest.slice(0, nxt.index) : rest;
    const numericLabels = (refSec.match(/^\s*\[\d+\]/gm) || []).length;
    const letterLabels = (refSec.match(/^\s*\[(?:L|D|C|先)\d+\]/gm) || []).length;
    if (numericLabels >= 3 && letterLabels === 0) {
      return `诊断：「参考文献」节有 ${numericLabels} 条数字标签 [N]，但正文用 [Lxx]——`
        + `本门要求文末条目**沿用论衡编号 [Lxx]**（GB/T 7714 只约束**著录格式**，不约束编号形态）。`
        + `修法：把 [N] 逐条改为 [Lxx]（按现有顺序一一对应，**禁止重排顺序**），不要另加重复行。`;
    }
    return '';
  })();
  // v18.2.5 新增（主控实战反哺 P1）：**扩展编号白名单 + 非标准编号黑名单**。
  //   背景：refRe 只认白名单前缀（L/D/C-主/C/先）。写手若用 `[脚注-1]` / `[表-1]` / `[附录-1]` 等
  //   任意非标准编号在正文做「有编号的引用」，本门双向对账**完全扫不到** → 既不报漏引也不报孤儿
  //   → 该编号游离于闭环校验之外。
  //   实测（本项目 ai-cad-cam-impact）：T7 判「ABI Research 引用无编号」→ T5 写手**无权新增数据卡**
  //   （[Dxx] 必须来自 T2 数据卡）→ 主控改用 `[脚注-1]` 内嵌「数据来源」节 → M-Exist-1 报
  //   「漏引 0 / 孤儿 0」**假通过**，实际该编号从未参与对账。
  //   风险（激励方向相反）：写 `[D99]`（不存在）会被判孤儿，写 `[脚注-1]` 反而"更安全"。
  //   处置三条：
  //     ① 扩展编号 `[脚注-N]`：**允许**，但必须**双向闭环**（正文 ↔ 文末条目）；
  //        闭环成立 → 记 P2 留痕（不判失败）；未闭环 → P1。
  //     ② 其他非标准编号 → **P2 提示**（v18.2.6 审计修复 B-3 由 P1 降档；旧版 ≥3 条更升 P0）。
  //        理由：本项判据是**形态黑名单**（正则扫出来的），假阳性代价与「漏引/孤儿」这类硬缺失不同量级——
  //        用假阳性把整类选题判成 exit 2，比漏报一个非编号形态严重得多。降档后保持 hint 提示、留痕可查。
  //     ③ 基线编号 `[D-基-{R/T/C/E}-{NN}]` 是 glossary §三 正式格式 → **豁免**（负向断言剔除）。
  //
  // === v18.2.6 审计修复（第三方审计 B-3，P0：本正则曾制造**假 P0**并硬性阻断一类选题）===
  // 旧式 `NONSTD_RE = /\[(?!D-基-)([A-Za-z\u4e00-\u9fff][^\][\s]{0,11}?)-(\d+)\]/g` 的判据松到
  //   「方括号里有连字符和数字」即算非标准编号，**实测全部误判**：
  //     [COVID-19]（前缀 5 字母）、[SARS-CoV-2]、[GPT-4]（数字 1 位）、[AI-2]、[B2B-2]
  //   而本包支持「行业分析 / AI 产业评论」类选题，正文出现 `[GPT-4]`/`[COVID-19]` 是**必然**：
  //   → M-Form-1 转 P0 → 整体 exit 2 → 按 AGENTS.md「M 门 exit 0 才返回」只能走 Acknowledged Limitations，
  //   等于**对一整类选题硬性阻断**。修法（「必须像编号」而非「像连字符加数字」）：
  //     ① 前缀 = **1-4 个大写 ASCII 字母**（`XX-12` 仍被抓；`COVID-19` 这种 5 字母的真术语不再命中），
  //        或 **1-3 个汉字**（`[表-12]`/`[附录-12]` 这类中文畸形编号仍在网内）；
  //     ② 后缀 = **纯数字且位数 ≥2**（`[GPT-4]`/`[AI-2]`/`[B2B-2]` 这类「模型名-版本号」因此出网）；
  //     ③ 前缀不得含数字（`B2B-2` 出网）；`[D-基-…]` 负向断言与 `[脚注-N]` 过滤器原样保留。
  //   仍被抓的形态：`[XX-12]`、`[AB-99]`、`[表-12]`、`[附录-01]`（假阳性代价已由下面的 P2 兜住）。
  //   **已知代价（如实记录）**：`[GPT-4]` 这类真引用**游离于 M-Exist-1 闭环之外**（既不报漏引也不报孤儿）——
  //   这是有意的取舍：宁可漏报非编号形态，也不再用假 P0 阻断整类选题；真正的引用闭环靠 `[Lxx]/[Dxx]/[Cxx]`
  //   与扩展编号 `[脚注-N]` 覆盖。若需把某形态纳入闭环，应由主控显式申报扩展编号，而不是靠黑名单正则扫。
  const EXT_REF_RE = /\[脚注-\d+\]/g;
  const NONSTD_RE = /\[(?!D-基-)([A-Z]{1,4}|[\u4e00-\u9fff]{1,3})-(\d{2,})\]/g;
  const extInText = new Set(bodyProse.match(EXT_REF_RE) || []);
  const extInEnd = new Set(endnote.match(EXT_REF_RE) || []);
  const extLeaked = [...extInText].filter((r) => !extInEnd.has(r));   // 正文有、文末无
  const extOrphan = [...extInEnd].filter((r) => !extInText.has(r));   // 文末有、正文无
  const extClosed = extLeaked.length === 0 && extOrphan.length === 0;
  const nonStd = [...new Set(
    [...(bodyProse.match(NONSTD_RE) || []), ...(endnote.match(NONSTD_RE) || [])]
      .filter((t) => !/^\[脚注-\d+\]$/.test(t)),
  )];
  const extUsed = extInText.size + extInEnd.size;
  const extNote = extUsed === 0 ? '' : (extClosed
    ? `扩展编号 ${[...extInText].join('、')} 已双向闭环（[脚注-N] 为允许形态，记 P2 留痕）`
    : `扩展编号未闭环：正文缺 ${extLeaked.join('、') || '无'} ｜ 文末缺 ${extOrphan.join('、') || '无'}（须在「数据来源」节内 ### 脚注 子节补条目，或删正文引用）`);
  const nonStdNote = nonStd.length === 0 ? '' : `非标准编号 ${nonStd.length} 个：${nonStd.slice(0, 5).join('、')}${nonStd.length > 5 ? ' 等' : ''}`
    + `——本门只对白名单编号（[Lxx]/[Dxx]/[Cxx]/[C-主xx]/[先NN]）做双向对账，该编号**游离于闭环之外**；`
    + `修法：改用标准编号、或改用扩展编号 [脚注-N]（须双向闭环）、或由主控申报豁免。`
    + `（P2 提示：形态黑名单有假阳性可能——行业/AI 类稿件里的「术语-数字」形态请人工确认后再改）`;
  // v18.80.1（全量审查修订批 · B9）：**扩展编号未双向闭环 = 引用不可信**，须与漏引/硬孤儿同档（P1）。
  //   旧实现把 `extLeaked`/`extOrphan` 排除在 `pass` 与 `severity` 之外 → 该缺陷只在 detail 里可见、
  //   **退出码信号为 0**（与同仓「未检 ≠ 通过」纪律相反）。
  //   另：旧式 `pass: !mExist1Hard || (leaked+hardOrphans)===0` 在 `nonStd`/`orphan2` 的取值域上
  //   **等价于** `(leaked+hardOrphans)===0`，本批改写为显式三项求和（语义更直白，并纳入 extUnclosed）。
  const extUnclosed = extLeaked.length + extOrphan.length;
  // v18.8.x 实战反哺补丁（2026.09.22 数字社交-关系重构项目）：**[先NN] 孤儿一律软处理**——
  //   实战规律：先行者清单是「差异对照工件」而非「引用闭环目标」，其条目与文献卡 [Lxx] 大量
  //   **同篇双列**（实测：[先01]=[L07] 邱泽奇、[先02]=[L08] 边燕杰、[先03]=[L06] 项飙——正文
  //   均以 [Lxx] 实质引用，[先NN] 形态上仍是「文末有正文无」的孤儿）。旧逻辑把这些同篇双列
  //   一律报 P1 → 每个项目都要 T7 人工记账「形态规范冲突」。
  // 判据：孤儿按前缀分流——`[先NN]` 孤儿 → 恒 P2（提示同篇双列回查路径）；
  //   `[L]/[D]/[C]` 孤儿 → 仍是硬缺失（P0/P1）。决策记录命中时在 hint 里补充出处供 T8 复核。
  const xianOrphans = orphan2.filter((r) => /^\[先\d+\]$/.test(r));
  const hardOrphans = orphan2.filter((r) => !/^\[先\d+\]$/.test(r));
  const projectDirEx1 = dirname(dirname(draftPath));
  let preservedOrphans = new Set();
  let preservedHint = '';
  try {
    const dirs = [];
    try { dirs.push(...readdirSync(projectDirEx1).filter((f) => statSync(join(projectDirEx1, f)).isDirectory())); } catch {}
    const decisionFiles = [];
    for (const d of [projectDirEx1, ...dirs.map((dd) => join(projectDirEx1, dd))]) {
      try {
        decisionFiles.push(...readdirSync(d).filter((f) => /^决策记录-Phase\d-/.test(f)).map((f) => join(d, f)));
      } catch {}
    }
    const preservedIds = new Set();
    const hitFiles = [];
    for (const fp of decisionFiles) {
      try {
        const dr = readFileSync(fp, 'utf8');
        const before = preservedIds.size;
        for (const m of dr.matchAll(/\[先(\d+)\]/g)) preservedIds.add(`[先${m[1]}]`);
        if (preservedIds.size > before) hitFiles.push(basename(fp));
      } catch {}
    }
    if (preservedIds.size > 0) {
      preservedOrphans = new Set([...xianOrphans].filter((r) => preservedIds.has(r)));
      if (preservedOrphans.size > 0) {
        preservedHint = `决策记录 ${hitFiles.join('、')} 已显式处理 ${[...preservedOrphans].join('、')}（T8 复核请回查该决策记录）`;
      }
    }
  } catch {}
  const xianNote = xianOrphans.length > 0
    ? `${xianOrphans.length} 个 [先NN] 孤儿（${xianOrphans.join(',')}）——先行者清单为差异对照工件，多为与 [Lxx] 同篇双列（如 [先01]=[L07]），不构成硬缺失${preservedHint ? '' : '；T8 复核请确认差异点声明仍在'}`
    : '';
  results.push({
    gate: 'M-Exist-1 引用双向对比',
    pass: (leaked.length + hardOrphans.length + extUnclosed) === 0,
    detail: [
      mExist1Hint,
      `漏引 ${leaked.length} / 硬孤儿 ${hardOrphans.length}（[先NN] 对照孤儿 ${xianOrphans.length} 个已软处理）`,
      preservedHint,
      rangeNote2,
      xianNote,
      nonStdNote,
      extNote,
    ].filter(Boolean).join(' ｜ '),
    // 严重度（v18.2.6 审计修复 B-3 + v18.8.x 反哺补丁）：
    //   **只有「漏引/[L][D][C] 孤儿」这类硬缺失才升 P0/P1**；
    //   [先NN] 对照孤儿（同篇双列/决策记录处理）→ 恒 P2 软提示；
    //   非标准编号（形态黑名单）单列 → P2 提示；
    //   仅剩软项时 pass=true（对照孤儿不再拉 exit）——留痕走 detail，不再无条件阻断交付。
    severity: (leaked.length + hardOrphans.length) > 0
      ? (((leaked.length + hardOrphans.length) > THRESHOLDS.exist1ClosureP0) ? 'P0' : 'P1')
      : (extUnclosed > 0 ? 'P1'
        : ((nonStd.length > 0 || extUsed > 0 || xianOrphans.length > 0) ? 'P2' : '通过')),
  });
}

}

// === M-Exist-4 审计条目闭环（v2.5.2-dsh.17 新增）===
export function mExist4(ctx) {
  const { draftPath, evDir, auditsDirOf, results } = ctx;
// 依据：07 卡早已规定「打回修订必须附结构化修订任务书（编号/严重度/位置/动作/验收标准/关闭状态）」，
//   但**没有任何脚本校验**；且 dsh.17 引入复核报告后出现「关闭状态」**双真源**（审计报告表列 ↔ 复核报告）。
// 本项把该契约变成机检：结构完整 + 编号唯一 + 编号在审计↔复核之间双向闭环 + 初轮不得预填「已关闭」。
try {
  const projectDir2 = dirname(dirname(draftPath));
  const auditsDir = auditsDirOf({ withEv: true });
  const audit = latestReport(auditsDir, '审计报告');
  // ── v18.52.0（反哺 F-BA）：配对键 = **编号 N**，不是「最新」 ──────────────────────────────
  // 实测缺陷：旧口径 `latest × latest` 硬配对。B 轨轮次之后「最新复核报告」的**验证对象**可以不是审计
  //   任务书——题2 臂 B 的 `复核报告-v2.md` 验证的是 `analysis/批判报告-v2.md` §3.4 的关闭条件，于是门按
  //   字面判「复核报告 v2 未覆盖 10 个审计编号」：**判定字面成立、语义错位**（那 10 项的关闭真源是 v1）。
  // 本版取法：**同号候选 + 最新候选都查，任一覆盖即通过**（同号优先用于展示配对依据）。为什么是「任一」
  //   而不是「同号存在就用同号」：后者会把「同号那份写得不全、最新那份补上了」判成 P1 = 制造一类**新的
  //   假阳性**；而本门要防的是「**没有任何一份复核报告覆盖这些编号**」，两条候选都不覆盖时照样报。
  const reviewLatest = latestReport(auditsDir, '复核报告');
  const reviewSame = audit ? reportByNumber(auditsDir, '复核报告', audit.n) : null;
  const reviewCands = [reviewSame, reviewLatest]
    .filter(Boolean)
    .filter((r, i, a) => a.findIndex((x) => x.path === r.path) === i);
  const review = reviewCands[0] || null;   // 兼容既有引用：仅用于「有没有复核报告」这类存在性判断
  const reviewPairDesc = !audit ? ''
    : reviewSame && reviewLatest && reviewSame.path !== reviewLatest.path
      ? `配对候选：同号 ${reviewSame.name} / 最新 ${reviewLatest.name}`
      : (review ? `配对候选：${review.name}（${reviewSame ? `同号 v${audit.n}` : '无同号 → 退回最新'}）` : '无复核报告');
  const revNotes = existsSync(join(projectDir2, 'drafts'))
    ? readdirSync(join(projectDir2, 'drafts')).filter((f) => /^修订说明-.*\.md$/.test(f)) : [];

  if (!audit) {
    results.push(auditAbsentResult(draftPath, 'M-Exist-4 审计条目闭环', '审计报告'));
  } else {
    const text = readFileSync(audit.path, 'utf8');
    const lines = text.split('\n');
    // v18.8.x 反哺补丁（2026.09.22）：isReject 旧版扫**全文**找「打回」——复核轮（第 2 轮）报告
    //   在叙述第 1 轮历史时必然提到「打回」（如「A 轨第 1 轮打回 → v3 修订 → 第 2 轮通过」），
    //   被误判为「本报告结论=打回」→ 强索修订任务书 → 假 P1（实战：T7 第 2 轮通过报告仍被报
    //   「结论为打回但缺修订任务书」）。修法：只在**结论行**（含「结论/判定/verdict」的行，
    //   含其紧邻的加粗行）里判；无结论行时回退前 30 行。复核轮结论含「通过」即压过叙述性「打回」。
    //   ⚠️ v18.79.0（反哺-v18.78.2 §二 F-h **假阴性修复**）：上面这套「结论行」判据有个**未设防的反向通道**，
    //   实测把一份**确为打回的审计报告**读成「结论非打回（无需任务书）」（test-v18-78-2-县中塌陷：
    //   `## 五、结论` 首行明写「打回修订 ❌」，而 M-Exist-4 detail 报「结论非打回」）：
    //     · **通道 ①「全文扫」**：scope4 取的是**全文所有**含「结论/判定/verdict」的行 —— G 项逐条表里
    //       每行都可能有「结论」二字，其中 `MC-Exist-12 … **结论：通过（人工核）**` 这种**子项**结论
    //       被当成了报告总判定 → `hasPass = true` → `isReject` 被短路。
    //     · **通道 ②「裸 `通过）`」**：`通过\s*[✅）)]` 无语境，被 §五 内的**叙述性**文字命中
    //       （「本轮未核（**不得读作通过）**」）→ 同一个短路。
    //   **为什么必须修**：`isReject` 一旦为 false，`## 修订任务书` 的六列契约**从此不再被校验** ——
    //   一份「打回但无任务书」的报告会静默通过本门，直到 T8 才由人眼发现（假阴性把缺陷放行到下游）。
    //   修法（两条同批，缺一不可；可由 `审计报告-template.md` §五 的 `<通过 ✅ / 打回修订 ❌>` 形态保证可达）：
    //     ① 有「结论节」（`## 五、结论` / `## 结论` / `## 总判定` …）时，**判定面收到该节内**；
    //     ② `hasPass` 只认**结论位**的「通过」（`结论/判定/verdict` + 冒号 + 可选加粗/✅ + 通过）
    //        或固定的「复核通过」，**不再接受**「任意位置的 `通过 + 右括号`」。
    const conclHeadRe = /^#{2,4}\s*(?:[一二三四五六七八九十\d]+\s*[、.．]\s*)?(?:总体)?(?:结论|总判定|裁定|verdict)/i;
    const conclHeadIdx = lines.findIndex((l) => conclHeadRe.test(l));
    const scope4 = (() => {
      if (conclHeadIdx !== -1) {
        const out = [];
        for (let i = conclHeadIdx + 1; i < lines.length; i++) {
          if (/^#{2,4}\s/.test(lines[i])) break;
          out.push(lines[i]);
        }
        if (out.some((l) => l.trim())) return out;   // 结论节存在且非空 → 总判定只在这里
      }
      const cIdx = lines.map((l, i) => (/结论|判定|verdict/i.test(l) ? i : -1)).filter((i) => i >= 0);
      return cIdx.length ? cIdx.map((i) => lines[i]) : lines.slice(0, 30);
    })();
    const hasPass = scope4.some((l) => /复核通过|(?:结论|判定|verdict)\s*\**\s*[：:=]\s*\**\s*(?:✅\s*)?\**\s*通过/.test(l));
    const isReject = !hasPass && scope4.some((l) => /打回|必须修改清单|未通过/.test(l));
    const hIdx = lines.findIndex((l) => /^#{2,4}\s*修订任务书/.test(l));
    const rows = [];
    let header = null;
    if (hIdx !== -1) {
      for (let i = hIdx + 1; i < lines.length; i++) {
        const l = lines[i];
        if (/^#{2,4}\s/.test(l)) break;
        if (!/^\s*\|/.test(l)) continue;
        // 单元格切列：`protect: true` 保护**转义竖线 `\|`** 与**行内代码块内的竖线**（验收标准可能写正则 `a|b|c`）
        const cells = tableCells(l, { protect: true });
        if (isSeparatorRow(cells)) continue;   // 分隔行
        // v18.79.0（反哺-v18.78.2 §二 F-h **连带修复**）：**列数变了 = 任务书表结束**。
        //   `## 修订任务书` 段内往往不止一张表（07 卡要求「表尾给合计并对账」，报告还会附
        //   「压缩清单（序 / 位置 / 现文 / 压缩后 / 估 Δ）」等第二张表）。旧实现一旦设了 `header`，
        //   就把**该段内后续所有 `|` 行**都当任务书行 —— 第二张表的表头行与数据行被当成条目。
        //   这条判据此前从未跑到过（`isReject` 恒 false）。修好 F-h 后实测立刻暴露：
        //   「序」「C-A」「C-B」被当成审计编号 → 硬报「怎么改/验收标准列空缺」+「复核报告未覆盖 5 个编号」→ **合规报告被判 P0**。
        //   判据：Markdown 表列数固定；列数与表头不等 → 该表已结束（**break 而非重置**：重置会让 `header` 变 null，
        //   反而触发「缺修订任务书段或表头」的假 P1；任务书就是本节第一张带「编号」列的表）。
        if (!header && cells.some((c) => c.includes('编号'))) { header = cells; continue; }
        if (!header) continue;
        if (cells.length !== header.length) break;
        rows.push(cells);
      }
    }
    const colOf = (kw) => (header || []).findIndex((h) => kw.test(h));
    const iId = colOf(/编号/), iSev = colOf(/严重度/), iLoc = colOf(/改哪里|位置/), iAct = colOf(/怎么改|动作/), iAcc = colOf(/验收/), iStat = colOf(/关闭状态|状态/);
    const findings = [];
    const soft = [];
    let pairNote = '';   // v18.52.0（F-BA）：配对依据与覆盖结论（进 detail，供读者判断「凭什么配对」）
    if (isReject) {
      if (hIdx === -1 || !header) findings.push('结论为「打回修订」但缺「## 修订任务书」段或表格表头');
      else if ([iId, iSev, iLoc, iAct, iAcc, iStat].some((x) => x === -1)) {
        findings.push(`修订任务书缺必需列（现表头：${header.join(' / ')}）——需含 编号/严重度/改哪里/怎么改/验收标准/关闭状态`);
      } else {
        const ids = [];
        // v18.79.0（反哺-v18.78.2 §二 F-h **连带修复**）：**汇总行不是条目**。
        //   07 卡 §修订任务书 要求「表尾给合计并对账」，故任务书末行常写
        //   `| **合计** | — | 净增 +12 ≤ 17 ✔ | — |` —— 它的「改哪里 / 怎么改 / 验收标准」列本就是破折号。
        //   这条判据此前**不存在，也从未暴露**：因为 `isReject` 永远为 false（F-h 假阴性），下面的六列校验
        //   **从来没跑到过**。修好 F-h 后它立刻暴露——实测 test-v18-78-2-县中塌陷 的 11 行任务书里，
        //   「合计」行被当作条目 → 连报 3 条硬问题 → **整份合规报告被判 P0**（门一修好就误杀合规产物）。
        //   判据：编号列归一后是「合计/总计/小计/汇总/破折号/省略号/点号」→ 跳过（既不入 `ids`，也不做六列与关闭状态检查）。
        const AGG_ROW_RE = /^(?:合计|总计|小计|汇总|—+|-+|–+|\u2026+|\.+)$/;
        for (const r of rows) {
          if (!r[iId] || AGG_ROW_RE.test(String(r[iId]).replace(/[`*\s]/g, ''))) continue;
          const id = r[iId].replace(/[`*]/g, '').trim();
          ids.push(id);
          if (!/^P[012][-\u2011]?[0-9A-Da-d]+/.test(id)) soft.push(`编号「${id}」不符合 P0-n / P1-n 约定`);
          for (const [idx, label] of [[iLoc, '改哪里'], [iAct, '怎么改'], [iAcc, '验收标准']]) {
            if ((r[idx] || '').replace(/[\s.。…-]/g, '').length < 4) findings.push(`${id} 的「${label}」列空缺或过于笼统`);
          }
          const st = (r[iStat] || '').trim();
          if (!/已关闭|未关闭|待复核/.test(st)) soft.push(`${id} 的关闭状态「${st}」非固定词（应为 已关闭/未关闭/待复核）`);
          if (!review && /已关闭/.test(st)) findings.push(`${id} 在**尚无复核报告**时即标「已关闭」——关闭状态真源是复核报告，初轮只能填「待复核」`);
        }
        const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
        if (dup.length) findings.push(`编号重复：${[...new Set(dup)].join(',')}——同报告内编号必须唯一（跨轮新增须续号，不得复用）`);
        if (ids.length === 0) soft.push('修订任务书表格无有效条目行');
        if (reviewCands.length) {
          // v18.52.0（F-BA）：逐候选查覆盖，**任一覆盖即通过**；都不覆盖时按「第一个候选的缺项」报（供人核对）
          const want = [...new Set(ids)].map((x) => x.replace(/\u2011/g, '-'));
          let coveredBy = null;
          let missBest = null;
          for (const c of reviewCands) {
            const rid = new Set([...readFileSync(c.path, 'utf8').matchAll(/P[012][-\u2011]?[0-9A-Da-d]+/g)].map((m) => m[0].replace(/\u2011/g, '-')));
            const miss = want.filter((x) => !rid.has(x));
            if (!miss.length) { coveredBy = c; break; }
            if (!missBest) missBest = { c, miss };
          }
          if (coveredBy) {
            // detail 里必须写出**凭什么配对**（旧版只写「审计 ↔ 复核」，读者看不出依据）
            pairNote = `闭环成立：${coveredBy.name} 覆盖 ${want.length} 个编号`
              + `（${coveredBy.path === reviewSame?.path ? `同号配对 v${audit.n}` : '配对候选：最新复核报告'}）`;
          } else {
            findings.push(`复核报告 ${reviewCands.map((c) => c.name).join(' / ')} 未覆盖 ${missBest.miss.length} 个审计编号：${missBest.miss.slice(0, 5).join(',')}`);
          }
        } else if (revNotes.length) {
          // ── v18.62.7（反哺-主控实测-2026-10-02 §A6）：**区分「复核尚未到期」与「复核已逾期」** ──────
          //   病灶（实测 aigc-yixiangxing-meixue，与 `handoff-check` 的 A1 口径相反）：T5 **每一轮**都产
          //   `drafts/修订说明-vN.md`（v1 起就有），而本门旧判据只是 `revNotes.length > 0` → **首轮审计
          //   必然命中**：那一轮的打回**发生在任何修订之前**，`audits/复核报告-vN.md` 在那一刻物理上不可能
          //   存在 → T7 只能补交一份内容全为「✗未关闭（未复核）」的形式产物，再被同号覆盖、归档。
          //   **一次无意义的写入 + 一次归档，且全程无人需要那份初版内容。**（A6 的判据：口径相反的两门，
          //   至少不能对同一份项目给出一致性无法解释的相反结论。）
          //   正解判据 = 「是否真的发生过**本轮审计之后**的修订」：`修订说明-vN` 的 N > 被审正文的 N。
          //     · **逾期**（已发生修订而无复核）→ **硬**（「复核必须落盘」的原锋芒逐字保留）；
          //     · **未逾期**（停在首轮审计，只有 T5 的历史修订说明）→ **软提示**（写明若修订已完成须补交）。
          //   `handoff-check` 的 A1 把复核报告列为「修订轮产物 → 首轮可缺」软提示——两门在「未逾期」档
          //   由此**同号同向**（都软）；在「逾期」档本门更严（硬），A1 仍软，属**有意的分工**：
          //   本门是**项目终局**的审计条目闭环（T8 前必须成立），A1 是**单次派发**的产物存在性检查。
          //   ⚠️ 边界（如实）：审计报告没写 `被审正文：` 声明 → **无法判定** → 退回硬判（保守，不放过）。
          const declAudited = /\*{0,2}被审正文\*{0,2}\s*[：:]\s*`?([^\s`|，。]+\.md)/.exec(text);
          const auditedN6 = (() => {
            if (!declAudited) return null;
            const m = /初稿-v(\d+)\.md$/.exec(declAudited[1].replaceAll('\\', '/'));
            if (m) return Number(m[1]);
            return /定稿\.md$/.test(declAudited[1]) ? Infinity : null;   // 审的是定稿 → 无「之后的修订」可比
          })();
          const latestNoteN6 = revNotes
            .map((f) => Number((f.match(/^修订说明-v(\d+)\.md$/) || [])[1]))
            .filter((n) => Number.isInteger(n))
            .reduce((a, b) => Math.max(a, b), 0);
          const overdue6 = auditedN6 === null ? true : latestNoteN6 > auditedN6;
          if (overdue6) {
            findings.push(`已有修订说明（${revNotes.length} 份，最新 v${latestNoteN6}）但缺同号复核报告——修订复核必须落盘 audits/复核报告-v${audit.n}.md`);
          } else {
            soft.push(`已有修订说明（${revNotes.length} 份，最新 v${latestNoteN6}）但本轮**尚未到复核时点**（被审正文 v${auditedN6}）——修订**已完成**时须落盘 audits/复核报告-v${audit.n}.md（v18.62.7 A6：首轮审计的打回发生在任何修订之前，此时复核报告不可能已存在，故只作提示）`);
          }
        }
      }
    }
    const hard = findings.length > 0;
    results.push({
      gate: 'M-Exist-4 审计条目闭环',
      pass: !hard && soft.length === 0,
      detail: [
        `审计报告 ${audit.name}${review ? ` ↔ 复核报告 ${review.name}` : '（无复核报告）'}`,
        reviewPairDesc,
        isReject ? (header ? `任务书 ${rows.length} 行` : '结论为打回') : '结论非打回（无需任务书）',
        hard ? `硬问题：${findings.slice(0, 3).join('；')}` : (pairNote || '条目契约与闭环成立'),
        soft.length ? `软提示：${soft.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard ? (findings.length > 2 ? 'P0' : 'P1') : (soft.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-4 审计条目闭环', pass: false, detail: `解析失败: ${e.message}`, severity: 'ERROR' });
}

}

// === M-Exist-5 阶段闸门记录表（v2.5.2-dsh.17 新增）===
export function mExist5(ctx) {
  const { draftPath, auditsDirOf, skillRoot, results } = ctx;
// 依据：两道主控闸门（T2.5 / T7.5）此前只有「主控 LLM 兜底执行」的伪代码，**没有任何落盘表单**——
//   闸门过没过、依据是什么，只留在会话里；M-Integrity-2 的 8 步判定也没有可核对的输入。
//   本项把闸门变成结构化记录（`audits/闸门记录-T2.5.md` / `audits/闸门记录-T7.5.md`，
//   真源 = `references/templates/闸门记录-template.md`，本节要求的检查项**从模板派生**，不写死）：
//     · 每道闸门的模板检查项都必须有对应行（漏项 = 闸门形同虚设）
//     · 「实据」列必须是**路径 / exit code / 命令**，不接受「已检查」这类自述（闸门留机械证据）
//     · 结论词固定（✓ / ✗ / N/A）；判 ✗ 的行必须写失败原因
//     · T7.5 另与 final/M-Gate-Report.json 对账：全 ✓ 却报告 exit≠0 = 自相矛盾（P0）
// 触发条件：项目已进入 Phase 4（audits/审计报告-*.md 存在）→ 两表单必须有；否则 N/A。
try {
  const projDir5 = dirname(dirname(draftPath));
  const auditsDir5 = auditsDirOf();
  const hasAudit5 = !!latestReport(auditsDir5, '审计报告');
  const tplPath5 = join(skillRoot, 'references', 'templates', '闸门记录-template.md');
  if (!hasAudit5) {
    results.push(auditAbsentResult(draftPath, 'M-Exist-5 阶段闸门记录表', '审计报告'));
  } else if (!auditsDir5) {
    results.push({ gate: 'M-Exist-5 阶段闸门记录表', pass: false, detail: '找不到 audits/ 目录，无法定位闸门记录', severity: 'ERROR' });
  } else {
    const tplItems = { 'T2.5': [], 'T7.5': [] };
    const normLabel = (s) => String(s).replace(/[\s*`（）()【】\[\]：:、，,。.／/\-—_|]/g, '');
    // 模板表格首列 = 必需检查项（真源在模板；表格之外的行不计入 —— 防图例/说明表被当成检查项）
    if (existsSync(tplPath5)) {
      const tl = readFileSync(tplPath5, 'utf8').split('\n');
      let cur5 = null;
      let inTable5 = false;
      // v18.12.0（全量审计 L-54）：`tableDone5` = **本节**表格已结束。
      //   旧版在「表格之外的行」上写 `break` → 该 break 退出的是**整个模板扫描循环**，
      //   而 `闸门记录-template.md` 的 T2.5 表后紧跟空行 → 循环在 T2.5 表末就 break，
      //   **T7.5 段永不解析**（实测 tplItems['T7.5'] = 0 项）→ T7.5 的「模板逐项都要有行」
      //   在空列表上空转通过：把闸门记录写成一行自造项也能拿到 pass。
      //   现改为「按节」语义：非表格行只结束**本节**的收集，不影响后续节。
      let tableDone5 = false;
      for (const l of tl) {
        const h = l.match(/^#{2,4}\s*(T2\.5|T7\.5)\b/);
        if (h) { cur5 = h[1]; inTable5 = false; tableDone5 = false; continue; }
        if (/^#{2,4}\s/.test(l)) { cur5 = null; inTable5 = false; tableDone5 = false; continue; }   // 进入下一节 → 停止收集
        if (!cur5 || tableDone5) continue;
        if (!/^\s*\|/.test(l)) { if (inTable5) tableDone5 = true; continue; }   // 本表结束 → 本节不再收集
        inTable5 = true;
        const c = tableCells(l);
        if (!c.length || isSeparatorRow(c)) continue;
        if (/检查项|^检查$/.test(c[0])) continue;                               // 表头
        if (c[0]) tplItems[cur5].push(c[0]);
      }
    }
    const findings5 = [];
    const soft5 = [];
    const detailBits = [];
    let contradict5 = false;   // 闸门结论 ↔ M 门报告自相矛盾 = 单独定为 P0（不随条数降级）
    const noteBits5 = [];      // v18.12.0：**纯信息**备注（不参与 pass 判定）——如「已按 T8 裁定放行」
    let recordsFound5 = 0;     // v18.12.0：实际解析到的闸门记录份数（缺文件已在循环内单独报，不再叠加）
    let blob5 = '';            // v18.12.0（L-33）：两份记录的**全文拼接**（判「战略门脚本有没有留痕」要跨表跨段看）
    let blobT75_5 = '';        // v18.12.0（L-33）：**仅 T7.5 那份**的全文（战略门是 T7 的必跑项，T2.5 不该被判）
    let strategySeen5 = null;  // v18.12.0（L-33）：T7.5 记录里给了 exit 的战略门脚本数（null = 未走到该判定）
    for (const gateId of ['T2.5', 'T7.5']) {
      const fp = join(auditsDir5, `闸门记录-${gateId}.md`);
      if (!existsSync(fp)) {
        // v18.79.0（反哺-v18.78.2 §二 F-g）：**归属提示**（只进 detail，不改判定）。
        //   实测：T7 首跑（报告未落盘）本项 = SKIP；审计报告落盘后复跑 = P1「缺 audits/闸门记录-T7.5.md」
        //   —— 同一份稿件、同一套脚本，仅因 T7 落盘就多出一项 P1，而 **detail 不会告诉 T7 这不是他的活**：
        //   `audits/闸门记录-T2.5.md` 行 5 逐字写明「产出者：**主控（T0）**，判定当场写（不得事后补写）」，
        //   T7 代写就是伪造人工闸门留痕（07 卡最小权限）。不给归属，T7 极易误以为「我漏交了产物」而补交一份形式件。
        //   判据：**门的 detail 必须写明「该件的既定产出者是谁」**，否则「报告后激活」的 P1 会被读成收报方的缺项。
        findings5.push(`缺 audits/闸门记录-${gateId}.md（${gateId === 'T2.5' ? 'T2 数据检索 → T4 前' : 'T7 审计 → T8 终检前'}的闸门无落盘留痕）`
          + '——**归属提示**：该件的既定产出者 = **主控（T0）**、判定当场写（见 `audits/闸门记录-T2.5.md` 行 5；'
          + '形制照 `references/templates/闸门记录-template.md`），**不属审计员 T7 的交付物**，T7 不得代写（代写即伪造人工闸门留痕）');
        continue;
      }
      const ls5 = readFileSync(fp, 'utf8').split('\n');
      blob5 += `\n# 闸门记录-${gateId}.md\n` + ls5.join('\n');   // v18.12.0（L-33）：全文拼接，供跨表判定用
      if (gateId === 'T7.5') blobT75_5 = ls5.join('\n');
      const hIdx5 = ls5.findIndex((l) => /^\s*\|/.test(l) && /检查项/.test(l));
      if (hIdx5 === -1) { findings5.push(`闸门记录-${gateId}.md 缺「检查项」表格（表头须含 检查项 / 实据 / 结论）`); continue; }
      const header5 = tableCells(ls5[hIdx5]);
      const ci5 = (kw) => header5.findIndex((h) => kw.test(h));
      const iItem = ci5(/检查项/), iEv = ci5(/实据|证据|依据/), iRes = ci5(/结论|判定/), iWhy = ci5(/失败原因|原因|备注/);
      if (iEv === -1 || iRes === -1) { findings5.push(`闸门记录-${gateId}.md 表头须含「实据」「结论」列（现有：${header5.join(' / ')}）`); continue; }
      const rows5 = [];
      recordsFound5++;
      for (let i = hIdx5 + 1; i < ls5.length; i++) {
        const l = ls5[i];
        if (/^#{2,4}\s/.test(l)) break;
        if (!/^\s*\|/.test(l)) continue;
        const c = tableCells(l);
        if (isSeparatorRow(c)) continue;
        rows5.push(c);
      }
      // === v18.2.6 审计修复（跨改动回归收口）：行身份 = **检查编号优先**，措辞不再要求逐字 ===
      // 为什么：本轮内容线按审计 C-2 把模板那行「信任级别一致性（M-Exist-3）」改名成了
      //   「引用闭环（M-Exist-3：[Dxx] 正文 ↔ 数据卡条目）」——**原行名指向一个实际不检查信任级别的门**
      //   （信任级别由 M-Form-6 / G12 承担），留着它就是一行「会被机检、却没有检查在跑」的假绿行。
      //   但 15 个真实项目的既有闸门记录（`audits/闸门记录-*.md`）写的仍是旧行名，而本项旧口径是
      //   **标签逐字（归一后包含）比对** → 实测 15/15 项目被判「T2.5 检查项缺『引用闭环（M-Exist-3…）』」
      //   → `guannian-yu-linian` 由「仅 P2（exit 3）」退化成「有 P1（exit 1）」，而 exit 1 会触发
      //   T5 修订轮 —— 正是本包最反感的**假 P1 阻断交付**，且这次是自己引入的。
      // 规则（模板侧与记录侧**同一套**归一，绝不两处口径）：
      //   ① 行内出现检查编号（`（M-Exist-3：…）` / `（M-Form-6）` / `(M-Integrity-1)`，含 U+2011 连字符与空格变体）
      //      → **行身份 = 识别到的第一个编号**（`引用闭环（M-Exist-3：…）` 与 `信任级别一致性（M-Exist-3）`
      //      归一为同一行身份 `M-EXIST-3`；改措辞、补说明都不再触发假 P1）；
      //   ② 任一侧没有编号 → 沿用既有「归一后逐字 + 双向包含」严格口径（模板其它行不受影响）；
      //   ③ **缺行照样报**：归一化只让同一编号的不同措辞互相承认，不会让「整行不存在」通过；
      //      编号被写成别的门（如把 M-Exist-3 写成 M-Exist-9）不满足模板行 → 照报。
      //   ⚠️ **模板仍是唯一真源**——本规则只解决「同一编号的不同措辞」，不引入别名表、不放宽检查项集合。
      const checkIdOf = (label) => {
        const m = String(label ?? '').match(/M\s*[-\u2011]?\s*(Form|Exist|Integrity)\s*[-\u2011]?\s*(\d+)/i);
        return m ? `M-${m[1].toUpperCase()}-${m[2]}` : null;
      };
      for (const need of tplItems[gateId]) {
        const nn = normLabel(need);
        const needId = checkIdOf(need);
        const hit = rows5.some((r) => {
          const raw = r[iItem] || '';
          const rowId = checkIdOf(raw);
          if (needId && rowId) return rowId === needId;   // 两侧都有编号 → 按编号判同一行
          const s = normLabel(raw);                        // 缺编号的一侧 → 既有严格口径
          return !!s && (s.includes(nn) || nn.includes(s));
        });
        if (!hit) findings5.push(`${gateId} 检查项缺「${need}」（模板为真源，逐项都要有行）`);
      }
      let resPass = 0;
      for (const r of rows5) {
        const item = (r[iItem] || '').trim();
        if (!item) continue;
        const ev = (r[iEv] || '').replace(/<[^>]*>/g, '').trim();   // 去掉 <…> 模板占位符：未填 = 不是证据
        const res = (r[iRes] || '').trim();
        // 实据必须是机械证据：路径 / exit code / 命令 / 哈希；纯自述不接受
        //   v18.0.5 修（第三方审计 P1-5）：删掉原先的裸 `\d`——它让「已检查 1 次」这类自述通过，
        //   与文档「不接受『已检查』这类自述」直接冲突。现在数字必须带量词/单位或与路径/命令/哈希同现。
        //   v18.2.5 扩（主控实战反哺 P2）：**识别模式扩容**——实测漏报两类**真机械证据**（本项目 T2.5）：
        //     ① 数量比较形态 `35 ≥ 30`（条目数对需求数）——旧模式要求「数字+量词」，纯比较被判非证据；
        //     ② MD5 哈希（32 位 hex）+ `Get-FileHash -Algorithm MD5` 命令——旧模式只认 `sha256` 关键词，
        //        不认 32 位 hex，也不认 `Get-FileHash` 这类与 `sha256sum` 等价的取哈希命令。
        //   两者都可机械复核，判成「自述」= **假 P1**（本项目 M-Exist-5 的唯一 P1 即由①②共同造成）。
        //   现补：32/64 位 hex（含大写，故加 i）、数量比较符、Get-FileHash / Test-Path / Get-Item / certutil 等验证命令。
        const evLooksReal =
          /[\\/]|exit\s*[=:：]?\s*\d|node\s+\S+\.mjs|m-gate|sha256|\b[a-f0-9]{32}\b|\b[a-f0-9]{64}\b|Get-FileHash|Test-Path|Get-Item|certutil|\.json|\.md|\.svg|\d+\s*[≥>]\s*\d|\d+\s*(?:条|个|处|项|篇|例|%|倍|字|轮|步|节|章|页|行|次|份|组|种|点)/i.test(ev) &&
          !/^(已|未)?(检查|核对|确认|自查)(完)?(毕|过)?$/.test(ev.replace(/\s/g, ''));
        if (ev.replace(/[\s.。…-]/g, '').length < 3 || !evLooksReal) {
          findings5.push(`${gateId}「${item}」的实据列不是机械证据（须写路径 / exit code / 命令，而非「已检查」自述）：现为「${ev.slice(0, 24)}」`);
        }
        if (!/^(✓|✅|通过|✗|❌|失败|不通过|N\/A|N／A|-)$/.test(res)) {
          soft5.push(`${gateId}「${item}」结论词「${res.slice(0, 12)}」非固定词（应为 ✓ / ✗ / N/A）`);
        } else if (/^(✓|✅|通过)$/.test(res)) {
          resPass++;
        } else if (/^(✗|❌|失败|不通过)$/.test(res)) {
          if (iWhy === -1 || (r[iWhy] || '').trim().length < 4) findings5.push(`${gateId}「${item}」判 ✗ 但未写失败原因`);
        }
      }
      if (rows5.length === 0) findings5.push(`闸门记录-${gateId}.md 表格无有效行`);
      detailBits.push(`${gateId} ${rows5.length} 行（✓ ${resPass}）`);
      // T7.5 ↔ M-Gate-Report.json 对账（自相矛盾即 P0）
      // === v18.12.0（全量审计 L-02 / L-03 / L-22 / L-10）：闸门行 ↔ 真实产物 **绑定对账** ===
      // 旧版三条空洞（本次审计实测，均在本机三个已交付项目上复现）：
      //   ① 整段对账被 `resPass === rows5.length`（**全行皆 ✓**）守卫 —— 写一行 ✗ 或 N/A 即整段跳过，
      //      而模板本身允许 ✗ / N/A 两种结论词 → 最需要它的三个项目**全部绕过**；
      //   ② 实据列只做**语法匹配**（`/[\\/]|exit \d|…/`）：15 行全填伪造值 `exit 0` 也判「实据为机械证据」；
      //   ③ 结论词只查「是否在固定集合内」，**不与实据对账** —— 用 `exit=2` 的实据标 ✓ 照样过。
      // 现按**行**绑定（不再有「全 ✓」前置）：结论为 ✓ 的行，其实据必须能在真实产物上核实。
      // v18.12.0：M 门报告的位置**兼容三种布局**——`final/M-Gate-Report.json`（现行真源）、
      //   `audits/M-Gate-Report.json`（旧路径）、`audits/M-Gate-Report-v*.json`（更旧）。只认现行路径
      //   会对旧布局项目造成假 P1「结论无产物可核」。
      const repPath5 = [
        join(dirname(draftPath), 'M-Gate-Report.json'),
        join(projDir5, 'final', 'M-Gate-Report.json'),
        join(projDir5, 'audits', 'M-Gate-Report.json'),
        latestReport(auditsDir5, 'M-Gate-Report'),
      ].find((p) => p && existsSync(p));
      let rj5 = null;
      if (repPath5) {
        try {
          rj5 = JSON.parse(readFileSync(repPath5, 'utf8'));
        } catch (e) {
          // v18.2.6 审计修复 P1-7：旧 `catch {}` 让解析失败**静默丢弃对账**（读过却没核到）。
          soft5.push(`M-Gate-Report.json 无法解析，未做闸门↔报告对账（**不是**「无需对账」）：${e.message}`);
        }
      }
      // 有效裁定值：T8 裁定段干净（且非过期、无红线命中）→ 0；否则用脚本机械值。
      //   字段名兼容 `true_p0` / `true_p0_count`（L-04）；红线项命中则裁定无效（L-44）。
      const mechExit5 = rj5 ? (typeof rj5.script_exit_raw === 'number' ? rj5.script_exit_raw : rj5.exit) : null;
      const t8b = rj5 && rj5._t8_conclusion;
      const t8Clean5 = !!t8b
        && Number(t8b.true_p0 ?? t8b.true_p0_count) === 0
        && Number(t8b.true_p1 ?? t8b.true_p1_count) === 0
        && rj5.verdict_stale !== true
        && !(Array.isArray(rj5.hard_red_line_hits) && rj5.hard_red_line_hits.length > 0);
      const effectiveExit5 = rj5 ? (t8Clean5 ? 0 : mechExit5) : null;
      for (const r of rows5) {
        const item = (r[iItem] || '').trim();
        const ev = (r[iEv] || '').replace(/<[^>]*>/g, '').trim();
        const res = (r[iRes] || '').trim();
        if (!item || !/^(✓|✅|通过)$/.test(res)) continue;      // 只核「结论 ✓」的行（✗ 行另有「必写原因」检查）
        if (/handoff|交接门/i.test(item) || /handoff-check/i.test(ev)) {
          if (!/exit\s*[=:：]?\s*(0|20|21|22)\b/i.test(ev)) {
            findings5.push(`${gateId}「${item}」涉及交接门 handoff-check，但实据未给出 exit（须为 0/20/21/22 之一，模板 v18.6.0 规定必写）`);
          }
          // v18.46.0：此处原为 `else handoffSeen5 = true`（供 noteBits 的「两份都没提」判定用）；
          //   软档退役后该状态量**无人读**，已删。判据保留：**有该行但没给 exit → 依然判硬**。
        }
        if (/M\s*门/.test(item)) {
          // ① 实据里的 `exit N` 必须等于报告的**机械值**或**有效裁定值**（防「写个像证据的字符串」）
          //   ── v18.49.0（反哺 F-AL）：旧实现只取**第一个** `exit N` 并强制等于 `script_exit_raw`（机械值）──
          //   但闸门记录的实据行**引用裁定值是正当的**（「有效裁定值 0」正是 T8 放行后的真实状态），
          //   于是写 `exit 0` 会被判 P0「实据与产物不符」，写手只能退回写机械值——**两个都是权威值，却只认一个**。
          //   现规则：**取实据中出现的全部 `exit N`**，**只要有一个**等于机械值或有效裁定值即通过；
          //   全部不等才判 P0，且 detail 把两个可接受值都点出来（不再让写手靠猜）。
          const exits5 = [...ev.matchAll(/exit\s*[=:：]?\s*(\d+)/gi)].map((m) => Number(m[1]));
          if (!repPath5) {
            findings5.push(`${gateId}「${item}」判 ✓，但未找到 final/M-Gate-Report.json——结论无产物可核（实据绑定失败）`);
          } else if (rj5) {
            if (exits5.length && !exits5.some((n) => n === mechExit5 || n === effectiveExit5)) {
              contradict5 = true;
              findings5.push(`${gateId}「${item}」实据写 exit=${exits5.join('/')}，而 M-Gate-Report.json 的机械值 script_exit_raw=${mechExit5}、有效裁定值 exit=${effectiveExit5}——两者皆不符，实据与产物不一致（P0）`);
            }
            if (effectiveExit5 !== 0) {
              contradict5 = true;
              findings5.push(
                `${gateId}「${item}」判 ✓，但 M 门**有效裁定值** = ${effectiveExit5}`
                + `（script_exit_raw=${mechExit5}${rj5.verdict_stale === true ? '，且 T8 裁定已过期 verdict_stale=true' : ''}`
                + `${Array.isArray(rj5.hard_red_line_hits) && rj5.hard_red_line_hits.length ? `，且命中硬红线 ${rj5.hard_red_line_hits.join('/')}` : ''}`
                + `）——闸门结论与 M 门报告自相矛盾（P0）`,
              );
            } else if (t8Clean5 && mechExit5 !== 0) {
              // 仅在「机械值非 0、但 T8 就本版正文做了干净裁定」时提示——机械值本就是 0 的常规情形
              // **不加任何提示**（否则合规项目会因一条无信息量的软提示变成 pass=false → exit 3）。
              // 走 noteBits5（**不进 soft5**）：这是纯信息（「已按裁定放行」），不该把一次合法裁定
              // 变成新的 exit≠0（旧版把它 push 进 soft5 → 任何被裁定的项目都到不了 exit 0）。
              noteBits5.push(`已按 T8 裁定段放行（script_exit_raw=${mechExit5}；正文指纹一致且无红线命中）`);
            }
          }
        }
        // ② 实据里引用的**产物路径**必须真实存在（只核「该阶段必然已存在」的目录；`final/定稿.md`
        //    等 Phase 5 产物在 T7.5 时可能尚未生成，故不核 final/ 根下、也不核 references/ / scripts/）
        const PATH_WHITELIST = /^(?:[A-Za-z]:\/|\/|(?:audits|drafts|analysis|literature|data|cases)\/|final\/(?:证据包|图件)\/)/;
        const cited = [...new Set((ev.match(/[A-Za-z]:[\\/][^\s，。；;）)】]+|[\w][\w./\\-]*\.(?:md|json|svg|txt|html)/g) || [])
          .map((p) => p.replace(/\\/g, '/'))
          .filter((p) => PATH_WHITELIST.test(p)))];
        for (const p of cited) {
          const abs = /^[A-Za-z]:\//.test(p) || p.startsWith('/') ? p : join(projDir5, p);
          if (!existsSync(abs)) {
            soft5.push(`${gateId}「${item}」实据引用的路径不存在：${p}（**不是**「无需核对」——请补真实产物路径或修正）`);
          }
        }
        // ③ v18.12.0（L-47）**正文指纹互锁**：实据里写了 sha256 的，必须与报告记录的正文指纹一致。
        //   为什么需要：报告的 `verdict_scope.draft_sha256` 是**脚本自己**写的（它总能与时点自洽），
        //   所以「跑出 exit=0 → 再改稿 → 不再重跑」会留下「指纹自洽 + script_exit_raw=0」的报告。
        //   把指纹**同时钉在闸门记录**（脚本改不到的人工产物）里，伪造就得改两处且互相锁定。
        //   仅在两侧都有值时判（不强制要求写指纹，避免对既有形态过度收紧）。
        const mSha = ev.match(/sha256[^\da-f]{0,6}([0-9a-f]{12,64})/i);
        const recSha = rj5?.verdict_scope?.draft_sha256;
        if (mSha && typeof recSha === 'string' && recSha.length >= 12) {
          if (recSha.slice(0, 12).toLowerCase() !== mSha[1].slice(0, 12).toLowerCase()) {
            findings5.push(
              `${gateId}「${item}」实据里的 sha256=${mSha[1].slice(0, 12)}… 与 M-Gate-Report.json 的正文指纹 `
              + `${recSha.slice(0, 12)}… **不一致**——改稿后未重跑 M 门？（指纹互锁：两处必须指向同一版正文）`,
            );
          }
        }
      }
    }
    // v18.12.0（L-10）：v18.6.0 规定两道闸门记录须写交接门 `handoff-check` 的 exit（20/21/22）。
    //   审计实测：20 个真实项目里只有 1 个真跑过，而机检**从不检查**这一条（规则写着「不写 = 判 P1」）。
    //   落地口径（**有意选择，非疏漏**）：① 行内**提到** handoff 却未给 exit → 硬问题（上面已按行判，精确）；
    //   ② 两份记录**都没提** handoff → 当时记 **noteBits**（可见、但不改 pass）。理由：把②做成 P1/P2 会让
    //   所有既有形态（含十数个历史项目的记录）一律非通过，属「对历史形态过度收紧」——「不写就红」的
    //   代价应由主人权衡后再定；此处先保证**看得见**。详见修订记录 §未做项。
    //   ⚠️ **上述 ② 已于 v18.46.0 退役**（见下方 v18.46.0 段）：此处保留为**历史沿革**，不是现行行为。
    //
    // ── v18.42.0（主人裁定「B」= 路径 ②，**保持软档**）：存量实测 + 一条结构性结论 ──────────────────
    //   · **存量（22 个项目真跑本门实测）**：有闸门记录者 10 个 —— 落本档 **9/10**、已合规 **1/10**
    //     （`共锁-自愿性理论的第四象限` 写了 exit）、**踩到上面①硬档的 0 个**（该硬档至今空转）；
    //     且这 10 个项目的 M-Exist-5 **今天已全部非通过**，但**无一是因本条**（主因是 L-33 战略门留痕、
    //     模板检查项缺行、实据与产物不符）→ 故把②转硬的**新增翻红项目 = 0**，只有 **1 个跨档**
    //     （`海外驻军-主权分离` 的 findings 由 3 → 4，触发 `findings5.length > 3` 升 P0）。
    //   · **为什么仍保持软（本批决定性的实测发现）**：模板检查项表里**没有** handoff 行，而本门按
    //     「**模板为真源，逐项都要有行**」对账（下方 `tplItems` 循环）——因此**给模板加这一行 = 一次
    //     静默收紧**：实测会让 **9/10 个项目新增「检查项缺行」硬问题**（只加 T7.5 表也仍是 7/10），
    //     并各有 **1 个跨档**。即：**在这张表上「让条件可达」与「不新增红线」不可兼得**（模板行同时
    //     是可达化手段与收紧手段）。故本批改走**散文层可达化**：软提示给出闭合动作 + 模板散文给出
    //     可照写的示例行，**不动检查项表**。
    //   · **待主人裁定**：是否接受「加模板行」的代价（≈ 与转硬同价），登记在 `references/maintainers.md`
    //     第九节软档登记表；该表的存量列已由本次实测填上（原为「—」）。
    //
    // ── v18.46.0（主人「依次全部修订」）：**软档退役——该要求已由「模板为真源」判硬** ──────────────
    //   主人接受了加模板行的代价（实测 9/10 新增「缺行」硬问题 + 1 个跨档），故 `闸门记录-template.md` 的
    //   T2.5/T7.5 两表**各自新增一行**「交接门 handoff-check exit（按被验收角色）」。
    //   **于是本段的两条分支现在合起来覆盖了全部形态，缺 exit 一律判硬**：
    //     ① 记录里**有**这一行但实据未给 exit → 硬问题（上方按行判，精确）；
    //     ② 记录里**没有**这一行 → 硬问题（`tplItems` 循环的「检查项缺「交接门 handoff-check exit…」」）。
    //   **因此 `noteBits` 退役**（v18.18.2 起曾在此）——保留它会与 ② **同源双计**（同一个缺口报两次），
    //   而本仓有明文判据「同源两条不得当两条独立发现」。**这不是放宽**：退役的是**软提示**，
    //   而对应的硬判定由上面两条接管，净效果是**更严**（原先「都不提」只可见、现在判硬）。
    //   存量代价已实测并由主人接受；**存量不回填**的理由见 `references/maintainers.md` §九。
    // （历史沿革：v18.12.0 L-10 立 noteBits → v18.42.0 主人裁定「B」保持软 + 散文层可达化 →
    //   v18.46.0 主人「依次全部修订」接受代价、加模板行并退役软档。逐轮记录见 CHANGELOG 与修订记录。）
    // v18.12.0（全量审计 L-33）：**T7 的三个战略门脚本「真跑过」的机械留痕**。
    //   为什么单独加一条：`structure-check` / `methodology-check` / `cite-coverage` 是本包**三条反伪造线**
    //   （编造章节结构 / 空方法段 / 幽灵引用），`pipeline-readme.md` 与 07 卡都写「T7 必跑」——但**没有任何
    //   门核验它们真跑过**：记录里写不写、写什么值，机检一律不看。于是「必跑」在机械层等于不存在。
    //   落地口径（**有意选择，非疏漏**）：只在 **T7.5** 记录上判，且只判「三个名字里提到了几个」——
    //     ① 三个全未提 → **P1**（写在规范里的必跑项没有任何留痕）；
    //     ② 提了但不足三个 → **P2**（部分留痕）；
    //     ③ 提了就要求每个都紧跟一个 exit 数字（与 handoff 那条同口径；缺 exit 的名字不计入「提到」）。
    //   为什么不做成「必须存在某个专用段落」：记录形态由主人与各项目自定，收得太紧会对既有形态过度收紧；
    //   本条的锋芒是「必跑项不许零留痕」，而且**点名到脚本**（哪一条没跑一眼可见）。
    //   ⚠️ 作用域：本块在 `for (gateId of ['T2.5','T7.5'])` **之外**（与该循环同级的收尾段），
    //     故**不得引用 `gateId`**——用循环里存下的 `blobT75_5` 判「T7.5 那份记录里有没有」。
    if (blobT75_5) {
      const STRATEGY_GATES = [
        ['structure-check', /structure-check/i],
        ['methodology-check', /methodology-check/i],
        ['cite-coverage', /cite-coverage/i],
      ];
      const miss3 = STRATEGY_GATES.filter(([, re]) => !re.test(blobT75_5)).map(([nm]) => nm);
      const noExit = STRATEGY_GATES
        .filter(([, re]) => re.test(blobT75_5))
        .filter(([, re]) => !new RegExp(`${re.source}[^\\n]{0,80}?exit\\s*[=:：]?\\s*\\d+`, 'i').test(blobT75_5))
        .map(([nm]) => nm);
      strategySeen5 = STRATEGY_GATES.length - miss3.length;
      if (miss3.length === STRATEGY_GATES.length) {
        findings5.push(
          'T7.5 记录**完全未提** T7 的三个战略门脚本（structure-check / methodology-check / cite-coverage）——'
          + '`pipeline-readme.md` 与 07-审计卡均写明「T7 必跑」，本项是它们在机械层唯一的留痕要求（v18.12.0 L-33）',
        );
      } else if (miss3.length) {
        soft5.push(`T7.5 记录只提到 ${strategySeen5}/3 个战略门脚本，缺：${miss3.join(' / ')}`);
      }
      if (noExit.length) {
        soft5.push(`T7.5 记录提到战略门脚本但未给 exit：${noExit.join(' / ')}（写法示例：\`structure-check exit 1 / methodology-check exit 0 / cite-coverage exit 0\`）`);
      }
    }
    if (!existsSync(tplPath5)) soft5.push('未找到 references/templates/闸门记录-template.md（检查项清单降级为仅结构校验）');
    const hard5 = findings5.length > 0;
    results.push({
      gate: 'M-Exist-5 阶段闸门记录表',
      pass: !hard5 && soft5.length === 0,
      detail: [
        detailBits.join(' / ') || '两表单均缺失',
        hard5 ? `硬问题：${findings5.slice(0, 3).join('；')}` : '闸门记录齐备且实据为机械证据',
        soft5.length ? `软提示：${soft5.slice(0, 2).join('；')}` : '',
        noteBits5.length ? `备注：${noteBits5.slice(0, 2).join('；')}` : '',
        strategySeen5 !== null ? `战略门留痕 ${strategySeen5}/3` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard5 ? (contradict5 || findings5.length > 3 ? 'P0' : 'P1') : (soft5.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-5 阶段闸门记录表', pass: false, detail: `解析失败: ${e.message}`, severity: 'ERROR' });
}

}

// === M-Exist-6 审稿报告与期刊匹配（v2.5.2-dsh.17 新增）===
export function mExist6(ctx) {
  const { draftPath, auditsDirOf, skillRoot, results } = ctx;
// 依据：T9 审稿报告的 6 维度评分 + 建议词 + 期刊匹配表此前**零机械校验**——总评分可以是 6 个维度
//   凑不出来的数，期刊推荐可以是《期刊数据库》里根本不存在的刊名，综合匹配度可以不由公式得出。
//   本项做三件事：① 总分 == 6 维之和（算术自洽）；② 建议词与总分区间一致；③ 期刊匹配表**可复算**
//   （综合 = 0.45×主题 + 0.25×风格 + 0.15×范式 + 0.15×归一化，容差 ±1.5）且刊名出自 `期刊数据库.md`。
//   ⚠️ **v18.78.0（反哺 F29）**：公式真源 = `_shared/期刊匹配算法.md` §二 步骤 5（v18.59.0 起为**四项式**）。
//   本门旧实现是 v18.59.0 之前的 `0.5/0.3/0.2` 两项式且不读范式列 → 把照真源算出的数字判成「不可复算」
//   （实测 cn-llm-inference-cost-econ：T9 按真源 83.1% 被判复算值 79.9%）。**错在本门，不在 T9**。
//   v18.9.0 实战反哺补丁 / 2026-09-23：在原 3 项基础上加 **④ LLM 补充行来源标注契约**——T9 报告若含 LLM 补充期刊
//   行（`来源 = LLM 补充（不在数据库，须人工核验）`），来源列必须含此精确字符串；否则该行报 P2。
//   实战教训：数字社交-关系重构项目 T9 输出 3 条 LLM 补充英文 SSCI 行，主控手动标注「LLM 补充（不在数据库，须人工核验）」
//   字样，但 M-Exist-6 无机制核验 → 下次 T9 可能漏标注 → 投稿决策被「杜撰刊名」误导风险。
// 触发条件：存在 audits/审稿报告-vN.md（T9 可选，未启用 → N/A）。
try {
  const projDir6 = dirname(dirname(draftPath));
  const auditsDir6 = auditsDirOf();
  const latest6 = latestReport(auditsDir6, '审稿报告');
  if (!latest6) {
    // v18.78.2（A5）：未检 ≠ 通过；**刻意不升 P1**（T9 按文类档案本就可选，升档即假红——理由见文件头「A5」段）。
    results.push({ gate: 'M-Exist-6 审稿报告与期刊匹配', pass: 'SKIP', detail: 'N/A 且**未检**：无审稿报告（T9 未启用或未到 Phase 4.7）——**不得读成通过**（exit 3 需人工复核）', severity: 'SKIP' });
  } else {
    const rt = readFileSync(latest6.path, 'utf8');
    const findings6 = [];
    const soft6 = [];
    const DIMS = ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范'];
    // ── v18.62.7（反哺-主控实测-2026-10-02 §A10）：6 维取分**限定在含「总评分」的那张表内** ─────────
    //   病灶：旧实现是 `rt.match(...)`（整份报告找**首个**匹配）——若 T9 把**三视角各自的 6 维**与
    //   **整合 6 维**放进同一份报告（三视角模式下的常态），脚本取到的是三视角里**第一个**的 6 维
    //   → 与整合总评分比对 → 判「评分表与总分自相矛盾」（**P0**）。而护栏只是「读契约记住」。
    //   本次实测的主控就是靠**事前读契约**、改用叙述式评分（「原创性 4 分」不带 `/5`）才绕开——
    //   「正确性依赖人读注释」正是本仓反复批判的形态。
    //   修法：先定位「总评分」所在行；若它在表格内，则把取分范围收窄到**该表的连续表格块**；
    //   收窄后仍取不到的维度再回退全文（保旧行为，不制造新的假阴性）。
    const total6 = rt.match(/总评分[^\d]{0,8}(\d{1,2}(?:\.\d)?)\s*\/\s*30/) || rt.match(/总分[^\d]{0,12}(\d{1,2}(?:\.\d)?)\s*\/\s*30/);
    const declaredTotal = total6 ? Number(total6[1]) : null;
    // 选表规则（唯一口径）：候选 = **含 ≥2 个维度名的表格块**；打分 = 命中维度数 +（该块含「总评分/总分」? +10 : 0）；
    //   取分最高者，**同分取靠后**（「整合评分」表按 T9 契约排在三视角之后；实测报告亦然）。
    //   为什么不用「总评分那一行所在的表」单判据：总评分**不一定在表内**（实测有 `> **总评分**：21/30`
    //   写在表外的合法形态）——单判据会在那种报告上退回全文，等于没修。
    let dimScope = rt;
    let dimScopeNote = '';
    {
      const tLines = rt.split('\n');
      const blocks = [];
      for (let i = 0; i < tLines.length; i++) {
        if (!/^\s*\|/.test(tLines[i])) continue;
        let b = i;
        while (b + 1 < tLines.length && /^\s*\|/.test(tLines[b + 1])) b++;
        blocks.push({ a: i, b });
        i = b;
      }
      const best = blocks
        .map((blk) => {
          const t = tLines.slice(blk.a, blk.b + 1).join('\n');
          return { blk, hits: DIMS.filter((d) => t.includes(d)).length, hasTotal: /总评分|总分/.test(t) };
        })
        .filter((x) => x.hits >= 2)
        .sort((x, y) => ((x.hits + (x.hasTotal ? 10 : 0)) - (y.hits + (y.hasTotal ? 10 : 0))) || (x.blk.a - y.blk.a))
        .pop();
      if (best) {
        dimScope = tLines.slice(best.blk.a, best.blk.b + 1).join('\n');
        dimScopeNote = `6 维取自候选表（第 ${best.blk.a + 1}–${best.blk.b + 1} 行，命中 ${best.hits}/6 维${best.hasTotal ? ' 且含总评分' : ''}）`;
      } else {
        dimScopeNote = '未找到含 ≥2 个维度名的表格 → 6 维退回全文取首个匹配（旧行为）';
      }
    }
    const dimScores = [];
    for (const d of DIMS) {
      // v18.5.1（反哺报告-v1 B3 补深，主人授权修订）：支持小数半分制（4.0 / 3.5 / 4.5）——实战 T9 打半分，
      //   旧正则 `(\d)` 对「4.0/5」回溯错取 0、对「3.5/5」错取 5 → 维度和失真；总评 24.5 同理失配。
      //   v18.62.7（A10）：先在 dimScope（= 总评分那张表）里找，找不到再回退全文。
      const mk = (src) => src.match(new RegExp(`${d}[^\\n]*?(\\d(?:\\.\\d)?)\\s*/\\s*5`))
        || src.match(new RegExp(`${d}\\s*\\|\\s*(\\d(?:\\.\\d)?)\\s*/\\s*5`));
      const m = mk(dimScope) || (dimScope === rt ? null : mk(rt));
      if (!m) soft6.push(`未找到「${d}」的 x/5 评分（模板 6 维须齐全）`);
      else dimScores.push(Number(m[1]));
    }
    if (declaredTotal === null) findings6.push('审稿报告缺「总评分 XX/30」');
    else if (dimScores.length === 6) {
      const sum = dimScores.reduce((a, b) => a + b, 0);
      if (sum !== declaredTotal) findings6.push(`总评分 ${declaredTotal}/30 ≠ 6 维之和 ${sum}（${DIMS.map((d, i) => `${d}${dimScores[i]}`).join('+')}）——评分表与总分自相矛盾`);
    }
    if (declaredTotal !== null) {
      const expect = declaredTotal >= 26 ? /accept/i : declaredTotal >= 21 ? /minor/i : declaredTotal >= 16 ? /major/i : /reject/i;
      if (!expect.test(rt)) soft6.push(`总分 ${declaredTotal} 对应的建议词（${expect.source.replace(/[/i]/g, '')}）在报告中未出现——建议与区间可能不一致`);
    }
    // 期刊匹配表
    // v18.8.x 反哺补丁（2026.09.22）：表头检测旧版找「第一根**包含**『综合匹配度』的表格行」——
    //   实战 T9 报告在前文的「评分合法性自检」表里有一格写「期刊匹配表表头含『综合匹配度』」，
    //   该**单元格提及**被误认为表头 → 真正的期刊表（靠后 170 行）扫不到 → 「期刊表 0 行」假 P1。
    //   修法：单元格级精确匹配——先 tableCells 切列，须存在一个（去加粗/空白后）**恰为**
    //   「综合匹配度」的单元格（提及性长短语不再命中）。
    const jLines = rt.split('\n');
    const jHead = jLines.findIndex((l) => /^\s*\|/.test(l)
      && (() => { try { return tableCells(l).some((c) => /^[*\s]*综合匹配度[*\s]*$/.test(c)); } catch { return false; } })());
    let jRows = [];
    if (jHead !== -1) {
      for (let i = jHead + 1; i < jLines.length; i++) {
        const l = jLines[i];
        if (!/^\s*\|/.test(l)) break;
        const c = tableCells(l);
        if (isSeparatorRow(c)) continue;
        jRows.push(c);
      }
    }
    // v18.2.6 审计修复 P1-7（口径校正：简报**缺失** ≠ 简报**读不动**）：
    //   「是否启用期刊匹配」的真源优先级 = ① **审稿报告自述**（`启用期刊匹配|期刊匹配助手` 命中即算启用）
    //   → ② 项目 `01-任务简报.md` 的声明。
    //   ① 简报**不存在**（ENOENT）：这是 Phase 4.5 之前的**合法状态**（最小项目 / 夹具常常没有简报），
    //      旧行为即「按未启用处理」——保持，且**不推 soft6**（本门 `pass = !hard6 && soft6.length===0`，
    //      推 soft 会把「审稿建议可消费性」这类**无关子判定**一起判 false，属过度触发）。
    //      此口径不会放过「本该要求期刊匹配」的场景：**报告自述一旦已启用，无论简报如何都要求 Top 3 表**
    //      （见下方 `jHead === -1` 的硬判定），即判据在①就兜住了，不依赖简报。
    //   ② 简报**存在但读不动**（EACCES/EISDIR/编码异常…）：那才是「承重子检查被静默跳过」，
    //      必须可见 → 记 soft6（旧 `catch { return false }` 与「简报说没启用」同形）。
    let journalNote = '';
    let paradigmNote = '';   // v18.78.0（F29）：范式契合列的有无必须说出来（否则读者不知复算用了默认值）
    const wantJournal = /启用期刊匹配|期刊匹配助手/.test(rt) || (() => {
      try { return /启用期刊匹配/.test(readFileSync(join(projDir6, '01-任务简报.md'), 'utf8')); }
      catch (e) {
        if (e.code === 'ENOENT') {
          journalNote = '项目 01-任务简报.md 不存在 → 「是否启用期刊匹配」按**未启用**处理（简报缺失是 Phase 4.5 之前的合法状态；判据以审稿报告自述优先）';
          return false;
        }
        soft6.push(`未能读取项目 01-任务简报.md，「是否启用期刊匹配」以审稿报告自述为准：${e.message}`);
        return false;
      }
    })();
    if (jHead === -1) {
      if (wantJournal) findings6.push('任务简报已启用期刊匹配，但审稿报告无「综合匹配度」表（Top 3 缺失）');
    } else {
      if (jRows.length !== 3) soft6.push(`期刊匹配表 ${jRows.length} 行（应为 Top 3）`);
      if (jRows.length === 0) findings6.push('期刊匹配表存在表头但无数据行');
      const head6 = tableCells(jLines[jHead]);
      const col6 = (kw) => head6.findIndex((h) => kw.test(h));
      const iComp = col6(/综合/), iTheme = col6(/主题/), iStyle = col6(/风格/), iCycle = col6(/审稿周期/), iWhy2 = col6(/推荐理由|理由/);
      // ── v18.78.0（反哺-v18.78.0-candidate F29）：**公式真源对齐 + 范式契合列** ────────────────────
      //   病灶（实测 cn-llm-inference-cost-econ，**本门误判**）：公式真源 = `references/_shared/期刊匹配算法.md`
      //     §二 步骤 5（v18.59.0 起加第 3 项）：
      //       综合匹配度 = 0.45×主题 + 0.25×风格 + 0.15×范式 + 0.15×归一化
      //     而本门**沿用了 v18.59.0 之前的 0.5/0.3/0.2 两项式**（且不读范式列）→ T9 按真源算的 83.1%
      //     被复算成 79.9%（差 3.2pp > 容差 1.5）→ 判「数字不可复算」。**错在本门，不在 T9**：
      //     ① 反哺报告曾据此判「T9 用非标准公式」——**方向相反**，如实纠正；
      //     ② 「同一事实两处维护必然发散」的又一实例（算法文档改了、脚本与 T9 卡没改齐）。
      //   判据：公式**只有一处真源**（算法文档）——本门照它复算；范式列**未写时取中性默认 50%**
      //     （算法文档原话「论文方法风格未填时范式匹配度 = 0.5（中性默认）」），并在 detail 里说明用了默认。
      //   ⚠️ 不断言「必须有范式列」：存量报告没有该列 → 只记 detail 说明，**不判软/硬**（不对历史形态过度收紧）。
      const iParadigm6 = col6(/范式契合|范式匹配度|^范式$/);
      paradigmNote = iParadigm6 === -1
        ? '期刊表无「范式契合」列 → 复算第 3 项按中性默认 50% 计；建议按 期刊匹配算法.md §三 输出格式补该列（含范式标签）'
        : '';
      const paradigmOf = (row) => {
        if (iParadigm6 === -1) return null;
        const v = pct(row[iParadigm6]);
        return v === null ? null : v;   // 非百分比单元格（如「范式标签」列被误认）→ 视作「未填」
      };
      // ── v18.62.7（反哺-主控实测-2026-10-02 §A15，**实测复现**）：刊名取**「期刊」那一列**，不再取首格 ──
      //   病灶：旧实现写死 `r[0]`；而派发话术里的期刊表示例是 `| 排名 | 期刊 | 综合 | … |`，
      //   首格是 `🥇 1` → 脚本拿「🥇 1」去查 `期刊数据库.md` → 报「『🥇 1』未在本库内找到」软提示。
      //   实测复现：把排名列改成纯数字 `1/2/3`，该软提示即消失（= 与刊名无关）。
      //   修法：按**表头**定位含「期刊 / 刊名 / 刊物」的那一列；表头认不出时退回首格（保旧行为）。
      //   另一层防御：解析出的格子若**形如排名**（`🥇`/数字/`No.` 等、无书名号与汉字刊名特征），
      //   直接跳过刊名核对——免得换个表头写法又重新踩同一个坑。
      const iName = col6(/期刊|刊名|刊物|期刊名/);
      const rankLike = (s) => /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]*\d+\s*$|^No\.?\s*\d+$/u.test(String(s || '').trim());
      let dbText = '';
      // v18.2.6 审计修复 P1-7：旧写法 `catch { /* 降级 */ }` 让「刊名数据库读不到」与
      //   「刊名都在库里」在输出里完全同形 —— 「杜撰刊名」这条检查**静默失效**而报告照常显示
      //   「评分自洽、期刊匹配可复算」。现按既有做法记入 soft6，并说明该子检查已降级。
      try { dbText = readFileSync(join(skillRoot, 'references', '_shared', '期刊数据库.md'), 'utf8'); }
      catch (e) { soft6.push(`期刊数据库（references/_shared/期刊数据库.md）读取失败 → 「刊名是否在本库内」子检查已降级为本项跳过：${e.message}`); }
      const pct = (s) => { const m = String(s || '').match(/(\d+(?:\.\d+)?)\s*%/); return m ? Number(m[1]) : null; };
      for (const r of jRows) {
        const rawNameCell = r[iName >= 0 ? iName : 0] || '';
        const name = String(rawNameCell).replace(/[*《》\s]/g, '');
        if (!name) { findings6.push('期刊匹配表有行缺刊名'); continue; }
        if (rankLike(rawNameCell)) continue;   // v18.62.7（A15）：排名格不是刊名 → 不参与库内核对
        if (dbText && !dbText.includes(name.slice(0, Math.max(2, name.length - 1)))) {
          // ── v18.49.0（反哺 F-AU）：**措辞降级**——旧文案「疑似杜撰刊名」把「本库覆盖不全」写成了
          //   「作者编造」。实测反例：《哲学研究》《政治学研究》**均为真实的中文核心刊物**（CSSCI / 北大核心），
          //   仅因未收录于 `references/_shared/期刊数据库.md` 即被指「疑似杜撰」→ **对作者的失实指控**。
          //   判据：**「本库查不到」只支持「未在本库内找到」这一个结论**；「杜撰」需要「格式非法 / 明显不存在」
          //   这类独立证据，而本检查**没有**那种证据。故措辞降级，并显式输出本库规模，防「查不到」被读成「不存在」。
          const dbScale = (dbText.match(/^\s*[-|]\s*《/gm) || []).length;
          soft6.push(`「${rawNameCell}」**未在** references/_shared/期刊数据库.md 内找到`
            + `（**不等于该刊不存在**——本库为精选集${dbScale ? `，当前收录约 ${dbScale} 条` : ''}，不穷尽全部刊物；`
            + `请人工核验其收稿范围与字数要求后再定稿）`);
        }
        const comp = pct(r[iComp]), theme = pct(r[iTheme]), style = pct(r[iStyle]);
        if (comp === null || theme === null || style === null) {
          findings6.push(`「${rawNameCell}」匹配度列缺百分比（综合/主题/风格都要有）`);
        } else if (declaredTotal !== null) {
          const normScore = Math.max(0, Math.min(1, (declaredTotal - 16) / 14));
          const paradigmPct = paradigmOf(r);
          const PARADIGM_NEUTRAL = 50;   // 未填 → 中性默认 50%（= 0.5），见期刊匹配算法.md §二 步骤 4.5 的「与原版兼容」段
          const pUsed = paradigmPct === null ? PARADIGM_NEUTRAL : paradigmPct;
          // v18.78.0（F29）：公式 = 算法文档 §二 步骤 5 的**四项式**（本门旧版是两项式，属过期实现）
          const expectComp = 0.45 * theme + 0.25 * style + 0.15 * pUsed + 0.15 * normScore * 100;
          if (Math.abs(comp - expectComp) > 1.5) {
            findings6.push(`「${rawNameCell}」综合匹配度 ${comp}% ≠ 复算值 ${expectComp.toFixed(1)}%`
              + `（=0.45×${theme} + 0.25×${style} + 0.15×${pUsed}${paradigmPct === null ? '（范式列未填→中性默认 50）' : ''} + 0.15×${(normScore * 100).toFixed(1)}）`
              + '——数字不可复算（公式真源 = references/_shared/期刊匹配算法.md §二 步骤 5）');
          }
        }
        if (iCycle !== -1 && !/[0-9]/.test(r[iCycle] || '')) soft6.push(`「${rawNameCell}」审稿周期为空或无数值`);
        if (iWhy2 !== -1 && (r[iWhy2] || '').replace(/[\s.。…-]/g, '').length < 6) soft6.push(`「${rawNameCell}」推荐理由过短（须含主题契合 + 风格契合 + 周期依据）`);
      }
    }
    // ---- 审稿建议的「可消费 + 落地追踪」（v2.5.2-dsh.17 增补）----
    // 依据：审稿报告的「给作者的具体修改建议（按优先级）」是 T5/主控据以做「目标期刊适配修订」的
    //   唯一输入；若建议只写「建议加强论证」这类无定位、无动作的句子，下游无法消费，
    //   而报告表面完全正常。本项核：建议段存在 + 条目带定位（§/段落/章/行 或素材编号）+ 编号连续，
    //   并在发生修订轮时核「审稿建议是否进了修订回执」（防「建议提了没人接」）。
    const sugIdx = jLines.findIndex((l) => /^#{2,4}\s/.test(l) && /修改建议|建议（按优先级）|给作者/.test(l));
    if (sugIdx === -1) soft6.push('未见「给作者的具体修改建议」段（T5/主控无据以做期刊适配修订）');
    else {
      let sugEnd = jLines.length;
      for (let k = sugIdx + 1; k < jLines.length; k++) { if (/^#{2,4}\s/.test(jLines[k])) { sugEnd = k; break; } }
      const sugLines = jLines.slice(sugIdx + 1, sugEnd);
      // v18.8.x 反哺补丁（2026.09.22）：建议条目旧版只认 `1.` / `-` 列表形态——实战 T9 把
      //   R-1..R-10 写成**结构化表格**（`| 编号 | 优先级 | 定位 | 违反规范 | 处置动作 | 论据 |`，
      //   定位列天然含 §/行号）却被判「无有效条目」假软提示。修法：表格行同样计入条目
      //   （首格含 R-N / P0-N / 数字编号即可），定位检查沿用同一正则。
      const sugItems = sugLines.filter((l) =>
        (/^\s*(?:\d+[.、)]|[-*]\s)/.test(l) && l.replace(/[\s\-*\d.、)]/g, '').length > 6)
        || (/^\s*\|/.test(l) && /^[*\s]*(?:R?-?\d+|P[012][-\u2011]?\w+)/.test((() => { try { return tableCells(l)[0] || ''; } catch { return ''; } })()))
      );
      // v18.73.0（反哺报告-v7 F-12）：**报文必须给出期望形态示例** ——
      //   实测（《不能评估的忠诚》）：T9 把该段重写为 `## 修改建议（按优先级逐条列）`、每条带
      //   `[P0]/[P1]/[P2]/[事实]` 标记并附图例，**仍被报「无有效条目」**；而判据（上面的 `sugItems` 正则）
      //   在**共享模块**里，`m-gate-check.mjs` 本体查不到 → **作者无法从报错反推期望形态**。
      //   判据：**报错若只说不合格、不说合格长什么样，它就不是可执行的报错。**
      if (sugItems.length === 0) {
        soft6.push('「修改建议」段无有效条目——须按优先级逐条列。'
          + '**认两种形态**：① **列表**：`- ` / `* ` / `1.` / `1、` 开头，且去掉编号与符号后**正文长度 > 6 字**'
          + '（例：`- [P0] §3 第二段：删去角色元数据块`）；'
          + '② **表格行**：以 `|` 开头的行，且**首格**为 `R-N` / `P0-N`-`P2-N` / 纯数字编号'
          + '（例：`| R-1 | P0 | §3 第二段 | 违反规范 | 处置动作 | 论据 |`）。'
          + '**注意**：段标题须含「修改建议」或「给作者」或「建议（按优先级）」之一（现有标题已匹配）；'
          + '**不认**的是「整段只有散文、没有任何编号条目标记」的形态。');
      }
      else {
        const noLoc = sugItems.filter((l) => !/[§第]\s*[一二三四五六七八九十\d]+|段落|行\s*\d|章|\[(?:L|D|C)\d+\]/.test(l));
        if (noLoc.length) soft6.push(`${noLoc.length}/${sugItems.length} 条建议无定位（须写 §章节/段落/行号 或素材编号，否则 T5 无法照做）`);
      }
    }
    // 落地追踪：已有修订说明（说明发生过修订轮）时，修订回执应提到审稿意见
    try {
      const drafts10 = join(projDir6, 'drafts');
      if (existsSync(drafts10)) {
        const revNotes6 = readdirSync(drafts10).filter((f) => /^修订说明-.*\.md$/.test(f)).sort();
        if (revNotes6.length) {
          const lastNote = readFileSync(join(drafts10, revNotes6[revNotes6.length - 1]), 'utf8');
          if (!/审稿|期刊|T9|同行评审/.test(lastNote)) {
            soft6.push(`修订说明（${revNotes6[revNotes6.length - 1]}）未提及审稿意见——审稿建议未进修订回执（「建议提了没人接」）`);
          }
        }
      }
    } catch (e) {
      // v18.2.6 审计修复 P1-7：落地追踪为增强项，但「读不到修订说明 → 跳过对账」必须留痕
      soft6.push(`审稿建议落地追踪跳过（读 drafts/修订说明-*.md 失败）：${e.message}`);
    }
    const hard6 = findings6.length > 0;
    // v18.9.0 实战反哺补丁 / 2026-09-23：④ LLM 补充行来源标注契约（M-Exist-6.5）
    // 扫整份审稿报告，命中疑似 LLM 补充行（行内含「LLM」「补充」「不在数据库」三个关键词之一）
    // 但「来源」列未写明「LLM 补充（不在数据库，须人工核验）」者 → 报 P2。
    const LLM_HINT_KEY = /LLM|补充|不在数据库|人工核验/;
    const LLM_REQUIRED_PHRASE = /LLM\s*补充[（(]不在数据库.*人工核验|人工核验.*不在数据库.*LLM|不在数据库[，,]须人工核验/;
    const llmHintLines = rt.split('\n').map((l, i) => ({ l, i })).filter((x) => LLM_HINT_KEY.test(x.l) && /^\s*\|/.test(x.l));
    const llmBadLines = llmHintLines.filter((x) => !LLM_REQUIRED_PHRASE.test(x.l));
    if (llmBadLines.length) {
      soft6.push(`${llmBadLines.length} 行疑似 LLM 补充期刊但来源列未写明「LLM 补充（不在数据库，须人工核验）」（line ${llmBadLines.slice(0, 3).map((x) => x.i + 1).join(', ')}）——T9 期刊匹配助手要求来源标注强制（见 09-审稿-peer-reviewer.md §期刊匹配助手）`);
    }
    results.push({
      gate: 'M-Exist-6 审稿报告与期刊匹配',
      pass: !hard6 && soft6.length === 0,
      detail: [
        `${latest6.name}｜6 维 ${dimScores.length}/6｜总评分 ${declaredTotal ?? '缺失'}${jHead !== -1 ? `｜期刊表 ${jRows.length} 行` : ''}`,
        hard6 ? `硬问题：${findings6.slice(0, 3).join('；')}` : '评分自洽、期刊匹配可复算',
        // v18.2.6：简报缺失属**合法差序输入**——留痕在 detail（不推 soft6，故不影响 pass）
        journalNote ? `备注：${journalNote}` : '',
        paradigmNote,   // v18.78.0（F29）：范式列有无 / 复算用了中性默认
        // v18.62.7（A10）：取分范围必须**说得出来**——否则「6 维是取自哪张表」又要靠人读代码。
        dimScopeNote,
        soft6.length ? `软提示：${soft6.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard6 ? (findings6.length > 2 ? 'P0' : 'P1') : (soft6.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-6 审稿报告与期刊匹配', pass: false, detail: `解析失败: ${e.message}`, severity: 'ERROR' });
}

}

// === M-Exist-7 交付说明字段齐备（v2.5.2-dsh.17 新增；v18.0.5 更正字段数为 12）===
export function mExist7(ctx) {
  const { draftPath, results } = ctx;
// 依据：`deliverables.md` 定义了 `final/交付说明.md` 的 **12 个固定字段**（T8 终检时机械填充；
//   dsh.17 由 11 显式化为 12——「证据包指纹」升为第 9 个、「终检结论」补两道闸门结论行；
//   v18.0.5 修第三方审计 P2-5：本节注释与模板头当时仍写 11，与模板实际 12 节自相矛盾），
//   但既无模板也无机检——每个项目的交付说明字段名与齐备程度全凭主控临场发挥，主人复核时
//   缺项不可发现（「固定字段」名不副实）。本项逐字段核验：存在 + 非空 + 证据包指纹占位符 +
//   主人决策记录覆盖四门（缺回填须显式标注「未留痕」，不得静默省略）。
// 触发条件：final/交付说明.md 存在（T8 已开始交付）；不存在 → N/A。
try {
  const ddPath = join(dirname(draftPath), '交付说明.md');
  const FIELD_KEYWORDS = [
    ['路径', /路径/], ['图件清单', /图件清单/], ['遗留风险', /遗留风险/],
    ['人工核验项', /人工核验/], ['数据溯源', /数据溯源/], ['成本指标', /成本指标/],
    ['反哺清单', /反哺清单|待 merge|待merge/], ['AI 使用披露', /AI 使用披露/],
    ['终检结论', /终检结论/], ['投稿就绪', /投稿就绪/], ['主人决策记录', /主人决策记录/],
  ];
  if (!existsSync(ddPath)) {
    // v18.78.2（A5）：未检 ≠ 通过；**刻意不升 P1**（T8 先写定稿再写交付说明，此为正常中间态——理由见文件头「A5」段）。
    results.push({ gate: 'M-Exist-7 交付说明字段齐备', pass: 'SKIP', detail: 'N/A 且**未检**：尚无 final/交付说明.md（T8 未开始交付，或正处于「定稿已写、交付说明未写」的中间态）——**不得读成通过**（exit 3 需人工复核）', severity: 'SKIP' });
  } else {
    const dt = readFileSync(ddPath, 'utf8');
    const dl = dt.split('\n');
    const findings7 = [];
    const soft7 = [];
    for (const [label, re] of FIELD_KEYWORDS) {
      // ── v18.60.1（主人授权反哺 v2 §1.2）：**字段起点改「标题行优先、正文行兜底」** ──
      //   为什么：旧实现取「首个满足 `^#|^\*\*|^\|` 且含字段名的行」——交付说明正文里**任何位置**
      //   提及该字段名（如 §8 写「见 §11 主人决策记录」）都会被当成字段起点，字段正文范围随之落到
      //   该处之后 → 报「字段未覆盖 Phase 0/2.5/3.5/Phase 5」**假硬问题**。
      //   实测（论衡实测项目-夫妻收入差异家庭权力）：同一 P1 **三次复现**——每次「修一处措辞」
      //   都因需写出该字段名而引入下一处（记录这个 bug 本身就要写出字段名）。
      //   判据：字段是**标题承载**的结构（`## N. 字段名`），标题行优先级必须高于正文提及行。
      const isFieldHeading = (l) => /^#{1,6}\s/.test(l);
      let i = dl.findIndex((l) => isFieldHeading(l) && re.test(l));
      if (i === -1) i = dl.findIndex((l) => /^\s*\*\*|^\s*\|/.test(l) && re.test(l));
      if (i === -1) { findings7.push(`缺固定字段「${label}」（deliverables.md 定为必填）`); continue; }
      // 字段正文 = 到下一个标题/表头行为止
      let j = dl.length;
      for (let k = i + 1; k < dl.length; k++) { if (/^#{1,6}\s/.test(dl[k])) { j = k; break; } }
      const raw7 = dl.slice(i + 1, j).join('\n');
      const bodyTxt = raw7.replace(/<[^>]*>/g, '').replace(/[|\s\-—–:：]/g, '');
      // ① 仍含 <…> 模板占位符 → 该字段没填（模板明确要求不得留占位符）
      // ② 去掉占位符后为空 → 阈值 1（允许「无」「未启用」这类**合法的一句话答复**）
      // v18.73.0（反哺报告-v7 F-11）：**判据与应用同一族的 `handoff-check.mjs` 对齐** ——
      //   旧判据 `/<[^>]{1,60}>/` **几乎命中任意尖括号文本**，于是**说明性技术表述**被当成未填占位符。
      //   实测（《不能评估的忠诚》）：「反哺清单」字段里描述 **HTML 注释语法**（反引号内的 `<!-- -->`）
      //   → 被判「字段『反哺清单』仍含模板占位符（<…> 未填）」**P0**。
      //   根因：**作者在解释工具行为，而检测器把解释文本当产物内容读。**
      //   修法照抄 `handoff-check.mjs:537` 那轮（v18.62.4）已实测过的两条改进，**同一族判据必须同口径**：
      //     ① **先剥离行内代码片段**（反引号内一律不算占位符）——技术说明几乎都写在反引号里；
      //     ② **判据收紧为「紧凑记号」**：`<` 后与 `>` 前都不得是空白，且首字符须为中文/字母/数字/`._%…`。
      //   残余歧义如实声明（与 handoff-check 同）：形如 `a<b 且 c>d` 但尖括号内容恰为紧凑中文的**正文**仍会被命中——
      //   不引入语义理解无法彻底区分「模板占位符」与「正文里用尖括号举例」；宁可在注释里说清边界，也不假装判得准。
      const raw7NoCode = raw7.replace(/`[^`]*`/g, '');
      if (/<(?=\S)[\u4e00-\u9fa5A-Za-z0-9._%…][\u4e00-\u9fa5A-Za-z0-9._%… \-]{0,38}(?<=\S)>/.test(raw7NoCode)) {
        findings7.push(`字段「${label}」仍含模板占位符（<…> 未填）`);
      }
      else if (bodyTxt.length < 1) findings7.push(`字段「${label}」为空（仅标题无内容）`);
    }
    // ⑦ §6 成本指标：实测值必须 `~NN[MKB]` 格式（v18.6.3 反哺：看板 17/21 token 列空，模板未写死格式，主控易写定性描述「已耗 12 次 spawn」漏报）
    {
      const i6 = dl.findIndex((l) => /成本指标/.test(l));
      if (i6 !== -1) {
        let j6 = dl.length;
        for (let k = i6 + 1; k < dl.length; k++) { if (/^#{1,6}\s/.test(dl[k])) { j6 = k; break; } }
        const s6 = dl.slice(i6 + 1, j6).join('\n');
        // 三选一即可：① `~NN[MKB]`（标准） ② 中文前缀（已耗/耗/消耗/总用）+ `NN[MKB]` ③ `NN[MKB]` 后接 token/缓存/cacheRead 关键字（说明这是成本数据）。裸 `NN[MKB]`（如"版本 5M"）不匹，防误报
        const hasMeasure = /~\s*\d+(?:\.\d+)?\s*[KMB]|(?:已耗|耗|消耗|总用)\s*[~\s]*\d+(?:\.\d+)?\s*[KMB]|\d+(?:\.\d+)?\s*[KMB]\s+(?:token|缓存|cacheRead|cache_write|chars|tokens)/.test(s6);
        const hasUnavail = /实测不可得[：:]/.test(s6);
        if (!hasMeasure && !hasUnavail) {
          findings7.push('§6 成本指标缺实测值——必须含 `~NN[MKB]`（如 `~5M`）或 `实测不可得：<原因>`（v18.6.3 反馈：定性描述「已耗 12 次 spawn」无法匹到，看板 token 列空）');
        }
      }
    }
    // 2026-09-29 主人授权修订 EXEC-1：占位符路径废止——「证据包指纹」段须写 sha256 实值
    //   （权威 = final/证据包/manifest.json），主人不参与回填。正则**不再接受**
    //   `[哈希校验待主人回填]` / `[SHA256-PENDING:HOST-VERIFY]`（v2.2.17 教训 #123 的「可选验证」已升为必填实值）。
    // v18.54.0（反哺 F-BI，随 EXEC-1 一并修）：**同一判据必须只有一个正则**。
    //   实测缺陷：EXEC-1 只改了下面这条硬检查，而 detail 首段的「+ 证据包指纹✓/✗」标记仍用**旧正则**
    //   （接受占位符）→ 只有占位符的项目，同一行 detail **同时**输出
    //   「…实到 11/11 **+ 证据包指纹✓**」与「硬问题：缺「证据包指纹」段或 sha256 **实值**…」
    //   （实测现场 = `run/AB-共锁-A`）→ 读者无法判断该门到底认不认这个字段。
    //   判据（可迁移）：**改判据时，必须把该判据的**所有**出口一起改**（硬问题 + 摘要标记 + 软提示 …），
    //   否则会出现「结论说 ✗、摘要说 ✓」的自相矛盾文案——比判据本身错更难查。
    const FP_REAL_RE = /sha256\s*[:：]?\s*[0-9a-f]{16,}/i;
    if (!FP_REAL_RE.test(dt)) {
      findings7.push('缺「证据包指纹」段或 sha256 **实值**（须含 `sha256: <hex 16+>`，权威 = `final/证据包/manifest.json`）；占位符已废止，主人不参与回填（M-Integrity-2 步骤 4 的输入）');
    }
    const dec = (() => {
      // v18.60.1（主人授权反哺 v2 §1.2）：同 §字段起点——**标题行优先**，避免正文提及该字段名即错位。
      const h = dl.findIndex((l) => /^#{1,6}\s/.test(l) && /主人决策记录/.test(l));
      return h !== -1 ? h : dl.findIndex((l) => /主人决策记录/.test(l));
    })();
    if (dec !== -1) {
      let dj = dl.length;
      for (let k = dec + 1; k < dl.length; k++) { if (/^#{1,6}\s/.test(dl[k])) { dj = k; break; } }
      const decTxt = dl.slice(dec, dj).join('\n');
      const missingGate = ['Phase 0', '2.5', '3.5', 'Phase 5'].filter((g) => !decTxt.includes(g));
      if (missingGate.length) findings7.push(`主人决策记录未覆盖：${missingGate.join(' / ')}（缺回填的门须显式标注「未留痕」，不得省略）`);
      else if (!/未留痕|通过|驳回/.test(decTxt)) soft7.push('主人决策记录既无决策词也无「未留痕」标注');
    }
    const hard7 = findings7.length > 0;
    results.push({
      gate: 'M-Exist-7 交付说明字段齐备',
      pass: !hard7 && soft7.length === 0,
      detail: [
        `12 固定字段（11 关键词字段 + 证据包指纹）实到 ${FIELD_KEYWORDS.length - findings7.filter((x) => x.startsWith('缺固定字段')).length}/${FIELD_KEYWORDS.length}${FP_REAL_RE.test(dt) ? ' + 证据包指纹✓（实值）' : ' + 证据包指纹✗（缺实值）'}`,
        hard7 ? `硬问题：${findings7.slice(0, 3).join('；')}` : '固定字段齐备且有内容',
        soft7.length ? `软提示：${soft7.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard7 ? (findings7.length > 3 ? 'P0' : 'P1') : (soft7.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-7 交付说明字段齐备', pass: false, detail: `解析失败: ${e.message}`, severity: 'ERROR' });
}

}

// === M-Exist-8 批判报告覆盖（C1-C7；v2.5.2-dsh.17 新增）===
export function mExist8(ctx) {
  const { draftPath, results } = ctx;
// 依据：06 卡明确要求「C1-C7 逐条执行」且每条按统一结构化清单写（论点定位/反方观点/你的论据/
//   攻击强度/建议），并声明「T7 审计员 + T5 写手可机械消费」——**但没有任何脚本核过它**。
//   实测风险：批判报告漏掉 C3（理论假设）或 C7（一处两用）时，从报告表面完全看不出来，
//   而 T7 的「T6 条目关闭复核」与 T5 的段级 diff 都以这些条目为输入。
// 本项机检：七节齐备（缺 → P1；>2 缺 → P0）、节体非空（软）、段级清单编号合法且唯一（P1/P2）、
//   每条清单至少含 3 项要素（软）。
// 触发条件：存在 analysis/批判报告-vN.md；无 → N/A（轻量档可跳，不算失败）。
try {
  const projDir8c = dirname(dirname(draftPath));
  const revDirs = [join(projDir8c, 'analysis'), join(projDir8c, 'audits'), dirname(draftPath)];
  const latestRevPath = revDirs.map((d) => latestReport(d, '批判报告')).find(Boolean) || null;
  if (!latestRevPath) {
    // v18.78.2（A5）：未检 ≠ 通过；**刻意不升 P1**（轻量档一律跳过 Phase 3.6——理由见文件头「A5」段）。
    results.push({ gate: 'M-Exist-8 批判报告覆盖', pass: 'SKIP', detail: 'N/A 且**未检**：无批判报告（轻量档跳过 Phase 3.6 或尚未到该阶段）——**不得读成通过**（exit 3 需人工复核）', severity: 'SKIP' });
  } else {
    const rt8 = readFileSync(latestRevPath.path, 'utf8');
    const rl8 = rt8.split('\n');
    const CIDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
    // 认标题 / 加粗标签 / 列表项 / 表格行四种写法（避免因格式差异误判「漏节」）
    // ── v18.60.1（主人授权反哺 v2 §2.5）：**允许 `#` 后带 `N.N ` 序号前缀** ──
    //   旧正则要求 `#` 后**直接**跟 C 编号，于是 `### 1.1 C1 核心论点可攻击性`（T6 实测写法）不匹配
    //   → 报「批判维度缺 C3/C4/C5」**假 P0**（而七节实际齐全：报告 42,939 B / 441 行，C1-C7 全在）。
    //   判据：节标题的**编号前缀是排版自由**，语义由 `C1..C7` 承载——不该由前缀形态决定是否识别到节。
    const CSEQ = '(?:\\d+(?:\\.\\d+)*\\.?\\s+)?';
    const cLine = (c) => new RegExp(`^(?:#{1,6}\\s*|[-*]\\s*|\\|\\s*)?\\*{0,2}${CSEQ}${c}(?![0-9])\\b`);
    const headLine = (c) => new RegExp(`^#{2,4}\\s*\\*{0,2}${CSEQ}${c}(?![0-9])\\b`);
    const missing8 = CIDS.filter((c) => !rl8.some((l) => cLine(c).test(l)));
    const thin8 = [];
    for (const c of CIDS) {
      const hi = rl8.findIndex((l) => headLine(c).test(l));
      if (hi === -1) continue;                      // 非标题写法 → 跳过非空判定（避免误伤）
      const secBody = sectionRange(rl8, hi, /^#{2,4}\s/).body.join('\n').replace(/[\s|*`\-—–:：]/g, '');
      if (secBody.length < 40) thin8.push(c);
    }
    // **只统计「条目定义行」（行首即编号）**：06 卡模板要求「批判总结」里再逐条列一次「关闭状态」，
    //   若按全文出现次数判唯一性，会把**模板要求的重述**误判成「编号重复」（端到端测试反哺）。
    // 定义行 = 行首即编号，且**不是「关闭状态」清单行**（关闭状态行形如 `- [P0-C1-1] ✓已关闭（…）`）。
    // 06 卡模板要求「批判总结」里逐条列一次关闭状态 —— 那是**引用**，不该判成「同编号第二次定义」（端到端测试反哺）。
    // v18.0.0 修复（冲突②）：06 卡允许**标题式**写法 `### [P0-C1-1] …`，而旧正则只认「行首即编号」
    //   → T6 报告的 19 条段级条目被计为 **0 条**（假阴性），下游若以该计数为准会误判 T6 未完成。
    //   现放宽为「行首编号」∪「列表项」∪「二~四级标题后接编号」（保留「关闭状态」行排除逻辑于下方）。
    const entryLineRe = /^\s*(?:[-*]\s*|#{2,4}\s*)?\[(P[012])-(C\d+)-(\d+)\]/;
    const closeStateRe = /已关闭|未关闭|待复核/;
    const entries8 = rt8.split('\n')
      .filter((l) => !closeStateRe.test(l))
      .map((l) => entryLineRe.exec(l))
      .filter(Boolean)
      .map((m) => ({ id: `[${m[1]}-${m[2]}-${m[3]}]`, cat: m[2] }));
    const badCat8 = [...new Set(entries8.filter((e) => !CIDS.includes(e.cat)).map((e) => e.id))];
    const dup8 = (() => { const seen = new Set(), dup = new Set(); for (const e of entries8) { if (seen.has(e.id)) dup.add(e.id); seen.add(e.id); } return [...dup]; })();
    const ELEMS8 = [/论点定位/, /反方观点|攻击方式/, /论据|\[(?:L|D|C)\d+\]/, /攻击强度|严重度|强度/, /建议|处置/];
    const thinEntries8 = [];
    for (const e of entries8) {
      const i = rt8.indexOf(e.id);
      const seg = rt8.slice(i, i + 700);
      if (ELEMS8.filter((re) => re.test(seg)).length < 3) thinEntries8.push(e.id);
    }
    const findings8 = [];
    const soft8 = [];
    if (missing8.length) findings8.push(`批判维度缺 ${missing8.length} 节：${missing8.join(',')}（C1-C7 须逐条执行）`);
    if (dup8.length) findings8.push(`段级清单编号重复：${dup8.slice(0, 5).join(',')}——同报告内编号必须唯一`);
    if (thin8.length) soft8.push(`节体过短（内容不足）：${thin8.join(',')}`);
    if (badCat8.length) soft8.push(`清单编号类别非法（须 C1-C7）：${badCat8.slice(0, 5).join(',')}`);
    if (thinEntries8.length) soft8.push(`${thinEntries8.length} 条清单要素不足 3 项（须含 论点定位/反方观点/论据/攻击强度/建议）：${thinEntries8.slice(0, 4).join(',')}`);
    const hard8 = findings8.length > 0;
    results.push({
      gate: 'M-Exist-8 批判报告覆盖',
      pass: !hard8 && soft8.length === 0,
      detail: [
        `${latestRevPath.name}｜C1-C7 实到 ${CIDS.length - missing8.length}/7｜段级条目 ${entries8.length} 条`,
        hard8 ? `硬问题：${findings8.slice(0, 2).join('；')}` : '七维齐备且条目编号合法',
        soft8.length ? `软提示：${soft8.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard8 ? (missing8.length > 2 ? 'P0' : 'P1') : (soft8.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-8 批判报告覆盖', pass: false, detail: `解析失败: ${e.message}`, severity: 'ERROR' });
}

}

// === M-Exist-9 审计报告 G 项覆盖（v2.5.2-dsh.17 新增）===
export function mExist9(ctx) {
  const { draftPath, auditsDirOf, results } = ctx;
// 依据：07 卡把「审计报告里的 G0-G14 检查项是否全覆盖」列为**验收标准**，quickref 要求
//   「必查项逐条执行，缺一不可」——**但没有任何脚本核过覆盖**。实测风险：审计报告只写了
//   G1-G7，G11（时效）/G12（信任级别）/G14（中文 AI 痕迹）整段缺席，报告读起来仍像「全项检查」。
// 本项机检：G0-G14 十五个主项都要出现**且邻域内有结论词**（缺项 → P1；>3 缺 → P0；有提及无结论 → P2）；
//   **且结论必须带实据**（v2.5.2-dsh.17 增补：同行/次行要有素材编号、文件路径、§ 或带量词的数字——
//   只写「通过」不给依据 = 自称通过 → P2）；G0.5 / G2.5 / G4-2 子项缺失 → P2。
// 触发条件：存在 audits/审计报告-vN.md；无 → N/A。
try {
  const auditsDir9 = auditsDirOf();
  const latest9 = latestReport(auditsDir9, '审计报告');
  if (!latest9) {
    results.push(auditAbsentResult(draftPath, 'M-Exist-9 审计报告 G 项覆盖', '审计报告'));
  } else {
    const at9 = readFileSync(latest9.path, 'utf8');
    const G_MAIN = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14'];
    // v18.12.0（全量审计 L-28）：**G15 此前既不在主项也不在子项 → 完全没有门在管**，而
    //   `audit-checklist-quickref.md`（本项自称的真源）在 v18.8.0 已新增「G15 引用匹配度」，
    //   且 `SKILL.md:186`/`AGENTS.md`/`glossary.md:128` 仍写「G0-G14（15 项）」——四处三口径。
    //   处置（**有意选择，非疏漏**）：G15 是**模式相关**项（仅在任务简报启用「§引用数量与质量控制」时适用），
    //   而本门看不到任务简报 → 把「未写 G15」判成 P1/P2 会对**未启用该模式**的报告造成假阳性
    //   （回归实测：三份原有夹具即刻被判失败）。故：**未写 → 记 note9（可见、不改 pass）**；
    //   **写了 → 与主项同口径校验结论与实据**（下方 G15 单独跑一遍）。
    const G_SUB9 = ['G0.5', 'G2.5', 'G4-2'];
    const G_OPT9 = ['G15'];
    // 结论词（v17.0.0 补 ✓/✗：端到端测试发现审计报告惯用「**通过** ✓」与「✓（论据）」，旧表漏 ✓ 导致 G1 误判无结论）
    const VERDICT9 = /通过|不通过|合规|违规|达标|未达标|PASS|FAIL|⚠|✅|❌|✓|✗|N\/A|部分|已核|未核|无问题|有问题/;
    const at9Lines = at9.split('\n');
    // 实据标记：素材编号 / 文件路径 / § / exit code / **带量词的数字**（裸数字不算——G 编号自带的数字已剥掉）
    // 实据标记（v17.0.0 扩容：端到端测试发现「≤1 周」「8 条」类量词不在原表内 → 误判「无实据」）
    const EVID9 = /\[(?:L|D|C|先)\d+\]|\.md\b|\.json\b|\.svg\b|\/|§|exit\s*\d|\d+\s*(?:条|个|处|项|篇|例|%|倍|字|周|月|年|天|次|段|行|份|名|位|张|轮|步|节|章|页|则|组|种|点|\/)/;
    const absent9 = [];
    const noVerdict9 = [];
    const noEvidence9 = [];
    for (const id of G_MAIN) {
      const esc9 = id.replace(/[.-]/g, (c) => `\\${c}`);
      const re9 = new RegExp(`(?<![A-Za-z0-9])${esc9}(?![0-9.])`);
      const hitLines = [];
      at9Lines.forEach((l, i) => { if (re9.test(l)) hitLines.push(i); });
      if (hitLines.length === 0) { absent9.push(id); continue; }
      // 结论词须在**同一行或紧接着的下一行**（覆盖「- **G7**：通过」「| G7 | 通过 |」「### G7 \n 结论：通过」三种写法）
      // 结论词 / 实据各自判定（v17.0.0 修复，端到端测试反哺）：
      //   报告里 G0 会出现两次 —— ① 节标题 `## G0 覆盖度`（行 5）；② 条目行 `- **G0**：… **通过** ✓。`（行 7）。
      //   旧实现「取第一个命中行 + 三行窗口」→ 窗口落在标题上 → 结论在窗口内成立，但**实据在标题行上必然为空**
      //   → 14 项被误报「结论无实据」。现改为：**逐命中行各取三行窗口，结论与实据分别在任一窗口中成立即可**。
      let verdictOk = false, evidOk = false;
      for (const i of hitLines) {
        const win = at9Lines.slice(i, i + 3).join('\n').replace(new RegExp(esc9, 'g'), '');
        if (VERDICT9.test(win)) verdictOk = true;
        if (EVID9.test(win)) evidOk = true;
      }
      if (!verdictOk) noVerdict9.push(id);
      else if (!evidOk) noEvidence9.push(id);
    }
    const absentSub9 = G_SUB9.filter((id) => {
      const esc9 = id.replace(/[.-]/g, (c) => `\\${c}`);
      return !new RegExp(`(?<![A-Za-z0-9])${esc9}(?![0-9.])`).test(at9);
    });
    const findings9 = [];
    const soft9 = [];
    if (absent9.length) findings9.push(`G 项未覆盖 ${absent9.length} 个：${absent9.join(',')}（quickref 要求逐条执行、缺一不可）`);
    if (noVerdict9.length) soft9.push(`${noVerdict9.join(',')} 有提及但邻域无结论词（须写 通过/不通过/N/A + 证据）`);
    if (noEvidence9.length) soft9.push(`${noEvidence9.join(',')} 的结论无实据（须给素材编号 / 文件路径 / § / 带量词的数字，不能只写「通过」）`);
    if (absentSub9.length) soft9.push(`子项未覆盖：${absentSub9.join(',')}（G0.5/G2.5/G4-2 为通用子项，缺一即记）`);
    // G15（**模式相关**项）：未写 → note9（可见、不改 pass）；写了 → 与主项同口径校验结论与实据。
    //   为什么不把「未写」计入软提示：本门看不到任务简报，无法判断「§引用数量与质量控制」是否启用 →
    //   一律记软提示会对未启用该模式的报告造成**假阳性**（回归实测：三份原有夹具即刻被判失败）。
    const note9 = [];
    for (const id of G_OPT9) {
      const escO = id.replace(/[.-]/g, (c) => `\\${c}`);
      const reO = new RegExp(`(?<![A-Za-z0-9])${escO}(?![0-9.])`);
      const hitsO = [];
      at9Lines.forEach((l, i) => { if (reO.test(l)) hitsO.push(i); });
      if (hitsO.length === 0) {
        note9.push(`${id}（引用匹配度，v18.8.0 新增）未写——任务简报启用「§引用数量与质量控制」时应写；未启用则该缺席属正常`);
        continue;
      }
      let vOk = false, eOk = false;
      for (const i of hitsO) {
        const win = at9Lines.slice(i, i + 3).join('\n').replace(new RegExp(escO, 'g'), '');
        if (VERDICT9.test(win)) vOk = true;
        if (EVID9.test(win)) eOk = true;
      }
      if (!vOk) soft9.push(`${id} 有提及但邻域无结论词（须写 通过/不通过/N/A + 证据）`);
      else if (!eOk) soft9.push(`${id} 的结论无实据（须给素材编号 / 文件路径 / § / 带量词的数字）`);
    }
    const hard9 = findings9.length > 0;
    results.push({
      gate: 'M-Exist-9 审计报告 G 项覆盖',
      pass: !hard9 && soft9.length === 0,
      detail: [
        `${latest9.name}｜G0-G14 实到 ${G_MAIN.length - absent9.length}/15${noEvidence9.length ? `（${noEvidence9.length} 项结论无实据）` : ''}`,
        hard9 ? `硬问题：${findings9[0]}` : (noEvidence9.length ? '十五项已覆盖且各有结论，部分结论缺实据' : '十五项全覆盖、各有结论与实据'),
        soft9.length ? `软提示：${soft9.slice(0, 2).join('；')}` : '',
        note9.length ? `备注：${note9.slice(0, 1).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard9 ? (absent9.length > 3 ? 'P0' : 'P1') : (soft9.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-9 审计报告 G 项覆盖', pass: false, detail: `解析失败: ${e.message}`, severity: 'ERROR' });
}

}

// === M-Exist-10 大纲 §11 精简段完整性（v2.5.2-dsh.17 新增）===
export function mExist10(ctx) {
  const { draftPath, evDir, THRESHOLDS, results } = ctx;
// 依据：04/05 卡定案「T5 只读 `analysis/分析大纲.md` 末尾 §11 写手版精简段（≈60 行），完整大纲按需」
//   —— 这条是**T5 上下文 50K 大头的根治手段**，但 §11 自身是否真的含齐六个要素（论证主线 /
//   论点-论据映射表 / 反方规划要点 / 字数预算 / 禁做项 / 承重墙清单）**从来没被核过**。
//   实测风险：§11 缺要素时 T5 只能**回退整读大纲**——省 token 的机制静默失效，而产物上看不出来。
// 本项机检：段落存在（缺 → P2，未启用精简段的老项目不判死）、六要素齐备（缺 ≥3 → P0，缺 1-2 → P1）、
//   段落非空（<5 行 → P1）、段落不在文件末尾（其后还有 >20 行的实质章节 → P2，与「末尾段」口径冲突）、
//   段落过长（>120 行 → P2，失去「精简」意义）。
try {
  const projDir10 = dirname(dirname(draftPath));
  const outline10 = [join(projDir10, 'analysis', '分析大纲.md'), join(evDir, '分析大纲.md')]
    .find((p) => existsSync(p)) || null;
  if (!outline10) {
    // v18.12.0（全量审计 L-23）：N/A 不得读成「通过」。旧文案「尚未进入 Phase 2」在**轻量档主动省 T4**
    //   的场景下是误导（该档位永远走不到 Phase 2 的大纲产出），且与 M-Form-8 的静默跳过叠加后，
    //   移动一个文件即可关掉两道门。现按「未检（degraded）」如实陈述，并指向连带规则。
    results.push({
      gate: 'M-Exist-10 大纲 §11 精简段',
      // v18.62.4（全量审计-v18.62.3 P1-5）：`pass: true` → `'SKIP'`。detail 早就写着「N/A 且**未检**…」
      //   而机器侧记「通过」→ 移走 `analysis/分析大纲.md` 即可让本门静默变成 exit 0（同仓
      //   `mexist-gates.mjs:15` 的等价情形用 `pass: 'SKIP'` → exit 3，本处漏了）。
      pass: 'SKIP',
      detail: 'N/A 且**未检**：未找到 analysis/分析大纲.md（若为轻量档主动省 T4，须按 SKILL.md 连带规则：主控代产最小 §11 精简段，或在 status.md + final/局限性.md 显式记豁免）——**不得读成通过**',
      severity: 'SKIP',
    });
  } else {
    const ol10 = readFileSync(outline10, 'utf8').split('\n');
    // v18.6.2 反哺（假 P0 修复）：旧版 findIndex 返回**首个**匹配，若大纲任何 ## 标题含「精简段/写手版」
    //   （如 `## §D 图表建议（…§11 写手精简段引用）`）会误命中该标题 → §11 段范围错位、六要素漏检 → 假 P0。
    //   改为优先锚定**标题开头**的 §11（`^#{2,4}\s*§11`），排除正文标题里「引用 §11」的中置写法；
    //   找不到回退旧的宽松匹配（兼容用「十一」中文编号或无 §11 章节号的旧大纲）。
    let hIdx10 = ol10.findIndex((l) => /^#{2,4}\s*§\s*11\b/.test(l) && /写手版|精简段|精简/.test(l));
    if (hIdx10 === -1) {
      hIdx10 = ol10.findIndex((l) => /^#{2,4}\s/.test(l) && /写手版|精简段/.test(l));
    }
    if (hIdx10 === -1) {
      results.push({
        gate: 'M-Exist-10 大纲 §11 精简段',
        pass: false,
        detail: '大纲缺「写手版精简段」标题（T5 按 §11 定位会找不到 → 回退整读大纲，token 优化失效）',
        severity: 'P2',
      });
    } else {
      const lvl10 = (/^(#{1,6})/.exec(ol10[hIdx10]) || [])[1].length;
      let eIdx10 = ol10.length;
      const re10 = new RegExp(`^#{1,${lvl10}}\\s`);
      let nextHeading10 = -1;
      // v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
      //   **寻找「下一标题」时必须跳过围栏代码块**——精简段正文常整体包在 ```markdown 围栏里，
      //   而围栏内的 `# T5 写手 v1 精简段（≤60 行）` 这类**一级标题**会被 `^#{1,lvl}\s` 命中
      //   → 段落在第 2 行即被截断 → 实测「精简段 2 行 / 六要素实到 0/6」**假 P0**
      //   （真值：围栏内 48 行、六要素齐备，T5 按 `## §11` 定位读取完全正常）。
      //   围栏开合用**行首 ``` **计数（奇数个即处于围栏内）。
      let inFence10 = false;
      for (let i = hIdx10 + 1; i < ol10.length; i++) {
        if (/^\s*```/.test(ol10[i])) { inFence10 = !inFence10; continue; }
        if (!inFence10 && re10.test(ol10[i])) { nextHeading10 = i; break; }
      }
      if (nextHeading10 !== -1) eIdx10 = nextHeading10;
      const seg10 = ol10.slice(hIdx10 + 1, eIdx10);
      const segText10 = seg10.join('\n');
      const rows10 = seg10.filter((l) => l.trim()).length;
      const ELEMS10 = [
        ['论证主线', /主线/],
        ['论点-论据映射表', /映射/],
        ['反方规划要点', /反方/],
        ['字数预算', /字数/],
        ['禁做项', /禁做|禁止/],
        ['承重墙清单', /承重墙/],
      ];
      const missing10 = ELEMS10.filter(([, re]) => !re.test(segText10)).map(([n]) => n);
      // 映射表要有真表格（表头含论点 + 至少一行含素材编号）
      const hasTable10 = /\|[^\n]*论点[^\n]*\|/.test(segText10) && /\[(?:L|D|C)\d+\]/.test(segText10);
      // 字数预算要有数字
      // 允许「### 字数预算」标题换行后才是数字（端到端测试发现：原正则要求同行，标题式写法被误判「未见数字」）
      const budgetNumeric = /字数[\s\S]{0,40}?\d/.test(segText10);
      const findings10 = [];
      const soft10 = [];
      const notes10 = []; // v18.0.0：备注（不计失败）——用于「两条规范自相矛盾」类项
      if (rows10 < 5) findings10.push(`精简段仅 ${rows10} 行实质内容（须 ≈60 行且含六要素）`);
      if (missing10.length >= THRESHOLDS.exist10MissingP0) findings10.push(`缺 ${missing10.length} 个要素：${missing10.join(',')}（六要素：论证主线 / 论点-论据映射表 / 反方规划要点 / 字数预算 / 禁做项 / 承重墙清单）`);
      else if (missing10.length) findings10.push(`缺要素：${missing10.join(',')}`);
      if (!hasTable10) soft10.push('未见「论点-论据映射表」真表格（表头含论点 + 行内含素材编号）');
      if (!budgetNumeric) soft10.push('字数预算未见数字');
      if (rows10 > THRESHOLDS.exist10MaxRows) soft10.push(`精简段 ${rows10} 行过长（≈60 行为准，过长则失去「只读精简段」的意义）`);
      if (nextHeading10 !== -1 && ol10.slice(nextHeading10).filter((l) => l.trim()).length > 20) {
        // v18.0.0 修复（冲突③）：本项**不再判 P2**，改为**备注**（notes10）。
        //   原因：04 卡模板本身要求 §11 之后还有 F3 早期框架锁定检查（必填段），
        //   故「§11 位于文件末尾」本就不成立（v18.4.0 收尾 B12：04 卡已把「末尾」更正为「F3 之前」）。
        //   T5 是按「## §11 标题」定位读取的，不依赖「文件末尾」这一位置属性，故位置偏差不构成质量缺陷。
        notes10.push(
          '备注（不计失败）：精简段之后还有 >20 行实质章节（F3 检查 / 缺口表为 04 卡必填段，§11 位于其前）——本项不据此判失败；T5 按「## §11」标题定位读取不受影响',
        );
      }
      const hard10 = findings10.length > 0;
      results.push({
        gate: 'M-Exist-10 大纲 §11 精简段',
        pass: !hard10 && soft10.length === 0,
        detail: [
          `${outline10.split(/[\\/]/).pop()}｜精简段 ${rows10} 行｜六要素实到 ${ELEMS10.length - missing10.length}/6`,
          hard10 ? `硬问题：${findings10.slice(0, 2).join('；')}` : '六要素齐备',
          soft10.length ? `软提示：${soft10.slice(0, 2).join('；')}` : '',
          notes10.length ? notes10[0] : '',
        ].filter(Boolean).join(' ｜ '),
        severity: hard10 ? (missing10.length >= THRESHOLDS.exist10MissingP0 ? 'P0' : 'P1') : (soft10.length ? 'P2' : '通过'),
        ...(notes10.length ? { notes: notes10 } : {}),
      });
    }
  }
} catch (e) {
  results.push({ gate: 'M-Exist-10 大纲 §11 精简段', pass: false, detail: `解析失败: ${e.message}`, severity: 'ERROR' });
}

}

// === M-Exist-2 证据包完整性（v18.0.5：递归统计 + 布局异常单列；v18.2.2：阶段感知）===
export function mExist2(ctx) {
  const { draftPath, evDir, layoutAnomaly, results } = ctx;
const files = walkMd(evDir);
const empty = files.filter((f) => { try { return statSync(f).size === 0; } catch { return false } });
const relOf = (f) => f.slice(evDir.length + 1).replaceAll('\\', '/');
// v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
//   **阶段感知——被审对象在 `drafts/` 阶段时，空证据包记 N/A 而非 P0**。
//   证据包由 **T8 终检阶段** 的 `build-evidence-bundle.mjs` 生成；而 T7 审计的对象是
//   `drafts/初稿-vN.md`，此时 `final/证据包/` 本就**还未生成**——旧实现一律判
//   「0 个 .md 文件 → P0」，于是该 P0 从 Phase 4 起就挂在报告里，T5 修订轮**无法关闭**
//   （它不属于稿件缺陷，而属于「顺序没到」），最终只能写进 Acknowledged Limitations。
//   本项与 `[报告后激活]` 同族，只是方向相反：**「产物尚未到期的门」不应在早期阶段判死**。
//   同文件开头的「证据包完整性前置提示」（EV_REQUIRED 段）已定过同一原则：
//   「证据包在 build-evidence-bundle.mjs 跑之前本就可能是空目录——中止会把『顺序没到』误报成『路径传错』」。
//   故：被审正文在 `drafts/` 且证据包为空 → N/A（pass=true）；其余情况维持原判（P0/P1）。
const isDraftStageAudit = /[\\/]drafts[\\/]/.test(draftPath);
if (files.length === 0 && isDraftStageAudit) {
  results.push({
    gate: 'M-Exist-2 证据包完整性',
    pass: true,
    // v18.80.0（全量审计-v18.79.1 P3①）：本处**有意**判 `通过`，与同族 6 处「N/A 未检 → SKIP」**不是同一态**，
    //   故在 detail 里显式声明，防下一轮审计再把它当「同类漏网」。
    //   两态的区别是**成因**：`SKIP` = 「该有却没有」（报告被删/改名/未产出 → 需人工复核，不得当通过）；
    //   `通过` = 「时序未到」（证据包由 T8 终检生成，Phase ≤4 审计时它**本就不该在**）。把「时序未到」
    //   也判 SKIP 会让每个 Phase 4 项目都带一条无法关闭的 exit 3，即本仓反复吃的「门常红 → 只能绕」。
    //   三态判据表 = `references/_shared/M-Gate-Algorithm.md` §N/A 三态。
    detail: 'N/A：证据包为空且被审对象位于 drafts/（Phase ≤4 审计场景）——**本处有意判通过（时序未到，非缺失）**：证据包由 T8 终检的 build-evidence-bundle.mjs 生成，届时重跑本项自动转实检。与「N/A 未检 → SKIP」（该有却没有）不是同一态，判据见 M-Gate-Algorithm.md §N/A 三态',
    severity: '通过',
  });
} else {
  // v18.12.0（全量审计 L-15）：**清单复算**——证据包此前是「内容全公开的目录」，任何人可往里丢文件或
  //   覆盖其中一份，而没有任何门会注意到（本项旧判据只数「几个 .md / 有没有 0 字节」，「证据包指纹」
  //   那条只核「占位符出现了没有」）。`build-evidence-bundle.mjs` 现在产出 `manifest.json`（逐文件
  //   sha256 + 字节数 + 被审正文指纹），此处复算比对：
  //     ① 清单在、且每个登记文件的现算 sha256/字节数一致；
  //     ② 目录里**没有未登记的 .md**（空降产物）；
  //     ③ 被审正文指纹与清单记录一致（顺带把 L-47 的正文互锁扩到证据包这一侧）。
  //   **精度边界（如实）**：本清单不设防「同时改文件与改清单」——它防的是**静默**（任何不一致都留可见
  //   痕迹）。清单缺失不判死（degraded，P2）：既有项目在 v18.12.0 之前生成的包没有清单，报死会制造
  //   一批假 P0；但会**显式提示刷新**，且 detail 写明「未核」而不是「已核过」。
  const manifestPath = join(evDir, 'manifest.json');
  let manifestProblem = null;   // 硬问题（P0）
  let manifestNote = '';        // 提示（不改严重度）
  let manifestStale = '';       // v18.13.0（L-55）：陈旧副本（源侧变动而包未重建）——同样只进 detail，不翻 severity
  let manifestChecked = false;
  if (existsSync(manifestPath)) {
    try {
      const mf = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const drifted = [];
      const absent = [];
      // ── v18.60.1（主人授权反哺 v2 §1.3 / §7.1 #6）：**`.bak` 两侧都不参与复算** ──
      //   为什么：`.bak` 是 `writeWithSafety` 的回滚点，`pruneBackups` 每个原文件上限 `BAK_MAX = 20`
      //   （超出即回收最旧者）。① 若清单登记了它（v18.60.1 之前生成的包），回收后必判 `absent` → **假 P0**；
      //   ② 新清单不再登记它，但包里仍留有历史 `.bak` → 会被 `extra` 判「未登记的产物」→ **假 P0**。
      //   判据：复算只对**交付成员**负责；`.bak` 是脚本自身的回滚点，不是交付物。
      const isBak = (p) => String(p).endsWith('.bak');
      for (const e of (mf.files || [])) {
        if (isBak(e.path)) continue;
        const full = join(evDir, e.path);
        if (!existsSync(full)) { absent.push(e.path); continue }
        const buf = readFileSync(full);
        const sha = createHash('sha256').update(buf).digest('hex');
        if (sha !== e.sha256 || buf.length !== e.bytes) drifted.push(`${e.path}（登记 ${e.bytes}B/${String(e.sha256).slice(0, 8)} → 实为 ${buf.length}B/${sha.slice(0, 8)}）`);
      }
      const registered = new Set((mf.files || []).map((e) => e.path));
      const extra = files
        .map((f) => f.slice(evDir.length + 1).replaceAll('\\', '/'))
        .filter((r) => !registered.has(r) && !isBak(r));
      if (absent.length || drifted.length || extra.length) {
        manifestChecked = true;
        manifestProblem =
          (absent.length ? `登记的文件已不在包里: ${absent.slice(0, 4).join(', ')}${absent.length > 4 ? `（…共 ${absent.length} 个）` : ''}；` : '') +
          (drifted.length ? `内容与清单不符: ${drifted.slice(0, 3).join('；')}${drifted.length > 3 ? `（…共 ${drifted.length} 个）` : ''}；` : '') +
          (extra.length ? `包内出现**未登记**的文件: ${extra.slice(0, 4).join(', ')}${extra.length > 4 ? `（…共 ${extra.length} 个）` : ''}` : '');
      } else {
        manifestChecked = true;
        // ② 被审正文指纹（配这一版正文生成的包吗）
        if (mf.auditTarget && mf.auditTargetSha256 && existsSync(join(dirname(dirname(evDir)), mf.auditTarget))) {
          const cur = createHash('sha256').update(readFileSync(join(dirname(dirname(evDir)), mf.auditTarget))).digest('hex');
          if (cur !== mf.auditTargetSha256) {
            manifestNote = `｜ ⚠️ 被审正文 \`${mf.auditTarget}\` 自清单生成后已变更（指纹不符）——本包是**旧版正文**的证据，请重跑 build-evidence-bundle.mjs`;
          }
        }
        manifestNote = `｜ ✓ 清单复算通过（${(mf.files || []).length} 个文件 sha256 一致，无空降文件）${manifestNote}`;
        // ③ v18.13.0（全量审计 L-55 收口）：**陈旧副本检测**。
        //   为什么需要：`build-evidence-bundle` 是**只加不删**的复制（`copyFileSync` 一遍，从不清理目的目录），
        //   而 `m-gate-check` 的 `findCard` **优先**读证据包 —— 于是「源文件被删/改名后，包里的旧副本仍在」
        //   这种情形下，M 门核的是**那份旧副本**（审计实测：删掉 `data/数据卡.md` 后重跑，M-Form-6 /
        //   M-Exist-3 / M-Integrity-1 仍全部通过）。② 只覆盖了「被审正文自清单生成后变更」，
        //   没有覆盖「**素材源**此后新增/删除」。
        //   判据：清单里由**构建时记下的缺失源**（`missingSrcs`）与**此刻实际缺失的源**比对——不一致即说明
        //   源侧变动而包未重建（此前缺失的源现在有了 → 包缺它；此前有的源现在没了 → 包里的那份是孤儿副本）。
        //   严重度 P2（**有意选择**）：包新不新属「时点」问题，而本项不是每次构建都能对齐（源文件随时可能被
        //   后续阶段补上）；按本仓「产物尚未到期不判死」的既有原则，先做**可见**，再由主控按需重跑。
        //   触发条件刻意收窄：只比 `missingSrcs` 的集合差，不比对 mtime（证据包会被复制/重写，mtime 不可靠）。
        try {
          const proj = dirname(dirname(evDir));
          const srcSpecs = [
            ...(Array.isArray(mf.missingSrcs) ? mf.missingSrcs : []).map((s) => s),
            'literature/文献卡.md', 'data/数据卡.md', 'cases/案例卡.md', 'final/图件',
          ];
          const nowMissing = new Set();
          for (const s of srcSpecs) {
            if (/图件$/.test(s)) continue;              // 目录型源单独处理（图件目录可能为空）
            if (!existsSync(join(proj, s))) nowMissing.add(s);
          }
          const staleBack = [...(mf.missingSrcs || [])].filter((s) => !nowMissing.has(s) && existsSync(join(proj, s)));
          const staleFwd = [...nowMissing].filter((s) => !(mf.missingSrcs || []).includes(s));
          if (staleBack.length || staleFwd.length) {
            manifestStale =
              (staleBack.length ? `构建时缺失、现已存在：${staleBack.slice(0, 3).join(', ')}（包内没有它们的内容）` : '')
              + (staleBack.length && staleFwd.length ? '；' : '')
              + (staleFwd.length ? `构建时存在、现已缺失：${staleFwd.slice(0, 3).join(', ')}（包内那份是**孤儿副本**，M 门可能核到它）` : '');
          }
        } catch { /* 陈旧检测是附加项，失败不影响清单复算结论 */ }
        // ④ v18.79.0（反哺-v18.78.2 §二 F-a）：**包源是否就是本次被审正文**（软提示，只进 detail）。
        //   实测病灶（test-v18-78-2-县中塌陷）：`manifest.auditTarget` = `drafts/初稿-v2.md`，而本次被审对象
        //   是 `drafts/初稿-v3.md`，且包内 3 份素材副本（案例卡/文献卡/先行者清单）逐 hash 落后于源
        //   —— 本项却**全绿通过**：② 只核「清单指向的那份正文自生成后有没有变」（v2 没变 → 无信号），
        //   ③ 只核「构建时缺失的源集合有没有变」（源一直在 → 无信号），**都不核「包 ↔ 本次被审对象」**。
        //   后果：一个**陈旧到指向上一版正文**的证据包可以全绿通过 M 门，并成为 G 项机检 / 审计 / 终检的**共同输入**。
        //   与 ③ 同档：新鲜度属「时点」问题，故只做**可见**（P2 文案进 detail），**不翻 severity**；
        //   是否重跑 `build-evidence-bundle.mjs` 由主控/ T7 按可见信号决定。
        try {
          const proj = dirname(dirname(evDir));
          const relDraft = relative(proj, draftPath).replaceAll('\\', '/');
          const mfTarget = String(mf.auditTarget || '').replaceAll('\\', '/');
          if (mfTarget && relDraft && !relDraft.startsWith('..') && mfTarget !== relDraft) {
            manifestStale = (manifestStale ? `${manifestStale}；` : '')
              + `包源 ≠ 本次被审正文：manifest.auditTarget = \`${mfTarget}\`，本次被审 = \`${relDraft}\``
              + '（**本包是另一版正文的证据**，其素材副本可能同样落后）';
          }
        } catch { /* 相对路径算不出（异盘/软链）→ 略过该提示，不影响其余判定 */ }
      }
    } catch (e) {
      manifestProblem = `清单无法解析（${e.message}）——请重跑 build-evidence-bundle.mjs 重生成`;
      manifestChecked = true;
    }
  } else {
    manifestNote = '｜ ⚠️ 无 manifest.json（v18.12.0 前生成的包）——**本包内容未核**，请重跑 build-evidence-bundle.mjs 补清单';
  }
  results.push({
    gate: 'M-Exist-2 证据包完整性',
    pass: files.length > 0 && empty.length === 0 && !layoutAnomaly && !manifestProblem,
    detail:
      `${files.length} 个 .md 文件` +
      (empty.length ? `，空文件: ${empty.map(relOf).join(',')}` : '，无空文件') +
      (layoutAnomaly ? ` ｜ 布局异常（P1）：${layoutAnomaly}` : '') +
      (manifestProblem ? ` ｜ 清单复算失败（P0）：${manifestProblem}` : manifestNote) +
      (manifestStale ? ` ｜ ⚠️ 证据包可能陈旧（P2，请重跑 build-evidence-bundle.mjs）：${manifestStale}` : ''),
    severity: (files.length === 0 || empty.length > 0 || manifestProblem) ? 'P0' : (layoutAnomaly ? 'P1' : '通过'),
  });
}

}

// === M-Exist-3 [Dxx] 正文↔数据卡 引用闭环（v2.5.2-dsh.5 加严重度评级；v18.0.3 更名对齐实装）===
export function mExist3(ctx) {
  const { bodyProse, dataCard, dataCardReadError, layoutAnomaly, THRESHOLDS, results } = ctx;
// 命名说明（v18.0.3）：本项旧名「信任级别一致性」，但它**只做引用闭环**（正文 [Dxx] ↔ 数据卡条目），
//   信任级别由 M-Form-6（独立信任级别段）+ G12（审计层）承担。文档已同步更名（M-Gate-Algorithm.md）。
if (dataCard) {
  const intextD = new Set(refsOf(bodyProse, 'D').map((s) => s.match(/\d+/)[0]));
  const cardD = new Set(dataCardIds(dataCard));   // v18.0.3：改用 _lib/refs.mjs 真源（旧版在此处重写正则）
  const missing = [...intextD].filter((d) => !cardD.has(d));
  const mExist3Sev = missing.length > THRESHOLDS.exist3P0 ? 'P0' : (missing.length > THRESHOLDS.exist3P1 ? 'P1' : (missing.length > 0 ? 'P2' : '通过'));
  // v18.12.0（全量审计 L-35）**空集真空通过**：`missing` 是集合差——**数据卡 0 条**时它必然为空，
  //   于是「0 条数据卡」与「全部对得上」都输出同一个 `pass=true`。审计实测：正文零 `[Dxx]` +
  //   数据卡 0 条的空壳稿，本门报「全部 [Dxx] 在数据卡有对应」= 通过。
  //   现：**无可核对对象**时显式记 degraded（不判失败，但不得读成「核过了」）。
  const vacuous3 = cardD.size === 0;
  results.push({
    gate: 'M-Exist-3 引用闭环',
    pass: missing.length === 0,
    detail: vacuous3
      ? `**未核**（数据卡 0 条条目 → 引用闭环无可核对对象${intextD.size ? `；但正文引了 ${intextD.size} 条 [Dxx]` : ''}）`
      : (missing.length ? `正文引 [Dxx] ${missing.length} 条在数据卡中无对应条目` : `全部 [Dxx] 在数据卡有对应（卡内 ${cardD.size} 条）`),
    severity: vacuous3 ? (intextD.size ? mExist3Sev : 'P2') : mExist3Sev,
  });
} else {
  results.push({
    gate: 'M-Exist-3 引用闭环',
    pass: false,
    detail: dataCardReadError
      ? `数据卡读取失败（**不是**「不存在」）：${dataCardReadError.message}`
      : layoutAnomaly ? `数据卡定位失败（证据包布局异常：${layoutAnomaly}）` : '数据卡不存在（证据包与项目 data/ 均无）',
    severity: 'P0',
  });
}

}

// M-Exist-11 反方论证闭合（v18.27.0 QLT-4 新增）——追加到 mexist-gates.mjs 末尾
//
// 依据（报告 §三.4 QLT-4 实测证据）：`SKILL.md` §核心原则 3 要求「每个核心论点配可能的反驳 + 回应策略」，
//   但**判定权在 T6（LLM）**，无任何机械检查 → 「反方论证被写成一句套话」不可检测。
//
// 本项机检：`analysis/分析大纲.md` 里的「**论点—证据—反方**」表，逐行核两件事——
//   ① 反方锚点 / 回应锚点**非空**（缺 → P1）；
//   ② 锚点**能定位到被审正文里的真实段落**（指向不存在 → P1）。
//
// **边界如实声明（三条，都是刻意的）**：
//   1. **表缺失 → `pass: true` + `severity: 'P2'` + 「N/A 且未检」**（与 M-Exist-10 的缺文件形态同一先例）：
//      该表是 v18.27.0 起的新模板要求，**老项目不判死**；同时不得读成「通过」（severity 与 detail 都写明未检）。
//   2. **机械只保证「表里每一行的锚点都真实存在」**——「哪些论点算核心论点」「表是否把核心论点收全」是
//      **语义判断**（要读大纲与正文），归 T6/T7；本项**不假装**能判这个（否则就会像 C-Redundancy 那样：
//      规格字面看起来在工作、实际靠一个词猜语义）。
//   3. 锚点解析只认**标题**（H2/H3）里的编号或标题片段——不认正文里的任意句子：锚点是「段」级定位，
//      允许指向句中会让「指向存在的段落」变成「这句话在全文出现过」= 形同虚设。

/** 在正文里定位锚点：返回命中的标题（无则 null）。锚点写法容错：`§3.2` / `3.2` / `#标题` / 标题片段。 */
const resolveAnchorIn = (anchorRaw, docText) => {
  const a = String(anchorRaw ?? '').trim().replace(/^#/, '').replace(/^§/, '');
  if (!a) return null;
  // 标题行：`## …` / `### …`（与 _lib/sections.mjs 同规则，但此处只需文本）
  const heads = [...docText.matchAll(/^#{2,4}[ \t\u3000]+(\S.*?)[ \t\u3000]*$/gm)].map((m) => m[1].trim());
  const num = a.match(/\d+(?:\.\d+)*/);
  for (const h of heads) {
    if (h.includes(a)) return h;                                   // 标题片段直接包含
    if (num && h.includes(num[0])) return h;                       // 编号命中（§3.2 → 标题里的 3.2）
  }
  return null;
};

/** 从大纲里取「论点—证据—反方」表的数据行（表头须含四类列名）。返回 `{ rows, headerFound }`。 */
const readArgumentTable = (outlineText) => {
  const lines = outlineText.split('\n');
  const reCell = (s) => s.split('|').map((x) => x.trim());
  const hasCol = (head, alts) => alts.some((k) => head.some((c) => c.includes(k)));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!/^\s*\|.*\|\s*$/.test(l)) continue;
    const head = reCell(l).slice(1, -1);
    const ok = hasCol(head, ['论点']) && hasCol(head, ['证据']) && hasCol(head, ['反方', '反驳']) && hasCol(head, ['回应']);
    if (!ok) continue;
    // 列下标（-1 表示缺列，前面 ok 已保证都存在）
    const idx = {
      论点: head.findIndex((c) => c.includes('论点')),
      反方: head.findIndex((c) => c.includes('反方') || c.includes('反驳')),
      回应: head.findIndex((c) => c.includes('回应')),
    };
    const rows = [];
    for (let j = i + 1; j < lines.length; j++) {
      const r = lines[j];
      if (!/^\s*\|.*\|\s*$/.test(r)) break;                          // 表结束
      if (/^\s*\|[\s:|-]+\|\s*$/.test(r)) continue;                  // 分隔行
      const cells = reCell(r).slice(1, -1);
      if (cells.every((c) => c === '' || /^-+$/.test(c))) continue;
      rows.push({ line: j + 1, 论点: cells[idx.论点] ?? '', 反方: cells[idx.反方] ?? '', 回应: cells[idx.回应] ?? '' });
    }
    return { rows, headerFound: true };
  }
  return { rows: [], headerFound: false };
};

export function mExist11(ctx) {
  const { draftPath, evDir, text, results } = ctx;
  try {
    const projDir = dirname(dirname(draftPath));
    const outline = [join(projDir, 'analysis', '分析大纲.md'), join(evDir, '分析大纲.md')]
      .find((p) => existsSync(p)) || null;
    if (!outline) {
      results.push({
        gate: 'M-Exist-11 反方论证闭合（论点—证据—反方表）',
        // v18.62.4（P1-5）：同 M-Exist-10 —— 未检 ≠ 通过
        pass: 'SKIP',
        detail: 'N/A 且**未检**：未找到 analysis/分析大纲.md（若为轻量档主动省 T4，须按 SKILL.md 连带规则记豁免）。**不得读成通过**——反方论证闭合本项未核',
        severity: 'SKIP',
      });
      return;
    }
    const outlineText = readFileSync(outline, 'utf8');
    const { rows, headerFound } = readArgumentTable(outlineText);
    if (!headerFound) {
      results.push({
        gate: 'M-Exist-11 反方论证闭合（论点—证据—反方表）',
        // v18.62.4（P1-5）：同 M-Exist-10 —— 未检 ≠ 通过
        pass: 'SKIP',
        detail: 'N/A 且**未检**：分析大纲里未找到「论点—证据—反方」四列表（v18.27.0 起为 `分析大纲-template` 的表格要求；'
          + '老项目与轻量档不判死）。**不得读成通过**——「核心论点是否都有反方论证」本项未核',
        severity: 'SKIP',
      });
      return;
    }
    if (rows.length === 0) {
      results.push({
        gate: 'M-Exist-11 反方论证闭合（论点—证据—反方表）',
        pass: false, severity: 'P1',
        detail: '「论点—证据—反方」表存在但**没有任何数据行**——表头在、内容空（形态上有表、实质为零）',
      });
      return;
    }
    // **判级只留可确证形态**（v18.27.0 实测校准，第四次沿用同一模式）：
    //   实测某真实项目的「反方/回应」列里写的是**内容本身**（如「回应：承认旧路径失效是本文起点而非终点…」），
    //   而不是锚点——把这类**散文式单元格**判 P1 会重演 C-Redundancy 的错（规格字面看起来对、却判了正当写法）。
    //   三条判定：① 空/占位 → **P1**（缺锚点，确定）；② 像锚点（短、无句末标点）但解析不到 → **P1**（指向不存在，确定）；
    //   ③ **散文式单元格**（>30 字或含 。；）→ **P2 候选**（「疑似把反方内容写在锚点列」——这算不算合规是语义问题，归 T6/T7）。
    const isProse = (v) => [...v].length > 30 || /[。；]/.test(v);
    const issues = [];
    for (const r of rows) {
      const label = (r.论点 || `第${r.line}行`).slice(0, 24);
      for (const [k, v] of [['反方', r.反方], ['回应', r.回应]]) {
        if (!v || /^[-—–/\s]+$/.test(v)) { issues.push({ line: r.line, severity: 'P1', reason: `「${label}」缺${k}锚点` }); continue; }
        if (isProse(v)) { issues.push({ line: r.line, severity: 'P2', reason: `「${label}」的${k}列疑似写了**内容**而非锚点（${v.slice(0, 20)}…）——须 T6/T7 判定该写法是否可接受` }); continue; }
        if (!resolveAnchorIn(v, text)) issues.push({ line: r.line, severity: 'P1', reason: `「${label}」的${k}锚点「${v.slice(0, 30)}」在被审正文的标题里找不到对应段落` });
      }
    }
    const p1 = issues.filter((x) => x.severity === 'P1');
    results.push({
      gate: 'M-Exist-11 反方论证闭合（论点—证据—反方表）',
      pass: p1.length === 0,
      severity: p1.length > 0 ? 'P1' : (issues.length > 0 ? 'P2' : '通过'),
      detail: p1.length > 0
        ? `${issues.length} 处锚点问题（P1 ${p1.length} / P2 候选 ${issues.length - p1.length}）：` + issues.slice(0, 3).map((x) => `L${x.line} ${x.reason}`).join('；')
        : (issues.length > 0
          ? `${issues.length} 处 **P2 候选**（无 P1）：` + issues.slice(0, 2).map((x) => `L${x.line} ${x.reason}`).join('；')
          : `表 ${rows.length} 行，反方/回应锚点齐全且均能在被审正文标题里定位（**「核心论点是否收全」属语义判断，归 T6/T7**）`),
      ...(issues.length ? { anchorIssues: issues } : {}),
    });
  } catch (e) {
    results.push({
      gate: 'M-Exist-11 反方论证闭合（论点—证据—反方表）',
      pass: 'SKIP', severity: 'LLM 兜底',
      detail: `本项执行异常（${e && e.message ? e.message : e}）——按「未检」记，不得当通过`,
    });
  }
}
