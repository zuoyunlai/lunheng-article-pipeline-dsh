#!/usr/bin/env node
// 论衡文章质量回归评分（v18.24.0 QLT-1 新增 / scripts 白名单 25→26）
//
// 用法：node quality-score.mjs <项目目录> [--humanities] [--report <path>] [--baseline <score.json>]
//   <项目目录>        = `run/<项目名>/`（须含 `final/定稿.md`）
//   --humanities      = 人文学科：structure-check 走 IMRaD-Alternate（透传该旗标）
//   --report <path>   = 评分 JSON 写入 <path>（默认 stdout）
//   --baseline <path> = 与一份历史评分 JSON 对比，输出**逐分量差异**（机制改动前后各跑一次用）
//
// 退出码（**本门是「度量」不是「闸门」**——分数高低不影响退出码）：
//   0  = 评分完成 / 10 = 参数或路径错误 / 70 = 内部错误
//   ⚠️ **为什么不做闸门**：质量分是**趋势指标**，把它挂成闸门会立刻产生「为过门而刷分」的压力
//      （各分量的判据都允许 N/A，一旦分数决定放行，N/A 就成了最省事的刷分路径）。
//
// ── 定位（QLT-1 = **合规分 compliance score**；v18.52.0 反哺 F-BC 正名） ─────────────────────
//   ⚠️ **它测的是合规，不是质量**（QLT-5 实测结论，本脚本最重要的一条效度边界）：
//     **每个分量都是「门计数代理」**——M-Gate = 门通过率 / G14 = 档位 / cite-coverage、g-audit = 是否过门 /
//     readability = 阈值区间 / handoff = 单据形态。**门计数不变 ⇒ 分数不动**，与「内容是否变好」**无因果关系**。
//     实测（题2 臂 B，同一项目、同一量尺、同一天）：**关闭 10 条实质论证条件**（T6 批判报告 §3.4 的 4 P0 + 6 P1，
//     含循环定义 / 永真命题 / 「防线只有形式没有机制」等**论证级**缺陷，经 T7 独立实读判 **10/10 关闭**）
//     + 文风净化（E 类装饰性 → 0）→ **分数变动 0.0**（逐分量完全相同），而**成本 +41.4M**。
//   ⇒ **能支撑的结论**：合规面差异、成本差异。
//     **不能支撑的结论**：任何「论证质量更好/更差」的说法（本实验因此**不得**用 QLT-1 支撑分档臂优劣）。
//     凡以本分差论证「质量提升」的历史记录，一律回标本条（F-BC）。
//   `result.validity` 字段逐条落盘该边界；**要测论证强度必须另建独立于门的量尺（如 QLT-6）**，
//     **不得复用门计数**——用门计数拼"质量分"等价于「用体检指标算智力」。
//
// 定位（下文为 v18.24.0 原始口径，读数与三口径不变，仅正名）：
//   把「文章合规能否维持」从**个案感觉**变成**可比数字** —— 本脚本**不新造任何判据**，
//   只把仓库里既有的机械门结果聚合成一个 0–100 的分数 + 逐项明细。
//
// ── 分量与权重真表（v18.57.x 审计修订：**旧表已过期**，与代码不符，现按实测重写）──────────────
//   共 **8 个**分量。**同一分量的权重随分支不同**——这不是漂移，而是刻意**按「预算总和 ≈ 100」标定**：
//   某分量判定不了时，其 N/A 权重与其它分支互补，使（适用 + N/A）合计仍落在 100 附近。
//   ⚠️ 因此**不要**把「同一 id 出现多个权重」当成笔误去"统一"——那会把 100 的预算打破。
//   实测（本机三场景，`quality-score.mjs <项目> --report`）：
//     · 场景 A（证据+简报+G14 齐备）：合计 **97.6**（g-audit 部分 SKIP 时按比例降权，见下）
//     · 场景 B（仅证据）/ C（缺证据）：合计 **100**
//
//   | id | 分量 | 适用权重 | N/A 权重 | 说明 |
//   |---|---|---|---|---|
//   | M-Gate | M 门机械项（含 M-Form-9 图件闭环 + M-Fact-1） | 38 | 38 | 三分支统一（v18.57.x 修：旧版缺证据分支写 40，把预算撑到 102） |
//   | structure | 学术结构（IMRaD / 引言漏斗 / 讨论四要素） | 10 | 8 | **仅当有方法节**才适用 |
//   | methodology | 方法论可复现 | 4 | 4 | 仅当有方法节才适用 |
//   | cite-coverage | 引用实质相关性（强度 / 冗余 / 年代分布） | 8 | 10 | 无参考文献节 → N/A |
//   | g-audit | G 项机检 6 项（G8/G2/G11/G2.5/G0.5/G15） | 12 ×(已检/适用) | 12（全部 SKIP / 缺输入）· 15（拿不到 JSON） | **唯一按比例降权者**：SKIP 是「适用但缺输入」，与 N/A 分清（见下） |
//   | G14 | G14 中文 AI 痕迹终闸 | 10 | 10 | 读 `audits/G14-检测报告-v*.md`；无报告 → N/A |
//   | readability | 可读性剖面（4 指标，21 份定稿标定） | 10 | 10 | 句数 < 20 → N/A |
//   | handoff | 交付完整性（T8 交接门 + 四门留痕） | 10 | 10 | 缺 `final/交付说明.md` → N/A |
//
//   **N/A 与 SKIP 必须分清**（这是本脚本最重要的一条口径，v18.41.0 起）：
//     · **N/A**（模式/体例不适用，如未传 `--qlt` 的 G15、无方法节的 structure）→ **不进分母、不扣分**，
//       但**必须**列进 `na[]` 并计入 `coverage`；
//     · **SKIP**（适用但缺输入，如缺 `01-任务简报.md`）→ **按缺输入降权**：`SKIP ≠ 通过`。
//
//   **防假绿**：只报分数不报覆盖率 = 给「什么都不做」满分，故**必须同时报 `coverage`**
//     = `适用权重 / (适用权重 + N/A 权重)`（v18.57.x 修：旧式 `(100 − naW) / 100` 把 100 写死，
//      当合计因 g-audit 部分降权而不等于 100 时该比值失真）。coverage < 0.8 时额外给 `coverageWarning`。
//
//   约定（QLT-1 判据）：**任何机制改动前后各跑一次，分数与逐项差异写进反哺报告**；
//     golden 项目清单与基线分数见 [`references/case-studies.md`](../references/case-studies.md) §golden 项目。
//   可复现性：同一份产物重复跑分数必须一致（分量的输入只有产物本身，无时间/环境依赖）。

import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { installExitGuard, requireExistingDir } from './_lib/exit-guard.mjs';
import { h2Headings, titleMatches, firstEndnoteIndex, bodyStartAfterAbstract } from './_lib/sections.mjs';
import { evaluate as readabilityEvaluate } from './_lib/readability.mjs';   // v18.26.0 QLT-3：可读性剖面（第 8 分量）
import { evaluateQlt6 } from './_lib/qlt6.mjs';   // v18.53.0 QLT-6：论证强度（**独立于门**的第二把尺，见 F-BC）
// v18.80.4（审计优化方向 4 落地 · 批 B）：门运行状态四态判定的**单一真源**——此前同一判据在本文件
//   写了五遍（M 门一处 + 四个三检门各一处），形状还不一致（M 门三条件 / 四检门两条件）。
import { classifyGateRun, explainGateRun } from './_lib/gate-result.mjs';
import { packageVersionTag } from './_lib/pkg-version.mjs';   // §8.3 #39：产物 version 单一真源
installExitGuard();

// v18.80.4（全量审计-v18.80.3 · 路径编码缺陷）：改用 fileURLToPath。旧写法 URL.pathname 是
//   percent-encoded——安装路径含空格/中文时（实测「space dir」「中文目录」夹具）spawnSync 拿到
//   转义序列路径 → 四个子门全部 ENOENT（status=1）、JSON 缺失，评分却把它们记 N/A 后 exit 0。
const SCRIPTS = fileURLToPath(new URL('.', import.meta.url));
const NODE = process.execPath;

// --- CLI ---
const argv = process.argv.slice(2);
let project = null;
let reportPath = null;
let baselinePath = null;
let humanities = false;
const USAGE = '用法: node quality-score.mjs <项目目录> [--humanities] [--report <path>] [--baseline <score.json>]';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--report' || a === '--baseline') {
    const v = argv[++i];
    if (!v || v.startsWith('--')) { console.error(`${a} 缺少值\n${USAGE}`); process.exit(10); }
    if (a === '--report') reportPath = v; else baselinePath = v;
  } else if (a === '--humanities') {
    humanities = true;
  } else if (a.startsWith('--')) {
    console.error(`未知参数: ${a}\n${USAGE}`);
    process.exit(10);
  } else if (project === null) project = a;
  else { console.error(`多次传入项目参数: ${a}\n${USAGE}`); process.exit(10); }
}
if (!project) { console.error(USAGE); process.exit(10); }
if (!existsSync(project)) { console.error(`项目目录不存在: ${project}`); process.exit(10); }
requireExistingDir(project, '项目目录');
if (baselinePath !== null && !existsSync(baselinePath)) { console.error(`基线文件不存在: ${baselinePath}`); process.exit(10); }

const draft = join(project, 'final', '定稿.md');
const evidence = join(project, 'final', '证据包');
const brief = join(project, '01-任务简报.md');
const deliverNote = join(project, 'final', '交付说明.md');
if (!existsSync(draft)) { console.error(`缺 final/定稿.md：${draft}（质量分以定稿为评分对象）`); process.exit(10); }

const tmpDir = mkdtempSync(join(tmpdir(), 'lunheng-qs-'));
const cleanup = () => rmSync(tmpDir, { recursive: true, force: true });
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
/** 跑一个门脚本并把 JSON 报告写到临时文件（**不经管道**：`stdio: 'ignore'` + `--report`）。
 *  返回值 `{ status, json, error }`——`status === null` 表示子进程根本没起来（与内容判定无关）。 */
const runGate = (tag, args) => {
  const out = join(tmpDir, `${tag}.json`);
  const r = spawnSync(NODE, [...args, '--report', out], { stdio: 'ignore', timeout: 120000 });
  return { status: r.status, error: r.error ? r.error.code : null, json: readJson(out) };
};

// --- 适用性判定（不适用 ⇒ 不进分母，但必须列进 na[]）---
const h2 = h2Headings(readFileSync(draft, 'utf8')).map((x) => x.title);
// ⚠️ **必须用「包含」而不是 `titleMatches`（精确 / startsWith）**：实测论衡的节标题普遍带序号前缀
//   （`## 四、研究设计：核心案例与对照案例的选取` / `## §3 理论建模：…`），startsWith 判据下
//   「研究设计」这类关键词**一个都命中不了** → 体例判定失真（实测 6/6 项目被误判为非 IMRaD）。
const hasSection = (names) => h2.some((t) => names.some((n) => t.includes(n)));
const hasMethods = hasSection(['方法', '研究方法', '研究设计', 'Method', 'Methods', 'Methodology']);
const hasRefs = hasSection(['参考文献', 'References']);

const components = [];
/** 记一个分量。`ratio` ∈ [0,1] 或 null（不适用）。 */
const add = (id, name, weight, ratio, detail, evidenceObj = {}, naReason = null) => {
  components.push({
    id, name, weight,
    applicable: ratio !== null,
    ratio: ratio === null ? null : +ratio.toFixed(4),
    weighted: ratio === null ? null : +(weight * ratio).toFixed(3),
    detail, evidence: evidenceObj,
    ...(naReason ? { naReason } : {}),
  });
};
/** 三检类门（structure / methodology / cite-coverage）的**硬失败比**。
 *  **口径（v18.24.0 定）：分数只反映硬失败（P0/P1）+ 结构缺项；P2 软提示单列、不扣分。**
 *  理由：这些门的规格自己写明 P2 是「软提示」（`cite-coverage` 的 C-Redundancy 在 v18.23.0 实测后由
 *  P1 收窄为 P2 候选；`structure`/`methodology` 也有 P2 档）。若把软提示算进分数，**度量会与「闸门
 *  是否放行」脱钩**——一个 P2 候选遍地的项目会被打低分，而它的 P0/P1 全是干净的。故：
 *    硬失败比 = 1 − (P0/P1 项数 / 总项数)；P2 项计入 `soft[]` 供人看，不进分母。 */
const hardRatio = (checks) => {
  const soft = checks.filter((c) => c.severity === 'P2');
  const hard = checks.filter((c) => c.severity !== 'P2');
  const hardFail = hard.filter((c) => !c.pass);
  return {
    ratio: hard.length === 0 ? 1 : (hard.length - hardFail.length) / hard.length,
    soft: soft.filter((c) => !c.pass).map((c) => c.name || ''),
    detailSuffix: hard.length === 0 ? '｜全部为 P2 软提示（不扣分）' : (soft.length ? `｜另有 P2 软提示 ${soft.filter((c) => !c.pass).length} 项（不扣分）` : ''),
  };
};

/** v18.80.4（B2）：把「门没跑通」的处置收口——**invalid 而非 N/A**（非 N/A 是 P1-8 的核心判据）。
 *  两种成因都返回 invalid：① 运行态不可用/内部错误（经 `_lib/gate-result.mjs` 判四态）；
 *  ② 跑通了但 JSON 缺 `checks` 结构（跑通 ≠ 可判定，仍不得当 N/A 蒙混）。 */
const gateFallback = (label, r) => {
  const cls = classifyGateRun({ status: r.status, error: r.error, json: r.json });
  return cls.kind === 'ok'
    ? { invalid: true, reason: `${label} 产出 JSON 但缺 checks 结构——不可判定（**invalid 非 N/A**，修复后重跑）` }
    : { invalid: true, reason: `${label} ${explainGateRun(cls)}——**invalid 非 N/A**，修复后重跑` };
};

// ① M 门机械项（权重 38）——图件闭环 M-Form-9 / M-Fact-1 均含在内，不另计
//    v18.57.x（审计修订 P2）：同一分量此前在三个分支下有三种写法（38 / 38 / 40），且名称硬编码的
//    项数与本门实际入账数不一致（写过 22 / 23，实测 total 为 24）。两处后果都是**同一个分量看起来
//    像两个分量**：`--baseline` 并排两份报告时，读者会以为评分结构变了。
//    现：**名称不再硬编码项数**（改由 detail 的 `pass/total` 承载真实值，本门加项时不必再改这里），
//    且三个分支统一 weight=38。**不改 38 → 40**：那会改动每个既有项目的分数与 golden 基线；
//    而 40 → 38 只影响「缺证据包」这一 N/A 场景的 coverage，方向是让该分量自洽。
const MGATE_WEIGHT = 38;
const MGATE_NAME = 'M 门机械项（含图件闭环 M-Form-9 + M-Fact-1）';
if (existsSync(evidence)) {
  const r = runGate('mgate', [join(SCRIPTS, 'm-gate-check.mjs'), draft, evidence]);
  const j = r.json;
  // v18.80.4（全量审计-v18.80.3 P1-8 + 批 B）：**门执行错误 ≠ 缺数据（N/A）**，判据收口到
  //   `_lib/gate-result.mjs`（四态：ok / invalid / not_applicable / unavailable）。病灶：m-gate 对
  //   可解析的门内 ERROR 会 stdout 完整 JSON 且进程 exit 70；旧判定只看 `j && j.total > 0` → 照常按
  //   pass/total 计分——「检查没跑通」被记成合规分。现非重跑不可的三种成因一律判 invalid。
  const mgCls = classifyGateRun({ status: r.status, error: r.error, json: j });
  const gateErr = mgCls.kind !== 'ok';
  if (j && j.total > 0 && !gateErr) {
    // v18.81.0（独立审计批 1.2）：**门版本可见性**。
    // 为什么在这里做：`runGate` 每次都是**新跑一遍**（temp 报告、无 prev）→ 它自己永远不会有
    //   `gate_rev_drift`；而消费这份分数的人真正需要知道的是「磁盘上那份被引用的报告，
    //   是不是与本门版本同一版」。故此处把「本次 fresh 的 rev」与「磁盘报告的 rev」对一下。
    // 边界（如实）：本字段**只影响说辞与 evidence**，不改 `ratio`、不改分数、不改退出码——
    //   跨版本可比性是「读法」问题，不是「分数」问题（与 QLT-1 的「度量不是闸门」同一条判据）。
    const diskM = readJson(join(project, 'final', 'M-Gate-Report.json'));
    const diskRev = diskM && typeof diskM.gate_rev === 'string' ? diskM.gate_rev : null;
    const revNote = !diskRev
      ? (diskM ? `｜磁盘报告缺 gate_rev（v18.81.0 前写入）→ 与本门版本**不可比性未知**` : '')
      : (diskRev === j.gate_rev ? '' : `｜⚠️ 磁盘报告 gate_rev=${diskRev} ≠ 本次 ${j.gate_rev} → **跨门版本，两份读数不可直接比较**`);
    add('M-Gate', MGATE_NAME, MGATE_WEIGHT, j.pass / j.total,
      `${j.pass}/${j.total} 通过｜P0 ${j.p0 ?? 0} / P1 ${j.p1 ?? 0} / P2 ${j.p2 ?? 0}｜exit ${j.exit}｜gate_rev ${j.gate_rev ?? '缺'}${revNote}`,
      { pass: j.pass, total: j.total, p0: j.p0 ?? 0, p1: j.p1 ?? 0, p2: j.p2 ?? 0, ...(j.gate_rev ? { gate_rev: j.gate_rev } : {}), ...(diskRev ? { disk_gate_rev: diskRev } : {}) });
  } else if (gateErr) {
    add('M-Gate', MGATE_NAME, MGATE_WEIGHT, null, '', { invalid: true },
      `m-gate-check ${explainGateRun(mgCls)}——**invalid，非 N/A**：检查未成功运行，本分数不得解读为合规面，修复后重跑`);
  } else {
    add('M-Gate', MGATE_NAME, MGATE_WEIGHT, null, '', { invalid: true },
      'm-gate-check 产出 JSON 但 total=0（无可判定项）——**invalid 非 N/A**，修复后重跑');
  }
} else {
  add('M-Gate', MGATE_NAME, MGATE_WEIGHT, null, '', {}, '缺 final/证据包（M 门第二参数必须是证据包目录）');
}

// ② 学术结构三项（权重 10）——**仅当体例适用**才计分
//    实测（2026-09-27）：理论型/评论型论文用 `§N 名称` 标题、没有 IMRaD 节 → structure-check 在 IMRaD
//    模式下 3 项全缺（P0）。那是**体例差异，不是质量缺陷**；把它算成 0 分等于用「实证论文的结构门」
//    给所有理论文章判负。故：**无「方法/结果」节且未显式 `--humanities` → 本分量 N/A**（如实写进 na[]，
//    覆盖率随之下降，而不是悄悄给 0 分）。带 `--humanities` 时走 IMRaD-Alternate（引言/讨论/结论）。
{
  const imradish = hasSection(['方法', '研究方法', '研究设计', 'Method', 'Methods', 'Methodology', '结果', 'Results']);
  if (!imradish && !humanities) {
    add('structure', '学术结构（IMRaD / 引言漏斗 / 讨论四要素）', 8, null, '', {},
      '非 IMRaD 体例（无「方法/结果」节）且未传 --humanities——结构门按 IMRaD 词汇判据会把体例差异记成质量缺陷，故不适用');
  } else {
  const r = runGate('structure', [join(SCRIPTS, 'structure-check.mjs'), draft, ...(humanities ? ['--humanities'] : [])]);
  const j = r.json;
  const cs = j && j.checks ? Object.values(j.checks) : null;
  if (cs && cs.length > 0) {
    const hr = hardRatio(cs);
    add('structure', `学术结构（${humanities ? 'IMRaD-Alternate' : 'IMRaD'} / 引言漏斗 / 讨论四要素）`, 10, hr.ratio,
      `${Math.round(hr.ratio * cs.length)}/${cs.length} 通过` + (cs.filter((c) => !c.pass && c.severity !== 'P2').length ? `｜硬失败：${cs.filter((c) => !c.pass && c.severity !== 'P2').map((c) => Object.keys(j.checks)[cs.indexOf(c)] || '').join(' / ')}` : '') + hr.detailSuffix,
      { pass: cs.filter((c) => c.pass).length, total: cs.length, soft: hr.soft, humanities });
  } else {
    const gf = gateFallback('structure-check', r);
    add('structure', '学术结构（IMRaD / 引言漏斗 / 讨论四要素）', 8, null, '', { invalid: true }, gf.reason);
  }
  }
}

// ③ 方法论可复现三项（权重 5）——**仅当有方法节**（人文学科/评论类通常没有 → N/A，如实说明）
if (hasMethods) {
  const r = runGate('methodology', [join(SCRIPTS, 'methodology-check.mjs'), draft]);
  const j = r.json;
  const cs = j && j.checks ? Object.values(j.checks) : null;
  if (cs && cs.length > 0) {
    const hr = hardRatio(cs);
    add('methodology', '方法论可复现（MC-Form-12 / MC-Exist-11 / MC-Exist-12）', 4, hr.ratio, `${cs.filter((c) => c.pass).length}/${cs.length} 通过` + hr.detailSuffix, { pass: cs.filter((c) => c.pass).length, total: cs.length, soft: hr.soft });
  } else {
    const gf = gateFallback('methodology-check', r);
    add('methodology', '方法论可复现（MC-*）', 4, null, '', { invalid: true }, gf.reason);
  }
} else {
  add('methodology', '方法论可复现（MC-*）', 4, null, '', {}, '本文无「方法 / 研究设计 / Methodology」节（评论类与人文学科通常不适用）');
}

// ④ 引用实质相关三项（权重 10）
if (hasRefs) {
  const r = runGate('cite', [join(SCRIPTS, 'cite-coverage-check.mjs'), draft]);
  const j = r.json;
  const cs = j && j.checks ? Object.values(j.checks) : null;
  if (cs && cs.length > 0) {
    const hr = hardRatio(cs);
    add('cite-coverage', '引用实质相关性（强度 / 冗余 / 年代分布）', 8, hr.ratio,
      `${cs.filter((c) => c.pass).length}/${cs.length} 通过` + (hr.soft.length ? `｜软提示：${hr.soft.join(' / ')}` : ''),
      { pass: cs.filter((c) => c.pass).length, total: cs.length, soft: hr.soft });
  } else {
    const gf = gateFallback('cite-coverage-check', r);
    add('cite-coverage', '引用实质相关性（强度 / 冗余 / 年代分布）', 10, null, '', { invalid: true }, gf.reason);
  }
} else {
  add('cite-coverage', '引用实质相关性（强度 / 冗余 / 年代分布）', 10, null, '', {}, '本文无「参考文献」节');
}

// ⑤ G 项机检 6 项（权重 15）——字数分层 G8 已在其中，不重复计分；G15 为模式相关项、按 N/A 不进分母
/** 未拿到 g-audit JSON 时的分量名（条目数只在能读到 JSON 时才可能因 N/A 变化，这里用脚本的项数口径）。 */
const LABEL_NA = 'G 项机检 6 项（G8/G2/G11/G2.5/G0.5/G15）';
if (existsSync(evidence) && existsSync(brief)) {
  const r = runGate('gaudit', [join(SCRIPTS, 'g-audit-check.mjs'), draft, '--cards', evidence, '--brief', brief]);
  const j = r.json;
  const cs = j && j.checks ? Object.values(j.checks) : null;
  if (cs && cs.length > 0) {
    // **N/A（`applicable: false`，按模式不适用）与 SKIP（`checked: false`，适用但缺输入）必须分清**：
    //   · N/A **不进分母**、不降权、不扣分（如未传 `--qlt` 的 G15——本脚本刻意不传，见文件头 ⑤ 注）；
    //   · SKIP 按缺输入降权（`SKIP ≠ 通过`）。
    //   （v18.41.0：此前只有 SKIP 一种，新增 N/A 后若仍按 `cs.length` 当分母，每个未启用该模式的
    //     项目都会被凭空扣掉 1/6 的 G 项机检分——那会让质量分基线整体漂移。）
    const na = cs.filter((c) => c.applicable === false);
    const applicable = cs.filter((c) => c.applicable !== false);
    const checked = applicable.filter((c) => c.checked);
    const skipped = applicable.filter((c) => !c.checked);
    const LABEL = `G 项机检 ${applicable.length} 项（G8/G2/G11/G2.5/G0.5/G15）`;
    if (checked.length === 0) {
      add('g-audit', LABEL, 12, null, '', {}, `${applicable.length} 项全部 SKIP：${skipped.map((c) => c.skipReason).join('；')}`);
    } else {
      // 与其余分量同口径：**只有 P0/P1 算硬失败**；P2 是候选（如 G8 超限、G2 未命中数字、G15 缺字段），单列不扣分
      const hardFail = checked.filter((c) => c.severity === 'P0' || c.severity === 'P1');
      const softList = checked.filter((c) => c.severity === 'P2');
      add('g-audit', LABEL, 12 * (checked.length / applicable.length), (checked.length - hardFail.length) / checked.length,
        `${checked.length - hardFail.length}/${checked.length} 项无硬失败（另有 ${skipped.length} 项 SKIP 按缺输入降权——**SKIP ≠ 通过**；N/A ${na.length} 项按模式不适用、不进分母${softList.length ? `；P2 候选 ${softList.length} 项不扣分` : ''}）`,
        { pass: checked.length - hardFail.length, checked: checked.length, skipped: skipped.length, na: na.length, applicable: applicable.length, p1: hardFail.length, soft: softList.map((c) => c.name) });
    }
  } else {
    const gf = gateFallback('g-audit-check', r);
    add('g-audit', LABEL_NA, 15, null, '', { invalid: true }, gf.reason);
  }
} else {
  add('g-audit', LABEL_NA, 12, null, '', {},
    `缺 ${existsSync(evidence) ? '' : 'final/证据包 '}${existsSync(brief) ? '' : '01-任务简报.md'}`.trim());
}

// ⑥ G14 中文 AI 痕迹终闸（权重 10）——读报告，不做 LLM 判定
{
  const auditsDir = join(project, 'audits');
  const files = existsSync(auditsDir) ? readdirSync(auditsDir).filter((f) => /^G14.*\.md$/.test(f)) : [];
  if (files.length === 0) {
    add('G14', 'G14 中文 AI 痕迹终闸（读 audits/G14-检测报告-*.md）', 10, null, '', {}, '无 G14 检测报告（主人可在 Phase 0 关闭 G14）');
  } else {
    const latest = files.sort().at(-1);
    const text = readFileSync(join(auditsDir, latest), 'utf8');
    // 判定优先取**最后一条整体判定行**；取不到则按「命中 N 类」的既定阈值反推（0-2 Pass / 3-4 Warning / ≥5 Fail）
    // **v18.48.0（反哺 F-AM，题2 分档臂实测）**：判定词**整体大小写归一**。
    //   旧版只把**首字母**大写（`.replace(/^./, upper)`）→ 报告里写全大写 `PASS` 时归一结果仍是 `PASS`，
    //   与下方 `level === 'Pass'` 的**严格比较**不符 → 该分量被误判为 **0**（实测：同一份报告 L8/L270/L299
    //   三处均判 Pass，仅末段 L415 写「均 PASS」即触发）→ 若不修，A/B 会得出「分档臂题2 崩跌 15.4 分」的
    //   **错误结论**（修正后 69.2 → 80.9）。**判据：凡"读报告得出档位"，判定词必须归一化后再比较。**
    const normLevel = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    let level = null; let how = ''; let conflict = null;
    const verdictLines = [...text.matchAll(/(?:整体判定|本次判定|本轮判定|终闸判定|结论|判定)[^\n。]{0,40}?(Pass|Warning|Fail)/gi)];
    if (verdictLines.length > 0) { level = normLevel(verdictLines.at(-1)[1]); how = '读报告判定行'; }
    const hit = text.match(/命中\s*(\d+)\s*类/);
    // **v18.48.0（反哺 F-AR，对照臂题1 实测）**：**判定行 ↔ 8 类摘要表 交叉校验**。
    //   旧版只读判定行 → 实测存在「判定行写 `命中 3 类 / Warning`，而**同一报告的类别表只列 1 类命中**」的
    //   自相矛盾报告（对照臂题1：表中 E 命中、C 擦边未命中、其余 6 类未命中 → 按闸门阈值应为 Pass），
    //   分数被**不自洽的判定行**带着走（该分量权重 10 → 差 **±4.0 分**）。
    //   **本节只暴露冲突、不静默改分**：8 类表跨模板形态不统一（至少三种表头），自动改写分的风险高于收益
    //   → 输出 `g14_verdict_conflict` 证据字段交 T8/主人裁定。**判据：读数冲突要可见，不要替人做选择。**
    // **计量单位 = 「类」而非「行」**：闸门判定的分母是 8 个**类别**，而同一类别在报告里可能出现在
    // 多张表中（§一 摘要表 + §二/§五 逐类详表）→ 必须按**互异字母**计数，否则行数会把档位推高一档。
    const tableHits = new Map();   // letter -> 判定方式（cell/row），供人工判断可靠性
    const clean = (s) => String(s).replace(/[*_`\s]/g, '');
    for (const line of text.split('\n')) {
      const lm = line.match(/[|｜]\s*\**G14-([A-H])\b/);
      if (!lm) continue;
      const cells = line.split(/[|｜]/).map((s) => s.trim());
      // 表形态跨模板不统一 → **优先按列判**（命中列 = cells[3]、状态列 = cells[5]，两套实测模板同形），
      // 列不足时退回整行启发式，并在证据里标记 `by`（便于人工判断该条可靠性）。
      let isHit; let by;
      if (cells.length >= 6) {
        const c3 = clean(cells[3]); const c5 = clean(cells[5]);
        isHit = (/命中|^是/.test(c3) || /HIT|❌/.test(c5)) && !/^否|未命中|Pass|N\/A|不适用/.test(c3 + c5);
        by = 'cell';
      } else {
        isHit = /HIT|❌|命中/.test(line);
        by = 'row';
      }
      if (isHit && !tableHits.has(lm[1])) tableHits.set(lm[1], by);
    }
    if (level && tableHits.size > 0) {
      const n = tableHits.size;
      const tableLevel = n <= 2 ? 'Pass' : (n <= 4 ? 'Warning' : 'Fail');
      if (tableLevel !== level) conflict = { declared: level, tableLevel, tableHits: [...tableHits.keys()].sort(), by: [...tableHits.values()] };
    }
    if (!level && hit) {
      const n = Number(hit[1]);
      level = n <= 2 ? 'Pass' : (n <= 4 ? 'Warning' : 'Fail');
      how = `按「命中 ${n} 类」与阈值反推（0-2 Pass / 3-4 Warning / ≥5 Fail）`;
    }
    if (!level) {
      add('G14', 'G14 中文 AI 痕迹终闸', 10, null, '', { report: latest }, `报告 ${latest} 里读不到判定行也读不到「命中 N 类」（不猜）`);
    } else {
      const ratio = level === 'Pass' ? 1 : (level === 'Warning' ? 0.6 : 0);
      add('G14', 'G14 中文 AI 痕迹终闸', 10, ratio,
        `${level}（${how}）${hit ? `｜命中 ${hit[1]} 类` : ''}`
          + (conflict ? `｜⚠️ **判定行与类别表不一致**：判定行 = ${conflict.declared}；类别表命中 ${conflict.tableHits.length} 类（${conflict.tableHits.join('/')}）→ 反推 = ${conflict.tableLevel} 。**未自动改分**（表结构跨模板不统一），请据本证据字段裁定（反哺 F-AR）` : ''),
        { report: latest, level, ...(conflict ? { g14_verdict_conflict: conflict } : {}) });
    }
  }
}

// ⑧ 可读性剖面（权重 10）——v18.26.0 QLT-3 接入（报告 §三.4 QLT-3 + §五.1 步骤 7）
//   **为什么要有它**：G14 是**禁用式**链路（禁词/禁式），检测不到「为过门而写得机械」；分布式指标补这一维。
//   口径：四个指标（句长标准差 / >60 字长句占比 / 每 300 字新术语数 / 被动句占比），阈值**由 21 份真实定稿标定**
//   （标定表见 references/checkers/可读性-checker.md）；**最高只判 P2**（文风不是正确性）。
//   本分量**不适用**于极短稿（<20 句时标准差无统计意义 → readabilityEvaluate 内部已按句数设阈）。
{
  const text = readFileSync(draft, 'utf8');
  const a = bodyStartAfterAbstract(text);
  const e = firstEndnoteIndex(text);
  const body = text.slice(a.found ? a.index : 0, e === -1 ? text.length : e);
  const r = readabilityEvaluate(body);
  const m = r.metrics;
  if (m.sentences < 20) {
    add('readability', '可读性剖面（4 指标，阈值 = 21 份定稿标定）', 10, null, '', { metrics: m },
      `句数不足（${m.sentences} < 20）——标准差与占比无统计意义，故不适用`);
  } else {
    add('readability', '可读性剖面（4 指标，阈值 = 21 份定稿标定）', 10, r.pass ? 1 : 0,
      `句长标准差 ${m.sentenceLenStd}｜>60 字长句 ${(m.longSentenceRatio * 100).toFixed(1)}%｜每 300 字新术语 ${m.termRatePer300}｜被动句 ${(m.passiveRatio * 100).toFixed(1)}%`
      + (r.pass ? '（四指标均在标定界内）' : `｜**P2 软提示（不扣分）**：${r.hits.join('；')}`),
      { metrics: m, hits: r.hits, soft: r.pass ? [] : ['可读性剖面'] });
    // **P2 不计入分母**：与其余分量同口径——分数只反映硬失败；文风异常单列给人看
    components[components.length - 1].ratio = 1;
    components[components.length - 1].weighted = 10;
  }
}

// ⑦ 交付完整性（权重 10）
if (existsSync(deliverNote)) {
  const r = spawnSync(NODE, [join(SCRIPTS, 'handoff-check.mjs'), '--project', project, '--role', 'T8', '--require-gates', '--level', 'strict'], { stdio: 'ignore', timeout: 120000 });
  const code = r.status;
  const ratio = code === 0 ? 1 : (code === 22 ? 0.5 : 0);
  add('handoff', '交付完整性（T8 交接门 + 四门留痕）', 10, code === null ? null : ratio,
    code === null ? '' : `handoff-check exit ${code}${code === 0 ? '（通过）' : code === 22 ? '（仅软提示）' : code === 20 ? '（产物缺失/0 字节）' : code === 21 ? '（结构·四门留痕不合）' : ''}`,
    { exit: code }, code === null ? 'handoff-check 子进程未起来' : null);
} else {
  add('handoff', '交付完整性（T8 交接门 + 四门留痕）', 10, null, '', {}, '缺 final/交付说明.md');
}

// --- 汇总 ---
const applicable = components.filter((c) => c.applicable);
const wSum = applicable.reduce((s, c) => s + c.weight, 0);
const wGot = applicable.reduce((s, c) => s + c.weighted, 0);
const naW = components.filter((c) => !c.applicable).reduce((s, c) => s + c.weight, 0);
const score = wSum > 0 ? +(100 * wGot / wSum).toFixed(1) : null;
// v18.57.x（审计修订 P2）：**coverage 的分母必须是实际预算，不能写死 100**。
//   旧式 `(100 − naW) / 100` 假设「适用 + N/A = 100」；而该假设只在部分场景成立——
//   实测 A（g-audit 部分 SKIP 按比例降权）合计 97.6 → 旧式算出 0.68，而真实适用占比是 0.672。
//   现改为「适用权重 ÷ 实际总权重」，与权重表怎么标定无关，恒自洽。
const coverage = +(wSum / (wSum + naW)).toFixed(4);

let baseline = null;
if (baselinePath) {
  const b = readJson(baselinePath);
  if (!b) { console.error(`基线文件不是合法 JSON：${baselinePath}`); process.exit(10); }
  const bById = new Map((b.components || []).map((c) => [c.id, c]));
  baseline = {
    path: baselinePath, score: b.score ?? null, coverage: b.coverage ?? null,
    scoreDelta: (score !== null && typeof b.score === 'number') ? +(score - b.score).toFixed(1) : null,
    perComponent: components.map((c) => {
      const o = bById.get(c.id);
      return {
        id: c.id,
        was: o ? o.ratio : null, now: c.ratio,
        delta: (o && o.ratio !== null && c.ratio !== null) ? +(c.ratio - o.ratio).toFixed(4) : null,
        note: o ? (o.applicable === false && c.applicable ? '本次变为适用' : (o.applicable && !c.applicable ? '本次变为不适用（须在报告里说明）' : null)) : '基线无此分量（新增分量）',
      };
    }),
  };
}

const result = {
  project,
  version: packageVersionTag(),
  score,
  coverage,
  // v18.52.0（反哺 F-BC）：正名 + **效度边界**落盘（机器可读，防「合规分被读成质量分」）
  metric: 'QLT-1',
  metricLabel: '合规分（compliance score）',
  // v18.52.0（反哺 F-S ②）：`handoff` 分量的**语义注明**——它衡量的是**留痕形态**（四门单据 + 闸门记录 +
  //   交接门），**不衡量论文质量**；受控实验里两臂**同为 0** 时属「同口径扣分」→ **臂间可比、跨边界不可比**
  //   （实验侧已在 `run/_AB-QLT5/结论.md` 声明同一事实）。写在 `validity` 里而不是只写在文档里：
  //   读分数的人手里只有这份 JSON。
  componentSemantics: {
    handoff: '衡量**留痕形态**（四门单据 阶段确认-Phase*.md + 闸门记录 + 交接门判据），**不衡量论文质量**；'
      + '受控实验两臂同为 0（实验级批量授权下无四门单据）时属同口径扣分 → **臂间可比、跨本仓金样本基线不可比**',
  },
  // v18.53.0（F-BC ③ / 主人裁定口径 D）：**QLT-6 论证强度**作为**同级独立量尺**随本脚本一并输出。
  //   刻意**不并入**上面的 score（那是合规分）：两者效度不同，相加 = 把两种量混成一个数（F-BC 的病灶）。
  qlt6: evaluateQlt6({ projectDir: project, draftPath: draft }),
  // ── v18.81.0（独立审计批 2 · 盲评一致性统计，批 1 遗留）────────────────────────────────
  // 为什么需要：审计实测「**唯一存在的质量量尺分辨不出读者能看见的差距**」——T9 给模板腔更重、
  //   把 T6 问答体搬进正文的《夫妻收入差异家庭权力》**22/30**，给行文更紧的《县中塌陷》**19/30**，
  //   两篇 QLT-6 都是 21.4。要让这类问题**可见**，唯一可行的第一步是：把「盲评（来源盲）」
  //   与「非盲 T9」对同一稿的打分**并排落盘**并给出差值与档位是否一致。
  // ⚠️ **它不是判据、不改 score、不参与 exit**（与 `flow-metrics` / `quality-score` 同一判据：
  //   度量不是闸门）。**分歧本身不是缺陷，是信息**——一旦挂闸门就会催生「为过线而调分」。
  // 边界（如实）：样本为 0 或 1 时**不给一致率**（n=1 的一致率必然是 100%，那是噪声不是结论）；
  //   仅当两侧都能解析出 `总评分 XX/30` 时才计算。
  reviewAgreement: (() => {
    const band = (t) => (t >= 26 ? 'accept' : t >= 21 ? 'minor' : t >= 16 ? 'major' : 'reject');
    const readTotal = (p) => {
      try {
        const m = /总评分[^\n]*?(\d{1,2})\s*\/\s*30/.exec(readFileSync(p, 'utf8'));
        return m ? Number(m[1]) : null;
      } catch { return null }
    };
    const auditsDir = join(project, 'audits');
    let files = [];
    try { files = readdirSync(auditsDir) } catch { files = [] }
    const t9Files = files.filter((f) => /^审稿报告-v\d+\.md$/.test(f)).sort()
    const blindFiles = files.filter((f) => /^盲评-.+\.md$/.test(f)).sort()
    const t9File = t9Files[t9Files.length - 1] || null
    const t9 = t9File ? readTotal(join(auditsDir, t9File)) : null
    const blind = blindFiles.map((f) => ({ file: f, total: readTotal(join(auditsDir, f)) })).filter((x) => x.total !== null)
    const spread = blind.length >= 2 ? Math.max(...blind.map((x) => x.total)) - Math.min(...blind.map((x) => x.total)) : null
    const comparable = t9 !== null && blind.length >= 1
    // ⚠️ 一致率**只在 n≥2 时给**：n=1 的一致率恒为 1（分母就是它自己）——那是噪声不是结论。
    //   首版写成 `comparable ? … : null` → n=1 时输出 100%，与同一条 note 自述的「不给一致率」**自相矛盾**
    //   （由 `tests/blind-review.test.mjs` Q2 当场抓出）。判据：**说好不给的数，代码里也不许算**。
    const bandAgreement = (t9 !== null && blind.length >= 2)
      ? blind.filter((x) => band(x.total) === band(t9)).length / blind.length
      : null
    return {
      metric: '盲评一致性（measurement，非闸门）',
      t9: t9File ? { file: t9File, total: t9, band: t9 !== null ? band(t9) : null } : null,
      blind: blind.map((x) => ({ ...x, band: band(x.total) })),
      blindFilesSeen: blindFiles.length,
      blindUnparsed: blindFiles.length - blind.length,
      spread,
      bandAgreement,
      notScope: '**不参与 score / 不参与 exit**；分歧不是缺陷（`review-agreement` 的判据与 `flow-metrics` 同源）',
      note: !comparable
        ? '样本不足：需至少一份可解析的 `audits/审稿报告-v*.md` 与一份 `audits/盲评-*.md`（各含 `总评分 XX/30`）——**不给数字，不给「通过」**'
        : (blind.length < 2
          ? `n=1：只报告差值（Δ=${blind[0].total - t9}），**不给一致率**（n=1 的一致率恒为 100%，是噪声不是结论）`
          : `n=${blind.length}：差值 ${blind.map((x) => x.total - t9).join(' / ')}（盲评 − T9）`),
    };
  })(),
  validity: {
    scope: '合规与成本',
    notScope: '论证质量',
    why: '每个分量都是**门计数代理**（门通过率 / 档位 / 是否过门 / 阈值区间 / 单据形态）→ 门计数不变则分数不动，与「内容是否变好」无因果关系',
    measured: 'QLT-5 题2 臂 B：关闭 10 条实质论证条件（4 P0 + 6 P1，经 T7 独立实读判 10/10 关闭）+ 文风净化（E 类装饰性 → 0）→ 分数变动 0.0（78.1 → 78.1，逐分量完全相同），成本 +41.4M',
    downstream: '凡以本分差论证「质量提升」的结论一律无效，须回标本条（F-BC）；要测论证强度须另建独立于门的量尺（QLT-6），不得复用门计数',
  },
  ...(coverage < 0.8 ? { coverageWarning: `适用权重仅 ${Math.round(coverage * 100)}%——分数只覆盖了部分判据，**不得**当整体质量结论（na 列表见下）` } : {}),
  weights: { applicable: wSum, na: naW },
  components,
  na: components.filter((c) => !c.applicable).map((c) => ({ id: c.id, weight: c.weight, reason: c.naReason || '未产出可用结果' })),
  ...(baseline ? { baseline } : {}),
  meta: {
    timestamp: new Date().toISOString(),
    description: '论衡文章**合规分**（QLT-1 compliance score，v18.52.0 正名）/ v18.26.0 QLT-1+QLT-3 / scripts 白名单 25→26',
    notes: '**度量不是闸门**（分数不影响退出码）。不新造判据：只聚合既有机械门结果。'
      + 'N/A 分量不进分母但必须看 coverage；SKIP ≠ 通过。机制改动前后各跑一次，差异写进反哺报告。'
      + '**只支撑「合规与成本」的结论**（各分量都是门计数代理）——不得用来支撑任何「论证质量」主张（F-BC）。',
  },
};

cleanup();
const output = JSON.stringify(result, null, 2);
if (reportPath) {
  const { writeReport } = await import('./_lib/destructive-write.mjs');
  writeReport(reportPath, output, { protect: [draft] });
} else {
  console.log(output);
}
process.exit(0);
