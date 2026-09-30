// dist-tag-check 单元测试（v18.62.1 选项 B）
// 覆盖：① 一致性判定（含缺 tag / 落后 / 超前）② 修复命令渲染 ③ 网络取数走 ?write=true 优先、失败回退
// 全部用**注入的 fetch**（不打真网络）——这条纪律来自本仓教训：门/测试不得依赖外部服务的可用性。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, render, fetchDistTags, REGISTRY } from '../scripts/dist-tag-check.mjs';

const okFetch = (tags) => async () => ({ ok: true, status: 200, json: async () => ({ 'dist-tags': tags }) });

test('evaluate：两标签均指向本版本 → 一致', () => {
  const r = evaluate('18.62.0', { latest: '18.62.0', dsh: '18.62.0' });
  assert.equal(r.consistent, true);
  assert.deepEqual(r.problems, []);
});

test('evaluate：latest 落后（本仓预期路径）→ 不一致且点名 latest', () => {
  const r = evaluate('18.62.0', { latest: '18.60.1', dsh: '18.62.0' });
  assert.equal(r.consistent, false);
  assert.deepEqual(r.problems.map((p) => p.tag), ['latest']);
  assert.equal(r.problems[0].kind, 'drift');
});

test('evaluate：dsh 未指向本版本 → 不一致（含补推旧 tag 覆盖 dsh 的场景）', () => {
  const r = evaluate('18.62.0', { latest: '18.62.0', dsh: '18.61.1' });
  assert.deepEqual(r.problems.map((p) => p.tag), ['dsh']);
});

test('evaluate：标签缺失 → kind=missing（不是静默放过）', () => {
  assert.deepEqual(evaluate('18.62.0', {}).problems.map((p) => p.kind), ['missing', 'missing']);
  assert.deepEqual(evaluate('18.62.0', undefined).problems.length, 2);
});

test('render：不一致时必须给出**可复制**的修复命令 + 绕缓存复核命令', () => {
  const out = render('lunheng-article-pipeline', '18.62.0', { latest: '18.60.1', dsh: '18.62.0' }, evaluate('18.62.0', { latest: '18.60.1', dsh: '18.62.0' }));
  assert.match(out, /npm dist-tag add lunheng-article-pipeline@18\.62\.0 latest/);
  assert.match(out, /--prefer-online/, '必须给绕本地缓存的复核命令');
  assert.ok(!/npm dist-tag add .* dsh/.test(out), 'dsh 已正确时不得给出多余的 dsh 补打命令');
  assert.match(out, /预期路径/, '必须写明 latest 落后是本仓政策而非故障——否则读者会去查不存在的问题');
});

test('render：一致时只报绿，不输出任何修复命令', () => {
  const out = render('p', '1.0.0', { latest: '1.0.0', dsh: '1.0.0' }, evaluate('1.0.0', { latest: '1.0.0', dsh: '1.0.0' }));
  assert.match(out, /✅ 一致/);
  assert.ok(!out.includes('npm dist-tag add'), '一致时不得出现修复命令');
});

test('fetchDistTags：优先 ?write=true（绕 CDN 传播延迟，防刚补打就误报）', async () => {
  const seen = [];
  const f = async (url) => { seen.push(url); return { ok: true, status: 200, json: async () => ({ 'dist-tags': { latest: '2.0.0', dsh: '2.0.0' } }) }; };
  const { tags, source } = await fetchDistTags('pkg-a', f);
  assert.equal(seen.length, 1, '首选命中就不该再打第二个端点');
  assert.match(seen[0], /\?write=true$/);
  assert.match(source, /write=true/);
  assert.equal(tags.latest, '2.0.0');
});

test('fetchDistTags：?write=true 失败 → 回退 dist-tags 端点', async () => {
  const seen = [];
  const f = async (url) => {
    seen.push(url);
    if (url.includes('?write=true')) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ latest: '2.0.0', dsh: '2.0.0' }) };
  };
  const { tags, source } = await fetchDistTags('pkg-b', f);
  assert.equal(seen.length, 2);
  assert.match(seen[1], /\/-\/package\/pkg-b\/dist-tags$/);
  assert.match(source, /dist-tags 端点/);
  assert.equal(tags.dsh, '2.0.0');
});

test('fetchDistTags：两端点都不可用 → 抛且标 isEnvironment（供 CLI 映射到 exit 10 而非 1）', async () => {
  const f = async () => { throw new Error('ENOTFOUND'); };
  await assert.rejects(
    () => fetchDistTags('pkg-c', f),
    (err) => {
      assert.equal(err.isEnvironment, true, '环境错必须可识别——否则会被误当成「内容不一致」');
      return true;
    },
  );
});

test('REGISTRY 常量指向官方 registry（防有人改成镜像而悄悄改变判定对象）', () => {
  assert.equal(REGISTRY, 'https://registry.npmjs.org');
});

test('端到端（注入 fetch）：latest 落后的真实事故形态能被完整判出', async () => {
  // 复刻 2026-09-30 实际形态：package.json=18.62.0、dsh 已对、latest 停在 18.60.1
  const { tags } = await fetchDistTags('lunheng-article-pipeline', okFetch({ latest: '18.60.1', dsh: '18.62.0' }));
  const r = evaluate('18.62.0', tags);
  assert.equal(r.consistent, false);
  assert.deepEqual(r.problems.map((p) => `${p.tag}:${p.actual}`), ['latest:18.60.1']);
});
