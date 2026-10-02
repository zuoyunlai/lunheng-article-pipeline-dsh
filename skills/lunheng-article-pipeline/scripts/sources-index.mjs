#!/usr/bin/env node
// 论衡检索三线「共享来源索引」（v18.29.0 EFF-5 新增 / scripts 白名单 26→27）
//
// 用法：
//   node sources-index.mjs <项目目录> --check             # 校验三线分片（schema / 重复 / 计数）
//   node sources-index.mjs <项目目录> --merge             # 合并三线分片 → sources.json（主控在 Phase 2.5 跑）
//   node sources-index.mjs <项目目录> --query [<needle>]  # 查索引（按 URL 去重；needle 命中 url/title/summary）
//
// 退出码：
//   0  = 成功
//   1  = 发现不合法行（本脚本**确实做内容判定**——校验 JSONL 行 schema 与 url 形态，故 1 是正当语义、不是撞码）
//        ⚠️ v18.62.4（全量审计-v18.62.3 §8.1 #7）：**`--check` 与 `--merge` 同判据**。旧版只有 `--check`
//        会 exit 1，而 `--merge`（**Phase 2.5 实际跑的那个模式**）warn 后 exit 0 → 不合法行被静默跳过、
//        索引缺来源，而主控只看退出码 → **数据丢了没人知道**。现两者都按「有无不合法行」定码。
//   10 = 参数或路径错（未知参数 / 缺模式 / 一次给多个模式 / 项目目录不存在）
//   70 = 内部错误（EX_SOFTWARE，见 _lib/exit-guard.mjs）
//
// ── 为什么需要它（报告 §三.3 EFF-5）────────────────────────────────────────────
//   实测 T1+T2+T3 合计 ≈58.1M cacheRead（约 8.9%），而**三条线各自抓取**（T1 28.19M / T2 19.63M / T3 10.32M）。
//   同题三线的来源重叠通常 10–30%——**同源命中本该只付一次抓取与一次阅读**。
//
// ── 数据布局与并发安全（这是本机制最容易做错的地方）──────────────────────────
//   `run/<项目>/sources/T1.jsonl` / `T2.jsonl` / `T3.jsonl`——**每线一个 append-only 分片**，
//   分片**由该线独占**（T1 只写 T1 分片）。**刻意不做「三线共写一个 sources.json」**：
//   三个子代理并发写同一文件必然互相覆盖——这正是本仓 `status.md`（主控独占）/ `agents-log.md`
//   （子代理各自追加）分离的同一条判据。合并成单文件 `sources.json` 的动作**由主控**在 Phase 2.5 跑 `--merge`。
//
// ── 行 schema（JSONL，一行一个对象；真源 = references/templates/sources-索引-template.md）──
//   { "url": "https://…", "title": "…", "fetchedAt": "YYYY-MM-DD", "summary": "一行摘要", "line": "T1",
//     "tool": "advanced_search", "engine": "exa", "query": "…" }
//   必填 url / title / fetchedAt / summary；`line` 缺省取分片名（T1/T2/T3）。
//   **溯源字段（v18.62.7 §A22）**：`tool` / `engine` / `query`——**要么都不写（旧格式行，软提示）**，
//     **要么写齐**（写一个就要求三个全有，缺则判不合法）；`tool` = 实际调用的检索工具名
//     （`advanced_search` / `multi_search` / `platform_search` / `web_fetch` / `search_papers` …），
//     `engine` = 该次调用的引擎（`advanced_search` 的 `engine` 参数值；`multi_search` 可写聚合名 + `seenIn` 数），
//     `query` = 该条来源对应的检索式。**为什么必需**：没有它，「某条是不是用规定的源取的」无法核验
//     （实测要回答「检索用了哪些插件」，交付物里查不到，只能回翻 DSH 会话缓存）。
//
// ── 不是门（如实声明）─────────────────────────────────────────────────────────
//   本脚本**不判定「该不该抓某个源」**，也不阻断任何流程：`--check` 只校验**行是否合法**与**统计重复**；
//   「重复来源是否真的被复用」由 T7 在审计时看（G 项实据里可引用本脚本 `--query` 的输出）。

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { installExitGuard, requireExistingDir } from './_lib/exit-guard.mjs';
import { writeReport } from './_lib/destructive-write.mjs';
import { parseArgs as parseCliArgs, USAGE_CODE as CLI_USAGE_CODE } from './_lib/cli-args.mjs';
installExitGuard();

const USAGE = '用法: node sources-index.mjs <项目目录> --check | --merge | --query [<needle>]';
const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(`${USAGE}

<项目目录>   run/<项目名>（须已存在；分片在 <项目>/sources/{T1,T2,T3}.jsonl）
--check      校验每个分片：文件存在性 / 每行合法 JSON / 必填键齐备 / url 形如 http(s) / **溯源字段「要么都不写、要么写齐」** / 统计跨线重复（重复是**预期收益**，只报不判错）
--merge      合并三线分片 → <项目>/sources.json（按 url 去重、保留来源线标记 + 计数；**主控在 Phase 2.5 跑**）
--query      打印去重后的索引（可带 needle 过滤 url/title/summary）
退出码：0 成功｜1 发现不合法行（--check 与 --merge **同判据**；--merge 仍写出 sources.json 但会报不完整）｜10 参数或路径错｜70 内部错误
`);
  process.exit(0);
}

let project = null, mode = null, needle = null;
try {
  const parsed = parseCliArgs(args, { flags: ['--check', '--merge', '--query'], maxPositionals: 2 });
  mode = ['--check', '--merge', '--query'].find((f) => parsed.flags.has(f)) || null;
  const pos = parsed.positionals || [];
  project = pos[0] || null;
  needle = pos[1] || null;
  if (parsed.flags.size > 1) { console.error(`一次只跑一个模式（给了 ${[...parsed.flags].join(' ')}）\n${USAGE}`); process.exit(10); }
} catch (e) {
  if (e && e.code === CLI_USAGE_CODE) { console.error(`${e.message}\n${USAGE}`); process.exit(10); }
  throw e;
}
if (!project) { console.error(USAGE); process.exit(10); }
if (!existsSync(project)) { console.error(`项目目录不存在: ${project}`); process.exit(10); }
requireExistingDir(project, '项目目录');
if (!mode) { console.error(`需给一个模式：--check / --merge / --query\n${USAGE}`); process.exit(10); }

const LINES = ['T1', 'T2', 'T3'];
const REQUIRED = ['url', 'title', 'fetchedAt', 'summary'];
// ── v18.62.7（反哺-主控实测 §A22）：**溯源字段** ────────────────────────────────────
//   病灶：`sources.json` / `sources/*.jsonl` 旧 schema 只有 `line/url/title/fetchedAt/summary`
//     ——**没有工具、引擎、query**。于是「某条数据是不是用规定的检索源取的」**无法核验**：
//     实测要回答「检索用了哪些插件」，交付物里查不到，只能回翻 DSH 会话缓存数工具调用
//     （而那正是 §A19「角色卡点名了本机未安装的工具」这个错位能被藏住的原因）。
//   口径（**与「不对历史形态过度收紧」一致**）：三字段**要么都不写**（旧格式行）**要么写齐**
//     ——写了一个就必须三个全有；**全缺只记软提示并点名到行**（不判红），存量项目不因此翻红。
//     `tool` / `engine` / `query` 写入后随 `--merge` 进 `sources.json`，`--query` 亦可显示。
const PROVENANCE = ['tool', 'engine', 'query'];
const shardPath = (p, line) => join(p, 'sources', `${line}.jsonl`);

/** 读全部分片 → `{ entries, problems, provenance, shards }`（不判「该不该抓」，只判行是否合法）。 */
const readShards = (p) => {
  const entries = [], problems = [], provenance = [], shards = {};
  for (const line of LINES) {
    const f = shardPath(p, line);
    if (!existsSync(f)) { shards[line] = { path: f, exists: false, lines: 0 }; continue; }
    const raw = readFileSync(f, 'utf8').split('\n');
    let n = 0;
    raw.forEach((l, i) => {
      const t = l.trim();
      if (t === '') return;
      n++;
      let o;
      try { o = JSON.parse(t); } catch { problems.push({ line, line_no: i + 1, reason: '不是合法 JSON（JSONL 每行一个对象）' }); return; }
      const miss = REQUIRED.filter((k) => !o[k] || String(o[k]).trim() === '');
      if (miss.length) problems.push({ line, line_no: i + 1, reason: `缺必填键：${miss.join(',')}` });
      if (o.url && !/^https?:\/\//i.test(String(o.url))) problems.push({ line, line_no: i + 1, reason: `url 不是 http(s)：${String(o.url).slice(0, 40)}` });
      // 溯源字段：写了一个就必须三个全有；全缺 → 软提示（旧格式行）
      const got = PROVENANCE.filter((k) => o[k] && String(o[k]).trim() !== '');
      if (got.length > 0 && got.length < PROVENANCE.length) {
        problems.push({ line, line_no: i + 1, reason: `溯源字段不齐：写了 ${got.join(',')}，缺 ${PROVENANCE.filter((k) => !got.includes(k)).join(',')}（要么都不写，要么写齐）` });
      } else if (got.length === 0) {
        provenance.push({ line, line_no: i + 1, url: String(o.url || '').slice(0, 60) });
      }
      entries.push({ line: o.line || line, url: String(o.url || ''), title: String(o.title || ''), fetchedAt: String(o.fetchedAt || ''), summary: String(o.summary || ''),
        ...(got.length === PROVENANCE.length ? { tool: String(o.tool), engine: String(o.engine), query: String(o.query) } : {}) });
    });
    shards[line] = { path: f, exists: true, lines: n, bytes: statSync(f).size };
  }
  return { entries, problems, provenance, shards };
};

const { entries, problems, provenance, shards } = readShards(project);

if (mode === '--check') {
  // 跨线重复：**这是本机制的收益来源**，只统计不判错（同一 URL 被两线各抓一次 = 本可只付一次）
  const byUrl = new Map();
  for (const e of entries) {
    if (!e.url) continue;
    if (!byUrl.has(e.url)) byUrl.set(e.url, []);
    byUrl.get(e.url).push(e.line);
  }
  const dup = [...byUrl.entries()].filter(([, ls]) => new Set(ls).size > 1).map(([url, ls]) => ({ url, lines: [...new Set(ls)] }));
  const perLine = Object.fromEntries(LINES.map((l) => [l, entries.filter((e) => e.line === l).length]));
  console.log(`# 来源索引校验（${project}）`);
  for (const l of LINES) {
    const s = shards[l];
    console.log(`  ${l}: ${s.exists ? `${s.lines} 行 / ${s.bytes} B` : '分片不存在（该线尚未登记——不判错）'}`);
  }
  console.log(`  合计 ${entries.length} 行 → 去重后 ${byUrl.size} 个来源｜跨线重复 ${dup.length} 个（**可省的重复抓取数**）`);
  if (dup.length) for (const d of dup.slice(0, 5)) console.log(`    · ${d.url.slice(0, 70)} [${d.lines.join('+')}]`);
  if (problems.length) {
    console.error(`\n✗ ${problems.length} 行不合法：`);
    for (const p of problems.slice(0, 10)) console.error(`  · ${p.line}.jsonl:${p.line_no} — ${p.reason}`);
    process.exit(1);
  }
  console.log('\n✓ 全部分片行合法（空分片/缺分片不算问题——那是「该线尚未登记」）');
  // v18.62.7（反哺 §A22）：**溯源字段缺口只报软提示、不改退出码**——存量项目（旧格式行）不该因此翻红。
  if (provenance.length) {
    console.log(`\nℹ ${provenance.length}/${entries.length} 行**无溯源字段**（tool/engine/query）——旧格式行，可缺；`);
    console.log('  但**新写入的行必须写齐三字段**：否则「某条是不是用规定的检索源取的」在交付物里查不到（§A22/A19）。');
    for (const p of provenance.slice(0, 3)) console.log(`    · ${p.line}.jsonl:${p.line_no} ${p.url}`);
    if (provenance.length > 3) console.log(`    · …另有 ${provenance.length - 3} 行`);
  }
  process.exit(0);
}

if (mode === '--query') {
  const byUrl = new Map();
  for (const e of entries) {
    if (!byUrl.has(e.url)) byUrl.set(e.url, { ...e, lines: new Set([e.line]) });
    else byUrl.get(e.url).lines.add(e.line);
  }
  let rows = [...byUrl.values()];
  if (needle) {
    const n = needle.toLowerCase();
    rows = rows.filter((r) => (r.url + ' ' + r.title + ' ' + r.summary).toLowerCase().includes(n));
  }
  rows.sort((a, b) => a.url.localeCompare(b.url));
  console.log(`# 来源索引（${project}）${needle ? `｜过滤「${needle}」` : ''}：${rows.length} 个来源`);
  for (const r of rows) {
    console.log(`  [${[...r.lines].join('+')}] ${r.fetchedAt} ${r.title.slice(0, 40)}`);
    console.log(`        ${r.url}`);
    if (r.summary) console.log(`        ${r.summary.slice(0, 80)}`);
  }
  process.exit(0);
}

if (mode === '--merge') {
  const byUrl = new Map();
  for (const e of entries) {
    if (!byUrl.has(e.url)) byUrl.set(e.url, { ...e, lines: new Set([e.line]) });
    else { const x = byUrl.get(e.url); x.lines.add(e.line); if (!x.summary && e.summary) x.summary = e.summary; }
  }
  const merged = [...byUrl.values()].map((r) => ({ ...r, lines: [...r.lines].sort() }));
  const report = {
    project,
    date: new Date().toISOString().slice(0, 10),
    counts: {
      perLine: Object.fromEntries(LINES.map((l) => [l, entries.filter((e) => e.line === l).length])),
      total: entries.length,
      unique: merged.length,
      crossLineDuplicates: merged.filter((r) => r.lines.length > 1).length,
    },
    entries: merged.sort((a, b) => a.url.localeCompare(b.url)),
  };
  const out = join(project, 'sources.json');
  writeReport(out, JSON.stringify(report, null, 2), { protect: [] });
  console.log(`✓ 已合并 → ${out}`);
  console.log(`  三线合计 ${report.counts.total} 行｜去重 ${report.counts.unique} 个来源｜跨线重复 ${report.counts.crossLineDuplicates} 个`);
  // v18.62.4（全量审计-v18.62.3 §8.1 #7）：**同一缺陷两种退出码**。
  //   病灶：`--check` 对不合法行 `process.exit(1)`，而 `--merge`（**Phase 2.5 实际跑的那个模式**）
  //   只 `console.warn` 后 **exit 0** —— 同一份分片、同一个缺陷，换个模式就从「失败」变「成功」。
  //   危害不是文案问题：不合法行**被静默跳过**（`sources.json` 里就是少了这些来源），而主控在
  //   Phase 2.5 只看退出码 → 带着缺来源的索引继续跑三角验证，**没人知道数据丢了**。
  //   修法：`--merge` 仍**写出** `sources.json`（已解析的行照常合并，不把好数据一起扣住），
  //   但按**同一判据**定码：有跳过行 → exit 1 并指明这些行**不在**产物里；全合法 → exit 0。
  //   判据一句话：**「掉了数据」必须让调用方能从退出码看出来**——模式不该改变同一缺陷的严重度。
  if (problems.length) {
    console.warn(`  ⚠ 有 ${problems.length} 行不合法被跳过（先跑 --check 看明细）`);
    console.error(`\n✗ sources.json 已写出，但**不含上述 ${problems.length} 行**——索引不完整。`);
    for (const p of problems.slice(0, 10)) console.error(`  · ${p.line}.jsonl:${p.line_no} — ${p.reason}`);
    console.error('→ 退出码 1（与 --check 同判据：不合法行 = 有发现），请修正分片后重跑 --merge。');
    process.exit(1);
  }
  process.exit(0);
}

console.error(USAGE);
process.exit(10);
void readdirSync; void basename;
