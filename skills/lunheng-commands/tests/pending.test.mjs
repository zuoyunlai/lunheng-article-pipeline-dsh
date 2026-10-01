// pending-cli 单元测试（v1.0.3 / 论衡 v18.62.4）
// 覆盖三件会被「改文案」悄悄改坏的事：① §6 五字段的回填判定（含占位符）
// ② 「需要你做的事」段的行过滤（「无」类占位不得进收件箱）③ 项目判据（无 01-任务简报.md 的不是项目）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseSection6, parseOwnerTodos, scanPending, GATES, SECTION6_FIELDS } from '../scripts/pending-cli.mjs';

const S6_OK = [
  '### 6. 主人回复（**主控在收到回复后回填，必填**）',
  '',
  '- **主人原话**：同意，按建议推进',
  '- **回复时间**：2026-09-30 21:10',
  '- **提问方式**：`ask_user_question`',
  '- **主控落盘结论**：进入 Phase 3',
  '- **轮次计数**：非修订轮（回环已用 0/2）',
].join('\n');

test('parseSection6：五字段齐备且无占位符 → 判定为已回填', () => {
  const r = parseSection6(S6_OK);
  assert.equal(r.found, true);
  assert.deepEqual(r.missingFields, []);
  assert.deepEqual(r.placeholderFields, []);
});

test('parseSection6：含 `<…>` 占位符 → 逐字段报出（不得当已回填）', () => {
  const text = S6_OK.replace('同意，按建议推进', '<主人原话>').replace('2026-09-30 21:10', '<YYYY-MM-DD HH:MM>');
  const r = parseSection6(text);
  assert.deepEqual(r.placeholderFields.sort(), ['回复时间', '主人原话'].sort());
  assert.deepEqual(r.missingFields, []);
});

test('parseSection6：缺字段 → 记入 missingFields；整段缺失 → found=false 且全字段缺失', () => {
  const partial = S6_OK.split('\n').filter((l) => !l.startsWith('- **回复时间**')).join('\n');
  assert.deepEqual(parseSection6(partial).missingFields, ['回复时间']);
  const none = parseSection6('# 阶段确认单\n\n## 5. 主人决策\n');
  assert.equal(none.found, false);
  assert.equal(none.missingFields.length, SECTION6_FIELDS.length);
});

test('parseOwnerTodos：「无」类占位不得进收件箱，只留真待办', () => {
  const text = [
    '**🙋 需要你做的事**：',
    '- 现在：无（等 v1 落盘）',
    '- 稍后：Phase 3.5 请提供洞察补充',
    '- 最后：Phase 5 终稿验货',
    '',
    '**已知缺口 / 风险**：案例仅 5 条',
  ].join('\n');
  const todos = parseOwnerTodos(text);
  assert.deepEqual(todos, ['稍后：Phase 3.5 请提供洞察补充', '最后：Phase 5 终稿验货']);
  assert.ok(!todos.some((t) => /^现在：无/.test(t)), '「现在：无」不得进收件箱');
});

test('parseOwnerTodos：无该段 → 空数组（不抛）', () => {
  assert.deepEqual(parseOwnerTodos('# 进展\n\n**现在**：Phase 1'), []);
});

test('scanPending：项目判据 + 可决策/历史分流', () => {
  const root = mkdtempSync(join(tmpdir(), 'lunheng-pending-'));
  try {
    // ① 真项目、未交付、四门全缺 → actionable
    mkdirSync(join(root, 'proj-open'), { recursive: true });
    writeFileSync(join(root, 'proj-open', '01-任务简报.md'), '# 简报\n', 'utf8');
    // ② 真项目、已交付、无主人待办、门缺口 → historical（不进收件箱）
    mkdirSync(join(root, 'proj-done', 'final'), { recursive: true });
    writeFileSync(join(root, 'proj-done', '01-任务简报.md'), '# 简报\n', 'utf8');
    writeFileSync(join(root, 'proj-done', 'final', '定稿.md'), '# 定稿\n', 'utf8');
    // ③ 非项目目录（无 01-任务简报.md）→ nonProject，跳过
    mkdirSync(join(root, '_baseline'), { recursive: true });
    writeFileSync(join(root, '_baseline', 'x.json'), '{}', 'utf8');

    const r = scanPending(root);
    assert.deepEqual(r.actionable.map((p) => p.project), ['proj-open']);
    assert.deepEqual(r.historical.map((p) => p.project), ['proj-done']);
    assert.deepEqual(r.nonProject, ['_baseline']);
    assert.equal(r.actionable[0].pendingGates.length, GATES.length, '四门全缺应逐门报出');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanPending：run 目录不存在 → 空结果且不抛（不误报「无待办」为成功）', () => {
  const r = scanPending(join(tmpdir(), 'lunheng-does-not-exist-xyz'));
  assert.deepEqual(r.actionable, []);
  assert.deepEqual(r.historical, []);
  assert.equal(r.scanned, 0);
});
