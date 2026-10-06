#!/usr/bin/env node
// 论衡方法论可复现性门（v18.10.0 战略反哺新增 / P0-1 / scripts 白名单 18→19）
// 用法：node methodology-check.mjs <文件.md> [--report <path>]
//   --report <p>   = JSON 结果写入 <p>（默认 stdout）
//
// 退出码（与 M 门语义同源）：
//   0  = 三项检查全过
//   1  = P1 问题（参数缺失 / 数据-方法不匹配 / 结果-方法不可回链）
//   2  = P0 问题（方法节参数 <2 项 —— 结构层严重缺失）
//   3  = 仅 P2 软提示
//   10 = 参数或路径错误
//   70 = 内部错误
//
// 3 项检查（与 P0-5 四声明节档位机检联合）：
//   M-Form-12    = 方法节参数完整性（样本量 / 抽样方式 / 变量定义 / 统计模型 / 超参数 / 随机种子 / 软硬件环境 — 至少 4 项）
//   M-Exist-11   = 统计-数据匹配度（参数/非参数 / 独立/配对 / 单尾/双尾 / 效应量与置信区间报告）
//   M-Exist-12   = 结果-方法闭环（每个结果叙述能否回链到方法节具体步骤）

import { readFileSync, existsSync } from 'node:fs';
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs';
import { sectionBody } from './_lib/sections.mjs';
import { writeReport } from './_lib/destructive-write.mjs';   // 报告写盘守卫（v18.12.0，全量审计 L-50）
import { packageVersionTag } from './_lib/pkg-version.mjs';   // §8.3 #39：产物 version 单一真源
installExitGuard();

// --- CLI 参数解析 ---
const argv = process.argv.slice(2);
let file = null;
let reportPath = null;
// v18.73.0（反哺报告-v7 F-10）：体裁旗标（可选）。**不传 = 行为与旧版逐字节相同**。
let genreArg = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--report') {
    // v18.12.0（全量审计 L-62）：缺值守卫（旧版静默不落盘却 exit 0）
    const v = argv[++i];
    if (!v || v.startsWith('--')) { console.error(`--report 缺少值（示例：--report audits/methodology.json）\n用法: node methodology-check.mjs <文件.md> [--report <path>] [--genre <code>]`); process.exit(10); }
    reportPath = v;
  }
  // v18.73.0（反哺报告-v7 F-10）：`--genre <code>` —— 体裁 code 取自 `_shared/文类档案.md`（如 `academic-hum`）。
  //   用途：让「理论/人文类体裁」（结构门 = `IMRaD-Alternate`，无方法节）的定量向子项如实记 **N/A**，
  //   而不是报 P0/P1。**为什么必须由调用方显式传入**：脚本**不能**靠「有没有方法节」自动判——
  //   一篇实证论文**漏写了方法节**同样表现为「无方法节」，自动 N/A 会把真缺陷变成假通过（假阴性）。
  //   故：体裁来自 Phase 0 的显式声明（任务简报），脚本只据声明豁免，不自行推断。
  else if (a === '--genre') {
    const v = argv[++i];
    if (!v || v.startsWith('--')) { console.error(`--genre 缺少值（示例：--genre academic-hum）\n用法: node methodology-check.mjs <文件.md> [--report <path>] [--genre <code>]`); process.exit(10); }
    genreArg = v;
  }
  else if (a.startsWith('--')) {
    console.error(`未知参数: ${a}\n用法: node methodology-check.mjs <文件.md> [--report <path>] [--genre <code>]`);
    process.exit(10);
  } else if (file === null) file = a;
  else {
    console.error(`多次传入文件参数: ${a}`);
    process.exit(10);
  }
}
if (!file) { console.error('用法: node methodology-check.mjs <文件.md> [--report <path>] [--genre <code>]'); process.exit(10); }
if (!existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(10); }
requireExistingFile(file, '待检查论文');

// --- 编码体检（与 count-chars.mjs / structure-check.mjs 同源） ---
{
  const probe = readFileSync(file);
  if (probe.length >= 2 && ((probe[0] === 0xff && probe[1] === 0xfe) || (probe[0] === 0xfe && probe[1] === 0xff))) {
    console.error(`${file}: 检测到 UTF-16 BOM —— 本脚本只接受 UTF-8。请转码后重跑。`);
    process.exit(10);
  }
  if (probe.toString('utf8').includes('\uFFFD')) {
    console.error(`${file}: 解码出现替换字符 U+FFFD —— 该文件不是合法 UTF-8。请转码后重跑。`);
    process.exit(10);
  }
}

const text = readFileSync(file, 'utf8');

// --- 取方法节 + 结果节 + 讨论节 ---
const methodBody = sectionBody(text, '方法') || sectionBody(text, '研究方法') || sectionBody(text, 'Method') || '';
const resultsBody = sectionBody(text, '结果') || '';
const discussionBody = sectionBody(text, '讨论') || '';

// === M-Form-12 方法节参数完整性 ===
// v18.62.4（全量审计-v18.62.3 §8.2 #19）：**关键词表本身也会「虚增已检项」**。
//   实测病灶：`'软硬件环境'` 里那个**单字母 `'R'`** 会被 `R²` / `R&D` / `Review` 命中；
//   同表另有 `'lr'`（`Recall` / `Already`）、`'IV'` / `'iv'`（`give` / `IV` 罗马数字）
//   一类**两字母片段**，以及 `'N ='`（可被 `in =` 命中）。
//   后果方向是**危险的那一侧**：`methodFound` 被灌水 → `methodFound.length >= 4 ⇒ PASS`
//   → **一份方法节根本没写参数的稿子被判「参数齐备」**（与「门空转」同源，只是方向相反）。
//   修法 = 声明式：把每个参数的关键词分成
//     · `phrases`：多字/多词特征串，直接 `includes`（安全）；
//     · `patterns`：必须**带边界**的短 ASCII 记号（`n=100` / `p < 0.05` 这类**真实必需**的形态），
//       用 `\b` + 边界字符类声明，避免子串误命中。
//   边界（如实）：词表法**天然只能查「有没有写」，不能查「写得对不对」**——后者归 T7。
const METHOD_PARAM_KEYWORDS = {
  '样本量': {
    phrases: ['样本量', '样本数', '受访者', '调查对象', 'participants', 'sample size'],
    patterns: [/\b[Nn]\s*=\s*\d/],   // n = 100 / N=100；带 `\b` 与数字，防 `in =`
  },
  '抽样方式': { phrases: ['抽样', '随机', '分层', '聚类', '便利抽样', '目的抽样', '滚雪球', 'sampling', 'stratified', 'cluster'] },
  '变量定义': { phrases: ['变量', '因变量', '自变量', '协变量', '中介变量', '调节变量', '操作性定义', 'variable', 'covariate'] },
  // ⚠️ v18.79.0（反哺-v18.78.2 §六 F-j）：**项名必须在自己的 phrases 里**。
  //   病灶：本键名「统计模型」，而 15 个词元**全部是回归族方法名**、不含「统计模型」四字 →
  //   一份**不做统计推断**的稿子按规范写明「不建立统计模型」（01 卡与审计任务书 P1-3 的标准措辞）
  //   **永远无法命中**，而 `required = 4` → 该项恒缺、`pass` 恒 false。
  //   实测（test-v18-78-2-县中塌陷 `drafts/初稿-v4.md` 行 35 原文含「不建立统计模型、不报效应量」）：
  //   修前 `foundCount = 3 / P1`，而任务书的 [逐字] 锚点恰是 `foundCount ≥ 4 / pass = true` → **锚点在正文侧不可达**。
  //   判据：本项的语义是「**方法节有没有交代清楚这些适用参数**」——**明写「不适用/不建立」也是交代**
  //   （与 M-Exist-11 的「有没有报」**刻意不同向**：那里写「不报」就是没报，见下方 F-k）。
  //   故此处**不加否定剥离**，只补上项名本身。修后同一份稿：`foundCount = 4 / PASS`。
  '统计模型': { phrases: ['统计模型', '回归', 'OLS', 'logit', 'probit', '中介', '调节', '结构方程', 'SEM', 'PLS', '倾向得分', 'PSM', 'DID', 'RDD', '工具变量', 'regression'] },
  '超参数': { phrases: ['学习率', 'learning rate', 'epoch', 'batch size', 'batch_size', '正则化', '正则', 'dropout', '超参数', 'hyperparameter', 'λ', 'alpha'] },
  '随机种子': { phrases: ['random seed', '种子', '随机数', 'rng'] },
  // 单字母 `R` 已移除：改为**无歧义**的语言/软件名（`R 语言` / `RStudio`），并保留其余具名软件
  '软硬件环境': { phrases: ['GPU', 'CPU', '内存', 'RAM', 'Python', 'R 语言', 'RStudio', 'Stata', 'SPSS', 'TensorFlow', 'PyTorch', 'sklearn', '硬件', '软件', 'environment'] },
};
const methodFound = [];
const methodMissing = [];
for (const [param, spec] of Object.entries(METHOD_PARAM_KEYWORDS)) {
  const hit = (spec.phrases || []).some((k) => methodBody.includes(k))
    || (spec.patterns || []).some((re) => re.test(methodBody));
  if (hit) methodFound.push(param);
  else methodMissing.push(param);
}
// 至少 4 项才合规
const mForm12Pass = methodFound.length >= 4;
const mForm12Severity = methodFound.length >= 4 ? 'PASS' : (methodFound.length >= 2 ? 'P1' : 'P0');

// === M-Exist-11 统计-数据匹配 ===
// 检测方法节是否声明：参数/非参数 + 效应量 + 置信区间 / p 值
const STAT_KEYWORDS = {
  '检验类型声明': ['t 检验', 't检验', 'F 检验', 'F检验', '卡方', 'χ²', 'χ2', 'chi-square', 'ANOVA', '方差分析', 'Mann-Whitney', 'Wilcoxon', 'Kruskal', '非参数', '参数检验'],
  '效应量': ['效应量', 'effect size', "Cohen's d", "Cohen's d", 'd =', 'd=', 'r =', 'r=', 'η²', 'eta squared', 'ω²', 'OR =', 'OR=', 'odds ratio', 'RR =', 'RR=', 'β =', 'β=', 'β 系数'],
  '置信区间/p 值': ['95% CI', '95%CI', '置信区间', 'p <', 'p<', 'p =', 'p=', 'P <', 'P<', 'P =', 'P=', 'p-value', 'p值', 'significance'],
};
// ⚠️ v18.79.0（反哺-v18.78.2 §六 F-k）：**否定语境不得被读成「已报」**（假阴性）。
//   病灶实测：`'效应量'` 等是**裸子串**匹配 → 写手照规范在方法节声明「**不报效应量**」，
//   本项 `found` 反而**多出一项**（同一把尺子：v3 = `found []` → v4 只加了一句「不报效应量」→ `found ['效应量']`）。
//   方向恰是**最坏的那一侧**：本项存在的意义就是抓「不报效应量」（脚本自陈「最常见问题是不报效应量」），
//   而它在**写手最规范的那一刻**失效 —— 越合规越被读成已报。
//   判据：命中位置前若是**否定 + 报告动词**（`不/未/无/非/没有` + `报/报告/估计/给出/列出/呈现/计算/采用/使用/作/做/涉及/纳入/提供`）
//   ＋ ≤3 个非标点字符，则该次出现记入 `statNegated`、**不计入 found**。
//   边界（如实）：只做**近距否定**（否定短语与词元之间 ≤3 字）——「本文不打算在任何小节报告效应量」这类
//   **长距否定**仍会被读成已报，归 T7 目视；反向的「不**显著**的效应量」已由**动词白名单**排除（"显著"不在表内），
//   不会把「报了但不显著」误判成没报。**与 M-Form-12 的方向差异是刻意的**（那里「不适用」算交代，这里「不报」就是没报）。
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NEG_REPORT_VERB = '(?:报告|报|估计|给出|列出|呈现|计算|采用|使用|作|做|涉及|纳入|提供)';
const NEG_PREFIX = `(?:不|未|无|非|没有)(?:再|会|拟|打算|单独|另行)?${NEG_REPORT_VERB}[^，。；、\\s]{0,3}`;
/** 该词元在方法节里有没有**非否定**的出现。 */
const hasPositiveStatHit = (k) => {
  const total = methodBody.split(k).length - 1;
  if (total === 0) return false;
  const negated = [...methodBody.matchAll(new RegExp(NEG_PREFIX + escapeRe(k), 'g'))].length;
  return total > negated;
};
const statFound = [];
const statMissing = [];
const statNegated = [];   // 只有否定式提及、无正向出现的项（供 note 与 T7 读：这是「声明不报」而非「漏检」）
for (const [item, keywords] of Object.entries(STAT_KEYWORDS)) {
  if (keywords.some((k) => hasPositiveStatHit(k))) statFound.push(item);
  else {
    statMissing.push(item);
    if (keywords.some((k) => methodBody.includes(k))) statNegated.push(item);
  }
}
// 三项齐全才算合规；缺任一项 = P1（最常见问题是不报效应量）
const mExist11Pass = statMissing.length === 0;
const mExist11Severity = statMissing.length === 0 ? 'PASS' : 'P1';

// === v18.73.0（反哺报告-v7 F-10）：**理论/人文类体裁豁免** ===
// 病灶实测（《不能评估的忠诚》）：文类 `academic-hum` + 结构门 `IMRaD-Alternate` → **根本没有方法节**，
//   而 M-Form-12（样本量/抽样/变量/统计模型…至少 4 项）与 M-Exist-11（检验类型/效应量/置信区间）
//   是**定量向**判据 → 恒报 **P0 / P1**，且**无正当解除途径**（作者不可能给理论论文补样本量）。
//   实测代价：该项目 T7 只能人工裁定 N/A 并在多处留痕；若无人裁定，M 门会被一个**体裁不适用**的项永久阻塞。
// 真源：`references/_shared/文类档案.md` 的「结构门」列 —— `IMRaD-Alternate`（= 人文/理论类）无方法节。
// 为什么只豁免这两项：M-Exist-12（结果-方法闭环）**已有**自带的质性/人文 N/A 分支（见其 note），不必重复。
// 为什么**必须**由 `--genre` 显式传入：见参数解析处注释（自动判会把「实证论文漏写方法节」变成假通过）。
const THEORY_GENRES = new Set(['academic-hum']);   // 结构门 = IMRaD-Alternate 的体裁
const isTheoryGenre = genreArg !== null && THEORY_GENRES.has(genreArg);
const naNote = isTheoryGenre
  ? `N/A：体裁 \`${genreArg}\`（结构门 IMRaD-Alternate）无方法节 —— 本项为**定量向**判据，体裁不适用。`
    + '**不得读作「已通过」**（`_shared/文类档案.md` §结构门；T7 已在审计报告中独立定性，见反哺报告-v7 F-10）。'
  : '';
const effMForm12Pass = isTheoryGenre ? true : mForm12Pass;
const effMForm12Severity = isTheoryGenre ? 'N/A' : mForm12Severity;
const effMExist11Pass = isTheoryGenre ? true : mExist11Pass;
const effMExist11Severity = isTheoryGenre ? 'N/A' : mExist11Severity;

// === M-Exist-12 结果-方法闭环 ===
// 每个结果叙述（以 ### / ## 开头或含 [Dxx] 引用）能否在方法节找到对应方法步骤
// 简化版：检测结果节是否引用了方法节中出现的关键方法名（如「OLS / PSM / DID / 中介效应 / 倾向得分匹配」）
// v18.62.4（全量审计-v18.62.3 §8.2 #20/#21）：两项修复，均为「**看似在检、实际不检**」：
//   #21：重编译时 `.map((re) => re.source)` **丢掉了 `i` 旗标** → 方法写 `logit`、结果写 `Logit`
//        即判「未回链」→ 假 P1。修法＝重编译时**逐条带上原旗标**（下方 `withFlags`）。
//   #20：`methodNamesInMethod.length === 0 || …` 的 `||` 让「方法节**没有**任何受支持的方法名」时
//        **恒真判 PASS** —— 质性/人文稿、以及任何用「多元线性回归」「政策文本分析」这类**表外方法名**
//        的论文全部逃过该门。修法＝改为 **SKIP（未检，不算通过）**：本门只做「表内方法名的回链」这一
//        可机检子集，表外情形必须**如实标未检**、交 T7 目视，而不是冒充通过。
const METHOD_NAME_PATTERNS = [
  /OLS[^a-zA-Z]/,
  /倾向得分匹配/,
  /PSM[^a-zA-Z]/,
  /DID[^a-zA-Z]/,
  /双重差分/,
  /RDD[^a-zA-Z]/,
  /断点回归/,
  /中介效应/,
  /中介(?!变量)/,
  /调节效应/,
  /SEM[^a-zA-Z]/,
  /结构方程/,
  /工具变量/,
  /IV[^a-zA-Z]/,
  /logit/i,
  /probit/i,
];
const methodNamesInMethod = METHOD_NAME_PATTERNS.filter((re) => re.test(methodBody)).map((re) => re.source);
// ⚠️ 关键词只保留**特征性短语**：`不足`/`未来`/`进一步` 在中文行文里无处不在（人文稿尤其），
//    会让「结果↔方法闭环」在缺方法时也恒真。故与 §8.2 #18 同一判据：**复杂项只认特征性短语**。
const NEEDS_HUMAN_RE = /质性|访谈|田野|扎根|民族志|叙事|文本分析|话语分析|案例研究|人文学科|人文|哲学|史学/;
/** 重编译时带上原旗标（`i` 不可丢——见 #21）。 */
const withFlags = (str, srcRe) => new RegExp(str, srcRe.flags.replace('g', ''));
let resultsRefsMethod;
let mExist12Severity;
let mExist12Note;
if (methodNamesInMethod.length === 0) {
  // #20：没有受支持的方法名 → **未检**，不是通过
  resultsRefsMethod = 'SKIP';
  mExist12Severity = 'SKIP';
  mExist12Note = NEEDS_HUMAN_RE.test(methodBody)
    ? '方法节未出现表内方法名，且该节含**质性/人文类**表述 → 本项机检**不适用**（T7 人工核「结果↔方法」是否对应）'
    : '方法节未出现表内 17 个方法名之一 → 本项**未检**（SKIP，不算通过）；若确为表外方法（如「多元线性回归」「政策文本分析」），请由 T7 人工核结果节是否回链';
} else {
  const hit = methodNamesInMethod.filter((name) => withFlags(name, METHOD_NAME_PATTERNS.find((re) => re.source === name)).test(resultsBody));
  resultsRefsMethod = hit.length > 0;
  mExist12Severity = hit.length > 0 ? 'PASS' : 'P1';
  mExist12Note = hit.length > 0
    ? `结果节引用了方法节中的方法名：${hit.join(' / ')}`
    : `方法节出现 ${methodNamesInMethod.join(' / ')}，但结果节**未回链**其中任何一个`;
}
const mExist12Pass = resultsRefsMethod;

// --- 汇总 ---
// v18.62.4（#20）：`SKIP` **不计入 pass**（`=== true`），且**不产出干净的 exit 0** ——
//   与 `g-audit-check` 的「SKIP 计入 skipped → exit 3」同语义：未检 ≠ 通过。
//   末档 `3` 同时覆盖「仅 P2」「仅 SKIP」「非 P0/P1 的其它组合」——本门只有三档判定，语义即「需人工复核」。
// v18.73.0（反哺报告-v7 F-10）：出口计算改用**生效值**（体裁不适用时三项均 N/A / pass=true）——
//   旧版用未豁免的原值，于是「三项都显示 N/A」而整体仍 exit 2，**读数与出口自相矛盾**。
const allPass = effMForm12Pass === true && effMExist11Pass === true && (isTheoryGenre ? true : mExist12Pass === true);
const allSeverities = [effMForm12Severity, effMExist11Severity, isTheoryGenre ? 'N/A' : mExist12Severity];
const hasP1 = allSeverities.includes('P1');
const hasP0 = allSeverities.includes('P0');
const exitCode = allPass ? 0 : (hasP0 ? 2 : (hasP1 ? 1 : 3));

const result = {
  file,
  version: packageVersionTag(),
  checks: {
    'M-Form-12': {
      name: '方法节参数完整性',
      pass: effMForm12Pass,
      severity: effMForm12Severity,
      required: 4,
      found: methodFound,
      foundCount: methodFound.length,
      missing: methodMissing,
      note: naNote || '至少 4 项：样本量 / 抽样方式 / 变量定义 / 统计模型 / 超参数 / 随机种子 / 软硬件环境',
    },
    'M-Exist-11': {
      name: '统计-数据匹配',
      pass: effMExist11Pass,
      severity: effMExist11Severity,
      found: statFound,
      missing: statMissing,
      // v18.79.0（F-k）：把「声明不报」与「漏检」分开呈现——两者都算 missing，但**成因不同**（T7 读 note 即可分辨）
      negatedOnly: statNegated,
      note: naNote || ('三项齐全：检验类型声明 / 效应量 / 置信区间或 p 值'
        + (statNegated.length ? `（⚠️ ${statNegated.join(' / ')} 只有**否定式声明**、无正向报告，已按「未报」计入 missing）` : '')),
    },
    'M-Exist-12': {
      name: '结果-方法闭环',
      // v18.73.0（反哺报告-v7 F-10）：与上两项**同源同修** —— 无方法节时「结果能否回链到方法步骤」
      //   本就**无从核**；实测加了 M-Form-12/M-Exist-11 的豁免后，本项仍单独把整体顶在 exit 2。
      pass: isTheoryGenre ? true : mExist12Pass,
      severity: isTheoryGenre ? 'N/A' : mExist12Severity,
      methodNamesFound: methodNamesInMethod,
      // v18.62.4（#20）：未检（SKIP）时 note 说明**为什么未检 + 该谁核**，不让读者以为「已核且通过」
      note: naNote || mExist12Note || '每个结果叙述能否回链到方法节具体步骤（简化版：方法节中的关键方法名是否在结果节被引用）',
    },
  },
  overall: { pass: allPass, exitCode },
  meta: {
    timestamp: new Date().toISOString(),
    description: '论衡方法论可复现性门 / v18.10.0 战略反哺 P0-1 / scripts 白名单 18→19',
    notes: '本脚本为机检骨架 + 关键词扫描；M-Form-12 / M-Exist-11 / M-Exist-12 是**本脚本自有命名空间**，'
      + '与 m-gate-check.mjs 的 M 门 24 项（M-Form 1-11 / M-Exist 1-11 / M-Integrity-1 / M-Fact-1）**不共用编号**——'
      + 'v18.12.0（全量审计 L-20）更正：旧注释写「与 m-gate-check.mjs 的 … 函数同源维护」，而该脚本内并无这三个函数，属虚假声明；'
      + '四份学术声明模板引用的「M-Form-12 子门」亦据此更正为「T7 人工核验」',
  },
};

const output = JSON.stringify(result, null, 2);
if (reportPath) writeReport(reportPath, output, { protect: [file] });   // v18.12.0（L-50）：同文件 → exit 10
else console.log(output);

process.exit(exitCode);