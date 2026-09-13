// 论衡插件一致性自检脚本（DSH）— 发布/commit 前运行
// 用法：node scripts/consistency-check.mjs
// 覆盖 21 类主规则 + 4 个子规则（编号规则见下；子规则 = ④b 占位符残留 / ⑥b M 门口径 /
//   ⑩b 脚本计数 / ⑩c 分档映射）——演进：.5 为 9 类，.13 加 ⑩-⑭，.15 加 ⑮-⑰，.16 加 ⑱，
//   .17 加 ④b + ⑲ + ⑳，18.0.2 加 ⑩b，18.0.3 加 ⑩c。**本数字不做机械门**（改规则时手工同步即可）。
//   ① 跨文件版本一致性（package.json ↔ SKILL.md frontmatter ↔ 版本头行 ↔ 仓库级文档）
//   ② 双头版本行 / M-Gate-Report 文件名漂移
//   ③ 悬空引用（版本一致性检查旧名 / scripts/*.mjs 悬空 / 角色卡索引缺失）
//   ④ 裸「（检查）」占位符残留
//   ⑤ 8 分钟硬卡残留 / 硬编码 fallback 链
//   ⑥ 已知口径残留（M-Form 6 项 / M-Gate-Report-v2.2.x / G 项数错标等）
//   ⑦ 全量版本头一致性（防单文件版本头漏 bump）
//   ⑧ cordis.patch.yml + examples/ 版本引用（防安装文档指向未发布版本）
//   ⑨ .dsh 双写同步 + 污染校验（本地，CI 无该目录自动跳过）
//   ⑩ 随包脚本白名单集合一致性（防白名单出现 7/8/9 三种口径）
//   ⑩b 脚本计数全库对账（任何「随包 N 个脚本」断言 == 磁盘真值）
//   ⑩c 分档工具 ↔ 角色映射全库对账（真源 = model-routing.mjs 的 tool→roles）
//   ⑪ CHANGELOG 当前版本段存在性（防 bump 提交漏写 CHANGELOG）
//   ⑫ 版本点位全量扫描（版本头 / 列表项 / 标题内嵌）
//   ⑬ docs/ 版本点位（安装 pin / 「当前版本」声明；历史章节跳过）
//   ⑭ cordis.patch.yml 执行面红线（!!js 只允许 env / baseUrl / 全局 URL 级取值）
//   ⑮ 派发卡行数上限（每卡 ≤12 行——派发 prompt 最小化的 token 契约）
//   ⑯ 审计视图三方一致（pipeline-readme 声称 ↔ 角色卡 ↔ 生成脚本，防「已投入未兑现」）
//   ⑰ 定量节省断言必须有算式/实测出处（防「省 N%」无出处自我繁殖）
//   ⑱ 图件链路口径（图件路径唯一 + 宣称的图件机械门必须存在 + 图位独占一行规范）
//   ④b 占位符残留（「命令已剥离·DSH 用 read 推理」零容忍）
//   ⑲ 交接契约表（每个声明产出的产物须被产出者声明 + 被下游读清单/证据包引用；版本化报告不得写死 -v1.md）
//   ⑳ M 门文档自洽（M-Gate-Algorithm.md 节头括注项数 == 节内 ### 子节数 == 脚本 gate 标签数；子节编号连续）
//   ㉑ 五语 README 结构镜像（切换器行 + 表格行数 + ## 标题数，五份必须一致）
// 退出码 0 = 通过；1 = 有漂移（列在 stderr）
// (重写用法：node scripts/consistency-check.mjs [--fix]
//   --fix：自动修复可逆的简单漂移（P2 级，如「（检查）」占位符替换）
const fixMode = process.argv.includes('--fix');

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installExitGuard } from './_lib/exit-guard.mjs';   // 退出码硬化（v18.0.5）
installExitGuard();
// v18.0.5（第三方审计 P2）：未知参数此前被静默忽略（`--nope` → exit 0「自检通过」），
//   拼错 `--fix` 会静默走**只读模式**（想自动修却没修，且无提示）。现在显式拒绝。
for (const a of process.argv.slice(2)) {
  if (a !== '--fix') {
    console.error(`未知参数: ${a}\n用法: node scripts/consistency-check.mjs [--fix]`);
    process.exit(1);
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..'); // 技能根（两种布局下均正确）
// REPO_ROOT 探测（v18.0.0 修复）：本包有两种部署布局，旧实现**硬编码「向上两级」**，
//   在「技能即包根」布局下会指向错误目录（实测：本机 `.dsh/skills/<name>/` 部署时，
//   REPO_ROOT 解析成 `~/.dsh`，读 `~/.dsh/package.json` → ENOENT 而整个脚本不可用）。
//   ① 仓库布局：`<repo>/package.json` + `<repo>/skills/lunheng-article-pipeline/`（向上两级）
//   ② 技能即包根：`<skillRoot>/package.json`（本机部署；REPO_ROOT = ROOT）
const REPO_ROOT = existsSync(join(ROOT, 'package.json')) ? ROOT : join(ROOT, '..', '..');

// ① 版本真源 = package.json；版本头行任意 semver（v2.5.2-dsh.3 修订：不再硬编码 v2.5.2，防 bump 后失效）
// **版本号形态真源（v17.0.0 起迁移为纯 semver：迭代号进 major，如 17.0.0 / 18.0.0 / 修补 17.0.1）**：
//   ① 必须同时兼容历史形态 `2.5.2-dsh.N`——CHANGELOG 历史段、旧注解、旧安装 pin 里都还有；
//   ② 每段限 `\d{1,3}`，用于**排除 `2026.09.11` 这类日期串**被误当版本号；
//   ③ prerelease 段可选（`-dsh.17` / `-rc.1`），因为方案迁移前后两种都要认。
const SEMVER = String.raw`\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[0-9A-Za-z][0-9A-Za-z.]*)?`;
const VER_HEADER_RE = new RegExp('^> 版本：v' + SEMVER + '（DSH');
const VER_ANY_RE = new RegExp('v' + SEMVER);
// 上游论衡「**规约版本线**」——与 lunheng-article-pipeline 的**包版本**是两条不同的版本线
// （例：`references/pipeline-readme.md` 标题的 v2.2.14 是规约自身的演进号，随规约改而不随发版改）。
// 旧规则靠 `-dsh.N` 后缀天然把两者分开；v17.0.0 起包版本迁移为**纯 semver**，形态上不再可分，
// 故在此**显式登记**规约版本线（**新增该类标题时须登记一行**），仅供规则 ⑫「标题内嵌版本」豁免。
const UPSTREAM_SPEC_VERSIONS = new Set(['2.2.14']);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

const files = walk(ROOT);
// 排除历史归档 / 旧版协议参考文件（v2.5.2-dsh.10 独立性重构后已移出仓库，规则保留兜底）
const isArchive = (f) => f.includes(join('references', '_shared', 'archive'));
const isLegacyProtocol = (f) => f.endsWith('执行韧化协议-v2.1.0.md');
const active = files.filter((f) => !isArchive(f) && !isLegacyProtocol(f));

// M 门口径派生真源（v2.5.2-dsh.16）：规则 ⑥b 的数字全部从 m-gate-check.mjs 的 gate 标签算出，规则自身不会过期
const gateSrc = readFileSync(join(ROOT, 'scripts', 'm-gate-check.mjs'), 'utf8');
const GATE_DERIVED = (() => {
  const grab = (pre) => new Set([...gateSrc.matchAll(new RegExp(`gate:\\s*'(M-${pre}-\\d+)`, 'g'))].map((m) => m[1])).size;
  const form = grab('Form'), exist = grab('Exist'), integ = grab('Integrity');
  return { form, exist, integ, mech: form + exist + integ, total: form + exist + integ + 1 };  // + M-Integrity-2（主控 T7.5 人工门）
})();
// ⑥b 的口径检查（skills/** 与 docs/** 共用；由调用方传 rel 以便定位）
function checkGateCounts(text, rel) {
  const { form, exist, integ, mech, total } = GATE_DERIVED;
  const check = (re, idx, expected, label) => {
    const m = text.match(re);
    if (m && Number(m[idx]) !== expected) {
      errors.push(`[P1 口径残留 M 门${label}] ${rel} 写 ${m[idx]}，脚本派生值应为 ${expected}（M-Form ${form} + M-Exist ${exist} + M-Integrity ${integ}）`);
    }
  };
  check(/M\s*门\s*(\d+)\s*项机械化/, 1, mech, '机械化项数');
  check(/M\s*门\s*(\d+)\s*项(?!机械化)/, 1, total, '总项数');
  check(/M-Form\s*(\d+)\s*项/, 1, form, ' M-Form 项数');
  // 中文括注写法（v2.5.2-dsh.17 加：如「M-Form 形式合规门（10 项）」——旧规则只认紧邻数字，漏检过 T7 速查表）
  //   dsh.17 二次收紧：首版正则要求「项」紧跟右括号，于是「（9 项，含 v2.2.1.2 + …）」这类**带说明的括注
  //   依旧静默漏检**——实测漏掉了 M-Gate-Algorithm.md 的两个节头（M-Form 写 9 项、M-Exist 写 3 项，
  //   现允许「项」后接 [，、；] + 同行任意说明（说明可能很长：实测节头括注达 120+ 字，故不再设长度上限）
  const parenCount = (pre) => new RegExp(`${pre}[^\\n（]{0,18}（(\\d+)\\s*项(?:[，、；][^）\\n]*)?）`);
  check(parenCount('M-Form'), 1, form, ' M-Form 括注项数');
  check(parenCount('M-Exist'), 1, exist, ' M-Exist 括注项数');
  check(parenCount('M-Integrity'), 1, integ + 1, ' M-Integrity 括注项数');   // + M-Integrity-2（主控 T7.5 人工门，未脚本化）
  // dsh.17 三次收紧：又两种写法此前漏检过（实测 AGENTS.md「M 门 20 项中 14 项已脚本化」与 08 卡「**15 项**：M-Form 1-…」）
  check(/M\s*门\s*(\d+)\s*项中\s*(\d+)\s*项已脚本化/, 1, total, '总项数（「N 项中 M 项已脚本化」写法）');
  check(/M\s*门\s*(\d+)\s*项中\s*(\d+)\s*项已脚本化/, 2, mech, '已脚本化项数');
  check(/\*\*(\d+)\s*项\*\*：M-Form\s*1-/, 1, mech, '机械化项数（「**N 项**：M-Form 1-」写法）');
  check(/M-Form\s*(\d+)\s*\/\s*M-Exist\s*(\d+)\s*\/\s*M-Integrity\s*(\d+)/, 1, form, ' 分工（Form）');
  check(/M-Form\s*(\d+)\s*\/\s*M-Exist\s*(\d+)\s*\/\s*M-Integrity\s*(\d+)/, 2, exist, ' 分工（Exist）');
  check(/M-Form\s*(\d+)\s*项\s*\+\s*M-Exist\s*(\d+)\s*项/, 1, form, ' 分项（Form）');
  check(/M-Form\s*(\d+)\s*项\s*\+\s*M-Exist\s*(\d+)\s*项/, 2, exist, ' 分项（Exist）');
}

// --fix 模式：自动修复可逆的简单漂移（P2 级）
// v2.5.2-dsh.13 修订（第三方审计 P1）：
//   ① 旧版未导入 writeFileSync → 一执行即 ReferenceError（宣传的「一键修复」100% 不可用）；
//   ② 修复范围必须与检查器的**豁免集一致**：检查侧对 SKILL.md / glossary.md 的「（检查）」放行
//      （元文档说明），修复侧若照写就会改写合法内容 —— 因此此处显式跳过同一豁免集；
//   ③ 默认 dry-run：只打印将改动的位置与条数；`--fix --write` 才落盘，且落盘前写 `.bak-fix` 备份。
const FIX_EXEMPT = [/SKILL\.md$/, /glossary\.md$/];
if (fixMode) {
  const applyFix = process.argv.includes('--write');
  let fixFiles = 0, fixHits = 0;
  for (const f of walk(ROOT)) {
    const rel = relative(ROOT, f).replaceAll('\\', '/');
    if (rel.includes('archive')) continue;
    if (FIX_EXEMPT.some((re) => re.test(f))) continue;
    const text = readFileSync(f, 'utf8');
    const hits = text.split('（检查）').length - 1;
    if (hits === 0) continue;
    fixFiles++; fixHits += hits;
    if (applyFix) {
      copyFileSync(f, f + '.bak-fix');
      writeFileSync(f, text.replaceAll('（检查）', '（按主控 phase 0 协议）'), 'utf8');
      console.log(`  ✓ 已修复 ${rel}（${hits} 处，备份 ${rel}.bak-fix）`);
    } else {
      console.log(`  · 将修复 ${rel}（${hits} 处）`);
    }
  }
  console.log(applyFix
    ? `--fix --write 完成：${fixFiles} 个文件 / ${fixHits} 处`
    : `--fix dry-run：${fixFiles} 个文件 / ${fixHits} 处（加 --write 才落盘；SKILL.md / glossary.md 按检查器豁免集跳过）`);
}

const errors = [];

// 版本号归一化：去掉 v 前缀比较（v2.5.2-dsh.3 == 2.5.2-dsh.3；v17.0.0 == 17.0.0）
const normVer = (s) => (s || '').replace(/^v/, '');

// ① 跨文件版本一致性：package.json version 必须等于 SKILL.md frontmatter version + 仓库级文档版本头
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
const pkgVer = pkg.version;
const skillText = readFileSync(join(ROOT, 'SKILL.md'), 'utf8');
const fmVer = skillText.match(/^version:\s*"([^"]+)"/m)?.[1];
if (!fmVer) errors.push('[P0 版本一致性] SKILL.md frontmatter 缺 version 字段');
else if (normVer(fmVer) !== normVer(pkgVer)) errors.push(`[P0 版本一致性] SKILL.md frontmatter version=${fmVer} ≠ package.json=${pkgVer}`);
// SKILL.md 头部版本行（`> 版本：v...`）
const skillHeader = skillText.split('\n').find((l) => VER_HEADER_RE.test(l));
if (skillHeader && !skillHeader.includes(pkgVer)) {
  errors.push(`[P0 版本一致性] SKILL.md 版本头「${skillHeader.trim().slice(0, 30)}…」≠ package.json=${pkgVer}`);
}
// 仓库级文档版本头（v18.0.0：按部署布局分流）
//   ① 仓库布局（ROOT ≠ REPO_ROOT）：README.md / docs/introduction.md / skills/README.md 三处
//   ② 技能即包根（ROOT === REPO_ROOT，本机 `.dsh/skills/<name>/` 部署）：只有一处 README.md
//      ——旧实现硬编码三处，在布局②下 `README.md` 与 `skills/README.md` 指向**同一文件**（重复检查），
//      且 `docs/introduction.md` 根本不存在 → 产生 3 条假 P0，使脚本在本地部署下不可用。
const isRepoLayout = ROOT !== REPO_ROOT;
const repoTargets = isRepoLayout
  ? [
      ['README.md', join(REPO_ROOT, 'README.md')],
      ['docs/introduction.md', join(REPO_ROOT, 'docs', 'introduction.md')],
      ['skills/README.md', join(ROOT, 'README.md')],
    ]
  : [['README.md', join(ROOT, 'README.md')]];
for (const [rel, p] of repoTargets) {
  if (!existsSync(p)) { errors.push(`[P0 版本一致性] 缺文件 ${rel}`); continue; }
  const t = readFileSync(p, 'utf8');
  const m = t.match(new RegExp('v?' + SEMVER));
  if (!m) errors.push(`[P0 版本一致性] ${rel} 无版本号（期望「> 版本：vX.Y.Z」）`);
  else if (normVer(m[0]) !== normVer(pkgVer)) errors.push(`[P0 版本一致性] ${rel} 写 ${m[0]} ≠ package.json=${pkgVer}（需 bump）`);
}

// ①/⑦ 补面（v18.2.4 新增，第三方审计「门必须覆盖它声称覆盖的规范」；主人指令「修」）：
//   **内联发布示例 `git tag vX.Y.Z && git push origin vX.Y.Z` 此前不在任何门里**。
//   它既非 `版本：` 前缀、也非安装 pin，而版本扫描的其余规则全都跑在**技能目录**（`files = walk(ROOT)`）
//   —— 这 7 处却全在仓库根文件（`CONTRIBUTING.md` 2 处 + 5 语 README 各 1 处），故**四条版本规则全都扫不到**。
//   `CONTRIBUTING.md` §版本号约定 早就记了这个漏点，代价是「每次 bump 靠人工记得刷」（截至 v18.2.3 已刷四次）。
//   故在此**与规则①/⑦ 同址**补扫（同属「仓库级文件版本点位」这一件事，不新增规则号 → 门数表述无需连带改）。
//   只认 `git tag` / `git push origin` 两种形态，不碰散文里的历史注记（那些必须允许留旧号）。
const inlineTagTargets = isRepoLayout
  ? [
      ...['README.md', 'README.zh.md', 'README.es.md', 'README.pt.md', 'README.hi.md'].map((f) => [f, join(REPO_ROOT, f)]),
      ['CONTRIBUTING.md', join(REPO_ROOT, 'CONTRIBUTING.md')],
      ['SECURITY.md', join(REPO_ROOT, 'SECURITY.md')],
    ]
  : [];
for (const [rel, p] of inlineTagTargets) {
  // 缺文件不在此报（规则① 与 ㉑ 已各报一次）——此处只负责「文件在、但内联 tag 写旧版」这一件事
  if (!existsSync(p)) continue
  readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
    const m = l.match(new RegExp('git (?:tag|push origin) v?(' + SEMVER + ')'));
    if (m && normVer(m[1]) !== normVer(pkgVer)) {
      errors.push(`[P1 内联 tag 版本漂移] ${rel}:${i + 1} 写 ${m[1]} ≠ package.json=${pkgVer}（每次 bump 必手工刷新此处）`);
    }
  });
}

for (const f of files) {
  const rel = relative(ROOT, f).replaceAll('\\', '/');
  const text = readFileSync(f, 'utf8');

  // ②a 双头版本行（同一文件出现 ≥2 个版本头）
  const verCount = text.split('\n').filter((l) => VER_HEADER_RE.test(l)).length;
  if (verCount > 1) errors.push(`[P0-1d 双头版本行 x${verCount}] ${rel}`);

  // ②b M-Gate-Report 文件名/标识漂移（v2.5.2-dsh.3 审计：门 V 已明令无版本后缀，含 JSON "schema" 字段值）
  if (!isArchive(f) && /M-Gate-Report-v2\.2\.(4|12)(\.json|")/.test(text)) {
    errors.push(`[P1 M-Gate-Report 文件名/标识漂移（应为 M-Gate-Report.json）] ${rel}`);
  }

  // ③a 悬空引用：旧名「版本一致性检查-v2.3.0.md」残留（独立性重构后该旧机制已删除，发现即清理）
  if (text.includes('版本一致性检查-v2.3.0.md')) {
    errors.push(`[P0-1a 悬空引用「版本一致性检查-v2.3.0.md」] ${rel}`);
  }

  // ③b 裸「（检查）」占位符残留（净化剥离未标记；SKILL.md/glossary.md 为元文档说明，豁免）
  if (text.includes('（检查）') && !rel.endsWith('SKILL.md') && !rel.endsWith('glossary.md')) {
    errors.push(`[P2 裸「（检查）」占位符] ${rel}`);
  }

  // ③c scripts/ 引用完整性：文档引用的脚本文件必须存在
  const scriptRefs = [...text.matchAll(/scripts\/([a-z0-9\-]+\.mjs)/g)].map((mm) => mm[1]);
  for (const s of new Set(scriptRefs)) {
    if (!existsSync(join(ROOT, 'scripts', s))) {
      errors.push(`[P1 scripts 悬空引用 scripts/${s}] ${rel}`);
    }
  }

  // ③d 角色卡索引完整性：SKILL.md/README 声称的 10 张卡（00 主控 + 9 独立角色 01-09）必须全部存在
  if (rel === 'README.md') {
    for (const [label, fn] of [
      ['00-主控-coordinator', '00-主控-coordinator.md'],
      ['01-文献检索', '01-文献检索-literature-scout.md'],
      ['02-数据检索', '02-数据检索-data-scout.md'],
      ['03-案例检索', '03-案例检索-case-scout.md'],
      ['04-分析', '04-分析-analyst.md'],
      ['05-写作', '05-写作-writer.md'],
      ['06-批判', '06-批判-critical-companion.md'],
      ['07-审计', '07-审计-auditor.md'],
      ['08-终检', '08-终检-finalizer.md'],
      ['09-审稿', '09-审稿-peer-reviewer.md'],
    ]) {
      if (!existsSync(join(ROOT, 'references', 'agents', fn))) {
        errors.push(`[P1 角色卡缺失 references/agents/${fn}（${label}）] ${rel}`);
      }
    }
  }

  if (active.includes(f)) {
    // ④ 8 分钟硬卡残留（正向断言，不含「无 8 分钟硬卡」免责声明）
    if (/(>8 分钟|超时硬卡 8 分钟|8 分钟内未出产物|静默 >8 分钟)/.test(text)) {
      errors.push(`[P0-1b 8分钟硬卡残留] ${rel}`);
    }
    // ⑤ 硬编码 fallback 链（应抽象为「能力档 + 候选池」）
    if (/claude-opus-5\s*→\s*fallback\s*链/.test(text)) {
      errors.push(`[P0-1c 硬编码 fallback 链] ${rel}`);
    }
    // ⑥ 已知口径残留（v2.5.2-dsh.3 审计新增：防已修问题复发）
    if (/M-Form 形式合规门（6 项）/.test(text) || /M-Form 形式合规门（v2\.2\.0 5 项/.test(text)) {
      errors.push(`[P1 口径残留 M-Form 6 项（现为 10 项）] ${rel}`);
    }
    if (/G0-G14 十四项/.test(text)) {
      errors.push(`[P1 口径残留 G 清单「十四项」（应为 15 项）] ${rel}`);
    }
    // ⑥b M 门项数与分工口径（v2.5.2-dsh.13 新增；v2.5.2-dsh.16 改为**从脚本派生**——写死数字的规则自己也会过期）
    checkGateCounts(text, rel);
    // ⑥c 非 DSH 工具名黑名单（v2.5.2-dsh.13 新增：文档不得把不存在的工具声明为可用）
    //     负向表述（不存在/不得调用/已废止/历史/旧版/误声明/教训）豁免，避免误伤纠错说明
    {
      const BANNED = ['read_page', 'read_url', 'fetch_page', 'gm_search', 'gm_record', 'session-kill'];
      text.split('\n').forEach((l, i) => {
        for (const b of BANNED) {
          if (l.includes(b) && !/不存在|不得调用|已废止|历史|旧版|误声明|教训|残骸/.test(l)) {
            errors.push(`[P1 非 DSH 工具名「${b}」] ${rel}:${i + 1}`);
          }
        }
      });
    }
    // ④b 占位符残留（v2.5.2-dsh.17 新增）：DSH 迁移把 shell 片段扫成「（命令已剥离·DSH 用 read 推理）」后
    //    有 19 处语义被剥空（含交接报告「位置」、errors.md 整张对照表的「友好版」、一条禁令的主语）。
    //    这类残留让规则失去主语、模板失去路径 → 视为 P1 硬问题，禁止再出现。
    if (/命令已剥离/.test(text)) {
      const lines = text.split('\n');
      lines.forEach((l, i) => {
        if (l.includes('命令已剥离')) errors.push(`[P1 占位符残留] ${rel}:${i + 1} 含「命令已剥离」占位符——必须换回有意义的路径/文案（v2.5.2-dsh.17 已全量清理，勿再引入）`);
      });
    }
    // ⑦ 全量版本头一致性（v2.5.2-dsh.5 审计新增：防单个文件版本头漏 bump）
    const headerLine = text.split('\n').find((l) => l.startsWith('> 版本：v'));
    const headerVer = headerLine?.match(new RegExp('v(' + SEMVER + ')'))?.[1];
    if (headerVer && normVer(headerVer) !== normVer(pkgVer)) {
      errors.push(`[P0 版本头漂移] ${rel} 版本头 v${headerVer} ≠ package.json=${pkgVer}`);
    }
  }
}

// ⑩ 随包脚本白名单集合一致性（v2.5.2-dsh.13 新增，教训：白名单曾出现 7/8/9 三种口径）
const diskScripts = readdirSync(join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs')).sort();
const diskNames = diskScripts.map((f) => f.replace(/\.mjs$/, ''));
const wlLine = readFileSync(join(ROOT, 'SKILL.md'), 'utf8').split('\n').find((l) => l.includes('随包脚本白名单')) || '';
// SKILL.md 白名单行的格式：`scripts/*.mjs` = a / b / c + 有限验证命令…
// 只取「纯脚本名」token（`[a-z0-9-]+`）——防止清单里夹带的括注/路径把解析带偏（v2.5.2-dsh.13 加固：
// 曾因注释中出现 `scripts/_lib/*.mjs` 被当成清单分隔符，导致 normalize-trust-level 被误判漏列）
const declaredNames = (wlLine.split('=')[1] || '').split('+')[0].split('/').map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9-]*$/.test(s));
const missingInDoc = diskNames.filter((s) => !declaredNames.includes(s));
const extraInDoc = declaredNames.filter((s) => !diskNames.includes(s));
if (missingInDoc.length > 0) errors.push(`[P1 白名单漏列] SKILL.md 未列：${missingInDoc.join(', ')}（磁盘共 ${diskScripts.length} 个）`);
if (extraInDoc.length > 0) errors.push(`[P1 白名单多列] SKILL.md 列了不存在的脚本：${extraInDoc.join(', ')}`);
const declaredCount = wlLine.match(/白名单（[^）]*?(\d+)\s*个/)?.[1];
if (declaredCount && Number(declaredCount) !== diskScripts.length) {
  errors.push(`[P1 白名单数量不符] SKILL.md 声明 ${declaredCount} 个 ≠ 磁盘 ${diskScripts.length} 个`);
}

// ⑩b 脚本计数全库对账（v18.0.2 新增）
//   教训：白名单行写 11 个（正确），而 glossary 写「随包 9 个」、SKILL.md 另一处写「共 10 个」——
//   规则 ⑩ 只核白名单那一行，另两处长期失真且无门可拦（"多宿主事实"的典型代价）。
//   本规则把「任何对随包脚本数量的断言」都拉进对账：不等于磁盘真值即 P1。
//   CHANGELOG 豁免（历史段记录当时事实，不追溯改写）。
const SCRIPT_COUNT_CLAIMS = [
  /随包\s*\*{0,2}\s*(\d+)\s*个/g,                        // 「随包 **9 个** `scripts/*.mjs`」
  /随包脚本[^\n。]{0,8}?(\d+)\s*个/g,                    // 「随包脚本 10 个」/「随包脚本 \| 11 个」
  /共\s*(\d+)\s*个[^\n。]{0,6}脚本/g,                    // 「共 10 个运行时脚本」
  /(\d+)\s*个\s*\*{0,2}零依赖[^\n]{0,6}\.mjs/g,          // 五语 README「11 个零依赖 .mjs 机械校验脚本」
  /(\d+)\s*个\s*\*{0,2}门禁脚本/g,                       // 「11 个门禁脚本」
];
const claimTargets = [...active, ...(existsSync(REPO_ROOT) ? walk(REPO_ROOT) : [])];
for (const f of claimTargets) {
  if (f.endsWith('CHANGELOG.md')) continue;
  const rel = relative(REPO_ROOT, f).replaceAll('\\', '/');
  readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    for (const re of SCRIPT_COUNT_CLAIMS) {
      for (const m of l.matchAll(re)) {
        if (Number(m[1]) !== diskScripts.length) {
          errors.push(
            `[P1 脚本计数漂移] ${rel}:${i + 1} 写 ${m[1]} 个 ≠ 磁盘 ${diskScripts.length} 个（` +
              `唯一真源 = SKILL.md「随包脚本白名单」行；其余处请改指针或同步数字）`,
          );
        }
      }
    }
  });
}

// ⑩c 分档工具 ↔ 角色映射全库对账（v18.0.3 新增）
//   教训：`subagent_strong` / `subagent_audit` 的角色归属在**11 处副本**里长期分成两种口径——
//   五语 README + docs/installation + docs/usage + 技能 README + `examples/preset/README.md` 把
//   T6 批判 / T9 审稿 列在「强推理档」，而真源 `scripts/model-routing.mjs` 的 `roles` 与
//   `references/_shared/模型路由.md` §二 早已定案 T6/T7/T9/G14 → `subagent_audit`（顶配防漏判档）；
//   规则 ⑩ 只管脚本白名单那一行，分档映射**无门可拦**——多宿主各写一份表，谁也没对账。
//   本规则把真源派生的 `tool → roles` 与每一处断言对账：行内出现**恰好一个**独立工具名
//   （其后不接 `/`，故 `subagent_retrieval/strong/audit` 这类复合写法不算断言）即视为断言，
//   行内其余 `T\d` / `G14` 编号集合必须与真源集合相等。
//   扫描范围（v18.0.5 扩）：markdown **表格行**、`#   - subagent_x: …` 注释行，以及
//   **`.yml` / `.yaml` / `.json` 里任意含单个工具名的行**（第三方审计 P2-1：`examples/preset/preset.yml`
//   就是漏网的那一处——旧版只 walk `.md`）。CHANGELOG 豁免（历史段记录当时事实）。
//   **边界（如实）**：纯散文式表述（只写角色不写工具名，如「分析写作批判审稿 T4-T6+T9」）无法机械判定，
//   不在本规则内——那类只能靠人读；已修的那处已加真源指针防复发。
const TIER_TOOL_RE = /subagent_(retrieval|strong|audit)(?![a-z/])/;
const walkAny = (dir, acc = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === '.git' || name === 'node_modules') continue;
      walkAny(p, acc);
    } else if (/\.(md|ya?ml|json)$/.test(name)) acc.push(p);
  }
  return acc;
};
const tierTruth = new Map();
{
  const routingSrc = readFileSync(join(ROOT, 'scripts', 'model-routing.mjs'), 'utf8');
  for (const m of routingSrc.matchAll(/tool:\s*'(subagent_(?:retrieval|strong|audit))',\s*roles:\s*\[([^\]]*)\]/g)) {
    tierTruth.set(m[1], [...new Set([...m[2].matchAll(/T\d+|G14/g)].map((x) => x[0]))].sort());
  }
  if (tierTruth.size !== 3) {
    errors.push(
      `[P0 分档真源] 无法从 scripts/model-routing.mjs 派生 3 档 tool→roles（实得 ${tierTruth.size} 档）` +
        '——规则 ⑩c 失效即静默放行，故按 P0 报（真源改了写法就同步本规则的正则）',
    );
  }
}
if (tierTruth.size === 3) {
  const scanned = new Set();
  for (const f of [...active, ...(existsSync(REPO_ROOT) ? walkAny(REPO_ROOT) : [])]) {
    if (scanned.has(f) || f.includes('CHANGELOG')) continue;
    scanned.add(f);
    const rel = relative(REPO_ROOT, f).replaceAll('\\', '/');
    const isYaml = /\.(ya?ml|json)$/.test(f);
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      // markdown：只认表格行与 `#   - subagent_x:` 注释行（避免散文误判）
      // yaml/json：任意行只要含工具名即视为断言；**一行多档**时按分隔符切段逐段判定
      //   （v18.0.5：`examples/preset/preset.yml` 的档位描述常把三档写在一行）
      const parts = isYaml
        ? l.split(/[｜|、；;]|\s\/\s/)
        : [l];
      if (!isYaml && !l.trimStart().startsWith('|') && !/^\s*#\s*-\s*subagent_/.test(l)) return;
      if (l.trimStart().startsWith('#')) return;   // yaml 里的注释行不判（说明性文字）
      for (const part of parts) {
        const tools = [...part.matchAll(new RegExp(TIER_TOOL_RE.source, 'g'))].map((m) => m[0]);
        if (tools.length !== 1) continue;
        const tool = tools[0];
        const got = [...new Set([...part.matchAll(/T\d+|G14/g)].map((m) => m[0]))].sort();
        // yaml/json：只有**同时**出现角色编号才视为「映射断言」（`toolName: subagent_retrieval` 这类
        // 单纯引用工具名不算断言——那正是 patch 的行配置，不是角色归属表）
        if (isYaml && got.length === 0) continue;
        const want = tierTruth.get(tool);
        if (got.join('/') !== want.join('/')) {
          errors.push(
            `[P1 分档映射漂移] ${rel}:${i + 1} 「${tool}」行写 ${got.join('/') || '（无角色）'}，` +
              `真源 roles = ${want.join('/')}（真源：scripts/model-routing.mjs + references/_shared/模型路由.md §二）`,
          );
        }
      }
    });
  }
}

// ⑪ CHANGELOG 当前版本段存在性（v2.5.2-dsh.13 新增，教训：dsh.12 的 bump 提交标题声称含 CHANGELOG 实际未写）
const clPath = join(REPO_ROOT, 'CHANGELOG.md');
if (existsSync(clPath)) {
  const cl = readFileSync(clPath, 'utf8');
  const esc = pkgVer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^##\\s+${esc}(\\s|（|$)`, 'm').test(cl)) {
    errors.push(`[P0 CHANGELOG] 缺当前版本段落「## ${pkgVer}」——版本 bump 必须与 CHANGELOG 段同提交`);
  }
}

// ⑫ 版本点位全量扫描（v2.5.2-dsh.13 新增：旧规则 ⑦ 只认 `> 版本：` 开头，漏检 `- 版本：`/标题内嵌等形态）
// v18.2.4 修订（第三方审计「门必须覆盖它声称覆盖的规范」；主人指令「修」）：补一类**实测漏检**。
//   · 漏点 B —— **加粗版版本头 `> **版本**：vX.Y.Z`**：旧正则 `[-*>#]*\s*版本：` 在标记与 `版本：`
//     之间**不允许夹 `**`**，故 `DSH-集成方案.md` / `规范-机械门对照表.md` 两处实际一直是人工刷的、
//     门判不到（人工一疏忽即静默停在旧版本）。修法：把 `**` 纳入可选标记（`\*{0,2}`）。
//   （漏点 A「内联 git tag」在**仓库级文件**里，不在本规则的扫描面内——已补在规则①/⑦ 同址，
//     见上方 `inlineTagTargets`。本注释保留此交叉指引，防后来者以为它在此处。）
for (const f of files) {
  if (isArchive(f)) continue;
  const rel = relative(ROOT, f).replaceAll('\\', '/');
  readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    const m = l.match(new RegExp('^\\s*[-*>#]*\\s*\\*{0,2}版本\\*{0,2}：v?(' + SEMVER + ')'));
    if (m && normVer(m[1]) !== normVer(pkgVer)) {
      errors.push(`[P0 版本点位漂移] ${rel}:${i + 1} 写 ${m[1]} ≠ package.json=${pkgVer}`);
    }
    const t2 = l.match(new RegExp('^#\\s+\\S.*（v?(' + SEMVER + ')）'));
    if (t2 && !UPSTREAM_SPEC_VERSIONS.has(t2[1]) && normVer(t2[1]) !== normVer(pkgVer)) {
      errors.push(`[P1 标题内嵌版本漂移] ${rel}:${i + 1} 写 ${t2[1]} ≠ package.json=${pkgVer}`);
    }
  });
}

// ⑬ docs/ 版本点位（v2.5.2-dsh.13 新增）：只查**可执行口径**——
//    ① 安装 pin（`@x.y.z`，含历史 `@x.y.z-dsh.N`）；② 「当前版本」声明行。历史章节（版本历史/演进/里程碑等）整体跳过。
const docsDir = join(REPO_ROOT, 'docs');
if (existsSync(docsDir)) {
  for (const f of walk(docsDir)) {
    const rel = 'docs/' + relative(docsDir, f).replaceAll('\\', '/');
    let inHistory = false;
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const h = l.match(/^#{1,4}\s*(.+)/);
      if (h) inHistory = /版本历史|历史|演进|里程碑|升级记录/.test(h[1]);
      if (inHistory) return;
      const pin = l.match(new RegExp('@(' + SEMVER + ')'));
      if (pin && normVer(pin[1]) !== normVer(pkgVer)) {
        errors.push(`[P1 docs 安装 pin 漂移] ${rel}:${i + 1} 写 @${pin[1]} ≠ package.json=${pkgVer}`);
      }
      const cur = l.match(new RegExp('当前版本\\s*\\*{0,2}v?(' + SEMVER + ')'));
      if (cur && normVer(cur[1]) !== normVer(pkgVer)) {
        errors.push(`[P1 docs 当前版本声明漂移] ${rel}:${i + 1} 写 ${cur[1]} ≠ package.json=${pkgVer}`);
      }
    });
    // M 门口径同样覆盖 docs（v2.5.2-dsh.16：docs 的计数声明此前不在任何规则覆盖内）
    checkGateCounts(readFileSync(f, 'utf8'), rel);
  }
}

// ⑭ cordis.patch.yml 执行面红线（v2.5.2-dsh.13 新增）：
//    `!!js` 在宿主进程加载期以完整 Node 权限求值，且发生在 agent 沙箱/审批之前 —— 安装即执行。
//    因此补丁内只允许 env / baseUrl / 全局 URL 级取值，禁止模块加载、子进程与任意代码求值。
const redlinePatchPath = join(REPO_ROOT, 'cordis.patch.yml');
if (existsSync(redlinePatchPath)) {
  const pt = readFileSync(redlinePatchPath, 'utf8');
  const FORBIDDEN = ['getBuiltinModule', 'child_process', 'require(', 'import(', 'eval(', 'new Function', 'node:', 'fs.'];
  // 只检查**非注释行**（注释里会正当地列出这些被禁标识符作为说明）
  const codeLines = pt.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  for (const bad of FORBIDDEN) {
    if (codeLines.includes(bad)) {
      errors.push(`[P0 patch 执行面红线] cordis.patch.yml 含被禁标识符「${bad}」——!!js 只允许 process.env / baseUrl / 全局 URL 级取值`);
    }
  }
  const jsCount = (pt.match(/!!js/g) || []).length;
  if (jsCount > 0 && !pt.includes('执行面披露')) {
    errors.push(`[P2 执行面披露] cordis.patch.yml 用了 ${jsCount} 处 !!js，但文件头未做「执行面披露」说明`);
  }
}

// ⑮ 派发卡行数上限机械校验（v2.5.2-dsh.15 新增）：文档自称「每卡 ≤12 行」但此前**无任何脚本校验**——
//    token 优化契约若不可机检，膨胀回潮没人挡（与 ⑩ 白名单同思路）。
const dispatchPath = join(ROOT, 'references', 'dispatch-cards.md');
if (existsSync(dispatchPath)) {
  let cardName = null, cardLines = 0;
  const flushCard = () => {
    if (cardName && cardLines > 12) {
      errors.push(`[P2 派发卡超长] dispatch-cards.md「${cardName}」${cardLines} 行 > 12 行上限（派发 prompt 最小化的 token 契约）`);
    }
  };
  for (const l of readFileSync(dispatchPath, 'utf8').split('\n')) {
    if (/^#{2,4}\s/.test(l)) { flushCard(); cardName = l.replace(/^#+\s*/, '').trim(); cardLines = 0; }
    else if (cardName && l.trim() !== '') cardLines++;
  }
  flushCard();
}

// ⑯ 审计视图三方一致（v2.5.2-dsh.15 新增。教训：pipeline-readme 声称「T4/T5/T6/T7/T9 默认只读审计视图」，
//    但 04/05/06 角色卡根本没写、生成侧脚本又只能在定稿后产出 → 该优化对除 T8 外全部落空，属「已投入未兑现」。
//    文档、卡片、脚本三者必须同时到位，缺一即报。）
const VIEW_CONSUMERS = [
  '00-主控-coordinator.md', '00-主控-扩展职责.md', '04-分析-analyst.md', '05-写作-writer.md',
  '06-批判-critical-companion.md', '07-审计-auditor.md', '08-终检-finalizer.md', '09-审稿-peer-reviewer.md',
];
const pipelinePath = join(ROOT, 'references', 'pipeline-readme.md');
if (existsSync(pipelinePath) && readFileSync(pipelinePath, 'utf8').includes('审计视图')) {
  for (const c of VIEW_CONSUMERS) {
    const p = join(ROOT, 'references', 'agents', c);
    if (!existsSync(p)) { errors.push(`[P1 角色卡缺失] references/agents/${c} 不存在`); continue; }
    if (!readFileSync(p, 'utf8').includes('审计视图')) {
      errors.push(`[P1 审计视图断链] pipeline-readme 声称默认只读审计视图，但角色卡 ${c} 未提及——文档与卡片必须同步`);
    }
  }
  const beSrc = readFileSync(join(ROOT, 'scripts', 'build-evidence-bundle.mjs'), 'utf8');
  if (!beSrc.includes("'--source'")) {
    errors.push('[P1 审计视图断链] build-evidence-bundle.mjs 未实现 --source：视图源写死 final/定稿.md 时，T6/T7/T9 在定稿前无视图可读');
  }
  if (!/drafts/.test(beSrc)) {
    errors.push('[P1 审计视图断链] build-evidence-bundle.mjs 未做草稿回退：定稿前无法生成视图');
  }
}

// ⑰ 定量节省断言必须有出处（v2.5.2-dsh.15 新增）：防「省 60%+」这类**无算式、无实测**的数字在文档间自我繁殖——
//    同行或邻行给出算式（=）、对照（vs）、实测/对比/基线 才放行；否则请补算式或改定性表述。
for (const f of active) {
  const rel = relative(ROOT, f).replaceAll('\\', '/');
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/省(?:略)?\s*\d+(?:\.\d+)?\s*%/);
    if (!m) return;
    const ctx = [lines[i - 1] || '', l, lines[i + 1] || ''].join('\n');
    if (/[=＝]|vs|实测|对比|基线|算式/.test(ctx)) return;
    errors.push(`[P2 定量断言缺出处] ${rel}:${i + 1} 声称「${m[0]}」但同行/邻行无算式或实测出处——请补算式，或改为定性表述`);
  });
}

// ⑱ 图件链路口径（v2.5.2-dsh.16 新增，第三方 SVG 链路审计）：
//   ① 图件路径只有**一个**口径：`final/图件/图N_标题.svg`（旧版 08 卡写 `final/图件/图N_标题.svg`，两套口径并存）；
//   ② 文档宣称的「图件机械门」必须真实存在——T5 卡宣称「T7 跑 M-Gate 检查 [图N] 数量 ≥ 拍板数 → P0 拦截」，
//      而当时的 M 门 16 项**没有任何图项**（现由 M-Form-9 落地）：宣称与实现必须一起改；
//   ③ 图位规范必须写明「独占一行」（md2html 的块级图注/分页依赖它；行内仅在 dsh.16 起被容错识别）。
{
  const mGateSrc = gateSrc;
  const claimsFigGate = active.some((f) => /\[图N\][^\n]{0,40}P0 拦截|P0 拦截[^\n]{0,40}\[图N\]/.test(readFileSync(f, 'utf8')));
  if (claimsFigGate && !mGateSrc.includes('M-Form-9')) {
    errors.push('[P1 图件门断链] 文档宣称「T7 跑 M-Gate 检查 [图N] → P0 拦截」，但 m-gate-check.mjs 未实现 M-Form-9 图件闭环');
  }
  if (!mGateSrc.includes('_lib/svg.mjs')) {
    errors.push('[P1 图件门断链] m-gate-check.mjs 未接入 _lib/svg.mjs（图件结构/安全校验的唯一真源）');
  }
  for (const f of active) {
    const rel = relative(ROOT, f).replaceAll('\\', '/');
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/final[\\/]图N-|final[\\/]图\d+-[^\s`]*\.svg/.test(l) && !/旧版|历史|漂移|教训|错误/.test(l)) {
        errors.push(`[P1 图件路径口径漂移] ${rel}:${i + 1} 用了旧口径 final/图N-*.svg——唯一口径是 final/图件/图N_标题.svg`);
      }
      if (/只标 ?`?\[图N：标题\]/.test(l) && !/独占一行|独立成行/.test(l + '\n' + (lines[i + 1] || ''))) {
        errors.push(`[P2 图位规范缺「独占一行」] ${rel}:${i + 1} 要求写手标 [图N：标题] 但未声明必须独占一行（与 md2html 块级图注/分页契约相关）`);
      }
    });
  }
}

// ⑲ 交接契约表机检（v2.5.2-dsh.17 新增，落地上轮审计的「产出→消费」矩阵）：
//    每个声明产出的产物必须 ① 被产出者声明 ② 被至少一个下游读清单（角色卡/派发卡）或证据包引用。
//    实测教训：审计视图（dsh.15）、批评论据/复核报告（dsh.17）都属于「文档说有人读/有人产，实际断链」。
//    表即契约真源——新增产物时在此登记，与文档同步演进。
//    键用「版本无关的族名」（`初稿-v` / `修订说明` / `审计报告` …）——下游文档天然按族名引用，
//    用精确文件名当键会把正常引用判成断链（本轮实测：4 个假阳性全部来自这一点）。
const CONTRACTS = [
  // [产物匹配子串（族名）, 产出者卡, 可接受的消费者（任一命中即算通过）]
  ['文献卡.md', '01-文献检索-literature-scout.md', ['04-分析-analyst.md', '05-写作-writer.md', 'build-evidence-bundle.mjs']],
  ['先行者清单.md', '01-文献检索-literature-scout.md', ['deliverables.md', '05-写作-writer.md', 'build-evidence-bundle.mjs']],
  ['数据卡.md', '02-数据检索-data-scout.md', ['04-分析-analyst.md', '05-写作-writer.md', 'build-evidence-bundle.mjs']],
  ['案例卡.md', '03-案例检索-case-scout.md', ['04-分析-analyst.md', '05-写作-writer.md', 'build-evidence-bundle.mjs']],
  ['分析大纲.md', '04-分析-analyst.md', ['05-写作-writer.md', 'dispatch-cards.md', 'build-evidence-bundle.mjs']],
  ['写手版精简段', '04-分析-analyst.md', ['05-写作-writer.md', 'dispatch-cards.md']],
  ['初稿-v', '05-写作-writer.md', ['06-批判-critical-companion.md', '07-审计-auditor.md', '09-审稿-peer-reviewer.md']],
  ['修订说明', '05-写作-writer.md', ['07-审计-auditor.md', 'build-evidence-bundle.mjs']],
  ['批判报告', '06-批判-critical-companion.md', ['07-审计-auditor.md', '09-审稿-peer-reviewer.md', 'build-evidence-bundle.mjs']],
  ['审计报告', '07-审计-auditor.md', ['05-写作-writer.md', '09-审稿-peer-reviewer.md', 'build-evidence-bundle.mjs']],
  ['复核报告', '07-审计-auditor.md', ['build-evidence-bundle.mjs']],
  ['反哺报告', '07-审计-auditor.md', ['00-主控-coordinator.md', 'build-evidence-bundle.mjs']],
  ['审稿报告', '09-审稿-peer-reviewer.md', ['build-evidence-bundle.mjs', '08-终检-finalizer.md']],
  ['G14-检测报告', 'checkers/中文AI痕迹-checker.md', ['09-审稿-peer-reviewer.md', 'audit-checklist-quickref.md', 'build-evidence-bundle.mjs']],
  ['定稿.md', '08-终检-finalizer.md', ['build-evidence-bundle.mjs']],
  ['M-Gate-Report.json', '08-终检-finalizer.md', ['build-evidence-bundle.mjs']],
  // 主人侧三件套（v2.5.2-dsh.17）：产出者是主控，消费者是主人/运行手册
  ['进展-主人版', '00-主控-coordinator.md', ['pipeline-readme.md']],
  ['阶段确认-', '00-主控-扩展职责.md', ['pipeline-readme.md']],
  ['主人投喂清单', '00-主控-扩展职责.md', ['数据卡-template.md', 'pipeline-readme.md']],
  ['style-baseline', '00-主控-扩展职责.md', ['05-写作-writer.md', '06-批判-critical-companion.md']],
  ['模型路由表', '00-主控-coordinator.md', ['pipeline-readme.md']],
  // v2.5.2-dsh.17 续（第二批）：素材按需加载留痕 / 闸门记录表 / 交付说明
  ['素材加载清单', '05-写作-writer.md', ['07-审计-auditor.md', '04-分析-analyst.md', 'build-evidence-bundle.mjs']],
  ['闸门记录-', '00-主控-扩展职责.md', ['pipeline-readme.md', '00-主控-coordinator.md']],
  ['交付说明', '08-终检-finalizer.md', ['build-evidence-bundle.mjs', '00-主控-扩展职责.md']],
];
{
  const readLazy = (() => {
    const cache = new Map();
    return (relPath) => {
      if (!cache.has(relPath)) {
        // 解析顺序：references/<path> → references/agents/<path> → references/templates/<path> → scripts/<path>
        // （templates 支持见 v2.5.2-dsh.17：契约表要能引用模板文件，如 数据卡-template.md）
        const cands = [
          join(ROOT, 'references', relPath),
          join(ROOT, 'references', 'agents', relPath),
          join(ROOT, 'references', 'templates', relPath),
          join(ROOT, 'scripts', relPath),
        ];
        const hit = cands.find((p) => existsSync(p));
        cache.set(relPath, hit ? readFileSync(hit, 'utf8') : '');
      }
      return cache.get(relPath);
    };
  })();
  for (const [artifact, producer, consumers] of CONTRACTS) {
    const prodText = readLazy(producer);
    if (!prodText.includes(artifact)) {
      errors.push(`[P1 契约表：产出者未声明] ${artifact} 的登记产出者 ${producer} 未提及该产物——契约表与角色卡必须同步`);
    }
    const hit = consumers.find((c) => readLazy(c).includes(artifact) || readLazy('dispatch-cards.md').includes(artifact));
    if (!hit) {
      errors.push(`[P1 交接断链] ${artifact} 无任何下游读清单/证据包引用（期望消费者之一：${consumers.join(' / ')}）——「文档说有人读、实际读不到」属 P1`);
    }
  }
  // 报告类版本号写法守卫：`批判报告-v{N-1}` / `G14-检测报告-v{N-1}` 是已被定案否定的写法（会查不存在的 v0）
  for (const f of active) {
    const rel = relative(ROOT, f).replaceAll('\\', '/');
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/(?:批判报告|G14-检测报告|审计报告|审稿报告)-v\{N-1\}/.test(l) && !/禁止|旧版|修正|定案|教训|历史/.test(l)) {
        errors.push(`[P1 报告版本号写法] ${rel}:${i + 1} 用 v{N-1}——报告版本号一律 = 被审正文轮次（${'`'}v{N}${'`'}），禁止加减`);
      }
    });
  }
  // 版本化报告不得再写死 -v1.md（旧版把批判/审计/复核/反哺/审稿报告硬编码成 -v1，修订轮报告被漏收）
  const beSrc2 = readLazy('build-evidence-bundle.mjs');
  for (const prefix of ['批判报告', '审计报告', '复核报告', '反哺报告', '审稿报告', 'G14-检测报告']) {
    if (beSrc2.includes(`${prefix}-v1.md`)) {
      errors.push(`[P1 版本硬编码] build-evidence-bundle.mjs 把 ${prefix} 写死成 -v1.md——必须走「取最大版本」解析（修订轮 v2/v3 报告否则不进证据包）`);
    }
  }
}

// ⑳ M-Gate-Algorithm.md 自洽（v2.5.2-dsh.17 新增）
//    教训：M-Form-10 / M-Exist-4 加进文档后，两个节头括注仍写「9 项」「3 项」——⑥b 当时只认
//    「（N 项）」紧邻写法，于是「（N 项，含 …）」被静默放过；文档自身就是 M 门口径真源，
//    它的自洽必须从**文档结构**派生（节头 ↔ 节内 ### 子节 ↔ 脚本 gate 标签），不能再靠文本模式扫。
{
  const gateRel = 'references/_shared/M-Gate-Algorithm.md';
  const gatePath = join(ROOT, gateRel);
  if (!existsSync(gatePath)) {
    errors.push(`[P1 M 门文档缺失] ${gateRel} 不存在——M 门定义真源丢失`);
  } else {
    const lines = readFileSync(gatePath, 'utf8').split('\n');
    const secs = new Map();   // kind → { headerLine, header, declared, subs: [{ id, line, n }] }
    let cur = null;
    lines.forEach((l, i) => {
      const h = l.match(/^## M-(Form|Exist|Integrity)\b/);
      if (h) {
        cur = h[1];   // 短名 Form/Exist/Integrity（节头写作「## M-Form 形式合规门」）
        secs.set(cur, { headerLine: i + 1, header: l, declared: null, subs: [] });
        const d = l.match(/（(\d+)\s*项(?:[，、；][^）]*)?）/);
        if (d) secs.get(cur).declared = Number(d[1]);
        return;
      }
      const s = l.match(/^### (M-(?:Form|Exist|Integrity)-\d+):/);
      if (s && cur && s[1].startsWith(`M-${cur}-`)) {
        secs.get(cur).subs.push({ id: s[1], line: i + 1, n: Number(s[1].split('-')[2]) });
      }
    });
    for (const kind of ['Form', 'Exist', 'Integrity']) {
      const sec = secs.get(kind);
      if (!sec) {
        errors.push(`[P1 M 门文档缺节] ${gateRel} 缺少「## M-${kind}」节`);
        continue;
      }
      const count = sec.subs.length;
      if (sec.declared === null) {
        errors.push(`[P1 M 门节头缺项数] ${gateRel}:${sec.headerLine} 「M-${kind}」节头未写「（N 项）」——项数口径无从派生`);
      } else if (sec.declared !== count) {
        errors.push(`[P1 M 门文档自洽] ${gateRel}:${sec.headerLine} 节头写 ${sec.declared} 项，节内 ### 子节实为 ${count} 项（${sec.subs.map((x) => x.id).join(' / ')}）`);
      }
      const nums = sec.subs.map((x) => x.n);
      const expect = nums.map((_, i) => i + 1);
      if (nums.length && JSON.stringify(nums) !== JSON.stringify(expect)) {
        errors.push(`[P1 M 门编号跳号] ${gateRel} 「M-${kind}」子节编号 ${nums.join(',')} 非 1..${count} 连续（应为 ${expect.join(',')}）`);
      }
      const scriptN = { Form: GATE_DERIVED.form, Exist: GATE_DERIVED.exist, Integrity: GATE_DERIVED.integ + 1 }[kind];
      if (count !== scriptN) {
        errors.push(`[P1 M 门文档↔脚本不一致] ${gateRel} 「M-${kind}」定义 ${count} 项，脚本侧实为 ${scriptN} 项（M-Integrity 含主控人工门 M-Integrity-2，故 = 脚本标签数 + 1）——加项/删项必须两边同步`);
      }
    }
  }
}

// ⑧ cordis.patch.yml + examples/ 版本引用（v2.5.2-dsh.5 审计新增：防安装文档指向未发布版本）
const patchPath = join(REPO_ROOT, 'cordis.patch.yml');
if (existsSync(patchPath)) {
  const pt = readFileSync(patchPath, 'utf8');
  const pm = pt.match(new RegExp('(v?' + SEMVER + ')'));
  if (pm && normVer(pm[1]) !== normVer(pkgVer)) {
    errors.push(`[P0 版本引用] cordis.patch.yml 头写 ${pm[1]} ≠ package.json=${pkgVer}`);
  }
}
// examples/ 只查**安装 pin**（`@x.y.z`，含历史 `@x.y.z-dsh.N`）——版本注解行（「… 起」「更正」「修订」「历史」等）豁免，
// 因为注解天然会提到相邻版本（v2.5.2-dsh.13 起）
const exDir = join(REPO_ROOT, 'examples');
if (existsSync(exDir)) {
  for (const f of walk(exDir)) {
    const rel = 'examples/' + relative(exDir, f).replaceAll('\\', '/');
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/起|之前|新增|修订|教训|历史|更正|及以后/.test(l)) return;
      const pin = l.match(new RegExp('@(v?' + SEMVER + ')'));
      if (pin && normVer(pin[1]) !== normVer(pkgVer)) {
        errors.push(`[P0 版本引用] ${rel}:${i + 1} 安装 pin 写 @${pin[1]} ≠ package.json=${pkgVer}`);
      }
    });
  }
}

// ⑨ .dsh 双写同步 + 污染校验（v2.5.2-dsh.5 审计新增：仅当兄弟 .dsh 技能目录存在时生效，CI 无此目录自动跳过）
// v18.2.3 修订（主人授权；依据「版本抬升 18.2.2 → 18.2.3」后的实测复核）：
//   旧实现有**两处盲区**——① 只核 **4 个文件**（SKILL.md / m-gate-check / count-chars / M-Gate-Algorithm），
//   其余 80 个文件从未被核；② 比对**只比字节大小**（`statSync().size`）。
//   ⚠️ 而**版本头替换天生是等长的**（`v18.2.2` → `v18.2.3` 同长度）→ size 完全不变 → **看不见**。
//   实测后果：镜像里 **44 个文件**内容与真源不同（连 `SKILL.md` 的版本头都还是 v18.2.2），
//   本门却输出「0 处漂移」= **假绿**——而镜像正是**运行时真正被加载**的那一份，
//   于是「版本自检」会拿旧版本放行。**门比被它守的东西更不可靠**。
//   现改为：**全树逐文件内容比对**（Buffer.equals，不用 size 作代理），并补「镜像多出文件」检查。
//   代价：84 个小文件各读两次（合计 <1 MB），运行时开销可忽略。
const dshSkillDir = join(REPO_ROOT, '..', '.dsh', 'skills', 'lunheng-article-pipeline');
const allFilesOf = (dir, base = dir, acc = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) allFilesOf(p, base, acc);
    else if (e.isFile()) acc.push(String(p).slice(base.length + 1).replaceAll('\\', '/'));
  }
  return acc;
};
if (existsSync(dshSkillDir)) {
  const repoFiles = allFilesOf(ROOT).slice().sort();
  for (const kf of repoFiles) {
    const repoF = join(ROOT, kf), dshF = join(dshSkillDir, kf);
    if (!existsSync(dshF)) {
      errors.push(`[P1 .dsh 同步] 镜像缺文件 ${kf}（真源有、镜像无 → 运行时少这一份）`);
    } else if (!readFileSync(repoF).equals(readFileSync(dshF))) {
      errors.push(`[P1 .dsh 同步] ${kf} 内容漂移 repo=${statSync(repoF).size}B .dsh=${statSync(dshF).size}B（v18.2.3 起按内容比对：size 相同亦照报）`);
    }
  }
  for (const kf of allFilesOf(dshSkillDir).slice().sort()) {
    if (!repoFiles.includes(kf)) {
      errors.push(`[P1 .dsh 同步] 镜像多出文件 ${kf}（真源无 → 残留或误加）`);
    }
  }
  for (const poll of ['package.json', 'cordis.patch.yml', 'docs', 'examples', '.git']) {
    if (existsSync(join(dshSkillDir, poll))) {
      errors.push(`[P1 .dsh 污染] 技能目录含仓库级条目 ${poll}（应只含技能包本体）`);
    }
  }
}

// ㉑ 五语 README 结构镜像（v18.0.5 新增，第三方审计 P2-7）
//   背景：官方 `readme-consistency` 只比对 `##` 标题字符串——反事实实测：整份 es 换成英文副本仍 PASS；
//   删整节正文、把「11 scripts」改成 99、把版本改成 v9.9.9 也全 PASS。实测过的真实后果是
//   es/pt/hi 三份**掉了语言切换器**、`### Documentation` 的 9 行表被压成一行散文（表行 33 vs 44）。
//   本规则把「结构镜像」的**可机械判定部分**纳入：
//     ① 五份都必须含 `🌐` 语言切换器行；
//     ② 五份的**表格行数**必须相等（官方 i18n 文档：结构须镜像——表行列数 / 列表项数）；
//     ③ 五份的 `##` 标题数必须相等（官方门已覆盖字符串层面，这里再钉数量，防「删掉一节还 PASS」）。
//   边界（如实）：无法判定**译文语义**是否与中文版一致（那需要人读或 LLM 复核），故只钉结构。
const fiveLangs = ['README.md', 'README.zh.md', 'README.es.md', 'README.pt.md', 'README.hi.md'];
const langStats = [];
for (const f of fiveLangs) {
  const p = join(REPO_ROOT, f);
  if (!existsSync(p)) { errors.push(`[P1 五语 README] 缺 ${f}`); continue; }
  const t = readFileSync(p, 'utf8');
  const lines = t.split('\n');
  langStats.push({
    f,
    switcher: /🌐/.test(t),
    rows: lines.filter((l) => l.startsWith('|')).length,
    h2: lines.filter((l) => /^## /.test(l)).length,
  });
}
if (langStats.length > 1) {
  for (const s of langStats) {
    if (!s.switcher) errors.push(`[P1 五语 README] ${s.f} 缺语言切换器行（\`> 🌐 …\`）——非中文用户找不到其它语言版本`);
  }
  const rowSet = new Set(langStats.map((s) => s.rows));
  if (rowSet.size > 1) {
    errors.push(
      `[P1 五语 README] 表格行数不一致：${langStats.map((s) => `${s.f}=${s.rows}`).join(' / ')}` +
        '——官方 i18n 规范要求结构镜像（表行列数一致），行数差异说明某语言漏了整张表',
    );
  }
  const h2Set = new Set(langStats.map((s) => s.h2));
  if (h2Set.size > 1) {
    errors.push(`[P1 五语 README] \`##\` 标题数不一致：${langStats.map((s) => `${s.f}=${s.h2}`).join(' / ')}——某语言可能整节缺失`);
  }
}

if (errors.length) {
  console.error(`一致性自检未通过，共 ${errors.length} 处：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`一致性自检通过：${files.length} 个 .md 文件 + cordis.patch.yml/examples/.dsh 同步，0 处漂移。`);
