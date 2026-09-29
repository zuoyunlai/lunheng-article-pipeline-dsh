// ADR 回归锚点：成对测试的**源码钉**一半（2026-09-29 新增 · 外部借鉴 context-mode A1）
//
// 为什么需要：本仓的决策记录在 `audits/decisions/`（ADR-0001..N）。每份 ADR 的
//   `Regression-proof anchor` 要求**成对测试**：
//     ① 行为测（真跑，断言行为）——分散在各 `*.test.mjs`；
//     ② **源码钉**（正则断言源文件里**不得出现**某标识符 / **必须**保持某形态）——本文件。
//   缺了 ②，决策可在一次「顺手重构」中被**静默回退**：行为测可能刚好没覆盖到那条路径，
//   而源码钉不看行为、只看**形态是否还在**，是最廉价的一道反向断言。
//
// 口径（如实声明边界）：
//   · 本文件**只钉形态，不判语义**——它防的是「那条路被删掉了」，不保证「那条路是对的」。
//   · 断言写成「**必须出现 X**」+「**不得出现 Y**」两句，缺一不可：
//     只写前者会被「保留 X 的同时又加了 Y」绕过；只写后者会被「整段删掉」绕过（删掉也就不含 Y 了）。
//   · 新增 ADR 时，若其 anchor 声明了源码钉，**必须在本文件加一组用例**（否则该 anchor 是空头支票）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_SCRIPTS = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')

const read = (rel) => readFileSync(join(SKILL_SCRIPTS, rel), 'utf8')

/** 取一个顶层函数体（到下一个顶格 `}` 为止）；`export` 可有可无。找不到即抛。 */
function fnBody(src, name) {
  const marker = `function ${name}(`
  const at = src.indexOf(marker)
  assert.ok(at !== -1, `源码里找不到 \`${marker}\`（函数被改名或删除？）`)
  const rest = src.slice(at)
  const end = rest.indexOf('\n}\n')
  assert.ok(end !== -1, `\`${marker}\` 的函数体无法界定（格式已变？）`)
  return rest.slice(0, end)
}

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0002 — 覆盖写盘走 writeWithSafety：temp + rename 原子写 + 有界回滚点
// ─────────────────────────────────────────────────────────────────────────────
test('ADR-0002 源码钉：writeWithSafety 必须走 temp + rename（不得回退为直接覆写目标）', () => {
  const src = read(join('_lib', 'destructive-write.mjs'))
  const fn = fnBody(src, 'writeWithSafety')

  // 必须：写到 temp，再 rename 进目标（且有界重试）
  assert.match(fn, /writeFileSync\(tmp,/, '必须写到 temp（写成 writeFileSync(p, …) 即回退为直接覆写）')
  assert.match(fn, /renameWithRetry\(tmp, p\)/, '必须经 renameWithRetry 把 temp 原子换入目标')

  // 不得：把内容直接写进目标路径（半写损坏的旧缺陷）
  assert.ok(!/writeFileSync\(\s*p\s*,/.test(fn), '不得再出现 writeFileSync(p, …) 直接覆写目标（v18.2.9/B4 已改 temp+rename）')
})

test('ADR-0002 源码钉：renameWithRetry 只对句柄类瞬时错误重试（不得掩盖真问题）', () => {
  const src = read(join('_lib', 'destructive-write.mjs'))
  const fn = fnBody(src, 'renameWithRetry')

  assert.match(fn, /EPERM/, '必须识别 Windows 句柄类瞬时错误 EPERM')
  assert.match(fn, /EACCES/)
  assert.match(fn, /EBUSY/)
  // 白名单式判定：必须是「三者之一才重试」，不是「排除某几个才重试」
  assert.match(fn, /transient/, '必须有显式 transient 判定（白名单式）')
  assert.ok(!/EXDEV|ENOSPC/.test(fn), '不得在重试逻辑里特判 EXDEV/ENOSPC——它们应**立即抛**，不得被重试掩盖')
})

test('ADR-0002 源码钉：pruneBackups 排序必须 mtime 主键 + 确定性 tiebreak', () => {
  const src = read(join('_lib', 'destructive-write.mjs'))

  assert.match(src, /export const BAK_MAX = \d+/, '回滚点必须**有界**（BAK_MAX）')

  // 主键 = mtimeMs 差值
  assert.match(src, /const seqOf = \(f\)/, '必须存在同秒序号解析器 seqOf（tiebreak 的第二段）')
  assert.match(src, /backs\.sort\(/, '必须有 pruneBackups 的排序比较器')

  const cmp = src.slice(src.indexOf('backs.sort('), src.indexOf('backs.sort(') + 200)
  assert.match(cmp, /a\.mt - b\.mt/, '排序**主键**必须是 mtimeMs 差值（只按文件名时间戳是**错的**：同秒内名字被复用）')
  assert.match(cmp, /seqOf\(a\.f\) - seqOf\(b\.f\)/, '必须有同秒序号 tiebreak（缺它则同毫秒下比较器恒为 0 → 顺序退化为 readdir 实现顺序）')
  assert.match(cmp, /a\.f < b\.f/, '必须有文件名兜底 tiebreak（使同一 mtime 集合的顺序唯一）')
})

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0001 — sha256 实值化：机检「同一判据只能有一个出口」（F-BI 的锚点）
// ─────────────────────────────────────────────────────────────────────────────
test('ADR-0001 源码钉：FP_REAL_RE 必须是单一常量，且被硬检查与摘要标记共用', () => {
  const src = read(join('_lib', 'mgate-gates', 'mexist-gates.mjs'))

  assert.match(src, /const FP_REAL_RE = /, '必须存在命名的单一常量 FP_REAL_RE（占位符路径已废止）')
  const uses = (src.match(/FP_REAL_RE/g) || []).length
  assert.ok(uses >= 3, `FP_REAL_RE 至少应出现 3 次（1 定义 + 硬检查 + 摘要标记），实为 ${uses} —— 少于 3 极可能意味着某个出口又用回了独立正则`)

  // 不得：另起一个接受占位符的正则（占位符路径已由 ADR-0001 废止）
  const placeholderRe = /\[哈希校验待主人回填\]\s*\|/
  assert.ok(!placeholderRe.test(src), '不得再出现「占位符 | 实值」的或式正则（ADR-0001 已废止占位符路径）')
})

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0003 — 退出码命名空间：用法错 = 10、内部错 = 70，且不与 M 门 0/1/2/3 混用
// ─────────────────────────────────────────────────────────────────────────────
test('ADR-0003 源码钉：exit-guard 必须给 EXIT_USAGE=10 / EXIT_INTERNAL=70 且声明不混用', () => {
  const src = read(join('_lib', 'exit-guard.mjs'))

  assert.match(src, /export const EXIT_USAGE = 10/, '用法/参数/路径错必须是 10')
  assert.match(src, /export const EXIT_INTERNAL = 70/, '脚本缺陷必须是 70（EX_SOFTWARE）')
  assert.match(src, /不与 0\/1\/2\/3 的 M 门语义混用/, '必须保留「不与 M 门 0/1/2/3 混用」这句口径声明（它本身就是本门的判据原文）')
})

test('ADR-0003 源码钉：本文件的锚点在 repo-hygiene-check 的 ⑧/⑧b/⑧d（断言其仍在，防锚点被删）', () => {
  const hyg = readFileSync(join(ROOT, 'scripts', 'repo-hygiene-check.mjs'), 'utf8')
  for (const rule of ['⑧b 退出码命名空间', '⑧d 脚本自述退出码']) {
    assert.ok(hyg.includes(rule), `repo-hygiene-check 必须仍含规则「${rule}」——它是 ADR-0003 的源码钉锚点`)
  }
})
