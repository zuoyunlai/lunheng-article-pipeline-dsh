// QLT-6 论证强度（argument strength）—— v18.53.0 落地（QLT-5 反哺 F-BC ③ / 主人 2026-09-28 裁定取「D 双分量」）
//
// ── 为什么需要它 ────────────────────────────────────────────────────────────────────────────
// QLT-1（合规分）的每个分量都是**门计数代理** → 门计数不变则分数不动。实测（题2 臂 B）：关掉 10 条
//   实质论证条件（4 P0 + 6 P1，T7 独立实读判 10/10 关闭）后，QLT-1 **一个分量都没动**（78.1 → 78.1），
//   成本 +41.4M。⇒ 要回答「论证有没有变强」，必须有一条**独立于门**的量尺。
//
// ── 口径（固定，不得即兴改）────────────────────────────────────────────────────────────────
//   QLT-6 = 50% × ① 审稿判断（T9 六维和值，归一化） + 50% × ② 论证缺陷闭合率（机械计数）
//
//   ① 审稿判断：取**最新整合审稿报告** `audits/审稿报告-vN.md`（**不含** `审稿报告-T9-x-*` 三视角分件——
//      三视角口径混用正是 F-AC 反例）的 `总评分 XX/30`（口径 = 六维**求和**，v18.51.0 F-AC 已钉；
//      算术自洽由 M-Exist-6 兜底）。归一化沿用期刊匹配表的同一式（单一真源）：
//          norm = clamp((总评分 − 16) / 14, 0, 1)     ← 16 = reject 上界，30 = 满分
//      为什么用整合报告：它是**唯一的求和口径**产出，且是人的判断量（不是门计数）。
//
//   ② 论证缺陷闭合率：**批判报告**（T6）的条件集 ↔ **指纹绑定的复核报告**（T7）的关闭裁定。
//      · 条件集 S：优先取批判报告「§关闭状态」段里报告**自己声明的清单**（`- **P0/C1-1** …`，即它对下一轮
//        的可测契约）；该段无清单时退回**全文 P0/P1 攻击条目标题**（`### [P1-C2-3] …`）；两者皆空 → N/A。
//      · 关闭数 C：某条件被计为关闭 ⟺ 在**绑定当前正文**的复核报告里，**该条件所在的块**（到下一个标题
//        为止）出现「判定…关闭」且块内不含「未关闭 / 部分关闭」。
//      · **指纹绑定（关键，不是可选）**：复核报告必须**声明过被审正文的指纹**且与当前 `final/定稿.md` 的
//        sha256 前 12 位一致。为什么必须：关闭是**对某一版正文**的判定——v4 的复核报告判「已关闭」，
//        对 v3 的正文不成立。实测：绑定宽松版会让 v3 快照「借」v4 的复核报告拿到 10/10，
//        阳性对照的位移归零（**假绿**：量尺自称已标定，实则测不出任何改善）。
//
// ── 纪律（与 QLT-1 / QLT-3 同源）────────────────────────────────────────────────────────────
//   · **度量不是闸门**：分数高低不影响任何退出码（本模块不 process.exit）。
//   · **N/A 不进分母，但必须报 coverage**（`applicable weight / 100`）——只报分数不报覆盖率 = 给「缺料」满分。
//   · **不新造阈值**：本量尺只出数，不设「多少算好」（阈值须先标定，见 `validity.calibration`）。
//   · **不得与 QLT-1 相加**：合规分 + 论证强度拼一个总分，等于把两种效度混成一个数（那是 F-BC 的病灶）。
//
// ── 标定（完成前不得用于结论）────────────────────────────────────────────────────────────────
//   阳性对照 = `run/AB-共锁-B` 的 v3 → v4（10 条条件 0 → 10 关闭）。判据：**QLT-6 必须产生非零位移且
//   位移来自 ②**（QLT-1 实测位移 = 0.0）。标定结论见 `CALIBRATION` 常量与 `run/_AB-QLT5/QLT6-标定.md`。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

/** 标定状态：`uncalibrated` 时**不得**用于任何结论（本仓先例：QLT-3 先标定再设界）。 */
export const CALIBRATION = {
  status: 'pass',
  calibratedAt: '2026-09-29',
  positiveControl: 'run/AB-共锁-B 初稿-v3 → 初稿-v4（批判报告-v2 §关闭状态 的 10 条条件：0 → 10 关闭）',
  criterion: 'QLT-6 位移必须 ≠ 0，且位移须来自 ② 本身（不是「分量从 N/A 变适用」的假位移）',
  evidence: 'v3 快照 QLT-6 = 21.4（① 0.4286 / ② 0.0，无绑定裁定 → 保守 0）→ v4 QLT-6 = 71.4（① 0.4286 / ② 1.0，'
    + '复核报告-v2 绑 v4 判 10/10 关闭）；**Δ = +50.0 且全部来自 ②**；同一对上 QLT-1 **Δ = 0.0**（与冻结读数一致）。'
    + '记录见 `run/_AB-QLT5/QLT6-标定.md` 与 `QLT6-标定.json`',
  caveat: '标定样本 = **1 个阳性对照（单项目单对）**——足以证明「它对该类改善敏感」，**不足以**给出阈值或跨项目可比性；'
    + '跨项目比较前先对齐 ② 的条件集来源与 closureBasis（见 validity.boundary）',
  /** v18.80.4（QLT-6 跨体例盲评批，2026-10-08）：**盲评**样本 6 组 × 2 判者 = 12 件（3 体例：学术理论 / 学术描述性 / 公众号评论）。
   *  预注册与判据冻结见 `audits/预注册-QLT6-跨体例盲评-v1.md`；复算台 `scripts/qlt6-blind-analysis.mjs`（import 本文件的 `normalizePanel`）。 */
  blindReview: {
    at: '2026-10-08',
    design: '复用 golden 三例的早期稿与后期稿（**零新流水线**），每稿 2 名独立盲评判者；载荷由 `scripts/blind-review-pack.mjs` 去标识生成，钥匙（编号↔项目）与载荷物理分离。**v18.80.5 扩样**：主人批准对 ACAD-T 追加 2 判者/稿（n=4）',
    n: '6 稿 / **16 件有效盲评**（ACAD-T 每稿 4 件、其余每稿 2 件；另有 **2 件因「总评分 ≠ 六维之和」的算术失误被判不合规、未计入**——机械门当场抓出）',
    H1_同尺性: '**不达标**：三体例 ① 均值 0.036 / 0.143 / 0.518（ACAD-D / ACAD-T / PUB，n=4/8/4）；两两差 **0.107（D↔T，扩样后落到判据内）** / 0.482（D↔PUB） / 0.375（T↔PUB）⇒ **① 不得跨体例横比**。⚠️ 差异**无法归因**于「尺子偏置」还是「稿件真实差异」（本设计无锚定质量标尺，且各体例的锚点释义按预注册 §5-4 分别冻结）；扩样使 D↔T 的差从 0.161 落到 0.107 ⇒ 该差别本身也不稳定',
    H2_判者一致性: '**不达标**：6 对同稿 ① 绝对差**均值 0.131 > 0.10 判据**（扩样前 0.095 侥幸在线内）；总分差均值 2.17、**最大 7**（ACAD-T-01：22/19/19/15）；**有 2 对 > 硬上限 0.20**',
    H4_敏感性: '**不达标**：判者平均 Δ(晚−早) = ACAD-D **+1.5**、ACAD-T **−1.75**、PUB **+0.5** ⇒ 方向不一致；且**改稿位移（最大 1.75）< 判者噪声（均值 2.17 / 极差 7）** ⇒ **① 分不清「改稿」与「换判者」**（扩样前该比较是 3.5 vs 3、结论暧昧；扩样后才定论）',
    floor_saturation: '**① 下界饱和（机械缺陷，与样本无关）**：`clamp` 下界 = reject 上界 16 ⇒ 总评分 ≤16 一律映射为 **0**（实测多件如此；15 与 16 的 ① 同为 0.0000）。**v18.80.5 已按动议 A 补 `evidence.ratioRaw`（不夹取）暴露差异**，合成口径未改（不动既有标定）',
    decision: '**不切换**：① 的输入源**保持**知情 `audits/审稿报告-vN.md`。依据 = 预注册 §3 H2 条款（判者一致性不达标 ⇒ 先扩判者数再谈标定，**不进入切换讨论**）；09 卡 §🕶 末条的「样本 ≥3 组」**只是必要条件**，不是充分条件。⚠️ 扩样后 H2 **更差**（均值 0.095 → 0.131），不切换的决定被强化',
    usageRule: '**① 只作单稿绝对读数**（v18.80.5 动议 C-2）：**不得用于稿间/轮次间比较**（信噪比 ≈ 1）；稿间比较走 ②（条件关闭率，指纹绑定、可复算）。低分段差异读 `evidence.ratioRaw`。**不得跨体例横比**',
    nextSteps: '① 若要用 ① 作稿间比较，判者数须先大到把离散压到待测位移之下（本批实测：n=4 仍不够——极差 7 > 位移 1.75）；② 修 `clamp` 下界的饱和（分段映射）并重新标定，但**须先具备标定手段**；③ 若要论「跨体例可比」，须先造**锚定质量标尺**（同稿跨体例改写或专家锚点），否则 H1 的差异永远不可归因',
  },
};

const WEIGHTS = { panel: 50, closure: 50 };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
/** ① 分量（审稿判断）的归一化：`clamp((总评分 − 16) / 14, 0, 1)`。
 *  **为什么导出**（v18.80.4 · QLT-6 跨体例盲评批）：跨体例盲评要**离线**把盲评件的 `总评分 XX/30`
 *  喂进同一式子（盲评件不在产物的 `audits/` 里，`evaluateQlt6` 读不到），若在分析脚本里另写一份
 *  公式就是「同一事实两处实现」——必然漂。故此处导出为**单一真源**，分析脚本 import 它。
 *  ⚠️ **已知边界（本批实测暴露，重要）**：16 分及以下一律映射为 **0**（clamp 下界＝「reject 上界」），
 *  故 ① 在低分段**完全饱和**、不可区分（实测两稿 15/30 与 16/30 的 ① 同为 0.0000）。 */
export const normalizePanel = (total) => clamp((Number(total) - 16) / 14, 0, 1);
const norm12 = (s) => String(s || '').toLowerCase().slice(0, 12);
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** `P0/C1-1` 与 `P0-C1-1` 归一为同一键（实测两种写法并存：§关闭状态用斜杠、标题用连字符）。 */
const canonId = (sev, dim, n) => `${sev}-${dim}-${n}`;
const ID_RE = /(P[012])\s*[-/／]\s*(C\d+)\s*[-‐‑]\s*(\d+)/g;

/** 取某几个目录下 `<前缀>-vN.md` 中 N 最大者（与 `_lib/mgate-helpers.mjs:latestReport` 同口径，本地实现避免循环依赖）。 */
const latestOf = (dirs, prefix) => {
  let best = null;
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const m = f.match(new RegExp(`^${prefix}-v(\\d+)\\.md$`));
      if (!m) continue;
      const n = Number(m[1]);
      if (!best || n > best.n) best = { path: join(dir, f), name: f, n };
    }
  }
  return best;
};

/** 取一段文本里出现的全部条件 id（规范化、去重、保序）。导出供单元用例直接钉口径。 */
export const idsIn = (text, { onlyP01 = true } = {}) => {
  const out = [];
  const seen = new Set();
  for (const m of String(text).matchAll(ID_RE)) {
    if (onlyP01 && m[1] === 'P2') continue;
    const id = canonId(m[1], m[2], m[3]);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

/**
 * 条件集 S：优先「§关闭状态」段里报告自述的清单；无则退回全文 P0/P1 标题。
 * @returns {{conditions: string[], source: string, strictCount: number}}
 */
export const conditionSet = (critText) => {
  const lines = critText.split('\n');
  // 标题式 id（`#### [P0-C1-1] …` / `### [P1-C2-3] …`）——作为退回集与 strict 计数
  const headed = [];
  for (const l of lines) if (/^#{2,4}\s/.test(l)) headed.push(...idsIn(l));
  // 「关闭状态」段（标题含「关闭状态」）→ 段内清单条目 `- **P0/C1-1** …`
  const sIdx = lines.findIndex((l) => /^#{2,4}\s/.test(l) && /关闭状态/.test(l));
  let declared = [];
  if (sIdx !== -1) {
    for (let i = sIdx + 1; i < lines.length; i++) {
      if (/^#{2,4}\s/.test(lines[i])) break;
      if (/^\s*[-*]\s/.test(lines[i])) declared.push(...idsIn(lines[i]));
    }
  }
  declared = [...new Set(declared)];
  const headedUniq = [...new Set(headed)];
  if (declared.length) return { conditions: declared, source: '§关闭状态 自述清单', strictCount: headedUniq.length };
  return { conditions: headedUniq, source: headedUniq.length ? '全文 P0/P1 攻击条目标题（无自述清单）' : '无可解析条件', strictCount: headedUniq.length };
};

/**
 * 该复核报告是否**绑定**当前正文：只认「**被审对象**」的指纹。
 *
 * 实测踩到的坑（v18.53.0 标定第一轮 FAIL）：复核报告的头部**同时**列了被审稿与基线对照稿的 sha
 *   （`> **被审正文**：…v4… / F267D06A…` + `> **基线对照**：…v3… / 193993010373…`）→ 用「指纹段内任意
 *   hex 命中即绑定」的口径会把 **v3 快照**也绑到 v4 的复核报告上，于是 v3 的闭合率也变成 10/10、
 *   阳性对照位移归零（**假绿**）。现收紧为：
 *     · 候选行 = 含 12+ hex，且 ① 行内出现「被审/评审对象/评分对象」等**对象**词，或 ② 位于节标题含
 *       「指纹」的段内且行内含 指纹/sha256；
 *     · **排除**任何含「基线/对照/旧稿/上一版/原稿/变更前/未触动」的行——那是**另一版正文**的指纹。
 */
export const binds = (text, curSha) => {
  const want = norm12(curSha);
  const lines = text.split('\n');
  let inFp = false;
  for (const l of lines) {
    if (/^#{2,4}\s/.test(l)) { inFp = /指纹/.test(l); continue; }
    const hexes = [...l.matchAll(/\b[0-9a-fA-F]{12,64}\b/g)].map((m) => m[0]);
    if (!hexes.length) continue;
    if (/基线|对照|旧稿|上一版|原稿|变更前|前一版|未触动|old/i.test(l)) continue;
    const isReviewed = /被审(正文|对象|稿件)|评审对象|评分对象/.test(l) || (inFp && /(指纹|sha256)/i.test(l));
    if (!isReviewed) continue;
    if (hexes.some((h) => norm12(h) === want)) return true;
  }
  return false;
};

/**
 * 在绑定复核报告里，某条件 id 是否被判「关闭」。
 *
 * **块内判定 + 标题锚优先**（v18.53.0 两处修）：
 *   ① 旧实现取「该 id 首次出现处起 +15 行」为窗口 → **下一个条件**的「判定 | **未关闭**」会落进上一个条件的
 *      窗口，`return false` 把本该关闭的前一条也判掉（实测：三条条件全被判未关闭）；
 *   ② 改为「窗口截到下一个标题行」后仍有一坑：判定正文里的**交叉引用**（「判定 | **关闭**（与 P0/C2-1 同源）|」）
 *      会让被引用的那条以**错误的行**为锚 → 于是**锚点必须优先取标题行**（T7 的实际写法 =
 *      `### 2.1 P0/C1-1 = P1/C7-2（同源）`，同源两条共用同一块，两条同判）。
 *   判据：块 = 锚行到下一个标题行（无标题锚时取首个提及行 + 12 行兜底）；**否定优先只在块内生效**。
 */
export const judgedClosed = (text, id) => {
  const lines = text.split('\n');
  const has = (l) => idsIn(l).includes(id) || l.includes(id);
  let anchor = lines.findIndex((l) => /^#{2,4}\s/.test(l) && has(l));   // ① 标题锚优先
  if (anchor === -1) {
    anchor = lines.findIndex(has);                                     // ② 无标题锚 → 首个提及行
    if (anchor === -1) return false;
  }
  let end = Math.min(lines.length, anchor + 12);
  for (let j = anchor + 1; j < end; j++) if (/^#{2,4}\s/.test(lines[j])) { end = j; break; }
  const block = lines.slice(anchor, end);
  let sawClose = false;
  for (const w of block) {
    if (/未关闭|未全部关闭|部分关闭|仍未关闭|未实质关闭/.test(w)) return false;      // 否定优先（块内）
    if (/判定|结论|状态/.test(w) && /关闭/.test(w)) sawClose = true;
  }
  return sawClose;
};

/**
 * 计算 QLT-6。**纯函数式**：只读产物，不写盘、不 exit。
 * @param {{projectDir: string, draftPath: string}} args
 */
export const evaluateQlt6 = ({ projectDir, draftPath }) => {
  const auditsDir = join(projectDir, 'audits');
  const notes = [];
  const na = [];
  const curSha = existsSync(draftPath) ? sha256(draftPath) : null;
  const curVer = (basename(draftPath).match(/-v(\d+)\.md$/) || [, null])[1];

  // ── 分量 ①：审稿判断（T9 整合报告的总评分）──
  const panel = { id: 'panel', name: '审稿判断（T9 整合报告 总评分/30）', weight: WEIGHTS.panel, applicable: false, ratio: null, weighted: null, evidence: {} };
  const rep = latestOf([auditsDir], '审稿报告');
  if (!rep) {
    panel.naReason = '无 audits/审稿报告-vN.md（T9 未启用或未到 Phase 4.5）';
    na.push({ id: panel.id, weight: panel.weight, reason: panel.naReason });
  } else {
    const rt = readFileSync(rep.path, 'utf8');
    // 口径与 M-Exist-6 同源（同一正则族）；只认**整合报告**（三视角分件名不以 `-vN` 结尾，故天然排除）
    const m = rt.match(/总评分[^\d]{0,8}(\d{1,2}(?:\.\d)?)\s*\/\s*30/) || rt.match(/总分[^\d]{0,12}(\d{1,2}(?:\.\d)?)\s*\/\s*30/);
    if (!m) {
      panel.naReason = `${rep.name} 内无「总评分 XX/30」（口径 = 六维求和）`;
      na.push({ id: panel.id, weight: panel.weight, reason: panel.naReason });
    } else {
      const total = Number(m[1]);
      const norm = normalizePanel(total);
      panel.applicable = true;
      panel.raw = total;
      panel.ratio = +norm.toFixed(4);
      panel.weighted = +(panel.weight * panel.ratio).toFixed(3);
      // v18.80.5（QLT-6 跨体例盲评批·动议 A）：evidence 里**另给不夹取的原始比率** `ratioRaw`。
      // 为什么（实测）：① 用 `clamp(...,0,1)` 而**下界 = reject 上界 16** ⇒ 总评分 ≤16 一律 0，
      //   低分段（弱稿→合格稿的改善区间）**分辨率被抹平**（实测 12 件盲评里 3 件如此，15/30 与 16/30 的 ① 都是 0.0000）。
      // 为什么**只加读数、不改合成**：改映射会作废 v18.53.0 的阳性对照标定（Δ=+50），而首轮盲评实测
      //   判者一致性**不达标**（H2 ❌）⇒ 当前没有能把新映射标定出来的手段。故先让差异**可见**，标定能力到位再谈改口径。
      panel.evidence = {
        source: `audits/${rep.name}`,
        totalRaw: `${total}/30`,
        ratioRaw: +(total / 30).toFixed(4),
        saturatedAtFloor: total <= 16,
        formula: 'clamp((总评分 − 16) / 14, 0, 1)',
      };
      // ── v18.65.0（反哺报告-v5 §v5.3-2 的 C2 变体）：**逐维明细**（不新增尺、不参与计分）──
      // 为什么只加明细而不造新框架：① QLT-6 已经把「论证强度」这把尺建好了（有标定），再拼一个总分
      //   就等于把两种效度混成一个数（F-BC 的病灶本仓已明文禁止）；② 但「总评分 24/30」这个数**看不清
      //   哪一维拖后腿** —— 而审稿人给分与作者改稿需要的正是这个定位信息。故只把**已有的**六维分
      //   从报告里解析出来并列，**不动 ① 的 ratio/weighted，也不动总分**。
      // 形态实测（`run/共锁-自愿性理论的第四象限/audits/审稿报告-v2.md`）：`### 1. 原创性（4/5）` ×6。
      const dims = [...rt.matchAll(/^#{3,4}\s*\d+\.\s*([^（(\n]{1,24}?)\s*[（(]\s*(\d(?:\.\d)?)\s*\/\s*5\s*[）)]/gm)]
        .map((mm) => ({ dimension: mm[1].trim(), score: Number(mm[2]), max: 5, ratio: +(Number(mm[2]) / 5).toFixed(4) }));
      if (dims.length) {
        panel.evidence.byDimension = dims;
        const minR = Math.min(...dims.map((d) => d.ratio));
        const weakest = dims.filter((d) => d.ratio === minR);
        notes.push('① 逐维明细（**不参与计分**，只用于定位）：'
          + dims.map((d) => `${d.dimension} ${d.score}/${d.max}`).join(' ｜ ')
          + (weakest.length === dims.length
            ? `；**各维同分（${weakest[0].score}/${weakest[0].max}），无相对短板**`
            : '；最低维 = ' + weakest.map((d) => `${d.dimension} ${d.score}/5`).join('、')));
      } else {
        panel.evidence.byDimension = [];
        notes.push('① 未解析出逐维明细（该审稿报告无 `### N. 名称（x/5）` 形态的六维标题）——只给总评分，**不影响 ① 的计分**');
      }
      const verLine = rt.match(/评审版本[^\n]{0,40}?v(\d+)/) || rt.match(/被审[^\n]{0,16}?v(\d+)/);
      if (verLine && curVer && verLine[1] !== curVer) {
        panel.stale = true;
        panel.evidence.reviewedVersion = `v${verLine[1]}`;
        notes.push(`${rep.name} 自述评审版本 v${verLine[1]}，而当前正文为 v${curVer} → ① 是**较早时点的判断**（如实附注，不因此改判 N/A）`);
      }
    }
  }

  // ── 分量 ②：论证缺陷闭合率（批判报告条件集 ↔ 指纹绑定的复核裁定）──
  const closure = { id: 'closure', name: '论证缺陷闭合率（批判报告条件 ↔ 指纹绑定的复核裁定）', weight: WEIGHTS.closure, applicable: false, ratio: null, weighted: null, evidence: {} };
  const crit = latestOf([join(projectDir, 'analysis'), join(projectDir, 'final', '证据包')], '批判报告');
  const reviews = [];
  if (existsSync(auditsDir)) {
    for (const f of readdirSync(auditsDir)) if (/^复核报告-v\d+\.md$/.test(f)) reviews.push(join(auditsDir, f));
  }
  if (!crit) {
    closure.naReason = '无 批判报告-vN.md（T6 未运行或轻量档跳过）';
    na.push({ id: closure.id, weight: closure.weight, reason: closure.naReason });
  } else {
    const critText = readFileSync(crit.path, 'utf8');
    const { conditions, source, strictCount } = conditionSet(critText);
    if (!conditions.length) {
      closure.naReason = `${crit.name} 无可解析的条件 id（§关闭状态 无清单，全文亦无 P0/P1 条目标题）`;
      na.push({ id: closure.id, weight: closure.weight, reason: closure.naReason });
    } else {
      const bound = reviews.filter((p) => {
        try { return curSha ? binds(readFileSync(p, 'utf8'), curSha) : false; } catch { return false; }
      });
      // 无绑定裁定 → **保守按未关闭计（0）**，而不是 N/A。为什么：
      //   本仓对「关闭状态」的既有语义就是「真源 = 复核报告」（M-Exist-4：尚无复核报告时**不得**标「已关闭」）
      //   → 缺独立裁定 ⇒ 不算已关闭。这同时使标定的阳性对照有意义：共锁-B v3（无绑定裁定 → 0/10）
      //   → v4（复核报告-v2 绑 v4 → 10/10）位移 = ② 本身在动，而不是「分量从 N/A 变成适用」的假位移。
      //   代价（如实声明）：**可能低估**（正文或已改善、只是缺对该版的裁定），故读数必须连带 `closureBasis` 一起读。
      const closedIds = bound.length ? conditions.filter((id) => bound.some((p) => judgedClosed(readFileSync(p, 'utf8'), id))) : [];
      const ratio = closedIds.length / conditions.length;
      closure.applicable = true;
      closure.raw = { closed: closedIds.length, total: conditions.length };
      closure.ratio = +ratio.toFixed(4);
      closure.weighted = +(closure.weight * closure.ratio).toFixed(3);
      closure.evidence = {
        critReport: `analysis/${crit.name}`,
        conditionSetSource: source,
        closureBasis: bound.length ? 'bound-verdict（指纹绑定的复核裁定）' : 'no-bound-verdict（无对**本版正文**的裁定 → 保守计 0，可能低估）',
        conditions,
        closed: closedIds,
        open: conditions.filter((id) => !closedIds.includes(id)),
        boundReviews: bound.map((p) => basename(p)),
        unboundReviews: reviews.filter((p) => !bound.includes(p)).map((p) => basename(p)),
        strictP01Count: strictCount,
      };
      notes.push(`② 计分用「${source}」（${conditions.length} 条）；同报告 P0/P1 条目全量为 ${strictCount} 条（非计分，供核对是否只挑了易关的条目）`);
      // ── v18.65.0（C2 变体，同 ①）：**逐域明细**（按条件 id 里的 C1–C7 域聚合，不参与计分）──
      // 它回答的是「哪一类反方攻击反复出现且没被回应」——这是闭合率一个总数看不出来的定位信息。
      const byDomain = (() => {
        const m = new Map();
        for (const id of conditions) {
          const dm = (id.match(/-(C\d+)-/) || [])[1] || 'other';
          const e = m.get(dm) || { domain: dm, proposed: 0, closed: 0, openIds: [] };
          e.proposed += 1;
          if (closedIds.includes(id)) e.closed += 1; else e.openIds.push(id);
          m.set(dm, e);
        }
        return [...m.values()]
          .map((e) => ({ ...e, closureRatio: +(e.closed / e.proposed).toFixed(4) }))
          .sort((a, b) => a.domain.localeCompare(b.domain, 'en'));
      })();
      closure.evidence.byDomain = byDomain;
      if (byDomain.length) {
        const unclosed = byDomain.filter((d) => d.closureRatio < 1);
        notes.push('② 逐域明细（**不参与计分**，只用于定位）：'
          + byDomain.map((d) => `${d.domain} ${d.closed}/${d.proposed}`).join(' ｜ ')
          + (unclosed.length
            // 只给「域(关闭/提出)」——逐条 openId 在 `components[1].evidence.byDomain[].openIds` 里，
            //   不在这里展开（note 是给人扫一眼的；30 条 id 挤一行会把可读性打掉）
            ? '；未闭合域 = ' + unclosed.map((d) => `${d.domain}(${d.closed}/${d.proposed})`).join('、')
            : '（**全部域已闭合**）'));
      }
      if (!bound.length) {
        notes.push(`② 无绑定当前正文指纹的复核报告（已在 ${reviews.length} 份里找过）→ **保守计 0**（未关闭）——`
          + '读数属于**低估方向**，跨项目比较前先看 `closureBasis`');
      }
    }
  }

  const components = [panel, closure];
  const applicable = components.filter((c) => c.applicable);
  const wSum = applicable.reduce((s, c) => s + c.weight, 0);
  const wGot = applicable.reduce((s, c) => s + c.weighted, 0);
  const naW = components.filter((c) => !c.applicable).reduce((s, c) => s + c.weight, 0);
  const score = wSum > 0 ? +(100 * wGot / wSum).toFixed(1) : null;
  const coverage = +((100 - naW) / 100).toFixed(4);

  return {
    metric: 'QLT-6',
    metricLabel: '论证强度（argument strength）',
    score,
    coverage,
    ...(coverage < 1 ? { coverageWarning: `适用权重 ${wSum}/100——本条只覆盖了 ${applicable.length}/2 个分量，**不得**当整体论证强度结论（na 列表见下）` } : {}),
    weights: { applicable: wSum, na: naW },
    components,
    na,
    notes,
    validity: {
      scope: '论证强度（判断量 + 缺陷闭合的合成代理）',
      notScope: '合规面与成本（那是 QLT-1 与成本口径的事）；也不是「论文整体质量」的定论',
      why: '两个分量都不是「质量」的定义式，而是**代理**：① 是审稿人的判断量（独立于门计数，但仍是 LLM 判断）；'
        + '② 是「缺陷有没有真被关掉」的机械计数（依赖 T6 的条件集与 T7 的独立实读）。故本量尺回答的是'
        + '「加固轮之后，判断与缺陷闭合有没有一起动」，不是「谁写得更好」',
      boundary: '② 依赖**指纹绑定**的复核裁定：绑不上本版正文时**保守按未关闭计 0**（与 M-Exist-4「关闭真源 = 复核报告」同口径）'
        + '——**该读数是低估方向**（正文或已改善而缺裁定），故必须连带 `components.closure.evidence.closureBasis` 一起读；'
        + '① 若审稿报告绑的是较早版本，会标 `stale` 但计入（如实附注）。两分量条件集来源可能不同（自述清单 / 标题全集），'
        + '已在 `components.closure.evidence.conditionSetSource` 写明——**跨项目比较前先对齐这一点**。'
        // v18.80.5（动议 C-2）：① 的用途收窄 + 两条实测边界
        + '**① 的用途与边界（v18.80.5 跨体例盲评实测，n=6 稿 × 2 判者）**：① **只作单稿绝对读数**，'
        + '**不得用于「稿间/轮次间比较」**——实测同稿换判者的总分差（均值 1.5、最大 3）与改稿位移（+0.5 ~ −3.5）**同量级**，'
        + '信噪比 ≈ 1；稿间比较请走 ②（条件关闭率，有指纹绑定、可复算）。'
        + '另：① 在 **≤16 分饱和为 0**（下界 = reject 上界）⇒ 低分段差异请读 `evidence.ratioRaw`（不夹取）而非 `ratio`；'
        + '**① 亦不得跨体例横比**（三体例均值实测 0.036 / 0.197 / 0.518，且该差异**不可归因**于尺子偏置还是稿件差异）',
      noSum: '**不得与 QLT-1 相加**：合规分 + 论证强度拼一个总分 = 把两种效度混成一个数（F-BC 的病灶）',
      byDomainNote: '**逐维 / 逐域明细（v18.65.0）只用于定位**（哪一维拖后腿、哪一类反例没被回应）——'
        + '它们**不参与计分**（score 只由 ① 的 ratio 与 ② 的闭合率按 50/50 合成），**不得另算总分、不得与 QLT-1/QLT-6 相加**；'
        + '逐维来自审稿报告的 `### N. 名称（x/5）` 标题（无该形态则空数组，不影响 ① 计分），'
        + '逐域来自条件 id 的 `C1–C7` 段（无对应段则归 `other`）',
      calibration: CALIBRATION,
    },
    meta: {
      description: '论衡论证强度（QLT-6，v18.53.0 落地；主人 2026-09-28 裁定口径 D = 审稿判断 + 缺陷闭合率）',
      notes: '**度量不是闸门**（不影响退出码）。N/A 不进分母但必须看 coverage。**标定未通过前不得用于任何结论**。',
    },
  };
};
