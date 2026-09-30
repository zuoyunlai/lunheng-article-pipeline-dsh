#!/usr/bin/env node
// pending-cli.mjs — /lunheng -status --pending 薄壳：跨项目「待我决策」聚合收件箱
// 版本：v18.62.0（F4）
//
// 为什么存在：主人侧三件套（进展-主人版 / 阶段确认单 / 主人投喂清单）全部位于 run/<项目>/，
//   是**单项目内视角**。主人同时跑 2 个项目时，「现在需要我做什么」分散在两处，无聚合视图。
//   本脚本**只聚合、零新数据、零新留痕义务**——数据源全是已存在的产物。
//
// 数据源（均为既有产物，不要求新增任何留痕）：
//   ① run/*/阶段确认-Phase{0,2.5,3.5,5}.md  → §6「主人回复」未回填 / 缺该门
//   ② run/*/进展-主人版.md                  → 「🙋 需要你做的事」段
//
// 口径（与 closeout-verify 同一判据）：**只报「需人工回核」的项，不判结论**——
//   「§6 已回填」只证明主人回复被记录了，不证明内容对。
//
// 用法：
//   node pending-cli.mjs                  # 扫 <cwd>/run
//   node pending-cli.mjs --run-dir <path>
//   node pending-cli.mjs --json
//
// 退出码：0 已列出（含「无待办」）/ 10 参数或路径错 / 70 内部错
//   ⚠️ 本脚本**不做内容判定**，故不存在 1/2/3——按本仓判据，非判定类脚本的 `1` 一律是撞码。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 四门固定文件名（真源 = templates/主人确认-template.md 的「命名真源」） */
export const GATES = ['Phase0', 'Phase2.5', 'Phase3.5', 'Phase5'];

/** §6 的五个固定字段（真源 = 同上模板 §6；缺项即「未留痕」） */
export const SECTION6_FIELDS = ['主人原话', '回复时间', '提问方式', '主控落盘结论', '轮次计数'];

/**
 * 解析阶段确认单的 §6 回填状态。
 * @param {string} text 确认单全文
 * @returns {{found: boolean, missingFields: string[], placeholderFields: string[]}}
 */
export function parseSection6(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{2,4}\s*6[.、]?\s/.test(l) || /^#{2,4}\s*6\s*$/.test(l));
  if (start < 0) return { found: false, missingFields: [...SECTION6_FIELDS], placeholderFields: [] };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,4}\s*\d/.test(lines[i]) || /^##\s/.test(lines[i])) { end = i; break; }
  }
  const block = lines.slice(start + 1, end).join('\n');
  const missingFields = [];
  const placeholderFields = [];
  for (const f of SECTION6_FIELDS) {
    const m = new RegExp(`\\*\\*${f}\\*\\*[：:]\\s*(.*)$`, 'm').exec(block);
    if (!m || m[1].trim() === '') { missingFields.push(f); continue; }
    if (/[<>]/.test(m[1])) placeholderFields.push(f);
  }
  return { found: true, missingFields, placeholderFields };
}

/**
 * 从「进展（主人版）」抽取「需要你做的事」条目。
 * @param {string} text
 * @returns {string[]} 去噪后的待办行（不含「无」类占位）
 */
export function parseOwnerTodos(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /需要你做的事|需要主人做的事/.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    const t0 = l.trim();
    // 下一个加粗小节头（`**已知缺口 / 风险**：…`）即本段结束。
    //   ⚠️ 必须在「剥列表符」**之前**判：`**…**` 也以 `*` 开头，用 `/^[-*•]/` 会把小节头当列表项。
    if (/^\*\*[^*]+\*\*/.test(t0)) break;
    if (/^\s*$/.test(l)) continue;
    if (/^---/.test(l)) break;
    const t = l.replace(/^[-*•]\s+/, '').trim();
    if (!t) continue;
    if (/^(无|无。|无（.*）)$/.test(t)) continue;                    // 「无」类占位
    if (/^(现在|稍后|最后)[:：]\s*无/.test(t)) continue;             // 「稍后：无」
    out.push(t);
  }
  return out;
}

/**
 * 扫描 run 目录，汇总「待我决策」。
 * **可决策（actionable）** 与 **历史缺口（historical）** 必须分开：
 *   已交付项目上的门缺口是**历史留痕问题**（审计面），不是「等主人点一下就能推进」的事；
 *   混在一起会把收件箱淹掉（实测本机 run/ 有 33 个项目，若不分开则「155 项待决策」——不可用）。
 * @param {string} runDir
 * @returns {{actionable: Array<object>, historical: Array<object>, scanned: number}}
 */
export function scanPending(runDir) {
  const actionable = [];
  const historical = [];
  const nonProject = [];
  if (!existsSync(runDir)) return { actionable, historical, nonProject, scanned: 0 };
  const entries = readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  let scanned = 0;
  for (const e of entries) {
    const dir = join(runDir, e.name);
    // 项目判据：`01-任务简报.md` 是 Phase 0 的产物，也是「这是一个流水线项目」的机械标记。
    //   `run/` 下还会有基线快照 / 测试目录 / 归档（实测本机 7 个）——它们没有门也没有主人待办，
    //   若不放行会让收件箱被噪声淹没。故**非项目目录直接跳过**并单独计数（不静默丢弃）。
    if (!existsSync(join(dir, '01-任务简报.md'))) { nonProject.push(e.name); continue; }
    const gateStates = [];
    for (const g of GATES) {
      const p = join(dir, `阶段确认-${g}.md`);
      if (!existsSync(p)) { gateStates.push({ gate: g, state: 'missing' }); continue; }
      const s6 = parseSection6(readFileSync(p, 'utf8'));
      if (!s6.found) gateStates.push({ gate: g, state: 'no-section6' });
      else if (s6.missingFields.length) gateStates.push({ gate: g, state: 'unfilled', detail: `缺字段 ${s6.missingFields.join('/')}` });
      else if (s6.placeholderFields.length) gateStates.push({ gate: g, state: 'placeholder', detail: `占位符 ${s6.placeholderFields.join('/')}` });
      else gateStates.push({ gate: g, state: 'ok' });
    }
    const progressPath = join(dir, '进展-主人版.md');
    const todos = existsSync(progressPath) ? parseOwnerTodos(readFileSync(progressPath, 'utf8')) : [];
    const pendingGates = gateStates.filter((g) => g.state !== 'ok');
    if (!pendingGates.length && !todos.length) continue;
    scanned++;
    const delivered = existsSync(join(dir, 'final', '定稿.md'));
    const row = {
      project: e.name,
      mtime: statSync(dir).mtime.toISOString().slice(0, 16).replace('T', ' '),
      delivered,
      pendingGates,
      todos,
    };
    // 已交付 **且** 没有主人侧待办 → 只是历史留痕缺口，不进收件箱
    if (delivered && !todos.length) historical.push(row);
    else actionable.push(row);
  }
  const byMtimeDesc = (a, b) => (a.mtime < b.mtime ? 1 : -1);
  actionable.sort(byMtimeDesc);
  historical.sort(byMtimeDesc);
  return { actionable, historical, nonProject, scanned };
}

/** 人类可读渲染（≤15 行量级；项目多时按需展开） */
export function renderPending(result, runDir) {
  const out = [];
  const { actionable, historical } = result;
  const nonProject = result.nonProject || [];
  const tail = nonProject.length ? `｜跳过 ${nonProject.length} 个非项目目录（无 01-任务简报.md）` : '';
  if (!actionable.length) {
    out.push(`✅ 无待你决策的项（已扫 ${runDir}${tail}）`);
    if (historical.length) out.push(`ℹ️ 另有 ${historical.length} 个**已交付**项目存在历史留痕缺口（不阻塞你，仅供审计）。`);
    return out.join('\n');
  }
  const total = actionable.reduce((n, p) => n + p.pendingGates.length + p.todos.length, 0);
  out.push(`🙋 待你决策：${actionable.length} 个项目 / ${total} 项`);
  for (const p of actionable) {
    const gateTxt = p.pendingGates.length
      ? p.pendingGates.map((g) => `${g.gate}(${g.state === 'missing' ? '缺门' : g.state === 'no-section6' ? '无§6' : g.state === 'unfilled' ? '未回填' : '占位符'})`).join(' ')
      : '四门齐';
    out.push(`- ${p.project}｜${gateTxt}${p.delivered ? '｜已交付' : ''}`);
    for (const t of p.todos.slice(0, 2)) out.push(`    · ${t}`);
  }
  if (historical.length) out.push(`ℹ️ 另有 ${historical.length} 个**已交付**项目存在历史留痕缺口（不阻塞你，仅供审计）。`);
  out.push('');
  out.push('口径：只报「需人工回核」的项，不判结论——§6 已回填只证明回复被记录，不证明内容对。');
  return out.join('\n');
}
/** CLI 入口 */
function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const i = args.indexOf('--run-dir');
  let runDir = resolve(process.cwd(), 'run');
  if (i >= 0) {
    if (!args[i + 1]) { console.error('--run-dir 需要一个路径参数'); process.exit(10); }
    runDir = resolve(args[i + 1]);
  }
  const unknown = args.filter((a, idx) => a.startsWith('--') && a !== '--json' && a !== '--run-dir' && idx !== i + 1);
  if (unknown.length) { console.error(`未知参数：${unknown.join(', ')}`); process.exit(10); }
  if (!existsSync(runDir)) { console.error(`run 目录不存在：${runDir}`); process.exit(10); }
  try {
    const result = scanPending(runDir);
    if (json) console.log(JSON.stringify({ runDir, ...result }, null, 2));
    else console.log(renderPending(result, runDir));
    process.exit(0);
  } catch (err) {
    console.error(`内部错误：${err && err.message}`);
    process.exit(70);
  }
}

// CLI 入口判定（v18.62.0 F6）：**必须用 `pathToFileURL`**，不得写 `file://${process.argv[1]}`。
//   Windows 下 `import.meta.url` = `file:///E:/…`（三斜杠 + 正斜杠）而 `process.argv[1]` = `E:\…`（反斜杠）
//   → 朴素拼接**永不相等**，CLI 入口**静默不执行**（退出码 0、零输出，最难查的一类失效）。
//   实测：本文件与既有 route-command / stats-cli / history-cli 四处同形，均已改。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main(process.argv);
