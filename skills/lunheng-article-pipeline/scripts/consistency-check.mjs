// 论衡插件一致性自检脚本（DSH）— 发布/commit 前运行
// 用法：node scripts/consistency-check.mjs
// 覆盖五类漂移：双头版本行 / 悬空引用 / 裸「（检查）」占位符 / 8 分钟硬卡残留 / 硬编码 fallback 链
// 退出码 0 = 通过；1 = 有漂移（列在 stderr）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..'); // skills/lunheng-article-pipeline

const VER_HEADER_RE = /^> 版本：v2\.5\.2-dsh\.\d+（DSH 适配版/; // 正则匹配任意 -dsh.N 版本头，防未来 bump 后常量失效

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

for (const f of files) {
  const rel = relative(ROOT, f).replaceAll('\\', '/');
  const text = readFileSync(f, 'utf8');

  // 1. 双头版本行（同一版本头出现 ≥2 次）
  const verCount = text.split('\n').filter((l) => VER_HEADER_RE.test(l)).length;
  if (verCount > 1) errors.push(`[P0-1d 双头版本行 x${verCount}] ${rel}`);

  // 2. 悬空引用：版本一致性检查 → 应为 版本升级自审门
  if (text.includes('版本一致性检查-v2.3.0.md')) {
    errors.push(`[P0-1a 悬空引用「版本一致性检查-v2.3.0.md」] ${rel}`);
  }

  // 2b. 裸「（检查）」占位符残留（净化剥离未标记；SKILL.md/glossary.md 为元文档说明，豁免）
  if (text.includes('（检查）') && !rel.endsWith('SKILL.md') && !rel.endsWith('glossary.md')) {
    errors.push(`[P2 裸「（检查）」占位符] ${rel}`);
  }

  if (active.includes(f)) {
    // 3. 8 分钟硬卡残留（正向断言，不含「无 8 分钟硬卡」免责声明）
    if (/(>8 分钟|超时硬卡 8 分钟|8 分钟内未出产物|静默 >8 分钟)/.test(text)) {
      errors.push(`[P0-1b 8分钟硬卡残留] ${rel}`);
    }
    // 4. 硬编码 fallback 链（应抽象为「能力档 + 候选池」）
    if (/claude-opus-5\s*→\s*fallback\s*链/.test(text)) {
      errors.push(`[P0-1c 硬编码 fallback 链] ${rel}`);
    }
  }
}

if (errors.length) {
  console.error(`一致性自检未通过，共 ${errors.length} 处：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`一致性自检通过：${files.length} 个 .md 文件，0 处漂移。`);
