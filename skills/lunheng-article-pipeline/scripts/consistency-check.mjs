// 论衡插件一致性自检脚本（DSH）— 发布/commit 前运行
// 用法：node scripts/consistency-check.mjs
// 覆盖九类漂移（v2.5.2-dsh.5 审计扩为「9 类」；.3 起为 6 类）：
//   ① 跨文件版本一致性（package.json ↔ SKILL.md frontmatter ↔ 版本头行 ↔ 仓库级文档）
//   ② 双头版本行 / M-Gate-Report 文件名漂移
//   ③ 悬空引用（版本一致性检查旧名 / scripts/*.mjs 悬空 / 角色卡索引缺失）
//   ④ 裸「（检查）」占位符残留
//   ⑤ 8 分钟硬卡残留 / 硬编码 fallback 链
//   ⑥ 已知口径残留（M-Form 6 项 / M-Gate-Report-v2.2.x / G 项数错标等）
//   ⑦ 全量版本头一致性（防单文件版本头漏 bump）
//   ⑧ cordis.patch.yml + examples/ 版本引用（防安装文档指向未发布版本）
//   ⑨ .dsh 双写同步 + 污染校验（本地，CI 无该目录自动跳过）
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
    // ⑥b M 门项数与分工口径（v2.5.2-dsh.13 新增：脚本实测 12 项机械化，总 13 项含 M-Integrity-2 人工）
    if (/M 门 ?13 ?项机械化|13 门（M-Form 1-8 \+ M-Exist 1-3 \+ M-Integrity-1）/.test(text)) {
      errors.push(`[P1 口径残留 M 门项数/分工（机械化 12 项；总 13 项 = 12 + M-Integrity-2 人工）] ${rel}`);
    }
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
const declaredNames = (wlLine.split('=')[1] || '').split('+')[0].split('/').map((s) => s.trim()).filter(Boolean);
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
const exDir = join(REPO_ROOT, 'examples');
if (existsSync(exDir)) {
  for (const f of walk(exDir)) {
    const rel = 'examples/' + relative(exDir, f).replaceAll('\\', '/');
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/v?(\d+\.\d+\.\d+-dsh\.\d+)/g)) {
      if (normVer(m[1]) !== normVer(pkgVer)) {
        errors.push(`[P0 版本引用] ${rel} 写 ${m[0]} ≠ package.json=${pkgVer}`);
        break;
      }
    }
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
