#!/usr/bin/env node
// 论衡一键终检脚本（v2.5.2-dsh.7 新增 + v2.5.2-dsh.7 增强 JSON 输出）
// 用法: node scripts/final-check.mjs <run/项目名> [--no-summary] [--json] [--report <path>]
//   --no-summary : 跳过 build-evidence-bundle --summary 步骤
//   --json       : 静默子脚本输出，只输出终检 JSON 总报告（机器可读）
//   --report PATH: 同时把总报告写入 PATH（默认 audits/final-check-v0.json）
// 等价于依次执行（**顺序不可交换**，见下）：
//   1. scripts/count-chars.mjs <项目>/final/定稿.md
//   2. scripts/build-evidence-bundle.mjs <项目> --summary    (默认开；--no-summary 关)
//   3. scripts/m-gate-check.mjs   <项目>/final/定稿.md <项目>/final/证据包
//   ⚠️ **证据包刷新必须排在 M 门之前**（v17.0.0 顺序修复，端到端测试反哺）：旧顺序是
//      count-chars → m-gate-check → build-evidence-bundle，于是 M 门读到的是**上一次**收集的
//      证据包副本——实测文献卡在项目里已更新到 4 条而副本还是 2 条 → M-Form-10 误报
//      「头部 2 条 ≠ 正文 1 条」（假 P0）。**v18.12.0（全量审计 L-30）**：本注释块此前写的正是
//      那个**已被修掉的旧顺序**，维护者照它「修正」实现即会重演该假 P0——故此处改成与实现一致的顺序。
// 节省主控 T8 三次手动调用 + 上下文切换，节省 5-8 分钟 / 项目。
// v2.5.2-dsh.7 增强：解析 m-gate-check 的 JSON 输出与 count-chars 的 JSON 输出，汇总到 final-check.json，T8 终检可一次拿全报告不用 re-read 三个脚本输出
// v18.2.6 审计修复（P1-9）：
//   ① 可选步骤（`opt: true`）失败旧版**完全静默且不影响退出码** → 「count-chars 没跑起来」与
//      「字数正常」在报告里同形；现打印 ⚠️、计入报告（`optionalFailures`）并落在退出码上（见下方）；
//   ② `count-chars` 的 `degraded` 标记旧版**在聚合层被丢弃**（只取 hanChars/scope）→
//      「口径失真」可以与 `✅ 终检通过` 并存，且 `charScope` 照写 `body(正文区纯汉字…)`。
//      对照 `lib/tools.js:199`（原生工具路径）是**透传 degraded** 的 → 同一包两条消费路径口径不同；现透传；
//   ③ 末档把任何非 0/1/2/3/70 的码都渲染成「exit 10」→ 改准确（10 与非 10 分开）；
//   ④ 导入的 `EXIT_USAGE` 旧版未使用 → 现用于渲染与判定（不再让 10 只以字面量出现）。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installExitGuard, requireExistingDir, EXIT_USAGE, EXIT_INTERNAL } from './_lib/exit-guard.mjs'; // 退出码硬化（v18.0.5）
import { writeReport, pathKey } from './_lib/destructive-write.mjs';   // 报告写盘守卫（v18.12.0，全量审计 L-50）
import { parseArgs as parseCliArgs, USAGE_CODE as CLI_USAGE_CODE } from './_lib/cli-args.mjs';          // 参数解析唯一实现（v18.2.9，审计 A7）
installExitGuard();   // fs 类异常 → 10；其余内部错误 → 70（不再让崩溃伪装成「1 = P1 内容残留」）

// v18.2.9（第三方审计 A7）：参数解析迁移到 `_lib/cli-args.mjs` 唯一实现
//   （旧手写 find/indexOf：未知旗标静默忽略、多余位置参数静默取第一个——详见 cli-args 头注释）。
const args = process.argv.slice(2);
const FC_USAGE = '用法: node scripts/final-check.mjs <run/项目名> [--no-summary] [--json] [--report <path>] [--overwrite-adjudicated]';
let wantJson, noSummary, reportPath, overwriteAdjudicated, project;
try {
  const parsed = parseCliArgs(args, {
    flags: ['--json', '--no-summary', '--overwrite-adjudicated'],
    values: { '--report': 'final/final-check-report.json' },
    minPositionals: 1,
    maxPositionals: 1,
    positionalHint: '<run/项目名>',
  });
  wantJson = parsed.flags.has('--json');
  noSummary = parsed.flags.has('--no-summary');
  overwriteAdjudicated = parsed.flags.has('--overwrite-adjudicated');
  reportPath = parsed.opts['--report'];
  project = parsed.positionals[0];
} catch (e) {
  if (e && e.code === CLI_USAGE_CODE) { console.error(e.message); console.error(FC_USAGE); process.exit(10); }
  throw e;
}

if (!project || !existsSync(project)) {
  console.error(FC_USAGE);
  process.exit(10); // v18.0.2 修：参数/路径错误一律 10（旧版 2 与「P0 致命」撞码，且与下方推荐语声称的 else=exit 10 自相矛盾）
}
requireExistingDir(project, '项目目录');   // v18.0.5：传文件当项目 → 立即 10（旧版会走到 mkdirSync ENOTDIR 崩溃 → exit 1）

const final = join(project, 'final', '定稿.md');
const evDir = join(project, 'final', '证据包');
// scripts/ 绝对路径：必须用 fileURLToPath（URL.pathname 是 percent-encoded，
// 安装路径含空格/中文时子脚本全部找不到 → 误报「M 门未过」，v2.5.2-dsh.13 修复）
const scriptDir = dirname(fileURLToPath(import.meta.url));

const steps = [
  { name: 'count-chars.mjs', cmd: 'node', args: [join(scriptDir, 'count-chars.mjs'), final], opt: true, parse: 'count-chars' },
  // v18.57.x（审计修订）：先刷新证据卡，再跑 M 门，最后才生成审计视图。
  //   旧顺序 count-chars → build-evidence-bundle --summary → m-gate-check 导致审计视图读取
  //   的是**上一次**的 M-Gate-Report.json——若旧报告为 exit:0 而新 M 门为 exit:2，
  //   视图与报告不同步。现改为四步：字数 → 证据卡刷新 → M 门 → 审计视图（读本次报告）。
];
if (!noSummary) steps.push({ name: 'build-evidence-bundle.mjs（刷新证据卡）', cmd: 'node', args: [join(scriptDir, 'build-evidence-bundle.mjs'), project], opt: true, parse: null });
steps.push({ name: 'm-gate-check.mjs', cmd: 'node', args: [join(scriptDir, 'm-gate-check.mjs'), final, evDir, '--report', join(project, 'final', 'M-Gate-Report.json'), ...(overwriteAdjudicated ? ['--overwrite-adjudicated'] : [])], opt: false, parse: 'm-gate' });
// v18.64.0（反哺报告-v5 §v5.0-1）：`--overwrite-adjudicated` **必须能从这个唯一串联方透传**——
//   否则 T8 的正当「换稿重裁」会在 final-check 这一层被硬挡（m-gate-check 拒绝覆盖并 exit 3，
//   而 final-check 的 args 是写死的）→ 那会造出「唯一的正常入口反而进不去」的死结。
//   **它不是默认行为**：不带旗标时 M 门拒绝静默覆盖带裁定的报告，并把两条出路打在 stderr 上。

if (!wantJson) {
  console.log(`# final-check: ${project}`);
  console.log(`# 串联 ${steps.length} 步：${steps.map((s) => s.name).join(' → ')}\n`);
}

const t0 = Date.now();
let exitCode = 0;
const summary = [];
const parsedOutputs = {};
// v18.2.6（P1-9①）：可选步骤失败清单（旧版失败被吞 → 「终检通过」与「关键输入缺失」可并存）
const optionalFailures = [];
for (const step of steps) {
  if (!wantJson) console.log(`\n========== [${step.name}] ==========`);
  const r = spawnSync(step.cmd, step.args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, encoding: 'utf8' });
  // v18.0.5（第三方审计 P1-1）：`r.status === null` 表示**子进程根本没跑起来**（spawn 失败：node 不在 PATH、
  //   EACCES 等）。旧版把它记成 exit=1 → 报告说「⚠️ 存在 P1 残留，可触发 T5 修订一轮」——纯属误导。
  //   现在：spawn 失败记 `EXIT_INTERNAL`（70）并给出独立推荐语（属环境/脚本问题，不是内容问题）。
  const spawnFailed = r.status === null && (r.error || r.signal);
  const statusVal = spawnFailed ? EXIT_INTERNAL : r.status;
  const ok = statusVal === 0;
  // v18.64.2（自审批 P1）：**非零步的子进程 stderr 必须被 surface**。
  //   病灶（本批实测暴露，非本批引入）：旧版 `spawnSync` 用 `stdio:['ignore','pipe','pipe']` 捕获了 stderr
  //   却**从不读取**，而本文件自己的文案（:293 那句「请…查该步 stderr」）叫读者去看一个**从未被打印的东西**。
  //   本批之前这只是一个「文案与实现不符」的瑕疵；v18.64.0 起 `m-gate-check` 的**拒绝覆盖**把
  //   「两条出路」只打在 stderr 上 → 在 `final-check` 这条**T8 主管道**里，操作者只会看到 `exit 3` 而
  //   **看不到该怎么办**（`08-终检-finalizer.md` 正是让 T8 走这条命令）。故升为 P1 修掉。
  //   口径：只在**非零**时带（正常步的 stderr 是进度噪音，全带上会把报告撑爆）；截尾 1 200 字符。
  const stderrTail = (r.stderr || '').trim()
  summary.push({
    step: step.name, exit: statusVal, ok,
    ...(spawnFailed ? { spawnError: String(r.error?.message || r.signal) } : {}),
    ...(!ok && stderrTail ? { stderrTail: stderrTail.length > 1200 ? stderrTail.slice(-1200) : stderrTail } : {}),
  });
  // 解析子脚本的 JSON 输出（捕获整段 stdout，从头找第一个 { 到末尾找最后一个 }）
  if (step.parse) {
    const stdout = (r.stdout || '').trim();
    if (stdout) {
      try {
        // 直接尝试解析整段 stdout（子脚本输出只有 JSON）
        parsedOutputs[step.parse] = JSON.parse(stdout);
      } catch (e1) {
        // 回退：找首个 { 到最后一个 } 的子串
        const start = stdout.indexOf('{');
        const end = stdout.lastIndexOf('}');
        if (start >= 0 && end > start) {
          try {
            parsedOutputs[step.parse] = JSON.parse(stdout.slice(start, end + 1));
          } catch (e2) {
            parsedOutputs[step.parse] = { _parseError: e2.message, _stdoutHead: stdout.slice(0, 200) };
          }
        } else {
          parsedOutputs[step.parse] = { _parseError: e1.message, _stdoutHead: stdout.slice(0, 200) };
        }
      }
    }
  }
  if (!ok && !step.opt) {
    if (!wantJson) console.error(`\n❌ [${step.name}] 非零退出 ${statusVal}（硬依赖，主控必须修复）`);
    // v18.64.2：把该步自己的话原样转出来——它是**唯一**的处置线索（例：m-gate-check 的「拒绝覆盖」
    //   会在这里给出两条出路）。旧版把它吞掉，等于「让人查一份从不存在的日志」。
    if (stderrTail) console.error(`   ↳ 该步 stderr（原样，尾部 ${stderrTail.length} 字符）：\n${stderrTail}`);
    // 机器面同样要标注：`outputs[...]` 里的值是**该步 stdout 打印的**，而该步非零 ⇒ **落盘结果未确认**
    //   （v18.64.0 起 m-gate 的拒绝覆盖正是这种形态：stdout 说机械值 1，磁盘报告仍是旧裁定 0）。
    //   不给标注的话，只读 `outputs['m-gate'].exit` 的消费者会以为报告已被更新——本仓对
    //   「产物说 A、退出码说 B」有专门的历史教训（F-BF①）。
    if (step.parse && parsedOutputs[step.parse] && typeof parsedOutputs[step.parse] === 'object') {
      parsedOutputs[step.parse] = {
        ...parsedOutputs[step.parse],
        _stdoutOnly: true,
        _stdoutOnlyNote: '该步非零退出：上面这些字段来自它的 **stdout**，其**落盘结果未确认**（磁盘产物可能未更新）——判定请以各产物自身为准',
      };
    }
    exitCode = statusVal || 1;
    break;
  }
  // v18.2.6（P1-9①）：可选步骤失败**必须可见**（旧版 `opt: true` 失败既不打印也不改退出码 → 静默）
  if (!ok && step.opt) {
    optionalFailures.push({ step: step.name, exit: statusVal });
    console.error(
      `\n⚠️ [${step.name}] 可选步骤非零退出 ${statusVal} —— 本步骤输出缺失或不可用，`
      + `终检结论已按降级处理（不得据此认为该步骤「通过」）`,
    );
    if (stderrTail) console.error(`   ↳ 该步 stderr（原样）：\n${stderrTail}`);
  }
}

// v18.57.x（审计修订 P1-1）：审计视图**必须在 M 门之后**生成，且**不受 M 门非零退出影响**——
//   它是主控/主人诊断 M 门失败的工具，视图读到的 final/M-Gate-Report.json 必须是**本次**的。
//   故从 steps 循环中拆出来：循环内 m-gate-check（opt:false）非零会 break，若视图步骤还在
//   循环里就永远轮不到（旧版行为：M 门失败 → 无视图 → 只能看 JSON 报告猜）。
if (!noSummary) {
  const viewStep = { name: 'build-evidence-bundle.mjs --summary（审计视图）', cmd: 'node', args: [join(scriptDir, 'build-evidence-bundle.mjs'), project, '--summary'] };
  if (!wantJson) console.log(`\n========== [${viewStep.name}] ==========`);
  const r = spawnSync(viewStep.cmd, viewStep.args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, encoding: 'utf8' });
  const spawnFailed = r.status === null && (r.error || r.signal);
  const statusVal = spawnFailed ? EXIT_INTERNAL : r.status;
  summary.push({ step: viewStep.name, exit: statusVal, ok: statusVal === 0, ...(spawnFailed ? { spawnError: String(r.error?.message || r.signal) } : {}) });
  if (statusVal !== 0) {
    optionalFailures.push({ step: viewStep.name, exit: statusVal });
    console.error(`\n⚠️ [${viewStep.name}] 非零退出 ${statusVal} —— 审计视图未能生成（M 门报告已落盘，可用 --json 查看详细结果）`);
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
// === v18.2.6（P1-9②）：字数口径降级标记透传（旧版只取 hanChars/scope，degraded 在聚合层被丢弃）===
// 对照 `lib/tools.js:199`（原生工具路径）本就透传 degraded —— 同一包两条消费路径口径必须一致。
const charOut = parsedOutputs['count-chars'];
const charDegraded = charOut?.degraded === true;
const charScope = charOut?.scope ?? null;
const notes = [];
if (charDegraded) {
  notes.push(
    `字数口径失真：count-chars 置 degraded=true（${charOut?.degradedReason || '见 count-chars 输出'}）`
    + `——hanChars ${charOut?.hanChars ?? '缺失'} **不可作为权威值**，不得据此比对目标篇幅`,
  );
}
for (const f of optionalFailures) notes.push(`可选步骤「${f.step}」非零退出 ${f.exit}——该步骤的输入/产物不可信（缺则不是「通过」）`);

// v18.2.6（P1-9①）：可选步骤失败 / 字数口径失真时，**不得**给出「✅ 终检通过」。
//   归到既有语义码 3（「需复核，不得当作通过」）而不是造新码：它既不是内容 P0/P1，也不是脚本崩溃（70）。
//   若已完成步骤本身已给出 1/2/10/70，保留该更严重的码不动。
//   ⚠️ 必须在**构造 report 之前**改写 exitCode：否则 recommendation 仍按 0 渲染成「✅ 终检通过」，
//   那就等于把本项要修的「通过」与「关键输入缺失」并存原样保留。
if (exitCode === 0 && notes.length > 0) exitCode = 3;

// ── v18.62.7（反哺-主控实测-2026-10-02 §A5）：**交付判据 = 稳定态（stableExit）** ──────────────
//   病灶（实测 aigc-yixiangxing-meixue）：M 门机械值 = 1、T8 经 `--adjudicate` 裁定为 0（报告里
//     `exit`=0 / `script_exit_raw`=1 另存），而 `final-check` 的**进程退出码 = 1**、recommendation 写
//     「终检存在 P1 残留，主控**可**触发 T5 修订一轮」→ **同一件事在交付终结点上有两个读数，且退出码偏向悲观**。
//     T8 照 recommendation 走 = 对一份已被证伪四件套裁定为干净的稿子再开一轮修订（B 轨额度用尽时等于
//     无路可走）；照 T8 角色卡走 = 必须**忽略**脚本文案。**两种做法都不该由人来选。**
//   修法（报告 §A5 修法①②）：① 把 mGate 段抽出（下方报告直接引用）；② **裁定已覆盖本次非零**时，
//     `exit` 与进程退出码取裁定值，机械值**另存 `script_exit_raw`**（与 `m-gate-check.mjs` 的
//     同名字段同构：**两个数都在，权威那个更显眼**）；③ 文案里两个数同时可见。
//   ⚠️ 「裁定已覆盖」的判据是**窄的**（不是「有裁定就一律用裁定」）：只当本次非零**正是 M 门那一步**
//     造成的（`exitCode === mGateInfo.hardExit` —— steps 循环遇硬依赖失败即 `break`，而 M 门是最后一步，
//     故这个等式成立就是「M 门是首个失败步」），且裁定值存在且 ≠ 机械值。
//     **其它步骤**（count-chars 口径失真 → 3 / 内部错误 70 / 参数错 10）一律**原样保留**：
//     裁定只对 M 门的机械值有权威，不得把别的失败一并掩掉。
// v18.64.2（自审 + 独立审计 A-P0-① 残余）：**「m-gate 那一步非零」≠「磁盘报告属于本次运行」**。
//   病灶（实测）：v18.64.0 的**拒绝覆盖**让 m-gate 不写盘 → 磁盘上仍是**上一版正文**的裁定报告，
//   而下面 `mGateInfo` 照读不误 → `summary.mGate` 报出 `stableExit: 0` + note「机械值 1 → T8 裁定 0」，
//   同时进程码是 3（拒绝写盘）。**只读 `summary.mGate` 的消费方会把「拒绝」读成「已裁定放行」**——
//   与 F-BF①「产物说 A、退出码说 B」同型，只是这次错在**摘要块**而非退出码。
//   判据：**不做推断，读工具自己说的那个字段**——m-gate 在 stdout JSON 上给了 `write_refused`
//   （v18.64.2）。⚠️ 第一版按「那一步非零」推断，当场被 `tests/scripts.test.mjs` 的 A5 用例红掉：
//   同稿复跑的**进程码也是非零**（= 本次机械值），但报告照写、裁定照留。
const mGateStep = summary.find((s) => s.step === 'm-gate-check.mjs');
const mGateRefusedWrite = !!(parsedOutputs['m-gate'] && parsedOutputs['m-gate'].write_refused);

const mGateInfo = (() => {
  const mg = parsedOutputs['m-gate'];
  if (!mg || mg.exit === undefined) return null;
  let adjudicatedExit = null, adjudicatedBy = null;
  try {
    const rp = join(project, 'final', 'M-Gate-Report.json');
    if (existsSync(rp)) {
      const rep = JSON.parse(readFileSync(rp, 'utf8'));
      if (rep._t8_conclusion && typeof rep.exit === 'number' && rep.exit !== rep.script_exit_raw) {
        adjudicatedExit = rep.exit;
        adjudicatedBy = rep._t8_adjudicated_by || 'T8（主控亲执行）';
      }
    }
  } catch { /* 报告读不动不影响机械值——只是裁定值不可见，如实留 null */ }
  return {
    total: mg.total,
    pass: mg.pass,
    p0: mg.p0 || 0,
    p1: mg.p1 || 0,
    p2: mg.p2 || 0,
    soft: mg.soft || 0,
    skips: mg.skips || 0,
    hardExit: mg.exit,                        // 机械值（= M-Gate-Report.json 的 script_exit_raw 语义）
    adjudicatedExit,                          // T8 经 --adjudicate 写入的裁定值（null = 未裁定）
    adjudicatedBy,
    // **交付件应引用的稳定态**（有裁定取裁定）。⚠️ v18.64.2：本次 M 门**未写盘**时它**不适用** →
    //   显式 null（不给一个会被误读成「通过」的 0），并把原因写在 `stableExitApplies` / `reportIsStale` 上。
    stableExit: mGateRefusedWrite ? null : (adjudicatedExit ?? mg.exit),
    stableExitApplies: !mGateRefusedWrite,
    ...(mGateRefusedWrite
      ? {
        reportIsStale: true,
        reportIsStaleReason: `本次 m-gate 步**拒绝写盘**（write_refused=${mg.write_refused}，该步 exit ${mGateStep?.exit ?? 'n/a'}）——`
          + '上面这些裁定值取自**磁盘既有报告**，它绑定的是**上一版正文**，**不构成本次交付判据**'
          + '（处置见该步 stderr 的两条出路）',
      }
      : {}),
    note: mGateRefusedWrite
      ? `⚠️ 本次 M 门**拒绝写盘**（该步 exit ${mGateStep?.exit ?? 'n/a'}）：磁盘报告仍是**旧稿裁定**，**稳定态不适用**`
      : (adjudicatedExit !== null
        ? `机械值 ${mg.exit} → T8 裁定 ${adjudicatedExit}（稳定态 = ${adjudicatedExit}；交付件只引用稳定态，v18.52.0 F-BB）`
        : '无 T8 裁定（稳定态 = 机械值）'),
  };
})();
const adjudicationCoversFailure = !!(mGateInfo && typeof mGateInfo.hardExit === 'number'
  && exitCode === mGateInfo.hardExit
  && mGateInfo.adjudicatedExit !== null
  && mGateInfo.adjudicatedExit !== mGateInfo.hardExit);
const stableExitCode = adjudicationCoversFailure ? mGateInfo.adjudicatedExit : exitCode;

const report = {
  project,
  date: new Date().toISOString(),
  elapsedSec: parseFloat(elapsed),
  // v18.62.7（A5）：`exit` = **交付判据（稳定态）**；机械读数另存 `script_exit_raw`。两者不同时，
  //   报告本身把「为什么不同」写在 recommendation 里（不让人去猜）。
  exit: stableExitCode,
  script_exit_raw: exitCode,
  steps: summary,
  outputs: parsedOutputs,
  // 友好摘要（人类快速判断）
  summary: {
    hanChars: charOut?.hanChars ?? null,
    charScope,
    // v18.2.6：与 hanChars 同屏给出「这个数字能不能当权威值」，避免「口径失真」与「✅ 终检通过」并存
    charCountDegraded: charDegraded,
    charCountAuthoritative: charOut ? !charDegraded : false,
    charCountDegradedReason: charDegraded ? (charOut?.degradedReason || 'count-chars 未给出原因') : null,
    optionalFailures: optionalFailures.map((f) => `${f.step}(exit ${f.exit})`),
    notes,
    // ── v18.60.1（主人授权反哺 v2 §3.4）：**并列「机械值 / T8 裁定值」** ──
    //   为什么：`final-check` 只取 M 门的**机械值**，而 T8 可经 `--adjudicate` 把
    //   `final/M-Gate-Report.json` 的 `exit` 裁定为 0（机械值可能为 3 = 仅 P2）。旧版于是让交付件
    //   出现「M-Gate-Report 说 0 / final-check 说 3」的**自相矛盾**（实测：论衡实测项目-夫妻收入
    //   差异家庭权力 需主控手工同步 `final-check-v0.json` 的 5 个字段才解除）。
    //   判据：**机械值与裁定值都必须可见**；`stableExit` = 交付件应引用的**稳定态**（v18.52.0 F-BB）。
    //   v18.62.7（A5）：本段抽成上方 `mGateInfo`，这里直接引用（同一份实现，不再有两处 IIFE）。
    mGate: mGateInfo,
    // v18.0.0 修复：旧版只处理 0/1，其余一律落 `else` → **exit 3（仅 P2，无 P0/P1）被误报「存在 P0 致命问题」**。
    //   现按 M-Gate-Algorithm.md 的 exit 语义分档（0/1/2/3/10）。
    // v18.2.6：末档不再把「任何非 0/1/2/3/70 的码」都渲染成 exit 10（那是误导）——10 与非 10 分开。
    // v18.62.7（A5）：**本字段与 `exit` 都由稳定态渲染**（有 T8 裁定取裁定）；两数不同时前缀点明，
    //   使「脚本说 1、报告说 0」这类自相矛盾在**同一条文案里**就被解释掉（不再要求人去比对两份 JSON）。
    recommendation: (mGateInfo?.reportIsStale
      ? '[⚠️ 本次 M 门**拒绝写盘**：磁盘 `M-Gate-Report.json` 仍是**上一版正文**的裁定，**不得据此判定本次交付**；两条出路见该步 stderr] '
      : (stableExitCode !== exitCode
        ? `[交付判据 = 稳定态 ${stableExitCode}；机械读数 ${exitCode} 已被 T8 裁定覆盖（两份读数都在报告里）] `
        : '')) + (stableExitCode === 0
      ? '✅ 终检通过（无失败项），可交付主人终审'
      : stableExitCode === 1
      ? '⚠️ 终检存在 P1 残留，主控可触发 T5 修订一轮'
      : stableExitCode === 2
      ? '❌ 终检存在 P0 致命问题，禁止标记终检完成'
      : stableExitCode === 3
      ? (mGateInfo?.reportIsStale
        ? '⛔ M 门**拒绝覆盖**（exit 3，需人工复核）：磁盘报告未更新 → **本次没有有效稳定态**；请按该步 stderr 的两条出路处置（换稿重裁加 `--overwrite-adjudicated`，或走 `--adjudicate` 写新裁定）'
        : (notes.length
          ? `🔍 不足以判「通过」：${notes[0]}${notes.length > 1 ? `（另有 ${notes.length - 1} 条见 summary.notes）` : ''}——须 T8 逐项复核后以 T8 裁定值放行`
          : '🔍 仅 P2 / LLM兜底 / SKIP 残留（无 P0/P1）——须 T8 逐项复核后以 T8 裁定值放行（不得当作失败，也不得无条件当作通过）'))
      : stableExitCode === EXIT_INTERNAL
      ? '🛠️ 内部错误（EX_SOFTWARE 70）——子步骤未跑起来或脚本缺陷，**与正文内容无关**；核对上面的 spawnError/栈后重跑'
      : stableExitCode === EXIT_USAGE
      ? '⛔ 参数/路径错误（exit 10）——检查 m-gate-check 的定稿/证据包/图件目录参数'
      // v18.62.4（全量审计-v18.62.3 §8.1 #3）：**「不在 M 门契约里」不等于「未预期」**。
      //   病灶：旧文案把 30/4/20/21/22 这些**各自脚本契约内的合法码**统称为「未预期的退出码」——
      //   而本脚本 steps[] 里跑的 `build-evidence-bundle.mjs` **确实会 exit 30**（导出被拒），
      //   即这句话在真实运行中**会指向一个完全正常的语义**，把主控推去查「脚本是不是坏了」。
      //   修法：如实列出**已知的其他契约码及其归属**，并指明「按该步自身语义判读」。
      : `⚠️ 退出码 ${exitCode} **不在 M 门契约（0/1/2/3/10/70）内**——但这不代表脚本异常：`
        + '本步可能来自**另一套契约**的脚本。已知归属：'
        + ' **30** = `md2html` 导出被拒 或 `m-gate-check --adjudicate` 拒绝采纳（`build-evidence-bundle` 亦用）；'
        + ' **40** = 导出被拒（md2html 族）；'
        + ' **20/21/22** = `handoff-check` 交接门（20 产物缺失 / 21 结构不合 / 22 仅软提示）；'
        + ' **4** = `model-routing` 需人工决定。'
        + ' → 请按上面 `steps[]` 里**失败那一步自身的语义**判读并查该步 stderr，**不要默认当成 10，也不要判为脚本坏了**'),
  },
};
// v18.2.6（P1-9①）：exitCode 的改写已在构造 report 之前完成（见上方 notes 之后），此处不再二次改写。


if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n========== final-check 完成（${elapsed}s） ==========`);
  console.log(JSON.stringify(report, null, 2));
}

// 写报告到默认 / 指定路径
const finalReportPath = reportPath || join(project, 'audits', 'final-check-v0.json');
const reportDir = dirname(finalReportPath);   // 旧版硬编码反斜杠 → POSIX 与正斜杠 --report 都会崩（v2.5.2-dsh.13 修复）
if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
// v18.62.4（全量审计-v18.62.3 §8.1 #4，**主人裁定方案 (C)**）：**保持 `--report` 的 CWD 相对语义，
//   但把「它落在哪」由静默变成显式**。
//   为什么选 (C) 而不是改基准：`--report` 在全仓（m-gate-check / g-audit-check / cite-coverage-check /
//   apply-diff / quality-score）**都是 CWD 相对**，且 `pipeline-readme.md` 记过一次「子代理用
//   `--report final/M-Gate-Report.json` **覆盖了 T8 阶段裁定报告**」的事故——该基准是**被认知且被依赖**的约定，
//   改它 = 改全族语义。而原实现的真问题是：`writeReport` 与下方 `mkdirSync` 都会 `recursive: true`，
//   于是**误传相对路径会在 CWD 静默造目录/覆盖文件**，没有任何提示。
//   故此处只做两件事：① 打印**解析后的绝对路径**；② 若它落在**仓库根/包根**下（脚本目录向上回溯探测，
//   与 `writeReport` 的解析口径一致——都用 `resolve(base, v)`，不用 `join`），**响亮警告**。
const absReportPath = resolve(finalReportPath);
//   ⚠️ 探测层级（我第一次自证就踩到）：`scriptDir` = `<pkg>/skills/lunheng-article-pipeline/scripts`，
//   故**仓库布局**下包根在**向上三级**；**技能即包根**布局下是向上两级。首版只探了两级 →
//   真仓布局下**永远探不到** `package.json` → 这条警告**根本不触发**（实测：落仓库根却无警告）。
const pkgRootProbe = [join(scriptDir, '..', '..'), join(scriptDir, '..'), join(scriptDir, '..', '..', '..')]
  .find((p) => existsSync(join(p, 'package.json')));
if (pkgRootProbe && pathKey(absReportPath).startsWith(pathKey(pkgRootProbe))) {
  console.warn(`\n⚠ --report 目标落在**仓库/包根**内：${absReportPath}`);
  console.warn('  `--report` 的相对路径以**当前工作目录（CWD）**为基准——若非本意，请改用绝对路径或 <项目>/ 下的路径。');
  console.warn('  已知事故：曾用 `--report final/M-Gate-Report.json` 覆盖掉 T8 阶段的裁定报告。\n');
}
// v18.12.0（全量审计 L-50）：`--report` 旧版是裸 writeFileSync —— 路径敲成 final/定稿.md 即销毁交付物。
//   现走 writeReport：与定稿同文件 → exit 10；并留时间戳 .bak。
writeReport(finalReportPath, JSON.stringify(report, null, 2), { protect: [final] });
if (!wantJson) console.log(`\n📄 总报告: ${finalReportPath}（绝对路径：${absReportPath}）`);

// ⚠️ v18.62.7（A5）：进程退出码与 `report.exit` **同源 = 稳定态**（`repo-hygiene-check` 契约表里
//   `final-check.mjs: [0,1,2,3,10,70]` 不变；变的只是**取哪个数**）。
process.exit(stableExitCode);
