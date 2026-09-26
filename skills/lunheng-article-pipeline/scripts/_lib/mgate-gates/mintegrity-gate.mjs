// M-Integrity-1 T2.5 完整性门（v18.3.1 审计 B2 阶段 1：从 m-gate-check.mjs 抽离，行为逐字等价——
//   run/ 49 组真实项目 baseline 对账）。简报解析失败/缺卡的处理口径与抽离前一致（含
//   「简报路径与正文相同 → exit 10」的进程级退出，主进程已装 exit-guard）。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { dataCardIds } from '../refs.mjs'
import { sectionBody } from '../sections.mjs'

// === M-Integrity-1 T2.5 完整性门（脚本佐证；v2.5.2-dsh.17 补两次关键对账）===
export function mIntegrity1(ctx) {
  const { draftPath, dataCard, dataCardReadError, results, findBriefUpward, projectRoot } = ctx;
// 自省审计发现：旧版只核「任务简报存在且有子问题」，严重度恒为 'LLM 兜底' → **永不 P0/P1**；
//   而 M-Gate-Algorithm 的 M-Integrity-1 明写「单子项失败 P0（信任级别缺失 / 数据条目不足）」——
//   文档承诺的 P0 在脚本里不可达，「佐证」等于什么也没佐证。现补两次对账（文档步骤 2-6 口径）：
//     ① 数据条目数（[Dxx] 编号并集 ∪ 表格 `| 1.x |` 行）≥ 任务简报「需找数据点」之和 → 不足 P0
//     ② 数据卡缺失 → P0；数据卡存在但 M-Form-6（独立信任级别段）未过 → P0
//   仍保留「最终由主控 L4 跨文件判断」的定位：脚本只判这两项可机械化的对账。
// v18.2.6：`parseError` 保留「解析异常」（与「简报确实不存在」区分开）；`hasResearchSection` 区分
//   「简报没有研究问题段」（门是对的，只是文案要准）与「有段但没解析出子问题」（门漏判，须修解析）。
let briefData = {
  hasBrief: false, subclaims: 0, minDataPoints: 0, placeholder: 0,
  parseError: null, hasResearchSection: null, subclaimsSource: '未解析', subclaimsTrace: '',
};
try {
  // v18.0.0 修复（P0-3）：旧实现 `draftPath.replace(/final[\\/]定稿\.md$/, '01-任务简报.md')`
  //   **只对 `final/定稿.md` 生效**；被审对象为 `drafts/初稿-vN.md` 时替换不命中 → briefPath 退回初稿自身路径
  //   → 把初稿当简报读 → ① 常驻误报「研究问题段缺失」；② needsT2=0 使「数据条目 ≥ 需求」比较短路
  //   → **该门在 Phase 4 场景事实上静默失效**（实战：本轮审计 drafts/初稿-v1.md 时即如此，因数据远超需求而侥幸无损失）。
  // v18.0.2：实现提到模块级（findBriefUpward），供 M-Form-9 复用——同一 bug 的第二份拷贝已一并修掉。
  const briefPath = findBriefUpward(dirname(draftPath));
  // 自检：解析结果不得与被审正文同路径（同路径 = 「把正文当简报读」）→ 直接报参数/解析错误，禁止静默降级
  if (briefPath && briefPath === draftPath) {
    console.error(
      `M-Integrity-1 解析错误：任务简报路径与被审正文相同（${briefPath}）\n` +
        `  —— 说明未能在项目目录中找到 01-任务简报.md，请检查项目目录结构（应为 run/<项目名>/01-任务简报.md）`,
    );
    process.exit(10);
  }
  if (briefPath && existsSync(briefPath)) {
    briefData.hasBrief = true;
    briefData.briefPath = briefPath; // 留痕：供报告与复核追溯简报真源
    const briefText = readFileSync(briefPath, 'utf8');
    // === 子问题解析（v18.2.6 审计修复 P1-7；实测根因）===
    // 旧实现只认「子问题 A/B/C」（v2.5.2-dsh.5 模板规范）与「S1/S2」（v2.5.2-dsh.4 旧表格格式）
    //   —— 即**编号必须写在「子问题」之后**。但主控手写简报最常见的是**数量在前的声明式写法**：
    //     `## 研究问题（主控拆解，4 个子问题）`
    //   （实测 `<项目根>/run/<项目名>/01-任务简报.md` 正是此形，段内 1.-4. 四条子问题俱全）
    //   → 旧正则一条都匹配不到 → `subclaims = 0` → 该门恒报「任务简报未见子问题（研究问题段缺失）」，
    //   而简报本身完整、数据需求也齐备 → **detail 文案把主控引向「去补研究问题段」的错误动作**。
    // 现三层口径（各算一次，取**最大**者；宁可偏严，且该值只用于「是否 >0」与展示）：
    //   ① 逐子问题标签：`子问题 A/B/C` ∪ `S1/S2`（原口径，逐字不变）；
    //   ② 声明式数量：`… 4 个子问题` / `四个子问题`（阿拉伯或单个中文数字）；
    //   ③ 段内条目回退：「研究问题」段里的顶层有序/无序条目数（模板要求 3-5 个子问题）。
    const letterSub = [...briefText.matchAll(/子问题\s*([A-Z一二三四五六七八九十\d]+)/g)].map((m) => m[1]);
    const sSub = [...briefText.matchAll(/^[\s|]*S(\d+)\s/gm)].map((m) => `S${m[1]}`);
    const subByLabel = new Set([...letterSub, ...sSub]).size;
    const CN_DIGIT = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const declaredSub = briefText.match(/([0-9一二三四五六七八九十两]{1,2})\s*个子问题/);
    const subByDeclared = declaredSub
      ? (/^\d+$/.test(declaredSub[1]) ? Number(declaredSub[1]) : (CN_DIGIT[declaredSub[1]] || 0))
      : 0;
    const researchSection = sectionBody(briefText, '研究问题');
    const subBySectionItems = researchSection === null
      ? 0
      : researchSection.split('\n').filter((l) => /^\s*(?:\d+[.、)]|[-*]\s)/.test(l) && l.replace(/[\s\-*\d.、)]/g, '').length > 4).length;
    briefData.hasResearchSection = researchSection !== null;
    briefData.subclaims = Math.max(subByLabel, subByDeclared, subBySectionItems);
    briefData.subclaimsSource = briefData.subclaims === subByLabel ? '子问题标签'
      : (briefData.subclaims === subByDeclared ? '声明数量「N 个子问题」' : '研究问题段内条目');
    briefData.subclaimsTrace = `标签 ${subByLabel} / 声明 ${subByDeclared} / 段内条目 ${subBySectionItems}`;
    // 需找数据点：已填数字「≥N」求和；占位符「≥____」单列计数（模板未填时如实提示，而非误报 0）
    // v18.2.1：**容忍「需找数据点：≥ 3」这类带冒号/破折号的写法**——模板给的是无冒号形态，
    //   但主控手写简报时极易补一个冒号，旧正则 `需找数据点\s*[≥>]` 在「…点：≥」上直接失配
    //   → 需求总数记 0 → M-Integrity-1 假报「任务简报未见数据需求」（本轮实测踩到）。
    // v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
    //   **修「同一需求写两处 → 双重计数」假 P0**——`任务简报-template.md` **自身规定**「需找数据点 ≥N」写两处：
    //     ① 研究问题段：逐子问题各一条（模板 4-5 条）；
    //     ② 数据/文献/案例需求段：写总量一条（模板「**数据**（需找数据点 ≥N）」）。
    //   旧实现把两处的匹配**一律求和** → 实测 3+6+8（子问题）+ 25（总量）= **42**，
    //   而作者声明的真实需求是 **25** → 数据卡 32 条被判「32 < 42 条」→ T2.5 步骤 4 触发
    //   「数据不完整 → 触发 T2 重检索」**假 P0**（M 门 exit 2 永不可解，T8 只能写 Acknowledged Limitations）。
    //   现规则：**按「行归属」分组，取两组之和的较大者**——
    //     ① `agg`    = 不在「子问题」行上的需求量之和（= 需求段声明的总量）；
    //     ② `scoped` = 在「子问题」行上的需求量之和（= 逐子问题的分配量）；
    //     需求 = max(agg, scoped)；两组皆空 → 0（如实报「未见数据需求」，不臆造）。
    //   取 max 而非「总量优先」的理由：作者把分配量写得比声明总量更大时，按更严的一方对账
    //   ——宁可要求偏严，也不产生「假通过」。
    const NEED_RE = /需找数据点[^\d≥>]{0,4}[≥>]\s*(\d+)/g;
    const needSum = (lines) => lines
      .flatMap((l) => [...l.matchAll(NEED_RE)])
      .map((m) => parseInt(m[1], 10)).reduce((a, b) => a + b, 0);
    const briefLines = briefText.split('\n');
    const aggNeed = needSum(briefLines.filter((l) => !/子问题/.test(l)));
    const scopedNeed = needSum(briefLines.filter((l) => /子问题/.test(l)));
    briefData.minDataPoints = Math.max(aggNeed, scopedNeed);
    briefData.needAgg = aggNeed;        // 留痕：需求段声明的总量
    briefData.needScoped = scopedNeed;  // 留痕：逐子问题分配量之和
    briefData.needSource = aggNeed === 0 && scopedNeed === 0
      ? '未声明'
      : (aggNeed >= scopedNeed ? '需求段总量' : '逐子问题分配量之和');
    briefData.placeholder = (briefText.match(/需找数据点[^\d≥>]{0,4}[≥>]\s*_+/g) || []).length;
  }
} catch (e) {
  // v18.2.6 审计修复 P1-7（**本批最关键的一处**）：旧写法 `catch {}` 把**整个简报解析块**的异常
  //   无条件吞掉 —— 实测后果是 severity 退化为「LLM 兜底」、detail 还会写成
  //   「任务简报不存在」，把「脚本解析失败」误导成「简报确实没写」。现如实留痕：
  //   `briefData.parseError` 在下面的 M-Integrity-1 结果里**必现**，且与「简报不存在」用不同文案。
  briefData.parseError = e.message;
}
{
  // ① 数据条目数（双格式并集；与 M-Gate-Algorithm M-Integrity-1 步骤 2 同口径）
  let dataEntries = 0;
  let dataCardN = 0;
  let caseSetN = 0;
  if (dataCard) {
    const idSet = new Set(dataCardIds(dataCard));
    const tableRows = (dataCard.match(/^\|\s*\d+\.\d+\s*\|/gm) || []).length;
    dataCardN = idSet.size + tableRows;
  }
  // v18.5.1（反哺报告-v1 改动 3，主人授权修订）：数据条目统计**纳入 `data/撤稿案例数据集.md` 的 [D-CASExx] 编号**——
  //   实战（2026-09-22 ai-content-farm-retractions）：30 条案例集中在该文件、数据卡仅 12 条宏观数据，
  //   旧口径「只读数据卡」把「56 > 52 满足」误报为「12 < 38 不足」→ 假 P0 触发不存在的 T2 重检索。
  //   仅当该文件存在时追加计数（不存在 → 行为与旧版逐字等价，run/ 49 组 baseline 不受影响）；读取失败按 0 计并在下方留痕。
  let caseSetReadError = null;
  try {
    const caseSetPath = join(projectRoot ?? dirname(dirname(draftPath)), 'data', '撤稿案例数据集.md');
    if (existsSync(caseSetPath)) {
      caseSetN = new Set([...readFileSync(caseSetPath, 'utf8').matchAll(/\[D-CASE\d+\]/g)].map((m) => m[0])).size;
    }
  } catch (e) { caseSetReadError = e.message; }
  dataEntries = dataCardN + caseSetN;
  const needsT2 = briefData.minDataPoints;
  const mForm6 = results.find((r) => r.gate.startsWith('M-Form-6'));
  const mForm6Bad = !!mForm6 && mForm6.pass !== true;
  const hardWhy = [];
  // v18.2.6（P1-7）：解析异常单列一条，文案与「简报不存在」**明确区分**（旧版两者同形 → 误导）
  if (briefData.parseError) {
    hardWhy.push(`任务简报解析失败（**不是**「简报不存在」；本门子检查已跳过、严重度不再退化为 LLM 兜底）：${briefData.parseError}`);
  }
  if (!briefData.hasBrief) hardWhy.push('任务简报缺失（无「需找数据点」可比对）');
  else if (briefData.subclaims === 0) {
    // v18.2.6：文案按「简报里到底有没有研究问题段」分两种，并附三层解析的中间量（可事后核对）
    hardWhy.push(briefData.hasResearchSection === false
      ? '任务简报未见「## 研究问题（主控拆解，3-5 个子问题）」段（模板规定必填段）'
      : `研究问题段存在但未能解析出子问题（三层口径 标签/声明数量/段内条目 均未命中：${briefData.subclaimsTrace}）`);
  }
  if (dataCard && needsT2 > 0 && dataEntries < needsT2) {
    hardWhy.push(`数据条目 ${dataEntries} 条 < 简报需求 ${needsT2} 条（T2.5 步骤 4：数据不完整 → 触发 T2 重检索）`);
  }
  if (!dataCard) hardWhy.push(dataCardReadError
    ? `数据卡读取失败（**不是**「数据卡不存在」）：${dataCardReadError.message}（T2.5 步骤 1）`
    : '数据卡不存在（T2.5 步骤 1）');
  if (mForm6Bad) hardWhy.push('信任级别不完整（M-Form-6 未过 → T2.5 步骤 5）');
  // 「简报缺失 / 缺研究问题段」属差序输入，只记 LLM 兜底；数据侧三项 = 文档承诺的 P0。
  // v18.2.6：新增两类「脚本自身没能核到位」的情形（简报解析失败 / 数据卡读取失败）——它们既不是
  //   「内容缺陷」（不该判 P0 阻断交付），也不是「可交给 LLM 兜底的差序输入」（LLM 看不到脚本异常）
  //   → 记为 P1 硬失败，使「跳过」必定出现在 p1 计数里而不是无声无息。
  const SCRIPT_SKIP_RE = /任务简报缺失|未见「## 研究问题|未能解析出子问题|解析失败|数据卡读取失败/;
  const hardHits = hardWhy.filter((w) => !SCRIPT_SKIP_RE.test(w)).length;
  const scriptSkipHits = hardWhy.filter((w) => /解析失败|数据卡读取失败/.test(w)).length;
  results.push({
    gate: 'M-Integrity-1 T2.5 完整性',
    pass: hardWhy.length === 0,
    detail: briefData.parseError
      ? hardWhy.join(' ｜ ')   // 解析异常：只报异常本身，不假装拿到了简报数据
      : briefData.hasBrief
        ? `任务简报 ${briefData.subclaims} 子问题（口径：${briefData.subclaimsSource}） / 需找数据点 ${needsT2} 条${briefData.placeholder ? `（${briefData.placeholder} 处占位未填）` : ''}｜数据条目 ${dataEntries} 条（数据卡 ${dataCardN} + 案例集 ${caseSetN}${caseSetReadError ? `；案例集读取失败：${caseSetReadError}` : ''}）`
          + (hardWhy.length ? ` ｜ 硬问题：${hardWhy.slice(0, 2).join('；')}` : ' ｜ 条目数与信任级别对账通过（脚本佐证，主控 L4 跨文件判断）')
        : '任务简报不存在（**已确认未找到 01-任务简报.md**，脚本佐证，主控 L4 跨文件判断）',
    severity: hardHits > 0 ? 'P0' : (scriptSkipHits > 0 ? 'P1' : 'LLM 兜底'),
  });
}

}

