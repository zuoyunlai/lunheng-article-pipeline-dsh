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
// 边界（如实声明，三条）：
//   · **只替换已知形态的旧指纹**：正则锚定在「正文 sha256 / draft_sha256 / sha256:」字样附近，
//     不做「把所有 64 位 hex 都换掉」的危险操作（那会误伤证据包 manifest 的**条目** sha256）。
//   · 抓不到旧指纹 → 如实报「无可刷新项」并**不写盘**（这不是错误）。
//   · **不改正文、不改 `final/M-Gate-Report.json`**——后者的 `exit` 权威值只能由
//     `m-gate-check.mjs --adjudicate` 写入（本脚本不越权）。
//
// exit：0 = 无需刷新（或 dry-run 完成）/ 1 = 已刷新（有替换）/ 10 = 参数或路径错 / 70 = 内部错
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
const targets = [
  { rel: 'audits/闸门记录-T2.5.md', patterns: [/正文 sha256[^`\n]*`([0-9a-f]{64})`/g, /draft_sha256=`([0-9a-f]{64})`/g] },
  { rel: 'audits/闸门记录-T7.5.md', patterns: [/正文 sha256[^`\n]*`([0-9a-f]{64})`/g, /draft_sha256=`([0-9a-f]{64})`/g] },
  { rel: 'final/交付说明.md', patterns: [/sha256[:：]\s*`?([0-9a-f]{64})`?/g, /正文 sha256[:：]\s*`?([0-9a-f]{64})`?/g] },
];

const results = [];
let replaced = 0;
for (const t of targets) {
  const abs = join(project, t.rel);
  if (!existsSync(abs)) { results.push({ file: t.rel, status: 'skip', note: '文件不存在' }); continue; }
  let text = readFileSync(abs, 'utf8');
  const found = new Set();
  for (const re of t.patterns) {
    for (const m of text.matchAll(re)) found.add(m[1]);
  }
  const olds = [...found].filter((h) => h !== sha);
  if (!olds.length) {
    results.push({ file: t.rel, status: 'ok', note: found.size ? '指纹已是当前值' : '无可刷新项（未找到已知形态指纹）' });
    continue;
  }
  // 逐字符替换：仅替换被判定的旧指纹（各出现处）
  let n = 0;
  for (const oldSha of olds) {
    const parts = text.split(oldSha);
    n += parts.length - 1;
    text = parts.join(sha);
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
  note: replaced === 0
    ? '无旧指纹可刷新（各交付件的正文指纹已是当前值，或未见已知形态指纹）——未写盘'
    : `${dryRun ? '将' : '已'}刷新 ${replaced} 处正文指纹 → ${sha.slice(0, 12)}…（源 = ${src.rel}）`,
};
if (wantJson) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`源正文: ${src.rel}（${bytes} B / sha256 ${sha.slice(0, 12)}…）`);
  for (const r of results) {
    const c = r.count ? ` ×${r.count}` : '';
    console.log(`· ${r.file}: ${r.status}${c}${r.note ? `（${r.note}）` : ''}`);
  }
  console.log(out.note);
}
process.exit(replaced > 0 && !dryRun ? 1 : 0);
