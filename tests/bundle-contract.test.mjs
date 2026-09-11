// 组合包契约回归测试（v18.0.1 新增）
//
// 为什么必须有这一条：**patch 里的行才是会被 import 的东西**。
// 官方 `docs/user/develop/basic/publish.zh.md` 明确要求组合包的 patch 插入一行 `name` = 本包包名
// （「插件行按包名而不是相对源码路径引用这个包，这样 Node 的模块解析才能找到已安装的代码」）；
// `package.json#main` **不会**因为「包被列进 profile 的 bundles」就自动执行。
//
// v18.0.0 真实踩到：删掉旧的 skill-filesystem 挂载行时漏补自注册行 → 组合树里
// `name: lunheng-article-pipeline` 行数 = 0 → 入口从不被 import → **技能不注册**。
// 而当时所有静态门全绿：官方 `dsh-plugin-dev check` 只验 patch 合法性（不验是否引用本包）、
// 打包冒烟直接 import 入口跑 apply（绕过 loader）、`--dump-config` 的 grep 命中的是**层头**
// `# == lunheng-article-pipeline` 而非插件行。本测试把这条契约钉死在 CI 里。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const patchPath = join(ROOT, 'cordis.patch.yml')
const patch = readFileSync(patchPath, 'utf8')

/** 取出 patch 里所有 `- id:` / `name:` 行对（缩进无关，够用且零依赖）。 */
function rows() {
  const out = []
  let current = null
  for (const line of patch.split(/\r?\n/)) {
    const id = /^\s*-\s*id:\s*(\S+)\s*$/.exec(line)
    if (id) {
      current = { id: id[1], name: null }
      out.push(current)
      continue
    }
    const name = /^\s*name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (name && current && current.name === null) current.name = name[1]
  }
  return out
}

test('bundle 契约：patch 必须插入一行 name == 包名（入口靠这一行才会被 import）', () => {
  const self = rows().filter((r) => r.name === pkg.name)
  assert.equal(
    self.length,
    1,
    `cordis.patch.yml 必须恰有一行 name == "${pkg.name}"（自注册行）——` +
      `否则 loader 不会 import 本包入口，技能注册不上（v18.0.0 缺陷，见 CHANGELOG 18.0.1）。` +
      `当前 name 值：${JSON.stringify(rows().map((r) => r.name))}`,
  )
  assert.equal(self[0].id, pkg.name, '自注册行的 id 应与包名一致（便于其他层按 id 覆盖 config）')
  assert.ok(existsSync(patchPath), 'patch 文件必须存在')
})

test('bundle 契约：patch 行名只能是本包名或 @deepseek-ai/* 核心模块', () => {
  for (const r of rows()) {
    assert.ok(r.name, `patch 行 ${r.id} 缺 name`)
    const ok = r.name === pkg.name || /^@deepseek-ai\//.test(r.name)
    assert.ok(ok, `patch 行 ${r.id} 的 name=${r.name} 既不是本包名也不是 @deepseek-ai/* 核心模块（拼写错误？）`)
  }
})

test('bundle 契约：manifest 指向的 patch / main / 技能目录必须真实存在且都在 files 白名单内', () => {
  const patchRel = pkg.dsh?.bundle?.patch
  assert.ok(patchRel, 'package.json 缺 dsh.bundle.patch')
  assert.ok(existsSync(join(ROOT, patchRel)), `dsh.bundle.patch 指向的文件不存在：${patchRel}`)
  assert.ok(pkg.files.includes(patchRel.replace(/^\.\//, '')), `files 白名单缺 patch 文件：${patchRel}`)

  const mainRel = pkg.main
  assert.ok(mainRel, 'package.json 缺 main')
  assert.ok(existsSync(join(ROOT, mainRel)), `main 指向的文件不存在：${mainRel}`)
  assert.ok(
    pkg.files.some((f) => mainRel === f || mainRel.startsWith(f.replace(/\/$/, '') + '/')),
    `files 白名单不含 main 所在目录：${mainRel}`,
  )

  // 技能本体必须随包（入口在 apply 期读它；缺了会 ENOENT）
  const skillDir = pkg.files.find((f) => f === 'skills')
  assert.equal(skillDir, 'skills', 'files 白名单必须含 skills（技能随包分发）')
  assert.ok(existsSync(join(ROOT, 'skills', pkg.name, 'SKILL.md')), '随包技能缺 SKILL.md')
})
