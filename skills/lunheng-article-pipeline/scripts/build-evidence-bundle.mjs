#!/usr/bin/env node
// build-evidence-bundle.mjs — T8 终检：自动生成 final/证据包/ + 可选 audits/审计视图-v0.md
// 用法: node scripts/build-evidence-bundle.mjs <run/项目名> [--project <名>] [--source <正文路径>] [--summary] [--deep-summary]
// 行为:
//   默认：收集 文献卡/数据卡/案例卡/先行者清单/分析大纲/批判报告/审计报告/复核报告/反哺报告/修订说明*/status/01-任务简报 + **final/图件/*.svg** 到 <项目>/final/证据包/
//   --summary：额外生成 <项目>/audits/审计视图-v0.md（T4 分析 / T5 写作 / T6 批判 / T7 审计 / T9 审稿 / T8 终检 共用轻量摘要，避免各自重读全文）
//   --source <path>：指定审计视图的**正文源**（v2.5.2-dsh.15 新增）。不指定时按 `final/定稿.md` → `drafts/` 最高版本正文 依次回退；
//                    两者都没有时**仍生成视图**（素材/报告阶段视图，供 T4 与 Phase 2.5 前闸门复用）。视图头记录源路径与阶段，防把草稿快照当定稿用。
//   --deep-summary：在 --summary 基础上，把每个素材卡的标题/作者/年份/信任级别列入 `审计视图-v0.md` 的「素材卡全集」段（T7 复核一次看完全部素材，不用 grep 跳文件）
//   审计视图含：定稿章节结构 + 字数 + 素材卡数量 + 信任级别分布 + M 门状态（从 final/M-Gate-Report.json 读取，
//   兼容 audits/ 旧路径；报告由 `m-gate-check.mjs --report <path>` 落盘 —— v2.5.2-dsh.13 修复路径契约）
//
// v18.2.6 审计修复（第三方审计 v18.2.5 B-2「对『不是项目』的目录判成功」P0，fail-open）：
//   旧版只校验「路径存在且是目录」，**从不校验是不是项目**，缺失源一律记「跳过(不存在)」后 exit 0 ——
//   传任意空目录（甚至仓库目录）都会打印「证据包生成完成：复制 0 个文件，跳过 14 个缺失源」并**在该目录内新建**
//   `final/证据包/` 与 `audits/审计视图-v0.md`。后果不是「没干活」，而是**闸门留痕可伪造**：本包的核心纪律是
//   「闸门必须留机械证据（脚本 exit code + 产物路径）」，路径敲错却能拿到漂亮的 exit 0 报告，主控会把「证据包已刷新」
//   写进闸门记录，而 M 门随后校验的其实是**旧副本**（与 m-gate-check.mjs:57 当年修掉的「路径错撞 1」同类）。
//   现两道硬约束：① 参数目录必须命中**项目形态标记**（01-任务简报.md / final/ / drafts/ 之一，Phase 0 起必然存在其一），
//   否则 exit 10；② 收完后 `copied === 0 && missing > 0`（一个源都没找到）→ 列出缺失源 + exit 10。
//   且形态校验**排在任何 mkdir/复制之前**——报错路径上不落一个字节（旧版正好相反：先在参数目录里建目录再报错）。
//   ③ 参数解析同步收紧（B-4 同族，纳入本轮授权）：未知旗标（`--sumary` / `--sorce` 拼错）、带值旗标缺值
//      （`--source` / `--project` 后面没值）、多余位置参数 → 打印用法 + **exit 10**。旧版这三类全部**静默忽略**：
//      用户以为「只出了摘要」实际拿到全量、以为指定了正文源实际用了默认源。实现与 apply-diff 共用
//      `_lib/cli-args.mjs`（唯一实现；守卫写在调用处一定会漂）。
//
//   ⚠️ 与既有回归用例的冲突（如实声明）：`tests/scripts.test.mjs` 有 3 个用例用「只有 drafts/ 或只有 final/定稿.md
//   的骨架目录」调用本脚本并断言 exit 0（第 290/310/529 行附近）；按上述 ② 这类骨架必然 exit 10。夹具属测试所有者，
//   本批未改（授权范围外），需同步给骨架补一个源文件（如 01-任务简报.md 或 final/证据包/数据卡.md）。
import { readdirSync, copyFileSync, existsSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { countHan } from './_lib/han.mjs';                        // 汉字口径真源
import { refCardPairRegex, refRegexFirst, refsOf } from './_lib/refs.mjs';   // 引用编号口径真源
import { TRUST_COMPLIANT_RE } from './_lib/trust.mjs';            // 信任级别口径真源
import { figurePlaceholders, figureNoOf } from './_lib/svg.mjs';  // 图位/图号口径真源（v2.5.2-dsh.16）
import { installExitGuard, requireExistingFile, requireExistingDir } from './_lib/exit-guard.mjs'; // 退出码硬化（v18.0.5）
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs';   // 参数解析唯一实现（v18.2.6，与 apply-diff 共用）
installExitGuard();   // fs 类异常 → 10（旧版传目录给 --source 会未捕获 EISDIR → exit 1）

// v18.2.6 审计修复（追加项 2 / P2，UTF-8 BOM）：pwsh `Set-Content -Encoding UTF8` **默认写 BOM**（Windows 上常见输入），
//   而 `\uFEFF` 顶在文件首行/首个 JSON 字符前 —— 实测两处静默失真：
//     ① `/^#\s+/`、`/^##\s+/` 不匹配 `\uFEFF# 标题` → **审计视图丢一级标题**（消费者据此判结构，等于看错稿子）；
//     ② `JSON.parse('\uFEFF{…}')` 直接抛错 → M 门状态段整段降级成「报告解析失败」（真实原因却指向 JSON 语法）。
//   故本脚本读任何 .md / .json 文本一律走 readText()：剥 BOM + 一条可见提示；**不改退出码**（BOM 是编码卫生问题，
//   不是内容失败——口径与 count-chars.mjs 的既有 BOM 处理一致：提示 + 继续）。
const bomNoted = new Set();   // 同一文件只提示一次（素材卡会被 cntCards/trustDist/parseCard 多次读，不去重会刷屏）
const readText = (p, base = process.cwd()) => {
  const raw = readFileSync(p, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) {
    if (!bomNoted.has(p)) {
      bomNoted.add(p);
      console.error(`⚠️ ${relative(base, p) || p}: 含 UTF-8 BOM（机检硬格式要求无 BOM），已剥离首字符后继续（不改退出码）`);
    }
    return raw.slice(1);
  }
  return raw;
};

const USAGE = '用法: node build-evidence-bundle.mjs <run/项目名> [--project <名>] [--source <正文路径>] [--summary] [--deep-summary]';
// v18.2.6 审计修复（B-4 同族，纳入本轮授权）：旧版用 `args.includes('--summary')` + `args.indexOf('--source')` 的
//   宽松解析——拼错的 `--sumary` / `--sorce` 被**静默忽略**：用户以为「只出了摘要」，实际拿到全量；以为指定了
//   正文源，实际用了默认源（`final/定稿.md` → `drafts/` 最高版本）——这正是本包反复记录的「静默降级」形态。
//   现改为与 apply-diff **共用同一份解析器** `_lib/cli-args.mjs`（守卫写在调用处一定会漂，故抽成唯一实现）；
//   未知旗标 / 缺值 / 多余位置参数一律打印用法 + exit 10（`--project` 缺值过去同样被静默接受，一并收敛）。
const usageExit = (why) => { console.error(why); console.error(USAGE); process.exit(10); };
let flags, opts, positionals;
try {
  ({ flags, opts, positionals } = parseArgs(process.argv.slice(2), {
    flags: ['--summary', '--deep-summary'],
    values: { '--project': 'run/甲醛白菜事件', '--source': 'drafts/初稿-v2.md' },
    minPositionals: 0,   // 项目名可由位置参数给出，也可由 --project 给出（二者缺一 → 下方路径校验报 10）
    maxPositionals: 1,
    positionalHint: '<run/项目名>',
  }));
} catch (e) {
  if (e && e.code === USAGE_CODE) usageExit(e.message);
  throw e;   // 其他异常交 installExitGuard 归类（fs 类 10 / 内部 70）
}
const wantDeepSummary = flags.has('--deep-summary');
// --deep-summary 蕴含 --summary（旧版单独用是静默空操作，v2.5.2-dsh.13 修复）
const wantSummary = flags.has('--summary') || wantDeepSummary;
// --source <path>：显式指定审计视图的正文源（v2.5.2-dsh.15 新增；相对路径按项目目录解析）
const explicitSource = opts['--source'];
// --project <名> 或第一个位置参数（旧版表达式自引用，--project 的值从未被使用）
// v2.5.2-dsh.15：位置参数解析必须排除**旗标的值**，否则 `--source drafts/初稿-v1.md <项目>` 会把源路径当成项目
//   —— v18.2.6 起由 `_lib/cli-args.mjs` 结构性保证（值被旗标消费，不会落进 positionals）。
const project = opts['--project'] || positionals[0];
if (!project || !existsSync(project)) {
  usageExit(`项目目录不存在或未给出: ${project || '(空)'}`); // v18.0.2：参数/路径错统一 10
}
requireExistingDir(project, '项目目录');   // v18.0.5：项目必须是目录（传文件 → 明确 10，而非后续 mkdir 崩溃）

// ===== 项目形态校验（v18.2.6，B-2 ①：fail-open 的根因就是这里从没校验过「是不是项目」）=====
//   判据取「必然早于本脚本运行」的三个标记之一：Phase 0 写 01-任务简报.md → Phase 3 建 drafts/ → Phase 5 建 final/。
//   为什么用「存在其一」而不是列全量产物：本脚本在前中后各阶段都会被调用（--summary 是 T4/T6/T7/T9 的轻量视图源），
//   不能要求 final/ 一定在；但这三者都没有，说明**几乎一定不是论衡项目目录**（路径敲错 / 传了仓库根 / 传了空目录）。
//   为什么必须排在所有 mkdir 之前：旧版报错前已经往参数目录里建了 `final/证据包/` 与 `audits/`——传仓库路径即污染仓库。
const PROJECT_MARKERS = [['01-任务简报.md', 'Phase 0 的任务简报'], ['final', 'final/（定稿/证据包/图件）'], ['drafts', 'drafts/（初稿与修订说明）']];
const hitMarkers = PROJECT_MARKERS.filter(([rel]) => existsSync(join(project, rel)));
if (hitMarkers.length === 0) {
  console.error(`项目形态校验未通过：${project} 不像论衡项目目录（以下标记一个都没有：${PROJECT_MARKERS.map(([rel]) => rel).join(' / ')}）`);
  console.error('→ 退出码 10（参数或路径错误）：请把路径指向 run/<项目名> 的**项目目录**，例如');
  console.error('   node scripts/build-evidence-bundle.mjs run/甲醛白菜事件 --summary');
  console.error('   · 本项目目录在 Phase 0 就会写入 01-任务简报.md；到 Phase 3/5 还会有 drafts/ 与 final/');
  console.error('   · 若这是一个新项目：先在 Phase 0 写 01-任务简报.md，再跑本脚本（此时跑也拿不到任何闸门证据）');
  console.error('   · 为避免污染，本次**未创建任何目录或文件**');
  process.exit(10);
}

// --source 存在性**前置**校验（v2.5.2-dsh.15）：fail fast——否则会先复制完整个证据包才报错
// v18.0.5（第三方审计 P1-1）：同时校验**是文件**——旧版只判存在，传目录会走到 readFileSync 才炸（EISDIR → exit 1）
if (explicitSource) {
  const p0 = existsSync(explicitSource) ? explicitSource : join(project, explicitSource);
  if (!existsSync(p0)) { console.error(`--source 指定的正文源不存在: ${explicitSource}`); process.exit(10); } // v18.0.2：路径错 → 10（fail-fast 时机不变）
  requireExistingFile(p0, '--source 指定的正文源');
}

// 收集规则：源相对路径 → 目标文件名（找不到就跳过并记录）
// 注意：**版本化报告不列在此处**（见下方 LATEST_REPORTS）——旧版把批判/审计/复核/反哺/审稿报告硬编码成 `-v1.md`，
// 而修订轮（v2/v3）报告文件名随之变化 → 那些轮次的报告**不进证据包**，审计视图还会误显示「审计✗/批判✗」。
const RULES = [
  ['literature/文献卡.md', '文献卡.md'],
  ['literature/先行者清单.md', '先行者清单.md'],
  ['data/数据卡.md', '数据卡.md'],
  ['cases/案例卡.md', '案例卡.md'],
  ['analysis/分析大纲.md', '分析大纲.md'],
  ['analysis/素材加载清单.md', '素材加载清单.md'],   // v2.5.2-dsh.17：M-Form-11 的判定依据，须随证据包给 T7/T8 可见
  ['01-任务简报.md', '01-任务简报.md'],
  ['status.md', 'status.md'],
];

// 版本化报告：**取版本号最大**的那一份（v2.5.2-dsh.17：与 M-Gate-Algorithm「N 取最大」同口径；
// 「修订说明」一直用的就是 glob，本处把同类产物一并改成解析——含此前完全没被收录的 G14 检测报告）
const LATEST_REPORTS = [
  ['analysis', '批判报告'],
  ['audits', '审计报告'],
  ['audits', '复核报告'],
  ['audits', '反哺报告'],
  ['audits', '审稿报告'],
  ['audits', 'G14-检测报告'],
];
const latestVersioned = (dir, prefix) => {
  const d = join(project, dir);
  if (!existsSync(d)) return null;
  const cands = readdirSync(d)
    .map((f) => ({ f, m: f.match(new RegExp(`^${prefix}-v(\\d+)\\.md$`)) }))
    .filter((x) => x.m)
    .map((x) => ({ f: x.f, n: Number(x.m[1]) }))
    .sort((a, b) => b.n - a.n || a.f.localeCompare(b.f));
  return cands.length ? { name: cands[0].f, n: cands[0].n } : null;
};

const destDir = join(project, 'final', '证据包');
if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

let copied = 0, missing = 0;
const missingSrcs = [];   // v18.2.6（B-2 ②）：记下**哪些源**缺失，好在报错里点名（旧版只给一个总数）
for (const [rel, name] of RULES) {
  const src = join(project, rel);
  if (existsSync(src)) {
    copyFileSync(src, join(destDir, name));
    copied++;
    console.log(`✓ ${rel} -> 证据包/${name}`);
  } else {
    missing++;
    missingSrcs.push(rel);
    console.log(`· 跳过(不存在): ${rel}`);
  }
}

// 修订说明 *：drafts/ 下所有 修订说明-*.md
const draftsDir = join(project, 'drafts');
if (existsSync(draftsDir)) {
  for (const f of readdirSync(draftsDir)) {
    if (/^修订说明-.*\.md$/.test(f)) {
      copyFileSync(join(draftsDir, f), join(destDir, f));
      copied++;
      console.log(`✓ drafts/${f} -> 证据包/${f}`);
    }
  }
}

// 版本化报告：取最大版本并随包（v2.5.2-dsh.17）——含此前完全没被收录的 G14 检测报告
const reportPicks = {};
for (const [dir, prefix] of LATEST_REPORTS) {
  const hit = latestVersioned(dir, prefix);
  reportPicks[prefix] = hit;
  if (hit) {
    copyFileSync(join(project, dir, hit.name), join(destDir, hit.name));
    copied++;
    console.log(`✓ ${dir}/${hit.name} -> 证据包/${hit.name}（取最大版本 v${hit.n}）`);
  } else {
    missing++;
    missingSrcs.push(`${dir}/${prefix}-vN.md`);
    console.log(`· 跳过(不存在): ${dir}/${prefix}-vN.md`);
  }
}

// 图件：final/图件/ 下所有 .svg → 证据包/图件/（v2.5.2-dsh.16 新增）
// 旧版不收图件 → T7/T8 读审计视图时**看不见图**，M 门也无图项（第三方 SVG 链路审计 findings）
const figDir = join(project, 'final', '图件');
let figFiles = [];
if (existsSync(figDir)) {
  const figDest = join(destDir, '图件');
  if (!existsSync(figDest)) mkdirSync(figDest, { recursive: true });
  for (const f of readdirSync(figDir).filter((x) => x.toLowerCase().endsWith('.svg')).sort()) {
    copyFileSync(join(figDir, f), join(figDest, f));
    figFiles.push(f);
    copied++;
    console.log(`✓ final/图件/${f} -> 证据包/图件/${f}`);
  }
}

// v18.2.6（B-2 ②）：**复制 0 个 + 一堆「跳过(不存在)」= 几乎一定路径传错**，不许再报「生成完成」。
//   旧版这一行会把「复制 0 个文件，跳过 14 个缺失源」当成功打印并 exit 0 —— 主控据此把「证据包已刷新」写进闸门记录，
//   而 M 门随后校验的是**旧副本**（闸门留痕被伪造）。形态校验（脚本上方）已挡住「不是项目」，本检查挡住
//   「是项目骨架但源一个都没有」这一残余情形：这时本脚本给不出任何机械证据，就必须以非 0 退出。
if (copied === 0 && missing > 0) {
  console.error(`\n✗ 一个源都没找到：复制 0 个，缺失 ${missing} 个 —— 这几乎一定是**项目路径传错**（或该项目还没有任何素材/报告）`);
  console.error(`  项目目录: ${project}`);
  console.error(`  前几个缺失源: ${missingSrcs.slice(0, 5).join('、')}${missingSrcs.length > 5 ? `（…共 ${missingSrcs.length} 个）` : ''}`);
  console.error(`  （已按需创建 ${destDir} —— 可能为空目录；本脚本不删已建目录）`);
  console.error('→ 退出码 10（参数或路径错误）：请核对路径确实指向 run/<项目名> 后重跑；不要拿这份 exit 10 当「证据包已刷新」');
  process.exit(10);
}

console.log(`\n证据包生成完成: 复制 ${copied} 个文件, 跳过 ${missing} 个缺失源.`);
console.log(`目录: ${destDir}`);

// ===== 审计视图摘要（v2.5.2-dsh.7 新增，--summary 启用）=====
// v2.5.2-dsh.15 修正（第三方效率审计）：旧版视图源**写死** `final/定稿.md`，而定稿是 Phase 5 才产出——
// 被要求在派发时「先读审计视图」的 T6（Phase 3.6）/T7（Phase 4）/T9（Phase 4.5）都在**定稿之前**运行，
// 因此这条「省 60%+ cacheRead」的优化对除 T8 以外的所有消费者都无法兑现。
// 现改为三级源解析：`--source <path>` ＞ `final/定稿.md` ＞ `drafts/` 中版本号最高的正文（初稿-vN.md）。
// 无正文源时**仍生成视图**（素材/报告阶段视图），供 T4 分析（Phase 2）与 Phase 2.5 前的闸门复用。
if (wantSummary) {
  const resolveSource = () => {
    if (explicitSource) {
      const p = existsSync(explicitSource) ? explicitSource : join(project, explicitSource);
      if (!existsSync(p)) { console.error(`--source 指定的正文源不存在: ${explicitSource}`); process.exit(10); } // v18.0.2：路径错 → 10
      return { path: p, name: basename(p).replace(/\.md$/, ''), kind: /定稿/.test(basename(p)) ? 'final' : 'draft' };
    }
    const fin = join(project, 'final', '定稿.md');
    if (existsSync(fin)) return { path: fin, name: '定稿', kind: 'final' };
    const dd = join(project, 'drafts');
    if (existsSync(dd)) {
      const cands = readdirSync(dd)
        .filter((f) => f.endsWith('.md') && !/^修订说明/.test(f))
        .map((f) => ({ f, n: Number((f.match(/-v(\d+)\.md$/) || [])[1] || 0) }))
        .sort((a, b) => b.n - a.n || a.f.localeCompare(b.f));
      if (cands.length) return { path: join(dd, cands[0].f), name: cands[0].f.replace(/\.md$/, ''), kind: 'draft' };
    }
    return null;
  };
  const src = resolveSource();
  const srcText = src ? readText(src.path, project) : '';
  const srcRel = src ? relative(project, src.path).replaceAll('\\', '/') : '（无正文源）';
  // 阶段标签：让消费者一眼看出本视图是「草稿快照」还是「定稿视图」，避免把草稿字数当定稿字数用
  const stageLabel = !src
    ? '素材阶段（尚无正文：Phase 1-2 素材/报告状态视图）'
    : src.kind === 'final'
      ? 'Phase 5 终检（定稿）'
      : `草稿阶段（${src.name} 快照，Phase 3-4.5 复用；定稿产出后须重新生成）`;
  const han = countHan(srcText);   // 口径真源：_lib/han.mjs（旧版 [一-龥] 少 89 个码位）
  // 章节结构（H1/H2）—— 无正文源时留空，由下方模板给出显式说明（不得伪造成「结构为空」）
  const sections = [];
  for (const line of srcText.split('\n')) {
    const m1 = line.match(/^#\s+(.+)/);
    const m2 = line.match(/^##\s+(.+)/);
    if (m1) sections.push(`# ${m1[1]}`);
    else if (m2) sections.push(`  ## ${m2[1]}`);
  }
  // 素材卡条目数（v2.5.2-dsh.7 用 Set 去重，避免全文中重复 [Lxx] 引用被多次计数）
  const cntCards = (p) => {
    if (!existsSync(join(project, p))) return 0;
    const t = readText(join(project, p), project);   // v18.2.6：剥 BOM（pwsh Set-Content -Encoding UTF8 默认带）
    const ids = new Set();
    const re = refCardPairRegex();   // 口径真源：_lib/refs.mjs（旧版限 2-3 位 → 1 位编号漏计）
    let m;
    while ((m = re.exec(t)) !== null) ids.add(m[1] + m[2]);
    return ids.size;
  };
  // 兼容旧版调用（部分位置仍可能引用 cnt）
  const cnt = cntCards;
  const litN = cnt('literature/文献卡.md');
  const datN = cnt('data/数据卡.md');
  const casN = cnt('cases/案例卡.md');
  // 信任级别分布
  const trustDist = (p) => {
    if (!existsSync(join(project, p))) return null;
    const t = readText(join(project, p), project);   // v18.2.6：剥 BOM
    const a = (t.match(/[Aa] 级|A 级|核心期刊|权威机构/g) || []).length;
    const b = (t.match(/[Bb] 级|B 级|一般期刊/g) || []).length;
    const c = (t.match(/[Cc] 级|C 级|网络来源|媒体报道|二手转引/g) || []).length;
    return { a, b, c };
  };
  const litT = trustDist('literature/文献卡.md');
  const datT = trustDist('data/数据卡.md');
  // M 门状态：真源 = final/M-Gate-Report.json（文档全仓一致口径），兼容 audits/ 旧路径
  const mCandidates = [join(project, 'final', 'M-Gate-Report.json'), join(project, 'audits', 'M-Gate-Report.json'), join(project, 'audits', 'M-Gate-Report-v0.json')];
  const mReportPath = mCandidates.find((p) => existsSync(p));
  let mSummary = '（未找到 M-Gate 报告：先跑 `node scripts/m-gate-check.mjs <final/定稿.md> <final/证据包> --report <项目>/final/M-Gate-Report.json`）';
  if (mReportPath) {
    try {
      const m = JSON.parse(readText(mReportPath, project));   // v18.2.6：BOM 会让 JSON.parse 直接抛错（旧版被报成「解析失败」）
      // v18.0.5（第三方审计 P0-1）：报告里的 `exit` 可能是**已过期的 T8 裁定值**——若正文指纹与裁定不符
      //   （`verdict_stale: true`），必须显式渲染机械值 + 过期标注，否则视图会与同屏的 P0/P1 计数自相矛盾。
      const mech = typeof m.script_exit_raw === 'number' ? m.script_exit_raw : null;
      const exitText = m.verdict_stale === true && mech !== null
        ? `exit: ${mech}（T8 裁定已过期，原裁定 ${m.exit ?? '?'}；须就本版正文重裁）`
        : `exit: ${m.exit ?? '?'}`;
      mSummary = `通过 ${m.pass || 0}/${m.total || 12} | P0: ${m.p0 || 0} | P1: ${m.p1 || 0} | P2: ${m.p2 || 0} | LLM 兜底: ${m.soft || m.llm || 0} | ${exitText}`;
    } catch (e) {
      mSummary = `（M-Gate-Report-v0.json 解析失败: ${e.message}）`;
    }
  }
  // 阶段报告存在性（v2.5.2-dsh.17 重写）：
  //   ① 一律走「取最大版本」解析（旧版写死 -v1.md → 修订轮的报告被误报为 ✗）；
  //   ② 带上实际版本号（`审计报告v2✓`），便于主控/主人一眼确认读的是哪一轮；
  //   ③ 条件项显式标注 N/A（复核报告只在修订轮产出；无修订轮却报 ✗ 是虚假告警，会训练读者忽略整行）。
  const revNotes = existsSync(join(project, 'drafts'))
    ? readdirSync(join(project, 'drafts')).filter((f) => /^修订说明-.*\.md$/.test(f))
    : [];
  const hasRevision = revNotes.length > 0;
  const revNo = (n) => Number((n.match(/-v(\d+)\.md$/) || [])[1] || 0);
  const latestRevNote = revNotes.sort((a, b) => revNo(b) - revNo(a))[0] || null;
  const repLabel = (prefix, { conditional = false } = {}) => {
    const hit = reportPicks[prefix];
    if (conditional && !hasRevision) return `${prefix}: N/A(无修订轮)`;
    return `${prefix}${hit ? `v${hit.n}✓` : '✗'}`;
  };
  const reportsLine = [
    repLabel('批判报告'),
    repLabel('审计报告'),
    repLabel('复核报告', { conditional: true }),
    repLabel('审稿报告'),
    repLabel('G14-检测报告'),
    `修订说明${latestRevNote ? `${latestRevNote.match(/-v(\d+)\.md$/)?.[1] ?? ''}✓` : '✗'}`,
  ].join(' ');

  // 引用闭环扫描（[Lxx]/[Dxx]/[Cxx] 在正文源中的实际使用，去重计数）
  const uniq = (arr) => new Set(arr).size;
  const usedL = uniq(refsOf(srcText, 'L'));
  const usedD = uniq(refsOf(srcText, 'D'));
  const usedC = uniq(refsOf(srcText, 'C'));

  // 图件对账（v2.5.2-dsh.16 新增）：让 T7/T8 只在视图里就能看见「图位 vs 图件」是否齐
  const figNos = figurePlaceholders(srcText);
  const figFileNos = figFiles.map((f) => figureNoOf(f)).filter((n) => n !== null);
  const figMissing = [...figNos].filter((n) => !figFileNos.includes(n));
  const figOrphan = figFileNos.filter((n) => !figNos.has(n));
  const figLine = figNos.size === 0 && figFiles.length === 0
    ? '- N/A：未启用配图（正文无 [图N] 图位，final/图件/ 为空或不存在）'
    : `- 正文 [图N] 图位：${figNos.size} 个${figNos.size ? `（${[...figNos].sort((a, b) => a - b).map((n) => `图${n}`).join('、')}）` : ''} ｜ 图件文件：${figFiles.length} 个${figFiles.length ? `（${figFiles.join('、')}）` : ''}`
      + (figMissing.length ? `\n- ⚠️ **缺图**：${figMissing.map((n) => `图${n}`).join('、')}（正文标了图位但 final/图件/ 无对应文件）` : '')
      + (figOrphan.length ? `\n- ⚠️ **孤儿图件**：${figOrphan.map((n) => `图${n}`).join('、')}（未被正文引用）` : '');

  const summary = `# 审计视图（自动生成，T4/T5/T6/T7/T9/T8 共用）

> **用法**：T4 分析 / T5 写作 / T6 批判 / T7 审计 / T9 审稿 / T8 终检 派发时**先读本视图**，按需跳转全文/数据卡/文献卡/案例卡；不强制重读全部素材——本视图含正文结构、字数、素材卡数量、信任级别分布、M 门 16 项状态、引用闭环、报告存在性。
> **视图源**：\`${srcRel}\`　｜　**阶段**：${stageLabel}　｜　生成时间：${new Date().toISOString()}
> ${src && src.kind === 'draft' ? '⚠️ 源为**草稿快照**：字数/引用闭环仅代表该草稿轮次，**定稿阶段必须重新生成**后引用（`--source final/定稿.md`）。' : src && src.kind === 'final' ? '源为定稿（终态视图）。' : '尚无正文：本视图仅含素材与报告状态，T4 分析（Phase 2）可用；草稿产出后请重新生成本视图。'}

## 一、正文结构（${han} 纯汉字${src ? `，源：${src.name}` : ''}）

${src ? sections.join('\n') : '（无正文源：本视图不含正文结构，见「二、素材卡数量」与「五、阶段报告存在性」）'}

## 二、素材卡数量

| 类型 | 数量 | 信任级别分布（A / B / C） |
|------|------|----------------------------|
| 文献卡 [Lxx] | ${litN} | ${litT ? `${litT.a} / ${litT.b} / ${litT.c}` : '—'} |
| 数据卡 [Dxx] | ${datN} | ${datT ? `${datT.a} / ${datT.b} / ${datT.c}` : '—'} |
| 案例卡 [Cxx] | ${casN} | — |

### 图件对账（v2.5.2-dsh.16，M-Form-9 同口径）

${figLine}

## 三、引用闭环（${src ? `${src.name} 正文` : '正文'}实际引用的不重复编号数）

- 文献 [Lxx]：${usedL} 个
- 数据 [Dxx]：${usedD} 个
- 案例 [Cxx]：${usedC} 个
${src ? '' : '\n> 无正文源：三项均为 0（**不是「无引用」**，是尚未有正文可比对）。'}

## 四、M 门 16 项状态

${mSummary}

## 五、阶段报告存在性（v1 = 最新一轮）

${reportsLine}

## 六、待确认项（阶段：${stageLabel}）

${src && src.kind === 'final' ? `- [ ] 引用闭环：素材卡条数 vs 引用数差异（孤儿、未引用）
- [ ] 字数：定稿 ${han} 汉字 vs 任务简报目标（±2% 软档）
- [ ] 信任级别全填：数据卡每条「信任级别」独立段
- [ ] AI 使用声明：定稿文末 5 节白名单（M-Form-7）
- [ ] 参考文献编号闭环：定稿引用 [Lxx] 必须在参考文献清单${figNos.size || figFiles.length ? `
- [ ] 图件闭环（M-Form-9）：图位 ↔ \`final/图件/图N_标题.svg\` 双向对应 + SVG 良构 + 图上数字有出处` : ''}` : `- [ ] 素材卡数量 vs 任务简报需求（缺角？）
- [ ] 信任级别全填：数据卡每条「信任级别」独立段
- [ ] 阶段报告齐备：批判 / 审计 / 复核 / 审稿（按阶段应有）
- [ ] 信任级别分布异常（A 级占比过高或全 C 级）
- [ ] （定稿阶段项：字数 ±2% / AI 使用声明 5 节 / [Lxx] 编号闭环——待定稿后判定）${figNos.size || figFiles.length ? `
- [ ] 图件闭环（M-Form-9）：图位 ↔ \`final/图件/\` 双向对应（定稿阶段再跑一次）` : ''}`}
`;

  const auditsDir = join(project, 'audits');
  if (!existsSync(auditsDir)) mkdirSync(auditsDir, { recursive: true });
  // 规范路径固定为 `审计视图-v0.md`（角色卡统一只认这一条路径，避免多版本并存导致读错）；源与阶段写在视图头，重新生成即覆盖。
  const summaryPath = join(auditsDir, '审计视图-v0.md');
  writeFileSync(summaryPath, summary, 'utf8');
  console.log(`\n✓ 审计视图: ${summaryPath}`);
  console.log(`  - 视图源: ${srcRel}（${stageLabel}）`);
  console.log(`  - 正文纯汉字: ${han}${src ? '' : '（无正文源）'}`);
  console.log(`  - 素材卡: L${litN} D${datN} C${casN}`);
  console.log(`  - 图件: 图位 ${figNos.size} 个 / 图件文件 ${figFiles.length} 个${figMissing.length ? `（缺图 ${figMissing.map((n) => '图' + n).join(',')}）` : ''}`);
  console.log(`  - 引用闭环: L${usedL} D${usedD} C${usedC}`);
  console.log(`  - 报告: ${reportsLine}`);

  // ===== --deep-summary 附加段（v2.5.2-dsh.7 新增）：素材卡全集标题/作者/年份/信任级别 =====
  if (wantDeepSummary) {
    // 直接从 project/literature|data|cases 读素材卡，提取每条 [Lxx]/[Dxx]/[Cxx] 标题（前 80 字）+ 信任级别 + 关键 URL
    const parseCard = (p, re) => {
      if (!existsSync(p)) return [];
      const t = readText(p, project);   // v18.2.6：剥 BOM（否则首条卡片标题会带上 \uFEFF）
      const cards = [];
      // 按 [Lxx]/[Dxx]/[Cxx] 行分段
      const lines = t.split('\n');
      let cur = null;
      for (const line of lines) {
        const m = line.match(re);
        if (m) {
          if (cur) cards.push(cur);
          cur = { id: m[0], title: line.replace(m[0], '').trim().slice(0, 80), trust: null, source: null };
        } else if (cur) {
          const t2 = line.match(TRUST_COMPLIANT_RE);   // 口径真源：_lib/trust.mjs
          if (t2) cur.trust = t2[1];
          const u = line.match(/DOI[:：]?\s*(10\.\d{4,9}\/[^\s]+)/);
          if (u) cur.source = u[1];
        }
      }
      if (cur) cards.push(cur);
      return cards;
    };
    const Ls = parseCard(join(project, 'literature', '文献卡.md'), refRegexFirst('L'));
    const Ds = parseCard(join(project, 'data', '数据卡.md'), refRegexFirst('D'));
    const Cs = parseCard(join(project, 'cases', '案例卡.md'), refRegexFirst('C'));

    let deepSection = '\n\n---\n\n## 七、素材卡全集（--deep-summary 模式，v2.5.2-dsh.7 新增）\n\n';
    deepSection += `> T4 分析 / T5 修订 / T6 批判 / T7 复核 / T9 审稿 / T8 终检可在此段一次性看完全部素材卡标题 + 信任级别 + DOI，无需跳 `;
    deepSection += `final/证据包/ 逐个 grep。\n\n`;
    if (Ls.length) {
      deepSection += `### 文献卡 [L] 共 ${Ls.length} 条\n`;
      for (const c of Ls.slice(0, 30)) deepSection += `- ${c.id}  ${c.title}${c.trust ? ` ｜ ${c.trust}` : ''}${c.source ? ` ｜ DOI:${c.source}` : ''}\n`;
      if (Ls.length > 30) deepSection += `- ... 另 ${Ls.length - 30} 条省略\n`;
    }
    if (Ds.length) {
      deepSection += `\n### 数据卡 [D] 共 ${Ds.length} 条\n`;
      for (const c of Ds.slice(0, 30)) deepSection += `- ${c.id}  ${c.title}${c.trust ? ` ｜ ${c.trust}` : ''}\n`;
      if (Ds.length > 30) deepSection += `- ... 另 ${Ds.length - 30} 条省略\n`;
    }
    if (Cs.length) {
      deepSection += `\n### 案例卡 [C] 共 ${Cs.length} 条\n`;
      for (const c of Cs.slice(0, 30)) deepSection += `- ${c.id}  ${c.title}${c.trust ? ` ｜ ${c.trust}` : ''}\n`;
      if (Cs.length > 30) deepSection += `- ... 另 ${Cs.length - 30} 条省略\n`;
    }
    if (!Ls.length && !Ds.length && !Cs.length) {
      deepSection += '\n> ⚠️ 未找到素材卡（literature/文献卡.md 或 data/数据卡.md 或 cases/案例卡.md 缺失）\n';
    }

    const deepPath = summaryPath;
    const prev = readFileSync(deepPath, 'utf8');
    writeFileSync(deepPath, prev + deepSection, 'utf8');
    console.log(`  - 素材卡全集（deep）: L${Ls.length} D${Ds.length} C${Cs.length}`);
  }
}
