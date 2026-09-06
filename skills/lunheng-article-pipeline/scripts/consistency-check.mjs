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
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..'); // skills/lunheng-article-pipeline
const REPO_ROOT = join(ROOT, '..', '..'); // lunheng-article-pipeline-dsh

// ① 版本真源 = package.json；版本头行任意 -dsh.N（v2.5.2-dsh.3 修订：不再硬编码 v2.5.2，防 bump 到 v2.6.0 后失效）
const VER_HEADER_RE = /^> 版本：v\d+\.\d+\.\d+-dsh\.\d+（DSH 适配版/;
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
// 排除 OpenClaw 历史归档 + 执行韧化协议（属完整协议参考，非 DSH 现行规则）
const isArchive = (f) => f.includes(join('references', '_shared', 'archive'));
const isLegacyProtocol = (f) => f.endsWith('执行韧化协议-v2.1.0.md');
const active = files.filter((f) => !isArchive(f) && !isLegacyProtocol(f));

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

  // ②b M-Gate-Report 文件名/标识漂移（v2.5.2-dsh.3 审计：门 V 已明令无版本后缀，含 JSON "schema" 字段值；
  //    版本升级自审门-v2.3.0.md 的 L15 迁移表（旧→新映射说明）豁免）
  if (!isArchive(f) && !rel.includes('版本升级自审门') && /M-Gate-Report-v2\.2\.(4|12)(\.json|")/.test(text)) {
    errors.push(`[P1 M-Gate-Report 文件名/标识漂移（应为 M-Gate-Report.json）] ${rel}`);
  }

  // ③a 悬空引用：版本一致性检查旧名 → 应为 版本升级自审门
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

  // ③d 角色卡索引完整性：SKILL.md/README 声称的 9 张角色卡必须全部存在
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
    // ⑦ 全量版本头一致性（v2.5.2-dsh.5 审计新增：防单个文件版本头漏 bump）
    const headerLine = text.split('\n').find((l) => l.startsWith('> 版本：v'));
    const headerVer = headerLine?.match(/v(\d+\.\d+\.\d+-dsh\.\d+)/)?.[1];
    if (headerVer && normVer(headerVer) !== normVer(pkgVer)) {
      errors.push(`[P0 版本头漂移] ${rel} 版本头 v${headerVer} ≠ package.json=${pkgVer}`);
    }
  }
}

// ⑧ cordis.patch.yml + examples/ 版本引用（v2.5.2-dsh.5 审计新增：防安装文档指向未发布版本）
const patchPath = join(REPO_ROOT, 'cordis.patch.yml');
if (existsSync(patchPath)) {
  const pt = readFileSync(patchPath, 'utf8');
  const pm = pt.match(/DSH 适配版\s*(v?\d+\.\d+\.\d+-dsh\.\d+)/);
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
