// M-Form 门族（v18.3.1 审计 B2 阶段 2：从 m-gate-check.mjs 抽离，行为逐字等价——run/ 49 组
//   真实项目 baseline（exit + stdout/report sha256）对账）。主脚本构建 ctx 后按原 results 顺序调用：
//   mForm2 → mForm7 →（主文件计算 body/endnote/prose 并挂 ctx）→ mForm1/3/5/4/6/8/9 →
//   mExist1 → mForm10/11 → mExist4..10/2/3 → mIntegrity1。
//   唯一非逐字变换：mForm6 原以顶层 let dataCard/dataCardReadError 与下游门共享，现改为函数尾
//   回写 ctx（下游 mForm9 / M-Exist-3 / M-Integrity-1 在其后读 ctx，时序不变）。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { refsOf, dataCardIds } from '../refs.mjs'
import { TRUST_COMPLIANT_RE, TRUST_LOOSE_RE } from '../trust.mjs'
import { splitCard } from '../cards.mjs'
import { ENDNOTE_SECTIONS, h2Headings } from '../sections.mjs'
import { countHan } from '../han.mjs'
import { figurePlaceholders, analyzeSvg, svgTextNumbers, figureNoOf } from '../svg.mjs'
import { indexSection, sectionRange, CARD_SPECS, entryIds, idsByToken } from '../mgate-helpers.mjs'

// v2.5.2-dsh.5 修订：白名单 5 节 + AI 使用声明（M-Form-2 / M-Form-7 一致；原主文件模块级常量随门族迁入）
const WHITELIST = ENDNOTE_SECTIONS;

// === M-Form-2 文末 5 节存在性（v2.5.2-dsh.5 修订：与 M-Form-7 一致）===
export function mForm2(ctx) {
  const { h2s, results } = ctx;
const missingSections = WHITELIST.filter((s) => !h2s.some((h) => h === s || h.startsWith(s)));
results.push({
  gate: 'M-Form-2 文末四节存在性',
  pass: missingSections.length === 0,
  detail: missingSections.length ? `缺失: ${missingSections.join(',')}` : '5 节齐全',
  severity: missingSections.length > 0 ? 'P0' : '通过',
});

}

// === M-Form-7 文末节白名单纯净 + 顺序（v18.0.0 加顺序断言，冲突⑧）===
export function mForm7(ctx) {
  const { h2s, firstIdx, results } = ctx;
let mform7Violations = [];
if (firstIdx === -1) mform7Violations = ['文末无任何白名单节'];
else mform7Violations = h2s.slice(firstIdx).filter((t) => !WHITELIST.some((w) => t === w || t.startsWith(w)));
// v18.0.0 修复（冲突⑧）：旧版只核**成员资格**、不核 `deliverables.md` 行 32-40 规定的**顺序固定**。
//   实战：v1 文末顺序为 数据来源→案例来源→参考文献→先行者文献→AI 使用声明（参考文献错位），
//   M-Form-7 判「全白名单」通过，由 T7 独立扫出（P1-1）。属教训 #139「规范从文档层到执行层断链」同型。
const mform7OrderViolations = [];
if (firstIdx !== -1 && mform7Violations.length === 0) {
  const seq = h2s.slice(firstIdx)
    .map((t) => WHITELIST.findIndex((w) => t === w || t.startsWith(w)))
    .filter((i) => i !== -1);
  const sorted = [...seq].sort((a, b) => a - b);
  if (seq.join(',') !== sorted.join(',')) {
    const actual = seq.map((i) => WHITELIST[i]).join(' → ');
    mform7OrderViolations.push(
      `文末五节顺序违规：实际「${actual}」；规定「${WHITELIST.join(' → ')}」`,
    );
  }
}
results.push({
  gate: 'M-Form-7 文末白名单',
  pass: mform7Violations.length === 0 && mform7OrderViolations.length === 0,
  detail: mform7Violations.length
    ? `违规节: ${mform7Violations.join(',')}`
    : mform7OrderViolations.length
      ? mform7OrderViolations[0]
      : '全白名单且顺序正确',
  severity: mform7Violations.length > 0 ? 'P0' : mform7OrderViolations.length > 0 ? 'P1' : '通过',
});

}

// === M-Form-1 引用标注完整性（v2.5.2-dsh.5 修订：阈值提升 L≥3）===
export function mForm1(ctx) {
  const { bodyProse, refRe, THRESHOLDS, results } = ctx;
const bodyRefs = bodyProse.match(refRe) || [];
const L_count = refsOf(bodyProse, 'L').length;
const min_L = THRESHOLDS.mform1MinL;
let mform1Pass, mform1Detail, mform1Severity;
if (bodyRefs.length === 0) {
  mform1Pass = false;
  mform1Detail = '正文无任何引用标注';
  mform1Severity = 'P0';
} else if (L_count === 0) {
  mform1Pass = false;
  mform1Detail = `学术深度论文文献 [Lxx] = 0（实测 ${bodyRefs.length} 引用全无 L，旧算法阈值过低放过——v2.3.7 §四 P4 L=0 漏检根因）`;
  mform1Severity = 'P0';
} else if (L_count < min_L) {
  mform1Pass = false;
  mform1Detail = `学术深度论文文献 [Lxx] < ${min_L}（实测 L=${L_count}），需补检索加固`;
  mform1Severity = 'P0';
} else {
  mform1Pass = true;
  mform1Detail = `正文引用 ${bodyRefs.length} 处（L ${L_count}，阈值 ≥${min_L}）`;
  mform1Severity = '通过';
}
results.push({ gate: 'M-Form-1 引用标注完整性', pass: mform1Pass, detail: mform1Detail, severity: mform1Severity });

}

// === M-Form-3 临时编号 / 占位符残留（v2.5.2-dsh.17 重写：消除与 M-Exist-1 的重复计）===
export function mForm3(ctx) {
  const { textProse, THRESHOLDS, results } = ctx;
// 自省审计发现：旧实现算的是「正文有、文末无」的编号（orphan = bodyRefs − endRefs），与
//   M-Exist-1 的 leaked **是同一个计算**（同一组变量、同一套阈值档位）→ 两项恒同判，属重复门。
//   「正文 ↔ 文末双向闭环」本就归 M-Exist-1，本项不再重复报。
// 本项回归名字本身：「临时编号残留」= 定稿里残留的**占位符 / 临时标记**——这是此前的**真实空档**：
//   `[待补]` 出现在定稿里不会被任何一项抓到（M-Form-4 的禁止清单里没有它）。
// 边界：编号**位数**不由本项管（`_lib/refs.mjs` 明确允许任意位数，不强制补零）。
const TEMP_MARKERS = [
  [/\[(?:待补|待定|待查|待核|待回查|临时|占位|TBD|TODO|PLACEHOLDER)\]/gi, '临时/占位方括号'],
  // 临时编号本体（errors.md 记的原始形态）：`[L_TBD-1]` / `[D_占位]` / `[L-新1]`
  // —— 排除合法形态：
  //   ① `[C-主01]`（主人洞察）
  //   ② `[D-基-{类别}-{序号}]`（glossary §三 v2.3.7 正式基线编号格式，必须保留）
  //   ③ `[C-空]`（0 条空卡协议规定标记）
  //   ④ 纯数字后缀（`[L01-2]` 版本后缀是允许的）
  //   ⑤ `[D-CASExx]`（撤稿案例数据集编号，2026-09-22 反哺报告-v1 修复：实战 65 处假 P0——
  //      与 v18.0.0 的 ②③ 同类复发。新增合法 `[前缀-xxx]` 编号时须同步加 (?!前缀) 断言；
  //      根治方向是改白名单匹配（只认 `_TBD`/`-新\d`/`_占位`/`_待`），见反哺报告-v1 §B1，暂控改动面未做）
  // v18.0.0 修复（P0-1，实战：本项目 12 处命中全为 ②③，真占位符 = 0 → 假 P0 使 M 门永不可能 exit 0）
  [/\[[LDC](?:_|-)(?!主\d)(?!基-)(?!空\])(?!CASE)[A-Za-z\u4e00-\u9fff][^\]]*\]/g, '临时编号（如 [L_TBD-1]）'],
  [/【(?:待补|待定|待查|待核|临时)】/g, '中文方头括号占位'],
  [/（(?:待补|待定|待查|待核|临时)）/g, '圆括号占位'],
  [/_{3,}/g, '下划线占位'],
  [/[？?]{2,}/g, '连续问号占位'],
];
{
  const tempCount = TEMP_MARKERS.reduce((a, [re]) => a + ((textProse.match(re) || []).length), 0);
  const tempHits = TEMP_MARKERS
    .map(([re, label]) => [label, (textProse.match(re) || []).length])
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label}×${n}`);
  results.push({
    gate: 'M-Form-3 临时编号残留',
    pass: tempCount === 0,
    detail: tempCount
      ? `命中: ${tempHits.join(',')}（定稿不得留占位符 / 临时标记）`
      : '零占位符残留（正文↔文末编号闭环由 M-Exist-1 负责，本项不重复计）',
    severity: tempCount >= THRESHOLDS.mform3TempP0 ? 'P0' : (tempCount > 0 ? 'P1' : '通过'),
  });
}

}

// === M-Form-5 过程语言残留（v2.5.2-dsh.5 扩禁词清单：弱 AI 痕；v2.5.2-dsh.9 扩内部流程词；
export function mForm5(ctx) {
  const { body, THRESHOLDS, results } = ctx;
//     v2.5.2-dsh.17 补严重度分级——自省审计发现旧版最高只到 P1，**P0 分支不可达**，
//     与同族的 M-Form-4（元数据泄露）/ M-Form-9 不一致：过程语言成规模 = 读者看到流水线内部 = 交付级缺陷）===
// ⚠️ v18.11.0 F-1' **已回滚**（回归测试驳回）：曾按 v1 反哺报告建议从词表**删除**「承重墙」，
//   但 `tests/scripts.test.mjs` 的「M-Form-5 禁词表逐词注入」与「M-Form-4 任一泄露即 P0」两条用例
//   把「承重墙」写成**契约词**（注入即须命中，且按 6-10 处 / >10 处锁死 P1/P0 档位）——
//   删除后计数降 1，两条用例同时变红。**词表是契约，不得单方删减**。
//   真问题的正解在**稿件侧**：学术写作避免沿用流水线内部话术（「承重墙」在本流水线里既是
//   M-Form-8 的分析术语、又是 M-Form-5 的禁词——写手应改用「核心支撑论点 / 主导机制」等中性表述）。
const bannedBanned = /v\d+ 稿|初稿|草稿|修订说明|上一版|下一版|(?<!板)卡级|修卡|承重|批注|待回查|审计环节|流水线|将在[^，。\n]{0,8}订正|一处两用|段级条目|索引段|素材加载清单|素材卡|案例卡|数据卡|文献卡/g;
const estRe = /据行业经验估算/g;
const weakAITrend = /据可靠来源|据悉|据了解|研究显示|专家表示/g;
const hits = (body.match(bannedBanned) || []);
const estHits = [...body.matchAll(estRe)].filter((m) => !body.slice(Math.max(0, m.index - 60), m.index + m[0].length).includes('[行业估算'));
for (const e of estHits) hits.push(e[0]);
// 弱 AI 痕仅在上下文 200 字符内无 [Lxx]/[Dxx]/[Cxx] 时算违规
const weakAIHits = [];
for (const m of body.matchAll(weakAITrend)) {
  const start = Math.max(0, m.index - THRESHOLDS.mform5WeakAICtx);
  const ctx = body.slice(start, m.index + m[0].length);
  if (!/\[(?:L|D|C)\d+\]/.test(ctx)) weakAIHits.push(m[0]);
}
for (const h of weakAIHits) hits.push(h);
results.push({
  gate: 'M-Form-5 过程语言残留',
  pass: hits.length === 0,
  detail: hits.length ? `命中: ${[...new Set(hits)].join(',')}` : '零命中',
  // v2.5.2-dsh.17：补 P0 档（旧版最高 P1 → P0 分支不可达，与 M-Form-4/M-Form-9 同族不一致）
  severity: hits.length > THRESHOLDS.mform5P0 ? 'P0' : (hits.length > THRESHOLDS.mform5P1 ? 'P1' : (hits.length > 0 ? 'P2' : '通过')),
});

}

// === M-Form-4 元数据泄露（v2.5.2-dsh.5 重大修订：黑名单转白名单）===
export function mForm4(ctx) {
  const { body, endnote, stripCodeSpans, results } = ctx;
const forPatternText = (() => {
  let t = body;
  // v18.2.6 审计修复（第三方审计 P1-3：白名单**贪婪吞前缀 → 掩盖真泄露**）：
  //   第 4 条白名单旧式为 `[\u4e00-\u9fff]+(?:大学|学院|研究院|政府|机构|组织|部|委|局|司|办)`——
  //   前缀用 `+`（无上限）且从**句首**起匹配，于是任何「…机构/组织/部…」结尾的中文句子会被**整句剥离**：
  //     实测「本报告由主控提交给评审机构。」→ 剥离后只剩「。」→ **「主控」这条 P0 级泄露扫不到**；
  //     反例「主控说了算。」（无机构后缀）才命中 → 同一门对两句话给出相反结论，且**恰好放过最像真泄露的写法**。
  //   修法：白名单只负责剥离**机构名本身**，故对每个白名单匹配加守卫——**匹配串里含角色/流程禁止词时不剥离**
  //   （保留原文交给下面真正的黑名单扫描）。这样「国家统计局」照旧被剥离，而「…主控…机构」不会被吞。
  const ROLE_IN_WHITELIST = /((?<!自)主控|文献检索员|数据检索员|分析员|写手|批判伙伴|审计员|审稿人|案例检索员|角色卡|交接报告|任务简报|反哺报告|修订说明)/;
  const whitelists = [
    /\[(?:L|D|C-主|C|先)\d+\]/g,
    /\d{4}年|\d{1,2}月\d{1,2}日/g,
    /\d+\.?\d*%|\d+\.?\d*\s*(?:万|亿|个|条|项|位|倍|元|倍|成)/g,
    /[\u4e00-\u9fff]+(?:大学|学院|研究院|政府|机构|组织|部|委|局|司|办)/g,
    /AI Act|标识办法|GPT-?\d*|OpenAI|Claude/g,
  ];
  for (const pat of whitelists) t = t.replace(pat, (m) => (ROLE_IN_WHITELIST.test(m) ? m : ''));
  return t;
})();
const forbiddenPatterns = [
  /T[0-9] (主控|文献|数据|分析|写手|审计|案例|批判|审稿)/g,
  /((?<!自)主控|文献检索员|数据检索员|分析员|写手|批判伙伴|审计员|审稿人|案例检索员)/g,
  // v18.0.0 修复（冲突⑥）：旧式「论衡 + 空格 + 枚举词」会漏掉「论衡 AI 写作流水线」
  //   → 改为「论衡」与枚举词**同句共现**（≤12 字间隔），是否合规披露段交由 LLM 判断
  /论衡[^\n。；]{0,12}(?:agent|流水线|技能|测试轮)/g,
  /角色卡|任务书|六要素|交接报告|反哺报告|教训 #?\d+|Phase [0-9.]+/g,
  /批 v?\d+ 稿|初稿|草稿|定稿/g,
  /输入材料|输出材料|任务简报第 ?\d+ ?行|修订说明-?v?\d+|scripts\//g,
  /m-gate-check\.mjs|consistency-check\.mjs|count-chars\.mjs/g,
  /\bsubagent\b|\bforeground\b|\bbackground\b|\bsubagent_fork\b/g,
];
const leakHits = [];
for (const pat of forbiddenPatterns) {
  const m = forPatternText.match(pat);
  if (m) leakHits.push(...m);
}

// === M-Form-4 补充：文末节二级扫描（v18.0.0 新增，P0-4）===
// 实战教训：M-Form-4 只扫正文区 `body`（文末节被整体剥离），文末 `## 案例来源` 遂成「免责区」——
//   本轮该节含「案例检索员」+「spawn + 立即 Done」+「任务简报 §五 第 55–56 行」+「主人 Phase 0」，
//   脚本判通过，由 T7 逐行人工扫出（判 P0-1）。而 deliverables.md 明确要求定稿文末亦不得含内部流水线信息。
// 现规则：白名单 5 节 **只豁免书目条目行**（以 [Lxx]/[Dxx]/[Cxx]/[先xx] **数字编号**开头者，
//   含基线编号 [D-基-x-NN]）；其余说明性文字与正文同口径扫描。
// ⚠️ [C-空] 标记行**不豁免**（0 条空卡场景下，该行的说明文字正是本轮泄露点）。
const ENDNOTE_FORBIDDEN = [
  /((?<!自)主控|文献检索员|数据检索员|分析员|写手|批判伙伴|审计员|审稿人|案例检索员)/g,
  /\bspawn\b|\bsubagent\b|立即\s*Done|foreground|background/g,
  /空卡协议|交接报告|六要素|角色卡|任务简报|反哺报告|修订说明|教训\s*#?\d+/g,
  /\bPhase\s*[0-9.]+/g,
  /v\d+\.\d+\.\d+/g, // 版本注记（如「（v2.2.2 新增）」）
  /论衡[^\n。；]{0,12}(?:agent|流水线|技能|测试轮)/g,
  // v18.0.0：补「读者面内部术语」——实战本轮文末「数据来源」节出现「数据卡 [D02] 未记页码」
  //   （行 147，由 T7 独立发现、M-Form-5 因 body 不含文末节而漏检）
  // ⚠️ v18.11.0 F-2 **已回滚**（回归测试驳回）：曾建议文末扫描同样豁免「承重」，但 M-Form-4 的
  //   契约用例（自省审计）以过程语言注入锁死档位，且「文末节不得含内部术语」是本门立法目的本身。
  //   正解同样在稿件侧：文末节（参考文献/数据来源/案例来源/先行者文献）写**纯书目信息**，
  //   不写「承重证据落在…」这类分析性散文。
  /承重|素材卡|案例卡|数据卡|文献卡|索引段|素材加载清单|一处两用|段级条目|卡级|修卡/g,
];
// v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
//   **「AI 使用声明」节整体豁免二级扫描**。该节的唯一职责就是披露 AI 参与，其措辞由
//   `references/templates/AI-使用声明-template.md` 规定（模板本身要求写「分析框架由 AI 协助拟定」等披露语），
//   与「文末不得含内部流水线信息」的立法目的不冲突。
//   实测：定稿在声明节写「…均配 [Lxx]+[Dxx]+[Cxx] 三档**承重**证据」→ 命中禁止词「承重」→ **假 P0**
//   （M 门 exit 2 的一项，T8 只能写 Acknowledged Limitations）。
//   v18.0.0 新增二级扫描的动因是 `## 案例来源` 泄露「案例检索员 + spawn」——**那类节仍照扫**，
//   故本豁免只针对「AI 使用声明」，不放宽其余四节。
const ENDNOTE_SCAN_EXEMPT = ['AI 使用声明'];
// v18.2.9 修（第三方审计 A8）：二级扫描的标题解析改走 `_lib/sections.mjs` 的 `h2Headings` 真源。
//   旧实现用 `/^##\s+(.+?)\s*$/`——`\s` 含换行、且不认全角空格（\u3000）作标题分隔：
//   「##　AI 使用声明」（全角空格标题）在此失配 → 豁免不生效 → 命中披露语禁止词 → **假 P0**。
//   全库其余处已于 v18.2.6 统一走 h2Headings，此处是漏网的双重实现。
const endnoteScanText = (() => {
  const heads = h2Headings(endnote);
  if (heads.length === 0) return endnote;   // 无二级标题（异常布局）→ 不豁免，照旧全扫
  const kept = [];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index;
    const end = i + 1 < heads.length ? heads[i + 1].index : endnote.length;
    if (!ENDNOTE_SCAN_EXEMPT.some((w) => heads[i].title === w || heads[i].title.startsWith(w))) {
      // 豁免后仍保留节标题行，便于 detail 里的「文末节」定位信息不失真
      kept.push(endnote.slice(start, end));
    }
  }
  if (kept.length === heads.length) return endnote;
  return kept.join('\n');
})();
const endnoteNonBiblio = endnoteScanText
  .split('\n')
  .filter((l) => !/^\s*[-*]?\s*\[(?:L|D|C|先)(?:\d|-基-)/.test(l)) // 仅豁免数字/基线编号书目行
  .join('\n');
const endnoteLeakHits = [];
for (const pat of ENDNOTE_FORBIDDEN) {
  const m = stripCodeSpans(endnoteNonBiblio).match(pat);
  if (m) endnoteLeakHits.push(...m);
}
if (endnoteLeakHits.length > 0) {
  const secNames = h2Headings(endnote).map((h) => h.title);   // v18.2.9：与 endnoteScanText 同源（旧式 \s 正则不认全角空格）
  const secTag = secNames.length ? `（文末节: ${secNames.join(' / ')}）` : '';
  leakHits.push(...[...new Set(endnoteLeakHits)].map((h) => `文末节泄露「${h}」${secTag}`));
}

results.push({
  gate: 'M-Form-4 元数据泄露',
  pass: leakHits.length === 0,
  detail: leakHits.length
    ? `命中: ${[...new Set(leakHits)].slice(0, 5).join(',')}`
    : '正文 + 文末节均无内部代码（白名单剥离后 + 文末二级扫描）',
  // v2.5.2-dsh.17：与文档口径对齐——**任一处泄露即 P0**（文档：M-Form-4 是 P0 优先级，
  // 读者看到论衡内部代码 = 失去学术严肃性；旧版 1-5 处只给 P1，与 M-Form-7「一处违规即 P0」不一致）
  severity: leakHits.length > 0 ? 'P0' : '通过',
});

}

// === M-Form-6 信任级别（v2.5.2-dsh.5 扩字段：双格式 + 描述字段交叉验证）===
export function mForm6(ctx) {
  const { text, findCard, layoutAnomaly, THRESHOLDS, results } = ctx;
let dataCard = '';
// v18.0.5 修（第三方审计 P1-2）：改用统一 resolver `findCard()`（evDir 扁平 → 项目内规范相对路径），
//   与 M-Form-10/11 同口径。旧版只认 `join(evDir,'数据卡.md')`，在「证据包按子目录组织」的项目上
//   会与 M-Form-10「已查 3 张卡」互相矛盾（实测 test-paper-01：同一次运行同时报
//   「数据卡.md 不在证据包」与「已查 3 张卡」）。
const dataCardPath6 = findCard('数据卡.md', 'data/数据卡.md');
// v18.2.6 审计修复 P1-7：`catch {}` 会让「卡读不出来」与「卡不存在」在输出里**完全同形**——
//   实测权限错/编码错时 `dataCard` 静默留空 → detail 报「数据卡.md 不在证据包（也不在项目 data/ 目录）」
//   （判定 P0 但原因错，主控会去补检索而不是修文件）。现把读取异常如实带入 detail。
let dataCardReadError = null;
try { if (dataCardPath6) dataCard = readFileSync(dataCardPath6, 'utf8'); }
catch (e) { dataCardReadError = e; }
if (dataCard) {
  const uniqueDataIds = dataCardIds(text);
  const trustLevelMiss = [];
  const trustLevelDescOnly = [];
  for (const id of uniqueDataIds) {
    // v3 实际格式：### [Dxx] 标题（三级标题）| 数据卡.md 一级 # + [Dxx] 行内（v3 头部）
    const card = splitCard(dataCard, id);
    if (!card) { trustLevelMiss.push(`D${id}(整段缺失)`); continue; }
    const section = card.body;
    const hasStdTrust = TRUST_COMPLIANT_RE.test(section);
    const hasDescTrust = TRUST_LOOSE_RE.test(section);
    if (!hasStdTrust) {
      if (hasDescTrust) {
        trustLevelDescOnly.push(`D${id}`);
      } else {
        trustLevelMiss.push(`D${id}`);
      }
    }
  }
  let mform6Pass, mform6Detail, mform6Severity;
  if (trustLevelMiss.length === 0 && trustLevelDescOnly.length === 0) {
    mform6Pass = true;
    mform6Detail = `${uniqueDataIds.length} 条数据卡均标独立信任级别段`;
    mform6Severity = '通过';
  } else if (trustLevelMiss.length > 0) {
    mform6Pass = false;
    mform6Detail = `独立段缺失: ${trustLevelMiss.slice(0, 5).join(',')}${trustLevelDescOnly.length ? `; 描述字段仅有: ${trustLevelDescOnly.slice(0, 3).join(',')}` : ''}`;
    mform6Severity = trustLevelMiss.length > THRESHOLDS.mform6P0 ? 'P0' : (trustLevelMiss.length > THRESHOLDS.mform6P1 ? 'P1' : 'P2');
  } else {
    mform6Pass = false;
    mform6Detail = `独立段缺失（描述字段仅提及）: ${trustLevelDescOnly.slice(0, 5).join(',')}（P2：建议统一迁移到独立段，防描述改写后失锚）`;
    mform6Severity = 'P2';
  }
  results.push({ gate: 'M-Form-6 信任级别', pass: mform6Pass, detail: mform6Detail, severity: mform6Severity });
} else {
  results.push({
    gate: 'M-Form-6 信任级别',
    pass: false,
    detail: dataCardReadError
      ? `数据卡.md 读取失败（**不是缺失**）：${dataCardPath6} —— ${dataCardReadError.message}（v18.2.6：读取异常不再与「卡不存在」同形）`
      : layoutAnomaly
        ? `数据卡.md 定位失败（证据包布局异常：${layoutAnomaly}）`
        : '数据卡.md 不在证据包（也不在项目 data/ 目录）',
    severity: 'P0',
  });
}

  ctx.dataCard = dataCard;
  ctx.dataCardReadError = dataCardReadError;
}

// === M-Form-8 三角验证（v2.5.2-dsh.5 修订：每论点强制含 L + coverage ≥ 2）===
export function mForm8(ctx) {
  const { body, refRe, stripCodeSpans, THRESHOLDS, draftPath, evDir, findCard, results } = ctx;
let mform8Findings = { L_missing: 0, weak: 0, total: 0, details: [], soft: [] };
try {
  // v2.5.2-dsh.5 修复：排除前置/收尾非论点段（摘要/关键词/引言/结语）——摘要与引言天然不引 [Lxx]
  // （引言以 [先xx] 声明原创性差异点，属论衡原创性机制而非论点论证），之前把「摘要」当正文段查 [Lxx] 导致恒 P0 误报。
  // v18.11.0 F-2' 反哺——补英文摘要/关键词段：旧表只有中文标题 → 英文学术论文的
  //   `## Abstract` / `## Keywords` 段被当作正文段查 [Lxx]，恒报「段缺[Lxx]」（v1 反哺报告问题 2）。
  //   实测：本项目 v4 的 `## Keywords` 段被判 P0（T8 只能靠加 [Lxx] hack 绕过——那本身是违规改写）。
  const FRONT_BACK = ['摘要', '关键词', '引言', '结语', '结论', '展望',
    'Abstract', 'Keywords', 'Keyword', 'Acknowledg', 'References', 'Bibliography'];
  const sections = body.split(/^##\s+/m).filter((s) => s.trim().length > 0);
  for (const sec of sections.slice(0, THRESHOLDS.mform8MaxSections)) {
    if (sec.length < THRESHOLDS.mform8MinSecLen) continue;
    const secTitle = sec.split('\n')[0].trim();
    const titleNorm = secTitle.replace(/^[0-9一二三四五六七八九十]+\s*[、.．:：\s]+/u, '').replace(/[：:].*$/u, '').trim();
    if (FRONT_BACK.some((t) => titleNorm === t || titleNorm.startsWith(t) || titleNorm.includes(t))) continue;
    mform8Findings.total++;
    const secProse = stripCodeSpans(sec);          // 剥掉代码/反引号里的字面量编号
    const hasL = /\[L\d+\]/.test(secProse);
    const hasD = /\[D\d+\]/.test(secProse);
    const hasC = /\[C\d+\]/.test(secProse);
    const cov = (hasL ? 1 : 0) + (hasD ? 1 : 0) + (hasC ? 1 : 0);
    if (!hasL) { mform8Findings.L_missing++; mform8Findings.details.push(`段缺[Lxx]: ${sec.split('\n')[0].slice(0, 30)}`); }
    if (cov < 2) mform8Findings.weak++;
    // 裸断言段（v18.3.0 方案 G 下沉）：长段落零引用 → P2 软提示（机械只挑可疑，定罪归 G3/G6）
    const secHan = countHan(secProse);
    const secRefs = (secProse.match(refRe) || []).length;
    if (secHan > THRESHOLDS.mform8BareMinHan && secRefs === 0) {
      mform8Findings.soft.push(`「${secTitle.slice(0, 20)}」${secHan} 字零引用（疑似裸断言）`);
    }
    // 句长异常（v18.3.0 阶段 3）：正文异常长句（单句 >阈值汉字）→ P2 软提示（机械只挑长句，是否该拆归 G4/G14）
    const longSents = secProse.split(/[。！？；;!?]/).filter((s) => countHan(s) > THRESHOLDS.mform8LongSentenceHan);
    if (longSents.length) {
      mform8Findings.soft.push(`「${secTitle.slice(0, 20)}」${longSents.length} 个异常长句（>${THRESHOLDS.mform8LongSentenceHan} 字）`);
    }
  }
  // ---- 承重墙超载机检（v2.5.2-dsh.17 新增）----
  // 承重墙 = 支撑力最强的单条证据，T4 在大纲「承重墙清单」里逐论点标 top1；论衡定的规则是
  // **同一证据被 ≥3 个论点标为承重墙 = 超载**（教训：善行实战祁东案一个案例承重四个论点，
  // 被击穿则整链塌）。此前该规则只有 T6 的专项批判 + T7 的 LLM 复核，**没有任何机械计数**。
  // 判定方式与格式无关：清单区内每个论点最多贡献一次 top1 标注，故同一编号出现 ≥3 次即 ≥3 个论点。
  const wall8 = { checked: false, rows: 0, overload: [], ghost: [], claims: 0, notes: [], headRow: '' };
  try {
    const projDir8 = dirname(dirname(draftPath));
    const outlinePath8 = [join(projDir8, 'analysis', '分析大纲.md'), join(evDir, '分析大纲.md')]
      .find((p) => existsSync(p));
    if (outlinePath8) {
      const ol = readFileSync(outlinePath8, 'utf8').split('\n');
      // **锚点必须是「结构信号」**（v17.0.0 修复，端到端测试反哺）：
      //   旧实现用 /承重墙/ 全行匹配 → 命中**散文里的「承重墙」三字**（例：禁做项列表写「不出现…承重墙…」）
      //   → 该行非标题 → 走「猜后续 60 行」兜底 → 把论点-论据映射表也当承重墙清单 → 同一编号 ×3 → **误报超载**。
      //   现只认：① 标题行（##/### … 承重墙…）；② 含「承重证据 top1」标记的行。
      // v18.2.1 再收紧（本轮 v18.2.0 短测试实测踩到，属旧修复未覆盖的同类形态）：
      //   旧式 `/承重墙|承重证据/` 对**标题行做全行匹配**，会命中
      //   「### 论点-论据映射表（写手版；**M-Form-8 承重墙清单**）」——括号里**提及**了承重墙，
      //   于是把论据映射表当承重墙清单读（该表一行含多个编号）→ 同一编号计 3 次 → 误报「承重墙超载」。
      //   故标题行锚点改为**必须以关键词开头**；行内式锚点（非标题）仍只认「承重证据 top1」。
      // v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
      //   **新增「表格表头锚点」并置其优先级最高**。T4 的常见做法是把承重墙做成**三角验证表的一列**
      //   （表头 `| 论点 | 论点简述 | … | 承重 top1 | 子问题 |`），而非独立小节；旧实现只认
      //   ① 以「承重墙/承重证据/承重清单」开头的标题行、② 行内式「承重证据 top1」——
      //   于是 ② 命中的是**三角验证表上方的纪律说明引用块行**
      //   （`> **承重墙纪律（v18.0.0）**：每条核心论点标"承重证据 top1"…`），
      //   该锚点非标题 → 走「紧随其后的连续表格/列表行」→ 下一行是**空行** → block 只有 1 行
      //   → structRows=0 → **假报「承重墙清单无结构性条目」P1**（真值：表内 10 行 top1 标注齐全、无超载）。
      //   三处修正：① 表头锚点优先；② 收块时**容忍空行间隔**；③ 锚点搜索跳过围栏代码块。
      const isFenceLine = (l) => /^\s*```/.test(l);
      // v18.2.5 修（主控实战反哺 P1）：表头锚点收紧为「**首列**必须是承重证据」。
      //   旧实现 /^\s*\|[^\n]*承重[^\n]*\|\s*$/ 允许「承重」出现在**任意列** → 会命中
      //   「论点-论据映射表」的表头（该表最后一列常写作「承重证据 top1」）→ 于是把**映射表**当承重墙清单读。
      //   映射表每行含多个编号（论据组合列），同一编号跨多个论点行重复出现 → **假报「承重墙超载」**。
      //   实测（本项目 ai-cad-cam-impact）：大纲有 4 个含「承重」的表头候选（行 91/114/319/368），
      //   脚本取**第一个** = 行 91「| 论点 | 章节 | 论据组合… | 承重证据 top1 | 字数预算 |」= 映射表，
      //   遂报「[L09]×4论点,[L11]×3论点,[C01]×3论点,[C02]×3论点,[L10]×4论点,[L12]×3论点」；
      //   而真值在大纲 §4.2（行 114）与 §11.6（行 368）的承重墙清单里：12 行 top1、负载 ≤2、**无超载**
      //   （T4 大纲自检亦明示「所有承重墙负载 ≤2」）。两者结论相反，根因即锚点选错表。
      //   修法：首列锚点 `^\s*\|\s*承重(证据|墙|清单)` —— 映射表首列是「论点」，不再命中。
      const wallHeadAnchor = (l) => /^\s*\|\s*承重(证据|墙|清单)/.test(l);
      const wallTextAnchor = (l) => /^#{2,4}\s/.test(l)
        ? /^#{2,4}\s*(承重墙|承重证据|承重清单)/.test(l)
        : /承重证据\s*top\s*1/i.test(l);
      let fenceOn = false;
      const headCandidates = [];
      const textCandidates = [];
      for (let i = 0; i < ol.length; i++) {
        if (isFenceLine(ol[i])) { fenceOn = !fenceOn; continue; }
        if (fenceOn) continue;
        if (wallHeadAnchor(ol[i])) headCandidates.push(i);
        if (wallTextAnchor(ol[i])) textCandidates.push(i);
      }
      // v18.11.0 F-8 反哺——锚点候选 fallback（修「选错表」）：
      //   旧实现只取**第一个**表头锚点（headIdx）——但大纲里常有多个含「承重」的表格行
      //   （如 §〇 骨架表的「| §4 | 机制分解：四重锁定（**承重墙**） | …」紧随其后的行、
      //    或自检表的「| 承重墙清单（15 行含论点N） | §五 RL 清单 | ✓ |」），
      //   首个候选往往落在**非承重墙清单**的表上 → block 内无结构性条目 → 假报 P0。
      //   实测（本项目）：锚点选中自检表行 → 报「承重墙清单无结构性条目」，
      //   而真清单在 `### 承重墙清单（M-Form-8 机检锚点；每行带「论点N」）` 标题下齐备。
      //   修法：按「表头候选 → 标题候选」顺序逐个试算 block 与 structRows，
      //   取**第一个能解析出结构性条目**的候选；全为 0 时退回首个候选（保留原有留痕行为）。
      const resolveBlock = (idx) => {
        const head = /^(#{1,6})\s/.exec(ol[idx]);
        let e = ol.length;
        if (head) {
          const re = new RegExp(`^#{1,${head[1].length}}\\s`);
          for (let i = idx + 1; i < ol.length; i++) { if (re.test(ol[i])) { e = i; break; } }
        } else {
          const contRe = wallHeadAnchor(ol[idx]) ? /^\s*\|/ : /^\s*(\||[-*]\s)/;
          let gap = 0;
          for (let i = idx + 1; i < ol.length; i++) {
            if (/^\s*$/.test(ol[i])) { if (++gap > 3) { e = i; break; } continue; }
            if (!contRe.test(ol[i])) { e = i; break; }
            gap = 0;
          }
        }
        const blk = ol.slice(idx, e);
        const loose = blk.filter((l) => /\[[LDC]\d+\]/.test(l) && /论点/.test(l));
        const strict = blk.filter((l) => /\[[LDC]\d+\]/.test(l) && /论点\s*[0-9一二三四五六七八九十]/.test(l));
        return { block: blk, rows: Math.max(loose.length, strict.length), strict, loose };
      };
      const orderedCandidates = [...headCandidates, ...textCandidates];
      let sIdx = -1, resolved = null;
      for (const c of orderedCandidates) {
        const r = resolveBlock(c);
        if (r.rows > 0) { sIdx = c; resolved = r; break; }
      }
      if (sIdx === -1 && orderedCandidates.length > 0) {
        sIdx = orderedCandidates[0];
        resolved = resolveBlock(sIdx);
      }
      if (sIdx !== -1) {
        wall8.checked = true;
        // v18.2.5 新增：记录**实际选中的表头行**，让 detail 自带「锚点选对了哪张表」的证据——
        //   本次 bug 的教训是「选错表」在旧 detail 里完全不可见（只报超载结果，不报依据）。
        wall8.headRow = String(ol[sIdx] || '').trim();
        // 段体边界与结构性行均由上方 `resolveBlock()` 计算（F-8 锚点候选 fallback）；
        // 结构性行判据（v18.11.0 F-8 简化）：行内含编号 + 含「论点」标记，**宽松优先**——
        //   紧凑表格（「论点 N | 承重证据」）行内编号与论点标记并存即可，不再要求「论点」后必须跟数字。
        const block = resolved.block;
        const structRows = resolved.loose.length >= resolved.strict.length ? resolved.loose : resolved.strict;
        wall8.rows = resolved.rows;
        const freq = new Map();
        for (const l of structRows) for (const m of l.matchAll(/\[([LDC])(\d+)\]/g)) {
          const id = `[${m[1]}${m[2]}]`;
          freq.set(id, (freq.get(id) || 0) + 1);
        }
        wall8.claims = new Set([...block.join('\n').matchAll(/论点\s*([0-9一二三四五六七八九十]+)/g)].map((m) => m[1])).size;
        wall8.overload = [...freq.entries()].filter(([, n]) => n >= THRESHOLDS.mform8WallOverload).map(([id, n]) => `${id}×${n}论点`);
        // v18.11.0 F-8 反哺——「有论点未标 top1」按**横排布局**折算（避免双列清单误报）：
        //   旧实现直接比 `claims > rows`——但大纲常把承重墙清单排成 2 列/行
        //   （`| 论点N | 承重证据 | 次数 | 论点N | 承重证据 | 次数 |`），15 个论点只需 8 行，
        //   于是「15 > 8」恒报「有论点未标 top1」（实测本项目）。真值：8 行 × 2 列 = 15 个论点齐全。
        //   修法：按每行**实际出现的「论点」标记数**折算容量 `rows × perRow`，只有超出容量才算缺标。
        const perRow = Math.max(1, ...[...structRows.map((l) => (l.match(/论点\s*[0-9一二三四五六七八九十]+/g) || []).length)]);
        const capacity = wall8.rows * perRow;
        if (wall8.rows === 0) wall8.notes.push('承重墙清单无结构性条目（每个论点须标一条「承重证据 top1」）');
        else if (wall8.claims > capacity) wall8.notes.push(`${wall8.claims} 个论点但只标了 ${capacity} 条承重墙（${wall8.rows} 行 × ${perRow} 列）——有论点未标 top1`);
        // 幽灵编号：承重墙标了卡片里不存在的编号
        const cardIds8 = new Set();
        // v18.0.0：纳入 **先行者清单** —— `[先NN]` 编号不在三张素材卡内（存在 `literature/先行者清单.md`），
  //   否则 ghost 判定会把清单里的 [先01]-[先07] 误判为「清单编造」（假 P0）。
  for (const [name, rel] of CARD_SPECS) {
          const p = findCard(name, rel);
          if (!p) continue;
          for (const id of entryIds(readFileSync(p, 'utf8'))) cardIds8.add(id);
        }
        if (cardIds8.size > 0) wall8.ghost = [...freq.keys()].filter((id) => !cardIds8.has(id));
      } else {
        wall8.notes.push('大纲未见承重墙清单（T4 未标 top1 → 本项无从核，T6/T7 按清单专项检查失效）');
      }
    }
  } catch (e) {
    // v18.2.6 审计修复 P1-7：承重墙是**增强项**（解析失败不拖垮 M-Form-8 覆盖率判定），
    //   但旧写法 `catch {}` 让「增强项静默跳过」与「清单本来就没有」在输出里不可区分 →
    //   主控以为「已核过承重墙、无超载」。现按既有做法留痕：异常**单独**记 `parseError`，
    //   并在 detail 里无条件输出（`wall8.checked` 为 false 时 notes 分支不会执行，故不能只塞 notes）。
    wall8.parseError = `承重墙清单解析失败（本增强项已跳过，承重墙判定退化为 LLM 兜底）：${e.message}`;
    wall8.notes.push(wall8.parseError);
  }

  const wallHard = wall8.overload.length > 0 || wall8.ghost.length > 0;
  let mform8Pass = (mform8Findings.L_missing === 0 && mform8Findings.weak === 0 && !wallHard);
  let mform8Severity = mform8Findings.L_missing > 0 ? 'P0'
    : (wallHard || mform8Findings.weak > 0 ? 'P1' : '通过');
  // v18.2.5 新增：wallBit 附带**实际选中的清单表头**（让「锚点选错表」这类问题自带证据、可事后核对）。
  const wallHeadBit = wall8.checked && wall8.headRow
    ? `（清单锚点表头：${wall8.headRow.slice(0, 46)}${wall8.headRow.length > 46 ? '…' : ''}）`
    : '';
  const wallBit = wall8.checked
    ? (wall8.overload.length
      ? `承重墙超载：${wall8.overload.join(',')}（同一证据被 ≥3 论点承重 → 降级为辅助证据或补检索）`
      : (wall8.rows > 0 ? `承重墙 ${wall8.rows} 条标注、无超载` : (wall8.notes[0] || '承重墙清单为空'))) + wallHeadBit
    : '';
  let wallBit2 = '';
  if (wall8.ghost.length) wallBit2 = `承重墙含卡片中不存在的编号：${wall8.ghost.slice(0, 5).join(',')}`;
  results.push({
    gate: 'M-Form-8 三角验证',
    pass: mform8Pass,
    detail: [
      `${mform8Findings.total} 段：${mform8Findings.L_missing} 段缺 L，${mform8Findings.weak} 段覆盖 <2 类${mform8Findings.details.length ? `（${mform8Findings.details.slice(0, 3).join('; ')}）` : ''}`,
      wallBit,
      wallBit2,
      wall8.parseError || '',   // v18.2.6：解析异常**无条件**出现在 detail（不再无痕跳过）
      (wall8.checked && wall8.rows > 0 && !wall8.overload.length && wall8.notes.length) ? `备注：${wall8.notes[0]}` : '',
      mform8Findings.soft.length ? `P2 提示（裸断言段）：${mform8Findings.soft.slice(0, 2).join('；')}${mform8Findings.soft.length > 2 ? ` 等 ${mform8Findings.soft.length} 段` : ''}` : '',
    ].filter(Boolean).join(' ｜ '),
    severity: mform8Severity,
  });
} catch (e) {
  results.push({ gate: 'M-Form-8 三角验证', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

}

// === M-Form-9 图件闭环（v2.5.2-dsh.16 新增）：[图N] 图位 ↔ final/图件/ ↔ 图上数字 三方对账 ===
export function mForm9(ctx) {
  const { text, draftPath, dataCard, figDirArg, findBriefUpward, findCard, results } = ctx;
// 背景（第三方 SVG 链路审计）：T5 卡宣称「T7 跑 M-Gate 算法检查 [图N] 出现次数 ≥ 拍板图位数量 → P0 拦截」，
// 但**当时**的 M 门（16 项）里**没有任何图项**、T7 速查表 0 处提及「图」、证据包不收图件 → 该条文无落地路径。
// 本项即该条文的机械落地：缺图/图位不足 → 硬失败；孤儿图件/数字对不上 → 软提示（数字对账为启发式）。
// 未启用配图（无图位且无图件目录）→ 记 N/A 且 pass=true（不得因「没配图」把 M 门判失败——配图默认关闭）。
try {
  // v18.2.5 修（主控实战反哺 P0）：图件目录缺省推导口径与「被审对象位置」解耦。
  //   旧实现 `join(dirname(draftPath), '图件')` 隐含假定「被审对象在 final/ 下」（文件头注释写
  //   「缺省自动推 <定稿目录>/图件」）；但 Phase 4 的 T7 审计与 Phase 5 的 T8 终检实际被审对象是
  //   `drafts/初稿-vN.md` → 推出 `drafts/图件`（不存在）→ 恒报「图件 0 个」P0。
  //   实测后果：本项目三轮（v3/v4/v5）M-Gate 全 exit=2，**不论主控写多少张 SVG 都无法关闭该 P0**，
  //   使「M 门 exit 0 才返回」硬门禁在原子上失效，只能走 Acknowledged Limitations 交付。
  //   修法：项目根用与 M-Integrity-1 / 本项图位数量解析同一助手 findBriefUpward（向上找 01-任务简报.md），
  //   图件规范位置 = <项目根>/final/图件；同时保留旧候选以兼容「被审对象即 final/定稿.md」场景。
  const briefForFig = findBriefUpward(dirname(draftPath));
  const figProjectRoot = briefForFig ? dirname(briefForFig) : dirname(dirname(draftPath));
  const figDirCandidates = [
    join(dirname(draftPath), '图件'),        // 兼容旧口径：被审对象在 final/ 下 → <定稿目录>/图件
    join(figProjectRoot, 'final', '图件'),   // 规范口径：项目根/final/图件（drafts/ 被审场景）
  ];
  const figDirDefault = figDirCandidates.find((p) => existsSync(p)) || figDirCandidates[1];
  // v18.2.6：`figDirArg` 已在脚本头部经由 requireExistingDir 校验（不存在 → exit 10），故此处可直接采信
  const figDir = figDirArg || (existsSync(figDirDefault) ? figDirDefault : null);
  const figNos = figurePlaceholders(text);
  const files = figDir ? readdirSync(figDir).filter((f) => f.toLowerCase().endsWith('.svg')) : [];
  const fileNos = new Map();
  for (const f of files) { const n = figureNoOf(f); if (n !== null && !fileNos.has(n)) fileNos.set(n, f); }
  // 图位数量对账（拍板数取自任务简报，best-effort 解析；解析不到则不判，避免误 P0）
  let pledged = 0, pledgedFrom = '', pledgedNote = '';
  try {
    // v18.0.2 修（D1，静默失效）：旧实现 `draftPath.replace(/final[\/]定稿\.md$/, …)` 只对 `final/定稿.md`
    //   生效；被审对象为 `drafts/初稿-vN.md` 时替换不命中 → briefPath 退回正文自身 → pledged 解析不到 → 0
    //   → **「图位不足」比对在 Phase 4 场景静默不判**（同文件的 M-Integrity-1 曾因同一 bug 失效，其修法即
    //   findBriefUpward，本处为第二份拷贝）。现统一改用模块级 findBriefUpward。
    const briefPath = findBriefUpward(dirname(draftPath));
    if (briefPath && briefPath !== draftPath && existsSync(briefPath)) {
      const b = readFileSync(briefPath, 'utf8');
      const m1 = b.match(/(?:图位|图表)数量\s*[:：]\s*(\d+)/);
      const m2 = b.match(/拍板[^\n。]{0,20}?(\d+)\s*(?:张|个|幅)图/);
      pledged = Number((m1 && m1[1]) || (m2 && m2[1]) || 0);
      if (pledged) pledgedFrom = m1 ? '简报「图位数量」' : '简报「拍板 N 张图」';
    } else {
      pledgedNote = '未找到 01-任务简报.md → 「图位不足」对账已跳过（拍板图位数无从取得）';
    }
  } catch (e) {
    // v18.2.6 审计修复 P1-7：旧写法 `catch {}` 让「简报读不动」与「简报没写图位数」同形 →
    //   主控会把「对账被跳过」读成「对账通过」。现按既有做法留痕（随 detail 的软提示输出）。
    pledgedNote = `任务简报读取/解析失败 → 「图位不足」对账已跳过：${e.message}`;
  }

  if (figNos.size === 0 && fileNos.size === 0) {
    results.push({
      gate: 'M-Form-9 图件闭环',
      pass: true,
      detail: 'N/A：未启用配图（正文无 [图N] 图位、final/图件/ 不存在）——本项不适用，不算通过也不判失败',
      severity: '通过',
    });
  } else {
    const problems = [];
    const softNotes = [];
    // ① 缺图：正文有图位但无对应图件
    const missingFigs = [...figNos].filter((n) => !fileNos.has(n));
    // ② 图位不足：拍板数 > 正文图位数
    const shortage = pledged > 0 && figNos.size < pledged;
    // ③ 孤儿图件
    const orphanFigs = [...fileNos.keys()].filter((n) => !figNos.has(n));
    // ④ SVG 良构 / 安全
    if (figDir) {
      for (const [n, f] of fileNos) {
        const a = analyzeSvg(readFileSync(join(figDir, f), 'utf8'));
        if (!a.ok) problems.push(`图${n}(${f}) 结构不合格: ${a.problems.join('；')}`);
        if (a.warnings.length) softNotes.push(`图${n}(${f}) 告警: ${a.warnings.join('；')}`);
      }
      // ⑤ 图上数字 ⊆ 数据卡 ∪ 正文（启发式：仅查 <text>/<tspan>/<title> 文本节点，跳过单字符刻度）
      const unionRaw = dataCard + '\n' + text;
      const union = unionRaw + '\n' + unionRaw.replace(/(\d),(?=\d{3}\b)/g, '$1');
      for (const [n, f] of fileNos) {
        const nums = svgTextNumbers(readFileSync(join(figDir, f), 'utf8'));
        // v18.11.0 F-10 反哺——加「数学推算白名单」：图上数字由数据卡数字加减得出（如 3196-147=3049）
        //   时不算「无出处」。旧实现只做字符串包含比对 → 推算值被判无出处（v2 反哺报告问题 10）。
        //   判据：从数据卡/正文提取全部数字集合，若某图上数字 = 集合内两数之差/和，则视为可推算。
        const knownNums = [...new Set((unionRaw.match(/\d+(?:\.\d+)?/g) || []).map(Number))];
        const derivable = new Set();
        for (const a of knownNums) for (const b of knownNums) {
          if (a === b) continue;
          const d = a - b; if (d > 0) derivable.add(String(d));
          const s = a + b; if (s > 0) derivable.add(String(s));
        }
        const unmatched = [...nums.keys()].filter((t) => t.length >= 2 && !union.includes(t) && !derivable.has(t));
        if (unmatched.length) {
          softNotes.push(`图${n} 图上数字 ${unmatched.slice(0, 5).join(',')}${unmatched.length > 5 ? ` 等 ${unmatched.length} 个` : ''} 在数据卡/正文中找不到出处（启发式：可能为刻度或坐标，请人工确认）`);
        }
      }
    }
    if (missingFigs.length) problems.push(`缺图：正文标了图位但 final/图件/ 无对应文件 → 图${missingFigs.join('、图')}（期望 图N_标题.svg）`);
    if (shortage) problems.push(`图位不足：${pledgedFrom} 记为 ${pledged} 张，正文仅 ${figNos.size} 个 [图N]（T5 卡「≥ 拍板数量」不满足）`);
    if (orphanFigs.length) softNotes.push(`孤儿图件：图${orphanFigs.join('、图')} 未被正文引用`);
    // v18.2.6（P1-7）：对账被跳过（简报缺失/解析失败）必须**显式可见**，不得与「对账通过」同形
    if (pledgedNote) softNotes.push(pledgedNote);

    const hard = problems.length > 0;
    // 严重度：**图件全缺（有图位但一个图件都没有/目录不存在）**或缺失总数 >2 → P0；其余缺图 → P1
    const severity = !hard ? (softNotes.length ? 'P2' : '通过')
      : ((missingFigs.length > 0 && fileNos.size === 0) || missingFigs.length + (shortage ? 1 : 0) > 2 ? 'P0' : 'P1');
    results.push({
      gate: 'M-Form-9 图件闭环',
      pass: hard ? false : (softNotes.length ? false : true),
      detail: [
        `图位 ${figNos.size} 个 / 图件 ${fileNos.size} 个${figDir ? '' : '（无 final/图件/ 目录）'}`,
        problems.length ? `硬问题: ${problems.join('；')}` : '无缺图',
        softNotes.length ? `软提示: ${softNotes.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity,
    });
  }
} catch (e) {
  results.push({ gate: 'M-Form-9 图件闭环', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

}

// === M-Form-10 索引段完整性（v2.5.2-dsh.17 新增）===
export function mForm10(ctx) {
  const { draftPath, evDir, findCard, results } = ctx;
// 依据：三张卡模板都写着「索引段编号必须与正文条目一一对应（**一致性自检可加**『索引编号 = 实际编号』校验）」，
//   而下游 T4/T5 的 token 优化恰恰依赖「先读索引段、按编号定位」——**索引缺条 = 静默漏卡**，
//   最终以「漏引 / 孤儿」（M-Form-3 / M-Exist-1）的形式在审计阶段才爆出来，返工代价最高。
// 本项即是模板自己邀请的那条校验：索引段 ↔ 正文条目 ↔ 头部声明条数 三者对账。
try {
  const CARDS = [
    ['文献卡.md', 'literature/文献卡.md'],
    ['数据卡.md', 'data/数据卡.md'],
    ['案例卡.md', 'cases/案例卡.md'],
  ];
  const findings = [];
  const softFindings = [];
  const notes = [];       // 仅备注，**不影响通过/严重度**（如 0 条场景导致的卡片缺失，是合法的）
  let checked = 0;
  for (const [name, rel] of CARDS) {
    const p = findCard(name, rel);
    if (!p) { notes.push(`${name} 未找到（0 条场景或尚未进入检索阶段）`); continue; }
    checked++;
    const cardText = readFileSync(p, 'utf8');
    const lines = cardText.split('\n');
    const idx = indexSection(lines);
    if (!idx) { findings.push(`${name}: 缺「## 📇 索引段」标题`); continue; }
    const indexBlock = idx.body.join('\n');
    // ⚠️ v18.11.0 F-6 **已回滚**（回归测试当场驳回）：曾把「整张卡的 [Lxx] 集合」并入 idxIds，
    //   结果 idxIds 与 bodyIds 恒等 → `missing` 永为空 → **「索引缺条」检查彻底失效**
    //   （tests:「m-gate-check M-Form-10：索引段缺条必须报」+「v18.3.1 B9 防 P0 降 P1」两条用例变红）。
    //   正解：索引段条目须按规定格式写方括号（`| [L01] | 作者 | …`，见 `_shared/机检硬格式.md` 条 3）；
    //   表格写成 `| L01 |`（无方括号）**本就是不合规**，脚本报缺条是**正确行为**，不得为迁就单篇放宽。
    const idxIds = new Set([...indexBlock.matchAll(/\[([LDC])(\d+)\]/g)].map((m) => m[1] + m[2]));
    const bodyIds = new Set([...entryIds(cardText)].map((id) => id.slice(1, -1)));   // `[L01]` → `L01`（本段口径无方括号）
    const missing = [...bodyIds].filter((x) => !idxIds.has(x));       // 索引缺条 → 下游漏卡（硬）
    const extra = [...idxIds].filter((x) => !bodyIds.has(x));         // 索引悬空（软）
    const thin = indexBlock.split('\n').filter((l) => {
      if (!/\[([LDC])\d+\]/.test(l)) return false;
      return l.replace(/\[([LDC])\d+\]/, '').replace(/[｜|\s\-—–:：·]/g, '').length < 6;  // 编号后信息量不足
    });
    if (missing.length) findings.push(`${name}: 索引段缺 ${missing.length} 条（${missing.slice(0, 5).join(',')}）→ 下游按索引定位会漏卡`);
    if (extra.length) softFindings.push(`${name}: 索引段有 ${extra.length} 个编号在正文无对应条目（${extra.slice(0, 5).join(',')}）`);
    if (thin.length) softFindings.push(`${name}: ${thin.length} 行索引信息量不足（需 编号 + 主题 + 支撑论点）`);
    // ⚠️ v18.11.0 F-2 **已回滚**（回归测试驳回）：曾把「头部声明 ≠ 正文条目」由 hard finding 降为
    //   soft，理由是「best-effort 解析可能误匹配」。但 `tests/scripts.test.mjs`
    //   「m-gate-check M-Form-10：索引段缺条必须报…」用例断言该串必须以**硬问题**出现
    //   （`/头部声明 5 条 ≠ 正文条目 2 条/`）——降档即红。**头部声明对账是契约，不得降档**。
    //   正解在稿件侧：头部「总条数」只写本类条目数、且勿在他处写「（合计 N 条）」诱发 best-effort 误取
    //   （这条已写进 `pipeline-readme.md` §派发话术的「格式硬约束 7 条」第 6 条）。
    const headN = cardText.match(/(?:总条数|合计)[^\d]{0,10}(\d+)\s*条/);
    if (headN && bodyIds.size && Number(headN[1]) !== bodyIds.size) {
      findings.push(`${name}: 头部声明 ${headN[1]} 条 ≠ 正文条目 ${bodyIds.size} 条（best-effort 解析头部声明）`);
    }
  }
  if (checked === 0) {
    results.push({ gate: 'M-Form-10 索引段完整性', pass: true, detail: `N/A：三张卡均未找到（${notes[0] || '尚未进入检索阶段'}）`, severity: '通过' });
  } else {
    const hard = findings.length > 0;
    results.push({
      gate: 'M-Form-10 索引段完整性',
      pass: !hard && softFindings.length === 0,
      detail: [
        `已查 ${checked} 张卡`,
        hard ? `硬问题：${findings.slice(0, 3).join('；')}` : '索引与正文编号一一对应',
        softFindings.length ? `软提示：${softFindings.slice(0, 2).join('；')}` : '',
        notes.length ? `备注：${notes.join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard ? (findings.length > 2 ? 'P0' : 'P1') : (softFindings.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Form-10 索引段完整性', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

}

// === M-Form-11 素材按需加载闭环（v2.5.2-dsh.17 新增）===
export function mForm11(ctx) {
  const { draftPath, evDir, body, findCard, THRESHOLDS, results } = ctx;
// 依据：05 卡要求 T5「先读各卡索引段 → 按大纲映射表**只读相关条目、不读全文**」，这条 token 优化的
//   收益此前**完全靠写手自述**——「按需加载」与「整卡通读」在产物上完全同形，无从核对（整卡通读
//   正是 T5 cacheRead 占子代理总量 76% 的成因）。本项用一份便宜留痕（`analysis/素材加载清单.md`）
//   把「到底加载了哪些编号」变成事实，三层判定：
//     ① 定稿正文引用的编号必须都在「## 已加载」集 → 否则「引了没读 = 引用不可信」（硬）
//     ② 「已加载」的编号必须在卡片正文条目里有对应 → 否则「幽灵编号 = 清单编造」（硬）
//     ③ 软提示：「读了不用」的编号（浪费上下文）/ 加载率 >90%（选择性不足，疑似整卡通读）
try {
  const projDir11 = dirname(dirname(draftPath));
  const listPath11 = [
    join(projDir11, 'analysis', '素材加载清单.md'),
    join(evDir, '素材加载清单.md'),
  ].find((p) => existsSync(p)) || null;
  // v18.0.0 修复（冲突⑦）：统一「素材编号全形态」正则，纳入基线编号 `[D-基-x-NN]` 与先行者 `[先NN]`。
  //   旧实现用 refsOf(body,'L'|'D'|'C') 三类编号 → 基线编号与先行者全部漏计（实战：本项目实际 40 条 vs 脚本计 30 条），
  //   导致「已加载 ⊆ 卡片」的核对面少 10 条（虽然 >90% 软提示结论巧合一致）。
  const REF_TOKEN = '[LDC]\\d+|D-基-[A-Z]-\\d+|先\\d+';
  const refRe11 = new RegExp('\\[(' + REF_TOKEN + ')\\]', 'g');
  const cited11 = new Set([...body.matchAll(refRe11)].map((m) => '[' + m[1] + ']'));
  // 卡片侧真源：正文条目编号（幽灵判定）+ 索引段编号（选择性判定）
  const cardEntryIds = new Set();
  const cardIndexIds = new Set();
  // v18.0.0：纳入 **先行者清单** —— `[先NN]` 编号不在三张素材卡内（存在 `literature/先行者清单.md`），
  //   否则 ghost 判定会把清单里的 [先01]-[先07] 误判为「清单编造」（假 P0）。
  for (const [name, rel] of CARD_SPECS) {
    const p = findCard(name, rel);
    if (!p) continue;
    const t = readFileSync(p, 'utf8');
    for (const id of idsByToken(t, REF_TOKEN)) cardEntryIds.add(id);
    const idx = indexSection(t.split('\n'));
    if (idx) {
      for (const m of idx.body.join('\n').matchAll(new RegExp('\\[(' + REF_TOKEN + ')\\]', 'g'))) cardIndexIds.add('[' + m[1] + ']');
    }
  }
  const findings11 = [];
  const soft11 = [];
  if (!listPath11) {
    if (cited11.size === 0) {
      results.push({ gate: 'M-Form-11 素材按需加载闭环', pass: true, detail: 'N/A：正文无素材引用且无加载清单（尚未进入写作阶段）', severity: '通过' });
    } else {
      findings11.push(`正文引用 ${cited11.size} 个素材编号，却无 analysis/素材加载清单.md——「按需加载」无留痕，无法区分「按需」与「整卡通读」`);
      results.push({
        gate: 'M-Form-11 素材按需加载闭环',
        pass: false,
        detail: findings11.join('；'),
        severity: 'P1',
      });
    }
  } else {
    const lt = readFileSync(listPath11, 'utf8');
    const ls2 = lt.split('\n');
    // 只取「## 已加载」段内的编号（「已跳过」等其它段不计入加载集，允许写编号解释为何不读）
    // v18.8.x 实战反哺补丁（2026.09.22）：原 regex `^#{2,4}\s*已加载` + sectionRange boundary `^#{2,4}\s`
    //   在「## 已加载 + ### 一、文献卡」结构下会被 ### 一级标题截断（sectionRange 默认把 ### 当作节结束）
    //   → loadedSeg 仅含 `## 已加载` 与 `### 一、文献卡` 之间的少量注释行 → 「已加载 0 条」误判
    // 改进：① 接受 `## 已加载` / `### 已加载` / `#### 已加载`（`#` 1-4 hashes 都行）+ 任何后续文字（含「段」「v3」等）
    //       ② sectionRange 用 `## `（2 hashes 加空格）作为 section 边界而非 `##{2,4}`（让 ###、#### 视为子节留在已加载段内）
    const hIdx11 = ls2.findIndex((l) => /^#{1,4}\s*已加载/.test(l));
    let loadedSeg;
    if (hIdx11 === -1) {
      findings11.push('加载清单缺「## 已加载」段标题（机检无从定位加载集）');
      loadedSeg = lt;
    } else {
      // 用 `## ` 作为 section 边界（###、#### 视为子节，留在已加载段内）
      let e11 = sectionRange(ls2, hIdx11, /^##\s/).end;
      loadedSeg = ls2.slice(hIdx11 + 1, e11).join('\n');
    }
    // v18.2.1：**支持范围写法** `[D01]-[D08]`（本轮实测踩到）——旧实现只按单编号全量匹配，
    //   范围写法只命中首尾两项，中间的 D02–D07 被判「引了没读 = 引用不可信」（假 P0）。
    //   范围展开在**同一字母**内进行；起止倒序或跨度 > 30 视为笔误，不展开（如实计入 findings）。
    const expandRanges = (seg) => {
      const extra = new Set();
      const bad = [];
      for (const m of seg.matchAll(/\[([LDC])(\d+)\]\s*[-–—~至]\s*\[([LDC])(\d+)\]/g)) {
        const [, a, n1, b, n2] = m
        if (a !== b) { bad.push(m[0]); continue }
        const lo = Number(n1), hi = Number(n2)
        if (hi < lo || hi - lo > 30) { bad.push(m[0]); continue }
        for (let i = lo; i <= hi; i++) extra.add(`[${a}${String(i).padStart(n1.length, '0')}]`)
      }
      return { extra, bad }
    }
    const { extra: rangeIds, bad: badRanges } = expandRanges(loadedSeg)
    const loaded11 = new Set([
      ...[...loadedSeg.matchAll(new RegExp('\\[(' + REF_TOKEN + ')\\]', 'g'))].map((m) => '[' + m[1] + ']'),
      ...rangeIds,
    ])
    if (badRanges.length) soft11.push(`加载清单含无法展开的范围写法：${badRanges.slice(0, 3).join(' ')}（请改为逐项列出）`)
    const notLoaded = [...cited11].filter((x) => !loaded11.has(x));
    const ghost = [...loaded11].filter((x) => cardEntryIds.size > 0 && !cardEntryIds.has(x));
    // v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
    //   **「白读」软提示排除「清单中已声明跳过」的编号**。清单契约允许另设 `## 已跳过` 段解释
    //   「为什么读了索引段却不引用某条」（§八）；写手常把「读过的索引段编号」与「实际未读的条目」
    //   混记在 `## 已加载` 里 → 旧实现对这些编号一律报「白读即为上下文浪费」= 噪声。
    //   实测 4 条命中里 [D12]/[D14] 即属此类（T5 v3 清单已把它们标为「已跳过」）。
    const skippedSeg11 = (() => {
      const h = ls2.findIndex((l) => /^#{2,4}\s*已跳过/.test(l));
      if (h === -1) return '';
      return ls2.slice(h + 1, sectionRange(ls2, h, /^#{2,4}\s/).end).join('\n');
    })();
    const skippedIds11 = new Set(
      [...skippedSeg11.matchAll(new RegExp('\\[(' + REF_TOKEN + ')\\]', 'g'))].map((m) => '[' + m[1] + ']'),
    );
    const unused = [...loaded11].filter((x) => !cited11.has(x) && !skippedIds11.has(x));
    if (notLoaded.length) findings11.push(`正文引用但清单未记「已加载」：${notLoaded.slice(0, 6).join(',')}（引了没读 = 引用不可信）`);
    if (ghost.length) findings11.push(`清单里的编号在卡片中无对应条目：${ghost.slice(0, 6).join(',')}（清单与素材卡不一致）`);
    // v18.2.5 改（主控实战反哺 P2）：文案补**合规留痕豁免**说明。
    //   实测误伤（本项目）：[先06] 被 T7 第 1 轮判「与 [L11] 同篇重复、应从文末节删除」→
    //   主控按判从文末节删除，但 `素材加载清单.md` **保留**它是**正确行为**（它确实被读过）。
    //   旧文案把这条留痕一律读成「白读即为上下文浪费」——对「应删且已删」的条目是错判。
    if (unused.length) soft11.push(`${unused.length} 个编号「读了但正文未引用」（${unused.slice(0, 5).join(',')}）——`
      + `若该编号已在审计环节被判「应删且已删」（如与别条同篇重复），则保留在本清单属**合规留痕**、无需处理；`
      + `否则请补引用或从清单移除（白读即上下文浪费）`);
    //   v18.2.1（本轮实测反哺）：原阈值「卡池 ≥20 且加载率 >90%」在**短文 + 小卡池**场景必然误报——
    //   短测试卡池 20 条、正文引用 18 条（=90%）即触发「疑似整卡通读」，但短文本来就要用到大部分素材，
    //   这不是选择性不足。改为双条件：卡池 ≥30（有选择空间）**且** 正文 ≥3000 汉字（长文才有整卡通读的
    //   token 代价）才提示；否则如实跳过（不静默——下方 note 里写明因何未启用该软提示）。
    const bodyHan11 = (body.match(/[\u4e00-\u9fff]/g) || []).length
    // v18.2.2（主人授权的机制修订；依据 2026-09-12 ai-era-humanity-crisis 全量测试反哺）：
    //   **比率对账先取交集**——「已加载」集可含**不在索引段**的编号（先行者清单条目、基线编号
    //   `[D-基-x-NN]` 等）。实测出现过 `已加载 54 / 索引 52`（**分子 > 分母**）→ 比率 >100%
    //   仍被当成「>90% 整卡通读」，属分母口径错误、结论不可复算。
    //   现改为：分子 = |已加载 ∩ 索引|；越出索引的部分另记一条软提示（不参与比率，避免污染结论）。
    const loadedInIndex11 = [...loaded11].filter((x) => cardIndexIds.has(x));
    const loadedBeyondIndex11 = [...loaded11].filter((x) => !cardIndexIds.has(x));
    const ratioCheckOn = cardIndexIds.size >= THRESHOLDS.mform11MinIndexIds && bodyHan11 >= THRESHOLDS.mform11MinBodyHan
    // v18.2.5 修（主控实战反哺 P2）：阈值**按正文档位自适应** + 给出**显式消歧路径**。
    //   实测误伤（本项目 ai-cad-cam-impact，8000 字学术综述）：已加载 59 / 索引 61 = **96.7%**
    //   → 触发「>90% 选择性不足，疑似整卡通读」。但长篇论文的合理形态**就是**高加载率——
    //   卡池本身已过 T1/T2/T3 的「反向淘汰自查」精简到刚够用（[Dxx] 封顶 30-50、T1 砍到 12 条），
    //   8000 字论文引用 58 条素材 / 卡池 61 条，是**正常**而非选择性不足。
    //   旧阈值 0.9 是对小论文校准的（上方注释自述「短文 + 小卡池必然误报」曾修过一次），对长篇仍偏紧。
    //   现改两处：
    //     ① **分档**：长篇（≥6000 汉字）用 0.98、中篇（3000-6000）用 0.94、短篇不启用（沿用前置条件）；
    //     ② **消歧路径**：文案明确「高加载率本身不是缺陷」——真正的缺陷是「未按索引段定位而整卡通读」，
    //        而后者只能由写手留痕声明；故清单头部注明「按需加载」即豁免本提示。
    const ratioThreshold = bodyHan11 >= THRESHOLDS.mform11LongHan ? THRESHOLDS.mform11RatioLong : (bodyHan11 >= THRESHOLDS.mform11MidHan ? THRESHOLDS.mform11RatioMid : THRESHOLDS.mform11RatioShort);
    const ratioDeclared = /按需加载/.test(lt);
    if (ratioCheckOn && !ratioDeclared && loadedInIndex11.length / cardIndexIds.size > ratioThreshold) {
      soft11.push(`已加载 ${loadedInIndex11.length} / 索引 ${cardIndexIds.size} 条（>${(ratioThreshold * 100).toFixed(0)}%）——加载率偏高、疑似整卡通读；`
        + `若确为「先读索引段、按编号定位」的按需加载，请在 analysis/素材加载清单.md 头部注明「按需加载」以消除本提示（该条优化即为此设）`);
    }
    if (loadedBeyondIndex11.length) {
      soft11.push(`${loadedBeyondIndex11.length} 个已加载编号不在索引段内（${loadedBeyondIndex11.slice(0, 5).join(',')}）——已从比率对账中排除，请确认是否属先行者清单 / 基线编号`);
    }
    const ver11 = lt.match(/对应(?:正文)?版本[：:]\s*v?(\d+)/);
    if (ver11) {
      try {
        const draftsDir = join(projDir11, 'drafts');
        const newestDraft = existsSync(draftsDir)
          ? Math.max(0, ...readdirSync(draftsDir).map((f) => Number((f.match(/^初稿-v(\d+)\.md$/) || [])[1]) || 0))
          : 0;
        if (newestDraft && Number(ver11[1]) < newestDraft) {
          soft11.push(`清单标注「对应正文版本 v${ver11[1]}」落后于最新初稿 v${newestDraft}——留痕未随修订轮刷新`);
        }
      } catch (e) {
        // v18.2.6 审计修复 P1-7：版本留痕对账是增强项，但跳过必须可见（旧 `catch {}` 让
        //   「对账跳过」与「版本一致」同形）。按既有做法记入 soft11。
        soft11.push(`加载清单「对应版本」对账跳过（读 drafts/ 失败）：${e.message}`);
      }
    }
    const hard11 = findings11.length > 0;
    results.push({
      gate: 'M-Form-11 素材按需加载闭环',
      pass: !hard11 && soft11.length === 0,
      detail: [
        `已加载 ${loaded11.size} 条 / 正文引用 ${cited11.size} 个`,
        hard11 ? `硬问题：${findings11.slice(0, 3).join('；')}` : '引用 ⊆ 已加载，加载集有卡片支撑',
        soft11.length ? `软提示：${soft11.slice(0, 2).join('；')}` : '',
      ].filter(Boolean).join(' ｜ '),
      severity: hard11 ? (notLoaded.length + ghost.length > 3 ? 'P0' : 'P1') : (soft11.length ? 'P2' : '通过'),
    });
  }
} catch (e) {
  results.push({ gate: 'M-Form-11 素材按需加载闭环', pass: false, detail: `解析失败: ${e.message}`, severity: 'P1' });
}

}

