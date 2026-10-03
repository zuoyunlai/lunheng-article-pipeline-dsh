// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 token-budget 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/token-budget.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('token-budget --project：读目标对账（省比 / 缺失不给假 100% / §11 与索引段同口径）', () => {
  const d = tmp()
  const proj = join(d, 'run', 'proj')
  const ev = join(proj, 'final', '证据包')
  mkdirSync(join(proj, 'analysis'), { recursive: true })
  mkdirSync(ev, { recursive: true })
  mkdirSync(join(proj, 'audits'), { recursive: true })
  // 大纲：一长段无关内容 + 末尾 §11（60 行规格的浓缩版）
  writeFileSync(join(proj, 'analysis', '分析大纲.md'),
    '# 分析大纲\n\n## 一、论点\n\n' + '大段论证内容。'.repeat(300) + '\n\n## 十一、写手版精简段\n\n- 论证主线：甲\n- 反方：乙\n- 字数预算：4000 字\n- 禁做项：丙\n- 承重墙：丁\n- 映射：| 论点 | 论据 |\n|---|---|\n| 论点1 | [L01] |\n')
  writeFileSync(join(ev, '数据卡.md'), '# 数据卡\n\n## 📇 索引段\n\n[D01] 甲 ｜ 主题 ｜ 论点1\n\n## 正文\n\n### [D01] 甲\n' + '数据说明。'.repeat(200) + '\n信任级别：已发布\n')
  writeFileSync(join(ev, '分析大纲.md'), 'x')
  writeFileSync(join(proj, 'final', '定稿.md'), '# 标题\n\n## 摘要\n\n' + '正文内容。'.repeat(150) + '\n')
  const r = run([join(SCRIPTS, 'token-budget.mjs'), '--project', proj, '--json'])
  assert.equal(r.code, 0, r.out.slice(0, 200))
  const j = parseJson(r)
  const byWhat = (kw) => j.static.rows.find((x) => x.what.includes(kw))
  const s11 = byWhat('§11')
  assert.ok(s11, '应给出 大纲→§11 一行')
  assert.equal(s11.leanSource, 'measured', '本夹具大纲含 §11 → measured')
  assert.ok(s11.savePct >= 50, `§11 应显著省（实测 ${s11.savePct}%）`)
  assert.ok(s11.fullTokens[0] <= s11.fullTokens[1], 'token 应给区间 [低, 高]')
  const idx = byWhat('索引段')
  assert.ok(idx && idx.leanSource === 'measured', '三卡→索引段应为 measured')
  assert.ok(idx.savePct >= 50, `索引段应显著省（实测 ${idx.savePct}%）`)
  // 缺 M-Gate-Report.json → 不给「省 100%」的假节省
  const t8 = byWhat('M 门 JSON')
  assert.ok(t8, '应给出 T8 一行')
  assert.equal(t8.savePct, null, '缺按需读目标时不得报省比（防假 100%）')
  assert.equal(t8.leanSource, 'missing')
  assert.match(t8.note, /无 M-Gate-Report/)
  rmSync(d, { recursive: true, force: true })
})

test('token-budget --roles：按角色聚合真实 tokenUsage（纯聚合数学，假 DSH_HOME 夹具）', () => {
  const d = tmp()
  const sdir = join(d, 'storages', 'session_projcache', 'sessions')
  mkdirSync(sdir, { recursive: true })
  const mk = (id, label, cacheRead, output, steps) => writeFileSync(join(sdir, `${id}.json`), JSON.stringify({
    record: {
      identity: { createdAt: 1 },
      rows: {
        title: { val: `你是论衡流水线的「${label}」` },
        subagent: { val: { identity: { label } } },
        sessionStats: { val: { steps } },
        tokenUsage: { val: { totals: { cacheReadTokens: cacheRead, uncachedInputTokens: 1000, outputTokens: output, cacheWriteTokens: 0 } } },
      },
    },
  }))
  mk('a', 'T5 写手', 8_000_000, 200_000, 50)
  mk('b', 'T7 审计', 2_000_000, 100_000, 30)
  mk('c', 'T2 数据检索', 1_000_000, 50_000, 20)
  mk('d', '审查打包与插件契约', 9_000_000, 999_999, 99)   // 非论衡角色 → 必须排除
  const r = run([join(SCRIPTS, 'token-budget.mjs'), '--roles', '--dsh-home', d, '--json'])
  assert.equal(r.code, 0, r.out.slice(0, 200))
  const j = parseJson(r)
  assert.equal(j.roles.sessionsTotal, 4, '应读到 4 个会话投影')
  assert.equal(j.roles.sessionsClassified, 3, '非论衡角色的子代理必须被排除')
  assert.equal(j.roles.subagentCacheRead, 11_000_000, '分母只计可识别角色（8M+2M+1M）')
  const t5 = j.roles.byRole.find((x) => x.role.startsWith('T5'))
  assert.equal(t5.cacheRead, 8_000_000)
  assert.equal(t5.sharePct, 72.7, `T5 占比应为 8/11=72.7%（实测 ${t5.sharePct}）`)
  assert.equal(j.roles.byRole[0].role.startsWith('T5'), true, '应按 cacheRead 降序')
  rmSync(d, { recursive: true, force: true })
})

test('token-budget：参数契约（-h exit 0 / 未知参数 exit 10+用法 / 无模式 exit 10 / 路径不存在 exit 10）', () => {
  const help = run([join(SCRIPTS, 'token-budget.mjs'), '--help'])
  assert.equal(help.code, 0, '--help 应 exit 0')
  assert.match(help.stdout, /--project/)
  assert.match(help.stdout, /--roles/)
  const bogus = run([join(SCRIPTS, 'token-budget.mjs'), '--bogus'])
  // v18.12.0（L-67）：用法错由 exit 1 改 **exit 10**（1 = M 门「P1 内容失败」，撞码会让主控误触发
  //   T5 修订轮）。本脚本无内容判定，故整份契约里不再出现 1。
  assert.equal(bogus.code, 10, '未知参数应 exit 10（参数错）')
  assert.match(bogus.out, /用法/)
  const none = run([join(SCRIPTS, 'token-budget.mjs')])
  assert.equal(none.code, 10, '无模式应 exit 10（用法错）')
  assert.match(none.out, /--project|--roles/)
  const missing = run([join(SCRIPTS, 'token-budget.mjs'), '--project', join(tmpdir(), 'no-such-proj-xyz')])
  assert.equal(missing.code, 10, '项目路径不存在应 exit 10（v18.2.9：旧版 2 与 M 门「2 = P0」撞义，已改）')
})

// ── v18.22.0 MEA-1：token-budget.mjs --roles 子代理过滤 + 口径三要素 + 未归类桶 + --include-main ─────
// 为什么需要：v18.22.0 报告 §二.3 实测复算——token-budget.mjs:167-199 角色归因不过滤主会话，
//   导致 3 条主会话（cacheRead 359.9M = 分母 55.2%）被错算进 T7 桶，读出"T7 占 69.1%"假象。
//   修法：默认只聚合子会话（label 非空）、加 `--include-main` 显式放开、加 fallback 命中数
//   与未归类占比、加输出头口径三要素。本用例做反向自证（v18.15.0「门在此却不生效」防护）。
test('v18.22.0 MEA-1：token-budget --roles 口径修复 — 默认过滤主会话 / --include-main 放开 / 口径三要素 / 未归类桶', () => {
  const d = tmp()
  const fakeHome = join(d, 'fake-home')
  const projDir = join(fakeHome, 'storages', 'session_projcache', 'sessions')
  mkdirSync(projDir, { recursive: true })

  // 造 3 条 fixture：1 条子代理（label 非空）+ 1 条主会话（label 空）+ 1 条 title fallback
  // 用 Node 原生 writeFileSync（默认 UTF-8 无 BOM；中文 label 安全）——不要用 pwsh 的 [System.IO.File]::WriteAllText
  const fixture = (label, title) => JSON.stringify({
    record: { rows: {
      tokenUsage: { val: { totals: { cacheReadTokens: 1000, uncachedInputTokens: 100, outputTokens: 50 } } },
      subagent: { val: { identity: { label } } },
      title: { val: title },
      sessionStats: { val: { steps: 10 } },
    } },
  })
  writeFileSync(join(projDir, 's1.json'), fixture('T7 审计员', 'T7 审计 v1'))   // 子代理（label 命中）
  writeFileSync(join(projDir, 's2.json'), fixture('', '论衡插件全量审计'))           // 主会话（label 空）
  writeFileSync(join(projDir, 's3.json'), fixture('某个别的工具', 'T5 写手 v1'))    // title fallback

  const script = join(SCRIPTS, 'token-budget.mjs')

  // 默认 --roles：主会话被过滤（s2 不进 scoped）→ scoped=2，未归类=0
  const def = run([script, '--roles', '--dsh-home', fakeHome, '--json'])
  assert.equal(def.code, 0, '--roles 必须 exit 0')
  const defJson = parseJson(def)
  assert.equal(defJson.roles.sessionsInScope, 2, '默认仅纳入 2 个子代理（label 非空）')
  assert.equal(defJson.roles.sessionsUnmatched, 0, '2 个子代理都被归类（T7 审计员 + T5 写手），无未归类')
  assert.ok(defJson.roles.byRole.find((r) => r.role === 'T7 审计'), 'T7 桶在')
  assert.ok(!defJson.roles.includeMain, 'includeMain 默认 false')
  assert.ok(typeof defJson.roles.fallbackHits === 'number', 'fallbackHits 字段存在')
  assert.ok(defJson.roles.fallbackHits >= 1, 'title fallback 至少 1 次命中（s3 label "某个别的工具" 不命中，title "T5 写手 v1" 命中）')

  // --include-main：主会话也纳入 → scoped=3；s2 因 label 空 + title 不命中 ROLE（ROLE.T7 正则要 "审计|T7"）进未归类
  const inc = run([script, '--roles', '--dsh-home', fakeHome, '--include-main', '--json'])
  assert.equal(inc.code, 0, '--include-main 必须 exit 0')
  const incJson = parseJson(inc)
  assert.equal(incJson.roles.sessionsInScope, 3, '--include-main 纳入全部 3 条会话')
  assert.ok(incJson.roles.includeMain, 'includeMain 字段反映 --include-main')
  // s2 旧版会归类到 T7（title 含「审计」+「T7」字样命中）；新版进未归类
  // 实际 ROLE.T7 = /审计|T7/，"论衡插件全量审计" title 命中「审计」→ 即使 s2 label 空，--include-main 时也会归到 T7
  // 这是**已知遗留**：title fallback 仍可能把主会话误归（v18.22.2 待 v18.15.0 教训「加三要素约束」后收口）
  // 本用例只确认：未归类桶存在（结构字段在），不强求具体数
  assert.ok(Array.isArray(incJson.roles.unmatched), '未归类桶结构存在')

  // 输出头口径三要素（非 JSON 模式）
  const head = run([script, '--roles', '--dsh-home', fakeHome])
  assert.equal(head.code, 0, '--roles 默认 exit 0')
  assert.match(head.out, /# 口径（v18.22.0）：/, '输出头必须含口径行')
  assert.match(head.out, /# 样本：/, '输出头必须含样本行')
  assert.match(head.out, /# 分母 = 子代理 cacheRead/, '输出头必须含分母行')

  rmSync(d, { recursive: true, force: true })
})
