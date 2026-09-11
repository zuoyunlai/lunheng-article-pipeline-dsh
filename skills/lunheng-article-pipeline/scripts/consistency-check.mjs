// 论衡插件一致性自检脚本（DSH）— 发布/commit 前运行
// 用法：node scripts/consistency-check.mjs
// 覆盖 20 类漂移（v2.5.2-dsh.17 起；.5 为 9 类，.13 加 ⑩-⑭，.15 加 ⑮-⑰，.16 加 ⑱，.17 加 ④b + ⑲）：
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
// 退出码 0 = 通过；1 = 有漂移（列在 stderr）
// (重写用法：node scripts/consistency-check.mjs [--fix]
//   --fix：自动修复可逆的简单漂移（P2 级，如「（检查）」占位符替换）
const fixMode = process.argv.includes('--fix');

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..'); // skills/lunheng-article-pipeline
const REPO_ROOT = join(ROOT, '..', '..'); // lunheng-article-pipeline-dsh

// ① 版本真源 = package.json；版本头行任意 -dsh.N（v2.5.2-dsh.3 修订：不再硬编码 v2.5.2，防 bump 到 v2.6.0 后失效）
const VER_HEADER_RE = /^> 版本：v\d+\.\d+\.\d+-dsh\.\d+（DSH/;
const VER_ANY_RE = /v\d+\.\d+\.\d+-dsh\.\d+/;

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

// 版本号归一化：去掉 v 前缀比较（v2.5.2-dsh.3 == 2.5.2-dsh.3）
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
// 仓库级文档版本头（README.md / docs/introduction.md / skills/README.md 的 `> 版本：` 或「当前版本」）
for (const [rel, p] of [
  ['README.md', join(REPO_ROOT, 'README.md')],
  ['docs/introduction.md', join(REPO_ROOT, 'docs', 'introduction.md')],
  ['skills/README.md', join(ROOT, 'README.md')],
]) {
  if (!existsSync(p)) { errors.push(`[P0 版本一致性] 缺文件 ${rel}`); continue; }
  const t = readFileSync(p, 'utf8');
  const m = t.match(/v?\d+\.\d+\.\d+-dsh\.\d+/);
  if (!m) errors.push(`[P0 版本一致性] ${rel} 无 -dsh.N 版本号`);
  else if (normVer(m[0]) !== normVer(pkgVer)) errors.push(`[P0 版本一致性] ${rel} 写 ${m[0]} ≠ package.json=${pkgVer}（需 bump）`);
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
      errors.push(`[P1 口径残留 M-Form 6 项（应为 8 项）] ${rel}`);
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
    const headerVer = headerLine?.match(/v(\d+\.\d+\.\d+-dsh\.\d+)/)?.[1];
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
for (const f of files) {
  if (isArchive(f)) continue;
  const rel = relative(ROOT, f).replaceAll('\\', '/');
  readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    const m = l.match(/^\s*[-*>#]*\s*版本：v?(\d+\.\d+\.\d+-dsh\.\d+)/);
    if (m && normVer(m[1]) !== normVer(pkgVer)) {
      errors.push(`[P0 版本点位漂移] ${rel}:${i + 1} 写 ${m[1]} ≠ package.json=${pkgVer}`);
    }
    const t2 = l.match(/^#\s+\S.*（v?(\d+\.\d+\.\d+-dsh\.\d+)）/);
    if (t2 && normVer(t2[1]) !== normVer(pkgVer)) {
      errors.push(`[P1 标题内嵌版本漂移] ${rel}:${i + 1} 写 ${t2[1]} ≠ package.json=${pkgVer}`);
    }
  });
}

// ⑬ docs/ 版本点位（v2.5.2-dsh.13 新增）：只查**可执行口径**——
//    ① 安装 pin（`@x.y.z-dsh.N`）；② 「当前版本」声明行。历史章节（版本历史/演进/里程碑等）整体跳过。
const docsDir = join(REPO_ROOT, 'docs');
if (existsSync(docsDir)) {
  for (const f of walk(docsDir)) {
    const rel = 'docs/' + relative(docsDir, f).replaceAll('\\', '/');
    let inHistory = false;
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const h = l.match(/^#{1,4}\s*(.+)/);
      if (h) inHistory = /版本历史|历史|演进|里程碑|升级记录/.test(h[1]);
      if (inHistory) return;
      const pin = l.match(/@(\d+\.\d+\.\d+-dsh\.\d+)/);
      if (pin && normVer(pin[1]) !== normVer(pkgVer)) {
        errors.push(`[P1 docs 安装 pin 漂移] ${rel}:${i + 1} 写 @${pin[1]} ≠ package.json=${pkgVer}`);
      }
      const cur = l.match(/当前版本\s*\*{0,2}v?(\d+\.\d+\.\d+-dsh\.\d+)/);
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
//      而当时的 M 门 14 项**没有任何图项**（现由 M-Form-9 落地）：宣称与实现必须一起改；
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

// ⑧ cordis.patch.yml + examples/ 版本引用（v2.5.2-dsh.5 审计新增：防安装文档指向未发布版本）
const patchPath = join(REPO_ROOT, 'cordis.patch.yml');
if (existsSync(patchPath)) {
  const pt = readFileSync(patchPath, 'utf8');
  const pm = pt.match(/(v?\d+\.\d+\.\d+-dsh\.\d+)/);
  if (pm && normVer(pm[1]) !== normVer(pkgVer)) {
    errors.push(`[P0 版本引用] cordis.patch.yml 头写 ${pm[1]} ≠ package.json=${pkgVer}`);
  }
}
// examples/ 只查**安装 pin**（`@x.y.z-dsh.N`）——版本注解行（「… 起」「更正」「修订」「历史」等）豁免，
// 因为注解天然会提到相邻版本（v2.5.2-dsh.13 起）
const exDir = join(REPO_ROOT, 'examples');
if (existsSync(exDir)) {
  for (const f of walk(exDir)) {
    const rel = 'examples/' + relative(exDir, f).replaceAll('\\', '/');
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/起|之前|新增|修订|教训|历史|更正|及以后/.test(l)) return;
      const pin = l.match(/@(v?\d+\.\d+\.\d+-dsh\.\d+)/);
      if (pin && normVer(pin[1]) !== normVer(pkgVer)) {
        errors.push(`[P0 版本引用] ${rel}:${i + 1} 安装 pin 写 @${pin[1]} ≠ package.json=${pkgVer}`);
      }
    });
  }
}

// ⑨ .dsh 双写同步 + 污染校验（v2.5.2-dsh.5 审计新增：仅当兄弟 .dsh 技能目录存在时生效，CI 无此目录自动跳过）
const dshSkillDir = join(REPO_ROOT, '..', '.dsh', 'skills', 'lunheng-article-pipeline');
if (existsSync(dshSkillDir)) {
  for (const kf of ['SKILL.md', 'scripts/m-gate-check.mjs', 'scripts/count-chars.mjs', 'references/_shared/M-Gate-Algorithm.md']) {
    const repoF = join(ROOT, kf), dshF = join(dshSkillDir, kf);
    if (!existsSync(repoF) || !existsSync(dshF)) {
      errors.push(`[P1 .dsh 同步] 文件缺失 ${kf} repo=${existsSync(repoF) ? '有' : '缺'} .dsh=${existsSync(dshF) ? '有' : '缺'}`);
    } else if (statSync(repoF).size !== statSync(dshF).size) {
      errors.push(`[P1 .dsh 同步] ${kf} 大小漂移 repo=${statSync(repoF).size}B .dsh=${statSync(dshF).size}B`);
    }
  }
  for (const poll of ['package.json', 'cordis.patch.yml', 'docs', 'examples', '.git']) {
    if (existsSync(join(dshSkillDir, poll))) {
      errors.push(`[P1 .dsh 污染] 技能目录含仓库级条目 ${poll}（应只含技能包本体）`);
    }
  }
}

if (errors.length) {
  console.error(`一致性自检未通过，共 ${errors.length} 处：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`一致性自检通过：${files.length} 个 .md 文件 + cordis.patch.yml/examples/.dsh 同步，0 处漂移。`);
