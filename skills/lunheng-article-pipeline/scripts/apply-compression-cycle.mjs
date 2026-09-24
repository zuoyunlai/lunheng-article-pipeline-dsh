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
import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installExitGuard, requireExistingDir } from './_lib/exit-guard.mjs';
import { parseArgs } from './_lib/cli-args.mjs';
import { countHan } from './_lib/han.mjs';
import { firstEndnoteIndex } from './_lib/sections.mjs';

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
const measure = (p) => {
  const text = readFileSync(p, 'utf8');
  const firstEnd = firstEndnoteIndex(text);
  const body = firstEnd >= 0 ? text.slice(0, firstEnd) : text;
  return { body: countHan(body), full: countHan(text) };
};
const m = measure(targetPath);

// ---- ② 目标字数 + G5 阻塞线 ----
let target = null;
const briefPath = join(projRoot, '01-任务简报.md');
if (existsSync(briefPath)) {
  const bt = readFileSync(briefPath, 'utf8');
  const tm = bt.match(/(?:目标篇幅|篇幅)[^\n]*?(\d{4,5})/);
  if (tm) target = Number(tm[1]);
}
const g5 = target ? { floor: Math.round(target * 0.9), ceil: Math.round(target * 1.05) } : null;
const verdict = g5 ? (m.body > g5.ceil ? `超阻塞线 +${m.body - g5.ceil} 字` : (m.body < g5.floor ? `低于阻塞线 ${g5.floor - m.body} 字` : '✓ 阻塞线内')) : '（未解析到目标字数）';

// ---- ③ 残留风险清单（哪些内容可能需要压缩）----
const INTERNAL_TERMS = ['承重', '一处两用', '素材加载清单', '初稿', '草稿', '修订说明', '审计环节', '流水线', '批判报告'];
const text = readFileSync(targetPath, 'utf8');
const firstEnd = firstEndnoteIndex(text);
const body = firstEnd >= 0 ? text.slice(0, firstEnd) : text;
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
  // 真源仓库根（向上两级定位 skills/lunheng-article-pipeline/）
  const repoRoot = join(scriptDir, '..', '..');
  const cc = spawnSync(nodeBin, [join(repoRoot, 'skills/lunheng-article-pipeline', 'scripts', 'consistency-check.mjs')], { encoding: 'utf8' });
  ccResult = { status: cc.status, tail: (cc.stdout || '').split('\n').slice(-3).join(' ') };
  const projArg = basename(projRoot) === 'lunheng-article-pipeline-dsh' ? join(projRoot, 'run', basename(projRoot)) : basename(projRoot);
  const bb = spawnSync(nodeBin, [join(repoRoot, 'skills/lunheng-article-pipeline', 'scripts', 'build-evidence-bundle.mjs'), basename(projRoot), '--summary'], { encoding: 'utf8' });
  bundleResult = { status: bb.status, tail: (bb.stdout || '').split('\n').slice(-3).join(' ') };
}

// ---- ⑥ 输出压缩决策 JSON ----
const result = {
  project: positionals[0],
  targetPath,
  chars: { body: m.body, full: m.full },
  target, g5, verdict,
  flowHits,
  sha256: shaMap,
  consistencyCheck: ccResult ? `exit ${ccResult.status}` : (dryRun ? 'dry-run' : 'skipped'),
  bundle: bundleResult ? `exit ${bundleResult.status}` : (dryRun ? 'dry-run' : 'skipped'),
  recommendation: verdict.includes('超阻塞线')
    ? `需进入 v(${Number(basename(targetPath).match(/\d+/)?.[0] || '3') + 1}) 修订轮；压缩目标 ${verdict.includes('+') ? verdict.split('+')[1].split(' ')[0] : '?'} 字（按 maxRounds=${maxRounds} 轮内）`
    : verdict.includes('低于阻塞线')
    ? `需扩写 ${verdict.split(' ')[2]} 字（按 §12 补检索方向）`
    : '✓ 无需修订',
};
console.log(JSON.stringify(result, null, 2));
if (verdict.includes('超阻塞线') && !dryRun) process.exit(1);
process.exit(0);