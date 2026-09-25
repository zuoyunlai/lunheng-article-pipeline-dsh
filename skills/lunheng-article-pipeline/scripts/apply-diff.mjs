#!/usr/bin/env node
// 论衡段级 diff 应用脚本（v18.2.5 新增，主控实战反哺 P2）
// 用法：node apply-diff.mjs <目标正文.md> <段级diff清单.md> [--out <输出.md>] [--dry-run] [--in-place] [--report <path>]
//   --out      = 输出路径（推荐显式给下一版路径，如 drafts/初稿-v4.md）
//   --dry-run  = 只试算、不写盘（**建议先跑一次核对抽取结果**）
//   --in-place = **显式声明**要原地覆盖输入正文（此时自动写一份带时间戳的 .bak）；不给 --out 又不给 --in-place → exit 10
//   --report   = 落 JSON 报告
// 口径：汉字计数走 `_lib/han.mjs`（与 count-chars.mjs 同源）——delta 由脚本**实测**，不由清单自报
// 退出码：0 = 全部条目应用 / 1 = 部分跳过或清单解析出 0 条（需人工处理）/ 10 = 参数或路径错误
//
// v18.2.6 审计修复（第三方审计 v18.2.5 B-4「假成功 + 默认原地覆盖」P0）：
//   ① 参数解析旧版过松——`--out`（缺值）与拼错的 `--dry-rnu` 都被**静默忽略**，用户以为在试运行、实际会落盘；
//      现未知参数 / 缺值 / 多余位置参数一律打印用法 + exit 10。解析器本体与 build-evidence-bundle 共用
//      `_lib/cli-args.mjs`（唯一实现——同类「静默降级」在一个仓库里出现两次，说明守卫写在调用处一定会漂）；
//   ② 旧版 `outPath = optVal('--out') || targetPath` = **默认原地覆盖输入正文**且不写 .bak → 一次手滑即丢正文；
//      现「目标 == 输入正文」必须显式 `--in-place`，且任何覆盖（原地或 --out 指向已存在文件）都先落带时间戳 .bak；
//   ③ 旧版 `items.length === 0`（清单解析出 0 条）仍走 `ok:true` + hint「全部条目已机械应用」+ exit 0 ——
//      与「真的全应用了」在输出上不可区分（假成功）；现 ok:false + 明说「清单未解析出任何条目」+ exit 1，且**不写盘**
//      （避免产出一份与输入逐字相同的「下一版」被当成已修订版往下游流）。
//   ④ `text.replace(locateStr, head+newPart+tail)` 旧版用**字符串替换串**，`$$` / `$&` / `` $` `` / `$'` 会被展开
//      （实测 `$$`→`$`，把行间公式降级为行内——学术论文是支持类型）；现改函数式回调，替换串一律字面量。
//
// 为什么需要本脚本（主控实战反哺 P2）：
//   段级 diff 模式（v2.5.2-dsh.7）为省 token 让 T5 只出清单、由主控逐条 edit——实测单项目
//   4 轮修订共 **83 条 diff**、主控 ≈82 次 edit 调用，且清单的「估算字数」与 `count-chars.mjs`
//   口径不一致（标点/编号被算进"字"）导致每轮多耗一次返工（本项目 v3：清单预估 8452、
//   实测 8863）。本脚本把「机械应用 + 汉字 delta 实测」两件事交给代码，主控只做核对与仲裁。
//
// 解析策略（best-effort，容错多形态）：
//   ① 条目分隔：行首 `[Diff N]` / `[P0-n]` / `[P1-n]` / `[C-n]` 四族（v18.12.3 L-59 收窄：此行**只认这四族**，
//      旧版「任意 `[x]` 行」会把正文引用 `[L01]`/`[D01]` 当条目头 → 真 diff 静默丢失）；
//   ② 每条取「现况」行与「修改」（或「增补」）行——允许 `- **现况**：` / `  现况：` 等多种前缀；
//   ③ old/new 抽取用**最小差异法**（最长公共前缀 + 最长公共后缀），而非只取引号内内容——
//      后者对「引号内相同、差异在引号外」的条目（如给括号内补一个编号）会抽空。
//      最小差异法同时覆盖 替换 / 插入 / 删除 三类，且不要求 T5 用某种固定引号。
//   ④ 剥离「修改」行尾的元注记（`（按 G14 报告 C-01）` 等），避免把注记写进正文。
// 安全约束：old 在目标文件内**必须唯一**——多处匹配一律跳过并报告（交主控按行号人工处理）。
import { readFileSync, existsSync } from 'node:fs';
import { countHan } from './_lib/han.mjs';
import { installExitGuard, requireExistingFile } from './_lib/exit-guard.mjs';
import { sameFile, realPath, writeWithSafety, writeReport } from './_lib/destructive-write.mjs';   // 破坏性写策略（v18.2.6；v18.12.0 加报告守卫）
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs';   // 参数解析唯一实现（v18.2.6）
import { causalStrength, CAUSAL_RANK } from './_lib/causal.mjs';   // 因果强度守恒（v18.3.0 方案）
installExitGuard();

const argv = process.argv.slice(2);
const USAGE = '用法: node apply-diff.mjs <目标正文.md> <段级diff清单.md> [--out <输出.md>] [--dry-run] [--in-place] [--report <path>]';

// v18.2.6（B-4）：**先解析、后放行**——未知/缺值/多余的参数一律 exit 10（旧的 `argv.includes` + `optVal` 会静默吞掉拼错的旗标）。
//   解析器本体在 `_lib/cli-args.mjs`（与 build-evidence-bundle 共用同一份，防同类缺陷再漂）；
//   「打印用法 + exit 10」留在本文件——退出码是对主控的契约，且 repo-hygiene-check 的退出码门按文件静态核验。
const usageExit = (why) => { console.error(why); console.error(USAGE); process.exit(10); };
let flags, opts, positionals;
try {
  ({ flags, opts, positionals } = parseArgs(argv, {
    flags: ['--dry-run', '--in-place'],
    values: { '--out': 'drafts/初稿-v4.md', '--report': 'audits/apply-diff-report.json' },
    minPositionals: 2,
    maxPositionals: 2,
    positionalHint: '<目标正文.md> <段级diff清单.md>',
  }));
} catch (e) {
  if (e && e.code === USAGE_CODE) usageExit(e.message);
  throw e;   // 其他异常交 installExitGuard 归类（fs 类 10 / 内部 70）
}
const [targetPath, listPath] = positionals;

for (const [p, what] of [[targetPath, '目标正文'], [listPath, 'diff 清单']]) {
  if (!existsSync(p)) { console.error(`${what}不存在: ${p}`); process.exit(10); }
  requireExistingFile(p, what);
}
const dryRun = flags.has('--dry-run');
const inPlace = flags.has('--in-place');
const outPath = opts['--out'] || targetPath;
const reportPath = opts['--report'];

// ---- 写盘目标判定（v18.2.6，B-4）：默认原地覆盖已取消 ----
//   旧版 `outPath = optVal('--out') || targetPath` → 只给两个位置参数时**默认覆盖输入正文且不留 .bak**，
//   与「修订轮产出下一版」的语义相反（一次手滑即丢正文）。现：目标 == 输入正文 → 必须显式 --in-place。
//   同文件判定走 `_lib/destructive-write.mjs`（resolve + realpath + win32 去大小写；不自己写字符串比较）。
//   ⚠️ 判定本身（exit 10）**下沉到清单解析之后**——因为「清单解析出 0 条」必须先报（见下方顺序说明）。
const overwritesTarget = sameFile(outPath, targetPath);
if (inPlace && !overwritesTarget) {
  console.error(`⚠️ --in-place 与 --out（指向别处：${outPath}）同时给出：本次写到 --out，--in-place 不生效`);
}

// ---- 元注记剥离（防「（按 XX 报告 NN）」写进正文）----
// v18.13.0（全量审计 L-57 收口）：**判据收窄为「括号内含 ≥2 个 ASCII（数字/字母）」**。
//   旧版 `[（(](?:按|参|依据|参见|详见|对应|v\d)[^）)]{0,60}[）)]$` 的意图边界是「元注记」，实际边界是
//   「行尾任何以这些词开头、60 字以内的括号」——审计实测与本次复现（见下用例）均确认它会删掉**正文**：
//     `文字（对应的系数）` → `文字`（尾括号被删，且 ok:true、exit 0）
//     `结论（依据上述分析）` → `结论`
//     `新段落第一句（详见第三节）` → `新段落第一句`
//   三条都是**静默数据丢失**：替换后的正文少了一段，而工具报「全部条目已机械应用」。
//   新判据：**元注记的特征是括号里带报告/角色/轮次标识**（`G14 报告 C-01` / `M-Form-5` / `v2` / `§3`），
//   这些一律含 ≥2 个 ASCII 字符（数字或拉丁字母）；而正文括号（`对应的系数` / `详见第三节` / `依据上述分析`）
//   是**纯汉字**。故以「≥2 个 ASCII」为界，并保留 `strippedMeta` 留痕（剥离了什么可事后核对）。
//   边界（如实）：若正文括号里恰好含两个以上拉丁字符（如 `（见 appendix 表）`），仍会被剥——但那种写法在
//   本包的中文稿里极少，且**留痕可见**；宁可漏剥（留痕少一条），不要静默多剥（丢正文）。
const META_TAIL = /\s*[（(](?=[^）)]*[0-9A-Za-z][^）)]*[0-9A-Za-z])[^）)]{2,60}[）)]\s*$/u;
// v18.2.9（第三方审计 B11）：记录被剥离的注记，防「（依据上述分析）」类正文括号被静默改写后无迹可查
const strippedMeta = [];
const stripMeta = (s) => {
  const m = s.match(META_TAIL);
  if (m && m[0].trim()) strippedMeta.push(m[0].trim());
  return s.replace(META_TAIL, '').trim();
};

// ---- 最小差异法：返回 {oldPart, newPart, at, prefixLen, suffixLen} ----
const extractDelta = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return {
    oldPart: a.slice(i, a.length - j),
    newPart: b.slice(i, b.length - j),
    at: i,
    prefixLen: i,
    suffixLen: j,
  };
};

// ---- 带上下文的定位（v18.2.5 修：纯插入场景的关键）----
//   只拿 oldPart 去目标文件里找是**不够**的：当差异是「纯插入」时（如给 `[L10]` 后补
//   `（辅助证据）`），oldPart 往往退化成 1 个空格甚至空串 → 「出现 2117 次」→ 只能跳过。
//   改用「公共前缀尾 + oldPart + 公共后缀头」构造定位串，并**自适应扩大上下文**直到唯一。
const locateAndReplace = (text, oldPart, newPart, a, i, j) => {
  for (const CTX of [8, 16, 32, 64]) {
    const L = Math.min(i, CTX);
    const R = Math.min(j, CTX);
    const from = i - L;
    const to = a.length - j + R;
    const locateStr = a.slice(from, to);
    if (!locateStr) continue;
    const n = occurrences(text, locateStr);
    if (n !== 1) continue;
    const head = locateStr.slice(0, L);
    // v18.7.2（P0-1 致命修复，全量审计实证）：旧偏移 `L - from + oldPart.length` 在公共前缀 i > CTX 时为
    //   `2L - i + oldPart.length` < 正确值，tail 会多取 `i - 2L` 个字符——把 oldPart 尾部 + 前缀字符
    //   **重复注入**目标文本且报告 ok:true（静默损坏修订稿）。正确偏移 = 定位串内 `head(L) + oldPart` 之后 = `L + oldPart.length`。
    const tail = locateStr.slice(L + oldPart.length);
    // v18.2.6（B-4 附带修）：旧版把 `head + newPart + tail` 当**字符串替换串**传进去 → `$$` / `$&` / `` $` `` / `$'`
    //   会被 String.replace 展开（实测 `$$`→`$`，把行间公式降级为行内）。改**函数式回调**，替换文本一律按字面量插入。
    return { ok: true, text: text.replace(locateStr, () => head + newPart + tail), ctx: CTX, locateStr };
  }
  return { ok: false };
};

// ---- 解析清单 ----
const stripMd = (s) => s
  .replace(/^\s*[-*]\s*/, '')            // 列表符
  .replace(/^\s*\*\*[^*]*\*\*\s*[:：]?\s*/, '')  // `**现况**：` / `**修改**：`
  .replace(/^\s*(?:现况|修改|增补|定位|估算|估算字数|依据|验收|说明|优先级)\s*[:：]\s*/u, '')
  .trim();

const listLines = readFileSync(listPath, 'utf8').split('\n');
// v18.13.0（全量审计 L-59 收口）：条目头正则**改为显式前缀白名单**。
//   旧版 `^\s*(?:#{1,6}\s*)?\[(?:Diff\s+)?([A-Za-z]?\d+[-\w.]*)[^\]]*\]` 会把**任意**方括号编号行当条目头，
//   于是正文里合法的引用行（本包 `[L01]`/`[D01]`/`[C01]`）也被吞掉 —— 审计实测与本次复现：
//     `[L01] 备注：这条是正文引用` → **被当条目头**（id=L01）→ 真 diff 被吞、applied=0、exit 1。
//   本包 T7/T5 的清单里出现被引用的编号并不罕见（反哺项常引 `[D01]`），故这是**现实**风险。
//   新判据：只认 4 个清单族 —— `[Diff N]` / `[P0-n]` / `[P1-n]` / `[C-n]`；其余方括号行一律不作条目头。
//   ⚠️ 副作用（已在头注释同步）：旧版「任意 `[1]`/`[2]` 纯数字行」也算条目头，现**不再算**——见下方
//   `unparsedHeads` 提示（有方括号行但 0 条解析时点名，避免又变成静默）。
const HEAD_RE = /^\s*(?:#{1,6}\s*)?\[(?:Diff\s+(\d+)|P([01])-(\d+)|C-(\d+))[^\]]*\]/;
const headId = (m) => (m[1] ? `Diff ${m[1]}` : m[2] ? `P${m[2]}-${m[3]}` : `C-${m[4]}`);
const items = [];
let cur = null;
// v18.13.0（L-58 收口）：**记住被丢弃的非空行**。旧版 `for` 里三条 if 全不命中就 `continue` ——
//   多行「现况」的**续行**被静默丢弃 → 半截替换照样报 ok:true（审计实测：正文残留旧句而 hint 说「全部已应用」）。
//   现把「该条目正文范围内、既非定位/现况/修改、又非空」的行记进 `droppedLines`，随 unparsed 一起上报。
const droppedLines = [];
const unparsedHeads = [];
for (let n = 0; n < listLines.length; n++) {
  const line = listLines[n];
  const m = HEAD_RE.exec(line);
  if (m) {
    if (cur) items.push(cur);
    cur = { id: headId(m), line: n + 1, cur: null, new: null, loc: '', rawLoc: '', dropped: [] };
    continue;
  }
  // 方括号开头但**不属于四个清单族**的行：只在 `cur` 之外时收集，供「0 条解析」时点名
  if (!cur && /^\s*(?:#{1,6}\s*)?\[[^\]]+\]/.test(line)) unparsedHeads.push({ line: n + 1, text: line.trim().slice(0, 60) });
  if (!cur) continue;
  if (/^\s*(?:[-*]\s*)?(?:\*\*)?定位(?:\*\*)?\s*[:：]/u.test(line)) { cur.loc = stripMd(line); cur.rawLoc = line.trim(); continue; }
  // 「现况」可能写成 `- **现况**：` / `  现况：` / `现况：「…」`
  if (/^\s*(?:[-*]\s*)?(?:\*\*)?现况(?:\*\*)?\s*[:：]/u.test(line)) { cur.cur = stripMd(line); continue; }
  if (/^\s*(?:[-*]\s*)?(?:\*\*)?(?:修改|增补|改为)(?:\*\*)?\s*[:：]/u.test(line)) { cur.new = stripMd(line); continue; }
  // 其余非空、非注释行 → 丢弃并留痕（缩进续行、忘了写标签的行都落这里）
  const t = line.trim();
  if (t && !/^<!--/.test(t) && !/^[-*_]{3,}$/.test(t)) {
    cur.dropped.push(n + 1);
    droppedLines.push({ id: cur.id, line: n + 1, text: t.slice(0, 60) });
  }
}
if (cur) items.push(cur);

const parsed = items.filter((it) => it.cur && it.new);
const unparsed = items.filter((it) => !it.cur || !it.new);
const emptyList = items.length === 0;   // v18.2.6（B-4 ③）：清单解析出 0 条——见下方两处判定的顺序说明

// v18.13.0（L-59 收口配套）：**解析出 0 条但文件里明明有方括号行** → 必须点名，不得只说「未解析出任何条目」。
//   旧版这种情况下主控只能靠猜（是清单空？还是格式不对？）——本轮把条目头收窄为四个清单族后，
//   「非四族前缀（如 `[L01]`/`[1]`）」会落进这一支，故**点名到行**是必要配套。
if (emptyList && unparsedHeads.length) {
  console.error(`⚠️ 清单里找到 ${unparsedHeads.length} 个方括号行，但**都不是**可识别的条目头（只认 [Diff N] / [P0-n] / [P1-n] / [C-n]）：`);
  for (const h of unparsedHeads.slice(0, 5)) console.error(`   · 第 ${h.line} 行: ${h.text}`);
  console.error('   → 若是清单格式写错，请改成上述四种前缀之一；若这些行本就是**正文引用**（`[L01]`/`[D01]`），它们不该出现在清单里。');
  console.error('   （v18.12.3 前，任意 `[x]` 行都被当条目头 → 正文引用会被吞掉、真 diff 静默丢失）');
}

// v18.13.0（L-58 收口）：**丢弃行必须上报**。只要条目正文里有既非「定位/现况/修改」又非空的行，
//   就说明清单里有内容没被吃进 old/new —— 多行「现况」的续行是最常见形态，后果是**半截替换仍报 ok**。
//   判据：有不规则行 → 计入 unparsed（走既有的 exit 1 通道），并在 stderr 逐条点名。
if (droppedLines.length) {
  console.error(`⚠️ 清单里有 ${droppedLines.length} 行**既不是定位/现况/修改、也不为空**，未参与替换：`);
  for (const d of droppedLines.slice(0, 5)) console.error(`   · [${d.id}] 第 ${d.line} 行: ${d.text}`);
  console.error('   → 最常见原因是**多行「现况」的续行**（旧版会静默丢弃 → 半截替换仍报 ok）。');
  console.error('   → 处置：把该条目的「现况」写成一行，或把续行显式并入前一行后重跑。');
}

// ---- 写盘目标策略（v18.2.6，B-4）：默认原地覆盖已取消 ----
//   顺序刻意如此：**「清单解析出 0 条」先报**（清单路径/格式坏了是更根本的错误；审计实测的复现命令
//   `apply-diff <正文> <空清单>` 就该落在这一支，报 exit 1 + 「清单未解析出任何条目」），
//   只有清单确实有条目、才轮到「原地覆盖必须显式 --in-place」（exit 10）。
//   两支都不写盘，故先后只影响「报哪个错更贴因」，不影响数据安全。
if (!emptyList && overwritesTarget && !inPlace) {
  console.error(`写入目标与输入正文是同一文件（会原地覆盖源正文）: ${realPath(targetPath)}`);
  console.error('→ 退出码 10：原地覆盖必须**显式**声明，二选一：');
  console.error(`   ① 写到下一版（推荐，源正文保持原样）: node apply-diff.mjs ${targetPath} ${listPath} --out drafts/初稿-v4.md`);
  console.error(`   ② 原地覆盖（脚本会自动写一份带时间戳的 .bak）: node apply-diff.mjs ${targetPath} ${listPath} --in-place`);
  process.exit(10);
}

// ---- 逐条试算 ----
let text = readFileSync(targetPath, 'utf8');
const beforeHan = countHan(text);
const applied = [];
const skipped = [];
// v18.3.0 方案（G 体系机械下沉）：causal 守恒——改稿时因果强度升级（中/弱档 → 强档）且改动段内无新增引用 → 记 P2 提示
const causalUpgrades = [];
// v18.3.0 阶段 2（G 体系机械下沉）：数值/单位守恒——改稿时数值静默漂移 → P2 提示（机械只挑「数字变了」，是否故意修正归主控/T7）
const numericDrift = [];
const numsOf = (s) => (String(s ?? '').replace(/\[(?:L|D|C|先)\d+(?:-基-\d+)?\]/g, '').match(/\d+(?:\.\d+)?/g) || []);   // strip 引用编号后取数字
const occurrences = (haystack, needle) => {
  if (!needle) return 0;
  let c = 0, idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) { c++; idx += needle.length; }
  return c;
};

for (const it of parsed) {
  const curTxt = stripMeta(it.cur);
  const newTxt = stripMeta(it.new);
  const { oldPart, newPart, prefixLen, suffixLen } = extractDelta(curTxt, newTxt);
  if (!oldPart && !newPart) { skipped.push({ id: it.id, line: it.line, reason: '现况与修改无差异（抽取为空）' }); continue; }
  // causal 守恒（P2 提示，不阻断应用）：旧→新 因果强度升级，且改动段内无新增 [Lxx]/[Dxx]/[Cxx] 引用
  const causalOld = causalStrength(oldPart);
  const causalNew = causalStrength(newPart);
  if (CAUSAL_RANK[causalNew] > CAUSAL_RANK[causalOld] && !/\[(?:L|D|C)\d+\]/.test(newPart)) {
    causalUpgrades.push({ id: it.id, line: it.line, from: causalOld, to: causalNew });
  }
  // 数值/单位守恒（v18.3.0 阶段 2）：改动段内数字序列变了（有数字消失/新增/改变，非删除意图）→ P2 提示
  const numsOld = numsOf(oldPart);
  const numsNew = numsOf(newPart);
  if (numsOld.length && newPart !== '' && numsOld.join(',') !== numsNew.join(',')) {
    numericDrift.push({ id: it.id, line: it.line, from: numsOld, to: numsNew });
  }
  const r = locateAndReplace(text, oldPart, newPart, curTxt, prefixLen, suffixLen);
  if (!r.ok) {
    skipped.push({
      id: it.id,
      line: it.line,
      reason: `定位串在目标文件中不唯一或不存在（差异片段「${oldPart.slice(0, 24)}${oldPart.length > 24 ? '…' : ''}」→「${newPart.slice(0, 24)}${newPart.length > 24 ? '…' : ''}」），须主控按「定位」列行号人工处理`,
    });
    continue;
  }
  text = r.text;
  applied.push({
    id: it.id, line: it.line,
    kind: oldPart === '' ? '插入' : (newPart === '' ? '删除' : '替换'),
    oldPart, newPart, ctx: r.ctx, loc: it.loc,
  });
}

const afterHan = countHan(text);
const delta = afterHan - beforeHan;

// ---- 输出 ----
// v18.2.6（B-4 ③）：清单解析出 **0 条** ≠ 全部应用成功。旧版两者都是 `ok:true` + exit 0 + 同一句 hint，
//   下游（主控/修订说明）无法区分「清单路径传错 / 格式不符」与「真的全应用了」——这是假成功。
//   现：空清单 → ok:false、hint 明说「清单未解析出任何条目」、exit 1，且**不写盘**（写出去的那份与输入逐字
//   相同，一旦被当成「初稿-v4」往下游流，等于把未修订的正文冒充修订版）。
// v18.13.0（L-58）：**丢弃行让 ok 转假**——它此前完全不可见，半截替换照样 exit 0 / ok:true。
const ok = !emptyList && skipped.length === 0 && unparsed.length === 0 && droppedLines.length === 0;
const hint = emptyList
  ? '清单未解析出任何条目（0 条）：请核对清单路径与格式——条目头只认 `[Diff N]` / `[P0-n]` / `[P1-n]` / `[C-n]`，且每条含「现况：」与「修改：」两行；本次**未写盘**'
  : (skipped.length || unparsed.length)
    ? '存在跳过/未解析条目：请用 --report 看全量明细，按 `loc` 行号人工处理剩余条目'
    : droppedLines.length
      ? `存在**未参与替换的清单行**（${droppedLines.length} 行，多为多行「现况」的续行）——替换可能是半截的，请按 stderr 点名逐条修清单后重跑`
      : '全部条目已机械应用；delta 为脚本实测（可直接写入修订说明，替代清单自报的估算值）';

// 写盘统一走 _lib/destructive-write.mjs：原地覆盖（已由 --in-place 显式声明）或 --out 已存在 → 先落带时间戳 .bak。
// v18.12.0（全量审计 L-69）：**「无实际改动」不得写出下一版**。旧版只要清单有条目（哪怕**全部被跳过**、
//   正文逐字节未变）就会写盘 + 报 `written: true` → 产出的是与输入**逐字节相同**的 `初稿-vN+1.md`；
//   主控在修订说明里照抄 `han.delta = 0` 时看似正常，但下游会把这份「未修订的正文」当修订版继续流
//   （与 v18.2.6 修掉的「清单 0 条仍写盘」是同一类假成功，只是触发条件不同：那次 0 条目，这次 0 改动）。
//   `--in-place` 亦然：写回同一份内容只会平白多出一个 .bak 回滚点，掩盖「本轮其实没改到东西」。
let backup = null;
let written = false;
let noop = false;
if (!dryRun && !emptyList) {
  if (text === readFileSync(targetPath, 'utf8')) {
    noop = true;   // 逐字节相同：不写盘、不留 .bak、如实标注
  } else {
    const w = writeWithSafety(outPath, text, { inPlace: overwritesTarget, source: targetPath });
    backup = w.backup;
    written = true;
    console.log(`✓ 写入: ${outPath}${backup ? `（原文件已备份: ${backup}）` : ''}`);
  }
}
if (noop) {
  console.error('⚠️ 本轮**无实际改动**（应用后与输入逐字节相同）——已跳过写盘：不产出「下一版」副本，也不留 .bak。');
  console.error('   → 若这不是预期：检查清单条目的「现况」行是否与正文逐字一致（不一致会被计入 skipped/unparsed，见 JSON）。');
}

const summary = {
  target: targetPath,
  list: listPath,
  out: outPath,
  dry_run: dryRun,
  in_place: overwritesTarget,
  written,
  noop,
  backup,
  ok,
  list_items: items.length,
  parsed: parsed.length,
  unparsed: unparsed.length,
  applied: applied.length,
  skipped: skipped.length,
  han: { before: beforeHan, after: afterHan, delta },
  applied_items: applied,
  skipped_items: skipped,
  unparsed_items: unparsed.map((u) => ({ id: u.id, line: u.line, reason: !u.cur ? '缺「现况」行' : '缺「修改」行' })),
  // v18.13.0（L-58/L-59）：把两类此前**完全不可见**的内容也写进 JSON 契约（只做加法，不动既有字段）
  dropped_lines: droppedLines,                      // 既非定位/现况/修改、又非空 → 未参与替换（半截替换的根因）
  dropped_count: droppedLines.length,
  unrecognized_head_lines: unparsedHeads,           // 方括号行但不是四个清单族（如正文引用 `[L01]`）
};

// v18.12.0（全量审计 L-50）：`--report` 旧版是**裸 writeFileSync** —— 路径敲成被审正文/清单即
//   不可回滚地销毁它（实测 exit 0、目录内无 .bak）。现统一走 writeReport：同文件 → exit 10；并留时间戳 .bak。
writeReport(reportPath, JSON.stringify(summary, null, 2), { protect: [targetPath, listPath] });

// JSON 契约字段（ok/applied/unparsed/unparsed_detail/hint）**保持原名不改**——下游与回归用例依赖它们；
// 本批只做加法（in_place / written / backup / list_items / _detail 补齐缺失源）。
console.log(JSON.stringify({
  ok,
  target: targetPath, out: outPath, dry_run: dryRun,
  in_place: overwritesTarget, written, noop, backup,
  list_items: items.length,
  applied: applied.length, skipped: skipped.length, unparsed: unparsed.length,
  stripped_meta: [...new Set(strippedMeta)],   // v18.2.9（审计 B11）：被剥离的元注记留痕
  causal_upgrades: causalUpgrades,             // v18.3.0 方案：causal 强度升级无证据（P2 提示）
  numeric_drift: numericDrift,                // v18.3.0 阶段 2：数值静默漂移（P2 提示）
  han_before: beforeHan, han_after: afterHan, han_delta: delta,
  skipped_detail: skipped.slice(0, 8),
  unparsed_detail: summary.unparsed_items.slice(0, 8),
  dropped_count: droppedLines.length,                       // v18.13.0（L-58）：>0 即「替换可能半截」，ok 已随之转假
  dropped_detail: droppedLines.slice(0, 8),
  unrecognized_head_lines: unparsedHeads.slice(0, 8),       // v18.13.0（L-59）：方括号行但不是四个清单族
  hint,
}, null, 2));

process.exit(ok ? 0 : 1);
