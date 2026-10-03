// 批 5-2 拆分（v18.68.0）：本文件由 tests/scripts.test.mjs 按目标脚本 pack-smoke 拆出（原巨石 115 test / 3.2K 行）。
// 用例内容逐字保留（含「为什么」注释）；共享夹具见 tests/_scripts-shared.mjs 与 tests/_fixtures.mjs。
// 运行：node --test tests/scripts/pack-smoke.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD, NPM_UNAVAILABLE, PIPE_SPAWN_BLOCKED, skipWhen, buildDeliveryNoteWithSec6, DELIVERY_NOTE_OTHER_SECTIONS } from '../_fixtures.mjs'
import { mkProj, DRAFT_OK, cardOk, setupCards, gateOf, mkTriFixture, mform8Of } from '../_scripts-shared.mjs'


test('pack-smoke：patch 缺自注册行 / 引用未声明的包 / 发布面污染 必须报（v18.0.5 新增发布物门；v18.2.0 加裁剪断言）', {
  // v18.2.6：带探测的条件跳过。本用例要 `npm pack`（真解包、真跑发布物入口），而受限 DSH 会话里
  //   npm **不可用**（探测：`npm --version` 经管道 spawn → EPERM；且 npm 缓存目录在工作区外不可写）——
  //   `pack-smoke.mjs` 自身已正确报 `→ 退出码 10（环境问题：npm 不可用或不可写）`，那是**环境**而非本包缺陷。
  //   CI / 无沙箱 host shell 下探测为假 → 用例照常执行，强度不变。
  skip: skipWhen(NPM_UNAVAILABLE, '`npm pack` 在本机不可用（探测：`npm --version` 经管道 spawn → EPERM/非 0；受限 DSH 会话禁子进程命名管道，且 npm 缓存目录在工作区外不可写）——本用例需解包发行物并真跑其入口 apply。请在无文件沙箱的 host shell 或 CI 复核；受限会话下无法执行，不得用 LLM 断言替代机检结论。'),
}, () => {
  // ① 基线：本仓 pack 出来的产物应通过
  const ok = run([join(ROOT, 'scripts', 'pack-smoke.mjs')])
  assert.equal(ok.code, 0, '本仓发布物应通过 pack-smoke：' + ok.out.slice(-400))

  // ② 删掉自注册行 → 必须报（v18.0.0 的真实缺陷形态）
  const { d, repo } = mkRepo({ full: true })
  // `full` 会整仓复制，含 CHANGELOG.md/CONTRIBUTING.md —— 而 v18.2.0 起它们**不得随包**，
  // 留着会让 ② ③ 因「发布面污染」而失败（用错误的理由通过断言）。故先按当前发布面清掉，
  // 让每个注入只检验它自己那一件事。
  for (const f of ['CHANGELOG.md', 'CONTRIBUTING.md']) rmSync(join(repo, f), { force: true })
  const patchPath = join(repo, 'cordis.patch.yml')
  const patch = readFileSync(patchPath, 'utf8')
  writeFileSync(patchPath, patch.replace(/^\s*- id: lunheng-article-pipeline\n\s*name: lunheng-article-pipeline\n/m, ''))
  let r = run([join(repo, 'scripts', 'pack-smoke.mjs')])
  assert.equal(r.code, 1, '缺自注册行必须 exit 1')
  assert.match(r.out, /自注册行/)

  // ③ patch 引用未声明的包 → 必须报（宿主改名即整树起不来）
  writeFileSync(patchPath, patch.replace(/name: '@deepseek-ai\/dsh-tool-subagent'/g, "name: '@deepseek-ai/dsh-tool-nonexistent'"))
  r = run([join(repo, 'scripts', 'pack-smoke.mjs')])
  assert.equal(r.code, 1, '引用未声明包必须 exit 1')
  assert.match(r.out, /未声明/)

  // ④ 把仓库向文件塞回发布面 → 必须报（v18.2.0 裁剪口径的机械防线；防「谁顺手加回 files 白名单」）
  //   注意：先得让该文件**真的存在于工作区**，否则 npm 会忽略不存在的白名单项（那样注入就是空转，测试形同虚设）
  writeFileSync(patchPath, patch)
  writeFileSync(join(repo, 'CHANGELOG.md'), readFileSync(join(ROOT, 'CHANGELOG.md')))
  const pjPath = join(repo, 'package.json')
  const pj = readFileSync(pjPath, 'utf8')
  writeFileSync(pjPath, pj.replace('"LICENSE",', '"LICENSE",\n    "CHANGELOG.md",'))
  r = run([join(repo, 'scripts', 'pack-smoke.mjs')])
  assert.equal(r.code, 1, '仓库向文件随包必须 exit 1（注入若为空转说明本用例无效）')
  assert.match(r.out, /发布面污染/, '必须点名「发布面污染」')

  rmSync(d, { recursive: true, force: true })
})
