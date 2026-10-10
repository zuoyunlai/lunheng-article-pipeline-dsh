// lib/panel.mjs — 论衡「运行面板」宿主半边（v18.90.0 · B 批）
//
// 干什么：把一个 `<工作区>/run/<项目>/` 的运行状态以**只读 JSON**暴露给浏览器半边（`lib/client.js`），
//   使其能在 DSH Web GUI 里实时显示「跑到哪了 / 各门给了什么判定 / 字数怎么走 / 最近落了什么产物」。
//
// 官方契约（**先查官方资料**，出处见 dsh-plugin-guide 的 official-docs）：
//   · 路由 = `ctx.webServer.register({ kind: 'prefix', path, handler })`
//     （`docs/subsystems/web-server.zh.md` §路由：`kind` 为 `exact|prefix`；handler **拥有完整响应生命周期**，
//      **可持有响应，例如 SSE** —— 本文件的 `/events` 就是这条明确允许的用法）。
//   · 路径围栏复用本包既有真源 `lib/run-path-fence.mjs`（`isSafeProjectArg` / `resolveProjectDir`），
//     **不另写一套判定**——本仓反复吃过「同一事实两处维护必然发散」的代价。
//
// 数据分层（**刻意不重复聚合**，避免与 `scripts/run-report.mjs` 口径分叉）：
//   · **数字层**（M 门汇总 / 字数 / 合规分 / Phase 表 / 轮次）= 只读 A 批产出的边车
//     `<项目>/final/运行报告.json`（由 `run-report.mjs --json` 写），并把它自己的 `generatedAt`
//     一并返回 —— 面板上每个数字都带「截至何时」，不冒充实时重算。
//   · **实时层**（本文件只做两处极廉价的解析）= `status.md` 的状态行 + `agents-log.md` 的 `### Tn`
//     段计数 + 目录 mtime/字节。**不做**汉字统计（那要 `_lib/han.mjs`，属随包脚本口径）。
//
// 安全边界（如实声明）：
//   · **只读**：不写任何文件、不起子进程、不读凭据、不联网。
//   · 路由挂在**同一个** Web 载体上（随 `ctx.webServer` 的监听地址，本机默认回环 `127.0.0.1`）；
//     它不额外监听端口，也不改变既有的连接信任策略。但**它是新的读面**：能访问该地址的人可读到
//     `<工作区>/run/**` 里已存在的运行产物（`status.md` / 门报告摘要 / 产物清单）——故**默认关闭**，
//     由 `config.panel`（部署开关）或 `LUNHENG_PANEL=1`（操作者开关）显式开启，见 `SECURITY.md`。
//   · 围栏：`root` 必须是**本进程已知的工作区根**（`ctx.workspaceRegistry.list()` + `process.cwd()`），
//     `project` 必须过 `isSafeProjectArg` + `resolveProjectDir` —— 两者任一不过即 403，**不返回任何内容**。
import { readFileSync, readdirSync, statSync, existsSync, watch, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { isSafeProjectArg, resolveProjectDir } from './run-path-fence.mjs';

// 插件自身位置推导出的**脚本绝对目录**（v18.92.0）：让面板给出的命令不依赖 cwd 与 PATH。
const LUNHENG_SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'lunheng-article-pipeline', 'scripts');
export const PANEL_ROUTE = '/lunheng-panel';
/** 事件流心跳间隔（毫秒）——与主人裁定的「fs.watch 事件驱动 + 5s 兜底轮询」同源。 */
export const PANEL_HEARTBEAT_MS = 5000;
/** 单文件下载上限（v18.93.0）：超过即 413——避免一次请求把巨物拉进内存/浏览器。 */
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;

/** 读取本包版本（与入口同源，避免两处维护）。 */
/** 本**已加载**模块的版本（v18.91.1）。为什么在 import 时就定下来：`packageVersion()` 是**每次调用都读磁盘**——
 *  于是「装上新版但进程还是旧代码」时，`/ping` 会报出新版本号，**版本号会撒谎**（实测踩过：
 *  面板显示「宿主 v18.91.0」而运行的是 18.90.8 的代码，排查多花一轮）。故这里烘焙「加载时版本」，
 *  另在 `/ping` 暴露 `onDiskVersion` 供对照：**两者不一致 = 需要重启**。 */
const LOADED_VERSION = packageVersion();

function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    return typeof pkg?.version === 'string' ? pkg.version : 'unknown';
  } catch { return 'unknown'; }
}

// ── 工作区根：官方 workspace registry 优先，`process.cwd()` 兜底 ──────────────
/**
 * 列出可用于面板的工作区根目录（**只列本进程已知的**，绝不接受调用方给的任意绝对路径）。
 * @param ctx - Cordis context（`workspaceRegistry` 是可选服务）。
 * @returns 去重后的绝对路径数组（可能为空）。
 */
export function panelRoots(ctx) {
  const out = [];
  try {
    const list = peekService(ctx, 'workspaceRegistry')?.list?.();
    if (Array.isArray(list)) {
      for (const w of list) if (typeof w?.path === 'string' && w.path) out.push(w.path);
    }
  } catch { /* registry 不可用 → 落到下面的 cwd 兜底（不抛，面板仍可服务于单工作区场景） */ }
  // **只在 registry 一个根都给不出时**才兜底到 `process.cwd()`：registry 是工作区路径的权威来源，
  //   而 cwd 是宿主进程目录（桌面版多为安装目录）——无条件并入等于凭空多暴露一个读面。
  if (out.length === 0) { try { out.push(process.cwd()); } catch { /* ignore */ } }
  return [...new Set(out)];
}

// ── 实时层：极廉价解析（两处正则 + 目录 mtime）─────────────────────────────
function readText(p) {
  try { return readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return null; }
}
function fmtAge(ms) {
  if (!Number.isFinite(ms)) return null;
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
}
/** 最近改动的一批文件（产物活动的最直接信号）。 */
function recentFiles(dir, limit = 8, depth = 2) {
  const rows = [];
  const walk = (d, rel, level) => {
    let names; try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const p = join(d, n);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (level < depth && n !== 'archive' && n !== 'node_modules') walk(p, rel ? `${rel}/${n}` : n, level + 1); }
      else rows.push({ rel: rel ? `${rel}/${n}` : n, bytes: st.size, mtime: st.mtimeMs, age: fmtAge(st.mtimeMs) });
    }
  };
  walk(dir, '', 0);
  return rows.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

/**
 * 一个项目的**轻快照**：实时层（本文件解析）+ 数字层（A 批边车，若存在）。
 * @param root - 工作区根（已由调用方校验）。
 * @param project - 项目名（已由调用方校验）。
 * @returns 快照对象；项目目录不存在则返回 `null`。
 */
export function lightSnapshot(root, project) {
  const runDir = join(root, 'run');
  const dir = resolveProjectDir(runDir, project);
  if (!dir || !existsSync(dir)) return null;
  const status = readText(join(dir, 'status.md'));
  const phaseLine = status ? (/- .*?\*\*[^*]+\*\*\s*—\s*([^\n]+)/.exec(status)?.[1]?.replace(/\*\*/g, '').trim() ?? null) : null;
  const started = status ? (/\*\*启动时间\*\*[：:]\s*([^\n]+)/.exec(status)?.[1]?.trim() ?? null) : null;
  const log = readText(join(dir, 'agents-log.md'));
  const roles = new Map();
  if (log) for (const m of log.matchAll(/^###\s*(T\d+[^\n]*)$/gm)) {
    const k = (/T\d+/.exec(m[1]) || ['?'])[0];
    roles.set(k, (roles.get(k) || 0) + 1);
  }
  const sidecarPath = join(dir, 'final', '运行报告.json');
  let report = null;
  const sidecarText = readText(sidecarPath);
  if (sidecarText) {
    try {
      const j = JSON.parse(sidecarText);
      report = {
        generatedAt: j?.generatedAt ?? null,
        score: j?.scoring?.score ?? null,
        coverage: j?.scoring?.coverage ?? null,
        mGate: j?.mGate?.summary ?? null,
        words: Array.isArray(j?.words?.series) ? j.words.series.map((s) => ({ label: s.label, han: s.han })) : [],
        rounds: Array.isArray(j?.rounds) ? j.rounds.length : null,
        gates: Array.isArray(j?.gates) ? j.gates.length : null,
        // v18.92.0：把「准出门 24 项明细 / 合规分 8 分量 / QLT-6 论证强度」带出来——全部是边车既有字段，
        //   面板只做展示、不重算任何口径。
        gateItems: Array.isArray(j?.mGate?.results)
          ? j.mGate.results.map((x) => ({ id: x?.id ?? null, gate: x?.gate ?? null, severity: x?.severity ?? null }))
          : [],
        scoreComponents: Array.isArray(j?.scoring?.components)
          ? j.scoring.components.map((c) => ({ id: c?.id ?? null, name: c?.name ?? null, weight: c?.weight ?? null, ratio: c?.ratio ?? null, applicable: c?.applicable !== false, note: c?.note ?? '' }))
          : [],
        qlt6: j?.scoring?.qlt6
          ? {
            score: j.scoring.qlt6.score ?? null,
            coverage: j.scoring.qlt6.coverage ?? null,
            coverageWarning: j.scoring.qlt6.coverageWarning ?? null,
            na: Array.isArray(j.scoring.qlt6.na) ? j.scoring.qlt6.na.map((n) => ({ id: n?.id ?? null, weight: n?.weight ?? null, reason: n?.reason ?? null })) : [],
            components: Array.isArray(j.scoring.qlt6.components)
              ? j.scoring.qlt6.components.map((c) => ({ id: c?.id ?? null, name: c?.name ?? null, weight: c?.weight ?? null, ratio: c?.ratio ?? null, applicable: c?.applicable !== false }))
              : [],
          }
          : null,
      };
    } catch { report = { broken: true }; }
  }
  // Token 消耗（v18.91.1）：**不自己算**——读 `final/token-cost.json`，那份由权威脚本 `token-cost.mjs`
  //   产出（它读 DSH 会话投影缓存的 `tokenUsage.totals`，并给出估算成本与单价）。面板只做展示，
  //   于是「口径唯一」且**读面不出 `run/<项目>`**（SEGURITY 已登记该文件）。
  let tokens = null;
  const tokPath = join(dir, 'final', 'token-cost.json');
  const tokText = readText(tokPath);
  if (tokText) {
    try {
      const t = JSON.parse(tokText);
      const k = t?.tokens ?? {};
      tokens = {
        total: k.total ?? null,
        uncachedInput: k.uncachedInput ?? null,
        cacheRead: k.cacheRead ?? null,
        cacheWrite: k.cacheWrite ?? null,
        output: k.output ?? null,
        costUsd: typeof t?.costEstimateUsd === 'number' ? t.costEstimateUsd : null,
        sessions: t?.sessionCount ?? null,
        matched: t?.matchedSessionCount ?? null,
        prices: t?.pricesPerMillion ?? null,
        note: typeof t?.note === 'string' ? t.note.slice(0, 300) : null,
        at: existsSync(tokPath) ? statSync(tokPath).mtimeMs : null,
      };
    } catch { tokens = { broken: true }; }
  }
  return {
    project,
    dir,
    at: new Date().toISOString(),
    status: { phaseLine, started, hasStatus: status !== null },
    agents: { roles: [...roles.entries()].map(([role, count]) => ({ role, count })), logAge: fmtAge(existsSync(join(dir, 'agents-log.md')) ? statSync(join(dir, 'agents-log.md')).mtimeMs : NaN) },
    artifacts: {
      newest: recentFiles(dir),
      hasFinal: existsSync(join(dir, 'final', '定稿.md')),
      hasEvidence: existsSync(join(dir, 'final', '证据包', 'manifest.json')),
      drafts: readdirSyncSafe(join(dir, 'drafts')).filter((f) => /^初稿-v\d+\.md$/.test(f)).length,
      audits: readdirSyncSafe(join(dir, 'audits')).length,
    },
    report,
    tokens,   // v18.91.1：来自 final/token-cost.json（权威脚本产出，面板只展示不算）
    insights: collectInsights(dir, status),   // v18.91.0：图表用派生数据（全部读自本目录既有文件）
  };
}

/**
 * 派生「insights」数据（v18.91.0）——面板从「文字表」升级为图形面板所需的全部原料都在这算。
 *
 * **边界与整条路由同一条围栏**：只读 `run/<项目>/` 内**已存在**的文件；不写、不 spawn、不联网。
 *   · `meta`：题名 / 文类 / 目标篇幅 / 纠偏线 / G8 硬阈（来自 `status.md` 既有字段，图上要画目标线）；
 *   · `phases`：当前阶段 + 已闭合阶段（同一行文本），渲染成阶段进度；
 *   · `dirs`：九宫格产物分布（文件数 / 字节），回答「功夫花在哪」；
 *   · `activity`：近 48h、每 2h 一格的文件改动次数（来自 mtime），回答「还在动吗」；
 *   · `failures` / `handoffs`：失败记录与收报回执计数，回答「顺不顺」；
 *   · `drafts`：草稿体积序列（**字节**，非正文字数——汉字数有既有脚本口径，面板不自行重算）。
 * **不做**：任何内容判定，任何口径重算。
 */
function collectInsights(dir, status, project = basename(dir)) {
  const out = { meta: null, phases: null, dirs: [], activity: [], failures: 0, handoffs: { ok: 0, retry: 0 }, drafts: [] };
  try {
    if (status) {
      const title = /\*\*题名\*\*[：:]\s*([^\n（(]+)/.exec(status)?.[1]?.trim() ?? null;
      const genre = /\*\*文类\*\*[：:]\s*`?([A-Za-z-]+)`?/.exec(status)?.[1]?.trim() ?? null;
      const target = Number(/\*\*目标篇幅\*\*[：:]\s*(\d+)\s*字/.exec(status)?.[1] ?? NaN);
      const cal = /纠偏线\s*(\d+)\s*[–~-]\s*(\d+)/.exec(status);
      const hard = /硬阈\s*(\d+)\s*[–~-]\s*(\d+)/.exec(status);
      out.meta = {
        title,
        genre,
        targetWords: Number.isFinite(target) ? target : null,
        calibrate: cal ? [Number(cal[1]), Number(cal[2])] : null,
        hard: hard ? [Number(hard[1]), Number(hard[2])] : null,
      };
      const cur = /Phase\s*([\d.]+)/.exec(status)?.[1] ?? null;
      const closedBlock = /Phase\s([\d./\s]+)全部\s*✅/.exec(status)?.[1] ?? '';
      const closed = (closedBlock.match(/[\d.]+/g) || []).map(Number);
      out.phases = { current: cur === null ? null : Number(cur), closed: [...new Set(closed)].sort((a, b) => a - b) };
      out.failures = (status.match(/\[Failed/g) || []).length;
      out.handoffs = { ok: (status.match(/exit\s*22/g) || []).length, retry: (status.match(/exit\s*(?:20|21)/g) || []).length };
    }
    const specs = [['literature', 'literature'], ['data', 'data'], ['cases', 'cases'], ['analysis', 'analysis'], ['drafts', 'drafts'], ['audits', 'audits'], ['final', 'final'], ['final/图件', 'final/图件'], ['final/证据包', 'final/证据包']];
    const mtimes = [];
    for (const [label, rel] of specs) {
      const p = join(dir, ...rel.split('/'));
      let files = 0;
      let bytes = 0;
      if (existsSync(p)) {
        const walk = (d, depth) => {
          if (depth > 4 || files > 3000) return;
          for (const e of readdirSyncSafe(d)) {
            const full = join(d, e);
            try {
              const st = statSync(full);
              if (st.isDirectory()) walk(full, depth + 1);
              else { files += 1; bytes += st.size; mtimes.push(st.mtimeMs); }
            } catch { /* 单条不可读就跳过 */ }
          }
        };
        walk(p, 0);
      }
      out.dirs.push({ name: label, files, kb: Math.round(bytes / 1024) });
    }
    const now = Date.now();
    const stepMs = 2 * 3600 * 1000;
    const buckets = new Array(24).fill(0);
    for (const t of mtimes) {
      const age = now - t;
      if (age < 0 || age >= stepMs * 24) continue;
      buckets[23 - Math.floor(age / stepMs)] += 1;
    }
    out.activity = buckets;
    // 活动图的**坐标轴与统计**（v18.91.1）：把这些算在宿主侧而不是客户端，保证图与数来自同一份事实。
    out.activityMeta = {
      bucketMs: stepMs,
      from: now - stepMs * 24,
      to: now,
      peak: Math.max.apply(null, buckets.concat([0])),
      total: buckets.reduce((a, b) => a + b, 0),
      activeBuckets: buckets.filter((v) => v > 0).length,
      scanned: mtimes.length,
      windowHours: 48,
    };
    // 「实际工作时长」（v18.91.1）：**人在环等待不算**。把本目录所有文件 mtime 排序后**会话化**——
    //   相邻两次改动间隔 ≤15 分钟视为同一工作段，累加段内跨度；同时给出「总跨度」以便对照。
    //   这是**启发式**（基于文件改动节奏），图注必须写明算法与阈值，绝不称其为精确工时统计。
    const gapMs = 15 * 60 * 1000;
    const sorted = mtimes.slice().sort((a, b) => a - b);
    let activeMs = 0;
    let segs = 0;
    let segStart = null;
    let prevT = null;
    const segList = [];
    for (const t of sorted) {
      if (prevT === null || t - prevT > gapMs) {
        if (segStart !== null) { activeMs += prevT - segStart; segs += 1; segList.push({ start: segStart, end: prevT }); }
        segStart = t;
      }
      prevT = t;
    }
    if (segStart !== null) { activeMs += prevT - segStart; segs += 1; segList.push({ start: segStart, end: prevT }); }
    out.active = {
      ms: activeMs,
      spanMs: sorted.length ? sorted[sorted.length - 1] - sorted[0] : 0,
      segs,
      gapMinutes: gapMs / 60000,
      files: sorted.length,
      // 工作段的**起止时间**（活动图把它画成背景色带——「机器在干活的时间」一眼可见）
      segments: segList.slice(-30).map((s) => ({ start: s.start, end: s.end })),
    };
    const draftsDir = join(dir, 'drafts');
    out.drafts = readdirSyncSafe(draftsDir)
      .filter((f) => /\.md$/.test(f))
      .map((f) => {
        try {
          const st = statSync(join(draftsDir, f));
          // 分类只为把两类曲线区分开：初稿（正文版本）vs 修订说明/轮次账本（过程件）——文件名即可判，不猜内容。
          const kind = /^初稿-v\d+/.test(f) ? 'draft' : /^修订说明/.test(f) ? 'revision' : 'other';
          return { name: f.replace(/\.md$/, ''), kb: Math.round(st.size / 102.4) / 10, mtime: st.mtimeMs, kind };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => a.mtime - b.mtime)
      .slice(-16);
    // 证据密度（v18.92.0）：逐章节统计 `[Lxx]/[Dxx]/[Cxx]` **标记数**——只数标记，**不做引用质量判断**。
    const draftName = readdirSyncSafe(join(dir, 'drafts')).filter((f) => /^初稿-v\d+\.md$/.test(f)).sort().pop();
    if (draftName) {
      const dt = readText(join(dir, 'drafts', draftName)) ?? '';
      const heads = [...dt.matchAll(/^##\s+(.+)$/gm)];
      const secs = [];
      for (let i = 0; i < heads.length; i += 1) {
        const body = dt.slice(heads[i].index + heads[i][0].length, i + 1 < heads.length ? heads[i + 1].index : dt.length);
        const cnt = (re) => (body.match(re) || []).length;
        secs.push({ title: heads[i][1].trim().slice(0, 36), L: cnt(/\[L\d+\]/g), D: cnt(/\[D\d+\]/g), C: cnt(/\[C\d+\]/g) });
      }
      out.evidence = {
        draft: draftName,
        sections: secs,
        totals: secs.reduce((a, s) => ({ L: a.L + s.L, D: a.D + s.D, C: a.C + s.C }), { L: 0, D: 0, C: 0 }),
      };
    }
    // 审稿雷达（v18.92.0）：从**最新的整合报告**里解析「三视角 × 各自 5 维」表；如实标注这是**子报告口径**
    //   （不是统一 6 维——那三份子报告各自的维度名不同，整合报告自己也写明 6 维求和是整合员产物）。
    const intRep = readdirSyncSafe(join(dir, 'audits')).filter((f) => /^审稿整合报告-v\d+\.md$/.test(f)).sort().pop();
    if (intRep) {
      const rt = readText(join(dir, 'audits', intRep)) ?? '';
      const views = [];
      for (const m of rt.matchAll(/^\|\s*\*\*(T9-[a-z][^*]*)\*\*\s*\|[^|]*\|\s*([^|]+)\|\s*\*\*(\d+)\s*\/\s*(\d+)\*\*\s*\|([^|]*)\|/gm)) {
        const dims = m[2].split('/').map((p) => p.replace(/\*\*/g, '').trim()).filter(Boolean).map((p) => {
          const mm = /^(.+?)\s*(\d+(?:\.\d+)?)$/.exec(p);
          return mm ? { name: mm[1].trim(), score: Number(mm[2]) } : null;
        }).filter(Boolean);
        if (dims.length) views.push({ view: m[1].trim(), dims, total: Number(m[3]), max: Number(m[4]), verdict: (m[5] || '').trim() });
      }
      if (views.length) out.review = { report: intRep, views };
    }
    // 交付件与图件（v18.93.0）：**只列、只读**——写作者最关心「东西在哪、能不能拿走」，故放在面板靠前位置。
    //   三个分组：图件（`final/图件`）/ 交付件（定稿 · 交付说明 · 门报告 · 证据包清单 · 运行报告）/ 过程件（目录计数 + 最新几个）。
    const fin = join(dir, 'final');
    const stat1 = (p) => { try { const st = statSync(p); return { kb: Math.round(st.size / 102.4) / 10, mtime: st.mtimeMs }; } catch { return null; } };
    const figures = readdirSyncSafe(join(fin, '图件'))
      .filter((f) => /\.(svg|png|jpg|jpeg)$/i.test(f))
      .map((f) => { const s = stat1(join(fin, '图件', f)); return s ? { name: f, kb: s.kb, mtime: s.mtime, rel: 'final/图件/' + f } : null; })
      .filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    const wanted = [
      ['final/定稿.md', '定稿（Markdown 主交付）'],
      ['final/交付说明.md', '交付说明'],
      ['final/M-Gate-Report.json', 'M 门报告（机读）'],
      ['final/证据包/manifest.json', '证据包清单'],
      ['final/运行报告.html', '图表运行报告（HTML）'],
      ['final/运行报告.json', '运行报告边车（JSON）'],
      ['final/token-cost.json', 'Token 成本（权威脚本产出）'],
    ];
    const finalFiles = wanted.map(([rel, label]) => {
      const s = stat1(join(dir, ...rel.split('/')));
      return s ? { rel, label, kb: s.kb, mtime: s.mtime } : null;
    }).filter(Boolean);
    const procSpecs = [['literature', '素材·文献'], ['data', '素材·数据'], ['cases', '素材·案例'], ['analysis', '分析'], ['drafts', '草稿'], ['audits', '审计与记录'], ['final/证据包', '证据包']];
    const processGroups = procSpecs.map(([rel, label]) => {
      const p = join(dir, ...rel.split('/'));
      let n = 0;
      let newest = null;
      for (const e of readdirSyncSafe(p)) {
        const s = stat1(join(p, e));
        if (!s) continue;
        n += 1;
        if (!newest || s.mtime > newest.mtime) newest = { name: e, mtime: s.mtime, kb: s.kb };
      }
      return { rel, label, count: n, newest };
    });
    // 跨项目对比（v18.94.0）：同一**工作区根**下各项目边车的摘要，供面板画横向对比。
    //   边界：只读各项目 `final/运行报告.json` 的几个小字段、**最多 200 个项目**；读不到/解析失败即跳过，
    //   绝不因此让快照失败。比较的是**合规分代理（QLT-1）**，不代表质量——卡片上必须写明。
    try {
      const runDir = dirname(dir);          // <root>/run/<project> → <root>/run
      const projRoot = dirname(runDir);     // <root>
      const items = [];
      for (const nm of readdirSyncSafe(runDir).slice(0, 200)) {
        const side = readText(join(runDir, nm, 'final', '运行报告.json'));
        if (!side) continue;
        try {
          const o = JSON.parse(side);
          const mg = o?.mGate?.summary || null;
          if (!mg) continue;
          items.push({
            name: nm,
            pass: typeof mg.pass === 'number' ? mg.pass : null,
            total: typeof mg.total === 'number' ? mg.total : null,
            p0: typeof mg.p0 === 'number' ? mg.p0 : null,
            score: typeof o?.scoring?.score === 'number' ? o.scoring.score : null,
            words: Array.isArray(o?.words?.series) ? o.words.series.length : 0,
            at: typeof o?.generatedAt === 'string' ? o.generatedAt : null,
          });
        } catch { /* 单个项目坏边车不影响整体 */ }
      }
      items.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || String(a.name).localeCompare(String(b.name)));
      out.compare = { root: projRoot, scanned: items.length, items: items.slice(0, 12), self: project };
    } catch { /* 聚合失败 → 卡片显示空态 */ }
    out.deliverables = { figures, finalFiles, process: processGroups };
    // v18.92.0：命令**可直接粘贴执行**——用运行时 node 的绝对路径 + 脚本绝对路径 + 项目绝对目录，
    //   不依赖 PATH（桌面版可能没装 Node）、也不依赖 cwd（面板不知道用户在哪个目录）。
    const nodeExe = process.execPath;
    const projDir = join(dir, 'final');
    out.exportCmds = [
      { format: 'HTML', cmd: '"' + nodeExe + '" "' + join(LUNHENG_SCRIPTS_DIR, 'md2html.mjs') + '" "' + join(projDir, '定稿.md') + '" "' + join(projDir, '定稿.html') + '" --fig-dir "' + join(projDir, '图件') + '"', note: '仓内转换器，无需外部工具' },
      { format: 'Word', cmd: 'pandoc "' + join(projDir, '定稿.md') + '" -o "' + join(projDir, '定稿.docx') + '"', note: '需 pandoc（需另装）' },
      { format: 'PDF', cmd: 'pandoc "' + join(projDir, '定稿.md') + '" -o "' + join(projDir, '定稿.pdf') + '" --pdf-engine=xelatex -V CJKmainfont="Microsoft YaHei"', note: '需 pandoc + XeLaTeX + 中文字体（需另装）' },
      { format: 'LaTeX', cmd: 'pandoc "' + join(projDir, '定稿.md') + '" -o "' + join(projDir, '定稿.tex') + '" --standalone', note: '需另装 pandoc' },
    ];
    // 面板给出的**本机可执行**入口（客户端据此拼空态命令；同样绝对路径）
    out.exec = {
      node: nodeExe,
      scriptsDir: LUNHENG_SCRIPTS_DIR,
      runReport: '"' + nodeExe + '" "' + join(LUNHENG_SCRIPTS_DIR, 'run-report.mjs') + '"',
      tokenCost: '"' + nodeExe + '" "' + join(LUNHENG_SCRIPTS_DIR, 'token-cost.mjs') + '"',
    };
  } catch (e) { out.derivedError = String(e && e.message ? e.message : e).slice(0, 160); /* 派生失败 → 图形区留空，但**必须留痕**，否则"字段莫名消失"无从排查 */ }
  return out;
}
function readdirSyncSafe(p) { try { return readdirSync(p); } catch { return []; } }

/** 列出一个工作区根下 `run/*` 的项目（只给面板做选择器用）。 */
export function listProjects(root) {
  const runDir = join(root, 'run');
  const out = [];
  for (const name of readdirSyncSafe(runDir)) {
    const dir = join(runDir, name);
    let st; try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (!isSafeProjectArg(name)) continue;
    if (!existsSync(join(dir, 'status.md'))) continue;
    out.push({ name, mtime: st.mtimeMs, age: fmtAge(st.mtimeMs), hasFinal: existsSync(join(dir, 'final', '定稿.md')) });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ── HTTP 面 ──────────────────────────────────────────────────────────────
function sendJson(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}
function sendText(res, code, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(text);
}
/** 校验 `root`（必须是本进程已知工作区根）与 `project`（必须过项目名围栏）。 */
function resolveTarget(ctx, url) {
  const roots = panelRoots(ctx);
  const wantRoot = url.searchParams.get('root');
  const root = wantRoot ? roots.find((r) => samePath(r, wantRoot)) : roots[0];
  if (!root) return { error: [403, { error: 'root 不在本进程已知的工作区根之内' }] };
  const project = url.searchParams.get('project');
  if (!project) return { root };
  if (!isSafeProjectArg(project)) return { error: [403, { error: 'project 名不合法（只接受单个路径段）' }] };
  const dir = resolveProjectDir(join(root, 'run'), project);
  if (!dir) return { error: [403, { error: 'project 解析后越出 run/ 之外' }] };
  return { root, project, dir };
}
function samePath(a, b) {
  const n = (p) => { try { return statSync(p) && (process.platform === 'win32' ? String(p).toLowerCase() : String(p)); } catch { return null; } };
  return n(a) !== null && n(a) === n(b);
}

/**
 * 处理一条面板请求（导出供单测直接调用，无需真起 HTTP）。
 * @param ctx - Cordis context。
 * @param req - `http.IncomingMessage`。
 * @param res - `http.ServerResponse`。
 * @returns `true` 表示本路由已认领该请求。
 */
export function handlePanelRequest(ctx, req, res) {
  let url; try { url = new URL(req.url, 'http://127.0.0.1'); } catch { sendText(res, 400, 'bad url'); return true; }
  if (!url.pathname.startsWith(PANEL_ROUTE)) return false;
  const rest = url.pathname.slice(PANEL_ROUTE.length);
  if (req.method === 'OPTIONS') { res.writeHead(204, { allow: 'GET, HEAD' }); res.end(); return true; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { error: '只接受 GET/HEAD（本路由是只读面）' }); return true; }
  if (rest === '/ping') { sendJson(res, 200, { ok: true, version: LOADED_VERSION, onDiskVersion: packageVersion(), roots: panelRoots(ctx), heartbeatMs: PANEL_HEARTBEAT_MS }); return true; }
  if (rest === '/file') {
    // v18.93.0：**只读下载**（把项目内已存在的产物字节发出去）——同一道围栏 + 路径规范化二次确认。
    //   设计边界（务必保持）：只 GET、只读、不写盘、不起子进程、不联网；`rel` 必须是**项目内相对路径**，
    //   禁绝对路径 / 反斜杠 / 空段 / `..`；解析后必须仍在项目目录内。见 SECURITY.md §运行面板。
    const t = resolveTarget(ctx, url);
    if (t.error) { sendJson(res, t.error[0], t.error[1]); return true; }
    const rel = url.searchParams.get('rel') || '';
    const bad = !rel || rel.startsWith('/') || rel.includes('\\') || rel.split('/').some((seg) => seg === '..' || seg === '');
    if (bad) { sendJson(res, 403, { error: 'rel 不合法（须为项目内相对路径：禁绝对路径 / 反斜杠 / 空段 / ..）' }); return true; }
    const abs = join(t.dir, ...rel.split('/'));
    if (!abs.startsWith(t.dir)) { sendJson(res, 403, { error: 'rel 解析后越出项目目录' }); return true; }
    let st = null;
    try { st = statSync(abs); } catch { sendJson(res, 404, { error: '文件不存在' }); return true; }
    if (!st.isFile()) { sendJson(res, 403, { error: '不是一个文件' }); return true; }
    const type = /\.html?$/i.test(abs) ? 'text/html; charset=utf-8'
      : /\.json$/i.test(abs) ? 'application/json; charset=utf-8'
        : /\.svg$/i.test(abs) ? 'image/svg+xml'
          : /\.png$/i.test(abs) ? 'image/png'
            : /\.jpe?g$/i.test(abs) ? 'image/jpeg'
              : /\.md$/i.test(abs) ? 'text/markdown; charset=utf-8'
                : 'application/octet-stream';
    // 整块读取 + 大小上限（不是流式）：这些产物本来就小（数十 KB 级），而**可测**更重要——
    //   用 `res.end(buf)` 能被单测的桩响应直接验，不必给桩造 Writable 流。
    if (st.size > MAX_DOWNLOAD_BYTES) { sendJson(res, 413, { error: '文件超过下载上限（' + MAX_DOWNLOAD_BYTES + ' 字节）' }); return true; }
    const buf = readFileSync(abs);
    res.writeHead(200, {
      'content-type': type,
      'content-length': st.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(basename(abs)),
    });
    res.end(buf);
    return true;
  }
  if (rest === '/projects') {
    const t = resolveTarget(ctx, url);
    if (t.error) { sendJson(res, t.error[0], t.error[1]); return true; }
    sendJson(res, 200, { root: t.root, projects: listProjects(t.root) });
    return true;
  }
  if (rest === '/snapshot') {
    const t = resolveTarget(ctx, url);
    if (t.error) { sendJson(res, t.error[0], t.error[1]); return true; }
    if (!t.project) { sendJson(res, 400, { error: '缺 project 参数' }); return true; }
    const snap = lightSnapshot(t.root, t.project);
    if (!snap) { sendJson(res, 404, { error: `项目不存在或不可读：${t.project}` }); return true; }
    sendJson(res, 200, snap);
    return true;
  }
  if (rest === '/events') return handleEvents(ctx, url, req, res);
  sendJson(res, 404, { error: `未知端点：${rest}（可用：/ping /projects /snapshot /events）` });
  return true;
}

/**
 * SSE：首帧给一次完整快照 → 项目目录 `fs.watch` 命中即推（300 ms 去抖）→ 5 s 心跳兜底。
 * 与主人裁定「fs.watch 事件驱动 + 5s 兜底轮询」逐字对应。
 */
function handleEvents(ctx, url, req, res) {
  const t = resolveTarget(ctx, url);
  if (t.error) { sendJson(res, t.error[0], t.error[1]); return true; }
  if (!t.project) { sendJson(res, 400, { error: '缺 project 参数' }); return true; }
  const snap = lightSnapshot(t.root, t.project);
  if (!snap) { sendJson(res, 404, { error: `项目不存在或不可读：${t.project}` }); return true; }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const push = () => {
    const s = lightSnapshot(t.root, t.project);
    if (s) res.write(`event: snapshot\ndata: ${JSON.stringify(s)}\n\n`);
  };
  res.write(`retry: ${PANEL_HEARTBEAT_MS}\n\n`);
  push();
  let watcher = null;
  let timer = null;
  const close = () => {
    if (watcher) { try { watcher.close(); } catch { /* already closed */ } watcher = null; }
    if (timer) { clearInterval(timer); timer = null; }
  };
  try {
    let pending = null;
    watcher = watch(t.dir, { recursive: true }, () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(push, 300);   // 去抖：一次写盘常触发多事件
    });
    watcher.on?.('error', () => { /* 目录被删/权限变化 → 交给心跳兜底，不中断流 */ });
  } catch { /* watch 不可用（平台/权限）→ 只有心跳，如实降级 */ }
  timer = setInterval(() => { res.write(': ping\n\n'); push(); }, PANEL_HEARTBEAT_MS);
  req.on('close', close);
  req.on('error', close);
  return true;
}

/**
 * 面板状态诊断（v18.90.1 新增；v18.90.3 改为**两处落盘 + 全包 try**）。
 *
 * 为什么需要（**来自真实的盲区**）：v18.90.0 在真实宿主上「入口 active、工具齐全、浏览器半边也挂上了，
 *   但路由就是 404」，而宿主的 `ctx.logger` 输出在桌面版**不落盘**——`say()` 说的那句话没人看得到，
 *   于是只能靠猜（实测连猜三轮才闭环）。状态文件是**唯一一个我能直接读到**的证据通道。
 * v18.90.3 加固：同时写 `os.tmpdir()` 与 `$DSH_HOME`（若存在）——单一落点若因宿主进程的 temp
 *   解析差异读不到就白写；并且把**整个函数体**包进 try，绝不允许它自己抛错。
 * 披露：只写开关状态 / 版本 / 服务与注册结果 / 错误原文 / 工作区根名——**不含任何项目内容**。
 */
export function writePanelStatus(patch) {
  try {
    const at = new Date().toISOString()
    const pid = process.pid
    const version = packageVersion()
    const homes = [tmpdir()]
    if (process.env.DSH_HOME) homes.push(process.env.DSH_HOME)
    for (const dir of homes) {
      const file = join(dir, 'lunheng-panel-status.json')
      let prev = {}
      try { prev = JSON.parse(readFileSync(file, 'utf8')) || {} } catch { prev = {} }
      // v18.90.6：**追加式步骤历史**——单值 `stage` 会被后续写入覆盖（实测踩过：`apply-skill` 把
      //   `registerPanel` 的判定盖掉，导致「到底走了哪一支」无从判断）。`steps` 保留全轨迹，封顶 30 步。
      const steps = Array.isArray(prev.steps) ? prev.steps.slice(-29) : []
      if (patch && patch.stage) {
        steps.push({ at, stage: patch.stage, ...(patch.error ? { error: String(patch.error).slice(0, 200) } : {}) })
      }
      try { writeFileSync(file, JSON.stringify({ ...prev, ...patch, steps, at, pid, version, where: dir }, null, 2), 'utf8') } catch { /* 该落点不可写则继续下一个 */ }
    }
  } catch { /* 诊断失败绝不阻断主流程 */ }
}

/** 本文件内部沿用旧名（v18.90.1 起叫 writeStatus）。 */
const writeStatus = writePanelStatus

/**
 * 安全读一个**可选服务**（v18.90.6 关键修复）。
 *
 * 本 Cordis 版本对「未在 `inject` 声明里列出的服务」**直接用 `ctx.<name>` 读会抛**
 * `cannot get property "webServer" without inject`（隔离宿主实测原文）。本项目面板从 18.90.0 到
 * 18.90.5 之所以**每一版都挂不上**，根因就是 `registerPanel` 第一行 `ctx?.webServer?.register`
 * ——它在 `inject = ['skills']` 的插件里必抛，于是「注册」这件事连第一句都跑不到。
 * 故：**一律走 `ctx.get(name)` 并包 try**；拿不到返回 `undefined`，绝不裸读。
 */
function peekService(ctx, name) {
  try {
    if (typeof ctx?.get === 'function') {
      const s = ctx.get(name);
      if (s) return s;
    }
  } catch { /* `get` 在严格宿主上也可能抛——继续走下面的兜底 */ }
  // 兜底：最小 ctx / 测试替身可能没有 `get`（真实 Cordis context 必有）。真实宿主里「未声明即裸读」
  //   会抛 `cannot get property "…" without inject`——这里**包了 try**，故只会拿到 undefined，
  //   绝不会把异常带出调用方（18.90.0–18.90.5 四版全挂，就是因为缺这层保护）。
  try { return ctx?.[name] ?? undefined } catch { return undefined; }
}

/**
 * 注册面板路由。
 *
 * v18.90.1 **关键修复**：旧版一次性读 `ctx.webServer`，读不到就「如实跳过」——
 *   而真实宿主上那次读取发生在插件 `apply` 的**异步尾段**（前面还 await 了好几个动态 import），
 *   此时服务可能尚未就绪、或该 fiber 在配置重载中已被处置 ⇒ `ctx.get('webServer')` 为 undefined
 *   ⇒ **路由永远不注册**（实测：同 host 上另一插件的路由 200，本插件 404；工具与浏览器半边都正常）。
 *   现改为 `ctx.inject(['webServer'], cb)`：**等这个服务可用再注册**（服务迟到也接得住；
 *   fiber 被处置时回调不会执行，不会泄漏到死上下文）。仍然不把 `webServer` 写成硬依赖——
 *   headless / 无 Web 组合下插件照常工作，只是没有面板。
 *
 * @param ctx - Cordis context。
 * @param cfg - 已解析的插件配置（用 `cfg.panel`）。
 * @param say - 入口的播报函数 `(level, text) => void`。
 * @returns 处置器（注销路由与等待）或 `null`（未启用）。
 */
export function registerPanel(ctx, cfg, say = () => {}) {
  // v18.93.0：**缺省即开**——不仅 schema 的 `def: true`，函数层也对「没写这个键」按开启处理
  //   （否则直接调用 registerPanel 的宿主/测试会与 schema 默认值不一致，又回到「两处默认」的老毛病）。
  const cfgPanel = cfg?.panel === undefined ? true : cfg?.panel === true;
  const raw = process.env.LUNHENG_PANEL;
    // v18.93.0：默认开（主人裁定）。env 显式值优先于 config，且 **`0`/`false` 能强制关闭**——
    //   这是「默认开」不至于无法收回的那道阀门。
    const envOff = raw === '0' || raw === 'false';
    const envFlag = raw === '1' || raw === 'true';
  const enabled = envOff ? false : (cfgPanel || envFlag);
  // ⚠️ 这里**只能**用 peekService：裸读 `ctx.webServer` 会抛 `cannot get property "webServer" without inject`。
  const wsNow = peekService(ctx, 'webServer');
  writeStatus({ stage: 'enter', cfgPanel, envFlag, hasInject: typeof ctx?.inject === 'function', hasWebServerNow: !!wsNow?.register });
  if (!enabled) {
    writeStatus({ stage: 'disabled' });
    say('info', '· 运行面板未启用（`config.panel: true` 或 `LUNHENG_PANEL=1` 可开）——未注册任何 HTTP 路由。');
    return null;
  }
  // v18.90.6：当场能拿到服务就立即注册；拿不到才退回 `ctx.inject(['webServer'], …)` 等待。
  if (wsNow?.register) {
    writeStatus({ stage: 'register-direct', hasWebServerNow: true });
    return registerOn(wsNow, ctx, say, cfgPanel ? 'config' : 'env');
  }
  if (typeof ctx?.inject !== 'function') {
    writeStatus({ stage: 'no-inject', hasWebServerNow: false });
    say('warn', '· 运行面板已开启，但本 ctx 既无 `inject` 也无 `webServer`——已跳过（headless / 无 Web 载体的组合）。');
    return null;
  }
  writeStatus({ stage: 'inject-wait', hasWebServerNow: false });
  let inner = null;
  const off = ctx.inject(['webServer'], (scope) => {
    const ws = peekService(scope, 'webServer') ?? peekService(ctx, 'webServer');
    inner = ws?.register ? registerOn(ws, scope ?? ctx, say, cfgPanel ? 'config' : 'env') : null;
    return () => { try { inner?.() } catch { /* 已注销 */ } };
  });
  return () => { try { off?.() } catch { /* 已注销 */ } try { inner?.() } catch { /* 已注销 */ } };
}

/** 真正落一条 prefix 路由（两种入口共用；参数是**服务对象本身**，避免再裸读 ctx）。 */
function registerOn(ws, handlerCtx, say, source) {
  try {
    const route = { kind: 'prefix', path: PANEL_ROUTE, handler: (req, res) => { handlePanelRequest(handlerCtx, req, res); } };
    const dispose = ws.register(route);
    const roots = panelRoots(handlerCtx);
    writeStatus({ stage: 'registered', registered: true, source, roots: roots.map((r) => basename(r) || r) });
    say('info', `· 运行面板已挂载：${PANEL_ROUTE}（只读；开关来源：${source === 'config' ? 'config.panel' : 'LUNHENG_PANEL'}；工作区根 ${roots.length} 个：${roots.map((r) => basename(r) || r).join(' / ')}）`);
    return dispose;
  } catch (e) {
    writeStatus({ stage: 'register-failed', registered: false, error: String(e?.message || e) });
    say('warn', `· 运行面板挂载失败：${String(e?.message || e).slice(0, 140)}`);
    return null;
  }
}
