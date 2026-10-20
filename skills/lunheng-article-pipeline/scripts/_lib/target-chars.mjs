// _lib/target-chars.mjs —— 目标字数解析（v18.12.3 新增：全量审计 L-56 同族发现的**静默跳过**缺陷）
//
// 为什么单独抽出来：`apply-revision-cycle.mjs` 与 `apply-compression-cycle.mjs` 各自内联了一份
//   `/(?:目标篇幅|篇幅)[^\n]*?(\d{4,5})/`。实测（2026-09-25）该正则在**四类完全合法的写法**上都返回 null：
//     · `目标篇幅：300 字`      —— 3 位数（3000 字档的轻量文章，SKILL.md 明确支持 ≥2000 字）
//     · `篇幅：800 字`          —— 同上
//     · `目标篇幅：12,000 字`   —— 千分位（人写大数的常见形态）
//     · `目标篇幅：1.2 万 字`   —— 中文数量级单位
//   而 `target === null` 的后果是 **`charBand = null` → G8 字数硬阈整段判定被跳过**，脚本**不报错、exit 0**，
//   `recommendation` 变成「（未解析到目标字数，跳过 G8 字数硬阈判定）」。即：**闸门在最需要它的短稿档位上静默失效**，
//   而主控看到 exit 0 会认为「字数硬阈已核」。故本模块的职责不只是「解析得更全」，还有**「解析不到必须说出来」**。
//
// 口径：
//   · 数值边界 `MIN_TARGET`–`MAX_TARGET`：低于该值不像「长文目标」，高于该值不像本包场景 →
//     一律视为**解析可疑**（返回 `value: null` + `suspect` 说明），由调用方提示人工确认，
//     而不是当成有效目标去判字数归属 G8（错误的目标会产出错误的 P0）。
//   · 允许的分隔与单位：半/全角冒号、千分位逗号、`万` / `千` / `k` / `K`。

export const MIN_TARGET = 300;
export const MAX_TARGET = 200000;

/** 数字 + 数量级 → 字数（`1.2 万` → 12000；与下方两条解析路径共用同一口径）。 */
const magValue = (n, mag) => {
  const base = Number(n);
  if (!Number.isFinite(base)) return NaN;
  if (mag === '万') return Math.round(base * 10000);
  if (mag === '千' || /[kK]/.test(mag || '')) return Math.round(base * 1000);
  return Math.round(base);
};

/** 匹配「目标篇幅 / 篇幅」行，并把数字（含千分位与数量级单位）抽出。
 *  **v18.23.0 EFF-1 修复（粗体形态静默漏解析）**：旧式 `(?:目标篇幅|篇幅)\s*[:：]` 要求字段名**紧跟**冒号，
 *    而任务简报的**实际写法是粗体**——`- **篇幅**：**16000 字**`（`**` 夹在字段名与冒号之间）→ 不匹配 →
 *    `value = null` → 调用方（`apply-revision-cycle` / `apply-compression-cycle`）**静默跳过 G8 字数硬阈**
 *    且 exit 0。这与本模块 header 记的 v18.12.3 缺陷**同类**（那次只补了「位数 / 千分位 / 数量级」三形态，
 *    粗体形态漏在同一处）。实测依据：`run/海外驻军-主权分离/01-任务简报.md:17` 即该形态。
 *  现允许字段名与冒号之间出现至多 4 个 Markdown 强调字符（`*` / `_` / 反引号）或空白；
 *    末尾同样允许——`：**16000 字**` 的数字前也带 `**`。 */
const LINE_RE = /(?:目标篇幅|篇幅)[\s*_`]{0,4}[:：][\s*_`]{0,4}([^\n]{0,24})/;

/**
 * 解析任务简报里的目标字数。
 * @param {string} briefText 01-任务简报.md 的全文
 * @returns {{ value: number|null, raw: string|null, reason: string }}
 *   `value` 为 null 时**必须由调用方提示**（reason 说明为什么：没找到 / 数字不像目标值）。
 */
export function parseTargetChars(briefText) {
  const text = String(briefText || '');
  const m = text.match(LINE_RE);
  if (!m) return { value: null, raw: null, reason: '未找到「目标篇幅：」或「篇幅：」行' };

  const raw = m[1].trim();
  // ── v19.21.0（反哺 2026-10-20 插件级 §7）：**档位下限 ≠ 点目标** ────────────────────────
  //   病灶（A12 实测）：简报「篇幅：≥5000 字（全量档）」被解析成 point target 5000，
  //   审计视图据此把 7,900 字判「> 5000×1.2 = 6000」并打显著超限标记——**合规稿被判超限 31%**，
  //   若无人工判断会误触发一轮精简。根因：SKILL 的四档本身就用「≥5000」这种**下限写法**，
  //   而本函数把所有数字都当点目标。
  //   判据（**逐数字判性质，不按「首个数字」一刀切**）：① 窗口里出现「目标 N」→ 以 N 为准；
  //         ② 否则取**第一个非档位数字**（点目标 / 区间端点）；③ 若**所有**数字都是档位下限
  //            （`≥` / `>` / `至少` / `不少于` / 后缀「以上」）→ **返回 null 并说明**，由调用方
  //            响亮提示「G8 跳过」——**宁可未核，不可用错误目标去判**。
  //   反例驱动：`- **篇幅**：**16000 字**（≥5000 全量流水线档）` 里 16000 是点目标、5000 是档位；
  //   只取「首个带 ≥ 的数字」会把它误判成纯档位（v18.23.0 的既有用例当场抓出）。
  const goal = raw.match(/目标[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万|千|[wWkK])?/)
  if (goal) {
    const v = magValue(goal[1], goal[2])
    if (v < MIN_TARGET) return { value: null, raw, reason: `「${raw}」的「目标 ${goal[1]}」低于下限 ${MIN_TARGET}——不像长文目标` }
    if (v > MAX_TARGET) return { value: null, raw, reason: `「${raw}」的「目标 ${goal[1]}」高于上限 ${MAX_TARGET}` }
    return { value: v, raw, reason: '' }
  }
  const cleanRaw = raw.replace(/,/g, '');
  const tokens = [];
  for (const x of cleanRaw.matchAll(CAND_NUM_RE)) {
    const v = magValue(x[1], x[2]);
    if (!Number.isFinite(v)) continue;
    if (v < MIN_TARGET || v > MAX_TARGET) continue;   // 页码/百分比等噪声不进「目标」候选
    const before = cleanRaw.slice(0, x.index);
    const after = cleanRaw.slice(x.index + x[0].length);
    const isBand = /(?:≥|>|至少|不少于)\s*$/.test(before) || /^\s*(?:字|汉字)?\s*(?:以上|起)/.test(after);
    tokens.push({ v, isBand });
  }
  if (tokens.length > 0) {
    const point = tokens.find((t) => !t.isBand);
    if (!point) {
      return { value: null, raw, reason: `「${raw}」是**档位下限**（≥/以上写法），不是点目标——G8 需要一个「目标字数：N」；请在简报同时写「档位」与「目标字数」（模板已拆两字段）` }
    }
    const value = point.v;
    if (value < MIN_TARGET) return { value: null, raw, reason: `解析得 ${value}，低于下限 ${MIN_TARGET}——不像「长文目标」（是写错单位，还是把页码/条数写进了这行？）` };
    if (value > MAX_TARGET) return { value: null, raw, reason: `解析得 ${value}，高于上限 ${MAX_TARGET}——不像本包场景的目标字数` };
    return { value, raw, reason: '' };
  }
  // 先判「万 / 千 / k」数量级，再剥千分位逗号（顺序不能反：`1.2 万` 里没有逗号，但 `12,000` 有）
  //   ⚠️ 不用 `\b?`：`\b` 是零宽断言，加量词是语法错误（本模块初版即踩，加载期直接 SyntaxError）
  const wan = raw.match(/(\d+(?:\.\d+)?)\s*(?:万|[wW])/)
  const qian = raw.match(/(\d+(?:\.\d+)?)\s*(?:千|[kK])/)
  const plain = cleanRaw.match(/\d+(?:\.\d+)?/)

  let value = null;
  if (wan) value = Math.round(Number(wan[1]) * 10000);
  else if (qian) value = Math.round(Number(qian[1]) * 1000);
  else if (plain) value = Math.round(Number(plain[0]));

  if (value === null || !Number.isFinite(value)) return { value: null, raw, reason: `「${raw}」里没有可识别的数字` };
  if (value < MIN_TARGET) return { value: null, raw, reason: `解析得 ${value}，低于下限 ${MIN_TARGET}——不像「长文目标」（是写错单位，还是把页码/条数写进了这行？）` };
  if (value > MAX_TARGET) return { value: null, raw, reason: `解析得 ${value}，高于上限 ${MAX_TARGET}——不像本包场景的目标字数` };
  return { value, raw, reason: '' };
}

// ── v18.23.0 EFF-1（G 项机检）新增：**多候选**解析 ──────────────────────────────
// `parseTargetChars` 的契约是「**一个**目标值」，供 G8 字数硬阈使用；但简报的篇幅字段在真实项目里是
//   **多数字、多形态**的（实测 21 个项目的 01-任务简报）：
//     · `- **篇幅**: ≥5000 → 全量流水线｜**目标字数 ≈ 8000**（学术综述…）`  ← 档位下限 + 真目标两个数
//     · `- **篇幅**：3000-5000 字（标准档，9 角色全量）`                  ← 区间
//     · `**类型 / 篇幅**：学术评论文 / 1500-2500 字（短测试）`            ← 前缀还有类型
//     · `| 篇幅 | 约 8000 字（中文） |`                                  ← **表格形态（无冒号）**
//     · `- **总字数**：6000 字（±5%，容差 5700-6300）`                    ← 字段名是「总字数」
//   只取「第一个数字」会把 `≥5000` 当成目标（实测偏差 1.6×），只认冒号会把表格形态整条漏掉（测到 4 个项目 SKIP）。
//   故本函数返回**全部候选值**（供调用方做「落在候选区间内」判定）+ 原始行，**不**替调用方选一个目标——
//   选哪个是语义判断（哪个数才是目标）且简报可能本身已过期（另有项目明文写「主人已确认字数不作硬规定」）。
//
// 覆盖五类字段名 + 表格形态；`万 / 千 / k` 数量级与千分位逗号沿用同一口径。
// v18.73.0（F-13 真因）：**补 `目标正文`** —— 实测简报写的是「- **目标正文 12000 汉字**（首要落点…）」，
//   旧正则无此字段名 → 整行匹配不上 → 落到**上一行的裸「篇幅」**（见下方 `TARGET_FIELD_RE` 的说明）。
const CAND_LINE_RE = /(目标篇幅|目标字数|目标正文|篇幅|总字数)\s*[:：|]?\s*([^\n|]{0,60})/;
// v18.73.0（F-13 真因）：**「目标\*」族字段优先于裸「篇幅」/「总字数」**。
//   真因（实测《不能评估的忠诚》简报行 17–20）：
//     行 17 `- **篇幅**: ≥5000（全量流水线档）；**字数三线制（主人明示「1万字以上」）**：`
//       → 命中「篇幅」，其**后 60 字窗口内有 5000（档位下限）与 1万→10000（主人硬下限）** —— **两个都不是目标**；
//     行 18 `- **目标正文 12000 汉字**（首要落点…）` → **才是真正的目标**。
//   旧实现「**首个有候选的命中即返回**」→ 行 17 已产候选 {5000,10000} → **永远走不到行 18**；
//   后果：判定区间取成 [5000,10000]，实测 11205 → 「1.121× 超上界」**假阳性**（11205/10000=1.1205，与本项目当年读数逐位吻合）。
//   ⚠️ 旧实现那条「逐条命中试到出候选为止」的注释只修了「首个命中**无**候选」的情形，
//     **没修「首个命中有候选、但候选来自非目标字段」**——本条补的正是后者。
//   ⚠️ **不改「下限进候选」的语义**：`g-audit-check.test.mjs` 明确断言「档位下限与目标**都进候选**」
//     （判据是「落在候选区间内」）。本条只改**选哪一行**，不改**行内取哪些数**。
const TARGET_FIELD_RE = /^目标/;
const CAND_NUM_RE = /(\d+(?:\.\d+)?)\s*(万|千|[wWkK])?/g;

/**
 * 解析简报里的**篇幅候选值**。
 * @returns {{ line: string|null, raw: string|null, candidates: number[], pointValues: number[], bandValues: number[], reason: string }}
 *   `candidates` 为去重升序的全部候选（已展开万/千/k，并过滤到 [MIN_TARGET, MAX_TARGET]）；
 *   `pointValues` / `bandValues` 是 v19.21.0（反哺 2026-10-20 插件级 §7）新增的**性质拆分**：
 *   前者 = 非「≥ / > / 以上 / 至少」写法的数字（点目标或区间端点），后者 = 档位下限。
 *   存量消费者只读 `candidates`（行为不变）；「超限 ×1.2 显著标记」这类**需要点目标**的消费者应优先 `pointValues`。
 */
export function parseTargetCandidates(briefText) {
  const text = String(briefText || '');
  // ⚠️ 必须**逐条命中试到出候选为止**，不能只取第一个命中：实测有简报把小节标题写成
  //   `## 三、篇幅与结构`（命中「篇幅」但后面 60 字内没有字数）→ 只取首个命中会得到「无候选」的假 SKIP，
  //   而真正的字段行 `- **总字数**：6000 字（±5%）` 就在几行之后。
  const attempts = [];
  const hits = [];   // v18.73.0（F-13）：{ field, line, raw, candidates } —— 供「目标*族优先」择优
  for (const m of text.matchAll(new RegExp(CAND_LINE_RE.source, 'g'))) {
    const field = m[1] || '';
    const raw = (m[2] || '').trim();
    attempts.push(raw);
    // F-1（policy 真试跑反哺）：千分位逗号必须**先剥再匹配**——`6,000` 会被 `\d+` 拆成 `6`+`000`（都过滤掉）、
    //   `5,880` 拆出 `880`（恰好落在 [MIN_TARGET,MAX_TARGET]）→ 候选只剩 880 的「假超限」；剥逗号后 6000/5880/6120 正确入候选。
    //   同源：`parseTargetChars` 的 plain 分支早已 `raw.replace(/,/g,'')`，本函数漏了这一步 → 两函数对同一输入不一致。
    const clean = raw.replace(/,/g, '');
    const nums = [];
    const pointNums = [];
    const bandNums = [];
    for (const x of clean.matchAll(CAND_NUM_RE)) {
      const v = magValue(x[1], x[2]);
      if (!Number.isFinite(v)) continue;
      if (v < MIN_TARGET || v > MAX_TARGET) continue;
      nums.push(v);
      // 档位判据与 parseTargetChars 同源：前缀 `≥`/`>`/`至少`/`不少于`，或后缀「以上/起」。
      const before = clean.slice(0, x.index);
      const after = clean.slice(x.index + x[0].length);
      const isBand = /(?:≥|>|至少|不少于)\s*$/.test(before) || /^\s*(?:字|汉字)?\s*(?:以上|起)/.test(after);
      if (isBand) bandNums.push(v); else pointNums.push(v);
    }
    const candidates = [...new Set(nums)].sort((a, b) => a - b);
    if (candidates.length > 0) {
      hits.push({
        field, line: m[0], raw, candidates,
        pointValues: [...new Set(pointNums)].sort((a, b) => a - b),
        bandValues: [...new Set(bandNums)].sort((a, b) => a - b),
      });
    }
  }
  // v18.73.0（F-13 真因）：**先用「目标*」族字段的命中**，只有它一个都没有时才退回首处有候选的命中。
  //   为什么：裸「篇幅 / 总字数」行常同时含**档位下限**与**主人硬下限**（都不是目标），
  //   而真正的目标往往写在**下一行的「目标正文」**里（旧实现因「首处有候选即返回」永远看不到它）。
  const pick = (h) => ({ line: h.line, raw: h.raw, candidates: h.candidates, pointValues: h.pointValues, bandValues: h.bandValues, reason: '' });
  const preferred = hits.find((h) => TARGET_FIELD_RE.test(h.field));
  if (preferred) return pick(preferred);
  if (hits.length > 0) return pick(hits[0]);
  if (attempts.length === 0) return { line: null, raw: null, candidates: [], pointValues: [], bandValues: [], reason: '未找到「篇幅 / 目标篇幅 / 目标字数 / 目标正文 / 总字数」字段行' };
  return { line: null, raw: attempts[0], candidates: [], pointValues: [], bandValues: [], reason: `命中了 ${attempts.length} 处「篇幅」类字样但都没有落在 ${MIN_TARGET}–${MAX_TARGET} 区间内的数字（首处：「${attempts[0]}」）` };
}
