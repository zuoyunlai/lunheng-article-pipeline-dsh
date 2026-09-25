#!/usr/bin/env node
// 论衡字数压缩编排脚本（v18.9.x 实战反哺新增，2026.09.23）
// 用法：node apply-compression-cycle.mjs <run/项目名> [--target-N <N>] [--max-rounds <3>] [--skip-bundle] [--dry-run]
// 一条命令串起实战项目收尾阶段的字数压缩循环：
//   ① 量测当前字数（body / full，与 count-chars.mjs 同源 _lib/han.mjs + _lib/sections.mjs）
//   ② 判 G5 阻塞线（目标字数从 01-任务简报.md §目标篇幅 提取；G5 = −10% / +5%）
//   ③ 若超阻塞线 → 触发 T5 v(N+1) 段级 diff（自动生成微压缩清单，主控可批准应用）
//   ④ sha256 校验（所有 final/ 文件 — 与 _lib/destructive-write.mjs 的 sameFile 策略一致）
//   ⑤ 刷新一致性门（consistency-check.mjs）+ 证据包（build-evidence-bundle.mjs）+ 审计视图
//   ⑥ 输出压缩决策 JSON + 残留风险清单
// 退出码：0 = 阻塞线内通过 / 1 = 仍超阻塞线需 T5 修订轮 / 10 = 参数路径错 / 70 = 内部错误
// v18.12.0 L-66：删除 `writeFileSync` / `copyFileSync`——两者从未在本文件被调用（纯冗余导入）。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installExitGuard, requireExistingDir, describeSpawn } from './_lib/exit-guard.mjs';
import { parseArgs } from './_lib/cli-args.mjs';
import { countHan } from './_lib/han.mjs';
import { parseTargetChars } from './_lib/target-chars.mjs';   // v18.12.3：目标字数解析唯一实现（3-5 位 / 千分位 / 万·千·k）
import { firstEndnoteIndex, maskFences, bodyStartAfterAbstract } from './_lib/sections.mjs';   // v18.12.3 L-56 同族：正文区口径与 count-chars 同源

installExitGuard();

const argv = process.argv.slice(2);
const USAGE = '用法: node apply-compression-cycle.mjs <run/项目名> [--target-N <N>] [--max-rounds <3>] [--skip-bundle] [--dry-run]';
const usageExit = (why) => { console.error(why); console.error(USAGE); process.exit(10); };

let flags, opts, positionals;
try {
  ({ flags, opts, positionals } = parseArgs(argv, {
    flags: ['--skip-bundle', '--dry-run'],
    values: { '--target-N': 'final/定稿.md', '--max-rounds': '3' },
    minPositionals: 1,
    maxPositionals: 1,
    positionalHint: '<run/项目名>',
  }));
} catch (e) { usageExit(e.message); }

const projRoot = requireExistingDir(positionals[0], '项目目录');
const targetPath = existsSync(opts['--target-N'])
  ? opts['--target-N']
  : join(projRoot, 'final/定稿.md');
if (!existsSync(targetPath)) usageExit(`目标文件不存在：${targetPath}`);
const maxRounds = Number(opts['--max-rounds']) || 3;
const dryRun = flags.has('--dry-run');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const nodeBin = process.execPath;

// ---- ① 量测字数 ----
// v18.13.0（L-56 同族收口）：body 口径与 `count-chars.mjs` 对齐 ——「**摘要后** ~ 文末节前」，
//   并把汉字统计先过 `maskFences`（围栏内文字不计入正文）。旧版 `slice(0, firstEnd)`（文件开头 → 文末节前）
//   **含题名区与摘要**，与本仓唯一验收口径不同；`apply-revision-cycle` 同源缺陷已在本版一并修正。
const bodyOf = (text) => {
  const from = bodyStartAfterAbstract(text).index;
  const i = firstEndnoteIndex(text, from);
  return maskFences(text).slice(from, i === -1 ? text.length : i);
};
const measure = (p) => {
  const text = readFileSync(p, 'utf8');
  return { body: countHan(bodyOf(text)), full: countHan(text) };
};
const m = measure(targetPath);

// ---- ② 目标字数 + G5 阻塞线 ----
// v18.12.3：解析改走 `_lib/target-chars.mjs` 唯一实现（旧内联 `\d{4,5}` 在 `300 字` / `12,000 字` /
//   `1.2 万 字` 上全返回 null → `g5 = null` → **G5 判定被静默跳过**）。解析不到必须说出来。
const briefPath = join(projRoot, '01-任务简报.md');
const tParse = existsSync(briefPath)
  ? parseTargetChars(readFileSync(briefPath, 'utf8'))
  : { value: null, raw: null, reason: '未找到 01-任务简报.md' };
const target = tParse.value;
if (target === null) {
  console.error(`⚠️ 目标字数未解析到 → **G5 阻塞线判定跳过**（这是「未核」，不是「已核」）：${tParse.reason}`);
  if (tParse.raw) console.error(`   · 简报里读到的是：「${tParse.raw}」——请核对 §目标篇幅 的写法（支持 3–5 位、千分位逗号、万/千/k 单位）`);
}
const g5 = target ? { floor: Math.round(target * 0.9), ceil: Math.round(target * 1.05) } : null;
const verdict = g5 ? (m.body > g5.ceil ? `超阻塞线 +${m.body - g5.ceil} 字` : (m.body < g5.floor ? `低于阻塞线 ${g5.floor - m.body} 字` : '✓ 阻塞线内')) : '（未解析到目标字数）';

// ---- ③ 残留风险清单（哪些内容可能需要压缩）----
// v18.12.3：正文区口径改走上面同一个 `bodyOf`（旧版在这里又写了一遍 `slice(0, firstEnd)`——
//   同一文件两处口径，正是「同族缺陷复发」的典型形态）。
const INTERNAL_TERMS = ['承重', '一处两用', '素材加载清单', '初稿', '草稿', '修订说明', '审计环节', '流水线', '批判报告'];
const text = readFileSync(targetPath, 'utf8');
const body = bodyOf(text);
const flowHits = INTERNAL_TERMS.map((w) => ({ word: w, count: (body.match(new RegExp(w, 'g')) || []).length })).filter((x) => x.count > 0);

// ---- ④ sha256 校验（所有 final/ 文件）----
const finalDir = dirname(targetPath);
const shaMap = {};
const hashOne = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
for (const f of readdirSync(finalDir).filter((x) => x.endsWith('.md'))) {
  shaMap[f] = { sha256: hashOne(join(finalDir, f)), bytes: readFileSync(join(finalDir, f)).length };
}

// ---- ⑤ 刷新一致性门 + 证据包 + 审计视图 ----
let ccResult = null;
let bundleResult = null;
if (!dryRun) {
  // 项目参数**原样透传**用户传入的 `<run/项目名>`（与 apply-revision-cycle.mjs 同源）；旧版把
  //   `basename(projRoot)` 传给下游 —— 那只是目录名（丢了 `run/` 前缀），下游按「相对 cwd
  //   的项目路径」解析即落空。
  const projArg = positionals[0];
  // 技能目录 = 脚本目录的上一级（`<skill>/scripts/` → `<skill>/`）。v18.12.0 L-61 修正：旧版此处
  //   写 `join(repoRoot, 'skills/lunheng-article-pipeline', 'scripts', …)`，**引用了本文件从未定义的
  //   变量** `repoRoot` → 非 dry-run 必然 ReferenceError → exit-guard 归为内部错误 exit 70 →
  //   决策 JSON 里一致性门与证据包恒为 `exit null`（收尾阶段主控据此误判门未跑）。
  const skillRoot = join(scriptDir, '..');
  const cc = spawnSync(nodeBin, [join(skillRoot, 'scripts', 'consistency-check.mjs')], { encoding: 'utf8' });
  ccResult = { status: describeSpawn(cc), tail: (cc.stdout || '').split('\n').slice(-3).join(' ') };
  if (!flags.has('--skip-bundle')) {
    // v18.12.0 L-66：`--skip-bundle` 此前只在 `parseArgs` 白名单里挂着、**从未被读取**——声明了却
    //   无效果的开关（主控以为跳过、实际照跑）。现与 apply-revision-cycle.mjs 同义：跳过**证据包**
    //   刷新；一致性门仍刷新（只读，不写项目产物）。
    const bb = spawnSync(nodeBin, [join(scriptDir, 'build-evidence-bundle.mjs'), projArg, '--summary'], { encoding: 'utf8' });
    bundleResult = { status: describeSpawn(bb), tail: (bb.stdout || '').split('\n').slice(-3).join(' ') };
  }
}

// ---- ⑥ 输出压缩决策 JSON ----
const result = {
  project: positionals[0],
  targetPath,
  chars: { body: m.body, full: m.full },
  target, g5, verdict,
  flowHits,
  sha256: shaMap,
  consistencyCheck: ccResult ? ccResult.status : (dryRun ? 'dry-run' : 'skipped'),
  bundle: bundleResult ? bundleResult.status : (dryRun ? 'dry-run' : (flags.has('--skip-bundle') ? 'skipped(--skip-bundle)' : 'skipped')),
  recommendation: verdict.includes('超阻塞线')
    ? `需进入 v(${Number(basename(targetPath).match(/\d+/)?.[0] || '3') + 1}) 修订轮；压缩目标 ${verdict.includes('+') ? verdict.split('+')[1].split(' ')[0] : '?'} 字（按 maxRounds=${maxRounds} 轮内）`
    : verdict.includes('低于阻塞线')
    ? `需扩写 ${verdict.split(' ')[2]} 字（按 §12 补检索方向）`
    : '✓ 无需修订',
};
console.log(JSON.stringify(result, null, 2));
// v18.16.0（A-6 反哺）：原 `&& !dryRun` 让 dry-run 模式即便判定超阻塞线也 exit 0，
//   违反「dry-run 只影响写盘、不影响判定」约定（T7/T8 据 exit 决定是否触发 T5 修订）。
//   现去掉 `!dryRun` —— 无论是否 dry-run，超阻塞线统一 exit 1。
if (verdict.includes('超阻塞线')) process.exit(1);
process.exit(0);