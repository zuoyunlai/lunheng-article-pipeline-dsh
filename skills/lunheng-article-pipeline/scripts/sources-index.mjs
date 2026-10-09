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
//   **补检索段（v18.78.0，反哺 F2）**：同一条线可以有**多个分片文件**——Phase 1.5 补检索写
//   `T1-补.jsonl` 这类 `T<n>-<后缀>.jsonl`，本脚本会把它**归并入基础线 T<n>**（line 标记仍是 T1/T2/T3）。
//   目录里其它 `*.jsonl`（命名不匹配）**不被静默忽略**：逐条记 problem → `--check` exit 1。理由见 `SHARD_RE` 段。
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
//   **分片级一致性（v18.86.0-prep · 台海反哺 F-14：兼容期 → 强制的渐进升级）**：**同一分片必须
//     全带齐或全不带**——**混用**（部分带齐 / 部分全缺）判**不合法**（exit 1）。判据：一个分片是**同一轮
//     检索**的产物，不可能一半有溯源一半没有；行级规则挡不住「写一半就停」，而写一半已足以让换档
//     不可逐条标注（台海 55/55 缺 `tool/engine/query` 即此类）。**纯旧分片仍在兼容期**（仅软提示，存量
//     项目不被打红）；**新项目/新一轮分片应全片带齐**——这就是把「兼容期 → 强制」做成**不回溯罚存量**。
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

<项目目录>   run/<项目名>（须已存在；分片在 <项目>/sources/——T1/T2/T3.jsonl 主分片 + 补检索段 T<n>-<后缀>.jsonl）
--check      校验每个分片：文件存在性 / 每行合法 JSON / 必填键齐备 / url 形如 http(s) / **溯源字段「要么都不写、要么写齐」** / **未识别的 *.jsonl 分片名** / 统计跨线重复（重复是**预期收益**，只报不判错）
--merge      合并三线分片（含补检索段）→ <项目>/sources.json（按 url 去重、保留来源线标记 + 计数；**主控在 Phase 2.5 跑**）
--query      打印去重后的索引（可带 needle 过滤 url/title/summary）
退出码：0 成功｜1 发现不合法行或未识别分片（--check 与 --merge **同判据**；--merge 仍写出 sources.json 但会报不完整）｜10 参数或路径错｜70 内部错误
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
// ── v18.78.0（反哺-v18.78.0-candidate F2）：**分片发现 + 未识别分片响亮告警** ──────────────────────
//   病灶（实测 cn-llm-inference-cost-econ，Phase 1.5）：补检索产出的 `sources/T1-补.jsonl`（5 行）
//     **不在旧实现的 `LINES = ['T1','T2','T3']` 里** → `--merge` 只读三份主分片，那 5 行**无声地不进
//     `sources.json`**，而退出码仍是 0。主控与主人只能靠事后比对行数才发现数据丢了。
//   判据（与本脚本 `--merge` 段「掉了数据必须让调用方看出来」同一句话）：**目录里躺着没被读的分片，
//     就不得算成功** —— 退出码必须能表达这件事。
//   修法（两条，缺一不可）：
//     ① **补检索分片纳入**：文件名形如 `T<n>-<后缀>.jsonl`（`T1-补.jsonl` / `T1_补.jsonl` /
//        `T1.2.jsonl` …）→ 归并入**其基础线** `T<n>`。分片仍然「每线独占」，只是同一条线可以有
//        **多个追加段**（补检索轮次）；line 标记保持三线语义，故「跨线重复」与 perLine 计数不受影响。
//        ⚠️ 基础线必须 ∈ {T1,T2,T3}：`T4.jsonl` 这类**不认**（见 ②），防「多出第四条线」被静默混入。
//     ② **其余 `*.jsonl` 响亮报告**：不匹配上述命名的分片**不静默忽略**，逐条记 problem
//        （`--check` → exit 1；`--merge` → 同判据并明说这些行不在产物里）。
const SHARD_RE = /^T(\d+)(?:[-_.].*)?\.jsonl$/i;
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
/** 列出 `sources/` 下的分片文件 → `{ files: [{file, base, path}], unknown: [文件名] }`。
 *  `files` 按文件名排序（行序稳定）；`base` ∈ {T1,T2,T3}——**派生自文件名，不是全库常量**。 */
const listShards = (p) => {
  const dir = join(p, 'sources');
  if (!existsSync(dir)) return { files: [], unknown: [] };
  const files = [], unknown = [];
  for (const f of readdirSync(dir)) {
    if (!/\.jsonl$/i.test(f)) continue;
    const m = SHARD_RE.exec(f);
    const base = m ? 'T' + m[1] : null;
    if (base && LINES.includes(base)) files.push({ file: f, base, path: join(dir, f) });
    else unknown.push(f);
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  unknown.sort();
  return { files, unknown };
};

/** 归一行标记：`T1/T2/T3` 及其任何后缀形态（`T1-补`）都记回基础线；无法归一时退回分片所在线。
 *  为什么归一：`report.counts.perLine` 与「跨线重复」都按三线记账，非标 `line` 值会让同一条来源
 *  **既不进 perLine、又被算成「跨线」**——正是「同一事实两处口径不一致」的形态。 */
const normLine = (v, base) => {
  const s = String(v || '').trim();
  if (!s) return base;
  const m = /^T(\d+)/i.exec(s);
  return m && LINES.includes('T' + m[1]) ? 'T' + m[1] : base;
};

/** 行不合法时的**可执行出口**：把 schema 真源与最常踩的错形态直接写进 stderr。
 *  v18.78.0（反哺 F1）：实测 T1/T2/T3 三线各写了一版**自造 schema**（素材卡式 `id/type/…`、
 *    pricing 式 `vendor/input_price`、index 式 `index/event_status`）→ 全部行判非法，
 *    而旧报文只说「缺必填键：fetchedAt,summary」——子代理据此**仍然不知道该长什么样**（它们以为自己写对了）。
 *  判据：**报错若不给出合格形态的出处，它就不是可执行的报错**（同 `mexist-gates` 对建议段的处理）。 */
const schemaHint = () => {
  console.error('  → 合格行 schema 真源 = references/templates/sources-索引-template.md §二'
    + '（必填 url / title / fetchedAt / summary；溯源 tool / engine / query **要么都不写、要么写齐**）。');
  console.error('  → **分片行 ≠ 素材卡行**：`id/type/credibility`（文献卡式）、`vendor/input_price`（自造式）、'
    + '`index/event_status`（自造式）都不是本 schema——按上表重写整行，别只补缺的那两个键。');
};

/** 报错定位串：有行号 → `分片文件:行号`；无行号（整份文件级问题，如未识别分片）→ 只给文件名。 */
const fmtProblem = (p) => (p.line_no > 0 ? `${p.line}:${p.line_no}` : String(p.line));

/** 读全部分片 → `{ entries, problems, provenance, shards, bom }`（不判「该不该抓」，只判行是否合法）。 */
const readShards = (p) => {
  const entries = [], problems = [], provenance = [], shardRows = [], bom = [];
  const { files, unknown } = listShards(p);
  for (const f of unknown) {
    problems.push({
      line: f, line_no: 0,
      reason: '分片文件名未识别——本脚本只读 T1/T2/T3.jsonl 及其补检索分片 `T<n>-<后缀>.jsonl`；'
        + '**该文件的行全部没有进索引**（若它就是补检索产物，改名为 `T1-补.jsonl` 这类即可）',
    });
  }
  for (const { file, base, path: f } of files) {
    const raw = readFileSync(f, 'utf8').split('\n');
    // v18.86.0-prep（台海反哺 F-14 · 兼容期 → 强制 的**渐进升级**）：分片级**混用**判据。
    //   病根：行级规则「要么都不写、要么写齐」挡不住**半途而废**——同一分片里前 10 行带齐溯源、
    //   后 10 行全缺，两半各自「合法」，而换档可审计性已破坏（这正是台海 55/55 缺 `tool/engine/query`
    //   的后果：跨档不可逐条标注）。
    //   判据：**同一分片 = 同一轮检索的产物** ⇒ 不可能一半有溯源一半没有。故：
    //     · 纯旧分片（全缺）= **兼容期**，仅软提示（**不报 problem**，存量项目不被打红）；
    //     · 纯新分片（全带齐）= 通过；
    //     · **混用** = 报 problem（硬）——「一旦开始用新格式，就必须全分片用」。
    //   这正是把「旧格式兼容期 → 新格式强制」做成**不回溯罚存量**的渐进路径。
    let withProv = 0, withoutProv = 0
    // v18.78.0（反哺 F6 的脚本侧落点）：**首行剥 UTF-8 BOM**。
    //   病灶：分片若以 BOM 落盘（本仓 `.gitattributes` 要求无 BOM，但外部工具写入会带），
    //   `JSON.parse('\uFEFF{…}')` 直接抛 → 旧实现把整行报成「不是合法 JSON」，
    //   主控据此去查「JSON 写坏了」，而真因是编码头。
    //   现：剥掉并在 `--check` 里显式点名（**机检硬格式要求无 BOM**，故这是要修的，不是可忽略的）。
    if (raw.length && raw[0].charCodeAt(0) === 0xfeff) { raw[0] = raw[0].slice(1); bom.push(file); }
    let n = 0;
    raw.forEach((l, i) => {
      const t = l.trim();
      if (t === '') return;
      n++;
      let o;
      try { o = JSON.parse(t); } catch { problems.push({ line: file, line_no: i + 1, reason: '不是合法 JSON（JSONL 每行一个对象）' }); return; }
      const miss = REQUIRED.filter((k) => !o[k] || String(o[k]).trim() === '');
      if (miss.length) problems.push({ line: file, line_no: i + 1, reason: `缺必填键：${miss.join(',')}` });
      if (o.url && !/^https?:\/\//i.test(String(o.url))) problems.push({ line: file, line_no: i + 1, reason: `url 不是 http(s)：${String(o.url).slice(0, 40)}` });
      // 溯源字段：写了一个就必须三个全有；全缺 → 软提示（旧格式行）
      const got = PROVENANCE.filter((k) => o[k] && String(o[k]).trim() !== '');
      if (got.length > 0 && got.length < PROVENANCE.length) {
        problems.push({ line: file, line_no: i + 1, reason: `溯源字段不齐：写了 ${got.join(',')}，缺 ${PROVENANCE.filter((k) => !got.includes(k)).join(',')}（要么都不写，要么写齐）` });
      } else if (got.length === 0) {
        provenance.push({ line: file, line_no: i + 1, url: String(o.url || '').slice(0, 60) });
        withoutProv++;
      } else {
        withProv++;   // 本行带齐三字段（供分片级混用判据计数）
      }
      entries.push({ line: normLine(o.line, base), shard: file,
        url: String(o.url || ''), title: String(o.title || ''), fetchedAt: String(o.fetchedAt || ''), summary: String(o.summary || ''),
        ...(got.length === PROVENANCE.length ? { tool: String(o.tool), engine: String(o.engine), query: String(o.query) } : {}) });
    });
    // v18.86.0-prep（F-14）：分片级混用 → problem（见本循环开头的判据注释）。
    if (withProv > 0 && withoutProv > 0) {
      problems.push({
        line: file, line_no: 0,
        reason: `分片内**混用**新旧格式：${withProv} 行带齐溯源（tool/engine/query）、${withoutProv} 行全缺——`
          + '同一分片是同轮检索产物，须**全带**或**全不带**（一旦开始写溯源字段就必须写全；'
          + '纯旧分片属兼容期、仅软提示）。修法：给缺的行补齐三字段，或整片回退旧格式。',
      });
    }
    shardRows.push({ file, line: base, exists: true, lines: n, bytes: statSync(f).size });
  }
  return { entries, problems, provenance, shards: shardRows, bom };
};

const { entries, problems, provenance, shards, bom } = readShards(project);

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
  // v18.78.0（反哺 F2）：**逐文件列出**（一条线可能有主分片 + 补检索分片），并把「哪些线一份分片都没有」
  //   如实说出——旧版 `for (const l of LINES)` 只认三份主分片，补检索分片的一行都不会出现。
  for (const s of shards) {
    console.log(`  ${s.file}${s.file === `${s.line}.jsonl` ? '' : `（线 ${s.line}·补检索段）`}: ${s.lines} 行 / ${s.bytes} B`);
  }
  for (const l of LINES) {
    if (!shards.some((s) => s.line === l)) console.log(`  ${l}: 分片不存在（该线尚未登记——不判错）`);
  }
  if (bom.length) console.log(`  ℹ ${bom.join('、')} 含 UTF-8 BOM（已剥除后解析）——机检硬格式要求无 BOM，请以 UTF-8 无 BOM 重写`);
  console.log(`  合计 ${entries.length} 行 → 去重后 ${byUrl.size} 个来源｜跨线重复 ${dup.length} 个（**可省的重复抓取数**）`);
  if (dup.length) for (const d of dup.slice(0, 5)) console.log(`    · ${d.url.slice(0, 70)} [${d.lines.join('+')}]`);
  if (problems.length) {
    console.error(`\n✗ ${problems.length} 条问题（含未识别分片）：`);
    for (const p of problems.slice(0, 10)) console.error(`  · ${fmtProblem(p)} — ${p.reason}`);
    if (problems.length > 10) console.error(`    · …另有 ${problems.length - 10} 条`);
    // v18.78.0（反哺 F1）：**不合格行必须给出合格形态的出处**——否则子代理以为自己写对了。
    if (problems.some((p) => /缺必填键|不是合法 JSON|url 不是/.test(p.reason))) schemaHint();
    process.exit(1);
  }
  console.log('\n✓ 全部分片行合法（空分片/缺分片不算问题——那是「该线尚未登记」）');
  // v18.62.7（反哺 §A22）：**溯源字段缺口只报软提示、不改退出码**——存量项目（旧格式行）不该因此翻红。
  if (provenance.length) {
    console.log(`\nℹ ${provenance.length}/${entries.length} 行**无溯源字段**（tool/engine/query）——旧格式行，可缺；`);
    console.log('  但**新写入的行必须写齐三字段**：否则「某条是不是用规定的检索源取的」在交付物里查不到（§A22/A19）。');
    for (const p of provenance.slice(0, 3)) console.log(`    · ${fmtProblem(p)} ${p.url}`);
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
    // v18.78.0（反哺 F2）：未识别分片是**整份文件级**缺口（其行一份都没读），故 verbatim 只对「行级」
    //   问题说「行」；文案按两类分述，避免把「整份文件没进索引」读成「少了几行」。
    const fileLevel = problems.filter((p) => !(p.line_no > 0));
    console.warn(`  ⚠ 有 ${problems.length} 条问题被跳过（先跑 --check 看明细）`);
    console.error(`\n✗ sources.json 已写出，但**不含上述有问题的来源**——索引不完整。`);
    if (fileLevel.length) console.error(`  （其中 ${fileLevel.length} 个是**整份分片文件未被识别**：${fileLevel.map((p) => p.line).join('、')}）`);
    for (const p of problems.slice(0, 10)) console.error(`  · ${fmtProblem(p)} — ${p.reason}`);
    if (problems.some((p) => /缺必填键|不是合法 JSON|url 不是/.test(p.reason))) schemaHint();
    console.error('→ 退出码 1（与 --check 同判据：有发现），请修正分片后重跑 --merge。');
    process.exit(1);
  }
  process.exit(0);
}

console.error(USAGE);
process.exit(10);
void readdirSync; void basename;
