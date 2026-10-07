#!/usr/bin/env node
// 收口批固定动作：**差集检查 + 反向核验（陈旧「未做」清单）**
//
// 用法：node scripts/closeout-verify.mjs [--audit <审计报告.md>] [--records <修订记录目录>] [--repo <仓库根>] [--json]
//
// 为什么有这个脚本（三次实战教训，全在同一轮 v18.12.x 收口里踩出）：
//   ① 18.12.2 交付时 agent 声称「三条定案都已落地」——**差集检查**（审计报告 ID ↔ 全部修订记录 + CHANGELOG）
//      证明它不完整：11 个 ID **从未被任何记录提及**（L-07/09/11/16/32/36/55/56/57/58/59）。
//      判据：对「已全部修订」这类断言，**唯一廉价的机械反驳手段就是 ID 差集**——逐条读记录会漏，
//      因为漏掉的 ID 恰恰是**没有任何记录可读**的那些。
//   ② 18.12.3 之后 agent 把「差集为空」当完成证据。**差集只能证明「被记录」，不能证明「被结清」**：
//      记录里有一份**跨梯队累积的陈旧「仍未做」清单**（第四梯队登记 L-13/L-14/L-24/… ，后续梯队早把
//      其中 27 项做完，但清单没回标）→ 反向核验才查出真缺口只剩 1 项（L-14）。
//   ③ 反向核验还**推翻了 5 处「记录说未做、实际早已落地」**（L-27/L-28/L-41/L-60/L-61）——
//      即陈旧清单不只是「漏报已修」，也会「误报未修」。两个方向都得查。
//
// 判据一句话：**差集查漏，反向核验查「记录陈旧」——两者缺一不可**。只跑差集会得到
//   「全部被记录」的假安心；只读记录会漏掉没有任何记录的那些。
//
// ⚠️ **本脚本只覆盖可机械化的那半，边界如实声明**：
//   · 能判：①某 ID 在任何记录里都不存在；②某 ID 在某梯队被登记为「未做/延后/保留代价」，
//     而**其后所有梯队都没再提到它**（= 清单陈旧，必须回标或补做）。
//   · **不能判**：某 ID 的后继提及究竟代表「真做完了」还是「只是提了一句」。**语义那半必须人工**——
//     正确动作是拿本脚本输出的清单，逐条**回到代码/产物实测**（v18.13.0 正是这么做才发现
//     L-27/L-28/L-41/L-60/L-61 其实是已修、而 L-14 是真未修）。
//   把「提到」当「做完」= 复现 18.12.3 的错误；本脚本刻意只报「需人工回核」而不报「已完成」。
//
// ⚠️ v18.78.2（全量审计-v18.78.1 B14）：**「被提及」必须分列两个计数**。旧版第 1 步把
//   「修订记录（梯队记录 + audits/README）」与「CHANGELOG（主档 + archive）」拼成**一个**证据源，
//   于是 `neverMentioned = 0` 被读成「全部被记录/处理」——而它实际只等于「**被 CHANGELOG 提及过**」。
//   实测（本仓 v18.11.0 报告 68 个 ID）：仅靠「第N梯队」修订记录时未被提及 2 个；仅靠 CHANGELOG 时
//   未被提及 11 个；并集未被提及 0 个。对「提了一句但从未结清」的 ID，旧输出**无分辨力**。
//   修法：输出与 `--json` 都分列 `handledByRecords` / `changelogOnly` 两个计数（后者附 ID 清单），
//   并把构成写在 ✓ 结论旁边。**判据与退出码不变**（neverMentioned 的算法与旧并集完全等价）——
//   本批是**可见化**，不是收紧：把「仅被 CHANGELOG 提及」判失败会让所有历史版本段变红，
//   而它证明的「被提及」本来就不等于「被结清」（语义判定照旧交人工，见上）。
//
// 退出码：0 = 两步均无发现；1 = 有发现（列在 stderr）；10 = 参数/路径错；70 = 内部错误。
//
// ⚠️ v18.62.4（全量审计-v18.62.3 §8.1 #5）：**`70` 此前只是「文档里的一个码」**——
//   全文件没有任何 `process.exit(70)`，而文件读取与主判定**也没有 try/catch**。
//   后果：任何内部异常（EACCES / EISDIR / TOCTOU 竞态 / 解析器缺陷）都会被 Node 以默认码收场，
//   在本仓语境里**默认 1 = 「有发现」** —— 即**内部故障被读成「审计发现」**，方向恰好相反。
//   修法（fail-closed）：把两步判定整体包进 `main()`，`catch` 一律 **exit 70** 并打印原始错误，
//   与「0/1/10」三个**内容/参数语义**的码彻底分开。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { readChangelogAll } from './_lib/changelog-structure.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const asJson = argv.includes('--json');
for (const a of argv) {
  if (a.startsWith('--') && !['--audit', '--records', '--repo', '--json'].includes(a)) {
    console.error(`未知参数: ${a}\n用法: node scripts/closeout-verify.mjs [--audit <报告>] [--records <目录>] [--repo <仓库根>] [--json]`);
    process.exit(10);
  }
}

// 仓库根：默认取脚本自身位置（`<repo>/scripts/` 的上一级），但**可被 `--repo` 覆盖**。
//   ⚠️ 为什么必须可覆盖（写本脚本时踩的第三个坑）：`--audit/--records` 指向夹具时，
//   CHANGELOG（「被提及」的证据源之一）仍会从**脚本所在真仓**读取 —— 真仓 CHANGELOG 含全部 ID，
//   于是夹具里的陈旧「未做」登记被凭空抹掉、门报 ✓。即「换了输入却没换证据源」= 假绿。
const repoRoot = resolve(opt('--repo', resolve(import.meta.dirname, '..')));
// ── v18.80.0（全量审计-v18.79.1 §七·补）：**默认目标不再是写死的那一份** ────────────────────────
//   病灶：默认值原写死 `audits/全量审计报告-v18.11.0.md`。实测——该文件有 151 个 `L-NN`，
//   而**最近两轮**报告（`全量审计报告-v18.78.1-2026-10-06.md`、`论衡插件文档全量审计-v18.78.0.md`）
//   的 `L-NN` 是 **0 处**。于是 `node scripts/closeout-verify.mjs` 的 `exit 0` + 「两步均无发现」
//   检的是**一份早已过期的旧报告**——这正是本仓 ⑩/⑳ 明令禁止的「规则失效即静默放行」，
//   只不过这次失效发生在**收口门自身**上（门在此、却不看最新产物）。
//   修法（三件，缺一仍会退化成静默）：
//     ① 默认目标 = `audits/` 里**按版本号取最新**的一份「全量审计报告」；
//     ② ID 形态由「只认 `L-NN`」扩到「`L-NN` 或 `P<n>-<n>`」——本仓 v18.7x 起的新报告改用
//        `P1-1 / P2-3` 形态（实测 v18.78.0 / v18.78.1 报告 0 个 L-NN、我轮报告 9 个 P1-N + 6 个 P2-N）；
//        两条正则都用词界 + 具体形态，**不引入泛匹配**（避免把「退出码 1」「§P1 差集」之类当 ID）。
//     ③ 目标报告里**一个 ID 都提不到 → 响亮失败**（而不是照旧输出「两步均无发现」）。
//       这一条是本次修复的核心：前两条只是让它看对文件，这一条才让「看不对」变得**不可静默**。
const pickLatestAudit = (dir) => {
  if (!existsSync(dir)) return null
  const cands = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && /审计报告/.test(f))
    .map((f) => {
      const v = /v(\d+)\.(\d+)\.(\d+)/.exec(f)
      return { f, key: v ? [+v[1], +v[2], +v[3]] : [0, 0, 0] }
    })
    // 版本号降序；同版本按文件名降序（日期后缀在同一版本内区分 A/B 稿）
    .sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1] || b.key[2] - a.key[2] || b.f.localeCompare(a.f))
  return cands.length ? join(dir, cands[0].f) : null
}
const auditPath = resolve(opt('--audit', pickLatestAudit(join(repoRoot, 'audits')) ?? join(repoRoot, 'audits', '全量审计报告-v18.11.0.md')));
const recordsDir = resolve(opt('--records', join(repoRoot, 'audits')));

for (const [label, p] of [['审计报告', auditPath], ['修订记录目录', recordsDir]]) {
  if (!existsSync(p)) { console.error(`${label}不存在: ${p}`); process.exit(10); }
}
if (!statSync(auditPath).isFile()) { console.error(`审计报告不是文件: ${auditPath}`); process.exit(10); }
if (!statSync(recordsDir).isDirectory()) { console.error(`修订记录路径不是目录: ${recordsDir}`); process.exit(10); }

// ── 梯队排序：从文件名取中文序数（第一…第十），取不到则按「承接链」与文件名字典序兜底 ────────────
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** 版本式修订记录的 rank（v18.80.0 · §七·补）：排在所有「第N梯队」之后。 */
const VERSIONED_RECORD_RANK = 100
const tierRank = (name) => {
  const m = /第([一二三四五六七八九十])梯队/.exec(name);
  // 有「第N梯队」→ 用其序数（这是**唯一**可用于先后判定的序）；
  // 无该标记的专项记录（「L05裁定通道」「反哺v1v2落地」）→ 返回 null：它们**不构成「后续处理」的证据**。
  //   ⚠️ 首版把它们排成 90，于是任何 ID 只要在**任意一份**非梯队记录里出现过，
  //   就被当成「后续有人处理了」→ 门虽在却不生效（写脚本时自己踩的第二个坑）。
  if (m) return CN_NUM[m[1]];
  // ── v18.80.0（全量审计-v18.79.1 §七·补）：**版本式记录必须进记录面** ──────────────────────
  //   病灶（本批实测）：本仓自 v18.6x 起，收口批的记录文件名已改口径为
  //   `机制文件修订记录-<日期>-<批次名>.md`（如 `…-2026-10-07-全量审计-v18.79.1修订批.md`），
  //   **不再带「第N梯队」**。旧规则对无梯队标记的名字一律返回 null → 这类记录被**整份排除**
  //   在「修订记录面」之外。后果：`handledByRecords` 恒为 0、「仅被 CHANGELOG 提及」吞掉全部 ID，
  //   差集形同虚设（实测本批修复前：8 个 ID 全落 changelogOnly）。
  //   判据（v18.80.0 · 实测定型）：**法定名 = 既有「第N梯队」或 `机制文件修订记录-<日期>-…-v<版本>…`**
  //   ——即「日期前缀 + 版本号」两段式，判据 B 的正则因此锚在 `^`（`-v18.13.0-` 里的 `26-01-02` 若不加
  //   `^` 会被当成「年-月-日」误命中，本批实测踩到过）。实测本仓命中：`…-2026-10-01-全量审计v18.62.3落地.md`
  //   `…-2026-10-06-反哺-v18.78.2核实批.md` `…-2026-10-07-全量审计-v18.79.1修订批.md`（**本批这份**）。
  //   ⚠️ 负则样例：`…-2026-09-26-v1822.md` 与 `…-2026-01-02-v18.13.0-收口.md` **不命中**（前者是内联
  //   版本注记、后者是负向用例里的方案稿）——它们的版本段都不以 `v<数字>.<数字>` 开头且带 `-` 后接文本。
  //   副作用是好的：第 2 步的 `laterText` 参照系（只拼 `rank > rec.rank`）从此正确。
  if (/^机制文件修订记录-\d{4}-\d{2}-\d{2}-.*(?<![\d])v\d+\.\d+/.test(name)) return VERSIONED_RECORD_RANK;
  return null;
};

// ── 读取全部修订记录 + CHANGELOG（CHANGELOG 也算「被提及」的证据源）────────────────────────
const recFiles = readdirSync(recordsDir)
  .filter((f) => f.startsWith('机制文件修订记录-') && f.endsWith('.md'))
  .map((f) => ({ file: f, path: join(recordsDir, f), rank: tierRank(f) }))
  .filter((r) => r.rank !== null)
  .sort((a, b) => a.rank - b.rank || a.file.localeCompare(b.file));
if (!recFiles.length) {
  console.error(`未在 ${recordsDir} 找到任何「机制文件修订记录-*.md」——拒绝在无记录的情况下判「已收口」`);
  process.exit(10);
}
// __CLOSEOUT_MAIN_WRAPPED__（v18.62.4 §8.1 #5）：主体包一层 fail-closed —— 内部异常一律 exit 70，
//   不再让 Node 的默认码（在本仓语境里 = 1 = 「有发现」）冒充判定结果。
try {
  const records = recFiles.map((r) => ({ ...r, text: readFileSync(r.path, 'utf8') }));
  // v18.68.0 拆档：差集证据源 = 主档 + changelog/archive/ 联合（旧版本段的 ID 提及仍算数，防假 P1 差集）
  const changelogText = readChangelogAll(repoRoot);
  const readmeText = existsSync(join(recordsDir, 'README.md')) ? readFileSync(join(recordsDir, 'README.md'), 'utf8') : '';

  // ── 第 1 步：差集——审计报告里的 ID 必须至少被一处记录提及 ─────────────────────────────────
  //   v18.78.2（全量审计-v18.78.1 B14）：**「被提及」必须分列两个计数**。病灶：本步旧版把
  //   「修订记录（主档 + audits/README）+ CHANGELOG（主档 + archive）」拼成一个证据源，
  //   于是 `neverMentioned = 0` 被读成「全部被记录/处理」，而它实际只等于「**被 CHANGELOG 提及过**」——
  //   实测（本仓 v18.11.0 报告 68 个 ID）：仅靠「第N梯队」修订记录时未被提及 2 个、仅靠 CHANGELOG 时
  //   未被提及 11 个、并集未被提及 0 个。对「提了一句但从未结清」的 ID 本步**无分辨力**。
  //   修法：① 只在**修订记录面**里找 → `被修订记录处理`；② 只在 **CHANGELOG 面**里找 → `仅被 CHANGELOG 提及`；
  //   ③ 两面都没有 → `neverMentioned`（判据与旧的并集**完全一致**，故退出码不变）。
  //   ⚠️ **为什么不为「仅被 CHANGELOG 提及」判失败**：CHANGELOG 是**发布留痕**，每个版本段都会写「本版
  //   修了 L-xx」；把它判负 = 让所有历史段都变红，而它证明的「被提及」本来就不等于「被结清」。
  //   本版只做**可见化**：读者必须能看到「差集为空」背后的构成，剩下的语义判定照旧交人工（见文件头边界）。
  const auditText = readFileSync(auditPath, 'utf8');
  // v18.80.0：两条 ID 形态并存。`L-NN` 是本脚本建立时的形态（v18.11.0 报告 151 个）；
  //   `P<n>-<n>` 是本仓 v18.7x 起全量审计报告实际在用的形态（v18.78.0 / v18.78.1 报告 0 个 L-NN，
  //   本轮的 v18.79.1 报告 9 个 `P1-N` + 6 个 `P2-N`）。**只认前者 = 后两轮报告的差集完全失明。**
  const ID_RE = /\b(?:L-\d{2}|P\d+-\d+)\b/g;
  const idsOf = (text) => [...new Set([...text.matchAll(ID_RE)].map((m) => m[0]))].sort();
  const auditIds = idsOf(auditText);
  if (!auditIds.length) {
    // v18.80.0（§七·补③）：**这一条是本次修复的核心**。旧行为是「提不到 ID → 换一份旧报告照旧输出
    //   『两步均无发现』」——门在，却检的不是最新产物，且退出码是绿的。现改为响亮失败：
    //   路径/格式问题一律 10（与本仓「用法/参数错 = 10」的既有口径一致），并在文案里点明可能的原因。
    console.error(
      `审计报告里没找到任何可识别的 ID（${relative(repoRoot, auditPath)}）——本脚本认两种形态：\`L-NN\` 与 \`P<n>-<n>\`。\n` +
      '  可能原因：① 报告确实没有编号化 ID（请在报告里给每条发现编号）；② `--audit` 指错了文件；\n' +
      '  ③ 默认目标取到了非报告文件。**本脚本拒绝在「一个 ID 都提不到」的情况下判「已收口」**——\n' +
      '  那会让差集恒空、把「没检」读成「无发现」（本仓 ⑩/⑳ 明禁的形态）。',
    );
    process.exit(10);
  }
  // 修订记录面 = 梯队记录 + `audits/README.md`（它是修订记录目录自己的索引，属记录侧而非发布留痕侧）
  const recordSideText = [...records.map((r) => r.text), readmeText].join('\n');
  const mentionedByRecords = new Set(idsOf(recordSideText));
  const mentionedByChangelog = new Set(idsOf(changelogText));
  const handledByRecords = auditIds.filter((id) => mentionedByRecords.has(id));
  const changelogOnly = auditIds.filter((id) => !mentionedByRecords.has(id) && mentionedByChangelog.has(id));
  const neverMentioned = auditIds.filter((id) => !mentionedByRecords.has(id) && !mentionedByChangelog.has(id));

  // ── 第 2 步：反向核验——某梯队登记的「未做」项，其后梯队必须再提到它（否则清单就是陈旧的）────
  // 「未做」标记的识别：视为**块起点**，块延伸到「下一个标题」或「下一个同级加粗行」为止。
  //   ⚠️ 实测教训（写本脚本时自己踩的）：真实记录里这个标记**不是小节标题**，而是加粗行
  //   `**仍未做（如实）**：`（后面跟一张表或一串行）。首版只认 `##` 标题 → 第四梯队/第六梯队的
  //   「仍未做」整块被**静默忽略**，脚本对真仓报「0 项」——这正是它要防的那种「门在此、却不生效」。
  //   故此处同时接受两种形态：`#{2,4}` 标题 与 `**…**` 加粗行；块内追平级新标记时切换/结束。
  const UNDONE_RE = /(仍未做|有意未做|本次不修|未做|暂不|延后|保留代价|刻意未加|不修)/;
  /** 该行是否为「未做」标记行；是则返回其层级与整行文本 */
  const undoneMarker = (line) => {
    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h && UNDONE_RE.test(h[2])) return { level: h[1].length, title: h[2] };
    const b = /^\*\*(.+?)\*\*/.exec(line.trim());
    if (b && UNDONE_RE.test(b[1])) return { level: 4, title: b[1], bold: true };
    return null;
  };
  /** 收集某份记录里「被登记为未做」的 ID：标记块内出现的全部 ID（含块内的行内标记） */
  function undoneIds(text) {
    const lines = text.split('\n');
    const found = new Set();
    let open = false;
    let level = 0;
    let boldSeen = new Set();          // 同一块内已出现过的加粗行标题（用于结束块）
    for (const line of lines) {
      const h = /^(#{1,6})\s+(.+)$/.exec(line);
      const b = /^\*\*(.+?)\*\*/.exec(line.trim());
      const marker = undoneMarker(line);
      if (open) {
        // 结束条件：更高或同级标题；或出现**新的**同级加粗行（新的一句话/表头，说明未做块已结束）
        if (h && h[1].length <= level) open = false;
        else if (b && !marker) {
          const key = b[1];
          if (boldSeen.has(key) || boldSeen.size >= 1) open = false;   // 第二个加粗行即视为块结束
          else boldSeen.add(key);
        }
      }
      if (marker) {
        open = true;
        level = marker.level === 4 && marker.bold ? 4 : marker.level;
        boldSeen = new Set(marker.bold ? [marker.title] : []);
        for (const m of line.matchAll(ID_RE)) found.add(m[0]);
        continue;
      }
      if (open) for (const m of line.matchAll(ID_RE)) found.add(m[0]);
    }
    return found;
  }
  const staleDeferrals = [];
  // ── v18.80.0（§七·补④的**第二半**）：本判据的证据面**刻意比记录面窄**（这一条是实测定型的）────
  //   两条规则各司其职，不要合并：
  //     · **第 1 步差集**问「这个 ID 有没有被任何记录提到」→ 记录面越全越好，**全部**记录都算
  //       （含版本式记录，见 `tierRank` 的 VERSIONED_RECORD_RANK）——本批修的就是这里；
  //     · **第 2 步陈旧判定**问「某份**延后清单**之后，有没有人再管过它」→ 参照系只取**梯队记录**
  //       （`第N梯队`），即本仓实现该纪律的原生载体。
  //
  //   ⚠️ 我试过两次**放宽**这一档，都被真数据否掉（过程如实登记，供下次别再试）：
  //     · 「按文件名分档」——`…-2026-09-26-v1822.0-实测对照.md`（内联版本注记）与负向用例的方案稿
  //       `…-v18.13.0-收口.md` 在**任何**文件名正则下都同类（`v1822.0` 与 `v18.13.0` 都是合法的
  //       「语义版本样」写法），分不开；
  //     · 「按行判是否含回标动作词」——真仓当场报 **47 条陈旧**（历史 `L-24/L-28/L-62/…` 全被翻出），
  //       因为当年的梯队记录用的是「顺手提到」式措辞，自然不含「已修/已补」这类词。
  //   落地判据：**沿用旧口径**（其后梯队记录或 CHANGELOG 里**再出现的任何提及**即视为「有人管过」）。
  //   代价（如实声明，不掩饰）：版本式记录若**真**结清了某个历史延后项，本步仍会报「陈旧」→
  //     需人工回核。而这恰是本步的设计意图——它**只报「需人工回核」，从不判「已完成」**（见文件头边界）。
  for (const rec of records) {
    if (!/第[一二三四五六七八九十]梯队/.test(rec.file)) continue
    const undone = undoneIds(rec.text);
    if (!undone.size) continue;
    for (const id of undone) {
      // 其后的**梯队记录** + CHANGELOG，是否再提到它（口径与 v18.12.2 建门时一致）
      const laterText = records.filter((o) => o.rank > rec.rank).map((o) => o.text).join('\n') + '\n' + changelogText;
      if (!new RegExp(`\\b${id}\\b`).test(laterText)) {
        // 也查该记录自身后文是否「同一份里已结清」（如「本批未做」后又写「已补」）
        staleDeferrals.push({ id, tier: rec.file.replace(/^机制文件修订记录-/, '').replace(/\.md$/, '') });
      }
    }
  }

  // ── 输出 ────────────────────────────────────────────────────────────────────────────────
  const report = {
    auditFile: relative(repoRoot, auditPath).replaceAll('\\', '/'),
    auditIdCount: auditIds.length,
    recordFiles: records.length,
    step1_neverMentioned: neverMentioned,
    // v18.78.2（B14）：第 1 步的**分列**——「被修订记录处理」与「仅被 CHANGELOG 提及」不再是同一个数。
    //   两个计数与 `step1_neverMentioned` 必须满足：handledByRecords + changelogOnly + neverMentioned = 全部 ID。
    step1_split: {
      handledByRecords: handledByRecords.length,
      changelogOnly: changelogOnly.length,
      changelogOnlyIds: changelogOnly,
    },
    step2_staleDeferrals: staleDeferrals,
    boundary: '本脚本只报「需人工回核」的项，**不判「已完成」**——语义那半必须逐条回代码/产物实测；'
      + '「仅被 CHANGELOG 提及」只证明被记录过，不等于被结清',
  };
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(neverMentioned.length || staleDeferrals.length ? 1 : 0);
  }

  console.log(`收口批两步检查：审计 ${auditIds.length} 个 ID × ${records.length} 份修订记录`);
  console.log(`  第 1 步 差集：从未被任何记录提及 = ${neverMentioned.length} 个`);
  // v18.78.2（B14）：分列行。**「从未被任何记录提及 = N」这半句原样保留**（既有用例与主人侧的读法
  //   都认它），新增的是「0 是怎么来的」——否则 `0` 会被读成「全部被处理」。
  console.log(
    `  第 1 步 分列（v18.78.2 B14）：被「第N梯队」修订记录处理 = ${handledByRecords.length} 个` +
      `；**仅被 CHANGELOG 提及** = ${changelogOnly.length} 个` +
      `${changelogOnly.length ? `（${changelogOnly.join(' ')}）` : ''}` +
      `——后者只证明「提过一句」，**不等于已结清**`,
  );
  console.log(`  第 2 步 反向核验：登记为「未做」但其后无人再提 = ${staleDeferrals.length} 项`);

  const problems = [];
  if (neverMentioned.length) {
    problems.push(`[P1 差集] 以下 ID 在审计报告里存在，却**从未被任何修订记录/CHANGELOG 提及**（既不修也不登记）：\n` +
      neverMentioned.map((x) => `    · ${x}`).join('\n'));
  }
  if (staleDeferrals.length) {
    problems.push(`[P1 陈旧清单] 以下项在某梯队被登记为「未做/延后/保留代价」，但**其后所有梯队都没再提到**——` +
      `必须逐条回代码/产物实测，并回标为「已做(附证据)」或保留在最新一批的未做清单里：\n` +
      staleDeferrals.map((x) => `    · ${x.id}  （登记于：${x.tier}）`).join('\n'));
  }
  if (problems.length) {
    console.error('\n收口批两步检查未通过：');
    for (const p of problems) console.error('  - ' + p);
    console.error('\n⚠️ 语义那半仍需人工：拿上面的清单逐条**回代码/产物实测**——' +
      '「被提到」不等于「已做完」，把提到当做完正是 18.12.3 的错误。');
    process.exit(1);
  }
  console.log('\n✓ 两步均无发现（差集为空 + 无陈旧「未做」登记）。' +
    // v18.78.2（B14）：把「差集为空」的**构成**写在结论旁边——否则这个 ✓ 会被读成「全部被处理」。
    `\n  ⚠️ 差集为空的构成（v18.78.2 B14）：被修订记录处理 ${handledByRecords.length}/${auditIds.length}，仅被 CHANGELOG 提及 ${changelogOnly.length}，两者皆无 ${neverMentioned.length}` +
    `${changelogOnly.length ? '——「仅被 CHANGELOG 提及」只证明被记录过，**不等于被结清**' : ''}。` +
    '\n  下一步（本脚本刻意不代劳）：把「已记录」项逐条回代码/产物实测——差集只能证明「被记录」。');

} catch (e) {
  const code = (e && e.code) ? e.code : "EX_SOFTWARE";
  const msg = (e && e.message) ? e.message : String(e);
  console.error("⛔ closeout-verify 内部错误（" + code + "）：" + msg);
  console.error("→ 退出码 70（内部错误，**与「0 无发现 / 1 有发现」无关**）——请修脚本或环境后重跑，不要把本次结果当作审计结论。");
  process.exit(70);
}
