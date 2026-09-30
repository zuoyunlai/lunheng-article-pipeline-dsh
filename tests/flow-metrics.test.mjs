// flow-metrics 单元测试（v18.62.0 F5）
// 覆盖：① §6 时间/结论解析 ② 返工轮次取最大 N ③ 项目判据与跳过 ④ 汇总是算术不是判定
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseGateRecord, maxRound, handoffCount, collectMetrics, summarize, GATES } from '../scripts/flow-metrics.mjs';

const gate = (t, conclusion) => [
  '### 6. 主人回复',
  `- **主人原话**：同意`,
  `- **回复时间**：${t}`,
  '- **提问方式**：`ask_user_question`',
  `- **主控落盘结论**：${conclusion}`,
  '- **轮次计数**：非修订轮',
].join('\n');

test('parseGateRecord：解析回复时间（含个位数小时补零）与「被驳」标记', () => {
  const a = parseGateRecord(gate('2026-09-30 9:05', '进入 Phase 3'));
  assert.ok(a.at, '应解析出时间戳');
  assert.equal(a.rejected, false);
  assert.equal(new Date(a.at).getHours(), 9, '个位数小时须补零后解析为 9 点（不得读成 0 点或 NaN）');
  assert.equal(parseGateRecord(gate('2026-09-30 10:05', '打回并按「结构论证」重跑')).rejected, true);
  assert.equal(parseGateRecord(gate('2026-09-30 10:05', '主人驳回，重走 Phase 2')).rejected, true);
});

test('parseGateRecord：无时间戳 / 字段缺失 → at=null 且不抛', () => {
  assert.equal(parseGateRecord('### 6. 主人回复\n- **主人原话**：同意').at, null);
  assert.equal(parseGateRecord('').at, null);
});

test('maxRound：取 修订说明 / 审计报告 两者的最大 N', () => {
  const root = mkdtempSync(join(tmpdir(), 'flow-maxround-'));
  try {
    mkdirSync(join(root, 'drafts'), { recursive: true });
    mkdirSync(join(root, 'audits'), { recursive: true });
    writeFileSync(join(root, 'drafts', '修订说明-v1.md'), '', 'utf8');
    writeFileSync(join(root, 'drafts', '修订说明-v3.md'), '', 'utf8');
    writeFileSync(join(root, 'audits', '审计报告-v2.md'), '', 'utf8');
    writeFileSync(join(root, 'audits', '审计报告-tmp.md'), '', 'utf8');   // 不匹配 → 不计
    assert.equal(maxRound(root), 3);
    assert.equal(maxRound(join(root, 'nope')), 0, '目录不存在 → 0（不抛）');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('handoffCount：只数 `### Tn` 记录行', () => {
  const root = mkdtempSync(join(tmpdir(), 'flow-handoff-'));
  try {
    writeFileSync(join(root, 'agents-log.md'), '# log\n\n### T1 执行记录\nx\n### T2 执行记录\ny\n## 不是\n', 'utf8');
    assert.equal(handoffCount(root), 2);
    assert.equal(handoffCount(join(root, 'nope')), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('collectMetrics：项目判据 + 门跨度只由两侧都有时间戳的相邻门算出', () => {
  const root = mkdtempSync(join(tmpdir(), 'flow-collect-'));
  try {
    const proj = join(root, 'p1');
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, '01-任务简报.md'), '# 简报', 'utf8');
    writeFileSync(join(proj, '阶段确认-Phase0.md'), gate('2026-09-30 08:00', '进入 Phase 1'), 'utf8');
    writeFileSync(join(proj, '阶段确认-Phase2.5.md'), gate('2026-09-30 10:00', '进入 Phase 3'), 'utf8');
    // Phase3.5 / Phase5 缺 → 不参与跨度
    mkdirSync(join(root, '_baseline'), { recursive: true });
    writeFileSync(join(root, '_baseline', 'x.json'), '{}', 'utf8');

    const { projects, nonProject } = collectMetrics(root);
    assert.equal(projects.length, 1);
    assert.deepEqual(nonProject, ['_baseline']);
    const p = projects[0];
    assert.equal(p.gatesPresent, 2);
    assert.equal(p.spans.length, 1, '只有一门有时间的相邻对不该产生跨度');
    assert.equal(p.spans[0].hours, 2);
    assert.equal(p.totalSpanHours, 2);
    assert.equal(p.delivered, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('summarize：只做算术（中位数/计数），不产出任何通过判定字段', () => {
  const projects = [
    { delivered: true, totalSpanHours: 2, rounds: 1, rejectedGates: [], handoffs: 3 },
    { delivered: true, totalSpanHours: 8, rounds: 0, rejectedGates: ['Phase2.5'], handoffs: 0 },
    { delivered: false, totalSpanHours: null, rounds: 2, rejectedGates: [], handoffs: 1 },
  ];
  const s = summarize(projects);
  assert.equal(s.projects, 3);
  assert.equal(s.withSpan, 2);
  assert.equal(s.spanMedianHours, 5);
  assert.equal(s.spanMaxHours, 8);
  assert.equal(s.projectsWithRework, 2);
  assert.equal(s.projectsWithRejectedGate, 1);
  assert.ok(!('pass' in s) && !('ok' in s) && !('verdict' in s), '汇总不得含任何通过/判定字段——它是度量不是门');
});

test('GATES 与主人确认单的四门命名真源同形', () => {
  assert.deepEqual(GATES.map((g) => g.id), ['Phase0', 'Phase2.5', 'Phase3.5', 'Phase5']);
});
