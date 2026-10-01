#!/usr/bin/env node
// 发布前固定动作：**核对「跑完流程后仓库没有被任何工具改写」**
//
// 用法：node scripts/no-write-check.mjs [--root <目录>] [--json] [-- <命令…>]
//   · 默认：快照 → 跑**发布序列**（全量套 + 四道具）→ 逐步比对 → 报告被改写的文件
//   · `-- <命令…>`：只跑指定命令（用于怀疑某个具体工具时，例如 `-- node skills/.../consistency-check.mjs`）
//   · `--root <目录>`：改快照根（测试夹具用；默认 = 本仓库根）
// exit `0` 无改写**且每步都正常收尾** / `1` 有改写 **或** 有步骤未能开始/未正常收尾（逐项列名）
//      / `10` 参数错 / `70` 内部错误
//
// 为什么有这个脚本（**来自一次未定位成因的真实事故**，v18.44.0）：
//   发版前的 `consistency-check` 报出 `[P1 标题内嵌版本漂移] auto_cite-补充-template.md`——
//   该文件**标题里少了一段「借鉴 Ai4Scholar v2.9.1」**，而那段括注正是 `UPSTREAM_SPEC_VERSIONS`
//   里登记、用于豁免这条规则的项。查证：git 历史显示长形态自 v18.7.0 引入、此后**任何提交都没删过**，
//   短形态**从未被提交** → 是**工作树**被某个东西改写了。
//   逐条排除：① 非 `bump-version.mjs` 所为（把它的 12 条 RULE 跑在 HEAD 内容上模拟，只有「版本头」
//   命中、结果 ≠ 工作树）；② 非 `consistency-check --fix` 所为（只替换「（检查）」且只在 `--write` 下写盘）；
//   ③ 未复现于套件与四门（本脚本的前身「试纸」实测 83 个文档改写数 = 0）；④ 非临时探针脚本所为。
//   **成因至今未定位** —— 所以把当时的试纸固化成这条固定动作：**下次复现时当场抓住改写者**。
//   它同时覆盖另一类风险：**任何测试或工具偷偷写进真仓库**（例如测试忘了用夹具、直接改真文件）。
//
// 判据（为什么值得一条固定动作）：`git status` 只能显示**最终状态**，说不出「是谁改的、在哪一步改的」；
//   而逐步快照能直接把改写**归因到某一步**。发布流程里「跑完套件与四门」是必经动作，顺手核对成本≈0。
//
// ⚠️ **边界（如实）**：① 比对的是**净状态**——「写完又复原」的瞬态写入抓不到（那需要 fs 层审计，超出本脚本范围）；
//   ② 排除 `.git` / `node_modules` / `.dsh`（部署镜像，由 `mirror-sync` **有意**改写）/ `_backup` / `*.tgz`；
//   ③ 只核对**本仓库根**下的文件，不核对 `%TEMP%` 里的临时夹具（那正是测试该用的地方）。
//   另一条必须显式处理的陷阱：**「子进程没跑起来」与「跑了但没改写」在快照上完全一样**——
//   故本脚本对 spawn 失败单独判负（首版没有这一步，于是 `node node …` 的假绿被自己的测试抓出来）。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';

const argv = process.argv.slice(2);
let root = join(import.meta.dirname, '..');
let json = false;
let custom = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--root') {
    const v = argv[++i];
    if (!v || v.startsWith('--')) { console.error('--root 缺少值'); process.exit(10); }
    root = v;
  } else if (a === '--json') json = true;
  else if (a === '--') { custom = argv.slice(i + 1); break; }
  else { console.error(`未知参数: ${a}\n用法: node scripts/no-write-check.mjs [--root <目录>] [--json] [-- <命令…>]`); process.exit(10); }
}

/** 快照范围：仓库内**全部常规文件**，排除 `.git` / `node_modules` / `.dsh`（部署镜像，由 mirror-sync 有意改写）/ `_backup` / `*.tgz`（打包产物）。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.dsh', '_backup']);
function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (SKIP_DIRS.has(e.name)) continue; walk(p, out); }
    else if (e.isFile() && !e.name.endsWith('.tgz')) out.push(p);
  }
  return out;
}
function snapshot() {
  const map = new Map();
  for (const f of walk(root)) {
    try { map.set(relative(root, f), createHash('sha256').update(readFileSync(f)).digest('hex')); } catch { /* 读不到就跳过 */ }
  }
  return map;
}
/** 逐文件比较：区分「内容变了 / 新增 / 删除」——三者都算改写。 */
function compare(a, b) {
  const changed = [], added = [], removed = [];
  for (const [k, v] of b) {
    if (!a.has(k)) added.push(k);
    else if (a.get(k) !== v) changed.push(k);
  }
  for (const k of a.keys()) if (!b.has(k)) removed.push(k);
  return { changed, added, removed, total: changed.length + added.length + removed.length };
}
const show = (list) => list.map((f) => f.split(sep).join('/')).sort();

const REPO_SCRIPTS = join(root, 'scripts');
// 每一步 = `{ label, cmd, args }`。内置步骤都跑 node 脚本（cmd 默认 = 当前 node）；
// `-- <命令…>` 给的是**完整命令行**（如 `-- node scripts/x.mjs`）——**不要**在这条路径上再前置 node，
// 否则会变成 `node node …`（本脚本首版就这么错过：子进程 exit 1 且什么也没跑，检查器却报「无改写」）。
const STEPS = custom
  ? [{ label: `自定义命令：${custom.join(' ')}`, cmd: custom[0], args: custom.slice(1) }]
  : [
    { label: '全量套 node --test', cmd: process.execPath, args: ['--test', '--test-timeout=240000', 'tests/**/*.test.mjs', 'skills/*/tests/**/*.test.mjs'] },
    { label: '① consistency-check', cmd: process.execPath, args: [join(root, 'skills/lunheng-article-pipeline/scripts/consistency-check.mjs')] },
    { label: '② plugin-surface-check', cmd: process.execPath, args: [join(REPO_SCRIPTS, 'plugin-surface-check.mjs')] },
    { label: '③ repo-hygiene-check', cmd: process.execPath, args: [join(REPO_SCRIPTS, 'repo-hygiene-check.mjs')] },
    { label: '④ pack-smoke', cmd: process.execPath, args: [join(REPO_SCRIPTS, 'pack-smoke.mjs')] },
  ];

let before = snapshot();
if (before.size === 0) { console.error(`${root} 下快照到 0 个文件——--root 指错了吧`); process.exit(10); }
const steps = [];
try {
  for (const s of STEPS) {
    if (!s.cmd) { console.error('自定义命令为空'); process.exit(10); }
    const pre = snapshot();
    let exit = 0, spawnErr = null;
    try { execFileSync(s.cmd, s.args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }); }
    catch (e) {
      // v18.62.4（全量审计-v18.62.3 P1-1/P1-11）：**「没跑起来」不等于「没改写」**。
      // 旧实现只记三种码，于是 EPERM / EACCES（受限沙箱禁命名管道）被记成 `exit=-1` 后**完全不影响结论**
      // —— CI 里本脚本正包着全量测试（ci.yml:178），被包命令失败时步骤照样绿。
      // 现改为**归因三分类**（每类都具名落盘，不把不同原因混成一个数字）：
      //   ① notFound ：可执行文件找不到（ENOENT）——命令名写错；
      //   ② notStart ：受限环境拒绝派生（EPERM/EACCES）等——**环境不可用**，不是「无改写」；
      //   ③ exitedNonZero：真跑起来了但自己退非 0（含脚本自身的「有发现」语义，如 exit 1）。
      // 三者与「跑了且 exit 0 且无改写」在快照上**完全一样**，故必须显式区分。
      exit = e.status ?? -1;
      if (e.code === 'ENOENT') spawnErr = `找不到命令 ${s.cmd}（ENOENT）`;
      else if (e.code === 'EPERM' || e.code === 'EACCES') spawnErr = `无法派生（${e.code}）：环境拒绝启动该命令——**不是**「无改写」`;
      else if (exit === -1 || exit === null) spawnErr = `未能启动（${e.code || '未知'}）`;
    }
    const d = compare(pre, snapshot());
    steps.push({ label: s.label, exit, spawnErr, ...d });
  }
} catch (e) {
  console.error(`no-write-check 内部错误：${e.message}`);
  process.exit(70);
}
const total = compare(before, snapshot());
const bad = steps.filter((s) => s.total > 0);
const notRun = steps.filter((s) => s.spawnErr);
// v18.62.4（P1-1/P1-11）：**被包命令自己退非 0 也必须判负**。
//   为什么（本条的由来）：CI 用本脚本包住全量测试（`.github/workflows/ci.yml:178`），
//   而旧版只看 `spawnErr`（ENOENT）与改写数 → 被包测试**失败也不影响步骤结果**，
//   于是 PR/push 侧 604 个用例全部变成非阻塞守卫（发版侧 publish.yml 才拦，为时已晚）。
//   代价与边界（如实）：脚本自身的「有发现」语义（如 `-- node scripts/consistency-check.mjs`
//   自报 exit 1）也会让本步判负——这正是「有发现就不该绿」的期望，但在**单命令排查**用法下
//   要读下面的归因行区分「它发现了问题」与「它没跑起来」。
const unexpected = steps.filter((s) => !s.spawnErr && s.exit !== 0);

if (json) {
  console.log(JSON.stringify({ root, steps, total: { ...total, changed: show(total.changed), added: show(total.added), removed: show(total.removed) } }, null, 2));
} else {
  for (const s of steps) {
    const mark = s.spawnErr ? '!' : (s.total === 0 ? '✓' : '✗');
    console.log(`  ${mark} ${s.label.padEnd(26)} exit=${String(s.exit).padStart(3)}  改写 ${s.total}${s.spawnErr ? `  ← ${s.spawnErr}` : ''}`);
    if (s.total > 0) {
      if (s.changed.length) console.log(`      内容变：${show(s.changed).join(', ')}`);
      if (s.added.length) console.log(`      新增：${show(s.added).join(', ')}`);
      if (s.removed.length) console.log(`      删除：${show(s.removed).join(', ')}`);
    }
  }
  console.log(
    notRun.length > 0
      ? `\n✗ **有步骤没跑起来**（${notRun.length} 步）：${notRun.map((s) => s.label).join('、')}`
        + '\n  ——「没跑」与「跑了没改写」在快照上一样，故必须显式失败。'
        + '\n  常见成因：命令名写错（ENOENT）／受限文件策略禁子进程（EPERM，此时**整条检查无效**，'
        + '应改用完整权限或直接跑对应门，而不是把本步当通过）。'
      : unexpected.length > 0
        ? `\n✗ **有步骤未正常收尾**（${unexpected.length} 步）：`
          + unexpected.map((s) => `${s.label}（exit=${s.exit}）`).join('、')
          + '\n  ——被包命令退非 0 = 它**自报失败或有发现**，本步不得判绿。'
          + '\n  若这是「命令自身的有发现语义」（如 consistency-check 报出漂移），请按上表 exit 码判读该门结论；'
          + '\n  若这是「命令没跑起来」，它应已被上一类（没跑起来）捕获——两者都在上表里逐行可见。'
        : bad.length === 0
          ? `\n✓ 无改写：${steps.length} 步全部 exit 0 且仓库 ${before.size} 个文件逐一哈希未变`
          : `\n✗ **有改写**：${bad.length} 步改动了仓库（详见上表）。这说明某一步在上面的流程里**写了真仓库**——`
            + '典型成因：测试忘了用临时夹具、工具把「检查」实现成了「修复」、或脚本的路径推导偏到了真源树。',
  );
}
process.exit(notRun.length > 0 || unexpected.length > 0 || bad.length > 0 ? 1 : 0);
