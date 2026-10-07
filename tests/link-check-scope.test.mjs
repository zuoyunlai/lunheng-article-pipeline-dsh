// link-check 的**扫面**回归网（v18.80.0 · 全量审计-v18.79.1 P1-1）
//
// 为什么需要：本脚本此前只 `walkMd(SKILL_ROOT)`，仓库根 5 语 README 与 `docs/**` **不在扫面**；
//   而那里恰好有 22 条指向 `../lunheng-article-pipeline-dsh/`（**不存在的兄弟目录**）的相对链接——
//   在 npm 包内与 GitHub 仓库视图里全部 404（本机恰好存在同名兄弟目录，故本地「看着是好的」）。
//   同类「政策存在但扫描面窄」在本仓已第三次出现（前两次：r09 文档预算只扫技能目录 / 一致性 ⑥b 只扫 active）。
//
// 本组三条把**扫面本身**钉住——不是钉「那 22 条链接已修」（那种断言会在下一次改链接后失效），
//   而是钉「包级文档面必须在扫面内」这一**能力**。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { scan, REPO_ROOT, SKILL_ROOT, REPO_DOC_ROOTS, REPO_DOC_FILES } from '../scripts/link-check.mjs'

const r = scan()
const froms = (arr) => new Set(arr.map(([, from]) => from))

test('L-1 扫面必须含包级文档面（根 README / docs），不只是技能目录', () => {
  // 正向：包级文档面在扫面内 —— 用「这些文件里的引用点出现在结果里」来证，而不是读常量。
  //   反引号裸路径与 Markdown 链接两种 kind 都算；`historical` 那一类也算（它证明**读到了**该文件）。
  const all = [...r.broken, ...r.runtime, ...r.crossSkill, ...r.tomb, ...r.suspect, ...r.historical]
  const seen = froms(all)
  const sawRootReadme = [...seen].some((f) => REPO_DOC_FILES.includes(f))
  const sawDocs = [...seen].some((f) => f.startsWith('docs/'))
  assert.ok(sawRootReadme, `扫面结果里未见任何包级 README 的引用点——根文档可能又掉出扫面（from 集合样本：${[...seen].slice(0, 5).join(', ')}）`)
  assert.ok(sawDocs, `扫面结果里未见任何 docs/ 的引用点——docs 可能又掉出扫面（from 集合样本：${[...seen].slice(0, 5).join(', ')}）`)
  // 覆盖面声明与实装一致：常量为空而扫面仍在 = 有人删了常量却靠别的路径生效，属口径漂移
  assert.ok(REPO_DOC_ROOTS.length > 0 && REPO_DOC_FILES.length > 0, 'REPO_DOC_* 声明不得为空（否则「扫面含包级文档」无真源）')
})

test('L-2 包级文档的 Markdown 链接必须按**文件自身目录**解析（不得靠兄弟目录兜底）', () => {
  // 病灶形态（P1-1）：`README.md` 里写 `../lunheng-article-pipeline-dsh/docs/quick-facts.md`。
  //   本机存在同名兄弟目录 → 本门**不会红**（如实），但在包里/GitHub 上必 404。
  //   故本用例直接钉**形态**：包级文档里不得出现 `](../<本包目录名>/`。
  const bad = []
  for (const f of [...REPO_DOC_FILES, ...REPO_DOC_ROOTS.flatMap((d) => [])]) {
    const rel = f
    const abs = join(REPO_ROOT, rel)
    if (!existsSync(abs)) continue
    const text = readFileSync(abs, 'utf8')
    for (const m of text.matchAll(/\]\(\.\.\/([A-Za-z0-9._-]+)\//g)) {
      // 允许 `../` 指向**父层真实存在**的目录（如 `../skills/...`）；只拦「本包目录名的兄弟形态」
      if (m[1] === 'lunheng-article-pipeline-dsh') bad.push(`${rel} → ${m[0]}`)
    }
  }
  assert.deepEqual(bad, [],
    `包级文档里出现指向**兄弟目录**（../lunheng-article-pipeline-dsh/）的链接：${bad.join('；')}——` +
    '该目录只存在于本机工作区的兄弟布局，npm 包内与 GitHub 仓库视图里都不存在（读者点开即 404）。' +
    '正确写法是**仓库根相对**（docs/quick-facts.md，因为 README 与 docs 同处仓库根）')
})

test('L-3 留痕目录只记账不判定（其链接语义是「当时的工作区结构」）', () => {
  // docs/审计与修订记录/、docs/验证记录/ 是留痕，不随包、不参与断链判定。
  //   断言：这两个目录下的引用点若出现，只能出现在 `historical` 桶，不得进 `broken`。
  const histSet = froms(r.historical)
  const brokenFromHist = r.broken.filter(([, from]) => histSet.has(from))
  assert.deepEqual(brokenFromHist, [], '留痕目录的引用点不得进入 broken（否则历史记录会被当成当下断链要求修）')
  // 且留痕桶**不得为空**：实测该面有 40+ 条引用点——若为 0，说明排除规则写宽了（把整个 docs/ 都排除了）
  assert.ok(r.historical.length > 10,
    `historical 桶只有 ${r.historical.length} 条——疑似排除规则过宽（把非留痕的 docs/ 也排除了）；` +
    '排除面应只有 docs/审计与修订记录/** 与 docs/验证记录/**')
})

test('L-4 占位/缩写记法不得被当成路径（`...` / 单独 `..`）', () => {
  // 实测形态：`docs/quick-facts.md` 用 `skills/.../scripts/m-gate-check.mjs` 指代技能目录下的脚本。
  //   它不是可解析路径（五候选根全落空），此前因 docs/ 不在扫面而不可见。
  assert.equal(r.broken.filter(([t]) => t.includes('...')).length, 0, '缩写记法 `...` 不得进 broken')
  assert.equal(r.broken.filter(([t]) => /(^|[\\/])\.\.($|[\\/])/.test(t)).length, 0, '单独 `..` 不得进 broken')
})

test('L-5 技能目录仍必须被扫（扩面不得替换掉原有面）', () => {
  const seen = froms([...r.broken, ...r.runtime, ...r.crossSkill, ...r.tomb, ...r.suspect])
  const sawSkill = [...seen].some((f) => f.startsWith('skills/'))
  assert.ok(sawSkill, '技能目录的引用点从扫面消失了——扩包级文档面时把原来那一面挤掉了')
  assert.ok(existsSync(SKILL_ROOT), 'SKILL_ROOT 必须存在')
})
