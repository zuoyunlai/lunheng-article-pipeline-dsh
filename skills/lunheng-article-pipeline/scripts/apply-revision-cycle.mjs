#!/usr/bin/env node
// 论衡修订循环编排脚本（v18.8.x 实战反哺新增，2026.09.22）
// 用法：node apply-revision-cycle.mjs <run/项目名> <目标版本号N> [--diff-list <analysis/vN-diff-list.md>] [--skip-bundle] [--dry-run]
// 一条命令串起主控修订轮的机械步骤（此前每轮 ≈8 次手工工具调用，实战 v2/v3 两轮主控做了 4 次额外微压缩）：
//   ① cp drafts/初稿-v(N-1).md → drafts/初稿-vN.md（vN 已存在则跳过复制、只测量——防重复运行覆盖已修订稿）
//   ② count-chars 前置口径测量（body = 摘要后~文末节前 纯汉字，与 count-chars.mjs 同源 _lib/han.mjs + _lib/sections.mjs）
//   ③ 应用段级 diff 清单（--diff-list 时委托 apply-diff.mjs --in-place，自动带时间戳 .bak；汉字 delta 由其实测）
//   ④ 后置测量 + G8 字数硬阈判定（目标字数从 01-任务简报.md §目标篇幅 提取；阈 = −10% / +5%）
//   ⑤ 内部流程词残留快扫（Phase N.N / 承重 / 一处两用 / 修订说明 等——M-Form-4/5 的前哨，只报数不判死）
//   ⑥ 刷新证据包 + 审计视图（委托 build-evidence-bundle.mjs <项目> --summary；--skip-bundle 跳过）
//   ⑦ 生成 drafts/修订说明-vN.md 骨架（已存在则不覆盖；字数表预填实测值，决策内容留占位给主控）
// 退出码：0 = 循环完成 / 1 = diff 清单解析 0 条或 apply-diff 失败（**含「部分跳过」**——v18.12.0 L-60 如实修正：
//   旧注释写「0 = 循环完成（含 diff 部分跳过时的提示）」，而实现在 apply-diff 返回 1（**部分跳过时它正是 1**）
//   时直接 `exit 1` → 主控会读成「diff 失败」，尽管**产物已经落盘**）
//   / 10 = 参数路径错 / **70 = 内部错误**（脚本缺陷；v18.12.0 L-66 起另含「apply-diff 子进程未正常
//   结算」——`status === null` 即被信号杀死或根本没起来，旧版按 `exit 1` 报出，与「1 = P1 内容失败」撞码）
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installExitGuard, requireExistingDir, describeSpawn } from './_lib/exit-guard.mjs';
import { parseArgs } from './_lib/cli-args.mjs';
import { countHan } from './_lib/han.mjs';
import { parseTargetChars } from './_lib/target-chars.mjs';   // v18.12.3：目标字数解析唯一实现
import { firstEndnoteIndex, bodyStartAfterAbstract } from './_lib/sections.mjs';   // v18.12.3 L-56：正文区口径与 count-chars 同源（v19.11.2 起不再掩码，故 maskFences 已移除）
import { parseLedger, appendLedgerRow, TRACKS, ROUND_CAPS, LEDGER_REL } from './_lib/round-ledger.mjs';   // v18.81.0 批 2.1：轮次额度真源

installExitGuard();

const argv = process.argv.slice(2);
const USAGE = '用法: node apply-revision-cycle.mjs <run/项目名> <目标版本号N> [--track A|B|G|相位] [--diff-list <analysis/vN-diff-list.md>] [--skip-bundle] [--dry-run]';
const usageExit = (why) => { console.error(why); console.error(USAGE); process.exit(10); };

let flags, opts, positionals;
try {
  ({ flags, opts, positionals } = parseArgs(argv, {
    flags: ['--skip-bundle', '--dry-run'],
    values: { '--diff-list': '', '--track': '' },
    minPositionals: 2,
    maxPositionals: 2,
    positionalHint: '<run/项目名> <目标版本号N>',
  }));
} catch (e) { usageExit(e.message); }

const projArg = positionals[0];
const nTarget = Number(positionals[1]);
if (!/^\d+$/.test(positionals[1]) || nTarget < 2) usageExit(`目标版本号须为 ≥2 的整数（v1 是首轮写作，不走本循环）：现为「${positionals[1]}」`);

const projRoot = requireExistingDir(projArg, '项目目录');
const prevPath = join(projRoot, 'drafts', `初稿-v${nTarget - 1}.md`);
const nextPath = join(projRoot, 'drafts', `初稿-v${nTarget}.md`);
if (!existsSync(prevPath)) usageExit(`上一版草稿不存在：${prevPath}（修订循环要求 v${nTarget - 1} 先落盘）`);
// v18.12.3 修：`join(cwd, v)` 对**绝对路径**是错的（`C:\repo` + `C:\tmp\x.md` → `C:\repo\C:\tmp\x.md`），
//   `resolve` 才正确。`--diff-list` 是派发话术里的高频参数，主控写绝对路径并不罕见
//   （本仓 B12 回归用例匿名暴露；此前只实测过相对路径）。
const diffList = opts['--diff-list'] ? resolve(process.cwd(), opts['--diff-list']) : '';
if (diffList && !existsSync(diffList)) usageExit(`--diff-list 文件不存在：${diffList}`);
const dryRun = flags.has('--dry-run');

// ── v18.81.0（独立审计批 2 · 2.1）：**轮次额度闸门**（本脚本 = 开轮次的入口，故闸门设在这里）──────
// 病灶：「审计打回 ≤2 轮」此前**零机械强制**——本脚本对目标版本号只要求「≥2 的整数」（v9/v99 都放行），
//   而 `轮次类别` 字段无消费者、`handoff-check` 对「轮次计数」只判非空。⇒ 约束只存在于散文里。
// ⚠️ **本闸门刻意不拿「版本号 N」当轮次**：实测 `县中塌陷` 的 v1..v5 里只有 **1** 个 A 轨轮
//   （其余是首稿 / Phase 3.5 / Phase 3.6 / B 轨）——版本号与轮次**量纲不同**（这正是审计点名的仪器缺陷）。
//   故额度按 `drafts/轮次账本.md` 的**独立记账**判，且必须由调用方**显式声明轨别** `--track`。
// 三态（与批 1 的分段原则一致，避免把制度追溯适用到它存在之前）：
//   · **无账本**（存量项目）→ 只提示、不阻塞；
//   · **有账本** → `--track` **必填**；该轨已用满额度 → **exit 10**（动作 = 不再开这一轨，改走升级路径）。
//   · **账本有坏行**（v19.5.0 §二.8）→ **不阻塞**：`parseLedger` 逐行降级（坏行记 malformed 后跳过，
//     其余行照判），额度判定照常进行；坏行清单进汇总的 `ledgerMalformed`，**不得**读成「账本干净」。
const ledgerBefore = parseLedger(projRoot);
// v19.5.0（§二.8）：账本侧的**非阻塞**留痕（坏行照报、其余行照判）——与 `over`/`malformed` 的处置分开。
// ⚠️ v19.5.0（T7 反哺批 · **核实留痕**）：本脚本的**输出话术**不涉及「五要素／六要素」之分——该说法
//   来自反哺清单 §三.11，本条经核实**判假**：**两份契约不得并成一份**——① **交接报告（回报本身）= 六要素**
//   （做了什么 / 产物在哪 / 怎么验证 / 已知问题 / 下一步 / **状态机更新**；由 `handoff-check` B1 逐段核，
//   缺一即硬 21）；② **`agents-log.md` 的「### Tn 执行记录」= 五要素**（输入文件清单 / 已读编号·已落盘条数 /
//   已完成步骤 / 产物路径 / 下一步；真源 = `references/templates/交接报告-template-lite.md`）。
//   **本脚本不产出、也不校验这两者中的任何一个**，故此处只留判据、不引字段清单（引错一侧即制造新的名实不一）。
const notes = [];
const trackArg = (opts['--track'] || '').trim();
if (ledgerBefore.exists) {
  if (!trackArg) {
    usageExit('本项目已有 `drafts/轮次账本.md` → **必须显式声明本轮轨别** `--track A|B|G|相位`\n'
      + `  当前账本记账：A ${ledgerBefore.counts.A}/2 ｜ B ${ledgerBefore.counts.B}/1 ｜ G ${ledgerBefore.counts.G}/2 ｜ 相位 ${ledgerBefore.counts.相位}（无额度）\n`
      + '  判据：轮次额度按**轨**分别记账（A ≤2 / B ≤1 / G ≤2），不声明轨别就无法判是否越额。');
  }
  if (!TRACKS.includes(trackArg)) usageExit(`--track 非法：「${trackArg}」（须 ∈ ${TRACKS.join('/')}）`);
  const cap = ROUND_CAPS[trackArg];
  const used = ledgerBefore.counts[trackArg] || 0;
  if (cap != null && used + 1 > cap) {
    usageExit(`⛔ **${trackArg} 轨额度已用满**（${used}/${cap}）——不再开新轮。\n`
      + (trackArg === 'A'
        ? '  按 `deliverables.md` §修订回环：A 轨第 3 轮应走 **Acknowledged Limitations**（未关闭 P0/P1 搬入 `final/局限性.md`）并升级主控，而不是继续打回。'
        : '  按 `_shared/文类档案.md`「T9 后处置」列：B 轨至多 +1；额度用尽后 T9 建议只出建议件（交付后由主控另行处置）。')
      + `\n  账本：${LEDGER_REL}`);
  }
  if (ledgerBefore.malformed.length) {
    // ── v19.5.0（反哺-merge清单-19条 §二.8）：**逐行降级，一处良构错误不得作废整表解析** ─────────
    //   旧行为：账本里只要有**任何一处**不可解析（如 `轮次` 列写成 `1`），本脚本一律 `exit 10`
    //   （理由写作「账本损坏时额度不可判 → 不得当通过」）。实测病灶：**9 处**此类报错把
    //   **格式完全正确的 B/G 行**也一并作废——把**局部**缺陷放大成**全局**失能。
    //   现口径：`parseLedger` 已改为**逐行降级**（坏行记 malformed 后跳过，其余行照判），
    //   故此处**额度判定照常进行**（上方 `used + 1 > cap` 与下方 `over` 均已按同一份 rows 判过）；
    //   残余边界如实声明：若该轨**一行都解析不出**，则 `counts[track] = 0` → 判定退化为「按 0 轮放行」，
    //   此时唯一可见信号就是汇总里 `ledgerMalformed` 那一段的 malformed 清单（**不得**读成「账本干净」）。
    notes.push(`账本有 ${ledgerBefore.malformed.length} 处不可解析：${ledgerBefore.malformed.slice(0, 3).join('；')}`
      + '——已按**逐行降级**照判其余行（v19.5.0 §二.8）；请修正这些行，否则该轨的累计轮次不可信。');
  }
  if (ledgerBefore.over.length) {
    usageExit(`账本已越额：${ledgerBefore.over.join('；')}\n  → 请先按升级路径处置，再开新轮。`);
  }
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const nodeBin = process.execPath;

// ---- ① baseline 复制 ----
const baselineCopied = !existsSync(nextPath);
if (baselineCopied && !dryRun) copyFileSync(prevPath, nextPath);

// ---- ② 前置测量（**仅用于「改前」对照**）----
// v18.13.0（全量审计 L-56 收口）：本函数此前同时被当作 **post**（改后）用，而它在 `③ 应用 diff` **之前**执行
//   → 「脚本实测」四个字报的是**改前**的字数。审计实测：v2 实际 300 汉字而脚本报 754，并把 754 写进
//   `修订说明-vN.md` 的「字数实值（脚本实测）」表 → 该表从此不可信（而它正是唯一验收口径的载体）。
//   另：旧实现 `slice(0, firstEnd)`（= 文件开头 → 文末节前）**含题名区与摘要**，与唯一验收口径
//   「摘要后 ~ 文末节前」不同，注释却写「同一口径」。现两者一起修正：
//     · 口径 = `bodyStartAfterAbstract` → `firstEndnoteIndex`（与 count-chars.mjs 同源）；
//     · 汉字统计**不再掩码**（v19.11.2 · 反哺 §P2-12）：与 `count-chars`（字数权威）同源。
//       旧版先过 `maskFences`，而 `count-chars` 没有围栏感知——同一段正文实测 31 vs 19 字
//       （差 12 来自含汉字的 ```json 块），于是修订说明的「脚本实测」与闸门引用的数字对不上。
//     · **改后的值在 diff 应用之后重算**（见下方 `post = measure(...)`）。
const measure = (p) => {
  const text = readFileSync(p, 'utf8');
  const from = bodyStartAfterAbstract(text).index;
  const i = firstEndnoteIndex(text, from);
  const to = i === -1 ? text.length : i;
  return { body: countHan(text.slice(from, to)), full: countHan(text) };
};
const pre = measure(prevPath);

// ---- ②′ 目标字数解析 + **应用前净变化预检**（v19.6.7 · 反哺 M-12）----
// v18.12.3：目标字数解析走 `_lib/target-chars.mjs` 唯一实现。旧行为内联 `\d{4,5}` →
//   `目标篇幅：300 字`（3 位）/ `12,000 字`（千分位）/ `1.2 万 字`（数量级单位）**全部解析不出**
//   → `charBand = null` → **字数硬阈整段判定被静默跳过、脚本仍 exit 0**，主控会以为「已核过」。
//   现在解析不到就**说出原因**（stderr 可见），不再让闸门无声失效。
// v19.6.7：本解析**上移到 ③ 应用之前**——净变化预检要用同一个 `charBand`；④ 只消费结果（同一事实一处）。
const briefPath = [join(projRoot, '01-任务简报.md')].find(existsSync);
const briefText = briefPath ? readFileSync(briefPath, 'utf8') : null;
const tParse = briefText !== null
  ? parseTargetChars(briefText)
  : { value: null, raw: null, reason: '未找到 01-任务简报.md（无法判定目标篇幅）' };
// v19.12.0（L1 批）：不足侧硬 / 软由简报 `FLOOR=hard|soft` 标记决定（文类 → 档位映射单一真源 =
//   `references/_shared/文类档案.md` §`FLOOR` 档）。**缺标记 = hard**（= 现行行为，历史项目不回填）；
//   `soft` **只作用于下限**——超限侧判定与退出码完全不变。
//   why 不用 `--genre`：本脚本本来就不收该旗标，为它加一个「文类 → 档位」表会造第二份真源
//   （`mform-gates.mjs` 的 `GENRE_MIN_L` 已是唯一那张，见该文件的受控取值注释）。
const floorSoft = briefText !== null
  && /(?:^|[^A-Za-z0-9_])FLOOR\s*=\s*soft(?![A-Za-z0-9_])/i.test(briefText);
const target = tParse.value;
if (target === null) {
  console.error(`⚠️ 目标字数未解析到 → **G8 字数硬阈判定跳过**（这是「未核」，不是「已核」）：${tParse.reason}`);
  if (tParse.raw) console.error(`   · 简报里读到的是：「${tParse.raw}」——请核对 §目标篇幅 的写法（支持 3–5 位、千分位逗号、万/千/k 单位）`);
}
const charBand = target ? { floor: Math.round(target * 0.9), ceil: Math.round(target * 1.05) } : null;

// ⚠️ **应用前净变化预检**（v19.6.7 · 反哺 · 生成式AI M-12 实测）：
//   病灶：段级 diff 模式**只后测不回滚**——该项目 v2 应用后 body 10,382（目标 8000、**+29.8%**）才暴露，
//   只能靠下一轮压缩回滚，**白耗一个 A 轨额度**（T5 自估 ≈8400，误差 ≈2000）。
//   净变化在**应用前**就可得：`apply-diff --dry-run` 不写盘，但 old/new 都在手 ⇒ `han_delta` 有值。
//   故这里先试算一次：若 `pre.body + delta` 会越过 +5% 阻塞线，就在**写盘前**响亮告警。
//   ⚠️ **只告警、不阻塞**（有意）：等量置换 / 删冗余 / G14 环内临时突破 ±2% 都是合法修订，
//   硬堵会把合法修订判死——本预检的职责是「让主控在付一个额度之前先看见代价」。
if (diffList && !dryRun && charBand) {
  const pv = spawnSync(nodeBin, [join(scriptDir, 'apply-diff.mjs'), nextPath, diffList, '--dry-run'], { encoding: 'utf8' });
  let delta = null;
  try { delta = JSON.parse(pv.stdout || '{}').han_delta; } catch { delta = null }
  if (typeof delta === 'number') {
    const projected = pre.body + delta;
    if (projected > charBand.ceil) {
      console.error(`⚠️ **应用前预检：本轮净变化会越线**——净增 ${delta} 字 ⇒ 改后正文 ≈ ${projected} 字，`
        + `超 +5% 阻塞线（${charBand.ceil}）**${projected - charBand.ceil} 字**。`);
      console.error('   → 处置建议：① 补写改走**等量置换**（本轮净增预算记 0 或负数）；② 先压缩再加；'
        + '③ 若属 G14 环内临时突破 ±2%，须在修订说明写明理由。**本预检只告警、不阻塞**。');
    } else {
      console.error(`✓ 应用前预检：净变化 ${delta >= 0 ? '+' : ''}${delta} 字 ⇒ 改后正文 ≈ ${projected} 字（+5% 阻塞线 ${charBand.ceil}，未越线）。`);
    }
  } else {
    console.error(`⚠️ 应用前预检**未取得净变化**（apply-diff --dry-run 未返回 han_delta，exit=${pv.status}）——`
      + '属「未核」而非「已核」；请在应用后用 ④ 的实测值回看。');
  }
}

// ---- ③ 应用 diff 清单 ----
let diffResult = null;
if (diffList) {
  if (dryRun) {
    diffResult = { skipped: 'dry-run' };
  } else {
    const r = spawnSync(nodeBin, [join(scriptDir, 'apply-diff.mjs'), nextPath, diffList, '--in-place'], { encoding: 'utf8' });
    diffResult = { status: r.status, stdout: (r.stdout || '').slice(0, 400), stderr: (r.stderr || '').slice(0, 400) };
    // v18.12.0 L-66：`status === null`（被信号杀死 / 子进程没起来）**不是内容判定**——旧版一律
    //   `exit 1`，而 1 在 M 门语义里是「P1 内容失败」，主控会据此误触发 T5 修订轮（同族事故：
    //   v18.0.5 引入 exit-guard 正是为消灭这类撞码）。故先分流到 70（EX_SOFTWARE）。
    if (r.status === null) {
      const how = describeSpawn(r);
      console.error(`apply-diff 未正常结算（${how}）：${diffResult.stderr || diffResult.stdout}`);
      console.error('→ 退出码 70（内部错误，非内容判定）；请重跑，若复现请回报 issue');
      process.exit(70);
    }
    if (r.status !== 0) {
      // v18.62.4（全量审计-v18.62.3 §8.1 #8）：**不得把子进程的任何非 0 都重写成 1**。
      //   病灶：旧版一律 `exit 1`，而 `apply-diff` 的契约是
      //     `0 = 全部条目应用 / 1 = 部分跳过或清单解析出 0 条 / 10 = 参数或路径错误`。
      //   于是 **`10`（清单路径/格式坏了）被重写成 `1`** → 主控按 M 门语义读成「**内容 P1 失败**」，
      //   据此去触发 T5 修订轮——**为一份格式错的清单付一次付费修订**（与 v18.0.5 引入 exit-guard
      //   要消灭的「撞码」是同一类事故，只是发生在父脚本这一侧）。
      //   修法：**直传子进程的实际码**（10 保持 10），并把「这是哪一类失败」写清楚；
      //   同时**不清理已写产物**——`apply-diff` 已按 `--in-place` 写了 `nextPath` 并可能留下 `.bak`，
      //   那是**审计线索**（哪些条目应用了、哪些被跳过），删掉会让 T7 无法回核。
      console.error(`apply-diff 失败（exit ${r.status}）：${diffResult.stderr || diffResult.stdout}`);
      if (r.status === 10) {
        console.error('→ 退出码 10（**参数/路径或清单格式错误，不是内容判定**）：请先核对清单路径与格式，'
          + '修正后重跑；**不要**按 M 门的「1 = P1 内容失败」去触发 T5 修订轮。');
      } else {
        console.error(`→ 退出码 ${r.status}（沿用 apply-diff 自身契约：1 = 部分跳过或清单解析出 0 条，需人工处理）。`);
      }
      console.error(`→ 已按 --in-place 写入的产物**保留**（${nextPath} 及其可能的 .bak），供回核「哪些条目应用/被跳过」。`);
      process.exit(r.status);
    }
  }
}

// ---- ④ 后置测量 + **G8 字数硬阈**（**必须在 ③ 应用 diff 之后**；v18.12.3 L-56）----
//   命名更正（2026-09-29，主人裁定）：本判定的审计归属是 **G8（成品度 + 字数偏差）**，机检项 = `G8-CharCount`。
//   本文件与 `_lib/target-chars.mjs` 过去把它叫「G5 阻塞线」——而 **G5 = 学术规范（查重 / AI 痕迹）**，
//   与字数无关（G 清单见 `references/glossary.md` §G）。故变量 `charBand`、字段 `charBand` / `charBandVerdict`。
// v18.57.x（审计修订 P1-4b）：**dry-run 没有改后稿可测**。
//   旧写法 `measure(existsSync(nextPath) ? nextPath : prevPath)` 在 dry-run 下仍会去量测磁盘上
//   **已存在**的 `初稿-vN.md`——它可能是历史占位或上一轮的残留，与本次运行毫无关系。
//   决策 JSON 的 nextBody / delta 一旦取自它，主控会把这个数字写进修订说明与闸门记录（正是 L-56 的
//   另一半：那次修的是「拿改前冒充改后」，这次修「拿无关文件冒充改后」）。
//   故：dry-run → post = null，并以 postMeasurement 显式说明「未测量」，不留给消费方猜。
const post = dryRun ? null : measure(existsSync(nextPath) ? nextPath : prevPath);
const postMeasurement = dryRun
  ? 'dry-run 未执行：不复制基线、不应用 diff，故无改后稿可测（nextBody / delta / nextFull 均为 null）'
  : null;
// v19.6.7：目标字数解析与 `charBand` 已在 **②′** 完成（净变化预检要用同一个 charBand）——此处只消费。
//   （旧版在 ④ 重算一遍：改带宽口径时必然漏改一处，属「同一事实两处」；现已收口。）
// 档位（2026-09-29 主人定案，真源 = `references/_shared/字数判定表.md` §二）：
//   · 超上限（> +5%）→ **P1**（原写 P0；裁定后**超限侧**已无 P0 档）——须压缩
//   · 低下限（< −10%）→ **P0**——须扩写（主人明示保留 P0：「字数低于下限 −10% 直接输出 P0，须扩写」）
//   ⚠️ verdict 的**前缀**（`超阻塞线` / `低于阻塞线` / `✓ 阻塞线内`）被 `apply-compression-cycle.mjs`
//   用 `includes()` 当作控制信号消费，**不得改字**；本次只改括注里的档位。
const charBandVerdict = dryRun
  ? '（dry-run 未测量改后字数——G8 字数硬阈不在本次判定内，须在真实修订轮后重跑）'
  : (charBand ? (post.body > charBand.ceil ? `超阻塞线 +${post.body - charBand.ceil} 字（P1，须压缩）` : (post.body < charBand.floor ? `低于阻塞线 ${charBand.floor - post.body} 字（${floorSoft ? 'P2，不阻塞——FLOOR=soft' : 'P0，须扩写'}）` : '✓ 阻塞线内')) : '（未解析到目标字数，跳过 G8 字数硬阈判定）');

// ---- ⑤ 内部流程词快扫（M-Form-4/5 前哨）----
const FLOW_WORDS = ['Phase\\s*\\d(\\.\\d)?', '承重', '一处两用', '素材加载清单', '修订说明', '初稿-v\\d', '审计环节', '批判报告'];
const scanText = readFileSync(existsSync(nextPath) ? nextPath : prevPath, 'utf8');
const flowHits = FLOW_WORDS.map((w) => {
  const re = new RegExp(w, 'g');
  return { word: w.replace(/\\\\/g, ''), count: (scanText.match(re) || []).length };
}).filter((x) => x.count > 0);

// ---- ⑥ 刷新证据包 ----
let bundleResult = null;
if (!flags.has('--skip-bundle') && !dryRun) {
  const r = spawnSync(nodeBin, [join(scriptDir, 'build-evidence-bundle.mjs'), projArg, '--summary'], { encoding: 'utf8' });
  bundleResult = { status: describeSpawn(r), tail: (r.stdout || '').split('\n').slice(-3).join(' ') };
}

// ---- ⑦ 修订说明骨架 ----
const revNotePath = join(projRoot, 'drafts', `修订说明-v${nTarget}.md`);
let revNote = dryRun ? (existsSync(revNotePath) ? '已存在（dry-run 未覆盖）' : 'dry-run 未生成') : '已存在（未覆盖）';
if (!existsSync(revNotePath) && !dryRun) {
  writeFileSync(revNotePath, `# 修订说明 — v${nTarget}（骨架由 apply-revision-cycle.mjs 生成，决策内容待主控回填）

## 一、轮次类别
<!-- 主控回填：A 轨审计打回轮 第 N/2 轮 或 B 轨主控触发轮 N/N（触发根因 = 哪份报告） -->

## 二、字数实值（脚本实测）

| 项目 | 实测 |
|------|------|
| v${nTarget - 1} body / full | ${pre.body} / ${pre.full} |
| v${nTarget} body / full | ${post.body} / ${post.full} |
| Δ body | ${post.body - pre.body >= 0 ? '+' : ''}${post.body - pre.body} |
| 目标 / G8 字数硬阈 | ${target ?? '未解析'} / ${charBand ? `${charBand.floor}–${charBand.ceil}` : '—'} |
| G8 字数判定 | ${charBandVerdict} |

## 三、内部流程词快扫
${flowHits.length ? flowHits.map((x) => `- ⚠️ 「${x.word}」×${x.count}（须清理或确认豁免位）`).join('\n') : '- ✓ 正文 0 命中'}

## 四、diff 应用记录
${diffList ? (diffResult?.skipped === 'dry-run' ? '- dry-run 未应用' : `- ${basename(diffList)} → exit ${diffResult.status}`) : '- 本轮未提供 --diff-list（baseline 复制 + 测量模式）'}

## 五、RL 清单（降级条目留痕）
<!-- 每一条接受脆弱/延后的条目逐条编号 RL-N；编号沿用上一版不重起 -->

## 六、下一步
<!-- 主控回填：派 T7 复核 / 主控微压缩 / 进入 Phase 4.5 等 -->

## 七、未处理项（v19.6.7 · 反哺 M-16：**每条必须可机检**，禁止只写「已留注 / 已处理」）
<!-- 每条须给：① 正文位置（§N 或行号）② 可复现的 grep -c 实据（把命令与实测数一起写出）
     ③ 「已删除 / 已留注 / 已改口径」三类声明一律以正文现状为准。
     判定依据（实测病灶，生成式AI v4）：§八 自报「§5.5 末段已留密度复算注」，
     而 grep 「反方密度|不均衡|0\.8」在该版正文 = **0 命中** —— 声明与正文不符 = 披露义务未履行，
     需 T7 独立 grep 全文才能发现（属「自报不可核」）。
     可与 §二「字数实值（脚本实测）」同源核对分节字数（segment-chars.mjs --list）。 -->
`, 'utf8');
  revNote = `已生成 ${revNotePath}`;
}

// ---- ⑧ 轮次账本落账（v18.81.0 · 独立审计批 2 · 2.1）----
// 为什么由**本脚本**落账（而不是留给主控手填）：本脚本就是「开一轮修订」这个动作本身，
//   落在这里才可能**不漂**——手填的账本在实测里从未存在过（全 `run/` 零命中，本批新立）。
// 无账本 = 存量项目：只提示、不阻塞（与批 1 的分段原则一致），并在输出里如实标注。
let ledgerWrite = 'skipped';
if (!ledgerBefore.exists) {
  ledgerWrite = `no-ledger（存量项目：未建 ${LEDGER_REL}，本脚本只提示不阻塞；新项目请由主控先建账本）`;
} else if (dryRun) {
  ledgerWrite = 'dry-run 未写';
} else {
  const r = appendLedgerRow(projRoot, {
    track: trackArg,
    n: (ledgerBefore.counts[trackArg] || 0) + 1,
    draft: `drafts/初稿-v${nTarget}.md`,
    source: diffList ? basename(diffList) : '',
  });
  ledgerWrite = r.created ? `已创建并落账 ${LEDGER_REL}（${r.appended}）` : `已追加一行到 ${LEDGER_REL}（${r.appended}）`;
}

// ---- 汇总 ----
console.log(JSON.stringify({
  project: projArg, targetVersion: nTarget,
  // v18.81.0（批 2.1）：轮次额度可见（`track` 为空 = 无账本的存量项目）
  track: trackArg || null,
  ledger: ledgerWrite,
  roundCaps: ROUND_CAPS,
  ledgerCounts: ledgerBefore.exists ? ledgerBefore.counts : null, baselineCopied,
  // v19.5.0（§二.8）：账本的**逐行降级**留痕——坏行照报、其余行照判（`[]` = 账本整体可解析）。
  ...(ledgerBefore.exists ? { ledgerMalformed: ledgerBefore.malformed, ledgerNotes: notes } : {}),
  chars: {
    prevBody: pre.body,
    nextBody: post ? post.body : null,
    delta: post ? post.body - pre.body : null,
    nextFull: post ? post.full : null,
    ...(postMeasurement ? { postMeasurement } : {}),
  },
  target, charBand, charBandVerdict,
  // 旧字段名 `g5` / `g5Verdict` 已随 2026-09-29 命名更正移除（字数归属 = G8，G5 = 学术规范）。
  // 兼容位**刻意不留**：留别名会把「同一个数两个名字」永久固化，正是本仓反复出问题的那一类。
  // 消费方（主控）读 `charBand` / `charBandVerdict`；本字段是脚本 JSON 契约，非对外 API。
  flowHits,
  diff: diffResult ? (diffResult.skipped ? 'dry-run' : `exit ${diffResult.status}`) : null,
  bundle: bundleResult ? bundleResult.status : (dryRun ? 'dry-run' : (flags.has('--skip-bundle') ? 'skipped(--skip-bundle)' : 'skipped')),
  revNote,
}, null, 2));

// v19.11.2（反哺 2026-10-17 §P0-2）：**字数阻塞线此前没有任何退出判定**（全文无 process.exit 分支），
//   于是「修订后仍低于下限（P0，须扩写）」与「已达标」在退出码上完全同形，主控按「只认 exit code」
//   会把不达标读成通过。现与 `apply-compression-cycle.mjs` 同解：越界统一 exit 1（不新开码，
//   `repo-hygiene-check` 规则⑧ 登记集合 `[0,1,10,70]` 不变）；dry-run 不测量（verdict 只是说明文案），不判。
// v19.12.0（L1 批）：不足侧按 `FLOOR=` 分流——`soft` 时只报告、不阻塞（exit 0）。
//   ⚠️ **前缀 `低于阻塞线` 一字不改**：它是 `apply-compression-cycle.mjs` 的 `includes()` 控制信号
//   （见 `:244-245` 的既有告诫），因此分流点在**退出条件**上，不在文案前缀上。
if (!dryRun && (/超阻塞线/.test(charBandVerdict) || (!floorSoft && /低于阻塞线/.test(charBandVerdict)))) process.exit(1);
process.exit(0);