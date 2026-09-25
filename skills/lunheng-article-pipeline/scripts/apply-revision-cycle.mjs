#!/usr/bin/env node
// 论衡修订循环编排脚本（v18.8.x 实战反哺新增，2026.09.22）
// 用法：node apply-revision-cycle.mjs <run/项目名> <目标版本号N> [--diff-list <analysis/vN-diff-list.md>] [--skip-bundle] [--dry-run]
// 一条命令串起主控修订轮的机械步骤（此前每轮 ≈8 次手工工具调用，实战 v2/v3 两轮主控做了 4 次额外微压缩）：
//   ① cp drafts/初稿-v(N-1).md → drafts/初稿-vN.md（vN 已存在则跳过复制、只测量——防重复运行覆盖已修订稿）
//   ② count-chars 前置口径测量（body = 摘要后~文末节前 纯汉字，与 count-chars.mjs 同源 _lib/han.mjs + _lib/sections.mjs）
//   ③ 应用段级 diff 清单（--diff-list 时委托 apply-diff.mjs --in-place，自动带时间戳 .bak；汉字 delta 由其实测）
//   ④ 后置测量 + G5 阻塞线判定（目标字数从 01-任务简报.md §目标篇幅 提取；G5 = −10% / +5%）
//   ⑤ 内部流程词残留快扫（Phase N.N / 承重 / 一处两用 / 修订说明 等——M-Form-4/5 的前哨，只报数不判死）
//   ⑥ 刷新证据包 + 审计视图（委托 build-evidence-bundle.mjs <项目> --summary；--skip-bundle 跳过）
//   ⑦ 生成 drafts/修订说明-vN.md 骨架（已存在则不覆盖；字数表预填实测值，决策内容留占位给主控）
// 退出码：0 = 循环完成 / 1 = diff 清单解析 0 条或 apply-diff 失败（**含「部分跳过」**——v18.12.0 L-60 如实修正：
//   旧注释写「0 = 循环完成（含 diff 部分跳过时的提示）」，而实现在 apply-diff 返回 1（**部分跳过时它正是 1**）
//   时直接 `exit 1` → 主控会读成「diff 失败」，尽管**产物已经落盘**）
//   / 10 = 参数路径错 / **70 = 内部错误**（脚本缺陷；v18.12.0 L-66 起另含「apply-diff 子进程未正常
//   结算」——`status === null` 即被信号杀死或根本没起来，旧版按 `exit 1` 报出，与「1 = P1 内容失败」撞码）
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installExitGuard, requireExistingDir, describeSpawn } from './_lib/exit-guard.mjs';
import { parseArgs } from './_lib/cli-args.mjs';
import { countHan } from './_lib/han.mjs';
import { firstEndnoteIndex } from './_lib/sections.mjs';

installExitGuard();

const argv = process.argv.slice(2);
const USAGE = '用法: node apply-revision-cycle.mjs <run/项目名> <目标版本号N> [--diff-list <analysis/vN-diff-list.md>] [--skip-bundle] [--dry-run]';
const usageExit = (why) => { console.error(why); console.error(USAGE); process.exit(10); };

let flags, opts, positionals;
try {
  ({ flags, opts, positionals } = parseArgs(argv, {
    flags: ['--skip-bundle', '--dry-run'],
    values: { '--diff-list': '' },
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
const diffList = opts['--diff-list'] ? join(process.cwd(), opts['--diff-list']) : '';
if (diffList && !existsSync(diffList)) usageExit(`--diff-list 文件不存在：${diffList}`);
const dryRun = flags.has('--dry-run');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const nodeBin = process.execPath;

// ---- ① baseline 复制 ----
const baselineCopied = !existsSync(nextPath);
if (baselineCopied && !dryRun) copyFileSync(prevPath, nextPath);

// ---- ②/④ 测量（同一口径：body = 摘要后~文末节前）----
const measure = (p) => {
  const text = readFileSync(p, 'utf8');
  const firstEnd = firstEndnoteIndex(text);
  const body = firstEnd >= 0 ? text.slice(0, firstEnd) : text;
  return { body: countHan(body), full: countHan(text) };
};
const pre = measure(prevPath);
const post = measure(existsSync(nextPath) ? nextPath : prevPath);

// ---- 目标字数 + G5 阻塞线（01-任务简报.md §目标篇幅）----
let target = null;
const briefCandidates = [join(projRoot, '01-任务简报.md')].filter(existsSync);
if (briefCandidates.length) {
  const bt = readFileSync(briefCandidates[0], 'utf8');
  const m = bt.match(/(?:目标篇幅|篇幅)[^\n]*?(\d{4,5})/);
  if (m) target = Number(m[1]);
}
const g5 = target ? { floor: Math.round(target * 0.9), ceil: Math.round(target * 1.05) } : null;
const g5Verdict = g5 ? (post.body > g5.ceil ? `超阻塞线 +${post.body - g5.ceil} 字（P0，须压缩）` : (post.body < g5.floor ? `低于阻塞线 ${g5.floor - post.body} 字（P0，须扩写）` : '✓ 阻塞线内')) : '（未解析到目标字数，跳过 G5 判定）';

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
      console.error(`apply-diff 失败（exit ${r.status}）：${diffResult.stderr || diffResult.stdout}`);
      process.exit(1);
    }
  }
}

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
| 目标 / G5 阻塞线 | ${target ?? '未解析'} / ${g5 ? `${g5.floor}–${g5.ceil}` : '—'} |
| G5 判定 | ${g5Verdict} |

## 三、内部流程词快扫
${flowHits.length ? flowHits.map((x) => `- ⚠️ 「${x.word}」×${x.count}（须清理或确认豁免位）`).join('\n') : '- ✓ 正文 0 命中'}

## 四、diff 应用记录
${diffList ? (diffResult?.skipped === 'dry-run' ? '- dry-run 未应用' : `- ${basename(diffList)} → exit ${diffResult.status}`) : '- 本轮未提供 --diff-list（baseline 复制 + 测量模式）'}

## 五、RL 清单（降级条目留痕）
<!-- 每一条接受脆弱/延后的条目逐条编号 RL-N；编号沿用上一版不重起 -->

## 六、下一步
<!-- 主控回填：派 T7 复核 / 主控微压缩 / 进入 Phase 4.5 等 -->
`, 'utf8');
  revNote = `已生成 ${revNotePath}`;
}

// ---- 汇总 ----
console.log(JSON.stringify({
  project: projArg, targetVersion: nTarget, baselineCopied,
  chars: { prevBody: pre.body, nextBody: post.body, delta: post.body - pre.body, nextFull: post.full },
  target, g5, g5Verdict,
  flowHits,
  diff: diffResult ? (diffResult.skipped ? 'dry-run' : `exit ${diffResult.status}`) : null,
  bundle: bundleResult ? bundleResult.status : (dryRun ? 'dry-run' : (flags.has('--skip-bundle') ? 'skipped(--skip-bundle)' : 'skipped')),
  revNote,
}, null, 2));
