// M-Exist 门族（v18.3.1 审计 B2 阶段 1：从 m-gate-check.mjs 抽离为门模块，行为逐字等价——
//   run/ 49 组真实项目 baseline（exit + stdout/report sha256）对账）。主脚本构建 ctx 后按原
//   result 顺序调用：mExist1 → M-Form-10/11（仍在主脚本）→ mExist4..mExist10 → mExist2 → mExist3。
//   每个门函数只读 ctx 共享态并往 ctx.results 推结果；模块不持有跨门可变态。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { basename, join, dirname } from 'node:path'
import { refsOf, dataCardIds } from '../refs.mjs'
import { latestReport, tableCells, isSeparatorRow, walkMd, sectionRange } from '../mgate-helpers.mjs'

// === M-Exist-1 文末四节双向对比（v2.5.2-dsh.5 脚本化 + 严重度评级）===
export function mExist1(ctx) {
  const { firstIdx, bodyProse, endnote, refRe, norm, THRESHOLDS, results, draftPath } = ctx;
if (firstIdx === -1) {
  results.push({ gate: 'M-Exist-1 引用双向对比', pass: 'SKIP', detail: '文末缺失，M-Form-2 失败优先', severity: 'SKIP' });
} else {
  const intext = new Set((bodyProse.match(refRe) || []).map(norm));
  const endRefs2 = new Set((endnote.match(refRe) || []).map(norm));
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
  const mExist1Hard = leaked.length + orphan2.length + nonStd.length > 0;
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
    pass: !mExist1Hard || (leaked.length + hardOrphans.length) === 0,
    detail: [
      mExist1Hint,
      `漏引 ${leaked.length} / 硬孤儿 ${hardOrphans.length}（[先NN] 对照孤儿 ${xianOrphans.length} 个已软处理）`,
      preservedHint,
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
      : ((nonStd.length > 0 || extUsed > 0 || xianOrphans.length > 0) ? 'P2' : '通过'),
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
  const review = latestReport(auditsDir, '复核报告');
  const revNotes = existsSync(join(projectDir2, 'drafts'))
    ? readdirSync(join(projectDir2, 'drafts')).filter((f) => /^修订说明-.*\.md$/.test(f)) : [];

  if (!audit) {
    results.push({ gate: 'M-Exist-4 审计条目闭环', pass: true, detail: 'N/A：尚无审计报告（未进入 Phase 4）', severity: '通过' });
  } else {
    const text = readFileSync(audit.path, 'utf8');
    const lines = text.split('\n');
    // v18.8.x 反哺补丁（2026.09.22）：isReject 旧版扫**全文**找「打回」——复核轮（第 2 轮）报告
    //   在叙述第 1 轮历史时必然提到「打回」（如「A 轨第 1 轮打回 → v3 修订 → 第 2 轮通过」），
    //   被误判为「本报告结论=打回」→ 强索修订任务书 → 假 P1（实战：T7 第 2 轮通过报告仍被报
    //   「结论为打回但缺修订任务书」）。修法：只在**结论行**（含「结论/判定/verdict」的行，
    //   含其紧邻的加粗行）里判；无结论行时回退前 30 行。复核轮结论含「通过」即压过叙述性「打回」。
    const conclIdx = lines.map((l, i) => (/结论|判定|verdict/i.test(l) ? i : -1)).filter((i) => i >= 0);
    const scope4 = conclIdx.length ? conclIdx.map((i) => lines[i]) : lines.slice(0, 30);
    const hasPass = scope4.some((l) => /复核通过|通过\s*[✅）)]|结论[：:]\s*[✅]?\s*通过|判定[：:]\s*[✅]?\s*通过/.test(l));
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
        if (!header && cells.some((c) => c.includes('编号'))) { header = cells; continue; }
        if (header) rows.push(cells);
      }
    }
    const colOf = (kw) => (header || []).findIndex((h) => kw.test(h));
    const iId = colOf(/编号/), iSev = colOf(/严重度/), iLoc = colOf(/改哪里|位置/), iAct = colOf(/怎么改|动作/), iAcc = colOf(/验收/), iStat = colOf(/关闭状态|状态/);
    const findings = [];
    const soft = [];
    if (isReject) {
      if (hIdx === -1 || !header) findings.push('结论为「打回修订」但缺「## 修订任务书」段或表格表头');
      else if ([iId, iSev, iLoc, iAct, iAcc, iStat].some((x) => x === -1)) {
        findings.push(`修订任务书缺必需列（现表头：${header.join(' / ')}）——需含 编号/严重度/改哪里/怎么改/验收标准/关闭状态`);
      } else {
        const ids = [];
        for (const r of rows) {
          if (!r[iId] || /^\.+$/.test(r[iId])) continue;
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
        if (review) {
          const rid = new Set([...readFileSync(review.path, 'utf8').matchAll(/P[012][-\u2011]?[0-9A-Da-d]+/g)].map((m) => m[0].replace(/\u2011/g, '-')));
          const miss = [...new Set(ids)].filter((x) => !rid.has(x.replace(/\u2011/g, '-')));
          if (miss.length) findings.push(`复核报告 ${review.name} 未覆盖 ${miss.length} 个审计编号：${miss.slice(0, 5).join(',')}`);
        } else if (revNotes.length) {
          findings.push(`已有修订说明（${revNotes.length} 份）但缺同号复核报告——修订复核必须落盘 audits/复核报告-v${audit.n}.md`);
        }
      }
    }
    const hard = findings.length > 0;
    results.push({
      gate: 'M-Exist-4 审计条目闭环',
      pass: !hard && soft.length === 0,
      detail: [
        `审计报告 ${audit.name}${review ? ` ↔ 复核报告 ${review.name}` : '（无复核报告）'}`,
        isReject ? (header ? `任务书 ${rows.length} 行` : '结论为打回') : '结论非打回（无需任务书）',
        hard ? `硬问题：${findings.slice(0, 3).join('；')}` : '条目契约与闭环成立',
        soft.length ? `软提示：${soft.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard ? (findings.length > 2 ? 'P0' : 'P1') : (soft.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-4 审计条目闭环', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
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
    results.push({ gate: 'M-Exist-5 阶段闸门记录表', pass: true, detail: 'N/A：尚无审计报告（未进入 Phase 4，闸门记录留待 T7.5）', severity: '通过' });
  } else if (!auditsDir5) {
    results.push({ gate: 'M-Exist-5 阶段闸门记录表', pass: false, detail: '找不到 audits/ 目录，无法定位闸门记录', severity: 'P1' });
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
    let handoffSeen5 = false;  // v18.12.0（L-10）：两份记录里是否写过交接门 handoff-check 的 exit
    let recordsFound5 = 0;     // v18.12.0：实际解析到的闸门记录份数（缺文件已在循环内单独报，不再叠加）
    for (const gateId of ['T2.5', 'T7.5']) {
      const fp = join(auditsDir5, `闸门记录-${gateId}.md`);
      if (!existsSync(fp)) {
        findings5.push(`缺 audits/闸门记录-${gateId}.md（${gateId === 'T2.5' ? 'T2 数据检索 → T4 前' : 'T7 审计 → T8 终检前'}的闸门无落盘留痕）`);
        continue;
      }
      const ls5 = readFileSync(fp, 'utf8').split('\n');
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
          } else handoffSeen5 = true;
        }
        if (/M\s*门/.test(item)) {
          // ① 实据里的 `exit N` 必须等于报告的机械值（防「写个像证据的字符串」）
          const mExit = ev.match(/exit\s*[=:：]?\s*(\d+)/i);
          if (!repPath5) {
            findings5.push(`${gateId}「${item}」判 ✓，但未找到 final/M-Gate-Report.json——结论无产物可核（实据绑定失败）`);
          } else if (rj5) {
            if (mExit && Number(mExit[1]) !== mechExit5) {
              contradict5 = true;
              findings5.push(`${gateId}「${item}」实据写 exit=${mExit[1]}，而 M-Gate-Report.json 的机械值 script_exit_raw=${mechExit5}——实据与产物不符（P0）`);
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
      }
    }
    // v18.12.0（L-10）：v18.6.0 规定两道闸门记录须写交接门 `handoff-check` 的 exit（20/21/22）。
    //   审计实测：20 个真实项目里只有 1 个真跑过，而机检**从不检查**这一条（规则写着「不写 = 判 P1」）。
    //   落地口径（**有意选择，非疏漏**）：① 行内**提到** handoff 却未给 exit → 硬问题（上面已按行判，精确）；
    //   ② 两份记录**都没提** handoff → 记 **noteBits**（可见、但不改 pass）。理由：把②做成 P1/P2 会让
    //   所有既有形态（含十数个历史项目的记录）一律非通过，属「对历史形态过度收紧」——「不写就红」的
    //   代价应由主人权衡后再定；此处先保证**看得见**。详见修订记录 §未做项。
    if (recordsFound5 > 0 && !handoffSeen5) {
      noteBits5.push('两份闸门记录均未写交接门 handoff-check 的 exit（v18.6.0 规定必写：`handoff-check --role Tn → exit 0/20/21/22`）——本条为信息性提示，未计入 pass');
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
      ].filter(Boolean).join(' ｜ '),
      severity: hard5 ? (contradict5 || findings5.length > 3 ? 'P0' : 'P1') : (soft5.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-5 阶段闸门记录表', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

}

// === M-Exist-6 审稿报告与期刊匹配（v2.5.2-dsh.17 新增）===
export function mExist6(ctx) {
  const { draftPath, auditsDirOf, skillRoot, results } = ctx;
// 依据：T9 审稿报告的 6 维度评分 + 建议词 + 期刊匹配表此前**零机械校验**——总评分可以是 6 个维度
//   凑不出来的数，期刊推荐可以是《期刊数据库》里根本不存在的刊名，综合匹配度可以不由公式得出。
//   本项做三件事：① 总分 == 6 维之和（算术自洽）；② 建议词与总分区间一致；③ 期刊匹配表**可复算**
//   （综合 = 0.5×主题 + 0.3×风格 + 0.2×归一化，容差 ±1.5）且刊名出自 `期刊数据库.md`。
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
    results.push({ gate: 'M-Exist-6 审稿报告与期刊匹配', pass: true, detail: 'N/A：无审稿报告（T9 未启用或未到 Phase 4.5）', severity: '通过' });
  } else {
    const rt = readFileSync(latest6.path, 'utf8');
    const findings6 = [];
    const soft6 = [];
    const DIMS = ['原创性', '方法论', '证据强度', '论证结构', '写作质量', '引文规范'];
    const dimScores = [];
    for (const d of DIMS) {
      // v18.5.1（反哺报告-v1 B3 补深，主人授权修订）：支持小数半分制（4.0 / 3.5 / 4.5）——实战 T9 打半分，
      //   旧正则 `(\d)` 对「4.0/5」回溯错取 0、对「3.5/5」错取 5 → 维度和失真；总评 24.5 同理失配。
      const m = rt.match(new RegExp(`${d}[^\\n]*?(\\d(?:\\.\\d)?)\\s*/\\s*5`)) || rt.match(new RegExp(`${d}\\s*\\|\\s*(\\d(?:\\.\\d)?)\\s*/\\s*5`));
      if (!m) soft6.push(`未找到「${d}」的 x/5 评分（模板 6 维须齐全）`);
      else dimScores.push(Number(m[1]));
    }
    const total6 = rt.match(/总评分[^\d]{0,8}(\d{1,2}(?:\.\d)?)\s*\/\s*30/) || rt.match(/总分[^\d]{0,12}(\d{1,2}(?:\.\d)?)\s*\/\s*30/);
    const declaredTotal = total6 ? Number(total6[1]) : null;
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
      let dbText = '';
      // v18.2.6 审计修复 P1-7：旧写法 `catch { /* 降级 */ }` 让「刊名数据库读不到」与
      //   「刊名都在库里」在输出里完全同形 —— 「杜撰刊名」这条检查**静默失效**而报告照常显示
      //   「评分自洽、期刊匹配可复算」。现按既有做法记入 soft6，并说明该子检查已降级。
      try { dbText = readFileSync(join(skillRoot, 'references', '_shared', '期刊数据库.md'), 'utf8'); }
      catch (e) { soft6.push(`期刊数据库（references/_shared/期刊数据库.md）读取失败 → 「杜撰刊名」检查已降级为本项跳过：${e.message}`); }
      const pct = (s) => { const m = String(s || '').match(/(\d+(?:\.\d+)?)\s*%/); return m ? Number(m[1]) : null; };
      for (const r of jRows) {
        const name = (r[0] || '').replace(/[*《》\s]/g, '');
        if (!name) { findings6.push('期刊匹配表有行缺刊名'); continue; }
        if (dbText && !dbText.includes(name.slice(0, Math.max(2, name.length - 1)))) {
          soft6.push(`「${r[0]}」在 期刊数据库.md 中查不到（疑似杜撰刊名，须以数据库为准）`);
        }
        const comp = pct(r[iComp]), theme = pct(r[iTheme]), style = pct(r[iStyle]);
        if (comp === null || theme === null || style === null) {
          findings6.push(`「${r[0]}」匹配度列缺百分比（综合/主题/风格都要有）`);
        } else if (declaredTotal !== null) {
          const normScore = Math.max(0, Math.min(1, (declaredTotal - 16) / 14));
          const expectComp = 0.5 * theme + 0.3 * style + 0.2 * normScore * 100;
          if (Math.abs(comp - expectComp) > 1.5) {
            findings6.push(`「${r[0]}」综合匹配度 ${comp}% ≠ 复算值 ${expectComp.toFixed(1)}%（=0.5×${theme} + 0.3×${style} + 0.2×${(normScore * 100).toFixed(1)}）——数字不可复算`);
          }
        }
        if (iCycle !== -1 && !/[0-9]/.test(r[iCycle] || '')) soft6.push(`「${r[0]}」审稿周期为空或无数值`);
        if (iWhy2 !== -1 && (r[iWhy2] || '').replace(/[\s.。…-]/g, '').length < 6) soft6.push(`「${r[0]}」推荐理由过短（须含主题契合 + 风格契合 + 周期依据）`);
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
      if (sugItems.length === 0) soft6.push('「修改建议」段无有效条目（须按优先级逐条列）');
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
        soft6.length ? `软提示：${soft6.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard6 ? (findings6.length > 2 ? 'P0' : 'P1') : (soft6.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-6 审稿报告与期刊匹配', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
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
    results.push({ gate: 'M-Exist-7 交付说明字段齐备', pass: true, detail: 'N/A：尚无 final/交付说明.md（T8 尚未开始交付）', severity: '通过' });
  } else {
    const dt = readFileSync(ddPath, 'utf8');
    const dl = dt.split('\n');
    const findings7 = [];
    const soft7 = [];
    for (const [label, re] of FIELD_KEYWORDS) {
      const i = dl.findIndex((l) => /^#{1,6}\s|^\s*\*\*|^\s*\|/.test(l) && re.test(l));
      if (i === -1) { findings7.push(`缺固定字段「${label}」（deliverables.md 定为必填）`); continue; }
      // 字段正文 = 到下一个标题/表头行为止
      let j = dl.length;
      for (let k = i + 1; k < dl.length; k++) { if (/^#{1,6}\s/.test(dl[k])) { j = k; break; } }
      const raw7 = dl.slice(i + 1, j).join('\n');
      const bodyTxt = raw7.replace(/<[^>]*>/g, '').replace(/[|\s\-—–:：]/g, '');
      // ① 仍含 <…> 模板占位符 → 该字段没填（模板明确要求不得留占位符）
      // ② 去掉占位符后为空 → 阈值 1（允许「无」「未启用」这类**合法的一句话答复**）
      if (/<[^>]{1,60}>/.test(raw7)) findings7.push(`字段「${label}」仍含模板占位符（<…> 未填）`);
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
    if (!/\[哈希校验待主人回填\]|sha256\s*[:：]?\s*[0-9a-f]{16,}/i.test(dt)) {
      findings7.push('缺「证据包指纹」段或 sha256 占位符 `[哈希校验待主人回填]`（M-Integrity-2 步骤 4 的输入）');
    }
    const dec = dl.findIndex((l) => /主人决策记录/.test(l));
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
        `12 固定字段（11 关键词字段 + 证据包指纹）实到 ${FIELD_KEYWORDS.length - findings7.filter((x) => x.startsWith('缺固定字段')).length}/${FIELD_KEYWORDS.length}${/\[哈希校验待主人回填\]|sha256\s*[:：]?\s*[0-9a-f]{16,}/i.test(dt) ? ' + 证据包指纹✓' : ' + 证据包指纹✗'}`,
        hard7 ? `硬问题：${findings7.slice(0, 3).join('；')}` : '固定字段齐备且有内容',
        soft7.length ? `软提示：${soft7.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard7 ? (findings7.length > 3 ? 'P0' : 'P1') : (soft7.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-7 交付说明字段齐备', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
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
    results.push({ gate: 'M-Exist-8 批判报告覆盖', pass: true, detail: 'N/A：无批判报告（轻量档跳过 Phase 3.6 或尚未到该阶段）', severity: '通过' });
  } else {
    const rt8 = readFileSync(latestRevPath.path, 'utf8');
    const rl8 = rt8.split('\n');
    const CIDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
    // 认标题 / 加粗标签 / 列表项 / 表格行四种写法（避免因格式差异误判「漏节」）
    const cLine = (c) => new RegExp(`^(?:#{1,6}\\s*|[-*]\\s*|\\|\\s*)?\\*{0,2}${c}(?![0-9])\\b`);
    const headLine = (c) => new RegExp(`^#{2,4}\\s*\\*{0,2}${c}(?![0-9])\\b`);
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
  results.push({ gate: 'M-Exist-8 批判报告覆盖', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

}

// === M-Exist-9 审计报告 G 项覆盖（v2.5.2-dsh.17 新增）===
export function mExist9(ctx) {
  const { auditsDirOf, results } = ctx;
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
    results.push({ gate: 'M-Exist-9 审计报告 G 项覆盖', pass: true, detail: 'N/A：尚无审计报告（未进入 Phase 4）', severity: '通过' });
  } else {
    const at9 = readFileSync(latest9.path, 'utf8');
    const G_MAIN = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14'];
    const G_SUB9 = ['G0.5', 'G2.5', 'G4-2'];
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
    if (absentSub9.length) soft9.push(`子项未覆盖：${absentSub9.join(',')}`);
    const hard9 = findings9.length > 0;
    results.push({
      gate: 'M-Exist-9 审计报告 G 项覆盖',
      pass: !hard9 && soft9.length === 0,
      detail: [
        `${latest9.name}｜G0-G14 实到 ${G_MAIN.length - absent9.length}/15${noEvidence9.length ? `（${noEvidence9.length} 项结论无实据）` : ''}`,
        hard9 ? `硬问题：${findings9[0]}` : (noEvidence9.length ? '十五项已覆盖且各有结论，部分结论缺实据' : '十五项全覆盖、各有结论与实据'),
        soft9.length ? `软提示：${soft9.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard9 ? (absent9.length > 3 ? 'P0' : 'P1') : (soft9.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Exist-9 审计报告 G 项覆盖', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
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
      pass: true,
      detail: 'N/A 且**未检**：未找到 analysis/分析大纲.md（若为轻量档主动省 T4，须按 SKILL.md 连带规则：主控代产最小 §11 精简段，或在 status.md + final/局限性.md 显式记豁免）',
      severity: 'P2',
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
  results.push({ gate: 'M-Exist-10 大纲 §11 精简段', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
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
    detail: 'N/A：证据包为空且被审对象位于 drafts/（Phase ≤4 审计场景）——证据包由 T8 终检的 build-evidence-bundle.mjs 生成，届时重跑本项自动转实检',
    severity: '通过',
  });
} else {
  results.push({
    gate: 'M-Exist-2 证据包完整性',
    pass: files.length > 0 && empty.length === 0 && !layoutAnomaly,
    detail:
      `${files.length} 个 .md 文件` +
      (empty.length ? `，空文件: ${empty.map(relOf).join(',')}` : '，无空文件') +
      (layoutAnomaly ? ` ｜ 布局异常（P1）：${layoutAnomaly}` : ''),
    severity: (files.length === 0 || empty.length > 0) ? 'P0' : (layoutAnomaly ? 'P1' : '通过'),
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
  results.push({
    gate: 'M-Exist-3 引用闭环',
    pass: missing.length === 0,
    detail: missing.length ? `正文引 [Dxx] ${missing.length} 条在数据卡中无对应条目` : '全部 [Dxx] 在数据卡有对应',
    severity: mExist3Sev,
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

