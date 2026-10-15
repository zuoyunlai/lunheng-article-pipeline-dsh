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
//   且形态校验**排在任何 mkdir/复制之前**——**该**错误路径上不落一个字节（旧版正好相反：先在参数目录里建目录再报错）。
//   v18.57.x（审计修订 P2）补正：上面那句只对**形态校验**成立。另一条错误路径（项目骨架合法、但一个源都没有，
//     见下方 `copied === 0 && missing > 0` → exit 10）此前**会**留下一个空的 `final/证据包/`。现改为：
//     若该目录是本次新建且仍为空 → 一并回收；否则保持原样（绝不删既有目录）。
//   ③ 参数解析同步收紧（B-4 同族，纳入本轮授权）：未知旗标（`--sumary` / `--sorce` 拼错）、带值旗标缺值
//      （`--source` / `--project` 后面没值）、多余位置参数 → 打印用法 + **exit 10**。旧版这三类全部**静默忽略**：
//      用户以为「只出了摘要」实际拿到全量、以为指定了正文源实际用了默认源。实现与 apply-diff 共用
//      `_lib/cli-args.mjs`（唯一实现；守卫写在调用处一定会漂）。
//
//   ⚠️ 与既有回归用例的冲突（如实声明）：`tests/scripts/build-evidence-bundle.test.mjs` 有 3 个用例（v18.68.0 拆分归位）用「只有 drafts/ 或只有 final/定稿.md
//   的骨架目录」调用本脚本并断言 exit 0（第 290/310/529 行附近）；按上述 ② 这类骨架必然 exit 10。夹具属测试所有者，
//   本批未改（授权范围外），需同步给骨架补一个源文件（如 01-任务简报.md 或 final/证据包/数据卡.md）。
//
// ── v19.5.0（反哺清单 §5「审计视图派生失真」+ 总表第 6 条「卡片头部手写汇总与逐条真源不一致」）──
//   本视图是 T4/T5/T6/T7/T9/T8 **六个角色共用的入口**，它的三处派生值此前都是「从中间结构推断」，实测三处都
//   与真源对不上（项目 xingbie）：① 字数槽位填**全文**纯汉字（10453），而唯一验收口径是 `count-chars.mjs` 的
//   **正文区**（8394）；② 卡数用全文编号 Set 去重（文献卡 24，把索引段的 `[L00]`/`[L99]` 也算成条目），
//   而卡内索引段声明 22；③ 信任分布逐行只取**首个**档位词 → 同一行并列的双标条目被静默并入单一类
//   （数据卡实测 43 已发布，其中 1 条实为「已发布 + 二手转引」双标）。
//   三条修法同一判据：**派生统计只能从真源逐条读取**——字数走与 `count-chars.mjs` **同一助手函数**
//   （`_lib/han.mjs` + `_lib/sections.mjs`），卡数读卡内**索引段**声明，信任分布读**逐条独立行**；
//   卡头手写汇总行只用于**对账**（不一致即在视图与 stderr 报出），**永不作为数值来源**。
//   另加一条硬约束：字数槽位**只许填 `count-chars.mjs` 自己的出口值**（见 `countViaProductionScript`），
//   本脚本不再本地算汉字 —— 少一处可发散的口径。取不到值（半截文件 / spawn 失败）时**响亮降级**：
//   stderr 点名原因 + 视图槽位留空（**不退回本地重算**，那等于再造第二份实现），退出码不变。
//   边界（如实）：`count-chars.mjs` 是随包同目录脚本，直接 `spawnSync` 调用其 CLI（`--summary`）
//   并解析其 JSON —— 这是「与 count-chars 同一助手函数」的最强形态：**就是它在算**。
import { readdirSync, copyFileSync, existsSync, mkdirSync, statSync, readFileSync, rmdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';   // v19.5.0：调 count-chars.mjs 取正文区字数（同一产线真源）
import { join, basename, relative, resolve, dirname } from 'node:path';
import { parseTargetCandidates } from './_lib/target-chars.mjs';  // 目标字数解析唯一真源（v19.5.0 超限标记）
import { refRegexFirst, refsOf } from './_lib/refs.mjs';   // 引用编号口径真源
//   v19.5.0：`refCardPairRegex` 曾是**死导入**（唯一的用途是 v2.5.2-dsh.7 的「全文编号 Set 去重」卡数统计，
//   那正是本条反哺要消灭的「从中间结构推断」口径）——现卡数走索引段声明，导入随之删除。
import { TRUST_COMPLIANT_RE } from './_lib/trust.mjs';            // 信任级别口径真源
import { figurePlaceholders, figureNoOf, FIGURE_EXT_RE } from './_lib/svg.mjs';  // 图位/图号口径真源（v2.5.2-dsh.16；v19.1.9 位图同权）
import { installExitGuard, requireExistingFile, requireExistingDir } from './_lib/exit-guard.mjs'; // 退出码硬化（v18.0.5）
import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs';   // 参数解析唯一实现（v18.2.6，与 apply-diff 共用）
import { createHash } from 'node:crypto';                       // v18.12.0（L-15）：证据包清单逐文件 sha256
import { writeWithSafety } from './_lib/destructive-write.mjs';  // v18.12.0（L-15）：清单写盘走原子写 + 时间戳 .bak
import { fileURLToPath } from 'node:url';
import { loadGateSource, deriveGateCounts } from './_lib/mgate-gates/gate-count.mjs';  // M 门项数派生真源（v18.78.2 · 全量审计-v18.78.1 A4）
installExitGuard();   // fs 类异常 → 10（旧版传目录给 --source 会未捕获 EISDIR → exit 1）

// M 门项数：**从门标签派生**，不手写（v18.78.2 · 全量审计-v18.78.1 A4 修复）。
//   病灶：本视图的段标题与用法句长期写死「M 门 **16** 项」，而真源 = **25 项**（机检 24 + 人工 1）——
//   视图是 T4–T9 八个角色当**闸门真源**读的产物，自报项数少 9 项即等于让读者按错的门数理解全表；
//   而它不在一致性规则 ⑥b 的扫描面内（⑥b 只扫被跟踪的 `skills/**` 与 `docs/**` 的 `.md`，**生成物不算**），
//   故任何门都不会红。现改为与 ⑥b **同源派生**（共用 `_lib/mgate-gates/gate-count.mjs`）。
//   边界（如实声明）：派生失败（门模块被裁掉 / 目录改名）时降级为 `?` —— **不猜数字**
//   （旧版 `m.total || 12` 的 `12` 就是伪分母：报告里没有这个数，却被当成 100% 信任的比例尺）。
//   ⚠️ **v18.80.0（全量审计-v18.79.1 P3-补 · 实测抓到）**：本块从 A4 落地起就有**一个调用形态错**——
//   `loadGateSource()` 返回的是 `{src, modMissing}` **对象**，而 `deriveGateCounts()` 要的是**源码字符串**；
//   直接传对象会在 `gateSrc.matchAll` 处抛 `TypeError`，随即被**本块的 catch 静默吞掉** → 恒返回 null
//   → `M_GATE_LABEL` 恒为 **`?``**。也就是说 A4 的「派生」在**实跑路径上从未生效过**，只是「不再写死 16」
//   而已（比硬编码好，但仍不是真派生）。而它**没有任何门会红**：生成物不在一致性扫描面内（见上文），
//   而 `?` 又被本块的注释解释成「派生失败的合法降级」——**缺陷伪装成特性**。
//   修法两件：① 取 `.src`；② **catch 不再静默**——把原始错误写进 stderr，让「派生失败」与
//   「调用形态写错」在输出上可分辨（这正是本仓「不静的降级」纪律：降级可以，但要看得见）。
const M_GATE_TOTAL = (() => {
  try {
    const { src } = loadGateSource(dirname(fileURLToPath(import.meta.url)))
    return deriveGateCounts(src).total
  } catch (e) {
    // 降级仍允许（门模块被裁掉/目录改名时确实该降级），但**必须留下可诊断的痕迹**
    console.error(`⚠ M 门项数派生失败，本视图的分母降级为 ? —— 原始错误：${e && e.message ? e.message : String(e)}`)
    return null
  }
})();
const M_GATE_LABEL = M_GATE_TOTAL ?? '?';

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

// ── v19.5.0（§5 ① 的最强形态）：字数槽位**由 `count-chars.mjs` 自己算** ─────────────────────────
//  为什么不是「在本脚本里 import `_lib/han.mjs` + `_lib/sections.mjs` 再算一遍」（本批首版的写法）：
//    那样得到的是**同一套助手、第二份调用代码**——`from`/`to` 的取法与 `count-chars.mjs` 内部的
//    `bodyFrom`/`bodyEndOf` **是两份要各自维护的实现**（正是本仓反复记录的「同一事实两处维护必然发散」）。
//    而本条反哺的病根恰是**口径**（全文 vs 正文区），不是助手本身。故直接跑产线脚本、读它自己的出口 JSON：
//    `--summary` 的 `body.hanChars` 就是验收口径（见 count-chars.mjs 头注与 `_lib/sections.mjs` 的边界公式）。
//  边界（如实）：这是一次**子进程**调用（同目录 `count-chars.mjs`，零新依赖、零网络）。调用失败 /
//    输出取不到 JSON / 缺 `body` 字段时**响亮降级**：stderr 点名原因，槽位留空并标注「取不到（不退回本地重算）」。
//    **刻意不 `process.exit`**：本脚本的退出码契约是 [0, 10, 70]（`scripts/repo-hygiene-check.mjs` ⑧ 登记），
//    而「视图取不到字数」是**证据面降级**、不是参数/路径错 —— 让下游据 stderr 与视图标记处置（与
//    `zeroSrcs` 摘要块同判据：降级可以，但必须看得见）。`LUNHENG_COUNT_CHARS_SCRIPT` 是**测试注入点**
//    （同 `LUNHENG_ALLOW_MECH_EDIT` 的既有形态）：指向另一份脚本以验证「取不到时是否响亮降级」。
const COUNT_CHARS_SCRIPT = process.env.LUNHENG_COUNT_CHARS_SCRIPT
  || join(dirname(fileURLToPath(import.meta.url)), 'count-chars.mjs');
const countViaProductionScript = (p) => {
  const r = spawnSync(process.execPath, [COUNT_CHARS_SCRIPT, p, '--summary'], {
    encoding: 'utf8',
    timeout: 60000,
    cwd: process.cwd(),
  });
  if (r.error) return { why: `spawn 失败：${r.error.code || r.error.message}` };
  if (r.status !== 0) return { why: `count-chars.mjs exit ${r.status}${(r.stderr || '').trim() ? `（${(r.stderr || '').trim().split('\n')[0].slice(0, 160)}）` : ''}` };
  const i = String(r.stdout || '').indexOf('{');
  if (i < 0) return { why: 'count-chars.mjs 未输出 JSON' };
  let j;
  try { j = JSON.parse(String(r.stdout).slice(i)); } catch (e) { return { why: `count-chars.mjs 输出解析失败：${e.message}` } }
  if (!j || typeof j.body?.hanChars !== 'number' || typeof j.total?.hanChars !== 'number') {
    return { why: 'count-chars.mjs 输出缺 body.hanChars / total.hanChars 字段' };
  }
  return { body: j.body.hanChars, full: j.total.hanChars, scope: j.body.scope || '摘要后~文末节前' };
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
// v18.12.0（全量审计 L-13）：**项目目录名合法性**（零新调用——本脚本自 Phase 2 起就会跑）。
//   为什么要这条：`SKILL.md` 规定项目名须匹配 `[\w\-一-鿿]{1,32}`（禁路径分隔 / `..` / 绝对路径），
//   但那条规则**只在提示词层面**、无任何脚本校验。实测本机 `run/` 下已出现一个**乱码空目录**
//   `绛涢€夌珵璧涚殑鍧囪　`（= `筛选竞赛的均衡` 被按 GBK 误码创建），与正常目录并存且无人发现。
//   判据只查**目录基名**（不查绝对路径——否则中文盘符/用户名会误报），命中即 exit 10 并给出可操作提示。
const projBase = basename(resolve(project));
if (!/^[\w\-一-鿿]{1,32}$/u.test(projBase)) {
  console.error(`项目目录名不合规：${projBase}`);
  console.error('→ 退出码 10（参数或路径错误）：项目名须匹配 /^[\\w\\-一-鿿]{1,32}$/（禁路径分隔符、`..`、空格与不可见字符）');
  console.error('   · 若目录名是**乱码**（如 `绛涢€夌珵璧涚殑鍧囪　`），说明创建时编码错误——请用正确名字重建目录');
  console.error('   · 规则出处：SKILL.md §执行前安全须知（本脚本是它的机械落点，v18.12.0 起）');
  process.exit(10);
}
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
  // v18.64.0（反哺报告-v5 §v5.3-1 的 C1-b 半）：**负知识账本**——外审要看的正是「哪些主张被证伪过」。
  //   它存在就随包走（进 manifest，受 M-Exist-2 复算）；**不存在时跳过并计入「缺失源」是正常的**
  //   （语义 = 本项目确实无已证伪项；契约见 `references/_shared/负知识账本.md` §七 空状态）。
  // v18.2.6 → 2026-10-09（检索审计反哺 R1）：**共享来源索引**——溯源三字段（tool/engine/query）的
  //   唯一载体，不进证据包则 T7/M 门在审计输入层面查不到「某条来源用哪个档取的」（A19/A20 断链）。
  //   与 disproofs.jsonl 同语义：存在就随包走；**无检索阶段的项目缺失属正常**（计入「缺失源」不算错）。
  ['sources.json', 'sources.json'],
  ['audits/disproofs.jsonl', 'disproofs.jsonl'],
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
  const esc = String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');   // v18.2.9：prefix 转义，含元字符的前缀不再静默失配
  const cands = readdirSync(d)
    .map((f) => ({ f, m: f.match(new RegExp(`^${esc}-v(\\d+)\\.md$`)) }))
    .filter((x) => x.m)
    .map((x) => ({ f: x.f, n: Number(x.m[1]) }))
    .sort((a, b) => b.n - a.n || a.f.localeCompare(b.f));
  return cands.length ? { name: cands[0].f, n: cands[0].n } : null;
};

const destDir = join(project, 'final', '证据包');
// v18.57.x（审计修订 P2）：记下**本次是否由我们创建**——只有「自己建的 + 仍为空」才允许在错误路径上回收。
//   边界说明（如实）：上方形态校验的失败路径**确实**一个字节都不落（校验排在 mkdir 之前）；
//   而「项目骨架合法、但一个源都没有」这条路径**会**先建出 destDir 再报错（下方 exit 10）。
//   旧版把这两种错误路径混为一谈地承诺「报错即不落字节」，故这里既清理、也把注释改准。
const destDirCreated = !existsSync(destDir);
if (destDirCreated) mkdirSync(destDir, { recursive: true });
/** 错误路径回收：仅当目录是本脚本本次创建、且此刻为空（我们自己没往里放过东西）。
 *  用 `rmdirSync`（不是 `rmSync`）——后者删目录需要 `recursive: true`，传 false 会抛 EISDIR 被吞掉。 */
const removeDestDirIfSelfMadeEmpty = () => {
  if (!destDirCreated) return false;
  try {
    if (readdirSync(destDir).length === 0) { rmdirSync(destDir); return true; }
  } catch { /* 删不掉不算错误：目录留着即可，不掩盖真实退出码 */ }
  return false;
};

let copied = 0, missing = 0;
const missingSrcs = [];   // v18.2.6（B-2 ②）：记下**哪些源**缺失，好在报错里点名（旧版只给一个总数）
// ── v18.48.0（反哺 F-R）：**0 字节源守卫 + 拷贝后大小校验** ──
// 实测事实：某项目的 `final/证据包/修订说明-v2.md` = **0 B**，而源 `drafts/修订说明-v2.md` 完好（31 307 B），
//   且 `manifest.json` 的 mtime 停在旧时点。**成因 = 拷贝时撞上写手正在写该源文件**——`copyFileSync` 不是
//   原子的，读到半截（甚至尚未写入）就落下一份 0 B 副本；而 manifest 照**该副本**的 sha256 记账 →
//   下游 **M-Exist-2「清单复算通过」内部自洽，反而证明不了一份坏副本是坏的**（"证据包"最不该有的失效形态）。
// **判据：凡"复制并记账"的动作，必须先证明源非空、再证明副本与源等大；否则宁可报缺失。**
const zeroSrcs = [];        // 被拒绝的 0 字节源（多为并发写入窗口）
const sizeMismatch = [];    // 拷贝后大小与源不符（磁盘满 / 中断 / 并发截断）
const copyChecked = (src, dest, rel) => {
  let srcSize;
  try { srcSize = statSync(src).size } catch { sizeMismatch.push(`${rel}（源不可 stat）`); return false }
  if (srcSize === 0) { zeroSrcs.push(rel); console.log(`⛔ 拒绝复制 0 字节源（文件可能正在被写入）: ${rel}`); return false }
  copyFileSync(src, dest);
  let destSize = -1;
  try { destSize = statSync(dest).size } catch { /* 落到下方统一判 */ }
  if (destSize !== srcSize) {
    sizeMismatch.push(`${rel}（源 ${srcSize} B ≠ 副本 ${destSize} B）`);
    console.log(`⛔ 副本大小与源不符: ${rel}（源 ${srcSize} B / 副本 ${destSize} B）`);
    return false;
  }
  return true;
};
for (const [rel, name] of RULES) {
  const src = join(project, rel);
  if (!existsSync(src)) {
    missing++;
    missingSrcs.push(rel);
    console.log(`· 跳过(不存在): ${rel}`);
  } else if (copyChecked(src, join(destDir, name), rel)) {
    copied++;
    console.log(`✓ ${rel} -> 证据包/${name}`);
  } else {
    missing++;
    missingSrcs.push(rel);   // 0 字节 / 大小不符：计入缺失（原因已在上方 ⛔ 行点名）
  }
}

// 修订说明 *：drafts/ 下所有 修订说明-*.md——2026-10-09（检索审计第三批）：版本化说明只随包**最新 2 版**
//   （最新 = 审计对象，次新 = 差异对照），更旧的留在 drafts/ 原地不丢、manifest 不记账。
//   实测：某项目 v1–v5 全量入包 ≈94 KB（单份最高 23.6 KB）——证据包应随「证据」而非「全史」。
//   非版本化命名（无 vN 段）的说明不受此限，全部随包。
const REVNOTE_KEEP = 2;
const draftsDir = join(project, 'drafts');
if (existsSync(draftsDir)) {
  const revs = readdirSync(draftsDir)
    .filter((f) => /^修订说明-.*\.md$/.test(f))
    .map((f) => ({ f, m: f.match(/^修订说明-.*v(\d+)\.md$/) }))
    .map((x) => ({ f: x.f, n: x.m ? Number(x.m[1]) : null }))
    .sort((a, b) => (b.n ?? -1) - (a.n ?? -1) || a.f.localeCompare(b.f));
  let versionedSeen = 0;
  for (const { f, n } of revs) {
    if (n !== null && ++versionedSeen > REVNOTE_KEEP) {
      console.log(`ℹ 跳过旧版修订说明（留 drafts/ 原地，不入 manifest）: drafts/${f}`);
      continue;
    }
    if (copyChecked(join(draftsDir, f), join(destDir, f), `drafts/${f}`)) {
      copied++;
      console.log(`✓ drafts/${f} -> 证据包/${f}`);
    } else {
      missing++;
      missingSrcs.push(`drafts/${f}`);   // v18.48.0（F-R）：0 字节 / 大小不符也计缺失
    }
  }
}

// 版本化报告：取最大版本并随包（v2.5.2-dsh.17）——含此前完全没被收录的 G14 检测报告
const reportPicks = {};
for (const [dir, prefix] of LATEST_REPORTS) {
  const hit = latestVersioned(dir, prefix);
  reportPicks[prefix] = hit;
  if (hit && copyChecked(join(project, dir, hit.name), join(destDir, hit.name), `${dir}/${hit.name}`)) {
    copied++;
    console.log(`✓ ${dir}/${hit.name} -> 证据包/${hit.name}（取最大版本 v${hit.n}）`);
  } else if (!hit) {
    missing++;
    missingSrcs.push(`${dir}/${prefix}-vN.md`);
    console.log(`· 跳过(不存在): ${dir}/${prefix}-vN.md`);
  } else {
    missing++;
    missingSrcs.push(`${dir}/${hit.name}`);   // v18.48.0（F-R）：副本不合格也计缺失
  }
}

// 图件：final/图件/ 下所有 .svg → 证据包/图件/（v2.5.2-dsh.16 新增）
// 旧版不收图件 → T7/T8 读审计视图时**看不见图**，M 门也无图项（第三方 SVG 链路审计 findings）
const figDir = join(project, 'final', '图件');
let figFiles = [];
if (existsSync(figDir)) {
  const figDest = join(destDir, '图件');
  if (!existsSync(figDest)) mkdirSync(figDest, { recursive: true });
  // v19.1.9：**位图与 SVG 同权**——旧实现只收 `.svg`，于是 Pillow 直出 PNG 的图件**从不进证据包**，
  //   T7/T8 评审在审计视图里「看不见图」，M-Form-9 又判「缺图」：同一条事实两处都错。
  for (const f of readdirSync(figDir).filter((x) => FIGURE_EXT_RE.test(x)).sort()) {
    if (copyChecked(join(figDir, f), join(figDest, f), `final/图件/${f}`)) {
      figFiles.push(f);
      copied++;
      console.log(`✓ final/图件/${f} -> 证据包/图件/${f}`);
    } else {
      missing++;
      missingSrcs.push(`final/图件/${f}`);   // v18.48.0（F-R）：0 字节 SVG / 大小不符也计缺失
    }
  }
}

// v18.2.6（B-2 ②）：**复制 0 个 + 一堆「跳过(不存在)」= 几乎一定路径传错**，不许再报「生成完成」。
//   旧版这一行会把「复制 0 个文件，跳过 14 个缺失源」当成功打印并 exit 0 —— 主控据此把「证据包已刷新」写进闸门记录，
//   而 M 门随后校验的是**旧副本**（闸门留痕被伪造）。形态校验（脚本上方）已挡住「不是项目」，本检查挡住
//   「是项目骨架但源一个都没有」这一残余情形：这时本脚本给不出任何机械证据，就必须以非 0 退出。
if (copied === 0 && missing > 0) {
  const reclaimed = removeDestDirIfSelfMadeEmpty();
  console.error(`\n✗ 一个源都没找到：复制 0 个，缺失 ${missing} 个 —— 这几乎一定是**项目路径传错**（或该项目还没有任何素材/报告）`);
  console.error(`  项目目录: ${project}`);
  console.error(`  前几个缺失源: ${missingSrcs.slice(0, 5).join('、')}${missingSrcs.length > 5 ? `（…共 ${missingSrcs.length} 个）` : ''}`);
  console.error(reclaimed
    ? `  （本次未创建任何产物：${destDir} 系本次新建且为空，已一并回收）`
    : `  （${destDir} 未由本次创建或已含内容，保持原样——本脚本不删既有目录）`);
  console.error('→ 退出码 10（参数或路径错误）：请核对路径确实指向 run/<项目名> 后重跑；不要拿这份 exit 10 当「证据包已刷新」');
  process.exit(10);
}

// ===== 证据包清单（v18.12.0，全量审计 L-15）=====
// 为什么需要它（审计实测事实）：证据包此前是**内容全公开的目录**——任何人都能往 `final/证据包/` 丢一份
// 文件（或覆盖其中一份），而**没有任何门会注意到**：M-Exist-2 只数「有几个 .md、有没有 0 字节」，
// M-Exist-7 的「证据包指纹」只核「占位符出现了没有」。于是「T8 拿到的证据包」与「T8 以为的证据包」
// 可以不是同一份，且事后无从分辨。
// 清单的作用是把「这一包是哪些字节」变成**可复算的断言**：本脚本产出时逐文件记 sha256 + 字节数，
// M-Exist-2 复核时重算比对 → 被替换/截断/塞入的文件会以 P0 暴露，并在 detail 里点名。
// ⚠️ 精度边界（如实）：本清单**不设防「同时改文件与改清单」**（能写目录的人也能写这段 JSON）——
//   它防的是**静默**：任何不一致都会留下可见痕迹，且与 M 门的正文指纹互锁（L-47）叠加后，
//   伪造需要同时改动三处互相矛盾的地方。它不是签名的替代品。
const MANIFEST_NAME = 'manifest.json';
{
  const entries = [];
  const addDir = (relBase) => {
    const dir = relBase ? join(destDir, relBase) : destDir;
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir).sort()) {
      if (f === MANIFEST_NAME) continue;
      // ── v18.60.1（主人授权反哺 v2 §1.3）：**跳过 `.bak` 备份产物** ──
      //   为什么：`manifest.json` 走 `writeWithSafety`（原子写 + 时间戳 `.bak`），备份落在**同目录**；
      //   而 `pruneBackups`（真源 = `_lib/destructive-write.mjs` 的 `BAK_MAX`；**本处不复述数值**
      //   ——该常量曾被三处注释复述成同一旧值，2026-10-15 审计 P2-2 收口）会**回收最旧的 `.bak`**——旧版把
      //   `.bak` 一并登记为清单成员，于是「回收 → 登记的成员已不存在」→ M-Exist-2 **必然**判复算失败 P0
      //   （实测：论衡实测项目-夫妻收入差异家庭权力 的证据包累积 21 个 `.bak`，复算报「登记的文件已不在包里」）。
      //   判据：`.bak` 是脚本自身的回滚点，**不是交付成员**——不应进入清单，也不应影响复算。
      if (f.endsWith('.bak')) continue;
      const full = join(dir, f);
      let st;
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) { addDir(relBase ? `${relBase}/${f}` : f); continue }
      entries.push({
        path: relBase ? `${relBase}/${f}` : f,
        bytes: st.size,
        sha256: createHash('sha256').update(readFileSync(full)).digest('hex'),
      });
    }
  };
  addDir('');
  // 被审正文（定稿优先，回退 drafts 最高版）——供 M-Exist-2 判定「这份包是不是配这一版正文生成的」
  const auditTarget = existsSync(join(project, 'final', '定稿.md'))
    ? 'final/定稿.md'
    : (() => {
        const hit = latestVersioned('drafts', '初稿');
        return hit ? `drafts/${hit.name}` : null;
      })();
  const manifest = {
    schema: 'lunheng-evidence-bundle/1',
    generatedAt: new Date().toISOString(),
    project: basename(resolve(project)),
    auditTarget,
    auditTargetSha256: auditTarget && existsSync(join(project, auditTarget))
      ? createHash('sha256').update(readFileSync(join(project, auditTarget))).digest('hex')
      : null,
    copied,
    missing,
    missingSrcs,
    // v18.48.0（反哺 F-R）：把「被拒绝的源」变成**可复算的断言**——只要这两项非空，
    //   本包就不是一份完整证据包；下游（T8/主人）必须看得见，而不是靠一份 0 字节副本自证清白。
    ...(zeroSrcs.length ? { zeroByteSrcs: zeroSrcs } : {}),
    ...(sizeMismatch.length ? { sizeMismatch } : {}),
    files: entries,
  };
  // v19.6.1（审计 2026-10-15 全量批 P2-4）：**原地重写，源即目标，故不设 `source`**——`writeWithSafety`
  //   的 `source` 槽位是「本次运行读过的**源文件**路径」（给出即启用同文件守卫）；清单本身既是输入
  //   又是输出，`inPlace: true` 已显式声明覆盖意图，故不传 `source`（传了反而要 `inPlace` 让路）。
  writeWithSafety(join(destDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n', { inPlace: true });
  console.log(`✓ 证据包清单 -> ${join('证据包', MANIFEST_NAME)}（${entries.length} 个文件记 sha256；M-Exist-2 据此复算）`);
}

// ── v18.48.0（反哺 F-R）：被拒绝源的**显式摘要** ──
// 为什么**不改退出码**：本脚本的退出码语义已被下游（`final-check.mjs` 的串联、闸门记录、T8 流程）依赖，
//   改变它属于**接口变更**，超出"补一个守卫"的范围。可见性由「⛔ 摘要块 + manifest 两个字段」提供，
//   **判定**留给门（M-Exist-2 数 0 字节文件）与人。若同时出现多个被拒源，几乎一定是**并发写入窗口**——
//   正确动作是**等写手停笔后重跑本脚本**，而不是带着半份包往下走。
if (zeroSrcs.length || sizeMismatch.length) {
  console.error(`\n⛔ 证据包**不完整**：拒绝 ${zeroSrcs.length} 个 0 字节源、${sizeMismatch.length} 个大小不符源`);
  for (const z of zeroSrcs) console.error(`   · 0 字节（可能正在被写入）: ${z}`);
  for (const m of sizeMismatch) console.error(`   · 大小不符: ${m}`);
  console.error('   → **不要**拿这份包继续走 T8；等源文件写完（或写手 settle）后**重跑本脚本**。');
  console.error('   → 已写入 manifest.json 的 `zeroByteSrcs` / `sizeMismatch` 字段，供机械复核。');
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
  // ── v19.5.0（§5 ①）：字数槽位 = **正文区口径**，由 count-chars.mjs 自己算 ─────────────────────
  //   口径真源 = `count-chars.mjs` 的 `--summary` 出口：`body.hanChars`（正文区 = `## 摘要` 之后 →
  //   首个文末节之前；不含题名与文末节汉字），`total.hanChars` 只作**对照展示**、**不填槽位**。
  //   旧版槽位填的是 `countHan(全文)`（本项目实测 10453 vs 正文区 8394）。
  //   取不到时：响亮降级（stderr + 视图标注），槽位留空 —— **不退回本地重算**（那会再造一份实现）。
  const hanProbe = src ? countViaProductionScript(src.path) : null;
  if (src && !hanProbe) {
    console.error(`\n✗ 取不到正文区字数：本视图的字数槽位将留空（**不退回本地重算**——那等于再造第二份口径实现）。`);
    console.error('  原因见上方 count-chars.mjs 的报错；修复后重新生成本视图即可。');
  }
  if (hanProbe && !hanProbe.why) {
    // 调用处断言（本包纪律：断言写在调用处、不在助手内部静默 fallback）：
    //   ① 正文区 > 全文 ⇒ 违反「正文区 ⊆ 全文」，说明口径/切片已被破坏 → 报出；
    //   ② 正文区 === 全文 ⇒ 切片没有真正收窄 = **口径坍缩**：槽位里的数字成了「全文」在冒充「正文区」，
    //      正是本条反哺（§5 ①：10453 填进了本该是 8394 的槽位）要消灭的失真形态。
    //   ② 的**分级**（v19.5.0 批 24 收敛，与主人交付的硬要求对齐）：
    //     · **确有文末节**时相等 ⇒ 一定是错的（正文区必然 < 全文）→ 「⛔ 口径自检失败」；
    //     · **本稿确实没有文末节**（## 摘要 到文件末就是全部正文；草稿早期很常见）⇒ 相等是**合法**的，
    //       只给「ℹ 提示」——否则每一份尚未写文末节的草稿都会被判成口径失真，门会立刻被训练成噪声。
    //   两条都**只报不改退出码**（本脚本退出码契约 = [0, 10, 70]，见 `scripts/repo-hygiene-check.mjs` ⑧；
    //   而「视图字数口径可疑」是**证据面降级**，不是参数/路径错）：证据面问题的正确处置是让下游**看见**
    //   （stderr + 视图内显著行），不是让刷新视图这个动作本身失败 —— 后者会把「翻新视图」变成不可执行的动作，
    //   反而逼出不刷新视图的旁路（本仓「降级必须可观察、但不要用退出码替人做决定」的既有口径）。
    const hasEndnote = /^#{2,6}[ \t\u3000]+(参考文献|数据来源|案例来源|先行者文献|AI 使用声明)/m.test(srcText);
    if (hanProbe.body > hanProbe.full) {
      console.error(`⛔ 字数口径自检失败：正文区 ${hanProbe.body} > 全文 ${hanProbe.full}（正文区必须是全文的子集）—— 槽位留空，请查 count-chars.mjs 与 _lib/sections.mjs 的边界解析。`);
    } else if (hanProbe.body === hanProbe.full && hasEndnote) {
      console.error(`⛔ 字数口径自检失败：${srcRel} **有文末节**，正文区却等于全文（${hanProbe.full}）—— 切片没有真正收窄，槽位留空（不得用全文冒充正文区）。`);
    } else if (hanProbe.body === hanProbe.full) {
      console.error(`ℹ ${srcRel} 尚未写文末节，正文区 ≡ 全文（${hanProbe.full}）—— 属合法同值，非口径失真（定稿若缺失五节会另有 M 门报）。`);
    }
  }
  // 目标上限 × 1.2 显著标记（§5 改法末条）：目标取自任务简报，解析器 = `_lib/target-chars.mjs`
  //   （**唯一真源**：`apply-revision-cycle` / `g-audit-check` 也用它，避免在此重写一份正则）。
  //   取**上限**（候选最大值）：简报常同时写「档位下限」与「目标」，上限才是「超限」的判据。
  let targetUpper = null;
  let targetWhy = '无 `01-任务简报.md`（项目未到 Phase 0？）';
  const briefPath = join(project, '01-任务简报.md');
  if (existsSync(briefPath)) {
    const cand = parseTargetCandidates(readText(briefPath, project));
    if (cand.candidates.length) targetUpper = Math.max(...cand.candidates);
    else targetWhy = cand.reason || '简报里没有可解析的目标字数';
  }
  const overshootLimit = targetUpper === null ? null : Math.round(targetUpper * 1.2);
  const overshoot = src !== null && overshootLimit !== null && typeof hanProbe?.body === 'number' && hanProbe.body > overshootLimit;
  // 槽位取值：取不到时**显式写「取不到」**，不写 0（0 会被读成「正文没有汉字」——那是另一回事）
  const hanUnavailable = hanProbe === null ? '（无正文源）'
    : hanProbe.why ? `取不到（${hanProbe.why}）`
      : null;
  const hanBody = hanUnavailable ? hanUnavailable : hanProbe.body;
  const hanFull = hanUnavailable ? hanUnavailable : hanProbe.full;
  // ── 批 24 主人侧硬要求（v19.4.2 收敛，**与另一位工程师的 exit 10 版本冲突，以此为准**）────────────
  //   「取不到时**不得**改退出码；契约 [0,10,70]」（主人派单原文），且本条反哺的「响亮失败」已由
  //   上方 stderr 的 `⛔ 字数口径自检失败` + 视图内说明承担。故此处**刻意不设**「写盘后 process.exit(10)」：
  //   证据面降级不该让「刷新证据包/视图」这个动作本身失败 —— 否则逼出「不刷新视图」的旁路，
  //   而六角色读的正是这份视图（视图照旧产出、槽位照旧如实，问题在 stderr 与视图内可见）。
  //   ⚠️ 与 `tests/batch24-toolface-derivation.test.mjs` 的 `B24-§5-5` 期望（exit 10）**不一致**：
  //   那条用例属另一批，须由主人裁定后改其断言或改回本行 —— 已如实登记在批 24 交割说明里。
  // 章节结构（H1/H2）—— 无正文源时留空，由下方模板给出显式说明（不得伪造成「结构为空」）
  const sections = [];
  for (const line of srcText.split('\n')) {
    const m1 = line.match(/^#\s+(.+)/);
    const m2 = line.match(/^##\s+(.+)/);
    if (m1) sections.push(`# ${m1[1]}`);
    else if (m2) sections.push(`  ## ${m2[1]}`);
  }
  // ── v19.5.0（§5 ②③ + 总表第 6 条）：卡数与信任分布 = **从真源逐条读取**，不从中间结构推断 ──
  //   旧实现两处「从中间结构推断」，实测都与真源对不上（项目 xingbie）：
  //     ① 卡数 = 全文 `[Lxx]` 编号 Set 去重（`refCardPairRegex`）→ 文献卡 **24**（把索引段的特殊索引
  //        `[L00]`/`[L99]`/`[L-cross]` 也当成条目），而卡内**索引段声明 22**；
  //     ② 信任分布 = 逐行 `TRUST_COMPLIANT_RE.exec` 取**首个**档位词 → 同一行并列写
  //        `已发布（…）+ 二手转引（…）` 的**双标条目被静默并入单一类**（数据卡实测 43 已发布，
  //        其中 1 条实为双标）。
  //   现口径（三条，都由本函数实现，视图里同时标出计数来源）：
  //     A. 卡数：索引段「总条数」声明 → 索引段表行编号 → 条目标题行 → 全文编号去重（兜底，口径最弱）；
  //     B. 信任分布：**逐条独立行**（行首标签 `- **信任级别**：` 形态）逐行判定；一行里出现
  //        **两个及以上**档位词（按 `+`/`＋` 分段且每段**以档位词开头**）→ 计入**双标**，不并入任一单类；
  //     C. 卡头手写汇总行（`信任级别声明：已发布 N …`）**只用于对账**：与逐条统计不一致即在视图与
  //        stderr 报出，**数值一律取逐条统计**（判据：手写汇总是中间结构，逐条独立行才是真源）。
  const ALL_IDS_G = '\\[([LDC]\\d+)\\]';
  const ENTRY_HEADING_G = '^\\s*#{2,6}\\s*\\[([LDC]\\d+)\\]';
  /** 取「索引段」节体（标题含「索引段」→ 下一个同级或更高级标题之前）；无该标题返回 null。 */
  const indexSectionLines = (text) => {
    const lines = text.split(/\r?\n/);
    let start = -1;
    let level = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s*(.*)$/);
      if (!m) continue;
      if (start === -1) {
        if (/索引段/.test(m[2])) { start = i; level = m[1].length; }
        continue;
      }
      if (m[1].length <= level) return lines.slice(start, i);
    }
    return start === -1 ? null : lines.slice(start);
  };
  /** 卡数（真源优先：索引段声明）。返回 `{ n, source }`，`source` 会写进视图供人复核口径。 */
  const cardCount = (text) => {
    const idx = indexSectionLines(text);
    if (idx) {
      const joined = idx.join('\n');
      const tot = /总条数\**\s*[:：]\s*\**\s*(\d+)/.exec(joined);
      if (tot) return { n: Number(tot[1]), source: '索引段「总条数」声明' };
      const ids = new Set([...joined.matchAll(new RegExp(ALL_IDS_G, 'g'))].map((m) => m[1]));
      if (ids.size) return { n: ids.size, source: '索引段表行编号' };
    }
    const headIds = new Set([...text.matchAll(new RegExp(ENTRY_HEADING_G, 'gm'))].map((m) => m[1]));
    if (headIds.size) return { n: headIds.size, source: '条目标题行（本卡无索引段）' };
    const anyIds = new Set([...text.matchAll(new RegExp(ALL_IDS_G, 'g'))].map((m) => m[1]));
    return { n: anyIds.size, source: '全文编号去重（兜底：无索引段且无条目标题，口径最弱）' };
  };
  // 逐条独立行：行首标签形态（容忍有/无项目符号、加粗、全/半角冒号——与 M-Form-6 的独立行判据同向）。
  //   刻意**不**匹配行文中段的「信任级别」字样：那正是「描述字段仅有」的降级场景，不构成独立声明行。
  const TRUST_INDEP_LINE_RE = /^\s*(?:[-*+]\s+)?\*{0,2}信任级别\*{0,2}[ \t\u3000]*[:：][ \t\u3000]*(.*)$/;
  /** 该独立行声明的档位词（去重、保序）；`+`/`＋` 分段且**段首**为档位词才算 —— 备注括号里的档位词不算。 */
  const trustTokensOfLine = (tail) => {
    const out = [];
    for (const seg of String(tail).split(/[+＋]/)) {
      const t = /^\*{0,2}[ \t\u3000]*(已发布|主人投喂|二手转引)/.exec(seg.trim());
      if (t) out.push(t[1]);
    }
    return [...new Set(out)];
  };
  /** 卡头手写汇总行（`- **信任级别声明**：已发布 39 / 主人投喂 0 / 二手转引 17`）→ `{已发布:39,…}`。 */
  const headerTrustSummary = (text) => {
    const line = text.split(/\r?\n/).find((l) => /信任级别声明/.test(l));
    if (!line) return null;
    const out = {};
    for (const m of line.matchAll(/(已发布|主人投喂|二手转引)\s*\**\s*[:：]?\s*(\d+)/g)) out[m[1]] = Number(m[2]);
    return Object.keys(out).length ? out : null;
  };
  /** 单卡统计：`{ count, countSource, dist, dualIds, header, mismatch }`；文件不存在 → null。 */
  const cardStats = (p, kind) => {
    if (!existsSync(join(project, p))) return null;
    const t = readText(join(project, p), project);   // v18.2.6：剥 BOM（pwsh Set-Content -Encoding UTF8 默认带）
    const dist = { 主人投喂: 0, 二手转引: 0, 已发布: 0, 未声明: 0, 双标: 0 };
    const dualIds = [];
    let declaredLines = 0;
    let curId = null;
    for (const line of t.split(/\r?\n/)) {
      const hm = line.match(new RegExp(ENTRY_HEADING_G));
      if (hm) curId = hm[1];
      const m = TRUST_INDEP_LINE_RE.exec(line);
      if (!m) continue;
      declaredLines++;
      const toks = trustTokensOfLine(m[1]);
      if (toks.length === 0) continue;          // 独立行在、但档位词不可识别（如「待定」）→ 只计声明数
      if (toks.length > 1) { dist.双标++; if (curId) dualIds.push(curId); continue; }   // 双标**单列**
      dist[toks[0]]++;
    }
    const { n, source } = cardCount(t);
    dist.未声明 = Math.max(0, n - declaredLines);   // 未声明 = 卡数（真源）− 独立声明行数
    const header = headerTrustSummary(t);
    const mismatch = header === null ? null : ['已发布', '主人投喂', '二手转引'].filter((k) => (header[k] ?? 0) !== dist[k]);
    return { count: n, countSource: source, dist, dualIds, header, mismatch };
  };
  const litS = cardStats('literature/文献卡.md', 'L');
  const datS = cardStats('data/数据卡.md', 'D');
  const casS = cardStats('cases/案例卡.md', 'C');
  const litN = litS ? litS.count : 0;
  const datN = datS ? datS.count : 0;
  const casN = casS ? casS.count : 0;
  /** 视图里的分布单元格：三档 + 未声明（M-Form-6 同口径），**双标单列**；下面再跟计数口径。 */
  const distCell = (s) => (s ? `${s.dist['主人投喂']} / ${s.dist['二手转引']} / ${s.dist['已发布']} / ${s.dist.未声明}` : '—');
  const dualCell = (s) => (s ? `双标 ${s.dist.双标}${s.dualIds.length ? `（${s.dualIds.join('、')}）` : ''}` + ` ｜ 计数口径：${s.countSource}` : '—');
  // 卡头手写汇总与逐条真源不一致 → **报出而不是信手写值**（视图内显著行 + stderr；数值仍取逐条统计）
  const summaryDrift = [
    ['文献卡', 'literature/文献卡.md', litS],
    ['数据卡', 'data/数据卡.md', datS],
    ['案例卡', 'cases/案例卡.md', casS],
  ].filter(([, , s]) => s && s.mismatch && s.mismatch.length > 0);
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
      // v18.78.2（A4）：分母优先取报告自身 `total`；报告缺该字段（旧格式）时用**派生值**兜底，派生也失败才 `?`。
      //   旧版 `m.total || 12` 会在缺字段时凭空写一个 12 —— 审计实测喂一份不含 `total` 的报告即得「通过 20/12」。
      const mDenom = m.total ?? M_GATE_TOTAL ?? '?';
      mSummary = `通过 ${m.pass || 0}/${mDenom} | P0: ${m.p0 || 0} | P1: ${m.p1 || 0} | P2: ${m.p2 || 0} | LLM 兜底: ${m.soft || m.llm || 0} | ${exitText}`;
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

> **用法**：T4 分析 / T5 写作 / T6 批判 / T7 审计 / T9 审稿 / T8 终检 派发时**先读本视图**，按需跳转全文/数据卡/文献卡/案例卡；不强制重读全部素材——本视图含正文结构、字数、素材卡数量、信任级别分布、M 门 ${M_GATE_LABEL} 项状态、引用闭环、报告存在性。
> **视图源**：\`${srcRel}\`　｜　**阶段**：${stageLabel}　｜　生成时间：${new Date().toISOString()}
> ${src && src.kind === 'draft' ? '⚠️ 源为**草稿快照**：字数/引用闭环仅代表该草稿轮次，**定稿阶段必须重新生成**后引用（`--source final/定稿.md`）。' : src && src.kind === 'final' ? '源为定稿（终态视图）。' : '尚无正文：本视图仅含素材与报告状态，T4 分析（Phase 2）可用；草稿产出后请重新生成本视图。'}

## 一、正文结构（正文区 ${hanBody} 纯汉字｜全文 ${hanFull}${src ? `，源：${src.name}` : ''}）

> **口径**：正文区 = \`## 摘要\` 标题之后 → 首个文末节之前，**由 \`count-chars.mjs --summary\` 自己算**
> （本脚本不重算；它的 \`body.hanChars\` 就是验收口径，旧版此处填的是**全文**值）；
> **验收只认正文区值**，全文值仅作对照。${src ? '' : '\n> 无正文源：两值均为「（无正文源）」（**不是「正文为 0」**）。'}${hanProbe && hanProbe.why ? `\n> ⛔ **取不到字数**：${hanProbe.why} —— 槽位留空且**不退回本地重算**（那会再造第二份口径实现）。` : ''}${hanProbe && !hanProbe.why && hanProbe.body >= hanProbe.full ? `\n> ⛔ **口径可疑（本槽位不得单独用于验收）**：正文区值 ${hanProbe.body} ≧ 全文值 ${hanProbe.full} —— 切片没有真正收窄（缺 \`## 摘要\` → 起点退化为文件开头；或有文末节时两值竟相等）。请补摘要/文末节后重新生成；**本命令仍以退出码 0 结束**（证据面降级不改退出码，见批 24 交割说明）。` : ''}
${overshoot ? `> ⚠️ **超限（显著标记）**：正文区 ${hanBody} 汉字 > 任务简报目标上限 ${targetUpper} × 1.2 = ${overshootLimit} —— 先精简再谈其它。\n` : ''}${src && overshootLimit === null ? `> （未打超限标记：未解析到任务简报目标上限——${targetWhy}）\n` : ''}
${src ? sections.join('\n') : '（无正文源：本视图不含正文结构，见「二、素材卡数量」与「五、阶段报告存在性」）'}

## 二、素材卡数量

> **计数真源**：数量取卡内**索引段**声明（无索引段才退到条目标题行/全文编号，口径写在末列）；
> 信任级别分布取卡内**逐条独立行**（\`- **信任级别**：…\`），**双标单列**、不并入单类；卡头**手写汇总行只对账、不采信**（v19.5.0）。

| 类型 | 数量 | 信任级别分布（主人投喂 / 二手转引 / 已发布 / 未声明；v18.7.3 与 M-Form-6 同口径） | 双标与计数口径（v19.5.0 派生真源） |
|------|------|----------------------------|----------------------------|
| 文献卡 [Lxx] | ${litN} | ${distCell(litS)} | ${dualCell(litS)} |
| 数据卡 [Dxx] | ${datN} | ${distCell(datS)} | ${dualCell(datS)} |
| 案例卡 [Cxx] | ${casN} | ${distCell(casS)} | ${dualCell(casS)} |
${summaryDrift.length ? `\n> ⚠️ **卡头手写汇总与逐条真源不一致（不采信手写值）**：${summaryDrift.map(([name, rel, s]) => `${name}（\`${rel}\`）卡头写 ${s.mismatch.map((k) => `${k} ${s.header[k] ?? 0}`).join('、')}，逐条独立行统计为 ${s.mismatch.map((k) => `${k} ${s.dist[k]}`).join('、')}`).join('；')}。\n> 卡头汇总行须由逐条独立行**自动统计生成**（禁手写）——角色卡纪律见 \`references/agents/02-数据检索-data-scout.md\`。\n` : ''}

### 图件对账（v2.5.2-dsh.16，M-Form-9 同口径）

${figLine}

## 三、引用闭环（${src ? `${src.name} 正文` : '正文'}实际引用的不重复编号数）

- 文献 [Lxx]：${usedL} 个
- 数据 [Dxx]：${usedD} 个
- 案例 [Cxx]：${usedC} 个
${src ? '' : '\n> 无正文源：三项均为 0（**不是「无引用」**，是尚未有正文可比对）。'}

## 四、M 门 ${M_GATE_LABEL} 项状态

${mSummary}

## 五、阶段报告存在性（v1 = 最新一轮）

${reportsLine}

## 六、待确认项（阶段：${stageLabel}）

${src && src.kind === 'final' ? `- [ ] 引用闭环：素材卡条数 vs 引用数差异（孤儿、未引用）
- [ ] 字数：定稿**正文区** ${hanBody} 汉字（全文 ${hanFull}）vs 任务简报目标（±2% 软档）
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
  // ── v19.6.1（审计 2026-10-15 全量批 P1-3 / P2-5）────────────────────────────────────────────
  //   P1-3：视图是**持久化交付产物**，此前两处都是裸 `writeFileSync`——写入中途被 kill 会留半写文件，
  //     且**无 `.bak` 回滚点**。现一律走 `writeWithSafety`（temp→rename 原子写 + 时间戳 `.bak`）。
  //   P2-5：`--deep-summary` 旧实现是「先全量覆写 → 再 `readFileSync` 读回 → 追加」（**两次非原子写**），
  //     两步之间被 kill 会留下**缺 deep 段的视图**。现把 deep 段拼进同一份文本**一次落盘**，
  //     顺带删掉那次回读。（该形态旧版**幂等性是对的**——因为每次都被前一次全量覆写重置，审计已实跑证伪
  //     「重复追加」；此处只收掉非原子窗口，不改任何输出内容。）
  //   写盘时机：`--deep-summary` 时移到 deep 段之后（它就是同一份文本）；非 deep 时保持原位。
  if (!wantDeepSummary) writeWithSafety(summaryPath, summary, { inPlace: true });
  console.log(`\n✓ 审计视图: ${summaryPath}`);
  console.log(`  - 视图源: ${srcRel}（${stageLabel}）`);
  console.log(`  - 正文区纯汉字: ${hanBody}（全文 ${hanFull}）${src ? '' : '（无正文源）'}`);
  console.log(`  - 素材卡: L${litN} D${datN} C${casN}（取索引段声明；旧版按全文编号去重会多算特殊索引）`);
  console.log(`  - 信任分布: L${distCell(litS)} ｜ D${distCell(datS)} ｜ C${distCell(casS)}（逐条独立行；双标单列）`);
  if (overshoot) console.error(`⚠️ 正文区 ${hanBody} 汉字 > 目标上限 ${targetUpper} × 1.2 = ${overshootLimit}（视图内已打显著标记）`);
  // 卡头手写汇总不一致：**报出**（stderr + 视图内显著行），数值一律取逐条统计
  for (const [name, rel, s] of summaryDrift) {
    console.error(`⚠️ ${name}（${rel}）卡头手写汇总与逐条真源不一致：`
      + `${s.mismatch.map((k) => `${k} 手写 ${s.header[k] ?? 0} ≠ 逐条 ${s.dist[k]}`).join('；')}`
      + ' —— 视图已按**逐条独立行**取值（手写汇总只对账、不采信）');
  }
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
    // 单次落盘（P2-5）：deep 段拼在内存里的 `summary` 之后，不再「读回刚写的文件再追加」——
    //   旧形态的两次非原子写之间被 kill 会留下缺 deep 段的视图。
    writeWithSafety(deepPath, summary + deepSection, { inPlace: true });
    console.log(`  - 素材卡全集（deep）: L${Ls.length} D${Ds.length} C${Cs.length}`);
  }

  // ── 批 24 交割说明（主人侧硬要求：**不得**改退出码）────────────────────────────────────────────
  //   本节原有一处「口径坍缩 → 写盘后 `process.exit(10)`」（另一位工程师的写法）。按主人派单
  //   「取不到时不得改退出码；契约 [0,10,70]」与「响亮失败 = stderr 报出 + 视图内可见」已移除：
  //   视图照旧落盘、槽位照旧如实（`hanProbe.why` 时写「取不到（原因）」），问题在 stderr 与视图内可查。
  //   反向用例见 `tests/batch24-derived-truth-and-gates.test.mjs`（§5① 反向 / 分级·反向）。
}
