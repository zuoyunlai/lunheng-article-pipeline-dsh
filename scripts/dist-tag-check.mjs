#!/usr/bin/env node
// dist-tag-check.mjs — 发版后 dist-tag 一致性检查（只读，v18.62.1 选项 B）
// **仓库级脚本（不随包）**——与 closeout-verify / no-write-check / flow-metrics 同类。
//
// 为什么存在（具体事故）：v18.62.0 发布成功、`dsh` 正确指向 18.62.0，但 **`latest` 仍停在 18.60.1**
//   → npmjs.com 包页（默认展示 `latest`）与「不带版本的安装命令」双双停在旧版，主人看到后以为没发出去。
//   根因不是故障而是**政策**：`SECURITY.md` 记「主人 2026-09-29 决定：不依赖 NPM_TOKEN 自动同步 `latest`，
//   改为发版后由维护者手工补打」。而 `npm publish` 走 OIDC、`npm dist-tag add` 仍需写鉴权 → **CI 永远动不了 `latest`**。
//   ⇒ 缺的不是能力，是**提醒**。本脚本就是那道提醒：**只读、零凭据、不进发布链**。
//
// ⚠️ 它**不是发布门**：刻意不接进 CI。理由——CI 无法修复（无 token），挂上去只会每次发版亮红灯，
//   制造「习以为常的红」（与 quality-score 挂门同一判据）。它是**发版后手动跑一次**的核对工具。
//
// 用法：
//   node scripts/dist-tag-check.mjs                # 读 package.json 的 name/version
//   node scripts/dist-tag-check.mjs --json
//   node scripts/dist-tag-check.mjs --pkg <name> --version <ver>
//
// 退出码：0 一致 ／ 1 不一致（含 `latest` 落后）／ 10 用法或环境错（含 registry 不可达）／ 70 内部错

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REGISTRY = 'https://registry.npmjs.org';

/**
 * 纯函数：判定 dist-tag 与本版本是否一致（便于单测，不碰网络）。
 * @param {string} version 本仓 package.json 的版本
 * @param {{latest?: string, dsh?: string}} tags registry 返回的 dist-tags
 * @returns {{consistent: boolean, problems: Array<{tag: string, actual: string|null, expected: string, kind: string}>}}
 */
export function evaluate(version, tags) {
  const problems = [];
  for (const tag of ['dsh', 'latest']) {
    const actual = tags && tags[tag] != null ? String(tags[tag]) : null;
    if (actual !== version) {
      problems.push({
        tag,
        actual,
        expected: version,
        kind: actual === null ? 'missing' : 'drift',
      });
    }
  }
  return { consistent: problems.length === 0, problems };
}

/** 一致性判定 → 人类可读报告（含确切修复命令）。 */
export function render(pkg, version, tags, result) {
  const out = [];
  out.push(`# dist-tag 一致性检查（只读）`);
  out.push('');
  out.push(`包：\`${pkg}\`｜本仓版本：\`${version}\``);
  out.push(`registry 实测：\`latest\` = ${tags.latest ?? '（无）'}｜\`dsh\` = ${tags.dsh ?? '（无）'}`);
  out.push('');
  if (result.consistent) {
    out.push('✅ 一致：`latest` 与 `dsh` 均指向本版本。');
    return out.join('\n');
  }
  out.push('❌ 不一致：');
  for (const p of result.problems) {
    const why = p.kind === 'missing' ? '该 dist-tag 不存在' : p.tag === 'latest'
      ? '`latest` 落后（**预期路径**：本仓不配 NPM_TOKEN，CI 只推 `dsh`，`latest` 需手工补打）'
      : '`dsh` 未指向本版本（正常由 `npm publish --tag dsh` 自动设置；若为补推旧 tag 导致，见 CONTRIBUTING §补推历史 tag）';
    out.push(`  - \`${p.tag}\`：实际 ${p.actual ?? '（无）'} ≠ 期望 ${p.expected} —— ${why}`);
  }
  out.push('');
  out.push('**修复（本机需有本包写权限）**：');
  for (const p of result.problems) {
    out.push(`  npm dist-tag add ${pkg}@${version} ${p.tag}`);
  }
  out.push('');
  out.push('复核（绕开本地缓存）：');
  out.push(`  npm view ${pkg} dist-tags --prefer-online`);
  out.push(`  # 或直接查权威端点：https://registry.npmjs.org/${pkg}?write=true`);
  out.push('');
  out.push('> 注意：补打后**公共端点的 CDN 传播有数十秒延迟**（实测 ~45s）——本脚本已优先读');
  out.push('> `?write=true`（绕 CDN），故不会因传播延迟误报。');
  return out.join('\n');
}

/**
 * 读 registry 的 dist-tags。优先 `?write=true`（绕 CDN 传播延迟），失败回退到 dist-tags 端点。
 * @returns {Promise<{tags: object, source: string}>}
 */
export async function fetchDistTags(pkg, fetchImpl = fetch) {
  const attempts = [
    [`${REGISTRY}/${encodeURIComponent(pkg)}?write=true`, 'write=true（绕 CDN）', (j) => j['dist-tags']],
    [`${REGISTRY}/-/package/${encodeURIComponent(pkg)}/dist-tags`, 'dist-tags 端点', (j) => j],
  ];
  const errors = [];
  for (const [url, label, pick] of attempts) {
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!res.ok) { errors.push(`${label}: HTTP ${res.status}`); continue; }
      const tags = pick(await res.json());
      if (!tags || typeof tags !== 'object') { errors.push(`${label}: 响应无 dist-tags`); continue; }
      return { tags, source: label };
    } catch (err) {
      errors.push(`${label}: ${err && err.message}`);
    }
  }
  const e = new Error(`无法读取 registry dist-tags（${errors.join('｜')}）`);
  e.isEnvironment = true;
  throw e;
}

function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const unknown = args.filter((a, i) => a.startsWith('--') && !['--json', '--pkg', '--version'].includes(a));
  if (unknown.length) { console.error(`未知参数：${unknown.join(', ')}`); process.exit(10); }

  let pkg = arg('--pkg');
  let version = arg('--version');
  const pkgPath = join(ROOT, 'package.json');
  if ((!pkg || !version) && existsSync(pkgPath)) {
    try {
      const pj = JSON.parse(readFileSync(pkgPath, 'utf8'));
      pkg = pkg ?? pj.name;
      version = version ?? pj.version;
    } catch (err) {
      console.error(`无法解析 ${pkgPath}：${err && err.message}`);
      process.exit(70);
    }
  }
  if (!pkg || !version) { console.error('缺少包名或版本（且无法从 package.json 派生）——用 --pkg/--version 指定'); process.exit(10); }

  fetchDistTags(pkg)
    .then(({ tags, source }) => {
      const result = evaluate(version, tags);
      if (json) {
        console.log(JSON.stringify({ pkg, version, tags, source, ...result }, null, 2));
      } else {
        console.log(render(pkg, version, tags, result));
      }
      process.exit(result.consistent ? 0 : 1);
    })
    .catch((err) => {
      console.error(`${err && err.message}`);
      process.exit(err && err.isEnvironment ? 10 : 70);
    });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main(process.argv);
