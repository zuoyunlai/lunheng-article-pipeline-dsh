// refresh-gates.mjs — 终检期「正文指纹刷新」助手（v18.60.1，主人授权反哺 v2 §2.6 / §7.1 #8）
//
// 用法：node scripts/refresh-gates.mjs <项目目录> [--dry-run] [--json]
//
// 为什么需要：终检期对正文的**任何**亲修都会让「本阶段正文 sha256」在多个交付件里**同时过期**——
//   ① audits/闸门记录-T2.5.md　② audits/闸门记录-T7.5.md　③ final/交付说明.md（§1 路径表 / §9 证据包指纹）。
//   而 M-Exist-5 会做「闸门记录 ↔ final/M-Gate-Report.json」的**指纹互锁**比对 → 过期即判 P1
//   （detail：「不一致——改稿后未重跑 M 门？」）。
//   实测（论衡实测项目-夫妻收入差异家庭权力）：终检期正文演进 3 次，主控每轮手工同步 4 处，
//   属「必做但全靠记忆」的机械动作——本脚本把它收敛为一条命令。
//
// 边界（如实声明，四条）：
//   · **只替换已知形态的旧指纹**：正则锚定在「正文 sha256 / draft_sha256 / sha256:」字样附近，
//     不做「把所有 64 位 hex 都换掉」的危险操作（那会误伤证据包 manifest 的**条目** sha256）。
//     ⚠️ v18.62.7（反哺-主控实测 A1）——**只抓**已知形态**不够**：实据列写 `` `路径` sha256 `<hex>` ``
//     时旧模式在第一个反引号处截断 → 一个指纹都抓不到 → 报 `ok`。现模式允许跨反引号（限长 200 + 不跨行），
//     并把「标签在、指纹抓不到」单列为 `warn`（见下）。**替换只动 64 位指纹本身，从不改写标签文本。**
//   · 抓不到旧指纹 → **分两种，不再同形**：
//       ① 文件里**没有**该形态的标签 → 如实报「无可刷新项」并**不写盘**（这不是错误）；
//       ② 文件里**有**标签却解析不出指纹 → 报 `warn` + 输出告警（**未写盘**，退出码仍 0，须人工处理）。
//       判据：**「无可刷新」与「解析失败」必须能被读者区分开**——两者同形时，工具会说「已同步」而
//       下一步的门（M-Exist-5）判 P1，变成「两个工具各说各话，人得自己查」。
//   · **不改正文、不改 `final/M-Gate-Report.json`**——后者的 `exit` 权威值只能由
//     `m-gate-check.mjs --adjudicate` 写入（本脚本不越权）。
//
// exit：0 = 无需刷新（或 dry-run 完成）/ 1 = 已刷新（有替换）/ 10 = 参数或路径错 / 70 = 内部错
//
// ⚠️ **退出码契约（v18.62.4 · 全量审计-v18.62.3 §8.1 #9，主人裁定方案 (A)）**：
//   本脚本的 `1 = 已刷新` 与 M 门族的 `1 = P1 内容失败` **字面撞义**。经复核判定**保留现状**：
//     ① 该语义是本文件明写的契约、被 `repo-hygiene-check` 契约表登记、并被 `refresh-gates.test.mjs`
//        两条用例**刻意钉住**（其中一条专门写「与 0=无需刷新、1=已刷新 区分」）——是**被认知的设计**；
//     ② 本脚本是终检期**手动助手**，仓内**无任何自动调用方**（grep 全仓只有自身与契约表命中），
//        故目前**不存在**「1 被误读成 P1」的真实消费路径；
//     ③ 改成 0 会**丢掉「是否发生了替换」**；改成 3 又与「3 = 仅 P2·soft·SKIP」撞义
//        —— 本仓契约里**没有**「成功但需复核」的独立码，加新码属**契约层决定**。
//   **方案 (A) 的落地＝立此明文约束**：
//     🔒 本脚本的输出（含退出码）**不得被任何自动化链消费**——它是给人读的终检助手。
//        后续若有人要把它接进脚本/CI 的判定路径，**必须先解决上述撞义**（改码或新增专用码），
//        不得直接 `if (code === 1)` 当成内容失败处理。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { installExitGuard, requireExistingDir, EXIT_USAGE } from './_lib/exit-guard.mjs';
import { parseArgs as parseCliArgs } from './_lib/cli-args.mjs';
import { writeWithSafety } from './_lib/destructive-write.mjs';

installExitGuard();

const USAGE = '用法: node scripts/refresh-gates.mjs <项目目录> [--dry-run] [--json]';
let parsed;
try {
  parsed = parseCliArgs(process.argv.slice(2), {
    flags: ['--dry-run', '--json'],
    minPositionals: 1, maxPositionals: 1, positionalHint: '<项目目录>',
  });
} catch (e) {
  console.error(`参数解析失败: ${e.message}`);
  console.error(USAGE);
  process.exit(EXIT_USAGE);
}
const project = parsed.positionals?.[0];
const dryRun = parsed.flags?.has('--dry-run');
const wantJson = parsed.flags?.has('--json');
if (!project) { console.error(USAGE); process.exit(EXIT_USAGE); }
if (!existsSync(project)) { console.error(`项目目录不存在: ${project}`); process.exit(EXIT_USAGE); }
requireExistingDir(project, '项目目录');

// 源正文：定稿优先，回退 drafts 最高版（与 build-evidence-bundle 的三级回退同口径）
const latestDraft = () => {
  const d = join(project, 'drafts');
  if (!existsSync(d)) return null;
  const cands = readdirSync(d)
    .map((f) => ({ f, m: f.match(/^初稿-v(\d+)\.md$/) }))
    .filter((x) => x.m)
    .map((x) => ({ f: x.f, n: Number(x.m[1]) }))
    .sort((a, b) => b.n - a.n);
  return cands.length ? { rel: `drafts/${cands[0].f}`, abs: join(d, cands[0].f) } : null;
};
const draftAbs = join(project, 'final', '定稿.md');
const src = existsSync(draftAbs) ? { rel: 'final/定稿.md', abs: draftAbs } : latestDraft();
if (!src) {
  console.error('找不到正文源（final/定稿.md 与 drafts/初稿-vN.md 均不存在）——先落盘正文再刷新指纹');
  process.exit(EXIT_USAGE);
}
const buf = readFileSync(src.abs);
const sha = createHash('sha256').update(buf).digest('hex');
const bytes = buf.length;

// 待刷新目标：闸门记录 ×2 + 交付说明
// ⚠️ v18.62.4（全量审计-v18.62.3 P1-8）：**交付说明的正则收窄 + 加「正文语境」守卫**。
//   病灶（本脚本自己的边界声明就禁止这一形态，见文件头「只替换**已知形态**的旧指纹…不做
//   『把所有 64 位 hex 都换掉』的危险操作（那会**误伤证据包 manifest 的条目 sha256**）」）：
//   旧第 3 条的**首条**模式是裸 `sha256[:：]\s*`?([0-9a-f]{64})`?` —— 它按**行**匹配，于是任何写成
//   「…sha256：<64hex>」的行都会被当成「本阶段正文指纹」并**整行替换**；模板 §9 正是「证据包指纹」
//   一节（实测 27 份真实交付说明里有 5 处命中该模式）。一旦某项目把逐文件条目指纹写成同形，
//   那些 `manifest` 条目 sha256 会被**静默改写成正文指纹**——清空该节的对照价值。
//   现两层收口：
//     ① 模式收紧：只保留**显式带「正文」标注**的一种形态（去掉裸 `sha256:` 那条）；
//     ② 加**行内语境守卫**：命中的行必须同时含 `正文|定稿|被审|draft_sha256` 之一才算正文指纹。
//        （为什么必须有守卫：`正文 sha256[:：]…` 这条模式本身也能匹配「旧版写法 / 错误写法」这类
//          **说明行**，而那种行描述的是别的项目，不该被本项目的指纹覆盖。）
//   残留边界（如实）：若某项目**逐文件**条目恰好写成「正文……sha256：<hex>」这种不可能的自然语句，
//   仍会被替换；彻底消除需改为「按 `M-Gate-Report.json#verdict_scope.draft_sha256` 反查」，
//   属增强而非修复，见本批修订记录的「未做项」。
const CONTEXT_RE = /正文|定稿|被审|draft_sha256/;
// ⚠️ v18.62.7（反哺-主控实测 A1，**本批修**）：闸门记录的两个模式**原写作 `[^`\n]*`**——
//   而 `[^`\n]` **不允许跨越反引号**，于是实据列只要写成「标签 | `路径` sha256 `指纹`」（路径自带
//   反引号，这是 M-Exist-5 契约为「可读」而鼓励的写法），模式在**第一个反引号处就被截断**，
//   一个指纹都抓不到 → 报 `ok（无可刷新项）`。
//   实测（反哺报告-主控实测-2026-10-02 §A1 受控对照）：同一份文件，实据写 `正文 sha256 <hex>`
//   → `would-replace ×2`；写成 `` `final/定稿.md` sha256 <hex> `` → 静默 `ok`。
//   修法：`[^`\n]*` → `[^\n]{0,200}?`（**允许跨反引号**，且**限长 200 字符 + 不跨行**，避免在同段
//   远处误抓别的 hex）；指纹两侧的反引号改为**可选**（`\`?`），兼容不带反引号的写法。
//   既有 `CONTEXT_RE` 行内语境守卫**保留不动**——它才是挡住「误伤 manifest 逐文件条目 sha256」的那一层
//   （见 :122-127 注释与 `refresh-gates.test.mjs` 的反向自证用例）。
//   ① 替换的安全性：下面只做 `text.split(oldSha).join(sha)`——**只替换 64 位指纹本身，从不改写标签文本**，
//      故「放宽模式会把检查项单元格里的标签也改掉」这一担心不成立（v18.62.7 已加回归用例钉住）。
const gateRecordPatterns = () => [
  /正文\s*sha256[^\n]{0,200}?`?([0-9a-f]{64})`?/g,
  /draft_sha256=`?([0-9a-f]{64})`?/g,
];
// 「标签在，但指纹抓不到」的探测器（**非全局**，避免 lastIndex 状态；只用于报「解析失败」告警）
const gateRecordLabel = /正文\s*sha256/;
const deliverLabel = /(?:被审正文|正文|定稿)[^\n]*?sha256[:：]/;
const targets = [
  { rel: 'audits/闸门记录-T2.5.md', patterns: gateRecordPatterns(), label: gateRecordLabel },
  { rel: 'audits/闸门记录-T7.5.md', patterns: gateRecordPatterns(), label: gateRecordLabel },
  // 交付说明的真实形态有**两种**，且都实测自存量项目（27 份 §9 抽样）：
  //   ① 标签在前、值在后：`- **被审正文（定稿）sha256**：sha256：<hex>`（主流形态）
  //   ② 标签与值同段：`正文 sha256：<hex>`
  //   故交付说明用「关键词…→ 行内**第一个** sha256 值」这一条模式覆盖两形态（配合行内语境守卫）。
  {
    rel: 'final/交付说明.md',
    patterns: [/sha256[:：]\s*`?([0-9a-f]{64})`?/g],
    label: deliverLabel,
    // 仅交付说明需要「关键词先行」的整体匹配（闸门记录的标签形态已足够精确，不需要再收）
    keyFirstPatterns: [/(?:被审正文|正文|定稿)[^\n]*?sha256[:：]\s*`?([0-9a-f]{64})`?/g],
    useKeyFirst: true,
  },
];

const results = [];
const warnings = [];   // v18.62.7（A1）：**「解析失败」不再与「无可刷新项」同形**
let replaced = 0;
for (const t of targets) {
  const abs = join(project, t.rel);
  if (!existsSync(abs)) { results.push({ file: t.rel, status: 'skip', note: '文件不存在' }); continue; }
  let text = readFileSync(abs, 'utf8');
  const found = new Set();
  // v18.62.4（P1-8）：**逐行**匹配 + 行内语境守卫（见上方 CONTEXT_RE 注释）。
  //   旧实现直接 `text.matchAll(re)`：一个 64 位 hex 只要在**文件任意位置**以该形态出现就被收进 olds，
  //   然后全文件 `text.split(oldSha)` 替换 —— 即「模式命中的上下文」与「实际被替换的位置」可以不同。
  //   现改为按行收集：行必须同时满足 ① 命中某个模式 ② 含正文语境词。
  for (const line of text.split('\n')) {
    if (!CONTEXT_RE.test(line)) continue;
    const useKeyFirst = t.useKeyFirst === true;
    const pats = useKeyFirst ? (t.keyFirstPatterns || []) : t.patterns;
    for (const re of pats) {
      for (const m of line.matchAll(new RegExp(re.source, re.flags))) found.add(m[1]);
    }
  }
  const olds = [...found].filter((h) => h !== sha);
  if (!olds.length) {
    // v18.62.7（反哺-主控实测 A1）：**区分「真的没有旧值」与「标签在、指纹抓不到」**。
    //   旧实现把两者都报 `ok`，于是「模式不兼容导致一个指纹都没抓到」这一**失败**是静默的——
    //   主控看到 `ok` 会认为「已同步」，而 M-Exist-5 下一步判 P1（两个工具各说各话）。
    //   现：文件里**存在**该目标的指纹标签、却一个 hex 都没解析出来 → 报 `warn`（并在 stdout/JSON 显著告警）。
    //   ⚠️ 退出码**不变（仍 0）**，如实登记为「未刷新、需人工处理」：本脚本头部 :21-32 已立明文约束
    //     「新增退出码属契约层决定」，且本脚本**不得被任何自动化链消费**——故本批只做**可见性**修复，
    //     是否新增专用软码留主人裁定（见本批修订记录 §未做项）。
    if (found.size === 0 && t.label.test(text)) {
      // ⚠️ 先排除**合法的「本阶段无正文」形态**：T2.5 记录在 Phase 3 之前必然写
      //   「本阶段无正文…该行留待 T7.5 首次填实值 | N/A」——它有标签、无指纹，且**是对的**。
      //   判据：**同一行**内若已写明 `N/A` / `不适用`，就不是解析失败。
      const suspicious = text.split('\n').filter((line) =>
        t.label.test(line) && !/N\/A|不适用/.test(line) && !/[0-9a-f]{64}/.test(line));
      if (!suspicious.length) {
        results.push({ file: t.rel, status: 'ok', note: '无可刷新项（标签行为 N/A 形态，无指纹可刷）' });
        continue;
      }
      warnings.push(
        `${t.rel}: 检测到「正文 sha256」类标签，但**未解析到任何 64 位指纹**——实据列的写法与本脚本的模式不兼容`
        + `（最典型：标签与指纹之间夹着另一段反引号路径）。请人工核对，或改写成 \`正文 sha256 \`<64位hex>\`\` 形态。`,
      );
      results.push({ file: t.rel, status: 'warn', note: '检测到标签但指纹解析失败（**未写盘**）' });
    } else {
      results.push({ file: t.rel, status: 'ok', note: found.size ? '指纹已是当前值' : '无可刷新项（未找到已知形态指纹）' });
    }
    continue;
  }
  // v18.80.1（全量审查修订批 · B12）：**按行替换**。旧实现按值 `text.split(oldSha).join(sha)` 全局替换，
  //   而候选是在「命中模式 ② 含正文语境词」的行上收集的（见 :154-161）→ **收集面与替换面不一致**：
  //   `final/交付说明.md` 的证据包清单里与正文旧指纹**同值**的条目也会被静默改写
  //   （正是 :92-99 声明要防的「误伤 manifest 条目 sha256」），且 `count` 随之上报虚高。
  let n = 0;
  {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!CONTEXT_RE.test(lines[i])) continue;
      for (const oldSha of olds) {
        if (!lines[i].includes(oldSha)) continue;
        const parts = lines[i].split(oldSha);
        n += parts.length - 1;
        lines[i] = parts.join(sha);
      }
    }
    if (n > 0) text = lines.join('\n');
  }
  if (!dryRun) writeWithSafety(abs, text, { source: 'refresh-gates.mjs' });
  replaced += n;
  results.push({
    file: t.rel, status: dryRun ? 'would-replace' : 'replaced', count: n,
    from: olds.map((s) => s.slice(0, 12) + '…').join(','), to: sha.slice(0, 12) + '…',
  });
}

const out = {
  project, source: src.rel, sha256: sha, bytes, dryRun,
  replaced, results,
  warnings,   // v18.62.7（A1）：非空 = 有目标「标签在、指纹抓不到」→ 必须人工处理（退出码仍 0，见上）
  note: replaced === 0
    ? (warnings.length
      ? `⚠️ 未刷新任何指纹，但有 ${warnings.length} 个目标**解析失败**（≤ 不是「已同步」）——见 warnings，须人工核对后台账`
      : '无旧指纹可刷新（各交付件的正文指纹已是当前值，或未见已知形态指纹）——未写盘')
    : `${dryRun ? '将' : '已'}刷新 ${replaced} 处正文指纹 → ${sha.slice(0, 12)}…（源 = ${src.rel}）`,
};
if (wantJson) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`源正文: ${src.rel}（${bytes} B / sha256 ${sha.slice(0, 12)}…）`);
  for (const r of results) {
    const c = r.count ? ` ×${r.count}` : '';
    console.log(`· ${r.file}: ${r.status}${c}${r.note ? `（${r.note}）` : ''}`);
  }
  for (const w of warnings) console.log(`⚠️ ${w}`);
  console.log(out.note);
}
process.exit(replaced > 0 && !dryRun ? 1 : 0);
